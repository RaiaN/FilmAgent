// Auto Director — orchestrator operations (L1 core). Pure: each takes typed input
// + ctx { client, config } and returns typed results. The canvas (and a future
// SDK) call these; only the injected `client` differs. These reason with the
// Seed 2.0 Pro VLM (ctx.client.reason) and parse tolerant JSON, modelled on
// parseBeats in operations.js. No canvas, no browser, no network here.

import { renderTemplate, getModel } from '../suiteConfig';

// Agents the planner is allowed to compose into a production (storyDirector is
// interactive, promptMuse is a helper — both excluded from auto-planning).
export const PLANNABLE_AGENTS = ['inspiration', 'characterVariations', 'locationVariations', 'mixMatch', 'animate'];

const randomId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  return Math.random().toString(36).slice(2, 10);
};

// Tolerant JSON: strip code fences, try a direct parse, else grab the first
// balanced object/array. Returns null when nothing parses.
const parseJson = (text) => {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  if (!cleaned) return null;
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const m = cleaned.match(/[[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* */ } }
  return null;
};

// ---- understand: VLM reads the source assets + idea → a production brief -------

export const understandAssets = async ({ images = [], idea = '', config } = {}, ctx) => {
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('autoDirector.understand.user', { idea: idea || '(none given)' }),
    systemPrompt: renderTemplate('autoDirector.understand.system'),
    images,
    modelId: getModel('reasoner', config),
  });
  const b = parseJson(content) || {};
  return {
    logline: String(b.logline || idea || '').slice(0, 240),
    genre: String(b.genre || '').slice(0, 80),
    mood: String(b.mood || '').slice(0, 120),
    palette: String(b.palette || '').slice(0, 160),
    subjects: Array.isArray(b.subjects) ? b.subjects.slice(0, 8).map((s) => ({ name: String(s?.name || '').slice(0, 60), description: String(s?.description || '').slice(0, 200) })) : [],
    locations: Array.isArray(b.locations) ? b.locations.slice(0, 8).map((l) => ({ name: String(l?.name || '').slice(0, 60), description: String(l?.description || '').slice(0, 200) })) : [],
  };
};

// ---- plan: brief → ordered steps mapped to existing agents ---------------------

export const buildPlan = async ({ brief, idea = '', targetMinutes = 4, agents = [], config } = {}, ctx) => {
  const catalogue = (agents.length ? agents : PLANNABLE_AGENTS.map((id) => ({ id, describe: '' })))
    .map((a) => `- ${a.id}: ${a.describe || ''}`).join('\n');
  const allowed = agents.length ? agents.map((a) => a.id) : PLANNABLE_AGENTS;
  const briefText = typeof brief === 'string' ? brief : JSON.stringify(brief || {}, null, 2);

  const { content } = await ctx.client.reason({
    prompt: renderTemplate('autoDirector.plan.user', { idea: idea || '(none given)', brief: briefText, targetMinutes }),
    systemPrompt: renderTemplate('autoDirector.plan.system', { agents: catalogue }),
    modelId: getModel('reasoner', config),
  });

  const raw = parseJson(content);
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.steps) ? raw.steps : []);
  // Assign ids by original index first so dependsOn (0-based indexes from the
  // model) can be remapped to ids before we drop any invalid steps.
  const ids = arr.map(() => `st-${randomId()}`);
  return arr
    .map((s, i) => ({
      id: ids[i],
      agent: s?.agent,
      title: String(s?.title || s?.agent || `Step ${i + 1}`).slice(0, 60),
      intent: String(s?.intent || '').slice(0, 320),
      params: (s?.params && typeof s.params === 'object') ? s.params : {},
      // Only depend on EARLIER steps (a DAG) — a forward/self reference would
      // resolve to a step that hasn't produced outputs yet and starve this one.
      dependsOn: (Array.isArray(s?.dependsOn) ? s.dependsOn : [])
        .filter((n) => Number.isInteger(n) && n >= 0 && n < i)
        .map((n) => ids[n]),
    }))
    .filter((s) => allowed.includes(s.agent));
};

// ---- QC: VLM reviews a step's outputs vs intent + references --------------------

export const qcStep = async ({ agent = '', intent = '', references = [], outputs = [], video, config } = {}, ctx) => {
  const images = [...references, ...outputs];
  let content;
  try {
    ({ content } = await ctx.client.reason({
      prompt: renderTemplate('autoDirector.qc.user', { agent, intent, refCount: references.length }),
      systemPrompt: renderTemplate('autoDirector.qc.system'),
      images,
      video,
      modelId: getModel('reasoner', config),
    }));
  } catch (err) {
    // QC is advisory — never block the human on a QC failure.
    return { verdict: 'pass', issues: [], best: 0, error: err.message };
  }
  const r = parseJson(content) || {};
  const verdict = ['pass', 'warn', 'fail'].includes(r.verdict) ? r.verdict : 'pass';
  const issues = Array.isArray(r.issues)
    ? r.issues.map((it) => ({
        severity: ['low', 'medium', 'high'].includes(it?.severity) ? it.severity : 'medium',
        message: String(it?.message || '').slice(0, 300),
        suggestion: String(it?.suggestion || '').slice(0, 300),
      })).filter((it) => it.message)
    : [];
  const outCount = Math.max(outputs.length, 1);
  const best = Number.isInteger(r.best) && r.best >= 0 && r.best < outCount ? r.best : 0;
  return { verdict, issues, best };
};
