// Client for the CLOUD project store (/api/film/cloud) — save/list/load whole projects
// against the user's TOS bucket. Bytes are mirrored at generation time; save writes the
// manifest (object keys only — nothing in a cloud save can expire), load returns the
// project for the normal load path (the read-through media route streams the bytes).

const err = async (res, fallback) => {
  let msg = fallback;
  try { const d = await res.json(); msg = d?.error || fallback; } catch { /* keep fallback */ }
  return new Error(msg);
};

export const saveProjectToCloud = async (project) => {
  const res = await fetch('/api/film/cloud', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project }),
  });
  if (!res.ok) throw await err(res, `Cloud save failed (HTTP ${res.status})`);
  return res.json(); // { ok, projectId, mediaCount, uploadedNow, rescuedInline, missing[] }
};

export const listCloudProjects = async () => {
  const res = await fetch('/api/film/cloud?action=list');
  if (!res.ok) throw await err(res, `Cloud list failed (HTTP ${res.status})`);
  return (await res.json()).items || [];
};

export const loadCloudProject = async (id) => {
  const res = await fetch(`/api/film/cloud?action=load&id=${encodeURIComponent(id)}`);
  if (!res.ok) throw await err(res, `Cloud load failed (HTTP ${res.status})`);
  return res.json(); // { project, media[], savedAt, name }
};

// ---- last-open pointer (localStorage) — what a page REFRESH restores -------------
// {kind:'cloud', id} | {kind:'path', path}. Written on every successful save/open;
// cleared by "New". Tiny by design: the pointer names the project, the cloud/folder
// hold the state.
const LAST_KEY = 'film-agent-last-project';
export const setLastProjectPointer = (p) => { try { localStorage.setItem(LAST_KEY, JSON.stringify(p)); } catch { /* private mode etc. */ } };
export const getLastProjectPointer = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { return null; } };
export const clearLastProjectPointer = () => { try { localStorage.removeItem(LAST_KEY); } catch { /* noop */ } };

// Warm the read-through cache after a cloud load — fire-and-forget, small concurrency,
// so tiles the user hasn't scrolled to yet are already local when they get there.
export const prefetchCloudMedia = (keys = [], concurrency = 4) => {
  const queue = [...keys];
  const next = () => {
    const key = queue.shift();
    if (!key) return;
    fetch(`/api/film/media?key=${encodeURIComponent(key)}`).catch(() => {}).finally(next);
  };
  for (let i = 0; i < concurrency; i += 1) next();
};
