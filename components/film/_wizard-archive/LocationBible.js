import { useCallback, useState } from 'react';
import {
  Card,
  Button,
  Input,
  Space,
  Tag,
  Typography,
  Message,
  Modal,
  Empty,
} from '@arco-design/web-react';
import {
  IconRefresh,
  IconCheck,
  IconEdit,
  IconExclamationCircleFill,
} from '@arco-design/web-react/icon';

const { Text, Title, Paragraph } = Typography;

const ITEM_STATUS_COLOR = {
  empty: 'gray',
  generating: 'arcoblue',
  draft: 'orange',
  approved: 'green',
  failed: 'red',
};

const ITEM_STATUS_LABEL = {
  empty: 'Not generated',
  generating: 'Generating…',
  draft: 'Draft',
  approved: 'Approved',
  failed: 'Failed',
};

const LocationCard = ({ location, onPatch, onGenerate, onApprove, apiKeyPresent, loading }) => {
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(location.description || '');
  const [editingTime, setEditingTime] = useState(false);
  const [timeDraft, setTimeDraft] = useState(location.time_of_day || '');
  const [zoomed, setZoomed] = useState(false);

  const status = location.status || 'empty';
  const hasImage = !!location.imageUrl;

  return (
    <Card style={{ marginBottom: 12 }} bodyStyle={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Space>
            <Title heading={6} style={{ margin: 0 }}>{location.name}</Title>
            <Tag color="green">{location.time_of_day || '—'}</Tag>
            <Tag color={ITEM_STATUS_COLOR[status]}>{ITEM_STATUS_LABEL[status]}</Tag>
          </Space>
        </div>
        <Space>
          <Button
            size="small"
            type="secondary"
            icon={<IconRefresh />}
            loading={loading || status === 'generating'}
            disabled={!apiKeyPresent}
            onClick={onGenerate}
          >
            {hasImage ? 'Re-roll' : 'Generate'}
          </Button>
          {hasImage && status !== 'approved' && (
            <Button size="small" type="primary" icon={<IconCheck />} onClick={onApprove}>
              Approve
            </Button>
          )}
        </Space>
      </div>

      <div style={{ marginBottom: 8 }}>
        <Space align="start" style={{ width: '100%' }}>
          <Text bold style={{ minWidth: 110 }}>Description</Text>
          {editingDescription ? (
            <Space>
              <Input.TextArea
                value={descriptionDraft}
                onChange={setDescriptionDraft}
                autoSize={{ minRows: 2, maxRows: 6 }}
                style={{ minWidth: 360 }}
              />
              <Button size="mini" type="primary" onClick={() => { onPatch({ description: descriptionDraft }); setEditingDescription(false); }}>Save</Button>
              <Button size="mini" onClick={() => { setDescriptionDraft(location.description || ''); setEditingDescription(false); }}>Cancel</Button>
            </Space>
          ) : (
            <Space>
              <Text>{location.description || <Text type="secondary">—</Text>}</Text>
              <Button size="mini" icon={<IconEdit />} type="text" onClick={() => setEditingDescription(true)} />
            </Space>
          )}
        </Space>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Space align="start">
          <Text bold style={{ minWidth: 110 }}>Time of day</Text>
          {editingTime ? (
            <Space>
              <Input value={timeDraft} onChange={setTimeDraft} style={{ width: 260 }} />
              <Button size="mini" type="primary" onClick={() => { onPatch({ time_of_day: timeDraft }); setEditingTime(false); }}>Save</Button>
              <Button size="mini" onClick={() => { setTimeDraft(location.time_of_day || ''); setEditingTime(false); }}>Cancel</Button>
            </Space>
          ) : (
            <Space>
              <Text>{location.time_of_day || <Text type="secondary">—</Text>}</Text>
              <Button size="mini" icon={<IconEdit />} type="text" onClick={() => setEditingTime(true)} />
            </Space>
          )}
        </Space>
      </div>

      {hasImage && (
        <div
          onClick={() => setZoomed(true)}
          style={{
            width: '100%',
            maxWidth: 480,
            aspectRatio: '16/9',
            borderRadius: 6,
            background: `center/cover no-repeat url(${location.imageUrl})`,
            border: '1px solid #e5e6eb',
            cursor: 'zoom-in',
          }}
        />
      )}

      {location.lastError && (
        <div style={{ marginTop: 12, padding: 8, background: '#fff1f0', borderRadius: 4 }}>
          <Space>
            <IconExclamationCircleFill style={{ color: '#f53f3f' }} />
            <Text type="error" style={{ fontSize: 12 }}>{location.lastError}</Text>
          </Space>
        </div>
      )}

      <Modal
        visible={zoomed}
        footer={null}
        onCancel={() => setZoomed(false)}
        style={{ width: 'auto', maxWidth: '90vw' }}
      >
        {hasImage && <img src={location.imageUrl} alt="" style={{ maxWidth: '85vw', maxHeight: '80vh', display: 'block' }} />}
      </Modal>
    </Card>
  );
};

const LocationBible = ({ project, apiKey, onUpdateProject }) => {
  const locations = project.stages?.locations?.items || [];
  const style = project.stages?.style?.approved;
  const language = project.language || 'en';
  const [busy, setBusy] = useState({});

  const handlePatch = useCallback((locationId, patch) => {
    onUpdateProject((prev) => {
      const items = (prev.stages.locations.items || []).map((it) =>
        it.id === locationId ? { ...it, ...patch } : it,
      );
      return {
        ...prev,
        stages: {
          ...prev.stages,
          locations: {
            ...prev.stages.locations,
            items,
          },
        },
      };
    });
  }, [onUpdateProject]);

  const handleGenerate = useCallback(async (location) => {
    if (!apiKey?.trim()) {
      Message.error('Add your API key in Settings first');
      return;
    }
    if (!style) {
      Message.error('Style Bible must be approved before generating locations');
      return;
    }
    setBusy((prev) => ({ ...prev, [location.id]: true }));
    handlePatch(location.id, { status: 'generating', lastError: '' });
    try {
      const response = await fetch('/api/film/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          language,
          location,
          style,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const errMsg = data?.details || data?.error || `HTTP ${response.status}`;
        handlePatch(location.id, { status: 'failed', lastError: errMsg });
        Message.error(`${location.name}: ${errMsg}`);
        return;
      }
      handlePatch(location.id, {
        status: 'draft',
        imageUrl: data.imageUrl,
        prompt: data.prompt,
        lastError: '',
      });
      Message.success(`${location.name} plate ready`);
    } catch (err) {
      handlePatch(location.id, { status: 'failed', lastError: err.message });
      Message.error(err.message);
    } finally {
      setBusy((prev) => ({ ...prev, [location.id]: false }));
    }
  }, [apiKey, style, language, handlePatch]);

  const handleApprove = useCallback((location) => {
    handlePatch(location.id, { status: 'approved' });
    Message.success(`${location.name} approved`);
  }, [handlePatch]);

  if (!locations.length) {
    return (
      <Card>
        <Empty description="No locations yet. Approve the Script stage to populate this list." />
      </Card>
    );
  }

  return (
    <div>
      <Card style={{ marginBottom: 12 }} bodyStyle={{ padding: 12 }}>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          One establishing plate per location, rendered in the film's locked style. No people in frame. These plates become reference images for every shot that takes place in this location.
        </Paragraph>
      </Card>
      {locations.map((location) => (
        <LocationCard
          key={location.id}
          location={location}
          loading={!!busy[location.id]}
          apiKeyPresent={!!apiKey?.trim()}
          onPatch={(patch) => handlePatch(location.id, patch)}
          onGenerate={() => handleGenerate(location)}
          onApprove={() => handleApprove(location)}
        />
      ))}
    </div>
  );
};

export default LocationBible;
