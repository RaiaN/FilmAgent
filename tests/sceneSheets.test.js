/**
 * @jest-environment node
 */
// THE SCENE SHEET: the 1st AD blocks each scene (place, views, start, beats with what
// everyone looks at, end); picking it makes one shot per scene with its views as elements;
// Camera's prompt never sends anyone toward the lens the shot text did not ask for.
const fs = require('fs');
const path = require('path');
const { storyboardScenes, sceneMotion } = require('../utils/film/core/storyboard');
const { composeShotAction } = require('../utils/film/core/shot');
const { applyBreakdown } = require('../utils/film/studio/runners');
const { emptyStudio, newElement } = require('../utils/film/studio/model');
const { applyDeployModels, MODEL_ENV_VARS } = require('../utils/film/suiteConfig');

applyDeployModels(Object.fromEntries(Object.keys(MODEL_ENV_VARS).map((k) => [k, `test-${k}`])));

beforeAll(() => {
  const dir = path.join(__dirname, '..', 'skills');
  const skills = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'SKILL.md')))
    .map((d) => ({ id: d, name: d, text: fs.readFileSync(path.join(dir, d, 'SKILL.md'), 'utf8'), models: [], tasks: [] }));
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ skills }) }));
});

const SCRIPT = 'He steps inside the flat and sees the sigils. A faint singing comes from the back room.';
const scene = (over = {}) => ({
  title: 'Sigils', quote: 'He steps inside the flat and sees the sigils.', place: 'Entry Hall', seconds: 12,
  landmarks: 'front door at one end; coat rack on the right as you come in',
  views: [{ name: 'Doorway', from: 'just inside the front door, looking down the hall' }, { name: 'Side', from: 'against the left wall, door at frame left' }],
  start: 'Dan seen from behind, just inside the door, looking at the sigils on the left wall.',
  beats: [
    { view: 'Doorway', action: 'Dan walks slowly down the hall.', looksAt: 'the sigils on the left wall' },
    { view: 'Side', action: 'Dan stops and turns his head back toward the front door.', looksAt: 'the front door' },
  ],
  against: '', sound: '<footsteps on boards>', end: 'Dan walks out of frame toward the back room.', continues: false, figures: [1],
  ...over,
});
const reasoner = (...answers) => {
  const reason = jest.fn();
  answers.forEach((a) => reason.mockResolvedValueOnce({ content: JSON.stringify(a) }));
  return { client: { reason } };
};

// The two passes as the planner answers them: DIVIDE (scenes + places), then one SHEET per scene.
const divided = (scenes, places = [{ name: 'Entry Hall', landmarks: scene().landmarks }]) => ({
  places,
  scenes: scenes.map(({ title, quote, place, seconds, continues, figures }) => ({ title, quote, place, seconds, continues, figures })),
});
const sheetOf = ({ views, start, beats, against, sound, end }) => ({ views, start, beats, against, sound, end });
const ARGS = { script: SCRIPT, references: ['u-dan'], labels: ['Dan (cast)'], places: ['Entry Hall'] };

