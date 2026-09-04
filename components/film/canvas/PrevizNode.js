import { createContext, memo, useContext } from 'react';
import { Typography, Button, Tag, Select, Message } from '@arco-design/web-react';
import { IconLoading, IconPlayArrow, IconRefresh, IconCamera, IconVideoCamera, IconLaunch } from '@arco-design/web-react/icon';
import { DraftText, BLOCK_LABEL } from './cardBlocks';
import { PREVIZ_RESOLUTION, PLATE_STYLES, blockoutColorOf, plateIsStale } from '../../../utils/film/core/previz';

const { Text } = Typography;

export const PrevizContext = createContext({
  onPlan: null, onRenderPlate: null, onRenderAll: null, onToShotCard: null, onToBoard: null, onAllToBoard: null, onEditPlate: null, onPatchPreviz: null,
});

// THE PREVIZ PANEL — a page of plates, then dispatch. Previz decides STAGING, GEOGRAPHY,
// EYELINES, COVERAGE and TIMING; it never makes video and never decides look.
//
// The plates are DRAWINGS because the renderer is a text-to-image model: a pencil panel
// has no 3D scene it must stay faithful to, and panels are supposed to differ from one
// another. Promote any plate and a SHOT card makes the take — with the skill, the gates,
// the takes and the Take Library that the card already carries.
// The blockout palette, keyed by the names previz.plate.blockout uses. Same order and
// same names as the Mask tool, so a blockout plate and a masked frame read alike.
const SWATCH = {
  BLUE: '#3491fa', GREEN: '#00b42a', YELLOW: '#d9a406',
  RED: '#f53f3f', PURPLE: '#722ed1', ORANGE: '#ff7d00',
};

const KIND = {
  board: { label: 'PANEL', color: '#1d2129', fit: 'cover' },
  map: { label: 'MAP', color: '#b06f10', fit: 'contain' },
  character: { label: 'CHAR', color: '#722ed1', fit: 'contain' },
};

