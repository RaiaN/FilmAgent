import { Slider } from '@arco-design/web-react';

// ONE duration control for every video surface: 0–30 s, where 0 means Auto — no
// duration is sent and the model plays the events out as long as they take. Emits
// 'auto' for 0 and a whole number of seconds otherwise.
export const DURATION_MAX = 30;

const DurationSlider = ({ value, onChange, width = 170, className = '', labelColor = 'inherit', title }) => {
  const n = value == null || value === '' || value === 'auto'
    ? 0
    : Math.max(0, Math.min(DURATION_MAX, Math.round(Number(value) || 0)));
  return (
    <span className={className} title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, width }}>
      <Slider
        min={0} max={DURATION_MAX} step={1} value={n}
        onChange={(v) => onChange && onChange(Number(v) === 0 ? 'auto' : Number(v))}
        style={{ flex: 1, minWidth: 0 }}
      />
      <span style={{ fontSize: 11, minWidth: 34, textAlign: 'right', color: labelColor, fontVariantNumeric: 'tabular-nums' }}>
        {n === 0 ? 'Auto' : `${n}s`}
      </span>
    </span>
  );
};

export default DurationSlider;
