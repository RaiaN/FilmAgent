import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Card, Typography, Tooltip, Tag } from '@arco-design/web-react';
import { IconFullscreen } from '@arco-design/web-react/icon';

const MergeVideosNode = ({ data }) => {
  return (
    <Card 
        style={{ width: 280, border: '1px solid #c9cdd4', borderRadius: 8, boxShadow: '0 2px 5px rgba(0,0,0,0.1)', position: 'relative' }}
        bodyStyle={{ padding: 12 }}
    >
      {/* Input Handles */}
      <div style={{ position: 'absolute', left: -8, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Tooltip content="Input Video A">
              <div style={{ position: 'relative', width: 16, height: 16 }}>
                  <Handle type="target" position={Position.Left} id="videoA" style={{ background: '#722ed1', width: 16, height: 16, border: '2px solid #fff' }} />
              </div>
          </Tooltip>
          <Tooltip content="Input Video B">
              <div style={{ position: 'relative', width: 16, height: 16 }}>
                  <Handle type="target" position={Position.Left} id="videoB" style={{ background: '#722ed1', width: 16, height: 16, border: '2px solid #fff' }} />
              </div>
          </Tooltip>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, borderBottom: '1px solid #f2f3f5', paddingBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
              <IconFullscreen style={{ marginRight: 8, color: '#ff7d00' }} />
              <Typography.Text bold>Merge Videos</Typography.Text>
          </div>
          <Tag color="purple" size="small">2.0</Tag>
      </div>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Seamlessly stitch two videos together with transition.
      </Typography.Text>

      {/* Output Handle */}
      <Tooltip content="Merged Video Output">
          <div style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16 }}>
              <Handle type="source" position={Position.Right} style={{ background: '#722ed1', width: 16, height: 16, border: '2px solid #fff' }} />
          </div>
      </Tooltip>
    </Card>
  );
};

export default memo(MergeVideosNode);