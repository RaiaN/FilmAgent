// Storyboard core. KEY MOMENTS (storyboardMoments → storyboardAuthor) is the one
// storyboard brain: script → key moments (body · motion · audio per moment);
// storyboardKeyframe renders each shot's still. Also home to the pre-production draft
// (castFromIdea).
//
// Pure core — canvas/SDK inject ctx { client, config }.

import { renderTemplate, getModel, getRuntime, imageRefCap, keyframeImageSize, editImageArea, clampSizeForModel, defaultImageModelKey, imageTraits } from '../suiteConfig';
import { resolveImageSize } from '../imageSizes';
import { composeKeyframePrompt, composeStoryboardSheetPrompt, shotTemplateCatalog, SHOT_TEMPLATE_BY_ID } from '../recipes';
import { parseJson } from './director';
import { fitList, fitText } from './limits';
import { runWithConcurrency } from './parallel';
import { requireSkillLine, crewStep } from '../skills';

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
  const targets = fitText(String(instruction || '').trim(), 1000, 'The mask instruction') || 'EVERY person in the frame';
  const { url: out, cacheUrl } = await ctx.client.generateImage({
    prompt: renderTemplate('previz.mask', { targets: SLOT }).split(SLOT).join(targets),
    referenceImages: [src],
    size: keyframeImageSize(defaultImageModelKey()),
    model: getModel(defaultImageModelKey(), config),
  });
  if (!out) throw new Error('No masked plate URL in response');
  return { url: out, cacheUrl };
};

// ---- KEY MOMENTS (the director's breakdown): script → the moments the story can't do
// without, each ONE Seedance 2.5 generation. A SELECTION, not a partition: the quote is the
// moment's own words copied from the script, and every promise is checked in code —
// quote found verbatim, 4–15 s, a place named, references in range. A failed check gets ONE
// corrective re-ask naming what failed; whatever still fails is an error, never a quiet
// repair. (An API failure is never re-asked — it is the error.)
const SPAN_SLOT = '@@BRIEF@@';
const MOMENT_SECONDS = [4, 15];
// A quote may run across a numbered list ("…rituals.\n2. He picks…" quoted as "…rituals. He
// picks…"): list numbers are layout, not words of the script.
const scriptWords = (script) => normText(String(script || '').replace(/^[ \t]*\d{1,3}[.)][ \t]+/gm, ''));
const momentProblems = (moments, script, refCount) => {
  const src = scriptWords(script);
  const out = [];
  moments.forEach((m, i) => {
    const tag = `moment ${i + 1} ("${m.beat}")`;
    if (!normText(m.span) || !src.includes(normText(m.span))) out.push(`${tag}: its quote is not word-for-word in the script`);
    if (!(m.seconds >= MOMENT_SECONDS[0] && m.seconds <= MOMENT_SECONDS[1])) out.push(`${tag}: seconds must be ${MOMENT_SECONDS[0]}–${MOMENT_SECONDS[1]}`);
    if (!m.place) out.push(`${tag}: no place named`);
    if (m.badFigures.length) out.push(`${tag}: figures ${m.badFigures.join(', ')} are not attached (${refCount} references)`);
  });
  return out;
};
// `labels` name the attached plates ([Image N] → who or what); `places` are the film's places
// by their exact names — a moment set in one of them uses that name.
const worldNote = (labels, places) => [
  labels.length ? `THE ATTACHED PLATES:\n${labels.map((l, i) => `[Image ${i + 1}] ${l}`).join('\n')}\n` : '',
  places.length ? `THE FILM'S PLACES — a moment set in one of them uses its name EXACTLY:\n${places.map((p) => `- ${p}`).join('\n')}\n` : '',
].join('');
export const storyboardMoments = async ({ script = '', style = '', references = [], labels = [], places = [], note = '', config } = {}, ctx) => {
  const text = String(script || '').trim();
  if (!text) throw new Error('Write the script first.');
  const refs = fitList(references, 10, 'plates for the 1st AD');
  if (labels.length && labels.length !== refs.length) throw new Error(`${refs.length} plates but ${labels.length} names for them.`);
  fitText(text, 12000, 'The script');
  fitText(String(note || ''), 1500, "The director's note");
  const system = await crewStep('crew-ad', 'moments', { templates: shotTemplateCatalog(), refCount: String(refs.length), skill: await requireSkillLine('seedance25') });
  const ask = async (retry) => {
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('storyboard.moments.user', { script: SPAN_SLOT, style: style || 'auto', world: worldNote(labels, places), note: String(note || '').trim() ? "\nDIRECTOR'S NOTE — apply it to the selection:\n@@NOTE@@\n" : '', retry }).split(SPAN_SLOT).join(text).split('@@NOTE@@').join(String(note)),
      systemPrompt: system,
      images: refs,
      modelId: getModel('reasoner', config),
      reasoningEffort: getRuntime(config).reasoningEffort,
    });
    const raw = parseJson(content) || {};
    return (Array.isArray(raw.moments) ? raw.moments : []).map((m, i) => {
      const figs = Array.isArray(m?.figures) ? [...new Set(m.figures.map((x) => Number(x)))] : [];
      return {
        beat: String(m?.title || `Moment ${i + 1}`).replace(/\s+/g, ' ').trim(),
        job: String(m?.turn || '').replace(/\s+/g, ' ').trim(),
        // An id outside the library stays EMPTY — no camera is ever substituted.
        shotTemplate: SHOT_TEMPLATE_BY_ID[m?.shotTemplate] ? m.shotTemplate : '',
        figures: figs.filter((x) => x >= 1 && x <= refs.length),
        badFigures: figs.filter((x) => !(x >= 1 && x <= refs.length)),
        intExt: /^int/i.test(String(m?.intExt || '')) ? 'INT' : /^ext/i.test(String(m?.intExt || '')) ? 'EXT' : '',
        place: String(m?.place || '').replace(/\s+/g, ' ').trim(),
        seconds: Math.round(Number(m?.seconds)),
        // The quote keeps its line breaks — it IS the script's own text.
        span: String(m?.quote || '').trim(),
      };
    });
  };
  let moments = await ask('');
  let problems = moments.length ? momentProblems(moments, text, refs.length) : ['no moments came back'];
  if (problems.length) {
    moments = await ask(`\nRETRY — your previous answer broke these rules; fix every one:\n${problems.map((x) => `• ${x}`).join('\n')}\n`);
    problems = moments.length ? momentProblems(moments, text, refs.length) : ['no moments came back'];
  }
  if (problems.length) throw new Error(`Key moments failed the checks: ${problems.join(' · ')}`);
  return moments.map(({ badFigures, ...m }) => m);
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

