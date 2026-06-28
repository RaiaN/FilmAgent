import { useEffect, useState } from 'react';
import { Typography, Input } from '@arco-design/web-react';
import { IconEdit } from '@arco-design/web-react/icon';

const { Text } = Typography;

// One inline-rename control shared by EVERY board node (asset cards, SHOT cards, …) so the
// label + pencil read and behave identically everywhere. Double-click the name OR click the
// pencil → input; Enter / blur commits via onCommit; Esc cancels. The name hugs the pencil
// (the text is content-width and ellipsises only when long). Theme via props so it fits both
// the light asset cards and the dark SHOT card.
const EditableLabel = ({
  value, onCommit, placeholder = 'Untitled', maxLength = 80, title = 'Double-click to rename',
  textStyle = {}, pencilColor = '#c9cdd4', containerStyle = {}, inputStyle = {},
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  useEffect(() => { if (!editing) setDraft(value || ''); }, [value, editing]);
  const commit = () => { setEditing(false); const next = draft.trim(); if (next !== (value || '')) onCommit(next); };

  if (editing) {
    return (
      <Input
        autoFocus
        size="mini"
        className="nodrag"
        value={draft}
        onChange={setDraft}
        onPressEnter={commit}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); } }}
        onClick={(e) => e.stopPropagation()}
        maxLength={maxLength}
        style={{ height: 24, minWidth: 0, ...containerStyle, ...inputStyle }}
      />
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, ...containerStyle }}>
      <Text
        className="nodrag"
        style={{ flex: '0 1 auto', minWidth: 0, cursor: 'text', ...textStyle, ...(value ? {} : { opacity: 0.55 }) }}
        ellipsis={{ rows: 1 }}
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title={title}
      >
        {value || placeholder}
      </Text>
      <IconEdit
        className="nodrag"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title="Rename"
        style={{ fontSize: 11, color: pencilColor, cursor: 'pointer', flexShrink: 0 }}
      />
    </span>
  );
};

export default EditableLabel;
