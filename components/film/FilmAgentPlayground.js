import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Input,
  Select,
  Space,
  Typography,
  Message,
  Modal,
} from '@arco-design/web-react';
import {
  IconDownload,
  IconPlayArrow,
  IconDelete,
} from '@arco-design/web-react/icon';
import FilmCanvas from './canvas/FilmCanvas';
import PromptSettings from './PromptSettings';
import SkillSettings from './SkillSettings';
import { hydrateSkills } from '../../utils/film/skills';
import { emptyProject } from '../../utils/film/projectShape';
import { hasStudioWork } from '../../utils/film/studio/model';
import { saveProjectToCloud, listCloudProjects, loadCloudProject, deleteCloudProject, prefetchCloudMedia, setLastProjectPointer, getLastProjectPointer, clearLastProjectPointer } from '../../utils/film/cloudStore';
import { applyDeployModels, REASONER_OPTIONS, REASONING_EFFORTS, reasonerSlotOf, resolveModelId, setClientConfig, getRuntime } from '../../utils/film/suiteConfig';

const { Title, Text } = Typography;

const LANGUAGE_OPTIONS = [
  { label: 'English', value: 'en' },
  { label: '中文 (简体)', value: 'zh-CN' },
  { label: 'Español', value: 'es' },
  { label: 'Français', value: 'fr' },
  { label: 'Deutsch', value: 'de' },
  { label: '日本語', value: 'ja' },
  { label: '한국어', value: 'ko' },
];

