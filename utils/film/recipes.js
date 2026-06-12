// Recipes — the agentic answer to "what's the best recipe for use case XYZ?". A
// recipe maps a use case → the bible roles it needs, the shot grammar (by duration),
// the cinematic look packages, and which bible roles each shot pulls. Pure data +
// helpers; no network, no React. The Concierge picks a recipe, builds the bible from
// the user's assets, asks for gaps, then produces the film from this structure.

// ---- ad-specific bible roles (richer than the generic style/character/...) -------
// An advertiser brings a PILE of assets; these are the roles the Concierge sorts
// them into. The bible holds image anchors AND non-image constraints (brand color,
// tagline, font) — every shot / end-card obeys those.
export const AD_ROLES = ['product', 'brand', 'talent', 'look', 'location', 'prop'];

export const AD_ROLE_META = {
  // The role ID stays 'product' (persisted on tagged board nodes), but its MEANING is
  // the ad's HERO — a physical product, a place, a cause's subject, or an offering.
  // Intent (recipe.kind/subjects) decides what the hero actually is per project.
  product: { label: 'Hero', kind: 'image', hint: 'the main thing being advertised — a product, place, offering or subject' },
  brand: { label: 'Brand', kind: 'mixed', hint: 'logo, brand colours, tagline, fonts' },
  talent: { label: 'Talent', kind: 'image', hint: 'spokesperson / model / presenter (face = locked identity)' },
  look: { label: 'Look', kind: 'image', hint: 'mood board / reference imagery / a reference-ad frame' },
  location: { label: 'Location', kind: 'image', hint: 'the set / environment the spot lives in' },
  prop: { label: 'Prop', kind: 'image', hint: 'supporting objects' },
};

// Non-image brand constraints the bible can also hold (every shot obeys these).
export const BRAND_CONSTRAINTS = ['colorHex', 'tagline', 'font'];

// ---- cinematic look packages (the cinematographer in a box) ----------------------
// lens + light + grade + camera + pacing as ONE preset, so the user never sets a
// parameter. The look feeds the planner/animate as style direction; it does not ask
// the user about Seedance — it encodes "what good looks like" for this vibe.
export const LOOK_PACKAGES = {
  luxury: { label: 'Luxury', grade: 'warm gold, deep filmic contrast', lens: 'anamorphic, shallow depth of field', light: 'soft motivated key with rim light', camera: 'slow push-ins, locked-off hero', pacing: 'deliberate, long holds' },
  cleanTech: { label: 'Clean-tech', grade: 'cool, clean, high-key', lens: 'crisp spherical', light: 'soft even light, subtle speculars', camera: 'smooth precise dolly', pacing: 'measured' },
  warmLifestyle: { label: 'Warm lifestyle', grade: 'warm natural, gentle', lens: '35–50mm, shallow', light: 'golden-hour soft daylight', camera: 'gentle handheld parallax', pacing: 'relaxed' },
  highEnergy: { label: 'High-energy', grade: 'vibrant, punchy, saturated', lens: 'wide and dynamic', light: 'hard, high-contrast', camera: 'fast push-ins / whip moves', pacing: 'quick rhythmic cuts' },
};

