// STORY ROOM — idea → blueprint → critique → patch, on the story-builder skill.
//
// Roles: Scout (ideas from code-dealt axes) · Originality probe · Architect (one call,
// whole skill) · Critic (objection-first) · Reviser (returns a PATCH for the flagged
// blocks only) · Script supervisor (the visual beat sheet) · Director (Seedance 2.5 shots
// under the sd25-pe spec) · Verifier (quotes the prompt words that show each fact).
// Code owns every promise the prompts make: block names, word caps, the spine's opening,
// which blocks a revision may touch, fact coverage, and whether a quoted proof is real.
//
// Every planner call stays well inside /api/seed's ~300 s ceiling: scoring roles run at
// medium effort, and the Reviser emits only the blocks it rewrites.
import { renderTemplate, getModel, getRuntime } from '../suiteConfig';
import { getTemplateText } from '../promptTemplates';
import { hydrateSkills, skillById, requireSkillLine } from '../skills';
import { parseJson } from './director';
import { runWithConcurrency } from './parallel';

export const STORY_SKILL_ID = 'story-builder';
export const BLOCKS = ['protagonist', 'flaw', 'internal_need', 'inciting_incident', 'external_want', 'antagonist', 'journey', 'crisis', 'climax', 'resolution'];
export const SCORE_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'originality', 'specificity'];
export const BLOCK_CAP = 45; // words per block / per journey obstacle
export const SPINE_CAP = 70; // words in the one-sentence spine
const SLACK = 5; // a cap overrun this small is not worth a retry

const EFFORT = { scout: 'high', probe: 'medium', critic: 'medium', reviser: 'medium' };

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
// User and model text enters a template through a sentinel, never through {vars}:
// a brace in the user's words must not be read as a placeholder.
const inject = (id, slots) => {
  let text = renderTemplate(id, Object.fromEntries(Object.keys(slots).map((k) => [k, `@@${k.toUpperCase()}@@`])));
  Object.entries(slots).forEach(([k, v]) => { text = text.split(`@@${k.toUpperCase()}@@`).join(String(v ?? '')); });
  return text;
};

// The skill rides whole, fenced like the library's other specs. Required: a Story Room
// call without its method would silently fall back to the model's habits.
const storySkillLine = async () => {
  await hydrateSkills();
  const s = skillById(STORY_SKILL_ID);
  const text = String(s?.text || '').trim();
  if (!text) throw new Error(`The "${STORY_SKILL_ID}" skill is missing — restore skills/${STORY_SKILL_ID}/SKILL.md or add it in Film Agent → Skills.`);
  return `THE STORY METHOD follows, verbatim. Where it and this instruction disagree on method, the method wins; on output format, this instruction wins.\n\n<<<SPEC name: ${s.name || STORY_SKILL_ID}\n${text}\nSPEC>>>`;
};

// A call that dies after minutes is the route's time ceiling or a dropped connection —
// the client only reports "Request failed", so the clock is the honest signal.
const LONG_CALL_MS = 240000;
const ask = async (ctx, { system, prompt, effort, config, images }) => {
  const t0 = Date.now();
  try {
    const { content } = await ctx.client.reason({ prompt, systemPrompt: system, images, modelId: getModel('reasoner', config), reasoningEffort: effort });
    return String(content || '');
  } catch (err) {
    const ms = Date.now() - t0;
    if (/HEADERS_TIMEOUT|Headers Timeout/i.test(String(err?.message)) || ms > LONG_CALL_MS) {
      const e = new Error(`The planner call failed after ${Math.round(ms / 1000)} s (the route's time limit or a dropped connection). Try again, or lower Reasoning effort in Film Agent → Project.`);
      e.longCall = true;
      throw e;
    }
    throw err;
  }
};

// ---- the gates (code, not model) -------------------------------------------------
export const blueprintProblems = (bp) => {
  if (!bp || typeof bp !== 'object' || Array.isArray(bp)) return ['not a JSON object'];
  const bad = [];
  BLOCKS.forEach((k) => {
    const v = bp[k];
    if (k === 'journey') {
      if (!Array.isArray(v) || v.length < 3 || v.length > 5) bad.push('journey must be a list of 3-5 obstacles');
      else if (v.some((o) => words(o) > BLOCK_CAP + SLACK)) bad.push(`each journey obstacle at most ${BLOCK_CAP} words`);
    } else if (!String(v || '').trim()) bad.push(`${k} is empty`);
    else if (words(v) > BLOCK_CAP + SLACK) bad.push(`${k} is ${words(v)} words (cap ${BLOCK_CAP})`);
  });
  const spine = String(bp.spine || '').trim();
  if (!/^once upon a time/i.test(spine)) bad.push('spine must start "Once upon a time"');
  if (words(spine) > SPINE_CAP + SLACK) bad.push(`spine is ${words(spine)} words (cap ${SPINE_CAP})`);
  return bad;
};

const tidyBlueprint = (bp) => {
  const out = { title: String(bp?.title || '').trim() };
  BLOCKS.forEach((k) => { out[k] = k === 'journey' ? (Array.isArray(bp?.[k]) ? bp[k].map((o) => String(o || '').trim()).filter(Boolean) : []) : String(bp?.[k] || '').trim(); });
  out.spine = String(bp?.spine || '').trim();
  return out;
};

// ---- Scout: N ideas, each built on a code-dealt assignment ------------------------
// The axes live in an editable template so the deck is the user's; code only shuffles
// and deals, which is what keeps N ideas from collapsing onto one premise.
const parseAxes = () => {
  const groups = {};
  let cur = null;
  getTemplateText('story.scout.axes').split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => {
    if (/^[A-Z][A-Z\s]+$/.test(l)) { cur = l.toLowerCase(); groups[cur] = []; } else if (cur) groups[cur].push(l);
  });
  return groups;
};
const shuffled = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
export const dealAssignments = (count) => {
  const axes = parseAxes();
  const deck = (name) => shuffled(axes[name] || []);
  const sit = deck('situations');
  const reg = deck('registers');
  const opp = deck('opposition');
  return Array.from({ length: count }, (_, i) => ({
    situation: sit.length ? sit[i % sit.length] : '',
    register: reg.length ? reg[i % reg.length] : '',
    opposition: opp.length ? opp[i % opp.length] : '',
  }));
};

