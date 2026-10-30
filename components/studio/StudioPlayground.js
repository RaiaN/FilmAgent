import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Menu, Message, Modal, Select } from '@arco-design/web-react';
import { IconApps, IconCheck, IconDown, IconUserGroup } from '@arco-design/web-react/icon';
import { C, MONO, STUDIO_CSS, Dot } from './ui';
import { DirectPage, Thread, scopeTarget } from './DirectView';
import { Viewer } from './Viewer';
import GenerationsView from './GenerationsView';
import {
  emptyStudio, loadStudio, syncBoard, uid, threadKeyOf, addMessage, patchMessage, findShot, pickVersion, rejectVersion,
  patchVersion, pickedOf, newWork, usedOf, versionOf, VIDEO_MODELS, STYLES,
} from '../../utils/film/studio/model';
import { createRunners, applyShotList, applyBlocking } from '../../utils/film/studio/runners';
import { editorFor } from '../../utils/film/studio/crew';
import { STAGES, stageOf, scopeOfStage, stageStates, nextStep } from '../../utils/film/studio/guide';
import { elementToCanvas, shotToCanvas, versionToCanvas } from '../../utils/film/studio/canvasLink';
import { createBrowserClient } from '../../utils/film/core/client';

const CREW_WIDTH_KEY = 'studio-crew-width';
const CREW_OPEN_KEY = 'studio-crew-open';
const CREW_WIDTH = [320, 820];

// STUDIO — the harness makes a film with you, step by step: Script → Cast & World → Scenes → Cut.
// The stages are the page; the crew panel beside them holds the one next step (the guide), the
// conversation and what the crew delivers, waiting for your verdict (pick · note · reject) — there
// or in the viewer. GENERATIONS shows every render. Saved inside the open project.

