/**
 * @jest-environment node
 */
// THE FILM TOOLS work on the one film Studio shows: results get short names, wait unplaced until they
// are given a place, and go in the Library; a render's state lives in the film; what the agent can't
// be trusted to hold is checked in code.
const { FILM_TOOLS, createFilmTools, checkEditPrompt } = require('../utils/film/tools');
const { applyDeployModels, MODEL_ENV_VARS } = require('../utils/film/suiteConfig');
const { addVersion, allVersions, emptyStudio, newScene, newShot } = require('../utils/film/studio/model');

applyDeployModels(Object.fromEntries(Object.keys(MODEL_ENV_VARS).map((k) => [k, `test-${k}`])));

const IMG = { type: 'image', width: 1024, height: 1024 };
const VID = { type: 'video', width: 1920, height: 1080, seconds: 8, has_audio: true };

// The cloud store, the Library and the routes, in memory.
const studio = ({ startVideo, generateImage, status, conflicts = 0, library = [] } = {}) => {
  const cloud = new Map();
  let clash = conflicts;
  let stamp = 0;
  const calls = [];
  const lib = [...library];
  const api = {
    get: async (route) => {
      calls.push(['GET', route]);
      if (route.startsWith('/api/film/cloud')) {
        const id = decodeURIComponent(/id=([^&]+)/.exec(route)[1]);
        const m = cloud.get(id);
        if (!m) throw new Error('No cloud save found for this project');
        return JSON.parse(JSON.stringify({ project: m.project, revision: m.revision }));
      }
      if (route.startsWith('/api/film/library')) return { items: lib };
      return status ? status(route) : { status: 'running' };
    },
    post: async (route, body) => {
      calls.push(['POST', route, body]);
      if (route === '/api/film/cloud') {
        if (clash > 0) { clash -= 1; return { conflict: true }; }
        stamp += 1;
        cloud.set(body.project.id, { project: JSON.parse(JSON.stringify(body.project)), revision: `s${stamp}` });
        return { ok: true };
      }
      if (route.startsWith('/api/film/library')) { lib.unshift({ id: `L${lib.length + 1}`, ...body }); return { items: lib }; }
      if (route === '/api/film/upload') return { url: 'staged', cacheUrl: `u${calls.length}.png`, assetId: `asset-${calls.length}` };
      if (route === '/api/film/preserve') return { assetId: `asset-${calls.length}` };
      if (route === '/api/film/imagine') return { url: 'x', cacheUrl: 'gen.png' };
      if (route === '/api/film/frames') return { frames: body.timestamps.map((t) => ({ t, url: `f${t}` })) };
      throw new Error(`unexpected ${route}`);
    },
  };
  const tools = createFilmTools({
    api,
    client: { startVideo: startVideo || (async () => ({ taskId: 'task-1' })), generateImage: generateImage || (async () => ({ url: 'x', cacheUrl: 'edited.png' })) },
    probe: async (url) => (/\.mp4|\.mov|video/.test(url) ? VID : IMG),
    skills: async () => [{ id: 'sd25-pe', description: 'spec', text: 'the whole spec' }],
    sleep: async () => {},
  });
  return { tools, cloud, calls, lib };
};
const PROJECT = 'film-one';
const withPicture = async (s) => {
  await s.tools.call('ensure_project', { project: PROJECT, name: 'Test' });
  await s.tools.call('add_media', { project: PROJECT, data_url: 'data:image/png;base64,AA', label: 'her face' });
  return PROJECT;
};
const film = (s) => s.cloud.get(PROJECT).project.studio;

