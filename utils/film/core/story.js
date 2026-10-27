// STORY — idea → blueprint, on the story-builder skill, plus the look.
//
// Roles: Architect (one call, whole skill) · Look (reference images → one style sentence).
// Their instructions live in the crew skills (crew-writers). Code owns every
// promise the prompts make: block names, word caps and the spine's opening.
import { renderTemplate, getModel, getRuntime } from '../suiteConfig';
import { hydrateSkills, skillById, crewStep } from '../skills';
import { parseJson } from './director';
import { fitText } from './limits';

export const STORY_SKILL_ID = 'story-builder';
const BLOCKS = ['protagonist', 'flaw', 'internal_need', 'inciting_incident', 'external_want', 'antagonist', 'journey', 'crisis', 'climax', 'resolution'];
const BLOCK_CAP = 45; // words per block / per journey obstacle
const SPINE_CAP = 70; // words in the one-sentence spine
const SLACK = 5; // a cap overrun this small is not worth a re-ask

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
// User and model text enters a template through a sentinel, never through {vars}:
// a brace in the user's words must not be read as a placeholder.
const inject = (id, slots) => {
  let text = renderTemplate(id, Object.fromEntries(Object.keys(slots).map((k) => [k, `@@${k.toUpperCase()}@@`])));
  Object.entries(slots).forEach(([k, v]) => { text = text.split(`@@${k.toUpperCase()}@@`).join(String(v ?? '')); });
  return text;
};

// The skill rides whole, fenced like the library's other specs. Required: a story
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
const blueprintProblems = (bp) => {
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

// ---- Architect: the idea → a capped blueprint, one corrective re-ask ---------------
export const architectBlueprint = async ({ idea = '', config } = {}, ctx) => {
  const text = String(idea || '').trim();
  if (!text) throw new Error('Write an idea first.');
  const system = await crewStep('crew-writers', 'architect', { skill: await storySkillLine(), cap: BLOCK_CAP, spineCap: SPINE_CAP });
  const prompt = inject('story.architect.user', { idea: fitText(text, 6000, 'The idea') });
  const effort = getRuntime(config).reasoningEffort;
  let bp = parseJson(await ask(ctx, { system, prompt, effort, config }));
  let problems = blueprintProblems(bp);
  // A failed CHECK (caps, missing blocks) gets one corrective re-ask; an API failure is not re-asked.
  if (problems.length) {
    bp = parseJson(await ask(ctx, { system, prompt: `${prompt}\n\nYOUR LAST ANSWER FAILED THESE CHECKS — fix them: ${problems.join('; ')}`, effort, config }));
    problems = blueprintProblems(bp);
  }
  if (!bp || typeof bp !== 'object') throw new Error('The Architect returned no blueprint.');
  return { blueprint: tidyBlueprint(bp), problems };
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

// ---- Screenplay: the blueprint written as a screenplay ----------------------------
// One planner call (medium effort): the blueprint's story in → sluglines, action and dialogue
// out — the format the 1st AD breaks down. Code checks it IS a screenplay (scenes with
// sluglines) and that the protagonist is in it; one corrective re-ask, then an error.
const SLUGLINE_RE = /^\s*(INT\.|EXT\.|INT\.\/EXT\.|EXT\.\/INT\.|I\/E\.)\s+\S/gm;
const screenplayProblems = (text, bp) => {
  const out = [];
  if (!(String(text).match(SLUGLINE_RE) || []).length) out.push('no scene starts with a slugline (INT. or EXT., the place, DAY or NIGHT)');
  const lead = String(bp.protagonist || '').split(/[,(]/)[0].trim();
  if (lead && lead.split(/\s+/).length <= 3 && !new RegExp(lead.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) out.push(`the protagonist ${lead} never appears`);
  return out;
};
export const writeScreenplay = async ({ blueprint, note = '', config } = {}, ctx) => {
  if (!blueprint) throw new Error('The screenplay needs the story blueprint first.');
  const system = await crewStep('crew-writers', 'screenplay', {});
  const story = blueprintScript(blueprint);
  const base = `THE STORY:\n"""\n${story}\n"""${String(note || '').trim() ? `\n\nDIRECTOR'S NOTE — apply it:\n${fitText(String(note).trim(), 1500, "The director's note")}` : ''}\n\nWrite the screenplay.`;
  const clean = (x) => String(x || '').replace(/^```\w*\s*|\s*```$/g, '').trim();
  let text = clean(await ask(ctx, { system, prompt: base, effort: 'medium', config }));
  let problems = screenplayProblems(text, blueprint);
  if (problems.length) {
    text = clean(await ask(ctx, { system, prompt: `${base}\n\nYOUR LAST ANSWER FAILED THESE CHECKS — fix them: ${problems.join('; ')}`, effort: 'medium', config }));
    problems = screenplayProblems(text, blueprint);
  }
  if (problems.length) throw new Error(`The screenplay failed the checks: ${problems.join(' · ')}`);
  return text;
};


