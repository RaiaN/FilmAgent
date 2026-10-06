import { useRef } from 'react';
import { Slider } from '@arco-design/web-react';

// A grading wheel: drag the puck toward a hue to push that zone's colour; the slider below
// is the zone's master (brightness). Double-click the wheel to reset it.
const SIZE = 96;

const ColorWheel = ({ label, value, master, onChange }) => {
  const ref = useRef(null);
  const set = (e) => {
    const r = ref.current.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 2 - 1;
    let y = ((e.clientY - r.top) / r.height) * 2 - 1;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    onChange({ ...value, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  };
  const px = (SIZE / 2) * (1 + value.x);
  const py = (SIZE / 2) * (1 + value.y);
  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'center', minWidth: 0 }}>
      <span style={{ fontSize: 12, color: '#4e5969' }}>{label}</span>
      <div
        ref={ref}
        role="slider"
        aria-label={`${label} colour`}
        aria-valuetext={`x ${value.x}, y ${value.y}`}
        tabIndex={0}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); set(e); }}
        onPointerMove={(e) => { if (e.buttons) set(e); }}
        onDoubleClick={() => onChange({ ...value, x: 0, y: 0 })}
        style={{
          width: SIZE, height: SIZE, borderRadius: '50%', position: 'relative', cursor: 'crosshair', touchAction: 'none',
          background: 'radial-gradient(circle, rgba(128,128,128,1) 0%, rgba(128,128,128,0.15) 62%, rgba(128,128,128,0) 72%), conic-gradient(from 90deg, #f33, #fd3, #3d3, #3dd, #36f, #d3d, #f33)',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.25)',
        }}
      >
        <span style={{ position: 'absolute', left: SIZE / 2 - 0.5, top: 6, bottom: 6, width: 1, background: 'rgba(255,255,255,.35)' }} />
        <span style={{ position: 'absolute', top: SIZE / 2 - 0.5, left: 6, right: 6, height: 1, background: 'rgba(255,255,255,.35)' }} />
        <span style={{ position: 'absolute', left: px - 6, top: py - 6, width: 12, height: 12, borderRadius: '50%', background: '#fff', boxShadow: '0 0 0 2px rgba(0,0,0,.6)' }} />
      </div>
      <div style={{ width: SIZE + 8 }}>
        <Slider size="small" min={master[0]} max={master[1]} step={0.01} value={value.m} onChange={(m) => onChange({ ...value, m })} formatTooltip={(v) => (v > 0 ? `+${v}` : v)} />
      </div>
    </div>
  );
};

export default ColorWheel;
