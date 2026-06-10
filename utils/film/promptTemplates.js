// Central registry of every editable prompt template used by the Film Agent
// agents. Defaults live here; user edits are stored as overrides in localStorage
// and applied at render time. Templates use {placeholder} variables that the
// agent run() functions fill at call time.

export const DEFAULT_TEMPLATES = {
  // ---- Inspiration Board ----
  'inspiration.fallback': {
    agent: 'Inspiration Board',
    label: 'Fallback prompt (when the box is empty)',
    vars: [],
    text: 'cinematic reference still, evocative mood, film grain',
  },

  // ---- Character Variations ----
  'characterVariations.instruction': {
    agent: 'Character Variations',
    label: 'Variation instruction',
    vars: ['{axis}', '{descriptor}', '{notes}'],
    text: 'Same character, identical facial structure, identity, skin texture and hair. Photoreal, no stylization. Variation axis ({axis}): {descriptor}. {notes} No text, no logos, no watermark.',
  },

  // ---- Location Variations & Coverage ----
  'locationVariations.instruction': {
    agent: 'Location Variations',
    label: 'Coverage instruction',
    vars: ['{axis}', '{descriptor}', '{notes}'],
    text: 'Same location, identical architecture, layout, materials and set dressing. Coverage variation ({axis}): {descriptor}. {notes} No people in frame. No text, no logos, no watermark.',
  },

  // ---- Mix & Match ----
  'mixMatch.instruction': {
    agent: 'Mix & Match',
    label: 'Compositing instruction',
    vars: ['{direction}'],
    text: "Combine the provided reference images into a single coherent, photorealistic cinematic film still. Place the character(s) naturally within the location and have them hold or use any props shown. Preserve each subject's identity, face, hair, wardrobe and materials, and the location's architecture, set dressing and lighting. Render anatomically correct, natural human body proportions — head, torso, arms and legs in realistic ratio — and keep every subject at a believable real-world scale relative to the location and props (e.g. a standing adult is roughly 7–8 head-heights and reaches normal doorways/furniture). Do NOT stretch, squash, elongate, shrink, crop awkwardly, or otherwise distort any body to fit the frame; if a subject doesn't fit, reframe the shot rather than warp the person. {direction} Consistent cinematic lighting and color grade across the whole frame. No text, no logos, no watermark.",
  },
  'mixMatch.suggestSystem': {
    agent: 'Mix & Match',
    label: 'Prompt Muse — suggest direction (system)',
    vars: [],
    text: 'You are a film director composing a shot from reference images. Be specific and visual. One sentence only.',
  },
  'mixMatch.suggestUser': {
    agent: 'Mix & Match',
    label: 'Prompt Muse — suggest direction (instruction)',
    vars: [],
    text: 'These are reference images (characters, locations, and/or props). In ONE concise sentence, suggest how to combine them into a single coherent cinematic still — who is where, doing what, and the lighting/time of day. Return only the sentence, no preamble, no quotes.',
  },

  // ---- Animate (Seedance) ----
  'animate.motionFallback': {
    agent: 'Animate',
    label: 'Fallback motion (when the box is empty)',
    vars: [],
    text: 'Natural micro-movement; preserve the framing, subject, lighting and grade of the still.',
  },
  'animate.suggestSystem': {
    agent: 'Animate',
    label: 'Prompt Muse — suggest motion (system)',
    vars: [],
    text: 'You are a cinematographer directing a short moving shot from a still. Be specific, subtle, and physically plausible. One sentence only.',
  },
  'animate.suggestUser': {
    agent: 'Animate',
    label: 'Prompt Muse — suggest motion (instruction)',
    vars: [],
    text: 'This is a film keyframe. In ONE concise sentence, suggest natural in-shot motion and a camera move that would bring it to life (what moves, how the camera moves). Return only the sentence, no preamble, no quotes.',
  },

  // ---- Prompt Muse ----
  'promptMuse.system': {
    agent: 'Prompt Muse',
    label: 'System prompt',
    vars: [],
    text: 'You are a cinematographer and prompt expert helping a filmmaker learn to describe visuals. Read the provided image(s) or video and answer concisely in exactly two labelled parts, plain text, no markdown headers beyond the two labels, no preamble. Begin each part on its own line, starting with its exact label followed by a colon.\nWhat I see: 2–4 sentences naming the craft — shot size and lens feel, lighting, color palette and grade, mood, key textures, and composition. Use real cinematic vocabulary so the user learns it.\nPrompt: a single ready-to-use generation prompt (one paragraph) that would recreate this look — medium, subject, lens, lighting, palette, mood. No camera brand names.',
  },
  'promptMuse.user': {
    agent: 'Prompt Muse',
    label: 'User instruction',
    vars: ['{focus}'],
    text: '{focus}Read the attached reference(s) and help me describe them so I can prompt for more like this.',
  },

  // ---- Story Director ----
  'storyDirector.system': {
    agent: 'Story Director',
    label: 'Beat-suggester system prompt',
    vars: ['{count}'],
    text: 'You are a film story director helping a user build a short film beat by beat. Given the premise, the events so far, and (if provided) the latest keyframe image, propose what could happen NEXT. Return ONLY a JSON array of {count} objects, each: { "title": a 2–5 word label, "prompt": one vivid, concrete, visual sentence describing the next event as a cinematic keyframe }. Make the options distinct and dramatically interesting. No prose, no code fences.',
  },
  'storyDirector.user': {
    agent: 'Story Director',
    label: 'Beat-suggester instruction',
    vars: ['{idea}', '{steps}', '{count}'],
    text: 'Premise: {idea}\n\nEvents so far:\n{steps}\n\nPropose {count} distinct things that could happen next.\nRespond with ONLY a JSON array of {count} objects, each {"title": "...", "prompt": "..."}. No prose, no code fences.',
  },

  // ---- Auto Director (orchestrator) ----
  'autoDirector.understand.system': {
    agent: 'Auto Director',
    label: 'Understand assets (system)',
    vars: [],
    text: 'You are a film director\'s assistant. Study the provided reference image(s) and the user\'s idea, then summarize what there is to work with as a production brief. Return ONLY a JSON object — no prose, no code fences: {"logline": one vivid sentence, "genre": short, "mood": short, "palette": short colour/lighting description, "subjects": [{"name": short label, "description": who or what they are}], "locations": [{"name": short label, "description": the setting}]}. Infer sensibly from the images; fold in any detail from the idea. Keep every field concise.',
  },
  'autoDirector.understand.user': {
    agent: 'Auto Director',
    label: 'Understand assets (instruction)',
    vars: ['{idea}'],
    text: 'Idea / pitch: {idea}\n\nThe attached images are the source assets. Produce the production brief as the specified JSON object.',
  },
  'autoDirector.plan.system': {
    agent: 'Auto Director',
    label: 'Build production plan (system)',
    vars: ['{agents}'],
    text: 'You are a film director planning how to turn a brief into a short cinematic video using a fixed catalogue of production agents. Use ONLY these agent ids:\n{agents}\n\nReturn ONLY a JSON array of ordered steps — no prose, no code fences. Each step: {"agent": one agent id, "title": a 2–5 word label, "intent": one sentence on what it produces and why, "params": a settings object for that agent (e.g. inspiration {"prompt":"…","count":4}; characterVariations {"axis":"wardrobe","count":4}; mixMatch {"prompt":"…","ratio":"16:9"}; animate {"motion":"…","camera":"slow push-in"}), "dependsOn": array of earlier step indexes (0-based) whose approved outputs feed this step, or []}. Build a sensible pipeline: establish the look, subjects and locations first; compose key shots by mixing them; then animate the chosen shots into the final sequence. Keep it lean — 5 to 9 steps.',
  },
  'autoDirector.plan.user': {
    agent: 'Auto Director',
    label: 'Build production plan (instruction)',
    vars: ['{idea}', '{brief}', '{targetMinutes}'],
    text: 'Idea: {idea}\n\nBrief:\n{brief}\n\nTarget length: about {targetMinutes} minutes of footage. Plan the production now as the specified JSON array of steps.',
  },
  'autoDirector.qc.system': {
    agent: 'Auto Director',
    label: 'Per-step QC review (system)',
    vars: [],
    text: 'You are a meticulous film QC supervisor reviewing ONE production step. You are given the step\'s intent, the source reference image(s), and the generated output(s). Judge whether the output achieves the intent and is technically sound. Check, as relevant: subject identity preserved, location architecture preserved, anatomy and proportions, exposure and focus, composition and framing, prompt adherence, and continuity with the references. Return ONLY a JSON object — no prose, no code fences: {"verdict": "pass" | "warn" | "fail", "best": 0-based index of the strongest output, "issues": [{"severity": "low" | "medium" | "high", "message": what is wrong, "suggestion": a concrete fix or reshoot note}]}. If everything is good, return verdict "pass" with an empty issues array. Be specific and brief.',
  },
  'autoDirector.qc.user': {
    agent: 'Auto Director',
    label: 'Per-step QC review (instruction)',
    vars: ['{agent}', '{intent}', '{refCount}'],
    text: 'Step agent: {agent}\nStep intent: {intent}\n\nThe first {refCount} attached item(s) are the source reference image(s); everything after them is the generated output (image variations and/or a shot video) to review, in order. Assess the outputs against the intent and the references, then return the QC JSON. "best" is the index among the generated outputs only.',
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

// Grouped list for the settings UI.
export const templatesByAgent = () => {
  const groups = {};
  Object.entries(DEFAULT_TEMPLATES).forEach(([id, def]) => {
    if (!groups[def.agent]) groups[def.agent] = [];
    groups[def.agent].push({ id, ...def });
  });
  return groups;
};
