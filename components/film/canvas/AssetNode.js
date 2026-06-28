import { createContext, memo, useContext, useEffect, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Typography, Tag, Message, Select, Button } from '@arco-design/web-react';
import { IconLock, IconUnlock, IconLoading, IconCopy, IconCloud, IconExclamationCircleFill, IconDragDotVertical, IconScissor, IconPlus, IconCheck, IconDownload } from '@arco-design/web-react/icon';
import { AGENT_COLORS } from '../../../utils/film/agents';
import { BIBLE_ROLES, BIBLE_ROLE_META } from '../../../utils/film/recipes';
import { BOARD_NODE_DRAG_TYPE } from '../../../utils/film/libraryStore';
import EditableLabel from './EditableLabel';

const { Text } = Typography;

// Bridge from a board node's role-dropdown back to FilmCanvas's tagNode. Functions
// can't live in (serializable) node.data, so the tag/untag action travels via
// context instead — React context passes through ReactFlowProvider unchanged.
export const AssetNodeContext = createContext({ onTagRole: null, onRename: null, onImgError: null, onDeconstruct: null, deconstructingId: null, onAddToTimeline: null, onRemoveFromTimeline: null, onTimelineIds: null });

// The bible IS the board: a tagged node carries data.bibleRole. Each role gets a
// colour for its badge so the cast & world read at a glance on the board.
const BIBLE_ROLE_COLOR = {
  character: '#722ed1',
  location: '#00b42a',
  prop: '#ff7d00',
  frame: '#f5319d',
};

