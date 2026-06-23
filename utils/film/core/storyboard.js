// Storyboard — the plan between casting and filming (the Film pipeline's stage 3).
// One reason call STUDIES the real tagged assets (the VLM sees the actual cast and
// places) + the idea, and breaks the film into 5–15s shots: what happens, the chosen
// SHOT TEMPLATE (one of the 50 in the cinematography library — angle/framing/move),
// duration, and WHICH real assets appear. Then each shot is rendered as a LIGHTING-
// ONLY previs frame (white-washed clay, like Unreal's "Lighting Only" view): the
// shot's real cast plates + location plate condition a neutral grey-scale study that
// BLOCKS the cast in the location, in that framing — composition and light only.
//
// The frame is generated FROM the real plates (so the blocking, poses and scale
// match) and at shoot time rides to Seedance ALONGSIDE those plates (shotReferences
// puts the plates first, the frame last) — the plates carry identity & colour, the
// frame carries camera, composition and lighting.
//
// Pure core — canvas/SDK inject ctx { client, config }.

import { renderTemplate, getModel, getRuntime } from '../suiteConfig';
import { resolveImageSize } from '../imageSizes';
import { composeSeedancePrompt, shotTemplateCatalog, shotTemplateCinematography, SHOT_TEMPLATE_BY_ID, storyArcCatalog, STORY_ARC_BY_ID } from '../recipes';
import { parseJson } from './director';
import { withRetry, isTransient } from './retry';
import { isImagePolicyError } from './operations';
import { runWithConcurrency } from './parallel';

// Shots are 5–15s (each breaks into cuts of ≤5–6s) → a 60–180s film is ~6–18 shots.
export const shotCountFor = (seconds) => Math.max(2, Math.min(18, Math.round((Number(seconds) || 90) / 10)));

// Clamp any shot duration into the 5–15s range (no longer a fixed 10/12/15 list).
const clampDuration = (d) => Math.min(15, Math.max(5, Math.round(Number(d) || 10)));

// Fallback when the Shot agent returns no/invalid template id — a neutral workhorse.
const DEFAULT_SHOT_TEMPLATE = 'medium-shot';

// Collapse the panels' per-shot stages into a readable story spine, grouping
// consecutive shots that share a stage: "1–2 stable normal · 3 trouble strikes · …".
export const storySpine = (panels = []) => {
  const groups = [];
  panels.forEach((p, i) => {
    const stage = (p.stage || '').trim();
    const last = groups[groups.length - 1];
    if (last && last.stage === stage) last.end = i + 1;
    else groups.push({ stage, start: i + 1, end: i + 1 });
  });
  return groups
    .map((g) => `${g.start === g.end ? g.start : `${g.start}–${g.end}`}${g.stage ? ` ${g.stage}` : ''}`)
    .join(' · ');
};

// The agent's NARRATIVE decision → a first-class object the Decision History logs:
// which story arc it chose, WHY it fits THIS premise, and the per-shot stage spine.
// Hidden from the main UI by design (we don't make the user pick an arc); the History
// is the audit/transparency surface, so the choice belongs there. Null when the read
// named no arc (a bare-array fallback) — then we simply log no spine.
const resolveArc = (arcId, why, panels) => {
  const def = STORY_ARC_BY_ID[arcId] || null;
  if (!def && !arcId) return null;
  const hasStages = panels.some((p) => p.stage);
  const spine = hasStages ? storySpine(panels) : (def ? def.stages : '');
  return def
    ? { id: def.id, name: def.name, category: def.category, why: why || def.fit, stages: def.stages, spine }
    : { id: arcId, name: arcId, category: '', why, stages: '', spine };
};

