import { memo } from 'react';
import { Typography, Spin } from '@arco-design/web-react';
import { AGENT_COLORS } from '../../../utils/film/agents';

const { Text } = Typography;

// A titled frame that visually groups one agent run's outputs. React Flow renders
// child nodes (the results) on top; dragging the group moves them together, while
// each child stays individually selectable. `data.phase` (transient, never persisted)
// renders as an in-progress status line in the body — the panel can land on the board
// the instant its run starts, before any results exist.
const GroupNodeInner = ({ data }) => {
  const color = (data.layerId && AGENT_COLORS[data.layerId]) || '#86909c';
  if (data.visibility === 'hide') return null;
  const opacity = data.visibility === 'dim' ? 0.3 : 0.96;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        border: `1.5px solid ${color}`,
        borderRadius: 12,
        background: '#fafbfc',
        opacity,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          borderBottom: `1px solid ${color}`,
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          background: '#fff',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <Text style={{ fontSize: 11, fontWeight: 600, color }} ellipsis>{data.label}</Text>
      </div>
      {data.phase ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px 14px' }}>
          <Spin size={14} />
          <Text type="secondary" style={{ fontSize: 12 }}>{data.phase}</Text>
        </div>
      ) : null}
    </div>
  );
};

export default memo(GroupNodeInner);
