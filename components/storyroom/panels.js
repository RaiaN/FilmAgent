import { useEffect, useRef, useState } from 'react';
import { parseBlocking, bindKeys } from '../../utils/film/core/story';
import { Button, Checkbox, Drawer, Image, Input, InputNumber, Modal, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { IconClose, IconEye, IconImage, IconLoading, IconPlus, IconSound } from '@arco-design/web-react/icon';

const { Text } = Typography;

// Story Room department panels: Lookbook, Beat sheet, Casting board, Shot list.
// Pure presentation; the Story Room owns the state and passes setters in.

export const INK = '#1d2129';
export const MUTED = '#86909c';
export const LINE = '#e5e6eb';
export const PAPER = '#ffffff';
export const SCRIPT_FONT = '"Courier Prime", "Courier New", Courier, monospace';
export const KIND_COLOR = { character: '#165dff', location: '#00b42a', prop: '#ff7d00' };
const KIND_LABEL = { character: 'Cast', location: 'Locations', prop: 'Props' };

// Three-act colour coding, the way index cards are pinned on a story wall.
const ACT_OF = {
  protagonist: 1, flaw: 1, internal_need: 1, external_want: 1, inciting_incident: 1,
  antagonist: 2, journey: 2,
  crisis: 3, climax: 3, resolution: 3,
};
const ACT_COLOR = { 1: '#165dff', 2: '#ff7d00', 3: '#f53f3f' };
const ACT_NAME = { 1: 'ACT I', 2: 'ACT II', 3: 'ACT III' };
const BLOCK_SHORT = {
  protagonist: 'Protagonist', flaw: 'Flaw', internal_need: 'Need', inciting_incident: 'Inciting incident',
  external_want: 'Want', antagonist: 'Antagonist', journey: 'Journey', crisis: 'Crisis', climax: 'Climax', resolution: 'Resolution',
};

// Swatches for the stock presets; any other preset gets a neutral strip.
const SWATCH = {
  'Naturalistic film': ['#c9b79c', '#7d8a6a', '#3e4a3d'],
  'Handheld documentary': ['#a39e93', '#5c5a55', '#2b2a28'],
  'Film noir': ['#f2f2f2', '#7a7a7a', '#0d0d0d'],
  'Golden hour': ['#ffd38a', '#f29b54', '#7a3e2b'],
  'Neon night': ['#ff2fa8', '#2de2e6', '#0b0b1e'],
  'Bleach bypass': ['#c8ccc9', '#6f7672', '#1d2220'],
  '1970s Kodachrome': ['#e8b33c', '#c8442b', '#3a5a7a'],
  'Storybook pastel': ['#f6c6c9', '#f8e3a6', '#a9d6d0'],
  Anime: ['#7cc6ff', '#ffe066', '#ff7aa2'],
  'Stop-motion clay': ['#d98e4f', '#7fa37a', '#4a3b33'],
  Watercolor: ['#b8d3e0', '#e8c9b5', '#8fa88a'],
  '3D animated feature': ['#4cc3ff', '#ffb347', '#7d5cff'],
};
const swatchOf = (name) => SWATCH[name] || ['#e5e6eb', '#c9cdd4', '#86909c'];
const strip = (cols) => `linear-gradient(90deg, ${cols[0]} 0 33%, ${cols[1]} 33% 66%, ${cols[2]} 66% 100%)`;

const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const pad2 = (n) => String(n).padStart(2, '0');

const Eyebrow = ({ children, color = MUTED }) => (
  <Text style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color }}>{children}</Text>
);

const Empty = ({ title, hint, action }) => (
  <div style={{ display: 'grid', placeItems: 'center', gap: 10, padding: '56px 16px', border: `1px dashed ${LINE}`, borderRadius: 12, background: PAPER, textAlign: 'center' }}>
    <Text style={{ fontSize: 15, fontWeight: 600 }}>{title}</Text>
    <Text type="secondary" style={{ fontSize: 13, maxWidth: 460 }}>{hint}</Text>
    {action}
  </div>
);
export { Empty };

