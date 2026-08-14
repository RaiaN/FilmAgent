import { videoTraits, videoModelKeyOf } from './suiteConfig';

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

// ---- Seedance 2.0 prompt grammar (the CUT card's composed output) ----------------

// ---- the camera library (the Shot agent's vocabulary) — 19 DISTINCT setups --------
// Radically curated (was ~50 near-synonym combos): every entry earns its place by
// doing a DIFFERENT job on screen; near-duplicates and taste-in-disguise are gone.
// Framing / Angle / Composition entries are STILL-legible (no move — the video model
// or the action text decides movement unless a Movement entry is picked); Movement
// entries are VIDEO-only and never offered on still surfaces. `cinematography` is a
// minimal lens/DOF line — the LOOK (light, grade, grain) belongs to the style
// sentence and the card's ＋cinematography fields, never baked in here.
export const SHOT_TEMPLATES = [
  { id: 'wide-establisher', name: 'Wide Establisher', category: 'Framing', framing: 'wide shot', angle: '', move: '', cinematography: '24mm, deep focus', desc: 'Geography and scale — where everything and everyone is.' },
  { id: 'full-shot', name: 'Full Shot', category: 'Framing', framing: 'full shot, head to toe', angle: '', move: '', cinematography: '35mm, deep focus', desc: 'The whole body — blocking, physicality, action legible.' },
  { id: 'medium-shot', name: 'Medium Shot', category: 'Framing', framing: 'medium shot, waist up', angle: '', move: '', cinematography: '40mm, moderate DOF', desc: 'The workhorse — behavior and body language together.' },
  { id: 'close-up', name: 'Close-Up', category: 'Framing', framing: 'close-up on the face', angle: '', move: '', cinematography: '85mm, shallow DOF', desc: 'The face is the scene — emotion, reaction, decision.' },
  { id: 'extreme-close-up', name: 'Extreme Close-Up / Insert', category: 'Framing', framing: 'extreme close-up', angle: '', move: '', cinematography: '100mm macro, razor-shallow DOF', desc: 'One detail fills the frame — an eye, a hand, an object that matters.' },
  { id: 'two-shot', name: 'Two-Shot', category: 'Framing', framing: 'two-shot, both subjects in frame', angle: '', move: '', cinematography: '40mm, moderate DOF', desc: 'Two subjects share the frame — relationship, negotiation.' },
  { id: 'low-angle', name: 'Low Angle', category: 'Angle', framing: '', angle: 'low angle, looking up', move: '', cinematography: '28mm', desc: 'Power, threat, monumentality — the subject looms.' },
  { id: 'high-angle', name: 'High Angle', category: 'Angle', framing: '', angle: 'high angle, looking down', move: '', cinematography: '35mm', desc: 'Vulnerability, overview — the subject diminished or surveyed.' },
  { id: 'top-down', name: 'Top-Down / Overhead', category: 'Angle', framing: '', angle: 'top-down overhead', move: '', cinematography: '24mm, deep focus', desc: 'The god view — patterns, layouts, fate.' },
  { id: 'dutch-tilt', name: 'Dutch Tilt', category: 'Angle', framing: '', angle: 'canted dutch angle', move: '', cinematography: '32mm', desc: 'The world off its axis — unease, instability.' },
  { id: 'over-the-shoulder', name: 'Over-the-Shoulder', category: 'Composition', framing: 'over-the-shoulder shot', angle: '', move: '', cinematography: '85mm, shallow DOF on the far face', desc: 'Past one shoulder onto the other face — dialogue, confrontation.' },
  { id: 'pov-subjective', name: 'POV / Subjective', category: 'Composition', framing: 'first-person POV shot', angle: '', move: '', cinematography: '28mm, moderate DOF', desc: 'We see what the character sees.' },
  { id: 'static-lockoff', name: 'Static Lock-Off', category: 'Movement', framing: '', angle: '', move: 'static lock-off', cinematography: 'locked static camera', desc: 'The camera holds and witnesses — tension, deadpan, action plays IN the frame.' },
  { id: 'push-in', name: 'Push-In', category: 'Movement', framing: '', angle: '', move: 'push-in toward the subject', cinematography: 'push-in', desc: 'The frame commits — mounting intensity, realization.' },
  { id: 'pull-back', name: 'Pull-Back', category: 'Movement', framing: '', angle: '', move: 'pull-back away from the subject', cinematography: 'pull-back', desc: 'The frame lets go — reveal, isolation, aftermath.' },
  { id: 'tracking-follow', name: 'Tracking Follow', category: 'Movement', framing: '', angle: '', move: 'tracking follow with the subject', cinematography: 'tracking follow', desc: 'Travel WITH the subject — journey, pursuit, momentum.' },
  { id: 'orbit', name: 'Orbit / Arc', category: 'Movement', framing: '', angle: '', move: 'orbit around the subject', cinematography: 'orbital arc', desc: 'The world wheels around a fixed center — significance, disorientation.' },
  { id: 'crane', name: 'Crane', category: 'Movement', framing: '', angle: '', move: 'crane rise (or descend)', cinematography: 'crane move', desc: 'Vertical travel — scale reveals, departures, arrivals.' },
  { id: 'whip-pan', name: 'Whip Pan', category: 'Movement', framing: '', angle: '', move: 'whip pan', cinematography: 'whip pan', desc: 'A violent redirect of attention — energy, surprise, comic snap.' },
];

