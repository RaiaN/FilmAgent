// THE CREW — every agent the director can @-address, each job a CONTRACT: where it works
// (scopes), what it delivers in one line (shown in the @ menu), and which containers its
// versions land in (the harness refuses a delivery anywhere else). Where you stand decides the
// job: Casting casts the film from Cast & World and varies a character from that element.
// `@Agent [words]` runs at once; what it makes waits for your verdict (pick · note · reject).
// A button job (Final, Draw again) is pressed on a version, never @-asked.
// EDIT: everything an agent makes can be edited from your words. Words without an @ edit what
// you stand on (a talk job: Script, Cast, Shot, the Editor); a note in the viewer edits the
// version you look at (editorFor). Either way the edit is a new version of that output, its
// parent the one you edited — only what the words touch changes.

export const CREW = [
  { id: 'writers', handle: 'Writers', name: 'Writers', job: 'the screenplay', actions: [
    { id: 'develop', label: 'Write', scopes: ['brief'], delivers: 'a screenplay of your idea', lands: ['brief'], hint: 'the idea, in your words' },
  ] },
  { id: 'ad', handle: 'AD', name: '1st AD', job: 'the shot list', actions: [
    { id: 'shots', label: 'Shot list', scopes: ['brief'], delivers: 'the shot list: every scene and its shots', lands: ['brief'], hint: 'what to favour' },
    { id: 'block', label: 'Block', scopes: ['scene', 'shot'], delivers: "this scene's shots again", lands: ['scene'], hint: 'what to favour' },
  ] },
  { id: 'casting', handle: 'Casting', name: 'Casting', job: 'faces and places', actions: [
    { id: 'cast', label: 'Cast', scopes: ['world'], delivers: 'a plate for everyone in Cast & World without one', lands: ['element'], hint: 'anything about the cast' },
    { id: 'variation', label: 'Recast', scopes: ['element'], kinds: ['character'], delivers: '2 variations of this character', lands: ['element'], hint: 'older, weathered…' },
    { id: 'redraw', label: 'Draw again', scopes: ['element'], delivers: 'the plate drawn again from its edited prompt', lands: ['element'], button: true },
  ] },
  { id: 'designer', handle: 'Designer', name: 'Designer', job: 'places, props and views', actions: [
    { id: 'variation', label: 'Redesign', scopes: ['element'], kinds: ['location', 'prop'], delivers: '2 variations of this place or prop', lands: ['element'], hint: 'at night, rain…' },
    { id: 'views', label: 'Views', scopes: ['scene', 'shot'], delivers: "the views this scene's blocking needs, from the place's plate", lands: ['element'], hint: 'anything about the views' },
  ] },
  { id: 'camera', handle: 'Camera', name: 'Camera', job: 'takes', actions: [
    { id: 'draft', label: 'Draft', scopes: ['scene', 'shot'], delivers: 'a 480p draft of each shot here', lands: ['take'], hint: 'anything for the take' },
    { id: 'final', label: 'Final', scopes: ['scene', 'shot'], delivers: 'the circled draft at full resolution', lands: ['take'], button: true },
  ] },
  { id: 'vfx', handle: 'VFX', name: 'VFX', job: 'edit a take', actions: [
    { id: 'edit', label: 'Edit', scopes: ['shot'], delivers: 'an edit of the circled take — only what you name changes', lands: ['take'], hint: 'what changes — the rest stays' },
  ] },
  // The script itself — the screenplay and its shot list: talk to it without an @ at the Brief
  // (or at a scene, for that scene's shots) — it answers, and changes itself when told to.
  { id: 'script', handle: 'Script', name: 'Script', job: 'talk to the screenplay and the shot list', actions: [
    { id: 'talk', label: 'Talk', scopes: ['brief', 'scene'], talk: true, delivers: "an answer; told to, it edits the screenplay or a scene's shots", lands: ['brief', 'scene'], hint: 'what to change, or ask it anything' },
  ] },
  // Cast & World itself: talk to it without an @ — it answers, and renames, re-describes, adds or
  // removes people, places and props, or edits a picture, when told to.
  { id: 'cast', handle: 'Cast', name: 'Cast & World', job: 'talk to Cast & World', actions: [
    { id: 'talk', label: 'Talk', scopes: ['world', 'element'], talk: true, delivers: 'an answer; told to, it edits names, descriptions, who is in the film, or a picture', lands: ['element'], hint: 'what to change, or ask it anything' },
  ] },
  // The shot itself: talk to it without an @ — it answers, and changes its own text and
  // references when told to.
  { id: 'shot', handle: 'Shot', name: 'Shot', job: 'talk to the shot', actions: [
    { id: 'talk', label: 'Talk', scopes: ['shot'], talk: true, delivers: 'an answer; told to, it rewrites its own text and references', lands: [], hint: 'what to change, or ask it anything' },
  ] },
  { id: 'editor', handle: 'Editor', name: 'Editor', job: 'the cut', actions: [
    { id: 'assemble', label: 'Assemble', scopes: ['cut'], delivers: 'the circled takes, in order, as one cut', lands: ['cut'] },
    { id: 'talk', label: 'Talk', scopes: ['cut'], talk: true, delivers: 'an answer; told to, it reorders or drops shots and assembles again', lands: ['cut'], hint: 'what to change, or ask it anything' },
  ] },
];