const PrevizNodeInner = ({ id, data, selected }) => {
  const { onPlan, onRenderPlate, onRenderAll, onToShotCard, onToBoard, onAllToBoard, onEditPlate, onPatchPreviz } = useContext(PrevizContext);
  const patch = (p) => onPatchPreviz && onPatchPreviz(id, p);
  const plan = data.plan || null;
  const plates = data.plates || [];
  const sheet = plan?.plates || [];
  const drawn = plates.filter((p) => p?.url).length;
  const anyLoading = plates.some((p) => p?.loading);
  const style = PLATE_STYLES.includes(data.plateStyle) ? data.plateStyle : PLATE_STYLES[0];
  const blockout = style === 'blockout';
  // What Draw all would actually do right now: missing plates PLUS panels left behind by
  // a style switch. When there is nothing pending the button becomes an explicit redraw,
  // because a dead button on a full page is the wrong answer to "do it again".
  const pending = sheet.filter((sh, i) => plateIsStale(sh, plates[i], style)).length;

  return (
    <div style={{ width: 700, background: '#fff', borderRadius: 10, border: `2px solid ${selected ? '#3491fa' : '#d9d9e3'}`, boxShadow: selected ? '0 0 0 3px rgba(52,145,250,0.14)' : '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <div style={{ height: 4, background: '#3491fa' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: '1px solid #e5e6eb' }}>
        <Text bold style={{ fontSize: 12 }}>Previz</Text>
        <Text type="secondary" style={{ fontSize: 10 }}>
          {sheet.length ? `${sheet.length} plate${sheet.length === 1 ? '' : 's'} · ${drawn} drawn` : 'staging, geography, coverage, timing'}
        </Text>
        <span style={{ flex: 1 }} />
        {data.busy && <Tag size="small" color="blue"><IconLoading style={{ marginRight: 3 }} />{data.step || 'working'}…</Tag>}
      </div>

      <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 660, overflowY: 'auto' }}>
        <div>
          <Text style={{ ...BLOCK_LABEL, color: '#86909c', display: 'block', marginBottom: 3 }}>SCENE</Text>
          <DraftText
            textarea value={data.brief} onCommit={(v) => patch({ brief: v })}
            placeholder="what happens in this scene — who is there, where, and what they are doing"
            autoSize={{ minRows: 2, maxRows: 6 }} style={{ fontSize: 11 }}
          />
        </div>

        <Button
          size="small" long type="primary" icon={<IconPlayArrow />}
          loading={!!data.busy} disabled={!onPlan || !String(data.brief || '').trim()}
          style={{ background: '#b06f10', borderColor: '#b06f10' }}
          onClick={() => onPlan && onPlan(id)}
          title="One reasoner call: the staging, the action axis, the subjects and the whole plate page. No pixels."
        >{plan ? 'Re-plan the page' : 'Plan the page'}</Button>

        {data.error && <Text style={{ fontSize: 10, color: '#f53f3f' }}>{data.error}</Text>}

        {plan && (
          <>
            {/* The legend, and the only plan text the panel shows. The staging and the
                axis still govern every plate (the map renders them, the panels are drawn
                against them) — they are just not something anyone reads off the card. */}
            {(plan.subjects || []).length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {plan.subjects.map((s, i) => (
                  <Tag
                    key={`${s.name}-${i}`} size="small" title={s.description}
                    style={blockout
                      ? { background: SWATCH[blockoutColorOf(i)], color: '#fff', border: 'none' }
                      : { background: '#f2f3f5', color: '#4e5969', border: 'none' }}
                  >
                    {s.name || s.description.slice(0, 20)}
                  </Tag>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ ...BLOCK_LABEL, color: '#86909c' }}>PLATES</Text>
              <span style={{ flex: 1 }} />
              <Select
                size="mini" value={style} onChange={(v) => patch({ plateStyle: v })}
                options={[
                  { label: 'Pencil', value: 'pencil' },
                  { label: 'Colour blocks', value: 'blockout' },
                  { label: 'Clay render', value: 'clay' },
                ]}
                style={{ width: 118 }}
                title="Three ways to draw the same plan. Pencil reads like a storyboard — composition. Colour blocks are flat coloured masses on grey geometry — the strongest Seedance reference, and no light at all. Clay is an untextured grey maquette render, and the only style that shows the LIGHTING: key direction, cast shadows, falloff and form."
              />
              <Button
                size="mini" icon={anyLoading ? <IconLoading /> : <IconCamera />}
                disabled={!onRenderAll || anyLoading || !sheet.length}
                onClick={() => onRenderAll && onRenderAll(id, { all: !pending })}
                title={pending
                  ? `Draw the ${pending} plate${pending === 1 ? '' : 's'} that ${pending === 1 ? 'is' : 'are'} missing or left behind by the style switch — character plates first, so the panels can reference them`
                  : 'Every plate is current — draw the whole page again from scratch'}
              >{pending ? `Draw all (${pending})` : 'Redraw all'}</Button>
              <Button
                size="mini" icon={<IconLaunch />} disabled={!onAllToBoard || !drawn}
                onClick={() => onAllToBoard && onAllToBoard(id)}
                title="Copy every drawn plate onto the board as an ordinary image — editable, maskable, taggable into the bible, attachable to any card"
              >To board</Button>
            </div>

            {/* THE PAGE — read left to right, top to bottom, like a storyboard sheet. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {sheet.map((sh, i) => {
                const plate = plates[i] || {};
                const kind = KIND[sh.kind] || KIND.board;
                return (
                  <div key={i} style={{ border: '1px solid #e5e6eb', borderRadius: 6, background: '#fcfcfd', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <div
                      onClick={() => {
                        if (plate.loading) return;
                        if (plate.url) { if (onEditPlate) onEditPlate(id, i); return; }
                        if (onRenderPlate) onRenderPlate(id, i);
                      }}
                      title={plate.url ? 'Click to edit this plate — the full frame editor, with references and pencil marks. ↻ redraws it from scratch.' : 'Click to draw this plate'}
                      style={{ position: 'relative', height: 88, background: '#eff1f4', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                    >
                      {plate.loading ? <IconLoading style={{ color: '#3491fa' }} />
                        : plate.url ? <img src={plate.cacheUrl || plate.url} alt="" style={{ width: '100%', height: '100%', objectFit: kind.fit }} />
                          : <Text style={{ fontSize: 9, color: '#a9aeb8' }}>draw</Text>}
                      <span style={{ position: 'absolute', top: 3, left: 3, fontSize: 8, fontWeight: 700, letterSpacing: 0.4, padding: '0 4px', borderRadius: 3, background: kind.color, color: '#fff' }}>{kind.label}</span>
                    </div>
                    <div style={{ padding: '4px 5px', display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                      <Text style={{ fontSize: 9.5, fontWeight: 700, color: '#1d2129' }} ellipsis={{ rows: 1 }}>{i + 1}. {sh.title || sh.kind}</Text>
                      {sh.caption && <Text style={{ fontSize: 9, color: '#86909c', lineHeight: 1.3 }} ellipsis={{ rows: 2 }}>{sh.caption}</Text>}
                      {plate.error && <Text style={{ fontSize: 8.5, color: '#f53f3f' }} ellipsis={{ rows: 2 }}>{plate.error}</Text>}
                      <span style={{ flex: 1 }} />
                      {/* ONE primary action, and it is whatever the plate needs next:
                          an undrawn plate can only be DRAWN, so offering SHOT beside it
                          is a dead button. Once it is drawn, SHOT takes the slot and
                          re-drawing steps aside into the icon. */}
                      <div style={{ display: 'flex', gap: 3 }}>
                        {plate.url ? (
                          <>
                            <Button
                              size="mini" icon={<IconRefresh />} loading={!!plate.loading} disabled={!onRenderPlate}
                              onClick={() => onRenderPlate && onRenderPlate(id, i)}
                              style={{ padding: '0 4px', minWidth: 0 }}
                              title="Draw it again"
                            />
                            <Button
                              size="mini" icon={<IconLaunch />} disabled={!onToBoard}
                              onClick={() => onToBoard && onToBoard(id, i)}
                              style={{ padding: '0 4px', minWidth: 0 }}
                              title="Copy this plate onto the board as an ordinary image — the plate stays on the page"
                            />
                            <Button
                              size="mini" type="primary" icon={<IconVideoCamera />}
                              disabled={!onToShotCard}
                              style={{ background: '#b06f10', borderColor: '#b06f10', flex: 1, padding: 0, fontSize: 9, minWidth: 0 }}
                              onClick={() => (onToShotCard ? onToShotCard(id, i) : Message.warning('not wired'))}
                              title={sh.kind === 'board'
                                ? `Lay a SHOT card from this panel — ${PREVIZ_RESOLUTION}, the panel pinned as its opening frame, camera and action pre-filled`
                                : `Lay a SHOT card with this plate as a reference — ${PREVIZ_RESOLUTION}`}
                            >SHOT</Button>
                          </>
                        ) : (
                          <Button
                            size="mini" type="primary" icon={<IconCamera />}
                            loading={!!plate.loading} disabled={!onRenderPlate}
                            style={{ background: '#4e5969', borderColor: '#4e5969', flex: 1, padding: 0, fontSize: 9 }}
                            onClick={() => onRenderPlate && onRenderPlate(id, i)}
                            title={sh.draw || 'Draw this plate'}
                          >Draw</Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {plan.look && (
              <Text style={{ fontSize: 10, color: '#86909c' }} title="Rides to the SHOT card; never drawn on a plate">
                look · {plan.look}
              </Text>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default memo(PrevizNodeInner);
