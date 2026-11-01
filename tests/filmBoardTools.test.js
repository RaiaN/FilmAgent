/**
 * @jest-environment node
 */
// STORYBOARD AND PREVIZ are Canvas's own steps as agent tools: the count asked for is the count drawn
// or a visible failure, a place's plate joins the sheet, and a schematic stays a diagram with its plan.
const { createFilmTools } = require('../utils/film/tools');
const { applyDeployModels, MODEL_ENV_VARS } = require('../utils/film/suiteConfig');
const { emptyStudio } = require('../utils/film/studio/model');

jest.mock('../utils/film/skills', () => ({
  ...jest.requireActual('../utils/film/skills'),
  crewStep: async () => 'system',
  requireSkillLine: async () => 'spec',
}));

applyDeployModels(Object.fromEntries(Object.keys(MODEL_ENV_VARS).map((k) => [k, `test-${k}`])));

const SCRIPT = 'Morwen opens the door. The sea is gone. She steps out.';
const QUOTES = ['Morwen opens the door.', 'The sea is gone.', 'She steps out.'];
const moment = (quote, i) => ({ title: `Beat ${i + 1}`, turn: 'the turn', figures: [], intExt: 'EXT', place: 'Harbour', seconds: 6, quote });
const PLAN = { scene: 'A dock', set: [{ name: 'Dock', where: 'north' }], actors: [{ name: 'Morwen', start: 'south' }], shots: [{ camera: { from: 'east', framing: 'wide', move: 'static' }, action: 'Morwen walks north', seconds: 6 }] };

const setup = ({ moments = [QUOTES], plan = PLAN, studio = emptyStudio() } = {}) => {
  const cloud = new Map([['film', { project: { id: 'film', title: 'Film', studio }, revision: 'r0' }]]);
  let stamp = 0;
  const lib = [];
  const asks = [...moments];
  const seen = { images: [], moments: 0, startVideo: [] };
  const api = {
    get: async (route) => {
      if (route.startsWith('/api/film/cloud')) return JSON.parse(JSON.stringify(cloud.get('film')));
      return { items: lib };
    },
    post: async (route, body) => {
      if (route === '/api/film/cloud') {
        stamp += 1;
        cloud.set('film', { project: JSON.parse(JSON.stringify(body.project)), revision: `r${stamp}` });
        return { ok: true };
      }
      if (route.startsWith('/api/film/library')) { lib.push(body); return { items: lib }; }
      if (route === '/api/film/preserve') return { assetId: `asset-${stamp}` };
      if (route === '/api/film/imagine') return { url: 'x', cacheUrl: 'gen.png' };
      throw new Error(`unexpected ${route}`);
    },
  };
  const client = {
    reason: jest.fn(async ({ prompt }) => {
      if (/Pick the key moments/.test(prompt)) {
        seen.moments += 1;
        seen.note = prompt;
        return { content: JSON.stringify({ moments: (asks.shift() || QUOTES).map(moment) }) };
      }
      if (/YOUR MOMENT/.test(prompt)) return { content: JSON.stringify({ body: 'A still of [Image 1]', motion: 'She moves in [Image 1]', audio: '', expression: '' }) };
      return { content: JSON.stringify(plan) };
    }),
    generateImage: jest.fn(async (req) => { seen.images.push(req); return { url: 'x', cacheUrl: 'sheet.png' }; }),
    startVideo: jest.fn(async (req) => { seen.startVideo.push(req); return { taskId: 'task-1' }; }),
  };
  const tools = createFilmTools({ api, client, probe: async () => ({ type: 'image' }), skills: async () => [], sleep: async () => {} });
  return { tools, client, seen, lib, film: () => cloud.get('film').project.studio };
};

