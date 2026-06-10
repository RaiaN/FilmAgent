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

const buildEnrichedPrompt = ({ character, style }) => {
  const look = style?.look || {};
  const composition = style?.composition || {};
  const styleSummary = [
    look.format && `Format: ${look.format}`,
    look.lens && `Lens: ${look.lens}`,
    look.lighting && `Lighting: ${look.lighting}`,
    Array.isArray(look.palette) && look.palette.length > 0 && `Palette: ${look.palette.join(', ')}`,
    look.grade && `Grade: ${look.grade}`,
    composition.framing_rules && `Framing: ${composition.framing_rules}`,
  ].filter(Boolean).join(' | ');

  return [
    `A film character. Name: ${character.name || character.id}. Role: ${character.role || 'unspecified'}.`,
    '',
    `Physical description: ${character.physical_description || 'unspecified'}`,
    '',
    character.voice_timbre ? `Voice timbre (for later audio direction): ${character.voice_timbre}` : '',
    '',
    `Render the character as if shot for this film:`,
    styleSummary || 'Cinematic short, photoreal, period-consistent wardrobe.',
    '',
    'Wardrobe must read as belonging to this film\'s visual world (period, palette, materials). Photoreal, no retouching, no stylization beyond the film\'s look.',
  ].filter(Boolean).join('\n');
};

const Thumb = ({ src, label, onClick }) => (
  <div style={{ width: 120 }}>
    <div
      onClick={src ? onClick : undefined}
      style={{
        width: 120,
        height: 120,
        borderRadius: 6,
        background: src ? `center/cover no-repeat url(${src})` : '#f2f3f5',
        border: '1px solid #e5e6eb',
        cursor: src ? 'zoom-in' : 'default',
      }}
    />
    <Text type="secondary" style={{ fontSize: 11 }}>{label}</Text>
  </div>
);

const CharacterCard = ({ character, style, onPatch, onGenerate, onApprove, apiKeyPresent, loading }) => {
  const [editingTimbre, setEditingTimbre] = useState(false);
  const [timbreDraft, setTimbreDraft] = useState(character.voice_timbre || '');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(character.physical_description || '');
  const [zoomedImage, setZoomedImage] = useState(null);

  const status = character.status || 'empty';
  const hasImages = character.portraitUrl || character.closeSheetUrl || character.fullBodyUrl;

  return (
    <Card
      style={{ marginBottom: 12 }}
      bodyStyle={{ padding: 16 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Space>
            <Title heading={6} style={{ margin: 0 }}>{character.name}</Title>
            <Tag color="arcoblue">{character.role || '—'}</Tag>
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
            {hasImages ? 'Re-roll' : 'Generate'}
          </Button>
          {hasImages && status !== 'approved' && (
            <Button size="small" type="primary" icon={<IconCheck />} onClick={onApprove}>
              Approve
            </Button>
          )}
        </Space>
      </div>

      <div style={{ marginBottom: 12 }}>
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
              <Button size="mini" type="primary" onClick={() => { onPatch({ physical_description: descriptionDraft }); setEditingDescription(false); }}>Save</Button>
              <Button size="mini" onClick={() => { setDescriptionDraft(character.physical_description || ''); setEditingDescription(false); }}>Cancel</Button>
            </Space>
          ) : (
            <Space>
              <Text>{character.physical_description || <Text type="secondary">—</Text>}</Text>
              <Button size="mini" icon={<IconEdit />} type="text" onClick={() => setEditingDescription(true)} />
            </Space>
          )}
        </Space>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Space align="start" style={{ width: '100%' }}>
          <Text bold style={{ minWidth: 110 }}>Voice timbre</Text>
          {editingTimbre ? (
            <Space>
              <Input.TextArea
                value={timbreDraft}
                onChange={setTimbreDraft}
                autoSize={{ minRows: 1, maxRows: 4 }}
                style={{ minWidth: 360 }}
              />
              <Button size="mini" type="primary" onClick={() => { onPatch({ voice_timbre: timbreDraft }); setEditingTimbre(false); }}>Save</Button>
              <Button size="mini" onClick={() => { setTimbreDraft(character.voice_timbre || ''); setEditingTimbre(false); }}>Cancel</Button>
            </Space>
          ) : (
            <Space>
              <Text>{character.voice_timbre || <Text type="secondary">— (will be injected into shot prompts)</Text>}</Text>
              <Button size="mini" icon={<IconEdit />} type="text" onClick={() => setEditingTimbre(true)} />
            </Space>
          )}
        </Space>
      </div>

      {hasImages && (
        <Space size="medium" wrap>
          <Thumb src={character.portraitUrl} label="Portrait" onClick={() => setZoomedImage(character.portraitUrl)} />
          <Thumb src={character.closeSheetUrl} label="Close sheet" onClick={() => setZoomedImage(character.closeSheetUrl)} />
          <Thumb src={character.fullBodyUrl} label="Full body" onClick={() => setZoomedImage(character.fullBodyUrl)} />
        </Space>
      )}

      {character.lastError && (
        <div style={{ marginTop: 12, padding: 8, background: '#fff1f0', borderRadius: 4 }}>
          <Space>
            <IconExclamationCircleFill style={{ color: '#f53f3f' }} />
            <Text type="error" style={{ fontSize: 12 }}>{character.lastError}</Text>
          </Space>
        </div>
      )}

      <Modal
        visible={!!zoomedImage}
        footer={null}
        onCancel={() => setZoomedImage(null)}
        style={{ width: 'auto', maxWidth: '90vw' }}
      >
        {zoomedImage && (
          <img src={zoomedImage} alt="" style={{ maxWidth: '85vw', maxHeight: '80vh', display: 'block' }} />
        )}
      </Modal>
    </Card>
  );
};

