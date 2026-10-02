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
// The writing calls: a long-call failure retries ONCE at medium, and says so through
// onNote — a slower answer beats none, but never silently.
const askLong = async (ctx, { system, prompt, effort, config, onNote }) => {
  try {
    return await ask(ctx, { system, prompt, effort, config });
  } catch (err) {
    if (!err.longCall || ['medium', 'low', 'minimal'].includes(effort)) throw err;
    if (onNote) onNote(`A call failed after minutes at ${effort} effort — retrying at medium.`);
    return ask(ctx, { system, prompt, effort: 'medium', config });
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
export const writeShotBody = async ({ blueprint, facts = [], assets = [], shots = [], index, config, onNote } = {}, ctx) => {
  const shot = shots[index];
  const bp = tidyBlueprint(blueprint);
  const bound = boundAssets(shot, assets);
  const slots = {
    story: [bp.title, bp.spine].filter(Boolean).join('\n'),
    assets: bound.map((a) => `{{${a.key}}} — ${a.kind}: ${a.name}`).join('\n') || '(none)',
    shot: shotLine(shot, index),
    facts: factList(facts.filter((f) => shot.shows.includes(f.id))) || '(none)',
    neighbours: [index > 0 ? `Before: ${shotLine(shots[index - 1], index - 1)}` : 'This is the opening shot.', index < shots.length - 1 ? `After: ${shotLine(shots[index + 1], index + 1)}` : 'This is the final shot.'].join('\n'),
  };
  const system = renderTemplate('story.shot.system', { skill: await requireSkillLine(SHOT_MODEL) });
  const text = await askLong(ctx, { system, prompt: inject('story.shot.user', slots), effort: getRuntime(config).reasoningEffort, config, onNote });
  return String(text || '').replace(/^```\w*\s*|\s*```$/g, '').trim();
};

// Every shot body, three at a time; onShot(i, shot) fires as each lands.
export const writeShotBodies = async ({ blueprint, facts, assets, shots, config, onNote, onShot } = {}, ctx) => {
  const out = shots.map((x) => ({ ...x }));
  const failed = [];
  await runWithConcurrency(shots.map((_, i) => async () => {
    try {
      out[i] = { ...out[i], body: await writeShotBody({ blueprint, facts, assets, shots: out, index: i, config, onNote }, ctx) };
      if (onShot) onShot(i, out[i]);
    } catch (err) {
      failed.push(`shot ${i + 1}: ${err.message || err}`);
    }
  }), 3);
  return { shots: out, failed };
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

// ---- Scenes: where the story changes place or time --------------------------------
// A light pass over the written shots marks scene breaks. Inside a scene each shot's
// CONSISTENCY ASSET is the previous shot in that scene — its take's end frame; a shot
// that opens a scene needs none. A break the user set by hand (sceneUser) is kept.
const plainBody = (shot, assets) => {
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  return String(shot.body || shot.moment || '').replace(TOKEN_RE, (m, k) => byKey[keyOf(k)]?.name || k).replace(/\s+/g, ' ').trim();
};

export const detectScenes = async ({ shots = [], assets = [], config } = {}, ctx) => {
  if (!shots.length) return shots;
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  const listed = shots.map((x, i) => {
    const words = plainBody(x, assets).split(' ').slice(0, 40).join(' ');
    const who = (x.assets || []).map((k) => byKey[k]).filter((a) => a && a.kind !== 'location').map((a) => a.name).join(', ');
    return `${i + 1}. @ ${byKey[x.location]?.name || x.location || 'unknown place'}${who ? ` — with ${who}` : ''}: ${words}`;
  }).join('\n');
  const out = parseJson(await ask(ctx, { system: renderTemplate('story.scenes.system'), prompt: inject('story.scenes.user', { shots: listed }), effort: 'low', config }));
  const rows = Array.isArray(out) ? out : [];
  return shots.map((x, i) => {
    if (x.sceneUser) return x;
    if (i === 0) return { ...x, newScene: true, sceneReason: 'Opens the film.' };
    const r = rows.find((y) => Number(y?.shot) === i + 1);
    const fallback = x.location !== shots[i - 1].location;
    return { ...x, newScene: r ? !!r.newScene : fallback, sceneReason: String(r?.reason || (fallback ? 'The place changes.' : 'Same place.')).trim() };
  });
};

// Scene number (1-based) for every shot; a shot without a verdict yet breaks only on a
// change of place.
export const sceneNumbers = (shots = []) => {
  let n = 0;
  return shots.map((x, i) => {
    const breaks = i === 0 || (typeof x.newScene === 'boolean' ? x.newScene : x.location !== shots[i - 1]?.location);
    if (breaks) n += 1;
    return n;
  });
};

// The shot whose end this shot must inherit: the previous shot in the same scene.
export const consistencyFrom = (shots = [], i) => {
  const scenes = sceneNumbers(shots);
  return i > 0 && scenes[i] === scenes[i - 1] ? i - 1 : null;
};
