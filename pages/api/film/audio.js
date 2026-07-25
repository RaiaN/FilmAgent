import { randomUUID } from 'crypto';
import { checkInBytes } from './media';

// The film suite's audio route — TWO engines behind one contract, both returning a
// data: url the canvas checks into the local media store seconds after the clip lands.
//
//  • 'seedAudio' (default) — Seed Audio 1.0 via its OWN endpoint, /api/v3/tts/create
//    (per the official HTTP guide): single X-Api-Key header, `text_prompt` is a PROMPT
//    the model follows (ambience, multi-voice drama, SFX — not just verbatim TTS),
//    optional references = a speaker voice id OR one reference image (scene mood),
//    single JSON response with base64 audio (its `url` is temporary — 2h — so the
//    bytes are decoded here and never depended on). The old 403 came from calling
//    seed-audio-1.0 as a tts/unidirectional resource — it isn't one.
//  • 'seedTts' — Seed TTS 2.0 via tts/unidirectional (streaming NDJSON, the proven
//    playground contract): speaks the text VERBATIM with a required voice id.
//
// The key stays server-side (BYTEPLUSVOICE_API_KEY) — same voice console for both.

// REQUIRED via env — no default region. Guarded at request time with a clear error.
const VOICE_HOST = (process.env.BYTEPLUSVOICE_BASE_URL || '').replace(/\/+$/, '');
const TTS_ENDPOINT = `${VOICE_HOST}/api/v3/tts/unidirectional`;
const CREATE_ENDPOINT = `${VOICE_HOST}/api/v3/tts/create`;
const APP_KEY = 'aGjiRDfUWi'; // Fixed value per BytePlus docs (unidirectional only)

// 'seedTts' → X-Api-Resource-Id for the streaming endpoint. A raw resource id string
// passes through untouched, so new streaming models need no code change here.
const SEED_AUDIO_MODEL = process.env.MODELARK_MODEL_SEED_AUDIO || null; // REQUIRED via env
const RESOURCE_IDS = { seedTts: process.env.MODELARK_MODEL_SEED_TTS || null }; // REQUIRED via env

const MIME = { mp3: 'audio/mpeg', ogg_opus: 'audio/ogg', pcm: 'audio/pcm', wav: 'audio/wav' };

export const config = {
  api: {
    bodyParser: { sizeLimit: '30mb' }, // an inlined reference image (base64, ≤10MB file) rides in the body
    responseLimit: false,              // 120s of audio as a data: url exceeds Next's 4MB default
  },
};

// Seed Audio 1.0 — one shot, one JSON. Success is the presence of `audio` (base64);
// if the service ever answers with only its temporary `url`, fetch THAT server-side
// immediately (it lapses in 2h) so the client still receives durable bytes.
async function createAudio(res, { token, text, voice, imageData, format, sampleRate, speechRate, loudnessRate, pitchRate }) {
  const prompt = String(text);
  if (prompt.length > 2048) {
    return res.status(400).json({ error: `Seed Audio prompts cap at 2048 characters (this one is ${prompt.length}) — split the script into shorter clips.` });
  }
  // The API forbids mixing audio references (a speaker id counts as one) with an image
  // reference — the UI enforces the choice, this is the backstop.
  const speaker = String(voice || '').trim();
  if (speaker && imageData) {
    return res.status(400).json({ error: 'Seed Audio takes a voice OR a reference image, not both — clear one and re-run.' });
  }
  const references = [];
  if (speaker) references.push({ speaker });
  if (imageData) {
    if (!/^data:image\//.test(String(imageData))) return res.status(400).json({ error: 'The reference image must arrive as a data: url.' });
    references.push({ image_data: String(imageData).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '') });
  }

  const body = {
    model: SEED_AUDIO_MODEL,
    text_prompt: prompt, // VERBATIM — the user's words are the prompt, no rewriting
    ...(references.length ? { references } : {}),
    audio_config: {
      format,
      sample_rate: sampleRate,
      speech_rate: speechRate,
      loudness_rate: loudnessRate,
      pitch_rate: pitchRate,
    },
    watermark: {},
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('Seed Audio timed out after 120s')), 120000);
  let response;
  try {
    response = await fetch(CREATE_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-Api-Key': token,
        'X-Api-Request-Id': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }

  const logId = response.headers.get('X-Tt-Logid') || '';
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch {
    return res.status(502).json({ error: 'Seed Audio returned a non-JSON response', details: raw.slice(0, 300), logId });
  }
  if (!response.ok) {
    const hint = response.status === 403 ? ' — activate "Seed-Audio 1.0" in the BytePlus voice console (Settings → Activate) for this key.' : '';
    return res.status(response.status).json({ error: `${data?.message || `Seed Audio failed (HTTP ${response.status})`}${hint}`, details: { code: data?.code, logId } });
  }

  let audio = data?.audio ? Buffer.from(data.audio, 'base64') : null;
  if ((!audio || !audio.length) && data?.url) {
    const r = await fetch(data.url); // the 2h temp url — drained NOW, never stored
    if (r.ok) audio = Buffer.from(await r.arrayBuffer());
  }
  if (!audio || !audio.length) {
    return res.status(502).json({ error: data?.message || 'Seed Audio returned no audio', details: { code: data?.code, logId } });
  }

  // SOURCE-SIDE durability: the clip goes straight into the two-tier store (local +
  // TOS mirror) and the STABLE store url is what the client receives — no megabyte
  // base64 payload, no client-side check-in required. data: fallback if the store hiccups.
  let clipUrl = `data:${MIME[format] || 'audio/mpeg'};base64,${audio.toString('base64')}`;
  try { clipUrl = (await checkInBytes(audio, MIME[format] || 'audio/mpeg')).url; }
  catch (e) { console.warn('[film/audio] source check-in failed — falling back to data: url:', e.message); }

  return res.status(200).json({
    url: clipUrl,
    bytes: audio.length,
    duration: data?.duration,
    format,
    ...(speaker ? { voice: speaker } : {}),
    model: SEED_AUDIO_MODEL,
  });
}

