import { checkInBytes } from '../../../utils/server/mediaStore';

// A local video for enhancement, sent as RAW bytes (no base64 JSON — inputs can be
// hundreds of MB). It is checked into the media store, which mirrors it to TOS; the
// enhance route presigns that object so MediaKit can download it.
export const config = { api: { bodyParser: false } };

export default async function mediakitUploadHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    if (!buf.length) return res.status(400).json({ error: 'Empty upload.' });
    const { key, url } = await checkInBytes(buf, req.headers['content-type']);
    return res.status(200).json({ key, url });
  } catch (error) {
    return res.status(500).json({ error: `Upload failed: ${error.message}` });
  }
}
