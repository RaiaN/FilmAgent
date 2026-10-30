// TALKING TO WHAT AN AGENT MADE — the shot, the script, Cast & World and the cut each answer a
// question and, told to, edit themselves. Pure core — the caller injects ctx { client, config }.
//
// TALK TO THE SHOT — one planner call per message. The director's words, the shot's text and
// references, the film's cast and world, the conversation so far and the latest take (as
// video) go in; a reply comes out, and when the director asked for a change, the new text
// and the references to add and remove. Low effort so the shot answers while the director
// is still looking at the take.
import { getModel } from '../suiteConfig';
import { parseJson } from './director';
import { fitText } from './limits';
import { crewStep } from '../skills';

const TALK_EFFORT = 'low';
const HISTORY_TURNS = 8;
// A director's edit may give a take more shots than the AD plans with (1–4).
const EDIT_SHOTS = 6;
// A reply never claims what was not applied: what the checks refused is said after it.
const honest = (reply, rejected) => (rejected.length ? `${reply}\n\nNot applied: ${rejected.join('; ')}.` : reply);
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

// TALK TO THE SCRIPT — the screenplay and its shot list, one planner call per message. The
// director's words, the screenplay, every scene's shots (or the one scene the director stands
// in) and the conversation go in; a reply comes out, and when the director asked for a change,
// the new screenplay and/or the scenes whose shots changed. Code checks what it may apply: a
// screenplay still has sluglines; a scene is one the film has, with 1–4 shots, each on a known
// camera position or one it says where to stand, eyes never on the lens unless asked. What fails
// is reported back, never applied.
const SLUG_RE = /^\s*(INT\.|EXT\.|INT\.\/EXT\.|EXT\.\/INT\.|I\/E\.)\s+\S/m;
const LENS_RE = /\b(camera|lens)\b/i;
export const scriptTalk = async ({ message = '', script = '', scenes = [], focus = null, history = [], config } = {}, ctx) => {
  const said = String(message || '').trim();
  if (!said) throw new Error('Say what to change, or ask the script something.');
  fitText(said, 2000, 'The message');
  fitText(String(script || ''), 30000, 'The screenplay');
  const shown = focus ? scenes.filter((sc) => sc.n === focus) : scenes;
  const sceneText = (sc) => `SCENE ${sc.n} — ${sc.place}${sc.time ? ` · ${sc.time}` : ''}${sc.seconds ? ` · ${sc.seconds} s` : ''}\n${sc.shots.length ? sc.shots.map((sh, i) => `  ${i + 1}. [${sh.view} — the camera ${sh.from}] ${sh.action} Eyes on: ${sh.looksAt}`).join('\n') : '  (no shots yet)'}`;
  const lines = [
    `THE SCREENPLAY:\n"""\n${String(script || '').trim() || '(empty)'}\n"""`,
    shown.length ? `${focus ? `THE DIRECTOR STANDS IN SCENE ${focus}. ITS SHOTS` : 'THE SHOT LIST'}:\n${shown.map(sceneText).join('\n\n')}` : 'There is no shot list yet.',
    history.length ? `THE CONVERSATION SO FAR:\n${history.slice(-HISTORY_TURNS).map((h) => `${h.from === 'you' ? 'Director' : 'Script'}: ${h.text}`).join('\n')}` : '',
    `THE DIRECTOR NOW SAYS:\n${said}`,
  ].filter(Boolean);
  const system = await crewStep('crew-script', 'talk', {});
  const ask = async (retry) => parseJson((await ctx.client.reason({ prompt: `${lines.join('\n\n')}${retry}\n\nReturn the JSON.`, systemPrompt: system, modelId: getModel('reasoner', config), reasoningEffort: TALK_EFFORT })).content);
  const asked = LENS_RE.test(said);
  // What of an answer may be applied, and what is refused (and why).
  const check = (raw) => {
    const rejected = [];
    let screenplay = String(raw.screenplay || '').replace(/^```\w*\s*|\s*```$/g, '').trim();
    if (screenplay && screenplay === String(script || '').trim()) screenplay = '';
    if (screenplay && !SLUG_RE.test(screenplay)) { rejected.push('the new screenplay has no sluglines — kept the old one'); screenplay = ''; }
    const changed = (Array.isArray(raw.scenes) ? raw.scenes : []).map((x) => {
      const sc = scenes.find((y) => y.n === Number(x?.n));
      if (!sc) { rejected.push(`scene ${x?.n} is not in the film`); return null; }
      const shots = (Array.isArray(x.shots) ? x.shots : []).map((sh) => ({ view: String(sh?.view || '').trim(), from: String(sh?.from || '').trim(), action: String(sh?.action || '').trim(), looksAt: String(sh?.looksAt || '').trim() }));
      const known = (v) => sc.shots.some((sh) => sh.view === v);
      const bad = [];
      if (!shots.length || shots.length > EDIT_SHOTS) bad.push(`needs 1–${EDIT_SHOTS} shots (one take of at most 15 s)`);
      shots.forEach((sh, i) => {
        if (!sh.view || !sh.action) bad.push(`shot ${i + 1} needs a camera position and what we see`);
        else if (!known(sh.view) && !sh.from) bad.push(`shot ${i + 1} is on a new camera position without saying where it stands`);
        if (!sh.looksAt) bad.push(`shot ${i + 1} says nothing about where eyes go`);
        else if (!asked && LENS_RE.test(sh.looksAt)) bad.push(`shot ${i + 1} has someone looking at the camera`);
      });
      if (bad.length) { rejected.push(`scene ${sc.n} kept as it was: ${bad.join('; ')}`); return null; }
      return { n: sc.n, shots };
    }).filter(Boolean);
    return { screenplay, scenes: changed, rejected };
  };
  let raw = await ask('');
  if (!raw || typeof raw !== 'object') throw new Error('The script answered without the JSON it owes — say it again.');
  let out = check(raw);
  // A change the checks refuse gets ONE corrective re-ask; what is still refused is reported,
  // and the reply never claims it.
  if (out.rejected.length) {
    const again = await ask(`\n\nRETRY — these changes could not be applied; fix them, or say in the reply that you could not:\n${out.rejected.map((x) => `• ${x}`).join('\n')}`);
    if (again && typeof again === 'object') { raw = again; out = check(raw); }
  }
  const reply = String(raw.reply || '').trim();
  if (!reply) throw new Error('The script answered with nothing to say — say it again.');
  return { reply: honest(reply, out.rejected), ...out };
};

