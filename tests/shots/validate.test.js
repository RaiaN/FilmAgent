/**
 * @jest-environment node
 *
 * SHOT-PILLAR VALIDATION harness (OPT-IN, hits the live ModelArk API — generates
 * REAL Seedance videos and costs real money + time).
 *
 * It walks the SAME headless path the app/orchestrator uses — idea → cast (real
 * plates, registered as portrait assets so human refs aren't screened) → storyboard
 * (SHOT panels) → panelToShot (the EXACT composeSeedancePrompt the canvas sends,
 * leading with the OBSERVATION/AGENCY pillars) → animate (Seedance, threading each
 * shot's last frame into the next as first_frame for continuity) → then VLM-grades
 * every rendered video against our 4 craft pillars using Seed 2.0 Pro (video input):
 *
 *   1. AGENCY / URGENCY / TENSION  — subject actively pursues a goal under stakes,
 *      never idle/waiting/standing passively.
 *   2. OBSERVATIONAL (no fourth wall) — nobody looks at / addresses / poses to the lens.
 *   3. CAMERA MOTION — the camera moves as a continuous motivated trajectory, not static.
 *   4. MOTIVATED BLOCKING — movement is grounded and inhabits the space, not random/absurd.
 *
 * SKIPPED unless you opt in:
 *
 *   RUN_SHOT_VALIDATION=1 npm test -- tests/shots/validate.test.js
 *
 * Tunables (env): SHOTS_TOTAL (default 20), SHOTS_PER_STORY (default 5),
 * SHOT_RES (default 720p), SHOT_AUDIO (1 to enable audio; default off).
 * Needs MODELARK_API_KEY + MODELARK_API_BASE_URL (+ the MODELARK_ASSET_* / TOS keys
 * for human-ref asset registration) in .env.local.
 *
 * Output: tests/shots/run-<ts>/ — per shot the mp4 + its VLM verdict, an index.html
 * report (inline players + pillar badges) and summary.json (per-pillar pass rates).
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
// next/jest doesn't push .env.local into process.env for node tests — load it ourselves.
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { createDirectClient } from '@/utils/film/core/directClient';
import { detectGenre, castFromIdea, readStoryboard, panelToShot } from '@/utils/film/core/storyboard';
import { animate } from '@/utils/film/core/operations';
import { getModel } from '@/utils/film/suiteConfig';
import { registerAsset } from '@/utils/film/server/registerAsset';

const RUN = !!process.env.RUN_SHOT_VALIDATION;
const SHOTS_TOTAL = Math.max(1, Number(process.env.SHOTS_TOTAL) || 20);
const SHOTS_PER_STORY = Math.max(1, Number(process.env.SHOTS_PER_STORY) || 5);
const RES = process.env.SHOT_RES || '720p';
const AUDIO = process.env.SHOT_AUDIO === '1';
const N_STORIES = Math.ceil(SHOTS_TOTAL / SHOTS_PER_STORY);

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_DIR = path.join(__dirname, `run-${ts}`);

const slug = (s) => String(s || 'x').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'x';
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Tolerant JSON extraction from a model reply (strips fences/prose).
const parseJson = (text) => {
  const t = String(text || '').replace(/```json|```/g, '').trim();
  try { return JSON.parse(t); } catch { /* slice */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* give up */ } }
  const a = t.match(/\[[\s\S]*\]/);
  if (a) { try { return JSON.parse(a[0]); } catch { /* give up */ } }
  return null;
};

const generateIdeas = async (n, ctx) => {
  const { content } = await ctx.client.reason({
    prompt: `Generate ${n} distinct film premises. Return ONLY a JSON array of ${n} strings.`,
    systemPrompt: `You are a film concept generator. Return ONLY a JSON array of ${n} DISTINCT one-sentence film premises with a clear protagonist actively pursuing a goal under pressure, spread across varied genres and tones (western, sci-fi, cosmic horror, noir, survival, heist, fantasy, comedy, war, mystery). Each is a single vivid sentence. No numbering, no prose, no code fences.`,
    modelId: getModel('reasoner'),
    reasoningEffort: 'low',
  });
  const arr = parseJson(content);
  return (Array.isArray(arr) ? arr : []).map((x) => String(x).trim()).filter(Boolean).slice(0, n);
};

const download = async (url, file) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
};

