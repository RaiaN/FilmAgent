import { useCallback, useEffect, useState } from 'react';
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
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);

  const makeScratch = useCallback(() => emptyProject({
    id: randomId(),
    title: 'Untitled (scratch)',
    language: formValues.language || 'en',
    targetMinutes: formValues.targetMinutes || 4,
  }), [formValues.language, formValues.targetMinutes]);

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
