// Save a media url to disk: blob-fetch (same-origin cache / data: / CORS-permitting
// remotes) → anchor download; a blocked cross-origin fetch falls back to a new tab so
// the user can still save manually. Same contract as AssetNode's board button — this
// shared helper serves the surfaces where the node itself is hidden (Take Library,
// Take Viewer).
export const downloadMedia = async (src, name = 'asset', fallbackExt = 'mp4') => {
  if (!src) return;
  const base = String(name).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 48) || 'asset';
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const ext = ((blob.type.split('/')[1] || '').split(';')[0]) || fallbackExt;
    const obj = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = obj; a.download = `${base}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 2000);
  } catch {
    window.open(src, '_blank', 'noopener');
  }
};
