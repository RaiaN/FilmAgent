import { createContext, memo, useContext, useState } from 'react';
import { Button, Typography, Tag, Input, Select, Tooltip } from '@arco-design/web-react';
import { IconLoading, IconRefresh, IconClose, IconEdit, IconSend, IconVideoCamera, IconUserGroup } from '@arco-design/web-react/icon';

const { Text } = Typography;
const GOLD = '#b06f10';

// Story agent: an idea (or a pasted script) → ONE long cinematic prompt (clear subjects +
// story arc, CUT-structured but no CUT markers in the output, no facing-camera, explicit
// eyelines). The node shows that single editable prompt + a 🎬 New Shot button that drops
// an editable SHOT card carrying the prompt. Each Story node is INDEPENDENT — its state
// lives in its own node.data and every handler is called with the node id so the canvas
// updates exactly this node (the board can hold many Story elements at once).
export const StoryScriptContext = createContext({
  onEditPrompt: null, onSetComplexity: null, onRegenerate: null, onShapeSource: null, onCast: null, onShoot: null, onClose: null,
});

const DEPTH_OPTIONS = [{ label: 'Light', value: 'light' }, { label: 'Medium', value: 'medium' }, { label: 'Deep', value: 'deep' }];

const dark = { fontSize: 12, lineHeight: '18px', color: '#e5e6eb', background: '#101418', border: '1px solid #2a313a', borderRadius: 6, fontFamily: 'inherit' };
const NODE_W = 560;

const StoryScriptNode = ({ id, data = {} }) => {
  const { idea = '', mode = '', prompt = '', complexity = 'medium', busy = false, phase = 'idle', shooting = false, casting = false } = data;
  const {
    onEditPrompt, onSetComplexity, onRegenerate, onShapeSource, onCast, onShoot, onClose,
  } = useContext(StoryScriptContext);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const writing = phase === 'writing' || (busy && !prompt);
  const ready = !!prompt;

  const submitPaste = () => {
    if (!pasteText.trim() || busy || !onShapeSource) return;
    onShapeSource(id, pasteText.trim());
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
        {onClose && <Button className="nodrag" size="mini" type="text" icon={<IconClose />} onClick={() => onClose(id)} style={{ color: '#5a6472', padding: '0 2px' }} />}
      </div>

      {/* toolbar — all actions right-aligned (wraps to right-aligned rows when narrow) */}
      <div style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, borderBottom: '1px solid #2a313a', flexWrap: 'wrap' }}>
        <Button className="nodrag" size="mini" type="text" icon={<IconEdit />} onClick={() => setPasteOpen((v) => !v)} style={{ color: '#9fb4d0' }}>{pasteOpen ? 'Hide script' : 'Paste a script'}</Button>
        <Tooltip content="Rewrite depth — how far to expand your idea: Light (tight, close to the source) · Medium · Deep (rich, immersive). Pick, then Rewrite.">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: '#5a6472', fontSize: 11 }}>Depth</Text>
            <Select className="nodrag" size="mini" value={complexity} onChange={(v) => onSetComplexity && onSetComplexity(id, v)} options={DEPTH_OPTIONS} style={{ width: 84 }} triggerProps={{ autoAlignPopupWidth: false }} disabled={busy || shooting} />
          </span>
        </Tooltip>
        <Button className="nodrag" size="mini" icon={busy ? <IconLoading /> : <IconRefresh />} disabled={busy || shooting} onClick={() => onRegenerate && onRegenerate(id)}>Rewrite</Button>
        <Button className="nodrag" size="mini" icon={casting ? <IconLoading /> : <IconUserGroup />} disabled={busy || casting} onClick={() => onCast && onCast(id)} title="Cast & World — draft the characters, locations and a shared look from this story (lands as tagged plates on the board)">Cast &amp; World</Button>
        <Button className="nodrag" size="mini" type="primary" icon={shooting ? <IconLoading /> : <IconVideoCamera />} disabled={busy || shooting || !ready} style={{ background: GOLD, borderColor: GOLD }} onClick={() => onShoot && onShoot(id)} title="New Shot — drop an editable SHOT card on the board with this prompt">New Shot</Button>
      </div>

      {/* paste a script → rewritten cinematically (events preserved) */}
      {pasteOpen && (
        <div className="nodrag nowheel" style={{ padding: 10, borderBottom: '1px solid #2a313a', background: '#12161c' }}>
          <Input.TextArea className="nodrag nowheel" value={pasteText} onChange={setPasteText} placeholder="Paste your story or script — its events are preserved and rewritten into one cinematic prompt (not into a different story)." autoSize={{ minRows: 3, maxRows: 10 }} style={{ ...dark, marginBottom: 6 }} />
          <Button className="nodrag" size="mini" type="outline" icon={<IconSend />} disabled={busy || !pasteText.trim()} onClick={submitPaste}>Rewrite to a prompt</Button>
        </div>
      )}

      {writing ? (
        <div style={{ padding: '34px 24px', textAlign: 'center', color: '#86909c', fontSize: 12 }}>
          <IconLoading style={{ color: GOLD }} /> Writing the cinematic prompt…
        </div>
      ) : ready ? (
        <div className="nodrag nowheel" style={{ padding: 10 }}>
          <Text style={{ color: GOLD, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Cinematic prompt — what gets shot</Text>
          <Input.TextArea className="nodrag nowheel" value={prompt} onChange={(v) => onEditPrompt && onEditPrompt(id, v)} autoSize={{ minRows: 6, maxRows: 22 }} style={{ ...dark, marginTop: 5 }} />
        </div>
      ) : (
        <div style={{ padding: '24px', textAlign: 'center', color: '#86909c', fontSize: 12 }}>Give me an idea or paste a script.</div>
      )}

      <Text style={{ color: '#5a6472', fontSize: 10, padding: '0 10px 8px' }}>Edit the prompt — then 🎬 New Shot to drop an editable SHOT card on the board.</Text>
    </div>
  );
};

export default memo(StoryScriptNode);
