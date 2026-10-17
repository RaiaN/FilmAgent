// Drawing primitives for the README art: procedural film stills, identity plates,
// props, schematics and waveforms — all SVG strings, all seeded so every render is
// identical. One fictional film runs through every image: "The Lantern Keeper".

const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let uidN = 0;
const uid = (p) => `${p}${(uidN += 1)}`;

const MOODS = {
  night: { sky: ['#03050c', '#0b1630', '#1d2d58'], far: '#0e1834', mid: '#091127', near: '#04070f', ground: ['#070b16', '#0f1a33'], lights: ['#ff4fa3', '#4fd8ff', '#ffc857', '#8b7bff'] },
  rain: { sky: ['#141d22', '#2e3d44', '#5d7177'], far: '#34454b', mid: '#222f35', near: '#10171b', ground: ['#0d1316', '#26343a'], lights: ['#ffb35c', '#7fd3ff'] },
  dusk: { sky: ['#1a1233', '#5a2a55', '#e0744a', '#f7b267'], far: '#4a2a55', mid: '#2c1a3d', near: '#140c1e', ground: ['#140c1e', '#2c1a3d'], sun: '#ffd29a', lights: ['#ffd166', '#ff8a5b'] },
  dawn: { sky: ['#1d2a48', '#5d6f9b', '#f2c4a0'], far: '#5a6a91', mid: '#36415f', near: '#1b2236', ground: ['#1b2236', '#36415f'], sun: '#fff0d8', lights: ['#ffe2b0'] },
  warm: { sky: ['#1d120b', '#4a2d18', '#a8693a'], far: '#5a3820', mid: '#3a2414', near: '#1a0f08', ground: ['#1a0f08', '#3a2414'], lights: ['#ffcf7a', '#ff9f43'] },
  day: { sky: ['#5b8fd6', '#9cc3ef', '#e6f1fb'], far: '#8aa6c4', mid: '#5f7c99', near: '#34495e', ground: ['#4a5560', '#7d8893'], sun: '#ffffff', lights: [] },
};

// A person silhouette standing at (x, footY), height h.
export const person = (x, y, h, c = '#05070c', o = {}) => {
  const hw = h * 0.13; const head = h * 0.085;
  const lean = o.lean || 0;
  const torso = `M ${x - hw} ${y - h * 0.5} Q ${x - hw} ${y - h * 0.8} ${x + lean} ${y - h * 0.8} Q ${x + hw} ${y - h * 0.8} ${x + hw} ${y - h * 0.5} L ${x + hw * 0.8} ${y - h * 0.45} L ${x - hw * 0.8} ${y - h * 0.45} Z`;
  const legs = `M ${x - hw * 0.75} ${y - h * 0.47} L ${x - hw * 0.15 - (o.step || 0)} ${y} L ${x - hw * 0.55 - (o.step || 0)} ${y} L ${x - hw * 0.95} ${y - h * 0.4} Z M ${x + hw * 0.75} ${y - h * 0.47} L ${x + hw * 0.55 + (o.step || 0)} ${y} L ${x + hw * 0.15 + (o.step || 0)} ${y} L ${x + hw * 0.1} ${y - h * 0.45} Z`;
  const lamp = o.lantern ? `<circle cx="${x + hw * 1.6}" cy="${y - h * 0.5}" r="${h * 0.55}" fill="url(#${o.lantern})"/><circle cx="${x + hw * 1.6}" cy="${y - h * 0.5}" r="${h * 0.05}" fill="#fff3cf"/><rect x="${x + hw * 1.35}" y="${y - h * 0.56}" width="${hw * 0.5}" height="${h * 0.12}" rx="2" fill="#ffd27a"/>` : '';
  return `${lamp}<g fill="${c}"><circle cx="${x + lean}" cy="${y - h * 0.88}" r="${head}"/><path d="${torso}"/><path d="${legs}"/></g>`;
};

