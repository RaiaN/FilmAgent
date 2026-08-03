import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Typography, Tag, Select, Button } from '@arco-design/web-react';
import { isProvablyExpired } from '../../../utils/film/mediaUrl';
import { IconLoading, IconCloud, IconExclamationCircleFill, IconPlus, IconCheck, IconDownload, IconRefresh, IconBgColors, IconUserGroup, IconVideoCamera, IconEdit, IconPlayCircle, IconEye, IconAlignLeft, IconCopy } from '@arco-design/web-react/icon';
import { AGENT_COLORS } from '../../../utils/film/agents';
import { BIBLE_ROLES, BIBLE_ROLE_META, SHOT_TEMPLATE_BY_ID } from '../../../utils/film/recipes';
import EditableLabel from './EditableLabel';

const { Text } = Typography;

// Bridge from a board node's role-dropdown back to FilmCanvas's tagNode. Functions
// can't live in (serializable) node.data, so the tag/untag action travels via
// context instead — React context passes through ReactFlowProvider unchanged.
export const AssetNodeContext = createContext({ onTagRole: null, onRename: null, onImgError: null, onAddToTimeline: null, onRemoveFromTimeline: null, onTimelineIds: null, onEditKeyframe: null, onExpandKeyframe: null, onMaskPrevis: null, onAttachPlate: null, onCastColors: null, onPromoteKeyframe: null, onToggleMediaRef: null, onEditImage: null, onOpenViewer: null, onPreserve: null, onRenderStill: null, onPatchKeyframeText: null, onDuplicate: null, onViewImage: null, onNeedPoster: null, lod: false });

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

const KIND_LABEL = {
  image: 'IMG',
  video: 'VID',
  audio: 'AUD',
};

// Visibility from the owning layer: 'show' | 'dim' | 'hide'
const visibilityStyle = (visibility) => {
  if (visibility === 'hide') return { display: 'none' };
  if (visibility === 'dim') return { opacity: 0.25 };
  return {};
};

