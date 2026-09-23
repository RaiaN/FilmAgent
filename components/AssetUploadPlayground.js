import { useRef, useState } from 'react';
import { Button, Message, Typography } from '@arco-design/web-react';
import { IconCopy, IconLoading, IconSound, IconUpload, IconVideoCamera } from '@arco-design/web-react/icon';
import styles from '../styles/Playground.module.css';

// Drop (or pick) any number of images, videos and audio files. Every file uploads at
// once through /api/film/upload — TOS + Assets-API registration — and lands in the
// shared library, the same path the Video tab and the board use.

const ACCEPT = 'image/*,video/*,audio/*';
const kindOf = (type) => (type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : 'image');
const isMedia = (file) => /^(image|video|audio)\//.test(file.type || '');

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
  reader.readAsDataURL(file);
});

const copy = (text) => {
  navigator.clipboard.writeText(text).then(
    () => Message.success('Copied'),
    () => Message.error('Clipboard is blocked'),
  );
};

const Preview = ({ item }) => {
  const box = { width: '100%', aspectRatio: '16 / 10', objectFit: 'contain', background: '#f2f3f5', borderRadius: 6, display: 'block' };
  if (item.kind === 'image') return <img src={item.preview} alt={item.name} style={box} />;
  if (item.kind === 'video') return <video src={item.preview} muted controls preload="metadata" style={box} />;
  return (
    <div style={{ ...box, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      <IconSound style={{ fontSize: 28, color: '#86909c' }} />
      <audio src={item.preview} controls preload="metadata" style={{ width: '92%', height: 28 }} />
    </div>
  );
};

const Status = ({ item }) => {
  if (item.status === 'uploading') {
    return <Typography.Text type="secondary" style={{ fontSize: 12 }}><IconLoading /> Uploading…</Typography.Text>;
  }
  if (item.assetId) {
    return (
      <button
        type="button"
        onClick={() => copy(item.assetId)}
        title="Copy asset id"
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 11, color: '#1d2129', wordBreak: 'break-all' }}
      >
        <IconCopy style={{ flexShrink: 0, color: '#86909c' }} />{item.assetId}
      </button>
    );
  }
  return <Typography.Text type="error" style={{ fontSize: 12, wordBreak: 'break-word' }}>{item.error}</Typography.Text>;
};

const AssetUploadPlayground = ({ onUseInVideo }) => {
  const [items, setItems] = useState([]);
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);
  const seqRef = useRef(0); // drop order across batches — the order references go out in

  const patch = (key, p) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const uploadOne = async (file, key, kind) => {
    try {
      const dataUrl = await readAsDataUrl(file);
      const r = await fetch('/api/film/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, name: file.name }),
      });
      const up = await r.json().catch(() => ({ error: `Upload failed (HTTP ${r.status})` }));
      if (!r.ok || up.error) throw new Error(up.details || up.error || `Upload failed (HTTP ${r.status})`);
      await fetch('/api/film/library?action=add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: up.url, assetId: up.assetId || null, name: file.name, kind }),
      });
      patch(key, up.assetId
        ? { status: 'done', assetId: up.assetId }
        : { status: 'error', error: `Stored in the library, but not registered as an asset: ${up.assetError || 'no asset id returned'}` });
    } catch (e) {
      patch(key, { status: 'error', error: e.message });
    }
  };

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []);
    const media = files.filter(isMedia);
    if (media.length < files.length) Message.warning(`${files.length - media.length} file(s) skipped — only images, videos and audio upload.`);
    if (!media.length) return;
    const batch = media.map((file) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      name: file.name,
      kind: kindOf(file.type),
      seq: seqRef.current++,
      preview: URL.createObjectURL(file),
      status: 'uploading',
      assetId: null,
      error: '',
    }));
    setItems((xs) => [...batch, ...xs]);
    batch.forEach((it) => uploadOne(it.file, it.key, it.kind));
  };

  const clear = () => {
    items.forEach((it) => { if (it.status !== 'uploading') URL.revokeObjectURL(it.preview); });
    setItems((xs) => xs.filter((x) => x.status === 'uploading'));
  };

  const ids = items.filter((x) => x.assetId).map((x) => x.assetId);
  const pending = items.filter((x) => x.status === 'uploading').length;

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
          padding: '36px 16px',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'background .15s, border-color .15s',
        }}
      >
        <IconUpload style={{ fontSize: 28, color: over ? '#165dff' : '#86909c' }} />
        <div style={{ marginTop: 8, fontSize: 14 }}>Drop images, videos or audio — or click to choose</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {items.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 10px' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {ids.length} of {items.length} registered{pending ? ` · ${pending} uploading` : ''}
            </Typography.Text>
            <span style={{ flex: 1 }} />
            {ids.length > 1 && <Button size="mini" icon={<IconCopy />} onClick={() => copy(ids.join('\n'))}>Copy all ids</Button>}
            {ids.length > 0 && onUseInVideo && (
              <Button
                size="mini"
                type="primary"
                icon={<IconVideoCamera />}
                // References go in drop order, so [Image 1] is the first image dropped.
                onClick={() => onUseInVideo(items.filter((x) => x.assetId).sort((a, b) => a.seq - b.seq).map(({ kind, assetId }) => ({ kind, assetId })))}
              >
                Use in Video
              </Button>
            )}
            <Button size="mini" onClick={clear} disabled={items.length === pending}>Clear</Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {items.map((it) => (
              <div key={it.key} style={{ border: '1px solid #e5e6eb', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <Preview item={it} />
                <Typography.Text style={{ fontSize: 12 }} ellipsis={{ showTooltip: true }}>{it.name}</Typography.Text>
                <Status item={it} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default AssetUploadPlayground;
