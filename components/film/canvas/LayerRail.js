import { useState } from 'react';
import { Typography, Tooltip, Button } from '@arco-design/web-react';
import {
  IconEye,
  IconEyeInvisible,
  IconStorage,
  IconMenuFold,
  IconMenuUnfold,
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

const LayerRail = ({ activeLayerId, onActivate, visibility, onCycleVisibility }) => {
  const [collapsed, setCollapsed] = useState(false);

  // Collapsed: a slim icon-only strip — agents stay armable (tooltips show names).
  if (collapsed) {
    return (
      <div style={{ width: 52, borderRight: '1px solid #e5e6eb', background: '#fff', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
          <Tooltip content="Expand agents" position="right">
            <Button size="mini" type="text" icon={<IconMenuUnfold />} onClick={() => setCollapsed(false)} />
          </Tooltip>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {AGENTS.map((layer) => {
            const Icon = agentIcon(layer.icon);
            const isActive = layer.id === activeLayerId;
            return (
              <Tooltip key={layer.id} content={layer.label} position="right">
                <div
                  onClick={() => onActivate(layer.id)}
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: '11px 0',
                    cursor: 'pointer',
                    background: isActive ? '#f2f7ff' : 'transparent',
                    borderLeft: `3px solid ${isActive ? layer.color : 'transparent'}`,
                  }}
                >
                  <Icon style={{ fontSize: 18, color: isActive ? layer.color : '#4e5969' }} />
                </div>
              </Tooltip>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: 200, borderRight: '1px solid #e5e6eb', background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 6px 6px 12px' }}>
        <Text type="secondary" style={{ fontSize: 11, letterSpacing: 0.5 }}>AGENTS</Text>
        <Tooltip content="Collapse">
          <Button size="mini" type="text" icon={<IconMenuFold />} onClick={() => setCollapsed(true)} />
        </Tooltip>
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
};

export default LayerRail;
