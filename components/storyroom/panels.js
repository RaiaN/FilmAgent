import { useEffect, useRef, useState } from 'react';
import { linkTextOf, FRAME_TOKEN, parseBlocking } from '../../utils/film/core/story';
import { Button, Drawer, Image, Input, Modal, Radio, Select, Tag, Tooltip, Typography } from '@arco-design/web-react';
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
const ShotPreview = ({ refs, card, onPlay }) => {
  const take = card?.take;
  const loc = refs.find((p) => p.role === 'location') || refs[0];
  const frame = { height: 150, background: '#11141a', position: 'relative', overflow: 'hidden', display: 'grid', placeItems: 'center' };
  const badge = (text, color) => <span style={{ position: 'absolute', left: 8, top: 8, padding: '1px 7px', borderRadius: 4, background: 'rgba(0,0,0,0.6)', color, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>{text}</span>;
  if (take?.url) {
    return (
      <div style={frame} onClick={(e) => { e.stopPropagation(); onPlay(take.url); }} title="Play the take">
        {take.posterUrl
          ? <img src={take.posterUrl} alt="Take" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <video src={take.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        <span style={{ position: 'absolute', width: 40, height: 40, borderRadius: 20, background: 'rgba(0,0,0,0.55)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 16 }}>▶</span>
        {badge('FILMED', '#7be3a0')}
      </div>
    );
  }
  const rolling = card && (card.status === 'running' || take?.loading);
  if (!loc && !rolling) return null;
  return (
    <div style={frame}>
      {loc && <img src={loc.url} alt={loc.asset} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: rolling ? 0.45 : 0.9 }} />}
      {rolling ? badge('ROLLING…', '#8fb8ff') : card ? badge('ON THE BOARD', '#c9cdd4') : null}
      <div style={{ position: 'absolute', left: 8, bottom: 8, display: 'flex', gap: 4 }}>
        {refs.filter((p) => p.role === 'character').slice(0, 5).map((p) => (
          <img key={p.nodeId} src={p.url} alt={p.asset} title={p.asset} style={{ width: 30, height: 30, borderRadius: 15, objectFit: 'cover', objectPosition: 'center 20%', border: '2px solid #fff' }} />
        ))}
      </div>
    </div>
  );
};

// THE SCENE'S BLOCKING — staged once before any shot: the marks, each character's path
// across them, the axis. Every shot of the scene is written against it. Edit the lines;
// Draw shows them as the top-down floor plan.
const PATH_COLORS = ['#3491fa', '#00b42a', '#d9a406', '#f53f3f', '#722ed1', '#ff7d00'];
const BlockingPanel = ({ start, shot, assets, busy, onBlock, onDraw, setBlocking }) => {
  const sheet = String(shot.blocking || '');
  const [draft, setDraft] = useState(sheet);
  useEffect(() => { setDraft(sheet); }, [sheet]);
  let parsed = null;
  let problem = '';
  try { parsed = sheet.trim() ? parseBlocking(sheet) : null; } catch (e) { problem = e.message; }
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  const drawn = shot.blockingSchematic;
  return (
    <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 240px', gap: 12, alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: 0.6 }}>BLOCKING</Text>
          {parsed && parsed.paths.map((p, k) => (
            <span key={p.key} style={{ fontSize: 10, fontWeight: 600, color: '#fff', background: PATH_COLORS[k % PATH_COLORS.length], borderRadius: 4, padding: '1px 6px' }}>{byKey[p.key]?.name || p.key}</span>
          ))}
          <span style={{ flex: 1 }} />
          <Button size="mini" disabled={busy} onClick={() => onBlock(start)} title="Block the scene again from its shots — marks, paths, axis (replaces your edits to the sheet)">{sheet ? 'Block ↻' : 'Block the scene'}</Button>
          <Button size="mini" disabled={busy || !parsed} onClick={() => onDraw(start)} title="Draw the blocking as a top-down floor plan — marks, colour-coded paths, the axis">{drawn ? 'Redraw' : 'Draw'}</Button>
        </div>
        <Input.TextArea
          value={draft} onChange={setDraft} onBlur={() => { if (draft !== sheet) setBlocking(start, draft); }}
          placeholder={'MARKS: door (front wall, left) · pillar (centre) · counter (back wall)\n{{KAEL}}: door → pillar → counter\nAXIS: Kael ↔ Jinn; cameras stay on the entrance side'}
          autoSize={{ minRows: 3, maxRows: 8 }}
          style={{ fontSize: 12, fontFamily: '"Courier Prime", "Courier New", monospace' }}
        />
        {problem && <Text style={{ fontSize: 11, color: '#f53f3f' }}>{problem}</Text>}
        {!sheet && <Text type="secondary" style={{ fontSize: 11 }}>Not blocked — the shots of this scene are written against its blocking.</Text>}
      </div>
      <div style={{ aspectRatio: '16 / 9', borderRadius: 8, border: `1px solid ${LINE}`, background: '#f7f8fa', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        {drawn?.url
          ? <Image src={drawn.cacheUrl || drawn.url} width={240} style={{ display: 'block' }} />
          : <Text type="secondary" style={{ fontSize: 11 }}>No floor plan yet</Text>}
      </div>
      {drawn?.url && drawn.sheet !== sheet && <Text style={{ gridColumn: '1 / -1', fontSize: 11, color: '#d25f00' }}>The sheet changed since the floor plan was drawn — Redraw.</Text>}
    </div>
  );
};

export const ShotBoard = ({ shots, assets, onOpen, busy, refsOf = () => [], cardOf = () => null, onJump, scenes = [], scenesKnown = false, consistencyOf = () => null, needsReopen = () => false, locationName = () => '', onScenes, onRewritePrompts, onBlock, onDrawBlocking, setBlocking }) => {
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  const [playing, setPlaying] = useState('');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{scenesKnown ? `${Math.max(...scenes)} scene${Math.max(...scenes) === 1 ? '' : 's'} · a linked shot carries the last frame of the shot it continues from` : 'Scenes not found yet — press Scenes ↻ to find them and link the shots'}</Text>
        <span style={{ flex: 1 }} />
        {onScenes && <Button size="mini" disabled={busy} onClick={onScenes} title="Find where the place or time changes">Scenes ↻</Button>}
        {onRewritePrompts && <Button size="mini" disabled={busy || !scenesKnown} onClick={onRewritePrompts} title="Re-write every shot's prompt in scene order: each shot that continues its scene opens exactly where the one before it ends. Same shots, assets and scenes; replaces hand edits to the prompts.">Prompts ↻</Button>}
      </div>
      {shots.map((x, i) => {
        const loc = byKey[x.location];
        const bound = x.assets.map((k) => byKey[k]).filter((a) => a && a.kind !== 'location');
        const opens = i === 0 || scenes[i] !== scenes[i - 1];
        const cons = consistencyOf(i);
        const src = cons?.card?.take;
        const carried = cardOf(i)?.carried;
        const stale = cardOf(i)?.stale;
        return [
          opens && (
            <div key={`scene-${i}`} style={{ gridColumn: '1 / -1', display: 'grid', gap: 8, paddingTop: i ? 10 : 0, borderTop: i ? `1px solid ${LINE}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <Eyebrow color={INK}>Scene {scenes[i]}</Eyebrow>
                <Text style={{ fontFamily: SCRIPT_FONT, fontSize: 12, color: KIND_COLOR.location, textTransform: 'uppercase' }}>{locationName(x)}</Text>
                {x.sceneReason && <Text type="secondary" style={{ fontSize: 11 }}>{x.sceneReason}</Text>}
              </div>
              {scenesKnown && onBlock && <BlockingPanel start={i} shot={x} assets={assets} busy={busy} onBlock={onBlock} onDraw={onDrawBlocking} setBlocking={setBlocking} />}
            </div>
          ),
          <div
            key={i}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(i)}
            onKeyDown={(e) => { if (e.key === 'Enter') onOpen(i); }}
            style={{ textAlign: 'left', cursor: 'pointer', padding: 0, background: PAPER, border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto auto auto 1fr auto', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
          >
            <ShotPreview refs={refsOf(x)} card={cardOf(i)} onPlay={setPlaying} />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '10px 12px 4px' }}>
              <Text style={{ fontFamily: SCRIPT_FONT, fontSize: 13, fontWeight: 700 }}>SH {pad2(i + 1)}</Text>
              <Text style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.title}</Text>
            </div>
            <div style={{ padding: '0 12px 6px' }}>
              <Text style={{ fontFamily: SCRIPT_FONT, fontSize: 11, color: KIND_COLOR.location, textTransform: 'uppercase' }}>{loc ? loc.name : x.location || '—'}</Text>
            </div>
            <div style={{ padding: '0 12px 10px' }}>
              {x.body
                ? <Text style={{ fontSize: 12, lineHeight: 1.5, color: '#4e5969', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{x.body.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (m, k) => byKey[k]?.name || k)}</Text>
                : <Text type="secondary" style={{ fontSize: 12, fontStyle: 'italic' }}>{busy ? 'Writing…' : x.moment || 'No shot yet'}</Text>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderTop: `1px solid ${LINE}`, background: '#fafbfc' }}>
              {bound.slice(0, 5).map((a) => (
                <Tooltip key={a.key} content={a.name}>
                  <span style={{ width: 22, height: 22, borderRadius: a.kind === 'character' ? 11 : 5, background: `${KIND_COLOR[a.kind]}1f`, color: KIND_COLOR[a.kind], fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{initials(a.name)}</span>
                </Tooltip>
              ))}
              {bound.length > 5 && <Text type="secondary" style={{ fontSize: 11 }}>+{bound.length - 5}</Text>}
              {cons && (
                <Tooltip content={carried ? `${carried.label} — on the card as ${cons.mode === 'open' ? 'the first frame' : 'the state of the scene'}` : `${linkWords(cons)} — waiting: shoot SH ${pad2(cons.from + 1)} first`}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6, fontSize: 10, fontWeight: 600, color: carried ? '#00a870' : '#d25f00' }}>
                    {carried ? <img src={carried.frameUrl} alt="" style={{ width: 26, height: 15, objectFit: 'cover', borderRadius: 2 }} /> : null}
                    ◀ SH {pad2(cons.from + 1)} · {cons.mode === 'open' ? 'opens on' : 'state'} {carried ? '✓' : src?.url ? '· syncing' : '· waiting'}
                  </span>
                </Tooltip>
              )}
              {needsReopen(i) && (
                <Tooltip content="The frame now riding into this shot is not where its prompt opens — open the shot and Re-open from this frame">
                  <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#d25f00' }}>↻ re-open</span>
                </Tooltip>
              )}
              {stale && (
                <Tooltip content={stale}>
                  <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#ff7d00' }}>⟳ stale</span>
                </Tooltip>
              )}
              <span style={{ flex: 1 }} />
              {cardOf(i) && onJump
                ? <Button size="mini" type="text" onClick={(e) => { e.stopPropagation(); onJump(cardOf(i).cardId); }} title="Select this SHOT card on the Film Agent board">Open on board ↗</Button>
                : <Text style={{ fontFamily: SCRIPT_FONT, fontSize: 10, color: MUTED }}>{x.shows.join(' ')}</Text>}
            </div>
          </div>,
        ];
      })}
      <Modal visible={!!playing} footer={null} onCancel={() => setPlaying('')} style={{ width: 'min(960px, 94vw)' }} title="Take">
        {playing && <video src={playing} controls autoPlay style={{ width: '100%', borderRadius: 6, background: '#000' }} />}
      </Modal>
    </div>
  );
};

// THE FRAME A LINKED SHOT CARRIES — what is actually on its board card (image + which
// take it came from + the line in its prompt), and the source shot's takes as their last
// frames: click one to hand that take on; click the chosen one again to follow the newest.
// HOW THE FRAME IS USED — the filmmaker's own words, cited as @ImageN (code keeps the
// number right). Empty = the mode's standard line.
const FrameUse = ({ index, link, carried, onSetLink }) => {
  const n = (/@Image(\d+)/.exec(carried?.line || '') || [])[1];
  const cite = n ? `@Image${n}` : '@Frame';
  const shown = link.text ? link.text.split(FRAME_TOKEN).join(cite) : (carried?.line || '');
  const [draft, setDraft] = useState(shown);
  useEffect(() => { setDraft(shown); }, [shown]);
  const commit = () => {
    const next = linkTextOf(draft);
    const standard = !next || (carried?.line && draft.trim() === carried.line.trim() && !link.text);
    if (standard ? !link.text : next === link.text) return;
    onSetLink(index, { text: standard ? '' : next });
  };
  return (
    <details>
      <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700, color: MUTED }}>How the frame is used{link.text ? ' · your words' : ''}</summary>
      <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
        <Input.TextArea
          value={draft} onChange={setDraft} onBlur={commit}
          autoSize={{ minRows: 2, maxRows: 6 }} style={{ fontSize: 12 }}
          placeholder={`e.g. ${cite}: keep the guard frozen at the door and the dropped bag where it lies`}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 10, flex: 1 }}>Cite the frame as {cite}; this line rides in the prompt word for word.</Text>
          {link.text && <Button size="mini" type="text" onClick={() => onSetLink(index, { text: '' })}>Standard line</Button>}
        </div>
      </div>
    </details>
  );
};

// THIS SHOT'S TAKES on the board — click one to circle it (the next shot continues from
// it, it is the shot's clip in the cut); ▶ plays it.
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

const linkWords = (l) => (l.mode === 'open'
  ? `Opens on the last frame of SH ${pad2(l.from + 1)}`
  : `Carries the last frame of SH ${pad2(l.from + 1)} as the state of the scene`);

export const ShotDrawer = ({ index, shot, shots, assets, facts, look, busy, onClose, onGoto, setBody, toggleBinding, renderPrompt, refsOf = () => [], boardCard = null, onJump, link = null, onSetLink, onCircle, needsReopen = false, onReopen }) => {
  const [playing, setPlaying] = useState('');
  const carried = boardCard?.carried;
  return (
    <Drawer
      width={640}
      visible={index != null && !!shot}
      onCancel={onClose}
      footer={null}
      title={shot ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <Text style={{ fontFamily: SCRIPT_FONT, fontWeight: 700 }}>SH {pad2(index + 1)}</Text>
          <Text style={{ fontWeight: 600 }}>{shot.title}</Text>
          <span style={{ flex: 1 }} />
          {onJump && boardCard && <Button size="mini" type="primary" onClick={() => onJump(boardCard.cardId)}>Open on board ↗</Button>}
          <Button size="mini" disabled={index === 0} onClick={() => onGoto(index - 1)}>‹ Prev</Button>
          <Button size="mini" disabled={index >= shots.length - 1} onClick={() => onGoto(index + 1)}>Next ›</Button>
        </div>
      ) : null}
    >
      {shot && (
        <div style={{ display: 'grid', gap: 18 }}>
          {shot.moment && <Text type="secondary" style={{ fontSize: 13 }}>{shot.moment}</Text>}

          {/* 1 · THE TAKES — circle the one that counts. */}
          <div style={{ display: 'grid', gap: 6 }}>
            <Eyebrow>Takes{boardCard?.takes?.length ? ` · ${boardCard.takes.length}` : ''}</Eyebrow>
            {!boardCard
              ? <Text type="secondary" style={{ fontSize: 12 }}>Not on the board yet — Sync to board.</Text>
              : boardCard.takes.length
                ? <TakeStrip card={boardCard} onCircle={onCircle} onPlay={setPlaying} />
                : <Text type="secondary" style={{ fontSize: 12 }}>{boardCard.take?.loading ? 'Rendering…' : 'No takes yet — shoot it on the board.'}</Text>}
            {boardCard?.stale && <Text style={{ fontSize: 12, color: '#ff7d00' }}>⟳ Stale: {boardCard.stale}</Text>}
          </div>

          {/* 2 · CONTINUITY — the one control. */}
          {index > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              <Eyebrow>Continues from</Eyebrow>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Select
                  size="small" style={{ width: 300 }}
                  value={link ? link.from : -1}
                  onChange={(v) => onSetLink(index, { from: v < 0 ? null : v })}
                  options={[{ label: '— Opens a new scene', value: -1 }, ...shots.slice(0, index).map((x, j) => ({ label: `SH ${pad2(j + 1)} · ${x.title || 'Shot'}`, value: j })).reverse()]}
                />
                {link && (
                  <Radio.Group
                    type="button" size="small" value={link.mode}
                    onChange={(v) => onSetLink(index, { mode: v })}
                    options={[{ label: 'State of the scene', value: 'state' }, { label: 'First frame', value: 'open' }]}
                  />
                )}
              </div>
              {!link && shot.sceneReason && <Text type="secondary" style={{ fontSize: 12 }}>{shot.sceneReason}</Text>}
              {link && (
                carried ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 12, alignItems: 'start' }}>
                    <Image src={carried.frameUrl} width={220} style={{ borderRadius: 6, border: `2px solid ${link.mode === 'open' ? '#165dff' : '#00a870'}` }} />
                    <div style={{ display: 'grid', gap: 6 }}>
                      <Text style={{ fontSize: 12, fontWeight: 600 }}>{carried.label.replace(/^◀\s*/, '')}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>On this shot's card as {link.mode === 'open' ? 'its first frame' : 'the state of the scene'}.</Text>
                      {needsReopen
                        ? (
                          <div style={{ display: 'grid', gap: 4, padding: 8, borderRadius: 6, background: '#fff7e8', border: '1px solid #ffcf8b' }}>
                            <Text style={{ fontSize: 12, color: '#b25d00' }}>This prompt was not opened from this frame yet.</Text>
                            <Button size="mini" type="primary" loading={busy} onClick={onReopen} style={{ background: '#d25f00', borderColor: '#d25f00' }} title="A vision call reads the frame and rewrites only how this shot opens — who is where, holding what — so it starts from it; the rest of the prompt stays">Re-open from this frame</Button>
                          </div>
                        )
                        : shot.openedFrom?.body !== shot.body
                          ? (
                            <div style={{ display: 'grid', gap: 4 }}>
                              <Text type="secondary" style={{ fontSize: 12 }}>{shot.openedFrom?.body ? 'Re-opened from this frame, then edited by hand — the opening is yours now.' : 'Re-opened from this frame earlier; edits since then are not tracked.'}</Text>
                              <Button size="mini" loading={busy} onClick={onReopen} style={{ justifySelf: 'start' }} title="Rewrite only how this shot opens from the frame again — replaces your hand edits to the opening">Re-open again</Button>
                            </div>
                          )
                          : <Text style={{ fontSize: 12, color: '#00a870' }}>✓ The prompt opens from this frame.</Text>}
                      <Button size="mini" type="text" onClick={() => onGoto(link.from)} style={{ justifySelf: 'start', padding: 0 }}>Circle another take of SH {pad2(link.from + 1)} ↗</Button>
                    </div>
                  </div>
                ) : (
                  <Text style={{ fontSize: 12, color: '#d25f00' }}>
                    {!boardCard ? 'Not on the board yet — Sync to board.'
                      : !link.card ? `SH ${pad2(link.from + 1)} is not on the board.`
                        : !link.card.takes?.length ? `Waiting: shoot SH ${pad2(link.from + 1)} first — this shot will not shoot without its last frame.`
                          : 'Taking the last frame…'}
                  </Text>
                )
              )}
              {link && <FrameUse index={index} link={link} carried={carried} onSetLink={onSetLink} />}
            </div>
          )}

          {/* 3 · THE SHOT — what this shot does. */}
          <div style={{ display: 'grid', gap: 6 }}>
            <Eyebrow>Shot</Eyebrow>
            <Input.TextArea id={`story-room-shot-${index}`} value={shot.body} onChange={(v) => setBody(index, v)} autoSize={{ minRows: 8, maxRows: 22 }} style={{ fontSize: 13, lineHeight: 1.6 }} />
            <Text type="secondary" style={{ fontSize: 11 }}>Name assets as {'{{KEY}}'}; their looks are written in from the casting board. Changes land on the board card.</Text>
          </div>

          <details>
            <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700, color: MUTED }}>In this shot · shows · references · {boardCard ? 'the prompt on the board card' : 'full prompt'}</summary>
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
                  const f = facts.find((x) => x.id === id);
                  return f ? <Text key={id} style={{ fontSize: 12 }}><b style={{ fontFamily: SCRIPT_FONT }}>{id}</b> {f.fact}</Text> : null;
                })}
              </div>
              {refsOf(shot).length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {refsOf(shot).map((p, i) => (
                    <div key={p.nodeId} style={{ width: 96, display: 'grid', gap: 2 }}>
                      <img src={p.url} alt={p.name} style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 6, border: `1px solid ${LINE}` }} />
                      <Text style={{ fontFamily: SCRIPT_FONT, fontSize: 11, fontWeight: 700 }}>@Image{i + 1}</Text>
                      <Text type="secondary" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.asset}</Text>
                    </div>
                  ))}
                </div>
              )}
              {/* What Seedance gets: the card's own prompt (with the continuity line) once the
                  shot is on the board, else Story Room's render of it. */}
              <div style={{ display: 'grid', gap: 4 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>{boardCard ? 'On the board card — exactly what Seedance gets' : 'Not on the board yet — the prompt as it will land'}</Text>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.55, margin: 0, padding: 12, borderRadius: 8, background: '#f7f8fa', color: '#4e5969', fontFamily: 'inherit' }}>{boardCard ? boardCard.prompt : renderPrompt(shot)}</pre>
              </div>
            </div>
          </details>
        </div>
      )}
      <Modal visible={!!playing} footer={null} onCancel={() => setPlaying('')} style={{ width: 'min(960px, 94vw)' }} title="Take">
        {playing && <video src={playing} controls autoPlay style={{ width: '100%', borderRadius: 6, background: '#000' }} />}
      </Modal>
    </Drawer>
  );
};
