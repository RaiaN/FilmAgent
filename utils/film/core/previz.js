import { renderTemplate, getModel, getRuntime, keyframeImageSize, defaultImageModelKey, imageModelKeyOf } from '../suiteConfig';
import { parseJson } from './director';

// PREVIZ — structure first, look second. Three steps, three artifacts:
//   1. blockout still  (Seedream)  — colour-coded clay maquette: staging, no identity
//   2. previz take     (Seedance @480p) — the still animates; blocking + camera, cheap
//   3. beauty take     (Seedance @1080p) — an EDITING task over the previz clip
//
// The PLAN call runs once at step 1 and fixes the colour->subject mapping, so steps 2
// and 3 are deterministic: the editing prompt reads back the exact colours the blockout
// was rendered with, and nothing is re-inferred between passes.

// The clay palette, in the order the planner assigns it. A pipeline constant: the
// blockout renders these colours and the beauty pass replaces them by name.
export const PREVIZ_COLORS = ['RED', 'BLUE', 'GREEN', 'YELLOW', 'PURPLE', 'ORANGE'];

// The compact form of the clay convention, carried ON the blockout node so any later
// EDIT of that still restates the medium instead of leaving a vacuum the image model
// fills with its photoreal default.
export const PREVIZ_CLAY_STYLE = 'matte clay blockout maquette — featureless solid-colour clay figures, plain grey clay set, no textures';

const PREVIZ_RESOLUTION = '480p';
const BEAUTY_RESOLUTION = '1080p';

// ONE reasoner call: scene description -> the clay staging, the colour map, the target
// look and the motion. Everything downstream reads this object.
export const previzPlan = async ({ brief = '', camera = '', config } = {}, ctx) => {
  const text = String(brief || '').trim();
  if (!text) throw new Error('Previz needs a scene description first.');
  const B = '@@BRIEF@@';
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('previz.plan.user', { brief: B, camera: String(camera || '').trim() || 'the planner chooses' }).split(B).join(text.slice(0, 6000)),
    systemPrompt: renderTemplate('previz.plan.system', {}),
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const raw = parseJson(content) || {};
  const subjects = (Array.isArray(raw.subjects) ? raw.subjects : [])
    .map((s) => ({
      color: PREVIZ_COLORS.includes(String(s?.color || '').toUpperCase()) ? String(s.color).toUpperCase() : '',
      description: String(s?.description || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    }))
    .filter((s) => s.color && s.description)
    .slice(0, PREVIZ_COLORS.length);
  const plan = {
    scene: String(raw.scene || '').replace(/\s+/g, ' ').trim().slice(0, 1600),
    subjects,
    look: String(raw.look || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    motion: String(raw.motion || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
  };
  if (!plan.scene) throw new Error('The previz plan came back without a staging — try again.');
  return plan;
};

// STEP 1 — the clay blockout still. Identity-free by construction, so re-rolling the
// staging costs nothing but the image.
export const blockoutStill = async ({ plan, imageModel = defaultImageModelKey(), config } = {}, ctx) => {
  const scene = String(plan?.scene || '').trim();
  if (!scene) throw new Error('Blockout needs the previz plan.');
  const model = imageModelKeyOf(imageModel);
  const prompt = renderTemplate('previz.blockout', { scene });
  const { url, cacheUrl } = await ctx.client.generateImage({
    prompt,
    size: keyframeImageSize(model),
    model: getModel(model, config),
    optimizePrompt: false,
  });
  return { url, cacheUrl, prompt, styleLock: PREVIZ_CLAY_STYLE };
};

// STEP 2 — the previz take: the blockout animates at 480p. The still rides as
// `first_frame` (a near-lock: composition holds, the opening may crop very slightly).
export const previzTake = async ({ stillUrl, plan, durationSec = 5, ratio = 'adaptive', modelKey, config } = {}, ctx) => {
  if (!stillUrl) throw new Error('The previz take needs the blockout still.');
  const motion = String(plan?.motion || '').trim();
  if (!motion) throw new Error('The previz take needs the plan\'s motion line.');
  const prompt = renderTemplate('previz.take', { motion });
  const { taskId } = await ctx.client.startVideo({
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: stillUrl }, role: 'first_frame' },
    ],
    model: getModel(modelKey || 'seedance25', config),
    resolution: PREVIZ_RESOLUTION,
    ratio,
    duration: Math.max(5, Math.round(Number(durationSec) || 5)),
    generateAudio: false,
  });
  return { taskId, prompt };
};

// One replacement line per planned subject — the editing task's scope, built from the
// same colour map the blockout was rendered with.
const replacementsOf = (subjects, plateCount = 0) => (subjects || []).map((s, i) => {
  const plate = plateCount > i ? ` Match the appearance in @Image${i + 1}.` : '';
  return `Replace the ${s.color} clay figure with ${s.description}, at exactly the same position, pose, motion path and timing.${plate}`;
}).join('\n');

// STEP 3 — the beauty pass: a VIDEO EDITING task over the previz clip at 1080p.
// The prompt's wording is what routes it; Seedance then locks ratio and duration to the
// source (both omitted here — sending either is rejected) while honouring resolution.
export const beautyTake = async ({ previzUrl, plan, plateUrls = [], modelKey, config } = {}, ctx) => {
  if (!previzUrl) throw new Error('The beauty pass needs the previz take.');
  const subjects = Array.isArray(plan?.subjects) ? plan.subjects : [];
  if (!subjects.length) throw new Error('The beauty pass needs the plan\'s colour map.');
  const plates = (plateUrls || []).filter(Boolean).slice(0, 5); // spec: editing takes 1-5 target images
  const prompt = renderTemplate('previz.beauty', {
    look: String(plan?.look || '').trim(),
    replacements: replacementsOf(subjects, plates.length),
    count: String(subjects.length),
  });
  const content = [
    { type: 'text', text: prompt },
    { type: 'video_url', video_url: { url: previzUrl }, role: 'reference_video' },
  ];
  plates.forEach((url) => content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' }));
  const { taskId } = await ctx.client.startVideo({
    content,
    model: getModel(modelKey || 'seedance25', config),
    resolution: BEAUTY_RESOLUTION,
    ratio: null,      // locked to the source clip by the editing task
    duration: 'auto', // same
    generateAudio: false,
  });
  return { taskId, prompt };
};