describe('the tools', () => {
  test('every tool is described for a harness and answers', async () => {
    const s = studio();
    FILM_TOOLS.forEach((t) => { expect(t.type).toBe('function'); expect(t.description).toBeTruthy(); });
    await expect(s.tools.call('delete_everything')).rejects.toThrow('No tool delete_everything');
  });
  test('results are versions in the one film, with short names', async () => {
    const s = studio();
    const project = await withPicture(s);
    await s.tools.call('generate_image', { project, prompt: 'a face sheet', refs: ['R1'] });
    const { results } = await s.tools.call('list_project', { project });
    expect(results.map((r) => r.name).sort()).toEqual(['R1', 'R2']);
    expect(results[0].place).toBe('Unplaced');
    expect(film(s).unplaced.versions).toHaveLength(2);
    expect((await s.tools.call('read_result', { project, name: '@R2' })).refs).toEqual(['R1']);
    await expect(s.tools.call('read_result', { project, name: 'T9' })).rejects.toThrow('The film has:');
  });
  test('Seedream 5.5 draws 4K as a size it takes', async () => {
    const s = studio();
    const project = await withPicture(s);
    await s.tools.call('generate_image', { project, prompt: 'a face sheet', model: 'seedream55', size: '4K' });
    await s.tools.call('generate_image', { project, prompt: 'a face sheet', model: 'seedream55', size: '7680x4320' });
    await s.tools.call('generate_image', { project, prompt: 'a face sheet', model: 'seedream55', size: '2K' });
    const sent = s.calls.filter((c) => c[1] === '/api/film/imagine').map((c) => [c[2].model, c[2].size]);
    expect(sent).toEqual([['test-seedream55', '2880x2880'], ['test-seedream55', '3840x2160'], ['test-seedream55', '2K']]);
  });
  test("a tool with no model named draws on the film's pick", async () => {
    const s = studio();
    const project = await withPicture(s);
    s.cloud.get(project).project.imageModel = 'seedream55';
    await s.tools.call('generate_image', { project, prompt: 'a face sheet' });
    await s.tools.call('generate_image', { project, prompt: 'a face sheet', model: 'seedream' });
    const sent = s.calls.filter((c) => c[1] === '/api/film/imagine').map((c) => c[2].model);
    expect(sent).toEqual(['test-seedream55', 'test-seedream']);
  });
  test('an existing film is left as it was', async () => {
    const s = studio();
    await s.tools.call('ensure_project', { project: PROJECT, name: 'First' });
    await s.tools.call('add_media', { project: PROJECT, data_url: 'data:image/png;base64,AA' });
    await s.tools.call('ensure_project', { project: PROJECT, name: 'Second' });
    expect(s.cloud.get(PROJECT).project.name).toBe('First');
    expect(film(s).unplaced.versions).toHaveLength(1);
  });
  test('a skill reads whole', async () => {
    const s = studio();
    expect((await s.tools.call('read_skill', {})).skills[0].id).toBe('sd25-pe');
    expect((await s.tools.call('read_skill', { id: 'sd25-pe' })).text).toBe('the whole spec');
    await expect(s.tools.call('read_skill', { id: 'nope' })).rejects.toThrow('Skills: sd25-pe');
  });
  test('changes at the same moment all land, each under its own name', async () => {
    const cloud = { project: { id: 'film-race', name: 'T', studio: emptyStudio() }, revision: 's0' };
    let stamp = 0;
    const tick = () => new Promise((r) => setTimeout(r, 2));
    const api = {
      get: async () => { await tick(); return JSON.parse(JSON.stringify(cloud)); },
      post: async (route, body) => {
        if (route === '/api/film/upload') return { cacheUrl: 'u', assetId: 'a' };
        if (route.startsWith('/api/film/library')) return {};
        const base = cloud.revision;
        await tick();
        if (body.baseRevision !== base) return { conflict: true };
        await tick();
        stamp += 1;
        Object.assign(cloud, { project: body.project, revision: `s${stamp}` });
        return { ok: true };
      },
    };
    const tools = createFilmTools({ api, client: {}, probe: async () => IMG, skills: async () => [] });
    const add = () => tools.call('add_media', { project: 'film-race', data_url: 'data:image/png;base64,AA' });
    const out = await Promise.all([add(), add(), add(), add()]);
    expect(out.map((r) => r.name).sort()).toEqual(['R1', 'R2', 'R3', 'R4']);
    expect(cloud.project.studio.unplaced.versions).toHaveLength(4);
  });
  test('another save getting in first does not lose the change', async () => {
    const s = studio({ conflicts: 2 });
    s.cloud.set(PROJECT, { project: { id: PROJECT, name: 'T', studio: emptyStudio() }, revision: 's0' });
    const out = await s.tools.call('add_media', { project: PROJECT, data_url: 'data:image/png;base64,AA' });
    expect(out.name).toBe('R1');
    expect(film(s).unplaced.versions).toHaveLength(1);
  });
});

