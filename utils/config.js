// Central configuration for API endpoints
// This ensures we have a single source of truth for the ModelArk API base URL.

export const CONFIG = {
    // Default to the AP-Southeast endpoint if not overridden by env vars
    API_BASE_URL: process.env.MODELARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3',
    
    // Helper to construct full endpoints
    endpoints: {
        chat: '/chat/completions',
        image: '/images/generations',
        video: '/contents/generations/tasks'
    }
};

// Helper function to get full URL
export const getEndpointUrl = (type) => {
    const base = CONFIG.API_BASE_URL.replace(/\/+$/, ''); // Remove trailing slash
    const path = CONFIG.endpoints[type];
    if (!path) return base;
    return `${base}${path}`;
};
