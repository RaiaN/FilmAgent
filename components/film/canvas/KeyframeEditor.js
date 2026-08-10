import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Input, Select, Button, Typography, Message, Checkbox } from '@arco-design/web-react';
import { IconPlus, IconCheck, IconLoading } from '@arco-design/web-react/icon';
import { SHOT_TEMPLATES } from '../../../utils/film/recipes';

const { Text } = Typography;
const SHOT_OPTS = SHOT_TEMPLATES.map((t) => ({ label: t.name, value: t.id }));
const EXPR_OPTS = ['neutral', 'slight smile', 'smiling', 'laughing', 'surprised', 'shocked', 'angry', 'sad', 'crying', 'fearful', 'worried', 'determined', 'thoughtful'].map((e) => ({ label: e, value: e }));

// The Expand editor: see + edit ONE keyframe's whole shot — the [Image N] body, its references
// (toggle / add from the board), camera, expression — then Regenerate. (Duration is NOT here:
// a still has no duration; pacing edits belong to the chat revision and the promoted SHOT card.)
// Reference numbers are GLOBAL (the pool = [Image 1..N]); the canvas renumbers them to attach
// order at render time.
export default function KeyframeEditor({ mode = 'shot', shot = {}, pool = [], preview, loading, imageAssets = [], onClose, onSave, onRederive, onAddRef, onSaveText, promptUsed }) {
  const [body, setBody] = useState(String(shot.body || ''));
  const [figures, setFigures] = useState(Array.isArray(shot.figures) ? shot.figures : []);
  const [shotTemplate, setShotTemplate] = useState(shot.shotTemplate || 'medium-shot');
  const [expression, setExpression] = useState(shot.expression || '');
  // The take's WORD fields (storyboard rows are display-only — this editor is where
  // they change by hand; Save words is FREE, no render).
  const [motion, setMotion] = useState(String(shot.motion || ''));
  const [exiting, setExiting] = useState(String(shot.exiting || ''));
  const [audio, setAudio] = useState(String(shot.audio || ''));
  const [rederiving, setRederiving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Structure lock (default ON when a frame exists): the CURRENT frame rides as the
  // leading reference with a strict-follow line — composition/camera/blocking are
  // preserved and the render changes ONLY what the text changes. Untick for a free
  // re-composition from text + refs alone.
  const [useFrame, setUseFrame] = useState(!!preview);
  // PENCIL MARKS (Seedream 5.0 Pro doodle-guided edit): freehand red strokes over the
  // preview say WHERE the change applies; they bake onto a copy of the frame at Apply
  // and the template tells the model to obey + remove them. Normalized (0..1) points.
  const [drawOn, setDrawOn] = useState(false);
  const [strokes, setStrokes] = useState([]);
  const drawingRef = useRef(false);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  useEffect(() => {
    const c = canvasRef.current; const w = wrapRef.current;
    if (!c || !w) return;
    const r = w.getBoundingClientRect();
    c.width = Math.max(1, Math.round(r.width)); c.height = Math.max(1, Math.round(r.height));
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = '#ff2d2d'; g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round';
    strokes.forEach((pts) => {
      g.beginPath();
      pts.forEach((pt, i) => (i ? g.lineTo(pt.x * c.width, pt.y * c.height) : g.moveTo(pt.x * c.width, pt.y * c.height)));
      g.stroke();
    });
  }, [strokes, drawOn, preview]);
  const strokePoint = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const bakeAnnotated = () => new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(im, 0, 0);
        g.strokeStyle = '#ff2d2d'; g.lineWidth = Math.max(4, Math.round(c.width * 0.005)); g.lineCap = 'round'; g.lineJoin = 'round';
        strokes.forEach((pts) => {
          g.beginPath();
          pts.forEach((pt, i) => (i ? g.lineTo(pt.x * c.width, pt.y * c.height) : g.moveTo(pt.x * c.width, pt.y * c.height)));
          g.stroke();
        });
        resolve(c.toDataURL('image/jpeg', 0.92));
      } catch { resolve(null); }
    };
    im.onerror = () => resolve(null);
    im.crossOrigin = 'anonymous';
    im.src = preview;
  });

  const toggleFig = (n) => setFigures((f) => (f.includes(n) ? f.filter((x) => x !== n) : [...f, n].sort((a, b) => a - b)));
  const inPool = useMemo(() => new Set(pool), [pool]);
  const addable = useMemo(() => imageAssets.filter((a) => !inPool.has(a.url)), [imageAssets, inPool]);

  const doRederive = async () => {
    setRederiving(true);
    try {
      const res = await onRederive(figures);
      if (res?.body) { setBody(res.body); if (res.expression) setExpression(res.expression); Message.success('Body re-derived from the references'); }
    } catch (e) { Message.error(e.message); } finally { setRederiving(false); }
  };
  const doAdd = async (url) => {
    try { const n = await onAddRef(url); if (n) { setFigures((f) => (f.includes(n) ? f : [...f, n].sort((a, b) => a - b))); setAddOpen(false); } }
    catch (e) { Message.error(e.message); }
  };
  const saveWords = (opts = {}) => {
    const edits = {};
    if (body.trim() !== String(shot.body || '')) edits.body = body.trim();
    if (shotTemplate !== (shot.shotTemplate || 'medium-shot')) edits.shotTemplate = shotTemplate;
    if (expression.trim() !== String(shot.expression || '')) edits.expression = expression.trim();
    if (JSON.stringify(figures) !== JSON.stringify(Array.isArray(shot.figures) ? shot.figures : [])) edits.figures = figures;
    if (motion.trim() !== String(shot.motion || '')) edits.motion = motion.trim();
    if (exiting.trim() !== String(shot.exiting || '')) { edits.exiting = exiting.trim(); edits.develops = !!exiting.trim(); }
    if (audio.trim() !== String(shot.audio || '')) edits.audio = audio.trim();
    if (!Object.keys(edits).length) { if (!opts.silent) Message.info('Nothing changed.'); return; }
    onSaveText(edits);
    if (!opts.silent) {
      Message.success(edits.exiting !== undefined
        ? (edits.exiting ? 'Words saved — the shot now DEVELOPS; its END frame renders with the still.' : 'Words saved — the shot now HOLDS (no END frame).')
        : 'Words saved — free, nothing rendered.');
    }
  };
  const saveAndRender = () => {
    saveWords({ silent: true });
    // The render call carries the render-relevant fields itself, so it never races
    // the word patch; motion/audio only ride the patch (they don't touch pixels).
    onSave({ body: body.trim(), figures, shotTemplate, expression, exiting: exiting.trim() });
  };
  const doRegenerate = async () => {
    let annotatedFrame = null;
    if (useFrame && preview && strokes.length) {
      annotatedFrame = await bakeAnnotated();
      if (!annotatedFrame) Message.warning('The marks could not be baked (image not readable) — applying the edit without them.');
    }
    onSave({ body: body.trim(), figures, shotTemplate, expression, useFrame: useFrame && !!preview, ...(annotatedFrame ? { annotatedFrame } : {}) });
  };

  return (
    <Modal visible title={`Edit shot — ${shot.beat || 'keyframe'}`} onCancel={onClose} footer={null} style={{ width: 1040, maxWidth: '94vw' }} unmountOnExit>
      <div style={{ display: 'flex', gap: 18 }}>
        {/* The STILL is what's being judged — give it the room. */}
        <div style={{ flex: '1.15 1 0', minWidth: 0, alignSelf: 'flex-start' }}>
          {preview ? (
            <div ref={wrapRef} style={{ position: 'relative' }}>
              <img src={preview} alt="keyframe" style={{ width: '100%', maxHeight: '68vh', objectFit: 'contain', borderRadius: 8, display: 'block', background: '#101418', opacity: loading ? 0.55 : 1 }} />
              {loading && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center', zIndex: 5, pointerEvents: 'none' }}>
                  <IconLoading style={{ fontSize: 28, color: '#165dff' }} />
                  <Text style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: 'rgba(16,20,24,0.7)', borderRadius: 4, padding: '2px 8px' }}>
                    {mode === 'frame' ? 'applying the edit…' : 'rendering the pair…'}
                  </Text>
                </div>
              )}
              <canvas
                ref={canvasRef}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: drawOn ? 'crosshair' : 'default', pointerEvents: drawOn ? 'auto' : 'none', touchAction: 'none' }}
                onPointerDown={(e) => { drawingRef.current = true; e.currentTarget.setPointerCapture(e.pointerId); setStrokes((st) => [...st, [strokePoint(e)]]); }}
                onPointerMove={(e) => { if (!drawingRef.current) return; setStrokes((st) => { const next = st.slice(); next[next.length - 1] = [...next[next.length - 1], strokePoint(e)]; return next; }); }}
                onPointerUp={() => { drawingRef.current = false; }}
              />
            </div>
          ) : (
            <div style={{ height: 280, background: '#f2f3f5', borderRadius: 8 }} />
          )}
          {mode === 'frame' && preview && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
              <Button size="mini" type={drawOn ? 'primary' : 'secondary'} onClick={() => setDrawOn((v) => !v)} style={drawOn ? { background: '#ff2d2d', borderColor: '#ff2d2d' } : {}}>
                {drawOn ? 'Drawing…' : '✏ Draw on frame'}
              </Button>
              {strokes.length > 0 && <Button size="mini" onClick={() => setStrokes([])}>Clear marks</Button>}
              {strokes.length > 0 && <Text type="secondary" style={{ fontSize: 11 }}>marks show WHERE the edit applies — removed from the result</Text>}
            </div>
          )}
          {loading && <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>Rendering…</Text>}
          {promptUsed && (
            <div style={{ marginTop: 10 }}>
              <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Prompt used — the exact text this frame was rendered with</Text>
              <Input.TextArea readOnly value={promptUsed} autoSize={{ minRows: 2, maxRows: 7 }} style={{ fontSize: 11, background: '#f7f8fa' }} />
            </div>
          )}
        </div>
        <div style={{ flex: '1 1 0', minWidth: 320 }}>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>References — tick which appear in this shot (the prompt refers to them as [Image N])</Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {pool.map((url, i) => {
              const n = i + 1; const on = figures.includes(n);
              return (
                <div key={n} onClick={() => toggleFig(n)} title={`[Image ${n}]`}
                  style={{ position: 'relative', width: 56, height: 56, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: on ? '2px solid #165dff' : '2px solid #e5e6eb' }}>
                  <img src={url} alt={`Image ${n}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: on ? 1 : 0.5 }} />
                  <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, fontSize: 9, textAlign: 'center', background: 'rgba(0,0,0,0.55)', color: '#fff' }}>[{n}]</span>
                  {on && <IconCheck style={{ position: 'absolute', top: 2, right: 2, color: '#fff', background: '#165dff', borderRadius: '50%', fontSize: 12, padding: 1 }} />}
                </div>
              );
            })}
            {onAddRef && (
              <div onClick={() => setAddOpen((v) => !v)} title="Add a board image as a reference"
                style={{ width: 56, height: 56, borderRadius: 6, border: '2px dashed #c9cdd4', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#86909c' }}>
                <IconPlus />
              </div>
            )}
          </div>
          {addOpen && (
            <div style={{ marginBottom: 10, padding: 8, border: '1px solid #e5e6eb', borderRadius: 6, maxHeight: 132, overflowY: 'auto' }}>
              {addable.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 11 }}>No other board images. Drop character / prop images on the board first.</Text>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {addable.map((a) => (
                    <img key={a.id} src={a.url} alt={a.label} title={a.label} onClick={() => doAdd(a.url)}
                      style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: '1px solid #e5e6eb' }} />
                  ))}
                </div>
              )}
            </div>
          )}
          <Text type="secondary" title={mode === 'frame' ? 'The frame anchors the structure: the render keeps its composition and changes ONLY what this text changes. Address references as [Image N].' : undefined} style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            {mode === 'frame'
              ? 'Edit instruction — change only what you name; address references as [Image N]'
              : 'Frame text — what the still renders from; address references as [Image N]'}
          </Text>
          <Input.TextArea value={body} onChange={setBody} autoSize={{ minRows: 4, maxRows: 10 }} style={{ marginBottom: 6 }} />
          {onRederive && <Button size="mini" loading={rederiving} onClick={doRederive} style={{ marginBottom: 12 }}>Re-derive body from references</Button>}
          {onSaveText && (
            <div style={{ marginBottom: 12, padding: '8px 10px', border: '1px solid #e5e6eb', borderRadius: 6 }}>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>Action — what the take performs; dialogue in {'{'}curly braces{'}'}</Text>
              <Input.TextArea value={motion} onChange={setMotion} autoSize={{ minRows: 2, maxRows: 6 }} style={{ marginBottom: 6 }} />
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>End state — one on-screen sentence; empty = HOLD, written = DEVELOPS (chained END frame)</Text>
              <Input.TextArea value={exiting} onChange={setExiting} autoSize={{ minRows: 1, maxRows: 3 }} style={{ marginBottom: 6 }} />
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>Audio —（music） &lt;sfx&gt; {'{'}dialogue{'}'}</Text>
              <Input value={audio} onChange={setAudio} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>Camera</Text>
              <Select size="small" showSearch value={shotTemplate} onChange={setShotTemplate} options={SHOT_OPTS} style={{ width: '100%' }} />
            </div>
            {mode === 'shot' && (
              <div style={{ flex: 1 }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>Expression</Text>
                <Select size="small" allowClear allowCreate value={expression || undefined} onChange={(v) => setExpression(v || '')} options={EXPR_OPTS} style={{ width: '100%' }} />
              </div>
            )}
          </div>
          {mode === 'frame' && preview && (
            <Checkbox checked={useFrame} onChange={setUseFrame} style={{ marginBottom: 12, display: 'block' }}>
              <Text style={{ fontSize: 12 }}>
                Use this frame as reference — keep its composition and figure positions; change <b>only</b> what the text changes (a Camera change reframes the same scene)
              </Text>
            </Checkbox>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose}>Close</Button>
            {mode === 'shot' && onSaveText && (
              <Button onClick={() => saveWords()} title="Write every changed field back to the shot — free, nothing renders; changed frame/end text marks the stills stale">Save</Button>
            )}
            {mode === 'shot' && (
              <Button type="primary" loading={loading} onClick={saveAndRender} title="Save every field AND re-render the pair from them now — 1 image, +1 chained END on a developing shot">
                Render
              </Button>
            )}
            {mode === 'frame' && (
              <Button type="primary" loading={loading} onClick={doRegenerate} title={useFrame && preview ? 'Edit IN PLACE — the frame anchors the structure; the text drives the change' : 'Re-compose from text + ticked references (fresh roll)'}>
                {useFrame && preview ? 'Apply edit' : 'Regenerate'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
