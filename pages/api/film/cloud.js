import { getServerTosConfig, hasServerTosConfig, putTosObject, downloadTosObject, listTosObjects, headTosObject } from '../../../utils/server/tosUpload';
import { CLOUD_MEDIA_PREFIX, checkInBytes, mediaFilePath, mediaFileExists, mirrorKeyToTos, clearUnmirrored } from '../../../utils/server/mediaStore';
import fs from 'fs';

// CLOUD PROJECT STORE — save/list/load whole film projects against the user's own TOS
// bucket. The bytes are (normally) ALREADY up: the media route mirrors every check-in
// to projects/media/<sha256>.<ext> as it happens, so SAVE is mostly writing the
// MANIFEST — projects/<id>/project.json = the full project JSON + the media key set.
// Rules that make restores expiry-proof:
//   • the manifest stores OBJECT KEYS only — never a signed url (those cap at 7 days);
//   • inline data: blobs are checked into the store and the field rewritten to the
//     stable store url (manifests stay small, bytes become content-addressed);
//   • a node whose only display source is a dying remote url gets a RESCUE attempt
//     (fetch while alive → check in → cacheUrl added in the manifest copy);
//   • anything unrecoverable is REPORTED BY NAME in the response — never silent.
// LOAD returns the manifest project untouched: the read-through media route makes
// every cacheUrl resolve on any machine, streaming from TOS on first paint.

export const config = {
  api: { bodyParser: { sizeLimit: '60mb' }, responseLimit: false },
};

const MANIFEST_VERSION = 1;
const PROJECTS_PREFIX = 'projects';
const STORE_URL_RE = /\/api\/film\/media\?key=([a-f0-9]{16,64}\.[a-z0-9]{1,5})/g;

const sanitizeId = (id) => String(id || '').replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 80);
const manifestKey = (id) => `${PROJECTS_PREFIX}/${id}/project.json`;

// Every media-store key referenced anywhere in the project — one regex pass over the
// serialized JSON, so NEW fields are covered automatically (no hand-maintained list).
const collectStoreKeys = (json) => {
  const keys = new Set();
  let m;
  STORE_URL_RE.lastIndex = 0;
  while ((m = STORE_URL_RE.exec(json)) !== null) keys.add(m[1]);
  return keys;
};

// Deep-walk that REWRITES rescue-able strings in a cloned project:
//   data: blobs → checked in → store url. Returns the count rewritten.
const rescueDataUrls = async (obj) => {
  let rescued = 0;
  const walk = async (node) => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        const v = node[i];
        if (typeof v === 'string' && v.startsWith('data:') && v.length > 2048) {
          const parsed = parseDataUrlSafe(v);
          if (parsed) { const { url } = await checkInBytes(parsed.buffer, parsed.contentType); node[i] = url; rescued += 1; }
        } else if (v && typeof v === 'object') await walk(v);
      }
      return;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string' && v.startsWith('data:') && v.length > 2048) {
        const parsed = parseDataUrlSafe(v);
        if (parsed) { const { url } = await checkInBytes(parsed.buffer, parsed.contentType); node[k] = url; rescued += 1; }
      } else if (v && typeof v === 'object') await walk(v);
    }
  };
  await walk(obj);
  return rescued;
};

const parseDataUrlSafe = (value) => {
  const semi = value.indexOf(';');
  const comma = value.indexOf(',');
  if (semi === -1 || comma === -1 || value.slice(semi + 1, comma) !== 'base64') return null;
  try { return { contentType: value.slice(5, semi), buffer: Buffer.from(value.slice(comma + 1), 'base64') }; } catch { return null; }
};

// A board node with NO store-backed display source and a still-alive remote url gets a
// last-chance rescue: fetch → check in → stamp cacheUrl in the MANIFEST copy. Nodes
// where nothing is recoverable are returned as { label, kind } for the honest report.
const rescueNakedNodes = async (project) => {
  const nodes = project?.canvas?.nodes || [];
  const missing = [];
  for (const n of nodes) {
    const d = n?.data;
    if (!d || !['image', 'video', 'audio'].includes(d.kind)) continue;
    // Store-backed already? Then its key is in the collected set and the ensure step
    // verifies/uploads/reports it — nothing to rescue here.
    const hasStore = /\/api\/film\/media\?key=/.test(String(d.cacheUrl || '')) || /\/api\/film\/media\?key=/.test(String(d.url || ''));
    if (hasStore) continue;
    const remote = typeof d.url === 'string' && /^https?:\/\//.test(d.url) ? d.url : null;
    if (remote) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(new Error('timeout')), 60000);
        try {
          const resp = await fetch(remote, { signal: ctrl.signal });
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            const { url } = await checkInBytes(buf, resp.headers.get('content-type') || '');
            d.cacheUrl = url; // manifest copy only — restore gets a working display source
            continue;
          }
        } finally { clearTimeout(timer); }
      } catch { /* fall through to missing */ }
    }
    missing.push({ label: d.label || n.id, kind: d.kind });
  }
  return missing;
};

