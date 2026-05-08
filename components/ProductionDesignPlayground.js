import { useEffect, useMemo, useState } from 'react';
import { Select, Input, Button, Space, Tag, Typography, Upload, Card } from '@arco-design/web-react';
import { IconBook, IconVideoCamera, IconImage, IconDelete } from '@arco-design/web-react/icon';
import styles from '../styles/Playground.module.css';

const FIELD_CONFIG = [
  {
    key: 'prompt',
    label: 'World Brief',
    placeholder:
      'Describe the environment that needs production design exploration, the emotional tone, and what the world should feel like on screen.',
    minHeight: 140,
  },
  {
    key: 'sourceMaterials',
    label: 'Sketch And Visual Inputs',
    placeholder:
      'Summarize the sketch, AI stills, paintovers, kitbash ideas, or other source material that the agent should research and synthesize.',
    minHeight: 120,
  },
  {
    key: 'designRules',
    label: 'Natural-Language Rules',
    placeholder:
      'State the world rules to preserve across iterations: architecture, materials, cultural cues, scale, weather, silhouettes, forbidden directions, and quality bars.',
    minHeight: 120,
  },
  {
    key: 'explorationGoal',
    label: 'This Round\'s Goal',
    placeholder:
      'Explain what this exploration pass should help define: circulation, skyline hierarchy, district transitions, hero landmarks, seasonal mood, or camera path.',
    minHeight: 120,
  },
  {
    key: 'continuityNotes',
    label: 'Continuation Notes',
    placeholder:
      'Add continuity anchors for future passes so the world can keep expanding without starting over.',
    minHeight: 100,
  },
];

const RULE_GROUPS = [
  {
    key: 'architecture',
    label: 'Architecture & Space',
    placeholder: 'District hierarchy, circulation, landmarks, skyline logic, set proportions, thresholds, and civic layout.',
  },
  {
    key: 'materials',
    label: 'Materials & Patina',
    placeholder: 'Material palette, weathering, age, fabrication language, joins, wear patterns, and tactile cues.',
  },
  {
    key: 'culture',
    label: 'Culture & Use',
    placeholder: 'Who uses the space, how they move through it, rituals, labor, infrastructure, and signs of lived history.',
  },
  {
    key: 'camera',
    label: 'Traversal & Camera',
    placeholder: 'How exploration should reveal the world: approach paths, perspective shifts, district transitions, and pacing.',
  },
  {
    key: 'guards',
    label: 'Non-Negotiables',
    placeholder: 'Things the world must never drift away from, plus forbidden directions and red lines.',
  },
];

const FieldBlock = ({ label, value, placeholder, minHeight, onChange }) => (
  <div style={{ marginBottom: 16 }}>
    <Typography.Text bold>{label}</Typography.Text>
    <Input.TextArea
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      style={{
        marginTop: 8,
        minHeight,
        resize: 'vertical',
      }}
    />
  </div>
);

