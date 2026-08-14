import { createContext, memo, useContext, useMemo, useState } from 'react';
import { Button, Typography, Select, Popconfirm, Input } from '@arco-design/web-react';
import { IconMessage, IconPlus, IconPlayArrow, IconLoading } from '@arco-design/web-react/icon';
import { imageRefCap, imageTraits, maxShotSeconds, defaultVideoModelKey, IMAGE_MODEL_OPTIONS, imageModelKeyOf } from '../../../utils/film/suiteConfig';

const { Text } = Typography;

// Bridge from the chat node back to FilmCanvas's handlers (functions can't live in
// serializable node.data) — same context pattern as CutContext / StoryScriptContext.
export const StoryboardChatContext = createContext({
  onDivide: null, onNormalize: null, onListAction: null, bibleEntries: [], imageAssets: [], onToggleBibleRef: null, onRemoveRef: null, onAddBoardRef: null, onRenderAll: null, onRenderSheet: null, onCastFromScript: null, onPatchChat: null, onOpenRefDrawer: null,
});

// Same role palette as the SHOT card's reference chips — the two blocks must read as one system.
const ROLE_COLOR = { character: '#722ed1', location: '#00b42a', prop: '#ff7d00', frame: '#f5319d' };
const REF_BADGE = { fontSize: 9, background: 'rgba(0,0,0,0.28)', borderRadius: 8, padding: '0 4px' };
const asRef = (r) => (typeof r === 'string' ? { url: r, label: '' } : (r || {}));

// Blur-commit draft (the SHOT card's DraftText pattern): routing keystrokes through
// the RF store echoes the value back a beat late and resets the caret to the end.
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

// A labeled GROUP on the control card — the visual separation between the card's
// functional blocks.
const Section = ({ label, children, style }) => (
  <div style={{ background: '#f7f8fa', border: '1px solid #eceff3', borderRadius: 6, padding: 6, ...style }}>
    <Text style={{ display: 'block', fontSize: 9, fontWeight: 700, color: '#86909c', letterSpacing: 0.4, marginBottom: 4 }}>{label}</Text>
    {children}
  </div>
);

