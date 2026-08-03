import { randomUUID } from 'crypto';

// Host + resource id are DEPLOYMENT config (region/account-scoped) — resolved from
// the same env vars the film audio route uses; nothing hardcoded but the protocol
// constant below.
const VOICE_HOST = (process.env.BYTEPLUSVOICE_BASE_URL || '').replace(/\/+$/, '');
const TTS_ENDPOINT = `${VOICE_HOST}/api/v3/tts/unidirectional`;
const RESOURCE_ID = process.env.MODELARK_MODEL_SEED_TTS || null;
const APP_KEY = 'aGjiRDfUWi'; // Fixed value per BytePlus docs (protocol constant, not a credential)

const MIME = { mp3: 'audio/mpeg', ogg_opus: 'audio/ogg', pcm: 'audio/pcm' };

export default async function speechHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const {
    speaker,
    text,
    format = 'mp3',
    sampleRate = 24000,
    speechRate = 0,
    loudnessRate = 0,
    contextText = '',
  } = req.body;

  const token = process.env.BYTEPLUSVOICE_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'BYTEPLUSVOICE_API_KEY is not configured in .env.local' });
  }
  if (!VOICE_HOST) {
    return res.status(500).json({ error: 'BYTEPLUSVOICE_BASE_URL is not configured — set it in .env.local (see .env.example).' });
  }
  if (!RESOURCE_ID) {
    return res.status(500).json({ error: 'MODELARK_MODEL_SEED_TTS is not configured — set it in .env.local (see .env.example).' });
  }
  if (!speaker || !text) {
    return res.status(400).json({ error: 'speaker and text are required' });
  }

  const additionsObj = { disable_markdown_filter: true };
  if (contextText.trim()) additionsObj.context_texts = [contextText.trim()];

  const requestBody = {
    user: { uid: randomUUID() },
    req_params: {
      text,
      speaker,
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
        'X-Api-Resource-Id': RESOURCE_ID,
        'X-Api-App-Key': APP_KEY,
        'X-Api-Request-Id': randomUUID(),
        'Content-Type': 'application/json',
        'Connection': 'keep-alive',
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
      if (parsed.data) {
        audioBuffers.push(Buffer.from(parsed.data, 'base64'));
      }
    };

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) parseLine(line);
    }
    // Flush remaining buffer
    if (lineBuffer) parseLine(lineBuffer);

    if (audioBuffers.length === 0) {
      return res.status(200).json({ error: 'TTS service returned no audio' });
    }

    const audio = Buffer.concat(audioBuffers);
    return res.status(200).json({
      audioBase64: audio.toString('base64'),
      mimeType: MIME[format] || 'audio/mpeg',
      format,
      sampleRate,
      size: audio.length,
    });

  } catch (error) {
    const status = error.code ? 400 : 500;
    return res.status(status).json({ error: 'TTS request failed', details: error.message });
  }
}
