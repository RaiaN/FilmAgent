import React, { useEffect, useState } from 'react';
import { Tag, Typography, Button, Space, Spin } from '@arco-design/web-react';
import { IconCheckCircleFill, IconCloseCircleFill, IconClockCircle, IconSync } from '@arco-design/web-react/icon';
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

  const getStatusIcon = (status) => {
      switch (status) {
          case 'succeeded': return <IconCheckCircleFill style={{ color: '#00b42a' }} />;
          case 'failed': return <IconCloseCircleFill style={{ color: '#f53f3f' }} />;
          case 'running': return <IconSync spin style={{ color: '#165dff' }} />;
          default: return <IconClockCircle style={{ color: '#ff7d00' }} />;
      }
  };

  const getStatusColor = (status) => {
      switch (status) {
          case 'succeeded': return 'green';
          case 'failed': return 'red';
          case 'running': return 'arcoblue';
          default: return 'orange';
      }
  };

  // Handle Video Results (Seedance)
  if (result.id) {
      return (
          <div className="result-container" style={{ marginTop: '2rem' }}>
              <div className="status-panel" style={{ background: '#fff', padding: '1rem', borderRadius: '12px', marginBottom: '1rem', border: '1px solid #e5e7eb', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#111827', marginBottom: 12 }}>
                      <Typography.Text bold>Task ID: {result.id}</Typography.Text>
                      <CopyButton text={result.id} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Typography.Text type="secondary">Status:</Typography.Text>
                      <Tag icon={getStatusIcon(videoStatus)} color={getStatusColor(videoStatus)}>
                          {(videoStatus || 'INITIALIZING').toUpperCase()}
                      </Tag>
                  </div>
              </div>

              {videoResult?.video_url && (
                  <div className="video-result">
                      <video 
                        src={videoResult.video_url} 
                        controls 
                        className="media" 
                        style={{ width: '100%', maxHeight: '500px', background: '#000', borderRadius: 8 }} 
                      />
                      <div className="actions" style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                          <Button type="secondary" href={videoResult.video_url} download={`video-${result.id}.mp4`} as="a">
                              Download Video
                          </Button>
                      </div>
                  </div>
              )}
              
              {videoResult?.error && (
                   <div className="error-panel" style={{ color: '#f53f3f', marginTop: '1rem', padding: '1rem', background: '#fff0f0', borderRadius: 8 }}>
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
