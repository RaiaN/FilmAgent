import React, { useRef, useState } from 'react';
import { Select, Input, InputNumber, Button, Upload, Checkbox, Slider, Dropdown, Menu, Message, Tooltip, Collapse, Grid } from '@arco-design/web-react';
import { IconCopy, IconCode, IconDown, IconRight, IconStar } from '@arco-design/web-react/icon';
import styles from '../styles/Playground.module.css';
import { generateCurlCommand, generatePythonCode, generateNodeCode } from '../utils/codeGenerators';
import { constructSeedancePayload } from '../utils/apiHelpers';
import { apiKeyStorageKey } from '../utils/schemas';

const { Row, Col } = Grid;

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
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [enhancing, setEnhancing] = useState(false);

  const handleInputChange = (key, value) => {
    setFormValues(prev => ({ ...prev, [key]: value }));
  };

  const handleEnhancePrompt = async () => {
      const currentPrompt = formValues.prompt;
      if (!currentPrompt || !currentPrompt.trim()) {
          Message.warning('Please enter a prompt to enhance');
          return;
      }

      const apiKey = window.localStorage.getItem(apiKeyStorageKey);
      if (!apiKey) {
          Message.error('API key not found. Please set it in Settings.');
          return;
      }

      setEnhancing(true);
      try {
          const response = await fetch('/api/seed', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  prompt: currentPrompt,
                  apiKey: apiKey,
                  systemPrompt: "Refine and enhance this video generation prompt. Focus on describing motion, camera angles, and temporal consistency. Keep the core intent. Return ONLY the enhanced prompt text.",
                  modelId: 'seed-2-0-mini-260215' 
              })
          });
          const data = await response.json();
          if (data.content) {
              handleInputChange('prompt', data.content);
              Message.success('Prompt enhanced!');
          } else {
              Message.error('Failed to enhance prompt');
          }
      } catch (error) {
          console.error(error);
          Message.error('Error enhancing prompt');
      } finally {
          setEnhancing(false);
      }
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
            <div style={{ position: 'relative', height: '100%' }}>
                <Input.TextArea
                ref={promptRef}
                className={styles.promptInput}
                placeholder="Describe the video you want to generate..."
                value={formValues.prompt}
                onChange={(val) => handleInputChange('prompt', val)}
                style={{ minHeight: 140, height: '100%', resize: 'none', border: 'none', background: 'transparent', padding: 0, fontSize: '1rem', paddingRight: 30 }}
                />
                <Tooltip content="Enhance prompt with AI">
                    <Button 
                        icon={<IconStar style={{ color: enhancing ? '#165dff' : '#86909c' }} spin={enhancing} />} 
                        shape="circle" 
                        size="small"
                        style={{ position: 'absolute', bottom: 0, right: 0, background: 'transparent' }}
                        onClick={handleEnhancePrompt}
                        loading={enhancing}
                    />
                </Tooltip>
            </div>
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

        {/* Advanced Settings */}
        <div style={{ marginTop: 16, borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
            <Button 
                type="text" 
                size="small" 
                onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                style={{ color: '#64748b', paddingLeft: 0 }}
            >
                {isAdvancedOpen ? <IconDown /> : <IconRight />} Advanced Settings
            </Button>
            
            {isAdvancedOpen && (
                <div style={{ marginTop: 12, padding: '12px', background: '#f8fafc', borderRadius: 8 }}>
                    <Row gutter={[24, 12]}>
                        {!isFieldHidden('seed') && (
                            <Col span={12}>
                                <div style={{ fontSize: 12, marginBottom: 4, color: '#64748b' }}>Seed</div>
                                <InputNumber 
                                    value={formValues.seed} 
                                    onChange={(val) => handleInputChange('seed', val)}
                                    placeholder="Random (-1)"
                                    style={{ width: '100%' }}
                                />
                            </Col>
                        )}
                        {!isFieldHidden('watermark') && (
                            <Col span={12}>
                                <div style={{ fontSize: 12, marginBottom: 4, color: '#64748b' }}>Options</div>
                                <Checkbox 
                                    checked={formValues.watermark}
                                    onChange={(checked) => handleInputChange('watermark', checked)}
                                >
                                    Add Watermark
                                </Checkbox>
                            </Col>
                        )}
                    </Row>
                </div>
            )}
        </div>
      </form>
    </div>
  );
};

export default SeedancePlayground;
