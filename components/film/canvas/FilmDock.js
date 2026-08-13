import { useEffect, useRef, useState } from 'react';
import { Button, Input, Tooltip, Typography } from '@arco-design/web-react';
import { IconClose, IconUp, IconDown, IconDragDotVertical, IconLoading, IconRight, IconVideoCamera } from '@arco-design/web-react/icon';

const { Text } = Typography;

// The Film Director Assistant — Short Film mode's conversational front door. You SAY what
// you want — "write a story about…", "draft the cast", "storyboard it", "variations of the
// guide" — and Seed 2.0 Pro maps it to exactly ONE agent, proposes
// it back in plain words, and a single tap dispatches it. Questions about the film it answers
// itself (in character, grounded in the board). Independent of the pipeline strip (status only).
const FilmDock = ({ onReset, onRoute, onDispatch, progress }) => {
  const scrollRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [routing, setRouting] = useState(false);
  const [working, setWorking] = useState(false);
  const [pending, setPending] = useState(null);   // { action, params, say } awaiting Do it
  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  const midRef = useRef(0);
  const say = (from, text) => setMessages((m) => [...m, { id: (midRef.current += 1), from, text }]);

  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, pending]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    say('agent', '🎬 I\'m your director. Tell me what you want — write a story, draft the cast & world, storyboard it, variations, stitch the film — and I\'ll line up the move for one tap. Or just ask me about the film.');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live narration from the engine (keyframe ready / QC verdicts / take landed /
  // failures) — printed the moment each stage actually happens.
  const progSeqRef = useRef(0);
  useEffect(() => {
    if (progress && progress.seq > progSeqRef.current) {
      progSeqRef.current = progress.seq;
      say('agent', progress.text);
    }
  }, [progress]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = routing || working;

  const dispatch = async (action, params) => {
    setPending(null);
    setWorking(true);
    try {
      const out = await onDispatch(action, params);
      if (out && typeof out === 'object' && out.say) {
        // Guided next step: the dispatch explains AND offers the follow-up action
        // as the pending one-tap (e.g. storyboard with nothing cast → draft a cast).
        say('agent', out.say);
        if (out.next) { setPending(out.next); say('agent', `${out.next.say || out.next.action} — go?`); }
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
    setChoices([]);
    setPending(null);
    setRouting(true);
    try {
      const routed = await onRoute(text);
      if (!routed || routed.action === 'unknown') {
        say('agent', "I didn't catch which move that needs. Try: “write a story about …”, “draft the cast”, “storyboard it”, “variations of <character>”, “stitch” — or just ask me about the film.");
        return;
      }
      // A question → the router answered it directly; no tool, no confirmation.
      if (routed.action === 'answer') { say('agent', routed.say || "I don't have a good answer for that — try asking differently."); return; }
      // Everything else: propose in plain words, act on one tap.
      setPending(routed);
      say('agent', routed.say || `I'll run ${routed.action}. Go?`);
    } catch (err) {
      say('agent', `Routing failed: ${err.message}`);
    } finally {
      setRouting(false);
    }
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
        <Text style={{ color: '#fff', fontWeight: 700, fontSize: 13, flex: 1 }}>Film Director Assistant</Text>
        <Tooltip content={collapsed ? 'Expand' : 'Collapse'}>
          <Button size="mini" type="text" style={{ color: '#fff' }} icon={collapsed ? <IconDown /> : <IconUp />} onClick={() => setCollapsed((v) => !v)} />
        </Tooltip>
        <Tooltip content="Reset — back to “What are we making?”"><Button size="mini" type="text" style={{ color: '#fff' }} icon={<IconClose />} onClick={() => onReset && onReset()} /></Tooltip>
      </div>

      {!collapsed && (
        <>
          <div ref={scrollRef} className="nowheel" style={{ overflowY: 'auto', padding: '12px 12px 6px', minHeight: 140, maxHeight: 'calc(82vh - 220px)' }}>
            {messages.map((m) => (
              <div key={m.id} style={{ display: 'flex', justifyContent: m.from === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                <div style={{ maxWidth: '85%', fontSize: 13, lineHeight: 1.45, padding: '7px 10px', borderRadius: 12, background: m.from === 'user' ? '#b06f10' : '#f2f3f5', color: m.from === 'user' ? '#fff' : '#1d2129', borderTopRightRadius: m.from === 'user' ? 3 : 12, borderTopLeftRadius: m.from === 'user' ? 12 : 3, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
              </div>
            ))}
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
              <Text type="secondary" style={{ fontSize: 10 }}>{busy ? (routing ? 'Reading…' : 'Working…') : 'Routes to: story · cast · storyboard · variations · stitch · inspiration · sort — or ask'}</Text>
              <Button size="small" type="primary" icon={busy && !pending ? <IconLoading /> : <IconRight />} disabled={!draft.trim() || (busy && !pending)} style={{ background: '#b06f10', borderColor: '#b06f10' }} onClick={send}>Send</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default FilmDock;