// A cinematic still. The world is drawn in a 1000×562 space; `cam` crops it, so the same
// seed seen through different cameras reads as coverage of one location.
export const still = (o = {}) => {
  const m = MOODS[o.mood || 'night'];
  const r = rng(o.seed || 7);
  const W = 1000; const H = 562; const hz = o.horizon || 330;
  const id = uid('s');
  const cam = o.cam || [0, 0, W, H];
  const sky = m.sky.map((c, i) => `<stop offset="${i / (m.sky.length - 1)}" stop-color="${c}"/>`).join('');
  let world = `<rect width="${W}" height="${H}" fill="url(#${id}sky)"/>`;
  const sunY = o.sunY || (o.kind === 'city' ? hz - 120 : hz - 30);
  if (m.sun && o.sun !== false) world += `<circle cx="${o.sunX || 700}" cy="${sunY}" r="220" fill="url(#${id}glow)"/><circle cx="${o.sunX || 700}" cy="${sunY}" r="30" fill="${m.sun}" opacity=".95"/>`;
  const ridge = (base, amp, col, n) => {
    let d = `M 0 ${H} L 0 ${base}`;
    const ph = [r() * 6, r() * 6, r() * 6];
    for (let x = 0; x <= W; x += 10) d += ` L ${x} ${base - amp * (0.55 * Math.sin(x / (n * 0.9) + ph[0]) + 0.3 * Math.sin(x / (n * 0.37) + ph[1]) + 0.15 * Math.sin(x / (n * 0.13) + ph[2]))}`;
    return `<path d="${d} L ${W} ${H} Z" fill="${col}"/>`;
  };
  const skyline = (base, col, minH, maxH, lit) => {
    let s = ''; let x = -10;
    while (x < W) {
      const w = 30 + r() * 70; const h = minH + r() * (maxH - minH);
      s += `<rect x="${x}" y="${base - h}" width="${w}" height="${h + 200}" fill="${col}"/>`;
      if (lit) for (let wy = base - h + 10; wy < base - 8; wy += 14) for (let wx = x + 6; wx < x + w - 8; wx += 12) if (r() < lit) s += `<rect x="${wx}" y="${wy}" width="5" height="7" fill="${m.lights[Math.floor(r() * m.lights.length)]}" opacity="${0.5 + r() * 0.5}"/>`;
      x += w + r() * 6;
    }
    return s;
  };
  const kind = o.kind || 'street';
  if (kind === 'land') {
    world += ridge(hz - 40, 60, m.far, 120) + ridge(hz + 20, 50, m.mid, 90) + ridge(hz + 90, 40, m.near, 70);
  } else if (kind === 'city') {
    world += skyline(hz, m.far, 40, 160, 0.05) + `<rect y="${hz - 60}" width="${W}" height="80" fill="url(#${id}haze)"/>` + skyline(hz + 60, m.mid, 60, 200, 0.035);
    world += `<rect y="${hz + 60}" width="${W}" height="${H}" fill="${m.near}"/>`;
    if (o.rooftop) world += `<path d="M 0 ${H} L 0 ${hz + 120} L ${W} ${hz + 150} L ${W} ${H} Z" fill="#06040a"/><rect x="80" y="${hz + 70}" width="6" height="60" fill="#06040a"/><rect x="60" y="${hz + 70}" width="46" height="5" fill="#06040a"/>`;
  } else if (kind === 'street') {
    const vx = o.vx || 520; const vy = hz;
    world += skyline(hz + 20, m.far, 80, 200, 0.03);
    world += `<ellipse cx="${vx}" cy="${vy}" rx="260" ry="120" fill="url(#${id}vglow)"/>`;
    world += `<path d="M 0 ${H} L ${vx - 40} ${vy} L ${vx + 40} ${vy} L ${W} ${H} Z" fill="url(#${id}road)"/>`;
    for (let i = 0; i < 9; i += 1) { const t1 = i / 9; const t2 = (i + 0.45) / 9; const y1 = vy + (H - vy) * t1 * t1; const y2 = vy + (H - vy) * t2 * t2; world += `<path d="M ${vx - 1 - 4 * t1} ${y1} L ${vx + 1 + 4 * t1} ${y1} L ${vx + 1 + 4 * t2} ${y2} L ${vx - 1 - 4 * t2} ${y2} Z" fill="#e8d9a8" opacity=".35"/>`; }
    const side = (dir) => {
      let s = ''; const xs = dir < 0 ? [0, vx - 60] : [W, vx + 60];
      for (let i = 0; i < 6; i += 1) {
        const t0 = i / 6; const t1 = (i + 0.8) / 6;
        const xa = xs[0] + (xs[1] - xs[0]) * t0; const xb = xs[0] + (xs[1] - xs[0]) * t1;
        const topA = vy - (vy - 20) * (1 - t0) * (0.7 + r() * 0.3); const topB = vy - (vy - 20) * (1 - t1) * 0.85;
        const botA = vy + (H - vy) * (1 - t0); const botB = vy + (H - vy) * (1 - t1);
        s += `<path d="M ${xa} ${topA} L ${xb} ${topB} L ${xb} ${botB} L ${xa} ${botA} Z" fill="${i % 2 ? m.mid : m.near}"/>`;
        if (m.lights.length) { const L = m.lights[Math.floor(r() * m.lights.length)]; const sy = topA + (botA - topA) * (0.25 + r() * 0.3); s += `<rect x="${Math.min(xa, xb) + Math.abs(xb - xa) * 0.25}" y="${sy}" width="${Math.abs(xb - xa) * 0.4}" height="${(botA - topA) * 0.06}" rx="2" fill="${L}" opacity=".85" filter="url(#${id}bloom)"/>`; }
      }
      return s;
    };
    world += side(-1) + side(1);
    if (m.lights.length && o.wet !== false) for (let i = 0; i < 9; i += 1) { const x = vx + (r() - 0.5) * 760; world += `<rect x="${x}" y="${hz + 40 + r() * 160}" width="${4 + r() * 8}" height="${60 + r() * 110}" fill="${m.lights[Math.floor(r() * m.lights.length)]}" opacity="${0.14 + r() * 0.16}" filter="url(#${id}soft)"/>`; }
  } else if (kind === 'interior') {
    world += `<rect width="${W}" height="${H}" fill="url(#${id}wall)"/>`;
    world += `<rect x="560" y="70" width="300" height="250" fill="#0b1630"/><rect x="560" y="70" width="300" height="250" fill="url(#${id}win)"/><path d="M 710 70 V 320 M 560 195 H 860" stroke="#1a0f08" stroke-width="10"/>`;
    for (let i = 0; i < 40; i += 1) { const wx = 570 + r() * 280; const wy = 80 + r() * 200; world += `<line x1="${wx}" y1="${wy}" x2="${wx - 2}" y2="${wy + 12 + r() * 20}" stroke="#9fc3ff" stroke-width="1.2" opacity=".3"/>`; }
    world += `<rect y="400" width="${W}" height="${H}" fill="${m.near}"/><rect x="90" y="330" width="420" height="22" fill="#2a170b"/><rect x="110" y="352" width="16" height="100" fill="#2a170b"/><rect x="474" y="352" width="16" height="100" fill="#2a170b"/>`;
    for (let i = 0; i < 6; i += 1) { const x = 80 + i * 70; world += `<rect x="${x}" y="${90 + (i % 2) * 30}" width="44" height="60" rx="6" fill="#3a2414"/><circle cx="${x + 22}" cy="${130 + (i % 2) * 30}" r="${10 + (i % 3) * 3}" fill="${m.lights[i % 2]}" opacity=".85" filter="url(#${id}bloom)"/>`; }
    world += `<circle cx="300" cy="300" r="190" fill="url(#${id}lamp)"/><path d="M 286 300 h 28 l 6 24 h -40 z" fill="#ffcf7a"/><circle cx="300" cy="312" r="10" fill="#fff3cf" filter="url(#${id}bloom)"/>`;
  }
  (o.figures || []).forEach((f) => { world += person(f.x * W, f.y * H, f.h * H, f.c || '#04060b', { lean: f.lean, step: f.step, lantern: f.lantern ? `${id}lamp` : null }); });
  if (o.rain) {
    const frozen = o.rain === 'frozen';
    for (let i = 0; i < (frozen ? 160 : 220); i += 1) {
      const x = r() * W; const y = r() * H;
      world += frozen
        ? `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 5 + r() * 5}" stroke="#e6f3ff" stroke-width="${1.6 + r()}" stroke-linecap="round" opacity="${0.45 + r() * 0.5}"/>`
        : `<line x1="${x}" y1="${y}" x2="${x - 4}" y2="${y + 18 + r() * 14}" stroke="#cfe6ff" stroke-width="1" opacity="${0.12 + r() * 0.25}"/>`;
    }
  }
  const defs = `<defs>
    <linearGradient id="${id}sky" x1="0" y1="0" x2="0" y2="1">${sky}</linearGradient>
    <radialGradient id="${id}glow"><stop offset="0" stop-color="${m.sun || '#fff'}" stop-opacity=".55"/><stop offset="1" stop-color="${m.sun || '#fff'}" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}road" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m.ground[1]}"/><stop offset="1" stop-color="${m.ground[0]}"/></linearGradient>
    <linearGradient id="${id}wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m.sky[0]}"/><stop offset="1" stop-color="${m.sky[1]}"/></linearGradient>
    <linearGradient id="${id}win" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1a3a"/><stop offset="1" stop-color="#29406e"/></linearGradient>
    <radialGradient id="${id}lamp"><stop offset="0" stop-color="#ffd27a" stop-opacity=".75"/><stop offset=".35" stop-color="#ff9f43" stop-opacity=".22"/><stop offset="1" stop-color="#ff9f43" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m.sky[m.sky.length - 1]}" stop-opacity="0"/><stop offset=".6" stop-color="${m.sky[m.sky.length - 1]}" stop-opacity=".55"/><stop offset="1" stop-color="${m.sky[m.sky.length - 1]}" stop-opacity="0"/></linearGradient>
    <radialGradient id="${id}vglow"><stop offset="0" stop-color="${(m.lights[0] || '#fff')}" stop-opacity=".35"/><stop offset="1" stop-color="${(m.lights[0] || '#fff')}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}vig" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".65"/></radialGradient>
    <filter id="${id}bloom" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="${id}soft"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="${id}grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${o.seed || 7}"/><feColorMatrix values="0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .5 0"/></filter>
    <clipPath id="${id}clip"><rect x="${cam[0]}" y="${cam[1]}" width="${cam[2]}" height="${cam[3]}"/></clipPath>
  </defs>`;
  const over = `<rect x="${cam[0]}" y="${cam[1]}" width="${cam[2]}" height="${cam[3]}" fill="url(#${id}vig)"/><rect x="${cam[0]}" y="${cam[1]}" width="${cam[2]}" height="${cam[3]}" filter="url(#${id}grain)" opacity=".14"/>`;
  const filt = o.grade ? ` style="filter:${o.grade}"` : '';
  return `<svg viewBox="${cam.join(' ')}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"${filt}>${defs}<g clip-path="url(#${id}clip)">${world}${over}</g></svg>`;
};

