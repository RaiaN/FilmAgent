// Shared preset configurations for image and video generation nodes

export const PRESET_CATEGORIES = {
    style: {
        label: 'Art Style',
        options: [
            'Photorealistic', 
            'Cinematic', 
            'Cyberpunk', 
            'Anime', 
            'Oil Painting', 
            'Watercolor', 
            '3D Render', 
            'Minimalist',
            'Vintage 80s',
            'Film Noir'
        ]
    },
    lighting: {
        label: 'Lighting',
        options: [
            'Cinematic Lighting', 
            'Natural Light', 
            'Golden Hour', 
            'Studio Lighting', 
            'Neon Lights', 
            'Rembrandt Lighting', 
            'Volumetric Lighting',
            'Low Key',
            'Soft Box'
        ]
    },
    camera: {
        label: 'Camera Angle',
        options: [
            'Wide Shot', 
            'Close Up', 
            'Macro', 
            'Aerial View', 
            'Low Angle', 
            'Dutch Angle', 
            'Fisheye Lens',
            'Over-the-Shoulder'
        ]
    },
    movement: { // Video only
        label: 'Camera Movement',
        options: [
            'Static', 
            'Pan Left', 
            'Pan Right', 
            'Zoom In', 
            'Zoom Out', 
            'Tilt Up', 
            'Tilt Down', 
            'Tracking Shot',
            'Slow Motion',
            'Timelapse'
        ]
    }
};

export const getPresetsForNode = (nodeType) => {
    if (nodeType === 'imageGen') {
        return {
            style: PRESET_CATEGORIES.style,
            lighting: PRESET_CATEGORIES.lighting,
            camera: PRESET_CATEGORIES.camera
        };
    }
    if (nodeType === 'videoGen') {
        return {
            style: PRESET_CATEGORIES.style,
            lighting: PRESET_CATEGORIES.lighting,
            camera: PRESET_CATEGORIES.camera,
            movement: PRESET_CATEGORIES.movement
        };
    }
    return {};
};
