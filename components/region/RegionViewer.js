import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button, Slider, Tooltip } from '@arco-design/web-react';
import { IconPause, IconPlayArrow, IconLeft, IconRight } from '@arco-design/web-react/icon';
import { FRAGMENT_SHADER, MAX_REGIONS, VERTEX_SHADER, gradeUniforms } from '../../utils/regionGrade';

// The grading viewer: WebGL draws every video frame with each region's grade blended in
// through its feathered window (one mask channel per region); a 2D overlay draws and edits
// the windows. Regions are { id, shape: 'ellipse'|'rect'|'lasso', pts:[{x,y}] (0–1), feather, grade }.

const REGION_COLORS = ['#ff3d9a', '#3dd6ff', '#ffd23d'];
const tracePath = (ctx, r, w, h) => {
  ctx.beginPath();
  if (r.shape === 'lasso') {
    r.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
    ctx.closePath();
    return;
  }
  const [a, b] = r.pts;
  const x = Math.min(a.x, b.x) * w; const y = Math.min(a.y, b.y) * h;
  const rw = Math.abs(b.x - a.x) * w; const rh = Math.abs(b.y - a.y) * h;
  if (r.shape === 'rect') ctx.rect(x, y, rw, rh);
  else ctx.ellipse(x + rw / 2, y + rh / 2, Math.max(1, rw / 2), Math.max(1, rh / 2), 0, 0, Math.PI * 2);
};
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

