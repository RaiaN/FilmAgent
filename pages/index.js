import Head from 'next/head';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, Menu, Button, Drawer, Input, Message, Card, Typography, Upload } from '@arco-design/web-react';
import { IconImage, IconVideoCamera, IconSettings, IconRobot, IconPlus, IconClose, IconMindMapping, IconUser, IconSound, IconApps } from '@arco-design/web-react/icon';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { baseSchemas } from '../utils/schemas';
import { constructWorkflowSeedreamPayload, constructSeedancePayload, constructLLMPayload, constructAssetUploadPayload, updateUiSchemaVisibility } from '../utils/apiHelpers';
import { MODEL_CAPABILITIES } from '../utils/modelCapabilities';
import { clearPersistedApiKey, getApiKey, setApiKey as setApiKeyInStore, isBundledDesktopApp } from '../utils/apiKeyStore';
import SeedancePlayground from '../components/SeedancePlayground';
import SeedreamPlayground from '../components/SeedreamPlayground';
import LLMPlayground from '../components/LLMPlayground';
import FilmAgentPlayground from '../components/film/FilmAgentPlayground';
import AssetUploadPlayground from '../components/AssetUploadPlayground';
import SpeechPlayground from '../components/SpeechPlayground';
import WorkflowEditor from '../components/workflow/WorkflowEditor';
import ResultViewer from '../components/ResultViewer';
import CopyButton from '../components/CopyButton';

