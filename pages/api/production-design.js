import fs from 'fs';
import { CONFIG } from '../../utils/config';

const DEFAULT_SEEDANCE_MODEL = 'ep-20260415171928-pdvvr';
const DEFAULT_RESEARCH_MODEL = 'seed-2-0-pro-260328';
const EXPLORATION_VARIANTS = [
  {
    key: 'anchor',
    label: 'Anchor Pass',
    directive:
      'Create the most faithful production-design pass. Prioritize landmark readability, architecture hierarchy, and a stable visual language that can anchor future iterations.',
  },
  {
    key: 'adjacent',
    label: 'Adjacent Pass',
    directive:
      'Explore a nearby variation of the same world. Preserve the core rules while revealing an adjacent district, route, or atmospheric condition that expands the design space.',
  },
  {
    key: 'frontier',
    label: 'Frontier Pass',
    directive:
      'Push the world outward. Test a bolder edge case that still belongs to the same design system, surfacing new opportunities for continued exploration.',
  },
];

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

const clampDuration = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 15;
  return Math.min(15, Math.max(1, Math.round(numeric)));
};

const toArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value)
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
};

const extractResponseText = (data) => {
  const nestedText = Array.isArray(data?.output)
    ? data.output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .find((item) => item?.type === 'output_text' || item?.type === 'text')?.text
    : '';

  return (
    data.output_text ||
    nestedText ||
    ''
  );
};

const parseJsonResponse = (text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('Research model returned an empty response.');
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw error;
    }
    return JSON.parse(match[0]);
  }
};

const reportDebugEvent = ({ runId = 'post-fix', hypothesisId, location, msg, data = {} }) => {
  if (process.env.NODE_ENV === 'test') return;
  let url = 'http://127.0.0.1:7777/event';
  let sessionId = 'production-design-empty-response';
  try {
    const env = fs.readFileSync(`${process.cwd()}/.dbg/production-design-empty-response.env`, 'utf8');
    url = env.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || url;
    sessionId = env.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || sessionId;
  } catch {}
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      runId,
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
};

const buildResearchSystemPrompt = (duration) => {
  return [
    'You are an agentic production design researcher and planner for environment exploration videos.',
    'Your job is to turn rough creative inputs into a repeatable world-exploration package that can be used across multiple iterations.',
    'Study the user brief, source materials, natural-language rules, exploration goal, and continuity notes.',
    'Respond with JSON only and no markdown fences.',
    'Return this exact shape:',
    '{',
    '"project_summary": "string",',
    '"world_foundation": "string",',
    '"design_rules": ["string"],',
    '"material_palette": ["string"],',
    '"spatial_logic": ["string"],',
    '"camera_strategy": "string",',
    '"continuation_hooks": ["string"],',
    '"exploration_passes": [',
    '{"key":"anchor","label":"Anchor Pass","goal":"string","prompt":"string"},',
    '{"key":"adjacent","label":"Adjacent Pass","goal":"string","prompt":"string"},',
    '{"key":"frontier","label":"Frontier Pass","goal":"string","prompt":"string"}',
    ']',
    '}',
    `Each prompt must be generation-ready for a single ${duration}-second production design exploration video.`,
    'Every prompt must preserve world continuity while defining camera path, environment staging, materials, lighting, atmosphere, and design intent.',
    'The anchor pass should lock the world identity, the adjacent pass should expand it without breaking continuity, and the frontier pass should test a bolder but still believable edge of the same design system.',
    'Keep the output specific, production-oriented, and directly usable.',
  ].join(' ');
};

