// Recipes — the agentic answer to "what's the best recipe for use case XYZ?". A
// recipe maps a use case → the bible roles it needs, the shot grammar (by duration),
// the cinematic look packages, and which bible roles each shot pulls. Pure data +
// helpers; no network, no React. The Concierge picks a recipe, builds the bible from
// the user's assets, asks for gaps, then produces the film from this structure.

// ---- bible roles (the Short Film's cast & world) ---------------------------------
// The bible IS the board: a tagged image node carries data.bibleRole. These are the
// roles the user tags assets into (or Cast & World auto-tags), and that every shot
// pulls its references from. character + location are the load-bearing pair (Cast &
// World produces them, the pipeline gates on them); prop is an optional tag.
export const BIBLE_ROLES = ['character', 'location', 'prop', 'frame'];

export const BIBLE_ROLE_META = {
  character: { label: 'Character', kind: 'image', hint: 'a character — person, animal or creature (face = locked identity)' },
  location: { label: 'Location', kind: 'image', hint: 'the set / environment the scene lives in' },
  prop: { label: 'Prop', kind: 'image', hint: 'a supporting object that recurs in the film' },
  frame: { label: 'Frame', kind: 'image', hint: 'a still frame — e.g. a key frame the Deconstruct agent pulls from a take; reuse it as a visual reference' },
};

// ---- camera-move templates (ONE list for the whole suite) -------------------------
// The Animate panel, the CUT cards and the Filming Loop's correct-aspects row all
// offer the SAME camera vocabulary — a template set, not free text. 'auto' = let the
// video model decide (suppresses the "Camera move:" line in the Seedance prompt).
export const CAMERA_MOVES = [
  'auto', 'static lock-off', 'slow push-in', 'slow pull-back', 'gentle parallax drift',
  'pan left', 'pan right', 'tilt up', 'tilt down', 'handheld follow', 'dolly in',
  'slow orbit', 'crane up', 'macro push-in', 'whip pan',
];

// ---- Seedance 2.0 prompt grammar (the CUT card's composed output) ----------------
// Cinematography presets — a small genre-keyed library for the CINEMATOGRAPHY pin.
// Each is lens · DOF · light · grain · grade · movement; the user picks one (or edits).
export const CINEMATOGRAPHY_PRESETS = {
  Naturalistic: '50mm, moderate DOF, soft motivated daylight, fine grain, neutral true-to-life grade, steady handheld',
  Western: '40mm anamorphic, deep focus, hard golden-hour side light, heavy 16mm grain, desaturated dust grade, slow deliberate moves',
  Horror: '35mm, shallow focus, low-key underlight, fine grain, cold desaturated grade, uneasy handheld',
  Noir: '32mm, deep focus, hard low-key chiaroscuro, fine grain, high-contrast monochrome-leaning grade, slow creeping dolly',
  Thriller: '50mm, shallow DOF, tense low-key key light, minimal grain, cool steely grade, tight push-ins',
  Epic: '28mm, deep focus, sweeping natural light, clean grain, rich saturated grade, slow majestic crane moves',
  Documentary: '35mm, deep focus, available light, light grain, flat neutral grade, reactive handheld',
  Dreamlike: '85mm, very shallow DOF, diffuse bloomed light, soft grain, pastel lifted grade, slow drifting float',
};
export const CINEMATOGRAPHY_PRESET_NAMES = Object.keys(CINEMATOGRAPHY_PRESETS);

// Best-fit preset for a detected genre line (free text) — keyword match, else Naturalistic.
export const cinematographyForGenre = (genre = '') => {
  const g = String(genre).toLowerCase();
  const hit = CINEMATOGRAPHY_PRESET_NAMES.find((name) => g.includes(name.toLowerCase()))
    || (/(western)/.test(g) ? 'Western' : /(horror|slasher|creature)/.test(g) ? 'Horror'
      : /(noir|detective|crime)/.test(g) ? 'Noir' : /(thriller|suspense)/.test(g) ? 'Thriller'
      : /(epic|fantasy|myth|saga)/.test(g) ? 'Epic' : /(doc|vérité|verite|realis|natural)/.test(g) ? 'Documentary'
      : /(dream|surreal|ethereal)/.test(g) ? 'Dreamlike' : 'Naturalistic');
  return CINEMATOGRAPHY_PRESETS[hit];
};

