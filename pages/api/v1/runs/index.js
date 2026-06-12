import { createRun } from '../../../../utils/film/server/runStore';

// POST /api/v1/runs — start an agent run (async). Returns { id, status } immediately.
// Body: { agent, input, config?, webhookUrl?, apiKey? }
// Auth: Authorization: Bearer <key>  OR  body.apiKey  (passthrough to ModelArk; no tenancy in v1)

export const config = {
  api: { bodyParser: { sizeLimit: '25mb' } },
};

// Single agents + the full-production orchestrator (autoDirector = idea → film).
const AGENTS = new Set(['inspiration', 'characterVariations', 'locationVariations', 'mixMatch', 'animate', 'promptMuse', 'storyBeats', 'autoDirector']);

const resolveApiKey = (req) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return (req.body?.apiKey || process.env.MODELARK_API_KEY || process.env.ARK_API_KEY || '').trim();
};

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { agent, input, config: cfg, baseUrl, webhookUrl } = req.body || {};
  if (!AGENTS.has(agent)) {
    return res.status(400).json({ error: `Unknown or missing agent. One of: ${[...AGENTS].join(', ')}` });
  }
  const apiKey = resolveApiKey(req);
  if (!apiKey) return res.status(401).json({ error: 'API key required (Authorization: Bearer … or body.apiKey)' });

  const run = createRun({ agent, input: input || {}, config: cfg, apiKey, baseUrl, webhookUrl });
  return res.status(202).json({ id: run.id, status: run.status });
}
