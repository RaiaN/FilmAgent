import fs from 'fs';
import { getServerTosConfig, headTosObject, presignTosObject } from './tosUpload';
import { CLOUD_MEDIA_PREFIX, mediaFileExists, mediaFilePath, mirrorKeyToTos, storeKeyFromUrl } from './mediaStore';

// A media-store url (/api/film/media?key=…) points at this server, so no model backend
// can fetch it. The same bytes live content-addressed in TOS at projects/media/<key>;
// presign that object and hand the model a link it can read. Mirrors first when the
// object exists on disk but never reached TOS. Returns null when it cannot be presigned.
export const presignStoreKey = async (storeKey, { expires } = {}) => {
  const tosConfig = getServerTosConfig();
  if (!storeKey || !tosConfig.accessKey || !tosConfig.secretKey || !tosConfig.tosBucket) return null;
  const objectKey = `${CLOUD_MEDIA_PREFIX}/${storeKey}`;
  const head = await headTosObject({ ...tosConfig, objectKey }).catch(() => ({ exists: false }));
  if (!head.exists && mediaFileExists(storeKey)) {
    try { await mirrorKeyToTos(storeKey, fs.readFileSync(mediaFilePath(storeKey))); } catch { /* presign below still tries */ }
  }
  if (!head.exists && !mediaFileExists(storeKey)) return null;
  try {
    return presignTosObject({ ...tosConfig, objectKey, ...(expires ? { expires } : {}) });
  } catch {
    return null;
  }
};

// Any url → one a model backend can fetch: store urls are presigned, everything else
// passes through unchanged.
export const presignStoreUrl = async (url, opts) => {
  const storeKey = storeKeyFromUrl(url);
  if (!storeKey) return url;
  return presignStoreKey(storeKey, opts);
};