// ---- the 50-shot cinematography library (the Shot agent's vocabulary) -------------
// 50 distinct shot templates — angle · framing · move · a complete standalone
// cinematography line. The Storyboard (Shot) agent SELECTS one per shot by id; the
// locked genre only BIASES which it picks (the line is genre-neutral so it layers
// over any genre's cast plates). `cinematography` drops straight into the SHOT card's
// CINEMATOGRAPHY pin. Grouped into Scale (10) · Angle (10) · Movement (15) · Composition (8) ·
// Specialty (7).
export const SHOT_TEMPLATES = [
  // --- Scale (10): how much of the subject/world the frame holds ---
  { id: 'extreme-wide-vista', name: 'Extreme Wide / Vista', category: 'Scale', framing: 'extreme wide shot', angle: 'eye-level', move: 'static lock-off', cinematography: '18mm, deep focus, expansive natural light, fine grain, static lock-off', desc: 'Vast establishing vista; the subject tiny in a huge environment.' },
  { id: 'wide-establish', name: 'Wide Establisher', category: 'Scale', framing: 'wide shot', angle: 'eye-level', move: 'static lock-off', cinematography: '24mm, deep focus, even natural light, fine grain, static lock-off', desc: 'Establishes the geography of a space; subject small in frame.' },
  { id: 'full-shot', name: 'Full Shot', category: 'Scale', framing: 'wide shot', angle: 'eye-level', move: 'static lock-off', cinematography: '35mm, deep focus, soft daylight, fine grain, static lock-off', desc: 'Head-to-toe figure with the surrounding context.' },
  { id: 'cowboy-medium-wide', name: 'Medium-Wide (Cowboy)', category: 'Scale', framing: 'medium shot', angle: 'eye-level', move: 'slow push-in', cinematography: '40mm, moderate DOF, motivated daylight, fine grain, slow push-in', desc: 'Mid-thigh up; body language plus some environment.' },
  { id: 'medium-shot', name: 'Medium Shot', category: 'Scale', framing: 'medium shot', angle: 'eye-level', move: 'static lock-off', cinematography: '50mm, moderate DOF, soft key light, fine grain, static lock-off', desc: 'Waist-up; the conversational workhorse shot.' },
  { id: 'medium-close-up', name: 'Medium Close-Up', category: 'Scale', framing: 'medium close-up', angle: 'eye-level', move: 'slow push-in', cinematography: '65mm, shallow DOF, soft key light, fine grain, slow push-in', desc: 'Chest-up; intimacy with a little context.' },
  { id: 'close-up', name: 'Close-Up', category: 'Scale', framing: 'close-up', angle: 'eye-level', move: 'slow push-in', cinematography: '85mm, shallow DOF, soft motivated key, fine grain, slow push-in', desc: 'Face fills the frame; emotion reads clearly.' },
  { id: 'big-close-up', name: 'Big Close-Up', category: 'Scale', framing: 'close-up', angle: 'eye-level', move: 'macro push-in', cinematography: '100mm, very shallow DOF, soft directional key, fine grain, micro push-in', desc: 'Tight from brow to chin; raw, intense emotion.' },
  { id: 'extreme-close-up', name: 'Extreme Close-Up', category: 'Scale', framing: 'extreme close-up', angle: 'eye-level', move: 'macro push-in', cinematography: '100mm macro, razor-shallow DOF, soft key, fine grain, micro push-in', desc: 'Eyes, mouth or a single feature filling the frame.' },
  { id: 'insert-detail', name: 'Insert / Detail', category: 'Scale', framing: 'detail / insert shot', angle: 'high-angle', move: 'static lock-off', cinematography: '60mm macro, shallow DOF, even soft light, fine grain, locked-off', desc: 'An object or hands — a key story detail in isolation.' },
  // --- Angle (10): where the camera sits relative to the subject ---
  { id: 'eye-level-neutral', name: 'Eye-Level Neutral', category: 'Angle', framing: 'medium shot', angle: 'eye-level', move: 'static lock-off', cinematography: '50mm, moderate DOF, neutral daylight, fine grain, static lock-off', desc: "At the subject's eye line; objective and neutral." },
  { id: 'low-angle-hero', name: 'Low-Angle Hero', category: 'Angle', framing: 'medium shot', angle: 'low angle looking up', move: 'slow push-in', cinematography: '35mm, moderate DOF, low angle looking up, hard motivated key, slow push-in', desc: 'Camera below eye-line — makes the subject powerful, dominant.' },
  { id: 'high-angle', name: 'High-Angle', category: 'Angle', framing: 'medium shot', angle: 'high angle looking down', move: 'slow push-in', cinematography: '40mm, moderate DOF, high angle looking down, soft top light, slow push-in', desc: 'Camera above looking down — diminishes, isolates the subject.' },
  { id: 'overhead-topdown', name: "Overhead / God's-Eye", category: 'Angle', framing: 'overhead shot', angle: 'top-down', move: 'slow pull-back', cinematography: '35mm, deep focus, top-down bird\'s-eye, flat even light, slow descent', desc: 'Straight down from above; geometric, god\'s-eye view.' },
  { id: 'dutch-canted', name: 'Dutch / Canted', category: 'Angle', framing: 'medium shot', angle: 'canted (dutch tilt)', move: 'slow push-in', cinematography: '32mm, moderate DOF, canted horizon, hard key, fine grain, creeping push-in', desc: 'Tilted horizon — unease, disorientation, tension.' },
  { id: 'worms-eye', name: "Worm's-Eye", category: 'Angle', framing: 'wide shot', angle: 'extreme low ground angle', move: 'tilt up', cinematography: '24mm, deep focus, extreme low ground angle, sky backlight, tilt up', desc: 'From the ground looking steeply up; towering, monumental.' },
  { id: 'birds-eye-aerial', name: "Bird's-Eye Aerial", category: 'Angle', framing: 'extreme wide shot', angle: 'high aerial', move: 'crane up', cinematography: '28mm, deep focus, high aerial, natural light, slow crane up', desc: 'High aerial descent or rise over the scene.' },
  { id: 'profile-lateral', name: 'Profile / Lateral', category: 'Angle', framing: 'medium shot', angle: 'side profile', move: 'lateral tracking', cinematography: '50mm, shallow DOF, side profile, rim light, lateral tracking', desc: 'Pure side-on profile; graphic, observational.' },
  { id: 'three-quarter', name: 'Three-Quarter', category: 'Angle', framing: 'medium close-up', angle: 'three-quarter front', move: 'slow push-in', cinematography: '65mm, shallow DOF, three-quarter angle, soft key with fill, slow push-in', desc: 'Classic 3/4 face angle; flattering and dimensional.' },
  { id: 'ground-level', name: 'Ground-Level', category: 'Angle', framing: 'wide shot', angle: 'ground level', move: 'static lock-off', cinematography: '28mm, deep focus, ground level, motivated low light, locked-off', desc: 'Lens at the dirt; feet, terrain, looming foreground.' },
  // --- Movement (15): what the camera does during the shot ---
  { id: 'static-lockoff', name: 'Static Lock-Off', category: 'Movement', framing: 'medium shot', angle: 'eye-level', move: 'static lock-off', cinematography: '50mm, moderate DOF, steady motivated light, fine grain, static lock-off', desc: 'Completely still frame; lets the action play.' },
  { id: 'slow-push-in', name: 'Slow Push-In', category: 'Movement', framing: 'medium close-up', angle: 'eye-level', move: 'slow push-in', cinematography: '65mm, shallow DOF, soft key, fine grain, slow push-in (dolly)', desc: 'Gradual move toward the subject; rising intensity.' },
  { id: 'slow-pull-back', name: 'Slow Pull-Back', category: 'Movement', framing: 'medium shot', angle: 'eye-level', move: 'slow pull-back', cinematography: '40mm, moderate DOF, even light, fine grain, slow pull-back (dolly out)', desc: 'Reverse dolly revealing context; release, loneliness.' },
  { id: 'dolly-track-follow', name: 'Tracking Follow', category: 'Movement', framing: 'medium shot', angle: 'eye-level', move: 'lateral tracking follow', cinematography: '40mm, moderate DOF, motivated daylight, fine grain, lateral tracking follow', desc: 'Camera travels alongside a moving subject.' },
  { id: 'lateral-truck', name: 'Lateral Truck', category: 'Movement', framing: 'wide shot', angle: 'eye-level', move: 'truck sideways', cinematography: '35mm, deep focus, even light, fine grain, smooth lateral truck', desc: 'Sideways slide across a static scene; reveals breadth.' },
  { id: 'crane-up', name: 'Crane Up', category: 'Movement', framing: 'wide shot', angle: 'rising', move: 'crane up', cinematography: '28mm, deep focus, sweeping natural light, clean grain, slow crane up', desc: 'Boom rising for scale and grandeur.' },
  { id: 'crane-down', name: 'Crane Down', category: 'Movement', framing: 'medium shot', angle: 'descending', move: 'crane down', cinematography: '35mm, moderate DOF, soft light, fine grain, slow crane down', desc: 'Boom descending into the scene; arrival, intimacy.' },
  { id: 'jib-reveal', name: 'Jib Reveal', category: 'Movement', framing: 'wide shot', angle: 'rising over foreground', move: 'jib up and over', cinematography: '28mm, deep focus, natural light, clean grain, jib up over foreground', desc: 'Rises over a foreground element to reveal the scene.' },
  { id: 'arc-orbit', name: 'Arc / Orbit', category: 'Movement', framing: 'medium shot', angle: 'orbiting', move: 'slow orbit', cinematography: '50mm, shallow DOF, rim-lit, fine grain, slow orbit around the subject', desc: 'Camera arcs around the subject; dimensional emphasis.' },
  { id: 'full-360-orbit', name: 'Full 360 Orbit', category: 'Movement', framing: 'medium close-up', angle: 'orbiting', move: 'full 360 orbit', cinematography: '50mm, shallow DOF, motivated key, fine grain, continuous 360° orbit', desc: 'Complete revolution around the subject; a bravura beat.' },
  { id: 'handheld-follow', name: 'Handheld Follow', category: 'Movement', framing: 'medium shot', angle: 'eye-level', move: 'handheld follow', cinematography: '35mm, moderate DOF, available light, fine grain, reactive handheld follow', desc: 'Loose handheld trailing the subject; immediacy, vérité.' },
  { id: 'steadicam-glide', name: 'Steadicam Glide', category: 'Movement', framing: 'medium shot', angle: 'eye-level', move: 'steadicam glide', cinematography: '32mm, moderate DOF, motivated light, fine grain, floating steadicam glide', desc: 'Smooth floating move through space; immersive.' },
  { id: 'whip-pan', name: 'Whip Pan', category: 'Movement', framing: 'medium shot', angle: 'eye-level', move: 'whip pan', cinematography: '35mm, moderate DOF, hard light, fine grain, fast whip pan', desc: 'Violent fast pan; energy, a transition or a reveal.' },
  { id: 'snap-zoom', name: 'Snap Zoom', category: 'Movement', framing: 'medium close-up', angle: 'eye-level', move: 'snap zoom in', cinematography: '24-70mm, moderate DOF, hard light, fine grain, fast snap zoom', desc: 'Sudden punch-in zoom; aggression, emphasis.' },
  { id: 'parallax-drift', name: 'Parallax Drift', category: 'Movement', framing: 'wide shot', angle: 'eye-level', move: 'gentle parallax drift', cinematography: '35mm, deep focus, soft light, fine grain, gentle parallax drift', desc: 'Subtle lateral drift with foreground/background separation.' },
  // --- Composition (8): how subjects are arranged in the frame ---
  { id: 'two-shot', name: 'Two-Shot', category: 'Composition', framing: 'two-shot', angle: 'eye-level', move: 'static lock-off', cinematography: '40mm, moderate DOF, balanced soft key, fine grain, static lock-off', desc: 'Two subjects framed together; relationship, dialogue.' },
  { id: 'ots-dialogue', name: 'Over-the-Shoulder', category: 'Composition', framing: 'over-the-shoulder shot', angle: 'eye-level', move: 'subtle settle', cinematography: '85mm, shallow DOF, soft key on the far face, fine grain, subtle settle', desc: "Past one shoulder onto another's face; conversation." },
  { id: 'single-isolated', name: 'Single / Isolated', category: 'Composition', framing: 'medium close-up', angle: 'eye-level', move: 'slow push-in', cinematography: '85mm, very shallow DOF, soft key, fine grain, slow push-in', desc: 'One subject isolated by shallow focus; solitude, focus.' },
  { id: 'ensemble-group', name: 'Ensemble / Group', category: 'Composition', framing: 'wide shot', angle: 'eye-level', move: 'slow pull-back', cinematography: '28mm, deep focus, even light, fine grain, slow pull-back', desc: 'Several subjects arranged in the frame; the group.' },
  { id: 'symmetrical-center', name: 'Symmetrical Centered', category: 'Composition', framing: 'medium shot', angle: 'eye-level, dead-center', move: 'slow push-in', cinematography: '40mm, deep focus, balanced light, fine grain, slow centered push-in', desc: 'Perfectly symmetrical, centered framing; control, formality.' },
  { id: 'frame-within-frame', name: 'Frame-Within-Frame', category: 'Composition', framing: 'medium shot', angle: 'eye-level', move: 'slow push-in', cinematography: '50mm, moderate DOF, motivated light, fine grain, slow push-in', desc: 'Subject framed by a doorway or window; entrapment, voyeurism.' },
  { id: 'foreground-occlusion', name: 'Foreground Occlusion', category: 'Composition', framing: 'medium shot', angle: 'eye-level', move: 'gentle parallax drift', cinematography: '50mm, shallow DOF, soft light, fine grain, gentle drift behind foreground', desc: 'Shot through an out-of-focus foreground; depth, intimacy.' },
  { id: 'deep-focus-tableau', name: 'Deep-Focus Tableau', category: 'Composition', framing: 'wide shot', angle: 'eye-level', move: 'static lock-off', cinematography: '24mm, deep focus, even light, fine grain, static lock-off', desc: 'Everything sharp front-to-back; staged in layers.' },
  // --- Specialty (7): optical / lighting / temporal signatures ---
  { id: 'shallow-isolation', name: 'Shallow-Focus Isolation', category: 'Specialty', framing: 'close-up', angle: 'eye-level', move: 'slow push-in', cinematography: '135mm, razor-shallow DOF, soft key, creamy bokeh, slow push-in', desc: 'Extreme background blur isolating the subject.' },
  { id: 'rack-focus-pull', name: 'Rack Focus', category: 'Specialty', framing: 'medium shot', angle: 'eye-level', move: 'rack focus', cinematography: '85mm, shallow DOF, soft light, fine grain, rack focus between planes', desc: 'Focus shifts between foreground and background; redirects attention.' },
  { id: 'silhouette-backlit', name: 'Silhouette / Backlit', category: 'Specialty', framing: 'medium shot', angle: 'eye-level', move: 'slow push-in', cinematography: '50mm, moderate DOF, hard backlight, haze, fine grain, slow push-in', desc: 'Subject as a dark shape against bright light; mystery, drama.' },
  { id: 'golden-hour-wide', name: 'Golden-Hour Wide', category: 'Specialty', framing: 'wide shot', angle: 'eye-level', move: 'slow pull-back', cinematography: '35mm, deep focus, low golden-hour backlight, warm grade, fine grain, slow pull-back', desc: 'Warm low-sun wide; romance, nostalgia, the magic hour.' },
  { id: 'macro-texture', name: 'Macro Texture', category: 'Specialty', framing: 'extreme close-up', angle: 'top-down', move: 'macro push-in', cinematography: '100mm macro, razor-shallow DOF, raking light, fine grain, slow macro push-in', desc: 'Tactile surface detail; texture as story.' },
  { id: 'slow-motion-detail', name: 'Slow-Motion Detail', category: 'Specialty', framing: 'close-up', angle: 'eye-level', move: 'slow push-in', cinematography: '85mm, shallow DOF, crisp directional light, fine grain, high-speed slow motion', desc: 'A fleeting action stretched in slow motion; weight, beauty.' },
  { id: 'pov-subjective', name: 'POV / Subjective', category: 'Specialty', framing: 'POV shot', angle: 'first-person eye-level', move: 'handheld', cinematography: '28mm, moderate DOF, available light, fine grain, subjective handheld', desc: "First-person point of view; we see what the subject sees." },
];

