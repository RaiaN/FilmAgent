// THE STAGES — where the film stands in Script → Cast & World → Scenes → Cut, read from the film as
// it is, never stored.
import { findElement, pickedOf, shotListFresh, newWork, takeOf } from './model';

export const STAGES = [
  { id: 'script', label: 'Script' },
  { id: 'world', label: 'Cast & World' },
  { id: 'scenes', label: 'Scenes' },
  { id: 'cut', label: 'Cut' },
];

const STAGE_OF = { brief: 'script', world: 'world', element: 'world', scenes: 'scenes', scene: 'scenes', shot: 'scenes', cut: 'cut' };
export const stageOf = (scope) => STAGE_OF[scope?.type] || 'script';
export const scopeOfStage = (id) => ({ script: { type: 'brief' }, world: { type: 'world' }, scenes: { type: 'scenes' }, cut: { type: 'cut' } }[id]);
const STAGE_OF_REF = { brief: 'script', element: 'world', scene: 'scenes', take: 'scenes', cut: 'cut' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const running = (c) => (c?.versions || []).some((v) => v.status === 'running');
const allShots = (s) => s.scenes.flatMap((sc) => sc.shots);

// What Casting and the Designer fill: everyone and everywhere, without the views of a place.
export const castOf = (s) => s.elements.filter((e) => !e.viewOf);
export const viewsOfShot = (s, shot) => (shot.sheet?.viewIds || []).map((id) => findElement(s, id)).filter(Boolean);

export const stageStates = (s) => {
  const all = newWork(s);
  // A view of a place belongs to the scene that needs it, not to Cast & World.
  const stageOfWork = (x) => (x.ref.at === 'element' && findElement(s, x.ref.id)?.viewOf ? 'scenes' : STAGE_OF_REF[x.ref.at]);
  const at = (id) => (x) => stageOfWork(x) === id;
  const running_ = (id) => {
    if (id === 'script') return running(s.brief);
    if (id === 'world') return s.elements.some((e) => !e.viewOf && running(e));
    if (id === 'scenes') return s.scenes.some((sc) => running(sc.blocking) || sc.shots.some((sh) => running(sh.takes) || viewsOfShot(s, sh).some(running)));
    return running(s.cut);
  };
  const cast = castOf(s);
  const plated = cast.filter((e) => pickedOf(e)).length;
  const shots = allShots(s);
  const taken = shots.filter(takeOf).length;
  const script = String(s.script || '').trim();
  const listed = !script ? s.scenes.length > 0 : shotListFresh(s);
  return {
    script: { done: listed, count: listed && s.scenes.length ? plural(s.scenes.length, 'scene') : '' },
    world: { done: cast.length > 0 && plated === cast.length, count: cast.length ? `${plated}/${cast.length}` : '' },
    scenes: { done: shots.length > 0 && taken === shots.length, count: shots.length ? `${taken}/${shots.length}` : '' },
    cut: { done: !!pickedOf(s.cut), count: '' },
    fresh: Object.fromEntries(STAGES.map(({ id }) => [id, all.fresh.filter(at(id)).length])),
    working: Object.fromEntries(STAGES.map(({ id }) => [id, running_(id)])),
  };
};

// The picture that stands for a scene: its first take, else a view, else
// the place's plate.
export const sceneHero = (s, sc) => {
  const take = sc.shots.map(takeOf).find(Boolean);
  if (take) return take;
  const view = sc.shots.flatMap((sh) => viewsOfShot(s, sh)).map((el) => pickedOf(el)).find(Boolean);
  if (view) return view;
  const place = s.elements.find((e) => !e.viewOf && e.kind === 'location' && e.name.toLowerCase() === String(sc.place || '').toLowerCase());
  return pickedOf(place) || null;
};
