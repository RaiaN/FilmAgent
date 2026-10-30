import { useRef, useState } from 'react';
import { Message } from '@arco-design/web-react';
import { IconClose, IconPlus, IconCopy } from '@arco-design/web-react/icon';
import { C, MONO, Label, storeFile } from './ui';
import { findElement, findShot, pickedOf, newElement, uid, KIND_LABEL } from '../../utils/film/studio/model';

// INPUTS — what a version was made from, and the references the next take of a shot will use.

// A version's inputs: as recorded when it was made; for a version made before inputs were
// recorded, the plates it was made with (its `used` picks) and its source.
export const inputsOf = (s, v) => {
  if (Array.isArray(v?.inputs)) return v.inputs;
  const used = Object.entries(v?.used || {}).map(([elId, vid], i) => {
    const el = findElement(s, elId);
    const pv = (el?.versions || []).find((x) => x.id === vid);
    return pv && (pv.cacheUrl || pv.url) ? { n: i + 1, label: el.name, url: pv.cacheUrl || pv.url, role: 'plate at the time', elementId: elId, versionId: vid } : null;
  }).filter(Boolean);
  return used;
};

const Thumb = ({ item, size }) => (
  <span title={`${item.n ? `[Image ${item.n}] ` : ''}${item.label} · ${item.role}`} style={{ width: size, height: size, flex: '0 0 auto', borderRadius: 5, overflow: 'hidden', background: '#08090b', boxShadow: `inset 0 0 0 1px ${C.line}`, display: 'inline-block' }}>
    {item.video
      ? <video src={item.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      : <img src={item.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
  </span>
);

// A row of small input pictures (Generations cards).
export const InputsStrip = ({ items, size = 26, max = 6 }) => {
  if (!items.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {items.slice(0, max).map((it, i) => <Thumb key={`${it.url}-${i}`} item={it} size={size} />)}
      {items.length > max && <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>+{items.length - max}</span>}
    </div>
  );
};

// The inputs of one version, named, with the prompt that was sent (the viewer).
export const InputsPanel = ({ s, v }) => {
  const items = inputsOf(s, v);
  if (!items.length && (!v.prompt || v.entry)) return null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.length > 0 && <Label>Made from</Label>}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {items.map((it, i) => (
            <div key={`${it.url}-${i}`} style={{ display: 'grid', gap: 4, width: 92 }}>
              <Thumb item={it} size={92} />
              <span style={{ fontSize: 11.5, color: C.ink, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.n ? <span style={{ fontFamily: MONO, color: C.accent }}>{it.n} </span> : null}{it.label}</span>
              <span style={{ fontSize: 10.5, color: C.muted }}>{it.role}</span>
            </div>
          ))}
        </div>
      )}
      {v.prompt && !v.entry && (
        <details>
          <summary style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: C.text, cursor: 'pointer', listStyle: 'none' }}>
            Prompt
            <span role="button" className="st-chip" title="Copy the prompt" aria-label="Copy the prompt" onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(v.prompt).then(() => Message.success({ content: 'Prompt copied', duration: 1500 }), () => Message.error('Could not copy')); }} style={{ cursor: 'pointer', display: 'inline-grid', placeItems: 'center', width: 26, height: 26, borderRadius: 6, border: `1px solid ${C.line}`, color: C.text }}><IconCopy /></span>
          </summary>
          <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0', padding: '10px 12px', fontFamily: MONO, fontSize: 12, lineHeight: 1.6, color: C.text, background: C.raised, border: `1px solid ${C.line}`, borderRadius: 8, maxHeight: 360, overflow: 'auto' }}>{v.prompt}</pre>
        </details>
      )}
    </div>
  );
};

// THE NEXT TAKE'S REFERENCES — the shot's cast, places and props. Remove one, add one from
// Cast & World, or bring a new image in as a new element. The shot's text keeps naming
// whoever it names; only what rides as a picture changes.
export const RefsEditor = ({ s, set, sceneId, shotId, toast }) => {
  const shot = findShot(s, sceneId, shotId);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);
  const kindRef = useRef('character');
  if (!shot) return null;
  const ids = shot.elementIds || [];
  const patch = (next) => set((x) => ({ ...x, scenes: x.scenes.map((sc) => (sc.id !== sceneId ? sc : { ...sc, shots: sc.shots.map((sh) => (sh.id === shotId ? { ...sh, elementIds: next } : sh)) })) }));
  const others = s.elements.filter((e) => !ids.includes(e.id));
  const upload = async (file) => {
    setBusy('Adding…');
    try {
      const url = await storeFile(file);
      const vid = uid('v-');
      const el = { ...newElement({ kind: kindRef.current, name: file.name.replace(/\.[^.]+$/, '') }), versions: [{ id: vid, at: Date.now(), by: 'you', kind: 'plate', status: 'picked', url, cacheUrl: url }], picked: vid };
      set((x) => ({ ...x, elements: [...x.elements, el] }));
      patch([...ids, el.id]);
      setAdding(false);
    } catch (e) { toast(e.message); } finally { setBusy(''); }
  };
  const chip = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '3px 6px 3px 3px', borderRadius: 8, border: `1px solid ${C.line}`, background: C.raised, fontSize: 12.5, color: C.ink };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Label>References for the next take</Label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {ids.map((id) => {
          const el = findElement(s, id);
          if (!el) return null;
          const p = pickedOf(el);
          return (
            <span key={id} style={chip}>
              {p ? <img src={p.cacheUrl || p.url} alt="" style={{ width: 26, height: 26, borderRadius: 5, objectFit: 'cover' }} /> : <span style={{ width: 26, height: 26, borderRadius: 5, background: C.warnSoft }} />}
              <span>{el.name}</span>
              {!p && <span style={{ fontSize: 11, color: C.warn }}>no plate</span>}
              <span role="button" title={`Stop sending ${el.name}`} onClick={() => patch(ids.filter((x) => x !== id))} style={{ cursor: 'pointer', color: C.muted, display: 'inline-grid', placeItems: 'center' }}><IconClose /></span>
            </span>
          );
        })}
        {!ids.length && <span style={{ fontSize: 12.5, color: C.muted }}>None — the take is made from the text alone</span>}
        <span role="button" className="st-chip" onClick={() => setAdding((a) => !a)} style={{ ...chip, padding: '5px 10px', cursor: 'pointer', color: C.text }}><IconPlus />Add</span>
      </div>
      {adding && (
        <div style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel }}>
          {others.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {others.map((el) => {
                const p = pickedOf(el);
                return (
                  <span key={el.id} role="button" className="st-chip" onClick={() => { patch([...ids, el.id]); setAdding(false); }} style={{ ...chip, cursor: 'pointer' }}>
                    {p ? <img src={p.cacheUrl || p.url} alt="" style={{ width: 26, height: 26, borderRadius: 5, objectFit: 'cover' }} /> : null}
                    {el.name}<span style={{ fontSize: 11, color: C.muted }}>{KIND_LABEL[el.kind].replace(/s$/, '')}</span>
                  </span>
                );
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, color: C.muted }}>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
            {busy || 'New from an image:'}
            {!busy && ['character', 'location', 'prop'].map((k) => (
              <span key={k} role="button" className="st-chip" onClick={() => { kindRef.current = k; fileRef.current?.click(); }} style={{ ...chip, padding: '4px 10px', cursor: 'pointer' }}>{KIND_LABEL[k].replace(/s$/, '').replace(/^Place$/, 'Place')}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
