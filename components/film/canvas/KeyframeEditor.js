import { useMemo, useState } from 'react';
import { Modal, Input, Select, Button, Typography, Message, Checkbox } from '@arco-design/web-react';
import { IconPlus, IconCheck } from '@arco-design/web-react/icon';
import { SHOT_TEMPLATES } from '../../../utils/film/recipes';

const { Text } = Typography;
const SHOT_OPTS = SHOT_TEMPLATES.map((t) => ({ label: t.name, value: t.id }));
const EXPR_OPTS = ['neutral', 'slight smile', 'smiling', 'laughing', 'surprised', 'shocked', 'angry', 'sad', 'crying', 'fearful', 'worried', 'determined', 'thoughtful'].map((e) => ({ label: e, value: e }));

// The Expand editor: see + edit ONE keyframe's whole shot — the [Image N] body, its references
// (toggle / add from the board), camera, expression — then Regenerate. (Duration is NOT here:
// a still has no duration; pacing edits belong to the chat revision and the promoted SHOT card.)
// Reference numbers are GLOBAL (the pool = [Image 1..N]); the canvas renumbers them to attach
// order at render time.
export default function KeyframeEditor({ shot = {}, pool = [], preview, loading, imageAssets = [], onClose, onSave, onRederive, onAddRef }) {
  const [body, setBody] = useState(String(shot.body || ''));
  const [figures, setFigures] = useState(Array.isArray(shot.figures) ? shot.figures : []);
  const [shotTemplate, setShotTemplate] = useState(shot.shotTemplate || 'medium-shot');
  const [expression, setExpression] = useState(shot.expression || '');
  const [rederiving, setRederiving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Structure lock (default ON when a frame exists): the CURRENT frame rides as the
  // leading reference with a strict-follow line — composition/camera/blocking are
  // preserved and the render changes ONLY what the text changes. Untick for a free
  // re-composition from text + refs alone.
  const [useFrame, setUseFrame] = useState(!!preview);

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
  const doRegenerate = () => onSave({ body: body.trim(), figures, shotTemplate, expression, useFrame: useFrame && !!preview });

  return (
    <Modal visible title={`Edit shot — ${shot.beat || 'keyframe'}`} onCancel={onClose} footer={null} style={{ width: 1040, maxWidth: '94vw' }} unmountOnExit>
      <div style={{ display: 'flex', gap: 18 }}>
        {/* The STILL is what's being judged — give it the room. */}
        <div style={{ flex: '1.15 1 0', minWidth: 0, alignSelf: 'flex-start' }}>
          {preview ? (
            <img src={preview} alt="keyframe" style={{ width: '100%', maxHeight: '68vh', objectFit: 'contain', borderRadius: 8, display: 'block', background: '#101418' }} />
          ) : (
            <div style={{ height: 280, background: '#f2f3f5', borderRadius: 8 }} />
          )}
          {loading && <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>Rendering…</Text>}
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
            <div onClick={() => setAddOpen((v) => !v)} title="Add a board image as a reference"
              style={{ width: 56, height: 56, borderRadius: 6, border: '2px dashed #c9cdd4', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#86909c' }}>
              <IconPlus />
            </div>
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
          <Text type="secondary" title={useFrame && preview ? 'The frame anchors the structure: the render keeps its composition and changes ONLY what this text changes. Address references as [Image N].' : undefined} style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            {useFrame && preview
              ? 'Edit instruction or full prompt'
              : 'Prompt (body) — describe the shot; address references as [Image N]'}
          </Text>
          <Input.TextArea value={body} onChange={setBody} autoSize={{ minRows: 4, maxRows: 10 }} style={{ marginBottom: 6 }} />
          <Button size="mini" loading={rederiving} onClick={doRederive} style={{ marginBottom: 12 }}>Re-derive body from references</Button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>Camera</Text>
              <Select size="small" showSearch value={shotTemplate} onChange={setShotTemplate} options={SHOT_OPTS} style={{ width: '100%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>Expression</Text>
              <Select size="small" allowClear allowCreate value={expression || undefined} onChange={(v) => setExpression(v || '')} options={EXPR_OPTS} style={{ width: '100%' }} />
            </div>
          </div>
          {preview && (
            <Checkbox checked={useFrame} onChange={setUseFrame} style={{ marginBottom: 12, display: 'block' }}>
              <Text style={{ fontSize: 12 }}>
                Use this frame as reference — keep its composition and figure positions; change <b>only</b> what the text changes (a Camera change reframes the same scene)
              </Text>
            </Checkbox>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose}>Close</Button>
            <Button type="primary" loading={loading} onClick={doRegenerate} title={useFrame && preview ? 'Edit IN PLACE — the frame anchors the structure; the text drives the change' : 'Re-compose from text + ticked references (fresh roll)'}>
              {useFrame && preview ? 'Apply edit' : 'Regenerate'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
