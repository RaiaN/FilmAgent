// DEMO REPLAY — turn a loaded board into a self-playing guided tour. No generation,
// no LLM: the steps only REVEAL nodes that already exist, in the order the pipeline
// tells its story (Brief → Cast & World → Storyboard → SHOT cards → takes → final cut),
// with the camera following. Within each phase, board array order = creation order
// (nodes append at birth), so the replay keeps the session's authentic rhythm.
//
// A manifest can override everything with project.demoOrder — an array of node ids or
// { id, caption?, dwellMs? } entries, played verbatim (hand-tuned pitch saves). Nodes
// that never appear in a step still land at the end: the finale reveals the whole board.

const DWELL = {
  brief: 3000,
  material: 2000,
  cast: 1200,
  sbchat: 2200,
  keyframe: 700,
  audio: 1800,
  card: 1600,
  take: 1000,
  final: 2600,
};

const displaySrc = (n) => n?.data?.cacheUrl || n?.data?.localUrl || n?.data?.url || '';

export const buildDemoSteps = (nodes, project) => {
  const list = nodes || [];
  const byId = new Map(list.map((n) => [n.id, n]));

  // Layer 3 — author override: play the listed ids verbatim, one step each.
  const order = project?.demoOrder;
  if (Array.isArray(order) && order.length) {
    const steps = [];
    order.forEach((entry) => {
      const id = typeof entry === 'string' ? entry : entry?.id;
      const n = id && byId.get(id);
      if (!n) return;
      steps.push({
        ids: [id],
        caption: (typeof entry === 'object' && entry.caption) || n.data?.label || n.data?.title || 'On the board',
        dwellMs: (typeof entry === 'object' && Number(entry.dwellMs)) || 1400,
      });
    });
    return steps;
  }

  // Layers 1+2 — semantic pipeline order, array order within each phase.
  const steps = [];
  const claimed = new Set();
  const claim = (n) => claimed.add(n.id);

  const stories = list.filter((n) => n.type === 'story');
  stories.forEach((n) => {
    claim(n);
    steps.push({ ids: [n.id], caption: 'The Brief — the director’s words, verbatim', dwellMs: DWELL.brief });
  });

  const isAsset = (n) => n.type === 'asset' || ['image', 'video', 'audio'].includes(n.data?.kind);
  const isTake = (n) => n.data?.kind === 'video' && /^grid-/.test(n.parentId || '');
  const isKeyframe = (n) => n.data?.layerId === 'storyboard' || !!n.data?.keyframe;
  const isCast = (n) => n.data?.layerId === 'cast' || !!n.data?.bibleRole;
  const isFinalCut = (n) => n.id === 'film-final-cut';

  // Reference material the director brought or extracted — one grouped step, early.
  const material = list.filter((n) => isAsset(n) && !claimed.has(n.id) && displaySrc(n)
    && !isTake(n) && !isKeyframe(n) && !isCast(n) && !isFinalCut(n)
    && !n.data?.layerId && !n.parentId);
  if (material.length) {
    material.forEach(claim);
    steps.push({ ids: material.map((n) => n.id), caption: 'Reference material on the board', dwellMs: DWELL.material, padding: 0.25 });
  }

  // Cast & World — a tight close-up per plate (cumulative-cluster framing zoomed out
  // more with every plate, leaving the named plate a speck), then one ensemble shot.
  const cast = list.filter((n) => isAsset(n) && !claimed.has(n.id) && isCast(n) && displaySrc(n));
  cast.forEach((n) => {
    claim(n);
    steps.push({
      ids: [n.id],
      caption: `Cast & World — ${n.data?.label || 'identity anchor'}`,
      dwellMs: DWELL.cast,
      padding: 0.3,
    });
  });
  if (cast.length > 1) {
    steps.push({ ids: [], frameIds: cast.map((x) => x.id), caption: 'Cast & World — the whole ensemble', dwellMs: 2000, padding: 0.2 });
  }

  // Storyboard — the shot-division chat, then the keyframe grid filling in.
  const sbchats = list.filter((n) => n.type === 'sbchat');
  sbchats.forEach((n) => {
    claim(n);
    steps.push({ ids: [n.id], caption: 'Shot division — the film broken into shots', dwellMs: DWELL.sbchat });
  });
  // Keyframes: a close-up per still (cluster framing sank below the LOD zoom cliff —
  // the audience was watching tint tiles), then one pull-back over the filled grid.
  const keyframes = list.filter((n) => isAsset(n) && !claimed.has(n.id) && isKeyframe(n) && displaySrc(n));
  keyframes.forEach((n, i) => {
    claim(n);
    steps.push({
      ids: [n.id],
      caption: `Storyboard — keyframe ${i + 1} of ${keyframes.length}`,
      dwellMs: DWELL.keyframe,
      padding: 0.3,
    });
  });
  if (keyframes.length > 1) {
    steps.push({ ids: [], frameIds: keyframes.map((x) => x.id), caption: 'Storyboard — the whole board of stills', dwellMs: 2200, padding: 0.15 });
  }

  const audio = list.filter((n) => isAsset(n) && !claimed.has(n.id) && n.data?.kind === 'audio' && displaySrc(n));
  if (audio.length) {
    audio.forEach(claim);
    steps.push({ ids: audio.map((n) => n.id), caption: 'Sound — generated speech, ambience and SFX', dwellMs: DWELL.audio, padding: 0.25 });
  }

  // SHOT cards in cut order, each followed by its takes landing.
  const cards = list.filter((n) => n.type === 'cut')
    .map((n, i) => ({ n, ord: Number.isFinite(n.data?.cut) ? n.data.cut : i + 1000 }))
    .sort((a, b) => a.ord - b.ord)
    .map((x) => x.n);
  cards.forEach((card, ci) => {
    claim(card);
    steps.push({
      ids: [card.id],
      caption: `SHOT ${ci + 1}${card.data?.title ? ` — ${card.data.title}` : ''}`,
      dwellMs: DWELL.card,
    });
    const takes = list.filter((n) => n.parentId === `grid-${card.id}` && displaySrc(n));
    takes.forEach((t, ti) => {
      claim(t);
      steps.push({
        ids: [t.id],
        frameIds: [card.id, ...takes.slice(0, ti + 1).map((x) => x.id)],
        caption: `SHOT ${ci + 1} — ${t.data?.label || `take ${ti + 1}`} lands`,
        dwellMs: DWELL.take,
      });
    });
  });

  const finalCut = byId.get('film-final-cut');
  if (finalCut && !claimed.has('film-final-cut')) {
    claim(finalCut);
    steps.push({ ids: ['film-final-cut'], caption: 'The final cut', dwellMs: DWELL.final });
  }

  return steps;
};
