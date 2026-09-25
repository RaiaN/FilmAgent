import { mediakitKey, mediakitBase, MEDIAKIT_MISSING } from '../../../utils/config';
import { presignStoreUrl } from '../../../utils/server/presignStore';

// BytePlus AI MediaKit video enhancement.
//   POST { videoUrl, params } → submit /api/v1/tools/enhance-video → { taskId }
//   GET  ?taskId=…            → /api/v1/tasks/{id} → { status, videoUrl, result, error, … }
// The request parameters are passed through exactly as the API names them; the API
// validates them and its own error message is what the caller sees.

const PARAM_KEYS = ['tool_version', 'scene', 'enhance_style', 'resolution', 'resolution_limit', 'bitrate_level', 'fps', 'bit_depth', 'codec'];

const apiError = (body, status) => {
  const e = body?.error;
  if (e?.message) return `${e.code ? `${e.code}: ` : ''}${e.message}`;
  return `MediaKit request failed (HTTP ${status})`;
};

export default async function enhanceVideoHandler(req, res) {
  const token = mediakitKey();
  const base = mediakitBase();
  if (!token || !base) return res.status(500).json({ error: MEDIAKIT_MISSING });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  try {
    if (req.method === 'POST') {
      const { videoUrl, params = {} } = req.body || {};
      // A media-store url points at this server; MediaKit needs a public link to the TOS copy.
      const url = await presignStoreUrl(String(videoUrl || '').trim());
      if (!url || !/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: 'The input video needs a public http(s) URL — upload it again, or check the TOS settings in .env.local.' });
      }
      const body = { video_url: url };
      PARAM_KEYS.forEach((k) => {
        if (params[k] !== undefined && params[k] !== null && params[k] !== '') body[k] = params[k];
      });
      const r = await fetch(`${base}/api/v1/tools/enhance-video`, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.success || !data.task_id) {
        return res.status(r.ok ? 400 : r.status).json({ error: apiError(data, r.status), requestId: data.request_id || null });
      }
      return res.status(200).json({ taskId: data.task_id, requestId: data.request_id || null });
    }

    if (req.method === 'GET') {
      const taskId = String(req.query.taskId || '').trim();
      if (!taskId) return res.status(400).json({ error: 'taskId is required' });
      const r = await fetch(`${base}/api/v1/tasks/${encodeURIComponent(taskId)}`, { headers });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.success) {
        return res.status(r.ok ? 502 : r.status).json({ error: apiError(data, r.status) });
      }
      return res.status(200).json({
        taskId: data.task_id,
        status: data.status, // running | completed | failed
        videoUrl: data.result?.video_url || null,
        result: data.result || null,
        error: data.status === 'failed' ? apiError(data, r.status) : null,
        expiresAt: data.expires_at ? Number(data.expires_at) : null,
        createdAt: data.created_at ? Number(data.created_at) : null,
        finishedAt: data.finished_at ? Number(data.finished_at) : null,
      });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  } catch (error) {
    return res.status(500).json({ error: `MediaKit request failed: ${error.message}` });
  }
}
