// THE STAGES — where the film stands, read from the film as it is.
import { stageStates } from '../utils/film/studio/guide';
import { emptyStudio, addVersion, pickVersion, scriptHash, withFilmStyle, loadStudio } from '../utils/film/studio/model';
import { applyShotList } from '../utils/film/studio/layout';

const SCRIPT = 'INT. FLAT – NIGHT\nDAN opens the door.';
const SHEET = { seconds: 10, landmarks: 'door', views: [{ name: 'Wide', from: 'by the window' }], start: 'Dan at the door.', beats: [{ view: 'Wide', action: 'Dan opens the door.', looksAt: 'the door' }], against: '', sound: 'rain', end: 'Dan inside.' };
const LIST = { people: [{ name: 'Dan', aka: [] }], places: ['Flat'], scriptHash: scriptHash(SCRIPT), scenes: [{ n: 1, slug: 'INT. FLAT – NIGHT', place: 'Flat', time: 'Night', text: 'DAN opens the door.', people: ['Dan'], sheet: SHEET }] };
const laidOut = () => applyShotList({ ...emptyStudio(), script: SCRIPT }, LIST);
const plate = (s, el, id = `p-${el.id}`) => { const ref = { at: 'element', id: el.id }; return pickVersion(addVersion(s, ref, { id, at: 1, by: 'casting', kind: 'plate', status: 'review', url: 'p.png' }), ref, id); };
const allPlated = () => { const s = laidOut(); return s.elements.reduce((x, el) => plate(x, el), s); };

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
    expect(st.fresh.cut).toBe(0);
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
