import { useEffect, useRef, useState } from 'react';
import { IconSync } from '@arco-design/web-react/icon';
import CopyButton from './CopyButton';
import { getApiKey } from '../utils/apiKeyStore';

const isRemoteUrl = (value) => typeof value === 'string' && /^https?:\/\//.test(value);

const UriPanel = ({ uri }) => {
  if (!uri) return null;

  return (
    <div
      style={{
        marginTop: '0.75rem',
        padding: '0.75rem',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: '#f8fafc',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
        <strong style={{ fontSize: 13 }}>Image URI</strong>
        <CopyButton text={uri} />
      </div>
      <div
        style={{
          marginTop: '0.5rem',
          fontSize: 12,
          lineHeight: 1.5,
          wordBreak: 'break-all',
          color: '#4b5563',
        }}
      >
        {uri}
      </div>
    </div>
  );
};

const SingleImageResult = ({ result }) => {
  if (result.error) {
    return (
      <div className="result" style={{ color: '#f53f3f', padding: '0.75rem', border: '1px solid #fde2e2', borderRadius: 8 }}>
        {typeof result.error === 'string' ? result.error : JSON.stringify(result.error)}
        {result.details && <pre style={{ fontSize: 11, marginTop: 4, whiteSpace: 'pre-wrap', color: '#86909c' }}>{typeof result.details === 'string' ? result.details : JSON.stringify(result.details, null, 2)}</pre>}
      </div>
    );
  }
  if (result.images) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
        {result.images.map((img, idx) => {
          const src = img.url || `data:image/png;base64,${img.b64_json}`;
          return (
            <div key={idx}>
              <img src={src} alt={`Result ${idx + 1}`} className="media" style={{ width: '100%', borderRadius: 6 }} />
              <a className="link-button secondary small" href={src} download={`result-${idx + 1}.png`} style={{ display: 'block', marginTop: 4 }}>Download</a>
              {isRemoteUrl(src) && <UriPanel uri={src} />}
            </div>
          );
        })}
      </div>
    );
  }
  if (result.imageUrl) {
    return (
      <>
        <img src={result.imageUrl} alt="Result" className="media" style={{ width: '100%', borderRadius: 6 }} />
        <a className="link-button secondary" href={result.imageUrl} download="result.png" style={{ display: 'block', marginTop: 4 }}>Download</a>
        <UriPanel uri={result.imageUrl} />
      </>
    );
  }
  return <div className="result">{JSON.stringify(result, null, 2)}</div>;
};

// One image "plate": fetches its own /api/seedream request and streams in independently,
// mirroring how each Seedance VideoTaskResultCard polls its own task. The OUTCOME is written
// back into the parent-owned result slot (`initial` + onStarted/onSettled): the viewer sits
// under a per-tab conditional render, so anything held only in card state dies on a tab
// switch — worse, a remounted card would re-fetch and PAY for the image again. With the
// slot as the source of truth: settled slots render instantly on remount (no refetch), and
// a slot marked `started` just waits — the orphaned first fetch still lands via onSettled
// (the parent survives the switch).
const ImageTaskResultCard = ({ request, title, initial, onStarted, onSettled }) => {
  const settled = initial && (initial.settled || initial.error || initial.data?.length || initial.imageUrl);
  const [, force] = useState(0); // slot updates arrive via props; local state only drives re-render on late settle
  const requestRef = useRef(null);

  // Fetch once per request — and only when this slot has neither settled nor started.
  // Keying on the request object's identity (not a boolean) means a new Generate (fresh
  // request object) re-generates, unrelated re-renders are skipped, and the ref guard
  // survives React StrictMode's double effect invoke (no double-billing in dev).
  useEffect(() => {
    if (settled || initial?.started) return;
    if (requestRef.current === request) return;
    requestRef.current = request;
    if (onStarted) onStarted();
    (async () => {
      try {
        const response = await fetch('/api/seedream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...request, apiKey: getApiKey() }),
        });
        const json = await response.json();
        if (onSettled) onSettled(response.ok ? { ...json, settled: true } : { error: json?.error || 'Request failed', details: json?.details, settled: true });
        force((x) => x + 1);
      } catch (error) {
        if (onSettled) onSettled({ error: 'Request failed', details: error.message, settled: true });
        force((x) => x + 1);
      }
    })();
  }, [request, settled, initial?.started, onStarted, onSettled]);

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem', background: '#fafafa' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#165dff', marginBottom: 8 }}>{title}</div>
      {!settled ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 160, color: '#86909c', gap: 8 }}>
          <IconSync spin style={{ fontSize: 24 }} />
          <span style={{ fontSize: 12 }}>Generating…</span>
        </div>
      ) : (
        <SingleImageResult result={initial} />
      )}
    </div>
  );
};