// Make sure every referenced key is actually IN TOS (the mirror normally did this at
// generation; this is the reconciler that ensures completeness before the manifest
// claims it). Local-only keys upload now; keys with no bytes anywhere are reported.
const ensureKeysMirrored = async (keys, cfg) => {
  const uploaded = [];
  const lost = [];
  const list = [...keys];
  const CONC = 6;
  for (let i = 0; i < list.length; i += CONC) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(list.slice(i, i + CONC).map(async (key) => {
      const head = await headTosObject({ ...cfg, objectKey: `${CLOUD_MEDIA_PREFIX}/${key}` }).catch(() => ({ exists: false }));
      if (head.exists) { clearUnmirrored(key); return; }
      if (!mediaFileExists(key)) { lost.push(key); return; }
      await mirrorKeyToTos(key, fs.readFileSync(mediaFilePath(key)));
      clearUnmirrored(key);
      uploaded.push(key);
    }));
  }
  return { uploaded, lost };
};

export default async function cloudHandler(req, res) {
  const cfg = getServerTosConfig();
  if (!hasServerTosConfig(cfg)) return res.status(500).json({ error: 'TOS is not configured (MODELARK_ASSET_* / MODELARK_TOS_BUCKET in .env.local)' });

  try {
    if (req.method === 'POST') {
      const { project } = req.body || {};
      const id = sanitizeId(project?.id);
      if (!project || !id) return res.status(400).json({ error: 'a project with an id is required' });

      // An EMPTY canvas must never clobber a real save: a desynced client (the exact
      // failure that produced an empty "Glass Horizon" manifest over a full board) or
      // a fresh scratch saving by accident keeps the existing manifest intact.
      const incomingNodes = (project?.canvas?.nodes || []).length;
      if (!incomingNodes) {
        const existing = await headTosObject({ ...cfg, objectKey: manifestKey(sanitizeId(project?.id)) }).catch(() => ({ exists: false }));
        if (existing.exists) return res.status(409).json({ error: 'Refusing to overwrite a cloud save with an EMPTY board — open the cloud copy instead, or use a new project id.' });
      }

      // Work on a CLONE — rescues rewrite fields in the manifest, never the live board.
      const copy = JSON.parse(JSON.stringify(project));
      const rescuedInline = await rescueDataUrls(copy);
      const missingNodes = await rescueNakedNodes(copy);
      const keys = collectStoreKeys(JSON.stringify(copy));
      const { uploaded, lost } = await ensureKeysMirrored(keys, cfg);

      // Keep the previous manifest as a one-step undo before overwriting.
      const mKey = manifestKey(id);
      try {
        const prev = await downloadTosObject({ ...cfg, objectKey: mKey });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await putTosObject({ ...cfg, objectKey: `${PROJECTS_PREFIX}/${id}/history/project-${stamp}.json`, buffer: prev.buffer, contentType: 'application/json', overwrite: true });
      } catch { /* first save — nothing to keep */ }

      const manifest = {
        version: MANIFEST_VERSION,
        projectId: id,
        name: project.name || project.title || 'Untitled film',
        savedAt: new Date().toISOString(),
        media: [...keys],
        project: copy,
      };
      const buf = Buffer.from(JSON.stringify(manifest));
      await putTosObject({ ...cfg, objectKey: mKey, buffer: buf, contentType: 'application/json', overwrite: true });

      return res.status(200).json({
        ok: true,
        projectId: id,
        mediaCount: keys.size,
        uploadedNow: uploaded.length,
        rescuedInline,
        manifestBytes: buf.length,
        // Honest report: assets whose bytes exist NOWHERE (expired before any check-in).
        missing: [...missingNodes.map((m) => m.label), ...lost],
      });
    }

    if (req.method === 'GET') {
      const action = String(req.query.action || 'list');

      if (action === 'list') {
        const objects = await listTosObjects({ ...cfg, prefix: `${PROJECTS_PREFIX}/`, maxKeys: 2000 });
        const manifests = objects.filter((o) => /^projects\/[^/]+\/project\.json$/.test(o.key));
        const items = [];
        for (const m of manifests) {
          // eslint-disable-next-line no-await-in-loop
          try {
            const { buffer } = await downloadTosObject({ ...cfg, objectKey: m.key });
            const j = JSON.parse(buffer.toString('utf8'));
            items.push({ projectId: j.projectId, name: j.name, savedAt: j.savedAt, mediaCount: (j.media || []).length });
          } catch { /* skip unreadable manifest */ }
        }
        items.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
        return res.status(200).json({ items });
      }

      if (action === 'load') {
        const id = sanitizeId(req.query.id);
        if (!id) return res.status(400).json({ error: 'id is required' });
        const { buffer } = await downloadTosObject({ ...cfg, objectKey: manifestKey(id) }).catch((e) => {
          throw Object.assign(new Error(e?.statusCode === 404 ? 'No cloud save found for this project' : `manifest fetch failed: ${e.message}`), { statusCode: e?.statusCode === 404 ? 404 : 502 });
        });
        const manifest = JSON.parse(buffer.toString('utf8'));
        return res.status(200).json({ project: manifest.project, media: manifest.media || [], savedAt: manifest.savedAt, name: manifest.name });
      }

      return res.status(400).json({ error: `unknown action '${action}'` });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    const status = error?.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}
