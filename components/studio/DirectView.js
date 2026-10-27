import { useEffect, useRef, useState } from 'react';
import { Button, Input, Select } from '@arco-design/web-react';
import { IconClose, IconPlus, IconStarFill, IconUpload, IconSend, IconBulb, IconFile, IconDownload, IconRight } from '@arco-design/web-react/icon';
import { C, MONO, SCRIPT_FONT, Tile, Empty, Label, Pill, Avatar, PageHead, DropArea, CanvasButton, crewColor, crewWho, mediaOf, storeFile, readFile, readText } from './ui';
import { stageLocalAsset } from '../../utils/film/canvasModel';
import { ELEMENT_KINDS, KIND_LABEL, containerOf, findElement, findScene, findShot, namedText, tokenized, pickedOf, pad2, shotNumber, threadKeyOf, newElement, newShot, uid, staleOf } from '../../utils/film/studio/model';
import { actionsFor, crewById, parseRequest } from '../../utils/film/studio/crew';
import { DRAFT_MODE } from '../../utils/film/suiteConfig';
import { parseScript, pagesLabel } from '../../utils/film/core/scriptForm';

// Blur-commit text: typing stays local, the film updates when you leave the field.
const Draft = ({ value, onCommit, onLeave, area, ...rest }) => {
  const [v, setV] = useState(null);
  const Comp = area ? Input.TextArea : Input;
  return <Comp {...rest} value={v !== null ? v : (value || '')} onChange={setV} onFocus={() => setV(value || '')} onBlur={() => { if (v !== null && v !== (value || '')) onCommit(v); if (onLeave) onLeave(v !== null ? v : value); setV(null); }} />;
};
export const UploadButton = ({ onFile, onFiles, accept = 'image/*', children, ...rest }) => {
  const ref = useRef(null);
  return (
    <>
      <input ref={ref} type="file" accept={accept} multiple={!!onFiles} style={{ display: 'none' }} onChange={(e) => { const fs = [...(e.target.files || [])]; if (onFiles && fs.length) onFiles(fs); else if (fs[0]) onFile(fs[0]); e.target.value = ''; }} />
      <Button {...rest} onClick={() => ref.current?.click()}>{children}</Button>
    </>
  );
};
const isImage = (f) => f.type.startsWith('image/');
const isMedia = (f) => f.type.startsWith('image/') || f.type.startsWith('video/');
const KIND_COLOR = { character: crewColor('casting'), location: crewColor('designer'), prop: '#ffd166' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---- BRIEF: the script, the 1st AD's breakdown and the plan --------------------------------
const STATUS_TEXT = { done: C.good, next: C.ink, later: C.muted };
const PlanCard = ({ plan, onGo, busy }) => {
  const next = plan.find((st) => !st.done);
  return (
    <div style={{ background: C.raised, border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 4 }}>
      <Label style={{ marginBottom: 4 }}>Plan</Label>
      {plan.map((st) => {
        const state = st.done ? 'done' : st === next ? 'next' : 'later';
        return (
          <div key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 9, minHeight: 32, minWidth: 0, color: STATUS_TEXT[state], fontSize: 13 }}>
            <Avatar id={st.agent} size={22} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: state === 'next' ? 600 : 400 }}>{st.label}</span>
            {state === 'done' && st.review && <span role="button" className="st-ghost" onClick={() => onGo(st)} style={{ fontSize: 12, color: C.text, cursor: 'pointer', textDecoration: 'underline' }}>Open</span>}
            {state === 'done' && st.req && (busy === st.id
              ? <span className="st-pulse" style={{ fontSize: 12, color: C.work }}>working…</span>
              : <span role="button" className="st-ghost" onClick={() => onGo(st, { redo: true })} style={{ fontSize: 12, color: C.text, cursor: 'pointer', textDecoration: 'underline' }}>Redo</span>)}
            {state === 'done' && <span style={{ fontSize: 12 }}>✓</span>}
            {state === 'next' && (busy === st.id
              ? <span className="st-pulse" style={{ fontSize: 12, color: C.work }}>working…</span>
              : (st.req || st.review) && <Button size="small" type="primary" style={{ flex: '0 0 auto' }} onClick={() => onGo(st)}>{st.review ? 'Open' : 'Go'}</Button>)}
          </div>
        );
      })}
    </div>
  );
};

