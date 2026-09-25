import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, InputNumber, Message, Popconfirm, Select, Typography } from '@arco-design/web-react';
import { IconDownload, IconLoading, IconUpload } from '@arco-design/web-react/icon';
import styles from '../styles/Playground.module.css';

// BytePlus AI MediaKit video enhancement: input video | enhanced video, side by side,
// with the task's parameters between them and the Enhance action. Parameter names and
// values are the API's own (docs: "Create a video quality enhancement task").

const RESOLUTIONS = ['240p', '360p', '480p', '540p', '720p', '1080p', '2k', '4k', '6k', '8k'];
const SCENES = ['common', 'ugc', 'short_series', 'aigc', 'old_film'];
// THE CODEC TABLE (docs: "The bit depth, codec, and output container combinations").
// Professional only. Codec leads: it fixes the container and the bit depths allowed.
const CODECS = [
  { codec: 'h264', depths: [8], container: 'MP4' },
  { codec: 'h265', depths: [8, 10, 12], container: 'MP4' },
  { codec: 'prores', depths: [10], container: 'MOV' },
  { codec: 'ffv1', depths: [16], container: 'MOV' },
  { codec: 'exr', depths: [16], container: 'EXR sequence' },
];
const BIT_DEPTHS = [8, 10, 12, 16];
// 'auto' = codec omitted; the API then picks by bit depth.
const AUTO_CODEC = { 8: 'h264', 10: 'h265', 12: 'h265', 16: 'ffv1' };
const NO_BITRATE_CODECS = ['prores', 'ffv1', 'exr'];
const codecRow = (codec) => CODECS.find((c) => c.codec === codec);
const effectiveCodec = (p) => (p.codec === 'auto' ? AUTO_CODEC[p.bit_depth] : p.codec);

const DEFAULT_PARAMS = {
  tool_version: 'professional',
  scene: 'common',
  enhance_style: 'hd',
  resolution: '4k',
  resolution_limit: null, // short side in px; set = precise mode, and `resolution` is not sent
  bitrate_level: 'high',
  fps: null, // null = keep the source frame rate
  bit_depth: 10,
  codec: 'auto',
};

// Output resolution — two MUTUALLY EXCLUSIVE methods (docs: "Configure output
// resolution"): a preset level, or a precise short side in px that keeps the aspect.
const SHORT_SIDE = [128, 4320];
const CUSTOM = 'custom';
// Expected output size for a short-side limit: the short side is locked to the limit and
// the long side scales proportionally (640×480 at 720 → 960×720). APPROXIMATE — the
// service aligns the long side itself (854×480 at 600 came back 1064×600, not 1068), so
// the real size is read off the delivered video.
const limitDims = (limit, w, h) => {
  if (!limit || !w || !h) return null;
  const k = limit / Math.min(w, h);
  return { w: Math.round(w * k), h: Math.round(h * k) };
};

const STORE_KEY = 'videoEnhance.v1'; // this viewer's last task, so a reload resumes it
const POLL_MS = 10000;

const load = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
};
const save = (v) => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* per-viewer convenience only */ }
};

// The request body the API receives: parameters that do not apply to the chosen
// version are left out rather than sent to be ignored.
const apiParams = (p) => {
  const pro = p.tool_version === 'professional';
  const noBitrate = pro && (p.bit_depth === 16 || NO_BITRATE_CODECS.includes(effectiveCodec(p)));
  return {
    tool_version: p.tool_version,
    ...(pro ? {} : { scene: p.scene }),
    enhance_style: p.enhance_style,
    ...(p.resolution_limit ? { resolution_limit: p.resolution_limit } : { resolution: p.resolution }),
    ...(noBitrate ? {} : { bitrate_level: p.bitrate_level }),
    ...(p.fps ? { fps: p.fps } : {}),
    ...(pro ? { bit_depth: p.bit_depth } : {}),
    ...(pro && p.codec !== 'auto' ? { codec: p.codec } : {}),
  };
};