describe('storyboard', () => {
  test('N panels land as one sheet with each panel, in the Library', async () => {
    const s = setup();
    const out = await s.tools.call('storyboard', { project: 'film', script: SCRIPT, panels: 3 });
    expect(out).toMatchObject({ name: 'R1', status: 'review', tags: ['storyboard'] });
    expect(out.panels.map((p) => p.panel)).toEqual([1, 2, 3]);
    expect(s.seen.images).toHaveLength(1);
    expect(s.seen.images[0].prompt).toMatch(/grid of 3 numbered panels/);
    expect(s.seen.note).toMatch(/exactly 3 moments/);
    expect(s.lib).toHaveLength(1);
    const { panels } = await s.tools.call('read_result', { project: 'film', name: 'R1' });
    expect(panels[2].motion).toBeTruthy();
  });

  test('the wrong count gets one corrective ask', async () => {
    const s = setup({ moments: [QUOTES.slice(0, 2), QUOTES] });
    const out = await s.tools.call('storyboard', { project: 'film', script: SCRIPT, panels: 3 });
    expect(s.seen.moments).toBe(2);
    expect(s.seen.note).toMatch(/last answer had 2/);
    expect(out.status).toBe('review');
  });

  test('a count it can\'t reach is a failure, and nothing is cut to fit', async () => {
    const s = setup({ moments: [QUOTES, QUOTES] });
    const out = await s.tools.call('storyboard', { project: 'film', script: SCRIPT, panels: 2 });
    expect(out.status).toBe('failed');
    expect(out.error).toMatch(/3 key moments, not the 2/);
    expect(s.seen.images).toHaveLength(0);
  });

  test('a place with a plate in the film sits on the sheet', async () => {
    const studio = { ...emptyStudio(), elements: [{ id: 'e1', kind: 'location', name: 'Harbour', desc: '', picked: 'p1', versions: [{ id: 'p1', kind: 'plate', name: 'R1', status: 'picked', url: 'harbour.png', at: 1 }] }] };
    const s = setup({ studio });
    await s.tools.call('storyboard', { project: 'film', script: SCRIPT });
    expect(s.seen.images[0].referenceImages).toEqual(['harbour.png']);
  });

  test('no script anywhere is refused before anything runs', async () => {
    const s = setup();
    await expect(s.tools.call('storyboard', { project: 'film' })).rejects.toThrow(/no script/);
    expect(s.client.reason).not.toHaveBeenCalled();
  });
});

describe('resolution', () => {
  const ask = { project: 'film', prompt: 'Walks', seconds: 6, quality: 'final' };
  test('Premium renders a 4K final, as a MOV', async () => {
    const s = setup();
    const out = await s.tools.call('generate_video', { ...ask, model: 'seedance25Premium', resolution: '4K' });
    expect(out.res).toBe('4K');
    expect(s.seen.startVideo[0]).toMatchObject({ resolution: '4K', outputFormat: 'mov' });
  });
  test('2.5 refuses 4K before anything renders', async () => {
    const s = setup();
    await expect(s.tools.call('generate_video', { ...ask, model: 'seedance25', resolution: '4K' })).rejects.toThrow(/at 1080p, not 4K/);
    expect(s.client.startVideo).not.toHaveBeenCalled();
  });
  test('going on from a frame keeps the shot and shape, with the frame cited and referenced', () => {
    const { barFromFrame, requestOf } = require('../utils/film/studio/bar');
    const film = emptyStudio();
    const bar = barFromFrame(film, { at: 'take', sceneId: 'a', shotId: 'b' }, { model: 'seedance25', seconds: 6, ratio: '9:16' }, 'R9');
    expect(bar).toMatchObject({ shotId: 'b', sceneId: 'a', text: '@R9 ', refs: ['R9'], seconds: 6, ratio: '9:16' });
    expect(requestOf(film, { ...bar, text: '@R9 she runs' }).args).toMatchObject({ refs: ['R9'], shot_id: 'b' });
  });
  test('moving the bar off Premium brings 4K back to 1080p', () => {
    const { barOnModel, emptyBar, requestOf } = require('../utils/film/studio/bar');
    const bar = { ...emptyBar(emptyStudio()), model: 'seedance25Premium', quality: 'final', resolution: '4K', text: 'x' };
    expect(requestOf(emptyStudio(), bar).args.resolution).toBe('4K');
    expect(barOnModel(bar, 'seedance25').resolution).toBe('1080p');
  });
});

