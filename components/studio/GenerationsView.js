import { useEffect, useState } from 'react';
import { Button, Select, Message } from '@arco-design/web-react';
import { IconArchive, IconCopy, IconUndo } from '@arco-design/web-react/icon';
import { C, MONO, Tile, Empty, Avatar, Dot, crewColor, crewWho } from './ui';
import { allVersions, archiveVersions, pad2 } from '../../utils/film/studio/model';
import { InputsStrip, inputsOf } from './Refs';

// GENERATIONS — every render in the project, from the crew, the Canvas or your imports, as a
// wall of large previews: what is running right now (with how long), what failed and why,
// everything made, each with the prompt it was sent. Filter by where it belongs, what it is,
// and its state. Archive takes a card out of sight (failed ones all at once); Archived shows
// them again, to bring back.
const KIND = { script: 'Screenplay', shotList: 'Shot list', blocking: 'Blocking', plate: 'Plate', take: 'Take', cut: 'Cut' };
const TYPE_OF = { plate: 'image', take: 'video', cut: 'video', script: 'text', shotList: 'text', blocking: 'text' };
const TYPES = [['any', 'All types'], ['image', 'Images'], ['video', 'Videos'], ['text', 'Text']];
const STATES = [['active', 'Active'], ['all', 'All'], ['failed', 'Failed'], ['archived', 'Archived']];
const STATUS = { running: ['Rendering', C.work], review: ['New', C.warn], picked: ['★ Picked', C.gold], kept: ['Kept', C.muted], rejected: ['Rejected', C.muted], failed: ['Failed', C.bad] };
const clock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const ago = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};
// Where a version belongs: the brief, Cast & World, a scene, or the cut.
const placeOf = (ref) => (ref.at === 'brief' ? 'brief' : ref.at === 'element' ? 'world' : ref.at === 'cut' ? 'cut' : `scene:${ref.sceneId}`);

const Segmented = ({ items, value, onChange, counts = {}, live }) => (
  <div style={{ display: 'flex', background: C.bg, border: `1px solid ${C.line}`, borderRadius: 9, padding: 3 }}>
    {items.map(([k, l]) => (
      <span key={k} role="button" onClick={() => onChange(k)} style={{ padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, background: value === k ? C.hover : 'transparent', color: value === k ? C.ink : C.muted, whiteSpace: 'nowrap' }}>
        {live === k && <Dot color={C.work} pulse />}{l}{counts[k] != null && <span style={{ fontFamily: MONO, fontWeight: 400, opacity: 0.7 }}>{counts[k]}</span>}
      </span>
    ))}
  </div>
);

const iconBtn = { cursor: 'pointer', color: C.muted, width: 26, height: 26, borderRadius: 7, display: 'inline-grid', placeItems: 'center', border: `1px solid ${C.line}`, flex: '0 0 auto' };
const copy = (text) => navigator.clipboard.writeText(text).then(() => Message.success({ content: 'Prompt copied', duration: 1500 }), () => Message.error('Could not copy'));