describe('a picture', () => {
  test('shows as rendering while it is made, then lands', async () => {
    const s = studio();
    const project = await withPicture(s);
    const seen = [];
    const realPost = s.tools;
    const out = await realPost.call('generate_image', { project, prompt: 'x', label: 'a sheet' });
    seen.push(out.status);
    expect(seen).toEqual(['review']);
    const saves = s.calls.filter((c) => c[0] === 'POST' && c[1] === '/api/film/cloud').map((c) => c[2].project.studio?.unplaced?.versions?.find((v) => v.label === 'a sheet')?.status).filter(Boolean);
    expect(saves[0]).toBe('running');
    expect(saves[saves.length - 1]).toBe('review');
  });
});

describe('editing a picture', () => {
  test('with marks: the marked copy goes to the model with its template, and the new version sits beside the source', async () => {
    const generateImage = jest.fn(async () => ({ url: 'x', cacheUrl: 'edited.png' }));
    const s = studio({ generateImage });
    const project = await withPicture(s);
    await s.tools.call('place', { project, name: 'R1', element: 'Morwen', kind: 'character' });
    await s.tools.call('add_media', { project, data_url: 'data:image/png;base64,BB', label: 'R1 with marks' });
    const out = await s.tools.call('edit_image', { project, source: '@Morwen', marked: 'R2', instruction: 'make the wreath red' });
    const sent = generateImage.mock.calls[0][0];
    expect(sent.prompt).toContain('The red hand-drawn marks show where to change: make the wreath red');
    expect(sent.prompt).toContain('Remove the marks');
    expect(sent.referenceImages).toHaveLength(1);
    expect(sent.referenceImages[0]).toBe(allVersions(film(s)).find((x) => x.v.name === 'R2').v.url);
    expect(out).toMatchObject({ status: 'review', parent: 'R1', place: 'Morwen' });
    expect(film(s).elements[0].versions).toHaveLength(2);
  });
  test('without marks: the source goes, with your words', async () => {
    const generateImage = jest.fn(async () => ({ url: 'x', cacheUrl: 'edited.png' }));
    const s = studio({ generateImage });
    const project = await withPicture(s);
    await s.tools.call('edit_image', { project, source: 'R1', instruction: 'make it night' });
    expect(generateImage.mock.calls[0][0].prompt).toContain('make it night');
    expect(generateImage.mock.calls[0][0].prompt).not.toContain('marks');
  });
  test('a failed edit stays on the record, with why', async () => {
    const s = studio({ generateImage: async () => { throw new Error('refused'); } });
    const project = await withPicture(s);
    expect(await s.tools.call('edit_image', { project, source: 'R1', instruction: 'x' })).toMatchObject({ status: 'failed', error: 'refused' });
    await expect(s.tools.call('edit_image', { project, source: 'R1', instruction: ' ' })).rejects.toThrow('Say what changes');
  });
});

describe('the Library', () => {
  test('what is attached or made goes in the Library', async () => {
    const s = studio();
    const project = await withPicture(s);
    await s.tools.call('generate_image', { project, prompt: 'x', label: 'a sheet' });
    expect(s.lib.map((it) => it.name)).toEqual(['a sheet', 'her face']);
    expect(s.lib[0]).toMatchObject({ kind: 'image', project });
  });
  test('a finished render goes in the Library', async () => {
    const s = studio({ status: () => ({ status: 'succeeded', video_url: 'https://x/t.mp4', video_cache_url: 'c.mp4' }) });
    const project = await withPicture(s);
    await s.tools.call('generate_video', { project, prompt: 'A walk', seconds: 8, quality: 'draft', label: 'the walk' });
    expect(s.lib.some((it) => it.name === 'the walk')).toBe(false);
    await s.tools.call('wait', { project, names: ['T1'] });
    expect(s.lib[0]).toMatchObject({ name: 'the walk', kind: 'video', url: 'c.mp4' });
  });
  test('search finds by name, and an item comes into the film once', async () => {
    const s = studio({ library: [{ id: 'm', name: 'Morwen face', kind: 'image', url: 'm.png', assetId: 'am' }, { id: 'c', name: 'Cat clip', kind: 'video', url: 'c.mp4' }] });
    await s.tools.call('ensure_project', { project: PROJECT, name: 'T' });
    expect((await s.tools.call('search_library', { project: PROJECT, query: 'morwen' })).items.map((i) => i.id)).toEqual(['m']);
    expect((await s.tools.call('search_library', { project: PROJECT, kind: 'video' })).items.map((i) => i.id)).toEqual(['c']);
    const used = await s.tools.call('use_from_library', { project: PROJECT, id: 'm' });
    expect(used.name).toBe('R1');
    expect((await s.tools.call('use_from_library', { project: PROJECT, id: 'm' })).name).toBe('R1');
    expect(film(s).unplaced.versions[0].assetId).toBe('am');
    await expect(s.tools.call('use_from_library', { project: PROJECT, id: 'nope' })).rejects.toThrow('No Library item');
  });
});

