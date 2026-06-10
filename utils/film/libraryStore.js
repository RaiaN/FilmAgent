// Client helpers for the persistent checked-in asset library.

const API = '/api/film/library';

export const listLibrary = async () => {
  try {
    const res = await fetch(API);
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

export const removeFromLibrary = async ({ id, url }) => {
  const res = await fetch(`${API}?action=remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, url }),
  });
  const data = await res.json();
  return data.items || [];
};

export const ASSET_DRAG_TYPE = 'application/film-asset';
// A board AssetNode dragged by its grip (e.g. onto the Story Director timeline).
export const BOARD_NODE_DRAG_TYPE = 'application/film-board-node';
