import fs from 'fs';
import path from 'path';
import { createBrowserClient } from '../../../utils/film/core/client';
import { setSkillsBase } from '../../../utils/film/skills';
import { FILM_TOOLS, createFilmTools } from '../../../utils/film/tools';
import { probeMedia } from '../../../utils/server/videoInfo';

// THE FILM TOOLS over HTTP: GET lists them, POST { tool, args } calls one. Every harness reaches the
// tools through here, so they behave the same whichever one is driving.

export const config = {
  api: { bodyParser: { sizeLimit: '280mb' }, responseLimit: false },
};

const SKILLS_DIR = path.join(process.cwd(), 'skills');
const readSkills = async () => fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, d.name, 'SKILL.md')))
  .map((d) => {
    const text = fs.readFileSync(path.join(SKILLS_DIR, d.name, 'SKILL.md'), 'utf8');
    return { id: d.name, text, description: (/^description:\s*(.+)$/m.exec(text) || [])[1] || '' };
  });

const toolsFor = (req) => {
  const base = `http://${req.headers.host}`;
  setSkillsBase(base);
  const call = async (method, route, body, { allow = [] } = {}) => {
    const res = await fetch(base + route, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !allow.includes(res.status)) throw new Error(data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || `${route} answered ${res.status}`);
    return data;
  };
  return createFilmTools({
    api: { get: (route, opts) => call('GET', route, null, opts), post: (route, body, opts) => call('POST', route, body, opts) },
    client: createBrowserClient({ base }),
    probe: probeMedia,
    skills: readSkills,
  });
};

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ tools: FILM_TOOLS });
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
  const { tool, args } = req.body || {};
  try {
    return res.status(200).json(await toolsFor(req).call(tool, args || {}));
  } catch (e) {
    return res.status(400).json({ error: e.message || String(e) });
  }
}
