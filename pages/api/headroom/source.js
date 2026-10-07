import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkInBytes, checkInUrl, ensureStoreFile, storeKeyFromUrl } from '../../../utils/server/mediaStore';
import { ffmpegPath, parseInfo, run } from '../../../utils/server/videoInfo';

// Headroom source: a clip → the media store, probed, with a browser-playable copy.
//   POST { url } (media-store url or public http(s) url) →
//   { sourceUrl, viewUrl, spec: { width, height, fps, durationSec, codec, pixFmt }, hasAudio }
// The original goes to Seedance; the viewer plays viewUrl (H.264 4:2:0 when the original isn't).
// Seedance edit takes reference videos of 4–30 s; spec.bits tells whether it is a 10-bit master.

const EDIT_SECONDS = [4, 30];
const PLAYABLE = (s) => s.codec === 'h264' && s.pixFmt === 'yuv420p';

export default async function headroomSourceHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const raw = String(req.body?.url || '').trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-'));
  try {
    let sourceUrl = raw;
    if (!storeKeyFromUrl(raw)) {
      if (!/^https?:\/\//i.test(raw)) return res.status(400).json({ error: 'Give a media-store url or a public http(s) video url.' });
      sourceUrl = (await checkInUrl(raw)).url;
    }
    const bin = await ffmpegPath();
    const file = await ensureStoreFile(storeKeyFromUrl(sourceUrl));
    const { spec, audio } = parseInfo((await run(bin, ['-hide_banner', '-i', file])).stderr);
    if (spec.durationSec < EDIT_SECONDS[0] || spec.durationSec > EDIT_SECONDS[1]) {
      return res.status(400).json({ error: `Seedance edits clips of ${EDIT_SECONDS[0]}–${EDIT_SECONDS[1]} s — this one is ${spec.durationSec.toFixed(1)} s.` });
    }
    let viewUrl = sourceUrl;
    if (!PLAYABLE(spec)) {
      const out = path.join(tmp, 'view.mp4');
      const r = await run(bin, ['-v', 'error', '-y', '-i', file, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', out]);
      if (r.code !== 0) throw new Error(`Preview encode failed: ${r.stderr.slice(-300)}`);
      viewUrl = (await checkInBytes(fs.readFileSync(out), 'video/mp4')).url;
    }
    return res.status(200).json({
      sourceUrl, viewUrl, hasAudio: !!audio,
      spec: { width: spec.width, height: spec.height, fps: spec.fps, durationSec: spec.durationSec, codec: spec.codec, pixFmt: spec.pixFmt, bits: spec.bits },
    });
  } catch (error) {
    return res.status(500).json({ error: `Could not load the clip: ${error.message}` });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
