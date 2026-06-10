import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

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
      const { id, url } = req.body || {};
      const next = readIndex().filter((it) => it.id !== id && it.url !== url);
      writeIndex(next);
      return res.status(200).json({ items: next });
    }

    return res.status(400).json({ error: `Unknown action: ${action || '(none)'}` });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
