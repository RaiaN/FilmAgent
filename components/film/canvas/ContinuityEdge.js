import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useNodesData } from '@xyflow/react';

// The SEQUENCE bond between two SHOT cards. Continuity has exactly ONE mechanism —
// the target's START anchor (realized last-frame threading was PURGED 2026-08-07):
// DESIGNED (blue) — the target opens on its own START anchor; the chip is that
//   anchor; stale (AMBER) = the anchor was re-picked AFTER the target's take.
// ORDER (grey) — no anchor on the target: the bond is pure sequence order, a hard
//   cut. Want continuity? Set the target's START anchor (the picker offers the
//   source take's last frame first).
// Both modes draw dashed until the target has its take.
const ContinuityEdge = ({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) => {
  const pair = useNodesData([source, target]);
  const tgt = (pair && pair[1] && pair[1].data) || {};
  const designed = !!(tgt.startAnchor && tgt.startAnchor.url);
  const stale = designed && !!(tgt.shotAt && tgt.startAnchor.pickedAt && tgt.startAnchor.pickedAt > tgt.shotAt);
  const thumb = designed ? tgt.startAnchor.url : null;
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
