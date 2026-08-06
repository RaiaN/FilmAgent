import { createContext, memo, useContext, useMemo, useState } from 'react';
import { Button, Typography, Select } from '@arco-design/web-react';
import { IconMessage, IconPlus, IconPlayArrow } from '@arco-design/web-react/icon';
import ChatThread from './ChatThread';
import { imageRefCap } from '../../../utils/film/suiteConfig';

const { Text } = Typography;

// Bridge from the chat node back to FilmCanvas's handlers (functions can't live in
// serializable node.data) — same context pattern as CutContext / StoryScriptContext.
export const StoryboardChatContext = createContext({
  onTurn: null, bibleEntries: [], imageAssets: [], onToggleBibleRef: null, onRemoveRef: null, onAddBoardRef: null, onRenderAll: null, onCastFromScript: null, onPromoteAll: null, onPatchChat: null,
});

// Same role palette as the SHOT card's reference chips — the two blocks must read as one system.
const ROLE_COLOR = { character: '#722ed1', location: '#00b42a', prop: '#ff7d00', frame: '#f5319d' };
const REF_BADGE = { fontSize: 9, background: 'rgba(0,0,0,0.28)', borderRadius: 8, padding: '0 4px' };
const asRef = (r) => (typeof r === 'string' ? { url: r, label: '' } : (r || {}));

