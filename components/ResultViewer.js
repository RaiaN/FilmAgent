import React from 'react';
import ImageResultViewer from './ImageResultViewer';
import VideoResultViewer from './VideoResultViewer';

const ResultViewer = ({ result, modelType }) => {
  if (!result) return null;

  // Render Image Viewer for Seedream
  if (modelType === 'seedream') {
      return <ImageResultViewer result={result} />;
  }

  // Render Video Viewer for Seedance
  if (modelType === 'seedance') {
      return <VideoResultViewer result={result} />;
  }

  // Default fallback if type is unknown or mismatched
  return <div className="result">{JSON.stringify(result, null, 2)}</div>;
};

export default ResultViewer;
