import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { deleteTosObject, tosObjectKeyFromUrl } from '../../../utils/server/tosUpload';
import { callAssetApi } from '../../../utils/server/assetApi';
import { belongsTo, filmAssets, usesOf } from '../../../utils/film/libraryMatch';
import { getServerTosConfig, hasServerTosConfig, putTosObject, downloadTosObject } from '../../../utils/server/tosUpload';

// THE LIBRARY: every picture and video added or made, shared across all projects, kept in the cloud.
// The first read brings in what this machine's old index held.
const OLD_LIBRARY_FILE = path.join(os.homedir(), '.modelark-starter-kit', 'film-agent-library.json');
const LIBRARY_KEY = 'library/index.json';

const cfgOrThrow = () => {
  const cfg = getServerTosConfig();
  if (!hasServerTosConfig(cfg)) throw new Error('TOS is not configured (MODELARK_ASSET_* / MODELARK_TOS_BUCKET in .env.local)');
  return cfg;
};
const writeIndex = async (list) => {
  await putTosObject({ ...cfgOrThrow(), objectKey: LIBRARY_KEY, buffer: Buffer.from(JSON.stringify(list)), contentType: 'application/json', overwrite: true });
};
const readIndex = async () => {
  try {
    const { buffer } = await downloadTosObject({ ...cfgOrThrow(), objectKey: LIBRARY_KEY });
    const list = JSON.parse(buffer.toString('utf8'));
    return Array.isArray(list) ? list.filter((it) => it && it.url) : [];
  } catch (e) {
    if (e?.statusCode !== 404) throw e;
  }
  const old = fs.existsSync(OLD_LIBRARY_FILE) ? JSON.parse(fs.readFileSync(OLD_LIBRARY_FILE, 'utf8')) : [];
  const list = Array.isArray(old) ? old.filter((it) => it && it.url) : [];
  await writeIndex(list);
  return list;
};
// One change at a time: two renders finishing together must both land.
const queue = globalThis.filmLibraryQueue || { last: Promise.resolve() };
globalThis.filmLibraryQueue = queue;
const oneAtATime = (work) => {
  const run = queue.last.then(work, work);
  queue.last = run.catch(() => {});
  return run;
};

// Best-effort PERMANENT storage delete for ONE asset (TOS object + Assets-API asset).
// Returns a { tos, asset } report and never throws — a partial failure still reports.
// Shared by the `delete` (one item) and `clear` (whole library) actions.
async function deleteAssetStorage({ url, assetId, objectKey: bodyKey }) {
  const accessKey = process.env.MODELARK_ASSET_ACCESS_KEY;
  const secretKey = process.env.MODELARK_ASSET_SECRET_KEY;
  const tosBucket = process.env.MODELARK_TOS_BUCKET;
  const report = { tos: 'skipped', asset: 'skipped' };

  if (accessKey && secretKey && tosBucket) {
    const objectKey = bodyKey || tosObjectKeyFromUrl(url, {
      tosPublicBaseUrl: process.env.MODELARK_TOS_PUBLIC_BASE_URL,
      tosEndpoint: process.env.MODELARK_TOS_ENDPOINT,
      tosRegion: process.env.MODELARK_TOS_REGION,
      tosBucket,
    });
    if (objectKey) {
      try {
        await deleteTosObject({ accessKey, secretKey, tosBucket, tosRegion: process.env.MODELARK_TOS_REGION, tosEndpoint: process.env.MODELARK_TOS_ENDPOINT, objectKey });
        report.tos = 'deleted';
      } catch (err) {
        report.tos = `failed: ${err.message}`;
      }
    } else {
      report.tos = 'no-key (url not in this bucket)';
    }
  }

  if (assetId && accessKey && secretKey) {
    try {
      await callAssetApi({ action: 'DeleteAsset', payload: { Id: assetId, ProjectName: 'default' }, accessKey, secretKey });
      report.asset = 'deleted';
    } catch (err) {
      report.asset = `failed: ${err.message}`;
    }
  }
  return report;
}

