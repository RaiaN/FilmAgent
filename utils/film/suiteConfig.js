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
    seedream: 'ep-20260501195034-hj78f',   // Seedream 5.0 image endpoint
    seedance: 'ep-20260415171928-pdvvr',    // Seedance video endpoint
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
