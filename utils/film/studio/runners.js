// THE CREW AT WORK — one entry per action, each made of the harness parts (harness.js).
//
//   plan(h, req)          → ask | sheet | go           (read · guard · think · ask · sheet)
//   run(h, req, payload)  → versions to review         (read · think · make · check · open)
//
// A request: { agent, action, scope, text, note?, from?: { ref, vid }, force? }. Who may be
// asked what, and where, lives in crew.js; how they do it lives here.
import {
  uid, findShot, findElement, containerOf, pickedOf, newElement, newShot, shotRefs, modelText, threadKeyOf,
  namedText, usedOf, shotNumber, pad2, plateOf, KIND_LABEL, tokenized, scriptHash,
} from './model';
import { crewStep } from '../skills';
import { crewById } from './crew';
import { createHarness, VIDEO_MODEL, FINAL_RES } from './harness';
import { storyboardScenes, sceneMotion, plateEdit, castPlanFromIdea, castDraftFromParsed } from '../core/storyboard';
import { characterVariations, locationVariations } from '../core/operations';
import { architectBlueprint, writeScreenplay } from '../core/story';
import { composeShotAction, directShotAction, analyzeEditMaster, editShotAction } from '../core/shot';
import { shotTalk } from '../core/talk';
import { breakdownScript, pagesLabel } from '../core/breakdown';
import { absLocalMediaUrl } from '../mediaUrl';
import { resolveModelId, defaultImageModelKey, DRAFT_MODE } from '../suiteConfig';

const CAST_KIND = { character: 'character', creature: 'character', location: 'location', prop: 'prop' };
const AD_PLATES = 10; // plates the 1st AD looks at (the planner's image limit)
// An element by its exact name (names are handed to the planners, so nothing is guessed).
const elementNamed = (elements, kind, name) => elements.find((e) => e.kind === kind && e.name.toLowerCase() === String(name || '').trim().toLowerCase()) || null;
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
const videoReady = (h) => h.guard(resolveModelId(VIDEO_MODEL), 'Seedance 2.5 is not configured.');
const shotJobs = (shots) => ({ shots: shots.map(({ sceneId, shot }) => ({ sceneId, shotId: shot.id })) });

