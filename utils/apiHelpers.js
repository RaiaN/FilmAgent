import { MODEL_CAPABILITIES } from './modelCapabilities';

export const constructSeedreamPayload = (formValues) => {
    const composedPrompt = formValues.prompt;
    const model = formValues.model;
    
    // Construct payload based on strict schema
    const requestBody = {
      model: model,
      prompt: composedPrompt,
      watermark: formValues.watermark,
      response_format: formValues.response_format,
    };

    // Handle Size
    if (formValues.size === 'Custom') {
      // Size must be WxH string e.g. "2048x2048"
      if (formValues.width && formValues.height) {
         requestBody.size = `${formValues.width}x${formValues.height}`;
      } else {
         // Fallback or error? defaulting to 2K if missing
         requestBody.size = '2K'; 
      }
    } else {
      requestBody.size = formValues.size;
    }

    // Handle Images
    if (formValues.image && formValues.image.length > 0) {
      if (formValues.image.length === 1) {
          requestBody.image = formValues.image[0];
      } else {
          requestBody.image = formValues.image;
      }
    }

    // Conditional Fields based on Model
    const is30Model = model && (model.includes('3-0') || model.includes('3.0'));
    // Re-enabled as requested by user - only for 5.0-lite
    const is50Lite = model === 'seedream-5-0-lite';
    
    const isSeqSupported = !is30Model; // 5.0, 4.5, 4.0 support sequential
    const isOptimizePromptSupported = !is30Model; // 5.0, 4.5, 4.0 support optimize prompt
    // 4.5 and 5.0-lite only support 'standard' mode. 4.0 supports both.
    const isStandardOnly = model.includes('4-5') || model.includes('5-0-lite');

    if (isSeqSupported && formValues.sequential_image_generation) {
      requestBody.sequential_image_generation = 'auto';
      requestBody.sequential_image_generation_options = {
        max_images: Number(formValues.sequential_max_images) || 5
      };
    }

    if (isOptimizePromptSupported && formValues.optimize_prompt_mode) {
      // If model is standard-only and user selected 'fast', force 'standard'
      if (isStandardOnly && formValues.optimize_prompt_mode === 'fast') {
          requestBody.optimize_prompt_options = { mode: 'standard' };
      } else {
          requestBody.optimize_prompt_options = {
            mode: formValues.optimize_prompt_mode
          };
      }
    }

    // Re-enabled as requested by user - only for 5.0-lite
    // DISABLED: User requested to comment off output_format
    /*
    if (is50Lite && formValues.output_format) {
      requestBody.output_format = formValues.output_format;
    } 
    */ 

    if (is30Model && formValues.guidance_scale) {
      requestBody.guidance_scale = Number(formValues.guidance_scale);
    }

    if (is30Model && formValues.seed !== undefined && formValues.seed !== -1) {
      requestBody.seed = Number(formValues.seed);
    }

    return requestBody;
};

export const constructSeedancePayload = (formValues) => {
    const payload = {
        model: formValues.model,
        content: [
            {
                type: 'text',
                text: formValues.prompt
            }
        ],
        resolution: formValues.resolution,
        ratio: formValues.ratio,
        duration: Number(formValues.duration),
        watermark: formValues.watermark,
        camera_fixed: formValues.camera_fixed
    };

    if (formValues.seed !== -1) {
        payload.seed = Number(formValues.seed);
    }

    const caps = MODEL_CAPABILITIES[formValues.model] || MODEL_CAPABILITIES['default'];

    if (caps.supports_audio) {
        payload.generate_audio = formValues.generate_audio;
    }
    if (caps.supports_draft && formValues.draft) {
        payload.draft = true;
    }

    if (formValues.return_last_frame) {
        payload.return_last_frame = true;
    }

    // Handle Image Inputs based on Model & Role
    const images = [];

    // Only include media inputs that the selected model actually supports.
    if (caps.supports_first_frame && formValues.first_frame && formValues.first_frame.length > 0) {
        images.push({
            type: 'image_url',
            image_url: { url: formValues.first_frame[0] },
            role: 'first_frame'
        });
    }

    if (caps.supports_last_frame && formValues.last_frame && formValues.last_frame.length > 0) {
        images.push({
            type: 'image_url',
            image_url: { url: formValues.last_frame[0] },
            role: 'last_frame'
        });
    }

    if (caps.supports_ref_images && formValues.reference_images && formValues.reference_images.length > 0) {
        formValues.reference_images.forEach(img => {
            images.push({
                type: 'image_url',
                image_url: { url: img },
                role: 'reference_image'
            });
        });
    }

    if (caps.supports_ref_videos && formValues.reference_videos && formValues.reference_videos.length > 0) {
        formValues.reference_videos.forEach(vid => {
            images.push({
                type: 'video_url',
                video_url: { url: vid },
                role: 'reference_video'
            });
        });
    }

    if (caps.supports_ref_audios && formValues.reference_audios && formValues.reference_audios.length > 0) {
        formValues.reference_audios.forEach(aud => {
            images.push({
                type: 'audio_url',
                audio_url: { url: aud },
                role: 'reference_audio'
            });
        });
    }

    if (images.length > 0) {
        payload.content = [...payload.content, ...images];
    }

    return payload;
};

