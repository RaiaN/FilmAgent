import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getServerTosConfig, hasServerTosConfig, putTosObject, downloadTosObject } from '../../../utils/server/tosUpload';

// CLOUD-FIRST content-addressed media store — the durability layer for EVERY board asset
// (generated plates, keyframes, previz/mask frames, arrow bakes, uploads, takes, clips).
// Generated media rides EXPIRING signed URLs (Ark signs Seedream/Seedance outputs for
// 24h); check-in fetches the bytes ONCE and:
//   • MIRRORS them to TOS at projects/media/<sha256>.<ext> — the SOURCE OF TRUTH
//     (bucket-wide dedupe; survives machines, reinstalls, everything), and
//   • writes ~/.modelark-starter-kit/media/<sha256>.<ext> — a local READ-THROUGH CACHE
//     (instant re-opens, offline hits).
// GET serves from disk, else streams from TOS and backfills the disk on the way through.
// The stable same-origin url + immutable cache header make the BROWSER's cache the
// memory tier for previews. The TOS mirror is best-effort: a cloud hiccup never blocks
// check-in — the failed key lands in .unmirrored.json and the cloud-save reconciler
// tops it up.
//
// This store needs NO project registration: identical for scratch projects, browser-
// folder (FileSystem-handle) projects, and path-registered projects. This is DISPLAY
// persistence; model paths keep using remote URLs / asset ids (the canvas absolutizes
// a store url when a server needs to fetch it).

const MEDIA_DIR = path.join(os.homedir(), '.modelark-starter-kit', 'media');
const UNMIRRORED_FILE = path.join(MEDIA_DIR, '.unmirrored.json');
export const CLOUD_MEDIA_PREFIX = 'projects/media';

const EXT_BY_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav' };
const TYPE_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav' };

const KEY_RE = /^[a-f0-9]{16,64}\.[a-z0-9]{1,5}$/i; // hash.ext only — nothing path-shaped

// ---- unmirrored ledger (keys whose TOS mirror failed; reconciled at cloud-save) ----
const readUnmirrored = () => {
  try { const v = JSON.parse(fs.readFileSync(UNMIRRORED_FILE, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; }
};
const writeUnmirrored = (keys) => {
  try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); fs.writeFileSync(UNMIRRORED_FILE, JSON.stringify([...new Set(keys)])); } catch { /* ledger is best-effort */ }
};
export const markUnmirrored = (key) => writeUnmirrored([...readUnmirrored(), key]);
export const clearUnmirrored = (key) => writeUnmirrored(readUnmirrored().filter((k) => k !== key));
export const listUnmirrored = () => readUnmirrored();

// Mirror one store file to TOS (content-addressed key; no-op when already up).
export const mirrorKeyToTos = async (key, buf) => {
  const cfg = getServerTosConfig();
  if (!hasServerTosConfig(cfg)) return { mirrored: false, reason: 'TOS not configured' };
  const bytes = buf || fs.readFileSync(path.join(MEDIA_DIR, key));
  const ext = key.split('.').pop().toLowerCase();
  await putTosObject({ ...cfg, objectKey: `${CLOUD_MEDIA_PREFIX}/${key}`, buffer: bytes, contentType: TYPE_BY_EXT[ext] || 'application/octet-stream' });
  return { mirrored: true };
};