export const SHOT_TEMPLATE_CATEGORIES = ['Framing', 'Angle', 'Composition', 'Movement'];
export const SHOT_TEMPLATE_BY_ID = SHOT_TEMPLATES.reduce((m, t) => { m[t.id] = t; return m; }, {});
// Grouped for the SHOT card's CINEMATOGRAPHY dropdown (Select.OptGroup per category).
export const SHOT_TEMPLATES_BY_CATEGORY = SHOT_TEMPLATE_CATEGORIES.map((category) => ({ category, templates: SHOT_TEMPLATES.filter((t) => t.category === category) }));
// The catalog the Shot agent reads to choose: `id — name (category): desc`, one per line.
export const shotTemplateCatalog = () => SHOT_TEMPLATES.map((t) => `${t.id} — ${t.name} (${t.category}): ${t.desc}`).join('\n');
// The cinematography line for a chosen template id — empty when the id is unknown
// (the LOOK line simply doesn't ride; no fallback taste is ever injected).
export const shotTemplateCinematography = (id) => (SHOT_TEMPLATE_BY_ID[id] && SHOT_TEMPLATE_BY_ID[id].cinematography) || '';

// ---- the story-arc library (the Story agent's structural vocabulary) -------------
// The structural analogue of SHOT_TEMPLATES: a curated set of narrative shapes the
// Storyboard (Story) agent SELECTS from per FILM — it auto-maps the premise/tone
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
  return refs.slice(0, videoTraits(videoModelKeyOf(data.videoModel)).refCap);
};

// ---- Seedance doc-grammar compiler (composition-pinned shots), TWO dialects -------
// 2.0 family: the manual's advanced formula — subject definitions → Shot-N body with
// composition-binding lines → look/quality → constraint tail. The binding phrases are
// PROBE-VERIFIED ("opens exactly on the composition of Image N" / "cuts to exactly …" /
// "ends exactly on …") — treat them as load-bearing.
// 2.5 family: the official sd25-pe dialect (see composePinnedShotPrompt).
// Pure function — the card's action text rides VERBATIM, nothing is rewritten
// (the 2.5 wire translation only re-spells [Image N] → @ImageN).
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