const ImageResultViewer = ({ result, onItemPatch }) => {
  if (!result) return null;

  if (result.error) {
    return <div className="result">{typeof result.error === 'string' ? result.error : JSON.stringify(result.error)}</div>;
  }

  // Streaming plates: each card fetches its own image (mirrors Seedance's per-card polling)
  // and settles its outcome INTO the parent-owned slot via onItemPatch, so finished images
  // survive tab switches and a remount never re-fetches (= never re-bills).
  if (result.batch && result.request && Array.isArray(result.items)) {
    return (
      <div style={{ marginTop: '1.5rem' }}>
        <div style={{ fontSize: 13, color: '#86909c', marginBottom: 12 }}>
          {result.items.length} {result.items.length === 1 ? 'image' : 'images'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
          {result.items.map((item, idx) => (
            <ImageTaskResultCard
              key={item.requestIndex || idx}
              request={result.request}
              title={`#${item.requestIndex || idx + 1}`}
              initial={item}
              onStarted={onItemPatch ? () => onItemPatch(item.requestIndex || idx + 1, { started: true }) : null}
              onSettled={onItemPatch ? (payload) => onItemPatch(item.requestIndex || idx + 1, payload) : null}
            />
          ))}
        </div>
      </div>
    );
  }

  // Handle batch (parallel) results
  if (result.batch && Array.isArray(result.items)) {
    return (
      <div style={{ marginTop: '1.5rem' }}>
        <div style={{ fontSize: 13, color: '#86909c', marginBottom: 12 }}>
          {result.items.length} generations
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
          {result.items.map((item, idx) => (
            <div key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem', background: '#fafafa' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#165dff', marginBottom: 6 }}>#{idx + 1}</div>
              <SingleImageResult result={item} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Handle Multi-Image Results (e.g. Sequential or Batch)
  if (result.images) {
    return (
      <div className="result-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginTop: '2rem' }}>
        {result.images.map((img, idx) => {
          const src = img.url || `data:image/png;base64,${img.b64_json}`;
          return (
            <div key={idx} className="result-item">
              <img src={src} alt={`Result ${idx + 1}`} className="media" />
              <div className="actions" style={{ marginTop: '0.5rem' }}>
                <a className="link-button secondary small" href={src} download={`result-${idx + 1}.png`}>
                  Download
                </a>
              </div>
              {isRemoteUrl(src) && <UriPanel uri={src} />}
            </div>
          );
        })}
      </div>
    );
  }

  // Handle Single Image Result
  if (result.imageUrl) {
    return (
      <>
        <img src={result.imageUrl} alt="Result" className="media" style={{ marginTop: '2rem' }} />
        <div className="actions" style={{ marginTop: '0.5rem' }}>
          <a
            className="link-button secondary"
            href={result.imageUrl}
            download="result.png"
          >
            Download
          </a>
        </div>
        <UriPanel uri={result.imageUrl} />
      </>
    );
  }

  // Fallback for raw JSON if format unknown but not an error
  return (
    <div className="result">{JSON.stringify(result, null, 2)}</div>
  );
};

export default ImageResultViewer;