// ---- LOOKBOOK ----------------------------------------------------------------------
// The look is ONE sentence. Three ways in: a preset card, the filmmaker's own words, or
// reference images (drop / paste / pick) read into a sentence.
export const LookPanel = ({ look, setLook, presets, images, addImages, removeImage, readImages, busy }) => {
  const fileRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const takeFiles = (files) => { const list = Array.from(files || []).filter((f) => f.type.startsWith('image/')); if (list.length) addImages(list); };
  const lookSwatch = presets.find((p) => p.text === look);
  return (
    <div
      style={{ display: 'grid', gap: 20 }}
      onPaste={(e) => takeFiles(Array.from(e.clipboardData?.items || []).map((it) => it.getAsFile()).filter(Boolean))}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16, alignItems: 'stretch' }}>
        <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
          <div style={{ height: 10, background: strip(lookSwatch ? swatchOf(lookSwatch.name) : ['#e5e6eb', '#e5e6eb', '#e5e6eb']) }} />
          <div style={{ padding: 16, display: 'grid', gap: 8, alignContent: 'start' }}>
            <Eyebrow>The look{lookSwatch ? ` · ${lookSwatch.name}` : ''}</Eyebrow>
            <Input.TextArea
              id="story-room-look"
              value={look}
              onChange={setLook}
              autoSize={{ minRows: 4, maxRows: 9 }}
              placeholder="One sentence: medium, palette, light, contrast, texture, era. Pick a preset, read your references, or write it yourself."
              style={{ fontSize: 15, lineHeight: 1.55, background: 'transparent', border: 'none', padding: 0, resize: 'none' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>Rides on every Cast & World plate and every shot prompt.</Text>
          </div>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); takeFiles(e.dataTransfer.files); }}
          style={{ background: dragging ? '#f2f6ff' : PAPER, border: `1px ${dragging ? 'solid #165dff' : `dashed ${LINE}`}`, borderRadius: 12, padding: 16, display: 'grid', gap: 10, alignContent: 'start' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Eyebrow>References</Eyebrow>
            <span style={{ flex: 1 }} />
            <Button size="mini" type="primary" disabled={busy || !images.length} onClick={readImages}>Read the look</Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {images.map((src, i) => (
              <div key={i} style={{ position: 'relative', aspectRatio: '4 / 3', borderRadius: 8, overflow: 'hidden', background: '#f2f3f5' }}>
                <img src={src} alt={`Reference ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                <button type="button" aria-label="Remove reference" onClick={() => removeImage(i)} style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0 }}><IconClose style={{ fontSize: 11 }} /></button>
              </div>
            ))}
            {images.length < 6 && (
              <button type="button" onClick={() => fileRef.current?.click()} style={{ aspectRatio: '4 / 3', borderRadius: 8, border: `1px dashed ${LINE}`, background: '#fafbfc', cursor: 'pointer', display: 'grid', placeItems: 'center', color: MUTED, gap: 2 }}>
                <span style={{ display: 'grid', placeItems: 'center', gap: 2 }}><IconPlus /><span style={{ fontSize: 11 }}>Add</span></span>
              </button>
            )}
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>Drop, paste or add up to 6 stills, frames or mood images. Read the look turns what they share into the sentence.</Text>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { takeFiles(e.target.files); e.target.value = ''; }} />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <Eyebrow>Presets</Eyebrow>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {presets.map((p) => {
            const on = p.text === look;
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => setLook(p.text)}
                title={p.text}
                style={{ textAlign: 'left', padding: 0, cursor: 'pointer', borderRadius: 10, overflow: 'hidden', background: PAPER, border: `1.5px solid ${on ? '#165dff' : LINE}`, boxShadow: on ? '0 0 0 3px rgba(22,93,255,0.12)' : 'none', display: 'grid' }}
              >
                <div style={{ height: 44, background: strip(swatchOf(p.name)) }} />
                <div style={{ padding: '8px 10px 10px', display: 'grid', gap: 2 }}>
                  <Text style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</Text>
                  <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.text}</Text>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ---- BEAT SHEET --------------------------------------------------------------------
// Index cards on a story wall, left to right in story order, colour-coded by act.
export const BeatSheet = ({ facts, shotsOfFact, onOpenShot }) => (
  <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
    <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', width: 'max-content' }}>
      {facts.map((f, i) => {
        const act = ACT_OF[f.block] || 2;
        const newAct = i === 0 || (ACT_OF[facts[i - 1].block] || 2) !== act;
        const inShots = shotsOfFact(f.id);
        return (
          <div key={f.id} style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 6, width: 230 }}>
            <div style={{ height: 16 }}>{newAct && <Eyebrow color={ACT_COLOR[act]}>{ACT_NAME[act]}</Eyebrow>}</div>
            <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderTop: `4px solid ${ACT_COLOR[act]}`, borderRadius: 8, padding: '10px 12px', display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 8, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: SCRIPT_FONT, fontSize: 12, fontWeight: 700, color: MUTED }}>{f.id}</Text>
                <Text style={{ fontSize: 11, fontWeight: 600, color: ACT_COLOR[act] }}>{BLOCK_SHORT[f.block] || f.block}</Text>
                <span style={{ flex: 1 }} />
                <Tooltip content={f.kind === 'hear' ? 'Heard' : 'Seen'}>{f.kind === 'hear' ? <IconSound style={{ color: MUTED }} /> : <IconEye style={{ color: MUTED }} />}</Tooltip>
              </div>
              <Text style={{ fontSize: 13, lineHeight: 1.5 }}>{f.fact}</Text>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minHeight: 20 }}>
                {inShots.map((n) => (
                  <Tag key={n} size="small" style={{ cursor: 'pointer', fontFamily: SCRIPT_FONT }} onClick={() => onOpenShot(n - 1)}>SH {pad2(n)}</Tag>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

// ---- CASTING BOARD -----------------------------------------------------------------
// Cast, locations, props as cards; each card's look is the one source every shot copies.
// When Cast & World has rendered the asset on the Film Agent board, its plates show here
// (matched by name: "Kaan · face", "Kaan · body", "Ferry Deck"); click to enlarge.
const plateKey = (s) => String(s || '').replace(/\s*·\s*(face|body)\s*$/i, '').trim().toLowerCase();
// A re-run of Cast & World adds NEW plates with the same names — the board appends them,
// so the newest ready plate is the last match. While a re-render runs, the old plate
// stays visible under a "rendering…" mark.
export const platesFor = (asset, plates = []) => {
  const mine = plates.filter((p) => plateKey(p.name) === plateKey(asset.name));
  const ready = mine.filter((p) => p.url).reverse(); // newest first
  const face = ready.find((p) => /·\s*face\s*$/i.test(p.name));
  const body = ready.find((p) => /·\s*body\s*$/i.test(p.name));
  const main = face || ready.find((p) => !/·\s*body\s*$/i.test(p.name)) || body || null;
  return { main, extra: main && body && main !== body ? body : null, any: mine.length > 0, loading: mine.some((p) => p.loading) };
};

const PlateHeader = ({ kind, asset, plates, onView }) => {
  const { main, extra, loading } = platesFor(asset, plates);
  const h = main?.url ? (kind === 'character' ? 190 : kind === 'location' ? 170 : 150) : (kind === 'location' ? 96 : 76);
  const tint = `linear-gradient(135deg, ${KIND_COLOR[kind]}14, ${KIND_COLOR[kind]}33)`;
  return (
    <div style={{ height: h, background: main?.url ? '#f2f3f5' : tint, display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden' }}>
      {main?.url
        ? <img src={main.url} alt={main.name} onClick={() => onView(main.url)} style={{ width: '100%', height: '100%', objectFit: kind === 'prop' ? 'contain' : 'cover', objectPosition: kind === 'character' ? 'center 20%' : 'center', cursor: 'zoom-in', display: 'block' }} />
        : kind === 'character'
          ? <span style={{ width: 52, height: 52, borderRadius: 26, background: PAPER, color: KIND_COLOR[kind], display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>{initials(asset.name)}</span>
          : <IconImage style={{ fontSize: 26, color: KIND_COLOR[kind], opacity: 0.6 }} />}
      {extra?.url && (
        <img src={extra.url} alt={extra.name} onClick={() => onView(extra.url)} title="Turnaround" style={{ position: 'absolute', right: 8, bottom: 8, width: 84, height: 63, objectFit: 'cover', borderRadius: 6, border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,0.25)', cursor: 'zoom-in', background: '#fff' }} />
      )}
      {loading && (
        <Text style={{ position: 'absolute', left: 8, bottom: 6, fontSize: 11, fontWeight: 600, color: main?.url ? '#fff' : KIND_COLOR[kind], background: main?.url ? 'rgba(0,0,0,0.55)' : 'transparent', padding: main?.url ? '1px 6px' : 0, borderRadius: 4 }}>
          <IconLoading /> {main?.url ? 're-rendering…' : 'rendering…'}
        </Text>
      )}
    </div>
  );
};

export const AssetBoard = ({ assets, setAsset, usage, plates = [] }) => {
  const [view, setView] = useState('');
  const rendered = assets.filter((a) => platesFor(a, plates).main?.url).length;
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {rendered
          ? `${rendered} of ${assets.length} assets have plates on the Film Agent board.`
          : 'No plates yet. Cast & World renders every asset on the Film Agent board in the Look, and the plates show up here.'}
      </Text>
      {['character', 'location', 'prop'].map((kind) => {
        const list = assets.filter((a) => a.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind} style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <Eyebrow color={KIND_COLOR[kind]}>{KIND_LABEL[kind]}</Eyebrow>
              <Text type="secondary" style={{ fontSize: 12 }}>{list.length}</Text>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${kind === 'location' ? 300 : 240}px, 1fr))`, gap: 12 }}>
              {list.map((a) => (
                <div key={a.key} style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
                  <PlateHeader kind={kind} asset={a} plates={plates} onView={setView} />
                  <div style={{ padding: '10px 12px 12px', display: 'grid', gap: 4, alignContent: 'start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Input id={`story-room-asset-name-${a.key}`} value={a.name} onChange={(v) => setAsset(a.key, 'name', v)} style={{ fontWeight: 600, fontSize: 14, padding: 0, border: 'none', background: 'transparent', flex: 1 }} />
                      <Text style={{ fontSize: 11, color: KIND_COLOR[kind], fontWeight: 600, whiteSpace: 'nowrap' }}>{usage(a.key)} shot{usage(a.key) === 1 ? '' : 's'}</Text>
                    </div>
                    <Text style={{ fontFamily: SCRIPT_FONT, fontSize: 11, color: MUTED }}>{`{{${a.key}}}`}</Text>
                    <Input.TextArea id={`story-room-asset-${a.key}`} value={a.look} onChange={(v) => setAsset(a.key, 'look', v)} autoSize={{ minRows: 2, maxRows: 7 }} placeholder="Look" style={{ fontSize: 12, lineHeight: 1.5, padding: '4px 0 0', border: 'none', background: 'transparent', resize: 'none' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <Image.Preview src={view} visible={!!view} onVisibleChange={(v) => { if (!v) setView(''); }} />
    </div>
  );
};

// ---- SHOT LIST ---------------------------------------------------------------------
// Shot cards in a grid; a card opens the drawer, where the body, bindings and the
// rendered prompt live.
// The card's picture: the latest take once the shot is filmed on the board (click to
// play), else its reference plates — the location as the frame, cast faces as avatars.
// THE SCENE'S BLOCKING — staged once before any shot: the marks, each character's path
// across them, the axis. Every shot of the scene is written against it. Edit the lines;
// Draw shows them as the top-down floor plan.
const PATH_COLORS = ['#3491fa', '#00b42a', '#d9a406', '#f53f3f', '#722ed1', '#ff7d00'];
const BlockingPanel = ({ start, shot, assets, busy, blocking, drawing, onBlock, onDraw, setBlocking }) => {
  const sheet = String(shot.blocking || '');
  const [draft, setDraft] = useState(sheet);
  useEffect(() => { setDraft(sheet); }, [sheet]);
  let parsed = null;
  let problem = '';
  try { parsed = sheet.trim() ? parseBlocking(sheet) : null; } catch (e) { problem = e.message; }
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  const drawn = shot.blockingSchematic;
  const [open, setOpen] = useState(false);
  return (
    <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: open ? '1fr 240px' : '1fr', gap: 12, alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text role="button" tabIndex={0} onClick={() => setOpen((v) => !v)} style={{ fontSize: 10, fontWeight: 700, color: problem ? '#f53f3f' : MUTED, letterSpacing: 0.6, cursor: 'pointer' }}>{open ? '▾' : '▸'} BLOCKING</Text>
          {parsed && parsed.paths.map((p, k) => (
            <span key={p.key} style={{ fontSize: 10, fontWeight: 600, color: '#fff', background: PATH_COLORS[k % PATH_COLORS.length], borderRadius: 4, padding: '1px 6px' }}>{byKey[p.key]?.name || p.key}</span>
          ))}
          <span style={{ flex: 1 }} />
          <Button size="mini" type={sheet ? 'default' : 'primary'} disabled={busy || drawing} loading={blocking} onClick={() => onBlock(start)} title="Block the scene from its shots — marks, paths, axis (replaces your edits to the sheet)">{sheet ? 'Block ↻' : 'Block'}</Button>
          <Button size="mini" disabled={busy || blocking || !parsed} loading={drawing} onClick={() => { setOpen(true); onDraw(start); }} title="Draw the blocking as a top-down floor plan — marks, colour-coded paths, the axis">{drawn ? (drawn.sheet !== sheet ? 'Redraw ●' : 'Redraw') : 'Draw'}</Button>
        </div>
        {open && <Input.TextArea
          value={draft} onChange={setDraft} onBlur={() => { if (draft !== sheet) setBlocking(start, draft); }}
          placeholder={'MARKS: door (front wall, left) · pillar (centre) · counter (back wall)\n{{KAEL}}: door → pillar → counter\nAXIS: Kael ↔ Jinn; cameras stay on the entrance side'}
          autoSize={{ minRows: 3, maxRows: 8 }}
          style={{ fontSize: 12, fontFamily: '"Courier Prime", "Courier New", monospace' }}
        />}
        {open && problem && <Text style={{ fontSize: 11, color: '#f53f3f' }}>{problem}</Text>}
      </div>
      {open && (
        <div style={{ aspectRatio: '16 / 9', borderRadius: 8, border: `1px solid ${LINE}`, background: '#f7f8fa', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
          {drawn?.url ? <Image src={drawn.cacheUrl || drawn.url} width={240} style={{ display: 'block' }} /> : null}
        </div>
      )}
    </div>
  );
};

// THE CARD'S TAKES on the board — click one to circle it (the next card continues from
// it, it is the card's clip in the cut); ▶ plays it.
const TakeStrip = ({ card, onCircle, onPlay }) => (
  <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
    {card.takes.map((t) => {
      const on = t.id === card.chosenTakeId;
      return (
        <div key={t.id} style={{ flex: '0 0 auto', width: 132, borderRadius: 6, overflow: 'hidden', border: `2px solid ${on ? '#f7ba1e' : LINE}`, background: '#101418' }}>
          <div
            role="button" tabIndex={0}
            onClick={() => onCircle(card.cardId, on && card.circled ? null : t.id)}
            title={on ? (card.circled ? 'Circled — click to follow the newest take instead' : 'The newest stands in as circled — click to circle it for good') : 'Circle this take'}
            style={{ position: 'relative', cursor: 'pointer' }}
          >
            {t.posterUrl ? <img src={t.posterUrl} alt={t.label} style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block' }} /> : <div style={{ aspectRatio: '16 / 9' }} />}
            <span style={{ position: 'absolute', top: 4, left: 6, fontSize: 16, color: on ? '#f7ba1e' : 'rgba(255,255,255,0.7)', textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>{on && card.circled ? '★' : '☆'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', background: '#fff' }}>
            <Text style={{ fontSize: 10, flex: 1, minWidth: 0, color: on ? '#b07d00' : MUTED, fontWeight: on ? 700 : 400 }} ellipsis>{t.label}</Text>
            {t.url && <Button size="mini" type="text" onClick={() => onPlay(t.url)} style={{ padding: '0 2px', height: 16 }}>▶</Button>}
          </div>
        </div>
      );
    })}
  </div>
);

// ONE CARD — a scene (or a chunk of one) as one generation: its board card (takes, the
// hand-off from the card before), its length, and its shots as lines.
const CardBlock = ({ card, shots, assets, board, secs, busy, writing, refs, needsReopen, onReopen, onRewrite, onCircle, onJump, onOpen, onPlay }) => {
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  const named = (t) => bindKeys(t, assets).replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (m, k) => byKey[k]?.name || k);
  const over = secs > 30;
  return (
    <div style={{ gridColumn: '1 / -1', border: `1px solid ${LINE}`, borderRadius: 10, background: PAPER, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#fafbfc', borderBottom: `1px solid ${LINE}` }}>
        <Text style={{ fontFamily: SCRIPT_FONT, fontSize: 13, fontWeight: 700 }}>CARD {card.k + 1}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>SH {pad2(card.start + 1)}{card.end > card.start ? `–${pad2(card.end + 1)}` : ''} · {card.idx.length} shot{card.idx.length === 1 ? '' : 's'}</Text>
        <Tooltip content={over ? 'Over 30 s — start the next card at a later shot' : 'One generation'}><Text style={{ fontSize: 12, fontWeight: 700, color: over ? '#f53f3f' : '#4e5969' }}>{secs ? `${secs}s` : '—'}</Text></Tooltip>
        {!card.opensScene && <Tooltip content="Opens on the last frame of the card before"><Text style={{ fontSize: 11, color: MUTED }}>◀</Text></Tooltip>}
        {refs.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 2 }}>
            {refs.slice(0, 8).map((p) => <img key={p.nodeId} src={p.url} alt={p.asset} title={p.asset} style={{ width: 20, height: 20, borderRadius: 10, objectFit: 'cover', border: '1px solid #fff' }} />)}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {board?.stale && <Tooltip content={board.stale}><span style={{ fontSize: 11, fontWeight: 700, color: '#ff7d00' }}>⟳ stale</span></Tooltip>}
        <Button size="mini" disabled={busy} loading={writing} onClick={() => onRewrite(card.start)} title="Write this card's shot lines again against the blocking (replaces your edits to them)">Write ↻</Button>
        {board ? (onJump && <Button size="mini" type="text" onClick={() => onJump(board.cardId)}>Open on board ↗</Button>) : <Text type="secondary" style={{ fontSize: 11 }}>not on the board</Text>}
      </div>
      {(board?.takes?.length > 0 || (!card.opensScene && board)) && (
        <div style={{ display: 'grid', gridTemplateColumns: !card.opensScene ? '1fr 300px' : '1fr', gap: 12, padding: '10px 12px', borderBottom: `1px solid ${LINE}` }}>
          {board?.takes?.length ? <TakeStrip card={board} onCircle={onCircle} onPlay={onPlay} /> : <Text type="secondary" style={{ fontSize: 12 }}>{board?.take?.loading ? 'Rendering…' : 'No takes'}</Text>}
          {!card.opensScene && (
            board?.carried ? (
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, alignItems: 'start' }}>
                <Image src={board.carried.frameUrl} width={110} style={{ borderRadius: 4, border: '2px solid #165dff' }} />
                <div style={{ display: 'grid', gap: 4 }}>
                  <Text style={{ fontSize: 11 }}>{board.carried.label.replace(/^◀\s*/, '')}</Text>
                  {needsReopen
                    ? <Button size="mini" type="primary" loading={writing} disabled={busy} onClick={onReopen} style={{ background: '#d25f00', borderColor: '#d25f00', justifySelf: 'start' }} title="A vision call reads the frame and rewrites only this card's first line so it starts from it">Re-open from this frame</Button>
                    : <Text style={{ fontSize: 11, color: '#00a870' }}>✓</Text>}
                </div>
              </div>
            ) : <Text style={{ fontSize: 12, color: '#d25f00' }}>◀ waiting for the card before</Text>
          )}
        </div>
      )}
      <div style={{ display: 'grid' }}>
        {card.idx.map((i, n) => {
          const x = shots[i];
          return (
            <div
              key={i} role="button" tabIndex={0}
              onClick={() => onOpen(i)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(i); }}
              style={{ display: 'grid', gridTemplateColumns: '64px 1fr 44px', gap: 10, padding: '8px 12px', cursor: 'pointer', borderTop: n ? `1px solid ${LINE}` : 'none', alignItems: 'baseline' }}
            >
              <Text style={{ fontFamily: SCRIPT_FONT, fontSize: 12, fontWeight: 700 }}>SH {pad2(i + 1)}</Text>
              <div style={{ minWidth: 0 }}>
                <Text style={{ fontSize: 12, fontWeight: 600, display: 'block' }}>{x.title}</Text>
                {x.line
                  ? <Text style={{ fontSize: 12, lineHeight: 1.5, color: '#4e5969' }}>{named(x.line)}</Text>
                  : <Text type="secondary" style={{ fontSize: 12, fontStyle: 'italic' }}>{busy || writing ? 'Writing…' : x.moment || 'Not written yet'}</Text>}
              </div>
              <Text style={{ fontSize: 11, color: MUTED, textAlign: 'right' }}>{x.seconds ? `${x.seconds}s` : ''}</Text>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const ShotBoard = ({ shots, assets, cards = [], scenes = [], scenesKnown = false, busy, working = {}, onOpen, refsOf = () => [], boardCardOf = () => null, onJump, locationName = () => '', onRewriteCard, onBlock, onDrawBlocking, setBlocking, needsReopen = () => false, onReopen, onCircle, secondsOf = () => 0 }) => {
  const [playing, setPlaying] = useState('');
  // THE SCENE CATALOGUE — one row per scene; open one to work in it.
  const groups = cards.reduce((m, c) => { (m[c.scene] = m[c.scene] || []).push(c); return m; }, {});
  const list = Object.keys(groups).map(Number).sort((a, b) => a - b).map((n) => ({ n, cards: groups[n] }));
  const [open, setOpen] = useState(() => new Set(list.length ? [list[0].n] : []));
  const toggle = (n) => setOpen((s) => { const t = new Set(s); if (t.has(n)) t.delete(n); else t.add(n); return t; });
  const allOpen = list.length > 0 && list.every((g) => open.has(g.n));
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {scenesKnown && <Text type="secondary" style={{ fontSize: 12 }}>{list.length} scenes · {cards.length} cards</Text>}
        <span style={{ flex: 1 }} />
        {list.length > 1 && <Button size="mini" type="text" onClick={() => setOpen(allOpen ? new Set() : new Set(list.map((g) => g.n)))}>{allOpen ? 'Collapse all' : 'Expand all'}</Button>}
      </div>
      {list.map(({ n, cards: sc }) => {
        const first = sc[0];
        const x = shots[first.start];
        const shotCount = sc.reduce((k, c) => k + c.idx.length, 0);
        const secs = sc.reduce((k, c) => k + secondsOf(c), 0);
        const onBoard = sc.filter((c) => boardCardOf(c)).length;
        const circled = sc.filter((c) => boardCardOf(c)?.takes?.length).length;
        const blocked = !!String(x.blocking || '').trim();
        const isOpen = open.has(n);
        const plates = refsOf(first);
        const poster = sc.map((c) => boardCardOf(c)?.take?.posterUrl).find(Boolean) || (plates.find((p) => p.role === 'location') || plates[plates.length - 1])?.url;
        const dot = (on, label, tip) => (
          <Tooltip content={tip}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: on ? '#00a870' : MUTED }}><span style={{ width: 6, height: 6, borderRadius: 3, background: on ? '#00a870' : '#c9cdd4' }} />{label}</span></Tooltip>
        );
        return (
          <div key={n} style={{ border: `1px solid ${LINE}`, borderRadius: 10, background: PAPER, overflow: 'hidden' }}>
            <div
              role="button" tabIndex={0} onClick={() => toggle(n)} onKeyDown={(e) => { if (e.key === 'Enter') toggle(n); }}
              style={{ display: 'grid', gridTemplateColumns: '16px 72px 1fr auto', gap: 12, alignItems: 'center', padding: '10px 14px', cursor: 'pointer', background: isOpen ? '#fafbfc' : PAPER }}
            >
              <Text style={{ fontSize: 11, color: MUTED }}>{isOpen ? '▾' : '▸'}</Text>
              <div style={{ width: 72, height: 40, borderRadius: 5, overflow: 'hidden', background: '#11141a' }}>
                {poster ? <img src={poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <div style={{ minWidth: 0, display: 'grid', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
                  <Tooltip content={x.sceneReason || ''} disabled={!x.sceneReason}><span><Eyebrow color={INK}>Scene {n}</Eyebrow></span></Tooltip>
                  <Text style={{ fontFamily: SCRIPT_FONT, fontSize: 12, color: KIND_COLOR.location, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{locationName(x)}</Text>
                </div>
                <Text type="secondary" style={{ fontSize: 11 }}>SH {pad2(first.start + 1)}{sc[sc.length - 1].end > first.start ? `–${pad2(sc[sc.length - 1].end + 1)}` : ''} · {shotCount} shot{shotCount === 1 ? '' : 's'} · {sc.length} card{sc.length === 1 ? '' : 's'}{secs ? ` · ${secs}s` : ''}</Text>
              </div>
              <div style={{ display: 'flex', gap: 12 }} onClick={(e) => e.stopPropagation()}>
                {dot(blocked, 'blocked', blocked ? 'Blocked' : 'Not blocked yet')}
                {dot(onBoard === sc.length, `${onBoard}/${sc.length} on board`, 'Cards on the board')}
                {dot(circled === sc.length, `${circled}/${sc.length} shot`, 'Cards with a take')}
              </div>
            </div>
            {isOpen && (
              <div style={{ display: 'grid', gap: 10, padding: '10px 14px 14px', borderTop: `1px solid ${LINE}` }}>
                {scenesKnown && onBlock && <BlockingPanel start={first.start} shot={x} assets={assets} busy={busy} blocking={!!working[`block:${first.start}`]} drawing={!!working[`draw:${first.start}`]} onBlock={onBlock} onDraw={onDrawBlocking} setBlocking={setBlocking} />}
                {sc.map((card) => (
                  <CardBlock
                    key={`card-${card.start}`} card={card} shots={shots} assets={assets} board={boardCardOf(card)} secs={secondsOf(card)} busy={busy} writing={!!working[`card:${card.start}`]}
                    refs={refsOf(card)} needsReopen={needsReopen(card)} onReopen={() => onReopen(card)} onRewrite={onRewriteCard}
                    onCircle={onCircle} onJump={onJump} onOpen={onOpen} onPlay={setPlaying}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <Modal visible={!!playing} footer={null} onCancel={() => setPlaying('')} style={{ width: 'min(960px, 94vw)' }} title="Take">
        {playing && <video src={playing} controls autoPlay style={{ width: '100%', borderRadius: 6, background: '#000' }} />}
      </Modal>
    </div>
  );
};

// ONE SHOT — its line (what this cut shows) and seconds, whether it opens a new scene or
// starts the next card, and what it binds. The card's full prompt is one click away.
export const ShotDrawer = ({ index, shot, shots, assets, facts, card, cardPrompt, boardCardOf, onClose, onGoto, setField, toggleBinding, onOpensScene, onNewCard, onJump }) => {
  const board = card ? boardCardOf(card) : null;
  const opensScene = index === 0 || (card && card.opensScene && card.start === index);
  return (
    <Drawer
      width={620}
      visible={index != null && !!shot}
      onCancel={onClose}
      footer={null}
      title={shot ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <Text style={{ fontFamily: SCRIPT_FONT, fontWeight: 700 }}>SH {pad2(index + 1)}</Text>
          <Text style={{ fontWeight: 600 }}>{shot.title}</Text>
          <span style={{ flex: 1 }} />
          {onJump && board && <Button size="mini" type="primary" onClick={() => onJump(board.cardId)}>Open on board ↗</Button>}
          <Button size="mini" disabled={index === 0} onClick={() => onGoto(index - 1)}>‹ Prev</Button>
          <Button size="mini" disabled={index >= shots.length - 1} onClick={() => onGoto(index + 1)}>Next ›</Button>
        </div>
      ) : null}
    >
      {shot && (
        <div style={{ display: 'grid', gap: 18 }}>
          {shot.moment && <Text type="secondary" style={{ fontSize: 13 }}>{shot.moment}</Text>}
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Eyebrow>The cut</Eyebrow>
              <span style={{ flex: 1 }} />
              <InputNumber size="mini" min={2} max={10} value={shot.seconds} suffix="s" style={{ width: 80 }} onChange={(v) => setField(index, 'seconds', Math.round(Number(v) || 0) || null)} />
            </div>
            <Input.TextArea value={shot.line} onChange={(v) => setField(index, 'line', v)} autoSize={{ minRows: 3, maxRows: 10 }} style={{ fontSize: 13, lineHeight: 1.6 }} placeholder="framing and camera, then what happens — e.g. Medium close-up of {{JINN}} at Opposite Wall: he snaps his fingers…" />
          </div>
          {index > 0 && (
            <div style={{ display: 'grid', gap: 6 }}>
              <Checkbox checked={!!opensScene} onChange={(on) => onOpensScene(index, on)}>Opens a new scene</Checkbox>
              {!opensScene && (
                <Checkbox checked={!!shot.newCard} onChange={(on) => onNewCard(index, on)}>Next card from here</Checkbox>
              )}
            </div>
          )}
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700, color: MUTED }}>Assets · shows · prompt</summary>
            <div style={{ display: 'grid', gap: 14, marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {assets.map((a) => {
                  const isLoc = shot.location === a.key;
                  const on = shot.assets.includes(a.key) || isLoc;
                  return (
                    <Tag key={a.key} checkable checked={on} onCheck={() => !isLoc && toggleBinding(index, a.key)} style={on ? { background: `${KIND_COLOR[a.kind]}1f`, color: KIND_COLOR[a.kind], borderColor: 'transparent' } : undefined}>
                      {a.name}
                    </Tag>
                  );
                })}
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                {shot.shows.map((id) => {
                  const f = facts.find((y) => y.id === id);
                  return f ? <Text key={id} style={{ fontSize: 12 }}><b style={{ fontFamily: SCRIPT_FONT }}>{id}</b> {f.fact}</Text> : null;
                })}
              </div>
              {card && (
                <div style={{ display: 'grid', gap: 4 }}>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.55, margin: 0, padding: 12, borderRadius: 8, background: '#f7f8fa', color: '#4e5969', fontFamily: 'inherit' }}>{board ? board.prompt : cardPrompt(card)}</pre>
                </div>
              )}
            </div>
          </details>
        </div>
      )}
    </Drawer>
  );
};
