import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Card, Typography, Select, Input, Button, Image, Upload, Checkbox, Tooltip } from '@arco-design/web-react';
import { IconVideoCamera, IconDownload, IconRefresh } from '@arco-design/web-react/icon';

const VideoGenNode = ({ data }) => {
  return (
    <Card 
        style={{ width: 300, border: '1px solid #c9cdd4', borderRadius: 8, boxShadow: '0 2px 5px rgba(0,0,0,0.1)', position: 'relative' }}
        bodyStyle={{ padding: 12 }}
    >
      {/* Input Handles */}
      <div style={{ position: 'absolute', left: -8, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Tooltip content="First Frame Input">
              <div style={{ position: 'relative', width: 16, height: 16 }}>
                  <Handle type="target" position={Position.Left} id="firstFrame" style={{ background: '#165dff', width: 16, height: 16, border: '2px solid #fff' }} />
              </div>
          </Tooltip>
          <Tooltip content="Last Frame Input">
              <div style={{ position: 'relative', width: 16, height: 16 }}>
                  <Handle type="target" position={Position.Left} id="lastFrame" style={{ background: '#722ed1', width: 16, height: 16, border: '2px solid #fff' }} />
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
              <IconVideoCamera style={{ marginRight: 8, color: '#ff7d00' }} />
              <Typography.Text bold>Video Generation</Typography.Text>
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
      
      {data.inputImage ? (
          <div style={{ marginBottom: 8, padding: 8, background: '#f8f9fa', borderRadius: 4 }}>
              <Typography.Text type="secondary" style={{ fontSize: 10 }}>Input Image (Linked)</Typography.Text>
              <Image src={data.inputImage} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} />
          </div>
      ) : (
          <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 10 }}>First Frame</Typography.Text>
                  <Upload
                    listType="picture-card"
                    limit={1}
                    fileList={data.uploadedImage ? [{ uid: '-1', url: data.uploadedImage }] : []}
                    showUploadList={{
                        previewIcon: null,
                        removeIcon: <div style={{ color: 'white' }}>x</div>,
                    }}
                    beforeUpload={(file) => {
                        const reader = new FileReader();
                        reader.onload = (e) => data.onChange('uploadedImage', e.target.result);
                        reader.readAsDataURL(file);
                        return false;
                    }}
                    onRemove={() => data.onChange('uploadedImage', null)}
                  />
              </div>
          </div>
      )}

      {data.inputLastFrame ? (
          <div style={{ marginBottom: 8, padding: 8, background: '#f8f9fa', borderRadius: 4 }}>
              <Typography.Text type="secondary" style={{ fontSize: 10 }}>Last Frame (Linked)</Typography.Text>
              <Image src={data.inputLastFrame} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} />
          </div>
      ) : (
          <div style={{ marginBottom: 8 }}>
              <Typography.Text type="secondary" style={{ fontSize: 10 }}>Last Frame</Typography.Text>
              <Upload
                listType="picture-card"
                limit={1}
                fileList={data.lastFrame ? [{ uid: '-1', url: data.lastFrame }] : []}
                showUploadList={{
                    previewIcon: null,
                    removeIcon: <div style={{ color: 'white' }}>x</div>,
                }}
                beforeUpload={(file) => {
                    const reader = new FileReader();
                    reader.onload = (e) => data.onChange('lastFrame', e.target.result);
                    reader.readAsDataURL(file);
                    return false;
                }}
                onRemove={() => data.onChange('lastFrame', null)}
              />
          </div>
      )}

      {data.inputPrompt && (
          <div style={{ marginBottom: 8, padding: 8, background: '#e8ffea', borderRadius: 4, border: '1px solid #b7eb8f' }}>
              <Typography.Text type="secondary" style={{ fontSize: 10, color: '#00b42a' }}>Linked Prompt</Typography.Text>
              <div style={{ fontSize: 11, maxHeight: 40, overflow: 'hidden' }}>{data.inputPrompt}</div>
          </div>
      )}

      <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Model</Typography.Text>
          <Select 
            defaultValue="seedance-1-5-pro-251215" 
            size="small"
            value={data.model}
            onChange={(val) => data.onChange('model', val)}
          >
              <Select.Option value="seedance-1-5-pro-251215">Seedance 1.5 Pro</Select.Option>
          </Select>
      </div>

      <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Prompt</Typography.Text>
          <Input.TextArea 
            placeholder="Describe motion..." 
            style={{ minHeight: 60, fontSize: 12 }}
            value={data.inputPrompt || data.prompt}
            onChange={(val) => data.onChange('prompt', val)}
            disabled={!!data.inputPrompt}
          />
      </div>

      <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Resolution</Typography.Text>
              <Select 
                defaultValue="720p" 
                size="small"
                value={data.resolution}
                onChange={(val) => data.onChange('resolution', val)}
              >
                  <Select.Option value="480p">480p</Select.Option>
                  <Select.Option value="720p">720p</Select.Option>
                  <Select.Option value="1080p">1080p</Select.Option>
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
          <Button type="primary" status="warning" size="small" onClick={data.onRun} loading={data.loading} disabled={!data.inputImage && !data.uploadedImage && !data.lastFrame}>
              Animate
          </Button>
      </div>

      {data.output && (
          <div style={{ marginTop: 12 }}>
              <video 
                src={data.output} 
                controls 
                style={{ width: '100%', borderRadius: 4, background: '#000', maxHeight: 200 }} 
              />
          </div>
      )}

      {/* Output Handle */}
      <Tooltip content="Video Output">
          <div style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16 }}>
              <Handle type="source" position={Position.Right} style={{ background: '#ff7d00', width: 16, height: 16, border: '2px solid #fff' }} />
          </div>
      </Tooltip>
    </Card>
  );
};

export default memo(VideoGenNode);