// ONE FILM, SEVERAL WRITERS. The agent changes the film on the server while a Studio tab holds its
// own copy, so saves merge instead of overwriting. Versions, elements, scenes, shots and messages
// have ids and merge by id; what one side removed is recorded (`removed`) so a merge can't bring it
// back. Only the tab edits the script and the like, so its values win on those fields.
import { allVersions } from './model';

const FINISHED_STATUS = { review: 1, kept: 2, picked: 2, rejected: 2, failed: 2 };
const rank = (v) => FINISHED_STATUS[v.status] || 0;
const typeOf = (v) => (v.kind === 'take' || v.kind === 'cut' ? 'video' : v.kind === 'plate' ? 'image' : null);

const mergeVersion = (a, b) => {
  // The further along wins: a render the other side still sees running has finished here.
  const [older, newer] = rank(a) > rank(b) ? [b, a] : [a, b];
  const out = { ...older, ...newer };
  const labelled = (a.labelAt || 0) > (b.labelAt || 0) ? a : b;
  if (labelled.labelAt) Object.assign(out, { label: labelled.label, tags: labelled.tags, labelAt: labelled.labelAt });
  out.name = a.name || b.name || out.name;
  return out;
};

const byId = (server, local, gone, merge) => {
  const seen = new Map((server || []).map((x) => [x.id, x]));
  const out = (local || []).filter((x) => !gone[x.id]).map((x) => {
    const other = seen.get(x.id);
    seen.delete(x.id);
    return other ? merge(other, x) : x;
  });
  seen.forEach((x) => { if (!gone[x.id]) out.push(x); });
  return out;
};

// The later pick stands; every version's status follows it.
const mergeContainer = (server, local, gone) => {
  if (!server) return local;
  if (!local) return server;
  const chosen = (server.pickedAt || 0) > (local.pickedAt || 0) ? server : local;
  const versions = byId(server.versions, local.versions, gone, mergeVersion).map((v) => {
    if (v.id === chosen.picked) return v.status === 'picked' ? v : { ...v, status: 'picked' };
    return v.status === 'picked' ? { ...v, status: 'kept' } : v;
  });
  return { ...server, ...local, versions, picked: chosen.picked ?? null, ...(chosen.pickedAt ? { pickedAt: chosen.pickedAt } : {}) };
};

const mergeShot = (gone) => (a, b) => ({ ...a, ...b, takes: mergeContainer(a.takes, b.takes, gone) });
const mergeScene = (gone) => (a, b) => ({ ...a, ...b, blocking: mergeContainer(a.blocking, b.blocking, gone), shots: byId(a.shots, b.shots, gone, mergeShot(gone)) });
const mergeElement = (gone) => (a, b) => ({ ...a, ...b, ...mergeContainer(a, b, gone) });

// Two films are the same film if their content is, whatever order their fields came in. Comparing
// raw JSON would see a difference after every merge, and each side would save again for ever.
const sorted = (x) => {
  if (Array.isArray(x)) return x.map(sorted);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, sorted(x[k])]));
  return x;
};
export const sameFilm = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

// `server` and `local` are both whole films. Returns the merged film.
export const mergeStudio = (server, local) => {
  if (!server) return local;
  if (!local) return server;
  const removed = { ...(server.removed || {}), ...(local.removed || {}) };
  const threads = {};
  [...new Set([...Object.keys(server.threads || {}), ...Object.keys(local.threads || {})])].forEach((key) => {
    threads[key] = byId((server.threads || {})[key], (local.threads || {})[key], removed, (a, b) => ({ ...a, ...b }));
  });
  const names = { ...(server.names || {}) };
  Object.entries(local.names || {}).forEach(([k, n]) => { names[k] = Math.max(names[k] || 0, n); });
  const out = {
    ...server,
    ...local,
    removed,
    names,
    threads,
    brief: mergeContainer(server.brief, local.brief, removed),
    cut: mergeContainer(server.cut, local.cut, removed),
    unplaced: mergeContainer(server.unplaced, local.unplaced, removed),
    elements: byId(server.elements, local.elements, removed, mergeElement(removed)),
    scenes: byId(server.scenes, local.scenes, removed, mergeScene(removed)),
  };
  // Placing moves a version out of the pool: a copy still there on the other side is the same one.
  const placed = new Set(allVersions({ ...out, unplaced: { versions: [] } }).map((x) => x.v.id));
  if (out.unplaced?.versions?.some((v) => placed.has(v.id))) out.unplaced = { ...out.unplaced, versions: out.unplaced.versions.filter((v) => !placed.has(v.id)) };
  return out;
};

const idsOf = (s) => {
  const ids = new Set();
  const add = (list) => (list || []).forEach((x) => ids.add(x.id));
  (s.elements || []).forEach((e) => { ids.add(e.id); add(e.versions); });
  (s.scenes || []).forEach((sc) => {
    ids.add(sc.id);
    add(sc.blocking?.versions);
    (sc.shots || []).forEach((sh) => { ids.add(sh.id); add(sh.takes?.versions); });
  });
  add(s.brief?.versions);
  add(s.cut?.versions);
  add(s.unplaced?.versions);
  Object.values(s.threads || {}).forEach(add);
  return ids;
};

// What was there before and is not now was removed, and stays removed through later merges.
export const withRemovals = (before, now, at = Date.now()) => {
  if (!before || !now) return now;
  const still = idsOf(now);
  const gone = [...idsOf(before)].filter((id) => !still.has(id));
  if (!gone.length) return now;
  return { ...now, removed: { ...(now.removed || {}), ...Object.fromEntries(gone.map((id) => [id, at])) } };
};

// Every picture and video has a short name for the session and Studio alike: R1, T3. Oldest first,
// and a name is never used twice.
export const nameVersions = (s) => {
  const unnamed = allVersions(s).filter((x) => typeOf(x.v) && !x.v.name).sort((a, b) => (a.v.at || 0) - (b.v.at || 0));
  if (!unnamed.length) return s;
  const names = { ...(s.names || {}) };
  const given = new Map(unnamed.map(({ v }) => {
    const prefix = typeOf(v) === 'video' ? 'T' : 'R';
    names[prefix] = (names[prefix] || 0) + 1;
    return [v.id, `${prefix}${names[prefix]}`];
  }));
  const name = (c) => (c?.versions?.some((v) => given.has(v.id)) ? { ...c, versions: c.versions.map((v) => (given.has(v.id) ? { ...v, name: given.get(v.id) } : v)) } : c);
  return {
    ...s,
    names,
    unplaced: name(s.unplaced),
    cut: name(s.cut),
    elements: s.elements.map(name),
    scenes: s.scenes.map((sc) => ({ ...sc, shots: sc.shots.map((sh) => ({ ...sh, takes: name(sh.takes) })) })),
  };
};
