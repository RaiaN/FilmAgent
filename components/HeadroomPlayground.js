import { useEffect, useRef, useState } from 'react';
import { Button, Input, InputNumber, Message, Slider, Switch, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { IconDelete, IconLoading, IconUpload } from '@arco-design/web-react/icon';
import { resolveModelId } from '../utils/film/suiteConfig';
import { renderTemplate } from '../utils/film/promptTemplates';
import { DEFAULT_EV, DEFAULT_KEYFRAMES, EV_RANGE, MAX_KEYFRAMES } from '../utils/headroom';
import styles from '../styles/Playground.module.css';

// HEADROOM (synthetic bracketing): an underexposed plate of a 10-bit master. K keyframes are brought
// down by exactly EV stops in linear light, Seedance 2.5 edit carries them through the clip, and the
// plate is measured against the master — the exposure it held and the highlight range a merge recovers.

const VIDEO_SLOT = 'seedance25';
const STORE_KEY = 'headroom.v1';
const POLL_MS = 8000;
const MASTER = { resolution: '1080p', output_format: 'mov' }; // Seedance 2.5 1080p MOV = HEVC 10-bit 4:4:4

const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; } };
const save = (v) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* per-viewer convenience only */ } };
const elapsed = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `${url} failed (HTTP ${r.status})`);
  return d;
};
const list = (xs) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const stops = (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

// Master vs plate, one over the other, split by a draggable wipe.
const Compare = ({ masterUrl, plateUrl }) => {
  const a = useRef(null); const b = useRef(null);
  const [wipe, setWipe] = useState(50);
  const showFirstFrame = (e) => { if (e.currentTarget.paused && e.currentTarget.currentTime === 0) e.currentTarget.currentTime = 0.01; };
  useEffect(() => { if (a.current) { a.current.pause(); a.current.currentTime = 0.01; } }, [plateUrl]);
  const sync = (e) => {
    const lead = e.currentTarget; const other = lead === b.current ? a.current : b.current;
    if (!other) return;
    if (e.type === 'play') other.play().catch(() => {});
    if (e.type === 'pause') other.pause();
    if (Math.abs(other.currentTime - lead.currentTime) > 0.05) other.currentTime = lead.currentTime;
  };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ position: 'relative', background: '#000', borderRadius: 6, overflow: 'hidden' }}>
        <video ref={a} src={masterUrl} muted playsInline loop preload="auto" onLoadedData={showFirstFrame} style={{ width: '100%', display: 'block' }} />
        <video ref={b} key={plateUrl} src={plateUrl} muted playsInline loop controls preload="auto" onLoadedData={showFirstFrame} onPlay={sync} onPause={sync} onSeeked={sync}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', clipPath: `inset(0 ${100 - wipe}% 0 0)` }} />
        <span style={{ position: 'absolute', top: 0, bottom: 40, left: `${wipe}%`, width: 2, background: '#fff', pointerEvents: 'none' }} />
        <span style={{ position: 'absolute', left: 8, top: 8, fontSize: 11, color: '#fff', background: 'rgba(0,0,0,.6)', padding: '3px 6px', borderRadius: 3 }}>PLATE</span>
        <span style={{ position: 'absolute', right: 8, top: 8, fontSize: 11, color: '#fff', background: 'rgba(0,0,0,.6)', padding: '3px 6px', borderRadius: 3 }}>MASTER</span>
      </div>
      <Slider size="small" min={0} max={100} value={wipe} onChange={setWipe} formatTooltip={(v) => `${v}% plate`} />
    </div>
  );
};

