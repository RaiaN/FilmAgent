import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Input, InputNumber, Menu } from '@arco-design/web-react';
import { IconClose, IconPlus, IconStarFill, IconUpload, IconFile, IconDownload, IconLeft, IconRight, IconLoading, IconMore, IconPlayArrowFill } from '@arco-design/web-react/icon';
import { C, MONO, SCRIPT_FONT, Tile, Empty, Pill, PageHead, DropArea, CanvasButton, crewColor, mediaOf, storeFile, readFile, readText } from './ui';
import { stageLocalAsset } from '../../utils/film/canvasModel';
import { ELEMENT_KINDS, KIND_LABEL, findElement, findScene, pickedOf, plateOf, pad2, shotNumber, newElement, newScene, newShot, uid, staleOf, shotListFresh, visible, addVersion, pickVersion } from '../../utils/film/studio/model';
import { elementsOfShot, needsOfScene } from '../../utils/film/studio/bar';
import { sceneHero, finalsOfShots, toFinish } from '../../utils/film/studio/guide';
import { parseScript } from '../../utils/film/core/scriptForm';

// Text that commits when you leave the field; `live` also commits a moment after you stop typing.
const LIVE_MS = 400;
const Draft = ({ value, onCommit, onLeave, area, live, ...rest }) => {
  const [v, setV] = useState(null);
  const timer = useRef(null);
  const Comp = area ? Input.TextArea : Input;
  const change = (t) => {
    setV(t);
    if (!live) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(t), LIVE_MS);
  };
  return <Comp {...rest} value={v !== null ? v : (value || '')} onChange={change} onFocus={() => setV(value || '')} onBlur={() => { clearTimeout(timer.current); if (v !== null && v !== (value || '')) onCommit(v); if (onLeave) onLeave(v !== null ? v : value); setV(null); }} />;
};
export const UploadButton = ({ onFile, onFiles, accept = 'image/*', children, ...rest }) => {
  const ref = useRef(null);
  return (
    <>
      <input ref={ref} type="file" accept={accept} multiple={!!onFiles} style={{ display: 'none' }} onChange={(e) => { const fs = [...(e.target.files || [])]; if (onFiles && fs.length) onFiles(fs); else if (fs[0]) onFile(fs[0]); e.target.value = ''; }} />
      <Button {...rest} onClick={(e) => { e.stopPropagation(); ref.current?.click(); }}>{children}</Button>
    </>
  );
};
const isImage = (f) => f.type.startsWith('image/');
const isMedia = (f) => f.type.startsWith('image/') || f.type.startsWith('video/');
const isClip = (f) => f.type.startsWith('video/');
const KIND_COLOR = { character: crewColor('casting'), location: crewColor('designer'), prop: '#ffd166' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// A page fills the stage and scrolls in itself.
const PAGE = { height: '100%', overflowY: 'auto', padding: 'clamp(16px, 2.4vw, 32px) clamp(16px, 3vw, 40px) 48px', boxSizing: 'border-box' };

// WORKING: what a crew job is doing now and for how long — "Planning the cast · 0:23".
const clock = (ms) => { const sec = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
export const Working = ({ stage, since }) => {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.work, minWidth: 0 }}>
      <IconLoading style={{ flex: '0 0 auto' }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stage || 'Working'}</span>
      {since ? <span style={{ fontFamily: MONO, color: C.muted, flex: '0 0 auto' }}>{clock(Date.now() - since)}</span> : null}
    </span>
  );
};

// ---- SCRIPT: the screenplay on one side, its shot list on the other --------------------------
const ScriptPage = ({ s, set, toast, setScope, actions }) => {
  const script = String(s.script || '');
  const [importing, setImporting] = useState('');
  const openScript = async (file) => {
    try { const t = await readText(file); write(t); } catch (e) { toast(e.message); }
  };
  const fromFootage = (files) => {
    const sc = newScene('Scene 1');
    set((x) => ({ ...x, scenes: [...x.scenes, sc] }));
    setScope({ type: 'scene', id: sc.id });
    importFootage({ files, sceneId: sc.id, set, toast, onProgress: setImporting });
  };
  const write = (v) => set((x) => ({ ...x, script: v, scriptAt: Date.now() }));
  const screenplay = parseScript(script).form === 'screenplay';
  const fresh = shotListFresh(s) || !s.shotList;
  // Break down and Write take the words on screen, typed a moment ago or not. A film already broken
  // down only offers it again when its script has changed.
  const breakdown = screenplay
    ? <Button size="large" type="primary" loading={actions.busy('Breaking down')} onClick={() => actions.breakdown(script)}>{s.scenes.length ? 'Break down again' : 'Break down into shots'}</Button>
    : <Button size="large" type="primary" disabled={!script.trim()} loading={actions.busy('Writing')} onClick={() => actions.write(script)}>Write the screenplay</Button>;
  const offered = !s.scenes.length || !fresh;
  // An empty film opens on the headline and the script, big; a screenplay is a page.
  if (!screenplay && !s.scenes.length) {
    return (
      <DropArea onFiles={(fs) => openScript(fs[0])} accept={(f) => !isMedia(f)} hint="Drop to open the script" style={{ ...PAGE, display: 'grid', placeItems: 'center' }}>
        <div style={{ width: 'min(1040px, 100%)', display: 'grid', gap: 22 }}>
          <h1 style={{ margin: 0, textAlign: 'center', fontSize: 'clamp(38px, 5.4vw, 74px)', fontWeight: 800, letterSpacing: -2, lineHeight: 1.04, color: C.ink }}>From script to screen</h1>
          <p style={{ margin: 0, textAlign: 'center', fontSize: 19, color: C.text }}>Your shot list, your cast and your takes, in one place.</p>
          <div style={{ background: C.page, border: `1px solid ${C.lineHi}`, borderRadius: 22, padding: '24px 30px' }}>
            <Draft area live className="st-bare" value={script} onCommit={write} autoSize={{ minRows: 5, maxRows: 14 }} placeholder="Your film: an idea, or a screenplay" style={{ fontSize: 22, lineHeight: 1.5, color: C.ink, letterSpacing: -0.2 }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {breakdown}
            <UploadButton size="large" icon={<IconFile />} accept=".txt,.fountain,.md,text/plain" onFile={openScript}>Open a script</UploadButton>
            <UploadButton size="large" icon={<IconUpload />} accept="video/*" loading={!!importing} onFiles={fromFootage}>{importing ? `Importing ${importing}` : 'Start from footage'}</UploadButton>
          </div>
        </div>
      </DropArea>
    );
  }
  const paper = (
    <div style={{ background: C.page, border: `1px solid ${C.line}`, borderRadius: 16, padding: '56px clamp(28px, 8%, 88px)', boxSizing: 'border-box' }}>
      <Draft area live className="st-script" value={script} onCommit={write} autoSize={{ minRows: 12 }} placeholder="Your film: an idea, or a screenplay" />
    </div>
  );
  return (
    <DropArea onFiles={(fs) => openScript(fs[0])} accept={(f) => !isMedia(f)} hint="Drop to open the script" style={PAGE}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gap: 16 }}>
        {offered && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
            {s.scenes.length > 0 && <span style={{ fontSize: 14, color: C.warn }}>The script changed</span>}
            {breakdown}
          </div>
        )}
        {paper}
      </div>
    </DropArea>
  );
};

