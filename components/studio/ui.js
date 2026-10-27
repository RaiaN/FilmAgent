import { useState } from 'react';
import { IconLoading, IconExclamationCircle, IconPlayArrowFill, IconMindMapping } from '@arco-design/web-react/icon';
import { STUDIO_ARCO_DARK } from './theme';

// Studio's look: a dark screening room. Tungsten for the director's hand (actions, the
// selection), gold for what's circled, cyan for the crew at work, coral for what waits on you.
// Every crew member has a colour of their own.
export const C = {
  bg: '#0e0f12', panel: '#14161a', raised: '#1b1e23', hover: '#22262d', line: '#262a31', lineHi: '#363b44',
  ink: '#eceae6', text: '#b4b7be', muted: '#737882',
  accent: '#ff9626', accentSoft: 'rgba(255,150,38,0.12)', accentInk: '#1c1103',
  gold: '#f9cc44', work: '#4cc3ff', workSoft: 'rgba(76,195,255,0.12)',
  warn: '#ff7a59', warnSoft: 'rgba(255,122,89,0.12)', bad: '#f5484c', good: '#3ddc97', goodSoft: 'rgba(61,220,151,0.12)',
  page: '#17191e',
};
export const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
export const SCRIPT_FONT = '"Courier Prime", "Courier New", Courier, monospace';

export const CREW_LOOK = {
  writers: { color: '#c4a1ff', short: 'Wr' },
  ad: { color: '#b5e35a', short: 'AD' },
  casting: { color: '#ff8fc7', short: 'Ca' },
  designer: { color: '#4fd8c4', short: 'De' },
  camera: { color: '#ff6b6b', short: 'Cm' },
  vfx: { color: '#9aa5ff', short: 'FX' },
  editor: { color: '#56e0a0', short: 'Ed' },
  you: { color: C.accent, short: 'You' },
  board: { color: '#9aa3b2', short: 'Bd' },
  shot: { color: '#f0abfc', short: 'Sh' },
};
export const crewColor = (id) => CREW_LOOK[id]?.color || C.muted;
const CREW_NAMES = { writers: 'Writers', ad: '1st AD', casting: 'Casting', designer: 'Designer', camera: 'Camera', vfx: 'VFX', editor: 'Editor', you: 'You', board: 'Canvas', shot: 'Shot' };
export const crewWho = (id) => CREW_NAMES[id] || 'Studio';

// Everything Arco can't take inline: hover states, the script page, scrollbars.
export const STUDIO_CSS = `${STUDIO_ARCO_DARK}
.studio { color-scheme: dark; }
.studio .arco-typography, .studio textarea { word-break: normal; overflow-wrap: break-word; }
.studio .arco-btn-primary:not(.arco-btn-disabled) { color: ${C.accentInk}; font-weight: 600; }
.studio .arco-btn-secondary:not(.arco-btn-disabled) { background: ${C.raised}; border: 1px solid ${C.line}; color: ${C.ink}; }
.studio .arco-btn-secondary:not(.arco-btn-disabled):hover { background: ${C.hover}; border-color: ${C.lineHi}; }
.studio .arco-input, .studio .arco-textarea, .studio .arco-input-inner-wrapper { background: ${C.raised}; border-color: ${C.line}; color: ${C.ink}; }
.studio .arco-input:hover, .studio .arco-textarea:hover { background: ${C.hover}; }
.studio .arco-input:focus, .studio .arco-textarea:focus, .studio .arco-input-focus { background: ${C.raised}; border-color: ${C.accent}; box-shadow: 0 0 0 2px ${C.accentSoft}; }
.studio ::placeholder { color: ${C.muted}; }
.studio ::-webkit-scrollbar { width: 10px; height: 10px; }
.studio ::-webkit-scrollbar-thumb { background: #2b2f37; border-radius: 6px; border: 2px solid transparent; background-clip: padding-box; }
.studio ::-webkit-scrollbar-track { background: transparent; }
.studio .st-row:hover { background: ${C.hover}; }
.studio .st-card { transition: border-color .12s, background .12s, transform .12s; }
.studio .st-card:hover { border-color: ${C.lineHi}; background: ${C.hover}; }
.studio .st-chip { transition: background .12s, border-color .12s; }
.studio .st-chip:hover { background: ${C.hover}; border-color: ${C.lineHi}; }
.studio .st-ghost { opacity: .55; transition: opacity .12s; }
.studio .st-ghost:hover { opacity: 1; }
.studio .st-script.arco-textarea, .studio .st-script.arco-textarea:hover, .studio .st-script.arco-textarea:focus {
  background: transparent; border: none; box-shadow: none; color: #e9e4da; padding: 0;
  font-family: ${SCRIPT_FONT}; font-size: 14.5px; line-height: 1.75; resize: none;
}
.studio .st-bare.arco-input, .studio .st-bare.arco-input:hover, .studio .st-bare.arco-textarea, .studio .st-bare.arco-textarea:hover { background: transparent; border-color: transparent; }
.studio .st-bare.arco-input:focus, .studio .st-bare.arco-textarea:focus { background: ${C.raised}; border-color: ${C.line}; box-shadow: none; }
.studio .st-bare.arco-textarea { resize: none; }
.studio .st-bare.arco-textarea::-webkit-scrollbar { width: 0; }
.studio .arco-textarea-wrapper .arco-textarea-clear-icon, .studio .arco-input-word-limit { display: none; }
@keyframes st-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.studio .st-pulse { animation: st-pulse 1.4s ease-in-out infinite; }
`;

