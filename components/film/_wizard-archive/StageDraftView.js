import { Tag, Typography, Space, Descriptions, Divider } from '@arco-design/web-react';

const { Text, Paragraph, Title } = Typography;

const SafeText = ({ children, type, bold }) => {
  if (children === undefined || children === null || children === '') {
    return <Text type="secondary">—</Text>;
  }
  return <Text type={type} bold={bold}>{String(children)}</Text>;
};

const LoglineView = ({ content }) => (
  <Space direction="vertical" style={{ width: '100%' }}>
    <Title heading={5} style={{ margin: 0 }}>{content.title || 'Untitled'}</Title>
    <Paragraph style={{ fontSize: 16, lineHeight: 1.5, marginBottom: 8 }}>
      <SafeText>{content.logline}</SafeText>
    </Paragraph>
    <Space wrap>
      {content.genre && <Tag color="arcoblue">{content.genre}</Tag>}
      {content.tone && <Tag color="purple">{content.tone}</Tag>}
      {content.audience && <Tag color="green">{content.audience}</Tag>}
    </Space>
    {content.hook && (
      <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
        <Text bold>Hook: </Text>{content.hook}
      </Paragraph>
    )}
  </Space>
);

const TreatmentView = ({ content }) => (
  <Space direction="vertical" style={{ width: '100%' }}>
    <Paragraph style={{ marginBottom: 8 }}><SafeText>{content.premise}</SafeText></Paragraph>
    <Descriptions
      column={1}
      size="small"
      data={[
        { label: 'Protagonist', value: <SafeText>{content.protagonist}</SafeText> },
        { label: 'Obstacle', value: <SafeText>{content.antagonist_or_obstacle}</SafeText> },
        { label: 'Stakes', value: <SafeText>{content.stakes}</SafeText> },
      ]}
    />
    <Divider style={{ margin: '12px 0' }} />
    <Title heading={6} style={{ margin: 0 }}>Beats</Title>
    {(content.beats || []).map((beat) => (
      <div key={beat.id} style={{ padding: '8px 12px', background: '#f7f8fa', borderRadius: 6 }}>
        <Space>
          <Tag size="small" color="arcoblue">Act {beat.act}</Tag>
          <Text bold>{beat.title}</Text>
          <Text type="secondary">~{beat.estimated_seconds}s</Text>
        </Space>
        <Paragraph style={{ marginTop: 6, marginBottom: 0 }}>{beat.summary}</Paragraph>
      </div>
    ))}
  </Space>
);

const ScriptView = ({ content }) => (
  <Space direction="vertical" style={{ width: '100%' }}>
    <div>
      <Title heading={6} style={{ marginTop: 0 }}>Characters</Title>
      <Space wrap>
        {(content.characters || []).map((c) => (
          <Tag key={c.id} color="arcoblue">{c.name} <Text type="secondary" style={{ marginLeft: 4 }}>({c.role})</Text></Tag>
        ))}
      </Space>
    </div>
    <div>
      <Title heading={6}>Locations</Title>
      <Space wrap>
        {(content.locations || []).map((l) => (
          <Tag key={l.id} color="green">{l.name}</Tag>
        ))}
      </Space>
    </div>
    <Divider style={{ margin: '8px 0' }} />
    <Title heading={6} style={{ margin: 0 }}>Scenes</Title>
    {(content.scenes || []).map((scene) => (
      <div key={scene.id} style={{ padding: '10px 12px', background: '#f7f8fa', borderRadius: 6 }}>
        <Space split={<span style={{ color: '#c2c7cf' }}>·</span>}>
          <Text bold>{scene.slugline}</Text>
          <Text type="secondary">~{scene.estimated_seconds}s</Text>
          <Text type="secondary">Beat {scene.beat_id}</Text>
        </Space>
        <Paragraph style={{ marginTop: 6, marginBottom: 6 }}>{scene.action}</Paragraph>
        {(scene.dialogue || []).map((line, idx) => (
          <div key={idx} style={{ paddingLeft: 16, borderLeft: '3px solid #c9cdd4', marginTop: 6 }}>
            <Text bold>
              {(content.characters || []).find((c) => c.id === line.character_id)?.name || line.character_id}
            </Text>
            {line.delivery && <Text type="secondary"> ({line.delivery})</Text>}
            <Paragraph style={{ marginBottom: 0 }}>{line.line}</Paragraph>
          </div>
        ))}
      </div>
    ))}
  </Space>
);