const RegionViewer = forwardRef(({ src, fps = 24, regions, selectedId, tool, onSelect, onRegionsChange, wipe, showMask }, ref) => {
  const videoRef = useRef(null);
  const glRef = useRef(null);
  const overlayRef = useRef(null);
  const gl = useRef(null); // { ctx, prog, vtex, mtex, loc }
  const maskData = useRef(null); // per-region alpha arrays (top-down, video resolution)
  const draft = useRef(null); // shape being drawn / region being moved
  const live = useRef({ regions, wipe, showMask, before: false });
  live.current = { ...live.current, regions, wipe, showMask };
  const [dims, setDims] = useState(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);

  // ---- WebGL setup once the clip's size is known
  const initGl = useCallback((w, h) => {
    const canvas = glRef.current;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!ctx) throw new Error('WebGL is not available in this browser.');
    const sh = (type, srcText) => { const s = ctx.createShader(type); ctx.shaderSource(s, srcText); ctx.compileShader(s); if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS)) throw new Error(ctx.getShaderInfoLog(s)); return s; };
    const prog = ctx.createProgram();
    ctx.attachShader(prog, sh(ctx.VERTEX_SHADER, VERTEX_SHADER));
    ctx.attachShader(prog, sh(ctx.FRAGMENT_SHADER, FRAGMENT_SHADER));
    ctx.linkProgram(prog);
    if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) throw new Error(ctx.getProgramInfoLog(prog));
    ctx.useProgram(prog);
    const buf = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), ctx.STATIC_DRAW);
    const aPos = ctx.getAttribLocation(prog, 'aPos');
    ctx.enableVertexAttribArray(aPos);
    ctx.vertexAttribPointer(aPos, 2, ctx.FLOAT, false, 0, 0);
    const tex = (unit) => {
      const tx = ctx.createTexture();
      ctx.activeTexture(ctx.TEXTURE0 + unit);
      ctx.bindTexture(ctx.TEXTURE_2D, tx);
      [ctx.TEXTURE_WRAP_S, ctx.TEXTURE_WRAP_T].forEach((p) => ctx.texParameteri(ctx.TEXTURE_2D, p, ctx.CLAMP_TO_EDGE));
      [ctx.TEXTURE_MIN_FILTER, ctx.TEXTURE_MAG_FILTER].forEach((p) => ctx.texParameteri(ctx.TEXTURE_2D, p, ctx.LINEAR));
      return tx;
    };
    const vtex = tex(0);
    const mtex = tex(1);
    ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, true);
    const loc = (n) => ctx.getUniformLocation(prog, n);
    ctx.uniform1i(loc('uVideo'), 0);
    ctx.uniform1i(loc('uMask'), 1);
    gl.current = { ctx, vtex, mtex, loc };
  }, []);

  // ---- mask: each region filled white and feathered, packed one per RGB channel
  const rebuildMask = useCallback(() => {
    if (!dims || !gl.current) return;
    const { w, h } = dims;
    const packed = new Uint8ClampedArray(w * h * 4);
    const per = [];
    regions.slice(0, MAX_REGIONS).forEach((r, i) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      const blur = Math.round((r.feather || 0) * w);
      if (blur > 0) g.filter = `blur(${blur}px)`;
      g.fillStyle = '#fff';
      tracePath(g, r, w, h);
      g.fill();
      const d = g.getImageData(0, 0, w, h).data;
      const a = new Uint8Array(w * h);
      for (let p = 0; p < w * h; p += 1) { a[p] = d[p * 4]; packed[p * 4 + i] = d[p * 4]; }
      per.push(a);
    });
    for (let p = 0; p < w * h; p += 1) packed[p * 4 + 3] = 255;
    maskData.current = per;
    const { ctx, mtex } = gl.current;
    ctx.activeTexture(ctx.TEXTURE1);
    ctx.bindTexture(ctx.TEXTURE_2D, mtex);
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, w, h, 0, ctx.RGBA, ctx.UNSIGNED_BYTE, new Uint8Array(packed.buffer));
  }, [dims, regions]);
  const shapesKey = JSON.stringify(regions.map((r) => [r.shape, r.pts, r.feather]));
  useEffect(() => { const id = setTimeout(rebuildMask, 40); return () => clearTimeout(id); }, [shapesKey, dims]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- one frame: the video, every region's grade, then the wipe / mask view
  const draw = useCallback(({ clean = false } = {}) => {
    const v = videoRef.current;
    if (!gl.current || !v || v.readyState < 2) return;
    const { ctx, vtex, loc } = gl.current;
    const { regions: rs, wipe: wp, showMask: sm, before } = live.current;
    ctx.activeTexture(ctx.TEXTURE0);
    ctx.bindTexture(ctx.TEXTURE_2D, vtex);
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGB, ctx.RGB, ctx.UNSIGNED_BYTE, v);
    const n = Math.min(MAX_REGIONS, rs.length);
    const flat = (k, size) => {
      const out = new Float32Array(MAX_REGIONS * size);
      rs.slice(0, n).forEach((r, i) => gradeUniforms(r.grade)[k].forEach((val, j) => { out[i * size + j] = val; }));
      return out;
    };
    ctx.uniform1i(loc('uCount'), before && !clean ? 0 : n);
    ctx.uniform4fv(loc('uP0'), flat('p0', 4));
    ctx.uniform4fv(loc('uP1'), flat('p1', 4));
    ctx.uniform3fv(loc('uLift'), flat('lift', 3));
    ctx.uniform3fv(loc('uGamma'), flat('gamma', 3));
    ctx.uniform3fv(loc('uGain'), flat('gain', 3));
    ctx.uniform1f(loc('uWipe'), clean || wp == null ? -1 : wp);
    ctx.uniform1f(loc('uShowMask'), !clean && sm ? 1 : 0);
    ctx.viewport(0, 0, ctx.drawingBufferWidth, ctx.drawingBufferHeight);
    ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
  }, []);

  useEffect(() => {
    let raf;
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // ---- overlay: window outlines, the selected one bold
  useEffect(() => {
    const c = overlayRef.current;
    if (!c || !dims) return;
    const box = c.getBoundingClientRect();
    c.width = Math.round(box.width * devicePixelRatio); c.height = Math.round(box.height * devicePixelRatio);
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const all = draft.current?.kind === 'new' ? [...regions, draft.current.region] : regions;
    all.forEach((r, i) => {
      g.save();
      g.lineWidth = (r.id === selectedId ? 2.5 : 1.5) * devicePixelRatio;
      g.strokeStyle = REGION_COLORS[i % REGION_COLORS.length];
      if (r.id !== selectedId) g.setLineDash([6 * devicePixelRatio, 4 * devicePixelRatio]);
      tracePath(g, r, c.width, c.height);
      g.stroke();
      g.restore();
    });
  });

  const point = (e) => { const b = overlayRef.current.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) }; };
  const hit = (p) => {
    const c = document.createElement('canvas'); c.width = 1000; c.height = 1000;
    const g = c.getContext('2d');
    return [...regions].reverse().find((r) => { tracePath(g, r, 1000, 1000); return g.isPointInPath(p.x * 1000, p.y * 1000); });
  };
  const [, redraw] = useState(0);
  const down = (e) => {
    if (!dims) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    if (tool === 'select') {
      const r = hit(p);
      onSelect(r ? r.id : null);
      if (r) draft.current = { kind: 'move', id: r.id, from: p, pts: r.pts };
      return;
    }
    if (regions.length >= MAX_REGIONS) return;
    draft.current = { kind: 'new', region: { id: `r${Date.now()}`, shape: tool, pts: tool === 'lasso' ? [p] : [p, p] } };
  };
  const move = (e) => {
    const d = draft.current;
    if (!d) return;
    const p = point(e);
    if (d.kind === 'move') {
      const dx = p.x - d.from.x; const dy = p.y - d.from.y;
      onRegionsChange(regions.map((r) => (r.id === d.id ? { ...r, pts: d.pts.map((q) => ({ x: q.x + dx, y: q.y + dy })) } : r)));
    } else {
      d.region = { ...d.region, pts: d.region.shape === 'lasso' ? [...d.region.pts, p] : [d.region.pts[0], p] };
      redraw((n) => n + 1);
    }
  };
  const up = () => {
    const d = draft.current;
    draft.current = null;
    if (d?.kind !== 'new') return;
    const r = d.region;
    const big = r.shape === 'lasso' ? r.pts.length > 4 : Math.abs(r.pts[1].x - r.pts[0].x) > 0.01 && Math.abs(r.pts[1].y - r.pts[0].y) > 0.01;
    if (big) onRegionsChange([...regions, r], r);
    redraw((n) => n + 1);
  };

  // ---- what the tab reads back
  useImperativeHandle(ref, () => ({
    // The current frame with every region graded, no wipe or mask tint: the look Seedance should match.
    gradedPng: () => { draw({ clean: true }); const url = glRef.current.toDataURL('image/png'); draw(); return url; },
    // Union of all windows, white on black, at the clip's resolution.
    maskPng: () => {
      const { w, h } = dims;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      const img = g.createImageData(w, h);
      const per = maskData.current;
      for (let p = 0; p < w * h; p += 1) {
        let v = 0;
        for (let i = 0; i < per.length; i += 1) if (per[i][p] > v) v = per[i][p];
        img.data[p * 4] = v; img.data[p * 4 + 1] = v; img.data[p * 4 + 2] = v; img.data[p * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    },
    // The graded colour inside region i, measured left / middle / right.
    sampleColours: (i) => {
      const { w, h } = dims;
      draw({ clean: true });
      const { ctx } = gl.current;
      const px = new Uint8Array(w * h * 4);
      ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      draw();
      const a = maskData.current[i];
      let x0 = w; let x1 = 0;
      for (let p = 0; p < w * h; p += 1) if (a[p] > 128) { const x = p % w; if (x < x0) x0 = x; if (x > x1) x1 = x; }
      if (x1 <= x0) return [];
      const sums = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
      for (let y = 0; y < h; y += 2) {
        for (let x = x0; x <= x1; x += 2) {
          const p = y * w + x;
          if (a[p] <= 128) continue;
          const third = Math.min(2, Math.floor(((x - x0) / (x1 - x0 + 1)) * 3));
          const q = ((h - 1 - y) * w + x) * 4; // readPixels rows run bottom-up
          sums[third][0] += px[q]; sums[third][1] += px[q + 1]; sums[third][2] += px[q + 2]; sums[third][3] += 1;
        }
      }
      return sums.filter((s) => s[3]).map((s) => hex([s[0] / s[3], s[1] / s[3], s[2] / s[3]]));
    },
    time: () => videoRef.current?.currentTime || 0,
  }), [dims, draw]);

  const v = videoRef.current;
  const step = (n) => { if (v) { v.pause(); v.currentTime = Math.min(dur, Math.max(0, v.currentTime + n / fps)); } };
  const hold = (on) => { live.current.before = on; };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: dims ? `${dims.w} / ${dims.h}` : '16 / 9', background: '#000', borderRadius: 6, overflow: 'hidden' }}>
        <video
          ref={videoRef}
          src={src}
          muted
          playsInline
          loop
          preload="auto"
          style={{ display: 'none' }}
          onLoadedMetadata={(e) => { const el = e.currentTarget; setDims({ w: el.videoWidth, h: el.videoHeight }); setDur(el.duration || 0); initGl(el.videoWidth, el.videoHeight); }}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        <canvas ref={glRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        <canvas
          ref={overlayRef}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: tool === 'select' ? 'default' : 'crosshair', touchAction: 'none' }}
        />
        {wipe != null && <span style={{ position: 'absolute', top: 0, bottom: 0, left: `${wipe * 100}%`, width: 2, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,.4)', pointerEvents: 'none' }} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button size="small" icon={playing ? <IconPause /> : <IconPlayArrow />} onClick={() => (v?.paused ? v.play() : v?.pause())} />
        <Tooltip content="Previous frame"><Button size="small" icon={<IconLeft />} onClick={() => step(-1)} /></Tooltip>
        <Tooltip content="Next frame"><Button size="small" icon={<IconRight />} onClick={() => step(1)} /></Tooltip>
        <div style={{ flex: 1, minWidth: 80 }}>
          <Slider size="small" min={0} max={dur || 1} step={1 / fps} value={t} onChange={(x) => { if (v) { v.pause(); v.currentTime = x; } }} formatTooltip={fmt} />
        </div>
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#4e5969', whiteSpace: 'nowrap' }}>{fmt(t)} / {fmt(dur)}</span>
        <Button size="small" onPointerDown={() => hold(true)} onPointerUp={() => hold(false)} onPointerLeave={() => hold(false)}>Hold for before</Button>
      </div>
    </div>
  );
});

export default RegionViewer;
