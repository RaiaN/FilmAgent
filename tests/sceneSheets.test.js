// THE 1ST AD: at the Brief the shot list (the people once each, every scene blocked as one take
// whose views are its shots; picking it lays the film out); at a scene, that scene again
// (picking it makes the scene's shot, with its views as elements of the place). Camera's prompt never sends
// anyone toward the lens the shot text did not ask for.
const fs = require('fs');
const path = require('path');
const { blockScene, sceneMotion } = require('../utils/film/core/storyboard');
const { composeShotAction } = require('../utils/film/core/shot');
const { applyShotList, applyBlocking } = require('../utils/film/studio/runners');
const { peopleOfScript, shotList, shotsOf } = require('../utils/film/core/shotList');
const { emptyStudio, newElement, newScene } = require('../utils/film/studio/model');
const { applyDeployModels, MODEL_ENV_VARS } = require('../utils/film/suiteConfig');

applyDeployModels(Object.fromEntries(Object.keys(MODEL_ENV_VARS).map((k) => [k, `test-${k}`])));

beforeAll(() => {
  const dir = path.join(__dirname, '..', 'skills');
  const skills = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'SKILL.md')))
    .map((d) => ({ id: d, name: d, text: fs.readFileSync(path.join(dir, d, 'SKILL.md'), 'utf8'), models: [], tasks: [] }));
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ skills }) }));
});

const SCENE = { slug: 'INT. ENTRY HALL – NIGHT', place: 'Entry Hall', text: 'DAN steps inside the flat and sees the sigils. A faint singing comes from the back room.' };
const sheet = (over = {}) => ({
  seconds: 12,
  landmarks: 'front door at one end; coat rack on the right as you come in',
  views: [{ name: 'Doorway', from: 'just inside the front door, looking down the hall' }, { name: 'Side', from: 'against the left wall, door at frame left' }],
  start: 'Dan seen from behind, just inside the door, looking at the sigils on the left wall.',
  beats: [
    { view: 'Doorway', action: 'Dan walks slowly down the hall.', looksAt: 'the sigils on the left wall' },
    { view: 'Side', action: 'Dan stops and turns his head back toward the front door.', looksAt: 'the front door' },
  ],
  against: '', sound: '<footsteps on boards>', end: 'Dan walks out of frame toward the back room.',
  ...over,
});
const reasoner = (...answers) => {
  const reason = jest.fn();
  answers.forEach((a) => reason.mockResolvedValueOnce({ content: JSON.stringify(a) }));
  return { client: { reason } };
};
const ARGS = { scene: SCENE, references: ['u-dan'], labels: ['Dan (cast)'] };

