#!/usr/bin/env node
// THE FILM AGENT, no UI: one sentence from the director, Pi as the loop, the film's planner model
// (FILM_AGENT_MODEL, with FILM_AGENT_THINKING as its effort or 'off'), and the film tools as its only
// tools. The session route sets both from Project settings. Against the running dev server.
//   FILM_AGENT_MODEL=<model id> FILM_AGENT_THINKING=high node scripts/film-agent.mjs --new "My film" --attach face.jpg "Make a 10 second video of her"
//   node scripts/film-agent.mjs --project film-x "T4: remove the apples"
//   node scripts/film-agent.mjs --serve --project film-x
// Prints each step as it happens and the agent's report; --log writes the run as JSON. With --serve
// it stays up as one session: JSON lines in ({ type: 'say', text } · { type: 'stop' }), JSON events out.
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices, formatSkillsForPrompt, loadSkillsFromDir, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { FILM_COMMANDS, createWorkbenches, filmAgentExtension, pictureNamed } from './film-agent-extension.mjs';
import { RENDERS, createRunRules } from '../utils/film/agentRules.mjs';

const BASE = process.env.FILM_TOOLS_URL || 'http://localhost:3000';
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime' };
// Tools the harness uses for the agent: it never picks a project, and files arrive as attachments.
const HARNESS_ONLY = ['ensure_project', 'add_media', 'archive', 'forget_media', 'enhance_prompt', 'merge_film', 'settle_renders', 'results', 'read_transcript', 'save_transcript'];

const argv = process.argv.slice(2);
const option = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const options = (flag) => { const out = []; for (let v = option(flag); v; v = option(flag)) out.push(v); return out; };
const serve = argv.includes('--serve');
if (serve) argv.splice(argv.indexOf('--serve'), 1);
const newName = option('--new');
const logPath = option('--log');
const attachments = options('--attach');
let project = option('--project');
const sentence = argv.join(' ').trim();
const die = (m) => { console.error(m); process.exit(1); };
if ((!serve && !sentence) || !project === !newName) die('Usage: film-agent (--new <name> | --project <id>) [--attach <file>]... [--log <file>] "<what you want>"');

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '')]));
const need = (k) => env[k] || die(`${k} is not set in .env.local.`);
process.env.FILM_AGENT_KEY = need('MODELARK_API_KEY');
const modelId = process.env.FILM_AGENT_MODEL || die('FILM_AGENT_MODEL is not set: the session route sets it from the film\'s planner.');
const thinking = process.env.FILM_AGENT_THINKING || die('FILM_AGENT_THINKING is not set: the planner\'s effort, or off.');

const call = async (tool, args) => {
  const res = await fetch(`${BASE}/api/film/tools`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, args }) });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || `${tool} answered ${res.status}`);
  return out;
};
const pictureOf = async (url) => {
  const res = await fetch(url.startsWith('/') ? BASE + url : url);
  if (!res.ok) throw new Error(`Could not fetch a picture (HTTP ${res.status}).`);
  return { type: 'image', data: Buffer.from(await res.arrayBuffer()).toString('base64'), mimeType: res.headers.get('content-type') || 'image/jpeg' };
};

// What the director attached comes in before the agent starts, under its short name.
const started = Date.now();
if (newName) {
  project = `film-${Date.now().toString(36)}`;
  await call('ensure_project', { project, name: newName });
}
const attached = [];
for (const file of attachments) {
  const type = TYPES[path.extname(file).toLowerCase()] || die(`Can't tell what ${file} is. Types: ${Object.keys(TYPES).join(' ')}`);
  // eslint-disable-next-line no-await-in-loop
  const r = await call('add_media', { project, data_url: `data:${type};base64,${fs.readFileSync(file).toString('base64')}`, label: path.basename(file, path.extname(file)) });
  attached.push(`${r.name} (${path.basename(file)})`);
}

let rules = createRunRules();
const trace = [];
const toToolResult = async (name, out) => {
  if (name !== 'look' || (!out.frames && !out.image_url)) return [{ type: 'text', text: JSON.stringify(out) }];
  const { frames, image_url: image, video_url: video, ...rest } = out;
  const pictures = await Promise.all((frames ? frames.map((f) => f.url) : [image]).map(pictureOf));
  const seen = frames ? { seen_as: `${frames.length} frames across its length, at ${frames.map((f) => f.t).join(', ')} s` } : {};
  return [{ type: 'text', text: JSON.stringify({ ...rest, ...seen }) }, ...pictures];
};

