import { createContext, memo, useContext, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Typography, Input, Select, Tag, Button, InputNumber, Checkbox, Popover, Modal } from '@arco-design/web-react';
import { IconLoading, IconExpand, IconEdit, IconEye, IconSync, IconSound, IconMessage, IconVideoCamera } from '@arco-design/web-react/icon';
import { BIBLE_ROLE_META, SHOT_TEMPLATES_BY_CATEGORY, SHOT_TEMPLATE_BY_ID } from '../../../utils/film/recipes';
import { VIDEO_MODEL_OPTIONS, RES_BY_MODEL, resDefault, maxShotSeconds, videoModelKeyOf } from '../../../utils/film/suiteConfig';
import { ENRICH_LEVELS } from '../../../utils/film/core/storyboard';
import { BOARD_NODE_DRAG_TYPE, ASSET_DRAG_TYPE } from '../../../utils/film/libraryStore';
import PromptEditorModal from './PromptEditorModal';
import EditableLabel from './EditableLabel';

const { Text } = Typography;

// A SHOT card — the shot's SPEC on the board before generation (5–15s). The Story agent's
// prompt rides verbatim in the editable PROMPT field; CINEMATOGRAPHY (a 50-template picker
// or a hand-typed line), AUDIO and the Seedance 2.0 params shape it on top. The 🎬 button
// shoots a take of just this shot. (Node type stays 'cut' internally; user-facing it's a SHOT.)
export const CutContext = createContext({
  onPatchCut: null, bibleEntries: [], mediaEntries: [], onShootCut: null, onAttachAsset: null, onSplitCut: null, onComposeCut: null, onEnrichCut: null, onDirectCut: null, onOpenTakes: null, boardImages: [], prevTakeFrames: {}, onCompilePreview: null,
});

