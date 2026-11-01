// Client helpers for the persistent checked-in asset library.

const API = '/api/film/library';

// With a project: only what belongs to it (see libraryMatch.js).
const scope = (project) => (project ? `project=${encodeURIComponent(project)}` : '');

export const listLibrary = async (project = null, { withFilm = false } = {}) => {
  try {
    const res = await fetch(project ? `${API}?${scope(project)}${withFilm ? '&film=1' : ''}` : API);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.items || [];
  } catch {
    return [];
  }
};

export const addToLibrary = async (entry) => {
  const res = await fetch(`${API}?action=add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Could not add to library');
  return data.items || [];
};

// List-only: forget the entry, keep the underlying asset in storage.
export const removeFromLibrary = async ({ id, url, project = null }) => {
  const res = await fetch(`${API}?action=remove&${scope(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, url }),
  });
  const data = await res.json();
  return data.items || [];
};

// Permanent: delete the TOS object + Assets-API asset, then drop the entry.
// Returns { items, report }. Irreversible — callers must confirm first.
export const deleteFromLibrary = async ({ id, url, assetId, project = null }) => {
  const res = await fetch(`${API}?action=delete&${scope(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, url, assetId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Delete failed');
  return { items: data.items || [], report: data.report || {} };
};

// Permanent: wipe a project's part of the library, or with no project all of it — best-effort delete
// of each asset's storage, then drop them from the index. Returns { items: [], report: { cleared, failed } }.
// Confirm first.
export const clearLibrary = async (project = null) => {
  const res = await fetch(`${API}?action=clear&${scope(project)}`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Clear failed');
  return { items: data.items || [], report: data.report || {} };
};

export const ASSET_DRAG_TYPE = 'application/film-asset';
// A board AssetNode dragged by its grip (e.g. onto the Story Director timeline).
export const BOARD_NODE_DRAG_TYPE = 'application/film-board-node';
