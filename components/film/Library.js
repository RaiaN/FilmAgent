import { useEffect, useMemo, useState } from 'react';
import { Input, Modal, Select } from '@arco-design/web-react';
import { IconDelete } from '@arco-design/web-react/icon';
import { C, Empty } from '../studio/ui';
import { listLibrary } from '../../utils/film/libraryStore';

// THE LIBRARY: every picture and video this film has added, made or used, the same one Canvas shows.
// To use one, ask for it by name in the session. A file that no longer loads isn't shown; the count
// says how many. `onDelete` deletes an item for good, after you confirm.

const KINDS = [{ label: 'Everything', value: '' }, { label: 'Pictures', value: 'image' }, { label: 'Videos', value: 'video' }];
const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' };

export const searchLibrary = (items, query, kind) => {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((it) => (!kind || (it.kind || 'image') === kind) && words.every((w) => String(it.name || '').toLowerCase().includes(w)));
};

export const Library = ({ project, version = 0, onDelete }) => {
  const [items, setItems] = useState(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  useEffect(() => {
    let live = true;
    if (!project) { setItems([]); return undefined; }
    listLibrary(project, { withFilm: true }).then((list) => { if (live) setItems(list); });
    return () => { live = false; };
  }, [project, version]);
  const [broken, setBroken] = useState({});
  const lost = (it) => setBroken((b) => ({ ...b, [it.url]: true }));
  const present = useMemo(() => (items || []).filter((it) => !broken[it.url]), [items, broken]);
  const shown = useMemo(() => searchLibrary(present, query, kind), [present, query, kind]);
  const lostCount = (items || []).length - present.length;
  const remove = (it) => Modal.confirm({
    title: `Delete “${it.name}”?`,
    content: 'It is deleted from the Asset Library and storage for good. Results already made from it stay.',
    okText: 'Delete',
    cancelText: 'Cancel',
    okButtonProps: { status: 'danger' },
    onOk: async () => {
      await onDelete(it);
      setItems((list) => list.filter((x) => x !== it));
    },
  });
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: '0 0 auto' }}>
        <span style={{ flex: '1 1 240px' }}><Input aria-label="Search the Library" value={query} onChange={setQuery} placeholder="Search by name" allowClear /></span>
        <span style={{ width: 150 }}><Select aria-label="Kind" value={kind} onChange={setKind} options={KINDS} /></span>
        {items && <span style={{ fontSize: 13, color: C.muted }}>{shown.length} of {present.length}{lostCount > 0 ? ` · ${lostCount} no longer load` : ''}</span>}
      </div>
      {items === null && <Empty>Loading the Library</Empty>}
      {items !== null && !shown.length && <Empty>{present.length ? 'Nothing here matches.' : 'This film has no assets yet. What you attach or make shows here.'}</Empty>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, flex: '0 0 auto' }}>
        {shown.map((it) => (
          <div key={it.id || it.url} title={it.name} style={{ borderRadius: 10, overflow: 'hidden', background: C.raised, boxShadow: `inset 0 0 0 1px ${C.line}` }}>
            <div style={{ aspectRatio: '16 / 9', background: '#08090b', position: 'relative' }}>
              {it.kind === 'video' && !it.thumb
                ? <video src={`${it.url}#t=0.5`} preload="metadata" muted onError={() => lost(it)} style={fill} />
                : <img src={it.thumb || it.url} alt="" loading="lazy" onError={() => lost(it)} style={fill} />}
              {onDelete && !it.fromFilm && (
                <span role="button" aria-label={`Delete ${it.name}`} title="Delete" className="st-chip" onClick={() => remove(it)} style={{ position: 'absolute', right: 6, top: 6, width: 28, height: 28, borderRadius: 7, display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#fff', background: 'rgba(8,9,11,0.72)' }}><IconDelete /></span>
              )}
            </div>
            <div style={{ padding: '6px 8px', fontSize: 12, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minHeight: 18 }}>{it.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
