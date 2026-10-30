// EVERY STUDIO PAGE RENDERS — each page, the crew panel, the viewer and Generations, mounted on a
// film at each stage: just laid out (nothing circled yet), and in full work (plates, new, picked
// and failed versions, a cut, every kind of crew message).
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import fs from 'fs';
import { DirectPage, Thread } from '../components/studio/DirectView';
import { Viewer } from '../components/studio/Viewer';
import GenerationsView from '../components/studio/GenerationsView';
import StudioPlayground from '../components/studio/StudioPlayground';
import { emptyStudio, allVersions, newWork, pickVersion, addVersion, threadKeyOf } from '../utils/film/studio/model';
import { applyShotList } from '../utils/film/studio/runners';
import { nextStep } from '../utils/film/studio/guide';

global.IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = () => {};
const SHEET = { seconds: 10, landmarks: 'door at one end', views: [{ name: 'Wide', from: 'by the window' }, { name: 'Close', from: 'at the door' }], start: 'Dan at the door.', beats: [{ view: 'Wide', action: 'Dan opens the door.', looksAt: 'the door' }, { view: 'Close', action: 'Dan looks in.', looksAt: 'the dark' }], against: '', sound: 'rain', end: 'Dan inside.' };
const LIST = { people: [{ name: 'Dan', aka: [] }], places: ['Flat'], scriptHash: '0', scenes: [{ n: 1, slug: 'INT. FLAT – NIGHT', place: 'Flat', time: 'Night', text: 'DAN opens the door.', people: ['Dan'], sheet: SHEET }, { n: 2, slug: 'INT. FLAT – NIGHT', place: 'Flat', time: 'Night', text: 'DAN waits.', people: ['Dan'], sheet: null, error: 'failed the checks' }] };
const laidOut = () => applyShotList({ ...emptyStudio(), script: 'INT. FLAT – NIGHT\nDAN opens the door.', brief: { versions: [{ id: 'b1', kind: 'shotList', status: 'picked', by: 'ad', payload: LIST }] } }, LIST);
const inWork = () => {
  let s = laidOut();
  const dan = s.elements.find((e) => e.name === 'Dan');
  const sc = s.scenes[0];
  const sh = sc.shots[0];
  const take = { at: 'take', sceneId: sc.id, shotId: sh.id };
  const plate = { at: 'element', id: dan.id };
  const v = (id, x) => ({ id, at: 1, by: 'camera', kind: 'take', url: 'u.mp4', ...x });
  s = addVersion(s, plate, { id: 'p1', at: 1, by: 'casting', kind: 'plate', status: 'review', url: 'p.png', prompt: 'a man', entry: { type: 'character', name: 'Dan', facePrompt: 'a man' } });
  s = addVersion(s, plate, { id: 'p2', at: 2, by: 'casting', kind: 'plate', status: 'failed', error: 'refused', prompt: 'a man' });
  s = pickVersion(s, plate, 'p1');
  s = addVersion(s, take, v('t1', { status: 'review', res: '480p', draft: { taskId: 'x', modelKey: 'seedance25Premium', at: Date.now() } }));
  s = addVersion(s, take, v('t2', { status: 'failed', error: 'refused', prompt: 'p' }));
  s = addVersion(s, take, v('t3', { status: 'running', taskId: 'y' }));
  s = pickVersion(s, take, 't1');
  s = addVersion(s, take, v('t4', { status: 'review', res: '4K', final: true, parent: 't1', format: 'mov' }));
  s = addVersion(s, { at: 'cut' }, { id: 'c1', at: 3, by: 'editor', kind: 'cut', status: 'review', url: 'c.mp4', takes: ['t1'] });
  s = addVersion(s, { at: 'brief' }, { id: 'w1', at: 4, by: 'writers', kind: 'script', status: 'review', title: 'Screenplay', text: 'INT. A – DAY' });
  s = addVersion(s, { at: 'scene', sceneId: sc.id }, { id: 'k1', at: 5, by: 'ad', kind: 'blocking', status: 'review', payload: { ...SHEET, place: 'Flat', unplated: [] } });
  const key = threadKeyOf({ type: 'scene', id: sc.id });
  s = { ...s, threads: { ...s.threads, [key]: [
    { id: 'm1', from: 'you', kind: 'request', agent: 'camera', action: 'draft', text: 'slower', at: 1 },
    { id: 'm2', from: 'camera', kind: 'delivery', summary: '1 draft', items: [{ ref: take, vid: 't1' }, { ref: take, vid: 't2' }, { ref: take, vid: 't3' }], stage: 'rendering', at: 1 },
    { id: 'm3', from: 'script', kind: 'reply', text: 'Done.', change: { screenplay: true, scenes: [1], undo: { scenes: [] } }, unknown: ['scene 9 is not in the film'], at: 1 },
    { id: 'm4', from: 'cast', kind: 'reply', text: 'Done.', change: { renamed: ['A → B'], described: ['B'], added: ['C'], removed: ['D'], undo: { elements: [], added: [] } }, at: 1 },
    { id: 'm5', from: 'camera', kind: 'question', text: 'No plate.', options: [{ label: 'Go', req: {} }], at: 1 },
    { id: 'm6', from: 'camera', kind: 'error', text: 'No.', at: 1 },
    { id: 'm7', from: 'studio', kind: 'ask', text: 'hi', handles: ['AD'], at: 1 },
    { id: 'm8', from: 'camera', kind: 'delivery', items: [], finished: true, at: 1 },
    { id: 'm9', from: 'camera', kind: 'sheet', sheetId: 'gone', at: 1 },
  ] } };
  return s;
};
const mount = async (el) => {
  const box = document.createElement('div');
  const root = createRoot(box);
  await act(async () => { root.render(el); });
  const html = box.innerHTML;
  await act(async () => { root.unmount(); });
  return html;
};
const noop = () => {};
const films = { 'just laid out': laidOut, 'in full work': inWork };
if (process.env.STUDIO_STATE) films['from a file'] = () => JSON.parse(fs.readFileSync(process.env.STUDIO_STATE, 'utf8'));
const scopesOf = (s) => [
  { type: 'brief' }, { type: 'world' }, { type: 'scenes' }, { type: 'cut' },
  ...s.elements.map((e) => ({ type: 'element', id: e.id })),
  ...s.scenes.flatMap((sc) => [{ type: 'scene', id: sc.id }, ...sc.shots.map((sh) => ({ type: 'shot', sceneId: sc.id, id: sh.id }))]),
];

