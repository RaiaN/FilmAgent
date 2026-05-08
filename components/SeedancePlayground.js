import { useRef, useState } from 'react';
import { Select, Input, InputNumber, Button, Upload, Checkbox, Dropdown, Menu, Message, Tooltip, Grid } from '@arco-design/web-react';
import { IconCode, IconDown, IconRight, IconStar, IconRefresh, IconBook } from '@arco-design/web-react/icon';
import styles from '../styles/Playground.module.css';
import { generateCurlCommand, generatePythonCode, generateNodeCode } from '../utils/codeGenerators';
import { constructSeedancePayload } from '../utils/apiHelpers';
import { getApiKey } from '../utils/apiKeyStore';
import { getEndpointUrl } from '../utils/config';

const { Row, Col } = Grid;

const SeedancePlayground = ({ 
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
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [referenceImageUri, setReferenceImageUri] = useState('');

  const handleInputChange = (key, value) => {
    setFormValues(prev => ({ ...prev, [key]: value }));
  };

  const handleAddReferenceImageUri = () => {
    const nextUri = referenceImageUri.trim();
    if (!nextUri) {
      Message.warning('Please enter an image URI');
      return;
    }

    try {
      const parsedUrl = new URL(nextUri);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        Message.warning('Only http(s) image URIs are supported');
        return;
      }
    } catch (error) {
      Message.warning('Please enter a valid image URI');
      return;
    }

    const currentImages = formValues.reference_images || [];
    if (currentImages.includes(nextUri)) {
      Message.info('This image URI is already added');
      return;
    }

    if (currentImages.length >= 4) {
      Message.warning('Seedance supports up to 4 reference images here');
      return;
    }

    handleInputChange('reference_images', [...currentImages, nextUri]);
    setReferenceImageUri('');
    Message.success('Reference image URI added');
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
      const endpointUrl = getEndpointUrl('video');
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
                  onClick={() => window.open('https://docs.byteplus.com/en/docs/ModelArk/1520757', '_blank')}
                  style={{ marginLeft: 8 }}
              />
          </Tooltip>
        </div>
      </div>

      <form onSubmit={onSubmit}>
        <div className={styles.mainInputArea}>
          {/* Left: Media Inputs */}
          <div className={styles.imageInputs} style={{ maxHeight: '300px', overflowY: 'auto', paddingRight: '8px' }}>
            {/* Reference Images */}
            {!isFieldHidden('reference_images') && (
                <div style={{ position: 'relative' }}>
                    <div className={styles.uploadLabel} style={{ marginBottom: 4 }}>Ref Images</div>
                    <div style={{ fontSize: 12, color: '#86909c', lineHeight: 1.4, marginBottom: 8 }}>
                        Upload local images here or paste a Seedream image URI below.
                    </div>
                    <Upload
                        listType="picture-card"
                        multiple
                        limit={4}
                        accept="image/*"
                        fileList={(formValues.reference_images || []).map((url, index) => ({
                            uid: `refimg-${index}`,
                            url: url,
                            name: `refimg-${index}.png`
                        }))}
                        beforeUpload={(file) => {
                            const mockEvent = { target: { files: [file] } };
                            handleImageUpload(mockEvent, 'reference_images');
                            return false;
                        }}
                        onRemove={(_, file) => {
                           const index = parseInt(file.uid.split('-')[1], 10);
                           removeImage('reference_images', index);
                        }}
                        showUploadList={{
                            removeIcon: <div style={{ color: 'white' }}>x</div>,
                            previewIcon: null,
                        }}
                    />
                    <div style={{ marginTop: 8 }}>
                        <Input
                            placeholder="Paste Seedream image URI (https://...)"
                            value={referenceImageUri}
                            onChange={setReferenceImageUri}
                            onPressEnter={handleAddReferenceImageUri}
                            allowClear
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 8 }}>
                            <div style={{ fontSize: 12, color: '#86909c', lineHeight: 1.4 }}>
                                Add a Seedream output URI directly as another reference image.
                            </div>
                            <Button size="mini" type="secondary" onClick={handleAddReferenceImageUri}>
                                Add URI
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Reference Videos */}
            {!isFieldHidden('reference_videos') && (
                <div style={{ position: 'relative', marginTop: 8 }}>
                    <div className={styles.uploadLabel} style={{ marginBottom: 4 }}>Ref Video</div>
                    <Upload
                        limit={1}
                        accept="video/*"
                        fileList={(formValues.reference_videos || []).map((url, index) => ({
                            uid: `refvid-${index}`,
                            url: url,
                            name: `video-${index}.mp4`
                        }))}
                        beforeUpload={(file) => {
                            const mockEvent = { target: { files: [file] } };
                            handleImageUpload(mockEvent, 'reference_videos');
                            return false;
                        }}
                        onRemove={(_, file) => {
                           const index = parseInt(file.uid.split('-')[1], 10);
                           removeImage('reference_videos', index);
                        }}
                    />
                </div>
            )}

            {/* Reference Audios */}
            {!isFieldHidden('reference_audios') && (
                <div style={{ position: 'relative', marginTop: 8 }}>
                    <div className={styles.uploadLabel} style={{ marginBottom: 4 }}>Ref Audio</div>
                    <Upload
                        limit={1}
                        accept="audio/*"
                        fileList={(formValues.reference_audios || []).map((url, index) => ({
                            uid: `refaud-${index}`,
                            url: url,
                            name: `audio-${index}.mp3`
                        }))}
                        beforeUpload={(file) => {
                            const mockEvent = { target: { files: [file] } };
                            handleImageUpload(mockEvent, 'reference_audios');
                            return false;
                        }}
                        onRemove={(_, file) => {
                           const index = parseInt(file.uid.split('-')[1], 10);
                           removeImage('reference_audios', index);
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
            <div className={styles.toolChip}>
                <span style={{ marginRight: 8 }}>⏱️</span>
                <Select 
                    value={formValues.duration} 
                    onChange={(val) => handleInputChange('duration', val)}
                    style={{ width: 80 }}
                    size="small"
                >
                    {(getFieldOptions('duration') || [2,3,4,5,6,7,8,9,10,11,12]).map(opt => <Select.Option key={opt} value={opt}>{opt}s</Select.Option>)}
                </Select>
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
