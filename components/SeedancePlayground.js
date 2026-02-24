import React, { useRef } from 'react';
import { Select, Input, InputNumber, Button, Upload, Checkbox, Slider, Dropdown, Menu, Message, Tooltip } from '@arco-design/web-react';
import { IconCopy, IconCode } from '@arco-design/web-react/icon';
import styles from '../styles/Playground.module.css';
import { generateCurlCommand, generatePythonCode, generateNodeCode } from '../utils/codeGenerators';
import { constructSeedancePayload } from '../utils/apiHelpers';

const SeedancePlayground = ({ 
  formValues, 
  setFormValues, 
  onSubmit, 
  loading, 
  schema,
  handleImageUpload,
  removeImage,
  onModelChange 
}) => {
  const promptRef = useRef(null);

  const handleInputChange = (key, value) => {
    setFormValues(prev => ({ ...prev, [key]: value }));
  };

  const handleCopyCode = (type) => {
      const payload = constructSeedancePayload(formValues);
      const endpoint = '/api/seedance'; // Simplified for display, real call uses full URL
      let code = '';
      
      switch(type) {
          case 'curl':
              code = generateCurlCommand('https://ark.cn-beijing.volces.com/api/v3/content_generation/generations', payload);
              break;
          case 'python':
              code = generatePythonCode('https://ark.cn-beijing.volces.com/api/v3/content_generation/generations', payload);
              break;
          case 'node':
              code = generateNodeCode('https://ark.cn-beijing.volces.com/api/v3/content_generation/generations', payload);
              break;
      }
      
      navigator.clipboard.writeText(code);
      Message.success(`Copied ${type} code to clipboard`);
  };

  const codeMenu = (
      <Menu onClickMenuItem={handleCopyCode}>
          <Menu.Item key="curl">Copy cURL</Menu.Item>
          <Menu.Item key="python">Copy Python</Menu.Item>
          <Menu.Item key="node">Copy Node.js</Menu.Item>
      </Menu>
  );

  const getFieldOptions = (key) => {
    const field = schema.fields.find(f => f.key === key);
    return field ? field.options : [];
  };
  
  const isFieldHidden = (key) => {
      const field = schema.fields.find(f => f.key === key);
      return field?.hidden;
  };

  const modelOptions = getFieldOptions('model');
  const resolutionOptions = getFieldOptions('resolution');
  const ratioOptions = getFieldOptions('ratio');

  return (
    <div className={styles.playgroundContainer}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.modelSelector}>
          <span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>📹</span>
          <Select 
            value={formValues.model} 
            onChange={(val) => onModelChange({ target: { value: val } })}
            style={{ width: 280 }}
            triggerProps={{
                autoAlignPopupWidth: false,
                autoAlignPopupMinWidth: true,
                position: 'bl',
            }}
          >
            {modelOptions.map(opt => (
              <Select.Option key={opt} value={opt}>{opt}</Select.Option>
            ))}
          </Select>
        </div>
      </div>

      <form onSubmit={onSubmit}>
        <div className={styles.mainInputArea}>
          {/* Left: Image Inputs */}
          <div className={styles.imageInputs}>
            {/* First Frame */}
            {!isFieldHidden('first_frame') && (
                <div style={{ position: 'relative' }}>
                    <div className={styles.uploadLabel} style={{ marginBottom: 4 }}>First Frame</div>
                    <Upload
                        listType="picture-card"
                        limit={1}
                        fileList={(formValues.first_frame || []).map((url, index) => ({
                            uid: `first-${index}`,
                            url: url,
                            name: `first-${index}.png`
                        }))}
                        beforeUpload={(file) => {
                            const mockEvent = { target: { files: [file] } };
                            handleImageUpload(mockEvent, 'first_frame');
                            return false;
                        }}
                        onRemove={() => removeImage('first_frame', 0)}
                        showUploadList={{
                            removeIcon: <div style={{ color: 'white' }}>x</div>,
                            previewIcon: null,
                        }}
                    />
                </div>
            )}

            {/* Last Frame */}
            {!isFieldHidden('last_frame') && (
                <div style={{ position: 'relative' }}>
                    <div className={styles.uploadLabel} style={{ marginBottom: 4 }}>Last Frame</div>
                    <Upload
                        listType="picture-card"
                        limit={1}
                        fileList={(formValues.last_frame || []).map((url, index) => ({
                            uid: `last-${index}`,
                            url: url,
                            name: `last-${index}.png`
                        }))}
                        beforeUpload={(file) => {
                            const mockEvent = { target: { files: [file] } };
                            handleImageUpload(mockEvent, 'last_frame');
                            return false;
                        }}
                        onRemove={() => removeImage('last_frame', 0)}
                        showUploadList={{
                            removeIcon: <div style={{ color: 'white' }}>x</div>,
                            previewIcon: null,
                        }}
                    />
                </div>
            )}
          </div>

          {/* Right: Prompt */}
          <div className={styles.promptArea}>
            <Input.TextArea
              ref={promptRef}
              className={styles.promptInput}
              placeholder="Describe the video you want to generate..."
              value={formValues.prompt}
              onChange={(val) => handleInputChange('prompt', val)}
              style={{ minHeight: 140, height: '100%', resize: 'none', border: 'none', background: 'transparent', padding: 0, fontSize: '1rem' }}
            />
          </div>
        </div>

        {/* Toolbar */}
        <div className={styles.toolbar}>
          {/* Resolution */}
          {!isFieldHidden('resolution') && (
             <div className={styles.toolChip}>
                <span style={{ marginRight: 8 }}>HD</span>
                <Select 
                    value={formValues.resolution} 
                    onChange={(val) => handleInputChange('resolution', val)}
                    style={{ width: 80 }}
                    size="small"
                >
                    {resolutionOptions.map(opt => <Select.Option key={opt} value={opt}>{opt}</Select.Option>)}
                </Select>
            </div>
          )}

          {/* Ratio */}
          {!isFieldHidden('ratio') && (
            <div className={styles.toolChip}>
                <span style={{ marginRight: 8 }}>📐</span>
                <Select 
                    value={formValues.ratio} 
                    onChange={(val) => handleInputChange('ratio', val)}
                    style={{ width: 80 }}
                    size="small"
                >
                    {ratioOptions.map(opt => <Select.Option key={opt} value={opt}>{opt}</Select.Option>)}
                </Select>
            </div>
          )}

          {/* Duration */}
          {!isFieldHidden('duration') && (
            <div className={styles.toolChip} style={{ minWidth: 140 }}>
                <span style={{ marginRight: 12 }}>⏱️ {formValues.duration}s</span>
                <Slider 
                    value={formValues.duration} 
                    onChange={(val) => handleInputChange('duration', val)}
                    min={2}
                    max={12}
                    step={1}
                    style={{ width: 100 }}
                    showInput={false}
                />
            </div>
          )}
          
          {/* Return Last Frame */}
           {!isFieldHidden('return_last_frame') && (
            <div className={styles.toolChip}>
                <Checkbox 
                    checked={formValues.return_last_frame}
                    onChange={(checked) => handleInputChange('return_last_frame', checked)}
                >
                    Last Frame
                </Checkbox>
            </div>
          )}

          {/* Audio Toggle */}
          {!isFieldHidden('generate_audio') && (
             <div className={styles.toolChip}>
                <Checkbox 
                    checked={formValues.generate_audio}
                    onChange={(checked) => handleInputChange('generate_audio', checked)}
                >
                    Audio
                </Checkbox>
            </div>
          )}

          {/* Draft Mode */}
          {!isFieldHidden('draft') && (
             <div className={styles.toolChip}>
                <Checkbox 
                    checked={formValues.draft}
                    onChange={(checked) => handleInputChange('draft', checked)}
                >
                    Draft
                </Checkbox>
            </div>
          )}

          {/* Submit */}
          <Dropdown droplist={codeMenu} trigger="click" position="bl">
              <Tooltip content="Copy code snippet (API Key not included)">
                  <Button icon={<IconCode />} style={{ marginLeft: 'auto', marginRight: 12 }} shape="circle" />
              </Tooltip>
          </Dropdown>
          <Button 
            type="primary" 
            htmlType="submit" 
            loading={loading} 
            className={styles.submitBtn}
            shape="round"
            size="large"
            style={{ marginLeft: 0 }}
          >
            {loading ? 'Generating...' : 'Generate ➔'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default SeedancePlayground;
