import { memo, useEffect } from 'react';
import { Button, Empty, Popconfirm, Spin, Tag, Typography } from '@arco-design/web-react';
import { IconClose, IconPlayArrow, IconPlus, IconCheck, IconDelete } from '@arco-design/web-react/icon';

const { Text } = Typography;

// ---- TAKE LIBRARY — the dailies bin as a right drawer -------------------------------
// Takes never render on the canvas (the board shows the PLAN); this drawer is the ONE
// surface for renders. Focused mode = the selected SHOT card's filmstrip; library mode
// = every card with takes, in cut order. Posters only (the 512px lazy extractions the
// board cards already use) — playback stays in the Take Viewer (▶ on a row's poster).

const STATUS_COLOR = { running: '#165dff', shot: '#00b42a', failed: '#f53f3f' };

const TakeRow = memo(({ take, onTimeline, onOpenViewer, onAddToTimeline, onRemoveFromTimeline, onDeleteTake, onNeedPoster }) => {
  const { id, url, posterUrl, posterScaled, loading, error, label } = take;
  // Same lazy-poster contract as the board cards: ask once per session; a full-res
  // poster stamped before downscaling existed re-asks and self-heals.
  useEffect(() => {
    if (url && (!posterUrl || !posterScaled) && onNeedPoster) onNeedPoster(id);
  }, [id, url, posterUrl, posterScaled, onNeedPoster]);
  return (
    <div style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid #e5e6eb', background: '#fff' }}>
      <div
        onClick={() => { if (url && !loading) onOpenViewer(id); }}
        title={url && !loading ? 'Open in the Take Viewer' : undefined}
        style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#101418', cursor: url && !loading ? 'pointer' : 'default' }}
      >
        {posterUrl ? (
          <img src={posterUrl} alt={label} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : null}
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#9fb4d0' }}>
            <Spin />
            <span style={{ fontSize: 11 }}>rendering…</span>
          </div>
        )}
        {!loading && error && !url && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 10 }}>
            <Text style={{ fontSize: 11, color: '#f53f3f', textAlign: 'center' }}>{error}</Text>
          </div>
        )}
        {!loading && url && (
          <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 34, height: 34, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconPlayArrow style={{ color: '#fff', fontSize: 18 }} />
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '5px 8px' }}>
        <Text style={{ fontSize: 11, flex: 1, minWidth: 0 }} ellipsis={{ rows: 1 }}>{label}</Text>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {/* Rendered take → add to / remove from the Final Cut timeline (then Stitch). */}
          {url && !loading && (onTimeline ? (
            <IconCheck
              onClick={() => onRemoveFromTimeline(id)}
              title="On the Final Cut timeline — click to remove this clip"
              style={{ fontSize: 15, cursor: 'pointer', color: '#00b42a' }}
            />
          ) : (
            <IconPlus
              onClick={() => onAddToTimeline(id)}
              title="Add this take to the Final Cut timeline (then Stitch the film)"
              style={{ fontSize: 15, cursor: 'pointer', color: '#165dff' }}
            />
          ))}
          {!loading && (
            <Popconfirm title="Delete this take?" okText="Delete" position="left" onOk={() => onDeleteTake(id)}>
              <IconDelete
                title="Delete this take (its timeline clip goes with it)"
                style={{ fontSize: 14, cursor: 'pointer', color: '#86909c' }}
              />
            </Popconfirm>
          )}
        </span>
      </div>
    </div>
  );
});
TakeRow.displayName = 'TakeRow';

const TakeLibrary = ({ groups, focusedCardId, timelineIds, onOpenViewer, onAddToTimeline, onRemoveFromTimeline, onDeleteTake, onNeedPoster, onFocusCard, onShowAll, onClose }) => {
  const focused = focusedCardId ? groups.find((g) => g.cardId === focusedCardId) : null;
  const shown = focused ? [focused] : groups.filter((g) => g.takes.length);
  const empty = !shown.length || (focused && !focused.takes.length);
  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 300, zIndex: 9, borderLeft: '1px solid #e5e6eb', boxShadow: '-4px 0 16px rgba(0,0,0,0.08)', background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f2f3f5' }}>
        <Text style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>🎞 Take Library</Text>
        {focused && <Button size="mini" onClick={onShowAll} title="Show every shot's takes">All shots</Button>}
        <Button size="mini" type="text" icon={<IconClose />} onClick={onClose} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {shown.map((g) => (
          <div key={g.cardId}>
            <div
              onClick={() => { if (!focused) onFocusCard(g.cardId); }}
              title={focused ? undefined : 'Focus this shot (selects the card on the board)'}
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, cursor: focused ? 'default' : 'pointer' }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[g.status] || '#c9cdd4', flexShrink: 0 }} />
              <Tag size="small" style={{ background: '#101418', color: '#f7ba1e', border: 'none', fontWeight: 700, flexShrink: 0 }}>SHOT {g.cut + 1}</Tag>
              <Text style={{ fontSize: 11, flex: 1, minWidth: 0 }} ellipsis={{ rows: 1 }}>{g.beat}</Text>
              <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{g.takes.length}</Text>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.takes.map((t) => (
                <TakeRow
                  key={t.id}
                  take={t}
                  onTimeline={!!(timelineIds && timelineIds.has && timelineIds.has(t.id))}
                  onOpenViewer={onOpenViewer}
                  onAddToTimeline={onAddToTimeline}
                  onRemoveFromTimeline={onRemoveFromTimeline}
                  onDeleteTake={onDeleteTake}
                  onNeedPoster={onNeedPoster}
                />
              ))}
            </div>
          </div>
        ))}
        {empty && (
          <Empty
            style={{ marginTop: 40 }}
            description={focused
              ? 'No takes on this card yet — press 🎬 on it.'
              : 'No takes yet — 🎬 on a SHOT card renders the first one.'}
          />
        )}
      </div>
    </div>
  );
};

export default TakeLibrary;
