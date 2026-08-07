import { memo, useContext, useEffect, useMemo, useState } from 'react';
import { useNodesData } from '@xyflow/react';
import { Button, Typography } from '@arco-design/web-react';
import { IconRefresh, IconPlayCircle, IconLoading, IconVideoCamera, IconArrowUp, IconArrowDown, IconClose, IconExpand, IconBrush } from '@arco-design/web-react/icon';
import { AssetNodeContext } from './AssetNode';
import { StoryboardChatContext } from './StoryboardChatNode';
import { SHOT_TEMPLATE_BY_ID } from '../../../utils/film/recipes';

const { Text } = Typography;

// THE STRIP — its OWN board element again ("physically separate", 2026-08-07): one
// draggable node rendering the whole shot list as a strict-column table
// [# + text | START | END] with internal vertical scroll, laid below the Shot
// Division control card on divide. The per-shot keyframe nodes still exist (renders,
// editor, promote, persistence address them by id) but are PERMANENTLY HIDDEN board
// nodes, same pattern as takes; this strip is their single display surface.
const STILL_W = 224;
const TEXT_W = 330;

const cellBase = {
  width: STILL_W, flexShrink: 0, position: 'relative', background: '#eceff3',
  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  borderLeft: '1px solid #e5e6eb', minHeight: 140,
};
const badge = {
  position: 'absolute', top: 6, left: 6, zIndex: 3, color: '#fff', fontSize: 10,
  fontWeight: 700, lineHeight: '17px', padding: '0 6px', borderRadius: 4, pointerEvents: 'none',
};

