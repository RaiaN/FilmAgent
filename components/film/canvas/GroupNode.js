import { memo } from 'react';
import { Typography } from '@arco-design/web-react';
import { AGENT_COLORS } from '../../../utils/film/agents';

const { Text } = Typography;

// A titled frame that visually groups one agent run's outputs. React Flow renders
// child nodes (the results) on top; dragging the group moves them together, while
// each child stays individually selectable.
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
    </div>
  );
};

export default memo(GroupNodeInner);
