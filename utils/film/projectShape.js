// Canvas-native project shape, shared by the server fs store and the browser
// File System Access store so both write identical project.json structures.

import { emptyBible, emptyTimeline } from './timelineModel';

export const PROJECT_VERSION = 2;

export const emptyProject = ({ id, title, language, targetMinutes }) => ({
  version: PROJECT_VERSION,
  id,
  title: title || 'Untitled Film',
  language: language || 'en',
  targetMinutes: targetMinutes || 4,
  // The confirmed genre LINE — set when the Cast & World flow locks genre; drives the
  // cast style and the storyboard's shot grammar. Shape: { line } (a "genre · tone"
  // string) or null. Only `line` is stored/read — the detection's label/tone aren't kept.
  genre: null,

  // The SEQUENCE seed — one seed for every shot in the film. { value, locked }:
  // locked reuses `value` across re-shoots (a prompt tweak becomes the only changed
  // variable — the iteration lever); unlocked re-rolls each shoot. value null = random.
  seed: { value: null, locked: false },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),

  // The freeform Project Workspace. Nodes are asset cards (no wires by default).
  canvas: {
    nodes: [],
    edges: [],
    viewport: null,
  },

  // Which agent layers are enabled and their per-layer settings + visibility.
  // Visibility: 'show' | 'dim' | 'hide' controls how that layer's nodes render.
  // (Story Director + Auto Director agents were removed; their layer defaults went
  // with them. buildInitialLayerState only ever reads layers for live AGENTS anyway.)
  layers: {
    inspiration: { enabled: true, visibility: 'show', settings: {} },
    cast: { enabled: true, visibility: 'show', settings: {} },
    characterVariations: { enabled: true, visibility: 'show', settings: {} },
    locationVariations: { enabled: true, visibility: 'show', settings: {} },
  },

  // Cached production-session snapshot (the engine behind per-card shoots), so per-shot
  // iteration survives a reload. Null until a session runs. No user-facing panel.
  auto: null,

  // The chosen recipe (use-case) + its framing. Null until launched; the Short-Film
  // recipe gates the launcher → canvas. e.g. { id, durationSec, aspect, look }.
  recipe: null,

  // The Bible — a global, ATEMPORAL layer of canonical assets (style/look,
  // characters, locations, props, brand) that every tool references so chunks
  // stay consistent. This is what makes a film, not N disconnected clips.
  bible: emptyBible(), // { entries: [{ id, role, name, url, nodeId, locked }] }

  // The Timeline — the core spine of the UX. An ordered set of events; each event
  // is a shot (a keyframe still that gets animated into a clip). Events reference
  // board nodes via keyframeNodeId, but also carry keyframeUrl so the timeline can
  // render/animate even if the board node is gone. Each event carries bibleRefs
  // (which bible entries fill this chunk) and feedback (the user's note for the
  // next iteration). film = the stitched final cut. Defaults to a 15s budget (a
  // short first cut), independent of targetMinutes; the spine grows past it freely.
  timeline: emptyTimeline(),
});

// Re-export the shape constructors so callers have one import surface.
export { emptyBible, emptyTimeline };
