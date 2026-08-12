import { createContext, memo, useContext, useMemo, useState } from 'react';
import { Button, Typography, Select, Popconfirm, Input } from '@arco-design/web-react';
import { IconMessage, IconPlus, IconPlayArrow, IconLoading } from '@arco-design/web-react/icon';
import { imageRefCap, imageTraits, maxShotSeconds, defaultVideoModelKey } from '../../../utils/film/suiteConfig';

const { Text } = Typography;

// Bridge from the chat node back to FilmCanvas's handlers (functions can't live in
// serializable node.data) — same context pattern as CutContext / StoryScriptContext.
export const StoryboardChatContext = createContext({
  onDivide: null, onListAction: null, bibleEntries: [], imageAssets: [], onToggleBibleRef: null, onRemoveRef: null, onAddBoardRef: null, onRenderAll: null, onRenderSheet: null, onCastFromScript: null, onPatchChat: null, onOpenRefDrawer: null,
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
// There is deliberately NO free-text chat: the strip rows are the display surface and
// this card holds the pool, the batch buttons, and a CONSTRAINED action bar — 1 of M
// structured actions (Note→re-author / Add / Cut / Re-divide), no routing LLM.
// Between the header and the log sits the REFERENCE POOL — the SHOT card's REFERENCES block,
// adapted: bible entries as toggle chips (ON = filled + its [Image N] badge in POOL ORDER —
// exactly the numbering the division and the keyframes use), loose board refs as grey chips
// (click to remove), and "+ board image" to add any board image mid-conversation. The next
// turn / render reads the live pool; finished stills keep their frames.
const StoryboardChatNodeInner = ({ id, data, selected }) => {
  const { onDivide, onListAction, bibleEntries, onToggleBibleRef, onRemoveRef, onRenderAll, onRenderSheet, onCastFromScript, onPatchChat, onOpenRefDrawer } = useContext(StoryboardChatContext);
  const count = data.shotCount || 0;
  // The constrained action bar's local draft (1 of M + structured args).
  const [act, setAct] = useState('note');
  const [actShot, setActShot] = useState(1);
  const [actNote, setActNote] = useState('');
  // The reference pool can be a whole cast (face + body plate per character) — give it
  // real room, and let the header collapse it to one line when the chat needs the space.
  const [refsOpen, setRefsOpen] = useState(true);
  const pool = useMemo(() => (data.refs || []).map(asRef).filter((r) => r.url), [data.refs]);
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
        <Section label="SCRIPT — divided into shots, wording preserved">
          <DraftArea
            value={data.script}
            onCommit={(v) => onPatchChat && onPatchChat(id, { script: v })}
            placeholder="type or paste the scene / script here…"
            autoSize={{ minRows: 2, maxRows: 8 }}
            style={{ fontSize: 11 }}
          />
        </Section>
      </div>
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
              title={String(data.script || '').trim() ? 'Divide the script into shot rows — words only, stills are separate taps' : 'Type the script above first'}
            >
              {data.busy ? 'Dividing…' : 'Divide into shots'}
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
          <Section label="STILLS">
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
      {/* CONSTRAINED ACTION BAR — 1 of M structured actions on the shot list. No free
          text routing: the action is explicit, the args are explicit, surgery is code,
          only Note/Add spend ONE author call (labeled). Frames stay the main surface —
          this bar is the discoverable front door for list-level moves. */}
      {count > 0 && onListAction && (
        <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ padding: '6px 8px', borderBottom: '1px solid #f2f3f5', flexShrink: 0 }}>
          <Section label="ACTIONS">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <Select
              size="mini" value={act} onChange={(v) => setAct(v)} style={{ flex: 1 }}
              options={[
                { label: 'Note → re-author shot', value: 'note' },
                { label: 'Add shot after', value: 'add' },
                { label: 'Cut shot', value: 'cut' },
                { label: 'Re-divide script', value: 'redivide' },
              ]}
            />
            {act !== 'redivide' && (
              <Select
                size="mini" value={Math.min(actShot, count)} onChange={(v) => setActShot(v)} style={{ width: 62, flexShrink: 0 }}
                options={Array.from({ length: count }, (_, i) => ({ label: `#${i + 1}`, value: i + 1 }))}
              />
            )}
          </div>
          {(act === 'note' || act === 'add') && (
            <Input.TextArea
              value={actNote}
              onChange={(v) => setActNote(v)}
              rows={2}
              placeholder={act === 'note'
                ? 'Director\u2019s note — ONE author call re-writes just this shot from its verbatim span + this note'
                : 'What the new shot covers — your words ride verbatim as its span; empty = a blank row to hand-write'}
              style={{ fontSize: 11 }}
            />
          )}
          {act === 'redivide' ? (
            <Popconfirm
              title="Throw away this shot list (and its authored text) and re-divide the script from scratch?"
              okText="Re-divide"
              onOk={() => onListAction(id, { action: 'redivide' })}
            >
              <Button size="mini" long status="warning" loading={!!data.busy}>
                Re-divide — 1 + N reasoner calls (pace: {data.shotLength || 'auto'})
              </Button>
            </Popconfirm>
          ) : (
            <Button
              size="mini" long type="primary" style={{ background: '#b06f10', borderColor: '#b06f10' }}
              disabled={act === 'note' && !actNote.trim()}
              onClick={() => { onListAction(id, { action: act, shot: Math.min(actShot, count) - 1, note: actNote }); setActNote(''); }}
            >
              {act === 'note' ? 'Re-author — 1 reasoner call' : act === 'add' ? (actNote.trim() ? 'Add + author — 1 reasoner call' : 'Add blank row — free') : 'Cut — free'}
            </Button>
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
