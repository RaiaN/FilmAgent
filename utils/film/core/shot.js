// SHOT-CARD PROMPT VERBS. Everything a card does to its own prompt text lives here:
// COMPOSE writes the final prompt, DIRECT reshapes it to a note, EDIT writes the
// editing prompt for a card that has a master. All three send the model's bound SKILL
// verbatim and return text that ships to the endpoint unchanged — nothing wraps it
// afterwards, which is why each one carries its own gate.
import { renderTemplate, getModel, getRuntime, defaultVideoModelKey, videoTraits } from '../suiteConfig';
import { SHOT_TEMPLATE_BY_ID } from '../recipes';
import { parseJson } from './director';
import { requireSkillLine } from '../skills';
import { withDialogueGate } from './storyboard';

// The card's LOCKED camera preset as a hard contract for the prompt verbs: prose
// film-grammar alone is weak, so the camera must live IN the action text — staged,
// not tagged. No preset → the verb commits to one camera of its own choosing.
// The shot's ONE JOB (carved upstream) as an intent contract: every sentence the
// verb writes serves it. Absent → an empty line; the verb owes the shot a job of its own.
const jobLineOf = (job) => (String(job || '').trim()
  ? `THE SHOT'S ONE JOB (from the shot list — every sentence serves it): ${String(job).trim()}`
  : '');

// The card's LOOK and SOUND. Nothing appends these any more, so the prompt must carry
// them or they do not reach the model. Empty fields say nothing — never a default look.
const lookLineOf = ({ style = '', cinematography = '', audio = '' } = {}) => {
  const look = [String(style || '').trim(), String(cinematography || '').trim()].filter(Boolean).join(' · ');
  const snd = String(audio || '').trim();
  return [
    look ? `LOOK (from the card — carry it into the prompt): ${look}.` : '',
    snd ? `SOUND (from the card — carry it in the spec's symbol grammar): ${snd}` : '',
  ].filter(Boolean).join('\n') || 'No look or sound is pinned on the card — add none of your own beyond what the material implies.';
};

const cameraLineOf = (camera) => (camera && (camera.framing || camera.move)
  ? `CAMERA (director-locked, non-negotiable): ${[camera.framing, camera.angle, camera.move].filter(Boolean).join(' · ')}. Stage every event FOR this exact camera, carry it in the action text (summary sentence included), and never contradict it.`
  : 'No camera preset is locked — choose the single camera that serves the action best and commit to it in the text.');

// KEYFRAMES ARE A MODEL CAPABILITY, not a card feature. Seedance 2.0 has no first/last
// frame control at all, so its pinned stills are plain references and the prompt must
// NOT claim the shot opens or lands on them — a promise the endpoint cannot keep.
const kfLineOf = (kfIndices, modelKey) => {
  if (!kfIndices.length) return 'No keyframes are set — ground the action against the reference images and the text alone.';
  if (!videoTraits(modelKey).keyframes) {
    return `This model has NO keyframe control: image ${kfIndices.join(', image ')} ${kfIndices.length === 1 ? 'is a plain reference' : 'are plain references'} like every other attached image. Do NOT write that the shot opens on, passes through or lands on any of them — it cannot. Use them for what they SHOW.`;
  }
  return `KEYFRAMES — image ${kfIndices.join(', image ')} ${kfIndices.length === 1 ? 'is this shot\'s' : 'are this shot\'s'} visual spine, IN THAT ORDER: the shot opens on image ${kfIndices[0]}${kfIndices.length > 1 ? ` and lands on image ${kfIndices[kfIndices.length - 1]}` : ''}. YOUR PROMPT MUST SAY SO ITSELF, in the spec's own keyframe grammar — nothing adds those sentences for you.`;
};

