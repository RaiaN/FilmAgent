// The Filming Loop — the Short Film engine. Unlike createProduction (plan all
// shots upfront, batch-generate), a filming session GROWS the movie chunk by chunk:
//
//   generateNext({ beat, durationSec, aspects })   10–15s from the beat + bible
//   → VALIDATE (human gate; QC advisory on the keyframe flags identity drift)
//   → correct(chunkId, { aspects, note })          re-ANIMATE only — same keyframe,
//                                                  new camera language / action /
//                                                  cinematic rules (cheapest altitude)
//   → proposeBeats()                               storytelling (the queen): 2–3 next
//                                                  beats from the story so far
//   → generateNext(...)                            the next chunk
//
// CHARACTER CONSISTENCY IS THE KING: every keyframe is generated under the
// preservation persona with the previous chunk's LAST FRAME (extracted via the
// injected transport.lastFrame) + the bible's cast/world anchors as references —
// same faces, same world, chunk after chunk. The timeline is just a view; this
// session is the driver. Node-free; canvas and SDK inject the transport.

import { inspiration, animate, suggestNextBeats, isAudioPolicyError } from './operations';
import { qcStep } from './director';
import { withRetry } from './retry';

let _seq = 0;
const chunkId = () => `ch-${Date.now().toString(36)}-${(_seq += 1).toString(36)}`;

export const CHUNK_MIN_SECONDS = 10;
export const CHUNK_MAX_SECONDS = 15;
const clampChunkSeconds = (v) => Math.min(CHUNK_MAX_SECONDS, Math.max(CHUNK_MIN_SECONDS, Math.round(Number(v) || 12)));

// The king's reference order: cast identity first (talent/character), then the
// hero/subject, then the world — capped so the image model isn't swamped.
const CAST_FIRST = ['talent', 'character', 'product', 'location', 'look', 'style', 'prop', 'brand'];
export const castFirstUrls = (bible = [], cap = 4) => {
  const weight = (r) => { const i = CAST_FIRST.indexOf(r); return i < 0 ? CAST_FIRST.length : i; };
  const seen = new Set();
  return [...bible]
    .filter((e) => e && e.url)
    .sort((a, b) => weight(a.role) - weight(b.role))
    .filter((e) => (seen.has(e.url) ? false : seen.add(e.url)))
    .map((e) => e.url)
    .slice(0, cap);
};

