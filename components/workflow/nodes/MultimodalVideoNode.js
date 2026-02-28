import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Card, Typography, Tooltip, Tag, Input, Button } from '@arco-design/web-react';
import { IconPlayCircle } from '@arco-design/web-react/icon';
import { getNodeInputs, getNodeOutputs } from '../nodeDefinitions';

const MultimodalVideoNode = ({ data }) => {
  const inputs = getNodeInputs('multimodalVideo');
  const outputs = getNodeOutputs('multimodalVideo');

  return (
    <Card 
        style={{ width: 320, border: '1px solid #c9cdd4', borderRadius: 8, boxShadow: '0 2px 5px rgba(0,0,0,0.1)', position: 'relative' }}
        bodyStyle={{ padding: 12 }}
    >
      {/* Input Handles */}
      <div style={{ position: 'absolute', left: -8, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {Object.entries(inputs).map(([key, config]) => (
            <Tooltip key={key} content={config.label}>
                <div style={{ position: 'relative', width: 16, height: 16 }}>
                    <Handle 
                        type="target" 
                        position={Position.Left} 
                        id={key} 
                        style={{ 
                            background: config.type === 'image' ? '#165dff' : (config.type === 'video' ? '#722ed1' : (config.type === 'audio' ? '#f5319d' : '#ffb400')), 
                            width: 16, height: 16, border: '2px solid #fff' 
                        }} 
                    />
                </div>
            </Tooltip>
          ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, borderBottom: '1px solid #f2f3f5', paddingBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
              <IconPlayCircle style={{ marginRight: 8, color: '#f5319d' }} />
              <Typography.Text bold>Multimodal Video</Typography.Text>
          </div>
          <Tag color="purple" size="small">2.0</Tag>
      </div>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Combine Image, Video, and Audio sources into a single video generation.
      </Typography.Text>

      <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Prompt</Typography.Text>
          <Input.TextArea 
            placeholder="Describe how to combine inputs..." 
            style={{ minHeight: 60, fontSize: 12 }}
            value={data.inputPrompt || data.prompt}
            onChange={(val) => data.onChange('prompt', val)}
            disabled={!!data.inputPrompt}
          />
      </div>

      <div style={{ textAlign: 'right', marginTop: 8 }}>
          <Button type="primary" size="small" disabled>
              Generate (Mock)
          </Button>
      </div>

      {/* Output Handle */}
      {Object.entries(outputs).map(([key, config]) => (
        <Tooltip key={key} content={config.label}>
            <div style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16 }}>
                <Handle 
                    type="source" 
                    position={Position.Right} 
                    id={key} 
                    style={{ 
                        background: '#722ed1', 
                        width: 16, height: 16, border: '2px solid #fff' 
                    }} 
                />
            </div>
        </Tooltip>
      ))}
    </Card>
  );
};

export default memo(MultimodalVideoNode);