const buildResearchUserPrompt = ({
  prompt,
  sourceMaterials,
  designRules,
  ruleGroups,
  explorationGoal,
  continuityNotes,
  sourceImages,
  sourceVideos,
  continuationImages,
  continuationVideos,
  continuedFrom,
}) => {
  return [
    `Core brief: ${String(prompt || '').trim()}`,
    `Source materials: ${String(sourceMaterials || '').trim() || 'None provided.'}`,
    `Natural-language rules: ${String(designRules || '').trim() || 'None provided.'}`,
    `Structured world rules: ${ruleGroups && Object.keys(ruleGroups).length ? JSON.stringify(ruleGroups) : 'None provided.'}`,
    `Exploration goal: ${String(explorationGoal || '').trim() || 'Define the world through exploratory camera movement.'}`,
    `Continuation notes: ${String(continuityNotes || '').trim() || 'Preserve continuity for future iterations.'}`,
    `Source images attached: ${Array.isArray(sourceImages) ? sourceImages.length : 0}`,
    `Source videos attached: ${Array.isArray(sourceVideos) ? sourceVideos.length : 0}`,
    `Continuation images attached: ${Array.isArray(continuationImages) ? continuationImages.length : 0}`,
    `Continuation videos attached: ${Array.isArray(continuationVideos) ? continuationVideos.length : 0}`,
    `Continued from: ${continuedFrom ? JSON.stringify(continuedFrom) : 'Fresh exploration run.'}`,
  ].join('\n\n');
};

const normalizeResearchPlan = (plan) => {
  const passesFromPlan = Array.isArray(plan?.exploration_passes) ? plan.exploration_passes : [];

  const explorationPasses = EXPLORATION_VARIANTS.map((variant, index) => {
    const source = passesFromPlan.find((item) => item?.key === variant.key) || passesFromPlan[index] || {};
    return {
      key: variant.key,
      label: variant.label,
      goal: String(source.goal || variant.directive).trim(),
      prompt: String(source.prompt || '').trim(),
      directive: variant.directive,
    };
  });

  return {
    projectSummary: String(plan?.project_summary || '').trim(),
    worldFoundation: String(plan?.world_foundation || '').trim(),
    designRules: toArray(plan?.design_rules),
    materialPalette: toArray(plan?.material_palette),
    spatialLogic: toArray(plan?.spatial_logic),
    cameraStrategy: String(plan?.camera_strategy || '').trim(),
    continuationHooks: toArray(plan?.continuation_hooks),
    explorationPasses,
  };
};

const buildSeedancePayload = ({ model, prompt, ratio, duration, resolution }) => ({
  model,
  content: [
    {
      type: 'text',
      text: prompt,
    },
  ],
  resolution,
  ratio,
  duration,
  watermark: false,
  generate_audio: false,
});

const addResearchMediaInputs = (inputContent, mediaItems = [], type) => {
  mediaItems.filter(Boolean).forEach((url) => {
    if (type === 'image') {
      inputContent.push({
        type: 'input_image',
        image_url: url,
      });
      return;
    }

    inputContent.push({
      type: 'input_video',
      video_url: url,
    });
  });
};

const buildProductionReferenceMedia = ({
  sourceImages = [],
  sourceVideos = [],
  continuationImages = [],
  continuationVideos = [],
}) => {
  const media = [];
  [...sourceImages, ...continuationImages].filter(Boolean).forEach((url) => {
    media.push({
      type: 'image_url',
      image_url: { url },
      role: 'reference_image',
    });
  });
  [...sourceVideos, ...continuationVideos].filter(Boolean).forEach((url) => {
    media.push({
      type: 'video_url',
      video_url: { url },
      role: 'reference_video',
    });
  });
  return media;
};

