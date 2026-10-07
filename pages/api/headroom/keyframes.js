import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkInBytes, ensureStoreFile, storeKeyFromUrl } from '../../../utils/server/mediaStore';
import { presignStoreKey } from '../../../utils/server/presignStore';
import { registerAsset } from '../../../utils/film/server/registerAsset';
import { ffmpegPath, parseInfo, run } from '../../../utils/server/videoInfo';
import { linearFrameAt, underexposedRgb8 } from '../../../utils/server/headroom';
import { EV_RANGE, MAX_KEYFRAMES, keyframeTimes } from '../../../utils/headroom';

// Headroom keyframes: `count` evenly spaced frames of a 10-bit master, each brought down by exactly `ev`
// stops in linear light (BT.709 decode, inverse BT.1886, × 2^−ev, BT.1886 encode), as 8-bit PNG.
//   POST { sourceUrl, ev, count, assets } → { keyframes: [{ t, url, assetId? }] }
// assets: also register each keyframe in the Assets library — Seedance rejects raw image urls of
// frames that show people; an asset id passes. Only when the user turns it on.

const register = async (url, name) => {
  const accessKey = process.env.MODELARK_ASSET_ACCESS_KEY;
  const secretKey = process.env.MODELARK_ASSET_SECRET_KEY;
  if (!accessKey || !secretKey) throw new Error('Assets keys are not set — add MODELARK_ASSET_ACCESS_KEY / MODELARK_ASSET_SECRET_KEY to .env.local.');
  const presigned = await presignStoreKey(storeKeyFromUrl(url));
  if (!presigned) throw new Error('The keyframe could not be presigned — check the TOS settings in .env.local.');
  for (let attempt = 0; ; attempt += 1) {
    try {
      const id = await registerAsset({ accessKey, secretKey, url: presigned, name, assetType: 'Image', waitForActive: true }); // eslint-disable-line no-await-in-loop
      if (!id) throw new Error('The Assets library returned no asset id.');
      return id;
    } catch (e) {
      if (attempt >= 4 || !/flow control/i.test(String(e.message))) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); // eslint-disable-line no-await-in-loop
    }
  }
};

export default async function headroomKeyframesHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const key = storeKeyFromUrl(String(req.body?.sourceUrl || ''));
  const count = Number(req.body?.count); const ev = Number(req.body?.ev);
  if (!key) return res.status(400).json({ error: 'sourceUrl (a media-store url) is required.' });
  if (!Number.isInteger(count) || count < 1 || count > MAX_KEYFRAMES) return res.status(400).json({ error: `count must be a whole number from 1 to ${MAX_KEYFRAMES}.` });
  if (!(ev >= EV_RANGE[0] && ev <= EV_RANGE[1])) return res.status(400).json({ error: `ev must be from ${EV_RANGE[0]} to ${EV_RANGE[1]} stops.` });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-kf-'));
  try {
    const bin = await ffmpegPath();
    const file = await ensureStoreFile(key);
    const { spec } = parseInfo((await run(bin, ['-hide_banner', '-i', file])).stderr);
    if (spec.bits !== 10) return res.status(400).json({ error: `Headroom needs a 10-bit master (Seedance 2.5 1080p MOV) — this clip is ${spec.bits}-bit ${spec.pixFmt}.` });
    const keyframes = [];
    for (const t of keyframeTimes(count, spec.durationSec)) {
      const raw = path.join(tmp, 'k.rgb'); const png = path.join(tmp, 'k.png');
      fs.writeFileSync(raw, underexposedRgb8(await linearFrameAt(bin, file, t, spec), ev)); // eslint-disable-line no-await-in-loop
      const r = await run(bin, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${spec.width}x${spec.height}`, '-i', raw, png]); // eslint-disable-line no-await-in-loop
      if (r.code !== 0) throw new Error(`Keyframe at ${t} s failed: ${r.stderr.slice(-200)}`);
      const { url } = await checkInBytes(fs.readFileSync(png), 'image/png'); // eslint-disable-line no-await-in-loop
      keyframes.push({ t, url, ...(req.body?.assets ? { assetId: await register(url, `headroom −${ev} EV ${t}s`) } : {}) }); // eslint-disable-line no-await-in-loop
    }
    return res.status(200).json({ keyframes });
  } catch (error) {
    return res.status(500).json({ error: `Keyframes failed: ${error.message}` });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
