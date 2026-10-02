import { createContext, memo, useContext } from 'react';
import { Typography, Button, Tag, Select, Dropdown, Menu } from '@arco-design/web-react';
import { IconLoading, IconPlayArrow, IconRefresh, IconEdit, IconVideoCamera } from '@arco-design/web-react/icon';
import { DraftText, BLOCK_LABEL } from './cardBlocks';
import { PLATE_STYLES, ANIMATIC_MODEL, totalSecondsOf } from '../../../utils/film/core/previz';
import { draftFinalsOf, maxShotSeconds } from '../../../utils/film/suiteConfig';

const { Text } = Typography;

export const PrevizContext = createContext({
  onPlan: null, onDrawSchematic: null, onPatchPreviz: null, onEditSchematic: null, onAnimatic: null, onFinal: null, onPlay: null, onToCut: null, onOpenTakes: null,
});

// THE PREVIZ CARD — block the scene, see it move. Scene words → a plan (set, actors, who
// moves where, cameras, timing) → a top-down SCHEMATIC (edit it like any image) → an
// ANIMATIC: Seedance reads the schematic and moves the blockout, cut by the cameras.
const SWATCH = {
  BLUE: '#3491fa', GREEN: '#00b42a', YELLOW: '#d9a406',
  RED: '#f53f3f', PURPLE: '#722ed1', ORANGE: '#ff7d00',
};
const STYLE_LABEL = { pencil: 'Pencil', blockout: 'Colour blocks', clay: 'Clay' };