export default async function filmAudioHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const {
    text,
    voice,
    model = 'seedAudio',
    format = 'mp3',
    sampleRate = 24000,
    speechRate = 0,
    loudnessRate = 0,
    pitchRate = 0,
    instruction = '', // seedTts only: delivery direction (rides as context_texts)
    imageData,        // seedAudio only: ONE reference image as a data: url (scene mood)
  } = req.body || {};

  const token = process.env.BYTEPLUSVOICE_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'BYTEPLUSVOICE_API_KEY is not configured in .env.local' });
  }
  if (!VOICE_HOST) {
    return res.status(500).json({ error: 'BYTEPLUSVOICE_BASE_URL is not configured — set it in .env.local (see .env.example).' });
  }
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'text is required' });

  // Seed Audio 1.0 — the create endpoint (voice optional; prompt-driven).
  if (model === 'seedAudio') {
    if (!SEED_AUDIO_MODEL) {
      return res.status(500).json({ error: 'MODELARK_MODEL_SEED_AUDIO is not configured — set it in .env.local (see .env.example).' });
    }
    try {
      return await createAudio(res, { token, text, voice, imageData, format, sampleRate, speechRate, loudnessRate, pitchRate });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Seed Audio request crashed' });
    }
  }

  // Seed TTS 2.0 (streaming) — speaks VERBATIM, a voice id is mandatory.
  if (!voice || !String(voice).trim()) return res.status(400).json({ error: 'voice (speaker id) is required' });
  if (model === 'seedTts' && !RESOURCE_IDS.seedTts) {
    return res.status(500).json({ error: 'MODELARK_MODEL_SEED_TTS is not configured — set it in .env.local (see .env.example).' });
  }
  const resourceId = RESOURCE_IDS[model] || String(model);

  const additionsObj = { disable_markdown_filter: true };
  if (String(instruction).trim()) additionsObj.context_texts = [String(instruction).trim()];

  const requestBody = {
    user: { uid: randomUUID() },
    req_params: {
      text: String(text), // VERBATIM — the consistency rule applies to speech too
      speaker: String(voice).trim(),
      audio_params: {
        format,
        sample_rate: sampleRate,
        speech_rate: speechRate,
        loudness_rate: loudnessRate,
      },
      additions: JSON.stringify(additionsObj),
    },
  };

  try {
    const response = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-Api-Key': token,
        'X-Api-Resource-Id': resourceId,
        'X-Api-App-Key': APP_KEY,
        'X-Api-Request-Id': randomUUID(),
        'Content-Type': 'application/json',
        Connection: 'keep-alive',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: `TTS request failed (HTTP ${response.status})`,
        details: errorText.slice(0, 500),
      });
    }

    // The server streams newline-delimited JSON objects.
    // Each intermediate chunk: { "code": 0, "data": "<base64 audio>" }
    // Final chunk:             { "code": 20000000, "message": "ok", "data": null }
    const audioBuffers = [];
    const decoder = new TextDecoder();
    let lineBuffer = '';

    const parseLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed;
      try { parsed = JSON.parse(trimmed); } catch (_) { return; }
      if (parsed.code && parsed.code !== 0 && parsed.code !== 20000000) {
        throw Object.assign(new Error(parsed.message || `TTS error code ${parsed.code}`), { code: parsed.code });
      }
      if (parsed.data) audioBuffers.push(Buffer.from(parsed.data, 'base64'));
    };

    // Node's fetch exposes the body as a web ReadableStream.
    const reader = response.body.getReader();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop(); // keep the trailing partial line
      lines.forEach(parseLine);
    }
    if (lineBuffer.trim()) parseLine(lineBuffer);

    const audio = Buffer.concat(audioBuffers);
    if (!audio.length) return res.status(502).json({ error: 'TTS returned no audio' });

    const mime = MIME[format] || 'audio/mpeg';
    return res.status(200).json({
      url: `data:${mime};base64,${audio.toString('base64')}`,
      bytes: audio.length,
      format,
      voice: String(voice).trim(),
      model: resourceId,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'TTS request crashed' });
  }
}