const CharacterBible = ({ project, apiKey, onUpdateProject }) => {
  const characters = project.stages?.characters?.items || [];
  const style = project.stages?.style?.approved;
  const [busy, setBusy] = useState({});

  const handlePatch = useCallback((characterId, patch) => {
    onUpdateProject((prev) => {
      const items = (prev.stages.characters.items || []).map((it) =>
        it.id === characterId ? { ...it, ...patch } : it,
      );
      return {
        ...prev,
        stages: {
          ...prev.stages,
          characters: {
            ...prev.stages.characters,
            items,
          },
        },
      };
    });
  }, [onUpdateProject]);

  const handleGenerate = useCallback(async (character) => {
    if (!apiKey?.trim()) {
      Message.error('Add your API key in Settings first');
      return;
    }
    if (!style) {
      Message.error('Style Bible must be approved before generating characters');
      return;
    }
    setBusy((prev) => ({ ...prev, [character.id]: true }));
    handlePatch(character.id, { status: 'generating', lastError: '' });

    try {
      const enrichedPrompt = buildEnrichedPrompt({ character, style });
      const response = await fetch('/api/production-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          prompt: enrichedPrompt,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const errMsg = data?.details || data?.error || `HTTP ${response.status}`;
        handlePatch(character.id, { status: 'failed', lastError: errMsg });
        Message.error(`${character.name}: ${errMsg}`);
        return;
      }
      handlePatch(character.id, {
        status: 'draft',
        portraitUrl: data?.portrait?.imageUrl || '',
        closeSheetUrl: data?.closeSheet?.imageUrl || '',
        fullBodyUrl: data?.distantSheet?.imageUrl || '',
        portraitPrompt: data?.portrait?.prompt || '',
        lastError: '',
      });
      Message.success(`${character.name} sheets ready`);
    } catch (err) {
      handlePatch(character.id, { status: 'failed', lastError: err.message });
      Message.error(err.message);
    } finally {
      setBusy((prev) => ({ ...prev, [character.id]: false }));
    }
  }, [apiKey, style, handlePatch]);

  const handleApprove = useCallback((character) => {
    handlePatch(character.id, { status: 'approved' });
    Message.success(`${character.name} approved`);
  }, [handlePatch]);

  if (!characters.length) {
    return (
      <Card>
        <Empty description="No characters yet. Approve the Script stage to populate this list." />
      </Card>
    );
  }

  return (
    <div>
      <Card style={{ marginBottom: 12 }} bodyStyle={{ padding: 12 }}>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Each character runs the 3-step character pipeline (portrait anchor → close sheet → full body sheet) using Seed 2.0 Pro + Seedream 5.0. Style Bible is injected so wardrobe and rendering match the film's visual world. Edit the description or voice timbre before generating to refine the output. Re-roll until the look is right, then approve.
        </Paragraph>
      </Card>
      {characters.map((character) => (
        <CharacterCard
          key={character.id}
          character={character}
          style={style}
          loading={!!busy[character.id]}
          apiKeyPresent={!!apiKey?.trim()}
          onPatch={(patch) => handlePatch(character.id, patch)}
          onGenerate={() => handleGenerate(character)}
          onApprove={() => handleApprove(character)}
        />
      ))}
    </div>
  );
};

export default CharacterBible;
