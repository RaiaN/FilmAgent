// FILMAGENT AS A PI EXTENSION: the film tools, the / commands and the workbenches, registered the way
// Pi expects, so the session can list them and any Pi harness can load them.

export const FILM_COMMANDS = [
  { name: 'edit', description: 'Draw on a picture and say what changes' },
  { name: 'reset', description: 'Start the session over. The film stays as it is' },
];
const describe = (name) => FILM_COMMANDS.find((c) => c.name === name).description;

// Pi's custom UI is for its terminal. A workbench in a browser works like Pi's dialogs instead: a
// request goes out, and whoever asked waits until the answer comes back.
export const createWorkbenches = ({ emit }) => {
  const waiting = new Map();
  let count = 0;
  return {
    ask: (request) => new Promise((resolve) => {
      count += 1;
      const id = `wb${count}`;
      waiting.set(id, resolve);
      emit({ type: 'workbench', id, ...request });
    }),
    answer: (id, value) => {
      const resolve = waiting.get(id);
      if (!resolve) return;
      waiting.delete(id);
      emit({ type: 'workbench_done', id });
      resolve(value);
    },
    cancelAll: () => [...waiting.keys()].forEach((id) => {
      const resolve = waiting.get(id);
      waiting.delete(id);
      emit({ type: 'workbench_done', id });
      resolve({ cancelled: true });
    }),
  };
};

// The picture a word means, or why it can't be edited.
export const pictureNamed = (results, word) => {
  const key = String(word || '').replace(/^@/, '').toLowerCase();
  if (!key) throw new Error('Say which picture: /edit @R1');
  const r = results.find((x) => x.name.toLowerCase() === key || String(x.mention || '').toLowerCase() === key);
  if (!r) throw new Error(`Nothing in this film is called @${word.replace(/^@/, '')}.`);
  if (r.type !== 'image') throw new Error(`${r.name} is a video. Editing works on pictures.`);
  if (r.status === 'running' || r.status === 'failed') throw new Error(`${r.name} is ${r.status === 'running' ? 'still rendering' : 'a failed render'}.`);
  return r;
};

// `tools` are the agent's film tools, each { name, description, parameters }. `execute(tool, params)`
// runs one and answers with Pi's tool result content. `openEdit(word, words)` opens the Edit Image
// workbench and resolves with { name, mention, words, marked } or { cancelled: true }. `cancelWork`
// lets go of whatever waits on the director, and `onReset` hears that a new session has begun.
export const filmAgentExtension = ({ tools, execute, openEdit, onError, cancelWork = () => {}, onReset = () => {} }) => (pi) => {
  tools.forEach((t) => pi.registerTool({
    name: t.name,
    label: t.name,
    description: t.description,
    parameters: t.parameters,
    execute: async (id, params) => ({ content: await execute(t, params), details: undefined }),
  }));
  pi.registerTool({
    name: 'open_edit_image',
    label: 'open_edit_image',
    description: "Open the Edit Image workbench on a picture, so the director can draw where the change goes and say what changes. Waits for them, then answers with their words and any marks picture. Use it when words can't show where. Then call edit_image.",
    parameters: { type: 'object', properties: { source: { type: 'string', description: 'The picture, e.g. R1 or @Morwen.' }, words: { type: 'string', description: 'What they have said so far, unchanged.' } }, required: ['source'] },
    execute: async (id, params) => ({ content: [{ type: 'text', text: JSON.stringify(await openEdit(params.source, params.words || '')) }], details: undefined }),
  });
  pi.registerCommand('edit', {
    description: describe('edit'),
    handler: async (args) => {
      const m = /^(\S*)\s*([\s\S]*)$/.exec(String(args || '').trim());
      try {
        const out = await openEdit(m[1], m[2]);
        if (out.cancelled) return;
        await pi.sendUserMessage([`Edit @${out.mention}: ${out.words}`, out.marked ? `Attached: ${out.marked} (the picture with their marks).` : ''].filter(Boolean).join('\n\n'));
      } catch (e) { onError(e.message); }
    },
  });
  pi.registerCommand('reset', {
    description: describe('reset'),
    handler: async (args, ctx) => {
      cancelWork();
      ctx.abort();
      await ctx.waitForIdle();
      await ctx.newSession();
      onReset();
    },
  });
};
