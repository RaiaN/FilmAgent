import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useNodesData } from '@xyflow/react';

const ContinuityEdge = ({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) => {
  const pair = useNodesData([source, target]);
  const tgt = (pair && pair[1] && pair[1].data) || {};
  const k0 = (Array.isArray(tgt.keyframes) && tgt.keyframes[0]) || tgt.startAnchor || null;
  const designed = !!(k0 && k0.url);
  const stale = designed && !!(tgt.shotAt && k0.pickedAt && k0.pickedAt > tgt.shotAt);
  const thumb = designed ? k0.url : null;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const color = stale ? '#ff7d00' : (designed ? '#3491fa' : '#7a8699');
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: color, strokeWidth: 1.8, strokeDasharray: tgt.shotUrl ? undefined : '6 4' }} />
      <EdgeLabelRenderer>
        <div style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          {thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" style={{ width: 36, height: 21, objectFit: 'cover', borderRadius: 3, border: `1.5px solid ${color}`, background: '#101418' }} /> : null}
          {stale ? <span style={{ fontSize: 9, fontWeight: 700, background: '#fff3e6', color: '#b25c00', borderRadius: 3, padding: '0 4px' }}>stale</span> : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

export default memo(ContinuityEdge);
