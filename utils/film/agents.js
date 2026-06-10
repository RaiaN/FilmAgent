// Canvas agent registry (L4 binding). Holds UI metadata for each agent and a thin
// run() adapter that maps the canvas (React Flow selection + onAsset callbacks)
// onto the runtime-agnostic core operations. All orchestration/prompts/models
// live in core/operations.js — this file only translates canvas ⇄ core.

import { createBrowserClient } from './core/client';
import * as ops from './core/operations';
import * as director from './core/director';
import { VARIANT_POOLS, COVERAGE_POOLS, buildAnimatePrompt, extractMusePrompt } from './core/operations';
import { SIZE_TIERS as IMAGE_RESOLUTIONS, ASPECT_RATIOS as IMAGE_RATIOS } from './imageSizes';

// Re-exported so the canvas panels can reuse them.
export { extractMusePrompt, IMAGE_RESOLUTIONS, IMAGE_RATIOS };
export const PLANNABLE_AGENTS = director.PLANNABLE_AGENTS;

export const AGENT_COLORS = {
  autoDirector: '#5a3df0',         // electric indigo (orchestrator)
  inspiration: '#ff7d00',          // orange
  characterVariations: '#165dff',  // blue
  locationVariations: '#00b42a',   // green
  mixMatch: '#f5319d',             // magenta (composite)
  animate: '#722ed1',              // purple (video)
  promptMuse: '#0fc6c2',           // teal (read/coach)
  storyDirector: '#f7ba1e',        // gold (interactive story)
};

const browserCtx = (apiKey) => ({ client: createBrowserClient(apiKey) });

// The reference a Seedream-backed agent should send for a node. Prefer the local
// bytes (localUrl, a data: URL) when present — that's the case for uploaded files,
// whose staged TOS URL is not publicly fetchable, so the server-side reference
// fetch in /api/film/imagine would 403 on it. A data: URL passes straight through
// to Seedream untouched. Generated/checked-in assets have no localUrl and fall
// back to their (fetchable) http URL.
const refUrl = (n) => n?.data?.localUrl || n?.data?.url;
const selectedImageUrls = (selection) =>
  (selection || []).filter((n) => n.data?.kind === 'image' && n.data?.url).map(refUrl);
const firstImageNode = (selection) =>
  (selection || []).find((n) => n.data?.kind === 'image' && n.data?.url);
// The prompt to use from a selected text card (e.g. a Prompt Muse suggestion).
// Prompt Muse cards carry a craft analysis + a "Prompt:" section — we extract
// just the prompt, never the analysis. A plain note returns its full text.
const selectedText = (selection) => {
  const t = (selection || []).find((n) => n.data?.kind === 'text' && (n.data?.text || '').trim());
  return t ? extractMusePrompt(t.data.text) : '';
};

// ---- exported suggestion helpers (used by the panels) -------------------------

export const suggestNextBeats = ({ apiKey, idea, steps, lastImageUrl, count = 3 }) =>
  ops.suggestNextBeats({ idea, steps, lastImageUrl, count }, browserCtx(apiKey));

export const suggestCompositionDirection = ({ apiKey, images }) =>
  ops.suggestComposition({ images }, browserCtx(apiKey));

export const suggestShotMotion = ({ apiKey, images }) =>
  ops.suggestMotion({ images }, browserCtx(apiKey));

// ---- Auto Director adapters (orchestrator) ------------------------------------
// Thin pass-throughs to the director core. Callers pass already-resolved image
// URLs (use refUrl on the canvas side so uploaded assets send base64).

export const understandAssets = ({ apiKey, images = [], idea = '' }) =>
  director.understandAssets({ images, idea }, browserCtx(apiKey));

export const buildPlan = ({ apiKey, brief, idea = '', targetMinutes = 4 }) =>
  director.buildPlan({
    brief,
    idea,
    targetMinutes,
    agents: AGENTS.filter((a) => PLANNABLE_AGENTS.includes(a.id)).map((a) => ({ id: a.id, describe: a.describe })),
  }, browserCtx(apiKey));

export const qcStep = ({ apiKey, agent, intent, references = [], outputs = [], video }) =>
  director.qcStep({ agent, intent, references, outputs, video }, browserCtx(apiKey));

// ---- agents -------------------------------------------------------------------

