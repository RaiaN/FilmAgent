import React from 'react';

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
      </>
    );
  }

  // Fallback for raw JSON if format unknown but not an error
  return (
    <div className="result">{JSON.stringify(result, null, 2)}</div>
  );
};

export default ImageResultViewer;
