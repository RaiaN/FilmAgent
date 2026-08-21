import { createContext, memo, useContext, useState } from 'react';
import { Button, Typography, Select, Input } from '@arco-design/web-react';
import { IconEye, IconPlayArrow, IconLoading, IconVideoCamera } from '@arco-design/web-react/icon';
import { SHOT_TEMPLATES_BY_CATEGORY } from '../../../utils/film/recipes';

const { Text } = Typography;

export const PrevizContext = createContext({ onBlockout: null, onPrevizTake: null, onBeautyTake: null, onPatchPreviz: null, onOpenTakes: null });

// Blur-commit draft — keystrokes through the RF store echo back a beat late.
const DraftArea = ({ value, onCommit, ...rest }) => {
  const [draft, setDraft] = useState(null);
  return (
    <Input.TextArea
      {...rest}
      value={draft !== null ? draft : (value || '')}
      onChange={(v) => setDraft(v)}
      onFocus={() => setDraft(value || '')}
      onBlur={() => { if (draft !== null && draft !== (value || '')) onCommit(draft); setDraft(null); }}
    />
  );
};

const Section = ({ label, children }) => (
  <div style={{ background: '#f7f8fa', border: '1px solid #eceff3', borderRadius: 6, padding: 6 }}>
    <Text style={{ display: 'block', fontSize: 9, fontWeight: 700, color: '#86909c', letterSpacing: 0.4, marginBottom: 4 }}>{label}</Text>
    {children}
  </div>
);

// A completed step: the artifact's thumb + what it is. Clicking flies to the node.
const StepDone = ({ label, detail }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 5, background: '#e8f7ee', border: '1px solid #b7ebc6' }}>
    <Text style={{ fontSize: 10, fontWeight: 700, color: '#00875a', flexShrink: 0 }}>✓ {label}</Text>
    <Text style={{ fontSize: 10, color: '#4e5969' }} ellipsis>{detail}</Text>
  </div>
);

