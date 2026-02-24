import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';

const tabs = [
  { id: 'seedream', label: 'Seedream Image' },
  { id: 'seedance', label: 'Seedance Video' },
  { id: 'seed', label: 'Seed Text' },
];

const apiKeyStorageKey = 'modelark_api_key';

export default function Home() {
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState('');
  const [apiKeyStatusType, setApiKeyStatusType] = useState('');

  const [seedreamPrompt, setSeedreamPrompt] = useState('A cozy reading nook with warm sunlight');
  const [seedreamLoading, setSeedreamLoading] = useState(false);
  const [seedreamResult, setSeedreamResult] = useState(null);

  const [seedancePrompt, setSeedancePrompt] = useState('A cinematic shot of a city skyline at night');
  const [seedanceLoading, setSeedanceLoading] = useState(false);
  const [seedanceTaskId, setSeedanceTaskId] = useState('');
  const [seedanceStatus, setSeedanceStatus] = useState(null);
  const [seedanceVideoUrl, setSeedanceVideoUrl] = useState('');
  const [seedancePolling, setSeedancePolling] = useState(false);
  const seedancePollRef = useRef(null);

  const [seedPrompt, setSeedPrompt] = useState('Write a friendly welcome message for new users.');
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedResult, setSeedResult] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedKey = window.localStorage.getItem(apiKeyStorageKey);
    if (savedKey) {
      setApiKey(savedKey);
      setApiKeyStatus('API key loaded');
      setApiKeyStatusType('success');
    }
  }, []);

  useEffect(() => () => {
    if (seedancePollRef.current) clearInterval(seedancePollRef.current);
  }, []);

  const canRun = useMemo(() => apiKey.trim().length > 0, [apiKey]);

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

  const extractVideoUrl = (data) => {
    const candidates = [
      data?.output?.video?.url,
      data?.output?.url,
      data?.video?.url,
      data?.result?.url,
      data?.outputs?.[0]?.url,
      data?.data?.[0]?.url,
      data?.content?.[0]?.url,
      data?.content?.[0]?.video_url,
      data?.content?.[0]?.video?.url,
    ];
    return candidates.find(Boolean) || '';
  };

  const normalizeStatus = (data) => {
    const raw = data?.status || data?.state || data?.task_status;
    return raw ? String(raw).toLowerCase() : '';
  };

  const isCompletedStatus = (data) => {
    const status = normalizeStatus(data);
    if (!status) return false;
    return ['succeeded', 'success', 'failed', 'error', 'completed', 'complete'].some((value) =>
      status.includes(value)
    );
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
      const response = await fetch('/api/seedream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: seedreamPrompt, apiKey: apiKey.trim() }),
      });
      const data = await response.json();
      setSeedreamResult(data);
    } catch (error) {
      setSeedreamResult({ error: 'Request failed', details: error.message });
    } finally {
      setSeedreamLoading(false);
    }
  };

  const pollSeedanceStatus = async (taskId) => {
    if (!taskId || !apiKey.trim()) return;
    try {
      const response = await fetch(
        `/api/seedance-status?taskId=${encodeURIComponent(taskId)}&apiKey=${encodeURIComponent(apiKey.trim())}`
      );
      const data = await response.json();
      setSeedanceStatus(data);
      const video = extractVideoUrl(data);
      if (video) setSeedanceVideoUrl(video);
      if (isCompletedStatus(data)) {
        setSeedancePolling(false);
        if (seedancePollRef.current) clearInterval(seedancePollRef.current);
      }
    } catch (error) {
      setSeedanceStatus({ error: 'Status check failed', details: error.message });
      setSeedancePolling(false);
      if (seedancePollRef.current) clearInterval(seedancePollRef.current);
    }
  };

  const startSeedancePolling = (taskId) => {
    if (seedancePollRef.current) clearInterval(seedancePollRef.current);
    setSeedancePolling(true);
    seedancePollRef.current = setInterval(() => pollSeedanceStatus(taskId), 6000);
    pollSeedanceStatus(taskId);
  };

  const handleSeedanceSubmit = async (event) => {
    event.preventDefault();
    if (!canRun) {
      setSeedanceStatus({ error: 'Please add your API key first.' });
      return;
    }
    setSeedanceLoading(true);
    setSeedanceStatus(null);
    setSeedanceTaskId('');
    setSeedanceVideoUrl('');
    try {
      const response = await fetch('/api/seedance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: seedancePrompt, apiKey: apiKey.trim() }),
      });
      const data = await response.json();
      if (data.taskId) {
        setSeedanceTaskId(data.taskId);
        startSeedancePolling(data.taskId);
      } else {
        setSeedanceStatus(data);
      }
    } catch (error) {
      setSeedanceStatus({ error: 'Request failed', details: error.message });
    } finally {
      setSeedanceLoading(false);
    }
  };

  const handleSeedSubmit = async (event) => {
    event.preventDefault();
    if (!canRun) {
      setSeedResult({ error: 'Please add your API key first.' });
      return;
    }
    setSeedLoading(true);
    setSeedResult(null);
    try {
      const response = await fetch('/api/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: seedPrompt, apiKey: apiKey.trim() }),
      });
      const data = await response.json();
      setSeedResult(data);
    } catch (error) {
      setSeedResult({ error: 'Request failed', details: error.message });
    } finally {
      setSeedLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>ModelArk Starter Kit</title>
      </Head>
      <main className="page">
        <header className="header">
          <h1>ModelArk Starter Kit</h1>
          <p className="subtitle">Paste an API key and run Seedream, Seedance, or Seed in seconds.</p>
        </header>

        <section className="card">
          <h2>1. Add your API key</h2>
          <p className="helper">This key is saved only in your browser.</p>
          <div className="row">
            <div className="field">
              <label htmlFor="api-key">ModelArk API Key</label>
              <input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setApiKeyStatus('');
                  setApiKeyStatusType('');
                }}
                placeholder="Paste your API key"
              />
            </div>
            <div className="actions" style={{ alignItems: 'flex-end' }}>
              <button type="button" onClick={handleSaveApiKey}>
                Save key
              </button>
            </div>
          </div>
          {apiKeyStatus && <div className={`status ${apiKeyStatusType}`}>{apiKeyStatus}</div>}
        </section>

        <section className="card">
          <div className="tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'seedream' && (
            <form onSubmit={handleSeedreamSubmit}>
              <div className="field">
                <label htmlFor="seedream-prompt">Describe the image</label>
                <textarea
                  id="seedream-prompt"
                  value={seedreamPrompt}
                  onChange={(event) => setSeedreamPrompt(event.target.value)}
                />
              </div>
              <div className="actions">
                <button type="submit" disabled={seedreamLoading}>
                  {seedreamLoading ? 'Generating...' : 'Generate image'}
                </button>
                <button type="button" className="secondary" onClick={() => setSeedreamPrompt('')}>
                  Clear
                </button>
              </div>
              {seedreamResult?.imageUrl && (
                <>
                  <img src={seedreamResult.imageUrl} alt="Seedream result" className="media" />
                  <div className="actions">
                    <a
                      className="link-button secondary"
                      href={seedreamResult.imageUrl}
                      download="seedream-image.png"
                    >
                      Download image
                    </a>
                  </div>
                </>
              )}
              {seedreamResult && !seedreamResult.imageUrl && (
                <div className="result">{JSON.stringify(seedreamResult, null, 2)}</div>
              )}
            </form>
          )}

          {activeTab === 'seedance' && (
            <form onSubmit={handleSeedanceSubmit}>
              <div className="field">
                <label htmlFor="seedance-prompt">Describe the video</label>
                <textarea
                  id="seedance-prompt"
                  value={seedancePrompt}
                  onChange={(event) => setSeedancePrompt(event.target.value)}
                />
              </div>
              <div className="actions">
                <button type="submit" disabled={seedanceLoading}>
                  {seedanceLoading ? 'Creating task...' : 'Generate video'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => seedanceTaskId && pollSeedanceStatus(seedanceTaskId)}
                  disabled={!seedanceTaskId || seedancePolling}
                >
                  Check status
                </button>
              </div>
              {seedanceTaskId && (
                <p className="helper">Task ID: {seedanceTaskId}</p>
              )}
              {seedancePolling && <p className="helper">Checking status every few seconds…</p>}
              {seedanceVideoUrl && (
                <>
                  <video className="media" controls src={seedanceVideoUrl} />
                  <div className="actions">
                    <a
                      className="link-button secondary"
                      href={seedanceVideoUrl}
                      download="seedance-video.mp4"
                    >
                      Download video
                    </a>
                  </div>
                </>
              )}
              {seedanceStatus && (
                <div className="result">{JSON.stringify(seedanceStatus, null, 2)}</div>
              )}
            </form>
          )}

          {activeTab === 'seed' && (
            <form onSubmit={handleSeedSubmit}>
              <div className="field">
                <label htmlFor="seed-prompt">Ask Seed</label>
                <textarea
                  id="seed-prompt"
                  value={seedPrompt}
                  onChange={(event) => setSeedPrompt(event.target.value)}
                />
              </div>
              <div className="actions">
                <button type="submit" disabled={seedLoading}>
                  {seedLoading ? 'Generating...' : 'Generate text'}
                </button>
                <button type="button" className="secondary" onClick={() => setSeedPrompt('')}>
                  Clear
                </button>
              </div>
              {seedResult?.content && (
                <>
                  <div className="result">{seedResult.content}</div>
                  <div className="actions">
                    <a
                      className="link-button secondary"
                      href={`data:text/plain;charset=utf-8,${encodeURIComponent(seedResult.content)}`}
                      download="seed-result.txt"
                    >
                      Download text
                    </a>
                  </div>
                </>
              )}
              {seedResult && !seedResult.content && (
                <div className="result">{JSON.stringify(seedResult, null, 2)}</div>
              )}
            </form>
          )}
        </section>
      </main>
    </>
  );
}
