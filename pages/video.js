import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import {
  Button, Input, InputNumber, Select, Checkbox, Message, Typography, Tag, Upload, Spin,
} from '@arco-design/web-react';
import { IconPlus, IconRefresh, IconDelete } from '@arco-design/web-react/icon';

const { Text, Title } = Typography;

// VIDEO PLAYGROUND — the smallest thing that lets a customer test Seedance end to end:
// pick assets from the shared Asset Library, write a prompt, generate, watch the result.
// No canvas, no agents, no project. It reuses the kit's existing routes verbatim
// (/api/film/config · /api/film/library · /api/film/upload · /api/seedance ·
// /api/seedance-status), so nothing here forks server behaviour.

const MODEL_LABELS = {
  seedance25: 'Seedance 2.5 · up to 30s',
  seedance: 'Seedance 2.0',
  seedanceFast: 'Seedance 2.0 Fast',
  seedanceMini: 'Seedance 2.0 Mini',
};
const RES_BY_MODEL = {
  seedance25: ['480p', '720p', '1080p'],
  seedance: ['480p', '720p', '1080p', '4K'],
  seedanceFast: ['480p', '720p', '1080p', '4K'],
  seedanceMini: ['480p', '720p'],
};
const MAX_SECONDS = { seedance25: 30, seedance: 15, seedanceFast: 15, seedanceMini: 15 };
const RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'];
const POLL_MS = 4000;

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(new Error('Could not read that file'));
  fr.readAsDataURL(file);
});