export const SHOT_TEMPLATE_CATEGORIES = ['Scale', 'Angle', 'Movement', 'Composition', 'Specialty'];
export const SHOT_TEMPLATE_BY_ID = SHOT_TEMPLATES.reduce((m, t) => { m[t.id] = t; return m; }, {});
// Grouped for the SHOT card's CINEMATOGRAPHY dropdown (Select.OptGroup per category).
export const SHOT_TEMPLATES_BY_CATEGORY = SHOT_TEMPLATE_CATEGORIES.map((category) => ({ category, templates: SHOT_TEMPLATES.filter((t) => t.category === category) }));
// The catalog the Shot agent reads to choose: `id — name (category): desc`, one per line.
export const shotTemplateCatalog = () => SHOT_TEMPLATES.map((t) => `${t.id} — ${t.name} (${t.category}): ${t.desc}`).join('\n');
// The cinematography line for a chosen template id; falls back to the genre preset
// when the id is missing/invalid (headless default, or an un-gated project).
export const shotTemplateCinematography = (id, genre = '') => (SHOT_TEMPLATE_BY_ID[id] && SHOT_TEMPLATE_BY_ID[id].cinematography) || cinematographyForGenre(genre);

// ---- the story-arc library (the Story agent's structural vocabulary) -------------
// The structural analogue of SHOT_TEMPLATES: a curated set of narrative shapes the
// Storyboard (Story) agent SELECTS from per FILM — it auto-maps the premise/genre/tone
// onto the best-fit arc, then breaks the shots across that arc's stages. This replaces
// the old hardcoded Freytag prompt so a mood/observational/tragic premise isn't
// forced into a conflict climax it doesn't have. `fit` = the selection cue the model
// reads; `stages` = the beat sequence; `ending` = the ending mood that arc calls for.
export const STORY_ARCS = [
  { id: 'three-act', name: 'Three-Act / Freytag', category: 'Conflict', fit: 'a plotted story with a clear protagonist and a conflict that resolves', stages: 'setup · inciting incident · rising action · climax · falling action · resolution', ending: 'closure — the conflict resolved, a reflective button' },
  { id: 'man-in-a-hole', name: 'Man in a Hole', category: 'Conflict', fit: 'someone hits trouble and claws their way back (fall → rise)', stages: 'stable normal · trouble strikes · descent · lowest point · climb out · better than before', ending: 'relief / earned uplift' },
  { id: 'tragedy', name: 'Tragedy / The Fall', category: 'Dark', fit: 'a dark, doomed premise where the bad outcome must LAND — a loss, not a win', stages: 'a height · the flaw or threat · struggle · point of no return · downfall · bleak aftermath', ending: 'loss — bleak, ironic, or unresolved' }
];
export const STORY_ARC_BY_ID = STORY_ARCS.reduce((m, a) => { m[a.id] = a; return m; }, {});
// The catalog the Story agent reads to auto-pick the arc: `id — name (category): fit. Shape: …. Ends on ….`
export const storyArcCatalog = () => STORY_ARCS.map((a) => `${a.id} — ${a.name} (${a.category}): ${a.fit}. Shape: ${a.stages}. Ends on ${a.ending}.`).join('\n');

