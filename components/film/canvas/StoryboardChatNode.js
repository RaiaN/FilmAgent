import { createContext, memo, useContext, useMemo, useState } from 'react';
import { Button, Typography, Select, Popconfirm, Input } from '@arco-design/web-react';
import { IconMessage, IconPlus, IconPlayArrow, IconLoading } from '@arco-design/web-react/icon';
import { imageRefCap, imageTraits, IMAGE_MODEL_OPTIONS, imageModelKeyOf } from '../../../utils/film/suiteConfig';
import { parseScenes } from '../../../utils/film/core/storyboard';

const { Text } = Typography;

// Bridge from the chat node back to FilmCanvas's handlers (functions can't live in
// serializable node.data).
export const StoryboardChatContext = createContext({
  onDivide: null, onNormalize: null, onSceneLocations: null, onSetSceneLocation: null, locationPlates: [], onListAction: null, bibleEntries: [], onToggleBibleRef: null, onRemoveRef: null, onRenderAll: null, onRenderSheet: null, onCastFromScript: null, onPatchChat: null, onOpenRefDrawer: null,
});

// Same role palette as the SHOT card's reference chips.
const ROLE_COLOR = { character: '#722ed1', location: '#00b42a', prop: '#ff7d00', frame: '#f5319d' };
const REF_BADGE = { fontSize: 9, background: 'rgba(0,0,0,0.28)', borderRadius: 8, padding: '0 4px' };
const asRef = (r) => (typeof r === 'string' ? { url: r, label: '' } : (r || {}));

// Blur-commit draft: routing keystrokes through the RF store echoes the value back a
// beat late and resets the caret.
const DraftArea = ({ value, onCommit, ...rest }) => {
  const [draft, setDraft] = useState(null);
  return (
    <Input.TextArea
      {...rest}
      value={draft !== null ? draft : (value || '')}
      onChange={(v) => setDraft(v)}
      onFocus={() => setDraft(value || '')}
      onBlur={() => { if (draft !== null && draft !== (value || '')) onCommit(draft); setDraft(null); }}
    />
  );
};

const Section = ({ label, children, style }) => (
  <div style={{ background: '#f7f8fa', border: '1px solid #eceff3', borderRadius: 6, padding: 6, ...style }}>
    <Text style={{ display: 'block', fontSize: 9, fontWeight: 700, color: '#86909c', letterSpacing: 0.4, marginBottom: 4 }}>{label}</Text>
    {children}
  </div>
);

