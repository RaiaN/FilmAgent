import React, { useEffect, useState } from 'react';
import CopyButton from './CopyButton';
import { apiKeyStorageKey } from '../utils/schemas';

const VideoResultViewer = ({ result }) => {
  const [videoStatus, setVideoStatus] = useState(null);
  const [videoResult, setVideoResult] = useState(null);
  const [pollInterval, setPollInterval] = useState(null);

  // Poll for video status if we have a task ID and no final result yet
  useEffect(() => {
    if (result?.id && !videoResult) {
      const taskId = result.id;
      
      const poll = async () => {
        try {
          const storedKey = window.localStorage.getItem(apiKeyStorageKey);
          const headers = {};
          if (storedKey) {
              headers['Authorization'] = `Bearer ${storedKey}`;
          }

          const response = await fetch(`/api/seedance-status?taskId=${taskId}`, {
              headers: headers
          });
          const data = await response.json();
          
          if (data.status === 'succeeded') {
            setVideoResult(data);
            setVideoStatus('succeeded');
            if (pollInterval) clearInterval(pollInterval);
          } else if (data.status === 'failed' || data.status === 'expired') {
            setVideoStatus(data.status);
            setVideoResult(data); // might contain error details
            if (pollInterval) clearInterval(pollInterval);
          } else {
            setVideoStatus(data.status); // queued, running
          }
        } catch (error) {
          console.error('Polling error:', error);
        }
      };

      // Initial poll
      poll();
      
      // Set up interval (every 3 seconds)
      const intervalId = setInterval(poll, 3000);
      setPollInterval(intervalId);

      return () => clearInterval(intervalId);
    }
  }, [result, videoResult]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [pollInterval]);

  if (!result) return null;

  if (result.error) {
      return <div className="result">{JSON.stringify(result, null, 2)}</div>;
  }

  // Handle Video Results (Seedance)
  if (result.id) {
      return (
          <div className="result-container" style={{ marginTop: '2rem' }}>
              <div className="status-panel" style={{ background: '#262626', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>Task ID: {result.id}</strong>
                      <CopyButton text={result.id} />
                  </div>
                  <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>Status: </span>
                      <span className={`status-badge ${videoStatus || 'pending'}`} style={{ 
                          padding: '0.2rem 0.5rem', 
                          borderRadius: '4px', 
                          background: videoStatus === 'succeeded' ? '#059669' : 
                                      videoStatus === 'failed' ? '#dc2626' : 
                                      '#d97706',
                          color: 'white',
                          fontWeight: 'bold',
                          fontSize: '0.9rem'
                      }}>
                          {videoStatus ? videoStatus.toUpperCase() : 'INITIALIZING...'}
                      </span>
                  </div>
              </div>

              {videoResult?.video_url && (
                  <div className="video-result">
                      <video 
                        src={videoResult.video_url} 
                        controls 
                        className="media" 
                        style={{ width: '100%', maxHeight: '500px', background: '#000' }} 
                      />
                      <div className="actions" style={{ marginTop: '1rem' }}>
                          <a className="link-button secondary" href={videoResult.video_url} download={`video-${result.id}.mp4`}>
                              Download Video
                          </a>
                      </div>
                  </div>
              )}
              
              {videoResult?.error && (
                   <div className="error-panel" style={{ color: '#ef4444', marginTop: '1rem' }}>
                       Error: {JSON.stringify(videoResult.error)}
                   </div>
              )}
          </div>
      );
  }

  return (
    <div className="result">{JSON.stringify(result, null, 2)}</div>
  );
};

export default VideoResultViewer;