// ---- the crew ------------------------------------------------------------------------------------
const ACTIONS = {
  // WRITERS — idea → blueprint → script.
  'writers.develop': {
    plan: (h, req) => {
      const idea = String(req.text || '').trim() || (req.from ? h.read.version(req.from.ref, req.from.vid)?.idea : '');
      h.guard(idea, 'Tell the writers the idea: @Writers develop <your idea>.');
      return h.go({ idea });
    },
    run: async (h, req, p) => {
      const v = h.open({ at: 'brief' }, { kind: 'script', idea: p.idea });
      try {
        // The story's structure first, then the screenplay written from it.
        const { blueprint, problems } = await h.think(architectBlueprint, { idea: h.note ? `${p.idea}\n\nDirector's note: ${h.note}` : p.idea });
        const text = await h.think(writeScreenplay, { blueprint, note: h.note });
        v.done({ text, title: blueprint.title || '', blueprint, flags: problems.map((x) => h.check.warn(x)) });
      } catch (e) { v.fail(e); }
    },
  },

  // 1st AD — the script breakdown: what the brief is (idea, treatment, screenplay), its
  // numbered scenes with their length, one breakdown sheet per scene, the film's elements.
  // Runs when the director presses Go on the plan's breakdown step.
  'ad.plan': {
    plan: (h) => { h.guard(String(h.read.state().script || '').trim(), 'Write or paste the brief first.'); return h.go(); },
    run: async (h) => {
      const script = h.read.state().script;
      const v = h.open({ at: 'brief' }, { kind: 'scriptBreakdown' });
      try {
        const b = await h.think(breakdownScript, { script });
        h.guard(b.form === 'screenplay', `This is ${b.form === 'idea' ? 'an idea' : 'a treatment'}, not a screenplay yet — Writers write it first.`);
        const total = b.scenes.reduce((n, sc) => n + sc.eighths, 0);
        v.done({
          payload: { ...b, scriptHash: scriptHash(script) },
          flags: [
            h.check.note(`${plural(b.scenes.length, 'scene')} · ${pagesLabel(total)} pages · ${plural(b.elements.cast.length, 'character')} · ${plural(b.elements.places.length, 'place')}`),
            ...(b.dropped || []).map((x) => h.check.warn(`Not in the scene's words, dropped: ${x}`)),
          ],
        });
      } catch (e) { v.fail(e); }
    },
  },

  // 1st AD — the film blocked scene by scene: one sheet per scene (place, views, start,
  // beats with what everyone looks at, end), each scene one take.
  'ad.breakdown': {
    plan: (h, req) => {
      const s = h.read.state();
      h.guard(String(s.script || '').trim(), 'Write or develop the script first.');
      // The AD sees picked plates only — plates still waiting for a pick are asked about.
      const waiting = s.elements.filter((el) => !el.viewOf && !plateOf(el) && (el.versions || []).some((x) => x.status === 'review'));
      if (waiting.length && !req.unpicked) {
        return h.ask(`${waiting.map((el) => el.name).join(', ')} ${waiting.length === 1 ? 'has a plate' : 'have plates'} waiting for your pick — the 1st AD only sees picked plates, and places need one for their views. Pick them in Review first?`, [{ label: 'Block without them', req: { ...req, unpicked: true } }]);
      }
      const plated = s.elements.filter((el) => !el.viewOf && el.kind !== 'location').filter((el) => { const p = plateOf(el); return p && (p.cacheUrl || p.url); });
      if (plated.length > AD_PLATES && !req.force) {
        return h.ask(`The 1st AD can look at ${AD_PLATES} plates; ${plated.length} people and props have one. Block the film seeing only ${plated.slice(0, AD_PLATES).map((el) => el.name).join(', ')}?`, [{ label: `Go ahead with these ${AD_PLATES}`, req: { ...req, force: true } }]);
      }
      return h.go();
    },
    run: async (h, req) => {
      const v = h.open({ at: 'brief' }, { kind: 'breakdown' });
      try {
        const s = h.read.state();
        // People and props the AD sees; places are handed over by name.
        const pool = s.elements.filter((el) => !el.viewOf && el.kind !== 'location').map((el) => ({ el, p: plateOf(el) })).filter((x) => x.p && (x.p.cacheUrl || x.p.url)).slice(0, AD_PLATES);
        const places = s.elements.filter((e) => e.kind === 'location' && !e.viewOf).map((e) => e.name);
        const scenes = await h.think(storyboardScenes, {
          script: s.script,
          references: pool.map((x) => absLocalMediaUrl(x.p.cacheUrl || x.p.url)),
          labels: pool.map((x) => `${x.el.name} (${KIND_LABEL[x.el.kind].replace(/s$/, '').toLowerCase()})`),
          places,
          note: [req.text, h.note].filter(Boolean).join('\n'),
        });
        const out = scenes.map((sc) => {
          const ids = [...new Set(sc.figures.map((g) => pool[g - 1].el.id))];
          const sheet = { place: sc.place, landmarks: sc.landmarks, views: sc.views, start: sc.start, beats: sc.beats, against: sc.against, end: sc.end };
          return {
            title: sc.title,
            shots: [{ title: sc.title, quote: sc.quote, seconds: sc.seconds, place: sc.place, motion: tokenized(s, sceneMotion(sc), ids), audio: sc.sound, elementIds: ids, unplated: sc.unplated, startFrom: sc.continues ? 'previous' : null, sheet }],
          };
        });
        const unbound = [...new Set(scenes.filter((sc) => !elementNamed(s.elements, 'location', sc.place)).map((sc) => sc.place))];
        // Script people and props no plate depicts — by the script's name, never another story's plate.
        const unplated = [...new Map(scenes.flatMap((sc) => sc.unplated).map((u) => [`${u.kind}|${u.name.toLowerCase()}`, u])).values()];
        v.done({
          payload: { scenes: out, unbound, unplated },
          flags: [
            h.check.note(`${plural(scenes.length, 'scene')} · ${scenes.reduce((n, sc) => n + sc.seconds, 0)} s · ${plural(scenes.reduce((n, sc) => n + sc.views.length, 0), 'view')}`),
            ...(unplated.length ? [h.check.warn(`No plate for: ${unplated.map((u) => u.name).join(', ')} — ask Casting`)] : []),
            ...(unbound.length ? [h.check.warn(`No plate yet: ${unbound.join(', ')}`)] : []),
          ],
        });
      } catch (e) { v.fail(e); }
    },
  },

  // CASTING — the planned plates; each element gets its plate as a version to review.
  'casting.cast': {
    plan: async (h, req) => {
      const s = h.read.state();
      h.guard(String(s.script || '').trim(), 'Write or develop the script first.');
      const existing = s.elements.map((e) => ({ name: e.name, kind: e.kind, plated: !!plateOf(e) }));
      const { arr, style } = await h.think(castPlanFromIdea, { idea: s.script, existing, note: [req.text, req.note].filter(Boolean).join('\n') });
      const jobs = arr.map((c) => {
        const kind = CAST_KIND[String(c.type || c.role || '').toLowerCase()] || 'location';
        const known = !!elementNamed(s.elements, kind, c.name);
        return { label: String(c.name || 'Asset'), detail: `${known ? '' : 'new · '}${kind === 'character' && c.facePrompt && c.bodyPrompt ? 'face + body' : 'plate'}` };
      });
      const images = arr.reduce((n, c) => n + (c.facePrompt && c.bodyPrompt ? 2 : 1), 0);
      return h.sheet(jobs, `${images} images · ${defaultImageModelKey() === 'seedreamPro' ? 'Seedream Pro' : 'Seedream'}`, { arr, style }, { images });
    },
    run: async (h, req, p) => {
      const { arr } = p;
      h.spend(arr.reduce((n, c) => n + (c.facePrompt && c.bodyPrompt ? 2 : 1), 0));
      // The same element when it already exists (the planner was given the exact names).
      const byIndex = {};
      const s = h.read.state();
      const fresh = [];
      arr.forEach((c, i) => {
        const kind = CAST_KIND[String(c.type || c.role || '').toLowerCase()] || 'location';
        const name = String(c.name || `Asset ${i + 1}`).slice(0, 80);
        const existing = elementNamed([...s.elements, ...fresh], kind, name);
        const el = existing || newElement({ kind, name, desc: String(c.facePrompt || c.prompt || c.presencePrompt || '').slice(0, 300) });
        if (!existing) fresh.push(el);
        byIndex[String(c.id != null ? c.id : i)] = el.id;
      });
      h.addElements(fresh);
      const face = {};
      Object.entries(byIndex).forEach(([idx, elId]) => { face[idx] = h.open({ at: 'element', id: elId }, { kind: 'plate' }); });
      await h.make.image(castDraftFromParsed, { arr, style: p.style, imageModel: defaultImageModelKey(), max: arr.length }, {
        onEntry: (entry) => {
          const v = face[entry.assetId];
          if (!v) return;
          if (entry.primary) {
            if (entry.failed) v.fail(new Error(`The plate did not render: ${entry.error || 'no reason given'}`));
            else v.done({ url: entry.url, cacheUrl: entry.cacheUrl || null });
          } else if (!entry.failed) {
            v.patch((w) => ({ extras: [...(w.extras || []), { url: entry.cacheUrl || entry.url, label: 'body' }] }));
          }
        },
      }).catch((e) => Object.values(face).forEach((v) => { if (h.read.version(v.ref, v.id)?.status === 'running') v.fail(e); }));
    },
  },

  // DESIGNER — the views a scene sheet asks for, each an edit of the place's picked plate so
  // every view is the same room in the same light.
  'designer.views': {
    plan: (h, req) => {
      const s = h.read.state();
      const shots = h.read.shots(req.scope).filter(({ shot }) => shot.sheet);
      h.guard(shots.length, 'Nothing here has a scene sheet — ask the 1st AD to block the film first.');
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
      h.guard(!unplated.length, `Cast ${unplated.map((b) => b?.name || 'the place').join(', ')} first — views are drawn from the place's plate.`);
      return h.sheet(views.map((x) => ({ label: findElement(s, x.elementId).name, detail: 'view' })), plural(views.length, 'image'), { views }, { images: views.length });
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
          const out = await h.make.image(plateEdit, { instruction, refs: [bp.cacheUrl || bp.url], imageModel: defaultImageModelKey() });
          v.done({ url: out.url, cacheUrl: out.cacheUrl || null, prompt: out.prompt });
        } catch (e) { v.fail(e); }
      }, 3);
    },
  },

  // CAMERA — drafts (480p) from the shot's text and its plates (cast, place, views); a shot
  // that starts where the previous one ends opens on that shot's last frame. A note reworks
  // the take's own prompt under the model's spec.
  'camera.draft': {
    plan: (h, req) => {
      videoReady(h);
      const s = h.read.state();
      const shots = h.read.shots(req.scope).filter(({ shot }) => req.from || req.scope.type === 'shot' || !shot.takes.picked);
      h.guard(shots.length, 'Every shot here has a circled take.');
      const unwritten = shots.filter((x) => !written(x));
      h.guard(!unwritten.length || req.from, `Write what happens in ${unwritten.map(({ shot }) => h.read.label(shot)).join(', ')} first.`);
      const orphan = shots.filter(({ shot }) => shot.startFrom === 'previous' && !pickedOf(h.read.prev(shot.id, s)?.takes));
      h.guard(!orphan.length, `${orphan.map(({ shot }) => h.read.label(shot)).join(', ')} start${orphan.length === 1 ? 's' : ''} where the shot before ends — circle a take of that shot first.`);
      const secs = shots.reduce((n, { shot }) => n + (Number(shot.seconds) || 0), 0);
      const detail = (shot) => `${shot.startFrom === 'previous' ? `from the end of ${h.read.label(h.read.prev(shot.id, s))} · ` : ''}480p · ${shot.seconds} s`;
      return h.ask.unplated(req, shots) || h.sheet(shots.map(({ shot }) => ({ label: h.read.label(shot), detail: detail(shot) })), `${plural(shots.length, 'draft')} · ${secs} s · Seedance 2.5`, shotJobs(shots), { takes: shots.length });
    },
    run: (h, req, p) => shootDrafts(h, req, p),
  },
  // FINAL — a draft at full resolution (1080p MOV, the same picture). From a draft in Review
  // (`from`), or every circled draft in a scene or shot.
  'camera.final': {
    plan: (h, req) => {
      videoReady(h);
      const live = (t) => t?.draft?.taskId && Date.now() - t.draft.at < DRAFT_MODE.ttlMs;
      const shots = h.read.shots(req.scope)
        .map((x) => ({ ...x, take: req.from ? h.read.version(req.from.ref, req.from.vid) : pickedOf(x.shot.takes) }))
        .filter((x) => live(x.take));
      h.guard(shots.length, req.from ? 'This draft can no longer be finished (drafts finish within 7 days) — draft the shot again.' : 'Circle a draft first (drafts finish within 7 days).');
      const secs = shots.reduce((n, { shot }) => n + (Number(shot.seconds) || 0), 0);
      return h.sheet(shots.map(({ shot }) => ({ label: h.read.label(shot), detail: `${FINAL_RES} MOV · ${shot.seconds} s` })), `${plural(shots.length, 'final')} · ${secs} s · ${FINAL_RES} MOV`, { shots: shots.map(({ sceneId, shot, take }) => ({ sceneId, shotId: shot.id, takeId: take.id })) }, { takes: shots.length });
    },
    run: async (h, req, p) => {
      h.spend(p.shots.length);
      await h.each(p.shots, async ({ sceneId, shotId, takeId }) => {
        const draftTake = h.read.version({ at: 'take', sceneId, shotId }, takeId);
        if (!draftTake?.draft?.taskId) return;
        const v = h.open({ at: 'take', sceneId, shotId }, { parent: draftTake.id, final: true, kind: 'take', res: FINAL_RES, prompt: draftTake.prompt, used: draftTake.used, inputs: [{ n: 1, label: 'the draft', url: draftTake.cacheUrl || draftTake.url, role: 'draft', versionId: draftTake.id, video: true }, ...(draftTake.inputs || []).map((x) => ({ ...x, n: x.n + 1 }))] });
        try { await h.make.finish({ v, draftTake }); } catch (e) { v.fail(e); }
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
      h.guard(String(req.note || req.text || '').trim(), 'Say what changes: @VFX edit <what changes>.');
      const secs = Number(source.seconds || shot.seconds) || 0;
      h.guard(!secs || (secs >= 4 && secs <= 30), `The source is ${secs} s — an edit needs 4–30 s.`);
      return h.sheet([{ label: h.read.label(shot), detail: `edit · ${FINAL_RES} MOV${secs ? ` · ${secs} s` : ''}` }], `1 edit · ${FINAL_RES} MOV · Seedance 2.5`, { sceneId: req.scope.sceneId, shotId: shot.id, sourceId: source.id }, { takes: 1 });
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

  // EDITOR — the circled takes, in film order, into one cut.
  'editor.assemble': {
    plan: (h, req) => {
      const s = h.read.state();
      const all = s.scenes.flatMap((sc) => sc.shots);
      h.guard(all.length, 'No shots yet.');
      const missing = all.filter((sh) => !pickedOf(sh.takes));
      h.guard(missing.length < all.length, 'Circle some takes first.');
      if (missing.length && !req.force) return h.ask(`${missing.map((sh) => pad2(shotNumber(s, sh.id))).join(', ')} ${missing.length === 1 ? 'has' : 'have'} no circled take.`, [{ label: 'Assemble without', req: { ...req, force: true } }]);
      return h.go();
    },
    run: async (h) => {
      const takes = h.read.state().scenes.flatMap((sc) => sc.shots).map((sh) => pickedOf(sh.takes)).filter(Boolean);
      const v = h.open({ at: 'cut' }, { kind: 'cut', takes: takes.map((t) => t.id) });
      try {
        const { url, posterUrl } = await h.make.stitch(takes.map((t) => t.cacheUrl || t.url), 'studio-cut');
        v.done({ url, cacheUrl: url, format: takes.some((t) => t.format === 'mov') ? 'mov' : 'mp4', flags: [h.check.note(plural(takes.length, 'take'))], posterUrl });
      } catch (e) { v.fail(e); }
    },
  },
};

// CASTING / DESIGNER — variations of one element (from its picked plate, or the one noted).
// No plate yet: the agent first draws one from the description, then varies it.
const variation = {
  plan: (h, req) => {
    const el = findElement(h.read.state(), req.scope.id);
    h.guard(el, 'That element is gone.');
    const count = req.from ? 1 : 2;
    const images = count + (req.from || plateOf(el) ? 0 : 1);
    return h.sheet([{ label: el.name, detail: images > count ? `a plate + ${count} variations` : plural(count, 'variation') }], plural(images, 'image'), { count, images }, { images });
  },
  run: async (h, req, p) => {
    const s = h.read.state();
    const el = findElement(s, req.scope.id);
    const ref = { at: 'element', id: el.id };
    const base = req.from ? h.read.version(ref, req.from.vid, s) : plateOf(el);
    const direction = [h.note, req.text].filter(Boolean).join('. ') || el.desc || el.name;
    h.spend(p.images || p.count);
    const baseInput = base && (base.cacheUrl || base.url) ? [{ n: 1, label: req.from ? 'the plate noted' : 'the picked plate', url: base.cacheUrl || base.url, role: 'source', versionId: base.id }] : [];
    const vs = Array.from({ length: p.count }, () => h.open(ref, { kind: 'plate', inputs: baseInput }));
    let k = 0;
    const out = await h.make.image(el.kind === 'character' ? characterVariations : locationVariations, { imageUrl: base ? (base.cacheUrl || base.url) : '', direction, count: p.count, imageModel: defaultImageModelKey() }, {
      onItem: (item) => { const v = vs[k]; k += 1; if (v) v.done({ url: item.url, cacheUrl: item.cacheUrl || null }); },
      onFail: (i, msg) => { const v = vs[k]; k += 1; if (v) v.fail(new Error(msg)); },
      onAnchor: (a) => h.open(ref, { kind: 'plate' }).done({ url: a.url, cacheUrl: a.cacheUrl || null }),
    }).catch((e) => ({ errors: [e.message] }));
    vs.slice(k).forEach((v) => v.fail(new Error((out?.errors || [])[0] || 'Did not render')));
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
    const v = h.open(ref, { kind: 'take', res: DRAFT_MODE.resolution, used: usedOf(s, shot) });
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
        const out = await h.think(directShotAction, { text: prev.prompt, note: h.note, references: list.map((r) => absLocalMediaUrl(r.url)), roster, kfIndices: opening ? [1] : [], modelKey: VIDEO_MODEL });
        report(out);
        prompt = [out.action, out.audio].filter(Boolean).join('\n');
      } else if (opening || shot.sheet) {
        const out = await h.think(composeShotAction, { text: [modelText(s, shot.motion || shot.quote, imageOf), req.text, shot.audio].filter(Boolean).join('\n'), references: list.map((r) => absLocalMediaUrl(r.url)), roster, kfIndices: opening ? [1] : [], modelKey: VIDEO_MODEL, job: shot.turn, derive: !shot.sheet });
        report(out);
        prompt = [out.action, out.audio].filter(Boolean).join('\n');
      } else {
        prompt = [modelText(s, shot.motion || shot.quote, imageOf), req.text, shot.audio].filter(Boolean).join('\n');
      }
      await h.make.take({ v, prompt, list, seconds: shot.seconds, draft: true, flags });
    } catch (e) { v.fail(e); }
  }, 3);
};

