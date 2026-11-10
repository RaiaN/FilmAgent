// THE SESSION AND THE PREVIEW: the session shows every step and drives the work; the preview only
// shows, sorts, filters, tags and labels. It has no way to make or change a result.
import fs from 'fs';
import path from 'path';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { Session, threadOf, stepText, mentionAt, matchMentions, putMention, matchCommands, parseCommand } from '../components/film/Session';
import { belongsTo, filmAssets, usesOf } from '../utils/film/libraryMatch';
import { Preview, arrange } from '../components/film/Preview';
import { Library, searchLibrary } from '../components/film/Library';
import { EditImage } from '../components/film/EditImage';

global.IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = () => {};
Element.prototype.scrollTo = () => {};
global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ url: 'copy.mp4' }) }));

const R = [
  { name: 'R1', type: 'image', by: 'you', status: 'done', url: 'a.png', at: 1, tags: ['scene 2'], label: 'Morwen' },
  { name: 'T1', type: 'video', by: 'generated', status: 'done', url: 'b.mp4', format: 'mp4', at: 2, tags: [], res: '480p', seconds: 15, prompt: 'p' },
  { name: 'T2', type: 'video', by: 'edit', status: 'done', parent: 'T1', url: 'c.mov', format: 'mov', at: 3, tags: ['scene 2'] },
  { name: 'T10', type: 'video', by: 'generated', status: 'failed', error: 'screen', at: 4, tags: [] },
  { name: 'T11', type: 'video', by: 'generated', status: 'running', at: 5, tags: [] },
];
const mount = async (el) => {
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  await act(async () => { root.render(el); });
  return { box, root };
};

describe('the preview', () => {
  test('sorts and filters', () => {
    expect(arrange(R).map((r) => r.name)[0]).toBe('T11');
    expect(arrange(R, { sort: 'old' }).map((r) => r.name)[0]).toBe('R1');
    expect(arrange(R, { sort: 'name' }).map((r) => r.name)).toEqual(['R1', 'T1', 'T2', 'T10', 'T11']);
    expect(arrange(R, { kind: 'image' }).map((r) => r.name)).toEqual(['R1']);
    expect(arrange(R, { kind: 'you' }).map((r) => r.name)).toEqual(['R1']);
    expect(arrange(R, { tag: 'scene 2', sort: 'old' }).map((r) => r.name)).toEqual(['R1', 'T2']);
  });
  test('shows every state and names every result', async () => {
    const { box } = await mount(<Preview results={R} onLabel={() => {}} />);
    ['R1', 'T1', 'T2', 'T10', 'T11'].forEach((n) => expect(box.textContent).toContain(n));
    expect(box.textContent).toContain('5 of 5');
    expect(box.querySelector('video')).toBeTruthy();
  });
  test('a render in progress never takes the player: the latest finished result stays, with a line about the render', async () => {
    const { box } = await mount(<Preview results={R} onLabel={() => {}} />);
    expect(box.textContent).toContain('Rendering');
    expect(box.textContent).toContain('edit · from T1');
    expect(box.textContent).not.toContain('Thinking');
  });
  test('with nothing yet it says so', async () => {
    expect((await mount(<Preview results={[]} onLabel={() => {}} />)).box.textContent).toContain('Nothing in this film yet');
  });
  test('its only way to change the project is a label, and its source reaches no film tool', async () => {
    const dir = path.join(__dirname, '..', 'components', 'film');
    const src = fs.readFileSync(path.join(dir, 'Preview.js'), 'utf8');
    ['generate_', 'edit_video', 'api/film/tools', 'api/film/session', 'onPick', 'onReject'].forEach((word) => expect(src).not.toContain(word));
    expect(src.match(/fetch\('([^']+)'/g)).toBeNull();
    expect(fs.readFileSync(path.join(dir, 'usePlayable.js'), 'utf8').match(/fetch\('([^']+)'/g)).toEqual(["fetch('/api/film/preview'"]);
    const seen = (await mount(<Preview results={[]} onLabel={() => {}} />)).box;
    expect(seen.querySelectorAll('button').length).toBe(0);
  });
  test('the preview copy route only makes a copy to watch', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'film', 'preview.js'), 'utf8');
    expect(src).not.toMatch(/api\/film\/(tools|session|cloud)/);
  });
});