// A strip cell's image with the board card's survival contract: walk the src chain
// (cacheUrl → localUrl → url), on exhaustion fire the heal (re-sign) once and say
// "couldn't load" instead of silent gray. Chain resets when the data brings new urls.
const CellImg = ({ srcs, alt, title, onDoubleClick, onDead }) => {
  const list = srcs.filter(Boolean);
  const [i, setI] = useState(0);
  const [dead, setDead] = useState(false);
  const key = list.join('|');
  useEffect(() => { setI(0); setDead(false); }, [key]);
  if (!list.length) return null;
  if (dead) return <Text type="secondary" style={{ fontSize: 10, textAlign: 'center', padding: '0 10px' }}>couldn't load — re-render or reopen</Text>;
  return (
    <img
      src={list[Math.min(i, list.length - 1)]}
      alt={alt}
      title={title}
      loading="lazy"
      decoding="async"
      draggable={false}
      onDoubleClick={onDoubleClick}
      onError={() => { if (i + 1 < list.length) setI(i + 1); else { setDead(true); if (onDead) onDead(); } }}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
};

const StoryboardStripInner = ({ id, data, selected }) => {
  const { onRenderStill, onEditKeyframe, onExpandKeyframe, onPromoteKeyframe, onViewImage, onImgError, onRenderEnd, onEnhanceStill } = useContext(AssetNodeContext);
  const { onListAction } = useContext(StoryboardChatContext);
  const chatId = data.chatId || String(id).replace('sbpanel', 'sbchat');
  const chatArr = useNodesData([chatId]);
  const shots = chatArr?.[0]?.data?.shots || [];
  const rowIds = useMemo(() => shots.map((_, i) => `${id}-${i}`), [id, shots.length]);
  const rows = useNodesData(rowIds);
  const totalSec = shots.reduce((a, s) => a + (Number(s.durationSec) || 0), 0);

  return (
    <div style={{ width: 780, background: '#fff', borderRadius: 10, overflow: 'hidden', border: `2px solid ${selected ? '#165dff' : '#d9d9e3'}`, boxShadow: selected ? '0 0 0 3px rgba(22,93,255,0.12)' : '0 1px 4px rgba(0,0,0,0.08)' }}>
      <div style={{ height: 4, background: '#4e5969' }} />
      {/* title bar = the drag handle; everything below is nodrag */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '7px 12px', borderBottom: '1px solid #e5e6eb' }}>
        <Text bold style={{ fontSize: 12 }}>Storyboard strip</Text>
        <Text type="secondary" style={{ fontSize: 10 }}>{shots.length} shot{shots.length === 1 ? '' : 's'} · {totalSec}s</Text>
        <Text type="secondary" style={{ fontSize: 9, marginLeft: 'auto' }}>1 row = 1 shot</Text>
      </div>
      {shots.length === 0 && (
        <Text type="secondary" style={{ display: 'block', fontSize: 11, padding: 14 }}>Empty strip — Divide into shots on the control card lays the rows.</Text>
      )}
      <div style={{ display: shots.length ? 'flex' : 'none', borderBottom: '1px solid #e5e6eb', background: '#f7f8fa' }}>
        <Text style={{ flex: 1, fontSize: 9, fontWeight: 700, color: '#86909c', padding: '3px 12px' }}>SHOT · {shots.length} · {totalSec}s</Text>
        <Text style={{ width: STILL_W, flexShrink: 0, fontSize: 9, fontWeight: 700, color: '#86909c', padding: '3px 8px', borderLeft: '1px solid #e5e6eb' }}>START</Text>
        <Text style={{ width: STILL_W, flexShrink: 0, fontSize: 9, fontWeight: 700, color: '#86909c', padding: '3px 8px', borderLeft: '1px solid #e5e6eb' }}>END</Text>
      </div>
      <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()} style={{ maxHeight: 560, overflowY: 'auto' }}>
        {shots.map((s, i) => {
          const nodeId = `${id}-${i}`;
          const row = rows?.[i]?.data || {};
          const tpl = SHOT_TEMPLATE_BY_ID[row.shotTemplate || s.shotTemplate];
          const still = row.cacheUrl || row.localUrl || row.url;
          const develops = !!String(row.exiting ?? s.exiting ?? '').trim();
          return (
            <div key={nodeId} style={{ display: 'flex', alignItems: 'stretch', borderTop: i ? '1px solid #e5e6eb' : 'none', background: '#fffdf7' }}>
              {/* TEXT column — display only: words change via the action bar's Note →
                  re-author, or the shot editor (⤢); surgery via ↑ ↓ ✕. */}
              <div style={{ flex: 1, minWidth: 0, padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text style={{ fontSize: 10, fontWeight: 700, color: '#4e5969' }}>
                  {`#${String(i + 1).padStart(2, '0')} · ${row.beat || s.beat || 'Shot'} · ${row.durationSec || s.durationSec || 10}s${row.intExt ? ` · ${row.intExt}` : ''}`}
                </Text>
                {tpl && <Text style={{ fontSize: 9, color: '#86909c' }}>{tpl.framing} · {tpl.angle} · {tpl.move}{develops ? ' · DEVELOPS' : ''}</Text>}
                <Text title={row.body || ''} style={{ fontSize: 11, lineHeight: '15px' }} ellipsis={{ rows: 4 }}>{row.body || '—'}</Text>
                {String(row.motion || '').trim() && (
                  <Text title={`ACTION — what the take performs:\n${row.motion}`} style={{ fontSize: 10, lineHeight: '14px', color: '#6b7785' }} ellipsis={{ rows: 2 }}>▸ {row.motion}</Text>
                )}
                {String(row.audio || '').trim() && (
                  <Text title={`AUDIO: ${row.audio}`} style={{ fontSize: 10, color: '#8a6d1d' }} ellipsis={{ rows: 1 }}>♪ {row.audio}</Text>
                )}
                {row.authorPending && <Text style={{ fontSize: 10, color: '#165dff' }}>✍ authoring from the script span…</Text>}
                {String(row.authorError || '').trim() && <Text style={{ fontSize: 10, color: '#f53f3f' }} ellipsis={{ rows: 2 }}>⚠ authoring failed: {row.authorError}</Text>}
                {(row.missingDialogue || []).length > 0 && (
                  <Text title={(row.missingDialogue || []).join('\n')} style={{ fontSize: 10, color: '#b25c00' }} ellipsis={{ rows: 2 }}>⚠ dropped dialogue ({row.missingDialogue.length}): {row.missingDialogue.join(' · ')}</Text>
                )}
                {(row.figureLabels || []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {row.figureLabels.map((l, fi) => (
                      <span key={`${fi}-${l}`} style={{ fontSize: 9, padding: '0 6px', lineHeight: '15px', borderRadius: 8, border: '1px solid #722ed1', color: '#722ed1' }}>{l}</span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 4, marginTop: 'auto', alignItems: 'center' }}>
                  {still ? (
                    <>
                      {row.staleStill && onRenderStill && (
                        <Button size="mini" type="primary" style={{ flex: 1, background: '#ff7d00', borderColor: '#ff7d00' }} icon={<IconRefresh />} onClick={() => onRenderStill(nodeId)} title="Text moved on — re-render the still to match">re-render</Button>
                      )}
                      {onPromoteKeyframe && (
                        <Button size="mini" type="primary" style={{ flex: 1, background: '#b06f10', borderColor: '#b06f10' }} icon={<IconVideoCamera />} onClick={() => onPromoteKeyframe(nodeId)} title="→ SHOT card — the still rides as its K1 keyframe; beat / camera / duration carried">SHOT card</Button>
                      )}
                      {onEditKeyframe && !row.staleStill && (
                        <Button size="mini" icon={<IconRefresh />} onClick={() => onEditKeyframe(nodeId, {})} title="Regenerate this still" />
                      )}
                    </>
                  ) : (
                    onRenderStill && (
                      <Button size="mini" type="primary" style={{ flex: 1, background: '#4e5969', borderColor: '#4e5969' }} loading={!!row.loading} icon={<IconPlayCircle />} onClick={() => onRenderStill(nodeId)} title="Render this shot's still — ONE Seedream image from exactly this text + its references">Render still</Button>
                    )
                  )}
                  {onExpandKeyframe && <Button size="mini" icon={<IconExpand />} onClick={() => onExpandKeyframe(nodeId)} title="Shot editor — text, references, camera, expression, frame lock" />}
                  {onListAction && (
                    <>
                      <Button size="mini" icon={<IconArrowUp />} disabled={i === 0} onClick={() => onListAction(chatId, { action: 'move', shot: i, to: i - 1 })} title="Move this shot up" />
                      <Button size="mini" icon={<IconArrowDown />} disabled={i === shots.length - 1} onClick={() => onListAction(chatId, { action: 'move', shot: i, to: i + 1 })} title="Move this shot down" />
                      <Button size="mini" status="danger" icon={<IconClose />} onClick={() => onListAction(chatId, { action: 'cut', shot: i })} title="Cut this shot — the list renumbers (free)" />
                    </>
                  )}
                </div>
              </div>
              {/* START cell */}
              <div style={cellBase}>
                <span style={{ ...badge, background: 'rgba(16,20,24,0.78)' }}>{String(i + 1).padStart(2, '0')}</span>
                {still && !row.loading && onEnhanceStill && (
                  <Button
                    size="mini" icon={<IconBrush />}
                    onClick={(e) => { e.stopPropagation(); onEnhanceStill(nodeId, 'start'); }}
                    title="Enhance — the agent studies THIS frame and applies a finishing pass (micro-detail, light shaping, texture, atmosphere) with composition, identity and blocking locked. 1 VLM + 1 image, replaces in place."
                    style={{ position: 'absolute', top: 4, right: 4, zIndex: 4 }}
                  />
                )}
                {row.loading && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.66)', zIndex: 2 }}>
                    <IconLoading style={{ fontSize: 20, color: '#165dff' }} />
                    <Text style={{ fontSize: 10, color: '#4e5969', fontWeight: 600 }}>
                      {row.enhancePhase === 'look' ? '✦ 1/2 · agent studying the frame…' : row.enhancePhase === 'edit' ? '✦ 2/2 · applying the finishing pass…' : 'rendering…'}
                    </Text>
                  </div>
                )}
                {still ? (
                  <CellImg
                    srcs={[row.cacheUrl, row.localUrl, row.url]}
                    alt={row.beat || `shot ${i + 1}`}
                    title="START still — double-click to view full screen"
                    onDoubleClick={() => onViewImage && onViewImage(nodeId)}
                    onDead={() => onImgError && onImgError(nodeId)}
                  />
                ) : (
                  <Text type="secondary" style={{ fontSize: 10 }}>not rendered</Text>
                )}
                {row.staleStill && still && (
                  <span style={{ position: 'absolute', bottom: 5, left: 5, right: 5, zIndex: 3, background: 'rgba(255,125,0,0.92)', color: '#fff', fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4, textAlign: 'center', pointerEvents: 'none' }}>text changed — re-render</span>
                )}
              </div>
              {/* END cell — ALWAYS present so the columns align. ↻ re-rolls JUST the END
                  (boundary iteration); a HOLD cell opens the shot editor to write one. */}
              <div
                style={{ ...cellBase, cursor: develops ? 'default' : 'pointer' }}
                title={develops ? 'END frame — this shot develops; the pair pins its take. Edit the end state in the shot editor.' : 'HOLD shot — click to open the shot editor and write an END state'}
                onClick={() => { if (!develops && onExpandKeyframe) onExpandKeyframe(nodeId); }}
              >
                {develops && <span style={{ ...badge, background: 'rgba(29,107,196,0.9)' }}>END</span>}
                {develops && !row.endLoading && still && onRenderEnd && (
                  <Button
                    size="mini" icon={<IconRefresh />}
                    onClick={(e) => { e.stopPropagation(); onRenderEnd(nodeId); }}
                    title="Re-render the END frame ONLY — one image from the current START still + end state; the START stays"
                    style={{ position: 'absolute', top: 4, right: 4, zIndex: 4 }}
                  />
                )}
                {develops && !row.endLoading && row.endStill?.url && onEnhanceStill && (
                  <Button
                    size="mini" icon={<IconBrush />}
                    onClick={(e) => { e.stopPropagation(); onEnhanceStill(nodeId, 'end'); }}
                    title="Enhance the END frame — finishing pass with composition/identity locked. 1 VLM + 1 image, replaces in place."
                    style={{ position: 'absolute', top: 4, right: 34, zIndex: 4 }}
                  />
                )}
                {develops ? (
                  row.endStill?.url ? (
                    <CellImg srcs={[row.endStill.cacheUrl, row.endStill.url]} alt="END" title="END frame — renders with the still" />
                  ) : row.endLoading ? (
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                      <IconLoading style={{ fontSize: 18, color: '#165dff' }} />
                      <Text style={{ fontSize: 10, color: '#4e5969', fontWeight: 600 }}>
                        {row.enhancePhase === 'look' ? '✦ 1/2 · agent studying the frame…' : row.enhancePhase === 'edit' ? '✦ 2/2 · applying the finishing pass…' : 'rendering END…'}
                      </Text>
                    </span>
                  ) : (
                    <Text title={`⇥ END: ${row.exiting} — renders with the still`} style={{ fontSize: 10, color: '#1d6bc4', padding: '0 10px', textAlign: 'center' }} ellipsis={{ rows: 4 }}>⇥ {row.exiting}</Text>
                  )
                ) : (
                  <Text type="secondary" style={{ fontSize: 10 }}>HOLD · ＋ end state</Text>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default memo(StoryboardStripInner);