export const createRunners = ({ get, set, ctx }) => {
  const harness = createHarness({ get, set, ctx });
  const entry = (req) => {
    const a = ACTIONS[`${req.agent}.${req.action}`];
    if (!a) throw new Error('That crew member has no such job here.');
    return a;
  };
  // PLAN: what a request will do, before anything is spent.
  const plan = async (req) => entry(req).plan(harness.plan, req);
  // RUN: the work; everything it makes lands as versions announced in the scope's thread.
  const run = async (req, payload = {}) => {
    const a = entry(req);
    const { h, end } = harness.run(req);
    try { await a.run(h, req, payload); } finally { end(); }
  };

  // Takes in flight when the page closed pick their polling back up; other work that was
  // running did not survive the reload.
  const resume = () => {
    const s = get();
    s.scenes.forEach((sc) => sc.shots.forEach((sh) => (sh.takes.versions || []).forEach((v) => {
      if (v.status !== 'running') return;
      const ver = harness.version({ at: 'take', sceneId: sc.id, shotId: sh.id }, v.id);
      if (v.taskId) harness.make.poll(ver, v.taskId, { draft: v.res === DRAFT_MODE.resolution }).catch((e) => ver.fail(e));
      else ver.fail(new Error('Interrupted — ask again'));
    })));
    const stop = (ref, c) => (c?.versions || []).forEach((v) => { if (v.status === 'running') harness.version(ref, v.id).fail(new Error('Interrupted — ask again')); });
    stop({ at: 'brief' }, s.brief);
    stop({ at: 'cut' }, s.cut);
    s.elements.forEach((el) => stop({ at: 'element', id: el.id }, el));
  };

  return { plan, run, resume, crewName: (id) => crewById(id)?.name || id, namedText: (t) => namedText(get(), t) };
};