// The Storyboard agent's CONTROL CARD, bound to its strip (1 row = 1 shot). ONE
// pipeline, no dropdowns: SCRIPT → Normalize (screenplay = film's canonical IR,
// the story-level HITL gate, edited as text) → Create shot list (scene-aware carve).
// Surgery lives ON the surfaces: the screenplay text here, shot rows on the strip.
const StoryboardChatNodeInner = ({ id, data, selected }) => {
  const { onDivide, onNormalize, onSceneLocations, onSetSceneLocation, locationPlates = [], bibleEntries, onToggleBibleRef, onRemoveRef, onRenderAll, onRenderSheet, onCastFromScript, onPatchChat, onOpenRefDrawer } = useContext(StoryboardChatContext);
  const count = (data.shots || []).length;
  const [refsOpen, setRefsOpen] = useState(true);
  const pool = useMemo(() => (data.refs || []).map(asRef).filter((r) => r.url), [data.refs]);
  const scenes = useMemo(() => parseScenes(data.screenplay).length, [data.screenplay]);
  const sceneBindings = useMemo(() => (onSceneLocations ? onSceneLocations(id) : []), [onSceneLocations, id, data.screenplay, data.sceneLocations, bibleEntries]);
  const cap = imageRefCap(data.imageModel);
  const bible = bibleEntries || [];
  return (
    <div style={{ width: 460, display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 10, border: `2px solid ${selected ? '#4e5969' : '#d9d9e3'}`, boxShadow: selected ? '0 0 0 3px rgba(78,89,105,0.12)' : '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <div style={{ height: 4, background: '#4e5969' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid #f2f3f5' }}>
        <IconMessage style={{ color: '#4e5969', fontSize: 14 }} />
        <Text bold style={{ fontSize: 12, flex: 1 }} ellipsis>Storyboard · shot division</Text>
        {count > 0 && <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{count} {count === 1 ? 'shot' : 'shots'}</Text>}
      </div>
      {/* SCRIPT — the storyboard's own source text, verbatim. */}
      <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()} style={{ padding: '6px 8px 0', flexShrink: 0 }}>
        <Section label="SCRIPT">
          <DraftArea
            value={data.script}
            onCommit={(v) => onPatchChat && onPatchChat(id, { script: v })}
            placeholder="type or paste the scene / script here…"
            autoSize={{ minRows: 2, maxRows: 8 }}
            style={{ fontSize: 11 }}
          />
        </Section>
      </div>
      {/* SCREENPLAY — film's canonical IR, the HITL gate; edited as text, carved scene-aware. */}
      {onNormalize && (
        <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()} style={{ padding: '6px 8px 0', flexShrink: 0 }}>
          <Section label={`SCREENPLAY${scenes ? ` · ${scenes} scene${scenes === 1 ? '' : 's'}` : ''}`}>
            {!String(data.screenplay || '').trim() ? (
              <Button
                size="small" long loading={!!data.busy}
                disabled={!String(data.script || '').trim()}
                onClick={() => onNormalize(id)}
                title={String(data.script || '').trim()
                  ? 'Convert the script to screenplay format — sluglines, action lines, dialogue verbatim, nothing invented (unstated slug fields say UNSTATED). 1 reasoner call; a pasted screenplay carries verbatim for free.'
                  : 'Type the script above first'}
              >
                Normalize — draft the screenplay (1 call · free if already one)
              </Button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <DraftArea
                  value={data.screenplay}
                  onCommit={(v) => onPatchChat(id, { screenplay: v })}
                  autoSize={{ minRows: 4, maxRows: 16 }}
                  style={{ fontSize: 10.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                />
                <div style={{ display: 'flex', gap: 4 }}>
                  <Popconfirm title="Throw away this screenplay (and your edits) and re-normalize the script from scratch?" okText="Re-normalize" onOk={() => onNormalize(id)}>
                    <Button size="mini" status="warning" loading={!!data.busy} style={{ flex: 1 }}>Re-normalize</Button>
                  </Popconfirm>
                </div>
                {/* THE SETTING per scene. Every shot in a scene renders against the same
                    location plate — without it each still invents its own version of the
                    place. Auto-matched from the slugline; unmatched stays UNBOUND (never
                    guessed) and the strip rows say so. */}
                {sceneBindings.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                    <Text style={{ fontSize: 9, fontWeight: 700, color: '#86909c' }}>SETTING — one location plate per scene</Text>
                    {sceneBindings.map((sc) => (
                      <div key={sc.n} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Text style={{ fontSize: 9, color: '#86909c', width: 20, flexShrink: 0 }}>{sc.n}.</Text>
                        <Text style={{ fontSize: 9, color: '#4e5969', flex: 1, minWidth: 0 }} ellipsis>{sc.slug}</Text>
                        <Select
                          size="mini" placeholder={locationPlates.length ? '⚠ unbound' : 'no location plates'} allowClear showSearch
                          disabled={!locationPlates.length}
                          value={sc.plate?.id || undefined}
                          onChange={(v) => onSetSceneLocation(id, sc.n, v || '')}
                          style={{ width: 132, flexShrink: 0 }}
                          title={sc.plate ? `Every shot in this scene renders against "${sc.plate.name}"` : 'No plate bound — these shots each invent their own version of the place'}
                          options={locationPlates.map((p) => ({ label: p.name || 'location', value: p.id }))}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {count > 0 ? (
                  <Popconfirm title={`Throw away the current ${count}-shot list (and its authored text) and re-carve from this screenplay?`} okText="Create" onOk={() => onDivide && onDivide(id, { fresh: true })}>
                    <Button size="small" long type="primary" icon={<IconPlayArrow />} loading={!!data.busy} style={{ background: '#b06f10', borderColor: '#b06f10' }} title="Re-carve the strip from the approved screenplay — 1 + N reasoner calls">
                      {data.busy ? 'Creating…' : `Create shot list — ${scenes} scene${scenes === 1 ? '' : 's'}`}
                    </Button>
                  </Popconfirm>
                ) : (
                  <Button size="small" long type="primary" icon={<IconPlayArrow />} loading={!!data.busy} onClick={() => onDivide && onDivide(id, { fresh: true })} style={{ background: '#b06f10', borderColor: '#b06f10' }} title="Carve the approved screenplay into shot rows (a shot never spans scenes) — words only, stills are separate taps. 1 + N reasoner calls.">
                    {data.busy ? 'Creating…' : `Create shot list — ${scenes} scene${scenes === 1 ? '' : 's'}`}
                  </Button>
                )}
              </div>
            )}
          </Section>
        </div>
      )}
      {/* REFERENCE POOL — pool order IS the [Image N] numbering the division uses. */}
      <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()} style={{ padding: '5px 8px', borderBottom: '1px solid #f2f3f5', maxHeight: refsOpen ? 216 : 22, overflowY: 'auto', flexShrink: 0 }}>
        <Text onClick={() => setRefsOpen((v) => !v)} title={refsOpen ? 'Collapse the reference pool' : 'Expand the reference pool'} style={{ color: '#86909c', fontSize: 9, fontWeight: 700, display: 'block', marginBottom: 3, cursor: 'pointer', userSelect: 'none' }}>
          {refsOpen ? '▾' : '▸'} REFERENCES → [Image1…{Math.min(pool.length, cap) || 'N'}] · {pool.length} in pool · click to toggle
        </Text>
        <div style={{ display: refsOpen ? 'flex' : 'none', flexWrap: 'wrap', gap: 4 }}>
          {pool.map((r, i) => {
            const b = bible.find((x) => (r.entryId && x.id === r.entryId) || x.url === r.url);
            const nIdx = i + 1;
            const sent = nIdx <= cap;
            const color = b ? (ROLE_COLOR[b.role] || '#86909c') : '#e5e6eb';
            return (
              <span
                key={r.url}
                onClick={() => (b ? onToggleBibleRef && onToggleBibleRef(id, b) : onRemoveRef && onRemoveRef(id, r.url))}
                title={`${b ? (b.name || b.role) : (r.label || 'reference')} — [Image ${nIdx}] in the pool; click to remove`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                  padding: '1px 6px', borderRadius: 10, fontSize: 10,
                  border: `1px solid ${b ? color : '#e5e6eb'}`,
                  background: b ? color : '#e5e6eb',
                  color: b ? '#fff' : '#1d2129',
                }}
              >
                {sent && <b style={REF_BADGE}>{nIdx}</b>}
                {(b?.url || r.url) ? <img src={b?.url || r.url} alt="" loading="lazy" decoding="async" style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} /> : null}
                {(b ? (b.name || b.role) : (r.label || 'ref')).slice(0, 14)}
              </span>
            );
          })}
          {onOpenRefDrawer && (
            <span
              onClick={() => onOpenRefDrawer({ type: 'sbpool', id })}
              title="Browse the reference library — search + role tabs; toggle cast/world plates and board images into the pool"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer',
                padding: '1px 8px', borderRadius: 10, fontSize: 10,
                border: '1px dashed #86909c', color: '#86909c',
              }}
            >
              <IconPlus style={{ fontSize: 10 }} /> Add references
            </span>
          )}
        </div>
        {refsOpen && pool.length > cap && (
          <Text style={{ color: '#ff7d00', fontSize: 9, display: 'block', marginTop: 2 }}>
            first {cap} ride per render ({imageTraits(data.imageModel).shortLabel} reference cap)
          </Text>
        )}
      </div>
      {/* Cast & World — plates drafted from this script land as pool chips above. */}
      {onCastFromScript && (
        <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ padding: '6px 8px 0', flexShrink: 0 }}>
          <Section label="REFERENCES">
            <Button
              size="small" long
              onClick={() => onCastFromScript(id)}
              style={{ background: '#b06f10', borderColor: '#b06f10', color: '#fff' }}
              title="Opens the Cast & World panel with this storyboard's script prefilled (verbatim) — pick Lite/Pro and ethnicity there, then Run."
            >
              Cast & World — generate reference plates
            </Button>
          </Section>
        </div>
      )}
      {/* STORYBOARDING — batch stills; Quick Storyboard also works pre-division. */}
      {(onRenderAll || onRenderSheet) && (
        <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ padding: '6px 8px', borderBottom: '1px solid #f2f3f5', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Section label="STORYBOARDING">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Text style={{ fontSize: 10, color: '#86909c', flexShrink: 0 }}>Image model</Text>
            <Select
              size="mini"
              value={imageModelKeyOf(data.imageModel)}
              onChange={(v) => onPatchChat && onPatchChat(id, { imageModel: v })}
              style={{ flex: 1 }}
              title="The engine every still on this strip renders with. Switching never re-renders anything by itself."
              options={IMAGE_MODEL_OPTIONS.map((m) => ({ label: m.label, value: m.key }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
            {count > 0 && onRenderAll && (
              <Button
                size="small" icon={<IconPlayArrow />} type="primary" style={{ flex: 1, background: '#b06f10', borderColor: '#b06f10' }}
                onClick={() => onRenderAll(id)}
                title="Render a still for every row that doesn't have one yet — rows with stills are left alone"
              >
                Render all stills
              </Button>
            )}
            {onRenderSheet && (
              <>
                <Button
                  size="small" style={{ flex: 1, background: '#b06f10', borderColor: '#b06f10', color: '#fff' }}
                  onClick={() => onRenderSheet(id)}
                  title="Quick Storyboard — ONE image of numbered panels, landing below this card. Pre-division it renders from the script; after, from the shot list."
                >
                  Quick Storyboard
                </Button>
                <Select
                  size="small"
                  value={data.sheetPanels || 0}
                  onChange={(v) => onPatchChat && onPatchChat(id, { sheetPanels: v })}
                  style={{ width: 100, flexShrink: 0, background: '#fff' }}
                  title="How many panels the page holds — fewer than the shot count = deterministic sampling"
                  options={[
                    { label: 'All panels', value: 0 },
                    { label: '6 panels', value: 6 },
                    { label: '8 panels', value: 8 },
                    { label: '12 panels', value: 12 },
                    { label: '15 panels', value: 15 },
                  ]}
                />
              </>
            )}
          </div>
          </Section>
        </div>
      )}
      {data.busy && (
        <Text style={{ fontSize: 10, color: '#165dff', padding: '4px 10px' }}><IconLoading /> working…</Text>
      )}
    </div>
  );
};

export default memo(StoryboardChatNodeInner);