// TALK TO CAST & WORLD — one planner call per message: the director's words, every element
// (name, kind, description, picture or not, the shots it is in; or the one element the director
// stands on) and the conversation go in; a reply comes out, and when the director asked for a
// change: renames and descriptions, additions, removals, and picture changes (each an image edit
// of that element's plate). Code checks what it may apply: names are the film's (or new and
// free), a kind is character / location / prop, nothing used in a shot is removed. What fails is
// reported back, never applied.
const KINDS = ['character', 'location', 'prop'];
export const castTalk = async ({ message = '', elements = [], focus = null, history = [], config } = {}, ctx) => {
  const said = String(message || '').trim();
  if (!said) throw new Error('Say what to change, or ask Cast & World something.');
  fitText(said, 2000, 'The message');
  const line = (e) => `- ${e.name} (${e.kind}${e.plated ? '' : ', no picture yet'}${e.shots ? `, in ${e.shots} shot${e.shots === 1 ? '' : 's'}` : ''})${e.desc ? `: ${e.desc}` : ''}`;
  const lines = [
    `CAST & WORLD:\n${elements.length ? elements.map(line).join('\n') : '(nobody yet)'}`,
    focus ? `THE DIRECTOR STANDS ON: ${focus}` : '',
    history.length ? `THE CONVERSATION SO FAR:\n${history.slice(-HISTORY_TURNS).map((h) => `${h.from === 'you' ? 'Director' : 'Cast & World'}: ${h.text}`).join('\n')}` : '',
    `THE DIRECTOR NOW SAYS:\n${said}`,
  ].filter(Boolean);
  const system = await crewStep('crew-cast', 'talk', {});
  const ask = async (retry) => parseJson((await ctx.client.reason({ prompt: `${lines.join('\n\n')}${retry}\n\nReturn the JSON.`, systemPrompt: system, modelId: getModel('reasoner', config), reasoningEffort: TALK_EFFORT })).content);
  // A description and its picture say the same thing: a new look for something with a picture
  // edits the picture too — one corrective re-ask, then what is still missing is reported.
  const unpictured = (r) => (Array.isArray(r?.changes) ? r.changes : []).filter((c) => String(c?.desc || '').trim() && elements.find((e) => low(e.name) === low(c?.name))?.plated
    && !(Array.isArray(r?.pictures) ? r.pictures : []).some((p) => low(p?.name) === low(c?.name))).map((c) => String(c.name).trim());
  let raw = await ask('');
  if (unpictured(raw).length) raw = await ask(`\n\nRETRY — you changed the description of ${unpictured(raw).join(', ')}, which ${unpictured(raw).length === 1 ? 'has a picture' : 'have pictures'}: say in "pictures" how each picture changes, or leave the description as it was.`);
  if (!raw || typeof raw !== 'object') throw new Error('Cast & World answered without the JSON it owes — say it again.');
  const reply = String(raw.reply || '').trim();
  if (!reply) throw new Error('Cast & World answered with nothing to say — say it again.');
  const str = (x) => String(x || '').trim();
  const by = new Map(elements.map((e) => [low(e.name), e]));
  const rejected = [];
  const known = (n, what) => { const e = by.get(low(n)); if (!e) rejected.push(`${what}: no "${n}" in Cast & World`); return e || null; };
  const changes = (Array.isArray(raw.changes) ? raw.changes : []).map((c) => {
    const e = known(str(c?.name), 'change');
    if (!e) return null;
    const rename = str(c.rename);
    if (rename && low(rename) !== low(e.name) && by.has(low(rename))) { rejected.push(`"${e.name}" not renamed: "${rename}" is already someone`); return null; }
    const desc = str(c.desc);
    return rename || desc ? { name: e.name, ...(rename && rename !== e.name ? { rename } : {}), ...(desc ? { desc } : {}) } : null;
  }).filter(Boolean);
  const add = (Array.isArray(raw.add) ? raw.add : []).map((a) => {
    const name = str(a?.name);
    const kind = low(a?.kind);
    if (!name) return null;
    if (by.has(low(name))) { rejected.push(`"${name}" is already in Cast & World`); return null; }
    if (!KINDS.includes(kind)) { rejected.push(`"${name}" not added: kind "${a?.kind}" is not character, location or prop`); return null; }
    return { name, kind, desc: str(a.desc) };
  }).filter(Boolean);
  const remove = (Array.isArray(raw.remove) ? raw.remove : []).map(str).filter(Boolean).map((n) => {
    const e = known(n, 'remove');
    if (!e) return null;
    if (e.shots) { rejected.push(`"${e.name}" not removed: it is in ${e.shots} shot${e.shots === 1 ? '' : 's'}`); return null; }
    return e.name;
  }).filter(Boolean);
  const pictures = (Array.isArray(raw.pictures) ? raw.pictures : []).map((p) => {
    const e = known(str(p?.name), 'picture');
    const change = str(p?.change);
    return e && change ? { name: e.name, change } : null;
  }).filter(Boolean);
  unpictured({ changes, pictures }).forEach((n) => rejected.push(`${n}'s description changed but not the picture — ask for the picture too`));
  return { reply: honest(reply, rejected), changes, add, remove, pictures, rejected };
};

