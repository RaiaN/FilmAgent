import React, { useRef, useState } from 'react';
import { Select, Input, InputNumber, Button, Upload, Checkbox, Dropdown, Menu, Message, Tooltip, Collapse, Grid } from '@arco-design/web-react';
import { IconCopy, IconCode, IconDown, IconRight, IconStar } from '@arco-design/web-react/icon';
import styles from '../styles/Playground.module.css';
import { generateCurlCommand, generatePythonCode, generateNodeCode } from '../utils/codeGenerators';
import { constructSeedreamPayload } from '../utils/apiHelpers';
import { getApiKey } from '../utils/apiKeyStore';

const { Row, Col } = Grid;

const SeedreamPlayground = ({ 
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

      const apiKey = getApiKey();
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
                  systemPrompt: "Refine and enhance this image generation prompt to be more descriptive and artistic. Keep the core intent but add details about lighting, texture, and style. Return ONLY the enhanced prompt text.",
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
      const payload = constructSeedreamPayload(formValues);
      const endpoint = '/api/seedream'; 
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
  const sizeOptions = getFieldOptions('size');
  const optimizePromptOptions = getFieldOptions('optimize_prompt_mode');
  const outputFormatOptions = getFieldOptions('output_format');

  return (
    <div className={styles.playgroundContainer}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.modelSelector}>
          <span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>🖼️</span>
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
            {/* Reference Image Upload */}
            <Upload
                listType="picture-card"
                multiple
                fileList={(formValues.image || []).map((url, index) => ({
                    uid: `img-${index}`,
                    url: url,
                    name: `image-${index}.png`
                }))}
                onChange={(_, currentFile) => {
                    // Arco's onChange gives us the file object. 
                    // We need to bridge this to our existing handleImageUpload logic which expects an event-like object or handle directly.
                    // Since our existing logic reads files from input event, we might need to adapt.
                    // Actually, simpler to just use our custom upload box style but maybe wrap in Arco Card?
                    // Or stick to the custom style which looks good, but maybe replace the inner input?
                    // Let's revert to custom style for upload box to match the "playground" look exactly, 
                    // as Arco's upload component is a bit different.
                    // But wait, the user asked to use Arco components.
                    // Let's try to adapt Arco Upload but keep it minimal.
                }}
                beforeUpload={(file) => {
                    // Bridge to existing image upload logic
                    const mockEvent = { target: { files: [file] } };
                    handleImageUpload(mockEvent, 'image');
                    return false; // Prevent auto upload
                }}
                onRemove={(file) => {
                    const index = (formValues.image || []).indexOf(file.url);
                    if (index > -1) {
                        removeImage('image', index);
                    }
                }}
                showUploadList={{
                    // Custom render or default? Default picture-card is nice.
                    removeIcon: <div style={{ color: 'white' }}>x</div>,
                    previewIcon: null,
                }}
            />
          </div>

          {/* Right: Prompt */}
          <div className={styles.promptArea}>
            <div style={{ position: 'relative', height: '100%' }}>
                <Input.TextArea
                ref={promptRef}
                className={styles.promptInput}
                placeholder="Describe the image you want to generate..."
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
          {/* Size */}
          {!isFieldHidden('size') && (
             <div className={styles.toolChip}>
                <span style={{ marginRight: 8 }}>📏</span>
                <Select 
                    value={formValues.size} 
                    onChange={(val) => handleInputChange('size', val)}
                    style={{ width: 100 }}
                    size="small"
                >
                    {sizeOptions.map(opt => <Select.Option key={opt} value={opt}>{opt}</Select.Option>)}
                </Select>
            </div>
          )}

          {/* Custom W/H if Size is Custom */}
          {!isFieldHidden('width') && (
             <div className={styles.toolChip}>
                <InputNumber 
                    placeholder="W"
                    value={formValues.width}
                    onChange={(val) => handleInputChange('width', val)}
                    style={{ width: 70 }}
                    size="small"
                />
                <span style={{ margin: '0 4px' }}>x</span>
                <InputNumber 
                    placeholder="H"
                    value={formValues.height}
                    onChange={(val) => handleInputChange('height', val)}
                    style={{ width: 70 }}
                    size="small"
                />
            </div>
          )}

          {/* Sequential Toggle */}
          {!isFieldHidden('sequential_image_generation') && (
            <div className={styles.toolChip}>
                <Checkbox 
                    checked={formValues.sequential_image_generation}
                    onChange={(checked) => handleInputChange('sequential_image_generation', checked)}
                >
                    Sequential
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
                        {!isFieldHidden('sequential_max_images') && (
                            <Col span={12}>
                                <div style={{ fontSize: 12, marginBottom: 4, color: '#64748b' }}>Max Images (Sequential)</div>
                                <InputNumber 
                                    value={formValues.sequential_max_images}
                                    onChange={(val) => handleInputChange('sequential_max_images', val)}
                                    min={1} max={15}
                                    style={{ width: '100%' }}
                                />
                            </Col>
                        )}
                        {!isFieldHidden('optimize_prompt_mode') && (
                            <Col span={12}>
                                <div style={{ fontSize: 12, marginBottom: 4, color: '#64748b' }}>Prompt Optimization</div>
                                <Select 
                                    value={formValues.optimize_prompt_mode} 
                                    onChange={(val) => handleInputChange('optimize_prompt_mode', val)}
                                    style={{ width: '100%' }}
                                >
                                    {optimizePromptOptions.map(opt => <Select.Option key={opt} value={opt}>{opt}</Select.Option>)}
                                </Select>
                            </Col>
                        )}
                        {!isFieldHidden('output_format') && (
                            <Col span={12}>
                                <div style={{ fontSize: 12, marginBottom: 4, color: '#64748b' }}>Output Format</div>
                                <Select 
                                    value={formValues.output_format} 
                                    onChange={(val) => handleInputChange('output_format', val)}
                                    style={{ width: '100%' }}
                                >
                                    {outputFormatOptions.map(opt => <Select.Option key={opt} value={opt}>{opt}</Select.Option>)}
                                </Select>
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

export default SeedreamPlayground;
