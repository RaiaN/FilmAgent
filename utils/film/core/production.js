// Interactive production session — the stateful orchestration engine shared by the
// SDK (headless / customer UIs) and the canvas. Built on the agent interface
// (operations.js / director.js) + an injected transport. You drive it step by step:
//
//   const p = createProduction({ idea }, transport, { onEvent });
//   await p.plan();                 // blueprint → steps → 'review-plan'
//   p.start();                      // → 'running'
//   const step = await p.runStep(); // run current step → outputs, paused at 'review'
//   p.pick(step.id, outputId);      // human decisions
//   p.approve(step.id);             // → advance (auto-stitches after the last step)
//   ...
//
// Autonomous callers use runAll() (what produce()/the Service API drive). The canvas
// drives review/auto via runStep + approve/skip + resume(). One engine, many loops.
//
// This is the node-free home of the logic that used to live in FilmCanvas
// (executeAutoStep / advanceAuto / resolveAutoInputs / stitchAuto). Step outputs and
// picks live on the step objects; the canvas mirrors them to board nodes via events.

import { inspiration, characterVariations, locationVariations, animate, isAudioPolicyError } from './operations';
import { withRetry } from './retry';
import { readySteps, runWithConcurrency, isTerminalStatus } from './parallel';
import { getAgentDefaults, maxShotSeconds, defaultVideoModelKey } from '../suiteConfig';
import { resolveBibleUrls, BIBLE_REF_CAP, EXPLICIT_REF_CAP } from '../timelineModel';

