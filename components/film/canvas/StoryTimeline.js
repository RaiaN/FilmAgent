import { useState } from 'react';
import { Typography, Button } from '@arco-design/web-react';
import { IconUp, IconDown, IconRight, IconBranch, IconPlus } from '@arco-design/web-react/icon';
import { AGENT_COLORS } from '../../../utils/film/agents';
import { ASSET_DRAG_TYPE, BOARD_NODE_DRAG_TYPE } from '../../../utils/film/libraryStore';

const { Text } = Typography;
const COLOR = AGENT_COLORS.storyDirector;

// Foldable storyboard strip along the bottom of the canvas. Shows the ordered
// story keyframes (thumbnail + beat label); clicking one selects/centers it.
// Drop a board asset (grip) or a Library item here to append it as a new beat.
const StoryTimeline = ({ items, collapsed, onToggle, onSelect, selectedId, onAddAsset }) => {
  const totalSeconds = Math.max(0, (items.length - 1)) * 5; // ~5s per segment, rough
  const [dragOver, setDragOver] = useState(false);

  const carries = (e) =>
    e.dataTransfer.types.includes(BOARD_NODE_DRAG_TYPE) || e.dataTransfer.types.includes(ASSET_DRAG_TYPE);

  const onDragOver = (e) => {
    if (!onAddAsset || !carries(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };

  const onDrop = (e) => {
    setDragOver(false);
    if (!onAddAsset) return;
    const raw = e.dataTransfer.getData(BOARD_NODE_DRAG_TYPE) || e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    try {
      const d = JSON.parse(raw);
      const url = d.thumb || d.url; // Library uploads expose a loadable thumb; board grips pass a displayable url
      if (url) onAddAsset({ url, assetId: d.assetId || null, label: d.label || d.name || 'Beat' });
    } catch { /* ignore malformed payloads */ }
  };
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 6,
        background: '#fff',
        borderTop: `2px solid ${COLOR}`,
        boxShadow: '0 -2px 10px rgba(0,0,0,0.05)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <IconBranch style={{ color: COLOR, fontSize: 14 }} />
          <Text bold style={{ fontSize: 12 }}>Timeline</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {items.length} {items.length === 1 ? 'beat' : 'beats'}{items.length > 1 ? ` · ~${totalSeconds}s` : ''}
          </Text>
        </span>
        <Button size="mini" type="text" icon={collapsed ? <IconUp /> : <IconDown />} onClick={onToggle}>
          {collapsed ? 'Show' : 'Hide'}
        </Button>
      </div>

      {!collapsed && (
        <div
          onDragOver={onDragOver}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          style={{
            display: 'flex',
            gap: 0,
            overflowX: 'auto',
            padding: '4px 12px 10px',
            alignItems: 'flex-start',
            background: dragOver ? 'rgba(247,186,30,0.10)' : 'transparent',
            outline: dragOver ? `2px dashed ${COLOR}` : 'none',
            outlineOffset: -4,
          }}
        >
          {items.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 12, padding: '8px 0', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconPlus style={{ color: COLOR }} />
              {dragOver ? 'Drop to start the story' : 'No story yet — drag a board asset (⋮ grip) or a Library item here, or build beats with Story Director.'}
            </Text>
          ) : (
            <>
            {items.map((item, i) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center' }}>
                <div
                  onClick={() => onSelect(item.id)}
                  style={{
                    width: 104,
                    cursor: 'pointer',
                    border: `2px solid ${item.id === selectedId ? COLOR : '#e5e6eb'}`,
                    borderRadius: 6,
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                  title={item.event}
                >
                  <div style={{ position: 'relative', height: 60, background: '#f2f3f5' }}>
                    {item.url ? (
                      <img src={item.url} alt={item.event} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                        <Text type="secondary" style={{ fontSize: 10 }}>…</Text>
                      </div>
                    )}
                    <span style={{ position: 'absolute', top: 2, left: 2, background: COLOR, color: '#fff', fontSize: 9, borderRadius: 6, padding: '0 5px' }}>{i + 1}</span>
                  </div>
                  <div style={{ padding: '2px 4px' }}>
                    <Text style={{ fontSize: 10 }} ellipsis={{ rows: 2 }}>{item.event || 'Beat'}</Text>
                  </div>
                </div>
                {i < items.length - 1 && <IconRight style={{ color: '#c9cdd4', margin: '0 2px', flexShrink: 0 }} />}
              </div>
            ))}
            {/* trailing drop affordance */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <IconRight style={{ color: '#c9cdd4', margin: '0 2px', flexShrink: 0 }} />
              <div
                title="Drag a board asset or Library item here to add a beat"
                style={{
                  width: 104, height: 84, flexShrink: 0,
                  border: `2px dashed ${dragOver ? COLOR : '#c9cdd4'}`,
                  borderRadius: 6, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', color: dragOver ? COLOR : '#86909c',
                }}
              >
                <IconPlus style={{ fontSize: 16 }} />
                <Text type="secondary" style={{ fontSize: 9, textAlign: 'center', marginTop: 2 }}>drop asset</Text>
              </div>
            </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default StoryTimeline;
