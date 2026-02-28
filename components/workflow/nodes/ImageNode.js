import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Card, Typography, Upload, Image, Tooltip, Button } from '@arco-design/web-react';
import { IconImage, IconPlus, IconClose } from '@arco-design/web-react/icon';
import { getNodeOutputs } from '../nodeDefinitions';

const ImageNode = ({ data }) => {
  const outputs = getNodeOutputs('image');

  return (
    <Card 
        style={{ width: 220, border: '1px solid #c9cdd4', borderRadius: 8, boxShadow: '0 2px 5px rgba(0,0,0,0.1)', position: 'relative' }}
        bodyStyle={{ padding: 12 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, borderBottom: '1px solid #f2f3f5', paddingBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
              <IconImage style={{ marginRight: 8, color: '#165dff' }} />
              <Typography.Text bold>Image</Typography.Text>
          </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
          {data.output ? (
               <div style={{ position: 'relative', width: '100%', height: 120, border: '1px solid #e5e6eb', borderRadius: 4, overflow: 'hidden' }}>
                  <Image src={data.output} width="100%" height="100%" preview={false} />
                  <Button 
                    size="mini" 
                    status="danger" 
                    shape="circle" 
                    style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24 }}
                    onClick={() => data.onChange('output', null)}
                    icon={<IconClose />}
                  />
              </div>
          ) : (
              <Upload
                  showUploadList={false}
                  accept="image/*"
                  beforeUpload={(file) => {
                      const reader = new FileReader();
                      reader.onload = (e) => data.onChange('output', e.target.result);
                      reader.readAsDataURL(file);
                      return false;
                  }}
              >
                  <div style={{ 
                      width: 180, 
                      height: 120, 
                      background: '#f8f9fa', 
                      border: '1px dashed #c9cdd4', 
                      borderRadius: 4, 
                      display: 'flex', 
                      flexDirection: 'column', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      cursor: 'pointer',
                      color: '#86909c'
                  }}>
                      <IconPlus style={{ fontSize: 24, marginBottom: 8 }} />
                      <span style={{ fontSize: 12 }}>Upload Image</span>
                  </div>
              </Upload>
          )}
      </div>

      {Object.entries(outputs).map(([key, config]) => (
        <Tooltip key={key} content={config.label}>
            <div style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16 }}>
                <Handle type="source" position={Position.Right} id={key} style={{ background: '#165dff', width: 16, height: 16, border: '2px solid #fff' }} />
            </div>
        </Tooltip>
      ))}
    </Card>
  );
};

export default memo(ImageNode);
