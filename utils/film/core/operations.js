// Pure agent operations — the orchestration IP. No canvas, no browser, no network:
// each takes typed input + ctx { client, config } and returns typed results.
// The canvas and the headless SDK both call these; only the injected `client`
// differs. Prompts/models resolve through suiteConfig (root ← client ← per-call).

import { renderTemplate, getModel, getRuntime } from '../suiteConfig';
import { resolveImageSize } from '../imageSizes';
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

// Prompt Muse emits two labelled parts — "What I see: <craft read>" then
// "Prompt: <ready-to-use prompt>". When that text feeds another agent we want
// ONLY the prompt, not the analysis. Pull everything after the "Prompt:" label
// (tolerating a leading bullet / markdown bold and :/-/– separators). Falls back
// to the full text when there's no label (a plain note), so a hand-typed card
// still works as a prompt.
export const extractMusePrompt = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return '';
  // Prefer a line-anchored "Prompt:" label (the well-formed two-part output);
  // fall back to an inline one (model put both parts on a single line).
  const label = raw.match(/(^|\n)[\s>*_-]*prompt[\s*_]*[:\-–—]\s*/i)
    || raw.match(/\bprompt[\s*_]*[:\-–—]\s*/i);
  if (label) {
    const after = raw.slice(label.index + label[0].length).trim();
    if (after) return after.replace(/^["'`*_\s]+|["'`*_\s]+$/g, '').trim();
  }
  return raw;
};

// ---- image batch (parallel, incremental) --------------------------------------

const runImagineBatch = async ({ specs, size, model }, ctx, onItem) => {
  const results = await Promise.allSettled(specs.map(async (spec) => {
    // Transient Seedream errors (overload/429/timeouts) get backoff retries — the
    // batch runs in parallel, so without this one shed request = one lost image.
    const data = await withRetry(
      () => ctx.client.generateImage({ prompt: spec.prompt, referenceImages: spec.referenceImages, size, model }),
      { tries: 3, baseMs: 2500 },
    );
    const item = { url: data.url, prompt: data.prompt || spec.prompt, label: spec.label, referenceImages: spec.referenceImages || [], meta: spec.meta || {} };
    if (onItem) onItem(item);
    return item;
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
  // A task may ship its own user instruction (the preservation-first adShot does —
  // the generic one's "what to explore / substantially different" is exploration
  // language that fights fidelity); otherwise the shared exploratory instruction.
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
export const inspiration = async ({ prompt, refs = [], useRefsInGen = false, count = 6, size = '2K', planTask = 'inspiration', config } = {}, ctx, onItem) => {
  const n = clamp(count, 1, 12, 6);
  // planTask selects the planner persona: 'inspiration' explores (the freeform
  // board); 'adShot' preserves (production shots — refs are canonical assets).
  const items = await planPrompts({ task: planTask, count: n, idea: prompt, references: refs, config }, ctx);
  const genRefs = useRefsInGen ? refs : [];
  const specs = items.map((it, i) => ({ prompt: it.prompt, referenceImages: genRefs, label: it.label || `Inspiration ${i + 1}`, meta: { planLabel: it.label } }));
  return runImagineBatch({ specs, size, model: getModel('seedream', config) }, ctx, onItem);
};

export const characterVariations = async ({ imageUrl, direction = '', count = 4, size = '2K', config } = {}, ctx, onItem) => {
  if (!imageUrl) throw new Error('characterVariations requires an imageUrl');
  const n = clamp(count, 1, 8, 4);
  const items = await planPrompts({ task: 'characterVariations', count: n, direction, references: [imageUrl], config }, ctx);
  const specs = items.map((it, i) => ({ prompt: it.prompt, referenceImages: [imageUrl], label: it.label || `Variation ${i + 1}`, meta: { planLabel: it.label } }));
  return runImagineBatch({ specs, size, model: getModel('seedream', config) }, ctx, onItem);
};

export const locationVariations = async ({ imageUrl, direction = '', count = 4, size = '2K', config } = {}, ctx, onItem) => {
  if (!imageUrl) throw new Error('locationVariations requires an imageUrl');
  const n = clamp(count, 1, 8, 4);
  const items = await planPrompts({ task: 'locationVariations', count: n, direction, references: [imageUrl], config }, ctx);
  const specs = items.map((it, i) => ({ prompt: it.prompt, referenceImages: [imageUrl], label: it.label || `Coverage ${i + 1}`, meta: { planLabel: it.label } }));
  return runImagineBatch({ specs, size, model: getModel('seedream', config) }, ctx, onItem);
};

export const mixMatch = async ({ imageUrls = [], direction = '', count = 4, size = '2K', ratio = '16:9', config } = {}, ctx, onItem) => {
  if (imageUrls.length < 2) throw new Error('mixMatch requires at least two imageUrls');
  const n = clamp(count, 1, 8, 4);
  const items = await planPrompts({ task: 'mixMatch', count: n, direction, references: imageUrls, config }, ctx);
  const specs = items.map((it, i) => ({ prompt: it.prompt, referenceImages: imageUrls, label: it.label || `Mix ${i + 1}`, meta: { refCount: imageUrls.length, planLabel: it.label } }));
  // Resolve tier + aspect ratio → exact WxH so the composite frame matches the shot.
  return runImagineBatch({ specs, size: resolveImageSize(size, ratio), model: getModel('seedream', config) }, ctx, onItem);
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
  const motionText = (motion || '').trim() || renderTemplate('animate.motionFallback');
  return [cine, motionText].filter(Boolean).join('. ');
};

// Kicks off the async video task; caller polls via ctx.client.pollVideo({ taskId }).
// Duration is HARD-CLAMPED to 10–15s (the quality bar): an LLM plan that says 5 — or
// a stale persisted setting — can't undercut it, no matter which path called us.
export const animate = async ({ imageUrl, assetId, motion, camera, lens, focalLength, aperture, duration = 10, resolution = '1080p', ratio = 'adaptive', generateAudio = true, config } = {}, ctx) => {
  if (!imageUrl && !assetId) throw new Error('animate requires an imageUrl or assetId');
  duration = Math.min(15, Math.max(10, Math.round(Number(duration) || 10)));
  const prompt = buildAnimatePrompt({ motion, camera, lens, focalLength, aperture });
  const content = [{ type: 'text', text: prompt }];
  if (assetId) content.push({ type: 'image_asset_id', asset_id: assetId, role: 'reference_image' });
  else content.push({ type: 'image_url', image_url: { url: imageUrl }, role: 'reference_image' });
  const { taskId } = await withRetry(
    () => ctx.client.startVideo({ content, model: getModel('seedance', config), resolution, ratio, duration, generateAudio }),
    { tries: 3, baseMs: 3000 },
  );
  return { taskId, prompt };
};

export const promptMuse = async ({ images = [], video, question, config } = {}, ctx) => {
  if (images.length === 0 && !video) throw new Error('promptMuse requires an image or video');
  const focus = question && question.trim() ? `Focus on: ${question.trim()}.\n\n` : '';
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('promptMuse.user', { focus }),
    systemPrompt: renderTemplate('promptMuse.system'),
    images, video, modelId: getModel('reasoner', config), reasoningEffort: getRuntime(config).reasoningEffort,
  });
  if (!content) throw new Error('Prompt Muse returned an empty response');
  return { text: content };
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

// One-line suggestion helpers (Mix & Match / Animate "Suggest with Prompt Muse").
const suggestLine = async ({ images, systemId, userId, config }, ctx) => {
  const { content } = await ctx.client.reason({
    prompt: renderTemplate(userId),
    systemPrompt: renderTemplate(systemId),
    images: images || [],
    // One-liner — keep it snappy, don't spend deep thinking budget.
    modelId: getModel('reasoner', config), reasoningEffort: 'low',
  });
  return (content || '').trim().replace(/^["']|["']$/g, '');
};

export const suggestComposition = ({ images, config } = {}, ctx) =>
  suggestLine({ images, systemId: 'mixMatch.suggestSystem', userId: 'mixMatch.suggestUser', config }, ctx);

export const suggestMotion = ({ images, config } = {}, ctx) =>
  suggestLine({ images, systemId: 'animate.suggestSystem', userId: 'animate.suggestUser', config }, ctx);
