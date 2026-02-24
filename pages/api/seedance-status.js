async function seedanceStatusHandler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { taskId, apiKey, baseUrl } = req.query;

  if (!taskId) {
    return res.status(400).json({ error: 'Task ID is required' });
  }

  const token = apiKey || process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const endpoint = baseUrl || process.env.MODELARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3';

  try {
    const response = await fetch(`${endpoint}/contents/generations/tasks/${taskId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Seedance status failed', details: data });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Request failed', details: error.message });
  }
}

export default seedanceStatusHandler;
