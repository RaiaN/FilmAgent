import { CONFIG } from '../../utils/config';
import { getModel } from '../../utils/film/suiteConfig';

// Env-resolved (MODELARK_MODEL_REASONER / MODELARK_MODEL_SEEDREAM) — endpoint ids are
// account-scoped, so nothing here may be a literal. getModel throws a clear
// name-the-variable error when a slot is unconfigured; surfaced as a 500 below.
const researchModel = () => getModel('reasoner');
const seedreamModel = () => getModel('seedream');
const PRODUCTION_DESIGN_IMAGE_SIZE = '4K';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
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

const addInputImages = (inputContent, mediaItems = []) => {
  mediaItems.filter(Boolean).forEach((url) => {
    inputContent.push({
      type: 'input_image',
      image_url: url,
    });
  });
};

async function callSeed2Prompt({
  apiKey,
  baseUrl,
  systemText,
  userText,
  inputImages = [],
  modelId = researchModel(),
}) {
  const inputContent = [
    {
      type: 'input_text',
      text: userText,
    },
  ];
  addInputImages(inputContent, inputImages);

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
              text: systemText,
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
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || data.details || `Seed 2.0 prompt synthesis failed: ${response.status}`);
  }

  const promptText = extractResponseText(data).trim();
  if (!promptText) {
    throw new Error('Seed 2.0 prompt synthesis returned an empty response.');
  }
  return {
    text: promptText,
    raw: data,
  };
}

async function generateSeedreamImage({ apiKey, baseUrl, prompt, referenceImage }) {
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: seedreamModel(),
      prompt,
      size: PRODUCTION_DESIGN_IMAGE_SIZE,
      watermark: false,
      response_format: 'url',
      ...(referenceImage ? { image: referenceImage } : {}),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || data.details || `Seedream request failed: ${response.status}`);
  }
  if (!Array.isArray(data?.data) || !data.data[0]?.url) {
    throw new Error('Seedream response did not include an image URL.');
  }
  return {
    imageUrl: data.data[0].url,
    raw: data,
  };
}

const buildStepOneSystemPrompt = () => {
  return [
    'You convert fictional character descriptions into one production-ready Seedream portrait prompt.',
    'Return prompt only. No markdown. No explanations.',
    'Use exactly these bracketed sections and this exact order:',
    '[MEDIUM] [SUBJECT] [CAMERA] [SKIN_REFLECTANCE] [HAIR] [EXPRESSION] [FORBIDDEN].',
    'Write in the same style as a premium photoreal editorial image prompt.',
    'The output must describe exactly one fictional character in a frontal close shot with photorealistic textures.',
    'The generated image must contain no text, no letters, no numbers, no logos, no watermarks, and no typographic elements of any kind.',
    'Do not include any extra bracket sections.',
  ].join(' ');
};

const buildStepOneUserPrompt = (characterDescription) => {
  return [
    'Transform the following fictional character description into the required bracketed format.',
    'Keep the output photorealistic, fashion/editorial, and suitable for a single close portrait image.',
    '',
    characterDescription,
  ].join('\n');
};

const buildCharacterSheetConversionSystemPrompt = () => {
  return [
    'You convert a portrait reference into a single Seedream prompt for a character sheet image.',
    'Return prompt only. No markdown. No explanations.',
    'Preserve all important identity details from the portrait exactly, including facial structure, skin texture, hair, age, ethnicity, expression logic, and photoreal surface detail.',
    'Also preserve wardrobe design continuity, including garment types, silhouette, material feel, accessories, and color palette.',
    'Do not replace the wardrobe with generic black clothing or simplify it to an all-black outfit unless black clothing is explicitly established by the source description or portrait.',
    'The generated image must contain no text, no letters, no numbers, no logos, no watermarks, no captions, and no typographic elements of any kind.',
  ].join(' ');
};

const buildCloseSheetInstruction = ({ characterDescription, portraitPrompt }) => {
  return [
    'Given the portrait, provide a single prompt to generate a full character sheet for AI native movie.',
    'The character sheet must preserve all important details and contain 2 view angles, front and side, close shot.',
    `Original character description: ${characterDescription}`,
    `Portrait anchor prompt: ${portraitPrompt}`,
    'Keep wardrobe continuity with the source character concept and portrait anchor. Preserve clothing colors, materials, accessories, and design logic.',
    'If the portrait framing hides parts of the outfit, infer the unseen portions from the source character description and the visible styling cues instead of defaulting to plain black clothing.',
    'No text, labels, captions, logos, numbers, or watermark-like marks. Neutral solid gray background. Output prompt only.',
  ].join('\n');
};

