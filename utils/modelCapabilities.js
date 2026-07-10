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
    // Seedream 5.0 Lite endpoint (Tools → Image default). Ref cap mirrors IMAGE_REF_CAP.seedream (6).
    'ep-20260501195034-hj78f': {
        sizes: ['2K', '4K'],
        optimize_prompt_modes: ['standard'],
        sequential_generation: true,
        guidance_scale: false,
        supports_watermark: true,
        output_format: true,
        supports_seed: false,
        max_ref_images: 6,
    },
    // Seedream 5.0 Pro endpoint — output area caps at 2048² (4.19MP): no 4K, so explicit
    // sub-cap sizes; accepts up to 10 refs. Mirrors IMAGE_REF_CAP.seedreamPro (10).
    'dola-seedream-5-0-pro-260628': {
        sizes: ['2560x1440', '1440x2560', '2048x2048'],
        optimize_prompt_modes: ['standard'],
        sequential_generation: true,
        guidance_scale: false,
        supports_watermark: true,
        output_format: false,
        supports_seed: false,
        max_ref_images: 10,
    },

    // --- SEEDANCE (VIDEO) MODELS ---
    // Seedance 2.0 (default)
    'ep-20260415171928-pdvvr': {
        resolutions: ['720p', '1080p', '4k'],
        ratios: ['16:9', '9:16', '1:1', '21:9'],
        durations: ['auto', 5, 10, 15],
        supports_audio: true,
        supports_draft: false,
        supports_ref_images: true,
        supports_ref_videos: true,
        supports_ref_audios: true,
        supports_last_frame: false,
        supports_first_frame: false,
    },
    // Seedance 2.0 Fast — faster than the default; no 4K.
    'ep-20260701151623-f94zq': {
        resolutions: ['720p', '1080p'],
        ratios: ['16:9', '9:16', '1:1', '21:9'],
        durations: ['auto', 5, 10, 15],
        supports_audio: true,
        supports_draft: false,
        supports_ref_images: true,
        supports_ref_videos: true,
        supports_ref_audios: true,
        supports_last_frame: false,
        supports_first_frame: false,
    },
    // Seedance 2.0 Mini — cheaper/faster; resolution caps at 720p.
    'ep-20260629005443-n7rjn': {
        resolutions: ['480p', '720p'],
        ratios: ['16:9', '9:16', '1:1', '21:9'],
        durations: ['auto', 5, 10, 15],
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
        input_modalities: ['text', 'image', 'video', 'audio'],
        supportsImage: true,
        supportsVideo: true,
    },
    'seed-2-0-mini-260428': {
        input_modalities: ['text', 'image', 'video', 'audio'],
        supportsImage: true,
        supportsVideo: true,
    },
    'seed-2-0-lite-260428': {
        input_modalities: ['text', 'image', 'video', 'audio'],
        supportsImage: true,
        supportsVideo: true,
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
        resolutions: ['480p', '720p', '1080p', '4k'],
        ratios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
        durations: ['auto', 5, 10, 15],
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
