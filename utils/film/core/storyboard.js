// Storyboard core. The AD-PLANNER DIVISION (storyboardCarve → storyboardAuthor) is the one
// storyboard brain: brief/script → shot list (body · motion · audio per shot);
// storyboardKeyframe renders each shot's still. Also home to the pre-production draft
// (castFromIdea).
//
// Pure core — canvas/SDK inject ctx { client, config }.

import { renderTemplate, getModel, getRuntime, imageRefCap, keyframeImageSize, clampSizeForModel, maxShotSeconds, defaultVideoModelKey, defaultImageModelKey, imageTraits } from '../suiteConfig';
import { resolveImageSize } from '../imageSizes';
import { composeKeyframePrompt, composeStoryboardSheetPrompt, shotTemplateCatalog, SHOT_TEMPLATE_BY_ID } from '../recipes';
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
// CUT markers, no characters facing
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

// ---- Split: a brief (or an oversized shot prompt) → sequential SHOT segments capped ------
// at the default video model's max shot length.
// SEGMENTATION, not rewriting (one reason() call, no code parsing): wording, details and
// timestamps are PRESERVED per segment; durations come from timestamp deltas when present,
// else the model's estimate (clamped 5s–model max here). Used by the Brief node's "Split into
// Shots", the SHOT card's ✂ and the director-chat `split` action.

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
// CARD verbs (compose / direct) make the same promise in their templates and
// never checked it, so a Compose could silently drop dialogue. Same gate, same retry:
// run, diff, retry once naming the missing lines, report whatever still didn't make it.
export const withDialogueGate = async (source, field, run) => {
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
export const storyboardAuthor = async ({ script = '', span = '', beat = '', job = '', shotTemplate = '', prevBeat = '', nextBeat = '', references = [], note = '', settingIndex = 0, config } = {}, ctx) => {
  const refs = (references || []).filter(Boolean).slice(0, 10);
  const tpl = SHOT_TEMPLATE_BY_ID[shotTemplate] || {}; // no id → framing falls to "director's choice", never a substituted camera
  const wanted = spanDialogueLines(span);
  const run = async (retryNote) => {
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('storyboard.author.user', {
        script: SPAN_SLOT, span: '@@SPAN@@', beat, job: String(job || '').trim() || 'unstated — infer the single job from the span and serve it', framing: [tpl.framing, tpl.angle, tpl.move].filter(Boolean).join(', ') || 'director\'s choice',
        prevBeat: prevBeat || '(scene start)', nextBeat: nextBeat || '(scene end)',
        settingLine: Number(settingIndex) > 0
          ? `\n[Image ${Number(settingIndex)}] IS THE SETTING — the scene's location plate. The shot happens in THAT exact place: cite it for the environment ("the exact location in [Image ${Number(settingIndex)}]"), never as a person or a subject, and never describe a different place.`
          : '',
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
