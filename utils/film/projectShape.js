// Canvas-native project shape, shared by the server fs store and the browser
// File System Access store so both write identical project.json structures.

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
  layers: {
    autoDirector: { enabled: true, visibility: 'show', settings: {} },
    inspiration: { enabled: true, visibility: 'show', settings: {} },
    characterVariations: { enabled: true, visibility: 'show', settings: {} },
    locationVariations: { enabled: true, visibility: 'show', settings: {} },
    mixMatch: { enabled: true, visibility: 'show', settings: {} },
    storyDirector: { enabled: true, visibility: 'show', settings: {} },
    animate: { enabled: true, visibility: 'show', settings: {} },
    promptMuse: { enabled: true, visibility: 'show', settings: {} },
  },

  // Optional structured story data (screenwriting layer, folded in later).
  story: null,

  // Auto Director production plan (orchestrator). Null until a plan is created.
  auto: null,
});

// Migrate a v1 (wizard) project into the v2 canvas shape without losing data.
// Old story stages become a `story` blob; any generated bible imagery becomes
// canvas asset nodes so nothing the user made disappears.
export const migrateProject = (project) => {
  if (!project || project.version >= PROJECT_VERSION) return project;

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
