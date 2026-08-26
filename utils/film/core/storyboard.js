// Storyboard core. The AD-PLANNER DIVISION (storyboardCarve → storyboardAuthor) is the one storyboard
// brain: brief/script → shot list (body · motion · exiting · audio per shot), turn by
// turn with the director; storyboardKeyframe/storyboardEndframe render each shot's
// START still and (for developing shots) its chained END frame. Also home to the Story
// agent (writeFilmPrompt → idea/script → one long cinematic prompt) and the
// pre-production draft (castFromIdea).
//
// Pure core — canvas/SDK inject ctx { client, config }.

import { renderTemplate, getModel, getRuntime, imageRefCap, keyframeImageSize, clampSizeForModel, maxShotSeconds, defaultVideoModelKey, defaultImageModelKey, videoTraits, imageTraits } from '../suiteConfig';
import { resolveImageSize } from '../imageSizes';
import { composeSeedancePrompt, composeKeyframePrompt, composeStoryboardSheetPrompt, shotTemplateCatalog, shotTemplateCinematography, SHOT_TEMPLATE_BY_ID, storyArcCatalog, STORY_ARC_BY_ID } from '../recipes';
import { parseJson } from './director';
import { withRetry, isTransient } from './retry';
import { isImagePolicyError } from './operations';
import { runWithConcurrency } from './parallel';

// A shot's durationSec always lands inside the default video model's window,
// defaulting to 10s.
const clampDuration = (v) => Math.max(5, Math.min(maxShotSeconds(defaultVideoModelKey()), Math.round(Number(v) || 10)));
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

// ---- Split: a brief (or an oversized shot prompt) → sequential SHOT segments capped ------
// at the default video model's max shot length.
// SEGMENTATION, not rewriting (one reason() call, no code parsing): wording, details and
// timestamps are PRESERVED per segment; durations come from timestamp deltas when present,
// else the model's estimate (clamped 5s–model max here). Used by the Brief node's "Split into
// Shots", the SHOT card's ✂ and the director-chat `split` action.
const MAX_SPLIT_SEGMENTS = 24;
export const splitIntoShots = async ({ text, count, config } = {}, ctx) => {
  const brief = String(text || '').trim();
  if (!brief) throw new Error('The split needs a brief or a shot prompt first.');
  // `count` is a GOAL, not a hard number: the per-segment duration physics always wins
  // (a 60s brief cannot fit 3 segments), so the model aims for it and the duration
  // rule breaks ties. Absent → fewest possible.
  const goal = Number.isFinite(Number(count)) && Number(count) >= 2 ? Math.min(MAX_SPLIT_SEGMENTS, Math.round(Number(count))) : null;
  // The brief is injected AFTER the template render via a sentinel: renderTemplate's
  // whitespace collapse would mangle screenplay indentation / aligned timestamp columns,
  // and the split's whole contract is that the user's text survives byte-for-byte.
  const SLOT = '@@BRIEF@@';
  const maxSec = maxShotSeconds(defaultVideoModelKey());
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('split.user', { brief: SLOT }).split(SLOT).join(brief.slice(0, 12000)),
    systemPrompt: renderTemplate('split.system', {
      maxShots: String(MAX_SPLIT_SEGMENTS),
      maxSec: String(maxSec),
      countGoal: goal ? `The director asked for ${goal} segments — aim for exactly ${goal} when the 5-${maxSec} second rule allows it; the duration rule always wins, so otherwise get as close to ${goal} as possible.` : '',
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

// ---- Mask: scrub identity out of ANY board image into a flat colour plate -------------
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
    size: keyframeImageSize(defaultImageModelKey()),
    model: getModel(defaultImageModelKey(), config),
  });
  if (!out) throw new Error('No masked plate URL in response');
  return { url: out, cacheUrl };
};

