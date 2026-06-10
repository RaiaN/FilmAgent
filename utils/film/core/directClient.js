// Headless transport: implements the client interface by calling ModelArk
// directly. This is what runs in the SDK / a server / a customer's runtime —
// no browser, no app API routes. Same interface as createBrowserClient, so the
// orchestration in operations.js is identical in both worlds.

import { errMsg } from './client';

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 360000;

const stripTrailingSlash = (s) => String(s || '').replace(/\/+$/, '');
const isHttpUrl = (v) => /^https?:\/\//i.test(String(v || '').trim());

const extractResponseText = (data) => {
  const nested = Array.isArray(data?.output)
    ? data.output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .find((item) => item?.type === 'output_text' || item?.type === 'text')?.text
    : '';
  return data.output_text || nested || data?.choices?.[0]?.message?.content || '';
};

// Seedream re-downloads reference URLs server-side, which 403s on expired/foreign
// signed URLs. Inline http(s) refs as base64 so there's no second fetch to fail.
const inlineReference = async (ref) => {
  if (typeof ref !== 'string') return null;
  if (!isHttpUrl(ref)) return ref; // already a data: URL or asset id
  const resp = await fetch(ref);
  if (!resp.ok) throw new Error(`Reference image could not be loaded (HTTP ${resp.status}).`);
  const contentType = resp.headers.get('content-type') || 'image/jpeg';
  const b64 = Buffer.from(await resp.arrayBuffer()).toString('base64');
  return `data:${contentType};base64,${b64}`;
};

export const createDirectClient = ({ apiKey, baseUrl }) => {
  const token = apiKey || process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
  const base = stripTrailingSlash(baseUrl || process.env.MODELARK_API_BASE_URL);
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  return {
    async generateImage({ prompt, referenceImages, size = '2K', model }) {
      const refs = (referenceImages || []).filter(Boolean);
      const inlined = (await Promise.all(refs.map(inlineReference))).filter(Boolean);
      const body = { model, prompt, size, watermark: false, response_format: 'url' };
      if (inlined.length === 1) body.image = inlined[0];
      else if (inlined.length > 1) body.image = inlined;

      const res = await fetch(`${base}/images/generations`, { method: 'POST', headers: authHeaders, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(errMsg(data, `Image generation failed (HTTP ${res.status})`));
      const url = data?.data?.[0]?.url;
      if (!url) throw new Error('No image URL in response');
      return { url, prompt };
    },

    async reason({ prompt, systemPrompt, images, video, modelId }) {
      const isResponsesApi = String(modelId || '').startsWith('seed-2-0');
      if (isResponsesApi) {
        const userContent = [{ type: 'input_text', text: prompt }];
        (images || []).forEach((img) => userContent.push({ type: 'input_image', image_url: img }));
        if (video) userContent.push({ type: 'input_video', video_url: video });
        const input = [];
        if (systemPrompt) input.push({ role: 'system', content: [{ type: 'input_text', text: systemPrompt }] });
        input.push({ role: 'user', content: userContent });
        const res = await fetch(`${base}/responses`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ model: modelId, stream: false, input }) });
        const data = await res.json();
        if (!res.ok) throw new Error(errMsg(data, 'Reasoning request failed'));
        return { content: extractResponseText(data) };
      }
      // Chat-completions fallback for non-pro models.
      const messages = [{ role: 'system', content: systemPrompt || 'You are a helpful assistant.' }];
      if ((images || []).length || video) {
        const content = [{ type: 'text', text: prompt }];
        (images || []).forEach((img) => content.push({ type: 'image_url', image_url: { url: img } }));
        if (video) content.push({ type: 'video_url', video_url: { url: video } });
        messages.push({ role: 'user', content });
      } else {
        messages.push({ role: 'user', content: prompt });
      }
      const res = await fetch(`${base}/chat/completions`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ model: modelId, messages }) });
      const data = await res.json();
      if (!res.ok) throw new Error(errMsg(data, 'Reasoning request failed'));
      return { content: extractResponseText(data) };
    },

    async startVideo({ content, model, resolution, ratio, duration, generateAudio }) {
      const body = { model, content, resolution, ratio, generate_audio: !!generateAudio, watermark: false };
      if (duration && duration !== 'auto') body.duration = Number(duration);
      const res = await fetch(`${base}/contents/generations/tasks`, { method: 'POST', headers: authHeaders, body: JSON.stringify(body) });
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
        const res = await fetch(`${base}/contents/generations/tasks/${taskId}`, { headers: authHeaders });
        const data = await res.json();
        if (data.status === 'succeeded' && data.content?.video_url) return { videoUrl: data.content.video_url };
        if (data.status === 'failed') throw new Error(data.error?.message || data.error || 'Seedance task failed');
      }
    },
  };
};
