import { Typography, Button, Space, Tag } from '@arco-design/web-react';
import { IconThunderbolt, IconClose, IconRobot, IconPlayArrow } from '@arco-design/web-react/icon';
import { AGENT_COLORS } from '../../../utils/film/agents';

const { Text, Title, Paragraph } = Typography;
const COLOR = AGENT_COLORS.autoDirector;

// Slim control surface for Auto Director. The real workspace is the AutoPlanNode
// on the canvas — this panel just arms it (create / discard) and explains itself.
const AutoDirectorPanel = ({ plan, apiKeyPresent, onCreate, onTakeOver, onClose }) => (
  <div style={{ width: 300, borderLeft: '1px solid #e5e6eb', background: '#fff', display: 'flex', flexDirection: 'column' }}>
    <div style={{ height: 4, background: COLOR }} />
    <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconThunderbolt style={{ color: COLOR, fontSize: 18 }} />
        <Title heading={6} style={{ margin: 0 }}>Auto Director</Title>
      </span>
      {onClose && <Button size="mini" type="text" icon={<IconClose />} onClick={onClose} />}
    </div>

    <div style={{ padding: '0 14px', flex: 1, overflowY: 'auto' }}>
      {!apiKeyPresent && (
        <Text type="error" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>Add your API key first — ⚙ in the far-left sidebar.</Text>
      )}

      {!plan ? (
        <>
          <Paragraph type="secondary" style={{ fontSize: 12 }}>
            Hand it your assets and idea. It understands them, plans a production using every other agent,
            then runs it step by step — you review, pick and approve each step (AI QC flags issues), and it
            stitches the final film.
          </Paragraph>
          <Paragraph type="secondary" style={{ fontSize: 11 }}>
            Tip: <b>select the source images</b> you want to build from first (or leave nothing selected to use
            everything on the board), then create the plan.
          </Paragraph>
          <Button long type="primary" icon={<IconPlayArrow />} disabled={!apiKeyPresent} onClick={onCreate}
            style={{ background: apiKeyPresent ? COLOR : undefined, borderColor: apiKeyPresent ? COLOR : undefined }}>
            Create plan from canvas
          </Button>
        </>
      ) : (
        <>
          <Space style={{ marginBottom: 8 }}>
            <Tag color="purple">{plan.status}</Tag>
            {plan.steps?.length > 0 && <Text type="secondary" style={{ fontSize: 12 }}>{plan.steps.length} steps</Text>}
          </Space>
          <Paragraph type="secondary" style={{ fontSize: 12 }}>
            The plan is live on the canvas. Review, reorder and gate steps there, hit <b>Start production</b>, then
            approve each step as it runs. Outputs appear on the board next to the plan.
          </Paragraph>
          <Button long type="outline" icon={<IconRobot />} onClick={onTakeOver}>Take over manually</Button>
        </>
      )}
    </div>
  </div>
);

export default AutoDirectorPanel;