describe('a deleted file', () => {
  test('leaves the unplaced pool for good; what has a place stays, and is named', async () => {
    const s = studio();
    const project = await withPicture(s);
    await s.tools.call('add_media', { project, data_url: 'data:image/png;base64,BB', label: 'second' });
    const before = film(s).unplaced.versions;
    await s.tools.call('place', { project, name: before[1].name, element: 'Morwen', kind: 'character' });
    expect(await s.tools.call('forget_media', { project, url: before[0].url })).toEqual({ removed: 1, still_placed: [] });
    expect(film(s).removed[before[0].id]).toBeTruthy();
    expect(film(s).unplaced.versions).toEqual([]);
    expect(await s.tools.call('forget_media', { project, url: before[1].url })).toEqual({ removed: 0, still_placed: [before[1].name] });
    expect(film(s).elements[0].versions).toHaveLength(1);
  });
});

describe('placing and choosing', () => {
  test('a picture becomes the plate of who it is', async () => {
    const s = studio();
    const project = await withPicture(s);
    await expect(s.tools.call('place', { project, name: 'R1', element: 'Morwen' })).rejects.toThrow('say its kind');
    const out = await s.tools.call('place', { project, name: 'R1', element: 'Morwen', kind: 'character', description: 'an old woman' });
    expect(out).toMatchObject({ name: 'R1', status: 'picked', place: 'Morwen' });
    expect(film(s).unplaced.versions).toEqual([]);
    expect(film(s).elements[0]).toMatchObject({ name: 'Morwen', kind: 'character', desc: 'an old woman' });
    await expect(s.tools.call('place', { project, name: 'R1', element: 'Other', kind: 'prop' })).rejects.toThrow('already has its place');
  });
  test('a video goes on a shot, and Studio plates are there to use', async () => {
    const s = studio({ status: () => ({ status: 'succeeded', video_url: 'https://x/t.mp4' }) });
    const project = await withPicture(s);
    const sh = newShot({ title: 'One', motion: 'she walks' });
    const sc = { ...newScene('Scene'), shots: [sh] };
    const m = s.cloud.get(project);
    m.project.studio = { ...m.project.studio, scenes: [sc] };
    await s.tools.call('generate_video', { project, prompt: 'A', seconds: 8, quality: 'draft' });
    await s.tools.call('wait', { project, names: ['T1'] });
    await expect(s.tools.call('pick', { project, name: 'T1' })).rejects.toThrow('no place yet');
    await expect(s.tools.call('place', { project, name: 'R1', shot_id: sh.id })).rejects.toThrow('a shot takes videos');
    await s.tools.call('place', { project, name: 'T1', shot_id: sh.id });
    await expect(s.tools.call('pick', { project, name: 'T1' })).rejects.toThrow('newest take stands');
    const list = await s.tools.call('list_project', { project });
    expect(list.scenes[0].shots[0]).toMatchObject({ id: sh.id, text: 'she walks', take: 'T1' });
  });
  test('@Morwen means her current plate, and two of a name is a question', async () => {
    const s = studio();
    const project = await withPicture(s);
    await s.tools.call('place', { project, name: 'R1', element: "Morwen's Cottage", kind: 'location' });
    expect((await s.tools.call('read_result', { project, name: "@Morwens-Cottage" })).name).toBe('R1');
    const m = s.cloud.get(project);
    const el = m.project.studio.elements[0];
    m.project.studio.elements.push({ ...el, id: 'other', name: 'Morwens Cottage' });
    await expect(s.tools.call('read_result', { project, name: '@Morwens-Cottage' })).rejects.toThrow("could mean Morwen's Cottage or Morwens Cottage");
  });
  test('every result says what it is', async () => {
    const s = studio();
    const project = await withPicture(s);
    const { results } = await s.tools.call('results', { project });
    expect(results[0]).toMatchObject({ group: 'upload', title: 'her face', mention: 'R1', lead: true });
    expect(results[0].detail).toContain('Upload');
    await s.tools.call('place', { project, name: 'R1', element: 'Morwen', kind: 'character' });
    const placed = (await s.tools.call('results', { project })).results[0];
    expect(placed).toMatchObject({ group: 'cast', mention: 'Morwen', lead: true });
    expect(placed.detail).toContain('★ plate');
    expect((await s.tools.call('list_project', { project })).results[0].about).toContain('Cast');
  });
  test('takes already in Studio get names and can be used', async () => {
    const s = studio();
    await s.tools.call('ensure_project', { project: PROJECT, name: 'T' });
    const sh = newShot({ title: 'One' });
    const sc = { ...newScene('Scene'), shots: [sh] };
    const m = s.cloud.get(PROJECT);
    m.project.studio = addVersion({ ...m.project.studio, scenes: [sc] }, { at: 'take', sceneId: sc.id, shotId: sh.id }, { id: 'old', at: 1, kind: 'take', status: 'review', url: 'o.mp4', prompt: 'from Studio' });
    expect((await s.tools.call('read_result', { project: PROJECT, name: 'T1' })).prompt).toBe('from Studio');
  });
});

