import fs from 'fs';
import os from 'os';
import path from 'path';
import { storeKeyFromUrl, readStoreBytes, checkInBytes, checkInUrl } from '../../../utils/server/mediaStore';
import { ffmpegPath, run } from '../../../utils/server/videoInfo';

// A browser can't play a 10-bit 4:4:4 master, so the preview plays an H.264 copy made on first ask.
// The master stays what the project holds.

const copies = globalThis.filmPreviewCopies || new Map();
globalThis.filmPreviewCopies = copies;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
  const asked = String(req.body?.url || '');
  if (!storeKeyFromUrl(asked) && !/^https?:\/\//.test(asked)) return res.status(400).json({ error: 'That video has no address to fetch it from.' });
  let dir = null;
  try {
    // A render not yet in the media store comes in first.
    const key = storeKeyFromUrl(asked) || storeKeyFromUrl((await checkInUrl(asked)).url);
    if (copies.has(key)) return res.status(200).json({ url: copies.get(key) });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-preview-'));
    const input = path.join(dir, 'in.mov');
    const output = path.join(dir, 'out.mp4');
    fs.writeFileSync(input, (await readStoreBytes(key)).buffer);
    const { code, stderr } = await run(await ffmpegPath(), ['-y', '-i', input, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output]);
    if (code !== 0) throw new Error(`The preview copy failed: ${stderr.slice(-300)}`);
    const { url } = await checkInBytes(fs.readFileSync(output), 'video/mp4');
    copies.set(key, url);
    return res.status(200).json({ url });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}
