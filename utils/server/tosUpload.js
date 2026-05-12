import crypto from 'crypto';
import { TosClient } from '@volcengine/tos-sdk';

export const DEFAULT_TOS_REGION = 'ap-southeast-1';

const encodePathSegment = (segment) =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

export const getDefaultTosEndpoint = (region) => `tos-${region}.bytepluses.com`;
export const getDefaultTosPublicBaseUrl = ({ endpoint, bucket }) => `https://${endpoint}/${bucket}`;

export const parseDataUrl = (value, label = 'Local file payload') => {
  const match = String(value || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error(`${label} must be a valid data URL.`);
  }
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
};

const normalizeObjectKeyPart = (value) =>
  String(value || '')
    .replace(/[^a-zA-Z0-9/_\-.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\//, '');

export async function uploadLocalMediaToTos({
  accessKey,
  secretKey,
  tosBucket,
  tosRegion,
  tosEndpoint,
  tosObjectPrefix,
  tosPublicBaseUrl,
  localData,
  localName,
  fallbackName,
  dataLabel,
}) {
  const { contentType, buffer } = parseDataUrl(localData, dataLabel);
  const safeName = normalizeObjectKeyPart(localName || fallbackName || `upload-${Date.now()}`);
  const prefix = normalizeObjectKeyPart(tosObjectPrefix || 'seedance-media');
  const objectKey = `${prefix}/${crypto.randomUUID()}-${safeName}`;
  const resolvedRegion = tosRegion || DEFAULT_TOS_REGION;
  const resolvedEndpoint = String(tosEndpoint || '').trim() || getDefaultTosEndpoint(resolvedRegion);

  if (resolvedRegion.includes('.') || resolvedRegion.includes('/')) {
    throw new Error('MODELARK_TOS_REGION must be a region like ap-southeast-1, not a domain.');
  }

  const client = new TosClient({
    accessKeyId: accessKey,
    accessKeySecret: secretKey,
    region: resolvedRegion,
    endpoint: resolvedEndpoint,
  });
  const uploadUrl = client.getPreSignedUrl({
    bucket: tosBucket,
    key: objectKey,
    method: 'PUT',
    expires: 900,
  });

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: buffer,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TOS PutObject failed: ${response.status} ${errorText}`);
  }

  const baseUrl =
    String(tosPublicBaseUrl || '').trim().replace(/\/+$/, '') ||
    getDefaultTosPublicBaseUrl({ endpoint: resolvedEndpoint, bucket: tosBucket });
  const objectUrl = `${baseUrl}/${objectKey.split('/').map((segment) => encodePathSegment(segment)).join('/')}`;
  const fetchUrl = String(tosPublicBaseUrl || '').trim()
    ? objectUrl
    : client.getPreSignedUrl({
        bucket: tosBucket,
        key: objectKey,
        method: 'GET',
        expires: 3600,
      });

  return {
    objectKey,
    objectUrl,
    fetchUrl,
    contentType,
    size: buffer.length,
  };
}