// The Storyboard agent's CONTROL CARD, bound to its strip element (1 row = 1 shot).
// There is deliberately NO free-text chat and NO action dropdown: the pipeline is
// SCRIPT → Normalize (event list, the story-level HITL gate) → Divide; list surgery
// lives ON the surfaces themselves (event rows here, shot rows on the strip), and
// Re-divide is the event list's own continuation — it exists only after Normalize.
// Between the header and the log sits the REFERENCE POOL — the SHOT card's REFERENCES block,
// adapted: bible entries as toggle chips (ON = filled + its [Image N] badge in POOL ORDER —
// exactly the numbering the division and the keyframes use), loose board refs as grey chips
// (click to remove), and "+ board image" to add any board image mid-conversation. The next
// turn / render reads the live pool; finished stills keep their frames.
const StoryboardChatNodeInner = ({ id, data, selected }) => {
  const { onDivide, onNormalize, bibleEntries, onToggleBibleRef, onRemoveRef, onRenderAll, onRenderSheet, onCastFromScript, onPatchChat, onOpenRefDrawer } = useContext(StoryboardChatContext);
  const count = data.shotCount || 0;
  // The reference pool can be a whole cast (face + body plate per character) — give it
  // real room, and let the header collapse it to one line when the chat needs the space.
  const [refsOpen, setRefsOpen] = useState(true);
  const pool = useMemo(() => (data.refs || []).map(asRef).filter((r) => r.url), [data.refs]);
  const events = useMemo(() => (Array.isArray(data.events) ? data.events : []), [data.events]);
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
      {/* SCRIPT — the storyboard's OWN source text, editable right here (verbatim:
          the division reads these words, never a Brief card). */}
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
      {/* EVENTS — the story's atoms (global event sequence, extracted by Normalize):
          the FIRST HITL gate. Confirm / edit-in-place / reorder / cut / add here;
          when the list exists, Divide carves THESE events, not the raw prose. */}
      {onNormalize && (
        <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()} style={{ padding: '6px 8px 0', flexShrink: 0 }}>
          <Section label={`EVENTS${events.length ? ` · ${events.length}` : ''}`}>
            {events.length === 0 ? (
              <Button
                size="small" long loading={!!data.busy}
                disabled={!String(data.script || '').trim()}
                onClick={() => onNormalize(id)}
                title={String(data.script || '').trim()
                  ? 'Extract the global event sequence from the script — entities + ordered observable events, wording carried, dialogue verbatim, gaps left UNSTATED. 1 reasoner call; the list lands here for review before any carving.'
                  : 'Type the script above first'}
              >
                Normalize — extract the event list (1 reasoner call)
              </Button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {events.map((ev, i) => (
                    <div key={`ev-${i}`} style={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
                      <Text style={{ fontSize: 9, fontWeight: 700, color: '#86909c', flexShrink: 0, lineHeight: '24px' }}>#{i + 1}</Text>
                      <DraftArea
                        value={typeof ev === 'string' ? ev : [ev?.text, ev?.dialogue].map((s) => String(s || '').trim()).filter(Boolean).join(' ')}
                        onCommit={(v) => onPatchChat(id, { events: events.map((e2, j) => (j === i ? v : e2)) })}
                        autoSize={{ minRows: 1, maxRows: 3 }}
                        style={{ fontSize: 11, flex: 1 }}
                      />
                      <Button size="mini" type="text" disabled={i === 0} onClick={() => { const next = [...events]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; onPatchChat(id, { events: next }); }} title="Move up" style={{ height: 20, padding: '0 3px', fontSize: 10, flexShrink: 0 }}>↑</Button>
                      <Button size="mini" type="text" disabled={i === events.length - 1} onClick={() => { const next = [...events]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; onPatchChat(id, { events: next }); }} title="Move down" style={{ height: 20, padding: '0 3px', fontSize: 10, flexShrink: 0 }}>↓</Button>
                      <Button size="mini" type="text" status="danger" onClick={() => onPatchChat(id, { events: events.filter((_, j) => j !== i) })} title="Delete this event (free)" style={{ height: 20, padding: '0 3px', fontSize: 10, flexShrink: 0 }}>✕</Button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button size="mini" style={{ flex: 1 }} onClick={() => onPatchChat(id, { events: [...events, ''] })} title="Add a blank event at the end — write it in place, your words ride verbatim (free)">＋ Add event</Button>
                  <Popconfirm title="Throw away this event list (and your edits) and re-normalize the script from scratch?" okText="Re-normalize" onOk={() => onNormalize(id)}>
                    <Button size="mini" status="warning" loading={!!data.busy} style={{ flex: 1 }}>Re-normalize</Button>
                  </Popconfirm>
                  {/* Re-divide is the event list's CONTINUATION — it only exists once
                      Normalize has run, and it re-carves THESE approved events. */}
                  {count > 0 && (
                    <Popconfirm title={`Throw away the current ${count}-shot list (and its authored text) and re-carve from these ${events.length} events?`} okText="Re-divide" onOk={() => onDivide && onDivide(id, { fresh: true })}>
                      <Button size="mini" status="warning" loading={!!data.busy} style={{ flex: 1 }} title="Re-carve the strip from the approved event list — 1 + N reasoner calls">Create Shot List</Button>
                    </Popconfirm>
                  )}
                </div>
              </div>
            )}
          </Section>
        </div>
      )}
      <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()} style={{ padding: '5px 8px', borderBottom: '1px solid #f2f3f5', maxHeight: refsOpen ? 216 : 22, overflowY: 'auto', flexShrink: 0 }}>
        <Text onClick={() => setRefsOpen((v) => !v)} title={refsOpen ? 'Collapse the reference pool' : 'Expand the reference pool'} style={{ color: '#86909c', fontSize: 9, fontWeight: 700, display: 'block', marginBottom: 3, cursor: 'pointer', userSelect: 'none' }}>
          {refsOpen ? '▾' : '▸'} REFERENCES → [Image1…{Math.min(pool.length, cap) || 'N'}] · {pool.length} in pool · click to toggle
        </Text>
        <div style={{ display: refsOpen ? 'flex' : 'none', flexWrap: 'wrap', gap: 4 }}>
          {/* The POOL only, in pool order (= the [Image N] numbering) — bible plates
              wear their role colour, loose board refs grey; click removes. Browsing
              the whole library lives in the ＋ drawer. */}
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
      {/* Cast & World — an EXPLICIT button, not buried chrome: drafts reference plates
          from THIS storyboard's verbatim script; they come back as toggle chips above. */}
      {onCastFromScript && (
        <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ padding: '6px 8px 0', flexShrink: 0 }}>
          <Section label="REFERENCES">
            <Button
              size="small" long
              onClick={() => onCastFromScript(id)}
              style={{ background: '#b06f10', borderColor: '#b06f10', color: '#fff' }}
              title="Opens the Cast & World panel with this storyboard's script prefilled (verbatim) — pick Lite/Pro and ethnicity there, then Run. Plates land tagged and appear as reference chips above."
            >
              Cast & World — generate reference plates
            </Button>
          </Section>
        </div>
      )}
      {/* The element lands INERT — this button IS the first division's explicit tap.
          TEXT-FIRST: the division buys WORDS (a shot-list of editable cards), never
          pixels; stills are separate explicit taps (per card, or Render all below).
          Typing a first message instead also divides, steered by your words. */}
      {(data.shots || []).length === 0 && (
        <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ padding: '6px 8px', borderBottom: '1px solid #f2f3f5', flexShrink: 0 }}>
          {/* SHOT COUNT IS AN OUTPUT: the knob is per-shot PACE — the script's length ÷
              the pace decides how many shots, so one control scales from a one-scene
              brief to a feature script. Auto lets the planner pace every shot itself. */}
          <div style={{ display: 'flex', gap: 6 }}>
            <Button
              size="small" type="primary" loading={!!data.busy}
              disabled={!String(data.script || '').trim()}
              icon={<IconPlayArrow />}
              onClick={() => onDivide && onDivide(id)}
              style={{ background: '#b06f10', borderColor: '#b06f10', flex: 1 }}
              title={String(data.script || '').trim() ? (events.length ? `Divide the APPROVED EVENT LIST (${events.length} events) into shot rows — words only, stills are separate taps` : 'Divide the script into shot rows — words only, stills are separate taps. Tip: Normalize first to review the event list before carving.') : 'Type the script above first'}
            >
              {data.busy ? 'Dividing…' : events.length ? `Divide ${events.length} events into shots` : 'Divide into shots'}
            </Button>
            <Select
              size="small"
              value={data.shotLength || 'auto'}
              onChange={(v) => onPatchChat && onPatchChat(id, { shotLength: v })}
              style={{ width: 108, flexShrink: 0 }}
              title="Per-shot pace — the script's length decides how many shots that makes"
              options={[
                { label: 'Auto pace', value: 'auto' },
                ...[5, 8, 10, 15, 20, 30].filter((v) => v <= maxShotSeconds(defaultVideoModelKey()))
                  .map((v) => ({ label: `~${v}s shots`, value: String(v) })),
              ]}
            />
          </div>
        </div>
      )}
      {/* STILLS — batch renders. Quick Storyboard works BEFORE a division too (one
          page straight from the verbatim script); Render all needs rows. */}
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
              title="The engine every still on this strip renders with (rows, END chains, Enhance, Quick Storyboard). Switching never re-renders anything by itself."
              options={IMAGE_MODEL_OPTIONS.map((m) => ({ label: m.label, value: m.key }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
            {(data.shots || []).length > 0 && onRenderAll && (
              <Button
                size="small" icon={<IconPlayArrow />} type="primary" style={{ flex: 1, background: '#b06f10', borderColor: '#b06f10' }}
                onClick={() => onRenderAll(id)}
                title="Render a still for every card that doesn't have one yet — cards with stills are left alone (re-render those from their tiles)"
              >
                Render all stills
              </Button>
            )}
            {onRenderSheet && (
              <>
                <Button
                  size="small" style={{ flex: 1, background: '#b06f10', borderColor: '#b06f10', color: '#fff' }}
                  onClick={() => onRenderSheet(id)}
                  title="Quick Storyboard — ONE image of numbered panels, landing below this card. Before a division it renders straight from the script (the renderer picks the moments); after, it renders from the shot list (first + last always ride, middles sample the biggest transitions). Guide advice: ≤15 panels."
                >
                  Quick Storyboard
                </Button>
                <Select
                  size="small"
                  value={data.sheetPanels || 0}
                  onChange={(v) => onPatchChat && onPatchChat(id, { sheetPanels: v })}
                  style={{ width: 100, flexShrink: 0, background: '#fff' }}
                  title="How many panels the page holds — fewer than the shot count = deterministic sampling (first, last, biggest transitions)"
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
