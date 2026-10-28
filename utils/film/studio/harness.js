// THE HARNESS — the eight parts every crew member is made of (docs/studio.md).
//
//   read · guard · think · each · step both phases  (step: the stage the job is on, shown live)
//   ask · sheet · go                   PLAN only  (decide what a request will do; never spends)
//   make · check · open · spend · addElements    RUN only   (do it; every result is a version)
//   reply · reviseShot                            RUN only   (the Shot answers in words and edits itself)
//
// The two phases get two different views of the harness, so a plan cannot make or deliver
// and a run cannot ask: the rules hold by construction.
import {
  uid, threadKeyOf, findScene, findShot, versionOf, addVersion, patchVersion, addMessage, patchMessage,
  shotNumber, pad2, unplatedOf,
} from './model';
import { startTake } from '../core/shoot';
import { finishDraft } from '../core/operations';
import { runWithConcurrency } from '../core/parallel';
import { preserveAsset } from '../canvasModel';
import { absLocalMediaUrl } from '../mediaUrl';
import { DRAFT_MODE, AUTO_SECONDS } from '../suiteConfig';

export const VIDEO_MODEL = 'seedance25';
export const FINAL_RES = '1080p';
const RATIO = '16:9';

const postJson = async (path, body, what) => {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.details || what);
  return j;
};

