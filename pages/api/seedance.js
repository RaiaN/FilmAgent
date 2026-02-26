import { CONFIG, getEndpointUrl } from '../../utils/config';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

async function seedanceHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { apiKey, baseUrl, ...payload } = req.body;

  const token = apiKey || process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Use getEndpointUrl('video') which returns /contents/generations/tasks
  const defaultEndpoint = getEndpointUrl('video');
  const endpoint = baseUrl 
      ? `${baseUrl}/contents/generations/tasks`
      : defaultEndpoint;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Seedance request failed', details: data });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Request failed', details: error.message });
  }
}

export default seedanceHandler;
