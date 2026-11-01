// WHAT A RESULT IS, in one place: its type, the name to read, its state, and how to refer to it. The
// @ menu, the drawer, the preview and the agent all read this, so T10 reads the same everywhere.
import { containersOf, findElement } from './model';

export const ASSET_GROUPS = [
  { key: 'cast', label: 'Cast' },
  { key: 'place', label: 'Places' },
  { key: 'prop', label: 'Props' },
  { key: 'take', label: 'Takes' },
  { key: 'cut', label: 'Cuts' },
  { key: 'upload', label: 'Uploads' },
  { key: 'picture', label: 'Pictures' },
];
const ONE = { cast: 'Cast', place: 'Place', prop: 'Prop', take: 'Take', cut: 'Cut', upload: 'Upload', picture: 'Picture' };
const ELEMENT_GROUP = { character: 'cast', location: 'place', prop: 'prop' };

// A name as one word for an @: Morwen's Cottage → Morwens-Cottage.
export const mentionSlug = (name) => String(name || '').replace(/['’]/g, '').trim().replace(/[^\p{L}\p{N}_]+/gu, '-').replace(/^-|-$/g, '');

const groupOf = (s, { ref, v }) => {
  if (ref.at === 'element') return ELEMENT_GROUP[findElement(s, ref.id)?.kind] || 'prop';
  if (ref.at === 'cut') return 'cut';
  if (ref.at === 'take') return 'take';
  if (v.by === 'you') return 'upload';
  return v.kind === 'plate' ? 'picture' : 'take';
};

const stateOf = (v, group) => {
  if (v.status === 'picked') return group === 'take' ? '★ circled' : group === 'cut' ? '★ chosen' : '★ plate';
  if (v.status === 'review') return 'new';
  if (v.status === 'running') return 'rendering';
  if (v.status === 'failed') return 'failed';
  return '';
};

// The one to show of a container's versions: the chosen one, or else the newest still alive.
const isLead = (container, v) => {
  if (!container || container.at !== undefined) return true;
  if (container.picked) return container.picked === v.id;
  const alive = (container.versions || []).filter((x) => x.status !== 'failed' && x.status !== 'rejected' && !x.archived);
  return alive.reduce((a, b) => ((b.at || 0) >= (a?.at || 0) ? b : a), null)?.id === v.id;
};

export const describeAsset = (s, { ref, v, c, label }) => {
  const group = groupOf(s, { ref, v });
  const element = ref.at === 'element' ? findElement(s, ref.id) : null;
  const title = element ? element.name : v.label || (group === 'cut' ? 'Cut' : label) || v.name;
  const lead = ref.at === 'unplaced' ? true : isLead(c || (element || undefined), v);
  return {
    group,
    title,
    detail: [ONE[group], stateOf(v, group), v.res, v.seconds ? `${Math.round(v.seconds)} s` : ''].filter(Boolean).join(' · '),
    lead,
    // Someone's current plate goes by their name; everything else by its short name.
    mention: element && element.picked === v.id ? mentionSlug(element.name) : v.name,
  };
};

// What an @ means: a short name, or a name in Cast & World meaning its current plate.
export const resolveMention = (s, word) => {
  const key = String(word || '').replace(/^@/, '').trim().toLowerCase();
  const matches = s.elements.filter((e) => mentionSlug(e.name).toLowerCase() === key);
  if (matches.length > 1) return { error: `@${word} could mean ${matches.map((e) => e.name).join(' or ')}. Ask the director which.` };
  if (!matches.length) return {};
  const [el] = matches;
  const plate = (el.versions || []).find((v) => v.id === el.picked);
  if (!plate) return { error: `${el.name} has no plate yet.` };
  return { name: plate.name };
};

// Everything in the film that can be cited: for the @ menu and the drawer.
export const filmAssets = (s) => containersOf(s).flatMap(({ ref, c, label }) => (c?.versions || []).map((v) => ({ ref, v, c, label })))
  .filter((x) => x.v.name && ['plate', 'take', 'cut'].includes(x.v.kind) && !x.v.archived)
  .map((x) => ({ ...describeAsset(s, x), id: x.v.id, name: x.v.name, status: x.v.status, at: x.v.at, type: x.v.kind === 'plate' ? 'image' : 'video', url: x.v.cacheUrl || x.v.url || '', poster: x.v.posterUrl || '' }));
