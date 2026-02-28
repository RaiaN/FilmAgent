// components/workflow/nodeDefinitions.js

// Defines the schema for all node types in the workflow editor.
// This allows for data-driven initialization, validation, and connection logic.

export const NODE_DEFINITIONS = {
  imageGen: {
    label: 'Image Generation',
    category: '1', // Seedream
    defaults: {
      model: 'seedream-5-0-lite',
      size: '2K',
      prompt: '',
      loading: false,
      output: null,
      refImages: []
    },
    inputs: {
      prompt: { type: 'text', label: 'Prompt', required: true },
      refImage: { type: 'image', label: 'Reference Image', multiple: true }
    },
    outputs: {
      output: { type: 'image', label: 'Generated Image' }
    }
  },
  videoGen: {
    label: 'Video Generation',
    category: '3', // Seedance
    defaults: {
      model: 'seedance-1-5-pro-251215',
      resolution: '720p',
      duration: 5,
      generate_audio: true,
      prompt: '',
      inputImage: null,
      inputLastFrame: null,
      uploadedImage: null,
      lastFrame: null,
      output: null,
      loading: false
    },
    inputs: {
      prompt: { type: 'text', label: 'Prompt', required: true },
      firstFrame: { type: 'image', label: 'First Frame' },
      lastFrame: { type: 'image', label: 'Last Frame' }
    },
    outputs: {
      output: { type: 'video', label: 'Generated Video' }
    }
  },
  promptEnhancer: {
    label: 'Prompt Enhancer',
    category: '1',
    defaults: {
      inputPrompt: '',
      outputPrompt: '',
      loading: false
    },
    inputs: {
      inputPrompt: { type: 'text', label: 'Input Prompt' }
    },
    outputs: {
      outputPrompt: { type: 'text', label: 'Enhanced Prompt' }
    }
  },
  llm: { // VLM Node
    label: 'AI Analysis',
    category: '2', // Seed (Analysis)
    defaults: {
      prompt: '',
      inputImage: null,
      inputVideo: null,
      output: '',
      loading: false
    },
    inputs: {
      prompt: { type: 'text', label: 'Question/Instruction' },
      inputImage: { type: 'image', label: 'Input Image' },
      inputVideo: { type: 'video', label: 'Input Video' }
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
      inputImage: null,
      inputVideo: null,
      inputAudio: null
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
      inputVideo: null,
      prompt: ''
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
      inputVideo: null
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
      videoA: null,
      videoB: null
    },
    inputs: {
      videoA: { type: 'video', label: 'Video A' },
      videoB: { type: 'video', label: 'Video B' }
    },
    outputs: {
      output: { type: 'video', label: 'Merged Video' }
    }
  },
  preset: {
    label: 'Preset',
    category: '2',
    defaults: {
      presetType: 'style',
      value: ''
    },
    inputs: {}, // Source only
    outputs: {
      value: { type: 'text', label: 'Preset Value' }
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
  return NODE_DEFINITIONS[type]?.defaults || {};
};

export const getNodeInputs = (type) => {
  return NODE_DEFINITIONS[type]?.inputs || {};
};

export const getNodeOutputs = (type) => {
  return NODE_DEFINITIONS[type]?.outputs || {};
};
