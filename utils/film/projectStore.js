import {
  hasDirectoryPicker,
  pickDirectoryHandle,
  initProjectInHandle,
  loadProjectFromHandle,
  saveProjectToHandle,
} from './browserProjectStore';

const API_ROOT = '/api/film/project';

const post = async (action, body) => {
  const response = await fetch(`${API_ROOT}?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.error || `project ${action} failed`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
};

export const listRecent = async () => {
  const response = await fetch(`${API_ROOT}?action=recent`);
  if (!response.ok) return [];
  const data = await response.json();
  return data?.recent || [];
};

export const initProject = async ({ projectPath, title, language, targetMinutes, idea }) =>
  post('init', { projectPath, title, language, targetMinutes, idea });

export const loadProject = async ({ projectPath }) => post('load', { projectPath });

export const saveProject = async ({ projectPath, project }) => post('save', { projectPath, project });

export const isElectron = () => typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

export const hasBrowserDirectoryPicker = hasDirectoryPicker;

// Source of truth for which storage backend to use:
//   { source: 'electron', path: '...' | '' }   Electron native dialog
//   { source: 'handle', handle, name }         Browser File System Access API
//   { source: 'browser' }                      Fallback — caller should open in-app path modal
export const pickProjectFolder = async ({ mode = 'open' } = {}) => {
  if (isElectron()) {
    const result = await window.electronAPI.pickFolder({ mode });
    return { source: 'electron', path: result?.path || '' };
  }
  if (hasDirectoryPicker()) {
    const handle = await pickDirectoryHandle();
    if (!handle) return { source: 'handle', handle: null, name: '' };
    return { source: 'handle', handle, name: handle.name };
  }
  return { source: 'browser' };
};

// Unified storage API: caller passes a `storage` object describing the backend.
//   For path-based:  { kind: 'path', path: '/abs/path' }
//   For handle-based: { kind: 'handle', handle: FileSystemDirectoryHandle }

export const initProjectAny = async (storage, projectMeta) => {
  if (storage.kind === 'handle') {
    const { project, handleName } = await initProjectInHandle({
      handle: storage.handle,
      ...projectMeta,
    });
    return { project, displayPath: handleName };
  }
  const { project, projectPath } = await initProject({
    projectPath: storage.path,
    ...projectMeta,
  });
  return { project, displayPath: projectPath };
};

export const loadProjectAny = async (storage) => {
  if (storage.kind === 'handle') {
    const { project, handleName } = await loadProjectFromHandle({ handle: storage.handle });
    return { project, displayPath: handleName };
  }
  const { project, projectPath } = await loadProject({ projectPath: storage.path });
  return { project, displayPath: projectPath };
};

export const saveProjectAny = async (storage, project) => {
  if (storage.kind === 'handle') {
    const { project: saved } = await saveProjectToHandle({ handle: storage.handle, project });
    return { project: saved };
  }
  return saveProject({ projectPath: storage.path, project });
};

