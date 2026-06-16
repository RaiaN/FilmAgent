import { createContext, memo, useContext, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Typography, Input, Select, Tag, Button } from '@arco-design/web-react';
import { IconLoading } from '@arco-design/web-react/icon';
import { AD_ROLE_META, CAMERA_MOVES, cutPromptSeed, composeSeedancePrompt, shotReferences, SHOT_TEMPLATES_BY_CATEGORY, SHOT_TEMPLATE_BY_ID } from '../../../utils/film/recipes';
import { buildAnimatePrompt } from '../../../utils/film/core/operations';
import { BOARD_NODE_DRAG_TYPE, ASSET_DRAG_TYPE } from '../../../utils/film/libraryStore';

const { Text } = Typography;

// A SHOT card — the shot's SPEC, on the board, BEFORE generation (5–15s, internally
// a sequence of cuts ≤5–6s). The director's slate: how long, what the shot SHOWS,
// the camera template + in-frame motion, and which assets feed it. Nothing is a
// black box: the FULL prompt that goes to the model is shown AND editable —
// auto-composed from the fields, sent verbatim (data.promptOverride / seedOverride).
// The 🎬 button shoots just this shot; "🎬 Action" in the concierge shoots the rest.
// (Node type stays 'cut' internally; user-facing it's a SHOT.)
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

// The prompt is an EDITABLE field, not a read-only preview: what shows is what's
// sent, and the user can rewrite it. The dark styling matches the slate card.
const promptArea = {
  fontSize: 11, lineHeight: '15px', color: '#cdd3dc', background: '#161b22',
  border: '1px solid #2a313a', borderRadius: 4, fontFamily: 'inherit',
};
const resetLink = { cursor: 'pointer', color: '#f7ba1e', fontSize: 9, flexShrink: 0 };

