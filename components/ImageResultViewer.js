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
// mirroring how each Seedance VideoTaskResultCard polls its own task. The card attaches the
// API key itself (like the video cards) so it never lives in shared result state.
const ImageTaskResultCard = ({ request, title }) => {
  const [status, setStatus] = useState('generating');
  const [data, setData] = useState(null);
  const requestRef = useRef(null);

  // Fetch once per request. Keying on the request object's identity (not a boolean) means we
  // re-generate when a new Generate hands us a fresh request, skip unrelated re-renders, and —
  // because the ref persists across React StrictMode's double effect invoke — never double-fire,
  // which for image generation would otherwise mean paying for two images per plate in dev.
  useEffect(() => {
    if (requestRef.current === request) return;
    requestRef.current = request;
    setStatus('generating');
    setData(null);
    (async () => {
      try {
        const response = await fetch('/api/seedream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...request, apiKey: getApiKey() }),
        });
        const json = await response.json();
        if (requestRef.current !== request) return; // superseded by a newer generation
        if (response.ok) {
          setData(json);
          setStatus('succeeded');
        } else {
          setData({ error: json?.error || 'Request failed', details: json?.details });
          setStatus('failed');
        }
      } catch (error) {
        if (requestRef.current !== request) return;
        setData({ error: 'Request failed', details: error.message });
        setStatus('failed');
      }
    })();
  }, [request]);

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem', background: '#fafafa' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#165dff', marginBottom: 8 }}>{title}</div>
      {status === 'generating' ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 160, color: '#86909c', gap: 8 }}>
          <IconSync spin style={{ fontSize: 24 }} />
          <span style={{ fontSize: 12 }}>Generating…</span>
        </div>
      ) : (
        <SingleImageResult result={data} />
      )}
    </div>
  );
};

const ImageResultViewer = ({ result }) => {
  if (!result) return null;

  if (result.error) {
    return <div className="result">{typeof result.error === 'string' ? result.error : JSON.stringify(result.error)}</div>;
  }

  // Streaming plates: each card fetches its own image (mirrors Seedance's per-card polling).
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
