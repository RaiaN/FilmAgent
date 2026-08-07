// Storyboard core. The AD-PLANNER DIVISION (storyboardTurn) is the one storyboard
// brain: brief/script → shot list (body · motion · exiting · audio per shot), turn by
// turn with the director; storyboardKeyframe/storyboardEndframe render each shot's
// START still and (for developing shots) its chained END frame. Also home to the Story
// agent (writeFilmPrompt → idea/script → one long cinematic prompt) and the
// pre-production draft (detectGenre / castFromIdea).
//
// Pure core — canvas/SDK inject ctx { client, config }.

import { renderTemplate, getModel, getRuntime, imageRefCap, keyframeImageSize, clampSizeForModel } from '../suiteConfig';
import { resolveImageSize } from '../imageSizes';
import { composeSeedancePrompt, composeKeyframePrompt, composeStoryboardSheetPrompt, shotTemplateCatalog, shotTemplateCinematography, SHOT_TEMPLATE_BY_ID, storyArcCatalog, STORY_ARC_BY_ID } from '../recipes';
import { parseJson } from './director';
import { withRetry, isTransient } from './retry';
import { isImagePolicyError } from './operations';
import { runWithConcurrency } from './parallel';

// Shots are 5–15s (each breaks into cuts of ≤5–6s) → a 60–180s film is ~6–18 shots.
// (The pre-division Idea→shot-list reader was PURGED 2026-08-07: zero call sites —
// the AD-planner division is the one storyboard brain. Git history holds it.)
// A shot's durationSec always lands in Seedance's 5–15s window, defaulting to 10.
const clampDuration = (v) => Math.max(5, Math.min(15, Math.round(Number(v) || 10)));
// The camera setup a divided shot falls back to when the planner names an unknown id.
const DEFAULT_SHOT_TEMPLATE = 'medium-shot';