// THE PREVIZ CARD — structure first, look second. Three taps, three artifacts:
// clay blockout still → 480p previz take → 1080p beauty pass (a Seedance EDITING task).
// Standalone: nothing here reads the screenplay, the strip or the shot list.
const PrevizNodeInner = ({ id, data, selected }) => {
  const { onBlockout, onPrevizTake, onBeautyTake, onPatchPreviz, onOpenTakes } = useContext(PrevizContext);
  const busy = !!data.busy;
  const plan = data.plan || null;
  const hasBrief = !!String(data.brief || '').trim();
  const step = data.beautyId ? 3 : data.previzId ? 2 : data.blockoutId ? 1 : 0;
  return (
    <div style={{ width: 420, display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 10, border: `2px solid ${selected ? '#3491fa' : '#d9d9e3'}`, boxShadow: selected ? '0 0 0 3px rgba(52,145,250,0.12)' : '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <div style={{ height: 4, background: '#3491fa' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid #f2f3f5' }}>
        <IconEye style={{ color: '#3491fa', fontSize: 14 }} />
        <Text bold style={{ fontSize: 12, flex: 1 }} ellipsis>Previz</Text>
        {Number(data.takeCount) > 0 && (
          <Text
            className="nodrag"
            title="Open this card's takes in the Take Library — scrub, download, add to the timeline"
            onClick={(e) => { e.stopPropagation(); onOpenTakes && onOpenTakes(id); }}
            style={{ fontSize: 10, color: '#3491fa', cursor: 'pointer', fontWeight: 600 }}
          >🎞 {data.takeCount}</Text>
        )}
        <Text type="secondary" style={{ fontSize: 10 }}>{step}/3</Text>
      </div>

      <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()} style={{ padding: '6px 8px 0' }}>
        <Section label="SCENE">
          <DraftArea
            value={data.brief}
            onCommit={(v) => onPatchPreviz && onPatchPreviz(id, { brief: v })}
            placeholder="the shot — who is where, what happens, how the camera moves…"
            autoSize={{ minRows: 2, maxRows: 8 }}
            style={{ fontSize: 11 }}
          />
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <Select
              size="mini" style={{ flex: 1 }} placeholder="camera — planner chooses" allowClear showSearch
              value={data.camera || undefined}
              onChange={(v) => onPatchPreviz && onPatchPreviz(id, { camera: v || '' })}
            >
              {SHOT_TEMPLATES_BY_CATEGORY.map(({ category, templates }) => (
                <Select.OptGroup key={category} label={category}>
                  {templates.map((t) => <Select.Option key={t.id} value={t.id}>{t.name}</Select.Option>)}
                </Select.OptGroup>
              ))}
            </Select>
            <Select
              size="mini" style={{ width: 74, flexShrink: 0 }}
              value={data.durationSec || 5}
              onChange={(v) => onPatchPreviz && onPatchPreviz(id, { durationSec: v })}
              options={[5, 8, 10, 12].map((v) => ({ label: `${v}s`, value: v }))}
              title="Previz take length — the beauty pass inherits it"
            />
          </div>
        </Section>
      </div>

      <div className="nodrag" onClick={(e) => e.stopPropagation()} style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {/* 1 — clay blockout. The cheap gate: identity-free, re-roll until staging is right. */}
        {data.blockoutId
          ? <StepDone label="Blockout" detail={plan ? `${(plan.subjects || []).map((s) => s.color.toLowerCase()).join(', ')} — clay` : 'clay still'} />
          : null}
        <Button
          size="small" long loading={busy && data.step === 'blockout'} disabled={!hasBrief || busy}
          icon={<IconPlayArrow />}
          onClick={() => onBlockout && onBlockout(id)}
          style={data.blockoutId ? {} : { background: '#3491fa', borderColor: '#3491fa', color: '#fff' }}
          title="Plan the staging and render the clay blockout still — colour-coded, identity-free. 1 reasoner call + 1 image; re-roll freely."
        >
          {data.blockoutId ? 'Re-roll blockout' : '1 · Blockout still'}
        </Button>

        {/* 2 — the previz take. Cheapest video the model sells; all structure decided here. */}
        <Button
          size="small" long loading={busy && data.step === 'previz'} disabled={!data.blockoutId || busy}
          icon={<IconVideoCamera />}
          onClick={() => onPrevizTake && onPrevizTake(id)}
          style={data.blockoutId && !data.previzId ? { background: '#3491fa', borderColor: '#3491fa', color: '#fff' } : {}}
          title={data.blockoutId ? 'Animate the blockout at 480p — the still rides as the first frame. Blocking, camera and timing get decided here.' : 'Render the blockout still first'}
        >
          {data.previzId ? 'Re-shoot previz' : '2 · Previz take · 480p'}
        </Button>

        {/* 3 — the beauty pass: an EDITING task, so ratio and duration come from the previz. */}
        <Button
          size="small" long loading={busy && data.step === 'beauty'} disabled={!data.previzId || busy}
          icon={<IconVideoCamera />}
          onClick={() => onBeautyTake && onBeautyTake(id)}
          style={data.previzId && !data.beautyId ? { background: '#b06f10', borderColor: '#b06f10', color: '#fff' } : {}}
          title={data.previzId ? 'Re-render the previz photoreal at 1080p — a Seedance editing task: the clip is the master, so blocking, camera and timing are inherited exactly.' : 'Shoot the previz take first'}
        >
          {data.beautyId ? 'Re-run beauty pass' : '3 · Beauty pass · 1080p'}
        </Button>
      </div>

      {busy && (
        <Text style={{ fontSize: 10, color: '#165dff', padding: '0 10px 6px' }}><IconLoading /> {data.step === 'blockout' ? 'planning + rendering the blockout…' : data.step === 'previz' ? 'shooting the previz take…' : 'running the beauty pass…'}</Text>
      )}
      {String(data.error || '').trim() && (
        <Text style={{ fontSize: 10, color: '#f53f3f', padding: '0 10px 6px' }} ellipsis={{ rows: 2 }}>⚠ {data.error}</Text>
      )}
    </div>
  );
};

export default memo(PrevizNodeInner);
