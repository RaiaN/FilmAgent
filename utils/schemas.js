import { generateAssetGroupId } from './assetGroupId';
import { ROOT_CONFIG } from './film/suiteConfig';

// Seedream (image) endpoints for the Tools → Image dropdown — Lite + Pro. Endpoint ids
// come from the suite-config registry (ROOT_CONFIG.models) so the tab and the film suite
// share one source; `label` is the dropdown name. `.filter` drops any id not configured yet.
const DEFAULT_SEEDREAM_MODEL = ROOT_CONFIG.models.seedream;
const seedreamEndpoints = [
    { value: ROOT_CONFIG.models.seedream, label: 'Seedream 5.0 Lite' },
    { value: ROOT_CONFIG.models.seedreamPro, label: 'Seedream 5.0 Pro' },
].filter((o) => o.value);

// Seedance (video) endpoints for the Tools → Video dropdown. Endpoint ids come from
// the suite-config registry (ROOT_CONFIG.models) so they live in one place; `label`
// is the human name shown in the dropdown. `.filter` drops any id not configured yet.
const DEFAULT_SEEDANCE_MODEL = ROOT_CONFIG.models.seedance;
const seedanceEndpoints = [
    { value: ROOT_CONFIG.models.seedance, label: 'Seedance 2.0' },
    { value: ROOT_CONFIG.models.seedanceFast, label: 'Seedance 2.0 Fast' },
    { value: ROOT_CONFIG.models.seedanceMini, label: 'Seedance 2.0 Mini' },
].filter((o) => o.value);

// LLM Models — explicit list, newest first
const LLM_MODEL_IDS = [
    'seed-2-0-pro-260328',
    'seed-2-0-mini-260428',
    'seed-2-0-lite-260428',
];
const llmModels = LLM_MODEL_IDS;

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
        options: seedreamEndpoints,
        defaultValue: DEFAULT_SEEDREAM_MODEL,
        description: 'Seedream endpoint. Pro is the latest (up to 10 reference images) but caps output area at 2048² (no 4K); Lite allows 2K/4K and up to 6 refs.',
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
        description: 'Optional reference images (URL or Base64) for multi-image blending. Max depends on the model — 6 for Lite, 10 for Pro.',
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
      parallelCount: 1,
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
        options: llmModels,
        defaultValue: llmModels[0],
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
      model: llmModels[0],
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
        options: seedanceEndpoints,
        defaultValue: DEFAULT_SEEDANCE_MODEL,
        description: 'Seedance endpoint used for video generation. Fast trades a little fidelity for speed; Mini is the cheapest and caps at 720p.',
      },
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'text',
        required: true,
        description: 'Text prompt describing the video content.',
      },
      {
        key: 'reference_image_refs',
        label: 'Reference Images',
        type: 'image-ref-list',
        description: 'Reference images in insertion order. Each entry is either a URL/local file or an Asset ID. Order is preserved in the API payload, so [Image 1] in your prompt maps to the first entry here.',
      },
      {
        key: 'reference_video_refs',
        label: 'Reference Videos',
        type: 'video-ref-list',
        description: 'Reference videos in insertion order. Each entry is either a URL/local file or an Asset ID.',
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
        options: ['480p', '720p', '1080p', '4k'],
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
        options: ['auto', 2, 4, 5, 10, 11, 12],
        defaultValue: 'auto',
        description: 'Video duration in seconds, or "smart" to let the model decide.',
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
      model: DEFAULT_SEEDANCE_MODEL,
      prompt: 'A cinematic shot of a futuristic city with flying cars.',
      reference_image_refs: [],
      reference_video_refs: [],
      reference_audios: [],
      resolution: '720p',
      ratio: '16:9',
      duration: 'auto',
      parallelCount: 1,
      seed: -1,
      generate_audio: true,
      watermark: false,
    },
  },
  'film-agent': {
    id: 'film-agent',
    name: 'Film Agent',
    description: 'A freeform canvas for cinematic pre-production. Drop assets, then run agent layers — Inspiration Board, Character & Location Variations — to explore your film.',
    fields: [
      {
        key: 'idea',
        label: 'Film Idea',
        type: 'text',
        required: true,
        description: 'One- or two-sentence pitch. Genre, tone, and core conflict are all useful. The agent will expand this into a logline first.',
      },
      {
        key: 'language',
        label: 'Primary Language',
        type: 'enum',
        options: ['en', 'zh-CN', 'es', 'fr', 'de', 'ja', 'ko'],
        defaultValue: 'en',
        description: 'Language for dialogue, voice timbre, and on-screen text. Seedance 2.0 native audio renders in this language.',
      },
      {
        key: 'targetMinutes',
        label: 'Target Length (minutes)',
        type: 'enum',
        options: [3, 4, 5],
        defaultValue: 4,
        description: 'Total runtime. The shot list scales to fit.',
      },
    ],
    defaults: {
      idea: '',
      language: 'en',
      targetMinutes: 4,
      projectPath: '',
      projectId: null,
    },
  },
  speech: {
    id: 'speech',
    name: 'Seed Speech',
    description: 'Text-to-speech synthesis with Seed Speech 2.0 via BytePlus Voice API.',
    fields: [
      {
        key: 'speaker',
        label: 'Speaker (Voice ID)',
        type: 'text',
        required: true,
        description: 'Voice ID for synthesis.',
      },
      {
        key: 'text',
        label: 'Text',
        type: 'text',
        required: true,
        description: 'Text to synthesize.',
      },
      {
        key: 'format',
        label: 'Format',
        type: 'enum',
        options: ['mp3', 'ogg_opus', 'pcm'],
        defaultValue: 'mp3',
      },
      {
        key: 'sampleRate',
        label: 'Sample Rate (Hz)',
        type: 'enum',
        options: [8000, 16000, 24000, 48000],
        defaultValue: 24000,
      },
      {
        key: 'speechRate',
        label: 'Speech Rate',
        type: 'number',
        defaultValue: 0,
        description: '−50 (slower) to 100 (faster). 0 = natural.',
      },
      {
        key: 'loudnessRate',
        label: 'Loudness',
        type: 'number',
        defaultValue: 0,
        description: '−50 (quieter) to 100 (louder). 0 = natural.',
      },
      {
        key: 'contextText',
        label: 'Context / Style Direction',
        type: 'text',
        description: 'Natural-language tone/emotion instructions (TTS 2.0).',
      },
    ],
    defaults: {
      speaker: 'en_female_stokie_uranus_bigtts',
      text: 'Hello! Welcome to ModelArk, the AI model platform by BytePlus.',
      format: 'mp3',
      sampleRate: 24000,
      speechRate: 0,
      loudnessRate: 0,
      contextText: '',
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
      assetType: 'Image',
      imageUrl: '',
      videoUrl: '',
      assetName: '',
      localImageData: '',
      localImageName: '',
      localVideoData: '',
      localVideoName: '',
      pollUntilReady: true,
    },
  },
};

export const apiKeyStorageKey = 'modelark_api_key';
