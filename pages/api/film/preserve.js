import { uploadLocalMediaToTos } from '../../../utils/server/tosUpload';
import { registerAsset } from '../../../utils/film/server/registerAsset';

// "Check in" an asset: download the (still-valid) signed source URL server-side
// and re-upload the bytes into the user's own TOS bucket, returning a STABLE
// public URL that never expires. This is what downstream layers (Seedream refs,
// Seedance / Animate) should use instead of the 24h Seedream signed URL.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb', // we only receive a URL; the image is fetched server-side
    },
  },
};

const isHttpUrl = (v) => /^https?:\/\//i.test(String(v || '').trim());

export default async function preserveHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { url, name } = req.body || {};
  if (!isHttpUrl(url)) {
    return res.status(400).json({ error: 'A http(s) source url is required' });
  }

  const accessKey = process.env.MODELARK_ASSET_ACCESS_KEY;
  const secretKey = process.env.MODELARK_ASSET_SECRET_KEY;
  const tosBucket = process.env.MODELARK_TOS_BUCKET;
  if (!accessKey || !secretKey) {
    return res.status(400).json({ error: 'Asset access keys are not configured on the server (.env.local).' });
  }
  if (!tosBucket) {
    return res.status(400).json({ error: 'TOS bucket is not configured on the server (.env.local).' });
  }

  try {
    // Fetch the source bytes while the signed URL is still valid.
    const srcResponse = await fetch(url);
    if (!srcResponse.ok) {
      return res.status(502).json({
        error: srcResponse.status === 403
          ? 'Source URL has expired (403) — this asset can no longer be preserved. Re-generate it.'
          : `Could not fetch source asset (${srcResponse.status})`,
      });
    }
    const contentType = srcResponse.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await srcResponse.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const dataUrl = `data:${contentType};base64,${base64}`;

    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const staged = await uploadLocalMediaToTos({
      accessKey,
      secretKey,
      tosBucket,
      tosRegion: process.env.MODELARK_TOS_REGION,
      tosEndpoint: process.env.MODELARK_TOS_ENDPOINT,
      tosObjectPrefix: process.env.MODELARK_TOS_OBJECT_PREFIX || 'film-agent',
      tosPublicBaseUrl: process.env.MODELARK_TOS_PUBLIC_BASE_URL || '',
      localData: dataUrl,
      localName: name || '',
      fallbackName: `preserved-${Date.now()}.${ext}`,
      dataLabel: 'Preserved asset',
    });

    // A configured public base URL is a CLAIM that the bucket is public-read —
    // verify it. On a private bucket the unsigned objectUrl 403s, and swapping
    // it into a board node breaks the image the moment it's "preserved" (the
    // exact opposite of what check-in promises). When the probe fails, hand out
    // the presigned GET instead; board nodes re-sign on error (/api/film/resign),
    // so the link never dies for good — the bytes are already safe either way.
    let stableUrl = staged.objectUrl;
    try {
      const probe = await fetch(stableUrl, { method: 'HEAD' });
      if (!probe.ok) stableUrl = staged.signedUrl;
    } catch {
      stableUrl = staged.signedUrl;
    }

    // Catalogue it in the Assets library for asset:// references + the Library.
    // Register via the PRESIGNED url so the Assets backend can download it on a
    // private bucket (the unsigned stableUrl would 403).
    let assetId = null;
    try {
      assetId = await registerAsset({
        accessKey,
        secretKey,
        url: staged.signedUrl || stableUrl,
        name,
        waitForActive: true,
      });
    } catch (err) {
      console.warn('[film/preserve] Assets API registration skipped:', err.message);
    }

    return res.status(200).json({ url: stableUrl, assetId, objectKey: staged.objectKey, contentType, size: staged.size });
  } catch (error) {
    return res.status(500).json({ error: 'Preserve failed', details: error.message });
  }
}
