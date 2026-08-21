import { createContext, memo, useContext } from 'react';
import { Button, Typography, Tag, Input, InputNumber, Select, Tooltip } from '@arco-design/web-react';
import { IconLoading, IconClose, IconEdit, IconVideoCamera, IconUserGroup, IconApps, IconScissor } from '@arco-design/web-react/icon';

const { Text } = Typography;
const GOLD = '#b06f10';

// The BRIEF node: a container for YOUR words — an idea, a description or a full pasted
// script — kept VERBATIM (no automatic rewrite, EVER — no agent runs under the hood).
// Cast & World, Storyboard and 🎬 New Shot all consume the brief text exactly as written;
// Develop (opt-in) rewrites it into ONE long cinematic prompt (subjects, arc, eyelines)
// which New Shot then uses INSTEAD of the raw brief. Each Brief node is INDEPENDENT —
// its state lives in its own node.data and every handler is called with the node id so
// the canvas updates exactly this node (the board can hold many Brief elements at once).
export const StoryScriptContext = createContext({
  onEditIdea: null, onEditPrompt: null, onSetComplexity: null, onDevelop: null, onCast: null, onStoryboard: null, onSplit: null, onSetSplitCount: null, onShoot: null, onClose: null,
});

const DEPTH_OPTIONS = [{ label: 'Light', value: 'light' }, { label: 'Medium', value: 'medium' }, { label: 'Deep', value: 'deep' }];

const dark = { fontSize: 12, lineHeight: '18px', color: '#e5e6eb', background: '#101418', border: '1px solid #2a313a', borderRadius: 6, fontFamily: 'inherit' };
const NODE_W = 560;