// Check BYTES into the two-tier store (local file + TOS mirror) and return the stable
// store url — the same operation the POST handler performs, importable by other routes
// (cloud-save uses it to rescue inline data: blobs and dying remote urls).
export const checkInBytes = async (buf, contentType = '') => {
  const ctype = String(contentType || '').split(';')[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[ctype] || 'bin';
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
  const key = `${hash}.${ext}`;
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const file = path.join(MEDIA_DIR, key);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  try { const m = await mirrorKeyToTos(key, buf); if (m.mirrored) clearUnmirrored(key); else markUnmirrored(key); }
  catch { markUnmirrored(key); }
  return { key, url: `/api/film/media?key=${encodeURIComponent(key)}` };
};

export const mediaFilePath = (key) => path.join(MEDIA_DIR, key);
export const mediaFileExists = (key) => fs.existsSync(path.join(MEDIA_DIR, key));

// Extract a store key from ANY store-url shape (relative `/api/film/media?key=…` or an
// absolutized `http://host/api/film/media?key=…`). Null for non-store urls.
export const storeKeyFromUrl = (url) => {
  const m = /\/api\/film\/media\?key=([a-f0-9]{16,64}\.[a-z0-9]{1,5})\b/.exec(String(url || ''));
  return m ? m[1] : null;
};

// DIRECT in-process read-through (disk, else the TOS mirror + backfill) — the same
// logic as the GET route, importable so sibling routes NEVER fetch http://<self>
// again (self-HTTP breaks behind https load balancers; a function call cannot).
export const readStoreBytes = async (key) => {
  if (!KEY_RE.test(String(key || ''))) throw new Error('bad store key');
  const file = path.resolve(MEDIA_DIR, key);
  if (!file.startsWith(MEDIA_DIR + path.sep)) throw new Error('bad store key');
  if (!fs.existsSync(file)) {
    const cfg = getServerTosConfig();
    if (!hasServerTosConfig(cfg)) throw new Error('media not in the store (and no TOS mirror configured)');
    const { buffer } = await downloadTosObject({ ...cfg, objectKey: `${CLOUD_MEDIA_PREFIX}/${key}` });
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    fs.writeFileSync(file, buffer);
  }
  const ext = key.split('.').pop().toLowerCase();
  return { buffer: fs.readFileSync(file), contentType: TYPE_BY_EXT[ext] || 'application/octet-stream' };
};

export const config = {
  api: {
    bodyParser: { sizeLimit: '60mb' }, // remote urls are tiny, but a `data:` url (a base64 frame) IS the bytes
    responseLimit: false, // GET streams full-size images/videos
  },
};

export default async function mediaHandler(req, res) {
  try {
    if (req.method === 'GET') {
      const key = String(req.query.key || '');
      if (!KEY_RE.test(key)) return res.status(400).json({ error: 'bad key' });
      const file = path.resolve(MEDIA_DIR, key);
      if (!file.startsWith(MEDIA_DIR + path.sep)) return res.status(400).json({ error: 'bad key' });
      const ext = key.split('.').pop().toLowerCase();
      if (!fs.existsSync(file)) {
        // READ-THROUGH: not on this disk → pull from the TOS mirror, backfill, serve.
        // This is what makes a cloud-loaded project's cacheUrls resolve verbatim on a
        // machine that has never seen the bytes.
        const cfg = getServerTosConfig();
        if (!hasServerTosConfig(cfg)) return res.status(404).json({ error: 'not in the store' });
        try {
          const { buffer } = await downloadTosObject({ ...cfg, objectKey: `${CLOUD_MEDIA_PREFIX}/${key}` });
          fs.mkdirSync(MEDIA_DIR, { recursive: true });
          fs.writeFileSync(file, buffer);
        } catch (e) {
          const status = e?.statusCode === 404 ? 404 : 502;
          return res.status(status).json({ error: status === 404 ? 'not in the store or the cloud mirror' : `cloud mirror fetch failed: ${e.message}` });
        }
      }
      res.setHeader('Content-Type', TYPE_BY_EXT[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // content-hashed → never changes
      fs.createReadStream(file).pipe(res);
      return undefined;
    }

    if (req.method === 'POST') {
      const { url } = req.body || {};
      // A remote http(s) url OR a `data:` url (an inline base64 frame) — Node's fetch
      // decodes both. Checking in a data: url turns megabytes of inline base64 into a file.
      if (!url || !/^(https?:\/\/|data:)/.test(String(url))) return res.status(400).json({ error: 'an http(s) or data: url is required' });

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(new Error('source fetch timed out')), 120000); // takes can be tens of MB
      let buf;
      let ctype;
      try {
        const resp = await fetch(String(url), { signal: ctrl.signal });
        if (!resp.ok) return res.status(502).json({ error: `source fetch failed (${resp.status})` });
        buf = Buffer.from(await resp.arrayBuffer());
        ctype = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      } finally {
        clearTimeout(timer);
      }
      if (!buf || !buf.length) return res.status(502).json({ error: 'source returned no bytes' });

      const urlExt = (String(url).split('?')[0].split('.').pop() || '').toLowerCase();
      const ext = EXT_BY_TYPE[ctype] || (/^[a-z0-9]{2,4}$/.test(urlExt) ? urlExt : 'bin');
      const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
      const key = `${hash}.${ext}`;

      fs.mkdirSync(MEDIA_DIR, { recursive: true });
      const file = path.join(MEDIA_DIR, key);
      if (!fs.existsSync(file)) fs.writeFileSync(file, buf); // content-hashed → write once, dedupes

      // MIRROR to TOS — the source of truth. Best-effort: a failure never blocks the
      // check-in (the board keeps working off the local file); the key goes on the
      // unmirrored ledger and the cloud-save reconciler retries it.
      let mirrored = false;
      try {
        const m = await mirrorKeyToTos(key, buf);
        mirrored = m.mirrored;
        if (mirrored) clearUnmirrored(key);
        else markUnmirrored(key);
      } catch (e) {
        markUnmirrored(key);
        console.warn(`[film/media] TOS mirror failed for ${key} — queued for reconcile: ${e.message}`);
      }

      return res.status(200).json({ key, url: `/api/film/media?key=${encodeURIComponent(key)}`, mirrored });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
