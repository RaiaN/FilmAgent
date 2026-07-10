import { getEndpointUrl } from '../../utils/config';

// Seedream 5.0 Lite endpoint — the fallback when a request doesn't name a model.
// The Image tab now sends the selected endpoint (Lite or Pro) in the request body.
const DEFAULT_SEEDREAM_MODEL_ID = 'ep-20260501195034-hj78f';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

async function seedreamHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const {
    model, prompt, apiKey, baseUrl, size, watermark, responseFormat, image,
    sequential_image_generation, sequential_image_generation_options,
    optimize_prompt_options, output_format, guidance_scale, seed
  } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const token = apiKey || process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Use getEndpointUrl('image') which returns /images/generations
  const defaultEndpoint = getEndpointUrl('image');
  const endpoint = baseUrl 
      ? `${baseUrl}/images/generations`
      : defaultEndpoint;

  try {
    const payload = {
      model: model || DEFAULT_SEEDREAM_MODEL_ID,
      prompt,
      size: size || '2K',
      watermark: watermark ?? false,
      response_format: responseFormat || 'url',
    };

    if (image) payload.image = image;
    
    // Sequential Generation
    if (sequential_image_generation) {
      payload.sequential_image_generation = sequential_image_generation;
      if (sequential_image_generation === 'auto' && sequential_image_generation_options) {
        payload.sequential_image_generation_options = sequential_image_generation_options;
      }
    }

    // Optimize Prompt (5.0/4.5/4.0)
    if (optimize_prompt_options) {
      payload.optimize_prompt_options = optimize_prompt_options;
    }

    // Output Format (5.0-lite only)
    if (output_format) {
      payload.output_format = output_format;
    }

    // Guidance Scale (3.0 only)
    if (guidance_scale !== undefined && guidance_scale !== null) {
      payload.guidance_scale = guidance_scale;
    }

    // Seed (3.0 only)
    if (seed !== undefined && seed !== null) {
      payload.seed = seed;
    }

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
      return res.status(response.status).json({ error: 'Seedream request failed', details: data });
    }

    if (!data?.data || data.data.length === 0) {
      return res.status(500).json({ error: 'No image returned', details: data });
    }

    // Return all images
    return res.status(200).json({ 
      images: data.data, 
      imageUrl: data.data[0].url || null 
    });
  } catch (error) {
    return res.status(500).json({ error: 'Request failed', details: error.message });
  }
}

export default seedreamHandler;
