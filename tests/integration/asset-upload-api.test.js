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
import assetUploadHandler from '../../pages/api/asset-upload';

describe('Asset upload API', () => {
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
    MODELARK_ASSET_GROUP_ID: process.env.MODELARK_ASSET_GROUP_ID,
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
    process.env.MODELARK_ASSET_GROUP_ID = 'group-1700000000000-envtest01';
    process.env.MODELARK_TOS_BUCKET = 'my-bucket';
    process.env.MODELARK_TOS_REGION = 'ap-southeast-1';
    process.env.MODELARK_TOS_ENDPOINT = 'tos-ap-southeast-1.bytepluses.com';
    process.env.MODELARK_TOS_OBJECT_PREFIX = 'asset-upload';
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
    process.env.MODELARK_ASSET_GROUP_ID = originalEnv.MODELARK_ASSET_GROUP_ID;
    process.env.MODELARK_TOS_BUCKET = originalEnv.MODELARK_TOS_BUCKET;
    process.env.MODELARK_TOS_REGION = originalEnv.MODELARK_TOS_REGION;
    process.env.MODELARK_TOS_ENDPOINT = originalEnv.MODELARK_TOS_ENDPOINT;
    process.env.MODELARK_TOS_OBJECT_PREFIX = originalEnv.MODELARK_TOS_OBJECT_PREFIX;
    process.env.MODELARK_TOS_PUBLIC_BASE_URL = originalEnv.MODELARK_TOS_PUBLIC_BASE_URL;
  });

  test('creates the asset group when CreateAsset reports the group is missing, then retries successfully', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          ResponseMetadata: {
            Error: {
              Message: 'The specified asset_group group-1700000000001-abc12345 is not found.',
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Result: {
            Id: 'group-1700000000999-created01',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Result: {
            Id: 'asset-456',
            GroupId: 'group-1700000000999-created01',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Result: {
            Id: 'asset-456',
            GroupId: 'group-1700000000999-created01',
            Status: 'Processing',
            URL: 'https://example.com/portrait.png',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Result: {
            Id: 'asset-456',
            GroupId: 'group-1700000000999-created01',
            Status: 'Active',
            URL: 'https://example.com/portrait.png',
            AssetType: 'Image',
            ProjectName: 'default',
          },
        }),
      });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        assetGroupId: 'group-1700000000001-abc12345',
        imageUrl: 'https://example.com/portrait.png',
        assetName: 'hero-closeup',
        pollUntilReady: true,
      },
    });

    await assetUploadHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(5);

    const [firstCreateAssetUrl, firstCreateAssetOptions] = global.fetch.mock.calls[0];
    expect(firstCreateAssetUrl).toContain('Action=CreateAsset');
    expect(firstCreateAssetUrl).toContain('Version=2024-01-01');
    expect(firstCreateAssetOptions.headers.Authorization).toContain('Credential=ak-env-test/');
    expect(firstCreateAssetOptions.headers.Authorization).toContain('Signature=');

    expect(JSON.parse(firstCreateAssetOptions.body)).toEqual({
      GroupId: 'group-1700000000001-abc12345',
      URL: 'https://example.com/portrait.png',
      AssetType: 'Image',
      Name: 'hero-closeup',
      ProjectName: 'default',
    });

    const [, createGroupOptions] = global.fetch.mock.calls[1];
    expect(JSON.parse(createGroupOptions.body)).toEqual({
      Name: 'group-1700000000001-abc12345',
      Description: '',
      GroupType: 'AIGC',
      ProjectName: 'default',
    });

    const [, secondCreateAssetOptions] = global.fetch.mock.calls[2];
    expect(JSON.parse(secondCreateAssetOptions.body)).toEqual({
      GroupId: 'group-1700000000999-created01',
      URL: 'https://example.com/portrait.png',
      AssetType: 'Image',
      Name: 'hero-closeup',
      ProjectName: 'default',
    });

    const [, firstGetAssetOptions] = global.fetch.mock.calls[3];
    const [, secondGetAssetOptions] = global.fetch.mock.calls[4];
    expect(JSON.parse(firstGetAssetOptions.body)).toEqual({
      Id: 'asset-456',
      ProjectName: 'default',
    });
    expect(JSON.parse(secondGetAssetOptions.body)).toEqual({
      Id: 'asset-456',
      ProjectName: 'default',
    });

    const data = JSON.parse(res._getData());
    expect(data.groupId).toBe('group-1700000000999-created01');
    expect(data.groupCreated).toBe(true);
    expect(data.assetId).toBe('asset-456');
    expect(data.asset.Status).toBe('Active');
    expect(data.poll).toEqual({ attempts: 2, done: true });
  });

  test('falls back to MODELARK_ASSET_GROUP_ID when the request omits assetGroupId', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Result: {
            Id: 'asset-999',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Result: {
            Id: 'asset-999',
            GroupId: 'group-1700000000002-def67890',
            Status: 'Pending',
            URL: 'https://example.com/asset.png',
          },
        }),
      });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        imageUrl: 'https://example.com/asset.png',
        pollUntilReady: false,
      },
    });

    await assetUploadHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toContain('Action=CreateAsset');
    expect(global.fetch.mock.calls[1][0]).toContain('Action=GetAsset');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).GroupId).toBe('group-1700000000000-envtest01');

    const data = JSON.parse(res._getData());
    expect(data.groupId).toBe('group-1700000000000-envtest01');
    expect(data.asset.Status).toBe('Pending');
  });

  test('rejects local file paths because CreateAsset requires a public URL', async () => {
    global.fetch = jest.fn();

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        assetGroupId: 'group-1700000000003-ghi90123',
        imageUrl: '/Users/bytedance/Desktop/portrait.png',
      },
    });

    await assetUploadHandler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({
      error: 'Image URL must be a publicly accessible http or https URL. Local file paths are not supported by CreateAsset.',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects explicitly invalid asset group ids', async () => {
    global.fetch = jest.fn();

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        assetGroupId: 'group-env-default',
        imageUrl: 'https://example.com/asset.png',
      },
    });

    await assetUploadHandler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({
      error: 'Asset group id must match format group-{timestamp}-{random}.',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('stages a local image to TOS without creating an asset when stageOnly is true', async () => {
    mockGetPreSignedUrl
      .mockReturnValueOnce('https://presigned.example/upload/stage-only')
      .mockReturnValueOnce('https://presigned.example/read/stage-only');
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => '',
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        localImageData: 'data:image/png;base64,aGVsbG8=',
        localImageName: 'stage-only.png',
        stageOnly: true,
      },
    });

    await assetUploadHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://presigned.example/upload/stage-only');

    const data = JSON.parse(res._getData());
    expect(data.stagedOnly).toBe(true);
    expect(data.stagedFromLocalFile).toBe(true);
    expect(data.imageUrl).toBe('https://presigned.example/read/stage-only');
    expect(data.objectUrl).toContain('https://tos-ap-southeast-1.bytepluses.com/my-bucket/asset-upload/');
    expect(data.tos.endpoint).toBe('tos-ap-southeast-1.bytepluses.com');
  });

  test('stages a local image to TOS before creating the asset', async () => {
    mockGetPreSignedUrl
      .mockReturnValueOnce('https://presigned.example/upload/local-image')
      .mockReturnValueOnce('https://presigned.example/read/local-image');
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Result: {
            Id: 'asset-local',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Result: {
            Id: 'asset-local',
            GroupId: 'group-1700000000004-jkl45678',
            Status: 'Active',
            URL: 'https://my-bucket.tos-ap-southeast-1.bytepluses.com/asset-upload/123-image.png',
          },
        }),
      });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        assetGroupId: 'group-1700000000004-jkl45678',
        localImageData: 'data:image/png;base64,aGVsbG8=',
        localImageName: 'image.png',
        pollUntilReady: false,
      },
    });

    await assetUploadHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(3);

    const [tosUrl, tosOptions] = global.fetch.mock.calls[0];
    expect(tosUrl).toBe('https://presigned.example/upload/local-image');
    expect(tosOptions.method).toBe('PUT');
    expect(tosOptions.headers['Content-Type']).toBe('image/png');
    const { TosClient } = require('@volcengine/tos-sdk');
    expect(TosClient).toHaveBeenCalledWith({
      accessKeyId: 'ak-env-test',
      accessKeySecret: 'sk-env-test',
      region: 'ap-southeast-1',
      endpoint: 'tos-ap-southeast-1.bytepluses.com',
    });

    const [, createAssetOptions] = global.fetch.mock.calls[1];
    const createAssetBody = JSON.parse(createAssetOptions.body);
    expect(createAssetBody.GroupId).toBe('group-1700000000004-jkl45678');
    expect(createAssetBody.URL).toBe('https://presigned.example/read/local-image');
    expect(createAssetBody.AssetType).toBe('Image');

    const data = JSON.parse(res._getData());
    expect(data.stagedFromLocalFile).toBe(true);
    expect(data.tos.bucket).toBe('my-bucket');
    expect(data.tos.endpoint).toBe('tos-ap-southeast-1.bytepluses.com');
    expect(data.assetId).toBe('asset-local');
  });
});