// ---- Storyboard: a conversational SHOT DIVISION — script → a shot list, turn by turn ----
// The Storyboard agent is a cinematographer you brainstorm WITH. Each turn takes the script,
// the CURRENT shot list (read off the cards) and the director's message, and returns the FULL
// updated shot list + a one-line reply. The canvas reconciles the list into a column of SHOT
// cards (each a real CutNode = a Seedance prompt). No frames are rendered here — the shot list
// IS the storyboard; the picture is shooting a card. Camera = a shotTemplate id from the library.
// ---- NORMALIZE: the division's FRONT-END — any brief → SCREENPLAY format ----------
// Film's canonical IR: sluglines = scene structure, action lines = the event sequence,
// CAPS-on-introduction = the entity breakdown, dialogue verbatim. EXTRACTIVE by
// contract — unstated slug fields say UNSTATED, nothing the source didn't state is
// added. The screenplay is the HITL surface (edited as text on the control card) and
// what Divide carves. Input that already parses as a screenplay passes through
// VERBATIM — zero calls.
// A slugline: optional scene number, then INT/EXT (+ separator). "INTO…" never matches.
export const SLUG_RE = /^\s*(?:\d+[A-Za-z-]*[\s.:]+)?(?:INT\.?\/EXT|EXT\.?\/INT|INT|EXT|I\/E)\b[./\s-]/i;
export const parseScenes = (screenplay) => {
  const scenes = [];
  let cur = null;
  String(screenplay || '').split('\n').forEach((line) => {
    if (SLUG_RE.test(line)) { cur = { n: scenes.length + 1, slug: line.trim(), body: [] }; scenes.push(cur); }
    else if (cur) cur.body.push(line);
  });
  return scenes.map((s) => ({ n: s.n, slug: s.slug, body: s.body.join('\n').trim() }));
};

export const normalizeBrief = async ({ script = '', config } = {}, ctx) => {
  const text = String(script || '').trim();
  if (!text) throw new Error('Normalize needs the script — type or paste it first.');
  if (parseScenes(text).length) return { screenplay: text, passthrough: true };
  const NSLOT = '@@BRIEF@@';
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('storyboard.normalize.user', { script: NSLOT }).split(NSLOT).join(text.slice(0, 12000)),
    systemPrompt: renderTemplate('storyboard.normalize.system', {}),
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const screenplay = String(content || '').replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  if (!parseScenes(screenplay).length) throw new Error('Normalize came back without scene headings — try again.');
  return { screenplay, passthrough: false };
};

// ---- 2-STEP first division: CARVE (structure + verbatim spans) → AUTHOR (per shot) ----
// Carve gives the whole call's attention to structure; each span partitions the script
// word-for-word, which makes fidelity STRUCTURAL: the author pass gets its span as the
// source, and the dialogue gate can verify every span line survived — per shot.
const SPAN_SLOT = '@@BRIEF@@';
export const storyboardCarve = async ({ script = '', style = '', references = [], config } = {}, ctx) => {
  const text = String(script || '').trim();
  if (!text) throw new Error('Carving needs the brief/script text first.');
  const countGoal = `Carve into as many shots as the script NEEDS — every shot must earn its place. Never pad; never cram.`;
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
    const figures = Array.isArray(s?.figures) ? [...new Set(s.figures.map((x) => Number(x)).filter((x) => x >= 1 && x <= refs.length))] : [];
    return {
      beat: String(s?.beat || `Shot ${i + 1}`).replace(/\s+/g, ' ').trim().slice(0, 48),
      job: String(s?.job || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      // An id outside the library stays EMPTY — no camera is ever substituted.
      shotTemplate: SHOT_TEMPLATE_BY_ID[s?.shotTemplate] ? s.shotTemplate : '',
      figures,
      intExt: /^int/i.test(String(s?.intExt || '')) ? 'INT' : /^ext/i.test(String(s?.intExt || '')) ? 'EXT' : '',
      develops: !!s?.develops,
      scene: Math.max(1, Math.round(Number(s?.scene) || 1)),
      // The span keeps its line breaks — it IS the script slice, not prose.
      span: String(s?.span || '').trim().slice(0, 4000),
    };
  }).filter((s) => s.span);
  if (!shots.length) throw new Error('The carve came back empty — try rephrasing.');
  const uncovered = uncoveredScriptLines(text, shots);
  return { shots, uncovered, reply: String(raw.reply || '').replace(/\s+/g, ' ').trim().slice(0, 400) || 'Carved the script.' };
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

