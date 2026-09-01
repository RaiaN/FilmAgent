import { useState } from 'react';
import { Typography, Input, Select, Checkbox, InputNumber, Tag } from '@arco-design/web-react';
import { IconSound, IconVideoCamera } from '@arco-design/web-react/icon';
import { BIBLE_ROLE_META } from '../../../utils/film/recipes';
import { VIDEO_MODEL_OPTIONS, RES_BY_MODEL, resDefault, videoTraits, videoModelKeyOf } from '../../../utils/film/suiteConfig';

const { Text } = Typography;

// Text fields draft LOCALLY and commit on blur: routing every keystroke through the
// React Flow store makes the controlled value arrive back a beat late, which resets
// the caret to the end. External updates (Compose/Direct) still flow in
// whenever the field isn't focused.
export const DraftText = ({ value, onCommit, textarea = false, ...rest }) => {
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

export const BLOCK_LABEL = { color: '#9fb4d0', fontSize: 10, fontWeight: 700 };

const ROLE_COLOR = { character: '#722ed1', location: '#00b42a', prop: '#ff7d00', frame: '#f5319d' };
const REF_BADGE = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  minWidth: 13, height: 13, borderRadius: 3, background: '#0d1117',
  color: '#9fb4d0', fontSize: 9, fontWeight: 700, padding: '0 3px',
};

