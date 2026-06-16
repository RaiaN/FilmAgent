import { Button, Tooltip } from '@arco-design/web-react';
import { IconVideoCamera, IconRight } from '@arco-design/web-react/icon';

// The pipeline's BODY on the board. FILM_PIPELINE has always been explicit data
// and pipelineStatus() derives where the project stands — but until now that
// state only surfaced as chat prose, which forced a typed ritual ("continue")
// to move forward. This strip makes the pipeline the steering wheel: five stages
// as a stepper, status derived live from the board's artifacts, and the CURRENT
// stage carries its action as one button. The director chat stays the free-form
// channel (corrections, questions, "film this: …") — never the forward path.

const GOLD = '#b06f10';
const GREEN = '#00b42a';
const MUTE = '#86909c';
const LINE = '#e5e6eb';

// Compact display labels — the strip is tight; the chat/narration keep fuller names.
const SHORT_LABEL = { casting: 'Cast & world' };

// What one click means at each stage. Idea has no button of its own — the premise
// is a sentence only the user can write, so the strip routes to the director chat.
const STAGE_ACTION = {
  casting: { label: 'Draft the production', action: 'castDraft' },
  storyboard: { label: 'Storyboard it', action: 'storyboard' },
  filming: { label: 'Shoot the cards', action: 'action' },
  finalCut: { label: 'Stitch the film', action: 'stitch' },
};

// Optional, never-forced side step at a stage — a quiet secondary button. Inspiration
// is the Idea stage's divergence: riff on look/mood BEFORE committing to a cast.
const STAGE_SECONDARY = {
  casting: { label: '✨ Explore the look', action: 'inspiration' },
};

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const gateText = (gate) => (/^none/i.test(gate || '') ? 'No gate — explore freely' : `Done when you ${gate}`);

// The numbered status badge: green ✓ when done, filled gold when current, a hollow
// outline when still ahead. Reads as a stepper at a glance, no legend needed.
const Badge = ({ state, n }) => {
  const base = { width: 18, height: 18, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0, lineHeight: 1 };
  if (state === 'done') return <span style={{ ...base, background: GREEN, color: '#fff' }}>✓</span>;
  if (state === 'current') return <span style={{ ...base, background: GOLD, color: '#fff' }}>{n}</span>;
  return <span style={{ ...base, background: '#fff', border: `1.5px solid ${LINE}`, color: '#c9cdd4' }}>{n}</span>;
};

const PipelineStrip = ({ pipeline = [], busy, busyLabel, onAction, onOpenDirector }) => {
  const current = pipeline.find((s) => s.status !== 'done') || null;
  const act = current ? STAGE_ACTION[current.id] : null;
  const secondary = current ? STAGE_SECONDARY[current.id] : null;

  return (
    <div
      style={{
        position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 6,
        // width:max-content sizes to content despite the left:50% origin (otherwise
        // the layout width caps at ~half the canvas and the labels wrap).
        width: 'max-content', maxWidth: 'calc(100% - 24px)',
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 14px',
        background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999,
        boxShadow: '0 6px 20px rgba(0,0,0,0.10)', whiteSpace: 'nowrap', overflowX: 'auto',
      }}
    >
      {pipeline.map((s, i) => {
        const isCurrent = current && s.id === current.id;
        const state = s.status === 'done' ? 'done' : (isCurrent ? 'current' : 'todo');
        return (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {i > 0 && <IconRight style={{ fontSize: 11, color: '#c9cdd4', flexShrink: 0 }} />}
            <Tooltip
              content={(
                <div style={{ maxWidth: 230, fontSize: 12, lineHeight: 1.45 }}>
                  <div style={{ fontWeight: 600 }}>{s.label}</div>
                  <div style={{ opacity: 0.9 }}>{cap(s.note)}</div>
                  <div style={{ opacity: 0.6, marginTop: 2 }}>{gateText(s.gate)}</div>
                </div>
              )}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'default', flexShrink: 0 }}>
                <Badge state={state} n={i + 1} />
                <span style={{ fontSize: 12, whiteSpace: 'nowrap', fontWeight: isCurrent ? 700 : 500, color: isCurrent ? GOLD : (state === 'done' ? '#1d2129' : MUTE) }}>
                  {SHORT_LABEL[s.id] || s.label}
                </span>
              </span>
            </Tooltip>
          </span>
        );
      })}

      <span style={{ width: 1, height: 18, background: LINE, margin: '0 4px', flexShrink: 0 }} />

      {!current && (
        <span style={{ fontSize: 12, color: GREEN, fontWeight: 600, flexShrink: 0, paddingRight: 6 }}>That's a wrap — press ▶ to watch</span>
      )}
      {current && current.id === 'ideation' && (
        <Button size="small" type="primary" style={{ background: GOLD, borderColor: GOLD, borderRadius: 999, flexShrink: 0 }} onClick={onOpenDirector}>
          Describe the idea
        </Button>
      )}
      {current && secondary && (
        <Button size="small" type="text" disabled={busy} style={{ color: MUTE, borderRadius: 999, flexShrink: 0 }} onClick={() => onAction(secondary.action, {})}>
          {secondary.label}
        </Button>
      )}
      {current && act && (
        <Button size="small" type="primary" loading={busy} icon={<IconVideoCamera />} style={{ background: GOLD, borderColor: GOLD, borderRadius: 999, flexShrink: 0 }} onClick={() => onAction(act.action, {})}>
          {busy && busyLabel ? busyLabel : act.label}
        </Button>
      )}
    </div>
  );
};

export default PipelineStrip;
