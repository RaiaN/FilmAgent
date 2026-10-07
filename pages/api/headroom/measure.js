import { ensureStoreFile, storeKeyFromUrl } from '../../../utils/server/mediaStore';
import { ffmpegPath, parseInfo, run } from '../../../utils/server/videoInfo';
import { frameCount, measurePlate } from '../../../utils/server/headroom';

// Headroom measure: the plate Seedance returned against the master.
//   POST { sourceUrl, plateUrl } → { frames: { master, plate }, heldEv, stabilityStops, clippedPct,
//     plateStillClippedPct, heroStopsAboveWhite, mergedStopsAboveWhite, gainPerSample }
// heldEv is measured from unclipped mid-tones (master / plate), never assumed from the requested EV.

export default async function headroomMeasureHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const srcKey = storeKeyFromUrl(String(req.body?.sourceUrl || ''));
  const plateKey = storeKeyFromUrl(String(req.body?.plateUrl || ''));
  if (!srcKey || !plateKey) return res.status(400).json({ error: 'sourceUrl and plateUrl (media-store urls) are required.' });
  try {
    const bin = await ffmpegPath();
    const src = await ensureStoreFile(srcKey); const plate = await ensureStoreFile(plateKey);
    const { spec: s } = parseInfo((await run(bin, ['-hide_banner', '-i', src])).stderr);
    const { spec: p } = parseInfo((await run(bin, ['-hide_banner', '-i', plate])).stderr);
    if (s.width !== p.width || s.height !== p.height) return res.status(422).json({ error: `The plate is ${p.width}×${p.height}; the master is ${s.width}×${s.height}.` });
    const frames = { master: await frameCount(bin, src), plate: await frameCount(bin, plate) };
    if (frames.master !== frames.plate) return res.status(422).json({ error: `The plate has ${frames.plate} frames; the master has ${frames.master}. It can't be measured frame-accurately.`, frames });
    return res.status(200).json({ frames, ...(await measurePlate(bin, src, plate, s)) });
  } catch (error) {
    return res.status(500).json({ error: `Measure failed: ${error.message}` });
  }
}