// Resolve a SHOT card's references into the ordered [{url, assetId, desc}] list that
// becomes [Image1..N]: the bible cast/location plates + per-shot attached assets.
export const shotReferences = (data = {}, bibleEntries = []) => {
  const refs = [];
  // assetId (the portrait-library asset:// id) rides alongside each ref so the shoot
  // can send a registered person/place plate as image_asset_id (trusted) rather than a
  // screened raw url.
  (data.refIds || []).forEach((id) => {
    const e = (bibleEntries || []).find((b) => b.id === id);
    if (e && e.url) refs.push({ url: e.url, assetId: e.assetId || null, nodeId: e.nodeId || null, name: e.name || '', role: e.role || '', desc: [e.name, e.role].filter(Boolean).join(' — ') });
  });
  (data.assetRefs || []).forEach((a) => { if (a && a.url) refs.push({ url: a.url, assetId: a.assetId || null, nodeId: a.nodeId || null, name: a.label || '', role: a.role || '', desc: a.label || 'asset' }); });
  return refs.slice(0, 9);
};

// ---- Seedance 2.0 doc-grammar compiler (composition-pinned shots) -----------------
// Emits the manual's advanced-formula sections in order: subject definitions →
// Shot-N body with composition-binding lines → look/quality → constraint tail.
// The binding phrases are PROBE-VERIFIED — the model honored
// "opens exactly on the composition of Image N" / "cuts to exactly …" /
// "ends exactly on the composition of Image N" — treat them as load-bearing.
// Pure function — the card's action text rides VERBATIM, nothing is rewritten.
export const SEEDANCE_QUALITY_LINE = 'HD, cinematic texture, natural colors.';
export const SEEDANCE_CONSTRAINT_TAIL = 'Keep it subtitle-free, avoid generating any text or subtitles. Do not generate watermarks or logos. Do not generate duplicate characters or twins of any defined subject — keep a single instance of each subject in frame.';

