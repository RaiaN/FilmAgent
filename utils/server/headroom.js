import { spawn } from 'child_process';
import { once } from 'events';
import { run } from './videoInfo';

// Headroom maths on a 10-bit master. Every step is exact:
//   10-bit limited Y'CbCr → R'G'B' (BT.709 matrix, unclamped, so values above 1.0 survive)
//   → display-linear light (inverse BT.1886, L = V^2.4)
//   → underexposure L' = L · 2^−EV on R, G and B equally
//   → BT.1886 re-encode V' = L'^(1/2.4) for the keyframe image.

const KR = 0.2126; const KB = 0.0722; const KG = 1 - KR - KB;
const lin = (v) => (v < 0 ? -((-v) ** 2.4) : v ** 2.4);

// 10-bit 4:4:4 planes (Uint16 Y, Cb, Cr) → linear R, G, B Float32Arrays.
const toLinear = (yuv, n) => {
  const R = new Float32Array(n); const G = new Float32Array(n); const B = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const y = (yuv[i] - 64) / 876; const cb = (yuv[n + i] - 512) / 896; const cr = (yuv[2 * n + i] - 512) / 896;
    const r = y + 2 * (1 - KR) * cr; const b = y + 2 * (1 - KB) * cb; const g = (y - KR * r - KB * b) / KG;
    R[i] = lin(r); G[i] = lin(g); B[i] = lin(b);
  }
  return { R, G, B };
};

export const linearFrameAt = async (bin, file, t, { width, height }) => {
  const n = width * height;
  const r = await run(bin, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'format=yuv444p10le', '-f', 'rawvideo', '-']);
  if (r.stdout.length < n * 6) throw new Error(`No frame at ${t} s: ${r.stderr.slice(-200)}`);
  return toLinear(new Uint16Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + n * 6)), n);
};

// Exact −EV, BT.1886-encoded, as 8-bit RGB (Seedance reference images are 8-bit).
export const underexposedRgb8 = ({ R, G, B }, ev) => {
  const k = 2 ** -ev; const n = R.length; const out = Buffer.alloc(n * 3);
  const enc = (L) => Math.round(Math.min(1, Math.max(0, L * k)) ** (1 / 2.4) * 255);
  for (let i = 0; i < n; i += 1) { out[i * 3] = enc(R[i]); out[i * 3 + 1] = enc(G[i]); out[i * 3 + 2] = enc(B[i]); }
  return out;
};

// Every `every`-th frame of a 10-bit clip as linear R, G, B.
export async function* linearFrames(bin, file, { width, height }, every = 1) {
  const n = width * height; const size = n * 6;
  const vf = `${every > 1 ? `select='not(mod(n\\,${every}))',` : ''}format=yuv444p10le`;
  const dec = spawn(bin, ['-v', 'error', '-i', file, '-vf', vf, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-']);
  let err = ''; dec.stderr.on('data', (d) => { err += d; });
  const closed = once(dec, 'close'); // listen now: the process can exit before stdout is drained
  const buf = new Uint8Array(size); let fill = 0;
  for await (const chunk of dec.stdout) {
    let off = 0;
    while (off < chunk.length) {
      const k = Math.min(size - fill, chunk.length - off);
      buf.set(chunk.subarray(off, off + k), fill); fill += k; off += k;
      if (fill === size) { yield toLinear(new Uint16Array(buf.buffer, 0, n * 3), n); fill = 0; }
    }
  }
  const [code] = await closed;
  if (code !== 0) throw new Error(`Decode failed: ${err.slice(-300)}`);
}

export const frameCount = async (bin, file) => {
  const r = await run(bin, ['-hide_banner', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
  const m = [...r.stderr.matchAll(/frame=\s*(\d+)/g)].pop();
  if (!m) throw new Error('Could not count the frames.');
  return Number(m[1]);
};

// Median / percentile from a fixed-bin histogram (values outside the range land in the end bins).
const hist = (lo, hi, step) => ({ lo, step, bins: new Float64Array(Math.round((hi - lo) / step) + 1), n: 0 });
const add = (h, v) => { const i = Math.min(h.bins.length - 1, Math.max(0, Math.round((v - h.lo) / h.step))); h.bins[i] += 1; h.n += 1; };
const quantile = (h, q) => { let acc = 0; const target = q * h.n; for (let i = 0; i < h.bins.length; i += 1) { acc += h.bins[i]; if (acc >= target) return h.lo + i * h.step; } return h.lo + (h.bins.length - 1) * h.step; };

// How dark the plate really is, and how much highlight range an exact merge would recover:
//   gain  = median of hero / plate luminance over unclipped mid-tones (the exposure Seedance held), per frame
//   merge = max(gain · plate, hero) per channel, only where the hero clips (any channel ≥ 0.9)
export const measurePlate = async (bin, heroFile, plateFile, spec, every = 6) => {
  const heroFrames = linearFrames(bin, heroFile, spec, every);
  const plateFrames = linearFrames(bin, plateFile, spec, every);
  const gains = []; const recovered = []; const heroTop = []; let clipped = 0; let plateClipped = 0; let pixels = 0;
  for (;;) {
    const [a, b] = await Promise.all([heroFrames.next(), plateFrames.next()]); // eslint-disable-line no-await-in-loop
    if (a.done || b.done) break;
    const E = a.value; const P = b.value; const n = E.R.length;
    const g = hist(-6, 6, 0.005);
    for (let i = 0; i < n; i += 1) {
      const ye = KR * E.R[i] + KG * E.G[i] + KB * E.B[i]; const yp = KR * P.R[i] + KG * P.G[i] + KB * P.B[i];
      const em = Math.max(E.R[i], E.G[i], E.B[i]); const pm = Math.max(P.R[i], P.G[i], P.B[i]);
      if (ye > 0.02 && ye < 0.5 && em < 0.85 && pm < 0.95 && yp > 1e-4) add(g, Math.log2(ye / yp));
    }
    const stops = quantile(g, 0.5); const c = 2 ** stops; gains.push(stops);
    const top = hist(-2, 6, 0.01); const heroH = hist(-2, 6, 0.01);
    for (let i = 0; i < n; i += 1) {
      const em = Math.max(E.R[i], E.G[i], E.B[i]);
      if (em < 0.9) continue;
      clipped += 1;
      if (Math.max(P.R[i], P.G[i], P.B[i]) >= 0.98) plateClipped += 1;
      const m = Math.max(Math.max(c * P.R[i], E.R[i]), Math.max(c * P.G[i], E.G[i]), Math.max(c * P.B[i], E.B[i]));
      add(top, Math.log2(m)); add(heroH, Math.log2(em));
    }
    pixels += n;
    if (top.n) { recovered.push(quantile(top, 0.999)); heroTop.push(quantile(heroH, 0.999)); }
  }
  const med = (xs) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const steps = gains.slice(1).map((v, i) => Math.abs(v - gains[i])).sort((x, y) => x - y);
  const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
  return {
    framesCompared: gains.length,
    heldEv: r3(-med(gains)),
    stabilityStops: r3(steps.length ? steps[Math.min(steps.length - 1, Math.floor(0.95 * steps.length))] : 0),
    clippedPct: r3((clipped / Math.max(1, pixels)) * 100),
    plateStillClippedPct: r3((plateClipped / Math.max(1, clipped)) * 100),
    heroStopsAboveWhite: r3(med(heroTop)),
    mergedStopsAboveWhite: r3(med(recovered)),
    gainPerSample: gains.map(r3),
  };
};