const IDEA_KEYS = ['title', 'logline', 'place_and_culture', 'what_is_unexpected'];
const ideaProblems = (xs, count) => {
  if (!Array.isArray(xs) || xs.length !== count) return [`return exactly ${count} ideas`];
  const bad = [];
  xs.forEach((x, i) => IDEA_KEYS.forEach((k) => { if (!String(x?.[k] || '').trim()) bad.push(`idea ${i + 1} is missing ${k}`); }));
  const places = xs.map((x) => String(x?.place_and_culture || '').trim().toLowerCase());
  if (new Set(places).size !== places.length) bad.push('two ideas share a place — every idea needs a different place, community or world');
  return bad;
};

export const scoutIdeas = async ({ direction = '', count = 6, config } = {}, ctx) => {
  const deals = dealAssignments(count);
  const assignments = deals.map((d, i) => `${i + 1}. situation: ${d.situation || 'free'} · register: ${d.register || 'free'} · opposition: ${d.opposition || 'free'}`).join('\n');
  const system = renderTemplate('story.scout.system');
  const prompt = inject('story.scout.user', { count, direction: String(direction || '').trim() || '(none)', assignments });
  let ideas = parseJson(await ask(ctx, { system, prompt, effort: EFFORT.scout, config }));
  let bad = ideaProblems(ideas, count);
  if (bad.length) {
    ideas = parseJson(await ask(ctx, { system, prompt: `${prompt}\n\nYOUR LAST ANSWER FAILED THESE CHECKS — fix them: ${bad.join('; ')}`, effort: EFFORT.scout, config }));
    bad = ideaProblems(ideas, count);
  }
  if (!Array.isArray(ideas) || !ideas.length) throw new Error(`The Scout returned no usable ideas${bad.length ? ` (${bad.join('; ')})` : ''}.`);
  return ideas.map((x, i) => ({ ...Object.fromEntries(IDEA_KEYS.map((k) => [k, String(x?.[k] || '').trim()])), assignment: deals[i] || null }));
};

// ---- Originality probe: one call for any number of ideas --------------------------
export const ideaText = (idea) => (typeof idea === 'string' ? idea : [
  idea.title && `Title: ${idea.title}`,
  idea.logline,
  idea.place_and_culture && `Place and culture: ${idea.place_and_culture}`,
  idea.what_is_unexpected && `What is unexpected: ${idea.what_is_unexpected}`,
].filter(Boolean).join('\n'));

export const probeOriginality = async ({ ideas = [], config } = {}, ctx) => {
  if (!ideas.length) return [];
  const listed = ideas.map((x, i) => `IDEA ${i + 1}:\n${ideaText(x)}`).join('\n\n');
  const out = parseJson(await ask(ctx, { system: renderTemplate('story.probe.system'), prompt: inject('story.probe.user', { ideas: listed }), effort: EFFORT.probe, config }));
  const arr = Array.isArray(out) ? out : [];
  return ideas.map((_, i) => {
    const p = arr[i] || {};
    const score = Math.max(0, Math.min(2, Math.round(Number(p.score) || 0)));
    return { closestWork: String(p.closest_work || '').trim(), sharedPremise: String(p.shared_premise || '').trim(), note: String(p.note || '').trim(), score, fresh: score === 2, ok: !!arr[i] };
  });
};

// ---- Architect: the idea → a capped blueprint, one corrective retry ---------------
export const architectBlueprint = async ({ idea = '', config } = {}, ctx) => {
  const text = ideaText(idea).trim();
  if (!text) throw new Error('Write an idea first.');
  const system = renderTemplate('story.architect.system', { skill: await storySkillLine(), cap: BLOCK_CAP, spineCap: SPINE_CAP });
  const prompt = inject('story.architect.user', { idea: text.slice(0, 6000) });
  const effort = getRuntime(config).reasoningEffort;
  let bp = parseJson(await ask(ctx, { system, prompt, effort, config }));
  let problems = blueprintProblems(bp);
  if (problems.length) {
    bp = parseJson(await ask(ctx, { system, prompt: `${prompt}\n\nYOUR LAST ANSWER FAILED THESE CHECKS — fix them: ${problems.join('; ')}`, effort, config }));
    problems = blueprintProblems(bp);
  }
  if (!bp || typeof bp !== 'object') throw new Error('The Architect returned no blueprint — try again.');
  return { blueprint: tidyBlueprint(bp), problems };
};

// ---- Critic: scores + the blocks to fix -------------------------------------------
export const critiqueBlueprint = async ({ blueprint, config } = {}, ctx) => {
  const system = renderTemplate('story.critic.system', { skill: await storySkillLine() });
  const out = parseJson(await ask(ctx, { system, prompt: inject('story.critic.user', { blueprint: JSON.stringify(tidyBlueprint(blueprint), null, 1) }), effort: EFFORT.critic, config }));
  if (!out || typeof out !== 'object') throw new Error('The Critic returned no scores — try again.');
  const items = Object.fromEntries(SCORE_KEYS.map((k) => {
    const x = out[k] || {};
    return [k, { score: Math.max(0, Math.min(2, Math.round(Number(x.score) || 0))), objection: String(x.objection || '').trim(), ...(k === 'originality' ? { closestWork: String(x.closest_work || '').trim(), sharedPremise: String(x.shared_premise || '').trim() } : {}) }];
  }));
  // Only real block names survive; a note on anything else has nowhere to land.
  const fix = Object.fromEntries(Object.entries(out.fix && typeof out.fix === 'object' ? out.fix : {})
    .map(([k, v]) => [String(k).trim().toLowerCase().replace(/[\s-]+/g, '_'), String(v || '').trim()])
    .filter(([k, v]) => BLOCKS.includes(k) && v));
  const total = SCORE_KEYS.reduce((n, k) => n + items[k].score, 0);
  return { items, fix, total, max: SCORE_KEYS.length * 2 };
};

