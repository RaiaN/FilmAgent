import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Menu, Message, Modal } from '@arco-design/web-react';
import { IconFile, IconVideoCamera, IconUserGroup, IconPlayCircle, IconPlus, IconDown, IconSettings } from '@arco-design/web-react/icon';
import { C, MONO, STUDIO_CSS, Dot, crewColor } from './ui';
import { DirectPage, Thread, scopeTarget, UploadButton, importFootage } from './DirectView';
import { Queue, Detail } from './ReviewView';
import GenerationsView from './GenerationsView';
import {
  emptyStudio, loadStudio, hasStudioWork, syncBoard, newScene, uid, threadKeyOf, addMessage, patchMessage, findShot, pickVersion, rejectVersion,
  patchVersion, pickedOf, reviewQueue, planOf, sceneStatus, usedOf, versionOf, findElement, pad2, shotNumber,
} from '../../utils/film/studio/model';
import { createRunners, applyBreakdown } from '../../utils/film/studio/runners';
import { elementToCanvas, shotToCanvas, versionToCanvas } from '../../utils/film/studio/canvasLink';
import { createBrowserClient } from '../../utils/film/core/client';

const MODE_KEY = 'studio-mode';
const CREW_WIDTH_KEY = 'studio-crew-width';
const CREW_WIDTH = [300, 820];
const MODES = ['direct', 'review', 'generations'];
const MODE_LABEL = { direct: 'Direct', review: 'Review', generations: 'Generations' };

// STUDIO — the director and the crew. One spine (Brief · Cast & World · Scenes · Cut), two
// modes over it: DIRECT (ask the crew with @, approve call sheets, edit by hand) and REVIEW
// (pick, note, reject what the crew delivered). Saved inside the open project.
// The first screen of an empty film: where the material comes from.
const StartCard = ({ icon, color, title, sub, hero, children }) => (
  <div className="st-card" style={{ border: `1px solid ${hero ? C.accent : C.line}`, boxShadow: hero ? `0 0 0 4px ${C.accentSoft}` : 'none', borderRadius: 16, padding: 24, display: 'grid', gap: 18, alignContent: 'space-between', minHeight: 210, background: C.raised }}>
    <div style={{ display: 'grid', gap: 14 }}>
      <span style={{ width: 44, height: 44, borderRadius: 13, display: 'grid', placeItems: 'center', fontSize: 21, color, background: `${color}1f` }}>{icon}</span>
      <div><div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{title}</div><div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{sub}</div></div>
    </div>
    {children}
  </div>
);
const Start = ({ onFootage, onScript, importing }) => (
  <div style={{ display: 'grid', placeItems: 'center', alignContent: 'center', gap: 28, padding: 32, overflowY: 'auto' }}>
    <div style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5 }}>Where does the film start?</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16, width: 'min(620px, 100%)' }}>
      <StartCard icon={<IconVideoCamera />} color={crewColor('vfx')} title="Your footage" sub="Clips and photos">
        <UploadButton long accept="video/*,image/*" loading={!!importing} onFiles={onFootage}>{importing ? `Importing ${importing}` : 'Import'}</UploadButton>
      </StartCard>
      <StartCard icon={<IconFile />} color={crewColor('writers')} title="A script" sub="Yours, or the Writers'">
        <Button long onClick={onScript}>Start</Button>
      </StartCard>
    </div>
  </div>
);

