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
const ask = async (ctx, { system, prompt, effort, config }) => {
  const t0 = Date.now();
  try {
    const { content } = await ctx.client.reason({ prompt, systemPrompt: system, modelId: getModel('reasoner', config), reasoningEffort: effort });
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

// ---- Reviser: a patch for the flagged blocks, merged by code ----------------------
// The Reviser may only touch the blocks it was handed (plus the spine); everything else
// is locked here, whatever the model returns.
export const reviseBlueprint = async ({ blueprint, fix = {}, config } = {}, ctx) => {
  const targets = Object.keys(fix).filter((k) => BLOCKS.includes(k));
  if (!targets.length) return { blueprint, changed: [], ignored: [], problems: blueprintProblems(blueprint) };
  const base = tidyBlueprint(blueprint);
  const system = renderTemplate('story.reviser.system', { skill: await storySkillLine(), cap: BLOCK_CAP, spineCap: SPINE_CAP });
  const notes = targets.map((k) => `- ${k}: ${fix[k]}`).join('\n');
  const prompt = inject('story.reviser.user', { blueprint: JSON.stringify(base, null, 1), notes });
  const allowed = new Set([...targets, 'spine']);
  const merge = (patch) => {
    const next = { ...base };
    const changed = [];
    const ignored = [];
    Object.entries(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}).forEach(([k0, v]) => {
      const k = String(k0).trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (!allowed.has(k)) { ignored.push(k); return; }
      const val = k === 'journey' ? (Array.isArray(v) ? v.map((o) => String(o || '').trim()).filter(Boolean) : null) : String(v || '').trim();
      if (!val || (Array.isArray(val) && !val.length)) return;
      next[k] = val;
      changed.push(k);
    });
    return { next, changed, ignored };
  };
  let m = merge(parseJson(await ask(ctx, { system, prompt, effort: EFFORT.reviser, config })));
  let problems = blueprintProblems(m.next);
  if (!m.changed.length || problems.length) {
    const why = !m.changed.length ? 'you returned none of the blocks you were asked to rewrite' : problems.join('; ');
    const retry = merge(parseJson(await ask(ctx, { system, prompt: `${prompt}\n\nYOUR LAST ANSWER FAILED THESE CHECKS — fix them: ${why}`, effort: EFFORT.reviser, config })));
    if (retry.changed.length) { m = retry; problems = blueprintProblems(m.next); }
  }
  return { blueprint: m.next, changed: m.changed, ignored: m.ignored, problems };
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

// ---- Visual beat sheet → Seedance 2.5 shots → proof -------------------------------
// The beat sheet is the CONTRACT: the facts a viewer must see or hear to follow the
// story. Shots claim facts; coverage is checked in code, and a claim counts only when
// the Verifier quotes the prompt's own words for it AND those words are really there.
export const SHOT_MODEL = 'seedance25';
const SHOT_WORD_CAP = 300;
const MIN_QUOTE_CHARS = 12;
const TIMESTAMP_RE = /\b\d+(?:\.\d+)?\s*[-–~]\s*\d+(?:\.\d+)?\s*(?:s|sec|secs|seconds)\b/i;
const INTERIOR_RE = /\b(feels?|felt|realiz(?:es|ed|e)|understands?|understood|learns?|learned|believes?|believed|decides?|decided|knows?|knew|wants?|wanted|thinks?|thought)\b/i;
const unquoted = (s) => String(s || '').replace(/["“][^"”]*["”]/g, ' ');
const normQuote = (s) => String(s || '').toLowerCase().replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

export const factList = (facts) => facts.map((f) => `${f.id} [${f.block}, ${f.kind}] ${f.fact}`).join('\n');

const tidyFacts = (raw) => (Array.isArray(raw) ? raw : (raw && Array.isArray(raw.facts) ? raw.facts : []))
  .map((f) => ({
    block: String(f?.block || '').trim().toLowerCase().replace(/[\s-]+/g, '_'),
    kind: String(f?.kind || '').trim().toLowerCase() === 'hear' ? 'hear' : 'see',
    fact: String(f?.fact || '').trim(),
  }))
  .filter((f) => f.fact)
  .map((f, i) => ({ id: `F${i + 1}`, ...f })); // ids are code's: sequential by construction

const factProblems = (facts) => {
  if (!facts.length) return ['return a JSON list of facts'];
  const bad = [];
  const unknown = [...new Set(facts.filter((f) => !BLOCKS.includes(f.block)).map((f) => f.block || '(none)'))];
  if (unknown.length) bad.push(`unknown block names: ${unknown.join(', ')}`);
  const missing = BLOCKS.filter((b) => !facts.some((f) => f.block === b));
  if (missing.length) bad.push(`no fact for: ${missing.join(', ')}`);
  const interior = facts.filter((f) => INTERIOR_RE.test(unquoted(f.fact)));
  if (interior.length) bad.push(`interior, not observable — rewrite each as what we see or hear: ${interior.map((f) => `${f.id} "${f.fact}"`).join('; ')}`);
  return bad;
};

export const storyFacts = async ({ blueprint, config, onNote } = {}, ctx) => {
  const system = renderTemplate('story.facts.system', { skill: await storySkillLine() });
  const prompt = inject('story.facts.user', { blueprint: JSON.stringify(tidyBlueprint(blueprint), null, 1) });
  const effort = getRuntime(config).reasoningEffort;
  let facts = tidyFacts(parseJson(await askLong(ctx, { system, prompt, effort, config, onNote })));
  let problems = factProblems(facts);
  if (problems.length) {
    const again = tidyFacts(parseJson(await askLong(ctx, { system, prompt: `${prompt}\n\nYOUR LAST ANSWER FAILED THESE CHECKS — fix them: ${problems.join('; ')}`, effort, config, onNote })));
    if (again.length) { facts = again; problems = factProblems(facts); }
  }
  if (!facts.length) throw new Error('The beat sheet came back empty — try again.');
  return { facts, problems };
};

const tidyCast = (raw) => (Array.isArray(raw?.cast) ? raw.cast : [])
  .map((c) => ({ name: String(c?.name || '').trim(), look: String(c?.look || '').trim() }))
  .filter((c) => c.name);
const tidyShows = (list) => [...new Set((Array.isArray(list) ? list : []).map((x) => String(x || '').trim().toUpperCase()).filter(Boolean))];
const tidyPlan = (raw) => (Array.isArray(raw?.shots) ? raw.shots : [])
  .map((x) => ({ title: String(x?.title || '').trim(), location: String(x?.location || '').trim(), moment: String(x?.moment || '').trim(), shows: tidyShows(x?.shows), prompt: '', proofs: {}, verified: false }))
  .filter((x) => x.title || x.moment);

// The plan's gates: every fact in a shot, only real ids, story order, a place per shot.
export const planProblems = (shots, facts, cast = []) => {
  if (!shots.length) return ['return at least one shot'];
  const ids = facts.map((f) => f.id);
  const bad = [];
  const unknown = [...new Set(shots.flatMap((x) => x.shows.filter((id) => !ids.includes(id))))];
  if (unknown.length) bad.push(`unknown fact ids: ${unknown.join(', ')}`);
  const covered = new Set(shots.flatMap((x) => x.shows));
  const uncovered = ids.filter((id) => !covered.has(id));
  if (uncovered.length) bad.push(`no shot shows: ${uncovered.join(', ')}`);
  let prevFirst = -1;
  shots.forEach((x, i) => {
    const firsts = x.shows.map((id) => ids.indexOf(id)).filter((n) => n >= 0);
    if (firsts.length) {
      const first = Math.min(...firsts);
      if (first < prevFirst) bad.push(`shot ${i + 1} goes back in story order`);
      prevFirst = first;
    }
    if (!x.location) bad.push(`shot ${i + 1} has no location`);
  });
  cast.filter((c) => !c.look).forEach((c) => bad.push(`cast member ${c.name} has no look`));
  return bad;
};
// One prompt's gates: the spec forbids invented timestamps; a shot is not an essay.
export const promptProblems = (prompt) => {
  const bad = [];
  if (!String(prompt || '').trim()) bad.push('the prompt is empty');
  if (words(prompt) > SHOT_WORD_CAP) bad.push(`it is ${words(prompt)} words (cap ${SHOT_WORD_CAP})`);
  if (TIMESTAMP_RE.test(prompt)) bad.push('it carries invented timestamps (the spec forbids them)');
  return bad;
};

// Step 2a — the plan: shots + which facts each shows + the cast sheet. Short output, so
// it stays fast; the prompts are written per shot after it.
export const planShots = async ({ blueprint, facts = [], config, onNote } = {}, ctx) => {
  if (!facts.length) throw new Error('Write the beat sheet first.');
  const system = renderTemplate('story.shots.system');
  const prompt = inject('story.shots.user', { blueprint: JSON.stringify(tidyBlueprint(blueprint), null, 1), facts: factList(facts) });
  const effort = getRuntime(config).reasoningEffort;
  let raw = parseJson(await askLong(ctx, { system, prompt, effort, config, onNote }));
  let shots = tidyPlan(raw);
  let cast = tidyCast(raw);
  let problems = planProblems(shots, facts, cast);
  if (problems.length) {
    raw = parseJson(await askLong(ctx, { system, prompt: `${prompt}\n\nYOUR LAST ANSWER FAILED THESE CHECKS — fix them: ${problems.join('; ')}`, effort, config, onNote }));
    const again = tidyPlan(raw);
    if (again.length) { shots = again; cast = tidyCast(raw).length ? tidyCast(raw) : cast; problems = planProblems(shots, facts, cast); }
  }
  if (!shots.length) throw new Error('The shot plan came back empty — try again.');
  return { cast, shots, problems };
};

// Step 2b — ONE shot's Seedance 2.5 prompt, under the sd25-pe spec (whole). `missing`
// = facts a previous prompt failed to show; they are named in the retry note.
const shotLine = (x, i) => `Shot ${i + 1} · ${x.title} @ ${x.location}: ${x.moment}`;
export const writeShotPrompt = async ({ blueprint, facts = [], cast = [], shots = [], index, missing = [], config, onNote } = {}, ctx) => {
  const shot = shots[index];
  const bp = tidyBlueprint(blueprint);
  const mine = facts.filter((f) => shot.shows.includes(f.id));
  const neighbours = [index > 0 ? `Before: ${shotLine(shots[index - 1], index - 1)}` : 'This is the opening shot.', index < shots.length - 1 ? `After: ${shotLine(shots[index + 1], index + 1)}` : 'This is the final shot.'].join('\n');
  const slots = (retry) => ({
    story: [bp.title, bp.spine].filter(Boolean).join('\n'),
    cast: cast.map((c) => `${c.name}: ${c.look}`).join('\n') || '(none)',
    shot: shotLine(shot, index),
    facts: factList(mine) || '(none)',
    neighbours,
    retry,
  });
  const system = renderTemplate('story.shot.system', { skill: await requireSkillLine(SHOT_MODEL) });
  const effort = getRuntime(config).reasoningEffort;
  const firstNote = missing.length ? `\n\nYOUR LAST PROMPT FOR THIS SHOT DID NOT SHOW: ${factList(facts.filter((f) => missing.includes(f.id)))} — make each of them visible or audible.` : '';
  const clean = (t) => String(t || '').replace(/^```\w*\s*|\s*```$/g, '').trim();
  let text = clean(await askLong(ctx, { system, prompt: inject('story.shot.user', slots(firstNote)), effort, config, onNote }));
  let problems = promptProblems(text);
  if (problems.length) {
    const again = clean(await askLong(ctx, { system, prompt: inject('story.shot.user', slots(`${firstNote}\n\nYOUR LAST ANSWER FAILED THESE CHECKS — fix them: ${problems.join('; ')}`)), effort, config, onNote }));
    if (again) { text = again; problems = promptProblems(text); }
  }
  return { prompt: text, problems };
};

// Every shot's prompt, three at a time (more parallel high-effort calls stall upstream).
// onShot(i, result) fires as each lands, so the UI fills in shot by shot.
export const writeShotPrompts = async ({ blueprint, facts, cast, shots, only = null, missingByShot = {}, config, onNote, onShot } = {}, ctx) => {
  const out = shots.map((x) => ({ ...x }));
  const problems = [];
  const idx = only || shots.map((_, i) => i);
  await runWithConcurrency(idx.map((i) => async () => {
    try {
      const r = await writeShotPrompt({ blueprint, facts, cast, shots: out, index: i, missing: missingByShot[i] || [], config, onNote }, ctx);
      out[i] = { ...out[i], prompt: r.prompt, proofs: {}, verified: false };
      r.problems.forEach((p) => problems.push(`shot ${i + 1}: ${p}`));
      if (onShot) onShot(i, out[i]);
    } catch (err) {
      problems.push(`shot ${i + 1}: ${err.message || err}`);
    }
  }), 3);
  return { shots: out, problems };
};

// The proof: per claimed fact, the Verifier quotes the prompt; code keeps the quote only
// when it really is in that prompt. `only` = shot indices to (re)check; others untouched.
export const verifyShots = async ({ facts = [], shots = [], only = null, config } = {}, ctx) => {
  const idx = (only || shots.map((_, i) => i)).filter((i) => shots[i] && shots[i].shows.length && shots[i].prompt);
  if (!idx.length) return shots;
  const listed = idx.map((i) => `SHOT ${i + 1} — claims ${shots[i].shows.join(', ')}:\n${shots[i].prompt}`).join('\n\n');
  const claimed = facts.filter((f) => idx.some((i) => shots[i].shows.includes(f.id)));
  const out = parseJson(await ask(ctx, { system: renderTemplate('story.verify.system'), prompt: inject('story.verify.user', { facts: factList(claimed), shots: listed }), effort: 'medium', config }));
  const rows = Array.isArray(out) ? out : (out && Array.isArray(out.proofs) ? out.proofs : []);
  if (!rows.length) throw new Error('The check came back empty — try Verify again.');
  return shots.map((x, i) => {
    if (!idx.includes(i)) return x;
    const hay = normQuote(x.prompt);
    const proofs = {};
    x.shows.forEach((f) => {
      const hit = rows.find((r) => Number(r?.shot) === i + 1 && String(r?.fact || '').trim().toUpperCase() === f);
      const q = String(hit?.quote || '').trim();
      proofs[f] = q.length >= MIN_QUOTE_CHARS && hay.includes(normQuote(q)) ? q : '';
    });
    return { ...x, proofs, verified: true };
  });
};

// Per fact: which shots claim it, which PROVE it. A shot whose prompt changed since its
// check is 'unverified' — never counted as shown.
export const factCoverage = (facts = [], shots = []) => facts.map((f) => {
  const claimedBy = shots.map((x, i) => (x.shows.includes(f.id) ? i + 1 : 0)).filter(Boolean);
  const provenIn = shots.map((x, i) => (x.verified && x.proofs?.[f.id] ? i + 1 : 0)).filter(Boolean);
  const pending = claimedBy.some((n) => !shots[n - 1].verified);
  const status = provenIn.length ? 'shown' : !claimedBy.length ? 'unassigned' : pending ? 'unverified' : 'missing';
  return { id: f.id, claimedBy, provenIn, status };
});

// Fix: a fact in no shot joins the shot holding the nearest EARLIER fact (story order,
// decided by code); then only the shots that miss facts are rewritten, naming what they
// missed. Every other shot stays locked.
export const fixShots = async ({ blueprint, facts = [], cast = [], shots = [], config, onNote, onShot } = {}, ctx) => {
  const ids = facts.map((f) => f.id);
  const next = shots.map((x) => ({ ...x, shows: [...x.shows] }));
  const missingByShot = {};
  factCoverage(facts, shots).filter((c) => c.status === 'unassigned').forEach((c) => {
    const pos = ids.indexOf(c.id);
    let home = 0;
    next.forEach((x, i) => { if (x.shows.some((id) => ids.indexOf(id) < pos)) home = i; });
    next[home].shows = [...next[home].shows, c.id].sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
    (missingByShot[home] = missingByShot[home] || []).push(c.id);
  });
  next.forEach((x, i) => {
    const miss = x.verified ? x.shows.filter((f) => shots[i]?.shows.includes(f) && !x.proofs?.[f]) : [];
    if (miss.length) missingByShot[i] = [...new Set([...(missingByShot[i] || []), ...miss])];
  });
  const only = Object.keys(missingByShot).map(Number);
  if (!only.length) return { shots, changed: [], problems: [] };
  const r = await writeShotPrompts({ blueprint, facts, cast, shots: next, only, missingByShot, config, onNote, onShot }, ctx);
  return { shots: r.shots, changed: only, problems: r.problems };
};
