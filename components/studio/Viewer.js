import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@arco-design/web-react';
import { IconClose, IconStarFill, IconRight } from '@arco-design/web-react/icon';
import { C, MONO, SCRIPT_FONT, Label, Avatar, CanvasButton, crewColor, crewWho, mediaOf, isVideo, Tile } from './ui';
import { containerOf, findShot, pickedOf, videoModelLabel, visible } from '../../utils/film/studio/model';
import { DRAFT_MODE, draftFinalsOf } from '../../utils/film/suiteConfig';
import { containerLabel } from '../../utils/film/studio/runners';
import { editorFor } from '../../utils/film/studio/crew';
import { InputsPanel, RefsEditor, inputsOf } from './Refs';
import { ShotList } from './ShotList';
import { shotsOf } from '../../utils/film/core/shotList';

// THE VIEWER — one version, big, with your verdict: Pick (Circle a take) · Note (the agent that
// made it makes the next version) · Reject, and Final on a draft. It opens over whatever you
// are on — from the crew feed, a shot card, Cast & World or Generations — and closing it puts
// you back. "Next new" walks everything still waiting for you, oldest first.
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
const MEDIA_HEIGHT = 'calc(100vh - 300px)';
const Big = ({ v, onTime }) => {
  const ref = useRef(null);
  if (!v) return null;
  if (v.status === 'running') return <div style={{ aspectRatio: '16 / 9', background: '#050607', border: `1px solid ${C.line}`, borderRadius: 12, display: 'grid', placeItems: 'center', color: C.work }}><span className="st-pulse">Working…</span></div>;
  if (v.status === 'failed') return <div style={{ minHeight: 160, background: '#1a0f10', border: `1px solid ${C.line}`, borderRadius: 12, display: 'grid', placeItems: 'center', color: C.bad, padding: 24, textAlign: 'center' }}>{v.error || 'Failed'}</div>;
  if (v.kind === 'script') return <pre style={{ whiteSpace: 'pre-wrap', fontFamily: SCRIPT_FONT, fontSize: 13.5, lineHeight: 1.7, margin: '0 auto', padding: '48px 64px', maxWidth: 960, boxSizing: 'border-box', background: C.page, color: '#e9e4da', border: `1px solid ${C.line}`, borderRadius: 12 }}>{v.text}</pre>;
  if (v.kind === 'shotList') return v.payload ? <div style={{ margin: '0 auto', maxWidth: 960 }}><ShotList list={v.payload} /></div> : null;
  if (v.kind === 'blocking') return v.payload ? <Blocking p={v.payload} /> : null;
  if (isVideo(v)) return <video ref={ref} key={mediaOf(v)} src={mediaOf(v)} controls onTimeUpdate={() => onTime && onTime(ref.current?.currentTime || 0)} onPause={() => onTime && onTime(ref.current?.currentTime || 0)} style={{ width: '100%', maxHeight: MEDIA_HEIGHT, background: '#000', borderRadius: 14, display: 'block' }} />;
  return <img src={mediaOf(v)} alt="" style={{ width: '100%', maxHeight: MEDIA_HEIGHT, objectFit: 'contain', background: '#050607', borderRadius: 14, display: 'block' }} />;
};

// What the checks found wrong; what passed stays out of the way.
const Flags = ({ v }) => {
  const warned = (v?.flags || []).filter((f) => f.warn);
  return warned.length ? <div style={{ display: 'grid', gap: 4 }}>{warned.map((f, i) => <div key={i} style={{ fontSize: 14, color: C.warn, lineHeight: 1.45 }}>{f.text}</div>)}</div> : null;
};

const STATUS = { review: ['new', C.warn], picked: ['★', C.gold], running: ['working', C.work], failed: ['failed', C.bad], rejected: ['rejected', C.muted] };
// Every version of the container, oldest → newest; the one on screen outlined.
const Versions = ({ c, vid, onSelect, kind }) => {
  const textual = TEXT_KINDS.includes(kind);
  const list = (c?.versions || []).filter((v) => (visible(v) || v.id === vid) && (!textual || v.kind === kind));
  if (list.length < 2) return null;
  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
      {list.map((v, i) => {
        const [word, color] = STATUS[v.status] || ['', C.muted];
        return (
          <div key={v.id} role="button" onClick={() => onSelect(v.id)} style={{ display: 'grid', gap: 4, justifyItems: 'center', cursor: 'pointer', opacity: v.status === 'rejected' ? 0.4 : 1 }}>
            {textual
              ? <span style={{ width: 64, height: 36, borderRadius: 6, display: 'grid', placeItems: 'center', fontFamily: MONO, fontSize: 12, background: C.raised, boxShadow: v.id === vid ? `0 0 0 2px ${C.accent}` : `inset 0 0 0 1px ${C.line}`, color: C.ink }}>v{i + 1}</span>
              : <span style={{ borderRadius: 7, boxShadow: v.id === vid ? `0 0 0 2px ${C.accent}` : 'none' }}><Tile v={v} w={v.kind === 'plate' ? 64 : 112} ratio={v.kind === 'plate' ? '1' : '16 / 9'} picked={v.status === 'picked'} /></span>}
            <span style={{ fontSize: 10, fontWeight: 600, color }}>{word || `v${i + 1}`}</span>
          </div>
        );
      })}
    </div>
  );
};

