import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Card, Typography, Select, Input, Button, Image, Checkbox, Tooltip } from '@arco-design/web-react';
import { IconVideoCamera, IconDownload, IconRefresh } from '@arco-design/web-react/icon';
import { getNodeInputs, getNodeOutputs, getPinColor, PIN_COLORS } from '../nodeDefinitions';
import { MODEL_CAPABILITIES } from '../../../utils/modelCapabilities';

const VideoGenNode = ({ data }) => {
  const inputs = getNodeInputs('videoGen');
  const outputs = getNodeOutputs('videoGen');

  const modelCaps = MODEL_CAPABILITIES[data.model] || {};
  const durations = modelCaps.durations || [5]; // Default fallback
  const resolutions = modelCaps.resolutions || ['720p'];

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
                            background: getPinColor(config.type), 
                            width: 16, height: 16, border: '2px solid #fff' 
                        }} 
                    />
                </div>
            </Tooltip>
          ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, borderBottom: '1px solid #f2f3f5', paddingBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
              <IconVideoCamera style={{ marginRight: 8, color: PIN_COLORS.video }} />
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
      
      <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 10 }}>Reference Images</Typography.Text>
          {data.referenceImages && data.referenceImages.length > 0 ? (
              <div style={{ display: 'flex', gap: 4, overflowX: 'auto', padding: 4 }}>
                  {data.referenceImages.map((url, index) => (
                      <Image
                        key={index}
                        src={url}
                        width={56}
                        height={56}
                        style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #e5e6eb' }}
                        preview={false}
                      />
                  ))}
              </div>
          ) : (
              <div style={{ height: 60, background: '#f8f9fa', borderRadius: 4, border: '1px dashed #e5e6eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#86909c', fontSize: 10 }}>
                  Connect Seedream image output
              </div>
          )}
      </div>

      <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Model</Typography.Text>
          <Select 
            defaultValue="ep-20260415171928-pdvvr" 
            size="small"
            value={data.model}
            onChange={(val) => data.onChange('model', val)}
          >
              <Select.Option value="ep-20260415171928-pdvvr">Seedance 2.0</Select.Option>
          </Select>
      </div>

      <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Prompt</Typography.Text>
          <Input.TextArea 
            placeholder="Slow pan right..." 
            style={{ minHeight: 60, fontSize: 12 }}
            value={data.prompt}
            onChange={(val) => data.onChange('prompt', val)}
            className="nodrag"
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
                  {resolutions.map(res => (
                      <Select.Option key={res} value={res}>{res}</Select.Option>
                  ))}
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

      <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Duration (s)</Typography.Text>
          <Select
            size="small"
            value={data.duration ?? 'auto'}
            onChange={(val) => data.onChange('duration', val)}
            style={{ width: '100%' }}
          >
              {durations.map(d => (
                  <Select.Option key={d} value={d}>
                      {typeof d === 'number' ? `${d}s` : 'Auto'}
                  </Select.Option>
              ))}
          </Select>
      </div>

      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Generate Audio</Typography.Text>
          <Checkbox
            checked={!!data.generate_audio}
            onChange={(checked) => data.onChange('generate_audio', checked)}
          />
      </div>

      <div style={{ textAlign: 'right' }}>
          <Button 
            type="primary" 
            status="warning" 
            size="small" 
            onClick={data.onRun} 
            loading={data.loading} 
            disabled={!data.referenceImages || data.referenceImages.length === 0 || !data.prompt}
            title={(!data.referenceImages || data.referenceImages.length === 0 || !data.prompt) ? "Requires Reference Image and Prompt" : "Generate Video"}
          >
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
      {Object.entries(outputs).map(([key, config]) => (
        <Tooltip key={key} content={config.label}>
            <div style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16 }}>
                <Handle 
                    type="source" 
                    position={Position.Right} 
                    id={key} 
                    style={{ 
                        background: getPinColor(config.type), 
                        width: 16, height: 16, border: '2px solid #fff' 
                    }} 
                />
            </div>
        </Tooltip>
      ))}
    </Card>
  );
};

export default memo(VideoGenNode);