describe.each(Object.keys(films))('a film %s', (name) => {
  const s = films[name]();
  test('every page and the crew panel render at every place you can stand', async () => {
    for (const scope of scopesOf(s)) {
      // eslint-disable-next-line no-await-in-loop
      await mount(<DirectPage s={s} set={noop} scope={scope} setScope={noop} pick={noop} review={noop} toast={noop} crew={{ final: noop, send: noop }} canvas={null} onStale={{ keep: noop, redo: noop }} />);
      // eslint-disable-next-line no-await-in-loop
await mount(<Thread s={s} scope={scope.type === 'scenes' ? { type: 'brief' } : scope} step={nextStep(s, scope)} onStep={noop} target="" onClearTarget={noop} onRequest={noop} answer={noop} review={noop} ask={noop} text="" setText={noop} undoShot={noop} pick={noop} reject={noop} stop={noop} />);
    }
  });
  test('the viewer renders every version', async () => {
    for (const { ref, v } of allVersions(s)) {
      // eslint-disable-next-line no-await-in-loop
      await mount(<Viewer s={s} set={noop} toast={noop} view={{ ref, vid: v.id }} setView={noop} onPick={noop} onNote={noop} onFinal={noop} onReject={noop} onRedraw={noop} canvas={null} waiting={newWork(s).fresh} onNextNew={noop} />);
    }
  });
  test('Generations renders', async () => { await mount(<GenerationsView s={s} set={noop} open={noop} />); });
});

describe('the Studio shell', () => {
  test('opens a film with its stages and what waits for you in the header', async () => {
    const html = await mount(<StudioPlayground projectStudio={{ projectId: 'p', nonce: 1, data: { ...inWork(), scenes: inWork().scenes.map((sc) => ({ ...sc, shots: sc.shots.map((sh) => ({ ...sh, takes: { ...sh.takes, versions: sh.takes.versions.filter((v) => v.status !== 'running') } })) })) } }} onStudioChange={noop} projectTitle="Test" />);
    expect(html).toMatch(/\d+ new/);
    ['Script', 'Cast &amp; World', 'Scenes', 'Cut'].forEach((stage) => expect(html).toContain(stage));
    expect(html).toMatch(/Generations/);
    expect(html).not.toMatch(/>Review</);
  });
});

describe('failed work stays out of sight', () => {
  test('the feed says how much did not render; the shot card and the version strip do not show it', async () => {
    const s = inWork();
    const sc = s.scenes[0];
    const feed = await mount(<Thread s={s} scope={{ type: 'scene', id: sc.id }} target="" onClearTarget={noop} onRequest={noop} answer={noop} review={noop} ask={noop} text="" setText={noop} undoShot={noop} pick={noop} reject={noop} stop={noop} />);
    expect(feed).toMatch(/1 didn.t render/);
    const view = await mount(<Viewer s={s} set={noop} toast={noop} view={{ ref: { at: 'take', sceneId: sc.id, shotId: sc.shots[0].id }, vid: 't1' }} setView={noop} onPick={noop} onNote={noop} onFinal={noop} onReject={noop} onRedraw={noop} canvas={null} waiting={[]} onNextNew={noop} />);
    expect(view).not.toMatch(/>failed</);
    expect(view).toMatch(/Final again · 1080p|Final · 1080p/);
    expect(view).toMatch(/· 4K/);
  });
});