// The carve PROMISES its spans partition the script. Nothing enforced that, so a
// dropped paragraph became story that no shot covers and nobody was told. This is the
// check: every substantial script line must appear inside some span. Scene headings are
// excluded by contract; short fragments are skipped because a 3-word line matches
// almost anything. Pure — no call, no cost.
export const uncoveredScriptLines = (script, shots = []) => {
  const covered = normText((shots || []).map((sh) => sh?.span || '').join('\n'));
  if (!covered) return [];
  return String(script || '').split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 12 && !SLUG_RE.test(l))
    .filter((l) => !covered.includes(normText(l)));
};

// ---- #2 the dialogue gate, shared ------------------------------------------------
// The AUTHOR has always verified that every spoken line from its span survived. The
// CARD verbs (compose / enrich / direct) make the same promise in their templates and
// never checked it, so a Compose could silently drop dialogue. Same gate, same retry:
// run, diff, retry once naming the missing lines, report whatever still didn't make it.
const withDialogueGate = async (source, field, run) => {
  const wanted = spanDialogueLines(source);
  let out = await run('');
  if (!wanted.length) return { ...out, missingDialogue: [] };
  const missingIn = (o) => wanted.filter((l) => !normText(o?.[field] || '').includes(normText(l)));
  let missing = missingIn(out);
  if (missing.length && String(out?.[field] || '').trim()) {
    out = await run(`\n\nRETRY — your previous draft DROPPED these dialogue lines. Every one must appear word-for-word, in curly braces, with its speaker named: ${missing.map((l) => `"${l}"`).join(' · ')}`);
    missing = missingIn(out);
  }
  return { ...out, missingDialogue: missing };
};