const StyleView = ({ content }) => (
  <Space direction="vertical" style={{ width: '100%' }}>
    <div>
      <Title heading={6} style={{ marginTop: 0 }}>Look</Title>
      <Descriptions
        column={2}
        size="small"
        data={[
          { label: 'Lens', value: <SafeText>{content.look?.lens}</SafeText> },
          { label: 'Format', value: <SafeText>{content.look?.format}</SafeText> },
          { label: 'Aspect Ratio', value: <SafeText>{content.look?.aspect_ratio}</SafeText> },
          { label: 'Lighting', value: <SafeText>{content.look?.lighting}</SafeText> },
          { label: 'Grade', value: <SafeText>{content.look?.grade}</SafeText> },
        ]}
      />
      <Space wrap style={{ marginTop: 8 }}>
        {(content.look?.palette || []).map((swatch, idx) => (
          <Tag key={idx} color="arcoblue">{swatch}</Tag>
        ))}
      </Space>
    </div>
    <Divider style={{ margin: '8px 0' }} />
    <div>
      <Title heading={6}>Composition</Title>
      <Paragraph style={{ marginBottom: 4 }}><Text bold>Framing: </Text>{content.composition?.framing_rules || '—'}</Paragraph>
      <Paragraph><Text bold>Camera movement: </Text>{content.composition?.camera_movement || '—'}</Paragraph>
    </div>
    <div>
      <Title heading={6}>Audio</Title>
      <Paragraph style={{ marginBottom: 4 }}><Text bold>Ambient bed: </Text>{content.audio?.ambient_bed || '—'}</Paragraph>
      <Paragraph style={{ marginBottom: 4 }}><Text bold>Score: </Text>{content.audio?.score_direction || '—'}</Paragraph>
      <Paragraph><Text bold>Voice processing: </Text>{content.audio?.voice_processing || '—'}</Paragraph>
    </div>
    <div>
      <Title heading={6}>Shot Density</Title>
      <Space>
        <Tag color="purple">Avg shot: {content.shot_density?.average_shot_seconds ?? '—'}s</Tag>
        <Tag color="orange">Approx shots: {content.shot_density?.approximate_shot_count ?? '—'}</Tag>
      </Space>
    </div>
    {(content.continuity_rules || []).length > 0 && (
      <div>
        <Title heading={6}>Continuity Rules</Title>
        <ul style={{ marginTop: 0 }}>
          {content.continuity_rules.map((rule, idx) => <li key={idx}>{rule}</li>)}
        </ul>
      </div>
    )}
    {(content.forbidden || []).length > 0 && (
      <div>
        <Title heading={6}>Forbidden</Title>
        <Space wrap>
          {content.forbidden.map((f, idx) => <Tag key={idx} color="red">{f}</Tag>)}
        </Space>
      </div>
    )}
  </Space>
);

const FallbackView = ({ content }) => (
  <pre style={{ background: '#f7f8fa', padding: 12, borderRadius: 6, fontSize: 12, overflow: 'auto', maxHeight: 360 }}>
    {JSON.stringify(content, null, 2)}
  </pre>
);

const StageDraftView = ({ stageKey, content }) => {
  if (!content || typeof content !== 'object') return null;
  switch (stageKey) {
    case 'logline': return <LoglineView content={content} />;
    case 'treatment': return <TreatmentView content={content} />;
    case 'script': return <ScriptView content={content} />;
    case 'style': return <StyleView content={content} />;
    default: return <FallbackView content={content} />;
  }
};

export default StageDraftView;