describe('the 1st AD blocks the film', () => {
  test('divide (text only), then one sheet per scene', async () => {
    const ctx = reasoner(divided([scene()]), sheetOf(scene()));
    const out = await storyboardScenes(ARGS, ctx);
    expect(ctx.client.reason).toHaveBeenCalledTimes(2);
    const [divide, sheet] = ctx.client.reason.mock.calls.map((c) => c[0]);
    expect(divide.images).toEqual([]);
    expect(sheet.images).toEqual(['u-dan']);
    expect(sheet.systemPrompt).toMatch(/\[Image 1\] Dan \(cast\)/);
    expect(sheet.prompt).toMatch(/Landmarks: front door at one end/);
    expect(out[0]).toMatchObject({ title: 'Sigils', place: 'Entry Hall', landmarks: scene().landmarks, figures: [1] });
    expect(out[0].beats[1].looksAt).toBe('the front door');
  });
  test('a beat that looks at the lens is re-asked once, then an error naming the scene', async () => {
    const bad = scene({ beats: [{ view: 'Doorway', action: 'Dan walks.', looksAt: 'the camera' }] });
    const ctx = reasoner(divided([scene()]), sheetOf(bad), sheetOf(bad));
    await expect(storyboardScenes(ARGS, ctx)).rejects.toThrow(/Scene 1 \("Sigils"\) failed the checks: .*someone looks at the camera/);
    expect(ctx.client.reason).toHaveBeenCalledTimes(3);
    expect(ctx.client.reason.mock.calls[2][0].prompt).toMatch(/RETRY/);
  });
  test('a paraphrased quote re-asks the division; a beat on an unlisted view re-asks only that sheet', async () => {
    const ctx = reasoner(
      divided([scene({ quote: 'He walks into the flat.' })]), divided([scene()]),
      sheetOf(scene({ beats: [{ view: 'Overhead', action: 'Dan walks.', looksAt: 'the floor' }] })), sheetOf(scene()),
    );
    const out = await storyboardScenes(ARGS, ctx);
    const calls = ctx.client.reason.mock.calls.map((c) => c[0].prompt);
    expect(calls[1]).toMatch(/RETRY[\s\S]*not word-for-word/);
    expect(calls[3]).toMatch(/RETRY[\s\S]*"Overhead" is not one of the scene's views/);
    expect(out[0].title).toBe('Sigils');
  });
  test('a continuing scene is blocked after the one before, opening on its end frame', async () => {
    const second = scene({ title: 'Deeper', quote: 'A faint singing comes from the back room.', continues: true });
    const ctx = reasoner(divided([scene(), second]), sheetOf(scene()), sheetOf(second));
    const out = await storyboardScenes(ARGS, ctx);
    expect(out.map((sc) => sc.title)).toEqual(['Sigils', 'Deeper']);
    expect(ctx.client.reason.mock.calls[2][0].prompt).toMatch(/CONTINUES from the scene before, whose end frame is: Dan walks out of frame/);
  });
  test('people no plate depicts come back by their script names; a plate name listed as unplated is re-asked', async () => {
    const withDoll = (unplated) => ({ ...divided([scene()]), scenes: [{ ...divided([scene()]).scenes[0], unplated }] });
    const ctx = reasoner(withDoll([{ name: 'Dan', kind: 'character' }]), withDoll([{ name: 'The Doll', kind: 'prop' }]), sheetOf(scene()));
    const out = await storyboardScenes(ARGS, ctx);
    const calls = ctx.client.reason.mock.calls.map((c) => c[0]);
    expect(calls[0].systemPrompt).toMatch(/only when it IS that one/);
    expect(calls[1].prompt).toMatch(/RETRY[\s\S]*"Dan" has a plate/);
    expect(calls[2].prompt).toMatch(/with no plate \(use these script names\): The Doll/);
    expect(out[0].unplated).toEqual([{ name: 'The Doll', kind: 'prop' }]);
  });
  test('the sheet reads as the shot text: a new view is a cut, every beat says where eyes go', () => {
    const text = sceneMotion(scene());
    expect(text).toMatch(/Shot 1 — the camera is just inside the front door/);
    expect(text).toMatch(/Shot 2 — the shot cuts to the camera against the left wall/);
    expect(text).toMatch(/Eyes on: the front door\./);
  });
});

describe('picking a breakdown with unplated people', () => {
  test('they become plate-less elements, named in the shot text as tokens', () => {
    const s = emptyStudio();
    const payload = { unbound: ['Entry Hall'], unplated: [{ name: 'The Doll', kind: 'prop' }], scenes: [{ title: 'Sigils', shots: [{ title: 'Sigils', quote: 'q', seconds: 8, place: 'Entry Hall', motion: 'The Doll sits on the shelf.', elementIds: [], unplated: [{ name: 'The Doll', kind: 'prop' }] }] }] };
    const next = applyBreakdown(s, payload);
    const doll = next.elements.find((e) => e.name === 'The Doll');
    expect(doll).toMatchObject({ kind: 'prop', picked: null });
    const shot = next.scenes[0].shots[0];
    expect(shot.elementIds).toContain(doll.id);
    expect(shot.motion).toBe(`{{el:${doll.id}}} sits on the shelf.`);
  });
});

describe('picking the sheets', () => {
  test('one shot per scene, its views become elements of the place, continuing scenes start from the one before', () => {
    const hall = { ...newElement({ kind: 'location', name: 'Entry Hall' }) };
    const dan = { ...newElement({ kind: 'character', name: 'Dan' }) };
    const s = { ...emptyStudio(), elements: [hall, dan] };
    const sheet = (sc) => ({ place: sc.place, landmarks: sc.landmarks, views: sc.views, start: sc.start, beats: sc.beats, against: sc.against, end: sc.end });
    const payload = { scenes: [scene(), scene({ title: 'Deeper', continues: true })].map((sc) => ({ title: sc.title, shots: [{ title: sc.title, quote: sc.quote, seconds: sc.seconds, place: sc.place, motion: 'x', audio: sc.sound, elementIds: [dan.id], startFrom: sc.continues ? 'previous' : null, sheet: sheet(sc) }] })) };
    const next = applyBreakdown(s, payload);
    const views = next.elements.filter((e) => e.viewOf === hall.id);
    expect(views.map((e) => e.name)).toEqual(['Entry Hall · Doorway', 'Entry Hall · Side']);
    const [a, b] = next.scenes.map((sc) => sc.shots[0]);
    expect(a.sheet.viewIds).toEqual(views.map((e) => e.id));
    expect(a.elementIds).toEqual([dan.id, ...views.map((e) => e.id)]);
    expect(b.sheet.viewIds).toEqual(a.sheet.viewIds); // the same place's views are shared, never duplicated
    expect(b.startFrom).toBe('previous');
  });
});

describe('Camera never sends anyone toward the lens', () => {
  const compose = (...actions) => reasoner(...actions.map((action) => ({ action, audio: '' })));
  test('toward-the-camera wording is re-asked once', async () => {
    const ctx = compose('Use @Image1 as the first frame. The man walks toward the camera.', 'Use @Image1 as the first frame. The man walks toward the back-room door.');
    const out = await composeShotAction({ text: 'The man walks down the hall.', references: ['u1'], roster: ['[Image 1] start frame'], kfIndices: [1], modelKey: 'seedance25', derive: false }, ctx);
    expect(out.action).toMatch(/back-room door/);
    expect(ctx.client.reason).toHaveBeenCalledTimes(2);
    expect(ctx.client.reason.mock.calls[1][0].prompt).toMatch(/walks toward the camera/);
  });
  test('still there after the re-ask: nothing is shot', async () => {
    const ctx = compose('He turns to the camera.', 'He slowly turns to the camera.');
    await expect(composeShotAction({ text: 'He waits.', references: ['u1'], roster: ['[Image 1] start frame'], kfIndices: [1], modelKey: 'seedance25', derive: false }, ctx))
      .rejects.toThrow(/kept sending someone toward the camera/);
  });
  test('when the director asked for it, it stays', async () => {
    const ctx = compose('Use @Image1 as the first frame. She looks into the lens and smiles.');
    const out = await composeShotAction({ text: 'She looks into the lens and smiles.', references: ['u1'], roster: ['[Image 1] start frame'], kfIndices: [1], modelKey: 'seedance25', derive: false }, ctx);
    expect(out.action).toMatch(/into the lens/);
    expect(ctx.client.reason).toHaveBeenCalledTimes(1);
  });
  test('a scene sheet is the authority: no keyframe re-read', async () => {
    const ctx = compose('Use @Image1 as the first frame. He walks down the hall, eyes on the door.');
    await composeShotAction({ text: 'He walks down the hall.', references: ['u1'], roster: ['[Image 1] start frame'], kfIndices: [1], modelKey: 'seedance25', derive: false }, ctx);
    expect(ctx.client.reason).toHaveBeenCalledTimes(1);
    expect(ctx.client.reason.mock.calls[0][0].systemPrompt).toMatch(/EYES: in every beat/);
  });
});
