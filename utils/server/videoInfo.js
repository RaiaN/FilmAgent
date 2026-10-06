import { spawn } from 'child_process';

// ffmpeg-static helpers shared by the Tools routes (ffmpeg-static ships no ffprobe).

export const ffmpegPath = async () => {
  let p = null;
  try { p = (await import('ffmpeg-static')).default; } catch { p = null; }
  if (!p) throw new Error('ffmpeg is not available on the server — install it once with: npm install ffmpeg-static');
  return p;
};

export const run = (bin, args) => new Promise((resolve, reject) => {
  const proc = spawn(bin, args);
  const out = [];
  let err = '';
  proc.stdout.on('data', (d) => out.push(d));
  proc.stderr.on('data', (d) => { err += d; });
  proc.on('error', reject);
  proc.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: err }));
});

export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
export const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; };
export const r2 = (v) => Math.round(v * 100) / 100;

// `ffmpeg -i` stream lines → spec. ffmpeg-static ships no ffprobe.
export const parseInfo = (stderr) => {
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
  const vline = (stderr.match(/Stream #\S+.*Video: .*/) || [''])[0];
  const aline = (stderr.match(/Stream #\S+.*Audio: .*/) || [''])[0];
  if (!vline) throw new Error('No video stream in the file.');
  const pixFmt = (/\b((?:yuv|yuvj|rgb|gbr|gray)\w*)/.exec(vline.split('Video:')[1]) || [])[1] || '';
  const colorParen = new RegExp(`${pixFmt}\\(([^)]*)\\)`).exec(vline);
  const size = /, (\d{2,5})x(\d{2,5})/.exec(vline);
  const spec = {
    codec: (/Video: (\w+)/.exec(vline) || [])[1],
    profile: (/Video: \w+ \(([^)]+)\)/.exec(vline) || [])[1] || '',
    pixFmt,
    color: colorParen ? colorParen[1] : '',
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    fps: Number((/([\d.]+) fps/.exec(vline) || [])[1] || 0),
    bitrateMbps: r2(Number((/(\d+) kb\/s/.exec(vline) || /bitrate: (\d+) kb\/s/.exec(stderr) || [])[1] || 0) / 1000),
    durationSec: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
    bits: Number((/p(\d+)(?:le|be)/.exec(pixFmt) || [])[1] || 8),
  };
  const audio = aline ? {
    codec: (/Audio: (\w+)/.exec(aline) || [])[1],
    sampleRate: Number((/(\d+) Hz/.exec(aline) || [])[1] || 0),
    layout: (/Hz, ([^,]+)/.exec(aline) || [])[1] || '',
  } : null;
  return { spec, audio };
};
