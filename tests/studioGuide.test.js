// THE GUIDE — the film's one next step, read from the film as it stands.
import { nextStep, stepsOf, stageStates } from '../utils/film/studio/guide';
import { emptyStudio, addVersion, pickVersion, scriptHash, withFilmStyle, loadStudio } from '../utils/film/studio/model';
import { applyShotList } from '../utils/film/studio/runners';

const SCRIPT = 'INT. FLAT – NIGHT\nDAN opens the door.';
const SHEET = { seconds: 10, landmarks: 'door', views: [{ name: 'Wide', from: 'by the window' }], start: 'Dan at the door.', beats: [{ view: 'Wide', action: 'Dan opens the door.', looksAt: 'the door' }], against: '', sound: 'rain', end: 'Dan inside.' };
const LIST = { people: [{ name: 'Dan', aka: [] }], places: ['Flat'], scriptHash: scriptHash(SCRIPT), scenes: [{ n: 1, slug: 'INT. FLAT – NIGHT', place: 'Flat', time: 'Night', text: 'DAN opens the door.', people: ['Dan'], sheet: SHEET }] };
const laidOut = () => applyShotList({ ...emptyStudio(), script: SCRIPT }, LIST);
const plate = (s, el, id = `p-${el.id}`) => { const ref = { at: 'element', id: el.id }; return pickVersion(addVersion(s, ref, { id, at: 1, by: 'casting', kind: 'plate', status: 'review', url: 'p.png' }), ref, id); };
const allPlated = () => { const s = laidOut(); return s.elements.reduce((x, el) => plate(x, el), s); };

describe('from an empty film to the cut, one step at a time', () => {
  test('an empty film asks for your words; an idea goes to the Writers', () => {
    expect(nextStep(emptyStudio(), { type: 'brief' }).write).toBe(true);
    const st = nextStep({ ...emptyStudio(), script: 'A dog finds a boy.' }, { type: 'brief' });
    expect(st.run).toMatchObject({ agent: 'writers', action: 'develop', text: 'A dog finds a boy.' });
  });
  test('a screenplay waiting for you is reviewed before anything else', () => {
    const s = addVersion({ ...emptyStudio(), script: 'An idea' }, { at: 'brief' }, { id: 'w', at: 1, kind: 'script', status: 'review', text: SCRIPT });
    expect(nextStep(s, { type: 'world' }).review).toEqual({ ref: { at: 'brief' }, vid: 'w' });
  });
  test('a screenplay goes to the AD for the shot list; nothing later opens before it', () => {
    const steps = stepsOf({ ...emptyStudio(), script: SCRIPT });
    expect(steps.map((x) => x.id)).toEqual(['script.shots']);
    expect(steps[0].run).toMatchObject({ agent: 'ad', action: 'shots' });
  });
  test('the shot list opens Cast & World: Casting fills everyone without a plate', () => {
    const st = nextStep(laidOut(), { type: 'brief' });
    expect(st.run).toMatchObject({ agent: 'casting', action: 'cast' });
    expect(st.scope).toEqual({ type: 'world' });
  });
  test('with the cast and the views in, the Camera drafts the scene', () => {
    let s = allPlated();
    const sc = s.scenes[0];
    expect(nextStep(s, { type: 'scene', id: sc.id }).run).toMatchObject({ agent: 'camera', action: 'draft', scope: { type: 'scene', id: sc.id } });
    s = addVersion(s, { at: 'take', sceneId: sc.id, shotId: sc.shots[0].id }, { id: 't', at: 1, by: 'camera', kind: 'take', status: 'review', url: 'u.mp4' });
    expect(nextStep(s, { type: 'scene', id: sc.id }).review.vid).toBe('t');
  });
  test('a circled take opens the rough cut; a cut of what is circled opens the Final', () => {
    let s = allPlated();
    const sc = s.scenes[0];
    const ref = { at: 'take', sceneId: sc.id, shotId: sc.shots[0].id };
    s = pickVersion(addVersion(s, ref, { id: 't', at: 1, by: 'camera', kind: 'take', status: 'review', url: 'u.mp4', draft: { taskId: 'x', modelKey: 'seedance25', at: Date.now() } }), ref, 't');
    expect(nextStep(s, { type: 'cut' }).run).toMatchObject({ agent: 'editor', action: 'assemble' });
    s = pickVersion(addVersion(s, { at: 'cut' }, { id: 'c', at: 2, by: 'editor', kind: 'cut', status: 'review', url: 'c.mp4', takes: ['t'] }), { at: 'cut' }, 'c');
    expect(nextStep(s, { type: 'cut' }).final).toEqual({ sceneId: sc.id, res: '1080p' });
  });
});

