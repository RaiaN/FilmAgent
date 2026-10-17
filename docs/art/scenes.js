// Every README image, composed from draw.js. One fictional film throughout:
// THE LANTERN KEEPER — a night courier finds a lantern that can stop the rain.
import { still, plate, turnaround, prop, schematic, blockout, wave, CAST } from './draw.js';

// ---- the film's recurring frames ------------------------------------------------
const F = {
  alley: (o = {}) => still({ mood: 'night', kind: 'street', seed: 11, rain: true, figures: [{ x: 0.5, y: 0.86, h: 0.34, lantern: true, step: 3 }], ...o }),
  alleyWide: (o = {}) => still({ mood: 'night', kind: 'street', seed: 11, rain: true, figures: [{ x: 0.5, y: 0.7, h: 0.16, lantern: true }], ...o }),
  shop: (o = {}) => still({ mood: 'warm', kind: 'interior', seed: 4, figures: [{ x: 0.74, y: 0.95, h: 0.62, c: '#120a05' }], ...o }),
  roof: (o = {}) => still({ mood: 'dusk', kind: 'city', seed: 21, rooftop: true, figures: [{ x: 0.3, y: 0.85, h: 0.3, lantern: true }], ...o }),
  frozen: (o = {}) => still({ mood: 'night', kind: 'street', seed: 33, rain: 'frozen', figures: [{ x: 0.42, y: 0.9, h: 0.5, lantern: true }], ...o }),
  dawn: (o = {}) => still({ mood: 'dawn', kind: 'land', seed: 5, figures: [{ x: 0.62, y: 0.84, h: 0.18 }, { x: 0.67, y: 0.85, h: 0.2 }], ...o }),
};
const frame = (svg, o = {}) => `<div class="frame" style="width:${o.w || 200}px;height:${o.h || Math.round((o.w || 200) * 0.5625)}px;${o.style || ''}">${svg}${o.tag ? `<span class="tag">${o.tag}</span>` : ''}${o.tr ? `<span class="tr">${o.tr}</span>` : ''}${o.play ? '<span class="play"></span>' : ''}</div>`;
const head = (acc, cat, title, sub) => `<div class="head" style="--acc:${acc}"><div class="cat"><i></i>${cat}</div><div class="title">${title}</div><div class="sub">${sub}</div></div>`;
const avatar = (c) => `<span class="av">${plate(c)}</span>`;
const arrow = (acc) => `<div class="arrow" style="--acc:${acc}"></div>`;

const ACC = {
  story: '#7c8cff', cast: '#e0915a', charvar: '#4f7dff', locvar: '#3fbf6f', mood: '#ff8a3d', board: '#a7b0c2',
  scout: '#2fb8a6', previz: '#4fa3ff', shot: '#ff4f7b', edit: '#2fbf71', audio: '#a274ff', cut: '#ffc23d',
};