async function researchPlan({
  apiKey,
  baseUrl,
  prompt,
  sourceMaterials,
  designRules,
  ruleGroups,
  explorationGoal,
  continuityNotes,
  sourceImages,
  sourceVideos,
  continuationImages,
  continuationVideos,
  continuedFrom,
  duration,
  modelId = DEFAULT_RESEARCH_MODEL,
}) {
  // #region debug-point E:request-shape
  reportDebugEvent({
    hypothesisId: 'E',
    location: 'pages/api/production-design.js:researchPlan:start',
    msg: '[DEBUG] production-design research request started',
    data: {
      baseUrl,
      modelId,
      duration,
      promptLength: String(prompt || '').length,
      sourceMaterialsLength: String(sourceMaterials || '').length,
      designRulesLength: String(designRules || '').length,
      explorationGoalLength: String(explorationGoal || '').length,
      continuityNotesLength: String(continuityNotes || '').length,
      sourceImageCount: Array.isArray(sourceImages) ? sourceImages.length : 0,
      sourceVideoCount: Array.isArray(sourceVideos) ? sourceVideos.length : 0,
      continuationImageCount: Array.isArray(continuationImages) ? continuationImages.length : 0,
      continuationVideoCount: Array.isArray(continuationVideos) ? continuationVideos.length : 0,
    },
  });
  // #endregion
  const inputContent = [
    {
      type: 'input_text',
      text: buildResearchUserPrompt({
        prompt,
        sourceMaterials,
        designRules,
        ruleGroups,
        explorationGoal,
        continuityNotes,
        sourceImages,
        sourceVideos,
        continuationImages,
        continuationVideos,
        continuedFrom,
      }),
    },
  ];
  addResearchMediaInputs(inputContent, sourceImages, 'image');
  addResearchMediaInputs(inputContent, sourceVideos, 'video');
  addResearchMediaInputs(inputContent, continuationImages, 'image');
  addResearchMediaInputs(inputContent, continuationVideos, 'video');
  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      stream: false,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: buildResearchSystemPrompt(duration),
            },
          ],
        },
        {
          role: 'user',
          content: inputContent,
        },
      ],
    }),
  });

  // #region debug-point A:upstream-status
  reportDebugEvent({
    hypothesisId: 'A',
    location: 'pages/api/production-design.js:researchPlan:response',
    msg: '[DEBUG] production-design research upstream response received',
    data: {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers?.get?.('content-type') || null,
    },
  });
  // #endregion

  const data = await response.json();
  // #region debug-point B:response-shape
  reportDebugEvent({
    hypothesisId: 'B',
    location: 'pages/api/production-design.js:researchPlan:data',
    msg: '[DEBUG] production-design research upstream body parsed',
    data: {
      topLevelKeys: Object.keys(data || {}),
      hasOutputText: Boolean(data?.output_text),
      outputLength: Array.isArray(data?.output) ? data.output.length : 0,
      firstOutputContentTypes: Array.isArray(data?.output?.[0]?.content)
        ? data.output[0].content.map((item) => item?.type).filter(Boolean)
        : [],
      outputItems: Array.isArray(data?.output)
        ? data.output.map((item, index) => ({
            index,
            type: item?.type,
            role: item?.role,
            status: item?.status,
            contentTypes: Array.isArray(item?.content)
              ? item.content.map((contentItem) => contentItem?.type).filter(Boolean)
              : [],
          }))
        : [],
    },
  });
  // #endregion
  if (!response.ok) {
    throw new Error(data.error?.message || data.details || `Production design research failed: ${response.status}`);
  }

  const researchText = extractResponseText(data).trim();
  // #region debug-point D:extract-text
  reportDebugEvent({
    hypothesisId: 'D',
    location: 'pages/api/production-design.js:researchPlan:extractResponseText',
    msg: '[DEBUG] production-design research text extracted',
    data: {
      extractedLength: researchText.length,
      extractedPreview: researchText.slice(0, 300),
    },
  });
  // #endregion
  const parsedPlan = parseJsonResponse(researchText);
  const normalizedPlan = normalizeResearchPlan(parsedPlan);

  normalizedPlan.explorationPasses.forEach((pass) => {
    if (!pass.prompt) {
      throw new Error(`Research plan did not return a usable prompt for ${pass.label}.`);
    }
  });

  return {
    researchText,
    normalizedPlan,
    raw: data,
  };
}

