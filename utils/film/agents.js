// Canvas agent registry (L4 binding). Holds UI metadata for each agent and a thin
// run() adapter that maps the canvas (React Flow selection + onAsset callbacks)
// onto the runtime-agnostic core operations. All orchestration/prompts/models
// live in core/operations.js — this file only translates canvas ⇄ core.

import { createBrowserClient } from './core/client';
import * as ops from './core/operations';
import * as director from './core/director';
import { buildAnimatePrompt } from './core/operations';
import { castFromIdea, writeFilmPrompt, deconstructTake } from './core/storyboard';
import { SIZE_TIERS as IMAGE_RESOLUTIONS, ASPECT_RATIOS as IMAGE_RATIOS } from './imageSizes';

// Re-exported so the canvas panels can reuse them.
export { IMAGE_RESOLUTIONS, IMAGE_RATIOS };

export const AGENT_COLORS = {
  inspiration: '#ff7d00',          // orange
  characterVariations: '#165dff',  // blue
  locationVariations: '#00b42a',   // green
  animate: '#722ed1',              // purple (video)
  storyDirector: '#f7ba1e',        // gold (interactive story)
  cast: '#9a5b13',                 // bronze (pre-production: cast & world)
  story: '#f7ba1e',                // gold (the narrative spine: key events)
  storyboard: '#4e5969',           // graphite (the shot plan)
  deconstruct: '#0fc6c2',          // teal (a Take → its cuts + key frames)
  shot: '#d9488f',                 // rose (a single SHOT card)
  breakdown: '#7a3fd6',            // violet (a storyboard → bible + shots)
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
  // Deconstruct's visual grounding: grab frames at the VLM's key timestamps (server
  // ffmpeg → base64). Returns [{ t, url }].
  frames: async (url, timestamps) => {
    const res = await fetch('/api/film/frames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, timestamps }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.details || data?.error || 'Frame extraction failed');
    return data.frames || [];
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
// Streaming hooks for a batch image agent (character/location variations): the moment the plan
// lands, lay ONE pending placeholder per planned spec (so the panel fills with loading cards
// immediately), then resolve each in place as the parallel batch returns. Falls back to dropping
// finished cards via onAsset when the canvas pending callbacks aren't supplied (headless/SDK).
const variationHooks = (layerId, anchor, src, { onAsset, onPendingAsset, onResolveAsset, onFailAsset } = {}) => {
  const streaming = typeof onPendingAsset === 'function' && typeof onResolveAsset === 'function';
  if (!streaming) {
    return (item) => onAsset && onAsset({ kind: 'image', url: item.url, label: item.label, layerId, sourceRefs: item.referenceImages, meta: { ...item.meta, anchorId: anchor.id } });
  }
  const ids = [];
  return {
    onPlanned: (specs) => specs.forEach((s, i) => {
      ids[i] = onPendingAsset({ kind: 'image', label: s.label, layerId, sourceRefs: [src], meta: { anchorId: anchor.id, planLabel: s.label } });
    }),
    onItem: (item, i) => { if (ids[i]) onResolveAsset(ids[i], { url: item.url, loading: false, label: item.label, sourceRefs: item.referenceImages, meta: { ...item.meta, anchorId: anchor.id } }); },
    onFail: (i, msg) => { if (onFailAsset && ids[i]) onFailAsset(ids[i], msg); },
  };
};

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
  consumes: [],
  needsSelection: false,
  grouped: true,
  defaultSettings: { count: 6, size: '2K', useSelectionAsRefs: false },
  describe: 'Generates a grid of distinct style/mood references from a prompt or your selected images.',
  // Every agent run accepts an optional injected `ctx` (the canvas passes a
  // trace-wrapped client so rail runs land in the decision history); without one
  // it builds the plain browser ctx from the apiKey as before.
  async run({ prompt, selection, settings, apiKey, ctx, onAsset, onError }) {
    // All selected images are read by the planner (describe + mix); the checkbox
    // also feeds them to the image model as visual references.
    const refs = selectedImageUrls(selection);
    const effectivePrompt = (prompt || '').trim();
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
  describe: 'Plans distinct variations of the selected character, identity preserved.',
  async run({ selection, settings, apiKey, ctx, onAsset, onPendingAsset, onResolveAsset, onFailAsset, onError }) {
    const anchor = firstImageNode(selection);
    if (!anchor) throw new Error('Select one character image first');
    const src = refUrl(anchor);
    const result = await ops.characterVariations(
      { imageUrl: src, direction: settings.direction, count: settings.count, size: settings.size },
      ctx || browserCtx(apiKey),
      variationHooks('characterVariations', anchor, src, { onAsset, onPendingAsset, onResolveAsset, onFailAsset }),
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
  describe: 'Plans distinct coverage of the selected location, architecture preserved.',
  async run({ selection, settings, apiKey, ctx, onAsset, onPendingAsset, onResolveAsset, onFailAsset, onError }) {
    const anchor = firstImageNode(selection);
    if (!anchor) throw new Error('Select one location image first');
    const src = refUrl(anchor);
    const result = await ops.locationVariations(
      { imageUrl: src, direction: settings.direction, count: settings.count, size: settings.size },
      ctx || browserCtx(apiKey),
      variationHooks('locationVariations', anchor, src, { onAsset, onPendingAsset, onResolveAsset, onFailAsset }),
    );
    if (result.errors.length && onError) onError(result.errors);
    return result;
  },
};

// (The Mix & Match agent was removed 2026-06-18 — per user. Its op, planner
// template, suggest helpers, director action, production/Service-API step and the
// canvas panel/dispatch are all gone too; characters land in locations via the
// SHOT-card storyboard path now, not a standalone composite tool.)

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
  describe: 'Renders a keyframe into a video shot — Seedance, ~1–3 min in the background.',
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

// Pre-production casting — a first-class rail agent (sibling of Inspiration). Drafts
// the whole production from the idea in the chosen genre; the canvas injects
// onPlan/onEntry to stream candidate plates onto the board, headless callers run it
// bare for anchors. Lives in the rail AND on the pipeline strip / genre gate — same
// agent, three triggers. (Its run() uses the onPlan/onEntry plate-streaming contract,
// not the rail's onAsset; the canvas routes the rail Run through the castDraft path.)
export const castAgent = {
  id: 'cast',
  label: 'Cast & World',
  icon: 'cast',
  color: AGENT_COLORS.cast,
  consumes: [],
  needsSelection: false,
  defaultSettings: { prompt: '' },
  describe: 'Drafts the film\'s recurring assets — characters, creatures, locations and key props/vehicles — in one shared look, as bible candidates.',
  async run({ prompt, settings = {}, apiKey, ctx, onPlan, onEntry, onError }) {
    const entries = await castFromIdea(
      { idea: (prompt && String(prompt).trim()) || (settings.idea || '').trim(), genre: settings.genre || '' },
      ctx || browserCtx(apiKey),
      { onPlan, onEntry, onError: (msg) => { if (onError) onError([msg]); } },
    );
    return { created: entries, errors: [] };
  },
};

// The STORY agent: an idea (or a pasted script) → ONE long cinematic prompt (clear subjects
// + story arc, CUT-structured but no CUT markers, no facing-camera, explicit eyelines). Text
// only — no key events, no appearances, no board reference assets. On the canvas the rail Run
// is intercepted (handleRun → ensureStoryNode + runStory, which drives the editable Story
// card); this run() is the headless/SDK entry.
export const storyAgent = {
  id: 'story',
  label: 'Story',
  icon: 'story',
  color: AGENT_COLORS.story,
  consumes: [],
  needsSelection: false,
  defaultSettings: { prompt: '' },
  describe: 'Rewrites your idea or script into one long cinematic prompt — subjects, arc, eyelines — as an editable Story card.',
  async run({ prompt, settings = {}, apiKey, ctx }) {
    const story = await writeFilmPrompt(
      {
        idea: (prompt && String(prompt).trim()) || (settings.idea || '').trim(),
        source: settings.source || '',
      },
      ctx || browserCtx(apiKey),
    );
    return { created: [], errors: [], story };
  },
};

// The DECONSTRUCT agent: a rendered Take (a 15s video) → its CUTs. The Seed 2.0 Pro VLM
// WATCHES the video and returns, per cut, the action + best-fit shot template + key
// timestamps. The canvas turns those into key-frame ingredients + per-cut SHOT cards (the
// bridge from Exploration to Directing). On the canvas the rail Run + the Take node's
// "Deconstruct" button are intercepted (handleRun → handleBreakdownTake); this run() is the
// headless/SDK entry. Operates on a SELECTED Take video.
export const deconstructAgent = {
  id: 'deconstruct',
  label: 'Deconstruct',
  icon: 'deconstruct',
  color: AGENT_COLORS.deconstruct,
  consumes: ['video'],
  needsSelection: true,
  defaultSettings: {},
  describe: 'Watches a selected Take and breaks it into per-cut SHOT cards + key-frame stills.',
  async run({ selection, settings = {}, apiKey, ctx }) {
    const take = (selection || []).find((n) => n.data?.kind === 'video' && n.data?.url);
    if (!take) throw new Error('Select one Take (a rendered video) first');
    const deconstruction = await deconstructTake(
      { videoUrl: take.data.url, prompt: settings.prompt || '', bible: settings.bible || [] },
      ctx || browserCtx(apiKey),
    );
    return { created: [], errors: [], deconstruction };
  },
};

// The STORYBOARD agent: the STORY → a visual storyboard, frame by frame. One Seedream
// frame per story element (CUT-marked), rendered SEQUENTIALLY — each frame uses the
// PREVIOUS frame as a visual reference and ONE shared seed for consistency. No bible refs.
// Storyboard = a conversational SHOT DIVISION: select a Story node and Run, and a chat node
// lands on the board bound to a column of SHOT cards. You brainstorm the shot list with a
// cinematographer; each turn it updates the cards. Canvas-only (it lays a chat node + cards) —
// the run() guards the headless/SDK path like cast/shot/breakdown.
export const storyboardAgent = {
  id: 'storyboard',
  label: 'Storyboard',
  icon: 'board',
  color: AGENT_COLORS.storyboard,
  consumes: [],
  needsSelection: false,
  defaultSettings: { genre: '', count: 8 },
  describe: 'Brainstorm the shot division with a cinematographer. Select a Story node and Run — a chat lands on the board, bound to a grid of keyframe stills (default 8) it builds and refines as you talk.',
  async run() {
    throw new Error('The Storyboard agent lays a chat node + SHOT cards on the canvas — run it from the board.');
  },
};

// The SHOT agent: drops a single EMPTY SHOT card (CutNode) on the board with a camera
// preset — no Story required. The rail Run is intercepted (handleRun lays the card); this
// run() guards the headless/SDK path, since laying a board node is a canvas-only action.
export const shotAgent = {
  id: 'shot',
  label: 'Shot',
  icon: 'shot',
  color: AGENT_COLORS.shot,
  consumes: [],
  needsSelection: false,
  defaultSettings: { prompt: '', shotTemplate: 'medium-shot', durationSec: 15 },
  describe: 'Drops an empty SHOT card with a camera preset — write the shot, attach references, then 🎬 to shoot.',
  async run() {
    throw new Error('The Shot agent lays a SHOT card on the canvas — run it from the board.');
  },
};

// Breakdown: select a director's STORYBOARD image → ONE Seed 2.0 Pro read → lays a keyframe
// still per drawn panel (matching its camera angle), in the SAME panel the Storyboard agent
// produces. Canvas-only like cast/shot — it lays board nodes (not a headless op; guarded run()).
export const breakdownAgent = {
  id: 'breakdown',
  label: 'Breakdown',
  icon: 'breakdown',
  color: AGENT_COLORS.breakdown,
  consumes: ['image'],
  needsSelection: true,
  defaultSettings: { genre: '' },
  describe: 'Select a hand-drawn storyboard — Seed 2.0 Pro reads it panel by panel and lays a grid of keyframe stills that reproduce each panel\'s camera angle (the same keyframe panel the Storyboard agent builds). No annotations needed.',
  async run() {
    throw new Error('The Breakdown agent lays a keyframe panel on the canvas — run it from the board.');
  },
};

export const AGENTS = [
  inspirationAgent,
  storyAgent,
  storyboardAgent,
  shotAgent,
  castAgent,
  characterVariationsAgent,
  locationVariationsAgent,
  deconstructAgent,
  breakdownAgent,
];

export const AGENT_MAP = AGENTS.reduce((acc, a) => {
  acc[a.id] = a;
  return acc;
}, {});
