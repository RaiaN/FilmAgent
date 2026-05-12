import { getEndpointUrl } from '../../utils/config';
import { uploadLocalMediaToTos } from '../../utils/server/tosUpload';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());
const isDataUrl = (value) => /^data:[^;]+;base64,/i.test(String(value || ''));
const isAssetUrl = (value) => /^asset:\/\//i.test(String(value || '').trim());

const getServerTosConfig = () => {
  const accessKey = process.env.MODELARK_ASSET_ACCESS_KEY;
  const secretKey = process.env.MODELARK_ASSET_SECRET_KEY;
  const tosBucket = process.env.MODELARK_TOS_BUCKET;
  const tosRegion = process.env.MODELARK_TOS_REGION;
  const tosEndpoint = process.env.MODELARK_TOS_ENDPOINT;
  const tosObjectPrefix = process.env.MODELARK_TOS_OBJECT_PREFIX;
  const tosPublicBaseUrl = process.env.MODELARK_TOS_PUBLIC_BASE_URL || '';

  return {
    accessKey,
    secretKey,
    tosBucket,
    tosRegion,
    tosEndpoint,
    tosObjectPrefix,
    tosPublicBaseUrl,
  };
};

const buildFallbackFileName = (role, contentType) => {
  const extensionMap = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
  };
  const extension = extensionMap[contentType]
    || (contentType.startsWith('image/') ? 'png' : contentType.startsWith('video/') ? 'mp4' : 'bin');
  return `${role}-${Date.now()}.${extension}`;
};

async function normalizeSeedanceContent(content) {
  const items = Array.isArray(content) ? content : [];
  const tosConfig = getServerTosConfig();
  let stagedCount = 0;
  let assetReferenceCount = 0;

  const normalized = await Promise.all(items.map(async (item) => {
    if (item?.type === 'image_asset_id') {
      assetReferenceCount += 1;
      return {
        type: 'image_url',
        image_url: { url: `asset://${String(item.asset_id || '').trim()}` },
        role: item.role || 'reference_image',
      };
    }

    if (!['image_url', 'video_url', 'audio_url'].includes(item?.type)) {
      return item;
    }

    const key =
      item.type === 'image_url'
        ? 'image_url'
        : item.type === 'video_url'
          ? 'video_url'
          : 'audio_url';
    const mediaUrl = item?.[key]?.url;

    if (!mediaUrl || isHttpUrl(mediaUrl) || isAssetUrl(mediaUrl)) {
      if (item?.type === 'image_url' && isAssetUrl(mediaUrl)) {
        assetReferenceCount += 1;
      }
      return item;
    }

    if (!isDataUrl(mediaUrl)) {
      throw new Error(`${item.role || item.type} must be a public http(s) URL, an asset:// URL, or a local uploaded file.`);
    }

    if (!tosConfig.accessKey || !tosConfig.secretKey) {
      throw new Error('TOS credentials are not configured on the server. Set them in .env.local to enable local Seedance media uploads.');
    }

    if (!tosConfig.tosBucket) {
      throw new Error('TOS bucket is not configured on the server. Set it in .env.local to enable local Seedance media uploads.');
    }

    const contentType = mediaUrl.slice(5, mediaUrl.indexOf(';')).toLowerCase();
    const staged = await uploadLocalMediaToTos({
      ...tosConfig,
      localData: mediaUrl,
      localName: item?.[key]?.name || '',
      fallbackName: buildFallbackFileName(item.role || item.type, contentType),
      dataLabel: `${item.role || item.type} payload`,
    });
    stagedCount += 1;

    return {
      ...item,
      [key]: {
        ...(item[key] || {}),
        url: staged.fetchUrl || staged.objectUrl,
      },
    };
  }));

  return {
    content: normalized,
    stagedCount,
    assetReferenceCount,
  };
}

async function seedanceHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { apiKey, baseUrl, ...payload } = req.body;

  const token = apiKey || process.env.MODELARK_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const endpoint = baseUrl
      ? `${baseUrl}/contents/generations/tasks`
      : getEndpointUrl('video');

  try {
    const normalizedPayload = { ...payload };
    const staged = await normalizeSeedanceContent(payload.content);
    normalizedPayload.content = staged.content;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(normalizedPayload),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Seedance request failed', details: data });
    }

    return res.status(200).json({
      ...data,
      localMediaStagedToTos: staged.stagedCount > 0,
      stagedMediaCount: staged.stagedCount,
      assetReferencesUsed: staged.assetReferenceCount > 0,
      assetReferenceCount: staged.assetReferenceCount,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Request failed', details: error.message });
  }
}

export default seedanceHandler;
