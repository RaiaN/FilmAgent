async function seedHandler(req, res) {
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
  const resolvedModelId = modelId || process.env.SEED_MODEL_ID || 'seed-1-8-251228';

  try {
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: resolvedModelId,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Seed request failed', details: data });
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(500).json({ error: 'No response text returned', details: data });
    }

    return res.status(200).json({ content });
  } catch (error) {
    return res.status(500).json({ error: 'Request failed', details: error.message });
  }
}

export default seedHandler;
