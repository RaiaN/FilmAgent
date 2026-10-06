import { useEffect, useRef, useState } from 'react';
import { Button, Input, InputNumber, Message, Popconfirm, Select, Switch, Tag, Typography } from '@arco-design/web-react';
import { IconDelete, IconDownload, IconLoading, IconRefresh } from '@arco-design/web-react/icon';
import { getModel, resolveConfig, resolveModelId } from '../utils/film/suiteConfig';
import { renderTemplate } from '../utils/film/promptTemplates';
import { requireSkillLine } from '../utils/film/skills';
import { RATIOS, SCORE_KEYS, SHOT_TYPES, buildReport, buildReportHtml, critiqueProblems, measuredLine, parseJson, shotListProblems } from '../utils/techTest';
import styles from '../styles/Playground.module.css';

// TECH TEST: one target (shot type × country × topic × style) → the planner writes N shots →
// each renders on Seedance 2.5 at 1080p as a 10-bit 4:4:4 MOV master → ingest QC
// (/api/techtest/qc) → planner review of the stills → a Markdown report for Lark.

const VIDEO_SLOT = 'seedance25'; // the only slot with MOV output
const STORE_KEY = 'techTest.v1'; // this viewer's run, so a reload resumes it
const POLL_MS = 8000;
const PARALLEL = 3; // more parallel renders stall upstream
const EMPTY_TARGET = { shotType: '', country: '', topic: '', style: '', count: 4, ratio: '16:9', seconds: 15, audio: true };
const STAGE = {
  draft: ['', 'Draft'], queued: ['gray', 'Queued'], rendering: ['arcoblue', 'Rendering'], analyzing: ['arcoblue', 'Measuring'],
  reviewing: ['arcoblue', 'Reviewing'], done: ['green', 'Done'], error: ['red', 'Failed'],
};
const VERDICT_COLOR = { usable: 'green', fixable: 'orange', reshoot: 'red' };
const BUSY = ['queued', 'rendering', 'analyzing', 'reviewing'];

const load = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
};
const save = (v) => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* per-viewer convenience only */ }
};
const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const open = (v) => (String(v || '').trim() ? String(v).trim() : 'open — your choice');
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

