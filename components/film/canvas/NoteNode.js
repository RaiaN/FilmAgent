import { createContext, memo, useContext } from 'react';
import { Input, Typography } from '@arco-design/web-react';
import { IconFile } from '@arco-design/web-react/icon';
import EditableLabel from './EditableLabel';

const { Text } = Typography;

// Bridge from a note's edits back to FilmCanvas (functions can't live in
// serializable node.data) — same context pattern as the other node types.
export const NoteContext = createContext({ onChangeText: null, onRename: null });

// A TEXT NOTE — a first-class board element for plain words: add one from the
// right-click menu, or let the Take Viewer's Describe land the VLM's read of a
// frame here. Free-edit, no agent, no calls; the text lives in node.data.text.
// (Never a Brief: the Brief holds the USER's words verbatim — a note is scratch.)
const NoteNodeInner = ({ id, data, selected }) => {
  const { onChangeText, onRename } = useContext(NoteContext);
  return (
    <div style={{ width: 280, background: '#fffbe6', borderRadius: 10, border: `2px solid ${selected ? '#b06f10' : '#f3e2b3'}`, boxShadow: selected ? '0 0 0 3px rgba(176,111,16,0.12)' : '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <div style={{ height: 4, background: '#b06f10' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid #f3e2b3' }}>
        <IconFile style={{ color: '#b06f10', fontSize: 14, flexShrink: 0 }} />
        {onRename ? (
          <EditableLabel value={data.label || 'Note'} onCommit={(v) => onRename(id, v)} containerStyle={{ flex: 1, minWidth: 0 }} textStyle={{ fontSize: 12, fontWeight: 600 }} inputStyle={{ fontSize: 12 }} />
        ) : (
          <Text bold style={{ fontSize: 12, flex: 1 }} ellipsis>{data.label || 'Note'}</Text>
        )}
      </div>
      <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()} style={{ padding: 8 }}>
        <Input.TextArea
          value={data.text || ''}
          onChange={(v) => onChangeText && onChangeText(id, v)}
          placeholder="type anything…"
          autoSize={{ minRows: 3, maxRows: 16 }}
          style={{ background: 'transparent', border: 'none', fontSize: 12, lineHeight: 1.55 }}
        />
      </div>
    </div>
  );
};

export default memo(NoteNodeInner);