// A long brief shows this many lines and scrolls inside its box until you open it in full.
const BRIEF_ROWS = 6;
const BriefPage = ({ s, set, toast, plan, onGo, busy }) => {
  const script = String(s.script || '');
  const [full, setFull] = useState(false);
  const lines = script.split('\n').length;
  const long = lines > BRIEF_ROWS;
  const openScript = async (file) => {
    try { const t = await readText(file); set((x) => ({ ...x, script: t })); } catch (e) { toast(e.message); }
  };
  // The form is read by code the moment the text is in: sluglines make it a screenplay.
  const parsed = parseScript(script);
  const total = parsed.scenes.reduce((n, sc) => n + sc.eighths, 0);
  const sub = !script.trim() ? ''
    : parsed.form === 'screenplay' ? `Screenplay · ${plural(parsed.scenes.length, 'scene')} · ${pagesLabel(total)} pages`
      : `${parsed.form === 'idea' ? 'Idea' : 'Treatment'} · ${parsed.words} words`;
  const screenplay = parsed.form === 'screenplay';
  return (
    <>
      <PageHead title="Brief" sub={sub} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <DropArea onFiles={(fs) => openScript(fs[0])} accept={(f) => !isMedia(f)} hint="Drop to open the script" style={{ flex: '1 1 440px', minWidth: 0, maxWidth: 820 }}>
          <div style={{ background: C.page, border: `1px solid ${C.line}`, borderRadius: 14, padding: screenplay ? '40px clamp(20px, 6%, 64px)' : '24px 26px' }}>
            <Draft
              area className={screenplay ? 'st-script' : 'st-bare'} value={script}
              onCommit={(v) => set((x) => ({ ...x, script: v }))}
              autoSize={long && !full ? { minRows: 6, maxRows: BRIEF_ROWS } : { minRows: screenplay ? 24 : 8 }}
              placeholder="The film — an idea in a few lines, or paste a screenplay"
              style={screenplay ? undefined : { fontSize: 15.5, lineHeight: 1.7, color: C.ink }}
            />
          </div>
          {long && (
            <div style={{ marginTop: 8, textAlign: 'right' }}>
              <span role="button" className="st-ghost" onClick={() => setFull((f) => !f)} style={{ fontSize: 12.5, color: C.text, cursor: 'pointer', textDecoration: 'underline' }}>{full ? 'Collapse' : `Show all · ${lines} lines`}</span>
            </div>
          )}
          {!script.trim() && (
            <div style={{ marginTop: 10 }}>
              <UploadButton size="small" type="text" icon={<IconFile />} accept=".txt,.fountain,.md,text/plain" onFile={openScript}>Open a script file</UploadButton>
            </div>
          )}
        </DropArea>
        {script.trim() && (
          <div style={{ flex: '0 1 360px', minWidth: 280, display: 'grid', gap: 18 }}>
            <PlanCard plan={plan} onGo={onGo} busy={busy} />
          </div>
        )}
      </div>
    </>
  );
};

