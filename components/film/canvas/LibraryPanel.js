import { Typography, Button, Empty, Tooltip } from '@arco-design/web-react';
import { IconClose, IconRefresh, IconDelete, IconCloud } from '@arco-design/web-react/icon';
import { ASSET_DRAG_TYPE } from '../../../utils/film/libraryStore';

const { Text, Title } = Typography;

// In-canvas drawer of checked-in assets. Items are draggable onto the board.
const LibraryPanel = ({ items, onClose, onRefresh, onAddToBoard, onRemove }) => (
  <div
    style={{
      width: 240,
      flexShrink: 0,
      background: '#fff',
      borderRight: '1px solid #e5e6eb',
      display: 'flex',
      flexDirection: 'column',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #f2f3f5' }}>
      <Title heading={6} style={{ margin: 0 }}>Library</Title>
      <span>
        <Tooltip content="Refresh"><Button size="mini" type="text" icon={<IconRefresh />} onClick={onRefresh} /></Tooltip>
        <Button size="mini" type="text" icon={<IconClose />} onClick={onClose} />
      </span>
    </div>

    <div style={{ padding: '6px 12px' }}>
      <Text type="secondary" style={{ fontSize: 11 }}>
        Checked-in assets ({items.length}). Drag onto the board, or click ＋.
      </Text>
    </div>

    <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
      {items.length === 0 ? (
        <Empty
          description={<Text type="secondary" style={{ fontSize: 12 }}>No saved assets yet. Lock or Check in an image to keep it here permanently.</Text>}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {items.map((item) => (
            <div
              key={item.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(item));
                e.dataTransfer.effectAllowed = 'copy';
              }}
              style={{
                position: 'relative',
                borderRadius: 6,
                overflow: 'hidden',
                border: '1px solid #e5e6eb',
                cursor: 'grab',
                background: '#f2f3f5',
              }}
              title={item.name}
            >
              <img
                src={item.thumb || item.url}
                alt={item.name}
                draggable={false}
                style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }}
              />
              <div style={{ position: 'absolute', top: 2, right: 2 }}>
                <IconCloud style={{ color: '#0fc6c2', fontSize: 12, background: 'rgba(255,255,255,0.8)', borderRadius: 8, padding: 1 }} title="Saved permanently" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 4px' }}>
                <Button size="mini" type="text" onClick={() => onAddToBoard(item)} style={{ padding: '0 4px', fontSize: 11 }}>＋ Add</Button>
                <Tooltip content="Delete permanently (TOS + Assets library)">
                  <Button size="mini" type="text" status="danger" icon={<IconDelete style={{ fontSize: 11 }} />} onClick={() => onRemove(item)} />
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);

export default LibraryPanel;
