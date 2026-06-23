import { useState } from 'react';
import { Typography, Button, Tooltip, Tag, Empty } from '@arco-design/web-react';
import { IconClose, IconCopy, IconDownload, IconDelete, IconRight, IconDown, IconLoading } from '@arco-design/web-react/icon';

const { Text, Title } = Typography;

// Agent-introspection inspector: the full decision history, drillable by
// workflow → step → agent action. Renders trace.groups() (built in
// utils/film/core/trace.js) and updates live as a run progresses. Every prompt,
// reference and decision is here — nothing about the pipeline is hidden.

const STATUS_COLOR = { ok: '#00b42a', error: '#f53f3f', running: '#165dff', warn: '#ff7d00' };
const stepDot = (status) => STATUS_COLOR[status === 'approved' ? 'ok' : status === 'failed' ? 'error' : status === 'running' ? 'running' : 'warn'] || '#c9cdd4';

const KIND_LABEL = {
  'run.start': 'workflow', plan: 'plan', phase: 'phase',
  'step.running': 'step', 'step.approved': 'approved', 'step.failed': 'failed', 'step.skipped': 'skipped',
  qc: 'QC', reason: 'reason', generateImage: 'image', startVideo: 'video', pollVideo: 'poll',
  stitch: 'stitch', film: 'film', warning: 'warning', decision: 'decision', 'bible.classify': 'classify', 'bible.generate': 'generate',
};

// Identity anchors (a character) fed into a shot are the cross-role leak we hunt —
// highlight them so a leak is obvious at a glance in the refs list.
const isIdentityRef = (r) => /^character:/.test(r);

