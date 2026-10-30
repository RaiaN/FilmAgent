/**
 * @jest-environment node
 */
// EDIT BY TALK OR NOTE: everything an agent makes can be edited from the director's words — a
// note edits the version it is on, plain words edit what the director stands on; the edit is a
// new version whose parent is the one edited, and only what the words touch changes.
const fs = require('fs');
const path = require('path');
const { talkerFor, editorFor, actionsFor } = require('../utils/film/studio/crew');
const { castTalk, cutTalk } = require('../utils/film/core/talk');
const { createRunners, editSheet } = require('../utils/film/studio/runners');
const { emptyStudio, newElement, newScene } = require('../utils/film/studio/model');
const { applyDeployModels, MODEL_ENV_VARS } = require('../utils/film/suiteConfig');

applyDeployModels(Object.fromEntries(Object.keys(MODEL_ENV_VARS).map((k) => [k, `test-${k}`])));
beforeAll(() => {
  const dir = path.join(__dirname, '..', 'skills');
  const skills = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'SKILL.md')))
    .map((d) => ({ id: d, name: d, text: fs.readFileSync(path.join(dir, d, 'SKILL.md'), 'utf8'), models: [], tasks: [] }));
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ skills }) }));
});
const reasoner = (...answers) => {
  const reason = jest.fn();
  answers.forEach((a) => reason.mockResolvedValueOnce({ content: JSON.stringify(a) }));
  return { client: { reason } };
};
const SCREENPLAY = 'INT. FLAT – NIGHT\nDAN opens the door.';
const SHEET = { seconds: 10, landmarks: 'door at one end', views: [{ name: 'Wide', from: 'by the window' }, { name: 'Close', from: 'at the door' }], start: 'Dan at the door.', beats: [{ view: 'Wide', action: 'Dan opens the door.', looksAt: 'the door' }, { view: 'Close', action: 'Dan looks in.', looksAt: 'the dark' }], against: '', sound: '', end: 'Dan inside.' };

describe('who edits what', () => {
  test('plain words go to what you stand on; talk jobs are never @-asked', () => {
    expect(Object.fromEntries(['brief', 'scene', 'shot', 'world', 'element', 'cut'].map((t) => [t, talkerFor({ type: t }).agent.id])))
      .toEqual({ brief: 'script', scene: 'script', shot: 'shot', world: 'cast', element: 'cast', cut: 'editor' });
    expect(actionsFor({ type: 'cut' }).map((x) => x.action.id)).toEqual(['assemble']);
    expect(actionsFor({ type: 'brief' }).map((x) => x.agent.id)).toEqual(['writers', 'ad']);
  });
  test('a note edits that version, by the agent whose output it is', () => {
    const s = { elements: [{ id: 'e1', kind: 'character' }, { id: 'e2', kind: 'location' }] };
    const route = (ref, v) => { const r = editorFor(s, ref, { id: 'v1', ...v }, 'darker'); return `${r.agent}.${r.action}${r.from ? ` from ${r.from.vid}` : ''}`; };
    expect(route({ at: 'brief' }, { kind: 'script' })).toBe('script.talk from v1');
    expect(route({ at: 'brief' }, { kind: 'shotList' })).toBe('script.talk from v1');
    expect(route({ at: 'scene', sceneId: 'sc' }, { kind: 'blocking' })).toBe('script.talk from v1');
    expect(route({ at: 'cut' }, { kind: 'cut' })).toBe('editor.talk from v1');
    expect(route({ at: 'element', id: 'e1' }, { kind: 'plate' })).toBe('casting.variation from v1');
    expect(route({ at: 'element', id: 'e2' }, { kind: 'plate' })).toBe('designer.variation from v1');
    expect(route({ at: 'take', sceneId: 'sc', shotId: 'sh' }, { by: 'camera', final: true, parent: 'd1' })).toBe('camera.draft from d1');
    expect(editorFor(s, { at: 'take', sceneId: 'sc', shotId: 'sh' }, { id: 'v2', by: 'vfx', parent: 'src', note: 'no sign' }, 'warmer')).toMatchObject({ agent: 'vfx', note: 'no sign. warmer', from: { vid: 'src' } });
  });
});

