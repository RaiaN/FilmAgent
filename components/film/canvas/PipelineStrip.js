import { IconCheck } from '@arco-design/web-react/icon';

// Pipeline STATUS — non-clickable, rendered INLINE in the top toolbar (after the tools), so
// flex lays it out sequentially and it can NEVER overlap them. It only REPORTS where the film
// stands; the ACTIONS live on the left rail (Brief/Cast & World/Storyboard agents), the Brief
// node (Develop · Cast & World · Storyboard · New Shot) and the timeline (Render movie).
// ✓ once each output exists. Idea and Brief merged into ONE item — both keyed off the same
// verbatim brief text since the Brief became the container, so two items always flipped together.

const GREEN = '#00b42a';
const MUTE = '#86909c';

const Item = ({ label, done }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: done ? 600 : 500, color: done ? '#1d2129' : MUTE, flexShrink: 0 }}>
    {done && <IconCheck style={{ color: GREEN, fontSize: 13 }} />}
    {label}
  </span>
);

const Sep = () => <span style={{ color: '#c9cdd4', fontSize: 11, flexShrink: 0 }}>·</span>;

const PipelineStrip = ({ hasStory = false, hasCast = false, hasFilm = false, shots = 0, takes = 0 }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
    <Item label="Brief" done={hasStory} /><Sep />
    <Item label="Cast & world" done={hasCast} /><Sep />
    <Item label="Storyboard" /><Sep />
    <span style={{ fontSize: 12, color: MUTE, flexShrink: 0 }}>
      <span style={{ fontWeight: 600 }}>Filming:</span> {shots ? `${shots} shot${shots === 1 ? '' : 's'} · ${takes} take${takes === 1 ? '' : 's'}` : '—'}
    </span><Sep />
    <Item label={hasFilm ? 'Stitched' : 'Final cut'} done={hasFilm} />
  </span>
);

export default PipelineStrip;
