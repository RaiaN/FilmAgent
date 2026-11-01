import { randomUUID } from 'crypto';
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
    if (!res.ok && !allow.includes(res.status)) throw new Error(data?.error?.message || [typeof data?.error === 'string' ? data.error : '', data?.details].filter(Boolean).join(': ') || `${route} answered ${res.status}`);
    return data;
  };
  return createFilmTools({
    api: { get: (route, opts) => call('GET', route, null, opts), post: (route, body, opts) => call('POST', route, body, opts) },
    client: createBrowserClient({ base }),
    origin: base,
    probe: probeMedia,
    skills: readSkills,
  });
};

// A tool that takes minutes must not hold one of the browser's few connections to this server, or
// the page's pictures wait behind it. With `background` the call answers at once with a job to ask
// after. Jobs outlive reloads of this module while developing.
const jobs = globalThis.filmToolJobs || new Map();
globalThis.filmToolJobs = jobs;
const JOB_KEEP_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method === 'GET' && req.query.job) {
    const job = jobs.get(String(req.query.job));
    if (!job) return res.status(404).json({ error: 'That job is not known here: the server may have restarted.' });
    return res.status(200).json(job);
  }
  if (req.method === 'GET') return res.status(200).json({ tools: FILM_TOOLS });
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
  const { tool, args, background } = req.body || {};
  if (background) {
    const id = randomUUID();
    jobs.set(id, { done: false });
    const settle = (result) => { jobs.set(id, { done: true, ...result }); setTimeout(() => jobs.delete(id), JOB_KEEP_MS); };
    toolsFor(req).call(tool, args || {}).then((out) => settle({ out }), (e) => settle({ error: e.message || String(e) }));
    return res.status(202).json({ job: id });
  }
  try {
    return res.status(200).json(await toolsFor(req).call(tool, args || {}));
  } catch (e) {
    return res.status(400).json({ error: e.message || String(e) });
  }
}
