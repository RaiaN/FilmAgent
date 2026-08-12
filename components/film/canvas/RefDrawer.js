import { memo, useMemo, useState } from 'react';
import { Button, Empty, Input, Typography } from '@arco-design/web-react';
import { IconClose, IconSound, IconVideoCamera } from '@arco-design/web-react/icon';

const { Text } = Typography;

// ---- REFERENCE BROWSER — the library as a right drawer (the Take Library pattern) ----
// The ONE picking surface for references everywhere: SHOT cards, the storyboard pool,
// the panel pickers and keyframe slots show only their ENABLED refs inline and open
// THIS drawer to browse the whole library — search + role tabs + big tiles, never a
// hundred inline chips. Multi mode: click toggles, badges show the live send order.
// Single mode: click picks and closes.

const ROLE_COLOR = { character: '#722ed1', location: '#00b42a', prop: '#ff7d00', frame: '#f5319d' };
const TAB_DEFS = [
  { key: 'all', label: 'All' },
  { key: 'character', label: 'Cast' },
  { key: 'location', label: 'Places' },
  { key: 'prop', label: 'Props' },
  { key: 'frame', label: 'Frames' },
  { key: 'board', label: 'Board' },
  { key: 'media', label: 'A/V' },
];
const bucketOf = (it) => (it.kind === 'audio' || it.kind === 'video' ? 'media' : (it.role || 'board'));

// items: [{ id, url, label, role?, kind: 'image'|'audio'|'video', duration? }]
// selection: Map(id → badge string: '3' | 'A1' | 'V2' | '✓') — LIVE, rebuilt by the parent.
const RefDrawer = ({ title, hint, items = [], selection, onToggle, onClose, single = false }) => {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const buckets = useMemo(() => new Set(items.map(bucketOf)), [items]);
  const tabs = TAB_DEFS.filter((t) => t.key === 'all' || buckets.has(t.key));
  const ql = q.trim().toLowerCase();
  const shown = items.filter((it) => (tab === 'all' || bucketOf(it) === tab)
    && (!ql || String(it.label || '').toLowerCase().includes(ql)));
  const images = shown.filter((it) => it.kind !== 'audio' && it.kind !== 'video');
  const media = shown.filter((it) => it.kind === 'audio' || it.kind === 'video');
  const pickedCount = selection ? selection.size : 0;
  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 340, zIndex: 10, borderLeft: '1px solid #e5e6eb', boxShadow: '-4px 0 16px rgba(0,0,0,0.08)', background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f2f3f5' }}>
        <Text style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }} ellipsis>{title || 'References'}</Text>
        {!single && pickedCount > 0 && <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{pickedCount} on</Text>}
        <Button size="mini" type="text" icon={<IconClose />} onClick={onClose} />
      </div>
      <div style={{ padding: '8px 12px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Input size="small" allowClear placeholder="search by name…" value={q} onChange={setQ} />
        {tabs.length > 2 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tabs.map((t) => (
              <span
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  cursor: 'pointer', fontSize: 11, padding: '1px 8px', borderRadius: 10,
                  border: `1px solid ${tab === t.key ? '#165dff' : '#e5e6eb'}`,
                  background: tab === t.key ? '#165dff' : 'transparent',
                  color: tab === t.key ? '#fff' : (ROLE_COLOR[t.key] || '#4e5969'),
                }}
              >
                {t.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {images.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 8 }}>
            {images.map((it) => {
              const sel = selection ? selection.get(it.id) : null;
              const ring = ROLE_COLOR[it.role] || '#165dff';
              return (
                <div
                  key={it.id}
                  onClick={() => onToggle(it)}
                  title={`${it.label || 'image'}${sel ? ` — [Image ${sel}] · click to remove` : (single ? ' — click to pick' : ' — click to add')}`}
                  style={{ cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: `2px solid ${sel ? ring : 'transparent'}`, boxShadow: sel ? 'none' : 'inset 0 0 0 1px #e5e6eb', background: '#fff' }}
                >
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', background: '#f2f3f5' }}>
                    {it.url && <img src={it.url} alt="" loading="lazy" decoding="async" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
                    {sel && (
                      <b style={{ position: 'absolute', left: 3, top: 3, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: ring, color: '#fff', fontSize: 10, fontWeight: 800, lineHeight: '16px', textAlign: 'center' }}>{sel}</b>
                    )}
                    {it.role && (
                      <span style={{ position: 'absolute', right: 3, bottom: 3, width: 8, height: 8, borderRadius: 2, background: ROLE_COLOR[it.role] || '#f7ba1e' }} />
                    )}
                  </div>
                  <Text style={{ display: 'block', fontSize: 10, padding: '2px 4px 3px' }} ellipsis>{it.label || 'image'}</Text>
                </div>
              );
            })}
          </div>
        )}
        {media.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {images.length > 0 && <Text style={{ fontSize: 9, fontWeight: 700, color: '#86909c', letterSpacing: 0.4 }}>AUDIO / VIDEO</Text>}
            {media.map((it) => {
              const sel = selection ? selection.get(it.id) : null;
              const tone = it.kind === 'audio' ? '#7816ff' : '#165dff';
              return (
                <div
                  key={it.id}
                  onClick={() => onToggle(it)}
                  title={`${it.label || it.kind}${sel ? ' — click to detach' : ' — click to attach'}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12, border: `1px solid ${sel ? tone : '#e5e6eb'}`, background: sel ? (it.kind === 'audio' ? '#f5f0ff' : '#eef4ff') : '#fff' }}
                >
                  {sel
                    ? <b style={{ minWidth: 24, flexShrink: 0, color: tone, fontWeight: 700 }}>{sel}</b>
                    : (it.kind === 'audio' ? <IconSound style={{ color: tone, flexShrink: 0 }} /> : <IconVideoCamera style={{ color: tone, flexShrink: 0 }} />)}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label || it.kind}</span>
                  {Number(it.duration) ? <span style={{ color: '#86909c', flexShrink: 0 }}>{Math.round(it.duration)}s</span> : null}
                </div>
              );
            })}
          </div>
        )}
        {!images.length && !media.length && (
          <Empty style={{ marginTop: 40 }} description={ql || tab !== 'all' ? 'Nothing matches — clear the search / tab.' : 'Nothing to pick from yet — generate, drop or tag some assets first.'} />
        )}
      </div>
      {hint && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid #f2f3f5' }}>
          <Text type="secondary" style={{ fontSize: 10 }}>{hint}</Text>
        </div>
      )}
    </div>
  );
};

export default memo(RefDrawer);