const randomId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const FilmAgentPlayground = ({ formValues, setFormValues, onProjectTitle, onStudioLoad, studioSave, onBoard, onControls, canvasInject }) => {
  const [project, setProject] = useState(null);
  useEffect(() => { if (onProjectTitle) onProjectTitle(project?.title || ''); }, [project?.title, onProjectTitle]);
  // THE STUDIO LIVES IN THE PROJECT (project.studio): each project load hands its studio
  // to the Studio tab; the tab's edits come back here and ride the project's own saves
  // (cloud autosave, folder save, Cloud open).
  // A load is an event, not an effect: opening the same project again (the cloud copy after a
  // conflict) reloads the Studio too, and nothing re-runs it from an old snapshot.
  const adopt = (p) => {
    setProject(p);
    if (onStudioLoad && p?.id) onStudioLoad({ projectId: p.id, title: p.title || '', data: p.studio || null, nonce: Date.now() });
  };
  useEffect(() => {
    if (!studioSave?.projectId) return;
    setProject((p) => (p && p.id === studioSave.projectId && JSON.stringify(p.studio || null) !== JSON.stringify(studioSave.data) ? { ...p, studio: studioSave.data } : p));
  }, [studioSave]);
  // Studio reads the board's work (plates, SHOT cards, takes) to bring it in on request.
  useEffect(() => {
    if (onBoard && project?.id) onBoard({ projectId: project.id, nodes: project.canvas?.nodes || [], bible: project.bible?.entries || [] });
  }, [project?.id, project?.canvas?.nodes, project?.bible]); // eslint-disable-line react-hooks/exhaustive-deps
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  // WHICH LLM PLANS. App-level, not per-project (it lives in the client config beside
  // the model table); the state here exists only so the Select re-renders on change.
  const [plannerSlot, setPlannerSlot] = useState(() => reasonerSlotOf());
  const [effort, setEffort] = useState('high');
  useEffect(() => { setPlannerSlot(reasonerSlotOf()); setEffort(getRuntime().reasoningEffort); }, [settingsOpen]);

  // Opening the canvas mints a WORKING TITLE (a film-flavoured word pair from
  // randomFilmTitle) instead of another "Untitled" — rename any time in the header.
  const makeScratch = useCallback(() => emptyProject({
    id: randomId(),
    title: '',
    language: formValues.language || 'en',
    targetMinutes: formValues.targetMinutes || 4,
  }), [formValues.language, formValues.targetMinutes]);

  // ---- refresh restore + cloud autosave state --------------------------------------
  // The autosave baseline: the last project JSON that reached the cloud (skip identical
  // saves) + an in-flight guard + a kill switch when TOS isn't configured (starter-kit
  // clones without credentials must not retry every debounce tick).
  // bases: this session's cloud version per project id (what its next save is based on).
  const cloudAutoRef = useRef({ busy: false, lastJson: '', disabled: false, lastAt: 0, again: false, bases: {} });
  const [cloudSavedAt, setCloudSavedAt] = useState(null);
  const [cloudError, setCloudError] = useState('');
  // A save the cloud refused because its copy moved on: { id, cloudSavedAt } until the director decides.
  const [conflict, setConflict] = useState(null);

  // DEPLOYMENT CONFIG hydration: env-configured model/endpoint ids live server-side —
  // fetch the resolved (non-secret) table once and feed the suite's runtime layer, so
  // every getModel consumer resolves the deployment's ids.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/film/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        applyDeployModels(j.models);
      })
      .catch(() => { /* defaults keep working */ });
    return () => { cancelled = true; };
  }, []);

  // On mount: RESTORE the last-open project (its cloud id, from localStorage)
  // so a page refresh keeps the board — else mint the usual scratch. Client-only (avoids
  // SSR/CSR hydration mismatch from random id + timestamps). Once per page: a re-run must not
  // load the project over the one in use.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return undefined;
    restoredRef.current = true;
    let cancelled = false;
    (async () => {
      const ptr = getLastProjectPointer();
      if (ptr?.kind === 'cloud' && ptr.id) {
        try {
          const r = await loadCloudProject(ptr.id);
          if (cancelled) return;
          adopt(r.project);
          cloudAutoRef.current.lastJson = JSON.stringify(r.project);
          cloudAutoRef.current.bases[r.project.id] = r.savedAt;
          setCloudSavedAt(r.savedAt ? new Date(r.savedAt) : null);
          prefetchCloudMedia(r.media);
          Message.success(`Restored “${r.name}” from cloud autosave${r.savedAt ? ` (${new Date(r.savedAt).toLocaleTimeString()})` : ''}`);
          return;
        } catch { /* stale pointer / TOS unavailable — fall through to scratch */ }
      }
      if (!cancelled && !projectStateRef.current) adopt(makeScratch());
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // CLOUD AUTOSAVE — the whole project lands in the cloud manifest a second after each
  // change (bytes were already mirrored at generation, so this is just the JSON). Runs in
  // EVERY mode once the project has any work; the pointer follows, so refresh restores
  // exactly. A change made while a save is in flight is saved right after it. A failed save
  // is shown in the header with its reason (the next change saves again; "Save now" in the
  // project menu saves at once). Off for the session when TOS isn't configured at all.
  const cloudAutosave = useCallback(async (proj, { force = false } = {}) => {
    const st = cloudAutoRef.current;
    if (!proj?.id || st.disabled) return;
    if (st.blockedId === proj.id && !force) return; // a refused save waits for the director's choice
    if (st.busy) { st.again = true; return; }
    if (!(proj.canvas?.nodes || []).length && !hasStudioWork(proj.studio)) return; // an empty scratch isn't worth a manifest (Studio work counts)
    const json = JSON.stringify(proj);
    if (json === st.lastJson) return;
    st.busy = true;
    try {
      const r = await saveProjectToCloud(proj, { baseSavedAt: st.bases[proj.id] ?? null, force });
      st.bases[proj.id] = r.savedAt;
      st.blockedId = null;
      setConflict(null);
      st.lastJson = json;
      st.lastAt = Date.now();
      setCloudSavedAt(new Date());
      setCloudError('');
      setLastProjectPointer({ kind: 'cloud', id: r.projectId });
    } catch (e) {
      if (/TOS is not configured/i.test(e.message)) st.disabled = true;
      else {
        setCloudError(e.message || 'the save failed');
        if (e.conflict) { st.blockedId = proj.id; setConflict({ id: proj.id, cloudSavedAt: e.cloudSavedAt }); }
      }
    } finally {
      st.busy = false;
    }
    if (st.again) { st.again = false; cloudAutosave(projectStateRef.current); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // CADENCE: a second after the last change — and, while changes keep coming (a drag, a
  // crew run), at least every 4 s. Identical states are free (the lastJson fingerprint).
  const projectStateRef = useRef(project);
  useEffect(() => { projectStateRef.current = project; }, [project]);
  const dirtySinceRef = useRef(0);
  useEffect(() => {
    if (!project) return undefined;
    if (!dirtySinceRef.current) dirtySinceRef.current = Date.now();
    const wait = Math.max(0, Math.min(1000, 4000 - (Date.now() - dirtySinceRef.current)));
    const t = setTimeout(() => { dirtySinceRef.current = 0; cloudAutosave(projectStateRef.current); }, wait);
    return () => clearTimeout(t);
  }, [project, cloudAutosave]);
  // Leaving with work the cloud does not have yet: the browser asks first.
  useEffect(() => {
    const onLeave = (e) => {
      const st = cloudAutoRef.current;
      const p = projectStateRef.current;
      if (st.disabled || !p || (!(p.canvas?.nodes || []).length && !hasStudioWork(p.studio))) return;
      if (st.busy || JSON.stringify(p) !== st.lastJson) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  // The SKILLS LIBRARY loads with the app, NOT with its drawer: a skill that hasn't
  // hydrated cannot bind, and Compose/Film would silently fall back to the distilled
  // format line. One fetch per session.
  useEffect(() => { hydrateSkills(); }, []);
  // Flush when the tab hides (switching away / closing).
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden' && projectStateRef.current) cloudAutosave(projectStateRef.current); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [cloudAutosave]);

  const handleNewScratch = () => {
    // Leaving a board behind must never cost work — flush it to its cloud manifest first.
    if (project && ((project.canvas?.nodes || []).length || hasStudioWork(project.studio))) cloudAutosave(project);
    adopt(makeScratch());
    setCloudSavedAt(null);
    cloudAutoRef.current.lastJson = '';
    clearLastProjectPointer(); // refresh must NOT resurrect the project the user just left
    Message.info('New project — it saves to the cloud as soon as there is work in it');
  };

  // ---- Cloud save / open (TOS-backed; works from ANY mode, scratch included) --------
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudPicker, setCloudPicker] = useState({ visible: false, items: null });
  // Bumping this asks the canvas to run the DEMO REPLAY — the board plays itself,
  // pipeline-ordered, camera following. Pure reveal: zero generation, saves untouched.
  const [demoNonce, setDemoNonce] = useState(0);

  const handleCloudOpenClick = async () => {
    setCloudPicker({ visible: true, items: null });
    try {
      const items = await listCloudProjects();
      setCloudPicker((p) => (p.visible ? { ...p, items } : p));
    } catch (e) {
      Message.error(`Cloud list failed: ${e.message}`);
      setCloudPicker({ visible: false, items: null });
    }
  };

  const handleCloudPick = async (id, { demo = false } = {}) => {
    setCloudPicker({ visible: false, items: null });
    setCloudBusy(true);
    try {
      // Switching projects must never cost work: flush the OUTGOING board to its own
      // cloud manifest first (no-ops when unchanged/empty), THEN swap. No dialog — the
      // save IS the safety.
      if (project && ((project.canvas?.nodes || []).length || hasStudioWork(project.studio))) await cloudAutosave(project);
      const r = await loadCloudProject(id);
      adopt(r.project);
      // A cloud-loaded project lands as a live in-memory canvas — cloud autosave keeps
      // it saved from here, and the pointer makes refresh restore it. The board renders
      // immediately; media streams through the read-through cache — prefetch warms the rest.
      cloudAutoRef.current.lastJson = JSON.stringify(r.project);
      cloudAutoRef.current.blockedId = null;
      setConflict(null);
      setCloudError('');
      cloudAutoRef.current.bases[r.project.id] = r.savedAt;
      setCloudSavedAt(r.savedAt ? new Date(r.savedAt) : null);
      setLastProjectPointer({ kind: 'cloud', id });
      prefetchCloudMedia(r.media);
      Message.success(`“${r.name}” loaded from cloud — previews stream in as tiles first paint`);
      if (demo) setDemoNonce((n) => n + 1); // the canvas starts the replay once the board lands
    } catch (e) {
      Message.error(`Cloud load failed: ${e.message}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const patchProject = (patch) => setProject((prev) => ({ ...prev, ...patch }));

  // THE PROJECT'S CONTROLS live in the Studio header: they are handed over here. Handlers read
  // the latest state through a ref; the snapshot re-publishes when what it shows changes.
  const statusText = conflict ? `☁ Not saved — the cloud copy changed${conflict.cloudSavedAt ? ` at ${new Date(conflict.cloudSavedAt).toLocaleTimeString()}` : ''}` : cloudError ? `☁ Not saved: ${cloudError}`
    : cloudSavedAt ? `Saved ☁ ${cloudSavedAt.toLocaleTimeString()}` : 'Autosave arms once you add work';
  const controlsRef = useRef({});
  controlsRef.current = {
    newProject: handleNewScratch, openCloud: handleCloudOpenClick,
    openSettings: () => setSettingsOpen(true), openPrompts: () => setPromptsOpen(true), openSkills: () => setSkillsOpen(true),
    saveNow: () => {
      const p = projectStateRef.current;
      if (!p) return;
      if (cloudAutoRef.current.blockedId === p.id) { setConflict((c) => c || { id: p.id, cloudSavedAt: null }); return; }
      cloudAutoRef.current.lastJson = '';
      cloudAutosave(p);
    },
  };
  useEffect(() => {
    if (!onControls) return;
    const call = (k) => (...a) => controlsRef.current[k](...a);
    onControls({
      title: project?.title || '', status: statusText, saveFailed: !!cloudError, cloudBusy,
      newProject: call('newProject'), openCloud: call('openCloud'),
      openSettings: call('openSettings'), openPrompts: call('openPrompts'), openSkills: call('openSkills'), saveNow: call('saveNow'),
    });
  }, [project?.title, statusText, cloudError, cloudBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  const dialogs = (
    <>
      <Modal
        title="This project changed somewhere else"
        visible={!!conflict}
        footer={null}
        onCancel={() => setConflict(null)}
      >
        {conflict && (
          <Space direction="vertical" style={{ width: '100%' }} size="medium">
            <Text style={{ wordBreak: 'normal', overflowWrap: 'break-word' }}>
              The cloud copy was saved{conflict.cloudSavedAt ? ` at ${new Date(conflict.cloudSavedAt).toLocaleString()}` : ''} by another tab, machine or person, and this session has not seen it. Nothing has been overwritten — saving is paused until you choose.
            </Text>
            <Space wrap>
              <Button type="primary" onClick={() => handleCloudPick(conflict.id)}>Open the cloud copy</Button>
              <Button status="danger" onClick={() => { const p = projectStateRef.current; setConflict(null); if (p) cloudAutosave(p, { force: true }); }}>Overwrite it with this version</Button>
              <Button type="text" onClick={() => setConflict(null)}>Decide later</Button>
            </Space>
          </Space>
        )}
      </Modal>
      <PromptSettings visible={promptsOpen} onClose={() => setPromptsOpen(false)} />
      <SkillSettings visible={skillsOpen} onClose={() => setSkillsOpen(false)} />

      <Modal
        title="Open from cloud"
        visible={cloudPicker.visible}
        footer={null}
        onCancel={() => setCloudPicker({ visible: false, items: null })}
      >
        {cloudPicker.items === null ? (
          <Text type="secondary">Loading cloud projects…</Text>
        ) : cloudPicker.items.length === 0 ? (
          <Text type="secondary">No cloud saves yet — click “Cloud save” on a project first.</Text>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            {cloudPicker.items.map((it) => (
              <div key={it.projectId} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Button long onClick={() => handleCloudPick(it.projectId)} style={{ display: 'flex', justifyContent: 'space-between', flex: 1, minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name || it.projectId}</span>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {it.savedAt ? new Date(it.savedAt).toLocaleString() : ''} · {it.mediaCount} media
                  </Text>
                </Button>
                <Button
                  size="small"
                  icon={<IconPlayArrow />}
                  title="Open and auto-demo — the board replays itself: brief → cast → storyboard → shots → takes, camera following"
                  onClick={(e) => { e.stopPropagation(); handleCloudPick(it.projectId, { demo: true }); }}
                />
                <Button
                  size="small"
                  icon={<IconDownload />}
                  title="Download this project's manifest JSON for inspection"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      const m = await loadCloudProject(it.projectId);
                      const blob = new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' });
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = `${it.projectId}-manifest.json`;
                      document.body.appendChild(a); a.click(); a.remove();
                      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
                    } catch (err) {
                      Message.error(`Manifest download failed: ${err.message}`);
                    }
                  }}
                />
                <Button
                  size="small"
                  status="danger"
                  icon={<IconDelete />}
                  title="Delete this project from the cloud — manifest, history, and any media no other project still uses"
                  onClick={(e) => {
                    e.stopPropagation();
                    Modal.confirm({
                      title: `Delete “${it.name || it.projectId}” from the cloud?`,
                      content: 'Removes its manifest, save history, and every media object no other project references (shared media is kept). This cannot be undone.',
                      okText: 'Delete permanently',
                      okButtonProps: { status: 'danger' },
                      onOk: async () => {
                        try {
                          const r = await deleteCloudProject(it.projectId);
                          Message.success(`Deleted — ${r.removedMedia} media purged${r.keptShared ? `, ${r.keptShared} kept (shared with other projects)` : ''}`);
                          setCloudPicker((prev) => ({ ...prev, items: (prev.items || []).filter((x) => x.projectId !== it.projectId) }));
                        } catch (err) {
                          Message.error(`Delete failed: ${err.message}`);
                        }
                      },
                    });
                  }}
                />
              </div>
            ))}
          </Space>
        )}
      </Modal>

      <Modal
        title="Project settings"
        visible={settingsOpen}
        onOk={() => setSettingsOpen(false)}
        onCancel={() => setSettingsOpen(false)}
        okText="Done"
      >
        {project && (
          <Space direction="vertical" style={{ width: '100%' }} size="medium">
            <div>
              <Text type="secondary">Title</Text>
              <Input value={project.title} onChange={(v) => patchProject({ title: v })} />
            </div>
            <div>
              <Text type="secondary" style={{ marginRight: 8 }}>Planner model</Text>
              <Select
                value={plannerSlot}
                onChange={(v) => { setClientConfig({ runtime: { reasonerSlot: v } }); setPlannerSlot(v); }}
                style={{ width: 220 }}
                options={REASONER_OPTIONS.map((o) => ({
                  label: resolveModelId(o.key) ? o.label : `${o.label} — not configured`,
                  value: o.key,
                  disabled: !resolveModelId(o.key),
                }))}
              />
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                The LLM behind EVERY reasoning call in the suite
              </Text>
            </div>
            <div>
              <Text type="secondary" style={{ marginRight: 8 }}>Reasoning effort</Text>
              <Select
                value={effort}
                onChange={(v) => { setClientConfig({ runtime: { reasoningEffort: v } }); setEffort(v); }}
                disabled={!REASONER_OPTIONS.find((o) => o.key === plannerSlot)?.effort}
                style={{ width: 220 }}
                options={REASONING_EFFORTS.map((v) => ({ label: v, value: v }))}
              />
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                {REASONER_OPTIONS.find((o) => o.key === plannerSlot)?.effort
                  ? 'How deeply the planner thinks before answering — higher is slower and costs more'
                  : 'This planner runs without deep reasoning — effort does not apply'}
              </Text>
            </div>
            <Space wrap>
              <div>
                <Text type="secondary" style={{ marginRight: 8 }}>Language</Text>
                <Select value={project.language} onChange={(v) => patchProject({ language: v })} style={{ width: 160 }} options={LANGUAGE_OPTIONS} />
              </div>
              <div>
                <Text type="secondary" style={{ marginRight: 8 }}>Target length</Text>
                <Select value={project.targetMinutes} onChange={(v) => patchProject({ targetMinutes: v })} style={{ width: 130 }} options={[3, 4, 5].map((m) => ({ label: `${m} min`, value: m }))} />
              </div>
            </Space>
          </Space>
        )}
      </Modal>
    </>
  );

  if (!project) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Text type="secondary">Preparing canvas…</Text>
      </div>
    );
  }



  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <Space align="center" size={4} wrap>
            <Title heading={6} style={{ margin: '0 4px 0 0' }}>{project.title}</Title>
          </Space>
        </div>

        <Space wrap>
          <Text type="secondary" style={{ fontSize: 12 }}>{statusText}</Text>
          <Button size="small" icon={<IconPlayArrow />} onClick={() => setDemoNonce((n) => n + 1)} title="Auto-demo — replay this board as a guided tour: brief → cast → storyboard → shots → takes, camera following. Pure playback, nothing is generated.">Demo</Button>
        </Space>
      </div>

      <FilmCanvas
        project={project}
        onUpdateProject={setProject}
        demoNonce={demoNonce}
        inject={canvasInject}
      />

      {dialogs}
    </div>
  );
};

export default FilmAgentPlayground;