describe('@ in the session', () => {
  test('it opens at an @ starting a word, and not inside one', () => {
    expect(mentionAt('@', 1)).toEqual({ query: '', start: 0 });
    expect(mentionAt('look at @T', 10)).toEqual({ query: 'T', start: 8 });
    expect(mentionAt('look at', 7)).toBeNull();
    expect(mentionAt('me@T1', 5)).toBeNull();
    expect(mentionAt('@T1 and more', 12)).toBeNull();
  });
  const rs = [
    { name: 'R1', at: 1, group: 'cast', title: 'Morwen', mention: 'Morwen', lead: true },
    { name: 'T1', at: 2, group: 'take', title: 'the walk', lead: false },
    { name: 'T2', at: 3, group: 'take', title: 'the walk again', lead: true },
    { name: 'T3', at: 4, group: 'cut', title: 'Cut', lead: true },
  ];
  test('it shows each thing once, by type', () => {
    expect(matchMentions(rs, '').map((r) => r.name)).toEqual(['R1', 'T2', 'T3']);
  });
  test('it finds by type, by name, and any version by its short name', () => {
    expect(matchMentions(rs, 'take').map((r) => r.name)).toEqual(['T2']);
    expect(matchMentions(rs, 'cast').map((r) => r.name)).toEqual(['R1']);
    expect(matchMentions(rs, 'morw').map((r) => r.name)).toEqual(['R1']);
    expect(matchMentions(rs, 't1').map((r) => r.name)).toEqual(['T1']);
  });
  test('the choice replaces what was typed, wherever the caret is', () => {
    expect(putMention('fix @t please', { start: 4 }, 6, 'T3')).toEqual({ text: 'fix @T3  please', caret: 8 });
  });
  test('typing @ shows the film, and names in the talk open on the right', async () => {
    const onShow = jest.fn();
    const { box } = await mount(<Session events={[{ n: 0, type: 'text', text: 'T3 is ready.' }]} busy={false} say={async () => {}} stop={() => {}} results={R} onShowResult={onShow} />);
    await act(async () => { box.querySelector('[role="button"]').click(); });
    expect(onShow).toHaveBeenCalledWith('T3');
    const area = box.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    await act(async () => {
      set.call(area, '@');
      area.setSelectionRange(1, 1);
      area.dispatchEvent(new Event('input', { bubbles: true }));
      area.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(box.textContent).toContain('Browse everything');
  });
});

describe('/ commands', () => {
  const registered = [{ name: 'edit', description: 'Draw on a picture' }];
  const pics = [{ name: 'R1', type: 'image', status: 'review', mention: 'Morwen' }, { name: 'T1', type: 'video', status: 'review' }, { name: 'R2', type: 'image', status: 'running' }];
  test('typing / lists them, and only at the start of a message', () => {
    expect(matchCommands('/', registered).map((c) => c.name)).toEqual(['edit']);
    expect(matchCommands('/e', registered).map((c) => c.name)).toEqual(['edit']);
    expect(matchCommands('/x', registered)).toEqual([]);
    expect(matchCommands('a /', registered)).toEqual([]);
  });
  test('/edit opens on a picture, by short name or @name, with any words', () => {
    expect(parseCommand('/edit @R1', pics, registered)).toMatchObject({ command: 'edit', words: '', result: { name: 'R1' } });
    expect(parseCommand('/edit @Morwen make it red', pics, registered)).toMatchObject({ words: 'make it red', result: { name: 'R1' } });
    expect(parseCommand('make it red', pics, registered)).toBeNull();
  });
  test('what can not be edited says why', () => {
    expect(parseCommand('/edit', pics, registered).error).toContain('Say which picture');
    expect(parseCommand('/edit @T1', pics, registered).error).toContain('T1 is a video');
    expect(parseCommand('/edit @R2', pics, registered).error).toContain('still rendering');
    expect(parseCommand('/edit @R9', pics, registered).error).toContain('@R9');
    expect(parseCommand('/zoom @R1', pics, registered).error).toContain('No command /zoom');
    expect(parseCommand('/reset', pics, [...registered, { name: 'reset' }])).toEqual({ command: 'reset' });
  });
  test('choosing from the @ menu replaces what was typed, with no words left over', async () => {
    const { box } = await mount(<Session events={[]} busy={false} say={async () => {}} stop={() => {}} results={[{ name: 'R1', at: 1, type: 'image', status: 'review', group: 'cast', title: 'Thistle', mention: 'Thistle', lead: true }]} commands={[{ name: 'edit' }]} />);
    const area = box.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    await act(async () => { set.call(area, '/edit @Thistle'); area.dispatchEvent(new Event('input', { bubbles: true })); });
    const option = box.querySelector('[role="option"]');
    await act(async () => { option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(box.querySelector('textarea').value).toBe('/edit @Thistle ');
  });
  test('a command goes to the session, and a wrong one stays here with why', async () => {
    const say = jest.fn(async () => {});
    const { box } = await mount(<Session events={[]} busy={false} say={say} stop={() => {}} results={pics} commands={registered} />);
    const type = async (t) => { const area = box.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; await act(async () => { set.call(area, t); area.dispatchEvent(new Event('input', { bubbles: true })); }); };
    await type('/edit @T1');
    await act(async () => { box.querySelector('[aria-label="Send"]').click(); });
    expect(say).not.toHaveBeenCalled();
    expect(box.textContent).toContain('T1 is a video');
    await type('/edit @R1');
    await act(async () => { box.querySelector('[aria-label="Send"]').click(); });
    expect(say).toHaveBeenCalledWith('/edit @R1', []);
  });
});

describe('the Edit Image workbench', () => {
  const r = { name: 'R1', title: 'Morwen', url: 'a.png', type: 'image' };
  test('it asks for words, and hands them on without rendering', async () => {
    const onUse = jest.fn(async () => {});
    const { box } = await mount(<EditImage result={r} onCancel={() => {}} onUse={onUse} />);
    const useThis = () => [...box.querySelectorAll('button')].find((b) => b.textContent === 'Use this');
    await act(async () => { useThis().click(); });
    expect(onUse).not.toHaveBeenCalled();
    expect(box.textContent).toContain('Say what changes.');
    const area = box.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    await act(async () => { set.call(area, 'make it red'); area.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { useThis().click(); });
    expect(onUse).toHaveBeenCalledWith({ words: 'make it red', marked: null });
  });
  test('its source reaches no film tool', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'film', 'EditImage.js'), 'utf8');
    ['api/film', 'fetch('].forEach((word) => expect(src).not.toContain(word));
  });
});

describe('browsing', () => {
  test('a click puts the reference in the message, a second takes it out, and nothing is sent', async () => {
    const say = jest.fn();
    const results = [{ name: 'T2', id: 'x', at: 1, status: 'review', type: 'video', group: 'take', title: 'The walk', detail: 'Take', mention: 'T2', lead: true, poster: 'p.png' }];
    const { box } = await mount(<Session events={[]} busy={false} say={say} stop={() => {}} results={results} />);
    await act(async () => { box.querySelector('[aria-label="Browse"]').click(); });
    expect(box.textContent).toContain('Everything in this film');
    const tile = [...box.querySelectorAll('[title]')].find((n) => n.title.includes('T2 · The walk'));
    await act(async () => { tile.click(); });
    expect(box.querySelector('textarea').value).toBe('@T2 ');
    await act(async () => { [...box.querySelectorAll('[title]')].find((n) => n.title.includes('T2 · The walk')).click(); });
    expect(box.querySelector('textarea').value.trim()).toBe('');
    expect(say).not.toHaveBeenCalled();
  });
});

describe("a project's Library", () => {
  const manifest = { media: ['aaaaaaaaaaaaaaaa.png'], project: { studio: { x: 'asset-in-use', y: 'https://tos/used.mp4' } } };
  const uses = usesOf(manifest);
  test('it holds what was added there and what the project uses', () => {
    expect(belongsTo({ project: 'p1', url: 'x' }, 'p1', uses)).toBe(true);
    expect(belongsTo({ url: '/api/film/media?key=aaaaaaaaaaaaaaaa.png' }, 'p1', uses)).toBe(true);
    expect(belongsTo({ url: 'z', assetId: 'asset-in-use' }, 'p1', uses)).toBe(true);
    expect(belongsTo({ url: 'https://tos/used.mp4' }, 'p1', uses)).toBe(true);
  });
  test("it shows the film's own plates and takes, once", () => {
    const studio = { elements: [{ id: 'e', name: 'Morwen', versions: [{ id: 'a', kind: 'plate', status: 'picked', url: 'p.png', name: 'R1' }, { id: 'b', kind: 'plate', status: 'failed', url: 'f.png' }, { id: 'c', kind: 'plate', status: 'kept', url: 'known.png' }] }], scenes: [], brief: { versions: [{ id: 't', kind: 'script', text: 'x', status: 'picked' }] } };
    const out = filmAssets(studio, [{ url: 'known.png' }]);
    expect(out.map((i) => i.id)).toEqual(['film:a']);
    expect(out[0]).toMatchObject({ fromFilm: true, kind: 'image', name: 'R1 Morwen' });
    expect(filmAssets(null)).toEqual([]);
  });
  test('it leaves out everything else', () => {
    expect(belongsTo({ project: 'p2', url: '/api/film/media?key=bbbbbbbbbbbbbbbb.png' }, 'p1', uses)).toBe(false);
    expect(belongsTo({ url: 'other', assetId: 'asset-other' }, 'p1', uses)).toBe(false);
    expect(belongsTo({ url: 'other' }, 'new', usesOf(null))).toBe(false);
  });
});

describe('the Library view', () => {
  const lib = (items) => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ items }) })); };
  test('a file that no longer loads is not shown, and the count says so', async () => {
    lib([{ id: 'a', name: 'good', kind: 'image', url: 'a.png' }, { id: 'b', name: 'gone', kind: 'image', url: 'b.png' }]);
    const { box } = await mount(<Library project="p" />);
    expect(box.textContent).toContain('2 of 2');
    await act(async () => { box.querySelectorAll('img')[1].dispatchEvent(new Event('error')); });
    expect(box.textContent).not.toContain('gone');
    expect(box.textContent).toContain('1 of 1 · 1 no longer load');
  });
  test("only real Library entries can be deleted, not the film's own plates", async () => {
    lib([{ id: 'a', name: 'mine', kind: 'image', url: 'a.png' }, { id: 'film:b', fromFilm: true, name: 'plate', kind: 'image', url: 'b.png' }]);
    const { box } = await mount(<Library project="p" onDelete={async () => {}} />);
    expect(box.querySelector('[aria-label="Delete mine"]')).toBeTruthy();
    expect(box.querySelector('[aria-label="Delete plate"]')).toBeNull();
  });
});

