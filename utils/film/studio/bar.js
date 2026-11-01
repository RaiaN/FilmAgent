// THE GENERATE BAR, as data: what it holds, what it starts from on a shot, and the one request it
// makes. What the prompt says is what is sent: a chip only writes its line into the prompt, where
// it can be read and changed.
import { SHOT_TEMPLATES } from '../recipes';
import { videoTraits } from '../suiteConfig';
import { allVersions, findElement, modelOfShot, plateOf } from './model';
import { mentionSlug, resolveMention } from './assets';

export const RATIOS = ['16:9', '9:16', '1:1', '21:9', 'adaptive'];
export const MIN_SECONDS = 5;
export const MAX_TAKES = 4;
const TOKEN = /\{\{el:([a-z0-9-]+)\}\}/g;
const CITATION = /@([\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*)/gu;

const cameraWords = (t) => [t.framing, t.angle, t.move].filter(Boolean).join(', ');
export const CHIPS = [
  { key: 'camera', label: 'Camera', options: SHOT_TEMPLATES.filter(cameraWords).map((t) => ({ label: t.name, words: cameraWords(t) })) },
  { key: 'color', label: 'Color', options: ['Warm amber', 'Cool steel blue', 'Muted, desaturated', 'Rich, saturated', 'Soft pastel', 'High-contrast black and white'].map((words) => ({ label: words, words })) },
  { key: 'lighting', label: 'Lighting', options: ['Soft overcast daylight', 'Golden hour', 'Hard noon sun', 'Low-key, deep shadows', 'Practical lamps only', 'Moonlight'].map((words) => ({ label: words, words })) },
];

const lineOf = (label) => new RegExp(`^${label}: (.*?)\\.?$`, 'm');
export const chipWords = (text, label) => lineOf(label).exec(String(text || ''))?.[1] || '';
// A chip's line in the prompt: set, replaced, or taken out when `words` is empty.
export const setChip = (text, label, words) => {
  const without = String(text || '').replace(new RegExp(`\\n?^${label}: .*$`, 'm'), '').trim();
  return words ? [without, `${label}: ${words}.`].filter(Boolean).join('\n') : without;
};

export const emptyBar = (s) => ({ shotId: null, sceneId: null, text: '', refs: [], seconds: 8, ratio: '16:9', model: s?.videoModel || 'seedance25', quality: 'draft', audio: true, count: 1, parent: null, source: null });

const clampSeconds = (model, n) => Math.max(MIN_SECONDS, Math.min(videoTraits(model).maxSeconds, Math.round(Number(n) || MIN_SECONDS)));

// A shot's elements in the order they are sent: people, props, then places.
const usableOf = (s, shot) => (shot.elementIds || []).map((id) => findElement(s, id)).filter(Boolean);
const ORDER = { character: 0, prop: 1, location: 2 };

// The bar on a shot: its words with everyone who has a plate cited by name, and those plates.
export const barForShot = (s, sceneId, shot) => {
  const model = modelOfShot(s, shot);
  const text = String(shot.motion || shot.quote || '').replace(TOKEN, (m, id) => {
    const el = findElement(s, id);
    if (!el) return 'someone';
    return plateOf(el) ? `@${mentionSlug(el.name)}` : el.name;
  });
  const refs = usableOf(s, shot).filter((el) => plateOf(el)).sort((a, b) => (ORDER[a.kind] ?? 3) - (ORDER[b.kind] ?? 3)).map((el) => mentionSlug(el.name));
  return { ...emptyBar(s), shotId: shot.id, sceneId, text, refs, seconds: clampSeconds(model, shot.seconds), model };
};

// Reworking a take: its prompt and references again, as a new take beside it.
export const barToRework = (s, ref, v) => ({ ...emptyBar(s), shotId: ref.shotId || null, sceneId: ref.sceneId || null, text: v.prompt || '', refs: v.refs || [], seconds: clampSeconds(v.model || s.videoModel, v.seconds), ratio: v.ratio || '16:9', model: v.model || s.videoModel, parent: v.name });
// Editing a take: only what the words name changes.
export const barToEdit = (s, ref, v, words = '') => ({ ...emptyBar(s), shotId: ref.shotId || null, sceneId: ref.sceneId || null, text: `Edit @${v.name}: ${words}`, model: v.model || s.videoModel, source: v.name });

const versionCited = (s, word) => {
  const name = resolveMention(s, word).name || word.toUpperCase();
  return allVersions(s).find((x) => x.v.name === name)?.v || null;
};
const isClip = (v) => v.kind === 'take' || v.kind === 'cut';
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// The tool and arguments the bar's Generate calls. A name cited in the prompt rides as a reference
// by itself; the tool refuses anything it can't find.
export const requestOf = (s, bar) => {
  const cited = [...String(bar.text).matchAll(CITATION)].map((m) => m[1]);
  const clips = cited.filter((w) => { const v = versionCited(s, w); return v && isClip(v); });
  const pictures = cited.filter((w) => !clips.some((c) => same(c, w)));
  const refs = [...bar.refs];
  pictures.forEach((w) => { if (!refs.some((r) => same(r, w))) refs.push(w); });
  if (bar.source) return { tool: 'edit_video', args: { source: bar.source, prompt: bar.text, refs, model: bar.model } };
  return { tool: 'generate_video', args: { prompt: bar.text, refs, video_refs: [...new Set(clips)], seconds: bar.seconds, ratio: bar.ratio, model: bar.model, quality: bar.quality, audio: bar.audio, ...(bar.shotId ? { shot_id: bar.shotId } : {}), ...(bar.parent ? { parent: bar.parent } : {}) } };
};

// What Generate will make, said on the button.
export const barSummary = (bar) => {
  if (bar.source) return `An edit of ${bar.source} · 1080p MOV`;
  const each = bar.quality === 'draft' ? 'draft' : 'final';
  return `${bar.count} ${each}${bar.count === 1 ? '' : 's'} · ${bar.seconds} s · ${bar.quality === 'draft' ? '480p' : '1080p MOV'}`;
};

// Who and what a shot still needs: elements with no plate, and views with no plate.
export const needsOfShot = (s, shot) => {
  const els = usableOf(s, shot).filter((el) => !plateOf(el));
  const views = els.filter((el) => el.viewOf);
  // A view is drawn from its place's plate, so a place with a view to draw is needed too.
  const places = views.map((el) => findElement(s, el.viewOf)).filter((el) => el && !plateOf(el));
  return { names: [...new Set([...els.filter((el) => !el.viewOf), ...places].map((el) => el.name))], views: views.length };
};
export const needsOfScene = (s, scene) => {
  const all = scene.shots.map((sh) => needsOfShot(s, sh));
  return { names: [...new Set(all.flatMap((n) => n.names))], views: all.reduce((n, x) => n + x.views, 0) };
};
