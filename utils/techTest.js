// Tech Test: the code-side contract around the planner (shot list, critique) and the
// Markdown report. Pure functions — shared by the Tech Test tab and nothing server-only.

export const SHOT_TYPES = ['Extreme wide shot', 'Wide shot', 'Aerial establishing shot', 'Full shot', 'Medium shot', 'Close-up', 'Tracking shot'];
export const RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
export const VERDICTS = ['usable', 'fixable', 'reshoot'];
export const SCORE_KEYS = [['prompt_adherence', 'Prompt adherence'], ['target_fidelity', 'Target fidelity'], ['shot_type', 'Shot type']];
const SEVERITIES = ['minor', 'major', 'blocking'];

// What the planner promised: exactly `count` shots, each with a real prompt and checks, no repeats.
export const shotListProblems = (list, count) => {
  if (!Array.isArray(list)) return ['the answer is not a JSON array'];
  const p = [];
  if (list.length !== count) p.push(`need exactly ${count} shots, got ${list.length}`);
  list.forEach((s, i) => {
    if (!s || typeof s !== 'object') { p.push(`shot ${i + 1} is not an object`); return; }
    if (!String(s.title || '').trim()) p.push(`shot ${i + 1} has no title`);
    if (String(s.prompt || '').trim().length < 60) p.push(`shot ${i + 1} prompt is missing or too short`);
    if (!Array.isArray(s.checks) || !s.checks.filter((c) => String(c).trim()).length) p.push(`shot ${i + 1} has no checks`);
  });
  const prompts = list.map((s) => String(s?.prompt || '').trim().toLowerCase());
  if (new Set(prompts).size !== prompts.length) p.push('two shots have the same prompt');
  return p;
};

export const critiqueProblems = (c) => {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['the answer is not a JSON object'];
  const p = [];
  SCORE_KEYS.forEach(([k]) => {
    const s = c[k]?.score;
    if (![0, 1, 2].includes(Number(s)) || s === '' || s == null) p.push(`${k}.score must be 0, 1 or 2`);
    if (!String(c[k]?.reason || '').trim()) p.push(`${k}.reason is missing`);
  });
  if (!Array.isArray(c.issues)) p.push('issues must be a list');
  else if (c.issues.some((x) => !String(x?.what || '').trim() || !SEVERITIES.includes(String(x?.severity)))) p.push('every issue needs "what" and a severity of minor, major or blocking');
  if (!Array.isArray(c.post_fixes)) p.push('post_fixes must be a list');
  if (!VERDICTS.includes(c.verdict)) p.push(`verdict must be one of ${VERDICTS.join(', ')}`);
  return p;
};

