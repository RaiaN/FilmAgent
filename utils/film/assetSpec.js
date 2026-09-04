// THE ASSETS API's own limits, in one place. A file that breaks one of these is
// rejected by CreateAsset (or ingests and then goes Failed), and the error that comes
// back names neither the rule nor the file — so we check what is cheap to check before
// spending the upload, and say exactly which limit was missed.
//
// FORMAT and SIZE are decidable from the bytes alone, so they are enforced here on the
// server. DURATION, DIMENSIONS, ASPECT and FPS need a decode; the browser already knows
// them for anything it previews, so those belong to the client (see assetSpecClient).

export const ASSET_SPEC = {
  image: {
    assetType: 'Image',
    formats: ['jpeg', 'jpg', 'png', 'webp', 'bmp', 'tiff', 'gif', 'heic', 'heif'],
    maxBytes: 30 * 1024 * 1024,
    aspect: [0.4, 2.5],          // W/H, exclusive
    side: [300, 6000],           // px, exclusive
  },
  video: {
    assetType: 'Video',
    formats: ['mp4', 'mov', 'quicktime'], // 'quicktime' = the mime subtype for .mov
    maxBytes: 200 * 1024 * 1024,
    seconds: [2, 30],
    aspect: [0.4, 2.5],          // W/H, inclusive
    side: [300, 6000],           // px, inclusive
    pixels: [407696, 2086876],   // W×H, inclusive — 614×664 … 834×1112 and up
    fps: [24, 60],
  },
  audio: {
    assetType: 'Audio',
    formats: ['wav', 'mp3', 'mpeg', 'x-wav', 'wave'], // mime subtypes seen for wav/mp3
    maxBytes: 15 * 1024 * 1024,
    seconds: [2, 30],
  },
};

// Which spec a mime type falls under — 'image' | 'video' | 'audio' | null.
export const assetFamilyOf = (contentType) => {
  const t = String(contentType || '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  return null;
};

// The Assets API AssetType for a mime type, or null when the family is not registrable.
export const assetTypeOf = (contentType) => {
  const fam = assetFamilyOf(contentType);
  return fam ? ASSET_SPEC[fam].assetType : null;
};

// What is decidable from the header + byte length. Returns a reason string, or '' when
// the file passes everything this layer can judge.
export const checkAssetBytes = ({ contentType, byteLength }) => {
  const fam = assetFamilyOf(contentType);
  if (!fam) return `${contentType || 'this file type'} is not an image, video or audio file.`;
  const spec = ASSET_SPEC[fam];
  const subtype = String(contentType).toLowerCase().split('/')[1] || '';
  if (!spec.formats.includes(subtype)) {
    return `${fam} must be ${spec.formats.filter((f) => !f.includes('-') && f !== 'mpeg' && f !== 'quicktime').join(', ')} — got ${subtype || 'an unknown format'}.`;
  }
  if (byteLength > spec.maxBytes) {
    return `${fam} must be ${Math.round(spec.maxBytes / (1024 * 1024))} MB or smaller — this one is ${(byteLength / (1024 * 1024)).toFixed(1)} MB.`;
  }
  return '';
};

// The client-side half: duration in seconds (audio + video) against the same spec.
// Returns a reason string, or '' when it passes / cannot be judged.
export const checkAssetDuration = (contentType, seconds) => {
  const fam = assetFamilyOf(contentType);
  const spec = fam && ASSET_SPEC[fam];
  if (!spec?.seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  const [lo, hi] = spec.seconds;
  if (seconds < lo || seconds > hi) {
    return `${fam} must run ${lo}–${hi} seconds to register as an asset — this one is ${seconds.toFixed(1)}s.`;
  }
  return '';
};
