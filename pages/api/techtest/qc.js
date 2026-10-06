import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkInBytes, ensureStoreFile, storeKeyFromUrl } from '../../../utils/server/mediaStore';
import { ffmpegPath, median, parseInfo, pct, r2, run } from '../../../utils/server/videoInfo';

// Tech Test ingest QC of one stored take, the checks a post house runs on camera originals:
//   POST { url } (a media-store url, e.g. the MOV master) →
//   { spec, audio, bitDepth, levels, cuts, flickerP95, blockiness, detail, loudness,
//     masterUrl, proxyUrl, contactUrl, stills[], cropUrl, cropT }
// The browser can't play HEVC 4:4:4, so an H.264 preview is made alongside.

const SAMPLE_EVERY = 12; // frames between the raw samples used for bit depth, blocking and detail

export const config = { api: { responseLimit: false } };

export default async function techTestQcHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const key = storeKeyFromUrl(String(req.body?.url || ''));
  if (!key) return res.status(400).json({ error: 'url must be a media-store url (/api/film/media?key=…).' });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'techtest-'));
  try {
    const bin = await ffmpegPath();
    const file = await ensureStoreFile(key);
    const { spec, audio } = parseInfo((await run(bin, ['-hide_banner', '-i', file])).stderr);
    const { width: W, height: H, bits } = spec;

    // ---- per-frame levels and change, all frames
    const statsFile = path.join(tmp, 'stats.txt');
    await run(bin, ['-v', 'error', '-i', file, '-vf', `signalstats,metadata=mode=print:file=${statsFile}`, '-an', '-f', 'null', '-']);
    const frames = [];
    let cur = null;
    fs.readFileSync(statsFile, 'utf8').split('\n').forEach((line) => {
      if (line.startsWith('frame:')) { cur = {}; frames.push(cur); return; }
      const m = /lavfi\.signalstats\.(\w+)=([-\d.]+)/.exec(line);
      if (m && cur) cur[m[1]] = Number(m[2]);
    });
    if (!frames.length) throw new Error('signalstats returned no frames.');
    const ydif = frames.map((f) => f.YDIF || 0);
    const base = Math.max(median(ydif.slice(1)), 1e-6);
    // A picture cut = a frame whose change from the previous one dwarfs the clip's normal motion.
    const cuts = ydif.map((d, i) => ({ i, d })).filter(({ i, d }) => i > 0 && d > 5 * base && d > (bits >= 10 ? 40 : 10))
      .map(({ i }) => ({ frame: i, t: r2(i / (spec.fps || 24)) }));
    const yavg = frames.map((f) => f.YAVG || 0);
    const cutSet = new Set(cuts.map((c) => c.frame));
    const wobble = [];
    for (let i = 2; i < yavg.length; i += 1) {
      if (!cutSet.has(i) && !cutSet.has(i - 1)) wobble.push(Math.abs(yavg[i] - 2 * yavg[i - 1] + yavg[i - 2]));
    }
    const levels = {
      ymin: Math.min(...frames.map((f) => f.YMIN)),
      ymax: Math.max(...frames.map((f) => f.YMAX)),
      brngMaxPct: Math.round(Math.max(...frames.map((f) => f.BRNG || 0)) * 100 * 1000) / 1000,
    };

    // ---- raw luma samples: real bit depth, codec blocking, fine detail
    const raw = (await run(bin, ['-v', 'error', '-i', file, '-vf', `select='not(mod(n\\,${SAMPLE_EVERY}))',format=gray16le`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'])).stdout;
    const fsz = W * H * 2;
    const nativeShift = 16 - bits;
    const hist = new Uint32Array(1 << bits);
    const lsb = [0, 0, 0, 0];
    let lapSum = 0; let lapN = 0; let edge = 0; let edgeN = 0; let inner = 0; let innerN = 0;
    for (let off = 0; off + fsz <= raw.length; off += fsz) {
      const Y = new Uint16Array(raw.buffer.slice(raw.byteOffset + off, raw.byteOffset + off + fsz));
      for (let y = 0; y < H; y += 1) {
        const row = y * W;
        for (let x = 0; x < W; x += 1) {
          const v = Y[row + x];
          const n = v >> nativeShift;
          hist[n] += 1;
          if (bits >= 10) lsb[n & 3] += 1;
          if (x > 0) {
            const d = Math.abs((v >> 6) - (Y[row + x - 1] >> 6));
            if (x % 16 === 0) { edge += d; edgeN += 1; } else { inner += d; innerN += 1; }
          }
          if (y > 0 && y < H - 1 && x > 0 && x < W - 1 && (x & 1) === 0 && (y & 1) === 0) {
            const c = v >> 6;
            lapSum += Math.abs(4 * c - (Y[row - W + x] >> 6) - (Y[row + W + x] >> 6) - (Y[row + x - 1] >> 6) - (Y[row + x + 1] >> 6));
            lapN += 1;
          }
        }
      }
    }
    const lsbTotal = lsb.reduce((a, b) => a + b, 0) || 1;
    const lsbPct = lsb.map((x) => r2((x / lsbTotal) * 100));
    const bitDepth = {
      native: bits,
      codesUsed: hist.reduce((a, c) => a + (c ? 1 : 0), 0),
      ofPossible: 1 << bits,
      lsbPct: bits >= 10 ? lsbPct : null,
      // padded 8-bit leaves the two low bits mostly zero; real 10-bit spreads them ~25 % each
      genuine: bits >= 10 ? Math.min(...lsbPct) > 15 : null,
    };

    // ---- loudness
    let loudness = null;
    if (audio) {
      const eb = (await run(bin, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'])).stderr;
      const s = eb.slice(eb.lastIndexOf('Summary:'));
      const g = (re) => (re.exec(s) || [])[1] || null;
      loudness = { lufs: g(/I:\s+(-?[\d.]+) LUFS/), lra: g(/LRA:\s+(-?[\d.]+) LU/), truePeak: g(/Peak:\s+(-?[\d.]+) dBFS/) };
    }

    // ---- stills, 100% crop, contact sheet, H.264 preview → media store
    const dur = spec.durationSec || frames.length / (spec.fps || 24);
    const still = async (t, vf, name) => {
      const out = path.join(tmp, name);
      await run(bin, ['-v', 'error', '-y', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', vf, '-q:v', '3', out]);
      return (await checkInBytes(fs.readFileSync(out), 'image/jpeg')).url;
    };
    const stills = [];
    for (const f of [0.02, 0.25, 0.5, 0.75, 0.97]) {
      const t = r2(dur * f);
      stills.push({ t, url: await still(t, 'scale=1280:-2', `s_${f}.jpg`) }); // eslint-disable-line no-await-in-loop
    }
    const cropT = r2(dur * 0.5);
    const cropUrl = await still(cropT, `crop=${Math.min(1024, W)}:${Math.min(512, H)}`, 'crop.jpg');
    const contactOut = path.join(tmp, 'contact.jpg');
    await run(bin, ['-v', 'error', '-y', '-i', file, '-vf', `fps=${(10 / dur).toFixed(4)},scale=480:-2,tile=5x2`, '-frames:v', '1', '-q:v', '3', contactOut]);
    const contactUrl = (await checkInBytes(fs.readFileSync(contactOut), 'image/jpeg')).url;
    const proxyOut = path.join(tmp, 'proxy.mp4');
    const proxy = await run(bin, ['-v', 'error', '-y', '-i', file, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      ...(audio ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : ['-an']), '-movflags', '+faststart', proxyOut]);
    if (proxy.code !== 0) throw new Error(`Preview encode failed: ${proxy.stderr.slice(-300)}`);
    const proxyUrl = (await checkInBytes(fs.readFileSync(proxyOut), 'video/mp4')).url;

    return res.status(200).json({
      spec, audio, bitDepth, levels, cuts,
      flickerP95: r2(pct(wobble, 95)),
      blockiness: r2((edge / Math.max(1, edgeN)) / Math.max(1e-6, inner / Math.max(1, innerN))),
      detail: r2(lapSum / Math.max(1, lapN)),
      loudness,
      masterUrl: `/api/film/media?key=${encodeURIComponent(key)}`,
      proxyUrl, contactUrl, stills, cropUrl, cropT,
    });
  } catch (error) {
    return res.status(500).json({ error: `QC failed: ${error.message}` });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