export const parseJson = (text) => {
  const t = String(text || '').replace(/```(?:json)?/g, '').trim();
  try { return JSON.parse(t); } catch { /* the model wrapped it in prose */ }
  const m = t.match(/[[{][\s\S]*[\]}]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
};

const fmtSec = (s) => `${Number(s).toFixed(2)} s`;

// One line of measured facts, for the critique prompt and the summary table.
export const measuredLine = (qc) => {
  if (!qc) return 'not measured';
  const cuts = qc.cuts?.length ? `picture cuts at ${qc.cuts.map((c) => fmtSec(c.t)).join(', ')}` : 'no picture cuts';
  return `${qc.spec.width}×${qc.spec.height}, ${qc.spec.durationSec.toFixed(2)} s, ${cuts}`;
};

const cell = (v) => String(v ?? '—').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
const yes = (b) => (b ? 'yes' : 'no');

// The Lark-importable report. `link(url)` maps a stored file to a URL the reader can open.
export const buildReport = ({ target, shots, models, createdAt, link }) => {
  const done = shots.filter((s) => s.qc);
  const L = [];
  L.push(`# Tech Test · ${target.shotType} · ${target.country}`);
  L.push('');
  L.push(`**Topic:** ${target.topic || '—'} · **Style:** ${target.style || '—'}`);
  L.push('');
  L.push(`**Render:** ${models.video} · 1080p · ${target.ratio} · ${target.seconds} s · MOV master (HEVC 10-bit 4:4:4) · audio ${target.audio ? 'on' : 'off'}`);
  L.push('');
  L.push(`**Planner:** ${models.planner} · **Run:** ${createdAt} · **Shots:** ${done.length} of ${shots.length} rendered`);
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push('| # | Shot | Verdict | Prompt | Target | Shot type | Picture cuts | Real 10-bit | Blocking | Loudness |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  shots.forEach((s, i) => {
    const c = s.critique || {};
    const q = s.qc;
    const sc = (k) => (c[k] ? `${c[k].score}/2` : '—');
    L.push(`| ${i + 1} | ${cell(s.title)} | ${cell(c.verdict || s.error || s.stage)} | ${sc('prompt_adherence')} | ${sc('target_fidelity')} | ${sc('shot_type')} | ${q ? (q.cuts.length || 'none') : '—'} | ${q?.bitDepth?.genuine == null ? '—' : yes(q.bitDepth.genuine)} | ${q ? q.blockiness : '—'} | ${q?.loudness?.lufs ? `${q.loudness.lufs} LUFS` : '—'} |`);
  });
  L.push('');
  L.push('Blocking = codec block-edge energy against the rest of the picture (1.00 = invisible). Real 10-bit = the two lowest bits carry data, so the file is not 8-bit padded.');
  shots.forEach((s, i) => {
    L.push('');
    L.push(`## Shot ${i + 1} · ${s.title}`);
    L.push('');
    if (s.qc?.contactUrl) { L.push(`![Shot ${i + 1} contact sheet](${link(s.qc.contactUrl)})`); L.push(''); }
    L.push('**Prompt**');
    L.push('');
    String(s.prompt).split('\n').forEach((l) => L.push(`> ${l}`));
    L.push('');
    L.push('**What to check**');
    L.push('');
    (s.checks || []).filter((c) => String(c).trim()).forEach((c) => L.push(`- ${String(c).trim()}`));
    if (!s.qc) {
      L.push('');
      L.push(`_Not rendered: ${s.error || s.stage}._`);
      return;
    }
    const q = s.qc;
    L.push('');
    L.push('**Measured**');
    L.push('');
    L.push('| Check | Result |');
    L.push('|---|---|');
    L.push(`| Video | ${cell(`${q.spec.codec}${q.spec.profile ? ` ${q.spec.profile}` : ''} · ${q.spec.pixFmt} · ${q.spec.width}×${q.spec.height} · ${q.spec.fps} fps · ${q.spec.bitrateMbps} Mbit/s`)} |`);
    L.push(`| Colour | ${cell(q.spec.color || 'untagged')} |`);
    L.push(`| Audio | ${cell(q.audio ? `${q.audio.codec} · ${q.audio.sampleRate} Hz · ${q.audio.layout}` : 'none')} |`);
    L.push(`| Bit depth used | ${cell(q.bitDepth.native >= 10 ? `${q.bitDepth.codesUsed} of ${q.bitDepth.ofPossible} codes · low bits ${q.bitDepth.lsbPct.join(' / ')} % → ${q.bitDepth.genuine ? 'real 10-bit' : 'padded 8-bit'}` : `${q.bitDepth.codesUsed} of ${q.bitDepth.ofPossible} codes`)} |`);
    L.push(`| Levels | ${cell(`luma ${q.levels.ymin}–${q.levels.ymax} · out of broadcast range: max ${q.levels.brngMaxPct} % of a frame`)} |`);
    L.push(`| Picture cuts | ${cell(q.cuts.length ? q.cuts.map((c) => `${fmtSec(c.t)} (frame ${c.frame})`).join(', ') : 'none')} |`);
    L.push(`| Flicker (p95 frame-to-frame wobble) | ${cell(`${q.flickerP95} codes`)} |`);
    L.push(`| Compression blocking | ${cell(q.blockiness)} |`);
    L.push(`| Fine detail (mean Laplacian, 10-bit) | ${cell(q.detail)} |`);
    L.push(`| Loudness | ${cell(q.loudness?.lufs ? `${q.loudness.lufs} LUFS integrated · ${q.loudness.truePeak} dBTP · LRA ${q.loudness.lra} LU` : '—')} |`);
    if (q.cropUrl) { L.push(''); L.push(`![Shot ${i + 1} 100% crop at ${fmtSec(q.cropT)}](${link(q.cropUrl)})`); }
    const c = s.critique;
    L.push('');
    if (!c) {
      L.push(`_No review: ${s.error || 'pending'}._`);
    } else {
      L.push(`**Review · ${c.verdict}**`);
      L.push('');
      SCORE_KEYS.forEach(([k, label]) => L.push(`- **${label} ${c[k].score}/2**: ${c[k].reason}`));
      if (c.issues.length) {
        L.push('');
        L.push('| Issue | Where | Severity |');
        L.push('|---|---|---|');
        c.issues.forEach((x) => L.push(`| ${cell(x.what)} | ${cell(x.where)} | ${cell(x.severity)} |`));
      }
      if (c.post_fixes.length) {
        L.push('');
        L.push('**Post work**');
        L.push('');
        c.post_fixes.forEach((f) => L.push(`- ${f}`));
      }
    }
    L.push('');
    L.push(`**Files:** [Preview MP4](${link(q.proxyUrl)}) · [MOV master](${link(q.masterUrl)})`);
  });
  L.push('');
  L.push('---');
  L.push('Links and images in this report are presigned storage links valid for 7 days from export.');
  return L.join('\n');
};