const StoryScriptNode = ({ id, data = {} }) => {
  const { idea = '', mode = '', prompt = '', complexity = 'medium', busy = false, phase = 'idle', shooting = false, casting = false, boarding = false, splitting = false, splitCount = null } = data;
  const {
    onEditIdea, onEditPrompt, onSetComplexity, onDevelop, onCast, onStoryboard, onSplit, onSetSplitCount, onShoot, onClose,
  } = useContext(StoryScriptContext);
  const hasText = !!String(idea).trim();
  const writing = phase === 'writing' || busy;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: NODE_W, background: '#161b22', border: '1px solid #2a313a', borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', color: '#fff' }}>
      {/* header */}
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid #2a313a' }}>
        <Text style={{ color: '#f7ba1e', fontSize: 12, fontWeight: 700 }}>Brief</Text>
        {(busy || shooting || casting) && <IconLoading style={{ color: GOLD, fontSize: 12 }} />}
        <span style={{ flex: 1 }} />
        {onClose && <Button className="nodrag" size="mini" type="text" icon={<IconClose />} onClick={() => onClose(id)} style={{ color: '#5a6472', padding: '0 2px' }} />}
      </div>

      {/* toolbar — every action reads the brief below (wraps to right-aligned rows when narrow) */}
      <div style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, borderBottom: '1px solid #2a313a', flexWrap: 'wrap' }}>
        <Tooltip content="Develop depth — how far Develop expands your brief: Light (tight, close to the source) · Medium · Deep (rich, immersive).">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: '#5a6472', fontSize: 11 }}>Depth</Text>
            <Select className="nodrag" size="mini" value={complexity} onChange={(v) => onSetComplexity && onSetComplexity(id, v)} options={DEPTH_OPTIONS} style={{ width: 84 }} triggerProps={{ autoAlignPopupWidth: false }} disabled={busy || shooting} />
          </span>
        </Tooltip>
        <Button className="nodrag" size="mini" icon={busy ? <IconLoading /> : <IconEdit />} disabled={busy || shooting || !hasText} onClick={() => onDevelop && onDevelop(id)} title="Develop (opt-in) — rewrite the brief into one long cinematic prompt (subjects, arc, eyelines); New Shot then uses it instead of the raw brief. Your brief stays untouched.">{prompt ? 'Develop again' : 'Develop'}</Button>
        <Button className="nodrag" size="mini" icon={casting ? <IconLoading /> : <IconUserGroup />} disabled={busy || casting || !hasText} onClick={() => onCast && onCast(id)} title="Cast & World — draft the characters, locations and a shared look from this brief, verbatim (lands as tagged plates on the board)">Cast &amp; World</Button>
        <Button className="nodrag" size="mini" icon={boarding ? <IconLoading /> : <IconApps />} disabled={!hasText || boarding} onClick={() => onStoryboard && onStoryboard(id)} title="Storyboard — break this brief (your words, verbatim) into a shot list with keyframe stills. Uses your bible cast as references when it exists; otherwise boards reference-free — nothing runs under the hood.">Storyboard</Button>
        <Tooltip content="Split size — Auto (empty) = the fewest 5–15s scene chunks; set a number to aim for that many. The 5–15s-per-shot rule always wins, so an impossible count lands as close as physics allows.">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: '#5a6472', fontSize: 11 }}>Shots</Text>
            <InputNumber className="nodrag" size="mini" min={2} max={24} placeholder="auto" value={splitCount ?? undefined} onChange={(v) => onSetSplitCount && onSetSplitCount(id, v)} style={{ width: 64 }} disabled={splitting || busy} />
          </span>
        </Tooltip>
        <Button className="nodrag" size="mini" icon={splitting ? <IconLoading /> : <IconScissor />} disabled={!hasText || splitting || busy} onClick={() => onSplit && onSplit(id)} title="Split into Shots — break this brief into sequential SHOT cards (each capped at the video model's max length), ready to shoot. Your wording, details, timestamps and dialogue are preserved per card — never summarized.">Split</Button>
        <Button className="nodrag" size="mini" type="primary" icon={shooting ? <IconLoading /> : <IconVideoCamera />} disabled={busy || shooting || (!hasText && !prompt)} style={{ background: GOLD, borderColor: GOLD }} onClick={() => onShoot && onShoot(id)} title="New Shot — drop an editable SHOT card carrying this brief VERBATIM (or your developed cinematic prompt, if you made one). Nothing is rewritten under the hood.">New Shot</Button>
      </div>

      {/* your brief — kept verbatim; this exact text feeds Cast & World and Storyboard */}
      <div className="nodrag nowheel" style={{ padding: 10 }}>
        <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Your brief — kept verbatim</Text>
        <Input.TextArea className="nodrag nowheel" value={idea} onChange={(v) => onEditIdea && onEditIdea(id, v)} placeholder="Describe your film — one line, a paragraph, or paste a full script." autoSize={{ minRows: 3, maxRows: 18 }} style={{ ...dark, marginTop: 5 }} />
      </div>

      {/* the developed cinematic prompt — ONLY New Shot consumes this */}
      {writing ? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#86909c', fontSize: 12, borderTop: '1px solid #2a313a' }}>
          <IconLoading style={{ color: GOLD }} /> Writing the cinematic prompt…
        </div>
      ) : prompt ? (
        <div className="nodrag nowheel" style={{ padding: 10, borderTop: '1px solid #2a313a' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: GOLD, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Cinematic prompt — what 🎬 New Shot shoots</Text>
            {mode && <Tag size="small" color={mode === 'preserve' ? 'green' : 'arcoblue'}>{mode === 'preserve' ? 'events preserved' : 'expanded'}</Tag>}
          </span>
          <Input.TextArea className="nodrag nowheel" value={prompt} onChange={(v) => onEditPrompt && onEditPrompt(id, v)} autoSize={{ minRows: 6, maxRows: 22 }} style={{ ...dark, marginTop: 5 }} />
        </div>
      ) : null}

      <Text style={{ color: '#5a6472', fontSize: 10, padding: '0 10px 8px' }}>Everything reads the brief verbatim · Develop (opt-in) writes a cinematic prompt that New Shot uses instead.</Text>
    </div>
  );
};

export default memo(StoryScriptNode);
