import { Typography, Tooltip } from '@arco-design/web-react';
import {
  IconEye,
  IconEyeInvisible,
  IconStorage,
} from '@arco-design/web-react/icon';
import { AGENTS } from '../../../utils/film/agents';
import { agentIcon } from './agentIcons';

const { Text } = Typography;

// visibility cycle: show -> dim -> hide -> show
const VIS_ICON = {
  show: <IconEye style={{ fontSize: 14, color: '#165dff' }} />,
  dim: <IconStorage style={{ fontSize: 14, color: '#d4a017' }} />,
  hide: <IconEyeInvisible style={{ fontSize: 14, color: '#86909c' }} />,
};

const VIS_TITLE = { show: 'Visible', dim: 'Dimmed', hide: 'Hidden' };

const LayerRail = ({ activeLayerId, onActivate, visibility, onCycleVisibility }) => (
  <div style={{ width: 200, borderRight: '1px solid #e5e6eb', background: '#fff', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: '12px 12px 6px' }}>
      <Text type="secondary" style={{ fontSize: 11, letterSpacing: 0.5 }}>AGENTS</Text>
    </div>
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {AGENTS.map((layer) => {
        const Icon = agentIcon(layer.icon);
        const isActive = layer.id === activeLayerId;
        const vis = visibility[layer.id] || 'show';
        return (
          <div
            key={layer.id}
            onClick={() => onActivate(layer.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              cursor: 'pointer',
              background: isActive ? '#f2f7ff' : 'transparent',
              borderLeft: `3px solid ${isActive ? layer.color : 'transparent'}`,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: layer.color, flexShrink: 0 }} />
            <Icon style={{ fontSize: 16, color: isActive ? layer.color : '#4e5969' }} />
            <Text style={{ fontSize: 12, flex: 1 }} bold={isActive} ellipsis>{layer.label}</Text>
            <Tooltip content={`${VIS_TITLE[vis]} — click to cycle`}>
              <span
                onClick={(e) => { e.stopPropagation(); onCycleVisibility(layer.id); }}
                style={{ display: 'inline-flex', padding: 2 }}
              >
                {VIS_ICON[vis]}
              </span>
            </Tooltip>
          </div>
        );
      })}
    </div>
    <div style={{ padding: 10, borderTop: '1px solid #f2f3f5' }}>
      <Text type="secondary" style={{ fontSize: 10 }}>
        Click an agent to arm it, then Run on your selection. The eye toggles that agent's assets on the board.
      </Text>
    </div>
  </div>
);

export default LayerRail;
