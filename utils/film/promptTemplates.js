// Central registry of every editable prompt template used by the Film Agent
// agents. Defaults live here; user edits are stored as overrides in localStorage
// and applied at render time. Templates use {placeholder} variables that the
// agent run() functions fill at call time.

export const DEFAULT_TEMPLATES = {

  // ---- Storyboard (the plan between casting and filming) ----
  'storyboard.cast.user': {
    agent: 'Cast & World',
    label: 'Draft the production (instruction)',
    vars: ['{idea}', '{ethnicity}', '{refNote}', '{existing}', '{note}'],
    text: 'Film idea: {idea}\nCharacter ethnicity (apply to every HUMAN character\'s facePrompt/bodyPrompt unless the idea itself dictates otherwise): {ethnicity}\n{refNote}\n{existing}\n{note}\nDerive the shared visual style FROM the idea (and the reference art, when attached) — never impose a genre or mood the material itself does not state. Return the JSON object: the shared style + the assets — characters (facePrompt + bodyPrompt), any creature (presencePrompt), locations and recurring props/vehicles (prompt).',
  },



  // ---- Mask: identity scrub — silhouette any image's people into a color plate ---------
  // (The key stays 'previz.mask' so saved user overrides keep applying, even though
  // Mask now lives as a tool on every image node.)
  // {targets} = WHAT gets silhouetted — 'EVERY person in the frame' by default, or the
  // user's own words (sentinel-injected VERBATIM by maskFrame, like the edit slot).
  'previz.mask': {
    agent: 'Mask',
    label: 'Mask (identity scrub)',
    vars: ['{targets}'],
    text: 'Reproduce [Image 1] EXACTLY — the same set, camera, framing, lighting and composition — but replace {targets} with FLAT solid-color silhouettes, one per subject: hard edges, completely filled with one color, no facial features, no clothing detail, no shading. Assign the colors left to right: blue, then green, then yellow, then red, then purple (repeat the sequence if there are more figures). Each silhouette keeps its subject\'s exact position, scale and pose. Everything NOT replaced stays photorealistic and identical to [Image 1]. No text or watermarks.',
  },

  // ---- Previz: block the scene → a top-down schematic → an animatic -----------------
  // The plan is the blocking; the SCHEMATIC draws it as a floor plan (edited by image
  // edit); the ANIMATIC is Seedance reading the schematic and moving the blockout.
  'previz.plan.system': {
    agent: 'Previz',
    label: 'Previz plan — blocking and coverage (system)',
    vars: ['{maxSeconds}'],
    text: `You are a director and 1st AD BLOCKING one scene for an animatic. Decide where everything is, who moves where, and how the cameras cover it. Never decide final look.

Fix the scene first: the ONE place it happens and the set pieces that define it (doors, tables, windows, vehicles, walls), each with where it sits in the space. Then every actor the description actually names (a crowd collapses to one group, at most 6), and where each one STARTS, bound to a named set piece.

Then the shots, in cut order. For each shot:
  - camera.from: where the camera stands in the space, bound to a set piece ("by the window, looking toward the door");
  - camera.framing: the shot size;
  - camera.move: static, or the move ("slow push in", "pans left with her");
  - action: who moves where during this shot, from a named place to a named place, in plain words ("Mara walks from the door to the table and sits; Tom turns to watch her"). Name actors by the names you gave them;
  - seconds: how long the shot runs, a whole number.
Cover like a director: open wide enough to read the geography, keep every camera on one side of the line of action, go tight only where the story turns. The whole cut runs at most {maxSeconds} seconds.

Return ONLY JSON — no prose, no code fences:
{"scene":"<2 sentences: the space and its features>","axis":"<one sentence: the line of action between the principal actors, against two set pieces>","set":[{"name":"<short name>","where":"<where it sits in the space>"}],"actors":[{"name":"<short name>","description":"<what this actor IS, its kind first, in the description's own words>","start":"<where it starts, bound to a set piece>"}],"shots":[{"camera":{"from":"...","framing":"...","move":"..."},"action":"...","seconds":4}]}`,
  },
  'previz.plan.user': {
    agent: 'Previz',
    label: 'Previz plan — instruction',
    vars: ['{brief}', '{camera}'],
    text: 'SCENE DESCRIPTION (verbatim):\n"""\n{brief}\n"""\nCAMERA PREFERENCE: {camera}\n\nBlock the scene and return the JSON.',
  },
  'previz.schematic': {
    agent: 'Previz',
    label: 'Previz schematic — the top-down floor plan',
    vars: ['{set}', '{actors}', '{moves}', '{cameras}', '{axis}'],
    text: 'A TOP-DOWN ORTHOGRAPHIC FLOOR-PLAN SCHEMATIC of a film scene: a clean technical blocking diagram on white, seen straight down, no perspective. Thin black linework for walls, doors, furniture and every set piece, each labelled in small block capitals. Each actor is a solid filled circle in their colour with their name beside it in small capitals. Each movement is a bold arrow in that actor\'s colour from where they start to where they end, numbered in order. Each camera is a small black camera symbol with a light-grey view cone opening toward what it frames, labelled CAM 1, CAM 2 and so on; a camera move is a dashed black arrow from the camera. The line of action is one thin dashed red line. No shading, no texture, no people drawn as figures, no photographic detail.\n\n{set}\n{actors}\n{moves}\n{cameras}\n{axis}',
  },
  'previz.animatic': {
    agent: 'Previz',
    label: 'Previz animatic — the Seedance prompt',
    vars: ['{style}', '{key}', '{shots}'],
    text: 'An ANIMATIC of one scene. {style}\n@Image1 is a top-down floor plan of this scene: use only its layout, where each actor starts and the paths the arrows show; the shots below decide the cameras. Never show the plan itself — no lines, labels, circles or arrows on screen.\n{key} Each block keeps its colour for the whole video; only colour tells them apart.\n{shots}',
  },
  'previz.describe.system': {
    agent: 'Previz',
    label: 'Previz → CUT — describe the animatic (system)',
    vars: [],
    text: `You watch a previz ANIMATIC: solid coloured blocks standing in for people, sliding and turning through a grey blockout of a set, cut by the cameras. Write what happens in it as the REAL scene, for a video model that will shoot it with this animatic as its motion reference.

Name every block by the person or thing it stands for, using the colour key, and call the set by the place it stands for. Write, in order: who is where, who moves where, what they do, where the camera stands and how it frames and moves, and every cut ("Cut to: ..."), with rough timing when it helps ("for the first 3 seconds").

Never describe the animatic's look: no blocks or boxes, no block colours, no sliding, no grey geometry, untextured surfaces or floor-plan marks. Each block stands for a person who walks, turns and acts naturally — write the person, not the block. Never decide light, grade or wardrobe — the look is set elsewhere. Write only what the video shows; do not add events.

Return ONLY JSON — no prose, no code fences:
{"prompt":"<the scene, plain prose, at most 160 words>"}`,
  },
  'previz.describe.user': {
    agent: 'Previz',
    label: 'Previz → CUT — instruction',
    vars: ['{scene}', '{set}', '{cast}', '{seconds}'],
    text: 'THE SCENE: {scene}\nTHE SET: {set}\nTHE COLOUR KEY (who each block stands for):\n{cast}\nLENGTH: {seconds} seconds\n\nWatch the attached animatic and return the JSON.',
  },
  'previz.cut.ref': {
    agent: 'Previz',
    label: 'Previz → CUT — the animatic\'s role line',
    vars: [],
    text: '@Video1 is used for the blocking, the timing of the action, the camera positions and moves, and the cuts; do not use its look — its solid stand-in blocks, their flat colours and the grey set geometry; the people move naturally, not as blocks.',
  },
  'previz.animatic.style.blockout': {
    agent: 'Previz',
    label: 'Animatic look — colour blocks',
    vars: [],
    text: 'A hard-surface VFX blockout. Every character is ONE rigid solid-colour block: an upright rectangular box about a person\'s height, with no head, no arms, no legs and no face. A block never bends, walks or gestures; it slides across the floor to move and turns in place to face a new way. The set is untextured grey geometry with hard edges, no texture, no detail, even flat light.',
  },

  // The LOCATION PLATE. Location Variations is edit-locked — coverage is a reframe of a
  // canonical image — so with no source image there is nothing to reframe. This builds
  // that canonical image from the user's description first; everything after it is the
  // unchanged edit path, which is what keeps the architecture pinned across angles.
  'location.anchor': {
    agent: 'Location Variations',
    label: 'Location plate — built from the description',
    vars: ['{brief}'],
    // {brief} is the user's Direction text, VERBATIM — no rewrite, no compile. What
    // follows it is the pipeline's CONTRACT, not taste: every variation is a reframe of
    // this plate, so anything alive standing in it would appear in all of them.
    text: '{brief}\n\nOne location, with nothing alive anywhere in the frame. No text, no lettering, no watermark.',
  },

  // The CHARACTER PLATE, the twin of location.anchor. Character Variations preserves an
  // identity, so with no source image there is no identity to preserve. This builds one
  // first — frontal and neutral, the same identity-anchor convention the cast plates use,
  // because a variation reframes and re-dresses an anchor rather than re-imagining it.
  'character.anchor': {
    agent: 'Character Variations',
    label: 'Character plate — built from the description',
    vars: ['{brief}'],
    // {brief} is the user's Direction text, VERBATIM — no rewrite, no compile. The
    // frontal/neutral tail is the identity-anchor CONTRACT the cast plates also use — a
    // variation re-dresses this figure, so the anchor must show the figure and nothing else.
    text: '{brief}\n\nOne subject only, whole of it in frame, facing camera, frontal, plain neutral seamless background, no scene and no location. No text, no lettering, no watermark.',
  },

  'storyboard.frameEditDraw': {
    agent: 'Storyboard',
    label: 'Edit a frame guided by drawn marks',
    vars: ['{instruction}'],
    text: 'EDIT [Image 1]. The red hand-drawn marks show where to change: {instruction}. Remove the marks; change nothing unmarked.',
  },

  'storyboard.enhance': {
    agent: 'Storyboard',
    label: 'Enhance a still — the finishing pass (VLM writes the edit)',
    vars: ['{context}'],
    text: `You are a stills finisher (DI artist) looking at ONE rendered storyboard frame. Identify what would most lift its CRAFT and write ONE edit instruction for an image-edit model — a chain of change-only clauses, concrete and local: micro-detail and material texture (fabric weave, skin pores, wet surfaces, wear), light shaping (key/fill/rim separation, motivated shadows), atmosphere (haze, dust motes, breath, condensation), color depth and contrast. Pick what THIS frame actually needs; skip what it already does well.

HARD RULES — the frame must remain the SAME shot, upgraded: never change composition, camera, framing, blocking, subject identity, wardrobe, expression, pose, or story content; add no new subjects, props or text; keep the style.
{context}
Return ONLY JSON — no prose, no code fences: {"instruction":"<the change-only edit instruction>"}`,
  },
  'storyboard.frameEditCompose.system': {
    agent: 'Storyboard',
    label: 'Edit a frame — write the Seedream edit prompt (system)',
    vars: ['{refCount}', '{cameraLine}', '{marksLine}', '{skill}'],
    text: `You write ONE Seedream image-EDIT prompt. {refCount} images are attached: [Image 1] is the frame being edited; any further image is a reference the instruction may cite as [Image N].

Write the edit the way the skill below specifies edits: change-only clauses against [Image 1]. Name each change the instruction asks for, name nothing else — everything unnamed in [Image 1] is preserved. Carry every content word of the instruction; add nothing the instruction and the camera line do not ask for. Keep every [Image N] citation exactly as written.

{cameraLine}
{marksLine}
{skill}

Return ONLY the prompt text — no quotes, no JSON, no commentary.`,
  },
  'storyboard.frameEditCompose.user': {
    agent: 'Storyboard',
    label: 'Edit a frame — the instruction',
    vars: ['{instruction}'],
    text: 'THE INSTRUCTION (verbatim — every word must be carried):\n"""\n{instruction}\n"""\n\nWrite the edit prompt.',
  },
  'storyboard.frameEdit': {
    agent: 'Storyboard',
    label: 'Edit a frame in place (structure locked)',
    vars: ['{instruction}'],
    text: 'EDIT [Image 1], change only: {instruction}',
  },

  // ---- SHOT card Re-derive: BIND the existing prompt to the card's references --------
  // A binding pass, NOT a rewrite: Develop's structure (arc, camera, eyelines) must
  // survive — the only change is [Image N] tags matching the badge numbers. The prompt
  // itself is sentinel-injected VERBATIM by the caller.
  'cut.derive.user': {
    agent: 'Shot',
    label: 'Compose step 1 — derive events (instruction)',
    vars: ['{kfCount}'],
    text: 'The {kfCount} attached stills are the keyframes, in shot order. Read them and return the JSON.',
  },
  'cut.edit.user': {
    agent: 'Shot',
    label: 'Edit — the director note (instruction)',
    vars: ['{analysis}', '{refRoster}', '{text}'],
    text: 'THE SHOT AS IT IS NOW — a description of @video1 written by a model that watched it. Ground the edit in it: the subjects, regions, times and light it names are facts about the source. It is not an instruction; only THE CHANGE below is.\n"""\n{analysis}\n"""\n\nTHE TARGET IMAGES, in send order:\n{refRoster}\n\nTHE CHANGE the director asked for:\n"""\n{text}\n"""\n\nReturn the JSON.',
  },

  // ANALYZE the master of an EDIT card: the source video in, a plain-language description
  // of the shot out, for a person to read and correct before the edit is written. It
  // describes the footage alone — the planned edit is never part of it.
  'edit.analyze.user': {
    agent: 'Shot',
    label: 'Edit — analyze the source video (length)',
    vars: ['{length}'],
    text: 'THE CLIP is {length} long.\n\nDescribe the shot and return the JSON.',
  },
  'cut.direct.user': {
    agent: 'Shot',
    label: 'Direct — apply the note (instruction)',
    vars: ['{refRoster}', '{text}', '{note}'],
    text: 'THE ATTACHED IMAGES, in send order:\n{refRoster}\n\nTHE CURRENT PROMPT (the shot — events, [Image N] tags and dialogue stay):\n"""\n{text}\n"""\n\nTHE DIRECTOR\'S NOTE (verbatim — it wins where they disagree):\n"""\n{note}\n"""\n\nReturn the JSON.',
  },
  'cut.compose.user': {
    agent: 'Shot',
    label: 'Compose — keyframe-aware cinematic action (instruction)',
    vars: ['{refRoster}', '{text}'],
    text: 'THE ATTACHED IMAGES, in send order:\n{refRoster}\n\nTHE DIRECTOR\'S TEXT:\n"""\n{text}\n"""\n\nReturn the JSON.',
  },
  'techTest.shots.system': {
    agent: 'Tech Test',
    label: 'Write the test shots (instruction)',
    vars: ['{count}', '{shotType}', '{country}', '{topic}', '{style}', '{seconds}', '{ratio}', '{skill}'],
    text: 'You write video-generation prompts for a production tech test: {count} shots that show how the video model handles one target.\n\nTHE TARGET\n- Shot type: {shotType}\n- Country / region: {country}\n- Topic: {topic}\n- Style: {style}\n- Every shot runs {seconds} seconds at aspect ratio {ratio}.\n\nRULES\n- Every shot is the target shot type.\n- Across the {count} shots, vary the subject, place, light, weather, time of day and camera movement, so the set covers the target instead of repeating one idea.\n- Ground every shot in the real culture, geography, architecture, dress and iconography of the country / region and the topic. Name concrete specifics, never generic exotic dressing.\n- Describe the world and the situation the camera sees; do not choreograph the action second by second.\n- For each shot list 2–5 "checks": the concrete things a reviewer must verify in the result — the cultural or iconographic details that must be right, scale, crowd and architectural detail.\n\n{skill}\n\nReturn ONLY JSON: [{"title": "2-5 words", "prompt": "...", "checks": ["..."]}]',
  },
  'techTest.shots.user': {
    agent: 'Tech Test',
    label: 'Write the test shots (request)',
    vars: ['{count}'],
    text: 'Write the {count} shots.',
  },
  'techTest.critique.system': {
    agent: 'Tech Test',
    label: 'Review one rendered shot (instruction)',
    vars: ['{shotType}', '{country}', '{topic}', '{style}', '{prompt}', '{checks}', '{measured}', '{imageRoster}'],
    text: 'You review one generated shot from a production tech test, as the film\'s VFX supervisor and a cultural consultant for {country} would before it goes to post.\n\nTHE TARGET: {shotType} · {country} · topic: {topic} · style: {style}\n\nTHE SHOT\'S PROMPT:\n"""\n{prompt}\n"""\n\nWHAT TO CHECK:\n{checks}\n\nMEASURED BY CODE: {measured}\n\nTHE IMAGES, in order:\n{imageRoster}\n\nScore each 0, 1 or 2 with a one-line reason:\n- prompt_adherence: does the shot show what the prompt describes?\n- target_fidelity: are the culture, place, iconography, dress and architecture right for {country} and the topic? Name every error.\n- shot_type: is it actually a {shotType}?\nList every concrete visual issue with where it is and its severity (minor, major or blocking): anatomy, faces, crowds that read as texture, repeated or cloned elements, warped architecture, text and signage, physics, scale.\nList the post-production work the shot would need.\nVerdict: "usable" as it is, "fixable" after the listed post work, or "reshoot".\n\nReturn ONLY JSON: {"prompt_adherence": {"score": 0, "reason": "..."}, "target_fidelity": {"score": 0, "reason": "..."}, "shot_type": {"score": 0, "reason": "..."}, "issues": [{"what": "...", "where": "...", "severity": "minor|major|blocking"}], "post_fixes": ["..."], "verdict": "usable|fixable|reshoot"}',
  },
  'techTest.critique.user': {
    agent: 'Tech Test',
    label: 'Review one rendered shot (request)',
    vars: [],
    text: 'Review the shot.',
  },
  'headroom.carry': {
    agent: 'Headroom',
    label: 'Carry the underexposed keyframes through the clip',
    vars: ['{keyframes}'],
    text: 'Edit @Video1: {keyframes}, with the target look applied. Match each one at its moment and apply the same look to every frame. Change only the look: keep every object, movement, the framing and the direction of the light exactly as in @Video1.',
  },
  'deconstruct.describeFrame': {
    agent: 'Take Viewer',
    label: 'Describe one frame (Take Viewer note)',
    vars: [],
    text: 'You are a film director\'s assistant reading ONE still frame ([Image 1]) pulled from a rendered take. Describe it as prompt-ready shot language, present tense, one short line per label:\nSUBJECTS: who/what is in frame — appearance, wardrobe, expression\nBLOCKING: where each subject sits in the frame and what each is looking at (never the camera)\nSETTING: the place, time of day, atmosphere\nCAMERA: framing, angle, approximate lens feel, depth of field\nLIGHT & GRADE: key direction, contrast, palette\nPlain text only — exactly those five labeled lines, no JSON, no commentary.',
  },

  // ---- Storyboard: KEY MOMENTS — the director's breakdown of the script ----------
  'storyboard.moments.user': {
    agent: 'Storyboard',
    label: 'Key moments (instruction)',
    vars: ['{script}', '{style}', '{world}', '{note}', '{retry}'],
    text: 'SCRIPT:\n"""\n{script}\n"""\nStyle / aesthetic: {style}.\n{world}{note}{retry}\nPick the key moments and return the JSON.',
  },
  'storyboard.author.user': {
    agent: 'Storyboard',
    label: 'Author ONE key moment (instruction)',
    vars: ['{script}', '{span}', '{beat}', '{job}', '{framing}', '{seconds}', '{prevBeat}', '{nextBeat}', '{settingLine}', '{note}', '{retry}'],
    text: 'FULL SCRIPT (context only):\n"""\n{script}\n"""\n\nYOUR MOMENT: "{beat}" — camera: {framing}. LENGTH: {seconds}. ITS ONE JOB: {job}. Previous moment: {prevBeat}. Next moment: {nextBeat}.\n{settingLine}\nYOUR SPAN (the source — carry its wording, all dialogue verbatim):\n"""\n{span}\n"""\n{note}{retry}\nReturn the JSON for THIS shot only.',
  },
  // ---- Storyboard: RE-DERIVE one shot's [Image N] body for a chosen reference set (Expand editor) --
  'storyboard.shot.user': {
    agent: 'Storyboard',
    label: 'Re-derive one keyframe body (instruction)',
    vars: ['{script}', '{beat}', '{style}', '{figures}'],
    text: 'SCRIPT (context):\n"""\n{script}\n"""\nShot: "{beat}". Style / aesthetic: {style}.\nThis shot features reference images {figures} (their [Image N] numbers) — feature EXACTLY those, addressing each by its [Image N] number.\nReturn the JSON: the body + expression.',
  },


  // ---- Creative Planner (agentic diversity for image agents) ----
  // Seed 2.0 Pro plans N substantially-different, content-aware prompts; the image
  // model then renders one each. Replaces all hardcoded descriptor pools.
  'creativePlanner.user': {
    agent: 'Creative Planner',
    label: 'Plan distinct prompts (instruction)',
    vars: ['{idea}', '{direction}', '{count}'],
    text: 'Concept: {idea}\nWhat to explore: {direction}\n\nIf reference image(s) are attached, study EACH one and creatively synthesise them. Produce exactly {count} options as the specified JSON array — every option substantially different from the others (no near-duplicates).',
  },
  'creativePlanner.inspiration.system': {
    agent: 'Creative Planner',
    label: 'Mood Board (system)',
    vars: ['{count}'],
    text: "You are a film director's concept artist. Given the concept — and any attached reference images, which you should read and creatively synthesise — propose {count} DISTINCT visual directions to generate, varying the strongest creative dimensions (subject treatment, composition, palette, lighting, era, mood, lens). Return ONLY a JSON array of {count} objects {\"label\": a 2–5 word tag, \"prompt\": a complete, self-contained image-generation prompt}. Each prompt must be vivid, concrete and usable on its own; the options must be substantially different from one another. No text, no logos, no watermark. No prose, no code fences.",
  },
  'creativePlanner.characterVariations.system': {
    agent: 'Creative Planner',
    label: 'Character variations (system)',
    vars: ['{count}', '{skill}'],
    text: "{skill}\n\nYou are a character designer. The attached image is the canonical character — it will be EDITED, not re-generated: an image-edit model receives it as [Image 1] and keeps EVERYTHING you do not name. Propose {count} DISTINCT variations as EDIT INSTRUCTIONS. Each \"prompt\" is ONE short instruction naming ONLY what changes — wardrobe, age, expression, lighting, or a re-pose/reframe phrased as 'Reframe to …, the same person' — never a re-description of the character (the image carries identity). Vary what the user asks for; if nothing is specified pick the most interesting dimensions. Return ONLY a JSON array of {count} objects {\"label\": 2–5 words, \"prompt\": the edit instruction}. Substantially different options. No prose, no code fences.",
  },
  'creativePlanner.locationVariations.system': {
    agent: 'Creative Planner',
    label: 'Location variations (system)',
    vars: ['{count}', '{skill}'],
    text: "{skill}\n\nYou are a location scout and DP. The attached image is the canonical location — it will be EDITED, not re-generated: an image-edit model receives it as [Image 1] and keeps EVERYTHING you do not name (architecture, layout, materials, set dressing; no people appear unless named). Propose {count} DISTINCT variations as EDIT INSTRUCTIONS. Each \"prompt\" is ONE short instruction naming ONLY what changes: COVERAGE ('Reframe to a low wide from the opposite end — the same location', 'Reframe to a high aerial — the same location') or STATE ('it is night, heavy rain, the windows lit warm'). Never re-describe the location — the image carries it. Vary what the user asks for; else pick the most interesting mix of angles, time of day, weather, season. Return ONLY a JSON array of {count} objects {\"label\": 2–5 words, \"prompt\": the edit instruction}. Substantially different options. No prose, no code fences.",
  },

  'concierge.classify.system': {
    agent: 'Concierge',
    label: 'Classify uploaded assets (system)',
    vars: ['{roles}'],
    text: "You are a film's casting & art department sorting the filmmaker's uploaded assets for a short film. For EACH attached image, assign exactly ONE role from: {roles}. Definitions — character: a person, animal or creature that recurs and gets close-ups (face = locked identity); location: an environment / set the scene lives in; prop: a supporting object that recurs. Return ONLY a JSON array — no prose, no code fences — one object PER IMAGE in input order: {\"index\": the 0-based image index, \"role\": one role, \"name\": a 2–4 word label, \"confidence\": a number 0..1}.",
  },
  'concierge.classify.user': {
    agent: 'Concierge',
    label: 'Classify uploaded assets (instruction)',
    vars: ['{idea}', '{roles}', '{count}'],
    text: 'Ad idea: {idea}\n\nThe {count} attached images are the client\'s uploaded assets, in order. Classify each into exactly one of: {roles}. Return the specified JSON array — one entry per image, in the same order.',
  },


  // ---- SHOT card continuity lines (the frame a card carries from the card it continues) ----
  'story.ref.state': {
    agent: 'Shot',
    label: 'Continuity line — a frame used as the state of the place and the people (Seedance 2.5 role line)',
    vars: ['{n}'],
    text: '@Image{n} is used for where each person stands, their pose, clothing and what they hold, and the state of the place and its props; do not use its camera position, framing or composition.',
  },
  'story.ref.open': {
    agent: 'Shot',
    label: 'Continuity line — a frame fixed as the first frame (Seedance 2.5 role line)',
    vars: ['{n}'],
    text: 'Use @Image{n} as the first frame.\nThis first frame defines the composition at the start of the video, subject positions, poses, prop states, scene, and camera direction.',
  },
};

