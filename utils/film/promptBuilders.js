const LANGUAGE_LABELS = {
  en: 'English',
  'zh-CN': 'Simplified Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  ko: 'Korean',
};

const languageDirective = (language) => {
  const label = LANGUAGE_LABELS[language] || language || 'English';
  return `Write all narrative prose, dialogue, character names, and on-screen text in ${label}. Keep JSON keys and field names in English.`;
};

const jsonOnlyDirective = [
  'Return a single JSON object only. No prose. No code fences. No commentary.',
  'If a field is unknown, use an empty string or empty array — never null.',
].join(' ');

export const buildLoglineSystem = ({ language }) => [
  'You are a senior film development executive.',
  'Take the user\'s raw film idea and return a tight logline package.',
  languageDirective(language),
  jsonOnlyDirective,
  'Shape: { "title": string, "logline": string (one sentence, ≤30 words), "genre": string, "tone": string, "audience": string, "hook": string (the single most compelling element) }.',
].join(' ');

export const buildLoglineUser = ({ idea, targetMinutes }) => [
  `Target runtime: ${targetMinutes} minutes.`,
  `Raw idea: ${idea}`,
].join('\n');

export const buildTreatmentSystem = ({ language }) => [
  'You are a screenwriter. Convert an approved logline into a beat-driven treatment for a short cinematic film.',
  languageDirective(language),
  jsonOnlyDirective,
  'Shape: { "premise": string (2–3 sentences), "protagonist": string, "antagonist_or_obstacle": string, "stakes": string, "beats": Array<{ "id": string ("b1".."b8"), "act": "I"|"II"|"III", "title": string, "summary": string (1–3 sentences), "estimated_seconds": number }> }.',
  'Total of estimated_seconds across all beats must approximately equal target runtime in seconds. Use 5–8 beats. Three-act shape.',
].join(' ');

export const buildTreatmentUser = ({ logline, targetMinutes }) => [
  `Target runtime: ${targetMinutes} minutes (${targetMinutes * 60} seconds total).`,
  'Approved logline package:',
  JSON.stringify(logline, null, 2),
].join('\n');

export const buildScriptSystem = ({ language }) => [
  'You are a screenwriter. Convert an approved treatment into a scene-by-scene script for a short cinematic film.',
  languageDirective(language),
  jsonOnlyDirective,
  'Shape: { "characters": Array<{ "id": string ("c1"..), "name": string, "role": string, "physical_description": string, "voice_timbre": string }>, "scenes": Array<{ "id": string ("s1".."sN"), "beat_id": string, "slugline": string ("INT./EXT. LOCATION — TIME"), "location_id": string ("l1"..), "characters": string[] (character ids present), "action": string (prose), "dialogue": Array<{ "character_id": string, "line": string, "delivery": string }>, "estimated_seconds": number }>, "locations": Array<{ "id": string ("l1"..), "name": string, "description": string, "time_of_day": string }> }.',
  'Sum of scene estimated_seconds must approximately equal the treatment runtime. voice_timbre is a concrete, prompt-ready description ("low rasp, breathy, mid-40s warmth, slight Highland lilt"). dialogue.delivery is a 2–4 word direction ("whispered, urgent"). Reuse character_ids and location_ids consistently.',
].join(' ');

export const buildScriptUser = ({ logline, treatment }) => [
  'Approved logline package:',
  JSON.stringify(logline, null, 2),
  '',
  'Approved treatment:',
  JSON.stringify(treatment, null, 2),
].join('\n');

export const buildStyleSystem = ({ language }) => [
  'You are the director of photography and production designer for a short cinematic film.',
  'Convert an approved script into a global visual + audio style bible that every shot must obey.',
  languageDirective(language),
  jsonOnlyDirective,
  'Shape: { "look": { "lens": string (e.g. "anamorphic 40mm, T2.0"), "format": string (e.g. "35mm film, fine grain"), "aspect_ratio": string, "palette": string[] (3–6 named colors with hex), "lighting": string, "grade": string }, "composition": { "framing_rules": string, "camera_movement": string }, "audio": { "ambient_bed": string, "score_direction": string, "voice_processing": string }, "shot_density": { "average_shot_seconds": number, "approximate_shot_count": number }, "continuity_rules": string[], "forbidden": string[] (e.g. "no on-screen text", "no modern logos") }.',
  'shot_density.approximate_shot_count should equal round(total_runtime_seconds / average_shot_seconds). Average shot length 5–9 seconds for a cinematic short.',
].join(' ');

export const buildStyleUser = ({ logline, treatment, script, targetMinutes }) => [
  `Target runtime: ${targetMinutes} minutes (${targetMinutes * 60} seconds total).`,
  'Approved logline package:',
  JSON.stringify(logline, null, 2),
  '',
  'Approved treatment:',
  JSON.stringify(treatment, null, 2),
  '',
  'Approved script (scenes + characters + locations):',
  JSON.stringify(script, null, 2),
].join('\n');

export const STAGE_BUILDERS = {
  logline: { system: buildLoglineSystem, user: buildLoglineUser },
  treatment: { system: buildTreatmentSystem, user: buildTreatmentUser },
  script: { system: buildScriptSystem, user: buildScriptUser },
  style: { system: buildStyleSystem, user: buildStyleUser },
};
