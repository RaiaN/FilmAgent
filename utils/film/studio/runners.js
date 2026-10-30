// THE CREW AT WORK — one entry per job, each made of the harness parts (harness.js) and held to
// its contract (crew.js: where it works, what it delivers, where that lands).
//
//   plan(h, req)          → ask | go             (read · guard · think · ask · go; never spends)
//   run(h, req, payload)  → versions to review   (read · think · make · check · open)
//
// A request: { agent, action, scope, text, note?, from?: { ref, vid }, force? }. `@Agent` runs
// at once: the plan checks the request and says what it will make, the run makes it.
import {
  uid, findScene, findShot, findElement, pickedOf, newElement, newShot, shotRefs, modelText, threadKeyOf,
  namedText, usedOf, shotNumber, pad2, plateOf, KIND_LABEL, tokenized, scriptHash, modelOfShot, videoModelLabel, newScene, withFilmStyle,
} from './model';
import { crewStep } from '../skills';
import { crewById, actionOf } from './crew';
import { createHarness, VIDEO_MODEL, FINAL_RES } from './harness';
import { blockScene, sceneMotion, plateEdit, castPlanFromIdea, castDraftFromParsed } from '../core/storyboard';
import { characterVariations, locationVariations } from '../core/operations';
import { writeScreenplay } from '../core/story';
import { composeShotAction, directShotAction, analyzeEditMaster, editShotAction } from '../core/shot';
import { shotTalk, scriptTalk, castTalk, cutTalk } from '../core/talk';
import { shotList, display } from '../core/shotList';
import { parseScript } from '../core/scriptForm';
import { absLocalMediaUrl } from '../mediaUrl';
import { resolveModelId, defaultImageModelKey, DRAFT_MODE, draftFinalsOf } from '../suiteConfig';