// THE CAST — stylized, faceless identity mannequins (they read as design, never as a person).
export const CAST = {
  mara: { name: 'Mara', skin: '#c98e6b', hair: '#2b1a14', style: 'bob', top: '#c8553d', bottom: '#2f3441', bg: ['#e9e6e2', '#c9c4bf'] },
  keeper: { name: 'The Keeper', skin: '#e3bf9f', hair: '#ececec', style: 'long', top: '#d4a537', bottom: '#8a6a1f', bg: ['#e6e2dc', '#c6c0b6'] },
  theo: { name: 'Theo', skin: '#8a5a3c', hair: '#141414', style: 'short', top: '#3a6b8c', bottom: '#d9c7a7', bg: ['#e2e6e9', '#bfc6cb'] },
};

const hairPath = (style, cx, cy, rx, ry) => {
  if (style === 'bob') return `M ${cx - rx * 1.15} ${cy + ry * 0.55} Q ${cx - rx * 1.25} ${cy - ry * 1.25} ${cx} ${cy - ry * 1.15} Q ${cx + rx * 1.25} ${cy - ry * 1.25} ${cx + rx * 1.15} ${cy + ry * 0.55} L ${cx + rx * 0.85} ${cy + ry * 0.5} Q ${cx + rx * 0.9} ${cy - ry * 0.5} ${cx} ${cy - ry * 0.62} Q ${cx - rx * 0.9} ${cy - ry * 0.5} ${cx - rx * 0.85} ${cy + ry * 0.5} Z`;
  if (style === 'long') return `M ${cx - rx * 1.1} ${cy + ry * 1.6} Q ${cx - rx * 1.3} ${cy - ry * 1.3} ${cx} ${cy - ry * 1.12} Q ${cx + rx * 1.3} ${cy - ry * 1.3} ${cx + rx * 1.1} ${cy + ry * 1.6} L ${cx + rx * 0.8} ${cy + ry * 1.2} Q ${cx + rx * 0.95} ${cy - ry * 0.5} ${cx} ${cy - ry * 0.6} Q ${cx - rx * 0.95} ${cy - ry * 0.5} ${cx - rx * 0.8} ${cy + ry * 1.2} Z`;
  return `M ${cx - rx * 1.02} ${cy - ry * 0.15} Q ${cx - rx * 1.05} ${cy - ry * 1.2} ${cx} ${cy - ry * 1.1} Q ${cx + rx * 1.05} ${cy - ry * 1.2} ${cx + rx * 1.02} ${cy - ry * 0.15} Q ${cx} ${cy - ry * 0.75} ${cx - rx * 1.02} ${cy - ry * 0.15} Z`;
};

