import { useState } from 'react';
import { Typography, Button, Tag, Select, Checkbox, Input, Space, Divider, Tooltip } from '@arco-design/web-react';
import {
  IconThunderbolt, IconClose, IconRefresh, IconUp, IconDown, IconDelete,
  IconPlayArrow, IconCheckCircle, IconLoading, IconEdit, IconExclamationCircleFill,
  IconCheck, IconRobot, IconSkipNext,
} from '@arco-design/web-react/icon';
import { AGENT_MAP, AGENT_COLORS, PLANNABLE_AGENTS } from '../../../utils/film/agents';
import { agentIcon } from './agentIcons';
import { SettingsControls } from './LayerPanel';
import { useAutoDirector } from './AutoDirectorContext';

const { Text, Title, Paragraph } = Typography;
const COLOR = AGENT_COLORS.autoDirector;

const STATUS_CHIP = {
  understanding: { label: 'Understanding…', color: 'arcoblue' },
  planning: { label: 'Planning…', color: 'arcoblue' },
  'review-plan': { label: 'Review plan', color: 'purple' },
  running: { label: 'Producing', color: 'gold' },
  assembling: { label: 'Stitching…', color: 'orange' },
  done: { label: 'Film ready', color: 'green' },
  error: { label: 'Error', color: 'red' },
};

const STEP_BADGE = {
  pending: { label: 'Pending', color: 'gray' },
  running: { label: 'Running…', color: 'arcoblue' },
  qc: { label: 'QC…', color: 'cyan' },
  review: { label: 'Review', color: 'gold' },
  approved: { label: 'Approved', color: 'green' },
  skipped: { label: 'Skipped', color: 'gray' },
  failed: { label: 'Failed', color: 'red' },
};

const VERDICT = {
  pass: { label: 'QC pass', color: '#00b42a', bg: '#e8ffea' },
  warn: { label: 'QC warning', color: '#ff7d00', bg: '#fff7e8' },
  fail: { label: 'QC fail', color: '#f53f3f', bg: '#ffece8' },
};
const SEV = { low: '#86909c', medium: '#ff7d00', high: '#f53f3f' };

const AgentChip = ({ agent }) => {
  const meta = AGENT_MAP[agent];
  const Icon = agentIcon(meta?.icon);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: meta?.color }}>
      <Icon style={{ fontSize: 13 }} />
      <Text style={{ fontSize: 11, color: meta?.color }}>{meta?.label || agent}</Text>
    </span>
  );
};

// QC verdict + issues, shown under a reviewed step.
const QcReport = ({ qc }) => {
  if (!qc) return null;
  const v = VERDICT[qc.verdict] || VERDICT.pass;
  return (
    <div style={{ marginTop: 6, padding: 8, borderRadius: 6, background: v.bg }}>
      <Text style={{ fontSize: 11, fontWeight: 600, color: v.color }}>{v.label}</Text>
      {(qc.issues || []).map((it, i) => (
        <div key={i} style={{ marginTop: 4, display: 'flex', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: 6, background: SEV[it.severity] || SEV.medium, marginTop: 5, flexShrink: 0 }} />
          <div>
            <Text style={{ fontSize: 11, display: 'block' }}>{it.message}</Text>
            {it.suggestion && <Text type="secondary" style={{ fontSize: 10 }}>→ {it.suggestion}</Text>}
          </div>
        </div>
      ))}
      {(!qc.issues || qc.issues.length === 0) && (
        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>No issues flagged.</Text>
      )}
    </div>
  );
};

