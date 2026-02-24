import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Layout, Menu, Button, Drawer, Input, Message, Card, Typography, Tooltip, Upload } from '@arco-design/web-react';
import { IconSettings, IconRobot, IconImage, IconVideoCamera, IconPlus, IconClose } from '@arco-design/web-react/icon';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { baseSchemas, apiKeyStorageKey } from '../utils/schemas';
import { constructSeedreamPayload, constructSeedancePayload, updateUiSchemaVisibility } from '../utils/apiHelpers';
import SeedancePlayground from '../components/SeedancePlayground';
import SeedreamPlayground from '../components/SeedreamPlayground';
import ResultViewer from '../components/ResultViewer';
import CopyButton from '../components/CopyButton';

const { Sider, Content } = Layout;
const { Title, Text } = Typography;

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [activeModelId, setActiveModelId] = useState('seedream');
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatImage, setChatImage] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);

  const baseSchema = baseSchemas[activeModelId];
  // uiSchema is now static/default matching baseSchema
  const [uiSchema, setUiSchema] = useState({
    title: baseSchema.name,
    description: baseSchema.description,
    fields: baseSchema.fields,
    defaults: baseSchema.defaults,
  });
  const [formValues, setFormValues] = useState(baseSchema.defaults);
  
  const [showRequestOutput, setShowRequestOutput] = useState(false);
  const [lastRequestPayload, setLastRequestPayload] = useState(null);
  const [lastResponsePayload, setLastResponsePayload] = useState(null);

  const [seedreamLoading, setSeedreamLoading] = useState(false);
  const [seedreamResult, setSeedreamResult] = useState(null);
  
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedKey = window.localStorage.getItem(apiKeyStorageKey);
    if (savedKey) {
      setApiKey(savedKey);
    }
  }, []);
  
  useEffect(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const canRun = useMemo(() => apiKey.trim().length > 0, [apiKey]);

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
      
      // Reset form values to new family defaults
      setFormValues(newBaseSchema.defaults);
      setSeedreamResult(null);
  };

  const handleModelChange = (e) => {
    const newModelId = e.target.value;
    setFormValues((prev) => ({
        ...prev,
        model: newModelId,
    }));
  };

  const handleSaveApiKey = () => {
    if (!apiKey.trim()) {
      Message.error('Please enter an API key');
      return;
    }
    window.localStorage.setItem(apiKeyStorageKey, apiKey.trim());
    Message.success('API key saved');
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
      - For IMAGE generation (Seedream), recommend 'seedream-5-0-lite' for efficiency, or 'seedream-4-5-251128' as the current high-fidelity flagship (full 5.0 is not yet available).
      - For VIDEO generation (Seedance), recommend 'seedance-1-5-pro-251215' as the latest and most capable model.
      - NOTE: 'seed-2-0-mini-260215' is the model powering YOU (the assistant) for text/image analysis, NOT for generating images.
      - Do NOT recommend random or older model versions unless specifically asked.
      
      Answer user questions about the API capabilities, parameters, and usage.`;

      const response = await fetch('/api/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: chatInput || "Analyze this image",
          apiKey: apiKey.trim(),
          systemPrompt,
          image: userMessage.image,
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
    if (!canRun) {
      setSeedreamResult({ error: 'Please add your API key first.' });
      setIsSettingsOpen(true);
      return;
    }
    setSeedreamLoading(true);
    setSeedreamResult(null);
    
    try {
      let endpoint = '/api/seedream';
      let requestBody;

      if (activeModelId === 'seedance') {
          endpoint = '/api/seedance';
          requestBody = constructSeedancePayload(formValues);
      } else {
          requestBody = constructSeedreamPayload(formValues);
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestBody,
          apiKey: apiKey.trim(),
        }),
      });
      const data = await response.json();
      setSeedreamResult(data);
      if (showRequestOutput) {
        const debugBody = { ...requestBody, apiKey: 'REDACTED' };
        setLastRequestPayload({
          endpoint,
          body: debugBody,
        });
        setLastResponsePayload(data);
      }
    } catch (error) {
      setSeedreamResult({ error: 'Request failed', details: error.message });
    } finally {
      setSeedreamLoading(false);
    }
  };

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
                        else handleModelFamilyChange(key);
                    }}
                >
                    <Menu.Item key="seedream">
                        <IconImage style={{ fontSize: 20 }} />
                    </Menu.Item>
                    <Menu.Item key="seedance">
                        <IconVideoCamera style={{ fontSize: 20 }} />
                    </Menu.Item>
                    {/* Settings Tab - explicitly added back */}
                    <Menu.Item key="settings">
                        <IconSettings style={{ fontSize: 20 }} />
                    </Menu.Item>
                </Menu>
                {/* Removed duplicate settings button at bottom */}
                <div style={{ marginTop: 'auto', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
                </div>
            </div>
        </Sider>
        
        <Content style={{ padding: '24px', background: '#f6f7f9', overflowY: 'auto' }}>
            <div style={{ maxWidth: 1000, margin: '0 auto', position: 'relative' }}>
                {/* Robot Icon moved to top right */}
                <Tooltip content="AI Assistant">
                    <Button 
                        icon={<IconRobot style={{ fontSize: 20 }} />} 
                        shape="circle" 
                        type="primary" 
                        style={{ position: 'absolute', top: 0, right: 0, zIndex: 10 }}
                        onClick={() => setIsAssistantOpen(true)} 
                    />
                </Tooltip>

                <header style={{ marginBottom: 24, textAlign: 'center' }}>
                    <Title heading={2} style={{ margin: 0 }}>{uiSchema.title}</Title>
                    <Text type="secondary">{uiSchema.description}</Text>
                    
                    <div style={{ marginTop: 16 }}>
                        <Button.Group>
                            <Button 
                                type={activeModelId === 'seedream' ? 'primary' : 'secondary'}
                                onClick={() => handleModelFamilyChange('seedream')}
                            >
                                Image (Seedream)
                            </Button>
                            <Button 
                                type={activeModelId === 'seedance' ? 'primary' : 'secondary'}
                                onClick={() => handleModelFamilyChange('seedance')}
                            >
                                Video (Seedance)
                            </Button>
                        </Button.Group>
                    </div>
                </header>

                {activeModelId === 'seedance' ? (
                    <SeedancePlayground
                        schema={uiSchema}
                        formValues={formValues}
                        setFormValues={setFormValues}
                        onSubmit={handleSeedreamSubmit}
                        loading={seedreamLoading}
                        handleImageUpload={handleImageUpload}
                        removeImage={removeImage}
                        onModelChange={handleModelChange}
                    />
                ) : (
                    <SeedreamPlayground
                        schema={uiSchema}
                        formValues={formValues}
                        setFormValues={setFormValues}
                        onSubmit={handleSeedreamSubmit}
                        loading={seedreamLoading}
                        handleImageUpload={handleImageUpload}
                        removeImage={removeImage}
                        onModelChange={handleModelChange}
                    />
                )}
                
                <div style={{ marginTop: 24 }}>
                     <ResultViewer result={seedreamResult} modelType={activeModelId} />
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
                        <div style={{ whiteSpace: 'pre-wrap' }}>
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