export const inspirationAgent = {
  id: 'inspiration',
  label: 'Inspiration Board',
  icon: 'bulb',
  color: AGENT_COLORS.inspiration,
  consumes: ['text'],
  needsSelection: false,
  grouped: true,
  defaultSettings: { count: 6, size: '2K', useSelectionAsRefs: false },
  describe: 'Generate a grid of reference imagery from a prompt. Seed it with selected images as style references, or a selected Prompt Muse text card as the prompt.',
  async run({ prompt, selection, settings, apiKey, onAsset, onError }) {
    const refs = settings.useSelectionAsRefs ? selectedImageUrls(selection) : [];
    // Typed prompt wins; otherwise fall back to a selected text card (Prompt Muse).
    const effectivePrompt = (prompt && String(prompt).trim()) || selectedText(selection);
    const result = await ops.inspiration(
      { prompt: effectivePrompt, refs, count: settings.count, size: settings.size },
      browserCtx(apiKey),
      (item) => onAsset({ kind: 'image', url: item.url, label: item.label, layerId: 'inspiration', sourceRefs: item.referenceImages, meta: { prompt: item.prompt, ...item.meta } }),
    );
    if (result.errors.length && onError) onError(result.errors);
    return result;
  },
};

export const characterVariationsAgent = {
  id: 'characterVariations',
  label: 'Character Variations',
  icon: 'user',
  color: AGENT_COLORS.characterVariations,
  consumes: ['image'],
  needsSelection: true,
  grouped: true,
  defaultSettings: { axis: 'wardrobe', count: 4, size: '2K', notes: '' },
  describe: 'Select a character image, then spin variations along an axis (wardrobe, age, expression, lighting, pose) with identity preserved.',
  async run({ selection, settings, apiKey, onAsset, onError }) {
    const anchor = firstImageNode(selection);
    if (!anchor) throw new Error('Select one character image first');
    const result = await ops.characterVariations(
      { imageUrl: refUrl(anchor), axis: settings.axis, count: settings.count, notes: settings.notes, size: settings.size },
      browserCtx(apiKey),
      (item) => onAsset({ kind: 'image', url: item.url, label: item.label, layerId: 'characterVariations', sourceRefs: item.referenceImages, meta: { ...item.meta, anchorId: anchor.id } }),
    );
    if (result.errors.length && onError) onError(result.errors);
    return result;
  },
};

export const locationVariationsAgent = {
  id: 'locationVariations',
  label: 'Location Variations & Coverage',
  icon: 'location',
  color: AGENT_COLORS.locationVariations,
  consumes: ['image'],
  needsSelection: true,
  grouped: true,
  defaultSettings: { axis: 'angles', count: 4, size: '2K', notes: '' },
  describe: 'Select a location plate, then generate coverage (angles, time of day, weather, season) with the architecture preserved. No people.',
  async run({ selection, settings, apiKey, onAsset, onError }) {
    const anchor = firstImageNode(selection);
    if (!anchor) throw new Error('Select one location image first');
    const result = await ops.locationVariations(
      { imageUrl: refUrl(anchor), axis: settings.axis, count: settings.count, notes: settings.notes, size: settings.size },
      browserCtx(apiKey),
      (item) => onAsset({ kind: 'image', url: item.url, label: item.label, layerId: 'locationVariations', sourceRefs: item.referenceImages, meta: { ...item.meta, anchorId: anchor.id } }),
    );
    if (result.errors.length && onError) onError(result.errors);
    return result;
  },
};

export const mixMatchAgent = {
  id: 'mixMatch',
  label: 'Mix & Match',
  icon: 'mix',
  color: AGENT_COLORS.mixMatch,
  consumes: ['image'],
  needsSelection: true,
  minSelection: 2,
  grouped: true,
  defaultSettings: { prompt: '', count: 4, size: '2K', ratio: '16:9' },
  describe: 'Select two or more images — characters, locations, props — and combine them into new composite stills. Each subject\'s identity, proportions and the location are preserved. Pick an aspect ratio that suits the shot.',
  async run({ selection, settings, apiKey, onAsset, onError }) {
    const refs = selectedImageUrls(selection);
    if (refs.length < 2) throw new Error('Select at least two images to mix');
    // Pass the tier + aspect ratio; ops.mixMatch resolves them to the exact W×H
    // once (Method 2), so the composite renders at the chosen frame shape.
    const result = await ops.mixMatch(
      { imageUrls: refs, direction: settings.prompt, count: settings.count, size: settings.size, ratio: settings.ratio },
      browserCtx(apiKey),
      (item) => onAsset({ kind: 'image', url: item.url, label: item.label, layerId: 'mixMatch', sourceRefs: item.referenceImages, meta: item.meta }),
    );
    if (result.errors.length && onError) onError(result.errors);
    return result;
  },
};

