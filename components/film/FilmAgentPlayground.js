import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Input,
  Select,
  Space,
  Tag,
  Typography,
  Message,
  Modal,
  Dropdown,
  Menu,
  Popover,
} from '@arco-design/web-react';
import {
  IconFolder,
  IconFolderAdd,
  IconClockCircle,
  IconSettings,
  IconPlus,
  IconCode,
  IconBulb,
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

const FilmAgentPlayground = ({ formValues, setFormValues, apiKey }) => {
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
  const [conciergeOpen, setConciergeOpen] = useState(false); // the on-canvas Concierge dock
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  // The idea/pitch is the creative seed every agent uses, so it lives in the
  // header as an always-visible, click-to-edit pill (not buried in settings).
  const [ideaEditOpen, setIdeaEditOpen] = useState(false);
  const [ideaDraft, setIdeaDraft] = useState('');

  const makeScratch = useCallback(() => emptyProject({
    id: randomId(),
    title: 'Untitled (scratch)',
    language: formValues.language || 'en',
    targetMinutes: formValues.targetMinutes || 4,
    idea: formValues.idea || '',
  }), [formValues.language, formValues.targetMinutes, formValues.idea]);

  // Create the scratch project on the client only (avoids SSR/CSR hydration
  // mismatch from random id + timestamps). The canvas appears immediately.
  useEffect(() => {
    setProject((prev) => prev || makeScratch());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    setProject(makeScratch());
    setStorage(null);
    setDisplayPath('');
    setLastSavedAt(null);
    Message.info('New scratch canvas');
  };

  const patchProject = (patch) => setProject((prev) => ({ ...prev, ...patch }));

  // The Concierge now lives ON the canvas as a dock (ConciergeDock in FilmCanvas):
  // the board IS the brand kit, so framing/classify/gaps/generate all happen there.
  // This header just toggles the dock's visibility.

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
            <Text type="secondary" style={{ fontSize: 12 }}>
              Your idea / pitch now lives in the header — click the <b>idea</b> pill next to the title to edit it.
            </Text>
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
            <Tag>{project.language}</Tag>
            {/* The film's length is the Timeline's budget (default 15s), not the
                legacy targetMinutes — show that so the header matches the timeline. */}
            <Tag color="purple">{project.timeline?.targetSeconds ?? 15}s</Tag>
            {isScratch
              ? <Tag color="orange">Scratch — unsaved</Tag>
              : <Tag color="green">Saved</Tag>}
            <Popover
              trigger="click"
              popupVisible={ideaEditOpen}
              onVisibleChange={(v) => { if (v) setIdeaDraft(project.idea || ''); setIdeaEditOpen(v); }}
              content={(
                <div style={{ width: 320 }}>
                  <Text style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Idea / pitch</Text>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    The creative seed every agent builds from.
                  </Text>
                  <Input.TextArea
                    autoFocus
                    value={ideaDraft}
                    onChange={setIdeaDraft}
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    placeholder="What's your film about?"
                  />
                  <div style={{ textAlign: 'right', marginTop: 8 }}>
                    <Space>
                      <Button size="small" onClick={() => setIdeaEditOpen(false)}>Cancel</Button>
                      <Button size="small" type="primary" onClick={() => { patchProject({ idea: ideaDraft.trim() }); setIdeaEditOpen(false); }}>Save</Button>
                    </Space>
                  </div>
                </div>
              )}
            >
              <Tag
                icon={<IconBulb />}
                color={project.idea?.trim() ? 'arcoblue' : 'orange'}
                style={{ cursor: 'pointer', maxWidth: 340 }}
              >
                <span style={{ display: 'inline-block', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>
                  {project.idea?.trim() ? project.idea.trim() : 'Add your idea'}
                </span>
              </Tag>
            </Popover>
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
              ? 'In-memory — not persisted'
              : saving ? 'Saving…' : lastSavedAt ? `Saved ${lastSavedAt.toLocaleTimeString()}` : 'Auto-save on'}
          </Text>
          {isScratch && (
            <Button type="primary" size="small" icon={<IconFolderAdd />} loading={saving} onClick={handleSaveToFolder}>
              Save to folder…
            </Button>
          )}
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
        onUpdateProject={setProject}
        conciergeOpen={conciergeOpen}
        onOpenConcierge={() => setConciergeOpen(true)}
        onCloseConcierge={() => setConciergeOpen(false)}
      />

      {!isScratch ? null : (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
          This is a scratch canvas — work lives in memory and is lost on refresh. Click <b>Save to folder…</b> to persist it; after that everything auto-saves.
        </Text>
      )}

      {dialogs}
    </div>
  );
};

export default FilmAgentPlayground;
