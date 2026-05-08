import modelsData from './models.json';

const DEFAULT_SEEDANCE_MODEL = 'ep-20260415171928-pdvvr';
const DEFAULT_SEEDREAM_MODEL = 'seedream-5-0-260128';

// Helper to filter models from the JSON
const getModelsByFilter = (filterFn) => {
    const models = modelsData.data || [];
    // Sort by created date descending
    models.sort((a, b) => (b.created || 0) - (a.created || 0));
    return models.filter(filterFn).map(m => m.id);
};

// Seedream Models
const seedreamModels = getModelsByFilter(m => m.id === DEFAULT_SEEDREAM_MODEL);

// Seedance Models
const seedanceModels = getModelsByFilter(m => 
    (m.domain === 'VideoGeneration' || 
    (m.task_type && (m.task_type.includes('ImageToVideo') || m.task_type.includes('TextToVideo'))) ||
    m.id.startsWith('seedance')) &&
    !m.id.startsWith('seedream') && !m.id.startsWith('seededit')
);

// LLM Models (Only Seed)
const llmModels = getModelsByFilter(m => 
    (m.id.startsWith('seed-2-0') || m.id.startsWith('seed-1-8') )
);

export const baseSchemas = {
  seedream: {
    id: 'seedream',
    name: 'Seedream Image',
    description: 'Seedream images/generations',
    fields: [
      {
        key: 'model',
        label: 'Model',
        type: 'enum',
        options: seedreamModels.length > 0 ? seedreamModels : [DEFAULT_SEEDREAM_MODEL],
        defaultValue: DEFAULT_SEEDREAM_MODEL,
        description: 'Seedream model id used for generation.',
      },
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'text',
        required: true,
        description: 'Primary text prompt. Max ~600 words.',
      },
      {
        key: 'image',
        label: 'Reference Images',
        type: 'image-list',
        description: 'Optional reference images (URL or Base64). Up to 14 images for multi-image blending.',
      },
      {
        key: 'size',
        label: 'Size',
        type: 'enum',
        options: ['2K', '4K'],
        defaultValue: '2K',
        description: 'Output resolution used by the workflow-style image payload.',
      },
    ],
    defaults: {
      model: DEFAULT_SEEDREAM_MODEL,
      prompt: 'A hero product shot of a premium skincare bottle on a minimal studio set.',
      size: '2K',
      image: [],
    },
  },
  llm: {
    id: 'llm',
    name: 'AI Analysis',
    description: 'Multimodal AI for text, image, and video analysis.',
    fields: [
      {
        key: 'model',
        label: 'Model',
        type: 'enum',
        options: llmModels.length > 0 ? llmModels : [
            'seed-2-0-mini-260215'
        ],
        defaultValue: llmModels.length > 0 ? llmModels[0] : 'seed-2-0-mini-260215',
        description: 'LLM model id used for analysis.',
      },
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'text',
        required: true,
        description: 'Text prompt for the analysis.',
      },
      {
        key: 'image',
        label: 'Image',
        type: 'image-list',
        description: 'Image to analyze.',
      },
      {
        key: 'video',
        label: 'Video',
        type: 'video-list', 
        description: 'Video to analyze.',
      },
    ],
    defaults: {
      model: llmModels.length > 0 ? llmModels[0] : 'seed-2-0-mini-260215',
      prompt: 'Describe this content.',
      image: [],
      video: [],
    },
  },
  seedance: {
    id: 'seedance',
    name: 'Seedance Video',
    description: 'Seedance video generation',
    fields: [
      {
        key: 'model',
        label: 'Model',
        type: 'enum',
        options: seedanceModels.length > 0 ? seedanceModels : [
            // Seedance Models Only
            DEFAULT_SEEDANCE_MODEL,
            'seedance-1-5-pro-251215'
        ],
        defaultValue: seedanceModels.includes(DEFAULT_SEEDANCE_MODEL)
          ? DEFAULT_SEEDANCE_MODEL
          : (seedanceModels.length > 0 ? seedanceModels[0] : DEFAULT_SEEDANCE_MODEL),
        description: 'Seedance model id used for video generation.',
      },
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'text',
        required: true,
        description: 'Text prompt describing the video content.',
      },
      {
        key: 'reference_images',
        label: 'Reference Images',
        type: 'image-list',
        description: 'Reference images (1-4) for Seedance 1.0 Lite I2V and Seedance 2.0.',
      },
      {
        key: 'reference_videos',
        label: 'Reference Videos',
        type: 'video-list',
        description: 'Reference video for Video-to-Video generation (Seedance 2.0).',
      },
      {
        key: 'reference_audios',
        label: 'Reference Audio',
        type: 'audio-list',
        description: 'Reference audio for generation (Seedance 2.0).',
      },
      {
        key: 'resolution',
        label: 'Resolution',
        type: 'enum',
        options: ['480p', '720p', '1080p'],
        defaultValue: '720p',
        description: 'Resolution of the output video.',
      },
      {
        key: 'ratio',
        label: 'Aspect Ratio',
        type: 'enum',
        options: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
        defaultValue: '16:9',
        description: 'Aspect ratio of the output video.',
      },
      {
        key: 'duration',
        label: 'Duration (seconds)',
        type: 'enum',
        options: [2, 4, 5, 10, 11, 12],
        defaultValue: 5,
        description: 'Video duration in seconds (2-12s). -1 for auto (1.5 pro only).',
      },
      {
        key: 'seed',
        label: 'Seed',
        type: 'number',
        defaultValue: -1,
        description: 'Random seed (-1 for random).',
      },
      {
        key: 'generate_audio',
        label: 'Generate Audio',
        type: 'boolean',
        defaultValue: true,
        description: 'Generate synchronized audio (1.5 pro only).',
      },
      {
        key: 'watermark',
        label: 'Watermark',
        type: 'boolean',
        defaultValue: false,
        description: 'Add watermark to output video.',
      },
    ],
    defaults: {
      model: seedanceModels.includes(DEFAULT_SEEDANCE_MODEL)
        ? DEFAULT_SEEDANCE_MODEL
        : (seedanceModels.length > 0 ? seedanceModels[0] : DEFAULT_SEEDANCE_MODEL),
      prompt: 'A cinematic shot of a futuristic city with flying cars.',
      reference_images: [],
      reference_videos: [],
      reference_audios: [],
      resolution: '720p',
      ratio: '16:9',
      duration: 5,
      seed: -1,
      generate_audio: true,
      watermark: false,
    },
  },
  'production-design': {
    id: 'production-design',
    name: 'Production Design',
    description: 'Research a world-design brief, turn it into natural-language design rules, and generate repeatable video explorations for ongoing environment discovery.',
    fields: [
      {
        key: 'model',
        label: 'Model',
        type: 'enum',
        options: seedanceModels.includes(DEFAULT_SEEDANCE_MODEL)
          ? [DEFAULT_SEEDANCE_MODEL, ...seedanceModels.filter((modelId) => modelId !== DEFAULT_SEEDANCE_MODEL)]
          : (seedanceModels.length > 0 ? seedanceModels : [DEFAULT_SEEDANCE_MODEL]),
        defaultValue: seedanceModels.includes(DEFAULT_SEEDANCE_MODEL)
          ? DEFAULT_SEEDANCE_MODEL
          : (seedanceModels.length > 0 ? seedanceModels[0] : DEFAULT_SEEDANCE_MODEL),
        description: 'Seedance model used for all production design exploration passes.',
      },
      {
        key: 'prompt',
        label: 'Core Brief',
        type: 'text',
        required: true,
        description: 'What the production designer is trying to define, including the world, mood, and design challenge.',
      },
      {
        key: 'sourceMaterials',
        label: 'Source Materials',
        type: 'text',
        description: 'Describe the sketch, AI imagery, paintovers, and any existing visual development artifacts.',
      },
      {
        key: 'designRules',
        label: 'Design Rules',
        type: 'text',
        description: 'Natural-language constraints the agent should preserve across explorations.',
      },
      {
        key: 'explorationGoal',
        label: 'Exploration Goal',
        type: 'text',
        description: 'What this round should explore, test, or uncover in the world.',
      },
      {
        key: 'continuityNotes',
        label: 'Continuation Notes',
        type: 'text',
        description: 'Details that help the next iteration continue world exploration without losing continuity.',
      },
      {
        key: 'ratio',
        label: 'Aspect Ratio',
        type: 'enum',
        options: ['16:9', '9:16', '1:1'],
        defaultValue: '16:9',
        description: 'Aspect ratio used for all three variants.',
      },
      {
        key: 'resolution',
        label: 'Resolution',
        type: 'enum',
        options: ['1080p'],
        defaultValue: '1080p',
        description: 'Locked default output quality.',
      },
      {
        key: 'duration',
        label: 'Duration (seconds)',
        type: 'enum',
        options: [15],
        defaultValue: 15,
        description: 'Locked maximum duration.',
      },
    ],
    defaults: {
      model: seedanceModels.includes(DEFAULT_SEEDANCE_MODEL)
        ? DEFAULT_SEEDANCE_MODEL
        : (seedanceModels.length > 0 ? seedanceModels[0] : DEFAULT_SEEDANCE_MODEL),
      prompt: 'Build the production design for a weathered cliffside observatory city carved into black volcanic stone, with cable lifts, wind-battered banners, and a sense of ancient scientific purpose.',
      sourceMaterials: 'Sketch: loose graphite thumbnail showing stacked observatory terraces and a central tower. AI imagery: moody overcast variations with wet stone, hanging lanterns, and deep chasms. Paintover: emphasized asymmetry, giant lens housings, and stronger foreground railings.',
      designRules: 'Preserve monumental scale, believable circulation paths, tactile materials, and a lived-in scientific culture. Avoid generic sci-fi gloss. Keep architecture rooted in stone, brass, oxidized copper, canvas, and fog-softened glass.',
      ruleGroups: {
        architecture: 'Tiered terraces, strong vertical hierarchy, and clear circulation routes linking public, industrial, and scholarly zones.',
        materials: 'Black volcanic stone, oxidized brass, weathered canvas, fogged glass, and salt-worn metal hardware.',
        culture: 'Signs of a long-lived scientific society: maintenance access, observation platforms, weatherproof equipment, and ritualized civic gathering spaces.',
        camera: 'Gliding travel that reveals elevation change, landmark hierarchy, and how one district leads into the next.',
        guards: 'No sleek generic sci-fi skins. Preserve tactile scale, weathering, and landmark silhouettes from pass to pass.',
      },
      explorationGoal: 'Define how a camera can move through the environment to reveal hierarchy, material language, and the relationship between public terraces and the main observatory tower.',
      continuityNotes: 'Keep landmark silhouettes and material palette stable so later passes can continue exploring adjacent districts and alternate weather conditions without resetting the world.',
      sourceImages: [],
      sourceVideos: [],
      continuationImages: [],
      continuationVideos: [],
      continuedFrom: null,
      ratio: '16:9',
      resolution: '1080p',
      duration: 15,
    },
  },
};

export const apiKeyStorageKey = 'modelark_api_key';
