// Canvas agent registry (L4 binding). Holds UI metadata for each agent and a thin
// run() adapter that maps the canvas (React Flow selection + onAsset callbacks)
// onto the runtime-agnostic core operations. All orchestration/prompts/models
// live in core/operations.js — this file only translates canvas ⇄ core.

import { createBrowserClient } from './core/client';
import { maxShotSeconds, defaultVideoModelKey, imageModelKeyOf } from './suiteConfig';
import * as ops from './core/operations';
import * as director from './core/director';
import { buildAnimatePrompt } from './core/operations';
import { castFromIdea, writeFilmPrompt } from './core/storyboard';
import { SIZE_TIERS as IMAGE_RESOLUTIONS, ASPECT_RATIOS as IMAGE_RATIOS } from './imageSizes';

// Re-exported so the canvas panels can reuse them.
export { IMAGE_RESOLUTIONS, IMAGE_RATIOS };

export const AGENT_COLORS = {
  inspiration: '#ff7d00',          // orange
  characterVariations: '#165dff',  // blue
  locationVariations: '#00b42a',   // green
  animate: '#722ed1',              // purple (video)
  cast: '#9a5b13',                 // bronze (pre-production: cast & world)
  story: '#f7ba1e',                // gold (the narrative spine: key events)
  storyboard: '#4e5969',           // graphite (the shot plan)
  shot: '#d9488f',                 // rose (a single SHOT card)
  previz: '#3491fa',               // sky blue (blocking: floor plan → projected shots)
  audio: '#7816ff',                // violet (spoken word: VO / line reads)
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
  // The continuity chain's capability: a shot's LAST frame rides as a reference into
  // the NEXT shot (per-card 🎬 + the Action loop) so consecutive shots connect.
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

// The reference a Seedream-backed agent should send for a node — DURABLE-FIRST:
// the store url (cacheUrl) never expires and every server path reads it natively.
// localUrl (the original data: bytes) only covers a node not yet checked in — e.g.
// an upload mid-staging (its data: passes straight through to Seedream); the raw
// remote url is the last resort and can be an expired Ark signature.
const refUrl = (n) => n?.data?.cacheUrl || n?.data?.localUrl || n?.data?.url;
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
  defaultSettings: { count: 6, size: '2K', useSelectionAsRefs: false, refs: [] },
  describe: 'Generates a grid of distinct style/mood references from a prompt and any board images you pick.',
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
  // The agent CARD carries its own source-image picker (anchorId) — no board
  // selection required to drop it; run() still guards the headless selection path.
  needsSelection: false,
  grouped: true,
  defaultSettings: { count: 4, size: '2K', direction: '', imageModel: '', anchorId: '' },
  describe: 'Plans distinct variations of a character, identity preserved — pick the source image below.',
  async run({ selection, settings, apiKey, ctx, onAsset, onPendingAsset, onResolveAsset, onFailAsset, onError }) {
    const anchor = firstImageNode(selection);
    if (!anchor) throw new Error('Select one character image first');
    const src = refUrl(anchor);
    const result = await ops.characterVariations(
      { imageUrl: src, direction: settings.direction, count: settings.count, size: settings.size, imageModel: imageModelKeyOf(settings.imageModel) },
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
  // Same as characterVariations: the card's picker is the source, not the selection.
  needsSelection: false,
  grouped: true,
  defaultSettings: { count: 4, size: '2K', direction: '', imageModel: '', anchorId: '' },
  describe: 'Plans distinct coverage of a location, architecture preserved — pick the source image below.',
  async run({ selection, settings, apiKey, ctx, onAsset, onPendingAsset, onResolveAsset, onFailAsset, onError }) {
    const anchor = firstImageNode(selection);
    if (!anchor) throw new Error('Select one location image first');
    const src = refUrl(anchor);
    const result = await ops.locationVariations(
      { imageUrl: src, direction: settings.direction, count: settings.count, size: settings.size, imageModel: imageModelKeyOf(settings.imageModel) },
      ctx || browserCtx(apiKey),
      variationHooks('locationVariations', anchor, src, { onAsset, onPendingAsset, onResolveAsset, onFailAsset }),
    );
    if (result.errors.length && onError) onError(result.errors);
    return result;
  },
};

// (There is no Mix & Match agent; characters land in locations via the
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
// the whole production from the idea; the canvas injects
// onPlan/onEntry to stream candidate plates onto the board, headless callers run it
// bare for anchors. Lives in the rail AND on the pipeline strip — same
// agent, three triggers. (Its run() uses the onPlan/onEntry plate-streaming contract,
// not the rail's onAsset; the canvas routes the rail Run through the castDraft path.)
export const castAgent = {
  id: 'cast',
  label: 'Cast & World',
  icon: 'cast',
  color: AGENT_COLORS.cast,
  consumes: [],
  needsSelection: false,
  defaultSettings: { prompt: '', imageModel: '', imageThinking: false, ethnicity: '', refs: [] },
  describe: 'Drafts the film\'s recurring assets — characters, creatures, locations and key props/vehicles — in one shared look, as bible candidates.',
  async run({ prompt, settings = {}, apiKey, ctx, onPlan, onEntry, onError }) {
    const entries = await castFromIdea(
      { idea: (prompt && String(prompt).trim()) || (settings.idea || '').trim(), ethnicity: settings.ethnicity || '', imageModel: imageModelKeyOf(settings.imageModel), thinking: !!settings.imageThinking, references: settings.references || [] },
      ctx || browserCtx(apiKey),
      { onPlan, onEntry, onError: (msg) => { if (onError) onError([msg]); } },
    );
    return { created: entries, errors: [] };
  },
};

// The BRIEF agent: a container for the user's OWN words — an idea, a description or a full
// script — held VERBATIM (no automatic rewrite). On the canvas the rail Run is intercepted
// (rail tap → createStoryNode: the card lands instantly); Cast & World and Storyboard read
// the brief verbatim, and Develop (opt-in, runStory) rewrites it into ONE long cinematic
// prompt (clear subjects + arc, explicit CUT markers, no facing-camera, explicit eyelines)
// which only New Shot consumes. This run() is the headless/SDK entry to that same rewrite.
export const storyAgent = {
  id: 'story',
  label: 'Brief',
  railHidden: true, // off the rail: briefs land via the intro card, Storyboard's scene box, or chat
  icon: 'story',
  color: AGENT_COLORS.story,
  consumes: [],
  needsSelection: false,
  defaultSettings: { prompt: '' },
  describe: 'Your idea, description or script — held VERBATIM on a Brief card; Develop, Cast & World, Storyboard and New Shot run from the card.',
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

// The STORYBOARD agent: the STORY → a visual storyboard, frame by frame. One Seedream
// frame per story element (CUT-marked), rendered SEQUENTIALLY — each frame uses the
// PREVIOUS frame as a visual reference and ONE shared seed for consistency. No bible refs.
// Storyboard = a conversational SHOT DIVISION: select a Brief node and Run, and a chat node
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
  defaultSettings: { script: '', count: 8, refs: [], ethnicity: '', style: 'Auto', imageModel: '', mode: 'multiple' },
  describe: 'Brainstorm the shot division with a cinematographer — a chat bound to a grid of keyframe stills it refines as you talk.',
  async run() {
    throw new Error('The Storyboard agent lays a chat node + SHOT cards on the canvas — run it from the board.');
  },
};

// The PREVIZ agent (v2 — the BLOCKING agent): from a brief it renders the scene's
// FLOOR PLAN — a schematic overhead blocking map (Seed 2.0 Pro plans space/parties/
// moves/AXIS, Seedream Pro draws it). The map is the scene's spatial state: edit it
// like any image; attach it to a SHOT card and the projection writes camera-relative
// blocking into that card's prompt. On the canvas the agent card's Run calls
// runFloorPlan; this run() is canvas-only.
export const previzAgent = {
  id: 'previz',
  label: 'Previz',
  icon: 'previz',
  color: AGENT_COLORS.previz,
  consumes: [],
  needsSelection: false,
  defaultSettings: { brief: '' },
  describe: 'Brief → the scene\'s SCHEMATIC: an overhead blocking map (parties, moves, the AXIS). Edit it like any image; attach it to a SHOT card to project camera-relative blocking into the prompt.',
  async run() {
    throw new Error('The Previz agent lays image nodes on the canvas — run it from the board.');
  },
};

// The SHOT agent: drops a single EMPTY SHOT card (CutNode) on the board with a camera
// preset — no Story required. The rail tap lays the card directly; this
// run() guards the headless/SDK path, since laying a board node is a canvas-only action.
export const shotAgent = {
  id: 'shot',
  label: 'Shot',
  icon: 'shot',
  color: AGENT_COLORS.shot,
  consumes: [],
  needsSelection: false,
  defaultSettings: { prompt: '', shotTemplate: 'medium-shot', durationSec: maxShotSeconds(defaultVideoModelKey()) },
  describe: 'A SHOT card carrying your description and camera preset — edit on the card, attach references, then 🎬 to shoot.',
  async run() {
    throw new Error('The Shot agent lays a SHOT card on the canvas — run it from the board.');
  },
};

// The AUDIO agent — Seed Audio 1.0: the typed prompt goes out VERBATIM (the consistency
// rule applies to sound) and comes back as a playable clip node — line reads, narration,
// ambience, SFX; references = up to 3 board clips (@Audio1..N) OR one mood image.
// One explicit tap = one call; nothing is mixed into any film.
export const audioAgent = {
  id: 'audio',
  label: 'Audio',
  icon: 'audio',
  color: AGENT_COLORS.audio,
  consumes: [],
  needsSelection: false,
  defaultSettings: { prompt: '', imageRef: '', audioRefs: [] },
  describe: 'Your words, word for word → a playable clip: line reads, narration, ambience, SFX — optionally board clips as @Audio1..N voice/sound references, or one board image for scene mood. Nothing is mixed into the film.',
  async run({ prompt, settings = {}, apiKey, ctx }) {
    const out = await ops.generateFilmAudio(
      { text: (prompt && String(prompt)) || settings.prompt || '', imageData: settings.imageData, audioRefs: settings.audioRefs },
      ctx || browserCtx(apiKey),
    );
    return { created: [{ kind: 'audio', url: out.url, label: String(prompt || settings.prompt || 'Audio').slice(0, 40) }], errors: [] };
  },
};

export const AGENTS = [
  storyAgent,
  storyboardAgent,
  previzAgent,
  shotAgent,
  castAgent,
  characterVariationsAgent,
  locationVariationsAgent,
  audioAgent,
  inspirationAgent,
];

export const AGENT_MAP = AGENTS.reduce((acc, a) => {
  acc[a.id] = a;
  return acc;
}, {});