describe('scenes and shots', () => {
  const shot = async (s) => {
    const scene = await s.tools.call('add_scene', { project: 'film', title: 'The dock' });
    return s.tools.call('add_shot', { project: 'film', scene_id: scene.id, title: 'Landing', seconds: 6, text: 'They land' });
  };

  test('a new shot shows in the film as Studio holds it', async () => {
    const s = setup();
    const added = await shot(s);
    expect(added).toMatchObject({ title: 'Landing', seconds: 6, n: 1 });
    const { scenes } = await s.tools.call('list_project', { project: 'film' });
    expect(scenes[0]).toMatchObject({ n: 1, title: 'The dock' });
    expect(scenes[0].shots[0]).toMatchObject({ id: added.id, title: 'Landing', text: 'They land' });
  });

  test('a take with a shot_id lands on that shot, and wait still finds it', async () => {
    const s = setup();
    const { id } = await shot(s);
    const out = await s.tools.call('generate_video', { project: 'film', prompt: 'They land', seconds: 6, quality: 'draft', shot_id: id });
    expect(out.place).toMatch(/Landing/);
    const film = s.film();
    expect(film.scenes[0].shots[0].takes.versions.map((v) => v.name)).toEqual(['T1']);
    expect(film.unplaced?.versions || []).toEqual([]);
  });

  test('a take without one still waits unplaced', async () => {
    const s = setup();
    await s.tools.call('generate_video', { project: 'film', prompt: 'A test', seconds: 6, quality: 'draft' });
    expect(s.film().unplaced.versions.map((v) => v.name)).toEqual(['T1']);
  });

  test('a refused render stays on the shot it was for', async () => {
    const s = setup();
    const { id } = await shot(s);
    s.client.startVideo.mockRejectedValueOnce(new Error('refused'));
    const out = await s.tools.call('generate_video', { project: 'film', prompt: 'They land', seconds: 6, quality: 'draft', shot_id: id });
    expect(out).toMatchObject({ status: 'failed', refused_by_model: true });
    expect(s.film().scenes[0].shots[0].takes.versions).toHaveLength(1);
  });

  test('an unknown shot or scene is refused before anything renders', async () => {
    const s = setup();
    await expect(s.tools.call('generate_video', { project: 'film', prompt: 'A', seconds: 6, quality: 'draft', shot_id: 'nope' })).rejects.toThrow(/No shot nope/);
    expect(s.client.startVideo).not.toHaveBeenCalled();
    await expect(s.tools.call('add_shot', { project: 'film', scene_id: 'nope', title: 'X' })).rejects.toThrow(/No scene nope/);
  });
});

describe('previz', () => {
  const blocked = async () => {
    const s = setup();
    const out = await s.tools.call('previz', { project: 'film', brief: 'Morwen crosses the dock' });
    return { s, out };
  };

  test('the plan and the schematic land together', async () => {
    const { out } = await blocked();
    expect(out).toMatchObject({ name: 'R1', status: 'review', tags: ['previz'], seconds: 6 });
    expect(out.plan.actors[0].color).toBe('BLUE');
  });

  test('editing a schematic keeps it a diagram with its plan', async () => {
    const { s } = await blocked();
    await s.tools.call('edit_image', { project: 'film', source: 'R1', instruction: 'move the dock left' });
    expect(s.seen.images.at(-1).prompt).toMatch(/floor-plan diagram/);
    expect((await s.tools.call('read_result', { project: 'film', name: 'R2' })).plan).toBeTruthy();
  });

  test('the animatic is a silent draft from the schematic', async () => {
    const { s } = await blocked();
    const out = await s.tools.call('previz_animatic', { project: 'film', schematic: 'R1' });
    expect(out).toMatchObject({ name: 'T1', status: 'running', tags: ['previz'] });
    const req = s.seen.startVideo[0];
    expect(JSON.stringify(req)).toMatch(/480p/);
    expect(req.generateAudio).toBe(false);
  });

  test('a picture without a plan is not a schematic', async () => {
    const s = setup();
    await s.tools.call('generate_image', { project: 'film', prompt: 'a cat' });
    await expect(s.tools.call('previz_animatic', { project: 'film', schematic: 'R1' })).rejects.toThrow(/not a schematic/);
  });
});

