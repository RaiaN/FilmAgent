import fs from 'fs';
import path from 'path';
import { KEY_RE, TYPE_BY_EXT, mediaFilePath, readStoreBytes, checkInUrl } from '../../../utils/server/mediaStore';

// The BROWSER'S window into the media store — a thin HTTP shell over
// utils/server/mediaStore (the library every server route imports directly).
//   GET  ?key=<sha>.<ext> → stream the bytes (read-through: disk, else TOS + backfill),
//        immutable cache headers (content-hashed keys never change).
//   POST { url }          → check a source url in (http(s) or data:) → { key, url }.
// Server code must NEVER fetch this route — import the library instead.

export const config = {
  api: {
    bodyParser: { sizeLimit: '60mb' }, // remote urls are tiny, but a `data:` url IS the bytes
    responseLimit: false, // GET streams full-size images/videos
  },
};

const MAX_THUMB = 1600;
const THUMBABLE = /^(jpe?g|png|webp)$/;
const thumbnail = async (file, width) => {
  try {
    const { default: sharp } = await import('sharp');
    return await sharp(file).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  } catch { return null; }
};

export default async function mediaHandler(req, res) {
  try {
    if (req.method === 'GET') {
      const key = String(req.query.key || '');
      if (!KEY_RE.test(key)) return res.status(400).json({ error: 'bad key' });
      try {
        await readStoreBytes(key); // read-through: guarantees the local file exists
      } catch (e) {
        const status = e?.statusCode === 404 || /not in the store/.test(e.message) ? 404 : 502;
        return res.status(status).json({ error: e.message });
      }
      const ext = key.split('.').pop().toLowerCase();
      const file = path.resolve(mediaFilePath(key));
      const { size } = fs.statSync(file);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // content-hashed → never changes
      // ?w=<px>: a picture for a tile, not the original. Only pages ask for it, only to show it.
      const width = Number(req.query.w);
      if (width > 0 && width <= MAX_THUMB && THUMBABLE.test(ext)) {
        const small = await thumbnail(file, width);
        if (small) {
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Content-Length', small.length);
          return res.status(200).end(small);
        }
      }
      res.setHeader('Content-Type', TYPE_BY_EXT[ext] || 'application/octet-stream');
      // RANGE support is what makes <video> SEEKABLE — without it the player can't
      // jump the playhead until the whole file has downloaded (the Take Viewer bug).
      res.setHeader('Accept-Ranges', 'bytes');
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
      if (range && (range[1] || range[2])) {
        const start = range[1] ? parseInt(range[1], 10) : Math.max(0, size - parseInt(range[2], 10));
        const end = range[1] && range[2] ? Math.min(parseInt(range[2], 10), size - 1) : size - 1;
        if (start >= size || start > end) {
          res.setHeader('Content-Range', `bytes */${size}`);
          return res.status(416).end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', end - start + 1);
        fs.createReadStream(file, { start, end }).pipe(res);
        return undefined;
      }
      res.setHeader('Content-Length', size);
      fs.createReadStream(file).pipe(res);
      return undefined;
    }

    if (req.method === 'POST') {
      const { url } = req.body || {};
      if (!url || !/^(https?:\/\/|data:)/.test(String(url))) return res.status(400).json({ error: 'an http(s) or data: url is required' });
      try {
        const { key, url: storeUrl } = await checkInUrl(url);
        return res.status(200).json({ key, url: storeUrl });
      } catch (e) {
        return res.status(502).json({ error: e.message });
      }
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
