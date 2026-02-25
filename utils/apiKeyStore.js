import { apiKeyStorageKey } from './schemas';

let apiKeyInMemory = '';

export const isBundledDesktopApp = () => {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator?.userAgent || '';
  const hasElectronUA = ua.includes('Electron');
  const hasElectronProcess = !!window.process?.versions?.electron;
  return hasElectronUA || hasElectronProcess;
};

export const getApiKey = () => {
  if (apiKeyInMemory) return apiKeyInMemory;
  if (typeof window === 'undefined') return '';
  if (isBundledDesktopApp()) return '';
  try {
    return window.localStorage.getItem(apiKeyStorageKey) || '';
  } catch {
    return '';
  }
};

export const setApiKey = (key) => {
  apiKeyInMemory = (key || '').trim();
  const bundled = isBundledDesktopApp();

  if (typeof window === 'undefined') return { persisted: false, bundled };

  if (bundled) {
    try {
      window.localStorage.removeItem(apiKeyStorageKey);
    } catch {}
    return { persisted: false, bundled };
  }

  try {
    window.localStorage.setItem(apiKeyStorageKey, apiKeyInMemory);
    return { persisted: true, bundled };
  } catch {
    return { persisted: false, bundled };
  }
};

export const clearPersistedApiKey = () => {
  apiKeyInMemory = '';
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(apiKeyStorageKey);
  } catch {}
};

