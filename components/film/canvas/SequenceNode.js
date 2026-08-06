import { createContext, memo, useContext } from 'react';
import { useNodesData } from '@xyflow/react';
import { Button, Typography } from '@arco-design/web-react';
import { IconLoading, IconVideoCamera, IconDown, IconRight, IconClose } from '@arco-design/web-react/icon';

const { Text } = Typography;

// The SEQUENCE element — the chain's owner card. Born by "Create sequence"; holds its
// member SHOT cards in order. Collapse hides the member cards (the bar stays as the
// compact face); "Shoot next" renders the chain ONE take per tap — shoot, review,
// tap again — threading continuity through the bonds. Action remains the batch verb.
export const SequenceContext = createContext({ onShootNext: null, onToggleCollapse: null, onRemoveSequence: null });

const STATUS_DOT = {
  shot: '#00b42a', running: '#165dff', failed: '#f53f3f', planned: '#86909c',
};

const SequenceNode = ({ id, data = {} }) => {
  const { onShootNext, onToggleCollapse, onRemoveSequence } = useContext(SequenceContext);
  const cardIds = data.cardIds || [];
  const members = useNodesData(cardIds) || [];
  const rows = cardIds.map((cid, i) => {
    const m = members.find((x) => x && x.id === cid);
    const d = (m && m.data) || {};
    const status = d.status === 'running' ? 'running' : d.status === 'failed' ? 'failed' : (d.shotUrl ? 'shot' : 'planned');
    return { cid, i, status, beat: d.beat || `Shot ${i + 1}`, durationSec: d.durationSec || 10, missing: !m };
  }).filter((r) => !r.missing);
  const shotCount = rows.filter((r) => r.status === 'shot').length;
  const running = rows.some((r) => r.status === 'running');
  const nextRow = rows.find((r) => r.status === 'planned' || r.status === 'failed');
  const total = rows.reduce((s, r) => s + (Number(r.durationSec) || 0), 0);

  return (
    <div style={{ width: 340, background: '#161b22', border: '1px solid #3491fa', borderRadius: 10, overflow: 'hidden', color: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)' }}>
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button className="nodrag" size="mini" type="text" icon={data.collapsed ? <IconRight /> : <IconDown />}
          onClick={() => onToggleCollapse && onToggleCollapse(id)}
          title={data.collapsed ? 'Expand — show the chained SHOT cards' : 'Collapse — hide the cards; this bar stays as the sequence'}
          style={{ color: '#9fb4d0', padding: '0 2px' }} />
        <Text style={{ color: '#3491fa', fontSize: 12, fontWeight: 700 }}>SEQUENCE</Text>
        <Text style={{ color: '#9fb4d0', fontSize: 11 }}>{rows.length} shots · {shotCount} rendered · ~{total}s</Text>
        <span style={{ flex: 1 }} />
        {onRemoveSequence && <Button className="nodrag" size="mini" type="text" icon={<IconClose />} onClick={() => onRemoveSequence(id)} title="Remove the sequence element (cards and bonds stay on the board)" style={{ color: '#5a6472', padding: '0 2px' }} />}
      </div>
      <div className="nodrag" style={{ padding: '0 10px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {rows.map((r) => (
          <div key={r.cid} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[r.status], flexShrink: 0 }} />
            <Text style={{ color: '#c9cdd4', fontSize: 11, width: 18 }}>{String(r.i + 1).padStart(2, '0')}</Text>
            <Text style={{ color: '#e5e6eb', fontSize: 11, flex: 1, minWidth: 0 }} ellipsis>{r.beat}</Text>
            <Text style={{ color: '#5a6472', fontSize: 10 }}>{r.durationSec}s{r.status === 'failed' ? ' · failed' : ''}</Text>
          </div>
        ))}
        <Button
          className="nodrag" size="mini" type="primary" long
          icon={running ? <IconLoading /> : <IconVideoCamera />}
          disabled={running || !nextRow}
          onClick={() => onShootNext && onShootNext(id)}
          style={{ marginTop: 5, background: '#b06f10', borderColor: '#b06f10' }}
          title="Shoot the NEXT un-rendered shot in the chain — one take per tap, continuity threaded through the bonds. Review it, then tap again."
        >
          {running ? 'Rendering…' : nextRow ? `🎬 Shoot next — ${String(nextRow.i + 1).padStart(2, '0')}` : 'All shots rendered'}
        </Button>
      </div>
    </div>
  );
};

export default memo(SequenceNode);