const CutNodeInner = ({ id, data, selected }) => {
  const { onPatchCut, bibleEntries, shared, onShootCut, onAttachSelected, onAttachAsset } = useContext(CutContext);
  const patch = (p) => onPatchCut && onPatchCut(id, p);
  const refIds = data.refIds || [];
  const assetRefs = data.assetRefs || [];
  const toggleRef = (entryId) => patch({ refIds: refIds.includes(entryId) ? refIds.filter((r) => r !== entryId) : [...refIds, entryId] });
  const removeAssetRef = (url) => patch({ assetRefs: assetRefs.filter((a) => a.url !== url) });
  const [dragOver, setDragOver] = useState(false);

  // SHOT DESCRIPTION pin = a list of CUTs (≤6s each). Granular, individually editable.
  // Migrate a pre-pins card (single data.prompt) into one cut so its text isn't lost.
  const cuts = (data.cuts && data.cuts.length)
    ? data.cuts
    : (data.prompt ? [{ action: data.prompt, seconds: Math.min(6, data.durationSec || 5) }] : [{ action: '', seconds: 5 }]);
  const setCut = (i, p) => patch({ cuts: cuts.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const addCut = () => patch({ cuts: [...cuts, { action: '', seconds: 5 }] });
  const removeCut = (i) => patch({ cuts: cuts.filter((_, j) => j !== i) });
  const totalSec = cuts.reduce((s, c) => s + (Number(c.seconds) || 0), 0);
  // CINEMATOGRAPHY pin = pick one of the 50 shot templates (sets the whole line) OR
  // hand-type. Picking stores the template id (so the dropdown highlights it) + its
  // name (cinePreset, for display) + the cinematography line.
  const pickTemplate = (id) => { const t = SHOT_TEMPLATE_BY_ID[id]; if (t) patch({ shotTemplate: t.id, cinePreset: t.name, cinematography: t.cinematography }); };

  const status = CUT_STATUS[data.status] || null;
  const borderColor = selected ? '#f7ba1e' : (status ? status.color : '#2a313a');
  const refTotal = refIds.length + assetRefs.length;

  // Two card kinds. DIRECT (film/SHOT cards): the prompt is COMPOSED from the pins
  // (references + cuts + cinematography + audio) into the Seedance 2.0 format — the
  // same composer the engine uses, so the preview equals what's sent. AD cards run a
  // two-model pipeline (keyframe writer → Seedance) and keep their two override
  // prompts. "Edited" = a non-empty override → clearing snaps back to auto.
  const direct = !!data.direct;
  const seedanceComposed = direct
    ? composeSeedancePrompt({ references: shotReferences(data, bibleEntries), cuts, cinematography: data.cinematography || '', audio: data.audio || '' })
    : '';
  const autoSeed = direct ? '' : cutPromptSeed({ content: data.prompt, beat: data.beat, ...(shared || {}) });
  const autoSeedance = direct ? '' : buildAnimatePrompt({ motion: data.motion, camera: data.camera });
  const seedEdited = !direct && typeof data.seedOverride === 'string' && data.seedOverride.trim() !== '';
  const seedanceEdited = !direct && typeof data.promptOverride === 'string' && data.promptOverride.trim() !== '';
  const seedValue = seedEdited ? data.seedOverride : autoSeed;
  const seedanceValue = seedanceEdited ? data.promptOverride : autoSeedance;

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
        <Tag size="small" style={{ background: '#101418', color: '#f7ba1e', border: 'none', fontWeight: 700 }}>SHOT {(data.cut ?? 0) + 1}</Tag>
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
          options={[5, 8, 10, 12, 15].map((d) => ({ label: `${d}s`, value: d }))}
          style={{ width: 64 }}
          triggerProps={{ autoAlignPopupWidth: false }}
        />
        <Button
          className="nodrag"
          size="mini"
          title={data.status === 'running' ? 'Shooting…' : (data.shotUrl ? 'Re-shoot this shot' : 'Shoot this shot now')}
          disabled={data.status === 'running' || !onShootCut}
          onClick={() => onShootCut && onShootCut(id)}
          style={{ background: '#101418', color: '#f7ba1e', border: '1px solid #f7ba1e', fontWeight: 700, padding: '0 6px' }}
        >
          🎬
        </Button>
      </div>

      {/* the photoreal storyboard frame — cast placed in the location. It rides to the
          video model as a composition reference (the real plates ride too). While it
          renders, show a placeholder so the card isn't visibly empty. */}
      {data.sketchUrl ? (
        <img src={data.sketchUrl} alt={data.beat || 'frame'} style={{ width: '100%', display: 'block', borderBottom: '1px solid #2a313a' }} />
      ) : data.sketching ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 96, borderBottom: '1px solid #2a313a', background: '#161b22', color: '#86909c', fontSize: 11 }}>
          <IconLoading style={{ color: '#f7ba1e' }} /> composing the frame…
        </div>
      ) : null}

      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Text style={{ color: '#f7ba1e', fontSize: 12, fontWeight: 700 }}>{data.beat || 'Shot'}</Text>

        {direct ? (
          <>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 3 }}>
                <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700 }}>SHOT DESCRIPTION · cuts</Text>
                <Text style={{ color: totalSec > 15 ? '#f53f3f' : '#5a6472', fontSize: 9 }}>{totalSec}s total</Text>
              </div>
              {cuts.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 5, alignItems: 'flex-start' }}>
                  <span style={{ color: '#5a6472', fontSize: 10, width: 12, flexShrink: 0, paddingTop: 5 }}>{i + 1}</span>
                  <Input.TextArea className="nodrag nowheel" value={c.action || ''} onChange={(v) => setCut(i, { action: v })} placeholder="what happens in this cut" autoSize={{ minRows: 1, maxRows: 4 }} style={{ ...promptArea, flex: 1 }} />
                  <Select className="nodrag" size="mini" value={c.seconds || 5} onChange={(v) => setCut(i, { seconds: v })} options={[3, 4, 5, 6].map((s) => ({ label: `${s}s`, value: s }))} style={{ width: 54, flexShrink: 0 }} triggerProps={{ autoAlignPopupWidth: false }} />
                  {cuts.length > 1 && <Button className="nodrag" size="mini" type="text" status="danger" onClick={() => removeCut(i)} style={{ flexShrink: 0, padding: '0 3px' }}>×</Button>}
                </div>
              ))}
              {totalSec < 15 && <Button className="nodrag" size="mini" type="text" onClick={addCut} style={{ color: '#86909c', padding: '0 4px', fontSize: 11 }}>+ cut</Button>}
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
              <Text style={{ color: '#5a6472', fontSize: 9, display: 'block', marginBottom: 2 }}>→ SEEDANCE 2.0 (composed — exactly what's sent)</Text>
              <div className="nodrag nowheel" style={{ ...promptArea, color: '#7e8794', maxHeight: 92, overflowY: 'auto', whiteSpace: 'pre-wrap', padding: '5px 7px' }}>{seedanceComposed}</div>
            </div>
          </>
        ) : (
          <>
            <div>
              <Text style={{ color: '#86909c', fontSize: 10, display: 'block', marginBottom: 2 }}>WHAT HAPPENS</Text>
              <Input.TextArea
                className="nodrag nowheel"
                value={data.prompt || ''}
                onChange={(v) => patch({ prompt: v })}
                placeholder="one plain sentence — who does what, where"
                autoSize={{ minRows: 2, maxRows: 5 }}
                style={{ fontSize: 11, background: '#1a212b', color: '#e5e6eb', border: '1px solid #2a313a' }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 }}>
                <Text style={{ color: '#86909c', fontSize: 10 }}>PROMPT → keyframe writer (assets below = references)</Text>
                {seedEdited && <span className="nodrag" onClick={() => patch({ seedOverride: null })} title="Revert to the auto-composed prompt" style={resetLink}>↺ auto</span>}
              </div>
              <Input.TextArea
                className="nodrag nowheel"
                value={seedValue}
                onChange={(v) => patch({ seedOverride: v })}
                autoSize={{ minRows: 2, maxRows: 5 }}
                style={promptArea}
              />
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
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 }}>
                <Text style={{ color: '#f7ba1e', fontSize: 10, fontWeight: 700 }}>PROMPT → SEEDANCE · moves the keyframe</Text>
                {seedanceEdited && <span className="nodrag" onClick={() => patch({ promptOverride: null })} title="Revert to the prompt composed from the fields above" style={resetLink}>↺ auto</span>}
              </div>
              <Input.TextArea
                className="nodrag nowheel"
                value={seedanceValue}
                onChange={(v) => patch({ promptOverride: v })}
                autoSize={{ minRows: 2, maxRows: 6 }}
                placeholder="what the camera sees and how it moves"
                style={{ ...promptArea, borderColor: seedanceEdited ? '#f7ba1e' : '#2a313a' }}
              />
              {seedanceEdited && (
                <Text style={{ color: '#86909c', fontSize: 9, display: 'block', marginTop: 2 }}>
                  Manual prompt — the fields above no longer compose it. Assets below still feed the shot. ↺ to revert.
                </Text>
              )}
            </div>
          </>
        )}

        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700 }}>REFERENCES → [Image1…N] {direct && data.sketchUrl ? '+ storyboard frame' : ''} · click to toggle</Text>
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
                title={`${a.label || 'asset'} — attached to this shot only; click to remove`}
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
    </div>
  );
};

export default memo(CutNodeInner);
