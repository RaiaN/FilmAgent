import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Input,
  Select,
  Space,
  Typography,
  Message,
  Modal,
  Dropdown,
  Menu,
} from '@arco-design/web-react';
import {
  IconFolder,
  IconFolderAdd,
  IconClockCircle,
  IconSettings,
  IconPlus,
  IconCode,
  IconCloudDownload,
  IconDownload,
  IconPlayArrow,
} from '@arco-design/web-react/icon';
import FilmCanvas from './canvas/FilmCanvas';
import PromptSettings from './PromptSettings';
import { emptyProject } from '../../utils/film/projectShape';
import {
  listRecent,
  loadProjectAny,
  pickProjectFolder,
  saveProjectAny,
} from '../../utils/film/projectStore';
import { saveProjectToCloud, listCloudProjects, loadCloudProject, prefetchCloudMedia, setLastProjectPointer, getLastProjectPointer, clearLastProjectPointer } from '../../utils/film/cloudStore';
import { applyDeployModels } from '../../utils/film/suiteConfig';

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

const FilmAgentPlayground = ({ formValues, setFormValues, apiKey, onChangeApiKey, onSaveApiKey }) => {
  const [project, setProject] = useState(null);
  // storage === null  => in-memory scratch project (not yet persisted)
  //   { kind: 'path', path }      => Electron / fallback text path
  //   { kind: 'handle', handle }  => browser File System Access API
  const [storage, setStorage] = useState(null);
  const [displayPath, setDisplayPath] = useState('');
  const [recent, setRecent] = useState([]);
  const [pathPicker, setPathPicker] = useState({ visible: false, mode: 'open', value: '' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);

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
  const cloudAutoRef = useRef({ busy: false, lastJson: '', disabled: false, lastAt: 0 });
  const [cloudSavedAt, setCloudSavedAt] = useState(null);

  // DEPLOYMENT CONFIG hydration: env-configured model/endpoint ids live server-side —
  // fetch the resolved (non-secret) table once and feed the suite's runtime layer, so
  // every getModel consumer resolves the deployment's ids. hasServerKey flips the
  // canvas into key-less mode (requests omit the key; routes use the server env key).
  const [serverKeyed, setServerKeyed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/film/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        applyDeployModels(j.models);
        setServerKeyed(!!j.hasServerKey);
      })
      .catch(() => { /* defaults keep working */ });
    return () => { cancelled = true; };
  }, []);

  // On mount: RESTORE the last-open project (cloud id or folder path from localStorage)
  // so a page refresh keeps the board — else mint the usual scratch. Client-only (avoids
  // SSR/CSR hydration mismatch from random id + timestamps).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ptr = getLastProjectPointer();
      if (ptr?.kind === 'cloud' && ptr.id) {
        try {
          const r = await loadCloudProject(ptr.id);
          if (cancelled) return;
          setProject(r.project);
          cloudAutoRef.current.lastJson = JSON.stringify(r.project);
          setCloudSavedAt(r.savedAt ? new Date(r.savedAt) : null);
          prefetchCloudMedia(r.media);
          Message.success(`Restored “${r.name}” from cloud autosave${r.savedAt ? ` (${new Date(r.savedAt).toLocaleTimeString()})` : ''}`);
          return;
        } catch { /* stale pointer / TOS unavailable — fall through to scratch */ }
      } else if (ptr?.kind === 'path' && ptr.path) {
        try {
          const res = await loadProjectAny({ kind: 'path', path: ptr.path });
          if (cancelled) return;
          setProject(res.project);
          setStorage({ kind: 'path', path: ptr.path });
          setDisplayPath(res.displayPath || ptr.path);
          setLastSavedAt(new Date());
          Message.success(`Reopened "${res.project.title}"`);
          return;
        } catch { /* folder gone — fall through */ }
      }
      if (!cancelled) setProject((prev) => prev || makeScratch());
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // CLOUD AUTOSAVE — the real "auto" save: ~8s after changes settle, the whole project
  // lands in the cloud manifest (bytes were already mirrored at generation, so this is
  // just the JSON). Runs in EVERY mode once the board has any work; the pointer follows,
  // so refresh restores exactly. Quiet on failure (the next change retries); disabled
  // for the session when TOS isn't configured at all.
  const cloudAutosave = useCallback(async (proj) => {
    const st = cloudAutoRef.current;
    if (!proj?.id || st.busy || st.disabled) return;
    if (!(proj.canvas?.nodes || []).length) return; // an empty scratch isn't worth a manifest
    const json = JSON.stringify(proj);
    if (json === st.lastJson) return;
    st.busy = true;
    try {
      const r = await saveProjectToCloud(proj);
      st.lastJson = json;
      st.lastAt = Date.now();
      setCloudSavedAt(new Date());
      setLastProjectPointer({ kind: 'cloud', id: r.projectId });
    } catch (e) {
      if (/TOS is not configured/i.test(e.message)) st.disabled = true;
      else console.warn('[cloud autosave] failed (will retry on next change):', e.message);
    } finally {
      st.busy = false;
    }
  }, []);

  // CADENCE: a plain 15s interval — no debounce, no resets, no special cases. Every
  // tick saves IF the project changed (the lastJson fingerprint makes identical states
  // free), so churn or calm, the cloud is never more than ~15s behind the board.
  const projectStateRef = useRef(project);
  useEffect(() => { projectStateRef.current = project; }, [project]);
  useEffect(() => {
    const iv = setInterval(() => { if (projectStateRef.current) cloudAutosave(projectStateRef.current); }, 15000);
    return () => clearInterval(iv);
  }, [cloudAutosave]);

  // Flush when the tab hides (switching away / closing) — narrows the 15s window to
  // ~zero for deliberate leaves; only a hard kill mid-interval can lose seconds.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden' && projectStateRef.current) cloudAutosave(projectStateRef.current); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [cloudAutosave]);

  const refreshRecent = useCallback(async () => {
    try {
      setRecent(await listRecent());
    } catch (err) {
      // non-fatal
    }
  }, []);

  useEffect(() => { refreshRecent(); }, [refreshRecent]);

  // Auto-save only when the project is persisted (has storage). Scratch stays in memory.
  useEffect(() => {
    if (!project || !storage) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        setSaving(true);
        await saveProjectAny(storage, project);
        if (!cancelled) setLastSavedAt(new Date());
      } catch (err) {
        if (!cancelled) Message.error(`Auto-save failed: ${err.message}`);
      } finally {
        if (!cancelled) setSaving(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [project, storage]);

  const isScratch = !storage;

  // ---- open existing ----
  const openExistingFromStorage = useCallback(async (nextStorage) => {
    if (!nextStorage) return;
    try {
      const result = await loadProjectAny(nextStorage);
      setProject(result.project);
      setStorage(nextStorage);
      setDisplayPath(result.displayPath);
      setLastSavedAt(new Date());
      cloudAutoRef.current.lastJson = ''; // a different project — re-arm the autosave baseline
      if (nextStorage.kind === 'path') setLastProjectPointer({ kind: 'path', path: nextStorage.path });
      refreshRecent();
      Message.success(`Loaded "${result.project.title}"`);
    } catch (err) {
      Message.error(`Could not load: ${err.message}`);
    }
  }, [refreshRecent]);

  const handleOpenExisting = async () => {
    try {
      const picked = await pickProjectFolder({ mode: 'open' });
      if (picked.source === 'electron') {
        if (picked.path) openExistingFromStorage({ kind: 'path', path: picked.path });
      } else if (picked.source === 'handle') {
        if (picked.handle) openExistingFromStorage({ kind: 'handle', handle: picked.handle });
      } else {
        setPathPicker({ visible: true, mode: 'open', value: '' });
      }
    } catch (err) {
      Message.error(err.message);
    }
  };

  const handleOpenRecent = async (entry) => {
    try {
      await openExistingFromStorage({ kind: 'path', path: entry.path });
    } catch (err) {
      Message.error(`Could not open "${entry.title}": ${err.message}`);
      refreshRecent();
    }
  };

  // ---- save scratch -> folder ----
  const persistTo = useCallback(async (nextStorage, label) => {
    try {
      setSaving(true);
      const res = await saveProjectAny(nextStorage, project);
      setStorage(nextStorage);
      setDisplayPath(
        label
        || res.projectPath
        || (nextStorage.kind === 'handle' ? nextStorage.handle?.name : nextStorage.path)
        || '',
      );
      setLastSavedAt(new Date());
      if (nextStorage.kind === 'path') setLastProjectPointer({ kind: 'path', path: nextStorage.path });
      refreshRecent();
      Message.success('Saved to folder — auto-save is now on');
    } catch (err) {
      Message.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [project, refreshRecent]);

  const handleSaveToFolder = async () => {
    try {
      const picked = await pickProjectFolder({ mode: 'new' });
      if (picked.source === 'electron') {
        if (picked.path) persistTo({ kind: 'path', path: picked.path }, picked.path);
      } else if (picked.source === 'handle') {
        if (picked.handle) persistTo({ kind: 'handle', handle: picked.handle }, picked.name);
      } else {
        setPathPicker({ visible: true, mode: 'saveAs', value: '' });
      }
    } catch (err) {
      Message.error(err.message);
    }
  };

  const handlePathPickerSubmit = () => {
    const trimmed = (pathPicker.value || '').trim();
    if (!trimmed) {
      Message.error('Paste an absolute path first');
      return;
    }
    const mode = pathPicker.mode;
    setPathPicker({ visible: false, mode: 'open', value: '' });
    const next = { kind: 'path', path: trimmed };
    if (mode === 'saveAs') persistTo(next, trimmed);
    else openExistingFromStorage(next);
  };

  const handleNewScratch = () => {
    // Leaving a board behind must never cost work — flush it to its cloud manifest first.
    if (project && (project.canvas?.nodes || []).length) cloudAutosave(project);
    setProject(makeScratch());
    setStorage(null);
    setDisplayPath('');
    setLastSavedAt(null);
    setCloudSavedAt(null);
    cloudAutoRef.current.lastJson = '';
    clearLastProjectPointer(); // refresh must NOT resurrect the project the user just left
    Message.info('New scratch canvas — cloud autosave arms as soon as you add work');
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
      if (project && (project.canvas?.nodes || []).length) await cloudAutosave(project);
      const r = await loadCloudProject(id);
      setProject(r.project);
      // A cloud-loaded project lands as a live in-memory canvas — cloud autosave keeps
      // it saved from here, and the pointer makes refresh restore it. The board renders
      // immediately; media streams through the read-through cache — prefetch warms the rest.
      setStorage(null);
      setDisplayPath('');
      setLastSavedAt(null);
      cloudAutoRef.current.lastJson = JSON.stringify(r.project);
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

  const dialogs = (
    <>
      <PromptSettings visible={promptsOpen} onClose={() => setPromptsOpen(false)} />
      <Modal
        title={pathPicker.mode === 'saveAs' ? 'Save project to a folder' : 'Open existing project'}
        visible={pathPicker.visible}
        onOk={handlePathPickerSubmit}
        onCancel={() => setPathPicker({ visible: false, mode: 'open', value: '' })}
        okText={pathPicker.mode === 'saveAs' ? 'Save here' : 'Open'}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary">
            {pathPicker.mode === 'saveAs'
              ? 'Paste the absolute path where this project should be saved. It will be created if it doesn\'t exist.'
              : 'Paste the absolute path to your existing project folder (must contain project.json).'}
          </Text>
          <Input
            autoFocus
            value={pathPicker.value}
            onChange={(value) => setPathPicker((prev) => ({ ...prev, value }))}
            placeholder="/Users/you/Films/my-film"
            onPressEnter={handlePathPickerSubmit}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Tip: in the desktop build (<code>npm run dev:desktop</code>) you get a native folder picker instead.
          </Text>
        </Space>
      </Modal>

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
            {isScratch && (
              <div>
                <Button size="small" icon={<IconFolderAdd />} loading={saving} onClick={handleSaveToFolder}>Bind to a local folder…</Button>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                  Optional — cloud autosave already keeps this project safe; a folder adds a local copy (offline / zip / git).
                </Text>
              </div>
            )}
            {/* API key lives HERE now (the separate ⚙ drawer is gone). Server-keyed
                deployments show only the info line — no key UI at all. */}
            <div style={{ borderTop: '1px solid #f2f3f5', paddingTop: 12 }}>
              {serverKeyed ? (
                <>
                  <Text style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>API key: configured on the server</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    This deployment provides its own key — everything works without entering one, and no key is ever stored in your browser.
                  </Text>
                </>
              ) : (
                <>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>API key</Text>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Input.Password value={apiKey} onChange={(v) => onChangeApiKey && onChangeApiKey(v)} placeholder="Paste your Ark API key…" style={{ flex: 1 }} />
                    <Button type="primary" onClick={() => onSaveApiKey && onSaveApiKey()}>Save</Button>
                  </div>
                </>
              )}
            </div>
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

  const recentMenu = (
    <Menu onClickMenuItem={(key) => {
      const entry = recent.find((r) => r.path === key);
      if (entry) handleOpenRecent(entry);
    }}>
      {recent.map((entry) => (
        <Menu.Item key={entry.path}>{entry.title || entry.path}</Menu.Item>
      ))}
    </Menu>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <Space align="center" wrap>
            <Title heading={6} style={{ margin: 0 }}>{project.title}</Title>
          </Space>
          {!isScratch && displayPath && (
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {storage?.kind === 'handle' ? 'Folder (browser-handle): ' : 'Folder: '}{displayPath}
              </Text>
            </div>
          )}
        </div>

        <Space wrap>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {isScratch
              ? (cloudSavedAt ? `Cloud autosave ☁ ${cloudSavedAt.toLocaleTimeString()}` : 'Cloud autosave arms once you add work')
              : saving ? 'Saving…' : lastSavedAt ? `Saved ${lastSavedAt.toLocaleTimeString()}${cloudSavedAt ? ` · ☁ ${cloudSavedAt.toLocaleTimeString()}` : ''}` : 'Auto-save on'}
          </Text>
          <Button size="small" icon={<IconPlayArrow />} onClick={() => setDemoNonce((n) => n + 1)} title="Auto-demo — replay this board as a guided tour: brief → cast → storyboard → shots → takes, camera following. Pure playback, nothing is generated.">Demo</Button>
          <Button size="small" icon={<IconCloudDownload />} loading={cloudBusy} onClick={handleCloudOpenClick} title="Open a cloud project — autosave keeps every project in your TOS bucket as you work; restore the full board on any machine">Cloud open</Button>
          <Button size="small" icon={<IconCode />} onClick={() => setPromptsOpen(true)}>Prompts</Button>
          <Button size="small" icon={<IconSettings />} onClick={() => setSettingsOpen(true)}>Project</Button>
          <Button size="small" icon={<IconFolder />} onClick={handleOpenExisting}>Open…</Button>
          {recent.length > 0 && (
            <Dropdown droplist={recentMenu} position="br">
              <Button size="small" icon={<IconClockCircle />}>Recent</Button>
            </Dropdown>
          )}
          <Button size="small" icon={<IconPlus />} onClick={handleNewScratch}>New</Button>
        </Space>
      </div>

      <FilmCanvas
        project={project}
        apiKey={apiKey}
        serverKeyed={serverKeyed}
        onUpdateProject={setProject}
        demoNonce={demoNonce}
      />

      {serverKeyed && !apiKey?.trim() && (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
          Using the server-configured API key — no key entry needed.
        </Text>
      )}

      {!isScratch ? null : (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
          Cloud autosave keeps this canvas in your TOS bucket as you work — a refresh restores it automatically. <b>Save to folder…</b> additionally binds it to a local folder.
        </Text>
      )}

      {dialogs}
    </div>
  );
};

export default FilmAgentPlayground;
