import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';

const baseSchemas = {
  seedream: {
    id: 'seedream',
    name: 'Seedream Image',
    description: 'Seedream images/generations request schema (API 1:1).',
    fields: [
      {
        key: 'model',
        label: 'Model',
        type: 'enum',
        options: ['seedream-4-5-251128', 'seedream-4-0-250828', 'seedream-5-0-260128'],
        defaultValue: 'seedream-4-5-251128',
        description: 'Seedream model id used for generation.',
      },
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'text',
        required: true,
        description: 'Primary text prompt for image generation. Max ~600 words.',
      },
      {
        key: 'image',
        label: 'Reference Images',
        type: 'image-list',
        description: 'Optional reference images (URL or Base64). Up to 14 images for multi-image blending.',
      },
      {
        key: 'size',
        label: 'Size',
        type: 'enum',
        options: ['2K', '4K', 'Custom'],
        defaultValue: '2K',
        description: 'Output resolution. 2K=2048x2048 approx. Custom allows specific WxH.',
      },
      {
        key: 'width',
        label: 'Width (px)',
        type: 'number',
        hidden: true, // Only show if size is Custom
        description: 'Custom width in pixels.',
      },
      {
        key: 'height',
        label: 'Height (px)',
        type: 'number',
        hidden: true, // Only show if size is Custom
        description: 'Custom height in pixels.',
      },
      {
        key: 'watermark',
        label: 'Watermark',
        type: 'boolean',
        defaultValue: false,
        description: 'Whether to apply a watermark to the output.',
      },
      {
        key: 'sequential_image_generation',
        label: 'Sequential Generation',
        type: 'boolean',
        defaultValue: false,
        description: 'Generate multiple related images in sequence (auto).',
      },
      {
        key: 'response_format',
        label: 'Response Format',
        type: 'enum',
        options: ['url', 'b64_json'],
        defaultValue: 'url',
        description: 'Output format for the generated image.',
      },
    ],
    defaults: {
      model: 'seedream-4-5-251128',
      prompt: 'A hero product shot of a premium skincare bottle on a minimal studio set.',
      size: '2K',
      width: 2048,
      height: 2048,
      image: [],
      watermark: false,
      sequential_image_generation: false,
      response_format: 'url',
    },
  },
};

