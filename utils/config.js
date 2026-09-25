// Central configuration for API endpoints
// This ensures we have a single source of truth for the ModelArk API base URL.

export const CONFIG = {
    // Default to the AP-Southeast endpoint if not overridden by env vars
    // REQUIRED — no default: set MODELARK_API_BASE_URL in .env.local (region base URL).
    API_BASE_URL: process.env.MODELARK_API_BASE_URL,
    
    // Helper to construct full endpoints
    endpoints: {
        chat: '/chat/completions',
        image: '/images/generations',
        video: '/contents/generations/tasks'
    }
};

// Helper function to get full URL
export const getEndpointUrl = (type) => {
    if (!CONFIG.API_BASE_URL) throw new Error('MODELARK_API_BASE_URL is not configured — set it in .env.local (see .env.example).');
    const base = CONFIG.API_BASE_URL.replace(/\/+$/, ''); // Remove trailing slash
    const path = CONFIG.endpoints[type];
    if (!path) return base;
    return `${base}${path}`;
};

// THE ARK KEY. It comes from the server's environment (.env.local) and nowhere else — a
// key a request carries is never used, so a key the browser has stored cannot override it.
export const arkKey = () => process.env.MODELARK_API_KEY || process.env.ARK_API_KEY || '';

export const ARK_KEY_MISSING = 'MODELARK_API_KEY is not set — add it to .env.local (see .env.example).';

// AI MEDIAKIT (video enhancement) — its own API key and region endpoint, both from
// .env.local only. No defaults: a missing value is reported, never guessed.
export const mediakitKey = () => process.env.MODELARK_MEDIAKIT_API_KEY || '';
export const mediakitBase = () => String(process.env.MODELARK_MEDIAKIT_BASE_URL || '').replace(/\/+$/, '');
export const MEDIAKIT_MISSING = 'MODELARK_MEDIAKIT_API_KEY and MODELARK_MEDIAKIT_BASE_URL must both be set in .env.local (see .env.example).';