const CAST_KIND = { character: 'character', creature: 'character', location: 'location', prop: 'prop' };
const AD_PLATES = 10; // plates the 1st AD looks at (the planner's image limit)
const lower = (x) => String(x || '').trim().toLowerCase();
// An element by its exact name (names are handed to the planners, so nothing is guessed).
const elementNamed = (elements, kind, name) => elements.find((e) => !e.viewOf && e.kind === kind && lower(e.name) === lower(name)) || null;
// A scene sheet's views, in the sheet's order, and the elements that are not views.
const viewsOf = (s, shot) => (shot.sheet?.viewIds || []).map((id) => findElement(s, id)).filter(Boolean);
// The scene sheet's labelled lines follow the shot's text when the Shot rewrites it, so
// the Designer reads what the text now says.
const SHEET_LINES = { landmarks: 'Landmarks:', start: 'At the start:', end: 'At the end:' };
const sheetFromText = (sheet, text) => {
  const next = { ...sheet };
  Object.entries(SHEET_LINES).forEach(([key, label]) => {
    const line = String(text).split('\n').find((l) => l.trim().startsWith(label));
    if (line) next[key] = line.trim().slice(label.length).trim();
  });
  return next;
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const written = ({ shot }) => !!String(shot.motion || shot.quote || '').trim();
const videoReady = (h, key = VIDEO_MODEL) => h.guard(resolveModelId(key), `${videoModelLabel(key)} is not configured.`);
const shotJobs = (shots) => ({ shots: shots.map(({ sceneId, shot }) => ({ sceneId, shotId: shot.id })) });
const sceneIdOf = (scope) => (scope.type === 'shot' ? scope.sceneId : scope.id);
const imagesOf = (arr) => arr.reduce((n, c) => n + (c.facePrompt && c.bodyPrompt ? 2 : 1), 0);
const imageModelLabel = () => (defaultImageModelKey() === 'seedreamPro' ? 'Seedream Pro' : 'Seedream');

// ---- the crew ------------------------------------------------------------------------------------
const ACTIONS = {
  // WRITERS — your idea → a screenplay, in one call.
  'writers.develop': {
    plan: (h, req) => {
      const idea = String(req.text || '').trim() || (req.from ? h.read.version(req.from.ref, req.from.vid)?.idea : '');
      h.guard(idea, 'Tell the Writers the idea: @Writers <your idea>.');
      return h.go({ idea, style: h.read.state().style }, 'a screenplay');
    },
    run: async (h, req, p) => {
      const v = h.open({ at: 'brief' }, { kind: 'script', idea: p.idea });
      try {
        const text = await h.think(writeScreenplay, { idea: p.idea, note: [p.style ? `The film's look is already set (${p.style}): write no other.` : '', h.note].filter(Boolean).join('\n') });
        v.done({ text, title: 'Screenplay' });
      } catch (e) { v.fail(e); }
    },
  },

  // 1st AD at the BRIEF — the shot list: every scene of the screenplay (code, from the
  // sluglines) and its shots, with the film's people listed once each. Picking it lays the film
  // out: scenes, their shots, the people and places Casting fills.
  'ad.shots': {
    plan: (h) => {
      const script = String(h.read.state().script || '');
      h.guard(script.trim(), 'Write or paste the script first.');
      const parsed = parseScript(script);
      h.guard(parsed.form === 'screenplay', `This is ${parsed.form === 'idea' ? 'an idea' : 'a treatment'}, not a screenplay — no scene starts with a slugline (INT. or EXT.). @Writers writes it first.`);
      return h.go({}, `shot list · ${plural(parsed.scenes.length, 'scene')}`);
    },
    run: async (h, req) => {
      const script = h.read.state().script;
      const v = h.open({ at: 'brief' }, { kind: 'shotList' });
      try {
        const list = await h.think(shotList, { script, note: [req.text, h.note].filter(Boolean).join('\n') });
        const failed = list.scenes.filter((sc) => sc.error);
        v.done({ payload: { ...list, scriptHash: scriptHash(script) }, flags: failed.map((sc) => h.check.warn(`Scene ${sc.n} has no shots yet — ${sc.error} (@AD at that scene plans it again)`)) });
      } catch (e) { v.fail(e); }
    },
  },

  // 1st AD at a SCENE — that scene's shots again: one take, the place's landmarks, its views (the
  // shots), start, beats with what everyone looks at, what works against them, sound, end. From
  // the scene's own words (or yours, for a scene written by hand), with the plates of who is in it.
  'ad.block': {
    plan: (h, req) => {
      const s = h.read.state();
      const sc = findScene(s, sceneIdOf(req.scope));
      h.guard(sc, 'That scene is gone.');
      h.guard(String(sc.text || '').trim() || String(req.text || '').trim(), 'This scene has no script words — write the shot list at the Script, or tell the AD what happens: @AD <what happens>.');
      return h.go({ sceneId: sc.id }, `blocking · ${sc.title}`);
    },
    run: async (h, req, p) => {
      const v = h.open({ at: 'scene', sceneId: p.sceneId }, { kind: 'blocking' });
      try {
        const s = h.read.state();
        const sc = findScene(s, p.sceneId);
        const text = String(sc.text || '').trim() || String(req.text || '').trim();
        const named = (sc.people || []).map((n) => ({ name: n, kind: 'character' }));
        const said = (el) => new RegExp(`(^|[^\\p{L}\\p{N}])${el.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(text);
        // Who is in it: people and props with a plate that the scene names; the rest by the script's name.
        const pool = s.elements
          .filter((el) => !el.viewOf && el.kind !== 'location' && (said(el) || named.some((n) => lower(n.name) === lower(el.name))))
          .map((el) => ({ el, pl: plateOf(el) })).filter((x) => x.pl && (x.pl.cacheUrl || x.pl.url));
        const seen = pool.slice(0, AD_PLATES);
        const unplated = named.filter((n) => !seen.some((x) => lower(x.el.name) === lower(n.name)));
        const place = sc.place || '';
        const loc = place ? elementNamed(s.elements, 'location', place) : null;
        // The scene before, when it is in the same place and blocked, hands over its end frame.
        const i = s.scenes.findIndex((x) => x.id === sc.id);
        const prev = i > 0 ? s.scenes[i - 1] : null;
        const prevBlock = prev && lower(prev.place) === lower(place) ? pickedOf(prev.blocking) : null;
        const out = await h.think(blockScene, {
          scene: { slug: sc.slug || sc.title, title: sc.title, place, text },
          landmarks: loc?.landmarks || '',
          before: prevBlock?.payload?.end || '',
          references: seen.map((x) => absLocalMediaUrl(x.pl.cacheUrl || x.pl.url)),
          labels: seen.map((x) => `${x.el.name} (${KIND_LABEL[x.el.kind].replace(/s$/, '').toLowerCase()})`),
          people: (s.shotList?.people || []).filter((pp) => (sc.people || []).includes(pp.name)),
          unplated: unplated.map((u) => display(u.name)),
          note: [req.text && sc.text ? req.text : '', h.note].filter(Boolean).join('\n'),
        });
        v.done({
          payload: { ...out, elementIds: seen.map((x) => x.el.id), unplated: unplated.map((u) => ({ name: display(u.name), kind: u.kind })) },
          flags: [
            h.check.note(`${out.seconds} s · ${plural(out.views.length, 'view')} · ${plural(out.beats.length, 'beat')}`),
            ...(pool.length > AD_PLATES ? [h.check.warn(`Saw ${AD_PLATES} of ${pool.length} plates`)] : []),
            ...(unplated.length ? [h.check.warn(`No plate for: ${unplated.map((u) => display(u.name)).join(', ')}`)] : []),
          ],
        });
      } catch (e) { v.fail(e); }
    },
  },

  // CASTING at CAST & WORLD — a plate for everyone in Cast & World without one, under their exact
  // names; with nobody waiting, the film's cast from the script (and your words).
  'casting.cast': {
    plan: async (h, req) => {
      const s = h.read.state();
      const todo = s.elements.filter((e) => !e.viewOf && e.kind !== 'prop' && !plateOf(e) && !(e.versions || []).some((v) => v.status === 'running' || v.status === 'review'));
      h.guard(String(s.script || '').trim() || String(req.text || '').trim(), 'Write the script first, or tell Casting who to cast: @Casting <who>.');
      const existing = s.elements.filter((e) => !e.viewOf).map((e) => ({ name: e.name, kind: e.kind, plated: !!plateOf(e) || !todo.includes(e) }));
      const note = [s.style ? `The film's visual style is set: ${s.style}. Every prompt's medium and the shared style follow it, whatever the script says.` : '', req.text, req.note].filter(Boolean).join('\n');
      const names = todo.map((e) => ({ kind: e.kind, name: e.name }));
      // Each waiting element must come back under exactly its name, or it stays without a
      // plate. One corrective re-ask, then a loud error naming what is missing.
      const kindOf = (c) => CAST_KIND[lower(c.type || c.role)] || 'location';
      const absent = (out) => names.filter((n) => !out.arr.some((c) => kindOf(c) === n.kind && lower(c.name) === lower(n.name)));
      let out = await h.think(castPlanFromIdea, { idea: s.script || req.text, existing, note });
      if (absent(out).length) out = await h.think(castPlanFromIdea, { idea: s.script || req.text, existing, note: `${note}\nYour last plan left out ${absent(out).map((n) => `${n.name} (${n.kind})`).join(', ')}. Include every one of them, named exactly as written here.` });
      const left = absent(out);
      h.guard(!left.length, `Casting left out ${left.map((n) => `${n.name} (${n.kind})`).join(', ')} — they wait in Cast & World under these names.`);
      return h.go({ arr: out.arr, style: !s.style || lower(out.style).includes(lower(s.style)) ? out.style : [s.style, out.style].filter(Boolean).join('. ') }, `${plural(out.arr.length, 'plate')} · ${plural(imagesOf(out.arr), 'image')} · ${imageModelLabel()}`);
    },
    run: async (h, req, p) => {
      const { arr } = p;
      h.spend(imagesOf(arr));
      // The same element when it already exists (the planner was given the exact names).
      const byIndex = {};
      const s = h.read.state();
      const fresh = [];
      arr.forEach((c, i) => {
        const kind = CAST_KIND[lower(c.type || c.role)] || 'location';
        const name = String(c.name || `Asset ${i + 1}`).slice(0, 80);
        const existing = elementNamed([...s.elements, ...fresh], kind, name);
        const el = existing || newElement({ kind, name, desc: String(c.facePrompt || c.prompt || c.presencePrompt || '').slice(0, 300) });
        if (!existing) fresh.push(el);
        byIndex[String(c.id != null ? c.id : i)] = { el: el.id, entry: c };
      });
      h.addElements(fresh);
      const face = {};
      Object.entries(byIndex).forEach(([idx, { el, entry }]) => { face[idx] = h.open({ at: 'element', id: el }, { kind: 'plate', entry, style: p.style }); });
      await h.make.image(castDraftFromParsed, { arr, style: p.style, imageModel: defaultImageModelKey(), max: arr.length }, { onEntry: platesInto(face) })
        .catch((e) => Object.values(face).forEach((v) => v.fail(e)));
    },
  },
  // CASTING · Draw again (a button in the viewer) — the plate drawn again from its edited prompt.
  'casting.redraw': {
    plan: (h, req) => {
      const v = h.read.version(req.from.ref, req.from.vid);
      h.guard(v?.entry, 'This plate has no prompt to draw again from.');
      h.guard(req.entry, 'Edit the prompt first.');
      return h.go({ entry: req.entry, style: h.read.state().style || v.style || '' }, `1 plate · ${plural(imagesOf([req.entry]), 'image')} · ${imageModelLabel()}`);
    },
    run: async (h, req, p) => {
      h.spend(imagesOf([p.entry]));
      const entry = { ...p.entry, id: 0 };
      const face = { 0: h.open(req.from.ref, { kind: 'plate', entry: p.entry, style: p.style }) };
      await h.make.image(castDraftFromParsed, { arr: [entry], style: p.style, imageModel: defaultImageModelKey(), max: 1 }, { onEntry: platesInto(face) })
        .catch((e) => face[0].fail(e));
    },
  },

  // DESIGNER — the views a scene's blocking asks for, each an edit of the place's picked plate so
  // every view is the same room in the same light.
  'designer.views': {
    plan: (h, req) => {
      const s = h.read.state();
      const sc = findScene(s, sceneIdOf(req.scope));
      h.guard(sc, 'That scene is gone.');
      const shots = (req.scope.type === 'shot' ? h.read.shots(req.scope) : h.read.shots({ type: 'scene', id: sc.id })).filter(({ shot }) => shot.sheet);
      h.guard(shots.length, 'Nothing here is blocked yet — @AD blocks this scene first.');
      const seen = new Set();
      const views = [];
      shots.forEach(({ sceneId, shot }) => viewsOf(s, shot).forEach((el) => {
        if (seen.has(el.id) || (plateOf(el) && req.scope.type !== 'shot')) return;
        seen.add(el.id);
        views.push({ sceneId, shotId: shot.id, elementId: el.id });
      }));
      h.guard(views.length, 'Every view here has a plate.');
      const bases = [...new Set(views.map((x) => findElement(s, x.elementId).viewOf))].map((id) => findElement(s, id));
      const unplated = bases.filter((b) => !b || !plateOf(b));
      h.guard(!unplated.length, `${unplated.map((b) => b?.name || 'The place').join(', ')} has no picked plate — views are drawn from it (@Casting at Cast & World).`);
      return h.go({ views }, `${plural(views.length, 'view')} · ${imageModelLabel()}`);
    },
    run: async (h, req, p) => {
      h.spend(p.views.length);
      await h.each(p.views, async ({ sceneId, shotId, elementId }) => {
        const s = h.read.state();
        const el = findElement(s, elementId);
        const base = findElement(s, el?.viewOf);
        const bp = base && plateOf(base);
        const shot = findShot(s, sceneId, shotId);
        if (!el || !bp || !shot) return;
        const v = h.open({ at: 'element', id: el.id }, { kind: 'plate', inputs: [{ n: 1, label: base.name, url: bp.cacheUrl || bp.url, role: 'source', elementId: base.id, versionId: bp.id }] });
        try {
          const instruction = await crewStep('crew-designer', 'view', { place: base.name, landmarks: shot.sheet.landmarks, from: [el.desc, req.text].filter(Boolean).join(' ') });
          v.patch({ prompt: instruction });
          const out = await h.make.image(plateEdit, { instruction, refs: [bp.cacheUrl || bp.url], imageModel: defaultImageModelKey() });
          v.done({ url: out.url, cacheUrl: out.cacheUrl || null, prompt: out.prompt });
        } catch (e) { v.fail(e); }
      }, 3);
    },
  },

  // CAMERA — a 480p draft of each shot here, from its text and plates (cast, place, views); a
  // shot that starts where the previous one ends opens on that shot's last frame. At a scene,
  // a shot whose draft still waits for you (or is rendering) is not drafted again. A note
  // reworks the take's own prompt under the model's spec.
  'camera.draft': {
    plan: (h, req) => {
      const s = h.read.state();
      const busy = (shot) => (shot.takes.versions || []).some((v) => v.status === 'running' || v.status === 'review');
      const shots = h.read.shots(req.scope).filter(({ shot }) => req.from || req.scope.type === 'shot' || (!shot.takes.picked && !busy(shot)));
      h.guard(shots.length, 'Every shot here has a circled take or a draft waiting for you.');
      const models = [...new Set(shots.map(({ shot }) => modelOfShot(s, shot)))];
      models.forEach((key) => videoReady(h, key));
      const unwritten = shots.filter((x) => !written(x));
      h.guard(!unwritten.length || req.from, `Write what happens in ${unwritten.map(({ shot }) => h.read.label(shot)).join(', ')} first.`);
      const orphan = shots.filter(({ shot }) => shot.startFrom === 'previous' && !pickedOf(h.read.prev(shot.id, s)?.takes));
      h.guard(!orphan.length, `${orphan.map(({ shot }) => h.read.label(shot)).join(', ')} start${orphan.length === 1 ? 's' : ''} where the shot before ends — circle a take of that shot first.`);
      const secs = shots.reduce((n, { shot }) => n + (Number(shot.seconds) || 0), 0);
      return h.ask.unplated(req, shots) || h.go(shotJobs(shots), `${plural(shots.length, 'draft')} · ${secs} s · 480p · ${models.map(videoModelLabel).join(' + ')}`);
    },
    run: (h, req, p) => shootDrafts(h, req, p),
  },
  // FINAL (a button) — a draft at full resolution, the same picture. From a draft in the viewer
  // (`from`), or every circled draft in a scene.
  'camera.final': {
    plan: (h, req) => {
      const live = (t) => t?.draft?.taskId && Date.now() - t.draft.at < DRAFT_MODE.ttlMs;
      const shots = h.read.shots(req.scope)
        .map((x) => ({ ...x, take: req.from ? h.read.version(req.from.ref, req.from.vid) : pickedOf(x.shot.takes) }))
        .filter((x) => live(x.take));
      h.guard(shots.length, req.from ? 'This draft can no longer be finished (drafts finish within 7 days) — draft the shot again.' : 'Circle a draft first (drafts finish within 7 days).');
      // Each draft finishes on the model that drafted it, at a resolution that model offers.
      const res = req.res || FINAL_RES;
      shots.forEach(({ shot, take }) => {
        const key = take.draft.modelKey || VIDEO_MODEL;
        videoReady(h, key);
        const finals = draftFinalsOf(key);
        h.guard(finals.includes(res), `${h.read.label(shot)} was drafted on ${videoModelLabel(key)}, which finishes at ${finals.join(' or ')} — not ${res}.`);
      });
      const secs = shots.reduce((n, { shot }) => n + (Number(shot.seconds) || 0), 0);
      return h.go({ res, shots: shots.map(({ sceneId, shot, take }) => ({ sceneId, shotId: shot.id, takeId: take.id })) }, `${plural(shots.length, 'final')} · ${secs} s · ${res} MOV`);
    },
    run: async (h, req, p) => {
      h.spend(p.shots.length);
      await h.each(p.shots, async ({ sceneId, shotId, takeId }) => {
        const draftTake = h.read.version({ at: 'take', sceneId, shotId }, takeId);
        if (!draftTake?.draft?.taskId) return;
        const v = h.open({ at: 'take', sceneId, shotId }, { parent: draftTake.id, final: true, kind: 'take', res: p.res, model: draftTake.draft.modelKey || VIDEO_MODEL, prompt: draftTake.prompt, used: draftTake.used, inputs: [{ n: 1, label: 'the draft', url: draftTake.cacheUrl || draftTake.url, role: 'draft', versionId: draftTake.id, video: true }, ...(draftTake.inputs || []).map((x) => ({ ...x, n: x.n + 1 }))] });
        try { await h.make.finish({ v, draftTake, resolution: p.res }); } catch (e) { v.fail(e); }
      }, 3);
    },
  },

  // VFX — a change-only edit of a take (the crew's or your footage): the source rides as
  // @video1 and only what the director names changes.
  'vfx.edit': {
    plan: (h, req) => {
      videoReady(h);
      const shot = findShot(h.read.state(), req.scope.sceneId, req.scope.id);
      const source = req.from ? h.read.version(req.from.ref, req.from.vid) : pickedOf(shot.takes);
      h.guard(source, 'Circle a take (or import your footage) to edit.');
      h.guard(String(req.note || req.text || '').trim(), 'Say what changes: @VFX <what changes>.');
      const secs = Number(source.seconds || shot.seconds) || 0;
      h.guard(!secs || (secs >= 4 && secs <= 30), `The source is ${secs} s — an edit needs 4–30 s.`);
      return h.go({ sceneId: req.scope.sceneId, shotId: shot.id, sourceId: source.id }, `1 edit · ${FINAL_RES} MOV${secs ? ` · ${secs} s` : ''}`);
    },
    run: async (h, req, p) => {
      h.spend(1);
      const s = h.read.state();
      const ref = { at: 'take', sceneId: p.sceneId, shotId: p.shotId };
      const shot = findShot(s, p.sceneId, p.shotId);
      const source = h.read.version(ref, p.sourceId, s);
      const words = h.note || req.text;
      const v = h.open(ref, { parent: source.id, note: words, kind: 'take', res: FINAL_RES, edit: true, used: source.used || usedOf(s, shot), seconds: source.seconds || shot.seconds, inputs: [{ n: 1, label: source.footage ? 'your footage' : 'the source take', url: source.cacheUrl || source.url, role: 'source (@video1)', versionId: source.id, video: true }] });
      try {
        const master = `asset://${await h.make.source(ref, source, shot.title)}`;
        const secs = Number(source.seconds || shot.seconds) || 0;
        // The planner watches the source first; an edit written blind is flagged on the take.
        const flags = [];
        let analysis = '';
        try { analysis = (await h.think(analyzeEditMaster, { videoUrl: absLocalMediaUrl(source.cacheUrl || source.url), seconds: secs })).text; }
        catch (e) { flags.push(h.check.warn(`Edit written without watching the clip: ${e.message}`)); }
        const out = await h.think(editShotAction, { text: words, master: { url: master, label: shot.title, duration: secs || null }, analysis, references: [], roster: [], modelKey: VIDEO_MODEL });
        if (out.closureAdded) flags.push(h.check.note('Scope closed: everything not named stays'));
        await h.make.take({ v, prompt: [out.action, out.audio].filter(Boolean).join('\n'), list: [], seconds: secs, draft: false, master, flags });
      } catch (e) { v.fail(e); }
    },
  },

  // SHOT — the director talks to the shot. A question is answered; an instruction changes the
  // shot's text and references at once (the reply carries what they were, for Undo). It sees
  // the latest take as video, and the conversation so far.
  'shot.talk': {
    plan: (h, req) => {
      h.guard(findShot(h.read.state(), req.scope.sceneId, req.scope.id), 'That shot is gone.');
      h.guard(String(req.text || '').trim(), 'Say what to change, or ask the shot something.');
      return h.go();
    },
    run: async (h, req) => {
      const s = h.read.state();
      const { sceneId, id: shotId } = req.scope;
      const shot = findShot(s, sceneId, shotId);
      h.guard(shot, 'That shot is gone.');
      const kindOf = (el) => (el.viewOf ? 'view' : el.kind);
      const refEls = (shot.elementIds || []).map((id) => findElement(s, id)).filter(Boolean);
      const take = (shot.takes?.versions || [])
        .filter((v) => ['review', 'picked', 'kept'].includes(v.status) && (v.cacheUrl || v.url))
        .sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
      // This shot's conversation, without the message being answered now.
      const history = (s.threads[threadKeyOf(req.scope)] || [])
        .filter((m) => m.shotId === shotId && m.text && (m.from === 'you' || m.kind === 'reply'))
        .map((m) => ({ from: m.from === 'you' ? 'you' : 'shot', text: m.text }))
        .slice(0, -1);
      const before = namedText(s, shot.motion);
      const out = await h.think(shotTalk, {
        message: req.text,
        text: before,
        refs: refEls.map((el) => ({ name: el.name, kind: kindOf(el) })),
        cast: s.elements.map((el) => ({ name: el.name, kind: kindOf(el), plated: !!plateOf(el) })),
        take: take ? { videoUrl: absLocalMediaUrl(take.cacheUrl || take.url), prompt: take.prompt || '' } : null,
        history,
      });
      const named = (n) => s.elements.find((e) => e.name === n);
      let ids = (shot.elementIds || []).filter((id) => !out.remove.includes(findElement(s, id)?.name));
      out.add.forEach((n) => { const el = named(n); if (el && !ids.includes(el.id)) ids = [...ids, el.id]; });
      const text = out.text && out.text !== before ? out.text : '';
      // Binding: every element the new text names rides as a reference.
      if (text) s.elements.forEach((el) => { if (!ids.includes(el.id) && !out.remove.includes(el.name) && tokenized(s, text, [el.id]) !== text) ids = [...ids, el.id]; });
      const added = ids.filter((id) => !(shot.elementIds || []).includes(id)).map((id) => findElement(s, id).name);
      const removed = (shot.elementIds || []).filter((id) => !ids.includes(id)).map((id) => findElement(s, id)?.name).filter(Boolean);
      let undo = null;
      if (text || added.length || removed.length) {
        const patch = { elementIds: ids };
        if (text) {
          patch.motion = tokenized(s, text, ids);
          if (shot.sheet) patch.sheet = sheetFromText(shot.sheet, text);
        }
        undo = { ...h.reviseShot(sceneId, shotId, patch), ...(patch.sheet ? { sheet: shot.sheet } : {}) };
      }
      h.reply({
        kind: 'reply', shotId, text: out.reply,
        change: undo ? { text: !!text, added, removed, undo } : null,
        unknown: out.unknown,
      });
    },
  },

  // SCRIPT — the director talks to the screenplay and its shot list (at the Brief), or to one
  // scene's shots (at a scene). A question is answered; an instruction edits. What is edited is
  // the film as it stands (talk, or a note on the picked version): the screenplay and the scenes'
  // shots change at once — each a new picked version, its parent the one before — and the reply
  // carries what they were, for Undo. A note on a version still waiting for you edits THAT
  // version: its edit is a new version waiting beside it.
  'script.talk': {
    plan: (h, req) => {
      h.guard(String(req.text || '').trim(), 'Say what to change, or ask the script something.');
      if (req.scope.type === 'scene') h.guard(findScene(h.read.state(), req.scope.id), 'That scene is gone.');
      return h.go();
    },
    run: async (h, req) => {
      const s = h.read.state();
      const key = threadKeyOf(req.scope);
      const src = req.from ? h.read.version(req.from.ref, req.from.vid, s) : null;
      const waiting = !!src && src.status !== 'picked';
      const at = req.scope.type === 'scene' ? s.scenes.findIndex((x) => x.id === req.scope.id) : -1;
      const live = s.scenes.map((sc, i) => ({ n: i + 1, place: sc.place || sc.title, time: sc.time, sheet: pickedOf(sc.blocking)?.payload || null }));
      const list = waiting && src.kind === 'shotList' ? src.payload.scenes.map((sc) => ({ n: sc.n, place: sc.place, time: sc.time, sheet: sc.sheet }))
        : waiting && src.kind === 'blocking' ? [{ ...live[at], sheet: src.payload }]
          : waiting ? [] : live;
      const script = waiting && src.kind === 'script' ? src.text : s.script;
      const history = (s.threads[key] || [])
        .filter((m) => !m.shotId && m.text && ((m.from === 'you' && m.agent === 'script') || (m.from === 'script' && m.kind === 'reply')))
        .map((m) => ({ from: m.from === 'you' ? 'you' : 'script', text: m.text }))
        .slice(0, -1);
      const out = await h.think(scriptTalk, { message: req.text, script, scenes: list.map(talkScene), focus: at >= 0 ? at + 1 : null, history });
      const rejected = [...out.rejected];
      if (waiting) {
        // A version still waiting for you: its edit waits beside it.
        if (src.kind === 'script' && out.screenplay) h.open(req.from.ref, { kind: 'script', title: src.title || 'Screenplay' }).done({ text: out.screenplay });
        if (src.kind === 'shotList' && out.scenes.length) {
          const scenes = src.payload.scenes.map((sc) => { const c = out.scenes.find((x) => x.n === sc.n); return c && sc.sheet ? { ...sc, sheet: editSheet(sc.sheet, c.shots) } : sc; });
          h.open(req.from.ref, { kind: 'shotList' }).done({ payload: { ...src.payload, scenes } });
        }
        if (src.kind === 'blocking' && out.scenes.length) h.open(req.from.ref, { kind: 'blocking' }).done({ payload: editSheet(src.payload, out.scenes[0].shots) });
        if ((src.kind !== 'script' && out.screenplay) || (src.kind === 'script' && out.scenes.length)) rejected.push(src.kind === 'script' ? 'shots are edited on the shot list, not on this screenplay' : 'the screenplay is edited at the Brief, not on this version');
        h.reply({ kind: 'reply', text: out.reply, change: null, unknown: rejected });
        return;
      }
      const before = { ...(out.screenplay ? { script: s.script, briefVersions: s.brief.versions } : {}), scenes: out.scenes.map((x) => s.scenes[x.n - 1]).filter(Boolean) };
      if (out.screenplay || out.scenes.length) {
        h.reviseFilm((x) => {
          let next = x;
          if (out.screenplay) {
            const was = next.brief.versions.find((v) => v.kind === 'script' && v.status === 'picked');
            const vid = `v-${Date.now().toString(36)}s`;
            next = { ...next, script: out.screenplay, brief: { ...next.brief, versions: [...next.brief.versions.map((v) => (v === was ? { ...v, status: 'kept' } : v)), { id: vid, at: Date.now(), by: 'script', kind: 'script', status: 'picked', parent: was?.id || null, note: req.text, title: 'Screenplay', text: out.screenplay }] } };
          }
          out.scenes.forEach(({ n, shots }) => {
            const sc = next.scenes[n - 1];
            const was = pickedOf(sc?.blocking);
            if (!sc || !was) return;
            const payload = editSheet(was.payload, shots);
            const vid = `v-${Date.now().toString(36)}${n}`;
            next = { ...next, scenes: next.scenes.map((y) => (y.id !== sc.id ? y : { ...y, blocking: { versions: [...y.blocking.versions.map((v) => (v.status === 'picked' ? { ...v, status: 'kept' } : v)), { id: vid, at: Date.now(), by: 'script', kind: 'blocking', status: 'picked', parent: was.id, note: req.text, payload }], picked: vid } })) };
            next = applyBlocking(next, sc.id, payload);
          });
          return next;
        });
      }
      h.reply({
        kind: 'reply', text: out.reply,
        change: out.screenplay || out.scenes.length ? { screenplay: !!out.screenplay, scenes: out.scenes.map((x) => x.n), undo: before } : null,
        unknown: rejected,
      });
    },
  },

  // CAST & WORLD — the director talks to the film's people, places and props (at Cast & World,
  // or on one of them). A question is answered; an instruction edits at once: names and
  // descriptions, who is in the film (what is in a shot is never removed), and pictures — each
  // an image edit of that element's picked plate, a new version waiting for you. The reply
  // carries what the names and descriptions were, for Undo.
  'cast.talk': {
    plan: (h, req) => {
      h.guard(String(req.text || '').trim(), 'Say what to change, or ask Cast & World something.');
      return h.go();
    },
    run: async (h, req) => {
      const s = h.read.state();
      const key = threadKeyOf(req.scope);
      const els = s.elements.filter((e) => !e.viewOf || (req.scope.type === 'element' && e.id === req.scope.id));
      const used = (id) => s.scenes.reduce((n, sc) => n + sc.shots.filter((sh) => (sh.elementIds || []).includes(id)).length, 0);
      const focus = req.scope.type === 'element' ? findElement(s, req.scope.id)?.name : null;
      const history = (s.threads[key] || [])
        .filter((m) => m.text && ((m.from === 'you' && m.agent === 'cast') || (m.from === 'cast' && m.kind === 'reply')))
        .map((m) => ({ from: m.from === 'you' ? 'you' : 'cast', text: m.text }))
        .slice(0, -1);
      const out = await h.think(castTalk, { message: req.text, elements: els.map((e) => ({ name: e.name, kind: e.kind, desc: e.desc, plated: !!plateOf(e), shots: used(e.id) })), focus, history });
      const named = (n) => els.find((e) => e.name === n);
      const added = out.add.map((a) => newElement({ kind: a.kind, name: a.name, desc: a.desc }));
      const touched = [...new Set([...out.changes.map((c) => c.name), ...out.remove])].map(named).filter(Boolean);
      // Views take a renamed place's name, so Undo gives it back to them too.
      const viewsMoved = s.elements.filter((e) => e.viewOf && out.changes.some((c) => c.rename && named(c.name)?.id === e.viewOf));
      const changed = out.changes.length || added.length || out.remove.length;
      if (changed) {
        h.reviseFilm((x) => ({
          ...x,
          elements: [...x.elements
            .filter((e) => !out.remove.includes(e.name) || e.viewOf)
            .map((e) => {
              // A place's views carry its name: they are renamed with it.
              const place = e.viewOf ? x.elements.find((y) => y.id === e.viewOf) : null;
              const moved = place && out.changes.find((y) => y.name === place.name && y.rename);
              if (moved) return { ...e, name: e.name.replace(place.name, moved.rename) };
              const c = out.changes.find((y) => y.name === e.name && !e.viewOf);
              return c ? { ...e, ...(c.rename ? { name: c.rename } : {}), ...(c.desc ? { desc: c.desc } : {}) } : e;
            }), ...added],
        }));
      }
      h.reply({
        kind: 'reply', text: out.reply,
        change: changed ? { renamed: out.changes.filter((c) => c.rename).map((c) => `${c.name} → ${c.rename}`), described: out.changes.filter((c) => c.desc).map((c) => c.rename || c.name), added: added.map((e) => e.name), removed: out.remove, undo: { elements: [...touched, ...viewsMoved], added: added.map((e) => e.id) } } : null,
        unknown: out.rejected,
      });
      // Pictures: each an image edit of the element's plate (an anchor first when it has none).
      if (out.pictures.length) {
        h.spend(out.pictures.length);
        await h.each(out.pictures, ({ name, change }) => { const el = findElement(h.read.state(), named(name)?.id); return el ? editPicture(h, el, change) : null; }, 3);
      }
    },
  },

  // EDITOR — the circled takes, in film order, into one cut.
  'editor.assemble': {
    plan: (h, req) => {
      const s = h.read.state();
      const all = s.scenes.flatMap((sc) => sc.shots);
      h.guard(all.length, 'No shots yet.');
      const missing = all.filter((sh) => !pickedOf(sh.takes));
      h.guard(missing.length < all.length, 'Circle some takes first.');
      if (missing.length && !req.force) return h.ask(`${missing.map((sh) => pad2(shotNumber(s, sh.id))).join(', ')} ${missing.length === 1 ? 'has' : 'have'} no circled take.`, [{ label: 'Assemble without', req: { ...req, force: true } }]);
      return h.go({}, `a cut of ${plural(all.length - missing.length, 'take')}`);
    },
    run: (h) => assembleCut(h, h.read.state().scenes.flatMap((sc) => sc.shots).map((sh) => pickedOf(sh.takes)).filter(Boolean)),
  },
  // EDITOR · talk — the director talks to the cut (or notes one). A question is answered; an
  // instruction reorders or drops shots, and the cut is assembled again: a new version, its
  // parent the cut edited.
  'editor.talk': {
    plan: (h, req) => {
      h.guard(String(req.text || '').trim(), 'Say what to change, or ask the cut something.');
      h.guard(h.read.state().scenes.some((sc) => sc.shots.some((sh) => pickedOf(sh.takes))), 'Circle some takes first.');
      return h.go();
    },
    run: async (h, req) => {
      const s = h.read.state();
      const key = threadKeyOf(req.scope);
      const shots = s.scenes.flatMap((sc, i) => sc.shots.map((sh) => ({ sh, scene: i + 1 }))).filter(({ sh }) => pickedOf(sh.takes))
        .map(({ sh, scene }) => ({ n: shotNumber(s, sh.id), title: sh.title, scene, seconds: Number(sh.seconds) || 0, take: pickedOf(sh.takes), sh }));
      const base = req.from ? h.read.version(req.from.ref, req.from.vid, s) : pickedOf(s.cut) || [...(s.cut.versions || [])].reverse().find((v) => v.status === 'review') || null;
      const nOfTake = (tid) => { const sh = s.scenes.flatMap((sc) => sc.shots).find((x) => (x.takes.versions || []).some((v) => v.id === tid)); return sh ? shotNumber(s, sh.id) : null; };
      const cut = base ? (base.takes || []).map(nOfTake).filter(Boolean) : [];
      const history = (s.threads[key] || [])
        .filter((m) => m.text && ((m.from === 'you' && m.agent === 'editor') || (m.from === 'editor' && m.kind === 'reply')))
        .map((m) => ({ from: m.from === 'you' ? 'you' : 'cut', text: m.text }))
        .slice(0, -1);
      const out = await h.think(cutTalk, { message: req.text, cut, shots: shots.map(({ n, title, scene, seconds }) => ({ n, title, scene, seconds })), history });
      h.reply({ kind: 'reply', text: out.reply, change: null, unknown: out.rejected });
      if (out.order.length) await assembleCut(h, out.order.map((n) => shots.find((x) => x.n === n).take), { parent: base?.id || null, note: req.text });
    },
  },
};

// The cut: the takes, in the order given, stitched into one file — a new version of the cut.
const assembleCut = async (h, takes, base = {}) => {
  const v = h.open({ at: 'cut' }, { kind: 'cut', takes: takes.map((t) => t.id), ...base });
  try {
    const { url, posterUrl } = await h.make.stitch(takes.map((t) => t.cacheUrl || t.url), 'studio-cut');
    v.done({ url, cacheUrl: url, format: takes.some((t) => t.format === 'mov') ? 'mov' : 'mp4', flags: [h.check.note(plural(takes.length, 'take'))], posterUrl });
  } catch (e) { v.fail(e); }
};

// A scene's shots as the Script reads and writes them: one per beat, with where its camera
// stands and where eyes go.
const talkScene = ({ n, place, time, sheet }) => {
  const fromOf = (v) => (sheet?.views || []).find((vw) => vw.name === v)?.from || '';
  return { n, place, time, seconds: sheet?.seconds || null, shots: (sheet?.beats || []).map((b) => ({ view: b.view, from: fromOf(b.view), action: b.action, looksAt: b.looksAt })) };
};
// A scene's blocking with its shots edited: new camera positions join its views, ones no shot
// stands on any more leave; everything else (landmarks, start, end, length) stays.
export const editSheet = (sheet, shots) => {
  const views = [...sheet.views, ...shots.filter((sh) => !sheet.views.some((vw) => vw.name === sh.view)).map((sh) => ({ name: sh.view, from: sh.from }))]
    .filter((vw, i, all) => shots.some((sh) => sh.view === vw.name) && all.findIndex((w) => w.name === vw.name) === i);
  return { ...sheet, views, beats: shots.map(({ view, action, looksAt }) => ({ view, action, looksAt })) };
};

// A picture edited from words: an image edit of the element's picked plate (its parent), or —
// with no plate yet — an anchor drawn from its description first, then edited.
const editPicture = async (h, el, words) => {
  const ref = { at: 'element', id: el.id };
  const base = plateOf(el);
  const v = h.open(ref, { kind: 'plate', note: words, parent: base?.id || null, ...(base && (base.cacheUrl || base.url) ? { inputs: [{ n: 1, label: 'the picked plate', url: base.cacheUrl || base.url, role: 'source', versionId: base.id }] } : {}) });
  const out = await h.make.image(el.kind === 'character' ? characterVariations : locationVariations, { imageUrl: base ? (base.cacheUrl || base.url) : '', direction: base ? words : withFilmStyle(h.read.state(), [el.desc, words].filter(Boolean).join('. ') || el.name), count: 1, imageModel: defaultImageModelKey() }, {
    onPlanned: (specs) => v.patch({ prompt: specs[0]?.prompt }),
    onItem: (item) => v.done({ url: item.url, cacheUrl: item.cacheUrl || null, prompt: item.prompt }),
    onFail: (i, msg) => v.fail(new Error(msg)),
    onAnchor: (a) => h.open(ref, { kind: 'plate' }).done({ url: a.url, cacheUrl: a.cacheUrl || null }),
  }).catch((e) => ({ errors: [e.message] }));
  v.fail(new Error((out?.errors || [])[0] || 'Did not render'));
};

// A cast render's plates into their versions: the face (or the one plate) finishes the
// version, the body sheet rides along as an extra.
const platesInto = (face) => (entry) => {
  const v = face[entry.assetId];
  if (!v) return;
  if (entry.primary) {
    v.patch({ prompt: entry.prompt });
    if (entry.failed) v.fail(new Error(`The plate did not render: ${entry.error || 'no reason given'}`));
    else v.done({ url: entry.url, cacheUrl: entry.cacheUrl || null, prompt: entry.prompt });
  } else if (!entry.failed) {
    v.patch((w) => ({ extras: [...(w.extras || []), { url: entry.cacheUrl || entry.url, label: 'body', prompt: entry.prompt }] }));
  }
};

// CASTING / DESIGNER — variations of one element (from its picked plate, or the one noted).
// No plate yet: the agent first draws one from the description, then varies it.
const variation = {
  plan: (h, req) => {
    const el = findElement(h.read.state(), req.scope.id);
    h.guard(el, 'That element is gone.');
    const count = req.from ? 1 : 2;
    const images = count + (req.from || plateOf(el) ? 0 : 1);
    return h.go({ count, images }, images > count ? `a plate + ${plural(count, 'variation')}` : plural(count, 'variation'));
  },
  run: async (h, req, p) => {
    const s = h.read.state();
    const el = findElement(s, req.scope.id);
    const ref = { at: 'element', id: el.id };
    const base = req.from ? h.read.version(ref, req.from.vid, s) : plateOf(el);
    const direction = withFilmStyle(base ? null : s, [h.note, req.text].filter(Boolean).join('. ') || el.desc || el.name);
    h.spend(p.images || p.count);
    const baseInput = base && (base.cacheUrl || base.url) ? [{ n: 1, label: req.from ? 'the plate noted' : 'the picked plate', url: base.cacheUrl || base.url, role: 'source', versionId: base.id }] : [];
    const vs = Array.from({ length: p.count }, () => h.open(ref, { kind: 'plate', inputs: baseInput }));
    const out = await h.make.image(el.kind === 'character' ? characterVariations : locationVariations, { imageUrl: base ? (base.cacheUrl || base.url) : '', direction, count: p.count, imageModel: defaultImageModelKey() }, {
      onPlanned: (specs) => specs.forEach((sp, i) => vs[i]?.patch({ prompt: sp.prompt })),
      onItem: (item, i) => vs[i]?.done({ url: item.url, cacheUrl: item.cacheUrl || null, prompt: item.prompt }),
      onFail: (i, msg) => vs[i]?.fail(new Error(msg)),
      onAnchor: (a) => h.open(ref, { kind: 'plate' }).done({ url: a.url, cacheUrl: a.cacheUrl || null }),
    }).catch((e) => ({ errors: [e.message] }));
    vs.forEach((v) => v.fail(new Error((out?.errors || [])[0] || 'Did not render')));
  },
};
ACTIONS['casting.variation'] = variation;
ACTIONS['designer.variation'] = variation;

// CAMERA drafts: per shot, the plates (and, for a shot that continues, the last frame of the
// shot before as its first frame), and a prompt composed against them.
const shootDrafts = async (h, req, p) => {
  h.spend(p.shots.length);
  await h.each(p.shots, async ({ sceneId, shotId }) => {
    const s = h.read.state();
    const shot = findShot(s, sceneId, shotId);
    if (!shot) return;
    const ref = { at: 'take', sceneId, shotId };
    const modelKey = modelOfShot(s, shot);
    const v = h.open(ref, { kind: 'take', res: DRAFT_MODE.resolution, model: modelKey, used: usedOf(s, shot) });
    try {
      const before = shot.startFrom === 'previous' ? pickedOf(h.read.prev(shotId, s)?.takes) : null;
      const opening = before ? { url: await h.read.lastFrame(before) } : null;
      const { list, imageOf } = shotRefs(s, shot, { opening });
      const roster = list.map((r, i) => `[Image ${i + 1}] ${r.label}`);
      let prompt;
      const flags = [];
      // What the writer reports about its own prompt is shown on the take, never smoothed over.
      const report = (out) => {
        (out.missingDialogue || []).forEach((l) => flags.push(h.check.warn(`Dropped a line of dialogue: "${l}"`)));
        (out.dropped || []).forEach((d) => flags.push(h.check.warn(`The last frame of the shot before overrode: ${d}`)));
      };
      if (req.from) {
        const prev = h.read.version(ref, req.from.vid, s);
        const out = await h.think(directShotAction, { text: prev.prompt, note: h.note, references: list.map((r) => absLocalMediaUrl(r.url)), roster, kfIndices: opening ? [1] : [], modelKey });
        report(out);
        prompt = [out.action, out.audio].filter(Boolean).join('\n');
      } else if (opening || shot.sheet) {
        const out = await h.think(composeShotAction, { text: [modelText(s, shot.motion || shot.quote, imageOf), req.text, shot.audio].filter(Boolean).join('\n'), references: list.map((r) => absLocalMediaUrl(r.url)), roster, kfIndices: opening ? [1] : [], modelKey, job: shot.turn, derive: !shot.sheet, style: s.style || '' });
        report(out);
        prompt = [out.action, out.audio].filter(Boolean).join('\n');
      } else {
        prompt = [modelText(s, shot.motion || shot.quote, imageOf), req.text, shot.audio].filter(Boolean).join('\n');
      }
      await h.make.take({ v, prompt: withFilmStyle(s, prompt), list, seconds: shot.seconds, draft: true, flags, modelKey });
    } catch (e) { v.fail(e); }
  }, 3);
};

// What each planner call or render is called while it runs.
const STAGES = new Map([
  [writeScreenplay, 'Writing the screenplay'],
  [shotList, 'Writing the shot list'],
  [blockScene, 'Blocking the scene'],
  [castPlanFromIdea, 'Planning the cast'],
  [castDraftFromParsed, 'Rendering the cast'],
  [characterVariations, 'Rendering variations'],
  [locationVariations, 'Rendering variations'],
  [plateEdit, 'Drawing the view'],
  [composeShotAction, 'Writing the shot prompt'],
  [directShotAction, 'Reworking the prompt'],
  [analyzeEditMaster, 'Watching the clip'],
  [editShotAction, 'Writing the edit'],
  [shotTalk, 'Thinking'],
  [scriptTalk, 'Thinking'],
  [castTalk, 'Thinking'],
  [cutTalk, 'Thinking'],
]);

export const createRunners = ({ get, set, ctx }) => {
  const harness = createHarness({ get, set, ctx, stageOf: (verb) => STAGES.get(verb) || '' });
  const entry = (req) => {
    const a = ACTIONS[`${req.agent}.${req.action}`];
    const contract = actionOf(req.agent, req.action);
    if (!a || !contract) throw new Error('That crew member has no such job here.');
    return { a, contract };
  };
  // PLAN: check the request and say what it will make, before anything is spent.
  const plan = async (req, { onStage } = {}) => entry(req).a.plan(harness.plan(onStage), req);
  // RUN: the work; everything it makes lands as versions announced in the scope's thread.
  const run = async (req, payload = {}, summary = '') => {
    const { a, contract } = entry(req);
    const { h, end } = harness.run(req, contract, summary);
    try { await a.run(h, req, payload); } finally { end(); }
  };

  // Takes in flight when the page closed pick their polling back up; other work that was
  // running did not survive the reload.
  const resume = () => {
    const s = get();
    s.scenes.forEach((sc) => sc.shots.forEach((sh) => (sh.takes.versions || []).forEach((v) => {
      if (v.status !== 'running') return;
      const ver = harness.version({ at: 'take', sceneId: sc.id, shotId: sh.id }, v.id);
      if (v.taskId) harness.make.poll(ver, v.taskId, { draft: v.res === DRAFT_MODE.resolution, modelKey: v.model || VIDEO_MODEL }).catch((e) => ver.fail(e));
      else ver.fail(new Error('Interrupted — ask again'));
    })));
    const stop = (ref, c) => (c?.versions || []).forEach((v) => { if (v.status === 'running') harness.version(ref, v.id).fail(new Error('Interrupted — ask again')); });
    stop({ at: 'brief' }, s.brief);
    stop({ at: 'cut' }, s.cut);
    s.elements.forEach((el) => stop({ at: 'element', id: el.id }, el));
    s.scenes.forEach((sc) => stop({ at: 'scene', sceneId: sc.id }, sc.blocking));
  };

  return { plan, run, resume, crewName: (id) => crewById(id)?.name || id, namedText: (t) => namedText(get(), t) };
};

// PICKING THE SHOT LIST — the film laid out: every person and place it names that Cast & World
// lacks becomes an element without a plate (Casting's to-do); each scene becomes a scene (its
// slugline, place, the script's words, who is in it) with its blocking picked and its shot made.
export const applyShotList = (s, payload) => {
  let elements = s.elements;
  const add = (kind, name, aka = []) => { if (![name, ...aka].some((n) => elementNamed(elements, kind, n))) elements = [...elements, newElement({ kind, name })]; };
  (payload.people || []).forEach((p) => add('character', p.name, p.aka));
  (payload.places || []).forEach((name) => add('location', name));
  const scenes = payload.scenes.map((sc) => newScene(`${sc.place}${sc.time ? ` · ${sc.time}` : ''}`, sc));
  let next = { ...s, shotList: payload, elements, scenes };
  payload.scenes.forEach((sc, i) => {
    if (!sc.sheet) return;
    const id = scenes[i].id;
    const ids = (sc.people || []).map((n) => elementNamed(next.elements, 'character', n)?.id).filter(Boolean);
    const blocking = { ...sc.sheet, place: sc.place, elementIds: ids, unplated: [] };
    const vid = uid('v-');
    next = { ...next, scenes: next.scenes.map((x) => (x.id === id ? { ...x, blocking: { versions: [{ id: vid, at: Date.now(), by: 'ad', kind: 'blocking', status: 'picked', payload: blocking }], picked: vid } } : x)) };
    next = applyBlocking(next, id, blocking);
  });
  return next;
};

// PICKING A SCENE'S BLOCKING — the scene's shot takes its text and sheet (a blocked shot already
// there keeps its takes); the place gets its landmarks; each view becomes an element drawn later
// from the place's plate; people and props the sheet has with no plate become elements without one.
export const applyBlocking = (s, sceneId, payload) => {
  const sc = findScene(s, sceneId);
  if (!sc) return s;
  let elements = s.elements;
  const ensure = (kind, name, extra = {}) => {
    const found = elementNamed(elements, kind, name);
    if (found) return found;
    const el = { ...newElement({ kind, name }), ...extra };
    elements = [...elements, el];
    return el;
  };
  const loc = payload.place ? ensure('location', payload.place) : null;
  if (loc && !loc.landmarks) elements = elements.map((e) => (e.id === loc.id ? { ...e, landmarks: payload.landmarks } : e));
  const extra = (payload.unplated || []).map((u) => ensure(u.kind, u.name).id);
  const viewIds = loc ? payload.views.map((vw) => {
    const name = `${loc.name} · ${vw.name}`;
    const found = elements.find((e) => e.viewOf === loc.id && e.name === name);
    if (found) return found.id;
    const el = { ...newElement({ kind: 'location', name, desc: vw.from }), viewOf: loc.id };
    elements = [...elements, el];
    return el.id;
  }) : [];
  const ids = [...new Set([...(payload.elementIds || []), ...extra, ...viewIds])];
  const next = { ...s, elements };
  const sheet = { place: payload.place, landmarks: payload.landmarks, views: payload.views, start: payload.start, beats: payload.beats, against: payload.against, end: payload.end, viewIds };
  const fields = { title: sc.title, quote: sc.text || '', seconds: payload.seconds, motion: tokenized(next, sceneMotion(payload), ids), audio: payload.sound, elementIds: ids, sheet, blocked: true };
  const blocked = sc.shots.find((sh) => sh.blocked);
  const shots = blocked ? sc.shots.map((sh) => (sh.id === blocked.id ? { ...sh, ...fields } : sh)) : [...sc.shots, { ...newShot(fields), blocked: true }];
  return { ...next, scenes: next.scenes.map((x) => (x.id === sceneId ? { ...x, shots } : x)) };
};

export const containerLabel = (s, ref) => {
  if (ref.at === 'brief') return 'Script';
  if (ref.at === 'cut') return 'Cut';
  if (ref.at === 'element') return findElement(s, ref.id)?.name || 'Element';
  if (ref.at === 'scene') { const i = s.scenes.findIndex((x) => x.id === ref.sceneId); return i >= 0 ? `${pad2(i + 1)} ${s.scenes[i].title} · blocking` : 'Scene'; }
  const sh = findShot(s, ref.sceneId, ref.shotId);
  return sh ? `${pad2(shotNumber(s, sh.id))} ${sh.title}` : 'Shot';
};
