// Client helper for the GLOBAL local media store (/api/film/media). Checks a
// generated/uploaded asset's bytes into ~/.modelark-starter-kit/media and returns a
// stable same-origin URL for display, so boards survive the remote URL's expiry —
// in EVERY project mode (scratch / browser-folder / path); no project id needed.
// Returns null on failure — the caller (the canvas check-in effect) retries with backoff.

export const cacheAssetLocal = async ({ url }) => {
  if (!url) return null;
  try {
    const res = await fetch('/api/film/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.url || null;
  } catch {
    return null;
  }
};
