import { createContext, memo, useContext, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Typography, Input, Select, Tag, Button } from '@arco-design/web-react';
import { IconLoading } from '@arco-design/web-react/icon';
import { AD_ROLE_META, CAMERA_MOVES, cutPromptSeed } from '../../../utils/film/recipes';
import { buildAnimatePrompt } from '../../../utils/film/core/operations';
import { BOARD_NODE_DRAG_TYPE, ASSET_DRAG_TYPE } from '../../../utils/film/libraryStore';

const { Text } = Typography;

// A CUT card — the shot's SPEC, on the board, BEFORE generation. The director's
// slate: which beat, how long, what the shot SHOWS (content), the camera template +
// in-frame motion (the Seedance prompt), and which assets feed it. Nothing is a
// black box: the card previews the FULL keyframe-writer seed and the FULL Seedance
// prompt exactly as they'll be sent. The 🎬 button shoots just this cut; "🎬 Action"
// in the concierge shoots the rest and assembles.
export const CutContext = createContext({
  onPatchCut: null, bibleEntries: [], shared: {}, onShootCut: null, onAttachSelected: null, onAttachAsset: null,
});

const ROLE_COLOR = { product: '#165dff', brand: '#f5319d', talent: '#722ed1', look: '#0aa8a8', location: '#00b42a', prop: '#ff7d00' };

// Visual state of the cut as it shoots (border + header tag).
const CUT_STATUS = {
  running: { color: '#165dff', label: 'rolling…' },
  shot: { color: '#00b42a', label: 'shot ✓' },
  failed: { color: '#f53f3f', label: 'failed' },
};

const MAX_CUT_REFS = 9; // Seedream's reference-image limit — first 9 feed the shot

const previewBox = {
  fontSize: 10, lineHeight: '14px', color: '#a9aebb', background: '#161b22',
  border: '1px dashed #2a313a', borderRadius: 4, padding: '4px 6px',
  maxHeight: 76, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
};

