import { useEffect, useMemo, useRef, useState } from 'react';
import { Typography, Button, Tooltip, Tag, InputNumber, Input, Popover, Modal } from '@arco-design/web-react';
import {
  IconUp, IconDown, IconLeft, IconRight, IconBranch, IconPlus, IconClose,
  IconThunderbolt, IconVideoCamera, IconPlayArrow, IconRefresh,
  IconLock, IconUnlock, IconDelete, IconLoading, IconZoomIn, IconZoomOut,
} from '@arco-design/web-react/icon';
import { AGENT_COLORS } from '../../../utils/film/agents';
import { ASSET_DRAG_TYPE, BOARD_NODE_DRAG_TYPE } from '../../../utils/film/libraryStore';
import { orderedEvents, totalDuration } from '../../../utils/film/timelineModel';

const { Text } = Typography;
const COLOR = AGENT_COLORS.storyDirector; // gold — the timeline's accent

// Zoom (pixels per second). 15s fits comfortably at the default; like any video
// editor, zoom in/out rescales the whole track + ruler.
const PX_MIN = 8;
const PX_MAX = 220;
const PX_DEFAULT = 46;
const CLIP_MIN_PX = 6;

// Pick a ruler tick interval so labels sit ~54px+ apart at the current zoom.
const tickSeconds = (pxPerSec) => {
  for (const s of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (s * pxPerSec >= 54) return s;
  return 1200;
};

const STATUS_META = {
  empty: { label: 'Empty', color: '#c9cdd4' },
  keyframe: { label: 'Keyframe', color: '#f7ba1e' },
  rendering: { label: 'Rendering', color: '#165dff' },
  shot: { label: 'Shot', color: '#00b42a' },
  failed: { label: 'Failed', color: '#f53f3f' },
};

const fmt = (s) => {
  const n = Math.round(Number(s) || 0);
  if (n < 60) return `${n}s`;
  return `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, '0')}s`;
};

// Compact overlay button on a clip (reorder ◀▶ / remove ✕) — revealed on hover/selected.
const CTRL_BTN = (disabled, danger) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 18, height: 18, padding: 0, borderRadius: 4, border: 'none', lineHeight: 1, fontSize: 11,
  background: danger ? 'rgba(245,63,63,0.88)' : 'rgba(0,0,0,0.62)', color: '#fff',
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
});

// ---- the final-cut player ------------------------------------------------------
// Plays the stitched film (mp4). Only opened once a stitched film exists.
const FilmPlayer = ({ film, onClose }) => (
  <Modal
    visible
    onCancel={onClose}
    footer={null}
    title="Final cut"
    style={{ width: 720, maxWidth: '92vw' }}
    autoFocus={false}
  >
    <div style={{ background: '#000', borderRadius: 8, overflow: 'hidden' }}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video src={film.url} controls autoPlay style={{ width: '100%', display: 'block', maxHeight: '60vh' }} />
    </div>
  </Modal>
);