export const composePinnedShotPrompt = ({ subjects = [], shots = [], cinematography = '', style = '', audioRefCount = 0, videoRefCount = 0, audioRoles = [], videoRoles = [], modelKey = 'seedance' } = {}) => {
  // The 2.5 family speaks the OFFICIAL sd25-pe dialect (.agents/skills/sd25-pe/SKILL.md):
  // @ImageN wire notation, "maps to … use only …" subject scopes, verbatim first/last-frame
  // sentences, and NO generic quality/constraint tails. The 2.0 family keeps the
  // probe-verified 2.0-manual grammar below. Internal notation stays [Image N] everywhere;
  // the translation happens HERE, at the wire.
  const g25 = videoTraits(modelKey).keyframeGrammar === 'keyframes';
  const tag = (kind, n) => (g25 ? `@${kind}${n}` : `${kind} ${n}`);
  const wire = (t) => (g25 ? String(t || '').replace(/\[Image\s+(\d+)\]/gi, '@Image$1') : String(t || ''));
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
  // Adopted-scope clauses per role (official subject-mapping pattern): each asset
  // contributes exactly its intended features, nothing else bleeds through.
  const SCOPE_25 = {
    character: 'use only the facial features, hairstyle, and clothing',
    location: 'use only the spatial layout, architecture, and lighting; do not use any people in the image',
    prop: 'use only the structure, material, and color',
  };
  const defs = [...byName.entries()].map(([name, s]) => {
    const imgs = s.indices.map((i) => tag('Image', i)).join(' and ');
    return g25
      ? `${name} maps to ${imgs}; ${SCOPE_25[s.role] || 'use only its directly observable features'}.`
      : `Define the ${SUBJECT_NOUN[s.role] || 'subject'} in ${imgs} as ${name}.`;
  });
  // Media binding lines are ROLE-scoped (the guide's partial-reference pattern) —
  // each asset contributes exactly its intended feature; unset role = the generic line.
  for (let i = 0; i < audioRefCount; i += 1) {
    const role = (audioRoles || [])[i];
    const a = tag('Audio', i + 1);
    defs.push(role === 'music' ? `Use ${a} as the music reference.`
      : role === 'ambience' ? `Use ${a} as the ambience and sound-design reference.`
        : role === 'voice' ? `Use the voice timbre of ${a}.`
          : `Use the sound and timbre of ${a} as reference.`);
  }
  for (let i = 0; i < videoRefCount; i += 1) {
    const role = (videoRoles || [])[i];
    const v = tag('Video', i + 1);
    defs.push(role === 'camera' ? `Refer to the camera movement in ${v}.`
      : role === 'style' ? `Refer to the visual style of ${v}.`
        : role === 'motion' ? `Refer to the motion in ${v}.`
          : `Refer to the camera movement and motion in ${v}.`);
  }
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
    if (kFirst && g25) {
      // Official sd25-pe keyframe grammar: role sentences VERBATIM ("Use @ImageN as the
      // first frame." — never weakened to "opening keyframe"), each keyframe's state
      // described in its own sentence, all role statements BEFORE the action.
      if (kfs.length > 1) parts.push(`Use ${kfs.map((k) => tag('Image', k)).join(', ')} as keyframes in that order.`);
      parts.push(`Use ${tag('Image', kFirst)} as the first frame.`);
      if (sDesc) parts.push(`This first frame defines ${wire(sDesc)}.`);
      kMids.forEach((k, mi) => {
        const d = String((sh.kfDescs || [])[mi + 1] || '').trim().replace(/\.$/, '');
        parts.push(`${tag('Image', k)} defines the next keyframe${d ? `: ${wire(d)}` : ''}.`);
      });
      if (kLast) {
        parts.push(`Use ${tag('Image', kLast)} as the last frame.`);
        if (eDesc) parts.push(`This last frame defines ${wire(eDesc)}.`);
      }
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
    if (action) parts.push(wire(action));
    const aud = String(sh.audio || '').trim();
    if (aud) parts.push(wire(aud));
    if (kLast && !g25) {
      parts.push(`The shot ends exactly on the composition of Image ${kLast}${eDesc ? `: ${eDesc}` : ''}.`);
    }
    return g25 && shots.length === 1 ? parts.join(' ') : `Shot ${i + 1}: ${parts.join(' ')}`;
  });
  const look = [String(style || '').trim(), String(cinematography || '').trim()].filter(Boolean).join(' · ');
  if (g25) {
    // Official closing block: consistency stated over the ACTUAL subjects — and per the
    // spec's "no unrequested generic constraints" principle, NO quality pack, NO
    // watermark/subtitle/twin boilerplate.
    const chars = [...byName.entries()].filter(([, sub]) => sub.role === 'character');
    const consistency = chars.length
      ? `Keep the identity, count, and clothing of ${chars.map(([name, sub]) => `${name} (${sub.indices.map((i) => tag('Image', i)).join(' and ')})`).join(', ')} stable throughout.`
      : 'Keep subject identities and counts stable throughout.';
    return [
      defs.join('\n'),
      shotLines.join('\n'),
      `【Maintain Consistency】 ${[consistency, look ? `The visuals present ${look}.` : ''].filter(Boolean).join(' ')}`,
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