// The Library as one project sees it: only what belongs to it. Without a project, everything.
const scopedTo = async (projectId, items, { withFilm = false } = {}) => {
  if (!projectId) return items;
  let manifest = null;
  try {
    const { buffer } = await downloadTosObject({ ...cfgOrThrow(), objectKey: `projects/${projectId}/project.json` });
    manifest = JSON.parse(buffer.toString('utf8'));
  } catch (e) {
    if (e?.statusCode !== 404) throw e;
  }
  const uses = usesOf(manifest);
  const own = items.filter((it) => belongsTo(it, projectId, uses));
  // To look at, the film's own plates and takes too. They aren't Library entries, so nothing deletes them from here.
  return withFilm ? [...own, ...filmAssets(manifest?.project?.studio, own)] : own;
};

export default async function libraryHandler(req, res) {
  const { action, project: scope } = req.query;
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ items: await scopedTo(scope, await readIndex(), { withFilm: req.query.film === '1' }) });
    }

    if (req.method === 'POST' && action === 'add') {
      const { url, assetId, name, kind = 'image', thumb, project } = req.body || {};
      if (!url) return res.status(400).json({ error: 'url is required' });
      return await oneAtATime(async () => {
      const existing = await readIndex();
      // De-dupe by assetId (preferred) or url; move/refresh to the front.
      const deduped = existing.filter((it) =>
        (assetId ? it.assetId !== assetId : true) && it.url !== url);
      const entry = {
        id: crypto.randomBytes(6).toString('hex'),
        url,
        // Small embedded preview (data URL) for assets whose url isn't publicly
        // fetchable (uploads). Null for generated/checked-in assets that load
        // their url directly.
        thumb: thumb || null,
        assetId: assetId || null,
        name: name || 'Asset',
        kind,
        ...(project ? { project } : {}),
        createdAt: new Date().toISOString(),
      };
      const next = [entry, ...deduped];
      await writeIndex(next);
      return res.status(200).json({ item: entry, items: await scopedTo(project || scope, next) });
      });
    }

    if (req.method === 'POST' && action === 'remove') {
      // List-only: drop the entry; the underlying TOS object + asset are kept.
      const { id, url } = req.body || {};
      const next = await oneAtATime(async () => {
        const list = (await readIndex()).filter((it) => it.id !== id && it.url !== url);
        await writeIndex(list);
        return list;
      });
      return res.status(200).json({ items: await scopedTo(scope, next) });
    }

    if (req.method === 'POST' && action === 'delete') {
      // Permanent: delete the TOS object + the Assets-API asset, THEN drop the
      // index entry. The storage delete is best-effort so a partial failure
      // (e.g. permissions) still removes the entry and reports what happened.
      const { id, url, assetId, objectKey } = req.body || {};
      const report = await deleteAssetStorage({ url, assetId, objectKey });
      const next = await oneAtATime(async () => {
        const list = (await readIndex()).filter((it) => it.id !== id && it.url !== url);
        await writeIndex(list);
        return list;
      });
      return res.status(200).json({ items: await scopedTo(scope, next), report });
    }

    if (req.method === 'POST' && action === 'clear') {
      // Permanent: wipe the library, or with a project only that project's part — best-effort delete
      // each asset's TOS object + Assets-API asset (in parallel; each delete never throws), then drop
      // them from the index, even if some storage deletes fail (those are reported, not fatal).
      const all = await readIndex();
      const items = await scopedTo(scope, all);
      const reports = await Promise.all(items.map((it) => deleteAssetStorage({ url: it.url, assetId: it.assetId, objectKey: it.objectKey })));
      const failed = reports.filter((r) => /failed/.test(r.tos) || /failed/.test(r.asset)).length;
      const gone = new Set(items);
      await writeIndex(all.filter((it) => !gone.has(it)));
      return res.status(200).json({ items: [], report: { cleared: items.length, failed } });
    }

    return res.status(400).json({ error: `Unknown action: ${action || '(none)'}` });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
