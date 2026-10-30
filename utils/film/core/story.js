// STORY — the Writers' one job: the director's idea → a screenplay.
//
// One planner call; its instructions live in the crew skill (crew-writers). Code owns the
// promise the prompt makes: scenes that start with sluglines.
import { getModel } from '../suiteConfig';
import { crewStep } from '../skills';
import { fitText } from './limits';

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

// ---- Screenplay: the idea written as a screenplay -----------------------------------
// One planner call (medium effort): the director's words in → sluglines, action and dialogue
// out — the format the 1st AD breaks down. Code checks it IS a screenplay (scenes with
// sluglines); one corrective re-ask, then an error.
const SLUGLINE_RE = /^\s*(INT\.|EXT\.|INT\.\/EXT\.|EXT\.\/INT\.|I\/E\.)\s+\S/gm;
const screenplayProblems = (text) => ((String(text).match(SLUGLINE_RE) || []).length ? [] : ['no scene starts with a slugline (INT. or EXT., the place, DAY or NIGHT)']);
export const writeScreenplay = async ({ idea = '', note = '', config } = {}, ctx) => {
  const words = String(idea || '').trim();
  if (!words) throw new Error('Tell the Writers the idea: @Writers <your idea>.');
  const system = await crewStep('crew-writers', 'screenplay', {});
  const base = `THE IDEA:\n"""\n${fitText(words, 12000, 'The idea')}\n"""${String(note || '').trim() ? `\n\nDIRECTOR'S NOTE — apply it:\n${fitText(String(note).trim(), 1500, "The director's note")}` : ''}\n\nWrite the screenplay.`;
  const clean = (x) => String(x || '').replace(/^```\w*\s*|\s*```$/g, '').trim();
  let text = clean(await ask(ctx, { system, prompt: base, effort: 'medium', config }));
  let problems = screenplayProblems(text);
  if (problems.length) {
    text = clean(await ask(ctx, { system, prompt: `${base}\n\nYOUR LAST ANSWER FAILED THESE CHECKS — fix them: ${problems.join('; ')}`, effort: 'medium', config }));
    problems = screenplayProblems(text);
  }
  if (problems.length) throw new Error(`The screenplay failed the checks: ${problems.join(' · ')}`);
  return text;
};