// ---- Develop (the Brief node's OPT-IN rewrite): idea or script → ONE cinematic prompt --
// A direct rewrite (no JSON, no key events, no appearances): the brief becomes a single
// continuous cinematic narrative with clear subjects + a clear story arc, split by explicit
// CUT markers (see story.prompt.system — Deconstruct reads them), no characters facing
// camera, and explicit eyelines (what each character is looking at). Only New Shot consumes
// this — Cast & World and Storyboard read the brief VERBATIM, never the rewrite.
// `complexity` (light | medium | deep) tunes HOW MUCH the rewrite expands the source.
const REWRITE_DEPTH = {
  light: 'DEPTH: keep it CONCISE and close to the source — a short, tight prompt; minimal embellishment, do not invent beyond the idea.',
  medium: 'DEPTH: develop a clear arc and vivid subjects with moderate cinematic detail.',
  deep: 'DEPTH: elaborate RICHLY — a long, immersive prompt with layered staging, atmosphere, lighting and texture, and a fully developed arc; expand the idea into a vivid scene.',
};
// 'preserve' must be REAL, not a label: a pasted script is the director's OWN text.
const PRESERVE_SCRIPT = 'PRESERVE: this is the director\'s own script — keep every stated event, in the stated order, and keep EVERY line of dialogue VERBATIM: word-for-word, in quotes, in its original language (never translate, paraphrase or drop a line). Do not invent, drop or reorder events. Only add cinematic staging, eyelines and atmosphere.';
export const writeFilmPrompt = async ({ idea, source = '', complexity = 'medium', config } = {}, ctx) => {
  const t = String(idea || '').trim();
  const src = String(source || '').trim();
  if (!t && !src) throw new Error('The story needs an idea or a script first.');
  const depth = REWRITE_DEPTH[complexity] || REWRITE_DEPTH.medium;
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('story.prompt.user', { story: (src || t).slice(0, 6000), depth, preserve: src ? PRESERVE_SCRIPT : '' }),
    systemPrompt: renderTemplate('story.prompt.system'),
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const prompt = String(content || '').replace(/```/g, '').trim();
  if (!prompt) throw new Error('The rewrite came back empty — try rephrasing the idea.');
  return { mode: src ? 'preserve' : 'expand', prompt };
};

// ---- Split: a brief (or an oversized shot prompt) → sequential ≤15s SHOT segments ------
// SEGMENTATION, not rewriting (one reason() call, no code parsing): wording, details and
// timestamps are PRESERVED per segment; durations come from timestamp deltas when present,
// else the model's estimate (clamped 5–15s here). Used by the Brief node's "Split into
// Shots", the SHOT card's ✂ and the director-chat `split` action.
const MAX_SPLIT_SEGMENTS = 24;
export const splitIntoShots = async ({ text, count, config } = {}, ctx) => {
  const brief = String(text || '').trim();
  if (!brief) throw new Error('The split needs a brief or a shot prompt first.');
  // `count` is a GOAL, not a hard number: the 5–15s-per-segment physics always wins
  // (a 60s brief cannot fit 3 segments), so the model aims for it and the duration
  // rule breaks ties. Absent → fewest possible.
  const goal = Number.isFinite(Number(count)) && Number(count) >= 2 ? Math.min(MAX_SPLIT_SEGMENTS, Math.round(Number(count))) : null;
  // The brief is injected AFTER the template render via a sentinel: renderTemplate's
  // whitespace collapse would mangle screenplay indentation / aligned timestamp columns,
  // and the split's whole contract is that the user's text survives byte-for-byte.
  const SLOT = '@@BRIEF@@';
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('split.user', { brief: SLOT }).split(SLOT).join(brief.slice(0, 12000)),
    systemPrompt: renderTemplate('split.system', {
      maxShots: String(MAX_SPLIT_SEGMENTS),
      countGoal: goal ? `The director asked for ${goal} segments — aim for exactly ${goal} when the 5-15 second rule allows it; the duration rule always wins, so otherwise get as close to ${goal} as possible.` : '',
    }),
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const raw = parseJson(content) || {};
  const arr = Array.isArray(raw.segments) ? raw.segments : (Array.isArray(raw) ? raw : []);
  const segments = arr.map((s, i) => ({
    beat: String(s?.beat || s?.title || `Shot ${i + 1}`).replace(/\s+/g, ' ').trim().slice(0, 48),
    text: String(s?.text || s?.content || '').trim(),
    durationSec: clampDuration(s?.durationSec),
  })).filter((s) => s.text).slice(0, MAX_SPLIT_SEGMENTS);
  if (!segments.length) throw new Error('The split came back empty — try rephrasing the brief.');
  return { segments };
};

// ---- Previz v2: floor plan (AD blocking map) + per-shot projection ----------------------
// floorPlan: ONE reason call runs the AD planner CoT (space → parties → moves → axis)
// and emits the frozen Seedream diagram prompt; ONE image call renders it literal
// (thinking off — the optimize rewrite re-pictorializes style contracts). The brief
// rides via sentinel so renderTemplate never touches the user's words.
export const floorPlan = async ({ brief, config } = {}, ctx) => {
  const text = String(brief || '').trim();
  if (!text) throw new Error('Floor plan needs the brief text first.');
  const SLOT = '@@BRIEF@@';
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('previz.plan.user', { brief: SLOT }).split(SLOT).join(text.slice(0, 8000)),
    systemPrompt: renderTemplate('previz.plan.system', {}),
    modelId: getModel('reasoner', config), reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const planPrompt = String(content || '').trim();
  if (!/^A schematic 2D FLOOR PLAN/.test(planPrompt)) throw new Error('The planner returned no usable floor-plan prompt — try again.');
  const { url, cacheUrl } = await ctx.client.generateImage({
    prompt: planPrompt,
    referenceImages: [],
    size: '2048x2048',
    model: getModel('seedreamPro', config),
    optimizePrompt: false,
  });
  if (!url) throw new Error('No floor-plan image URL in response');
  return { url, cacheUrl, planPrompt };
};

// projectShot: the VLM READS the rendered map (so hand-edits flow through), picks a
// camera on one side of the AXIS, and converts top-down positions into the shot's
// camera-relative Seedance prompt. `moment` = the card's own action text, verbatim.
export const projectShot = async ({ mapUrl, moment, camera = '', refsList = '', config } = {}, ctx) => {
  const act = String(moment || '').trim();
  if (!act) throw new Error('Write the shot prompt first — the projection needs the moment.');
  if (!mapUrl) throw new Error('The floor-plan image is missing.');
  const SLOT = '@@MOMENT@@';
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('previz.project.user', {
      moment: SLOT,
      camera: String(camera || '').trim() || "director's choice",
      // No plates attached → say so EXPLICITLY, or the model invents identity clauses
      // for [Image 2]+ that don't exist on the card (observed live on the first run).
      refsList: String(refsList || '').trim() || ' — and NOTHING else: the map is the ONLY image; never reference [Image 2] or beyond',
    }).split(SLOT).join(act.slice(0, 4000)),
    systemPrompt: renderTemplate('previz.project.system', {}),
    images: [mapUrl],
    modelId: getModel('reasoner', config), reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const prompt = String(content || '').trim();
  if (!prompt) throw new Error('The projection came back empty — try again.');
  return { prompt };
};

// ---- Mask: identity scrub for ANY board image ------------------------------------------
// An image EDIT that reproduces the frame but replaces every person
// with a flat solid-color silhouette (left→right: blue, green, yellow, red, purple). The
// invented identities die here; the plate carries pure geometry into the shoot.
export const maskFrame = async ({ url, instruction = '', config } = {}, ctx) => {
  const src = String(url || '').trim();
  if (!src) throw new Error('Mask needs a rendered image first.');
  // WHAT to mask: the user's words VERBATIM (sentinel slot — renderTemplate never
  // touches them), or the classic every-person scrub when left empty.
  const SLOT = '@@MASK@@';
  const targets = String(instruction || '').trim().slice(0, 1000) || 'EVERY person in the frame';
  const { url: out, cacheUrl } = await ctx.client.generateImage({
    prompt: renderTemplate('previz.mask', { targets: SLOT }).split(SLOT).join(targets),
    referenceImages: [src],
    size: keyframeImageSize('seedreamPro'),
    model: getModel('seedreamPro', config),
  });
  if (!out) throw new Error('No masked plate URL in response');
  return { url: out, cacheUrl };
};

// (The free-form editFrame op is PURGED: the universal Edit-shot editor covers it — the
// frame rides as [Image 1] under a strict-follow lock when "use this frame" is ticked.)

// ---- Storyboard: a conversational SHOT DIVISION — script → a shot list, turn by turn ----
// The Storyboard agent is a cinematographer you brainstorm WITH. Each turn takes the script,
// the CURRENT shot list (read off the cards) and the director's message, and returns the FULL
// updated shot list + a one-line reply. The canvas reconciles the list into a column of SHOT
// cards (each a real CutNode = a Seedance prompt). No frames are rendered here — the shot list
// IS the storyboard; the picture is shooting a card. Camera = a shotTemplate id from the library.
// ---- 2-STEP first division: CARVE (structure + verbatim spans) → AUTHOR (per shot) ----
// Carve gives the whole call's attention to structure; each span partitions the script
// word-for-word, which makes fidelity STRUCTURAL: the author pass gets its span as the
// source, and the dialogue gate can verify every span line survived — per shot.
const SPAN_SLOT = '@@BRIEF@@';
export const storyboardCarve = async ({ script = '', style = '', references = [], shotLength = 'auto', config } = {}, ctx) => {
  const text = String(script || '').trim();
  if (!text) throw new Error('Carving needs the brief/script text first.');
  const pace = String(shotLength || 'auto');
  const countGoal = pace === 'auto'
    ? 'Carve into as many shots as the script NEEDS — every shot must earn its place; pacing picks each durationSec (5–15s). Never pad; never cram. Hard cap 24 shots — a longer script carves its first stretch and the reply says what remains uncarved.'
    : `Carve aiming each shot at roughly ${pace} seconds (durationSec ≈ ${pace}, clamped 5–15) — the script's length decides HOW MANY shots that makes. Never pad; never cram. Hard cap 24 shots — a longer script carves its first stretch and the reply says what remains uncarved.`;
  const refs = (references || []).filter(Boolean).slice(0, 10);
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('storyboard.carve.user', { script: SPAN_SLOT, style: style || 'auto' }).split(SPAN_SLOT).join(text.slice(0, 12000)),
    systemPrompt: renderTemplate('storyboard.carve.system', { templates: shotTemplateCatalog(), countGoal, refCount: String(refs.length) }),
    images: refs,
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const raw = parseJson(content) || {};
  const arr = Array.isArray(raw.shots) ? raw.shots : [];
  const shots = arr.map((s, i) => {
    const tpl = SHOT_TEMPLATE_BY_ID[s?.shotTemplate] || SHOT_TEMPLATE_BY_ID[DEFAULT_SHOT_TEMPLATE];
    let figures = Array.isArray(s?.figures) ? [...new Set(s.figures.map((x) => Number(x)).filter((x) => x >= 1 && x <= refs.length))] : [];
    if (!figures.length && refs.length) figures = [1];
    return {
      beat: String(s?.beat || `Shot ${i + 1}`).replace(/\s+/g, ' ').trim().slice(0, 48),
      shotTemplate: tpl.id,
      figures,
      durationSec: clampDuration(s?.durationSec),
      intExt: /^int/i.test(String(s?.intExt || '')) ? 'INT' : /^ext/i.test(String(s?.intExt || '')) ? 'EXT' : '',
      develops: !!s?.develops,
      // The span keeps its line breaks — it IS the script slice, not prose.
      span: String(s?.span || '').trim().slice(0, 4000),
    };
  }).filter((s) => s.span);
  if (!shots.length) throw new Error('The carve came back empty — try rephrasing.');
  return { shots, reply: String(raw.reply || '').replace(/\s+/g, ' ').trim().slice(0, 400) || 'Carved the script.' };
};

// The span's dialogue, extracted deterministically: quoted runs plus screenplay-style
// lines under an ALL-CAPS speaker heading. Used by the author gate below.
export const spanDialogueLines = (span = '') => {
  const out = [];
  String(span).replace(/[""]([^""]{4,200})[""]|"([^"]{4,200})"/g, (_, a, b) => { out.push((a || b).trim()); return ''; });
  const lines = String(span).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const name = lines[i].trim();
    if (/^[A-Z][A-Z .'()-]{2,30}$/.test(name) && !/^(INT|EXT|FADE|CUT|MOVE|DAWN|LATER|SAME)/.test(name)) {
      let j = i + 1;
      let buf = [];
      while (j < lines.length && lines[j].trim() && !/^[A-Z][A-Z .'()-]{2,30}$/.test(lines[j].trim())) {
        const t = lines[j].trim();
        if (!/^\(.*\)$/.test(t)) buf.push(t);
        j += 1;
      }
      if (buf.length) out.push(buf.join(' ').trim());
      i = j - 1;
    }
  }
  return [...new Set(out.filter((l) => l.length >= 4))];
};
const normText = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// AUTHOR one shot from its verbatim span. Retries ONCE naming any span dialogue the
// motion dropped; still missing → returned in `missingDialogue` (the card flags it,
// never silently).
export const storyboardAuthor = async ({ script = '', span = '', beat = '', shotTemplate = '', develops = false, prevBeat = '', nextBeat = '', references = [], config } = {}, ctx) => {
  const refs = (references || []).filter(Boolean).slice(0, 10);
  const tpl = SHOT_TEMPLATE_BY_ID[shotTemplate] || SHOT_TEMPLATE_BY_ID[DEFAULT_SHOT_TEMPLATE];
  const wanted = spanDialogueLines(span);
  const run = async (retryNote) => {
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('storyboard.author.user', {
        script: SPAN_SLOT, span: '@@SPAN@@', beat, framing: `${tpl.framing}, ${tpl.angle}, ${tpl.move}`,
        develops: develops ? 'DEVELOPS — write the exiting state' : 'HOLDS — exiting stays empty',
        prevBeat: prevBeat || '(scene start)', nextBeat: nextBeat || '(scene end)',
        retry: retryNote || '',
      }).split(SPAN_SLOT).join(String(script).slice(0, 9000)).split('@@SPAN@@').join(String(span).slice(0, 4000)),
      systemPrompt: renderTemplate('storyboard.author.system', { refCount: String(refs.length) }),
      images: refs,
      modelId: getModel('reasoner', config),
      reasoningEffort: getRuntime(config).reasoningEffort,
    });
    const raw = parseJson(content) || {};
    return {
      body: String(raw.body || '').replace(/\s+/g, ' ').trim().slice(0, 900),
      motion: String(raw.motion || '').replace(/\s+/g, ' ').trim().slice(0, 1800),
      exiting: develops ? String(raw.exiting || '').replace(/\s+/g, ' ').trim().slice(0, 400) : '',
      audio: String(raw.audio || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      expression: String(raw.expression || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    };
  };
  let out = await run('');
  let missing = wanted.filter((l) => !normText(out.motion).includes(normText(l)));
  if (missing.length && out.motion) {
    out = await run(`\nRETRY — your previous draft DROPPED these dialogue lines; every one must appear word-for-word in motion's curly braces: ${missing.map((l) => `"${l}"`).join(' · ')}\n`);
    missing = wanted.filter((l) => !normText(out.motion).includes(normText(l)));
  }
  if (!out.body || !out.motion) throw new Error(`Authoring "${beat}" came back empty.`);
  return { ...out, missingDialogue: missing };
};

export const storyboardTurn = async ({ script = '', shots = [], message = '', style = '', references = [], shotLength = 'auto', config } = {}, ctx) => {
  // SHOT COUNT IS AN OUTPUT, not an input (2026-08-07): the material's length ÷ the
  // chosen per-shot pace decides how many shots — one knob scales from a one-scene
  // brief to a feature script. 'auto' lets pacing pick every duration; a number aims
  // each shot at ~that many seconds. Hard cap 24 per division — over-long scripts
  // divide their first stretch and SAY SO (no silent truncation).
  const pace = String(shotLength || 'auto');
  const countGoal = pace === 'auto'
    ? 'On the FIRST turn (empty list): divide the script into as many shots as it NEEDS — every shot must earn its place (one job each), pacing picks each durationSec (5–15s). Never pad a thin script with filler shots; never cram a dense one. Hard cap 24 shots — a longer script divides its first stretch and the reply says what remains undivided.'
    : `On the FIRST turn (empty list): divide the script aiming each shot at roughly ${pace} seconds (durationSec ≈ ${pace}, clamped 5–15) — the script's length decides HOW MANY shots that makes. Never pad; never cram. Hard cap 24 shots — a longer script divides its first stretch and the reply says what remains undivided.`;
  const refs = (references || []).filter(Boolean).slice(0, 10);        // the reference pool → [Image 1..N] (Pro caps at 10)
  const current = (shots || []).map((s, i) => ({
    n: i + 1, beat: s.beat || '', shotTemplate: s.shotTemplate || '', figures: s.figures || [], body: s.body || '', expression: s.expression || '', durationSec: s.durationSec || 10, intExt: s.intExt || '',
  }));
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('storyboard.turn.user', {
      script: String(script || '').trim() || '(none given)',
      style: String(style || '').trim() || 'auto',
      refCount: String(refs.length),
      shots: JSON.stringify(current),
      message: String(message || '').trim() || '(start: break this into a shot list)',
    }),
    systemPrompt: renderTemplate('storyboard.turn.system', { templates: shotTemplateCatalog(), countGoal, refCount: String(refs.length) }),
    images: refs, // the reference plates — the reasoner SEES them as [Image 1..N] and assigns per shot
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const raw = parseJson(content) || {};
  const arr = Array.isArray(raw.shots) ? raw.shots : (Array.isArray(raw) ? raw : []);
  const out = arr.map((s, i) => {
    const tpl = SHOT_TEMPLATE_BY_ID[s?.shotTemplate] || SHOT_TEMPLATE_BY_ID[DEFAULT_SHOT_TEMPLATE];
    // Validate the assigned figures against the pool (1..N, deduped); guarantee ≥1 when refs exist.
    let figures = Array.isArray(s?.figures) ? [...new Set(s.figures.map((x) => Number(x)).filter((x) => x >= 1 && x <= refs.length))] : [];
    if (!figures.length && refs.length) figures = [1];
    return {
      beat: String(s?.beat || s?.title || `Shot ${i + 1}`).replace(/\s+/g, ' ').trim().slice(0, 48),
      shotTemplate: tpl.id,
      figures,
      body: String(s?.body || s?.prompt || s?.action || '').replace(/\s+/g, ' ').trim().slice(0, 900),
      // The planner's video/pair fields (2026-08-07): motion = what happens (the card's
      // shoot prompt), exiting = the END-state edit (present only for developing shots —
      // drives the chained END still + endAnchor), audio = the symbol-grammar sound line.
      motion: String(s?.motion || '').replace(/\s+/g, ' ').trim().slice(0, 1800),
      exiting: String(s?.exiting || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      audio: String(s?.audio || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      expression: String(s?.expression || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      durationSec: clampDuration(s?.durationSec),
      intExt: /^int/i.test(String(s?.intExt || '')) ? 'INT' : /^ext/i.test(String(s?.intExt || '')) ? 'EXT' : '',
    };
  }).filter((s) => s.body);
  if (!out.length) throw new Error('The shot read came back empty — try rephrasing.');
  const reply = String(raw.reply || '').replace(/\s+/g, ' ').trim().slice(0, 400) || 'Updated the shot list.';
  return { shots: out, reply };
};

// ONE storyboard KEYFRAME: a Seedream 5.0 still per shot. The `body` (written by the reference-aware
// division) addresses each reference as [Image N] with what to keep from it; `refs` are the shot's
// reference plates IN [Image 1..N] ORDER (the caller resolves + renumbers them). NOT a blend — each
// image is a distinct addressed subject. composeKeyframePrompt wraps the body with the camera + finish
// lines. Style/expression/ethnicity are optional overrides. One call per shot; the canvas streams them.
// The END frame of a DEVELOPING shot: a chained edit of its freshly-rendered START
// still — [Image 1] IS the start, the exiting sentence is the only named change, and
// the casting refs ride behind for identity. The exiting text is injected via a
// sentinel (verbatim — braces in author text can't break the template). Fast path
// (thinking off), like every structure-locked edit.
export const storyboardEndframe = async ({ exiting = '', startUrl = '', refs = [], imageModel = 'seedreamPro', config } = {}, ctx) => {
  const line = String(exiting || '').trim().slice(0, 800);
  if (!line || !startUrl) throw new Error('endframe needs an exiting sentence and the START still');
  const SLOT = '@@EXIT@@';
  const prompt = renderTemplate('storyboard.endframe', { exiting: SLOT }).split(SLOT).join(line);
  const images = [startUrl, ...(refs || [])].filter(Boolean).slice(0, imageRefCap(imageModel));
  const { url, cacheUrl } = await ctx.client.generateImage({
    prompt, referenceImages: images, size: keyframeImageSize(imageModel), model: getModel(imageModel, config), optimizePrompt: false,
  });
  if (!url) throw new Error('No END-frame URL in response');
  return { url, cacheUrl };
};

export const storyboardKeyframe = async ({ body = '', shotTemplate = '', style = '', expression = '', ethnicity = '', refs = [], imageModel = 'seedreamPro', frameEdit = false, frameEditAnnotated = false, config } = {}, ctx) => {
  const images = (refs || []).filter(Boolean).slice(0, imageRefCap(imageModel)); // attach in order → [Image 1..N] (Pro: 10, Lite: 6)
  // frameEdit = the Edit-shot editor's structure lock: [Image 1] IS the current frame and
  // the body is the CHANGE (instruction or full prompt, verbatim via sentinel). The lean
  // EDIT template replaces the cinematic wrapper — line-1 camera talk would fight the frame.
  const SLOT = '@@EDIT@@';
  const prompt = frameEdit
    ? renderTemplate(frameEditAnnotated ? 'storyboard.frameEditDraw' : 'storyboard.frameEdit', { instruction: SLOT }).split(SLOT).join(String(body || '').trim().slice(0, 2000))
    : composeKeyframePrompt({ body, shotTemplate, style, expression, ethnicity });
  const { url, cacheUrl } = await ctx.client.generateImage({
    prompt,
    referenceImages: images,
    size: keyframeImageSize(imageModel),
    model: getModel(imageModel, config),
    // Edit-locked renders take the FAST path — thinking explicitly disabled (the frame
    // carries the structure; chain-of-thought only adds latency). Composed renders keep
    // the model default (no flag sent).
    ...(frameEdit ? { optimizePrompt: false } : {}),
  });
  if (!url) throw new Error('No keyframe URL in response');
  return { url, cacheUrl };
};

// SINGLE-IMAGE mode: render the WHOLE storyboard as ONE sheet (a grid of numbered panels). Composed
// from the division `shots` + the full reference pool (attached in [Image 1..N] order, so the panel
// bodies' [Image N] map correctly and the cast stays consistent). One Seedream call → one image.
export const storyboardSheet = async ({ shots = [], style = '', title = '', references = [], imageModel = 'seedreamPro', config } = {}, ctx) => {
  const images = (references || []).filter(Boolean).slice(0, imageRefCap(imageModel));
  const { url, cacheUrl } = await ctx.client.generateImage({
    prompt: composeStoryboardSheetPrompt({ shots, style, title }),
    referenceImages: images,
    size: keyframeImageSize(imageModel),
    model: getModel(imageModel, config),
  });
  if (!url) throw new Error('No storyboard sheet URL in response');
  return { url, cacheUrl };
};

// Re-derive ONE shot's [Image N] body for a chosen figure set — the Expand editor's "Re-derive from
// references" (run after the director toggles/adds references on a keyframe). Sees the WHOLE pool as
// [Image 1..N] (same numbering as the division) and rewrites just this shot's body to address
// `figures` with roles + keep-identity. Returns { body, expression } in GLOBAL [Image N] numbering.
export const storyboardShotBody = async ({ script = '', beat = '', figures = [], style = '', references = [], config } = {}, ctx) => {
  const refs = (references || []).filter(Boolean).slice(0, 8);
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('storyboard.shot.user', {
      script: String(script || '').trim() || '(none given)',
      beat: beat || 'this shot',
      style: String(style || '').trim() || 'auto',
      figures: JSON.stringify((figures || []).filter((x) => x >= 1 && x <= refs.length)),
    }),
    systemPrompt: renderTemplate('storyboard.shot.system', { refCount: String(refs.length) }),
    images: refs,
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const raw = parseJson(content) || {};
  const body = String(raw.body || raw.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  if (!body) throw new Error('The shot rewrite came back empty.');
  return { body, expression: String(raw.expression || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
};

// ---- Deconstruct: a rendered Take → its CUTs (the bridge to Directing) -------------
// SHOT-card Re-derive: BIND an existing prompt to the card's reference images — the
// wording/structure/action survive EXACTLY (Develop's output must not be flattened
// into a still description); the only change is [Image N] tags matching the badge
// order. Sentinel slot keeps the prompt verbatim through the template.
export const bindShotPromptToRefs = async ({ prompt, references = [], config } = {}, ctx) => {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Re-derive needs the shot prompt.');
  if (!references.length) throw new Error('Re-derive needs the reference images.');
  const SLOT = '@@PROMPT@@';
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('cut.rederive.user', { refCount: references.length, prompt: SLOT }).split(SLOT).join(text.slice(0, 6000)),
    systemPrompt: renderTemplate('cut.rederive.system', { refCount: references.length }),
    images: references,
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const body = String(content || '').trim();
  if (!body) throw new Error('The re-derive came back empty.');
  return { body };
};

// Take Viewer 📝: ONE extracted still → prompt-ready text (subjects, blocking, setting,
// camera, light) via the Seed 2.0 Pro VLM. One explicit tap = one call; the canvas
// lands the text as an editable NOTE node beside the take. Returns { text }.
export const describeFrame = async ({ imageUrl, config } = {}, ctx) => {
  if (!imageUrl) throw new Error('Describe needs the extracted frame.');
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('deconstruct.describeFrame', {}),
    images: [imageUrl],
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const text = String(content || '').trim();
  if (!text) throw new Error('The frame description came back empty.');
  return { text };
};

// A panel → one direct-to-video blueprint shot (production.js shot.direct): the
// SAME Seedance 2.0 prompt the canvas SHOT cards send, composed straight from the
// panel (no human-edited card in between). This mirrors the UI's panel→card seed
// (storyboardPanelRef) + shotFromCard compose, so the headless smoke test and the
// canvas exercise ONE shot-composition format. Headless has no sketches/audio, so
// the references are just the panel's REAL cast/location anchors.
export const panelToShot = (panel, anchors = [], genre = '') => {
  const sec = clampDuration(panel.durationSec);
  // ONE cut = framing + action (≤6s); the canvas lets the user split it further.
  const cuts = [{ action: panel.framing ? `${panel.framing}. ${panel.action}` : panel.action, seconds: Math.min(6, sec) }];
  // refEntryIds → ordered [{ url, desc }]; the desc shape matches recipes.shotReferences
  // so [Image1..N] reads identically to a canvas card. refUrls ride in the SAME order.
  const references = (panel.refEntryIds || [])
    .map((id) => (anchors || []).find((e) => e.id === id))
    .filter((e) => e && e.url)
    .map((e) => ({ url: e.url, desc: [e.name, e.role].filter(Boolean).join(' — ') }))
    .slice(0, 9);
  // The chosen shot template's cinematography line (genre-keyed fallback), exactly
  // as the card seeds it — the template's move is already in the line, so no append.
  const cinematography = shotTemplateCinematography(panel.shotTemplate, genre);
  return {
    beat: panel.title,
    direct: true,
    motion: composeSeedancePrompt({ references, cuts, cinematography, audio: '', shotTemplate: panel.shotTemplate }),
    camera: 'auto',
    durationSec: sec,
    refEntryIds: panel.refEntryIds || [],
    refUrls: references.map((r) => r.url),
  };
};

// ---- the pre-production draft: cast + places, from the idea ----------------------
// ONE read derives everything the film needs to anchor every shot — 1–2 characters
// and 1–2 locations — under a single shared visual style, so the whole draft is
// consistent BY CONSTRUCTION (the style sentence is appended to every plate prompt
// deterministically — no separate "look" frame needed). Each is generated ONCE; those
// plates become the canonical anchors every shot then references. In the UI the results
// land as CANDIDATES with suggested-role chips — the user's tag locks them; headless
// runs (no human) adopt them directly.
const CAST_ROLE = { character: 'character', creature: 'character', location: 'location', prop: 'prop' };

// Read the film's GENRE & TONE from the premise — the upstream creative knob that
// drives look, casting and shot grammar. One cheap call; surfaced to the user to
// confirm/override before any (paid) generation, then fed into the cast + storyboard.
export const detectGenre = async ({ idea, config } = {}, ctx) => {
  const t = String(idea || '').trim();
  if (!t) throw new Error('Need the premise to read the genre.');
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('genre.detect.user', { idea: t }),
    systemPrompt: renderTemplate('genre.detect.system'),
    modelId: getModel('reasoner', config),
    reasoningEffort: 'low',
  });
  const raw = parseJson(content) || {};
  return {
    genre: String(raw.genre || '').trim() || 'Drama',
    tone: String(raw.tone || '').trim(),
    treatment: String(raw.treatment || '').trim(),
    alternatives: (Array.isArray(raw.alternatives) ? raw.alternatives : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3),
  };
};

// Render a parsed asset array (the cast schema — type + facePrompt/bodyPrompt/presencePrompt/
// prompt) into bible PLATES. Used by castFromIdea (the Cast & World idea read). Each plate carries
// its source asset id + a `primary` flag (the identity anchor: the FACE for a character, the single
// plate otherwise). Streams onPlan/onEntry; the canvas tags/locks the plates.
export const castDraftFromParsed = async ({ arr, style = '', imageModel = 'seedreamPro', thinking = false, config } = {}, ctx, hooks = {}) => {
  const onPlan = hooks.onPlan || (() => {});
  const onEntry = hooks.onEntry || (() => {});
  // The shared style rides on EVERY plate — consistency by construction.
  const withStyle = (p) => [String(p || '').trim(), style].filter(Boolean).join('. ');
  // A portrait plate is an IDENTITY ANCHOR, not a scene still. Force a clean frontal
  // reference — facing camera, neutral seamless background, no environment — appended to
  // every character FACE plate so the anchor stays reliable regardless of LLM drift.
  const PORTRAIT_SPEC = 'Subject facing camera directly, frontal, eyes to lens. Plain neutral seamless studio background, evenly lit — no scene, no environment, no location, no props.';
  // Cast plates render at 4K, each in the shape that fits it: a head PORTRAIT (3:4)
  // for facial fidelity in close-ups, a LANDSCAPE full-body TURNAROUND sheet (4:3 —
  // frontal + side views side by side) head-to-toe, a LANDSCAPE establishing frame
  // (16:9) for places.
  const FACE_SIZE = resolveImageSize('4K', '3:4');
  const BODY_SIZE = resolveImageSize('4K', '4:3');
  const PLACE_SIZE = resolveImageSize('4K', '16:9');
  const CREATURE_SIZE = resolveImageSize('4K', '16:9'); // an in-world PRESENCE, cinematic — not a portrait
  const PROP_SIZE = resolveImageSize('4K', '4:3');       // a clean object / vehicle reference
  // Flatten the assets into a PLATE LIST, each rendered in the shape its TYPE needs:
  //  • character → frontal FACE portrait (identity anchor) + full-body turnaround sheet
  //    (the body refs the face so the sheet keeps the close-up's identity)
  //  • creature  → ONE in-world "presence" plate (a bible 'character' ref, but obscured /
  //    atmospheric — NO PORTRAIT_SPEC: a neutral frontal mugshot would kill an obscured antagonist)
  //  • prop      → ONE clean object / vehicle reference (bible 'prop')
  //  • location  → ONE establishing plate (the default)
  //  `assetId`/`primary` tag each plate to its source asset (the FACE is the primary anchor) so
  //  a caller can wire a SHOT card's refs to the right plate. (`c.role` tolerated alongside `c.type`.)
  const plates = [];
  arr.slice(0, 8).forEach((c, ci) => {
    const aid = String(c?.id != null ? c.id : ci);
    const type = String(c?.type || c?.role || '').trim().toLowerCase();
    const role = CAST_ROLE[type] || 'location';
    const name = String(c?.name || `Asset ${ci + 1}`).slice(0, 40);
    const face = String(c?.facePrompt || '').trim();
    const body = String(c?.bodyPrompt || '').trim();
    const presence = String(c?.presencePrompt || '').trim();
    const single = String(c?.prompt || '').trim();
    if (type === 'character' && face) {
      const faceKey = `cast-${ci}-face`;
      plates.push({ key: faceKey, role: 'character', name: `${name} · face`, prompt: `${withStyle(face)}. ${PORTRAIT_SPEC}`, size: FACE_SIZE, assetId: aid, primary: true });
      if (body) plates.push({ key: `cast-${ci}-body`, role: 'character', name: `${name} · body`, prompt: withStyle(body), refFrom: faceKey, size: BODY_SIZE, assetId: aid, primary: false });
    } else if (type === 'creature' && (presence || single || face)) {
      plates.push({ key: `cast-${ci}`, role: 'character', name, prompt: withStyle(presence || single || face), size: CREATURE_SIZE, assetId: aid, primary: true });
    } else if (single || face || presence) {
      plates.push({ key: `cast-${ci}`, role, name, prompt: withStyle(single || face || presence), size: role === 'prop' ? PROP_SIZE : PLACE_SIZE, assetId: aid, primary: true });
    }
  });
  if (!plates.length) throw new Error('The production draft returned no usable assets — rephrase the idea.');
  // Announce the PLAN before any image renders (role + name + asset tag) so the UI can
  // place loading cards immediately — no silent minute.
  onPlan(plates.map(({ role, name, assetId, primary }) => ({ role, name, assetId, primary })));

  const entries = [];
  const urlByKey = {};
  // Retry transient errors AND the output-image content filter (per-sample → a re-roll
  // usually passes; soften the prompt after a filter hit). Cast plates can trip it too.
  const genImage = (prompt, refUrl, size) => {
    let policyHit = false;
    return withRetry(
      () => ctx.client.generateImage({
        prompt: policyHit ? `${prompt} Keep it tasteful and non-graphic.` : prompt,
        ...(refUrl ? { referenceImages: [refUrl] } : {}),
        // Pro caps the image AREA at 2048² — the 4K plate sizes scale down to fit there.
        size: clampSizeForModel(imageModel, size),
        model: getModel(imageModel, config),
        // Pro "thinking" prompt optimization — applies to the TEXT-TO-IMAGE plates
        // (faces/places/props); the body sheet refs its face, so the transport drops it there.
        optimizePrompt: !!thinking && imageModel === 'seedreamPro',
      }),
      { tries: 4, baseMs: 2500, shouldRetry: (err) => isTransient(err) || isImagePolicyError(err), onRetry: (err) => { if (isImagePolicyError(err)) policyHit = true; } },
    );
  };
  const renderPlate = (p, idx) => async () => {
    try {
      // A body plate waits on its face's URL so the sheet inherits the exact face.
      const out = await genImage(p.prompt, p.refFrom ? urlByKey[p.refFrom] : null, p.size);
      urlByKey[p.key] = out.url;
      const entry = { id: p.key, role: p.role, name: p.name, url: out.url, cacheUrl: out.cacheUrl || null, locked: true, assetId: p.assetId, primary: p.primary };
      entries.push(entry);
      onEntry(entry, idx);
    } catch {
      onEntry({ id: p.key, role: p.role, name: p.name, url: '', failed: true, assetId: p.assetId, primary: p.primary }, idx);
    }
  };
  // Phase 1: faces + locations (no dependency). Phase 2: bodies (ref their face).
  const indep = plates.map((p, idx) => (p.refFrom ? null : renderPlate(p, idx))).filter(Boolean);
  const deps = plates.map((p, idx) => (p.refFrom ? renderPlate(p, idx) : null)).filter(Boolean);
  await runWithConcurrency(indep, 3);
  await runWithConcurrency(deps, 3);
  if (!entries.length) throw new Error('The production draft could not generate any anchors.');
  return entries;
};

// Idea → cast & world (the original entry): one read derives the asset list, then the shared
// renderer draws the bible plates.
export const castFromIdea = async ({ idea, genre = '', ethnicity = '', imageModel = 'seedreamPro', thinking = false, config } = {}, ctx, hooks = {}) => {
  const t = String(idea || '').trim();
  if (!t) throw new Error('The production draft needs the film idea.');
  const { content } = await ctx.client.reason({
    // Ethnicity steers the PLANNER (which writes every character description), so all
    // plates inherit it consistently — same race-drift lever as the storyboard's.
    prompt: renderTemplate('storyboard.cast.user', { idea: t, genre: genre || 'unspecified', ethnicity: String(ethnicity || '').trim() || 'unspecified — pick what fits the story' }),
    systemPrompt: renderTemplate('storyboard.cast.system'),
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const raw = parseJson(content);
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.assets) ? raw.assets : null);
  if (!arr || !arr.length) throw new Error('The production draft returned nothing — provide bible images or rephrase the idea.');
  const style = (raw && !Array.isArray(raw) && String(raw.style || '').trim()) || '';
  return castDraftFromParsed({ arr, style, imageModel, thinking, config }, ctx, hooks);
};
