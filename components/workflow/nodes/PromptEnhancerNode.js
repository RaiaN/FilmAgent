import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Card, Typography, Input, Button, Message, Tooltip } from '@arco-design/web-react';
import { IconStar, IconPlayCircle, IconRefresh } from '@arco-design/web-react/icon';
import { getNodeInputs, getNodeOutputs } from '../nodeDefinitions';

const PromptEnhancerNode = ({ data }) => {
  const inputs = getNodeInputs('promptEnhancer');
  const outputs = getNodeOutputs('promptEnhancer');

  return (
    <Card 
        style={{ width: 300, border: '1px solid #c9cdd4', borderRadius: 8, boxShadow: '0 2px 5px rgba(0,0,0,0.1)', position: 'relative' }}
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
                            background: '#ff7d00', 
                            width: 16, height: 16, border: '2px solid #fff' 
                        }} 
                    />
                </div>
            </Tooltip>
          ))}
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, borderBottom: '1px solid #f2f3f5', paddingBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
              <IconStar style={{ marginRight: 8, color: '#ffb400' }} />
              <Typography.Text bold>Prompt Enhancer</Typography.Text>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
              <Button 
                  icon={<IconRefresh />} 
                  size="mini" 
                  shape="circle" 
                  type="secondary"
                  onClick={(e) => {
                      e.stopPropagation();
                      data.onReset && data.onReset();
                  }}
              />
          </div>
      </div>

      <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Input Prompt</Typography.Text>
          <Input.TextArea 
            placeholder="Simple idea..." 
            style={{ minHeight: 60, fontSize: 12 }}
            value={data.prompt}
            onChange={(val) => data.onChange('prompt', val)}
            className="nodrag"
          />
      </div>

      <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Enhanced Output</Typography.Text>
          <Input.TextArea 
            placeholder="Result..." 
            style={{ minHeight: 80, fontSize: 12, background: '#f8f9fa' }}
            value={data.output}
            readOnly
            className="nodrag"
          />
      </div>

      <Button 
          type="primary" 
          long 
          onClick={data.onRun} 
          loading={data.loading}
          icon={<IconStar />}
      >
          Enhance
      </Button>

      {/* Output Handles */}
      {Object.entries(outputs).map(([key, config]) => (
        <Tooltip key={key} content={config.label}>
            <div style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16 }}>
                <Handle 
                    type="source" 
                    position={Position.Right} 
                    id={key} 
                    style={{ 
                        background: '#165dff', 
                        width: 16, height: 16, border: '2px solid #fff' 
                    }} 
                />
            </div>
        </Tooltip>
      ))}
    </Card>
  );
};

export default memo(PromptEnhancerNode);