// ---- the read: idea + REAL assets → the shot list -------------------------------
export const readStoryboard = async ({ idea, genre = '', targetSeconds = 90, bible = [], count: countOverride, script = '', systemTemplate = 'storyboard.read.system', config } = {}, ctx) => {
  const t = String(idea || '').trim();
  if (!t) throw new Error('The storyboard needs the film idea first.');
  const anchors = (bible || []).filter((e) => e && e.url);
  if (!anchors.length) throw new Error('Tag at least one cast or place image first — the storyboard is drawn around your real assets.');

  // Caller can pin the shot count (the Contact Sheet defaults to ~12; a single-beat
  // promote pins 1); else size it from length.
  const count = Math.max(1, Math.min(50, Math.round(Number(countOverride) || shotCountFor(targetSeconds))));
  const refList = anchors.map((e, i) => `${i + 1}. ${e.role}: ${e.name || 'asset'}`).join(' · ');
  // When the user wrote/edited a SCRIPT (the Story node), the breakdown reads THAT as
  // the authoritative narrative — break it into shots, don't invent a different story.
  const scriptBlock = String(script || '').trim()
    ? `\nWork from THIS SCRIPT — break it into shots faithfully; do NOT invent a different story. Produce ONE shot per numbered beat, in the SAME order (shot N covers beat N), so the shots stay aligned to the story:\n"""\n${String(script).trim().slice(0, 4000)}\n"""\n`
    : '';
  // Tolerant shape pick: a bare array, or ANY top-level array property ({"shots":…},
  // {"panels":…}, whatever the model wrapped it in). Retry the read once when it
  // parses to nothing — output-shape variance killed a run (2026-06-12).
  const pickArray = (raw) => (Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw).find(Array.isArray) : null));
  // The read returns { arc, why, shots:[…] } — but stay tolerant of a bare array
  // (older shape / a model that ignored the wrapper): pickArray finds the shots
  // either way, and arc/why are read only when the object form is present.
  const parsed = await withRetry(async () => {
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('storyboard.read.user', { idea: t, genre: genre || 'unspecified', seconds: Math.round(Number(targetSeconds) || 90), count, refList, script: scriptBlock }),
      systemPrompt: renderTemplate(systemTemplate, { count, arcs: storyArcCatalog(), templates: shotTemplateCatalog() }),
      images: anchors.map((e) => e.url),
      modelId: getModel('reasoner', config),
      reasoningEffort: getRuntime(config).reasoningEffort,
    });
    const raw = parseJson(content);
    const shots = pickArray(raw);
    if (!shots || !shots.length) throw new Error('The storyboard read returned no shots — try rephrasing the idea.');
    return { raw, shots };
  }, { tries: 2, baseMs: 1500, shouldRetry: () => true });

  const arr = parsed.shots;
  const head = parsed.raw && !Array.isArray(parsed.raw) ? parsed.raw : {};
  const arcId = typeof head.arc === 'string' ? head.arc.trim() : '';
  const arcWhy = typeof head.why === 'string' ? head.why.replace(/\s+/g, ' ').trim().slice(0, 120) : '';

  const panels = arr.slice(0, count).map((p, i) => {
    // The chosen template carries framing + angle + move; an invalid/missing id
    // falls back to the neutral workhorse. The template's move lives in the
    // cinematography line, so the SHOT card sends camera 'auto' (no double-encode).
    const tpl = SHOT_TEMPLATE_BY_ID[p?.shotTemplate] || SHOT_TEMPLATE_BY_ID[DEFAULT_SHOT_TEMPLATE];
    return {
      index: i,
      title: String(p?.title || `Shot ${i + 1}`).slice(0, 48),
      action: String(p?.action || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      shotTemplate: tpl.id,
      framing: tpl.framing,
      angle: tpl.angle,
      camera: 'auto',
      // The chosen arc's stage this shot covers — the narrative decision, surfaced
      // only in the Decision History as the film's story spine (never in the UI).
      stage: String(p?.stage || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      durationSec: clampDuration(p?.durationSec),
      // 1-based reference numbers → the real bible entry ids this shot uses.
      refEntryIds: (Array.isArray(p?.refs) ? p.refs : []).map((n) => anchors[Number(n) - 1]?.id).filter(Boolean),
    };
  }).filter((p) => p.action);
  if (!panels.length) throw new Error('No usable shots in the storyboard read.');
  return { anchors, panels, arc: resolveArc(arcId, arcWhy, panels) };
};

// ---- Story agent v2 (REWRITTEN 2026-06-19): film → KEY EVENTS + APPEARANCE strings →
// ONE continuous text-only Seedance 2.0 prompt. Replaces the arc-shaped beats + shot-card
// breakdown: no story arc, no reference images, no per-shot cards. Identity is held by the
// APPEARANCE string (stated once at the top), the structure by the 3–4 load-bearing KEY
// EVENTS. The final prompt = our reference assets AS DESCRIPTION at the top, then the events.
const clampLine = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// Assemble the final Seedance prompt: appearances (our assets AS DESCRIPTION) at the top,
// then the key events as one continuous chain. An appearance LINKED to a bible asset (refId)
// is sent as a reference image, so we LABEL it `[ImageK]` in the SAME order shootFilm
// collects the refs (appearances.filter(refId)) — binding each image to its named character,
// not leaving the plate to float. Pure string assembly so the Story node re-assembles live.
export const composeFilmPrompt = ({ appearances = [], keyEvents = [] } = {}) => {
  let imgN = 0;
  const lines = [];
  (appearances || []).forEach((a) => {
    const string = clampLine(a?.string, 400);
    const hasRef = !!a?.refId;
    if (!string && !a?.name && !hasRef) return;
    const label = hasRef ? `[Image${(imgN += 1)}] ` : '';
    const name = a?.name ? (string ? `${a.name} — ` : a.name) : '';
    lines.push(`${label}${name}${string}`.trim());
  });
  const desc = lines.filter(Boolean).join('\n');
  const events = (keyEvents || []).map((e) => clampLine(e, 300)).filter(Boolean).join(' ');
  return [desc, events].filter(Boolean).join('\n\n');
};

export const writeKeyEvents = async ({ idea, source = '', genre = '', bible = [], config } = {}, ctx) => {
  const t = String(idea || '').trim();
  const src = String(source || '').trim();
  if (!t && !src) throw new Error('The story needs an idea or a script first.');
  // Cast/locations are OPTIONAL now — the appearance strings ARE the identity (text-only,
  // no reference images). When a bible exists, the agent describes those exact names.
  const anchors = (bible || []).filter((e) => e && e.name);
  const castList = anchors.length ? anchors.map((e) => `${e.role}: ${e.name}`).join(' · ') : '(none — invent the minimal cast)';
  const sourceBlock = src
    ? `\nSOURCE — the user's OWN story/script; PRESERVE its events (compress, do NOT rewrite into a different story):\n"""\n${src.slice(0, 6000)}\n"""\n`
    : '';
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('story.keyEvents.user', { idea: t || '(none — work from the source)', genre: genre || 'unspecified', castList, source: sourceBlock }),
    systemPrompt: renderTemplate('story.keyEvents.system'),
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const raw = parseJson(content);
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const appearances = (Array.isArray(obj.appearances) ? obj.appearances : [])
    .map((a) => ({ name: clampLine(a?.name, 60), role: a?.role === 'location' ? 'location' : 'character', string: clampLine(a?.string, 400) }))
    .filter((a) => a.string)
    .slice(0, 6);
  const keyEvents = (Array.isArray(obj.keyEvents) ? obj.keyEvents : (Array.isArray(raw) ? raw : []))
    .map((e) => clampLine(e, 300)).filter(Boolean).slice(0, 4);
  if (!keyEvents.length) throw new Error('The key events came back empty — try rephrasing the idea.');
  const mode = obj.mode === 'preserve' ? 'preserve' : (src ? 'preserve' : 'expand');
  return { mode, appearances, keyEvents, seedancePrompt: composeFilmPrompt({ appearances, keyEvents }) };
};

// A panel → one direct-to-video blueprint shot (production.js shot.direct): the
// SAME Seedance 2.0 prompt the canvas SHOT cards send, composed straight from the
// panel (no human-edited card in between). This mirrors the UI's panel→card seed
// (storyboardPanelRef) + shotFromCard compose, so the headless smoke test and the
// canvas exercise ONE shot-composition format. Headless has no sketches/audio, so
// the references are just the panel's REAL cast/location anchors.
export const panelToShot = (panel, anchors = [], genre = '') => {
  const sec = clampDuration(panel.durationSec);
  // ONE cut = framing + action (≤6s); the canvas lets the user split it further.
  const cuts = [{ action: panel.framing ? `${panel.framing}. ${panel.action}` : panel.action, seconds: Math.min(6, sec) }];
  // refEntryIds → ordered [{ url, desc }]; the desc shape matches recipes.shotReferences
  // so [Image1..N] reads identically to a canvas card. refUrls ride in the SAME order.
  const references = (panel.refEntryIds || [])
    .map((id) => (anchors || []).find((e) => e.id === id))
    .filter((e) => e && e.url)
    .map((e) => ({ url: e.url, desc: [e.name, e.role].filter(Boolean).join(' — ') }))
    .slice(0, 9);
  // The chosen shot template's cinematography line (genre-keyed fallback), exactly
  // as the card seeds it — the template's move is already in the line, so no append.
  const cinematography = shotTemplateCinematography(panel.shotTemplate, genre);
  return {
    beat: panel.title,
    direct: true,
    motion: composeSeedancePrompt({ references, cuts, cinematography, audio: '', shotTemplate: panel.shotTemplate }),
    camera: 'auto',
    durationSec: sec,
    refEntryIds: panel.refEntryIds || [],
    refUrls: references.map((r) => r.url),
  };
};

// ---- the pre-production draft: cast + places + look, from the idea ---------------
// ONE read derives everything the film needs to anchor every shot — 1–2 characters,
// 1–2 locations, ONE look frame — under a single shared visual style, so the whole
// draft is consistent BY CONSTRUCTION (the style sentence is appended to every
// plate prompt deterministically). Each is generated ONCE; those plates become the
// canonical anchors every shot then references. In the UI the results land as
// CANDIDATES with suggested-role chips — the user's tag locks them; headless runs
// (no human) adopt them directly.
const CAST_ROLE = { character: 'character', location: 'location', look: 'look' };

// Read the film's GENRE & TONE from the premise — the upstream creative knob that
// drives look, casting and shot grammar. One cheap call; surfaced to the user to
// confirm/override before any (paid) generation, then fed into the cast + storyboard.
export const detectGenre = async ({ idea, config } = {}, ctx) => {
  const t = String(idea || '').trim();
  if (!t) throw new Error('Need the premise to read the genre.');
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('genre.detect.user', { idea: t }),
    systemPrompt: renderTemplate('genre.detect.system'),
    modelId: getModel('reasoner', config),
    reasoningEffort: 'low',
  });
  const raw = parseJson(content) || {};
  return {
    genre: String(raw.genre || '').trim() || 'Drama',
    tone: String(raw.tone || '').trim(),
    treatment: String(raw.treatment || '').trim(),
    alternatives: (Array.isArray(raw.alternatives) ? raw.alternatives : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3),
  };
};

