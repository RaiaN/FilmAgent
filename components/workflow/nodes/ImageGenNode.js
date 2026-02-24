import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Card, Typography, Select, Input, Button, Image, Upload, Tooltip } from '@arco-design/web-react';
import { IconImage, IconUpload, IconDownload, IconRefresh } from '@arco-design/web-react/icon';

const ImageGenNode = ({ data }) => {
  return (
    <Card 
        style={{ width: 300, border: '1px solid #c9cdd4', borderRadius: 8, boxShadow: '0 2px 5px rgba(0,0,0,0.1)', position: 'relative' }}
        bodyStyle={{ padding: 12 }}
    >
      {/* Input Handles */}
      <div style={{ position: 'absolute', left: -8, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Tooltip content="Reference Image Input">
              <div style={{ position: 'relative', width: 16, height: 16 }}>
                  <Handle type="target" position={Position.Left} id="refImage" style={{ background: '#165dff', width: 16, height: 16, border: '2px solid #fff' }} />
              </div>
          </Tooltip>
          <Tooltip content="Prompt Input">
              <div style={{ position: 'relative', width: 16, height: 16 }}>
                  <Handle type="target" position={Position.Left} id="prompt" style={{ background: '#ffb400', width: 16, height: 16, border: '2px solid #fff' }} />
              </div>
          </Tooltip>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, borderBottom: '1px solid #f2f3f5', paddingBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
              <IconImage style={{ marginRight: 8, color: '#165dff' }} />
              <Typography.Text bold>Image Generation</Typography.Text>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
              {data.output && (
                  <Button 
                    icon={<IconDownload />} 
                    size="mini" 
                    shape="circle" 
                    type="secondary"
                    onClick={(e) => {
                        e.stopPropagation();
                        window.open(data.output, '_blank');
                    }}
                  />
              )}
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
      
      {data.inputPrompt && (
          <div style={{ marginBottom: 8, padding: 8, background: '#e8ffea', borderRadius: 4, border: '1px solid #b7eb8f' }}>
              <Typography.Text type="secondary" style={{ fontSize: 10, color: '#00b42a' }}>Linked Prompt</Typography.Text>
              <div style={{ fontSize: 11, maxHeight: 40, overflow: 'hidden' }}>{data.inputPrompt}</div>
          </div>
      )}

      <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 10 }}>Reference Images</Typography.Text>
          <Upload
            listType="picture-card"
            multiple
            limit={5}
            fileList={data.refImages ? data.refImages.map((url, index) => ({ uid: String(index), url })) : []}
            showUploadList={{
                previewIcon: null,
                removeIcon: <div style={{ color: 'white' }}>x</div>,
            }}
            beforeUpload={(file) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const currentImages = data.refImages || [];
                    data.onChange('refImages', [...currentImages, e.target.result]);
                };
                reader.readAsDataURL(file);
                return false;
            }}
            onRemove={(file) => {
                const currentImages = data.refImages || [];
                const newImages = currentImages.filter((_, index) => String(index) !== file.uid);
                data.onChange('refImages', newImages);
            }}
          />
      </div>

      <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Model</Typography.Text>
          <Select 
            defaultValue="seedream-5-0-lite" 
            size="small"
            value={data.model}
            onChange={(val) => data.onChange('model', val)}
          >
              <Select.Option value="seedream-5-0-lite">Seedream 5.0 Lite</Select.Option>
              <Select.Option value="seedream-4-5-251128">Seedream 4.5</Select.Option>
          </Select>
      </div>

      <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Prompt</Typography.Text>
          <Input.TextArea 
            placeholder="Enter prompt..." 
            style={{ minHeight: 60, fontSize: 12 }}
            value={data.inputPrompt || data.prompt}
            onChange={(val) => data.onChange('prompt', val)}
            disabled={!!data.inputPrompt}
          />
      </div>

      <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Size</Typography.Text>
              <Select 
                defaultValue="2K" 
                size="small"
                value={data.size}
                onChange={(val) => data.onChange('size', val)}
              >
                  <Select.Option value="2K">2K</Select.Option>
                  <Select.Option value="4K">4K</Select.Option>
              </Select>
          </div>
          <div style={{ flex: 1 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Seed</Typography.Text>
              <Input 
                placeholder="-1" 
                size="small"
                value={data.seed}
                onChange={(val) => data.onChange('seed', val)}
              />
          </div>
      </div>

      <div style={{ textAlign: 'right' }}>
          <Button type="primary" size="small" onClick={data.onRun} loading={data.loading}>
              Generate
          </Button>
      </div>

      {data.output && (
          <div style={{ marginTop: 12 }}>
              <Image 
                src={data.output} 
                width="100%" 
                height={200} 
                style={{ objectFit: 'contain', background: '#000', borderRadius: 4 }} 
              />
          </div>
      )}

      <Tooltip content="Image Output">
          <div style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16 }}>
              <Handle type="source" position={Position.Right} style={{ background: '#165dff', width: 16, height: 16, border: '2px solid #fff' }} />
          </div>
      </Tooltip>
    </Card>
  );
};

export default memo(ImageGenNode);