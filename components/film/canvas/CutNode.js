import { createContext, memo, useContext, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Typography, Input, Select, Tag, Button, InputNumber, Checkbox, Popover } from '@arco-design/web-react';
import { IconLoading, IconExpand, IconEdit, IconSync, IconSound, IconMessage, IconVideoCamera } from '@arco-design/web-react/icon';
import { BIBLE_ROLE_META, SHOT_TEMPLATES_BY_CATEGORY, SHOT_TEMPLATE_BY_ID } from '../../../utils/film/recipes';
import { VIDEO_MODEL_OPTIONS, RES_BY_MODEL, resDefault, maxShotSeconds, imageTagOf, clampShotSeconds, AUTO_SECONDS, videoModelKeyOf, videoTraits } from '../../../utils/film/suiteConfig';
import { BOARD_NODE_DRAG_TYPE, ASSET_DRAG_TYPE } from '../../../utils/film/libraryStore';
import PromptEditorModal from './PromptEditorModal';
import EditableLabel from './EditableLabel';
import { SeedanceParams, DraftText, ReferencesRow } from './cardBlocks';

const { Text } = Typography;

// A SHOT card — the shot's SPEC on the board before generation (5–15s). The Story agent's
// prompt rides verbatim in the editable PROMPT field; CINEMATOGRAPHY (a 50-template picker
// or a hand-typed line), AUDIO and the Seedance 2.0 params shape it on top. The 🎬 button
// shoots a take of just this shot. (Node type stays 'cut' internally; user-facing it's a SHOT.)
export const CutContext = createContext({
  onPatchCut: null, bibleEntries: [], mediaEntries: [], onShootCut: null, onAttachAsset: null, onSplitCut: null, onComposeCut: null, onDirectCut: null, onOpenTakes: null, boardImages: [], prevTakeFrames: {}, onOpenRefDrawer: null,
});

// One keyframe slot tile: shows its picked still, or a dashed ＋ tile. Clicking opens
// the shared reference drawer (single-pick over THIS card's enabled chips) — nothing
// is generated here. A picked keyframe pins the shoot onto the keyframe grammar.
const AnchorSlot = ({ label, value, onOpen, onClear }) => (
  <div
    className="nodrag"
    onClick={onOpen}
    title={value?.url ? `${label} keyframe: ${value.label || 'board still'} — click to swap (picks from this card's references)` : `Add keyframe ${label} — the shot passes through the picked compositions in order (picks from this card's references)`}
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
);

const ROLE_COLOR = { character: '#722ed1', location: '#00b42a', prop: '#ff7d00', frame: '#f5319d' };