// ---- Fix options: one problem → 3 alternative cascades → a blind judge ------------
// A fix starts at its ROOT block and re-derives every block after it in the skill's
// dependency order, so each option is a whole coherent story — the blocks before the
// root stay word for word. A blind judge ranks the options against the current version;
// the current one stays unless an option beats it, and the filmmaker picks.
const approaches = () => getTemplateText('story.option.approaches').split('\n').map((l) => l.trim()).filter(Boolean);

const writeOption = async ({ blueprint, root, note, approach, config }, ctx) => {
  const base = tidyBlueprint(blueprint);
  const at = BLOCKS.indexOf(root);
  const cascade = BLOCKS.slice(at);
  const system = renderTemplate('story.option.system', { skill: await storySkillLine(), cap: BLOCK_CAP, spineCap: SPINE_CAP });
  const prompt = inject('story.option.user', { blueprint: JSON.stringify(base, null, 1), root, note, cascade: cascade.join(', '), approach });
  const raw = parseJson(await ask(ctx, { system, prompt, effort: 'medium', config })) || {};
  const next = { ...base };
  const changed = [];
  [...cascade, 'spine'].forEach((k) => {
    const v = k === 'journey' ? (Array.isArray(raw[k]) ? raw[k].map((o) => String(o || '').trim()).filter(Boolean) : null) : String(raw[k] || '').trim();
    if (!v || (Array.isArray(v) && !v.length)) return;
    if (JSON.stringify(v) !== JSON.stringify(base[k])) changed.push(k);
    next[k] = v;
  });
  return { blueprint: next, changed, approach };
};

const versionText = (bp, keys) => keys.map((k) => `${k}: ${Array.isArray(bp[k]) ? bp[k].map((o, i) => `(${i + 1}) ${o}`).join(' ') : bp[k]}`).join('\n');

const judgeOptions = async ({ blueprint, options, root, note, config }, ctx) => {
  const keys = [...BLOCKS.slice(BLOCKS.indexOf(root)), 'spine'];
  const versions = [{ id: 'current', bp: tidyBlueprint(blueprint) }, ...options.map((o, i) => ({ id: i, bp: o.blueprint }))];
  const order = versions.map((v, i) => ({ v, r: Math.random(), i })).sort((x, y) => x.r - y.r).map((x) => x.v); // blind: shuffled, neutral labels
  const label = (i) => `V${i + 1}`;
  const listed = order.map((v, i) => `${label(i)}:\n${versionText(v.bp, keys)}`).join('\n\n');
  const out = parseJson(await ask(ctx, { system: renderTemplate('story.option.judge.system'), prompt: inject('story.option.judge.user', { note, versions: listed, before: versionText(tidyBlueprint(blueprint), BLOCKS.slice(0, BLOCKS.indexOf(root))) || '(none)' }), effort: 'medium', config })) || {};
  const idOf = (l) => { const i = Number(String(l || '').replace(/\D/g, '')) - 1; return order[i] ? order[i].id : null; };
  const ranking = (Array.isArray(out.ranking) ? out.ranking : []).map(idOf).filter((x) => x != null);
  const reasons = {};
  Object.entries(out.reasons && typeof out.reasons === 'object' ? out.reasons : {}).forEach(([l, r]) => { const id = idOf(l); if (id != null) reasons[id] = String(r || '').trim(); });
  return { ranking, best: ranking[0] ?? null, reasons };
};

// The flagged problems, root-first: the Critic's fix notes in dependency order.
export const flaggedFixes = (critique) => BLOCKS.filter((k) => critique?.fix?.[k]).map((k) => ({ root: k, note: critique.fix[k] }));

export const fixOptions = async ({ blueprint, root, note, config, onOption } = {}, ctx) => {
  if (!BLOCKS.includes(root)) throw new Error('Pick the block to fix.');
  const list = approaches().slice(0, 3);
  const options = new Array(list.length).fill(null);
  await runWithConcurrency(list.map((approach, i) => async () => {
    try {
      options[i] = await writeOption({ blueprint, root, note, approach, config }, ctx);
      if (onOption) onOption(i, options[i]);
    } catch { /* one failed option leaves the others */ }
  }), 3);
  const got = options.map((o, i) => (o && o.changed.length ? { ...o, index: i } : null)).filter(Boolean);
  if (!got.length) throw new Error('No option came back — try again.');
  let verdict = { ranking: [], best: null, reasons: {} };
  try { verdict = await judgeOptions({ blueprint, options: got, root, note, config }, ctx); } catch { /* the options stand without a ranking */ }
  return { options: got, verdict };
};

// ---- Hand-off: the blueprint as a script the Storyboard can divide ----------------
// Pure code, no model: fields in story order, verbatim.
export const blueprintScript = (bp) => {
  const b = tidyBlueprint(bp);
  const lines = [];
  if (b.title) lines.push(b.title.toUpperCase(), '');
  if (b.spine) lines.push(b.spine, '');
  lines.push(`PROTAGONIST: ${b.protagonist}`, `ANTAGONIST: ${b.antagonist}`, '', 'STORY');
  const beats = [b.inciting_incident, ...b.journey, b.crisis, b.climax, b.resolution].filter(Boolean);
  beats.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  return lines.join('\n').trim();
};

// ---- Visual beat sheet → shot plan → Seedance 2.5 shots, with ASSET BINDING --------
// One asset roster (characters, locations, props), each with a key and a look. A shot
// binds asset keys; its prompt body names assets only as {{KEY}} tokens; code renders
// the final prompt — every bound asset's look written in from the roster, the tokens
// replaced by names. Same look words in every shot by construction; edit a look once and
// every shot follows.
export const SHOT_MODEL = 'seedance25';
export const ASSET_KINDS = ['character', 'location', 'prop'];
const TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export const factList = (facts) => facts.map((f) => `${f.id} [${f.block}, ${f.kind}] ${f.fact}`).join('\n');

