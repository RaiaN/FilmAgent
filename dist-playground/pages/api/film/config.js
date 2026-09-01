// Non-secret deployment info the page needs: which Seedance model ids are configured,
// and whether the server holds an API key. No secret ever crosses this boundary.
const SLOTS = {
  seedance25: 'MODELARK_MODEL_SEEDANCE_25',
  seedance: 'MODELARK_MODEL_SEEDANCE',
  seedanceFast: 'MODELARK_MODEL_SEEDANCE_FAST',
  seedanceMini: 'MODELARK_MODEL_SEEDANCE_MINI',
};

export default function handler(req, res) {
  const models = {};
  Object.entries(SLOTS).forEach(([slot, envVar]) => {
    const id = (process.env[envVar] || '').trim();
    if (id) models[slot] = id;
  });
  return res.status(200).json({
    models,
    hasServerKey: !!(process.env.MODELARK_API_KEY || process.env.ARK_API_KEY),
    missing: Object.keys(SLOTS).filter((s) => !models[s]),
  });
}