const AssetNodeInner = ({ id, data, selected }) => {
  const { kind, url, localUrl, cacheUrl, label, locked, layerId, loading, visibility, preserved, preserving, bibleRole } = data;
  const { onTagRole, onRename, onImgError, onAddToTimeline, onRemoveFromTimeline, onTimelineIds, onEditKeyframe, onExpandKeyframe, onMaskPrevis, onAttachPlate, onCastColors, onPromoteKeyframe, onToggleMediaRef, onEditImage, onOpenViewer, onPreserve, onRenderStill, onPatchKeyframeText, onDuplicate, onViewImage, onNeedPoster, lod } = useContext(AssetNodeContext);
  // Inline body edit on an UNRENDERED shot card (double-click) — free, no render, no LLM.
  const [editBody, setEditBody] = useState(null);
  const onTimeline = !!(onTimelineIds && onTimelineIds.has && onTimelineIds.has(id));
  const tint = bibleRole ? (BIBLE_ROLE_COLOR[bibleRole] || '#f7ba1e') : (layerId ? (AGENT_COLORS[layerId] || '#86909c') : '#c9cdd4');

  // Locations are 16:9 (wide) — at the default 220px width they render only ~124px
  // tall, much smaller than portrait cast plates. Give them a wider node so the place
  // reads at a comparable size on the board.
  const isLocation = bibleRole === 'location' || data.meta?.suggestedRole === 'location' || layerId === 'locationVariations';
  // Display sources, in durability order: the LOCAL media store (cacheUrl — survives the
  // remote URL's expiry), then a local upload's in-memory data URL, then the remote URL.
  // A failed load WALKS this chain instead of bricking the node on the first miss; when
  // the whole chain is exhausted, a non-lapsed failure auto-retries (a blip is not an
  // expiry) before any error surfaces.
  const srcChain = useMemo(() => {
    const c = [];
    [cacheUrl, localUrl, url].forEach((s) => { if (s && !c.includes(s)) c.push(s); });
    return c;
  }, [cacheUrl, localUrl, url]);
  const [srcIdx, setSrcIdx] = useState(0);
  const [attempt, setAttempt] = useState(0); // remount key — a remounted <img> re-requests a failed src
  const [dead, setDead] = useState(false);   // the whole chain failed
  const autoRetryRef = useRef(0);
  const retryTimerRef = useRef(null);
  const healAskedRef = useRef(false);
  const chainKey = srcChain.join('|');
  // A healed/changed url deserves a fresh walk (and may heal again later).
  useEffect(() => {
    setSrcIdx(0); setDead(false); autoRetryRef.current = 0; healAskedRef.current = false;
    return () => clearTimeout(retryTimerRef.current);
  }, [chainKey]);
  const displaySrc = srcChain.length ? srcChain[Math.min(srcIdx, srcChain.length - 1)] : '';
  const retryLoad = () => { autoRetryRef.current = 0; setSrcIdx(0); setDead(false); setAttempt((a) => a + 1); };
  const onLoadError = () => {
    if (srcIdx < srcChain.length - 1) { setSrcIdx((i) => i + 1); return; } // fall down the chain
    // Chain exhausted. Only a signed url that has VERIFIABLY lapsed (checked against its
    // own X-Tos-Date/-Expires params) is expiry; anything else is treated as transient
    // first — re-request twice before surfacing an error card.
    if (!isProvablyExpired(srcChain[srcChain.length - 1]) && autoRetryRef.current < 2) {
      autoRetryRef.current += 1;
      retryTimerRef.current = setTimeout(() => setAttempt((a) => a + 1), 1500 * autoRetryRef.current);
      return;
    }
    // A PRESERVED image that won't load is a dead LINK, not lost bytes — ask the canvas
    // for a fresh signed url (self-heal) and show a quiet refresh state.
    if (preserved && !localUrl && onImgError && !healAskedRef.current) { healAskedRef.current = true; onImgError(id); }
    setDead(true);
  };
  const provablyExpired = dead && isProvablyExpired(url);
  const healing = dead && preserved && !localUrl;
  const expired = dead && !healing; // the error card (its verdict text splits on provablyExpired)

  // A video card shows a POSTER still, never a mounted <video> — dozens of live
  // players (decoder + metadata fetch each) made big boards crawl. The canvas
  // extracts the first frame once and stamps data.posterUrl; playback lives in
  // the Take Viewer only.
  useEffect(() => {
    // !posterScaled also re-asks for early FULL-RES posters (pre-downscale stamps).
    if (kind === 'video' && (cacheUrl || url) && (!data.posterUrl || !data.posterScaled) && onNeedPoster) onNeedPoster(id);
  }, [kind, cacheUrl, url, data.posterUrl, data.posterScaled, onNeedPoster, id]);

  // Inline rename (shared EditableLabel) — when an onRename handler is provided.
  const canRename = typeof onRename === 'function';

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

  // Zoom-out LOD: at overview zoom every node is in the viewport at once (culling
  // can't help), so media elements are the cliff — render a flat tint tile instead:
  // no <img>/<video>/<audio>, just kind + label. Detail returns on zoom-in.
  if (lod) {
    return (
      <div style={{
        width: data.sheet ? 760 : ((isLocation || data.previz || data.previzMask) ? 360 : (kind === 'audio' ? 280 : 220)),
        background: '#fff', borderRadius: 10,
        border: `2px solid ${selected ? '#165dff' : bibleRole ? (BIBLE_ROLE_COLOR[bibleRole] || '#f7ba1e') : '#e5e6eb'}`,
        overflow: 'hidden',
        ...visibilityStyle(visibility),
      }}
      >
        <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} />
        <div style={{ height: 4, background: tint }} />
        <div style={{ height: kind === 'audio' ? 56 : 140, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, background: '#f7f8fa' }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: tint, letterSpacing: 1 }}>{KIND_LABEL[kind] || 'IMG'}</span>
          {label ? <Text type="secondary" style={{ fontSize: 12, maxWidth: '92%' }} ellipsis>{label}</Text> : null}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: data.sheet ? 760 : ((isLocation || data.previz || data.previzMask) ? 360 : (kind === 'audio' ? 280 : 220)),
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
          {/* Audio/video CANON tag — the media analog of a bible role: tagged clips/videos
              are offered as one-tap reference chips on every SHOT card. */}
          {(kind === 'audio' || kind === 'video') && onToggleMediaRef && (
            <Button
              size="mini"
              className="nodrag"
              type={data.mediaRef ? 'primary' : 'outline'}
              onClick={(e) => { e.stopPropagation(); onToggleMediaRef(id); }}
              title={data.mediaRef
                ? 'Canon reference — every SHOT card offers this as a one-tap reference chip. Click to untag.'
                : `Tag as a canon reference — every SHOT card will offer this ${kind} as a one-tap reference chip (Seedance reference ${kind}, ≤15s)`}
              style={{ fontSize: 9, height: 18, lineHeight: '16px', padding: '0 6px', ...(data.mediaRef ? {} : { borderStyle: 'dashed', color: '#86909c', borderColor: '#c9cdd4' }) }}
            >
              {data.mediaRef ? '★ Reference' : '☆ Reference'}
            </Button>
          )}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {(cacheUrl || url) && !loading && onDuplicate && (
            <span className="nodrag" onClick={(e) => { e.stopPropagation(); onDuplicate(id); }} title="Duplicate — a free copy of this element lands beside it (edit/mask/tag the copy without touching the original)" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', color: '#86909c' }}>
              <IconCopy style={{ fontSize: 14 }} />
            </span>
          )}
          {((kind === 'image' && displaySrc && !expired) || (kind === 'video' && (cacheUrl || url)) || (kind === 'audio' && url)) && (
            <span className="nodrag" onClick={downloadAsset} title="Download to disk" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', color: '#86909c' }}>
              <IconDownload style={{ fontSize: 14 }} />
            </span>
          )}
          {preserving && <IconLoading style={{ color: '#0fc6c2', fontSize: 13 }} title="Checking in…" />}
          {preserved && !preserving && (
            <IconCloud style={{ color: '#0fc6c2', fontSize: 14 }} title="In the Library — registered trusted asset" />
          )}
          {(kind === 'image' || kind === 'video') && !preserved && !preserving && (cacheUrl || url) && onPreserve && (
            <span className="nodrag" onClick={(e) => { e.stopPropagation(); onPreserve(id); }} title="Add to Library — register as a trusted asset (skips Seedance's person screen) and keep it for every project. Your explicit call — drafts never do this on their own." style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', color: '#86909c' }}>
              <IconCloud style={{ fontSize: 14 }} />
            </span>
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
        {/* Storyboard SHOT NUMBER — a board without panel numbers isn't a board: the
            chat revision loop runs on "shot 5", so every tile wears its number. */}
        {data.keyframe && Number.isFinite(Number(data.index)) && displaySrc && !data.showText && (
          <span style={{ position: 'absolute', top: 6, left: 6, zIndex: 3, background: 'rgba(16,20,24,0.78)', color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: '18px', padding: '0 7px', borderRadius: 4, pointerEvents: 'none' }}>
            {String(Number(data.index) + 1).padStart(2, '0')}
          </span>
        )}
        {/* A rendered still whose TEXT moved on (chat revision / inline edit) says so —
            the still stays (it was paid for); ↻ re-renders from the current text. */}
        {data.keyframe && data.staleStill && displaySrc && !data.showText && (
          <span style={{ position: 'absolute', bottom: 6, left: 6, right: 6, zIndex: 3, background: 'rgba(255,125,0,0.92)', color: '#fff', fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, textAlign: 'center', pointerEvents: 'none' }}>
            text changed — ↻ re-renders to match
          </span>
        )}
        {kind === 'image' && displaySrc && !expired && !healing && !(data.keyframe && data.showText) && (
          <img
            key={`${srcIdx}-${attempt}`}
            src={displaySrc}
            alt={label}
            title="Double-click — view full screen"
            style={{ width: '100%', display: 'block' }}
            draggable={false}
            loading="lazy"
            decoding="async"
            onError={onLoadError}
            onDoubleClick={(e) => { e.stopPropagation(); onViewImage && onViewImage(id); }}
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
              <Text type="error" style={{ fontSize: 11, display: 'block' }}>{provablyExpired ? 'Expired' : 'Couldn\'t load'}</Text>
              <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
                {provablyExpired
                  ? 'The signed link lapsed before check-in — re-generate this frame.'
                  : 'Network hiccup, or the source is gone.'}
              </Text>
              {!provablyExpired && (
                <Button size="mini" className="nodrag" icon={<IconRefresh />} style={{ marginTop: 8 }}
                  onClick={(e) => { e.stopPropagation(); retryLoad(); }}>
                  Retry
                </Button>
              )}
            </div>
          </div>
        )}
        {kind === 'video' && url && (
          <div
            title="Double-click — open the Take Viewer"
            onDoubleClick={(e) => { e.stopPropagation(); onOpenViewer && onOpenViewer(id); }}
            style={{ position: 'relative', background: '#000' }}
          >
            {data.posterUrl
              ? <img src={data.posterUrl} alt={label || 'take'} loading="lazy" decoding="async" style={{ width: '100%', display: 'block', opacity: 0.94 }} />
              : (
                <div style={{ height: 124, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#4e5969', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>VID</Text>
                </div>
              )}
            <span
              className="nodrag"
              title="Open in the Take Viewer — scrub and frame-step, then extract the exact frame, first/last frame, a described note, or the audio track"
              onClick={(e) => { e.stopPropagation(); onOpenViewer && onOpenViewer(id); }}
              style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 34, height: 34, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <IconPlayCircle style={{ fontSize: 20 }} />
            </span>
          </div>
        )}
        {kind === 'audio' && (cacheUrl || url) && (
          <audio src={cacheUrl || url} controls style={{ width: '100%', padding: 8 }} />
        )}
        {/* TEXT-FIRST SHOT CARD — the division lays the shot list as these cards; each
            is the text preview of the still it will become (header · action · casting),
            editable for free (double-click), rendered only by ITS explicit tap. A card
            WITH a still can flip back here any time (Text ⇄ Still, per card). */}
        {kind === 'image' && data.keyframe && (!displaySrc || data.showText) && !loading && (() => {
          const tpl = SHOT_TEMPLATE_BY_ID[data.shotTemplate];
          const commitBody = () => {
            const v = String(editBody || '').trim();
            setEditBody(null);
            if (v && v !== data.body && onPatchKeyframeText) onPatchKeyframeText(id, { body: v });
          };
          return (
            <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ alignSelf: 'stretch', width: '100%', padding: '8px 10px', background: '#fffdf7', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text style={{ fontSize: 10, fontWeight: 700, color: '#4e5969', letterSpacing: 0.2 }}>
                {`#${String(Number(data.index) + 1).padStart(2, '0')}`}
                {tpl ? ` · ${tpl.framing} · ${tpl.angle} · ${tpl.move}` : ''}
                {` · ${data.durationSec || 10}s`}
                {data.intExt ? ` · ${data.intExt}` : ''}
              </Text>
              {editBody !== null ? (
                <textarea
                  autoFocus
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') commitBody();
                    if (e.key === 'Escape') setEditBody(null);
                  }}
                  onBlur={commitBody}
                  style={{ fontSize: 11, lineHeight: '15px', minHeight: 96, resize: 'vertical', border: '1px solid #165dff', borderRadius: 4, padding: 4, fontFamily: 'inherit', width: '100%' }}
                />
              ) : (
                <Text
                  onDoubleClick={() => setEditBody(data.body || '')}
                  title="The exact text this card's still renders from — double-click to edit (free, nothing generates)"
                  style={{ fontSize: 11, lineHeight: '15px', cursor: 'text' }}
                  ellipsis={{ rows: 5 }}
                >
                  {data.body || '—'}
                </Text>
              )}
              {(data.figureLabels || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {data.figureLabels.map((l, fi) => (
                    <span key={`${fi}-${l}`} style={{ fontSize: 9, padding: '0 6px', lineHeight: '16px', borderRadius: 8, border: '1px solid #722ed1', color: '#722ed1' }}>{l}</span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 4, marginTop: 'auto' }}>
                {displaySrc ? (
                  <>
                    <Button size="mini" style={{ flex: 1 }} icon={<IconEye />} onClick={(e) => { e.stopPropagation(); onPatchKeyframeText && onPatchKeyframeText(id, { showText: false }); }} title="Back to the rendered still (the text stays behind it — flip any time)">
                      Still
                    </Button>
                    {data.staleStill && onRenderStill && (
                      <Button size="mini" type="primary" style={{ background: '#ff7d00', borderColor: '#ff7d00', flexShrink: 0 }} icon={<IconRefresh />} onClick={(e) => { e.stopPropagation(); onRenderStill(id); }} title="The still is behind this text — re-render it to match" />
                    )}
                  </>
                ) : (
                  onRenderStill && (
                    <Button size="mini" type="primary" style={{ flex: 1, background: '#4e5969', borderColor: '#4e5969' }} icon={<IconPlayCircle />} onClick={(e) => { e.stopPropagation(); onRenderStill(id); }} title="Render this card's still — ONE Seedream image from exactly this text + its references">
                      Render still
                    </Button>
                  )
                )}
                {onExpandKeyframe && (
                  <Button size="mini" icon={<IconEdit />} onClick={(e) => { e.stopPropagation(); onExpandKeyframe(id); }} title="Open the shot editor — full text, references, camera angle, expression" style={{ flexShrink: 0 }} />
                )}
              </div>
            </div>
          );
        })()}
        {kind === 'image' && !data.keyframe && !displaySrc && !loading && (
          <Text type="secondary" style={{ fontSize: 12 }}>empty</Text>
        )}
      </div>

      {/* Storyboard keyframe controls — PROMOTE the approved frame to a SHOT card,
          ↻ regenerate, or open the editor (camera / expression / prompt / references
          all live THERE — the tile stays clean). Only on keyframe nodes. */}
      {data.keyframe && onEditKeyframe && displaySrc && !data.showText && (
        <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', borderTop: '1px solid #f2f3f5' }}>
          {onPromoteKeyframe && (
            <Button size="mini" type="primary" className="nodrag" style={{ flex: 1, background: '#b06f10', borderColor: '#b06f10' }} icon={<IconVideoCamera />} onClick={(e) => { e.stopPropagation(); onPromoteKeyframe(id); }} title="→ SHOT card — lay a production card from this approved frame: the still anchors it as [Image 1] (FIRST FRAME lock), beat, camera and duration carried over. Add motion and dialogue on the card, then 🎬.">→ SHOT card</Button>
          )}
          {onPatchKeyframeText && (
            <Button size="mini" className="nodrag" icon={<IconAlignLeft />} onClick={(e) => { e.stopPropagation(); onPatchKeyframeText(id, { showText: true }); }} title="Text view — flip to this shot's editable text description (the still stays; flip back any time)" style={{ flexShrink: 0 }} />
          )}
          <Button size="mini" className="nodrag" icon={<IconRefresh />} onClick={(e) => { e.stopPropagation(); onEditKeyframe(id, {}); }} title="Regenerate this keyframe" style={{ flexShrink: 0 }} />
          {onExpandKeyframe && (
            <Button size="mini" className="nodrag" icon={<IconEdit />} onClick={(e) => { e.stopPropagation(); onExpandKeyframe(id); }} title="Edit this frame's SHOT — body, references, camera angle, expression; regenerating renders the still from the edits" style={{ flexShrink: 0 }} />
          )}
        </div>
      )}

      {/* ANY other image — cast plate, upload, extract, edit result — can be MASKED into
          a blocking plate or EDITED by instruction (a masked storyboard sequence is just
          Mask on each frame). Results land as NEW nodes; chainable. On STORYBOARD frames
          the instruction Edit is suppressed — their single Edit is the SHOT editor above
          (one edit affordance per frame); Mask stays. */}
      {kind === 'image' && !data.previzMask && displaySrc && !expired && !(data.keyframe && data.showText) && (onMaskPrevis || onEditImage) && (
        <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4, padding: '6px 8px', borderTop: '1px solid #f2f3f5' }}>
          {onMaskPrevis && (
            <Button size="mini" className="nodrag" style={{ flex: 1 }} icon={<IconBgColors />} onClick={(e) => { e.stopPropagation(); onMaskPrevis(id); }} title="Mask — flat color silhouettes (blue, green, yellow, red, purple left to right): every person by default, or name exactly what to mask in the dialog. The plate lands beside this image with the full attach / cast-colors toolkit.">Mask</Button>
          )}
          {onEditImage && !data.keyframe && (
            <Button size="mini" className="nodrag" style={{ flex: 1 }} icon={<IconEdit />} onClick={(e) => { e.stopPropagation(); onEditImage(id); }} title="Edit — describe one change (word for word); a new image with just that change lands beside this one. The original stays untouched.">Edit</Button>
          )}
        </div>
      )}
      {data.previzMask && url && onAttachPlate && (
        <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4, padding: '6px 8px', borderTop: '1px solid #f2f3f5', flexWrap: 'wrap' }}>
          <Button size="mini" type="primary" className="nodrag" style={{ flex: '1.3 1 120px' }} icon={<IconPlus />} onClick={(e) => { e.stopPropagation(); onAttachPlate(id); }} title="Attach this blocking plate to the SELECTED SHOT card (or the card its source image belongs to): the plate + its cast colors become references AND the named FIRST FRAME lock leads the card's prompt.">Attach to SHOT card</Button>
          {onCastColors && (
            <Button size="mini" className="nodrag" style={{ flex: '1 1 70px' }} icon={<IconUserGroup />} onClick={(e) => { e.stopPropagation(); onCastColors(id); }} title="Cast colors — bind each silhouette color to a bible character. Attaching then auto-adds those refs and writes the named, correctly numbered lock (no manual [Image N] matching).">{Object.keys(data.colorCast || {}).length ? `Cast · ${Object.keys(data.colorCast).length}` : 'Cast colors'}</Button>
          )}
                    {onEditImage && (
            <Button size="mini" className="nodrag" style={{ flex: '1 1 70px' }} icon={<IconEdit />} onClick={(e) => { e.stopPropagation(); onEditImage(id); }} title="Edit — describe one change word for word (e.g. 'move the blue silhouette to the doorway'); a new plate with just that change lands beside this one.">Edit</Button>
          )}
        </div>
      )}

      {data.error && (
        <div style={{ padding: '4px 8px', background: '#fff1f0' }}>
          <Text type="error" style={{ fontSize: 10 }} ellipsis={{ rows: 2 }}>{data.error}</Text>
        </div>
      )}

      {/* Caption — editable name (left) + icon-only actions (right), one aligned row. */}
      {(label || canRename) && (
        <div style={{ padding: '6px 8px', borderTop: '1px solid #f2f3f5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {canRename ? (
            <EditableLabel value={label} onCommit={(v) => onRename(id, v)} containerStyle={{ flex: 1 }} textStyle={{ fontSize: 11 }} inputStyle={{ fontSize: 11 }} />
          ) : (
            <Text style={{ fontSize: 11, flex: 1, minWidth: 0 }} ellipsis={{ rows: 1 }}>{label}</Text>
          )}
          {/* Actions: icons only (tooltip carries the meaning). */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* The Take Viewer opens from the poster's ▶ badge (or double-click) —
                ONE play affordance per card, no caption duplicate. */}
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
          </span>
        </div>
      )}
    </div>
  );
};

export default memo(AssetNodeInner);