const tidyFacts = (raw) => (Array.isArray(raw) ? raw : (raw && Array.isArray(raw.facts) ? raw.facts : []))
  .map((f) => ({
    block: String(f?.block || '').trim().toLowerCase().replace(/[\s-]+/g, '_'),
    kind: String(f?.kind || '').trim().toLowerCase() === 'hear' ? 'hear' : 'see',
    fact: String(f?.fact || '').trim(),
  }))
  .filter((f) => f.fact)
  .map((f, i) => ({ id: `F${i + 1}`, ...f }));

export const storyFacts = async ({ blueprint, config } = {}, ctx) => {
  const system = renderTemplate('story.facts.system', { skill: await storySkillLine() });
  const prompt = inject('story.facts.user', { blueprint: JSON.stringify(tidyBlueprint(blueprint), null, 1) });
  const facts = tidyFacts(parseJson(await ask(ctx, { system, prompt, effort: 'medium', config })));
  if (!facts.length) throw new Error('The beat sheet came back empty — try again.');
  return facts;
};

const keyOf = (s) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
const tidyAssets = (raw) => {
  const seen = new Set();
  return (Array.isArray(raw?.assets) ? raw.assets : []).map((a) => ({
    key: keyOf(a?.key || a?.name),
    kind: ASSET_KINDS.includes(String(a?.kind || '').toLowerCase()) ? String(a.kind).toLowerCase() : 'prop',
    name: String(a?.name || a?.key || '').trim(),
    look: String(a?.look || '').trim(),
  })).filter((a) => a.key && !seen.has(a.key) && seen.add(a.key));
};
const tidyPlan = (raw) => (Array.isArray(raw?.shots) ? raw.shots : []).map((x) => ({
  title: String(x?.title || '').trim(),
  location: keyOf(x?.location),
  assets: [...new Set((Array.isArray(x?.assets) ? x.assets : []).map(keyOf).filter(Boolean))],
  shows: [...new Set((Array.isArray(x?.shows) ? x.shows : []).map((id) => String(id || '').trim().toUpperCase()).filter(Boolean))],
  moment: String(x?.moment || '').trim(),
  body: '',
})).filter((x) => x.title || x.moment);

// The plan: the asset roster + the shots, each binding its assets and its facts.
export const planShots = async ({ blueprint, facts = [], config } = {}, ctx) => {
  const prompt = inject('story.shots.user', { blueprint: JSON.stringify(tidyBlueprint(blueprint), null, 1), facts: factList(facts) });
  const raw = parseJson(await ask(ctx, { system: renderTemplate('story.shots.system'), prompt, effort: 'medium', config }));
  const shots = tidyPlan(raw);
  if (!shots.length) throw new Error('The shot plan came back empty — try again.');
  return { assets: tidyAssets(raw), shots };
};

// Every asset a shot binds: its declared assets, its location, and any {{KEY}} its body
// names — so a token is never left without its look.
export const boundAssets = (shot, assets = []) => {
  const keys = new Set([...(shot.assets || []), shot.location, ...[...String(shot.body || '').matchAll(TOKEN_RE)].map((m) => keyOf(m[1]))].filter(Boolean));
  const order = (a) => (a.kind === 'location' ? 2 : a.kind === 'prop' ? 1 : 0);
  return assets.filter((a) => keys.has(a.key)).sort((a, b) => order(a) - order(b));
};

// The final prompt, rendered by code: the bound assets' looks, the story's Look, then the
// body with each token replaced by the asset's name.
// `refs` = { assetKey: n } for the assets that ride as reference images (@Image n, in the
// card's reference order): those get the Seedance 2.5 spec's role line, then their look.
export const renderShotPrompt = (shot, assets = [], look = '', refs = {}) => {
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  const trim = (t) => String(t || '').trim().replace(/[.\s]+$/, '');
  const defs = boundAssets(shot, assets).map((a) => {
    const n = refs[a.key];
    if (n) return [inject(`story.ref.${a.kind === 'location' ? 'location' : a.kind === 'prop' ? 'prop' : 'character'}`, { name: a.name, n }), trim(a.look)].filter(Boolean).join(' ');
    if (!a.look) return '';
    return a.kind === 'location' ? `Setting — ${a.name}: ${a.look}` : `${a.name}: ${a.look}`;
  }).filter(Boolean);
  const body = String(shot.body || '').replace(TOKEN_RE, (m, k) => byKey[keyOf(k)]?.name || k.replace(/_/g, ' ').toLowerCase()).trim();
  const lookLine = String(look || '').trim() ? `Look: ${String(look).trim().replace(/[.\s]+$/, '')}.` : '';
  return [[...defs.map((d) => (/[.!?]$/.test(d) ? d : `${d}.`)), lookLine].filter(Boolean).join('\n'), body].filter(Boolean).join('\n\n');
};

// ONE shot's body, under the Seedance 2.5 spec (whole). Assets appear only as tokens.
const shotLine = (x, i) => `Shot ${i + 1} · ${x.title}: ${x.moment}`;
// What this shot opens from: the full body of the shot it continues (written first),
// else it opens a new scene.
const previousOf = (shots, index) => {
  const l = linkOf(shots, index);
  if (!l) return index === 0 ? 'This is the opening shot of the film.' : 'This shot opens a new scene.';
  const prev = shots[l.from];
  if (!String(prev.body || '').trim()) throw new Error(`shot ${index + 1} continues shot ${l.from + 1}, which has no prompt yet`);
  return `THE SHOT THIS ONE CONTINUES (shot ${l.from + 1}) — this shot opens exactly where it ends:\n"""\n${prev.body}\n"""`;
};

// The blocking of this shot's scene — every shot is written against it.
const blockingOf = (shots, index) => {
  const start = sceneStartOf(shots, index);
  const sheet = String(shots[start]?.blocking || '').trim();
  if (!sheet) throw new Error(`the scene of shot ${index + 1} is not blocked yet — block it first`);
  return sheet;
};

