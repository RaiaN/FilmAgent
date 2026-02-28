import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Card, Typography, Tooltip, Input, Button, Image, Upload } from '@arco-design/web-react';
import { IconRobot, IconPlus, IconClose } from '@arco-design/web-react/icon';
import { getNodeInputs } from '../nodeDefinitions';

const VLMNode = ({ data }) => {
  const inputs = getNodeInputs('llm');
  const outputs = getNodeInputs('llm');

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
                            background: config.type === 'text' ? '#ffb400' : (config.type === 'image' ? '#165dff' : '#722ed1'), 
                            width: 16, height: 16, border: '2px solid #fff' 
                        }} 
                    />
                </div>
            </Tooltip>
          ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, borderBottom: '1px solid #f2f3f5', paddingBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
              <IconRobot style={{ marginRight: 8, color: '#165dff' }} />
              <Typography.Text bold>VLM (AI Analysis)</Typography.Text>
          </div>
          {/* Run button moved to bottom */}
      </div>

      {/* Inputs Display & Upload */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {/* Image Input */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
               {data.inputImage ? (
                  <div style={{ position: 'relative', width: 80, height: 80, border: '1px solid #e5e6eb', borderRadius: 4, overflow: 'hidden' }}>
                      <Image src={data.inputImage} width="100%" height="100%" preview={false} />
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(22, 93, 255, 0.8)', color: '#fff', fontSize: 10, textAlign: 'center' }}>Linked</div>
                  </div>
              ) : data.uploadedImage ? (
                   <div style={{ position: 'relative', width: 80, height: 80, border: '1px solid #e5e6eb', borderRadius: 4, overflow: 'hidden' }}>
                      <Image src={data.uploadedImage} width="100%" height="100%" preview={false} />
                      <Button 
                        size="mini" 
                        status="danger" 
                        shape="circle" 
                        style={{ position: 'absolute', top: 2, right: 2, width: 20, height: 20 }}
                        onClick={() => data.onChange('uploadedImage', null)}
                        icon={<IconClose style={{ fontSize: 12 }} />}
                      />
                  </div>
              ) : (
                  <Upload
                      showUploadList={false}
                      accept="image/*"
                      beforeUpload={(file) => {
                          const reader = new FileReader();
                          reader.onload = (e) => data.onChange('uploadedImage', e.target.result);
                          reader.readAsDataURL(file);
                          return false;
                      }}
                  >
                      <div style={{ 
                          width: 80, 
                          height: 80, 
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
                          <IconPlus style={{ fontSize: 16, marginBottom: 4 }} />
                          <span style={{ fontSize: 10 }}>Image</span>
                      </div>
                  </Upload>
              )}
          </div>

          {/* Video Input */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
               {data.inputVideo ? (
                  <div style={{ position: 'relative', width: 80, height: 80, border: '1px solid #e5e6eb', borderRadius: 4, overflow: 'hidden', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <video src={data.inputVideo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(114, 46, 209, 0.8)', color: '#fff', fontSize: 10, textAlign: 'center' }}>Linked</div>
                  </div>
              ) : data.uploadedVideo ? (
                   <div style={{ position: 'relative', width: 80, height: 80, border: '1px solid #e5e6eb', borderRadius: 4, overflow: 'hidden', background: '#000' }}>
                      <video src={data.uploadedVideo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <Button 
                        size="mini" 
                        status="danger" 
                        shape="circle" 
                        style={{ position: 'absolute', top: 2, right: 2, width: 20, height: 20 }}
                        onClick={() => data.onChange('uploadedVideo', null)}
                        icon={<IconClose style={{ fontSize: 12 }} />}
                      />
                  </div>
              ) : (
                  <Upload
                      showUploadList={false}
                      accept="video/*"
                      beforeUpload={(file) => {
                          const reader = new FileReader();
                          reader.onload = (e) => data.onChange('uploadedVideo', e.target.result);
                          reader.readAsDataURL(file);
                          return false;
                      }}
                  >
                      <div style={{ 
                          width: 80, 
                          height: 80, 
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
                          <IconPlus style={{ fontSize: 16, marginBottom: 4 }} />
                          <span style={{ fontSize: 10 }}>Video</span>
                      </div>
                  </Upload>
              )}
          </div>
      </div>

      <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Prompt</Typography.Text>
          <Input.TextArea 
            placeholder="Ask something..." 
            style={{ minHeight: 60, fontSize: 12 }}
            value={data.inputPrompt || data.prompt}
            onChange={(val) => data.onChange('prompt', val)}
            disabled={!!data.inputPrompt}
          />
      </div>

      {/* Result Display */}
      {data.output && (
          <div className="nodrag" style={{ marginTop: 8, padding: 8, background: '#f8f9fa', borderRadius: 4, border: '1px solid #e5e6eb', maxHeight: 150, overflowY: 'auto', userSelect: 'text', cursor: 'text' }} onMouseDown={(e) => e.stopPropagation()}>
               <Typography.Text style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                   {data.output}
               </Typography.Text>
          </div>
      )}

      {/* Run Button (Moved to bottom) */}
      <div style={{ marginTop: 12, textAlign: 'right' }}>
          <Button 
              size="small" 
              type="primary" 
              long
              onClick={data.onRun} 
              loading={data.loading}
          >
              Run Analysis
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
                        background: config.type === 'text' ? '#ffb400' : '#165dff', 
                        width: 16, height: 16, border: '2px solid #fff' 
                    }} 
                />
            </div>
        </Tooltip>
      ))}
    </Card>
  );
};

export default memo(VLMNode);