const buildDistantSheetInstruction = ({ characterDescription, portraitPrompt }) => {
  return [
    'Given the portrait, provide a single prompt to generate a full character sheet for AI native movie.',
    'The character sheet must preserve all important details and contain 2 view angles, front and side, distant shot.',
    `Original character description: ${characterDescription}`,
    `Portrait anchor prompt: ${portraitPrompt}`,
    'Preserve clothing colors, garment types, materials, accessories, and styling logic from the character concept and portrait anchor.',
    'If the portrait does not show the full outfit, infer a coherent full-body wardrobe from the source character description and the visible portrait styling. Never default to generic black clothing unless black is explicitly part of the established design.',
    'This must be a true full-body turnaround: show the entire figure from head to toe in both views, including shoes or feet, with no cropping at the knees, thighs, waist, shoulders, or top of head.',
    'The camera must be far enough away that the full silhouette is clearly visible in both views with a small amount of neutral gray negative space around the body.',
    'Scale-match the two views and align them like a production character sheet for an AI native movie.',
    'No text, labels, captions, logos, numbers, or watermark-like marks. Neutral solid gray background. Output prompt only.',
  ].join('\n');
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
    continuedFrom = null,
  } = req.body || {};

  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ error: 'Fictional character description is required' });
  }

  const token = apiKey || process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const endpointBase = (baseUrl || CONFIG.API_BASE_URL).replace(/\/+$/, '');

  try {
    const normalizedPrompt = String(prompt).trim();
    const stepOnePrompt = await callSeed2Prompt({
      apiKey: token,
      baseUrl: endpointBase,
      systemText: buildStepOneSystemPrompt(),
      userText: buildStepOneUserPrompt(normalizedPrompt),
    });

    const portraitImage = await generateSeedreamImage({
      apiKey: token,
      baseUrl: endpointBase,
      prompt: stepOnePrompt.text,
    });

    const stepTwoPrompt = await callSeed2Prompt({
      apiKey: token,
      baseUrl: endpointBase,
      systemText: buildCharacterSheetConversionSystemPrompt(),
      userText: buildCloseSheetInstruction({
        characterDescription: normalizedPrompt,
        portraitPrompt: stepOnePrompt.text,
      }),
      inputImages: [portraitImage.imageUrl],
    });

    const stepThreePrompt = await callSeed2Prompt({
      apiKey: token,
      baseUrl: endpointBase,
      systemText: buildCharacterSheetConversionSystemPrompt(),
      userText: buildDistantSheetInstruction({
        characterDescription: normalizedPrompt,
        portraitPrompt: stepOnePrompt.text,
      }),
      inputImages: [portraitImage.imageUrl],
    });

    const closeSheetImage = await generateSeedreamImage({
      apiKey: token,
      baseUrl: endpointBase,
      prompt: stepTwoPrompt.text,
      referenceImage: portraitImage.imageUrl,
    });

    const distantSheetImage = await generateSeedreamImage({
      apiKey: token,
      baseUrl: endpointBase,
      prompt: stepThreePrompt.text,
      referenceImage: portraitImage.imageUrl,
    });

    const steps = [
      {
        key: 'portrait-anchor',
        label: 'Step 1: Portrait Anchor',
        description: 'One photorealistic frontal close shot generated from the Seed 2.0 Pro formatted prompt.',
        prompt: stepOnePrompt.text,
        imageUrl: portraitImage.imageUrl,
      },
      {
        key: 'close-sheet',
        label: 'Step 2: Close Character Sheet',
        description: 'Two close shots of the same character, frontal and side profile, preserving the portrait identity.',
        prompt: stepTwoPrompt.text,
        imageUrl: closeSheetImage.imageUrl,
        referenceImageUrl: portraitImage.imageUrl,
      },
      {
        key: 'distant-sheet',
        label: 'Step 3: Full-Body Character Sheet',
        description: 'Two true full-body shots of the same character, frontal and side profile, shown head-to-toe using the portrait anchor URI.',
        prompt: stepThreePrompt.text,
        imageUrl: distantSheetImage.imageUrl,
        referenceImageUrl: portraitImage.imageUrl,
      },
    ];

    return res.status(200).json({
      researchModel: researchModel(),
      generationModel: seedreamModel(),
      size: PRODUCTION_DESIGN_IMAGE_SIZE,
      inputPrompt: normalizedPrompt,
      characterPrompt: stepOnePrompt.text,
      portrait: {
        prompt: stepOnePrompt.text,
        imageUrl: portraitImage.imageUrl,
      },
      closeSheet: {
        prompt: stepTwoPrompt.text,
        imageUrl: closeSheetImage.imageUrl,
        referenceImageUrl: portraitImage.imageUrl,
      },
      distantSheet: {
        prompt: stepThreePrompt.text,
        imageUrl: distantSheetImage.imageUrl,
        referenceImageUrl: portraitImage.imageUrl,
      },
      promptTrace: {
        stepOne: stepOnePrompt.raw,
        stepTwo: stepTwoPrompt.raw,
        stepThree: stepThreePrompt.raw,
      },
      steps,
      continuedFrom,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Production design generation failed',
      details: error.message,
    });
  }
}