// The pillar rubric — Seed 2.0 Pro reads the actual VIDEO and scores each pillar.
const VAL_SYSTEM = 'You are a STRICT film-craft examiner reviewing one short AI-generated VIDEO SHOT (a few seconds). Judge ONLY what is visible in the video, against four craft pillars. Be skeptical — AI video tends to make subjects face the camera, hold still, and move randomly; call those out. Return ONLY a JSON object, no prose, no code fences.';
const VAL_USER = `Grade THIS video shot on four pillars. For each give an integer score 0/1/2 and ≤14-word evidence of what you SAW:

1. agency — does the subject ACTIVELY pursue a goal with urgency/tension (deciding, reaching, moving, doing, stakes in motion), never idle/waiting/standing passively? 2=clear active pursuit under tension, 1=some activity but passive/low-stakes stretches, 0=idle/static/waiting/just reacting.
2. observational — set fourthWall=true if ANY subject looks at, addresses, or poses frontally TO the camera/lens (performing to camera). score: 2=eyelines fully within the scene, 1=mostly within but a stray glance, 0=performs/poses to camera.
3. cameraMotion — does the CAMERA move as a continuous motivated trajectory that explores the space (push/track/pan/orbit/handheld), not static or locked off? 2=clear motivated camera move, 1=slight drift only, 0=static/locked.
4. blocking — is the movement MOTIVATED, physically grounded and inhabiting the space, with NO random/posed/absurd/impossible motion or morphing? 2=fully motivated & grounded, 1=minor oddities, 0=random/absurd/posed/morphing.

verdict = "pass" only if agency>=1 AND observational>=1 AND fourthWall is false AND cameraMotion>=1 AND blocking>=1; otherwise "fail".

Return EXACTLY:
{"agency":{"score":0,"evidence":""},"observational":{"fourthWall":false,"score":0,"evidence":""},"cameraMotion":{"score":0,"evidence":""},"blocking":{"score":0,"evidence":""},"verdict":"pass","summary":"one line overall"}`;

const validateShot = async (videoUrl, ctx) => {
  const { content } = await ctx.client.reason({
    prompt: VAL_USER,
    systemPrompt: VAL_SYSTEM,
    video: videoUrl,
    modelId: getModel('reasoner'),
    reasoningEffort: 'medium',
  });
  const v = parseJson(content);
  if (!v) return { error: 'unparseable VLM reply', raw: String(content || '').slice(0, 400) };
  return v;
};

// Register a hosted plate URL as a portrait-library asset → trusted asset:// id, so
// photoreal HUMAN refs aren't rejected ("input image may contain real person").
// Best-effort: a failure falls back to the raw url path.
const registerPlate = async (url, name) => {
  const accessKey = process.env.MODELARK_ASSET_ACCESS_KEY;
  const secretKey = process.env.MODELARK_ASSET_SECRET_KEY;
  if (!accessKey || !secretKey) return null;
  try {
    return await registerAsset({ accessKey, secretKey, url, name, waitForActive: true });
  } catch { return null; }
};

