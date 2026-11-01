import { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Select } from '@arco-design/web-react';
import { IconClose, IconLoading, IconExclamationCircle, IconPlus } from '@arco-design/web-react/icon';
import { C, MONO } from '../studio/ui';

// THE PREVIEW: shows what the project holds. It can play, compare, sort, filter, tag and label;
// everything that makes or changes a result goes through the session. `onLabel` is the only thing it
// can do to the project, and it renders nothing.

const SORTS = [{ label: 'Newest first', value: 'new' }, { label: 'Oldest first', value: 'old' }, { label: 'By name', value: 'name' }];
const KINDS = [{ label: 'Everything', value: '' }, { label: 'Videos', value: 'video' }, { label: 'Pictures', value: 'image' }, { label: 'Yours', value: 'you' }];
const BY = { you: 'yours', generated: 'generated', edit: 'edit', final: 'final' };

export const arrange = (results, { sort = 'new', kind = '', tag = '' } = {}) => {
  const kept = results.filter((r) => (!tag || (r.tags || []).includes(tag)) && (!kind || (kind === 'you' ? r.by === 'you' : r.type === kind)));
  if (sort === 'name') return [...kept].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return [...kept].sort((a, b) => (sort === 'old' ? a.at - b.at : b.at - a.at));
};

// A master the browser can't play gets an H.264 copy to watch.
const usePlayable = (r) => {
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState('');
  useEffect(() => {
    setUrl('');
    setProblem('');
    if (!r?.url) return undefined;
    if (r.type !== 'video' || r.format !== 'mov') { setUrl(r.url); return undefined; }
    let live = true;
    fetch('/api/film/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: r.url }) })
      .then(async (res) => { const j = await res.json(); if (!res.ok) throw new Error(j.error); if (live) setUrl(j.url); })
      .catch((e) => { if (live) setProblem(e.message); });
    return () => { live = false; };
  }, [r?.url, r?.format, r?.type]);
  return { url, problem };
};

const clock = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const useTicking = (on) => {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
};

// The player holds something to watch; a tall empty frame would only push the results out of sight.
const Screen = ({ r, big }) => {
  const { url, problem } = usePlayable(r?.status === 'done' || r?.status === 'review' || r?.status === 'picked' || r?.status === 'kept' ? r : null);
  const box = { width: '100%', height: big ? 'min(52vh, 56vw)' : 'min(40vh, 30vw)', minHeight: 220, borderRadius: 12, background: '#08090b', overflow: 'hidden', display: 'grid', placeItems: 'center', color: C.muted, fontSize: 14, position: 'relative', flex: '0 0 auto' };
  const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block' };
  if (problem) return <div style={{ ...box, height: 'auto', minHeight: 120, color: C.bad, padding: 24, textAlign: 'center' }}>{problem}</div>;
  if (!url) return <div style={{ ...box, height: 'auto', minHeight: 120 }}><span className="st-pulse">Preparing the preview</span></div>;
  if (r.type === 'video') return <div style={box}><video key={url} src={url} controls playsInline style={fill} preload={big ? 'auto' : 'metadata'} /></div>;
  return <div style={box}><img src={url} alt={r.name} style={fill} /></div>;
};

// What a result looks like at a glance: its picture; while it renders, what it comes from, under a timer.
const Thumb = ({ r, on, select, parent }) => {
  const under = r.poster || (r.type === 'image' ? r.url : '');
  const was = parent?.poster || (parent?.type === 'image' ? parent.url : '');
  return (
    <div role="button" className="st-tile" onClick={() => select(r.name)} title={r.error || r.label || r.name} style={{ cursor: 'pointer', borderRadius: 10, overflow: 'hidden', background: C.raised, boxShadow: on ? `0 0 0 2px ${C.accent}` : `inset 0 0 0 1px ${C.line}` }}>
      <div style={{ aspectRatio: '16 / 9', background: '#08090b', position: 'relative', display: 'grid', placeItems: 'center' }}>
        {r.status === 'running' && (
          <>
            {was && <img src={was} alt="" style={{ ...THUMB_FILL, opacity: 0.3 }} />}
            <span className="st-pulse" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.work, fontFamily: MONO }}><IconLoading />{clock(Date.now() - (r.at || Date.now()))}</span>
          </>
        )}
        {r.status === 'failed' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.bad }}><IconExclamationCircle />Failed</span>}
        {r.status !== 'running' && r.status !== 'failed' && (under ? <img src={under} alt="" style={THUMB_FILL} /> : <ThumbVideo r={r} />)}
        <span style={{ position: 'absolute', left: 6, top: 6, fontFamily: MONO, fontSize: 13, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.65)', borderRadius: 5, padding: '1px 6px' }}>{r.name}</span>
      </div>
      <div style={{ padding: '6px 8px', fontSize: 12, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minHeight: 18 }}>{r.label || BY[r.by] || ''}</div>
    </div>
  );
};

