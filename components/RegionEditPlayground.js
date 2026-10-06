import { useEffect, useRef, useState } from 'react';
import { Button, Input, Message, Radio, Slider, Switch, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { IconDelete, IconLoading, IconRefresh, IconUpload } from '@arco-design/web-react/icon';
import { resolveModelId } from '../utils/film/suiteConfig';
import { renderTemplate } from '../utils/film/promptTemplates';
import { MAX_REGIONS, PRIMARIES, WHEELS, describeGrade, isNeutral, neutralGrade, whereInFrame } from '../utils/regionGrade';
import RegionViewer from './region/RegionViewer';
import ColorWheel from './region/ColorWheel';
import styles from '../styles/Playground.module.css';

// REGION EDIT: draw windows on a clip, grade inside them with post-style controls (previewed
// live), then hand the correction to Seedance 2.5 edit mode — with a mask video and the graded
// frame as reference, or with no mask: the area named in text plus its reference colours.

const VIDEO_SLOT = 'seedance25'; // edit mode: Seedance 2.5
const STORE_KEY = 'regionEdit.v1';
const POLL_MS = 8000;
const TOOLS = [['select', 'Select'], ['ellipse', 'Ellipse'], ['rect', 'Rectangle'], ['lasso', 'Lasso']];
const REGION_COLORS = ['#ff3d9a', '#3dd6ff', '#ffd23d'];
const MODE_LABEL = { masked: 'With mask', unmasked: 'No mask' };

const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; } };
const save = (v) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* per-viewer convenience only */ } };
const MASTER = { resolution: '1080p', output_format: 'mov' }; // Seedance 2.5 1080p MOV = HEVC 10-bit 4:4:4
const elapsed = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };

const uploadBlob = async (blob, type) => {
  const r = await fetch('/api/mediakit/upload', { method: 'POST', headers: { 'Content-Type': type }, body: blob });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.url) throw new Error(d.error || `Upload failed (HTTP ${r.status})`);
  return d.url;
};
const dataUrlBlob = async (u) => (await fetch(u)).blob();
// A palette swatch: the colours left to right as a smooth gradient.
const swatchBlob = (colours) => new Promise((ok) => {
  const c = document.createElement('canvas'); c.width = 768; c.height = 384;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, c.width, 0);
  colours.forEach((col, i) => grad.addColorStop(colours.length === 1 ? 0 : i / (colours.length - 1), col));
  g.fillStyle = colours.length === 1 ? colours[0] : grad;
  g.fillRect(0, 0, c.width, c.height);
  c.toBlob(ok, 'image/png');
});

const Row = ({ label, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', alignItems: 'center', gap: 8, fontSize: 12, color: '#4e5969' }}>{label}{children}</div>
);

// Original vs render, one over the other, split by a draggable wipe.
const Compare = ({ originalUrl, resultUrl }) => {
  const a = useRef(null); const b = useRef(null);
  const [wipe, setWipe] = useState(50);
  // A paused video shows black until a frame is decoded: seek a hair in so both sides draw.
  const showFirstFrame = (e) => { if (e.currentTarget.paused && e.currentTarget.currentTime === 0) e.currentTarget.currentTime = 0.01; };
  // A new render starts both sides from the top.
  useEffect(() => { if (a.current) { a.current.pause(); a.current.currentTime = 0.01; } }, [resultUrl]);
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
        <video ref={a} src={originalUrl} muted playsInline loop preload="auto" onLoadedData={showFirstFrame} style={{ width: '100%', display: 'block' }} />
        <video ref={b} key={resultUrl} src={resultUrl} muted playsInline loop controls preload="auto" onLoadedData={showFirstFrame} onPlay={sync} onPause={sync} onSeeked={sync}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', clipPath: `inset(0 ${100 - wipe}% 0 0)` }} />
        <span style={{ position: 'absolute', top: 0, bottom: 40, left: `${wipe}%`, width: 2, background: '#fff', pointerEvents: 'none' }} />
        <span style={{ position: 'absolute', left: 8, top: 8, fontSize: 11, color: '#fff', background: 'rgba(0,0,0,.6)', padding: '3px 6px', borderRadius: 3 }}>RENDER</span>
        <span style={{ position: 'absolute', right: 8, top: 8, fontSize: 11, color: '#fff', background: 'rgba(0,0,0,.6)', padding: '3px 6px', borderRadius: 3 }}>ORIGINAL</span>
      </div>
      <Slider size="small" min={0} max={100} value={wipe} onChange={setWipe} formatTooltip={(v) => `${v}% render`} />
    </div>
  );
};

