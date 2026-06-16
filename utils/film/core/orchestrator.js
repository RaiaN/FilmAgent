// The autonomous entry point — the PIPELINE, headless. Nothing invents a shot
// list outside the storyboard. A headless run walks the same stages the UI does,
// with the human gates auto-passed (that's what "headless" means — fine for
// examples/smoke tests; real productions go through the canvas where every gate
// is yours):
//
//   casting     input.bible (the caller's REAL assets) — or castFromIdea generates
//               the minimum anchors ONCE (then every shot references them)
//   storyboard  readStoryboard: idea + anchors → 10–15s shots (no sketches —
//               sketches exist for human review, and there's no human here)
//   filming     direct-to-video: each shot's REAL refs + composed text → Seedance
//   final cut   stitch, in storyboard order
//
// One engine (createProduction, blueprint-only), two callers: autonomous here,
// interactive in the canvas.

import { createProduction, runStep } from './production';
import { readStoryboard, castFromIdea, panelToShot } from './storyboard';

export { runStep };

/**
 * Run a full film headless, end to end, through the pipeline.
 * @param {{ idea?: string, genre?: string, bible?: Array, targetSeconds?: number, targetMinutes?: number }} input
 * @param {{ client: object, stitch?: Function }} transport
 * @param {{ config?, perStepCount?, qc?, stitch?, outPath?, onEvent?, signal? }} [opts]
 * @returns {Promise<{ bible, panels, plan, shots, assets, film? }>}
 */
export const runProduction = async (input = {}, transport = {}, opts = {}) => {
  // Headless callers want the granular lifecycle events, not the per-mutation
  // `state` snapshots (those are for interactive UIs) — filter them out here so the
  // Service API run trace stays lean.
  const emit = opts.onEvent ? (e) => { if (e.type !== 'state') opts.onEvent(e); } : () => {};
  const ctx = { client: transport.client, config: opts.config };
  const targetSeconds = Math.round(
    input.targetSeconds != null ? input.targetSeconds
      : (input.targetMinutes != null ? input.targetMinutes * 60 : 60),
  );

  // 1. Casting: the caller's real anchors win; otherwise generate the minimum once.
  let bible = (input.bible || []).filter((e) => e && e.url);
  if (!bible.length) {
    emit({ type: 'phase', phase: 'casting' });
    bible = await castFromIdea({ idea: input.idea, config: opts.config }, ctx);
    bible.forEach((e) => emit({ type: 'asset', kind: 'image', url: e.url, role: e.role, name: e.name }));
  }

  // 2. Storyboard: the explicit shot plan (the ONLY thing allowed to plan shots).
  emit({ type: 'phase', phase: 'storyboard' });
  const { anchors, panels } = await readStoryboard({ idea: input.idea, genre: input.genre, targetSeconds, bible, config: opts.config }, ctx);
  emit({ type: 'plan', plan: panels.map((p) => ({ id: `panel-${p.index}`, agent: 'animate', title: p.title, intent: p.action })) });

  // 3 + 4. Shoot direct-to-video and stitch, via the blueprint engine. panelToShot
  // composes the SAME Seedance 2.0 prompt the canvas cards send (refs from the real
  // anchors, genre-keyed cinematography) — one format across both callers.
  // Default to 1 output/step headless (cost); callers can override via opts.
  const session = createProduction(
    { idea: input.idea, targetSeconds, bible, blueprint: { shots: panels.map((p) => panelToShot(p, anchors, input.genre)) } },
    transport,
    { perStepCount: 1, ...opts, mode: 'auto', onEvent: opts.onEvent ? emit : undefined },
  );
  const result = await session.runAll();
  return { bible, panels, ...result };
};
