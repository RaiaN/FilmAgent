import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Message, Tag, Typography } from '@arco-design/web-react';
import { IconCopy, IconFile, IconLoading, IconUpload } from '@arco-design/web-react/icon';
import { VERIFY_LIMITS, verifyFamilyOfName } from '../utils/arkOfficialSpec';
import { ASSET_SPEC } from '../utils/film/assetSpec';
import styles from '../styles/Playground.module.css';

// Was this image or video made by a ModelArk model? Drop files or paste URLs; each one
// becomes a ModelArk official-artifact verification query (/api/ark-official), polled
// until it settles. Uploads are verified through their Assets-library copy, so they must
// also fit the Assets limits; anything else can be checked by a public URL.

const ACCEPT = '.png,.jpg,.jpeg,.heic,.webp,.mp4,.mov,.avi';
const TYPE_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', heic: 'image/heic', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo' };
const STORE_KEY = 'artifactVerify.v1'; // this viewer's checks, so a reload resumes polling
const POLL_MS = 4000;
const PARALLEL = 2; // the API rate-limits query creation
const MB = 1024 * 1024;

const load = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
};
const save = (items) => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(items.slice(0, 60))); } catch { /* per-viewer convenience only */ }
};

const copy = (text) => {
  navigator.clipboard.writeText(text).then(() => Message.success('Copied'), () => Message.error('Clipboard is blocked'));
};

const readMeta = (family, src) => new Promise((resolve) => {
  if (family === 'image') {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({}); // e.g. HEIC outside Safari: the server still checks bytes
    img.src = src;
    return;
  }
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.onloadedmetadata = () => resolve({ width: v.videoWidth, height: v.videoHeight, seconds: v.duration });
  v.onerror = () => resolve({});
  v.src = src;
});

// Why an upload cannot be verified, or ''. The verifier's limits, then the Assets
// library's (uploads reach the verifier through it).
const uploadProblem = (file, family, meta) => {
  const ext = file.name.split('.').pop().toLowerCase();
  const limit = VERIFY_LIMITS[family];
  if (file.size > limit.maxBytes) return `${family === 'image' ? 'Images' : 'Videos'} must be ${limit.maxBytes / MB} MB or smaller — this one is ${(file.size / MB).toFixed(1)} MB.`;
  const spec = ASSET_SPEC[family];
  const viaUrl = ' Paste a public URL to check it instead.';
  if (!spec.formats.includes(ext)) return `.${ext} can only be checked by URL — uploads take ${family === 'video' ? 'mp4 or mov' : 'png, jpg, heic or webp'}.${viaUrl}`;
  const { width: w, height: h, seconds } = meta;
  if (w && h) {
    const aspect = w / h;
    const [a0, a1] = spec.aspect;
    const [s0, s1] = spec.side;
    if (family === 'image' ? (aspect <= a0 || aspect >= a1) : (aspect < a0 || aspect > a1)) return `Uploads need an aspect ratio between ${a0} and ${a1} — this one is ${aspect.toFixed(2)}.${viaUrl}`;
    if (family === 'image' ? (Math.min(w, h) <= s0 || Math.max(w, h) >= s1) : (Math.min(w, h) < s0 || Math.max(w, h) > s1)) return `Uploads need each side between ${s0} and ${s1} px — this one is ${w}×${h}.${viaUrl}`;
    if (spec.pixels && (w * h < spec.pixels[0] || w * h > spec.pixels[1])) return `Uploaded videos must be about 640×640 to 1080p — this one is ${w}×${h}.${viaUrl}`;
  }
  if (spec.seconds && Number.isFinite(seconds) && seconds > 0 && (seconds < spec.seconds[0] || seconds > spec.seconds[1])) {
    return `Uploaded videos must run ${spec.seconds[0]}–${spec.seconds[1]} s — this one is ${seconds.toFixed(1)} s.${viaUrl}`;
  }
  return '';
};

const VERDICT = {
  true: { color: 'green', text: 'ModelArk detected' },
  false: { color: 'gray', text: 'Not detected' },
  null: { color: 'orange', text: 'Undetermined' },
};

