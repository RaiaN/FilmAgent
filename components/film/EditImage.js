import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@arco-design/web-react';
import { C, MONO } from '../studio/ui';
import { bakeMarks, drawStrokes } from '../../utils/film/marks';

// THE EDIT IMAGE WORKBENCH: draw on a picture to say where, write what changes. It collects your
// input and renders nothing: "Use this" hands the marks and words to the session, which does the work.
export const EditImage = ({ result, words = '', onCancel, onUse }) => {
  const [strokes, setStrokes] = useState([]);
  const [text, setText] = useState(words);
  const [problem, setProblem] = useState('');
  const [sending, setSending] = useState(false);
  const canvas = useRef(null);
  const wrap = useRef(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = canvas.current;
    const w = wrap.current;
    if (!c || !w) return;
    const r = w.getBoundingClientRect();
    c.width = Math.max(1, Math.round(r.width));
    c.height = Math.max(1, Math.round(r.height));
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    drawStrokes(g, strokes, c.width, c.height);
  }, [strokes]);
  const point = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const use = async () => {
    if (!text.trim()) { setProblem('Say what changes.'); return; }
    setProblem('');
    setSending(true);
    let marked = null;
    if (strokes.length) {
      marked = await bakeMarks(result.url, strokes);
      if (!marked) { setProblem('The marks could not be put on this picture. Nothing was sent.'); setSending(false); return; }
    }
    try {
      await onUse({ words: text.trim(), marked });
    } catch (e) {
      setProblem(e.message);
      setSending(false);
    }
  };
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flex: '0 0 auto', fontSize: 15, color: C.ink }}>
        <b>Edit image</b>
        <span style={{ fontFamily: MONO, color: C.accent, fontWeight: 700 }}>{result.name}</span>
        <span style={{ color: C.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.title}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', flex: '0 0 auto', background: '#08090b', borderRadius: 12, overflow: 'hidden' }}>
        <div ref={wrap} style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
          <img src={result.url} alt={result.name} draggable={false} onLoad={() => setStrokes((x) => [...x])} style={{ display: 'block', maxWidth: '100%', maxHeight: '62vh', userSelect: 'none' }} />
          <canvas
            ref={canvas}
            aria-label="Draw where the edit goes"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair', touchAction: 'none' }}
            onPointerDown={(e) => { drawing.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); setStrokes((st) => [...st, [point(e)]]); }}
            onPointerMove={(e) => { if (!drawing.current) return; setStrokes((st) => { const next = st.slice(); next[next.length - 1] = [...next[next.length - 1], point(e)]; return next; }); }}
            onPointerUp={() => { drawing.current = false; }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: C.text, flex: '0 0 auto' }}>
        <span>{strokes.length ? 'Your marks show where the change goes. They won’t be in the result.' : 'Draw on the picture to show where, or just describe it.'}</span>
        {strokes.length > 0 && <span role="button" className="st-ghost" onClick={() => setStrokes((st) => st.slice(0, -1))} style={{ cursor: 'pointer', textDecoration: 'underline' }}>Undo</span>}
        {strokes.length > 0 && <span role="button" className="st-ghost" onClick={() => setStrokes([])} style={{ cursor: 'pointer', textDecoration: 'underline' }}>Clear</span>}
      </div>
      <Input.TextArea aria-label="What changes" autoFocus value={text} onChange={setText} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="What changes, e.g. make the wreath red" style={{ fontSize: 15, flex: '0 0 auto' }} />
      {problem && <div style={{ color: C.bad, fontSize: 13, flex: '0 0 auto' }}>{problem}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flex: '0 0 auto' }}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="primary" loading={sending} onClick={use}>Use this</Button>
      </div>
    </div>
  );
};
