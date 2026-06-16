import { createContext, memo, useContext, useEffect, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Typography, Tag, Message, Select, Button } from '@arco-design/web-react';
import { IconLock, IconUnlock, IconLoading, IconCopy, IconCloud, IconExclamationCircleFill, IconDragDotVertical } from '@arco-design/web-react/icon';
import { AGENT_COLORS } from '../../../utils/film/agents';
import { AD_ROLES, AD_ROLE_META } from '../../../utils/film/recipes';
import { BOARD_NODE_DRAG_TYPE } from '../../../utils/film/libraryStore';

const { Text } = Typography;

// Bridge from a board node's role-dropdown back to FilmCanvas's tagNode. Functions
// can't live in (serializable) node.data, so the tag/untag action travels via
// context instead — React context passes through ReactFlowProvider unchanged.
export const AssetNodeContext = createContext({ onTagRole: null, onImgError: null });

// The bible IS the board: a tagged node carries data.bibleRole. Each AD role gets a
// colour for its badge so the brand kit reads at a glance on the board.
const AD_ROLE_COLOR = {
  product: '#165dff',
  brand: '#f5319d',
  talent: '#722ed1',
  look: '#0aa8a8',
  location: '#00b42a',
  prop: '#ff7d00',
};

const NONE = '__none__';
const ROLE_SELECT_OPTIONS = [
  ...AD_ROLES.map((r) => ({ label: AD_ROLE_META[r].label, value: r })),
  { label: '— none —', value: NONE },
];

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
  const { kind, url, localUrl, text, label, locked, layerId, loading, visibility, preserved, preserving, bibleRole } = data;
  const { onTagRole, onImgError } = useContext(AssetNodeContext);
  const tint = bibleRole ? (AD_ROLE_COLOR[bibleRole] || '#f7ba1e') : (layerId ? (AGENT_COLORS[layerId] || '#86909c') : '#c9cdd4');

  const isText = kind === 'text';
  // Local uploads keep an in-memory data URL that always renders; prefer it for
  // display so the thumbnail never breaks even if the remote/TOS URL is unreachable.
  const displaySrc = localUrl || url;
  const [imgError, setImgError] = useState(false);
  // A healed/changed url deserves a fresh load attempt (and may heal again later).
  const healAskedRef = useRef(false);
  useEffect(() => { setImgError(false); healAskedRef.current = false; }, [displaySrc]);
  // "Expired" only applies to a generated (Seedream) signed URL that lapsed and
  // was never checked in — never to a local upload (which has localUrl).
  const expired = imgError && !preserved && !localUrl;
  // A PRESERVED image that fails to load is a dead LINK, not lost bytes — ask
  // the canvas for a fresh signed url (self-heal) and show a quiet refresh state.
  const healing = imgError && preserved && !localUrl;

  return (
    <div
      style={{
        width: isText ? 280 : 220,
        background: '#fff',
        borderRadius: 10,
        // A bible-tagged node wears its role colour as the border so the brand kit
        // is legible right on the board (selection still wins for clarity).
        border: `2px solid ${selected ? '#165dff' : bibleRole ? (AD_ROLE_COLOR[bibleRole] || '#f7ba1e') : '#e5e6eb'}`,
        boxShadow: selected ? '0 0 0 3px rgba(22,93,255,0.12)' : '0 1px 4px rgba(0,0,0,0.08)',
        overflow: 'hidden',
        ...visibilityStyle(visibility),
      }}
    >
      {/* invisible source handle — lets prerequisite edges (asset → cut card) render */}
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} />
      {/* Layer tint bar + kind/lock badges */}
      <div style={{ height: 4, background: tint }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', gap: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Tag size="small" color="gray" style={{ fontSize: 10, flexShrink: 0 }}>{KIND_LABEL[kind] || 'TXT'}</Tag>
          {/* Suggested role (Topic Explorer candidates) — a PROPOSAL, never auto-canon:
              one click confirms it as a tagged bible anchor. Hidden once tagged. */}
          {!bibleRole && data.meta?.suggestedRole && (
            <Button
              size="mini"
              className="nodrag"
              onClick={(e) => { e.stopPropagation(); onTagRole && onTagRole(id, data.meta.suggestedRole); }}
              title={`Suggested role — click to tag into the bible as ${AD_ROLE_META[data.meta.suggestedRole]?.label || data.meta.suggestedRole}`}
              style={{ fontSize: 9, height: 18, lineHeight: '16px', padding: '0 6px', borderStyle: 'dashed', color: AD_ROLE_COLOR[data.meta.suggestedRole] || '#86909c', borderColor: AD_ROLE_COLOR[data.meta.suggestedRole] || '#c9cdd4' }}
            >
              + {AD_ROLE_META[data.meta.suggestedRole]?.label || data.meta.suggestedRole}?
            </Button>
          )}
          {/* Untagged, no suggestion → a quiet tag picker, so ANY image (e.g. an
              Inspiration result) can be locked into the bible right on its card. */}
          {!bibleRole && !data.meta?.suggestedRole && kind === 'image' && (
            <span className="nodrag" onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', minWidth: 0 }} title="Tag this image into the bible — tagged assets anchor every shot">
              <Select
                size="mini"
                placeholder="+ tag role"
                value={undefined}
                onChange={(v) => onTagRole && onTagRole(id, v)}
                options={ROLE_SELECT_OPTIONS.filter((o) => o.value !== NONE)}
                style={{ width: 92 }}
                triggerProps={{ autoAlignPopupWidth: false }}
              />
            </span>
          )}
          {/* Role badge + dropdown — present only on a bible-tagged node. nodrag so
              opening the menu doesn't drag the node; "— none —" untags it. */}
          {bibleRole && (
            <span
              className="nodrag"
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}
              title={`Bible · ${AD_ROLE_META[bibleRole]?.label || bibleRole}`}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, background: AD_ROLE_COLOR[bibleRole] || '#f7ba1e', flexShrink: 0 }} />
              <Select
                size="mini"
                value={bibleRole}
                onChange={(v) => onTagRole && onTagRole(id, v === NONE ? null : v)}
                options={ROLE_SELECT_OPTIONS}
                style={{ width: 92 }}
                triggerProps={{ autoAlignPopupWidth: false }}
              />
            </span>
          )}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
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
        {kind === 'image' && displaySrc && !expired && !healing && (
          <img
            src={displaySrc}
            alt={label}
            style={{ width: '100%', display: 'block' }}
            draggable={false}
            onError={() => {
              setImgError(true);
              if (preserved && !localUrl && onImgError && !healAskedRef.current) {
                healAskedRef.current = true;
                onImgError(id);
              }
            }}
          />
        )}
        {kind === 'image' && healing && (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <IconLoading style={{ color: '#0fc6c2', fontSize: 18 }} />
            <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 6 }}>
              Refreshing the stored copy…
            </Text>
          </div>
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