const Preview = ({ item }) => {
  const [broken, setBroken] = useState(false);
  const box = { width: '100%', aspectRatio: '16 / 10', objectFit: 'contain', background: '#f2f3f5', borderRadius: 6, display: 'block' };
  if (broken || !item.preview) {
    return <div style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconFile style={{ fontSize: 28, color: '#86909c' }} /></div>;
  }
  if (item.family === 'video') return <video src={item.preview} muted controls preload="metadata" style={box} onError={() => setBroken(true)} />;
  return <img src={item.preview} alt={item.name} style={box} onError={() => setBroken(true)} />;
};

const Verdict = ({ item }) => {
  if (item.stage === 'error') return <Typography.Text type="error" style={{ fontSize: 12, wordBreak: 'break-word' }}>{item.error}</Typography.Text>;
  if (item.stage !== 'done') {
    const label = { uploading: 'Uploading…', registering: 'Preparing…', running: 'Checking…', queued: 'Waiting…' }[item.stage] || 'Checking…';
    return <Typography.Text type="secondary" style={{ fontSize: 12 }}><IconLoading /> {label}</Typography.Text>;
  }
  const r = item.result || {};
  if (r.status === 'failed') return <Tag color="red" size="small">Check failed</Tag>;
  const v = VERDICT[String(r.isOfficial)] || VERDICT.null;
  const facts = [r.modelName, r.resourceType, r.resolution].filter(Boolean).join(' · ');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Tag color={v.color} size="small">{v.text}</Tag>
        {facts && <Typography.Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{facts}</Typography.Text>}
      </div>
      {r.message && <Typography.Text type="secondary" style={{ fontSize: 11, lineHeight: 1.4 }}>{r.message}</Typography.Text>}
    </div>
  );
};