describe('where you stand comes first', () => {
  test('a shot does not draft while a plate of it renders', () => {
    let s = laidOut();
    s = addVersion(s, { at: 'element', id: s.elements[0].id }, { id: 'r', at: 1, by: 'casting', kind: 'plate', status: 'running' });
    const rest = s.elements.slice(1).reduce((x, el) => plate(x, el), s);
    expect(nextStep(rest, { type: 'world' })).toBe(null);
  });
  test('a render in one scene never holds up the next', () => {
    const script = `${SCRIPT}\nINT. HALL – DAY\nDAN waits.`;
    const list = { ...LIST, scriptHash: scriptHash(script), scenes: [...LIST.scenes, { ...LIST.scenes[0], n: 2, slug: 'INT. HALL – DAY', text: 'DAN waits.' }] };
    const base = applyShotList({ ...emptyStudio(), script }, list);
    let s = base.elements.reduce((x, el) => plate(x, el), base);
    const [one, two] = s.scenes;
    s = addVersion(s, { at: 'take', sceneId: one.id, shotId: one.shots[0].id }, { id: 'r', at: 1, by: 'camera', kind: 'take', status: 'running' });
    expect(nextStep(s, { type: 'scene', id: one.id }).scope).toEqual({ type: 'scene', id: two.id });
  });
  test('your own footage asks for your words, for the VFX', () => {
    let s = { ...emptyStudio(), scenes: [{ id: 'sc', title: 'Scene 1', blocking: { versions: [] }, shots: [{ id: 'sh', title: 'clip', seconds: 8, elementIds: [], takes: { versions: [{ id: 'f', kind: 'take', status: 'picked', footage: true, url: 'f.mp4' }], picked: 'f' } }] }] };
    const st = nextStep(s, { type: 'scene', id: 'sc' });
    expect(st.say).toBe('@VFX ');
    expect(st.scope).toEqual({ type: 'shot', sceneId: 'sc', id: 'sh' });
    s = addVersion(s, { at: 'take', sceneId: 'sc', shotId: 'sh' }, { id: 'e', parent: 'f', at: 1, by: 'vfx', kind: 'take', status: 'review', url: 'e.mp4' });
    expect(nextStep(s, { type: 'scene', id: 'sc' }).review.vid).toBe('e');
  });
  test('a script changed after the film was laid out asks for a new list but holds nothing up', () => {
    const s = { ...allPlated(), script: `${SCRIPT}\nDAN sits.` };
    expect(nextStep(s, { type: 'brief' }).run.action).toBe('shots');
    expect(nextStep(s, { type: 'scene', id: s.scenes[0].id }).run.action).toBe('draft');
  });
});

describe('the cut waits for the takes', () => {
  test('no new cut while a take renders or waits for you', () => {
    let s = allPlated();
    const sc = s.scenes[0];
    const ref = { at: 'take', sceneId: sc.id, shotId: sc.shots[0].id };
    s = pickVersion(addVersion(s, ref, { id: 't', at: 1, by: 'you', kind: 'take', status: 'review', footage: true, url: 'u.mp4' }), ref, 't');
    expect(stepsOf(s).some((x) => x.id === 'cut.assemble')).toBe(true);
    const busy = addVersion(s, ref, { id: 'e', parent: 't', at: 2, by: 'vfx', kind: 'take', status: 'running' });
    expect(stepsOf(busy).some((x) => x.id === 'cut.assemble')).toBe(false);
  });
});

