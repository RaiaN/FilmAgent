import { presignStoreUrl } from '../../../utils/server/presignStore';

// Tech Test report export: stored files → links a reader outside this app can open.
//   POST { urls: [media-store urls] } → { links: { [url]: presigned url } }   (7 days, the presign maximum)
const SEVEN_DAYS = 7 * 24 * 3600;

export default async function techTestPresignHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const urls = Array.isArray(req.body?.urls) ? [...new Set(req.body.urls.map(String))] : [];
  if (!urls.length) return res.status(400).json({ error: 'urls[] is required' });
  try {
    const links = {};
    const missing = [];
    for (const u of urls) {
      const signed = await presignStoreUrl(u, { expires: SEVEN_DAYS }); // eslint-disable-line no-await-in-loop
      if (signed && /^https?:\/\//.test(signed)) links[u] = signed; else missing.push(u);
    }
    if (missing.length) return res.status(500).json({ error: `${missing.length} file(s) could not be presigned — check the TOS settings in .env.local.`, missing });
    return res.status(200).json({ links });
  } catch (error) {
    return res.status(500).json({ error: `Presign failed: ${error.message}` });
  }
}