// AUTHOR one shot from its verbatim span. Retries ONCE naming any span dialogue the
// motion dropped; still missing → returned in `missingDialogue` (the card flags it,
// never silently).
export const storyboardAuthor = async ({ script = '', span = '', beat = '', job = '', shotTemplate = '', develops = false, prevBeat = '', nextBeat = '', references = [], note = '', config } = {}, ctx) => {
  const refs = (references || []).filter(Boolean).slice(0, 10);
  const tpl = SHOT_TEMPLATE_BY_ID[shotTemplate] || {}; // no id → framing falls to "director's choice", never a substituted camera
  const wanted = spanDialogueLines(span);
  const run = async (retryNote) => {
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('storyboard.author.user', {
        script: SPAN_SLOT, span: '@@SPAN@@', beat, job: String(job || '').trim() || 'unstated — infer the single job from the span and serve it', framing: [tpl.framing, tpl.angle, tpl.move].filter(Boolean).join(', ') || 'director\'s choice',
        develops: develops ? 'DEVELOPS — write the exiting state' : 'HOLDS — exiting stays empty',
        prevBeat: prevBeat || '(scene start)', nextBeat: nextBeat || '(scene end)',
        note: String(note || '').trim() ? "DIRECTOR'S NOTE — apply it to THIS shot (where it conflicts with the span, the note wins):\n@@NOTE@@\n" : '',
        retry: retryNote || '',
      }).split(SPAN_SLOT).join(String(script).slice(0, 9000)).split('@@SPAN@@').join(String(span).slice(0, 4000)).split('@@NOTE@@').join(String(note).slice(0, 1000)),
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

// ONE storyboard KEYFRAME: a Seedream 5.0 still per shot. The `body` (written by the reference-aware
// division) addresses each reference as [Image N] with what to keep from it; `refs` are the shot's
// reference plates IN [Image 1..N] ORDER (the caller resolves + renumbers them). NOT a blend — each
// image is a distinct addressed subject. composeKeyframePrompt wraps the body with the camera + finish
// lines. Style/expression/ethnicity are optional overrides. One call per shot; the canvas streams them.
// The END frame of a DEVELOPING shot: a structure-locked frameEdit of its
// freshly-rendered START still — [Image 1] IS the start, the composed instruction
// carries the advance (+ the camera-under-lock reframe when the shot's camera moves),
// and the casting refs ride behind for identity. Fast path, like every locked edit.
export const storyboardEndframe = async ({ exiting = '', startUrl = '', refs = [], imageModel = defaultImageModelKey(), shotTemplate = '', config } = {}, ctx) => {
  const line = String(exiting || '').trim().slice(0, 800);
  if (!line || !startUrl) throw new Error('endframe needs an exiting sentence and the START still');
  // LITERALLY the Edit-shot call: the END STATE sentence rides VERBATIM as the edit
  // instruction — no wrapper prose. The only composition is the established
  // camera-under-lock reframe clause when the shot's camera moves (the same clause an
  // Edit-shot camera change adds).
  const tpl = SHOT_TEMPLATE_BY_ID[shotTemplate];
  const move = String(tpl?.move || '').trim();
  const isStatic = !move || /static|lock/i.test(move);
  const instruction = [
    isStatic ? '' : `Reframe to the composition the camera reaches at the end of its ${move} — the same scene, subjects and moment.`,
    line,
  ].filter(Boolean).join(' ');
  const out = await storyboardKeyframe({
    body: instruction, refs: [startUrl, ...(refs || [])].filter(Boolean), imageModel, frameEdit: true, config,
  }, ctx);
  return out; // { url, cacheUrl, prompt }
};

// QUICK STORYBOARD, pre-division: ONE page rendered straight from the VERBATIM
// script — the renderer picks the moments itself. No carve, no rows, no side
// effects; after a division the page renders from the real shot list instead.
export const storyboardQuickPage = async ({ script = '', panels = 6, style = '', references = [], imageModel = defaultImageModelKey(), config } = {}, ctx) => {
  const text = String(script || '').trim();
  if (!text) throw new Error('Quick Storyboard needs the script.');
  const SLOT = '@@SCRIPT@@';
  const prompt = renderTemplate('storyboard.quickPage', {
    panels: String(Math.max(2, Math.min(15, Math.round(Number(panels) || 6)))),
    style: String(style || '').trim() ? ` (${String(style).trim()})` : '',
    script: SLOT,
  }).split(SLOT).join(text.slice(0, 6000));
  const images = (references || []).filter(Boolean).slice(0, imageRefCap(imageModel));
  const { url, cacheUrl } = await ctx.client.generateImage({
    prompt, referenceImages: images, size: keyframeImageSize(imageModel), model: getModel(imageModel, config),
  });
  if (!url) throw new Error('No page URL in response');
  return { url, cacheUrl, prompt };
};

export const storyboardKeyframe = async ({ body = '', shotTemplate = '', style = '', expression = '', ethnicity = '', refs = [], imageModel = defaultImageModelKey(), frameEdit = false, frameEditAnnotated = false, config } = {}, ctx) => {
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
  return { url, cacheUrl, prompt }; // the EXACT sent prompt — stashed as promptUsed
};

// SINGLE-IMAGE mode: render the WHOLE storyboard as ONE sheet (a grid of numbered panels). Composed
// from the division `shots` + the full reference pool (attached in [Image 1..N] order, so the panel
// bodies' [Image N] map correctly and the cast stays consistent). One Seedream call → one image.
export const storyboardSheet = async ({ shots = [], style = '', title = '', references = [], imageModel = defaultImageModelKey(), config } = {}, ctx) => {
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
// COMPOSE — a 2-STEP PIPELINE: STEP 1 DERIVE reads ONLY the keyframes and
// narrates the visual path; STEP 2 ENRICH binds subjects to their real [Image N]
// chips and weaves in the text's dialogue/names/important wording (overrides
// reported in dropped[], originals stashed by the caller). No keyframes → single
// enrich call, text as the material. Binding lines / definitions / tails stay the
// deterministic compiler's job either way.
// The video model's TEXT-FORMAT contract, keyed off the same trait the compiler's
// keyframe grammar uses. The 2.5 branch is distilled from the OFFICIAL sd25-pe skill
// (.agents/skills/sd25-pe/SKILL.md — the vendor's prompt spec, not house doctrine);
// the 2.0 family ignores timestamps entirely.
const formatLineOf = (modelKey) => (videoTraits(modelKey).keyframeGrammar === 'keyframes'
  ? `FORMAT (official Seedance 2.5 guide): structure the action as STAGES in event order — each stage carries ONE main event and names its observable END state (positions, prop ownership, visible result). Write numeric time segments ONLY when the material already carries them — then keep them as ONE continuous, non-overlapping clock starting at 0 ("0-3s: … 3-8s: …", never nested); NEVER invent time segments to fill a target duration. Emotion is OBSERVABLE performance: triggering event → immediate reaction → a few clear cues (eyes, breath, hands) → the target emotion; never inner states, and show the trigger before the reaction. A camera instruction names the move + its target subject + where it starts and where it arrives; expand niche terms into their visible result. Anchor spatial relationships to stable objects (the door, the counter, the vehicle), never screen-left/right. Dialogue: language + delivery + speaker + {dialogue} in curly braces, labeled per speaker; non-speakers keep their mouths naturally closed. Sound symbols: music in (), sound effects in <>, subtitles in 【】 — never put a subject's name in angle brackets. Do not add quality packs, watermark/subtitle bans, aspect-ratio or duration lines, or any generic constraint the material did not ask for.`
  : 'FORMAT: this video model IGNORES timestamps. Write the action as plain event-order prose with no time markers.');

// The card's LOCKED camera preset as a hard contract for the prompt verbs: prose
// film-grammar alone is weak, so the camera must live IN the action text — staged,
// not tagged. No preset → the verb commits to one camera of its own choosing.
// The shot's ONE JOB (carved upstream) as an intent contract: every sentence the
// verb writes serves it. Absent → an empty line; the verb owes the shot a job of its own.
const jobLineOf = (job) => (String(job || '').trim()
  ? `THE SHOT'S ONE JOB (from the shot list — every sentence serves it): ${String(job).trim()}`
  : '');

const cameraLineOf = (camera) => (camera && (camera.framing || camera.move)
  ? `CAMERA (director-locked, non-negotiable): ${[camera.framing, camera.angle, camera.move].filter(Boolean).join(' · ')}. Stage every event FOR this exact camera, carry it in the action text (summary sentence included), and never contradict it.`
  : 'No camera preset is locked — choose the single camera that serves the action best and commit to it in the text.');

const kfLineOf = (kfIndices) => (kfIndices.length
  ? `KEYFRAME PATH — the shot's visual spine, IN ORDER: it opens on the composition of [Image ${kfIndices[0]}]${kfIndices.slice(1, -1).map((k) => `, passes through [Image ${k}]`).join('')}${kfIndices.length > 1 ? ` and lands on [Image ${kfIndices[kfIndices.length - 1]}]` : ''}.`
  : 'No keyframes are set — ground the action against the reference images and the text alone.');

// Density levels for Enrich — approximate word ceilings per the model guides (2.0
// dilutes past ~400 words; 2.5's 30s window rewards far denser text).
export const ENRICH_LEVELS = (modelKey) => {
  const w = videoTraits(modelKey).enrichWords;
  return [
    { key: 'light', label: 'Light polish', words: w.light },
    { key: 'rich', label: 'Rich detail', words: w.rich },
    { key: 'max', label: 'Maximal density', words: w.max },
  ];
};

// ENRICH — expand the CURRENT prompt in place: the text is the untouchable skeleton
// (events, order, [Image N] tags, dialogue verbatim); the call adds camera/motion/
// texture/atmosphere/VFX/sound precision around it, grounded in the attached chips.
// Keyframes and references are inputs, never outputs — the card's pointers and chip
// list stay exactly as they are.
export const enrichShotAction = async ({ text = '', references = [], roster = [], kfIndices = [], modelKey = defaultVideoModelKey(), level = 'rich', camera = null, job = '', config } = {}, ctx) => {
  const material = String(text || '').trim();
  if (!material) throw new Error('Enrich needs the shot prompt — write it or Compose first.');
  const lv = ENRICH_LEVELS(modelKey).find((l) => l.key === level) || ENRICH_LEVELS(modelKey)[1];
  const SLOT = '@@PROMPT@@';
  const run = async (retry) => {
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('cut.enrich.user', { refRoster: roster.join('\n') || '(no images attached)', text: SLOT }).split(SLOT).join(material.slice(0, 6000)) + retry,
      systemPrompt: renderTemplate('cut.enrich.system', { refCount: String(references.length), kfLine: kfLineOf(kfIndices), jobLine: jobLineOf(job), cameraLine: cameraLineOf(camera), formatLine: formatLineOf(modelKey), targetWords: String(lv.words) }),
      images: references,
      modelId: getModel('reasoner', config),
      reasoningEffort: getRuntime(config).reasoningEffort,
    });
    const raw = parseJson(content) || {};
    return { action: String(raw.action || '').trim(), audio: String(raw.audio || '').trim() };
  };
  const out = await withDialogueGate(material, 'action', run);
  if (!out.action) throw new Error('Enrich came back empty — try again.');
  return out;
};

// DIRECT — apply ONE director's note to the card's prompt: the note shapes how the
// shot FEELS and READS (tone, pacing, emphasis, atmosphere, wording); events, order,
// [Image N] tags, dialogue, references and keyframes all stay. The note wins over the
// old text where they disagree.
export const directShotAction = async ({ text = '', note = '', references = [], roster = [], kfIndices = [], modelKey = defaultVideoModelKey(), camera = null, job = '', config } = {}, ctx) => {
  const material = String(text || '').trim();
  const theNote = String(note || '').trim();
  if (!material) throw new Error('Direct needs the shot prompt — write it or Compose first.');
  if (!theNote) throw new Error('Write the note — what should this shot feel or read like?');
  const T = '@@TEXT@@';
  const N = '@@NOTE@@';
  const run = async (retry) => {
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('cut.direct.user', { refRoster: roster.join('\n') || '(no images attached)', text: T, note: N })
        .split(T).join(material.slice(0, 6000)).split(N).join(theNote.slice(0, 1500)) + retry,
      systemPrompt: renderTemplate('cut.direct.system', { refCount: String(references.length), kfLine: kfLineOf(kfIndices), jobLine: jobLineOf(job), cameraLine: cameraLineOf(camera), formatLine: formatLineOf(modelKey) }),
      images: references,
      modelId: getModel('reasoner', config),
      reasoningEffort: getRuntime(config).reasoningEffort,
    });
    const raw = parseJson(content) || {};
    return { action: String(raw.action || '').trim(), audio: String(raw.audio || '').trim() };
  };
  const out = await withDialogueGate(material, 'action', run);
  if (!out.action) throw new Error('Direct came back empty — try again.');
  return out;
};