// ---- #2 the dialogue gate, shared ------------------------------------------------
// The AUTHOR has always verified that every spoken line from its span survived. The
// CARD verbs (compose / direct) make the same promise in their templates and
// never checked it, so a Compose could silently drop dialogue. Same gate: run, diff, ONE
// corrective re-ask naming the missing lines, report whatever still didn't make it.
export const withDialogueGate = async (source, field, run) => {
  const wanted = spanDialogueLines(source);
  let out = await run('');
  const missingIn = (o) => wanted.filter((l) => !normText(o?.[field] || '').includes(normText(l)));
  let missing = missingIn(out);
  if (missing.length && String(out?.[field] || '').trim()) {
    out = await run(`\n\nRETRY — your previous draft DROPPED these dialogue lines. Every one must appear word-for-word, in curly braces, with its speaker named: ${missing.map((l) => `"${l}"`).join(' · ')}`);
    missing = missingIn(out);
  }
  return { ...out, missingDialogue: missing };
};

// AUTHOR one shot from its verbatim span. ONE corrective re-ask names any span dialogue
// the motion dropped; still missing → `missingDialogue` (the card flags it, never silently).
// ---- BLOCK ONE SCENE (Studio): the 1st AD's scene sheet --------------------------------
// One planner call per scene: the scene's own words (never the whole script), its place's
// landmarks when an earlier scene there already fixed them, the end frame of the scene before
// when it is in the same place, and the plates of who is in it. The scene is ONE take that may
// cut between its views. Code checks what the call promises — 4–15 s, landmarks, 1–3 views,
// every beat on a listed view, a gaze target that is never the lens, a start and an end — with
// ONE corrective re-ask naming the failures, then an error naming the scene.
// The camera itself — never "the audience", which on a stage is people in the scene.
const LENS_RE = /\b(camera|lens)\b/i;
const str = (x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
const sheetProblems = (sh) => {
  const out = [];
  if (!(sh.seconds >= MOMENT_SECONDS[0] && sh.seconds <= MOMENT_SECONDS[1])) out.push(`seconds must be ${MOMENT_SECONDS[0]}–${MOMENT_SECONDS[1]}`);
  if (!sh.landmarks) out.push('no landmarks for the place');
  if (!sh.views.length || sh.views.length > 3) out.push('needs 1–3 views');
  sh.views.forEach((vw) => { if (!vw.name || !vw.from) out.push('every view needs a name and where the camera stands'); });
  if (!sh.start) out.push('no start frame described');
  if (!sh.end) out.push('no end frame described');
  if (!sh.beats.length || sh.beats.length > 4) out.push('needs 1–4 beats');
  sh.beats.forEach((b, k) => {
    if (!sh.views.some((vw) => vw.name === b.view)) out.push(`beat ${k + 1}: its view "${b.view}" is not one of the scene's views`);
    if (!b.action) out.push(`beat ${k + 1}: no action`);
    if (!b.looksAt) out.push(`beat ${k + 1}: says nothing about what anyone looks at`);
    else if (LENS_RE.test(b.looksAt)) out.push(`beat ${k + 1}: someone looks at the ${LENS_RE.exec(b.looksAt)[1]} — eyes go to a landmark, object or person`);
  });
  return out;
};
const retryLine = (problems) => `\nRETRY — your previous answer broke these rules; fix every one:\n${problems.map((x) => `• ${x}`).join('\n')}\n`;

export const blockScene = async ({ scene, landmarks = '', before = '', people = [], references = [], labels = [], unplated = [], note = '', effort = null, config } = {}, ctx) => {
  const words = String(scene?.text || '').trim();
  if (!words) throw new Error('This scene has no words to block — it needs its script.');
  const refs = fitList(references, 10, 'plates for the 1st AD');
  if (labels.length !== refs.length) throw new Error(`${refs.length} plates but ${labels.length} names for them.`);
  fitText(words, 12000, 'The scene');
  fitText(String(note || ''), 1500, "The director's note");
  const roster = labels.map((l, i) => `[Image ${i + 1}] ${l}`).join('\n') || '(no plates)';
  const system = await crewStep('crew-ad', 'sheet', { refCount: String(refs.length), roster });
  const fence = '"""';
  const brief = [
    `THE SCENE TO BLOCK — ${scene.slug || scene.title || 'the scene'}`,
    `Place: ${scene.place || 'as the scene says'}.`,
    landmarks ? `The place's landmarks are FIXED (an earlier scene there set them) — block against them and return them unchanged: ${landmarks}` : 'The place has no landmarks yet — set them.',
    people.length ? `The people in it — name each EXACTLY so, whatever the scene calls them: ${people.map((p) => (p.aka?.length ? `${p.name} (the script also says ${p.aka.join(', ')})` : p.name)).join('; ')}.` : '',
    unplated.length ? `In it, with no plate (use these script names): ${unplated.join(', ')}.` : '',
    before ? `The scene before happens in the same place and ends on this frame: ${before}` : '',
    `The scene's words:\n${fence}\n${words}\n${fence}`,
    String(note || '').trim() ? `DIRECTOR'S NOTE — apply it:\n${String(note).trim()}` : '',
  ].filter(Boolean).join('\n');
  const ask = async (retry) => {
    const { content } = await ctx.client.reason({ prompt: `${brief}\n${retry}\nBlock this scene and return the JSON.`, systemPrompt: system, images: refs, modelId: getModel('reasoner', config), reasoningEffort: effort || getRuntime(config).reasoningEffort });
    const raw = parseJson(content) || {};
    return {
      seconds: Math.round(Number(raw.seconds)),
      landmarks: landmarks || str(raw.landmarks),
      views: (Array.isArray(raw.views) ? raw.views : []).map((vw) => ({ name: str(vw?.name), from: str(vw?.from) })),
      start: str(raw.start),
      beats: (Array.isArray(raw.beats) ? raw.beats : []).map((b) => ({ view: str(b?.view), action: str(b?.action), looksAt: str(b?.looksAt) })),
      against: str(raw.against),
      sound: str(raw.sound),
      end: str(raw.end),
    };
  };
  let out = await ask('');
  let bad = sheetProblems(out);
  if (bad.length) {
    out = await ask(retryLine(bad));
    bad = sheetProblems(out);
  }
  if (bad.length) throw new Error(`${scene.slug || 'The scene'} failed the checks: ${bad.join(' · ')}`);
  return { place: scene.place, ...out };
};

// A scene sheet as the shot's text: where the camera is for each beat (a new view is a
// cut), what happens, what everyone's eyes are on, the end. Plain words — Camera writes the
// final prompt from it.
export const sceneMotion = (sc) => {
  const fromOf = (name) => (sc.views.find((vw) => vw.name === name) || {}).from || name;
  const lines = [`Landmarks: ${sc.landmarks}`, `At the start: ${sc.start}`];
  let shot = 0;
  sc.beats.forEach((b, i) => {
    const cut = i === 0 || b.view !== sc.beats[i - 1].view;
    if (cut) shot += 1;
    const where = !cut ? '' : i === 0 ? `Shot ${shot} — the camera is ${fromOf(b.view)}. ` : `Shot ${shot} — the shot cuts to the camera ${fromOf(b.view)}. `;
    lines.push(`${where}${b.action} Eyes on: ${b.looksAt}.`);
  });
  if (sc.against) lines.push(`Working against them: ${sc.against}`);
  lines.push(`At the end: ${sc.end}`);
  return lines.join('\n');
};

// A plate edited into another frame of the same world — a place seen from another camera
// position (Designer), or a scene's first view with its people placed (Stills). [Image 1]
// is the source; its aspect ratio is kept.
export const plateEdit = async ({ instruction = '', refs = [], imageModel = defaultImageModelKey(), config } = {}, ctx) => {
  const images = fitList(refs, imageRefCap(imageModel), 'reference images');
  if (!images.length) throw new Error('An edit needs its source plate.');
  const prompt = fitText(String(instruction || '').trim(), 4000, 'The image instruction');
  const { url, cacheUrl } = await ctx.client.generateImage({ prompt, referenceImages: images, keepAspectArea: editImageArea(imageModel), model: getModel(imageModel, config), optimizePrompt: false });
  if (!url) throw new Error('No image came back');
  return { url, cacheUrl, prompt };
};

export const storyboardAuthor = async ({ script = '', span = '', beat = '', job = '', shotTemplate = '', seconds = 0, prevBeat = '', nextBeat = '', references = [], note = '', settingIndex = 0, config } = {}, ctx) => {
  const refs = fitList(references, 10, 'plates for the 1st AD');
  fitText(script, 12000, 'The script');
  fitText(span, 4000, "A moment's quote");
  fitText(String(note || ''), 1000, "The director's note");
  // The motion is a Seedance 2.5 prompt — written under that model's own spec.
  const skill = await requireSkillLine('seedance25');
  const tpl = SHOT_TEMPLATE_BY_ID[shotTemplate] || {}; // no id → framing falls to "director's choice", never a substituted camera
  const wanted = spanDialogueLines(span);
  const run = async (retryNote) => {
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('storyboard.author.user', {
        script: SPAN_SLOT, span: '@@SPAN@@', beat, job: String(job || '').trim() || 'unstated — infer the single job from the span and serve it', framing: [tpl.framing, tpl.angle, tpl.move].filter(Boolean).join(', ') || 'director\'s choice',
        prevBeat: prevBeat || '(none — the first moment)', nextBeat: nextBeat || '(none — the last moment)',
        seconds: Number(seconds) > 0 ? `${Math.round(Number(seconds))} seconds` : 'as long as the situation needs',
        settingLine: Number(settingIndex) > 0
          ? `\n[Image ${Number(settingIndex)}] IS THE SETTING — the scene's location plate. The shot happens in THAT exact place: cite it for the environment ("the exact location in [Image ${Number(settingIndex)}]"), never as a person or a subject, and never describe a different place.`
          : '',
        note: String(note || '').trim() ? "DIRECTOR'S NOTE — apply it to THIS shot (where it conflicts with the span, the note wins):\n@@NOTE@@\n" : '',
        retry: retryNote || '',
      }).split(SPAN_SLOT).join(String(script)).split('@@SPAN@@').join(String(span)).split('@@NOTE@@').join(String(note)),
      systemPrompt: await crewStep('crew-ad', 'author', { refCount: String(refs.length), skill }),
      images: refs,
      modelId: getModel('reasoner', config),
      reasoningEffort: getRuntime(config).reasoningEffort,
    });
    const raw = parseJson(content) || {};
    return {
      body: String(raw.body || '').replace(/\s+/g, ' ').trim(),
      motion: String(raw.motion || '').replace(/\s+/g, ' ').trim(),
      audio: String(raw.audio || '').replace(/\s+/g, ' ').trim(),
      expression: String(raw.expression || '').replace(/\s+/g, ' ').trim(),
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
// A camera change under the edit lock, as words: the preset's framing, angle and lens.
const cameraWords = (camera) => [camera.framing, camera.angle, camera.cinematography].filter(Boolean).join(', ');
const cameraEditLine = (camera) => (camera
  ? `CAMERA CHANGE — part of this edit: re-shoot this same frame as ${cameraWords(camera)} — the same scene, subjects and moment. State it as one change clause.`
  : "CAMERA: unchanged — keep the frame's framing, angle and lens exactly.");

// Drawn marks on the frame are part of the instruction: they say WHERE to change, and
// the result must carry none of them.
const MARKS_LINE = '\nDRAWN MARKS: [Image 1] carries red hand-drawn marks. They show where to change (and, with the instruction, what). Read them as part of the instruction. The prompt must confine the change to the marked areas and say to remove every red mark — no mark may survive in the result.\n';

// EDIT PROMPT under the image model's skill: the planner reads the frame (+ refs) and
// writes the change-only edit from the user's instruction and the camera choice. Every
// [Image N] the instruction cites must survive — checked in code, ONE corrective re-ask,
// and whatever is still missing is returned for the caller to report.
export const composeFrameEdit = async ({ instruction = '', camera = null, annotated = false, refs = [], imageModel = defaultImageModelKey(), config } = {}, ctx) => {
  const I = '@@INSTRUCTION@@';
  const text = fitText(String(instruction || '').trim(), 2000, 'The edit instruction');
  const wanted = [...new Set([...text.matchAll(/\[Image \d+\]/g)].map((m) => m[0]))];
  const systemPrompt = renderTemplate('storyboard.frameEditCompose.system', { refCount: String(refs.length), cameraLine: cameraEditLine(camera), marksLine: annotated ? MARKS_LINE : '', skill: await requireSkillLine(imageModel) });
  const run = async (retry) => {
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('storyboard.frameEditCompose.user', { instruction: I }).split(I).join(text) + retry,
      systemPrompt,
      images: refs,
      modelId: getModel('reasoner', config),
      reasoningEffort: getRuntime(config).reasoningEffort,
    });
    return String(content || '').replace(/^```\w*\s*|\s*```$/g, '').trim();
  };
  let prompt = await run('');
  let missing = wanted.filter((t) => !prompt.includes(t));
  if (!prompt || missing.length) {
    prompt = await run(`\n\nYour last prompt dropped ${missing.join(', ') || 'everything'} — every image citation in the instruction must appear exactly as written.`);
    missing = wanted.filter((t) => !prompt.includes(t));
  }
  if (!prompt) throw new Error('The edit prompt came back empty.');
  return { prompt, missing };
};

