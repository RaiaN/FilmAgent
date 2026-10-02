// Transport layer for the agent core.
//
// The core orchestration (operations.js) never calls the network directly — it
// calls a `client` with this interface: createBrowserClient() → the app's own
// /api/* routes (keys stay server-side, outputs check into the media store).
// Interface (all async):
//   generateImage({ prompt, referenceImages, size, model }) -> { url, prompt }
//   reason({ prompt, systemPrompt, images, video, modelId }) -> { content }
//   startVideo({ content, model, resolution, ratio, duration, generateAudio, draft, draftTaskId }) -> { taskId }
//   pollVideo({ taskId, intervalMs }) -> { videoUrl }
//   generateSpeech({ text, imageData, audioRefs, format, sampleRate }) -> { url, bytes, duration }

import { plannerSkillLine } from '../skills';
import { reasonerSlotOf, DRAFT_MODE } from '../suiteConfig';

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
// Ark decides when a video task is over: every task ends succeeded, failed, expired or
// cancelled (a task that never runs expires on Ark's side). The poll waits for that end
// state and never gives up on a live task — a client-side deadline only abandons a render
// that is still running and still billed (a queued 4K take routinely runs past 30 min).
const TASK_FAILED = ['failed', 'expired', 'cancelled'];

// ---- Browser client: talks to the app's own Next.js API routes ----------------
// Used by the canvas (L4). Keeps the existing request shapes unchanged.

export const createBrowserClient = () => ({
  async generateImage({ prompt, referenceImages, size, model, seed, optimizePrompt }) {
    const res = await fetch('/api/film/imagine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, referenceImages, size, model, seed, optimizePrompt }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(errMsg(data, `Image generation failed (HTTP ${res.status})`));
    return data;
  },

  // A skill bound to the SELECTED LLM slot rides ahead of every system prompt. Done here
  // rather than in each template because all 18 planner calls funnel through this one
  // method — a {plannerSkill} variable in eighteen templates would be the same thing,
  // eighteen times, and would miss the nineteenth.
  async reason({ prompt, systemPrompt, images, video, modelId, reasoningEffort }) {
    const planner = await plannerSkillLine(reasonerSlotOf());
    const res = await fetch('/api/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId,
        prompt,
        systemPrompt: planner ? `${planner}\n\n${String(systemPrompt || '')}`.trim() : systemPrompt,
        images: images || [],
        video: video || undefined,
        reasoningEffort,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(errMsg(data, 'Reasoning request failed'));
    return data;
  },

  async startVideo({ content, model, resolution, ratio, duration, generateAudio, seed, draft = false, draftTaskId = null }) {
    // The API's resolution values are lowercase ('480p' … '4k'); the UI labels say '4K'.
    resolution = resolution ? String(resolution).toLowerCase() : resolution; // eslint-disable-line no-param-reassign
    let body;
    if (draftTaskId) {
      // FINAL FROM A DRAFT: the task REUSES the draft's prompt, references, duration,
      // ratio, seed and audio setting — resending any of them is rejected even with equal
      // values. Only the draft's model and the final resolution go.
      body = { model, content: [{ type: 'draft_task', draft_task: { id: draftTaskId } }], resolution, watermark: false, return_last_frame: true };
    } else {
      // ratio and duration are OMITTED when falsy: a Seedance EDITING task (routed by the
      // prompt's wording) locks both to the source clip and REJECTS the request outright if
      // either is sent — `InvalidParameter.TaskTypeConstraint`.
      body = { model, content, resolution: draft ? DRAFT_MODE.resolution : resolution, generate_audio: !!generateAudio, watermark: false, return_last_frame: true };
      if (draft) body.draft = true;
      if (ratio) body.ratio = ratio;
      if (duration && duration !== 'auto') body.duration = Number(duration);
      if (seed != null && seed !== '') body.seed = Number(seed);
    }
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

  // Frames at given times from a video — each one is checked into the media store by
  // the route, so every url that comes back is durable.
  async extractFrames({ url, timestamps, maxWidth }) {
    const res = await fetch('/api/film/frames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, timestamps, ...(maxWidth ? { maxWidth } : {}) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(errMsg(data, 'Frame extraction failed'));
    return data; // { frames: [{ t, url }] }
  },

  async pollVideo({ taskId, intervalMs = POLL_INTERVAL_MS }) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise((r) => setTimeout(r, intervalMs));
      // A blip (network drop, dev-server restart, 5xx) says nothing about the task — wait
      // it out. A 4xx is a real answer (unknown task, bad key) and ends the poll.
      let res;
      let data;
      try {
        res = await fetch(`/api/seedance-status?taskId=${encodeURIComponent(taskId)}`);
        data = await res.json().catch(() => ({}));
      } catch {
        continue;
      }
      if (!res.ok) {
        if (res.status >= 500) continue;
        throw new Error(errMsg(data, `Seedance status check failed (HTTP ${res.status})`));
      }
      if (data.status === 'succeeded' && data.video_url) return { videoUrl: data.video_url, lastFrameUrl: data.last_frame_url || null, videoCacheUrl: data.video_cache_url || null, lastFrameCacheUrl: data.last_frame_cache_url || null };
      if (TASK_FAILED.includes(data.status)) throw new Error(data.error?.message || data.error || `Seedance task ${data.status}`);
    }
  },

  // Audio via the app's film audio route — Seed Audio 1.0 (prompt-driven; references =
  // up to 3 audio clips (@Audio1..N) OR one image). The BytePlus voice key lives
  // server-side (BYTEPLUSVOICE_API_KEY) — no key rides along.
  async generateSpeech({ text, imageData, audioRefs, format, sampleRate }) {
    const res = await fetch('/api/film/audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, imageData, audioRefs, format, sampleRate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(errMsg(data, `Speech generation failed (HTTP ${res.status})`));
    return data;
  },
});