export const castFromIdea = async ({ idea, genre = '', config } = {}, ctx, hooks = {}) => {
  const t = String(idea || '').trim();
  if (!t) throw new Error('The production draft needs the film idea.');
  const onPlan = hooks.onPlan || (() => {});
  const onEntry = hooks.onEntry || (() => {});
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('storyboard.cast.user', { idea: t, genre: genre || 'unspecified' }),
    systemPrompt: renderTemplate('storyboard.cast.system'),
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const raw = parseJson(content);
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.cast) ? raw.cast : null);
  if (!arr || !arr.length) throw new Error('The production draft returned nothing — provide bible images or rephrase the idea.');
  const style = (raw && !Array.isArray(raw) && String(raw.style || '').trim()) || '';
  // The shared style rides on EVERY plate — consistency by construction.
  const withStyle = (p) => [String(p || '').trim(), style].filter(Boolean).join('. ');
  // A portrait plate is an IDENTITY ANCHOR, not a scene still. Force a clean frontal
  // reference — facing camera, neutral seamless background, no environment — appended to
  // every character FACE plate so the anchor stays reliable regardless of LLM drift.
  const PORTRAIT_SPEC = 'Subject facing camera directly, frontal, eyes to lens. Plain neutral seamless studio background, evenly lit — no scene, no environment, no location, no props.';
  // Cast plates render at 4K, each in the shape that fits it: a head PORTRAIT (3:4)
  // for facial fidelity in close-ups, a LANDSCAPE full-body TURNAROUND sheet (4:3 —
  // frontal + side views side by side) head-to-toe, a LANDSCAPE establishing frame
  // (16:9) for places. (Sketches stay 1K — see above.)
  const FACE_SIZE = resolveImageSize('4K', '3:4');
  const BODY_SIZE = resolveImageSize('4K', '4:3');
  const PLACE_SIZE = resolveImageSize('4K', '16:9');
  // Flatten the cast into a PLATE LIST. A character → a face plate + a body plate
  // (the body refs the face so the full-body sheet keeps the close-up's identity);
  // a location → one plate. Defensive: a character that returned only `prompt`
  // (old shape) becomes a single plate.
  const plates = [];
  arr.slice(0, 5).forEach((c, ci) => {
    const role = CAST_ROLE[c?.role] || 'location';
    const name = String(c?.name || `Cast ${ci + 1}`).slice(0, 40);
    const face = String(c?.facePrompt || '').trim();
    const body = String(c?.bodyPrompt || '').trim();
    const single = String(c?.prompt || '').trim();
    if (role === 'character' && face) {
      const faceKey = `cast-${ci}-face`;
      plates.push({ key: faceKey, role: 'character', name: `${name} · face`, prompt: `${withStyle(face)}. ${PORTRAIT_SPEC}`, size: FACE_SIZE });
      if (body) plates.push({ key: `cast-${ci}-body`, role: 'character', name: `${name} · body`, prompt: withStyle(body), refFrom: faceKey, size: BODY_SIZE });
    } else if (single) {
      plates.push({ key: `cast-${ci}`, role, name, prompt: withStyle(single), size: PLACE_SIZE });
    } else if (face) {
      plates.push({ key: `cast-${ci}`, role, name, prompt: withStyle(face), size: PLACE_SIZE });
    }
  });
  if (!plates.length) throw new Error('The production draft returned no usable assets — rephrase the idea.');
  // Announce the PLAN before any image renders (role + name only) so the UI can
  // place loading cards immediately — no silent minute.
  onPlan(plates.map(({ role, name }) => ({ role, name })));

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
        size,
        model: getModel('seedream', config),
      }),
      { tries: 4, baseMs: 2500, shouldRetry: (err) => isTransient(err) || isImagePolicyError(err), onRetry: (err) => { if (isImagePolicyError(err)) policyHit = true; } },
    );
  };
  const renderPlate = (p, idx) => async () => {
    try {
      // A body plate waits on its face's URL so the sheet inherits the exact face.
      const out = await genImage(p.prompt, p.refFrom ? urlByKey[p.refFrom] : null, p.size);
      urlByKey[p.key] = out.url;
      const entry = { id: p.key, role: p.role, name: p.name, url: out.url, locked: true };
      entries.push(entry);
      onEntry(entry, idx);
    } catch {
      onEntry({ id: p.key, role: p.role, name: p.name, url: '', failed: true }, idx);
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