export const storyboardKeyframe = async ({ body = '', shotTemplate = '', style = '', expression = '', ethnicity = '', refs = [], imageModel = defaultImageModelKey(), frameEdit = false, frameEditAnnotated = false, composeEdit = false, camera = null, config } = {}, ctx) => {
  const images = fitList(refs, imageRefCap(imageModel), 'reference images'); // attach in order → [Image 1..N] (Pro: 10, Lite: 6)
  // frameEdit = the Edit-shot editor's structure lock: [Image 1] IS the current frame and
  // the body is the CHANGE. composeEdit (the edit dialogs) has the planner write the edit
  // under the image model's skill — camera and drawn marks included. Internal fixed
  // instructions (no composeEdit) keep the lean EDIT template, text verbatim.
  const SLOT = '@@EDIT@@';
  let prompt;
  let editMissing = [];
  if (frameEdit && composeEdit) {
    ({ prompt, missing: editMissing } = await composeFrameEdit({ instruction: body, camera, annotated: frameEditAnnotated, refs: images, imageModel, config }, ctx));
  } else if (frameEdit) {
    const change = [camera ? `Reframe as ${cameraWords(camera)}: the same scene, subjects and moment.` : '', String(body || '').trim()].filter(Boolean).join(' ');
    prompt = renderTemplate(frameEditAnnotated ? 'storyboard.frameEditDraw' : 'storyboard.frameEdit', { instruction: SLOT }).split(SLOT).join(fitText(change, 2000, 'The edit'));
  } else {
    prompt = composeKeyframePrompt({ body, shotTemplate, style, expression, ethnicity });
  }
  const { url, cacheUrl } = await ctx.client.generateImage({
    prompt,
    referenceImages: images,
    // An edit keeps the source frame's aspect ratio ([Image 1] is the frame); a fresh
    // render is a 16:9 keyframe.
    ...(frameEdit ? { keepAspectArea: editImageArea(imageModel) } : { size: keyframeImageSize(imageModel) }),
    model: getModel(imageModel, config),
    // Edit-locked renders take the FAST path — thinking explicitly disabled (the frame
    // carries the structure; chain-of-thought only adds latency). Composed renders keep
    // the model default (no flag sent).
    ...(frameEdit ? { optimizePrompt: false } : {}),
  });
  if (!url) throw new Error('No keyframe URL in response');
  return { url, cacheUrl, prompt, editMissing }; // prompt = the EXACT sent prompt — stashed as promptUsed
};

