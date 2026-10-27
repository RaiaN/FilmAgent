// THE CREW — every agent the director can @-address. One agent, one job: where you stand
// decides what the job is applied to (Casting casts the film from Cast & World and varies a
// character from that element). Footage sits where the crew's work sits: a clip is a shot's
// take, a photo a frame — VFX edits either, Camera starts a shot from either.
// A request: @Agent [words] at a scope. Paid work (images, video) goes through a call sheet.
// Final is a button on a draft (Review) or a scene, not an @ request: it renders the same
// picture at 1080p MOV, so there is nothing to ask for.

export const CREW = [
  { id: 'writers', handle: 'Writers', name: 'Writers', job: 'develop the idea into a script', actions: [
    { id: 'develop', label: 'Develop', scopes: ['brief'], hint: 'the idea, in your words' },
  ] },
  { id: 'ad', handle: 'AD', name: '1st AD', job: 'block the film scene by scene', actions: [
    { id: 'breakdown', label: 'Block', scopes: ['brief'], hint: 'what to favour' },
    // The plan's Go: the script breakdown.
    { id: 'plan', label: 'Break down the script', scopes: ['brief'], button: true },
  ] },
  { id: 'casting', handle: 'Casting', name: 'Casting', job: 'faces', actions: [
    { id: 'cast', label: 'Cast the film', scopes: ['world'], paid: true, hint: 'anything about the cast' },
    { id: 'variation', label: 'Recast', scopes: ['element'], kinds: ['character'], paid: true, hint: 'older, weathered…' },
  ] },
  { id: 'designer', handle: 'Designer', name: 'Designer', job: 'places and props', actions: [
    { id: 'variation', label: 'Redesign', scopes: ['element'], kinds: ['location', 'prop'], paid: true, hint: 'at night, rain…' },
    { id: 'views', label: 'Views', scopes: ['scene', 'shot'], paid: true, hint: 'anything about the views' },
  ] },
  { id: 'camera', handle: 'Camera', name: 'Camera', job: 'takes', actions: [
    { id: 'draft', label: 'Draft', scopes: ['scene', 'shot'], paid: true, hint: 'anything for the take' },
    { id: 'final', label: 'Final', scopes: ['scene', 'shot'], paid: true, button: true },
  ] },
  { id: 'vfx', handle: 'VFX', name: 'VFX', job: 'edit a take', actions: [
    { id: 'edit', label: 'Edit', scopes: ['shot'], paid: true, hint: 'what changes — the rest stays' },
  ] },
  // The shot itself: talk to it without an @ — it answers, and changes its own text and
  // references when told to.
  { id: 'shot', handle: 'Shot', name: 'Shot', job: 'talk to the shot', actions: [
    { id: 'talk', label: 'Talk', scopes: ['shot'], hint: 'what to change, or ask it anything' },
  ] },
  { id: 'editor', handle: 'Editor', name: 'Editor', job: 'assemble the cut', actions: [
    { id: 'assemble', label: 'Assemble', scopes: ['cut'] },
  ] },
];

export const crewById = (id) => CREW.find((c) => c.id === id) || null;
export const actionOf = (agentId, actionId) => crewById(agentId)?.actions.find((a) => a.id === actionId) || null;

// Who works where the director stands (an element's job follows its kind). At most one @ job
// per agent per scope.
export const actionsFor = (scope, element = null) => CREW.flatMap((c) => c.actions
  .filter((a) => !a.button && a.scopes.includes(scope?.type) && (!a.kinds || (element && a.kinds.includes(element.kind))))
  .map((a) => ({ agent: c, action: a })));

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
