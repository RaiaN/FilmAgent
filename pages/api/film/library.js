import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { deleteTosObject, tosObjectKeyFromUrl } from '../../../utils/server/tosUpload';
import { callAssetApi } from '../../../utils/server/assetApi';

// Persistent index of checked-in (preserved) assets, shared across all projects.
// Stored alongside the recent-projects list in the user's home config dir.

const LIBRARY_FILE = path.join(os.homedir(), '.modelark-starter-kit', 'film-agent-library.json');
const MAX_ITEMS = 400;

const readIndex = () => {
  try {
    if (!fs.existsSync(LIBRARY_FILE)) return [];
    const list = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
    return Array.isArray(list) ? list.filter((it) => it && it.url) : [];
  } catch {
    return [];
  }
};

const writeIndex = (list) => {
  fs.mkdirSync(path.dirname(LIBRARY_FILE), { recursive: true });
  fs.writeFileSync(LIBRARY_FILE, JSON.stringify(list.slice(0, MAX_ITEMS), null, 2), 'utf8');
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

export default async function libraryHandler(req, res) {
  const { action } = req.query;
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ items: readIndex() });
    }

    if (req.method === 'POST' && action === 'add') {
      const { url, assetId, name, kind = 'image', thumb } = req.body || {};
      if (!url) return res.status(400).json({ error: 'url is required' });
      const existing = readIndex();
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
        createdAt: new Date().toISOString(),
      };
      const next = [entry, ...deduped];
      writeIndex(next);
      return res.status(200).json({ item: entry, items: next });
    }

    if (req.method === 'POST' && action === 'remove') {
      // List-only: drop the entry; the underlying TOS object + asset are kept.
      const { id, url } = req.body || {};
      const next = readIndex().filter((it) => it.id !== id && it.url !== url);
      writeIndex(next);
      return res.status(200).json({ items: next });
    }

    if (req.method === 'POST' && action === 'delete') {
      // Permanent: delete the TOS object + the Assets-API asset, THEN drop the
      // index entry. The storage delete is best-effort so a partial failure
      // (e.g. permissions) still removes the entry and reports what happened.
      const { id, url, assetId, objectKey } = req.body || {};
      const report = await deleteAssetStorage({ url, assetId, objectKey });
      const next = readIndex().filter((it) => it.id !== id && it.url !== url);
      writeIndex(next);
      return res.status(200).json({ items: next, report });
    }

    if (req.method === 'POST' && action === 'clear') {
      // Permanent: wipe the WHOLE library — best-effort delete EVERY asset's TOS object +
      // Assets-API asset (in parallel; each delete never throws), then empty the index. The
      // index is cleared even if some storage deletes fail (those are reported, not fatal).
      const items = readIndex();
      const reports = await Promise.all(items.map((it) => deleteAssetStorage({ url: it.url, assetId: it.assetId, objectKey: it.objectKey })));
      const failed = reports.filter((r) => /failed/.test(r.tos) || /failed/.test(r.asset)).length;
      writeIndex([]);
      return res.status(200).json({ items: [], report: { cleared: items.length, failed } });
    }

    return res.status(400).json({ error: `Unknown action: ${action || '(none)'}` });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
