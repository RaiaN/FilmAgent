/**
 * @jest-environment node
 */
// tests/integration/api-nodes.test.js
import { createMocks } from 'node-mocks-http';
import seedHandler from '../../pages/api/seed';
import seedanceHandler from '../../pages/api/seedance';
import seedreamHandler from '../../pages/api/seedream';
import fs from 'fs';
import path from 'path';

describe('Seed API request formatting', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    test('uses Responses API input_image format for seed-2-0-pro-260328 image requests', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                output_text: 'Image analysis result'
            })
        });

        const { req, res } = createMocks({
            method: 'POST',
            body: {
                prompt: 'Describe this image',
                apiKey: 'test-api-key',
                modelId: 'seed-2-0-pro-260328',
                baseUrl: 'https://example.test/api/v3',
                image: 'data:image/png;base64,abc123'
            },
        });

        await seedHandler(req, res);

        expect(res._getStatusCode()).toBe(200);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch).toHaveBeenCalledWith(
            'https://example.test/api/v3/responses',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'Bearer test-api-key',
                    'Content-Type': 'application/json',
                }),
                body: JSON.stringify({
                    model: 'seed-2-0-pro-260328',
                    stream: false,
                    input: [
                        {
                            role: 'user',
                            content: [
                                { type: 'input_text', text: 'Describe this image' },
                                { type: 'input_image', image_url: 'data:image/png;base64,abc123' }
                            ]
                        }
                    ]
                }),
            })
        );

        expect(JSON.parse(res._getData())).toEqual(
            expect.objectContaining({ content: 'Image analysis result' })
        );
    });
});

describe('Workflow Nodes API Integration (Real API Calls)', () => {
    // Increase timeout for real API calls
    jest.setTimeout(60000); 

    const apiKey = process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;

    beforeAll(() => {
        if (!apiKey) {
            console.warn('⚠️  SKIPPING Integration Tests: No MODELARK_API_KEY found in env.');
        }
    });

    // Skip all tests if no API key
    if (!apiKey) {
        it('skips tests due to missing API key', () => {
            expect(true).toBe(true);
        });
        return;
    }

    test('Seedream (Image Gen) - Text to Image', async () => {
        const { req, res } = createMocks({
            method: 'POST',
            body: {
                prompt: 'A futuristic city with flying cars, cyberpunk style, high resolution',
                apiKey: apiKey,
                modelId: 'seedream-5-0-260128',
                size: '2K'
            },
        });

        await seedreamHandler(req, res);

        if (res._getStatusCode() !== 200) {
            console.error('Seedream Error:', res._getData());
        }
        expect(res._getStatusCode()).toBe(200);
        const data = JSON.parse(res._getData());
        expect(data.imageUrl).toBeDefined();
        console.log('Seedream Output:', data.imageUrl);
    });

    test('Seedance (Video Gen) - Text to Video', async () => {
        const { req, res } = createMocks({
            method: 'POST',
            body: {
                model: 'seedance-1-5-pro-251215',
                content: [
                    { type: 'text', text: 'A cat jumping over a fence, slow motion' }
                ],
                resolution: '720p',
                duration: 5,
                apiKey: apiKey
            },
        });

        await seedanceHandler(req, res);

        if (res._getStatusCode() !== 200) {
            console.error('Seedance Error:', res._getData());
        }
        // Seedance is async, returns task info
        expect(res._getStatusCode()).toBe(200);
        const data = JSON.parse(res._getData());
        console.log('Seedance Response:', data);
        
        // Adjust expectations based on actual response structure
        // API usually returns { code: 0, data: { id: "...", status: "..." }, ... } or just { id: "..." }
        // Let's check what we got.
        // If it's direct passthrough, it might be { id: "task_id" }
        expect(data.id || data.data?.id).toBeDefined();
        console.log('Seedance Task ID:', data.id);
    });

    test('VLM (LLM Analysis) - Text Analysis', async () => {
        const { req, res } = createMocks({
            method: 'POST',
            body: {
                prompt: 'What is the capital of France?',
                apiKey: apiKey,
                modelId: 'seed-2-0-mini-260215'
            },
        });

        await seedHandler(req, res);

        if (res._getStatusCode() !== 200) {
            console.error('VLM Error:', res._getData());
        }
        expect(res._getStatusCode()).toBe(200);
        const data = JSON.parse(res._getData());
        expect(data.content).toBeDefined();
        expect(data.content).toMatch(/Paris/i);
        console.log('VLM Output:', data.content);
    });

    test('VLM (LLM Analysis) - Video Analysis', async () => {
        const videoPath = path.join(process.cwd(), 'tests/fixtures/pirate.mp4');
        if (!fs.existsSync(videoPath)) {
            console.warn('Skipping Video Analysis test: pirate.mp4 not found');
            return;
        }

        const videoBuffer = fs.readFileSync(videoPath);
        const videoBase64 = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;

        const { req, res } = createMocks({
            method: 'POST',
            body: {
                prompt: 'Describe this video in detail',
                apiKey: apiKey,
                modelId: 'seed-2-0-mini-260215',
                video: videoBase64
            },
        });

        await seedHandler(req, res);

        if (res._getStatusCode() !== 200) {
            console.error('VLM Video Analysis Error:', res._getData());
        }
        expect(res._getStatusCode()).toBe(200);
        const data = JSON.parse(res._getData());
        expect(data.content).toBeDefined();
        console.log('VLM Video Analysis Output:', data.content);
    });
});
