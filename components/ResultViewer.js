import ImageResultViewer from './ImageResultViewer';
import VideoResultViewer from './VideoResultViewer';
import ProductionDesignResultViewer from './ProductionDesignResultViewer';
import AssetUploadResultViewer from './AssetUploadResultViewer';

const ResultViewer = ({ result, modelType, ...rest }) => {
  if (!result) return null;

  // Render Image Viewer for Seedream
  if (modelType === 'seedream') {
      return <ImageResultViewer result={result} {...rest} />;
  }

  // Render Video Viewer for Seedance
  if (modelType === 'seedance') {
      return <VideoResultViewer result={result} />;
  }

  if (modelType === 'production-design') {
      return <ProductionDesignResultViewer result={result} {...rest} />;
  }

  if (modelType === 'asset-upload') {
      return <AssetUploadResultViewer result={result} />;
  }

  // Default fallback if type is unknown or mismatched
  return <div className="result">{JSON.stringify(result, null, 2)}</div>;
};

export default ResultViewer;
