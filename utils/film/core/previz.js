import { renderTemplate, getModel, getRuntime, keyframeImageSize, defaultImageModelKey, imageModelKeyOf, maxShotSeconds } from '../suiteConfig';
import { parseJson } from './director';

// PREVIZ — block the scene, then see it move:
//   1. plan      (reasoner) — the set, the actors, who moves where, the cameras, the timing
//   2. schematic (Seedream) — a top-down floor plan of all of it; edited by image edit
//   3. animatic  (Seedance) — the schematic in, a moving blockout out, cut by the cameras
// The SCHEMATIC is the source of truth once drawn: an edit changes the drawing, and the
// animatic follows the drawing. The plan text is the label set it was drawn from.

export const ANIMATIC_MODEL = 'seedance25';
export const ANIMATIC_RATIO = '16:9';

// How the ANIMATIC looks. One plan, three looks: pencil reads like a moving storyboard,
// colour blocks are the clearest blocking (flat mannequins, no light), clay is the only
// one that shows LIGHT.
export const PLATE_STYLES = ['pencil', 'blockout', 'clay'];

// Each actor's colour, dealt by CODE in actor order — the binding between a circle on the
// schematic and a figure in the animatic. Same order and names as the Mask tool.
export const BLOCKOUT_COLORS = ['BLUE', 'GREEN', 'YELLOW', 'RED', 'PURPLE', 'ORANGE'];
export const blockoutColorOf = (i) => BLOCKOUT_COLORS[i % BLOCKOUT_COLORS.length];

// What an edit of the schematic must restate, or the frame editor's photoreal default
// turns the diagram into a photograph.
export const SCHEMATIC_STYLE_LOCK = 'clean top-down orthographic technical floor-plan diagram on white, thin black linework, flat coloured circles and arrows, small block-capital labels, no perspective, no shading, no photographic texture';

const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// ONE reasoner call: the set, the actors, the shots (camera + who moves where + seconds).
// The total running time is clamped by code to the animatic model's ceiling.
export const previzPlan = async ({ brief = '', camera = '', config } = {}, ctx) => {
  const text = String(brief || '').trim();
  if (!text) throw new Error('Previz needs a scene description first.');
  const maxSeconds = maxShotSeconds(ANIMATIC_MODEL);
  const B = '@@BRIEF@@';
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('previz.plan.user', { brief: B, camera: String(camera || '').trim() || 'the planner chooses' }).split(B).join(text.slice(0, 6000)),
    systemPrompt: renderTemplate('previz.plan.system', { maxSeconds }),
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const raw = parseJson(content) || {};

  const actors = (Array.isArray(raw.actors) ? raw.actors : [])
    .map((a) => ({ name: clean(a?.name, 40), description: clean(a?.description, 200), start: clean(a?.start, 160) }))
    .filter((a) => a.name)
    .slice(0, BLOCKOUT_COLORS.length)
    .map((a, i) => ({ ...a, color: blockoutColorOf(i) }));
  const set = (Array.isArray(raw.set) ? raw.set : [])
    .map((s) => ({ name: clean(s?.name, 40), where: clean(s?.where, 160) }))
    .filter((s) => s.name)
    .slice(0, 12);
  let shots = (Array.isArray(raw.shots) ? raw.shots : [])
    .map((s) => ({
      camera: {
        from: clean(s?.camera?.from, 160),
        framing: clean(s?.camera?.framing, 80),
        move: clean(s?.camera?.move, 120),
      },
      action: clean(s?.action, 600),
      seconds: Math.max(2, Math.round(Number(s?.seconds) || 4)),
    }))
    .filter((s) => s.action)
    .slice(0, 8);
  // Fit the cut into one generation: scale every shot down proportionally.
  const total = shots.reduce((n, s) => n + s.seconds, 0);
  if (total > maxSeconds) shots = shots.map((s) => ({ ...s, seconds: Math.max(2, Math.floor((s.seconds * maxSeconds) / total)) }));

  const plan = { scene: clean(raw.scene, 1200), axis: clean(raw.axis, 300), look: clean(raw.look, 300), set, actors, shots };
  if (!plan.shots.length) throw new Error('The previz plan came back with no shots — try again.');
  return plan;
};

export const totalSecondsOf = (plan) => (plan?.shots || []).reduce((n, s) => n + (Number(s.seconds) || 0), 0);
const colorWord = (a) => String(a.color || '').toLowerCase();
const cameraLine = (s, i) => [`CAM ${i + 1}`, s.camera?.from, s.camera?.framing, s.camera?.move].filter(Boolean).join(', ');

// THE SCHEMATIC — every fact of the plan as a mark on a floor plan.
export const previzSchematic = async ({ plan, imageModel = defaultImageModelKey(), config } = {}, ctx) => {
  if (!plan?.shots?.length) throw new Error('Plan the scene first.');
  const model = imageModelKeyOf(imageModel);
  const prompt = renderTemplate('previz.schematic', {
    set: (plan.set || []).length ? `The set: ${plan.set.map((s) => `${s.name.toUpperCase()}${s.where ? ` (${s.where})` : ''}`).join('; ')}.` : (plan.scene ? `The set: ${plan.scene}` : ''),
    actors: (plan.actors || []).length ? `The actors: ${plan.actors.map((a) => `${a.name} — a solid ${colorWord(a)} circle${a.start ? `, starting ${a.start}` : ''}`).join('; ')}.` : '',
    moves: `The movements, numbered in order: ${plan.shots.map((s, i) => `${i + 1}. ${s.action}`).join(' ')}`,
    cameras: `The cameras: ${plan.shots.map((s, i) => cameraLine(s, i)).join('; ')}.`,
    axis: plan.axis ? `The line of action: ${plan.axis}.` : '',
  });
  const { url, cacheUrl } = await ctx.client.generateImage({
    prompt,
    size: keyframeImageSize(model),
    model: getModel(model, config),
    optimizePrompt: false,
  });
  if (!url) throw new Error('the image model returned no schematic');
  return { url, cacheUrl, prompt };
};

// THE ANIMATIC PROMPT — built by code from the plan: the schematic's role (Seedance 2.5
// reference grammar), the colour key, the style, and one line per shot.
export const previzAnimaticPrompt = ({ plan, style = 'blockout' } = {}) => {
  const st = PLATE_STYLES.includes(style) ? style : 'blockout';
  return renderTemplate('previz.animatic', {
    style: renderTemplate(`previz.animatic.style.${st}`),
    key: (plan?.actors || []).length ? `The colour key: ${plan.actors.map((a) => `the ${colorWord(a)} figure is ${a.name}`).join('; ')}.` : '',
    shots: (plan?.shots || []).map((s, i) => `Shot ${i + 1} (${cameraLine(s, i)}): ${s.action}`).join('\n'),
  });
};
