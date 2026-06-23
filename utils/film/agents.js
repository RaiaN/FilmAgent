// Canvas agent registry (L4 binding). Holds UI metadata for each agent and a thin
// run() adapter that maps the canvas (React Flow selection + onAsset callbacks)
// onto the runtime-agnostic core operations. All orchestration/prompts/models
// live in core/operations.js — this file only translates canvas ⇄ core.

import { createBrowserClient } from './core/client';
import * as ops from './core/operations';
import * as director from './core/director';
import { buildAnimatePrompt } from './core/operations';
import { castFromIdea, writeKeyEvents } from './core/storyboard';
import { SIZE_TIERS as IMAGE_RESOLUTIONS, ASPECT_RATIOS as IMAGE_RATIOS } from './imageSizes';

// Re-exported so the canvas panels can reuse them.
export { IMAGE_RESOLUTIONS, IMAGE_RATIOS };

export const AGENT_COLORS = {
  autoDirector: '#5a3df0',         // electric indigo (orchestrator)
  inspiration: '#ff7d00',          // orange
  characterVariations: '#165dff',  // blue
  locationVariations: '#00b42a',   // green
  animate: '#722ed1',              // purple (video)
  storyDirector: '#f7ba1e',        // gold (interactive story)
  cast: '#9a5b13',                 // bronze (pre-production: cast & world)
  story: '#f7ba1e',                // gold (the narrative spine: key events)
  storyboard: '#4e5969',           // graphite (the shot plan)
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
// The prompt to use from a selected text card (a board Note) — its full text.
const selectedText = (selection) => {
  const t = (selection || []).find((n) => n.data?.kind === 'text' && (n.data?.text || '').trim());
  return t ? String(t.data.text).trim() : '';
};

// ---- exported suggestion helpers (used by the panels) -------------------------

export const suggestNextBeats = ({ apiKey, idea, steps, lastImageUrl, count = 3 }) =>
  ops.suggestNextBeats({ idea, steps, lastImageUrl, count }, browserCtx(apiKey));

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
  describe: 'Generate a grid of reference imagery. Select multiple assets and it reads each, synthesises them, and plans distinct directions (Seed 2.0 Pro). Or seed from a selected Note. Each output is meaningfully different.',
  // Every agent run accepts an optional injected `ctx` (the canvas passes a
  // trace-wrapped client so rail runs land in the decision history); without one
  // it builds the plain browser ctx from the apiKey as before.
  async run({ prompt, selection, settings, apiKey, ctx, onAsset, onError }) {
    // All selected images are read by the planner (describe + mix); the checkbox
    // also feeds them to the image model as visual references.
    const refs = selectedImageUrls(selection);
    // Typed prompt wins; otherwise fall back to a selected text card (a Note).
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
  consumes: ['text'],
  needsSelection: false,
  defaultSettings: { prompt: '' },
  describe: 'Drafts the cast & world from your idea, in the chosen genre: 1–2 characters (people, animals or monsters — each a 4K face plate + full-body sheet) and 1–2 locations, all under one shared look. They land as candidates with suggested-role chips — you tag the keepers into the bible.',
  async run({ prompt, settings = {}, apiKey, ctx, onPlan, onEntry, onError }) {
    const entries = await castFromIdea(
      { idea: (prompt && String(prompt).trim()) || (settings.idea || '').trim(), genre: settings.genre || '' },
      ctx || browserCtx(apiKey),
      { onPlan, onEntry, onError: (msg) => { if (onError) onError([msg]); } },
    );
    return { created: entries, errors: [] };
  },
};

// The STORY agent: idea (or a pasted script) → 3–4 KEY EVENTS + APPEARANCE descriptions →
// one continuous TEXT-ONLY Seedance 2.0 prompt. Identity rides as DESCRIPTION — by default
// it does NOT pull the board's reference assets in (bible defaults to [] so the cast is
// invented from the idea); link an appearance to a Cast & World plate yourself to opt in.
// On the canvas the rail Run is intercepted (handleRun → ensureStoryNode + runStory, which
// drives the editable Story card); this run() is the headless/SDK entry.
export const storyAgent = {
  id: 'story',
  label: 'Story',
  icon: 'story',
  color: AGENT_COLORS.story,
  consumes: ['text'],
  needsSelection: false,
  defaultSettings: { prompt: '' },
  describe: 'Turns your idea (or a pasted script) into the film’s 3–4 KEY EVENTS + APPEARANCE descriptions, then one continuous text-only Seedance 2.0 prompt. Identity rides as description — it does NOT use the board’s reference assets by default; link any appearance to a Cast & World plate yourself to opt in. Lands as an editable Story card; “Shoot the film” turns it into a SHOT card.',
  async run({ prompt, settings = {}, apiKey, ctx }) {
    const story = await writeKeyEvents(
      {
        idea: (prompt && String(prompt).trim()) || (settings.idea || '').trim(),
        genre: settings.genre || '',
        source: settings.source || '',
        bible: settings.bible || [], // board refs are OPT-IN — never pulled in by default
      },
      ctx || browserCtx(apiKey),
    );
    return { created: [], errors: [], story };
  },
};

export const AGENTS = [
  inspirationAgent,
  storyAgent,
  castAgent,
  characterVariationsAgent,
  locationVariationsAgent,
];

export const AGENT_MAP = AGENTS.reduce((acc, a) => {
  acc[a.id] = a;
  return acc;
}, {});