// ---- CAST & WORLD: everyone and everywhere, as big plates ----------------------------------
const TILE = { character: { min: 240, ratio: '4 / 5', position: 'top' }, location: { min: 400, ratio: '16 / 9', position: 'center' }, prop: { min: 220, ratio: '1', position: 'center' } };
const NameTile = ({ el, s, open }) => {
  const p = pickedOf(el);
  const look = TILE[el.kind] || TILE.prop;
  const running = (el.versions || []).some((v) => v.status === 'running');
  const waiting = (el.versions || []).filter((v) => v.status === 'review').length;
  const views = s.elements.filter((e) => e.viewOf === el.id && pickedOf(e)).length;
  const fresh = waiting ? [...el.versions].reverse().find((v) => v.status === 'review') : null;
  const shown = p || fresh;
  return (
    <div role="button" className="st-tile" onClick={() => open({ type: 'element', id: el.id })} style={{ position: 'relative', cursor: 'pointer', borderRadius: 16, overflow: 'hidden', background: '#0b0c0e', aspectRatio: look.ratio, boxShadow: `inset 0 0 0 1px ${C.line}` }}>
      {shown && mediaOf(shown)
        ? <img src={mediaOf(shown)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: look.position, display: 'block' }} />
        : running && <div className="st-pulse" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: C.work, fontSize: 26, background: C.workSoft }}><IconLoading /></div>}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '46px 16px 14px', background: 'linear-gradient(transparent, rgba(5,6,8,0.88))', display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: -0.2, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{el.name}</span>
        {views > 0 && <span style={{ fontSize: 12.5, color: '#c7cad1', flex: '0 0 auto' }}>{plural(views, 'view')}</span>}
      </div>
      {waiting > 0 && <Pill color={C.accentInk} bg={C.warn} style={{ position: 'absolute', top: 12, right: 12, fontWeight: 700, fontSize: 12.5, padding: '3px 10px' }}>{waiting > 1 ? `${waiting} new` : 'New'}</Pill>}
    </div>
  );
};
const WorldPage = ({ s, set, open, toast, actions }) => {
  const [adding, setAdding] = useState(null);
  const withPlate = async (el, file) => {
    const url = await storeFile(file);
    const vid = uid('v-');
    return { ...el, versions: [{ id: vid, at: Date.now(), by: 'you', kind: 'plate', status: 'picked', url, cacheUrl: url }], picked: vid };
  };
  const add = async (file) => {
    const name = String(adding.name || '').trim();
    if (!name) { toast('Name it first.'); return; }
    let el = newElement({ kind: adding.kind, name });
    if (file) { try { el = await withPlate(el, file); } catch (e) { toast(e.message); return; } }
    set((x) => ({ ...x, elements: [...x.elements, el] }));
    setAdding(null);
  };
  // Dropped images become elements of that section, named after their files.
  const dropped = async (files, k = 'character') => {
    for (const f of files) {
      try { const el = await withPlate(newElement({ kind: k, name: f.name.replace(/\.[^.]+$/, '') }), f); set((x) => ({ ...x, elements: [...x.elements, el] })); } catch (e) { toast(`${f.name}: ${e.message}`); } // eslint-disable-line no-await-in-loop
    }
  };
  const missing = s.elements.filter((e) => !e.viewOf && !plateOf(e) && !(e.versions || []).some((v) => v.status === 'running')).map((e) => e.name);
  return (
    <div style={PAGE}>
      <div style={{ display: 'grid', gap: 44 }}>
        {missing.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 14, background: C.raised, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 200, fontSize: 15, color: C.ink }}>Waiting for a plate: {missing.join(', ')}</span>
            <Button size="large" type="primary" loading={actions.busy('Casting')} onClick={() => actions.cast(missing)}>Generate {missing.length} plate{missing.length === 1 ? '' : 's'}</Button>
          </div>
        )}
        {ELEMENT_KINDS.map((k) => {
          const list = s.elements.filter((e) => e.kind === k && !e.viewOf);
          return (
            <DropArea key={k} onFiles={(fs) => dropped(fs, k)} accept={isImage} hint={`Drop to add to ${KIND_LABEL[k]}`}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: C.ink, letterSpacing: -0.4 }}>{KIND_LABEL[k]}</span>
                {list.length > 0 && <span style={{ fontSize: 15, color: C.muted, fontFamily: MONO }}>{list.length}</span>}
                <span role="button" className="st-chip" title={`Add to ${KIND_LABEL[k]}`} aria-label={`Add to ${KIND_LABEL[k]}`} onClick={() => setAdding({ kind: k, name: '' })} style={{ alignSelf: 'center', cursor: 'pointer', width: 30, height: 30, borderRadius: 9, border: `1px solid ${C.line}`, display: 'grid', placeItems: 'center', color: C.text }}><IconPlus /></span>
              </div>
              {adding?.kind === k && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, border: `1px solid ${C.accent}`, background: C.raised, borderRadius: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                  <Input autoFocus placeholder="Name" size="large" value={adding.name} onChange={(v) => setAdding({ ...adding, name: v })} style={{ flex: '1 1 200px' }} />
                  <UploadButton size="large" type="primary" icon={<IconUpload />} onFile={add}>With an image</UploadButton>
                  <Button size="large" onClick={() => add(null)}>Without</Button>
                  <Button size="large" type="text" icon={<IconClose />} onClick={() => setAdding(null)} aria-label="Cancel" />
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${TILE[k].min}px, 1fr))`, gap: 18 }}>
                {list.map((el) => <NameTile key={el.id} el={el} s={s} open={open} />)}
              </div>
            </DropArea>
          );
        })}
      </div>
    </div>
  );
};

const ElementPage = ({ s, set, el, pick, review, toast, open, canvas, actions }) => {
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState('');
  const [count, setCount] = useState(2);
  const versions = (el.versions || []).filter((v) => visible(v) && v.status !== 'rejected');
  const upload = async (files) => {
    setBusy(true);
    try {
      for (const file of files) {
        const url = await storeFile(file); // eslint-disable-line no-await-in-loop
        const vid = uid('v-');
        set((x) => ({ ...x, elements: x.elements.map((e) => (e.id !== el.id ? e : { ...e, versions: [...e.versions, { id: vid, at: Date.now(), by: 'you', kind: 'plate', status: 'review', url, cacheUrl: url }] })) }));
        pick({ at: 'element', id: el.id }, vid);
      }
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const p = pickedOf(el);
  const hero = p || [...versions].reverse().find((v) => v.status === 'review') || null;
  const patch = (fields) => set((x) => ({ ...x, elements: x.elements.map((e) => (e.id === el.id ? { ...e, ...fields } : e)) }));
  const views = s.elements.filter((e) => e.viewOf === el.id);
  const base = el.viewOf ? findElement(s, el.viewOf) : null;
  const back = base ? { type: 'element', id: base.id } : { type: 'world' };
  return (
    <DropArea onFiles={upload} accept={isImage} hint="Drop to add a version" style={PAGE}>
      <PageHead right={canvas && p ? <CanvasButton size={36} onClick={() => canvas.element(el)} /> : null}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span role="button" className="st-chip" title={base ? base.name : 'Cast & World'} aria-label="Back" onClick={() => open(back)} style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', border: `1px solid ${C.line}`, color: C.text, cursor: 'pointer', flex: '0 0 auto' }}><IconLeft /></span>
          <Draft className="st-bare" value={el.name} onCommit={(v) => patch({ name: v })} style={{ fontSize: 30, fontWeight: 700, padding: '0 4px', color: C.ink, height: 44, letterSpacing: -0.6 }} />
        </div>
      </PageHead>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 32, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 18, minWidth: 0 }}>
          <div style={{ borderRadius: 18, overflow: 'hidden', background: '#0b0c0e', border: `1px solid ${C.line}`, display: 'grid', placeItems: 'center', minHeight: 320 }}>
            {hero && mediaOf(hero)
              ? <img role="button" src={mediaOf(hero)} alt="" onClick={() => review({ at: 'element', id: el.id }, hero.id)} style={{ width: '100%', maxHeight: 'calc(100vh - 340px)', objectFit: 'contain', cursor: 'zoom-in', display: 'block' }} />
              : <UploadButton size="large" icon={<IconUpload />} loading={busy} onFiles={upload}>Your image</UploadButton>}
          </div>
          {versions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              {versions.map((v) => <Tile key={v.id} v={v} w={el.kind === 'location' ? 200 : 132} ratio={el.kind === 'location' ? '16 / 9' : '1'} picked={el.picked === v.id} badge={v.status === 'review' ? 'NEW' : null} onClick={v.status !== 'running' ? () => review({ at: 'element', id: el.id }, v.id) : undefined} title="Open" />)}
              {hero && <UploadButton size="large" type="text" icon={<IconUpload />} loading={busy} onFiles={upload} aria-label="Your image" title="Your image" />}
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gap: 20, minWidth: 0 }}>
          <Draft area value={el.desc} onCommit={(v) => patch({ desc: v })} autoSize={{ minRows: 5, maxRows: 14 }} placeholder="Who or what this is" style={{ fontSize: 15, lineHeight: 1.6 }} />
          {!el.viewOf && (
            <div style={{ display: 'grid', gap: 10, padding: 14, borderRadius: 14, background: C.raised }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{el.kind === 'location' ? 'Background plates' : el.kind === 'character' ? 'Looks' : 'Variations'}</span>
              <Input.TextArea value={direction} onChange={setDirection} autoSize={{ minRows: 2, maxRows: 6 }} placeholder={el.kind === 'location' ? 'What differs: other camera positions, dusk, rain' : 'What differs: another costume, older'} style={{ fontSize: 14.5 }} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <InputNumber aria-label="How many" min={1} max={8} value={count} onChange={(v) => setCount(v || 1)} style={{ width: 84 }} />
                <Button type="primary" style={{ flex: 1 }} disabled={!plateOf(el) && !el.desc && !direction.trim()} loading={actions.busy('Drawing')} onClick={() => { actions.variations(el, direction, count); setDirection(''); }}>Generate {count}</Button>
              </div>
            </div>
          )}
          {views.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {views.map((vw) => {
                const pv = pickedOf(vw);
                return (
                  <div key={vw.id} role="button" className="st-tile" title={vw.name} onClick={() => open({ type: 'element', id: vw.id })} style={{ aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', background: '#0b0c0e', cursor: 'pointer', boxShadow: `inset 0 0 0 1px ${C.line}` }}>
                    {pv && <img src={mediaOf(pv)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DropArea>
  );
};

// ---- SCENES: every scene as a big picture ------------------------------------------------------
const facesOf = (s, shots) => [...new Set(shots.flatMap((sh) => sh.elementIds || []))].map((id) => findElement(s, id)).filter((el) => el && el.kind === 'character' && !el.viewOf);
const Face = ({ el, size = 34 }) => {
  const p = pickedOf(el);
  return (
    <span title={el.name} style={{ width: size, height: size, flex: '0 0 auto', borderRadius: '50%', overflow: 'hidden', background: C.raised, display: 'inline-grid', placeItems: 'center', boxShadow: `0 0 0 2px ${p ? C.bg : C.warn}`, fontSize: size * 0.4, fontWeight: 700, color: C.muted }}>
      {p ? <img src={mediaOf(p)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }} /> : el.name.slice(0, 1)}
    </span>
  );
};
const SceneCard = ({ s, sc, i, open }) => {
  const hero = sceneHero(s, sc);
  const takes = sc.shots.flatMap((sh) => sh.takes.versions || []);
  const working = takes.some((v) => v.status === 'running') || (sc.blocking?.versions || []).some((v) => v.status === 'running');
  const fresh = takes.filter((v) => v.status === 'review').length;
  const circled = sc.shots.length > 0 && sc.shots.every((sh) => sh.takes?.picked);
  const faces = facesOf(s, sc.shots);
  return (
    <div role="button" className="st-tile" onClick={() => open({ type: 'scene', id: sc.id })} style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: 16, overflow: 'hidden', background: '#0b0c0e', cursor: 'pointer', boxShadow: circled ? `0 0 0 2px ${C.gold}` : `inset 0 0 0 1px ${C.line}` }}>
      {hero && (hero.kind === 'take' ? <Tile v={hero} w="100%" /> : <img src={mediaOf(hero)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.72 }} />)}
      <span style={{ position: 'absolute', left: 14, top: 10, fontFamily: MONO, fontSize: 26, fontWeight: 700, color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.75)' }}>{pad2(i + 1)}</span>
      <span style={{ position: 'absolute', right: 12, top: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
        {working && <span className="st-pulse" style={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', background: C.workSoft, color: C.work }}><IconLoading /></span>}
        {fresh > 0 && <Pill color={C.accentInk} bg={C.warn} style={{ fontWeight: 700, fontSize: 12.5, padding: '3px 10px' }}>{fresh} new</Pill>}
        {circled && <span style={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(8,9,11,0.7)', color: C.gold }}><IconStarFill /></span>}
      </span>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '48px 16px 14px', background: 'linear-gradient(transparent, rgba(5,6,8,0.9))', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: -0.2, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sc.title}</span>
        <span style={{ display: 'flex', flex: '0 0 auto' }}>{faces.slice(0, 4).map((el, k) => <span key={el.id} style={{ marginLeft: k ? -8 : 0 }}><Face el={el} size={30} /></span>)}</span>
      </div>
    </div>
  );
};
const ScenesPage = ({ s, set, open, toast }) => {
  const [importing, setImporting] = useState('');
  const newOne = () => { const sc = newScene(`Scene ${s.scenes.length + 1}`); set((x) => ({ ...x, scenes: [...x.scenes, sc] })); return sc; };
  const importFiles = (files) => {
    const sc = newOne();
    open({ type: 'scene', id: sc.id });
    importFootage({ files, sceneId: sc.id, set, toast, onProgress: setImporting });
  };
  return (
    <DropArea onFiles={importFiles} accept={isClip} hint="Drop your footage" style={PAGE}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 20 }}>
        {s.scenes.map((sc, i) => <SceneCard key={sc.id} s={s} sc={sc} i={i} open={open} />)}
        <div style={{ aspectRatio: '16 / 9', border: `1px dashed ${C.lineHi}`, borderRadius: 16, display: 'grid', placeItems: 'center', alignContent: 'center', gap: 12 }}>
          <UploadButton size="large" type="primary" icon={<IconUpload />} accept="video/*" loading={!!importing} onFiles={importFiles}>{importing ? `Importing ${importing}` : 'Import footage'}</UploadButton>
          <Button size="large" icon={<IconPlus />} onClick={() => open({ type: 'scene', id: newOne().id })}>New scene</Button>
        </div>
      </div>
    </DropArea>
  );
};

// A clip's length, read from the file itself.
const durationOf = (file) => new Promise((res) => {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.onloadedmetadata = () => { res(Number(v.duration) || 0); URL.revokeObjectURL(url); };
  v.onerror = () => { res(0); URL.revokeObjectURL(url); };
  v.src = url;
});
const posterOf = async (url) => {
  try {
    const r = await fetch('/api/film/frames', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, timestamps: [0.5], maxWidth: 480 }) });
    const j = await r.json();
    return j.frames?.[0]?.url || '';
  } catch { return ''; }
};

// YOUR FOOTAGE: each clip is a circled take (registered as an asset, so VFX can edit it) — of the
// shot you dropped it on, or of a new shot of the scene.
export const importFootage = async ({ files, sceneId, shotId = null, set, toast, onProgress = () => {} }) => {
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    onProgress(`${i + 1} / ${files.length}`);
    try {
      if (!f.type.startsWith('video/')) throw new Error('is not a video — footage is clips.');
      const seconds = Math.round((await durationOf(f)) * 10) / 10; // eslint-disable-line no-await-in-loop
      const up = await stageLocalAsset(await readFile(f), f.name); // eslint-disable-line no-await-in-loop
      const url = up.cacheUrl || up.url;
      const vid = uid('v-');
      const version = {
        id: vid, at: Date.now(), by: 'you', kind: 'take', status: 'picked', footage: true,
        url, cacheUrl: url, assetId: up.assetId || null, seconds: seconds || null, res: 'source',
        posterUrl: await posterOf(url), // eslint-disable-line no-await-in-loop
        flags: up.assetError ? [{ warn: true, text: `Not registered as an asset: ${up.assetError}` }] : [],
      };
      if (shotId) {
        const ref = { at: 'take', sceneId, shotId };
        set((x) => pickVersion(addVersion(x, ref, version), ref, vid));
      } else {
        const shot = newShot({ title: f.name.replace(/\.[^.]+$/, ''), seconds: Math.round(seconds) || 8 });
        shot.takes = { versions: [version], picked: vid };
        set((x) => ({ ...x, scenes: x.scenes.map((sc) => (sc.id === sceneId ? { ...sc, shots: [...sc.shots, shot] } : sc)) }));
      }
    } catch (e) { toast(`${f.name}: ${e.message}`); }
  }
  onProgress('');
};

const takeBadge = (v) => (v.status === 'running' ? null : v.status === 'review' ? 'NEW' : v.footage ? 'YOURS' : v.edit ? 'VFX' : v.res === '4K' ? '4K' : v.res === '1080p' ? 'HD' : v.res === '480p' ? 'DRAFT' : null);

// ONE SHOT: the monitor with its takes on one side; its cast and its beats, each on the picture of
// its view, on the other. A clip dropped on the monitor is a take of this shot.
const ShotBlock = ({ s, set, scene, sh, on, select, patchShot, removeShot, review, toast, onStale, single, actions }) => {
  const [importing, setImporting] = useState('');
  const take = pickedOf(sh.takes);
  const takes = (sh.takes.versions || []).filter((v) => visible(v) && v.status !== 'rejected');
  const fresh = takes.filter((v) => v.status === 'review');
  const hero = take || fresh[fresh.length - 1] || takes.find((v) => v.status === 'running') || null;
  const stale = staleOf(s, sh);
  const n = shotNumber(s, sh.id);
  const ref = { at: 'take', sceneId: scene.id, shotId: sh.id };
  const importHere = (files) => importFootage({ files, sceneId: scene.id, shotId: sh.id, set, toast, onProgress: setImporting });
  const plates = elementsOfShot(s, sh);
  return (
    <div role={single ? undefined : 'button'} onClick={single ? undefined : () => select(on ? null : sh.id)} style={single ? { display: 'grid', gap: 10 } : { display: 'grid', gap: 10, padding: 14, borderRadius: 18, cursor: 'pointer', border: `1px solid ${on ? C.accent : C.line}`, background: on ? '#1b1815' : C.panel, boxShadow: on ? `0 0 0 3px ${C.accentSoft}` : 'none' }}>
      {/* A scene's only shot goes by the scene's number and name, on the page above. */}
      {!single && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 32 }}>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 16, color: C.accent }}>{pad2(n)}</span>
          {on
            ? <span onClick={(e) => e.stopPropagation()} style={{ flex: 1, minWidth: 120 }}><Draft value={sh.title} onCommit={(v) => patchShot(sh.id, { title: v })} style={{ fontSize: 16, fontWeight: 600 }} /></span>
            : <span style={{ fontSize: 16, fontWeight: 600, flex: 1, minWidth: 0, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sh.title}</span>}
          {on && <span onClick={(e) => e.stopPropagation()}><Button status="danger" type="text" onClick={() => { removeShot(sh.id); select(null); }}>Remove shot</Button></span>}
        </div>
      )}
      {stale.length > 0 && (
        <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', background: C.warnSoft, borderRadius: 10, fontSize: 13.5, color: C.warn }}>
          <span style={{ flex: 1, minWidth: 0 }}>Made with an earlier {stale.join(', ')}</span>
          <Button size="small" onClick={() => onStale.redo(scene.id, sh.id)}>Shoot again</Button>
          <Button size="small" type="text" onClick={() => onStale.keep(scene.id, sh.id)}>Keep</Button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: plates.length ? 'minmax(0, 1fr) 124px' : 'minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
        <DropArea onFiles={importHere} accept={isClip} hint="Drop your performance" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, min(100%, calc(max(240px, 100vh - 420px) * 16 / 9)))', justifyContent: 'center', gap: 10, alignContent: 'start', minWidth: 0 }}>
          {hero
            ? <Tile big v={hero} w="100%" badge={takeBadge(hero)} onClick={hero.status === 'running' ? undefined : (e) => { e.stopPropagation(); review(ref, hero.id); }} />
            : (
              <div style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 14, background: '#08090b', boxShadow: `inset 0 0 0 1px ${C.line}`, display: 'grid', placeItems: 'center', alignContent: 'center', gap: 6 }}>
                <span style={{ fontFamily: MONO, fontSize: 56, fontWeight: 700, color: '#2c3038' }}>{pad2(n)}</span>
                <span style={{ fontSize: 14, color: importing ? C.work : C.muted }}>{importing ? `Importing ${importing}` : 'No take yet'}</span>
              </div>
            )}
          {takes.length > 0 && (
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, paddingTop: 2, paddingLeft: 2 }} onClick={(e) => e.stopPropagation()}>
              {takes.map((v) => <Tile key={v.id} v={v} w={148} badge={takeBadge(v)} picked={sh.takes.picked === v.id} onClick={v.status !== 'running' ? () => review(ref, v.id) : undefined} />)}
            </div>
          )}
        </DropArea>
        {plates.length > 0 && (
          <div role="button" aria-label="Open this shot's references in the bar" title="Open in the bar" className="st-chip" onClick={(e) => { e.stopPropagation(); if (!on) select(sh.id); actions.openBar(); }} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 6, borderRadius: 12, border: '1px solid transparent', maxHeight: 'max(340px, 100vh - 320px)', overflowY: 'auto' }}>
            {plates.map((el) => {
              const p = plateOf(el);
              return (
                <div key={el.id} title={el.name} style={{ flex: '0 0 auto', width: '100%', aspectRatio: el.kind === 'location' ? '16 / 9' : '1', borderRadius: 8, overflow: 'hidden', background: '#0b0c0e', boxShadow: p ? `inset 0 0 0 1px ${C.line}` : `inset 0 0 0 1px ${C.warn}`, display: 'grid', placeItems: 'center', padding: p ? 0 : 6, fontSize: 11, lineHeight: 1.25, color: C.muted, textAlign: 'center' }}>
                  {p ? <img src={mediaOf(p)} alt={el.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: el.kind === 'character' ? 'top' : 'center', display: 'block' }} /> : el.name.split(' · ').pop()}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// PLAY SCENE: the circled takes in order. A shot with no circled take holds as a card for its length.
const PlayScene = ({ s, scene, onClose }) => {
  const [i, setI] = useState(0);
  const sh = scene.shots[i];
  const take = sh ? pickedOf(sh.takes) : null;
  const next = () => (i + 1 < scene.shots.length ? setI(i + 1) : onClose());
  useEffect(() => {
    if (!sh || take) return undefined;
    const t = setTimeout(next, Math.max(1, Number(sh.seconds) || 1) * 1000);
    return () => clearTimeout(t);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sh) return null;
  return (
    <div role="dialog" aria-label="Play scene" onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 20, background: '#000', display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ minHeight: 0, display: 'grid', placeItems: 'center' }}>
        {take
          ? <video key={take.id} src={mediaOf(take)} autoPlay controls onEnded={next} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
          : <span style={{ fontSize: 28, color: C.text, textAlign: 'center', padding: 40 }}>{pad2(shotNumber(s, sh.id))} · {sh.title}<br /><span style={{ fontSize: 16, color: C.muted }}>No circled take</span></span>}
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 18px', background: C.panel }}>
        <span style={{ fontFamily: MONO, color: C.accent }}>{pad2(shotNumber(s, sh.id))}</span>
        <span style={{ flex: 1, color: C.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sh.title}</span>
        <span style={{ fontFamily: MONO, color: C.muted }}>{i + 1}/{scene.shots.length}</span>
        <Button type="text" icon={<IconClose />} aria-label="Close" onClick={onClose} />
      </div>
    </div>
  );
};

const ScenePage = ({ s, set, scene, scope, selectShot, open, review, toast, canvas, actions, onStale }) => {
  const [importing, setImporting] = useState('');
  const [script, setScript] = useState(false);
  const [playing, setPlaying] = useState(false);
  const footage = useRef(null);
  const needs = needsOfScene(s, scene);
  const blockings = scene.blocking?.versions || [];
  const blockRunning = blockings.some((v) => v.status === 'running');
  const patchShot = (id, patch) => set((x) => ({ ...x, scenes: x.scenes.map((sc) => (sc.id !== scene.id ? sc : { ...sc, shots: sc.shots.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh)) })) }));
  const addShots = (shots) => set((x) => ({ ...x, scenes: x.scenes.map((sc) => (sc.id === scene.id ? { ...sc, shots: [...sc.shots, ...shots] } : sc)) }));
  const removeShot = (id) => set((x) => ({ ...x, scenes: x.scenes.map((sc) => (sc.id !== scene.id ? sc : { ...sc, shots: sc.shots.filter((sh) => sh.id !== id) })) }));
  const importFiles = (files) => importFootage({ files, sceneId: scene.id, set, toast, onProgress: setImporting });
  // Circled drafts that can still finish and have not (MOV, the same picture), at the resolutions
  // every one of their models offers.
  const finishing = toFinish(scene);
  const finalRes = finalsOfShots(finishing);
  const addShot = () => { const sh = newShot({ title: 'New shot' }); addShots([sh]); selectShot(sh.id); };
  const i = s.scenes.findIndex((x) => x.id === scene.id);
  const step = (d) => s.scenes[i + d] && open({ type: 'scene', id: s.scenes[i + d].id });
  const nav = (disabled) => ({ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', border: `1px solid ${C.line}`, color: disabled ? C.lineHi : C.text, cursor: disabled ? 'default' : 'pointer', flex: '0 0 auto' });
  return (
    <DropArea onFiles={importFiles} accept={isMedia} hint="Drop your footage" style={PAGE}>
      <PageHead
        right={(
          <>
            {(needs.names.length > 0 || needs.views > 0) && <Button size="large" type="primary" loading={actions.busy('Casting') || actions.busy('Drawing')} onClick={() => actions.generateMissing(scene)}>Generate missing · {needs.names.length + needs.views}</Button>}
            {scene.shots.some((sh) => pickedOf(sh.takes)) && <Button size="large" icon={<IconPlayArrowFill />} onClick={() => setPlaying(true)}>Play scene</Button>}
            {finishing.length > 0 && finalRes.map((res) => <Button key={res} size="large" onClick={() => actions.finalScene(finishing, res)}>Final · {res}</Button>)}
            <input ref={footage} type="file" accept="video/*" multiple hidden onChange={(e) => { const fs = [...(e.target.files || [])]; if (fs.length) importFiles(fs); e.target.value = ''; }} />
            <Dropdown trigger="click" position="br" droplist={(
              <Menu onClickMenuItem={(k) => { if (k === 'shot') addShot(); if (k === 'script') setScript((o) => !o); if (k === 'footage') footage.current?.click(); if (k === 'canvas') canvas.scene(scene.id); if (k === 'remove') { removeShot(scene.shots[0].id); selectShot(null); } }}>
                <Menu.Item key="shot">Add a shot</Menu.Item>
                {scene.text && <Menu.Item key="script">{script ? 'Hide the script' : "Show the scene's script"}</Menu.Item>}
                <Menu.Item key="footage">{importing ? `Importing ${importing}` : 'Import footage'}</Menu.Item>
                {canvas && scene.shots.length > 0 && <Menu.Item key="canvas">Open in Canvas</Menu.Item>}
                {scene.shots.length === 1 && <Menu.Item key="remove">Remove the shot</Menu.Item>}
              </Menu>
            )}><Button size="large" icon={<IconMore />} aria-label="More" /></Dropdown>
          </>
        )}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span role="button" className="st-chip" title="All scenes" aria-label="All scenes" onClick={() => open({ type: 'scenes' })} style={nav(false)}><IconLeft /></span>
          <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, color: C.accent, padding: '0 6px', flex: '0 0 auto' }}>{pad2(i + 1)}</span>
          <Draft className="st-bare" value={scene.title} onCommit={(v) => set((x) => ({ ...x, scenes: x.scenes.map((sc) => (sc.id === scene.id ? { ...sc, title: v } : sc)) }))} style={{ fontSize: 28, fontWeight: 700, padding: '0 4px', color: C.ink, height: 44, letterSpacing: -0.5 }} />
          <span role="button" className={i > 0 ? 'st-chip' : undefined} title="Previous scene" aria-label="Previous scene" onClick={() => step(-1)} style={nav(i <= 0)}><IconLeft /></span>
          <span role="button" className={i < s.scenes.length - 1 ? 'st-chip' : undefined} title="Next scene" aria-label="Next scene" onClick={() => step(1)} style={nav(i >= s.scenes.length - 1)}><IconRight /></span>
        </div>
      </PageHead>
      {script && scene.text && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: SCRIPT_FONT, fontSize: 14.5, lineHeight: 1.7, margin: '0 0 22px', padding: '24px 32px', color: '#e9e4da', background: C.page, border: `1px solid ${C.line}`, borderRadius: 14 }}>{scene.text}</pre>}
      {blockRunning && <div style={{ marginBottom: 16 }}><Working stage="Planning the shots" /></div>}
      {!scene.shots.length && !blockRunning && (
        <div style={{ border: `1px dashed ${C.lineHi}`, borderRadius: 18, aspectRatio: '21 / 9', display: 'grid', placeItems: 'center', alignContent: 'center', gap: 16 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <UploadButton size="large" type="primary" icon={<IconUpload />} accept="video/*" loading={!!importing} onFiles={importFiles}>Import footage</UploadButton>
            <Button size="large" onClick={addShot}>Write a shot</Button>
          </div>
        </div>
      )}
      {playing && <PlayScene s={s} scene={scene} onClose={() => setPlaying(false)} />}
      <div style={{ display: 'grid', gap: 18 }}>
        {scene.shots.map((sh) => <ShotBlock key={sh.id} s={s} set={set} scene={scene} sh={sh} on={scope.type === 'shot' && scope.id === sh.id} select={selectShot} patchShot={patchShot} removeShot={removeShot} review={review} toast={toast} onStale={onStale} single={scene.shots.length === 1} actions={actions} />)}
      </div>
    </DropArea>
  );
};

// ---- CUT: the film, big, over its timeline -----------------------------------------------------
const CutPage = ({ s, review, selectScene, actions }) => {
  const cut = pickedOf(s.cut) || [...(s.cut.versions || [])].reverse().find((v) => v.status === 'review' || v.status === 'running');
  const scenes = s.scenes.filter((sc) => sc.shots.length);
  const secondsOf = (sc) => sc.shots.reduce((n, sh) => n + Math.max(1, Number(sh.seconds) || 1), 0);
  const ready = cut && cut.status !== 'running' && mediaOf(cut);
  const shots = s.scenes.flatMap((sc) => sc.shots);
  const circled = shots.filter((sh) => pickedOf(sh.takes)).length;
  return (
    <div style={{ ...PAGE, display: 'grid', gap: 24, alignContent: 'start' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
        <span style={{ fontFamily: MONO, fontSize: 14, color: C.muted }}>{circled}/{shots.length} circled</span>
        <Button size="large" type="primary" disabled={!circled} loading={actions.busy('Assembling')} onClick={() => actions.assemble(circled < shots.length)}>Assemble</Button>
      </div>
      <div style={{ position: 'relative' }}>
        {ready
          ? <video key={mediaOf(cut)} src={mediaOf(cut)} poster={cut.posterUrl || undefined} controls style={{ width: '100%', maxHeight: 'calc(100vh - 340px)', background: '#000', borderRadius: 18, display: 'block' }} />
          : <div style={{ aspectRatio: '16 / 9', maxHeight: 'calc(100vh - 340px)', width: '100%', background: '#050607', border: `1px solid ${C.line}`, borderRadius: 18, display: 'grid', placeItems: 'center', color: cut?.status === 'running' ? C.work : '#2c3038', fontSize: 44 }}><span className={cut?.status === 'running' ? 'st-pulse' : undefined}>{cut?.status === 'running' ? <IconLoading /> : <IconPlayArrowFill />}</span></div>}
        {ready && (
          <div style={{ position: 'absolute', top: 14, right: 14, display: 'flex', gap: 8 }}>
            {cut.status === 'review' && <Button type="primary" size="large" onClick={() => review({ at: 'cut' }, cut.id)}>New cut</Button>}
            <Button size="large" icon={<IconDownload />} href={mediaOf(cut)} download>{cut.format === 'mov' ? 'MOV' : 'MP4'}</Button>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
        {scenes.map((sc) => (
          <div key={sc.id} style={{ flex: `${secondsOf(sc)} 1 0`, minWidth: 0, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 3 }}>
              {sc.shots.map((sh) => {
                const t = pickedOf(sh.takes);
                const label = `${pad2(shotNumber(s, sh.id))} ${sh.title}`;
                const box = { flex: `${Math.max(1, Number(sh.seconds) || 1)} 1 0`, minWidth: 56, height: 104, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', position: 'relative' };
                return t ? (
                  <div key={sh.id} role="button" title={label} onClick={() => review({ at: 'take', sceneId: sc.id, shotId: sh.id }, t.id)} style={{ ...box, background: '#08090b', boxShadow: `inset 0 0 0 1px ${C.line}` }}>
                    {t.posterUrl ? <img src={t.posterUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <video src={mediaOf(t)} preload="metadata" muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                    <span style={{ position: 'absolute', left: 8, bottom: 6, fontFamily: MONO, fontSize: 13, fontWeight: 700, color: '#fff', textShadow: '0 1px 3px #000' }}>{pad2(shotNumber(s, sh.id))}</span>
                  </div>
                ) : (
                  <div key={sh.id} role="button" title={label} onClick={() => selectScene(sc.id, sh.id)} style={{ ...box, border: `1px dashed ${C.lineHi}`, display: 'grid', placeItems: 'center', fontFamily: MONO, fontSize: 14, color: C.muted, boxSizing: 'border-box' }}>{pad2(shotNumber(s, sh.id))}</div>
                );
              })}
            </div>
            <div style={{ fontSize: 13.5, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 2 }}>{sc.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const DirectPage = ({ s, set, scope, setScope, pick, review, toast, actions, canvas, onStale }) => {
  if (scope.type === 'brief') return <ScriptPage s={s} set={set} toast={toast} setScope={setScope} actions={actions} />;
  if (scope.type === 'world') return <WorldPage s={s} set={set} open={setScope} toast={toast} actions={actions} />;
  if (scope.type === 'element') {
    const el = findElement(s, scope.id);
    return el ? <ElementPage s={s} set={set} el={el} pick={pick} review={review} toast={toast} open={setScope} canvas={canvas} actions={actions} /> : <Empty>Gone.</Empty>;
  }
  if (scope.type === 'scenes') return <ScenesPage s={s} set={set} open={setScope} toast={toast} />;
  if (scope.type === 'scene' || scope.type === 'shot') {
    const sceneId = scope.type === 'scene' ? scope.id : scope.sceneId;
    const scene = findScene(s, sceneId);
    if (!scene) return <Empty>Gone.</Empty>;
    return <ScenePage s={s} set={set} scene={scene} scope={scope} open={setScope} selectShot={(id) => setScope(id ? { type: 'shot', sceneId, id } : { type: 'scene', id: sceneId })} review={review} toast={toast} canvas={canvas} actions={actions} onStale={onStale} />;
  }
  if (scope.type === 'cut') return <CutPage s={s} review={review} selectScene={(sceneId, id) => setScope({ type: 'shot', sceneId, id })} actions={actions} />;
  return null;
};
