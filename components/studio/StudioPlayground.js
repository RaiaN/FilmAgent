import { useCallback, useEffect, useRef, useState } from 'react';
import { Dropdown, Menu, Message, Modal } from '@arco-design/web-react';
import { IconApps, IconCheck, IconDown } from '@arco-design/web-react/icon';
import { C, MONO, STUDIO_CSS, Dot } from './ui';
import { DirectPage, Working } from './DirectView';
import { GenerateBar } from './GenerateBar';
import { Viewer } from './Viewer';
import GenerationsView from './GenerationsView';
import {
  emptyStudio, loadStudio, syncBoard, uid, findShot, pickVersion, rejectVersion,
  patchVersion, pickedOf, newWork, takeOf, usedOf, versionOf, allVersions,
} from '../../utils/film/studio/model';
import { applyShotList, applyBlocking } from '../../utils/film/studio/layout';
import { mergeStudio, sameFilm, withRemovals } from '../../utils/film/studio/sync';
import { STAGES, stageOf, scopeOfStage, stageStates } from '../../utils/film/studio/guide';
import { barForShot, barFromFrame, barToEdit, barToRework, emptyBar, needsOfScene, requestOf } from '../../utils/film/studio/bar';
import { elementToCanvas, shotToCanvas, versionToCanvas } from '../../utils/film/studio/canvasLink';

const FOLLOW_MS = 2000;
const SETTLE_MS = 8000;

// STUDIO — script to screen on one big screen: Script → Cast & World → Scenes → Cut, with the
// Generate bar docked under every page. Its buttons call the film tools directly, the same tools
// FilmAgent uses, on the same film; a shot's newest take stands until you reject it.
// GENERATIONS shows every render. Saved inside the open project.

const JOB_POLL_MS = 1500;
// Tools run as background jobs on the server: the page only asks after them now and then, so its
// pictures never queue behind a long render.
const callTool = async (tool, args) => {
  const res = await fetch('/api/film/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, args, background: true }) });
  const started = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(started.error || `${tool} answered ${res.status}`);
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, JOB_POLL_MS));
    // eslint-disable-next-line no-await-in-loop
    const poll = await fetch(`/api/film/tools?job=${encodeURIComponent(started.job)}`);
    // eslint-disable-next-line no-await-in-loop
    const job = await poll.json().catch(() => ({}));
    if (!poll.ok) throw new Error(job.error || `${tool} answered ${poll.status}`);
    if (job.done) {
      if (job.error) throw new Error(job.error);
      return job.out;
    }
  }
};

