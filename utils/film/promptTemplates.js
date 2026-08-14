// Central registry of every editable prompt template used by the Film Agent
// agents. Defaults live here; user edits are stored as overrides in localStorage
// and applied at render time. Templates use {placeholder} variables that the
// agent run() functions fill at call time.

export const DEFAULT_TEMPLATES = {

  // ---- Storyboard (the plan between casting and filming) ----
  'storyboard.cast.system': {
    agent: 'Cast & World',
    label: 'Draft the production — cast & places (system)',
    vars: [],
    text: `You are a film's pre-production department — casting, location scouting AND props/vehicles. From the film idea, derive the MINIMUM set of REAL, RECURRING assets that must stay visually CONSISTENT across shots: every named character, every key location, every recurring object or vehicle, and any creature/antagonist the film features. Exclude anything seen only once in passing or pure background. Decide the film's ONE visual style FIRST (medium, palette, light, grade, era); every asset shares it.

Pick the RIGHT type for each — do NOT force everything into a frontal portrait:
• "character" — a PERSON or animal that recurs and gets CLOSE-UPS; its face is locked identity. Distinct characters must be visibly DIFFERENT individuals (never reuse one face for two roles). Needs a frontal FACE portrait + a full-body turnaround sheet.
• "creature" — a supernatural, monstrous or ANTAGONIST presence that is NOT meant to be seen as a clean ID photo (obscured, atmospheric, barely glimpsed). Needs ONE "presence" plate: shown IN ITS OWN LIGHT and only PARTIALLY revealed — silhouette / half-lit / wreathed in its element — NEVER a neutral frontal mugshot.
• "location" — an environment / set a scene lives in. ONE establishing plate, no people.
• "prop" — a recurring OBJECT or VEHICLE that must look identical every time it appears (a car / convoy, a weapon, a signature object). ONE clean reference plate, neutral or minimal in-world context, no people.

Return ONLY a JSON object — no prose, no code fences:
{
  "style": "<ONE sentence: the shared visual style — medium, palette, light, grade>",
  "assets": [
    {
      "type": "character",
      "name": "<2–3 word label>",
      "facePrompt": "[MEDIUM] Character reference PORTRAIT, head-and-shoulders, subject FACING CAMERA DIRECTLY — frontal, eyes to lens. [SUBJECT] <age, build, ethnicity or species, distinctive bone structure / markings>. [BACKGROUND] plain neutral seamless studio backdrop (mid-grey), evenly lit — NO scene, NO environment, NO location, NO props. [CAMERA] prime portrait lens, soft frontal key, clean even light, sharp focus on the face. [SKIN_REFLECTANCE] real skin — semi-matte, visible pores and texture, weathering / scars / freckles as fitting; no dewy glow, no frequency separation. [HAIR] <natural, real, a few stray strands>. [EXPRESSION] <calm, in character; eyes to camera, mouth relaxed>. [FORBIDDEN] no background scenery or environment, no scene, no props, no 3/4 turn-away, not looking off-camera; no over-retouched skin, no plastic or porcelain finish, no AI beauty mode, no soft-focus glow, no render — real, photographed.",
      "bodyPrompt": "<full-body CHARACTER TURNAROUND SHEET of the SAME subject in ONE image: TWO full-length views side by side — a FRONTAL view (facing camera) on the left and a SIDE / PROFILE view (90° profile) on the right — both head-to-toe, same neutral standing A-pose, identical wardrobe / coat / markings and identical scale, evenly lit on a plain neutral-grey background. Identity, face, hair, build and costume match the reference EXACTLY across both views; same realism rules — real texture, no AI beauty. No on-image text, labels or watermarks>"
    },
    {
      "type": "creature",
      "name": "<2–3 word label>",
      "presencePrompt": "<the figure IN-WORLD and only PARTIALLY revealed — rendered in its own light, atmosphere, surface and texture; obscured / silhouetted / half-swallowed by shadow or its element. NOT frontal, NOT a neutral background, NOT eyes-to-lens, NOT a clean ID photo. Cinematic, in the FILM'S own tone — menacing, comic, wondrous, whatever the idea dictates. No on-image text.>"
    },
    {
      "type": "location",
      "name": "<2–3 word label>",
      "prompt": "<establishing view of the place, no people, neutral motivated light, no on-image text>"
    },
    {
      "type": "prop",
      "name": "<2–3 word label>",
      "prompt": "<clean reference of the object or vehicle, three-quarter view, on a neutral or minimal in-world ground, even light, no people, no on-image text>"
    }
  ]
}
Up to 8 assets total. Include EVERY recurring subject the film needs — never drop one that matters. If reference images are attached (storyboards, sketches, concept art, photos), DERIVE the assets from what they SHOW — identities, wardrobe, creatures, sets, props — translated faithfully into the film's declared style; for each asset that a specific attached image depicts, add "fromImage": <that image's 1-based index> (omit the field otherwise). Keep the [SECTION] tags in every character facePrompt EXACTLY as shown; they apply to "character" faces ONLY — creatures, locations and props are NOT frontal neutral portraits. For ANIMAL characters, adapt [SKIN_REFLECTANCE] to fur / hide / feather texture and [HAIR] accordingly. Make every asset specific, distinctive and faithful to the idea. NEVER put text, captions or watermarks in any image.`,
  },
  'storyboard.cast.user': {
    agent: 'Cast & World',
    label: 'Draft the production (instruction)',
    vars: ['{idea}', '{ethnicity}', '{refNote}'],
    text: 'Film idea: {idea}\nCharacter ethnicity (apply to every HUMAN character\'s facePrompt/bodyPrompt unless the idea itself dictates otherwise): {ethnicity}\n{refNote}\nDerive the shared visual style FROM the idea (and the reference art, when attached) — never impose a genre or mood the material itself does not state. Return the JSON object: the shared style + the assets — characters (facePrompt + bodyPrompt), any creature (presencePrompt), locations and recurring props/vehicles (prompt).',
  },

  // ---- Story agent: an idea/script → ONE long cinematic prompt (Seed 2.0 Pro rewrite) -
  // No JSON, no key events, no appearances — a direct rewrite to a single continuous
  // cinematic narrative: clear subjects + story arc, structured into shots with explicit
  // CUT markers (kept in the output — they let Deconstruct read the Take's cuts), no
  // characters facing camera, explicit eyelines. The prompt feeds a New Shot.
  'story.prompt.system': {
    agent: 'Story',
    label: 'Rewrite to a cinematic prompt (system)',
    vars: [],
    text: 'Convert the story below into a cinematic narrative with clear subjects and story arc. Structure it into shots separated by explicit CUT markers (e.g. "CUT TO:") and KEEP those markers in the output — but never use the word "cut" in the action wording itself. Don\'t make characters face the camera. Always specify what characters are looking at. Output single long prompt only.',
  },
  'story.prompt.user': {
    agent: 'Story',
    label: 'Rewrite to a cinematic prompt (instruction)',
    vars: ['{story}', '{depth}', '{preserve}'],
    text: '{story}\n\n{depth}\n{preserve}',
  },

  // ---- Split: a brief (or an oversized shot prompt) → sequential SHOT segments, each ----
  // capped at the default video model's max length (maxSec rides in from traits).
  // SEGMENTATION, not rewriting: the model splits the text into shootable pieces and
  // PRESERVES the wording, every detail and any timestamps — never summarizes, never
  // invents. Durations come from timestamp deltas when the text has them, else the
  // model estimates one per segment (clamped 5s–model max in code).
  'split.system': {
    agent: 'Story',
    label: 'Split into shots (system)',
    vars: ['{maxShots}', '{countGoal}'],
    text: 'You are a 1st assistant director preparing VIDEO-GENERATION segments. Split the brief below into the FEWEST possible sequential segments — each segment is ONE 5-{maxSec} second SCENE CHUNK that a video model shoots in a single pass. A segment normally CONTAINS several cuts, camera angles, actions and dialogue lines — NEVER split per camera setup, per action or per line of dialogue; start a new segment only when the running one would exceed {maxSec} seconds (or at a hard scene change). If the brief contains timestamps, cut exactly at the timestamp boundaries and derive each duration from its time span; subdivide a timestamped span only when it exceeds {maxSec} seconds, into as few 5-{maxSec}s pieces as possible. PRESERVE the author\'s wording and every detail inside each segment — do not summarize, do not paraphrase, do not invent content; keep timestamps exactly as written and keep EVERY line of dialogue word-for-word, in quotes, in its original language (never translate or drop a line). If the brief has trailing GLOBAL sections that apply to the whole film (environment, camera flow, aesthetic, audio), do not turn them into segments — carry their relevant lines verbatim into EVERY segment, so each segment stands alone for shooting. {countGoal} At most {maxShots} segments. Return ONLY JSON: {"segments":[{"beat":"3-6 word shot title","text":"the segment content, wording preserved","durationSec":10}]}',
  },
  'split.user': {
    agent: 'Story',
    label: 'Split into shots (brief)',
    vars: ['{brief}'],
    text: '{brief}',
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

  // ---- Previz v2: the blocking agent — floor plan (AD planner) + per-shot projection ---
  // The planner does the director-CoT silently (space → parties → positions → moves →
  // AXIS) and emits the frozen Seedream diagram prompt with only the {slots} filled —
  // it may NOT reword the fixed lines (the style contract is what keeps renders
  // schematic). The projection reads the RENDERED MAP (VLM) — hand-edited maps flow
  // through — and converts top-down positions into camera-relative blocking.
  'previz.plan.system': {
    agent: 'Previz',
    label: 'Floor plan — AD planner (system)',
    vars: [],
    text: 'You are a film director\'s assistant. From a scene brief you plan the scene\'s OVERHEAD BLOCKING and write ONE image-generation prompt that renders a schematic floor-plan diagram of it.\n\nPlan silently, in this order (do not output the plan):\n1. THE SPACE — the single primary place where this scene plays, and its 2-4 load-bearing features (entrances, barriers, goals). Ignore other locations in the brief.\n2. WHO — the parties present. Individuals stay individual; a crowd or unit ("guards", "the family") collapses into ONE group marker. At most 6 markers total.\n3. WHERE — every marker\'s position, always BOUND to a named feature of the space ("at the door", "behind the barricade") — never floating.\n4. MOVES — at most 4 movements that matter to the drama.\n5. AXIS — the axis of action: one straight line between the two opposing sides of the scene\'s central confrontation.\n\nThen output ONLY the finished image prompt: copy the TEMPLATE below EXACTLY, replacing only the {slots}. Never add, remove, or reword any fixed line. No code fences, no commentary, no headings of your own.\n\nTEMPLATE:\nA schematic 2D FLOOR PLAN — strict top-down orthographic technical diagram, flat vector style. Pure white background, thin black line work, simple flat shapes only. NO perspective, NO 3D, NO shading, NO textures, NO photorealism, NO scenery — an architect\'s blocking diagram, not a picture.\n\nThe image contains EXACTLY: {census}. Nothing else. NEVER draw the same marker twice.\n\nTHE SPACE (overhead layout): {space}\n\nCHARACTERS — one solid filled circle per individual, short uppercase label beside it: {characters}\n\nGROUPS AND OBJECTS — one solid filled rectangle per group or large object, short uppercase label beside it: {groups}\n\nMOVEMENT — one thin curved arrow per move: {moves}\n\nAXIS — the single dashed line, bold and straight, labeled AXIS, drawn {axis}.\n\nLabels: very few, short, uppercase, clean sans-serif. No title, no border, no legend box, no compass rose, no watermark.\n\nSlot rules:\n- {census}: the exact count of every element you drew, e.g. "2 filled circles, 2 filled rectangles, 1 dashed line, 3 curved arrows, thin-line walls, 5 short labels".\n- {space}: load-bearing features get strong drawing instructions ("draw the CORRIDOR as two bold parallel walls running left to right"); context gets thin lines. Give every feature a position (left/right/top/bottom).\n- {characters}: assign the fill colors in this exact order: blue, green, yellow, red, purple. Every character bound to a named feature.\n- {groups}: same color sequence continues; a group is ONE rectangle. If there are none, write: none.\n- {moves}: each arrow from a named marker to a named feature.\n- {axis}: "between X and Y" — the two opposing sides.\n- All labels UPPERCASE, 12 characters or fewer.\n- The prompt must be fully self-contained: the image model never sees the brief.',
  },
  'previz.plan.user': {
    agent: 'Previz',
    label: 'Floor plan — planner instruction',
    vars: ['{brief}'],
    text: 'BRIEF (verbatim):\n"""\n{brief}\n"""\nWrite the floor-plan image prompt for this scene.',
  },
  'previz.project.system': {
    agent: 'Previz',
    label: 'Projection — map + moment → Seedance prompt (system)',
    vars: [],
    text: 'You are a film director writing a Seedance 2.0 video-generation prompt for ONE shot.\n\nYou receive: the shot\'s ACTION text (verbatim — the moment this shot covers), an overhead blocking map as [Image 1] (schematic floor plan: colored circles = individuals, colored rectangles = groups, dashed line = the AXIS of action, labels name everyone), optionally a camera position, and optionally a list of photoreal reference images [Image 2], [Image 3], … (cast identity plates, location plates).\n\nPlan silently, in this order (do not output the plan):\n1. READ THE MAP — every marker, its position relative to the named features, and the AXIS.\n2. PLACE THE CAMERA — choose one position on ONE side of the AXIS (stay on that side), at a stated distance and height, covering the ACTION. If a camera position is given, use it.\n3. PROJECT — convert the map\'s positions into what THIS camera sees: who is foreground / mid-ground / background, who is frame-left / frame-right, which way each party faces, where eyelines point. Screen direction must be consistent with the map and the chosen side of the axis.\n4. ACTION — what happens during the clip, taken from the ACTION text\'s own wording. One continuous beat, nothing the text does not say.\n\nThen output ONLY the Seedance prompt, in exactly this structure, one paragraph per line:\n\n[Image 1] is the overhead blocking MAP of this scene — a schematic diagram. Read it only for positions, spacing and directions of the named parties. Nothing in the video may look like it: no diagrams, no lines, no labels, no white schematic style.\n{references} — one clause per remaining image: "[Image N] is <who/what> — exact identity/appearance." Omit this line if there are no other images.\n{scene} — one sentence: the place, time and light, photoreal, cinematic.\n{blocking} — the projected view: camera position and height first, then each party foreground to background with frame side, facing and eyeline, matching the map.\n{action} — the beat of this shot across the clip\'s duration, in the ACTION text\'s own words where possible; bodies and objects move, the event is witnessed, no one plays to camera.\n{camera} — the camera\'s path through the space during the shot, as movement, at whatever tempo the drama demands (e.g. "the camera holds low and pushes toward…" / "the camera whips right to follow…"), never abstract film-grammar terms.\n\nRules: never mention the map after its first line. No character ever looks at the camera. No shot lists, no headings, no quotes, no code fences — output the prompt text only.',
  },
  'previz.project.user': {
    agent: 'Previz',
    label: 'Projection — instruction',
    vars: ['{moment}', '{camera}', '{refsList}'],
    text: 'ACTION (verbatim — the moment this shot covers):\n"""\n{moment}\n"""\nCAMERA: {camera}\nImages attached in order: the blocking map{refsList}\nWrite the Seedance 2.0 prompt.',
  },

  // The Edit-shot editor's STRUCTURE-LOCKED render ("use this frame as reference"):
  // [Image 1] is the CURRENT frame; the instruction slot is sentinel-injected VERBATIM
  // (a one-line change or a full prompt — only what it changes, changes). Cast refs ride
  // as [Image 2..N]. Replaces the cinematic wrapper in edit mode.
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
  'storyboard.quickPage': {
    agent: 'Storyboard',
    label: 'Quick Storyboard — one page straight from the script (no division)',
    vars: ['{panels}', '{style}', '{script}'],
    text: 'ONE storyboard PAGE: a single image containing {panels} numbered panels in a clean grid, read left-to-right, top-to-bottom, telling this script as a visual sequence — choose the {panels} most story-bearing moments yourself:\n"""\n{script}\n"""\nSimple, readable panel compositions with a cohesive look{style}; characters match the attached reference images across every panel. Panel numbers only — no other on-image text, no watermarks.',
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
  'cut.derive.system': {
    agent: 'Shot',
    label: 'Compose step 1 — derive events from keyframes (system)',
    vars: ['{kfCount}', '{durationSec}'],
    text: `You are a cinematographer reading a shot's APPROVED KEYFRAMES — {kfCount} stills attached IN ORDER: Keyframe 1 is the shot's opening composition, each next keyframe is a composition the shot passes through, the last is where it lands. These pictures are the shot's design; you see NOTHING else on purpose.

STUDY what CHANGES from keyframe to keyframe — positions, poses, props, doors, light, weather: that difference IS the shot's performance. Write the shot's EVENTS as one chronological narration walking that exact path: name each figure by a short consistent visual handle (the bearded man, the woman in the red coat), movement speed follows what the keyframe change implies — fast and crisp for action, slow for weight — always CONTINUOUS with natural inertia between keyframes, externalize emotion as visible physical detail. No dialogue (you cannot hear the pictures), no camera directions, no composition-binding lines — events only. The shot runs ~{durationSec}s — pace the events to fill it, no more.

Return ONLY JSON — no prose, no code fences: {"events":"<the shot's chronological events, keyframe to keyframe>"}`,
  },
  'cut.derive.user': {
    agent: 'Shot',
    label: 'Compose step 1 — derive events (instruction)',
    vars: ['{kfCount}'],
    text: 'The {kfCount} attached stills are the keyframes, in shot order. Read them and return the JSON.',
  },
  'cut.enrich.system': {
    agent: 'Shot',
    label: 'Enrich — densify the existing prompt (system)',
    vars: ['{refCount}', '{kfLine}', '{jobLine}', '{cameraLine}', '{formatLine}', '{durationSec}', '{targetWords}'],
    text: `You are a cinematographer EXPANDING an existing video-shot prompt. {refCount} reference images are attached as [Image 1] … [Image {refCount}] — EXACTLY the images, in EXACTLY the order, the video model will receive.

{kfLine}

THE CURRENT TEXT IS THE SKELETON — nothing it says may be lost or reordered: every event in its order, every existing [Image N] tag, and every dialogue line word-for-word in curly braces with its speaker. You ADD precision AROUND that skeleton:
• camera — lens feel, movement quality, how the frame breathes (never a new setup)
• motion — general verbs for the flow; body-part micro-detail (degree, speed, weight, inertia) spent only on the one or two story-bearing beats
• appearance and texture — wardrobe, skin, materials, wear, grounded in what the attached images actually show; address subjects ONLY by their existing [Image N] numbers, never invent a new number
• background and atmosphere — secondary life, weather, haze, dust, light behavior
• VFX where the events imply them, described physically
• sound — weave <sfx> and (music) moments at the right beats; dialogue stays untouched
Everything you add must be FILMABLE and must not contradict the keyframe path. If the skeleton lacks an opening summary, make the FIRST sentence a one-sentence summary — subject + location + event + style + camera.

{jobLine}

{cameraLine}

{formatLine}

The shot runs ~{durationSec}s. Target ≈{targetWords} words — density, never padding; if the skeleton cannot honestly carry that many words, stop sooner.

Do NOT write composition-binding lines, subject definitions, quality/ratio/duration lines or transition markers — the compiler adds those.

Return ONLY JSON — no prose, no code fences: {"action":"<the enriched action text>","audio":"<one sound line in the symbol grammar, or empty>"}`,
  },
  'cut.enrich.user': {
    agent: 'Shot',
    label: 'Enrich — densify the existing prompt (instruction)',
    vars: ['{refRoster}', '{text}'],
    text: 'THE ATTACHED IMAGES, in send order:\n{refRoster}\n\nTHE CURRENT PROMPT (the skeleton — every event, [Image N] tag and dialogue line rides verbatim):\n"""\n{text}\n"""\n\nReturn the JSON.',
  },
  'cut.direct.system': {
    agent: 'Shot',
    label: 'Direct — a note on how the shot feels/reads (system)',
    vars: ['{refCount}', '{kfLine}', '{jobLine}', '{cameraLine}', '{formatLine}', '{durationSec}'],
    text: `You are applying ONE director's note to a video shot's prompt — a note about how the shot FEELS and READS. {refCount} reference images are attached as [Image 1] … [Image {refCount}] — the shot's fixed cast, places and frames; they never change.

{kfLine}

THE CURRENT PROMPT IS THE SHOT: its events, their order, every [Image N] tag and every dialogue line word-for-word in curly braces all stay. You re-shape HOW it feels and reads per the note — tone, pacing, emphasis, atmosphere, wording. Where the note and the current text disagree, the note wins. Never add, drop or renumber an [Image N] tag.

{jobLine}

{cameraLine}

{formatLine}

The shot runs ~{durationSec}s.

Do NOT write composition-binding lines, subject definitions, quality/ratio/duration lines or transition markers — the compiler adds those.

Return ONLY JSON — no prose, no code fences: {"action":"<the re-shaped action text>","audio":"<only if the note touches sound, else empty>"}`,
  },
  'cut.direct.user': {
    agent: 'Shot',
    label: 'Direct — apply the note (instruction)',
    vars: ['{refRoster}', '{text}', '{note}'],
    text: 'THE ATTACHED IMAGES, in send order:\n{refRoster}\n\nTHE CURRENT PROMPT (the shot — events, [Image N] tags and dialogue stay):\n"""\n{text}\n"""\n\nTHE DIRECTOR\'S NOTE (verbatim — it wins where they disagree):\n"""\n{note}\n"""\n\nReturn the JSON.',
  },
  'cut.compose.system': {
    agent: 'Shot',
    label: 'Compose — keyframe-aware cinematic action (system)',
    vars: ['{refCount}', '{kfLine}', '{authorityLine}', '{jobLine}', '{cameraLine}', '{formatLine}', '{durationSec}'],
    text: `You are a cinematographer writing ONE video shot's ACTION text. {refCount} reference images are attached as [Image 1] … [Image {refCount}] — EXACTLY the images, in EXACTLY the order, the video model will receive.

{kfLine}

{authorityLine}

{jobLine}

{cameraLine}

The FIRST sentence of "action" is a ONE-SENTENCE SUMMARY — subject + location + event + style + camera — then the detail. Write the performance in event order, walking the shot along the keyframe path: address every subject by its [Image N] number; movement speed FOLLOWS the action's nature — a strike or impact is fast and crisp, a hesitation or realization is slow — but ALL motion is CONTINUOUS with natural inertia and follow-through (nothing teleports, nothing loops); externalize emotion as visible physical detail; characters never look at the camera. Sound effects in angle brackets <…>, music in parentheses (…). The shot runs ~{durationSec}s — pace the events to fill it, no more.

{formatLine}

Do NOT write composition-binding lines ("opens exactly on…", "Use Image k as a keyframe"), subject definitions ("Define the person in…"), quality/ratio/duration lines or transition markers — the compiler adds all of that around your text; the assembled send is fully guide-compliant.

Return ONLY JSON — no prose, no code fences: {"action":"<the shot's action text>","audio":"<one sound line in the same symbol grammar, or empty>","dropped":["<a text event the keyframes overrode, or omit>"]}`,
  },
  'cut.compose.user': {
    agent: 'Shot',
    label: 'Compose — keyframe-aware cinematic action (instruction)',
    vars: ['{refRoster}', '{text}'],
    text: 'THE ATTACHED IMAGES, in send order:\n{refRoster}\n\nTHE DIRECTOR\'S TEXT:\n"""\n{text}\n"""\n\nReturn the JSON.',
  },
  'deconstruct.describeFrame': {
    agent: 'Take Viewer',
    label: 'Describe one frame (Take Viewer note)',
    vars: [],
    text: 'You are a film director\'s assistant reading ONE still frame ([Image 1]) pulled from a rendered take. Describe it as prompt-ready shot language, present tense, one short line per label:\nSUBJECTS: who/what is in frame — appearance, wardrobe, expression\nBLOCKING: where each subject sits in the frame and what each is looking at (never the camera)\nSETTING: the place, time of day, atmosphere\nCAMERA: framing, angle, approximate lens feel, depth of field\nLIGHT & GRADE: key direction, contrast, palette\nPlain text only — exactly those five labeled lines, no JSON, no commentary.',
  },

  // ---- Storyboard: a conversational SHOT DIVISION (cinematographer brainstorm) ----
  // Each turn returns the FULL updated shot list + a one-line reply. The camera is a
  // shotTemplate id from the library; each shot's `prompt` is the Seedance prompt body.
  // ---- 2-STEP DIVISION (first Divide): CARVE structure+spans, then AUTHOR per shot --
  'storyboard.carve.system': {
    agent: 'Storyboard',
    label: 'Carve — structure + verbatim spans (system)',
    vars: ['{templates}', '{countGoal}', '{refCount}'],
    text: `You are a film DIRECTOR + 1st AD CARVING a script into a SHOT LIST — STRUCTURE ONLY. You do NOT write shot prose here; a second pass authors each shot. Your whole attention goes to carving well.

PLAN FIRST — think through, none of it in the output: (a) what TRANSFORMS across the scene; give every shot ONE job, cut any without one. (b) attention rhythm (poses a new question / raises stakes / withholds / reverses / releases) — never the same operation three times running; place a breath after a reversal. (c) geography — hold one axis, sizes progress with intensity, re-establish wide after an axis or location change. (d) DEVELOP vs HOLD — a shot develops only when its FINAL moment looks different ON SCREEN from its first (externalized, walkable within its duration). (e) at most 4 named subjects per shot.

{countGoal}

{refCount} REFERENCE IMAGES are attached as [Image 1] … [Image {refCount}] ({refCount} may be 0).

For EACH shot return:
• beat — a 2–4 word name.
• job — ONE short line: this shot's single dramatic JOB, what it DOES to the audience (poses the question X / raises the stakes by Y / reverses Z / releases W / reveals V). A shot whose job you cannot state does not belong in the list.
• shotTemplate — the EXACT id of the best-fit camera setup from the LIBRARY:
{templates}
• figures — the reference numbers that APPEAR in this shot (≥1 when references exist; [] when none attached).
• durationSec — 5–{maxSec}.
• intExt — "INT" or "EXT".
• develops — true only per rule (d).
• span — THIS SHOT'S PORTION OF THE SCRIPT, COPIED VERBATIM: the exact characters, dialogue word-for-word, nothing paraphrased, nothing summarized. The spans PARTITION the script IN ORDER — every story-relevant line lands in exactly ONE shot's span, no gaps, no overlaps. Trailing global sections (style / audio notes that apply to the whole film) belong to NO span.

Return ONLY a JSON object — no prose, no code fences:
{"shots":[{"beat":"…","job":"…","shotTemplate":"…","figures":[…],"durationSec":10,"intExt":"EXT","develops":true,"span":"…"}],"reply":"<ONE short line to the director>"}`,
  },
  'storyboard.carve.user': {
    agent: 'Storyboard',
    label: 'Carve (instruction)',
    vars: ['{script}', '{style}'],
    text: 'SCRIPT:\n"""\n{script}\n"""\nStyle / aesthetic: {style}.\n\nCarve it and return the JSON.',
  },
  'storyboard.author.system': {
    agent: 'Storyboard',
    label: 'Author ONE shot from its verbatim span (system)',
    vars: ['{refCount}'],
    text: `You are a film director + cinematographer AUTHORING ONE SHOT of a larger scene. You receive the whole SCRIPT for context, but your shot covers ONLY its SPAN — the script's own words for this moment. The span is the source of truth: carry its wording; EVERY line of dialogue in the span rides word-for-word.

THE SHOT HAS ONE JOB (stated in the instruction). Every sentence you write either advances that job or earns its place some other way — cut anything that serves neither. The job decides what the camera favors, what the performance emphasizes, and what the frame withholds.

Write "motion" as plain event-order prose — NEVER numeric time markers; the sequence of events carries time, and each event's observable outcome makes the order unambiguous.

{refCount} REFERENCE IMAGES are attached as [Image 1] … [Image {refCount}] — address each subject you use explicitly as [Image N].

Return ONLY JSON — no prose, no code fences:
{
 "body": "<the shot's OPENING frame as a Seedream keyframe, 2–5 sentences, in this order: (1) SUBJECT — 'The <subject> in [Image N] is the main subject — keep their exact identity, facial features, body proportions and temperament unchanged' (place/object: 'the exact <place/object> in [Image N]'); pose and gaze matching the reference. (2) SECONDARY subjects via their own [Image K]. (3) ENVIRONMENT — location, set details, time of day. (4) LIGHTING, colour grade, mood. A STILL — no camera verbs, nothing mid-blur, no one looks at camera, no on-image text.>",
 "motion": "<the shot's FULL PERFORMANCE for the video model — as many sentences as the span demands, in event order: body parts with degree and speed, continuous movement at the speed the event demands, transitions between actions (inertia, follow-through), emotion externalized as visible physical detail. Address subjects by the same [Image N] numbers. EVERY dialogue line from the span, word-for-word in curly braces with its speaker named — the man in [Image 3] says in Japanese {…} — original language, never dropped; sound effects in angle brackets <…>; music in parentheses (…). What you leave out does not happen.>",
 "exiting": "<ONLY when the shot DEVELOPS: ONE sentence — the frame's END state as an EDIT of the opening frame, concrete and on-screen. Else empty.>",
 "audio": "<the shot's sound line in the same symbol grammar, or empty>",
 "expression": "<1–3 words for the main subject's expression, or empty>"
}`,
  },
  'storyboard.author.user': {
    agent: 'Storyboard',
    label: 'Author ONE shot (instruction)',
    vars: ['{script}', '{span}', '{beat}', '{job}', '{framing}', '{develops}', '{prevBeat}', '{nextBeat}', '{durationSec}', '{note}', '{retry}'],
    text: 'FULL SCRIPT (context only):\n"""\n{script}\n"""\n\nYOUR SHOT: "{beat}" — camera: {framing}, ~{durationSec}s. It {develops}. ITS ONE JOB: {job}. Previous shot: {prevBeat}. Next shot: {nextBeat}.\n\nYOUR SPAN (the source — carry its wording, all dialogue verbatim):\n"""\n{span}\n"""\n{note}{retry}\nReturn the JSON for THIS shot only.',
  },
  // ---- Storyboard: RE-DERIVE one shot's [Image N] body for a chosen reference set (Expand editor) --
  'storyboard.shot.system': {
    agent: 'Storyboard',
    label: 'Re-derive one keyframe body for its references (system)',
    vars: ['{refCount}'],
    text: `You are a cinematographer writing ONE storyboard keyframe's description. {refCount} reference images are attached as [Image 1] … [Image {refCount}] (the film's cast, props and places). Write the shot's BODY: 2–5 sentences addressing each reference this shot uses explicitly as [Image N], in this order — (1) SUBJECT: "The <subject> in [Image N] is the main subject — keep their exact identity, facial features, body proportions and temperament unchanged" (for a place/object: "the exact <place/object> in [Image N]"); optionally "wearing the wardrobe / colour scheme from [Image M]"; then action / pose and gaze, described to MATCH the reference. (2) SECONDARY subjects via their own [Image K] + what they do. (3) ENVIRONMENT — location, key set details, time of day. (4) LIGHTING, colour grade, mood. Do NOT restate camera / lens / composition. Characters never look at the camera; no on-image text. Return ONLY JSON — no prose, no code fences: {"body":"<the [Image N]-addressed description>","expression":"<1–3 words or empty>"}.`,
  },
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
    label: 'Inspiration (system)',
    vars: ['{count}'],
    text: "You are a film director's concept artist. Given the concept — and any attached reference images, which you should read and creatively synthesise — propose {count} DISTINCT visual directions to generate, varying the strongest creative dimensions (subject treatment, composition, palette, lighting, era, mood, lens). Return ONLY a JSON array of {count} objects {\"label\": a 2–5 word tag, \"prompt\": a complete, self-contained image-generation prompt}. Each prompt must be vivid, concrete and usable on its own; the options must be substantially different from one another. No text, no logos, no watermark. No prose, no code fences.",
  },
  'creativePlanner.characterVariations.system': {
    agent: 'Creative Planner',
    label: 'Character variations (system)',
    vars: ['{count}'],
    text: "You are a character designer. The attached image is the canonical character — it will be EDITED, not re-generated: an image-edit model receives it as [Image 1] and keeps EVERYTHING you do not name. Propose {count} DISTINCT variations as EDIT INSTRUCTIONS. Each \"prompt\" is ONE short instruction naming ONLY what changes — wardrobe, age, expression, lighting, or a re-pose/reframe phrased as 'Reframe to …, the same person' — never a re-description of the character (the image carries identity). Vary what the user asks for; if nothing is specified pick the most interesting dimensions. Return ONLY a JSON array of {count} objects {\"label\": 2–5 words, \"prompt\": the edit instruction}. Substantially different options. No prose, no code fences.",
  },
  'creativePlanner.locationVariations.system': {
    agent: 'Creative Planner',
    label: 'Location variations (system)',
    vars: ['{count}'],
    text: "You are a location scout and DP. The attached image is the canonical location — it will be EDITED, not re-generated: an image-edit model receives it as [Image 1] and keeps EVERYTHING you do not name (architecture, layout, materials, set dressing; no people appear unless named). Propose {count} DISTINCT variations as EDIT INSTRUCTIONS. Each \"prompt\" is ONE short instruction naming ONLY what changes: COVERAGE ('Reframe to a low wide from the opposite end — the same location', 'Reframe to a high aerial — the same location') or STATE ('it is night, heavy rain, the windows lit warm'). Never re-describe the location — the image carries it. Vary what the user asks for; else pick the most interesting mix of angles, time of day, weather, season. Return ONLY a JSON array of {count} objects {\"label\": 2–5 words, \"prompt\": the edit instruction}. Substantially different options. No prose, no code fences.",
  },

  // ---- Director chat router + board classify ----
  'concierge.route.system': {
    agent: 'Director',
    label: 'Director Assistant — route a message to an agent, or answer it (system)',
    vars: ['{actions}'],
    text: 'You are the user\'s FILM DIRECTOR — a creative assistant for THIS short-film project. Handle ONE chat message: either route it to exactly ONE action, or — when it is a question or asks for advice — answer it yourself. Available actions: {actions}. Rules: when the message ASKS something (a question, a "which/what/how/why", a request for advice), pick "answer" and put the answer in "say" — 1 to 4 plain sentences, IN CHARACTER as their director, about THIS film, the craft, or the next step, grounded in the studio context provided. If the message is OFF-TOPIC or general-knowledge (not about this film or filmmaking), still pick "answer" but keep it to ONE sentence that politely steers them back to the film — do NOT answer general trivia at length. When the message ASKS FOR WORK, pick the one action that does it, and extract the user\'s own wording into the fields VERBATIM — never rewrite or embellish their words. Pick "unknown" only when nothing fits and it isn\'t answerable. Return ONLY a JSON object — no prose, no code fences: {"action": one id, "beat": for filmChunk — ONE vivid sentence of what happens on screen, "prompt": for inspiration / story / storyboard / castDraft — the user\'s premise, description or pasted script, VERBATIM in their words (when the message contains one; a bare command like "continue" or "draft the cast" leaves it empty), "direction": for characterVariations/locationVariations — what to vary, in their words, "note": for correctChunk — the critique as a retake note, "say": for "answer" the answer itself; for actions ONE short plain sentence proposing it back, e.g. "I\'ll make 4 night versions of your downtown street." Plain language; name actual things; never the words "hero" or "star".}',
  },
  'concierge.route.user': {
    agent: 'Director',
    label: 'Director Assistant — route a message (instruction)',
    vars: ['{context}', '{message}'],
    text: 'Studio context: {context}\n\nThe user says: {message}\n\nRoute it (or answer it) as the specified JSON object.',
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