const RegionEditPlayground = () => {
  const [source, setSource] = useState(null); // { sourceUrl, viewUrl, spec, hasAudio, name }
  const [loading, setLoading] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [regions, setRegions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState('ellipse');
  const [wipeOn, setWipeOn] = useState(false);
  const [wipe, setWipe] = useState(0.5);
  const [showMask, setShowMask] = useState(false);
  const [renders, setRenders] = useState([]);
  const [compareId, setCompareId] = useState(null);
  const [, tick] = useState(0);
  const viewer = useRef(null);
  const fileRef = useRef(null);
  const hydrated = useRef(false);

  // Restore this viewer's session; renders still at Seedance pick up their polling.
  useEffect(() => {
    const s = load();
    if (s?.source) setSource(s.source);
    if (Array.isArray(s?.regions)) setRegions(s.regions);
    if (!Array.isArray(s?.renders)) return;
    const rs = s.renders.map((r) => (r.status === 'preparing' ? { ...r, status: 'error', error: 'Interrupted by a reload before it was sent.' } : r));
    setRenders(rs);
    rs.filter((r) => r.status === 'rendering' && r.taskId).forEach((r) => poll(r.id, r.taskId).catch((e) => patchRender(r.id, { status: 'error', error: e.message }))); // eslint-disable-line no-use-before-define
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; } // the first pass holds the empty initial state
    save({ source, regions, renders });
  }, [source, regions, renders]);
  const running = renders.some((r) => r.status === 'preparing' || r.status === 'rendering');
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const sel = regions.find((r) => r.id === selectedId) || null;
  const selIndex = regions.findIndex((r) => r.id === selectedId);
  const patchRegion = (id, p) => setRegions((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const patchGrade = (id, p) => setRegions((rs) => rs.map((r) => (r.id === id ? { ...r, grade: { ...r.grade, ...p } } : r)));
  const patchRender = (id, p) => setRenders((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  // ---- source
  const openClip = async (url, name) => {
    setLoading(true);
    try {
      const r = await fetch('/api/regionedit/source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error || `Could not load the clip (HTTP ${r.status})`);
      setSource({ ...d, name });
      setRegions([]); setSelectedId(null); setCompareId(null);
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
    try { await openClip(await uploadBlob(file, file.type), file.name); } catch (e) { Message.error(e.message); setLoading(false); }
  };

  // ---- prompts, built from the windows and their grades
  const regionWords = (r) => [...describeGrade(r.grade), r.note.trim()].filter(Boolean).join('; ');
  const maskedPrompt = () => renderTemplate('regionEdit.masked', {
    regions: regions.map((r, i) => `- Region ${i + 1}${r.name.trim() ? ` (${r.name.trim()})` : ''}, ${whereInFrame(r.pts)}: ${regionWords(r) || 'as in @Image1'}.`).join('\n'),
  });
  const unmaskedPrompt = (colourSets) => renderTemplate('regionEdit.unmasked', {
    regions: regions.map((r, i) => `- ${r.name.trim()}${regionWords(r) ? `: ${regionWords(r)}` : ''}; reference colours ${colourSets[i].join(', ')} from left to right, as in @Image${i + 1}.`).join('\n'),
  });
  const coloursOf = (r, i) => (r.colours.length ? r.colours : viewer.current.sampleColours(i));

  const problems = (mode) => {
    if (!source) return 'Load a clip first.';
    if (!regions.length) return 'Draw at least one window.';
    if (regions.some((r) => isNeutral(r.grade) && !r.note.trim())) return 'Every window needs a correction: move a control or write a note.';
    if (mode === 'unmasked' && regions.some((r) => !r.name.trim())) return 'Without a mask, each window needs a name for what is in it ("the sofa").';
    if (!resolveModelId(VIDEO_SLOT)) return 'Seedance 2.5 is not configured — set MODELARK_MODEL_SEEDANCE_25 in .env.local.';
    return '';
  };

  const poll = async (id, taskId) => {
    for (;;) {
      const r = await fetch(`/api/seedance-status?taskId=${encodeURIComponent(taskId)}`); // eslint-disable-line no-await-in-loop
      const d = await r.json().catch(() => ({})); // eslint-disable-line no-await-in-loop
      if (r.ok && d.status === 'succeeded') {
        const vr = await fetch('/api/regionedit/source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: d.video_cache_url }) }); // eslint-disable-line no-await-in-loop
        const vd = await vr.json().catch(() => ({})); // eslint-disable-line no-await-in-loop
        if (!vr.ok || vd.error) throw new Error(vd.error || `Preview copy failed (HTTP ${vr.status})`);
        patchRender(id, { status: 'done', error: '', resultUrl: d.video_cache_url, resultViewUrl: vd.viewUrl, resultSpec: vd.spec });
        setCompareId(id);
        return;
      }
      if (r.ok && ['failed', 'expired', 'cancelled'].includes(d.status)) throw new Error(d.error?.message || `Render ${d.status}`);
      await new Promise((ok) => setTimeout(ok, POLL_MS)); // eslint-disable-line no-await-in-loop
    }
  };

  const render = async (mode) => {
    const why = problems(mode);
    if (why) { Message.warning(why); return; }
    const id = `x${Date.now()}${mode[0]}`;
    setRenders((rs) => [{ id, mode, status: 'preparing', startedAt: Date.now(), at: viewer.current.time() }, ...rs]);
    try {
      const V = (url) => ({ type: 'video_url', video_url: { url }, role: 'reference_video' });
      const I = (url) => ({ type: 'image_url', image_url: { url }, role: 'reference_image' });
      let prompt; let refs; let extra = {};
      if (mode === 'masked') {
        const mr = await fetch('/api/regionedit/mask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceUrl: source.sourceUrl, maskPng: viewer.current.maskPng() }) });
        const md = await mr.json().catch(() => ({}));
        if (!mr.ok || md.error) throw new Error(md.error || `Mask video failed (HTTP ${mr.status})`);
        const refUrl = await uploadBlob(await dataUrlBlob(viewer.current.gradedPng()), 'image/png');
        prompt = maskedPrompt();
        refs = [V(source.sourceUrl), V(md.maskUrl), I(refUrl)];
        extra = { maskUrl: md.maskUrl, refUrls: [refUrl] };
      } else {
        const sets = regions.map(coloursOf);
        if (sets.some((s) => !s.length)) throw new Error('A window has no measurable colour — draw it over the picture.');
        const refUrls = [];
        for (const s of sets) refUrls.push(await uploadBlob(await swatchBlob(s), 'image/png')); // eslint-disable-line no-await-in-loop
        prompt = unmaskedPrompt(sets);
        refs = [V(source.sourceUrl), ...refUrls.map(I)];
        extra = { refUrls, colours: sets };
      }
      patchRender(id, { status: 'rendering', prompt, ...extra });
      const r = await fetch('/api/seedance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: resolveModelId(VIDEO_SLOT), content: [{ type: 'text', text: prompt }, ...refs], ...MASTER, ratio: 'adaptive', duration: -1, omni_reference_task_type: 'edit', generate_audio: false, watermark: false }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) throw new Error(d.error || `Render request failed (HTTP ${r.status})`);
      patchRender(id, { taskId: d.id });
      await poll(id, d.id);
    } catch (e) {
      patchRender(id, { status: 'error', error: e.message });
    }
  };

  const addRegion = (rs, created) => {
    if (created) {
      setRegions([...rs.slice(0, -1), { ...created, feather: 0.01, grade: neutralGrade(), name: '', note: '', colours: [] }]);
      setSelectedId(created.id);
      setTool('select');
    } else setRegions(rs);
  };
  const compare = renders.find((r) => r.id === compareId && r.resultViewUrl);

  return (
    <div className={styles.playgroundContainer}>
      {/* SOURCE */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button icon={loading ? <IconLoading /> : <IconUpload />} disabled={loading} onClick={() => fileRef.current?.click()}>{source ? 'Replace clip' : 'Open a clip'}</Button>
        <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
        <Input size="small" style={{ flex: 1, minWidth: 220 }} placeholder="…or paste a video URL (4–30 s)" value={urlDraft} onChange={setUrlDraft} onPressEnter={() => { if (urlDraft.trim()) { openClip(urlDraft.trim(), urlDraft.split('/').pop()); setUrlDraft(''); } }} allowClear />
        {source && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {source.name ? `${source.name} · ` : ''}{source.spec.width}×{source.spec.height} · {source.spec.fps} fps · {source.spec.durationSec.toFixed(1)} s · {source.spec.codec} {source.spec.pixFmt}
          </Typography.Text>
        )}
      </div>

      {!source && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()}
          style={{ marginTop: 12, border: '2px dashed #c9cdd4', borderRadius: 10, padding: '48px 16px', textAlign: 'center', color: '#86909c', cursor: 'pointer', background: '#fafafa' }}
        >
          <IconUpload style={{ fontSize: 28 }} />
          <div style={{ marginTop: 8 }}>Drop a 4–30 s clip, then draw windows on it and grade inside them</div>
        </div>
      )}

      {source && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 16, marginTop: 12, alignItems: 'start' }}>
          {/* VIEWER */}
          <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Radio.Group type="button" size="small" value={tool} onChange={setTool}>
                {TOOLS.map(([k, l]) => <Radio key={k} value={k} disabled={k !== 'select' && regions.length >= MAX_REGIONS}>{l}</Radio>)}
              </Radio.Group>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: '#4e5969' }}>Wipe</span>
              <Switch size="small" checked={wipeOn} onChange={setWipeOn} />
              {wipeOn && <div style={{ width: 120 }}><Slider size="small" min={0} max={1} step={0.01} value={wipe} onChange={setWipe} formatTooltip={(v) => `${Math.round(v * 100)}% graded`} /></div>}
              <span style={{ fontSize: 12, color: '#4e5969' }}>Show windows</span>
              <Switch size="small" checked={showMask} onChange={setShowMask} />
            </div>
            <RegionViewer
              ref={viewer}
              src={source.viewUrl}
              fps={source.spec.fps || 24}
              regions={regions}
              selectedId={selectedId}
              tool={tool}
              onSelect={setSelectedId}
              onRegionsChange={addRegion}
              wipe={wipeOn ? wipe : null}
              showMask={showMask}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {regions.length >= MAX_REGIONS ? `${MAX_REGIONS} windows is the limit.` : 'Pick a shape and drag on the picture to draw a window. Select mode moves a window. Windows stay put for the whole clip.'}
            </Typography.Text>
          </div>

          {/* INSPECTOR */}
          <div style={{ display: 'grid', gap: 10, border: '1px solid #e5e6eb', borderRadius: 8, padding: 12, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {regions.map((r, i) => (
                <Tag key={r.id} checkable checked={r.id === selectedId} onCheck={() => setSelectedId(r.id)} style={{ borderColor: REGION_COLORS[i] }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: REGION_COLORS[i], marginRight: 6 }} />
                  {r.name.trim() || `Window ${i + 1}`}
                </Tag>
              ))}
              {!regions.length && <Typography.Text type="secondary" style={{ fontSize: 12 }}>No windows yet.</Typography.Text>}
            </div>
            {sel && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Typography.Text bold>Window {selIndex + 1}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{sel.shape}</Typography.Text>
                  <span style={{ flex: 1 }} />
                  <Tooltip content="Reset the grade"><Button size="mini" icon={<IconRefresh />} onClick={() => patchRegion(sel.id, { grade: neutralGrade() })} /></Tooltip>
                  <Tooltip content="Delete the window"><Button size="mini" status="danger" icon={<IconDelete />} onClick={() => { setRegions((rs) => rs.filter((r) => r.id !== sel.id)); setSelectedId(null); }} /></Tooltip>
                </div>
                <Row label="What's in it"><Input size="small" placeholder="e.g. the sofa (needed without a mask)" value={sel.name} onChange={(v) => patchRegion(sel.id, { name: v })} /></Row>
                <Row label="Feather"><Slider size="small" min={0} max={0.05} step={0.002} value={sel.feather} onChange={(v) => patchRegion(sel.id, { feather: v })} formatTooltip={(v) => `${(v * 100).toFixed(1)}% of width`} /></Row>
                <div style={{ height: 1, background: '#e5e6eb' }} />
                {PRIMARIES.map((p) => (
                  <Row key={p.key} label={<span onDoubleClick={() => patchGrade(sel.id, { [p.key]: p.def })} title="Double-click to reset">{p.label}</span>}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 46px', gap: 6, alignItems: 'center' }}>
                      <Slider size="small" min={p.min} max={p.max} step={p.step} value={sel.grade[p.key]} onChange={(v) => patchGrade(sel.id, { [p.key]: v })} />
                      <span style={{ fontFamily: 'monospace', fontSize: 11, textAlign: 'right' }}>{Number(sel.grade[p.key]).toFixed(p.step < 1 ? 2 : 0)}</span>
                    </div>
                  </Row>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 }}>
                  {WHEELS.map((w) => <ColorWheel key={w.key} label={w.label} master={w.master} value={sel.grade[w.key]} onChange={(v) => patchGrade(sel.id, { [w.key]: v })} />)}
                </div>
                <div style={{ height: 1, background: '#e5e6eb' }} />
                <Row label="Ref. colours">
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                    {sel.colours.map((c, i) => (
                      <input key={i} type="color" value={c} aria-label={`Reference colour ${i + 1}`} onChange={(e) => patchRegion(sel.id, { colours: sel.colours.map((x, j) => (j === i ? e.target.value : x)) })} style={{ width: 28, height: 24, padding: 0, border: '1px solid #e5e6eb', borderRadius: 4 }} />
                    ))}
                    <Button size="mini" onClick={() => patchRegion(sel.id, { colours: viewer.current.sampleColours(selIndex) })}>{sel.colours.length ? 'Re-sample' : 'Sample graded'}</Button>
                    {sel.colours.length > 0 && <Button size="mini" onClick={() => patchRegion(sel.id, { colours: [] })}>Clear</Button>}
                  </div>
                </Row>
                <Input.TextArea placeholder="Anything a grade can't say (optional) — e.g. 'make it look like worn leather'" autoSize={{ minRows: 2, maxRows: 4 }} value={sel.note} onChange={(v) => patchRegion(sel.id, { note: v })} />
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {describeGrade(sel.grade).join('; ') || 'Neutral — no correction yet.'}
                </Typography.Text>
              </>
            )}
          </div>
        </div>
      )}

      {/* RENDER */}
      {source && (
        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button type="primary" onClick={() => render('masked')}>Render with mask</Button>
            <Button onClick={() => render('unmasked')}>Render without mask</Button>
            <Button onClick={() => { render('masked'); render('unmasked'); }}>Render both</Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Seedance 2.5 edit, 1080p 10-bit MOV. With mask: the clip, a mask video and the graded frame. Without: the windows named in text with their reference colours.
            </Typography.Text>
          </div>
          {compare && (
            <div style={{ display: 'grid', gap: 6 }}>
              <Typography.Text bold>{MODE_LABEL[compare.mode]} · compare</Typography.Text>
              <Compare originalUrl={source.viewUrl} resultUrl={compare.resultViewUrl} />
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {renders.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${r.id === compareId ? '#165dff' : '#e5e6eb'}`, borderRadius: 8, padding: 10, display: 'grid', gap: 6, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Tag size="small" color={r.mode === 'masked' ? 'arcoblue' : 'purple'}>{MODE_LABEL[r.mode]}</Tag>
                  {r.status === 'done' && <Tag size="small" color="green">Done</Tag>}
                  {r.status === 'error' && <Tag size="small" color="red">Failed</Tag>}
                  {(r.status === 'preparing' || r.status === 'rendering') && <Tag size="small" color="arcoblue"><IconLoading style={{ marginRight: 4 }} />{r.status === 'preparing' ? 'Preparing' : 'Rendering'} · {elapsed(r.startedAt)}</Tag>}
                  <span style={{ flex: 1 }} />
                  {r.resultViewUrl && <Button size="mini" type={r.id === compareId ? 'primary' : 'secondary'} onClick={() => setCompareId(r.id)}>Compare</Button>}
                  {r.resultUrl && <a href={r.resultUrl} download style={{ fontSize: 12 }}>MOV master</a>}
                  <Button size="mini" icon={<IconDelete />} onClick={() => { setRenders((rs) => rs.filter((x) => x.id !== r.id)); if (compareId === r.id) setCompareId(null); }} />
                </div>
                {r.error && <Typography.Text type="error" style={{ fontSize: 12 }}>{r.error}</Typography.Text>}
                {r.refUrls?.length > 0 && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {r.refUrls.map((u) => <img key={u} src={u} alt="reference" style={{ height: 40, borderRadius: 3, border: '1px solid #e5e6eb' }} />)}
                    {r.colours?.flat().map((c, i) => <span key={i} title={c} style={{ width: 14, height: 40, background: c, borderRadius: 2 }} />)}
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

export default RegionEditPlayground;