const ActionRow = ({ e }) => {
  const color = STATUS_COLOR[e.status] || '#86909c';
  return (
    <div style={{ padding: '3px 0 3px 8px', borderLeft: `2px solid ${color}`, marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 11, fontWeight: 600 }}>{KIND_LABEL[e.kind] || e.kind}</Text>
        {e.status === 'running' && <IconLoading style={{ fontSize: 10, color }} />}
        {e.model && <Text type="secondary" style={{ fontSize: 10 }}>{e.model}{e.size ? ` · ${e.size}` : ''}</Text>}
        <span style={{ flex: 1 }} />
        <Text type="secondary" style={{ fontSize: 10 }}>+{e.dt.toFixed(1)}s{e.ms != null ? ` · ${e.ms}ms` : ''}</Text>
      </div>
      {e.note && <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{e.note}</Text>}
      {e.plan && <Text style={{ fontSize: 10, display: 'block', whiteSpace: 'pre-wrap', color: '#4e5969' }}>{e.plan}</Text>}
      {e.prompt && (
        <div style={{ fontSize: 11, color: '#1d2129', background: '#f7f8fa', borderRadius: 4, padding: '3px 6px', margin: '2px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.prompt}</div>
      )}
      {e.refs && e.refs.length > 0 && (
        <div style={{ fontSize: 10, color: '#86909c', wordBreak: 'break-word' }}>
          refs: {e.refs.map((r, i) => (
            <span key={r + i} style={{ color: isIdentityRef(r) ? '#ff7d00' : '#86909c', fontWeight: isIdentityRef(r) ? 600 : 400 }}>
              {r}{i < e.refs.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      )}
      {e.assignments && <Text style={{ fontSize: 10, color: '#0fc6c2', display: 'block' }}>→ {e.assignments}</Text>}
      {e.result && <Text style={{ fontSize: 10, color: '#00b42a', display: 'block', wordBreak: 'break-word' }}>→ {e.result}</Text>}
      {e.error && <Text style={{ fontSize: 10, color: '#f53f3f', display: 'block' }}>✗ {e.error}</Text>}
    </div>
  );
};

const StepBlock = ({ step }) => {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ margin: '4px 0' }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        {open ? <IconDown style={{ fontSize: 10 }} /> : <IconRight style={{ fontSize: 10 }} />}
        <Tag size="small" color="arcoblue" style={{ fontSize: 9 }}>{step.agent || 'step'}</Tag>
        <Text style={{ fontSize: 11, fontWeight: 600, flex: 1 }} ellipsis>{step.title}</Text>
        {step.status && <span title={step.status} style={{ width: 7, height: 7, borderRadius: 4, background: stepDot(step.status), flexShrink: 0 }} />}
      </div>
      {open && <div style={{ paddingLeft: 10 }}>{step.actions.map((e) => <ActionRow key={e.seq} e={e} />)}</div>}
    </div>
  );
};

const WorkflowBlock = ({ run, defaultOpen }) => {
  const [open, setOpen] = useState(!!defaultOpen);
  const failed = run.steps.some((s) => s.status === 'failed') || run.actions.some((a) => a.status === 'error');
  return (
    <div style={{ border: '1px solid #e5e6eb', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: '#f7f8fa', cursor: 'pointer' }}>
        {open ? <IconDown style={{ fontSize: 12 }} /> : <IconRight style={{ fontSize: 12 }} />}
        <Text style={{ fontSize: 12, fontWeight: 700, flex: 1 }} ellipsis>{run.title || 'Workflow'}</Text>
        {failed && <Tag size="small" color="red" style={{ fontSize: 9 }}>error</Tag>}
        <Text type="secondary" style={{ fontSize: 10 }}>{run.steps.length ? `${run.steps.length} step${run.steps.length === 1 ? '' : 's'}` : `${run.actions.length} action${run.actions.length === 1 ? '' : 's'}`}</Text>
      </div>
      {open && (
        <div style={{ padding: '6px 10px' }}>
          {run.actions.map((e) => <ActionRow key={e.seq} e={e} />)}
          {run.steps.map((st) => <StepBlock key={st.stepId} step={st} />)}
        </div>
      )}
    </div>
  );
};

const HistoryPanel = ({ groups = [], actionCount = 0, onClose, onCopy, onDownload, onClear }) => (
  <div style={{ width: 400, flexShrink: 0, background: '#fff', borderRight: '1px solid #e5e6eb', display: 'flex', flexDirection: 'column' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #f2f3f5' }}>
      <Title heading={6} style={{ margin: 0 }}>Decision history</Title>
      <span style={{ display: 'inline-flex', gap: 2 }}>
        <Tooltip content="Copy the full log as text (paste it anywhere)"><Button size="mini" type="text" icon={<IconCopy />} disabled={!actionCount} onClick={onCopy} /></Tooltip>
        <Tooltip content="Download as .txt"><Button size="mini" type="text" icon={<IconDownload />} disabled={!actionCount} onClick={onDownload} /></Tooltip>
        <Tooltip content="Clear the log"><Button size="mini" type="text" icon={<IconDelete />} disabled={!actionCount} onClick={onClear} /></Tooltip>
        <Tooltip content="Close"><Button size="mini" type="text" icon={<IconClose />} onClick={onClose} /></Tooltip>
      </span>
    </div>
    <div style={{ padding: '6px 12px' }}>
      <Text type="secondary" style={{ fontSize: 11 }}>
        Every prompt, reference & decision — by workflow → step → agent action.{' '}
        <b style={{ color: '#ff7d00' }}>Orange refs</b> = identity anchors; watch for them leaking into the wrong shot.
      </Text>
    </div>
    <div className="nowheel" style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 12px' }}>
      {groups.length === 0 ? (
        <Empty description={<Text type="secondary" style={{ fontSize: 12 }}>No actions yet. Build the brand kit or Generate the ad — every step shows up here live.</Text>} />
      ) : groups.map((run, i) => <WorkflowBlock key={run.runId == null ? `misc-${i}` : `run-${run.runId}`} run={run} defaultOpen={i === groups.length - 1} />)}
    </div>
  </div>
);

export default HistoryPanel;