// THE STAGES, always on top: where the film stands, and what waits in each.
const Stages = ({ s, scope, on, go }) => {
  const st = stageStates(s);
  const here = stageOf(scope);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, margin: '0 auto', flex: '0 1 auto', minWidth: 0 }}>
      {STAGES.map(({ id, label }, i) => {
        const active = on && here === id;
        const done = st[id].done;
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            
            <span role="button" className="st-stage" onClick={() => go(id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, height: 44, padding: '0 12px 0 8px', borderRadius: 12, cursor: 'pointer', background: active ? C.hover : 'transparent', whiteSpace: 'nowrap' }}>
              <span style={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 13.5, fontWeight: 700, flex: '0 0 auto', background: active ? C.accent : done ? C.goodSoft : C.raised, color: active ? C.accentInk : done ? C.good : C.muted, boxShadow: active || done ? 'none' : `inset 0 0 0 1px ${C.lineHi}` }}>{done && !active ? <IconCheck /> : i + 1}</span>
              <span style={{ fontSize: 16, fontWeight: active ? 700 : 600, color: active ? C.ink : C.text, letterSpacing: -0.1 }}>{label}</span>
              {st.working[id] && <Dot color={C.work} pulse size={8} />}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// THE PROJECT MENU — open, start, switch and set up projects from the Studio.
const ProjectMenu = ({ project, title, container }) => {
  if (!project) return <span style={{ fontWeight: 700, fontSize: 16, color: C.ink }}>{title || 'Studio'}</span>;
  const run = (key) => {
    if (key === 'new') project.newProject();
    else if (key === 'cloud') project.openCloud();
    else if (key === 'settings') project.openSettings();
    else if (key === 'prompts') project.openPrompts();
    else if (key === 'skills') project.openSkills();
    else if (key === 'save') project.saveNow();
  };
  const menu = (
    <Menu onClickMenuItem={run} style={{ minWidth: 220 }}>
      <Menu.Item key="cloud">Open a project…</Menu.Item>
      <Menu.Item key="save">Save now</Menu.Item>
      <Menu.Item key="new">New project</Menu.Item>
      <Menu.Item key="settings">Project settings…</Menu.Item>
      <Menu.Item key="skills">Model skills…</Menu.Item>
      <Menu.Item key="prompts">Prompt templates…</Menu.Item>
    </Menu>
  );
  return (
    <Dropdown droplist={menu} trigger="click" position="bl" getPopupContainer={() => container() || document.body}>
      <span role="button" className="st-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 8px', marginLeft: -8, borderRadius: 8, border: '1px solid transparent', cursor: 'pointer', minWidth: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'clamp(90px, 15vw, 260px)' }}>{title || 'Untitled'}</span>
        <IconDown style={{ fontSize: 12, color: C.muted, flex: '0 0 auto' }} />
      </span>
    </Dropdown>
  );
};

const StudioPlayground = ({ projectStudio = null, onStudioChange, projectTitle = '', board = null, project = null, onOpenInCanvas }) => {
  const rootRef = useRef(null);
  // The film lives in a ref that work under way can read and write, mirrored into React state.
  const sRef = useRef(emptyStudio());
  const [s, setS] = useState(sRef.current);
  const set = useCallback((fn) => { sRef.current = typeof fn === 'function' ? fn(sRef.current) : fn; setS(sRef.current); }, []);
  const get = useCallback(() => sRef.current, []);
  const [linked, setLinked] = useState(null);
  const [mode, setMode] = useState('direct');
  const [scope, setScope] = useState({ type: 'brief' });
  // The version open in the viewer ({ ref, vid }), or none.
  const [view, setView] = useState(null);
  // What is being made right now, for the top bar and each button's spinner.
  const [jobs, setJobs] = useState([]);
  // Collapsed, the page keeps the room for the takes; the plates beside a shot or the bar itself open it.
  const [barOpen, setBarOpen] = useState(false);
  // The bar: one per shot you have been on, so your words wait for you. `touched` keeps your words
  // from being replaced when a plate arrives.
  const bars = useRef({});
  const [bar, setBarState] = useState(() => emptyBar(emptyStudio()));
  const barRef = useRef(bar);
  const showBar = (next) => { barRef.current = next; setBarState(next); if (next.shotId) bars.current[next.shotId] = next; };
  const setBar = (fn) => showBar({ ...(typeof fn === 'function' ? fn(barRef.current) : fn), touched: true });

  // Load with the project — once per load (a re-run of this effect must never put an older
  // snapshot back); every change goes back into it.
  const loadedNonce = useRef(null);
  // The film as last matched with the cloud, to see what was removed since and what moved.
  const synced = useRef({ film: null, revision: null });
  useEffect(() => {
    if (!projectStudio?.projectId || loadedNonce.current === projectStudio.nonce) return;
    loadedNonce.current = projectStudio.nonce;
    const loaded = loadStudio(projectStudio.data);
    set(loaded);
    synced.current = { film: loaded, revision: null };
    setLinked(projectStudio.projectId);
    bars.current = {};
    showBar(emptyBar(loaded));
    setScope(loaded.scenes.length ? { type: 'scenes' } : { type: 'brief' });
    setView(null);
    setMode('direct');
  }, [projectStudio?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  // The project's Canvas, mirrored: new plates, SHOT cards and takes come in as they appear.
  useEffect(() => {
    // Switching projects, this runs once with the new film already loaded and `linked` and `board`
    // still the old project's: only a board of the project that is open now comes in.
    if (!linked || linked !== projectStudio?.projectId || board?.projectId !== linked) return;
    const next = syncBoard(get(), board);
    if (next !== get()) set(next);
  }, [board, linked, projectStudio?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Every change goes into the project at once — the project's save decides when it
    // reaches disk and cloud.
    if (!linked) return;
    const marked = withRemovals(synced.current.film, s);
    synced.current.film = marked;
    if (marked !== s) { set(marked); return; }
    if (onStudioChange) onStudioChange(linked, s);
  }, [s, linked]); // eslint-disable-line react-hooks/exhaustive-deps
  // What the film tools do reaches this tab: their changes merge into the film held here.
  useEffect(() => {
    if (!linked) return undefined;
    let live = true;
    let timer = null;
    const tick = async () => {
      try {
        const since = synced.current.revision ? `&since=${encodeURIComponent(synced.current.revision)}` : '';
        const res = await fetch(`/api/film/cloud?action=studio&id=${encodeURIComponent(linked)}${since}`);
        const out = await res.json();
        if (live && res.ok && !out.same && out.revision) {
          synced.current.revision = out.revision;
          if (out.studio) {
            const merged = mergeStudio(loadStudio(out.studio), get());
            if (!sameFilm(merged, get())) set(merged);
          }
        }
      } catch { /* the next tick asks again */ }
      if (live) timer = setTimeout(tick, FOLLOW_MS);
    };
    tick();
    return () => { live = false; clearTimeout(timer); };
  }, [linked]); // eslint-disable-line react-hooks/exhaustive-deps

  // A render ends whether or not anyone is waiting: while this film has one running, ask, one pass
  // at a time.
  useEffect(() => {
    if (!linked) return undefined;
    let live = true;
    let timer = null;
    const tick = async () => {
      if (allVersions(get()).some((x) => x.v.status === 'running' && x.v.taskId && x.v.by !== 'board')) await callTool('settle_renders', { project: linked }).catch(() => {});
      if (live) timer = setTimeout(tick, SETTLE_MS);
    };
    timer = setTimeout(tick, SETTLE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [linked, get]);
  // The bar follows the shot you are on.
  useEffect(() => {
    const scene = scope.type === 'scene' ? get().scenes.find((x) => x.id === scope.id) : null;
    const shot = scope.type === 'shot' ? findShot(get(), scope.sceneId, scope.id) : scene?.shots[0];
    if (!shot) return;
    const sceneId = scope.type === 'shot' ? scope.sceneId : scope.id;
    // Words left on a shot wait for you; a shot with none shows its own.
    const left = bars.current[shot.id];
    showBar(String(left?.text || '').trim() ? left : barForShot(get(), sceneId, shot));
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  // Words you have not touched follow the film: a plate that arrives joins the shot.
  useEffect(() => {
    const b = barRef.current;
    if (!b.shotId || b.touched) return;
    const shot = findShot(s, b.sceneId, b.shotId);
    if (shot) showBar(barForShot(s, b.sceneId, shot));
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const toast = (t) => Message.error({ content: t, duration: 6000 });

  // ---- making things -------------------------------------------------------------------------
  // The tab's film goes in first, so the tools work on what you see. Answers with every version's name.
  const sync = () => callTool('merge_film', { project: linked, name: String(projectTitle || 'Untitled film'), studio: get() });
  const run = async (label, work) => {
    const job = { id: `${label}-${Date.now()}`, label, since: Date.now() };
    setJobs((x) => [...x, job]);
    try {
      return await work();
    } catch (e) {
      toast(e.message || String(e));
      return null;
    } finally {
      setJobs((x) => x.filter((j) => j.id !== job.id));
    }
  };
  const tool = (name, args) => callTool(name, { project: linked, ...args });
  const nameOf = async (v) => v.name || (await sync()).names[v.id];
  const reportFailed = (out) => {
    const failed = (out?.results || []).filter((r) => r.status === 'failed');
    if (failed.length) toast(`${failed.length} did not render: ${failed[0].error}`);
  };
  const actions = {
    busy: (label) => jobs.some((j) => j.label === label),
    openBar: () => setBarOpen(true),
    write: (idea) => run('Writing', async () => { await sync(); await tool('write_screenplay', { idea }); }),
    breakdown: (script) => {
      const go = (replace) => run('Breaking down', async () => {
        await sync();
        const out = await tool('shot_list', { script, replace });
        const failed = out.scenes.filter((sc) => sc.error);
        if (failed.length) toast(`Scene ${failed.map((sc) => sc.n).join(', ')} has no shots yet: ${failed[0].error}`);
        setScope({ type: 'scenes' });
      });
      const n = get().scenes.length;
      if (n) Modal.confirm({ title: `Replace the ${n} scene${n === 1 ? '' : 's'}?`, content: 'Their shots and takes go with them.', okText: 'Replace', cancelText: 'Cancel', okButtonProps: { status: 'danger' }, onOk: () => go(true) });
      else go(false);
    },
    cast: (names) => run('Casting', async () => {
      await sync();
      reportFailed(await tool('cast', { names, ...(String(get().script || '').trim() ? {} : { brief: names.map((n) => get().elements.find((e) => e.name === n)?.desc || n).join('. ') }) }));
    }),
    variations: (el, direction, count) => run('Drawing', async () => {
      await sync();
      reportFailed(await tool('variations', { element: el.name, direction, count }));
    }),
    // Cast first: a scene's views are drawn from its place's plate.
    generateMissing: (scene) => run('Casting', async () => {
      await sync();
      const needs = needsOfScene(get(), scene);
      if (needs.names.length) reportFailed(await tool('cast', { names: needs.names }));
      if (needs.views) reportFailed(await tool('scene_views', { scene_id: scene.id }));
    }),
    assemble: (leavesOut) => {
      const go = () => run('Assembling', async () => { await sync(); await tool('assemble', { without_missing: leavesOut }); });
      if (leavesOut) Modal.confirm({ title: 'Assemble without every shot?', content: 'Shots with no take yet are left out.', okText: 'Assemble', cancelText: 'Cancel', onOk: go });
      else go();
    },
  };
  // ENHANCE: the prompt rewritten under the model's skill, there to read and change. Nothing renders,
  // and Undo puts your words back.
  const enhance = () => run('Enhancing', async () => {
    const b = barRef.current;
    const { args } = requestOf(get(), b);
    await sync();
    const out = await tool('enhance_prompt', { prompt: b.text, refs: args.refs, video_refs: args.video_refs, model: b.model });
    if (barRef.current.text !== b.text) { toast('The prompt changed while it was being enhanced, so your words stay.'); return; }
    setBar((x) => ({ ...x, text: out.prompt, before: b.text }));
  });
  // The bar as its shot starts it, or empty off a shot.
  const barHome = (b = barRef.current) => {
    const shot = b.shotId ? findShot(get(), b.sceneId, b.shotId) : null;
    if (b.shotId) delete bars.current[b.shotId];
    showBar(shot ? barForShot(get(), b.sceneId, shot) : emptyBar(get()));
  };
  // GENERATE: the bar's one request, once per take. Your words stay, ready for the next try.
  const generate = () => run('Generating', async () => {
    const b = barRef.current;
    const { tool: name, args } = requestOf(get(), b);
    const count = b.source ? 1 : b.count;
    // An edit is done with once asked for: the bar goes back to its shot's own words.
    if (b.source) barHome(b);
    await sync();
    const made = await Promise.all(Array.from({ length: count }, () => tool(name, args)));
    const refused = made.find((r) => r.status === 'failed');
    if (refused) toast(`${refused.name} did not start: ${refused.error}`);
  });

  // ---- verdicts -----------------------------------------------------------------------------
  // A pick lands in the film: a screenplay becomes the script, a shot list the scenes and their
  // shots, a scene's blocking its shot; anything else becomes its container's choice. onDone runs once
  // it has landed (after a confirmation when one is asked).
  const pick = (ref, vid, onDone = () => {}) => {
    const x = get();
    const v = versionOf(x, ref, vid);
    if (!v) return;
    const land = (next) => { set((y) => next(pickVersion(y, ref, vid))); onDone(); };
    if (ref.at === 'brief' && v.kind === 'script') {
      const apply = () => land((y) => ({ ...y, script: v.text }));
      // The idea it was written from gives way without asking, and stays as a version of the brief.
      if (String(x.script || '').trim() === String(v.idea || '').trim()) { keepBrief(x.script); apply(); return; }
      if (String(x.script || '').trim() && x.script !== v.text) { Modal.confirm({ title: 'Replace the script?', content: 'Your text stays as a version of the brief.', okText: 'Replace', cancelText: 'Cancel', onOk: () => { keepBrief(x.script); apply(); } }); return; }
      apply();
      return;
    }
    if (ref.at === 'brief' && v.kind === 'shotList') {
      const apply = () => land((y) => applyShotList(y, v.payload));
      if (x.scenes.length) { Modal.confirm({ title: `Replace the ${x.scenes.length} scenes?`, content: 'Their shots and takes go with them.', okText: 'Replace', cancelText: 'Cancel', okButtonProps: { status: 'danger' }, onOk: apply }); return; }
      apply();
      return;
    }
    if (ref.at === 'scene') { land((y) => applyBlocking(y, ref.sceneId, v.payload)); return; }
    if (ref.at === 'unplaced') { toast('This has no place in the film yet: open a shot and Rework it, or tell FilmAgent where it goes.'); return; }
    land((y) => y);
  };
  // The director's own text, kept as a version when a screenplay replaces it.
  const keepBrief = (text) => set((y) => ({ ...y, brief: { ...y.brief, versions: [{ id: uid('v-'), at: Date.now(), by: 'you', kind: 'script', status: 'kept', text, title: 'Your brief' }, ...y.brief.versions] } }));
  const reject = (ref, v) => set((y) => rejectVersion(y, ref, v.id));
  // The pill in the header opens what has waited longest.
  const work = newWork(s);
  const nextNew = (skip = null) => {
    const rest = newWork(get()).fresh.filter((x) => x.v.id !== skip);
    setView(rest[0] ? { ref: rest[0].ref, vid: rest[0].v.id } : null);
  };
  const pickInView = (ref, v) => pick(ref, v.id);
  const rejectInView = (ref, v) => { reject(ref, v); setView(null); };
  // A NOTE edits the version you look at: a picture at once, a take through the bar, where you
  // see what it will cost before pressing Edit.
  const note = async (ref, v, text) => {
    const name = await nameOf(v);
    if (v.kind === 'plate') run('Drawing', () => tool('edit_image', { source: name, instruction: text }));
    else toBar(ref, barToEdit(get(), ref, { ...v, name }, text));
  };
  const rework = async (ref, v) => toBar(ref, barToRework(get(), ref, { ...v, name: await nameOf(v) }));
  // A frame of a take: kept as a picture, or the start of the next take, as a reference in the bar.
  const frame = (ref, v, at, how) => run('Taking a frame', async () => {
    const name = await nameOf(v);
    const out = await tool('grab_frame', { name, ...(how === 'last' ? { last: true } : { at }) });
    if (how === 'keep') { Message.success({ content: `${out.name} is in Generations`, duration: 3000 }); return; }
    setView(null);
    toBar(ref, barFromFrame(get(), ref, v, out.name));
    setBarOpen(true);
  });
  // The bar lives on the shot: going there brings it, loaded.
  const toBar = (ref, next) => {
    setBar(next);
    if (ref.shotId) { setMode('direct'); setScope({ type: 'shot', sceneId: ref.sceneId, id: ref.shotId }); }
  };
  // A take made with an earlier plate: keep it as it is, or shoot it again.
  const onStale = {
    keep: (sceneId, shotId) => set((x) => {
      const sh = findShot(x, sceneId, shotId);
      const tk = takeOf(sh);
      return tk ? patchVersion(x, { at: 'take', sceneId, shotId }, tk.id, { used: usedOf(x, sh) }) : x;
    }),
    redo: (sceneId, shotId) => setScope({ type: 'shot', sceneId, id: shotId }),
  };
  const review = (ref, vid) => setView({ ref, vid });
  const final = (ref, v, resolution) => run('Finishing', async () => tool('finish', { name: await nameOf(v), resolution }));
  // OPEN IN CANVAS — only when asked: the element, shot or version becomes Canvas nodes and the
  // Canvas comes forward. A shot remembers its card, so takes shot there come back to it.
  const toCanvas = (make) => {
    if (!onOpenInCanvas) return;
    try {
      const r = make(get());
      if (r.link) set((x) => ({ ...x, scenes: x.scenes.map((sc) => (sc.id !== r.link.sceneId ? sc : { ...sc, shots: sc.shots.map((sh) => (sh.id === r.link.shotId ? { ...sh, boardCard: r.link.cardId } : sh)) })) }));
      onOpenInCanvas({ nodes: r.nodes, focusId: r.focusId });
    } catch (e) { toast(e.message); }
  };
  const canvas = onOpenInCanvas ? {
    element: (el) => toCanvas((x) => elementToCanvas(x, el)),
    shot: (sceneId, shotId) => toCanvas((x) => shotToCanvas(x, sceneId, shotId)),
    scene: (sceneId) => toCanvas((x) => {
      const sc = x.scenes.find((y) => y.id === sceneId);
      if (!sc?.shots.length) throw new Error('This scene has no shots yet.');
      // Every shot's card, laid out in a column; the first is framed.
      const parts = sc.shots.map((sh) => shotToCanvas(x, sceneId, sh.id));
      parts.forEach((r) => { if (r.link) x = { ...x, scenes: x.scenes.map((y) => (y.id !== sceneId ? y : { ...y, shots: y.shots.map((sh) => (sh.id === r.link.shotId ? { ...sh, boardCard: r.link.cardId } : sh)) })) }; });
      set(x);
      const nodes = parts.flatMap((r, i) => r.nodes.map((n) => (n.parentId ? n : { ...n, position: { x: n.position.x, y: n.position.y + i * 700 } })));
      return { nodes, focusId: parts[0].focusId };
    }),
    version: (ref, v, label) => toCanvas((x) => versionToCanvas(x, ref, v, label)),
  } : null;

  const changeStyle = (style) => {
    set((x) => ({ ...x, style: String(style || '').trim() }));
    if (get().elements.some((e) => pickedOf(e))) Message.info({ content: 'New plates follow this from now on. Plates already made keep their look.', duration: 5000 });
  };
  const title = String(projectTitle || '').replace(/^Project\s+/, '').replace(/^"|"$/g, '');

  return (
    <div ref={rootRef} className="studio" style={{ position: 'relative', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', gridTemplateColumns: 'minmax(0, 1fr)', height: 'calc(100vh - 84px)', background: C.bg, border: '1px solid #000', borderRadius: 14, overflow: 'hidden', textAlign: 'left', color: C.ink }}>
      <style dangerouslySetInnerHTML={{ __html: STUDIO_CSS }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 14px', height: 60, minWidth: 0, borderBottom: `1px solid ${C.line}`, background: C.panel }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '0 1 auto' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: C.accent, display: 'grid', placeItems: 'center', flex: '0 0 auto' }}><span style={{ width: 0, height: 0, borderLeft: `9px solid ${C.accentInk}`, borderTop: '6px solid transparent', borderBottom: '6px solid transparent', marginLeft: 3 }} /></span>
          <ProjectMenu project={project} title={title} container={() => rootRef.current} />
        </div>
        <Stages s={s} scope={scope} on={mode === 'direct'} go={(id) => { setMode('direct'); setScope(scopeOfStage(id)); }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '0 1 auto', minWidth: 0, justifyContent: 'flex-end' }}>
          {jobs[0] && <span style={{ minWidth: 0, maxWidth: 170, display: 'inline-flex' }}><Working stage={`${jobs[0].label}${jobs.length > 1 ? ` · ${jobs.length} jobs` : ''}`} since={jobs[0].since} /></span>}
          {/* What waits for your verdict, oldest first: the pill opens the viewer on it. */}
          {work.fresh.length > 0 && <span role="button" onClick={() => nextNew()} title="Open what waits for your verdict" style={{ height: 38, padding: '0 16px', display: 'inline-flex', alignItems: 'center', borderRadius: 10, cursor: 'pointer', fontSize: 15, fontWeight: 700, background: C.warn, color: C.accentInk, whiteSpace: 'nowrap', flex: '0 0 auto' }}>{work.fresh.length} new</span>}
          <span role="button" className="st-stage" aria-label="Generations" title="Generations" onClick={() => setMode(mode === 'generations' ? 'direct' : 'generations')} style={{ height: 38, padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 10, cursor: 'pointer', fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', flex: '0 0 auto', color: mode === 'generations' ? C.ink : C.text, background: mode === 'generations' ? C.hover : 'transparent' }}>
            <IconApps /><span className="st-wide">Generations</span>
            {work.working > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: C.work, fontSize: 13 }}><Dot color={C.work} pulse />{work.working}</span>}
          </span>
        </div>
      </div>

      {!linked ? <div style={{ display: 'grid', placeItems: 'center', fontSize: 16, color: C.text }}><Working stage="Opening the film" /></div> : mode === 'direct' ? (
        <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          <DirectPage s={s} set={set} scope={scope} setScope={setScope} pick={pick} review={review} toast={toast} actions={actions} canvas={canvas} onStale={onStale} />
        </div>
      ) : (
        <GenerationsView s={s} set={set} open={review} jobs={jobs} />
      )}
      {linked && (mode === 'direct' ? scope.type === 'scene' || scope.type === 'shot' : bar.parent || bar.source || bar.refs.length) && <GenerateBar s={s} bar={bar} setBar={setBar} onGenerate={generate} onEnhance={enhance} enhancing={actions.busy('Enhancing')} onBackToShot={() => barHome()} container={() => rootRef.current} setStyle={changeStyle} open={barOpen} setOpen={setBarOpen} />}
      {view && <Viewer s={s} set={set} toast={toast} view={view} setView={setView} onPick={pickInView} onNote={note} onRework={rework} onFrame={frame} onFinal={final} onReject={rejectInView} canvas={canvas} />}
    </div>
  );
};

export default StudioPlayground;