async function createSeedanceTask({ apiKey, baseUrl, payload }) {
  const response = await fetch(`${baseUrl}/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || data.details || `Seedance request failed: ${response.status}`);
  }

  if (!data.id) {
    throw new Error('Seedance response did not include a task id.');
  }

  return data;
}

const buildVariantPrompt = ({ pass, plan, continuityNotes }) => {
  const rulesBlock = plan.designRules.length
    ? `Design rules to preserve:\n- ${plan.designRules.join('\n- ')}`
    : '';
  const materialBlock = plan.materialPalette.length
    ? `Material palette:\n- ${plan.materialPalette.join('\n- ')}`
    : '';
  const continuityBlock = plan.continuationHooks.length
    ? `Continuation hooks:\n- ${plan.continuationHooks.join('\n- ')}`
    : '';

  return [
    `Exploration pass: ${pass.label}`,
    `Exploration goal: ${pass.goal}`,
    '',
    pass.prompt,
    '',
    `Pass intent: ${pass.directive}`,
    rulesBlock,
    materialBlock,
    plan.cameraStrategy ? `Camera strategy: ${plan.cameraStrategy}` : '',
    continuityBlock,
    continuityNotes ? `User continuation notes: ${continuityNotes}` : '',
    'Keep the world consistent enough that a later pass can continue exploring this environment without resetting the design language.',
  ]
    .filter(Boolean)
    .join('\n');
};

export default async function productionDesignHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const {
    apiKey,
    baseUrl,
    prompt,
    sourceMaterials,
    designRules,
    ruleGroups,
    explorationGoal,
    continuityNotes,
    sourceImages = [],
    sourceVideos = [],
    continuationImages = [],
    continuationVideos = [],
    continuedFrom = null,
    model = DEFAULT_SEEDANCE_MODEL,
    ratio = '16:9',
    resolution = '1080p',
    duration = 15,
  } = req.body || {};

  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ error: 'Core brief is required' });
  }

  const token = apiKey || process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const endpointBase = (baseUrl || CONFIG.API_BASE_URL).replace(/\/+$/, '');
  const normalizedDuration = clampDuration(duration);
  const normalizedResolution = resolution === '1080p' ? '1080p' : '1080p';

  try {
    const { researchText, normalizedPlan, raw } = await researchPlan({
      apiKey: token,
      baseUrl: endpointBase,
      prompt: String(prompt).trim(),
      sourceMaterials,
      designRules,
      ruleGroups,
      explorationGoal,
      continuityNotes,
      sourceImages,
      sourceVideos,
      continuationImages,
      continuationVideos,
      continuedFrom,
      duration: normalizedDuration,
    });

    const sharedReferenceMedia = buildProductionReferenceMedia({
      sourceImages,
      sourceVideos,
      continuationImages,
      continuationVideos,
    });

    const tasks = await Promise.all(
      normalizedPlan.explorationPasses.map(async (pass) => {
        const variantPrompt = buildVariantPrompt({
          pass,
          plan: normalizedPlan,
          continuityNotes: String(continuityNotes || '').trim(),
        });
        const payload = buildSeedancePayload({
          model,
          prompt: variantPrompt,
          ratio,
          duration: normalizedDuration,
          resolution: normalizedResolution,
        });
        if (sharedReferenceMedia.length > 0) {
          payload.content = [...payload.content, ...sharedReferenceMedia];
        }
        const task = await createSeedanceTask({
          apiKey: token,
          baseUrl: endpointBase,
          payload,
        });

        return {
          key: pass.key,
          label: pass.label,
          goal: pass.goal,
          directive: pass.directive,
          prompt: variantPrompt,
          task,
        };
      })
    );

    return res.status(200).json({
      researchModel: DEFAULT_RESEARCH_MODEL,
      researchText,
      projectSummary: normalizedPlan.projectSummary,
      worldFoundation: normalizedPlan.worldFoundation,
      designRules: normalizedPlan.designRules,
      materialPalette: normalizedPlan.materialPalette,
      spatialLogic: normalizedPlan.spatialLogic,
      cameraStrategy: normalizedPlan.cameraStrategy,
      continuationHooks: normalizedPlan.continuationHooks,
      duration: normalizedDuration,
      resolution: normalizedResolution,
      ratio,
      rawResearch: raw,
      tasks: tasks.map((item) => ({
        key: item.key,
        label: item.label,
        goal: item.goal,
        directive: item.directive,
        prompt: item.prompt,
        task: item.task,
      })),
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Production design generation failed',
      details: error.message,
    });
  }
}
