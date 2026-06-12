import { useState } from 'react';
import { Drawer, Button, Input, Typography, Space, Tag, Message, Popconfirm, Collapse } from '@arco-design/web-react';
import { IconRefresh, IconUndo } from '@arco-design/web-react/icon';
import {
  templatesByAgent,
  getTemplateText,
  setTemplateText,
  resetTemplate,
  resetAllTemplates,
  isOverridden,
} from '../../utils/film/promptTemplates';

const { Text, Paragraph } = Typography;
const CollapseItem = Collapse.Item;

// Editable view of every prompt template the agents use. Edits write through to
// localStorage immediately and take effect on the next agent run.
const PromptSettings = ({ visible, onClose }) => {
  // bump forces a re-read of localStorage-backed values after edits/resets.
  // (setBump re-renders on its own — no key remount needed, so collapse state
  // and input focus survive edits.)
  const [bump, setBump] = useState(0);
  const refresh = () => setBump((b) => b + 1);

  const groups = templatesByAgent();
  const agentNames = Object.keys(groups);
  // Collapsed by default so each agent is a clean, scannable section.
  const [activeKeys, setActiveKeys] = useState([]);

  const onEdit = (id, value) => { setTemplateText(id, value); refresh(); };
  const onReset = (id) => { resetTemplate(id); refresh(); Message.success('Reset to default'); };
  const onResetAll = () => { resetAllTemplates(); refresh(); Message.success('All prompts reset to defaults'); };

  const editedCount = (items) => items.filter((t) => isOverridden(t.id)).length;
  const allOpen = activeKeys.length === agentNames.length && agentNames.length > 0;
  const toggleAll = () => setActiveKeys(allOpen ? [] : agentNames);

  return (
    <Drawer
      width={560}
      title="Agent Prompts"
      visible={visible}
      onCancel={onClose}
      onOk={onClose}
      okText="Done"
      footer={null}
    >
      <div>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          These are the exact prompts every Film Agent uses. Edit any of them — changes save instantly and apply on the next run.
          Keep the <Text code>{'{placeholders}'}</Text> intact; they're filled in automatically at run time.
        </Paragraph>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Button size="small" type="text" onClick={toggleAll}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </Button>
          <Popconfirm title="Reset every prompt to its default?" onOk={onResetAll}>
            <Button size="small" icon={<IconUndo />}>Reset all to defaults</Button>
          </Popconfirm>
        </div>

        <Collapse
          activeKey={activeKeys}
          onChange={(_key, keys) => setActiveKeys(keys)}
        >
          {Object.entries(groups).map(([agent, items]) => {
            const edited = editedCount(items);
            return (
              <CollapseItem
                key={agent}
                name={agent}
                header={<Text bold style={{ fontSize: 13 }}>{agent}</Text>}
                extra={(
                  <Space size={4}>
                    <Tag size="small">{items.length}</Tag>
                    {edited > 0 && <Tag size="small" color="orange">{edited} edited</Tag>}
                  </Space>
                )}
              >
                {items.map((tpl) => {
                  const overridden = isOverridden(tpl.id);
                  return (
                    <div key={tpl.id} style={{ marginBottom: 14, padding: 12, background: '#f7f8fa', borderRadius: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Space>
                          <Text bold style={{ fontSize: 13 }}>{tpl.label}</Text>
                          {overridden && <Tag size="small" color="orange">edited</Tag>}
                        </Space>
                        <Button
                          size="mini"
                          type="text"
                          icon={<IconRefresh />}
                          disabled={!overridden}
                          onClick={() => onReset(tpl.id)}
                        >
                          Reset
                        </Button>
                      </div>
                      <Input.TextArea
                        value={getTemplateText(tpl.id)}
                        onChange={(value) => onEdit(tpl.id, value)}
                        autoSize={{ minRows: 2, maxRows: 10 }}
                        style={{ fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                      />
                      {tpl.vars?.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>Variables: </Text>
                          {tpl.vars.map((v) => (
                            <Tag key={v} size="small" style={{ marginRight: 4 }}>{v}</Tag>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CollapseItem>
            );
          })}
        </Collapse>
      </div>
    </Drawer>
  );
};

export default PromptSettings;
