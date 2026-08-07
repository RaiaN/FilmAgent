// Model capability registry — keyed by SLOT, not by endpoint id. Endpoint ids are
// deployment-specific (env-configured, account-scoped `ep-…` values), so a literal
// id key would silently stop matching on any other account. getModelCapabilities()
// resolves the caller's model id back to its slot at LOOKUP time via the same
// env-backed registry the routes use.
import { resolveModelId } from './film/suiteConfig';

const SLOT_CAPABILITIES = {
    // --- SEEDREAM (IMAGE) ---
    // Seedream 5.0 Lite (Tools → Image default). Ref cap mirrors IMAGE_REF_CAP.seedream (6).
    seedream: {
        sizes: ['2K', '4K'],
        optimize_prompt_modes: ['standard'],
        sequential_generation: true,
        guidance_scale: false,
        supports_watermark: true,
        output_format: true,
        supports_seed: false,
        max_ref_images: 6,
    },
    // Seedream 5.0 Pro — output area caps at 2048² (4.19MP): no 4K, so explicit
    // sub-cap sizes; accepts up to 10 refs. Mirrors IMAGE_REF_CAP.seedreamPro (10).
    // 'thinking' = optimize_prompt_options {thinking:'enabled'}.
    seedreamPro: {
        sizes: ['2560x1440', '1440x2560', '2048x2048'],
        optimize_prompt_modes: ['standard', 'thinking'],
        sequential_generation: true,
        guidance_scale: false,
        supports_watermark: true,
        output_format: false,
        supports_seed: false,
        max_ref_images: 10,
    },

    // --- SEEDANCE (VIDEO) ---
    // Seedance 2.0 (default)
    seedance: {
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
    seedanceFast: {
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
    // Seedance 2.5 — 30s single takes, 480p/720p only, 30 image + 10 video + 10
    // audio refs, native first_frame/last_frame tasks (ratio must be adaptive there).
    seedance25: {
        resolutions: ['480p', '720p'],
        ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
        durations: ['auto', 5, 10, 15, 20, 30],
        supports_audio: true,
        supports_draft: false,
        supports_ref_images: true,
        supports_ref_videos: true,
        supports_ref_audios: true,
    },
    seedanceMini: {
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

    // --- LLM / AI ANALYSIS ---
    reasoner: {
        input_modalities: ['text', 'image', 'video', 'audio'],
        supportsImage: true,
        supportsVideo: true,
    },
};

// PUBLIC catalog names — portable across accounts (standard model names, never
// account-scoped endpoint ids), so a literal key is safe here.
const CATALOG_CAPABILITIES = {
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
};

export const DEFAULT_CAPABILITIES = {
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
};

// Always returns an object (DEFAULT_CAPABILITIES when the id is unknown/unset).
export const getModelCapabilities = (modelId) => {
    const id = String(modelId || '');
    if (!id) return DEFAULT_CAPABILITIES;
    for (const [slot, caps] of Object.entries(SLOT_CAPABILITIES)) {
        if (resolveModelId(slot) === id) return caps;
    }
    return CATALOG_CAPABILITIES[id] || DEFAULT_CAPABILITIES;
};