export const mediaOf = (v) => v?.cacheUrl || v?.url || '';
export const isVideo = (v) => v?.kind === 'take' || v?.kind === 'cut';

// A crew member's mark: their initials on their colour.
export const Avatar = ({ id, size = 24 }) => {
  const look = CREW_LOOK[id] || { color: C.muted, short: '·' };
  return (
    <span style={{ width: size, height: size, flex: '0 0 auto', borderRadius: size * 0.3, display: 'inline-grid', placeItems: 'center', fontSize: size * 0.42, fontWeight: 700, letterSpacing: -0.2, color: look.color, background: `${look.color}22`, border: `1px solid ${look.color}44` }}>{look.short}</span>
  );
};

// One version as a tile: its picture (a take shows its poster), or its state.
export const Tile = ({ v, w = 96, ratio = '16 / 9', picked, onClick, title, badge }) => {
  const box = { width: w, aspectRatio: ratio, borderRadius: 6, overflow: 'hidden', background: '#08090b', position: 'relative', flex: '0 0 auto', cursor: onClick ? 'pointer' : 'default', boxShadow: picked ? `0 0 0 2px ${C.gold}` : `inset 0 0 0 1px ${C.line}` };
  let inner = null;
  if (!v) inner = null;
  else if (v.status === 'running') inner = <div className="st-pulse" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: C.work, background: C.workSoft }}><IconLoading /></div>;
  else if (v.status === 'failed') inner = <div title={v.error} style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: C.bad, background: '#2a1416' }}><IconExclamationCircle /></div>;
  else if (isVideo(v)) inner = v.posterUrl
    ? <><img src={v.posterUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /><IconPlayArrowFill style={{ position: 'absolute', right: 4, bottom: 4, color: '#fff', fontSize: 12, filter: 'drop-shadow(0 1px 2px #000)' }} /></>
    : <video src={mediaOf(v)} preload="metadata" muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;
  else if (mediaOf(v)) inner = <img src={mediaOf(v)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;
  return (
    <div role={onClick ? 'button' : undefined} onClick={onClick} title={title || v?.error || ''} style={box}>
      {inner}
      {badge && <span style={{ position: 'absolute', left: 3, top: 3, fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4, color: '#fff', background: 'rgba(0,0,0,0.6)', borderRadius: 3, padding: '0 3px' }}>{badge}</span>}
    </div>
  );
};

export const Empty = ({ children }) => <div style={{ color: C.muted, fontSize: 13, padding: '28px 0', textAlign: 'center' }}>{children}</div>;
export const Label = ({ children, right, style }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, ...style }}>
    <span style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: 1.1, textTransform: 'uppercase', flex: 1 }}>{children}</span>
    {right}
  </div>
);
export const Pill = ({ children, color = C.text, bg = C.raised, style }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color, background: bg, borderRadius: 10, padding: '1px 8px', whiteSpace: 'nowrap', ...style }}>{children}</span>
);
export const Dot = ({ color, pulse, size = 7 }) => <span className={pulse ? 'st-pulse' : undefined} style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', flex: '0 0 auto' }} />;

// A page's head: its title, a quiet line under it, what you can do here on the right.
export const PageHead = ({ title, sub, right, children }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
      {children || <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.4, color: C.ink, lineHeight: 1.2 }}>{title}</div>}
      {sub && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
    {right && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{right}</div>}
  </div>
);

// Opens the thing on the Canvas (nothing is put there until this is clicked).
export const CanvasButton = ({ onClick, title = 'Open in Canvas', size = 28 }) => (
  <span role="button" className="st-chip" title={title} onClick={(e) => { e.stopPropagation(); onClick(); }} style={{ width: size, height: size, flex: '0 0 auto', borderRadius: 7, display: 'inline-grid', placeItems: 'center', border: `1px solid ${C.line}`, color: C.text, cursor: 'pointer', fontSize: size * 0.5 }}><IconMindMapping /></span>
);

// Files dropped anywhere on the area.
export const DropArea = ({ onFiles, accept = () => true, children, style, hint = 'Drop to add' }) => {
  const [over, setOver] = useState(0);
  return (
    <div
      onDragEnter={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setOver((n) => n + 1); } }}
      onDragLeave={() => setOver((n) => Math.max(0, n - 1))}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); setOver(0); const fs = [...(e.dataTransfer?.files || [])].filter(accept); if (fs.length) onFiles(fs); }}
      style={{ position: 'relative', ...style }}
    >
      {children}
      {over > 0 && <div style={{ position: 'absolute', inset: 0, border: `2px dashed ${C.accent}`, background: 'rgba(255,150,38,0.07)', borderRadius: 12, display: 'grid', placeItems: 'center', color: C.accent, fontWeight: 600, pointerEvents: 'none', zIndex: 10 }}>{hint}</div>}
    </div>
  );
};

// Pick a file → a durable media-store url.
export const readFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
export const readText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = rej; r.readAsText(file); });
export const storeFile = async (file) => {
  const dataUrl = await readFile(file);
  const r = await fetch('/api/film/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: dataUrl }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) throw new Error(j.error || 'Upload failed');
  return j.url;
};
