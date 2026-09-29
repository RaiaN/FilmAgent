import { useEffect, useState } from 'react';
import { Typography, Tooltip, Button } from '@arco-design/web-react';
import {
  IconEye,
  IconEyeInvisible,
  IconStorage,
  IconMenuFold,
  IconMenuUnfold,
  IconDown,
  IconRight,
} from '@arco-design/web-react/icon';
import { AGENTS, AGENT_PHASES } from '../../../utils/film/agents';
import { agentIcon } from './agentIcons';

const { Text } = Typography;

// visibility cycle: show -> dim -> hide -> show
const VIS_ICON = {
  show: <IconEye style={{ fontSize: 14, color: '#165dff' }} />,
  dim: <IconStorage style={{ fontSize: 14, color: '#d4a017' }} />,
  hide: <IconEyeInvisible style={{ fontSize: 14, color: '#86909c' }} />,
};

const VIS_TITLE = { show: 'Visible', dim: 'Dimmed', hide: 'Hidden' };

// Rail agents grouped by production phase (AGENT_PHASES order; the agents' own order
// within a phase). An agent without a known phase is a declaration bug — fail loudly.
const RAIL_GROUPS = (() => {
  const shown = AGENTS.filter((l) => !l.railHidden);
  const stray = shown.filter((l) => !AGENT_PHASES.some((p) => p.id === l.phase));
  if (stray.length) throw new Error(`Agents with no production phase: ${stray.map((l) => l.id).join(', ')}`);
  return AGENT_PHASES
    .map((p) => ({ ...p, agents: shown.filter((l) => l.phase === p.id) }))
    .filter((g) => g.agents.length);
})();

// Folded phase groups — a per-viewer convenience, remembered in this browser only.
const FOLD_KEY = 'filmRail.foldedPhases';
const loadFolded = () => {
  try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch { return new Set(); }
};

const LayerRail = ({ activeLayerId, onActivate, visibility, onCycleVisibility }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [folded, setFolded] = useState(() => new Set());
  useEffect(() => { setFolded(loadFolded()); }, []); // client-only read: keeps SSR markup stable
  const toggleFold = (id) => setFolded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    try { localStorage.setItem(FOLD_KEY, JSON.stringify([...next])); } catch { /* not remembered */ }
    return next;
  });

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
          {RAIL_GROUPS.map((g, gi) => (
            <div key={g.id} style={gi ? { borderTop: '1px solid #e5e6eb' } : undefined}>
          {g.agents.map((layer) => {
            const Icon = agentIcon(layer.icon);
            const isActive = layer.id === activeLayerId;
            return (
              <Tooltip key={layer.id} content={`${layer.label} · ${g.label}`} position="right">
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
          ))}
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
        {RAIL_GROUPS.map((g) => {
          const isFolded = folded.has(g.id);
          const holdsActive = g.agents.some((l) => l.id === activeLayerId);
          return (
          <div key={g.id}>
            <div
              onClick={() => toggleFold(g.id)}
              title={isFolded ? `Show ${g.label}` : `Fold ${g.label}`}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '10px 12px 2px', cursor: 'pointer', userSelect: 'none' }}
            >
              {isFolded ? <IconRight style={{ fontSize: 10, color: '#86909c' }} /> : <IconDown style={{ fontSize: 10, color: '#86909c' }} />}
              <Text type="secondary" style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: isFolded && holdsActive ? 700 : 400 }}>{g.label}</Text>
              {isFolded && <Text type="secondary" style={{ fontSize: 10, marginLeft: 'auto' }}>{g.agents.length}</Text>}
            </div>
        {!isFolded && g.agents.map((layer) => {
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
          );
        })}
      </div>
    </div>
  );
};

export default LayerRail;