export const writeShotBody = async ({ blueprint, facts = [], assets = [], shots = [], index, config } = {}, ctx) => {
  const shot = shots[index];
  const bp = tidyBlueprint(blueprint);
  const bound = boundAssets(shot, assets);
  const slots = {
    story: [bp.title, bp.spine].filter(Boolean).join('\n'),
    assets: bound.map((a) => `{{${a.key}}} — ${a.kind}: ${a.name}`).join('\n') || '(none)',
    shot: shotLine(shot, index),
    facts: factList(facts.filter((f) => shot.shows.includes(f.id))) || '(none)',
    neighbours: [index > 0 ? `Before: ${shotLine(shots[index - 1], index - 1)}` : 'This is the opening shot.', index < shots.length - 1 ? `After: ${shotLine(shots[index + 1], index + 1)}` : 'This is the final shot.'].join('\n'),
    previous: previousOf(shots, index),
    blocking: blockingOf(shots, index),
  };
  const system = renderTemplate('story.shot.system', { skill: await requireSkillLine(SHOT_MODEL) });
  const text = await ask(ctx, { system, prompt: inject('story.shot.user', slots), effort: getRuntime(config).reasoningEffort, config });
  return String(text || '').replace(/^```\w*\s*|\s*```$/g, '').trim();
};

// Every shot body. A shot that continues another is written after it and opens where it
// ends; independent shots run three at a time. The links must be set first (detectScenes
// or by hand). onShot(i, shot) fires as each lands.
export const writeShotBodies = async ({ blueprint, facts, assets, shots, config, onShot } = {}, ctx) => {
  const out = shots.map((x) => ({ ...x }));
  const failed = [];
  let active = 0;
  const waiting = [];
  const take = () => new Promise((go) => { if (active < 3) { active += 1; go(); } else waiting.push(go); });
  const give = () => { const next = waiting.shift(); if (next) next(); else active -= 1; };
  const done = [];
  shots.forEach((_, i) => {
    const l = linkOf(shots, i);
    done[i] = (async () => {
      if (l && !(await done[l.from])) { failed.push(`shot ${i + 1}: not written — it continues shot ${l.from + 1}, which failed`); return false; }
      await take();
      try {
        out[i] = { ...out[i], body: await writeShotBody({ blueprint, facts, assets, shots: out, index: i, config }, ctx) };
        if (onShot) onShot(i, out[i]);
        return true;
      } catch (err) {
        failed.push(`shot ${i + 1}: ${err.message || err}`);
        return false;
      } finally { give(); }
    })();
  });
  await Promise.all(done);
  return { shots: out, failed };
};

// RE-OPEN A SHOT FROM THE TAKE IT CONTINUES — a vision call reads that take's real last
// frame and rewrites only this shot's OPENING so it starts from what the frame shows; the
// rest of the prompt stays as written. The plates of this shot AND of the shot it
// continues ride along, so everyone in the frame can be recognised. As the FIRST FRAME the
// opening also states the picture itself (framing, camera direction) and how the shot gets
// from it to its action; as the STATE OF THE SCENE it states positions only. Every asset
// token must survive.
export const reopenShot = async ({ shot, assets = [], frameUrl, mode = 'state', plates = [], fromShot = null, config } = {}, ctx) => {
  const body = String(shot?.body || '').trim();
  if (!body) throw new Error('This shot has no prompt yet.');
  if (!frameUrl) throw new Error('The shot it continues has no take yet.');
  const own = boundAssets(shot, assets);
  const prior = fromShot ? boundAssets(fromShot, assets).filter((a) => !own.some((b) => b.key === a.key)) : [];
  const known = plates.filter((p) => p.url && [...own, ...prior].some((a) => a.key === p.key));
  const text = await ask(ctx, {
    system: renderTemplate('story.reopen.system', { modeRule: renderTemplate(mode === 'open' ? 'story.reopen.open' : 'story.reopen.state') }),
    prompt: inject('story.reopen.user', {
      assets: [
        ...own.map((a) => `{{${a.key}}} — ${a.kind}: ${a.name}`),
        ...prior.map((a) => `{{${a.key}}} — ${a.kind}: ${a.name} (from the shot this one continues; may appear in IMAGE 1)`),
      ].join('\n') || '(none)',
      images: ['image 1 = THE FRAME this shot starts from', ...known.map((p, i) => `image ${i + 2} = {{${p.key}}} — only to recognise it in the frame`)].join('\n'),
      body,
    }),
    images: [frameUrl, ...known.map((p) => p.url)],
    effort: 'medium',
    config,
  });
  const out = String(text || '').replace(/^```\w*\s*|\s*```$/g, '').trim().replace(/^"""\s*|\s*"""$/g, '').trim();
  if (!out) throw new Error('The re-opened prompt came back empty — try again.');
  const tokens = (t) => new Set([...t.matchAll(TOKEN_RE)].map((m) => keyOf(m[1])));
  const lost = [...tokens(body)].filter((k) => !tokens(out).has(k));
  if (lost.length) throw new Error(`The re-opened prompt dropped ${lost.map((k) => `{{${k}}}`).join(', ')} — try again.`);
  return out;
};

// The roster as a Cast & World design — one asset per roster entry, names verbatim (they
// become the plate labels), each plate prompt rendered from the entry's look.
export const castDesignOf = (assets = []) => assets.filter((a) => a.name).map((a) => {
  const v = { name: a.name, look: String(a.look || '').replace(/[.\s]+$/, '') };
  if (a.kind === 'character') return { type: 'character', name: a.name, facePrompt: inject('story.plate.face', v), bodyPrompt: inject('story.plate.body', v) };
  return { type: a.kind === 'location' ? 'location' : 'prop', name: a.name, prompt: inject(a.kind === 'location' ? 'story.plate.location' : 'story.plate.prop', v) };
});

