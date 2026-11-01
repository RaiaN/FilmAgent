/**
 * @jest-environment node
 */
// ONE FILM, SEVERAL WRITERS: the agent on the server and a tab in the browser change the same film.
// Merging keeps everything both did, and what was removed stays removed.
import { mergeStudio, nameVersions, sameFilm, withRemovals } from '../utils/film/studio/sync';
import { addVersion, emptyStudio, newElement, newScene, newShot, pickVersion, allVersions } from '../utils/film/studio/model';

const take = (id, x = {}) => ({ id, at: 1, kind: 'take', status: 'review', ...x });
const filmWithShot = () => {
  const sh = newShot({ title: 'One' });
  const sc = { ...newScene('Scene'), shots: [sh] };
  return { s: { ...emptyStudio(), scenes: [sc] }, ref: { at: 'take', sceneId: sc.id, shotId: sh.id } };
};

describe('merging', () => {
  test('takes added on both sides are all kept', () => {
    const { s, ref } = filmWithShot();
    const merged = mergeStudio(addVersion(s, ref, take('a')), addVersion(s, ref, take('b')));
    expect(allVersions(merged).map((x) => x.v.id).sort()).toEqual(['a', 'b']);
  });
  test('a render the tab still sees running has finished on the server', () => {
    const { s, ref } = filmWithShot();
    const server = addVersion(s, ref, take('a', { status: 'review', url: 'done.mp4' }));
    const local = addVersion(s, ref, take('a', { status: 'running', taskId: 'x' }));
    const v = allVersions(mergeStudio(server, local))[0].v;
    expect(v).toMatchObject({ status: 'review', url: 'done.mp4' });
  });
  test('the later pick stands, and statuses follow it', () => {
    const { s, ref } = filmWithShot();
    const both = addVersion(addVersion(s, ref, take('a')), ref, take('b'));
    const merged = mergeStudio(pickVersion(both, ref, 'a', 100), pickVersion(both, ref, 'b', 200));
    const v = Object.fromEntries(allVersions(merged).map((x) => [x.v.id, x.v.status]));
    expect(v).toEqual({ a: 'kept', b: 'picked' });
    const back = mergeStudio(pickVersion(both, ref, 'b', 300), pickVersion(both, ref, 'a', 200));
    expect(Object.fromEntries(allVersions(back).map((x) => [x.v.id, x.v.status]))).toMatchObject({ b: 'picked' });
  });
  test("the tab's script and style stand", () => {
    const merged = mergeStudio({ ...emptyStudio(), script: 'old', style: 'old' }, { ...emptyStudio(), script: 'new', style: 'clay' });
    expect(merged).toMatchObject({ script: 'new', style: 'clay' });
  });
  test('the newer label wins, whichever side has it', () => {
    const { s, ref } = filmWithShot();
    const server = addVersion(s, ref, take('a', { label: 'hero', tags: ['scene 2'], labelAt: 5 }));
    const local = addVersion(s, ref, take('a', { label: '', tags: [] }));
    expect(allVersions(mergeStudio(server, local))[0].v).toMatchObject({ label: 'hero', tags: ['scene 2'] });
  });
  test('what a side removed does not come back from the other', () => {
    const { s, ref } = filmWithShot();
    const before = addVersion(s, ref, take('a'));
    const tab = withRemovals(before, { ...before, scenes: [] });
    expect(mergeStudio(before, tab).scenes).toEqual([]);
    expect(tab.removed[ref.sceneId]).toBeTruthy();
  });
  test('removing nothing changes nothing', () => {
    const { s } = filmWithShot();
    expect(withRemovals(s, s)).toBe(s);
  });
  test('a version placed on one side leaves the pool on both', () => {
    const el = newElement({ kind: 'character', name: 'Morwen' });
    const base = { ...emptyStudio(), elements: [el] };
    const inPool = addVersion(base, { at: 'unplaced' }, { id: 'r', kind: 'plate', status: 'review' });
    const placed = addVersion(base, { at: 'element', id: el.id }, { id: 'r', kind: 'plate', status: 'review' });
    const merged = mergeStudio(placed, inPool);
    expect(merged.unplaced.versions).toEqual([]);
    expect(merged.elements[0].versions.map((v) => v.id)).toEqual(['r']);
  });
  test('a film saved before the pool existed merges', () => {
    const { unplaced, names, removed, ...old } = emptyStudio();
    expect(mergeStudio(old, emptyStudio()).unplaced.versions).toEqual([]);
  });
});

describe('settling', () => {
  test('field order is not a change', () => {
    expect(sameFilm({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(sameFilm({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameFilm({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
  test('merging twice changes nothing more, so neither side saves again', () => {
    const { s, ref } = filmWithShot();
    const server = addVersion(s, ref, take('a', { label: 'x', tags: [], labelAt: 2 }));
    const local = addVersion(s, ref, take('b'));
    const once = mergeStudio(server, local);
    expect(sameFilm(mergeStudio(once, once), once)).toBe(true);
    expect(sameFilm(mergeStudio(JSON.parse(JSON.stringify(once)), once), once)).toBe(true);
  });
});

describe('short names', () => {
  test('pictures and videos get names by age, and a name is never reused', () => {
    const { s, ref } = filmWithShot();
    const film = addVersion(addVersion(addVersion(s, ref, take('b', { at: 2 })), ref, take('a', { at: 1 })), { at: 'unplaced' }, { id: 'p', at: 3, kind: 'plate', status: 'review' });
    const named = nameVersions(film);
    const names = Object.fromEntries(allVersions(named).map((x) => [x.v.id, x.v.name]));
    expect(names).toEqual({ a: 'T1', b: 'T2', p: 'R1' });
    const next = nameVersions(addVersion(named, ref, take('c', { at: 4 })));
    expect(allVersions(next).find((x) => x.v.id === 'c').v.name).toBe('T3');
    expect(nameVersions(named)).toBe(named);
  });
  test('text versions get no name', () => {
    const named = nameVersions(addVersion(emptyStudio(), { at: 'brief' }, { id: 't', kind: 'script', status: 'review' }));
    expect(allVersions(named)[0].v.name).toBeUndefined();
  });
});
