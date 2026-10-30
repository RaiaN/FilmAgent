// THE SHOT LIST — the 1st AD's job at the Brief: the script → its scenes → each scene's shots.
//
//   1. Scenes: code reads the sluglines (numbered, with place and time).
//   2. The film's people: one call over the script lists each person ONCE, under the fullest
//      name the script gives, with the other names it calls them. Code checks every name is
//      the script's and nobody is listed twice (one corrective re-ask, then an error).
//   3. Each scene's shots: the scene blocked as one take (blockScene, low effort — the director
//      re-plans a scene with @AD there) — its views are the shots, what happens on each is the
//      shot's line. Scenes in the same place are blocked one after another, so they share the
//      place's landmarks and each opens where the one before ended; different places run side by
//      side. A scene that fails its checks comes back with its error and no shots; the others
//      still land.
//
// Pure core — the caller injects ctx { client, config }.
import { getModel } from '../suiteConfig';
import { parseJson } from './director';
import { crewStep } from '../skills';
import { parseScript } from './scriptForm';
import { blockScene } from './storyboard';

const PEOPLE_EFFORT = 'low';
const SCENE_EFFORT = 'low';
const SCENES_AT_ONCE = 4;
const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const hasWords = (hay, name) => ` ${norm(hay)} `.includes(` ${norm(name)} `);
// A name as the film carries it: a screenplay writes a character in capitals — "DAN" is Dan.
export const display = (name) => (name === name.toUpperCase() ? name.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : name);

// The names a person goes by: their name and every other name the script uses for them.
export const namesOf = (p) => [p.name, ...(p.aka || [])];
// The people a stretch of text names.
export const peopleIn = (people, text) => people.filter((p) => namesOf(p).some((n) => hasWords(text, n)));

const peopleProblems = (people, script) => {
  const out = [];
  if (!people.length) out.push('nobody came back');
  people.forEach((p) => namesOf(p).forEach((n) => { if (!hasWords(script, n)) out.push(`"${n}" is not a name the script uses`); }));
  people.forEach((a, i) => people.forEach((b, j) => {
    if (i >= j) return;
    const shared = namesOf(a).find((n) => namesOf(b).some((m) => norm(m) === norm(n)));
    if (shared) out.push(`"${a.name}" and "${b.name}" both go by "${shared}" — one person is listed once`);
    else if (norm(b.name).split(' ').every((w) => norm(a.name).split(' ').includes(w)) || norm(a.name).split(' ').every((w) => norm(b.name).split(' ').includes(w))) out.push(`"${a.name}" and "${b.name}" look like one person — list them once, the other name under "aka"`);
  }));
  return out;
};

export const peopleOfScript = async ({ script = '', config } = {}, ctx) => {
  const system = await crewStep('crew-ad', 'people', {});
  const fence = '"""';
  const ask = async (retry) => {
    const { content } = await ctx.client.reason({ prompt: `THE SCRIPT:\n${fence}\n${script}\n${fence}\n${retry}\nReturn the JSON.`, systemPrompt: system, modelId: getModel('reasoner', config), reasoningEffort: PEOPLE_EFFORT });
    const raw = parseJson(content) || {};
    return (Array.isArray(raw.people) ? raw.people : [])
      .map((p) => ({ name: display(String(p?.name || '').trim()), aka: [...new Set((Array.isArray(p?.aka) ? p.aka : []).map((x) => String(x || '').trim()).filter(Boolean))] }))
      .filter((p) => p.name);
  };
  let people = await ask('');
  let bad = peopleProblems(people, script);
  if (bad.length) {
    people = await ask(`\nRETRY — your previous answer broke these rules; fix every one:\n${bad.map((x) => `• ${x}`).join('\n')}\n`);
    bad = peopleProblems(people, script);
  }
  if (bad.length) throw new Error(`The people list failed the checks: ${bad.join(' · ')}`);
  return people;
};

export const shotList = async ({ script = '', note = '', config } = {}, ctx) => {
  const parsed = parseScript(script);
  if (parsed.form !== 'screenplay') throw new Error('No scene starts with a slugline (INT. or EXT.) — this is not a screenplay yet.');
  const people = await peopleOfScript({ script, config }, ctx);
  const scenes = parsed.scenes.map((sc) => ({ ...sc, place: display(sc.place), time: display(sc.time), people: peopleIn(people, `${sc.slug}\n${sc.text}`).map((p) => p.name) }));
  // Same place: one after another (landmarks, the end frame before); places side by side.
  const sheets = new Array(scenes.length);
  const byPlace = new Map();
  scenes.forEach((sc, i) => byPlace.set(norm(sc.place), [...(byPlace.get(norm(sc.place)) || []), i]));
  const lanes = [...byPlace.values()].map((idx) => async () => {
    let landmarks = '';
    for (const i of idx) {
      const sc = scenes[i];
      const before = i > 0 && idx.includes(i - 1) ? sheets[i - 1]?.end || '' : '';
      try {
        // eslint-disable-next-line no-await-in-loop
        sheets[i] = await blockScene({ scene: sc, landmarks, before, people: people.filter((p) => sc.people.includes(p.name)), note, effort: SCENE_EFFORT, config }, ctx);
        landmarks = sheets[i].landmarks;
      } catch (e) { sheets[i] = { error: e.message || String(e) }; }
    }
  });
  let next = 0;
  const worker = async () => { while (next < lanes.length) { const lane = lanes[next]; next += 1; await lane(); } }; // eslint-disable-line no-await-in-loop
  await Promise.all(Array.from({ length: Math.min(SCENES_AT_ONCE, lanes.length) }, worker));
  return {
    people,
    places: [...new Set(scenes.map((sc) => sc.place))],
    scenes: scenes.map((sc, i) => ({ n: sc.n, slug: sc.slug, place: sc.place, time: sc.time, text: sc.text, people: sc.people, ...(sheets[i].error ? { sheet: null, error: sheets[i].error } : { sheet: sheets[i] }) })),
  };
};

// A scene's shots as the director reads them, one per beat: where the camera is, what we see.
export const shotsOf = (sheet) => (sheet?.beats || []).map((b) => ({ view: b.view, action: b.action }));