// THE REFERENCES BLOCK — one implementation for every card that sends references.
// A SHOT card calls them references; an EDIT card calls the images TARGET MATERIAL
// (what a replacement replaces INTO), but the mechanics are identical: enabled chips
// number [Image 1..N] in send order, role badges, media chips with cycling roles.
export const ReferencesRow = ({ id, data, patch, bibleEntries = [], label = null, onOpenRefDrawer }) => {
  const refIds = data.refIds || [];
  const assetRefs = data.assetRefs || [];
  const audioRefs = data.audioRefs || (data.audioRef ? [data.audioRef] : []);
  const videoRefs = data.videoRefs || (data.videoRef ? [data.videoRef] : []);
  const toggleRef = (entryId) => patch({ refIds: refIds.includes(entryId) ? refIds.filter((r) => r !== entryId) : [...refIds, entryId] });
  const removeAssetRef = (url) => patch({ assetRefs: assetRefs.filter((a) => a.url !== url) });
  const removeAudioRef = (url) => patch({ audioRefs: audioRefs.filter((a) => a.url !== url), audioRef: null });
  const removeVideoRef = (url) => patch({ videoRefs: videoRefs.filter((a) => a.url !== url), videoRef: null });
  const AUDIO_ROLES = ['voice', 'music', 'ambience'];
  const VIDEO_ROLES = ['motion', 'camera', 'style'];
  const cycleAudioRole = (url) => patch({ audioRefs: audioRefs.map((a) => (a.url === url ? { ...a, role: AUDIO_ROLES[(AUDIO_ROLES.indexOf(a.role) + 1) % AUDIO_ROLES.length] } : a)) });
  const cycleVideoRole = (url) => patch({ videoRefs: videoRefs.map((v) => (v.url === url ? { ...v, role: VIDEO_ROLES[(VIDEO_ROLES.indexOf(v.role) + 1) % VIDEO_ROLES.length] } : v)) });
  const refTotal = refIds.length + assetRefs.length;
  // Index each reference by its ACTUAL send order (= "Image1…N" in the prompt): enabled
  // bible refs in refIds order, then per-shot assets. The CARD'S MODEL decides how many
  // ride — a chip past the cap shows unnumbered, so nothing silently drops.
  const maxRefs = videoTraits(videoModelKeyOf(data.videoModel)).refCap;
  const sentBibleIds = refIds.filter((rid) => (bibleEntries || []).some((b) => b.id === rid && b.url));
  const bibleImageIndex = (entryId) => { const i = sentBibleIds.indexOf(entryId); return i < 0 ? null : i + 1; };
  const assetImageIndex = (j) => sentBibleIds.length + j + 1;
  return (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={{ color: '#9fb4d0', fontSize: 10, fontWeight: 700 }}>{label || 'REFERENCES → [Image1…N] · enabled only'}</Text>
            {refTotal > maxRefs
              && <Text style={{ color: '#f53f3f', fontSize: 9 }}>first {maxRefs} feed the shot</Text>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {/* ENABLED refs only — the whole library lives in the ＋ drawer (never a
                hundred inline chips). Click a chip to remove it from the shot. */}
            {sentBibleIds.map((rid) => {
              const b = (bibleEntries || []).find((x) => x.id === rid);
              if (!b) return null;
              const imgIdx = bibleImageIndex(rid);
              const sent = imgIdx != null && imgIdx <= maxRefs;
              return (
                <span
                  key={b.id}
                  className="nodrag"
                  onClick={() => toggleRef(b.id)}
                  title={`${sent ? `Image${imgIdx} · ` : ''}${BIBLE_ROLE_META[b.role]?.label || b.role}: ${b.name || ''} — click to remove`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                    padding: '1px 6px', borderRadius: 10, fontSize: 10,
                    border: `1px solid ${ROLE_COLOR[b.role] || '#86909c'}`,
                    background: ROLE_COLOR[b.role] || '#86909c',
                    color: '#fff',
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
              const sent = imgIdx <= maxRefs;
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
                title={`Video ${vi + 1} — ${v.label || 'video'} (2–30s). Click the role tag to cycle motion → camera → style; ✕ detaches.`}
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
            {onOpenRefDrawer && (
              <span
                className="nodrag"
                onClick={() => onOpenRefDrawer({ type: 'cut', id })}
                title="Browse the reference library — search + role tabs; toggle cast/world plates, board images and ★-tagged clips onto this shot"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer',
                  padding: '1px 8px', borderRadius: 10, fontSize: 10,
                  border: '1px dashed #9fb4d0', color: '#9fb4d0', background: 'transparent',
                }}
              >
                ＋ Add references
              </span>
            )}
            {refTotal === 0 && audioRefs.length === 0 && videoRefs.length === 0 && <Text style={{ color: '#86909c', fontSize: 10 }}>none enabled — browse the library, or drop an image straight onto the card</Text>}
          </div>
        </div>
  );
};


// The endpoint params shared by every card that shoots. `lockFrame` is what an EDIT
// card passes: an editing task inherits ratio AND duration from its master, so those
// controls become read-only facts instead of choices — and the shoot never sends them.
export const SeedanceParams = ({ data, patch, videoModel, resolution, resOptions, lockFrame = false, lockNote = '' }) => (
  <div>
    <Text style={{ ...BLOCK_LABEL, display: 'block', marginBottom: 3 }}>SEEDANCE PARAMS</Text>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <Select
        className="nodrag" size="mini" value={videoModel}
        onChange={(v) => patch({ videoModel: v, ...((RES_BY_MODEL[v] || RES_BY_MODEL.seedance).includes(data.resolution) ? {} : { resolution: resDefault(v) }) })}
        options={VIDEO_MODEL_OPTIONS.map((o) => ({ label: o.label, value: o.key }))}
        style={{ width: 148 }} triggerProps={{ autoAlignPopupWidth: false }}
        title="Which Seedance endpoint shoots this — Mini is faster/cheaper (caps at 720p)"
      />
      <Select
        className="nodrag" size="mini" value={resolution} onChange={(v) => patch({ resolution: v })}
        options={resOptions.map((o) => ({ label: o, value: o }))}
        style={{ width: 76 }} triggerProps={{ autoAlignPopupWidth: false }}
        title="Resolution IS honoured on an editing task — it is the one frame param you still choose"
      />
      {lockFrame ? (
        <Tag size="small" style={{ background: '#101418', color: '#f7ba1e', border: '1px solid #3a3226', fontWeight: 600 }} title={lockNote}>
          ratio · duration locked
        </Tag>
      ) : (
        <Select
          className="nodrag" size="mini" value={data.ratio || '21:9'} onChange={(v) => patch({ ratio: v })}
          options={['21:9', 'adaptive', '16:9', '9:16', '1:1', '4:3'].map((o) => ({ label: o, value: o }))}
          style={{ width: 92 }} triggerProps={{ autoAlignPopupWidth: false }}
        />
      )}
      <Checkbox className="nodrag" checked={data.generateAudio !== false} onChange={(c) => patch({ generateAudio: c })}>
        <Text style={{ fontSize: 10, color: '#9fb4d0' }}>audio</Text>
      </Checkbox>
      <InputNumber
        className="nodrag" size="mini" placeholder="seed" value={data.seed ?? undefined}
        onChange={(v) => patch({ seed: v == null || v === '' ? null : Math.round(Number(v)) })}
        style={{ width: 88 }}
      />
    </div>
  </div>
);
