// Canvas data helpers for the freeform Project Workspace.
// Asset nodes are simple cards (no input/output pins, no wires by default).

export const ASSET_KINDS = ['image', 'video', 'audio', 'text'];

const randomId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
};

export const createAssetNode = ({
  id,
  kind = 'image',
  url = '',
  text = '',
  label = '',
  position = { x: 0, y: 0 },
  locked = false,
  layerId = null,
  sourceRefs = [],
  meta = {},
  preserved = false,
} = {}) => ({
  // A caller-supplied id enables idempotent reconciliation (e.g. the Auto Director
  // upserts one node per step, keyed by step id); otherwise a fresh random id.
  id: id || `a-${randomId()}`,
  type: 'asset',
  position,
  data: { kind, url, text, label, locked, layerId, sourceRefs, meta, preserved, createdAt: Date.now() },
});

// Stage a locally-dropped data URL into TOS and catalogue it in the Assets
// library. Returns { url (stable TOS), assetId | null }. The assetId is the
// trusted asset:// reference for Seedance / Animate; Seedream image refs use the
// local base64 directly (see refUrl in agents.js), so they don't need the URL.
export const stageLocalAsset = async (dataUrl, name) => {
  const response = await fetch('/api/film/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, name }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.details || data?.error || `Upload failed (HTTP ${response.status})`);
  }
  return { url: data.url, assetId: data.assetId || null };
};

// Downscale a (potentially huge) image data URL to a small JPEG data URL for the
// Library grid + persisted index. Uploaded files' TOS URLs aren't publicly
// fetchable, so the Library can't load them; an embedded ~15KB thumbnail always
// renders. Falls back to the original on any failure / non-browser context.
export const makeThumbnail = (dataUrl, max = 256) =>
  new Promise((resolve) => {
    if (typeof document === 'undefined' || !dataUrl) return resolve(dataUrl);
    try {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
        const w = Math.max(1, Math.round((img.width || max) * scale));
        const h = Math.max(1, Math.round((img.height || max) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        } catch {
          resolve(dataUrl); // tainted canvas / unsupported — keep original
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });

// Re-host a (still-valid) expiring asset URL into the user's TOS bucket and
// catalogue it in the Assets library. Returns { url (stable), assetId | null,
// objectKey } — the objectKey is what makes the asset re-signable forever.
export const preserveAsset = async (url, name) => {
  const response = await fetch('/api/film/preserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, name }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.details || data?.error || `Preserve failed (HTTP ${response.status})`);
  }
  return { url: data.url, assetId: data.assetId || null, objectKey: data.objectKey || null };
};

// Fresh signed link for a preserved asset whose stored url stopped loading
// (private bucket, or a lapsed presign). The bytes never moved — only the link.
export const resignAsset = async ({ url, objectKey }) => {
  const response = await fetch('/api/film/resign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, objectKey }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.details || data?.error || `Re-sign failed (HTTP ${response.status})`);
  }
  return { url: data.url, objectKey: data.objectKey || null };
};

// Axis-aligned rectangle overlap, with an optional gap treated as a margin
// around each rect (so blocks land with breathing room, not edge-to-edge).
export const rectsOverlap = (a, b, gap = 0) =>
  a.x < b.x + b.w + gap &&
  a.x + a.w + gap > b.x &&
  a.y < b.y + b.h + gap &&
  a.y + a.h + gap > b.y;

// Find an origin where a w×h block clears every existing rect. Scans straight
// down from the preferred point (one block-height per step) so a new batch
// stacks into open space below instead of piling onto the same spot — the
// recurring cause of overlapping cards/plates. Falls back to "far below" if the
// board is somehow full for maxRows steps.
export const findFreeOrigin = ({ rects = [], w, h, preferred = { x: 80, y: 80 }, gap = 56, maxRows = 400 }) => {
  const dy = h + gap;
  for (let r = 0; r < maxRows; r += 1) {
    const cand = { x: preferred.x, y: preferred.y + r * dy, w, h };
    if (!rects.some((rect) => rectsOverlap(cand, rect, gap))) return { x: cand.x, y: cand.y };
  }
  return { x: preferred.x, y: preferred.y + maxRows * dy };
};

// Find a sensible origin for new assets: just below/right of the current selection,
// or at the viewport-projected center the caller supplies.
export const originFromSelection = (selectedNodes, fallback = { x: 120, y: 120 }) => {
  if (!selectedNodes || selectedNodes.length === 0) return fallback;
  const maxY = Math.max(...selectedNodes.map((n) => n.position.y + (n.height || 240)));
  const minX = Math.min(...selectedNodes.map((n) => n.position.x));
  return { x: minX, y: maxY + 60 };
};

export const fileToAssetKind = (file) => {
  const t = file.type || '';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  return 'text';
};

export const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// A titled frame node that groups one agent run's outputs.
export const createGroupNode = ({ layerId = null, label = '', position = { x: 0, y: 0 }, width = 280, height = 200 } = {}) => ({
  id: `g-${randomId()}`,
  type: 'group',
  position,
  style: { width, height },
  data: { label, layerId },
});

// Strip non-serializable React Flow runtime fields before persisting.
// Keeps grouping fields (parentId / extent / style) so groups survive reload.
// Parents are emitted before their children — React Flow requires that ordering.
export const serializeNodes = (nodes) => {
  const list = nodes || [];
  const parentless = list.filter((n) => !n.parentId);
  const children = list.filter((n) => n.parentId);
  return [...parentless, ...children].map((n) => {
    // Drop transient/heavy fields so project.json stays lean:
    // localUrl is a huge base64 thumbnail; loading/preserving are in-flight flags.
    const { localUrl, loading, preserving, ...persistData } = n.data || {};
    return {
      id: n.id,
      type: n.type,
      position: n.position,
      data: persistData,
      ...(n.parentId ? { parentId: n.parentId } : {}),
      ...(n.extent ? { extent: n.extent } : {}),
      ...(n.style ? { style: n.style } : {}),
    };
  });
};
