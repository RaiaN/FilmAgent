// Pure agent operations — the orchestration IP. No canvas, no browser, no network:
// each takes typed input + ctx { client, config } and returns typed results.
// The canvas and the headless SDK both call these; only the injected `client`
// differs. Prompts/models resolve through suiteConfig (root ← client ← per-call).

import { renderTemplate, getModel, getRuntime, clampSizeForModel, clampShotSeconds, videoModelKeyOf, videoTraits, defaultImageModelKey } from '../suiteConfig';
import { fitList, fitText } from './limits';
import { requireSkillLine } from '../skills';

// Variation "axes" and styles are no longer hardcoded pools — the agentic
// planner (planPrompts, below) generates distinct, content-aware descriptors.

const clamp = (v, lo, hi, dflt) => Math.min(Math.max(Number(v) || dflt, lo), hi);

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
      // One call per image: a failure is that image's failure, reported, never re-rolled.
      const data = await ctx.client.generateImage({ prompt: spec.prompt, referenceImages: spec.referenceImages, size, model });
      const item = { url: data.url, cacheUrl: data.cacheUrl || null, prompt: data.prompt || spec.prompt, label: spec.label, referenceImages: spec.referenceImages || [], meta: spec.meta || {} };
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

// `imageModel` is what the planned prompts will be RENDERED by, so its skill rides in
// the planner's system prompt: this call is where the prompts are actually written, and
// a spec that does not reach the writer is a spec that does nothing.
export const planPrompts = async ({ task, count = 4, idea = '', direction = '', references = [], imageModel = '', config } = {}, ctx) => {
  const n = clamp(count, 1, 12, 4);
  let items = [];
  // Each task selects its planner persona via creativePlanner.{task}.user/.system
  // (inspiration / characterVariations / locationVariations); an unknown task falls back to
  // the shared exploratory instruction (creativePlanner.user) + an empty system.
  const userVars = {
    idea: idea || '(none given)',
    direction: direction || '(your call — choose the most interesting dimensions)',
    count: n,
  };
  const userPrompt = renderTemplate(`creativePlanner.${task}.user`, userVars) || renderTemplate('creativePlanner.user', userVars);
  const skill = imageModel ? await requireSkillLine(imageModel) : '';
  // A reply that parses to too few prompts (OUR check) gets one more ask; an API failure is
  // never re-asked — it is the error.
  for (let attempt = 0; attempt < 2 && items.length < n; attempt += 1) {
    const { content } = await ctx.client.reason({ // eslint-disable-line no-await-in-loop
      prompt: userPrompt,
      systemPrompt: renderTemplate(`creativePlanner.${task}.system`, { count: n, skill }),
      images: references,
      modelId: getModel('reasoner', config),
      reasoningEffort: getRuntime(config).reasoningEffort,
    });
    const parsed = parsePromptSet(content);
    if (parsed.length > items.length) items = parsed;
  }
  if (!items.length) throw new Error('The planner returned no usable prompts — ask again.');
  if (items.length < n) throw new Error(`The planner wrote ${items.length} of the ${n} prompts asked for — ask again.`);
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
  const specs = items.map((it, i) => ({ prompt: it.prompt, referenceImages: genRefs, label: it.label || `Mood ${i + 1}`, meta: { planLabel: it.label } }));
  // Pro is the suite-wide default image model; its 2048² area cap clamps the size tier.
  return runImagineBatch({ specs, size: clampSizeForModel(defaultImageModelKey(), size), model: getModel(defaultImageModelKey(), config) }, ctx, onItem);
};

export const characterVariations = async ({ imageUrl, direction = '', count = 4, size = '2K', imageModel = defaultImageModelKey(), config } = {}, ctx, hooks) => {
  const n = clamp(count, 1, 8, 4);
  // NO SOURCE IMAGE: build the identity anchor from the description first, then vary THAT.
  // A variation preserves an identity, so the answer is to give it one — not to let each
  // variation invent its own person, which is four strangers, not a range.
  let source = imageUrl;
  if (!source) {
    const brief = String(direction || '').trim();
    if (!brief) throw new Error('Pick a source image, or describe the character in Direction — with neither there is no identity to vary.');
    const plate = await ctx.client.generateImage({
      prompt: renderTemplate('character.anchor', { brief }),
      size: clampSizeForModel(imageModel, size),
      model: getModel(imageModel, config),
      optimizePrompt: false,
    });
    if (!plate?.url) throw new Error('The character plate came back empty — try again, or pick a source image.');
    source = plate.url;
    if (hooks && typeof hooks.onAnchor === 'function') hooks.onAnchor({ url: plate.url, cacheUrl: plate.cacheUrl || null, label: 'Character plate' });
  }
  const items = await planPrompts({ task: 'characterVariations', count: n, direction, references: [source], imageModel, config }, ctx);
  // EDIT-LOCKED variations (the Edit-shot foundation): the source is [Image 1] and each
  // planned item is an INSTRUCTION — the edit grammar keeps identity/geometry pinned and
  // changes only what the instruction names (drift died with the re-compose approach).
  const SLOT = '@@EDIT@@';
  const specs = items.map((it, i) => ({
    prompt: renderTemplate('storyboard.frameEdit', { instruction: SLOT }).split(SLOT).join(fitText(it.prompt, 2000, `Planned edit "${it.label || i + 1}"`)),
    referenceImages: [source], label: it.label || `Variation ${i + 1}`, meta: { planLabel: it.label, instruction: it.prompt },
  }));
  return runImagineBatch({ specs, size: clampSizeForModel(imageModel, size), model: getModel(imageModel, config) }, ctx, hooks);
};

