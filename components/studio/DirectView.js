import { useEffect, useRef, useState } from 'react';
import { Button, Input, Select } from '@arco-design/web-react';
import { IconClose, IconPlus, IconStarFill, IconUpload, IconSend, IconFile, IconDownload, IconLeft, IconRight, IconLoading, IconPlayArrowFill } from '@arco-design/web-react/icon';
import { C, MONO, SCRIPT_FONT, Tile, Empty, Pill, Avatar, PageHead, DropArea, CanvasButton, crewColor, crewWho, mediaOf, storeFile, readFile, readText } from './ui';
import { stageLocalAsset } from '../../utils/film/canvasModel';
import { ELEMENT_KINDS, KIND_LABEL, VIDEO_MODELS, videoModelLabel, containerOf, findElement, findScene, findShot, namedText, tokenized, pickedOf, pad2, shotNumber, threadKeyOf, newElement, newScene, newShot, uid, staleOf, shotListFresh, visible, addVersion, pickVersion } from '../../utils/film/studio/model';
import { actionsFor, crewById, parseRequest, talkerFor } from '../../utils/film/studio/crew';
import { sceneHero, viewsOfShot, finalsOfShots, toFinish } from '../../utils/film/studio/guide';
import { parseScript } from '../../utils/film/core/scriptForm';
import { shotsOf } from '../../utils/film/core/shotList';
import { sceneMotion } from '../../utils/film/core/storyboard';
import { ShotList } from './ShotList';

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
const PAGE = { height: '100%', overflowY: 'auto', padding: '32px 40px 72px', boxSizing: 'border-box' };

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
const ScriptPage = ({ s, set, toast, setScope }) => {
  const script = String(s.script || '');
  const [importing, setImporting] = useState('');
  const openScript = async (file) => {
    try { const t = await readText(file); set((x) => ({ ...x, script: t })); } catch (e) { toast(e.message); }
  };
  const fromFootage = (files) => {
    const sc = newScene('Scene 1');
    set((x) => ({ ...x, scenes: [...x.scenes, sc] }));
    setScope({ type: 'scene', id: sc.id });
    importFootage({ files, sceneId: sc.id, set, toast, onProgress: setImporting });
  };
  const write = (v) => set((x) => ({ ...x, script: v }));
  const screenplay = parseScript(script).form === 'screenplay';
  const fresh = shotListFresh(s);
  // The shot list as the film has it now: every scene with its picked shots.
  const live = s.scenes.some((sc) => pickedOf(sc.blocking)) ? { people: s.shotList?.people || [], scenes: s.scenes.map((sc, i) => ({ n: i + 1, place: sc.place || sc.title, time: sc.place ? sc.time : '', sheet: pickedOf(sc.blocking)?.payload || null })) } : null;
  // An idea is written big, in the middle of the stage; a screenplay is a page.
  if (!screenplay && !live) {
    return (
      <DropArea onFiles={(fs) => openScript(fs[0])} accept={(f) => !isMedia(f)} hint="Drop to open the script" style={{ ...PAGE, display: 'grid', placeItems: 'center' }}>
        <div style={{ width: 'min(920px, 100%)', display: 'grid', gap: 18 }}>
          <div style={{ background: C.page, border: `1px solid ${C.lineHi}`, borderRadius: 20, padding: '32px 36px' }}>
            <Draft area live className="st-bare" value={script} onCommit={write} autoSize={{ minRows: 9, maxRows: 18 }} placeholder="Your film — an idea, or a screenplay" style={{ fontSize: 24, lineHeight: 1.5, color: C.ink, letterSpacing: -0.2 }} />
          </div>
          {!script.trim() && (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <UploadButton size="large" icon={<IconFile />} accept=".txt,.fountain,.md,text/plain" onFile={openScript}>Open a script</UploadButton>
              <UploadButton size="large" icon={<IconUpload />} accept="video/*" loading={!!importing} onFiles={fromFootage}>{importing ? `Importing ${importing}` : 'Start from footage'}</UploadButton>
            </div>
          )}
        </div>
      </DropArea>
    );
  }
  const paper = (
    <div style={{ background: C.page, border: `1px solid ${C.line}`, borderRadius: 16, padding: '56px clamp(28px, 8%, 88px)', boxSizing: 'border-box' }}>
      <Draft area live className="st-script" value={script} onCommit={write} autoSize={{ minRows: 12 }} placeholder="Your film — an idea, or a screenplay" />
    </div>
  );
  return (
    <DropArea onFiles={(fs) => openScript(fs[0])} accept={(f) => !isMedia(f)} hint="Drop to open the script" style={{ height: '100%', display: 'grid', gridTemplateColumns: live ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', minHeight: 0 }}>
      <div style={PAGE}><div style={{ maxWidth: live ? 'none' : 960, margin: '0 auto' }}>{paper}</div></div>
      {live && (
        <div style={{ ...PAGE, borderLeft: `1px solid ${C.line}`, background: C.panel }}>
          {!fresh && <div style={{ marginBottom: 18 }}><Pill color={C.warn} bg={C.warnSoft} style={{ fontSize: 13, padding: '3px 10px' }}>The script changed</Pill></div>}
          <ShotList list={live} heroOf={(n) => sceneHero(s, s.scenes[n - 1])} onScene={(n) => setScope({ type: 'scene', id: s.scenes[n - 1].id })} />
        </div>
      )}
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
const WorldPage = ({ s, set, open, toast }) => {
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
  return (
    <div style={PAGE}>
      <div style={{ display: 'grid', gap: 44 }}>
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

const ElementPage = ({ s, set, el, pick, review, toast, open, canvas }) => {
  const [busy, setBusy] = useState(false);
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
const ShotBlock = ({ s, set, scene, sh, on, select, patchShot, removeShot, review, toast, canvas, onStale, single }) => {
  const [importing, setImporting] = useState('');
  const take = pickedOf(sh.takes);
  const takes = (sh.takes.versions || []).filter((v) => visible(v) && v.status !== 'rejected');
  const fresh = takes.filter((v) => v.status === 'review');
  const hero = take || fresh[fresh.length - 1] || takes.find((v) => v.status === 'running') || null;
  const stale = staleOf(s, sh);
  const n = shotNumber(s, sh.id);
  const ref = { at: 'take', sceneId: scene.id, shotId: sh.id };
  const importHere = (files) => importFootage({ files, sceneId: scene.id, shotId: sh.id, set, toast, onProgress: setImporting });
  const faces = facesOf(s, [sh]);
  const others = (sh.elementIds || []).map((id) => findElement(s, id)).filter((el) => el && el.kind === 'prop');
  const views = viewsOfShot(s, sh);
  const viewNamed = (name) => views.find((el) => el.name.endsWith(`· ${name}`));
  const beats = sh.sheet && namedText(s, sh.motion) === sceneMotion(sh.sheet) ? shotsOf(sh.sheet) : null;
  return (
    <div role="button" onClick={() => select(on ? null : sh.id)} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.75fr) minmax(320px, 1fr)', gap: 28, padding: 18, borderRadius: 20, cursor: 'pointer', border: `1px solid ${on ? C.accent : C.line}`, background: on ? '#1b1815' : C.panel, boxShadow: on ? `0 0 0 3px ${C.accentSoft}` : 'none' }}>
      <DropArea onFiles={importHere} accept={isClip} hint="Drop your performance" style={{ display: 'grid', gap: 12, alignContent: 'start', minWidth: 0 }}>
        {hero
          ? <Tile big v={hero} w="100%" badge={takeBadge(hero)} onClick={hero.status === 'running' ? undefined : (e) => { e.stopPropagation(); review(ref, hero.id); }} />
          : (
            <div style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 14, background: '#08090b', boxShadow: `inset 0 0 0 1px ${C.line}`, display: 'grid', placeItems: 'center', alignContent: 'center', gap: 14 }}>
              <span style={{ fontFamily: MONO, fontSize: 56, fontWeight: 700, color: '#2c3038' }}>{pad2(n)}</span>
              <UploadButton size="large" icon={<IconUpload />} accept="video/*" loading={!!importing} onFiles={importHere}>{importing ? `Importing ${importing}` : 'Your performance'}</UploadButton>
            </div>
          )}
        {takes.length > 0 && (
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, paddingTop: 2, paddingLeft: 2 }} onClick={(e) => e.stopPropagation()}>
            {takes.map((v) => <Tile key={v.id} v={v} w={148} badge={takeBadge(v)} picked={sh.takes.picked === v.id} onClick={v.status !== 'running' ? () => review(ref, v.id) : undefined} />)}
            <span style={{ flex: '0 0 auto', alignSelf: 'center' }}><UploadButton type="text" size="large" icon={<IconUpload />} accept="video/*" loading={!!importing} onFiles={importHere} title="Your performance" aria-label="Your performance" /></span>
          </div>
        )}
      </DropArea>
      <div style={{ display: 'grid', gap: 18, alignContent: 'start', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minHeight: 32 }}>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 16, color: C.accent }}>{pad2(n)}</span>
          {on
            ? <span onClick={(e) => e.stopPropagation()} style={{ flex: 1, minWidth: 120 }}><Draft value={sh.title} onCommit={(v) => patchShot(sh.id, { title: v })} style={{ fontSize: 16, fontWeight: 600 }} /></span>
            : !single && <span style={{ fontSize: 17, fontWeight: 600, flex: 1, minWidth: 0, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sh.title}</span>}
          <span style={{ flex: on || !single ? '0 0 auto' : 1 }} />
          {sh.videoModel && sh.videoModel !== s.videoModel && <Pill color={C.text} bg="transparent" style={{ border: `1px solid ${C.line}`, fontSize: 12 }}>{videoModelLabel(sh.videoModel)}</Pill>}
          <span style={{ fontFamily: MONO, fontSize: 14, color: C.muted }}>{sh.seconds}s</span>
          {canvas && <CanvasButton size={30} title={sh.boardCard ? 'Show its card in Canvas' : 'Open in Canvas'} onClick={() => canvas.shot(scene.id, sh.id)} />}
          {take && <IconStarFill style={{ color: C.gold, fontSize: 18 }} title="Circled" />}
        </div>
        {stale.length > 0 && (
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', background: C.warnSoft, borderRadius: 10, fontSize: 13.5, color: C.warn }}>
            <span style={{ flex: 1, minWidth: 0 }}>Made with an earlier {stale.join(', ')}</span>
            <Button size="small" onClick={() => onStale.redo(scene.id, sh.id)}>Shoot again</Button>
            <Button size="small" type="text" onClick={() => onStale.keep(scene.id, sh.id)}>Keep</Button>
          </div>
        )}
        {(faces.length > 0 || others.length > 0) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {faces.map((el) => <Face key={el.id} el={el} size={44} />)}
            {others.map((el) => { const p = pickedOf(el); return <span key={el.id} title={el.name} style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', background: C.raised, boxShadow: `inset 0 0 0 1px ${C.line}`, flex: '0 0 auto' }}>{p && <img src={mediaOf(p)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}</span>; })}
          </div>
        )}
        {beats ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {beats.map((b, i) => {
              const view = viewNamed(b.view);
              const pv = view ? pickedOf(view) : null;
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
                  <div title={b.view} style={{ aspectRatio: '16 / 9', borderRadius: 8, overflow: 'hidden', background: '#0b0c0e', boxShadow: `inset 0 0 0 1px ${C.line}`, display: 'grid', placeItems: 'center', fontSize: 11, color: C.muted, textAlign: 'center', padding: pv ? 0 : 6 }}>
                    {pv ? <img src={mediaOf(pv)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : b.view}
                  </div>
                  <span title={b.action} style={{ fontSize: 14.5, lineHeight: 1.5, color: C.text, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{b.action}</span>
                </div>
              );
            })}
          </div>
        ) : !on && (
          <div style={{ fontSize: 15, color: C.text, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 8, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{namedText(s, sh.motion) || sh.quote || ''}</div>
        )}
        {on && (
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'grid', gap: 12 }}>
            {/* What every take is made from: a shot the AD planned folds it away behind its beats. */}
            <details open={!beats}>
              <summary style={{ fontSize: 14, color: C.text, cursor: 'pointer', marginBottom: 8 }}>Text</summary>
              <Draft area value={namedText(s, sh.motion)} onCommit={(v) => patchShot(sh.id, { motion: tokenized(s, v, sh.elementIds) })} autoSize={{ minRows: 6, maxRows: 18 }} placeholder="What happens in the shot" style={{ fontSize: 15, lineHeight: 1.6 }} />
            </details>
            {n > 1 && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, color: sh.startFrom === 'previous' ? C.ink : C.muted, cursor: 'pointer' }}>
                <input type="checkbox" checked={sh.startFrom === 'previous'} onChange={(e) => patchShot(sh.id, { startFrom: e.target.checked ? 'previous' : null })} style={{ accentColor: C.accent }} />
                Starts where shot {pad2(n - 1)} ends
              </label>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Select value={sh.videoModel || ''} onChange={(k) => patchShot(sh.id, { videoModel: k || null })} options={[{ label: `Film · ${videoModelLabel(s.videoModel)}`, value: '' }, ...VIDEO_MODELS.map((m) => ({ label: m.label, value: m.key }))]} style={{ flex: '1 1 200px' }} getPopupContainer={(node) => node.parentElement} />
              <Button status="danger" type="text" onClick={() => { removeShot(sh.id); select(null); }}>Remove</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ScenePage = ({ s, set, scene, scope, selectShot, open, review, toast, canvas, crew, onStale }) => {
  const [importing, setImporting] = useState('');
  const [script, setScript] = useState(false);
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
            {finishing.length > 0 && finalRes.map((res) => <Button key={res} size="large" onClick={() => crew.final(scene.id, res)}>Final · {res}</Button>)}
            {scene.text && <Button size="large" type={script ? 'primary' : 'secondary'} onClick={() => setScript((o) => !o)}>Script</Button>}
            <Button size="large" icon={<IconPlus />} onClick={addShot}>Shot</Button>
            <UploadButton size="large" icon={<IconUpload />} accept="video/*" loading={!!importing} onFiles={importFiles}>{importing ? `Importing ${importing}` : 'Footage'}</UploadButton>
            {canvas && scene.shots.length > 0 && <CanvasButton size={40} title="Open the scene's shots in Canvas" onClick={() => canvas.scene(scene.id)} />}
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
      <div style={{ display: 'grid', gap: 18 }}>
        {scene.shots.map((sh) => <ShotBlock key={sh.id} s={s} set={set} scene={scene} sh={sh} on={scope.type === 'shot' && scope.id === sh.id} select={selectShot} patchShot={patchShot} removeShot={removeShot} review={review} toast={toast} canvas={canvas} onStale={onStale} single={scene.shots.length === 1 && sh.title === scene.title} />)}
      </div>
    </DropArea>
  );
};

// ---- CUT: the film, big, over its timeline -----------------------------------------------------
const CutPage = ({ s, review, selectScene }) => {
  const cut = pickedOf(s.cut) || [...(s.cut.versions || [])].reverse().find((v) => v.status === 'review' || v.status === 'running');
  const scenes = s.scenes.filter((sc) => sc.shots.length);
  const secondsOf = (sc) => sc.shots.reduce((n, sh) => n + Math.max(1, Number(sh.seconds) || 1), 0);
  const ready = cut && cut.status !== 'running' && mediaOf(cut);
  return (
    <div style={{ ...PAGE, display: 'grid', gap: 24, alignContent: 'start' }}>
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

// ---- THREAD + COMPOSER ----------------------------------------------------------------------
const who = crewWho;
const From = ({ id, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 10, alignItems: 'start' }}>
    <Avatar id={id} size={28} />
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: crewColor(id), marginBottom: 4, lineHeight: '15px', paddingTop: 1 }}>{who(id)}</div>
      {children}
    </div>
  </div>
);
// Long words in the thread fold to a few lines; more / less opens them.
const CLAMP_CHARS = 280;
const Clamped = ({ text }) => {
  const [open, setOpen] = useState(false);
  const long = String(text || '').length > CLAMP_CHARS;
  if (!long) return text || null;
  return (
    <>
      <span style={open ? undefined : { display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{text}</span>
      <span role="button" onClick={() => setOpen((o) => !o)} style={{ display: 'block', marginTop: 4, fontSize: 12, color: C.text, cursor: 'pointer', textDecoration: 'underline' }}>{open ? 'less' : 'more'}</span>
    </>
  );
};
const KIND_TEXT = { script: 'Screenplay', shotList: 'Shot list', blocking: 'Shots' };
const textLabel = (v) => (v.kind === 'shotList' ? `Shot list · ${(v.payload?.scenes || []).length} scenes` : v.kind === 'blocking' ? `This scene's shots · ${v.payload?.seconds || '?'} s` : v.title || KIND_TEXT[v.kind] || 'Text');
// Your verdict, right on the work: ★ pick (circle a take), ✕ reject; open it for notes.
const Verdict = ({ it, pick, reject }) => (it.v.status === 'review' ? (
  <span style={{ display: 'inline-flex', gap: 2 }}>
    <span role="button" className="st-chip" title={it.ref.at === 'take' ? 'Circle' : 'Pick'} onClick={(e) => { e.stopPropagation(); pick(it.ref, it.v); }} style={{ cursor: 'pointer', color: C.gold, padding: '2px 6px', borderRadius: 6, fontSize: 14 }}><IconStarFill /></span>
    <span role="button" className="st-chip" title="Reject" onClick={(e) => { e.stopPropagation(); reject(it.ref, it.v); }} style={{ cursor: 'pointer', color: C.muted, padding: '2px 6px', borderRadius: 6, fontSize: 14 }}><IconClose /></span>
  </span>
) : null);
const Message = ({ s, m, answer, review, setText, undo, pick, reject, stop }) => {
  if (m.from === 'you') {
    const agent = crewById(m.agent);
    const action = agent?.actions.find((a) => a.id === m.action) || null;
    return (
      <div style={{ justifySelf: 'end', maxWidth: '88%', background: C.accentSoft, border: '1px solid rgba(255,150,38,0.22)', borderRadius: '12px 12px 4px 12px', padding: '9px 12px', fontSize: 14, color: C.ink, lineHeight: 1.5 }}>
        {/* A button (Final) reads as what you pressed, not as an @ request. */}
        {action?.talk ? null : action?.button
          ? <b style={{ fontWeight: 700 }}>{action.label} </b>
          : <>
            {agent && <b style={{ color: crewColor(agent.id), fontWeight: 700 }}>@{agent.handle} </b>}
            {action && <span style={{ color: C.text }}>{action.label.toLowerCase()} </span>}
          </>}
        {m.target && <span style={{ color: C.muted }}>{m.target}{m.text ? ' · ' : ''}</span>}
        <Clamped text={m.text} />
      </div>
    );
  }
  if (m.kind === 'question') {
    return (
      <From id={m.from}>
        <div style={{ background: C.warnSoft, border: '1px solid rgba(255,122,89,0.25)', borderRadius: 12, padding: '10px 12px', fontSize: 14 }}>
          <div style={{ color: C.ink, lineHeight: 1.5 }}>{m.text}</div>
          {m.answered
            ? <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6 }}>→ {m.answered}</div>
            : <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>{(m.options || []).map((o, i) => <Button key={i} type={i === 0 ? 'primary' : 'secondary'} onClick={() => answer(m, o)}>{o.label}</Button>)}</div>}
        </div>
      </From>
    );
  }
  if (m.kind === 'ask') {
    return (
      <div style={{ fontSize: 14 }}>
        <div style={{ color: C.muted, marginBottom: 7 }}>Who's this for?</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(m.handles || []).map((h) => {
            const agent = crewById(h.toLowerCase());
            return <span key={h} role="button" className="st-chip" onClick={() => setText(`@${h} ${m.text || ''}`)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px 3px 3px', borderRadius: 8, border: `1px solid ${C.line}`, background: C.raised, cursor: 'pointer', color: C.ink }}>{agent && <Avatar id={agent.id} size={20} />}@{h}</span>;
          })}
        </div>
      </div>
    );
  }
  if (m.kind === 'reply') {
    const ch = m.change;
    return (
      <From id={m.from}>
        <div style={{ fontSize: 14, color: C.ink, lineHeight: 1.55 }}><Clamped text={m.text} /></div>
        {(ch || (m.unknown || []).length > 0) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 7, fontSize: 12.5, opacity: m.undone ? 0.5 : 1 }}>
            {ch?.text && <Pill color={C.accent} bg={C.accentSoft}>prompt updated</Pill>}
            {ch?.screenplay && <Pill color={C.accent} bg={C.accentSoft}>screenplay updated</Pill>}
            {(ch?.scenes || []).map((n) => <Pill key={`sc${n}`} color={C.accent} bg={C.accentSoft}>scene {n} shots updated</Pill>)}
            {(ch?.renamed || []).map((n) => <Pill key={`rn${n}`} color={C.accent} bg={C.accentSoft}>{n}</Pill>)}
            {(ch?.described || []).map((n) => <Pill key={`ds${n}`} color={C.accent} bg={C.accentSoft}>{n} described</Pill>)}
            {(ch?.added || []).map((n) => <Pill key={`+${n}`} color={C.good} bg={C.goodSoft}>+ {n}</Pill>)}
            {(ch?.removed || []).map((n) => <Pill key={`-${n}`} color={C.muted} bg={C.raised} style={{ textDecoration: 'line-through' }}>{n}</Pill>)}
            {(m.unknown || []).map((n) => <Pill key={`?${n}`} color={C.warn} bg={C.warnSoft}>{m.from === 'shot' ? `no ${n} in Cast & World` : n}</Pill>)}
            {ch && (m.undone
              ? <span style={{ color: C.muted }}>undone</span>
              : <span role="button" className="st-ghost" onClick={() => undo(m)} style={{ color: C.text, cursor: 'pointer', textDecoration: 'underline' }}>Undo</span>)}
          </div>
        )}
      </From>
    );
  }
  if (m.kind === 'error') return <From id={m.from}><div style={{ fontSize: 14, color: C.bad, lineHeight: 1.5 }}>{m.text}</div></From>;
  if (m.kind === 'delivery') {
    const all = (m.items || []).map((it) => ({ ...it, v: (containerOf(s, it.ref)?.versions || []).find((x) => x.id === it.vid) })).filter((it) => it.v);
    // Failed work is not shown — one line says how much did not render (Generations ▸ Failed has it).
    const items = all.filter((it) => visible(it.v));
    const failedN = all.filter((it) => it.v.status === 'failed' && !it.v.archived && it.v.error !== 'Stopped').length;
    const head = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {m.summary && <span style={{ fontSize: 13, color: C.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.summary}</span>}
        {!m.finished && !m.stopped && <span role="button" className="st-ghost" onClick={() => stop(m)} style={{ marginLeft: 'auto', fontSize: 12.5, color: C.muted, cursor: 'pointer', textDecoration: 'underline' }}>Stop</span>}
        {m.stopped && <span style={{ marginLeft: 'auto', fontSize: 12.5, color: C.muted }}>stopped</span>}
      </div>
    );
    const failedLine = failedN > 0 ? <div style={{ fontSize: 12.5, color: C.muted }}>{failedN} didn't render — Generations ▸ Failed</div> : null;
    if (!items.length) {
      return m.finished && !m.summary ? null : (
        <From id={m.from}><div style={{ display: 'grid', gap: 5 }}>{head}{!m.finished && !m.stopped && <Working stage={m.stage} since={m.at} />}{failedLine}</div></From>
      );
    }
    const textual = items.filter((it) => Object.keys(KIND_TEXT).includes(it.v.kind));
    return (
      <From id={m.from}>
        <div style={{ display: 'grid', gap: 8 }}>
          {head}
          {!m.finished && !m.stopped && m.stage && <Working stage={m.stage} since={m.at} />}
          {failedLine}
          {textual.map((it) => (
            <div key={it.vid} role="button" className="st-card" onClick={() => it.v.status !== 'running' && review(it.ref, it.vid)} style={{ border: `1px solid ${it.v.status === 'review' ? 'rgba(255,122,89,0.45)' : C.line}`, background: C.raised, borderRadius: 12, padding: '10px 12px', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: it.v.status === 'failed' ? C.bad : C.ink, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.v.status === 'running' ? <span className="st-pulse" style={{ color: C.work }}>working…</span> : it.v.status === 'failed' ? it.v.error : textLabel(it.v)}
              </span>
              {it.v.status === 'review' && <span style={{ fontSize: 11.5, fontWeight: 700, color: C.warn }}>new</span>}
              <Verdict it={it} pick={pick} reject={reject} />
              {it.v.status === 'picked' && <IconStarFill style={{ color: C.gold }} />}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {items.filter((it) => !textual.includes(it)).map((it) => (
              <div key={it.vid} style={{ display: 'grid', gap: 3, justifyItems: 'center' }}>
                <Tile v={it.v} w={it.v.kind === 'plate' ? 88 : 148} ratio={it.v.kind === 'plate' ? '1' : '16 / 9'} picked={it.v.status === 'picked'} onClick={it.v.status !== 'running' ? () => review(it.ref, it.vid) : undefined} />
                <Verdict it={it} pick={pick} reject={reject} />
              </div>
            ))}
          </div>
        </div>
      </From>
    );
  }
  return null;
};

// What plain words talk to, where you stand.
const TALK_TO = { brief: 'Talk to the script', scene: 'Talk to this scene', world: 'Talk to Cast & World', element: 'Talk to Cast & World', cut: 'Talk to the cut' };
const Composer = ({ s, scope, onSend, text, setText, target }) => {
  const element = scope.type === 'element' ? findElement(s, scope.id) : null;
  const avail = actionsFor(scope, element);
  const atWord = /^@(\w*)$/.exec(text.trim());
  const suggest = atWord ? avail.filter(({ agent }) => agent.handle.toLowerCase().startsWith(atWord[1].toLowerCase())) : [];
  const send = () => { if (text.trim()) { onSend(text); setText(''); } };
  // An @ put here for you (the next step, the @ menu): your words go right after it.
  const box = useRef(null);
  useEffect(() => { if (/^@\w+ $/.test(text)) box.current?.querySelector('textarea')?.focus(); }, [text]);
  return (
    <div ref={box} style={{ position: 'relative' }}>
      {suggest.length > 0 && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6, background: C.raised, border: `1px solid ${C.lineHi}`, borderRadius: 12, padding: 5, zIndex: 5, boxShadow: '0 12px 30px rgba(0,0,0,0.45)' }}>
          {suggest.map(({ agent, action }) => (
            <div key={`${agent.id}.${action.id}`} role="button" className="st-row" onClick={() => setText(`@${agent.handle} `)} style={{ padding: '7px 9px', cursor: 'pointer', fontSize: 14, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 9, color: C.ink }}>
              <Avatar id={agent.id} size={24} /><b style={{ color: crewColor(agent.id), fontWeight: 600 }}>@{agent.handle}</b><span style={{ color: C.muted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{action.label}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ background: C.raised, border: `1px solid ${C.lineHi}`, borderRadius: 14, padding: '8px 8px 8px 6px', display: 'flex', alignItems: 'flex-end', gap: 4 }}>
        <Input.TextArea
          className="st-bare" value={text} onChange={setText} autoSize={{ minRows: 1, maxRows: 6 }}
          onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={`${target ? 'Talk to this shot' : TALK_TO[scope.type] || 'Talk'} · @ crew`}
          style={{ fontSize: 15, lineHeight: 1.5 }}
        />
        <Button type="primary" shape="circle" icon={<IconSend />} disabled={!text.trim()} onClick={send} style={{ flex: '0 0 auto' }} aria-label="Send" />
      </div>
    </div>
  );
};

export const scopeTitle = (s, scope) => {
  if (scope.type === 'brief') return 'Script';
  if (scope.type === 'world') return 'Cast & World';
  if (scope.type === 'element') return findElement(s, scope.id)?.name || '';
  if (scope.type === 'scene') return findScene(s, scope.id)?.title || '';
  if (scope.type === 'shot') return findScene(s, scope.sceneId)?.title || '';
  if (scope.type === 'cut') return 'Cut';
  return '';
};

// THE NEXT STEP — the guide's one thing to do, always above the composer: one press does it (a
// crew job runs, what waits opens, the words go in the composer).
const NextStep = ({ step, onStep, here }) => {
  if (!step) return null;
  if (step.write && here) return <div style={{ fontSize: 14.5, color: C.text, padding: '0 2px 10px' }}>{step.label}</div>;
  const agent = step.agent ? crewById(step.agent) : null;
  return (
    <div style={{ paddingBottom: 12 }}>
      <Button long size="large" type="primary" onClick={() => onStep(step)} style={{ height: 52, fontSize: 16, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        {step.review ? <IconStarFill /> : step.say || step.write ? <IconRight /> : <IconPlayArrowFill />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.label}</span>
        {agent && <span style={{ fontSize: 12.5, fontWeight: 500, opacity: 0.65 }}>{agent.name}</span>}
      </Button>
    </div>
  );
};

export const Thread = ({ s, scope, target, onClearTarget, onRequest, answer, review, ask, text, setText, undoShot, pick, reject, stop, step, onStep }) => {
  const key = threadKeyOf(scope);
  const msgs = s.threads[key] || [];
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  const element = scope.type === 'element' ? findElement(s, scope.id) : null;
  const send = (raw) => {
    const r = parseRequest(raw, scope, element);
    // Words without an @ edit what you stand on: the script (the screenplay and its shot list at
    // the Script, a scene's shots at a scene), a shot, Cast & World (or one of it), the cut.
    const talker = talkerFor(scope);
    if (!r.agent && talker) { onRequest({ agent: talker.agent, action: talker.action, text: String(raw).trim() }, raw); return; }
    if (!r.agent) { ask(scope, raw, actionsFor(scope, element)); return; }
    onRequest(r, raw);
  };
  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', gridTemplateColumns: 'minmax(0, 1fr)', height: '100%', minHeight: 0, background: C.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: `1px solid ${C.line}`, minHeight: 52, boxSizing: 'border-box' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>Crew</span>
        <span style={{ fontSize: 13.5, color: C.muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scopeTitle(s, scope)}</span>
        {target && <Pill color={C.accent} bg={C.accentSoft} style={{ maxWidth: 160, overflow: 'hidden', fontSize: 12.5 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{target}</span><IconClose style={{ cursor: 'pointer', flex: '0 0 auto' }} onClick={onClearTarget} /></Pill>}
      </div>
      <div style={{ overflowY: 'auto', padding: 16, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16, alignContent: 'start' }}>
        {msgs.map((m) => <Message key={m.id} s={s} m={m} answer={(msg, o) => answer(key, msg, o)} review={review} setText={setText} undo={(msg) => undoShot(key, msg)} pick={pick} reject={reject} stop={(msg) => stop(key, msg)} />)}
        <div ref={end} />
      </div>
      <div style={{ padding: 14, borderTop: `1px solid ${C.line}` }}>
        <NextStep step={step} onStep={onStep} here={scope.type === 'brief'} />
        <Composer s={s} scope={scope} text={text} setText={setText} onSend={send} target={target} />
      </div>
    </div>
  );
};

// ---- the stage page for the current scope --------------------------------------------------------
export const DirectPage = ({ s, set, scope, setScope, pick, review, toast, crew, canvas, onStale }) => {
  if (scope.type === 'brief') return <ScriptPage s={s} set={set} toast={toast} setScope={setScope} />;
  if (scope.type === 'world') return <WorldPage s={s} set={set} open={setScope} toast={toast} />;
  if (scope.type === 'element') {
    const el = findElement(s, scope.id);
    return el ? <ElementPage s={s} set={set} el={el} pick={pick} review={review} toast={toast} open={setScope} canvas={canvas} /> : <Empty>Gone.</Empty>;
  }
  if (scope.type === 'scenes') return <ScenesPage s={s} set={set} open={setScope} toast={toast} />;
  if (scope.type === 'scene' || scope.type === 'shot') {
    const sceneId = scope.type === 'scene' ? scope.id : scope.sceneId;
    const scene = findScene(s, sceneId);
    if (!scene) return <Empty>Gone.</Empty>;
    return <ScenePage s={s} set={set} scene={scene} scope={scope} open={setScope} review={review} toast={toast} canvas={canvas} crew={crew} onStale={onStale} selectShot={(id) => setScope(id ? { type: 'shot', sceneId, id } : { type: 'scene', id: sceneId })} />;
  }
  if (scope.type === 'cut') return <CutPage s={s} review={review} selectScene={(sceneId, id) => setScope({ type: 'shot', sceneId, id })} />;
  return null;
};
export const scopeTarget = (s, scope) => (scope.type === 'shot' ? (() => { const sh = findShot(s, scope.sceneId, scope.id); return sh ? `${pad2(shotNumber(s, sh.id))} ${sh.title}` : ''; })() : '');