export const SCENES = {
  hero: { size: 'hero', html: () => `
    <div style="position:absolute;inset:0;background:radial-gradient(900px 500px at 78% 40%, #1d2a55aa, transparent 70%), radial-gradient(600px 400px at 20% 90%, #4a1d3a66, transparent 70%)"></div>
    <div style="position:absolute;left:64px;top:150px;z-index:3;width:470px">
      <div class="cat" style="--acc:${ACC.cut}"><i></i>AI film studio</div>
      <div style="font-size:76px;font-weight:800;letter-spacing:-.035em;margin-top:18px;line-height:1">FilmAgent</div>
      <div style="font-size:30px;font-weight:600;margin-top:18px;letter-spacing:-.01em">Idea in. Film out.</div>
      <div class="row" style="margin-top:34px;flex-wrap:wrap;gap:8px">
        <span class="chip">Seed 2.1</span><span class="chip">Seedream 5.0</span><span class="chip">Seedance 2.5</span><span class="chip">Seed Audio</span>
      </div>
    </div>
    <div style="position:absolute;left:500px;top:-10px;width:900px;height:700px;perspective:1600px;z-index:2;transform:scale(.86);transform-origin:0 0">
      <div style="position:absolute;inset:0;transform:rotateX(24deg) rotateZ(-10deg) translate(20px,30px);transform-origin:50% 50%">
        <div style="position:absolute;left:30px;top:90px;width:210px" class="note">A night courier finds a lantern that can stop the rain.</div>
        <div class="card" style="position:absolute;left:270px;top:60px;width:300px"><div class="hd" style="--acc:${ACC.cast}">Cast &amp; World</div>
          <div class="row" style="padding:10px;gap:8px">${['mara', 'keeper', 'theo'].map((k) => `<div class="frame" style="width:88px;height:110px">${plate(CAST[k])}</div>`).join('')}</div></div>
        <div class="card" style="position:absolute;left:600px;top:40px;width:260px"><div class="hd">Storyboard</div>
          <div class="col" style="padding:10px;gap:8px">${[F.alleyWide(), F.shop(), F.frozen()].map((s, i) => `<div class="row" style="gap:8px"><span class="mono dim" style="font-size:11px">#0${i + 1}</span><div style="flex:1;height:8px;border-radius:4px;background:#232a39"></div>${frame(s, { w: 96 })}</div>`).join('')}</div></div>
        <div class="shot" style="position:absolute;left:150px;top:300px;width:470px"><div class="stripe"></div>
          <div class="bar"><span class="no">SHOT 3</span><span class="pill">⏱ 15s</span><span class="pill">Draft 480p</span><span class="go">Shoot</span></div>
          <div class="row" style="padding:0 14px 14px;gap:8px">${[F.frozen(), F.frozen({ seed: 34 }), F.alley()].map((s, i) => frame(s, { w: 140, play: i === 0, tag: `Take ${i + 1}${i === 0 ? ' ★' : ''}` })).join('')}</div></div>
        <div class="card" style="position:absolute;left:30px;top:540px;width:820px"><div class="hd">Timeline <span style="margin-left:auto;color:var(--amber)">Render movie · 10-bit MOV</span></div>
          <div class="row" style="padding:10px;gap:6px">${[F.alleyWide(), F.alley(), F.shop(), F.frozen(), F.roof(), F.dawn()].map((s) => frame(s, { w: 128, h: 64 })).join('')}</div></div>
      </div>
    </div>` },

  'cast-world': { size: 'agent', html: () => `${head(ACC.cast, 'Pre-production', 'Cast &amp; World', 'Every character, place and prop gets an identity plate.')}
    <div class="body">
      <div class="note" style="width:250px;font-size:14px">MARA — night courier, rust jacket<br>THE KEEPER — old, gold robe<br>THEO — her friend<br>Rain alley · Lantern shop · Rooftop<br>Lantern · Brass key</div>
      ${arrow(ACC.cast)}
      <div class="col" style="gap:12px;flex:1">
        <div class="row" style="gap:12px">${['mara', 'keeper', 'theo'].map((k) => `<div class="col" style="gap:6px"><div class="row" style="gap:6px"><div class="frame" style="width:86px;height:108px">${plate(CAST[k])}</div><div class="frame" style="width:172px;height:108px">${turnaround(CAST[k])}</div></div><span class="chip acc" style="--acc:${ACC.cast};align-self:flex-start">${avatar(CAST[k])}${CAST[k].name} · face + body</span></div>`).join('')}</div>
        <div class="row" style="gap:12px">
          ${frame(F.alleyWide({ figures: [] }), { w: 196, tag: 'Rain alley' })}${frame(F.shop({ figures: [] }), { w: 196, tag: 'Lantern shop' })}${frame(F.roof({ figures: [] }), { w: 196, tag: 'Rooftop' })}
          <div class="frame" style="width:110px;height:110px">${prop('lantern')}<span class="tag">Lantern</span></div><div class="frame" style="width:110px;height:110px">${prop('key')}<span class="tag">Brass key</span></div>
        </div>
      </div>
    </div>` },
  pipeline: { size: 'wide', html: () => {
    const st = (acc, name, model, art) => `<div class="col" style="--acc:${acc};gap:8px;align-items:center;width:128px"><div class="frame" style="width:128px;height:84px;border:1px solid #2a3142;background:#11141b">${art}</div><div style="font-size:14.5px;font-weight:650;text-align:center">${name}</div><div class="mono" style="font-size:10.5px;color:var(--acc)">${model}</div></div>`;
    const ar = '<div style="flex:none;color:#3b4458;font-size:20px;margin-top:-56px">→</div>';
    const band = (t, n, acc) => `<div style="flex:${n};border-top:2px solid ${acc};padding-top:8px" class="label">${t}</div>`;
    return `<div class="head" style="--acc:${ACC.cut};top:40px"><div class="cat"><i></i>How it works</div><div class="title" style="font-size:34px">One canvas, idea to final cut</div></div>
    <div style="position:absolute;left:56px;right:56px;top:170px;display:flex;gap:14px">${band('Development', 2.05, ACC.story)}${band('Pre-production', 3.1, ACC.cast)}${band('Production', 2.05, ACC.shot)}${band('Post', 1, ACC.cut)}</div>
    <div style="position:absolute;left:56px;right:56px;top:215px;display:flex;align-items:center;justify-content:space-between">
      ${st(ACC.story, 'Idea', 'your words', '<div class="note" style="transform:none;font-size:10px;padding:8px;margin:8px;box-shadow:none">A courier finds a lantern that stops the rain.</div>')}${ar}
      ${st(ACC.story, 'Story Room', 'Seed 2.1', '<div style="padding:12px" class="col">' + ['90%', '70%', '84%', '55%'].map((w) => `<div style="height:7px;width:${w};border-radius:4px;background:#2b3450"></div>`).join('') + '</div>')}${ar}
      ${st(ACC.cast, 'Cast &amp; World', 'Seedream 5.0', `<div class="row" style="gap:4px;padding:8px;height:100%">${['mara', 'keeper', 'theo'].map((k) => `<div class="frame" style="width:36px;height:46px">${plate(CAST[k])}</div>`).join('')}</div>`)}${ar}
      ${st(ACC.board, 'Storyboard', 'Seedream 5.0', F.alleyWide())}${ar}
      ${st(ACC.previz, 'Previz', 'Seedance 2.5 draft', blockout(0.4))}${ar}
      ${st(ACC.shot, 'Shot', 'Seedance 2.5', F.frozen() + '<span class="play" style="transform:scale(.7)"></span>')}${ar}
      ${st(ACC.edit, 'Edit', 'Seedance 2.5', F.roof())}${ar}
      ${st(ACC.cut, 'Final cut', '10-bit MOV', `<div class="col" style="gap:5px;padding:12px 8px"><div class="row" style="gap:3px">${['#4f7dff', '#ff4f7b', '#e0915a', '#2fbf71'].map((c) => `<div style="height:16px;flex:1;border-radius:3px;background:${c}"></div>`).join('')}</div><div style="height:18px">${wave(36, 9, '#a274ff')}</div></div>`)}
    </div>`;
  } },

  'story-room': { size: 'agent', html: () => `${head(ACC.story, 'Development', 'Story Room', 'One line becomes a story, a beat sheet and a shot list.')}
    <div class="body">
      <div class="note" style="width:200px">A night courier finds a lantern that can stop the rain.</div>
      ${arrow(ACC.story)}
      <div class="card" style="width:330px"><div class="hd">Story</div><div class="col" style="padding:14px;gap:12px">
        <div><div class="label">Spine</div><div style="font-size:14px;margin-top:6px;line-height:1.45">Mara must choose: keep the rain stopped and lose her way home, or let it fall.</div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${[['Want', 'Deliver the lantern'], ['Need', 'Ask for help'], ['Crisis', 'Time won’t restart'], ['Climax', 'She lets it rain']].map(([k, v]) => `<div style="background:#0b0d12;border:1px solid var(--line);border-radius:8px;padding:9px"><div class="label" style="color:${ACC.story}">${k}</div><div style="font-size:12.5px;margin-top:5px">${v}</div></div>`).join('')}</div>
        <div><div class="label">Beat sheet</div><div class="row" style="gap:5px;margin-top:7px">${['I', 'I', 'II', 'II', 'II', 'III', 'III'].map((a, i) => `<div style="flex:1;height:28px;border-radius:5px;display:grid;place-items:center;font:700 10px/1 var(--mono);color:#fff;background:${a === 'I' ? '#3a4bd1' : a === 'II' ? '#d1693a' : '#3aa36b'};opacity:${0.6 + (i % 3) * 0.15}">${a}</div>`).join('')}</div></div>
      </div></div>
      ${arrow(ACC.story)}
      <div class="card" style="flex:1"><div class="hd">Scene 1 <span class="dim" style="margin-left:auto;letter-spacing:0;text-transform:none;font-family:var(--sans)">3 shots · one 24 s generation</span></div><div class="col" style="padding:12px;gap:10px">
        ${[[F.alleyWide(), 'Wide — Mara cycles through the rain-soaked alley.', '8s'], [F.alley(), 'Medium — she stops; the lantern flickers.', '7s'], [F.frozen(), 'Close — she lifts it. The rain freezes mid-air.', '9s']].map(([s, t, d], i) => `<div class="row" style="gap:12px">${frame(s, { w: 112 })}<span class="mono" style="font-size:11px;color:${ACC.story}">SH 0${i + 1}</span><span style="font-size:13.5px;flex:1">${t}</span><span class="mono dim" style="font-size:11px">${d}</span></div>`).join('')}
      </div></div>
    </div>` },

  'character-variations': { size: 'agent', html: () => {
    const v = [['Rain gear', { top: '#2f5d50', bg: ['#cfd8d6', '#9fb0ad'] }], ['Festival', { top: '#7b4bd6', accessory: '#ffd166', bg: ['#e7defa', '#c2b2ea'] }], ['Winter', { top: '#e8e4dc', bg: ['#dfe6ee', '#b3c0cf'] }], ['Undercover', { top: '#1f2430', hair: '#5a3a22', bg: ['#d8d2c8', '#a9a196'] }]];
    return `${head(ACC.charvar, 'Pre-production', 'Character Variations', 'New looks for a character. Same face, every time.')}
    <div class="body" style="justify-content:center">
      <div class="col" style="gap:8px;align-items:center"><div class="frame" style="width:190px;height:238px;outline:2px solid ${ACC.charvar};outline-offset:3px">${plate(CAST.mara)}</div><span class="chip acc" style="--acc:${ACC.charvar}">Mara · source plate</span></div>
      ${arrow(ACC.charvar)}
      <div class="col" style="gap:12px">
        <div class="row" style="gap:12px">${v.map(([n, o]) => `<div class="col" style="gap:6px;align-items:center"><div class="frame" style="width:150px;height:188px">${plate(CAST.mara, o)}</div><span class="dim" style="font-size:13px">${n}</span></div>`).join('')}</div>
        <div class="row" style="justify-content:center"><span class="chip">🔒 identity locked — every variation is an edit of the source</span></div>
      </div>
    </div>`;
  } },

  'location-variations': { size: 'agent', html: () => {
    const base = { mood: 'night', kind: 'street', seed: 11, rain: true, figures: [] };
    const tiles = [['Reverse', `<div style="transform:scaleX(-1);height:100%">${still({ ...base, cam: [100, 40, 800, 450] })}</div>`], ['Detail', still({ ...base, cam: [360, 230, 360, 202] })], ['Low angle', still({ ...base, horizon: 420, cam: [80, 0, 840, 472] })], ['Dawn', still({ ...base, mood: 'dawn', rain: false })], ['Dusk', still({ ...base, mood: 'dusk', rain: false })], ['Storm', still({ ...base, mood: 'rain' })]];
    return `${head(ACC.locvar, 'Pre-production', 'Location Variations &amp; Coverage', 'One place, every angle and hour you need.')}
    <div class="body" style="justify-content:center">
      <div class="col" style="gap:8px;align-items:center">${frame(still({ ...base }), { w: 300, style: `outline:2px solid ${ACC.locvar};outline-offset:3px` })}<span class="chip acc" style="--acc:${ACC.locvar}">Rain alley · location plate</span></div>
      ${arrow(ACC.locvar)}
      <div style="display:grid;grid-template-columns:repeat(3,210px);gap:12px">${tiles.map(([n, s]) => frame(s, { w: 210, tag: n })).join('')}</div>
    </div>`;
  } },

  'mood-board': { size: 'agent', html: () => {
    const m = [F.roof(), F.shop({ figures: [] }), F.frozen(), F.alleyWide(), F.dawn(), still({ mood: 'warm', kind: 'street', seed: 8, rain: true }), still({ mood: 'dusk', kind: 'land', seed: 9 }), still({ mood: 'warm', kind: 'land', seed: 12 })];
    const sw = ['#0b1630', '#1d2d58', '#ff4fa3', '#4fd8ff', '#ffc857', '#e0744a', '#2c1a3d'];
    return `${head(ACC.mood, 'Development', 'Mood Board', 'Find the look before you shoot a frame.')}
    <div class="body">
      <div class="col" style="gap:12px;width:250px"><div class="label">Prompt</div><div class="card" style="padding:14px;font-size:15px;line-height:1.5">rain-soaked neon noir, warm lantern light, wet reflections, quiet city</div>
        <div class="label" style="margin-top:6px">Palette</div><div class="row" style="gap:0;border-radius:8px;overflow:hidden;height:34px">${sw.map((c) => `<div style="flex:1;height:100%;background:${c}"></div>`).join('')}</div></div>
      ${arrow(ACC.mood)}
      <div style="columns:4;column-gap:10px;flex:1">${m.map((s, i) => frame(s, { w: 192, h: [150, 108, 128, 108, 150, 128, 108, 150][i], style: 'width:100%;margin-bottom:10px;break-inside:avoid' })).join('')}</div>
    </div>`;
  } },

  storyboard: { size: 'agent', html: () => {
    const rows = [[F.alleyWide(), 'Rain alley · EXT', 'Mara rides through the rain, lantern on her handlebars.'], [F.shop(), 'Lantern shop · INT', 'The Keeper watches her from behind the counter.'], [F.alley(), 'Rain alley · EXT', 'She stops. The lantern flickers.'], [F.frozen(), 'Rain alley · EXT', 'She lifts it — every raindrop freezes.']];
    return `${head(ACC.board, 'Pre-production', 'Storyboard', 'Script in. One row per shot, with its opening frame.')}
    <div class="body">
      <div class="note" style="width:230px;font-size:14px">EXT. RAIN ALLEY — NIGHT<br><br>Mara rides through the downpour. She brakes hard. The lantern in her basket flickers…</div>
      ${arrow(ACC.board)}
      <div class="card" style="flex:1"><div class="hd"><b>Storyboard strip</b>&nbsp; 4 shots <span style="margin-left:auto;background:#b07a2a;color:#fff;border-radius:5px;padding:5px 9px;letter-spacing:0;text-transform:none;font-family:var(--sans)">Film →</span></div>
        <div class="col" style="gap:0">${rows.map(([s, slug, t], i) => `<div class="row" style="gap:14px;padding:9px 14px;border-top:${i ? '1px solid var(--line)' : 'none'}"><span class="mono" style="font-size:12px;color:var(--dim)">#0${i + 1}</span><div style="flex:1"><div style="font-size:13px;font-weight:650">${slug}</div><div class="dim" style="font-size:13px;margin-top:3px">${t}</div></div>${frame(s, { w: 176, tag: 'START' })}</div>`).join('')}</div></div>
    </div>`;
  } },

  'tech-scout': { size: 'agent', html: () => {
    const base = { mood: 'night', kind: 'street', seed: 11, rain: true, figures: [] };
    const cams = [[0, 0, 1000, 562], [500, 200, 500, 281], [0, 200, 500, 281], [250, 120, 500, 281], [380, 260, 300, 169], [100, 60, 700, 394]];
    const orbit = `<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="70" fill="none" stroke="#2fb8a6" stroke-dasharray="4 5" opacity=".7"/><rect x="72" y="72" width="56" height="56" rx="6" fill="#16303a" stroke="#2fb8a6"/>${[0, 60, 120, 180, 240, 300].map((a, i) => { const x = 100 + 70 * Math.cos((a * Math.PI) / 180); const y = 100 + 70 * Math.sin((a * Math.PI) / 180); return `<g transform="translate(${x} ${y}) rotate(${a + 180})"><path d="M0 0 L22 -10 L22 10 Z" fill="#2fb8a6" opacity=".25"/><circle r="8" fill="#2fb8a6"/></g><text x="${x}" y="${y + 3.5}" font-size="9" font-weight="700" text-anchor="middle" fill="#0b0d12">${i + 1}</text>`; }).join('')}</svg>`;
    return `${head(ACC.scout, 'Pre-production', 'Tech Scout', 'Survey an empty location. Bring back clean background frames.')}
    <div class="body" style="justify-content:center">
      <div class="col" style="gap:8px;align-items:center">${frame(still(base), { w: 250, tag: 'Location plate' })}</div>
      ${arrow(ACC.scout)}
      <div style="width:170px;height:170px">${orbit}</div>
      ${arrow(ACC.scout)}
      <div class="col" style="gap:10px"><div style="display:grid;grid-template-columns:repeat(3,170px);gap:10px">${cams.map((c, i) => frame(still({ ...base, cam: c }), { w: 170, tag: `${i + 1}` })).join('')}</div><span class="chip acc" style="--acc:${ACC.scout};align-self:flex-start">✓ no people in frame</span></div>
    </div>`;
  } },

  previz: { size: 'agent', html: () => `${head(ACC.previz, 'Pre-production', 'Previz', 'Block the scene. Watch it move. Shoot to it.')}
    <div class="body" style="justify-content:center">
      <div class="col" style="gap:8px"><div class="frame" style="width:300px;height:195px;border:1px solid #2a3348">${schematic()}</div><span class="label">Blocking · top-down</span></div>
      ${arrow(ACC.previz)}
      <div class="col" style="gap:8px"><div class="row" style="gap:8px">${frame(blockout(0), { w: 190, tag: '0s' })}${frame(blockout(1), { w: 190, tag: '6s', play: true })}</div><span class="label">Animatic · blockout draft</span></div>
      ${arrow(ACC.previz)}
      <div class="col" style="gap:8px"><div class="shot" style="width:250px"><div class="stripe"></div><div class="bar"><span class="no">SHOT 2</span><span class="go" style="padding:6px 9px;font-size:12px">Shoot</span></div><div style="padding:0 14px 14px" class="col"><span class="label">Motion reference</span><div class="row" style="gap:8px"><div style="width:70px;height:40px" class="frame">${blockout(0.5)}</div><span class="chip acc" style="--acc:${ACC.previz}">@Video1 animatic</span></div></div></div><span class="label">SHOT card</span></div>
    </div>` },

  shot: { size: 'agent', html: () => `${head(ACC.shot, 'Production', 'Shot', 'Prompt + references in. Takes out. Seedance 2.5, up to 30 s.')}
    <div class="body">
      <div class="shot" style="width:560px"><div class="stripe"></div>
        <div class="bar"><span class="no">SHOT 3</span><span class="pill">🎞 3 takes</span><span class="pill">⏱ 9s</span><span class="pill">Draft 480p</span><span class="go">Shoot</span></div>
        <div class="prompt"><b>Mara</b> <em>@Image1</em> stops in the rain-soaked alley <em>@Image3</em>. She lifts the lantern <em>@Image4</em> — every raindrop freezes mid-air, glowing in its light. Slow push-in, close-up.</div>
        <div class="row" style="padding:0 14px 12px;gap:6px">${[['1', CAST.mara, 'Mara'], ['2', CAST.keeper, 'Keeper']].map(([n, c, t]) => `<span class="chip acc" style="--acc:#8b5cf6"><span class="n">${n}</span>${avatar(c)}${t}</span>`).join('')}<span class="chip acc" style="--acc:#3fbf6f"><span class="n">3</span>Rain alley</span><span class="chip acc" style="--acc:#e0915a"><span class="n">4</span>Lantern</span></div>
        <div class="params"><span>Seedance 2.5 · 30s</span><span>1080p</span><span class="hl">MOV 10-bit</span><span>21:9</span></div>
      </div>
      ${arrow(ACC.shot)}
      <div class="col" style="gap:10px;flex:1">
        ${[F.frozen(), F.frozen({ seed: 34 }), F.alley()].map((s, i) => `<div class="row" style="gap:12px">${frame(s, { w: 200, play: i === 0, style: i === 0 ? `outline:2px solid ${ACC.cut};outline-offset:2px` : '' })}<div class="col" style="gap:4px"><span style="font-size:14px;font-weight:650">Take ${i + 1} ${i === 0 ? '<span style="color:var(--amber)">★</span>' : ''}</span><span class="mono dim" style="font-size:11px">${i === 0 ? 'Final · 1080p · MOV' : 'Draft · 480p'}</span></div></div>`).join('')}
      </div>
    </div>` },

  'video-edit': { size: 'agent', html: () => {
    const base = { kind: 'street', seed: 11, figures: [{ x: 0.5, y: 0.86, h: 0.34, lantern: true }] };
    return `${head(ACC.edit, 'Production', 'Video Edit', 'Keep the shot. Change what you name.')}
    <div class="body" style="justify-content:center">
      <div class="col" style="gap:8px">${frame(still({ ...base, mood: 'day', rain: true }), { w: 360, tag: 'Master', play: true })}</div>
      <div class="col" style="gap:10px;align-items:center">${arrow(ACC.edit)}<div class="note" style="width:210px;font-size:14px;transform:rotate(1.5deg)">Make it night. Neon on the walls. The rain stops mid-air.</div>${arrow(ACC.edit)}</div>
      <div class="col" style="gap:8px">${frame(still({ ...base, mood: 'night', rain: 'frozen' }), { w: 360, tag: 'Edit · take 2', play: true, style: `outline:2px solid ${ACC.edit};outline-offset:3px` })}</div>
    </div>`;
  } },

  audio: { size: 'agent', html: () => `${head(ACC.audio, 'Post-production', 'Audio', 'Dialogue, ambience and effects from one prompt.')}
    <div class="body" style="justify-content:center">
      <div class="card" style="width:330px;padding:16px;font-size:15px;line-height:1.55"><div class="label" style="margin-bottom:8px">Prompt</div>The Keeper, softly: <span style="color:#c4b5fd">“Light it, and the rain will wait.”</span><br>Heavy rain on tin roofs. A distant siren fades.</div>
      ${arrow(ACC.audio)}
      <div class="card" style="width:360px;padding:16px"><div class="row" style="justify-content:space-between"><span class="label">Seed Audio · 9.0 s</span><span class="mono" style="font-size:11px;color:${ACC.audio}">▶ 0:00</span></div><div style="height:74px;margin-top:12px">${wave(60, 4, ACC.audio)}</div></div>
      ${arrow(ACC.audio)}
      <div class="shot" style="width:250px"><div class="stripe"></div><div class="bar"><span class="no">SHOT 3</span></div><div style="padding:0 14px 14px" class="col"><span class="label">Audio reference</span><span class="chip acc" style="--acc:${ACC.audio};align-self:flex-start">♪ @Audio1 · Keeper line</span></div></div>
    </div>` },

  'final-cut': { size: 'agent', html: () => {
    const clips = [[F.alleyWide(), 1.2], [F.alley(), 1], [F.shop(), 1.1], [F.frozen(), 1.3], [F.roof(), 1], [F.dawn(), 1.2]];
    return `${head(ACC.cut, 'Post-production', 'Final Cut', 'Circle your takes. Render the movie in 10-bit.')}
    <div class="body">
      <div class="card" style="flex:1"><div class="hd"><b>Timeline</b>&nbsp; 6 shots · 52 s <span style="margin-left:auto;color:var(--amber)">● Render movie</span></div>
        <div style="padding:14px;position:relative">
          <div class="row" style="gap:4px">${clips.map(([s, f]) => `<div style="flex:${f}">${frame(s, { w: 140, h: 86, style: 'width:100%' })}</div>`).join('')}</div>
          <div style="height:46px;margin-top:8px;background:#0b0d12;border-radius:6px;padding:4px 8px">${wave(140, 12, '#a274ff')}</div>
          <div style="position:absolute;left:38%;top:6px;bottom:6px;width:2px;background:var(--amber)"></div>
        </div></div>
      ${arrow(ACC.cut)}
      <div class="col" style="gap:10px;width:250px">${frame(F.dawn(), { w: 250, play: true })}<div class="mono" style="font-size:13px">the-lantern-keeper.mov</div><div class="row" style="gap:6px;flex-wrap:wrap"><span class="chip">HEVC 10-bit 4:4:4</span><span class="chip">1080p</span><span class="chip">52 s</span></div></div>
    </div>`;
  } },

  tools: { size: 'agent', html: () => {
    const tile = (t, d, art) => `<div class="card" style="padding:14px"><div class="frame" style="height:150px;width:100%;border:1px solid var(--line);background:#0b0d12">${art}</div><div style="font-size:16px;font-weight:650;margin-top:12px">${t}</div><div class="dim" style="font-size:13px;margin-top:4px">${d}</div></div>`;
    const split = `<div style="position:absolute;inset:0;display:flex"><div style="flex:1;overflow:hidden;position:relative">${F.roof({ grade: 'brightness(.3) saturate(.6)' })}<span class="tag">−2 EV</span></div><div style="width:2px;background:#fff"></div><div style="flex:1;overflow:hidden;position:relative">${F.roof()}<span class="tag">relit</span></div></div>`;
    const sharp = `<div style="position:absolute;inset:0;display:flex"><div style="flex:1;filter:blur(3px)">${F.alleyWide()}</div><div style="width:2px;background:#fff"></div><div style="flex:1">${F.alleyWide()}</div></div>`;
    const report = `<div class="col" style="padding:16px;gap:9px">${[['Identity holds', '✓'], ['Motion clean', '✓'], ['10-bit low bits', '✓'], ['Text legible', '✗']].map(([k, v]) => `<div class="row" style="justify-content:space-between;font-size:13px"><span>${k}</span><span style="color:${v === '✓' ? '#3fbf6f' : '#ff4f7b'};font-weight:700">${v}</span></div>`).join('')}</div>`;
    const verify = '<div style="display:grid;place-items:center;height:100%"><svg viewBox="0 0 100 100" style="width:84px;height:84px"><path d="M50 8 L86 22 V50 C86 72 70 86 50 94 C30 86 14 72 14 50 V22 Z" fill="#16303a" stroke="#2fb8a6" stroke-width="3"/><path d="M34 52 L46 64 L68 40" fill="none" stroke="#2fb8a6" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
    return `${head('#8a93a6', 'Tools', 'Tools', 'Model playgrounds and test benches, one tab away.')}
    <div class="body" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;align-content:center">
      ${tile('Tech Test', 'Target → N test shots → QC report.', report)}${tile('Headroom', 'Relight a video from its keyframes.', split)}${tile('Video Enhance', 'Upscale and clean a take.', sharp)}${tile('Verify', 'Check an output’s official provenance.', verify)}
    </div>`;
  } },
};