let _oid = 0;
const outId = () => `o-${Date.now().toString(36)}-${(_oid += 1).toString(36)}`;
const stepId = () => `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// ---- shared step primitive --------------------------------------------------
// Dispatch one agent op for already-resolved input URLs → outputs. Substrate-agnostic
// (URLs in; [{ url, kind, prompt, label }] out). Reused by the session and exported
// for customers who wire their own control flow.
const runAgentStep = async ({ agent, params = {}, inputUrls = [], count = 1, intent = '', config }, ctx) => {
  const outs = [];
  const collect = (it) => outs.push({ url: it.url, kind: 'image', prompt: it.prompt, label: it.label });
  const defaults = getAgentDefaults(agent, config) || {};
  const p = { ...defaults, ...params };

  switch (agent) {
    case 'inspiration':
      // In a production the refs are the chunk's deps + bible — feed them to the
      // image model too (not just the planner) so the look actually conditions it.
      await inspiration({ prompt: p.prompt || intent, refs: inputUrls, useRefsInGen: inputUrls.length > 0, count, size: p.size, config }, ctx, collect);
      return outs;
    case 'characterVariations':
      if (!inputUrls[0]) return [];
      await characterVariations({ imageUrl: inputUrls[0], direction: p.direction || intent, count, size: p.size, config }, ctx, collect);
      return outs;
    case 'locationVariations':
      if (!inputUrls[0]) return [];
      await locationVariations({ imageUrl: inputUrls[0], direction: p.direction || intent, count, size: p.size, config }, ctx, collect);
      return outs;
    case 'animate': {
      // A direct (SHOT-card) shot may carry an EXPLICIT ordered ref list (cast +
      // storyboard frame, [Image1..N] matching the prompt); else fall back to the
      // bible-resolved inputs. Non-direct uses its keyframe dep as before.
      const refs = (p.direct && Array.isArray(p.refUrls) && p.refUrls.length) ? p.refUrls.slice(0, 9) : inputUrls;
      // Parallel portrait-library ids (aligned with refs): a registered person/place
      // plate rides as image_asset_id (trusted) instead of a screened raw url.
      const refAssetIds = (p.direct && Array.isArray(p.refAssetIds)) ? p.refAssetIds.slice(0, 9) : [];
      // A DIRECT shot may be TEXT-ONLY (the Story agent's continuous-shot film — its prompt
      // alone drives it, no reference images). Only skip a non-direct shot with no inputs.
      if (!refs.length && !p.direct) return [];
      const animateOnce = async (genAudio) => {
        const { taskId, prompt: animPrompt } = await animate({
          // direct = storyboard shooting: ALL inputs ride as reference images (the
          // REAL cast/place assets + the sketch — no generated keyframe in between).
          imageUrl: p.direct ? null : inputUrls[0],
          refUrls: p.direct ? refs : [],
          refAssetIds: p.direct ? refAssetIds : [],
          firstFrameUrl: p.firstFrameUrl ?? null,  // prev shot's last frame → this shot's first frame
          audioRefUrls: p.audioRefUrls ?? [],      // the card's attached clips → reference audio (≤15s each)
          videoRefUrls: p.videoRefUrls ?? [],      // the card's attached videos → reference video (≤15s each)
          motion: p.motion || intent,
          camera: p.camera, lens: p.lens, focalLength: p.focalLength, aperture: p.aperture,
          duration: p.duration, resolution: p.resolution, ratio: p.ratio, generateAudio: genAudio,
          seed: p.seed ?? null,
          config,
        }, ctx);
        const polled = await ctx.client.pollVideo({ taskId });
        // lastFrameUrl: the native return_last_frame PNG — used for shot-to-shot continuity.
        return { videoUrl: polled.videoUrl, prompt: animPrompt, lastFrameUrl: polled.lastFrameUrl || null };
      };
      // Retry the WHOLE start+poll once on any failure (fresh task — a lapsed poll
      // can't be resumed). A re-render is cheap; a hole in the final cut is not.
      // The audio policy gets its own fallback: retake the shot WITHOUT audio —
      // re-rolling with audio on just fails again (lost 2/5 shots, 2026-06-12).
      const { videoUrl, prompt, lastFrameUrl } = await withRetry(async () => {
        try {
          return await animateOnce(p.generateAudio);
        } catch (err) {
          if (isAudioPolicyError(err)) return animateOnce(false);
          throw err;
        }
      }, { tries: 2, baseMs: 4000, shouldRetry: () => true });
      outs.push({ url: videoUrl, kind: 'video', prompt, lastFrameUrl: lastFrameUrl || null });
      return outs;
    }
    default:
      return [];
  }
};

export { runAgentStep as runStep };

// ---- the session ------------------------------------------------------------

export const createProduction = (input = {}, transport = {}, opts = {}) => {
  // (input.idea is accepted for callers' symmetry but the blueprint carries all
  // creative content — the engine never writes prompts itself.)
  const sources = (input.sources || []).filter(Boolean);
  // Length only sizes per-shot durations now (shots are 10–15s each — the quality
  // bar); the shot COUNT comes from the blueprint itself.
  const targetSeconds = Math.round(
    input.targetSeconds != null ? input.targetSeconds
      : (input.targetMinutes != null ? input.targetMinutes * 60 : 15),
  );
  // The bible — global, atemporal anchors ([{ id, role, url, locked }]) every
  // generative step references so chunks stay consistent (the drift-killer).
  const bible = (input.bible || []).filter((e) => e && e.url);
  const bibleIds = bible.map((e) => e.id);
  // The blueprint: a DETERMINISTIC shot list — REQUIRED. shots = [{ beat, roles,
  // camera, motion, promptSeed | direct }]. Plans come from the Storyboard's
  // panels, the CUT cards or the ad grammar; this engine only executes them.
  const blueprint = input.blueprint && Array.isArray(input.blueprint.shots) ? input.blueprint : null;
  const config = opts.config;
  // When set, perStepCount fixes the outputs per step (headless/produce uses 1 for
  // cost). When null (interactive default), each step uses its own params.count or
  // the agent's default count — so a reviewer gets several options to pick from.
  const perStepCount = opts.perStepCount != null ? Math.max(1, opts.perStepCount) : null;
  const ctx = { client: transport.client, config };

  let status = 'idle';
  let steps = [];
  let cursor = 0;
  let film = null;
  let error = null;
  let mode = opts.mode === 'auto' ? 'auto' : 'review';
  let executingEmitted = false;

  // Resume a persisted production (e.g. the canvas reopening a saved plan). Accepts
  // either `plan` (session shape) or `steps` (the canvas view-model); transient
  // running states are reset so a reload doesn't leave a step stuck mid-flight.
  if (opts.initialState) {
    const s0 = opts.initialState;
    const savedSteps = Array.isArray(s0.plan) ? s0.plan : (Array.isArray(s0.steps) ? s0.steps : null);
    if (savedSteps) steps = savedSteps.map((s) => ({ ...s, status: s.status === 'running' ? 'pending' : s.status }));
    if (s0.status) status = s0.status === 'assembling' ? 'running' : s0.status;
    if (typeof s0.cursor === 'number') cursor = s0.cursor;
    if (s0.mode) mode = s0.mode === 'auto' ? 'auto' : 'review';
  }

  const listeners = new Set();
  const emit = (e) => {
    listeners.forEach((l) => { try { l(e); } catch { /* listener errors never break a run */ } });
    try { opts.onEvent && opts.onEvent(e); } catch { /* ditto */ }
  };

  const aborted = () => !!(opts.signal && opts.signal.aborted);
  const find = (id) => steps.find((s) => s.id === id);
  const indexOf = (s) => steps.indexOf(s);
  const picked = (s) => (s.outputs || []).find((o) => o.id === s.pickedId) || (s.outputs || [])[0] || null;

  const cloneStep = (s) => ({
    id: s.id, agent: s.agent, title: s.title, intent: s.intent, params: s.params,
    dependsOn: s.dependsOn, gated: s.gated, status: s.status,
    outputs: (s.outputs || []).map((o) => ({ ...o })), pickedId: s.pickedId, qc: s.qc, error: s.error,
    bibleRefs: s.bibleRefs || [], refCap: s.refCap, locked: !!s.locked, feedback: s.feedback || '',
  });
  const snapshot = () => ({ status, cursor, film, error, mode, plan: steps.map(cloneStep) });
  const emitState = () => emit({ type: 'state', state: snapshot() });

  const setStatus = (s, phase) => { status = s; if (phase) emit({ type: 'phase', phase }); emitState(); };
  const markExecuting = () => { if (!executingEmitted) { executingEmitted = true; emit({ type: 'phase', phase: 'executing' }); } };

  // Inputs for a step = picked outputs of its deps (else all dep outputs); when it
  // depends on nothing, the initial sources. (port of resolveAutoInputs, node-free)
  // Then EVERY step also receives its bible references (bounded, de-duped) appended
  // AFTER the dependency inputs — so a single-image tool (animate) still keys off
  // the keyframe at [0], while batch tools (inspiration) read the look +
  // identities they must honor. This is the mechanism that kills cross-shot drift.
  const resolveInputs = (step) => {
    const base = (step.dependsOn && step.dependsOn.length)
      ? step.dependsOn.flatMap((depId) => {
          const dep = find(depId);
          if (!dep) return [];
          const pk = picked(dep);
          return dep.pickedId && pk ? [pk.url] : (dep.outputs || []).map((o) => o.url);
        })
      : sources.slice();
    // Explicitly-curated refs (CUT cards set step.refCap) get the model's real
    // limit; role-derived defaults stay tightly bounded.
    const bibleUrls = resolveBibleUrls(step.bibleRefs, bible, step.refCap || BIBLE_REF_CAP);
    const seen = new Set(base);
    return [...base, ...bibleUrls.filter((u) => !seen.has(u))];
  };

  const allTerminal = () => steps.every((s) => s.status === 'approved' || s.status === 'skipped' || s.status === 'failed');
  const approvedShots = () => steps
    .filter((s) => s.agent === 'animate' && s.status === 'approved' && picked(s))
    .map((s) => ({ stepId: s.id, url: picked(s).url, prompt: picked(s).prompt }));

  // ---- phases ----
  // Recipe-aware planning: build the plan straight from the blueprint's shot grammar.
  // Per beat → a keyframe step (an image written from the beat + idea + look, conditioned
  // on ONLY that beat's bible roles) + an animate step (the beat's camera motion). The
  // role-scoped bibleRefs are the fix for cross-shot identity bleed: a Location shot pulls
  // the location/look, never a Character face. No LLM decides the structure — predictability.
  const buildStepsFromBlueprint = () => {
    setStatus('planning', 'planning');
    const shots = blueprint.shots || [];
    // Shots are 5–15s each. The total may exceed the nominal target — the spine is
    // allowed to run over budget; the timeline can always trim.
    const perShot = Math.min(maxShotSeconds(defaultVideoModelKey()), Math.max(5, Math.round(targetSeconds / Math.max(1, shots.length))));
    // The hero must look IDENTICAL across the ad — and every shot prompt names it
    // (promptSeed's hero line), so EVERY keyframe gets the hero's bible refs in
    // addition to its beat's roles. Without this, a beat whose roles have no bible
    // coverage (hook = look-only, end-card = brand-only) generated with ZERO refs
    // and hallucinated a DIFFERENT hero. Dedup'd; resolveBibleUrls caps at 4.
    const heroIds = blueprint.heroRole ? bible.filter((e) => e.role === blueprint.heroRole).map((e) => e.id) : [];
    steps = shots.flatMap((shot) => {
      // A shot may carry EXPLICIT refs (the user-curated CUT cards) — those win
      // verbatim over the role-based selection (the cards are the review gate),
      // and get the model's real reference limit instead of the default bound.
      const explicit = Array.isArray(shot.refEntryIds);
      const refIds = explicit
        ? shot.refEntryIds.filter((rid) => bible.some((e) => e.id === rid))
        : [...new Set([...bible.filter((e) => (shot.roles || []).includes(e.role)).map((e) => e.id), ...heroIds])];
      const kfId = stepId();
      const animId = stepId();
      // Direct-to-video (storyboard cards): NO keyframe step — the animate step
      // gets the card's REAL reference assets + the storyboard frame (the SHOT
      // card resolves them into shot.refUrls, in [Image1..N] order matching the
      // composed prompt); falls back to bible-resolved refIds when not provided.
      if (shot.direct) {
        const base = {
          id: animId, agent: 'animate', title: shot.beat, intent: shot.beat,
          params: { motion: shot.motion || '', duration: shot.durationSec || perShot, camera: shot.camera || 'auto', direct: true, refUrls: shot.refUrls || [], refAssetIds: shot.refAssetIds || [], seed: shot.seed ?? null, firstFrameUrl: shot.firstFrameUrl ?? null, audioRefUrls: shot.audioRefUrls ?? [], videoRefUrls: shot.videoRefUrls ?? [], resolution: shot.resolution, ratio: shot.ratio, generateAudio: shot.generateAudio },
          dependsOn: [], gated: true, qc: null, error: null,
          // Seedance 2.0 takes up to 9 reference images — same cap as Seedream.
          bibleRefs: refIds, refCap: EXPLICIT_REF_CAP, locked: false, feedback: '',
        };
        if (shot.shotUrl) {
          const shotOut = [{ id: outId(), url: shot.shotUrl, kind: 'video', prompt: shot.motion || '' }];
          return [{ ...base, status: 'approved', outputs: shotOut, pickedId: shotOut[0].id, locked: true }];
        }
        return [{ ...base, status: 'pending', outputs: [], pickedId: null }];
      }
      // A shot the user already shot from its CUT card keeps its take: both steps
      // arrive approved with their outputs, so Action shoots only the remaining
      // cuts and the final stitch still assembles EVERYTHING in card order.
      if (shot.shotUrl) {
        const kfOut = shot.keyframeUrl ? [{ id: outId(), url: shot.keyframeUrl, kind: 'image', prompt: shot.promptSeed || shot.beat }] : [];
        const shotOut = [{ id: outId(), url: shot.shotUrl, kind: 'video', prompt: shot.motion || '' }];
        return [
          { id: kfId, agent: 'inspiration', title: shot.beat, intent: shot.beat, params: { prompt: shot.promptSeed || shot.beat, count: 1 }, dependsOn: [], gated: true, status: 'approved', outputs: kfOut, pickedId: kfOut[0]?.id || null, qc: null, error: null, bibleRefs: refIds, refCap: explicit ? EXPLICIT_REF_CAP : undefined, locked: true, feedback: '' },
          { id: animId, agent: 'animate', title: shot.beat, intent: shot.beat, params: { motion: shot.motion || '', duration: shot.durationSec || perShot, camera: shot.camera || 'auto' }, dependsOn: [kfId], gated: true, status: 'approved', outputs: shotOut, pickedId: shotOut[0].id, qc: null, error: null, bibleRefs: [], locked: true, feedback: '' },
        ];
      }
      return [
        { id: kfId, agent: 'inspiration', title: shot.beat, intent: shot.beat, params: { prompt: shot.promptSeed || shot.beat, count: 1 }, dependsOn: [], gated: true, status: 'pending', outputs: [], pickedId: null, qc: null, error: null, bibleRefs: refIds, refCap: explicit ? EXPLICIT_REF_CAP : undefined, locked: false, feedback: '' },
        // The animate step keys off the keyframe (its dep); it needs no bible refs of
        // its own. The shot's camera template + motion are the two halves of the
        // Seedance prompt; camera defaults to 'auto' (no contradicting preamble).
        { id: animId, agent: 'animate', title: shot.beat, intent: shot.beat, params: { motion: shot.motion || '', duration: shot.durationSec || perShot, camera: shot.camera || 'auto' }, dependsOn: [kfId], gated: true, status: 'pending', outputs: [], pickedId: null, qc: null, error: null, bibleRefs: [], locked: false, feedback: '' },
      ];
    });
    cursor = 0;
    setStatus('review-plan');
    emit({ type: 'plan', plan: steps.map(cloneStep) });
    return steps.map(cloneStep);
  };

  const plan = async () => {
    // Blueprint-only: the shot list comes from the Storyboard's panels, the CUT
    // cards, or the ad grammar — this engine never writes one itself.
    try {
      if (!blueprint || !blueprint.shots.length) {
        throw new Error('No shot plan — storyboard the film (🎬 Storyboard) or lay out the ad\'s cuts first.');
      }
      return buildStepsFromBlueprint();
    } catch (err) {
      // Surface failures as an error state so a UI shows "Try again", not a spinner.
      error = err.message;
      setStatus('error');
      throw err;
    }
  };

  const start = () => { status = 'running'; cursor = 0; markExecuting(); emitState(); };

  // ---- run one step (produces outputs + picks; does NOT advance) ----
  const runStep = async (id) => {
    const step = id ? find(id) : steps[cursor];
    if (!step) return null;
    markExecuting();
    step.status = 'running'; step.error = null;
    emit({ type: 'step', stepId: step.id, agent: step.agent, index: indexOf(step), total: steps.length, status: 'running' });
    emitState();
    const inputUrls = resolveInputs(step).filter(Boolean);
    const count = perStepCount != null
      ? perStepCount
      : (Number(step.params && step.params.count) || Number((getAgentDefaults(step.agent, config) || {}).count) || 1);
    try {
      const raw = await runAgentStep({ agent: step.agent, params: step.params, inputUrls, count, intent: step.intent, config }, ctx);
      if (!raw.length) {
        step.status = 'skipped'; step.outputs = [];
        emit({ type: 'step', stepId: step.id, agent: step.agent, index: indexOf(step), total: steps.length, status: 'skipped', message: 'no usable input or output' });
        emitState();
        return step;
      }
      step.outputs = raw.map((o) => ({ id: outId(), ...o }));
      const choice = step.outputs[0];
      step.pickedId = choice.id;
      step.status = 'review';
      emit({ type: 'asset', stepId: step.id, kind: choice.kind, url: choice.url });
      emit({ type: 'step', stepId: step.id, agent: step.agent, index: indexOf(step), total: steps.length, status: 'review' });
      emitState();
      return step;
    } catch (err) {
      step.status = 'failed'; step.error = err.message;
      emit({ type: 'step', stepId: step.id, agent: step.agent, index: indexOf(step), total: steps.length, status: 'failed', message: err.message });
      emitState();
      return step;
    }
  };

  // ---- human decisions ----
  const pick = (id, outputId) => { const s = find(id); if (s) { s.pickedId = outputId; emitState(); } };

  // Regenerate a chunk, optionally steered by the user's note — the human-in-the-
  // loop filter. The note is threaded into the tool's prompt/direction/motion for
  // the next pass (so it avoids the rejected result) and persisted on the step so
  // the timeline can surface it as the event's feedback. Locked steps are never
  // re-touched ("fix this, keep everything else").
  const STEER_FIELD = { inspiration: 'prompt', animate: 'motion' };
  const regenerate = (id, opts = {}) => {
    const s = find(id);
    if (!s || s.locked) return Promise.resolve(s || null);
    const note = (opts.note || '').trim();
    if (note) {
      s.feedback = note;
      const field = STEER_FIELD[s.agent] || 'direction';
      const prev = (s.params && s.params[field]) ? `${s.params[field]} ` : '';
      s.params = { ...(s.params || {}), [field]: `${prev}${note}`.trim() };
    }
    s.pickedId = null; // drop the rejected pick so the next pass starts fresh
    return runStep(id);
  };

  const advance = (auto) => {
    cursor = Math.min(cursor + 1, steps.length);
    emitState();
    if (allTerminal()) { stitch(); return; } // assemble once everything is resolved
    if (auto) resume();
  };
  const approve = (id) => {
    const s = id ? find(id) : steps[cursor];
    if (!s) return;
    s.status = 'approved';
    emit({ type: 'step', stepId: s.id, agent: s.agent, index: indexOf(s), total: steps.length, status: 'approved' });
    advance(false);
  };
  const skip = (id) => {
    const s = id ? find(id) : steps[cursor];
    if (!s) return;
    s.status = 'skipped';
    advance(false);
  };

  // ---- plan editing (canvas parity) ----
  const editStep = (id, patch) => { const s = find(id); if (s) { Object.assign(s, patch); emitState(); } };
  const toggleGate = (id) => { const s = find(id); if (s) { s.gated = !s.gated; emitState(); } };
  const addStep = (agent, atIndex) => {
    const s = { id: stepId(), agent, title: agent, intent: '', params: { ...(getAgentDefaults(agent, config) || {}) }, dependsOn: [], gated: true, status: 'pending', outputs: [], pickedId: null, qc: null, error: null, bibleRefs: bibleIds.slice(), locked: false, feedback: '' };
    steps.splice(atIndex == null ? steps.length : atIndex, 0, s);
    emitState();
    return s.id;
  };
  const removeStep = (id) => { steps = steps.filter((s) => s.id !== id); emitState(); };
  const moveStep = (id, dir) => {
    const i = steps.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    emitState();
  };
  const setMode = (m) => { mode = m === 'auto' ? 'auto' : 'review'; emitState(); };

  // ---- assemble ----
  const stitch = async () => {
    if (status === 'assembling') return film; // already stitching — ignore re-entrant calls
    const shots = approvedShots();
    const stitchFn = opts.stitch === false ? null : ((typeof opts.stitch === 'function' && opts.stitch) || transport.stitch);
    if (!shots.length) {
      emit({ type: 'warning', message: 'No animated shots approved — nothing to stitch.' });
      setStatus('done', 'done');
      return null;
    }
    setStatus('assembling', 'stitching');
    if (!stitchFn) {
      // Explicitly disabled (opts.stitch === false — e.g. a single-cut shoot) is
      // intentional, not a missing capability: end quietly.
      if (opts.stitch !== false) emit({ type: 'warning', message: 'No stitch capability provided — returning ordered shots without a final cut.' });
      setStatus('done', 'done');
      return null;
    }
    try {
      const out = await stitchFn(shots.map((s) => s.url), { outPath: opts.outPath, name: 'final-cut' });
      film = { path: out.path, url: out.url, shots: shots.length };
      emit({ type: 'film', path: out.path, url: out.url, shots: shots.length });
    } catch (err) {
      emit({ type: 'warning', message: `Stitch failed: ${err.message}` });
    }
    setStatus('done', 'done');
    return film;
  };

  // ---- runners ----
  // resume(): auto-run from the cursor, approving ungated steps, pausing at a gated
  // step (or QC fail / failure) for a human. The canvas's "auto" mode calls this.
  const resume = async () => {
    // No-op once we've left the run (so redundant resume() calls after the final
    // approve — which already auto-stitched — don't kick off a second stitch).
    if (status === 'assembling' || status === 'done' || status === 'error') return;
    status = 'running'; markExecuting();
    while (cursor < steps.length) {
      if (aborted()) throw new Error('Production aborted');
      const step = steps[cursor];
      if (step.status === 'approved' || step.status === 'skipped') { cursor += 1; continue; }
      // Locked + already produced → keep it, don't re-touch on an auto-run.
      if (step.locked && (step.outputs || []).length) { step.status = 'approved'; cursor += 1; continue; }
      if (step.status !== 'review') await runStep(step.id);
      const s = steps[cursor];
      if (s.status === 'failed') { emitState(); return; }           // pause for the human
      if (s.gated) { emitState(); return; }                          // pause for approval (QC is advisory only)
      s.status = 'approved';
      emit({ type: 'step', stepId: s.id, agent: s.agent, index: cursor, total: steps.length, status: 'approved' });
      cursor += 1;
    }
    await stitch();
  };

  // runAll(): fully autonomous — ignores gating, auto-picks, never pauses. The loop
  // produce()/the Service API drive. Resolves with the final result.
  //
  // Steps run in DEPENDENCY WAVES, not strictly sequentially: everything whose deps
  // are settled runs together through a small concurrency pool (all blueprint
  // keyframes first, then their animates as each keyframe lands). Sequential, a
  // 6-shot ad pays ~6 × (keyframe + ~2.5min render) back to back; waves cut the
  // wall-clock to roughly the longest chain. The cap keeps us from triggering the
  // server-overload shedding the retry layer absorbs. resume() (gated/interactive)
  // stays sequential — pausing for a human is inherently one-at-a-time.
  const AUTO_CONCURRENCY = 3;
  const runAll = async () => {
    mode = 'auto';
    if (!steps.length) await plan();
    status = 'running'; markExecuting();
    for (;;) {
      if (aborted()) throw new Error('Production aborted');
      const wave = readySteps(steps);
      if (!wave.length) break;
      cursor = Math.max(0, steps.findIndex((s) => !isTerminalStatus(s.status)));
      await runWithConcurrency(wave.map((step) => async () => {
        if (aborted()) return;
        if (step.locked && (step.outputs || []).length) { step.status = 'approved'; emitState(); return; }
        // An already-reviewed step (resumed session) keeps its outputs — approve it
        // without regenerating; fresh steps run. runStep marks failures itself.
        if (step.status !== 'review') await runStep(step.id);
        if (step.status === 'review') {
          step.status = 'approved';
          emit({ type: 'step', stepId: step.id, agent: step.agent, index: indexOf(step), total: steps.length, status: 'approved' });
          emitState();
        }
        // failed steps are left behind (treated as skipped for assembly)
      }), AUTO_CONCURRENCY);
    }
    cursor = steps.length;
    await stitch();
    return result();
  };

  const result = () => ({
    plan: steps.map(cloneStep),
    shots: approvedShots(),
    assets: steps.filter((s) => picked(s)).map((s) => ({ stepId: s.id, kind: picked(s).kind, url: picked(s).url, prompt: picked(s).prompt })),
    film,
  });

  return {
    get state() { return snapshot(); },
    on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    plan, start,
    runStep, pick, approve, regenerate, skip,
    editStep, addStep, removeStep, moveStep, toggleGate, setMode,
    resume, stitch, runAll, result,
  };
};