const CutNodeInner = ({ id, data, selected }) => {
  const { onPatchCut, bibleEntries, shared, onShootCut, onAttachSelected, onAttachAsset } = useContext(CutContext);
  const patch = (p) => onPatchCut && onPatchCut(id, p);
  const refIds = data.refIds || [];
  const assetRefs = data.assetRefs || [];
  const toggleRef = (entryId) => patch({ refIds: refIds.includes(entryId) ? refIds.filter((r) => r !== entryId) : [...refIds, entryId] });
  const removeAssetRef = (url) => patch({ assetRefs: assetRefs.filter((a) => a.url !== url) });
  const [dragOver, setDragOver] = useState(false);

  const status = CUT_STATUS[data.status] || null;
  const borderColor = selected ? '#f7ba1e' : (status ? status.color : '#2a313a');
  const refTotal = refIds.length + assetRefs.length;

  // The FULL seed the keyframe writer will get (content + the shared context every
  // cut carries) and the FULL prompt Seedance will get — shown, never hidden.
  const fullSeed = cutPromptSeed({ content: data.prompt, beat: data.beat, ...(shared || {}) });
  const seedancePrompt = buildAnimatePrompt({ motion: data.motion, camera: data.camera });

  // Drop a board asset / Library item straight onto the card to feed it to this cut.
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
        <Tag size="small" style={{ background: '#101418', color: '#f7ba1e', border: 'none', fontWeight: 700 }}>CUT {(data.cut ?? 0) + 1}</Tag>
        {status && (
          <Tag size="small" style={{ background: '#101418', color: status.color, border: 'none', fontWeight: 700 }}>
            {data.status === 'running' ? <IconLoading style={{ marginRight: 3 }} /> : null}{status.label}
          </Tag>
        )}
        <span style={{ flex: 1 }} />
        <Select
          className="nodrag"
          size="mini"
          value={data.durationSec || 10}
          onChange={(v) => patch({ durationSec: v })}
          options={[10, 12, 15].map((d) => ({ label: `${d}s`, value: d }))}
          style={{ width: 64 }}
          triggerProps={{ autoAlignPopupWidth: false }}
        />
        <Button
          className="nodrag"
          size="mini"
          title={data.status === 'running' ? 'Shooting…' : (data.shotUrl ? 'Re-shoot this cut' : 'Shoot this cut now')}
          disabled={data.status === 'running' || !onShootCut}
          onClick={() => onShootCut && onShootCut(id)}
          style={{ background: '#101418', color: '#f7ba1e', border: '1px solid #f7ba1e', fontWeight: 700, padding: '0 6px' }}
        >
          🎬
        </Button>
      </div>

      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Text style={{ color: '#f7ba1e', fontSize: 12, fontWeight: 700 }}>{data.beat || 'Shot'}</Text>

        <div>
          <Text style={{ color: '#86909c', fontSize: 10, display: 'block', marginBottom: 2 }}>CONTENT — what this shot shows</Text>
          <Input.TextArea
            className="nodrag nowheel"
            value={data.prompt || ''}
            onChange={(v) => patch({ prompt: v })}
            placeholder="subject, action, framing — specific to this shot"
            autoSize={{ minRows: 2, maxRows: 5 }}
            style={{ fontSize: 11, background: '#1a212b', color: '#e5e6eb', border: '1px solid #2a313a' }}
          />
        </div>

        <div>
          <Text style={{ color: '#86909c', fontSize: 10, display: 'block', marginBottom: 2 }}>FULL PROMPT → keyframe writer (with the assets below as references)</Text>
          <div className="nodrag nowheel" style={previewBox}>{fullSeed}</div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ width: 118, flexShrink: 0 }}>
            <Text style={{ color: '#86909c', fontSize: 10, display: 'block', marginBottom: 2 }}>CAMERA</Text>
            <Select
              className="nodrag"
              size="mini"
              value={data.camera || 'auto'}
              onChange={(v) => patch({ camera: v })}
              options={CAMERA_MOVES.map((c) => ({ label: c, value: c }))}
              style={{ width: '100%' }}
              triggerProps={{ autoAlignPopupWidth: false }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Text style={{ color: '#86909c', fontSize: 10, display: 'block', marginBottom: 2 }}>MOTION — action in the frame</Text>
            <Input
              className="nodrag"
              size="mini"
              value={data.motion || ''}
              onChange={(v) => patch({ motion: v })}
              placeholder="what moves, and how"
              style={{ fontSize: 11, background: '#1a212b', color: '#e5e6eb', border: '1px solid #2a313a' }}
            />
          </div>
        </div>

        <div>
          <Text style={{ color: '#86909c', fontSize: 10, display: 'block', marginBottom: 2 }}>FULL PROMPT → Seedance (moves the keyframe)</Text>
          <div className="nodrag nowheel" style={{ ...previewBox, maxHeight: 48 }}>{seedancePrompt}</div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={{ color: '#86909c', fontSize: 10 }}>ASSETS FEEDING THIS CUT — click to toggle</Text>
            {refTotal > MAX_CUT_REFS && <Text style={{ color: '#f53f3f', fontSize: 9 }}>first {MAX_CUT_REFS} feed the shot</Text>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(bibleEntries || []).map((b) => {
              const onCut = refIds.includes(b.id);
              return (
                <span
                  key={b.id}
                  className="nodrag"
                  onClick={() => toggleRef(b.id)}
                  title={`${AD_ROLE_META[b.role]?.label || b.role}: ${b.name || ''} — ${onCut ? 'click to remove' : 'click to add'}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                    padding: '1px 6px', borderRadius: 10, fontSize: 10,
                    border: `1px solid ${ROLE_COLOR[b.role] || '#86909c'}`,
                    background: onCut ? (ROLE_COLOR[b.role] || '#86909c') : 'transparent',
                    color: onCut ? '#fff' : (ROLE_COLOR[b.role] || '#86909c'),
                    opacity: onCut ? 1 : 0.55,
                  }}
                >
                  {b.url ? <img src={b.url} alt="" style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} /> : null}
                  {(b.name || AD_ROLE_META[b.role]?.label || b.role).slice(0, 14)}
                </span>
              );
            })}
            {/* Non-bible board assets the user attached to JUST this cut (a picked
                variation, a fresh generation) — per-cut refs, not canon. */}
            {assetRefs.map((a) => (
              <span
                key={a.url}
                className="nodrag"
                onClick={() => removeAssetRef(a.url)}
                title={`${a.label || 'asset'} — attached to this cut only; click to remove`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                  padding: '1px 6px', borderRadius: 10, fontSize: 10,
                  border: '1px solid #e5e6eb', background: '#e5e6eb', color: '#1d2129',
                }}
              >
                {a.url ? <img src={a.url} alt="" style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} /> : null}
                {(a.label || 'asset').slice(0, 14)}
              </span>
            ))}
            {onAttachSelected && (
              <span
                className="nodrag"
                onClick={() => onAttachSelected(id)}
                title="Attach the board images you have selected to this cut (or drag any asset onto the card)"
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
    </div>
  );
};

export default memo(CutNodeInner);
