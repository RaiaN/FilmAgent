import { useEffect, useRef, useState } from 'react';
import { parseBlocking, bindKeys } from '../../utils/film/core/story';
import { Button, Drawer, Dropdown, Image, Input, InputNumber, Menu, Modal, Radio, Tag, Typography } from '@arco-design/web-react';
import { IconClose, IconImage, IconLoading, IconMore, IconPlus } from '@arco-design/web-react/icon';

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
// THE SCENE'S BLOCKING — staged once before any shot: the marks, each character's path
// across them, the axis. Every card of the scene is written against it. Edit the lines;
// Draw shows them as the top-down floor plan.
const PATH_COLORS = ['#3491fa', '#00b42a', '#d9a406', '#f53f3f', '#722ed1', '#ff7d00'];
const BlockingModal = ({ scene, start, shot, assets, busy, blocking, drawing, onBlock, onDraw, setBlocking, onClose }) => {
  const sheet = String(shot?.blocking || '');
  const [draft, setDraft] = useState(sheet);
  useEffect(() => { setDraft(sheet); }, [sheet]);
  let parsed = null;
  let problem = '';
  try { parsed = sheet.trim() ? parseBlocking(sheet) : null; } catch (e) { problem = e.message; }
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  const drawn = shot?.blockingSchematic;
  const save = () => { if (start != null && draft !== sheet) setBlocking(start, draft); };
  return (
    <Modal visible={start != null} footer={null} onCancel={() => { save(); onClose(); }} style={{ width: 'min(1120px, 94vw)' }} title={`Scene ${scene} · Blocking`}>
      <div className="sr-blocking" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 24, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 12 }}>
          {parsed && parsed.paths.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {parsed.paths.map((p, k) => (
                <span key={p.key} style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: PATH_COLORS[k % PATH_COLORS.length], borderRadius: 6, padding: '3px 10px' }}>{byKey[p.key]?.name || p.key}</span>
              ))}
            </div>
          )}
          <Input.TextArea
            value={draft} onChange={setDraft} onBlur={save}
            placeholder={'MARKS: door (front wall, left) · pillar (centre) · counter (back wall)\n{{KAEL}}: door → pillar → counter\nAXIS: Kael ↔ Jinn; cameras stay on the entrance side'}
            autoSize={{ minRows: 8, maxRows: 18 }}
            style={{ fontSize: 14, lineHeight: 1.6, fontFamily: SCRIPT_FONT }}
          />
          {problem && <Text style={{ fontSize: 13, color: '#f53f3f' }}>{problem}</Text>}
          <div>
            <Button type={sheet ? 'secondary' : 'primary'} disabled={busy || drawing} loading={blocking} onClick={() => onBlock(start)}>{sheet ? 'Block again' : 'Block the scene'}</Button>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ aspectRatio: '16 / 9', borderRadius: 10, border: `1px solid ${LINE}`, background: '#f7f8fa', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            {drawn?.url
              ? <img src={drawn.cacheUrl || drawn.url} alt="Floor plan" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              : <Text type="secondary" style={{ fontSize: 14 }}>No floor plan yet</Text>}
          </div>
          <div>
            <Button disabled={busy || blocking || !parsed} loading={drawing} onClick={() => { save(); onDraw(start); }}>
              {drawn ? (drawn.sheet !== sheet ? 'Redraw — the sheet changed' : 'Redraw floor plan') : 'Draw floor plan'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

const GOLD = '#f7ba1e';

// ONE CARD — a scene (or a chunk of one) as one generation. Left: its circled take, big;
// the other takes under it (click one to put it in the cut). Right: its shots — the number
// plays the take from that shot, the text opens the shot. One button: to the board.
const CardRow = ({ card, shots, assets, board, poster, secs, busy, writing, needsReopen, onReopen, onRewrite, onCircle, onJump, onOpen }) => {
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
  const named = (t) => bindKeys(t, assets).replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (m, k) => byKey[k]?.name || k);
  const take = board?.takes?.find((t) => t.id === board.chosenTakeId) || null;
  const rendering = !!board?.take?.loading;
  const video = useRef(null);
  const pending = useRef(null);
  const [now, setNow] = useState(-1);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); setNow(-1); }, [take?.url]);
  // Where each shot starts inside the take.
  const timed = card.idx.every((i) => Number(shots[i].seconds) > 0);
  const starts = [];
  card.idx.reduce((at, i) => { starts.push(at); return at + (Number(shots[i].seconds) || 0); }, 0);
  const playFrom = (n) => {
    const v = video.current;
    if (!v) return;
    if (v.readyState >= 1) v.currentTime = starts[n];
    else pending.current = starts[n];
    v.play().catch(() => {}); // a pause before the play settles rejects; the video's own error event reports real failures
  };
  const onTime = () => {
    const v = video.current;
    if (!v || !timed) return;
    let n = 0;
    starts.forEach((s, k) => { if (v.currentTime >= s) n = k; });
    setNow(n);
  };
  const over = secs > 30;
  return (
    <div className="sr-card" style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: PAPER, padding: 20 }}>
      <div style={{ display: 'grid', gap: 10, alignContent: 'start', minWidth: 0 }}>
        <div style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', background: '#0d1117' }}>
          {take?.url ? (
            <video
              ref={video} key={take.url} src={take.url} poster={take.posterUrl || undefined} controls preload="none" playsInline
              onLoadedMetadata={() => { if (pending.current != null) { video.current.currentTime = pending.current; pending.current = null; } }}
              onTimeUpdate={onTime} onEnded={() => setNow(-1)} onError={() => setFailed(true)}
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' }}
            />
          ) : (
            <>
              {poster && <img src={poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.35 }} />}
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: 600 }}>{rendering ? <><IconLoading style={{ marginRight: 8 }} />Rendering…</> : 'Not filmed yet'}</Text>
              </div>
            </>
          )}
          {failed && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(13,17,23,0.82)', padding: 24, textAlign: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 15 }}>This take's video can't be loaded — its link has expired. Shoot the card again on the board.</Text>
            </div>
          )}
          {take && board?.stale && (
            <span title={board.stale} style={{ position: 'absolute', top: 10, left: 10, fontSize: 12, fontWeight: 600, color: '#fff', background: 'rgba(210,95,0,0.92)', borderRadius: 6, padding: '3px 8px' }}>Shot before the last prompt change</span>
          )}
        </div>
        {board?.takes?.length > 1 && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {board.takes.map((t) => {
              const on = t.id === board.chosenTakeId;
              return (
                <button
                  key={t.id} type="button" onClick={() => { if (!on) onCircle(board.cardId, t.id); }} title={on ? 'In the cut' : 'Put this take in the cut'}
                  style={{ position: 'relative', flex: '0 0 auto', width: 112, padding: 0, borderRadius: 8, overflow: 'hidden', cursor: on ? 'default' : 'pointer', background: '#0d1117', border: `3px solid ${on ? GOLD : 'transparent'}` }}
                >
                  {t.posterUrl ? <img src={t.posterUrl} alt={t.label} style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block', opacity: on ? 1 : 0.6 }} /> : <div style={{ aspectRatio: '16 / 9' }} />}
                  <span style={{ position: 'absolute', left: 6, bottom: 3, fontSize: 11, fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>{t.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 12, alignContent: 'start', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: MUTED }}>CARD {card.k + 1}</Text>
          <Text style={{ fontSize: 13, fontWeight: 700, color: over ? '#f53f3f' : MUTED }} title={over ? 'One generation is 30 s at most — start a new card at a later shot' : ''}>{secs ? `${secs} s` : ''}{over ? ' · too long' : ''}</Text>
          <span style={{ flex: 1 }} />
          <Dropdown
            trigger="click" position="br"
            droplist={<Menu onClickMenuItem={(k) => { if (k === 'write') onRewrite(card.start); }}><Menu.Item key="write" disabled={busy || writing}>Write the lines again</Menu.Item></Menu>}
          >
            <Button size="small" type="text" icon={<IconMore />} aria-label="More" style={{ color: MUTED }} />
          </Dropdown>
        </div>

        {!card.opensScene && (needsReopen ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: '#fff7e8', border: '1px solid #ffcf8b' }}>
            {board.carried?.frameUrl && <img src={board.carried.frameUrl} alt="" style={{ width: 72, aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 4 }} />}
            <Text style={{ flex: 1, fontSize: 13 }}>Card {card.k} has a new take. Start this card from its last frame?</Text>
            <Button size="small" type="primary" loading={writing} disabled={busy} onClick={onReopen} style={{ background: '#d25f00', borderColor: '#d25f00' }}>Start from it</Button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {board?.carried?.frameUrl && <img src={board.carried.frameUrl} alt="" style={{ width: 56, aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 4 }} />}
            <Text style={{ fontSize: 13, color: MUTED }}>{board?.carried ? `Starts on the last frame of card ${card.k}` : `Starts where card ${card.k} ends`}</Text>
          </div>
        ))}

        <div style={{ display: 'grid', gap: 2 }}>
          {card.idx.map((i, n) => {
            const x = shots[i];
            const playable = !!take?.url && timed && !failed;
            const live = now === n;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '48px minmax(0, 1fr)', gap: 10, padding: '10px 10px 10px 6px', borderRadius: 10, background: live ? '#f2f7ff' : 'transparent', boxShadow: live ? 'inset 3px 0 0 #165dff' : 'none' }}>
                <button
                  type="button" disabled={!playable} onClick={() => playFrom(n)} title={playable ? 'Play from this shot' : ''}
                  style={{ border: 'none', background: 'transparent', padding: 0, cursor: playable ? 'pointer' : 'default', display: 'grid', justifyItems: 'center', alignContent: 'start', gap: 2, color: INK }}
                >
                  <span style={{ fontFamily: SCRIPT_FONT, fontSize: 18, fontWeight: 700 }}>{pad2(i + 1)}</span>
                  {playable && <span style={{ fontSize: 11, color: '#165dff' }}>▶</span>}
                </button>
                <div role="button" tabIndex={0} onClick={() => onOpen(i)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(i); }} title="Edit this shot" style={{ cursor: 'pointer', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <Text style={{ fontSize: 16, fontWeight: 600, flex: 1, minWidth: 0 }}>{x.title}</Text>
                    <Text style={{ fontSize: 13, color: MUTED, flex: '0 0 auto' }}>{x.seconds ? `${x.seconds} s` : ''}</Text>
                  </div>
                  {x.line
                    ? <Text style={{ fontSize: 14.5, lineHeight: 1.6, color: '#4e5969' }}>{named(x.line)}</Text>
                    : <Text type="secondary" style={{ fontSize: 14.5, fontStyle: 'italic' }}>{busy || writing ? 'Writing…' : x.moment || 'Not written yet'}</Text>}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ paddingLeft: 64 }}>
          {!board
            ? <Text type="secondary" style={{ fontSize: 13 }}>Not on the board yet — Sync to board, top right.</Text>
            : <Button size="large" type={board.takes?.length || rendering ? 'secondary' : 'primary'} onClick={() => onJump?.(board.cardId)}>{board.takes?.length || rendering ? 'Open on the board ↗' : 'Shoot on the board ↗'}</Button>}
        </div>
      </div>
    </div>
  );
};

// THE SHOT LIST — every scene open on one scroll, a rail to jump between them. A scene:
// its place, its blocking, its cards.
export const ShotBoard = ({ shots, assets, cards = [], uncovered = [], scenesKnown = false, busy, working = {}, onOpen, posterOf = () => '', boardCardOf = () => null, onJump, locationName = () => '', onRewriteCard, onBlock, onDrawBlocking, setBlocking, needsReopen = () => false, onReopen, onCircle, secondsOf = () => 0 }) => {
  const groups = cards.reduce((m, c) => { (m[c.scene] = m[c.scene] || []).push(c); return m; }, {});
  const list = Object.keys(groups).map(Number).sort((a, b) => a - b).map((n) => ({ n, cards: groups[n] }));
  const filmed = (c) => !!boardCardOf(c)?.takes?.length;
  const [blockingOf, setBlockingOf] = useState(null); // the scene whose blocking is open
  const [current, setCurrent] = useState(list[0]?.n ?? null);
  const sceneIds = list.map((g) => g.n).join(',');
  useEffect(() => {
    const els = list.map((g) => document.getElementById(`sr-scene-${g.n}`)).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setCurrent(Number(top.target.dataset.scene));
    }, { rootMargin: '-160px 0px -55% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sceneIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const jump = (n) => document.getElementById(`sr-scene-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const total = cards.reduce((k, c) => k + secondsOf(c), 0);
  const length = total >= 60 ? `${Math.floor(total / 60)} min ${pad2(total % 60)} s` : `${total} s`;
  const blockingScene = list.find((g) => g.n === blockingOf);
  const blockingStart = blockingScene ? blockingScene.cards[0].start : null;
  const sceneTitle = (g) => locationName(shots[g.cards[0].start]) || 'Unnamed place';
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <style>{`
        .sr-shots .arco-typography { word-break: normal; overflow-wrap: break-word; }
        .sr-shots { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 28px; align-items: start; }
        .sr-shots.one { grid-template-columns: minmax(0, 1fr); }
        .sr-rail { position: sticky; top: 140px; display: grid; gap: 6px; max-height: calc(100vh - 160px); overflow: auto; }
        .sr-card { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 24px; }
        @media (max-width: 1180px) { .sr-shots { grid-template-columns: minmax(0, 1fr); } .sr-rail { display: none; } }
        @media (max-width: 900px) { .sr-card, .sr-blocking { grid-template-columns: minmax(0, 1fr) !important; } }
      `}</style>
      <Text style={{ fontSize: 15, color: '#4e5969' }}>
        {list.length} scene{list.length === 1 ? '' : 's'} · {shots.length} shot{shots.length === 1 ? '' : 's'}{total ? ` · ${length}` : ''} · <b style={{ color: INK }}>{cards.filter(filmed).length} of {cards.length}</b> card{cards.length === 1 ? '' : 's'} filmed
      </Text>
      {uncovered.length > 0 && (
        <div style={{ display: 'grid', gap: 6, padding: '12px 16px', borderRadius: 12, background: '#fff7e8', border: '1px solid #ffcf8b' }}>
          <Text style={{ fontSize: 14, fontWeight: 600, color: '#b25000' }}>{uncovered.length} story beat{uncovered.length === 1 ? ' is' : 's are'} in no shot — the film won't show {uncovered.length === 1 ? 'it' : 'them'}. Rewrite shots to bring {uncovered.length === 1 ? 'it' : 'them'} in.</Text>
          {uncovered.map((f) => <Text key={f.id} style={{ fontSize: 14, color: '#4e5969' }}>• {f.fact}</Text>)}
        </div>
      )}
      <div className={`sr-shots${list.length > 1 ? '' : ' one'}`}>
        {list.length > 1 && (
          <nav className="sr-rail">
            {list.map((g) => {
              const on = current === g.n;
              const done = g.cards.filter(filmed).length;
              const pic = g.cards.map((c) => boardCardOf(c)?.take?.posterUrl).find(Boolean) || posterOf(g.cards[0]);
              return (
                <button
                  key={g.n} type="button" onClick={() => jump(g.n)}
                  style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', gap: 10, alignItems: 'center', textAlign: 'left', padding: 6, borderRadius: 10, cursor: 'pointer', border: 'none', background: on ? '#e8f3ff' : 'transparent' }}
                >
                  <div style={{ width: 64, aspectRatio: '16 / 9', borderRadius: 5, overflow: 'hidden', background: '#0d1117' }}>
                    {pic ? <img src={pic} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: on ? '#165dff' : INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.n}. {sceneTitle(g)}</div>
                    <div style={{ fontSize: 12, color: done === g.cards.length ? '#00a870' : MUTED }}>{done}/{g.cards.length} filmed</div>
                  </div>
                </button>
              );
            })}
          </nav>
        )}
        <div style={{ display: 'grid', gap: 40, minWidth: 0 }}>
          {list.map((g) => {
            const first = shots[g.cards[0].start];
            const shotCount = g.cards.reduce((k, c) => k + c.idx.length, 0);
            const secs = g.cards.reduce((k, c) => k + secondsOf(c), 0);
            const blocked = !!String(first.blocking || '').trim();
            return (
              <section key={g.n} id={`sr-scene-${g.n}`} data-scene={g.n} style={{ display: 'grid', gap: 14, scrollMarginTop: 150 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }} title={first.sceneReason || ''}>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.4, color: MUTED }}>SCENE {g.n}</div>
                    <div style={{ fontFamily: SCRIPT_FONT, fontSize: 26, fontWeight: 700, lineHeight: 1.25, textTransform: 'uppercase', color: INK }}>{sceneTitle(g)}</div>
                    <Text style={{ fontSize: 13, color: MUTED }}>{shotCount} shot{shotCount === 1 ? '' : 's'}{secs ? ` · ${secs} s` : ''}</Text>
                  </div>
                  {scenesKnown && onBlock && (
                    <Button type={blocked ? 'secondary' : 'primary'} loading={!!working[`block:${g.cards[0].start}`]} onClick={() => setBlockingOf(g.n)}>{blocked ? 'Blocking' : 'Block the scene'}</Button>
                  )}
                </div>
                {g.cards.map((card) => (
                  <CardRow
                    key={`card-${card.start}`} card={card} shots={shots} assets={assets} board={boardCardOf(card)} poster={posterOf(card)} secs={secondsOf(card)}
                    busy={busy} writing={!!working[`card:${card.start}`]} needsReopen={needsReopen(card)} onReopen={() => onReopen(card)}
                    onRewrite={onRewriteCard} onCircle={onCircle} onJump={onJump} onOpen={onOpen}
                  />
                ))}
              </section>
            );
          })}
        </div>
      </div>
      <BlockingModal
        scene={blockingOf} start={blockingStart} shot={blockingStart != null ? shots[blockingStart] : null} assets={assets} busy={busy}
        blocking={!!working[`block:${blockingStart}`]} drawing={!!working[`draw:${blockingStart}`]}
        onBlock={onBlock} onDraw={onDrawBlocking} setBlocking={setBlocking} onClose={() => setBlockingOf(null)}
      />
    </div>
  );
};

// ONE SHOT — its line (what this cut shows), its length, and where it sits: inside the
// card, starting a new card, or opening a new scene. Assets and the card's full prompt
// are one click away.
const PLACEMENT = [
  { value: 'continue', label: 'Continues the card' },
  { value: 'card', label: 'Starts a new card' },
  { value: 'scene', label: 'Starts a new scene' },
];
export const ShotDrawer = ({ index, shot, shots, assets, facts, card, cardPrompt, boardCardOf, onClose, onGoto, setField, toggleBinding, onPlacement }) => {
  const board = card ? boardCardOf(card) : null;
  const starts = card && card.start === index;
  const placement = index === 0 || (starts && card.opensScene) ? 'scene' : starts ? 'card' : 'continue';
  return (
    <Drawer
      width={720}
      visible={index != null && !!shot}
      onCancel={onClose}
      footer={null}
      title={shot ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: 640 }}>
          <span style={{ fontFamily: SCRIPT_FONT, fontSize: 18, fontWeight: 700 }}>{pad2(index + 1)}</span>
          <span style={{ fontSize: 16, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shot.title}</span>
          <Button disabled={index === 0} onClick={() => onGoto(index - 1)}>‹</Button>
          <Button disabled={index >= shots.length - 1} onClick={() => onGoto(index + 1)}>›</Button>
        </div>
      ) : null}
    >
      {shot && (
        <div style={{ display: 'grid', gap: 22 }}>
          {shot.moment && <Text type="secondary" style={{ fontSize: 14 }}>{shot.moment}</Text>}
          <Input.TextArea
            value={shot.line} onChange={(v) => setField(index, 'line', v)} autoSize={{ minRows: 6, maxRows: 16 }}
            style={{ fontSize: 16, lineHeight: 1.7 }}
            placeholder="framing and camera, then what happens — e.g. Medium close-up of {{JINN}} at Opposite Wall: he snaps his fingers…"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <InputNumber min={2} max={10} value={shot.seconds} suffix="s" style={{ width: 96 }} onChange={(v) => setField(index, 'seconds', Math.round(Number(v) || 0) || null)} />
            {index > 0 && (
              <Radio.Group type="button" value={placement} onChange={(v) => onPlacement(index, v)}>
                {PLACEMENT.map((p) => <Radio key={p.value} value={p.value}>{p.label}</Radio>)}
              </Radio.Group>
            )}
          </div>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: MUTED }}>Assets and the full prompt</summary>
            <div style={{ display: 'grid', gap: 14, marginTop: 12 }}>
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
              {shot.shows.length > 0 && (
                <div style={{ display: 'grid', gap: 4 }}>
                  {shot.shows.map((id) => {
                    const f = facts.find((y) => y.id === id);
                    return f ? <Text key={id} style={{ fontSize: 13 }}><b style={{ fontFamily: SCRIPT_FONT }}>{id}</b> {f.fact}</Text> : null;
                  })}
                </div>
              )}
              {card && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, margin: 0, padding: 14, borderRadius: 8, background: '#f7f8fa', color: '#4e5969', fontFamily: 'inherit' }}>{board ? board.prompt : cardPrompt(card)}</pre>}
            </div>
          </details>
        </div>
      )}
    </Drawer>
  );
};
