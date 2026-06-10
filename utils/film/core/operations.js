// Pure agent operations — the orchestration IP. No canvas, no browser, no network:
// each takes typed input + ctx { client, config } and returns typed results.
// The canvas and the headless SDK both call these; only the injected `client`
// differs. Prompts/models resolve through suiteConfig (root ← client ← per-call).

import { renderTemplate, getModel } from '../suiteConfig';
import { resolveImageSize } from '../imageSizes';

// ---- variant descriptor pools -------------------------------------------------

export const VARIANT_POOLS = {
  wardrobe: ['rugged cold-weather field outfit', 'formal tailored attire', 'layered casual streetwear', 'utilitarian work uniform', 'weatherproof rain gear', 'worn vintage clothing'],
  age: ['as a teenager', 'in their twenties', 'in their forties', 'in their sixties', 'as a young child', 'as an elder'],
  expression: ['neutral and composed', 'subtle worry', 'quiet determination', 'exhausted and drawn', 'guarded suspicion', 'faint relief'],
  lighting: ['hard low-key side light', 'soft overcast daylight', 'warm practical tungsten glow', 'cold blue moonlight', 'harsh overhead fluorescent', 'golden-hour rim light'],
  pose: ['frontal portrait', 'three-quarter turn', 'clean profile', 'looking back over the shoulder', 'low-angle hero framing', 'candid mid-action'],
};

export const COVERAGE_POOLS = {
  angles: ['wide establishing shot', 'medium coverage', 'tight detail insert', 'high-angle overview', 'low-angle dramatic framing', 'doorway / threshold view'],
  timeOfDay: ['cold dawn light', 'flat midday', 'golden hour', 'blue-hour dusk', 'deep night', 'overcast grey'],
  weather: ['clear and still', 'heavy snowfall', 'thick fog', 'driving rain', 'violent storm', 'shimmering aurora'],
  season: ['deep winter', 'spring thaw', 'high summer', 'late autumn'],
};

const pickN = (pool, n) => Array.from({ length: n }, (_, i) => pool[i % pool.length]);
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
    const data = await ctx.client.generateImage({ prompt: spec.prompt, referenceImages: spec.referenceImages, size, model });
    const item = { url: data.url, prompt: data.prompt || spec.prompt, label: spec.label, referenceImages: spec.referenceImages || [], meta: spec.meta || {} };
    if (onItem) onItem(item);
    return item;
  }));
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || 'failed');
  return { created: results.filter((r) => r.status === 'fulfilled').length, errors };
};

// ---- agent operations ---------------------------------------------------------

export const inspiration = ({ prompt, refs = [], count = 6, size = '2K', config } = {}, ctx, onItem) => {
  const n = clamp(count, 1, 12, 6);
  const specs = Array.from({ length: n }, (_, i) => ({
    prompt: (prompt || '').trim() || renderTemplate('inspiration.fallback'),
    referenceImages: refs,
    label: `Inspiration ${i + 1}`,
    meta: { axis: 'inspiration' },
  }));
  return runImagineBatch({ specs, size, model: getModel('seedream', config) }, ctx, onItem);
};

export const characterVariations = ({ imageUrl, axis = 'wardrobe', count = 4, notes = '', size = '2K', config } = {}, ctx, onItem) => {
  if (!imageUrl) throw new Error('characterVariations requires an imageUrl');
  const n = clamp(count, 1, 8, 4);
  const descriptors = pickN(VARIANT_POOLS[axis] || VARIANT_POOLS.wardrobe, n);
  const notesText = notes ? `Director notes: ${notes}.` : '';
  const specs = descriptors.map((desc) => ({
    prompt: renderTemplate('characterVariations.instruction', { axis, descriptor: desc, notes: notesText }),
    referenceImages: [imageUrl],
    label: `${axis}: ${desc}`,
    meta: { axis, descriptor: desc },
  }));
  return runImagineBatch({ specs, size, model: getModel('seedream', config) }, ctx, onItem);
};

export const locationVariations = ({ imageUrl, axis = 'angles', count = 4, notes = '', size = '2K', config } = {}, ctx, onItem) => {
  if (!imageUrl) throw new Error('locationVariations requires an imageUrl');
  const n = clamp(count, 1, 8, 4);
  const descriptors = pickN(COVERAGE_POOLS[axis] || COVERAGE_POOLS.angles, n);
  const notesText = notes ? `Director notes: ${notes}.` : '';
  const specs = descriptors.map((desc) => ({
    prompt: renderTemplate('locationVariations.instruction', { axis, descriptor: desc, notes: notesText }),
    referenceImages: [imageUrl],
    label: `${axis}: ${desc}`,
    meta: { axis, descriptor: desc },
  }));
  return runImagineBatch({ specs, size, model: getModel('seedream', config) }, ctx, onItem);
};

export const mixMatch = ({ imageUrls = [], direction = '', count = 4, size = '2K', ratio = '16:9', config } = {}, ctx, onItem) => {
  if (imageUrls.length < 2) throw new Error('mixMatch requires at least two imageUrls');
  const n = clamp(count, 1, 8, 4);
  const dir = direction ? `Direction: ${direction}.` : '';
  const prompt = renderTemplate('mixMatch.instruction', { direction: dir });
  const specs = Array.from({ length: n }, (_, i) => ({ prompt, referenceImages: imageUrls, label: `Mix ${i + 1}`, meta: { refCount: imageUrls.length, ratio } }));
  // Resolve tier + aspect ratio → exact WxH so the composite frame matches the
  // intended shot and subject proportions hold.
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
export const animate = async ({ imageUrl, assetId, motion, camera, lens, focalLength, aperture, duration = 5, resolution = '720p', ratio = 'adaptive', generateAudio = true, config } = {}, ctx) => {
  if (!imageUrl && !assetId) throw new Error('animate requires an imageUrl or assetId');
  const prompt = buildAnimatePrompt({ motion, camera, lens, focalLength, aperture });
  const content = [{ type: 'text', text: prompt }];
  if (assetId) content.push({ type: 'image_asset_id', asset_id: assetId, role: 'reference_image' });
  else content.push({ type: 'image_url', image_url: { url: imageUrl }, role: 'reference_image' });
  const { taskId } = await ctx.client.startVideo({ content, model: getModel('seedance', config), resolution, ratio, duration, generateAudio });
  return { taskId, prompt };
};

export const promptMuse = async ({ images = [], video, question, config } = {}, ctx) => {
  if (images.length === 0 && !video) throw new Error('promptMuse requires an image or video');
  const focus = question && question.trim() ? `Focus on: ${question.trim()}.\n\n` : '';
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('promptMuse.user', { focus }),
    systemPrompt: renderTemplate('promptMuse.system'),
    images, video, modelId: getModel('reasoner', config),
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
    modelId: getModel('reasoner', config),
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
    modelId: getModel('reasoner', config),
  });
  return (content || '').trim().replace(/^["']|["']$/g, '');
};

export const suggestComposition = ({ images, config } = {}, ctx) =>
  suggestLine({ images, systemId: 'mixMatch.suggestSystem', userId: 'mixMatch.suggestUser', config }, ctx);

export const suggestMotion = ({ images, config } = {}, ctx) =>
  suggestLine({ images, systemId: 'animate.suggestSystem', userId: 'animate.suggestUser', config }, ctx);
