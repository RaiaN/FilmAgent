// Auto Director — orchestrator operations (L1 core). Pure: each takes typed input
// + ctx { client, config } and returns typed results. The canvas (and a future
// SDK) call these; only the injected `client` differs. These reason with the
// Seed 2.0 Pro VLM (ctx.client.reason) and parse tolerant JSON, modelled on
// parseBeats in operations.js. No canvas, no browser, no network here.

import { renderTemplate, getModel, getRuntime } from '../suiteConfig';

// Seed 2.0 Pro thinking depth for these (heavy) reasoning calls.
const effort = (config) => getRuntime(config).reasoningEffort;

// Tolerant JSON: strip code fences, try a direct parse, else grab the first
// balanced object/array. Returns null when nothing parses. (Exported — the
// core reads reuse it.)
export const parseJson = (text) => {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  if (!cleaned) return null;
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const m = cleaned.match(/[[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* */ } }
  return null;
};

// ---- intake: VLM classifies a pile of uploaded assets into bible roles ----------
// The front of the Concierge: "drop everything → I'll organize it." Reads each
// attached image + the idea, assigns one role per image (by index), and reports the
// REQUIRED roles that have no asset — what the agent then asks "do you have XYZ?".
// `roles` = the recipe's role vocabulary; `requiredRoles` = what it must have.
export const classifyAssets = async ({ images = [], idea = '', roles = [], requiredRoles = [], config } = {}, ctx) => {
  if (!images.length) return { assets: [], gaps: (requiredRoles || []).slice() };
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('concierge.classify.user', { idea: idea || '(none given)', roles: roles.join(', '), count: images.length }),
    systemPrompt: renderTemplate('concierge.classify.system', { roles: roles.join(', ') }),
    images,
    modelId: getModel('reasoner', config), reasoningEffort: effort(config),
  });
  const parsed = parseJson(content);
  const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.assets) ? parsed.assets : []);
  const allow = (r) => (roles.length ? roles.includes(r) : true);
  // One classification per input image, matched by index (tolerant: fall back to
  // positional, then to 'look' so an unclassifiable asset is still usable as a ref).
  const assets = images.map((_, i) => {
    const m = arr.find((a) => Number(a?.index) === i) || arr[i] || {};
    const role = allow(m?.role) ? m.role : (roles[0] || 'look');
    return {
      index: i,
      role,
      name: String(m?.name || role).slice(0, 60),
      confidence: typeof m?.confidence === 'number' ? Math.max(0, Math.min(1, m.confidence)) : null,
    };
  });
  const present = new Set(assets.map((a) => a.role));
  const gaps = (requiredRoles || []).filter((r) => !present.has(r));
  return { assets, gaps };
};

// Route ONE chat message to a studio action — the conversational front door.
// The LLM only INTERPRETS (which agent, with what params, said back in plain words);
// the user confirms with one tap and the dispatch itself is deterministic. Returns
// null on any failure (the chat asks the user to rephrase).
//
// ONE router for every studio chat (the film director AND the ad concierge): each
// dock passes its own action catalogue, and the model may also ANSWER a question
// directly ('answer' — the say field IS the answer, grounded in the context).
// What each action means lives here so the docks and the template never drift.
export const ACTION_DESCRIBE = {
  inspiration: 'generate fresh reference imagery from a description they give',
  characterVariations: 'variations of a person/character: wardrobe, expression, angle',
  locationVariations: 'coverage variations of a location/place: angle, time of day, weather',
  story: 'write/shape the STORY — pick this for ANY film premise, idea, concept or script the user gives. THE STORY IS THE FIRST THING WE MAKE FROM AN IDEA, before casting — so a fresh opening premise like "cowboys vs a grizzly" goes HERE. Produces an editable cinematic prompt the user turns into a SHOT card',
  storyboard: 'render a VISUAL STORYBOARD of the current story — one frame per shot, in sequence. Pick when they say storyboard / visualize / show me the shots / preview the story as frames (needs a story written).',
  detectGenre: 'read the film\'s genre & tone — pick ONLY when the user explicitly asks about genre/tone, or as the first move of Cast & World. NOT for an opening premise (that is `story`).',
  castDraft: 'generate the cast & location plates from the idea — Cast & World (now AFTER the story). Detects the genre first if none is set.',
  deconstruct: 'break a rendered TAKE into its cuts — key-frame stills + one SHOT card per cut. Pick when they say deconstruct / break down / split / detail this take (needs a Take selected on the board).',
  nextStep: 'they ask to continue or what to do next ("continue", "next", "what now", "go on") — advance the pipeline to its next concrete step',
  stitch: 'assemble the rendered shots into the final cut — pick when they say stitch / render / assemble the film',
  classify: 'sort the board\'s untagged images into roles — pick when they ask to tag / sort / organize what they have',
  action: 'shoot the laid-out SHOT cards — pick when they say action / roll / shoot the shots',
  answer: 'the message is a QUESTION or asks for filmmaking advice — answer it yourself, grounded in the studio context (stay in character as their film director; gently steer general/off-topic questions back to the film)',
  unknown: 'none of the above fit and it is not answerable',
};

export const FILM_ACTIONS = ['inspiration', 'characterVariations', 'locationVariations', 'story', 'storyboard', 'detectGenre', 'castDraft', 'deconstruct', 'nextStep', 'action', 'stitch', 'classify', 'answer', 'unknown'];

export const routeStudioAction = async ({ message = '', context = '', actions = FILM_ACTIONS, config } = {}, ctx) => {
  if (!String(message).trim()) return null;
  const catalogue = actions.map((a) => `"${a}" (${ACTION_DESCRIBE[a] || a})`).join(', ');
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('concierge.route.user', { context: context || '(empty project)', message }),
    systemPrompt: renderTemplate('concierge.route.system', { actions: catalogue }),
    // Routing, not creation — keep it snappy. ('answer' rides the same fast read:
    // the studio context is already in the prompt, so a grounded reply is cheap.)
    modelId: getModel('reasoner', config), reasoningEffort: 'low',
  });
  const j = parseJson(content);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const action = actions.includes(j.action) ? j.action : 'unknown';
  const s = (v, n = 300) => (v ? String(v).slice(0, n) : '');
  return {
    action,
    beat: s(j.beat),
    prompt: s(j.prompt),
    direction: s(j.direction),
    note: s(j.note),
    // For 'answer' the say IS the answer — give it room; proposals stay short.
    say: s(j.say, action === 'answer' ? 700 : 220),
  };
};

// Back-compat alias — the film dock's original entry point (defaults FILM_ACTIONS).
export const routeFilmAction = (args = {}, ctx) => routeStudioAction(args, ctx);