// ---- Look: the story's one visual style ---------------------------------------------
// Presets live in an editable template ("Name: sentence" per line). The Look rides as the
// Cast & World `style` (appended to every plate) and as one line in every shot prompt.
export const lookPresets = () => getTemplateText('story.look.presets').split('\n')
  .map((l) => l.trim()).filter(Boolean)
  .map((l) => { const i = l.indexOf(':'); return i > 0 ? { name: l.slice(0, i).trim(), text: l.slice(i + 1).trim() } : { name: l, text: l }; });

// Reference images (+ the user's own notes) → one style sentence: what the references
// SHARE, never their subjects. The planner reads the images; medium effort.
export const describeLook = async ({ images = [], notes = '', config } = {}, ctx) => {
  const imgs = images.filter(Boolean);
  if (!imgs.length) throw new Error('Add a reference image first.');
  const prompt = inject('story.look.describe.user', { count: imgs.length, notes: String(notes || '').trim() || '(none)' });
  const text = await ask(ctx, { system: renderTemplate('story.look.describe.system'), prompt, images: imgs, effort: 'medium', config });
  const out = String(text || '').replace(/^```\w*\s*|\s*```$/g, '').trim();
  if (!out) throw new Error('The style description came back empty — try again.');
  return out;
};

// ---- Scenes and continuity links ---------------------------------------------------
// ONE continuity control per shot — its LINK: the earlier shot it continues (that take's
// last frame rides into it, as the state of the scene or as its first frame), or none:
// it opens a new scene. Scenes are where the links break. The scene pass sets the links
// it is allowed to; a link you set (user) is yours and the pass leaves it.
const plainBody = (shot, assets) => {
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  return String(shot.body || shot.moment || '').replace(TOKEN_RE, (m, k) => byKey[keyOf(k)]?.name || k).replace(/\s+/g, ' ').trim();
};

export const LINK_MODES = ['state', 'open'];
// The filmmaker's own wording for how the frame is used. Stored with {frame} where the
// frame is cited; the board writes its @ImageN there.
export const FRAME_TOKEN = '{frame}';
export const linkTextOf = (raw = '') => {
  const t = String(raw || '').trim().replace(/@Image\d+|@Frame/g, FRAME_TOKEN);
  if (!t) return '';
  return t.includes(FRAME_TOKEN) ? t : `${FRAME_TOKEN}: ${t}`;
};
// A link is decided once the pass or you set it (shots from before links were stored keep
// their scene verdict: continuing = the shot before, as state).
const decided = (x) => !!(x?.link && 'from' in x.link) || typeof x?.newScene === 'boolean';
export const linkOf = (shots = [], i) => {
  const own = shots[i]?.link;
  if (own && 'from' in own) {
    const from = Number.isInteger(own.from) && own.from >= 0 && own.from < i ? own.from : null;
    return from == null ? null : { from, mode: LINK_MODES.includes(own.mode) ? own.mode : 'state', text: String(own.text || ''), user: !!own.user };
  }
  return i > 0 && shots[i]?.newScene === false ? { from: i - 1, mode: 'state', text: '', user: false } : null;
};
export const scenesFound = (shots = []) => shots.slice(1).every(decided);
// Scene number (1-based) per shot: a decided shot without a link opens a scene.
export const sceneNumbers = (shots = []) => {
  let n = 0;
  return shots.map((x, i) => {
    if (i === 0 || (decided(x) && !linkOf(shots, i))) n += 1;
    return n;
  });
};

export const detectScenes = async ({ shots = [], assets = [], config } = {}, ctx) => {
  if (!shots.length) return shots;
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  const mine = (x) => !!(x.link?.user || x.sceneUser);
  const listed = shots.map((x, i) => {
    const words = plainBody(x, assets).split(' ').slice(0, 40).join(' ');
    const who = (x.assets || []).map((k) => byKey[k]).filter((a) => a && a.kind !== 'location').map((a) => a.name).join(', ');
    return `${i + 1}. @ ${byKey[x.location]?.name || x.location || 'unknown place'}${who ? ` — with ${who}` : ''}: ${words}`;
  }).join('\n');
  const out = parseJson(await ask(ctx, { system: renderTemplate('story.scenes.system'), prompt: inject('story.scenes.user', { shots: listed }), effort: 'low', config }));
  const rows = Array.isArray(out) ? out : [];
  // Every shot needs the model's verdict — a gap is an error, never a guess.
  const missing = shots.map((x, i) => i).filter((i) => i > 0 && !mine(shots[i])
    && !rows.some((y) => Number(y?.shot) === i + 1 && typeof y?.newScene === 'boolean' && String(y?.reason || '').trim()));
  if (missing.length) throw new Error(`The scene pass gave no verdict for shot${missing.length === 1 ? '' : 's'} ${missing.map((i) => i + 1).join(', ')} — run Scenes ↻ again.`);
  return shots.map((x, i) => {
    if (mine(x)) return x;
    const { newScene, ...rest } = x;
    if (i === 0) return { ...rest, link: { from: null }, sceneReason: 'Opens the film.' };
    const r = rows.find((y) => Number(y?.shot) === i + 1);
    const keep = x.link || {};
    return { ...rest, link: { from: r.newScene ? null : i - 1, mode: LINK_MODES.includes(keep.mode) ? keep.mode : 'state', text: String(keep.text || '') }, sceneReason: String(r.reason).trim() };
  });
};
// ---- Blocking: the scene staged once, before any shot ------------------------------
// One short sheet per scene, kept on the shot that opens it — the MARKS (named spots in
// the place, each with where it is), every character's PATH across those marks in order,
// and the AXIS (the line of action and the side the cameras keep to). Every shot of the
// scene is written against it: a mark fixes where a person IS, as a plate fixes how they
// LOOK. Plain lines, editable:
//   MARKS: door (front wall, left) · pillar 2 (centre-right) · counter (back wall)
//   {{KAEL}}: door → pillar 2 → counter
//   AXIS: Kael ↔ Jinn; cameras stay on the entrance side
export const sceneStartOf = (shots = [], i) => {
  const nums = sceneNumbers(shots);
  return nums.findIndex((n) => n === nums[i]);
};
export const sceneShotsOf = (shots = [], start) => {
  const nums = sceneNumbers(shots);
  return shots.map((x, i) => i).filter((i) => nums[i] === nums[start]);
};
// The sheet → { marks: [{ name, where }], paths: [{ key, marks }], axis }. A line that does
// not read is an error naming it — the sheet is the scene's truth, never guessed at.
export const parseBlocking = (text = '') => {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { marks: [], paths: [], axis: '' };
  lines.forEach((line) => {
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (!m) throw new Error(`Blocking line does not read: "${line}"`);
    const head = m[1].trim();
    const rest = m[2].trim();
    if (/^marks$/i.test(head)) {
      out.marks = rest.split('·').map((x) => x.trim()).filter(Boolean).map((x) => {
        const w = /^(.+?)\s*\((.+)\)$/.exec(x);
        return w ? { name: w[1].trim(), where: w[2].trim() } : { name: x, where: '' };
      });
    } else if (/^axis$/i.test(head)) {
      out.axis = rest;
    } else {
      const key = keyOf((/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/.exec(head) || [])[1] || '');
      if (!key) throw new Error(`Blocking line does not name a character token: "${line}"`);
      out.paths.push({ key, marks: rest.split('→').map((x) => x.trim()).filter(Boolean) });
    }
  });
  if (!out.marks.length) throw new Error('The blocking has no MARKS line.');
  if (!out.axis) throw new Error('The blocking has no AXIS line.');
  const names = new Set(out.marks.map((x) => x.name.toLowerCase()));
  out.paths.forEach((p) => p.marks.forEach((mk) => {
    if (!names.has(mk.toLowerCase())) throw new Error(`{{${p.key}}} goes to "${mk}", which is not one of the MARKS.`);
  }));
  return out;
};

