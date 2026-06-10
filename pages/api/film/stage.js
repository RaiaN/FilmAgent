import { CONFIG } from '../../../utils/config';
import { STAGE_BUILDERS } from '../../../utils/film/promptBuilders';

const DEFAULT_MODEL = 'seed-2-0-pro-260328';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '8mb',
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
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
};

const parseJsonFlexible = (text) => {
  const cleaned = stripCodeFences(text);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const slice = cleaned.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(slice);
      } catch {
        // fall through
      }
    }
    const error = new Error('Model returned non-JSON output');
    error.raw = cleaned;
    throw error;
  }
};

export default async function filmStageHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { stage, apiKey, baseUrl, language, targetMinutes, idea, logline, treatment, script, instructions } = req.body || {};

  if (!STAGE_BUILDERS[stage]) {
    return res.status(400).json({ error: `Unknown stage: ${stage}` });
  }

  const token = apiKey || process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const endpointBase = (baseUrl || CONFIG.API_BASE_URL).replace(/\/+$/, '');
  const { system, user } = STAGE_BUILDERS[stage];

  const systemText = system({ language });
  const userTextBase = user({ idea, logline, treatment, script, targetMinutes });
  const userText = instructions && String(instructions).trim()
    ? `${userTextBase}\n\nAdditional director's notes:\n${String(instructions).trim()}`
    : userTextBase;

  try {
    const response = await fetch(`${endpointBase}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        stream: false,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: systemText }] },
          { role: 'user', content: [{ type: 'input_text', text: userText }] },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || `Stage ${stage} failed`,
        details: data,
      });
    }
    const text = extractResponseText(data).trim();
    if (!text) {
      return res.status(502).json({ error: `Stage ${stage} returned empty output` });
    }
    let parsed;
    try {
      parsed = parseJsonFlexible(text);
    } catch (err) {
      return res.status(502).json({ error: err.message, raw: err.raw || text });
    }
    return res.status(200).json({ stage, draft: parsed, raw: text, model: DEFAULT_MODEL });
  } catch (error) {
    return res.status(500).json({ error: `Stage ${stage} crashed`, details: error.message });
  }
}
