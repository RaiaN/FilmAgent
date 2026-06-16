// Storyboard — the plan between casting and filming (the Film pipeline's stage 3).
// One reason call STUDIES the real tagged assets (the VLM sees the actual cast and
// places) + the idea, and breaks the film into 5–15s shots: what happens, the chosen
// SHOT TEMPLATE (one of the 50 in the cinematography library — angle/framing/move),
// duration, and WHICH real assets appear. Then each shot is rendered as a PHOTOREAL
// storyboard frame: the shot's real cast plates + location plate condition a
// photographed film still that places the cast IN the location, in that framing.
//
// The frame is generated FROM the real plates (so it inherits their identity) and at
// shoot time rides to Seedance ALONGSIDE those same real plates (shotReferences puts
// the plates first, the frame last) — so identity is never sourced from a generated
// image alone, and the frame adds exact composition/blocking/light.
//
// Pure core — canvas/SDK inject ctx { client, config }.

import { renderTemplate, getModel, getRuntime } from '../suiteConfig';
import { resolveImageSize } from '../imageSizes';
import { composeSeedancePrompt, shotTemplateCatalog, shotTemplateCinematography, SHOT_TEMPLATE_BY_ID } from '../recipes';
import { parseJson } from './director';
import { withRetry } from './retry';
import { runWithConcurrency } from './parallel';

// Shots are 5–15s (each breaks into cuts of ≤5–6s) → a 60–180s film is ~6–18 shots.
export const shotCountFor = (seconds) => Math.max(2, Math.min(18, Math.round((Number(seconds) || 90) / 10)));

// Clamp any shot duration into the 5–15s range (no longer a fixed 10/12/15 list).
const clampDuration = (d) => Math.min(15, Math.max(5, Math.round(Number(d) || 10)));

// Fallback when the Shot agent returns no/invalid template id — a neutral workhorse.
const DEFAULT_SHOT_TEMPLATE = 'medium-shot';

// ---- the read: idea + REAL assets → the shot list -------------------------------
export const readStoryboard = async ({ idea, genre = '', targetSeconds = 90, bible = [], config } = {}, ctx) => {
  const t = String(idea || '').trim();
  if (!t) throw new Error('The storyboard needs the film idea first.');
  const anchors = (bible || []).filter((e) => e && e.url);
  if (!anchors.length) throw new Error('Tag at least one cast or place image first — the storyboard is drawn around your real assets.');

  const count = shotCountFor(targetSeconds);
  const refList = anchors.map((e, i) => `${i + 1}. ${e.role}: ${e.name || 'asset'}`).join(' · ');
  // Tolerant shape pick: a bare array, or ANY top-level array property ({"shots":…},
  // {"panels":…}, whatever the model wrapped it in). Retry the read once when it
  // parses to nothing — output-shape variance killed a run (2026-06-12).
  const pickArray = (raw) => (Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw).find(Array.isArray) : null));
  const arr = await withRetry(async () => {
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('storyboard.read.user', { idea: t, genre: genre || 'unspecified', seconds: Math.round(Number(targetSeconds) || 90), count, refList }),
      systemPrompt: renderTemplate('storyboard.read.system', { count, templates: shotTemplateCatalog() }),
      images: anchors.map((e) => e.url),
      modelId: getModel('reasoner', config),
      reasoningEffort: getRuntime(config).reasoningEffort,
    });
    const got = pickArray(parseJson(content));
    if (!got || !got.length) throw new Error('The storyboard read returned no shots — try rephrasing the idea.');
    return got;
  }, { tries: 2, baseMs: 1500, shouldRetry: () => true });

  const panels = arr.slice(0, count).map((p, i) => {
    // The chosen template carries framing + angle + move; an invalid/missing id
    // falls back to the neutral workhorse. The template's move lives in the
    // cinematography line, so the SHOT card sends camera 'auto' (no double-encode).
    const tpl = SHOT_TEMPLATE_BY_ID[p?.shotTemplate] || SHOT_TEMPLATE_BY_ID[DEFAULT_SHOT_TEMPLATE];
    return {
      index: i,
      title: String(p?.title || `Shot ${i + 1}`).slice(0, 48),
      action: String(p?.action || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      shotTemplate: tpl.id,
      framing: tpl.framing,
      angle: tpl.angle,
      camera: 'auto',
      durationSec: clampDuration(p?.durationSec),
      // 1-based reference numbers → the real bible entry ids this shot uses.
      refEntryIds: (Array.isArray(p?.refs) ? p.refs : []).map((n) => anchors[Number(n) - 1]?.id).filter(Boolean),
    };
  }).filter((p) => p.action);
  if (!panels.length) throw new Error('No usable shots in the storyboard read.');
  return { anchors, panels };
};