// Output keeper picker for a reviewed step.
const OutputPicker = ({ step, onPick }) => {
  const outs = step.outputs || [];
  if (outs.length === 0) return null;
  const best = step.qc?.best;
  return (
    <div style={{ marginTop: 6 }}>
      <Text type="secondary" style={{ fontSize: 10 }}>Pick the keeper{outs.length > 1 ? ` (${outs.length})` : ''}:</Text>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
        {outs.map((o, i) => {
          const picked = (step.pickedId || outs[best]?.id) === o.id;
          return (
            <div
              key={o.id}
              onClick={() => onPick(o.id)}
              title={o.label}
              style={{ position: 'relative', width: 64, height: 48, borderRadius: 5, overflow: 'hidden', cursor: 'pointer', border: `2px solid ${picked ? COLOR : '#e5e6eb'}`, background: '#f2f3f5', flexShrink: 0 }}
            >
              {o.kind === 'video'
                ? <video src={o.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
                : <img src={o.url} alt={o.label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
              {i === best && <span style={{ position: 'absolute', top: 1, left: 1, background: COLOR, color: '#fff', fontSize: 8, borderRadius: 4, padding: '0 3px' }}>QC pick</span>}
              {picked && <IconCheck style={{ position: 'absolute', right: 2, bottom: 2, color: '#fff', background: COLOR, borderRadius: 8, fontSize: 11, padding: 1 }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Brief = ({ brief, onReplan, busy }) => {
  const [open, setOpen] = useState(true);
  if (!brief) return null;
  return (
    <div style={{ padding: '6px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 11, fontWeight: 600 }}>Brief</Text>
        <Button size="mini" type="text" onClick={() => setOpen((v) => !v)} style={{ fontSize: 11 }}>{open ? 'Hide' : 'Show'}</Button>
      </div>
      {open && (
        <div style={{ fontSize: 11, color: '#4e5969' }}>
          {brief.logline && <Paragraph style={{ fontSize: 11, margin: '2px 0' }}>{brief.logline}</Paragraph>}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            {brief.genre && <Tag size="small" color="purple">{brief.genre}</Tag>}
            {brief.mood && <Tag size="small">{brief.mood}</Tag>}
            {brief.palette && <Tag size="small" color="cyan">{brief.palette}</Tag>}
          </div>
          {(brief.subjects || []).length > 0 && (
            <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>Subjects: {brief.subjects.map((s) => s.name).join(', ')}</Text>
          )}
          {(brief.locations || []).length > 0 && (
            <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>Locations: {brief.locations.map((l) => l.name).join(', ')}</Text>
          )}
        </div>
      )}
    </div>
  );
};

// Editable step (review-plan stage).
const PlanStepRow = ({ step, index, total, apiKey, actions }) => {
  const [editing, setEditing] = useState(false);
  return (
    <div style={{ border: '1px solid #e5e6eb', borderRadius: 8, padding: 8, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 11, color: COLOR, fontWeight: 600 }}>{index + 1}</Text>
        <AgentChip agent={step.agent} />
        <span style={{ flex: 1 }} />
        <Tooltip content="Move up"><Button size="mini" type="text" icon={<IconUp />} disabled={index === 0} onClick={() => actions.moveStep(step.id, -1)} /></Tooltip>
        <Tooltip content="Move down"><Button size="mini" type="text" icon={<IconDown />} disabled={index === total - 1} onClick={() => actions.moveStep(step.id, 1)} /></Tooltip>
        <Tooltip content="Remove"><Button size="mini" type="text" status="danger" icon={<IconDelete />} onClick={() => actions.removeStep(step.id)} /></Tooltip>
      </div>
      <Input
        size="mini"
        value={step.title}
        onChange={(v) => actions.editStep(step.id, { title: v })}
        style={{ marginTop: 4 }}
      />
      <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>{step.intent}</Text>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <Checkbox checked={step.gated} onChange={() => actions.toggleGate(step.id)}>
          <Text style={{ fontSize: 11 }}>Require my review</Text>
        </Checkbox>
        <Button size="mini" type="text" icon={<IconEdit />} onClick={() => setEditing((v) => !v)} style={{ fontSize: 11 }}>
          {editing ? 'Done' : 'Params'}
        </Button>
      </div>
      {editing && AGENT_MAP[step.agent] && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e5e6eb' }}>
          <SettingsControls
            layer={AGENT_MAP[step.agent]}
            settings={step.params}
            setSettings={(next) => actions.editStep(step.id, { params: next })}
            selection={[]}
            apiKey={apiKey}
          />
        </div>
      )}
    </div>
  );
};

// Executing step (running stage): badge + (when active) review controls.
const RunStepRow = ({ step, index, active, busy, actions }) => {
  const badge = STEP_BADGE[step.status] || STEP_BADGE.pending;
  return (
    <div style={{ border: `1px solid ${active ? COLOR : '#e5e6eb'}`, borderRadius: 8, padding: 8, marginBottom: 6, background: active ? '#fbfaff' : '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 11, color: COLOR, fontWeight: 600 }}>{index + 1}</Text>
        <AgentChip agent={step.agent} />
        <span style={{ flex: 1 }} />
        <Tag size="small" color={badge.color}>{badge.label}</Tag>
      </div>
      <Text style={{ fontSize: 11, fontWeight: 600, display: 'block', marginTop: 2 }}>{step.title}</Text>
      {active && (
        <>
          <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>{step.intent}</Text>

          {(step.status === 'pending') && (
            <Button
              size="small" long type="primary" icon={<IconPlayArrow />}
              loading={busy === 'running-step'}
              style={{ marginTop: 6, background: COLOR, borderColor: COLOR }}
              onClick={() => actions.runStep(step.id)}
            >
              Run this step
            </Button>
          )}

          {(step.status === 'running' || step.status === 'qc') && (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconLoading style={{ color: COLOR }} />
              <Text type="secondary" style={{ fontSize: 11 }}>{step.status === 'qc' ? 'Quality-checking…' : 'Generating…'}</Text>
            </div>
          )}

          {step.status === 'review' && (
            <>
              <QcReport qc={step.qc} />
              <OutputPicker step={step} onPick={(id) => actions.pickOutput(step.id, id)} />
              <Space style={{ marginTop: 8 }} wrap size={4}>
                <Button size="small" type="primary" icon={<IconCheckCircle />} style={{ background: COLOR, borderColor: COLOR }} onClick={() => actions.approveStep(step.id)}>Approve &amp; continue</Button>
                <Button size="small" icon={<IconRefresh />} loading={busy === 'running-step'} onClick={() => actions.regenStep(step.id)}>Regenerate</Button>
                <Button size="small" type="text" icon={<IconSkipNext />} onClick={() => actions.skipStep(step.id)}>Skip</Button>
              </Space>
            </>
          )}

          {step.status === 'failed' && (
            <div style={{ marginTop: 6 }}>
              <Text type="error" style={{ fontSize: 11, display: 'block' }}><IconExclamationCircleFill /> {step.error || 'This step failed.'}</Text>
              <Space style={{ marginTop: 4 }} size={4}>
                <Button size="small" icon={<IconRefresh />} loading={busy === 'running-step'} onClick={() => actions.regenStep(step.id)}>Retry</Button>
                <Button size="small" type="text" icon={<IconSkipNext />} onClick={() => actions.skipStep(step.id)}>Skip</Button>
              </Space>
            </div>
          )}
        </>
      )}
      {!active && step.qc && step.status === 'approved' && (
        <Tag size="small" color={VERDICT[step.qc.verdict]?.label ? (step.qc.verdict === 'pass' ? 'green' : step.qc.verdict === 'warn' ? 'orange' : 'red') : 'gray'} style={{ marginTop: 4 }}>
          {VERDICT[step.qc.verdict]?.label || 'reviewed'}
        </Tag>
      )}
    </div>
  );
};

const AutoPlanNode = () => {
  const ctx = useAutoDirector();
  const plan = ctx?.plan;
  const actions = ctx?.actions || {};
  const apiKey = ctx?.apiKey;

  const chip = STATUS_CHIP[plan?.status] || STATUS_CHIP.understanding;
  const steps = plan?.steps || [];
  const approvedCount = steps.filter((s) => s.status === 'approved' || s.status === 'skipped').length;

  return (
    <div style={{ width: 360, background: '#fff', borderRadius: 12, border: `2px solid ${COLOR}`, boxShadow: '0 4px 18px rgba(90,61,240,0.18)', overflow: 'hidden' }}>
      {/* Header — draggable handle for the node */}
      <div style={{ height: 4, background: COLOR }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
        <IconThunderbolt style={{ color: COLOR, fontSize: 18 }} />
        <Title heading={6} style={{ margin: 0 }}>Auto Director</Title>
        <Tag size="small" color={chip.color}>{chip.label}</Tag>
        <span style={{ flex: 1 }} />
        {plan?.status === 'running' && <Text type="secondary" style={{ fontSize: 11 }}>{approvedCount}/{steps.length}</Text>}
        <Tooltip content="Discard plan"><Button className="nodrag" size="mini" type="text" icon={<IconClose />} onClick={actions.discard} /></Tooltip>
      </div>

      {/* Body — interactive, must not pan/zoom/drag the canvas */}
      <div className="nodrag nowheel" onWheel={(e) => e.stopPropagation()} style={{ maxHeight: 540, overflowY: 'auto', padding: '0 10px 10px' }}>
        {(plan?.status === 'understanding' || plan?.status === 'planning') && (
          <div style={{ padding: '18px 0', textAlign: 'center' }}>
            <IconLoading style={{ fontSize: 22, color: COLOR }} />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
              {plan.status === 'understanding' ? 'Reading your assets & idea…' : 'Planning the production…'}
            </Text>
          </div>
        )}

        {plan?.status === 'error' && (
          <div style={{ padding: '12px 0' }}>
            <Text type="error" style={{ fontSize: 12 }}>{plan.error || 'Something went wrong.'}</Text>
            <Button size="small" long icon={<IconRefresh />} style={{ marginTop: 8 }} onClick={actions.replan}>Try again</Button>
          </div>
        )}

        {(plan?.status === 'review-plan') && (
          <>
            <Brief brief={plan.brief} onReplan={actions.replan} busy={plan.busy} />
            <Divider style={{ margin: '6px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={{ fontSize: 11, fontWeight: 600 }}>Plan · {steps.length} steps</Text>
              <Button size="mini" type="text" icon={<IconRefresh />} loading={plan.busy === 'planning'} onClick={actions.replan}>Replan</Button>
            </div>
            {steps.map((s, i) => (
              <PlanStepRow key={s.id} step={s} index={i} total={steps.length} apiKey={apiKey} actions={actions} />
            ))}
            <Select
              size="small"
              placeholder="+ Add a step"
              value={undefined}
              onChange={(agent) => actions.addStep(agent)}
              style={{ width: '100%', marginTop: 2 }}
              options={(PLANNABLE_AGENTS || []).map((id) => ({ label: AGENT_MAP[id]?.label || id, value: id }))}
            />
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Mode</Text>
              <Select size="mini" value={plan.mode || 'review'} onChange={actions.setMode} style={{ width: 150 }}
                options={[{ label: 'Review each step', value: 'review' }, { label: 'Auto-run (gated only)', value: 'auto' }]} />
            </div>
            {!apiKey && <Text type="error" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>Add your API key (⚙ far-left) to run.</Text>}
            <Button long type="primary" icon={<IconPlayArrow />} disabled={!steps.length || !apiKey} style={{ background: COLOR, borderColor: COLOR }} onClick={actions.start}>
              Start production
            </Button>
          </>
        )}

        {(plan?.status === 'running' || plan?.status === 'assembling' || plan?.status === 'done') && (
          <>
            <Brief brief={plan.brief} onReplan={actions.replan} busy={plan.busy} />
            <Divider style={{ margin: '6px 0' }} />
            {steps.map((s, i) => (
              <RunStepRow key={s.id} step={s} index={i} active={i === plan.cursor && plan.status === 'running'} busy={plan.busy} actions={actions} />
            ))}

            {plan.status === 'assembling' && (
              <div style={{ padding: '10px 0', textAlign: 'center' }}>
                <IconLoading style={{ fontSize: 20, color: COLOR }} />
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>Stitching the final cut…</Text>
              </div>
            )}

            {plan.status === 'done' && (
              <div style={{ padding: 10, borderRadius: 8, background: '#e8ffea', textAlign: 'center' }}>
                <IconCheckCircle style={{ color: '#00b42a', fontSize: 22 }} />
                <Text style={{ fontSize: 12, display: 'block', fontWeight: 600 }}>Film assembled</Text>
                {plan.filmUrl && <Button size="small" type="primary" style={{ marginTop: 6, background: COLOR, borderColor: COLOR }} onClick={() => window.open(plan.filmUrl, '_blank')}>Open final cut</Button>}
              </div>
            )}

            <Divider style={{ margin: '8px 0' }} />
            <Button long type="text" icon={<IconRobot />} onClick={actions.takeOver}>Take over manually</Button>
          </>
        )}
      </div>
    </div>
  );
};

export default AutoPlanNode;