describe('citations by name', () => {
  const withRefs = async () => {
    const s = setup();
    await s.tools.call('generate_image', { project: 'film', prompt: 'a' });
    await s.tools.call('generate_image', { project: 'film', prompt: 'b' });
    await s.tools.call('generate_image', { project: 'film', prompt: 'c' });
    return s;
  };
  const motionOf = (s) => s.seen.startVideo.at(-1).content.find((c) => c.type === 'text').text;
  const video = (s, prompt, refs) => s.tools.call('generate_video', { project: 'film', prompt, refs, seconds: 6, quality: 'draft' });

  test('names become the numbers of this render, in its order', async () => {
    const s = await withRefs();
    await video(s, '@R3 walks past @R2', ['R2', 'R3']);
    expect(motionOf(s)).toContain('@Image2 walks past @Image1');
  });
  test('dropping a reference can\'t move a citation onto another picture', async () => {
    const s = await withRefs();
    await expect(video(s, '@R1 walks past @R2', ['R2'])).rejects.toThrow(/@R1 \(R1\), which is not a reference/);
    expect(s.client.startVideo).not.toHaveBeenCalled();
    await video(s, 'A figure walks past @R2', ['R2']);
    expect(motionOf(s)).toContain('walks past @Image1');
  });
  test('numbers are refused, whichever way they are written', async () => {
    const s = await withRefs();
    await expect(video(s, '@Image1 walks', ['R1'])).rejects.toThrow(/by name/);
    await expect(video(s, '[Image 1] walks', ['R1'])).rejects.toThrow(/by name/);
  });
  test('an edit cites its source by name', async () => {
    const s = await withRefs();
    await video(s, 'Walks', []);
    Object.assign(s.film().unplaced.versions.find((v) => v.name === 'T1'), { status: 'review', url: 'https://x/t.mp4' });
    await expect(s.tools.call('edit_video', { project: 'film', source: 'T1', prompt: 'Remove the hat' })).rejects.toThrow(/cite its source/);
  });
  test('a prompt stored with numbers reads back with names', async () => {
    const s = await withRefs();
    await video(s, 'Walks', ['R2']);
    const film = s.film();
    film.unplaced.versions.find((v) => v.name === 'T1').prompt = '@Image1 walks';
    expect((await s.tools.call('read_result', { project: 'film', name: 'T1' })).prompt).toBe('@R2 walks');
  });
});

describe('cast', () => {
  const PLAN = { style: 'watercolour', assets: [
    { type: 'character', name: 'Morwen', facePrompt: 'an old keeper', bodyPrompt: 'full body' },
    { type: 'location', name: 'The Harbour', prompt: 'a grey harbour' },
  ] };
  const withPlan = (plans, studio) => {
    const s = setup({ studio });
    const asks = [...plans];
    s.client.reason.mockImplementation(async () => ({ content: JSON.stringify(asks.length > 1 ? asks.shift() : asks[0]) }));
    return s;
  };
  test('each plate lands on its element as its plate, the body beside the face, all in the Library', async () => {
    const s = withPlan([PLAN]);
    const out = await s.tools.call('cast', { project: 'film', brief: 'A keeper in a harbour' });
    expect(out.results.map((r) => r.status)).toEqual(['picked', 'picked']);
    const film = s.film();
    const morwen = film.elements.find((e) => e.name === 'Morwen');
    expect(morwen.kind).toBe('character');
    expect(morwen.picked).toBe(morwen.versions[0].id);
    expect(morwen.versions).toHaveLength(1);
    expect(morwen.versions[0].extras[0].label).toBe('body');
    expect(s.seen.images.find((r) => /an old keeper/.test(r.prompt)).prompt).toMatch(/facing camera/i);
    expect(film.elements.find((e) => e.name === 'The Harbour').kind).toBe('location');
    expect(s.lib).toHaveLength(2);
  });
  test('someone waiting in Cast & World comes back under their name, or nothing is drawn', async () => {
    const studio = { ...emptyStudio(), elements: [{ id: 'e1', kind: 'character', name: 'Tam', desc: '', picked: null, versions: [] }] };
    const s = withPlan([PLAN], studio);
    await expect(s.tools.call('cast', { project: 'film', brief: 'x' })).rejects.toThrow(/left out Tam/);
    expect(s.seen.images).toHaveLength(0);
    expect(s.client.reason).toHaveBeenCalledTimes(2);
  });
  test('nothing to cast from is refused', async () => {
    await expect(setup().tools.call('cast', { project: 'film' })).rejects.toThrow(/nothing to cast/);
  });
  test('a plate that fails says why and the others still land', async () => {
    const s = withPlan([PLAN]);
    s.client.generateImage.mockImplementation(async (req) => { if (/harbour/.test(req.prompt)) throw new Error('refused'); return { url: 'x', cacheUrl: 'p.png' }; });
    const out = await s.tools.call('cast', { project: 'film', brief: 'x' });
    expect(out.results.map((r) => r.status)).toEqual(['picked', 'failed']);
    expect(out.results[1].error).toBe('refused');
  });
});

