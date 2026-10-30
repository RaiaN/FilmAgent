// THE STUDIO'S FILM — one object, saved inside the project (project.studio).
//
//   brief     the script and the crew's text deliveries (screenplay · script breakdown)
//   elements  Cast & World: characters, places, props — each a set of plate VERSIONS, one picked
//   scenes    numbered scenes (from the picked breakdown, or by hand) → shots; a scene holds its
//             blocking versions, a shot its take versions (the circled one picked)
//   cut       assembled cuts (versions)
//   threads   the conversation per scope: requests, deliveries, questions
//
// Every crew deliverable is a VERSION in a container ({ versions, picked }) with a status:
// running → review (new, waiting for the director) → picked · kept (seen, not the pick) ·
// rejected, or failed. Nothing enters the film until the director picks it; a note makes the
// next version (parent + note).
// Pure functions only — the React shell owns state, the runners own the calls.

export const uid = (p = '') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const ELEMENT_KINDS = ['character', 'location', 'prop'];
export const KIND_LABEL = { character: 'Cast', location: 'Places', prop: 'Props' };

export const emptyStudio = () => ({
  v: 1,
  script: '',
  // The film's video model; a shot may name its own.
  videoModel: 'seedance25',
  // The 1st AD's shot list as picked (people, places, scenes and their shots); it knows which
  // script it read.
  shotList: null,
  brief: { versions: [] },
  elements: [],
  scenes: [],
  cut: { versions: [], picked: null },
  threads: {},
  gens: 0,
});

// A saved studio, shape-checked: missing parts come back empty (a project saved before a
// part existed), unknown fields ride along untouched.
export const loadStudio = (input) => {
  const base = emptyStudio();
  if (!input || typeof input !== 'object') return base;
  // The brief is the script and its text deliveries; nothing else rides along from an older save.
  const { look: _look, sheets: _sheets, ...data } = input;
  const brief = { ...base.brief, ...(data.brief || {}) };
  const versions = (brief.versions || []).filter((v) => v.kind === 'script' || v.kind === 'shotList');
  return {
    ...base,
    ...data,
    brief: { ...brief, versions },
    cut: { ...base.cut, ...(data.cut || {}) },
    elements: Array.isArray(data.elements) ? data.elements : [],
    // A shot carries its takes; nothing else rides along from an older save.
    scenes: (Array.isArray(data.scenes) ? data.scenes : []).map((sc) => ({ blocking: { versions: [], picked: null }, ...sc, shots: (sc.shots || []).map(({ stills: _stills, ...sh }) => sh) })),
    threads: data.threads && typeof data.threads === 'object' ? data.threads : {},
  };
};

// Anything the director or the crew put in: a script, any version (a
// delivery waiting for review), elements, scenes, a thread message.
export const hasStudioWork = (s) => !!(s && (String(s.script || '').trim()
  || (s.brief?.versions || []).length || (s.cut?.versions || []).length || (s.elements || []).length || (s.scenes || []).length
  || Object.values(s.threads || {}).some((m) => (m || []).length)));

// ---- scopes ------------------------------------------------------------------------
// A scope is where the director is standing: { type: 'brief' | 'world' | 'element' |
// 'scene' | 'shot' | 'cut', id?, sceneId? }. Its thread key groups the conversation —
// a shot talks in its scene's thread.
export const threadKeyOf = (scope) => {
  if (!scope) return 'brief';
  if (scope.type === 'element') return `el:${scope.id}`;
  if (scope.type === 'scene') return `scene:${scope.id}`;
  if (scope.type === 'shot') return `scene:${scope.sceneId}`;
  return scope.type;
};
export const sameScope = (a, b) => !!a && !!b && a.type === b.type && (a.id || '') === (b.id || '') && (a.sceneId || '') === (b.sceneId || '');

export const findScene = (s, id) => s.scenes.find((x) => x.id === id) || null;
export const findShot = (s, sceneId, id) => findScene(s, sceneId)?.shots.find((x) => x.id === id) || null;
export const findElement = (s, id) => s.elements.find((x) => x.id === id) || null;
export const shotNumber = (s, shotId) => {
  let n = 0;
  for (const sc of s.scenes) for (const sh of sc.shots) { n += 1; if (sh.id === shotId) return n; }
  return 0;
};
export const pad2 = (n) => String(n).padStart(2, '0');

