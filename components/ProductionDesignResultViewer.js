import { useEffect } from 'react';
import { Button, Card, Grid, Space, Tag, Typography } from '@arco-design/web-react';
import CopyButton from './CopyButton';

const { Row, Col } = Grid;

const ImageStageCard = ({ stage }) => {
  if (!stage) return null;

  return (
    <Card title={stage.label} style={{ height: '100%' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="medium">
        <div>
          <Typography.Text type="secondary">Purpose</Typography.Text>
          <Typography.Paragraph style={{ marginTop: 4, marginBottom: 0 }}>
            {stage.description}
          </Typography.Paragraph>
        </div>

        <div>
          <Typography.Text type="secondary">Image URI</Typography.Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <Typography.Text style={{ wordBreak: 'break-all' }}>{stage.imageUrl}</Typography.Text>
            <CopyButton text={stage.imageUrl || ''} />
          </div>
        </div>

        {stage.referenceImageUrl && (
          <div>
            <Typography.Text type="secondary">Reference Portrait URI</Typography.Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Typography.Text style={{ wordBreak: 'break-all' }}>{stage.referenceImageUrl}</Typography.Text>
              <CopyButton text={stage.referenceImageUrl || ''} />
            </div>
          </div>
        )}

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Text type="secondary">Generation Prompt</Typography.Text>
            <CopyButton text={stage.prompt || ''} />
          </div>
          <Typography.Paragraph
            style={{
              whiteSpace: 'pre-wrap',
              marginTop: 8,
              marginBottom: 0,
              padding: 12,
              background: '#f7f8fa',
              borderRadius: 8,
            }}
          >
            {stage.prompt}
          </Typography.Paragraph>
        </div>

        <img
          src={stage.imageUrl}
          alt={stage.label}
          style={{ width: '100%', borderRadius: 8, border: '1px solid #e5e6eb', background: '#f7f8fa' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="secondary" href={stage.imageUrl} as="a" download={`${stage.key}.png`}>
            Download
          </Button>
        </div>
      </Space>
    </Card>
  );
};

const ProductionDesignResultViewer = ({ result, onSnapshotChange }) => {
  useEffect(() => {
    if (result) {
      onSnapshotChange?.(result);
    }
  }, [result, onSnapshotChange]);

  if (!result) return null;

  if (result.error) {
    return <div className="result">{JSON.stringify(result, null, 2)}</div>;
  }

  return (
    <div style={{ marginTop: '2rem' }}>
      <Card title="Character Generation Summary" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="medium">
          <Space wrap>
            <Tag color="arcoblue">Research: {result.researchModel}</Tag>
            <Tag color="green">Generation: {result.generationModel}</Tag>
            <Tag color="purple">Size: {result.size}</Tag>
            <Tag color="orange">1 portrait + 2 sheets</Tag>
          </Space>

          <div>
            <Typography.Text bold>Input Character Description</Typography.Text>
            <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
              {result.inputPrompt}
            </Typography.Paragraph>
          </div>

          <div>
            <Typography.Text bold>Step 1 Structured Portrait Prompt</Typography.Text>
            <Typography.Paragraph
              style={{
                whiteSpace: 'pre-wrap',
                marginTop: 8,
                marginBottom: 0,
                padding: 12,
                background: '#f7f8fa',
                borderRadius: 8,
              }}
            >
              {result.characterPrompt}
            </Typography.Paragraph>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Text bold>Prompt Conversion Trace</Typography.Text>
            <CopyButton text={JSON.stringify(result.promptTrace || {}, null, 2)} />
          </div>
          <Typography.Paragraph
            style={{
              whiteSpace: 'pre-wrap',
              marginBottom: 0,
              padding: 12,
              background: '#f7f8fa',
              borderRadius: 8,
            }}
          >
            {JSON.stringify(result.promptTrace || {}, null, 2)}
          </Typography.Paragraph>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        {(result.steps || []).map((step) => (
          <Col span={12} key={step.key}>
            <ImageStageCard stage={step} />
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default ProductionDesignResultViewer;
