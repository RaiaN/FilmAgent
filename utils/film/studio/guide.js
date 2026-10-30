// THE GUIDE — how the harness makes a film, step by step: Script → Cast & World → Scenes → Cut.
// Read from the film as it stands, never stored. A step names one thing for the director to do:
//   run     a crew job, on one click (the job's own contract, checks and versions)
//   review  versions waiting for a verdict
//   say     a crew job that needs the director's words
//   write   the director's own words on the page
//   final   a scene's circled drafts at full resolution
// Nothing runs by itself: a step happens when the director presses it.
import { findElement, pickedOf, shotListFresh, newWork } from './model';
import { parseScript } from '../core/scriptForm';
import { DRAFT_MODE, draftFinalsOf } from '../suiteConfig';

export const STAGES = [
  { id: 'script', label: 'Script' },
  { id: 'world', label: 'Cast & World' },
  { id: 'scenes', label: 'Scenes' },
  { id: 'cut', label: 'Cut' },
];

const STAGE_OF = { brief: 'script', world: 'world', element: 'world', scenes: 'scenes', scene: 'scenes', shot: 'scenes', cut: 'cut' };
export const stageOf = (scope) => STAGE_OF[scope?.type] || 'script';
export const scopeOfStage = (id) => ({ script: { type: 'brief' }, world: { type: 'world' }, scenes: { type: 'scenes' }, cut: { type: 'cut' } }[id]);
const STAGE_OF_REF = { brief: 'script', element: 'world', scene: 'scenes', take: 'scenes', cut: 'cut' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const running = (c) => (c?.versions || []).some((v) => v.status === 'running');
const waiting = (c) => (c?.versions || []).some((v) => v.status === 'review');
const empty = (c) => !(c?.versions || []).some((v) => v.status !== 'failed' && v.status !== 'rejected' && !v.archived);
const allShots = (s) => s.scenes.flatMap((sc) => sc.shots);
const said = (shot) => !!String(shot.motion || shot.quote || '').trim();

// What Casting and the Designer fill: everyone and everywhere, without the views of a place.
export const castOf = (s) => s.elements.filter((e) => !e.viewOf);
const plateable = (e) => !e.viewOf && e.kind !== 'prop';
export const viewsOfShot = (s, shot) => (shot.sheet?.viewIds || []).map((id) => findElement(s, id)).filter(Boolean);

const finishable = (t) => !!t?.draft?.taskId && Date.now() - t.draft.at < DRAFT_MODE.ttlMs && !t.final;
// The resolutions every circled draft of these shots can finish at.
export const finalsOfShots = (shots) => {
  const lists = shots.map((sh) => pickedOf(sh.takes)).filter(finishable).map((t) => draftFinalsOf(t.draft.modelKey || 'seedance25'));
  return lists.length ? lists.reduce((a, b) => a.filter((r) => b.includes(r))) : [];
};
// A finished take of a draft that is circled: its final waits or renders, so it is not finished again.
const hasFinal = (sh) => { const t = pickedOf(sh.takes); return (sh.takes.versions || []).some((v) => v.final && v.parent === t?.id && v.status !== 'failed' && v.status !== 'rejected'); };
export const toFinish = (sc) => sc.shots.filter((sh) => finishable(pickedOf(sh.takes)) && !hasFinal(sh));

// Every step open now, in film order. A stage only opens once the one it stands on has given it
// what it needs: Cast & World and Scenes need the shot list (or footage); the Cut a circled take.
export const stepsOf = (s) => {
  const out = [];
  const script = String(s.script || '').trim();
  const footageFirst = !script && s.scenes.length > 0;

  // SCRIPT
  if (!footageFirst) {
    const brief = s.brief;
    if (running(brief)) return [{ id: 'script.working', stage: 'script', scope: { type: 'brief' }, working: true }];
    const scriptWaits = (brief.versions || []).find((v) => v.status === 'review' && v.kind === 'script');
    const listWaits = (brief.versions || []).find((v) => v.status === 'review' && v.kind === 'shotList');
    if (scriptWaits) return [{ id: 'script.review', stage: 'script', scope: { type: 'brief' }, label: 'Review the screenplay', review: { ref: { at: 'brief' }, vid: scriptWaits.id } }];
    if (!script) return [{ id: 'script.write', stage: 'script', scope: { type: 'brief' }, label: 'Write your idea, or paste a script', write: true }];
    if (parseScript(script).form !== 'screenplay') return [{ id: 'script.develop', stage: 'script', scope: { type: 'brief' }, label: 'Write the screenplay', agent: 'writers', run: { agent: 'writers', action: 'develop', scope: { type: 'brief' }, text: script } }];
    if (listWaits) return [{ id: 'script.reviewList', stage: 'script', scope: { type: 'brief' }, label: 'Review the shot list', review: { ref: { at: 'brief' }, vid: listWaits.id } }];
    // A script that changed after the film was laid out asks for a new list, but holds nothing up.
    if (!shotListFresh(s)) {
      const step = { id: 'script.shots', stage: 'script', scope: { type: 'brief' }, label: s.shotList ? 'Write the shot list again' : 'Write the shot list', agent: 'ad', run: { agent: 'ad', action: 'shots', scope: { type: 'brief' }, text: '' } };
      if (!s.scenes.length) return [step];
      out.push(step);
    }
  }

  // CAST & WORLD
  const unplated = s.elements.filter((e) => plateable(e) && empty(e));
  const plates = s.elements.filter((e) => !e.viewOf && waiting(e));
  if (s.elements.some((e) => !e.viewOf && running(e))) out.push({ id: 'world.working', stage: 'world', scope: { type: 'world' }, working: true });
  if (unplated.length) out.push({ id: 'world.cast', stage: 'world', scope: { type: 'world' }, label: `Cast the film · ${unplated.length}`, agent: 'casting', run: { agent: 'casting', action: 'cast', scope: { type: 'world' }, text: '' } });
  if (plates.length) {
    const first = plates[0];
    out.push({ id: 'world.review', stage: 'world', scope: { type: 'world' }, label: `Review ${plural(plates.length, 'plate')}`, review: { ref: { at: 'element', id: first.id }, vid: first.versions.find((v) => v.status === 'review').id } });
  }

  // SCENES — scene by scene, in order.
  s.scenes.forEach((sc) => {
    const scope = { type: 'scene', id: sc.id };
    if (running(sc.blocking) || sc.shots.some((sh) => running(sh.takes) || viewsOfShot(s, sh).some(running))) out.push({ id: `scene.${sc.id}.working`, stage: 'scenes', scope, working: true });
    if (!sc.shots.length) {
      if (String(sc.text || '').trim() && !running(sc.blocking) && !waiting(sc.blocking)) out.push({ id: `scene.${sc.id}.block`, stage: 'scenes', scope, label: "Plan this scene's shots", agent: 'ad', run: { agent: 'ad', action: 'block', scope, text: '' } });
    }
    if (waiting(sc.blocking)) {
      const v = sc.blocking.versions.find((x) => x.status === 'review');
      out.push({ id: `scene.${sc.id}.reviewShots`, stage: 'scenes', scope, label: 'Review the new shots', review: { ref: { at: 'scene', sceneId: sc.id }, vid: v.id } });
    }
    const views = [...new Set(sc.shots.flatMap((sh) => viewsOfShot(s, sh)))];
    const noView = views.filter((el) => empty(el));
    const viewsCanDraw = noView.some((el) => pickedOf(findElement(s, el.viewOf)));
    if (noView.length && viewsCanDraw) out.push({ id: `scene.${sc.id}.views`, stage: 'scenes', scope, label: `Draw ${plural(noView.length, 'view')}`, agent: 'designer', run: { agent: 'designer', action: 'views', scope, text: '' } });
    const newViews = views.filter((el) => waiting(el));
    if (newViews.length) out.push({ id: `scene.${sc.id}.reviewViews`, stage: 'scenes', scope, label: `Review ${plural(newViews.length, 'view')}`, review: { ref: { at: 'element', id: newViews[0].id }, vid: newViews[0].versions.find((v) => v.status === 'review').id } });
    // A shot drafts once what rides on it is settled: no plate of it rendering or waiting for you.
    const settled = (sh) => (sh.elementIds || []).map((id) => findElement(s, id)).every((el) => !el || (!running(el) && !waiting(el)));
    const todo = sc.shots.filter((sh) => said(sh) && empty(sh.takes) && settled(sh));
    if (todo.length && !noView.length) out.push({ id: `scene.${sc.id}.draft`, stage: 'scenes', scope, label: `Draft ${plural(todo.length, 'shot')}`, agent: 'camera', run: { agent: 'camera', action: 'draft', scope, text: '' } });
    const takesNew = sc.shots.filter((sh) => waiting(sh.takes));
    if (takesNew.length) {
      const sh = takesNew[0];
      out.push({ id: `scene.${sc.id}.reviewTakes`, stage: 'scenes', scope, label: `Review ${plural(takesNew.length, 'take')}`, review: { ref: { at: 'take', sceneId: sc.id, shotId: sh.id }, vid: sh.takes.versions.find((v) => v.status === 'review').id } });
    }
    // Your performance is in: the VFX edit turns it into the film, from your words.
    sc.shots.forEach((sh) => {
      const t = pickedOf(sh.takes);
      if (t?.footage && !(sh.takes.versions || []).some((v) => v.parent === t.id)) out.push({ id: `shot.${sh.id}.edit`, stage: 'scenes', scope: { type: 'shot', sceneId: sc.id, id: sh.id }, label: 'Edit your performance', agent: 'vfx', say: '@VFX ' });
    });
  });

  // CUT — a rough cut as soon as every shot has a circled take; again when a circled take changes.
  const shots = allShots(s);
  const circled = shots.filter((sh) => pickedOf(sh.takes));
  const cut = pickedOf(s.cut);
  const cutWaits = (s.cut.versions || []).find((v) => v.status === 'review');
  const allCircled = shots.length > 0 && circled.length === shots.length;
  if (running(s.cut)) out.push({ id: 'cut.working', stage: 'cut', scope: { type: 'cut' }, working: true });
  else if (cutWaits) out.push({ id: 'cut.review', stage: 'cut', scope: { type: 'cut' }, label: 'Review the cut', review: { ref: { at: 'cut' }, vid: cutWaits.id } });
  // Once no take is rendering or waiting for you: what is circled then is what the cut holds.
  else if (allCircled && shots.every((sh) => !running(sh.takes) && !waiting(sh.takes))) {
    const same = cut && [...(cut.takes || [])].sort().join() === circled.map((sh) => sh.takes.picked).sort().join();
    if (!same) out.push({ id: 'cut.assemble', stage: 'cut', scope: { type: 'cut' }, label: cut ? 'Assemble the cut again' : 'Assemble the rough cut', agent: 'editor', run: { agent: 'editor', action: 'assemble', scope: { type: 'cut' }, text: '' } });
    // The cut holds: the circled drafts finish at full resolution, scene by scene.
    if (same) {
      s.scenes.forEach((sc, i) => {
        const list = toFinish(sc);
        const res = finalsOfShots(list);
        if (list.length && res.length) out.push({ id: `scene.${sc.id}.final`, stage: 'scenes', scope: { type: 'scene', id: sc.id }, label: `Final scene ${i + 1} · ${res[0]}`, agent: 'camera', final: { sceneId: sc.id, res: res[0] } });
      });
    }
  }
  return out;
};

// THE NEXT STEP: what is open where you stand (this shot, this scene, this stage); else the
// film's next one, so a render here never holds up the rest. Null when nothing is open.
export const nextStep = (s, scope) => {
  const stage = stageOf(scope);
  const here = (st) => {
    if (scope?.type === 'shot') return st.scope.id === scope.id || (st.scope.type === 'scene' && st.scope.id === scope.sceneId);
    if (scope?.type === 'scene') return st.scope.id === scope.id || st.scope.sceneId === scope.id;
    return st.stage === stage;
  };
  const open = stepsOf(s).filter((st) => !st.working);
  return open.find(here) || open[0] || null;
};

// THE STAGES AS THEY STAND — for the stepper: done, how far (a short count), work in progress,
// what waits for you.
export const stageStates = (s) => {
  const all = newWork(s);
  const at = (id) => (x) => STAGE_OF_REF[x.ref.at] === id;
  const running_ = (id) => {
    if (id === 'script') return running(s.brief);
    if (id === 'world') return s.elements.some((e) => !e.viewOf && running(e));
    if (id === 'scenes') return s.scenes.some((sc) => running(sc.blocking) || sc.shots.some((sh) => running(sh.takes) || viewsOfShot(s, sh).some(running)));
    return running(s.cut);
  };
  const cast = castOf(s);
  const plated = cast.filter((e) => pickedOf(e)).length;
  const shots = allShots(s);
  const circled = shots.filter((sh) => pickedOf(sh.takes)).length;
  const script = String(s.script || '').trim();
  const listed = !script ? s.scenes.length > 0 : shotListFresh(s);
  return {
    script: { done: listed, count: listed && s.scenes.length ? plural(s.scenes.length, 'scene') : '' },
    world: { done: cast.length > 0 && plated === cast.length, count: cast.length ? `${plated}/${cast.length}` : '' },
    scenes: { done: shots.length > 0 && circled === shots.length, count: shots.length ? `${circled}/${shots.length}` : '' },
    cut: { done: !!pickedOf(s.cut), count: '' },
    fresh: Object.fromEntries(STAGES.map(({ id }) => [id, all.fresh.filter(at(id)).length])),
    working: Object.fromEntries(STAGES.map(({ id }) => [id, running_(id)])),
  };
};

// The picture that stands for a scene: its circled take, else its newest take, else a view, else
// the place's plate.
export const sceneHero = (s, sc) => {
  const takes = sc.shots.flatMap((sh) => (sh.takes.versions || []).filter((v) => v.status !== 'failed' && v.status !== 'rejected' && v.status !== 'running' && !v.archived));
  const circled = sc.shots.map((sh) => pickedOf(sh.takes)).find(Boolean);
  const take = circled || takes[takes.length - 1];
  if (take) return take;
  const view = sc.shots.flatMap((sh) => viewsOfShot(s, sh)).map((el) => pickedOf(el)).find(Boolean);
  if (view) return view;
  const place = s.elements.find((e) => !e.viewOf && e.kind === 'location' && e.name.toLowerCase() === String(sc.place || '').toLowerCase());
  return pickedOf(place) || null;
};
