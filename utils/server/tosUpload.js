import crypto from 'crypto';
import { TosClient } from '@volcengine/tos-sdk';

export const DEFAULT_TOS_REGION = 'ap-southeast-1';

const encodePathSegment = (segment) =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

export const getDefaultTosEndpoint = (region) => `tos-${region}.bytepluses.com`;
export const getDefaultTosPublicBaseUrl = ({ endpoint, bucket }) => `https://${endpoint}/${bucket}`;

export const parseDataUrl = (value, label = 'Local file payload') => {
  const str = String(value || '');
  const semiIdx = str.indexOf(';');
  const commaIdx = str.indexOf(',');
  if (!str.startsWith('data:') || semiIdx === -1 || commaIdx === -1 || str.slice(semiIdx + 1, commaIdx) !== 'base64') {
    throw new Error(`${label} must be a valid data URL.`);
  }
  return {
    contentType: str.slice(5, semiIdx),
    buffer: Buffer.from(str.slice(commaIdx + 1), 'base64'),
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
  // A presigned GET URL works even on a PRIVATE bucket — unlike the unsigned
  // objectUrl, which 403s unless the bucket is public-read. Backend services that
  // must DOWNLOAD the object (the Assets API ingesting it, Seedance fetching a
  // reference) need this regardless of whether a public base URL is configured.
  const signedUrl = client.getPreSignedUrl({
    bucket: tosBucket,
    key: objectKey,
    method: 'GET',
    expires: 3600,
  });
  const fetchUrl = String(tosPublicBaseUrl || '').trim() ? objectUrl : signedUrl;

  return {
    objectKey,
    objectUrl,
    fetchUrl,
    signedUrl,
    contentType,
    size: buffer.length,
  };
}