// DIRECT — apply ONE director's note to the card's prompt: the note shapes how the
// shot FEELS and READS (tone, pacing, emphasis, atmosphere, wording); events, order,
// [Image N] tags, dialogue, references and keyframes all stay. The note wins over the
// old text where they disagree.
export const directShotAction = async ({ text = '', note = '', references = [], roster = [], kfIndices = [], modelKey = defaultVideoModelKey(), camera = null, job = '', config } = {}, ctx) => {
  const material = String(text || '').trim();
  const theNote = String(note || '').trim();
  if (!material) throw new Error('Direct needs the shot prompt — write it or Compose first.');
  if (!theNote) throw new Error('Write the note — what should this shot feel or read like?');
  const T = '@@TEXT@@';
  const N = '@@NOTE@@';
  const run = async (retry) => {
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('cut.direct.user', { refRoster: roster.join('\n') || '(no images attached)', text: T, note: N })
        .split(T).join(material.slice(0, 6000)).split(N).join(theNote.slice(0, 1500)) + retry,
      systemPrompt: renderTemplate('cut.direct.system', { refCount: String(references.length), kfLine: kfLineOf(kfIndices, modelKey), jobLine: jobLineOf(job), cameraLine: cameraLineOf(camera), skill: await requireSkillLine(modelKey) }),
      images: references,
      modelId: getModel('reasoner', config),
      reasoningEffort: getRuntime(config).reasoningEffort,
    });
    const raw = parseJson(content) || {};
    return { action: String(raw.action || '').trim(), audio: String(raw.audio || '').trim() };
  };
  const out = await withDialogueGate(material, 'action', run);
  if (!out.action) throw new Error('Direct came back empty — try again.');
  return out;
};

export const composeShotAction = async ({ text = '', references = [], roster = [], kfIndices = [], modelKey = defaultVideoModelKey(), camera = null, job = '', style = '', cinematography = '', audio = '', config } = {}, ctx) => {
  const material = String(text || '').trim();
  if (!material && !references.length) throw new Error('Compose needs a prompt, keyframes or references to work from.');
  // ---- STEP 1 · DERIVE (keyframes only — deliberately blind to text and refs, so the
  // events come from the approved pictures with no old prompt to anchor on) ----
  let derived = '';
  if (kfIndices.length) {
    const kfUrls = kfIndices.map((k) => references[k - 1]).filter(Boolean);
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('cut.derive.user', { kfCount: String(kfUrls.length) }),
      systemPrompt: renderTemplate('cut.derive.system', { kfCount: String(kfUrls.length) }),
      images: kfUrls,
      modelId: getModel('reasoner', config),
      reasoningEffort: getRuntime(config).reasoningEffort,
    });
    derived = String((parseJson(content) || {}).events || '').trim();
    if (!derived) throw new Error('Deriving from the keyframes came back empty — try again.');
  }
  // ---- STEP 2 · WRITE (all chips + roster + derived events + optional text) ----
  const kfLine = kfLineOf(kfIndices, modelKey);
  const authorityLine = kfIndices.length
    ? `THE DERIVED EVENTS below were read from the shot's APPROVED KEYFRAMES — they are the authority on WHAT HAPPENS:\n<<<\n${derived}\n>>>\nRewrite them into the final action: replace each visual handle with its subject's [Image N] number from the roster, keep the event order and pacing. From the director's text carry ONLY what pictures cannot show — every dialogue line word-for-word in curly braces with its speaker named (placed at the right moments), proper names, and intent that does not contradict the events. Any text event the derived events contradict is dropped — list each in "dropped" (one short line), never silently.`
    : `The director's text is the MATERIAL and the authority on WHAT HAPPENS: carry its wording, its events and every dialogue line word-for-word in curly braces with the speaker named — you re-structure and ground it against the images, you never re-invent it. "dropped" stays empty.`;
  const SLOT = '@@PROMPT@@';
  const run = async (retry) => {
    const { content } = await ctx.client.reason({
      prompt: renderTemplate('cut.compose.user', { refRoster: roster.join('\n') || '(no images attached)', text: SLOT }).split(SLOT).join(material.slice(0, 6000) || '(none — write from the images)') + retry,
      systemPrompt: renderTemplate('cut.compose.system', { refCount: String(references.length), kfLine, authorityLine, jobLine: jobLineOf(job), cameraLine: cameraLineOf(camera), lookLine: lookLineOf({ style, cinematography, audio }), skill: await requireSkillLine(modelKey) }),
      images: references,
      modelId: getModel('reasoner', config),
      reasoningEffort: getRuntime(config).reasoningEffort,
    });
    const raw = parseJson(content) || {};
    return {
      action: String(raw.action || '').trim(),
      audio: String(raw.audio || '').trim(),
      dropped: (Array.isArray(raw.dropped) ? raw.dropped : []).map((c) => String(c || '').trim()).filter(Boolean).slice(0, 6),
    };
  };
  // The director's own text is the dialogue source — keyframes cannot speak, so a line
  // in the text must survive into the action even when the pictures rule the events.
  // THE NUMBERING GATE. Nothing renumbers the prompt after this, so a citation outside
  // 1..refCount would attach the WRONG picture at the wire. Run → check → retry once
  // naming the offenders → report. A template that asks is not a guarantee.
  const cited = (t) => [...String(t || '').matchAll(/(?:@\s*Image\s*|\[\s*Image\s+)(\d+)/gi)].map((m) => Number(m[1]));
  const strays = (t) => [...new Set(cited(t).filter((n) => n < 1 || n > references.length))];
  const gated = async (retry) => {
    const first = await withDialogueGate(material, 'action', (r) => run([retry, r].filter(Boolean).join('\n')));
    const bad = strays(first.action);
    if (!bad.length || !references.length) return { ...first, strayRefs: bad };
    const second = await run(`RETRY — your last prompt cited image ${bad.join(', image ')}, which ${bad.length === 1 ? 'does' : 'do'} not exist. ONLY images 1–${references.length} are attached. Rewrite it citing nothing outside that range.`);
    return { ...second, strayRefs: strays(second.action) };
  };
  const out = await gated('');
  if (!out.action) throw new Error('Compose came back empty — try again.');
  return { ...out, derived };
};

