// Transport layer for the agent core.
//
// The core orchestration (operations.js) never calls the network directly — it
// calls a `client` with this interface, so the SAME orchestration runs:
//   • in the canvas, via createBrowserClient() → the app's own /api/* routes
//   • headless (SDK / server), via createDirectClient() → ModelArk directly
//
// Interface (all async):
//   generateImage({ prompt, referenceImages, size, model }) -> { url, prompt }
//   reason({ prompt, systemPrompt, images, video, modelId }) -> { content }
//   startVideo({ content, model, resolution, ratio, duration, generateAudio }) -> { taskId }
//   pollVideo({ taskId, intervalMs, timeoutMs }) -> { videoUrl }

// Pull a human-readable string out of an API error body (may nest under
// .error.message or .details). Never returns "[object Object]".
export const errMsg = (data, fallback) => {
  const cand = data?.error?.message
    || (typeof data?.error === 'string' ? data.error : null)
    || data?.details?.error?.message
    || (typeof data?.details === 'string' ? data.details : null)
    || data?.details?.message;
  if (typeof cand === 'string' && cand.trim()) return cand;
  if (data?.details) { try { return JSON.stringify(data.details); } catch { /* noop */ } }
  return fallback;
};

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 360000;

// ---- Browser client: talks to the app's own Next.js API routes ----------------
// Used by the canvas (L4). Keeps the existing request shapes unchanged.

export const createBrowserClient = (apiKey) => ({
  async generateImage({ prompt, referenceImages, size, model }) {
    const res = await fetch('/api/film/imagine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, prompt, referenceImages, size, model }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(errMsg(data, `Image generation failed (HTTP ${res.status})`));
    return data;
  },

  async reason({ prompt, systemPrompt, images, video, modelId, reasoningEffort }) {
    const res = await fetch('/api/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, modelId, prompt, systemPrompt, images: images || [], video: video || undefined, reasoningEffort }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(errMsg(data, 'Reasoning request failed'));
    return data;
  },

  async startVideo({ content, model, resolution, ratio, duration, generateAudio }) {
    const body = { apiKey, model, content, resolution, ratio, generate_audio: !!generateAudio, watermark: false };
    if (duration && duration !== 'auto') body.duration = Number(duration);
    const res = await fetch('/api/seedance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(errMsg(data, 'Seedance start failed'));
    const taskId = data.id || data.task_id;
    if (!taskId) throw new Error('Seedance did not return a task id');
    return { taskId };
  },

  async pollVideo({ taskId, intervalMs = POLL_INTERVAL_MS, timeoutMs = POLL_TIMEOUT_MS }) {
    const startedAt = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (Date.now() - startedAt > timeoutMs) throw new Error('Seedance timed out');
      await new Promise((r) => setTimeout(r, intervalMs));
      const res = await fetch(`/api/seedance-status?taskId=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json();
      if (data.status === 'succeeded' && data.video_url) return { videoUrl: data.video_url };
      if (data.status === 'failed') throw new Error(data.error?.message || data.error || 'Seedance task failed');
    }
  },
});