// Identity plate: frontal bust on a studio backdrop (the Cast & World FACE plate).
export const plate = (c, o = {}) => {
  const id = uid('p'); const top = o.top || c.top; const hair = o.hair || c.hair; const bg = o.bg || c.bg;
  const acc = o.accessory ? `<rect x="66" y="68" width="68" height="9" rx="4" fill="${o.accessory}" opacity=".9"/>` : '';
  return `<svg viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="${id}bg" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient><linearGradient id="${id}sh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient></defs>
    <rect width="200" height="250" fill="url(#${id}bg)"/>
    <path d="M 18 250 Q 22 176 100 168 Q 178 176 182 250 Z" fill="${top}"/><path d="M 18 250 Q 22 176 100 168 Q 178 176 182 250 Z" fill="url(#${id}sh)"/>
    <path d="M 84 150 h 32 v 26 q -16 10 -32 0 Z" fill="${c.skin}"/><path d="M 84 160 h 32 v 8 q -16 6 -32 0 Z" fill="#000" opacity=".12"/>
    <ellipse cx="100" cy="108" rx="36" ry="46" fill="${c.skin}"/><ellipse cx="100" cy="108" rx="36" ry="46" fill="url(#${id}sh)"/>
    <path d="${hairPath(o.style || c.style, 100, 108, 36, 46)}" fill="${hair}"/>${acc}</svg>`;
};