describe('name and tags in the preview', () => {
  test('one quiet row: a name to click, tags, and a way to add one', async () => {
    const onLabel = jest.fn();
    const { box } = await mount(<Preview results={[R[0]]} onLabel={onLabel} />);
    expect(box.querySelector('[aria-label="Name"]')).toBeNull();
    expect(box.querySelector('[aria-label="Add a tag"]')).toBeNull();
    expect(box.textContent).toContain('Morwen');
    expect(box.textContent).toContain('scene 2');
    await act(async () => { box.querySelector('[aria-label="Remove tag scene 2"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onLabel).toHaveBeenCalledWith('R1', { remove_tags: ['scene 2'] });
  });
});

describe('the Library', () => {
  test('search goes by name and kind', () => {
    const items = [{ name: 'Morwen face', kind: 'image' }, { name: 'Morwen walk', kind: 'video' }, { name: 'Cat', kind: 'image' }];
    expect(searchLibrary(items, 'morwen', '').map((i) => i.name)).toEqual(['Morwen face', 'Morwen walk']);
    expect(searchLibrary(items, 'morwen', 'video').map((i) => i.name)).toEqual(['Morwen walk']);
    expect(searchLibrary(items, '', '')).toHaveLength(3);
  });
  test('its source reaches no film tool', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'film', 'Library.js'), 'utf8');
    ['api/film/tools', 'api/film/session', 'deleteFromLibrary', 'clearLibrary'].forEach((word) => expect(src).not.toContain(word));
  });
});

