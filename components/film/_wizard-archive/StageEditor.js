import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Input,
  Space,
  Tag,
  Typography,
  Message,
  Modal,
} from '@arco-design/web-react';
import { IconRefresh, IconCheck, IconEdit, IconLock } from '@arco-design/web-react/icon';
import { STAGE_LABELS } from './stageStore';
import StageDraftView from './StageDraftView';

const STATUS_COLORS = {
  empty: 'gray',
  draft: 'orange',
  edited: 'gold',
  approved: 'green',
  locked: 'gray',
};

const STATUS_LABELS = {
  empty: 'Not started',
  draft: 'Draft — awaiting approval',
  edited: 'Edited draft',
  approved: 'Approved',
  locked: 'Locked',
};

const StageEditor = ({
  stageKey,
  stage,
  unlocked,
  prereqs,
  loading,
  onGenerate,
  onApprove,
  onEdit,
}) => {
  const [instructions, setInstructions] = useState('');
  const [showRawEditor, setShowRawEditor] = useState(false);
  const [rawText, setRawText] = useState('');

  useEffect(() => {
    setInstructions('');
  }, [stageKey]);

  const current = stage?.draft ?? stage?.approved ?? null;
  const status = unlocked ? (stage?.status || 'empty') : 'locked';

  const editableJson = useMemo(() => {
    try {
      return JSON.stringify(current, null, 2);
    } catch {
      return '';
    }
  }, [current]);

  const openRawEditor = () => {
    setRawText(editableJson);
    setShowRawEditor(true);
  };

  const handleSaveRaw = () => {
    try {
      const parsed = JSON.parse(rawText);
      onEdit(parsed);
      setShowRawEditor(false);
      Message.success('Edited content saved');
    } catch (err) {
      Message.error(`Invalid JSON: ${err.message}`);
    }
  };

  return (
    <Card
      style={{ marginBottom: 16 }}
      title={
        <Space>
          <Typography.Text bold>{STAGE_LABELS[stageKey]}</Typography.Text>
          <Tag color={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</Tag>
        </Space>
      }
      extra={
        unlocked ? (
          <Space>
            <Button
              type="secondary"
              size="small"
              icon={<IconRefresh />}
              loading={loading}
              onClick={() => onGenerate({ instructions })}
            >
              {current ? 'Regenerate' : 'Generate'}
            </Button>
            {current && (
              <Button size="small" icon={<IconEdit />} onClick={openRawEditor}>
                Edit
              </Button>
            )}
            {current && status !== 'approved' && (
              <Button
                type="primary"
                size="small"
                icon={<IconCheck />}
                onClick={onApprove}
              >
                Approve
              </Button>
            )}
          </Space>
        ) : (
          <Space>
            <IconLock />
            <Typography.Text type="secondary">Approve {prereqs.map((p) => STAGE_LABELS[p]).join(' → ')} first</Typography.Text>
          </Space>
        )
      }
    >
      {!unlocked ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          This stage unlocks once the previous stages are approved.
        </Typography.Paragraph>
      ) : !current ? (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            No draft yet. Optionally add director's notes, then click Generate.
          </Typography.Paragraph>
          <Input.TextArea
            value={instructions}
            placeholder="Optional director's notes (style, constraints, must-haves)..."
            onChange={setInstructions}
            autoSize={{ minRows: 2, maxRows: 5 }}
          />
        </Space>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          <StageDraftView stageKey={stageKey} content={current} />
          <Input.TextArea
            value={instructions}
            placeholder="Notes for regeneration (e.g. 'make it darker', 'add a second protagonist')..."
            onChange={setInstructions}
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{ marginTop: 12 }}
          />
        </Space>
      )}

      <Modal
        title={`Edit ${STAGE_LABELS[stageKey]} (raw JSON)`}
        visible={showRawEditor}
        onOk={handleSaveRaw}
        onCancel={() => setShowRawEditor(false)}
        style={{ width: 720 }}
      >
        <Input.TextArea
          value={rawText}
          onChange={setRawText}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
          autoSize={{ minRows: 16, maxRows: 30 }}
        />
      </Modal>
    </Card>
  );
};

export default StageEditor;