// Turnaround: front · three-quarter · side · back, full body (the Cast & World BODY plate).
export const turnaround = (c, o = {}) => {
  const id = uid('t'); const bg = c.bg;
  const fig = (x, view) => {
    const w = view === 'side' ? 0.55 : view === 'tq' ? 0.8 : 1;
    const torso = `M ${x - 15 * w} 128 Q ${x - 16 * w} 84 ${x} 82 Q ${x + 16 * w} 84 ${x + 15 * w} 128 Z`;
    const legs = `<rect x="${x - 11 * w}" y="126" width="${9 * w}" height="62" rx="3" fill="${c.bottom}"/><rect x="${x + 2 * w}" y="126" width="${9 * w}" height="62" rx="3" fill="${c.bottom}"/>`;
    const arms = view === 'side' ? `<rect x="${x - 4}" y="88" width="8" height="40" rx="4" fill="${c.top}" opacity=".85"/>` : `<rect x="${x - 21 * w}" y="88" width="7" height="40" rx="3.5" fill="${c.top}"/><rect x="${x + 14 * w}" y="88" width="7" height="40" rx="3.5" fill="${c.top}"/>`;
    const head = `<ellipse cx="${x}" cy="66" rx="${13 * (view === 'side' ? 0.85 : 1)}" ry="16" fill="${c.skin}"/>`;
    const hair = view === 'back' ? `<ellipse cx="${x}" cy="64" rx="14" ry="17" fill="${c.hair}"/>` : `<path d="${hairPath(c.style, x + (view === 'side' ? -3 : 0), 66, 13 * (view === 'side' ? 0.85 : 1), 16)}" fill="${c.hair}"/>`;
    return `<ellipse cx="${x}" cy="190" rx="22" ry="4" fill="#000" opacity=".12"/>${legs}<path d="${torso}" fill="${c.top}"/>${arms}${head}${hair}`;
  };
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="${id}bg" cx=".5" cy=".4" r=".9"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient></defs><rect width="320" height="200" fill="url(#${id}bg)"/>${fig(50, 'front')}${fig(125, 'tq')}${fig(200, 'side')}${fig(272, 'back')}</svg>`;
};

// Props on a studio sweep.
export const prop = (kind) => {
  const id = uid('pr');
  const bg = `<defs><radialGradient id="${id}bg" cx=".5" cy=".4" r=".9"><stop offset="0" stop-color="#ece8e2"/><stop offset="1" stop-color="#c7c1b8"/></radialGradient><radialGradient id="${id}glow"><stop offset="0" stop-color="#ffd27a" stop-opacity=".9"/><stop offset="1" stop-color="#ff9f43" stop-opacity="0"/></radialGradient></defs><rect width="200" height="200" fill="url(#${id}bg)"/><ellipse cx="100" cy="168" rx="56" ry="8" fill="#000" opacity=".15"/>`;
  if (kind === 'lantern') return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${bg}<circle cx="100" cy="112" r="60" fill="url(#${id}glow)"/><path d="M 88 40 Q 100 22 112 40" fill="none" stroke="#5a4320" stroke-width="5"/><rect x="80" y="40" width="40" height="12" rx="3" fill="#8a6a2a"/><path d="M 76 52 h 48 l -6 100 h -36 z" fill="#ffdf9a" opacity=".85"/><path d="M 76 52 h 48 l -6 100 h -36 z" fill="none" stroke="#7a5a22" stroke-width="4"/><path d="M 100 52 v 100" stroke="#7a5a22" stroke-width="3"/><circle cx="100" cy="104" r="12" fill="#fff6d6"/><rect x="78" y="150" width="44" height="14" rx="3" fill="#8a6a2a"/></svg>`;
  if (kind === 'key') return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${bg}<g transform="rotate(-28 100 100)"><circle cx="64" cy="100" r="26" fill="none" stroke="#b8862e" stroke-width="12"/><rect x="88" y="94" width="86" height="12" rx="4" fill="#b8862e"/><rect x="150" y="104" width="10" height="20" fill="#b8862e"/><rect x="134" y="104" width="10" height="14" fill="#b8862e"/></g></svg>`;
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${bg}<g transform="rotate(-8 100 110)"><rect x="40" y="70" width="120" height="80" rx="4" fill="#f4ecdc" stroke="#cbbd9f"/><path d="M 40 72 L 100 118 L 160 72" fill="none" stroke="#cbbd9f" stroke-width="3"/><circle cx="100" cy="118" r="10" fill="#a33b2a"/></g></svg>`;
};

