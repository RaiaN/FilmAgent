/**
 * @jest-environment node
 *
 * Storyboard generation harness (OPT-IN, hits the live ModelArk API).
 *
 * Generates N distinct film ideas → for each: a bible (cast/places) → a full
 * Storyboard (shots, each a frame sequence open·mid·close) → renders every frame →
 * saves everything (JSON + the frame JPGs + a viewable index.html) under
 * tests/storyboards/<timestamp>/.
 *
 * It is SKIPPED unless you opt in (it costs money + takes a while):
 *
 *   RUN_STORYBOARD_GEN=1 npm test -- tests/storyboards/generate.test.js
 *
 * Tunables (env): STB_IDEAS (default 10), STB_FRAMES (frames/shot, default 3),
 * STB_SHOTS (max shots/storyboard, default auto). Needs MODELARK_API_KEY +
 * MODELARK_API_BASE_URL in .env.local (next/jest loads it).
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
// next/jest doesn't push .env.local into process.env for node tests — load it ourselves.
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { createDirectClient } from '@/utils/film/core/directClient';
import { castFromIdea, detectGenre, storyboardFrames, renderStoryboardFrame } from '@/utils/film/core/storyboard';
import { getModel } from '@/utils/film/suiteConfig';

// Gate on the explicit flag ONLY (the key is checked inside the test, so a flagged run
// never silently skips because of .env load-order).
const RUN = !!process.env.RUN_STORYBOARD_GEN;
const N_IDEAS = Math.max(1, Number(process.env.STB_IDEAS) || 10);
const FRAMES = Math.max(2, Math.min(4, Number(process.env.STB_FRAMES) || 3));
const SHOTS = process.env.STB_SHOTS ? Number(process.env.STB_SHOTS) : undefined;

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_DIR = path.join(__dirname, `run-${ts}`);

const slug = (s) => String(s || 'idea').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'idea';
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Parse a JSON array out of a model reply (tolerant of code fences / prose).
const parseArray = (text) => {
  const t = String(text || '').replace(/```json|```/g, '').trim();
  try { const v = JSON.parse(t); return Array.isArray(v) ? v : (v && Array.isArray(v.ideas) ? v.ideas : []); } catch { /* try to slice */ }
  const m = t.match(/\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* give up */ } }
  return [];
};

const generateIdeas = async (n, ctx) => {
  const { content } = await ctx.client.reason({
    prompt: `Generate ${n} distinct film premises. Return ONLY a JSON array of ${n} strings.`,
    systemPrompt: `You are a film concept generator. Return ONLY a JSON array of ${n} DISTINCT one-sentence film premises, spread across varied genres and tones (e.g. western, sci-fi, cosmic horror, noir, survival drama, heist thriller, fantasy, comedy, war, mystery). Each is a single vivid sentence with a clear protagonist and a situation. No numbering, no prose, no code fences.`,
    modelId: getModel('reasoner'),
    reasoningEffort: 'low',
  });
  return parseArray(content).map((x) => String(x).trim()).filter(Boolean).slice(0, n);
};

const download = async (url, file) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
};

const writeIndexHtml = (dir, idea, genre, shots) => {
  const rows = shots.map((shot) => {
    const cells = shot.frames.map((f, j) => {
      const img = `shot${shot.index + 1}-${slug(f.moment) || j + 1}.jpg`;
      const has = fs.existsSync(path.join(dir, img));
      return `<figure><div class="ph">${has ? `<img src="${img}" loading="lazy">` : '<span class="x">render failed</span>'}</div><figcaption><b>${esc(f.moment || 'frame')}</b> · ${esc(f.framing)} · ${esc(f.angle)}<br>${esc(f.action)}</figcaption></figure>`;
    }).join('');
    return `<section><h3>Shot ${shot.index + 1} · ${esc(shot.title)} <small>(${esc(shot.shotTemplate)})</small></h3><div class="row">${cells}</div></section>`;
  }).join('');
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf8"><title>${esc(idea)}</title><style>body{font:14px/1.5 system-ui;margin:24px;background:#0f1115;color:#e5e6eb}h1{font-size:18px}h3{margin:18px 0 8px;color:#f7ba1e}small{color:#86909c;font-weight:400}.row{display:flex;gap:10px;flex-wrap:wrap}figure{margin:0;width:240px}.ph{aspect-ratio:16/9;background:#1d2026;border:1px solid #2a313a;border-radius:6px;overflow:hidden;display:flex;align-items:center;justify-content:center}img{width:100%;height:100%;object-fit:cover}.x{color:#5a6472;font-size:12px}figcaption{font-size:11px;color:#cdd3dc;margin-top:4px}</style><h1>${esc(idea)}</h1><p style="color:#86909c">genre: ${esc(genre)} · ${shots.length} shots</p>${rows}`);
};