const planner = async ({ system, prompt, images }) => {
  const r = await fetch('/api/seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt: system, prompt, modelId: getModel('reasoner'), reasoningEffort: resolveConfig().runtime.reasoningEffort, ...(images ? { images } : {}) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `Planner failed (HTTP ${r.status})`);
  return d.content || '';
};

// Ask, check the answer in code, and give the model one chance to fix what failed.
const plannerJson = async ({ system, prompt, images, problemsOf }) => {
  let data = parseJson(await planner({ system, prompt, images }));
  let bad = problemsOf(data);
  if (bad.length) {
    data = parseJson(await planner({ system, prompt: `${prompt}\n\nYOUR LAST ANSWER FAILED THESE CHECKS — fix them: ${bad.join('; ')}`, images }));
    bad = problemsOf(data);
  }
  if (bad.length) throw new Error(`The planner's answer failed its checks: ${bad.join('; ')}`);
  return data;
};

const Field = ({ label, children, wide }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#4e5969', minWidth: 0, gridColumn: wide ? 'span 2' : undefined }}>
    {label}
    {children}
  </div>
);

const QcLine = ({ qc }) => {
  const s = qc.spec;
  const facts = [
    `${s.codec}${s.profile ? ` ${s.profile}` : ''} · ${s.pixFmt} · ${s.width}×${s.height} · ${s.fps} fps · ${s.bitrateMbps} Mbit/s`,
    qc.bitDepth.genuine == null ? `${qc.bitDepth.native}-bit` : qc.bitDepth.genuine ? 'real 10-bit' : 'padded 8-bit',
    qc.cuts.length ? `cuts at ${qc.cuts.map((c) => `${c.t}s`).join(', ')}` : 'no cuts',
    `blocking ${qc.blockiness}`,
    `flicker ${qc.flickerP95}`,
    qc.loudness?.lufs ? `${qc.loudness.lufs} LUFS` : 'no audio',
  ];
  return <Typography.Text type="secondary" style={{ fontSize: 11, lineHeight: 1.5 }}>{facts.join(' · ')}</Typography.Text>;
};

const Review = ({ c }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
    <div><Tag color={VERDICT_COLOR[c.verdict]} size="small">{c.verdict}</Tag></div>
    {SCORE_KEYS.map(([k, label]) => (
      <div key={k}><b>{label} {c[k].score}/2</b> — {c[k].reason}</div>
    ))}
    {c.issues.length > 0 && (
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {c.issues.map((x, i) => <li key={i}><Tag size="small" color={x.severity === 'blocking' ? 'red' : x.severity === 'major' ? 'orange' : 'gray'}>{x.severity}</Tag> {x.what}{x.where ? ` — ${x.where}` : ''}</li>)}
      </ul>
    )}
    {c.post_fixes.length > 0 && <div><b>Post work:</b> {c.post_fixes.join(' · ')}</div>}
  </div>
);

const TechTestPlayground = () => {
  const [target, setTarget] = useState(EMPTY_TARGET);
  const [shots, setShotsState] = useState([]);
  const [run, setRun] = useState(null); // { createdAt, video, planner }
  const [writing, setWriting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [, tick] = useState(0);
  // The pipeline reads a shot right after updating it, before React re-renders, so every
  // update goes through the ref first and the state follows.
  const shotsRef = useRef(shots);
  const setShots = (next) => {
    shotsRef.current = typeof next === 'function' ? next(shotsRef.current) : next;
    setShotsState(shotsRef.current);
  };
  const active = useRef(0);
  const started = useRef(new Set()); // shots handed to advance() and not yet finished
  const hydrated = useRef(false);

  useEffect(() => {
    const s = load();
    if (!s) return;
    if (s.target) setTarget({ ...EMPTY_TARGET, ...s.target });
    if (s.run) setRun(s.run);
    if (Array.isArray(s.shots)) setShots(s.shots.map((x) => (x.stage === 'queued' ? { ...x, stage: 'draft' } : x)));
  }, []);
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; } // the first pass holds the empty initial state
    save({ target, shots, run });
  }, [target, shots, run]);

  const busy = shots.some((s) => BUSY.includes(s.stage));
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const patch = (key, p) => setShots((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const shotOf = (key) => shotsRef.current.find((x) => x.key === key);
  const setT = (k, v) => setTarget((t) => ({ ...t, [k]: v }));

  const writeShots = async () => {
    if (!target.shotType.trim() || !target.country.trim()) { Message.warning('Pick a shot type and a country or region first.'); return; }
    setWriting(true);
    try {
      const system = renderTemplate('techTest.shots.system', {
        count: target.count, shotType: target.shotType, country: target.country, topic: open(target.topic), style: open(target.style),
        seconds: target.seconds, ratio: target.ratio, skill: await requireSkillLine(VIDEO_SLOT),
      });
      const list = await plannerJson({ system, prompt: renderTemplate('techTest.shots.user', { count: target.count }), problemsOf: (d) => shotListProblems(d, target.count) });
      setShots(list.map((s) => ({ key: newKey(), title: String(s.title).trim(), prompt: String(s.prompt).trim(), checks: s.checks.map((c) => String(c).trim()).filter(Boolean), stage: 'draft' })));
      setRun(null);
    } catch (e) {
      Message.error(e.message);
    } finally {
      setWriting(false);
    }
  };

  // ---- one shot: render → measure → review
  const review = async (key) => {
    const s = shotOf(key);
    patch(key, { stage: 'reviewing', error: '' });
    const q = s.qc;
    const images = [...q.stills.map((x) => x.url), q.cropUrl];
    const roster = [...q.stills.map((x, i) => `Image ${i + 1}: the frame at ${x.t} s (scaled to 1280 px wide)`), `Image ${q.stills.length + 1}: a 100% crop from the centre of the frame at ${q.cropT} s`].join('\n');
    const system = renderTemplate('techTest.critique.system', {
      shotType: target.shotType, country: target.country, topic: open(target.topic), style: open(target.style),
      prompt: s.prompt, checks: s.checks.filter((c) => c.trim()).map((c) => `- ${c.trim()}`).join('\n'), measured: measuredLine(q), imageRoster: roster,
    });
    const critique = await plannerJson({ system, prompt: renderTemplate('techTest.critique.user', {}), images, problemsOf: critiqueProblems });
    patch(key, { stage: 'done', critique: { ...critique, issues: critique.issues, post_fixes: critique.post_fixes.map(String) } });
  };

  const measure = async (key) => {
    patch(key, { stage: 'analyzing', error: '' });
    const r = await fetch('/api/techtest/qc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: shotOf(key).masterUrl }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || `QC failed (HTTP ${r.status})`);
    patch(key, { qc: d });
    await review(key);
  };

  const poll = async (key) => {
    for (;;) {
      const { taskId } = shotOf(key);
      const r = await fetch(`/api/seedance-status?taskId=${encodeURIComponent(taskId)}`); // eslint-disable-line no-await-in-loop
      const d = await r.json().catch(() => ({})); // eslint-disable-line no-await-in-loop
      if (r.ok && d.status === 'succeeded') {
        if (!d.video_cache_url) throw new Error('The render finished but could not be stored.');
        patch(key, { masterUrl: d.video_cache_url });
        return;
      }
      if (r.ok && ['failed', 'expired', 'cancelled'].includes(d.status)) throw new Error(d.error?.message || `Render ${d.status}`);
      await new Promise((ok) => setTimeout(ok, POLL_MS)); // eslint-disable-line no-await-in-loop
    }
  };

  const render = async (key) => {
    const model = resolveModelId(VIDEO_SLOT);
    if (!model) throw new Error('Seedance 2.5 is not configured — set MODELARK_MODEL_SEEDANCE_25 in .env.local.');
    const s = shotOf(key);
    patch(key, { stage: 'rendering', startedAt: Date.now(), error: '', qc: null, critique: null, masterUrl: null });
    const r = await fetch('/api/seedance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, content: [{ type: 'text', text: s.prompt }], resolution: '1080p', ratio: target.ratio, duration: target.seconds, generate_audio: !!target.audio, watermark: false, output_format: 'mov' }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.id) throw new Error(d.error || `Render request failed (HTTP ${r.status})`);
    patch(key, { taskId: d.id });
    await poll(key);
  };

  // Take a shot from where it stands: render (or, after a reload, re-attach to its task) →
  // measure → review. A shot that already has its master or its QC skips those steps.
  const advance = async (key, { reattach = false } = {}) => {
    started.current.add(key);
    active.current += 1;
    try {
      const s = shotOf(key);
      if (!s.masterUrl) { if (reattach && s.taskId) await poll(key); else await render(key); }
      if (!shotOf(key).qc) await measure(key); else await review(key);
    } catch (e) {
      patch(key, { stage: 'error', error: e.message });
    } finally {
      started.current.delete(key);
      active.current -= 1;
      setTimeout(pump, 0); // eslint-disable-line no-use-before-define
    }
  };

  function pump() {
    while (active.current < PARALLEL) {
      const next = shotsRef.current.find((x) => x.stage === 'queued' && !started.current.has(x.key));
      if (!next) return;
      patch(next.key, { stage: 'rendering' });
      advance(next.key);
    }
  }

  // After a reload: in-flight shots pick up where they stopped.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !shots.length) return;
    resumed.current = true;
    shots.filter((s) => ['rendering', 'analyzing', 'reviewing'].includes(s.stage)).forEach((s) => advance(s.key, { reattach: true }));
  }, [shots]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderAll = () => {
    if (!resolveModelId(VIDEO_SLOT)) { Message.error('Seedance 2.5 is not configured — set MODELARK_MODEL_SEEDANCE_25 in .env.local.'); return; }
    const todo = shots.filter((s) => s.stage === 'draft' || s.stage === 'error');
    if (!todo.length) return;
    setRun((r) => r || { createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '), video: resolveModelId(VIDEO_SLOT), planner: getModel('reasoner') });
    const ids = new Set(todo.map((s) => s.key));
    setShots((xs) => xs.map((x) => (ids.has(x.key) ? { ...x, stage: 'queued', error: '' } : x)));
    setTimeout(pump, 0);
  };

  const download = (text, type, ext) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = `tech-test-${slug(target.country)}-${slug(target.shotType)}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // Stored files → presigned links a reader outside this app can open (7 days).
  const presign = async (urls) => {
    const r = await fetch('/api/techtest/presign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || `Export failed (HTTP ${r.status})`);
    return d.links;
  };

  const reportArgs = () => ({ target, shots, models: { video: run?.video || resolveModelId(VIDEO_SLOT), planner: run?.planner || getModel('reasoner') }, createdAt: run?.createdAt || '' });

  const exportReport = async (kind) => {
    const withQc = shots.filter((s) => s.qc);
    if (!withQc.length) return;
    setExporting(kind);
    try {
      if (kind === 'md') {
        const links = await presign(withQc.flatMap((s) => [s.qc.contactUrl, s.qc.cropUrl, s.qc.proxyUrl, s.qc.masterUrl]));
        download(buildReport({ ...reportArgs(), link: (u) => links[u] }), 'text/markdown;charset=utf-8', 'md');
      } else {
        const links = await presign(withQc.flatMap((s) => [s.qc.proxyUrl, s.qc.masterUrl]));
        // Stills are embedded, so the page keeps its pictures after the links expire.
        const images = {};
        await Promise.all(withQc.flatMap((s) => [s.qc.contactUrl, s.qc.cropUrl, s.qc.stills[0].url]).map(async (u) => {
          const blob = await (await fetch(u)).blob();
          images[u] = await new Promise((ok, fail) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = fail; fr.readAsDataURL(blob); });
        }));
        download(buildReportHtml({ ...reportArgs(), media: { image: (u) => images[u], video: (u) => links[u], link: (u) => links[u] } }), 'text/html;charset=utf-8', 'html');
      }
    } catch (e) {
      Message.error(e.message);
    } finally {
      setExporting(false);
    }
  };

  const reset = () => { setShots([]); setRun(null); setTarget(EMPTY_TARGET); };

  const drafts = shots.filter((s) => s.stage === 'draft' || s.stage === 'error').length;
  const finished = shots.filter((s) => s.qc).length;
  const elapsed = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };

  return (
    <div className={styles.playgroundContainer}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
        <Field label="Shot type">
          <Select size="small" showSearch allowCreate placeholder="Pick or type" value={target.shotType || undefined} onChange={(v) => setT('shotType', v || '')}>
            {SHOT_TYPES.map((s) => <Select.Option key={s} value={s}>{s}</Select.Option>)}
          </Select>
        </Field>
        <Field label="Country / region"><Input size="small" placeholder="e.g. India" value={target.country} onChange={(v) => setT('country', v)} /></Field>
        <Field label="Topic"><Input size="small" placeholder="Optional" value={target.topic} onChange={(v) => setT('topic', v)} /></Field>
        <Field label="Style"><Input size="small" placeholder="Optional" value={target.style} onChange={(v) => setT('style', v)} /></Field>
        <Field label="Shots"><InputNumber size="small" min={1} max={12} value={target.count} onChange={(v) => setT('count', Math.max(1, Math.min(12, Number(v) || 1)))} /></Field>
        <Field label="Aspect ratio">
          <Select size="small" value={target.ratio} onChange={(v) => setT('ratio', v)}>{RATIOS.map((r) => <Select.Option key={r} value={r}>{r}</Select.Option>)}</Select>
        </Field>
        <Field label="Seconds"><InputNumber size="small" min={4} max={30} value={target.seconds} onChange={(v) => setT('seconds', Math.max(4, Math.min(30, Number(v) || 4)))} /></Field>
        <Field label="Audio"><div><Switch size="small" checked={target.audio} onChange={(v) => setT('audio', v)} /></div></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button type="primary" onClick={writeShots} loading={writing} disabled={busy}>{shots.length ? 'Rewrite shots' : 'Write shots'}</Button>
        <Button type="primary" status="success" onClick={renderAll} disabled={!drafts || busy || writing}>
          Render {drafts || ''} {drafts === 1 ? 'shot' : 'shots'} · 1080p 10-bit MOV
        </Button>
        <Button icon={<IconDownload />} onClick={() => exportReport('html')} loading={exporting === 'html'} disabled={!finished || !!exporting}>Export HTML</Button>
        <Button icon={<IconDownload />} onClick={() => exportReport('md')} loading={exporting === 'md'} disabled={!finished || !!exporting}>Export for Lark (.md)</Button>
        <span style={{ flex: 1 }} />
        <Popconfirm disabled={!busy} title="Renders keep running at BytePlus — reset only forgets them here. Reset?" onOk={reset}>
          <Button onClick={() => { if (!busy) reset(); }}>Reset</Button>
        </Popconfirm>
      </div>
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
        Each shot renders on Seedance 2.5 as a 1080p MOV master (HEVC 10-bit 4:4:4), then gets measured QC and a planner review. Export HTML for a page to view or share, or .md to import into Lark. Video and file links stay valid for 7 days.
      </Typography.Text>

      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        {shots.map((s, i) => {
          const editable = s.stage === 'draft' || s.stage === 'error';
          const [color, label] = STAGE[s.stage] || STAGE.draft;
          return (
            <div key={s.key} style={{ border: '1px solid #e5e6eb', borderRadius: 8, padding: 12, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Typography.Text bold style={{ whiteSpace: 'nowrap' }}>Shot {i + 1}</Typography.Text>
                <Input size="small" value={s.title} disabled={!editable} onChange={(v) => patch(s.key, { title: v })} style={{ maxWidth: 320 }} />
                {s.stage !== 'draft' && <Tag color={color} size="small">{BUSY.includes(s.stage) && <IconLoading style={{ marginRight: 4 }} />}{label}{s.stage === 'rendering' && s.startedAt ? ` · ${elapsed(s.startedAt)}` : ''}</Tag>}
                <span style={{ flex: 1 }} />
                {s.stage === 'error' && <Button size="mini" icon={<IconRefresh />} onClick={() => { patch(s.key, { stage: 'queued', error: '' }); setTimeout(pump, 0); }}>Retry</Button>}
                {editable && <Button size="mini" icon={<IconDelete />} onClick={() => setShots((xs) => xs.filter((x) => x.key !== s.key))} />}
              </div>
              {s.error && <Typography.Text type="error" style={{ fontSize: 12 }}>{s.error}</Typography.Text>}
              <div style={{ display: 'grid', gridTemplateColumns: s.qc ? 'repeat(auto-fit, minmax(320px, 1fr))' : '1fr', gap: 12 }}>
                <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                  <Input.TextArea value={s.prompt} disabled={!editable} autoSize={{ minRows: 3, maxRows: 10 }} onChange={(v) => patch(s.key, { prompt: v })} />
                  <Input.TextArea
                    value={(s.checks || []).join('\n')}
                    disabled={!editable}
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    placeholder="What to check — one per line"
                    onChange={(v) => patch(s.key, { checks: v.split('\n') })}
                  />
                  {s.critique && <Review c={s.critique} />}
                </div>
                {s.qc && (
                  <div style={{ display: 'grid', gap: 6, minWidth: 0, alignContent: 'start' }}>
                    <video src={s.qc.proxyUrl} controls muted playsInline preload="metadata" style={{ width: '100%', borderRadius: 6, background: '#000' }} />
                    <QcLine qc={s.qc} />
                    <img src={s.qc.contactUrl} alt={`Shot ${i + 1} contact sheet`} style={{ width: '100%', borderRadius: 6 }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TechTestPlayground;