describe('finals', () => {
  const twoScenes = () => {
    const script = `${SCRIPT}\nINT. HALL – DAY\nDAN waits.`;
    const list = { ...LIST, scriptHash: scriptHash(script), scenes: [...LIST.scenes, { ...LIST.scenes[0], n: 2, slug: 'INT. HALL – DAY', text: 'DAN waits.' }] };
    const base = applyShotList({ ...emptyStudio(), script }, list);
    let s = base.elements.reduce((x, el) => plate(x, el), base);
    s.scenes.forEach((sc, i) => { const ref = { at: 'take', sceneId: sc.id, shotId: sc.shots[0].id }; s = pickVersion(addVersion(s, ref, { id: `t${i}`, at: 1, by: 'camera', kind: 'take', status: 'review', url: 'u.mp4', draft: { taskId: 'x', modelKey: 'seedance25', at: Date.now() } }), ref, `t${i}`); });
    return pickVersion(addVersion(s, { at: 'cut' }, { id: 'c', at: 2, by: 'editor', kind: 'cut', status: 'review', url: 'c.mp4', takes: ['t0', 't1'] }), { at: 'cut' }, 'c');
  };
  test('one rendering never holds up the next, and the cut waits for them all', () => {
    let s = twoScenes();
    const [one, two] = s.scenes;
    expect(stepsOf(s).filter((x) => x.final).length).toBe(2);
    const ref = { at: 'take', sceneId: one.id, shotId: one.shots[0].id };
    s = addVersion(s, ref, { id: 'f0', parent: 't0', final: true, at: 3, by: 'camera', kind: 'take', status: 'running' });
    const steps = stepsOf(s);
    expect(steps.filter((x) => x.final).map((x) => x.final.sceneId)).toEqual([two.id]);
    expect(steps.some((x) => x.id === 'cut.assemble')).toBe(false);
  });
  test('all finals circled: the cut again', () => {
    let s = twoScenes();
    s.scenes.forEach((sc, i) => { const ref = { at: 'take', sceneId: sc.id, shotId: sc.shots[0].id }; s = pickVersion(addVersion(s, ref, { id: `f${i}`, parent: `t${i}`, final: true, at: 3, by: 'camera', kind: 'take', status: 'review', url: 'f.mov', res: '1080p' }), ref, `f${i}`); });
    expect(nextStep(s, { type: 'cut' }).run).toMatchObject({ agent: 'editor', action: 'assemble' });
  });
});

describe('the stages as they stand', () => {
  test('a new view waits under Scenes, a new plate under Cast & World', () => {
    let s = laidOut();
    const view = s.elements.find((e) => e.viewOf);
    const place = s.elements.find((e) => !e.viewOf);
    s = addVersion(s, { at: 'element', id: view.id }, { id: 'v', at: 1, kind: 'plate', status: 'review' });
    s = addVersion(s, { at: 'element', id: place.id }, { id: 'p', at: 1, kind: 'plate', status: 'review' });
    expect(stageStates(s).fresh).toMatchObject({ scenes: 1, world: 1 });
  });
  test('counts what is done and what waits', () => {
    const st = stageStates(addVersion(laidOut(), { at: 'cut' }, { id: 'c', kind: 'cut', status: 'review', at: 1 }));
    expect(st.script.done).toBe(true);
    expect(st.world.count).toMatch(/^0\//);
    expect(st.scenes.count).toBe('0/1');
    expect(st.fresh.cut).toBe(1);
  });
});

describe('the film style', () => {
  test('a prompt carries it once; with none set, nothing is added', () => {
    const s = { ...emptyStudio(), style: 'Anime' };
    expect(withFilmStyle(s, 'She walks.')).toBe('She walks.\nVisual style: Anime.');
    expect(withFilmStyle(s, 'An anime girl walks.')).toBe('An anime girl walks.');
    expect(withFilmStyle(emptyStudio(), 'She walks.')).toBe('She walks.');
  });
  test('a film saved before it existed opens on the script', () => {
    const { style: _gone, ...old } = emptyStudio();
    expect(loadStudio(old).style).toBe('');
    expect(loadStudio({ ...old, style: 'Anime' }).style).toBe('Anime');
  });
});
