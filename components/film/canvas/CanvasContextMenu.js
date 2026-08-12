import { Typography } from '@arco-design/web-react';
import { IconFile } from '@arco-design/web-react/icon';
import { AGENTS } from '../../../utils/film/agents';
import { BIBLE_ROLES, BIBLE_ROLE_META } from '../../../utils/film/recipes';
import { agentIcon } from './agentIcons';

const { Text } = Typography;

const ROLE_COLOR = { character: '#722ed1', location: '#00b42a', prop: '#ff7d00', frame: '#f5319d' };

// Right-click context menu: the agent layers (each opens its configuration panel)
// plus the plain board elements — a Text note lands directly at the click point.
// With images selected, a Tag-as row bulk-tags the whole selection into the bible.
const CanvasContextMenu = ({ x, y, maxHeight, selection, onPick, onAddNote, onBulkTag, onClose }) => {
  const withUrl = (selection || []).filter((n) => n.data?.url);
  const imageCount = withUrl.filter((n) => n.data?.kind === 'image').length;
  const countFor = (layer) => withUrl.filter((n) => (layer.consumes || []).includes(n.data?.kind)).length;

  return (
    <>
      {/* click-away catcher */}
      <div
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
        style={{ position: 'fixed', inset: 0, zIndex: 40 }}
      />
      <div
        className="nowheel"
        onWheel={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: y,
          left: x,
          zIndex: 41,
          minWidth: 230,
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
          border: '1px solid #e5e6eb',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          maxHeight: maxHeight || undefined,
        }}
      >
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #f2f3f5' }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {withUrl.length > 0 ? `${withUrl.length} selected` : 'Nothing selected'} · run an agent
          </Text>
        </div>
        {onBulkTag && imageCount > 0 && (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #f2f3f5' }}>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
              Tag {imageCount} image{imageCount > 1 ? 's' : ''} into the bible as
            </Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {BIBLE_ROLES.map((r) => (
                <span
                  key={r}
                  onClick={() => onBulkTag(r)}
                  title={`Tag every selected image as ${BIBLE_ROLE_META[r]?.label || r} — names come from their labels`}
                  style={{
                    cursor: 'pointer', fontSize: 11, padding: '2px 9px', borderRadius: 10,
                    border: `1px solid ${ROLE_COLOR[r] || '#86909c'}`, color: ROLE_COLOR[r] || '#86909c',
                  }}
                >
                  {BIBLE_ROLE_META[r]?.label || r}
                </span>
              ))}
            </div>
          </div>
        )}
        {onAddNote && (
          <div
            onClick={onAddNote}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f2f3f5' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f7f8fa'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#b06f10', flexShrink: 0 }} />
            <IconFile style={{ fontSize: 16, color: '#b06f10' }} />
            <Text style={{ fontSize: 13 }}>Text note</Text>
          </div>
        )}
        {AGENTS.map((layer) => {
          const Icon = agentIcon(layer.icon);
          const minSel = layer.minSelection || 1;
          const ready = !layer.needsSelection || countFor(layer) >= minSel;
          return (
            <div
              key={layer.id}
              onClick={() => ready && onPick(layer.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                cursor: ready ? 'pointer' : 'not-allowed',
                opacity: ready ? 1 : 0.45,
              }}
              onMouseEnter={(e) => { if (ready) e.currentTarget.style.background = '#f7f8fa'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: layer.color, flexShrink: 0 }} />
              <Icon style={{ fontSize: 16, color: layer.color }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13 }}>{layer.label}</Text>
                {!ready && (
                  <div><Text type="secondary" style={{ fontSize: 11 }}>
                    {minSel >= 2
                      ? `select at least ${minSel} images first`
                      : `select ${(layer.consumes || []).includes('video') ? 'an image or video' : 'an image'} first`}
                  </Text></div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

export default CanvasContextMenu;
