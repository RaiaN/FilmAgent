import { useRef, useState } from 'react';
import { Select, Input, Button, Upload, Dropdown, Menu, Message, Tooltip } from '@arco-design/web-react';
import { IconCode, IconStar, IconRefresh, IconBook } from '@arco-design/web-react/icon';
import styles from '../styles/Playground.module.css';
import { generateCurlCommand, generatePythonCode, generateNodeCode } from '../utils/codeGenerators';
import { constructWorkflowSeedreamPayload } from '../utils/apiHelpers';
import { MODEL_CAPABILITIES } from '../utils/modelCapabilities';
import { getApiKey } from '../utils/apiKeyStore';
import { getEndpointUrl } from '../utils/config';

const SeedreamPlayground = ({ 
  formValues, 
  setFormValues, 
  onSubmit, 
  loading, 
  schema,
  handleImageUpload,
  removeImage,
  onModelChange,
  onRefreshModels 
}) => {
  const promptRef = useRef(null);
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
      const runs = Math.min(Math.max(Number(formValues.parallelCount) || 1, 1), 20);
      if (runs > 1) {
          Message.warning('Copy code exports a single image request. Multi-image mode runs parallel requests from this app.');
          return;
      }
      const payload = constructWorkflowSeedreamPayload(formValues);
      const endpointUrl = getEndpointUrl('image');
      let code = '';
      
      switch(type) {
          case 'curl':
              code = generateCurlCommand(endpointUrl, payload);
              break;
          case 'python':
              code = generatePythonCode(endpointUrl, payload);
              break;
          case 'node':
              code = generateNodeCode(endpointUrl, payload);
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
    const fields = schema?.fields || [];
    const field = fields.find(f => f.key === key);
    return field ? field.options : [];
  };
  
  const isFieldHidden = (key) => {
    const fields = schema?.fields || [];
    const field = fields.find(f => f.key === key);
    return field?.hidden;
  };

  const modelOptions = getFieldOptions('model');
  const sizeOptions = getFieldOptions('size');
  const selectedModel = modelOptions.find((o) => (typeof o === 'string' ? o : o.value) === formValues.model);
  const modelLabel = selectedModel ? (typeof selectedModel === 'string' ? selectedModel : selectedModel.label) : 'This model';
  const maxRefImages = MODEL_CAPABILITIES[formValues.model]?.max_ref_images || 6;
  const refImages = formValues.image || [];
  const parallelCount = Math.min(Math.max(Number(formValues.parallelCount) || 1, 1), 20);
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
            {modelOptions.map(opt => {
              const value = typeof opt === 'string' ? opt : opt.value;
              const label = typeof opt === 'string' ? opt : opt.label;
              return <Select.Option key={value} value={value}>{label}</Select.Option>;
            })}
          </Select>
          {onRefreshModels && (
              <Tooltip content="Refresh Model List">
                  <Button 
                      icon={<IconRefresh />} 
                      shape="circle" 
                      type="text" 
                      onClick={onRefreshModels}
                      style={{ marginLeft: 8 }}
                  />
              </Tooltip>
          )}
          <Tooltip content="API Reference">
              <Button 
                  icon={<IconBook />} 
                  shape="circle" 
                  type="text" 
                  onClick={() => window.open('https://docs.byteplus.com/en/docs/ModelArk/1541523', '_blank')}
                  style={{ marginLeft: 8 }}
              />
          </Tooltip>
        </div>
      </div>

      <form onSubmit={onSubmit}>
        <div className={styles.mainInputArea}>
          {/* Left: Image Inputs */}
          <div className={styles.imageInputs}>
            {/* Reference Image Upload */}
            <div style={{ fontSize: 12, color: '#86909c', marginBottom: 8 }}>
                Reference images — up to {maxRefImages} for {modelLabel}.
            </div>
            <Upload
                listType="picture-card"
                multiple
                fileList={(formValues.image || []).map((url, index) => ({
                    uid: `img-${index}`,
                    url: url,
                    name: `image-${index}.png`
                }))}
                onChange={() => {
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
                    if (refImages.length >= maxRefImages) {
                        Message.warning(`${modelLabel} accepts up to ${maxRefImages} reference images`);
                        return false;
                    }
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

          {/* Number of images to generate (parallel runs) */}
          <div className={styles.toolChip}>
              <span style={{ marginRight: 8 }}>🖼️ Images</span>
              <Select
                  value={parallelCount}
                  onChange={(val) => handleInputChange('parallelCount', Number(val))}
                  style={{ width: 72 }}
                  size="small"
              >
                  {[1, 5, 10, 20].map((opt) => (
                      <Select.Option key={opt} value={opt}>{opt}</Select.Option>
                  ))}
              </Select>
          </div>

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
            {loading ? `Generating ${parallelCount}x...` : parallelCount > 1 ? `Generate ${parallelCount}x ➔` : 'Generate ➔'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default SeedreamPlayground;
