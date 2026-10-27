// OPEN IN CANVAS — a Studio element, shot or version as Canvas nodes, made only when the
// director asks. Ids are derived from the Studio's (st-…), so opening twice finds the same
// nodes. Each node carries what it came from, so the Canvas mirror never brings it back as new
// work; a shot and the card made for it stay linked (shot.boardCard), and takes shot on that
// card come back to the shot.
//
// Result: { nodes, focusId, link? } — nodes to add (top-level positions relative to where the
// Canvas places them), the node to show, and for a shot the link to record in the Studio.
import { findShot, pickedOf, shotRefs, modelText, shotNumber } from './model';

const BOARD_PLATE = /^v-b-bible-(.+)$/; // a plate the mirror brought in from a Canvas node
const BOARD_TAKE = /^v-(.+)$/;
const GRID = { pad: 12, header: 34, cols: 5, cellW: 240, cellH: 212 };

const imageNode = (id, { url, cacheUrl, label, position, extra = {} }) => ({
  id, type: 'asset', position,
  data: { kind: 'image', url, cacheUrl: cacheUrl || null, label, locked: false, layerId: null, sourceRefs: [], meta: {}, preserved: true, createdAt: Date.now(), ...extra },
});
const videoNode = (id, v, { label, position, parentId, hidden }) => ({
  id, type: 'asset', position, ...(parentId ? { parentId } : {}), ...(hidden ? { hidden: true } : {}),
  data: {
    kind: 'video', url: v.url, cacheUrl: v.cacheUrl || null, posterUrl: v.posterUrl || '', lastFrameUrl: v.lastFrameUrl || '', format: v.format || '',
    label, locked: false, layerId: null, sourceRefs: [], meta: {}, preserved: true, createdAt: Date.now(), studioVersionId: v.id,
    ...(v.draft?.taskId ? { draft: { taskId: v.draft.taskId, modelKey: v.draft.modelKey || 'seedance25', createdAt: v.draft.at || Date.now() } } : {}),
  },
});

// An element's plate (and a character's body sheet) as bible-tagged image nodes.
const plateNodes = (el, p, at = { x: 0, y: 0 }) => {
  const board = BOARD_PLATE.exec(p.id || '');
  if (board) return { nodes: [], ids: [board[1]] }; // it already lives on the Canvas
  const face = imageNode(`st-el-${el.id}`, { url: p.url, cacheUrl: p.cacheUrl, label: el.kind === 'character' ? `${el.name} · face` : el.name, position: at, extra: { bibleRole: el.kind, assetId: p.assetId || null, studioElementId: el.id } });
  const extras = (p.extras || []).filter((x) => x.url).map((x, i) => imageNode(`st-el-${el.id}-${i + 1}`, { url: x.url, label: `${el.name} · ${x.label || 'sheet'}`, position: { x: at.x, y: at.y + 300 * (i + 1) }, extra: { bibleRole: el.kind, assetId: x.assetId || null, studioElementId: el.id } }));
  return { nodes: [face, ...extras], ids: [face.id, ...extras.map((n) => n.id)] };
};

export const elementToCanvas = (s, el) => {
  const p = pickedOf(el);
  if (!p || !(p.cacheUrl || p.url)) throw new Error(`${el.name} has no plate to put on the Canvas.`);
  const { nodes, ids } = plateNodes(el, p);
  return { nodes, focusId: ids[0] };
};

// A shot as a SHOT card: its text with [Image N] bound to its plates (in the order the
// Studio sends them), its picked frame as keyframe 1, its takes in the card's take grid.
export const shotToCanvas = (s, sceneId, shotId) => {
  const shot = findShot(s, sceneId, shotId);
  if (!shot) throw new Error('That shot is gone.');
  if (shot.boardCard) return { nodes: [], focusId: shot.boardCard };
  const cardId = `st-sh-${shot.id}`;
  const { list, imageOf } = shotRefs(s, shot);
  const nodes = [];
  const refIds = [];
  const placed = new Set();
  list.forEach((r) => {
    if (placed.has(r.elementId)) return;
    placed.add(r.elementId);
    const el = s.elements.find((e) => e.id === r.elementId);
    const made = plateNodes(el, pickedOf(el), { x: -320, y: nodes.length * 300 });
    nodes.push(...made.nodes);
    made.ids.forEach((id) => refIds.push(`bible-${id}`));
  });
  const takes = (shot.takes?.versions || []).filter((v) => v.status !== 'rejected' && v.status !== 'running' && v.status !== 'failed' && (v.cacheUrl || v.url));
  const gridId = `grid-${cardId}`;
  const takeIdOf = (v) => (v.by === 'board' && BOARD_TAKE.exec(v.id) ? BOARD_TAKE.exec(v.id)[1] : `st-v-${v.id}`);
  const ownTakes = takes.filter((v) => v.by !== 'board');
  if (ownTakes.length) {
    const rows = Math.ceil(ownTakes.length / GRID.cols);
    nodes.push({ id: gridId, type: 'group', position: { x: 520, y: 0 }, hidden: true, style: { width: GRID.pad * 2 + GRID.cols * GRID.cellW, height: GRID.header + GRID.pad + rows * GRID.cellH }, data: { label: `Shots · ${shot.title.slice(0, 24)}`, layerId: null } });
    ownTakes.forEach((v, i) => nodes.push(videoNode(takeIdOf(v), v, { label: `Take ${i + 1}`, parentId: gridId, hidden: true, position: { x: GRID.pad + (i % GRID.cols) * GRID.cellW, y: GRID.header + GRID.pad + Math.floor(i / GRID.cols) * GRID.cellH } })));
  }
  const circled = pickedOf(shot.takes);
  const n = shotNumber(s, shot.id);
  nodes.push({
    id: cardId, type: 'cut', position: { x: 0, y: 0 },
    data: {
      cut: Math.max(0, n - 1), beat: shot.title, job: shot.turn || '',
      cuts: [{ action: '', seconds: Math.min(6, Number(shot.seconds) || 6) }],
      promptOverride: modelText(s, shot.motion || shot.quote, imageOf), videoModel: 'seedance25', audio: shot.audio || '',
      durationSec: Number(shot.seconds) || 8, refIds, direct: true,
      assetRefs: [],
      keyframes: [],
      audioRefs: [], videoRefs: [],
      ...(circled && circled.by !== 'board' && (circled.cacheUrl || circled.url) ? { circledTakeId: takeIdOf(circled) } : {}),
      studioShotId: shot.id,
    },
  });
  return { nodes, focusId: cardId, link: { sceneId, shotId: shot.id, cardId } };
};

// One version on its own: a plate or frame as an image node, a take or cut as a video node.
export const versionToCanvas = (s, ref, v, label) => {
  if (!(v.cacheUrl || v.url)) throw new Error('Nothing to show yet.');
  if (ref.at === 'element') {
    const board = BOARD_PLATE.exec(v.id || '');
    if (board) return { nodes: [], focusId: board[1] };
  }
  if (v.by === 'board' && ref.at === 'take') {
    const shot = findShot(s, ref.sceneId, ref.shotId);
    if (shot?.boardCard) return { nodes: [], focusId: shot.boardCard }; // Canvas takes live with their card
  }
  const id = `st-v-${v.id}`;
  const node = (v.kind === 'take' || v.kind === 'cut')
    ? videoNode(id, v, { label, position: { x: 0, y: 0 } })
    : imageNode(id, { url: v.url, cacheUrl: v.cacheUrl, label, position: { x: 0, y: 0 }, extra: { studioVersionId: v.id } });
  return { nodes: [node], focusId: id };
};