// BLOCK ONE SCENE — one planner call: the marks, each character's path, the axis, from
// the scene's shots. The sheet must read and use only the scene's cast.
export const blockScene = async ({ shots = [], start, assets = [], config } = {}, ctx) => {
  const idx = sceneShotsOf(shots, start);
  const scene = idx.map((i) => shots[i]);
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  const place = byKey[scene[0]?.location];
  const cast = [...new Set(scene.flatMap((x) => (x.assets || []).filter((k) => byKey[k]?.kind === 'character')))];
  if (!cast.length) throw new Error(`Scene from SH ${start + 1} has no characters to block.`);
  const listed = idx.map((i) => `SH ${i + 1} · ${shots[i].title}: ${plainBody(shots[i], assets)}`).join('\n');
  const text = await ask(ctx, {
    system: renderTemplate('story.block.system'),
    prompt: inject('story.block.user', {
      place: place ? `${place.name}${place.look ? ` — ${place.look}` : ''}` : (scene[0]?.location || '(not stated)'),
      cast: cast.map((k) => `{{${k}}} — ${byKey[k].name}`).join('\n'),
      shots: listed,
    }),
    effort: 'medium',
    config,
  });
  const sheet = String(text || '').replace(/^```\w*\s*|\s*```$/g, '').trim();
  const parsed = parseBlocking(sheet);
  const stray = parsed.paths.map((p) => p.key).filter((k) => !cast.includes(k));
  if (stray.length) throw new Error(`The blocking names ${stray.map((k) => `{{${k}}}`).join(', ')}, who is not in this scene — try again.`);
  const missing = cast.filter((k) => !parsed.paths.some((p) => p.key === k));
  if (missing.length) throw new Error(`The blocking leaves out ${missing.map((k) => `{{${k}}}`).join(', ')} — try again.`);
  return sheet;
};

// The sheet as a Previz plan, so the schematic draws it: marks = the set, paths = the
// moves, colours dealt in path order (the same colours as every Previz plate).
export const blockingPlan = (sheet, assets = []) => {
  const b = parseBlocking(sheet);
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  const COLORS = ['BLUE', 'GREEN', 'YELLOW', 'RED', 'PURPLE', 'ORANGE'];
  if (b.paths.length > COLORS.length) throw new Error(`The blocking has ${b.paths.length} characters; the schematic tells at most ${COLORS.length} apart.`);
  const nameOf = (k) => byKey[k]?.name || k;
  return {
    scene: '', axis: b.axis,
    set: b.marks.map((m) => ({ name: m.name, where: m.where })),
    actors: b.paths.map((p, i) => ({ name: nameOf(p.key), description: '', start: p.marks[0] || '', color: COLORS[i] })),
    shots: b.paths.filter((p) => p.marks.length > 1).map((p) => ({ camera: {}, action: `${nameOf(p.key)} moves ${p.marks.join(' → ')}`, seconds: 1 })),
  };
};
// ---- Cards: the unit of generation --------------------------------------------------
// A scene goes to Seedance as ONE generation: its shots are the "Shot N" lines of one
// prompt, and inside one generation the model keeps one world across the cuts. A scene
// longer than one generation splits where a shot starts the next card (newCard); that
// card opens from the last frame of the card before it.
export const CARD_MAX_SECONDS = 30;
export const cardsOf = (shots = []) => {
  const nums = sceneNumbers(shots);
  const out = [];
  shots.forEach((x, i) => {
    const opensScene = i === 0 || nums[i] !== nums[i - 1];
    if (opensScene || x.newCard) out.push({ start: i, end: i, scene: nums[i], opensScene });
    else out[out.length - 1].end = i;
  });
  return out.map((c, k) => ({ ...c, k, idx: shots.map((_, i) => i).filter((i) => i >= c.start && i <= c.end) }));
};
export const secondsOfCard = (shots, card) => card.idx.reduce((n, i) => n + (Number(shots[i].seconds) || 0), 0);
// The card's shots as one shot for binding: its place and everyone and everything in it.
export const cardAsShot = (shots, card) => ({
  location: shots[card.start].location,
  assets: [...new Set(card.idx.flatMap((i) => shots[i].assets || []))],
});