const MediaUploadGroup = ({ label, fieldKey, accept, values, handleImageUpload, removeImage, isVideo = false }) => (
  <div style={{ marginBottom: 16 }}>
    <Typography.Text bold>{label}</Typography.Text>
    <div style={{ marginTop: 8, padding: 12, border: '1px solid #e5e6eb', borderRadius: 8, background: '#f7f8fa' }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: values?.length ? 12 : 0 }}>
        {(values || []).map((value, index) => (
          <div
            key={`${fieldKey}-${index}`}
            style={{
              position: 'relative',
              width: 120,
              height: 90,
              borderRadius: 8,
              overflow: 'hidden',
              background: '#000',
              border: '1px solid #d9d9d9',
            }}
          >
            {isVideo ? (
              <video src={value} controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <img src={value} alt={`${label} ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
            <Button
              size="mini"
              shape="circle"
              status="danger"
              icon={<IconDelete />}
              style={{ position: 'absolute', top: 6, right: 6 }}
              onClick={() => removeImage(fieldKey, index)}
            />
          </div>
        ))}
      </div>
      <Upload
        showUploadList={false}
        accept={accept}
        beforeUpload={(file) => {
          const mockEvent = { target: { files: [file] } };
          handleImageUpload(mockEvent, fieldKey);
          return false;
        }}
      >
        <Button size="small" icon={isVideo ? <IconVideoCamera /> : <IconImage />}>
          Add {isVideo ? 'Video' : 'Image'}
        </Button>
      </Upload>
    </div>
  </div>
);

const ProductionDesignPlayground = ({
  formValues,
  setFormValues,
  onSubmit,
  loading,
  schema,
  onModelChange,
  handleImageUpload,
  removeImage,
  runHistory,
  onLoadRun,
  onResetContinuation,
}) => {
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedPassKey, setSelectedPassKey] = useState('');

  const handleInputChange = (key, value) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleRuleGroupChange = (key, value) => {
    setFormValues((prev) => ({
      ...prev,
      ruleGroups: {
        ...(prev.ruleGroups || {}),
        [key]: value,
      },
    }));
  };

  const getFieldOptions = (key) => {
    const field = (schema?.fields || []).find((item) => item.key === key);
    return field?.options || [];
  };

  const modelOptions = getFieldOptions('model');
  const ratioOptions = getFieldOptions('ratio');
  const selectedRun = useMemo(
    () => (runHistory || []).find((run) => run.runId === selectedRunId) || null,
    [runHistory, selectedRunId]
  );
  const selectedRunPasses = selectedRun?.tasks || [];

  useEffect(() => {
    if (!selectedRun && runHistory?.length) {
      setSelectedRunId(runHistory[0].runId);
    }
  }, [runHistory, selectedRun]);

  useEffect(() => {
    if (selectedRunPasses.length && !selectedRunPasses.some((task) => task.key === selectedPassKey)) {
      setSelectedPassKey(selectedRunPasses[0].key);
    }
  }, [selectedRunPasses, selectedPassKey]);

  return (
    <div className={styles.playgroundContainer}>
      <div className={styles.header}>
        <div className={styles.modelSelector}>
          <IconVideoCamera style={{ fontSize: '1.2rem', marginRight: '0.5rem' }} />
          <Select
            value={formValues.model}
            onChange={(value) => onModelChange({ target: { value } })}
            style={{ width: 300 }}
            triggerProps={{
              autoAlignPopupWidth: false,
              autoAlignPopupMinWidth: true,
              position: 'bl',
            }}
          >
            {modelOptions.map((option) => (
              <Select.Option key={option} value={option}>
                {option}
              </Select.Option>
            ))}
          </Select>
          <Button
            icon={<IconBook />}
            shape="circle"
            type="text"
            onClick={() => window.open('https://docs.byteplus.com/en/docs/ModelArk/1520757', '_blank')}
            style={{ marginLeft: 8 }}
          />
        </div>
      </div>

      <form onSubmit={onSubmit}>
        {(runHistory || []).length > 0 && (
          <Card title="Continue From Previous Run" style={{ marginBottom: 16 }}>
            <Space wrap align="center">
              <Select
                value={selectedRunId}
                onChange={setSelectedRunId}
                style={{ width: 260 }}
                placeholder="Choose a previous run"
              >
                {(runHistory || []).map((run) => (
                  <Select.Option key={run.runId} value={run.runId}>
                    {run.projectSummary || run.inputContext?.prompt || run.runId}
                  </Select.Option>
                ))}
              </Select>
              <Select
                value={selectedPassKey}
                onChange={setSelectedPassKey}
                style={{ width: 180 }}
                placeholder="Choose a pass"
                disabled={!selectedRunPasses.length}
              >
                {selectedRunPasses.map((task) => (
                  <Select.Option key={task.key} value={task.key}>
                    {task.label}
                  </Select.Option>
                ))}
              </Select>
              <Button
                type="secondary"
                disabled={!selectedRun || !selectedPassKey}
                onClick={() => onLoadRun?.(selectedRun, selectedPassKey)}
              >
                Continue Exploration
              </Button>
            </Space>
          </Card>
        )}

        {formValues.continuedFrom && (
          <Card title="Continuation Context" style={{ marginBottom: 16 }}>
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Typography.Text>
                Continuing from <strong>{formValues.continuedFrom.passLabel}</strong>
                {formValues.continuedFrom.videoUrl ? ' with the selected pass video attached.' : ' using the prior brief and rules.'}
              </Typography.Text>
              <Typography.Text type="secondary">
                Previous task: {formValues.continuedFrom.taskId || 'No task id'}
              </Typography.Text>
              <Button size="small" type="secondary" onClick={onResetContinuation}>
                Start Fresh
              </Button>
            </Space>
          </Card>
        )}

        <Card title="Optional Visual Inputs" style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <MediaUploadGroup
              label="Source Images"
              fieldKey="sourceImages"
              accept="image/*"
              values={formValues.sourceImages}
              handleImageUpload={handleImageUpload}
              removeImage={removeImage}
            />
            <MediaUploadGroup
              label="Source Videos"
              fieldKey="sourceVideos"
              accept="video/*"
              values={formValues.sourceVideos}
              handleImageUpload={handleImageUpload}
              removeImage={removeImage}
              isVideo
            />
            <MediaUploadGroup
              label="Continuation Images"
              fieldKey="continuationImages"
              accept="image/*"
              values={formValues.continuationImages}
              handleImageUpload={handleImageUpload}
              removeImage={removeImage}
            />
            <MediaUploadGroup
              label="Continuation Videos"
              fieldKey="continuationVideos"
              accept="video/*"
              values={formValues.continuationVideos}
              handleImageUpload={handleImageUpload}
              removeImage={removeImage}
              isVideo
            />
          </div>
        </Card>

        <div className={styles.mainInputArea} style={{ display: 'block' }}>
          <div className={styles.promptArea} style={{ width: '100%' }}>
            {FIELD_CONFIG.map((field) => (
              <FieldBlock
                key={field.key}
                label={field.label}
                value={formValues[field.key] || ''}
                placeholder={field.placeholder}
                minHeight={field.minHeight}
                onChange={(value) => handleInputChange(field.key, value)}
              />
            ))}
          </div>
        </div>

        <Card title="World Rules" style={{ marginBottom: 16 }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
            Start with structured rule groups before reaching for a mindmap. This keeps the workflow fast, repeatable, and easier to reuse across runs.
          </Typography.Paragraph>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            {RULE_GROUPS.map((group) => (
              <FieldBlock
                key={group.key}
                label={group.label}
                value={formValues.ruleGroups?.[group.key] || ''}
                placeholder={group.placeholder}
                minHeight={110}
                onChange={(value) => handleRuleGroupChange(group.key, value)}
              />
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <FieldBlock
              label="Freeform Rule Notes"
              value={formValues.designRules || ''}
              placeholder="Optional catch-all rules, references, or constraints that do not fit neatly into the structured groups."
              minHeight={110}
              onChange={(value) => handleInputChange('designRules', value)}
            />
          </div>
        </Card>

        <div style={{ marginTop: 16, marginBottom: 16 }}>
          <Space wrap size="medium">
            <Tag color="arcoblue">Step 1: Research brief</Tag>
            <Tag color="green">Step 2: Build world rules</Tag>
            <Tag color="purple">Step 3: Generate 3 exploration passes</Tag>
            <Tag color="orange">Built for continuation</Tag>
            <Tag color="gold">No mindmap required</Tag>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            The agent converts sketches, AI imagery, paintovers, structured world rules, and carry-over references into a
            structured production design brief, then launches three video explorations: an anchor pass, an adjacent pass,
            and a frontier pass.
          </Typography.Paragraph>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.toolChip}>
            <span style={{ marginRight: 8 }}>Aspect</span>
            <Select
              value={formValues.ratio}
              onChange={(value) => handleInputChange('ratio', value)}
              style={{ width: 90 }}
              size="small"
            >
              {ratioOptions.map((option) => (
                <Select.Option key={option} value={option}>
                  {option}
                </Select.Option>
              ))}
            </Select>
          </div>

          <div className={styles.toolChip}>
            <span>Research-first</span>
          </div>

          <div className={styles.toolChip}>
            <span>{(formValues.sourceImages?.length || 0) + (formValues.sourceVideos?.length || 0)} source refs</span>
          </div>

          <div className={styles.toolChip}>
            <span>{(formValues.continuationImages?.length || 0) + (formValues.continuationVideos?.length || 0)} continuity refs</span>
          </div>

          <div className={styles.toolChip}>
            <span>1080p</span>
          </div>

          <div className={styles.toolChip}>
            <span>15s x 3 passes</span>
          </div>

          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            className={styles.submitBtn}
            shape="round"
            size="large"
            style={{ marginLeft: 'auto' }}
          >
            {loading ? 'Researching And Generating...' : 'Create Production Design Explorations'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default ProductionDesignPlayground;
