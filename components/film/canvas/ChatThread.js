import { useEffect, useRef, useState } from 'react';
import { Input, Typography } from '@arco-design/web-react';
import { IconLoading, IconSend } from '@arco-design/web-react/icon';

const { Text } = Typography;

// A minimal chat thread — a scrollable message list (director / agent bubbles) + an input.
// Self-contained and presentational: the parent owns the messages and handles onSend. Used by
// the Storyboard (shot-division) chat node; kept generic so other conversational nodes can reuse it.
const ChatThread = ({ messages = [], onSend, busy = false, placeholder = 'Tell me how to revise the shots…' }) => {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, busy]);

  const submit = () => {
    const t = draft.trim();
    if (!t || busy) return;
    setDraft('');
    onSend(t);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div ref={scrollRef} className="nowheel" onWheel={(e) => e.stopPropagation()} style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {messages.map((m, i) => {
          const mine = m.from === 'you';
          return (
            <div key={i} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
              <div style={{
                fontSize: 12, lineHeight: '17px', padding: '5px 9px', borderRadius: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                background: mine ? '#165dff' : '#f2f3f5', color: mine ? '#fff' : '#1d2129',
              }}>{m.text}</div>
            </div>
          );
        })}
        {busy && (
          <div style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, color: '#86909c' }}>
            <IconLoading /><Text style={{ fontSize: 11, color: '#86909c' }}>thinking…</Text>
          </div>
        )}
      </div>
      <div className="nodrag" style={{ borderTop: '1px solid #f0f0f3', padding: 8, display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        <Input.TextArea
          value={draft}
          onChange={setDraft}
          onPressEnter={(e) => { e.preventDefault(); submit(); }}
          placeholder={placeholder}
          autoSize={{ minRows: 1, maxRows: 4 }}
          style={{ fontSize: 12 }}
          disabled={busy}
        />
        <span
          onClick={submit}
          title="Send"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, flexShrink: 0, cursor: busy ? 'default' : 'pointer', background: busy ? '#e5e6eb' : '#165dff', color: '#fff' }}
        >
          <IconSend />
        </span>
      </div>
    </div>
  );
};

export default ChatThread;
