// components/workflow/nodeDefinitions.js
import { resolveModelId } from '../../utils/film/suiteConfig';

// Defines the schema for all node types in the workflow editor.
// This allows for data-driven initialization, validation, and connection logic.

// Standardized Color Palette for Pin Types
export const PIN_COLORS = {
  text: '#ff7d00',    // Orange
  image: '#165dff',   // Blue
  video: '#722ed1',   // Purple
  audio: '#00b42a',   // Green
  default: '#86909c'  // Gray
};

export const getPinColor = (type) => {
  return PIN_COLORS[type] || PIN_COLORS.default;
};

export const NODE_DEFINITIONS = {
  imageGen: {
    label: 'Image Generation',
    category: '1', // Seedream
    defaults: {
      get model() { return resolveModelId('seedream'); }, // env slot — ids are account-scoped
      size: '2K',
      prompt: '',
      loading: false,
      output: null
    },
    inputs: {
      refImage: { type: 'image', label: 'Reference Image', multiple: true },
      prompt: { type: 'text', label: 'Prompt', required: true }
    },
    outputs: {
      output: { type: 'image', label: 'Generated Image' }
    }
  },
  videoGen: {
    label: 'Video Generation',
    category: '3', // Seedance
    defaults: {
      get model() { return resolveModelId('seedance'); }, // env slot — ids are account-scoped
      resolution: '720p',
      duration: 'auto',
      generate_audio: true,
      prompt: 'Generate cinematic video of the main subject in the reference image',
      referenceImages: [],
      output: null,
      loading: false
    },
    inputs: {
      referenceImage: { type: 'image', label: 'Reference Image', multiple: true },
      prompt: { type: 'text', label: 'Prompt', required: true }
    },
    outputs: {
      output: { type: 'video', label: 'Generated Video' }
    }
  },
  promptEnhancer: {
    label: 'Prompt Enhancer',
    category: '1',
    defaults: {
      prompt: '',
      output: '',
      loading: false
    },
    inputs: {
      prompt: { type: 'text', label: 'Input Prompt' }
    },
    outputs: {
      output: { type: 'text', label: 'Enhanced Prompt' }
    }
  },
  vlm: {
    label: 'VLM Analysis',
    category: '2', // ModelArk
    defaults: {
      get model() { return resolveModelId('reasoner'); }, // env slot — ids are account-scoped
      prompt: 'Convert into prompt, return PROMPT only',
      output: '',
      loading: false
    },
    inputs: {
      inputImage: { type: 'image', label: 'Input Image' },
      inputVideo: { type: 'video', label: 'Input Video' },
      prompt: { type: 'text', label: 'Question/Instruction' }
    },
    outputs: {
      output: { type: 'text', label: 'Analysis Result' }
    }
  },
  multimodalVideo: {
    label: 'Multimodal Video',
    category: '3',
    defaults: {
      prompt: '',
      output: null
    },
    inputs: {
      prompt: { type: 'text', label: 'Prompt' },
      inputImage: { type: 'image', label: 'Image' },
      inputVideo: { type: 'video', label: 'Video' },
      inputAudio: { type: 'audio', label: 'Audio' }
    },
    outputs: {
      output: { type: 'video', label: 'Output Video' }
    }
  },
  videoEdit: {
    label: 'Video Edit',
    category: '3',
    defaults: {
      prompt: '',
      output: null
    },
    inputs: {
      inputVideo: { type: 'video', label: 'Input Video' },
      prompt: { type: 'text', label: 'Edit Instruction' }
    },
    outputs: {
      output: { type: 'video', label: 'Edited Video' }
    }
  },
  videoExtend: {
    label: 'Video Extend',
    category: '3',
    defaults: {
      output: null
    },
    inputs: {
      inputVideo: { type: 'video', label: 'Input Video' }
    },
    outputs: {
      output: { type: 'video', label: 'Extended Video' }
    }
  },
  mergeVideos: {
    label: 'Merge Videos',
    category: '3',
    defaults: {
      output: null
    },
    inputs: {
      videoA: { type: 'video', label: 'Video A' },
      videoB: { type: 'video', label: 'Video B' }
    },
    outputs: {
      output: { type: 'video', label: 'Merged Video' }
    }
  },
  agentic: {
    label: 'Agentic Workflow',
    category: '2',
    defaults: {
      task: '',
      steps: [],
      dynamicOutputs: []
    },
    inputs: {
      task: { type: 'text', label: 'Task Description' }
    },
    outputs: {
      output: { type: 'any', label: 'Result' }
    }
  },
  image: {
    label: 'Image Viewer',
    category: '1',
    defaults: { output: null },
    inputs: {
      input: { type: 'image', label: 'Image' }
    },
    outputs: {
      output: { type: 'image', label: 'Image Output' }
    }
  },
  video: {
    label: 'Video Viewer',
    category: '3',
    defaults: { output: null },
    inputs: {
      input: { type: 'video', label: 'Video' }
    },
    outputs: {
      output: { type: 'video', label: 'Video Output' }
    }
  }
};

export const getNodeDefaults = (type) => {
  // Spread COPIES the defaults (and evaluates the live model getters) — callers
  // mutate their node data, which must never write back into the shared template.
  return { ...(NODE_DEFINITIONS[type]?.defaults || {}) };
};

export const getNodeInputs = (type) => {
  return NODE_DEFINITIONS[type]?.inputs || {};
};

export const getNodeOutputs = (type) => {
  return NODE_DEFINITIONS[type]?.outputs || {};
};
