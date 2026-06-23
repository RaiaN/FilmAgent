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
  const [referenceImageAssetId, setReferenceImageAssetId] = useState('');
  const [referenceVideoUri, setReferenceVideoUri] = useState('');
  const [referenceVideoAssetId, setReferenceVideoAssetId] = useState('');
  const [referenceAudioUri, setReferenceAudioUri] = useState('');

  const handleInputChange = (key, value) => {
    setFormValues(prev => ({ ...prev, [key]: value }));
  };

  const currentImageRefs = formValues.reference_image_refs || [];

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
    if (currentImageRefs.some(r => r.value === nextUri)) {
      Message.info('This image URI is already added');
      return;
    }
    if (currentImageRefs.length >= 9) {
      Message.warning('Seedance supports up to 9 reference images');
      return;
    }
    handleInputChange('reference_image_refs', [...currentImageRefs, { type: 'url', value: nextUri }]);
    setReferenceImageUri('');
    Message.success('Reference image URI added');
  };

  const handleAddReferenceImageAssetId = () => {
    const nextValue = referenceImageAssetId.trim();
    if (!nextValue) {
      Message.warning('Please enter an image asset id');
      return;
    }
    if (currentImageRefs.some(r => r.value === nextValue)) {
      Message.info('This image asset id is already added');
      return;
    }
    if (currentImageRefs.length >= 9) {
      Message.warning('Seedance supports up to 9 reference images');
      return;
    }
    handleInputChange('reference_image_refs', [...currentImageRefs, { type: 'asset', value: nextValue }]);
    setReferenceImageAssetId('');
    Message.success('Reference image asset id added');
  };

  const removeReferenceImageRef = (index) => {
    const next = [...currentImageRefs];
    next.splice(index, 1);
    handleInputChange('reference_image_refs', next);
  };

  const currentVideoRefs = formValues.reference_video_refs || [];

  const handleAddReferenceVideoUri = () => {
    const nextUri = referenceVideoUri.trim();
    if (!nextUri) { Message.warning('Please enter a video URI'); return; }
    try {
      const p = new URL(nextUri);
      if (!['http:', 'https:'].includes(p.protocol)) { Message.warning('Only http(s) video URIs are supported'); return; }
    } catch { Message.warning('Please enter a valid video URI'); return; }
    if (currentVideoRefs.some(r => r.value === nextUri)) { Message.info('This video URI is already added'); return; }
    if (currentVideoRefs.length >= 3) { Message.warning('Seedance supports up to 3 reference videos'); return; }
    handleInputChange('reference_video_refs', [...currentVideoRefs, { type: 'url', value: nextUri }]);
    setReferenceVideoUri('');
    Message.success('Reference video URI added');
  };

  const handleAddReferenceVideoAssetId = () => {
    const nextValue = referenceVideoAssetId.trim();
    if (!nextValue) { Message.warning('Please enter a video asset id'); return; }
    if (currentVideoRefs.some(r => r.value === nextValue)) { Message.info('This video asset id is already added'); return; }
    if (currentVideoRefs.length >= 3) { Message.warning('Seedance supports up to 3 reference videos'); return; }
    handleInputChange('reference_video_refs', [...currentVideoRefs, { type: 'asset', value: nextValue }]);
    setReferenceVideoAssetId('');
    Message.success('Reference video asset id added');
  };

  const removeReferenceVideoRef = (index) => {
    const next = [...currentVideoRefs];
    next.splice(index, 1);
    handleInputChange('reference_video_refs', next);
  };

  const addReferenceMediaUri = (fieldKey, nextUri, label, limit, reset) => {
    const trimmedUri = nextUri.trim();
    if (!trimmedUri) {
      Message.warning(`Please enter a ${label.toLowerCase()} URI`);
      return;
    }

    try {
      const parsedUrl = new URL(trimmedUri);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        Message.warning(`Only public http(s) ${label.toLowerCase()} URIs are supported`);
        return;
      }
    } catch (error) {
      Message.warning(`Please enter a valid ${label.toLowerCase()} URI`);
      return;
    }

    const currentValues = formValues[fieldKey] || [];
    if (currentValues.includes(trimmedUri)) {
      Message.info(`This ${label.toLowerCase()} URI is already added`);
      return;
    }

    if (currentValues.length >= limit) {
      Message.warning(`Seedance supports up to ${limit} ${label.toLowerCase()}${limit > 1 ? 's' : ''} here`);
      return;
    }

    handleInputChange(fieldKey, [...currentValues, trimmedUri]);
    reset('');
    Message.success(`${label} URI added`);
  };

  const handleAddReferenceAudioUri = () => {
    addReferenceMediaUri('reference_audios', referenceAudioUri, 'Audio', 1, setReferenceAudioUri);
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
      const hasLocalReferenceMedia = [
        ...(formValues.reference_image_refs || []).filter(r => r.type === 'url').map(r => r.value),
        ...(formValues.reference_video_refs || []).filter(r => r.type === 'url').map(r => r.value),
        ...(formValues.reference_audios || []),
      ].some((value) => typeof value === 'string' && value.startsWith('data:'));
      const hasAssetIds = (formValues.reference_image_refs || []).some(r => r.type === 'asset')
        || (formValues.reference_video_refs || []).some(r => r.type === 'asset');
      if (parallelCount > 1) {
          Message.warning('Copy code exports a single direct API request only. Multi-run mode is handled by this app with parallel requests.');
          return;
      }
      if (hasLocalReferenceMedia || hasAssetIds) {
          Message.warning('Copy code requires direct public URLs only. Local uploads and asset ids are resolved by this app server and cannot be reproduced in direct API snippets.');
          return;
      }
      let payload;
      try {
          payload = constructSeedancePayload(formValues);
      } catch (error) {
          Message.error(error.message);
          return;
      }
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

  const handleSubmit = (event) => {
    event.preventDefault();
    try {
      constructSeedancePayload(formValues);
    } catch (error) {
      Message.error(error.message);
      return;
    }
    onSubmit(event);
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
  const parallelCount = Math.min(Math.max(Number(formValues.parallelCount) || 1, 1), 15);

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

      <form onSubmit={handleSubmit}>
        <div className={styles.mainInputArea}>
          {/* Left: Media Inputs */}
          <div className={styles.imageInputs} style={{ maxHeight: '300px', overflowY: 'auto', paddingRight: '8px' }}>
            {/* Reference Images */}
            {!isFieldHidden('reference_image_refs') && (
                <div style={{ position: 'relative' }}>
                    <div className={styles.uploadLabel} style={{ marginBottom: 4 }}>Ref Images</div>
                    <div style={{ fontSize: 12, color: '#86909c', lineHeight: 1.4, marginBottom: 8 }}>
                        Upload a local image, paste a public URI, or add an Asset ID. The order here maps directly to <code>[Image 1]</code>, <code>[Image 2]</code>, … in your prompt.
                    </div>

                    {/* Ordered reference list */}
                    {currentImageRefs.length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                            {currentImageRefs.map((ref, index) => (
                                <div
                                    key={index}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, padding: '4px 8px', background: '#f2f3f5', borderRadius: 6 }}
                                >
                                    <span style={{ fontSize: 11, fontWeight: 700, color: '#165dff', whiteSpace: 'nowrap', minWidth: 60 }}>
                                        [Image {index + 1}]
                                    </span>
                                    {ref.type === 'url' ? (
                                        <img
                                            src={ref.value}
                                            alt=""
                                            style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                                        />
                                    ) : (
                                        <span style={{ fontSize: 11, color: '#86909c', flexShrink: 0 }}>🏷</span>
                                    )}
                                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#4e5969', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {ref.name || (ref.type === 'url' && ref.value.startsWith('data:') ? 'local file' : ref.value)}
                                    </span>
                                    <Button size="mini" type="text" onClick={() => removeReferenceImageRef(index)} style={{ padding: '0 4px', flexShrink: 0 }}>×</Button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Local file upload */}
                    <Upload
                        listType="picture-card"
                        multiple
                        accept="image/*"
                        fileList={[]}
                        showUploadList={false}
                        beforeUpload={(file) => {
                            if (currentImageRefs.length >= 9) {
                                Message.warning('Seedance supports up to 9 reference images');
                                return false;
                            }
                            const reader = new FileReader();
                            reader.onload = () => {
                                setFormValues(prev => ({
                                    ...prev,
                                    reference_image_refs: [
                                        ...(prev.reference_image_refs || []),
                                        { type: 'url', value: reader.result, name: file.name },
                                    ],
                                }));
                            };
                            reader.readAsDataURL(file);
                            return false;
                        }}
                    />

                    {/* Public URI input */}
                    <div style={{ marginTop: 12 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <Input
                                placeholder="Public image URI (https://...)"
                                value={referenceImageUri}
                                onChange={setReferenceImageUri}
                                onPressEnter={handleAddReferenceImageUri}
                                allowClear
                            />
                            <Button type="secondary" onClick={handleAddReferenceImageUri}>Add URI</Button>
                        </div>
                    </div>

                    {/* Asset ID input */}
                    <div style={{ marginTop: 8 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <Input
                                placeholder="Paste image Asset ID"
                                value={referenceImageAssetId}
                                onChange={setReferenceImageAssetId}
                                onPressEnter={handleAddReferenceImageAssetId}
                                allowClear
                            />
                            <Button type="secondary" onClick={handleAddReferenceImageAssetId}>Add Asset ID</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Reference Videos */}
            {!isFieldHidden('reference_video_refs') && (
                <div style={{ position: 'relative', marginTop: 8 }}>
                    <div className={styles.uploadLabel} style={{ marginBottom: 4 }}>Ref Video</div>
                    <div style={{ fontSize: 12, color: '#86909c', lineHeight: 1.4, marginBottom: 8 }}>
                        Upload a local video, paste a public URL, or add an Asset ID. The order here maps directly to <code>[Video 1]</code>, <code>[Video 2]</code>, … in your prompt. Seedance supports up to 3 reference videos.
                    </div>

                    {/* Ordered reference list */}
                    {currentVideoRefs.length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                            {currentVideoRefs.map((ref, index) => (
                                <div
                                    key={index}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, padding: '4px 8px', background: '#f2f3f5', borderRadius: 6 }}
                                >
                                    <span style={{ fontSize: 11, fontWeight: 700, color: '#165dff', whiteSpace: 'nowrap', minWidth: 60 }}>
                                        [Video {index + 1}]
                                    </span>
                                    <span style={{ fontSize: 11, color: '#86909c', flexShrink: 0 }}>
                                        {ref.type === 'asset' ? '🏷' : '🎬'}
                                    </span>
                                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#4e5969', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {ref.name || (ref.type === 'url' && ref.value.startsWith('data:') ? 'local file' : ref.value)}
                                    </span>
                                    <Button size="mini" type="text" onClick={() => removeReferenceVideoRef(index)} style={{ padding: '0 4px', flexShrink: 0 }}>×</Button>
                                </div>
                            ))}
                        </div>
                    )}

                    {currentVideoRefs.length < 3 && (
                        <>
                            {/* Local file upload */}
                            <Upload
                                accept="video/*"
                                fileList={[]}
                                showUploadList={false}
                                beforeUpload={(file) => {
                                    if (currentVideoRefs.length >= 3) {
                                        Message.warning('Seedance supports up to 3 reference videos');
                                        return false;
                                    }
                                    const reader = new FileReader();
                                    reader.onload = () => {
                                        setFormValues(prev => ({
                                            ...prev,
                                            reference_video_refs: [
                                                ...(prev.reference_video_refs || []),
                                                { type: 'url', value: reader.result, name: file.name },
                                            ],
                                        }));
                                    };
                                    reader.readAsDataURL(file);
                                    return false;
                                }}
                            />

                            {/* Public URI input */}
                            <div style={{ marginTop: 12 }}>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <Input
                                        placeholder="Public video URI (https://...)"
                                        value={referenceVideoUri}
                                        onChange={setReferenceVideoUri}
                                        onPressEnter={handleAddReferenceVideoUri}
                                        allowClear
                                    />
                                    <Button type="secondary" onClick={handleAddReferenceVideoUri}>Add URI</Button>
                                </div>
                            </div>

                            {/* Asset ID input */}
                            <div style={{ marginTop: 8 }}>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <Input
                                        placeholder="Paste video Asset ID"
                                        value={referenceVideoAssetId}
                                        onChange={setReferenceVideoAssetId}
                                        onPressEnter={handleAddReferenceVideoAssetId}
                                        allowClear
                                    />
                                    <Button type="secondary" onClick={handleAddReferenceVideoAssetId}>Add Asset ID</Button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Reference Audios */}
            {!isFieldHidden('reference_audios') && (
                <div style={{ position: 'relative', marginTop: 8 }}>
                    <div className={styles.uploadLabel} style={{ marginBottom: 4 }}>Ref Audio</div>
                    <div style={{ fontSize: 12, color: '#86909c', lineHeight: 1.4, marginBottom: 8 }}>
                        Upload a local audio file or paste a public audio URL. Local uploads are staged to TOS automatically before the Seedance request.
                    </div>
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
                        onRemove={(file) => {
                           const index = parseInt(file.uid.split('-')[1], 10);
                           removeImage('reference_audios', index);
                        }}
                    />
                    <div style={{ marginTop: 12 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <Input
                                placeholder="Paste public audio URI (https://...)"
                                value={referenceAudioUri}
                                onChange={setReferenceAudioUri}
                                onPressEnter={handleAddReferenceAudioUri}
                                allowClear
                            />
                            <Button type="secondary" onClick={handleAddReferenceAudioUri}>
                                Add URI
                            </Button>
                        </div>
                        <div style={{ fontSize: 12, color: '#86909c', lineHeight: 1.4, marginTop: 6 }}>
                            Add a public web URL for the reference audio.
                        </div>
                    </div>
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
                    {(getFieldOptions('duration') || [2,3,4,5,6,7,8,9,10,11,12]).map(opt => <Select.Option key={opt} value={opt}>{typeof opt === 'number' ? `${opt}s` : 'Auto'}</Select.Option>)}
                </Select>
            </div>
          )}

          <div className={styles.toolChip}>
              <span style={{ marginRight: 8 }}>Runs</span>
              <Select
                  value={parallelCount}
                  onChange={(val) => handleInputChange('parallelCount', Number(val))}
                  style={{ width: 88 }}
                  size="small"
              >
                  {[1, 5, 11, 15].map((opt) => (
                      <Select.Option key={opt} value={opt}>{opt}x</Select.Option>
                  ))}
              </Select>
          </div>
          
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
            {loading ? `Generating ${parallelCount}x...` : parallelCount > 1 ? `Generate ${parallelCount}x ➔` : 'Generate ➔'}
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
