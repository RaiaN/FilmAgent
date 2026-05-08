export const MODEL_CAPABILITIES = {
    // --- SEEDREAM (IMAGE) MODELS ---
    'seedream-5-0-260128': {
        sizes: ['2K', '3K', '4K', 'Custom'],
        optimize_prompt_modes: ['standard'], 
        sequential_generation: true,
        guidance_scale: false,
        supports_watermark: true,
        output_format: true,
        supports_seed: false,
        max_ref_images: 14,
    },
    // --- SEEDANCE (VIDEO) MODELS ---
    'ep-20260415171928-pdvvr': {
        resolutions: ['720p', '1080p'],
        ratios: ['16:9', '9:16', '1:1'],
        durations: [5, 10, 15],
        supports_audio: true,
        supports_draft: false,
        supports_ref_images: true,
        supports_ref_videos: true,
        supports_ref_audios: true,
        supports_last_frame: false,
        supports_first_frame: false,
    },

    // --- LLM / AI ANALYSIS MODELS ---
    'seed-2-0-pro-260328': {
        input_modalities: ['text', 'image'],
    },
    'seed-2-0-mini-260215': {
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
        durations: [5, 10, 15],
        supports_audio: true,
        supports_draft: false,
        supports_ref_images: true,
        supports_ref_videos: true,
        supports_ref_audios: true,
        supports_last_frame: false,
        supports_first_frame: false,

        // LLM defaults
        input_modalities: ['text', 'image', 'video'],
    }
};