// The manual defines subjects by category noun; our bible roles map onto them.
// FRAME-role refs are deliberately absent: a frame carries COMPOSITION, not identity —
// the keyframe binding line ("Use Image i… as keyframes" / "opens exactly on…") is its
// whole contract; a Define line for a frame is noise.
const SUBJECT_NOUN = { character: 'person', location: 'location', prop: 'object' };

// subjects: [{ index, name, role }] — index = the ref's 1-based Image number (badge order).
// shots: [{ kfIndices: [K1..Kn], startDesc, endDesc, action, move, audio }] — ordered
// keyframe chip positions in the same Image numbering (legacy startPinIndex/endPinIndex
// fold in as a 2-list); action/audio are author text, verbatim.
// audioRefCount/videoRefCount: attached media refs (audio items ride before video items
// in the content array — the numbering here mirrors that invariant). The manual wants
// the reference RELATIONSHIP stated in text, not just the item's role.
// Transition markers (CUT TO: / FADE OUT …) are INTER-shot grammar — the sequence's
// job, not a take's. A marker left dangling at the END of one card's action invites
// the model to cut to nowhere; strip it (mid-text wording stays verbatim).
const stripTrailingTransition = (t) => String(t || '').trim()
  .replace(/(?:\s|\n)*(?:CUT TO:?|CUT:|SMASH CUT(?: TO)?:?|FADE (?:OUT|TO BLACK|IN):?|DISSOLVE(?: TO)?:?|MATCH CUT(?: TO)?:?)\s*$/i, '').trim();