describe('what code holds', () => {
  test('an edit must read as one', () => {
    expect(() => checkEditPrompt('Remove the lantern from @video1')).not.toThrow();
    expect(() => checkEditPrompt('A witch at dusk')).toThrow('cite its source');
    expect(() => checkEditPrompt('@video1 at dusk with snow')).toThrow('instruction');
  });
  test('a reference that cannot be an asset stops the render, by name', async () => {
    const startVideo = jest.fn();
    const s = studio({ startVideo });
    const project = await withPicture(s);
    await s.tools.call('generate_image', { project, prompt: 'x' });
    const real = s.cloud.get(project);
    const api = { get: async () => JSON.parse(JSON.stringify({ project: real.project, revision: real.revision })), post: async (route, body) => { if (route === '/api/film/cloud') { real.project = JSON.parse(JSON.stringify(body.project)); return { ok: true }; } return { assetId: null, assetError: 'too small' }; } };
    const bare = createFilmTools({ api, client: { startVideo }, probe: async () => IMG, skills: async () => [] });
    expect(await bare.call('generate_video', { project, prompt: '@R2 walks', refs: ['R2'], seconds: 8, quality: 'draft' })).toMatchObject({ status: 'failed', error: expect.stringContaining('Could not add R2 to the Asset Library: too small') });
    expect(startVideo).not.toHaveBeenCalled();
  });
  test('inputs that already failed are refused until the director asks', async () => {
    const startVideo = jest.fn().mockRejectedValueOnce(new Error('content screen')).mockResolvedValue({ taskId: 't2' });
    const s = studio({ startVideo });
    const project = await withPicture(s);
    const ask = { project, prompt: 'A walk', seconds: 8, quality: 'draft' };
    expect((await s.tools.call('generate_video', ask)).status).toBe('failed');
    await expect(s.tools.call('generate_video', ask)).rejects.toThrow('T1 failed on exactly these inputs: content screen');
    expect(startVideo).toHaveBeenCalledTimes(1);
    expect((await s.tools.call('generate_video', { ...ask, prompt: 'A slow walk' })).status).toBe('running');
    expect((await s.tools.call('generate_video', { ...ask, director_asked_retry: true })).status).toBe('running');
  });
  test('out-of-range lengths and unfinishable drafts are errors', async () => {
    const s = studio();
    const project = await withPicture(s);
    await expect(s.tools.call('generate_video', { project, prompt: 'x', seconds: 2, quality: 'draft' })).rejects.toThrow('renders 5 to');
    await expect(s.tools.call('finish', { project, name: 'R1' })).rejects.toThrow('not a finished draft');
  });
});

