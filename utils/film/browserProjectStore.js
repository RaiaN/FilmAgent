// Client-side project store backed by the File System Access API
// (window.showDirectoryPicker + FileSystemDirectoryHandle).
// Used when running in a browser that supports the API (Chrome, Edge, Brave, etc.).

import { emptyProject } from './projectShape';

const PROJECT_FILENAME = 'project.json';
const ASSETS_DIRNAME = 'assets';

export const hasDirectoryPicker = () =>
  typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

export const pickDirectoryHandle = async () => {
  if (!hasDirectoryPicker()) return null;
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    return handle;
  } catch (err) {
    // AbortError = user cancelled, treat as no-op
    if (err?.name === 'AbortError') return null;
    throw err;
  }
};

export const verifyHandlePermission = async (handle, mode = 'readwrite') => {
  if (!handle?.queryPermission) return true; // older spec or weird host, hope for the best
  const opts = { mode };
  let perm = await handle.queryPermission(opts);
  if (perm === 'granted') return true;
  perm = await handle.requestPermission(opts);
  return perm === 'granted';
};

const readJsonFile = async (dirHandle, filename) => {
  try {
    const fileHandle = await dirHandle.getFileHandle(filename);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch (err) {
    if (err?.name === 'NotFoundError') return null;
    throw err;
  }
};

const writeJsonFile = async (dirHandle, filename, value) => {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(value, null, 2));
  await writable.close();
};

const randomId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
};

export const initProjectInHandle = async ({ handle, title, language, targetMinutes, idea }) => {
  const ok = await verifyHandlePermission(handle, 'readwrite');
  if (!ok) throw new Error('Write permission denied for selected folder');
  const existing = await readJsonFile(handle, PROJECT_FILENAME);
  if (existing) {
    throw new Error('A project already exists in this folder. Use "Open existing" instead.');
  }
  // Ensure assets/ subdirectory exists
  await handle.getDirectoryHandle(ASSETS_DIRNAME, { create: true });
  const project = emptyProject({
    id: randomId(),
    title,
    language,
    targetMinutes,
    idea,
  });
  await writeJsonFile(handle, PROJECT_FILENAME, project);
  return { project, handleName: handle.name };
};

export const loadProjectFromHandle = async ({ handle }) => {
  const ok = await verifyHandlePermission(handle, 'readwrite');
  if (!ok) throw new Error('Permission denied for selected folder');
  const loaded = await readJsonFile(handle, PROJECT_FILENAME);
  if (!loaded) throw new Error('No project.json found in this folder');
  return { project: loaded, handleName: handle.name };
};

export const saveProjectToHandle = async ({ handle, project }) => {
  const ok = await verifyHandlePermission(handle, 'readwrite');
  if (!ok) throw new Error('Write permission denied for selected folder');
  const next = { ...project, updatedAt: new Date().toISOString() };
  await writeJsonFile(handle, PROJECT_FILENAME, next);
  return { project: next, handleName: handle.name };
};