describe('cast when every plate fails', () => {
  test('each keeps its own reason', async () => {
    const s = setup();
    s.client.reason.mockImplementation(async () => ({ content: JSON.stringify({ assets: [{ type: 'location', name: 'The Harbour', prompt: 'a harbour' }] }) }));
    s.client.generateImage.mockImplementation(async () => { throw new Error('refused'); });
    const out = await s.tools.call('cast', { project: 'film', brief: 'x' });
    expect(out.results[0]).toMatchObject({ status: 'failed', error: 'refused' });
  });
});

describe('variations', () => {
  const place = (picked = 'p1') => ({ ...emptyStudio(), elements: [{ id: 'e1', kind: 'location', name: 'The Harbour', desc: 'grey', picked, versions: picked ? [{ id: 'p1', kind: 'plate', name: 'R1', status: 'picked', url: 'harbour.png', at: 1 }] : [] }] });
  const planned = (s, n) => s.client.reason.mockImplementation(async () => ({ content: JSON.stringify({ prompts: Array.from({ length: n }, (_, i) => ({ label: `v${i}`, prompt: `change ${i}` })), items: Array.from({ length: n }, (_, i) => ({ label: `v${i}`, prompt: `change ${i}` })) }) }));
  test('background plates are edits of the plate and sit beside it', async () => {
    const s = setup({ studio: place() });
    planned(s, 2);
    const out = await s.tools.call('variations', { project: 'film', element: '@The-Harbour', direction: 'dusk', count: 2 });
    expect(out.results.map((r) => r.status)).toEqual(['review', 'review']);
    expect(out.plate).toBe('R1');
    s.seen.images.forEach((r) => expect(r.referenceImages).toEqual(['harbour.png']));
    expect(s.film().elements[0].versions).toHaveLength(3);
    expect(s.lib).toHaveLength(2);
  });
  test('with no plate, one is drawn first and becomes the plate', async () => {
    const s = setup({ studio: place(null) });
    planned(s, 1);
    const out = await s.tools.call('variations', { project: 'film', element: 'The Harbour', count: 1 });
    expect(s.seen.images).toHaveLength(2);
    expect(out.plate).toBeTruthy();
    expect(out.results[0].name).not.toBe(out.plate);
  });
  test('a new element needs its kind, and one with no plate needs a description', async () => {
    const s = setup();
    await expect(s.tools.call('variations', { project: 'film', element: 'Tam' })).rejects.toThrow(/say its kind/);
    await expect(s.tools.call('variations', { project: 'film', element: 'Tam', kind: 'character' })).rejects.toThrow(/say what it looks like/);
  });
  test('a planner that fails leaves no render running', async () => {
    const s = setup({ studio: place() });
    s.client.reason.mockRejectedValue(new Error('planner down'));
    const out = await s.tools.call('variations', { project: 'film', element: 'The Harbour', direction: 'dusk', count: 2 });
    expect(out.results.map((r) => r.status)).toEqual(['failed', 'failed']);
    expect(out.results[0].error).toMatch(/planner down/);
  });
});

