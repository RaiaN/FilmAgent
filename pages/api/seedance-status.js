import { CONFIG, getEndpointUrl, arkKey, ARK_KEY_MISSING } from '../../utils/config';
import { checkInUrl as storeCheckInUrl } from '../../utils/server/mediaStore';

// Check a finished output into the two-tier store (local + TOS mirror) SERVER-SIDE, the
// moment we first see it — byte durability must never depend on the browser tab staying
// alive to run a client-side effect. Best-effort: a store hiccup never fails the poll.
const checkInUrl = async (url) => {
  if (!url) return null;
  try { return (await storeCheckInUrl(url)).url; } catch { return null; }
};

async function seedanceStatusHandler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  
    const { taskId, baseUrl } = req.query;
  
    if (!taskId) {
        return res.status(400).json({ error: 'Missing taskId' });
    }

    // The key comes from .env.local only — never from the request, so a key the browser
    // still has stored cannot make every status poll fail with 401.
    const bearerToken = arkKey();
    if (!bearerToken) {
      return res.status(500).json({ error: ARK_KEY_MISSING });
    }
  
    // Use config-defined base URL, fallback to passed baseUrl if provided
    const endpointBase = baseUrl || CONFIG.API_BASE_URL;
    // Construct video endpoint (task status is usually under the same path structure)
    // e.g. /contents/generations/tasks/{taskId}
    // We can use getEndpointUrl('video') which returns .../contents/generations/tasks
    // Then append taskId
    const videoEndpoint = getEndpointUrl('video');
    // However, if baseUrl is custom, getEndpointUrl won't use it.
    // So we need manual construction if baseUrl is provided.
    const statusEndpoint = baseUrl 
        ? `${baseUrl}/contents/generations/tasks/${taskId}`
        : `${videoEndpoint}/${taskId}`;
  
    try {
      const response = await fetch(statusEndpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': 'application/json',
        },
      });
  
      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json({ error: 'Status check failed', details: data });
      }

      // Transform response to simplified format
      // API returns: { id, status: "succeeded", content: { video_url: "..." }, ... }
      const result = {
          id: data.id,
          status: data.status,
      };

      if (data.status === 'succeeded' && data.content) {
          result.video_url = data.content.video_url;
          // The PNG last frame, returned because the task was created with
          // return_last_frame:true — used for shot-to-shot continuity. Field name is
          // tolerant; log the content keys once if none match so it can be corrected live.
          result.last_frame_url = data.content.last_frame_url
              || data.content.last_frame_image_url
              || data.content.last_frame
              || null;
          if (!result.last_frame_url) {
              console.warn('[seedance-status] return_last_frame on but no last-frame field — content keys:', Object.keys(data.content));
          }
          // SOURCE-SIDE durability: the take (and its continuity frame) go into the
          // local store + TOS mirror before the client even learns they exist. The
          // one-time download cost rides this single succeeded poll.
          result.video_cache_url = await checkInUrl(result.video_url);
          result.last_frame_cache_url = await checkInUrl(result.last_frame_url);
      }

      if (data.error) {
          result.error = data.error;
      }
  
      return res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({ error: 'Request failed', details: error.message });
    }
  }
  
  export default seedanceStatusHandler;
