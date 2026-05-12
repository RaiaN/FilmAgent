import { Select, Input, Button, Space, Tag, Typography, Card } from '@arco-design/web-react';
import { IconBook, IconUser } from '@arco-design/web-react/icon';
import styles from '../styles/Playground.module.css';

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

const ProductionDesignPlayground = ({
  formValues,
  setFormValues,
  onSubmit,
  loading,
  schema,
  onModelChange,
}) => {
  const handleInputChange = (key, value) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const getFieldOptions = (key) => {
    const field = (schema?.fields || []).find((item) => item.key === key);
    return field?.options || [];
  };

  const modelOptions = getFieldOptions('model');

  return (
    <div className={styles.playgroundContainer}>
      <div className={styles.header}>
        <div className={styles.modelSelector}>
          <IconUser style={{ fontSize: '1.2rem', marginRight: '0.5rem' }} />
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
            onClick={() => window.open('https://docs.byteplus.com/en/docs/ModelArk/1829186', '_blank')}
            style={{ marginLeft: 8 }}
          />
        </div>
      </div>

      <form onSubmit={onSubmit}>
        <Card title="Character Pipeline" style={{ marginBottom: 16 }}>
          <Space wrap size="medium">
            <Tag color="arcoblue">Step 1: Seed 2.0 Pro prompt rewrite</Tag>
            <Tag color="green">Step 2: Seedream 5.0 portrait anchor</Tag>
            <Tag color="purple">Step 3: Close-shot sheet</Tag>
            <Tag color="orange">Step 4: Full-body sheet</Tag>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            The workflow turns a plain-language fictional character description into a structured editorial portrait prompt,
            generates one photoreal portrait, then expands that same identity into two-sheet outputs while preserving facial details.
          </Typography.Paragraph>
        </Card>

        <FieldBlock
          label="Fictional Character Description"
          value={formValues.prompt || ''}
          placeholder="Describe the fictional character in plain language. Seed 2.0 Pro will convert this into the bracketed editorial portrait format for the first image."
          minHeight={180}
          onChange={(value) => handleInputChange('prompt', value)}
        />

        <div style={{ marginTop: 16, marginBottom: 16 }}>
          <Space wrap size="medium">
            <Tag color="arcoblue">1 portrait image</Tag>
            <Tag color="green">2 close shots</Tag>
            <Tag color="purple">2 distant shots</Tag>
            <Tag color="orange">Identity locked</Tag>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            Steps 2 and 3 always use the portrait anchor URI as the reference image so the character identity remains stable
            across both character-sheet outputs.
          </Typography.Paragraph>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.toolChip}>
            <span>4K output</span>
          </div>

          <div className={styles.toolChip}>
            <span>Seed 2.0 Pro rewrite</span>
          </div>

          <div className={styles.toolChip}>
            <span>Seedream 5.0 endpoint</span>
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
            {loading ? 'Generating Character Sheets...' : 'Generate Character Pipeline'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default ProductionDesignPlayground;