export const composeShotAction = async ({ text = '', references = [], roster = [], kfIndices = [], modelKey = defaultVideoModelKey(), camera = null, job = '', config } = {}, ctx) => {
  const material = String(text || '').trim();
  if (!material && !references.length) throw new Error('Compose needs a prompt, keyframes or references to work from.');
  // ---- STEP 1 · DERIVE (keyframes only — deliberately blind to text and refs, so the
  // events come from the approved pictures with no old prompt to anchor on) ----
  let derived = '';
  if (kfIndices.length) {
    const kfUrls = kfIndices.map((k) => references[k - 1]).filter(Boolean);
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('cut.derive.user', { kfCount: String(kfUrls.length) }),
      systemPrompt: renderTemplate('cut.derive.system', { kfCount: String(kfUrls.length) }),
      images: kfUrls,
      modelId: getModel('reasoner', config),
      reasoningEffort: getRuntime(config).reasoningEffort,
    });
    derived = String((parseJson(content) || {}).events || '').trim();
    if (!derived) throw new Error('Deriving from the keyframes came back empty — try again.');
  }
  // ---- STEP 2 · ENRICH (all chips + roster + derived events + optional text) ----
  const kfLine = kfLineOf(kfIndices);
  const authorityLine = kfIndices.length
    ? `THE DERIVED EVENTS below were read from the shot's APPROVED KEYFRAMES — they are the authority on WHAT HAPPENS:\n<<<\n${derived}\n>>>\nRewrite them into the final action: replace each visual handle with its subject's [Image N] number from the roster, keep the event order and pacing. From the director's text carry ONLY what pictures cannot show — every dialogue line word-for-word in curly braces with its speaker named (placed at the right moments), proper names, and intent that does not contradict the events. Any text event the derived events contradict is dropped — list each in "dropped" (one short line), never silently.`
    : `The director's text is the MATERIAL and the authority on WHAT HAPPENS: carry its wording, its events and every dialogue line word-for-word in curly braces with the speaker named — you re-structure and ground it against the images, you never re-invent it. "dropped" stays empty.`;
  const SLOT = '@@PROMPT@@';
  const run = async (retry) => {
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('cut.compose.user', { refRoster: roster.join('\n') || '(no images attached)', text: SLOT }).split(SLOT).join(material.slice(0, 6000) || '(none — write from the images)') + retry,
      systemPrompt: renderTemplate('cut.compose.system', { refCount: String(references.length), kfLine, authorityLine, jobLine: jobLineOf(job), cameraLine: cameraLineOf(camera), formatLine: formatLineOf(modelKey) }),
      images: references,
      modelId: getModel('reasoner', config),
      reasoningEffort: getRuntime(config).reasoningEffort,
    });
    const raw = parseJson(content) || {};
    return {
      action: String(raw.action || '').trim(),
      audio: String(raw.audio || '').trim(),
      dropped: (Array.isArray(raw.dropped) ? raw.dropped : []).map((c) => String(c || '').trim()).filter(Boolean).slice(0, 6),
    };
  };
  // The director's own text is the dialogue source — keyframes cannot speak, so a line
  // in the text must survive into the action even when the pictures rule the events.
  const out = await withDialogueGate(material, 'action', run);
  if (!out.action) throw new Error('Compose came back empty — try again.');
  return { ...out, derived };
};

