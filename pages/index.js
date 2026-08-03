import Head from 'next/head';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, Button, Drawer, Input, Message, Card, Typography } from '@arco-design/web-react';
import { IconImage, IconVideoCamera, IconRobot, IconPlus, IconUser, IconSound, IconApps } from '@arco-design/web-react/icon';
import { baseSchemas } from '../utils/schemas';
import { applyDeployModels } from '../utils/film/suiteConfig';
import { constructWorkflowSeedreamPayload, constructSeedancePayload, constructLLMPayload, constructAssetUploadPayload, updateUiSchemaVisibility } from '../utils/apiHelpers';
import { getModelCapabilities } from '../utils/modelCapabilities';
import { clearPersistedApiKey, getApiKey, setApiKey as setApiKeyInStore, isBundledDesktopApp } from '../utils/apiKeyStore';
import SeedancePlayground from '../components/SeedancePlayground';
import SeedreamPlayground from '../components/SeedreamPlayground';
import LLMPlayground from '../components/LLMPlayground';
import FilmAgentPlayground from '../components/film/FilmAgentPlayground';
import AssetUploadPlayground from '../components/AssetUploadPlayground';
import SpeechPlayground from '../components/SpeechPlayground';
import ResultViewer from '../components/ResultViewer';
import CopyButton from '../components/CopyButton';

const { Content } = Layout;
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
const TOOL_TABS = ['seedream', 'seedance', 'asset-upload', 'llm', 'speech'];

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [activeModelId, setActiveModelId] = useState('film-agent');
  const [lastToolId, setLastToolId] = useState('seedream');
  // Server-key mode: a deployment-configured API key exists — every tab works with no
  // key entered, and the Settings key field is replaced by an informational note (no
  // key UI at all on customer deployments). Detected once via the non-secret config route.
  const [hasServerKey, setHasServerKey] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/film/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        // Model ids are env-only (no built-in defaults) and reach the browser HERE —
        // hydrate the registry, then back-fill any tab whose model is still unset
        // (its initial form state was built before the ids existed).
        applyDeployModels(j.models || null);
        setHasServerKey(!!j.hasServerKey);
        setFormStateByModel((prev) => {
          const next = { ...prev };
          Object.keys(next).forEach((k) => {
            const d = getSchemaDefaults(k);
            if (d.model && !next[k]?.model) next[k] = { ...next[k], model: d.model };
          });
          return next;
        });
      })
      .catch(() => { /* open starter-kit mode */ });
    return () => { cancelled = true; };
  }, []);

  const baseSchema = baseSchemas[activeModelId] || {}; // film-agent has no form schema
  // uiSchema is now static/default matching baseSchema
  const [uiSchema, setUiSchema] = useState({
    title: baseSchema.name || '',
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

  // A Seedream batch card settling its slot. Writes to the 'seedream' key EXPLICITLY —
  // never activeModelId — because results routinely land while the user is on another
  // tab; the slot object is what makes finished plates survive tab switches (and stops
  // a remounted card from re-fetching = re-billing the image).
  const patchSeedreamItem = useCallback((requestIndex, patch) => {
    setResultStateByModel((prev) => {
      const cur = prev.seedream;
      if (!cur?.batch || !Array.isArray(cur.items)) return prev;
      return {
        ...prev,
        seedream: {
          ...cur,
          items: cur.items.map((it, i) => ((it.requestIndex || i + 1) === requestIndex ? { ...it, ...patch } : it)),
        },
      };
    });
  }, []);


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
  
  // Remember the most recently used tool so the "Tools" meta tab returns to it.
  useEffect(() => {
    if (TOOL_TABS.includes(activeModelId)) setLastToolId(activeModelId);
  }, [activeModelId]);

  const canRun = useMemo(() => apiKey.trim().length > 0 || hasServerKey, [apiKey, hasServerKey]);

  useEffect(() => {
    // Reactive visibility logic
    setUiSchema((prev) => updateUiSchemaVisibility(prev, formValues, activeModelId));
  }, [formValues.size, formValues.sequential_image_generation, formValues.model, formValues.generate_audio, activeModelId]);

  const handleModelFamilyChange = (newFamily) => {
      setActiveModelId(newFamily);
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
          const caps = getModelCapabilities(newModelId);
          const resOk = !caps.resolutions || caps.resolutions.includes(prev.resolution);
          return {
            reference_image_refs: caps.supports_ref_images ? prev.reference_image_refs : [],
            reference_video_refs: caps.supports_ref_videos ? prev.reference_video_refs : [],
            reference_audios: caps.supports_ref_audios ? prev.reference_audios : [],
            generate_audio: caps.supports_audio ? prev.generate_audio : false,
            // Mini caps at 720p — drop an out-of-range resolution so we never send one the endpoint rejects.
            resolution: resOk ? prev.resolution : (caps.resolutions.includes('720p') ? '720p' : caps.resolutions[0]),
          };
        })() : {}),
        ...(activeModelId === 'seedream' ? (() => {
          const caps = getModelCapabilities(newModelId);
          const sizes = (caps.sizes || []).filter((s) => s !== 'Custom');
          const cap = caps.max_ref_images;
          return {
            // Pro has no 4K (2048² area cap) — snap an out-of-range size to a valid one.
            size: (!sizes.length || sizes.includes(prev.size)) ? prev.size : (sizes.includes('2K') ? '2K' : sizes[0]),
            // Trim references beyond the new model's cap (Lite 6 / Pro 10).
            image: cap && (prev.image || []).length > cap ? prev.image.slice(0, cap) : prev.image,
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
          parallelCount = Math.min(Math.max(Number(formValues.parallelCount) || 1, 1), 20);
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
      if (activeModelId === 'seedream') {
        // Each plate fetches its own image — the image analog of Seedance's per-card polling.
        // Hand the cards the request so they render immediately with a spinner and stream in
        // independently, instead of awaiting all N here. The cards attach the API key themselves.
        nextResult = {
          batch: true,
          parallelCount,
          request: requestBody,
          items: Array.from({ length: parallelCount }, (_, index) => ({ requestIndex: index + 1 })),
        };
      } else if (activeModelId === 'seedance' && parallelCount > 1) {
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

  // The full-canvas Film Agent gets a compact header so the canvas gets the
  // vertical space instead of a big title + description.
  const isCanvasTool = activeModelId === 'film-agent';

  return (
    <>
      <Head>
        <title>ModelArk Starter Kit</title>
      </Head>
      <Layout className="layout-container" style={{ height: '100vh' }}>
        {/* The left icon rail is GONE — the top Film Agent | Tools tabs already cover
            navigation; Settings moved to the top-right corner. */}
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
                                        </Button.Group>
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </header>

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
                        onChangeApiKey={setApiKey}
                        onSaveApiKey={handleSaveApiKey}
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
                          onItemPatch={patchSeedreamItem}
                        />
                      )}
                </div>
                
                {TOOL_TABS.includes(activeModelId) && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, fontSize: 12, color: '#86909c', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={showRequestOutput}
                            onChange={(event) => setShowRequestOutput(event.target.checked)}
                        />
                        <span>Show request/response debug output</span>
                    </label>
                )}
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


      </Layout>
    </>
  );
}
