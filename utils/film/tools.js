// FILM TOOLS — what an agent's hands and eyes can do to a film, whichever harness runs the agent.
// Each tool is a plain async function over the project's one state, the same film Studio shows:
// pictures and videos are versions with short names (R1, T1), kept in Cast & World, on shots, or
// unplaced until they are given a place, and everything added or made also goes in the Library.
// The agent writes the prompts from the skills. What must hold whatever the agent decides is checked
// here: nothing is dropped or swapped, a prompt cites only what it was given, an edit reads as an
// edit, and inputs that already failed are not rendered again unless the director asked.
import { startTake } from './core/shoot';
import { composeShotAction } from './core/shot';
import { CAST_ROLE, castDraftFromParsed, castPlanFromIdea, plateEdit, storyboardKeyframe, storyboardPanels, storyboardSheet } from './core/storyboard';
import { ANIMATIC_MODEL, ANIMATIC_RATIO, SCHEMATIC_STYLE_LOCK, previzAnimaticPrompt, previzCutPrompt, previzPlan, previzSchematic, totalSecondsOf } from './core/previz';
import { characterVariations, finishDraft, locationVariations } from './core/operations';
import { DRAFT_MODE, clampShotSeconds, clampSizeForModel, defaultImageModelKey, draftFinalsOf, getModel, videoTraits } from './suiteConfig';
import { ELEMENT_KINDS, addVersion, allVersions, containersOf, emptyStudio, findShot, loadStudio, namedText, newElement, newScene, newShot, patchVersion, pickVersion, plateOf, rejectVersion, scriptHash, shotNumber, takeOf, uid, updateContainer, usedOf, withFilmStyle } from './studio/model';
import { mergeStudio, nameVersions, withRemovals } from './studio/sync';
import { applyShotList } from './studio/layout';
import { shotList } from './core/shotList';
import { parseScript } from './core/scriptForm';
import { writeScreenplay } from './core/story';
import { crewStep } from './skills';
import { describeAsset, mentionSlug, resolveMention } from './studio/assets';
import { isNetworkError } from './agentRules.mjs';
import { isLocalMediaUrl } from './mediaUrl';

const VIDEO_KEYS = ['seedance25', 'seedance25Premium'];
const IMAGE_KEYS = ['seedream', 'seedreamPro', 'seedream55'];
const IMAGE_EDIT_MODEL = 'seedreamPro';
const DRAFT_RES = DRAFT_MODE.resolution;
const FINAL_RES = '1080p';
const LOOK_POINTS = [0.05, 0.25, 0.45, 0.65, 0.85, 0.98];
const WAIT_LIMIT_S = 240;
const FRAME_S = 0.05;
const POLL_MS = 4000;
const SAVE_ATTEMPTS = 6;
const EDIT_WORDS = /\b(edit|add|insert|remove|delete|modify|replace|change)/i;
const UNPLACED = { at: 'unplaced' };
const BY = 'filmcode';

const str = (description) => ({ type: 'string', description });
const names = (description) => ({ type: 'array', items: { type: 'string' }, description });
const PROJECT = { project: str('The project id.') };
const tool = (name, description, properties, required = []) => ({ type: 'function', name, description, parameters: { type: 'object', properties, required } });