// Top-down blocking schematic: floor, marks, movement paths and camera cones.
export const schematic = (o = {}) => {
  const id = uid('sc');
  let g = '';
  for (let x = 0; x <= 400; x += 20) g += `<line x1="${x}" y1="0" x2="${x}" y2="260" stroke="#2a3348" stroke-width="${x % 100 ? 0.5 : 1}"/>`;
  for (let y = 0; y <= 260; y += 20) g += `<line x1="0" y1="${y}" x2="400" y2="${y}" stroke="#2a3348" stroke-width="${y % 100 ? 0.5 : 1}"/>`;
  const cam = (x, y, a, n, col) => `<g transform="translate(${x} ${y}) rotate(${a})"><path d="M 0 0 L 70 -30 L 70 30 Z" fill="${col}" opacity=".14"/><rect x="-12" y="-8" width="18" height="16" rx="3" fill="${col}"/><text x="-3" y="4" font-size="9" font-weight="700" text-anchor="middle" fill="#0b0d12" transform="rotate(${-a} -3 0)">${n}</text></g>`;
  const mark = (x, y, t, col) => `<circle cx="${x}" cy="${y}" r="13" fill="${col}"/><text x="${x}" y="${y + 4}" font-size="11" font-weight="700" text-anchor="middle" fill="#0b0d12">${t}</text>`;
  return `<svg viewBox="0 0 400 260" xmlns="http://www.w3.org/2000/svg"><defs><marker id="${id}a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#ffc857"/></marker><marker id="${id}b" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#4fd8ff"/></marker></defs>
    <rect width="400" height="260" fill="#0f1422"/>${g}
    <rect x="250" y="30" width="110" height="40" rx="4" fill="#1d2840" stroke="#3a4a6e"/><text x="305" y="55" font-size="11" fill="#8fa3c9" text-anchor="middle">SHOP WINDOW</text>
    <line x1="40" y1="${o.axisY || 150}" x2="380" y2="${o.axisY || 150}" stroke="#ff4fa3" stroke-width="1.5" stroke-dasharray="6 5" opacity=".8"/>
    <path d="M 60 200 C 140 200 200 150 280 110" fill="none" stroke="#ffc857" stroke-width="3" stroke-dasharray="1 0" marker-end="url(#${id}a)"/>
    <path d="M 340 210 C 330 170 320 140 310 120" fill="none" stroke="#4fd8ff" stroke-width="3" marker-end="url(#${id}b)"/>
    ${mark(60, 200, 'M', '#ffc857')}${mark(300, 100, 'L', '#ffc857')}${mark(340, 214, 'K', '#4fd8ff')}
    ${cam(120, 245, -70, 'A', '#e9eef7')}${cam(380, 90, 160, 'B', '#e9eef7')}${cam(30, 60, 25, 'C', '#e9eef7')}</svg>`;
};