const apiKeyStorageKey = 'modelark_api_key';

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState('');
  const [apiKeyStatusType, setApiKeyStatusType] = useState('');

  const [activeModelId] = useState('seedream');
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
    if (activeModelId === 'seedream') {
      const isCustomSize = formValues.size === 'Custom';
      setUiSchema((prev) => {
        const nextFields = prev.fields.map((f) => {
          if (f.key === 'width' || f.key === 'height') {
            return { ...f, hidden: !isCustomSize };
          }
          return f;
        });
        // Check if actually changed to avoid loop
        if (JSON.stringify(nextFields) !== JSON.stringify(prev.fields)) {
          return { ...prev, fields: nextFields };
        }
        return prev;
      });
    }
  }, [formValues.size, activeModelId]);

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
      const composedPrompt = formValues.prompt;
      
      // Construct payload based on strict schema
      const requestBody = {
        model: formValues.model,
        prompt: composedPrompt,
        watermark: formValues.watermark,
        response_format: formValues.response_format,
      };

      // Handle Size
      if (formValues.size === 'Custom') {
        // Size must be WxH string e.g. "2048x2048"
        if (formValues.width && formValues.height) {
           requestBody.size = `${formValues.width}x${formValues.height}`;
        } else {
           // Fallback or error? defaulting to 2K if missing
           requestBody.size = '2K'; 
        }
      } else {
        requestBody.size = formValues.size;
      }

      // Handle Images
      if (formValues.image && formValues.image.length > 0) {
        // API expects "image" as string or array
        // If single image, can be string. If multiple, array.
        // We will always send array if > 1, or string if == 1? 
        // Docs say: "image string/array".
        if (formValues.image.length === 1) {
            requestBody.image = formValues.image[0];
        } else {
            requestBody.image = formValues.image;
        }
      }

      if (formValues.sequential_image_generation) {
        requestBody.sequential_image_generation = 'auto';
      }

      const response = await fetch('/api/seedream', {
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
          endpoint: '/api/seedream',
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
            </header>

            <div className="card">
                <form onSubmit={handleSeedreamSubmit}>
                    <div className="field-grid">
                    {uiSchema.fields.filter((field) => !field.hidden).map((field) => {
                        const value = formValues[field.key] ?? '';
                        
                        if (field.type === 'enum') {
                            return (
                                <div className="field" key={field.key}>
                                <label htmlFor={`field-${field.key}`}>{field.label}</label>
                                <select
                                    id={`field-${field.key}`}
                                    value={value}
                                    disabled={field.readOnly}
                                    onChange={(event) =>
                                    setFormValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                                    }
                                >
                                    {field.options.map((option) => (
                                    <option key={option} value={option}>
                                        {option}
                                    </option>
                                    ))}
                                </select>
                                </div>
                            );
                        }
                        if (field.type === 'image-list') {
                            return (
                                <div className="field full-width" key={field.key}>
                                <label>{field.label}</label>
                                <div className="image-drop-area">
                                    <div className="image-preview-row">
                                        {(value || []).map((img, idx) => (
                                        <div key={idx} className="image-preview-item">
                                            <img src={img} alt={`ref-${idx}`} />
                                            <button
                                            type="button"
                                            className="remove-btn"
                                            onClick={() => removeImage(field.key, idx)}
                                            >
                                            ×
                                            </button>
                                        </div>
                                        ))}
                                    </div>
                                    <div className="file-input-wrapper">
                                        <span>Click to upload images (or drag here)</span>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            onChange={(e) => handleImageUpload(e, field.key)}
                                        />
                                    </div>
                                </div>
                                <p className="helper">{field.description}</p>
                                </div>
                            );
                        }
                        if (field.type === 'number') {
                        return (
                            <div className="field" key={field.key}>
                            <label htmlFor={`field-${field.key}`}>{field.label}</label>
                            <input
                                id={`field-${field.key}`}
                                type="number"
                                value={value}
                                disabled={field.readOnly}
                                onChange={(event) =>
                                setFormValues((prev) => ({
                                    ...prev,
                                    [field.key]: Number(event.target.value),
                                }))
                                }
                            />
                            <p className="helper">{field.description}</p>
                            </div>
                        );
                        }
                        if (field.type === 'boolean') {
                        return (
                            <div className="field" key={field.key}>
                            <label htmlFor={`field-${field.key}`}>{field.label}</label>
                            <input
                                id={`field-${field.key}`}
                                type="checkbox"
                                checked={Boolean(value)}
                                disabled={field.readOnly}
                                onChange={(event) =>
                                setFormValues((prev) => ({ ...prev, [field.key]: event.target.checked }))
                                }
                            />
                            </div>
                        );
                        }
                        if (field.key === 'prompt') {
                        return (
                            <div className="field full-width" key={field.key}>
                            <label htmlFor={`field-${field.key}`}>{field.label}</label>
                            <textarea
                                id={`field-${field.key}`}
                                value={value}
                                onChange={(event) =>
                                setFormValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                                }
                            />
                            </div>
                        );
                        }
                        return (
                        <div className="field" key={field.key}>
                            <label htmlFor={`field-${field.key}`}>{field.label}</label>
                            <input
                            id={`field-${field.key}`}
                            value={value}
                            disabled={field.readOnly}
                            onChange={(event) =>
                                setFormValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                            }
                            />
                        </div>
                        );
                    })}
                    </div>
                    
                    <div className="actions" style={{ marginTop: '2rem' }}>
                        <button type="submit" disabled={seedreamLoading} className="primary-btn-lg">
                            {seedreamLoading ? 'Generating...' : 'Generate Media'}
                        </button>
                    </div>

                    {seedreamResult?.images ? (
                        <div className="result-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginTop: '2rem' }}>
                            {seedreamResult.images.map((img, idx) => {
                            const src = img.url || `data:image/png;base64,${img.b64_json}`;
                            return (
                                <div key={idx} className="result-item">
                                <img src={src} alt={`Result ${idx + 1}`} className="media" />
                                <div className="actions" style={{ marginTop: '0.5rem' }}>
                                    <a className="link-button secondary small" href={src} download={`result-${idx + 1}.png`}>
                                    Download
                                    </a>
                                </div>
                                </div>
                            );
                            })}
                        </div>
                    ) : seedreamResult?.imageUrl ? (
                    <>
                        <img src={seedreamResult.imageUrl} alt="Result" className="media" />
                        <div className="actions" style={{ marginTop: '0.5rem' }}>
                        <a
                            className="link-button secondary"
                            href={seedreamResult.imageUrl}
                            download="result.png"
                        >
                            Download
                        </a>
                        </div>
                    </>
                    ) : null}
                    
                    {seedreamResult && !seedreamResult.imageUrl && !seedreamResult.images && (
                        <div className="result">{JSON.stringify(seedreamResult, null, 2)}</div>
                    )}
                </form>
                
                {showRequestOutput && (lastRequestPayload || lastResponsePayload) && (
                    <div className="debug-panel">
                    {lastRequestPayload && (
                        <div className="result">
                        <strong>Request:</strong>
                        {JSON.stringify(lastRequestPayload, null, 2)}
                        </div>
                    )}
                    {lastResponsePayload && (
                        <div className="result">
                        <strong>Response:</strong>
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