// Custom BytePlus Icon
const IconBytePlus = ({ style }) => (
  <svg 
    width="1em" 
    height="1em" 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    style={style}
  >
    <path d="M5.5 8V16" stroke="#165dff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9.5 11V16" stroke="#4080ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13.5 11V16" stroke="#00d0b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M17.5 8V16" stroke="#86dfd6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const { Sider, Content } = Layout;
const { Title } = Typography;

const getSchemaDefaults = (modelId) => ({ ...(baseSchemas[modelId]?.defaults || {}) });

const buildInitialFormState = () =>
  Object.keys(baseSchemas).reduce((acc, key) => {
    acc[key] = getSchemaDefaults(key);
    return acc;
  }, {});

const buildInitialResultState = () =>
  Object.keys(baseSchemas).reduce((acc, key) => {
    acc[key] = null;
    return acc;
  }, {});

// Raw model playgrounds grouped under the "Tools" meta tab.
const TOOL_TABS = ['seedream', 'seedance', 'asset-upload', 'llm', 'speech', 'workflow'];

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [activeModelId, setActiveModelId] = useState('film-agent');
  const [lastToolId, setLastToolId] = useState('seedream');
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatImage, setChatImage] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);

  const baseSchema = baseSchemas[activeModelId] || {}; // Fallback for workflow
  // uiSchema is now static/default matching baseSchema
  const [uiSchema, setUiSchema] = useState({
    title: baseSchema.name || 'Workflow',
    description: baseSchema.description || '',
    fields: baseSchema.fields || [],
    defaults: baseSchema.defaults || {},
  });
  const [formStateByModel, setFormStateByModel] = useState(() => buildInitialFormState());
  const formValues = formStateByModel[activeModelId] || getSchemaDefaults(activeModelId);
  const setFormValues = useCallback((updater) => {
    setFormStateByModel((prev) => {
      const currentValues = prev[activeModelId] || getSchemaDefaults(activeModelId);
      const nextValues = typeof updater === 'function' ? updater(currentValues) : updater;
      return {
        ...prev,
        [activeModelId]: nextValues,
      };
    });
  }, [activeModelId]);
  
  const [showRequestOutput, setShowRequestOutput] = useState(false);
  const [lastRequestPayload, setLastRequestPayload] = useState(null);
  const [lastResponsePayload, setLastResponsePayload] = useState(null);

  const [seedreamLoading, setSeedreamLoading] = useState(false);
  const [assetTosStagingLoading, setAssetTosStagingLoading] = useState(false);
  const [resultStateByModel, setResultStateByModel] = useState(() => buildInitialResultState());
  const seedreamResult = resultStateByModel[activeModelId] || null;
  const setSeedreamResult = useCallback((updater) => {
    setResultStateByModel((prev) => {
      const currentValue = prev[activeModelId] || null;
      const nextValue = typeof updater === 'function' ? updater(currentValue) : updater;
      return {
        ...prev,
        [activeModelId]: nextValue,
      };
    });
  }, [activeModelId]);
  const [modelCapabilities] = useState({}); // Store model metadata

  const chatEndRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isBundledDesktopApp()) {
      clearPersistedApiKey();
      return;
    }
    const savedKey = getApiKey();
    if (savedKey) {
        setApiKey(savedKey);
    }
  }, []);
  
  useEffect(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // Remember the most recently used tool so the "Tools" meta tab returns to it.
  useEffect(() => {
    if (TOOL_TABS.includes(activeModelId)) setLastToolId(activeModelId);
  }, [activeModelId]);

  const canRun = useMemo(() => apiKey.trim().length > 0, [apiKey]);

  useEffect(() => {
    if (activeModelId === 'workflow') return;
    // Reactive visibility logic
    setUiSchema((prev) => updateUiSchemaVisibility(prev, formValues, activeModelId));
  }, [formValues.size, formValues.sequential_image_generation, formValues.model, formValues.generate_audio, activeModelId]);

  const handleModelFamilyChange = (newFamily) => {
      setActiveModelId(newFamily);
      if (newFamily === 'workflow') {
          setUiSchema({ title: 'Workflow Editor', description: 'Visual pipeline for complex generation tasks' });
          return;
      }

      const newBaseSchema = baseSchemas[newFamily];
      setUiSchema({
        title: newBaseSchema.name,
        description: newBaseSchema.description,
        fields: newBaseSchema.fields,
        defaults: newBaseSchema.defaults,
      });
  };

  const handleModelChange = (e) => {
    const newModelId = e.target.value;
    setFormValues((prev) => ({
        ...prev,
        model: newModelId,
        ...(activeModelId === 'seedance' ? (() => {
          const caps = MODEL_CAPABILITIES[newModelId] || MODEL_CAPABILITIES.default;
          return {
            reference_image_refs: caps.supports_ref_images ? prev.reference_image_refs : [],
            reference_video_refs: caps.supports_ref_videos ? prev.reference_video_refs : [],
            reference_audios: caps.supports_ref_audios ? prev.reference_audios : [],
            generate_audio: caps.supports_audio ? prev.generate_audio : false,
          };
        })() : {}),
    }));
  };

  const handleSaveApiKey = () => {
    if (!apiKey.trim()) {
      Message.error('Please enter an API key');
      return;
    }
    const result = setApiKeyInStore(apiKey);
    if (result.bundled) {
      Message.success('API key set for this session');
    } else {
      Message.success('API key saved');
    }
  };

  const handleStageAssetImageToTos = async () => {
    if (activeModelId !== 'asset-upload') return;
    const isVideo = (formValues.assetType || 'Image') === 'Video';

    if (isVideo && !formValues.localVideoData) {
      Message.warning('Choose a local video first.');
      return;
    }
    if (!isVideo && !formValues.localImageData) {
      Message.warning('Choose a local image first.');
      return;
    }

    setAssetTosStagingLoading(true);
    try {
      const requestBody = isVideo
        ? { localVideoData: formValues.localVideoData, localVideoName: formValues.localVideoName || '', stageOnly: true }
        : { localImageData: formValues.localImageData, localImageName: formValues.localImageName || '', stageOnly: true };

      const response = await fetch('/api/asset-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await response.json();

      if (!response.ok || data?.error) {
        throw new Error(data?.details || data?.error || 'TOS upload failed');
      }

      setFormValues((prev) => ({
        ...prev,
        [isVideo ? 'videoUrl' : 'imageUrl']: data.imageUrl || (isVideo ? prev.videoUrl : prev.imageUrl) || '',
      }));
      Message.success(`Uploaded to TOS and filled the ${isVideo ? 'Video' : 'Image'} URL field.`);

      if (showRequestOutput) {
        setLastRequestPayload({
          endpoint: '/api/asset-upload',
          body: requestBody,
        });
        setLastResponsePayload(data);
      }
    } catch (error) {
      Message.error(error.message || 'TOS upload failed');
    } finally {
      setAssetTosStagingLoading(false);
    }
  };

  const handleChatSubmit = async (e) => {
    e?.preventDefault();
    if ((!chatInput.trim() && !chatImage) || !canRun) return;

    const userMessage = { role: 'user', content: chatInput, image: chatImage };
    setChatHistory((prev) => [...prev, userMessage]);
    setChatInput('');
    setChatImage(null);
    setChatLoading(true);

    try {
      const systemPrompt = `You are a helpful assistant for the ModelArk API. 
      You have knowledge of the following API schema: ${JSON.stringify(baseSchema, null, 2)}.
      
      RECOMMENDATION POLICY:
      - For IMAGE generation (Seedream), use and recommend only 'seedream-5-0-260128'. Do NOT recommend removed or legacy Seedream variants.
      - For VIDEO generation (Seedance), recommend 'seedance-1-5-pro-251215' as the latest and most capable model.
      - NOTE: 'seed-2-0-mini-260428' is the model powering YOU (the assistant) for text/image analysis, NOT for generating images.
      - Do NOT recommend random or older model versions unless specifically asked.
      
      Answer user questions about the API capabilities, parameters, and usage.`;

      const response = await fetch('/api/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: chatInput || "Analyze this image",
          apiKey: apiKey.trim(),
          systemPrompt,
          images: userMessage.image ? [userMessage.image] : [],
        }),
      });
      const data = await response.json();
      if (data.content) {
        setChatHistory((prev) => [...prev, { role: 'assistant', content: data.content }]);
      }
    } catch (error) {
      setChatHistory((prev) => [...prev, { role: 'assistant', content: 'Error: ' + error.message }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleImageUpload = async (e, fieldKey) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const promises = files.map((file) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    });

    try {
      const base64s = await Promise.all(promises);
      setFormValues((prev) => {
        const currentImages = prev[fieldKey] || [];
        return { ...prev, [fieldKey]: [...currentImages, ...base64s] };
      });
    } catch (error) {
      console.error('Image upload failed', error);
    }
  };

  const removeImage = (fieldKey, index) => {
    setFormValues((prev) => {
      const currentImages = prev[fieldKey] || [];
      return { ...prev, [fieldKey]: currentImages.filter((_, i) => i !== index) };
    });
  };

  const handleSeedreamSubmit = async (event) => {
    event.preventDefault();
    if (activeModelId !== 'asset-upload' && activeModelId !== 'speech' && !canRun) {
      setSeedreamResult({ error: 'Please add your API key first.' });
      setIsSettingsOpen(true);
      return;
    }
    setSeedreamLoading(true);
    setSeedreamResult(null);
    
    try {
      let endpoint = '/api/seedream';
      let requestBody;
      let parallelCount = 1;

      if (activeModelId === 'seedream') {
          parallelCount = Math.min(Math.max(Number(formValues.parallelCount) || 5, 1), 5);
          requestBody = constructWorkflowSeedreamPayload(formValues);
      } else if (activeModelId === 'seedance') {
          endpoint = '/api/seedance';
          requestBody = constructSeedancePayload(formValues);
          parallelCount = Math.min(Math.max(Number(formValues.parallelCount) || 1, 1), 15);
      } else if (activeModelId === 'asset-upload') {
          endpoint = '/api/asset-upload';
          requestBody = constructAssetUploadPayload(formValues);
      } else if (activeModelId === 'llm') {
          endpoint = '/api/seed';
          const llmPayload = constructLLMPayload(formValues);
          requestBody = {
            prompt: llmPayload.prompt,
            modelId: llmPayload.model,
            images: llmPayload.images,
            video: llmPayload.video,
            systemPrompt: `You are an expert AI media analyst for the ModelArk platform. 
            Your goal is to analyze the provided image or video and answer the user's prompt.
            
            GUIDELINES:
            1. Be concise, accurate, and helpful.
            2. If the user asks for generation advice, recommend prompts compatible with 'Seedream' (Image Gen) or 'Seedance' (Video Gen).
            3. Do NOT recommend complex workflows, external tools, or features not available in a standard text-to-media generation interface (e.g. do not suggest manual masking, 3D modeling, or post-processing software).`
          };
      } else if (activeModelId === 'speech') {
          endpoint = '/api/speech';
          requestBody = {
            speaker: formValues.speaker || '',
            text: formValues.text || '',
            format: formValues.format || 'mp3',
            sampleRate: formValues.sampleRate || 24000,
            speechRate: formValues.speechRate ?? 0,
            loudnessRate: formValues.loudnessRate ?? 0,
            contextText: formValues.contextText || '',
          };
      } else {
          requestBody = constructWorkflowSeedreamPayload(formValues);
      }

      const requestPayload = (activeModelId === 'asset-upload' || activeModelId === 'speech')
        ? requestBody
        : { ...requestBody, apiKey: apiKey.trim() };

      const executeRequest = async (requestIndex) => {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload),
          });
          const data = await response.json();
          return {
            ok: response.ok,
            data,
            requestIndex,
          };
        } catch (error) {
          return {
            ok: false,
            data: {
              error: 'Request failed',
              details: error.message,
            },
            requestIndex,
          };
        }
      };

      let nextResult;
      if ((activeModelId === 'seedance' || activeModelId === 'seedream') && parallelCount > 1) {
        const batchResponses = await Promise.all(
          Array.from({ length: parallelCount }, (_, index) => executeRequest(index + 1))
        );
        nextResult = {
          batch: true,
          parallelCount,
          items: batchResponses.map(({ ok, data, requestIndex }) => ({
            ...(ok ? data : { error: data?.error || 'Request failed', details: data?.details }),
            requestIndex,
          })),
        };
      } else {
        const { data } = await executeRequest(1);
        nextResult = data;
      }

      setSeedreamResult(nextResult);
      if (showRequestOutput) {
        const debugBody = { ...requestBody, apiKey: 'REDACTED' };
        setLastRequestPayload({
          endpoint,
          body: (activeModelId === 'seedance' || activeModelId === 'seedream') && parallelCount > 1
            ? { parallelCount, request: debugBody }
            : debugBody,
        });
        setLastResponsePayload(nextResult);
      }
    } catch (error) {
      setSeedreamResult({ error: 'Request failed', details: error.message });
    } finally {
      setSeedreamLoading(false);
    }
  };

  // Full-canvas tools (Film Agent, Workflow) get a compact header so the canvas
  // gets the vertical space instead of a big title + description.
  const isCanvasTool = activeModelId === 'film-agent' || activeModelId === 'workflow';

  return (
    <>
      <Head>
        <title>ModelArk Starter Kit</title>
      </Head>
      <Layout className="layout-container" style={{ height: '100vh' }}>
        <Sider collapsed={true} style={{ width: 60 }}>
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 20 }}>
                <Menu
                    style={{ width: '100%' }}
                    selectedKeys={[activeModelId]}
                    onClickMenuItem={(key) => {
                        if (key === 'settings') setIsSettingsOpen(true);
                        else if (key === 'assistant') setIsAssistantOpen(true);
                        else handleModelFamilyChange(key);
                    }}
                >
                    <Menu.Item key="seedream">
                        <IconImage style={{ fontSize: 20 }} />
                    </Menu.Item>
                    <Menu.Item key="seedance">
                        <IconVideoCamera style={{ fontSize: 20 }} />
                    </Menu.Item>
                    <Menu.Item key="film-agent">
                        <IconUser style={{ fontSize: 20 }} />
                    </Menu.Item>
                    <Menu.Item key="asset-upload">
                        <IconPlus style={{ fontSize: 20 }} />
                    </Menu.Item>
                    <Menu.Item key="llm">
                        <IconRobot style={{ fontSize: 20 }} />
                    </Menu.Item>
                    <Menu.Item key="speech">
                        <IconSound style={{ fontSize: 20 }} />
                    </Menu.Item>
                    {/* Settings Tab - explicitly added back */}
                    <Menu.Item key="settings">
                        <IconSettings style={{ fontSize: 20 }} />
                    </Menu.Item>
                    {/* Assistant - explicitly added back */}
                    <Menu.Item key="assistant">
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                            <IconBytePlus style={{ fontSize: 24 }} />
                            <div style={{
                                position: 'absolute',
                                bottom: -2,
                                right: -4,
                                width: 14,
                                height: 14,
                                borderRadius: '50%',
                                background: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '1px solid #ff7d00'
                            }}>
                                <span style={{ fontSize: 10, fontWeight: 'bold', color: '#ff7d00', lineHeight: 1 }}>?</span>
                            </div>
                        </div>
                    </Menu.Item>
                </Menu>
                {/* Removed duplicate settings button at bottom */}
                <div style={{ marginTop: 'auto', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
                </div>
            </div>
        </Sider>
        
        <Content style={{ padding: isCanvasTool ? '8px 16px 14px' : '12px 24px 16px', background: '#f6f7f9', overflowY: 'auto' }}>
            <div style={{ maxWidth: isCanvasTool ? '98%' : 1000, margin: '0 auto', position: 'relative' }}>

                <header style={{ marginBottom: isCanvasTool ? 8 : 10, textAlign: 'center' }}>
                    {!isCanvasTool && (
                        <Title heading={6} style={{ margin: '0 0 6px' }}>{uiSchema.title}</Title>
                    )}

                    {(() => {
                        const isToolActive = TOOL_TABS.includes(activeModelId);
                        const selectTool = (id) => { setLastToolId(id); handleModelFamilyChange(id); };
                        return (
                            <div style={{ marginTop: 0 }}>
                                {/* Level 1: primary experience vs. the Tools meta tab */}
                                <Button.Group size="small">
                                    <Button
                                        type={activeModelId === 'film-agent' ? 'primary' : 'secondary'}
                                        onClick={() => handleModelFamilyChange('film-agent')}
                                    >
                                        <IconUser style={{ marginRight: 8 }} />
                                        Film Agent
                                    </Button>
                                    <Button
                                        type={isToolActive ? 'primary' : 'secondary'}
                                        onClick={() => selectTool(lastToolId)}
                                    >
                                        <IconApps style={{ marginRight: 8 }} />
                                        Tools
                                    </Button>
                                </Button.Group>

                                {/* Level 2: the raw model playgrounds, shown only under Tools */}
                                {isToolActive && (
                                    <div style={{ marginTop: 8 }}>
                                        <Button.Group size="small">
                                            <Button type={activeModelId === 'seedream' ? 'primary' : 'secondary'} onClick={() => selectTool('seedream')}>
                                                <IconImage style={{ marginRight: 8 }} />
                                                Image (Seedream)
                                            </Button>
                                            <Button type={activeModelId === 'seedance' ? 'primary' : 'secondary'} onClick={() => selectTool('seedance')}>
                                                <IconVideoCamera style={{ marginRight: 8 }} />
                                                Video (Seedance)
                                            </Button>
                                            <Button type={activeModelId === 'asset-upload' ? 'primary' : 'secondary'} onClick={() => selectTool('asset-upload')}>
                                                <IconPlus style={{ marginRight: 8 }} />
                                                Asset Upload
                                            </Button>
                                            <Button type={activeModelId === 'llm' ? 'primary' : 'secondary'} onClick={() => selectTool('llm')}>
                                                <IconRobot style={{ marginRight: 8 }} />
                                                AI Analysis
                                            </Button>
                                            <Button type={activeModelId === 'speech' ? 'primary' : 'secondary'} onClick={() => selectTool('speech')}>
                                                <IconSound style={{ marginRight: 8 }} />
                                                Speech (Seed TTS)
                                            </Button>
                                            <Button type={activeModelId === 'workflow' ? 'primary' : 'secondary'} onClick={() => selectTool('workflow')}>
                                                <IconMindMapping style={{ marginRight: 8 }} />
                                                Workflow (Beta)
                                            </Button>
                                        </Button.Group>
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </header>

                <div style={{ display: activeModelId === 'workflow' ? 'block' : 'none', height: '75vh', border: '1px solid #e5e6eb', borderRadius: 8 }}>
                    <WorkflowEditor active={activeModelId === 'workflow'} />
                </div>
                <div style={{ display: activeModelId === 'seedream' ? 'block' : 'none' }}>
                    <SeedreamPlayground
                        schema={uiSchema}
                        formValues={formValues}
                        setFormValues={setFormValues}
                        onSubmit={handleSeedreamSubmit}
                        loading={seedreamLoading}
                        handleImageUpload={handleImageUpload}
                        removeImage={removeImage}
                        onModelChange={handleModelChange}
                        result={seedreamResult}
                    />
                </div>
                <div style={{ display: activeModelId === 'seedance' ? 'block' : 'none' }}>
                    <SeedancePlayground
                        schema={uiSchema}
                        formValues={formValues}
                        setFormValues={setFormValues}
                        onSubmit={handleSeedreamSubmit}
                        loading={seedreamLoading}
                        handleImageUpload={handleImageUpload}
                        removeImage={removeImage}
                        onModelChange={handleModelChange}
                        result={seedreamResult}
                    />
                </div>
                <div style={{ display: activeModelId === 'film-agent' ? 'block' : 'none' }}>
                    <FilmAgentPlayground
                        formValues={formValues}
                        setFormValues={setFormValues}
                        apiKey={apiKey}
                    />
                </div>
                <div style={{ display: activeModelId === 'asset-upload' ? 'block' : 'none' }}>
                    <AssetUploadPlayground
                        schema={uiSchema}
                        formValues={formValues}
                        setFormValues={setFormValues}
                        onSubmit={handleSeedreamSubmit}
                        loading={seedreamLoading}
                        onStageToTos={handleStageAssetImageToTos}
                        stagingLoading={assetTosStagingLoading}
                        result={seedreamResult}
                    />
                </div>
                <div style={{ display: activeModelId === 'llm' ? 'block' : 'none' }}>
                    <LLMPlayground
                        schema={uiSchema}
                        formValues={formValues}
                        setFormValues={setFormValues}
                        onSubmit={handleSeedreamSubmit}
                        loading={seedreamLoading}
                        handleImageUpload={handleImageUpload}
                        removeImage={removeImage}
                        onModelChange={handleModelChange}
                        result={seedreamResult}
                        capabilities={modelCapabilities[formValues.model]}
                    />
                </div>
                <div style={{ display: activeModelId === 'speech' ? 'block' : 'none' }}>
                    <SpeechPlayground
                        formValues={formValues}
                        setFormValues={setFormValues}
                        onSubmit={handleSeedreamSubmit}
                        loading={seedreamLoading}
                        result={seedreamResult}
                    />
                </div>

                <div style={{ marginTop: 24 }}>
                     {activeModelId !== 'llm' && activeModelId !== 'speech' && activeModelId !== 'film-agent' && (
                        <ResultViewer
                          result={seedreamResult}
                          modelType={activeModelId}
                        />
                      )}
                </div>
                
                {showRequestOutput && (lastRequestPayload || lastResponsePayload) && (
                    <Card style={{ marginTop: 24 }} title="Debug Output">
                    {lastRequestPayload && (
                        <div className="result">
                            <div className="result-header">
                                <strong>Request</strong>
                                <CopyButton text={JSON.stringify(lastRequestPayload, null, 2)} />
                            </div>
                            <pre style={{ fontSize: 12, overflow: 'auto', maxHeight: 200 }}>{JSON.stringify(lastRequestPayload, null, 2)}</pre>
                        </div>
                    )}
                    {lastResponsePayload && (
                        <div className="result">
                            <div className="result-header">
                                <strong>Response</strong>
                                <CopyButton text={JSON.stringify(lastResponsePayload, null, 2)} />
                            </div>
                            <pre style={{ fontSize: 12, overflow: 'auto', maxHeight: 200 }}>{JSON.stringify(lastResponsePayload, null, 2)}</pre>
                        </div>
                    )}
                    </Card>
                )}
            </div>
        </Content>

        <Drawer
            title="Settings"
            visible={isSettingsOpen}
            onOk={() => setIsSettingsOpen(false)}
            onCancel={() => setIsSettingsOpen(false)}
            width={400}
            footer={null}
        >
             <div className="field" style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8 }}>API Key</label>
                <Input.Password
                    value={apiKey}
                    onChange={(val) => setApiKey(val)}
                    placeholder="Paste key..."
                    style={{ marginBottom: 10 }}
                />
                <Button type="primary" onClick={handleSaveApiKey}>Save</Button>
            </div>
            <div className="toggle-row">
                 <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                        type="checkbox"
                        checked={showRequestOutput}
                        onChange={(event) => setShowRequestOutput(event.target.checked)}
                    />
                    <span>Show request output</span>
                </label>
            </div>
        </Drawer>

        <Drawer
            title="AI Assistant"
            visible={isAssistantOpen}
            onOk={() => setIsAssistantOpen(false)}
            onCancel={() => setIsAssistantOpen(false)}
            width={400}
            footer={null}
        >
             <div className="chat-container" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
                <div className="chat-history" style={{ flex: 1, overflowY: 'auto', marginBottom: 16 }}>
                    {chatHistory.map((msg, index) => (
                    <div
                        key={index}
                        style={{ 
                            marginBottom: 12, 
                            padding: 12, 
                            borderRadius: 8, 
                            background: msg.role === 'user' ? '#e6f7ff' : '#f6f7f9',
                            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                            maxWidth: '85%'
                        }}
                    >
                        <strong>{msg.role === 'user' ? 'You' : 'AI'}:</strong> 
                        {msg.image && (
                            <div style={{ margin: '8px 0' }}>
                                <img src={msg.image} alt="Uploaded" style={{ maxWidth: '100%', borderRadius: 4, maxHeight: 200 }} />
                            </div>
                        )}
                        <div style={{ whiteSpace: msg.role === 'user' ? 'pre-wrap' : 'normal' }}>
                            {msg.role === 'user' ? (
                                msg.content
                            ) : (
                                <ReactMarkdown 
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                        code({node, inline, className, children, ...props}) {
                                            const match = /language-(\w+)/.exec(className || '')
                                            return !inline && match ? (
                                                <div style={{ background: '#f8f9fa', padding: '12px', borderRadius: '8px', overflowX: 'auto', margin: '8px 0' }}>
                                                    <code className={className} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} {...props}>
                                                        {children}
                                                    </code>
                                                </div>
                                            ) : (
                                                <code className={className} style={{ background: '#f2f3f5', padding: '2px 4px', borderRadius: '4px', fontSize: '0.9em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} {...props}>
                                                    {children}
                                                </code>
                                            )
                                        },
                                        p: ({node, ...props}) => <p style={{ margin: '0 0 2px 0' }} {...props} />,
                                        ul: ({node, ...props}) => <ul style={{ paddingLeft: '16px', margin: '0 0 2px 0' }} {...props} />,
                                        ol: ({node, ...props}) => <ol style={{ paddingLeft: '16px', margin: '0 0 2px 0' }} {...props} />,
                                        li: ({node, ...props}) => <li style={{ marginBottom: '0' }} {...props} />,
                                        h1: ({node, ...props}) => <h1 style={{ fontSize: '1.2em', fontWeight: 'bold', margin: '4px 0 2px 0' }} {...props} />,
                                        h2: ({node, ...props}) => <h2 style={{ fontSize: '1.1em', fontWeight: 'bold', margin: '4px 0 2px 0' }} {...props} />,
                                        h3: ({node, ...props}) => <h3 style={{ fontSize: '1em', fontWeight: 'bold', margin: '2px 0 1px 0' }} {...props} />,
                                        a: ({node, ...props}) => <a style={{ color: '#165dff', textDecoration: 'none' }} target="_blank" rel="noopener noreferrer" {...props} />,
                                        blockquote: ({node, ...props}) => <blockquote style={{ borderLeft: '4px solid #dfe2e5', paddingLeft: '12px', color: '#666', margin: '8px 0' }} {...props} />
                                    }}
                                >
                                    {msg.content}
                                </ReactMarkdown>
                            )}
                        </div>
                    </div>
                    ))}
                    <div ref={chatEndRef} />
                </div>
                
                {chatImage && (
                    <div style={{ padding: '0 8px 8px', display: 'flex', alignItems: 'center' }}>
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                            <img src={chatImage} alt="Preview" style={{ height: 60, borderRadius: 4, border: '1px solid #e5e7eb' }} />
                            <Button 
                                icon={<IconClose style={{ fontSize: 12 }} />} 
                                shape="circle" 
                                size="mini" 
                                style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, minWidth: 18 }} 
                                onClick={() => setChatImage(null)}
                            />
                        </div>
                    </div>
                )}

                <div className="chat-input-form" style={{ display: 'flex', gap: 8 }}>
                    <Upload
                        showUploadList={false}
                        accept="image/*"
                        beforeUpload={(file) => {
                            const reader = new FileReader();
                            reader.onload = (e) => setChatImage(e.target.result);
                            reader.readAsDataURL(file);
                            return false;
                        }}
                    >
                        <Button icon={<IconPlus />} />
                    </Upload>
                    <Input
                        value={chatInput}
                        onChange={(val) => setChatInput(val)}
                        placeholder="Ask about API or analyze image..."
                        disabled={chatLoading}
                        onPressEnter={handleChatSubmit}
                    />
                    <Button type="primary" onClick={handleChatSubmit} loading={chatLoading}>Send</Button>
                </div>
            </div>
        </Drawer>
      </Layout>
    </>
  );
}
