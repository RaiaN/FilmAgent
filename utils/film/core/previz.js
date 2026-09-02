import { renderTemplate, getModel, getRuntime, keyframeImageSize, clampSizeForModel, defaultImageModelKey, imageModelKeyOf } from '../suiteConfig';
import { parseJson } from './director';

// PREVIZ — a PAGE OF PLATES, then dispatch. Two steps, no video of its own:
//   1. plan   (reasoner) — the staging, the axis, the subjects, and the plate list
//   2. plates (Seedream) — each plate drawn on demand; any plate promotes to a SHOT card
//
// Why drawings and not a 3D-style blockout: the plate renderer is a text-to-image model.
// It has no scene to orbit and no memory between calls, so "the same staging from camera
// 2" is not a thing it can do — asking for it yields N pictures that merely resemble each
// other by accident. A pencil storyboard panel has no such requirement: panels are
// SUPPOSED to differ, and what carries between them is the drawing convention, which an
// image model holds easily. The camera work moves downstream to Seedance, which is a
// world model and can actually place a camera.

export const PREVIZ_RESOLUTIONS = ['480p', '720p']; // previz is a decision tool, never a deliverable
export const PREVIZ_RESOLUTION = '480p';

export const PLATE_KINDS = ['board', 'map', 'character'];

// How a board panel is DRAWN. Two conventions, one plan: a pencil page reads like a
// storyboard, a blockout page reads like a VFX layer. The blockout is the stronger
// Seedance reference — flat colour separates subjects with no identity and no look —
// so the choice is a real one, not a skin.
export const PLATE_STYLES = ['pencil', 'blockout'];

// The mask convention's order, so a blockout plate and a masked frame name their
// subjects the same way and the cast-colour binding line reads either one.
export const BLOCKOUT_COLORS = ['BLUE', 'GREEN', 'YELLOW', 'RED', 'PURPLE', 'ORANGE'];
export const blockoutColorOf = (i) => BLOCKOUT_COLORS[i % BLOCKOUT_COLORS.length];

// Is this plate out of date with the page's current style? Only BOARD panels have a
// style variant — a map is always line art and a character plate always pencil — so a
// style switch stales exactly the panels and leaves the rest alone. A plate drawn before
// styles existed carries no `style` and counts as pencil.
export const plateIsStale = (planPlate, plate, style = 'pencil') => {
  if (!plate?.url) return true;
  return planPlate?.kind === 'board' && (plate.style || 'pencil') !== style;
};

// A move drawn as an arrow is the storyboard's own notation for camera motion, and an
// arrow is a MARK — something an image model draws well, unlike the words for it.
const MOVE_RE = /\b(pan|tilt|track|tracking|dolly|push|pull|zoom|crane|boom|whip|handheld|steadicam|orbit|arc)\w*/i;

// ONE reasoner call: the staging, the action axis, the subjects and the whole plate page.
// Everything downstream reads this object; nothing is re-inferred per plate.
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
  const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

  const subjects = (Array.isArray(raw.subjects) ? raw.subjects : [])
    .map((s) => ({ name: clean(s?.name, 40), description: clean(s?.description, 300) }))
    .filter((s) => s.name || s.description)
    .slice(0, 8);

  // THE PAGE. Order is the planner's — map, then characters, then the board panels in
  // cut order — so the grid reads top-left to bottom-right the way a storyboard page does.
  const plates = (Array.isArray(raw.plates) ? raw.plates : [])
    .map((p) => {
      const kind = PLATE_KINDS.includes(String(p?.kind || '').toLowerCase()) ? String(p.kind).toLowerCase() : 'board';
      return {
        kind,
        title: clean(p?.title, 60),
        draw: clean(p?.draw, 1400),
        // Only a board panel carries a shot — it is the only kind that describes one.
        caption: kind === 'board' ? clean(p?.caption, 300) : '',
        camera: kind === 'board' ? clean(p?.camera, 300) : '',
        motion: kind === 'board' ? clean(p?.motion, 800) : '',
        durationSec: kind === 'board' ? Math.max(3, Math.min(15, Math.round(Number(p?.durationSec) || 5))) : null,
      };
    })
    .filter((p) => p.draw)
    .slice(0, 16);

  const plan = {
    scene: clean(raw.scene, 1600),
    axis: clean(raw.axis, 400),
    subjects,
    look: clean(raw.look, 400),
    plates,
  };
  if (!plan.plates.length) throw new Error('The previz plan came back with no plates — try again.');
  return plan;
};