export const updateUiSchemaVisibility = (prevSchema, formValues, activeModelId) => {
    const model = formValues.model || '';
    
    // Get capabilities - MUST exist for the selected model
    const caps = MODEL_CAPABILITIES[model];

    if (!caps) {
        console.warn(`[updateUiSchemaVisibility] Missing capabilities for model: ${model}. UI might be incorrect.`);
        return prevSchema; // Return schema unchanged if capabilities are missing
    }

    // --- SEEDREAM (IMAGE) VISIBILITY LOGIC ---
    if (activeModelId === 'seedream') {
        const isCustomSize = formValues.size === 'Custom';
        const isSequential = formValues.sequential_image_generation;

        const nextFields = prevSchema.fields.map((f) => {
            // Option Filtering
            if (f.key === 'size' && caps.sizes) {
                return { ...f, options: caps.sizes };
            }
            if (f.key === 'optimize_prompt_mode' && caps.optimize_prompt_modes) {
                return { ...f, options: caps.optimize_prompt_modes };
            }

            // Visibility
            if (f.key === 'width' || f.key === 'height') {
                return { ...f, hidden: !isCustomSize };
            }
            if (f.key === 'sequential_image_generation') {
                // If capability is explicitly true, show it. Otherwise hidden.
                // The issue might be that 'caps' is falling back to 'default' if model key doesn't match EXACTLY.
                // Or previous logic was '!caps.sequential_generation', which means if true -> hidden=false (CORRECT).
                // Let's ensure the key in MODEL_CAPABILITIES matches formValues.model exactly.
                return { ...f, hidden: !caps.sequential_generation };
            }
            if (f.key === 'sequential_max_images') {
                return { ...f, hidden: !isSequential || !caps.sequential_generation };
            }
            if (f.key === 'optimize_prompt_mode') {
                return { ...f, hidden: !caps.optimize_prompt_modes || caps.optimize_prompt_modes.length === 0 };
            }
            if (f.key === 'output_format') {
                return { ...f, hidden: !caps.output_format };
            }
            if (f.key === 'guidance_scale') {
                return { ...f, hidden: !caps.guidance_scale };
            }
            if (f.key === 'seed') {
                return { ...f, hidden: !caps.supports_seed };
            }
            if (f.key === 'watermark') {
                return { ...f, hidden: caps.supports_watermark === false };
            }
            return f;
        });

        if (JSON.stringify(nextFields) !== JSON.stringify(prevSchema.fields)) {
            return { ...prevSchema, fields: nextFields };
        }
        return prevSchema;
    }
    
    // --- SEEDANCE (VIDEO) VISIBILITY LOGIC ---
    if (activeModelId === 'seedance') {
        const nextFields = prevSchema.fields.map((f) => {
            // Option Filtering Logic
            if (f.key === 'resolution' && caps.resolutions) {
                return { ...f, options: caps.resolutions };
            }
            if (f.key === 'ratio' && caps.ratios) {
                return { ...f, options: caps.ratios };
            }
            if (f.key === 'duration' && caps.durations) {
                return { ...f, options: caps.durations };
            }

            // Visibility Logic
            if (f.key === 'generate_audio') {
                return { ...f, hidden: !caps.supports_audio };
            }
            if (f.key === 'draft') {
                return { ...f, hidden: !caps.supports_draft };
            }
            if (f.key === 'reference_images') {
                return { ...f, hidden: !caps.supports_ref_images };
            }
            if (f.key === 'reference_videos') {
                return { ...f, hidden: !caps.supports_ref_videos };
            }
            if (f.key === 'reference_audios') {
                return { ...f, hidden: !caps.supports_ref_audios };
            }
            if (f.key === 'last_frame') {
                return { ...f, hidden: !caps.supports_last_frame };
            }
            if (f.key === 'first_frame') {
                return { ...f, hidden: !caps.supports_first_frame };
            }
            return f;
        });

        if (JSON.stringify(nextFields) !== JSON.stringify(prevSchema.fields)) {
            return { ...prevSchema, fields: nextFields };
        }
        return prevSchema;
    }

    return prevSchema;
};

export const constructLLMPayload = (formValues) => {
    return {
        model: formValues.model,
        prompt: formValues.prompt,
        image: formValues.image && formValues.image.length > 0 ? formValues.image[0] : null,
        video: formValues.video && formValues.video.length > 0 ? formValues.video[0] : null,
    };
};
