// Auto Director — the autonomous entry point. The actual orchestration lives in the
// interactive session (./production); runProduction is just the "drive it to the end
// with no human in the loop" wrapper that produce() and the Service API use. One
// engine, two callers (autonomous here, interactive in the canvas / via the session).

import { createProduction, runStep } from './production';

export { runStep };

/**
 * Run a full production headless, end to end.
 * @param {{ idea?: string, sources?: string[], targetMinutes?: number }} input
 * @param {{ client: object, stitch?: Function }} transport
 * @param {{ config?, perStepCount?, qc?, stitch?, outPath?, onEvent?, signal? }} [opts]
 * @returns {Promise<{ brief, plan, shots, assets, film? }>}
 */
export const runProduction = (input, transport, opts = {}) => {
  // Headless callers want the granular lifecycle events, not the per-mutation
  // `state` snapshots (those are for interactive UIs) — filter them out here so the
  // Service API run trace stays lean.
  const onEvent = opts.onEvent ? (e) => { if (e.type !== 'state') opts.onEvent(e); } : undefined;
  // Default to 1 output/step headless (cost); callers can override via opts.
  return createProduction(input, transport, { perStepCount: 1, ...opts, mode: 'auto', onEvent }).runAll();
};
