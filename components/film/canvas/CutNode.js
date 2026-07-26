import { createContext, memo, useContext, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Typography, Input, Select, Tag, Button, InputNumber, Checkbox } from '@arco-design/web-react';
import { IconLoading, IconExpand, IconEdit, IconEye, IconSync, IconSound, IconVideoCamera } from '@arco-design/web-react/icon';
import { BIBLE_ROLE_META, SHOT_TEMPLATES_BY_CATEGORY, SHOT_TEMPLATE_BY_ID } from '../../../utils/film/recipes';
import { VIDEO_MODEL_OPTIONS, RES_BY_MODEL, resDefault } from '../../../utils/film/suiteConfig';
import { BOARD_NODE_DRAG_TYPE, ASSET_DRAG_TYPE } from '../../../utils/film/libraryStore';
import PromptEditorModal from './PromptEditorModal';
import EditableLabel from './EditableLabel';

const { Text } = Typography;

// A SHOT card — the shot's SPEC on the board before generation (5–15s). The Story agent's
// prompt rides verbatim in the editable PROMPT field; CINEMATOGRAPHY (a 50-template picker
// or a hand-typed line), AUDIO and the Seedance 2.0 params shape it on top. The 🎬 button
// shoots a take of just this shot. (Node type stays 'cut' internally; user-facing it's a SHOT.)
export const CutContext = createContext({
  onPatchCut: null, bibleEntries: [], mediaEntries: [], onShootCut: null, onAttachAsset: null, onSplitCut: null, onDevelopCut: null, onPrevizCut: null, onRederiveCut: null,
});

