import { useState } from 'react';
import { Button, Input, Space, Typography, Tag, Divider } from '@arco-design/web-react';
import {
  IconClose,
  IconRefresh,
  IconPlayArrow,
  IconRight,
  IconCheckCircle,
  IconImage,
  IconBulb,
} from '@arco-design/web-react/icon';
import { AGENT_COLORS } from '../../../utils/film/agents';
import { agentIcon } from './agentIcons';

const { Text, Title, Paragraph } = Typography;
const COLOR = AGENT_COLORS.storyDirector;
const StoryIcon = agentIcon('story');

const StoryDirectorPanel = ({
  started,
  stepCount,
  steps,
  suggestions,
  busy,             // 'suggesting' | 'generating' | null
  canStartFromSelection,
  apiKeyPresent,
  onStartFromSelection,
  onStartFromIdea,
  onReroll,
  onPick,
  onPickCustom,
  onEnd,
  onClose,
}) => {
  const [custom, setCustom] = useState('');

  return (
    <div style={{ width: 320, borderLeft: '1px solid #e5e6eb', background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 4, background: COLOR }} />
      <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StoryIcon style={{ color: COLOR, fontSize: 18 }} />
          <Title heading={6} style={{ margin: 0 }}>Story Director</Title>
        </span>
        <Button size="mini" type="text" icon={<IconClose />} onClick={onClose} />
      </div>

      <div style={{ padding: '0 14px', flex: 1, overflowY: 'auto' }}>
        {!apiKeyPresent && (
          <Text type="error" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>Add your API key first — ⚙ in the far-left sidebar.</Text>
        )}

        {!started ? (
          <>
            <Paragraph type="secondary" style={{ fontSize: 12 }}>
              Start your story. The agent will suggest what happens next; you pick, it generates the keyframe, and the timeline grows.
            </Paragraph>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button
                long
                type="primary"
                icon={<IconImage />}
                disabled={!canStartFromSelection || !apiKeyPresent}
                onClick={onStartFromSelection}
                style={{ background: canStartFromSelection ? COLOR : undefined, borderColor: canStartFromSelection ? COLOR : undefined }}
              >
                Start from selected frame
              </Button>
              <Button long icon={<IconPlayArrow />} disabled={!apiKeyPresent} loading={busy === 'generating'} onClick={onStartFromIdea}>
                Start from the project idea
              </Button>
              {!canStartFromSelection && (
                <Text type="secondary" style={{ fontSize: 11 }}>Select an image on the board to start from it, or start from your idea.</Text>
              )}
            </Space>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 8 }}>
              <Tag color="gold">Step {stepCount}</Tag>
              {busy === 'generating' && <Tag color="orange">Generating keyframe…</Tag>}
            </div>

            {/* Story so far */}
            {steps?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Story so far</Text>
                <div style={{ marginTop: 4 }}>
                  {steps.map((s, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#4e5969' }}>
                      <Text style={{ color: COLOR }}>{i + 1}.</Text> {s}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Divider style={{ margin: '8px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text bold style={{ fontSize: 12 }}>What happens next?</Text>
              <Button size="mini" type="text" icon={<IconRefresh />} loading={busy === 'suggesting'} onClick={onReroll}>More ideas</Button>
            </div>

            {busy === 'suggesting' && (!suggestions || suggestions.length === 0) ? (
              <Text type="secondary" style={{ fontSize: 12 }}>Thinking of what could happen next…</Text>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={6}>
                {(suggestions || []).map((beat, i) => (
                  <div
                    key={i}
                    onClick={() => busy !== 'generating' && onPick(beat)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #e5e6eb',
                      cursor: busy === 'generating' ? 'not-allowed' : 'pointer',
                      opacity: busy === 'generating' ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => { if (busy !== 'generating') e.currentTarget.style.borderColor = COLOR; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e6eb'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <IconRight style={{ color: COLOR, fontSize: 12 }} />
                      <Text bold style={{ fontSize: 12 }}>{beat.title}</Text>
                    </div>
                    <Text type="secondary" style={{ fontSize: 11 }}>{beat.prompt}</Text>
                  </div>
                ))}
              </Space>
            )}

            <Divider style={{ margin: '10px 0' }} />
            <Text type="secondary" style={{ fontSize: 11 }}>…or write your own next beat</Text>
            <Input.TextArea
              value={custom}
              onChange={setCustom}
              placeholder="e.g. 'the ball smashes through the jeep's windshield'"
              autoSize={{ minRows: 2, maxRows: 4 }}
              style={{ marginTop: 4 }}
            />
            <Button
              size="small"
              long
              icon={<IconBulb />}
              style={{ marginTop: 6 }}
              loading={busy === 'generating'}
              disabled={!custom.trim()}
              onClick={() => { onPickCustom(custom.trim()); setCustom(''); }}
            >
              Generate this beat
            </Button>
          </>
        )}
      </div>

      {started && (
        <div style={{ padding: 12, borderTop: '1px solid #f2f3f5' }}>
          <Button long type="outline" icon={<IconCheckCircle />} onClick={onEnd}>
            End story ({stepCount} {stepCount === 1 ? 'beat' : 'beats'})
          </Button>
        </div>
      )}
    </div>
  );
};

export default StoryDirectorPanel;
