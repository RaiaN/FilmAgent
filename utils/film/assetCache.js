// Client helper for the beside-the-project local asset cache (/api/film/asset).
// Fetches a generated asset's bytes into the project's own assets/ folder and returns a
// stable same-origin URL for display, so the canvas survives the remote URL's expiry.
// Best-effort: returns null on any failure (the board falls back to the remote url).

export const cacheAssetLocal = async ({ id, url }) => {
  if (!id || !url) return null;
  try {
    const res = await fetch('/api/film/asset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, url }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.url || null;
  } catch {
    return null;
  }
};