// ---- CAST & WORLD -------------------------------------------------------------------------
const usage = (s, id) => s.scenes.reduce((n, sc) => n + sc.shots.filter((sh) => (sh.elementIds || []).includes(id)).length, 0);
const kindOne = (k) => KIND_LABEL[k].replace(/s$/, '');
const WorldPage = ({ s, set, open, toast }) => {
  const [kind, setKind] = useState('all');
  const [adding, setAdding] = useState(null);
  const list = s.elements.filter((e) => kind === 'all' || e.kind === kind);
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
  // Dropped images become elements of the kind on show, named after their files.
  const dropped = async (files) => {
    const k = kind === 'all' ? 'character' : kind;
    for (const f of files) {
      try { const el = await withPlate(newElement({ kind: k, name: f.name.replace(/\.[^.]+$/, '') }), f); set((x) => ({ ...x, elements: [...x.elements, el] })); } catch (e) { toast(`${f.name}: ${e.message}`); } // eslint-disable-line no-await-in-loop
    }
  };
  const count = (k) => s.elements.filter((e) => e.kind === k).length;
  return (
    <DropArea onFiles={dropped} accept={isImage} hint={`Drop to add ${kind === 'all' ? 'cast' : KIND_LABEL[kind].toLowerCase()}`}>
      <PageHead title="Cast & World" sub={ELEMENT_KINDS.map((k) => `${count(k)} ${(count(k) === 1 ? kindOne(k) : KIND_LABEL[k]).toLowerCase()}`).join(' · ')} />
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {['all', ...ELEMENT_KINDS].map((k) => (
          <span key={k} role="button" onClick={() => setKind(k)} style={{ padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: kind === k ? C.hover : 'transparent', color: kind === k ? C.ink : C.muted, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {k !== 'all' && <span style={{ width: 7, height: 7, borderRadius: 2, background: KIND_COLOR[k] }} />}
            {k === 'all' ? 'All' : KIND_LABEL[k]}<span style={{ opacity: 0.55, fontWeight: 400 }}>{k === 'all' ? s.elements.length : count(k)}</span>
          </span>
        ))}
      </div>
      {adding && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 10, border: `1px solid ${C.accent}`, background: C.raised, borderRadius: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <Select value={adding.kind} onChange={(k) => setAdding({ ...adding, kind: k })} style={{ width: 130 }} options={ELEMENT_KINDS.map((k) => ({ label: kindOne(k), value: k }))} />
          <Input autoFocus placeholder="Name" value={adding.name} onChange={(v) => setAdding({ ...adding, name: v })} style={{ flex: '1 1 160px' }} />
          <UploadButton type="primary" icon={<IconUpload />} onFile={add}>With an image</UploadButton>
          <Button onClick={() => add(null)}>Without</Button>
          <Button type="text" icon={<IconClose />} onClick={() => setAdding(null)} />
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 14 }}>
        {list.map((el) => {
          const p = pickedOf(el);
          const running = (el.versions || []).some((v) => v.status === 'running');
          const waiting = (el.versions || []).filter((v) => v.status === 'review').length;
          const n = usage(s, el.id);
          return (
            <div key={el.id} role="button" className="st-card" onClick={() => open({ type: 'element', id: el.id })} style={{ cursor: 'pointer', border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', background: C.raised }}>
              <div style={{ aspectRatio: '1', background: '#0b0c0e', display: 'grid', placeItems: 'center', position: 'relative' }}>
                {p ? <img src={mediaOf(p)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className={running ? 'st-pulse' : undefined} style={{ fontSize: 12, color: running ? C.work : C.muted }}>{running ? 'Casting…' : 'No plate'}</span>}
                {waiting > 0 && <Pill color={C.accentInk} bg={C.warn} style={{ position: 'absolute', top: 8, right: 8, fontWeight: 700 }}>{waiting} new</Pill>}
              </div>
              <div style={{ padding: '9px 11px 11px' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{el.name}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, color: C.muted, marginTop: 3 }}>
                  <span style={{ color: KIND_COLOR[el.kind] }}>{kindOne(el.kind)}</span>
                  <span>{n ? plural(n, 'shot') : 'unused'}</span>
                </div>
              </div>
            </div>
          );
        })}
        {!adding && (
          <div role="button" className="st-card" onClick={() => setAdding({ kind: kind === 'all' ? 'character' : kind, name: '' })} style={{ cursor: 'pointer', border: `1px dashed ${C.lineHi}`, borderRadius: 12, minHeight: 200, display: 'grid', placeItems: 'center', alignContent: 'center', gap: 6, color: C.muted, fontSize: 13 }}>
            <IconPlus style={{ fontSize: 20 }} />Add your own
          </div>
        )}
      </div>
    </DropArea>
  );
};

const ElementPage = ({ s, set, el, pick, toast, open, canvas }) => {
  const [busy, setBusy] = useState(false);
  const versions = (el.versions || []).filter((v) => v.status !== 'rejected');
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
  const patch = (fields) => set((x) => ({ ...x, elements: x.elements.map((e) => (e.id === el.id ? { ...e, ...fields } : e)) }));
  return (
    <DropArea onFiles={upload} accept={isImage} hint="Drop to add a version">
      <div role="button" onClick={() => open({ type: 'world' })} style={{ fontSize: 12, color: C.muted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>Cast & World <IconRight style={{ fontSize: 10 }} /> <span style={{ color: KIND_COLOR[el.kind] }}>{kindOne(el.kind)}</span></div>
      <PageHead right={canvas && pickedOf(el) ? <CanvasButton onClick={() => canvas.element(el)} /> : null}>
        <Draft className="st-bare" value={el.name} onCommit={(v) => patch({ name: v })} style={{ fontSize: 24, fontWeight: 700, padding: '0 4px', marginLeft: -4, color: C.ink, height: 36 }} />
      </PageHead>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-start' }}>
        <div style={{ flex: '0 1 340px', minWidth: 220 }}>
          <div style={{ aspectRatio: '1', borderRadius: 14, overflow: 'hidden', background: '#0b0c0e', border: `1px solid ${C.line}`, display: 'grid', placeItems: 'center' }}>
            {p ? <img src={mediaOf(p)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: C.muted }}>No plate</span>}
          </div>
          {(p?.extras || []).map((x) => <img key={x.url} src={x.url} alt="" style={{ width: '100%', borderRadius: 10, marginTop: 10, border: `1px solid ${C.line}` }} />)}
        </div>
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'grid', gap: 22, alignContent: 'start' }}>
          <div>
            <Label>Description</Label>
            <Draft area value={el.desc} onCommit={(v) => patch({ desc: v })} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="Who or what this is" style={{ fontSize: 13.5, lineHeight: 1.6 }} />
          </div>
          <div>
            <Label right={<UploadButton size="mini" type="text" icon={<IconUpload />} loading={busy} onFiles={upload}>Your image</UploadButton>}>Versions</Label>
            {!versions.length ? <Empty>No versions yet</Empty> : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {versions.map((v) => (
                  <div key={v.id} style={{ display: 'grid', gap: 5, justifyItems: 'center' }}>
                    <Tile v={v} w={120} ratio="1" picked={el.picked === v.id} onClick={v.status === 'review' || v.status === 'kept' ? () => pick({ at: 'element', id: el.id }, v.id) : undefined} title={v.status === 'review' ? 'Pick' : ''} />
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: v.status === 'picked' ? C.gold : v.status === 'review' ? C.warn : v.status === 'running' ? C.work : v.status === 'failed' ? C.bad : C.muted }}>{v.status === 'picked' ? '★ picked' : v.status === 'review' ? 'pick?' : v.status === 'running' ? 'working' : v.status === 'failed' ? 'failed' : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </DropArea>
  );
};

// ---- SCENE: the shot sheet --------------------------------------------------------------------
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

// YOUR FOOTAGE: each clip becomes a shot whose circled take is the clip (registered as an
// asset, so VFX can edit it).
export const importFootage = async ({ files, sceneId, set, toast, onProgress = () => {} }) => {
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
      const shot = newShot({ title: f.name.replace(/\.[^.]+$/, ''), seconds: Math.round(seconds) || 8 });
      shot.takes = { versions: [version], picked: vid };
      set((x) => ({ ...x, scenes: x.scenes.map((sc) => (sc.id === sceneId ? { ...sc, shots: [...sc.shots, shot] } : sc)) }));
    } catch (e) { toast(`${f.name}: ${e.message}`); }
  }
  onProgress('');
};

const takeBadge = (v) => (v.status === 'running' ? null : v.footage ? 'SRC' : v.edit ? 'VFX' : v.res === '1080p' ? 'HD' : null);

const ScenePage = ({ s, set, scene, scope, selectShot, review, toast, canvas, crew }) => {
  const [importing, setImporting] = useState('');
  const patchShot = (id, patch) => set((x) => ({ ...x, scenes: x.scenes.map((sc) => (sc.id !== scene.id ? sc : { ...sc, shots: sc.shots.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh)) })) }));
  const addShots = (shots) => set((x) => ({ ...x, scenes: x.scenes.map((sc) => (sc.id === scene.id ? { ...sc, shots: [...sc.shots, ...shots] } : sc)) }));
  const removeShot = (id) => set((x) => ({ ...x, scenes: x.scenes.map((sc) => (sc.id === scene.id ? { ...sc, shots: sc.shots.filter((sh) => sh.id !== id) } : sc)) }));
  const importFiles = (files) => importFootage({ files, sceneId: scene.id, set, toast, onProgress: setImporting });
  const seconds = scene.shots.reduce((n, sh) => n + (Number(sh.seconds) || 0), 0);
  const circled = scene.shots.filter((sh) => sh.takes?.picked).length;
  // Circled drafts that can still finish (1080p MOV, the same picture).
  const toFinal = scene.shots.filter((sh) => { const t = pickedOf(sh.takes); return t?.draft?.taskId && Date.now() - t.draft.at < DRAFT_MODE.ttlMs; }).length;
  const addShot = () => { const sh = newShot({ title: 'New shot' }); addShots([sh]); selectShot(sh.id); };
  return (
    <DropArea onFiles={importFiles} accept={isMedia} hint="Drop footage into this scene">
      <PageHead
        sub={scene.shots.length ? `${plural(scene.shots.length, 'shot')} · ${seconds} s · ${circled} circled` : ''}
        right={(
          <>
            {toFinal > 0 && <Button onClick={() => crew.final(scene.id)} title="The circled drafts at 1080p MOV — the same pictures">Final {toFinal === 1 ? 'the circled draft' : `${toFinal} circled drafts`}</Button>}
            <Button icon={<IconPlus />} onClick={addShot}>Shot</Button>
            <UploadButton icon={<IconUpload />} accept="video/*" loading={!!importing} onFiles={importFiles}>{importing ? `Importing ${importing}` : 'Footage'}</UploadButton>
            {canvas && scene.shots.length > 0 && <CanvasButton size={32} title="Open the scene's shots in Canvas" onClick={() => canvas.scene(scene.id)} />}
          </>
        )}
      >
        <Draft className="st-bare" value={scene.title} onCommit={(v) => set((x) => ({ ...x, scenes: x.scenes.map((sc) => (sc.id === scene.id ? { ...sc, title: v } : sc)) }))} style={{ fontSize: 24, fontWeight: 700, padding: '0 4px', marginLeft: -4, color: C.ink, height: 36 }} />
      </PageHead>
      {!scene.shots.length && (
        <div style={{ border: `1px dashed ${C.lineHi}`, borderRadius: 14, padding: '56px 24px', display: 'grid', justifyItems: 'center', gap: 14, color: C.muted }}>
          <IconUpload style={{ fontSize: 26 }} />
          <div style={{ fontSize: 15, color: C.ink, fontWeight: 600 }}>Drop clips</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <UploadButton type="primary" accept="video/*" loading={!!importing} onFiles={importFiles}>Import footage</UploadButton>
            <Button onClick={addShot}>Write a shot</Button>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {scene.shots.map((sh) => {
          const on = scope.type === 'shot' && scope.id === sh.id;
          const take = pickedOf(sh.takes);
          const takes = (sh.takes.versions || []).filter((v) => v.status !== 'rejected');
          const stale = staleOf(s, sh);
          const hero = take;
          return (
            <div key={sh.id} role="button" className={on ? undefined : 'st-card'} onClick={() => selectShot(on ? null : sh.id)} style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: 10, borderRadius: 14, cursor: 'pointer', border: `1px solid ${on ? C.accent : C.line}`, background: on ? '#1d1a16' : C.raised, boxShadow: on ? `0 0 0 3px ${C.accentSoft}` : 'none' }}>
              <div style={{ position: 'relative', flex: '1 1 180px', maxWidth: 236 }}>
                {hero
                  ? <Tile v={hero} w="100%" badge={take ? takeBadge(take) : null} onClick={(e) => { e.stopPropagation(); review({ at: 'take', sceneId: scene.id, shotId: sh.id }, hero.id); }} />
                  : <div style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 6, background: '#0b0c0e', border: `1px solid ${C.line}`, display: 'grid', placeItems: 'center', fontFamily: MONO, fontSize: 22, fontWeight: 700, color: '#2c3038' }}>{pad2(shotNumber(s, sh.id))}</div>}
              </div>
              <div style={{ flex: '999 1 240px', minWidth: 0, display: 'grid', gap: 8, alignContent: 'start', padding: '2px 4px 2px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: C.accent }}>{pad2(shotNumber(s, sh.id))}</span>
                  {on
                    ? <span onClick={(e) => e.stopPropagation()} style={{ flex: 1 }}><Draft value={sh.title} onCommit={(v) => patchShot(sh.id, { title: v })} size="small" style={{ fontSize: 15, fontWeight: 600 }} /></span>
                    : <span style={{ fontSize: 15, fontWeight: 600, flex: 1, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sh.title}</span>}
                  {stale.length > 0 && <Pill color={C.warn} bg={C.warnSoft}>stale · {stale.join(', ')}</Pill>}
                  {sh.startFrom === 'previous' && shotNumber(s, sh.id) > 1 && <Pill color={C.text} bg="transparent" style={{ border: `1px solid ${C.line}` }}>from end of {pad2(shotNumber(s, sh.id) - 1)}</Pill>}
                  <Pill color={C.muted} bg="transparent" style={{ fontFamily: MONO, border: `1px solid ${C.line}` }}>{sh.seconds}s</Pill>
                  {canvas && <CanvasButton size={24} title={sh.boardCard ? 'Show its card in Canvas' : 'Open in Canvas'} onClick={() => canvas.shot(scene.id, sh.id)} />}
                  {on && <span role="button" className="st-ghost" title="Remove the shot" onClick={(e) => { e.stopPropagation(); removeShot(sh.id); selectShot(null); }} style={{ color: C.bad, cursor: 'pointer', fontSize: 12 }}>Remove</span>}
                </div>
                {on
                  ? <div onClick={(e) => e.stopPropagation()}><Label style={{ marginBottom: 4 }}>What happens · every take is made from this</Label><Draft area value={namedText(s, sh.motion)} onCommit={(v) => patchShot(sh.id, { motion: tokenized(s, v, sh.elementIds) })} autoSize={{ minRows: 3, maxRows: 12 }} placeholder="What happens in the shot" style={{ fontSize: 13.5, lineHeight: 1.6 }} />
                    {shotNumber(s, sh.id) > 1 && (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 12.5, color: sh.startFrom === 'previous' ? C.ink : C.muted, cursor: 'pointer' }}>
                        <input type="checkbox" checked={sh.startFrom === 'previous'} onChange={(e) => patchShot(sh.id, { startFrom: e.target.checked ? 'previous' : null })} style={{ accentColor: C.accent }} />
                        Starts where shot {pad2(shotNumber(s, sh.id) - 1)} ends
                      </label>
                    )}</div>
                  : <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{namedText(s, sh.motion) || sh.quote || (take?.footage ? <span style={{ color: C.muted }}>Your footage</span> : <span style={{ color: C.muted }}>Nothing written yet</span>)}</div>}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 'auto' }}>
                  {(sh.elementIds || []).map((id) => {
                    const el = findElement(s, id);
                    if (!el) return null;
                    const ok = !!pickedOf(el);
                    return <Pill key={id} color={ok ? C.text : C.warn} bg={ok ? C.panel : C.warnSoft} style={{ border: `1px solid ${C.line}` }}><span style={{ width: 6, height: 6, borderRadius: 2, background: KIND_COLOR[el.kind] }} />{el.name}</Pill>;
                  })}
                  <span style={{ flex: 1 }} />
                  {takes.length > 1 && takes.map((v) => (
                    <span key={v.id} onClick={(e) => e.stopPropagation()}>
                      <Tile v={v} w={60} badge={takeBadge(v)} picked={sh.takes.picked === v.id} onClick={() => review({ at: 'take', sceneId: scene.id, shotId: sh.id }, v.id)} />
                    </span>
                  ))}
                  {take && <IconStarFill style={{ color: C.gold }} title="Circled" />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </DropArea>
  );
};

// ---- CUT --------------------------------------------------------------------------------------
const CutPage = ({ s, review, selectScene }) => {
  const cut = pickedOf(s.cut) || [...(s.cut.versions || [])].reverse().find((v) => v.status === 'review' || v.status === 'running');
  const shots = s.scenes.flatMap((sc) => sc.shots);
  const circled = shots.filter((sh) => pickedOf(sh.takes));
  const total = circled.reduce((n, sh) => n + (Number(sh.seconds) || 0), 0);
  return (
    <>
      <PageHead
        title="Cut"
        sub={`${total} s · ${circled.length} of ${plural(shots.length, 'shot')} circled`}
        right={(
          <>
            {cut && cut.status === 'review' && <Button type="primary" onClick={() => review({ at: 'cut' }, cut.id)}>Review</Button>}
            {cut && mediaOf(cut) && cut.status !== 'running' && <Button icon={<IconDownload />} href={mediaOf(cut)} download>{cut.format === 'mov' ? 'MOV' : 'MP4'}</Button>}
          </>
        )}
      />
      {cut && cut.status !== 'running' && mediaOf(cut)
        ? <video key={mediaOf(cut)} src={mediaOf(cut)} controls style={{ width: '100%', maxHeight: 520, background: '#000', borderRadius: 14, display: 'block' }} />
        : <div style={{ aspectRatio: '16 / 9', maxHeight: 520, width: '100%', background: '#050607', border: `1px solid ${C.line}`, borderRadius: 14, display: 'grid', placeItems: 'center', color: cut?.status === 'running' ? C.work : C.muted }}><span className={cut?.status === 'running' ? 'st-pulse' : undefined}>{cut?.status === 'running' ? 'Assembling…' : 'No cut yet'}</span></div>}
      <div style={{ marginTop: 22, display: 'grid', gap: 14 }}>
        {s.scenes.map((sc) => (
          <div key={sc.id}>
            <Label>{sc.title}</Label>
            <div style={{ display: 'flex', gap: 3 }}>
              {sc.shots.map((sh) => {
                const t = pickedOf(sh.takes);
                const label = `${pad2(shotNumber(s, sh.id))} ${sh.title}`;
                const box = { flex: `${Math.max(1, Number(sh.seconds) || 1)} 1 0`, minWidth: 44, height: 58, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', position: 'relative' };
                return t ? (
                  <div key={sh.id} role="button" title={label} onClick={() => review({ at: 'take', sceneId: sc.id, shotId: sh.id }, t.id)} style={{ ...box, background: '#08090b', boxShadow: `inset 0 0 0 1px ${C.line}` }}>
                    {t.posterUrl ? <img src={t.posterUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <video src={mediaOf(t)} preload="metadata" muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    <span style={{ position: 'absolute', left: 4, bottom: 3, fontFamily: MONO, fontSize: 10, fontWeight: 700, color: '#fff', textShadow: '0 1px 2px #000' }}>{pad2(shotNumber(s, sh.id))}</span>
                  </div>
                ) : (
                  <div key={sh.id} role="button" title={label} onClick={() => selectScene(sc.id, sh.id)} style={{ ...box, border: `1px dashed ${C.warn}`, background: C.warnSoft, display: 'grid', placeItems: 'center', fontFamily: MONO, fontSize: 10.5, color: C.warn }}>{pad2(shotNumber(s, sh.id))}</div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

// ---- THREAD + COMPOSER ----------------------------------------------------------------------
const who = crewWho;
const From = ({ id, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '26px minmax(0, 1fr)', gap: 9, alignItems: 'start' }}>
    <Avatar id={id} size={26} />
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: crewColor(id), marginBottom: 4, lineHeight: '14px', paddingTop: 1 }}>{who(id)}</div>
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
      <span style={open ? undefined : { display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{text}</span>
      <span role="button" onClick={() => setOpen((o) => !o)} style={{ display: 'block', marginTop: 4, fontSize: 12, color: C.text, cursor: 'pointer', textDecoration: 'underline' }}>{open ? 'less' : 'more'}</span>
    </>
  );
};
const Message = ({ s, m, approve, cancel, answer, review, setText, undo }) => {
  if (m.from === 'you') {
    const agent = crewById(m.agent);
    const action = agent?.actions.find((a) => a.id === m.action) || null;
    return (
      <div style={{ justifySelf: 'end', maxWidth: '88%', background: C.accentSoft, border: '1px solid rgba(255,150,38,0.22)', borderRadius: '12px 12px 4px 12px', padding: '8px 11px', fontSize: 13, color: C.ink, lineHeight: 1.5 }}>
        {/* A button (Final) reads as what you pressed, not as an @ request. */}
        {agent?.id === 'shot' ? null : action?.button
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
  if (m.kind === 'sheet') {
    const sh = s.sheets.find((x) => x.id === m.sheetId);
    if (!sh) return null;
    const pending = sh.status === 'pending';
    return (
      <From id={sh.req.agent}>
        <div style={{ border: `1px solid ${pending ? C.accent : C.line}`, background: C.raised, borderRadius: 12, overflow: 'hidden', fontSize: 13 }}>
          <div style={{ padding: '7px 11px', fontSize: 10.5, fontWeight: 700, letterSpacing: 1.1, color: pending ? C.accent : C.muted, background: pending ? C.accentSoft : 'transparent', borderBottom: `1px solid ${C.line}` }}>CALL SHEET</div>
          <div style={{ padding: '6px 11px', display: 'grid', gap: 3 }}>
            {sh.jobs.slice(0, 8).map((j, i) => <div key={i} style={{ display: 'flex', gap: 8, color: C.ink }}><span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.label}</span><span style={{ color: C.muted, fontSize: 12 }}>{j.detail}</span></div>)}
            {sh.jobs.length > 8 && <div style={{ color: C.muted }}>+{sh.jobs.length - 8} more</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px', borderTop: `1px solid ${C.line}` }}>
            <b style={{ flex: 1, fontWeight: 600, color: C.ink }}>{sh.summary}</b>
            {pending
              ? <><Button size="small" onClick={() => cancel(sh.id)}>Cancel</Button><Button size="small" type="primary" onClick={() => approve(sh.id)}>Approve</Button></>
              : <span style={{ color: sh.status === 'cancelled' ? C.muted : C.good, fontSize: 12, fontWeight: 600 }}>{sh.status === 'cancelled' ? 'Cancelled' : '✓ Approved'}</span>}
          </div>
        </div>
      </From>
    );
  }
  if (m.kind === 'question') {
    return (
      <From id={m.from}>
        <div style={{ background: C.warnSoft, border: '1px solid rgba(255,122,89,0.25)', borderRadius: 12, padding: '9px 11px', fontSize: 13 }}>
          <div style={{ color: C.ink, lineHeight: 1.5 }}>{m.text}</div>
          {m.answered
            ? <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>→ {m.answered}</div>
            : <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>{(m.options || []).map((o, i) => <Button key={i} size="small" type={i === 0 ? 'primary' : 'secondary'} onClick={() => answer(m, o)}>{o.label}</Button>)}</div>}
        </div>
      </From>
    );
  }
  if (m.kind === 'ask') {
    return (
      <div style={{ fontSize: 13 }}>
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
        <div style={{ fontSize: 13.5, color: C.ink, lineHeight: 1.55 }}>{m.text}</div>
        {(ch || (m.unknown || []).length > 0) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 7, fontSize: 12, opacity: m.undone ? 0.5 : 1 }}>
            {ch?.text && <Pill color={C.accent} bg={C.accentSoft}>prompt updated</Pill>}
            {(ch?.added || []).map((n) => <Pill key={`+${n}`} color={C.good} bg={C.goodSoft}>+ {n}</Pill>)}
            {(ch?.removed || []).map((n) => <Pill key={`-${n}`} color={C.muted} bg={C.raised} style={{ textDecoration: 'line-through' }}>{n}</Pill>)}
            {(m.unknown || []).map((n) => <Pill key={`?${n}`} color={C.warn} bg={C.warnSoft}>no {n} in Cast & World</Pill>)}
            {ch && (m.undone
              ? <span style={{ color: C.muted }}>undone</span>
              : <span role="button" className="st-ghost" onClick={() => undo(m)} style={{ color: C.text, cursor: 'pointer', textDecoration: 'underline' }}>Undo</span>)}
          </div>
        )}
      </From>
    );
  }
  if (m.kind === 'error') return <From id={m.from}><div style={{ fontSize: 13, color: C.bad, lineHeight: 1.5 }}>{m.text}</div></From>;
  if (m.kind === 'delivery') {
    const items = (m.items || []).map((it) => ({ ...it, v: (containerOf(s, it.ref)?.versions || []).find((x) => x.id === it.vid) })).filter((it) => it.v);
    if (!items.length) {
      return m.finished ? null : (
        <From id={m.from}><span className="st-pulse" style={{ fontSize: 12.5, color: C.work }}>working…</span></From>
      );
    }
    const textual = items.filter((it) => ['script', 'scriptBreakdown', 'breakdown'].includes(it.v.kind));
    return (
      <From id={m.from}>
        <div style={{ display: 'grid', gap: 6 }}>
          {textual.map((it) => (
            <div key={it.vid} role="button" className="st-card" onClick={() => it.v.status !== 'running' && review(it.ref, it.vid)} style={{ border: `1px solid ${it.v.status === 'review' ? 'rgba(255,122,89,0.45)' : C.line}`, background: C.raised, borderRadius: 10, padding: '8px 11px', cursor: 'pointer', fontSize: 13, color: it.v.status === 'failed' ? C.bad : C.ink, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ flex: 1, minWidth: 0, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {it.v.status === 'running' ? <span className="st-pulse" style={{ color: C.work }}>working…</span> : it.v.status === 'failed' ? it.v.error : it.v.kind === 'script' ? (it.v.title || 'Script') : it.v.kind === 'scriptBreakdown' ? `Script breakdown · ${(it.v.payload?.scenes || []).length} scenes` : `${(it.v.payload?.scenes || []).length} scene sheets`}
              </span>
              {it.v.status === 'review' && <span style={{ fontSize: 11, fontWeight: 700, color: C.warn }}>Review</span>}
              {it.v.status === 'picked' && <IconStarFill style={{ color: C.gold }} />}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {items.filter((it) => !textual.includes(it)).map((it) => <Tile key={it.vid} v={it.v} w={it.v.kind === 'plate' ? 68 : 104} ratio={it.v.kind === 'plate' ? '1' : '16 / 9'} picked={it.v.status === 'picked'} onClick={it.v.status === 'review' || it.v.status === 'picked' ? () => review(it.ref, it.vid) : undefined} />)}
          </div>
        </div>
      </From>
    );
  }
  return null;
};

const Composer = ({ s, scope, onSend, text, setText, target }) => {
  const element = scope.type === 'element' ? findElement(s, scope.id) : null;
  const avail = actionsFor(scope, element);
  const box = useRef(null);
  const atWord = /^@(\w*)$/.exec(text.trim());
  const suggest = atWord ? avail.filter(({ agent }) => agent.handle.toLowerCase().startsWith(atWord[1].toLowerCase())) : [];
  const send = () => { if (text.trim()) { onSend(text); setText(''); } };
  const hint = (() => { const r = parseRequest(text, scope, element); return r.action?.hint || ''; })();
  return (
    <div ref={box} style={{ position: 'relative' }}>
      {suggest.length > 0 && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6, background: C.raised, border: `1px solid ${C.lineHi}`, borderRadius: 10, padding: 4, zIndex: 5, boxShadow: '0 12px 30px rgba(0,0,0,0.45)' }}>
          {suggest.map(({ agent, action }) => (
            <div key={`${agent.id}.${action.id}`} role="button" className="st-row" onClick={() => setText(`@${agent.handle} `)} style={{ padding: '5px 8px', cursor: 'pointer', fontSize: 13, borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, color: C.ink }}>
              <Avatar id={agent.id} size={20} /><b style={{ color: crewColor(agent.id), fontWeight: 600 }}>@{agent.handle}</b><span style={{ color: C.muted }}>{action.label.toLowerCase()}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ background: C.raised, border: `1px solid ${C.line}`, borderRadius: 12, padding: '6px 6px 6px 4px', display: 'flex', alignItems: 'flex-end', gap: 4 }}>
        <Input.TextArea
          className="st-bare" value={text} onChange={setText} autoSize={{ minRows: 1, maxRows: 6 }}
          onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={!avail.length ? 'Nothing to ask here' : target ? `Talk to ${target} — or @ for the crew` : '@ to call the crew'}
          style={{ fontSize: 13.5, lineHeight: 1.5 }}
        />
        <Button type="primary" shape="circle" size="small" icon={<IconSend />} disabled={!text.trim()} onClick={send} style={{ flex: '0 0 auto', marginBottom: 2 }} />
      </div>
      {hint && <div style={{ fontSize: 11.5, color: C.muted, padding: '5px 4px 0' }}>{hint}</div>}
    </div>
  );
};

export const scopeTitle = (s, scope) => {
  if (scope.type === 'brief') return 'Brief';
  if (scope.type === 'world') return 'Cast & World';
  if (scope.type === 'element') return findElement(s, scope.id)?.name || '';
  if (scope.type === 'scene') return findScene(s, scope.id)?.title || '';
  if (scope.type === 'shot') return findScene(s, scope.sceneId)?.title || '';
  if (scope.type === 'cut') return 'Cut';
  return '';
};

export const Thread = ({ s, scope, target, onClearTarget, onRequest, approve, cancel, answer, review, ask, text, setText, undoShot }) => {
  const key = threadKeyOf(scope);
  const msgs = s.threads[key] || [];
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  const element = scope.type === 'element' ? findElement(s, scope.id) : null;
  const send = (raw) => {
    const r = parseRequest(raw, scope, element);
    // At a shot, words without an @ are for the shot itself.
    if (!r.agent && scope.type === 'shot') {
      const shot = crewById('shot');
      onRequest({ agent: shot, action: shot.actions[0], text: String(raw).trim() }, raw);
      return;
    }
    if (!r.agent) { ask(scope, raw, actionsFor(scope, element)); return; }
    onRequest(r, raw);
  };
  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', height: '100%', minHeight: 0, background: C.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: `1px solid ${C.line}`, minHeight: 49 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Crew</span>
        <span style={{ fontSize: 12, color: C.muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scopeTitle(s, scope)}</span>
        {target && <Pill color={C.accent} bg={C.accentSoft} style={{ maxWidth: 160, overflow: 'hidden' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{target}</span><IconClose style={{ cursor: 'pointer', flex: '0 0 auto' }} onClick={onClearTarget} /></Pill>}
      </div>
      <div style={{ overflowY: 'auto', padding: 14, display: 'grid', gap: 14, alignContent: 'start' }}>
        {!msgs.length && <Empty>{target ? `Talk to ${target}, or @ to call the crew` : 'Type @ to call the crew'}</Empty>}
        {msgs.map((m) => <Message key={m.id} s={s} m={m} approve={approve} cancel={cancel} answer={(msg, o) => answer(key, msg, o)} review={review} setText={setText} undo={(msg) => undoShot(key, msg)} />)}
        <div ref={end} />
      </div>
      <div style={{ padding: 12, borderTop: `1px solid ${C.line}` }}>
        <Composer s={s} scope={scope} text={text} setText={setText} onSend={send} target={target} />
      </div>
    </div>
  );
};

// ---- the Direct page for the current scope -----------------------------------------------------
export const DirectPage = ({ s, set, scope, setScope, pick, review, toast, crew, canvas, plan, onGo, busy }) => {
  if (scope.type === 'brief') return <BriefPage s={s} set={set} toast={toast} plan={plan} onGo={onGo} busy={busy} />;
  if (scope.type === 'world') return <WorldPage s={s} set={set} open={setScope} toast={toast} />;
  if (scope.type === 'element') {
    const el = findElement(s, scope.id);
    return el ? <ElementPage s={s} set={set} el={el} pick={pick} toast={toast} open={setScope} canvas={canvas} /> : <Empty>Gone.</Empty>;
  }
  if (scope.type === 'scene' || scope.type === 'shot') {
    const sceneId = scope.type === 'scene' ? scope.id : scope.sceneId;
    const scene = findScene(s, sceneId);
    if (!scene) return <Empty>Gone.</Empty>;
    return <ScenePage s={s} set={set} scene={scene} scope={scope} review={review} toast={toast} canvas={canvas} crew={crew} selectShot={(id) => setScope(id ? { type: 'shot', sceneId, id } : { type: 'scene', id: sceneId })} />;
  }
  if (scope.type === 'cut') return <CutPage s={s} review={review} selectScene={(sceneId, id) => setScope({ type: 'shot', sceneId, id })} />;
  return null;
};
export const scopeTarget = (s, scope) => (scope.type === 'shot' ? (() => { const sh = findShot(s, scope.sceneId, scope.id); return sh ? `${pad2(shotNumber(s, sh.id))} ${sh.title}` : ''; })() : '');
