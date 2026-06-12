// End-to-end headless film tests — the 3 scenarios, driven entirely through the
// SDK's produce() loop (no browser, no canvas). Each makes REAL, paid ModelArk
// calls and takes minutes, so they are gated on MODELARK_API_KEY and skip cleanly
// when it (and the base URL) are absent.
//
//   MODELARK_API_KEY=…  MODELARK_API_BASE_URL=https://…  npm test
//
// Build first (npm test runs `pretest` → build), or `npm run build` manually.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { produce } from '../dist/index.js';

const KEY = process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
const BASE = process.env.MODELARK_API_BASE_URL;
const skip = (KEY && BASE)
  ? false
  : 'set MODELARK_API_KEY + MODELARK_API_BASE_URL to run (real, paid generation calls)';

const HOUR = 60 * 60 * 1000;

// The three productions the SDK must be able to make headless.
const FILMS = [
  {
    name: '1) cartoon (1 min)',
    input: {
      idea: 'A short, colorful kids’ cartoon: a curious little robot wanders a sunny meadow and makes an unlikely animal friend. Playful, bright, wholesome.',
      targetMinutes: 1,
    },
  },
  {
    name: '2) cinematic trailer — Saudi Arabia, poor boy → businessman (1–2 min)',
    input: {
      idea: 'A cinematic film trailer set in Saudi Arabia: a poor young boy’s life is changed forever by a single chance conversation that sets him on the path to becoming a successful businessman. Sweeping, emotional, aspirational — trailer pacing with rising momentum.',
      targetMinutes: 2,
    },
  },
  {
    name: '3) advertisement — Saudi Arabia is alive (1–2 min)',
    input: {
      idea: 'An uplifting advertisement showing that Saudi Arabia is vibrantly alive: its unique landscapes, wildlife, and places. Energetic, beautiful, inspiring — a montage that celebrates the country.',
      targetMinutes: 2,
    },
  },
];

for (const film of FILMS) {
  test(film.name, { skip, timeout: HOUR }, async () => {
    const t0 = Date.now();
    const log = (e) => {
      if (e.type === 'phase') console.log(`  [${film.name}] phase: ${e.phase}`);
      else if (e.type === 'plan') console.log(`  [${film.name}] plan: ${e.plan.length} steps — ${e.plan.map((s) => s.agent).join(' → ')}`);
      else if (e.type === 'step' && e.status !== 'running') console.log(`  [${film.name}] step ${e.index + 1}/${e.total} ${e.agent}: ${e.status}${e.message ? ` (${e.message})` : ''}`);
      else if (e.type === 'film') console.log(`  [${film.name}] FILM: ${e.path || e.url} (${e.shots} shots)`);
      else if (e.type === 'warning') console.warn(`  [${film.name}] ⚠ ${e.message}`);
    };

    const r = await produce(film.input, { onEvent: log, perStepCount: 1 });

    assert.ok(r.brief && r.brief.logline, 'brief has a logline');
    assert.ok(Array.isArray(r.plan) && r.plan.length > 0, 'plan has at least one step');
    assert.ok(Array.isArray(r.shots) && r.shots.length > 0, 'produced at least one animated shot');
    for (const s of r.shots) assert.match(String(s.url), /^(https?:|data:)/, 'each shot has a playable url');

    if (r.film) {
      assert.ok(r.film.path && existsSync(r.film.path), 'stitched final-cut file exists on disk');
      console.log(`  [${film.name}] ✓ final cut: ${r.film.path}`);
    } else {
      console.warn(`  [${film.name}] no stitched film (ffmpeg unavailable?) — ${r.shots.length} shots produced`);
    }
    console.log(`  [${film.name}] done in ${Math.round((Date.now() - t0) / 1000)}s`);
  });
}