// SINGLE-IMAGE mode: render the WHOLE storyboard as ONE sheet (a grid of numbered panels). Composed
// from the division `shots` + the full reference pool (attached in [Image 1..N] order, so the panel
// bodies' [Image N] map correctly and the cast stays consistent). One Seedream call → one image.
export const storyboardSheet = async ({ shots = [], style = '', title = '', references = [], imageModel = defaultImageModelKey(), config } = {}, ctx) => {
  const images = fitList(references, imageRefCap(imageModel), 'reference images');
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
  const refs = fitList(references, 8, 'reference images');
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('storyboard.shot.user', {
      script: String(script || '').trim() || '(none given)',
      beat: beat || 'this shot',
      style: String(style || '').trim() || 'auto',
      figures: JSON.stringify((figures || []).filter((x) => x >= 1 && x <= refs.length)),
    }),
    systemPrompt: await crewStep('crew-stills', 'frame', { refCount: String(refs.length) }),
    images: refs,
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const raw = parseJson(content) || {};
  const body = String(raw.body || raw.prompt || '').replace(/\s+/g, ' ').trim();
  if (!body) throw new Error('The shot rewrite came back empty.');
  return { body, expression: String(raw.expression || '').replace(/\s+/g, ' ').trim() };
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
    systemPrompt: renderTemplate('storyboard.enhance', { context: String(context || '').trim() ? `\nThe shot's text, for grounding only (never re-stage it):\n${SLOT}\n` : '' }).split(SLOT).join(fitText(String(context || ''), 1200, "The shot's text")),
    images: [imageUrl],
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const instruction = String((parseJson(content) || {}).instruction || '').trim();
  if (!instruction) throw new Error('The finishing pass came back empty.');
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
export const castDraftFromParsed = async ({ arr, style = '', imageModel = defaultImageModelKey(), thinking = false, references = [], max = 8, config } = {}, ctx, hooks = {}) => {
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
  fitList(arr, max, 'assets in the cast plan').forEach((c, ci) => {
    const aid = String(c?.id != null ? c.id : ci);
    const type = String(c?.type || c?.role || '').trim().toLowerCase();
    const role = CAST_ROLE[type] || 'location';
    const name = String(c?.name || `Asset ${ci + 1}`).trim();
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
  // One call per plate, with exactly its prompt: a rejection is that plate's failure,
  // reported with the model's reason — never re-rolled, never reworded.
  const genImage = (prompt, refUrl, size) => ctx.client.generateImage({
    prompt,
    ...(refUrl ? { referenceImages: [refUrl] } : {}),
    // Pro caps the image AREA at 2048² — the 4K plate sizes scale down to fit there.
    size: clampSizeForModel(imageModel, size),
    model: getModel(imageModel, config),
    // Pro "thinking" prompt optimization — applies to the TEXT-TO-IMAGE plates
    // (faces/places/props); the body sheet refs its face, so the transport drops it there.
    optimizePrompt: !!thinking && imageTraits(imageModel).thinkingToggle,
  });
  const renderPlate = (p, idx) => async () => {
    try {
      // A body plate waits on its face's URL so the sheet inherits the exact face — with
      // no face there is no body sheet.
      if (p.refFrom && !urlByKey[p.refFrom]) throw new Error('its face plate did not render');
      const out = await genImage(p.prompt, p.refFrom ? urlByKey[p.refFrom] : (p.extRef || null), p.size);
      urlByKey[p.key] = out.url;
      const entry = { id: p.key, role: p.role, name: p.name, url: out.url, cacheUrl: out.cacheUrl || null, locked: true, assetId: p.assetId, primary: p.primary, prompt: p.prompt };
      entries.push(entry);
      onEntry(entry, idx);
    } catch (err) {
      onEntry({ id: p.key, role: p.role, name: p.name, url: '', failed: true, error: err?.message || 'did not render', assetId: p.assetId, primary: p.primary, prompt: p.prompt }, idx);
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

// Idea → the cast & world PLAN (one read, no images): the asset list + the shared style.
// castFromIdea renders it; a caller that shows the plan before paying calls this alone.
// `existing` = the film's elements that already exist ({ name, kind, plated }): unplated ones
// are planned under their exact names; plated ones are not planned again.
const KIND_TYPE = { character: 'character', location: 'location', prop: 'prop' };
const existingNote = (existing) => {
  const todo = existing.filter((e) => !e.plated);
  const done = existing.filter((e) => e.plated);
  return [
    todo.length ? `Already in the film, still without a plate — plan ONE asset for EACH, with this EXACT name and type:\n${todo.map((e) => `- "${e.name}" (${KIND_TYPE[e.kind]})`).join('\n')}` : '',
    done.length ? `Already cast and plated — do NOT plan these again: ${done.map((e) => `"${e.name}"`).join(', ')}.` : '',
  ].filter(Boolean).join('\n');
};
export const castPlanFromIdea = async ({ idea, ethnicity = '', references = [], existing = [], note = '', config } = {}, ctx) => {
  const t = String(idea || '').trim();
  if (!t && !references.length) throw new Error('The production draft needs the film idea, or reference art to derive it from.');
  const { content } = await ctx.client.reason({
    // Ethnicity steers the PLANNER (which writes every character description), so all
    // plates inherit it consistently — same race-drift lever as the storyboard's.
    prompt: renderTemplate('storyboard.cast.user', {
      idea: t || '(none given — derive the film, its subjects and its style ENTIRELY from the attached reference art)',
      ethnicity: String(ethnicity || '').trim() || 'unspecified — pick what fits the story',
      refNote: references.length ? `The ${references.length} attached image${references.length > 1 ? 's are' : ' is'} this film's reference art (storyboards / sketches / photos) — derive the cast, places, props and look FROM them, and cite each asset's source via "fromImage".` : '',
      existing: existingNote(existing),
      note: String(note || '').trim() ? `The director's note — it overrides anything above: ${fitText(String(note).trim(), 2000, 'The note to Casting')}` : '',
    }),
    systemPrompt: await crewStep('crew-casting', 'cast'),
    images: references,
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const raw = parseJson(content);
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.assets) ? raw.assets : null);
  if (!arr || !arr.length) throw new Error('The production draft returned nothing — provide bible images or rephrase the idea.');
  const style = (raw && !Array.isArray(raw) && String(raw.style || '').trim()) || '';
  return { arr, style };
};

// Idea → cast & world (the original entry): the plan, then the shared renderer draws the
// bible plates.
export const castFromIdea = async ({ idea, ethnicity = '', imageModel = defaultImageModelKey(), thinking = false, references = [], config } = {}, ctx, hooks = {}) => {
  const { arr, style } = await castPlanFromIdea({ idea, ethnicity, references, config }, ctx);
  return castDraftFromParsed({ arr, style, imageModel, thinking, references, config }, ctx, hooks);
};