// ---- HTML report: the same content as buildReport, as a designed standalone page.
// `media.image(url)` / `media.video(url)` / `media.link(url)` map stored files to what the page embeds.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VERDICT_CLASS = { usable: 'ok', fixable: 'warn', reshoot: 'bad' };

export const buildReportHtml = ({ target, shots, models, createdAt, media }) => {
  const done = shots.filter((s) => s.qc);
  const measuredRows = (q) => [
    ['Video', `${q.spec.codec}${q.spec.profile ? ` ${q.spec.profile}` : ''} · ${q.spec.pixFmt} · ${q.spec.width}×${q.spec.height} · ${q.spec.fps} fps · ${q.spec.bitrateMbps} Mbit/s`],
    ['Colour', q.spec.color || 'untagged'],
    ['Audio', q.audio ? `${q.audio.codec} · ${q.audio.sampleRate} Hz · ${q.audio.layout}` : 'none'],
    ['Bit depth', q.bitDepth.native >= 10 ? `${q.bitDepth.codesUsed} of ${q.bitDepth.ofPossible} codes · ${q.bitDepth.genuine ? 'real 10-bit' : 'padded 8-bit'}` : `${q.bitDepth.codesUsed} of ${q.bitDepth.ofPossible} codes`],
    ['Levels', `luma ${q.levels.ymin}–${q.levels.ymax} · out of range max ${q.levels.brngMaxPct} %`],
    ['Picture cuts', q.cuts.length ? q.cuts.map((c) => `${c.t} s`).join(', ') : 'none'],
    ['Flicker p95', `${q.flickerP95} codes`],
    ['Blocking', String(q.blockiness)],
    ['Fine detail', String(q.detail)],
    ['Loudness', q.loudness?.lufs ? `${q.loudness.lufs} LUFS · ${q.loudness.truePeak} dBTP` : '—'],
  ].map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const review = (c) => (!c ? '<p class="muted">Not reviewed.</p>' : `
      <div class="verdict ${VERDICT_CLASS[c.verdict]}">${esc(c.verdict)}</div>
      <ul class="scores">${SCORE_KEYS.map(([k, label]) => `<li><span class="pip s${c[k].score}">${c[k].score}</span><span><b>${esc(label)}.</b> ${esc(c[k].reason)}</span></li>`).join('')}</ul>
      ${c.issues.length ? `<h4>Issues</h4><ul class="issues">${c.issues.map((x) => `<li><span class="sev ${esc(x.severity)}">${esc(x.severity)}</span> ${esc(x.what)}${x.where ? ` <span class="muted">— ${esc(x.where)}</span>` : ''}</li>`).join('')}</ul>` : ''}
      ${c.post_fixes.length ? `<h4>Post work</h4><ul class="fixes">${c.post_fixes.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}`);
  const shotHtml = (s, i) => {
    const q = s.qc;
    const checks = (s.checks || []).filter((c) => String(c).trim());
    return `
  <article class="shot" id="shot-${i + 1}">
    <header class="shot-head"><span class="no">${String(i + 1).padStart(2, '0')}</span><h3>${esc(s.title)}</h3>${s.critique ? `<span class="verdict small ${VERDICT_CLASS[s.critique.verdict]}">${esc(s.critique.verdict)}</span>` : ''}</header>
    <div class="shot-body">
      <div class="media">${q ? `
        <video controls muted playsinline preload="metadata" src="${esc(media.video(q.proxyUrl))}" poster="${esc(media.image(q.stills[0].url))}"></video>
        <img src="${esc(media.image(q.contactUrl))}" alt="Shot ${i + 1} contact sheet">
        <figure><img src="${esc(media.image(q.cropUrl))}" alt="Shot ${i + 1} 100% crop"><figcaption>100% crop from the centre at ${q.cropT} s</figcaption></figure>
        <p class="files"><a href="${esc(media.link(q.proxyUrl))}">Preview MP4</a> · <a href="${esc(media.link(q.masterUrl))}">MOV master</a></p>` : `<p class="muted">Not rendered: ${esc(s.error || s.stage)}</p>`}
      </div>
      <div class="text">
        <h4>Prompt</h4><blockquote>${esc(s.prompt)}</blockquote>
        ${checks.length ? `<h4>What to check</h4><ul class="checks">${checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
        ${q ? `<h4>Measured</h4><div class="scroll"><table class="measured">${measuredRows(q)}</table></div>` : ''}
        <h4>Review</h4>${review(s.critique)}
      </div>
    </div>
  </article>`;
  };
  const summaryRows = shots.map((s, i) => {
    const c = s.critique; const q = s.qc;
    const sc = (k) => (c ? `${c[k].score}/2` : '—');
    return `<tr><td>${i + 1}</td><td><a href="#shot-${i + 1}">${esc(s.title)}</a></td><td>${c ? `<span class="verdict small ${VERDICT_CLASS[c.verdict]}">${esc(c.verdict)}</span>` : esc(s.error || s.stage)}</td><td>${sc('prompt_adherence')}</td><td>${sc('target_fidelity')}</td><td>${sc('shot_type')}</td><td>${q ? (q.cuts.length || 'none') : '—'}</td><td>${q?.bitDepth?.genuine == null ? '—' : q.bitDepth.genuine ? 'yes' : 'no'}</td><td>${q ? q.blockiness : '—'}</td><td>${q?.loudness?.lufs ? `${q.loudness.lufs}` : '—'}</td></tr>`;
  }).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tech Test · ${esc(target.shotType)} · ${esc(target.country)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
/* Layout: a production tech-test sheet: slate header, summary table, then one slate per shot (media left, notes right). */
:root { --bg: #f4f5f2; --card: #ffffff; --ink: #191c1a; --muted: #5f665f; --line: #dde1da; --accent: #1f5f4a; --chip: #e8ece6;
  --ok: #2f7d4f; --warn: #a8640c; --bad: #b3352e;
  --f-display: "Archivo", "Helvetica Neue", Arial, sans-serif; --f-body: "Source Sans 3", "Helvetica Neue", Arial, sans-serif; --f-mono: "JetBrains Mono", ui-monospace, Menlo, monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #121513; --card: #1a1e1b; --ink: #e5e9e3; --muted: #9aa39a; --line: #2c322d; --accent: #7cc4a6; --chip: #242a25; --ok: #6cc28c; --warn: #e2a24a; --bad: #ef7d74; color-scheme: dark; } }
:root[data-theme="dark"] { --bg: #121513; --card: #1a1e1b; --ink: #e5e9e3; --muted: #9aa39a; --line: #2c322d; --accent: #7cc4a6; --chip: #242a25; --ok: #6cc28c; --warn: #e2a24a; --bad: #ef7d74; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 15px/1.55 var(--f-body); padding-inline: 16px; padding-block: 28px 56px; }
main { max-width: 1200px; margin: 0 auto; display: grid; gap: 32px; }
h1, h2, h3, h4 { margin: 0; text-wrap: balance; }
h1 { font: 800 clamp(26px, 4vw, 40px)/1.1 var(--f-display); letter-spacing: -0.01em; }
h2 { font: 700 20px/1.2 var(--f-display); }
h3 { font: 700 18px/1.25 var(--f-display); }
h4 { font: 600 12px/1.3 var(--f-body); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-top: 6px; }
a { color: var(--accent); }
.muted { color: var(--muted); }
.slate { display: grid; gap: 12px; padding-bottom: 20px; border-bottom: 3px solid var(--ink); }
.eyebrow { font: 600 12px/1 var(--f-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chips span { background: var(--chip); border-radius: 4px; padding: 4px 10px; font-size: 13px; }
.meta { font: 400 12px/1.6 var(--f-mono); color: var(--muted); overflow-wrap: anywhere; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
.summary table { min-width: 720px; }
.summary thead th { font: 600 11px/1.3 var(--f-body); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.measured th { width: 34%; font-weight: 600; color: var(--muted); }
.measured td { font: 400 12.5px/1.5 var(--f-mono); overflow-wrap: anywhere; }
.shot { background: var(--card); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; scroll-margin-top: 16px; }
.shot-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line);
  background: repeating-linear-gradient(-45deg, var(--chip) 0 10px, transparent 10px 20px); }
.shot-head .no { font: 700 13px/1 var(--f-mono); background: var(--ink); color: var(--bg); padding: 5px 8px; border-radius: 3px; }
.shot-head h3 { flex: 1; min-width: 0; }
.shot-body { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 20px; padding: 16px; }
.media, .text { display: grid; gap: 10px; align-content: start; min-width: 0; }
video, .media img { width: 100%; max-width: 100%; display: block; border-radius: 4px; background: #000; }
figure { margin: 0; display: grid; gap: 4px; }
figcaption, .files { font-size: 12px; color: var(--muted); margin: 0; }
blockquote { margin: 0; padding: 10px 12px; border-left: 3px solid var(--accent); background: var(--chip); border-radius: 0 4px 4px 0; font-size: 14px; }
ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.verdict { display: inline-block; font: 700 13px/1 var(--f-display); text-transform: uppercase; letter-spacing: 0.06em; padding: 6px 10px; border-radius: 4px; border: 1.5px solid currentColor; justify-self: start; }
.verdict.small { font-size: 11px; padding: 3px 7px; }
.ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); }
.scores { list-style: none; padding: 0; }
.scores li { display: grid; grid-template-columns: 24px 1fr; gap: 8px; }
.pip { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid currentColor; font: 700 12px/1 var(--f-mono); }
.s2 { color: var(--ok); } .s1 { color: var(--warn); } .s0 { color: var(--bad); }
.sev { font: 600 11px/1 var(--f-mono); text-transform: uppercase; padding: 2px 5px; border-radius: 3px; border: 1px solid currentColor; }
.sev.blocking { color: var(--bad); } .sev.major { color: var(--warn); } .sev.minor { color: var(--muted); }
footer { font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 12px; }
@media (max-width: 760px) { .shot-body { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <header class="slate">
    <span class="eyebrow">Production tech test · Seedance 2.5</span>
    <h1>${esc(target.shotType)} · ${esc(target.country)}</h1>
    <div class="chips"><span>Topic: ${esc(target.topic || 'open')}</span><span>Style: ${esc(target.style || 'open')}</span><span>${esc(target.ratio)} · ${esc(target.seconds)} s · audio ${target.audio ? 'on' : 'off'}</span><span>${done.length} of ${shots.length} rendered</span></div>
    <div class="meta">Render: ${esc(models.video)} · 1080p · MOV master (HEVC 10-bit 4:4:4)<br>Planner: ${esc(models.planner)} · Run: ${esc(createdAt)}</div>
  </header>
  <section class="summary">
    <h2>Summary</h2>
    <div class="scroll"><table>
      <thead><tr><th>#</th><th>Shot</th><th>Verdict</th><th>Prompt</th><th>Target</th><th>Shot type</th><th>Cuts</th><th>Real 10-bit</th><th>Blocking</th><th>LUFS</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table></div>
    <p class="muted" style="font-size:12px;margin:8px 0 0">Blocking = codec block-edge energy against the rest of the picture (1.00 = invisible). Real 10-bit = the two lowest bits carry data. Reviews are a planner model's opinion from six stills; the measured values come from code.</p>
  </section>
  ${shots.map(shotHtml).join('\n')}
  <footer>Generated by the Tech Test tab. Video and file links are presigned storage links valid for 7 days from export; the stills are embedded in this page.</footer>
</main>
</body>
</html>`;
};
