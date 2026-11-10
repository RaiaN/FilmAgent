import { spawn } from 'child_process';
import path from 'path';
import { REASONER_OPTIONS, getModel, getRuntime, reasonerSlotOf } from '../../../utils/film/suiteConfig';

// THE SESSION, over HTTP: one agent process per project, kept on the server, so the work goes on
// when the tab closes. POST says something or stops it; GET reads the session from an event onward.
// What is said is saved in the project, so a session survives the server too.

export const config = {
  api: { bodyParser: { sizeLimit: '280mb' }, responseLimit: false },
};

// Next reloads this module while developing; the running agents must outlive that.
const sessions = globalThis.filmAgentSessions || new Map();
globalThis.filmAgentSessions = sessions;

const toolsOf = (req) => async (tool, args) => {
  const res = await fetch(`http://${req.headers.host}/api/film/tools`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, args }) });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || `${tool} answered ${res.status}`);
  return out;
};

const add = (s, event) => { s.events.push({ n: s.events.length, at: Date.now(), ...event }); };

// Renders end whatever the agent is doing, or whether it is there at all, so the film hears about it
// from here: while any is running, and until the film is gone.
const SETTLE_MS = 8000;
const watchRenders = (s, tools) => {
  if (s.watching) return;
  s.watching = true;
  const tick = async () => {
    let running = 1;
    try {
      ({ running } = await tools('settle_renders', { project: s.project }));
    } catch (e) {
      if (/There is no film/.test(e.message)) running = 0;
    }
    if (running) setTimeout(tick, SETTLE_MS);
    else s.watching = false;
  };
  tick();
};

const open = async (project, tools) => {
  if (sessions.has(project)) return sessions.get(project);
  const { transcript = [] } = await tools('read_transcript', { project });
  const s = { project, // A workbench open when the agent last stopped has nobody waiting for it.
    events: transcript.filter((e) => e.type !== 'workbench' && e.type !== 'workbench_done').map((e, n) => ({ ...e, n })), busy: false, child: null, tail: '', commands: [] };
  sessions.set(project, s);
  watchRenders(s, tools);
  return s;
};

// The session runs on the film's planner and its effort from Project settings, as they are when
// the agent starts. A film not saved yet has picked nothing, so it runs on the suite's planner.
const plannerOf = async (host, project) => {
  const res = await fetch(`http://${host}/api/film/cloud?action=load&id=${encodeURIComponent(project)}`);
  const out = await res.json().catch(() => ({}));
  if (!res.ok && !/No cloud save/.test(out.error || '')) throw new Error(out.error || `Could not read the film's settings (HTTP ${res.status}).`);
  const p = out.project || {};
  const perCall = { runtime: { ...(p.planner ? { reasonerSlot: p.planner } : {}), ...(p.reasoningEffort ? { reasoningEffort: p.reasoningEffort } : {}) } };
  const slot = reasonerSlotOf(perCall);
  return { model: getModel(slot, perCall), thinking: REASONER_OPTIONS.find((o) => o.key === slot).effort ? getRuntime(perCall).reasoningEffort : 'off' };
};

// What the agent process prints is the session: one JSON event a line.
const start = (s, tools, host) => {
  s.starting = s.starting || plannerOf(host, s.project).then((planner) => launch(s, tools, planner)).catch((e) => {
    s.stopped = true;
    add(s, { type: 'error', text: `The agent did not start: ${e.message}` });
  }).finally(() => { s.starting = null; });
  return s.starting;
};
const launch = (s, tools, planner) => {
  const child = spawn(process.execPath, [path.join(process.cwd(), 'scripts', 'film-agent.mjs'), '--serve', '--project', s.project], { cwd: process.cwd(), env: { ...process.env, FILM_AGENT_MODEL: planner.model, FILM_AGENT_THINKING: planner.thinking }, stdio: ['pipe', 'pipe', 'pipe'] });
  s.child = child;
  // What came before a reset is gone: only the session since then is kept.
  const save = () => tools('save_transcript', { project: s.project, transcript: s.events.slice(s.events.map((e) => e.type).lastIndexOf('reset') + 1) }).catch((e) => add(s, { type: 'error', text: `The session was not saved: ${e.message}` }));
  child.stdout.on('data', (chunk) => {
    const lines = (s.tail + chunk).split('\n');
    s.tail = lines.pop();
    lines.filter(Boolean).forEach((line) => {
      let e;
      try { e = JSON.parse(line); } catch { return; }
      if (e.type === 'commands') { s.commands = e.commands; return; }
      if (e.type === 'idle') { s.busy = false; save(); }
      if (e.made?.length) watchRenders(s, tools);
      add(s, e);
      if (e.type === 'reset') save();
    });
  });
  let errors = '';
  child.stderr.on('data', (d) => { errors = (errors + d).slice(-1000); });
  child.on('close', (code) => {
    s.child = null;
    if (code) s.stopped = true;
    if (s.busy || code) {
      s.busy = false;
      add(s, { type: 'error', text: `The agent stopped (exit ${code}). ${errors.trim()}`.trim() });
      save();
    }
  });
  child.stdin.on('error', () => {});
};