describe('the session', () => {
  test('what is rendering stays in sight, and opens Generations', async () => {
    const onShow = jest.fn();
    const { box } = await mount(<Session events={[]} busy say={async () => {}} stop={() => {}} running={[{ name: 'T3', label: 'the walk', at: Date.now() - 65000 }]} onShowRunning={onShow} />);
    expect(box.textContent).toContain('T3');
    expect(box.textContent).toContain('1:05');
    await act(async () => { box.querySelector('[aria-label="Generations"]').click(); });
    expect(onShow).toHaveBeenCalled();
  });
  test('a step and its end are one line, and a refusal says why', () => {
    const t = threadOf([
      { n: 0, type: 'you', text: 'Make it' },
      { n: 1, type: 'step', id: 'a', tool: 'generate_video', args: { seconds: 8, quality: 'draft' } },
      { n: 2, type: 'step_end', id: 'a', made: ['T1'] },
      { n: 3, type: 'step', id: 'b', tool: 'edit_video', args: { source: 'T1' } },
      { n: 4, type: 'step_end', id: 'b', error: 'T1 is 3 s.' },
      { n: 5, type: 'text', text: 'Done.' },
      { n: 6, type: 'idle' },
    ]);
    expect(t.map((m) => m.kind)).toEqual(['you', 'step', 'step', 'text']);
    expect(t[1]).toMatchObject({ state: 'done', made: ['T1'] });
    expect(t[2]).toMatchObject({ state: 'error', error: 'T1 is 3 s.' });
    expect(stepText(t[1])).toBe('Renders a 8 s draft take');
  });
  test('words and attachments go out through the session', async () => {
    const say = jest.fn(async () => {});
    const { box } = await mount(<Session events={[]} busy={false} say={say} stop={() => {}} />);
    const area = box.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    await act(async () => { set.call(area, 'Make a video'); area.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { box.querySelector('[aria-label="Send"]').click(); });
    expect(say).toHaveBeenCalledWith('Make a video', []);
  });
  test('the same error in a row shows once', () => {
    const t = threadOf([{ n: 0, type: 'error', text: 'x' }, { n: 1, type: 'error', text: 'x' }, { n: 2, type: 'error', text: 'y' }]);
    expect(t.map((m) => m.text)).toEqual(['x', 'y']);
  });
  test('your words show the moment you send them, even while the server is busy', async () => {
    let finish;
    const say = jest.fn(() => new Promise((r) => { finish = r; }));
    const { box } = await mount(<Session events={[]} busy={false} say={say} stop={() => {}} />);
    const area = box.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    await act(async () => { set.call(area, 'Make a video'); area.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { box.querySelector('[aria-label="Send"]').click(); });
    expect(box.textContent).toContain('Make a video');
    expect(box.querySelector('textarea').value).toBe('');
    await act(async () => { finish(); });
  });
  test('a failed send gives your words back', async () => {
    const say = jest.fn(async () => { throw new Error('The server said no.'); });
    const { box } = await mount(<Session events={[]} busy={false} say={say} stop={() => {}} />);
    const area = box.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    await act(async () => { set.call(area, 'Make a video'); area.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { box.querySelector('[aria-label="Send"]').click(); });
    expect(box.querySelector('textarea').value).toBe('Make a video');
    expect(box.textContent).toContain('The server said no.');
  });
  test('a render step opens to show the exact prompt it sent', async () => {
    const events = [{ n: 0, type: 'step', id: 'a', tool: 'generate_video', args: { seconds: 8, quality: 'draft', prompt: 'Morwen stirs the pot slowly' } }, { n: 1, type: 'step', id: 'b', tool: 'list_project', args: {} }];
    const { box } = await mount(<Session events={events} busy say={async () => {}} stop={() => {}} />);
    expect(box.querySelectorAll('details')).toHaveLength(1);
    expect(box.querySelector('details pre').textContent).toBe('Morwen stirs the pot slowly');
  });
  test('while it works, Stop shows', async () => {
    const stop = jest.fn();
    const { box } = await mount(<Session events={[]} busy say={async () => {}} stop={stop} />);
    await act(async () => { box.querySelector('[aria-label="Stop"]').click(); });
    expect(stop).toHaveBeenCalled();
  });
});

describe('after a reset', () => {
  test('the conversation starts again from it', () => {
    const t = threadOf([{ type: 'you', text: 'old' }, { type: 'text', text: 'old answer' }, { type: 'you', text: '/reset' }, { type: 'reset' }, { type: 'you', text: 'new' }]);
    expect(t.map((x) => x.text)).toEqual(['new']);
  });
});
