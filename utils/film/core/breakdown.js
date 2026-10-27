// SCRIPT BREAKDOWN — the 1st AD's first job, the way productions do it.
//
//   1. Numbered scenes: code reads the sluglines (INT./EXT. PLACE – DAY); each scene gets
//      its length in eighths of a page (1 page ≈ 1 minute of screen time).
//   2. One breakdown sheet per scene: cast, extras, props, wardrobe, set dressing, special
//      needs, sound — copied from the scene's own words (code checks every item is there).
//   3. The film's elements: cast, places and props merged across scenes, with the scenes
//      they appear in.
// Text that has no sluglines is not a screenplay yet: its form says so and nothing is split.
//
// Pure core — the caller injects ctx { client, config }.
import { getModel } from '../suiteConfig';
import { parseJson } from './director';
import { crewStep } from '../skills';
import { runWithConcurrency } from './parallel';
import { parseScript } from './scriptForm';

export { parseScript, pagesLabel } from './scriptForm';

const SHEET_EFFORT = 'low';
const SHEET_CONCURRENCY = 4;
export const SHEET_FIELDS = ['cast', 'extras', 'props', 'wardrobe', 'dressing', 'special', 'sound'];
const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// One scene's breakdown sheet. Every item must be the scene's own words; an item that is not
// is dropped and reported, never kept as a guess.
const sheetOf = async (scene, ctx, config) => {
  const system = await crewStep('crew-ad', 'breakdown', {});
  const { content } = await ctx.client.reason({
    prompt: `SCENE ${scene.n} — ${scene.slug}\n"""\n${scene.text}\n"""\n\nReturn the JSON.`,
    systemPrompt: system,
    modelId: getModel('reasoner', config),
    reasoningEffort: SHEET_EFFORT,
  });
  const raw = parseJson(content);
  if (!raw || typeof raw !== 'object') throw new Error(`Scene ${scene.n}: the breakdown came back without its JSON.`);
  const hay = norm(`${scene.slug}\n${scene.text}`);
  const dropped = [];
  const sheet = {};
  SHEET_FIELDS.forEach((f) => {
    const items = (Array.isArray(raw[f]) ? raw[f] : []).map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    sheet[f] = [...new Set(items)].filter((x) => { const ok = hay.includes(norm(x)); if (!ok) dropped.push(x); return ok; });
  });
  return { sheet, dropped };
};

// A name as the film should carry it: a screenplay writes a character in capitals on first
// appearance — "DAN" is Dan.
const display = (name) => (name === name.toUpperCase() ? name.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : name);

export const breakdownScript = async ({ script = '', config } = {}, ctx) => {
  const parsed = parseScript(script);
  if (parsed.form !== 'screenplay') return { ...parsed, elements: { cast: [], places: [], props: [] }, dropped: [] };
  const sheets = new Array(parsed.scenes.length);
  await runWithConcurrency(parsed.scenes.map((sc, i) => async () => { sheets[i] = await sheetOf(sc, ctx, config); }), SHEET_CONCURRENCY);
  const scenes = parsed.scenes.map((sc, i) => ({ ...sc, sheet: sheets[i].sheet }));
  // The film's elements, merged across scenes by name.
  const merge = (pick) => {
    const by = new Map();
    scenes.forEach((sc) => pick(sc).forEach((name) => {
      const key = norm(name);
      if (!key) return;
      const e = by.get(key) || { name: display(name), scenes: [] };
      if (!e.scenes.includes(sc.n)) e.scenes.push(sc.n);
      if (e.name === e.name.toUpperCase() && name !== name.toUpperCase()) e.name = name;
      by.set(key, e);
    }));
    return [...by.values()];
  };
  return {
    ...parsed,
    scenes,
    elements: {
      cast: merge((sc) => sc.sheet.cast),
      places: merge((sc) => [sc.place]),
      props: merge((sc) => sc.sheet.props),
    },
    dropped: sheets.flatMap((s, i) => s.dropped.map((x) => `scene ${i + 1}: ${x}`)),
  };
};
