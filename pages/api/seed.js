import { CONFIG, getEndpointUrl } from '../../utils/config';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

async function seedHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { prompt, apiKey, modelId, baseUrl, systemPrompt, image, video } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const token = apiKey || process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Use config-defined base URL, fallback to passed baseUrl if provided
  const endpointBase = baseUrl || CONFIG.API_BASE_URL;
  const resolvedModelId = modelId || process.env.SEED_MODEL_ID || 'seed-2-0-mini-260215';

  try {
    const isPro260328 = resolvedModelId === 'seed-2-0-pro-260328';
    
    // For seed-2-0-pro-260328, we use /responses and input formatting
    if (isPro260328) {
      const inputContent = [{ type: 'input_text', text: prompt }];
      if (image) {
          inputContent.push({ 
              type: 'input_image', 
              image_url: image
          });
      }
      if (video) {
          inputContent.push({
              type: 'input_video',
              video_url: video
          });
      }

      const payload = {
          model: resolvedModelId,
          stream: false, // Stream false for simpler REST handling in StarterKit
          input: [
              {
                  role: "user",
                  content: inputContent
              }
          ]
      };

      const responsesEndpoint = `${endpointBase}/responses`;
      
      const response = await fetch(responsesEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || `API error: ${response.status}`);
      }
      
      // Adapt /responses output to match standard /chat/completions for frontend
      const content = data.output_text
        || data.output?.[0]?.content?.find((item) => item.type === 'output_text')?.text
        || data.output?.[0]?.content?.find((item) => item.type === 'text')?.text
        || data.output?.content?.[0]?.text
        || JSON.stringify(data);

      return res.status(200).json({ 
          content,
          raw: data 
      });
    }

    // Standard Chat Completions logic for other models
    const messages = [
      { role: 'system', content: systemPrompt || 'You are a helpful assistant.' }
    ];

    if (image || video) {
      const content = [{ type: 'text', text: prompt }];
      if (image) {
        content.push({ type: 'image_url', image_url: { url: image } });
      }
      if (video) {
        content.push({ type: 'video_url', video_url: { url: video } });
      }
      messages.push({ role: 'user', content });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    // Construct endpoint manually since we might have custom baseUrl
    const chatEndpoint = `${endpointBase}/chat/completions`;

    const response = await fetch(chatEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: resolvedModelId,
        messages: messages,
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
