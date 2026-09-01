import { useEffect, useState } from 'react';
import { Drawer, Button, Input, Typography, Space, Tag, Message, Popconfirm, Collapse, Select } from '@arco-design/web-react';
import { IconRefresh, IconDelete, IconPlus } from '@arco-design/web-react/icon';
import {
  hydrateSkills,
  allSkills,
  setSkillText,
  setSkillModels,
  resetSkill,
  addSkill,
  removeSkill,
  skillTokens,
} from '../../utils/film/skills';
import { VIDEO_MODEL_OPTIONS, IMAGE_MODEL_OPTIONS } from '../../utils/film/suiteConfig';

const { Text, Paragraph } = Typography;
const CollapseItem = Collapse.Item;

// The SKILLS LIBRARY: vendor prompt specs the agents send VERBATIM, bound to model slots.
// Disk skills come from skills/<id>/SKILL.md; edits and user skills live in
// localStorage. The whole document rides on every call the binding covers, so each entry
// shows its token weight.
const SkillSettings = ({ visible, onClose }) => {
  const [bump, setBump] = useState(0);
  const [ready, setReady] = useState(false);
  const [activeKeys, setActiveKeys] = useState([]);
  const [draft, setDraft] = useState(null); // {name, text, models} while adding
  const refresh = () => setBump((b) => b + 1);

  useEffect(() => { if (visible) hydrateSkills().then(() => setReady(true)); }, [visible]);

  const skills = ready ? allSkills() : [];
  const slotOptions = [
    ...VIDEO_MODEL_OPTIONS.map((o) => ({ label: `${o.label} · video`, value: o.key })),
    ...IMAGE_MODEL_OPTIONS.map((o) => ({ label: `${o.label} · image`, value: o.key })),
  ];

  const onAdd = () => {
    if (!String(draft?.name || '').trim()) { Message.warning('Name the skill first.'); return; }
    if (!String(draft?.text || '').trim()) { Message.warning('Paste the skill text first.'); return; }
    const made = addSkill(draft);
    setDraft(null);
    setActiveKeys((k) => [...k, made.id]);
    refresh();
    Message.success(`"${made.name}" added — bind it to a model to put it to work.`);
  };

  return (
    <Drawer width={620} title="Skills" visible={visible} onCancel={onClose} onOk={onClose} footer={null}>
      <div>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          A skill is a model vendor&apos;s prompt spec. Bind it to a model slot and the whole document rides
          VERBATIM in every prompt call that model makes — no summary, no paraphrase. Skills in{' '}
          <Text code>skills/</Text> load automatically; drop a folder in and it appears here.
        </Paragraph>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>{skills.length} skill{skills.length === 1 ? '' : 's'}</Text>
          <Button size="small" icon={<IconPlus />} onClick={() => setDraft({ name: '', text: '', models: [] })}>Add skill</Button>
        </div>

        {draft && (
          <div style={{ marginBottom: 14, padding: 12, background: '#f7f8fa', borderRadius: 8 }}>
            <Input size="small" placeholder="Skill name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} style={{ marginBottom: 6 }} />
            <Select
              size="small" mode="multiple" allowClear placeholder="Bind to model slots"
              value={draft.models} onChange={(v) => setDraft({ ...draft, models: v })}
              options={slotOptions} style={{ width: '100%', marginBottom: 6 }}
            />
            <Input.TextArea
              placeholder="Paste the spec…" value={draft.text} onChange={(v) => setDraft({ ...draft, text: v })}
              autoSize={{ minRows: 4, maxRows: 12 }}
              style={{ fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', marginBottom: 6 }}
            />
            <Space>
              <Button size="small" type="primary" style={{ background: '#b06f10', borderColor: '#b06f10' }} onClick={onAdd}>Add</Button>
              <Button size="small" onClick={() => setDraft(null)}>Cancel</Button>
            </Space>
          </div>
        )}

        {!ready && <Text type="secondary" style={{ fontSize: 12 }}>Loading skills…</Text>}

        <Collapse activeKey={activeKeys} onChange={(_k, keys) => setActiveKeys(keys)}>
          {skills.map((s) => (
            <CollapseItem
              key={s.id}
              name={s.id}
              header={<Text bold style={{ fontSize: 13 }}>{s.name}</Text>}
              extra={(
                <Space size={4}>
                  <Tag size="small">{skillTokens(s.text).toLocaleString()} tok</Tag>
                  {(s.models || []).length === 0 && <Tag size="small" color="gray">unbound</Tag>}
                  {(s.models || []).map((m) => <Tag key={m} size="small" color="orange">{m}</Tag>)}
                  {s.edited && <Tag size="small" color="orange">edited</Tag>}
                </Space>
              )}
            >
              <div style={{ padding: 12, background: '#f7f8fa', borderRadius: 8 }}>
                {s.description && <Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 8 }}>{s.description}</Paragraph>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Select
                    size="small" mode="multiple" allowClear placeholder="Bind to model slots — unbound skills never ride"
                    value={s.models || []}
                    onChange={(v) => { setSkillModels(s.id, v); refresh(); }}
                    options={slotOptions} style={{ flex: 1 }}
                  />
                  {s.source === 'disk' ? (
                    <Button size="mini" type="text" icon={<IconRefresh />} disabled={!s.edited} onClick={() => { resetSkill(s.id); refresh(); Message.success('Reset to the file on disk'); }}>Reset</Button>
                  ) : (
                    <Popconfirm title={`Remove "${s.name}"?`} onOk={() => { removeSkill(s.id); refresh(); Message.success('Removed'); }}>
                      <Button size="mini" type="text" status="danger" icon={<IconDelete />}>Remove</Button>
                    </Popconfirm>
                  )}
                </div>
                <Input.TextArea
                  value={s.text}
                  onChange={(v) => { setSkillText(s.id, v); refresh(); }}
                  autoSize={{ minRows: 6, maxRows: 20 }}
                  style={{ fontSize: 11.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                />
              </div>
            </CollapseItem>
          ))}
        </Collapse>
        {ready && !skills.length && (
          <Text type="secondary" style={{ fontSize: 12 }}>No skills yet — add one, or drop a folder into skills/.</Text>
        )}
      </div>
    </Drawer>
  );
};

export default SkillSettings;
