// Auto Director — reasoning operations (L1 core). Pure: each takes typed input
// + ctx { client, config } and returns typed results; only the injected `client`
// differs per caller. These reason with the Seed 2.0 Pro VLM (ctx.client.reason)
// and parse tolerant JSON. No canvas, no browser, no network here.

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
  // positional, then to 'prop' so an unclassifiable asset is still usable as a ref).
  const assets = images.map((_, i) => {
    const m = arr.find((a) => Number(a?.index) === i) || arr[i] || {};
    const role = allow(m?.role) ? m.role : (roles[0] || 'prop');
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
