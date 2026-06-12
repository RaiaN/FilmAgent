// Topic Explorer — recursive creative exploration BEFORE production. The user
// doesn't know the right taxonomy for their topic; DISCOVERING it is this agent's
// job. Given a raw topic ("Saudi desert and its wildlife", "running-trainers ad"),
// it answers two questions with assets, not just text: "what makes a video in this
// topic GOOD?" and "what assets does such a video need?".
//
// Shape of the loop (shallow → deep, budget-bounded):
//   read(topic)              1 reason call → craft brief + the topic's UNIQUE key
//                            concepts, each with 2–4 concrete image ideas
//   breadth-first waves      generate ONE idea per concept per pass (round-robin),
//                            so shallow coverage lands across ALL concepts before
//                            any one goes deep; parallel via the shared pool+retry
//   deepen(concept)          when shallow ideas are exhausted and budget remains
//                            (depth ≥ 2): 1 reason call per concept surfaces its
//                            less-obvious layer → more ideas → more waves
//
// Everything generated is a CANDIDATE, never canon: each image carries a SUGGESTED
// bible role the user confirms by tagging (consistency rule: exploration feeds the
// board; only tagged assets reach production). Pure core — canvas/SDK inject ctx.

import { renderTemplate, getModel, getRuntime } from '../suiteConfig';
import { parseJson } from './director';
import { withRetry } from './retry';
import { runWithConcurrency } from './parallel';

const MAX_BUDGET = 24;
// 3 concepts, not 5: with the default budget of 12 each frame actually FILLS
// (4 images per concept) instead of littering the board with half-empty panels.
const MAX_CONCEPTS = 3;
const IDEAS_PER_CONCEPT = 4;

export const exploreTopic = async ({ topic, budget = 12, depth = 2, roles = [], config } = {}, ctx, hooks = {}) => {
  const t = String(topic || '').trim();
  if (!t) throw new Error('Topic Explorer needs a topic — what should I research?');
  const h = {
    onCraft: hooks.onCraft || (() => {}),
    onConcept: hooks.onConcept || (() => {}),
    onImage: hooks.onImage || (() => {}),
    onError: hooks.onError || (() => {}),
  };
  const roleList = (roles || []).join(', ');

  // ---- level 0: read the topic (craft + LLM-discovered concepts) -------------
  const { content } = await ctx.client.reason({
    prompt: renderTemplate('topicExplorer.read.user', { topic: t }),
    systemPrompt: renderTemplate('topicExplorer.read.system', { maxConcepts: MAX_CONCEPTS, roles: roleList }),
    modelId: getModel('reasoner', config),
    reasoningEffort: getRuntime(config).reasoningEffort,
  });
  const root = parseJson(content);
  if (!root || !Array.isArray(root.concepts) || !root.concepts.length) {
    throw new Error('The topic read returned no concepts — try rephrasing the topic.');
  }

  const sanitizeIdeas = (arr) => (Array.isArray(arr) ? arr : [])
    .map((i) => ({
      prompt: String(i?.prompt || '').trim(),
      label: String(i?.label || i?.prompt || '').slice(0, 48),
      role: (roles || []).includes(i?.role) ? i.role : null,
    }))
    .filter((i) => i.prompt)
    .slice(0, IDEAS_PER_CONCEPT);

  const craft = String(root.craft || '').trim();
  if (craft) h.onCraft(craft);

  const concepts = root.concepts.slice(0, MAX_CONCEPTS).map((c, idx) => ({
    id: `c${idx}`,
    title: String(c?.title || `Concept ${idx + 1}`).slice(0, 60),
    why: String(c?.why || '').slice(0, 240),
    ideas: sanitizeIdeas(c?.ideas),
    deepened: false,
  }));
  concepts.forEach((c) => h.onConcept(c));

  // ---- breadth-first generation waves + the deepen recursion -----------------
  let remaining = Math.max(1, Math.min(MAX_BUDGET, Number(budget) || 12));
  let imagesMade = 0;

  const generateIdea = (concept, idea) => async () => {
    try {
      const out = await withRetry(
        () => ctx.client.generateImage({ prompt: idea.prompt, size: '2K', model: getModel('seedream', config) }),
        { tries: 3, baseMs: 2500 },
      );
      imagesMade += 1;
      h.onImage({ conceptId: concept.id, url: out.url, prompt: idea.prompt, label: idea.label, role: idea.role });
    } catch (err) {
      h.onError(`${concept.title} · ${idea.label}: ${err.message}`);
    }
  };

  for (;;) {
    // One wave = at most one idea from EACH concept (round-robin → breadth-first).
    const wave = [];
    for (const c of concepts) {
      if (remaining <= 0) break;
      const idea = c.ideas.shift();
      if (!idea) continue; // eslint-disable-line no-continue
      wave.push(generateIdea(c, idea));
      remaining -= 1;
    }
    if (wave.length) {
      await runWithConcurrency(wave, 3); // eslint-disable-line no-await-in-loop
      continue; // eslint-disable-line no-continue
    }
    // Shallow ideas exhausted. Budget left + depth allows → recurse one level:
    // ask for each concept's less-obvious layer, then keep generating.
    if (remaining <= 0 || depth < 2) break;
    const toDeepen = concepts.filter((c) => !c.deepened);
    if (!toDeepen.length) break;
    for (const c of toDeepen) {
      c.deepened = true;
      try {
        const { content: deeper } = await ctx.client.reason({ // eslint-disable-line no-await-in-loop
          prompt: renderTemplate('topicExplorer.deepen.user', { topic: t, concept: c.title, why: c.why }),
          systemPrompt: renderTemplate('topicExplorer.deepen.system', { roles: roleList }),
          modelId: getModel('reasoner', config),
          reasoningEffort: 'low', // expansion, not strategy — keep it snappy
        });
        const dj = parseJson(deeper);
        c.ideas.push(...sanitizeIdeas(dj?.ideas || dj));
      } catch (err) {
        h.onError(`Couldn't deepen "${c.title}": ${err.message}`);
      }
    }
    if (concepts.every((c) => !c.ideas.length)) break; // deepening yielded nothing
  }

  return {
    craft,
    concepts: concepts.map(({ id, title, why }) => ({ id, title, why })),
    images: imagesMade,
  };
};