// THE STAGES, always on top: where the film stands, and what waits in each.
const Stages = ({ s, scope, on, go }) => {
  const st = stageStates(s);
  const here = stageOf(scope);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '0 auto', flex: '0 1 auto', minWidth: 0 }}>
      {STAGES.map(({ id, label }, i) => {
        const active = on && here === id;
        const done = st[id].done;
        const fresh = st.fresh[id];
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span className="st-link" style={{ width: 22, height: 2, borderRadius: 1, background: C.lineHi }} />}
            <span role="button" className="st-stage" onClick={() => go(id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, height: 44, padding: '0 16px 0 10px', borderRadius: 12, cursor: 'pointer', background: active ? C.hover : 'transparent', whiteSpace: 'nowrap' }}>
              <span style={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 13.5, fontWeight: 700, flex: '0 0 auto', background: active ? C.accent : done ? C.goodSoft : C.raised, color: active ? C.accentInk : done ? C.good : C.muted, boxShadow: active || done ? 'none' : `inset 0 0 0 1px ${C.lineHi}` }}>{done && !active ? <IconCheck /> : i + 1}</span>
              <span style={{ fontSize: 16, fontWeight: active ? 700 : 600, color: active ? C.ink : C.text, letterSpacing: -0.1 }}>{label}</span>
              {st[id].count && <span className="st-count" style={{ fontFamily: MONO, fontSize: 13, color: C.muted }}>{st[id].count}</span>}
              {st.working[id] && <Dot color={C.work} pulse size={8} />}
              {fresh > 0 && <span style={{ minWidth: 22, height: 22, padding: '0 6px', boxSizing: 'border-box', borderRadius: 11, background: C.warn, color: C.accentInk, fontSize: 12.5, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{fresh}</span>}
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
      <Menu.Item key="skills">Crew & model skills…</Menu.Item>
      <Menu.Item key="prompts">Prompt templates…</Menu.Item>
    </Menu>
  );
  return (
    <Dropdown droplist={menu} trigger="click" position="bl" getPopupContainer={() => container() || document.body}>
      <span role="button" className="st-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 8px', marginLeft: -8, borderRadius: 8, border: '1px solid transparent', cursor: 'pointer', minWidth: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{title || 'Untitled'}</span>
        <IconDown style={{ fontSize: 12, color: C.muted, flex: '0 0 auto' }} />
      </span>
    </Dropdown>
  );
};

const StudioPlayground = ({ projectStudio = null, onStudioChange, projectTitle = '', board = null, project = null, onOpenInCanvas }) => {
  const rootRef = useRef(null);
  // The film lives in a ref the crew can read and write mid-run, mirrored into React state.
  const sRef = useRef(emptyStudio());
  const [s, setS] = useState(sRef.current);
  const set = useCallback((fn) => { sRef.current = typeof fn === 'function' ? fn(sRef.current) : fn; setS(sRef.current); }, []);
  const get = useCallback(() => sRef.current, []);
  const ctx = useMemo(() => ({ client: createBrowserClient() }), []);
  const crew = useMemo(() => createRunners({ get, set, ctx }), [get, set, ctx]);

  const [linked, setLinked] = useState(null);
  const [mode, setMode] = useState('direct');
  const [scope, setScope] = useState({ type: 'brief' });
  // The version open in the viewer ({ ref, vid }), or none.
  const [view, setView] = useState(null);
  const [draft, setDraft] = useState('');
  // Jobs still planning: no versions are out yet, so the next step waits for them.
  const [planning, setPlanning] = useState(0);
  // The crew panel's width: drag its edge; remembered per browser.
  const [crewWidth, setCrewWidth] = useState(380);
  const [crewOpen, setCrewOpen] = useState(true);
  useEffect(() => {
    try {
      const w = Number(window.localStorage.getItem(CREW_WIDTH_KEY));
      if (w) setCrewWidth(w);
      if (window.localStorage.getItem(CREW_OPEN_KEY) === '0') setCrewOpen(false);
    } catch { /* noop */ }
  }, []);
  const toggleCrew = () => setCrewOpen((o) => { try { window.localStorage.setItem(CREW_OPEN_KEY, o ? '0' : '1'); } catch { /* noop */ } return !o; });
  const dragCrew = (e) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = crewWidth;
    let w = w0;
    const move = (ev) => { w = Math.min(CREW_WIDTH[1], Math.max(CREW_WIDTH[0], w0 + (x0 - ev.clientX))); setCrewWidth(w); };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); try { window.localStorage.setItem(CREW_WIDTH_KEY, String(Math.round(w))); } catch { /* noop */ } };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Load with the project — once per load (a re-run of this effect must never put an older
  // snapshot back); every change goes back into it.
  const loadedNonce = useRef(null);
  useEffect(() => {
    if (!projectStudio?.projectId || loadedNonce.current === projectStudio.nonce) return;
    loadedNonce.current = projectStudio.nonce;
    const loaded = loadStudio(projectStudio.data);
    set(loaded);
    setLinked(projectStudio.projectId);
    // A film opens where its next step is.
    setScope(nextStep(loaded, null)?.scope || (loaded.scenes.length ? { type: 'scenes' } : { type: 'brief' }));
    setView(null);
    setMode('direct');
    crew.resume();
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
    if (linked && onStudioChange) onStudioChange(linked, s);
  }, [s, linked]); // eslint-disable-line react-hooks/exhaustive-deps

  const toast = (t) => Message.error({ content: t, duration: 6000 });
  const say = (sc, msg) => set((x) => addMessage(x, threadKeyOf(sc), msg));
  const stillPlanning = (sc, id) => (get().threads[threadKeyOf(sc)] || []).some((m) => m.id === id);

  // A REQUEST — @ = go: the plan checks it (or asks a question), then the crew works.
  const request = async (req, { echo = true } = {}) => {
    const sc = req.scope;
    if (echo) say(sc, { from: 'you', kind: 'request', agent: req.agent, action: req.action, text: req.note ? req.note : req.text || '', target: sc.type === 'shot' ? scopeTarget(get(), sc) : '', ...(sc.type === 'shot' ? { shotId: sc.id } : {}) });
    const pending = uid('m-');
    const drop = () => set((x) => ({ ...x, threads: { ...x.threads, [threadKeyOf(sc)]: (x.threads[threadKeyOf(sc)] || []).filter((m) => m.id !== pending) } }));
    say(sc, { id: pending, from: req.agent, kind: 'delivery', items: [] });
    setPlanning((n) => n + 1);
    try {
      const p = await crew.plan(req, { onStage: (text) => set((x) => patchMessage(x, threadKeyOf(sc), pending, { stage: text, stageAt: Date.now() })) });
      drop();
      setPlanning((n) => n - 1);
      if (p.question) say(sc, { from: req.agent, kind: 'question', text: p.question.text, options: p.question.options });
      else await crew.run(req, p.payload, p.summary);
    } catch (e) {
      if (stillPlanning(sc, pending)) { drop(); setPlanning((n) => n - 1); }
      say(sc, { from: req.agent, kind: 'error', text: e.message || String(e) });
    }
  };
  // From the composer: "@Camera slower push-in" — the agent's job here, with your words.
  const fromComposer = (r, raw) => {
    if (!r.action) { say(stand, { from: 'you', kind: 'request', text: raw }); say(stand, { from: r.agent.id, kind: 'error', text: `${r.agent.name} has nothing to do here.` }); return; }
    request({ agent: r.agent.id, action: r.action.id, scope: stand, text: r.text });
  };
  const ask = (sc, raw, avail) => {
    say(sc, { from: 'you', kind: 'request', text: raw });
    say(sc, { from: 'studio', kind: 'ask', text: raw, handles: [...new Set(avail.map((x) => x.agent.handle))] });
  };
  // STOP — nothing more starts, and what is still rendering is let go.
  const stop = (key, m) => set((x) => {
    let y = patchMessage(x, key, m.id, { stopped: true, finished: true });
    (m.items || []).forEach((it) => { if (versionOf(y, it.ref, it.vid)?.status === 'running') y = patchVersion(y, it.ref, it.vid, { status: 'failed', error: 'Stopped' }); });
    return y;
  });
  // UNDO what talking changed: the Shot (its text, references, sheet), the Script (the
  // screenplay, scenes' shots) or Cast & World (names, descriptions, who is in the film) go back
  // to what they were.
  const undoShot = (key, m) => {
    const was = m.change?.undo;
    if (m.from === 'script') {
      if (!was) return;
      set((x) => patchMessage({ ...x, ...(was.script != null ? { script: was.script, brief: { ...x.brief, versions: was.briefVersions } } : {}), scenes: x.scenes.map((y) => was.scenes.find((z) => z.id === y.id) || y) }, key, m.id, { undone: true }));
      return;
    }
    if (m.from === 'cast') {
      if (!was) return;
      set((x) => {
        const kept = x.elements.filter((e) => !was.added.includes(e.id)).map((e) => { const b = was.elements.find((y) => y.id === e.id); return b ? { ...e, name: b.name, desc: b.desc } : e; });
        const back = was.elements.filter((b) => !kept.some((e) => e.id === b.id));
        return patchMessage({ ...x, elements: [...kept, ...back] }, key, m.id, { undone: true });
      });
      return;
    }
    const sc = get().scenes.find((x) => x.shots.some((sh) => sh.id === m.shotId));
    if (!sc || !m.change?.undo) return;
    set((x) => patchMessage({ ...x, scenes: x.scenes.map((y) => (y.id !== sc.id ? y : { ...y, shots: y.shots.map((sh) => (sh.id === m.shotId ? { ...sh, ...m.change.undo } : sh)) })) }, key, m.id, { undone: true }));
  };
  const answer = (key, m, o) => {
    set((x) => patchMessage(x, key, m.id, { answered: o.label }));
    request(o.req, { echo: false });
  };

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
    land((y) => y);
  };
  // The director's own text, kept as a version when a screenplay replaces it.
  const keepBrief = (text) => set((y) => ({ ...y, brief: { ...y.brief, versions: [{ id: uid('v-'), at: Date.now(), by: 'you', kind: 'script', status: 'kept', text, title: 'Your brief' }, ...y.brief.versions] } }));
  const reject = (ref, v) => set((y) => rejectVersion(y, ref, v.id));
  // THE VIEWER walks what waits for you: after a verdict it moves on to the next new version.
  const work = newWork(s);
  const nextNew = (skip = null) => {
    const rest = newWork(get()).fresh.filter((x) => x.v.id !== skip);
    setView(rest[0] ? { ref: rest[0].ref, vid: rest[0].v.id } : null);
  };
  const pickInView = (ref, v) => pick(ref, v.id, () => nextNew(v.id));
  const rejectInView = (ref, v) => { reject(ref, v); nextNew(v.id); };
  // A NOTE is an edit of the version you look at, by the agent whose output it is (editorFor):
  // the edit is the next version, its parent the one you noted.
  const note = (ref, v, text) => request(editorFor(get(), ref, v, text));
  // Casting's plate drawn again from the prompt you edited in the viewer.
  const redraw = (ref, v, entry) => request({ agent: 'casting', action: 'redraw', scope: { type: 'element', id: ref.id }, text: '', from: { ref, vid: v.id }, entry });
  // A take made with an earlier plate: keep it as it is, or shoot it again.
  const onStale = {
    keep: (sceneId, shotId) => set((x) => {
      const sh = findShot(x, sceneId, shotId);
      const tk = pickedOf(sh.takes);
      return tk ? patchVersion(x, { at: 'take', sceneId, shotId }, tk.id, { used: usedOf(x, sh) }) : x;
    }),
    redo: (sceneId, shotId) => request({ agent: 'camera', action: 'draft', scope: { type: 'shot', sceneId, id: shotId }, text: '', force: true }),
  };
  const review = (ref, vid) => setView({ ref, vid });
  // THE NEXT STEP, pressed: it takes you where it happens and does it.
  const stand = scope.type === 'scenes' ? { type: 'brief' } : scope;
  const step = planning ? null : nextStep(s, scope);
  const doStep = (st) => {
    if (st.review) { review(st.review.ref, st.review.vid); return; }
    setMode('direct');
    setScope(st.scope);
    if (st.say) setDraft(st.say);
    else if (st.final) request({ agent: 'camera', action: 'final', scope: st.scope, text: '', res: st.final.res });
    else if (st.run) request(st.run);
  };
  // FINAL — a draft at full resolution: one from the viewer, or a scene's circled drafts.
  const crewApi = { send: (agent, action, text) => request({ agent, action, scope: stand, text }), final: (sceneId, res) => request({ agent: 'camera', action: 'final', scope: { type: 'scene', id: sceneId }, text: '', res }) };
  const final = (ref, v, res) => request({ agent: 'camera', action: 'final', scope: { type: 'shot', sceneId: ref.sceneId, id: ref.shotId }, text: '', from: { ref, vid: v.id }, res });
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
    if (get().elements.some((e) => pickedOf(e))) Message.info({ content: 'The crew follows this from now on. Plates already made keep their look.', duration: 5000 });
  };
  const title = String(projectTitle || '').replace(/^Project\s+/, '').replace(/^"|"$/g, '');

  return (
    <div ref={rootRef} className="studio" style={{ position: 'relative', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', gridTemplateColumns: 'minmax(0, 1fr)', height: 'calc(100vh - 84px)', background: C.bg, border: '1px solid #000', borderRadius: 14, overflow: 'hidden', textAlign: 'left', color: C.ink }}>
      <style dangerouslySetInnerHTML={{ __html: STUDIO_CSS }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 18px', height: 68, minWidth: 0, borderBottom: `1px solid ${C.line}`, background: C.panel }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '0 1 auto' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: C.accent, display: 'grid', placeItems: 'center', flex: '0 0 auto' }}><span style={{ width: 0, height: 0, borderLeft: `9px solid ${C.accentInk}`, borderTop: '6px solid transparent', borderBottom: '6px solid transparent', marginLeft: 3 }} /></span>
          <ProjectMenu project={project} title={title} container={() => rootRef.current} />
        </div>
        <Stages s={s} scope={scope} on={mode === 'direct'} go={(id) => { setMode('direct'); setScope(scopeOfStage(id)); }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '0 1 auto', minWidth: 0, justifyContent: 'flex-end' }}>
          {/* What waits for your verdict, oldest first: the pill opens the viewer on it. */}
          {work.fresh.length > 0 && <span role="button" onClick={() => nextNew()} title="Open what waits for your verdict" style={{ height: 38, padding: '0 16px', display: 'inline-flex', alignItems: 'center', borderRadius: 10, cursor: 'pointer', fontSize: 15, fontWeight: 700, background: C.warn, color: C.accentInk, whiteSpace: 'nowrap', flex: '0 0 auto' }}>{work.fresh.length} new</span>}
          <span role="button" className="st-stage" aria-label="Generations" title="Generations" onClick={() => setMode(mode === 'generations' ? 'direct' : 'generations')} style={{ height: 38, padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 10, cursor: 'pointer', fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', flex: '0 0 auto', color: mode === 'generations' ? C.ink : C.text, background: mode === 'generations' ? C.hover : 'transparent' }}>
            <IconApps /><span className="st-wide">Generations</span>
            {work.working > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: C.work, fontSize: 13 }}><Dot color={C.work} pulse />{work.working}</span>}
          </span>
          {/* The film's look: pick one, type your own, or let the crew read it from the script. */}
          <span title="The film's look. The crew follows it in everything it makes next; plates already made keep theirs." style={{ flex: '0 1 230px', minWidth: 130 }}>
            <Select aria-label="Style" showSearch allowCreate prefix="Style" value={s.style || ''} onChange={changeStyle} options={[{ label: 'From the script', value: '' }, ...STYLES.map((x) => ({ label: x, value: x }))]} style={{ width: '100%' }} triggerProps={{ autoAlignPopupWidth: false, autoAlignPopupMinWidth: true }} getPopupContainer={() => rootRef.current} />
          </span>
          {/* The film's video model: what Camera drafts on, unless a shot picks its own. Premium drafts finish at 1080p or 4K. */}
          <span title="What Camera drafts on. Seedance 2.5 finishes at 1080p; Premium at 1080p or 4K." style={{ flex: '0 1 160px', minWidth: 118 }}>
            <Select value={s.videoModel} onChange={(videoModel) => set((x) => ({ ...x, videoModel }))} options={VIDEO_MODELS.map((m) => ({ label: m.label, value: m.key }))} style={{ width: '100%' }} getPopupContainer={() => rootRef.current} />
          </span>
          <span role="button" className="st-stage" aria-pressed={crewOpen} onClick={toggleCrew} title={crewOpen ? 'Hide the crew' : 'Show the crew'} aria-label="Crew" style={{ height: 38, padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 10, cursor: 'pointer', fontSize: 15, fontWeight: 600, flex: '0 0 auto', color: crewOpen ? C.ink : C.text, background: crewOpen ? C.hover : 'transparent' }}><IconUserGroup /><span className="st-wide">Crew</span></span>
        </div>
      </div>

      {!linked ? <div /> : mode === 'direct' ? (
        <div style={{ display: 'grid', gridTemplateColumns: crewOpen ? `minmax(0, 1fr) ${crewWidth}px` : 'minmax(0, 1fr)', minHeight: 0 }}>
          <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
            <DirectPage s={s} set={set} scope={scope} setScope={setScope} pick={pick} review={review} toast={toast} crew={crewApi} canvas={canvas} onStale={onStale} />
          </div>
          {crewOpen && (
            <div style={{ borderLeft: `1px solid ${C.line}`, minHeight: 0, position: 'relative' }}>
              <div role="separator" aria-orientation="vertical" title="Drag to resize" onMouseDown={dragCrew} style={{ position: 'absolute', left: -4, top: 0, bottom: 0, width: 8, cursor: 'col-resize', zIndex: 3 }} />
              <Thread
                s={s} scope={stand}
                target={scope.type === 'shot' ? scopeTarget(s, scope) : ''}
                onClearTarget={() => setScope({ type: 'scene', id: scope.sceneId })}
                onRequest={fromComposer} answer={answer} review={review} ask={ask}
                text={draft} setText={setDraft} undoShot={undoShot}
                pick={(ref, v) => pick(ref, v.id)} reject={reject} stop={stop}
                step={step} onStep={doStep}
              />
            </div>
          )}
        </div>
      ) : (
        <GenerationsView s={s} set={set} open={review} />
      )}
      {view && <Viewer s={s} set={set} toast={toast} view={view} setView={setView} onPick={pickInView} onNote={note} onFinal={final} onReject={rejectInView} onRedraw={redraw} canvas={canvas} waiting={work.fresh} onNextNew={() => nextNew(view.vid)} />}
    </div>
  );
};

export default StudioPlayground;
