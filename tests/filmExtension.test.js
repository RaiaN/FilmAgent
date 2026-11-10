/**
 * @jest-environment node
 */
// FILMAGENT AS A PI EXTENSION: tools and commands reach Pi through its own registration calls, and a
// workbench is a request that waits for its answer.
import { FILM_COMMANDS, createWorkbenches, filmAgentExtension, pictureNamed } from '../scripts/film-agent-extension.mjs';

const fakePi = () => {
  const tools = [];
  const commands = {};
  return { tools, commands, sendUserMessage: jest.fn(async () => {}), registerTool: (t) => tools.push(t), registerCommand: (n, c) => { commands[n] = c; } };
};
const setup = (openEdit = async () => ({ cancelled: true }), execute = async () => []) => {
  const pi = fakePi();
  const onError = jest.fn();
  filmAgentExtension({ tools: [{ name: 'look', description: 'See it', parameters: { type: 'object', properties: {} } }], execute, openEdit, onError })(pi);
  return { pi, onError };
};

describe('the extension', () => {
  test('registers the film tools and runs them through the harness', async () => {
    const execute = jest.fn(async () => [{ type: 'text', text: 'ok' }]);
    const { pi } = setup(undefined, execute);
    expect(pi.tools.map((t) => t.name)).toEqual(['look', 'open_edit_image']);
    expect(await pi.tools[0].execute('id', { name: 'T1' })).toEqual({ content: [{ type: 'text', text: 'ok' }], details: undefined });
  });
  test('registers every listed command', () => {
    expect(Object.keys(setup().pi.commands)).toEqual(FILM_COMMANDS.map((c) => c.name));
  });
  test('/edit opens the workbench, then sends what came back, words unchanged', async () => {
    const openEdit = jest.fn(async () => ({ name: 'R1', mention: 'Morwen', words: 'make it red', marked: 'R5' }));
    const { pi } = setup(openEdit);
    await pi.commands.edit.handler('@Morwen make');
    expect(openEdit).toHaveBeenCalledWith('@Morwen', 'make');
    expect(pi.sendUserMessage.mock.calls[0][0]).toBe('Edit @Morwen: make it red\n\nAttached: R5 (the picture with their marks).');
  });
  test('a cancelled workbench sends nothing, and a wrong target says why', async () => {
    const quiet = setup();
    await quiet.pi.commands.edit.handler('@R1');
    expect(quiet.pi.sendUserMessage).not.toHaveBeenCalled();
    const wrong = setup(async () => { throw new Error('T1 is a video.'); });
    await wrong.pi.commands.edit.handler('@T1');
    expect(wrong.onError).toHaveBeenCalledWith('T1 is a video.');
  });
  test('/reset lets go of waiting work, stops the run, then starts a new Pi session', async () => {
    const pi = fakePi();
    const order = [];
    const mark = (name) => jest.fn(async () => { order.push(name); });
    const cancelWork = mark('cancel');
    const onReset = mark('reset');
    filmAgentExtension({ tools: [], execute: async () => [], openEdit: async () => ({}), onError: () => {}, cancelWork, onReset })(pi);
    await pi.commands.reset.handler('', { abort: mark('abort'), waitForIdle: mark('idle'), newSession: mark('new') });
    expect(order).toEqual(['cancel', 'abort', 'idle', 'new', 'reset']);
  });
  test('the agent can open it too, and waits for the answer', async () => {
    const { pi } = setup(async () => ({ name: 'R1', words: 'red', marked: null }));
    const out = await pi.tools[1].execute('id', { source: 'R1' });
    expect(JSON.parse(out.content[0].text)).toMatchObject({ name: 'R1', words: 'red' });
  });
});

describe('a workbench', () => {
  test('is a request that waits for its answer', async () => {
    const events = [];
    const wb = createWorkbenches({ emit: (e) => events.push(e) });
    const pending = wb.ask({ kind: 'edit_image', name: 'R1' });
    expect(events[0]).toMatchObject({ type: 'workbench', id: 'wb1', name: 'R1' });
    wb.answer('wb1', { words: 'red' });
    expect(await pending).toEqual({ words: 'red' });
    expect(events[1]).toEqual({ type: 'workbench_done', id: 'wb1' });
    wb.answer('wb1', { words: 'again' });
    expect(events).toHaveLength(2);
  });
  test('stopping lets go of what was waiting', async () => {
    const wb = createWorkbenches({ emit: () => {} });
    const pending = wb.ask({ kind: 'edit_image', name: 'R1' });
    wb.cancelAll();
    expect(await pending).toEqual({ cancelled: true });
  });
});

describe('the picture a word means', () => {
  const rs = [{ name: 'R1', type: 'image', status: 'review', mention: 'Morwen' }, { name: 'T1', type: 'video', status: 'review' }];
  test('by short name or @name', () => {
    expect(pictureNamed(rs, '@morwen').name).toBe('R1');
    expect(pictureNamed(rs, 'r1').name).toBe('R1');
  });
  test('or why not', () => {
    expect(() => pictureNamed(rs, '')).toThrow('Say which picture');
    expect(() => pictureNamed(rs, '@T1')).toThrow('T1 is a video');
    expect(() => pictureNamed(rs, '@R9')).toThrow('@R9');
  });
});