const HeadroomPlayground = () => {
  const [source, setSource] = useState(null); // { sourceUrl, viewUrl, spec, hasAudio, name }
  const [loading, setLoading] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [ev, setEv] = useState(DEFAULT_EV);
  const [count, setCount] = useState(DEFAULT_KEYFRAMES);
  const [assets, setAssets] = useState(false);
  const [keyframes, setKeyframes] = useState(null); // { ev, count, assets, sourceUrl, items: [{ t, url, assetId? }] }
  const [building, setBuilding] = useState(false);
  const [runs, setRuns] = useState([]);
  const [compareId, setCompareId] = useState(null);
  const [, tick] = useState(0);
  const fileRef = useRef(null);
  const hydrated = useRef(false);

  const patchRun = (id, p) => setRuns((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  // Seedance's plate → preview copy → measured against the master.
  const finish = async (run, plateUrl) => {
    patchRun(run.id, { status: 'measuring', plateUrl });
    const view = await post('/api/headroom/source', { url: plateUrl });
    patchRun(run.id, { plateViewUrl: view.viewUrl });
    try {
      const m = await post('/api/headroom/measure', { sourceUrl: run.sourceUrl, plateUrl });
      patchRun(run.id, { status: 'done', error: '', measure: m });
    } catch (e) {
      patchRun(run.id, { status: 'done', error: e.message });
    }
    setCompareId(run.id);
  };
  const poll = async (run) => {
    for (;;) {
      const r = await fetch(`/api/seedance-status?taskId=${encodeURIComponent(run.taskId)}`); // eslint-disable-line no-await-in-loop
      const d = await r.json().catch(() => ({})); // eslint-disable-line no-await-in-loop
      if (r.ok && d.status === 'succeeded') { await finish(run, d.video_cache_url); return; } // eslint-disable-line no-await-in-loop
      if (r.ok && ['failed', 'expired', 'cancelled'].includes(d.status)) throw new Error(d.error?.message || `Render ${d.status}`);
      await new Promise((ok) => setTimeout(ok, POLL_MS)); // eslint-disable-line no-await-in-loop
    }
  };

  // Restore this viewer's session; plates still at Seedance pick up their polling.
  useEffect(() => {
    const s = load();
    if (s?.source) setSource(s.source);
    if (s?.keyframes) setKeyframes(s.keyframes);
    if (s?.settings) { setEv(s.settings.ev); setCount(s.settings.count); setAssets(!!s.settings.assets); }
    if (!Array.isArray(s?.runs)) return;
    const rs = s.runs.map((r) => (r.status === 'preparing' ? { ...r, status: 'error', error: 'Interrupted by a reload before it was sent.' } : r));
    setRuns(rs);
    rs.filter((r) => (r.status === 'rendering' || r.status === 'measuring') && r.taskId).forEach((r) => poll(r).catch((e) => patchRun(r.id, { status: 'error', error: e.message })));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; } // the first pass holds the empty initial state
    save({ source, keyframes, runs, settings: { ev, count, assets } });
  }, [source, keyframes, runs, ev, count, assets]);
  const running = runs.some((r) => ['preparing', 'rendering', 'measuring'].includes(r.status)) || building;
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // ---- source
  const openClip = async (url, name) => {
    setLoading(true);
    try {
      const d = await post('/api/headroom/source', { url });
      setSource({ ...d, name }); setKeyframes(null); setCompareId(null);
    } catch (e) {
      Message.error(e.message);
    } finally {
      setLoading(false);
    }
  };
  const pickFile = async (file) => {
    if (!file) return;
    if (!String(file.type).startsWith('video/')) { Message.warning('Choose a video file.'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/mediakit/upload', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || `Upload failed (HTTP ${r.status})`);
      await openClip(d.url, file.name);
    } catch (e) { Message.error(e.message); setLoading(false); }
  };

  // ---- keyframes: exact −EV in linear light
  const buildKeyframes = async () => {
    if (!source) return;
    setBuilding(true);
    try {
      const d = await post('/api/headroom/keyframes', { sourceUrl: source.sourceUrl, ev, count, assets });
      setKeyframes({ ev, count, assets, sourceUrl: source.sourceUrl, items: d.keyframes });
    } catch (e) {
      Message.error(e.message);
    } finally {
      setBuilding(false);
    }
  };
  const keyframesCurrent = keyframes && source && keyframes.sourceUrl === source.sourceUrl && keyframes.ev === ev && keyframes.count === count && keyframes.assets === assets;

  // ---- Seedance pass: the master plus the timestamped keyframes
  const carry = async () => {
    if (!keyframesCurrent) { Message.warning('Build the keyframes for these settings first.'); return; }
    if (!resolveModelId(VIDEO_SLOT)) { Message.warning('Seedance 2.5 is not configured — set MODELARK_MODEL_SEEDANCE_25 in .env.local.'); return; }
    const ks = keyframes.items;
    const prompt = renderTemplate('headroom.carry', {
      keyframes: ks.length === 1 ? `@Image1 is the frame of @Video1 at ${ks[0].t} s`
        : `${list(ks.map((_, i) => `@Image${i + 1}`))} are frames of @Video1 at ${list(ks.map((k) => `${k.t} s`))} respectively`,
    });
    const run = { id: `h${Date.now()}`, status: 'preparing', startedAt: Date.now(), ev: keyframes.ev, count: ks.length, sourceUrl: source.sourceUrl, prompt, keyframeUrls: ks.map((k) => k.url) };
    setRuns((rs) => [run, ...rs]);
    try {
      const refs = ks.map((k) => (k.assetId
        ? { type: 'image_asset_id', asset_id: k.assetId, role: 'reference_image' }
        : { type: 'image_url', image_url: { url: k.url }, role: 'reference_image' }));
      const r = await fetch('/api/seedance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: resolveModelId(VIDEO_SLOT), content: [{ type: 'text', text: prompt }, { type: 'video_url', video_url: { url: source.sourceUrl }, role: 'reference_video' }, ...refs], ...MASTER, ratio: 'adaptive', duration: -1, omni_reference_task_type: 'edit', generate_audio: false, watermark: false }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) {
        const msg = d.error || `Seedance request failed (HTTP ${r.status})`;
        throw new Error(/real person/i.test(msg) && !keyframes.assets ? `${msg} — the keyframes show a person: turn on "Keyframes as Assets", rebuild the keyframes and run again.` : msg);
      }
      patchRun(run.id, { status: 'rendering', taskId: d.id });
      await poll({ ...run, taskId: d.id });
    } catch (e) {
      patchRun(run.id, { status: 'error', error: e.message });
    }
  };

  const compare = runs.find((r) => r.id === compareId && r.plateViewUrl);
  const tenBit = source?.spec?.bits === 10;

  return (
    <div className={styles.playgroundContainer}>
      {/* SOURCE */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button icon={loading ? <IconLoading /> : <IconUpload />} disabled={loading} onClick={() => fileRef.current?.click()}>{source ? 'Replace master' : 'Open a master'}</Button>
        <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
        <Input size="small" style={{ flex: 1, minWidth: 220 }} placeholder="…or paste a video URL (4–30 s, 10-bit MOV)" value={urlDraft} onChange={setUrlDraft} onPressEnter={() => { if (urlDraft.trim()) { openClip(urlDraft.trim(), urlDraft.split('/').pop()); setUrlDraft(''); } }} allowClear />
        {source && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {source.name ? `${source.name} · ` : ''}{source.spec.width}×{source.spec.height} · {source.spec.fps} fps · {source.spec.durationSec.toFixed(1)} s · {source.spec.codec} {source.spec.pixFmt}
          </Typography.Text>
        )}
        {source && !tenBit && <Tag color="red">Not 10-bit — Headroom needs a 10-bit master</Tag>}
      </div>

      {!source && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()}
          style={{ marginTop: 12, border: '2px dashed #c9cdd4', borderRadius: 10, padding: '48px 16px', textAlign: 'center', color: '#86909c', cursor: 'pointer', background: '#fafafa' }}
        >
          <IconUpload style={{ fontSize: 28 }} />
          <div style={{ marginTop: 8 }}>Drop a 10-bit master (Seedance 2.5 1080p MOV, 4–30 s) to make an underexposed plate of it</div>
        </div>
      )}

      {source && (
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {compare ? <Compare masterUrl={source.viewUrl} plateUrl={compare.plateViewUrl} /> : <video src={source.viewUrl} controls muted playsInline preload="auto" style={{ width: '100%', borderRadius: 6, background: '#000' }} />}

          {/* KEYFRAMES */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: '#4e5969' }}>
            <span>Underexpose</span>
            <InputNumber size="small" style={{ width: 96 }} min={EV_RANGE[0]} max={EV_RANGE[1]} step={0.5} precision={1} value={ev} suffix="stops" onChange={(v) => setEv(Math.min(EV_RANGE[1], Math.max(EV_RANGE[0], Number(v) || DEFAULT_EV)))} />
            <span>Keyframes</span>
            <InputNumber size="small" style={{ width: 72 }} min={1} max={MAX_KEYFRAMES} step={1} precision={0} value={count} onChange={(v) => setCount(Math.min(MAX_KEYFRAMES, Math.max(1, Math.round(Number(v) || 1))))} />
            <Tooltip content="Seedance rejects raw frames that show a person; registering them in the Assets library gets them through.">
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Keyframes as Assets<Switch size="small" checked={assets} onChange={setAssets} /></span>
            </Tooltip>
            <Button onClick={buildKeyframes} disabled={!tenBit || building} icon={building ? <IconLoading /> : null}>{building ? 'Building keyframes' : 'Build keyframes'}</Button>
            <Button type="primary" onClick={carry} disabled={!keyframesCurrent}>Seedance pass</Button>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Build keyframes takes {count} evenly spaced frames of the master and brings each down by exactly {ev} stops in linear light: 10-bit Y′CbCr to R′G′B′ (BT.709, unclamped), linearised (BT.1886), × 2^−{ev}, re-encoded. The Seedance pass hands Seedance 2.5 the master and the timestamped keyframes, and returns a 1080p 10-bit plate. The plate is then measured against the master: the exposure Seedance actually held, and how far above white a merge brings the clipped highlights.
          </Typography.Text>
          {keyframes?.items && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, opacity: keyframesCurrent ? 1 : 0.45 }}>
              {keyframes.items.map((k) => (
                <figure key={k.url} style={{ margin: 0, flex: '0 0 auto', display: 'grid', gap: 2 }}>
                  <img src={k.url} alt={`keyframe at ${k.t} s`} style={{ height: 64, borderRadius: 3, border: '1px solid #e5e6eb' }} />
                  <figcaption style={{ fontSize: 10, color: '#86909c', textAlign: 'center' }}>{k.t} s{k.assetId ? ' · asset' : ''}</figcaption>
                </figure>
              ))}
            </div>
          )}

          {/* PLATES */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
            {runs.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${r.id === compareId ? '#165dff' : '#e5e6eb'}`, borderRadius: 8, padding: 10, display: 'grid', gap: 6, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Tag size="small" color="arcoblue">−{r.ev} EV · {r.count} kf</Tag>
                  {r.status === 'done' && <Tag size="small" color="green">Done</Tag>}
                  {r.status === 'error' && <Tag size="small" color="red">Failed</Tag>}
                  {['preparing', 'rendering', 'measuring'].includes(r.status) && <Tag size="small" color="arcoblue"><IconLoading style={{ marginRight: 4 }} />{{ preparing: 'Preparing', rendering: 'Rendering', measuring: 'Measuring' }[r.status]} · {elapsed(r.startedAt)}</Tag>}
                  <span style={{ flex: 1 }} />
                  {r.plateViewUrl && <Button size="mini" type={r.id === compareId ? 'primary' : 'secondary'} onClick={() => setCompareId(r.id)}>Compare</Button>}
                  {r.plateUrl && <a href={r.plateUrl} download style={{ fontSize: 12 }}>MOV plate</a>}
                  <Button size="mini" icon={<IconDelete />} onClick={() => { setRuns((rs) => rs.filter((x) => x.id !== r.id)); if (compareId === r.id) setCompareId(null); }} />
                </div>
                {r.error && <Typography.Text type="error" style={{ fontSize: 12 }}>{r.error}</Typography.Text>}
                {r.measure && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 12 }}>
                    <span style={{ color: '#86909c' }}>Exposure held</span><span><b>{stops(r.measure.heldEv)} EV</b> (asked −{r.ev}) · steady to ±{r.measure.stabilityStops.toFixed(2)} stop</span>
                    <span style={{ color: '#86909c' }}>Clipped in master</span><span>{r.measure.clippedPct.toFixed(2)}% of the frame · {r.measure.plateStillClippedPct.toFixed(1)}% of that still clips in the plate</span>
                    <span style={{ color: '#86909c' }}>Highlights</span><span>{stops(r.measure.heroStopsAboveWhite)} stop above white in the master → <b>{stops(r.measure.mergedStopsAboveWhite)}</b> after a merge</span>
                    <span style={{ color: '#86909c' }}>Frames</span><span>{r.measure.frames.plate} / {r.measure.frames.master}</span>
                  </div>
                )}
                {r.prompt && (
                  <details>
                    <summary style={{ fontSize: 12, cursor: 'pointer', color: '#165dff' }}>Prompt</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, margin: '6px 0 0', fontFamily: 'monospace' }}>{r.prompt}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default HeadroomPlayground;
