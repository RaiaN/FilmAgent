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
      reference_image_refs: [],
      reference_video_refs: [{ type: 'url', value: 'https://example.com/reference.mp4' }],
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

  test('preserves insertion order: asset ID first, then local image', () => {
    const payload = constructSeedancePayload({
      model: 'seedance-1-5-pro-251215',
      prompt: 'Animate this clip. [Image 1] is the style, [Image 2] is the subject.',
      resolution: '720p',
      ratio: '16:9',
      duration: 5,
      watermark: false,
      seed: -1,
      generate_audio: true,
      reference_image_refs: [
        { type: 'asset', value: 'asset-image-123' },
        { type: 'url', value: 'data:image/png;base64,abc123' },
      ],
      reference_video_refs: [],
      reference_audios: [],
    });

    const imageEntries = payload.content.filter(c => c.role === 'reference_image');
    expect(imageEntries).toEqual([
      {
        type: 'image_url',
        image_url: { url: 'asset://asset-image-123' },
        role: 'reference_image',
      },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,abc123' },
        role: 'reference_image',
      },
    ]);
  });

  test('video asset ID is wrapped in asset:// and placed in reference_video role', () => {
    const payload = constructSeedancePayload({
      model: 'seedance-1-5-pro-251215',
      prompt: 'Use this video as reference.',
      resolution: '720p',
      ratio: '16:9',
      duration: 5,
      watermark: false,
      seed: -1,
      generate_audio: true,
      reference_image_refs: [],
      reference_video_refs: [{ type: 'asset', value: 'asset-video-456' }],
      reference_audios: [],
    });

    expect(payload.content).toEqual(
      expect.arrayContaining([
        {
          type: 'video_url',
          video_url: { url: 'asset://asset-video-456' },
          role: 'reference_video',
        },
      ])
    );
  });

  test('preserves an already-prefixed asset:// URL', () => {
    const payload = constructSeedancePayload({
      model: 'seedance-1-5-pro-251215',
      prompt: 'Animate this product shot.',
      resolution: '720p',
      ratio: '16:9',
      duration: 5,
      watermark: false,
      seed: -1,
      generate_audio: true,
      reference_image_refs: [
        { type: 'asset', value: 'asset://asset-20260225023032-gnzwk' },
      ],
      reference_video_refs: [],
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