describe('a render', () => {
  test('its state lives in the film: start, wait, finish', async () => {
    let answer = { status: 'running' };
    const startVideo = jest.fn(async () => ({ taskId: 'task-1' }));
    const s = studio({ startVideo, status: () => answer });
    const project = await withPicture(s);
    const t = await s.tools.call('generate_video', { project, prompt: '@R1 walks', refs: ['R1'], seconds: 8, quality: 'draft', ratio: '16:9' });
    expect(t).toMatchObject({ name: 'T1', status: 'running', res: '480p' });
    const body = startVideo.mock.calls[0][0];
    expect(body).toMatchObject({ draft: true, ratio: '16:9', duration: 8 });
    expect(body.content.find((c) => c.type === 'image_asset_id').asset_id).toMatch(/^asset-/);
    expect(allVersions(film(s)).find((x) => x.v.name === 'T1').v.taskId).toBe('task-1');
    answer = { status: 'succeeded', video_url: 'https://x/t.mp4', video_cache_url: 'c.mp4', last_frame_url: 'l' };
    const done = await s.tools.call('wait', { project, names: ['T1'] });
    expect(done.results[0]).toMatchObject({ name: 'T1', status: 'review', can_finish: true });
    const f = await s.tools.call('finish', { project, name: 'T1' });
    expect(f).toMatchObject({ name: 'T2', by: 'final', parent: 'T1', res: '1080p' });
    expect(startVideo.mock.calls[1][0]).toMatchObject({ draftTaskId: 'task-1', outputFormat: 'mov' });
  });
  test('a failed render says why and an edit keeps its parent', async () => {
    let answer = { status: 'failed', error: { message: 'screen' } };
    const startVideo = jest.fn(async () => ({ taskId: 'x' }));
    const s = studio({ startVideo, status: () => answer });
    const project = await withPicture(s);
    await s.tools.call('generate_video', { project, prompt: 'A walk', seconds: 8, quality: 'final' });
    const bad = await s.tools.call('wait', { project, names: ['T1'] });
    expect(bad.results[0]).toMatchObject({ status: 'failed', error: 'screen' });
    await s.tools.call('generate_video', { project, prompt: 'B walk', seconds: 8, quality: 'final' });
    answer = { status: 'succeeded', video_url: 'https://x/t.mov' };
    await s.tools.call('wait', { project, names: ['T2'] });
    const e = await s.tools.call('edit_video', { project, source: 'T2', prompt: 'Remove the lantern from @T2' });
    expect(e).toMatchObject({ name: 'T3', by: 'edit', parent: 'T2', status: 'running' });
    const sent = startVideo.mock.calls[2][0];
    expect(sent.content.find((c) => c.type === 'video_url').video_url.url).toMatch(/^asset:\/\/asset-/);
    expect(sent.ratio).toBeFalsy();
    expect(sent.duration).toBe('auto');
  });
});

describe('a render ends whatever the agent does', () => {
  const started = async (status) => {
    const s = studio({ status });
    const project = await withPicture(s);
    await s.tools.call('generate_video', { project, prompt: 'A walk', seconds: 8, quality: 'draft' });
    return { s, project };
  };
  test('a pass records what ended, once, and counts what still runs', async () => {
    let answer = { status: 'running' };
    const { s, project } = await started(() => answer);
    expect(await s.tools.call('settle_renders', { project })).toEqual({ running: 1 });
    answer = { status: 'succeeded', video_url: 'https://x/t.mp4' };
    expect(await s.tools.call('settle_renders', { project })).toEqual({ running: 0 });
    expect(allVersions(film(s)).find((x) => x.v.name === 'T1').v).toMatchObject({ status: 'review', draft: { taskId: 'task-1' } });
    expect(s.lib.filter((it) => it.url === 'https://x/t.mp4')).toHaveLength(1);
  });
  test('a dropped connection leaves it running for the next pass', async () => {
    let down = true;
    const { s, project } = await started(() => { if (down) throw new Error('fetch failed'); return { status: 'succeeded', video_url: 'https://x/t.mp4' }; });
    expect(await s.tools.call('settle_renders', { project })).toEqual({ running: 1 });
    down = false;
    expect(await s.tools.call('settle_renders', { project })).toEqual({ running: 0 });
  });
  test('wait rides out a dropped connection', async () => {
    let calls = 0;
    const { s, project } = await started(() => { calls += 1; if (calls < 3) throw new Error('fetch failed'); return { status: 'succeeded', video_url: 'https://x/t.mp4' }; });
    const out = await s.tools.call('wait', { project, names: ['T1'] });
    expect(out.results[0].status).toBe('review');
    expect(calls).toBe(3);
  });
  test('a render Ark no longer has is a failure, not running for ever', async () => {
    const { s, project } = await started(() => ({ error: 'Status check failed', details: { error: { code: 'ResourceNotFound' } } }));
    expect(await s.tools.call('settle_renders', { project })).toEqual({ running: 0 });
    expect(allVersions(film(s)).find((x) => x.v.name === 'T1').v).toMatchObject({ status: 'failed', error: 'Ark no longer has this render.' });
  });
  test('a render on the Canvas is left to the Canvas', async () => {
    let asked = 0;
    const { s, project } = await started(() => { asked += 1; return { status: 'running' }; });
    const stored = s.cloud.get(project);
    stored.project.studio.unplaced.versions.forEach((v) => { if (v.name === 'T1') v.by = 'board'; });
    expect(await s.tools.call('settle_renders', { project })).toEqual({ running: 0 });
    expect(asked).toBe(0);
  });
  test('an unknown name is still refused at once', async () => {
    const { s, project } = await started(() => ({ status: 'running' }));
    await expect(s.tools.call('wait', { project, names: ['T9'] })).rejects.toThrow('No result T9');
  });
});

