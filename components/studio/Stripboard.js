import { C, MONO, SCRIPT_FONT, Label, Pill, crewColor } from './ui';
import { pad2 } from '../../utils/film/studio/model';
import { pagesLabel } from '../../utils/film/core/scriptForm';

// THE SCRIPT BREAKDOWN as a stripboard: numbered scenes with their slugline and length, each
// scene's breakdown sheet as chips, and the film's elements across scenes.
const Chips = ({ label, items, color }) => (items.length ? (
  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5 }}>
    <span style={{ color: C.muted, width: 52 }}>{label}</span>
    {items.map((x) => <Pill key={x} color={color || C.text} bg={C.panel} style={{ border: `1px solid ${C.line}` }}>{x}</Pill>)}
  </div>
) : null);

const Elements = ({ b }) => (
  <div style={{ background: C.raised, border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px', display: 'grid', gap: 6 }}>
    <Label style={{ marginBottom: 0 }}>The film's elements</Label>
    <Chips label="Cast" items={b.elements.cast.map((e) => `${e.name} · ${e.scenes.join(', ')}`)} color={crewColor('casting')} />
    <Chips label="Places" items={b.elements.places.map((e) => `${e.name} · ${e.scenes.join(', ')}`)} color={crewColor('designer')} />
    <Chips label="Props" items={b.elements.props.map((e) => `${e.name} · ${e.scenes.join(', ')}`)} />
  </div>
);

export const Stripboard = ({ b }) => (
  <div style={{ display: 'grid', gap: 8 }}>
    <Elements b={b} />
    {b.scenes.map((sc) => (
      <div key={sc.n} style={{ background: C.raised, border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px', display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <span style={{ fontFamily: MONO, fontWeight: 700, color: C.accent, fontSize: 12.5 }}>{pad2(sc.n)}</span>
          <span style={{ fontFamily: SCRIPT_FONT, fontSize: 12.5, color: C.ink, flex: 1, minWidth: 0 }}>{sc.slug}</span>
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.muted, whiteSpace: 'nowrap' }}>{pagesLabel(sc.eighths)} pg · {sc.seconds}s</span>
        </div>
        {sc.sheet && (
          <>
            <Chips label="Cast" items={sc.sheet.cast} color={crewColor('casting')} />
            <Chips label="Props" items={sc.sheet.props} />
            <Chips label="Extras" items={sc.sheet.extras} />
            <Chips label="Wardrobe" items={sc.sheet.wardrobe} />
            <Chips label="Dressing" items={sc.sheet.dressing} />
            <Chips label="Special" items={sc.sheet.special} color={C.warn} />
            <Chips label="Sound" items={sc.sheet.sound} />
          </>
        )}
      </div>
    ))}
  </div>
);

