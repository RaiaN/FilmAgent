import { CONFIG } from '../../../utils/config';
import { ROOT_CONFIG } from '../../../utils/film/suiteConfig';

// Single-image generation for the canvas. Clients fire N of these in parallel
// so each finished image can drop onto the board incrementally.
// Optional reference image enables variation / mix-and-match layers.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

// fetch with a hard timeout — without it a hung upstream (a slow Seedream call or a
// reference URL that never responds) blocks the request indefinitely (observed: a 26-min
// hang → "fetch failed"). On timeout it aborts and throws, handled as a normal failure.
const fetchWithTimeout = async (url, opts = {}, ms = 120000) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error(`Timed out after ${Math.round(ms / 1000)}s`)), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
};

export default async function imagineHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const {
    apiKey,
    baseUrl,
    prompt,
    referenceImage,        // single URL/base64, or...
    referenceImages,       // ...array of URLs/base64 (multi-ref blend / mix & match)
    size = '2K',
    model,                 // optional override; defaults to the suite's Seedream model
    seed,                  // optional fixed seed (the Storyboard holds it constant across frames)
  } = req.body || {};
  const seedreamModel = model || ROOT_CONFIG.models.seedream;

  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const token = apiKey || process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'API key not configured' });
  }
  const endpointBase = (baseUrl || CONFIG.API_BASE_URL).replace(/\/+$/, '');

  const rawRefs = []
    .concat(referenceImages || [])
    .concat(referenceImage ? [referenceImage] : [])
    .filter(Boolean);

  // Seedream's output URLs are short-lived signed TOS URLs. Re-feeding one as a
  // reference makes Seedream's backend re-download it, which 403s once the URL
  // ages out or is fetched from a different context. So we download each http(s)
  // reference here and inline it as base64 — no second fetch for Seedream to fail.
  const inlineReference = async (ref) => {
    if (typeof ref !== 'string') return null;
    if (!/^https?:\/\//i.test(ref)) return ref; // already a data: URL or asset id
    const resp = await fetchWithTimeout(ref, {}, 30000); // a reference download shouldn't take >30s
    if (!resp.ok) {
      throw new Error(
        `Reference image could not be loaded (HTTP ${resp.status}). Generated images expire after ~24h — re-generate the keyframe, then try again.`,
      );
    }
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await resp.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  };

  try {
    const refs = await Promise.all(rawRefs.map(inlineReference));

    const body = {
      model: seedreamModel,
      prompt: String(prompt).trim(),
      size,
      watermark: false,
      response_format: 'url',
    };
    if (refs.length === 1) {
      body.image = refs[0];
    } else if (refs.length > 1) {
      body.image = refs; // Seedream multi-image blend
    }
    if (seed != null && seed !== '') body.seed = Number(seed);

    const response = await fetch(`${endpointBase}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      const seedreamMessage = data?.error?.message || data?.message || data?.error || `Image generation failed: ${response.status}`;
      // Surface the real reason in the dev server terminal so 400s are diagnosable.
      console.error(
        `[film/imagine] Seedream ${response.status} — refs=${refs.length} size=${size} :: ${typeof seedreamMessage === 'string' ? seedreamMessage : JSON.stringify(seedreamMessage)}`,
        JSON.stringify(data).slice(0, 600),
      );
      return res.status(response.status).json({
        error: typeof seedreamMessage === 'string' ? seedreamMessage : JSON.stringify(seedreamMessage),
        details: data,
      });
    }
    const url = data?.data?.[0]?.url;
    if (!url) {
      return res.status(502).json({ error: 'No image URL in response' });
    }
    return res.status(200).json({ url, prompt: body.prompt, size, model: seedreamModel });
  } catch (error) {
    // A THROW here is NOT a Seedream rejection (those are handled above with the
    // real status/message) — it's an exception around the call: reference inlining
    // 403'd on an aged TOS URL, an upstream connection flake (fetch failed /
    // ECONNRESET), or a non-JSON gateway body. Surface the REAL message AS `error`
    // (not a generic "crashed" label) so (a) the toast is actionable and (b)
    // withRetry's isTransient() can recognize a network blip and retry it — a
    // generic label matches no transient pattern and silently defeats the retry,
    // leaving a hole in the contact sheet. Also log it so dev terminals can diagnose.
    console.error('[film/imagine] crashed —', error?.message, '::', (error?.stack || '').split('\n').slice(1, 3).join(' '));
    return res.status(500).json({ error: error?.message || 'Image generation crashed' });
  }
}
