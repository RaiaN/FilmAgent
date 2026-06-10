import { CONFIG } from '../../../utils/config';
import { ROOT_CONFIG } from '../../../utils/film/suiteConfig';

const RESEARCH_MODEL = ROOT_CONFIG.models.reasoner;
const SEEDREAM_ENDPOINT_MODEL = ROOT_CONFIG.models.seedream;
const DEFAULT_SIZE = '4K';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const extractResponseText = (data) => {
  const nestedText = Array.isArray(data?.output)
    ? data.output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .find((item) => item?.type === 'output_text' || item?.type === 'text')?.text
    : '';
  return data.output_text || nestedText || '';
};

const stripCodeFences = (text) => {
  const trimmed = String(text || '').trim();
  const fenceMatch = trimmed.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
};

const buildLocationSystem = ({ language }) => [
  'You convert a film location description into one production-ready Seedream prompt for an establishing plate.',
  'Return prompt only. No markdown. No explanations. No code fences.',
  'Use exactly these bracketed sections in this order:',
  '[MEDIUM] [SUBJECT] [CAMERA] [LIGHTING] [PALETTE] [ATMOSPHERE] [FORBIDDEN].',
  'No characters or people in the frame. This is an empty establishing shot.',
  'The generated image must contain no text, no letters, no numbers, no logos, no watermarks.',
  'Match the film\'s established visual style exactly: lens, format, palette, lighting, grade, era.',
  language && language !== 'en'
    ? `If captions or signage are ever shown elsewhere in this film they will be in ${language}; but this plate has no on-screen text.`
    : '',
].filter(Boolean).join(' ');

const buildLocationUser = ({ location, style }) => [
  'Location to render as an establishing plate:',
  JSON.stringify(location, null, 2),
  '',
  'Film style bible to obey:',
  JSON.stringify(style, null, 2),
  '',
  'Output a single Seedream prompt in the bracketed format. No people. No text.',
].join('\n');

export default async function locationHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { apiKey, baseUrl, language, location, style } = req.body || {};

  if (!location || !location.description) {
    return res.status(400).json({ error: 'location with description is required' });
  }
  if (!style) {
    return res.status(400).json({ error: 'style bible is required' });
  }

  const token = apiKey || process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'API key not configured' });
  }
  const endpointBase = (baseUrl || CONFIG.API_BASE_URL).replace(/\/+$/, '');

  try {
    // Step 1: Seed 2.0 Pro rewrites into a Seedream bracketed prompt.
    const promptResponse = await fetch(`${endpointBase}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: RESEARCH_MODEL,
        stream: false,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: buildLocationSystem({ language }) }] },
          { role: 'user', content: [{ type: 'input_text', text: buildLocationUser({ location, style }) }] },
        ],
      }),
    });
    const promptData = await promptResponse.json();
    if (!promptResponse.ok) {
      return res.status(promptResponse.status).json({
        error: promptData?.error?.message || 'Location prompt synthesis failed',
        details: promptData,
      });
    }
    const seedreamPrompt = stripCodeFences(extractResponseText(promptData)).trim();
    if (!seedreamPrompt) {
      return res.status(502).json({ error: 'Empty prompt from Seed 2.0' });
    }

    // Step 2: Seedream renders the plate.
    const imageResponse = await fetch(`${endpointBase}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: SEEDREAM_ENDPOINT_MODEL,
        prompt: seedreamPrompt,
        size: DEFAULT_SIZE,
        watermark: false,
        response_format: 'url',
      }),
    });
    const imageData = await imageResponse.json();
    if (!imageResponse.ok) {
      return res.status(imageResponse.status).json({
        error: imageData?.error?.message || 'Seedream render failed',
        details: imageData,
      });
    }
    const imageUrl = imageData?.data?.[0]?.url;
    if (!imageUrl) {
      return res.status(502).json({ error: 'Seedream returned no image URL' });
    }

    return res.status(200).json({
      locationId: location.id,
      prompt: seedreamPrompt,
      imageUrl,
      model: SEEDREAM_ENDPOINT_MODEL,
      size: DEFAULT_SIZE,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Location render crashed', details: error.message });
  }
}
