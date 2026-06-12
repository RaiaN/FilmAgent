// Canvas-native project shape, shared by the server fs store and the browser
// File System Access store so both write identical project.json structures.

import { emptyBible, emptyTimeline, timelineEvent } from './timelineModel';

export const PROJECT_VERSION = 2;

export const emptyProject = ({ id, title, language, targetMinutes, idea }) => ({
  version: PROJECT_VERSION,
  id,
  title: title || 'Untitled Film',
  language: language || 'en',
  targetMinutes: targetMinutes || 4,
  idea: idea || '',
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
    topicExplorer: { enabled: true, visibility: 'show', settings: {} },
    inspiration: { enabled: true, visibility: 'show', settings: {} },
    characterVariations: { enabled: true, visibility: 'show', settings: {} },
    locationVariations: { enabled: true, visibility: 'show', settings: {} },
    mixMatch: { enabled: true, visibility: 'show', settings: {} },
    promptMuse: { enabled: true, visibility: 'show', settings: {} },
  },

  // Optional structured story data (screenwriting layer, folded in later).
  story: null,

  // Cached production-session snapshot (the engine behind Auto-fill), so per-shot
  // iteration survives a reload. Null until a session runs. No user-facing panel.
  auto: null,

  // The Filming Loop's chunk chain (Short Film mode): { chunks, story }. The
  // timeline mirrors it as events; this is the driver state, persisted for reload.
  filming: null,

  // The chosen Concierge recipe (use-case) + its framing. Null until the Concierge
  // runs. e.g. { id: 'advertisement', durationSec, aspect, look }.
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

// Build timeline events from any Story Director keyframes on the board (nodes that
// carry storyOrder/event). Lets a story built before the timeline existed appear
// on the spine. Each beat becomes a manual (non-step) keyframe event.
export const eventsFromStoryNodes = (nodes = []) =>
  (nodes || [])
    .filter((n) => n?.data?.storyOrder != null && n?.data?.url)
    .sort((a, b) => a.data.storyOrder - b.data.storyOrder)
    .map((n, i) => timelineEvent({
      order: i,
      beat: n.data.event || `Beat ${i + 1}`,
      keyframeUrl: n.data.url,
      keyframeNodeId: n.id,
      status: 'keyframe',
    }));

// Backfill the bible + timeline on an already-current project saved before they
// existed (migrateProject only handles v1→v2). Non-destructive: returns the same
// reference when nothing is missing, else a shallow clone with the defaults.
export const normalizeProject = (project) => {
  if (!project || typeof project !== 'object') return project;
  const hasBible = project.bible && Array.isArray(project.bible.entries);
  const hasTimeline = project.timeline && Array.isArray(project.timeline.events);
  if (hasBible && hasTimeline) return project;
  return {
    ...project,
    bible: hasBible ? project.bible : emptyBible(),
    timeline: hasTimeline ? project.timeline : emptyTimeline(),
  };
};

// Migrate a v1 (wizard) project into the v2 canvas shape without losing data.
// Old story stages become a `story` blob; any generated bible imagery becomes
// canvas asset nodes so nothing the user made disappears.
export const migrateProject = (project) => {
  if (!project || project.version >= PROJECT_VERSION) return normalizeProject(project);

  const migrated = {
    ...emptyProject({
      id: project.id,
      title: project.title,
      language: project.language,
      targetMinutes: project.targetMinutes,
      idea: project.idea,
    }),
    id: project.id,
    createdAt: project.createdAt || new Date().toISOString(),
  };

  if (project.stages) {
    migrated.story = {
      logline: project.stages.logline?.approved || null,
      treatment: project.stages.treatment?.approved || null,
      script: project.stages.script?.approved || null,
      style: project.stages.style?.approved || null,
    };

    const nodes = [];
    let x = 80;
    let y = 80;
    const pushAsset = (url, label, layerId) => {
      if (!url) return;
      nodes.push({
        id: `mig-${nodes.length}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'asset',
        position: { x, y },
        data: { kind: 'image', url, label, locked: true, layerId, sourceRefs: [], meta: {} },
      });
      x += 280;
      if (x > 1200) { x = 80; y += 320; }
    };

    (project.stages.characters?.items || []).forEach((c) => {
      pushAsset(c.portraitUrl, `${c.name} — portrait`, 'characterVariations');
      pushAsset(c.closeSheetUrl, `${c.name} — close sheet`, 'characterVariations');
      pushAsset(c.fullBodyUrl, `${c.name} — full body`, 'characterVariations');
    });
    (project.stages.locations?.items || []).forEach((l) => {
      pushAsset(l.imageUrl, `${l.name} — plate`, 'locationVariations');
    });

    migrated.canvas.nodes = nodes;
  }

  return migrated;
};
