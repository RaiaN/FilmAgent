async function seedanceHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { prompt, apiKey, modelId, baseUrl } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const token = apiKey || process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const endpoint = baseUrl || process.env.MODELARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3';
  const resolvedModelId = modelId || process.env.SEEDANCE_MODEL_ID || 'seedance-1-5-pro-251215';

  try {
    const response = await fetch(`${endpoint}/contents/generations/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: resolvedModelId,
        content: [{ type: 'text', text: prompt }],
        ratio: '16:9',
        duration: 5,
        generate_audio: false,
        watermark: false,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Seedance request failed', details: data });
    }

    const taskId = data?.id;
    if (!taskId) {
      return res.status(500).json({ error: 'No task ID returned', details: data });
    }

    return res.status(200).json({ taskId });
  } catch (error) {
    return res.status(500).json({ error: 'Request failed', details: error.message });
  }
}

export default seedanceHandler;
