// Region Edit: the grade model shared by the live WebGL preview and the words sent to
// Seedance. Values are what a colourist dials; the shader and describeGrade() read the same.

export const MAX_REGIONS = 3; // one per RGB channel of the mask texture

export const PRIMARIES = [
  { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.05, def: 0, unit: 'stops' },
  { key: 'contrast', label: 'Contrast', min: 0.5, max: 1.5, step: 0.01, def: 1 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, def: 1 },
  { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, def: 0, unit: '°' },
  { key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.01, def: 0 },
  { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01, def: 0 },
];
// Lift / gamma / gain: a colour offset (wheel x, y in the unit disc) plus a master.
export const WHEELS = [
  { key: 'lift', label: 'Lift', master: [-0.2, 0.2], reach: 0.1 },
  { key: 'gamma', label: 'Gamma', master: [-0.5, 0.5], reach: 0.3 },
  { key: 'gain', label: 'Gain', master: [-0.5, 0.5], reach: 0.3 },
];

export const neutralGrade = () => ({
  ...Object.fromEntries(PRIMARIES.map((p) => [p.key, p.def])),
  ...Object.fromEntries(WHEELS.map((w) => [w.key, { x: 0, y: 0, m: 0 }])),
});

// Wheel position → RGB offset. Angle 0 = red at 3 o'clock, clockwise on screen, matching the
// wheel's conic gradient (red, yellow, green, cyan, blue, magenta).
export const wheelRgb = ({ x, y }, reach) => {
  const mag = Math.min(1, Math.hypot(x, y));
  const h = Math.atan2(y, x);
  return [Math.cos(h), Math.cos(h - (2 * Math.PI) / 3), Math.cos(h + (2 * Math.PI) / 3)].map((v) => v * mag * reach);
};

const HUE_NAMES = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'];
const HUE_AT = [0, 30, 60, 120, 180, 230, 275, 310];
export const hueName = (deg) => {
  const d = ((deg % 360) + 360) % 360;
  let best = 0;
  HUE_AT.forEach((h, i) => { const dist = Math.min(Math.abs(d - h), 360 - Math.abs(d - h)); if (dist < Math.min(Math.abs(d - HUE_AT[best]), 360 - Math.abs(d - HUE_AT[best]))) best = i; });
  return HUE_NAMES[best];
};
const strength = (v) => (Math.abs(v) < 0.25 ? 'slightly' : Math.abs(v) < 0.6 ? 'clearly' : 'strongly');

// The grade in words a video model can follow. Only what moved from neutral is said.
export const describeGrade = (g) => {
  const out = [];
  if (Math.abs(g.exposure) >= 0.05) out.push(`${Math.abs(g.exposure).toFixed(1)} stop${Math.abs(g.exposure) >= 1.05 ? 's' : ''} ${g.exposure > 0 ? 'brighter' : 'darker'}`);
  if (Math.abs(g.contrast - 1) >= 0.03) out.push(`${g.contrast > 1 ? 'more' : 'less'} contrast (×${g.contrast.toFixed(2)})`);
  if (Math.abs(g.saturation - 1) >= 0.03) out.push(g.saturation > 1 ? `saturation up ${Math.round((g.saturation - 1) * 100)}%` : `saturation down to ${Math.round(g.saturation * 100)}%`);
  if (Math.abs(g.hue) >= 2) out.push(`hues rotated ${g.hue > 0 ? '+' : ''}${Math.round(g.hue)}°`);
  if (Math.abs(g.temperature) >= 0.03) out.push(`${strength(g.temperature)} ${g.temperature > 0 ? 'warmer' : 'cooler'}`);
  if (Math.abs(g.tint) >= 0.03) out.push(`${strength(g.tint)} toward ${g.tint > 0 ? 'magenta' : 'green'}`);
  const zone = { lift: 'shadows', gamma: 'midtones', gain: 'highlights' };
  WHEELS.forEach(({ key }) => {
    const w = g[key];
    const mag = Math.min(1, Math.hypot(w.x, w.y));
    if (mag >= 0.05) out.push(`${zone[key]} ${strength(mag)} toward ${hueName((Math.atan2(w.y, w.x) * 180) / Math.PI)}`);
    if (Math.abs(w.m) >= 0.02) out.push(`${zone[key]} ${w.m > 0 ? 'brighter' : 'darker'}`);
  });
  return out;
};

export const isNeutral = (g) => describeGrade(g).length === 0;

// Where a region sits in the frame, in words (its centroid).
export const whereInFrame = (pts) => {
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const v = cy < 0.36 ? 'upper' : cy > 0.64 ? 'lower' : '';
  const h = cx < 0.36 ? 'left' : cx > 0.64 ? 'right' : '';
  return v || h ? `${[v, h].filter(Boolean).join(' ')} of the frame` : 'centre of the frame';
};

// Uniform values for one region, in the order the shader reads them.
export const gradeUniforms = (g) => ({
  p0: [g.exposure, g.contrast, g.saturation, (g.hue * Math.PI) / 180],
  p1: [g.temperature, g.tint, 0, 0],
  lift: wheelRgb(g.lift, WHEELS[0].reach).map((v) => v + g.lift.m),
  gamma: wheelRgb(g.gamma, WHEELS[1].reach).map((v) => 1 + v + g.gamma.m),
  gain: wheelRgb(g.gain, WHEELS[2].reach).map((v) => 1 + v + g.gain.m),
});

export const VERTEX_SHADER = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Regions grade in order, each blended in through its own feathered mask channel.
export const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform int uCount;
uniform vec4 uP0[${MAX_REGIONS}];
uniform vec4 uP1[${MAX_REGIONS}];
uniform vec3 uLift[${MAX_REGIONS}];
uniform vec3 uGamma[${MAX_REGIONS}];
uniform vec3 uGain[${MAX_REGIONS}];
uniform float uWipe;
uniform float uShowMask;
vec3 hueRotate(vec3 c, float a) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float ca = cos(a); float sa = sin(a);
  float i2 = i * ca - q * sa; float q2 = i * sa + q * ca;
  return vec3(y + 0.956 * i2 + 0.621 * q2, y - 0.272 * i2 - 0.647 * q2, y - 1.106 * i2 + 1.703 * q2);
}
vec3 grade(vec3 c, vec4 p0, vec4 p1, vec3 lift, vec3 gam, vec3 gain) {
  c *= exp2(p0.x);
  c *= vec3(1.0 + 0.15 * p1.x, 1.0 - 0.1 * p1.y, 1.0 - 0.15 * p1.x);
  c = gain * (c + lift * (1.0 - c));
  c = pow(max(c, 0.0), 1.0 / max(gam, vec3(0.05)));
  c = (c - 0.5) * p0.y + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, p0.z);
  c = hueRotate(c, p0.w);
  return clamp(c, 0.0, 1.0);
}
void main() {
  vec3 src = texture2D(uVideo, vUv).rgb;
  vec3 m = texture2D(uMask, vUv).rgb;
  vec3 c = src;
  for (int i = 0; i < ${MAX_REGIONS}; i++) {
    if (i >= uCount) break;
    float a = i == 0 ? m.r : (i == 1 ? m.g : m.b);
    if (a > 0.002) c = mix(c, grade(c, uP0[i], uP1[i], uLift[i], uGamma[i], uGain[i]), a);
  }
  if (uShowMask > 0.5) c = mix(c, vec3(1.0, 0.0, 0.66), 0.45 * max(m.r, max(m.g, m.b)));
  if (uWipe >= 0.0 && vUv.x > uWipe) c = src;
  gl_FragColor = vec4(c, 1.0);
}`;
