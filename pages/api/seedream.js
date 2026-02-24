async function seedreamHandler(req, res) {
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
  const resolvedModelId = modelId || process.env.SEEDREAM_MODEL_ID || 'seedream-4-5-251128';

  try {
    const response = await fetch(`${endpoint}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: resolvedModelId,
        prompt,
        size: '2K',
        watermark: false,
        response_format: 'url',
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Seedream request failed', details: data });
    }

    const imageUrl = data?.data?.[0]?.url;
    if (!imageUrl) {
      return res.status(500).json({ error: 'No image returned', details: data });
    }

    return res.status(200).json({ imageUrl });
  } catch (error) {
    return res.status(500).json({ error: 'Request failed', details: error.message });
  }
}

export default seedreamHandler;
