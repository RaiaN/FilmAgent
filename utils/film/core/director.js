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
// Topic Explorer reuses it.)
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

// Read the AD INTENT from the user's one-line idea: what KIND of ad (product /
// service / brand-story), who/what the HERO is, suggested talent/location, and
// whether a brand identity even belongs. The Concierge confirms this with the user
// in one bubble, then the interview + gap prompts adapt to it — so a cause/place
// spot is never forced through "do you have a Product?". Returns null on any
// failure (callers fall back to the plain product-ad interview).
export const readAdIntent = async ({ idea = '', config } = {}, ctx) => {
  if (!String(idea).trim()) return null;
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('concierge.intent.user', { idea }),
    systemPrompt: renderTemplate('concierge.intent.system'),
    // Classification, not creation — keep it snappy.
    modelId: getModel('reasoner', config), reasoningEffort: 'low',
  });
  const j = parseJson(content);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  // Garbage gate: when the model judges the text isn't a readable brief, surface
  // its clarifying question instead of a confirmable (and meaningless) intent.
  if (j.valid === false) {
    return { valid: false, clarify: String(j.clarify || '').slice(0, 220) };
  }
  const kind = ['product', 'service', 'brand-story'].includes(j.kind) ? j.kind : 'product';
  return {
    valid: true,
    kind,
    brandRelevant: j.brandRelevant !== false,
    // Keyed by BIBLE ROLE (the hero lives under the 'product' role id) so the
    // interview and gap generation can look subjects up directly.
    subjects: {
      product: String(j.hero || '').slice(0, 120),
      talent: j.talent ? String(j.talent).slice(0, 120) : '',
      location: j.location ? String(j.location).slice(0, 120) : '',
    },
    summary: String(j.summary || '').slice(0, 220),
  };
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
  filmChunk: 'shoot the next 10–15s video chunk — pick this when the message describes story action to film',
  correctChunk: 're-render the current draft take — pick when they critique what was just shot',
  approveChunk: 'they accept the current take',
  proposeBeats: 'they ask what could happen next in the story',
  inspiration: 'generate fresh reference imagery from a description they give',
  characterVariations: 'variations of a person/character: wardrobe, expression, angle',
  locationVariations: 'coverage variations of a location/place: angle, time of day, weather',
  mixMatch: 'compose a character into locations — story moments of what might happen to them there',
  exploreTopic: 'research a topic before production — fills the board with its key concepts as candidate images',
  storyboard: 'break the film into 5–15s shots — one SHOT card per shot (what happens, the camera template, duration) with a photoreal frame placing the cast in the location',
  detectGenre: 'the message is a fresh film PREMISE/idea and no genre is locked yet — read its genre & tone first (the user confirms, then casting runs in that genre). Pick this for an opening idea like "cowboys vs a grizzly" when idea is NOT set',
  castDraft: 'generate the cast & location plates from the idea — pick ONLY when a genre is already set/confirmed (otherwise detectGenre comes first)',
  nextStep: 'they ask to continue or what to do next ("continue", "next", "what now", "go on") — advance the pipeline to its next concrete step',
  stitch: 'assemble the rendered shots into the final cut — pick when they say stitch / render / assemble the film',
  classify: 'sort the board\'s untagged images into roles — pick when they ask to tag / sort / organize what they have',
  makeAd: 'lay the ad\'s CUT cards out for review — pick when they say make the ad / build it / plan the shots',
  action: 'shoot the laid-out CUT cards — pick when they say action / roll / shoot the cuts',
  relayCuts: 're-lay the CUT cards from scratch',
  answer: 'the message is a QUESTION or asks for advice — answer it yourself from the studio context',
  unknown: 'none of the above fit and it is not answerable',
};

export const FILM_ACTIONS = ['filmChunk', 'correctChunk', 'approveChunk', 'proposeBeats', 'inspiration', 'characterVariations', 'locationVariations', 'mixMatch', 'exploreTopic', 'storyboard', 'detectGenre', 'castDraft', 'nextStep', 'action', 'stitch', 'classify', 'answer', 'unknown'];
export const AD_ACTIONS = ['inspiration', 'characterVariations', 'locationVariations', 'mixMatch', 'exploreTopic', 'classify', 'makeAd', 'action', 'relayCuts', 'answer', 'unknown'];

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

// ---- QC: VLM reviews a step's outputs vs intent + references --------------------

export const qcStep = async ({ agent = '', intent = '', references = [], outputs = [], video, config } = {}, ctx) => {
  const images = [...references, ...outputs];
  let content;
  try {
    ({ content } = await ctx.client.reason({
      prompt: renderTemplate('autoDirector.qc.user', { agent, intent, refCount: references.length }),
      systemPrompt: renderTemplate('autoDirector.qc.system'),
      images,
      video,
      modelId: getModel('reasoner', config), reasoningEffort: effort(config),
    }));
  } catch (err) {
    // QC is advisory — never block the human on a QC failure.
    return { verdict: 'pass', issues: [], best: 0, error: err.message };
  }
  const r = parseJson(content) || {};
  const verdict = ['pass', 'warn', 'fail'].includes(r.verdict) ? r.verdict : 'pass';
  const issues = Array.isArray(r.issues)
    ? r.issues.map((it) => ({
        severity: ['low', 'medium', 'high'].includes(it?.severity) ? it.severity : 'medium',
        message: String(it?.message || '').slice(0, 300),
        suggestion: String(it?.suggestion || '').slice(0, 300),
      })).filter((it) => it.message)
    : [];
  const outCount = Math.max(outputs.length, 1);
  const best = Number.isInteger(r.best) && r.best >= 0 && r.best < outCount ? r.best : 0;
  return { verdict, issues, best };
};

