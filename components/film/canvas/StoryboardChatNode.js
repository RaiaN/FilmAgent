import { createContext, memo, useContext, useMemo, useState } from 'react';
import { Button, Typography, Select, Popconfirm, Input } from '@arco-design/web-react';
import { IconMessage, IconPlus, IconBulb } from '@arco-design/web-react/icon';
import { imageRefCap, IMAGE_MODEL_OPTIONS, imageModelKeyOf } from '../../../utils/film/suiteConfig';

const { Text } = Typography;

// Bridge from the chat node back to FilmCanvas's handlers (functions can't live in
// serializable node.data).
export const StoryboardChatContext = createContext({
  onDivide: null, onSceneLocations: null, onSetSceneLocation: null, locationPlates: [], onListAction: null, bibleEntries: [], onToggleBibleRef: null, onRemoveRef: null, onRenderAll: null, onRenderSheet: null, onCastFromScript: null, onPatchChat: null, onOpenRefDrawer: null,
});

// Same role palette as the SHOT card's reference chips.
const ROLE_COLOR = { character: '#722ed1', location: '#00b42a', prop: '#ff7d00', frame: '#f5319d' };
const ACCENT = '#b06f10';
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

const Label = ({ children, right }) => (
  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
    <Text style={{ flex: 1, fontSize: 10, fontWeight: 700, color: '#86909c', letterSpacing: 0.5 }}>{children}</Text>
    {right}
  </div>
);