// ENHANCE a rendered still — the agentic finishing pass: ONE tap = a
// VLM look at the frame (writes a tailored change-only instruction: micro-detail,
// light shaping, texture, atmosphere) + ONE structure-locked frameEdit applying it.
// Composition/identity/blocking are hard-locked by both the instruction contract and
// the frameEdit grammar. Returns the new frame + the instruction (surfaced, never silent).
export const enhanceStill = async ({ imageUrl, context = '', imageModel = defaultImageModelKey(), onPhase, config } = {}, ctx) => {
  if (!imageUrl) throw new Error('Enhance needs the rendered still.');
  if (onPhase) onPhase('look'); // step 1 of 2 — the VLM studies the frame
  const SLOT = '@@CTX@@';
  const { content } = await ctx.client.reason({
    prompt: 'The attached image is the frame. Return the JSON.',
    systemPrompt: renderTemplate('storyboard.enhance', { context: String(context || '').trim() ? `\nThe shot's text, for grounding only (never re-stage it):\n${SLOT}\n` : '' }).split(SLOT).join(String(context || '').slice(0, 1200)),
    images: [imageUrl],
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const instruction = String((parseJson(content) || {}).instruction || '').trim();
  if (!instruction) throw new Error('The finishing pass came back empty — try again.');
  if (onPhase) onPhase('edit'); // step 2 of 2 — the locked edit renders
  const { url, cacheUrl, prompt } = await storyboardKeyframe({ body: instruction, refs: [imageUrl], imageModel, frameEdit: true, config }, ctx);
  return { url, cacheUrl, instruction, prompt };
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
// ---- the pre-production draft: cast + places, from the idea ----------------------
// ONE read derives everything the film needs to anchor every shot — 1–2 characters
// and 1–2 locations — under a single shared visual style, so the whole draft is
// consistent BY CONSTRUCTION (the style sentence is appended to every plate prompt
// deterministically — no separate "look" frame needed). Each is generated ONCE; those
// plates become the canonical anchors every shot then references. In the UI the results
// land as CANDIDATES with suggested-role chips — the user's tag locks them; headless
// runs (no human) adopt them directly.
const CAST_ROLE = { character: 'character', creature: 'character', location: 'location', prop: 'prop' };

// Render a parsed asset array (the cast schema — type + facePrompt/bodyPrompt/presencePrompt/
// prompt) into bible PLATES. Used by castFromIdea (the Cast & World idea read). Each plate carries
// its source asset id + a `primary` flag (the identity anchor: the FACE for a character, the single
// plate otherwise). Streams onPlan/onEntry; the canvas tags/locks the plates.
export const castDraftFromParsed = async ({ arr, style = '', imageModel = defaultImageModelKey(), thinking = false, references = [], config } = {}, ctx, hooks = {}) => {
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
    // An asset citing an attached reference image renders WITH it: the source design
    // (a storyboard panel, a sketch, a photo) rides as [Image 1] and the prompt pins
    // the identity to it — sketch-to-photoreal stays the SAME character, not a cousin.
    const extRef = references[(Number(c?.fromImage) || 0) - 1] || null;
    const pinned = (p) => (extRef ? `[Image 1] depicts ${name} (it may show several subjects or panels — find this one) — preserve that exact design, identity and distinguishing features faithfully, translated into the film's style. ${p}` : p);
    if (type === 'character' && face) {
      const faceKey = `cast-${ci}-face`;
      plates.push({ key: faceKey, role: 'character', name: `${name} · face`, prompt: `${pinned(withStyle(face))}. ${PORTRAIT_SPEC}`, extRef, size: FACE_SIZE, assetId: aid, primary: true });
      if (body) plates.push({ key: `cast-${ci}-body`, role: 'character', name: `${name} · body`, prompt: withStyle(body), refFrom: faceKey, size: BODY_SIZE, assetId: aid, primary: false });
    } else if (type === 'creature' && (presence || single || face)) {
      plates.push({ key: `cast-${ci}`, role: 'character', name, prompt: pinned(withStyle(presence || single || face)), extRef, size: CREATURE_SIZE, assetId: aid, primary: true });
    } else if (single || face || presence) {
      plates.push({ key: `cast-${ci}`, role, name, prompt: pinned(withStyle(single || face || presence)), extRef, size: role === 'prop' ? PROP_SIZE : PLACE_SIZE, assetId: aid, primary: true });
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
        optimizePrompt: !!thinking && imageTraits(imageModel).thinkingToggle,
      }),
      { tries: 4, baseMs: 2500, shouldRetry: (err) => isTransient(err) || isImagePolicyError(err), onRetry: (err) => { if (isImagePolicyError(err)) policyHit = true; } },
    );
  };
  const renderPlate = (p, idx) => async () => {
    try {
      // A body plate waits on its face's URL so the sheet inherits the exact face.
      const out = await genImage(p.prompt, p.refFrom ? urlByKey[p.refFrom] : (p.extRef || null), p.size);
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
export const castFromIdea = async ({ idea, ethnicity = '', imageModel = defaultImageModelKey(), thinking = false, references = [], config } = {}, ctx, hooks = {}) => {
  const t = String(idea || '').trim();
  if (!t && !references.length) throw new Error('The production draft needs the film idea, or reference art to derive it from.');
  const { content } = await ctx.client.reason({
    // Ethnicity steers the PLANNER (which writes every character description), so all
    // plates inherit it consistently — same race-drift lever as the storyboard's.
    prompt: renderTemplate('storyboard.cast.user', {
      idea: t || '(none given — derive the film, its subjects and its style ENTIRELY from the attached reference art)',
      ethnicity: String(ethnicity || '').trim() || 'unspecified — pick what fits the story',
      refNote: references.length ? `The ${references.length} attached image${references.length > 1 ? 's are' : ' is'} this film's reference art (storyboards / sketches / photos) — derive the cast, places, props and look FROM them, and cite each asset's source via "fromImage".` : '',
    }),
    systemPrompt: renderTemplate('storyboard.cast.system'),
    images: references,
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const raw = parseJson(content);
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.assets) ? raw.assets : null);
  if (!arr || !arr.length) throw new Error('The production draft returned nothing — provide bible images or rephrase the idea.');
  const style = (raw && !Array.isArray(raw) && String(raw.style || '').trim()) || '';
  return castDraftFromParsed({ arr, style, imageModel, thinking, references, config }, ctx, hooks);
};
