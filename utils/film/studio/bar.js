// THE GENERATE BAR, as data: what it holds, what it starts from on a shot, and the one request it
// makes. What the prompt says is what is sent.
import { videoTraits } from '../suiteConfig';
import { allVersions, findElement, modelOfShot, plateOf } from './model';
import { mentionSlug, resolveMention } from './assets';

export const RATIOS = ['16:9', '9:16', '1:1', '21:9', 'adaptive'];
export const MIN_SECONDS = 5;
export const MAX_TAKES = 4;
const TOKEN = /\{\{el:([a-z0-9-]+)\}\}/g;
const CITATION = /@([\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*)/gu;

export const emptyBar = (s) => ({ shotId: null, sceneId: null, text: '', refs: [], seconds: 8, ratio: '16:9', model: s?.videoModel || 'seedance25', quality: 'draft', resolution: '1080p', audio: true, count: 1, parent: null, source: null });

const clampSeconds = (model, n) => Math.max(MIN_SECONDS, Math.min(videoTraits(model).maxSeconds, Math.round(Number(n) || MIN_SECONDS)));

// A shot's elements in the order they are sent: people, props, then places.
const usableOf = (s, shot) => (shot.elementIds || []).map((id) => findElement(s, id)).filter(Boolean);
const ORDER = { character: 0, prop: 1, location: 2 };
export const elementsOfShot = (s, shot) => usableOf(s, shot).sort((a, b) => (ORDER[a.kind] ?? 3) - (ORDER[b.kind] ?? 3));

// The bar on a shot: its words with everyone who has a plate cited by name, and those plates.
export const barForShot = (s, sceneId, shot) => {
  const model = modelOfShot(s, shot);
  const text = String(shot.motion || shot.quote || '').replace(TOKEN, (m, id) => {
    const el = findElement(s, id);
    if (!el) return 'someone';
    return plateOf(el) ? `@${mentionSlug(el.name)}` : el.name;
  });
  const refs = elementsOfShot(s, shot).filter((el) => plateOf(el)).map((el) => mentionSlug(el.name));
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
  // Pressing Generate is the director asking, so inputs that failed before may go again.
  if (bar.source) return { tool: 'edit_video', args: { source: bar.source, prompt: bar.text, refs, model: bar.model, director_asked_retry: true } };
  return { tool: 'generate_video', args: { prompt: bar.text, refs, video_refs: [...new Set(clips)], seconds: bar.seconds, ratio: bar.ratio, model: bar.model, quality: bar.quality, ...(bar.quality === 'final' ? { resolution: bar.resolution } : {}), audio: bar.audio, director_asked_retry: true, ...(bar.shotId ? { shot_id: bar.shotId } : {}), ...(bar.parent ? { parent: bar.parent } : {}) } };
};

// A model change keeps what the new model can do.
export const barOnModel = (bar, model) => {
  const traits = videoTraits(model);
  return { ...bar, model, seconds: Math.min(bar.seconds, traits.maxSeconds), resolution: (traits.movAt || []).includes(bar.resolution) ? bar.resolution : '1080p' };
};

// What Generate will make, said on the button.
export const barSummary = (bar) => {
  if (bar.source) return `An edit of ${bar.source} · 1080p MOV`;
  const each = bar.quality === 'draft' ? 'draft' : 'final';
  return `${bar.count} ${each}${bar.count === 1 ? '' : 's'} · ${bar.seconds} s · ${bar.quality === 'draft' ? '480p' : `${bar.resolution} MOV`}`;
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