describe('the 1st AD blocks one scene', () => {
  test('one call, from the scene\'s own words and the plates of who is in it', async () => {
    const ctx = reasoner(sheet());
    const out = await blockScene(ARGS, ctx);
    expect(ctx.client.reason).toHaveBeenCalledTimes(1);
    const call = ctx.client.reason.mock.calls[0][0];
    expect(call.images).toEqual(['u-dan']);
    expect(call.systemPrompt).toMatch(/\[Image 1\] Dan \(cast\)/);
    expect(call.prompt).toMatch(/INT\. ENTRY HALL – NIGHT/);
    expect(call.prompt).toMatch(/sees the sigils/);
    expect(out).toMatchObject({ place: 'Entry Hall', seconds: 12, landmarks: sheet().landmarks });
    expect(out.beats[1].looksAt).toBe('the front door');
  });
  test('a place blocked before keeps its landmarks; the scene before in the same place hands over its end frame', async () => {
    const ctx = reasoner(sheet({ landmarks: 'something else' }));
    const out = await blockScene({ ...ARGS, landmarks: 'the fixed landmarks', before: 'Dan at the back-room door.' }, ctx);
    const { prompt } = ctx.client.reason.mock.calls[0][0];
    expect(prompt).toMatch(/landmarks are FIXED[\s\S]*the fixed landmarks/);
    expect(prompt).toMatch(/ends on this frame: Dan at the back-room door\./);
    expect(out.landmarks).toBe('the fixed landmarks');
  });
  test('people with no plate are named by the script', async () => {
    const ctx = reasoner(sheet());
    await blockScene({ ...ARGS, unplated: ['The Doll'] }, ctx);
    expect(ctx.client.reason.mock.calls[0][0].prompt).toMatch(/with no plate \(use these script names\): The Doll/);
  });
  test('a beat that looks at the lens is re-asked once, then an error naming the scene', async () => {
    const bad = sheet({ beats: [{ view: 'Doorway', action: 'Dan walks.', looksAt: 'the camera' }] });
    const ctx = reasoner(bad, bad);
    await expect(blockScene(ARGS, ctx)).rejects.toThrow(/INT\. ENTRY HALL – NIGHT failed the checks: .*someone looks at the camera/);
    expect(ctx.client.reason).toHaveBeenCalledTimes(2);
    expect(ctx.client.reason.mock.calls[1][0].prompt).toMatch(/RETRY/);
  });
  test('a beat on an unlisted view or a length out of range is re-asked', async () => {
    const ctx = reasoner(sheet({ seconds: 40, beats: [{ view: 'Overhead', action: 'Dan walks.', looksAt: 'the floor' }] }), sheet());
    const out = await blockScene(ARGS, ctx);
    const retry = ctx.client.reason.mock.calls[1][0].prompt;
    expect(retry).toMatch(/seconds must be 4–15/);
    expect(retry).toMatch(/"Overhead" is not one of the scene's views/);
    expect(out.seconds).toBe(12);
  });
  test('the sheet reads as the shot text: a new view is a cut, every beat says where eyes go', () => {
    const text = sceneMotion(sheet());
    expect(text).toMatch(/Shot 1 — the camera is just inside the front door/);
    expect(text).toMatch(/Shot 2 — the shot cuts to the camera against the left wall/);
    expect(text).toMatch(/Eyes on: the front door\./);
  });
});

const SCRIPT = 'EXT. TERRACE – DAY\nELIAS VOSS (40) parks. LILA (8) hugs a rabbit.\n\nINT. FLAT – NIGHT\nElias opens the door. Lila follows.\n\nINT. FLAT – NIGHT\nElias finds the closet.';

describe('the shot list', () => {
  test('one person is listed once: "Elias" beside "Elias Voss" is re-asked', async () => {
    const ctx = reasoner({ people: [{ name: 'ELIAS VOSS' }, { name: 'Elias' }, { name: 'Lila' }] }, { people: [{ name: 'ELIAS VOSS', aka: ['Elias'] }, { name: 'LILA' }] });
    const people = await peopleOfScript({ script: SCRIPT }, ctx);
    expect(ctx.client.reason.mock.calls[1][0].prompt).toMatch(/RETRY[\s\S]*look like one person/);
    expect(people).toEqual([{ name: 'Elias Voss', aka: ['Elias'] }, { name: 'Lila', aka: [] }]);
  });
  test('a name the script never uses is re-asked, then an error', async () => {
    const bad = { people: [{ name: 'Elias Voss', aka: ['Eli'] }] };
    await expect(peopleOfScript({ script: SCRIPT }, reasoner(bad, bad))).rejects.toThrow(/"Eli" is not a name the script uses/);
  });
  test('every scene blocked with its people by one name; scenes in one place one after another', async () => {
    const ctx = reasoner({ people: [{ name: 'Elias Voss', aka: ['Elias'] }, { name: 'Lila' }] }, sheet(), sheet(), sheet({ landmarks: 'ignored' }));
    const list = await shotList({ script: SCRIPT }, ctx);
    expect(list.scenes.map((sc) => [sc.n, sc.place, sc.people])).toEqual([[1, 'Terrace', ['Elias Voss', 'Lila']], [2, 'Flat', ['Elias Voss', 'Lila']], [3, 'Flat', ['Elias Voss']]]);
    const third = ctx.client.reason.mock.calls[3][0].prompt;
    expect(third).toMatch(/landmarks are FIXED/);
    expect(third).toMatch(/ends on this frame: Dan walks out of frame/);
    expect(third).toMatch(/Elias Voss \(the script also says Elias\)/);
    expect(shotsOf(list.scenes[0].sheet)).toEqual([{ view: 'Doorway', action: 'Dan walks slowly down the hall.' }, { view: 'Side', action: 'Dan stops and turns his head back toward the front door.' }]);
  });
});

describe('picking the shot list', () => {
  test('the film laid out: people and places without a plate, every scene with its shot', () => {
    const payload = {
      people: [{ name: 'Dan', aka: [] }],
      places: ['Entry Hall'],
      scenes: [{ n: 1, slug: 'INT. ENTRY HALL – NIGHT', place: 'Entry Hall', time: 'Night', text: 'DAN steps inside.', people: ['Dan'], sheet: sheet() }],
    };
    const next = applyShotList(emptyStudio(), payload);
    expect(next.shotList).toBe(payload);
    const dan = next.elements.find((e) => e.name === 'Dan');
    expect(dan).toMatchObject({ kind: 'character', picked: null });
    expect(next.scenes[0]).toMatchObject({ title: 'Entry Hall · Night', n: 1, place: 'Entry Hall', people: ['Dan'] });
    expect(next.scenes[0].blocking.versions[0]).toMatchObject({ status: 'picked', by: 'ad', kind: 'blocking' });
    const [shot] = next.scenes[0].shots;
    expect(shot).toMatchObject({ blocked: true, seconds: 12 });
    expect(shot.elementIds[0]).toBe(dan.id);
    expect(shot.motion).toMatch(new RegExp(`\\{\\{el:${dan.id}\\}\\} walks slowly`));
  });
});

describe('picking a scene\'s blocking', () => {
  test('the scene gets one blocked shot; the place its landmarks; each view an element of the place; unplated people elements', () => {
    const hall = newElement({ kind: 'location', name: 'Entry Hall' });
    const dan = newElement({ kind: 'character', name: 'Dan' });
    const sc = newScene('Entry Hall · Night', SCENE);
    const s = { ...emptyStudio(), elements: [hall, dan], scenes: [sc] };
    const payload = { ...sheet(), place: 'Entry Hall', elementIds: [dan.id], unplated: [{ name: 'The Doll', kind: 'prop' }] };
    const next = applyBlocking(s, sc.id, payload);
    const views = next.elements.filter((e) => e.viewOf === hall.id);
    expect(views.map((e) => e.name)).toEqual(['Entry Hall · Doorway', 'Entry Hall · Side']);
    const doll = next.elements.find((e) => e.name === 'The Doll');
    expect(doll).toMatchObject({ kind: 'prop', picked: null });
    expect(next.elements.find((e) => e.id === hall.id).landmarks).toBe(sheet().landmarks);
    const [shot] = next.scenes[0].shots;
    expect(shot).toMatchObject({ blocked: true, seconds: 12, audio: '<footsteps on boards>' });
    expect(shot.sheet.viewIds).toEqual(views.map((e) => e.id));
    expect(shot.elementIds).toEqual([dan.id, doll.id, ...views.map((e) => e.id)]);
    expect(shot.motion).toMatch(new RegExp(`\\{\\{el:${dan.id}\\}\\} walks slowly`));
    // Blocked again: the same shot takes the new text and keeps its takes; the views are shared.
    const withTake = { ...next, scenes: next.scenes.map((x) => ({ ...x, shots: x.shots.map((sh) => ({ ...sh, takes: { versions: [{ id: 't1' }], picked: 't1' } })) })) };
    const again = applyBlocking(withTake, sc.id, { ...payload, seconds: 9 });
    expect(again.scenes[0].shots).toHaveLength(1);
    expect(again.scenes[0].shots[0]).toMatchObject({ seconds: 9, takes: { picked: 't1' } });
    expect(again.elements.filter((e) => e.viewOf === hall.id)).toHaveLength(2);
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
