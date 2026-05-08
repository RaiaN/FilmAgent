import CopyButton from './CopyButton';

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

const ImageResultViewer = ({ result }) => {
  if (!result) return null;

  if (result.error) {
    return <div className="result">{JSON.stringify(result, null, 2)}</div>;
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
