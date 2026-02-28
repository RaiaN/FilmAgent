import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Card, Typography, Input, Button, Message } from '@arco-design/web-react';
import { IconStar } from '@arco-design/web-react/icon';
import { getNodeInputs, getNodeOutputs } from '../nodeDefinitions';

const PromptEnhancerNode = ({ data }) => {
  const inputs = getNodeInputs('promptEnhancer');
  const outputs = getNodeOutputs('promptEnhancer');

  return (
    <Card 
        style={{ width: 280, border: '1px solid #c9cdd4', borderRadius: 8, boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}
        bodyStyle={{ padding: 12 }}
    >
      {Object.entries(inputs).map(([key, config]) => (
          <Handle 
            key={key}
            type="target" 
            position={Position.Left} 
            id={key}
            style={{ background: '#ff7d00' }} 
          />
      ))}
      
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, borderBottom: '1px solid #f2f3f5', paddingBottom: 8 }}>
          <IconStar style={{ marginRight: 8, color: '#ffb400' }} />
          <Typography.Text bold>Prompt Enhancer</Typography.Text>
      </div>

      <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Input Prompt</Typography.Text>
          <Input.TextArea 
            placeholder="Simple idea..." 
            style={{ minHeight: 50, fontSize: 12 }}
            value={data.inputPrompt}
            onChange={(val) => data.onChange('inputPrompt', val)}
          />
      </div>

      <div style={{ textAlign: 'right', marginBottom: 8 }}>
          <Button type="primary" status="success" size="small" onClick={data.onRun} loading={data.loading}>
              Enhance
          </Button>
      </div>

      <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Enhanced Output</Typography.Text>
          <Input.TextArea 
            placeholder="Result..." 
            style={{ minHeight: 80, fontSize: 12, background: '#f8f9fa' }}
            value={data.outputPrompt}
            readOnly
          />
      </div>

      {Object.entries(outputs).map(([key, config]) => (
          <Handle 
            key={key}
            type="source" 
            position={Position.Right} 
            id={key}
            style={{ background: '#165dff' }} 
          />
      ))}
    </Card>
  );
};

export default memo(PromptEnhancerNode);