export default async function handler(req, res) {
  const tools = toolsOf(req);
  try {
    if (req.method === 'GET') {
      const { project, after } = req.query;
      if (!project) return res.status(400).json({ error: 'Name the project.' });
      const s = await open(String(project), tools);
      // The agent starts with the film, so what can be typed is known before the first message.
      // One that stopped by itself waits for your next message, so it can't restart in a loop.
      if (!s.child && !s.stopped && !s.starting) start(s, tools, req.headers.host);
      return res.status(200).json({ busy: s.busy, commands: s.commands, events: s.events.slice(Number(after) || 0) });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
    const { action, project, name, text, attachments = [] } = req.body || {};
    if (!project) return res.status(400).json({ error: 'Name the project.' });
    const s = await open(project, tools);
    if (action === 'stop') {
      if (s.child) s.child.stdin.write(`${JSON.stringify({ type: 'stop' })}\n`);
      return res.status(200).json({ busy: s.busy });
    }
    // The director's answer to a workbench: a marks picture comes in first, under its short name.
    if (action === 'answer') {
      const { id, words, marked, name: picture, mention, cancelled } = req.body;
      if (!s.child) return res.status(400).json({ error: 'The agent that asked has stopped. Open it again.' });
      if (cancelled) { s.child.stdin.write(`${JSON.stringify({ type: 'answer', id, value: { cancelled: true } })}\n`); return res.status(200).json({ ok: true }); }
      const added = marked ? await tools('add_media', { project, data_url: marked, label: `${picture} with marks` }) : null;
      add(s, { type: 'you', text: `Edit @${mention}: ${words}`, attached: added ? [{ name: added.name, file: `${picture} with marks` }] : [] });
      s.child.stdin.write(`${JSON.stringify({ type: 'answer', id, value: { words, marked: added?.name || null } })}\n`);
      return res.status(200).json({ ok: true });
    }
    if (action !== 'say') return res.status(400).json({ error: `No action ${action}.` });
    if (!String(text || '').trim() && !attachments.length) return res.status(400).json({ error: 'Say something.' });
    s.busy = true;
    const added = [];
    try {
    // The film may be new: its first sentence is what makes it worth keeping.
    await tools('ensure_project', { project, name: name || 'Untitled film' });
    // What the director attaches comes in first, under its short name.
    for (const a of attachments) {
      // eslint-disable-next-line no-await-in-loop
      const r = await tools('add_media', { project, data_url: a.data_url, label: a.name });
      added.push({ name: r.name, file: a.name, ...(r.not_usable_as_reference ? { problem: r.not_usable_as_reference } : {}) });
    }
    } catch (e) { s.busy = false; throw e; }
    const said = [String(text || '').trim(), added.length ? `Attached: ${added.map((a) => `${a.name} (${a.file})`).join(', ')}.` : ''].filter(Boolean).join('\n\n');
    add(s, { type: 'you', text: String(text || '').trim(), attached: added });
    s.stopped = false;
    if (!s.child) await start(s, tools, req.headers.host);
    if (!s.child) { s.busy = false; throw new Error('The agent did not start.'); }
    s.busy = true;
    s.child.stdin.write(`${JSON.stringify({ type: 'say', text: said })}\n`);
    return res.status(200).json({ busy: true, attached: added });
  } catch (e) {
    return res.status(400).json({ error: e.message || String(e) });
  }
}
