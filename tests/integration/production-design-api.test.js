/**
 * @jest-environment node
 */

import { createMocks } from 'node-mocks-http';
import productionDesignHandler from '../../pages/api/production-design';

describe('Production design API', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('researches the brief, locks 1080p, and creates three production design exploration passes', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            project_summary: 'Ancient cliff observatory city explored through repeatable environment passes.',
            world_foundation: 'Volcanic stone terraces, brass observatory hardware, cable lifts, and a wet, windy atmosphere.',
            design_rules: [
              'Preserve monumental vertical layering.',
              'Avoid sleek generic sci-fi surfaces.',
            ],
            material_palette: [
              'black volcanic stone',
              'oxidized brass',
              'fog-softened glass',
            ],
            spatial_logic: [
              'Public terraces step toward the main tower.',
              'Cable lifts connect lower industrial edges to upper scholarly zones.',
            ],
            camera_strategy: 'Use gliding moves that reveal hierarchy from approach to landmark.',
            continuation_hooks: [
              'Keep the main tower silhouette stable.',
              'Maintain the wet storm palette for future adjacent district passes.',
            ],
            exploration_passes: [
              {
                key: 'anchor',
                label: 'Anchor Pass',
                goal: 'Establish the core environment and hierarchy.',
                prompt: 'A slow approach into the observatory terraces, defining the primary tower and circulation routes.',
              },
              {
                key: 'adjacent',
                label: 'Adjacent Pass',
                goal: 'Expand to a connected district without breaking continuity.',
                prompt: 'Follow a route from the main terraces into an adjacent market-and-workshop ledge carved into the same cliff system.',
              },
              {
                key: 'frontier',
                label: 'Frontier Pass',
                goal: 'Test a bolder edge of the same world.',
                prompt: 'Push outward to a storm-exposed telescope platform at the city edge while preserving the same material language.',
              },
            ],
          }),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'task-anchor', status: 'queued' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'task-adjacent', status: 'queued' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'task-frontier', status: 'queued' }),
      });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        prompt: 'Build the production design for a cliffside observatory city.',
        sourceMaterials: 'Sketch plus AI stills plus Photoshop paintover.',
        designRules: 'Keep the world monumental and tactile.',
        ruleGroups: {
          architecture: 'Keep the terraces vertically layered.',
          materials: 'Use volcanic stone and oxidized brass.',
        },
        explorationGoal: 'Define camera routes for ongoing world exploration.',
        continuityNotes: 'Keep silhouettes stable for future passes.',
        sourceImages: ['data:image/png;base64,source-image'],
        sourceVideos: ['data:video/mp4;base64,source-video'],
        continuationImages: ['https://example.test/continuation-image.png'],
        continuationVideos: ['https://example.test/continuation-video.mp4'],
        continuedFrom: { runId: 'prior-run', passKey: 'anchor' },
        apiKey: 'test-api-key',
        baseUrl: 'https://example.test/api/v3',
        model: 'ep-20260415171928-pdvvr',
        ratio: '21:9',
        duration: 20,
        resolution: '720p',
      },
    });

    await productionDesignHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(4);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://example.test/api/v3/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-api-key',
          'Content-Type': 'application/json',
        }),
      })
    );

    const researchCallBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(researchCallBody.input[1].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'input_text' }),
        expect.objectContaining({ type: 'input_image', image_url: 'data:image/png;base64,source-image' }),
        expect.objectContaining({ type: 'input_video', video_url: 'data:video/mp4;base64,source-video' }),
        expect.objectContaining({ type: 'input_image', image_url: 'https://example.test/continuation-image.png' }),
        expect.objectContaining({ type: 'input_video', video_url: 'https://example.test/continuation-video.mp4' }),
      ])
    );

    const secondCallBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    const thirdCallBody = JSON.parse(global.fetch.mock.calls[2][1].body);
    const fourthCallBody = JSON.parse(global.fetch.mock.calls[3][1].body);

    [secondCallBody, thirdCallBody, fourthCallBody].forEach((payload) => {
      expect(payload.model).toBe('ep-20260415171928-pdvvr');
      expect(payload.duration).toBe(15);
      expect(payload.resolution).toBe('1080p');
      expect(payload.ratio).toBe('21:9');
      expect(payload.generate_audio).toBe(false);
      expect(payload.content[0].type).toBe('text');
      expect(payload.content[0].text).toContain('Keep the world consistent enough');
      expect(payload.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'image_url', role: 'reference_image' }),
          expect.objectContaining({ type: 'video_url', role: 'reference_video' }),
        ])
      );
    });

    expect(secondCallBody.content[0].text).toContain('Anchor Pass');
    expect(thirdCallBody.content[0].text).toContain('adjacent district');
    expect(fourthCallBody.content[0].text).toContain('storm-exposed telescope platform');

    const data = JSON.parse(res._getData());
    expect(data.duration).toBe(15);
    expect(data.resolution).toBe('1080p');
    expect(data.researchModel).toBe('seed-2-0-pro-260328');
    expect(data.designRules).toEqual([
      'Preserve monumental vertical layering.',
      'Avoid sleek generic sci-fi surfaces.',
    ]);
    expect(data.tasks).toHaveLength(3);
    expect(data.tasks.map((item) => item.key)).toEqual(['anchor', 'adjacent', 'frontier']);
  });

  test('rejects requests without a core brief before any research step runs', async () => {
    global.fetch = jest.fn();

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        prompt: '   ',
        apiKey: 'test-api-key',
        baseUrl: 'https://example.test/api/v3',
      },
    });

    await productionDesignHandler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Core brief is required' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('extracts research text when the responses API returns reasoning followed by a message output item', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [
            {
              type: 'reasoning',
              status: 'completed',
            },
            {
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    project_summary: 'Observatory city exploration package.',
                    world_foundation: 'Stone terraces and scientific landmarks.',
                    design_rules: ['Keep silhouettes stable.'],
                    material_palette: ['volcanic stone'],
                    spatial_logic: ['Terraces step toward the tower.'],
                    camera_strategy: 'Glide from edge to center.',
                    continuation_hooks: ['Preserve tower silhouette.'],
                    exploration_passes: [
                      {
                        key: 'anchor',
                        label: 'Anchor Pass',
                        goal: 'Lock the world identity.',
                        prompt: 'Approach the main observatory terraces.',
                      },
                      {
                        key: 'adjacent',
                        label: 'Adjacent Pass',
                        goal: 'Expand to a nearby district.',
                        prompt: 'Move into a connected cliff market district.',
                      },
                      {
                        key: 'frontier',
                        label: 'Frontier Pass',
                        goal: 'Test a bolder edge.',
                        prompt: 'Push toward a storm-facing telescope platform.',
                      },
                    ],
                  }),
                },
              ],
            },
          ],
        }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'task-generic', status: 'queued' }),
      });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        prompt: 'Build the production design for a cliffside observatory city.',
        apiKey: 'test-api-key',
        baseUrl: 'https://example.test/api/v3',
        model: 'ep-20260415171928-pdvvr',
      },
    });

    await productionDesignHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.projectSummary).toBe('Observatory city exploration package.');
    expect(data.tasks).toHaveLength(3);
  });
});
