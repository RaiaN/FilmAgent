// Node-only final-cut stitch: download ordered shots → ffmpeg concat (re-encode to
// a uniform spec so disparate clips join cleanly) → a local .mp4. Ported from the
// app's pages/api/film/stitch.js, minus the TOS upload (returns a local path).
//
// ffmpeg resolution order: the optional `ffmpeg-static` binary, else `ffmpeg` on
// PATH. This file uses node: built-ins, so it's imported lazily by the orchestrator
// (a browser consumer of the HTTP client never pulls it in).

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StitchFn } from './types';

const runFfmpeg = (bin: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`))));
  });

const resolveFfmpeg = async (): Promise<string> => {
  try {
    const mod: any = await import('ffmpeg-static');
    const bin = mod?.default || mod;
    if (typeof bin === 'string' && bin) return bin;
  } catch { /* not installed — fall back to PATH */ }
  return 'ffmpeg';
};

/** Concatenate ordered shot URLs into one local mp4. Requires ffmpeg (static or PATH). */
export const nodeStitch: StitchFn = async (shots, opts = {}) => {
  if (!Array.isArray(shots) || shots.length === 0) throw new Error('nodeStitch: no shots to stitch');
  const bin = await resolveFfmpeg();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'film-stitch-'));
  try {
    const files: string[] = [];
    for (let i = 0; i < shots.length; i += 1) {
      const r = await fetch(shots[i]); // eslint-disable-line no-await-in-loop
      if (!r.ok) throw new Error(`Could not fetch shot ${i + 1} (HTTP ${r.status}). Generated shot URLs expire — re-run.`);
      const buf = Buffer.from(await r.arrayBuffer()); // eslint-disable-line no-await-in-loop
      const f = path.join(dir, `shot-${i}.mp4`);
      writeFileSync(f, buf);
      files.push(f);
    }
    const listFile = path.join(dir, 'list.txt');
    writeFileSync(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    const out = opts.outPath || path.join(process.cwd(), `${opts.name || 'final-cut'}-${Date.now()}.mp4`);
    await runFfmpeg(bin, [
      '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', out,
    ]);
    return { path: out };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
};
