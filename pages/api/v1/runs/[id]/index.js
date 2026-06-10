import { getRun, publicRun } from '../../../../../utils/film/server/runStore';

// GET /api/v1/runs/:id — poll a run's status + results.
export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const run = getRun(req.query.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  return res.status(200).json(publicRun(run));
}