const Card = ({ s, ref_, v, label, now, open, archive }) => {
  const [word, color] = STATUS[v.status] || ['', C.muted];
  const textual = TYPE_OF[v.kind] === 'text';
  const [prompt, setPrompt] = useState(false);
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div role="button" className="st-card" onClick={() => open(ref_, v.id)} style={{ borderRadius: 16, border: `1px solid ${C.line}`, background: C.raised, cursor: 'pointer', overflow: 'hidden', display: 'grid', alignContent: 'start' }}>
      <div style={{ position: 'relative' }}>
        {textual
          ? <div style={{ aspectRatio: '16 / 9', background: '#08090b', padding: '14px 16px', fontSize: 12, lineHeight: 1.55, color: C.text, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 7, WebkitBoxOrient: 'vertical' }}>{v.text || (v.kind === 'blocking' && v.payload ? [v.payload.start, ...(v.payload.beats || []).map((b) => b.action), v.payload.end].join(' ') : '') || (v.kind === 'shotList' ? `${(v.payload?.scenes || []).length} scenes` : '') || v.title || KIND[v.kind]}</div>
          : <Tile v={v} w="100%" ratio="16 / 9" />}
        <span className={v.status === 'running' ? 'st-pulse' : undefined} style={{ position: 'absolute', left: 8, top: 8, fontSize: 11, fontWeight: 700, color, background: 'rgba(8,9,11,0.78)', borderRadius: 6, padding: '2px 7px' }}>{word}</span>
        <span style={{ position: 'absolute', right: 8, top: 8, fontSize: 11, color: '#d7d9de', background: 'rgba(8,9,11,0.78)', borderRadius: 6, padding: '2px 7px', fontFamily: v.status === 'running' ? MONO : undefined }}>{v.status === 'running' ? clock(now - (v.at || now)) : v.at ? ago(now - v.at) : ''}</span>
      </div>
      <div style={{ padding: '10px 12px 12px', display: 'grid', gap: 5, minWidth: 0 }}>
        <div style={{ fontSize: 15.5, fontWeight: 600, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, minWidth: 0 }}>
          <Avatar id={v.by} size={18} /><span style={{ color: crewColor(v.by) }}>{crewWho(v.by)}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {KIND[v.kind] || v.kind}{v.res ? ` · ${v.res}` : ''}{v.model === 'seedance25Premium' ? ' · Premium' : ''}{v.format === 'mov' ? ' · MOV' : ''}{v.edit ? ' · edit' : ''}</span>
        </div>
        {v.note && <div style={{ fontSize: 12, color: C.text, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{v.note}”</div>}
        <InputsStrip items={inputsOf(s, v)} />
        {v.status === 'failed' && v.error && <div style={{ fontSize: 12, color: C.bad, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{v.error}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          {v.prompt
            ? <span role="button" className="st-ghost" onClick={stop(() => setPrompt((o) => !o))} style={{ fontSize: 12, color: C.text, cursor: 'pointer', textDecoration: 'underline' }}>{prompt ? 'Hide prompt' : 'Prompt'}</span>
            : <span style={{ fontSize: 12, color: C.muted }}>{textual ? '' : 'No prompt recorded'}</span>}
          <span style={{ flex: 1 }} />
          {v.prompt && <span role="button" className="st-chip" title="Copy the prompt" aria-label="Copy the prompt" onClick={stop(() => copy(v.prompt))} style={iconBtn}><IconCopy /></span>}
          {v.status !== 'running' && (v.archived
            ? <span role="button" className="st-chip" title="Bring back" aria-label="Bring back" onClick={stop(() => archive([{ ref: ref_, vid: v.id }], false))} style={iconBtn}><IconUndo /></span>
            : <span role="button" className="st-chip" title="Archive" aria-label="Archive" onClick={stop(() => archive([{ ref: ref_, vid: v.id }], true))} style={iconBtn}><IconArchive /></span>)}
        </div>
        {prompt && v.prompt && <pre onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'pre-wrap', margin: 0, padding: '9px 10px', fontFamily: MONO, fontSize: 11.5, lineHeight: 1.55, color: C.text, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, maxHeight: 260, overflow: 'auto', cursor: 'text' }}>{v.prompt}</pre>}
      </div>
    </div>
  );
};

const GenerationsView = ({ s, set, open }) => {
  const [place, setPlace] = useState('any');
  const [type, setType] = useState('any');
  const all = allVersions(s);
  const every = all.filter((x) => !x.v.archived);
  const archive = (items, on) => set((x) => archiveVersions(x, items, on));
  const [state, setState] = useState(every.some((x) => x.v.status === 'running') ? 'active' : 'all');
  const scoped = every.filter((x) => (place === 'any' || placeOf(x.ref) === place) && (type === 'any' || TYPE_OF[x.v.kind] === type));
  const running = scoped.filter((x) => x.v.status === 'running');
  const failed = scoped.filter((x) => x.v.status === 'failed');
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running.length) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running.length]);
  const archived = all.filter((x) => x.v.archived && (place === 'any' || placeOf(x.ref) === place) && (type === 'any' || TYPE_OF[x.v.kind] === type));
  const list = state === 'active' ? running : state === 'failed' ? failed : state === 'archived' ? archived : scoped.filter((x) => x.v.status !== 'failed');
  const now = Date.now();
  const places = [
    { label: 'Whole film', value: 'any' },
    { label: 'Script', value: 'brief' },
    { label: 'Cast & World', value: 'world' },
    ...s.scenes.map((sc, i) => ({ label: `${pad2(i + 1)} ${sc.title}`, value: `scene:${sc.id}` })),
    { label: 'Cut', value: 'cut' },
  ];
  return (
    <div style={{ overflowY: 'auto', padding: '32px 40px 72px', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 30, fontWeight: 700, color: C.ink, letterSpacing: -0.6, flex: 1 }}>Generations</div>
        <Select value={place} onChange={setPlace} options={places} style={{ width: 200 }} getPopupContainer={(node) => node.parentElement} />
        <Segmented items={TYPES} value={type} onChange={setType} />
        <Segmented items={STATES} value={state} onChange={setState} counts={{ active: running.length, all: scoped.length - failed.length, failed: failed.length, archived: archived.length }} live={running.length ? 'active' : null} />
        {state === 'failed' && failed.length > 0 && <Button icon={<IconArchive />} onClick={() => archive(failed.map((x) => ({ ref: x.ref, vid: x.v.id })), true)}>Archive all failed · {failed.length}</Button>}
      </div>
      {!list.length && <Empty>{state === 'active' ? 'Nothing rendering' : state === 'failed' ? 'Nothing failed' : state === 'archived' ? 'Nothing archived' : 'Nothing here yet'}</Empty>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 18 }}>
        {list.map(({ ref, v, label }) => <Card key={`${label}-${v.id}`} s={s} ref_={ref} v={v} label={label} now={now} open={open} archive={archive} />)}
      </div>
    </div>
  );
};

export default GenerationsView;