export const createFilmingSession = (input = {}, transport = {}, opts = {}) => {
  const config = opts.config;
  const ctx = { client: transport.client, config };
  // Live getters so a chunk generated later sees the CURRENT idea/bible, not a
  // snapshot from when the session was built.
  const getIdea = opts.getIdea || (() => (input.idea || ''));
  const getBible = opts.getBible || (() => (input.bible || []));

  let chunks = [];
  let story = []; // beats of VALIDATED chunks — what has happened so far
  if (opts.initialState) {
    // A reload never resumes a mid-flight render — mark it failed so Retry works.
    chunks = (opts.initialState.chunks || []).map((c) => ({ ...c, status: c.status === 'generating' ? 'failed' : c.status }));
    story = [...(opts.initialState.story || [])];
  }

  const snapshot = () => ({ chunks: chunks.map((c) => ({ ...c, aspects: { ...(c.aspects || {}) } })), story: [...story] });
  const emit = (e) => { try { opts.onEvent && opts.onEvent(e); } catch { /* listener errors never break a take */ } };
  const emitState = () => emit({ type: 'state', state: snapshot() });

  const last = () => chunks[chunks.length - 1] || null;
  const lastValidated = () => [...chunks].reverse().find((c) => c.status === 'validated') || null;

  // ---- storytelling (the queen): what could happen next? ----------------------
  const proposeBeats = async (count = 3) => {
    const prev = lastValidated();
    return suggestNextBeats({
      idea: getIdea(),
      steps: story,
      lastImageUrl: prev ? (prev.lastFrameUrl || prev.keyframeUrl || undefined) : undefined,
      count,
      config,
    }, ctx);
  };

  // ---- render (and re-render) a chunk's shot from its keyframe + aspects ------
  const renderShot = async (chunk) => {
    const a = chunk.aspects || {};
    const motion = [a.action, a.rules, a.note].map((s) => (s || '').trim()).filter(Boolean).join('. ');
    const renderOnce = async (genAudio) => {
      const { taskId } = await animate({
        imageUrl: chunk.keyframeUrl,
        motion,
        camera: a.camera || 'auto',
        duration: chunk.durationSec,
        resolution: '1080p',
        generateAudio: genAudio,
        config,
      }, ctx);
      return ctx.client.pollVideo({ taskId });
    };
    // The audio policy kills otherwise-good takes — retake once WITHOUT audio
    // rather than lose the shot (re-rolling with audio on just fails again).
    const { videoUrl } = await withRetry(async () => {
      try {
        return await renderOnce(true);
      } catch (err) {
        if (isAudioPolicyError(err)) return renderOnce(false);
        throw err;
      }
    }, { tries: 2, baseMs: 4000, shouldRetry: () => true });
    chunk.shotUrl = videoUrl;
    // Extract the final frame NOW so Continue is instant. The injected capability
    // is transport-specific (browser → /api/film/last-frame; SDK → local ffmpeg).
    // Advisory on failure: the keyframe still chains continuity, just less exactly.
    if (typeof transport.lastFrame === 'function') {
      try {
        const out = await transport.lastFrame(videoUrl);
        chunk.lastFrameUrl = (out && out.url) || chunk.keyframeUrl;
      } catch (err) {
        emit({ type: 'warning', message: `Couldn't extract the last frame (${err.message}) — continuing from the keyframe instead.` });
        chunk.lastFrameUrl = chunk.keyframeUrl;
      }
    } else {
      chunk.lastFrameUrl = chunk.keyframeUrl;
    }
  };

  // ---- generate the next 10–15s ------------------------------------------------
  const generateNext = async ({ beat, durationSec, aspects = {} } = {}) => {
    const beatText = String(beat || '').trim();
    if (!beatText) throw new Error('Give the chunk a beat — what happens in these seconds?');
    const open = last();
    if (open && open.status !== 'validated') throw new Error('Approve (or fix) the current chunk before continuing the story.');

    const chunk = {
      id: chunkId(),
      index: chunks.length,
      beat: beatText,
      durationSec: clampChunkSeconds(durationSec),
      aspects: { camera: aspects.camera || 'auto', action: aspects.action || '', rules: aspects.rules || '', note: '' },
      keyframeUrl: '', shotUrl: '', lastFrameUrl: '',
      qc: null, status: 'generating', error: null,
    };
    chunks.push(chunk);
    emit({ type: 'phase', phase: chunks.length === 1 ? 'filming-first' : 'filming-next' });
    emitState();

    try {
      // THE KING: previous chunk's last frame leads, then cast-first bible anchors.
      const prev = lastValidated();
      const refs = [...(prev && prev.lastFrameUrl ? [prev.lastFrameUrl] : []), ...castFirstUrls(getBible(), prev ? 3 : 4)];
      const outs = [];
      await inspiration({
        prompt: [beatText, getIdea()].map((s) => (s || '').trim()).filter(Boolean).join('. '),
        refs,
        useRefsInGen: refs.length > 0,
        count: 1,
        size: '2K',
        planTask: 'adShot', // preservation persona — refs are canonical, not inspiration
        config,
      }, ctx, (item) => outs.push(item));
      if (!outs[0] || !outs[0].url) throw new Error('No keyframe was generated for this chunk');
      chunk.keyframeUrl = outs[0].url;
      emitState();

      // QC advisory on the KEYFRAME — identity drift is caught before the (much
      // more expensive) animate, and surfaces as a badge; the human gate decides.
      try {
        chunk.qc = await qcStep({ agent: 'inspiration', intent: beatText, references: refs, outputs: [chunk.keyframeUrl], config }, ctx);
      } catch { /* advisory only */ }
      emitState();

      await renderShot(chunk);
      chunk.status = 'draft';
    } catch (err) {
      chunk.status = 'failed';
      chunk.error = err.message;
    }
    emitState();
    return chunks[chunks.length - 1];
  };

  // ---- correct: re-ANIMATE the current chunk with adjusted aspects -------------
  // Same keyframe (identity untouched), new camera language / action / rules /
  // note. Only the working (last, unvalidated) chunk is correctable — earlier
  // chunks are part of the validated chain the story already continued from.
  const correct = async (id, { aspects = {}, note } = {}) => {
    const chunk = chunks.find((c) => c.id === id);
    if (!chunk) throw new Error('Unknown chunk');
    if (chunk !== last()) throw new Error('Only the current chunk can be corrected — earlier ones are approved and chained.');
    if (chunk.status === 'validated') throw new Error('This chunk is approved. Continue the story instead.');
    if (!chunk.keyframeUrl) throw new Error('This chunk has no keyframe — generate it again.');
    chunk.aspects = { ...chunk.aspects, ...aspects, ...(note != null ? { note: String(note) } : {}) };
    chunk.status = 'generating';
    chunk.error = null;
    emit({ type: 'phase', phase: 'correcting' });
    emitState();
    try {
      await renderShot(chunk);
      chunk.status = 'draft';
    } catch (err) {
      chunk.status = 'failed';
      chunk.error = err.message;
    }
    emitState();
    return chunk;
  };

  // ---- validate: the human gate -------------------------------------------------
  const validate = (id) => {
    const chunk = chunks.find((c) => c.id === id);
    if (!chunk || chunk.status !== 'draft') return chunk || null;
    chunk.status = 'validated';
    story.push(chunk.beat); // the story so far grows only from approved chunks
    emitState();
    return chunk;
  };

  // ---- assemble the validated chain --------------------------------------------
  const stitch = async () => {
    const shots = chunks.filter((c) => c.status === 'validated' && c.shotUrl).map((c) => c.shotUrl);
    if (!shots.length) throw new Error('No approved chunks to assemble yet.');
    if (typeof transport.stitch !== 'function') throw new Error('No stitch capability provided.');
    const out = await transport.stitch(shots, { name: 'short-film' });
    emit({ type: 'film', url: out.url, assetId: out.assetId || null, shots: shots.length });
    return out;
  };

  return {
    get state() { return snapshot(); },
    proposeBeats,
    generateNext,
    correct,
    validate,
    stitch,
  };
};
