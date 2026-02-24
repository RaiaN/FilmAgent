import React from 'react';

const ResultViewer = ({ result, modelType }) => {
  if (!result) return null;

  if (result.error) {
      return <div className="result">{JSON.stringify(result, null, 2)}</div>;
  }

  // Handle Image Results (Seedream)
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

  // Handle Video Results (Seedance) - Assuming result contains a video_url or similar
  // Note: Seedance API returns a Task ID first, then we query for video_url. 
  // The current integration might just return the raw API response for now.
  if (result.video_url) {
      return (
        <div className="result-item" style={{ marginTop: '2rem' }}>
            <video src={result.video_url} controls className="media" />
            <div className="actions" style={{ marginTop: '0.5rem' }}>
                <a className="link-button secondary" href={result.video_url} download="video.mp4">
                    Download Video
                </a>
            </div>
        </div>
      );
  }
  
  if (result.id) {
      return (
          <div className="result" style={{ marginTop: '2rem' }}>
              <h3>Task Created</h3>
              <p>Task ID: {result.id}</p>
              <p className="helper">Video generation is asynchronous. Please check status (Not implemented in UI yet).</p>
          </div>
      );
  }

  return (
    <div className="result">{JSON.stringify(result, null, 2)}</div>
  );
};

export default ResultViewer;
