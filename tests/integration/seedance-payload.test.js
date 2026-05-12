/**
 * @jest-environment node
 */
import { constructSeedancePayload } from '../../utils/apiHelpers';

describe('Seedance payload construction', () => {
  test('keeps public reference video and audio URLs in content', () => {
    const payload = constructSeedancePayload({
      model: 'seedance-1-5-pro-251215',
      prompt: 'A cinematic waterfall at sunrise.',
      resolution: '720p',
      ratio: '16:9',
      duration: 5,
      watermark: false,
      seed: -1,
      generate_audio: true,
      reference_images: [],
      reference_image_asset_ids: [],
      reference_videos: ['https://example.com/reference.mp4'],
      reference_audios: ['https://example.com/reference.mp3'],
    });

    expect(payload.content).toEqual(
      expect.arrayContaining([
        {
          type: 'video_url',
          video_url: { url: 'https://example.com/reference.mp4' },
          role: 'reference_video',
        },
        {
          type: 'audio_url',
          audio_url: { url: 'https://example.com/reference.mp3' },
          role: 'reference_audio',
        },
      ])
    );
  });

  test('keeps local uploaded reference video inputs so the API route can stage them to TOS', () => {
    const payload = constructSeedancePayload({
      model: 'seedance-1-5-pro-251215',
      prompt: 'Animate this clip.',
      resolution: '720p',
      ratio: '16:9',
      duration: 5,
      watermark: false,
      seed: -1,
      generate_audio: true,
      reference_images: ['data:image/png;base64,abc123'],
      reference_image_asset_ids: ['asset-image-123'],
      reference_videos: ['data:video/mp4;base64,abc123'],
      reference_audios: [],
    });

    expect(payload.content).toEqual(
      expect.arrayContaining([
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,abc123' },
          role: 'reference_image',
        },
        {
          type: 'image_url',
          image_url: { url: 'asset://asset-image-123' },
          role: 'reference_image',
        },
        {
          type: 'video_url',
          video_url: { url: 'data:video/mp4;base64,abc123' },
          role: 'reference_video',
        },
      ])
    );
  });

  test('preserves an already-prefixed asset reference for Seedance 2.0', () => {
    const payload = constructSeedancePayload({
      model: 'seedance-1-5-pro-251215',
      prompt: 'Animate this product shot.',
      resolution: '720p',
      ratio: '16:9',
      duration: 5,
      watermark: false,
      seed: -1,
      generate_audio: true,
      reference_images: [],
      reference_image_asset_ids: ['asset://asset-20260225023032-gnzwk'],
      reference_videos: [],
      reference_audios: [],
    });

    expect(payload.content).toEqual(
      expect.arrayContaining([
        {
          type: 'image_url',
          image_url: { url: 'asset://asset-20260225023032-gnzwk' },
          role: 'reference_image',
        },
      ])
    );
  });
});