// ONE PLATE. `references` are the plates already on the page, each with the NAME it
// stands for: a character plate pins WHO, an earlier board panel pins the hand. Naming
// them matters — an unlabelled reference is a mood board, a labelled one is a casting
// instruction, and only the second stops the wolf turning into a boar.
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

export const previzPlate = async ({ plan, index = 0, references = [], style = 'pencil', imageModel = defaultImageModelKey(), config } = {}, ctx) => {
  const plate = (plan?.plates || [])[index];
  if (!plate?.draw) throw new Error('That plate is not in the plan.');
  const model = imageModelKeyOf(imageModel);
  const refs = references.filter((r) => r?.url).slice(0, 4);

  let prompt;
  if (plate.kind === 'map') {
    // The map is the one plate that WANTS the whole space: it exists to show geography.
    prompt = renderTemplate('previz.plate.map', {
      draw: [plate.draw, String(plan?.scene || '').trim(), String(plan?.axis || '').trim()].filter(Boolean).join(' '),
    });
  } else if (plate.kind === 'character') {
    prompt = renderTemplate('previz.plate.character', { draw: plate.draw });
  } else if (style === 'blockout') {
    // A blockout names its subjects by COLOUR, not by identity — that is the whole point
    // of the medium, and it is what makes the plate reusable as a Seedance anchor.
    const subs = (plan?.subjects || []).filter((sub) => sub.name || sub.description);
    prompt = renderTemplate('previz.plate.blockout', {
      draw: plate.draw,
      marks: MOVE_RE.test(plate.camera)
        ? ` Mark the camera move with one bold arrow over the frame showing its direction (${plate.camera.toLowerCase()}) — a plain line and arrowhead, no lettering.`
        : '',
      cast: subs.length
        ? ` The masses are coloured: ${subs.map((sub, i) => `${blockoutColorOf(i)} is ${sub.name || sub.description}`).join('; ')}. Exactly ${NUM[subs.length] || subs.length} coloured ${subs.length === 1 ? 'mass appears' : 'masses appear'} and nothing else is alive in the frame — no other figure, no onlooker, nothing moving in the background.`
        : '',
    });
  } else {
    // A board panel gets its OWN words and nothing else. Appending the scene description
    // pushes every panel toward the establishing wide — the whole clearing has to fit —
    // which is exactly how a tight single ends up a wide two-shot.
    const names = (plan?.subjects || []).map((sub) => sub.name || sub.description).filter(Boolean);
    prompt = renderTemplate('previz.plate.board', {
      draw: plate.draw,
      marks: MOVE_RE.test(plate.camera)
        ? ` Over the drawing, mark the camera move with one bold hand-drawn arrow showing its direction (${plate.camera.toLowerCase()}) — a plain drawn line and arrowhead, no lettering.`
        : '',
      // CAST CLOSURE. An image model asked for two animals in a forest draws a pack,
      // because that is what forests contain in its training data. The count has to be
      // stated and the absence has to be stated with it.
      cast: names.length
        ? ` Exactly ${NUM[names.length] || names.length} living ${names.length === 1 ? 'subject appears' : 'subjects appear'} in this panel — ${names.join(' and ')} — and nothing else that is alive: no other animal, no third figure, no person, no onlooker, nothing moving in the background.`
        : '',
      refs: refs.length
        ? ` Use the attached drawings for identity: ${refs.map((r, i) => `Image ${i + 1} is ${r.label}`).join('; ')}. Draw those exact subjects — same build, same coat, same markings.`
        : '',
    });
  }

  const size = plate.kind === 'character'
    ? clampSizeForModel(model, '1440x1920') // a figure alone reads in portrait
    : keyframeImageSize(model);

  const { url, cacheUrl } = await ctx.client.generateImage({
    prompt,
    referenceImages: refs.length ? refs.map((r) => r.url) : undefined,
    size,
    model: getModel(model, config),
    optimizePrompt: false,
  });
  return { url, cacheUrl, prompt };
};
