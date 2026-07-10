import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Typography } from '@arco-design/web-react';
import { IconClose, IconUndo, IconDelete, IconLoading, IconCheck } from '@arco-design/web-react/icon';

const { Text } = Typography;

// Motion-arrow palette: the five silhouette colors (an arrow = that character's motion
// path) + WHITE, reserved for the CAMERA's move. The names feed the FIRST FRAME lock's
// arrows clause, so keep them in sync with the previz.mask template's color order.
export const ARROW_COLORS = [
  { hex: '#165dff', name: 'BLUE' },
  { hex: '#00b42a', name: 'GREEN' },
  { hex: '#fadc19', name: 'YELLOW' },
  { hex: '#f53f3f', name: 'RED' },
  { hex: '#722ed1', name: 'PURPLE' },
  { hex: '#ffffff', name: 'WHITE' }, // camera
];
export const arrowColorName = (hex) => (ARROW_COLORS.find((c) => c.hex === hex) || {}).name || 'COLORED';

// Draw one arrow (normalized 0..1 coords) onto a 2d context of w×h pixels. A dark
// underlay renders first so white/yellow arrows read on any background. Shared by the
// editor overlay AND the bake step, so what you draw is exactly what ships.
export const drawArrow = (ctx, a, w, h) => {
  const x1 = a.x1 * w; const y1 = a.y1 * h; const x2 = a.x2 * w; const y2 = a.y2 * h;
  const lw = Math.max(3, Math.round(Math.min(w, h) * 0.008));
  const head = lw * 4;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const paint = (color, width) => {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6));
    ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6));
    ctx.closePath(); ctx.fill();
  };
  paint('rgba(0,0,0,0.55)', lw + 4);
  paint(a.color, lw);
};

// The motion-arrow editor: the frame + a canvas overlay. Drag = one straight arrow
// (tail → head); plain click ON an arrow deletes it; pick the color per arrow. All
// manual — Save hands the vectors back to the canvas (which bakes + uploads).
const ArrowEditor = ({ src, initialArrows = [], saving = false, onSave, onClose }) => {
  const [arrows, setArrows] = useState(initialArrows);
  const [color, setColor] = useState(ARROW_COLORS[0].hex);
  const [draft, setDraft] = useState(null);
  const [dims, setDims] = useState(null);
  const imgRef = useRef(null);
  const canvasRef = useRef(null);

  const syncSize = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const r = img.getBoundingClientRect();
    if (r.width && r.height) setDims({ w: Math.round(r.width), h: Math.round(r.height) });
  }, []);
  useEffect(() => {
    window.addEventListener('resize', syncSize);
    return () => window.removeEventListener('resize', syncSize);
  }, [syncSize]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !dims) return;
    c.width = dims.w; c.height = dims.h;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, dims.w, dims.h);
    arrows.forEach((a) => drawArrow(ctx, a, dims.w, dims.h));
    if (draft) drawArrow(ctx, { ...draft, color }, dims.w, dims.h);
  }, [arrows, draft, dims, color]);

  const norm = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const segDistPx = (p, a) => {
    const x = p.x * dims.w; const y = p.y * dims.h;
    const x1 = a.x1 * dims.w; const y1 = a.y1 * dims.h; const x2 = a.x2 * dims.w; const y2 = a.y2 * dims.h;
    const dx = x2 - x1; const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
  };
  const onDown = (e) => { e.preventDefault(); if (!dims) return; const p = norm(e); setDraft({ x1: p.x, y1: p.y, x2: p.x, y2: p.y }); };
  const onMove = (e) => { if (!draft) return; const p = norm(e); setDraft((d) => (d ? { ...d, x2: p.x, y2: p.y } : d)); };
  const onUp = (e) => {
    if (!draft || !dims) return;
    const d = draft; setDraft(null);
    const px = Math.hypot((d.x2 - d.x1) * dims.w, (d.y2 - d.y1) * dims.h);
    if (px < 12) {
      // A plain click deletes the arrow under the cursor (nearest within 12px).
      const p = norm(e);
      const hit = [...arrows].reverse().find((a) => segDistPx(p, a) < 12);
      if (hit) setArrows((as) => as.filter((a) => a !== hit));
      return;
    }
    setArrows((as) => [...as, { ...d, color }]);
  };

  return (
    <div className="nodrag nowheel" style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={saving ? undefined : onClose}>
      <div style={{ background: '#161b22', border: '1px solid #2a313a', borderRadius: 12, padding: 14, maxWidth: '90vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', gap: 10, color: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: '#f7ba1e', fontSize: 13, fontWeight: 700 }}>Motion arrows</Text>
          <Text style={{ color: '#86909c', fontSize: 12, flex: 1 }}>drag = an arrow (tail → head) · click an arrow to delete · WHITE = the camera&apos;s move</Text>
          <Button size="mini" type="text" icon={<IconClose />} onClick={onClose} disabled={saving} style={{ color: '#86909c' }} />
        </div>

        <div style={{ position: 'relative', alignSelf: 'center' }}>
          <img
            ref={imgRef}
            src={src}
            alt="previz frame"
            onLoad={syncSize}
            style={{ display: 'block', maxWidth: '84vw', maxHeight: '68vh', borderRadius: 8, userSelect: 'none' }}
            draggable={false}
          />
          <canvas
            ref={canvasRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => setDraft(null)}
            style={{ position: 'absolute', inset: 0, cursor: 'crosshair', touchAction: 'none' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {ARROW_COLORS.map((c) => (
            <span
              key={c.hex}
              onClick={() => setColor(c.hex)}
              title={c.name === 'WHITE' ? 'WHITE — the camera\'s move' : `${c.name} — that character's path`}
              style={{
                width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', background: c.hex,
                border: c.hex === '#ffffff' ? '1px solid #86909c' : '1px solid transparent',
                boxShadow: color === c.hex ? '0 0 0 3px rgba(247,186,30,0.8)' : 'none',
              }}
            />
          ))}
          <span style={{ flex: 1 }} />
          <Button size="mini" icon={<IconUndo />} disabled={!arrows.length || saving} onClick={() => setArrows((as) => as.slice(0, -1))}>Undo</Button>
          <Button size="mini" icon={<IconDelete />} disabled={!arrows.length || saving} onClick={() => setArrows([])}>Clear</Button>
          <Button size="mini" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="mini" type="primary" icon={saving ? <IconLoading /> : <IconCheck />} disabled={saving} onClick={() => onSave && onSave(arrows)} style={{ background: '#b06f10', borderColor: '#b06f10' }}>
            {arrows.length ? 'Save arrows' : 'Save (clear arrows)'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default memo(ArrowEditor);