(RUN ? describe : describe.skip)('Shot pillar validation (live video)', () => {
  jest.setTimeout(180 * 60 * 1000); // up to 3h for the full 20-shot batch + VLM grading

  it(`shoots ${SHOTS_TOTAL} shots across ~${N_STORIES} stories and VLM-grades each → tests/shots/run-*`, async () => {
    const apiKey = process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
    if (!apiKey) throw new Error('No MODELARK_API_KEY / ARK_API_KEY in env (.env.local).');
    if (!process.env.MODELARK_API_BASE_URL) throw new Error('No MODELARK_API_BASE_URL in env (.env.local).');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const client = createDirectClient({ apiKey, baseUrl: process.env.MODELARK_API_BASE_URL });
    const ctx = { client };
    const log = (m) => { console.log(m); fs.appendFileSync(path.join(OUT_DIR, 'run.log'), `${m}\n`); }; // eslint-disable-line no-console

    const ideas = await generateIdeas(N_STORIES, ctx);
    fs.writeFileSync(path.join(OUT_DIR, 'ideas.json'), JSON.stringify(ideas, null, 2));
    expect(ideas.length).toBeGreaterThan(0);
    log(`\n[shots] ${ideas.length} ideas → up to ${SHOTS_TOTAL} shots @ ${RES}${AUDIO ? ' +audio' : ''} → ${OUT_DIR}\n`);

    const shots = []; // { n, idea, genre, title, shotTemplate, prompt, videoFile, videoUrl, verdict }
    let n = 0;

    for (let i = 0; i < ideas.length && n < SHOTS_TOTAL; i++) {
      const idea = ideas[i];
      log(`\n=== Story ${i + 1}/${ideas.length}: ${idea}`);
      try {
        const g = await detectGenre({ idea }, ctx).catch(() => ({ genre: '', tone: '' }));
        const genre = [g.genre, g.tone].filter(Boolean).join(' · ');

        // Cast → register each plate so human refs ride as trusted asset:// ids.
        const bible = await castFromIdea({ idea, genre }, ctx);
        for (const e of bible) { e.assetId = await registerPlate(e.url, e.name); } // eslint-disable-line no-await-in-loop
        log(`   cast: ${bible.length} plates (${bible.filter((e) => e.assetId).length} registered as assets)`);

        // Storyboard → SHOT panels (cap shots/story so the batch hits ~SHOTS_TOTAL).
        const { anchors, panels } = await readStoryboard(
          { idea, genre, targetSeconds: SHOTS_PER_STORY * 10, bible, config: undefined }, ctx,
        );
        const anchorById = new Map(anchors.map((a) => [a.id, a]));
        const take = panels.slice(0, Math.min(SHOTS_PER_STORY, SHOTS_TOTAL - n));

        // Seedance FORBIDS first_frame + reference media in one request ("first/last frame
        // content cannot be mixed with reference media content"). Storyboard shots are CUTS,
        // each carrying its OWN cast/place refs — so the correct mode is REFS-ONLY (no
        // first_frame). Cross-shot consistency comes from the shared cast refs + a LOCKED
        // per-story seed + the prompt's CONTINUITY line, NOT from threading the prev frame.
        // (first_frame is only valid for a continuous "continue this take" with no new refs.)
        const storySeed = 100000 + Math.floor(Math.random() * 800000);
        for (let k = 0; k < take.length && n < SHOTS_TOTAL; k++) {
          const panel = take[k];
          const shot = panelToShot(panel, anchors, genre);
          // refAssetIds aligned to refUrls (same filter/order panelToShot uses).
          const ordered = (panel.refEntryIds || []).map((id) => anchorById.get(id)).filter((e) => e && e.url).slice(0, 9);
          const refAssetIds = ordered.map((e) => e.assetId || null);
          n += 1;
          const tag = `${String(n).padStart(2, '0')}`;
          log(`   [${tag}] shooting "${shot.beat}" (${panel.shotTemplate}, ${shot.durationSec}s)…`);
          try {
            const { taskId } = await animate({
              refUrls: shot.refUrls, refAssetIds,
              motion: shot.motion, camera: 'auto',
              duration: shot.durationSec, resolution: RES, ratio: 'adaptive',
              generateAudio: AUDIO, seed: storySeed,
            }, ctx); // eslint-disable-line no-await-in-loop
            const { videoUrl } = await ctx.client.pollVideo({ taskId, timeoutMs: 540000 }); // eslint-disable-line no-await-in-loop

            const videoFile = `shot-${tag}-${slug(shot.beat)}.mp4`;
            await download(videoUrl, path.join(OUT_DIR, videoFile)); // eslint-disable-line no-await-in-loop
            const verdict = await validateShot(videoUrl, ctx); // eslint-disable-line no-await-in-loop
            shots.push({ n, idea, genre, title: shot.beat, beat: panel.action, shotTemplate: panel.shotTemplate, prompt: shot.motion, videoFile, videoUrl, verdict });
            const vd = verdict?.verdict || '?';
            const fw = verdict?.observational?.fourthWall ? ' ⚠fourth-wall' : '';
            log(`        → ${vd}${fw} | agency ${verdict?.agency?.score}, obs ${verdict?.observational?.score}, cam ${verdict?.cameraMotion?.score}, block ${verdict?.blocking?.score} — ${verdict?.summary || ''}`);
            // Persist incrementally so a crash mid-run still leaves a usable report.
            fs.writeFileSync(path.join(OUT_DIR, 'shots.json'), JSON.stringify(shots, null, 2));
            writeReport(OUT_DIR, shots);
          } catch (e) {
            log(`        ✗ shot failed: ${e.message}`);
            shots.push({ n, idea, genre, title: shot.beat, beat: panel.action, shotTemplate: panel.shotTemplate, prompt: shot.motion, error: e.message });
            fs.writeFileSync(path.join(OUT_DIR, 'shots.json'), JSON.stringify(shots, null, 2));
          }
        }
      } catch (e) {
        log(`   ✗ story failed: ${e.message}`);
      }
    }

    const summary = summarize(shots);
    fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify({ generatedAt: ts, res: RES, audio: AUDIO, ...summary }, null, 2));
    writeReport(OUT_DIR, shots, summary);
    log(`\n[shots] DONE — ${summary.graded} graded, ${summary.passed} passed (${summary.passRate}). Per-pillar avg: agency ${summary.avg.agency}, observational ${summary.avg.observational}, camera ${summary.avg.cameraMotion}, blocking ${summary.avg.blocking}. Fourth-wall violations: ${summary.fourthWallViolations}/${summary.graded}.`);
    expect(fs.existsSync(path.join(OUT_DIR, 'summary.json'))).toBe(true);
  });
});