export const composePinnedShotPrompt = ({ subjects = [], shots = [], cinematography = '', style = '', audioRefCount = 0, videoRefCount = 0, modelKey = 'seedance' } = {}) => {
  // Plate names carry a "· face"/"· body" suffix — an artifact of the bible, not a
  // subject name. Same-name plates collapse into ONE definition listing both images
  // (the manual's headshot + full-body pattern).
  const cleanName = (n) => String(n || '').replace(/\s*·\s*(face|body)\s*$/i, '').trim();
  const byName = new Map();
  // Only identity-bearing roles get defined; frame-role and role-less chips (board
  // stills, filename-labeled images) are compositions — the binding lines cover them.
  subjects.filter((s) => s && s.index && SUBJECT_NOUN[s.role] && cleanName(s.name)).forEach((s) => {
    const key = cleanName(s.name);
    if (byName.has(key)) byName.get(key).indices.push(s.index);
    else byName.set(key, { role: s.role, indices: [s.index] });
  });
  const defs = [...byName.entries()].map(([name, s]) => {
    const imgs = s.indices.map((i) => `Image ${i}`).join(' and ');
    return `Define the ${SUBJECT_NOUN[s.role] || 'subject'} in ${imgs} as ${name}.`;
  });
  for (let i = 0; i < audioRefCount; i += 1) defs.push(`Use the sound and timbre of Audio ${i + 1} as reference.`);
  for (let i = 0; i < videoRefCount; i += 1) defs.push(`Refer to the camera movement and motion in Video ${i + 1}.`);
  const shotLines = shots.map((sh, i) => {
    const parts = [];
    // The anchors carry their own DESCRIPTIONS (the still's wording / the exiting
    // state) — the manual wants text AND image to say the same thing: the image pins
    // the composition, the words make the content unambiguous.
    const sDesc = String(sh.startDesc || '').trim().replace(/\.$/, '');
    const eDesc = String(sh.endDesc || '').trim().replace(/\.$/, '');
    // ORDERED KEYFRAME LIST: kfIndices = [K1..Kn] chip positions; first
    // opens, last closes, middles pass through in order. Legacy start/end fields fold in.
    const kfs = Array.isArray(sh.kfIndices) && sh.kfIndices.length
      ? sh.kfIndices
      : [sh.startPinIndex, sh.endPinIndex].filter((x) => x > 0);
    const kFirst = kfs[0] || 0;
    const kLast = kfs.length > 1 ? kfs[kfs.length - 1] : 0;
    const kMids = kfs.slice(1, -1);
    if (kFirst && modelKey === 'seedance25') {
      // Seedance 2.5 keyframe grammar (strict alignment, UNLOCKED task — ratio and
      // duration stay ours). 2.0 keeps the probe-verified phrasing below.
      parts.push(kfs.length > 1
        ? `Use ${kfs.map((k) => `Image ${k}`).join(', ')} in order as keyframes.`
        : `Use Image ${kFirst} as the opening keyframe.`);
      if (sDesc) parts.push(`Image ${kFirst} is the opening frame — ${sDesc}.`);
    } else if (kFirst) {
      const open = i === 0
        ? `The shot opens exactly on the composition of Image ${kFirst}`
        : `Cuts to exactly the composition of Image ${kFirst}`;
      parts.push(`${open}${sDesc ? ` — ${sDesc}` : ''}.`);
      kMids.forEach((k) => parts.push(`Passes exactly through the composition of Image ${k}.`));
    }
    const move = String(sh.move || '').trim();
    if (move) parts.push(move.endsWith('.') ? move : `${move}.`);
    const action = stripTrailingTransition(sh.action);
    if (action) parts.push(action);
    const aud = String(sh.audio || '').trim();
    if (aud) parts.push(aud);
    if (kLast) {
      parts.push(modelKey === 'seedance25'
        ? `Image ${kLast} is the closing frame${eDesc ? `: ${eDesc}` : ''}.`
        : `The shot ends exactly on the composition of Image ${kLast}${eDesc ? `: ${eDesc}` : ''}.`);
    }
    return `Shot ${i + 1}: ${parts.join(' ')}`;
  });
  const look = [String(style || '').trim(), String(cinematography || '').trim()].filter(Boolean).join(' · ');
  if (modelKey === 'seedance25') {
    // 2.5 closes with the guide's recurring-elements block: the look, then an identity
    // clause naming the actual character chips, then quality + constraints.
    const chars = [...byName.entries()].filter(([, sub]) => sub.role === 'character');
    const consistency = chars.length
      ? `The appearances of ${chars.map(([name, sub]) => `${name} (${sub.indices.map((i) => `Image ${i}`).join(' and ')})`).join(', ')} remain strictly consistent throughout — no face changes.`
      : 'Subject appearances remain strictly consistent throughout.';
    return [
      defs.join('\n'),
      shotLines.join('\n'),
      `Overall requirements: ${[look, consistency, SEEDANCE_QUALITY_LINE, SEEDANCE_CONSTRAINT_TAIL].filter(Boolean).join(' ')}`,
    ].filter(Boolean).join('\n\n');
  }
  return [
    defs.join('\n'),
    shotLines.join('\n'),
    [look, SEEDANCE_QUALITY_LINE, SEEDANCE_CONSTRAINT_TAIL].filter(Boolean).join(' '),
  ].filter(Boolean).join('\n\n');
};

