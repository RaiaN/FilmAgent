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
    const is50Lite = model === 'seedream-5-0-lite';
    const isSeqSupported = !is30Model; // 5.0, 4.5, 4.0 support sequential
    const isOptimizePromptSupported = !is30Model; // 5.0, 4.5, 4.0 support optimize prompt

    if (isSeqSupported && formValues.sequential_image_generation) {
      requestBody.sequential_image_generation = 'auto';
      requestBody.sequential_image_generation_options = {
        max_images: Number(formValues.sequential_max_images) || 5
      };
    }

    if (isOptimizePromptSupported && formValues.optimize_prompt_mode) {
      requestBody.optimize_prompt_options = {
        mode: formValues.optimize_prompt_mode
      };
    }

    // ONLY add output_format for 5.0-lite
    if (is50Lite && formValues.output_format) {
      requestBody.output_format = formValues.output_format;
    }

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

    if (formValues.model.includes('1-5-pro')) {
        payload.generate_audio = formValues.generate_audio;
    }

    // Handle Image Inputs based on Model & Role
    const images = [];

    // First Frame (Supported by most models)
    if (formValues.first_frame && formValues.first_frame.length > 0) {
        images.push({
            type: 'image_url',
            image_url: { url: formValues.first_frame[0] },
            role: 'first_frame'
        });
    }

    // Last Frame (Supported by 1.5 pro, 1.0 pro, 1.0 lite i2v)
    if (formValues.last_frame && formValues.last_frame.length > 0) {
        images.push({
            type: 'image_url',
            image_url: { url: formValues.last_frame[0] },
            role: 'last_frame'
        });
    }

    // Reference Images (Only for 1.0 lite i2v)
    if (formValues.reference_images && formValues.reference_images.length > 0) {
        formValues.reference_images.forEach(img => {
            images.push({
                type: 'image_url',
                image_url: { url: img },
                role: 'reference_image'
            });
        });
    }

    if (images.length > 0) {
        payload.content = [...payload.content, ...images];
    }

    return payload;
};

export const updateUiSchemaVisibility = (prevSchema, formValues, activeModelId) => {
    if (activeModelId === 'seedream') {
        const model = formValues.model;
        const isCustomSize = formValues.size === 'Custom';
        const isSequential = formValues.sequential_image_generation;
        
        const is30Model = model && (model.includes('3-0') || model.includes('3.0'));
        const is50Lite = model === 'seedream-5-0-lite';
        const isSeqSupported = !is30Model; // 5.0, 4.5, 4.0 support sequential
        const isOptimizePromptSupported = !is30Model; // 5.0, 4.5, 4.0 support optimize prompt

        const nextFields = prevSchema.fields.map((f) => {
          if (f.key === 'width' || f.key === 'height') {
            return { ...f, hidden: !isCustomSize };
          }
          if (f.key === 'sequential_image_generation') {
            return { ...f, hidden: !isSeqSupported };
          }
          if (f.key === 'sequential_max_images') {
            return { ...f, hidden: !isSequential || !isSeqSupported };
          }
          if (f.key === 'optimize_prompt_mode') {
            return { ...f, hidden: !isOptimizePromptSupported };
          }
          if (f.key === 'output_format') {
            return { ...f, hidden: !is50Lite };
          }
          if (f.key === 'guidance_scale' || f.key === 'seed') {
            return { ...f, hidden: !is30Model };
          }
          return f;
        });

        // Check if actually changed to avoid loop
        if (JSON.stringify(nextFields) !== JSON.stringify(prevSchema.fields)) {
          return { ...prevSchema, fields: nextFields };
        }
        return prevSchema;
    }
    
    if (activeModelId === 'seedance') {
        const model = formValues.model || '';
        const is15Pro = model.includes('1-5-pro');
        const is10LiteI2V = model.includes('1-0-lite-i2v');
        const isT2VOnly = model.includes('t2v') || model === 'seedance-1-0-lite-t2v';
        const isProFast = model === 'seedance-pro-fast';

        const nextFields = prevSchema.fields.map((f) => {
            if (f.key === 'generate_audio') {
                return { ...f, hidden: !is15Pro };
            }
            if (f.key === 'reference_images') {
                return { ...f, hidden: !is10LiteI2V };
            }
            if (f.key === 'last_frame') {
                 // Not supported by pro-fast or T2V
                return { ...f, hidden: isProFast || isT2VOnly };
            }
            if (f.key === 'first_frame') {
                return { ...f, hidden: isT2VOnly };
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
