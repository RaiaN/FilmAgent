import { createContext, memo, useContext, useState } from 'react';
import { Button, Typography, Tag, Input, Select } from '@arco-design/web-react';
import { IconLoading, IconRefresh, IconClose, IconEdit, IconSend, IconVideoCamera, IconPlus } from '@arco-design/web-react/icon';

const { Text } = Typography;
const GOLD = '#b06f10';

// Story agent v2 (2026-06-19): the film as KEY EVENTS + APPEARANCE strings → ONE
// continuous text-only Seedance 2.0 prompt (no arc, no reference images, no shot cards).
// The node shows three editable sections — APPEARANCES (the identity lock), KEY EVENTS
// (the 3–4 load-bearing beats), and the assembled SEEDANCE PROMPT (assets-as-description
// at the top, then the events) — and a 🎬 Shoot the film button that sends that prompt.
export const StoryScriptContext = createContext({
  idea: '', mode: '', appearances: [], keyEvents: [], seedancePrompt: '', busy: false, phase: 'idle', shooting: false, bibleAssets: [],
  onEditEvent: null, onAddEvent: null, onRemoveEvent: null, onEditAppearance: null, onEditPrompt: null, onRegenerate: null, onShapeSource: null, onShoot: null, onClose: null,
});

const dark = { fontSize: 12, lineHeight: '17px', color: '#e5e6eb', background: '#101418', border: '1px solid #2a313a', borderRadius: 6, fontFamily: 'inherit' };
const NODE_W = 560;

