import modelsData from './models.json';

// Helper to filter models from the JSON
const getModelsByFilter = (filterFn) => {
    const models = modelsData.data || [];
    // Sort by created date descending
    models.sort((a, b) => (b.created || 0) - (a.created || 0));
    return models.filter(filterFn).map(m => m.id);
};

// Seedream Models
const seedreamModels = getModelsByFilter(m => 
    m.domain === 'ImageGeneration' || 
    (m.task_type && (m.task_type.includes('TextToImage') || m.task_type.includes('ImageToImage'))) ||
    m.id.startsWith('seedream') || 
    m.id.startsWith('seededit')
);

// Seedance Models
const seedanceModels = getModelsByFilter(m => 
    (m.domain === 'VideoGeneration' || 
    (m.task_type && (m.task_type.includes('ImageToVideo') || m.task_type.includes('TextToVideo'))) ||
    m.id.startsWith('seedance')) &&
    !m.id.startsWith('seedream') && !m.id.startsWith('seededit')
);

// LLM Models (excluding DeepSeek, supporting BytePlus)
const llmModels = getModelsByFilter(m => 
    ((m.domain === 'LLM' || 
    m.domain === 'VLM' ||
    (m.task_type && (m.task_type.includes('TextGeneration') || m.task_type.includes('VisualQuestionAnswering'))) ||
    m.id.startsWith('doubao') || 
    m.id.startsWith('skylark') ||
    (m.id.startsWith('seed') && !m.id.startsWith('seedream') && !m.id.startsWith('seedance'))) &&
    !m.id.startsWith('deepseek'))
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
        options: seedreamModels.length > 0 ? seedreamModels : [
            'seedream-5-0-lite',
            'seedream-4-5-251128', 
            'seedream-4-0-250828', 
            'seedream-5-0-260128',
            'seedream-3-0-t2i',
            'seededit-3-0-i2i'
        ],
        defaultValue: seedreamModels.length > 0 ? seedreamModels[0] : 'seedream-5-0-lite',
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
        options: ['2K', '4K', 'Custom'],
        defaultValue: '2K',
        description: 'Output resolution. 2K=2048x2048 approx. Custom allows specific WxH.',
      },
      {
        key: 'width',
        label: 'Width (px)',
        type: 'number',
        hidden: true,
        description: 'Custom width in pixels.',
      },
      {
        key: 'height',
        label: 'Height (px)',
        type: 'number',
        hidden: true,
        description: 'Custom height in pixels.',
      },
      {
        key: 'watermark',
        label: 'Watermark',
        type: 'boolean',
        defaultValue: false,
        description: 'Whether to apply a watermark to the output.',
      },
      {
        key: 'sequential_image_generation',
        label: 'Sequential Generation',
        type: 'boolean',
        defaultValue: false,
        description: 'Generate multiple related images in sequence (auto).',
      },
      {
        key: 'sequential_max_images',
        label: 'Max Images (Batch)',
        type: 'number',
        defaultValue: 5,
        hidden: true, 
        description: 'Max images to generate (1-15). Only for sequential generation.',
      },
      {
        key: 'optimize_prompt_mode',
        label: 'Optimize Prompt Mode',
        type: 'enum',
        options: ['standard', 'fast'],
        defaultValue: 'standard',
        description: 'Prompt optimization mode (Standard/Fast).',
      },
      {
        key: 'output_format',
        label: 'Output Format',
        type: 'enum',
        options: ['jpeg', 'png'],
        defaultValue: 'jpeg',
        description: 'Output image format (5.0-lite only).',
      },
      {
        key: 'guidance_scale',
        label: 'Guidance Scale',
        type: 'number',
        defaultValue: 2.5,
        description: 'Controls prompt adherence (1-10). Only for 3.0 models.',
      },
      {
        key: 'seed',
        label: 'Seed',
        type: 'number',
        defaultValue: -1,
        description: 'Random seed (-1 for random).',
      },
      {
        key: 'response_format',
        label: 'Response Format',
        type: 'enum',
        options: ['url', 'b64_json'],
        defaultValue: 'url',
        description: 'Output format for the generated image.',
      },
    ],
    defaults: {
      model: seedreamModels.length > 0 ? seedreamModels[0] : 'seedream-5-0-lite',
      prompt: 'A hero product shot of a premium skincare bottle on a minimal studio set.',
      size: '2K',
      width: 2048,
      height: 2048,
      image: [],
      watermark: false,
      sequential_image_generation: false,
      sequential_max_images: 5,
      optimize_prompt_mode: 'standard',
      output_format: 'jpeg',
      guidance_scale: 2.5,
      seed: -1,
      response_format: 'url',
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
            'seedance-1-5-pro-251215',
            'seedance-1-0-pro',
            'seedance-pro-fast',
            'seedance-1-0-lite-t2v',
            'seedance-1-0-lite-i2v'
        ],
        defaultValue: seedanceModels.length > 0 ? seedanceModels[0] : 'seedance-1-5-pro-251215',
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
        key: 'first_frame',
        label: 'First Frame Image',
        type: 'image-list',
        description: 'First frame image for Image-to-Video generation (Single image).',
      },
      {
        key: 'last_frame',
        label: 'Last Frame Image',
        type: 'image-list',
        description: 'Last frame image for First-and-Last-Frame generation (Single image).',
      },
      {
        key: 'reference_images',
        label: 'Reference Images',
        type: 'image-list',
        description: 'Reference images (1-4) for Seedance 1.0 Lite I2V.',
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
        type: 'number',
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
        key: 'camera_fixed',
        label: 'Fix Camera',
        type: 'boolean',
        defaultValue: false,
        description: 'Attempt to keep camera fixed.',
      },
      {
        key: 'watermark',
        label: 'Watermark',
        type: 'boolean',
        defaultValue: false,
        description: 'Add watermark to output video.',
      },
      {
        key: 'draft',
        label: 'Draft Mode',
        type: 'boolean',
        defaultValue: false,
        description: 'Enable Draft sample mode (1.5 pro only) for cheaper/faster preview.',
      },
      {
        key: 'return_last_frame',
        label: 'Return Last Frame',
        type: 'boolean',
        defaultValue: false,
        description: 'Return the last frame image (useful for continuous generation).',
      },
    ],
    defaults: {
      model: 'seedance-1-5-pro-251215',
      prompt: 'A cinematic shot of a futuristic city with flying cars.',
      first_frame: [],
      last_frame: [],
      reference_images: [],
      resolution: '720p',
      ratio: '16:9',
      duration: 5,
      seed: -1,
      generate_audio: true,
      camera_fixed: false,
      watermark: false,
      draft: false,
      return_last_frame: false,
    },
  },
};

export const apiKeyStorageKey = 'modelark_api_key';
