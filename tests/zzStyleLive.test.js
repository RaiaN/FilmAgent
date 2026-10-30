/** @jest-environment node */
// Live, in memory only: a real plate and a real draft under a set Style.
const fs = require('fs');
jest.setTimeout(590000);
const base = 'http://localhost:3000';
const real = global.fetch;
global.fetch = (u, o) => real(String(u).startsWith('/') ? base + u : u, o);
test('style reaches plate and take', async () => {
  const { applyDeployModels } = require('../utils/film/suiteConfig');
  const cfg = await (await real(`${base}/api/film/config`)).json();
  applyDeployModels(cfg.models);
  const { createBrowserClient } = require('../utils/film/core/client');
  const { createRunners } = require('../utils/film/studio/runners');
  const { emptyStudio, newElement, newScene, newShot, pickVersion } = require('../utils/film/studio/model');
  const el = newElement({ kind: 'character', name: 'Morwen' });
  const sc = newScene('Square', { place: 'Square' });
  sc.shots = [newShot({ title: 'Square', seconds: 5, motion: `{{el:${el.id}}} walks across the snowy square and tucks a pine bough onto a wreath, her eyes on the wreath.`, elementIds: [el.id] })];
  let s = { ...emptyStudio(), style: 'Stop-motion clay animation', script: 'EXT. VILLAGE SQUARE - DUSK\nMORWEN (72, silver braid, patched wool cloak) walks through the snow.', elements: [el], scenes: [sc] };
  const set = (f) => { s = typeof f === 'function' ? f(s) : f; };
  const crew = createRunners({ get: () => s, set, ctx: { client: createBrowserClient() } });
  const go = async (req) => { const p = await crew.plan(req, {}); await crew.run(req, p.payload, p.summary); };
  await go({ agent: 'casting', action: 'cast', scope: { type: 'world' }, text: '' });
  const plate = s.elements.find((e) => e.name === 'Morwen').versions[0];
  expect(plate.status).toBe('review');
  s = pickVersion(s, { at: 'element', id: el.id }, plate.id);
  await go({ agent: 'camera', action: 'draft', scope: { type: 'scene', id: sc.id }, text: '' });
  const take = s.scenes[0].shots[0].takes.versions[0];
  fs.writeFileSync(process.env.OUT, JSON.stringify({ plate: { url: plate.cacheUrl || plate.url, prompt: plate.prompt, style: plate.style }, take: { status: take.status, error: take.error, url: take.cacheUrl || take.url, prompt: take.prompt } }, null, 1));
});