describe('script to film', () => {
  const SCREENPLAY = 'INT. FLAT - NIGHT\nDAN opens the door.\n\nEXT. STREET - DAY\nDAN runs.';
  const SHEET = { seconds: 8, landmarks: 'door at one end', views: [{ name: 'Wide', from: 'by the window' }], start: 'Dan at the door', beats: [{ view: 'Wide', action: 'Dan opens the door', looksAt: 'the door' }], against: 'it sticks', sound: 'creak', end: 'door open' };
  const laidOut = (studio) => {
    const layout = require('../utils/film/studio/layout');
    return layout.applyShotList(studio || emptyStudio(), { people: [{ name: 'Dan', aka: [] }], places: ['Flat'], scriptHash: '0', scenes: [{ n: 1, slug: 'INT. FLAT - NIGHT', place: 'Flat', time: 'Night', text: 'Dan opens the door.', people: ['Dan'], sheet: SHEET }] });
  };

  test('an idea is no screenplay, and the tool says so before spending', async () => {
    const s = setup();
    await expect(s.tools.call('shot_list', { project: 'film', script: 'A man loses his dog.' })).rejects.toThrow(/not a screenplay/);
    expect(s.client.reason).not.toHaveBeenCalled();
  });
  test('breaking down again needs the director to agree', async () => {
    const s = setup({ studio: laidOut() });
    await expect(s.tools.call('shot_list', { project: 'film', script: SCREENPLAY })).rejects.toThrow(/replaces them/);
    expect(s.client.reason).not.toHaveBeenCalled();
  });
  test('a screenplay replaces the earlier text, which stays as a version', async () => {
    const s = setup({ studio: { ...emptyStudio(), script: 'my idea' } });
    s.client.reason.mockImplementation(async () => ({ content: SCREENPLAY }));
    await s.tools.call('write_screenplay', { project: 'film', idea: 'my idea' });
    expect(s.film().script).toBe(SCREENPLAY);
    expect(s.film().brief.versions[0]).toMatchObject({ text: 'my idea', kind: 'script' });
  });
  test('scene views are edits of the place plate, and the first becomes the view plate', async () => {
    const film = laidOut();
    const place = film.elements.find((e) => e.name === 'Flat');
    place.versions = [{ id: 'p1', kind: 'plate', name: 'R1', status: 'picked', url: 'flat.png', at: 1 }];
    place.picked = 'p1';
    const s = setup({ studio: film });
    const out = await s.tools.call('scene_views', { project: 'film', scene_id: film.scenes[0].id });
    expect(out.results).toHaveLength(1);
    expect(s.seen.images[0].referenceImages).toEqual(['flat.png']);
    const view = s.film().elements.find((e) => e.viewOf === place.id);
    expect(view.picked).toBe(view.versions[0].id);
  });
  test('views wait for the place to have a plate', async () => {
    const film = laidOut();
    const s = setup({ studio: film });
    await expect(s.tools.call('scene_views', { project: 'film', scene_id: film.scenes[0].id })).rejects.toThrow(/Flat has no plate/);
  });
  test('cast by name draws exactly those, under those names', async () => {
    const s = setup();
    s.client.reason.mockImplementation(async () => ({ content: JSON.stringify({ assets: [{ type: 'location', name: 'The Harbour', prompt: 'a harbour' }, { type: 'prop', name: 'Oil Can', prompt: 'an oil can' }] }) }));
    const out = await s.tools.call('cast', { project: 'film', brief: 'x', names: ['The Harbour'] });
    expect(out.results).toHaveLength(1);
    expect(s.film().elements.map((e) => e.name)).toEqual(['The Harbour']);
  });
  test('cast by name refuses when the planner renames someone, after one corrective ask', async () => {
    const s = setup();
    s.client.reason.mockImplementation(async () => ({ content: JSON.stringify({ assets: [{ type: 'character', name: 'Keeper Morwen', facePrompt: 'x' }] }) }));
    await expect(s.tools.call('cast', { project: 'film', brief: 'x', names: ['Morwen'] })).rejects.toThrow(/left out Morwen/);
    expect(s.client.reason).toHaveBeenCalledTimes(2);
    expect(s.seen.images).toHaveLength(0);
  });
  test('a take stays where its source is', async () => {
    const film = laidOut();
    const s = setup({ studio: film });
    const shotId = film.scenes[0].shots[0].id;
    await s.tools.call('generate_video', { project: 'film', prompt: 'Walks', seconds: 6, quality: 'draft', shot_id: shotId });
    Object.assign(s.film().scenes[0].shots[0].takes.versions[0], { status: 'review', url: 'https://x/t.mp4', draft: { taskId: 'task-1', modelKey: 'seedance25', at: Date.now() } });
    await s.tools.call('finish', { project: 'film', name: 'T1' });
    await s.tools.call('generate_video', { project: 'film', prompt: 'Runs', seconds: 6, quality: 'draft', parent: 'T1' });
    expect(s.film().scenes[0].shots[0].takes.versions.map((v) => v.name)).toEqual(['T1', 'T2', 'T3']);
  });
  test('a tab\'s copy merges in, and a new film is created', async () => {
    const s = setup();
    const out = await s.tools.call('merge_film', { project: 'film', name: 'F', studio: { ...emptyStudio(), script: 'typed in the tab' } });
    expect(s.film().script).toBe('typed in the tab');
    expect(out.names).toEqual({});
  });
});
