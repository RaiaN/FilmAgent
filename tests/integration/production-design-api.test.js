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

  test('builds the portrait anchor, close sheet, and distant sheet with Seed 2.0 Pro plus Seedream', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output_text: '[MEDIUM] Fashion editorial photograph. [SUBJECT] Character. [CAMERA] Canon EOS R5. [SKIN_REFLECTANCE] Real skin. [HAIR] Blonde. [EXPRESSION] Direct. [FORBIDDEN] No plastic finish.',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: 'https://example.test/portrait.png' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [
            { type: 'reasoning', status: 'completed' },
            {
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'Close character sheet prompt.' }],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output_text: 'Distant character sheet prompt.' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: 'https://example.test/close-sheet.png' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: 'https://example.test/distant-sheet.png' }] }),
      });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        prompt: 'A Scandinavian woman in her early 30s with sharp cheekbones and direct eye contact.',
        apiKey: 'test-api-key',
        baseUrl: 'https://example.test/api/v3',
        model: 'seedream-5-0-260128',
        size: '2K',
      },
    });

    await productionDesignHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(6);

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

    const stepOneBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(stepOneBody.model).toBe('seed-2-0-pro-260328');
    expect(stepOneBody.input[0].content[0].text).toContain('[MEDIUM]');
    expect(stepOneBody.input[0].content[0].text).toContain('The generated image must contain no text');
    expect(stepOneBody.input[1].content[0].text).toContain('Transform the following fictional character description');

    const portraitBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(portraitBody.model).toBe('ep-20260501195034-hj78f');
    expect(portraitBody.prompt).toContain('[MEDIUM]');
    expect(portraitBody.size).toBe('4K');

    const closePromptBody = JSON.parse(global.fetch.mock.calls[2][1].body);
    const distantPromptBody = JSON.parse(global.fetch.mock.calls[3][1].body);

    [closePromptBody, distantPromptBody].forEach((payload) => {
      expect(payload.model).toBe('seed-2-0-pro-260328');
      expect(payload.input[1].content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'input_text' }),
          expect.objectContaining({ type: 'input_image', image_url: 'https://example.test/portrait.png' }),
        ])
      );
    });
    expect(closePromptBody.input[1].content).toHaveLength(2);
    expect(distantPromptBody.input[1].content).toHaveLength(2);

    expect(closePromptBody.input[1].content[0].text).toContain('2 view angles, front and side, close shot');
    expect(closePromptBody.input[1].content[0].text).toContain('Original character description: A Scandinavian woman in her early 30s with sharp cheekbones and direct eye contact.');
    expect(closePromptBody.input[1].content[0].text).toContain('Portrait anchor prompt: [MEDIUM]');
    expect(closePromptBody.input[1].content[0].text).toContain('Keep wardrobe continuity');
    expect(closePromptBody.input[1].content[0].text).toContain('No text, labels, captions, logos, numbers, or watermark-like marks');
    expect(distantPromptBody.input[1].content[0].text).toContain('2 view angles, front and side, distant shot');
    expect(distantPromptBody.input[1].content[0].text).toContain('Never default to generic black clothing');
    expect(distantPromptBody.input[1].content[0].text).toContain('true full-body turnaround');
    expect(distantPromptBody.input[1].content[0].text).toContain('show the entire figure from head to toe');
    expect(distantPromptBody.input[1].content[0].text).toContain('No text, labels, captions, logos, numbers, or watermark-like marks');

    const closeImageBody = JSON.parse(global.fetch.mock.calls[4][1].body);
    const distantImageBody = JSON.parse(global.fetch.mock.calls[5][1].body);

    [closeImageBody, distantImageBody].forEach((payload) => {
      expect(payload.model).toBe('ep-20260501195034-hj78f');
      expect(payload.size).toBe('4K');
      expect(payload.image).toBe('https://example.test/portrait.png');
    });

    expect(closeImageBody.prompt).toBe('Close character sheet prompt.');
    expect(distantImageBody.prompt).toBe('Distant character sheet prompt.');

    const data = JSON.parse(res._getData());
    expect(data.researchModel).toBe('seed-2-0-pro-260328');
    expect(data.generationModel).toBe('ep-20260501195034-hj78f');
    expect(data.characterPrompt).toContain('[MEDIUM]');
    expect(data.portrait.imageUrl).toBe('https://example.test/portrait.png');
    expect(data.closeSheet.imageUrl).toBe('https://example.test/close-sheet.png');
    expect(data.distantSheet.imageUrl).toBe('https://example.test/distant-sheet.png');
    expect(data.steps.map((item) => item.key)).toEqual([
      'portrait-anchor',
      'close-sheet',
      'distant-sheet',
    ]);
  });

  test('creates portrait plus two character sheets without clothing inputs', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output_text: '[MEDIUM] Editorial portrait. [SUBJECT] Character. [CAMERA] Camera. [SKIN_REFLECTANCE] Skin. [HAIR] Hair. [EXPRESSION] Expression. [FORBIDDEN] No plastic.',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: 'https://example.test/portrait.png' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output_text: 'Close prompt without clothing.' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output_text: 'Distant prompt without clothing.' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: 'https://example.test/close.png' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: 'https://example.test/distant.png' }] }),
      });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        prompt: 'A weathered male detective with tired blue eyes.',
        apiKey: 'test-api-key',
        baseUrl: 'https://example.test/api/v3',
        size: '2K',
      },
    });

    await productionDesignHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(6);

    const closePromptBody = JSON.parse(global.fetch.mock.calls[2][1].body);
    expect(closePromptBody.input[1].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'input_text' }),
        expect.objectContaining({ type: 'input_image', image_url: 'https://example.test/portrait.png' }),
      ])
    );
    expect(closePromptBody.input[1].content).toHaveLength(2);

    const data = JSON.parse(res._getData());
    expect(data.steps.map((item) => item.key)).toEqual([
      'portrait-anchor',
      'close-sheet',
      'distant-sheet',
    ]);
    expect(data.size).toBe('4K');
  });

  test('rejects requests without a character description before any generation step runs', async () => {
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
    expect(JSON.parse(res._getData())).toEqual({ error: 'Fictional character description is required' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