// One visual-grounding anchor slot (START | END): shows its picked still, or a dashed
// ＋ tile. Clicking opens a board-image picker — the anchor is a normal board still,
// nothing is generated here. Setting an anchor flips the card's shoot onto the
// composition-pinned Seedance grammar (probe-verified); clearing it flips back.
const AnchorSlot = ({ label, value, images, onPick, onClear }) => {
  const [open, setOpen] = useState(false);
  const grid = (list) => list.map((im) => (
    <img
      key={im.nodeId || im.url}
      src={im.url}
      alt={im.label}
      title={im.label}
      loading="lazy"
      decoding="async"
      onClick={() => { onPick(im); setOpen(false); }}
      style={{ width: 76, height: 43, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: im.onCard ? '1px solid #3491fa' : '1px solid #2a313a' }}
    />
  ));
  const picker = (
    <div className="nodrag nowheel" style={{ width: 252, maxHeight: 260, overflowY: 'auto', padding: 2 }}>
      {(images || []).length > 0 && <Text style={{ display: 'block', fontSize: 9, fontWeight: 700, color: '#9fb4d0', margin: '2px 0 4px' }}>THIS CARD'S REFERENCES</Text>}
      {(images || []).length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{grid(images)}</div>}
    </div>
  );
  return (
    <Popover trigger="click" position="bl" popupVisible={open} onVisibleChange={setOpen} content={picker} color="#161b22">
      <div
        className="nodrag"
        title={value?.url ? `${label} keyframe: ${value.label || 'board still'} — click to swap` : `Add keyframe ${label} — the shot passes through the picked compositions in order`}
        style={{
          position: 'relative', width: 104, height: 58, borderRadius: 5, cursor: 'pointer', overflow: 'hidden',
          border: value?.url ? '1px solid #3491fa' : '1px dashed #3c4553', background: '#101418',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {value?.url ? (
          <>
            <img src={value.url} alt={label} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            <span style={{ position: 'absolute', left: 3, top: 2, fontSize: 8, fontWeight: 700, color: '#fff', background: 'rgba(16,20,24,0.75)', borderRadius: 3, padding: '0 4px' }}>{label}</span>
            <span
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              title={`Clear the ${label} keyframe`}
              style={{ position: 'absolute', right: 2, top: 1, fontSize: 10, color: '#fff', background: 'rgba(16,20,24,0.75)', borderRadius: 3, padding: '0 4px', cursor: 'pointer' }}
            >✕</span>
          </>
        ) : (
          <span style={{ fontSize: 10, color: '#7a8699', fontWeight: 700 }}>＋ {label}</span>
        )}
      </div>
    </Popover>
  );
};

const ROLE_COLOR = { character: '#722ed1', location: '#00b42a', prop: '#ff7d00', frame: '#f5319d' };

// Text fields draft LOCALLY and commit on blur: routing every keystroke through the
// React Flow store makes the controlled value arrive back a beat late, which resets
// the caret to the end. External updates (Compose/Direct/Enrich) still flow in
// whenever the field isn't focused.
const DraftText = ({ value, onCommit, textarea = false, ...rest }) => {
  const [draft, setDraft] = useState(null); // null = not editing → show live value
  const commit = () => { if (draft !== null && draft !== (value || '')) onCommit(draft); setDraft(null); };
  const C = textarea ? Input.TextArea : Input;
  return (
    <C
      {...rest}
      value={draft !== null ? draft : (value || '')}
      onChange={(v) => setDraft(v)}
      onFocus={() => setDraft(value || '')}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.target.blur(); }}
    />
  );
};

// Visual state of the cut as it shoots (border + header tag).
// 'failed' is deliberately absent: individual takes fail and that's fine — the take
// itself carries its error in the Take Library; the card never wears a failure.
const CUT_STATUS = {
  running: { color: '#165dff', label: 'rolling…' },
  shot: { color: '#00b42a', label: 'shot ✓' },
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
  const { onPatchCut, bibleEntries, mediaEntries, onShootCut, onAttachAsset, onSplitCut, onComposeCut, onEnrichCut, onDirectCut, onOpenTakes, boardImages, prevTakeFrames, onCompilePreview } = useContext(CutContext);
  const refIds = data.refIds || [];
  const assetRefs = data.assetRefs || [];
  // Anchor picker palette: THIS CARD'S references lead (its chips = the palette),
  // then the previous take's last frame, then the whole board. Picking a board image
  // adopts it into the card's send list implicitly (one tap, no attach dance).
  const cardRefImages = [
    ...(bibleEntries || []).filter((b) => (data.refIds || []).includes(b.id) && b.url)
      .map((b) => ({ nodeId: b.nodeId || null, url: b.url, assetId: b.assetId || null, label: b.name || b.role, onCard: true })),
    ...(data.assetRefs || []).filter((a) => a.url)
      .map((a) => ({ nodeId: a.nodeId || null, url: a.url, assetId: a.assetId || null, label: a.label || 'ref', onCard: true })),
  ];
  // STRICT rule: keyframes pick from the card's ENABLED chips ONLY.
  // Board images reach the card through REFERENCES (drag onto the card / attach),
  // never through this picker — a keyframe is always a pointer to a visible chip.
  const kfImages = cardRefImages; // chips-only pool — every keyframe tile picks from here
  // A KEYFRAME is a POINTER to an enabled chip (never a second send). Picking a
  // non-chip image (board still, prev-take frame) auto-attaches it as a chip first,
  // so the invariant holds with one tap. Slot labels resolve the pointer's LIVE
  // [Image i]; a pointer whose chip is gone shows a warning instead of a number.
  const sentBibleIds = refIds.filter((rid) => (bibleEntries || []).some((b) => b.id === rid && b.url));
  const sentList = [
    ...sentBibleIds.map((rid) => { const b = (bibleEntries || []).find((x) => x.id === rid); return { url: b?.url, nodeId: b?.nodeId }; }),
    ...assetRefs.map((a) => ({ url: a.url, nodeId: a.nodeId })),
  ];
  const kfIndex = (a) => {
    if (!a || !a.url) return 0;
    const i = sentList.findIndex((r) => (a.nodeId && r.nodeId === a.nodeId) || r.url === a.url);
    return i < 0 ? 0 : i + 1;
  };
  // ORDERED KEYFRAME LIST: K1 opens, Kn closes, middles pass through in order.
  // Legacy start/end fields fold in for old cards; any write migrates to the list.
  const kfs = (Array.isArray(data.keyframes) && data.keyframes.length)
    ? data.keyframes
    : [data.startAnchor, data.endAnchor].filter((a) => a && a.url);
  const setKfs = (arr) => patch({ keyframes: arr, startAnchor: null, endAnchor: null });
  const kfPtr = (im) => ({ nodeId: im.nodeId || null, url: im.url, label: im.label || '', pickedAt: Date.now() });
  const appendKf = (im) => setKfs([...kfs, kfPtr(im)]);
  const replaceKf = (i) => (im) => setKfs(kfs.map((k, j) => (j === i ? kfPtr(im) : k)));
  const removeKf = (i) => () => setKfs(kfs.filter((_, j) => j !== i));
  const kfIdxs = kfs.map(kfIndex);
  const anyKfBroken = kfs.length > 0 && kfIdxs.some((i) => !i);
  const startKfIdx = kfIdxs[0] || 0;
  // Compiled-prompt preview (full-prompt-preview rule): the 👁 in the KEYFRAMES header
  // shows EXACTLY what 🎬 would send right now — anchors, subjects, constraint tail.
  const [compiledOpen, setCompiledOpen] = useState(false);
  const [compiledText, setCompiledText] = useState('');
  const openCompiled = (e) => { e.stopPropagation(); setCompiledText(onCompilePreview ? onCompilePreview(id) : ''); setCompiledOpen(true); };
  const patch = (p) => onPatchCut && onPatchCut(id, p);
  const hasLook = Object.values(data.cine || {}).some((v) => String(v || '').trim())
    || (data.cinePreset === 'Custom' && !!String(data.cinematography || '').trim());
  // Seedance media references (plural — e.g. a camera-track video + a motion video +
  // music + two voice clips). Reads the earlier single-ref fields as a one-item array.
  const audioRefs = data.audioRefs || (data.audioRef ? [data.audioRef] : []);
  const videoRefs = data.videoRefs || (data.videoRef ? [data.videoRef] : []);
  const toggleRef = (entryId) => patch({ refIds: refIds.includes(entryId) ? refIds.filter((r) => r !== entryId) : [...refIds, entryId] });
  const removeAssetRef = (url) => patch({ assetRefs: (data.assetRefs || []).filter((a) => a.url !== url) }); // write from the RAW list — the view above hides anchored refs
  const removeAudioRef = (url) => patch({ audioRefs: audioRefs.filter((a) => a.url !== url), audioRef: null });
  // Media chip ROLE cycles on the tag (voice → music → ambience / motion → camera →
  // style) — the compiler emits the matching binding line; unset = the generic line.
  const AUDIO_ROLES = ['voice', 'music', 'ambience'];
  const VIDEO_ROLES = ['motion', 'camera', 'style'];
  const cycleAudioRole = (url) => patch({ audioRefs: audioRefs.map((a) => (a.url === url ? { ...a, role: AUDIO_ROLES[(AUDIO_ROLES.indexOf(a.role) + 1) % AUDIO_ROLES.length] } : a)) });
  const cycleVideoRole = (url) => patch({ videoRefs: videoRefs.map((v) => (v.url === url ? { ...v, role: VIDEO_ROLES[(VIDEO_ROLES.indexOf(v.role) + 1) % VIDEO_ROLES.length] } : v)) });
  const removeVideoRef = (url) => patch({ videoRefs: videoRefs.filter((a) => a.url !== url), videoRef: null });
  const [dragOver, setDragOver] = useState(false);
  const [directNote, setDirectNote] = useState('');

  // The SHOT's title (data.beat) is inline-renamed via the shared EditableLabel. The beat
  // is the card's NAME; it only feeds the shoot prompt as a FALLBACK when PROMPT is empty.

  // Duration is gated by the endpoint: the 2.0 family caps at 15s, Seedance 2.5 at 30s.
  const videoModel = videoModelKeyOf(data.videoModel);
  const maxDur = maxShotSeconds(videoModel);
  const durationSec = Math.min(maxDur, Math.max(5, Math.round(Number(data.durationSec) || 10)));
  const resOptions = RES_BY_MODEL[videoModel] || RES_BY_MODEL.seedance;
  const resolution = resOptions.includes(data.resolution) ? data.resolution : resDefault(videoModel);
  // CINEMATOGRAPHY pin = pick one of the 50 shot templates (sets the whole line) OR
  // hand-type. Picking stores the template id (so the dropdown highlights it) + its
  // name (cinePreset, for display) + the cinematography line.
  const pickTemplate = (id) => { const t = SHOT_TEMPLATE_BY_ID[id]; if (t) patch({ shotTemplate: t.id, cinePreset: t.name, cinematography: t.cinematography }); };

  // Edit/extend TRIGGER phrases + attached media refs silently flip the request into
  // an EDIT/EXTEND task (ratio + duration lock). Advisory only — intentional edits are
  // a legitimate future path, but a surprise flip ruins the take.
  const EDIT_TRIGGERS = /\b(edit (the )?video|replace|remove|delete|insert|change (it |him |her |them )?to|extend (forward|backward)|continue from|extend the story)\b/i;
  const triggerRisk = (audioRefs.length > 0 || videoRefs.length > 0) && EDIT_TRIGGERS.test(String(data.promptOverride || ''));

  const status = CUT_STATUS[data.status] || null;
  const borderColor = selected ? '#f7ba1e' : (status ? status.color : '#2a313a');
  const refTotal = refIds.length + assetRefs.length;

  // Index each reference by its ACTUAL send order (= "Image1…N" in the Seedance prompt):
  // enabled bible refs in refIds order, then per-shot assets. Each sent chip shows its image
  // number so the prompt can address "Image1" etc. without guessing which plate is which.
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
      style={{ width: 780, background: '#101418', borderRadius: 10, border: `2px solid ${dragOver ? '#f7ba1e' : borderColor}`, boxShadow: selected ? '0 0 0 3px rgba(247,186,30,0.15)' : '0 1px 4px rgba(0,0,0,0.2)', overflow: 'hidden', color: '#fff' }}
    >
      {/* invisible target handle — the asset→cut prerequisite edges land here */}
      {/* SEQUENCE handles — drag right-dot → left-dot to chain two cards: the source's
          last frame then threads into the target's shoot. No edge = hard cut. */}
      <Handle type="target" position={Position.Left} title="continuity in — a chained predecessor's last frame threads into this shoot" style={{ width: 9, height: 9, background: '#3491fa', border: '2px solid #101418' }} />
      <Handle type="source" position={Position.Right} title="continuity out — drag to the next SHOT card to thread this card's last frame forward" style={{ width: 9, height: 9, background: '#3491fa', border: '2px solid #101418' }} />
      {/* slate header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'repeating-linear-gradient(135deg, #1d2530 0 12px, #f7ba1e 12px 24px)', borderBottom: '1px solid #2a313a' }}>
        <Tag size="small" style={{ background: '#101418', color: '#f7ba1e', border: 'none', fontWeight: 700 }}>SHOT {(data.cut ?? 0) + 1}</Tag>
        {Number(data.takeCount) > 0 && (
          <Tag
            size="small"
            className="nodrag"
            title="Open this card's renders in the Take Library — scrub, download, add to the timeline"
            onClick={(e) => { e.stopPropagation(); onOpenTakes && onOpenTakes(id); }}
            style={{ background: '#101418', color: '#9fb4d0', border: 'none', fontWeight: 700, cursor: 'pointer' }}
          >🎞 View takes ({data.takeCount})</Tag>
        )}
        {status && (
          <Tag size="small" style={{ background: '#101418', color: status.color, border: 'none', fontWeight: 700 }}>
            {data.status === 'running' ? <IconLoading style={{ marginRight: 3 }} /> : null}{status.label}
          </Tag>
        )}
        <span style={{ flex: 1 }} />
        {/* The SHOT's length — one configurable duration (5–15s), the single source of
            truth for how long this shot runs (drives shotFromCard). */}
        <span title="Shot duration in seconds (5–15; Seedance 2.5 allows up to 30)" style={{ display: 'inline-flex' }}>
          <InputNumber
            className="nodrag"
            size="mini"
            min={5}
            max={maxDur}
            step={1}
            value={durationSec}
            onChange={(v) => patch({ durationSec: Math.min(maxDur, Math.max(5, Math.round(Number(v) || 10))) })}
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
              <Button className="nodrag" size="mini" type="text" icon={data.developing ? <IconLoading /> : <IconSync />} disabled={!onComposeCut || data.developing || data.splitting} onClick={() => onComposeCut && onComposeCut(id)} style={{ color: '#9fb4d0', height: 18, padding: '0 4px' }} title="Compose — with keyframes: 2 visible calls (DERIVE the events from the keyframes alone, then ENRICH with the reference chips + your dialogue/names verbatim); without: 1 call, your text as the material. Overridden text is reported, the compiler keeps adding the binding lines, previous text stashed.">Compose</Button>
              <Popover
                trigger="click" position="bl" color="#161b22"
                content={(
                  <div className="nodrag" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 2, width: 220 }}>
                    <Text style={{ fontSize: 9, fontWeight: 700, color: '#9fb4d0' }}>DENSITY — target scales with the video model</Text>
                    {ENRICH_LEVELS(videoModelKeyOf(data.videoModel)).map((lv) => (
                      <Button key={lv.key} size="mini" long style={{ justifyContent: 'flex-start' }} onClick={() => onEnrichCut && onEnrichCut(id, lv.key)}>
                        {lv.label} · ~{lv.words} words
                      </Button>
                    ))}
                  </div>
                )}
              >
                <Button className="nodrag" size="mini" type="text" icon={data.developing ? <IconLoading /> : <IconEdit />} disabled={!onEnrichCut || data.developing || data.splitting} style={{ color: '#9fb4d0', height: 18, padding: '0 4px' }} title="Enrich — expand THIS prompt with cinematic density (camera, motion micro-detail, texture, atmosphere, VFX, sound) while every event, [Image N] tag, dialogue line, reference and keyframe stays exactly as it is. Pick a density — 1 visible call. Previous text stashed.">Enrich</Button>
              </Popover>
              <Popover
                trigger="click" position="bl" color="#161b22"
                content={(
                  <div className="nodrag" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 2, width: 260 }}>
                    <Text style={{ fontSize: 9, fontWeight: 700, color: '#9fb4d0' }}>DIRECTOR'S NOTE — how should this shot feel or read?</Text>
                    <Input.TextArea
                      value={directNote}
                      onChange={setDirectNote}
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      placeholder="e.g. slower and heavier · colder mood · the wind carries the scene · less frantic, let it breathe"
                      style={{ fontSize: 11 }}
                    />
                    <Button size="mini" long type="primary" disabled={!directNote.trim()} onClick={() => { onDirectCut && onDirectCut(id, directNote.trim()); setDirectNote(''); }}>
                      Apply note — 1 call
                    </Button>
                  </div>
                )}
              >
                <Button className="nodrag" size="mini" type="text" icon={data.developing ? <IconLoading /> : <IconMessage />} disabled={!onDirectCut || data.developing || data.splitting} style={{ color: '#9fb4d0', height: 18, padding: '0 4px' }} title="Direct — one note on how the shot FEELS or READS (tone, pacing, mood, emphasis); the prompt is re-shaped to match while events, [Image N] tags, dialogue, references and keyframes all stay. 1 visible call, previous text stashed.">Direct</Button>
              </Popover>
              {/* Develop (opt-in) — rewrite this prompt into a cinematic Seedance prompt; always
                  re-runs from the ORIGINAL text (stashed on first develop), never rewrite². */}
              <Button className="nodrag" size="mini" type="text" icon={<IconExpand />} onClick={() => setEditorOpen(true)} style={{ color: '#9fb4d0', height: 18, padding: '0 4px' }} title="Open the large editor — write in a big window and @-mention reference images">Expand</Button>
            </span>
          </div>
          <DraftText textarea className="nodrag nowheel" value={data.promptOverride} onCommit={(v) => patch({ promptOverride: v })} placeholder="the shot's cinematic prompt — Expand to @-mention references" autoSize={{ minRows: 4, maxRows: 14 }} style={promptArea} />
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
        </div>

        <div>
          <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700, display: 'block', marginBottom: 2 }}>AUDIO <span style={{ color: '#5a6472', fontWeight: 400 }}>· optional</span></Text>
          <DraftText textarea className="nodrag nowheel" value={data.audio} onCommit={(v) => patch({ audio: v })} placeholder="dialogue · ambient · foley · score" autoSize={{ minRows: 1, maxRows: 3 }} style={promptArea} />
        </div>

        <div>
          <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700, display: 'block', marginBottom: 3 }}>SEEDANCE 2.0 PARAMS</Text>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Select className="nodrag" size="mini" value={videoModel} onChange={(v) => patch({ videoModel: v, ...((RES_BY_MODEL[v] || RES_BY_MODEL.seedance).includes(data.resolution) ? {} : { resolution: resDefault(v) }) })} options={VIDEO_MODEL_OPTIONS.map((o) => ({ label: o.label, value: o.key }))} style={{ width: 148 }} triggerProps={{ autoAlignPopupWidth: false }} title="Which Seedance endpoint shoots this shot — Mini is faster/cheaper (caps at 720p)" />
            <Select className="nodrag" size="mini" value={resolution} onChange={(v) => patch({ resolution: v })} options={resOptions.map((o) => ({ label: o, value: o }))} style={{ width: 76 }} triggerProps={{ autoAlignPopupWidth: false }} />
            <Select className="nodrag" size="mini" value={data.ratio || '21:9'} onChange={(v) => patch({ ratio: v })} options={['21:9', 'adaptive', '16:9', '9:16', '1:1', '4:3'].map((o) => ({ label: o, value: o }))} style={{ width: 92 }} triggerProps={{ autoAlignPopupWidth: false }} />
            <Checkbox className="nodrag" checked={data.generateAudio !== false} onChange={(c) => patch({ generateAudio: c })}><Text style={{ fontSize: 10, color: '#9fb4d0' }}>audio</Text></Checkbox>
            <InputNumber className="nodrag" size="mini" placeholder="seed" value={data.seed ?? undefined} onChange={(v) => patch({ seed: v == null || v === '' ? null : Math.round(Number(v)) })} style={{ width: 88 }} />
          </div>
        </div>

        {/* KEYFRAMES — visual grounding: an ORDERED list of pointers into the enabled
            ref chips. K1 = the composition the shot opens on, Kn = where it lands,
            middles are passed through in order. Empty list → the classic path, untouched. */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700 }}>KEYFRAMES · visual grounding</Text>
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
              {startKfIdx > 0 && <Text style={{ color: '#3491fa', fontSize: 9 }}>shoots keyframe-pinned</Text>}
              <IconEye className="nodrag" onClick={openCompiled} title="Preview the EXACT compiled prompt 🎬 will send (no spend)" style={{ fontSize: 12, color: '#9fb4d0', cursor: 'pointer' }} />
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {kfs.map((k, i) => (
              <AnchorSlot
                key={`${k.url}-${i}`}
                label={kfIdxs[i] ? `K${i + 1} · Image ${kfIdxs[i]}` : `K${i + 1} · ref off!`}
                value={k}
                images={kfImages}
                onPick={replaceKf(i)}
                onClear={removeKf(i)}
              />
            ))}
            <AnchorSlot label={`K${kfs.length + 1}`} value={null} images={kfImages} onPick={appendKf} onClear={() => {}} />
          </div>
          {triggerRisk && (
            <Text style={{ color: '#f7ba1e', fontSize: 9 }}>
              ⚠ the prompt contains an edit/extend trigger word while media refs ride — Seedance may flip this into an EDIT/EXTEND task and lock ratio + duration; reword (e.g. "takes off" not "removes") unless intended
            </Text>
          )}
          {(data.composeDropped || []).length > 0 && (
            <Text title={(data.composeDropped || []).join('\n')} style={{ color: '#f7ba1e', fontSize: 9 }} ellipsis={{ rows: 2 }}>
              ⚠ keyframes overrode: {(data.composeDropped || []).join(' · ')} — original text stashed
            </Text>
          )}
          {anyKfBroken && (
            <Text style={{ color: '#f53f3f', fontSize: 9 }}>a keyframe points to a removed/disabled ref — toggle its chip back on or re-pick</Text>
          )}
          {kfs.some((k, i) => i > 0 && k.url === kfs[i - 1].url) && (
            <Text style={{ color: '#f7ba1e', fontSize: 9 }}>adjacent keyframes are the SAME image — the duplicate won't ride</Text>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700 }}>REFERENCES → [Image1…N] · click to toggle</Text>
            {refTotal > MAX_CUT_REFS
              ? <Text style={{ color: '#f53f3f', fontSize: 9 }}>first {MAX_CUT_REFS} feed the shot</Text>
              : (refTotal > 5
                && <Text style={{ color: '#f7ba1e', fontSize: 9 }} title="Seedance guide: 4-5 assets — more dilutes feature priority (keyframes are pointers, they add nothing)">&gt;5 refs — model may dilute</Text>)}
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
              const isMap = !!(data.mapRef && data.mapRef.url === a.url);
              return (
                <span
                  key={a.url}
                  className="nodrag"
                  onClick={() => { removeAssetRef(a.url); if (isMap) patch({ mapRef: null }); }}
                  title={isMap
                    ? `${sent ? `Image${imgIdx} · ` : ''}the scene's blocking MAP — read for positions only; click to detach (the projected prompt stays, editable)`
                    : `${sent ? `Image${imgIdx} · ` : ''}${a.label || 'asset'} — attached to this shot only; click to remove`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                    padding: '1px 6px', borderRadius: 10, fontSize: 10,
                    border: `1px solid ${isMap ? '#3491fa' : '#e5e6eb'}`, background: isMap ? '#e8f3ff' : '#e5e6eb', color: '#1d2129',
                  }}
                >
                  {sent && <b style={REF_BADGE}>{imgIdx}</b>}
                  {a.url ? <img src={a.url} alt="" loading="lazy" decoding="async" style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} /> : null}
                  {isMap ? 'MAP' : (a.label || 'asset').slice(0, 14)}
                </span>
              );
            })}
            {/* Seedance media refs — audio clips (music / voices) and videos (camera / motion),
                attached by tapping a ★-tagged offer chip below; click an attached chip to detach. */}
            {audioRefs.map((a, ai) => (
              <span
                key={a.url}
                className="nodrag"
                title={`Audio ${ai + 1} — ${a.label || 'audio clip'} (≤15s). Click the role tag to cycle voice → music → ambience; ✕ detaches.`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '1px 6px', borderRadius: 10, fontSize: 10,
                  border: '1px solid rgba(120,22,255,0.55)', background: 'rgba(120,22,255,0.16)', color: '#c0a1ff',
                }}
              >
                <b style={REF_BADGE}>A{ai + 1}</b>
                <IconSound style={{ fontSize: 11 }} />
                {(a.label || 'audio').slice(0, 12)}{Number(a.duration) ? ` · ${Math.round(a.duration)}s` : ''}
                <b onClick={() => cycleAudioRole(a.url)} title="Role — what this clip is a reference FOR (drives the binding line)" style={{ ...REF_BADGE, cursor: 'pointer', minWidth: 0 }}>{a.role || 'sound'}</b>
                <span onClick={() => removeAudioRef(a.url)} title="Detach" style={{ cursor: 'pointer' }}>✕</span>
              </span>
            ))}
            {videoRefs.map((v, vi) => (
              <span
                key={v.url}
                className="nodrag"
                title={`Video ${vi + 1} — ${v.label || 'video'} (≤15s). Click the role tag to cycle motion → camera → style; ✕ detaches.`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '1px 6px', borderRadius: 10, fontSize: 10,
                  border: '1px solid #165dff', background: 'rgba(22,93,255,0.15)', color: '#6ea0ff',
                }}
              >
                <b style={REF_BADGE}>V{vi + 1}</b>
                <IconVideoCamera style={{ fontSize: 11 }} />
                {(v.label || 'video').slice(0, 12)}
                <b onClick={() => cycleVideoRole(v.url)} title="Role — what this clip is a reference FOR (drives the binding line)" style={{ ...REF_BADGE, cursor: 'pointer', minWidth: 0 }}>{v.role || 'cam+motion'}</b>
                <span onClick={() => removeVideoRef(v.url)} title="Detach" style={{ cursor: 'pointer' }}>✕</span>
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
      {/* CINEMATOGRAPHY — the DP look layer, ADDITIVE to the Camera preset line:
          four one-line fields joined into the take's LOOK at shoot time (empty adds
          nothing — never boilerplate). Collapsed by default; the toggle carries a dot
          when it holds content, so hidden never reads as empty. Develop/Re-derive
          never touch these — they rewrite the prompt only. */}
      {data.cineOpen && (
        <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ padding: '6px 10px 8px', borderTop: '1px solid #2a313a', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[['lens', 'Lens & depth', '35mm, shallow focus, compressed background'],
            ['light', 'Light', 'low hard sun from frame left, dust haze'],
            ['grade', 'Grade', 'warm amber, crushed blacks, fine grain'],
            ['move', 'Movement', 'slow push in, slight handheld sway']].map(([k, label, ph]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text style={{ width: 78, flexShrink: 0, color: '#9fb4d0', fontSize: 10, fontWeight: 700 }}>{label}</Text>
                <DraftText className="nodrag" size="mini" value={(data.cine || {})[k]} onCommit={(v) => patch({ cine: { ...(data.cine || {}), [k]: v } })} placeholder={ph} style={{ flex: 1 }} />
              </div>
          ))}
          {data.cinePreset === 'Custom' && String(data.cinematography || '').trim() ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Text style={{ width: 78, flexShrink: 0, color: '#b25c00', fontSize: 10, fontWeight: 700 }}>Legacy look</Text>
              <DraftText className="nodrag" size="mini" value={data.cinematography} onCommit={(v) => patch({ cinematography: v })} placeholder="hand-written look from the old field — rides into 🎬; clear to retire" style={{ flex: 1 }} />
            </div>
          ) : null}
        </div>
      )}
      <div className="nodrag" style={{ display: 'flex', justifyContent: 'flex-end', padding: '1px 6px 4px' }}>
        <Button size="mini" type="text" onClick={(e) => { e.stopPropagation(); patch({ cineOpen: !data.cineOpen }); }}
          title="Cinematography — the DP look for this shot: lens & depth · light · grade · movement. Joined into the LOOK line at 🎬; empty fields add nothing."
          style={{ color: hasLook ? '#f7ba1e' : '#5a6472', height: 18, padding: '0 4px', fontSize: 11 }}>
          {data.cineOpen ? '−' : '+'} cinematography{hasLook && !data.cineOpen ? ' ●' : ''}
        </Button>
      </div>
      {editorOpen && (
        <PromptEditorModal
          open
          value={data.promptOverride || ''}
          references={attachableRefs}
          media={[
            ...audioRefs.map((a, i) => ({ kind: 'audio', index: i + 1, name: a.label || 'audio clip', role: a.role || '' })),
            ...videoRefs.map((v, i) => ({ kind: 'video', index: i + 1, name: v.label || 'video', role: v.role || '' })),
          ]}
          onAttach={attachRef}
          maxRefs={MAX_CUT_REFS}
          onChange={(v) => patch({ promptOverride: v })}
          onClose={() => setEditorOpen(false)}
        />
      )}
      <Modal
        visible={compiledOpen}
        onCancel={() => setCompiledOpen(false)}
        footer={null}
        title="Compiled Seedance prompt — exactly what 🎬 sends"
        style={{ width: 640 }}
      >
        <pre className="nodrag nowheel" style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: '17px', maxHeight: 420, overflowY: 'auto', background: '#161b22', color: '#cdd3dc', padding: 12, borderRadius: 6, margin: 0 }}>{compiledText || '(nothing to compile yet — write a prompt or set anchors)'}</pre>
      </Modal>
    </div>
  );
};

export default memo(CutNodeInner);
