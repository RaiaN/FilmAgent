/**
 * @jest-environment node
 */
// THE RULE: an API failure (rate limit, timeout, content screen, bad parameter) is one
// attempt and an error that names the input — retrying is the director's call. OUR checks on
// what a model wrote get one corrective re-ask naming what failed. Nothing is ever dropped,
// cut or swapped.
const fs = require('fs');
const path = require('path');
const { startTake } = require('../utils/film/core/shoot');
const { animate } = require('../utils/film/core/operations');
const { storyboardMoments, castDraftFromParsed } = require('../utils/film/core/storyboard');
const { applyDeployModels, MODEL_ENV_VARS } = require('../utils/film/suiteConfig');

// Every model slot configured (ids are placeholders — no call leaves the test).
applyDeployModels(Object.fromEntries(Object.keys(MODEL_ENV_VARS).map((k) => [k, `test-${k}`])));

// The skills library reads skills/<id>/SKILL.md through /api/film/skills — served from disk here.
beforeAll(() => {
  const dir = path.join(__dirname, '..', 'skills');
  const skills = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'SKILL.md')))
    .map((d) => ({ id: d, name: d, text: fs.readFileSync(path.join(dir, d, 'SKILL.md'), 'utf8'), models: [], tasks: [] }));
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ skills }) }));
});

const shot = (over = {}) => ({ motion: '[Image 1] walks in.', refUrls: ['u-dan', 'u-flat'], durationSec: 6, resolution: '480p', ratio: '16:9', modelKey: 'seedance25', draft: true, ...over });
const failing = (message) => ({ client: { startVideo: jest.fn(async () => { throw new Error(message); }) } });

describe('a take', () => {
  test('a screened reference fails the take, named — nothing dropped, one call', async () => {
    const ctx = failing('InvalidParameter: content[2].image_url may contain sensitive information');
    await expect(startTake(shot(), ['a1', 'a2'], ctx, { nameOf: (u) => (u === 'u-flat' ? 'Abandoned flat' : 'Daniel') }))
      .rejects.toThrow(/rejected Abandoned flat \(sent as an Asset Library asset\)/);
    expect(ctx.client.startVideo).toHaveBeenCalledTimes(1);
  });
  test('an asset Ark no longer has is reported with the stale id — no re-registration, no retry', async () => {
    const ctx = failing('The specified asset asset-123 is not found: content[1].image_url');
    const err = await startTake(shot(), ['asset-123', 'a2'], ctx, { nameOf: () => 'Daniel' }).catch((e) => e);
    expect(err.message).toMatch(/Daniel's Asset Library entry no longer exists/);
    expect(err.staleAsset).toEqual({ url: 'u-dan', assetId: 'asset-123' });
    expect(ctx.client.startVideo).toHaveBeenCalledTimes(1);
  });
  test('the output-audio screen is reported — the take is not reshot without sound', async () => {
    const ctx = failing('output audio may contain sensitive information');
    await expect(startTake(shot(), [], ctx)).rejects.toThrow(/rejected the sound it generated/);
    expect(ctx.client.startVideo).toHaveBeenCalledTimes(1);
  });
  test('a transient failure is reported, not retried', async () => {
    const ctx = failing('503 server overload, retry later');
    await expect(startTake(shot(), [], ctx)).rejects.toThrow(/overload/);
    expect(ctx.client.startVideo).toHaveBeenCalledTimes(1);
  });
  test('more references than the model takes is an error, never a cut', async () => {
    const ctx = { client: { startVideo: jest.fn(async () => ({ taskId: 't' })) } };
    const many = Array.from({ length: 31 }, (_, i) => `u${i}`);
    await expect(animate({ motion: 'x', refUrls: many, modelKey: 'seedance25' }, ctx)).rejects.toThrow(/31 reference images — this step takes at most 30/);
    expect(ctx.client.startVideo).not.toHaveBeenCalled();
  });
  test('every reference is sent, in order, as given', async () => {
    const ctx = { client: { startVideo: jest.fn(async () => ({ taskId: 't' })) } };
    await startTake(shot(), ['a1', null], ctx);
    const { content } = ctx.client.startVideo.mock.calls[0][0];
    expect(content.slice(1)).toEqual([
      { type: 'image_asset_id', asset_id: 'a1', role: 'reference_image' },
      { type: 'image_url', image_url: { url: 'u-flat' }, role: 'reference_image' },
    ]);
  });
});

describe('planning', () => {
  test('a failed CHECK gets one corrective re-ask naming what failed; still failing is an error', async () => {
    const reason = jest.fn(async () => ({ content: JSON.stringify({ moments: [{ title: 'A', quote: 'not in the script', seconds: 40, place: '' }] }) }));
    await expect(storyboardMoments({ script: 'INT. FLAT - NIGHT\nDaniel enters.' }, { client: { reason } })).rejects.toThrow(/Key moments failed the checks/);
    expect(reason).toHaveBeenCalledTimes(2);
    expect(reason.mock.calls[1][0].prompt).toMatch(/not word-for-word in the script/);
  });
  test('the corrective re-ask fixes it — the second answer is used', async () => {
    const good = { title: 'Enters', quote: 'Daniel enters.', seconds: 6, place: 'Flat' };
    const reason = jest.fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ moments: [{ ...good, seconds: 40 }] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ moments: [good] }) });
    const out = await storyboardMoments({ script: 'INT. FLAT - NIGHT\nDaniel enters.' }, { client: { reason } });
    expect(out.map((m) => m.seconds)).toEqual([6]);
    expect(reason).toHaveBeenCalledTimes(2);
  });
  test('an API failure is never re-asked', async () => {
    const reason = jest.fn(async () => { throw new Error('503 server overload'); });
    await expect(storyboardMoments({ script: 'INT. FLAT - NIGHT\nDaniel enters.' }, { client: { reason } })).rejects.toThrow(/overload/);
    expect(reason).toHaveBeenCalledTimes(1);
  });
  test('a script over the limit is an error, never cut to fit', async () => {
    const reason = jest.fn();
    await expect(storyboardMoments({ script: 'x'.repeat(12001) }, { client: { reason } })).rejects.toThrow(/The script is 12,001 characters/);
    expect(reason).not.toHaveBeenCalled();
  });
});

describe('plates', () => {
  test('a rejected plate fails with its reason — one call, no softened prompt; its body sheet is not drawn without it', async () => {
    const generateImage = jest.fn(async () => { throw new Error('the output image may contain sensitive information'); });
    const entries = [];
    await castDraftFromParsed({ arr: [{ type: 'character', name: 'Daniel', facePrompt: 'a man', bodyPrompt: 'full body' }] }, { client: { generateImage } }, { onEntry: (e) => entries.push(e) }).catch(() => {});
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(generateImage.mock.calls[0][0].prompt).not.toMatch(/tasteful/);
    expect(entries.map((e) => [e.name, e.failed, e.error])).toEqual([
      ['Daniel · face', true, 'the output image may contain sensitive information'],
      ['Daniel · body', true, 'its face plate did not render'],
    ]);
  });
  test('a cast plan over the limit is an error, never trimmed', async () => {
    const generateImage = jest.fn();
    const arr = Array.from({ length: 9 }, (_, i) => ({ type: 'prop', name: `P${i}`, prompt: 'x' }));
    await expect(castDraftFromParsed({ arr, max: 8 }, { client: { generateImage } }, {})).rejects.toThrow(/9 assets in the cast plan — this step takes at most 8/);
    expect(generateImage).not.toHaveBeenCalled();
  });
});