export const animateAgent = {
  id: 'animate',
  label: 'Animate (Seedance)',
  icon: 'film',
  color: AGENT_COLORS.animate,
  consumes: ['image'],
  needsSelection: true,
  defaultSettings: {
    motion: '', camera: 'slow push-in', lens: 'auto', focalLength: '35mm', aperture: 'f/2.8',
    duration: 5, resolution: '720p', ratio: 'adaptive', generateAudio: true,
  },
  describe: 'Select a keyframe image, set the camera, describe the motion, and Seedance turns it into a moving shot with native audio. The still becomes the first frame.',
  async run({ selection, settings, apiKey, onPendingAsset, onResolveAsset, onFailAsset, onError }) {
    const anchor = firstImageNode(selection);
    if (!anchor) throw new Error('Select one image to animate');
    const ctx = browserCtx(apiKey);

    // Drop the loading node immediately, then kick off the async task.
    const prompt = buildAnimatePrompt(settings);
    const pendingId = onPendingAsset({ kind: 'video', label: 'Animating… (Seedance)', layerId: 'animate', sourceRefs: [anchor.data.url], meta: { motion: prompt, anchorId: anchor.id } });

    let taskId;
    try {
      ({ taskId } = await ops.animate({
        imageUrl: anchor.data.url,
        assetId: anchor.data.assetId || null,
        motion: settings.motion, camera: settings.camera, lens: settings.lens,
        focalLength: settings.focalLength, aperture: settings.aperture,
        duration: settings.duration, resolution: settings.resolution, ratio: settings.ratio,
        generateAudio: settings.generateAudio,
      }, ctx));
    } catch (err) {
      onFailAsset(pendingId, err.message);
      if (onError) onError([err.message]);
      return { created: 0, errors: [err.message] };
    }

    // Poll in the background so the panel frees up immediately.
    ctx.client.pollVideo({ taskId })
      .then(({ videoUrl }) => onResolveAsset(pendingId, { url: videoUrl, label: 'Shot', loading: false }))
      .catch((err) => onFailAsset(pendingId, err.message));

    return { created: 1, errors: [], async: true };
  },
};

export const promptMuseAgent = {
  id: 'promptMuse',
  label: 'Prompt Muse',
  icon: 'muse',
  color: AGENT_COLORS.promptMuse,
  consumes: ['image', 'video'],
  needsSelection: true,
  defaultSettings: { question: '' },
  describe: 'Stuck on how to describe what you want? Select an image or video and Prompt Muse reads the craft back to you — and writes a ready-to-use prompt you can drop into Inspiration or Animate.',
  async run({ selection, settings, apiKey, onAsset, onError }) {
    const sel = selection || [];
    const images = selectedImageUrls(sel);
    // Prefer local bytes for an uploaded video too (its TOS URL isn't fetchable).
    const video = refUrl(sel.find((n) => n.data?.kind === 'video' && n.data?.url)) || undefined;
    try {
      const { text } = await ops.promptMuse({ images, video, question: settings.question }, browserCtx(apiKey));
      onAsset({ kind: 'text', text, label: 'Prompt Muse', layerId: 'promptMuse', sourceRefs: [...images, ...(video ? [video] : [])], meta: { question: settings.question || '' } });
      return { created: 1, errors: [] };
    } catch (err) {
      if (onError) onError([err.message]);
      throw err;
    }
  },
};

export const storyDirectorAgent = {
  id: 'storyDirector',
  label: 'Story Director',
  icon: 'story',
  color: AGENT_COLORS.storyDirector,
  consumes: ['image'],
  needsSelection: false,
  interactive: true, // runs its own loop in a custom panel — no generic Run button
  defaultSettings: { count: 3, size: '2K' },
  describe: 'Build your film beat by beat. Start from a frame or your idea; the agent suggests what happens next, you pick, and it generates the keyframe — chaining a timeline you can animate.',
};

export const autoDirectorAgent = {
  id: 'autoDirector',
  label: 'Auto Director',
  icon: 'auto',
  color: AGENT_COLORS.autoDirector,
  consumes: ['image'],
  needsSelection: false,
  interactive: true, // orchestrates the other agents on a canvas plan element — no generic Run
  defaultSettings: {},
  describe: 'Hand it your assets and idea — it understands them, plans a production using every other agent, then runs it step by step. You review, pick and approve each step (AI QC flags issues), and it stitches the final film.',
};

export const AGENTS = [
  autoDirectorAgent,
  inspirationAgent,
  characterVariationsAgent,
  locationVariationsAgent,
  mixMatchAgent,
  storyDirectorAgent,
  animateAgent,
  promptMuseAgent,
];

export const AGENT_MAP = AGENTS.reduce((acc, a) => {
  acc[a.id] = a;
  return acc;
}, {});

export const AXIS_OPTIONS = {
  characterVariations: Object.keys(VARIANT_POOLS),
  locationVariations: Object.keys(COVERAGE_POOLS),
};