describe('a frame of a take', () => {
  const ready = async () => {
    const s = studio({ status: () => ({ status: 'succeeded', video_url: 'https://x/video.mp4' }) });
    const project = await withPicture(s);
    await s.tools.call('generate_video', { project, prompt: 'A', seconds: 8, quality: 'draft' });
    await s.tools.call('wait', { project, names: ['T1'] });
    return { s, project };
  };
  test('becomes a named picture that a new take can cite', async () => {
    const { s, project } = await ready();
    const out = await s.tools.call('grab_frame', { project, name: 'T1', at: 5.6 });
    expect(out).toMatchObject({ name: 'R2', type: 'image', label: 'T1 at 5.6 s' });
    expect(s.lib.some((it) => it.url === 'f5.6')).toBe(true);
    const next = await s.tools.call('generate_video', { project, prompt: 'Then @R2 walks', refs: ['R2'], seconds: 8, quality: 'draft' });
    expect(next.status).toBe('running');
  });
  test('the last frame is just before the end, and past the end there is none', async () => {
    const { s, project } = await ready();
    expect((await s.tools.call('grab_frame', { project, name: 'T1', last: true })).label).toBe('T1 last frame');
    await expect(s.tools.call('grab_frame', { project, name: 'T1', at: 99 })).rejects.toThrow('no frame at 99');
  });
  test('a picture has no frames', async () => {
    const { s, project } = await ready();
    await expect(s.tools.call('grab_frame', { project, name: 'R1', at: 1 })).rejects.toThrow('is a picture');
  });
});

describe('look and label', () => {
  test('a video comes back with frames across its length and its facts', async () => {
    const s = studio({ status: () => ({ status: 'succeeded', video_url: 'https://x/video.mp4' }) });
    const project = await withPicture(s);
    await s.tools.call('generate_video', { project, prompt: 'A', seconds: 8, quality: 'final' });
    await s.tools.call('wait', { project, names: ['T1'] });
    const seen = await s.tools.call('look', { project, name: 'T1' });
    expect(seen.frames).toHaveLength(6);
    expect(seen.facts.has_audio).toBe(true);
    expect((await s.tools.call('look', { project, name: 'T1', at: [4] })).frames).toEqual([{ t: 4, url: 'f4' }]);
  });
  test('labels and tags organise and render nothing', async () => {
    const startVideo = jest.fn();
    const s = studio({ startVideo });
    const project = await withPicture(s);
    const out = await s.tools.call('label', { project, names: ['R1'], label: 'hero', add_tags: ['scene 2'] });
    expect(out.results[0]).toMatchObject({ label: 'hero', tags: ['scene 2'] });
    expect((await s.tools.call('list_project', { project, tag: 'scene 2' })).results).toHaveLength(1);
    expect((await s.tools.call('list_project', { project, tag: 'scene 3' })).results).toHaveLength(0);
    expect(startVideo).not.toHaveBeenCalled();
  });
  test('the session is saved with the film, and archived results leave the preview', async () => {
    const s = studio();
    const project = await withPicture(s);
    await s.tools.call('save_transcript', { project, transcript: [{ type: 'you', text: 'hi' }] });
    expect((await s.tools.call('read_transcript', { project })).transcript).toHaveLength(1);
    const { results } = await s.tools.call('results', { project });
    await s.tools.call('archive', { project, ids: [results[0].id], archived: true });
    expect((await s.tools.call('results', { project })).results).toHaveLength(0);
    expect((await s.tools.call('results', { project: 'film-new' })).results).toEqual([]);
  });
});
