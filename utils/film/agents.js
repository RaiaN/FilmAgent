// Canvas agent registry (L4 binding). Holds UI metadata for each agent and a thin
// run() adapter that maps the canvas (React Flow selection + onAsset callbacks)
// onto the runtime-agnostic core operations. All orchestration/prompts/models
// live in core/operations.js — this file only translates canvas ⇄ core.

import { createBrowserClient } from './core/client';
import * as ops from './core/operations';
import * as director from './core/director';
import { buildAnimatePrompt, extractMusePrompt } from './core/operations';
import { exploreTopic } from './core/explore';
import { createStoryboard } from './core/storyboard';
import { AD_ROLES } from './recipes';
import { SIZE_TIERS as IMAGE_RESOLUTIONS, ASPECT_RATIOS as IMAGE_RATIOS } from './imageSizes';

// Re-exported so the canvas panels can reuse them.
export { extractMusePrompt, IMAGE_RESOLUTIONS, IMAGE_RATIOS };

export const AGENT_COLORS = {
  autoDirector: '#5a3df0',         // electric indigo (orchestrator)
  inspiration: '#ff7d00',          // orange
  characterVariations: '#165dff',  // blue
  locationVariations: '#00b42a',   // green
  mixMatch: '#f5319d',             // magenta (composite)
  animate: '#722ed1',              // purple (video)
  promptMuse: '#0fc6c2',           // teal (read/coach)
  storyDirector: '#f7ba1e',        // gold (interactive story)
  topicExplorer: '#8bbb11',        // lime (research / exploration)
  storyboard: '#4e5969',           // graphite (the pencil plan)
};

const browserCtx = (apiKey) => ({ client: createBrowserClient(apiKey) });

