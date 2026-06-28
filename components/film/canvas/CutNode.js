import { createContext, memo, useContext, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Typography, Input, Select, Tag, Button, InputNumber, Checkbox } from '@arco-design/web-react';
import { IconLoading, IconExpand } from '@arco-design/web-react/icon';
import { BIBLE_ROLE_META, SHOT_TEMPLATES_BY_CATEGORY, SHOT_TEMPLATE_BY_ID } from '../../../utils/film/recipes';
import { BOARD_NODE_DRAG_TYPE, ASSET_DRAG_TYPE } from '../../../utils/film/libraryStore';
import PromptEditorModal from './PromptEditorModal';

const { Text } = Typography;

// A SHOT card — the shot's SPEC on the board before generation (5–15s). The Story agent's
// prompt rides verbatim in the editable PROMPT field; CINEMATOGRAPHY (a 50-template picker
// or a hand-typed line), AUDIO and the Seedance 2.0 params shape it on top. The 🎬 button
// shoots a take of just this shot. (Node type stays 'cut' internally; user-facing it's a SHOT.)
export const CutContext = createContext({
  onPatchCut: null, bibleEntries: [], onShootCut: null, onAttachSelected: null, onAttachAsset: null,
});

const ROLE_COLOR = { character: '#722ed1', location: '#00b42a', prop: '#ff7d00', look: '#0aa8a8', frame: '#f5319d' };

// Visual state of the cut as it shoots (border + header tag).
const CUT_STATUS = {
  running: { color: '#165dff', label: 'rolling…' },
  shot: { color: '#00b42a', label: 'shot ✓' },
  failed: { color: '#f53f3f', label: 'failed' },
};

const MAX_CUT_REFS = 9; // Seedream's reference-image limit — first 9 feed the shot

const promptArea = {
  fontSize: 11, lineHeight: '15px', color: '#cdd3dc', background: '#161b22',
  border: '1px solid #2a313a', borderRadius: 4, fontFamily: 'inherit',
};

// Leading "image index" badge on a reference chip — its position in the Seedance send order
// (so the chip labelled 2 IS Image2 in the prompt).
const REF_BADGE = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  minWidth: 13, height: 13, padding: '0 3px', borderRadius: 7,
  background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 9, fontWeight: 800, lineHeight: '13px',
};