(RUN ? describe : describe.skip)('Storyboard generation harness (live)', () => {
  jest.setTimeout(90 * 60 * 1000); // up to 90 min for the full batch

  it(`generates ${N_IDEAS} ideas → a storyboard each → tests/storyboards/run-*`, async () => {
    const apiKey = process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
    if (!apiKey) throw new Error('No MODELARK_API_KEY / ARK_API_KEY in env (.env.local). Set it to run the live storyboard batch.');
    if (!process.env.MODELARK_API_BASE_URL) throw new Error('No MODELARK_API_BASE_URL in env (.env.local).');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const client = createDirectClient({ apiKey, baseUrl: process.env.MODELARK_API_BASE_URL });
    const ctx = { client };

    // 1) N distinct film ideas.
    const ideas = await generateIdeas(N_IDEAS, ctx);
    fs.writeFileSync(path.join(OUT_DIR, 'ideas.json'), JSON.stringify(ideas, null, 2));
    expect(ideas.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`\n[storyboards] ${ideas.length} ideas → ${OUT_DIR}\n`);

    const summary = [];
    // 2) Per idea: bible → storyboard → render frames → save.
    for (let i = 0; i < ideas.length; i++) {
      const idea = ideas[i];
      const dir = path.join(OUT_DIR, `${String(i + 1).padStart(2, '0')}-${slug(idea)}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'idea.txt'), idea);
      // eslint-disable-next-line no-console
      console.log(`[${i + 1}/${ideas.length}] ${idea}`);
      try {
        const g = await detectGenre({ idea }, ctx).catch(() => ({ genre: '', tone: '' }));
        const genre = [g.genre, g.tone].filter(Boolean).join(' · ');
        const bible = await castFromIdea({ idea, genre }, ctx);
        fs.writeFileSync(path.join(dir, 'bible.json'), JSON.stringify(bible, null, 2));

        const { anchors, shots } = await storyboardFrames({ idea, genre, bible, framesPerShot: FRAMES, count: SHOTS }, ctx);
        fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ idea, genre, shots }, null, 2));

        let ok = 0; let fail = 0;
        for (const shot of shots) {
          for (let j = 0; j < shot.frames.length; j++) {
            const frame = shot.frames[j];
            const file = path.join(dir, `shot${shot.index + 1}-${slug(frame.moment) || j + 1}.jpg`);
            try {
              const url = await renderStoryboardFrame({ frame, shot, anchors, genre }, ctx); // eslint-disable-line no-await-in-loop
              await download(url, file); // eslint-disable-line no-await-in-loop
              ok += 1;
            } catch (e) { fail += 1; fs.appendFileSync(path.join(dir, 'render-errors.txt'), `${path.basename(file)}: ${e.message}\n`); }
          }
        }
        writeIndexHtml(dir, idea, genre, shots);
        summary.push({ idea, genre, shots: shots.length, framesOk: ok, framesFailed: fail });
        // eslint-disable-next-line no-console
        console.log(`   ✓ ${shots.length} shots, ${ok} frames (${fail} failed)`);
      } catch (e) {
        fs.writeFileSync(path.join(dir, 'ERROR.txt'), String(e.stack || e.message));
        summary.push({ idea, error: e.message });
        // eslint-disable-next-line no-console
        console.log(`   ✗ ${e.message}`);
      }
    }
    fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify({ generatedAt: ts, framesPerShot: FRAMES, ideas: summary }, null, 2));
    expect(fs.existsSync(path.join(OUT_DIR, 'summary.json'))).toBe(true);
  });
});

// Always-present guard so `npm test` reports the suite as skipped, not "no tests".
(RUN ? describe.skip : describe)('Storyboard generation harness (skipped)', () => {
  it('is opt-in — set RUN_STORYBOARD_GEN=1 (+ MODELARK_API_KEY) to run it', () => {
    expect(true).toBe(true);
  });
});
