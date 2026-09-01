import { useState } from 'react';
import { Typography, Input, Select, Checkbox, InputNumber, Tag } from '@arco-design/web-react';
import { VIDEO_MODEL_OPTIONS, RES_BY_MODEL, resDefault } from '../../../utils/film/suiteConfig';

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