const CutNodeInner = ({ id, data, selected }) => {
  const { onPatchCut, bibleEntries, onShootCut, onAttachSelected, onAttachAsset } = useContext(CutContext);
  const patch = (p) => onPatchCut && onPatchCut(id, p);
  const refIds = data.refIds || [];
  const assetRefs = data.assetRefs || [];
  const toggleRef = (entryId) => patch({ refIds: refIds.includes(entryId) ? refIds.filter((r) => r !== entryId) : [...refIds, entryId] });
  const removeAssetRef = (url) => patch({ assetRefs: assetRefs.filter((a) => a.url !== url) });
  const [dragOver, setDragOver] = useState(false);

  const durationSec = Math.min(15, Math.max(5, Math.round(Number(data.durationSec) || 10)));
  // CINEMATOGRAPHY pin = pick one of the 50 shot templates (sets the whole line) OR
  // hand-type. Picking stores the template id (so the dropdown highlights it) + its
  // name (cinePreset, for display) + the cinematography line.
  const pickTemplate = (id) => { const t = SHOT_TEMPLATE_BY_ID[id]; if (t) patch({ shotTemplate: t.id, cinePreset: t.name, cinematography: t.cinematography }); };

  const status = CUT_STATUS[data.status] || null;
  const borderColor = selected ? '#f7ba1e' : (status ? status.color : '#2a313a');
  const refTotal = refIds.length + assetRefs.length;

  // Index each reference by its ACTUAL send order (= "Image1…N" in the Seedance prompt):
  // enabled bible refs in refIds order, then per-shot assets. Each sent chip shows its image
  // number so the prompt can address "Image1" etc. without guessing which plate is which.
  const sentBibleIds = refIds.filter((rid) => (bibleEntries || []).some((b) => b.id === rid && b.url));
  const bibleImageIndex = (entryId) => { const i = sentBibleIds.indexOf(entryId); return i < 0 ? null : i + 1; };
  const assetImageIndex = (j) => sentBibleIds.length + j + 1;

  const [editorOpen, setEditorOpen] = useState(false);
  // Every reference the editor's @-picker can offer: ALL bible plates (with a url) + the
  // per-shot assets. `index` = its current Image number when already enabled/sent on this
  // shot, else null — picking a not-yet-enabled plate in the editor ATTACHES it (adds it to
  // refIds, giving it the next index) AND inserts its tag. So @ always lists the cast/world,
  // even on a fresh card whose references aren't toggled on yet. Built ONLY while the editor
  // is open (it's an O(bible) pass) — closed cards skip it entirely.
  const attachableRefs = editorOpen ? [
    ...(bibleEntries || []).filter((b) => b.url).map((b) => ({ id: b.id, name: b.name || BIBLE_ROLE_META[b.role]?.label || 'cast', url: b.url, index: bibleImageIndex(b.id) })),
    ...assetRefs.map((a, j) => ({ id: `asset:${a.url}`, name: a.label || 'asset', url: a.url, index: assetImageIndex(j) })).filter((r) => r.index <= MAX_CUT_REFS),
  ] : [];
  const attachRef = (refId) => { if (refId && !String(refId).startsWith('asset:') && !refIds.includes(refId)) patch({ refIds: [...refIds, refId] }); };

  // Drop a board asset / Library item straight onto the card to feed it to this shot.
  const carries = (e) => e.dataTransfer.types.includes(BOARD_NODE_DRAG_TYPE) || e.dataTransfer.types.includes(ASSET_DRAG_TYPE);
  const onDragOver = (e) => { if (!onAttachAsset || !carries(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dragOver) setDragOver(true); };
  const onDrop = (e) => {
    setDragOver(false);
    if (!onAttachAsset) return;
    const raw = e.dataTransfer.getData(BOARD_NODE_DRAG_TYPE) || e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    try {
      const d = JSON.parse(raw);
      const url = d.url || d.thumb;
      if (url) onAttachAsset(id, { nodeId: d.id || null, url, label: d.label || d.name || 'asset' });
    } catch { /* ignore foreign payloads */ }
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      style={{ width: 300, background: '#101418', borderRadius: 10, border: `2px solid ${dragOver ? '#f7ba1e' : borderColor}`, boxShadow: selected ? '0 0 0 3px rgba(247,186,30,0.15)' : '0 1px 4px rgba(0,0,0,0.2)', overflow: 'hidden', color: '#fff' }}
    >
      {/* invisible target handle — the asset→cut prerequisite edges land here */}
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} />
      {/* slate header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'repeating-linear-gradient(135deg, #1d2530 0 12px, #f7ba1e 12px 24px)', borderBottom: '1px solid #2a313a' }}>
        <Tag size="small" style={{ background: '#101418', color: '#f7ba1e', border: 'none', fontWeight: 700 }}>SHOT {(data.cut ?? 0) + 1}</Tag>
        {status && (
          <Tag size="small" style={{ background: '#101418', color: status.color, border: 'none', fontWeight: 700 }}>
            {data.status === 'running' ? <IconLoading style={{ marginRight: 3 }} /> : null}{status.label}
          </Tag>
        )}
        <span style={{ flex: 1 }} />
        {/* The SHOT's length — one configurable duration (5–15s), the single source of
            truth for how long this shot runs (drives shotFromCard). */}
        <span title="Shot duration in seconds (5–15)" style={{ display: 'inline-flex' }}>
          <InputNumber
            className="nodrag"
            size="mini"
            min={5}
            max={15}
            step={1}
            value={durationSec}
            onChange={(v) => patch({ durationSec: Math.min(15, Math.max(5, Math.round(Number(v) || 10))) })}
            suffix="s"
            style={{ width: 72 }}
          />
        </span>
        <Button
          className="nodrag"
          size="mini"
          title="Shoot a take — drops an in-progress video on the board. Click again for more takes (they run in parallel, no waiting)."
          disabled={!onShootCut}
          onClick={() => onShootCut && onShootCut(id)}
          style={{ background: '#101418', color: '#f7ba1e', border: '1px solid #f7ba1e', fontWeight: 700, padding: '0 6px' }}
        >
          🎬
        </Button>
      </div>

      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Text style={{ color: '#f7ba1e', fontSize: 12, fontWeight: 700 }}>{data.beat || 'Shot'}</Text>

        <div>
          <div style={{ marginBottom: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700 }}>PROMPT</Text>
            <Button className="nodrag" size="mini" type="text" icon={<IconExpand />} onClick={() => setEditorOpen(true)} style={{ color: '#9fb4d0', height: 18, padding: '0 4px' }} title="Open the large editor — write in a big window and @-mention reference images">Expand</Button>
          </div>
          <Input.TextArea className="nodrag nowheel" value={data.promptOverride || ''} onChange={(v) => patch({ promptOverride: v })} placeholder="the shot's cinematic prompt — Expand to @-mention references" autoSize={{ minRows: 4, maxRows: 14 }} style={promptArea} />
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
            <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700 }}>CINEMATOGRAPHY</Text>
            <Select className="nodrag" size="mini" value={data.shotTemplate || undefined} placeholder="shot ▾" onChange={pickTemplate} style={{ width: 130 }} triggerProps={{ autoAlignPopupWidth: false }} showSearch filterOption={(input, option) => String(option.props.children).toLowerCase().includes(input.toLowerCase())}>
              {SHOT_TEMPLATES_BY_CATEGORY.map(({ category, templates }) => (
                <Select.OptGroup key={category} label={category}>
                  {templates.map((t) => <Select.Option key={t.id} value={t.id}>{t.name}</Select.Option>)}
                </Select.OptGroup>
              ))}
            </Select>
          </div>
          <Input.TextArea className="nodrag nowheel" value={data.cinematography || ''} onChange={(v) => patch({ cinematography: v, cinePreset: 'Custom', shotTemplate: undefined })} placeholder="lens · DOF · light · grain · grade · movement" autoSize={{ minRows: 2, maxRows: 4 }} style={promptArea} />
        </div>

        <div>
          <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700, display: 'block', marginBottom: 2 }}>AUDIO <span style={{ color: '#5a6472', fontWeight: 400 }}>· optional</span></Text>
          <Input.TextArea className="nodrag nowheel" value={data.audio || ''} onChange={(v) => patch({ audio: v })} placeholder="dialogue · ambient · foley · score" autoSize={{ minRows: 1, maxRows: 3 }} style={promptArea} />
        </div>

        <div>
          <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700, display: 'block', marginBottom: 3 }}>SEEDANCE 2.0 PARAMS</Text>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Select className="nodrag" size="mini" value={data.resolution || '1080p'} onChange={(v) => patch({ resolution: v })} options={['480p', '720p', '1080p'].map((o) => ({ label: o, value: o }))} style={{ width: 76 }} triggerProps={{ autoAlignPopupWidth: false }} />
            <Select className="nodrag" size="mini" value={data.ratio || 'adaptive'} onChange={(v) => patch({ ratio: v })} options={['adaptive', '16:9', '9:16', '1:1', '4:3', '21:9'].map((o) => ({ label: o, value: o }))} style={{ width: 92 }} triggerProps={{ autoAlignPopupWidth: false }} />
            <Checkbox className="nodrag" checked={data.generateAudio !== false} onChange={(c) => patch({ generateAudio: c })}><Text style={{ fontSize: 10, color: '#9fb4d0' }}>audio</Text></Checkbox>
            <InputNumber className="nodrag" size="mini" placeholder="seed" value={data.seed ?? undefined} onChange={(v) => patch({ seed: v == null || v === '' ? null : Math.round(Number(v)) })} style={{ width: 88 }} />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700 }}>REFERENCES → [Image1…N] · click to toggle</Text>
            {refTotal > MAX_CUT_REFS && <Text style={{ color: '#f53f3f', fontSize: 9 }}>first {MAX_CUT_REFS} feed the shot</Text>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(bibleEntries || []).map((b) => {
              const onCut = refIds.includes(b.id);
              const imgIdx = onCut ? bibleImageIndex(b.id) : null;
              const sent = imgIdx != null && imgIdx <= MAX_CUT_REFS;
              return (
                <span
                  key={b.id}
                  className="nodrag"
                  onClick={() => toggleRef(b.id)}
                  title={`${sent ? `Image${imgIdx} · ` : ''}${BIBLE_ROLE_META[b.role]?.label || b.role}: ${b.name || ''} — ${onCut ? 'click to remove' : 'click to add'}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                    padding: '1px 6px', borderRadius: 10, fontSize: 10,
                    border: `1px solid ${ROLE_COLOR[b.role] || '#86909c'}`,
                    background: onCut ? (ROLE_COLOR[b.role] || '#86909c') : 'transparent',
                    color: onCut ? '#fff' : (ROLE_COLOR[b.role] || '#86909c'),
                    opacity: onCut ? 1 : 0.55,
                  }}
                >
                  {sent && <b style={REF_BADGE}>{imgIdx}</b>}
                  {b.url ? <img src={b.url} alt="" loading="lazy" decoding="async" style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} /> : null}
                  {(b.name || BIBLE_ROLE_META[b.role]?.label || b.role).slice(0, 14)}
                </span>
              );
            })}
            {/* Non-bible board assets attached to JUST this shot — per-shot refs, not canon. */}
            {assetRefs.map((a, j) => {
              const imgIdx = assetImageIndex(j);
              const sent = imgIdx <= MAX_CUT_REFS;
              return (
                <span
                  key={a.url}
                  className="nodrag"
                  onClick={() => removeAssetRef(a.url)}
                  title={`${sent ? `Image${imgIdx} · ` : ''}${a.label || 'asset'} — attached to this shot only; click to remove`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                    padding: '1px 6px', borderRadius: 10, fontSize: 10,
                    border: '1px solid #e5e6eb', background: '#e5e6eb', color: '#1d2129',
                  }}
                >
                  {sent && <b style={REF_BADGE}>{imgIdx}</b>}
                  {a.url ? <img src={a.url} alt="" loading="lazy" decoding="async" style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} /> : null}
                  {(a.label || 'asset').slice(0, 14)}
                </span>
              );
            })}
            {onAttachSelected && (
              <span
                className="nodrag"
                onClick={() => onAttachSelected(id)}
                title="Attach the board images you have selected to this shot (or drag any asset onto the card)"
                style={{
                  display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                  padding: '1px 6px', borderRadius: 10, fontSize: 10,
                  border: '1px dashed #86909c', color: '#86909c',
                }}
              >
                + board selection
              </span>
            )}
            {(bibleEntries || []).length === 0 && assetRefs.length === 0 && <Text style={{ color: '#86909c', fontSize: 10 }}>no assets yet — tag bible roles or drop an image here</Text>}
          </div>
        </div>
      </div>
      {editorOpen && (
        <PromptEditorModal
          open
          value={data.promptOverride || ''}
          references={attachableRefs}
          onAttach={attachRef}
          maxRefs={MAX_CUT_REFS}
          onChange={(v) => patch({ promptOverride: v })}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
};

export default memo(CutNodeInner);