const THUMB_FILL = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const ThumbVideo = ({ r }) => {
  const { url } = usePlayable(r);
  return url ? <video src={`${url}#t=0.5`} preload="none" muted style={THUMB_FILL} /> : null;
};

// Its name and tags, for your own convenience, and the agent can read them. Click the name to change it.
const Organise = ({ r, onLabel, allTags }) => {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(r.label || '');
  const [adding, setAdding] = useState(false);
  const [tag, setTag] = useState('');
  useEffect(() => { setLabel(r.label || ''); setEditing(false); setAdding(false); setTag(''); }, [r.name, r.label]);
  const saveLabel = () => { setEditing(false); if (label !== (r.label || '')) onLabel(r.name, { label }); };
  const addTag = () => { const t = tag.trim(); setTag(''); setAdding(false); if (t) onLabel(r.name, { add_tags: [t] }); };
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', minHeight: 30 }}>
      {editing
        ? <span style={{ flex: '1 1 240px', minWidth: 160 }}><Input aria-label="Name" autoFocus value={label} onChange={setLabel} onBlur={saveLabel} onPressEnter={saveLabel} /></span>
        : <span role="button" title="Rename" onClick={() => setEditing(true)} style={{ fontSize: 15, fontWeight: 600, color: r.label ? C.ink : C.muted, cursor: 'text', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label || 'Add a name'}</span>}
      {(r.tags || []).map((t) => (
        <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 8, background: C.raised, border: `1px solid ${C.line}`, fontSize: 12.5, color: C.text }}>
          {t}<IconClose role="button" aria-label={`Remove tag ${t}`} style={{ cursor: 'pointer', fontSize: 11 }} onClick={() => onLabel(r.name, { remove_tags: [t] })} />
        </span>
      ))}
      {adding
        ? (
          <span style={{ width: 150 }}>
            <Input aria-label="Add a tag" size="small" autoFocus value={tag} onChange={setTag} onBlur={addTag} onPressEnter={addTag} placeholder="scene 2" list="film-tags" />
            <datalist id="film-tags">{allTags.map((t) => <option key={t} value={t} />)}</datalist>
          </span>
        )
        : <span role="button" className="st-ghost" onClick={() => setAdding(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: C.text, cursor: 'pointer' }}><IconPlus style={{ fontSize: 11 }} />Tag</span>}
    </div>
  );
};