// Assemble a Seedance 2.0 prompt from a shot's pins: the reference images lead as
// [Image1..N], then the action, camera move, continuity, look and audio.
export const composeSeedancePrompt = ({ references = [], cuts = [], cinematography = '', audio = '', shotTemplate = '', continuity = '' } = {}) => {
  const refLines = references
    .map((r, i) => `[Image${i + 1}] ${String(r?.desc || r || '').trim()}`)
    .filter((l) => l.replace(/\[Image\d+\]\s*/, '').trim());
  const cutTexts = (Array.isArray(cuts) ? cuts : [cuts])
    .map((c) => String(c?.action ?? c ?? '').trim())
    .filter(Boolean);
  const cine = String(cinematography || '').trim();
  const aud = String(audio || '').trim();
  const move = (SHOT_TEMPLATE_BY_ID[shotTemplate] || {}).move || '';
  const cont = String(continuity || '').trim();
  return [
    refLines.join('\n'),
    cutTexts.length ? `ACTION — ${cutTexts.join(' Then, continuously, ')}` : '',
    move ? `CAMERA — ${move}` : '',
    cont ? `CONTINUITY — ${cont}` : '',
    cine ? `LOOK — ${cine}` : '',
    aud ? `AUDIO — ${aud}` : '',
  ].filter(Boolean).join('\n\n');
};

