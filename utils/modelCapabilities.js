export const MODEL_CAPABILITIES = {
    // --- SEEDREAM (IMAGE) MODELS ---
    'seedream-5-0-260128': { // Was 'seedream-5-0-lite'
        sizes: ['2K', 'Custom'],
        optimize_prompt_modes: ['standard'], 
        sequential_generation: true,
        guidance_scale: false,
        supports_watermark: true,
        output_format: true,
        supports_seed: false,
        max_ref_images: 14,
    },
    'seedream-4-5-251128': {
        sizes: ['2K', '4K', 'Custom'],
        optimize_prompt_modes: ['standard'],
        sequential_generation: true,
        guidance_scale: false,
        supports_watermark: true,
        supports_seed: false,
        max_ref_images: 14,
    },
    'seedream-4-0-250828': {
        sizes: ['2K', '4K', 'Custom'],
        optimize_prompt_modes: ['standard', 'fast'],
        sequential_generation: true,
        guidance_scale: false,
        supports_watermark: true,
        supports_seed: false,
        max_ref_images: 14,
    },
    'seedream-3-0-t2i-250415': { // Updated ID
        sizes: ['1K', '2K', '4K'], 
        optimize_prompt_modes: [],
        sequential_generation: false,
        guidance_scale: true,
        supports_watermark: false,
        supports_seed: true,
        max_ref_images: 0,
    },
    'seededit-3-0-i2i-250628': { // Updated ID
        sizes: ['2K', '4K'], 
        optimize_prompt_modes: [],
        sequential_generation: false,
        guidance_scale: true,
        supports_watermark: false,
        supports_seed: true,
        max_ref_images: 1, 
    },

    // --- SEEDANCE (VIDEO) MODELS ---
    'seedance-1-5-pro-251215': {
        resolutions: ['480p', '720p', '1080p'],
        ratios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
        durations: [5, 10, -1], 
        supports_audio: true,
        supports_draft: true,
        supports_ref_images: false,
        supports_last_frame: true,
        supports_first_frame: true,
    },
    'seedance-1-0-pro-250528': { // Was 'seedance-1-0-pro'
        resolutions: ['720p'], 
        ratios: ['16:9', '9:16', '1:1'],
        durations: [2, 4],
        supports_audio: false,
        supports_draft: false,
        supports_ref_images: false,
        supports_last_frame: true,
        supports_first_frame: true,
    },
    'seedance-1-0-pro-fast-251015': { // Was 'seedance-pro-fast'
        resolutions: ['480p', '720p'],
        ratios: ['16:9', '9:16', '1:1'],
        durations: [2, 4],
        supports_audio: false,
        supports_draft: false,
        supports_ref_images: false,
        supports_last_frame: false, 
        supports_first_frame: true,
    },
    'seedance-1-0-lite-i2v-250428': { // Was 'seedance-1-0-lite-i2v'
        resolutions: ['720p'],
        ratios: ['16:9', '9:16', '1:1', 'adaptive'], 
        durations: [2, 4],
        supports_audio: false,
        supports_draft: false,
        supports_ref_images: true, 
        supports_last_frame: true,
        supports_first_frame: true,
    },
    'seedance-1-0-lite-t2v-250428': { // Was 'seedance-1-0-lite-t2v'
        resolutions: ['720p'],
        ratios: ['16:9', '9:16', '1:1'], 
        durations: [2, 4],
        supports_audio: false,
        supports_draft: false,
        supports_ref_images: false,
        supports_last_frame: false, 
        supports_first_frame: false, 
    },

    // --- LLM / AI ANALYSIS MODELS ---
    'seed-2-0-mini-260215': {
        input_modalities: ['text', 'image'],
    },
    'skylark-vision-250515': {
        input_modalities: ['text', 'image', 'video'],
    },
    'doubao-vision-pro': {
        input_modalities: ['text', 'image'],
    },

    // Default fallback
    'default': {
        // Seedream defaults
        sizes: ['2K', '4K', 'Custom'],
        optimize_prompt_modes: ['standard'],
        sequential_generation: false,
        guidance_scale: false,
        supports_watermark: true,
        output_format: false,
        supports_seed: true,
        
        // Seedance defaults
        resolutions: ['480p', '720p', '1080p'],
        ratios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
        durations: [2, 5, 10],
        supports_audio: false,
        supports_draft: false,
        supports_ref_images: false,
        supports_last_frame: false,
        supports_first_frame: true,

        // LLM defaults
        input_modalities: ['text', 'image'],
    }
};