// The blocking sheet as the prompt's Staging line (code, word for word from the sheet).
const stagingOf = (sheet, assets) => {
  const b = parseBlocking(sheet);
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  const who = b.paths.map((p) => `${byKey[p.key]?.name || p.key} ${p.marks.length > 1 ? `moves ${p.marks.join(' → ')}` : `stays at ${p.marks[0]}`}`).join('; ');
  const marks = b.marks.map((m) => (m.where ? `${m.name} (${m.where})` : m.name)).join('; ');
  return `Staging: ${who}. Marks: ${marks}. Axis: ${b.axis.replace(/[.\s]+$/, '')}.`;
};

// THE CARD'S PROMPT — plate lines, Look, Staging (from the blocking), then one "Shot N:"
// line per shot (tokens → names), then the one-world line.
export const renderCardPrompt = ({ shots, card, assets = [], look = '', refs = {} }) => {
  const head = renderShotPrompt({ ...cardAsShot(shots, card), body: '' }, assets, look, refs);
  const sheet = String(shots[sceneStartOf(shots, card.start)]?.blocking || '').trim();
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  const named = (t) => String(t || '').replace(TOKEN_RE, (m, k) => byKey[keyOf(k)]?.name || k.replace(/_/g, ' ').toLowerCase()).trim();
  const lines = card.idx.map((i, n) => `Shot ${n + 1}: ${named(shots[i].line)}`);
  return [head, sheet ? stagingOf(sheet, assets) : '', '', ...lines, renderTemplate('story.card.tail')].filter((x, n) => x || n === 2).join('\n').trim();
};

// WRITE ONE CARD — one planner call: every shot of the card as one line (framing + what
// happens) with its seconds, against the scene's blocking; a card that continues the
// one before it opens where that one ends. The answer must cover every shot, use only
// the story's tokens and fit one generation.
export const writeCard = async ({ blueprint, facts = [], assets = [], shots = [], card, config } = {}, ctx) => {
  const bp = tidyBlueprint(blueprint);
  const sheet = String(shots[sceneStartOf(shots, card.start)]?.blocking || '').trim();
  if (!sheet) throw new Error(`the scene of SH ${card.start + 1} is not blocked yet — block it first`);
  const bound = boundAssets(cardAsShot(shots, card), assets);
  const before = card.opensScene ? null : cardsOf(shots).find((c) => c.end === card.start - 1);
  if (before && before.idx.some((i) => !String(shots[i].line || '').trim())) throw new Error(`the card before SH ${card.start + 1} is not written yet`);
  const text = await ask(ctx, {
    system: renderTemplate('story.card.system', { skill: await requireSkillLine(SHOT_MODEL), maxSeconds: String(CARD_MAX_SECONDS) }),
    prompt: inject('story.card.user', {
      story: [bp.title, bp.spine].filter(Boolean).join('\n'),
      assets: bound.map((a) => `{{${a.key}}} — ${a.kind}: ${a.name}`).join('\n') || '(none)',
      blocking: sheet,
      shots: card.idx.map((i) => `SH ${i + 1} · ${shots[i].title}: ${shots[i].moment}${(shots[i].shows || []).length ? ` — shows: ${factList(facts.filter((f) => shots[i].shows.includes(f.id))).replace(/\n/g, ' ')}` : ''}`).join('\n'),
      before: before ? before.idx.map((i) => `SH ${i + 1}: ${shots[i].line}`).join('\n') : 'This card opens the scene.',
    }),
    effort: getRuntime(config).reasoningEffort,
    config,
  });
  const rows = String(text || '').split('\n').map((l) => /^\s*SH\s*(\d+)\s*\((\d+)\s*s\)\s*:\s*(.+)$/i.exec(l)).filter(Boolean)
    .map((m) => ({ i: Number(m[1]) - 1, seconds: Number(m[2]), line: m[3].trim() }));
  const missing = card.idx.filter((i) => !rows.some((r) => r.i === i));
  if (missing.length) throw new Error(`The card came back without SH ${missing.map((i) => i + 1).join(', SH ')} — write it again.`);
  const known = new Set(assets.map((a) => a.key));
  const stray = [...new Set(rows.flatMap((r) => [...r.line.matchAll(TOKEN_RE)].map((m) => keyOf(m[1]))).filter((k) => !known.has(k)))];
  if (stray.length) throw new Error(`The card names ${stray.map((k) => `{{${k}}}`).join(', ')}, which is not in the story — write it again.`);
  const total = card.idx.reduce((n, i) => n + rows.find((r) => r.i === i).seconds, 0);
  if (total > CARD_MAX_SECONDS) throw new Error(`The card runs ${total}s — over the ${CARD_MAX_SECONDS}s of one generation. Start the next card at a later shot ("Next card from here"), then write it again.`);
  return card.idx.map((i) => ({ i, ...rows.find((r) => r.i === i) }));
};

// Every card, in order where one continues another (scenes run three at a time).
export const writeCards = async ({ blueprint, facts, assets, shots, config, onCard } = {}, ctx) => {
  let out = shots.map((x) => ({ ...x }));
  const cards = cardsOf(shots);
  const failed = [];
  const byScene = Object.values(cards.reduce((m, c) => ({ ...m, [c.scene]: [...(m[c.scene] || []), c] }), {}));
  await runWithConcurrency(byScene.map((chain) => async () => {
    for (const card of chain) { // eslint-disable-line no-restricted-syntax
      try {
        const rows = await writeCard({ blueprint, facts, assets, shots: out, card, config }, ctx); // eslint-disable-line no-await-in-loop
        out = out.map((x, i) => { const r = rows.find((y) => y.i === i); return r ? { ...x, line: r.line, seconds: r.seconds } : x; });
        if (onCard) onCard(rows);
      } catch (err) {
        failed.push(`card from SH ${card.start + 1}: ${err.message || err}`);
        return;
      }
    }
  }), 3);
  return { shots: out, failed };
};


