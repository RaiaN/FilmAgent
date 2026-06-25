import { createContext, memo, useContext, useState } from 'react';
import { Button, Typography, Tag, Input, Select, Tooltip, Checkbox } from '@arco-design/web-react';
import { IconLoading, IconRefresh, IconClose, IconEdit, IconSend, IconVideoCamera, IconApps } from '@arco-design/web-react/icon';

const { Text } = Typography;
const GOLD = '#b06f10';

// Story agent: an idea (or a pasted script) → ONE long cinematic prompt (clear subjects +
// story arc, CUT-structured but no CUT markers in the output, no facing-camera, explicit
// eyelines). The node shows that single editable prompt + a 🎬 New Shot button that drops
// an editable SHOT card carrying the prompt.
export const StoryScriptContext = createContext({
  idea: '', mode: '', prompt: '', complexity: 'medium', useCastRefs: false, busy: false, phase: 'idle', shooting: false, storyboarding: false,
  onEditPrompt: null, onSetComplexity: null, onSetUseCastRefs: null, onRegenerate: null, onShapeSource: null, onShoot: null, onStoryboard: null, onClose: null,
});

const DEPTH_OPTIONS = [{ label: 'Light', value: 'light' }, { label: 'Medium', value: 'medium' }, { label: 'Deep', value: 'deep' }];

const dark = { fontSize: 12, lineHeight: '18px', color: '#e5e6eb', background: '#101418', border: '1px solid #2a313a', borderRadius: 6, fontFamily: 'inherit' };
const NODE_W = 560;

const StoryScriptNode = () => {
  const {
    idea, mode, prompt = '', complexity = 'medium', useCastRefs, busy, phase, shooting, storyboarding,
    onEditPrompt, onSetComplexity, onSetUseCastRefs, onRegenerate, onShapeSource, onShoot, onStoryboard, onClose,
  } = useContext(StoryScriptContext);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const writing = phase === 'writing' || (busy && !prompt);
  const ready = !!prompt;

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
        <Tooltip content="Rewrite depth — how far to expand your idea: Light (tight, close to the source) · Medium · Deep (rich, immersive). Pick, then Rewrite.">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: '#5a6472', fontSize: 11 }}>Depth</Text>
            <Select className="nodrag" size="mini" value={complexity} onChange={(v) => onSetComplexity && onSetComplexity(v)} options={DEPTH_OPTIONS} style={{ width: 84 }} triggerProps={{ autoAlignPopupWidth: false }} disabled={busy || shooting} />
          </span>
        </Tooltip>
        <Button className="nodrag" size="mini" icon={busy ? <IconLoading /> : <IconRefresh />} disabled={busy || shooting} onClick={onRegenerate}>Rewrite</Button>
        <span style={{ flex: 1 }} />
        <Tooltip content="Use your tagged Cast & World plates as references on every storyboard frame (keeps characters & world consistent). Off = story text + the chained previous frame only.">
          <Checkbox className="nodrag" checked={!!useCastRefs} onChange={(c) => onSetUseCastRefs && onSetUseCastRefs(c)} style={{ marginRight: 2 }}>
            <Text style={{ fontSize: 11, color: '#5a6472' }}>cast refs</Text>
          </Checkbox>
        </Tooltip>
        <Button className="nodrag" size="mini" icon={storyboarding ? <IconLoading /> : <IconApps />} disabled={busy || shooting || storyboarding || !ready} onClick={onStoryboard} title="Storyboard — render a visual storyboard of this story, all frames in one go (one shared seed; turn on ‘cast refs’ to anchor on your Cast & World)">Storyboard</Button>
        <Button className="nodrag" size="mini" type="primary" icon={shooting ? <IconLoading /> : <IconVideoCamera />} disabled={busy || shooting || !ready} style={{ background: GOLD, borderColor: GOLD }} onClick={onShoot} title="New Shot — drop an editable SHOT card on the board with this prompt">New Shot</Button>
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
          <Input.TextArea className="nodrag nowheel" value={prompt} onChange={(v) => onEditPrompt && onEditPrompt(v)} autoSize={{ minRows: 6, maxRows: 22 }} style={{ ...dark, marginTop: 5 }} />
        </div>
      ) : (
        <div style={{ padding: '24px', textAlign: 'center', color: '#86909c', fontSize: 12 }}>Give me an idea or paste a script.</div>
      )}

      <Text style={{ color: '#5a6472', fontSize: 10, padding: '0 10px 8px' }}>Edit the prompt — then 🎬 New Shot to drop an editable SHOT card on the board.</Text>
    </div>
  );
};

export default memo(StoryScriptNode);
