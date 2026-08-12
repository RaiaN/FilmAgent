import { memo, useState } from 'react';
import { Button, Empty, Input, Tag, Typography } from '@arco-design/web-react';
import { IconClose } from '@arco-design/web-react/icon';

const { Text } = Typography;

// ---- SHOT BROWSER — every SHOT card as a right drawer (the Take Library pattern) ----
// The board answers "what's here"; this drawer answers "WHERE is the shot I need":
// all cards in cut order, searchable by title + prompt text, one click flies the
// viewport to the card and selects it.

const STATUS_COLOR = { running: '#165dff', shot: '#00b42a' };

const ShotBrowser = ({ shots = [], onFocus, onClose }) => {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const shown = ql
    ? shots.filter((s) => `${s.beat} ${s.promptText}`.toLowerCase().includes(ql))
    : shots;
  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 300, zIndex: 9, borderLeft: '1px solid #e5e6eb', boxShadow: '-4px 0 16px rgba(0,0,0,0.08)', background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f2f3f5' }}>
        <Text style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>🎬 SHOT cards</Text>
        <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{shots.length}</Text>
        <Button size="mini" type="text" icon={<IconClose />} onClick={onClose} />
      </div>
      <div style={{ padding: '8px 12px 0' }}>
        <Input size="small" allowClear placeholder="search title or prompt…" value={q} onChange={setQ} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.map((s) => (
          <div
            key={s.id}
            onClick={() => onFocus(s.id)}
            title="Fly to this card on the board"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, borderRadius: 8, cursor: 'pointer', border: '1px solid #e5e6eb', background: '#fff' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f7f8fa'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
          >
            <div style={{ width: 64, height: 36, borderRadius: 4, overflow: 'hidden', background: '#101418', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {s.thumb
                ? <img src={s.thumb} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <Text style={{ color: '#4e5969', fontSize: 9, fontWeight: 700 }}>no frame</Text>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tag size="small" style={{ background: '#101418', color: '#f7ba1e', border: 'none', fontWeight: 700, flexShrink: 0 }}>SHOT {s.cut + 1}</Tag>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[s.status] || '#c9cdd4', flexShrink: 0 }} title={s.status || 'not shot yet'} />
              </div>
              <Text style={{ fontSize: 11, display: 'block' }} ellipsis={{ rows: 1 }}>{s.beat}</Text>
              <Text type="secondary" style={{ fontSize: 10 }}>
                {s.durationSec ? `${s.durationSec}s` : ''}{s.takeCount ? ` · ${s.takeCount} take${s.takeCount > 1 ? 's' : ''}` : ''}
              </Text>
            </div>
          </div>
        ))}
        {!shown.length && (
          <Empty style={{ marginTop: 40 }} description={ql ? 'No card matches — clear the search.' : 'No SHOT cards yet — New Shot on a Brief, or the Shot agent.'} />
        )}
      </div>
    </div>
  );
};

export default memo(ShotBrowser);
