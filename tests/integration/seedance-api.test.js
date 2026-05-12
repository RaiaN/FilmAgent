/**
 * @jest-environment node
 */

var mockGetPreSignedUrl = jest.fn();

jest.mock('@volcengine/tos-sdk', () => ({
  TosClient: jest.fn().mockImplementation(() => ({
    getPreSignedUrl: (...args) => mockGetPreSignedUrl(...args),
  })),
}));

import { createMocks } from 'node-mocks-http';
import seedanceHandler from '../../pages/api/seedance';

describe('Seedance API local media staging', () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    REGION: process.env.REGION,
    SERVICE: process.env.SERVICE,
    VERSION: process.env.VERSION,
    BASE_URL: process.env.BASE_URL,
    TERMINAL: process.env.TERMINAL,
    POLL_INTERVAL_MS: process.env.POLL_INTERVAL_MS,
    POLL_MAX_ATTEMPTS: process.env.POLL_MAX_ATTEMPTS,
    MODELARK_ASSET_ACCESS_KEY: process.env.MODELARK_ASSET_ACCESS_KEY,
    MODELARK_ASSET_SECRET_KEY: process.env.MODELARK_ASSET_SECRET_KEY,
    MODELARK_TOS_BUCKET: process.env.MODELARK_TOS_BUCKET,
    MODELARK_TOS_REGION: process.env.MODELARK_TOS_REGION,
    MODELARK_TOS_ENDPOINT: process.env.MODELARK_TOS_ENDPOINT,
    MODELARK_TOS_OBJECT_PREFIX: process.env.MODELARK_TOS_OBJECT_PREFIX,
    MODELARK_TOS_PUBLIC_BASE_URL: process.env.MODELARK_TOS_PUBLIC_BASE_URL,
  };

  beforeEach(() => {
    process.env.REGION = 'ap-southeast-1';
    process.env.SERVICE = 'ark';
    process.env.VERSION = '2024-01-01';
    process.env.BASE_URL = 'https://ark.ap-southeast-1.byteplusapi.com/';
    process.env.TERMINAL = 'request';
    process.env.POLL_INTERVAL_MS = '3000';
    process.env.POLL_MAX_ATTEMPTS = '40';
    process.env.MODELARK_ASSET_ACCESS_KEY = 'ak-env-test';
    process.env.MODELARK_ASSET_SECRET_KEY = 'sk-env-test';
    process.env.MODELARK_TOS_BUCKET = 'my-bucket';
    process.env.MODELARK_TOS_REGION = 'ap-southeast-1';
    process.env.MODELARK_TOS_ENDPOINT = 'tos-ap-southeast-1.bytepluses.com';
    process.env.MODELARK_TOS_OBJECT_PREFIX = 'seedance-media';
    process.env.MODELARK_TOS_PUBLIC_BASE_URL = '';
    mockGetPreSignedUrl.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    process.env.REGION = originalEnv.REGION;
    process.env.SERVICE = originalEnv.SERVICE;
    process.env.VERSION = originalEnv.VERSION;
    process.env.BASE_URL = originalEnv.BASE_URL;
    process.env.TERMINAL = originalEnv.TERMINAL;
    process.env.POLL_INTERVAL_MS = originalEnv.POLL_INTERVAL_MS;
    process.env.POLL_MAX_ATTEMPTS = originalEnv.POLL_MAX_ATTEMPTS;
    process.env.MODELARK_ASSET_ACCESS_KEY = originalEnv.MODELARK_ASSET_ACCESS_KEY;
    process.env.MODELARK_ASSET_SECRET_KEY = originalEnv.MODELARK_ASSET_SECRET_KEY;
    process.env.MODELARK_TOS_BUCKET = originalEnv.MODELARK_TOS_BUCKET;
    process.env.MODELARK_TOS_REGION = originalEnv.MODELARK_TOS_REGION;
    process.env.MODELARK_TOS_ENDPOINT = originalEnv.MODELARK_TOS_ENDPOINT;
    process.env.MODELARK_TOS_OBJECT_PREFIX = originalEnv.MODELARK_TOS_OBJECT_PREFIX;
    process.env.MODELARK_TOS_PUBLIC_BASE_URL = originalEnv.MODELARK_TOS_PUBLIC_BASE_URL;
  });

  test('stages local video and audio to TOS before forwarding the Seedance request', async () => {
    mockGetPreSignedUrl
      .mockReturnValueOnce('https://presigned.example/upload/image')
      .mockReturnValueOnce('https://presigned.example/upload/video')
      .mockReturnValueOnce('https://presigned.example/upload/audio')
      .mockReturnValueOnce('https://presigned.example/read/image')
      .mockReturnValueOnce('https://presigned.example/read/video')
      .mockReturnValueOnce('https://presigned.example/read/audio');
    global.fetch = jest.fn(async (url) => {
      if (String(url).startsWith('https://presigned.example/upload/')) {
        return {
          ok: true,
          text: async () => '',
        };
      }
      if (String(url) === 'https://example.test/api/v3/contents/generations/tasks') {
        return {
          ok: true,
          json: async () => ({
            id: 'seedance-task-123',
            status: 'queued',
          }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        apiKey: 'modelark-test-key',
        baseUrl: 'https://example.test/api/v3',
        model: 'seedance-1-5-pro-251215',
        resolution: '720p',
        ratio: '16:9',
        duration: 5,
        watermark: false,
        content: [
          { type: 'text', text: 'Animate this local reference clip.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' }, role: 'reference_image' },
          { type: 'image_url', image_url: { url: 'asset://asset-image-123' }, role: 'reference_image' },
          { type: 'video_url', video_url: { url: 'data:video/mp4;base64,aGVsbG8=' }, role: 'reference_video' },
          { type: 'audio_url', audio_url: { url: 'data:audio/mpeg;base64,aGVsbG8=' }, role: 'reference_audio' },
        ],
      },
    });

    await seedanceHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(4);

    const uploadCalls = global.fetch.mock.calls.filter(([url]) => String(url).startsWith('https://presigned.example/upload/'));
    const seedanceCall = global.fetch.mock.calls.find(([url]) => String(url) === 'https://example.test/api/v3/contents/generations/tasks');

    const [imageTosUrl, imageTosOptions] = uploadCalls.find(([url]) => url === 'https://presigned.example/upload/image');
    expect(imageTosUrl).toBe('https://presigned.example/upload/image');
    expect(imageTosOptions.method).toBe('PUT');
    expect(imageTosOptions.headers['Content-Type']).toBe('image/png');

    const [videoTosUrl, videoTosOptions] = uploadCalls.find(([url]) => url === 'https://presigned.example/upload/video');
    expect(videoTosUrl).toBe('https://presigned.example/upload/video');
    expect(videoTosOptions.method).toBe('PUT');
    expect(videoTosOptions.headers['Content-Type']).toBe('video/mp4');

    const [audioTosUrl, audioTosOptions] = uploadCalls.find(([url]) => url === 'https://presigned.example/upload/audio');
    expect(audioTosUrl).toBe('https://presigned.example/upload/audio');
    expect(audioTosOptions.method).toBe('PUT');
    expect(audioTosOptions.headers['Content-Type']).toBe('audio/mpeg');
    const { TosClient } = require('@volcengine/tos-sdk');
    expect(TosClient).toHaveBeenCalledWith({
      accessKeyId: 'ak-env-test',
      accessKeySecret: 'sk-env-test',
      region: 'ap-southeast-1',
      endpoint: 'tos-ap-southeast-1.bytepluses.com',
    });

    const [seedanceUrl, seedanceOptions] = seedanceCall;
    expect(seedanceUrl).toBe('https://example.test/api/v3/contents/generations/tasks');
    expect(seedanceOptions.headers.Authorization).toBe('Bearer modelark-test-key');

    const forwardedBody = JSON.parse(seedanceOptions.body);
    expect(forwardedBody.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image_url',
          role: 'reference_image',
          image_url: expect.objectContaining({
            url: 'https://presigned.example/read/image',
          }),
        }),
        expect.objectContaining({
          type: 'image_url',
          role: 'reference_image',
          image_url: expect.objectContaining({
            url: 'asset://asset-image-123',
          }),
        }),
        expect.objectContaining({
          type: 'video_url',
          role: 'reference_video',
          video_url: expect.objectContaining({
            url: 'https://presigned.example/read/video',
          }),
        }),
        expect.objectContaining({
          type: 'audio_url',
          role: 'reference_audio',
          audio_url: expect.objectContaining({
            url: 'https://presigned.example/read/audio',
          }),
        }),
      ])
    );

    const data = JSON.parse(res._getData());
    expect(data.id).toBe('seedance-task-123');
    expect(data.localMediaStagedToTos).toBe(true);
    expect(data.stagedMediaCount).toBe(3);
    expect(data.assetReferencesUsed).toBe(true);
    expect(data.assetReferenceCount).toBe(1);
  });
});