// A full browser transport for the interactive production session (createProduction):
// the app-route client plus a stitch that posts to /api/film/stitch (server ffmpeg +
// TOS) and resolves to a hosted, playable URL. The canvas drives the shared engine
// through this instead of reimplementing the loop.
export const createBrowserTransport = (apiKey) => ({
  client: createBrowserClient(apiKey),
  stitch: async (shots, o = {}) => {
    const res = await fetch('/api/film/stitch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shots, name: o.name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.details || data?.error || 'Stitch failed');
    return { url: data.url, assetId: data.assetId || null };
  },
  // The Filming Loop's continuity capability: the last frame of an approved chunk
  // seeds the next chunk's keyframe (server ffmpeg → base64 reference image).
  lastFrame: async (url) => {
    const res = await fetch('/api/film/last-frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.details || data?.error || 'Last-frame extraction failed');
    return { url: data.url };
  },
});

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

// Concierge intake: classify a pile of uploaded images into recipe bible roles, and
// report which required roles are still missing ("do you have XYZ?"). An injected
// `client` (e.g. trace-wrapped) wins over the plain browser one.
export const classifyAssets = ({ apiKey, client, images = [], idea = '', roles = [], requiredRoles = [] }) =>
  director.classifyAssets({ images, idea, roles, requiredRoles }, client ? { client } : browserCtx(apiKey));

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
  describe: 'Generate a grid of reference imagery. Select multiple assets and it reads each, synthesises them, and plans distinct directions (Seed 2.0 Pro). Or seed from a Prompt Muse text card. Each output is meaningfully different.',
  // Every agent run accepts an optional injected `ctx` (the canvas passes a
  // trace-wrapped client so rail runs land in the decision history); without one
  // it builds the plain browser ctx from the apiKey as before.
  async run({ prompt, selection, settings, apiKey, ctx, onAsset, onError }) {
    // All selected images are read by the planner (describe + mix); the checkbox
    // also feeds them to the image model as visual references.
    const refs = selectedImageUrls(selection);
    // Typed prompt wins; otherwise fall back to a selected text card (Prompt Muse).
    const effectivePrompt = (prompt && String(prompt).trim()) || selectedText(selection);
    const result = await ops.inspiration(
      { prompt: effectivePrompt, refs, useRefsInGen: !!settings.useSelectionAsRefs, count: settings.count, size: settings.size },
      ctx || browserCtx(apiKey),
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
  defaultSettings: { count: 4, size: '2K', direction: '' },
  describe: 'Select a character image — Seed 2.0 Pro plans distinct, content-aware variations (identity preserved). Leave Direction blank to let it choose, or steer it (e.g. "different wardrobes", "across ages").',
  async run({ selection, settings, apiKey, ctx, onAsset, onError }) {
    const anchor = firstImageNode(selection);
    if (!anchor) throw new Error('Select one character image first');
    const result = await ops.characterVariations(
      { imageUrl: refUrl(anchor), direction: settings.direction, count: settings.count, size: settings.size },
      ctx || browserCtx(apiKey),
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
  defaultSettings: { count: 4, size: '2K', direction: '' },
  describe: 'Select a location plate — Seed 2.0 Pro plans distinct coverage (architecture preserved, no people). Leave Direction blank, or steer it (e.g. "different times of day", "tighter angles").',
  async run({ selection, settings, apiKey, ctx, onAsset, onError }) {
    const anchor = firstImageNode(selection);
    if (!anchor) throw new Error('Select one location image first');
    const result = await ops.locationVariations(
      { imageUrl: refUrl(anchor), direction: settings.direction, count: settings.count, size: settings.size },
      ctx || browserCtx(apiKey),
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
  minSelection: 1,
  grouped: true,
  defaultSettings: { prompt: '', count: 4, size: '2K', ratio: '16:9' },
  describe: 'What might be HAPPENING to your character? Select the character (and optionally locations) — each output is a distinct story moment placing them in a different location, something happening, identity and place preserved. With only the character selected, board locations fill in.',
  async run({ selection, settings, apiKey, ctx, onAsset, onError }) {
    // CHARACTER FIRST: the planner treats ref[0] as the character to preserve and
    // the rest as locations. A tagged talent/character node wins; else selection order.
    const sel = (selection || []).filter((n) => n.data?.kind === 'image' && n.data?.url);
    const isCast = (n) => n.data?.bibleRole === 'talent' || n.data?.bibleRole === 'character';
    const character = sel.find(isCast) || sel[0];
    const others = sel.filter((n) => n !== character);
    if (!character) throw new Error('Select your character image first');
    let refs = [refUrl(character), ...others.map(refUrl)];
    // Only the character selected → the canvas passes the bible's location anchors
    // via settings.locationUrls as the fallback stage set.
    if (refs.length < 2 && Array.isArray(settings.locationUrls) && settings.locationUrls.length) {
      refs = [refs[0], ...settings.locationUrls.slice(0, 3)];
    }
    if (refs.length < 2) throw new Error('Select the character plus at least one location (or tag location anchors in the bible)');
    const result = await ops.mixMatch(
      { imageUrls: refs, direction: settings.prompt, count: settings.count, size: settings.size, ratio: settings.ratio },
      ctx || browserCtx(apiKey),
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
  async run({ selection, settings, apiKey, ctx: injectedCtx, onPendingAsset, onResolveAsset, onFailAsset, onError }) {
    const anchor = firstImageNode(selection);
    if (!anchor) throw new Error('Select one image to animate');
    const ctx = injectedCtx || browserCtx(apiKey);

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

export const topicExplorerAgent = {
  id: 'topicExplorer',
  label: 'Topic Explorer',
  icon: 'explore',
  color: AGENT_COLORS.topicExplorer,
  consumes: ['text'],
  needsSelection: false,
  defaultSettings: { topic: '', budget: 12, depth: 2 },
  describe: 'Researches a topic BEFORE production: discovers its unique key concepts (you don\'t need to know the right taxonomy), explains what makes videos on it good, and fills the board shallow→deep with candidate assets — each carrying a suggested bible role you confirm by tagging.',
  async run({ prompt, selection, settings, apiKey, ctx, onAsset, onGroup, onError }) {
    const topic = (prompt && String(prompt).trim()) || (settings.topic || '').trim() || selectedText(selection);
    if (!topic) throw new Error('Give the explorer a topic first (the panel field, or select a text card)');
    const groupByConcept = {}; // conceptId -> board group frame id
    const result = await exploreTopic(
      { topic, budget: settings.budget, depth: settings.depth, roles: AD_ROLES },
      ctx || browserCtx(apiKey),
      {
        // The craft brief is user-visible knowledge, not buried context.
        onCraft: (text) => onAsset({ kind: 'text', text: `What makes a video on this topic good:\n\n${text}`, label: 'Topic brief', layerId: 'topicExplorer' }),
        // One titled group frame per discovered concept — the title IS the concept;
        // no why-card inside (it ate a cell and left frames looking empty).
        onConcept: (c) => {
          const gid = onGroup ? onGroup({ label: c.title }) : null;
          if (gid) groupByConcept[c.id] = gid;
        },
        // Candidates carry a SUGGESTED role (meta) — the user confirms by tagging.
        onImage: (img) => onAsset({ kind: 'image', url: img.url, label: img.label, layerId: 'topicExplorer', groupId: groupByConcept[img.conceptId] || null, meta: { prompt: img.prompt, suggestedRole: img.role || null } }),
        onError: (msg) => { if (onError) onError([msg]); },
      },
    );
    return { created: result.images, errors: [] };
  },
};

export const storyboardAgent = {
  id: 'storyboard',
  label: 'Storyboard',
  icon: 'board',
  color: AGENT_COLORS.storyboard,
  consumes: ['text'],
  needsSelection: false,
  defaultSettings: { lengthSec: 90 },
  describe: 'Breaks your film into 5–15s shots, like a real storyboard: one SHOT card per shot — what happens, framing, camera move — drawn around your tagged cast and places. The sketches plan; your REAL assets feed the video when you shoot.',
  // The canvas injects settings.idea + settings.bibleEntries (the real anchors) and
  // an onPanel callback that lays each panel as a CUT card on the board.
  async run({ prompt, settings, apiKey, ctx, onPanel, onPlan, onError }) {
    const result = await createStoryboard(
      {
        idea: (prompt && String(prompt).trim()) || (settings.idea || '').trim(),
        genre: settings.genre || '',
        targetSeconds: settings.lengthSec || 90,
        bible: settings.bibleEntries || [],
      },
      ctx || browserCtx(apiKey),
      { onPanel, onPlan, onError: (msg) => { if (onError) onError([msg]); } },
    );
    return { created: result.panels, errors: [] };
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
  async run({ selection, settings, apiKey, ctx, onAsset, onError }) {
    const sel = selection || [];
    const images = selectedImageUrls(sel);
    // Prefer local bytes for an uploaded video too (its TOS URL isn't fetchable).
    const video = refUrl(sel.find((n) => n.data?.kind === 'video' && n.data?.url)) || undefined;
    try {
      const { text } = await ops.promptMuse({ images, video, question: settings.question }, ctx || browserCtx(apiKey));
      onAsset({ kind: 'text', text, label: 'Prompt Muse', layerId: 'promptMuse', sourceRefs: [...images, ...(video ? [video] : [])], meta: { question: settings.question || '' } });
      return { created: 1, errors: [] };
    } catch (err) {
      if (onError) onError([err.message]);
      throw err;
    }
  },
};

// Story Director and Auto Director are intentionally GONE from the canvas — their
// rigid wizard UX is replaced by the Timeline (the spine) + the Bible (lock
// assets) + Auto-fill (drives the production engine directly). The orchestration
// engine itself (core/production.js) lives on; the canvas just drives it. (The
// headless Service-API storyDirector/autoDirector agents are a separate surface.)

// Animate is deliberately NOT in the rail: it's a technical capability the engine
// (and the planned generate→validate→correct→continue flow) configures per shot —
// not a creative agent a user picks. The op + its settings UI live on for those
// surfaces; AGENTS is the creative-tools rail only.
export const AGENTS = [
  topicExplorerAgent,
  inspirationAgent,
  characterVariationsAgent,
  locationVariationsAgent,
  mixMatchAgent,
  storyboardAgent,
  promptMuseAgent,
];

export const AGENT_MAP = AGENTS.reduce((acc, a) => {
  acc[a.id] = a;
  return acc;
}, {});