const NONE = '__none__';
const ROLE_SELECT_OPTIONS = [
  ...BIBLE_ROLES.map((r) => ({ label: BIBLE_ROLE_META[r].label, value: r })),
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
  const { kind, url, localUrl, cacheUrl, text, label, locked, layerId, loading, visibility, preserved, preserving, bibleRole } = data;
  const { onTagRole, onRename, onImgError, onDeconstruct, deconstructingId, onAddToTimeline, onRemoveFromTimeline, onTimelineIds } = useContext(AssetNodeContext);
  const onTimeline = !!(onTimelineIds && onTimelineIds.has && onTimelineIds.has(id));
  const tint = bibleRole ? (BIBLE_ROLE_COLOR[bibleRole] || '#f7ba1e') : (layerId ? (AGENT_COLORS[layerId] || '#86909c') : '#c9cdd4');

  const isText = kind === 'text';
  // Locations are 16:9 (wide) — at the default 220px width they render only ~124px
  // tall, much smaller than portrait cast plates. Give them a wider node so the place
  // reads at a comparable size on the board.
  const isLocation = bibleRole === 'location' || data.meta?.suggestedRole === 'location' || layerId === 'locationVariations';
  // Display source, in durability order: the LOCAL on-disk cache (cacheUrl — survives the
  // remote URL's expiry), then a local upload's in-memory data URL, then the remote URL.
  const displaySrc = cacheUrl || localUrl || url;
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

  // Inline rename (shared EditableLabel) — non-text assets with an onRename handler.
  const canRename = !isText && typeof onRename === 'function';

  // Save the asset to disk. Blob-fetch (works for the same-origin local cache / data URLs
  // and any CORS-permitting remote) → trigger a download; if a cross-origin fetch is blocked,
  // open it in a new tab so the user can still save it manually.
  const downloadAsset = async (e) => {
    e.stopPropagation();
    const src = displaySrc || url;
    if (!src) return;
    const base = String(label || kind || 'asset').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 48) || 'asset';
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const ext = ((blob.type.split('/')[1] || '').split(';')[0]) || (kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png');
      const obj = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = obj; a.download = `${base}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(obj), 2000);
    } catch {
      window.open(src, '_blank', 'noopener');
    }
  };

  return (
    <div
      style={{
        width: isText ? 280 : (isLocation ? 360 : 220),
        background: '#fff',
        borderRadius: 10,
        // A bible-tagged node wears its role colour as the border so the cast & world
        // are legible right on the board (selection still wins for clarity).
        border: `2px solid ${selected ? '#165dff' : bibleRole ? (BIBLE_ROLE_COLOR[bibleRole] || '#f7ba1e') : '#e5e6eb'}`,
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
          {/* Suggested role (cast-draft candidates) — a PROPOSAL, never auto-canon:
              one click confirms it as a tagged bible anchor. Hidden once tagged. */}
          {!bibleRole && data.meta?.suggestedRole && (
            <Button
              size="mini"
              className="nodrag"
              onClick={(e) => { e.stopPropagation(); onTagRole && onTagRole(id, data.meta.suggestedRole); }}
              title={`Suggested role — click to tag into the bible as ${BIBLE_ROLE_META[data.meta.suggestedRole]?.label || data.meta.suggestedRole}`}
              style={{ fontSize: 9, height: 18, lineHeight: '16px', padding: '0 6px', borderStyle: 'dashed', color: BIBLE_ROLE_COLOR[data.meta.suggestedRole] || '#86909c', borderColor: BIBLE_ROLE_COLOR[data.meta.suggestedRole] || '#c9cdd4' }}
            >
              + {BIBLE_ROLE_META[data.meta.suggestedRole]?.label || data.meta.suggestedRole}?
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
              title={`Bible · ${BIBLE_ROLE_META[bibleRole]?.label || bibleRole}`}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, background: BIBLE_ROLE_COLOR[bibleRole] || '#f7ba1e', flexShrink: 0 }} />
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
          {((kind === 'image' && displaySrc && !expired) || (kind === 'video' && (cacheUrl || url)) || (kind === 'audio' && url)) && (
            <span className="nodrag" onClick={downloadAsset} title="Download to disk" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', color: '#86909c' }}>
              <IconDownload style={{ fontSize: 14 }} />
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
            loading="lazy"
            decoding="async"
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
          <video src={cacheUrl || url} style={{ width: '100%', display: 'block' }} muted loop playsInline controls preload="metadata" />
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

      {/* Caption — editable name (left) + icon-only actions (right), one aligned row. */}
      {(label || (isText && text) || canRename) && (
        <div style={{ padding: '6px 8px', borderTop: '1px solid #f2f3f5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {canRename ? (
            <EditableLabel value={label} onCommit={(v) => onRename(id, v)} containerStyle={{ flex: 1 }} textStyle={{ fontSize: 11 }} inputStyle={{ fontSize: 11 }} />
          ) : (
            <Text style={{ fontSize: 11, flex: 1, minWidth: 0 }} ellipsis={{ rows: 1 }}>{label}</Text>
          )}
          {/* Actions: icons only (tooltip carries the meaning). */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* A rendered Take → add it to / remove it from the Final Cut timeline. */}
            {kind === 'video' && url && onAddToTimeline && (
              onTimeline ? (
                <IconCheck
                  className="nodrag"
                  onClick={(e) => { e.stopPropagation(); onRemoveFromTimeline && onRemoveFromTimeline(id); }}
                  title="On the Final Cut timeline — click to remove this clip"
                  style={{ fontSize: 15, cursor: 'pointer', color: '#00b42a' }}
                />
              ) : (
                <IconPlus
                  className="nodrag"
                  onClick={(e) => { e.stopPropagation(); onAddToTimeline(id); }}
                  title="Add this take to the Final Cut timeline (then Stitch the film)"
                  style={{ fontSize: 15, cursor: 'pointer', color: '#165dff' }}
                />
              )
            )}
            {/* A rendered Take → Deconstruct it into cuts (key-frame stills + per-cut SHOT cards). */}
            {kind === 'video' && url && onDeconstruct && (
              (deconstructingId === id ? (
                <IconLoading className="nodrag" title="Deconstructing…" style={{ fontSize: 15, color: '#0fc6c2' }} />
              ) : (
                <IconScissor
                  className="nodrag"
                  onClick={(e) => { e.stopPropagation(); onDeconstruct(id); }}
                  title="Deconstruct — Seed 2.0 Pro watches this Take and breaks it into its cuts: key-frame stills + one editable SHOT card per cut"
                  style={{ fontSize: 15, cursor: 'pointer', color: '#0fc6c2' }}
                />
              ))
            )}
            {isText && text && (
              <IconCopy
                className="nodrag"
                onClick={(e) => copyText(e, text)}
                title="Copy text"
                style={{ fontSize: 15, cursor: 'pointer', color: '#0fc6c2' }}
              />
            )}
          </span>
        </div>
      )}
    </div>
  );
};

export default memo(AssetNodeInner);