// ---- containers (anything with versions) ---------------------------------------------
// A ref names one container: { at: 'brief' } · { at: 'element', id } · { at: 'scene',
// sceneId } (its blocking) · { at: 'take', sceneId, shotId } · { at: 'cut' }.
export const containerOf = (s, ref) => {
  if (!ref) return null;
  if (ref.at === 'brief') return s.brief;
  if (ref.at === 'cut') return s.cut;
  if (ref.at === 'element') return findElement(s, ref.id);
  if (ref.at === 'scene') return findScene(s, ref.sceneId)?.blocking || null;
  const shot = findShot(s, ref.sceneId, ref.shotId);
  if (!shot) return null;
  return shot.takes;
};
const mapShot = (s, sceneId, shotId, fn) => ({
  ...s,
  scenes: s.scenes.map((sc) => (sc.id !== sceneId ? sc : { ...sc, shots: sc.shots.map((sh) => (sh.id !== shotId ? sh : fn(sh))) })),
});
export const updateContainer = (s, ref, fn) => {
  if (ref.at === 'brief') return { ...s, brief: fn(s.brief) };
  if (ref.at === 'cut') return { ...s, cut: fn(s.cut) };
  if (ref.at === 'element') return { ...s, elements: s.elements.map((e) => (e.id === ref.id ? fn(e) : e)) };
  if (ref.at === 'scene') return { ...s, scenes: s.scenes.map((sc) => (sc.id === ref.sceneId ? { ...sc, blocking: fn(sc.blocking || { versions: [], picked: null }) } : sc)) };
  return mapShot(s, ref.sceneId, ref.shotId, (sh) => ({ ...sh, takes: fn(sh.takes) }));
};
export const addVersion = (s, ref, version) => updateContainer(s, ref, (c) => ({ ...c, versions: [...(c.versions || []), version] }));
export const patchVersion = (s, ref, vid, patch) => updateContainer(s, ref, (c) => ({
  ...c, versions: (c.versions || []).map((v) => (v.id === vid ? { ...v, ...(typeof patch === 'function' ? patch(v) : patch) } : v)),
}));
export const versionOf = (s, ref, vid) => (containerOf(s, ref)?.versions || []).find((v) => v.id === vid) || null;
export const pickedOf = (c) => (c?.versions || []).find((v) => v.id === c.picked) || null;

// Picking makes the version the container's choice; the one it replaces and the other new
// ones beside it are seen (kept as history).
export const pickVersion = (s, ref, vid) => updateContainer(s, ref, (c) => ({
  ...c,
  picked: vid,
  versions: (c.versions || []).map((v) => {
    if (v.id === vid) return { ...v, status: 'picked' };
    if (v.status === 'picked' || v.status === 'review') return { ...v, status: 'kept' };
    return v;
  }),
}));
export const rejectVersion = (s, ref, vid) => updateContainer(s, ref, (c) => ({
  ...c,
  picked: c.picked === vid ? null : c.picked,
  versions: (c.versions || []).map((v) => (v.id === vid ? { ...v, status: 'rejected' } : v)),
}));

// What the director sees of a container's versions: never a failed one (that lives in
// Generations ▸ Failed only) or an archived one.
export const visible = (v) => !!v && v.status !== 'failed' && !v.archived;

// Archiving takes versions out of sight (Generations and the crew feed) without deleting them;
// unarchiving brings them back. `items` are { ref, vid }.
export const archiveVersions = (s, items, archived = true) => items.reduce((x, { ref, vid }) => patchVersion(x, ref, vid, { archived }), s);

// ---- elements --------------------------------------------------------------------------
export const newElement = ({ kind, name, desc = '' }) => ({ id: uid('el-'), kind, name: String(name || '').trim(), desc: String(desc || '').trim(), versions: [], picked: null });
// The plate a shot sends for an element: its picked version (and a body sheet riding with it).
export const plateOf = (el) => pickedOf(el);