// ---- one clip on the time-scaled track ----------------------------------------
const Clip = ({ event, index, total, width, selected, onSelect, onTrimStart, onMove, onRemove }) => {
  const status = STATUS_META[event.status] || STATUS_META.empty;
  const thumb = event.keyframeUrl || event.shotUrl;
  const narrow = width < 64;
  const [hover, setHover] = useState(false);
  const firstClip = index === 0;
  const lastClip = index === total - 1;
  return (
    <div
      onClick={() => onSelect(event.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${index + 1}. ${event.beat || 'Shot'} · ${fmt(event.durationSec)}`}
      style={{
        position: 'relative', width, minWidth: CLIP_MIN_PX, height: 64, flexShrink: 0,
        borderRadius: 5, overflow: 'hidden', cursor: 'pointer', background: '#0f1115',
        outline: selected ? `2px solid ${COLOR}` : '1px solid #d9d9e3', outlineOffset: -1,
        boxShadow: selected ? `0 0 0 2px ${COLOR}55` : 'none',
      }}
    >
      {thumb ? (
        event.status === 'shot' && event.shotUrl
          // eslint-disable-next-line jsx-a11y/media-has-caption
          ? <video src={event.shotUrl} muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.92 }} />
          : <img src={thumb} alt={event.beat} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.92 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          {event.status === 'rendering' ? <IconLoading style={{ color: '#fff' }} /> : <Text style={{ fontSize: 9, color: '#86909c' }}>empty</Text>}
        </div>
      )}
      {/* status stripe along the bottom */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: status.color }} />
      <span style={{ position: 'absolute', top: 2, left: 2, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 9, borderRadius: 4, padding: '0 4px' }}>{index + 1}</span>
      {event.locked && <IconLock style={{ position: 'absolute', top: 2, right: 2, color: '#fff', fontSize: 10, background: 'rgba(0,0,0,0.5)', borderRadius: 7, padding: 1 }} />}
      {event.qc && event.qc.verdict && event.qc.verdict !== 'pass' && !event.locked && (
        <Tooltip content={(event.qc.issues || []).map((it) => it.message).filter(Boolean).join(' · ') || 'QC flagged this shot — your call.'}>
          <span style={{ position: 'absolute', top: 2, right: 2, background: event.qc.verdict === 'fail' ? '#f53f3f' : '#ff7d00', color: '#fff', fontSize: 8, borderRadius: 4, padding: '0 3px', cursor: 'help' }}>⚠</span>
        </Tooltip>
      )}
      {!narrow && (
        <div style={{ position: 'absolute', left: 4, right: 4, bottom: 6 }}>
          <Text style={{ fontSize: 9, color: '#fff', textShadow: '0 1px 2px #000' }} ellipsis>{fmt(event.durationSec)} · {event.beat || 'Shot'}</Text>
        </div>
      )}
      {/* overlay controls — reorder ◀▶ and remove ✕, revealed on hover/selected. Reorder maps
          to the timeline EDL order (what Stitch concatenates); remove drops the clip but LEAVES
          the take node on the board (it just flips back to ＋ Timeline). */}
      {(hover || selected) && (onMove || onRemove) && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', gap: 2, zIndex: 6 }}
        >
          {onMove && (
            <button type="button" title="Move earlier" disabled={firstClip} style={CTRL_BTN(firstClip, false)} onClick={(e) => { e.stopPropagation(); if (!firstClip) onMove(event.id, -1); }}>
              <IconLeft />
            </button>
          )}
          {onRemove && (
            <button type="button" title="Remove from timeline (the take stays on the board)" style={CTRL_BTN(false, true)} onClick={(e) => { e.stopPropagation(); onRemove(event.id); }}>
              <IconClose />
            </button>
          )}
          {onMove && (
            <button type="button" title="Move later" disabled={lastClip} style={CTRL_BTN(lastClip, false)} onClick={(e) => { e.stopPropagation(); if (!lastClip) onMove(event.id, 1); }}>
              <IconRight />
            </button>
          )}
        </div>
      )}

      {/* right-edge trim handle (drag to change duration — the video-editor gesture) */}
      <div
        onPointerDown={(e) => { e.stopPropagation(); onTrimStart(event, e); }}
        title="Drag to trim duration"
        style={{ position: 'absolute', top: 0, right: 0, width: 8, height: '100%', cursor: 'ew-resize', background: selected ? `${COLOR}cc` : 'rgba(255,255,255,0.25)' }}
      />
    </div>
  );
};

// ---- the inspector for the selected clip --------------------------------------
const Inspector = ({ event, index, total, onSetDuration, onToggleLock, onMove, onRegenerate, onRemove }) => {
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  useEffect(() => { setNote(''); setNoteOpen(false); }, [event?.id]);
  if (!event) {
    return (
      <div style={{ padding: '8px 12px', borderTop: '1px solid #f0f0f3' }}>
        <Text type="secondary" style={{ fontSize: 11 }}>Select a clip to trim it, re-order it, lock it, or regenerate it with a note.</Text>
      </div>
    );
  }
  const canIterate = !!event.stepId && !event.locked;
  const regenPanel = (
    <div style={{ width: 250 }}>
      <Text style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>What&rsquo;s wrong with this shot?</Text>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>Your note steers the next take — the shot&rsquo;s anchors still apply. Locked clips are never touched.</Text>
      <Input.TextArea autoFocus value={note} onChange={setNote} placeholder="e.g. three characters instead of two, lighting is off, background doesn't match…" autoSize={{ minRows: 2, maxRows: 4 }} />
      <div style={{ textAlign: 'right', marginTop: 8 }}>
        <Button size="mini" type="primary" icon={<IconRefresh />} style={{ background: COLOR, borderColor: COLOR }} onClick={() => { onRegenerate(event.id, note.trim()); setNote(''); setNoteOpen(false); }}>Regenerate</Button>
      </div>
    </div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderTop: '1px solid #f0f0f3', overflowX: 'auto' }}>
      <Tag size="small" color="gold" style={{ flexShrink: 0 }}>Clip {index + 1}/{total}</Tag>
      <Text style={{ fontSize: 12, fontWeight: 600, flexShrink: 0, maxWidth: 220 }} ellipsis>{event.beat || 'Shot'}</Text>

      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <Text type="secondary" style={{ fontSize: 11 }}>Duration</Text>
        <InputNumber size="mini" min={1} max={60} value={event.durationSec} onChange={(v) => onSetDuration(event.id, v)} style={{ width: 64 }} suffix="s" />
      </span>

      <Tooltip content="Move earlier"><Button size="mini" icon={<IconLeft />} disabled={index === 0} onClick={() => onMove(event.id, -1)} /></Tooltip>
      <Tooltip content="Move later"><Button size="mini" icon={<IconRight />} disabled={index === total - 1} onClick={() => onMove(event.id, 1)} /></Tooltip>
      <Tooltip content={event.locked ? 'Unlock (allow regeneration)' : 'Lock (freeze — never re-touched)'}>
        <Button size="mini" type={event.locked ? 'primary' : 'default'} icon={event.locked ? <IconLock /> : <IconUnlock />} style={event.locked ? { background: COLOR, borderColor: COLOR } : undefined} onClick={() => onToggleLock(event.id)} />
      </Tooltip>
      <Popover trigger="click" popupVisible={noteOpen} onVisibleChange={setNoteOpen} content={regenPanel} disabled={!canIterate}>
        <Tooltip content={canIterate ? 'Regenerate with a note' : (event.locked ? 'Unlock to iterate' : 'Auto-fill to enable iteration')}>
          <Button size="mini" icon={<IconRefresh />} disabled={!canIterate}>Regenerate</Button>
        </Tooltip>
      </Popover>
      <Tooltip content="Remove clip"><Button size="mini" status="danger" icon={<IconDelete />} onClick={() => onRemove(event.id)} /></Tooltip>
      {event.feedback && <Text type="secondary" style={{ fontSize: 10, fontStyle: 'italic', flexShrink: 0 }}>↻ {event.feedback}</Text>}
    </div>
  );
};

// (The Filming-Loop inspector — busy status + the take-review gate Approve / Correct /
// Retry — was removed: shooting and re-shooting happen on each SHOT card's 🎬 button,
// so the timeline carries no filming controls. It is placement and order, nothing else.)

// ============================================================================
// The Timeline — placement and order, nothing else: a zoomable, time-scaled
// track (like any video editor) where shots land and get re-ordered/trimmed.
// Consistency anchors live on the BOARD as role badges — not down here.
// ============================================================================
const StoryTimeline = ({
  events = [], targetSeconds = 15, film = null,
  collapsed, onToggle, selectedEventId, apiKeyPresent,
  onSelectEvent, onSetDuration, onToggleEventLock, onMoveEvent, onRegenerate, onRemoveEvent,
  onAddAsset, onAutoFill, onRenderMovie, onAddSelectedToTimeline,
  busy = {}, canAddSelected = false,
  filmMode = false,
}) => {
  const [pxPerSec, setPxPerSec] = useState(PX_DEFAULT);
  const [dragOver, setDragOver] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [trim, setTrim] = useState(null); // { id, startX, startDur } while dragging a clip edge
  const [sel, setSel] = useState(null);   // interval { start, end } in seconds, or null
  const scrollRef = useRef(null);
  const selAnchorRef = useRef(null);

  const ordered = useMemo(() => orderedEvents(events), [events]);
  const sumSeconds = useMemo(() => totalDuration(events), [events]);
  const shotsReady = useMemo(() => ordered.filter((e) => e.shotUrl).length, [ordered]);

  const selectedEvent = useMemo(
    () => ordered.find((e) => e.id === selectedEventId || e.keyframeNodeId === selectedEventId) || null,
    [ordered, selectedEventId],
  );
  const selectedIndex = selectedEvent ? ordered.indexOf(selectedEvent) : -1;

  const tick = tickSeconds(pxPerSec);
  const contentSeconds = Math.max(sumSeconds, targetSeconds, 1) + tick;
  const trackWidth = Math.max(contentSeconds * pxPerSec, 280);
  const overBudget = sumSeconds > targetSeconds * 1.04;

  // Trim-by-drag: while dragging a clip's right edge, map cursor delta → duration.
  useEffect(() => {
    if (!trim) return undefined;
    const onMove = (e) => {
      const next = Math.max(1, Math.min(60, Math.round(trim.startDur + (e.clientX - trim.startX) / pxPerSec)));
      onSetDuration(trim.id, next);
    };
    const onUp = () => setTrim(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [trim, pxPerSec, onSetDuration]);
  const startTrim = (event, e) => setTrim({ id: event.id, startX: e.clientX, startDur: event.durationSec });

  // Interval selection: drag across the ruler to mark a time window [start,end].
  // "Auto-fill" then fills just that window (~one shot / 5s), contextual to the idea
  // + assets. A click (tiny drag) clears the selection.
  const secAt = (clientX) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + el.scrollLeft) / pxPerSec);
  };
  const startSel = (e) => { e.preventDefault(); const s = secAt(e.clientX); selAnchorRef.current = s; setSel({ start: s, end: s }); };
  useEffect(() => {
    const toSec = (clientX) => {
      const el = scrollRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return Math.max(0, (clientX - rect.left + el.scrollLeft) / pxPerSec);
    };
    const onMove = (e) => {
      if (selAnchorRef.current == null) return;
      const a = selAnchorRef.current;
      const cur = toSec(e.clientX);
      setSel({ start: Math.min(a, cur), end: Math.max(a, cur) });
    };
    const onUp = () => {
      if (selAnchorRef.current == null) return;
      selAnchorRef.current = null;
      setSel((s) => (s && s.end - s.start >= 0.75 ? s : null));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [pxPerSec]);
  const selWidth = sel ? sel.end - sel.start : 0;
  const runAutoFill = () => {
    onAutoFill(sel && selWidth >= 0.75 ? { start: sel.start, end: sel.end } : undefined);
    setSel(null); // the window was just a target; clear the band once it's firing
  };

  const zoom = (factor) => setPxPerSec((p) => Math.max(PX_MIN, Math.min(PX_MAX, Math.round(p * factor))));

  const carries = (e) => e.dataTransfer.types.includes(BOARD_NODE_DRAG_TYPE) || e.dataTransfer.types.includes(ASSET_DRAG_TYPE);
  const onTrackDragOver = (e) => { if (!onAddAsset || !carries(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dragOver) setDragOver(true); };
  const onTrackDrop = (e) => {
    setDragOver(false);
    if (!onAddAsset) return;
    const raw = e.dataTransfer.getData(BOARD_NODE_DRAG_TYPE) || e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    try { const d = JSON.parse(raw); const url = d.thumb || d.url; if (url) onAddAsset({ url, assetId: d.assetId || null, label: d.label || d.name || 'Shot' }); } catch { /* ignore */ }
  };

  // ruler ticks
  const ticks = [];
  for (let t = 0; t <= contentSeconds + 0.001; t += tick) ticks.push(t);

  const empty = ordered.length === 0;

  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 6, background: '#fff', borderTop: `2px solid ${COLOR}`, boxShadow: '0 -2px 10px rgba(0,0,0,0.06)' }}>
      {/* action bar — chrome appears only when it has something to act on: no
          disabled buttons, no budget math for an empty track. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <IconBranch style={{ color: COLOR, fontSize: 14 }} />
          <Text bold style={{ fontSize: 12 }}>Timeline</Text>
          {!empty && <Text type="secondary" style={{ fontSize: 11 }}>{ordered.length} {ordered.length === 1 ? 'shot' : 'shots'}</Text>}
          {!empty && (filmMode ? (
            <Tag size="small" color="green" style={{ marginLeft: 2 }}>{fmt(sumSeconds)}</Tag>
          ) : (
            <Tooltip content={`Σ duration vs target (${fmt(targetSeconds)})`}>
              <Tag size="small" color={overBudget ? 'red' : 'green'} style={{ marginLeft: 2 }}>{fmt(sumSeconds)} / {fmt(targetSeconds)}</Tag>
            </Tooltip>
          ))}
          {film?.url && <Tag size="small" color="purple">film ready</Tag>}
        </span>

        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {!empty && (
            <>
              <Tooltip content="Zoom out"><Button size="mini" type="text" icon={<IconZoomOut />} disabled={pxPerSec <= PX_MIN} onClick={() => zoom(1 / 1.5)} /></Tooltip>
              <Tooltip content="Zoom in"><Button size="mini" type="text" icon={<IconZoomIn />} disabled={pxPerSec >= PX_MAX} onClick={() => zoom(1.5)} /></Tooltip>
            </>
          )}
          {film?.url && (
            <Tooltip content="Play the stitched film">
              <Button size="mini" type="outline" icon={<IconPlayArrow />} onClick={() => setPlayerOpen(true)}>Play film</Button>
            </Tooltip>
          )}
          {/* Film mode: no Auto-fill (timeline = view; shooting is on the SHOT cards). */}
          {!filmMode && !empty && (
            <>
              <Tooltip content={sel && selWidth >= 0.75 ? `Fill just the selected ${Math.round(selWidth)}s — contextual to your idea and tagged assets` : 'Build a first cut autonomously from your idea and tagged assets'}>
                <Button size="mini" type="primary" icon={busy.autoFill ? <IconLoading /> : <IconThunderbolt />} loading={busy.autoFill} disabled={!apiKeyPresent} style={{ background: apiKeyPresent ? COLOR : undefined, borderColor: apiKeyPresent ? COLOR : undefined }} onClick={runAutoFill}>
                  {sel && selWidth >= 0.75 ? `Auto-fill ${Math.round(sel.start)}–${Math.round(sel.end)}s` : 'Auto-fill'}
                </Button>
              </Tooltip>
              {sel && selWidth >= 0.75 && (
                <Tooltip content="Clear interval"><Button size="mini" type="text" icon={<IconClose />} onClick={() => setSel(null)} /></Tooltip>
              )}
            </>
          )}
          {shotsReady > 0 && (
            <Tooltip content={`Stitch ${shotsReady} rendered shot(s) into the final cut`}>
              <Button size="mini" type="outline" icon={busy.render ? <IconLoading /> : <IconVideoCamera />} loading={busy.render} onClick={onRenderMovie}>Render movie</Button>
            </Tooltip>
          )}
          <Button size="mini" type="text" icon={collapsed ? <IconUp /> : <IconDown />} onClick={onToggle}>{collapsed ? 'Show' : 'Hide'}</Button>
        </span>
      </div>

      {!collapsed && (
        <>
          {/* scrollable ruler + track (shared horizontal scroll = aligned) */}
          <div
            ref={scrollRef}
            className="nowheel"
            onWheel={(e) => e.stopPropagation()}
            onDragOver={onTrackDragOver}
            onDragLeave={() => setDragOver(false)}
            onDrop={onTrackDrop}
            style={{ overflowX: 'auto', overflowY: 'hidden', background: dragOver ? 'rgba(247,186,30,0.10)' : '#fbfbfc', outline: dragOver ? `2px dashed ${COLOR}` : 'none', outlineOffset: -3 }}
          >
            {/* EMPTY: one slim call-to-action row — no ruler, no track, no tips wall.
                (Film mode's empty state is nothing at all: the inspector below leads.) */}
            {empty ? (filmMode ? null : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
                <Button size="mini" type="primary" icon={busy.autoFill ? <IconLoading /> : <IconThunderbolt />} loading={busy.autoFill} disabled={!apiKeyPresent} style={{ background: apiKeyPresent ? COLOR : undefined, borderColor: apiKeyPresent ? COLOR : undefined }} onClick={runAutoFill}>Auto-fill a first cut</Button>
                <Text type="secondary" style={{ fontSize: 12 }}>{dragOver ? 'Drop to add the first shot.' : 'or drag an asset here.'}</Text>
              </div>
            )) : (
            <div style={{ width: trackWidth, position: 'relative' }}>
              {/* ruler — drag across it to select a time window for Auto-fill.
                  Film mode drops it entirely: chunks flow left-to-right; no budget,
                  no window-fill — the director chat is the driver. */}
              {!filmMode && (
                <div onPointerDown={startSel} title="Drag to select a window, then Auto-fill" style={{ position: 'relative', height: 16, borderBottom: '1px solid #ececf0', cursor: 'crosshair' }}>
                  {ticks.map((t) => (
                    <div key={t} style={{ position: 'absolute', left: t * pxPerSec, top: 0, height: '100%', borderLeft: '1px solid #e5e6eb', paddingLeft: 3, pointerEvents: 'none' }}>
                      <Text style={{ fontSize: 9, color: '#a9aebb' }}>{fmt(t)}</Text>
                    </div>
                  ))}
                  {/* target (budget) marker */}
                  <div style={{ position: 'absolute', left: targetSeconds * pxPerSec, top: 0, height: '100%', borderLeft: `2px solid ${overBudget ? '#f53f3f' : '#86909c'}`, pointerEvents: 'none' }} title={`Target ${fmt(targetSeconds)}`} />
                </div>
              )}

              {/* interval selection band (over ruler + track) */}
              {sel && selWidth >= 0.5 && (
                <div style={{ position: 'absolute', left: sel.start * pxPerSec, top: 0, width: Math.max(2, selWidth * pxPerSec), height: 90, background: 'rgba(247,186,30,0.20)', borderLeft: `2px solid ${COLOR}`, borderRight: `2px solid ${COLOR}`, pointerEvents: 'none', zIndex: 4 }}>
                  <span style={{ position: 'absolute', top: 0, left: 2, background: COLOR, color: '#fff', fontSize: 9, borderRadius: 3, padding: '0 3px' }}>{Math.round(sel.start)}–{Math.round(sel.end)}s</span>
                </div>
              )}

              {/* track (only rendered when there are clips) */}
              <div style={{ position: 'relative', height: 74, padding: '5px 0' }}>
                {/* budget shade beyond target (not a film-mode concept) */}
                {!filmMode && sumSeconds * pxPerSec > targetSeconds * pxPerSec && (
                  <div style={{ position: 'absolute', left: targetSeconds * pxPerSec, top: 0, width: Math.max(0, (sumSeconds - targetSeconds) * pxPerSec), height: '100%', background: 'rgba(245,63,63,0.06)' }} />
                )}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 2, height: '100%' }}>
                  {ordered.map((event, i) => (
                    <Clip key={event.id} event={event} index={i} total={ordered.length} width={Math.max(CLIP_MIN_PX, event.durationSec * pxPerSec)} selected={selectedEvent?.id === event.id} onSelect={onSelectEvent} onTrimStart={startTrim} onMove={onMoveEvent} onRemove={onRemoveEvent} />
                  ))}
                  {!filmMode && canAddSelected && (
                    <Tooltip content="Add the selected board asset as the next shot">
                      <div onClick={onAddSelectedToTimeline} style={{ width: 44, height: 64, flexShrink: 0, cursor: 'pointer', border: `2px dashed ${COLOR}`, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLOR }}>
                        <IconPlus style={{ fontSize: 16 }} />
                      </div>
                    </Tooltip>
                  )}
                </div>
              </div>
            </div>
            )}
          </div>

          {/* Clip inspector only in edit (non-film) mode when a clip is selected.
              Film mode = just the track; shooting/re-shooting is on the SHOT cards. */}
          {!filmMode && selectedEvent ? (
            <Inspector
              event={selectedEvent}
              index={selectedIndex}
              total={ordered.length}
              onSetDuration={onSetDuration}
              onToggleLock={onToggleEventLock}
              onMove={onMoveEvent}
              onRegenerate={onRegenerate}
              onRemove={onRemoveEvent}
            />
          ) : null}
        </>
      )}

      {playerOpen && film?.url && <FilmPlayer film={film} onClose={() => setPlayerOpen(false)} />}
    </div>
  );
};

export default StoryTimeline;