// A Casting plate's prompts, editable: Draw again renders the plate anew from what you wrote.
const CAST_FIELDS = (c) => {
  const type = String(c?.type || c?.role || '').toLowerCase();
  const has = (k) => String(c?.[k] || '').trim();
  if (type === 'character' && has('facePrompt')) return [['facePrompt', 'Face'], ...(has('bodyPrompt') ? [['bodyPrompt', 'Body']] : [])];
  const key = ['presencePrompt', 'prompt', 'facePrompt'].find(has) || 'prompt';
  return [[key, type === 'creature' ? 'Presence' : 'Plate']];
};
const CastPrompts = ({ v, onRedraw }) => {
  const [entry, setEntry] = useState(v.entry);
  useEffect(() => { setEntry(v.entry); }, [v.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = JSON.stringify(entry) !== JSON.stringify(v.entry);
  return (
    <div style={{ display: 'grid', gap: 8, background: C.raised, border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 14px' }}>
      <Label style={{ marginBottom: 0 }} right={<Button size="small" type={changed ? 'primary' : 'secondary'} disabled={!changed} onClick={() => onRedraw(entry)}>Draw again</Button>}>Prompt</Label>
      {CAST_FIELDS(entry).map(([key, label]) => (
        <div key={key} style={{ display: 'grid', gap: 3 }}>
          <span style={{ fontSize: 11, color: C.muted }}>{label}</span>
          <Input.TextArea value={String(entry[key] || '')} onChange={(t) => setEntry((e) => ({ ...e, [key]: t }))} autoSize={{ minRows: 2, maxRows: 8 }} style={{ fontSize: 12.5, lineHeight: 1.55 }} />
        </div>
      ))}
    </div>
  );
};

export const Viewer = ({ s, set, toast, view, setView, onPick, onNote, onFinal, onReject, onRedraw, canvas, waiting, onNextNew }) => {
  const [note, setNote] = useState('');
  const [time, setTime] = useState(null);
  const [anchor, setAnchor] = useState(false);
  const ref_ = view.ref;
  const c = containerOf(s, ref_);
  const v = (c?.versions || []).find((x) => x.id === view.vid) || null;
  useEffect(() => { setNote(''); setAnchor(false); setTime(null); }, [view.vid]);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') setView(null); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [setView]);
  if (!v) return null;
  const current = ref_.at !== 'brief' ? pickedOf(c) : null;
  const compare = current && current.id !== v.id && current.status !== 'running' && v.status !== 'running' && v.status !== 'failed' && !TEXT_KINDS.includes(v.kind) ? current : null;
  const shot = ref_.shotId ? findShot(s, ref_.sceneId, ref_.shotId) : null;
  const pickLabel = ref_.at === 'take' ? 'Circle' : 'Pick';
  const noteTo = crewWho(editorFor(s, ref_, v, '').agent);
  const textual = TEXT_KINDS.includes(v.kind);
  const side = !textual && ((v.flags || []).some((f) => f.warn) || (v.entry && v.status !== 'running') || v.prompt || inputsOf(s, v).length > 0 || shot);
  // A draft finishes as the same picture in MOV, on the model that drafted it, at a resolution
  // that model offers (2.5: 1080p · Premium: 1080p or 4K), within the draft's 7 days.
  const finishable = ref_.at === 'take' && v.draft?.taskId && v.status !== 'running' && v.status !== 'failed';
  const finalsOf = finishable ? c.versions.filter((x) => x.final && x.parent === v.id && x.status !== 'failed') : [];
  const expired = finishable && Date.now() - v.draft.at >= DRAFT_MODE.ttlMs;
  const finalRes = finishable ? draftFinalsOf(v.draft.modelKey || 'seedance25') : [];
  const others = waiting.filter((x) => x.v.id !== v.id).length;
  const send = () => {
    const t = note.trim();
    if (!t) return;
    onNote(ref_, v, anchor && time != null ? `At ${time.toFixed(1)} s: ${t}` : t);
    setNote('');
    setView(null);
  };
  return (
    <div role="dialog" aria-label={containerLabel(s, ref_)} onClick={() => setView(null)} style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(5,6,8,0.86)', display: 'flex', justifyContent: 'center', alignItems: 'stretch', overflow: 'hidden', padding: 16 }}>
      {/* The title and the versions stay on top and the verdicts at the bottom; only what is
          between scrolls, so switching versions never jumps to the end of a long one. */}
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 1760, display: 'flex', flexDirection: 'column', background: C.panel, border: `1px solid ${C.lineHi}`, borderRadius: 18, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gap: 12, padding: '14px 20px 12px', borderBottom: `1px solid ${C.line}`, flex: '0 0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: C.ink, letterSpacing: -0.4 }}>{containerLabel(s, ref_)}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.muted }}><Avatar id={v.by} size={22} /><span style={{ color: crewColor(v.by) }}>{crewWho(v.by)}</span>{v.res ? ` · ${v.res}` : ''}{v.model === 'seedance25Premium' ? ' · Premium' : ''}{v.format === 'mov' ? ' · MOV' : ''}</span>
            {v.parent && v.note && <span style={{ fontSize: 13, color: C.muted, fontStyle: 'italic' }}>“{v.note}”</span>}
            <span style={{ flex: 1 }} />
            {canvas && !textual && mediaOf(v) && <CanvasButton size={36} onClick={() => canvas.version(ref_, v, containerLabel(s, ref_))} />}
            {others > 0 && <Button onClick={onNextNew} icon={<IconRight />}>Next new · {others}</Button>}
            <Button type="text" icon={<IconClose />} onClick={() => setView(null)} aria-label="Close" />
          </div>
          <Versions c={c} vid={v.id} kind={v.kind} onSelect={(vid) => setView({ ref: ref_, vid })} />
        </div>
        <div key={v.id} style={{ display: 'grid', gridTemplateColumns: side ? 'minmax(0, 1fr) 360px' : 'minmax(0, 1fr)', minHeight: 0, flex: '1 1 auto', overflow: 'hidden' }}>
          <div style={{ padding: 20, overflowY: 'auto', minHeight: 0, display: 'grid', alignContent: textual ? 'start' : 'center' }}>
            {compare ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div><Label>{ref_.at === 'take' ? 'Circled' : 'Picked'}</Label><Big v={compare} /></div>
                <div><Label><span style={{ color: C.accent }}>This version</span></Label><Big v={v} onTime={setTime} /></div>
              </div>
            ) : <Big v={v} onTime={setTime} />}
          </div>
          {side && (
            <div style={{ borderLeft: `1px solid ${C.line}`, padding: 18, overflowY: 'auto', minHeight: 0, display: 'grid', gap: 20, alignContent: 'start' }}>
              <Flags v={v} />
              {v.entry && v.status !== 'running' && <CastPrompts v={v} onRedraw={(entry) => { onRedraw(ref_, v, entry); setView(null); }} />}
              <InputsPanel s={s} v={v} />
              {shot && <RefsEditor s={s} set={set} sceneId={ref_.sceneId} shotId={ref_.shotId} toast={toast} />}
            </div>
          )}
        </div>
        {v.status !== 'running' && v.status !== 'failed' && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: C.raised, borderTop: `1px solid ${C.line}`, padding: '12px 20px', flexWrap: 'wrap', flex: '0 0 auto' }}>
            {v.status !== 'picked' ? <Button size="large" type="primary" icon={<IconStarFill />} onClick={() => onPick(ref_, v)} style={{ minWidth: 128 }}>{pickLabel}</Button> : <span style={{ color: C.gold, fontWeight: 700, fontSize: 15, padding: '0 8px' }}>★ {ref_.at === 'take' ? 'Circled' : 'Picked'}</span>}
            {isVideo(v) && time != null && <Button size="large" type={anchor ? 'primary' : 'secondary'} onClick={() => setAnchor((a) => !a)}>at {time.toFixed(1)} s</Button>}
            <Input size="large" value={note} onChange={setNote} onPressEnter={send} placeholder={`Note to ${noteTo}`} style={{ flex: '1 1 260px', fontSize: 15 }} />
            <Button size="large" disabled={!note.trim()} onClick={send}>Send note</Button>
            {finalRes.map((res) => <Button key={res} size="large" onClick={() => onFinal(ref_, v, res)} disabled={expired} title={expired ? 'Drafts finish within 7 days — draft the shot again' : `The same picture at ${res} MOV · ${videoModelLabel(v.draft.modelKey || 'seedance25')}`}>{finalsOf.length ? 'Final again' : 'Final'} · {res}</Button>)}
            {v.status !== 'rejected' && <Button size="large" icon={<IconClose />} status="danger" onClick={() => onReject(ref_, v)} title="Reject" aria-label="Reject" />}
          </div>
        )}
      </div>
    </div>
  );
};
