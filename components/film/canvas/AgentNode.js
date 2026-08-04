import { createContext, memo, useContext } from 'react';
import { Button, Typography } from '@arco-design/web-react';
import { IconPlayArrow, IconSettings } from '@arco-design/web-react/icon';
import { AGENT_MAP } from '../../../utils/film/agents';
import { agentIcon } from './agentIcons';

const { Text } = Typography;

// Bridge from agent cards back to FilmCanvas (functions can't live in serializable
// node.data) — same context pattern as CutContext / StoryboardChatContext.
export const AgentNodeContext = createContext({
  onRun: null, imageAssets: [], runningIds: [],
});

// A COMPACT agent card: every agent is a board element, but it's configured in the
// LayerPanel — selecting the card opens the panel bound to it (the rail drops it
// pre-selected, so the tap flows straight into configuration). The card shows a
// settings summary + Run; its settings live in node.data.settings; outputs land
// beside it. Never render the full form here — the panel is the one form surface.

// One-line human summary of the card's current settings, per agent.
const summarize = (agentId, s, imageAssets) => {
  const prompt = String(s.prompt || '').trim();
  const label = (id) => (imageAssets.find((a) => a.id === id) || {}).label;
  switch (agentId) {
    case 'cast':
      return prompt || 'No idea typed — Run drafts from the selected Brief.';
    case 'previz':
      return (s.brief || '').trim() || 'No scene text — Run reads the selected Brief.';
    case 'audio':
      return `${(s.model || 'seedAudio') === 'seedAudio' ? 'Seed Audio 1.0' : 'Seed TTS 2.0'}${prompt ? ` · ${prompt}` : ' · no prompt yet'}`;
    case 'characterVariations':
    case 'locationVariations': {
      const anchor = s.anchorId ? (label(s.anchorId) || 'source picked') : 'no source image yet';
      return `${anchor} · ${s.count || 4} variations${s.direction ? ` · ${s.direction}` : ''}`;
    }
    case 'inspiration':
      return `${s.count || 6} moods${prompt ? ` · ${prompt}` : ' · no prompt yet'}${(s.refs || []).length ? ` · ${(s.refs || []).length} ref${(s.refs || []).length === 1 ? '' : 's'}` : ''}`;
    default:
      return prompt;
  }
};

// The anchor/mood thumbnail, when the agent has a single bound image.
const boundThumb = (agentId, s, imageAssets) => {
  const id = agentId === 'audio' ? s.imageRef : (agentId === 'characterVariations' || agentId === 'locationVariations') ? s.anchorId : '';
  if (!id) return null;
  return (imageAssets.find((a) => a.id === id) || {}).url || null;
};

const AgentNodeInner = ({ id, data, selected }) => {
  const { onRun, imageAssets, runningIds } = useContext(AgentNodeContext);
  const agent = AGENT_MAP[data.agentId];
  if (!agent) return null;
  const s = data.settings || {};
  const running = (runningIds || []).includes(id);
  const Icon = agentIcon(agent.icon);
  const thumb = boundThumb(data.agentId, s, imageAssets || []);
  return (
    <div style={{ width: 250, display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 10, border: `2px solid ${selected ? agent.color : '#d9d9e3'}`, boxShadow: selected ? `0 0 0 3px ${agent.color}22` : '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <div style={{ height: 4, background: agent.color }} />
      <div title={agent.describe} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid #f2f3f5' }}>
        <Icon style={{ color: agent.color, fontSize: 15, flexShrink: 0 }} />
        <Text bold style={{ fontSize: 12, flex: 1 }} ellipsis>{agent.label}</Text>
        {running && <Text type="secondary" style={{ fontSize: 10, flexShrink: 0 }}>running…</Text>}
      </div>
      <div style={{ padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {thumb && <img src={thumb} alt="" loading="lazy" decoding="async" style={{ width: 40, height: 40, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />}
        <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>
          {summarize(data.agentId, s, imageAssets || [])}
        </Text>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 8px' }}>
        <Text type="secondary" style={{ fontSize: 10, flex: 1, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <IconSettings style={{ fontSize: 11 }} /> select to configure
        </Text>
        <Button
          className="nodrag"
          type="primary" size="mini" icon={<IconPlayArrow />} loading={running}
          onClick={(e) => { e.stopPropagation(); if (onRun) onRun(id); }}
          style={{ background: agent.color, borderColor: agent.color }}
        >
          Run
        </Button>
      </div>
    </div>
  );
};

export default memo(AgentNodeInner);