const STORAGE_KEY = 'film-agent-prompt-overrides';

const readOverrides = () => {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const writeOverrides = (obj) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch { /* quota / private mode — non-fatal */ }
};

export const getTemplateText = (id) => {
  const overrides = readOverrides();
  if (typeof overrides[id] === 'string') return overrides[id];
  return DEFAULT_TEMPLATES[id]?.text || '';
};

export const isOverridden = (id) => typeof readOverrides()[id] === 'string';

export const setTemplateText = (id, text) => {
  const overrides = readOverrides();
  overrides[id] = text;
  writeOverrides(overrides);
};

export const resetTemplate = (id) => {
  const overrides = readOverrides();
  delete overrides[id];
  writeOverrides(overrides);
};

export const resetAllTemplates = () => writeOverrides({});

// Fill {placeholders} from vars; collapses the double-spaces left by empty vars
// without touching intentional newlines.
export const renderTemplate = (id, vars = {}) => {
  let text = getTemplateText(id);
  Object.keys(vars).forEach((key) => {
    text = text.split(`{${key}}`).join(vars[key] == null ? '' : String(vars[key]));
  });
  return text.replace(/[ \t]{2,}/g, ' ').trim();
};

// Grouped list for the in-app settings UI. Skips server-only templates (surface:
// 'service') — they belong to the headless Service API, not any canvas agent, so
// editing them here would do nothing.
export const templatesByAgent = () => {
  const groups = {};
  Object.entries(DEFAULT_TEMPLATES).forEach(([id, def]) => {
    if (def.surface === 'service') return;
    if (!groups[def.agent]) groups[def.agent] = [];
    groups[def.agent].push({ id, ...def });
  });
  return groups;
};