// THE PROJECT MENU — open, start, switch and set up projects from the Studio.
const ProjectMenu = ({ project, title, container }) => {
  if (!project) return <span style={{ fontWeight: 700, fontSize: 14, color: C.ink }}>{title || 'Studio'}</span>;
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
        <span style={{ fontWeight: 700, fontSize: 14, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{title || 'Untitled'}</span>
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
  const [mode, setModeState] = useState('direct');
  const [scope, setScope] = useState({ type: 'brief' });
  const [sel, setSel] = useState(null);
  const [started, setStarted] = useState(false);
  const [importing, setImporting] = useState('');
  const [draft, setDraft] = useState('');
  // The crew panel's width: drag its edge; remembered per browser.
  const [crewWidth, setCrewWidth] = useState(380);
  useEffect(() => { try { const w = Number(window.localStorage.getItem(CREW_WIDTH_KEY)); if (w) setCrewWidth(w); } catch { /* noop */ } }, []);
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
  const [filter, setFilter] = useState('all');
  const setMode = (m) => { setModeState(m); try { window.localStorage.setItem(MODE_KEY, m); } catch { /* noop */ } };
  useEffect(() => { try { const m = window.localStorage.getItem(MODE_KEY); if (MODES.includes(m)) setModeState(m); } catch { /* noop */ } }, []);

  // Load with the project — once per load (a re-run of this effect must never put an older
  // snapshot back); every change goes back into it.
  const loadedNonce = useRef(null);
  useEffect(() => {
    if (!projectStudio?.projectId || loadedNonce.current === projectStudio.nonce) return;
    loadedNonce.current = projectStudio.nonce;
    const loaded = loadStudio(projectStudio.data);
    set(loaded);
    setLinked(projectStudio.projectId);
    setStarted(false);
    // A film with scenes opens on its first scene; the brief is one click away.
    setScope(loaded.scenes[0] ? { type: 'scene', id: loaded.scenes[0].id } : { type: 'brief' });
    setSel(null);
    crew.resume();
  }, [projectStudio?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  // The project's Canvas, mirrored: new plates, SHOT cards and takes come in as they appear.
  useEffect(() => {
    if (!linked || board?.projectId !== linked) return;
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

  // A REQUEST — plan first (a question, a call sheet, or straight to work).
  const request = async (req, { echo = true, raw = '' } = {}) => {
    const sc = req.scope;
    if (echo) say(sc, { from: 'you', kind: 'request', agent: req.agent, action: req.action, text: req.note ? req.note : req.text || '', target: sc.type === 'shot' ? scopeTarget(get(), sc) : '', ...(sc.type === 'shot' ? { shotId: sc.id } : {}) });
    const pending = uid('m-');
    say(sc, { id: pending, from: req.agent, kind: 'delivery', items: [] });
    try {
      const p = await crew.plan(req, { onStage: (text) => set((x) => patchMessage(x, threadKeyOf(sc), pending, { stage: text, stageAt: Date.now() })) });
      set((x) => ({ ...x, threads: { ...x.threads, [threadKeyOf(sc)]: (x.threads[threadKeyOf(sc)] || []).filter((m) => m.id !== pending) } }));
      if (p.question) say(sc, { from: req.agent, kind: 'question', text: p.question.text, options: p.question.options });
      else if (p.sheet) {
        const id = uid('cs-');
        set((x) => ({ ...x, sheets: [...x.sheets, { id, at: Date.now(), req, jobs: p.sheet.jobs, summary: p.sheet.summary, payload: p.sheet.payload, status: 'pending' }] }));
        say(sc, { from: req.agent, kind: 'sheet', sheetId: id });
        return { sheet: id };
      } else await crew.run(req, p.payload);
    } catch (e) {
      set((x) => ({ ...x, threads: { ...x.threads, [threadKeyOf(sc)]: (x.threads[threadKeyOf(sc)] || []).filter((m) => m.id !== pending) } }));
      say(sc, { from: req.agent, kind: 'error', text: e.message || String(e) });
    }
    return raw;
  };
  // From the composer: "@Camera slower push-in" — the agent's job here, with your words.
  const fromComposer = (r, raw) => {
    if (!r.action) { say(scope, { from: 'you', kind: 'request', text: raw }); say(scope, { from: r.agent.id, kind: 'error', text: `${r.agent.name} has nothing to do here.` }); return; }
    request({ agent: r.agent.id, action: r.action.id, scope, text: r.text });
  };
  const ask = (sc, raw, avail) => {
    say(sc, { from: 'you', kind: 'request', text: raw });
    say(sc, { from: 'studio', kind: 'ask', text: raw, handles: [...new Set(avail.map((x) => x.agent.handle))] });
  };
  const approve = (id) => {
    const sh = get().sheets.find((x) => x.id === id);
    if (!sh || sh.status !== 'pending') return;
    set((x) => ({ ...x, sheets: x.sheets.map((y) => (y.id === id ? { ...y, status: 'approved' } : y)) }));
    return crew.run(sh.req, sh.payload).catch((e) => say(sh.req.scope, { from: sh.req.agent, kind: 'error', text: e.message }));
  };
  const cancel = (id) => set((x) => ({ ...x, sheets: x.sheets.map((y) => (y.id === id ? { ...y, status: 'cancelled' } : y)) }));
  // Undo what the Shot changed: its text, references and sheet go back to what they were.
  const undoShot = (key, m) => {
    const sc = get().scenes.find((x) => x.shots.some((sh) => sh.id === m.shotId));
    if (!sc || !m.change?.undo) return;
    set((x) => patchMessage({ ...x, scenes: x.scenes.map((y) => (y.id !== sc.id ? y : { ...y, shots: y.shots.map((sh) => (sh.id === m.shotId ? { ...sh, ...m.change.undo } : sh)) })) }, key, m.id, { undone: true }));
  };
  const answer = (key, m, o) => {
    set((x) => patchMessage(x, key, m.id, { answered: o.label }));
    request(o.req, { echo: false });
  };

  // ---- verdicts -----------------------------------------------------------------------------
  // onDone runs once the pick has landed (after a confirmation when one is asked).
  const pick = (ref, vid, onDone = () => {}) => {
    const x = get();
    const v = versionOf(x, ref, vid);
    if (!v) return;
    if (ref.at === 'brief') {
      const apply = () => { set((y) => {
        let next = { ...y, brief: { ...y.brief, versions: y.brief.versions.map((w) => (w.id === vid ? { ...w, status: 'picked' } : w.kind === v.kind && w.status === 'picked' ? { ...w, status: 'kept' } : w)) } };
        if (v.kind === 'script') next = { ...next, script: v.text };
        if (v.kind === 'breakdown') next = applyBreakdown(next, v.payload);
        if (v.kind === 'scriptBreakdown') next = { ...next, breakdown: v.payload };
        return next;
      }); onDone(); };
      const shotCount = x.scenes.reduce((n, sc) => n + sc.shots.length, 0);
      if (v.kind === 'breakdown' && shotCount) {
        Modal.confirm({ title: `Replace the ${shotCount} shots?`, content: 'Their takes go with them.', okText: 'Replace', cancelText: 'Cancel', okButtonProps: { status: 'danger' }, onOk: apply });
        return;
      }
      if (v.kind === 'script' && String(x.script || '').trim() && x.script !== v.text) {
        Modal.confirm({ title: 'Replace the script?', okText: 'Replace', cancelText: 'Cancel', onOk: apply });
        return;
      }
      apply();
      return;
    }
    set((y) => pickVersion(y, ref, vid));
    onDone();
  };
  // REVIEW MOVES ON: after a pick, the next thing waiting for you — another container's
  // delivery first (the leftover versions of what you just picked can wait), then call
  // sheets and questions.
  const sameRef = (a, b) => a.at === b.at && a.id === b.id && a.sceneId === b.sceneId && a.shotId === b.shotId;
  const pickAndNext = (ref, v) => {
    const before = reviewQueue(get());
    const rest = before.deliveries.filter((d) => d.v.id !== v.id);
    const d = rest.find((x) => !sameRef(x.ref, ref)) || rest[0];
    const nextSel = d ? { ref: d.ref, vid: d.v.id } : before.approvals[0] ? { sheet: before.approvals[0].id } : before.questions[0] ? { question: before.questions[0].m.id, key: before.questions[0].key } : null;
    pick(ref, v.id, () => setSel(nextSel));
  };
  const reject = (ref, v) => set((y) => rejectVersion(y, ref, v.id));
  // A note goes back to whoever made the version — it becomes the next one.
  const note = (ref, v, text) => {
    const x = get();
    if (ref.at === 'brief') {
      const agent = v.kind === 'script' ? 'writers' : 'ad';
      const action = v.kind === 'script' ? 'develop' : v.kind === 'scriptBreakdown' ? 'plan' : 'breakdown';
      request({ agent, action, scope: { type: 'brief' }, text: '', note: text, from: { ref, vid: v.id } });
      return;
    }
    if (ref.at === 'element') {
      const el = findElement(x, ref.id);
      request({ agent: el.kind === 'character' ? 'casting' : 'designer', action: 'variation', scope: { type: 'element', id: el.id }, text: '', note: text, from: { ref, vid: v.id } });
      return;
    }
    const scope = { type: 'shot', sceneId: ref.sceneId, id: ref.shotId };
    // A take Camera shot goes back to Camera; footage and edits go to VFX — an edit is
    // redone from its own source with both notes, never stacked on itself.
    // A Canvas take's prompt speaks the card's [Image N]; Camera drafts the shot again with the note.
    if (ref.at === 'take' && v.by === 'board') { request({ agent: 'camera', action: 'draft', scope, text: text, force: true }); return; }
    // A final is its draft at full resolution: the note reworks that draft.
    if (ref.at === 'take' && v.by === 'camera') { request({ agent: 'camera', action: 'draft', scope, text: '', note: text, from: { ref, vid: v.final ? v.parent : v.id }, force: true }); return; }
    if (ref.at === 'take') {
      const source = v.by === 'vfx' && v.parent ? v.parent : v.id;
      request({ agent: 'vfx', action: 'edit', scope, text: '', note: v.by === 'vfx' && v.note ? `${v.note}. ${text}` : text, from: { ref, vid: source } });
    }
  };
  const keepStale = (sceneId, shotId) => set((x) => {
    const sh = findShot(x, sceneId, shotId);
    const t = pickedOf(sh.takes);
    return t ? patchVersion(x, { at: 'take', sceneId, shotId }, t.id, { used: usedOf(x, sh) }) : x;
  });
  const redoStale = (sceneId, shotId) => { request({ agent: 'camera', action: 'draft', scope: { type: 'shot', sceneId, id: shotId }, text: '', force: true }); setMode('direct'); setScope({ type: 'shot', sceneId, id: shotId }); };
  // THE PLAN: the crew's next jobs, read off the brief; nothing runs until you press Go.
  const plan = planOf(s);
  // The job running now (newest first), with the stage it is on — shown on the plan step.
  const live = Object.values(s.threads).flat().filter((m) => m.kind === 'delivery' && !m.finished && m.stage).sort((a, b) => (b.stageAt || 0) - (a.stageAt || 0))[0] || null;
  const [busyStep, setBusyStep] = useState(null);
  // Go on a plan step = the director's say-so: its call sheet is approved with it, and a
  // screenplay the Writers deliver for the brief replaces it (the brief before is kept).
  // Redo re-runs a finished step: its result comes back as a new version to pick in Review.
  const goStep = async (st, { redo = false } = {}) => {
    if (st.review && !redo) { review(st.review.ref, st.review.vid); return; }
    if (!st.req || busyStep) return;
    setBusyStep(st.id);
    try {
      const before = get().script;
      const out = await request(st.req);
      // Casting's call sheet carries every plate's prompt: Go opens it in Review to read and
      // edit before Approve. Other steps' sheets are approved with the Go.
      if (out?.sheet && st.id === 'cast') { setSel({ sheet: out.sheet }); setFilter('needs'); setMode('review'); }
      else if (out?.sheet) await approve(out.sheet);
      if (st.req.apply) set((y) => {
        const vs = y.brief.versions;
        const fresh = [...vs].reverse().find((w) => w.kind === 'script' && w.status === 'review');
        if (!fresh) return y;
        const kept = String(before || '').trim() ? [{ id: uid('v-'), at: Date.now(), by: 'you', kind: 'script', status: 'kept', text: before, title: 'Your brief' }] : [];
        return { ...y, script: fresh.text, brief: { ...y.brief, versions: [...kept, ...vs.map((w) => (w.id === fresh.id ? { ...w, status: 'picked' } : w.kind === 'script' && w.status === 'picked' ? { ...w, status: 'kept' } : w))] } };
      });
    } finally { setBusyStep(null); }
  };
  const review = (ref, vid) => { setSel({ ref, vid }); setFilter('all'); setMode('review'); };
  // FINAL — a draft at 1080p MOV: one from Review, or a scene's circled drafts.
  const crewApi = { send: (agent, action, text) => request({ agent, action, scope, text }), final: (sceneId) => request({ agent: 'camera', action: 'final', scope: { type: 'scene', id: sceneId }, text: '' }) };
  // From Review, its call sheet opens right there.
  const final = async (ref, v) => {
    const r = await request({ agent: 'camera', action: 'final', scope: { type: 'shot', sceneId: ref.sceneId, id: ref.shotId }, text: '', from: { ref, vid: v.id } });
    if (r?.sheet) setSel({ sheet: r.sheet });
  };
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
  const open = (sc) => { setScope(sc); setMode('direct'); };

  const q = reviewQueue(s);
  const spineItem = ({ on, label, onClick, icon, right, key, sub }) => (
    <div key={key} role="button" className={on ? undefined : 'st-row'} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: sub ? '5px 10px 5px 30px' : '7px 10px', borderRadius: 8, cursor: 'pointer', background: on ? C.hover : 'transparent', boxShadow: on && !sub ? `inset 2px 0 0 ${C.accent}` : 'none', color: on ? C.ink : sub ? C.muted : C.text, fontWeight: on && !sub ? 600 : 400, fontSize: sub ? 12.5 : 13.5 }}>
      {icon && <span style={{ display: 'grid', placeItems: 'center', width: 18, color: on ? C.accent : C.muted, fontSize: 15 }}>{icon}</span>}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>{right}
    </div>
  );
  const sceneOn = (id) => (scope.type === 'scene' && scope.id === id) || (scope.type === 'shot' && scope.sceneId === id);
  const STATUS_COLOR = { final: C.good, circled: C.gold, boarded: C.work, written: '#3a3f48' };
  const addScene = () => { const sc = newScene(`Scene ${s.scenes.length + 1}`); set((x) => ({ ...x, scenes: [...x.scenes, sc] })); setScope({ type: 'scene', id: sc.id }); };
  const title = String(projectTitle || '').replace(/^Project\s+/, '').replace(/^"|"$/g, '');

  return (
    <div ref={rootRef} className="studio" style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', height: 'calc(100vh - 84px)', background: C.bg, border: `1px solid #000`, borderRadius: 14, overflow: 'hidden', textAlign: 'left', color: C.ink }}>
      <style dangerouslySetInnerHTML={{ __html: STUDIO_CSS }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 14, padding: '0 16px', height: 52, borderBottom: `1px solid ${C.line}`, background: C.panel }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: C.accent, display: 'grid', placeItems: 'center', flex: '0 0 auto' }}><span style={{ width: 0, height: 0, borderLeft: `7px solid ${C.accentInk}`, borderTop: '4.5px solid transparent', borderBottom: '4.5px solid transparent', marginLeft: 2 }} /></span>
          <ProjectMenu project={project} title={title} container={() => rootRef.current} />
          {project && (
            <>
              <span role="button" className="st-chip" title="Project settings: title, planner model, reasoning effort, language" onClick={project.openSettings} style={{ width: 28, height: 28, borderRadius: 7, display: 'grid', placeItems: 'center', border: `1px solid ${C.line}`, color: C.text, cursor: 'pointer', flex: '0 0 auto' }}><IconSettings /></span>
              <span role="button" className="st-chip" title="Crew skills: what each crew member is told, and each model's prompt spec" onClick={project.openSkills} style={{ height: 28, padding: '0 10px', borderRadius: 7, display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${C.line}`, color: C.text, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, flex: '0 0 auto' }}><IconUserGroup />Crew</span>
            </>
          )}
        </div>
        <div style={{ display: 'inline-flex', background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: 3 }}>
          {MODES.map((m) => (
            <span key={m} role="button" onClick={() => { if (m === 'review' && mode !== 'review') setFilter(q.waiting ? 'needs' : 'all'); setMode(m); }} style={{ padding: '5px 16px', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 7, background: mode === m ? C.hover : 'transparent', color: mode === m ? C.ink : C.muted }}>
              {MODE_LABEL[m]}
              {m === 'review' && q.waiting > 0 && <span style={{ minWidth: 18, height: 18, borderRadius: 9, background: C.warn, color: C.accentInk, fontSize: 11, fontWeight: 800, display: 'inline-grid', placeItems: 'center', padding: '0 5px' }}>{q.waiting}</span>}
              {m === 'generations' && q.working > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: C.work, fontSize: 12 }}><Dot color={C.work} pulse />{q.working}</span>}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'flex-end', fontSize: 12.5, color: C.muted }}>
          {project?.status && <span style={{ color: project.saveFailed ? C.bad : undefined, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={project.status}>{project.status}</span>}
          <span style={{ fontFamily: MONO }}>{s.gens || 0} gens</span>
        </div>
      </div>

      {!linked ? <div /> : !hasStudioWork(s) && !started ? (
        <Start
          importing={importing}
          onFootage={(files) => { const sc = newScene('Scene 1'); set((x) => ({ ...x, scenes: [...x.scenes, sc] })); setStarted(true); setScope({ type: 'scene', id: sc.id }); importFootage({ files, sceneId: sc.id, set, toast, onProgress: setImporting }); }}
          onScript={() => { setStarted(true); setScope({ type: 'brief' }); }}
        />
      ) : mode === 'direct' ? (
        <div style={{ display: 'grid', gridTemplateColumns: `216px minmax(0, 1fr) ${crewWidth}px`, minHeight: 0 }}>
          <div style={{ borderRight: `1px solid ${C.line}`, padding: '12px 8px', overflowY: 'auto', background: C.panel, display: 'grid', gap: 2, alignContent: 'start' }}>
            {spineItem({ on: scope.type === 'brief', label: 'Brief', icon: <IconFile />, onClick: () => setScope({ type: 'brief' }) })}
            {spineItem({ on: scope.type === 'world' || scope.type === 'element', label: 'Cast & World', icon: <IconUserGroup />, onClick: () => setScope({ type: 'world' }), right: <span style={{ fontSize: 11.5, color: C.muted, fontFamily: MONO }}>{s.elements.length || ''}</span> })}
            <div style={{ display: 'flex', alignItems: 'center', padding: '16px 6px 6px 10px' }}>
              <span style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, letterSpacing: 1.1, flex: 1 }}>SCENES</span>
              <span role="button" className="st-chip" title="New scene" onClick={addScene} style={{ cursor: 'pointer', color: C.muted, width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', border: `1px solid ${C.line}` }}><IconPlus style={{ fontSize: 12 }} /></span>
            </div>
            {!s.scenes.length && <div style={{ fontSize: 12, color: C.muted, padding: '2px 10px 6px' }}>None yet</div>}
            {s.scenes.map((sc, i) => {
              const st = sceneStatus(sc);
              const open_ = sceneOn(sc.id);
              return [
                spineItem({
                  key: sc.id, on: open_, label: sc.title,
                  icon: <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: open_ ? C.accent : C.muted }}>{pad2(i + 1)}</span>,
                  onClick: () => setScope({ type: 'scene', id: sc.id }),
                  right: <span title={st} style={{ display: 'inline-flex' }}><Dot color={STATUS_COLOR[st] || C.warn} /></span>,
                }),
                ...(open_ ? sc.shots.map((sh) => spineItem({ key: sh.id, sub: true, on: scope.type === 'shot' && scope.id === sh.id, label: <><span style={{ fontFamily: MONO, marginRight: 7, color: C.muted }}>{pad2(shotNumber(s, sh.id))}</span>{sh.title}</>, onClick: () => setScope({ type: 'shot', sceneId: sc.id, id: sh.id }), right: pickedOf(sh.takes) ? <span style={{ color: C.gold, fontSize: 10 }}>★</span> : null })) : []),
              ];
            })}
            <div style={{ height: 1, background: C.line, margin: '12px 6px' }} />
            {spineItem({ on: scope.type === 'cut', label: 'Cut', icon: <IconPlayCircle />, onClick: () => setScope({ type: 'cut' }) })}
          </div>
          <div style={{ overflowY: 'auto', padding: '26px 30px 40px', minWidth: 0 }}>
            <DirectPage s={s} set={set} scope={scope} setScope={setScope} pick={pick} review={review} toast={toast} crew={crewApi} canvas={canvas} plan={plan} onGo={goStep} busy={busyStep} live={live} />
          </div>
          <div style={{ borderLeft: `1px solid ${C.line}`, minHeight: 0, position: 'relative' }}>
            <div role="separator" aria-orientation="vertical" title="Drag to resize" onMouseDown={dragCrew} style={{ position: 'absolute', left: -4, top: 0, bottom: 0, width: 8, cursor: 'col-resize', zIndex: 3 }} />
            <Thread
              s={s} scope={scope}
              target={scope.type === 'shot' ? scopeTarget(s, scope) : ''}
              onClearTarget={() => setScope({ type: 'scene', id: scope.sceneId })}
              onRequest={fromComposer} approve={approve} cancel={cancel} answer={answer} review={review} ask={ask}
              text={draft} setText={setDraft} undoShot={undoShot}
            />
          </div>
        </div>
      ) : mode === 'generations' ? (
        <GenerationsView s={s} open={review} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', minHeight: 0 }}>
          <Queue s={s} q={q} sel={sel} setSel={setSel} filter={filter} setFilter={setFilter} />
          <div style={{ overflowY: 'auto', padding: '26px 30px 40px', minWidth: 0 }}>
            <Detail s={s} set={set} toast={toast} sel={sel} setSel={setSel} q={q} onPick={pickAndNext} onNote={note} onFinal={final} onReject={reject} approve={approve} cancel={cancel} answer={answer} keepStale={keepStale} redoStale={redoStale} open={open} canvas={canvas} />
          </div>
        </div>
      )}
    </div>
  );
};

export default StudioPlayground;