// The Storyboard agent's conversational element: a chat bound to a panel of keyframe stills.
// Between the header and the chat sits the REFERENCE POOL — the SHOT card's REFERENCES block,
// adapted: bible entries as toggle chips (ON = filled + its [Image N] badge in POOL ORDER —
// exactly the numbering the division and the keyframes use), loose board refs as grey chips
// (click to remove), and "+ board image" to add any board image mid-conversation. The next
// turn / render reads the live pool; finished stills keep their frames.
const StoryboardChatNodeInner = ({ id, data, selected }) => {
  const { onTurn, bibleEntries, imageAssets, onToggleBibleRef, onRemoveRef, onAddBoardRef, onRenderAll, onCastFromScript, onPromoteAll, onPatchChat } = useContext(StoryboardChatContext);
  const messages = data.messages || [];
  const count = data.shotCount || 0;
  const [addOpen, setAddOpen] = useState(false);
  // The reference pool can be a whole cast (face + body plate per character) — give it
  // real room, and let the header collapse it to one line when the chat needs the space.
  const [refsOpen, setRefsOpen] = useState(true);
  const pool = useMemo(() => (data.refs || []).map(asRef).filter((r) => r.url), [data.refs]);
  const cap = imageRefCap(data.imageModel || 'seedreamPro');
  const bible = bibleEntries || [];
  // Pool refs with no bible identity (panel-picked loose images, "+ board image" adds).
  const loose = pool.filter((r) => !bible.some((b) => (r.entryId && b.id === r.entryId) || b.url === r.url));
  const addable = (imageAssets || []).filter((a) => !pool.some((r) => r.url === a.url || (r.nodeId && r.nodeId === a.id)));
  return (
    <div style={{ width: 320, height: 540, display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 10, border: `2px solid ${selected ? '#4e5969' : '#d9d9e3'}`, boxShadow: selected ? '0 0 0 3px rgba(78,89,105,0.12)' : '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <div style={{ height: 4, background: '#4e5969' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid #f2f3f5' }}>
        <IconMessage style={{ color: '#4e5969', fontSize: 14 }} />
        <Text bold style={{ fontSize: 12, flex: 1 }} ellipsis>Storyboard · shot division</Text>
        {count > 0 && <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{count} {count === 1 ? 'shot' : 'shots'}</Text>}
      </div>
      <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()} style={{ padding: '5px 8px', borderBottom: '1px solid #f2f3f5', maxHeight: refsOpen ? 216 : 22, overflowY: 'auto', flexShrink: 0 }}>
        <Text onClick={() => setRefsOpen((v) => !v)} title={refsOpen ? 'Collapse the reference pool' : 'Expand the reference pool'} style={{ color: '#86909c', fontSize: 9, fontWeight: 700, display: 'block', marginBottom: 3, cursor: 'pointer', userSelect: 'none' }}>
          {refsOpen ? '▾' : '▸'} REFERENCES → [Image1…{Math.min(pool.length, cap) || 'N'}] · {pool.length} in pool · click to toggle
        </Text>
        <div style={{ display: refsOpen ? 'flex' : 'none', flexWrap: 'wrap', gap: 4 }}>
          {bible.map((b) => {
            const i = pool.findIndex((r) => (r.entryId && r.entryId === b.id) || r.url === b.url);
            const on = i >= 0;
            const nIdx = i + 1;
            const sent = on && nIdx <= cap;
            const color = ROLE_COLOR[b.role] || '#86909c';
            return (
              <span
                key={b.id}
                onClick={() => onToggleBibleRef && onToggleBibleRef(id, b)}
                title={`${b.name || b.role}${on ? ` — [Image ${nIdx}] in the pool; click to remove` : ' — click to add to the reference pool'}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                  padding: '1px 6px', borderRadius: 10, fontSize: 10,
                  border: `1px solid ${color}`,
                  background: on ? color : 'transparent',
                  color: on ? '#fff' : color,
                  opacity: on ? 1 : 0.55,
                }}
              >
                {sent && <b style={REF_BADGE}>{nIdx}</b>}
                {b.url ? <img src={b.url} alt="" loading="lazy" decoding="async" style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} /> : null}
                {(b.name || b.role).slice(0, 14)}
              </span>
            );
          })}
          {loose.map((r) => {
            const i = pool.findIndex((p) => p.url === r.url);
            const nIdx = i + 1;
            const sent = nIdx <= cap;
            return (
              <span
                key={r.url}
                onClick={() => onRemoveRef && onRemoveRef(id, r.url)}
                title={`${r.label || 'reference'} — [Image ${nIdx}] in the pool (board image); click to remove`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                  padding: '1px 6px', borderRadius: 10, fontSize: 10,
                  border: '1px solid #e5e6eb', background: '#e5e6eb', color: '#1d2129',
                }}
              >
                {sent && <b style={REF_BADGE}>{nIdx}</b>}
                <img src={r.url} alt="" loading="lazy" decoding="async" style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} />
                {(r.label || 'ref').slice(0, 14)}
              </span>
            );
          })}
          {onAddBoardRef && (
            <span
              onClick={() => setAddOpen((v) => !v)}
              title="Add any board image to the reference pool — it becomes [Image N+1]; the next division turn and renders can use it"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer',
                padding: '1px 6px', borderRadius: 10, fontSize: 10,
                border: '1px dashed #86909c', color: '#86909c',
              }}
            >
              <IconPlus style={{ fontSize: 10 }} /> board image
            </span>
          )}
        </div>
        {refsOpen && addOpen && (
          <div style={{ marginTop: 4, padding: 6, border: '1px solid #e5e6eb', borderRadius: 6, maxHeight: 96, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {addable.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 10 }}>Every board image is already in the pool.</Text>
            ) : (
              addable.map((a) => (
                <img
                  key={a.id}
                  src={a.url}
                  alt={a.label}
                  title={a.label}
                  onClick={() => { onAddBoardRef(id, a.id); setAddOpen(false); }}
                  style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: '1px solid #e5e6eb' }}
                />
              ))
            )}
          </div>
        )}
        {refsOpen && pool.length > cap && (
          <Text style={{ color: '#ff7d00', fontSize: 9, display: 'block', marginTop: 2 }}>
            first {cap} ride per render ({(data.imageModel || 'seedreamPro') === 'seedreamPro' ? 'Pro' : 'Lite'} reference cap)
          </Text>
        )}
      </div>
      {/* Cast & World — an EXPLICIT button, not buried chrome: drafts reference plates
          from THIS storyboard's verbatim script; they come back as toggle chips above. */}
      {onCastFromScript && (
        <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ padding: '6px 8px 0', flexShrink: 0 }}>
          <Button
            size="small" long loading={!!data.casting}
            onClick={() => onCastFromScript(id)}
            style={{ borderColor: '#b06f10', color: '#b06f10' }}
            title="Draft characters, locations and a shared look from this storyboard's script (verbatim). Plates land on the board as tagged anchors and appear as reference chips above. One explicit run."
          >
            {data.casting ? 'Casting…' : 'Cast & World — generate reference plates'}
          </Button>
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
              icon={<IconPlayArrow />}
              onClick={() => onTurn && onTurn(id, '')}
              style={{ background: '#4e5969', borderColor: '#4e5969', flex: 1 }}
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
                { label: '~5s shots', value: '5' },
                { label: '~8s shots', value: '8' },
                { label: '~10s shots', value: '10' },
                { label: '~15s shots', value: '15' },
              ]}
            />
          </div>
        </div>
      )}
      {/* Shot list divided → the batch buy: render every card that lacks its still.
          Per-card renders live on the cards; chat revisions keep editing the text. */}
      {(data.shots || []).length > 0 && (data.mode || 'multiple') !== 'single' && onRenderAll && (
        <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ padding: '6px 8px', borderBottom: '1px solid #f2f3f5', flexShrink: 0 }}>
          <Button
            size="small" long icon={<IconPlayArrow />}
            onClick={() => onRenderAll(id)}
            title="Render a still for every card that doesn't have one yet — cards with stills are left alone (re-render those from their tiles)"
          >
            Render all stills
          </Button>
          {onPromoteAll && (
            <Button
              size="small" long type="primary" style={{ marginTop: 6, background: '#b06f10', borderColor: '#b06f10' }}
              onClick={() => onPromoteAll(id)}
              title="Create sequence: every RENDERED still becomes a SHOT card, laid left→right and CHAINED — still as the anchor lock, its cast riding as references, duration carried; each bond threads the previous shot's last frame into the next. Free: no generation. Then ▶ Action shoots the chain."
            >
              Create sequence
            </Button>
          )}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatThread messages={messages} busy={!!data.busy} onSend={(text) => onTurn && onTurn(id, text)} />
      </div>
    </div>
  );
};

export default memo(StoryboardChatNodeInner);
