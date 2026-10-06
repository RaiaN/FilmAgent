import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkInBytes, ensureStoreFile, storeKeyFromUrl } from '../../../utils/server/mediaStore';
import { ffmpegPath, parseInfo, run } from '../../../utils/server/videoInfo';

// Region Edit mask: the drawn regions (white on black, one PNG) → a mask video that matches
// the source's size, frame rate and length, for Seedance as @Video2.
//   POST { sourceUrl, maskPng: data:image/png;base64,… } → { maskUrl }
export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };

export default async function regionEditMaskHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const key = storeKeyFromUrl(String(req.body?.sourceUrl || ''));
  const m = /^data:image\/png;base64,(.+)$/.exec(String(req.body?.maskPng || ''));
  if (!key || !m) return res.status(400).json({ error: 'sourceUrl (media-store url) and maskPng (PNG data url) are required.' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'regionmask-'));
  try {
    const bin = await ffmpegPath();
    const { spec } = parseInfo((await run(bin, ['-hide_banner', '-i', await ensureStoreFile(key)])).stderr);
    const png = path.join(tmp, 'mask.png');
    fs.writeFileSync(png, Buffer.from(m[1], 'base64'));
    const out = path.join(tmp, 'mask.mp4');
    const r = await run(bin, ['-v', 'error', '-y', '-loop', '1', '-framerate', String(spec.fps || 24), '-i', png, '-t', spec.durationSec.toFixed(3),
      '-vf', `scale=${spec.width}:${spec.height}:flags=bicubic,format=yuv420p`, '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', '-an', out]);
    if (r.code !== 0) throw new Error(r.stderr.slice(-300));
    return res.status(200).json({ maskUrl: (await checkInBytes(fs.readFileSync(out), 'video/mp4')).url });
  } catch (error) {
    return res.status(500).json({ error: `Mask video failed: ${error.message}` });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