export const locationVariations = async ({ imageUrl, direction = '', count = 4, size = '2K', imageModel = defaultImageModelKey(), config } = {}, ctx, hooks) => {
  const n = clamp(count, 1, 8, 4);
  // NO SOURCE IMAGE: build the canonical location out of the description first, then run
  // the ordinary edit path against it. Coverage here is a REFRAME of one image — that is
  // what holds the architecture still across angles — so the fix is to supply the image,
  // not to loosen the coverage into N independently-imagined places.
  let source = imageUrl;
  if (!source) {
    const brief = String(direction || '').trim();
    if (!brief) throw new Error('Pick a source image, or describe the location in Direction — with neither there is nothing to cover.');
    const plate = await ctx.client.generateImage({
      prompt: renderTemplate('location.anchor', { brief }),
      size: clampSizeForModel(imageModel, size),
      model: getModel(imageModel, config),
      optimizePrompt: false,
    });
    if (!plate?.url) throw new Error('The location plate came back empty — try again, or pick a source image.');
    source = plate.url;
    if (hooks && typeof hooks.onAnchor === 'function') hooks.onAnchor({ url: plate.url, cacheUrl: plate.cacheUrl || null, label: 'Location plate' });
  }
  const items = await planPrompts({ task: 'locationVariations', count: n, direction, references: [source], imageModel, config }, ctx);
  // Same edit-locked foundation: coverage = reframe instructions, states = change-only.
  const SLOT = '@@EDIT@@';
  const specs = items.map((it, i) => ({
    prompt: renderTemplate('storyboard.frameEdit', { instruction: SLOT }).split(SLOT).join(fitText(it.prompt, 2000, `Planned edit "${it.label || i + 1}"`)),
    referenceImages: [source], label: it.label || `Coverage ${i + 1}`, meta: { planLabel: it.label, instruction: it.prompt },
  }));
  return runImagineBatch({ specs, size: clampSizeForModel(imageModel, size), model: getModel(imageModel, config) }, ctx, hooks);
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

// Kicks off the async video task; caller polls via ctx.client.pollVideo({ taskId }).
// Duration is HARD-CLAMPED to 5–15s (a SHOT's range; it breaks into cuts of ≤5–6s):
// a stale setting or stray LLM number can't push outside it, no matter the caller.
// Two source modes: a single imageUrl/assetId (the classic keyframe → first frame),
// or `refUrls` — SEVERAL real reference images (direct-to-video: the storyboard's
// cast/place assets, untouched, so the video model preserves the subjects itself).
export const animate = async ({ imageUrl, assetId, refUrls = [], refAssetIds = [], refRoles = [], firstFrameUrl = null, lastFrameUrl = null, audioRefUrls = [], videoRefUrls = [], motion, camera, lens, focalLength, aperture, duration = 10, resolution = '1080p', ratio = 'adaptive', generateAudio = true, modelKey = null, draft = false, outputFormat = null, config } = {}, ctx) => {
  modelKey = videoModelKeyOf(modelKey); // env-driven default — first CONFIGURED video slot, never a literal
  // Text-to-video is allowed: with no image / refs / first_frame, the PROMPT alone drives
  // it (the Story agent's continuous-shot film). Only fail when there's nothing at all.
  if (!imageUrl && !assetId && !refUrls.length && !firstFrameUrl && !String(motion || '').trim()) throw new Error('animate requires a prompt, imageUrl, assetId, refUrls or firstFrameUrl');
  // Duration cap comes from the slot capability table — never an inline literal. AUTO
  // stays AUTO all the way to the wire: startVideo then omits the field and the model
  // runs the events as long as they take (what a Film-born card asks for).
  duration = clampShotSeconds(modelKey, duration);
  const prompt = buildAnimatePrompt({ motion, camera, lens, focalLength, aperture });
  const content = [{ type: 'text', text: prompt }];
  // A STANDALONE opening/closing frame — an image that is NOT one of the references.
  // Continuity uses this: the previous shot's final frame becomes this shot's literal
  // first frame. Sent ahead of the references, so callers offset their index math.
  if (firstFrameUrl) content.push({ type: 'image_url', image_url: { url: firstFrameUrl }, role: 'first_frame' });
  if (lastFrameUrl) content.push({ type: 'image_url', image_url: { url: lastFrameUrl }, role: 'last_frame' });
  // Reference images: at most the model's refCap — more is an error, never a cut. A ref
  // WITH an Asset Library id
  // (refAssetIds, aligned by index) rides as image_asset_id (the TRUSTED asset://
  // path) so a photoreal person plate isn't screened as a raw url ("input image may
  // contain real person"); refs without an id (the clay frame, anything un-preserved)
  // stay image_url.
  // refRoles (parallel to refUrls) re-roles a reference IN PLACE — 'first_frame' or
  // 'last_frame' instead of 'reference_image'. In place, because a role sent as an extra
  // leading item would be the same picture twice AND would shift what "Image N" counts
  // to in the prompt; changing the role of the item already there moves nothing.
  if (refUrls.length) {
    fitList(refUrls, videoTraits(modelKey).refCap, 'reference images').forEach((u, i) => {
      const aid = refAssetIds[i];
      const role = refRoles[i] || 'reference_image';
      if (aid) content.push({ type: 'image_asset_id', asset_id: aid, role });
      else content.push({ type: 'image_url', image_url: { url: u }, role });
    });
  } else if (assetId) content.push({ type: 'image_asset_id', asset_id: assetId, role: 'reference_image' });
  else if (imageUrl) content.push({ type: 'image_url', image_url: { url: imageUrl }, role: 'reference_image' });
  // else: text-to-video — the prompt is the only content (no reference media).
  // Reference AUDIO / VIDEO (plural; videos 2–30s each): the SHOT card's attached media —
  // music + voice clips the take realizes, camera/motion videos it follows, instead of
  // inventing its own. Audios BEFORE videos (the error that names a rejected clip relies on
  // this order). data: urls are staged to TOS by /api/seedance.
  (audioRefUrls || []).filter(Boolean).forEach((u) => content.push({ type: 'audio_url', audio_url: { url: u }, role: 'reference_audio' }));
  (videoRefUrls || []).filter(Boolean).forEach((u) => content.push({ type: 'video_url', video_url: { url: u }, role: 'reference_video' }));
  // Per-shot endpoint choice: the SHOT card may pick a variant (e.g. Seedance 2.0 Mini) by
  // modelKey; blank falls back to the env-preferred default slot, never a literal.
  const videoModel = getModel(videoModelKeyOf(modelKey), config);
  const { taskId } = await ctx.client.startVideo({ content, model: videoModel, resolution, ratio, duration, generateAudio, draft, outputFormat });
  return { taskId, prompt };
};

// DRAFT → FINAL (Seedance 2.5): render the final from a draft task, at one of the draft model's draftFinals. Everything
// that shaped the draft (prompt, refs, duration, ratio, audio) is reused by the
// model from the task itself; only the draft's own model slot is needed here.
export const finishDraft = async ({ draftTaskId, modelKey, resolution, outputFormat = null, config } = {}, ctx) => {
  if (!draftTaskId) throw new Error('finishDraft needs the draft task id');
  const finals = videoTraits(modelKey).draftFinals || [];
  if (!finals.length) throw new Error(`${modelKey} has no draft mode`);
  const res = resolution || finals[0];
  if (!finals.includes(res)) throw new Error(`${modelKey} finishes drafts at ${finals.join(' / ')} — not ${res}`);
  const model = getModel(videoModelKeyOf(modelKey), config);
  return ctx.client.startVideo({ model, draftTaskId, resolution: res, outputFormat });
};

// The AUDIO agent's one operation (Seed Audio 1.0). The user's text goes out VERBATIM
// (no rewriting, no translation) — it IS the prompt the model follows (ambience /
// drama / SFX / speech); references = up to 3 audio clips (@Audio1..N in the prompt)
// OR one reference image for scene mood. Returns the clip url; the caller lands it.
export const generateFilmAudio = async ({ text, imageData, audioRefs } = {}, ctx) => {
  if (!String(text || '').trim()) throw new Error('The Audio agent needs the prompt first.');
  if (typeof ctx?.client?.generateSpeech !== 'function') throw new Error('This transport has no audio support yet (canvas/browser client only for now).');
  const out = await ctx.client.generateSpeech({ text: String(text), imageData, audioRefs });
  if (!out?.url) throw new Error('The audio engine returned no clip.');
  return out; // { url, bytes, duration, format, model }
};