export const createHarness = ({ get, set, ctx, stageOf = () => '' }) => {
  const say = (scope, msg) => { const id = uid('m-'); set((s) => addMessage(s, threadKeyOf(scope), { id, ...msg })); return id; };
  const sayPatch = (scope, id, patch) => set((s) => patchMessage(s, threadKeyOf(scope), id, patch));

  // ---- READ: the context a request works from ------------------------------------------------
  const read = {
    state: () => get(),
    // The shots a request covers: a shot scope is that shot, a scene scope its shots.
    shots: (scope, s = get()) => {
      if (scope.type === 'shot') { const sh = findShot(s, scope.sceneId, scope.id); return sh ? [{ sceneId: scope.sceneId, shot: sh }] : []; }
      const sc = findScene(s, scope.id);
      return sc ? sc.shots.map((shot) => ({ sceneId: sc.id, shot })) : [];
    },
    // The shot before this one in film order (across scenes).
    prev: (shotId, s = get()) => {
      const all = s.scenes.flatMap((sc) => sc.shots);
      const i = all.findIndex((x) => x.id === shotId);
      return i > 0 ? all[i - 1] : null;
    },
    label: (shot, s = get()) => `${pad2(shotNumber(s, shot.id))} ${shot.title}`,
    version: (ref, vid, s = get()) => versionOf(s, ref, vid),
    lastFrame: async (take) => {
      if (take.lastFrameUrl) return take.lastFrameUrl;
      const j = await postJson('/api/film/last-frame', { url: absLocalMediaUrl(take.cacheUrl || take.url) }, 'Could not read the last frame');
      if (!j.url) throw new Error('Could not read the last frame');
      return j.url;
    },
  };

  // ---- GUARD: a loud stop that names the fix --------------------------------------------------
  const guard = (ok, fix) => { if (!ok) throw new Error(fix); };

  // ---- THINK: one planner / vision call through a core verb (free) ------------------------------
  const think = (verb, args) => verb(args, ctx);

  // ---- EACH: a scene-wide request over its shots, a few at a time ------------------------------
  const each = (items, fn, n = 3) => runWithConcurrency(items.map((x) => () => fn(x)), n);

  // ---- ASK / SHEET / GO: what a plan returns --------------------------------------------------
  // A question's options are requests.
  const ask = (text, options) => ({ question: { text, options } });
  // The crew never invents a face or a place: a named element without a plate is a question.
  ask.unplated = (req, shots, s = get()) => {
    if (req.force) return null;
    const missing = [...new Map(shots.flatMap(({ shot }) => unplatedOf(s, shot)).map((e) => [e.id, e])).values()];
    if (!missing.length) return null;
    return ask(`${missing.map((e) => e.name).join(', ')} ${missing.length === 1 ? 'has' : 'have'} no plate.`, [
      ...missing.slice(0, 3).map((e) => ({ label: `Cast ${e.name}`, req: { agent: e.kind === 'character' ? 'casting' : 'designer', action: 'variation', scope: { type: 'element', id: e.id }, text: e.desc || e.name } })),
      { label: 'Go ahead without', req: { ...req, force: true } },
    ]);
  };
  const sheet = (jobs, summary, payload, counts = {}) => ({ sheet: { jobs, summary, payload, ...counts } });
  const go = (payload = {}) => ({ now: true, payload });

  // ---- a VERSION: running → review | failed ----------------------------------------------------
  const version = (ref, vid) => ({
    ref, id: vid,
    patch: (p) => set((s) => patchVersion(s, ref, vid, p)),
    done: (p) => set((s) => patchVersion(s, ref, vid, { status: 'review', ...p })),
    fail: (e) => set((s) => patchVersion(s, ref, vid, { status: 'failed', error: e?.message || String(e) })),
  });

  // ---- CHECK: what a result is flagged with ----------------------------------------------------
  const check = {
    // Every element the shot names sent its plate — or which did not.
    plates: (shot, s = get()) => {
      const missing = unplatedOf(s, shot).map((e) => e.name);
      return missing.length ? [{ warn: true, text: `No plate: ${missing.join(', ')}` }] : [{ text: 'Every plate sent' }];
    },
    warn: (text) => ({ warn: true, text }),
    note: (text) => ({ text }),
  };

  // ---- MAKE: the engines ------------------------------------------------------------------------
  // A version's inputs as recorded: what each reference was, its picture, and where it came from.
  const inputsOf = (list) => list.map((r, i) => ({ n: i + 1, label: r.label, url: r.url, role: r.opening ? 'first frame' : 'reference', elementId: r.elementId || null, versionId: r.versionId || null }));
  // An asset:// id for every plate a take sends (photoreal people need it); persisted on the
  // element version it came from so the next take reuses it.
  const registerRefs = async (list, missed) => Promise.all(list.map(async (r) => {
    if (r.assetId || !r.url) return r.assetId || null;
    try {
      const { assetId } = await preserveAsset(absLocalMediaUrl(r.url), r.label);
      if (assetId && r.elementId && r.versionId && !r.extra) set((s) => patchVersion(s, { at: 'element', id: r.elementId }, r.versionId, { assetId }));
      if (!assetId) missed.push(r.label);
      return assetId || null;
    } catch { missed.push(r.label); return null; }
  }));
  const poster = async (url) => {
    try { const { frames } = await ctx.client.extractFrames({ url, timestamps: [0.5], maxWidth: 480 }); return frames?.[0]?.url || ''; } catch { return ''; }
  };
  const poll = async (v, taskId, { draft, flags: extra = [], modelKey = VIDEO_MODEL } = {}) => {
    const r = await ctx.client.pollVideo({ taskId });
    const url = r.videoCacheUrl || r.videoUrl;
    const format = /\.mov(\?|$)/i.test(r.videoUrl || '') ? 'mov' : 'mp4';
    const flags = [
      check.note('Every reference sent as an Asset Library asset'),
      ...extra,
    ];
    v.done({ url: r.videoUrl, cacheUrl: r.videoCacheUrl || null, lastFrameUrl: r.lastFrameCacheUrl || r.lastFrameUrl || '', format, taskId: null, ...(draft ? { draft: { taskId, modelKey, at: Date.now() } } : {}), flags, posterUrl: await poster(url) });
  };
  const make = {
    // Images (and anything else a core verb renders) — same call shape as think, paid.
    image: (verb, args, hooks) => verb(args, ctx, hooks),
    // One take: shoot, poll, store; resolves when it lands. An EDIT rides its master as
    // @video1 and sends neither ratio nor duration — both follow the source.
    take: async ({ v, prompt, list, seconds, draft, master = null, flags = [], modelKey = VIDEO_MODEL }) => {
      // Every reference goes as an Asset Library asset — a raw image is never sent.
      const missed = [];
      const refAssetIds = await registerRefs(list, missed);
      if (missed.length) throw new Error(`Could not add ${missed.join(', ')} to the Asset Library — the take is not shot without ${missed.length === 1 ? 'it' : 'them'}.`);
      const shot = master
        ? { motion: prompt, refUrls: list.map((r) => r.url), refRoles: [], durationSec: AUTO_SECONDS, resolution: FINAL_RES, ratio: null, generateAudio: true, modelKey: VIDEO_MODEL, draft: false, outputFormat: 'mov', videoRefUrls: [master], videoRefAssetIds: [null] }
        : { motion: prompt, refUrls: list.map((r) => r.url), refRoles: [], durationSec: seconds, resolution: draft ? DRAFT_MODE.resolution : FINAL_RES, ratio: RATIO, generateAudio: true, modelKey, draft };
      let taskId;
      try {
        ({ taskId } = await startTake(shot, refAssetIds, ctx, { nameOf: (u) => list.find((r) => r.url === u)?.label || 'a reference image' }));
      } catch (e) {
        // An asset Ark no longer has: forget the id on the plate it came from, so the take
        // the director asks for next registers the picture anew.
        const r = e?.staleAsset && list.find((x) => x.url === e.staleAsset.url);
        if (r?.elementId && r.versionId) set((s) => patchVersion(s, { at: 'element', id: r.elementId }, r.versionId, { assetId: null }));
        throw e;
      }
      // What the take was made from, as sent: the prompt and every reference in [Image N] order.
      v.patch({ taskId, prompt, ...(list.length ? { inputs: inputsOf(list) } : {}) });
      await poll(v, taskId, { draft, flags, modelKey });
    },
    // A circled draft finished on the model that drafted it, 10-bit MOV — the same picture.
    finish: async ({ v, draftTake, resolution = FINAL_RES }) => {
      const { taskId } = await finishDraft({ draftTaskId: draftTake.draft.taskId, modelKey: draftTake.draft.modelKey || VIDEO_MODEL, resolution, outputFormat: 'mov' }, ctx);
      v.patch({ taskId });
      await poll(v, taskId, { draft: false });
    },
    // An edit's source as an asset:// id, kept on its version so the next edit reuses it.
    source: async (ref, v, name) => {
      if (v.assetId) return v.assetId;
      const { assetId } = await preserveAsset(absLocalMediaUrl(v.cacheUrl || v.url), name);
      if (!assetId) throw new Error('Could not register the source video as an asset.');
      set((s) => patchVersion(s, ref, v.id, { assetId }));
      return assetId;
    },
    // Clips into one file; the server keeps it in the media store.
    stitch: async (urls, name) => {
      const j = await postJson('/api/film/stitch', { shots: urls.map(absLocalMediaUrl), name }, 'Assembly failed');
      if (!j.cacheUrl) throw new Error('The assembled cut was not stored');
      return { url: j.cacheUrl, posterUrl: await poster(j.cacheUrl) };
    },
    poll,
  };

  // ---- OPEN: a request's delivery — versions announced in its thread, provenance attached -----
  const deliver = (req) => {
    const who = req.agent;
    const note = String(req.note || '').trim();
    const parent = req.from?.vid || null;
    const msg = say(req.scope, { from: who, kind: 'delivery', items: [] });
    const open = (ref, base) => {
      const vid = uid('v-');
      set((s) => addVersion(s, ref, { id: vid, at: Date.now(), status: 'running', by: who, parent, note, ...base }));
      set((s) => {
        const k = threadKeyOf(req.scope);
        return { ...s, threads: { ...s.threads, [k]: (s.threads[k] || []).map((m) => (m.id === msg ? { ...m, items: [...(m.items || []), { ref, vid }] } : m)) } };
      });
      return version(ref, vid);
    };
    // A reply in the request's thread (the Shot answers in words, not in versions).
    const reply = (m) => say(req.scope, { from: who, ...m });
    // What the crew is doing right now, on the request's message (the thread and the plan show it).
    const stage = (text) => sayPatch(req.scope, msg, { stage: text, stageAt: Date.now() });
    return { open, note, reply, stage, end: () => sayPatch(req.scope, msg, { finished: true }) };
  };
  // A shot's text and references changed by the crew; what they were rides on the reply so
  // the director can undo it.
  const reviseShot = (sceneId, shotId, patch) => {
    const before = findShot(get(), sceneId, shotId);
    if (!before) throw new Error('That shot is gone.');
    set((s) => ({ ...s, scenes: s.scenes.map((sc) => (sc.id !== sceneId ? sc : { ...sc, shots: sc.shots.map((sh) => (sh.id === shotId ? { ...sh, ...patch } : sh)) })) }));
    return { motion: before.motion, elementIds: before.elementIds };
  };
  const spend = (n) => set((s) => ({ ...s, gens: (s.gens || 0) + n }));
  // Elements a delivery brings with it (Casting's new cast and places).
  const addElements = (els) => { if (els.length) set((s) => ({ ...s, elements: [...s.elements, ...els] })); };

  // STAGES: every planner call and every render names itself as it starts, so the director
  // sees what the crew is doing now ("Planning the cast", "Seedance is rendering").
  const staged = (tell = () => {}) => ({
    step: tell,
    think: (verb, args) => { tell(stageOf(verb) || 'Thinking'); return think(verb, args); },
    make: {
      ...make,
      image: (verb, args, hooks) => { tell(stageOf(verb) || 'Rendering images'); return make.image(verb, args, hooks); },
      take: (o) => { tell('Seedance is rendering'); return make.take(o); },
      finish: (o) => { tell(`Finishing at ${o.resolution || FINAL_RES}`); return make.finish(o); },
      source: (...a) => { tell('Registering the source clip'); return make.source(...a); },
      stitch: (...a) => { tell('Assembling the cut'); return make.stitch(...a); },
    },
  });
  const both = { read, guard, think, each };
  return {
    plan: (onStage) => { const st = staged(onStage); return { ...both, think: st.think, step: st.step, ask, sheet, go }; },
    run: (req) => {
      const d = deliver(req);
      const st = staged(d.stage);
      return { h: { ...both, think: st.think, step: st.step, make: st.make, check, open: d.open, note: d.note, reply: d.reply, reviseShot, spend, addElements }, end: d.end };
    },
    version,
    make,
  };
};