// Blockout animatic frame: flat-shaded floor in perspective, actors as solid blocks.
export const blockout = (t = 0) => {
  const id = uid('bo');
  const ax = 260 + t * 300; const az = 0.85 - t * 0.3;
  const block = (x, z, col, h) => { const s = (0.6 + z * 0.9) * 1.9; const y = 160 + z * 150; return `<ellipse cx="${x}" cy="${y}" rx="${20 * s}" ry="${5 * s}" fill="#000" opacity=".25"/><rect x="${x - 14 * s}" y="${y - 90 * s * h}" width="${28 * s}" height="${90 * s * h}" rx="${8 * s}" fill="${col}"/><rect x="${x - 14 * s}" y="${y - 90 * s * h}" width="${10 * s}" height="${90 * s * h}" rx="${6 * s}" fill="#fff" opacity=".18"/>`; };
  let floor = '';
  for (let i = -8; i <= 8; i += 1) floor += `<line x1="${500 + i * 30}" y1="150" x2="${500 + i * 160}" y2="562" stroke="#c9ced8" stroke-width="1"/>`;
  for (let j = 0; j < 8; j += 1) { const y = 150 + (412 * (j / 8) ** 1.6); floor += `<line x1="0" y1="${y}" x2="1000" y2="${y}" stroke="#c9ced8" stroke-width="1"/>`; }
  return `<svg viewBox="0 0 1000 562" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9dde4"/><stop offset="1" stop-color="#eef0f3"/></linearGradient></defs><rect width="1000" height="150" fill="#b9c0cb"/><rect y="150" width="1000" height="412" fill="url(#${id}f)"/>${floor}<rect x="600" y="40" width="300" height="140" fill="#9aa4b3"/><rect x="620" y="60" width="260" height="100" fill="#7e8aa0"/>${block(720, 0.4, '#4fa3d8', 1)}${block(ax, az, '#e8a33d', 1.05)}</svg>`;
};

export const wave = (n = 90, seed = 3, col = '#a78bfa') => {
  const r = rng(seed); let s = '';
  for (let i = 0; i < n; i += 1) { const env = Math.sin((i / n) * Math.PI) ** 0.6; const h = 4 + env * (10 + r() * 46) * (0.5 + 0.5 * Math.sin(i / 3.1)); s += `<rect x="${i * 6}" y="${32 - h / 2}" width="3.4" height="${h}" rx="1.7" fill="${col}"/>`; }
  return `<svg viewBox="0 0 ${n * 6} 64" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">${s}</svg>`;
};
