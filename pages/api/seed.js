import { CONFIG } from '../../utils/config';
import { ROOT_CONFIG } from '../../utils/film/suiteConfig';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '200mb',
    },
  },
};

async function seedHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { prompt, apiKey, modelId, baseUrl, systemPrompt, images, video, reasoningEffort } = req.body;
  const imageList = Array.isArray(images) ? images : (images ? [images] : []);

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const token = apiKey || process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Use config-defined base URL, fallback to passed baseUrl if provided
  const endpointBase = baseUrl || CONFIG.API_BASE_URL;
  // Honor a caller-provided model; default to the suite's reasoner model.
  const resolvedModelId = modelId || ROOT_CONFIG.models.reasoner;

  try {
    // Seed 2.0 Pro family uses the /responses API + input formatting.
    const isPro260328 = resolvedModelId.startsWith('seed-2-0-pro');
    
    // For seed-2-0-pro-260328, we use /responses and input formatting
    if (isPro260328) {
      const inputContent = [{ type: 'input_text', text: prompt }];
      imageList.forEach(img => {
          inputContent.push({ type: 'input_image', image_url: img });
      });
      if (video) {
          inputContent.push({
              type: 'input_video',
              video_url: video
          });
      }

      const inputMessages = [];
      if (systemPrompt) {
          inputMessages.push({
              role: 'system',
              content: [{ type: 'input_text', text: systemPrompt }],
          });
      }
      inputMessages.push({ role: 'user', content: inputContent });

      const payload = {
          model: resolvedModelId,
          stream: false, // Stream false for simpler REST handling in StarterKit
          input: inputMessages,
      };
      // Seed 2.0 Pro reasoning depth is controlled by `thinking` — this endpoint
      // rejects `reasoning_effort` as an unknown field. 'low'/unset → leave
      // default (fast — chat assistant + one-liner helpers); 'medium'/'high' →
      // enable thinking.
      if (reasoningEffort && reasoningEffort !== 'low') {
        payload.thinking = { type: 'enabled' };
      }

      const responsesEndpoint = `${endpointBase}/responses`;
      const callResponses = (body) => fetch(responsesEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      let response = await callResponses(payload);
      // If the reasoning params (thinking / reasoning_effort) tripped the request,
      // retry once WITHOUT them so the suite still works even if the depth-control
      // shape is wrong for this endpoint. Log the real reason so the correct shape
      // is diagnosable in the dev terminal.
      if (!response.ok && payload.thinking) {
        const firstErr = await response.text().catch(() => '');
        console.warn(`[seed] thinking param rejected (${response.status}) — retrying without it. Reason: ${firstErr.slice(0, 400)}`);
        response = await callResponses({ model: payload.model, stream: payload.stream, input: payload.input });
      }

      const responseText = await response.text();
      let data;
      try { data = JSON.parse(responseText); } catch {
        return res.status(502).json({ error: 'API returned a non-JSON response', details: responseText.slice(0, 300) });
      }
      if (!response.ok) {
        // Surface the ACTUAL ModelArk message, not a generic 'Request failed'.
        const apiMsg = data?.error?.message
          || data?.message
          || (typeof data?.error === 'string' ? data.error : null)
          || `Seed API error (${response.status})`;
        return res.status(response.status).json({ error: apiMsg, details: data });
      }
      
      // Adapt /responses output to match standard /chat/completions for frontend.
      // With thinking enabled the output[] leads with a `reasoning` item (the model's
      // private thinking) and the assistant `message` follows — take text from the
      // MESSAGE only, never the reasoning, and concatenate every text part (a long
      // JSON answer can span several parts).
      const outputItems = Array.isArray(data.output) ? data.output : [];
      const assistantText = outputItems
        .filter((item) => item?.type !== 'reasoning')
        .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('')
        .trim();
      const content = assistantText || (typeof data.output_text === 'string' ? data.output_text.trim() : '');
      if (!content) {
        // No assistant text — surface the real envelope (its `status` /
        // `incomplete_details` says e.g. max_output_tokens) instead of masking it as
        // fake content the downstream JSON parser then chokes on.
        console.warn('[seed] /responses returned no assistant text:', JSON.stringify(data).slice(0, 800));
        return res.status(502).json({ error: 'Reasoning model returned no assistant text', details: data });
      }

      return res.status(200).json({ content, raw: data });
    }

    // Standard Chat Completions logic for other models
    const messages = [
      { role: 'system', content: systemPrompt || 'You are a helpful assistant.' }
    ];

    if (imageList.length > 0 || video) {
      const content = [{ type: 'text', text: prompt }];
      imageList.forEach(img => {
        content.push({ type: 'image_url', image_url: { url: img } });
      });
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

    const responseText = await response.text();
    let data;
    try { data = JSON.parse(responseText); } catch {
      return res.status(502).json({ error: 'API returned a non-JSON response', details: responseText.slice(0, 300) });
    }
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