// EDIT — the FINAL prompt for an editing task. One master governs everything the note
// does not name, so the whole contract is: say what changes, say what stays, and CLOSE
// THE SCOPE. The closure sentence is the spec's, verbatim, and it is not optional:
// the model is asked for it and the code guarantees it, because an edit without a
// closure lets downstream enhancement reactivate anything it feels like.
export const SCOPE_CLOSURE = 'Except for the objects explicitly modified above, all other visible characters, props, and background elements in the source video remain unchanged and are not to be replaced or removed.';

export const editShotAction = async ({ text = '', master = null, references = [], roster = [], modelKey = defaultVideoModelKey(), config } = {}, ctx) => {
  const material = String(text || '').trim();
  if (!master?.url) throw new Error('An edit needs its master — pick the video this card edits.');
  if (!material) throw new Error('Say what changes — an edit with no note has nothing to do.');
  const secs = Number(master.duration) || 0;
  if (secs && secs < 4) throw new Error(`The master is ${secs.toFixed(1)}s — an editing task needs a 4–30s source.`);
  const masterLine = `THE MASTER is the video being edited: ${master.label || 'the attached video'}${secs ? `, ${secs.toFixed(1)}s` : ''}${master.ratio ? `, ${master.ratio}` : ''}. It rides as the sole editing reference and its ratio and duration are NOT sent — the endpoint locks both to it.`;
  const SLOT = '@@EDIT@@';
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('cut.edit.user', { refRoster: roster.join('\n') || '(no target images attached)', text: SLOT }).split(SLOT).join(material.slice(0, 6000)),
    systemPrompt: renderTemplate('cut.edit.system', { refCount: String(references.length), masterLine, skill: await requireSkillLine(modelKey) }),
    images: references,
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const raw = parseJson(content) || {};
  let action = String(raw.action || '').trim();
  if (!action) throw new Error('The edit came back empty — try again.');
  // THE CLOSURE GATE. Asked for above; guaranteed here. "retain only" phrasing counts
  // as its own closure, so only a prompt with neither gets one appended.
  const closed = /except for the objects explicitly (modified|retained)/i.test(action);
  if (!closed) action = `${action}\n\n${SCOPE_CLOSURE}`;
  // Same numbering rule as Compose: nothing renumbers this afterwards.
  const strays = [...new Set([...action.matchAll(/(?:@\s*Image\s*|\[\s*Image\s+|\bimage\s+)(\d+)/gi)]
    .map((m) => Number(m[1])).filter((n) => n < 1 || n > references.length))];
  return { action, audio: String(raw.audio || '').trim(), strayRefs: strays, closureAdded: !closed };
};