export default function VideoPlayground() {
  const [models, setModels] = useState({});
  const [hasServerKey, setHasServerKey] = useState(false);
  const [modelKey, setModelKey] = useState('seedance25');
  const [prompt, setPrompt] = useState('');
  const [resolution, setResolution] = useState('720p');
  const [ratio, setRatio] = useState('16:9');
  const [duration, setDuration] = useState('auto');
  const [generateAudio, setGenerateAudio] = useState(true);
  const [seed, setSeed] = useState(null);

  const [library, setLibrary] = useState([]);
  const [libBusy, setLibBusy] = useState(false);
  const [picked, setPicked] = useState([]); // library entries, in attach order

  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  const available = useMemo(
    () => Object.keys(MODEL_LABELS).filter((k) => models[k]),
    [models],
  );

  useEffect(() => () => clearTimeout(pollRef.current), []);

  useEffect(() => {
    fetch('/api/film/config').then((r) => r.json()).then((j) => {
      setModels(j.models || {});
      setHasServerKey(!!j.hasServerKey);
      const first = Object.keys(MODEL_LABELS).find((k) => (j.models || {})[k]);
      if (first) setModelKey(first);
    }).catch(() => {});
  }, []);

  const loadLibrary = useCallback(async () => {
    setLibBusy(true);
    try {
      const r = await fetch('/api/film/library');
      const j = await r.json();
      setLibrary(Array.isArray(j.items) ? j.items : []);
    } catch { /* an empty library is a legitimate state */ }
    setLibBusy(false);
  }, []);
  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  // The resolution list is per-model — clamp when the model changes rather than
  // sending a value the endpoint will reject.
  useEffect(() => {
    const opts = RES_BY_MODEL[modelKey] || RES_BY_MODEL.seedance;
    if (!opts.includes(resolution)) setResolution(opts[opts.length - 2] || opts[0]);
  }, [modelKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const onUpload = async (file) => {
    try {
      const dataUrl = await readAsDataUrl(file);
      Message.info(`Uploading ${file.name}…`);
      const up = await fetch('/api/film/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, name: file.name }),
      }).then((r) => r.json());
      if (up.error) throw new Error(up.error);
      const kind = String(file.type || '').startsWith('video') ? 'video' : 'image';
      await fetch('/api/film/library?action=add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: up.url, assetId: up.assetId || null, name: file.name, kind }),
      });
      await loadLibrary();
      Message.success(`${file.name} added to the library`);
    } catch (e) { Message.error(e.message); }
    return false; // never let Upload do its own request
  };

  const removeAsset = async (item) => {
    // 'remove' drops it from the index only — 'delete' would also destroy the
    // registered asset and the TOS object, which is not what a strip ✕ should mean.
    await fetch('/api/film/library?action=remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, url: item.url }),
    });
    setPicked((p) => p.filter((x) => x.id !== item.id));
    loadLibrary();
  };

  const toggle = (item) => setPicked((p) => (p.some((x) => x.id === item.id)
    ? p.filter((x) => x.id !== item.id)
    : [...p, item]));

  const generate = async () => {
    if (!String(prompt).trim()) { Message.warning('Write a prompt first.'); return; }
    const modelId = models[modelKey];
    if (!modelId) { Message.error(`No model id configured for ${modelKey}.`); return; }
    setRunning(true); setError(''); setVideoUrl(''); setPhase('Submitting…');

    // The reference assets ride in PICK ORDER, so "Image 1 … Image N" in the prompt
    // means what the strip shows. A registered asset goes as image_asset_id (trusted);
    // anything else goes as its url.
    const content = [{ type: 'text', text: String(prompt).trim() }];
    picked.forEach((it) => {
      if (it.kind === 'video') content.push({ type: 'video_url', video_url: { url: it.url }, role: 'reference_video' });
      else if (it.assetId) content.push({ type: 'image_asset_id', asset_id: it.assetId, role: 'reference_image' });
      else content.push({ type: 'image_url', image_url: { url: it.url }, role: 'reference_image' });
    });

    const body = {
      model: modelId, content, resolution, generate_audio: !!generateAudio, watermark: false,
    };
    if (ratio && ratio !== 'adaptive') body.ratio = ratio;
    if (duration && duration !== 'auto') body.duration = Number(duration);
    if (seed != null && seed !== '') body.seed = Number(seed);

    try {
      const started = await fetch('/api/seedance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then((r) => r.json());
      const taskId = started.id || started.task_id;
      if (!taskId) throw new Error(started.error?.message || started.error || 'No task id came back');

      const poll = async () => {
        const st = await fetch(`/api/seedance-status?taskId=${encodeURIComponent(taskId)}`).then((r) => r.json());
        if (st.status === 'succeeded' && st.content?.video_url) {
          setVideoUrl(st.content.video_url); setPhase(''); setRunning(false); return;
        }
        if (st.status === 'failed' || st.error) {
          throw new Error(st.error?.message || st.error || 'The task failed');
        }
        setPhase(`${st.status || 'running'}…`);
        pollRef.current = setTimeout(poll, POLL_MS);
      };
      setPhase('queued…');
      pollRef.current = setTimeout(poll, POLL_MS);
    } catch (e) {
      setError(e.message); setPhase(''); setRunning(false);
    }
  };

  const maxSec = MAX_SECONDS[modelKey] || 15;
  const durOptions = ['auto', ...Array.from({ length: Math.floor(maxSec / 5) }, (_, i) => String((i + 1) * 5))];

  return (
    <>
      <Head><title>Seedance video playground</title></Head>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 24px 64px' }}>
        <Title heading={5} style={{ marginTop: 0 }}>Seedance video playground</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Pick reference assets from your library, write a prompt, generate.
          {hasServerKey ? ' Using the server-configured API key.' : ' Set MODELARK_API_KEY in .env.local.'}
        </Text>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 0 8px' }}>
          <Text style={{ fontSize: 12, fontWeight: 600 }}>
            ASSET LIBRARY {picked.length > 0 && <Tag size="small" color="orange">{picked.length} attached</Tag>}
          </Text>
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <Upload showUploadList={false} accept="image/*,video/*" beforeUpload={onUpload}>
              <Button size="small" icon={<IconPlus />}>Upload</Button>
            </Upload>
            <Button size="small" icon={<IconRefresh />} loading={libBusy} onClick={loadLibrary}>Refresh</Button>
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '4px 2px 10px', minHeight: 96 }}>
          {library.length === 0 && !libBusy && (
            <Text type="secondary" style={{ fontSize: 12, padding: '28px 4px' }}>
              Nothing in the library yet — upload an image or a video to start.
            </Text>
          )}
          {library.map((it) => {
            const at = picked.findIndex((x) => x.id === it.id);
            const on = at >= 0;
            return (
              <div
                key={it.id}
                onClick={() => toggle(it)}
                title={`${it.name || it.kind}${it.assetId ? ' · registered asset' : ''}`}
                style={{
                  position: 'relative', width: 96, height: 84, flexShrink: 0, cursor: 'pointer',
                  border: `2px solid ${on ? '#b06f10' : '#e5e6eb'}`, borderRadius: 8, overflow: 'hidden',
                  background: '#f7f8fa', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {it.kind === 'video'
                  ? <Text style={{ fontSize: 11, color: '#4e5969' }}>▶ video</Text>
                  : <img src={it.thumb || it.url} alt={it.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                {on && (
                  <span style={{ position: 'absolute', top: 3, left: 3, background: '#b06f10', color: '#fff', fontSize: 10, fontWeight: 700, padding: '0 5px', borderRadius: 4 }}>
                    {it.kind === 'video' ? 'Video' : 'Image'} {at + 1}
                  </span>
                )}
                <Button
                  size="mini" type="text" icon={<IconDelete />}
                  onClick={(e) => { e.stopPropagation(); removeAsset(it); }}
                  style={{ position: 'absolute', top: 0, right: 0, color: '#86909c' }}
                />
              </div>
            );
          })}
        </div>

        <Input.TextArea
          value={prompt}
          onChange={setPrompt}
          placeholder="Describe the shot. Cite attached assets as Image 1, Image 2, Video 1 — the numbers follow the order you picked them."
          autoSize={{ minRows: 5, maxRows: 14 }}
          style={{ fontSize: 13, marginBottom: 12 }}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <Select value={modelKey} onChange={setModelKey} style={{ width: 200 }} disabled={!available.length}>
            {available.map((k) => <Select.Option key={k} value={k}>{MODEL_LABELS[k]}</Select.Option>)}
          </Select>
          <Select value={resolution} onChange={setResolution} style={{ width: 110 }}>
            {(RES_BY_MODEL[modelKey] || []).map((r) => <Select.Option key={r} value={r}>{r}</Select.Option>)}
          </Select>
          <Select value={ratio} onChange={setRatio} style={{ width: 120 }}>
            {RATIOS.map((r) => <Select.Option key={r} value={r}>{r}</Select.Option>)}
          </Select>
          <Select value={duration} onChange={setDuration} style={{ width: 110 }}>
            {durOptions.map((d) => <Select.Option key={d} value={d}>{d === 'auto' ? 'Auto' : `${d}s`}</Select.Option>)}
          </Select>
          <InputNumber placeholder="seed" value={seed} onChange={setSeed} style={{ width: 100 }} />
          <Checkbox checked={generateAudio} onChange={setGenerateAudio}>audio</Checkbox>
          <span style={{ flex: 1 }} />
          <Button
            type="primary" loading={running} onClick={generate}
            style={{ background: '#b06f10', borderColor: '#b06f10' }}
          >
            Generate
          </Button>
        </div>

        {!available.length && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            No Seedance model ids are configured — set MODELARK_MODEL_SEEDANCE_25 (or the 2.0 variants) in .env.local.
          </Text>
        )}
        {phase && <div style={{ padding: '10px 0' }}><Spin size={14} /> <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>{phase}</Text></div>}
        {error && <Text style={{ fontSize: 12, color: '#f53f3f' }}>{error}</Text>}
        {videoUrl && (
          <div style={{ marginTop: 12 }}>
            <video src={videoUrl} controls style={{ width: '100%', borderRadius: 8, background: '#000' }} />
            <div style={{ marginTop: 6 }}>
              <a href={videoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Open the source file</a>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