// The SHOT prompt: the Story agent already produced a complete prompt (appearances as
// description + key events), used VERBATIM with only the cinematic params (camera move +
// look + audio) appended. The bible plates still ride as actual reference images.
export const composeFilmShotPrompt = ({ prompt = '', shotTemplate = '', cinematography = '', audio = '' } = {}) => {
  const move = (SHOT_TEMPLATE_BY_ID[shotTemplate] || {}).move || '';
  return [
    stripTrailingTransition(prompt),
    move ? `CAMERA — ${move}: one continuous move through the space that follows the action` : '',
    String(cinematography || '').trim() ? `LOOK — ${cinematography.trim()}` : '',
    String(audio || '').trim() ? `AUDIO — ${audio.trim()}` : '',
  ].filter(Boolean).join('\n\n');
};

// The KEYFRAME prompt (Seedream 5.0, one still per shot). The reference-aware shot division writes
// the figure-addressed BODY (subject via [Image N] + what to keep from each, secondary subjects,
// environment, lighting/mood); here we WRAP it with line 1 (framing · angle · lens · style, from the
// shot template) and the finish line (DOF · grain · resolution + global rules). The shot's reference
// plates attach in [Image 1..N] order, so "[Image N]" in the body maps to the Nth attached image.
export const composeKeyframePrompt = ({ body = '', shotTemplate = '', style = '', expression = '', ethnicity = '' } = {}) => {
  const t = SHOT_TEMPLATE_BY_ID[shotTemplate] || {};
  const cine = String(t.cinematography || '').split(',').map((s) => s.trim());
  const lens = cine[0] || '';
  const dof = cine[1] || 'balanced depth of field';
  const framing = t.framing || 'medium shot';
  const angle = t.angle || 'eye-level';
  const sty = String(style || '').trim();
  const styleClause = sty && sty.toLowerCase() !== 'auto' ? `, ${sty} aesthetic` : '';
  const line1 = `Cinematic ${framing}, ${angle}${lens ? `, ${lens} lens` : ''}${styleClause}.`;
  const exp = String(expression || '').trim();
  const eth = String(ethnicity || '').trim();
  const overrides = [
    exp ? `Facial expression: ${exp}.` : '',
    eth && eth.toLowerCase() !== 'unspecified' ? `The people are ${eth}.` : '',
  ].filter(Boolean).join(' ');
  const line6 = `${dof}, fine film grain, photo-realistic, high resolution. Characters never look at the camera; no on-image text, captions or watermarks.`;
  return [line1, [String(body || '').trim(), overrides].filter(Boolean).join(' '), line6].filter(Boolean).join('\n');
};

// The SINGLE-IMAGE storyboard SHEET (Storyboard "Single image" mode): ONE Seedream image of the
// whole board — a grid of numbered panels, one per shot, in a cohesive look. Composed from the same
// division `shots` (their beats + [Image N]-addressed bodies, condensed); the reference pool attaches
// in [Image 1..N] order so a body's [Image N] maps to the Nth attached image and the cast stays
// consistent across panels. Small panel numbers only — Seedream's text is unreliable, so no captions.
export const composeStoryboardSheetPrompt = ({ shots = [], style = '', title = '' } = {}) => {
  const n = Math.max(1, shots.length);
  const cols = Math.min(n, 4);
  const rows = Math.max(1, Math.ceil(n / cols));
  const panels = shots.map((s, i) => `Panel ${i + 1}${s.beat ? ` — ${String(s.beat).trim()}` : ''}: ${String(s.body || '').replace(/\s+/g, ' ').trim().slice(0, 220)}`).join(' ');
  const sty = String(style || '').trim();
  const styleClause = sty && sty.toLowerCase() !== 'auto' ? `${sty} aesthetic, ` : '';
  const titleClause = String(title || '').trim() ? `titled "${String(title).trim().slice(0, 50)}", ` : '';
  return `A single cinematic STORYBOARD SHEET ${titleClause}laid out as a clean ${rows}×${cols} grid of ${n} numbered panels (left-to-right, top-to-bottom), each a distinct cinematic film still. ${panels} ${styleClause}One cohesive colour grade, lighting and world across ALL panels; keep every recurring character, prop and place consistent using the reference images. A small panel number in the top-left corner of each panel; otherwise no on-image text, captions or watermarks. Characters never look at the camera.`;
};

// ---- the Short Film recipe ---------------------------------------------------------
// A film GROWS chunk by chunk: generate 10–15s → validate → correct by aspects →
// continue (not planned-and-batched upfront). Character consistency
// is the king (bible anchors + last-frame chaining on every step); storytelling is
// the queen (beats proposed from the story so far, the user picks). The timeline is
// just placement + zoom-out — the FilmingInspector drives.
export const SHORT_FILM_RECIPE = {
  id: 'shortFilm',
  label: 'Short Film',
  emoji: '🎞️',
  description: 'Film it chunk by chunk: I generate 10–15s, you approve or correct the shot\'s camera and action, then we continue the story together — your cast stays consistent throughout.',
  chunkSeconds: [10, 12, 15],
  defaultChunkSeconds: 12,
};

export const RECIPES = { shortFilm: SHORT_FILM_RECIPE };