// Build the style-direction string a generative step gets from a look package.
export const lookDirection = (lookId) => {
  const l = LOOK_PACKAGES[lookId] || LOOK_PACKAGES.warmLifestyle;
  return `Cinematic ${l.label.toLowerCase()} ad look: ${l.grade}; ${l.lens}; ${l.light}; camera ${l.camera}; ${l.pacing}.`;
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

// ---- cinematic ad shot grammar (by duration) -------------------------------------
// Each beat → one shot. `roles` = which bible roles that shot pulls (the per-shot
// SELECTION — consistency without cramming all 12 assets into every frame).
// `camera` is a CAMERA_MOVES template; `motion` seeds the IN-FRAME action/flow —
// the two halves of the Seedance prompt (buildAnimatePrompt composes them).
export const adShotPlan = (durationSec = 30) => {
  const d = Number(durationSec) || 30;
  if (d <= 18) {
    return [
      { beat: 'Striking opening hook', roles: ['look', 'product'], camera: 'slow push-in', motion: 'the hero is revealed' },
      { beat: 'Hero in action', roles: ['product', 'talent'], camera: 'handheld follow', motion: 'the hero in use' },
      { beat: 'Hero shot with logo', roles: ['product', 'brand'], camera: 'static lock-off', motion: 'subtle beauty motion' },
    ];
  }
  if (d <= 35) {
    return [
      { beat: 'Cinematic hook', roles: ['look'], camera: 'slow push-in', motion: '' },
      { beat: 'Desire / the problem', roles: ['talent', 'location'], camera: 'gentle parallax drift', motion: '' },
      { beat: 'Hero reveal', roles: ['product', 'brand'], camera: 'slow push-in', motion: 'the hero is revealed' },
      { beat: 'Benefit in use', roles: ['product', 'talent', 'location'], camera: 'handheld follow', motion: 'the hero in use' },
      { beat: 'Hero beauty shot', roles: ['product', 'brand'], camera: 'slow orbit', motion: '' },
      { beat: 'CTA end-card', roles: ['brand'], camera: 'static lock-off', motion: 'logo and tagline hold' },
    ];
  }
  return [ // ~60s
    { beat: 'Cinematic hook', roles: ['look'], camera: 'slow push-in', motion: '' },
    { beat: 'Set the world', roles: ['location', 'talent'], camera: 'gentle parallax drift', motion: 'wide establishing' },
    { beat: 'Enter the hero', roles: ['product', 'talent'], camera: 'slow push-in', motion: 'the hero enters' },
    { beat: 'Lifestyle beat one', roles: ['product', 'location'], camera: 'gentle parallax drift', motion: '' },
    { beat: 'Lifestyle beat two', roles: ['product', 'talent'], camera: 'handheld follow', motion: '' },
    { beat: 'Feature highlight', roles: ['product', 'brand'], camera: 'macro push-in', motion: '' },
    { beat: 'Hero beauty shot', roles: ['product', 'brand'], camera: 'slow orbit', motion: '' },
    { beat: 'Emotional payoff', roles: ['talent', 'look'], camera: 'slow pull-back', motion: '' },
    { beat: 'Logo sting', roles: ['brand'], camera: 'whip pan', motion: 'snap to the logo' },
    { beat: 'CTA end-card', roles: ['brand'], camera: 'static lock-off', motion: 'logo and tagline hold' },
  ];
};

// Assemble a CUT card's full keyframe-writer seed: the shot's own content first
// (the beat when the user wrote nothing), then the shared context every cut carries
// (hero, the user's idea verbatim, the look package). ONE function so the card's
// full-prompt preview and the Action blueprint can never disagree.
export const cutPromptSeed = ({ content = '', beat = '', heroLine = '', idea = '', lookLine = '' } = {}) =>
  [(content || '').trim() || beat, heroLine, idea, lookLine]
    .map((s) => (s || '').trim()).filter(Boolean).join('. ');

// ---- the Advertisement recipe ----------------------------------------------------
export const ADVERTISEMENT_RECIPE = {
  id: 'advertisement',
  label: 'Cinematic Advertisement',
  emoji: '📣',
  // Card copy for the board's template launcher (the recipe picker front door).
  description: 'Tell the concierge what you\'re advertising — it builds your brand kit, fills the gaps, and shoots a finished 15–60s spot.',
  roles: AD_ROLES,
  roleMeta: AD_ROLE_META,
  looks: LOOK_PACKAGES,
  durations: [15, 30, 60],
  defaultDuration: 30,
  aspects: ['9:16', '16:9', '1:1'],
  defaultAspect: '16:9',
  shotPlan: adShotPlan,
  // The minimum the recipe needs to make a strong ad; the rest it offers to generate.
  requiredRoles: ['product', 'brand'],
  niceToHaveRoles: ['talent', 'look', 'location'],
};

// What to generate for each bible role when the user asks us to fill a gap. The
// subject (the role) + the idea + the chosen look = an on-brand, role-correct prompt.
export const GAP_SUBJECT = {
  product: 'the hero of the advertisement — the product, place or subject being advertised — as one striking cinematic key image',
  brand: 'a simple, clean brand logo / wordmark on a plain background',
  talent: 'a spokesperson / model for the ad — natural, on-brand, photoreal',
  look: 'a mood / style reference frame establishing the visual tone',
  location: 'the location / set where the advertisement takes place',
  prop: 'a supporting prop that fits the scene',
};
// Non-brand assets must come out as clean photographic plates, NOT ad layouts —
// the word "advertisement" alone makes Seedream bake headlines/taglines into the
// image (a talent that arrives covered in serum-ad copy is unusable as an anchor).
const GAP_NO_TEXT = 'Clean photographic asset: NO on-image text, headlines, captions, typography, logos or watermarks — not an ad layout or poster.';

// `detail` = the user's own description of the asset ("a matte-black ceramic mug"),
// captured by the Concierge interview — it leads the prompt so the generation is
// THEIR product/brand/talent, not a generic guess from the idea alone. The idea
// clause is included only when an idea exists (a dangling "for this advertisement:"
// with nothing after it invites pure ad-cliché hallucination).
export const gapPrompt = (role, idea = '', lookId = '', detail = '') => [
  `${GAP_SUBJECT[role] || role}${detail ? ` — specifically: ${detail}` : ''}.`,
  idea ? `For this advertisement: ${idea}.` : '',
  lookId ? lookDirection(lookId) : '',
  role === 'brand' ? '' : GAP_NO_TEXT,
].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

// ---- the Short Film recipe (the iterative Filming Loop) ---------------------------
// Unlike the ad (plan-all-shots-upfront, batch), a film GROWS chunk by chunk:
// generate 10–15s → validate → correct by aspects → continue. Character consistency
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

export const RECIPES = { advertisement: ADVERTISEMENT_RECIPE, shortFilm: SHORT_FILM_RECIPE };

export const getRecipe = (id) => RECIPES[id] || ADVERTISEMENT_RECIPE;

// The roles the Concierge interview walks through, in order — intent-aware. When the
// intent read says the ad has no brand dimension (brandRelevant === false, e.g. a
// cause / place / brand-story spot), the brand question is dropped entirely instead
// of forcing "do you have a logo?" onto an idea that has none.
export const adInterviewRoles = (brandRelevant = true) => (
  brandRelevant
    ? [...ADVERTISEMENT_RECIPE.requiredRoles, ...ADVERTISEMENT_RECIPE.niceToHaveRoles]
    : [...ADVERTISEMENT_RECIPE.requiredRoles.filter((r) => r !== 'brand'), ...ADVERTISEMENT_RECIPE.niceToHaveRoles]
);

// Given a recipe's bible (entries carry a `role`) compute which required roles are
// still missing — what the Concierge asks "do you have XYZ?" about.
export const recipeGaps = (recipe, bibleEntries = []) => {
  const present = new Set((bibleEntries || []).map((e) => e.role));
  return {
    missingRequired: (recipe.requiredRoles || []).filter((r) => !present.has(r)),
    missingNiceToHave: (recipe.niceToHaveRoles || []).filter((r) => !present.has(r)),
  };
};