const ROLE_COLOR = { character: '#722ed1', location: '#00b42a', prop: '#ff7d00', frame: '#f5319d' };

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
  const { onPatchCut, bibleEntries, mediaEntries, onShootCut, onAttachAsset, onSplitCut, onDevelopCut, onPrevizCut, onRederiveCut } = useContext(CutContext);
  const patch = (p) => onPatchCut && onPatchCut(id, p);
  const refIds = data.refIds || [];
  const assetRefs = data.assetRefs || [];
  // Seedance media references (plural — e.g. a camera-track video + a motion video +
  // music + two voice clips). Reads the earlier single-ref fields as a one-item array.
  const audioRefs = data.audioRefs || (data.audioRef ? [data.audioRef] : []);
  const videoRefs = data.videoRefs || (data.videoRef ? [data.videoRef] : []);
  const toggleRef = (entryId) => patch({ refIds: refIds.includes(entryId) ? refIds.filter((r) => r !== entryId) : [...refIds, entryId] });
  const removeAssetRef = (url) => patch({ assetRefs: assetRefs.filter((a) => a.url !== url) });
  const removeAudioRef = (url) => patch({ audioRefs: audioRefs.filter((a) => a.url !== url), audioRef: null });
  const removeVideoRef = (url) => patch({ videoRefs: videoRefs.filter((a) => a.url !== url), videoRef: null });
  const [dragOver, setDragOver] = useState(false);

  // The SHOT's title (data.beat) is inline-renamed via the shared EditableLabel. The beat
  // is the card's NAME; it only feeds the shoot prompt as a FALLBACK when PROMPT is empty.

  const durationSec = Math.min(15, Math.max(5, Math.round(Number(data.durationSec) || 10)));
  // Resolution is gated by the chosen Seedance endpoint: Mini caps at 720p, standard adds 4K.
  const videoModel = data.videoModel || 'seedance';
  const resOptions = RES_BY_MODEL[videoModel] || RES_BY_MODEL.seedance;
  const resolution = resOptions.includes(data.resolution) ? data.resolution : resDefault(videoModel);
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
      style={{ width: 500, background: '#101418', borderRadius: 10, border: `2px solid ${dragOver ? '#f7ba1e' : borderColor}`, boxShadow: selected ? '0 0 0 3px rgba(247,186,30,0.15)' : '0 1px 4px rgba(0,0,0,0.2)', overflow: 'hidden', color: '#fff' }}
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
        <EditableLabel
          value={data.beat}
          onCommit={(v) => patch({ beat: v })}
          placeholder="Shot"
          maxLength={60}
          title="Double-click to rename this shot"
          pencilColor="#5a6472"
          containerStyle={{ width: '100%' }}
          textStyle={{ color: '#f7ba1e', fontSize: 12, fontWeight: 700 }}
          inputStyle={{ fontSize: 12, fontWeight: 700, color: '#f7ba1e', background: '#161b22', borderColor: '#2a313a' }}
        />

        <div>
          <div style={{ marginBottom: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700 }}>PROMPT</Text>
            <span style={{ display: 'inline-flex', gap: 2 }}>
              <Button className="nodrag" size="mini" type="text" icon={<IconEye />} disabled={!onPrevizCut || data.splitting || data.developing} onClick={() => onPrevizCut && onPrevizCut(id)} style={{ color: '#9fb4d0', height: 18, padding: '0 4px' }} title="Previz — stage this shot as a photoreal blocking frame (this card's text + this card's attached refs only). Mask it on the frame into a color plate that guides 🎬.">Previz</Button>
              <Button className="nodrag" size="mini" type="text" icon={data.developing ? <IconLoading /> : <IconSync />} disabled={!onRederiveCut || data.developing || data.splitting} onClick={() => onRederiveCut && onRederiveCut(id)} style={{ color: '#9fb4d0', height: 18, padding: '0 4px' }} title="Re-derive — bind THIS prompt to the card's reference images: wording and structure preserved (Develop's output survives), matching subjects tagged [Image N] per the badge numbers. A FIRST FRAME lock stays; your previous text is stashed.">Re-derive</Button>
              {/* Develop (opt-in) — rewrite this prompt into a cinematic Seedance prompt; always
                  re-runs from the ORIGINAL text (stashed on first develop), never rewrite². */}
              <Button className="nodrag" size="mini" type="text" icon={data.developing ? <IconLoading /> : <IconEdit />} disabled={!onDevelopCut || data.developing || data.splitting} onClick={() => onDevelopCut && onDevelopCut(id)} style={{ color: '#9fb4d0', height: 18, padding: '0 4px' }} title="Develop — rewrite this prompt into one cinematic Seedance prompt (tight, close to your text; events preserved). Re-runs always start from your ORIGINAL text.">Develop</Button>
              <Button className="nodrag" size="mini" type="text" icon={<IconExpand />} onClick={() => setEditorOpen(true)} style={{ color: '#9fb4d0', height: 18, padding: '0 4px' }} title="Open the large editor — write in a big window and @-mention reference images">Expand</Button>
            </span>
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
            <Select className="nodrag" size="mini" value={videoModel} onChange={(v) => patch({ videoModel: v, ...((RES_BY_MODEL[v] || RES_BY_MODEL.seedance).includes(data.resolution) ? {} : { resolution: resDefault(v) }) })} options={VIDEO_MODEL_OPTIONS.map((o) => ({ label: o.label, value: o.key }))} style={{ width: 148 }} triggerProps={{ autoAlignPopupWidth: false }} title="Which Seedance endpoint shoots this shot — Mini is faster/cheaper (caps at 720p)" />
            <Select className="nodrag" size="mini" value={resolution} onChange={(v) => patch({ resolution: v })} options={resOptions.map((o) => ({ label: o, value: o }))} style={{ width: 76 }} triggerProps={{ autoAlignPopupWidth: false }} />
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
            {/* Seedance media refs — audio clips (music / voices) and videos (camera / motion),
                attached by tapping a ★-tagged offer chip below; click an attached chip to detach. */}
            {audioRefs.map((a) => (
              <span
                key={a.url}
                className="nodrag"
                onClick={() => removeAudioRef(a.url)}
                title={`${a.label || 'audio clip'} — reference audio (≤15s): the take realizes this sound. Click to detach.`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                  padding: '1px 6px', borderRadius: 10, fontSize: 10,
                  border: '1px solid rgba(120,22,255,0.55)', background: 'rgba(120,22,255,0.16)', color: '#c0a1ff',
                }}
              >
                <IconSound style={{ fontSize: 11 }} />
                {(a.label || 'audio').slice(0, 14)}{Number(a.duration) ? ` · ${Math.round(a.duration)}s` : ''}
              </span>
            ))}
            {videoRefs.map((v) => (
              <span
                key={v.url}
                className="nodrag"
                onClick={() => removeVideoRef(v.url)}
                title={`${v.label || 'video'} — reference video (≤15s): the take follows its camera / motion. Click to detach.`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                  padding: '1px 6px', borderRadius: 10, fontSize: 10,
                  border: '1px solid #165dff', background: 'rgba(22,93,255,0.15)', color: '#6ea0ff',
                }}
              >
                <IconVideoCamera style={{ fontSize: 11 }} />
                {(v.label || 'video').slice(0, 14)}
              </span>
            ))}
            {/* CANON media (★-tagged board audio/video) not yet on this shot — dim offer
                chips, one tap to attach into the arrays above. */}
            {(mediaEntries || [])
              .filter((m) => (m.kind === 'audio' ? !audioRefs.some((a) => a.url === m.url) : !videoRefs.some((v) => v.url === m.url)))
              .map((m) => (
                <span
                  key={`offer-${m.nodeId}`}
                  className="nodrag"
                  onClick={() => (m.kind === 'audio'
                    ? patch({ audioRefs: [...audioRefs, { nodeId: m.nodeId, url: m.url, label: m.label, duration: m.duration }], audioRef: null })
                    : patch({ videoRefs: [...videoRefs, { nodeId: m.nodeId, url: m.url, label: m.label }], videoRef: null }))}
                  title={`${m.label} — ★-tagged board ${m.kind}; click to attach as this shot's reference ${m.kind}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                    padding: '1px 6px', borderRadius: 10, fontSize: 10, opacity: 0.55,
                    border: `1px dashed ${m.kind === 'audio' ? 'rgba(120,22,255,0.7)' : '#165dff'}`,
                    color: m.kind === 'audio' ? '#c0a1ff' : '#6ea0ff', background: 'transparent',
                  }}
                >
                  {m.kind === 'audio' ? <IconSound style={{ fontSize: 11 }} /> : <IconVideoCamera style={{ fontSize: 11 }} />}
                  {(m.label || m.kind).slice(0, 14)}{m.kind === 'audio' && Number(m.duration) ? ` · ${Math.round(m.duration)}s` : ''}
                </span>
              ))}
            {(bibleEntries || []).length === 0 && assetRefs.length === 0 && (mediaEntries || []).length === 0 && <Text style={{ color: '#86909c', fontSize: 10 }}>no references yet — tag board assets (bible role / ★) or drop an image here</Text>}
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
