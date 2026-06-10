import { memo, useState } from 'react';
import { Typography, Tag, Message } from '@arco-design/web-react';
import { IconLock, IconUnlock, IconLoading, IconCopy, IconCloud, IconExclamationCircleFill, IconDragDotVertical } from '@arco-design/web-react/icon';
import { AGENT_COLORS } from '../../../utils/film/agents';
import { BOARD_NODE_DRAG_TYPE } from '../../../utils/film/libraryStore';

const { Text } = Typography;

const copyText = (e, text) => {
  e.stopPropagation();
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(text || '').then(
      () => Message.success('Copied'),
      () => Message.error('Copy failed'),
    );
  }
};

const KIND_LABEL = {
  image: 'IMG',
  video: 'VID',
  audio: 'AUD',
  text: 'TXT',
};

// Visibility from the owning layer: 'show' | 'dim' | 'hide'
const visibilityStyle = (visibility) => {
  if (visibility === 'hide') return { display: 'none' };
  if (visibility === 'dim') return { opacity: 0.25 };
  return {};
};

const AssetNodeInner = ({ id, data, selected }) => {
  const { kind, url, localUrl, text, label, locked, layerId, loading, visibility, preserved, preserving } = data;
  const tint = layerId ? (AGENT_COLORS[layerId] || '#86909c') : '#c9cdd4';

  const isText = kind === 'text';
  // Local uploads keep an in-memory data URL that always renders; prefer it for
  // display so the thumbnail never breaks even if the remote/TOS URL is unreachable.
  const displaySrc = localUrl || url;
  const [imgError, setImgError] = useState(false);
  // "Expired" only applies to a generated (Seedream) signed URL that lapsed and
  // was never checked in — never to a local upload (which has localUrl).
  const expired = imgError && !preserved && !localUrl;

  return (
    <div
      style={{
        width: isText ? 280 : 220,
        background: '#fff',
        borderRadius: 10,
        border: `2px solid ${selected ? '#165dff' : '#e5e6eb'}`,
        boxShadow: selected ? '0 0 0 3px rgba(22,93,255,0.12)' : '0 1px 4px rgba(0,0,0,0.08)',
        overflow: 'hidden',
        ...visibilityStyle(visibility),
      }}
    >
      {/* Layer tint bar + kind/lock badges */}
      <div style={{ height: 4, background: tint }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', gap: 6 }}>
        <Tag size="small" color="gray" style={{ fontSize: 10 }}>{KIND_LABEL[kind] || 'TXT'}</Tag>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {kind === 'image' && displaySrc && !expired && (
            // nodrag → React Flow won't treat this as a node-move, so the native
            // HTML5 drag fires. Drop target: the Story Director timeline.
            <span
              className="nodrag"
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData(
                  BOARD_NODE_DRAG_TYPE,
                  JSON.stringify({ id, url: displaySrc, assetId: data.assetId || null, label: label || 'Beat' }),
                );
              }}
              title="Drag onto the Timeline to add as a story beat"
              style={{ display: 'inline-flex', alignItems: 'center', cursor: 'grab', color: AGENT_COLORS.storyDirector }}
            >
              <IconDragDotVertical style={{ fontSize: 14 }} />
            </span>
          )}
          {preserving && <IconLoading style={{ color: '#0fc6c2', fontSize: 13 }} title="Checking in…" />}
          {preserved && !preserving && (
            <IconCloud style={{ color: '#0fc6c2', fontSize: 14 }} title="Checked in — saved permanently" />
          )}
          {locked ? (
            <IconLock style={{ color: '#00b42a', fontSize: 14 }} title="Locked — canonical reference" />
          ) : (
            <IconUnlock style={{ color: '#c9cdd4', fontSize: 14 }} />
          )}
        </span>
      </div>

      {/* Body */}
      <div style={{ position: 'relative', background: '#f2f3f5', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.6)', zIndex: 2 }}>
            <IconLoading style={{ fontSize: 24, color: '#165dff' }} />
          </div>
        )}
        {kind === 'image' && displaySrc && !expired && (
          <img
            src={displaySrc}
            alt={label}
            style={{ width: '100%', display: 'block' }}
            draggable={false}
            onError={() => setImgError(true)}
          />
        )}
        {kind === 'image' && expired && (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <IconExclamationCircleFill style={{ color: '#f53f3f', fontSize: 22 }} />
            <div style={{ marginTop: 6 }}>
              <Text type="error" style={{ fontSize: 11, display: 'block' }}>Expired</Text>
              <Text type="secondary" style={{ fontSize: 10 }}>
                Signed URL lapsed (24h). Re-generate it — it wasn't checked in.
              </Text>
            </div>
          </div>
        )}
        {kind === 'video' && url && (
          <video src={url} style={{ width: '100%', display: 'block' }} muted loop playsInline controls />
        )}
        {kind === 'audio' && url && (
          <audio src={url} controls style={{ width: '100%', padding: 8 }} />
        )}
        {isText && (
          <div
            className="nowheel"
            style={{ padding: 10, width: '100%', maxHeight: 220, overflowY: 'auto', background: '#fff', textAlign: 'left' }}
          >
            <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {text || label || '—'}
            </Text>
          </div>
        )}
        {kind === 'image' && !displaySrc && !loading && (
          <Text type="secondary" style={{ fontSize: 12 }}>empty</Text>
        )}
      </div>

      {data.error && (
        <div style={{ padding: '4px 8px', background: '#fff1f0' }}>
          <Text type="error" style={{ fontSize: 10 }} ellipsis={{ rows: 2 }}>{data.error}</Text>
        </div>
      )}

      {/* Caption */}
      {(label || (isText && text)) && (
        <div style={{ padding: '6px 8px', borderTop: '1px solid #f2f3f5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <Text style={{ fontSize: 11 }} ellipsis={{ rows: 1 }}>{label}</Text>
          {isText && text && (
            <span
              onClick={(e) => copyText(e, text)}
              title="Copy text"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer', color: '#0fc6c2', flexShrink: 0 }}
            >
              <IconCopy style={{ fontSize: 12 }} />
              <Text style={{ fontSize: 10, color: '#0fc6c2' }}>Copy</Text>
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default memo(AssetNodeInner);