// ---- the frames: one PHOTOREAL still per shot (parallel, retried) ----------------
// Each shot's real cast plates + location plate condition a photographed film still
// that PLACES the cast in the location, in the shot's framing/angle. The frame both
// shows the user the real composition AND rides to Seedance as a composition ref
// (the real plates ride too — see shotReferences). A failed frame never sinks the
// plan (the card lands bare). The result is stored on `sketchUrl` (legacy field name
// kept to avoid a wide refactor — it now holds a photoreal frame, not a drawing).
export const renderFrames = async ({ panels = [], anchors = [], config } = {}, ctx, hooks = {}) => {
  const h = { onPanel: hooks.onPanel || (() => {}), onError: hooks.onError || (() => {}) };
  const frameOne = (panel) => async () => {
    // The shot's chosen refs, then GUARANTEE a location is present so the cast is
    // actually placed in an environment (the agent doesn't always tag the place).
    const refEntries = (panel.refEntryIds || [])
      .map((id) => anchors.find((e) => e.id === id))
      .filter((e) => e && e.url);
    if (!refEntries.some((e) => e.role === 'location')) {
      const loc = anchors.find((e) => e.role === 'location' && e.url);
      if (loc) refEntries.push(loc);
    }
    const refs = refEntries.map((e) => e.url).slice(0, 6);
    try {
      const out = await withRetry(
        () => ctx.client.generateImage({
          prompt: renderTemplate('storyboard.frame', { framing: panel.framing, angle: panel.angle || 'eye-level', action: panel.action }),
          referenceImages: refs,
          // Photoreal frames render at 4K (same tier as the cast plates) for real
          // storyboarding fidelity. Only table tiers exist (2K/3K/4K) — never '1K'.
          size: resolveImageSize('4K', '16:9'),
          model: getModel('seedream', config),
        }),
        { tries: 3, baseMs: 2500 },
      );
      h.onPanel({ ...panel, sketchUrl: out.url });
    } catch (err) {
      h.onError(`Panel ${panel.index + 1} (${panel.title}): ${err.message}`);
      h.onPanel({ ...panel, sketchUrl: '' });
    }
  };
  await runWithConcurrency(panels.map(frameOne), 3);
};

// The UI agent's one-call flow: read, then render frames, streaming cards via hooks.
// hooks.onPlan(panels) fires the MOMENT the shot list is read — so the UI can
// place the cards (prompts visible) immediately and the photoreal frames fill in
// after, instead of a silent wait while every frame renders.
export const createStoryboard = async ({ idea, genre = '', targetSeconds = 90, bible = [], config } = {}, ctx, hooks = {}) => {
  const { anchors, panels } = await readStoryboard({ idea, genre, targetSeconds, bible, config }, ctx);
  if (hooks.onPlan) hooks.onPlan(panels);
  await renderFrames({ panels, anchors, config }, ctx, hooks);
  return { panels: panels.length, plannedSeconds: panels.reduce((s, p) => s + p.durationSec, 0) };
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
    motion: composeSeedancePrompt({ references, cuts, cinematography, audio: '' }),
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
const CAST_ROLE = { character: 'talent', location: 'location', look: 'look' };

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
  // Cast plates render at 4K, each in the shape that fits it: a head PORTRAIT (3:4)
  // for facial fidelity in close-ups, a TALL full-body sheet (2:3) head-to-toe, a
  // LANDSCAPE establishing frame (16:9) for places. (Sketches stay 1K — see above.)
  const FACE_SIZE = resolveImageSize('4K', '3:4');
  const BODY_SIZE = resolveImageSize('4K', '2:3');
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
    if (role === 'talent' && face) {
      const faceKey = `cast-${ci}-face`;
      plates.push({ key: faceKey, role: 'talent', name: `${name} · face`, prompt: withStyle(face), size: FACE_SIZE });
      if (body) plates.push({ key: `cast-${ci}-body`, role: 'talent', name: `${name} · body`, prompt: withStyle(body), refFrom: faceKey, size: BODY_SIZE });
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
  const genImage = (prompt, refUrl, size) => withRetry(
    () => ctx.client.generateImage({
      prompt,
      ...(refUrl ? { referenceImages: [refUrl] } : {}),
      size,
      model: getModel('seedream', config),
    }),
    { tries: 3, baseMs: 2500 },
  );
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