// ---- shot references: tokens → [Image N] ------------------------------------------------
// Shot text names elements with tokens {{el:ID}} — rendered as names for reading and as
// [Image N] for the model, numbered by the order the plates are attached.
const TOKEN = /\{\{el:([a-z0-9-]+)\}\}/g;
export const namedText = (s, text) => String(text || '').replace(TOKEN, (m, id) => findElement(s, id)?.name || 'someone');
const KIND_ORDER = { character: 0, prop: 1, location: 2 };
// The plates a shot attaches, in send order: characters (face, then body sheet), props, places.
export const shotRefs = (s, shot, { opening = null } = {}) => {
  const list = [];
  const imageOf = {};
  // A shot that continues opens on the last frame of the shot before: it leads as [Image 1].
  if (opening) list.push({ url: opening.url, assetId: null, label: 'the last frame of the shot before', opening: true, versionRef: null });
  (shot.elementIds || [])
    .map((id) => findElement(s, id)).filter(Boolean)
    .sort((a, b) => (KIND_ORDER[a.kind] ?? 3) - (KIND_ORDER[b.kind] ?? 3))
    .forEach((el) => {
      const p = plateOf(el);
      if (!p || !(p.cacheUrl || p.url)) return;
      list.push({ url: p.cacheUrl || p.url, assetId: p.assetId || null, label: el.name, elementId: el.id, versionId: p.id });
      imageOf[el.id] = list.length;
      (p.extras || []).forEach((x) => { if (x.url) list.push({ url: x.url, assetId: x.assetId || null, label: `${el.name} · ${x.label}`, elementId: el.id, versionId: p.id, extra: true }); });
    });
  return { list, imageOf };
};
// Edited text back to tokens: each linked element's name becomes its token again, so the
// [Image N] numbering survives a hand edit.
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const tokenized = (s, text, ids = []) => ids.map((id) => findElement(s, id)).filter((e) => e && e.name)
  .sort((a, b) => b.name.length - a.name.length)
  .reduce((t, e) => t.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(e.name)}(?![\\p{L}\\p{N}])`, 'gu'), `$1{{el:${e.id}}}`), String(text || ''));
export const modelText = (s, text, imageOf) => String(text || '').replace(TOKEN, (m, id) => (imageOf[id] ? `[Image ${imageOf[id]}]` : findElement(s, id)?.name || 'someone'));
// The elements a shot uses that have no plate yet — the crew asks before shooting without them.
export const unplatedOf = (s, shot) => (shot.elementIds || []).map((id) => findElement(s, id)).filter((el) => el && !plateOf(el));

// The element versions a take was made with — the basis for staleness.
export const usedOf = (s, shot) => Object.fromEntries((shot.elementIds || []).map((id) => [id, findElement(s, id)?.picked || null]));
// A shot is STALE when its circled take was made with an element version that is no longer
// the picked one — the director changed the cast or the place.
export const staleOf = (s, shot) => {
  const basis = pickedOf(shot.takes);
  if (!basis?.used) return [];
  return Object.entries(basis.used)
    .filter(([id, vid]) => { const el = findElement(s, id); return el && el.picked && el.picked !== vid; })
    .map(([id]) => findElement(s, id).name);
};

// A scene: its title, and — from the shot list — its number, slugline, place, time, the
// script's own words (what the 1st AD blocks) and the people in it; its blocking versions;
// its shots.
export const newScene = (title = '', x = {}) => ({ id: uid('sc-'), title: title || 'New scene', n: x.n || null, slug: x.slug || '', place: x.place || '', time: x.time || '', text: x.text || '', people: x.people || [], blocking: { versions: [], picked: null }, shots: [] });

// ---- the shot list (from a breakdown, by hand, or from footage) ----------------------------
export const newShot = (x) => ({
  id: uid('sh-'),
  title: x.title || 'Shot',
  turn: x.turn || '',
  quote: x.quote || '',
  seconds: x.seconds || 8,
  intExt: x.intExt || '',
  shotTemplate: x.shotTemplate || '',
  motion: x.motion || '',
  body: x.body || '',
  audio: x.audio || '',
  startFrom: x.startFrom || null, // 'previous': starts where the shot before ends
  // The 1st AD's scene sheet: place, landmarks, views (+ their element ids), start, beats
  // (view · action · what everyone looks at), what works against them, end.
  sheet: x.sheet || null,
  elementIds: x.elementIds || [],
  videoModel: x.videoModel || null, // null: the film's model
  takes: { versions: [], picked: null },
});

// ---- review: everything waiting on the director ----------------------------------------
export const containersOf = (s) => {
  const out = [{ ref: { at: 'brief' }, c: s.brief, label: 'Script', scope: { type: 'brief' } }];
  s.elements.forEach((el) => out.push({ ref: { at: 'element', id: el.id }, c: el, label: el.name, scope: { type: 'element', id: el.id } }));
  s.scenes.forEach((sc, i) => out.push({ ref: { at: 'scene', sceneId: sc.id }, c: sc.blocking, label: `${pad2(i + 1)} ${sc.title} · blocking`, scope: { type: 'scene', id: sc.id } }));
  s.scenes.forEach((sc) => sc.shots.forEach((sh) => {
    const n = pad2(shotNumber(s, sh.id));
    const scope = { type: 'shot', sceneId: sc.id, id: sh.id };
    out.push({ ref: { at: 'take', sceneId: sc.id, shotId: sh.id }, c: sh.takes, label: `${n} ${sh.title}`, scope });
  }));
  out.push({ ref: { at: 'cut' }, c: s.cut, label: 'Cut', scope: { type: 'cut' } });
  return out;
};
// What waits for a verdict (oldest first, the order to review in) and what is rendering.
export const newWork = (s) => {
  const all = containersOf(s).flatMap(({ ref, c, label, scope }) => (c?.versions || []).map((v) => ({ ref, v, label, scope })));
  return {
    fresh: all.filter((x) => x.v.status === 'review').sort((a, b) => (a.v.at || 0) - (b.v.at || 0)),
    working: all.filter((x) => x.v.status === 'running').length,
  };
};

// ---- scene status (the spine) ------------------------------------------------------------
export const sceneStatus = (sc) => {
  const shots = sc.shots || [];
  if (!shots.length) return 'written';
  const circled = shots.filter((sh) => sh.takes?.picked).length;
  const finals = shots.filter((sh) => pickedOf(sh.takes)?.res && pickedOf(sh.takes).res !== '480p').length;
  if (finals === shots.length) return 'final';
  if (circled === shots.length) return 'circled';
  if (shots.some((sh) => (sh.takes?.versions || []).length)) return `${circled}/${shots.length} circled`;
  return 'written';
};

// ---- threads ------------------------------------------------------------------------------
export const addMessage = (s, key, msg) => ({ ...s, threads: { ...s.threads, [key]: [...(s.threads[key] || []), { id: uid('m-'), at: Date.now(), ...msg }] } });
export const patchMessage = (s, key, id, patch) => ({ ...s, threads: { ...s.threads, [key]: (s.threads[key] || []).map((m) => (m.id === id ? { ...m, ...patch } : m)) } });

// ---- the board, mirrored ---------------------------------------------------------------------
// Everything made on the project's Canvas is in the Studio too, kept up to date: its plates are
// Cast & World elements (a character's face and body sheet as one element), its SHOT cards are
// ordinary shots of the film (a new card joins the scene its card neighbours are in), their
// takes versions (the circled one circled). A shot and its card stay linked (shot.boardCard),
// whichever side made them; what the Studio itself put on the Canvas is not brought back. A card's [Image N] becomes the element it pointed at. It is a merge: new plates,
// cards and takes come in; what the Studio changed (text, picks, notes) stays the Studio's.
const baseName = (n) => String(n || '').replace(/\s*·\s*(face|body)\s*$/i, '').trim();
const BOARD_ROLES = ['character', 'location', 'prop'];
const isCard = (n) => n && (n.type === 'cut' || n.type === 'edit');
const takeNodesOf = (nodes, card) => nodes.filter((n) => (n.parentId === `grid-${card.id}` || n.id === `shot-${card.id}`) && n.data?.kind === 'video' && (n.data.cacheUrl || n.data.url) && !n.data.loading && !n.data.studioVersionId);
// Scenes earlier versions kept Canvas work apart in; they are ordinary scenes now.
const LEGACY_BOARD_SCENE = 'sc-board';

export const syncBoard = (s, board) => {
  const nodes = board?.nodes || [];
  const bible = (board?.bible || []).filter((b) => b.url && BOARD_ROLES.includes(b.role));
  let changed = false;
  // Plates → elements (one per role + base name).
  const groups = new Map();
  bible.forEach((b) => {
    const name = baseName(b.name) || b.role;
    const key = `${b.role}|${name.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { kind: b.role, name, entries: [] });
    groups.get(key).entries.push(b);
  });
  let elements = s.elements;
  const elementOfEntry = {};
  [...groups.values()].forEach((g) => {
    const face = g.entries.find((e) => /·\s*face\s*$/i.test(e.name)) || g.entries.find((e) => !/·\s*body\s*$/i.test(e.name)) || g.entries[0];
    const body = g.entries.find((e) => e !== face && /·\s*body\s*$/i.test(e.name));
    let el = elements.find((e) => e.kind === g.kind && e.name.toLowerCase() === g.name.toLowerCase());
    if (!el) { el = newElement({ kind: g.kind, name: g.name }); elements = [...elements, el]; changed = true; }
    const vid = `v-b-${face.id}`;
    if (!(el.versions || []).some((v) => v.id === vid || (v.url && v.url === face.url))) {
      const v = { id: vid, at: Date.now(), by: 'board', kind: 'plate', status: el.picked ? 'kept' : 'picked', url: face.url, cacheUrl: face.url, assetId: face.assetId || null, extras: body ? [{ url: body.url, label: 'body', assetId: body.assetId || null }] : [] };
      const id = el.id;
      elements = elements.map((e) => (e.id !== id ? e : { ...e, versions: [...(e.versions || []), v], picked: e.picked || vid }));
      changed = true;
    }
    g.entries.forEach((e) => { elementOfEntry[e.id] = el.id; });
  });
  // SHOT cards → shots; takes → versions. A card's shot is the one linked to it — or, for a
  // card brought in by hand earlier, the shot holding one of its takes, or the shot in its
  // place in the old "From the board" scene.
  const cards = nodes.filter(isCard).sort((a, b) => (a.data?.cut ?? 0) - (b.data?.cut ?? 0));
  const takesOf = (c) => takeNodesOf(nodes, c).map((tk) => `v-${tk.id}`);
  const legacy = s.scenes.find((sc) => sc.title === 'From the board' && sc.id !== LEGACY_BOARD_SCENE);
  const matches = (sh, c, i, sc) => sh.boardCard === c.id || sh.id === `sh-b-${c.id}` || (c.data?.studioShotId && c.data.studioShotId === sh.id)
    || (sc.id !== LEGACY_BOARD_SCENE && (sh.takes?.versions || []).some((v) => takesOf(c).includes(v.id)))
    || (sc === legacy && legacy.shots[i] === sh && sh.title === (c.data?.beat || 'Shot'));
  const shotOf = (scenes, c, i, { outside = false } = {}) => {
    for (const sc of scenes) {
      if (outside && sc.id === LEGACY_BOARD_SCENE) continue; // eslint-disable-line no-continue
      const sh = sc.shots.find((x) => matches(x, c, i, sc));
      if (sh) return { sc, sh };
    }
    return null;
  };
  let scenes = s.scenes;
  // A shot in the old Board scene that duplicates one brought in by hand (and nobody has
  // worked on) goes.
  const boardScene = scenes.find((sc) => sc.id === LEGACY_BOARD_SCENE);
  if (boardScene) {
    const untouched = (sh) => (sh.takes?.versions || []).every((v) => v.by === 'board');
    const kept = boardScene.shots.filter((sh) => {
      const i = cards.findIndex((c) => sh.id === `sh-b-${c.id}`);
      return !(i >= 0 && untouched(sh) && shotOf(scenes, cards[i], i, { outside: true }));
    });
    if (kept.length !== boardScene.shots.length) {
      scenes = kept.length ? scenes.map((sc) => (sc.id === LEGACY_BOARD_SCENE ? { ...sc, shots: kept } : sc)) : scenes.filter((sc) => sc.id !== LEGACY_BOARD_SCENE);
      changed = true;
    }
  }
  cards.forEach((c, i) => {
    const d = c.data || {};
    const takes = takeNodesOf(nodes, c).map((tk) => ({
      id: `v-${tk.id}`, at: tk.data.draft?.createdAt || Date.now(), by: 'board', kind: 'take', status: 'kept',
      url: tk.data.url, cacheUrl: tk.data.cacheUrl || null, posterUrl: tk.data.posterUrl || '', lastFrameUrl: tk.data.lastFrameUrl || '',
      format: tk.data.format || '', res: tk.data.draft ? '480p' : (d.resolution || '1080p'), prompt: d.promptOverride || '',
      ...(tk.data.draft?.taskId ? { draft: { taskId: tk.data.draft.taskId, modelKey: tk.data.draft.modelKey || 'seedance25', at: tk.data.draft.createdAt || Date.now() } } : {}),
    }));
    const circled = `v-${d.circledTakeId || d.continueTakeId}`;
    const found = shotOf(scenes, c, i);
    if (!found) {
      // The card's reference order (bible plates, then its other chips) is what its [Image N] meant.
      const order = [
        ...(d.refIds || []).map((id) => ({ el: elementOfEntry[id] || null, label: bible.find((b) => b.id === id)?.name || 'the reference' })),
        ...(d.assetRefs || []).map((a) => ({ el: null, label: a.label || 'the reference' })),
      ];
      let motion = String(d.promptOverride || '');
      order.forEach((r, k) => { motion = motion.split(`[Image ${k + 1}]`).join(r.el ? `{{el:${r.el}}}` : r.label); });
      const pick = takes.find((v) => v.id === circled) || takes[takes.length - 1] || null;
      const shot = { ...newShot({ title: d.beat || 'Shot', motion, seconds: Number(d.durationSec) || 8, elementIds: [...new Set(order.filter((r) => r.el).map((r) => r.el))] }), id: `sh-b-${c.id}`, boardCard: c.id };
      shot.takes = { versions: takes.map((v) => (v === pick ? { ...v, status: 'picked' } : v)), picked: pick?.id || null };
      // It joins the scene the card before it is in; else the first scene; else Scene 1.
      const prev = cards.slice(0, i).reverse().map((x) => shotOf(scenes, x, cards.indexOf(x))).find(Boolean);
      const home = prev?.sc || scenes[0];
      scenes = home
        ? scenes.map((sc) => (sc.id === home.id ? { ...sc, shots: [...sc.shots, shot] } : sc))
        : [{ ...newScene('Scene 1'), shots: [shot] }];
      changed = true;
      return;
    }
    const { sc: home, sh: existing } = found;
    const fresh = takes.filter((v) => !existing.takes.versions.some((w) => w.id === v.id));
    if (!fresh.length && existing.boardCard === c.id) return;
    const pick = existing.takes.picked ? null : fresh.find((v) => v.id === circled) || fresh[fresh.length - 1];
    const next = { ...existing, boardCard: c.id, takes: { versions: [...existing.takes.versions, ...fresh.map((v) => (v === pick ? { ...v, status: 'picked' } : v))], picked: existing.takes.picked || pick?.id || null } };
    scenes = scenes.map((sc) => (sc.id !== home.id ? sc : { ...sc, shots: sc.shots.map((x) => (x.id === existing.id ? next : x)) }));
    changed = true;
  });
  // The old Canvas-only scenes become ordinary, numbered scenes.
  if (scenes.some((sc) => sc.title === 'From the board' || (sc.id === LEGACY_BOARD_SCENE && sc.title === 'Board'))) {
    scenes = scenes.map((sc, k) => (sc.title === 'From the board' || (sc.id === LEGACY_BOARD_SCENE && sc.title === 'Board') ? { ...sc, title: `Scene ${k + 1}` } : sc));
    changed = true;
  }
  if (!changed) return s;
  return { ...s, elements, scenes };
};