describe('the checks on what talking may change', () => {
  const ELS = [{ name: 'Dan', kind: 'character', desc: 'a man', plated: true, shots: 2 }, { name: 'Mia', kind: 'character', desc: '', plated: false, shots: 0 }];
  test('Cast & World: unknown names, clashing renames, bad kinds and removing someone in a shot are refused', async () => {
    const out = await castTalk({ message: 'tidy up', elements: ELS }, reasoner({
      reply: 'Done.',
      changes: [{ name: 'Dan', desc: 'a man of fifty' }, { name: 'Mia', rename: 'Dan' }, { name: 'Zed', desc: 'x' }],
      add: [{ name: 'Lighthouse', kind: 'location', desc: 'white tower' }, { name: 'Dog', kind: 'animal' }],
      remove: ['Dan', 'Mia'],
      pictures: [{ name: 'Dan', change: 'older' }],
    }));
    expect(out.changes).toEqual([{ name: 'Dan', desc: 'a man of fifty' }]);
    expect(out.add).toEqual([{ name: 'Lighthouse', kind: 'location', desc: 'white tower' }]);
    expect(out.remove).toEqual(['Mia']);
    expect(out.pictures).toEqual([{ name: 'Dan', change: 'older' }]);
    expect(out.rejected.join(' | ')).toMatch(/"Mia" not renamed: "Dan" is already someone.*no "Zed".*kind "animal".*"Dan" not removed: it is in 2 shots/);
  });
  test('the cut: only circled shots, none twice; the same order changes nothing', async () => {
    const shots = [{ n: 1, title: 'A', scene: 1, seconds: 8 }, { n: 2, title: 'B', scene: 1, seconds: 8 }];
    expect((await cutTalk({ message: 'swap', cut: [1, 2], shots }, reasoner({ reply: 'Swapped.', order: [2, 1] }))).order).toEqual([2, 1]);
    const bad = { reply: 'Added 3.', order: [1, 2, 3] };
    const refused = await cutTalk({ message: 'add 3', cut: [1, 2], shots }, reasoner(bad, bad));
    expect(refused).toMatchObject({ order: [], rejected: [expect.stringMatching(/no circled take for shot 3/)] });
    expect(refused.reply).toMatch(/^Added 3\.\n\nNot applied: no circled take for shot 3/);
    expect((await cutTalk({ message: 'x', cut: [1, 2], shots }, reasoner({ reply: 'ok', order: [1, 1] }, { reply: 'Fixed.', order: [2, 1] }))).order).toEqual([2, 1]);
    expect((await cutTalk({ message: 'x', cut: [1, 2], shots }, reasoner({ reply: 'ok', order: [1, 2] }))).order).toEqual([]);
  });
  test("a scene's shots edited: a new camera joins its views, an unused one leaves, the rest stays", () => {
    const next = editSheet(SHEET, [{ view: 'Wide', from: '', action: 'Dan opens the door.', looksAt: 'the door' }, { view: 'Over', from: 'over his shoulder', action: 'The room.', looksAt: 'the room' }]);
    expect(next.views).toEqual([{ name: 'Wide', from: 'by the window' }, { name: 'Over', from: 'over his shoulder' }]);
    expect(next).toMatchObject({ landmarks: SHEET.landmarks, start: SHEET.start, end: SHEET.end, seconds: 10 });
  });
});

describe('an edit is a new version of what was edited', () => {
  const studio = (over) => {
    let s = { ...emptyStudio(), script: SCREENPLAY, ...over };
    const get = () => s;
    const set = (fn) => { s = typeof fn === 'function' ? fn(s) : fn; };
    return { get, set };
  };
  const talk = async (st, ctx, req) => {
    const crew = createRunners({ get: st.get, set: st.set, ctx });
    const p = await crew.plan(req);
    await crew.run(req, p.payload, p.summary);
  };
  test('talking edits the screenplay at once: a new picked version, its parent the one before, Undo kept', async () => {
    const st = studio({ brief: { versions: [{ id: 'w1', kind: 'script', status: 'picked', by: 'writers', text: SCREENPLAY }] } });
    await talk(st, reasoner({ reply: 'Dan knocks first.', screenplay: 'INT. FLAT – NIGHT\nDAN knocks, then opens the door.', scenes: [] }), { agent: 'script', action: 'talk', scope: { type: 'brief' }, text: 'he knocks first' });
    const s = st.get();
    expect(s.script).toMatch(/knocks/);
    const [w1, w2] = s.brief.versions;
    expect(w1.status).toBe('kept');
    expect(w2).toMatchObject({ kind: 'script', status: 'picked', parent: 'w1', note: 'he knocks first', by: 'script' });
    expect(s.threads.brief.find((m) => m.kind === 'reply').change.undo.script).toBe(SCREENPLAY);
  });
  test('a note on a shot list still waiting for you edits THAT version: a new one waits beside it, nothing in the film changes', async () => {
    const list = { people: [], places: ['Flat'], scenes: [{ n: 1, place: 'Flat', time: 'Night', text: 'x', people: [], sheet: SHEET }] };
    const st = studio({ brief: { versions: [{ id: 'l1', kind: 'shotList', status: 'review', by: 'ad', payload: list }] } });
    const shots = [{ view: 'Close', from: '', action: 'Dan looks in.', looksAt: 'the dark' }];
    await talk(st, reasoner({ reply: 'Cut to the close only.', screenplay: '', scenes: [{ n: 1, shots }] }), editorFor(st.get(), { at: 'brief' }, st.get().brief.versions[0], 'only the close'));
    const s = st.get();
    const [l1, l2] = s.brief.versions;
    expect(l1.payload).toBe(list);
    expect(l2).toMatchObject({ kind: 'shotList', status: 'review', parent: 'l1' });
    expect(l2.payload.scenes[0].sheet.beats.map((b) => b.view)).toEqual(['Close']);
    expect(s.scenes).toEqual([]);
  });
  test('a place renamed takes its views with it', async () => {
    const flat = newElement({ kind: 'location', name: 'Flat', desc: 'a flat' });
    const view = { ...newElement({ kind: 'location', name: 'Flat · Wide' }), viewOf: flat.id };
    const st = studio({ elements: [flat, view] });
    await talk(st, reasoner({ reply: 'Renamed.', changes: [{ name: 'Flat', rename: 'The Flat' }], add: [], remove: [], pictures: [] }), { agent: 'cast', action: 'talk', scope: { type: 'world' }, text: 'call it The Flat' });
    expect(st.get().elements.map((e) => e.name)).toEqual(['The Flat', 'The Flat · Wide']);
    const undo = st.get().threads.world.find((m) => m.kind === 'reply').change.undo;
    expect(undo.elements.map((e) => e.name)).toEqual(['Flat', 'Flat · Wide']);
  });

  test('talking to Cast & World edits names and descriptions at once, with Undo; who is in a shot stays', async () => {
    const dan = newElement({ kind: 'character', name: 'Dan', desc: 'a man' });
    const sc = { ...newScene('Flat'), shots: [{ id: 'sh1', elementIds: [dan.id], takes: { versions: [], picked: null } }] };
    const st = studio({ elements: [dan], scenes: [sc] });
    await talk(st, reasoner({ reply: 'Dan is now Daniel, fifty.', changes: [{ name: 'Dan', rename: 'Daniel', desc: 'a man of fifty' }], add: [{ name: 'Mia', kind: 'character', desc: 'a girl' }], remove: ['Dan'], pictures: [] }), { agent: 'cast', action: 'talk', scope: { type: 'world' }, text: 'Dan is Daniel, fifty; add Mia' });
    const s = st.get();
    expect(s.elements.map((e) => [e.name, e.desc])).toEqual([['Daniel', 'a man of fifty'], ['Mia', 'a girl']]);
    const reply = s.threads.world.find((m) => m.kind === 'reply');
    expect(reply.unknown[0]).toMatch(/"Dan" not removed: it is in 1 shot/);
    expect(reply.change.undo.elements[0]).toMatchObject({ id: dan.id, name: 'Dan', desc: 'a man' });
  });
});

