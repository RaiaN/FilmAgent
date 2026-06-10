// ARCHIVED — wizard-era stage/bible store.
// Extracted from utils/film/projectStore.js during the canvas redesign.
// These pure helpers drove the linear logline→treatment→script→style→bibles flow.
// They will be reconstituted as the Screenwriting and Reference-Sheets canvas layers.
// Not imported by the active app graph.

const cloneStage = (stage) => (stage ? JSON.parse(JSON.stringify(stage)) : { status: 'empty', draft: null, approved: null, history: [] });

export const setStageDraft = (project, stageKey, draft, raw) => {
  const next = { ...project, stages: { ...project.stages } };
  const current = cloneStage(next.stages[stageKey]);
  current.draft = draft;
  current.raw = raw;
  current.status = current.approved ? 'edited' : 'draft';
  next.stages[stageKey] = current;
  return next;
};

export const approveStage = (project, stageKey) => {
  const next = { ...project, stages: { ...project.stages } };
  const current = cloneStage(next.stages[stageKey]);
  current.approved = current.draft;
  current.status = 'approved';
  current.history = [...(current.history || []), { approvedAt: new Date().toISOString() }];
  next.stages[stageKey] = current;
  return next;
};

export const editApproved = (project, stageKey, newContent) => {
  const next = { ...project, stages: { ...project.stages } };
  const current = cloneStage(next.stages[stageKey]);
  current.draft = newContent;
  if (current.status === 'approved') {
    // editing an already-approved stage keeps it approved with the new content
    current.approved = newContent;
  } else {
    // editing a draft keeps it a draft
    current.status = 'draft';
  }
  next.stages[stageKey] = current;
  return next;
};

// Linear approval stages that flow through StageEditor (single-document drafts).
export const STAGE_ORDER = ['logline', 'treatment', 'script', 'style'];

// Stages backed by item lists, not single drafts.
export const ITEM_STAGES = ['characters', 'locations'];

export const STAGE_LABELS = {
  logline: 'Logline',
  treatment: 'Treatment',
  script: 'Script',
  style: 'Style Bible',
  characters: 'Characters',
  locations: 'Locations',
  shotlist: 'Shot List',
  shots: 'Shots',
  final: 'Final Cut',
};

export const STAGE_PREREQS = {
  logline: [],
  treatment: ['logline'],
  script: ['logline', 'treatment'],
  style: ['logline', 'treatment', 'script'],
  // Both bibles unlock together once style is approved.
  characters: ['logline', 'treatment', 'script', 'style'],
  locations: ['logline', 'treatment', 'script', 'style'],
  // Shotlist needs everything before it.
  shotlist: ['logline', 'treatment', 'script', 'style', 'characters', 'locations'],
  shots: ['shotlist'],
  final: ['shots'],
};

export const stagePrereqs = (stageKey) => STAGE_PREREQS[stageKey] || [];

export const isStageUnlocked = (project, stageKey) =>
  stagePrereqs(stageKey).every((prev) => project.stages?.[prev]?.status === 'approved');

// ---- Item-stage helpers (characters / locations) ----

const buildCharacterItems = (scriptCharacters = []) =>
  scriptCharacters.map((c) => ({
    id: c.id,
    name: c.name || c.id,
    role: c.role || '',
    physical_description: c.physical_description || '',
    voice_timbre: c.voice_timbre || '',
    status: 'empty',
    portraitUrl: '',
    closeSheetUrl: '',
    fullBodyUrl: '',
    portraitPrompt: '',
    lastError: '',
  }));

const buildLocationItems = (scriptLocations = []) =>
  scriptLocations.map((l) => ({
    id: l.id,
    name: l.name || l.id,
    description: l.description || '',
    time_of_day: l.time_of_day || '',
    status: 'empty',
    imageUrl: '',
    prompt: '',
    lastError: '',
  }));

const reconcileItems = (existingItems = [], freshItems = []) => {
  // Preserve previously-generated work when re-syncing from script (don't blow away approved bibles
  // if a user re-approves the script). Match by id.
  const byId = new Map(existingItems.map((it) => [it.id, it]));
  return freshItems.map((fresh) => {
    const existing = byId.get(fresh.id);
    if (!existing) return fresh;
    return { ...fresh, ...existing, name: fresh.name, role: fresh.role, description: fresh.description };
  });
};

const stageStatusFromItems = (items) => {
  if (!items || items.length === 0) return 'empty';
  const allApproved = items.every((it) => it.status === 'approved');
  if (allApproved) return 'approved';
  const anyDraft = items.some((it) => it.status === 'draft' || it.status === 'approved' || it.status === 'generating');
  return anyDraft ? 'draft' : 'empty';
};

export const syncBibleItemsFromScript = (project) => {
  const script = project.stages?.script?.approved;
  if (!script) return project;

  const next = { ...project, stages: { ...project.stages } };

  const freshCharacters = buildCharacterItems(script.characters || []);
  const existingCharacters = next.stages.characters?.items || [];
  const characterItems = reconcileItems(existingCharacters, freshCharacters);
  next.stages.characters = {
    ...(next.stages.characters || {}),
    items: characterItems,
    status: stageStatusFromItems(characterItems),
  };

  const freshLocations = buildLocationItems(script.locations || []);
  const existingLocations = next.stages.locations?.items || [];
  const locationItems = reconcileItems(existingLocations, freshLocations);
  next.stages.locations = {
    ...(next.stages.locations || {}),
    items: locationItems,
    status: stageStatusFromItems(locationItems),
  };

  return next;
};

export const updateItem = (project, stageKey, itemId, patch) => {
  const stage = project.stages?.[stageKey];
  if (!stage) return project;
  const items = (stage.items || []).map((it) => (it.id === itemId ? { ...it, ...patch } : it));
  return {
    ...project,
    stages: {
      ...project.stages,
      [stageKey]: {
        ...stage,
        items,
        status: stageStatusFromItems(items),
      },
    },
  };
};

export const approveItem = (project, stageKey, itemId) =>
  updateItem(project, stageKey, itemId, { status: 'approved' });

export const markItemGenerating = (project, stageKey, itemId) =>
  updateItem(project, stageKey, itemId, { status: 'generating', lastError: '' });

export const markItemFailed = (project, stageKey, itemId, errorMessage) =>
  updateItem(project, stageKey, itemId, { status: 'failed', lastError: errorMessage });
