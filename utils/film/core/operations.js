// Pure agent operations — the orchestration IP. No canvas, no browser, no network:
// each takes typed input + ctx { client, config } and returns typed results.
// The canvas and the headless SDK both call these; only the injected `client`
// differs. Prompts/models resolve through suiteConfig (root ← client ← per-call).

import { renderTemplate, getModel, getRuntime, clampSizeForModel } from '../suiteConfig';
import { withRetry } from './retry';

// Variation "axes" and styles are no longer hardcoded pools — the agentic
// planner (planPrompts, below) generates distinct, content-aware descriptors.

const clamp = (v, lo, hi, dflt) => Math.min(Math.max(Number(v) || dflt, lo), hi);

// ---- beat parsing (Story Director) --------------------------------------------

export const parseBeats = (text) => {
  const cleaned = String(text || '').trim().replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const normalize = (b) => {
    if (typeof b === 'string') return { title: b.slice(0, 60), prompt: b };
    if (b && typeof b === 'object') {
      const prompt = b.prompt || b.description || b.event || b.text || b.title || '';
      const title = b.title || b.label || b.name || prompt;
      return { title: String(title).slice(0, 60), prompt: String(prompt) };
    }
    return { title: '', prompt: '' };
  };
  const toBeats = (val) => {
    let arr = Array.isArray(val) ? val : null;
    if (!arr && val && typeof val === 'object') arr = Object.values(val).find((v) => Array.isArray(v)) || null;
    return (arr || []).map(normalize).filter((b) => b.prompt);
  };
  try { const b = toBeats(JSON.parse(cleaned)); if (b.length) return b; } catch { /* */ }
  const m = cleaned.match(/[[{][\s\S]*[\]}]/);
  if (m) { try { const b = toBeats(JSON.parse(m[0])); if (b.length) return b; } catch { /* */ } }
  const lines = cleaned.split('\n')
    .map((l) => l.replace(/^[\s\-*•\d.\)"']+/, '').replace(/["']+$/, '').trim())
    .filter((l) => l.length > 8 && !/^(here|sure|okay|options?|next)\b/i.test(l));
  if (lines.length) return lines.slice(0, 4).map((l) => ({ title: l.split(/[:—-]/)[0].slice(0, 40).trim() || l.slice(0, 40), prompt: l }));
  return [];
};


// ---- image batch (parallel, incremental) --------------------------------------

// `hooks` is EITHER a plain onItem function (back-compat: production.js / inspiration pass one)
// OR { onPlanned(specs), onItem(item, idx), onFail(idx, msg) } — the streaming form. The plan
// is known before any image renders, so onPlanned lets the canvas lay a PENDING placeholder per
// spec the moment planning finishes, then fill/fail each in place as the parallel batch resolves.
const runImagineBatch = async ({ specs, size, model }, ctx, hooks) => {
  const { onPlanned, onItem, onFail } = typeof hooks === 'function' ? { onItem: hooks } : (hooks || {});
  if (onPlanned) onPlanned(specs);
  const results = await Promise.allSettled(specs.map(async (spec, idx) => {
    try {
      // Transient Seedream errors (overload/429/timeouts) get backoff retries — the
      // batch runs in parallel, so without this one shed request = one lost image.
      const data = await withRetry(
        () => ctx.client.generateImage({ prompt: spec.prompt, referenceImages: spec.referenceImages, size, model }),
        { tries: 3, baseMs: 2500 },
      );
      const item = { url: data.url, prompt: data.prompt || spec.prompt, label: spec.label, referenceImages: spec.referenceImages || [], meta: spec.meta || {} };
      if (onItem) onItem(item, idx);
      return item;
    } catch (err) {
      if (onFail) onFail(idx, err?.message || 'failed');
      throw err;
    }
  }));
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || 'failed');
  return { created: results.filter((r) => r.status === 'fulfilled').length, errors };
};

// ---- agentic prompt planner ---------------------------------------------------
// Seed 2.0 Pro plans N substantially-different, content-aware prompts (reading any
// reference images = describe+mix). Structured JSON; retries once, then throws —
// NO hardcoded fallback: creative exploration is fully agentic.
const parsePromptSet = (text) => {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const toItems = (val) => {
    const arr = Array.isArray(val) ? val : (val && typeof val === 'object' ? Object.values(val).find(Array.isArray) : null);
    return (arr || []).map((o) => {
      if (typeof o === 'string') return { label: o.slice(0, 48), prompt: o };
      const prompt = o?.prompt || o?.description || o?.text || '';
      return { label: String(o?.label || o?.title || o?.name || prompt).slice(0, 48), prompt: String(prompt) };
    }).filter((x) => x.prompt);
  };
  try { const i = toItems(JSON.parse(cleaned)); if (i.length) return i; } catch { /* */ }
  const m = cleaned.match(/[[{][\s\S]*[\]}]/);
  if (m) { try { const i = toItems(JSON.parse(m[0])); if (i.length) return i; } catch { /* */ } }
  return [];
};

export const planPrompts = async ({ task, count = 4, idea = '', direction = '', references = [], config } = {}, ctx) => {
  const n = clamp(count, 1, 12, 4);
  let items = [];
  let lastErr = null;
  // Each task selects its planner persona via creativePlanner.{task}.user/.system
  // (inspiration / characterVariations / locationVariations); an unknown task falls back to
  // the shared exploratory instruction (creativePlanner.user) + an empty system.
  const userVars = {
    idea: idea || '(none given)',
    direction: direction || '(your call — choose the most interesting dimensions)',
    count: n,
  };
  const userPrompt = renderTemplate(`creativePlanner.${task}.user`, userVars) || renderTemplate('creativePlanner.user', userVars);
  for (let attempt = 0; attempt < 2 && items.length < n; attempt += 1) {
    try {
      const { content } = await ctx.client.reason({
        prompt: userPrompt,
        systemPrompt: renderTemplate(`creativePlanner.${task}.system`, { count: n }),
        images: references,
        modelId: getModel('reasoner', config),
        reasoningEffort: getRuntime(config).reasoningEffort,
      });
      const parsed = parsePromptSet(content);
      if (parsed.length) items = parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!items.length) throw new Error(`Creative planner returned no usable prompts${lastErr ? `: ${lastErr.message}` : ''}`);
  return items.slice(0, n);
};

// ---- agent operations ---------------------------------------------------------

// Inspiration: plan N distinct directions (reading selected refs = describe+mix),
// then render. `refs` are always read for ideas; `useRefsInGen` also feeds them to
// the image model as visual references.
export const inspiration = async ({ prompt, refs = [], useRefsInGen = false, count = 6, size = '2K', config } = {}, ctx, onItem) => {
  const n = clamp(count, 1, 12, 6);
  const items = await planPrompts({ task: 'inspiration', count: n, idea: prompt, references: refs, config }, ctx);
  const genRefs = useRefsInGen ? refs : [];
  const specs = items.map((it, i) => ({ prompt: it.prompt, referenceImages: genRefs, label: it.label || `Inspiration ${i + 1}`, meta: { planLabel: it.label } }));
  return runImagineBatch({ specs, size, model: getModel('seedream', config) }, ctx, onItem);
};

export const characterVariations = async ({ imageUrl, direction = '', count = 4, size = '2K', imageModel = 'seedream', config } = {}, ctx, hooks) => {
  if (!imageUrl) throw new Error('characterVariations requires an imageUrl');
  const n = clamp(count, 1, 8, 4);
  const items = await planPrompts({ task: 'characterVariations', count: n, direction, references: [imageUrl], config }, ctx);
  const specs = items.map((it, i) => ({ prompt: it.prompt, referenceImages: [imageUrl], label: it.label || `Variation ${i + 1}`, meta: { planLabel: it.label } }));
  return runImagineBatch({ specs, size: clampSizeForModel(imageModel, size), model: getModel(imageModel, config) || getModel('seedream', config) }, ctx, hooks);
};

export const locationVariations = async ({ imageUrl, direction = '', count = 4, size = '2K', imageModel = 'seedream', config } = {}, ctx, hooks) => {
  if (!imageUrl) throw new Error('locationVariations requires an imageUrl');
  const n = clamp(count, 1, 8, 4);
  const items = await planPrompts({ task: 'locationVariations', count: n, direction, references: [imageUrl], config }, ctx);
  const specs = items.map((it, i) => ({ prompt: it.prompt, referenceImages: [imageUrl], label: it.label || `Coverage ${i + 1}`, meta: { planLabel: it.label } }));
  return runImagineBatch({ specs, size: clampSizeForModel(imageModel, size), model: getModel(imageModel, config) || getModel('seedream', config) }, ctx, hooks);
};

// Compose the camera/lens preamble + motion into a single Seedance prompt.
export const buildAnimatePrompt = ({ motion, camera, lens, focalLength, aperture }) => {
  const notAuto = (v) => v && v !== 'auto';
  const cine = [
    notAuto(camera) && `Camera move: ${camera}`,
    notAuto(lens) && `Lens: ${lens}`,
    notAuto(focalLength) && `Focal length: ${focalLength}`,
    notAuto(aperture) && `Aperture: ${aperture} (control depth of field accordingly)`,
  ].filter(Boolean).join('. ');
  const motionText = (motion || '').trim();
  return [cine, motionText].filter(Boolean).join('. ');
};

// The dominant LIVE failure mode (observed 2026-06-11/12): the OUTPUT-AUDIO policy
// rejects an otherwise good shot ("output audio may contain sensitive information").
// Callers catch this and retake the shot once with generateAudio:false — a silent
// shot beats a hole in the final cut.
export const isAudioPolicyError = (err) => /output audio may contain sensitive/i.test((err && err.message) || '');

// The OUTPUT-IMAGE content filter ("the output image may contain sensitive
// information") rejects a generated still. Like the audio filter it's an OUTPUT-side,
// PER-SAMPLE check — so a re-roll usually produces a different image that passes
// (softening the prompt helps stubborn cases). Drives the cast-plate + storyboard-
// frame retries so a flagged frame self-heals instead of leaving a blank card.
export const isImagePolicyError = (err) => /image may contain sensitive/i.test((err && err.message) || '');

// Kicks off the async video task; caller polls via ctx.client.pollVideo({ taskId }).
// Duration is HARD-CLAMPED to 5–15s (a SHOT's range; it breaks into cuts of ≤5–6s):
// a stale setting or stray LLM number can't push outside it, no matter the caller.
// Two source modes: a single imageUrl/assetId (the classic keyframe → first frame),
// or `refUrls` — SEVERAL real reference images (direct-to-video: the storyboard's
// cast/place assets, untouched, so the video model preserves the subjects itself).
export const animate = async ({ imageUrl, assetId, refUrls = [], refAssetIds = [], firstFrameUrl = null, motion, camera, lens, focalLength, aperture, duration = 10, resolution = '1080p', ratio = 'adaptive', generateAudio = true, seed = null, modelKey = 'seedance', config } = {}, ctx) => {
  // Text-to-video is allowed: with no image / refs / first_frame, the PROMPT alone drives
  // it (the Story agent's continuous-shot film). Only fail when there's nothing at all.
  if (!imageUrl && !assetId && !refUrls.length && !firstFrameUrl && !String(motion || '').trim()) throw new Error('animate requires a prompt, imageUrl, assetId, refUrls or firstFrameUrl');
  duration = Math.min(15, Math.max(5, Math.round(Number(duration) || 10)));
  const prompt = buildAnimatePrompt({ motion, camera, lens, focalLength, aperture });
  const content = [{ type: 'text', text: prompt }];
  // CONTINUITY: the previous shot's FINAL FRAME becomes the literal FIRST FRAME of this
  // video (role 'first_frame' — Seedance's "consecutive videos" pattern), so the shot
  // picks up EXACTLY where the last ended. Sent first, before the subject references.
  if (firstFrameUrl) content.push({ type: 'image_url', image_url: { url: firstFrameUrl }, role: 'first_frame' });
  // Seedance 2.0 accepts up to 9 reference images (plus reference video ≤15s and
  // audio — not wired yet) — slice, never fail. A ref WITH a portrait-library id
  // (refAssetIds, aligned by index) rides as image_asset_id (the TRUSTED asset://
  // path) so a photoreal person plate isn't screened as a raw url ("input image may
  // contain real person"); refs without an id (the clay frame, anything un-preserved)
  // stay image_url.
  if (refUrls.length) {
    refUrls.slice(0, 9).forEach((u, i) => {
      const aid = refAssetIds[i];
      if (aid) content.push({ type: 'image_asset_id', asset_id: aid, role: 'reference_image' });
      else content.push({ type: 'image_url', image_url: { url: u }, role: 'reference_image' });
    });
  } else if (assetId) content.push({ type: 'image_asset_id', asset_id: assetId, role: 'reference_image' });
  else if (imageUrl) content.push({ type: 'image_url', image_url: { url: imageUrl }, role: 'reference_image' });
  // else: text-to-video — the prompt is the only content (no reference media).
  // seed (sequence-level, optional): held constant across re-shoots it isolates the
  // prompt as the only changed variable; null lets the model roll its own each time.
  // Per-shot endpoint choice: the SHOT card may pick a variant (e.g. Seedance 2.0 Mini) by
  // modelKey; unknown/blank falls back to the default seedance endpoint.
  const videoModel = getModel(modelKey, config) || getModel('seedance', config);
  const { taskId } = await withRetry(
    () => ctx.client.startVideo({ content, model: videoModel, resolution, ratio, duration, generateAudio, seed }),
    { tries: 3, baseMs: 3000 },
  );
  return { taskId, prompt };
};

export const suggestNextBeats = async ({ idea, steps = [], lastImageUrl, count = 3, config } = {}, ctx) => {
  const storySoFar = steps.length ? steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : '(nothing yet — this is the opening)';
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('storyDirector.user', { idea: idea || '(none given)', steps: storySoFar, count }),
    systemPrompt: renderTemplate('storyDirector.system', { count }),
    images: lastImageUrl ? [lastImageUrl] : [],
    modelId: getModel('reasoner', config), reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const beats = parseBeats(content);
  if (!beats.length) throw new Error('Story Director returned no usable beats — try again');
  return beats;
};

