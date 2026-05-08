import { MODEL_CAPABILITIES } from './modelCapabilities';

export const constructWorkflowSeedreamPayload = (formValues) => {
    const requestBody = {
      model: formValues.model,
      prompt: formValues.prompt,
      size: formValues.size || '2K',
      response_format: 'url',
    };

    if (formValues.image && formValues.image.length > 0) {
      requestBody.image = formValues.image;
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
    };

    if (formValues.seed !== -1) {
        payload.seed = Number(formValues.seed);
    }

    const caps = MODEL_CAPABILITIES[formValues.model] || MODEL_CAPABILITIES['default'];

    if (caps.supports_audio) {
        payload.generate_audio = formValues.generate_audio;
    }
    // Handle Image Inputs based on Model & Role
    const images = [];

    // Only include media inputs that the selected model actually supports.
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

export const formatProductionRuleGroups = (ruleGroups = {}) => {
    const sections = [
        ['Architecture & Space', ruleGroups.architecture],
        ['Materials & Patina', ruleGroups.materials],
        ['Culture & Use', ruleGroups.culture],
        ['Traversal & Camera', ruleGroups.camera],
        ['Non-Negotiables', ruleGroups.guards],
    ].filter(([, value]) => value && String(value).trim());

    return sections
        .map(([label, value]) => `${label}:\n${String(value).trim()}`)
        .join('\n\n');
};

export const constructProductionDesignPayload = (formValues) => {
    const formattedRuleGroups = formatProductionRuleGroups(formValues.ruleGroups);
    const combinedDesignRules = [formValues.designRules, formattedRuleGroups]
        .filter((value) => value && String(value).trim())
        .join('\n\n');

    return {
        model: formValues.model,
        prompt: formValues.prompt,
        sourceMaterials: formValues.sourceMaterials,
        designRules: combinedDesignRules,
        ruleGroups: formValues.ruleGroups || {},
        explorationGoal: formValues.explorationGoal,
        continuityNotes: formValues.continuityNotes,
        sourceImages: formValues.sourceImages || [],
        sourceVideos: formValues.sourceVideos || [],
        continuationImages: formValues.continuationImages || [],
        continuationVideos: formValues.continuationVideos || [],
        continuedFrom: formValues.continuedFrom || null,
        ratio: formValues.ratio,
        resolution: '1080p',
        duration: 15,
    };
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
        const nextFields = prevSchema.fields.map((f) => {
            // Option Filtering
            if (f.key === 'size' && caps.sizes) {
                return { ...f, options: caps.sizes.filter((size) => size !== 'Custom') };
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
