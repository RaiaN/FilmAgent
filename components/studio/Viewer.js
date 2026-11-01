import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Input, Menu } from '@arco-design/web-react';
import { IconClose, IconStarFill } from '@arco-design/web-react/icon';
import { C, MONO, SCRIPT_FONT, Label, CanvasButton, mediaOf, isVideo, Tile } from './ui';
import { containerOf, latestOf, patchVersion, pickedOf, videoModelLabel, visible, withParentPoster } from '../../utils/film/studio/model';
import { DRAFT_MODE, draftFinalsOf } from '../../utils/film/suiteConfig';
import { containerLabel } from '../../utils/film/studio/layout';
import { InputsPanel, inputsOf } from './Refs';
import { usePlayable } from '../film/usePlayable';
import { ShotList } from './ShotList';
import { shotsOf } from '../../utils/film/core/shotList';

// THE VIEWER — one version, big: Pick a plate, Edit from a note, Rework, Reject, and Final on a draft. It opens over whatever you are on, and closing it puts you back.
export const TEXT_KINDS = ['script', 'shotList', 'blocking'];

// A scene's shots as the 1st AD planned them: one line each; how the AD got there (where the
// camera stands, landmarks, start, end, what everyone looks at) folds away under Details.
const Blocking = ({ p }) => {
  const row = (k, val) => (val ? <div style={{ display: 'grid', gridTemplateColumns: '96px minmax(0, 1fr)', gap: 10, fontSize: 12.5, lineHeight: 1.6 }}><span style={{ color: C.muted }}>{k}</span><span style={{ color: C.text }}>{val}</span></div> : null);
  return (
    <div style={{ display: 'grid', gap: 10, background: C.raised, border: `1px solid ${C.line}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 12.5, color: C.muted }}>One take · {p.seconds}s</div>
      {shotsOf(p).map((sh, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 6, fontSize: 13.5, lineHeight: 1.55 }}>
          <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted, paddingTop: 1 }}>{i + 1}</span>
          <span><span style={{ color: C.muted }}>{sh.view} — </span><span style={{ color: C.ink }}>{sh.action}</span></span>
        </div>
      ))}
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: C.muted }}>Details</summary>
        <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>
          {p.views.map((vw, i) => <div key={i}>{row(i ? '' : 'Camera', <><b style={{ color: C.ink, fontWeight: 600 }}>{vw.name}</b> — {vw.from}</>)}</div>)}
          {row('Landmarks', p.landmarks)}
          {row('Start', p.start)}
          {p.beats.map((b, i) => <div key={i}>{row(i ? '' : 'Eyes on', `${b.view}: ${b.looksAt}`)}</div>)}
          {row('Against', p.against)}
          {row('Sound', p.sound)}
          {row('End', p.end)}
        </div>
      </details>
    </div>
  );
};

// A version shown big: a take or cut plays (and tells the note its time), a plate shows, text reads.
const MEDIA_HEIGHT = 'max(240px, calc(100vh - 290px))';
const MOV = /\.mov(\?|$)|key=[^&]+\.mov/i;
// A take plays from what the browser can play: a 10-bit master through its viewing copy.
const Player = ({ v, onTime, onCopy }) => {
  const ref = useRef(null);
  const format = v.format || (MOV.test(mediaOf(v)) ? 'mov' : '');
  const { url, problem } = usePlayable({ url: mediaOf(v), type: 'video', format, playUrl: v.playUrl }, onCopy);
  if (problem) return <div style={{ minHeight: 160, background: '#1a0f10', borderRadius: 12, display: 'grid', placeItems: 'center', color: C.bad, padding: 24, textAlign: 'center' }}>{problem}</div>;
  if (!url) return <div style={{ aspectRatio: '16 / 9', maxHeight: MEDIA_HEIGHT, background: '#050607', borderRadius: 14, display: 'grid', placeItems: 'center', color: C.work }}><span className="st-pulse">Preparing a copy to watch</span></div>;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <video ref={ref} key={url} src={url} controls onTimeUpdate={() => onTime && onTime(ref.current?.currentTime || 0)} onPause={() => onTime && onTime(ref.current?.currentTime || 0)} style={{ width: '100%', maxHeight: MEDIA_HEIGHT, background: '#000', borderRadius: 14, display: 'block' }} />
      {format === 'mov' && <span style={{ fontSize: 12, color: C.muted, textAlign: 'center' }}>Watching a copy. The master stays 10-bit MOV.</span>}
    </div>
  );
};
const Big = ({ v, onTime, onCopy }) => {
  if (!v) return null;
  if (v.status === 'running') return <div style={{ aspectRatio: '16 / 9', background: '#050607', border: `1px solid ${C.line}`, borderRadius: 12, display: 'grid', placeItems: 'center', color: C.work }}><span className="st-pulse">Working…</span></div>;
  if (v.status === 'failed') return <div style={{ minHeight: 160, background: '#1a0f10', border: `1px solid ${C.line}`, borderRadius: 12, display: 'grid', placeItems: 'center', color: C.bad, padding: 24, textAlign: 'center' }}>{v.error || 'Failed'}</div>;
  if (v.kind === 'script') return <pre style={{ whiteSpace: 'pre-wrap', fontFamily: SCRIPT_FONT, fontSize: 13.5, lineHeight: 1.7, margin: '0 auto', padding: '48px 64px', maxWidth: 960, boxSizing: 'border-box', background: C.page, color: '#e9e4da', border: `1px solid ${C.line}`, borderRadius: 12 }}>{v.text}</pre>;
  if (v.kind === 'shotList') return v.payload ? <div style={{ margin: '0 auto', maxWidth: 960 }}><ShotList list={v.payload} /></div> : null;
  if (v.kind === 'blocking') return v.payload ? <Blocking p={v.payload} /> : null;
  if (isVideo(v)) return <Player v={v} onTime={onTime} onCopy={onCopy} />;
  return <img src={mediaOf(v)} alt="" style={{ width: '100%', maxHeight: MEDIA_HEIGHT, objectFit: 'contain', background: '#050607', borderRadius: 14, display: 'block' }} />;
};

// What the checks found wrong; what passed stays out of the way.
const Flags = ({ v }) => {
  const warned = (v?.flags || []).filter((f) => f.warn);
  return warned.length ? <div style={{ display: 'grid', gap: 4 }}>{warned.map((f, i) => <div key={i} style={{ fontSize: 14, color: C.warn, lineHeight: 1.45 }}>{f.text}</div>)}</div> : null;
};

// Every version of the container, oldest → newest. On a shot a click adds a take to the comparison or
// takes it out; elsewhere it shows that version.
const Versions = ({ c, vid, onSelect, kind, shownIds }) => {
  const textual = TEXT_KINDS.includes(kind);
  const list = (c?.versions || []).filter((v) => (visible(v) || v.id === vid) && (!textual || v.kind === kind));
  if (list.length < 2) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, overflowX: 'auto', padding: '2px 12px 10px', flex: '0 0 auto' }}>
      {shownIds && <span style={{ fontSize: 13, color: C.text, flex: '0 0 auto', marginRight: 4 }}>Add takes to compare</span>}
      {list.map((v, i) => {
        const on = shownIds ? shownIds.includes(v.id) : v.id === vid;
        return (
          <div key={v.id} role="button" aria-pressed={on} title={shownIds ? `${on ? 'Take out' : 'Compare'} ${v.name || ''}` : undefined} onClick={() => onSelect(v.id)} style={{ position: 'relative', cursor: 'pointer', flex: '0 0 auto', opacity: v.status === 'rejected' ? 0.4 : 1, borderRadius: 7, boxShadow: on ? `0 0 0 2px ${C.accent}` : 'none' }}>
            {textual
              ? <span style={{ width: 64, height: 36, borderRadius: 6, display: 'grid', placeItems: 'center', fontFamily: MONO, fontSize: 12, background: C.raised, color: C.ink }}>v{i + 1}</span>
              : <Tile v={withParentPoster(c, v)} w={v.kind === 'plate' ? 52 : 92} ratio={v.kind === 'plate' ? '1' : '16 / 9'} picked={v.kind === 'plate' && v.status === 'picked'} badge={v.kind === 'plate' && v.status === 'review' ? 'NEW' : null} />}
            {shownIds && <span style={{ position: 'absolute', right: 3, top: 3, width: 18, height: 18, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, background: on ? C.accent : 'rgba(8,9,11,0.8)', color: on ? C.accentInk : '#fff' }}>{on ? '✓' : '+'}</span>}
          </div>
        );
      })}
    </div>
  );
};

export const Viewer = ({ s, set, toast, view, setView, onPick, onNote, onRework, onFrame, onFinal, onReject, canvas }) => {
  const [note, setNote] = useState('');
  const [time, setTime] = useState(null);
  const [anchor, setAnchor] = useState(false);
  // On a shot, the takes on screen side by side. The one you act on is outlined.
  const [extra, setExtra] = useState([]);
  const [details, setDetails] = useState(false);
  const ref_ = view.ref;
  const c = containerOf(s, ref_);
  const v = (c?.versions || []).find((x) => x.id === view.vid) || null;
  useEffect(() => { setNote(''); setAnchor(false); setTime(null); }, [view.vid]);
  useEffect(() => { setExtra([]); }, [view.ref.shotId]);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') setView(null); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [setView]);
  if (!v) return null;
  const onShot = ref_.at === 'take';
  const latest = onShot ? latestOf(c) : null;
  const shownIds = onShot ? [...new Set([v.id, ...extra])] : [v.id];
  const shown = (c?.versions || []).filter((x) => shownIds.includes(x.id)).sort((a, b) => (b.at || 0) - (a.at || 0));
  // A copy once made is the film's, so it never has to be made again.
  const keepCopy = (x) => (playUrl) => set((film) => patchVersion(film, ref_, x.id, { playUrl }));
  const toggleTake = (id) => {
    if (id === v.id) {
      const next = shownIds.find((y) => y !== id);
      if (next) { setExtra((x) => x.filter((y) => y !== id)); setView({ ref: ref_, vid: next }); }
      return;
    }
    setExtra((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  };
  const isTake = ref_.at === 'take' || ref_.at === 'cut';
  const textual = TEXT_KINDS.includes(v.kind);
  const hasDetails = !textual && (v.prompt || inputsOf(s, v).length > 0);
  const warned = (v.flags || []).some((f) => f.warn);
  // A draft finishes as the same picture in MOV, on the model that drafted it, at a resolution
  // that model offers (2.5: 1080p · Premium: 1080p or 4K), within the draft's 7 days.
  const finishable = ref_.at === 'take' && v.draft?.taskId && v.status !== 'running' && v.status !== 'failed';
  const finalsOf = finishable ? c.versions.filter((x) => x.final && x.parent === v.id && x.status !== 'failed') : [];
  const expired = finishable && Date.now() - v.draft.at >= DRAFT_MODE.ttlMs;
  const finalRes = finishable ? draftFinalsOf(v.draft.modelKey || 'seedance25') : [];
  const send = () => {
    const t = note.trim();
    if (!t) return;
    onNote(ref_, v, anchor && time != null ? `At ${time.toFixed(1)} s: ${t}` : t);
    setNote('');
    setView(null);
  };
  return (
    <div role="dialog" aria-label={containerLabel(s, ref_)} onClick={() => setView(null)} style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(5,6,8,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'stretch', overflow: 'hidden', padding: 10 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 1760, display: 'flex', flexDirection: 'column', background: C.panel, border: `1px solid ${C.lineHi}`, borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 8px 18px', flex: '0 0 auto' }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: C.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name ? <span style={{ fontFamily: MONO, color: C.accent, marginRight: 8 }}>{v.name}</span> : null}{containerLabel(s, ref_)}</span>
          <span style={{ fontSize: 13, color: C.muted, flex: '0 0 auto' }}>{[v.res, v.model === 'seedance25Premium' ? 'Premium' : '', v.format === 'mov' ? 'MOV' : ''].filter(Boolean).join(' · ')}</span>
          <span style={{ flex: 1 }} />
          {hasDetails && <Button type={details ? 'primary' : 'secondary'} onClick={() => setDetails((o) => !o)}>Prompt</Button>}
          {canvas && !textual && mediaOf(v) && <CanvasButton size={32} onClick={() => canvas.version(ref_, v, containerLabel(s, ref_))} />}
          <Button type="text" icon={<IconClose />} onClick={() => setView(null)} aria-label="Close" />
        </div>
        <div key={v.id} style={{ display: 'grid', gridTemplateColumns: details ? 'minmax(0, 1fr) minmax(260px, 340px)' : 'minmax(0, 1fr)', minHeight: 0, flex: '1 1 auto', overflow: 'hidden' }}>
          <div style={{ padding: '0 12px 10px', overflowY: 'auto', minHeight: 0, display: 'grid', alignContent: textual ? 'start' : 'center' }}>
            {shown.length > 1 ? (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(shown.length, 3)}, minmax(0, 1fr))`, gap: 10 }}>
                {shown.map((x) => (
                  <div key={x.id} role="button" onClick={() => { setExtra((e) => [...new Set([...e, v.id])]); setView({ ref: ref_, vid: x.id }); }} style={{ display: 'grid', gap: 6, padding: 6, borderRadius: 16, cursor: 'pointer', boxShadow: x.id === v.id ? `inset 0 0 0 2px ${C.accent}` : 'none' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: x.id === v.id ? C.accent : C.text }}>{x.name}{x.id === latest?.id ? ' · Latest' : ''}{x.res ? ` · ${x.res}` : ''}</span>
                    <Big v={x} onTime={x.id === v.id ? setTime : undefined} onCopy={keepCopy(x)} />
                  </div>
                ))}
              </div>
            ) : <Big v={v} onTime={setTime} onCopy={keepCopy(v)} />}
          </div>
          {details && (
            <div style={{ borderLeft: `1px solid ${C.line}`, padding: 16, overflowY: 'auto', minHeight: 0, display: 'grid', gap: 16, alignContent: 'start' }}>
              <InputsPanel s={s} v={v} />
            </div>
          )}
        </div>
        {warned && <div style={{ padding: '0 18px 8px', flex: '0 0 auto' }}><Flags v={v} /></div>}
        <Versions c={c} vid={v.id} kind={v.kind} shownIds={onShot ? shownIds : null} onSelect={onShot ? toggleTake : (vid) => setView({ ref: ref_, vid })} />
        {v.status !== 'running' && v.status !== 'failed' && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: C.raised, borderTop: `1px solid ${C.line}`, padding: '10px 14px', flexWrap: 'wrap', flex: '0 0 auto' }}>
            {!isTake && (v.status !== 'picked' ? <Button size="large" type="primary" icon={<IconStarFill />} onClick={() => onPick(ref_, v)} style={{ minWidth: 128 }}>Pick</Button> : <span style={{ color: C.gold, fontWeight: 700, fontSize: 15, padding: '0 8px' }}>★ Picked</span>)}
            {isVideo(v) && time != null && <Button size="large" type={anchor ? 'primary' : 'secondary'} onClick={() => setAnchor((a) => !a)}>at {time.toFixed(1)} s</Button>}
            <Input size="large" value={note} onChange={setNote} onPressEnter={send} placeholder={isVideo(v) ? 'What should change in this take' : 'What should change in this picture'} style={{ flex: '1 1 260px', fontSize: 15 }} />
            <Button size="large" disabled={!note.trim()} onClick={send}>{isVideo(v) ? 'Edit' : 'Edit picture'}</Button>
            {ref_.at !== 'cut' && isVideo(v) && <Button size="large" onClick={() => { onRework(ref_, v); setView(null); }}>Rework</Button>}
            {isVideo(v) && (
              <Dropdown trigger="click" position="top" droplist={(
                <Menu onClickMenuItem={(how) => onFrame(ref_, v, time || 0, how)}>
                  <Menu.Item key="here">Continue from {(time || 0).toFixed(1)} s</Menu.Item>
                  <Menu.Item key="last">Continue from the last frame</Menu.Item>
                  <Menu.Item key="keep">Keep this frame</Menu.Item>
                </Menu>
              )}><Button size="large">Frame</Button></Dropdown>
            )}
            {finalRes.map((res) => <Button key={res} size="large" onClick={() => onFinal(ref_, v, res)} disabled={expired} title={expired ? 'Drafts finish within 7 days — draft the shot again' : `The same picture at ${res} MOV · ${videoModelLabel(v.draft.modelKey || 'seedance25')}`}>{finalsOf.length ? 'Final again' : 'Final'} · {res}</Button>)}
            {v.status !== 'rejected' && <Button size="large" icon={<IconClose />} status="danger" onClick={() => onReject(ref_, v)}>Remove</Button>}
          </div>
        )}
      </div>
    </div>
  );
};