const ArtifactVerifyPlayground = () => {
  const [items, setItems] = useState([]);
  const [over, setOver] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const inputRef = useRef(null);
  const queue = useRef([]);
  const active = useRef(0);
  const hydrated = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    // Restored checks keep their store/public url as the preview; unfinished uploads are gone.
    setItems(load().filter((x) => x.queryId || x.stage === 'done' || x.stage === 'error'));
  }, []);
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; } // the first pass holds the empty initial state
    save(items.map(({ file, ...x }) => ({ ...x, preview: x.source || '' })));
  }, [items]);

  const patch = (key, p) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  // Upload (files only) → create the query. Polling picks the item up from there.
  const start = async (it) => {
    try {
      let source = it.source;
      if (it.file) {
        patch(it.key, { stage: 'uploading' });
        const ext = it.name.split('.').pop().toLowerCase();
        const r = await fetch('/api/mediakit/upload', { method: 'POST', headers: { 'Content-Type': it.file.type || TYPE_BY_EXT[ext] || 'application/octet-stream' }, body: it.file });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.url) throw new Error(d.error || `Upload failed (HTTP ${r.status})`);
        source = d.url;
        patch(it.key, { source, stage: 'registering' });
      }
      const r = await fetch('/api/ark-official', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: source, name: it.name }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.queryId) throw new Error(d.error || `Verification failed (HTTP ${r.status})`);
      patch(it.key, { queryId: d.queryId, stage: 'running', file: undefined });
    } catch (e) {
      patch(it.key, { stage: 'error', error: e.message, file: undefined });
    }
  };

  const pump = useCallback(() => {
    while (active.current < PARALLEL && queue.current.length) {
      const it = queue.current.shift();
      active.current += 1;
      start(it).finally(() => { active.current -= 1; pump(); });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const enqueue = (batch) => {
    setItems((xs) => [...batch, ...xs]);
    batch.filter((it) => it.stage === 'queued').forEach((it) => queue.current.push(it));
    pump();
  };

  const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    const ok = files.filter((f) => verifyFamilyOfName(f.name));
    if (ok.length < files.length) Message.warning(`${files.length - ok.length} file(s) skipped — only png, jpg, heic, webp, mp4, mov and avi can be verified.`);
    const batch = await Promise.all(ok.map(async (file) => {
      const family = verifyFamilyOfName(file.name);
      const preview = URL.createObjectURL(file);
      const problem = uploadProblem(file, family, await readMeta(family, preview));
      return { key: newKey(), name: file.name, family, preview, file: problem ? undefined : file, source: '', stage: problem ? 'error' : 'queued', error: problem, queryId: '', result: null };
    }));
    if (batch.length) enqueue(batch);
  };

  const addUrl = () => {
    const url = urlDraft.trim();
    if (!/^https?:\/\//i.test(url)) { Message.warning('Paste a public http(s) image or video URL.'); return; }
    const name = decodeURIComponent(url.split('?')[0].split('/').pop() || 'link');
    enqueue([{ key: newKey(), name, family: verifyFamilyOfName(name) === 'video' ? 'video' : 'image', preview: url, source: url, stage: 'queued', error: '', queryId: '', result: null }]);
    setUrlDraft('');
  };

  // Every POLL_MS, one pass over the running checks, in turn (GetArkOfficialResult is
  // rate-limited too). Reads the latest items through a ref, so an update mid-pass
  // never cancels the rest of it.
  useEffect(() => {
    let stop = false;
    let timer;
    const pass = async () => {
      const running = itemsRef.current.filter((x) => x.stage === 'running' && x.queryId);
      for (const x of running) {
        if (stop) return;
        try {
          const r = await fetch(`/api/ark-official?queryId=${encodeURIComponent(x.queryId)}`); // eslint-disable-line no-await-in-loop
          const d = await r.json().catch(() => ({})); // eslint-disable-line no-await-in-loop
          if (!r.ok) throw new Error(d.error || `Status check failed (HTTP ${r.status})`);
          if (!stop) patch(x.key, d.status === 'running' ? { pollError: '' } : { stage: 'done', result: d, pollError: '' });
        } catch (e) {
          if (!stop) patch(x.key, { pollError: e.message });
        }
      }
      if (!stop) timer = setTimeout(pass, POLL_MS);
    };
    timer = setTimeout(pass, POLL_MS);
    return () => { stop = true; clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = items.filter((x) => !['done', 'error'].includes(x.stage)).length;
  const clear = () => {
    items.forEach((x) => { if (x.preview?.startsWith('blob:') && ['done', 'error'].includes(x.stage)) URL.revokeObjectURL(x.preview); });
    setItems((xs) => xs.filter((x) => !['done', 'error'].includes(x.stage)));
  };

  return (
    <div className={styles.playgroundContainer}>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
        style={{
          border: `2px dashed ${over ? '#165dff' : '#c9cdd4'}`,
          background: over ? '#e8f3ff' : '#fafafa',
          borderRadius: 10,
          padding: '32px 16px',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'background .15s, border-color .15s',
        }}
      >
        <IconUpload style={{ fontSize: 28, color: over ? '#165dff' : '#86909c' }} />
        <div style={{ marginTop: 8, fontSize: 14 }}>Drop images or videos to check whether a ModelArk model made them</div>
        <div style={{ marginTop: 4, fontSize: 12, color: '#86909c' }}>
          Uploads: images ≤ 20 MB, 300–6000 px · videos mp4/mov, 2–30 s, up to 1080p, ≤ 100 MB. Anything else: paste a public URL.
        </div>
        <input ref={inputRef} type="file" multiple accept={ACCEPT} style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <Input size="small" placeholder="…or paste a public image or video URL (≤ 20 MB image, ≤ 100 MB video)" value={urlDraft} onChange={setUrlDraft} onPressEnter={addUrl} allowClear />
        <Button size="small" onClick={addUrl}>Check</Button>
      </div>

      {items.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 10px' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {items.length - busy} of {items.length} checked{busy ? ` · ${busy} in progress` : ''} · automated analysis, for reference only
            </Typography.Text>
            <span style={{ flex: 1 }} />
            <Button size="mini" onClick={clear} disabled={items.length === busy}>Clear</Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {items.map((it) => (
              <div key={it.key} style={{ border: '1px solid #e5e6eb', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <Preview item={it} />
                <Typography.Text style={{ fontSize: 12 }} ellipsis={{ showTooltip: true }}>{it.name}</Typography.Text>
                <Verdict item={it} />
                {it.pollError && it.stage === 'running' && <Typography.Text type="error" style={{ fontSize: 11 }}>Status check failed — {it.pollError}. Retrying.</Typography.Text>}
                {it.queryId && (
                  <button
                    type="button"
                    onClick={() => copy(it.queryId)}
                    title="Copy query id"
                    style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 10, color: '#86909c' }}
                  >
                    <IconCopy /> {it.queryId}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ArtifactVerifyPlayground;
