// WHAT BELONGS TO A PROJECT: an asset is a project's if it was added there, or if the project uses it.
// Using counts by what the saved project refers to, so uploads from before assets were stamped with a
// project find their film too. `manifest` is the saved project: its media keys and its JSON.
import { allVersions } from './studio/model';

const STORE_KEY = /[?&]key=([a-f0-9]{16,64}\.[a-z0-9]{1,5})/;

export const usesOf = (manifest) => ({
  media: new Set(manifest?.media || []),
  json: manifest?.project ? JSON.stringify(manifest.project) : '',
});

export const belongsTo = (item, projectId, uses) => {
  if (item.project === projectId) return true;
  const key = STORE_KEY.exec(String(item.url || ''))?.[1];
  if (key && uses.media.has(key)) return true;
  if (!uses.json) return false;
  return !!((item.assetId && uses.json.includes(item.assetId)) || (item.url && uses.json.includes(item.url)));
};

// A film's own plates and takes, as Library items, for those made before everything went in the Library.
export const filmAssets = (studio, known = []) => {
  if (!studio) return [];
  const seen = new Set(known.map((it) => it.url));
  const kindOf = (v) => (v.kind === 'plate' ? 'image' : v.kind === 'take' || v.kind === 'cut' ? 'video' : null);
  return allVersions({ scenes: [], elements: [], ...studio })
    .filter(({ v }) => kindOf(v) && (v.cacheUrl || v.url) && !v.archived && v.status !== 'failed' && v.status !== 'running' && v.status !== 'rejected')
    .filter(({ v }) => !seen.has(v.cacheUrl || v.url))
    .map(({ v, label }) => ({ id: `film:${v.id}`, fromFilm: true, url: v.cacheUrl || v.url, thumb: v.posterUrl || null, assetId: v.assetId || null, name: v.label || (v.name ? `${v.name} ${label}` : label), kind: kindOf(v) }));
};
