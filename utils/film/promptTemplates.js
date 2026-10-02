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

  // ---- Previz: plan a PAGE OF PLATES -> promote any plate to a SHOT card -------------
  // Previz plates are DRAWINGS, which is what a text-to-image model is actually good at:
  // a pencil panel has no 3D scene to be consistent with, and panels are ALLOWED to look
  // different from each other — that is the medium. What carries between them is the
  // pencil convention, not a camera. Three kinds: an overhead map, character plates,
  // and the storyboard panels themselves.
  'previz.plan.system': {
    agent: 'Previz',
    label: 'Previz plan — the plate page (system)',
    vars: [],
    text: `You are a storyboard artist and 1st AD preparing PREVIZ for a scene. Previz decides STAGING, GEOGRAPHY, EYELINES, COVERAGE and TIMING — never final look. Your output is a PAGE OF PLATES: drawings a director reads before a frame is shot.

Plan silently, then output. Fix the scene first: the one place it happens and the features that define it; every subject the description actually names, whatever kind of thing each one is (individuals stay individual, a crowd collapses to one group); where each stands, bound to a named feature; which way each one FACES; and the ACTION AXIS, the line between the two principal subjects that every camera stays on one side of.

Then choose the plates. Three kinds:
  "map" — ONE overhead floor plan of the whole setup with every camera position marked. Include one whenever the scene has geography worth locking: more than one subject, or movement through space.
  "character" — one plate per PRINCIPAL subject, alone on the page. At most 4.
  "board" — one storyboard panel per SHOT, in cut order. The bulk of the page.

COVERAGE — how you choose the board panels. Be a director, not a camera operator:
  - Open on the widest shot that makes the geography legible, and return to a wide whenever the geography changes.
  - Play the scene from BOTH sides of the axis: a single on one subject is answered by the reverse on the other. A scene of two parties shot entirely from one bearing is a failure.
  - Vary SIZE deliberately. Go tight for what the story turns on — a face, a hand, an object — and only there. Never go tight while the audience still needs to know where everyone is.
  - Cover REACTION, not only action. The shot of someone watching is usually the shot that makes the moment land.
  - As few panels as the scene truly needs and no fewer — usually 6 to 12.

Every board panel shows ONLY the subjects you listed, and never a person unless a person is one of them. A busy or populated setting invites the artist to add figures nobody asked for — write each panel so there is nothing for them to fill in.

DRAWING each plate. The artist is an image model with NO 3D scene and no memory between plates, so "4m north of the subject, 0.8m height, tight single" draws nothing at all. Write every "draw" as WHAT THE FINISHED DRAWING SHOWS: which subject sits where in the frame (left / centre / right, high / low), how big each one is (fills the frame, half the frame height, a small figure in the distance), which way each faces and where it looks, what is in the foreground and what is behind, and where the horizon or eye level falls. State camera height only as what it does to the picture — "seen from below, the horizon low behind them", never a measurement. Name subjects by the name you gave them so the same one recurs across plates.

Return ONLY JSON — no prose, no code fences:
{"scene":"<2-3 sentences: the space and its features, in drawable terms>","axis":"<one sentence: the action axis named against two fixed features, and which side the cameras stay on>","subjects":[{"name":"<short name, reused on every plate>","description":"<what this subject IS — its KIND first and exactly, in the description's own words. Never assume a person, and never substitute a nearby kind for the one that was named. Then appearance; clothing only if it is a person.>"}],"look":"<one sentence: the photoreal look of the finished scene — place, time of day, light, atmosphere, in the description's own words. Rides to the SHOT card, never drawn on a plate.>","plates":[{"kind":"map","title":"<3-6 words>","draw":"<what the overhead plan shows: the set pieces and their positions seen from above, each subject's marker and which way it faces, and every camera position with the direction it points. Describe placement — there are no labels to read.>"},{"kind":"character","title":"<the subject's name>","draw":"<the figure alone: kind, build, stance, coat or clothing, markings, anything carried>"},{"kind":"board","title":"<3-6 words>","draw":"<what this panel shows, by the drawing rule above>","caption":"<one line: what happens in this shot — the words that go under the panel>","camera":"<the shot in film terms: size, angle, and any move. Rides to the SHOT card.>","motion":"<what happens during this shot, present tense, in the description's own words>"}]}

At most 16 plates.`,
  },
  'previz.plan.user': {
    agent: 'Previz',
    label: 'Previz plan — instruction',
    vars: ['{brief}', '{camera}'],
    text: 'SCENE DESCRIPTION (verbatim):\n"""\n{brief}\n"""\nCAMERA: {camera}\n\nPlan the plates and return the JSON.',
  },

  // The three plate conventions. Frozen: every board panel must come off the same pencil,
  // or the page stops reading as one document. No lettering anywhere — an image model
  // garbles text, and the captions and legends live on the panel UI instead.
  'previz.plate.board': {
    agent: 'Previz',
    label: 'Plate — storyboard panel (pencil)',
    vars: ['{draw}', '{marks}', '{cast}', '{refs}'],
    text: 'A single hand-drawn STORYBOARD PANEL in graphite pencil on off-white paper. Black and white only, no colour anywhere. Loose confident contour lines, light cross-hatching for shadow, unfinished sketch quality — figures are simplified, but their pose, scale, screen position and eyeline read exactly. Each subject keeps the real silhouette, stance and proportions of whatever it actually is, drawn the way that thing is really shaped — never a human form substituted for something that is not a person, and never a shape borrowed from a different kind of thing. The drawing fills the whole image edge to edge: no paper border, no frame line, no panel number, no lettering, no caption, no watermark.{marks}{cast}{refs}\n\nTHE PANEL SHOWS: {draw}',
  },
  // THE BLOCKOUT LAYER — the same panel as a VFX pass: flat colour masses, no identity,
  // no look. A stronger Seedance reference than a drawing, because subject separation and
  // screen direction are unambiguous and nothing about the finished look is imposed. The
  // colour order matches previz.mask, so a blockout and a masked frame read the same way.
  'previz.plate.blockout': {
    agent: 'Previz',
    label: 'Plate — VFX blockout layer (colour blocks)',
    vars: ['{draw}', '{marks}', '{cast}', '{refs}'],
    text: 'A VFX BLOCKOUT LAYER render — a matte ID pass. EVERY element in the frame is one flat solid colour with a hard clean edge: no texture, no pattern, no shading, no gradient, no highlight, no outline and no detail anywhere in the image.\n\nThe SUBJECTS are featureless coloured masses — no face, no hair, no clothing, no features. Each mass keeps the real silhouette, stance and proportions of whatever that subject actually is — never a human form substituted for something that is not a person, and never a shape borrowed from a different kind of thing. Each mass carries a small raised WEDGE on the front of its head showing which way it faces, so eyelines and screen direction read.\n\nThe ENVIRONMENT is blocked the same way, each part its own flat colour: the GROUND is flat warm mid-grey, the SKY or far backdrop is flat pale blue-grey, and every piece of set geometry — whatever the space actually contains — is flat slate grey held as a simple shape. No foliage detail, no bark, no grass, no clouds, no set dressing. Flat even light, no cast shadows beyond a soft contact shadow, no atmosphere, no haze, no depth of field. No text, no lettering, no watermark.{marks}{cast}{refs}\n\nTHE FRAME SHOWS: {draw}',
  },

  'previz.plate.map': {
    agent: 'Previz',
    label: 'Plate — overhead staging map (pencil)',
    vars: ['{draw}'],
    text: 'An OVERHEAD FLOOR PLAN of a film set, hand-drawn in graphite pencil on off-white paper — the same hand as the storyboard panels. Black and white only, no colour. Straight top-down view, no perspective, drawn with loose confident ruled-feeling lines and light hatching where a surface needs to read. Everything in the space that is not a subject is drawn as its own shape seen from directly above. Each subject is a filled dark shape matching its real footprint seen from above, with a smaller mark on one end to show which way it faces. Each camera position is a small filled camera shape with two light dotted lines opening from its lens to show the field of view. A simple segmented scale bar lies along the bottom edge. Uncluttered and diagrammatic. No lettering, no labels, no numbers, no watermark.\n\n{draw}',
  },

  // The map in blockout form: the same plan seen as a top-down matte ID pass, so the
  // page reads as one document and the colours mean the same thing from above as they
  // do in the panels.
  'previz.plate.mapBlockout': {
    agent: 'Previz',
    label: 'Plate — top-down location view (colour blocked)',
    vars: ['{draw}', '{cast}'],
    text: 'A VFX BLOCKOUT LAYER render — a matte ID pass seen from DIRECTLY ABOVE, looking straight down at the location. Orthographic top-down view, no perspective. EVERY element is one flat solid colour with a hard clean edge: no texture, no pattern, no shading, no gradient, no highlight, no outline and no detail anywhere in the image.\n\nThe GROUND is flat warm mid-grey covering the whole frame. Every piece of set geometry — whatever the space actually contains — is a flat slate grey shape seen from above. Each subject is a coloured mass seen from above, keeping its real footprint, with a small wedge on one end showing which way it faces. Each camera position is a small flat dark marker with two thin lines opening from it to show the field of view. A simple segmented scale bar lies along the bottom edge.\n\nNo foliage detail, no bark, no grass, no set dressing, no lettering, no labels, no numbers, no watermark.{cast}\n\nTHE PLAN SHOWS: {draw}',
  },
  // The character plate in blockout form: the SHAPE KEY for the page. It shows which
  // colour a subject is and what silhouette that colour will hold, which is exactly what
  // a colour-blocked page needs a character plate FOR — identity is not the point here.
  'previz.plate.characterBlockout': {
    agent: 'Previz',
    label: 'Plate — blockout shape key (one coloured mass)',
    vars: ['{draw}', '{color}'],
    text: 'A VFX BLOCKOUT LAYER render — a matte ID pass of ONE subject alone. The subject is a single featureless mass filled entirely with flat solid {color}, hard clean edge, no texture, no pattern, no shading, no gradient, no highlight, no outline, no face, no hair, no clothing and no features of any kind. It keeps the real silhouette, stance and proportions of whatever it actually is, in whatever view reads its form best. A small raised WEDGE on the front of its head shows which way it faces. It stands alone on a flat plain light-grey background with a soft contact shadow under it and nothing else in the frame. Flat even light, no atmosphere, no depth of field, no text, no lettering, no watermark.\n\nTHE SUBJECT IS: {draw}',
  },

  'previz.plate.character': {
    agent: 'Previz',
    label: 'Plate — character sheet (pencil)',
    vars: ['{draw}'],
    text: 'A CHARACTER PLATE from a film production storyboard, drawn in graphite pencil on off-white paper. Black and white only, no colour. Loose confident contour lines with light cross-hatching for shadow. ONE subject alone on an otherwise blank page, whole body in frame with clear white space around it, standing in a neutral three-quarter stance turned slightly toward the viewer. It is drawn the way that kind of thing is really shaped, in whatever view reads its form best — three-quarter where that shows the most. No background, no scenery, no other subject, no ground shadow beyond a light contact shadow, no lettering, no caption, no watermark.\n\n{draw}',
  },

  // THE CLAY RENDER — the third convention, and the only one that shows LIGHT. Pencil
  // implies lighting, the blockout deliberately kills it; a grey clay maquette render is
  // where a previz department actually blocks the key, the shadows and the falloff. It
  // stays inside the charter because it decides light as STRUCTURE — direction, quality,
  // what is in shadow — and never as colour grade, texture or finish.
  'previz.plate.clay': {
    agent: 'Previz',
    label: 'Plate — 3D clay render (lighting block)',
    vars: ['{draw}', '{marks}', '{cast}', '{refs}', '{light}'],
    text: 'A 3D PREVIZ CLAY RENDER: an untextured grey maquette of the scene, rendered like a physical clay model photographed on a modelmaker bench. Every surface is the SAME matte grey clay — no colour, no texture, no pattern, no material detail, no set dressing. Subjects are featureless clay figures with no face, no hair and no clothing, each keeping the real silhouette, stance and proportions of whatever it actually is — never a human form substituted for something that is not a person. Each figure carries a small raised WEDGE on the front of its head showing which way it faces.\n\nLIGHTING IS THE POINT OF THIS RENDER and must read unmistakably: one clear key with a stated direction, visible falloff across the clay, hard-edged cast shadows on the ground and across the forms, soft fill holding the shadow side open, and rim separation where a figure would otherwise merge with what is behind it. Ambient occlusion darkens the contact points and the creases. Depth reads through light, not through haze.{light}{marks}{cast}{refs}\n\nTHE FRAME SHOWS: {draw}',
  },
  'previz.plate.clayCharacter': {
    agent: 'Previz',
    label: 'Plate — clay figure study (lighting on one subject)',
    vars: ['{draw}'],
    text: 'A 3D PREVIZ CLAY RENDER of ONE subject alone: an untextured matte grey clay maquette, no face, no hair, no clothing, no texture and no colour, keeping the real silhouette, stance and proportions of whatever it actually is, in whatever view reads its form best. A small raised WEDGE on the front of its head shows which way it faces. It stands alone on a plain grey clay ground with nothing else in the frame.\n\nLight it to show FORM: one clear key from the upper front-left with visible falloff, a soft fill opening the shadow side, a rim from behind separating it from the background, a grounded cast shadow, and ambient occlusion in the creases and at the contact points. No text, no lettering, no watermark.\n\nTHE SUBJECT IS: {draw}',
  },
  'previz.plate.clayMap': {
    agent: 'Previz',
    label: 'Plate — clay set from above (lighting plan)',
    vars: ['{draw}', '{light}'],
    text: 'A 3D PREVIZ CLAY RENDER seen from DIRECTLY ABOVE, looking straight down at the set: an untextured matte grey clay maquette of the whole location, every surface the same grey clay, no colour, no texture, no set dressing. Set geometry — whatever the space actually contains — is modelled as simple clay volumes. Each subject is a featureless clay figure seen from above keeping its real footprint, with a small wedge on one end showing which way it faces. Each camera position is a small clay camera form with two thin lines opening from it to show the field of view.\n\nLIGHT THE SET so the plan reads: one clear key with a stated direction throwing long hard cast shadows across the ground, so every figure and every set piece lays a shadow that says where the light comes from. Soft fill, ambient occlusion at the contact points.{light}\n\nNo lettering, no labels, no numbers, no watermark.\n\nTHE PLAN SHOWS: {draw}',
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
  'storyboard.quickPage': {
    agent: 'Storyboard',
    label: 'Quick Storyboard — one page straight from the script (no division)',
    vars: ['{panels}', '{style}', '{script}'],
    text: 'ONE storyboard PAGE: a single image containing {panels} numbered panels in a clean grid, read left-to-right, top-to-bottom, telling this script as a visual sequence — choose the {panels} most story-bearing moments yourself:\n"""\n{script}\n"""\nSimple, readable panel compositions with a cohesive look{style}; characters match the attached reference images across every panel. Panel numbers only — no other on-image text, no watermarks.',
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
  'cut.derive.system': {
    agent: 'Shot',
    label: 'Compose step 1 — derive events from keyframes (system)',
    vars: ['{kfCount}'],
    text: `You are a cinematographer reading a shot's APPROVED KEYFRAMES — {kfCount} stills attached IN ORDER: Keyframe 1 is the shot's opening composition, each next keyframe is a composition the shot passes through, the last is where it lands. These pictures are the shot's design; you see NOTHING else on purpose.

STUDY what CHANGES from keyframe to keyframe — positions, poses, props, doors, light, weather: that difference IS the shot's performance. Write the shot's EVENTS as one chronological narration walking that exact path: name each figure by a short consistent visual handle (the bearded man, the woman in the red coat), movement speed follows what the keyframe change implies — fast and crisp for action, slow for weight — always CONTINUOUS with natural inertia between keyframes. No dialogue (you cannot hear the pictures), no camera directions, no composition-binding lines — events only. Every action runs at REAL-WORLD SPEED: a strike lands in under a second, a fall takes about one.

Return ONLY JSON — no prose, no code fences: {"events":"<the shot's chronological events, keyframe to keyframe>"}`,
  },
  'cut.derive.user': {
    agent: 'Shot',
    label: 'Compose step 1 — derive events (instruction)',
    vars: ['{kfCount}'],
    text: 'The {kfCount} attached stills are the keyframes, in shot order. Read them and return the JSON.',
  },
  'cut.edit.system': {
    agent: 'Shot',
    label: 'Edit — the FINAL editing prompt sent to the video model (system)',
    vars: ['{refCount}', '{masterLine}', '{skill}'],
    text: `You are writing THE FINAL PROMPT for a video EDITING task. What you return is sent VERBATIM — nothing is appended, wrapped or renumbered afterwards.

THE SPEC BELOW IS THE METHOD. Everything above it is FACT about this particular edit.

{masterLine}

{refCount} target images are attached. Cite them as @image1 … @image{refCount} — EXACTLY the images, in EXACTLY that order. NEVER cite a number outside 1–{refCount}, and never cite an image when none is attached.

THE PROMPT MUST READ AS AN INSTRUCTION TO CHANGE @video1. Name the source, the operation and the target for every change. A prompt that only describes a finished result does not route as an edit — it becomes a new generation, and the source is lost.

Everything the instruction does not name stays as it is in the source. Say so explicitly when a change could reasonably spread.

Aspect ratio, duration and resolution are inherited or set as parameters — never write them into the prompt.

{skill}

Return ONLY JSON — no prose, no code fences: {"action":"<the complete final editing prompt>","audio":""}`,
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
  'edit.analyze.system': {
    agent: 'Shot',
    label: 'Edit — analyze the source video (system)',
    vars: [],
    text: `You are describing a shot for an editor. The attached video is the whole clip.

Describe only what the video shows. Never guess at anything it does not show.

Cover, in this order:
The setting and the light — where it is, time of day if it is visible, where the light comes from and its colour.
Every subject that appears — what each one is, what it looks like, where it sits in the frame, and at what times it is visible.
What happens — the action in order, with times.
The camera — the framing, and any movement, with times.

Give times in seconds from the start of the clip. The description is plain text for a person to read: short paragraphs, no headings, no bullet symbols. If part of the shot cannot be read clearly from the video, end the description with one line that begins "Unclear:" and says what.

Also list every subject the description names, and every distinct part of the setting it names. Each entry's name is the exact short phrase the description itself uses for that thing, so the two always match. Its visible field gives the times it is on screen.

Return ONLY JSON — no prose outside it, no code fences:
{"description":"<the description>","subjects":[{"name":"<the phrase the description uses>","visible":"<times on screen, in seconds>"}]}`,
  },
  'edit.analyze.user': {
    agent: 'Shot',
    label: 'Edit — analyze the source video (length)',
    vars: ['{length}'],
    text: 'THE CLIP is {length} long.\n\nDescribe the shot and return the JSON.',
  },
  'cut.direct.system': {
    agent: 'Shot',
    label: 'Direct — a note on how the shot is filmed and feels (system)',
    vars: ['{refCount}', '{kfLine}', '{jobLine}', '{cameraLine}', '{skill}'],
    text: `You are applying ONE director's note to a video shot's prompt — a note about how the shot is FILMED and how it FEELS. {refCount} reference images are attached as image 1 … image {refCount} — the shot's fixed cast, places and frames; they never change.

{kfLine}

THE CURRENT PROMPT IS THE SHOT: its events, their order, every image citation and every dialogue line word-for-word in curly braces all stay. You re-shape HOW it is filmed and how it feels per the note — camera, lens and depth, light, movement, tone, pacing, emphasis, atmosphere, wording. Where the note and the current text disagree, the note wins. Never add, drop or renumber an image citation.

{jobLine}

{cameraLine}

{skill}

THE CURRENT PROMPT IS THE FINAL PROMPT — it ships to the model verbatim, and nothing is added around it. Whatever structure it already carries (its blocks, its reference-role sentences, its subject definitions, its closing constraints) STAYS; you re-shape tone and wording inside that structure, you do not strip it and you do not rebuild it.

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
    label: 'Compose — the FINAL prompt sent to the video model (system)',
    vars: ['{refCount}', '{kfLine}', '{authorityLine}', '{jobLine}', '{cameraLine}', '{lookLine}', '{skill}'],
    text: `You are writing THE FINAL PROMPT for a video model. What you return is sent VERBATIM — nothing is appended, wrapped, renumbered or cleaned up afterwards. If you leave it out, it does not reach the model.

THE SPEC BELOW IS THE METHOD. Everything above it is FACT about this particular shot — what is attached, what is locked, what the material is. Facts do not override the spec; they are its input.

{refCount} reference images are attached as image 1 … image {refCount} — EXACTLY the images, in EXACTLY the order, the model will receive. NEVER cite a number outside 1–{refCount}, never renumber them, and never assume an image you were not given.

{kfLine}

{authorityLine}

{jobLine}

{cameraLine}

{lookLine}

{skill}

Return ONLY JSON — no prose, no code fences: {"action":"<the complete final prompt>","audio":""}`,
  },
  'cut.compose.user': {
    agent: 'Shot',
    label: 'Compose — keyframe-aware cinematic action (instruction)',
    vars: ['{refRoster}', '{text}'],
    text: 'THE ATTACHED IMAGES, in send order:\n{refRoster}\n\nTHE DIRECTOR\'S TEXT:\n"""\n{text}\n"""\n\nReturn the JSON.',
  },
  'scout.survey': {
    agent: 'Tech Scout',
    label: 'Empty-location survey (video prompt)',
    vars: ['{path}'],
    text: 'The empty location from the first frame. {path} The location stays completely empty: no people or animals appear at any moment. Nothing moves except the camera and the small natural motion already in the scene.',
  },
  'scout.path.turn': {
    agent: 'Tech Scout',
    label: 'Survey path: turn in place',
    vars: [],
    text: 'The camera stands in one spot at eye level and slowly pans to the right through a full 360-degree turn, ending where it started.',
  },
  'scout.path.walk': {
    agent: 'Tech Scout',
    label: 'Survey path: walk-in',
    vars: [],
    text: 'The camera, at eye level on a smooth gimbal, walks slowly forward through the space along its main open path.',
  },
  'scout.emptyCheck': {
    agent: 'Tech Scout',
    label: 'Background frame: people check (grounding)',
    vars: [],
    text: 'List every person or animal visible anywhere in this image, including tiny, distant, partial or silhouetted ones, each as {"what": "...", "bbox": "<bbox>x1 y1 x2 y2</bbox>"}. Return a JSON list; return [] if there are none.',
  },
  'deconstruct.describeFrame': {
    agent: 'Take Viewer',
    label: 'Describe one frame (Take Viewer note)',
    vars: [],
    text: 'You are a film director\'s assistant reading ONE still frame ([Image 1]) pulled from a rendered take. Describe it as prompt-ready shot language, present tense, one short line per label:\nSUBJECTS: who/what is in frame — appearance, wardrobe, expression\nBLOCKING: where each subject sits in the frame and what each is looking at (never the camera)\nSETTING: the place, time of day, atmosphere\nCAMERA: framing, angle, approximate lens feel, depth of field\nLIGHT & GRADE: key direction, contrast, palette\nPlain text only — exactly those five labeled lines, no JSON, no commentary.',
  },

  // ---- Storyboard NORMALIZE: brief → SCREENPLAY (film's canonical IR) -------------
  // The division's front-end: any input (idea/brief/prose/drama text) converts to
  // screenplay format — sluglines carry scene structure, action lines carry the event
  // sequence, CAPS-on-introduction carries the entity breakdown, dialogue rides
  // verbatim. EXTRACTIVE ONLY: unstated slug fields say UNSTATED, never a default.
  // Input that already parses as a screenplay passes through verbatim (zero calls).
  'storyboard.normalize.system': {
    agent: 'Storyboard',
    label: 'Normalize — brief → screenplay (system)',
    vars: [],
    text: `FORMAT:
• SCENE HEADINGS — one per scene, numbered: "1. EXT. LOCATION - TIME" (INT., EXT., or INT./EXT.). A field the source does not state is written UNSTATED — never guessed, never defaulted (e.g. "2. EXT. UNSTATED - UNSTATED"). Scene boundaries follow the source's own location and time changes; placing them is your only licensed judgment.
• ACTION LINES — present tense, the source's wording carried (compress connective prose; never paraphrase what can ride as written; an internal thought becomes only the visible expression the text itself gives it). One observable event per paragraph. CAPITALIZE a character's name, a key prop, and a distinct sound the FIRST time each appears. A prop changing hands is its own action line naming the transfer.
• DIALOGUE — the speaker's NAME on its own line, the spoken words below it VERBATIM in the original language; a parenthetical only when the source states the delivery. Never invent, complete or translate a line.

Subjects keep the source's own names (a bare "person" stays that neutral term). Numbers and timestamps the author wrote stay exactly as written. A thin brief yields a THIN script — one sparse scene is an honest result; never pad, never expand.

Return ONLY the screenplay text — no preamble, no commentary, no code fences, no JSON.`,
  },
  'storyboard.normalize.user': {
    agent: 'Storyboard',
    label: 'Normalize (instruction)',
    vars: ['{script}'],
    text: '"""\n{script}\n"""\nReturn only text',
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

PLAN FIRST — think through, none of it in the output: (a) what TRANSFORMS across the scene; give every shot ONE job, cut any without one. (b) attention rhythm (poses a new question / raises stakes / withholds / reverses / releases) — never the same operation three times running; place a breath after a reversal. (c) geography — hold one axis, sizes progress with intensity, re-establish wide after an axis or location change. (d) at most 4 named subjects per shot.

The script's SCENE HEADINGS (numbered INT./EXT. sluglines) are HARD boundaries: a shot NEVER spans two scenes; the geography rules apply WITHIN a scene and every new scene re-establishes; each slug's location and time ground the shot, and an UNSTATED slug field stays undecided — never invent it.

{countGoal}

{refCount} REFERENCE IMAGES are attached as [Image 1] … [Image {refCount}] ({refCount} may be 0).

For EACH shot return:
• beat — a 2–4 word name.
• job — ONE short line: what this shot's actor is up against and what they are trying to do. A shot whose job you cannot state does not belong in the list.
• shotTemplate — the EXACT id of the best-fit camera setup from the LIBRARY:
{templates}
• figures — the reference numbers that APPEAR in this shot (≥1 when references exist; [] when none attached).
• intExt — "INT" or "EXT".
• scene — the 1-based number of the SCENE HEADING this shot falls under (1 when the script has no headings).
• span — THIS SHOT'S PORTION OF THE SCRIPT, COPIED VERBATIM: the exact characters, dialogue word-for-word, nothing paraphrased, nothing summarized. The spans PARTITION the script IN ORDER — every story-relevant line lands in exactly ONE shot's span, no gaps, no overlaps. Scene headings and trailing global sections (style / audio notes that apply to the whole film) belong to NO span.

Return ONLY a JSON object — no prose, no code fences:
{"shots":[{"beat":"…","job":"…","shotTemplate":"…","figures":[…],"intExt":"EXT","scene":1,"span":"…"}],"reply":"<ONE short line to the director>"}`,
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
 "body": "<the shot's OPENING frame as a Seedream keyframe, 2–5 sentences. THE FRAME CATCHES THE SITUATION ALREADY UNDER WAY — not the instant before it starts: weight already shifted, eyeline already committed, hands already where the action has put them, and whatever the subject is up against already present in frame. Never a lineup, never a neutral standing pose. In this order: (1) SUBJECT — 'The <subject> in [Image N] is the main subject — keep their exact identity, facial features, body proportions and temperament unchanged' (place/object: 'the exact <place/object> in [Image N]'); the reference gives IDENTITY ONLY — the POSE comes from this shot's situation and never from the reference's own pose. (2) SECONDARY subjects via their own [Image K], each doing what the situation has them doing. (3) ENVIRONMENT — location, set details, time of day. (4) LIGHTING, colour grade, mood. A single sharp FRAME — no camera verbs, nothing mid-blur, no one looks at camera, no on-image text.>",
 "motion": "<the shot's SITUATION for the video model, in event order — who is there, in what condition, what each is trying to do, and what happens as a result. The model simulates the world and derives the physical detail, so state the situation and the observable outcome; do NOT write a body-part script and do NOT instruct individual features (say a subject is cornered and means it, never that its hackles lift — a feature instruction renders literally). Every action at real-world speed; as many sentences as the span needs and NO more. Address subjects by the same [Image N] numbers. EVERY dialogue line from the span, word-for-word in curly braces with its speaker named — the man in [Image 3] says in Japanese {…} — original language, never dropped; sound effects in angle brackets <…>; music in parentheses (…). What you leave out does not happen.>",
 "audio": "<the shot's sound line in the same symbol grammar, or empty>",
 "expression": "<1–3 words for the main subject's expression, or empty>"
}`,
  },
  'storyboard.author.user': {
    agent: 'Storyboard',
    label: 'Author ONE shot (instruction)',
    vars: ['{script}', '{span}', '{beat}', '{job}', '{framing}', '{prevBeat}', '{nextBeat}', '{settingLine}', '{note}', '{retry}'],
    text: 'FULL SCRIPT (context only):\n"""\n{script}\n"""\n\nYOUR SHOT: "{beat}" — camera: {framing}. ITS ONE JOB: {job}. Previous shot: {prevBeat}. Next shot: {nextBeat}.\n{settingLine}\nYOUR SPAN (the source — carry its wording, all dialogue verbatim):\n"""\n{span}\n"""\n{note}{retry}\nReturn the JSON for THIS shot only.',
  },
  // ---- Storyboard: RE-DERIVE one shot's [Image N] body for a chosen reference set (Expand editor) --
  'storyboard.shot.system': {
    agent: 'Storyboard',
    label: 'Re-derive one keyframe body for its references (system)',
    vars: ['{refCount}'],
    text: `You are a cinematographer writing ONE storyboard keyframe's description. {refCount} reference images are attached as [Image 1] … [Image {refCount}] (the film's cast, props and places). Write the shot's BODY: 2–5 sentences addressing each reference this shot uses explicitly as [Image N], in this order — (1) SUBJECT: "The <subject> in [Image N] is the main subject — keep their exact identity, facial features, body proportions and temperament unchanged" (for a place/object: "the exact <place/object> in [Image N]"); optionally "wearing the wardrobe / colour scheme from [Image M]"; then the pose and gaze THIS SHOT'S SITUATION puts them in — the frame catches the action already under way (weight shifted, eyeline committed), never a neutral standing pose, and never the reference's own pose: the reference gives identity only. (2) SECONDARY subjects via their own [Image K] + what the situation has them doing. (3) ENVIRONMENT — location, key set details, time of day. (4) LIGHTING, colour grade, mood. Do NOT restate camera / lens / composition. Characters never look at the camera; no on-image text. Return ONLY JSON — no prose, no code fences: {"body":"<the [Image N]-addressed description>","expression":"<1–3 words or empty>"}.`,
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


  // ---- Story Room: idea → blueprint (the story-builder skill) → critique → patch ----
  // The skill rides whole as {skill}; user text is sentinel-injected VERBATIM by
  // utils/film/core/story.js. Every block is word-capped and the cap is code-checked.
  'story.scout.axes': {
    agent: 'Story Room',
    label: 'Scout — the axes it deals ideas from (one item per line under each heading)',
    vars: [],
    text: `SITUATIONS
a debt that cannot be repaid in money
a rescue that needs a betrayal
two rivals who must depend on each other
an inheritance that comes with a condition
a lie told to protect someone, now coming due
a return home after a long absence
an obsession that is costing everything
a case of mistaken identity
a vow that collides with love
an ambition that requires a crime
a stranger who unsettles a closed community
enemies who must survive a disaster together
a secret that would free one person and ruin another
a contest whose prize is worth more than winning
a child forced to take a parent's place
a pursuit across a border
a gift that turns into a burden
a rule obeyed long past the point of sense
a discovery nobody wants to be true
a reunion that reopens an old wrong
REGISTERS
comedy
romance
crime
thriller
tragedy
satire
coming of age
mystery
farce
melodrama
OPPOSITION
someone who loves the protagonist
a rival with a better claim
an institution doing its job correctly
the protagonist's own community
a force of nature
a machine or system that cannot be argued with
a family member
a charming liar
a child
the protagonist's younger self, in letters, recordings or memory`,
  },
  'story.scout.system': {
    agent: 'Story Room',
    label: 'Scout — find ideas from life (system)',
    vars: [],
    text: 'You are a story scout. You find dramas in real life, not in cinema: the stories people tell each other in markets, on night shifts, at border posts, in kitchens, on ships, in research stations and in settlements on other worlds. Every idea you return is built on the ASSIGNMENT it is given (a dramatic situation, a register and a kind of opposition) and set in a real, specific place or community with its own customs, trades and stakes. No famous plots, no genre formulas, nothing that sounds like a pitch for an existing film or series. Each idea has a person at its centre and something that has just gone wrong in their life.',
  },
  'story.scout.user': {
    agent: 'Story Room',
    label: 'Scout — find ideas (instruction)',
    vars: ['{count}', '{direction}', '{assignments}'],
    text: 'Come up with {count} ORIGINAL story ideas, one per assignment below, in the same order.\n\nDIRECTION FROM THE FILMMAKER (follow it; when it is empty, roam freely):\n{direction}\n\nASSIGNMENTS:\n{assignments}\n\nEvery idea comes from a different place, community or world. Return ONLY a JSON array of {count} objects:\n[{"title": "2-5 words", "logline": "2-3 sentences: who, what just happened, what is at stake", "place_and_culture": "the specific place, community or world", "what_is_unexpected": "one sentence"}]',
  },
  'story.probe.system': {
    agent: 'Story Room',
    label: 'Originality probe (system)',
    vars: [],
    text: 'You are a development executive checking story ideas for originality before anyone develops them. For EACH idea, name the closest existing film, book or series and the premise shape it shares: the dramatic situation in one line (for example "small community vs corporation over land"), never the setting. Score it: 2 = no known work shares the premise shape; 1 = a known work shares the premise shape even if the setting is new; 0 = essentially the same story. Be strict: a new setting on a familiar premise is a 1.\nReturn ONLY a JSON array, one object per idea, in order: [{"closest_work": "Title (year)", "shared_premise": "...", "score": 0, "note": "one sentence: what would make it fresh"}]',
  },
  'story.probe.user': {
    agent: 'Story Room',
    label: 'Originality probe (instruction)',
    vars: ['{ideas}'],
    text: 'THE IDEAS:\n{ideas}',
  },
  'story.architect.system': {
    agent: 'Story Room',
    label: 'Architect — idea to blueprint (system)',
    vars: ['{skill}', '{cap}', '{spineCap}'],
    text: '{skill}\n\nYOU ARE THE ARCHITECT. Run Steps 1-4 of the story-builder workflow on the idea internally: map it into the blocks, derive the missing blocks in dependency order (flaw -> internal need -> inciting incident -> external want -> antagonist -> journey -> crisis -> climax -> resolution), write the spine, then stress-test and fix. Keep everything the idea states; invent only what it leaves out.\nLENGTH: every block at most {cap} words; each journey obstacle at most {cap} words; the spine is ONE sentence of at most {spineCap} words.\nReturn ONLY the final blueprint as JSON, no prose:\n{"title": "2-5 words", "protagonist": "...", "flaw": "...", "internal_need": "...", "inciting_incident": "...", "external_want": "...", "antagonist": "...", "journey": ["3-5 escalating obstacles"], "crisis": "...", "climax": "...", "resolution": "...", "spine": "Once upon a time, ..."}',
  },
  'story.architect.user': {
    agent: 'Story Room',
    label: 'Architect — idea to blueprint (instruction)',
    vars: ['{idea}'],
    text: 'THE IDEA:\n{idea}',
  },
  'story.critic.system': {
    agent: 'Story Room',
    label: 'Critic — objection-first stress test (system)',
    vars: ['{skill}'],
    text: `{skill}

YOU ARE A HARSH DEVELOPMENT EDITOR scoring one story blueprint against the stress test. Most professional blueprints earn 1 on most items; a 2 is rare.
For EVERY item give "objection" (in one sentence, the strongest push-back a development executive would raise; there is always one) and "score": 2 = the blueprint already answers the objection, nothing to fix; 1 = it works but the objection partly stands; 0 = broken, missing or contradicted.
q1 Could you film the want? 2 = a single visible goal with a finish line a camera can see.
q2 Does chasing the want force the protagonist to face the need? 2 = the want can only be won by facing the need.
q3 Is the antagonist strong enough that the outcome is in doubt? 2 = a specific force with its own logic that beats the protagonist's flaw.
q4 Does each journey obstacle raise the stakes over the last? 2 = every step costs more than the one before and closes an option.
q5 Is the crisis a real choice with a real cost? 2 = two goods or two evils, each costing something the audience cares about.
q6 Does the protagonist cause the climax? 2 = their choice and new behaviour decide it.
q7 Does the resolution show change? 2 = a concrete new behaviour that mirrors the opening flaw.
originality: name the closest existing film, book or series and the premise shape it shares. 2 = no known work shares the premise shape; 1 = a known work shares it even if the setting is new; 0 = essentially the same story.
specificity: 2 = the culture, trade or place is load-bearing (the crisis or climax could not happen anywhere else); 1 = concrete detail, but the plot would survive a change of setting; 0 = generic dressing.
Then "fix": for every item below 2, the ONE block whose rewrite would answer it, with the note the rewrite must answer. Block names: protagonist, flaw, internal_need, inciting_incident, external_want, antagonist, journey, crisis, climax, resolution. One note per block; merge notes that land on the same block.
Return ONLY JSON: {"q1": {"objection": "...", "score": 0}, ..., "q7": {...}, "originality": {"closest_work": "...", "shared_premise": "...", "objection": "...", "score": 0}, "specificity": {"objection": "...", "score": 0}, "fix": {"<block>": "<the note to answer>"}}`,
  },
  'story.critic.user': {
    agent: 'Story Room',
    label: 'Critic (instruction)',
    vars: ['{blueprint}'],
    text: 'THE BLUEPRINT:\n{blueprint}',
  },
  'story.reviser.system': {
    agent: 'Story Room',
    label: 'Reviser — patch the flagged blocks (system)',
    vars: ['{skill}', '{cap}', '{spineCap}'],
    text: '{skill}\n\nYOU ARE THE REVISER. You get a story blueprint and the editor\'s notes on the blocks to rewrite. Rewrite ONLY those blocks, each so it answers its note and still fits every block you were not given to change. Each rewritten block is at most {cap} words ("journey" stays a list of 3-5 obstacles, each at most {cap} words). If the rewrites change the story\'s spine, also return "spine": ONE sentence starting "Once upon a time", at most {spineCap} words.\nReturn ONLY a JSON object whose keys are exactly the blocks you rewrote (plus "spine" when it changed): {"<block>": "..."}',
  },
  'story.reviser.user': {
    agent: 'Story Room',
    label: 'Reviser (instruction)',
    vars: ['{blueprint}', '{notes}'],
    text: 'THE BLUEPRINT:\n{blueprint}\n\nTHE EDITOR\'S NOTES (rewrite these blocks only):\n{notes}',
  },
  'story.facts.system': {
    agent: 'Story Room',
    label: 'Visual beat sheet — what the viewer must see or hear (system)',
    vars: ['{skill}'],
    text: `{skill}

YOU ARE THE SCRIPT SUPERVISOR. Turn the story blueprint into its VISUAL BEAT SHEET: the facts a viewer must SEE or HEAR on screen to follow the whole story. A film has no access to thoughts, so every block, the interior ones included, is translated into observable evidence:
- flaw: a behaviour we watch in the opening;
- external want: the visible goal (an object, a place, a person to reach);
- antagonist: its presence, or an act we see it commit;
- inciting incident, each journey obstacle, crisis, climax: what happens on screen; the crisis is a choice we watch being made;
- resolution: the behaviour that mirrors the opening flaw, changed (or tragically unchanged);
- internal need: shown only through that change, never stated.
Each fact is ONE observable thing in one sentence: who does what, where, with what. A spoken line counts as heard; give its words in quotes. Never write what anyone thinks, feels, realizes or decides unless the same sentence names the action that shows it.
Every block gets at least one fact; tag each fact with the ONE block it serves. Keep the blueprint's names, places and objects. List the facts in story order.
Return ONLY JSON: [{"block": "protagonist|flaw|internal_need|inciting_incident|external_want|antagonist|journey|crisis|climax|resolution", "kind": "see|hear", "fact": "..."}]`,
  },
  'story.facts.user': {
    agent: 'Story Room',
    label: 'Visual beat sheet (instruction)',
    vars: ['{blueprint}'],
    text: 'THE BLUEPRINT:\n{blueprint}',
  },
  'story.shots.system': {
    agent: 'Story Room',
    label: 'Shot plan — which shot shows which facts (system)',
    vars: [],
    text: `YOU ARE THE DIRECTOR planning a story's shots for Seedance 2.5 from its VISUAL BEAT SHEET. Each shot is ONE generation: one place, one continuous moment, at most 30 seconds. Decide how many shots the story needs: a beat gets as many shots as its facts need, and one shot may show several facts that share a place and moment. Every fact is shown by at least one shot, and the shots run in story order.
Also write the cast sheet: one look line per recurring character (age, build, face, hair, wardrobe), so every shot can describe them with the same words.
Return ONLY JSON: {"cast": [{"name": "...", "look": "..."}], "shots": [{"title": "2-5 words", "location": "the place", "moment": "one sentence: what happens in this shot", "shows": ["F1"]}]}`,
  },
  'story.shots.user': {
    agent: 'Story Room',
    label: 'Shot plan (instruction)',
    vars: ['{blueprint}', '{facts}'],
    text: 'THE BLUEPRINT:\n{blueprint}\n\nTHE VISUAL BEAT SHEET (every fact must be shown):\n{facts}',
  },
  'story.shot.system': {
    agent: 'Story Room',
    label: 'Shot prompt — one Seedance 2.5 prompt (system)',
    vars: ['{skill}'],
    text: `{skill}

YOU ARE THE DIRECTOR writing ONE shot of a story as a Seedance 2.5 prompt, following the spec above. The shot is one generation: one place, one continuous moment, at most 30 seconds. It must visibly or audibly show every fact listed for it. Describe each character with the cast sheet's look words. Duration, aspect ratio and resolution are request parameters, never prompt text.
Return ONLY the prompt text — no title, no notes, no JSON.`,
  },
  'story.shot.user': {
    agent: 'Story Room',
    label: 'Shot prompt (instruction)',
    vars: ['{story}', '{cast}', '{shot}', '{facts}', '{neighbours}', '{retry}'],
    text: 'THE STORY:\n{story}\n\nTHE CAST SHEET:\n{cast}\n\nTHIS SHOT:\n{shot}\n\nFACTS THIS SHOT MUST SHOW:\n{facts}\n\nAROUND IT:\n{neighbours}{retry}',
  },
  'story.verify.system': {
    agent: 'Story Room',
    label: 'Verify — prove each shot shows its facts (system)',
    vars: [],
    text: 'You are a script supervisor checking Seedance shot prompts against the story\'s visual beat sheet. For every shot and every fact it claims, copy the EXACT words from that shot\'s prompt that make the fact visible or audible on screen: one verbatim phrase of at most 30 words, copied character for character. If the prompt does not show the fact (it is missing, only implied, or only stated as a thought), return an empty quote. Never paraphrase, never join separate phrases.\nReturn ONLY JSON: [{"shot": 1, "fact": "F3", "quote": "..."}]',
  },
  'story.verify.user': {
    agent: 'Story Room',
    label: 'Verify (instruction)',
    vars: ['{facts}', '{shots}'],
    text: 'THE FACTS:\n{facts}\n\nTHE SHOTS:\n{shots}',
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
