import { getEndpointUrl, arkKey, ARK_KEY_MISSING } from '../../../utils/config';

// CANCEL A RENDER AT ARK. Ark stops a task only while it is still queued; one that has started
// rendering runs to the end, and the answer says so.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
  const { taskId } = req.body || {};
  if (!taskId) return res.status(400).json({ error: 'Name the task.' });
  const token = arkKey();
  if (!token) return res.status(500).json({ error: ARK_KEY_MISSING });
  const response = await fetch(`${getEndpointUrl('video')}/${encodeURIComponent(taskId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (response.ok) return res.status(200).json({ cancelled: true });
  const data = await response.json().catch(() => ({}));
  return res.status(200).json({ cancelled: false, error: data?.error?.message || `Ark answered ${response.status}` });
}
