import modelsData from './models.json';
import { generateAssetGroupId } from './assetGroupId';

const DEFAULT_SEEDANCE_MODEL = 'ep-20260415171928-pdvvr';
const DEFAULT_SEEDREAM_MODEL = 'ep-20260501195034-hj78f';

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
            DEFAULT_SEEDANCE_MODEL
        ],
        defaultValue: DEFAULT_SEEDANCE_MODEL,
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
        description: 'Reference images (1-4) for Seedance 1.0 Lite I2V and Seedance 2.0. Use public URLs or local files to be staged via TOS.',
      },
      {
        key: 'reference_image_asset_ids',
        label: 'Reference Image Asset IDs',
        type: 'text-list',
        description: 'Seedance 2.0 image references can also come from Asset IDs created in the Asset Upload tab.',
      },
      {
        key: 'reference_videos',
        label: 'Reference Videos',
        type: 'video-list',
        description: 'Reference video for Video-to-Video generation (Seedance 2.0). Use a public http(s) URL or upload a local file to be staged via TOS.',
      },
      {
        key: 'reference_audios',
        label: 'Reference Audio',
        type: 'audio-list',
        description: 'Reference audio for generation (Seedance 2.0). Use a public http(s) URL or upload a local file to be staged via TOS.',
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
      reference_image_asset_ids: [],
      reference_videos: [],
      reference_audios: [],
      resolution: '720p',
      ratio: '16:9',
      duration: 5,
      parallelCount: 1,
      seed: -1,
      generate_audio: true,
      watermark: false,
    },
  },
  'production-design': {
    id: 'production-design',
    name: 'Production Design',
    description: 'Build an AI-native movie character pipeline: generate a portrait anchor, expand it into close and full-body character sheets, and optionally combine clothing direction.',
    fields: [
      {
        key: 'model',
        label: 'Model',
        type: 'enum',
        options: seedreamModels.length > 0 ? seedreamModels : [DEFAULT_SEEDREAM_MODEL],
        defaultValue: DEFAULT_SEEDREAM_MODEL,
        description: 'Display model for the character-sheet workflow. Generation is locked to the Seedream 5.0 endpoint.',
      },
      {
        key: 'prompt',
        label: 'Fictional Character Description',
        type: 'text',
        required: true,
        description: 'Describe the fictional character in plain language. Seed 2.0 Pro transforms this into the structured editorial portrait prompt used for step 1.',
      },
    ],
    defaults: {
      model: DEFAULT_SEEDREAM_MODEL,
      prompt: 'A fictional lead character for an AI-native movie: a young Scandinavian woman in her early 30s with a tall narrow face, sharp cheekbones, a long straight nose, blonde hair, and a direct, composed presence. Fashion editorial realism, photoreal textures, no retouching.',
      continuedFrom: null,
    },
  },
  'asset-upload': {
    id: 'asset-upload',
    name: 'Asset Upload',
    description: 'Upload image assets into the ModelArk private virtual portrait library using AK/SK authentication and the Assets APIs.',
    fields: [
      {
        key: 'assetGroupId',
        label: 'Asset Group ID',
        type: 'text',
        description: 'The upload always uses this existing asset group id.',
      },
      {
        key: 'imageUrl',
        label: 'Image URL',
        type: 'text',
        description: 'Optional. If provided, the Assets API uses this public image URL directly. Leave it empty when staging a local image to TOS first.',
      },
      {
        key: 'assetName',
        label: 'Asset Name',
        type: 'text',
        description: 'Optional asset label used for management and fuzzy search.',
      },
      {
        key: 'pollUntilReady',
        label: 'Poll Until Ready',
        type: 'boolean',
        defaultValue: true,
        description: 'Poll GetAsset until the asset becomes Active or Failed.',
      },
    ],
    defaults: {
      assetGroupId: generateAssetGroupId(),
      imageUrl: '',
      assetName: '',
      localImageData: '',
      localImageName: '',
      pollUntilReady: true,
    },
  },
};

export const apiKeyStorageKey = 'modelark_api_key';