// ---- every version, newest first (the Generations view) -------------------------------------
export const allVersions = (s) => containersOf(s)
  .flatMap(({ ref, c, label, scope }) => (c?.versions || []).map((v) => ({ ref, v, label, scope })))
  .sort((a, b) => (b.v.at || 0) - (a.v.at || 0));

// ---- the shot list ----------------------------------------------------------------------------
// A short hash of the script, so a shot list knows which script it read.
export const scriptHash = (text) => {
  let h = 0;
  const t = String(text || '');
  for (let i = 0; i < t.length; i += 1) h = ((h << 5) - h + t.charCodeAt(i)) | 0; // eslint-disable-line no-bitwise
  return String(h >>> 0); // eslint-disable-line no-bitwise
};
export const shotListFresh = (s) => !!s.shotList && s.shotList.scriptHash === scriptHash(s.script);

// ---- video models -------------------------------------------------------------------------
// The models a film or a shot drafts on. A draft finishes only on the model that made it, at
// the resolutions that model renders finals at (Seedance 2.5: 1080p · Premium: 1080p or 4K).
export const VIDEO_MODELS = [{ key: 'seedance25', label: 'Seedance 2.5' }, { key: 'seedance25Premium', label: 'Seedance 2.5 Premium' }];
export const videoModelLabel = (key) => VIDEO_MODELS.find((m) => m.key === key)?.label || key;
export const modelOfShot = (s, shot) => shot?.videoModel || s.videoModel || 'seedance25';