const PrevizNodeInner = ({ id, data, selected }) => {
  const { onPlan, onDrawSchematic, onPatchPreviz, onEditSchematic, onAnimatic, onFinal, onPlay, onToCut, onOpenTakes } = useContext(PrevizContext);
  const patch = (p) => onPatchPreviz && onPatchPreviz(id, p);
  // A plan from the old page-of-plates Previz has no shots — treat it as unplanned.
  const plan = Array.isArray(data.plan?.shots) ? { ...data.plan, actors: data.plan.actors || [], set: data.plan.set || [] } : null;
  const legacy = !!data.plan && !plan;
  const schem = data.schematic || {};
  const anim = data.animatic || null;
  const style = PLATE_STYLES.includes(data.plateStyle) ? data.plateStyle : 'blockout';
  const total = totalSecondsOf(plan);
  const maxS = maxShotSeconds(ANIMATIC_MODEL);
  const finals = draftFinalsOf(ANIMATIC_MODEL);

  return (
    <div style={{ width: 720, background: '#fff', borderRadius: 10, border: `2px solid ${selected ? '#3491fa' : '#d9d9e3'}`, boxShadow: selected ? '0 0 0 3px rgba(52,145,250,0.14)' : '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <div style={{ height: 4, background: '#3491fa' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: '1px solid #e5e6eb' }}>
        <Text bold style={{ fontSize: 12 }}>Previz</Text>
        <Text type="secondary" style={{ fontSize: 10 }}>
          {plan ? `${plan.actors.length} actor${plan.actors.length === 1 ? '' : 's'} · ${total}s` : 'blocking schematic → animatic'}
        </Text>
        <span style={{ flex: 1 }} />
        {(data.busy || data.animaticBusy) && <Tag size="small" color="blue"><IconLoading style={{ marginRight: 3 }} />{data.busy ? `${data.step || 'working'}…` : 'animatic rendering…'}</Tag>}
      </div>

      <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 900, overflowY: 'auto' }}>
        <div>
          <Text style={{ ...BLOCK_LABEL, color: '#86909c', display: 'block', marginBottom: 3 }}>SCENE</Text>
          <DraftText
            textarea value={data.brief} onCommit={(v) => patch({ brief: v })}
            placeholder="what happens in this scene — who is there, where, who moves where"
            autoSize={{ minRows: 2, maxRows: 6 }} style={{ fontSize: 11 }}
          />
        </div>
        <Button
          size="small" long type="primary" icon={<IconPlayArrow />}
          loading={!!data.busy} disabled={!onPlan || !String(data.brief || '').trim()}
          style={{ background: '#b06f10', borderColor: '#b06f10' }}
          onClick={() => onPlan && onPlan(id)}
          title="Block the scene (set, actors, who moves where, cameras, timing), then draw it as a top-down schematic"
        >{plan ? 'Re-block the scene' : 'Block the scene'}</Button>
        {data.error && <Text style={{ fontSize: 10, color: '#f53f3f' }}>{data.error}</Text>}
        {legacy && <Text style={{ fontSize: 10, color: '#d25f00' }}>This card was planned with the old page-of-plates Previz. Block the scene again to get the schematic and animatic.</Text>}

        {plan && (
          <>
            {/* THE SCHEMATIC — the floor plan everything else follows. */}
            <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#f7f8fa', border: '1px solid #e5e6eb', aspectRatio: '16 / 9', display: 'grid', placeItems: 'center' }}>
              {schem.url
                ? <img src={schem.cacheUrl || schem.url} alt="Previz schematic" onClick={() => onEditSchematic && onEditSchematic(id)} style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'pointer', opacity: schem.loading ? 0.45 : 1 }} title="Click to edit — write a change or draw on it" />
                : <Text type="secondary" style={{ fontSize: 11 }}>{schem.loading ? 'Drawing the schematic…' : 'No schematic yet'}</Text>}
              {schem.loading && schem.url && <IconLoading style={{ position: 'absolute', fontSize: 22, color: '#3491fa' }} />}
              <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                {schem.url && <Button size="mini" icon={<IconEdit />} disabled={!!schem.loading} onClick={() => onEditSchematic && onEditSchematic(id)}>Edit</Button>}
                <Button size="mini" icon={<IconRefresh />} loading={!!schem.loading} onClick={() => onDrawSchematic && onDrawSchematic(id)} title="Draw the schematic again from the plan (replaces your edits)">{schem.url ? 'Redraw' : 'Draw'}</Button>
              </div>
            </div>
            {schem.error && <Text style={{ fontSize: 10, color: '#f53f3f' }}>{schem.error}</Text>}

            {/* THE COLOUR KEY — circle on the plan = figure in the animatic. */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {plan.actors.map((a) => (
                <Tag key={a.name} size="small" title={a.description} style={{ background: SWATCH[a.color] || '#86909c', color: '#fff', border: 'none' }}>{a.name}</Tag>
              ))}
            </div>

            {/* THE ANIMATIC */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingTop: 4, borderTop: '1px solid #f2f3f5' }}>
              <Text style={{ ...BLOCK_LABEL, color: '#86909c' }}>ANIMATIC</Text>
              {anim?.takeId && <Button size="mini" icon={<IconPlayArrow />} onClick={() => onOpenTakes && onOpenTakes(id)} title="Every animatic of this card in the Take Library — open any one in the take viewer">Animatics</Button>}
              <Select
                size="mini" value={style} onChange={(v) => patch({ plateStyle: v })} style={{ width: 120 }}
                options={PLATE_STYLES.map((v) => ({ label: STYLE_LABEL[v], value: v }))}
                title="How the animatic looks: pencil line animation, flat colour-block mannequins, or a lit clay render"
              />
              <span style={{ flex: 1 }} />
              <Button
                size="mini" type="primary" icon={<IconVideoCamera />} loading={!!data.animaticBusy}
                disabled={!onAnimatic || !schem.url || total > maxS}
                onClick={() => onAnimatic && onAnimatic(id)}
                title="Seedance 2.5 reads the schematic and moves the blockout through the shots — a cheap 480p draft, no audio"
                style={{ background: '#165dff', borderColor: '#165dff' }}
              >{anim ? 'New animatic' : 'Make animatic'}</Button>
              {anim?.taskId && finals.length > 0 && (
                <Dropdown trigger="click" position="br" droplist={<Menu onClickMenuItem={(res) => onFinal && onFinal(id, res)}>{finals.map((r) => <Menu.Item key={r}>Final {r}</Menu.Item>)}</Menu>}>
                  <Button size="mini" disabled={!!data.animaticBusy} title="Finish the latest animatic draft at full resolution">Final ▾</Button>
                </Dropdown>
              )}
            </div>
            <div>
              <Text style={{ ...BLOCK_LABEL, color: '#86909c', display: 'block', marginBottom: 3 }}>HOW TO CORRECT</Text>
              <DraftText
                textarea value={data.animaticNote} onCommit={(v) => patch({ animaticNote: v })}
                placeholder="what the next animatic must do differently — e.g. she reaches the table before he turns; the camera stays behind the counter"
                autoSize={{ minRows: 1, maxRows: 4 }} style={{ fontSize: 11 }}
              />
            </div>
            {data.animaticError && <Text style={{ fontSize: 10, color: '#f53f3f' }}>{data.animaticError}</Text>}
            {anim?.takeId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button size="small" icon={<IconPlayArrow />} onClick={() => onPlay && onPlay(id)}>Play {anim.label || 'animatic'}</Button>
                <Text type="secondary" style={{ fontSize: 10 }}>{STYLE_LABEL[anim.style] || ''}{anim.final ? ` · ${anim.final}` : ' · 480p draft'}</Text>
                <span style={{ flex: 1 }} />
                <Button size="small" type="primary" loading={!!data.cutBusy} onClick={() => onToCut && onToCut(id)} style={{ background: '#b06f10', borderColor: '#b06f10' }} title="One CUT card that rides this animatic as its motion reference; its prompt is written by watching the animatic (the real scene, not the blockout look)">To CUT card</Button>
              </div>
            )}

            {plan.look && <Text style={{ fontSize: 10, color: '#86909c' }} title="Rides to the SHOT cards; the animatic stays a blockout">look · {plan.look}</Text>}
          </>
        )}
      </div>
    </div>
  );
};

export default memo(PrevizNodeInner);
