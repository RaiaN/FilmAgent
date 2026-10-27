// Shooting a Seedance take from plain inputs — shared by the canvas SHOT card and the
// Studio crew. No React, no board state: ctx = { client }.
import { animate as animateOp } from './operations';

// Start ONE Seedance take with exactly the inputs given. One attempt: nothing is dropped,
// swapped or retried. A rejection comes back as an error that names the input it is about
// (`nameOf(url)` for reference images), so the director decides what to change and whether
// to shoot again. Reference images ride as Asset Library assets (asset://) wherever an id is
// given. An asset Ark no longer has comes back as an error carrying `staleAsset` — the caller
// forgets that id, so the next take the director asks for registers the picture again.
// content order is [motion, (first_frame?), (last_frame?), …images, …audios, …videos].
export const startTake = async (shot, refAssetIds, ctx, { nameOf = () => 'a reference image' } = {}) => {
  const urls = shot.refUrls || [];
  const ids = refAssetIds || [];
  const audioUrls = shot.audioRefUrls || [];
  const videoUrls = shot.videoRefUrls || [];
  const roleFrames = (shot.firstFrameUrl ? 1 : 0) + (shot.lastFrameUrl ? 1 : 0);
  const at = (m, key) => { const x = new RegExp(`content\\[(\\d+)\\]\\.${key}`, 'i').exec(m); return x ? Number(x[1]) : -1; };
  try {
    const out = await animateOp({
      motion: shot.motion, camera: 'auto', refUrls: urls, refAssetIds: ids, refRoles: shot.refRoles || [],
      firstFrameUrl: shot.firstFrameUrl, lastFrameUrl: shot.lastFrameUrl,
      audioRefUrls: audioUrls, videoRefUrls: videoUrls,
      duration: shot.durationSec, resolution: shot.resolution, ratio: shot.ratio,
      generateAudio: shot.generateAudio !== false, modelKey: shot.modelKey, draft: !!shot.draft, outputFormat: shot.draft ? null : shot.outputFormat,
    }, ctx);
    return { taskId: out.taskId };
  } catch (e) {
    const m = e?.message || '';
    const img = at(m, 'image_url') >= 0 ? at(m, 'image_url') - 1 - roleFrames : -1;
    const named = img >= 0 && img < urls.length ? nameOf(urls[img]) : null;
    if (/asset .* is not found|asset[^ ]* is not found/i.test(m) && named) {
      const err = new Error(`${named}'s Asset Library entry no longer exists on Ark — shoot again to register it anew.`);
      err.staleAsset = { url: urls[img], assetId: ids[img] || null };
      throw err;
    }
    if (/may contain (sensitive|real person)/i.test(m) && !/output audio/i.test(m)) {
      if (named) throw new Error(`Seedance's content screen rejected ${named}${ids[img] ? ' (sent as an Asset Library asset)' : ' (sent as a raw image — not in the Asset Library)'}. Nothing was shot.`);
      if (/audio_url|input audio/i.test(m)) throw new Error('Seedance\'s content screen rejected a reference audio clip. Nothing was shot.');
      if (/video_url|input video/i.test(m)) throw new Error('Seedance\'s content screen rejected a reference video. Nothing was shot.');
    }
    if (/output audio may contain sensitive/i.test(m)) throw new Error('Seedance\'s screen rejected the sound it generated for this take. Nothing was shot — shoot again, or turn audio off for this shot.');
    throw e;
  }
};
