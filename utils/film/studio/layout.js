// THE FILM LAID OUT — what a shot list and a scene's blocking do to the film, whoever asked for them.
import { findElement, findScene, findShot, newElement, newScene, newShot, pad2, shotNumber, tokenized, uid } from './model';
import { sceneMotion } from '../core/storyboard';

const lower = (x) => String(x || '').trim().toLowerCase();
// An element by its exact name (names are handed to the planners, so nothing is guessed).
export const elementNamed = (elements, kind, name) => elements.find((e) => !e.viewOf && e.kind === kind && lower(e.name) === lower(name)) || null;

// PICKING THE SHOT LIST — the film laid out: every person and place it names that Cast & World
// lacks becomes an element without a plate (Casting's to-do); each scene becomes a scene (its
// slugline, place, the script's words, who is in it) with its blocking picked and its shot made.
export const applyShotList = (s, payload) => {
  let elements = s.elements;
  const add = (kind, name, aka = []) => { if (![name, ...aka].some((n) => elementNamed(elements, kind, n))) elements = [...elements, newElement({ kind, name })]; };
  (payload.people || []).forEach((p) => add('character', p.name, p.aka));
  (payload.places || []).forEach((name) => add('location', name));
  const scenes = payload.scenes.map((sc) => newScene(`${sc.place}${sc.time ? ` · ${sc.time}` : ''}`, sc));
  let next = { ...s, shotList: payload, elements, scenes };
  payload.scenes.forEach((sc, i) => {
    if (!sc.sheet) return;
    const id = scenes[i].id;
    const ids = (sc.people || []).map((n) => elementNamed(next.elements, 'character', n)?.id).filter(Boolean);
    const blocking = { ...sc.sheet, place: sc.place, elementIds: ids, unplated: [] };
    const vid = uid('v-');
    next = { ...next, scenes: next.scenes.map((x) => (x.id === id ? { ...x, blocking: { versions: [{ id: vid, at: Date.now(), by: 'ad', kind: 'blocking', status: 'picked', payload: blocking }], picked: vid } } : x)) };
    next = applyBlocking(next, id, blocking);
  });
  return next;
};

// PICKING A SCENE'S BLOCKING — the scene's shot takes its text and sheet (a blocked shot already
// there keeps its takes); the place gets its landmarks; each view becomes an element drawn later
// from the place's plate; people and props the sheet has with no plate become elements without one.
export const applyBlocking = (s, sceneId, payload) => {
  const sc = findScene(s, sceneId);
  if (!sc) return s;
  let elements = s.elements;
  const ensure = (kind, name, extra = {}) => {
    const found = elementNamed(elements, kind, name);
    if (found) return found;
    const el = { ...newElement({ kind, name }), ...extra };
    elements = [...elements, el];
    return el;
  };
  const loc = payload.place ? ensure('location', payload.place) : null;
  if (loc && !loc.landmarks) elements = elements.map((e) => (e.id === loc.id ? { ...e, landmarks: payload.landmarks } : e));
  const extra = (payload.unplated || []).map((u) => ensure(u.kind, u.name).id);
  const viewIds = loc ? payload.views.map((vw) => {
    const name = `${loc.name} · ${vw.name}`;
    const found = elements.find((e) => e.viewOf === loc.id && e.name === name);
    if (found) return found.id;
    const el = { ...newElement({ kind: 'location', name, desc: vw.from }), viewOf: loc.id };
    elements = [...elements, el];
    return el.id;
  }) : [];
  const ids = [...new Set([...(payload.elementIds || []), ...extra, ...viewIds])];
  const next = { ...s, elements };
  const sheet = { place: payload.place, landmarks: payload.landmarks, views: payload.views, start: payload.start, beats: payload.beats, against: payload.against, end: payload.end, viewIds };
  const fields = { title: sc.title, quote: sc.text || '', seconds: payload.seconds, motion: tokenized(next, sceneMotion(payload), ids), audio: payload.sound, elementIds: ids, sheet, blocked: true };
  const blocked = sc.shots.find((sh) => sh.blocked);
  const shots = blocked ? sc.shots.map((sh) => (sh.id === blocked.id ? { ...sh, ...fields } : sh)) : [...sc.shots, { ...newShot(fields), blocked: true }];
  return { ...next, scenes: next.scenes.map((x) => (x.id === sceneId ? { ...x, shots } : x)) };
};

export const containerLabel = (s, ref) => {
  if (ref.at === 'brief') return 'Script';
  if (ref.at === 'cut') return 'Cut';
  if (ref.at === 'element') return findElement(s, ref.id)?.name || 'Element';
  if (ref.at === 'scene') { const i = s.scenes.findIndex((x) => x.id === ref.sceneId); return i >= 0 ? `${pad2(i + 1)} ${s.scenes[i].title} · blocking` : 'Scene'; }
  const sh = findShot(s, ref.sceneId, ref.shotId);
  return sh ? `${pad2(shotNumber(s, sh.id))} ${sh.title}` : 'Shot';
};