// Aggregate per-pillar averages + pass rate over the graded shots.
function summarize(shots) {
  const graded = shots.filter((s) => s.verdict && !s.verdict.error);
  const num = (x) => (typeof x === 'number' ? x : 0);
  const avgOf = (sel) => (graded.length ? (graded.reduce((a, s) => a + num(sel(s)), 0) / graded.length).toFixed(2) : '—');
  const passed = graded.filter((s) => s.verdict.verdict === 'pass').length;
  const fw = graded.filter((s) => s.verdict?.observational?.fourthWall).length;
  return {
    total: shots.length,
    graded: graded.length,
    failedToRender: shots.filter((s) => s.error).length,
    passed,
    passRate: graded.length ? `${Math.round((passed / graded.length) * 100)}%` : '—',
    fourthWallViolations: fw,
    avg: {
      agency: avgOf((s) => s.verdict.agency?.score),
      observational: avgOf((s) => s.verdict.observational?.score),
      cameraMotion: avgOf((s) => s.verdict.cameraMotion?.score),
      blocking: avgOf((s) => s.verdict.blocking?.score),
    },
  };
}

// Self-contained HTML report grouped STORY → BEAT → RESULT: each story is a section
// (the premise), and every shot card shows its BEAT (the action) + the rendered video
// + the RESULT (verdict, pillar badges, evidence).
function writeReport(dir, shots, summary) {
  const s = summary || summarize(shots);
  const badge = (label, score) => {
    const c = score === 2 ? '#00b42a' : score === 1 ? '#f7ba1e' : '#f53f3f';
    return `<span class="b" style="background:${c}22;color:${c};border-color:${c}55">${label} ${score == null ? '—' : score}</span>`;
  };
  const card = (sh) => {
    if (sh.error) {
      return `<div class="card err"><div class="bt">BEAT · ${esc(sh.title)} <small>${esc(sh.shotTemplate)}</small></div><p class="beat">${esc(sh.beat)}</p><p class="x">✗ render failed: ${esc(sh.error)}</p></div>`;
    }
    const v = sh.verdict || {};
    const fw = v?.observational?.fourthWall;
    const pass = v.verdict === 'pass';
    return `<div class="card ${pass ? 'pass' : 'fail'}">
      <div class="bt">#${sh.n} BEAT · ${esc(sh.title)} <small>${esc(sh.shotTemplate)}</small> <em class="${pass ? 'ok' : 'no'}">${pass ? 'PASS' : 'FAIL'}</em></div>
      <p class="beat">${esc(sh.beat)}</p>
      <video src="${esc(sh.videoFile)}" controls preload="metadata"></video>
      <div class="res"><span class="rl">RESULT</span> ${badge('agency', v?.agency?.score)} ${badge('observational', v?.observational?.score)}${fw ? ' <span class="b" style="background:#f53f3f22;color:#f53f3f;border-color:#f53f3f55">⚠ faces camera</span>' : ''} ${badge('camera', v?.cameraMotion?.score)} ${badge('blocking', v?.blocking?.score)}</div>
      <p class="sum">${esc(v.summary || '')}</p>
      <details><summary>evidence + composed prompt</summary>
        <ul class="ev"><li><b>agency:</b> ${esc(v?.agency?.evidence)}</li><li><b>observational:</b> ${esc(v?.observational?.evidence)}</li><li><b>camera:</b> ${esc(v?.cameraMotion?.evidence)}</li><li><b>blocking:</b> ${esc(v?.blocking?.evidence)}</li></ul>
        <pre>${esc(sh.prompt)}</pre>
      </details>
    </div>`;
  };
  // Group shots by their STORY (idea), preserving first-seen order.
  const order = [];
  const byStory = new Map();
  shots.forEach((sh) => {
    if (!byStory.has(sh.idea)) { byStory.set(sh.idea, []); order.push(sh.idea); }
    byStory.get(sh.idea).push(sh);
  });
  const sections = order.map((idea, i) => {
    const group = byStory.get(idea);
    const g = group.filter((x) => x.verdict && !x.verdict.error);
    const passed = g.filter((x) => x.verdict.verdict === 'pass').length;
    return `<section><div class="story"><span class="sn">STORY ${i + 1}</span><h2>${esc(idea)}</h2><p class="meta">${esc(group[0]?.genre || '')} · ${group.length} shots · ${g.length ? Math.round((passed / g.length) * 100) : 0}% pass</p></div><div class="grid">${group.map(card).join('')}</div></section>`;
  }).join('');
  const head = `<div class="hd"><h1>Shot pillar validation — 50 shots</h1><p>${s.graded} graded · <b>${s.passRate}</b> pass · fourth-wall violations ${s.fourthWallViolations}/${s.graded} · per-pillar avg: agency ${s.avg.agency}, observational ${s.avg.observational}, camera ${s.avg.cameraMotion}, blocking ${s.avg.blocking}${s.failedToRender ? ` · ${s.failedToRender} failed to render` : ''}</p></div>`;
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf8"><title>Shot pillar validation</title><style>body{font:14px/1.5 system-ui;margin:24px;background:#0f1115;color:#e5e6eb}h1{font-size:20px;margin:0}.hd{margin-bottom:22px}.hd p{color:#9aa3af}section{margin-bottom:30px}.story{border-left:3px solid #f7ba1e;padding:2px 0 2px 12px;margin-bottom:12px}.sn{font-size:10px;letter-spacing:1px;color:#f7ba1e}.story h2{font-size:15px;margin:2px 0;font-weight:600;color:#e5e6eb}.story .meta{margin:0;font-size:12px;color:#86909c}.grid{display:flex;flex-wrap:wrap;gap:16px}.card{width:330px;background:#171a21;border:1px solid #252b35;border-left-width:4px;border-radius:8px;padding:12px}.card.pass{border-left-color:#00b42a}.card.fail{border-left-color:#f53f3f}.card.err{border-left-color:#86909c}.bt{font-size:12px;font-weight:700;color:#cdd3dc;margin-bottom:4px}.bt small{color:#86909c;font-weight:400}em{float:right;font-style:normal;font-weight:700;font-size:11px}em.ok{color:#00b42a}em.no{color:#f53f3f}.beat{font-size:12px;color:#aeb6c2;margin:0 0 8px}video{width:100%;border-radius:6px;background:#000;aspect-ratio:16/9}.res{margin:8px 0;display:flex;flex-wrap:wrap;gap:5px;align-items:center}.rl{font-size:10px;letter-spacing:1px;color:#86909c;margin-right:2px}.b{font-size:11px;padding:1px 7px;border-radius:10px;border:1px solid}.sum{font-size:12px;color:#cdd3dc;margin:6px 0}details{font-size:11px;color:#9aa3af}summary{cursor:pointer}pre{white-space:pre-wrap;background:#0f1115;padding:8px;border-radius:6px;border:1px solid #252b35;font-size:10px;color:#aeb6c2}.ev{margin:6px 0;padding-left:16px}.x{color:#f53f3f;font-size:12px}</style>${head}${sections}`);
}

// Always-present guard so `npm test` reports the suite as skipped, not "no tests".
(RUN ? describe.skip : describe)('Shot pillar validation (skipped)', () => {
  it('is opt-in — set RUN_SHOT_VALIDATION=1 (+ MODELARK_API_KEY) to run it', () => {
    expect(true).toBe(true);
  });
});
