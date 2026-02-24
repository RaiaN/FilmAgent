import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';
import { baseSchemas, apiKeyStorageKey } from '../utils/schemas';
import { constructSeedreamPayload, constructSeedancePayload, updateUiSchemaVisibility } from '../utils/apiHelpers';
import ModelForm from '../components/ModelForm';
import ResultViewer from '../components/ResultViewer';
import CopyButton from '../components/CopyButton';

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState('');
  const [apiKeyStatusType, setApiKeyStatusType] = useState('');

  const [activeModelId, setActiveModelId] = useState('seedream');
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);

  const baseSchema = baseSchemas[activeModelId];
  // uiSchema is now static/default matching baseSchema
  const [uiSchema, setUiSchema] = useState({
    title: 'ModelArk StarterKit',
    description: '',
    fields: baseSchema.fields,
    defaults: baseSchema.defaults,
  });
  const [formValues, setFormValues] = useState(baseSchema.defaults);
  
  // Removed dynamic builder states
  
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
      setApiKeyStatus('API key loaded');
      setApiKeyStatusType('success');
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
    // We don't need to switch schema here anymore, as schemas are now per-family
    // and the family is selected via a separate switcher or determined by the current activeModelId.
    // However, if we want to be safe, we can ensure we stay in the same family.
    
    setFormValues((prev) => ({
        ...prev,
        model: newModelId,
    }));
  };

  const handleSaveApiKey = () => {
    if (!apiKey.trim()) {
      setApiKeyStatus('Please enter an API key');
      setApiKeyStatusType('error');
      return;
    }
    window.localStorage.setItem(apiKeyStorageKey, apiKey.trim());
    setApiKeyStatus('API key saved');
    setApiKeyStatusType('success');
  };

  // Removed buildUiFromPrompt, extractJsonText, applyOverrideObject

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !canRun) return;

    const userMessage = { role: 'user', content: chatInput };
    setChatHistory((prev) => [...prev, userMessage]);
    setChatInput('');
    setChatLoading(true);

    try {
      const systemPrompt = `You are a helpful assistant for the ModelArk API. 
      You have knowledge of the following API schema: ${JSON.stringify(baseSchema, null, 2)}.
      Answer user questions about the API capabilities, parameters, and usage.`;

      const response = await fetch('/api/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: chatInput,
          apiKey: apiKey.trim(),
          systemPrompt,
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

  // Removed saveUiSchema, loadUiSchema, exportUiSchema, handleImportSchema

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
      <div className="app-container">
        {/* LEFT TOOLBAR */}
        <aside className="toolbar">
            <div className="toolbar-top">
                <div className="toolbar-icon" title="Settings" onClick={() => setIsSettingsOpen(!isSettingsOpen)}>
                    <span style={{ fontSize: '1.5rem' }}>⚙️</span>
                </div>
            </div>
        </aside>

        {/* SETTINGS PANEL (Pop-out) */}
        {isSettingsOpen && (
            <div className="settings-panel">
                <div className="settings-header">
                    <h3>Settings</h3>
                    <button className="close-btn" onClick={() => setIsSettingsOpen(false)}>×</button>
                </div>
                <div className="settings-content">
                    <div className="field">
                        <label htmlFor="api-key">API Key</label>
                        <input
                            id="api-key"
                            type="password"
                            value={apiKey}
                            onChange={(event) => {
                                setApiKey(event.target.value);
                                setApiKeyStatus('');
                                setApiKeyStatusType('');
                            }}
                            placeholder="Paste key..."
                        />
                    </div>
                    <div className="actions" style={{ marginTop: '0.5rem' }}>
                        <button type="button" onClick={handleSaveApiKey} className="small-btn">
                            Save
                        </button>
                    </div>
                    {apiKeyStatus && <div className={`status ${apiKeyStatusType}`}>{apiKeyStatus}</div>}

                    <hr className="divider" />

                    <div className="toggle-row">
                        <label className="toggle">
                        <input
                            type="checkbox"
                            checked={showRequestOutput}
                            onChange={(event) => setShowRequestOutput(event.target.checked)}
                        />
                        <span>Show request output</span>
                        </label>
                    </div>
                </div>
            </div>
        )}

        {/* MAIN CONTENT AREA */}
        <main className="main-content">
            <header className="main-header">
                <h1>{uiSchema.title}</h1>
                <p className="subtitle">{uiSchema.description}</p>
                
                <div className="family-switcher" style={{ marginTop: '1rem', display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                    <button 
                        onClick={() => handleModelFamilyChange('seedream')}
                        className={activeModelId === 'seedream' ? '' : 'secondary'}
                        style={{ opacity: activeModelId === 'seedream' ? 1 : 0.7 }}
                    >
                        Image (Seedream)
                    </button>
                    <button 
                        onClick={() => handleModelFamilyChange('seedance')}
                        className={activeModelId === 'seedance' ? '' : 'secondary'}
                        style={{ opacity: activeModelId === 'seedance' ? 1 : 0.7 }}
                    >
                        Video (Seedance)
                    </button>
                </div>
            </header>

            <div className="card">
                <ModelForm
                    uiSchema={uiSchema}
                    formValues={formValues}
                    setFormValues={setFormValues}
                    onSubmit={handleSeedreamSubmit}
                    loading={seedreamLoading}
                    handleImageUpload={handleImageUpload}
                    removeImage={removeImage}
                    activeModelId={activeModelId}
                    onModelChange={handleModelChange}
                />
                
                <ResultViewer result={seedreamResult} modelType={activeModelId} />
                
                {showRequestOutput && (lastRequestPayload || lastResponsePayload) && (
                    <div className="debug-panel">
                    {lastRequestPayload && (
                        <div className="result">
                            <div className="result-header">
                                <strong>Request</strong>
                                <CopyButton text={JSON.stringify(lastRequestPayload, null, 2)} />
                            </div>
                            {JSON.stringify(lastRequestPayload, null, 2)}
                        </div>
                    )}
                    {lastResponsePayload && (
                        <div className="result">
                            <div className="result-header">
                                <strong>Response</strong>
                                <CopyButton text={JSON.stringify(lastResponsePayload, null, 2)} />
                            </div>
                            {JSON.stringify(lastResponsePayload, null, 2)}
                        </div>
                    )}
                    </div>
                )}
            </div>
        </main>

        {/* RIGHT SIDEBAR (AI Assistant) */}
        <aside className={`right-sidebar ${isAssistantOpen ? 'open' : 'closed'}`}>
            <div className="right-sidebar-toggle" onClick={() => setIsAssistantOpen(!isAssistantOpen)}>
                <span style={{ fontSize: '1.2rem' }}>{isAssistantOpen ? '→' : '←'}</span>
                {!isAssistantOpen && <span className="vertical-text">AI Assistant</span>}
            </div>
            
            {isAssistantOpen && (
                <div className="right-sidebar-content">
                    <div className="sidebar-header">
                        <h3>AI Assistant</h3>
                    </div>
                    <div className="chat-container">
                        <div className="chat-history">
                            {chatHistory.map((msg, index) => (
                            <div
                                key={index}
                                className={`chat-message ${msg.role}`}
                            >
                                <strong>{msg.role === 'user' ? 'You' : 'AI'}:</strong> {msg.content}
                            </div>
                            ))}
                            <div ref={chatEndRef} />
                        </div>
                        <form onSubmit={handleChatSubmit} className="chat-input-form">
                            <input
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                placeholder="Ask about API..."
                                disabled={chatLoading}
                            />
                            <button type="submit" disabled={chatLoading}>Send</button>
                        </form>
                    </div>
                </div>
            )}
        </aside>
      </div>
    </>
  );
}
