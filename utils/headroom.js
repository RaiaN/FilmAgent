// Headroom (synthetic bracketing): shared limits and keyframe timing, safe for client and server.

export const MAX_KEYFRAMES = 30; // Seedance 2.5 reference images per request
export const DEFAULT_KEYFRAMES = 12;
export const DEFAULT_EV = 2; // stops of underexposure
export const EV_RANGE = [0.5, 4];

// count evenly spaced times from the first frame to the last (0.1 s before the end).
export const keyframeTimes = (count, durationSec) => (count === 1
  ? [0]
  : Array.from({ length: count }, (_, i) => Math.round(((i * Math.max(0, durationSec - 0.1)) / (count - 1)) * 100) / 100));
