// The ModelArk artifact verifier's own input limits (CreateArkOfficialResultQuery docs).
// Shared by /api/ark-official and the Verify tab.
export const VERIFY_LIMITS = {
  image: { formats: ['png', 'jpg', 'jpeg', 'heic', 'webp'], maxBytes: 20 * 1024 * 1024 },
  video: { formats: ['mp4', 'mov', 'avi'], maxBytes: 100 * 1024 * 1024 },
};

// 'image' | 'video' | null, from a file name's extension.
export const verifyFamilyOfName = (name) => {
  const ext = String(name || '').split('.').pop().toLowerCase();
  return Object.keys(VERIFY_LIMITS).find((f) => VERIFY_LIMITS[f].formats.includes(ext)) || null;
};
