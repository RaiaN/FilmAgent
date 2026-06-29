import { createContext, memo, useContext } from 'react';
import { Typography } from '@arco-design/web-react';
import { IconMessage } from '@arco-design/web-react/icon';
import ChatThread from './ChatThread';

const { Text } = Typography;

// Bridge from the chat node back to FilmCanvas's turn handler (functions can't live in
// serializable node.data) — same context pattern as CutContext / StoryScriptContext.
export const StoryboardChatContext = createContext({ onTurn: null });

// The Storyboard agent's conversational element: a chat bound to a column of SHOT cards. You
// brainstorm the shot division; each message runs ONE turn (onTurn → FilmCanvas) that updates
// the bound cards and appends the agent's reply. The shots themselves live on the cards (the
// column to the right), not here — this node only holds the conversation.
const StoryboardChatNodeInner = ({ id, data, selected }) => {
  const { onTurn } = useContext(StoryboardChatContext);
  const messages = data.messages || [];
  const count = data.shotCount || 0;
  return (
    <div style={{ width: 320, height: 380, display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 10, border: `2px solid ${selected ? '#4e5969' : '#d9d9e3'}`, boxShadow: selected ? '0 0 0 3px rgba(78,89,105,0.12)' : '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <div style={{ height: 4, background: '#4e5969' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid #f2f3f5' }}>
        <IconMessage style={{ color: '#4e5969', fontSize: 14 }} />
        <Text bold style={{ fontSize: 12, flex: 1 }} ellipsis>Storyboard · shot division</Text>
        {count > 0 && <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{count} {count === 1 ? 'shot' : 'shots'}</Text>}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatThread messages={messages} busy={!!data.busy} onSend={(text) => onTurn && onTurn(id, text)} />
      </div>
    </div>
  );
};

export default memo(StoryboardChatNodeInner);