export const Preview = ({ results, onLabel, focus = null }) => {
  const [chosen, setChosen] = useState(null);
  useEffect(() => { if (focus) setChosen(focus.name); }, [focus]);
  const [compare, setCompare] = useState(false);
  const [sort, setSort] = useState('new');
  const [kind, setKind] = useState('');
  const [tag, setTag] = useState('');
  const running = results.filter((r) => r.status === 'running');
  useTicking(running.length > 0);
  const allTags = useMemo(() => [...new Set(results.flatMap((r) => r.tags || []))].sort(), [results]);
  // Now follows the work: the newest finished result, until you choose one to look at.
  const newest = useMemo(() => [...results].filter((r) => r.status !== 'running' && r.status !== 'failed' && r.status !== 'rejected').sort((a, b) => b.at - a.at)[0] || null, [results]);
  const selected = chosen ? results.find((r) => r.name === chosen) : null;
  const watchable = (r) => r && r.status !== 'running' && r.status !== 'failed';
  const shown = watchable(selected) ? selected : newest;
  const parent = shown?.parent ? results.find((r) => r.name === shown.parent) : null;
  const list = useMemo(() => arrange(results, { sort, kind, tag }), [results, sort, kind, tag]);
  const top = useRef(null);
  const pick = (name) => { setChosen(name); top.current?.scrollTo({ top: 0, behavior: 'smooth' }); };
  const parentOf = (r) => (r.parent ? results.find((x) => x.name === r.parent) : null);
  return (
    <div ref={top} style={{ height: '100%', overflowY: 'auto', padding: 20, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {running.length > 0 && (
        <div style={{ display: 'grid', gap: 5, padding: '9px 12px', borderRadius: 11, background: C.workSoft, border: '1px solid rgba(76,195,255,0.25)', fontSize: 14, color: C.text, flex: '0 0 auto' }}>
          {running.map((r) => (
            <div key={r.name} role="button" onClick={() => pick(r.name)} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, cursor: 'pointer' }}>
              <span style={{ fontFamily: MONO, fontWeight: 700, color: C.accent, flex: '0 0 auto' }}>{r.name}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Rendering{r.label ? `: ${r.label}` : ''}{r.parent ? ` · from ${r.parent}` : ''}</span>
              <span style={{ fontFamily: MONO, color: C.work, flex: '0 0 auto' }}>{clock(Date.now() - (r.at || Date.now()))}</span>
            </div>
          ))}
        </div>
      )}
      {selected?.status === 'failed' && (
        <div style={{ padding: '10px 12px', borderRadius: 11, background: C.warnSoft, color: C.warn, fontSize: 14, lineHeight: 1.5, flex: '0 0 auto' }}><b style={{ fontFamily: MONO }}>{selected.name}</b> failed: {selected.error || 'no reason was given.'}</div>
      )}
      {!results.length && (
        <div style={{ flex: '0 0 auto', padding: '40px 24px', textAlign: 'center', color: C.text, fontSize: 15, lineHeight: 1.6 }}>Nothing in this film yet. What you attach or make shows here.</div>
      )}
      {shown && (compare && parent
        ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, flex: '0 0 auto' }}><Screen r={parent} /><Screen r={shown} /></div>
        : <Screen r={shown} big />)}
      {shown && (
        <div style={{ display: 'grid', gap: 10, flex: '0 0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 14, color: C.text }}>
            <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, color: C.accent }}>{shown.name}</span>
            <span>{[BY[shown.by], shown.res, shown.seconds ? `${shown.seconds} s` : '', parent ? `from ${parent.name}` : '', shown.place].filter(Boolean).join(' · ')}</span>
            <span style={{ flex: 1 }} />
            {parent && <span role="button" className="st-ghost" onClick={() => setCompare((c) => !c)} style={{ cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}>{compare ? 'Show alone' : `Compare with ${parent.name}`}</span>}
            {chosen && shown.name !== newest?.name && <span role="button" className="st-ghost" onClick={() => setChosen(null)} style={{ cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}>Back to latest</span>}
          </div>
          <Organise r={shown} onLabel={onLabel} allTags={allTags} />
          {shown.prompt && <details style={{ fontSize: 13, color: C.text }}><summary style={{ cursor: 'pointer' }}>Prompt</summary><div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, marginTop: 8 }}>{shown.prompt}</div></details>}
        </div>
      )}
      {results.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: '0 0 auto' }}>
          <span style={{ width: 150 }}><Select aria-label="Sort" value={sort} onChange={setSort} options={SORTS} /></span>
          <span style={{ width: 140 }}><Select aria-label="Kind" value={kind} onChange={setKind} options={KINDS} /></span>
          {allTags.length > 0 && <span style={{ width: 160 }}><Select aria-label="Tag" value={tag} onChange={setTag} options={[{ label: 'Every tag', value: '' }, ...allTags.map((t) => ({ label: t, value: t }))]} /></span>}
          <span style={{ fontSize: 13, color: C.muted }}>{list.length} of {results.length}</span>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, flex: '0 0 auto' }}>
        {list.map((r) => <Thumb key={r.name} r={r} on={(selected || shown)?.name === r.name} select={pick} parent={parentOf(r)} />)}
      </div>
    </div>
  );
};
