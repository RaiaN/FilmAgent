// Root settings for the agentic film suite — the single source of truth for how
// every agent behaves: which models they call, their default parameters, runtime
// timings, and (via promptTemplates) their prompts.
//
// Resolution cascade (last wins):
//   ROOT_CONFIG (bundled)  ←  client config (SDK init / canvas localStorage)  ←  per-call overrides
//
// The Service API / SDK will pass `config` (client) and per-call overrides; the
// canvas uses the localStorage layer. Server code reads ROOT_CONFIG and honors
// per-request overrides passed in the request body.

import {
  renderTemplate,
  getTemplateText,
  setTemplateText,
  resetTemplate,
  resetAllTemplates,
  isOverridden,
  DEFAULT_TEMPLATES,
  templatesByAgent,
} from './promptTemplates';

export const ROOT_CONFIG = {
  models: {
    seedream: 'ep-20260501195034-hj78f',        // Seedream 5.0 Lite image endpoint (default)
    seedreamPro: 'dola-seedream-5-0-pro-260628', // Seedream 5.0 Pro (latest; up to 10 reference images)
    seedance: 'ep-20260415171928-pdvvr',    // Seedance 2.0 video endpoint (default)
    seedanceFast: 'ep-20260701151623-f94zq', // Seedance 2.0 Fast (full-quality, faster than the default)
    seedanceMini: 'ep-20260629005443-n7rjn', // Seedance 2.0 Mini (faster/cheaper — opt-in per SHOT card)
    reasoner: 'seed-2-0-pro-260328',        // Seed 2.0 Pro (multimodal reasoning / suggestions)
  },
  runtime: {
    pollIntervalMs: 4000,    // Seedance task polling cadence
    timeoutMs: 360000,       // max wait for an async (video) task
    defaultImageSize: '2K',
    reasoningEffort: 'high', // Seed 2.0 Pro thinking depth for the heavy reasoning
                             // calls (plan, QC, style curation, brief). 'low' |
                             // 'medium' | 'high' | null (off). One-liner helpers
                             // override to 'low'.
  },
  // Per-agent default parameters (the headless equivalent of the UI's defaultSettings).
  defaults: {
    inspiration: { count: 6, size: '2K' },
    characterVariations: { count: 4, size: '2K', direction: '' },
    locationVariations: { count: 4, size: '2K', direction: '' },
    storyDirector: { count: 3, size: '2K' },
    animate: {
      camera: 'slow push-in', lens: 'auto', focalLength: '35mm', aperture: 'f/2.8',
      // Quality bar: 10s @ 1080p per shot (was 5s @ 720p) — long enough to trim,
      // sharp enough to ship.
      duration: 10, resolution: '1080p', ratio: 'adaptive', generateAudio: true,
    },
  },
};

// ---- client-config override layer (localStorage; browser only) ----

const STORAGE_KEY = 'film-agent-suite-config';

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

const deepMerge = (base, override) => {
  if (!isObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  Object.keys(override).forEach((k) => {
    out[k] = isObject(base?.[k]) && isObject(override[k]) ? deepMerge(base[k], override[k]) : override[k];
  });
  return out;
};

export const getClientConfig = () => {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

export const setClientConfig = (partial) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(deepMerge(getClientConfig(), partial)));
  } catch { /* non-fatal */ }
};

export const resetClientConfig = () => {
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  }
};

// ---- resolver + accessors ----

// Resolve the effective config: ROOT ← client ← per-call.
export const resolveConfig = (perCall = {}) => deepMerge(deepMerge(ROOT_CONFIG, getClientConfig()), perCall || {});

export const getModel = (key, perCall) => resolveConfig(perCall).models[key];

// The Seedance (video) endpoints a SHOT card can shoot a take on. `key` indexes
// ROOT_CONFIG.models; the card stores the key in data.videoModel ('seedance' = default).
export const VIDEO_MODEL_OPTIONS = [
  { key: 'seedance', label: 'Seedance 2.0' },
  { key: 'seedanceMini', label: 'Seedance 2.0 Mini' },
];

// The Seedream (image) models the Storyboard keyframes can render on. `key` indexes
// ROOT_CONFIG.models; the storyboard stores the key in data.imageModel ('seedream' = Lite = default).
// Pro accepts up to 10 reference images; Lite is capped lower.
export const IMAGE_MODEL_OPTIONS = [
  { key: 'seedream', label: 'Seedream 5.0 Lite' },
  { key: 'seedreamPro', label: 'Seedream 5.0 Pro' },
];
export const IMAGE_REF_CAP = { seedream: 6, seedreamPro: 10 };
export const imageRefCap = (key) => IMAGE_REF_CAP[key] || 6;
// Seedream 5.0 Pro caps the image AREA at 4,194,304 px (2048²) — the 2K 16:9 (2848×1600 = 4.56MP)
// exceeds it, so Pro renders at the largest 16:9 under the cap (2560×1440 = 3.69MP). Lite allows 2K.
export const keyframeImageSize = (key) => (key === 'seedreamPro' ? '2560x1440' : '2848x1600');
// Clamp ANY size for the chosen image model: Lite passes through; for Pro an explicit
// 'WxH' over the area cap scales down to fit (aspect kept, snapped to multiples of 16),
// and a bare tier name ('2K'/'4K' — the model would pick its own, possibly over-cap,
// dimensions) becomes a safe explicit square. Used by cast plates + variations when
// the user routes them to Pro.
export const clampSizeForModel = (modelKey, size) => {
  if (modelKey !== 'seedreamPro') return size;
  const s = String(size || '').trim();
  const m = /^(\d+)[xX](\d+)$/.exec(s);
  if (!m) return '2048x2048';
  const w = Number(m[1]);
  const h = Number(m[2]);
  const MAX = 4194304; // 2048²
  if (!w || !h || w * h <= MAX) return s;
  const k = Math.sqrt(MAX / (w * h));
  const snap = (v) => Math.max(64, Math.floor((v * k) / 16) * 16);
  return `${snap(w)}x${snap(h)}`;
};

// Resolutions allowed per Seedance endpoint: the standard one goes up to 4K; Mini caps at 720p
// (no 1080p, no 4K). Shared by the CutNode dropdown AND the shoot path so the two never diverge.
export const RES_BY_MODEL = { seedance: ['480p', '720p', '1080p', '4K'], seedanceMini: ['480p', '720p'] };
export const resDefault = (model) => (model === 'seedanceMini' ? '720p' : '1080p');
export const clampResolution = (model, res) => {
  const opts = RES_BY_MODEL[model] || RES_BY_MODEL.seedance;
  return opts.includes(res) ? res : resDefault(model);
};

export const getRuntime = (perCall) => resolveConfig(perCall).runtime;

export const getAgentDefaults = (agentId, perCall) => (resolveConfig(perCall).defaults || {})[agentId] || {};

// Prompts are part of the root settings; re-export the prompt API so suiteConfig
// is the single import surface for everything configurable.
export const renderPrompt = renderTemplate;
export {
  renderTemplate,
  getTemplateText,
  setTemplateText,
  resetTemplate,
  resetAllTemplates,
  isOverridden,
  DEFAULT_TEMPLATES,
  templatesByAgent,
};