// Visual state of the cut as it shoots (border + header tag).
// 'failed' is deliberately absent: individual takes fail and that's fine — the take
// itself carries its error in the Take Library; the card never wears a failure.
const CUT_STATUS = {
  running: { color: '#165dff', label: 'rolling…' },
  shot: { color: '#00b42a', label: 'shot ✓' },
};


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
  const { onPatchCut, bibleEntries, onShootCut, onAttachAsset, onSplitCut, onComposeCut, onDirectCut, onOpenTakes, boardImages, prevTakeFrames, onOpenRefDrawer } = useContext(CutContext);
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
  // Keyframe picking rides the shared reference drawer (single-pick) — the pool stays
  // STRICTLY this card's enabled chips (a keyframe is a pointer to a visible chip).
  const openKfPick = (slotIndex) => onOpenRefDrawer && onOpenRefDrawer({
    type: 'pick',
    title: `${slotIndex == null ? `K${kfs.length + 1}` : `K${slotIndex + 1}`} · pick from this card's references`,
    hint: 'Keyframes point at ENABLED chips only — add the image to REFERENCES first, then pick it here.',
    items: kfImages.map((im, i) => ({ id: im.nodeId || im.url, url: im.url, label: `${i + 1} · ${im.label || 'untitled'}`, kind: 'image' })),
    onPick: (item) => {
      const im = kfImages.find((x) => (x.nodeId || x.url) === item.id);
      if (!im) return;
      if (slotIndex == null) appendKf(im); else replaceKf(slotIndex)(im);
    },
  });
  const kfIdxs = kfs.map(kfIndex);
  const anyKfBroken = kfs.length > 0 && kfIdxs.some((i) => !i);
  const startKfIdx = kfIdxs[0] || 0;
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
  // style) — Compose writes the matching binding sentence; unset = the generic line.
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
  // AUTO is its own value — no duration on the wire, the model runs the events as long
  // as they take. Cards born from the Film button start there.
  const videoModel = videoModelKeyOf(data.videoModel);
  const maxDur = maxShotSeconds(videoModel);
  const durationSec = clampShotSeconds(videoModel, data.durationSec);
  const durOptions = [AUTO_SECONDS, ...Array.from({ length: Math.floor(maxDur / 5) }, (_, i) => (i + 1) * 5)];
  const resOptions = RES_BY_MODEL[videoModel] || RES_BY_MODEL.seedance;
  const maxRefs = videoTraits(videoModel).refCap; // the CARD's model decides how many image refs ride
  const resolution = resOptions.includes(data.resolution) ? data.resolution : resDefault(videoModel);
  // CINEMATOGRAPHY pin = pick one of the 50 shot templates (sets the whole line) OR
  // hand-type. Picking stores the template id (so the dropdown highlights it) + its
  // name (cinePreset, for display) + the cinematography line.
  // Switching the preset under a WRITTEN prompt leaves camera wording in the text that
  // contradicts the new pick — flag it; any prompt verb (Compose/Direct) restages
  // the action for the locked camera and clears the flag.
  const pickTemplate = (tid) => {
    const t = SHOT_TEMPLATE_BY_ID[tid];
    if (!t) return;
    patch({
      shotTemplate: t.id, cinePreset: t.name, cinematography: t.cinematography,
      ...(String(data.promptOverride || '').trim() && t.id !== data.shotTemplate ? { cameraStale: true } : {}),
    });
  };

  // Edit/extend TRIGGER phrases + attached media refs silently flip the request into
  // an EDIT/EXTEND task (ratio + duration lock). Advisory only — intentional edits are
  // a legitimate future path, but a surprise flip ruins the take.
  const EDIT_TRIGGERS = /\b(edit (the )?video|replace|remove|delete|insert|change (it |him |her |them )?to|extend (forward|backward)|continue from|extend the story)\b/i;
  const triggerRisk = (audioRefs.length > 0 || videoRefs.length > 0) && EDIT_TRIGGERS.test(String(data.promptOverride || ''));

  const jobLine = String(data.job || '').trim();
  const status = CUT_STATUS[data.status] || null;
  const borderColor = selected ? '#f7ba1e' : (status ? status.color : '#2a313a');
  const refTotal = refIds.length + assetRefs.length;

  // Index each reference by its ACTUAL send order (= "Image1…N" in the Seedance prompt):
  // enabled bible refs in refIds order, then per-shot assets. Each sent chip shows its image
  // number so the prompt can address "Image1" etc. without guessing which plate is which.
  const bibleImageIndex = (entryId) => { const i = sentBibleIds.indexOf(entryId); return i < 0 ? null : i + 1; };
  const assetImageIndex = (j) => sentBibleIds.length + j + 1;

  const [editorOpen, setEditorOpen] = useState(false);
  // The editor's @-picker offers ONLY the references SENT with this shot — enabled bible
  // chips (refIds order) + per-shot assets — each with its real Image number, so a tag
  // always points at a plate the take receives. Toggling a chip on the card is the attach
  // gesture; the editor never attaches. Built ONLY while the editor is open.
  const attachableRefs = editorOpen ? [
    ...(bibleEntries || []).filter((b) => b.url && bibleImageIndex(b.id) != null).map((b) => ({ id: b.id, name: b.name || BIBLE_ROLE_META[b.role]?.label || 'cast', url: b.url, index: bibleImageIndex(b.id) })),
    ...assetRefs.map((a, j) => ({ id: `asset:${a.url}`, name: a.label || 'asset', url: a.url, index: assetImageIndex(j) })).filter((r) => r.index <= maxRefs),
  ] : [];

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
        {/* The SHOT's length — Auto (no duration sent: the events set it) or a fixed
            ceiling in seconds. The single source of truth for shotFromCard. */}
        <Select
          className="nodrag"
          size="mini"
          value={durationSec}
          onChange={(v) => patch({ durationSec: v })}
          style={{ width: 84 }}
          title="How long this shot runs. Auto sends no duration at all — the model plays the events out as long as they honestly take (what the Film button sets). A number caps it."
        >
          {durOptions.map((d) => (
            <Select.Option key={String(d)} value={d}>{d === AUTO_SECONDS ? 'Auto' : `${d}s`}</Select.Option>
          ))}
        </Select>
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
        {jobLine && (
          <Text title="This shot's ONE JOB — carved with the shot list; Compose / Direct all serve it" style={{ fontSize: 10, color: '#b08b3e', fontStyle: 'italic', marginTop: -4 }} ellipsis={{ rows: 1 }}>◎ {jobLine}</Text>
        )}

        <div>
          <div style={{ marginBottom: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700 }}>PROMPT</Text>
            <span style={{ display: 'inline-flex', gap: 2 }}>
              <Button className="nodrag" size="mini" type="text" icon={data.developing ? <IconLoading /> : <IconSync />} disabled={!onComposeCut || data.developing || data.splitting} onClick={() => onComposeCut && onComposeCut(id)} style={{ color: '#9fb4d0', height: 18, padding: '0 4px' }} title="Compose — with keyframes: 2 visible calls (DERIVE the events from the keyframes alone, then WRITE it with the reference chips + your dialogue/names verbatim); without: 1 call, your text as the material. What comes back IS the prompt — it ships to the model verbatim. Overridden text is reported, previous text stashed.">Compose</Button>
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
          {(data.developing || data.composePending) ? (
            <div className="nodrag" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 10px', background: '#0d1117', border: '1px solid #21262d', borderRadius: 4, minHeight: 72 }}>
              <IconLoading style={{ fontSize: 16, color: '#f7ba1e' }} />
              <div style={{ minWidth: 0 }}>
                <Text style={{ color: '#f7ba1e', fontSize: 11, fontWeight: 700, display: 'block' }}>Writing the prompt…</Text>
                <Text style={{ color: '#6e7b8b', fontSize: 10 }} ellipsis>under the skill bound to {VIDEO_MODEL_OPTIONS.find((o) => o.key === videoModel)?.label || videoModel} — the rows are the material</Text>
              </div>
            </div>
          ) : (
          <DraftText textarea className="nodrag nowheel" value={data.promptOverride} onCommit={(v) => patch({ promptOverride: v })} placeholder="the shot's cinematic prompt — Expand to @-mention references" autoSize={{ minRows: 4, maxRows: 14 }} style={promptArea} />
          )}
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

        <SeedanceParams data={data} patch={patch} videoModel={videoModel} resolution={resolution} resOptions={resOptions} />
        {/* KEYFRAMES — visual grounding: an ORDERED list of pointers into the enabled
            ref chips. K1 = the composition the shot opens on, Kn = where it lands,
            middles are passed through in order. Empty list → the classic path, untouched. */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700 }}>KEYFRAMES · visual grounding</Text>
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
              {kfImages.length >= 2 && (
                <Text
                  className="nodrag"
                  onClick={() => setKfs(kfImages.slice(0, maxRefs).map(kfPtr))}
                  title={`Set K1…K${Math.min(kfImages.length, maxRefs)} = every reference chip in its [Image N] order (replaces the current list). Attach chips in story order — e.g. kf_01…kf_15 — and this is one tap.`}
                  style={{ color: '#3491fa', fontSize: 9, cursor: 'pointer' }}
                >⛓ chain all refs</Text>
              )}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {kfs.map((k, i) => (
              <AnchorSlot
                key={`${k.url}-${i}`}
                label={kfIdxs[i] ? `K${i + 1} · Image ${kfIdxs[i]}` : `K${i + 1} · ref off!`}
                value={k}
                onOpen={() => openKfPick(i)}
                onClear={removeKf(i)}
              />
            ))}
            <AnchorSlot label={`K${kfs.length + 1}`} value={null} onOpen={() => openKfPick(null)} onClear={() => {}} />
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
          {data.cameraStale && (
            <Text style={{ color: '#f7ba1e', fontSize: 9 }}>camera preset changed after this prompt was written — Compose / Dnrich / Direct restages the action for the new camera</Text>
          )}
          {anyKfBroken && (
            <Text style={{ color: '#f53f3f', fontSize: 9 }}>a keyframe points to a removed/disabled ref — toggle its chip back on or re-pick</Text>
          )}
          {kfs.some((k, i) => i > 0 && k.url === kfs[i - 1].url) && (
            <Text style={{ color: '#f7ba1e', fontSize: 9 }}>adjacent keyframes are the SAME image — the duplicate won't ride</Text>
          )}
        </div>

        <ReferencesRow id={id} data={data} patch={patch} bibleEntries={bibleEntries} onOpenRefDrawer={onOpenRefDrawer} />
      </div>
      {/* CINEMATOGRAPHY — the DP look layer, ADDITIVE to the Camera preset line:
          four one-line fields joined into the take's LOOK at shoot time (empty adds
          nothing — never boilerplate). Collapsed by default; the toggle carries a dot
          when it holds content, so hidden never reads as empty. Develop/Re-derive
          never touch these — they rewrite the prompt only. */}
      {data.cineOpen && (
        <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ padding: '6px 10px 8px', borderTop: '1px solid #2a313a', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[['lens', 'Lens & depth', '35mm, shallow focus, compressed background'],
            ['light', 'Light', 'low golden-hour backlight, warm haze · or: hard backlight, silhouette'],
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
          imageTag={(n) => imageTagOf(videoModel, n)}
          media={[
            ...audioRefs.map((a, i) => ({ kind: 'audio', index: i + 1, name: a.label || 'audio clip', role: a.role || '' })),
            ...videoRefs.map((v, i) => ({ kind: 'video', index: i + 1, name: v.label || 'video', role: v.role || '' })),
          ]}
          onChange={(v) => patch({ promptOverride: v })}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
};

export default memo(CutNodeInner);