// TALK TO THE CUT — one planner call per message: the director's words, the cut as it plays
// (its shots in order), every shot with a circled take and the conversation go in; a reply
// comes out, and when the director asked for a change, the new order of shot numbers. Code
// checks every number is a circled shot, none twice; what fails is reported, never applied.
export const cutTalk = async ({ message = '', cut = [], shots = [], history = [], config } = {}, ctx) => {
  const said = String(message || '').trim();
  if (!said) throw new Error('Say what to change, or ask the cut something.');
  fitText(said, 2000, 'The message');
  const shot = (n) => shots.find((x) => x.n === n);
  const lines = [
    `THE CUT AS IT PLAYS: ${cut.length ? cut.map((n) => `${n} ${shot(n)?.title || ''}`.trim()).join(' → ') : '(no cut yet)'}`,
    `EVERY SHOT WITH A CIRCLED TAKE:\n${shots.map((x) => `${x.n}. ${x.title} — scene ${x.scene}, ${x.seconds} s`).join('\n') || '(none)'}`,
    history.length ? `THE CONVERSATION SO FAR:\n${history.slice(-HISTORY_TURNS).map((h) => `${h.from === 'you' ? 'Director' : 'Cut'}: ${h.text}`).join('\n')}` : '',
    `THE DIRECTOR NOW SAYS:\n${said}`,
  ].filter(Boolean);
  const { content } = await ctx.client.reason({
    prompt: `${lines.join('\n\n')}\n\nReturn the JSON.`,
    systemPrompt: await crewStep('crew-editor', 'talk', {}),
    modelId: getModel('reasoner', config),
    reasoningEffort: TALK_EFFORT,
  });
  const check = (raw) => {
    const order = (Array.isArray(raw?.order) ? raw.order : []).map(Number);
    const rejected = [];
    if (order.length) {
      const bad = order.filter((n) => !shot(n));
      const twice = order.filter((n, i) => order.indexOf(n) !== i);
      if (bad.length) rejected.push(`no circled take for shot ${bad.join(', ')} — the cut stays as it was`);
      else if (twice.length) rejected.push(`shot ${[...new Set(twice)].join(', ')} twice — the cut stays as it was`);
    }
    const same = order.length === cut.length && order.every((n, i) => n === cut[i]);
    return { order: order.length && !rejected.length && !same ? order : [], rejected };
  };
  let raw = parseJson(content);
  if (!raw || typeof raw !== 'object') throw new Error('The cut answered without the JSON it owes — say it again.');
  let out = check(raw);
  if (out.rejected.length) {
    const again = parseJson((await ctx.client.reason({ prompt: `${lines.join('\n\n')}\n\nRETRY — this order could not be applied; fix it, or say in the reply that you could not:\n${out.rejected.map((x) => `• ${x}`).join('\n')}\n\nReturn the JSON.`, systemPrompt: await crewStep('crew-editor', 'talk', {}), modelId: getModel('reasoner', config), reasoningEffort: TALK_EFFORT })).content);
    if (again && typeof again === 'object') { raw = again; out = check(raw); }
  }
  const reply = String(raw.reply || '').trim();
  if (!reply) throw new Error('The cut answered with nothing to say — say it again.');
  return { reply: honest(reply, out.rejected), ...out };
};