export const crewById = (id) => CREW.find((c) => c.id === id) || null;
export const actionOf = (agentId, actionId) => crewById(agentId)?.actions.find((a) => a.id === actionId) || null;

// Who works where the director stands (an element's job follows its kind). At most one @ job
// per agent per scope; talk jobs are reached by plain words, never by @.
export const actionsFor = (scope, element = null) => CREW.flatMap((c) => c.actions
  .filter((a) => !a.button && !a.talk && a.scopes.includes(scope?.type) && (!a.kinds || (element && a.kinds.includes(element.kind))))
  .map((a) => ({ agent: c, action: a })));

// WORDS WITHOUT AN @ go to what you stand on.
const TALKER = { brief: 'script', scene: 'script', shot: 'shot', world: 'cast', element: 'cast', cut: 'editor' };
export const talkerFor = (scope) => {
  const agent = crewById(TALKER[scope?.type]);
  const action = agent?.actions.find((a) => a.talk) || null;
  return agent && action ? { agent, action } : null;
};

// A NOTE ON A VERSION is an edit of that version, by the agent whose output it is: the request
// to send (the note's words ride as `text` for a talk job, as `note` for a job that re-makes).
export const editorFor = (s, ref, v, words) => {
  const from = { ref, vid: v.id };
  if (ref.at === 'brief') return { agent: 'script', action: 'talk', scope: { type: 'brief' }, text: words, from };
  if (ref.at === 'scene') return { agent: 'script', action: 'talk', scope: { type: 'scene', id: ref.sceneId }, text: words, from };
  if (ref.at === 'cut') return { agent: 'editor', action: 'talk', scope: { type: 'cut' }, text: words, from };
  if (ref.at === 'element') {
    const el = (s.elements || []).find((e) => e.id === ref.id);
    return { agent: el?.kind === 'character' ? 'casting' : 'designer', action: 'variation', scope: { type: 'element', id: ref.id }, text: '', note: words, from };
  }
  const scope = { type: 'shot', sceneId: ref.sceneId, id: ref.shotId };
  // A Canvas take's prompt speaks the card's [Image N]; Camera drafts the shot again with the note.
  if (v.by === 'board') return { agent: 'camera', action: 'draft', scope, text: words, force: true };
  // A Camera take (a final is its draft at full resolution): the note reworks that take's prompt.
  if (v.by === 'camera') return { agent: 'camera', action: 'draft', scope, text: '', note: words, from: { ref, vid: v.final ? v.parent : v.id }, force: true };
  // Footage and edits go to VFX — an edit is redone from its own source with both notes.
  return { agent: 'vfx', action: 'edit', scope, text: '', note: v.by === 'vfx' && v.note ? `${v.note}. ${words}` : words, from: { ref, vid: v.by === 'vfx' && v.parent ? v.parent : v.id } };
};

// "@Camera slower push-in" → { agent, action, text }. The job is the agent's job here; the
// words are the director's for this one request.
export const parseRequest = (raw, scope, element = null) => {
  const m = /^\s*@([A-Za-z0-9]+)\s*(.*)$/s.exec(String(raw || ''));
  if (!m) return { agent: null, action: null, text: String(raw || '').trim() };
  const agent = CREW.find((c) => c.handle.toLowerCase() === m[1].toLowerCase()) || null;
  if (!agent) return { agent: null, action: null, text: String(raw || '').trim(), unknown: m[1] };
  const action = actionsFor(scope, element).find((x) => x.agent.id === agent.id)?.action || null;
  return { agent, action, text: m[2].trim() };
};