const StoryScriptNode = () => {
  const {
    idea, mode, appearances = [], keyEvents = [], seedancePrompt = '', busy, phase, shooting, bibleAssets = [],
    onEditEvent, onAddEvent, onRemoveEvent, onEditAppearance, onEditPrompt, onRegenerate, onShapeSource, onShoot, onClose,
  } = useContext(StoryScriptContext);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const writing = phase === 'writing' || (busy && !keyEvents.length);
  const ready = keyEvents.length > 0;

  const submitPaste = () => {
    if (!pasteText.trim() || busy || !onShapeSource) return;
    onShapeSource(pasteText.trim());
    setPasteText(''); setPasteOpen(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: NODE_W, background: '#161b22', border: '1px solid #2a313a', borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', color: '#fff' }}>
      {/* header */}
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid #2a313a' }}>
        <Text style={{ color: '#f7ba1e', fontSize: 12, fontWeight: 700 }}>Story</Text>
        {(busy || shooting) && <IconLoading style={{ color: GOLD, fontSize: 12 }} />}
        {mode && !writing && <Tag size="small" color={mode === 'preserve' ? 'green' : 'arcoblue'}>{mode === 'preserve' ? 'your script' : 'written'}</Tag>}
        <Text style={{ color: '#5a6472', fontSize: 11, flex: 1, minWidth: 0 }} ellipsis>{idea}</Text>
        {onClose && <Button className="nodrag" size="mini" type="text" icon={<IconClose />} onClick={onClose} style={{ color: '#5a6472', padding: '0 2px' }} />}
      </div>

      {/* toolbar */}
      <div style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid #2a313a', flexWrap: 'wrap' }}>
        <Button className="nodrag" size="mini" type="text" icon={<IconEdit />} onClick={() => setPasteOpen((v) => !v)} style={{ color: '#9fb4d0' }}>{pasteOpen ? 'Hide script' : 'Paste a script'}</Button>
        <Button className="nodrag" size="mini" icon={busy ? <IconLoading /> : <IconRefresh />} disabled={busy || shooting} onClick={onRegenerate}>Rewrite</Button>
        <span style={{ flex: 1 }} />
        <Button className="nodrag" size="mini" type="primary" icon={shooting ? <IconLoading /> : <IconVideoCamera />} disabled={busy || shooting || !ready} style={{ background: GOLD, borderColor: GOLD }} onClick={onShoot} title="New Shot — drop an editable SHOT card on the board with this prompt">New Shot</Button>
      </div>

      {/* paste a script → preserved + compressed into key events */}
      {pasteOpen && (
        <div className="nodrag nowheel" style={{ padding: 10, borderBottom: '1px solid #2a313a', background: '#12161c' }}>
          <Input.TextArea className="nodrag nowheel" value={pasteText} onChange={setPasteText} placeholder="Paste your story or script — its events are preserved and compressed into key events (not rewritten)." autoSize={{ minRows: 3, maxRows: 10 }} style={{ ...dark, marginBottom: 6 }} />
          <Button className="nodrag" size="mini" type="outline" icon={<IconSend />} disabled={busy || !pasteText.trim()} onClick={submitPaste}>Compress to key events</Button>
        </div>
      )}

      {writing ? (
        <div style={{ padding: '34px 24px', textAlign: 'center', color: '#86909c', fontSize: 12 }}>
          <IconLoading style={{ color: GOLD }} /> Finding the key events…
        </div>
      ) : ready ? (
        <div className="nodrag nowheel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* APPEARANCES — the identity lock (assets as description) */}
          <div>
            <Text style={{ color: GOLD, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Appearances — the identity lock</Text>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 5 }}>
              {appearances.map((a, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, border: '1px solid #20262e', borderRadius: 6, padding: '5px 6px' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Input className="nodrag" size="mini" value={a.name || ''} onChange={(v) => onEditAppearance && onEditAppearance(i, { name: v })} style={{ ...dark, width: 110, flexShrink: 0 }} placeholder="name" />
                    {/* Reference a Cast & World bible asset — links this character to a real
                        plate so the shot can use it as a reference image. */}
                    <Select className="nodrag" size="mini" allowClear placeholder="🔗 bible asset" value={a.refId || undefined} style={{ flex: 1, minWidth: 0 }} triggerProps={{ autoAlignPopupWidth: false }}
                      onChange={(v) => { const b = bibleAssets.find((x) => x.id === v); onEditAppearance && onEditAppearance(i, { refId: v || null, ...(b && !a.name ? { name: b.name } : {}) }); }}>
                      {bibleAssets.map((b) => <Select.Option key={b.id} value={b.id}>{b.name || b.role}</Select.Option>)}
                    </Select>
                    {onRemoveEvent && <Button className="nodrag" size="mini" type="text" status="danger" onClick={() => onEditAppearance && onEditAppearance(i, { __remove: true })} style={{ padding: '0 3px', flexShrink: 0 }}>×</Button>}
                  </div>
                  <Input.TextArea className="nodrag nowheel" value={a.string || ''} onChange={(v) => onEditAppearance && onEditAppearance(i, { string: v })} autoSize={{ minRows: 1, maxRows: 4 }} style={dark} placeholder="age, build, hair, wardrobe, one distinguishing feature" />
                </div>
              ))}
              {!appearances.length && <Text style={{ color: '#5a6472', fontSize: 11 }}>No named characters — the unknown stays unseen.</Text>}
            </div>
          </div>

          {/* KEY EVENTS — the 3–4 load-bearing beats */}
          <div>
            <Text style={{ color: GOLD, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Key events — setup → turn → payoff</Text>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 5 }}>
              {keyEvents.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <span style={{ color: GOLD, fontSize: 11, fontWeight: 700, paddingTop: 4, width: 14, flexShrink: 0 }}>{i + 1}</span>
                  <Input.TextArea className="nodrag nowheel" value={e || ''} onChange={(v) => onEditEvent && onEditEvent(i, v)} autoSize={{ minRows: 1, maxRows: 4 }} style={{ ...dark, flex: 1 }} />
                  <Button className="nodrag" size="mini" type="text" status="danger" disabled={keyEvents.length <= 1} onClick={() => onRemoveEvent && onRemoveEvent(i)} style={{ padding: '0 3px', flexShrink: 0 }}>×</Button>
                </div>
              ))}
              <Button className="nodrag" size="mini" type="text" icon={<IconPlus />} onClick={onAddEvent} style={{ color: GOLD, alignSelf: 'flex-start', fontSize: 11 }}>Add event</Button>
            </div>
          </div>

          {/* SEEDANCE PROMPT — assets-as-description + key events (what gets shot) */}
          <div>
            <Text style={{ color: GOLD, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Seedance prompt — what gets shot</Text>
            <Input.TextArea className="nodrag nowheel" value={seedancePrompt} onChange={(v) => onEditPrompt && onEditPrompt(v)} autoSize={{ minRows: 4, maxRows: 16 }} style={{ ...dark, marginTop: 5 }} />
          </div>
        </div>
      ) : (
        <div style={{ padding: '24px', textAlign: 'center', color: '#86909c', fontSize: 12 }}>Give me an idea or paste a script.</div>
      )}

      <Text style={{ color: '#5a6472', fontSize: 10, padding: '0 10px 8px' }}>Edit the appearances, the key events, or the final prompt — then 🎬 New Shot to drop an editable SHOT card on the board.</Text>
    </div>
  );
};

export default memo(StoryScriptNode);
