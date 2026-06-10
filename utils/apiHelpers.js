import { MODEL_CAPABILITIES } from './modelCapabilities';

const isHttpUrl = (value) => {
    if (typeof value !== 'string' || !value.trim()) return false;

    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
        return false;
    }
};

const isDataUrl = (value) => typeof value === 'string' && /^data:[^;]+;base64,/i.test(value);
const isAssetUrl = (value) => typeof value === 'string' && /^asset:\/\//i.test(value.trim());

const assertSupportedSeedanceMediaInputs = (values, label) => {
    const invalidValues = (values || []).filter((value) => !isHttpUrl(value) && !isDataUrl(value));
    if (invalidValues.length > 0) {
        throw new Error(`${label} must be public http(s) URLs or local uploaded files. Blob URLs and other unsupported formats are not supported.`);
    }
};

const assertReferenceImageRefs = (refs) => {
    refs.forEach((ref, i) => {
        if (ref.type === 'url' && !isHttpUrl(ref.value) && !isDataUrl(ref.value)) {
            throw new Error(`Reference image ${i + 1} must be a public http(s) URL or a local uploaded file.`);
        }
        if (ref.type === 'asset' && (!ref.value || !String(ref.value).trim())) {
            throw new Error(`Reference image ${i + 1} has an empty asset ID.`);
        }
    });
};

const toSeedanceAssetUrl = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return isAssetUrl(trimmed) ? trimmed : `asset://${trimmed}`;
};

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
        ...(formValues.duration !== 'auto' && { duration: Number(formValues.duration) }),
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
    if (caps.supports_ref_images && formValues.reference_image_refs && formValues.reference_image_refs.length > 0) {
        assertReferenceImageRefs(formValues.reference_image_refs);
        formValues.reference_image_refs.forEach(ref => {
            images.push({
                type: 'image_url',
                image_url: { url: ref.type === 'asset' ? toSeedanceAssetUrl(ref.value) : ref.value },
                role: 'reference_image',
            });
        });
    }

    if (caps.supports_ref_videos && formValues.reference_video_refs && formValues.reference_video_refs.length > 0) {
        formValues.reference_video_refs.forEach((ref, i) => {
            if (ref.type === 'url' && !isHttpUrl(ref.value) && !isDataUrl(ref.value)) {
                throw new Error(`Reference video ${i + 1} must be a public http(s) URL or a local uploaded file.`);
            }
            if (ref.type === 'asset' && (!ref.value || !String(ref.value).trim())) {
                throw new Error(`Reference video ${i + 1} has an empty asset ID.`);
            }
            images.push({
                type: 'video_url',
                video_url: { url: ref.type === 'asset' ? toSeedanceAssetUrl(ref.value) : ref.value },
                role: 'reference_video',
            });
        });
    }

    if (caps.supports_ref_audios && formValues.reference_audios && formValues.reference_audios.length > 0) {
        assertSupportedSeedanceMediaInputs(formValues.reference_audios, 'Reference audio files');
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

export const constructProductionDesignPayload = (formValues) => {
    return {
        model: formValues.model,
        prompt: formValues.prompt,
        size: formValues.size,
        continuedFrom: formValues.continuedFrom || null,
    };
};

export const constructAssetUploadPayload = (formValues) => {
    const assetType = formValues.assetType || 'Image';
    const isVideo = assetType === 'Video';
    return {
        assetGroupId: formValues.assetGroupId,
        assetType,
        imageUrl: isVideo ? '' : (formValues.imageUrl || ''),
        videoUrl: isVideo ? (formValues.videoUrl || '') : '',
        assetName: formValues.assetName,
        localImageData: isVideo ? '' : (formValues.localImageData || ''),
        localImageName: isVideo ? '' : (formValues.localImageName || ''),
        localVideoData: isVideo ? (formValues.localVideoData || '') : '',
        localVideoName: isVideo ? (formValues.localVideoName || '') : '',
        pollUntilReady: formValues.pollUntilReady !== false,
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
            if (f.key === 'reference_image_refs') {
                return { ...f, hidden: !caps.supports_ref_images };
            }
            if (f.key === 'reference_video_refs') {
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
        images: formValues.image && formValues.image.length > 0 ? formValues.image : [],
        video: formValues.video && formValues.video.length > 0 ? formValues.video[0] : null,
    };
};
