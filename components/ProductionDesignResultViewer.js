import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Grid, Space, Tag, Typography } from '@arco-design/web-react';
import {
  IconCheckCircleFill,
  IconClockCircle,
  IconCloseCircleFill,
  IconSync,
} from '@arco-design/web-react/icon';
import CopyButton from './CopyButton';
import { getApiKey } from '../utils/apiKeyStore';

const { Row, Col } = Grid;

const statusIcon = (status) => {
  switch (status) {
    case 'succeeded':
      return <IconCheckCircleFill style={{ color: '#00b42a' }} />;
    case 'failed':
    case 'expired':
      return <IconCloseCircleFill style={{ color: '#f53f3f' }} />;
    case 'running':
      return <IconSync spin style={{ color: '#165dff' }} />;
    default:
      return <IconClockCircle style={{ color: '#ff7d00' }} />;
  }
};

const statusColor = (status) => {
  switch (status) {
    case 'succeeded':
      return 'green';
    case 'failed':
    case 'expired':
      return 'red';
    case 'running':
      return 'arcoblue';
    default:
      return 'orange';
  }
};

const ListCard = ({ title, items }) => {
  if (!items?.length) return null;

  return (
    <Card title={title} style={{ height: '100%' }}>
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        {items.map((item, index) => (
          <Typography.Paragraph key={`${title}-${index}`} style={{ marginBottom: 0 }}>
            {item}
          </Typography.Paragraph>
        ))}
      </Space>
    </Card>
  );
};

const VariantCard = ({ item, status, onContinueExploration, run }) => {
  const resolvedStatus = status?.status || item.task?.status || 'queued';
  const videoUrl = status?.video_url;

  return (
    <Card
      title={item.label}
      style={{ height: '100%' }}
      extra={<Tag color={statusColor(resolvedStatus)} icon={statusIcon(resolvedStatus)}>{resolvedStatus.toUpperCase()}</Tag>}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="medium">
        <div>
          <Typography.Text type="secondary">Exploration Goal</Typography.Text>
          <Typography.Paragraph style={{ marginTop: 4, marginBottom: 0 }}>
            {item.goal}
          </Typography.Paragraph>
        </div>

        <div>
          <Typography.Text type="secondary">Task ID</Typography.Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <Typography.Text>{item.task?.id}</Typography.Text>
            <CopyButton text={item.task?.id || ''} />
          </div>
        </div>

        <div>
          <Typography.Text type="secondary">Pass Intent</Typography.Text>
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginTop: 4, marginBottom: 0 }}>
            {item.directive}
          </Typography.Paragraph>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Text type="secondary">Generation Prompt</Typography.Text>
            <CopyButton text={item.prompt || ''} />
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
            {item.prompt}
          </Typography.Paragraph>
        </div>

        {videoUrl && (
          <div>
            <video
              src={videoUrl}
              controls
              style={{ width: '100%', maxHeight: 320, background: '#000', borderRadius: 8 }}
            />
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="secondary" href={videoUrl} download={`${item.key}-${item.task?.id || 'video'}.mp4`} as="a">
                Download
              </Button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="primary" onClick={() => onContinueExploration?.(run, item, status)}>
            Continue Exploration
          </Button>
        </div>

        {status?.error && (
          <Typography.Paragraph type="error" style={{ marginBottom: 0 }}>
            {JSON.stringify(status.error)}
          </Typography.Paragraph>
        )}
      </Space>
    </Card>
  );
};

const ProductionDesignResultViewer = ({ result, onContinueExploration, onSnapshotChange }) => {
  const [taskStatuses, setTaskStatuses] = useState({});

  const tasks = useMemo(() => result?.tasks || [], [result]);
  const runSnapshot = useMemo(() => {
    if (!result) return null;
    return {
      ...result,
      tasks: tasks.map((item) => ({
        ...item,
        taskStatus: taskStatuses[item.task.id] || null,
      })),
    };
  }, [result, tasks, taskStatuses]);

  useEffect(() => {
    if (runSnapshot) {
      onSnapshotChange?.(runSnapshot);
    }
  }, [runSnapshot, onSnapshotChange]);

  useEffect(() => {
    if (!tasks.length) return undefined;

    let cancelled = false;
    const apiKey = getApiKey();

    const poll = async () => {
      try {
        const updates = await Promise.all(
          tasks.map(async (item) => {
            const response = await fetch(`/api/seedance-status?taskId=${item.task.id}`, {
              headers: apiKey
                ? {
                    Authorization: `Bearer ${apiKey}`,
                  }
                : undefined,
            });
            const data = await response.json();
            return [item.task.id, data];
          })
        );

        if (!cancelled) {
          setTaskStatuses((prev) => ({
            ...prev,
            ...Object.fromEntries(updates),
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setTaskStatuses((prev) => ({
            ...prev,
            __polling_error__: { error: error.message },
          }));
        }
      }
    };

    poll();
    const intervalId = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [tasks]);

  if (!result) return null;

  if (result.error) {
    return <div className="result">{JSON.stringify(result, null, 2)}</div>;
  }

  return (
    <div style={{ marginTop: '2rem' }}>
      <Card title="Research Brief" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="medium">
          <Space wrap>
            <Tag color="arcoblue">Research: {result.researchModel}</Tag>
            <Tag color="green">Duration: {result.duration}s</Tag>
            <Tag color="purple">Resolution: {result.resolution}</Tag>
            <Tag color="orange">Ratio: {result.ratio}</Tag>
          </Space>

          {result.projectSummary && (
            <div>
              <Typography.Text bold>Project Summary</Typography.Text>
              <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                {result.projectSummary}
              </Typography.Paragraph>
            </div>
          )}

          {result.worldFoundation && (
            <div>
              <Typography.Text bold>World Foundation</Typography.Text>
              <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                {result.worldFoundation}
              </Typography.Paragraph>
            </div>
          )}

          {result.cameraStrategy && (
            <div>
              <Typography.Text bold>Camera Strategy</Typography.Text>
              <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                {result.cameraStrategy}
              </Typography.Paragraph>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Text bold>Raw Research Output</Typography.Text>
            <CopyButton text={result.researchText || ''} />
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
            {result.researchText}
          </Typography.Paragraph>
        </Space>
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <ListCard title="Design Rules" items={result.designRules} />
        </Col>
        <Col span={8}>
          <ListCard title="Material Palette" items={result.materialPalette} />
        </Col>
        <Col span={8}>
          <ListCard title="Continuation Hooks" items={result.continuationHooks} />
        </Col>
      </Row>

      {result.spatialLogic?.length > 0 && (
        <Card title="Spatial Logic" style={{ marginBottom: 16 }}>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            {result.spatialLogic.map((item, index) => (
              <Typography.Paragraph key={`spatial-${index}`} style={{ marginBottom: 0 }}>
                {item}
              </Typography.Paragraph>
            ))}
          </Space>
        </Card>
      )}

      <Row gutter={[16, 16]}>
        {tasks.map((item) => (
          <Col span={8} key={item.key}>
            <VariantCard
              item={item}
              status={taskStatuses[item.task.id]}
              onContinueExploration={onContinueExploration}
              run={runSnapshot}
            />
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default ProductionDesignResultViewer;