export const FILM_TOOLS = [
  tool('ensure_project', 'Make sure the film exists.', { ...PROJECT, name: str('Its name, if it is new.') }, ['project', 'name']),
  tool('add_media', "Bring the director's image or video into the film and the Library. It gets a name: R1 for a picture, T1 for a video.", { ...PROJECT, data_url: str('The file as a base64 data URL.'), url: str('Or a http(s) or media-store URL.'), label: str('What it is, in a few words.') }, ['project']),
  tool('list_project', 'The film: script, Cast & World, scenes and shots, and every picture and video with its name, status, place, parent and tags. Optionally only one tag.', { ...PROJECT, tag: str('Only results with this tag.') }, ['project']),
  tool('read_result', 'One result in full, with the prompt and references it was made from.', { ...PROJECT, name: str('Its name, e.g. T3.') }, ['project', 'name']),
  tool('read_skill', 'Read a craft skill: how to prompt a model or how to edit. With no id, lists the skills.', { id: str('A skill id, e.g. sd25-pe or sd-editing.') }),
  tool('search_library', "Search this film's Library: every picture and video it has used, including from Canvas. Returns items you can bring in with use_from_library.", { ...PROJECT, query: str('Words in the name. Empty lists the newest.'), kind: { type: 'string', enum: ['image', 'video'] } }, ['project']),
  tool('use_from_library', 'Bring a Library item into this film. It gets a name here.', { ...PROJECT, id: str('The Library item id.') }, ['project', 'id']),
  tool('add_scene', 'Add a scene to the film, after the last one. Renders nothing.', { ...PROJECT, title: str('Its title.'), place: str('Where it happens, if known.'), text: str('What happens, if known.') }, ['project', 'title']),
  tool('add_shot', 'Add a shot to a scene, after its last shot. Renders nothing. Shoot it with generate_video and shot_id.', { ...PROJECT, scene_id: str('The scene, from list_project or add_scene.'), title: str('Its title.'), seconds: { type: 'number', description: 'Its length in seconds, if known.' }, text: str("What the shot is, in the director's words.") }, ['project', 'scene_id', 'title']),
  tool('place', 'Give a result its place in the film: a picture to someone or something in Cast & World (it becomes their plate), a video to a shot. A new name in element adds them to Cast & World.', { ...PROJECT, name: str('The result, e.g. R1.'), element: str('Who or what the picture is, e.g. Morwen.'), kind: { type: 'string', enum: ELEMENT_KINDS }, description: str('A short description, for a new element.'), shot_id: str('For a video: the shot, from list_project.') }, ['project', 'name']),
  tool('pick', 'Make a picture the plate of its element. Only when the director asked. A take needs no pick: the newest on a shot stands until rejected.', { ...PROJECT, name: str('The result.') }, ['project', 'name']),
  tool('reject', 'Reject a result. Only when the director asked.', { ...PROJECT, name: str('The result.') }, ['project', 'name']),
  tool('generate_image', 'Make a picture from a prompt, optionally from pictures in the film. Cite a picture in the prompt by its name, @R1 or @Morwen; it must be in refs. Returns when it is done.', { ...PROJECT, prompt: str('The prompt.'), refs: names('Pictures it is made from, in order.'), model: { type: 'string', enum: IMAGE_KEYS }, size: str('e.g. 2K, or WxH. seedream55 renders up to 3840x2160 (4K as WxH) and up to 10 refs; seedreamPro caps at 2048x2048.'), label: str('What it is.') }, ['project', 'prompt']),
  tool('write_screenplay', "Write a screenplay from the director's idea and make it the film's script. Their earlier text stays as a version. Returns when it is done.", { ...PROJECT, idea: str("The idea, the director's words unchanged."), note: str("The director's note, if any.") }, ['project', 'idea']),
  tool('shot_list', "Break a screenplay down into scenes and their shots, and lay the film out from it: scenes, shots, and everyone and everywhere it names, waiting for plates. Uses the film's script unless given one. Returns when it is done.", { ...PROJECT, script: str("The screenplay, the director's words unchanged."), note: str("The director's note, if any."), replace: { type: 'boolean', description: 'Only when the director agreed to replace the scenes the film has, and their takes.' } }, ['project']),
  tool('scene_views', "Draw the camera views a scene's shots need, each an edit of the place's plate so every view is the same room in the same light. Returns when it is done.", { ...PROJECT, scene_id: str('The scene, from list_project.') }, ['project', 'scene_id']),
  tool('cast', "Cast the film: plan the characters, places and props from the script or the director's words, and draw a plate for each in Cast & World under their names. A character gets a frontal face plate and a full-body sheet. Anyone already plated is left alone. Returns when it is done.", { ...PROJECT, brief: str("Who or what to cast, the director's words unchanged. Leave out to cast from the film's script."), note: str("The director's note, if any."), names: names('Exactly who and what to draw, under exactly these names. Nothing else is drawn.') }, ['project']),
  tool('variations', "More pictures of one element, each an edit of its plate so identity and place hold: background plates of a location (other angles, times, weather), looks of a character (costume, age). With no plate yet, one is drawn from the description first and becomes the plate. New ones sit beside the plate. Returns when it is done.", { ...PROJECT, element: str('Who or where, e.g. Morwen or The Harbour.'), kind: { type: 'string', enum: ELEMENT_KINDS, description: 'Only if the element is new.' }, description: str('What it looks like, for an element with no plate.'), direction: str("What should differ, the director's words unchanged."), count: { type: 'integer', minimum: 1, maximum: 8, description: 'How many. Defaults to 4.' } }, ['project', 'element']),
  tool('storyboard', "Draw a storyboard: the script's key moments as numbered panels on ONE sheet. Uses the film's script unless given one, and each location's plate by its place. Comes back with every panel's motion prompt and length, ready for generate_video. Returns when it is done.", { ...PROJECT, script: str("The script, the director's words unchanged. Leave out to use the film's script."), panels: { type: 'integer', minimum: 1, description: 'How many panels, only if the director named a number. Left out, the story decides.' }, refs: names('Pictures of the cast and world, in order.'), style: str('The look, if they named one.'), note: str("The director's note on what to select."), label: str('What it is.') }, ['project']),
  tool('previz', "Block a scene: plan who stands where, who moves, the cameras and timing, and draw it as a top-down schematic. Change the drawing with edit_image; the animatic follows the drawing. Returns when it is done.", { ...PROJECT, brief: str("The scene, the director's words unchanged."), camera: str('Their camera wishes, if any.'), label: str('What it is.') }, ['project', 'brief']),
  tool('previz_animatic', 'Start the moving blockout of a schematic: a draft with no sound, cut by the planned cameras, each person a coloured block. Returns at once; use wait.', { ...PROJECT, schematic: str('The schematic, from previz or an edit of it.'), label: str('What it is.'), director_asked_retry: { type: 'boolean', description: 'Only when the director asked to render inputs that already failed.' } }, ['project', 'schematic']),
  tool('previz_shot_prompt', 'Watch an animatic and write the prompt for the real scene: the named people, the place, the moves and the cuts, citing the animatic by name. Renders nothing.', { ...PROJECT, animatic: str('The animatic.') }, ['project', 'animatic']),
  tool('grab_frame', 'Take one frame of a video as a picture in the film, from the master, to use as a reference. Renders nothing.', { ...PROJECT, name: str('The video, e.g. T3.'), at: { type: 'number', description: 'Seconds into it.' }, last: { type: 'boolean', description: 'Its last frame instead.' } }, ['project', 'name']),
  tool('edit_image', "Edit a picture from the director's words, optionally with their drawn marks. The new version sits beside the picture it edits. Returns when it is done.", { ...PROJECT, source: str('The picture to edit, e.g. R1.'), marked: str('The copy with their red marks on it, if they drew any.'), instruction: str("The director's words, unchanged."), label: str('What it is.') }, ['project', 'source', 'instruction']),
  tool('generate_video', 'Start a new take from a prompt and references. In the prompt, cite each reference by its name, @R1, @Morwen or @T3: every name cited must be in refs or video_refs, and code numbers them for the model. Returns at once; use wait.', { ...PROJECT, prompt: str('The prompt.'), refs: names('Reference pictures, in citation order.'), video_refs: names('Reference videos, in citation order.'), seconds: { type: 'number', description: 'Length in seconds.' }, ratio: str('e.g. 16:9, 9:16, adaptive.'), model: { type: 'string', enum: VIDEO_KEYS }, quality: { type: 'string', enum: ['draft', 'final'], description: 'draft is 480p and can be finished later. final is MOV now.' }, resolution: str('For a final: 1080p, or 4K on seedance25Premium.'), audio: { type: 'boolean', description: 'Generate sound. Defaults to on.' }, label: str('What it is.'), shot_id: str('The shot this take is for, from list_project or add_shot. Left out, it waits unplaced.'), parent: str('The result this one reworks, if any.'), director_asked_retry: { type: 'boolean', description: 'Only when the director asked to render inputs that already failed.' } }, ['project', 'prompt', 'seconds', 'quality']),
  tool('edit_video', 'Start an edit of a video: only what the prompt names changes. It must read as an instruction and cite the source by its name, e.g. @T3; cite pictures by name too, each in refs. Length and shape follow the source. Always 1080p MOV: there is no draft edit. Returns at once; use wait.', { ...PROJECT, source: str('The video to edit, e.g. T3.'), prompt: str('The instruction.'), refs: names('Pictures the edit uses, in citation order.'), model: { type: 'string', enum: VIDEO_KEYS }, label: str('What it is.'), director_asked_retry: { type: 'boolean', description: 'Only when the director asked to render inputs that already failed.' } }, ['project', 'source', 'prompt']),
  tool('finish', 'Start the full-resolution final of a draft: the same picture, MOV. Returns at once; use wait.', { ...PROJECT, name: str('The draft.'), resolution: str('1080p, or 4K on seedance25Premium.') }, ['project', 'name']),
  tool('wait', `Wait for renders to end, up to ${WAIT_LIMIT_S} seconds at a time. Name only renders a tool has returned. Call again for what is still running.`, { ...PROJECT, names: names('The renders.') }, ['project', 'names']),
  tool('look', 'See a finished result. A video comes back with its frames, its technical facts, its volume and its own URL.', { ...PROJECT, name: str('Its name.'), at: { type: 'array', items: { type: 'number' }, description: 'Seconds to see frames at, instead of across its length.' } }, ['project', 'name']),
  tool('label', 'Organise results: set a label and add or remove tags, e.g. scene 2. Renders nothing.', { ...PROJECT, names: names('The results.'), label: str('Its label.'), add_tags: names('Tags to add.'), remove_tags: names('Tags to remove.') }, ['project', 'names']),
  tool('archive', 'Take results out of sight, or bring them back. Renders nothing.', { ...PROJECT, ids: names('Version ids.'), archived: { type: 'boolean' } }, ['project', 'ids', 'archived']),
  tool('forget_media', 'A file was deleted: take it out of the unplaced pool, and say what else still uses it.', { ...PROJECT, url: str('The file.') }, ['project', 'url']),
  tool('merge_film', 'Bring a Studio tab\'s copy of the film into the saved film, creating it if it is new.', { ...PROJECT, name: str('Its name, if it is new.'), studio: { type: 'object', description: 'The film as the tab holds it.' } }, ['project', 'studio']),
  tool('enhance_prompt', "Rewrite a video prompt under the model's prompt skill, for the director to read before anything renders. Citations, dialogue and events stay. Renders nothing.", { ...PROJECT, prompt: str('The prompt.'), refs: names('Reference pictures.'), video_refs: names('Reference videos.'), model: { type: 'string', enum: VIDEO_KEYS } }, ['project', 'prompt']),
  tool('assemble', "Join each shot's newest take, in film order, into one cut. Renders nothing.", { ...PROJECT, without_missing: { type: 'boolean', description: 'Only when the director agreed to leave out shots with no take yet.' } }, ['project']),
  tool('settle_renders', 'Record every render of this film that has ended.', PROJECT, ['project']),
  tool('results', 'The film for the preview and Generations.', PROJECT, ['project']),
  tool('read_transcript', 'The session as saved.', PROJECT, ['project']),
  tool('save_transcript', 'Save the session.', { ...PROJECT, transcript: { type: 'array', items: { type: 'object' } } }, ['project', 'transcript']),
];

const typeOf = (v) => (v.kind === 'take' || v.kind === 'cut' ? 'video' : v.kind === 'plate' ? 'image' : null);
const mediaOf = (v) => v.cacheUrl || v.url;
const media = (s) => containersOf(s).flatMap(({ ref, c, label, scope }) => (c?.versions || []).map((v) => ({ ref, v, c, label, scope }))).sort((a, b) => (b.v.at || 0) - (a.v.at || 0)).filter((x) => typeOf(x.v));
const byName = (s, id) => media(s).find((x) => x.v.id === id)?.v.name || null;
const originOf = (v) => (v.footage || v.by === 'you' ? 'you' : v.final ? 'final' : v.edit ? 'edit' : 'generated');
const brief = (s, x) => {
  const { v, label: where } = x;
  const about = describeAsset(s, x);
  return {
  name: v.name,
  about: `${about.title} (${about.detail})`,
  ...(about.mention !== v.name ? { also_called: `@${about.mention}` } : {}),
  type: typeOf(v),
  by: originOf(v),
  status: v.status,
  place: where,
  ...(v.label ? { label: v.label } : {}),
  ...(v.parent && byName(s, v.parent) ? { parent: byName(s, v.parent) } : {}),
  ...(v.res ? { res: v.res } : {}),
  ...(v.seconds ? { seconds: v.seconds } : {}),
  ...(v.draft ? { can_finish: true } : {}),
  ...(v.tags?.length ? { tags: v.tags } : {}),
  ...(v.error ? { error: v.error } : {}),
  };
};
// @Morwen is Morwen's current plate.
const plateNamed = (s, word) => {
  const { name, error } = resolveMention(s, word);
  if (error) fail(error);
  return name || null;
};
const fingerprintOf = (x) => JSON.stringify(x);
const fail = (message) => { throw new Error(message); };
const queues = new Map();
const oneAtATime = (id, work) => {
  const run = (queues.get(id) || Promise.resolve()).then(work, work);
  queues.set(id, run.catch(() => {}));
  return run;
};