const { tools } = await (await fetch(`${BASE}/api/film/tools`)).json();
const agentTools = tools.filter((t) => !HARNESS_ONLY.includes(t.name)).map((t) => {
  const { project: projectField, ...properties } = t.parameters.properties;
  return { name: t.name, description: t.description, usesProject: !!projectField, parameters: { ...t.parameters, properties, required: (t.parameters.required || []).filter((k) => k !== 'project') } };
});
const runTool = async (t, params) => {
  const refused = rules.before(t.name, params);
  if (refused) { trace.push({ tool: t.name, refused }); throw new Error(refused); }
  try {
    const out = await call(t.name, t.usesProject ? { ...params, project } : params);
    rules.after(out);
    trace.push({ tool: t.name, params, out: t.name === 'read_skill' ? { id: params.id } : out });
    return await toToolResult(t.name, out);
  } catch (e) {
    rules.error(t.name, e.message, params);
    trace.push({ tool: t.name, params, error: e.message });
    throw e;
  }
};

const emit = (e) => { if (serve) process.stdout.write(`${JSON.stringify(e)}\n`); };
const workbenches = createWorkbenches({ emit });
const openEdit = async (word, words) => {
  if (!serve) throw new Error('The Edit Image workbench needs the FilmAgent tab.');
  const r = pictureNamed((await call('results', { project })).results, word);
  const out = await workbenches.ask({ kind: 'edit_image', name: r.name, words });
  return out.cancelled ? out : { name: r.name, mention: r.mention || r.name, words: out.words, marked: out.marked || null };
};

const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-agent-'));
fs.writeFileSync(path.join(agentDir, 'models.json'), JSON.stringify({ providers: { ark: { baseUrl: need('MODELARK_API_BASE_URL'), api: 'openai-responses', apiKey: '$FILM_AGENT_KEY', models: [{ id: modelId, reasoning: thinking !== 'off', input: ['text', 'image'], contextWindow: 256000, maxTokens: 32000 }] } } }));
const modelRuntime = await ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: path.join(agentDir, 'models.json') });
const model = modelRuntime.getModel('ark', modelId) || die(`Pi did not take the model ${modelId}.`);

const method = fs.readFileSync(path.join('skills', 'film-agent', 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
// What the agent can offer: the director's commands and the craft skills, by name and description.
// Pi lists skills itself only with its file-reading tools, which this agent doesn't have, so the
// list uses Pi's own format and the agent loads a skill with read_skill. Crew skills are Studio's.
const craftSkills = loadSkillsFromDir({ dir: path.resolve('skills'), source: 'film-agent' }).skills.filter((sk) => !sk.name.startsWith('crew-') && sk.name !== 'film-agent');
const offer = [
  '## What the director can type',
  ...FILM_COMMANDS.map((c) => `- /${c.name}: ${c.description}`),
  'When they ask what you can do, or whether you can do something one of these does, tell them the command.',
  `## Skills\nLoad one with read_skill, using its name.${formatSkillsForPrompt(craftSkills, 'read_skill')}`,
].join('\n');
// A model call that goes silent ends after a minute; a working model streams long before that. It
// gets one retry, said out loud in the session: nothing has been rendered or spent at that point.
const settingsManager = SettingsManager.inMemory({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 500 }, httpIdleTimeoutMs: 60000 });
// Pi replaces the session through its runtime, building each one here.
const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({
    cwd, agentDir, modelRuntime, settingsManager,
    resourceLoaderOptions: {
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: `${method}\n\n${offer}`,
      extensionFactories: [filmAgentExtension({ tools: agentTools, execute: runTool, openEdit, onError: (text) => emit({ type: 'error', text }), cancelWork: () => workbenches.cancelAll(), onReset: () => emit({ type: 'reset' }) })],
    },
  });
  return { ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, thinkingLevel: thinking, noTools: 'builtin' })), services, diagnostics: services.diagnostics };
};
const runtime = await createAgentSessionRuntime(createRuntime, { cwd: agentDir, agentDir, sessionManager: SessionManager.inMemory(agentDir) });
const forbidden = ['read', 'bash', 'powershell', 'edit', 'write', 'grep', 'find', 'ls'];