// Applying a picked breakdown: the scenes and shots it proposed become the film's, and every
// place without a location element gets one (no plate yet — the crew will ask for it).
export const applyBreakdown = (s, payload) => {
  let elements = s.elements;
  (payload.unbound || []).forEach((place) => {
    if (!elements.some((e) => e.kind === 'location' && e.name.toLowerCase() === String(place).toLowerCase())) elements = [...elements, newElement({ kind: 'location', name: place })];
  });
  // People and props the script has and no plate depicts: elements without a plate yet, so
  // the crew asks for them before it shoots.
  (payload.unplated || []).forEach((u) => {
    if (!elements.some((e) => e.kind === u.kind && !e.viewOf && e.name.toLowerCase() === u.name.toLowerCase())) elements = [...elements, newElement({ kind: u.kind, name: u.name })];
  });
  const unplatedIds = (x) => (x.unplated || []).map((u) => elements.find((e) => e.kind === u.kind && !e.viewOf && e.name.toLowerCase() === u.name.toLowerCase())?.id).filter(Boolean);
  const byPlace = (place) => elements.find((e) => e.kind === 'location' && !e.viewOf && e.name.toLowerCase() === String(place).toLowerCase());
  // A scene sheet's views become elements of their own, drawn later from the place's plate.
  const viewElement = (loc, vw) => {
    const name = `${loc.name} · ${vw.name}`;
    const found = elements.find((e) => e.viewOf === loc.id && e.name === name);
    if (found) return found;
    const el = { ...newElement({ kind: 'location', name, desc: vw.from }), viewOf: loc.id };
    elements = [...elements, el];
    return el;
  };
  const scenes = (payload.scenes || []).map((sc) => ({
    id: uid('sc-'),
    title: sc.title,
    shots: sc.shots.map((shot) => {
      const extra = unplatedIds(shot).filter((id) => !shot.elementIds.includes(id));
      const x = extra.length ? { ...shot, elementIds: [...shot.elementIds, ...extra], motion: tokenized({ ...s, elements }, shot.motion, extra) } : shot;
      const loc = byPlace(x.place);
      if (x.sheet && loc) {
        const viewIds = x.sheet.views.map((vw) => viewElement(loc, vw).id);
        return newShot({ ...x, sheet: { ...x.sheet, viewIds }, elementIds: [...x.elementIds, ...viewIds] });
      }
      return newShot({ ...x, elementIds: loc && !x.elementIds.includes(loc.id) ? [...x.elementIds, loc.id] : x.elementIds });
    }),
  }));
  return { ...s, elements, scenes };
};

export const containerLabel = (s, ref) => {
  if (ref.at === 'brief') return 'Brief';
  if (ref.at === 'cut') return 'Cut';
  if (ref.at === 'element') return findElement(s, ref.id)?.name || 'Element';
  const sh = findShot(s, ref.sceneId, ref.shotId);
  return sh ? `${pad2(shotNumber(s, sh.id))} ${sh.title}` : 'Shot';
};
export { containerOf };