// Processing-time estimate from the docs' real-time factors (RTF × input duration).
const estimateText = (seconds, p) => {
  if (!seconds) return '';
  // Pro tiers: ≤1080p, 2K, ≥4K — a short-side limit falls into the tier of its size.
  const tier = p.resolution_limit
    ? (p.resolution_limit <= 1080 ? 'hd' : p.resolution_limit <= 1440 ? '2k' : '4k')
    : (RESOLUTIONS.indexOf(p.resolution) <= RESOLUTIONS.indexOf('1080p') ? 'hd' : p.resolution === '2k' ? '2k' : '4k');
  let lo; let hi;
  if (p.tool_version === 'standard') [lo, hi] = seconds <= 20 ? [22, 22] : [6, 10];
  else if (tier === 'hd') [lo, hi] = [25, 25];
  else if (tier === '2k') [lo, hi] = [40, 40];
  else [lo, hi] = [60, 60];
  const fmt = (s) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);
  return lo === hi ? `≈ ${fmt(seconds * lo)}` : `≈ ${fmt(seconds * lo)}–${fmt(seconds * hi)}`;
};

const elapsed = (since) => {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

// A <div>, never a <label>: a label re-dispatches every click to the control inside
// it, which opens an Arco Select and closes it again in the same gesture.
const Field = ({ label, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#4e5969', minWidth: 0 }}>
    {label}
    {children}
  </div>
);

const panel = { background: '#0f1115', borderRadius: 8, aspectRatio: '16 / 9', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' };
const videoStyle = { width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' };

const VideoEnhancePlayground = () => {
  const [source, setSource] = useState(null); // { name, url (store/public), preview, duration, width, height }
  const [uploading, setUploading] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [task, setTask] = useState(null); // { id, status, startedAt, videoUrl, result, error, expiresAt }
  const [submitting, setSubmitting] = useState(false);
  const [outputError, setOutputError] = useState(false);
  const [outSize, setOutSize] = useState(null); // the delivered video's real pixel size
  const [, tick] = useState(0);
  const inputRef = useRef(null);
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const syncing = useRef(false);

  // Restore this viewer's last source, settings and task.
  useEffect(() => {
    const saved = load();
    if (!saved) return;
    if (saved.source?.url) setSource({ ...saved.source, preview: saved.source.url });
    if (saved.params) setParams({ ...DEFAULT_PARAMS, ...saved.params });
    if (saved.task?.id) setTask(saved.task);
  }, []);
  useEffect(() => {
    save({ source: source ? { name: source.name, url: source.url, duration: source.duration, width: source.width, height: source.height } : null, params, task });
  }, [source, params, task]);

  const poll = useCallback(async (id) => {
    const r = await fetch(`/api/mediakit/enhance-video?taskId=${encodeURIComponent(id)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Status check failed (HTTP ${r.status})`);
    setTask((t) => (t && t.id === id ? { ...t, status: d.status, videoUrl: d.videoUrl, result: d.result, error: d.error, expiresAt: d.expiresAt, pollError: '' } : t));
    return d.status;
  }, []);

  // Poll while running; refresh a finished task once on load (the API renews an
  // expiring result link when it is queried).
  useEffect(() => {
    if (!task?.id) return undefined;
    let stop = false;
    let timer;
    const run = async () => {
      try {
        const status = await poll(task.id);
        if (!stop && status === 'running') timer = setTimeout(run, POLL_MS);
      } catch (e) {
        setTask((t) => (t && t.id === task.id ? { ...t, pollError: e.message } : t));
        if (!stop) timer = setTimeout(run, POLL_MS);
      }
    };
    run();
    return () => { stop = true; clearTimeout(timer); };
  }, [task?.id, poll]);

  useEffect(() => {
    if (task?.status !== 'running') return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [task?.status]);

  useEffect(() => { setOutputError(false); setOutSize(null); }, [task?.videoUrl]);

  const readMeta = (src) => new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve({ duration: v.duration || 0, width: v.videoWidth || 0, height: v.videoHeight || 0 });
    v.onerror = () => resolve({ duration: 0, width: 0, height: 0 });
    v.src = src;
  });

  const pickFile = async (file) => {
    if (!file) return;
    if (!String(file.type || '').startsWith('video/')) { Message.warning('Choose a video file.'); return; }
    const preview = URL.createObjectURL(file);
    const meta = await readMeta(preview);
    setSource({ name: file.name, url: '', preview, ...meta });
    setUploading(true);
    try {
      const r = await fetch('/api/mediakit/upload', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || `Upload failed (HTTP ${r.status})`);
      setSource((s) => (s && s.preview === preview ? { ...s, url: d.url } : s));
    } catch (e) {
      Message.error(e.message);
      setSource(null);
    } finally {
      setUploading(false);
    }
  };

  const applyUrl = async () => {
    const url = urlDraft.trim();
    if (!/^https?:\/\//i.test(url)) { Message.warning('Paste a public http(s) video URL.'); return; }
    const meta = await readMeta(url);
    setSource({ name: url.split('/').pop().split('?')[0] || 'video', url, preview: url, ...meta });
    setUrlDraft('');
  };

  const setParam = (k, v) => setParams((p) => {
    const next = { ...p, [k]: v };
    // A codec allows only its own bit depths: picking one moves the depth onto its row.
    if (k === 'codec' && v !== 'auto' && !codecRow(v).depths.includes(next.bit_depth)) {
      const { depths } = codecRow(v);
      next.bit_depth = depths.includes(10) ? 10 : depths[0];
    }
    return next;
  });

  // Back to a blank tab: no input, no result, default settings (the save effect then
  // stores that blank state). There is no cancel API, so a running task keeps running
  // at BytePlus — it is only forgotten.
  const reset = () => {
    if (source?.preview?.startsWith('blob:')) URL.revokeObjectURL(source.preview);
    setSource(null);
    setUrlDraft('');
    setParams(DEFAULT_PARAMS);
    setTask(null);
    setOutSize(null);
    setOutputError(false);
  };

  const enhance = async () => {
    if (!source?.url) return;
    setSubmitting(true);
    try {
      const r = await fetch('/api/mediakit/enhance-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: source.url, params: apiParams(params) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.taskId) throw new Error(d.error || `Submit failed (HTTP ${r.status})`);
      setTask({ id: d.taskId, status: 'running', startedAt: Date.now(), videoUrl: null, result: null, error: null, expiresAt: null });
    } catch (e) {
      Message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Linked playback: play, pause and seek on either player drive the other.
  const mirror = (from) => (e) => {
    const a = from === 'left' ? leftRef.current : rightRef.current;
    const b = from === 'left' ? rightRef.current : leftRef.current;
    if (!a || !b || syncing.current) return;
    syncing.current = true;
    if (e.type === 'play') b.play().catch(() => {});
    if (e.type === 'pause') b.pause();
    if (e.type === 'seeked' && Math.abs(b.currentTime - a.currentTime) > 0.05) b.currentTime = a.currentTime;
    setTimeout(() => { syncing.current = false; }, 50);
  };
  const linked = (side) => ({ onPlay: mirror(side), onPause: mirror(side), onSeeked: mirror(side) });

  const pro = params.tool_version === 'professional';
  const noBitrate = pro && (params.bit_depth === 16 || NO_BITRATE_CODECS.includes(effectiveCodec(params)));
  const outCodec = codecRow(effectiveCodec(params));
  const outDims = limitDims(params.resolution_limit, source?.width, source?.height);
  const running = task?.status === 'running';
  const done = task?.status === 'completed' && task.videoUrl;
  const opt = (v) => <Select.Option key={v} value={v}>{v}</Select.Option>;

  return (
    <div className={styles.playgroundContainer}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {/* INPUT */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <Typography.Text bold>Input</Typography.Text>
            {source && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {[source.width && source.height ? `${source.width}×${source.height}` : '', source.duration ? `${source.duration.toFixed(1)}s` : ''].filter(Boolean).join(' · ')}
                {' · '}
                <a onClick={() => inputRef.current?.click()} style={{ cursor: 'pointer' }}>Replace</a>
              </Typography.Text>
            )}
          </div>
          <div
            style={{ ...panel, cursor: source ? 'default' : 'pointer', border: source ? 'none' : '2px dashed #c9cdd4', background: source ? panel.background : '#fafafa' }}
            onClick={() => { if (!source) inputRef.current?.click(); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}
          >
            {source ? (
              <video ref={leftRef} src={source.preview} controls muted playsInline style={videoStyle} {...linked('left')} />
            ) : (
              <div style={{ textAlign: 'center', color: '#86909c' }}>
                <IconUpload style={{ fontSize: 26 }} />
                <div style={{ marginTop: 6, fontSize: 13 }}>Drop a video or click to choose</div>
              </div>
            )}
            {uploading && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13 }}>
                <IconLoading /> Uploading…
              </div>
            )}
          </div>
          <input ref={inputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Input size="small" placeholder="…or paste a public video URL" value={urlDraft} onChange={setUrlDraft} onPressEnter={applyUrl} allowClear />
            <Button size="small" onClick={applyUrl}>Use</Button>
          </div>
        </div>

        {/* OUTPUT */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <Typography.Text bold>Enhanced</Typography.Text>
            {done && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {[outSize ? `${outSize.w}×${outSize.h}` : task.result?.resolution, task.result?.fps ? `${task.result.fps} fps` : '', task.result?.duration ? `${Number(task.result.duration).toFixed(1)}s` : ''].filter(Boolean).join(' · ')}
                {' · '}
                <a href={task.videoUrl} target="_blank" rel="noreferrer"><IconDownload /> Download</a>
              </Typography.Text>
            )}
          </div>
          <div style={panel}>
            {done && !outputError && (
              <video ref={rightRef} src={task.videoUrl} controls playsInline style={videoStyle} onError={() => setOutputError(true)} onLoadedMetadata={(e) => setOutSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })} {...linked('right')} />
            )}
            {done && outputError && (
              <div style={{ color: '#c9cdd4', fontSize: 13, textAlign: 'center', padding: 16 }}>
                This browser can’t play this format — use Download.
              </div>
            )}
            {running && (
              <div style={{ color: '#c9cdd4', fontSize: 13, textAlign: 'center', lineHeight: 1.7 }}>
                <IconLoading style={{ fontSize: 22 }} />
                <div>Enhancing · {elapsed(task.startedAt)}</div>
                {estimateText(source?.duration, params) && <div style={{ fontSize: 12, color: '#86909c' }}>Estimated {estimateText(source?.duration, params)}</div>}
                {task.pollError && <div style={{ fontSize: 12, color: '#f76560' }}>Status check failed — {task.pollError}. Retrying.</div>}
              </div>
            )}
            {task?.status === 'failed' && (
              <div style={{ color: '#f76560', fontSize: 13, textAlign: 'center', padding: 16 }}>{task.error || 'The task failed.'}</div>
            )}
            {!task && <div style={{ color: '#4e5969', fontSize: 13 }}>The enhanced video appears here</div>}
          </div>
          {task && (
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 11 }}>
              Task {task.id}
              {done && task.expiresAt ? ` · link valid until ${new Date(task.expiresAt * 1000).toLocaleString()}` : ''}
            </Typography.Text>
          )}
        </div>
      </div>

      {/* PARAMETERS + ACTION */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 10, marginTop: 16, alignItems: 'end' }}>
        <Field label="Version">
          <Select size="small" value={params.tool_version} onChange={(v) => setParam('tool_version', v)}>
            {opt('standard')}{opt('professional')}
          </Select>
        </Field>
        {!pro && (
          <Field label="Scene">
            <Select size="small" value={params.scene} onChange={(v) => setParam('scene', v)}>{SCENES.map(opt)}</Select>
          </Field>
        )}
        <Field label="Style">
          <Select size="small" value={params.enhance_style} onChange={(v) => setParam('enhance_style', v)}>{opt('hd')}{opt('natural')}</Select>
        </Field>
        <Field label="Resolution">
          <Select
            size="small"
            value={params.resolution_limit ? CUSTOM : params.resolution}
            onChange={(v) => setParams((p) => (v === CUSTOM
              ? { ...p, resolution_limit: p.resolution_limit || 2160 }
              : { ...p, resolution: v, resolution_limit: null }))}
            renderFormat={(o, v) => (v === CUSTOM ? 'Short side' : v)}
          >
            {RESOLUTIONS.map(opt)}
            <Select.Option value={CUSTOM}>Short side (px)…</Select.Option>
          </Select>
        </Field>
        {params.resolution_limit && (
          <Field label="Short side (px)">
            <InputNumber
              size="small"
              min={SHORT_SIDE[0]}
              max={SHORT_SIDE[1]}
              step={2}
              precision={0}
              value={params.resolution_limit}
              onChange={(v) => setParam('resolution_limit', Math.min(SHORT_SIDE[1], Math.max(SHORT_SIDE[0], Math.round(Number(v) || SHORT_SIDE[0]))))}
            />
          </Field>
        )}
        <Field label="Frame rate">
          <InputNumber size="small" min={15} max={120} placeholder="Source" value={params.fps ?? undefined} onChange={(v) => setParam('fps', v || null)} />
        </Field>
        {pro && (
          <Field label="Codec">
            <Select
              size="small"
              value={params.codec}
              onChange={(v) => setParam('codec', v)}
              renderFormat={(o, v) => v}
              triggerProps={{ autoAlignPopupWidth: false }}
            >
              <Select.Option value="auto">auto — picked by bit depth</Select.Option>
              {CODECS.map((c) => (
                <Select.Option key={c.codec} value={c.codec}>
                  {c.codec} — {c.container} · {c.depths.join('/')}-bit
                </Select.Option>
              ))}
            </Select>
          </Field>
        )}
        {pro && (
          <Field label="Bit depth">
            <Select size="small" value={params.bit_depth} onChange={(v) => setParam('bit_depth', v)}>
              {(params.codec === 'auto' ? BIT_DEPTHS : codecRow(params.codec).depths).map((d) => <Select.Option key={d} value={d}>{d}-bit</Select.Option>)}
            </Select>
          </Field>
        )}
        <Field label="Bitrate">
          <Select size="small" value={params.bitrate_level} onChange={(v) => setParam('bitrate_level', v)} disabled={noBitrate}>
            {opt('low')}{opt('medium')}{opt('high')}
          </Select>
        </Field>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button type="primary" onClick={enhance} loading={submitting} disabled={!source?.url || uploading || running} style={{ flex: 1 }}>
            {running ? 'Enhancing…' : 'Enhance'}
          </Button>
          <Popconfirm
            disabled={!running}
            title="The task keeps running at BytePlus — reset only forgets it here. Reset?"
            onOk={reset}
          >
            <Button onClick={() => { if (!running) reset(); }} disabled={uploading || submitting}>Reset</Button>
          </Popconfirm>
        </div>
      </div>
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
        Output: {[
          params.resolution_limit
            ? (outDims ? `≈ ${outDims.w} × ${outDims.h} px` : `short side ${params.resolution_limit} px`)
            : params.resolution,
          pro && outCodec ? `${outCodec.codec} · ${params.bit_depth}-bit · ${outCodec.container}${params.codec === 'auto' ? ' (auto)' : ''}` : '',
        ].filter(Boolean).join(' · ')}
      </Typography.Text>
      {pro && params.bit_depth === 12 && (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          12-bit is processed at 12 bits, but the h265 MP4 file is dithered down to 10-bit.
        </Typography.Text>
      )}
      {pro && params.bit_depth === 16 && (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          16-bit takes inputs up to 40 s, runs one task at a time, and sets its own bitrate. ffv1 writes a lossless MOV; exr writes an image sequence.
        </Typography.Text>
      )}
    </div>
  );
};

export default VideoEnhancePlayground;
