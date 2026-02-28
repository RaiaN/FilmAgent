import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Card, Typography, Select, Tooltip } from '@arco-design/web-react';
import { IconCamera, IconBulb, IconPalette, IconSwap } from '@arco-design/web-react/icon';
import { getNodeOutputs } from '../nodeDefinitions';

const PRESET_OPTIONS = {
    camera: {
        icon: <IconCamera style={{ color: '#165dff' }} />,
        title: 'Camera Shot',
        options: ['Wide Shot', 'Close Up', 'Macro', 'Aerial View', 'Low Angle', 'Dutch Angle', 'Over-the-Shoulder', 'Fisheye Lens']
    },
    lighting: {
        icon: <IconBulb style={{ color: '#ff7d00' }} />,
        title: 'Lighting',
        options: ['Cinematic Lighting', 'Natural Light', 'Golden Hour', 'Studio Lighting', 'Neon Lights', 'Rembrandt Lighting', 'Low Key', 'Volumetric Lighting']
    },
    style: {
        icon: <IconPalette style={{ color: '#722ed1' }} />,
        title: 'Film Style',
        options: ['Photorealistic', 'Cyberpunk', 'Film Noir', 'Anime', 'Vintage 80s', 'Sci-Fi', 'Fantasy', 'Documentary']
    },
    movement: {
        icon: <IconSwap style={{ color: '#00b42a' }} />,
        title: 'Camera Movement',
        options: ['Static', 'Pan Left', 'Pan Right', 'Zoom In', 'Zoom Out', 'Tilt Up', 'Tilt Down', 'Tracking Shot']
    }
};

const PresetNode = ({ data }) => {
  const presetType = data.presetType || 'camera';
  const config = PRESET_OPTIONS[presetType];
  const outputs = getNodeOutputs('preset');

  return (
    <Card 
        style={{ width: 200, border: '1px solid #c9cdd4', borderRadius: 8, boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}
        bodyStyle={{ padding: 12 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, borderBottom: '1px solid #f2f3f5', paddingBottom: 8 }}>
          {config?.icon}
          <Typography.Text bold style={{ marginLeft: 8, fontSize: 12 }}>{config?.title}</Typography.Text>
      </div>

      <Select 
        placeholder="Select..." 
        size="small"
        value={data.value}
        onChange={(val) => data.onChange('value', val)}
        style={{ width: '100%' }}
      >
          {config?.options.map(opt => (
              <Select.Option key={opt} value={opt}>{opt}</Select.Option>
          ))}
      </Select>

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

export default memo(PresetNode);