// Prompts cite references by name, so adding, dropping or reordering them can't make a citation mean
// a different picture. The numbers the models read are made here, from this render's own lists.
const NUMBERED = /(?:@|\[|\()\s*(?:image|video)\s?\d+/i;
const CITATION = /@([\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*)/gu;
// The prompt skill lists the assets a render leaves unused. A render's assets are its references, so a
// line there naming someone outside them points at nothing the model is given: it goes.
const UNUSED = /(【Unused Assets】[^\n]*)\n?([\s\S]*?)(?=\n\s*【|$)/;
const dropUnusedOutside = (prompt, inRender) => String(prompt).replace(UNUSED, (whole, head, body) => {
  const kept = body.split('\n').filter((line) => [...line.matchAll(CITATION)].every(([, word]) => inRender(word)));
  return kept.some((l) => l.trim()) ? `${head}\n${kept.join('\n')}` : '';
}).replace(/\n{3,}/g, '\n\n').trim();
export const citeNumbers = (prompt, resolve, { images = [], videos = [], imageTag = (n) => `@Image${n}` }) => {
  const numbered = NUMBERED.exec(prompt);
  if (numbered) fail(`Cite references by name, like @R1 or @Morwen, not "${numbered[0]}".`);
  const ids = new Set([...images, ...videos].map((v) => v.id));
  const inRender = (word) => { try { return ids.has(resolve(word).id); } catch { return false; } };
  return dropUnusedOutside(prompt, inRender).replace(CITATION, (whole, word) => {
    const { id, name } = resolve(word);
    const image = images.findIndex((v) => v.id === id);
    if (image >= 0) return imageTag(image + 1);
    const video = videos.findIndex((v) => v.id === id);
    if (video >= 0) return `@Video${video + 1}`;
    return fail(`The prompt cites ${whole} (${name}), which is not a reference of this render. Add it to the references, or rewrite that part of the prompt.`);
  });
};
export const checkEditPrompt = (prompt) => {
  if (!/@video\s?1\b/i.test(prompt)) fail('An edit must cite its source by name, e.g. @T3. Without it Seedance renders something new.');
  if (!EDIT_WORDS.test(prompt)) fail('An edit must read as an instruction: add, remove, replace, modify or change. Without one Seedance renders something new.');
};

export const createFilmTools = ({ api, client, probe, skills, origin = '', sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() }) => {
  const ctx = { client };

  const peek = async (id) => {
    if (!id) fail('Name the project.');
    try {
      const j = await api.get(`/api/film/cloud?action=load&id=${encodeURIComponent(id)}`);
      return { project: j.project, revision: j.revision, studio: nameVersions(loadStudio(j.project.studio)) };
    } catch (e) {
      if (/No cloud save/.test(e.message)) return null;
      throw e;
    }
  };
  const load = async (id) => (await peek(id)) || fail(`There is no film ${id}.`);
  // A change to the film: read it, change it, save on what was read. Changes here go one at a time,
  // and a Studio tab saving first is not a failure of anything: the change is made again on the
  // newer copy. `fn` takes the film and returns [the film, what to answer].
  const change = (id, fn) => oneAtATime(id, async () => {
    for (let i = 0; i < SAVE_ATTEMPTS; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { project, revision, studio } = await load(id);
      const [next, out] = fn(studio);
      const named = nameVersions(next);
      // eslint-disable-next-line no-await-in-loop
      const saved = await api.post('/api/film/cloud', { project: { ...project, studio: named }, writer: 'tools', baseRevision: revision }, { allow: [409] });
      if (!saved.conflict) return typeof out === 'function' ? out(named) : out;
    }
    return fail(`Film ${id} kept changing while saving it.`);
  });
  const find = (s, name) => media(s).find((x) => x.v.name === String(name).replace(/^@/, '').toUpperCase() || x.v.name === plateNamed(s, name)) || fail(`No result ${name}. The film has: ${media(s).map((x) => x.v.name).join(', ') || 'nothing yet'}.`);
  const resolver = (s) => (word) => { const { v } = find(s, word); return { id: v.id, name: v.name }; };
  // A prompt as its render's names, whichever way it was stored.
  const namedPrompt = (s, v) => String(v.prompt || '')
    .replace(/@image\s?(\d+)/gi, (whole, n) => { const name = (v.refs || [])[n - 1]; return name ? `@${name}` : whole; })
    .replace(/@video\s?(\d+)/gi, (whole, n) => { const name = (v.edit ? [byName(s, v.parent)] : v.video_refs || [])[n - 1]; return name ? `@${name}` : whole; });
  const ready = (x) => {
    if (x.v.status === 'running' || x.v.status === 'failed' || x.v.status === 'rejected') fail(`${x.v.name} is ${x.v.status}.`);
    return x.v;
  };
  const pictures = (s, list = []) => list.map((n) => {
    const x = find(s, n);
    if (typeOf(x.v) !== 'image') fail(`${x.v.name} is a video, not a picture.`);
    return ready(x);
  });
  const videos = (s, list = []) => list.map((n) => {
    const x = find(s, n);
    if (typeOf(x.v) !== 'video') fail(`${x.v.name} is a picture, not a video.`);
    return ready(x);
  });
  const inLibrary = (v, name, projectId) => api.post('/api/film/library?action=add', { url: mediaOf(v), assetId: v.assetId || null, name: v.label || name, kind: typeOf(v), project: projectId });
  const poster = async (url) => {
    try {
      const { frames } = await api.post('/api/film/frames', { url, timestamps: [0.5], maxWidth: 480 });
      return frames?.[0]?.url || '';
    } catch { return ''; }
  };
  // Every reference rides as an Asset Library asset; one that can't become one stops the render
  // with its name. Nothing is sent without it.
  const assetsOf = async (id, list) => {
    const ids = [];
    for (const v of list) {
      if (v.assetId) { ids.push(v.assetId); continue; }
      // eslint-disable-next-line no-await-in-loop
      const out = await api.post('/api/film/preserve', { url: mediaOf(v), name: v.name });
      if (!out.assetId) fail(`Could not add ${v.name} to the Asset Library${out.assetError ? `: ${out.assetError}` : ''}. Nothing was rendered.`);
      ids.push(out.assetId);
      // eslint-disable-next-line no-await-in-loop
      await change(id, (s) => { const x = find(s, v.name); return [patchVersion(s, x.ref, x.v.id, { assetId: out.assetId }), null]; });
    }
    return ids;
  };
  const refuseFailed = (s, fingerprint, askedAgain) => {
    if (askedAgain) return;
    const before = media(s).find((x) => x.v.status === 'failed' && x.v.fingerprint === fingerprint);
    if (before) fail(`${before.v.name} failed on exactly these inputs: ${before.v.error}. Tell the director; only they can ask for it again.`);
  };
  const answerFor = (vid) => (n) => brief(n, media(n).find((x) => x.v.id === vid));
  const addNew = (id, base, where = UNPLACED) => {
    const vid = uid('v-');
    return change(id, (s) => [addVersion(s, where, { id: vid, at: now(), by: BY, tags: [], ...base }), answerFor(vid)]);
  };
  // A render shows from the moment it is asked for: getting its references ready can take minutes.
  const start = async (id, base, starter, where) => {
    const made = await addNew(id, { ...base, status: 'running' }, where);
    const settle = (patch) => change(id, (film) => {
      const x = find(film, made.name);
      return [patchVersion(film, x.ref, x.v.id, patch), answerFor(x.v.id)];
    });
    try {
      const { taskId } = await starter();
      return await settle({ taskId });
    } catch (e) {
      return { ...(await settle({ status: 'failed', error: e.message || String(e) })), refused_by_model: true };
    }
  };
  // A take stays where its source is: on the shot, or unplaced.
  const onShot = (ref) => (ref.at === 'take' ? ref : UNPLACED);
  const shotRef = (s, shotId) => {
    const scene = s.scenes.find((sc) => findShot(s, sc.id, shotId)) || fail(`No shot ${shotId}.`);
    return { at: 'take', sceneId: scene.id, shotId };
  };

  // A picture that takes a while: it shows as rendering from the start. `work` answers with the
  // version's finished fields, and `extra` says what else the agent hears about it.
  const drawn = async (id, base, work, extra = () => ({}), where = UNPLACED) => {
    const started = await addNew(id, { ...base, status: 'running' }, where);
    const settle = (patch) => change(id, (film) => {
      const x = find(film, started.name);
      const done = patchVersion(film, x.ref, x.v.id, patch);
      // The first picture an element gets is its plate.
      return [where.at === 'element' && patch.url && !x.c.picked ? pickVersion(done, x.ref, x.v.id, now()) : done, answerFor(x.v.id)];
    });
    let done;
    try {
      done = await work();
    } catch (e) {
      return settle({ status: 'failed', error: e.message || String(e) });
    }
    const added = await settle({ status: 'review', ...done });
    await inLibrary({ url: done.url, kind: 'plate', label: base.label }, added.name, id);
    return { ...added, ...extra(done) };
  };

  // One pass over the renders still running: `only` these names, or everything the agent started.
  // A check that fails leaves its render running for the next pass, and the Library comes first, so
  // a render recorded in the film is always in the Library too. Answers with how many still run.
  const settle = async (id, only) => {
    const { studio: s } = await load(id);
    const open = media(s).filter((x) => x.v.status === 'running' && x.v.taskId && (only ? only.includes(x.v.name) : x.v.by !== 'board'));
    const ended = [];
    for (const x of open) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const st = await api.get(`/api/seedance-status?taskId=${encodeURIComponent(x.v.taskId)}`, { allow: [404, 500, 502, 503, 504] });
        if (st.status === 'succeeded' && st.video_url) {
          // eslint-disable-next-line no-await-in-loop
          const posterUrl = await poster(st.video_cache_url || st.video_url);
          // eslint-disable-next-line no-await-in-loop
          await inLibrary({ ...x.v, url: st.video_url, cacheUrl: st.video_cache_url || null }, x.v.name, id);
          ended.push({ id: x.v.id, patch: {
            status: 'review', url: st.video_url, cacheUrl: st.video_cache_url || null, lastFrameUrl: st.last_frame_cache_url || st.last_frame_url || null, posterUrl: posterUrl || x.v.posterUrl || '',
            format: /\.mov(\?|$)/i.test(st.video_url) ? 'mov' : 'mp4',
            ...(x.v.isDraft ? { draft: { taskId: x.v.taskId, modelKey: x.v.model, at: now() } } : {}),
          } });
        } else if (['failed', 'expired', 'cancelled'].includes(st.status)) {
          ended.push({ id: x.v.id, patch: { status: 'failed', error: st.error?.message || st.error || `The render ${st.status}.` } });
        } else if (!st.status && /not.?found/i.test(JSON.stringify(st.details || ''))) {
          ended.push({ id: x.v.id, patch: { status: 'failed', error: 'Ark no longer has this render.' } });
        }
      } catch (e) {
        if (!isNetworkError(e.message)) throw e;
      }
    }
    // Something else may have recorded it since this pass read the film.
    if (ended.length) {
      await change(id, (film) => [ended.reduce((acc, e) => {
        const x = media(acc).find((y) => y.v.id === e.id);
        return x?.v.status === 'running' ? patchVersion(acc, x.ref, e.id, e.patch) : acc;
      }, film), null]);
    }
    // A 10-bit master can't play in a browser: its copy to watch is ready before anyone opens it.
    ended.filter((e) => e.patch.format === 'mov').forEach((e) => {
      api.post('/api/film/preview', { url: e.patch.cacheUrl || e.patch.url })
        .then(({ url }) => change(id, (film) => {
          const x = media(film).find((y) => y.v.id === e.id);
          return [x ? patchVersion(film, x.ref, e.id, { playUrl: url }) : film, null];
        }))
        .catch(() => {});
    });
    return open.length - ended.length;
  };

  const TOOLS = {
    ensure_project: async ({ project, name }) => {
      if (await peek(project)) return { project };
      await api.post('/api/film/cloud', { project: { id: project, name, title: name, studio: emptyStudio() }, writer: 'tools', baseRevision: null });
      return { project, created: true };
    },

    add_media: async ({ project, data_url, url, label = '' }) => {
      if (!data_url === !url) fail('Give the file as data_url or url, one of them.');
      await load(project);
      const staged = data_url
        ? await api.post('/api/film/upload', { dataUrl: data_url, name: label })
        : await api.post('/api/film/preserve', { url, name: label });
      const source = staged.cacheUrl || staged.url || url;
      const facts = await probe(source);
      if (!/^(image|video)$/.test(facts.type)) fail('Only pictures and videos can be added.');
      const added = await addNew(project, { url: source, assetId: staged.assetId || null, label, kind: facts.type === 'video' ? 'take' : 'plate', by: 'you', footage: facts.type === 'video', status: 'review', seconds: facts.seconds || null, width: facts.width, height: facts.height, ...(facts.type === 'video' ? { posterUrl: await poster(source) } : {}) });
      await api.post('/api/film/library?action=add', { url: source, assetId: staged.assetId || null, name: label || added.name, kind: facts.type, project });
      return { ...added, facts, ...(staged.assetId ? {} : { not_usable_as_reference: staged.assetError || 'It is not in the Asset Library.' }) };
    },

    list_project: async ({ project, tag }) => {
      const { project: p, studio: s } = await load(project);
      return {
        name: p.title || p.name,
        script: s.script || '',
        cast_and_world: s.elements.map((el) => ({ id: el.id, name: el.name, kind: el.kind, description: el.desc, plate: byName(s, el.picked) })),
        scenes: s.scenes.map((sc, i) => ({ id: sc.id, n: i + 1, title: sc.title, text: sc.text, shots: sc.shots.map((sh) => ({ id: sh.id, title: sh.title, seconds: sh.seconds, text: namedText(s, sh.motion), take: takeOf(sh)?.name || null })) })),
        results: media(s).filter((x) => !x.v.archived && (!tag || (x.v.tags || []).includes(tag))).map((x) => brief(s, x)),
      };
    },

    read_result: async ({ project, name }) => {
      const { studio: s } = await load(project);
      const x = find(s, name);
      return { ...brief(s, x), prompt: namedPrompt(s, x.v), refs: x.v.refs || [], video_refs: x.v.video_refs || [], model: x.v.model, ratio: x.v.ratio, ...(x.v.panels ? { panels: x.v.panels } : {}), ...(x.v.plan ? { plan: x.v.plan } : {}) };
    },

    read_skill: async ({ id } = {}) => {
      const list = await skills();
      if (!id) return { skills: list.map((x) => ({ id: x.id, description: x.description })) };
      const hit = list.find((x) => x.id === id);
      if (!hit) fail(`No skill ${id}. Skills: ${list.map((x) => x.id).join(', ')}.`);
      return { id, text: hit.text };
    },

    search_library: async ({ project, query = '', kind }) => {
      const { items = [] } = await api.get(`/api/film/library?project=${encodeURIComponent(project)}&film=1`);
      const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
      const hits = items.filter((it) => (!kind || it.kind === kind) && words.every((w) => String(it.name || '').toLowerCase().includes(w)));
      return { items: hits.slice(0, 40).map((it) => ({ id: it.id, name: it.name, kind: it.kind })), total: hits.length };
    },

    use_from_library: async ({ project, id }) => {
      const { items = [] } = await api.get(`/api/film/library?project=${encodeURIComponent(project)}&film=1`);
      const it = items.find((x) => x.id === id) || fail(`No Library item ${id}.`);
      const { studio: s } = await load(project);
      const there = media(s).find((x) => mediaOf(x.v) === it.url);
      if (there) return brief(s, there);
      const facts = await probe(it.url);
      return addNew(project, { url: it.url, assetId: it.assetId || null, label: it.name, kind: facts.type === 'video' ? 'take' : 'plate', by: 'you', footage: facts.type === 'video', status: 'review', seconds: facts.seconds || null, libraryId: it.id });
    },

    add_scene: ({ project, title, place: where = '', text = '' }) => {
      if (!String(title || '').trim()) fail('Give the scene a title.');
      return change(project, (s) => {
        const scene = newScene(title, { place: where, text });
        return [{ ...s, scenes: [...s.scenes, scene] }, { id: scene.id, n: s.scenes.length + 1, title: scene.title }];
      });
    },

    add_shot: ({ project, scene_id, title, seconds, text = '' }) => {
      if (!String(title || '').trim()) fail('Give the shot a title.');
      return change(project, (s) => {
        if (!s.scenes.some((sc) => sc.id === scene_id)) fail(`No scene ${scene_id}. Scenes: ${s.scenes.map((sc) => `${sc.id} (${sc.title})`).join(', ') || 'none yet'}.`);
        const shot = newShot({ title, seconds, motion: text });
        const next = { ...s, scenes: s.scenes.map((sc) => (sc.id === scene_id ? { ...sc, shots: [...sc.shots, shot] } : sc)) };
        return [next, { id: shot.id, scene_id, title: shot.title, seconds: shot.seconds, n: shotNumber(next, shot.id) }];
      });
    },

    // Placing moves a version out of the unplaced pool. A picture becomes its element's plate.
    place: ({ project, name, element, kind, description = '', shot_id }) => {
      if (!element === !shot_id) fail('Say where it goes: element or shot_id, one of them.');
      return change(project, (s) => {
        const x = find(s, name);
        if (x.ref.at !== 'unplaced') fail(`${x.v.name} already has its place: ${x.label}.`);
        const without = updateContainer(s, UNPLACED, (c) => ({ ...c, versions: c.versions.filter((v) => v.id !== x.v.id) }));
        if (shot_id) {
          if (typeOf(x.v) !== 'video') fail(`${x.v.name} is a picture: a shot takes videos.`);
          return [addVersion(without, shotRef(s, shot_id), x.v), answerFor(x.v.id)];
        }
        if (typeOf(x.v) !== 'image') fail(`${x.v.name} is a video: Cast & World takes pictures.`);
        const known = s.elements.find((e) => e.name.toLowerCase() === String(element).trim().toLowerCase());
        if (!known && !ELEMENT_KINDS.includes(kind)) fail(`${element} is new: say its kind (${ELEMENT_KINDS.join(', ')}).`);
        const el = known || newElement({ kind, name: element, desc: description });
        const ref = { at: 'element', id: el.id };
        const withElement = known ? without : { ...without, elements: [...without.elements, el] };
        return [pickVersion(addVersion(withElement, ref, x.v), ref, x.v.id, now()), answerFor(x.v.id)];
      });
    },

    pick: ({ project, name }) => change(project, (s) => {
      const x = find(s, name);
      if (x.ref.at === 'take') fail(`${x.v.name} is a take: a shot's newest take stands. To go back to an earlier one, reject the newer.`);
      if (x.ref.at === 'unplaced') fail(`${x.v.name} has no place yet: place it first.`);
      ready(x);
      return [pickVersion(s, x.ref, x.v.id, now()), answerFor(x.v.id)];
    }),

    reject: ({ project, name }) => change(project, (s) => {
      const x = find(s, name);
      return [rejectVersion(s, x.ref, x.v.id, now()), answerFor(x.v.id)];
    }),

    generate_image: async ({ project, prompt, refs = [], model = 'seedream', size = '2K', label = '' }) => {
      if (!String(prompt || '').trim()) fail('The prompt is empty.');
      if (!IMAGE_KEYS.includes(model)) fail(`No image model ${model}. Models: ${IMAGE_KEYS.join(', ')}.`);
      const { studio: s } = await load(project);
      const list = pictures(s, refs);
      const sent = citeNumbers(prompt, resolver(s), { images: list, imageTag: (n) => `[Image ${n}]` });
      const base = { kind: 'plate', label, prompt, refs: list.map((v) => v.name), model };
      return drawn(project, base, async () => {
        const out = await api.post('/api/film/imagine', { prompt: sent, referenceImages: list.map(mediaOf), size: clampSizeForModel(model, size), model: getModel(model), optimizePrompt: false });
        return { url: out.cacheUrl || out.url };
      });
    },

    write_screenplay: async ({ project, idea, note = '' }) => {
      if (!String(idea || '').trim()) fail('Say what the film is.');
      const text = await writeScreenplay({ idea, note }, ctx);
      await change(project, (s) => {
        const before = String(s.script || '').trim();
        const kept = before && before !== text ? { ...s, brief: { ...s.brief, versions: [{ id: uid('v-'), at: now(), by: 'you', kind: 'script', status: 'kept', text: before, title: 'Your brief' }, ...s.brief.versions] } } : s;
        return [{ ...kept, script: text, scriptAt: now() }, null];
      });
      return { script: text };
    },

    // Each shot's newest take in film order, as one file. Shots with no take yet are named before
    // anything is made, and left out only when asked.
    assemble: async ({ project, without_missing = false }) => {
      const { studio: s } = await load(project);
      const shots = s.scenes.flatMap((sc) => sc.shots);
      const takes = shots.map(takeOf).filter(Boolean);
      if (!takes.length) fail('No shot has a take yet.');
      if (takes.length < shots.length && !without_missing) fail(`${shots.length - takes.length} of ${shots.length} shots have no take yet.`);
      const out = await api.post('/api/film/stitch', { shots: takes.map((v) => (isLocalMediaUrl(mediaOf(v)) ? `${origin}${mediaOf(v)}` : mediaOf(v))), name: 'Cut' });
      if (!out.cacheUrl) fail('The assembled cut was not stored.');
      const added = await addNew(project, { kind: 'cut', status: 'review', url: out.cacheUrl, cacheUrl: out.cacheUrl, posterUrl: await poster(out.cacheUrl), label: 'Cut', refs: takes.map((v) => v.name), parent: null }, { at: 'cut' });
      await inLibrary({ url: out.cacheUrl, kind: 'cut', label: 'Cut' }, added.name, project);
      return added;
    },

    // The film laid out from its script. Replacing scenes takes their takes with them, so it is
    // asked for by name; what goes stays gone when other copies of the film merge in.
    shot_list: async ({ project, script, note = '', replace = false }) => {
      const { studio: s } = await load(project);
      const text = String(script ?? s.script ?? '').trim();
      if (!text) fail('There is no script: the film has none and none was given.');
      if (parseScript(text).form !== 'screenplay') fail('No scene starts with a slugline (INT. or EXT.), so this is not a screenplay yet. Write one with write_screenplay.');
      if (s.scenes.length && !replace) fail(`The film already has ${s.scenes.length} scene${s.scenes.length === 1 ? '' : 's'}: breaking it down again replaces them and their takes. Only the director can agree to that.`);
      const list = await shotList({ script: text, note }, ctx);
      const payload = { ...list, scriptHash: scriptHash(text) };
      return change(project, (film) => {
        const next = withRemovals(film, applyShotList({ ...film, script: text, scriptAt: now() }, payload));
        return [next, {
          scenes: next.scenes.map((sc, i) => ({ id: sc.id, n: i + 1, title: sc.title, shots: sc.shots.map((sh) => ({ id: sh.id, title: sh.title, seconds: sh.seconds })), ...(list.scenes[i].error ? { error: list.scenes[i].error } : {}) })),
          waiting_for_plates: next.elements.filter((e) => !plateOf(e)).map((e) => e.name),
        }];
      });
    },

    // The views a scene's shots need that have no plate yet.
    scene_views: async ({ project, scene_id }) => {
      const { studio: s } = await load(project);
      const scene = s.scenes.find((sc) => sc.id === scene_id) || fail(`No scene ${scene_id}.`);
      const jobs = scene.shots.flatMap((shot) => (shot.sheet?.viewIds || []).map((id) => s.elements.find((e) => e.id === id)).filter((el) => el && !plateOf(el)).map((el) => ({ shot, el })));
      if (!jobs.length) return { results: [], note: 'Every view of this scene has a plate.' };
      const unplated = [...new Set(jobs.map((j) => s.elements.find((e) => e.id === j.el.viewOf)))].filter((b) => !b || !plateOf(b));
      if (unplated.length) fail(`${unplated.map((b) => b?.name || 'The place').join(', ')} has no plate, and views are drawn from it.`);
      const results = await Promise.all(jobs.map(async ({ shot, el }) => {
        const base = s.elements.find((e) => e.id === el.viewOf);
        const plate = plateOf(base);
        const row = { kind: 'plate', label: el.name, parent: plate.id, refs: [plate.name], tags: ['view'] };
        return drawn(project, row, async () => {
          const instruction = await crewStep('crew-designer', 'view', { place: base.name, landmarks: shot.sheet.landmarks, from: el.desc });
          const out = await plateEdit({ instruction, refs: [mediaOf(plate)], imageModel: defaultImageModelKey() }, ctx);
          return { url: out.cacheUrl || out.url, prompt: out.prompt };
        }, () => ({}), { at: 'element', id: el.id });
      }));
      return { results };
    },

    merge_film: async ({ project, name, studio }) => {
      if (!(await peek(project))) await api.post('/api/film/cloud', { project: { id: project, name, title: name, studio: emptyStudio() }, writer: 'tools', baseRevision: null });
      return change(project, (s) => [mergeStudio(s, loadStudio(studio)), (n) => ({ names: Object.fromEntries(media(n).map((x) => [x.v.id, x.v.name])) })]);
    },

    // Casting as Studio runs it: the plan first, every element waiting for a plate included, then
    // one render per plate. The first plate an element gets becomes its plate; a body sheet rides
    // along on the face's version.
    cast: async ({ project, brief: words = '', note = '', names: wanted = [] }) => {
      const { studio: s } = await load(project);
      const idea = String(words || s.script || '').trim();
      if (!idea) fail('There is nothing to cast from: the film has no script and no words were given.');
      const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
      const waiting = s.elements.filter((e) => !e.viewOf && e.kind !== 'prop' && !plateOf(e));
      const existing = s.elements.filter((e) => !e.viewOf).map((e) => ({ name: e.name, kind: e.kind, plated: !waiting.includes(e) && !wanted.some((n) => same(n, e.name)) }));
      // Who must come back: the names given, or else everyone waiting for a plate.
      const owed = wanted.length ? wanted : waiting.map((e) => e.name);
      const exactly = wanted.length ? `Plan exactly these and nobody else, under exactly these names: ${wanted.join(', ')}.` : '';
      const fullNote = [s.style ? `The film's visual style is set: ${s.style}. Every prompt's medium and the shared style follow it, whatever the script says.` : '', note, exactly].filter(Boolean).join('\n');
      const kindOf = (c) => CAST_ROLE[String(c.type || c.role).trim().toLowerCase()] || 'location';
      const absent = (out) => owed.filter((n) => !out.arr.some((c) => same(c.name, n)));
      let plan = await castPlanFromIdea({ idea, existing, note: fullNote }, ctx);
      if (absent(plan).length) plan = await castPlanFromIdea({ idea, existing, note: `${fullNote}\nYour last plan left out ${absent(plan).join(', ')}. Include every one of them, under exactly these names.` }, ctx);
      if (absent(plan).length) fail(`Casting left out ${absent(plan).join(', ')}. Nothing was drawn.`);
      const style = !s.style || String(plan.style).toLowerCase().includes(s.style.toLowerCase()) ? plan.style : [s.style, plan.style].filter(Boolean).join('. ');
      // Asked for by name, only those are drawn.
      const arr = plan.arr.filter((c) => !wanted.length || wanted.some((n) => same(n, c.name))).map((c, i) => ({ ...c, id: i }));
      const slots = arr.map((c) => ({ name: String(c.name).slice(0, 80), kind: kindOf(c), vid: uid('v-'), entry: c }));
      const named = await change(project, (film) => {
        const next = slots.reduce((acc, slot) => {
          const known = acc.elements.find((e) => e.kind === slot.kind && same(e.name, slot.name));
          const el = known || newElement({ kind: slot.kind, name: slot.name });
          const withEl = known ? acc : { ...acc, elements: [...acc.elements, el] };
          return addVersion(withEl, { at: 'element', id: el.id }, { id: slot.vid, at: now(), by: BY, tags: ['cast'], kind: 'plate', label: slot.name, status: 'running', style });
        }, film);
        return [next, (n) => Object.fromEntries(slots.map((slot) => [slot.vid, media(n).find((x) => x.v.id === slot.vid).v.name]))];
      });
      const settleSlot = (slot, patch) => change(project, (film) => {
        const x = media(film).find((y) => y.v.id === slot.vid);
        const done = patchVersion(film, x.ref, slot.vid, patch);
        return [patch.url && !x.c.picked ? pickVersion(done, x.ref, slot.vid, now()) : done, null];
      });
      const pending = [];
      await castDraftFromParsed({ arr, style, imageModel: defaultImageModelKey(), max: arr.length }, ctx, {
        onEntry: (entry) => {
          const slot = slots[Number(entry.assetId)];
          const url = entry.cacheUrl || entry.url;
          if (!entry.primary) {
            if (!entry.failed) pending.push(change(project, (film) => [patchVersion(film, media(film).find((y) => y.v.id === slot.vid).ref, slot.vid, (v) => ({ extras: [...(v.extras || []), { url, label: 'body', prompt: entry.prompt }] })), null]));
            return;
          }
          if (entry.failed) { pending.push(settleSlot(slot, { status: 'failed', prompt: entry.prompt, error: entry.error || 'The plate did not render.' })); return; }
          pending.push(inLibrary({ url, kind: 'plate', label: slot.name }, named[slot.vid], project).then(() => settleSlot(slot, { status: 'review', url, prompt: entry.prompt })));
        },
        // Plates that failed already said why: this only reaches the ones still open.
      }).catch((e) => slots.forEach((slot) => pending.push(change(project, (film) => [patchVersion(film, media(film).find((y) => y.v.id === slot.vid).ref, slot.vid, (v) => (v.status === 'running' ? { status: 'failed', error: e.message || String(e) } : {})), null]))));
      await Promise.all(pending);
      const { studio: done } = await load(project);
      return { style, results: slots.map((slot) => brief(done, media(done).find((x) => x.v.id === slot.vid))) };
    },

    // Studio's variations: the source goes in as [Image 1] and each picture is an edit of it.
    variations: async ({ project, element, kind, description = '', direction = '', count = 4 }) => {
      if (!String(element || '').trim()) fail('Say who or where.');
      if (!(Number.isInteger(count) && count >= 1 && count <= 8)) fail(`Variations come 1 to 8 at a time, not ${count}.`);
      const key = String(element).replace(/^@/, '').trim().toLowerCase();
      const { studio: s } = await load(project);
      const known = s.elements.find((e) => e.name.toLowerCase() === key || mentionSlug(e.name).toLowerCase() === key);
      if (!known && !ELEMENT_KINDS.includes(kind)) fail(`${element} is new: say its kind (${ELEMENT_KINDS.join(', ')}).`);
      const base = known ? plateOf(known) : null;
      const words = [known?.desc || description, direction].filter(Boolean).join('. ');
      if (!base && !words) fail(`${known?.name || element} has no plate: say what it looks like.`);
      const el = known || newElement({ kind, name: String(element).replace(/^@/, '').trim(), desc: description });
      const ref = { at: 'element', id: el.id };
      const made = Array.from({ length: count }, () => uid('v-'));
      const row = (status, extra = {}) => ({ at: now(), by: BY, tags: ['variation'], kind: 'plate', label: `${el.name} variation`, status, ...(base ? { parent: base.id, refs: [base.name] } : {}), ...extra });
      await change(project, (film) => {
        const withEl = film.elements.some((e) => e.id === el.id) ? film : { ...film, elements: [...film.elements, el] };
        return [made.reduce((acc, id) => addVersion(acc, ref, row('running', { id, prompt: direction })), withEl), null];
      });
      const settleOne = (id, patch) => change(project, (film) => [patchVersion(film, ref, id, patch), (n) => media(n).find((x) => x.v.id === id).v.name]);
      const pending = [];
      const draw = el.kind === 'character' ? characterVariations : locationVariations;
      const out = await draw({ imageUrl: base ? mediaOf(base) : '', direction: base ? (direction || words) : withFilmStyle(s, words), count, imageModel: defaultImageModelKey() }, ctx, {
        onItem: (item, i) => {
          const url = item.cacheUrl || item.url;
          pending.push(settleOne(made[i], { status: 'review', url, prompt: item.prompt }).then((name) => inLibrary({ url, kind: 'plate', label: `${el.name} variation` }, name, project)));
        },
        onFail: (i, message) => pending.push(settleOne(made[i], { status: 'failed', error: message })),
        onAnchor: (a) => {
          const id = uid('v-');
          const url = a.cacheUrl || a.url;
          pending.push(change(project, (film) => [pickVersion(addVersion(film, ref, { ...row('review'), id, url, label: el.name, tags: ['cast'], parent: undefined }), ref, id, now()), (n) => media(n).find((x) => x.v.id === id).v.name]).then((name) => inLibrary({ url, kind: 'plate', label: el.name }, name, project)));
        },
      }).catch((e) => ({ thrown: e.message || String(e) }));
      await Promise.all(pending);
      if (out.thrown) await Promise.all(made.map((id) => settleOne(id, { status: 'failed', error: out.thrown })));
      const { studio: done } = await load(project);
      return { element: el.name, plate: byName(done, done.elements.find((e) => e.id === el.id).picked), results: made.map((id) => brief(done, media(done).find((x) => x.v.id === id))) };
    },

    // Canvas's storyboard: key moments, each authored, drawn as one sheet. The panels stay on the
    // picture, so their motion prompts can be shot later.
    storyboard: async ({ project, script, panels, refs = [], style = '', note = '', label = '' }) => {
      if (panels !== undefined && !(Number.isInteger(panels) && panels >= 1)) fail(`A storyboard has a whole number of panels, not ${panels}.`);
      const { project: p, studio: s } = await load(project);
      const text = String(script || s.script || '').trim();
      if (!text) fail('There is no script: the film has none and none was given.');
      const list = pictures(s, refs);
      const locations = s.elements.filter((e) => e.kind === 'location');
      const plateOf = (place) => {
        const el = locations.find((e) => e.name.toLowerCase() === String(place).toLowerCase());
        const plate = el?.versions?.find((v) => v.id === el.picked);
        return plate ? mediaOf(plate) : null;
      };
      const imageModel = defaultImageModelKey();
      const base = { kind: 'plate', label: label || 'Storyboard', prompt: text, refs: list.map((v) => v.name), model: imageModel, tags: ['storyboard'] };
      return drawn(project, base, async () => {
        const { panels: shots, references } = await storyboardPanels({ script: text, style, references: list.map(mediaOf), labels: list.map((v) => describeAsset(s, find(s, v.name)).title), places: locations.map((e) => e.name), plateOf, note, count: panels || 0 }, ctx);
        const out = await storyboardSheet({ shots, style, title: p.title || p.name || '', references, imageModel }, ctx);
        const nameOf = (n) => media(s).find((x) => mediaOf(x.v) === references[n - 1])?.v.name;
        return { url: out.cacheUrl || out.url, panels: shots.map(({ span, ...rest }) => ({ ...rest, refs: rest.figures.map(nameOf), motion: rest.motion.replace(/\[Image (\d+)\]/g, (whole, n) => (nameOf(n) ? `@${nameOf(n)}` : whole)) })) };
      }, (v) => ({
        panels: v.panels?.map((m, i) => ({ panel: i + 1, beat: m.beat, seconds: m.seconds, motion: m.motion, refs: m.refs, ...(m.missingDialogue.length ? { missing_dialogue: m.missingDialogue } : {}) })),
        ...(v.panels?.length > 15 ? { warning: `${v.panels.length} panels: past 15 on one sheet the order can suffer.` } : {}),
      }));
    },

    previz: async ({ project, brief: text, camera = '', label = '' }) => {
      if (!String(text || '').trim()) fail('Say what happens in the scene.');
      await load(project);
      const imageModel = defaultImageModelKey();
      const base = { kind: 'plate', label: label || 'Schematic', prompt: text, model: imageModel, tags: ['previz'] };
      return drawn(project, base, async () => {
        const plan = await previzPlan({ brief: text, camera }, ctx);
        const out = await previzSchematic({ plan, imageModel }, ctx);
        return { url: out.cacheUrl || out.url, prompt: out.prompt, plan };
      }, (v) => (v.plan ? { plan: v.plan, seconds: totalSecondsOf(v.plan) } : {}));
    },

    previz_animatic: async ({ project, schematic, label = '', director_asked_retry = false }) => {
      const { studio: s } = await load(project);
      const [src] = pictures(s, [schematic]);
      if (!src.plan) fail(`${src.name} is not a schematic: it has no plan to move. Use previz.`);
      const prompt = previzAnimaticPrompt({ plan: src.plan });
      const seconds = clampShotSeconds(ANIMATIC_MODEL, totalSecondsOf(src.plan));
      const fingerprint = fingerprintOf({ animatic: src.name, prompt, seconds });
      refuseFailed(s, fingerprint, director_asked_retry);
      const base = { kind: 'take', label: label || 'Animatic', prompt, parent: src.id, refs: [src.name], video_refs: [], model: ANIMATIC_MODEL, seconds, ratio: ANIMATIC_RATIO, res: DRAFT_RES, isDraft: true, fingerprint, plan: src.plan, tags: ['previz'] };
      return start(project, base, async () => startTake({
        motion: prompt, refUrls: [mediaOf(src)], refRoles: [], durationSec: seconds, resolution: DRAFT_RES, ratio: ANIMATIC_RATIO, generateAudio: false, modelKey: ANIMATIC_MODEL, draft: true,
      }, await assetsOf(project, [src]), ctx, { nameOf: () => src.name }));
    },

    previz_shot_prompt: async ({ project, animatic }) => {
      const { studio: s } = await load(project);
      const [src] = videos(s, [animatic]);
      if (!src.plan) fail(`${src.name} is not an animatic.`);
      const prompt = await previzCutPrompt({ videoUrl: mediaOf(src), plan: src.plan }, ctx);
      return { prompt: prompt.replace(/@video\s?1\b/gi, `@${src.name}`), video_refs: [src.name] };
    },

    // The rewrite works in the numbers the skill knows; the director reads names. Whatever the
    // rewrite drops of what was cited gets one corrective ask, then their prompt stands.
    enhance_prompt: async ({ project, prompt, refs = [], video_refs = [], model = 'seedance25' }) => {
      if (!String(prompt || '').trim()) fail('The prompt is empty.');
      const { studio: s } = await load(project);
      const list = pictures(s, refs);
      const clips = videos(s, video_refs);
      const numbered = citeNumbers(prompt, resolver(s), { images: list, videos: clips });
      const cited = [...new Set([...numbered.matchAll(/@(Image|Video)(\d+)/g)].map((m) => m[0]))];
      const roster = list.map((v, i) => `image ${i + 1}: ${describeAsset(s, find(s, v.name)).title}`);
      const compose = (text) => composeShotAction({ text, references: list.map(mediaOf), roster, modelKey: model, derive: false }, ctx);
      const lost = (t) => cited.filter((c) => !new RegExp(`${c}\\b`, 'i').test(t));
      const toNumber = (t) => String(t).replace(/\[\s*Image\s+(\d+)\s*\]/gi, '@Image$1');
      let out = await compose(numbered);
      if (lost(toNumber(out.action)).length) out = await compose(`${numbered}\n\nKeep every one of these citations: ${cited.join(', ')}.`);
      const action = toNumber(out.action);
      if (lost(action).length) fail(`The rewrite dropped a reference (${lost(action).join(', ')}). Your prompt stays as it was.`);
      const named = action
        .replace(/@Image\s*(\d+)/gi, (whole, n) => (list[n - 1] ? `@${list[n - 1].name}` : whole))
        .replace(/@Video\s*(\d+)/gi, (whole, n) => (clips[n - 1] ? `@${clips[n - 1].name}` : whole));
      return { prompt: [named, out.audio].filter(Boolean).join('\n') };
    },

    grab_frame: async ({ project, name, at, last = false }) => {
      const { studio: s } = await load(project);
      const [v] = videos(s, [name]);
      const seconds = v.seconds || (await probe(mediaOf(v))).seconds || 0;
      const t = last ? Math.max(0, seconds - FRAME_S) : Number(at);
      if (!(t >= 0 && t <= seconds)) fail(`${v.name} runs ${seconds} s: there is no frame at ${at}.`);
      const { frames } = await api.post('/api/film/frames', { url: mediaOf(v), timestamps: [t] });
      const url = frames?.[0]?.url || fail(`No frame came back from ${v.name}.`);
      const label = `${v.name} ${last ? 'last frame' : `at ${t.toFixed(1)} s`}`;
      const added = await addNew(project, { kind: 'plate', status: 'kept', url, cacheUrl: url, label, parent: v.id, tags: ['frame'] });
      await inLibrary({ url, kind: 'plate', label }, added.name, project);
      return added;
    },

    edit_image: async ({ project, source, marked, instruction, label }) => {
      if (!String(instruction || '').trim()) fail('Say what changes.');
      const { studio: s } = await load(project);
      const [src] = pictures(s, [source]);
      const [marks] = marked ? pictures(s, [marked]) : [];
      const { ref } = find(s, source);
      const vid = uid('v-');
      const base = { id: vid, at: now(), by: BY, tags: src.plan ? ['previz'] : [], kind: 'plate', label: label ?? src.label ?? '', prompt: instruction, refs: [src.name, ...(marks ? [marks.name] : [])], parent: src.id, edit: true, model: IMAGE_EDIT_MODEL, ...(src.plan ? { plan: src.plan } : {}) };
      await change(project, (film) => [addVersion(film, ref, { ...base, status: 'running' }), null]);
      const settle = (patch) => change(project, (film) => {
        const x = media(film).find((y) => y.v.id === vid);
        return [patchVersion(film, x.ref, vid, patch), answerFor(vid)];
      });
      let out;
      try {
        // A schematic stays a diagram: without its style the frame editor makes it a photograph.
        out = await storyboardKeyframe({ body: src.plan ? `${instruction}\nIt stays a ${SCHEMATIC_STYLE_LOCK}.` : instruction, refs: [mediaOf(marks || src)], imageModel: IMAGE_EDIT_MODEL, frameEdit: true, frameEditAnnotated: !!marks }, ctx);
      } catch (e) {
        return settle({ status: 'failed', error: e.message || String(e) });
      }
      const url = out.cacheUrl || out.url;
      const added = await settle({ status: 'review', url, prompt: out.prompt });
      await inLibrary({ url, kind: 'plate', label: base.label }, added.name, project);
      return added;
    },

    generate_video: async ({ project, prompt, refs = [], video_refs = [], seconds, ratio = '16:9', model = 'seedance25', quality, resolution = FINAL_RES, audio = true, label = '', shot_id, parent, director_asked_retry = false }) => {
      if (!String(prompt || '').trim()) fail('The prompt is empty.');
      if (!VIDEO_KEYS.includes(model)) fail(`No video model ${model}. Models: ${VIDEO_KEYS.join(', ')}.`);
      if (!['draft', 'final'].includes(quality)) fail('Say the quality: draft or final.');
      const traits = videoTraits(model);
      if (quality === 'final' && !(traits.movAt || []).includes(resolution)) fail(`${model} renders finals at ${(traits.movAt || []).join(' or ')}, not ${resolution}.`);
      if (!(seconds >= 5 && seconds <= traits.maxSeconds)) fail(`${model} renders 5 to ${traits.maxSeconds} seconds, not ${seconds}.`);
      if (refs.length > traits.refCap) fail(`${model} takes ${traits.refCap} pictures at most, not ${refs.length}.`);
      const { studio: s } = await load(project);
      const list = pictures(s, refs);
      const clips = videos(s, video_refs);
      const sent = citeNumbers(prompt, resolver(s), { images: list, videos: clips });
      const parentId = parent ? find(s, parent).v.id : null;
      const parentAt = parent ? find(s, parent).ref : null;
      const where = shot_id ? shotRef(s, shot_id) : parentAt?.at === 'take' ? parentAt : UNPLACED;
      const fingerprint = fingerprintOf({ prompt, refs: list.map((v) => v.name), clips: clips.map((v) => v.name), seconds, ratio, model, quality, resolution });
      refuseFailed(s, fingerprint, director_asked_retry);
      const draft = quality === 'draft';
      const base = { kind: 'take', label, prompt, refs: list.map((v) => v.name), video_refs: clips.map((v) => v.name), model, seconds, ratio, res: draft ? DRAFT_RES : resolution, isDraft: draft, fingerprint, ...(parentId ? { parent: parentId } : {}), ...(where.at === 'take' ? { used: usedOf(s, findShot(s, where.sceneId, where.shotId)) } : {}) };
      return start(project, base, async () => {
        const assetIds = await assetsOf(project, list);
        const clipIds = await assetsOf(project, clips);
        return startTake({
        motion: sent, refUrls: list.map(mediaOf), refRoles: [], durationSec: seconds, resolution: draft ? DRAFT_RES : resolution, ratio, generateAudio: audio, modelKey: model, draft, outputFormat: draft ? null : 'mov', videoRefUrls: clipIds.map((a) => `asset://${a}`),
      }, assetIds, ctx, { nameOf: (u) => list.find((v) => mediaOf(v) === u)?.name || 'a reference picture' });
      }, where);
    },

    edit_video: async ({ project, source, prompt, refs = [], model = 'seedance25', label = '', director_asked_retry = false }) => {
      if (!String(prompt || '').trim()) fail('The prompt is empty.');
      if (!VIDEO_KEYS.includes(model)) fail(`No video model ${model}. Models: ${VIDEO_KEYS.join(', ')}.`);
      const { studio: s } = await load(project);
      const [src] = videos(s, [source]);
      if (src.seconds && (src.seconds < 4 || src.seconds > 30)) fail(`${src.name} is ${src.seconds} s. An edit takes 4 to 30 s, so it can't be edited as it is.`);
      const list = pictures(s, refs);
      const sent = citeNumbers(prompt, resolver(s), { images: list, videos: [src] });
      checkEditPrompt(sent);
      const fingerprint = fingerprintOf({ source: src.name, prompt, refs: list.map((v) => v.name), model });
      refuseFailed(s, fingerprint, director_asked_retry);
      const base = { kind: 'take', edit: true, label, prompt, parent: src.id, refs: list.map((v) => v.name), model, seconds: src.seconds, res: FINAL_RES, fingerprint };
      return start(project, base, async () => {
        const [srcAsset] = await assetsOf(project, [src]);
        const assetIds = await assetsOf(project, list);
        return startTake({
        motion: sent, refUrls: list.map(mediaOf), refRoles: [], durationSec: 'auto', resolution: FINAL_RES, ratio: null, generateAudio: true, modelKey: model, draft: false, outputFormat: 'mov', videoRefUrls: [`asset://${srcAsset}`],
      }, assetIds, ctx, { nameOf: (u) => list.find((v) => mediaOf(v) === u)?.name || 'a reference picture' });
      }, onShot(find(s, src.name).ref));
    },

    finish: async ({ project, name, resolution = FINAL_RES }) => {
      const { studio: s } = await load(project);
      const { v: d } = find(s, name);
      if (!d.draft?.taskId) fail(`${d.name} is not a finished draft, so there is nothing to finish.`);
      if (now() - d.draft.at >= DRAFT_MODE.ttlMs) fail(`${d.name} is past the 7 days a draft can be finished in. Render it again.`);
      const finals = draftFinalsOf(d.draft.modelKey);
      if (!finals.includes(resolution)) fail(`${d.model} finishes drafts at ${finals.join(' or ')}, not ${resolution}.`);
      const fingerprint = fingerprintOf({ finish: d.name, resolution });
      refuseFailed(s, fingerprint, false);
      const base = { kind: 'take', final: true, label: d.label, prompt: d.prompt, parent: d.id, refs: d.refs, model: d.model, seconds: d.seconds, ratio: d.ratio, res: resolution, fingerprint, ...(d.used ? { used: d.used } : {}), ...(d.posterUrl ? { posterUrl: d.posterUrl } : {}) };
      return start(project, base, () => finishDraft({ draftTaskId: d.draft.taskId, modelKey: d.draft.modelKey, resolution, outputFormat: 'mov' }, ctx), onShot(find(s, d.name).ref));
    },

    settle_renders: async ({ project }) => ({ running: await settle(project) }),

    // Render state lives in the film and Ark decides when a task is over, so a wait can end, or the
    // connection drop, and the next pass picks the same renders up.
    wait: async ({ project, names: list = [] }) => {
      if (!list.length) fail('Name the renders to wait for.');
      const until = now() + WAIT_LIMIT_S * 1000;
      for (;;) {
        let film = null;
        let trouble = '';
        try {
          // eslint-disable-next-line no-await-in-loop
          const { studio: s } = await load(project);
          // eslint-disable-next-line no-await-in-loop
          await settle(project, list.map((n) => find(s, n).v.name));
          // eslint-disable-next-line no-await-in-loop
          film = (await load(project)).studio;
        } catch (e) {
          if (!isNetworkError(e.message)) throw e;
          trouble = e.message;
        }
        const left = film ? list.filter((n) => find(film, n).v.status === 'running').length : list.length;
        if (!left || now() >= until) {
          if (!film) return { still_running: left, wait_again: true, connection_trouble: trouble };
          return { results: list.map((n) => brief(film, find(film, n))), ...(left ? { still_running: left, wait_again: true } : {}) };
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(POLL_MS);
      }
    },

    look: async ({ project, name, at }) => {
      const { studio: s } = await load(project);
      const x = find(s, name);
      const { v } = x;
      if (v.status === 'running') fail(`${v.name} is still rendering.`);
      if (v.status === 'failed') return brief(s, x);
      const url = mediaOf(v);
      const facts = await probe(url);
      if (typeOf(v) === 'image') return { ...brief(s, x), facts, image_url: url };
      const seconds = facts.seconds || v.seconds || 0;
      const timestamps = (at?.length ? at : LOOK_POINTS.map((f) => f * seconds)).map((t) => Math.max(0, Math.min(seconds, Number(t))).toFixed(2));
      const { frames } = await api.post('/api/film/frames', { url, timestamps: timestamps.map(Number), maxWidth: 1280 });
      // An edit follows its source: a length that moved is a fact the model should not have to notice.
      const source = v.parent ? media(s).find((y) => y.v.id === v.parent)?.v : null;
      const moved = v.edit && source?.seconds && Math.abs(source.seconds - facts.seconds) >= 0.1;
      return { ...brief(s, x), facts, video_url: url, frames, ...(moved ? { length_differs_from_source: `${v.name} is ${facts.seconds} s, ${source.name} is ${source.seconds} s.` } : {}) };
    },

    label: ({ project, names: list = [], label, add_tags = [], remove_tags = [] }) => {
      if (!list.length) fail('Name the results.');
      return change(project, (s) => {
        const next = list.reduce((acc, n) => {
          const x = find(acc, n);
          return patchVersion(acc, x.ref, x.v.id, { ...(label !== undefined ? { label } : {}), tags: [...new Set([...(x.v.tags || []), ...add_tags])].filter((t) => !remove_tags.includes(t)), labelAt: now() });
        }, s);
        return [next, (n) => ({ results: list.map((name) => brief(n, find(n, name))) })];
      });
    },

    archive: ({ project, ids = [], archived }) => change(project, (s) => [ids.reduce((acc, id) => {
      const x = allVersions(acc).find((y) => y.v.id === id);
      return x ? patchVersion(acc, x.ref, id, { archived: !!archived }) : acc;
    }, s), { archived: ids.length }]),

    forget_media: ({ project, url }) => change(project, (s) => {
      const uses = media(s).filter((x) => mediaOf(x.v) === url || x.v.url === url);
      const gone = uses.filter((x) => x.ref.at === 'unplaced').map((x) => x.v.id);
      const next = updateContainer(s, UNPLACED, (c) => ({ ...c, versions: c.versions.filter((v) => !gone.includes(v.id)) }));
      return [{ ...next, removed: { ...(next.removed || {}), ...Object.fromEntries(gone.map((id) => [id, now()])) } }, { removed: gone.length, still_placed: uses.filter((x) => x.ref.at !== 'unplaced').map((x) => x.v.name) }];
    }),

    results: async ({ project }) => {
      const found = await peek(project);
      if (!found) return { name: '', results: [], studio: emptyStudio() };
      const { project: p, studio: s } = found;
      return {
        name: p.title || p.name,
        results: media(s).filter((x) => !x.v.archived).map((x) => ({ ...brief(s, x), ...describeAsset(s, x), at: x.v.at, id: x.v.id, url: mediaOf(x.v) || '', format: x.v.format || (/\.mov(\?|$)/i.test(mediaOf(x.v) || '') ? 'mov' : ''), prompt: x.v.prompt || '', tags: x.v.tags || [], poster: x.v.posterUrl || '' })),
        studio: s,
      };
    },

    read_transcript: async ({ project }) => {
      const found = await peek(project);
      return { transcript: found?.project.session || [] };
    },

    save_transcript: ({ project, transcript = [] }) => oneAtATime(project, async () => {
      for (let i = 0; i < SAVE_ATTEMPTS; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const { project: p, revision } = await load(project);
        // eslint-disable-next-line no-await-in-loop
        const saved = await api.post('/api/film/cloud', { project: { ...p, session: transcript }, writer: 'tools', baseRevision: revision }, { allow: [409] });
        if (!saved.conflict) return { saved: transcript.length };
      }
      return fail(`Film ${project} kept changing while saving it.`);
    }),
  };

  return {
    call: async (name, args = {}) => {
      const fn = TOOLS[name];
      if (!fn) fail(`No tool ${name}. Tools: ${Object.keys(TOOLS).join(', ')}.`);
      return fn(args);
    },
  };
};