// The Storyboard agent's CONTROL CARD, bound to its strip (1 row = 1 key moment).
// Script → Find key moments → the strip. The card holds the inputs (script, reference
// pool, the plate for each place) and the batch actions; the moments live on the strip.
const StoryboardChatNodeInner = ({ id, data, selected }) => {
  const { onDivide, onSceneLocations, onSetSceneLocation, locationPlates = [], bibleEntries, onToggleBibleRef, onRemoveRef, onRenderAll, onRenderSheet, onCastFromScript, onPatchChat, onOpenRefDrawer } = useContext(StoryboardChatContext);
  const count = (data.shots || []).length;
  const pool = useMemo(() => (data.refs || []).map(asRef).filter((r) => r.url), [data.refs]);
  const places = useMemo(() => (onSceneLocations ? onSceneLocations(id) : []), [onSceneLocations, id, data.places, data.sceneLocations, bibleEntries]);
  const cap = imageRefCap(data.imageModel);
  const bible = bibleEntries || [];
  const find = (
    <Button
      long type="primary" icon={<IconBulb />} loading={!!data.busy}
      onClick={count ? undefined : () => onDivide && onDivide(id)}
      style={{ background: ACCENT, borderColor: ACCENT, height: 34, fontWeight: 600 }}
    >
      {data.busy ? 'Finding key moments…' : count ? 'Find key moments again' : 'Find key moments'}
    </Button>
  );
  return (
    <div style={{ width: 460, background: '#fff', borderRadius: 12, border: `2px solid ${selected ? '#4e5969' : '#e5e6eb'}`, boxShadow: selected ? '0 0 0 3px rgba(78,89,105,0.12)' : '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid #f2f3f5' }}>
        <IconMessage style={{ color: '#4e5969', fontSize: 15 }} />
        <Text bold style={{ fontSize: 14, flex: 1 }}>Storyboard</Text>
        {count > 0 && <Text type="secondary" style={{ fontSize: 12 }}>{count} key moment{count === 1 ? '' : 's'}</Text>}
      </div>

      <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()} style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Label>SCRIPT</Label>
          <DraftArea
            value={data.script}
            onCommit={(v) => onPatchChat && onPatchChat(id, { script: v })}
            placeholder="Type or paste the script…"
            autoSize={{ minRows: 3, maxRows: 10 }}
            style={{ fontSize: 12, lineHeight: 1.5 }}
          />
        </div>

        {/* THE REFERENCE POOL — pool order IS the [Image N] numbering the moments use. */}
        <div>
          <Label right={onCastFromScript && <Text onClick={() => onCastFromScript(id)} style={{ fontSize: 11, color: ACCENT, cursor: 'pointer', fontWeight: 600 }}>Cast & World ›</Text>}>
            REFERENCES{pool.length ? ` · ${pool.length}` : ''}
          </Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {pool.map((r, i) => {
              const b = bible.find((x) => (r.entryId && x.id === r.entryId) || x.url === r.url);
              const color = b ? (ROLE_COLOR[b.role] || '#86909c') : '#c9cdd4';
              const name = b ? (b.name || b.role) : (r.label || 'ref');
              return (
                <span
                  key={r.url}
                  onClick={() => (b ? onToggleBibleRef && onToggleBibleRef(id, b) : onRemoveRef && onRemoveRef(id, r.url))}
                  title={`[Image ${i + 1}] ${name} — click to remove${i + 1 > cap ? ' (over this image model\'s reference cap — not sent)' : ''}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', padding: '2px 8px 2px 2px', borderRadius: 12, fontSize: 11, border: `1px solid ${color}`, color: '#1d2129', background: '#fff', opacity: i + 1 > cap ? 0.45 : 1 }}
                >
                  <img src={b?.url || r.url} alt="" loading="lazy" decoding="async" style={{ width: 20, height: 20, borderRadius: 10, objectFit: 'cover' }} />
                  {name.slice(0, 16)}
                </span>
              );
            })}
            {onOpenRefDrawer && (
              <span
                onClick={() => onOpenRefDrawer({ type: 'sbpool', id })}
                title="Add references"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, cursor: 'pointer', borderRadius: 13, border: '1px dashed #86909c', color: '#86909c' }}
              >
                <IconPlus style={{ fontSize: 12 }} />
              </span>
            )}
          </div>
        </div>

        {count && onDivide
          ? <Popconfirm title={`Replace the ${count} key moment${count === 1 ? '' : 's'} and their stills?`} okText="Replace" cancelText="Cancel" onOk={() => onDivide(id)}>{find}</Popconfirm>
          : find}

        {/* THE SETTING — one location plate per place the moments name; every moment at
            that place renders against it. Unmatched stays unbound, never guessed. */}
        {places.length > 0 && (
          <div>
            <Label>PLACES</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {places.map((pl) => (
                <div key={pl.n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 12, flex: 1, minWidth: 0 }} ellipsis>{pl.slug}</Text>
                  <Select
                    size="small" allowClear showSearch
                    placeholder={locationPlates.length ? 'No plate' : 'No location plates'}
                    disabled={!locationPlates.length}
                    value={pl.plate?.id || undefined}
                    onChange={(v) => onSetSceneLocation(id, pl.n, v || '')}
                    status={locationPlates.length && !pl.plate ? 'warning' : undefined}
                    style={{ width: 170, flexShrink: 0 }}
                    options={locationPlates.map((p) => ({ label: p.name || 'location', value: p.id }))}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STILLS — the moments drawn: one still per row, or one page of panels. */}
        {count > 0 && (onRenderAll || onRenderSheet) && (
          <div style={{ display: 'flex', gap: 6, paddingTop: 12, borderTop: '1px solid #f2f3f5' }}>
            <Select
              size="small"
              value={imageModelKeyOf(data.imageModel)}
              onChange={(v) => onPatchChat && onPatchChat(id, { imageModel: v })}
              style={{ flex: 1, minWidth: 0 }}
              options={IMAGE_MODEL_OPTIONS.map((m) => ({ label: m.label, value: m.key }))}
            />
            {onRenderAll && <Button size="small" onClick={() => onRenderAll(id)} title="A still for every row without one">Render stills</Button>}
            {onRenderSheet && <Button size="small" onClick={() => onRenderSheet(id)} title="One page with a panel per key moment">Quick storyboard</Button>}
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(StoryboardChatNodeInner);
