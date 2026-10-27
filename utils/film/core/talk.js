// TALK TO THE SHOT — one planner call per message. The director's words, the shot's text and
// references, the film's cast and world, the conversation so far and the latest take (as
// video) go in; a reply comes out, and when the director asked for a change, the new text
// and the references to add and remove. Low effort so the shot answers while the director
// is still looking at the take.
//
// Pure core — the caller injects ctx { client, config }.
import { getModel } from '../suiteConfig';
import { parseJson } from './director';
import { fitText } from './limits';
import { crewStep } from '../skills';

const TALK_EFFORT = 'low';
const HISTORY_TURNS = 8;
const low = (x) => String(x || '').trim().toLowerCase();

export const shotTalk = async ({ message = '', text = '', refs = [], cast = [], take = null, history = [], config } = {}, ctx) => {
  const said = String(message || '').trim();
  if (!said) throw new Error('Say what to change, or ask the shot something.');
  fitText(said, 2000, 'The message');
  fitText(String(text || ''), 12000, "The shot's text");
  const lines = [
    `THE SHOT'S TEXT NOW:\n"""\n${String(text || '').trim() || '(empty)'}\n"""`,
    `ITS REFERENCES NOW: ${refs.length ? refs.map((r) => `${r.name} (${r.kind})`).join(' · ') : 'none'}`,
    `THE FILM'S CAST AND WORLD (names a reference can be added from): ${cast.length ? cast.map((c) => `${c.name} (${c.kind}${c.plated ? '' : ', no picture yet'})`).join(' · ') : 'none'}`,
    take
      ? `THE LATEST TAKE is attached as video.${take.prompt ? ` It was made from this prompt:\n"""\n${String(take.prompt).slice(0, 6000)}\n"""` : ''}`
      : 'There is no take yet.',
    history.length ? `THE CONVERSATION SO FAR:\n${history.slice(-HISTORY_TURNS).map((h) => `${h.from === 'you' ? 'Director' : 'Shot'}: ${h.text}`).join('\n')}` : '',
    `THE DIRECTOR NOW SAYS:\n${said}`,
  ].filter(Boolean);
  const { content } = await ctx.client.reason({
    prompt: `${lines.join('\n\n')}\n\nReturn the JSON.`,
    systemPrompt: await crewStep('crew-shot', 'talk', {}),
    ...(take?.videoUrl ? { video: take.videoUrl } : {}),
    modelId: getModel('reasoner', config),
    reasoningEffort: TALK_EFFORT,
  });
  const raw = parseJson(content);
  if (!raw || typeof raw !== 'object') throw new Error('The shot answered without the JSON it owes — say it again.');
  const reply = String(raw.reply || '').trim();
  if (!reply) throw new Error('The shot answered with nothing to say — say it again.');
  const names = (xs) => (Array.isArray(xs) ? xs : []).map((x) => String(x || '').trim()).filter(Boolean);
  // Adds come only from the film's list and removals only from the shot's own references;
  // a name that is neither is reported, never guessed onto something else.
  const castBy = new Map(cast.map((c) => [low(c.name), c]));
  const refBy = new Map(refs.map((r) => [low(r.name), r]));
  const add = names(raw.add).filter((n) => castBy.has(low(n)) && !refBy.has(low(n))).map((n) => castBy.get(low(n)).name);
  const unknown = names(raw.add).filter((n) => !castBy.has(low(n)));
  const remove = names(raw.remove).filter((n) => refBy.has(low(n))).map((n) => refBy.get(low(n)).name);
  return { reply, text: String(raw.text || '').trim(), add, remove, unknown };
};