describe('a description and its picture say the same thing', () => {
  test('a new look for someone with a picture edits the picture too — one re-ask', async () => {
    const ELS = [{ name: 'Clara', kind: 'character', desc: 'cardigan', plated: true, shots: 1 }];
    const ctx = reasoner({ reply: 'Scarf added.', changes: [{ name: 'Clara', desc: 'cardigan, red scarf' }] }, { reply: 'Scarf added.', changes: [{ name: 'Clara', desc: 'cardigan, red scarf' }], pictures: [{ name: 'Clara', change: 'add a red scarf' }] });
    const out = await castTalk({ message: 'give her a red scarf', elements: ELS }, ctx);
    expect(ctx.client.reason.mock.calls[1][0].prompt).toMatch(/RETRY[\s\S]*description of Clara/);
    expect(out.pictures).toEqual([{ name: 'Clara', change: 'add a red scarf' }]);
    expect(out.rejected).toEqual([]);
  });
});

describe('a reply never claims what was not applied', () => {
  const { scriptTalk } = require('../utils/film/core/talk');
  const SCENES = [{ n: 1, place: 'Park', time: 'Night', seconds: 12, shots: [1, 2, 3, 4].map((i) => ({ view: `V${i}`, from: 'here', action: `a${i}`, looksAt: 'the dog' })) }];
  const sh = (i) => ({ view: `V${i}`, from: 'here', action: `a${i}`, looksAt: 'the dog' });
  test('a fifth shot is fine for the director; a refused change is re-asked once, then said', async () => {
    const five = [1, 2, 3, 4, 5].map(sh);
    const ok = await scriptTalk({ message: 'add a close of the dog', script: SCREENPLAY, scenes: SCENES }, reasoner({ reply: 'Added.', screenplay: '', scenes: [{ n: 1, shots: five }] }));
    expect(ok.scenes[0].shots).toHaveLength(5);
    const seven = [1, 2, 3, 4, 5, 6, 7].map(sh);
    const ctx = reasoner({ reply: 'Added three.', screenplay: '', scenes: [{ n: 1, shots: seven }] }, { reply: 'Added three.', screenplay: '', scenes: [{ n: 1, shots: seven }] });
    const out = await scriptTalk({ message: 'add three more', script: SCREENPLAY, scenes: SCENES }, ctx);
    expect(ctx.client.reason).toHaveBeenCalledTimes(2);
    expect(ctx.client.reason.mock.calls[1][0].prompt).toMatch(/RETRY[\s\S]*needs 1–6 shots/);
    expect(out.scenes).toEqual([]);
    expect(out.reply).toMatch(/Added three\.\n\nNot applied: scene 1 kept as it was: needs 1–6 shots/);
  });
});
