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
      preset: [], // Multi-select array
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
      model: 'seedance-1-5-pro-251215',
      resolution: '720p',
      duration: 5,
      generate_audio: true,
      prompt: '',
      preset: [], // Multi-select array
      output: null,
      loading: false
    },
    inputs: {
      firstFrame: { type: 'image', label: 'First Frame' },
      lastFrame: { type: 'image', label: 'Last Frame' },
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
  vlm: {
    label: 'VLM Analysis',
    category: '2', // ModelArk
    defaults: {
      model: 'doubao-vision-pro-32k',
      prompt: '',
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
  return NODE_DEFINITIONS[type]?.defaults || {};
};

export const getNodeInputs = (type) => {
  return NODE_DEFINITIONS[type]?.inputs || {};
};

export const getNodeOutputs = (type) => {
  return NODE_DEFINITIONS[type]?.outputs || {};
};