let report = '';
let modelError = '';
let usage = { input: 0, output: 0 };
const madeBy = (text) => {
  try {
    const out = JSON.parse(text);
    return [out, ...(out.results || [])].filter((r) => r.name && r.status).map((r) => r.name);
  } catch { return []; }
};
const onEvent = (e) => {
  if (e.type === 'auto_retry_start') {
    if (!serve) console.log(`The model call failed (${e.errorMessage}). Trying once more.`);
    emit({ type: 'halted', text: `The model call failed (${e.errorMessage}). Trying once more.` });
  }
  if (e.type === 'tool_execution_start') {
    if (!serve) console.log(`· ${e.toolName} ${JSON.stringify(e.args || {}).slice(0, 160)}`);
    emit({ type: 'step', id: e.toolCallId, tool: e.toolName, args: e.args || {} });
  }
  if (e.type === 'tool_execution_end') {
    const text = e.result?.content?.[0]?.text || '';
    if (e.isError && !serve) console.log(`  ✕ ${JSON.stringify(text).slice(0, 240)}`);
    const render = RENDERS.includes(e.toolName);
    emit({ type: 'step_end', id: e.toolCallId, ...(e.isError ? { error: text } : {}), ...(render && !e.isError ? { made: madeBy(text) } : {}) });
    if (rules.mustAbort()) {
      if (!serve) console.log('The harness ended the run: the model kept calling tools past its limit.');
      emit({ type: 'halted', text: 'The run was ended: the model kept calling tools past its limit.' });
      runtime.session.abort();
    }
  }
  if (e.type === 'message_end' && e.message.role === 'assistant') {
    const said = (e.message.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    if (said) { report = said; emit({ type: 'text', text: said }); }
    if (e.message.errorMessage && e.message.stopReason !== 'aborted') modelError = e.message.errorMessage;
    usage = { input: usage.input + (e.message.usage?.input || 0), output: usage.output + (e.message.usage?.output || 0) };
  }
};

// Each session Pi starts gets the same listener and the same actions. Pi's own `newSession` does
// nothing until a host binds it to the runtime.
let unsubscribe = () => {};
const bind = async () => {
  unsubscribe();
  const { session } = runtime;
  const active = session.getActiveToolNames();
  if (active.some((n) => forbidden.includes(n))) die(`Pi activated tools outside the film tools: ${active.filter((n) => forbidden.includes(n)).join(', ')}.`);
  await session.bindExtensions({ commandContextActions: {
    waitForIdle: () => runtime.session.waitForIdle(),
    newSession: async (o) => {
      const out = await runtime.newSession(o);
      rules = createRunRules();
      await bind();
      return out;
    },
  } });
  unsubscribe = session.subscribe(onEvent);
};
await bind();

if (serve) {
  // What can be typed: Pi's own list of the commands registered with it.
  emit({ type: 'commands', commands: runtime.session.extensionRunner.getRegisteredCommands().map((c) => ({ name: c.name, description: c.description || '' })) });
  // ONE SESSION: what is said while it works reaches the agent after its current step.
  let running = false;
  const run = async (text) => {
    running = true;
    rules = createRunRules();
    modelError = '';
    try {
      await runtime.session.prompt(text);
      await runtime.session.waitForIdle();
      if (modelError) emit({ type: 'error', text: `The model call failed: ${modelError}. Nothing is lost: say it again to go on.` });
    } catch (e) {
      emit({ type: 'error', text: e.message || String(e) });
    } finally {
      running = false;
      emit({ type: 'idle', usage, ...rules.stats() });
    }
  };
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const m = JSON.parse(line);
    if (m.type === 'stop') {
      if (running) { workbenches.cancelAll(); emit({ type: 'halted', text: 'Stopped. Renders already started keep going and land here.' }); runtime.session.abort(); }
    } else if (m.type === 'answer') {
      workbenches.answer(m.id, m.value);
    } else if (m.type === 'say') {
      if (running && m.text.startsWith('/')) runtime.session.prompt(m.text).catch((e) => emit({ type: 'error', text: e.message || String(e) }));
      else if (running) runtime.session.steer(m.text).catch((e) => emit({ type: 'error', text: e.message || String(e) }));
      else run(m.text);
    }
  });
} else {
  const message = [sentence, attached.length ? `Attached: ${attached.join(', ')}.` : ''].filter(Boolean).join('\n\n');
  console.log(`project ${project}${attached.length ? ` · attached ${attached.join(', ')}` : ''}`);
  try {
    await runtime.session.prompt(message);
  } finally {
    await runtime.dispose();
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
  if (modelError) console.log(`\nThe model call failed: ${modelError}`);
  console.log(`\n${report}`);
  const stats = { project, seconds: Math.round((Date.now() - started) / 1000), tokens: usage, ...rules.stats() };
  console.log(`\n${JSON.stringify(stats)}`);
  if (logPath) fs.writeFileSync(logPath, JSON.stringify({ sentence, attached, report, modelError, stats, trace }, null, 1));
  process.exit(modelError ? 1 : 0);
}
