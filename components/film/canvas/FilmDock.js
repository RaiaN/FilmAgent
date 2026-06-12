import { useEffect, useRef, useState } from 'react';
import { Button, Input, Tooltip, Typography } from '@arco-design/web-react';
import { IconClose, IconUp, IconDown, IconDragDotVertical, IconLoading, IconRight, IconVideoCamera } from '@arco-design/web-react/icon';

const { Text } = Typography;

// The Film Director — Short Film mode's conversational front door (same philosophy
// as the Ad concierge: the conversation is the interface). You SAY what you want —
// "shoot the fox entering the cave", "give me wardrobe options for the guide",
// "what could happen next?" — an LLM router maps it to ONE studio action
// (film chunk / correct / approve / variations / inspiration / mix&match story
// moments / topic explorer), proposes it back in plain words, and a single tap
// dispatches it deterministically. LLM interprets; the user confirms; tools run.
const FilmDock = ({ onClose, onRoute, onDispatch, filming }) => {
  const scrollRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [routing, setRouting] = useState(false);
  const [working, setWorking] = useState(false);
  const [pending, setPending] = useState(null);   // { action, params, say } awaiting Do it
  const [beatChips, setBeatChips] = useState([]); // proposed next beats
  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  const midRef = useRef(0);
  const say = (from, text) => setMessages((m) => [...m, { id: (midRef.current += 1), from, text }]);

  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, pending, beatChips]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    say('agent', "🎬 I'm your director. Tell me what you want in plain words — “shoot the fox slipping into the cave”, “show me wardrobe options for the guide”, “what could happen next?”, “stage story moments of her across our locations” — and I'll line up the right tool. You confirm, I roll.");
  }, []);

  const busy = routing || working || (filming && filming.busy);

  const dispatch = async (action, params) => {
    setPending(null);
    setWorking(true);
    try {
      const out = await onDispatch(action, params);
      if (Array.isArray(out)) { // proposeBeats → pickable chips
        setBeatChips(out);
        say('agent', out.length ? 'Here’s what could happen next — pick one, or describe your own:' : "I couldn't come up with beats — describe the next moment yourself.");
      } else {
        say('agent', out || 'Done.');
      }
    } catch (err) {
      say('agent', `That didn't work: ${err.message}`);
    } finally {
      setWorking(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    say('user', text);
    setDraft('');
    setBeatChips([]);
    setPending(null);
    setRouting(true);
    try {
      const routed = await onRoute(text);
      if (!routed || routed.action === 'unknown') {
        say('agent', "I didn't catch which tool that needs. Try: a beat to shoot, a critique of the take, “variations of <character>”, “story moments across locations”, “explore <topic>” — or just ask me a question.");
        return;
      }
      // A question → the router answered it directly; no tool, no confirmation.
      if (routed.action === 'answer') { say('agent', routed.say || "I don't have a good answer for that — try asking differently."); return; }
      if (routed.action === 'proposeBeats') { await dispatch('proposeBeats', routed); return; }
      // Everything else: propose in plain words, act on one tap.
      setPending(routed);
      say('agent', routed.say || `I'll run ${routed.action}. Go?`);
    } catch (err) {
      say('agent', `Routing failed: ${err.message}`);
    } finally {
      setRouting(false);
    }
  };

  const pickBeat = (b) => {
    setBeatChips([]);
    setPending({ action: 'filmChunk', beat: b.prompt, say: `I'll film: ${b.prompt}` });
    say('user', b.title);
    say('agent', `I'll film: ${b.prompt} — go?`);
  };

  // ---- drag (bail on buttons so × works) ----
  const onDragStart = (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('button')) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onDragMove = (e) => { const d = dragRef.current; if (d) setPos({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) }); };
  const onDragEnd = (e) => { dragRef.current = null; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ } };

  return (
    <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 9, width: 340, maxWidth: 'calc(100% - 24px)', transform: `translate(${pos.x}px, ${pos.y}px)`, background: '#fff', border: '1px solid #e5e6eb', borderRadius: 12, boxShadow: '0 10px 34px rgba(0,0,0,0.16)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#b06f10', color: '#fff', cursor: 'grab', userSelect: 'none', touchAction: 'none', flexShrink: 0 }}>
        <IconDragDotVertical style={{ fontSize: 14, opacity: 0.85 }} />
        <Text style={{ color: '#fff', fontWeight: 700, fontSize: 13, flex: 1 }}>Film director</Text>
        <Tooltip content={collapsed ? 'Expand' : 'Collapse'}>
          <Button size="mini" type="text" style={{ color: '#fff' }} icon={collapsed ? <IconDown /> : <IconUp />} onClick={() => setCollapsed((v) => !v)} />
        </Tooltip>
        <Tooltip content="Close"><Button size="mini" type="text" style={{ color: '#fff' }} icon={<IconClose />} onClick={onClose} /></Tooltip>
      </div>

      {!collapsed && (
        <>
          <div ref={scrollRef} className="nowheel" style={{ overflowY: 'auto', padding: '12px 12px 6px', minHeight: 140, maxHeight: 'calc(82vh - 220px)' }}>
            {messages.map((m) => (
              <div key={m.id} style={{ display: 'flex', justifyContent: m.from === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                <div style={{ maxWidth: '85%', fontSize: 13, lineHeight: 1.45, padding: '7px 10px', borderRadius: 12, background: m.from === 'user' ? '#b06f10' : '#f2f3f5', color: m.from === 'user' ? '#fff' : '#1d2129', borderTopRightRadius: m.from === 'user' ? 3 : 12, borderTopLeftRadius: m.from === 'user' ? 12 : 3, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
              </div>
            ))}
            {beatChips.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {beatChips.map((b) => <Button key={b.title} size="mini" style={{ borderRadius: 14 }} title={b.prompt} onClick={() => pickBeat(b)}>✨ {b.title}</Button>)}
              </div>
            )}
            {pending && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <Button size="small" type="primary" loading={working} icon={<IconVideoCamera />} style={{ background: '#b06f10', borderColor: '#b06f10' }} onClick={() => dispatch(pending.action, pending)}>Do it</Button>
                <Button size="small" disabled={working} onClick={() => { setPending(null); say('user', 'Not that'); say('agent', 'Okay — tell me differently.'); }}>Not that</Button>
              </div>
            )}
          </div>
          <div style={{ borderTop: '1px solid #f2f3f5', padding: 10, flexShrink: 0 }}>
            <Input.TextArea
              value={draft}
              onChange={setDraft}
              disabled={busy && !pending}
              onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder='Direct in plain words — Enter to send (Shift+Enter = newline)'
              autoSize={{ minRows: 1, maxRows: 4 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 10 }}>{busy ? (routing ? 'Reading…' : 'Working…') : 'Routes to: shoot · correct · approve · beats · variations · story moments · inspiration · explore · sort — or just ask'}</Text>
              <Button size="small" type="primary" icon={busy && !pending ? <IconLoading /> : <IconRight />} disabled={!draft.trim() || (busy && !pending)} style={{ background: '#b06f10', borderColor: '#b06f10' }} onClick={send}>Send</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default FilmDock;
