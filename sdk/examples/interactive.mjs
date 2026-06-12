// Drive an INTERACTIVE production step by step from the CLI — the same engine the
// canvas uses, headless. A real client would render each step's outputs and let a
// human pick / regenerate / approve; here we accept the QC pick and approve, to
// prove the stepwise API end to end.
//
//   MODELARK_API_KEY=…  MODELARK_API_BASE_URL=https://…  \
//     node examples/interactive.mjs "a desert town wakes at dawn" --minutes 1
//
// Build the SDK first: `npm run build`.

import { createProduction } from '../dist/index.js';

const argv = process.argv.slice(2);
let minutes = 1;
const ideaParts = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--minutes' || argv[i] === '-m') { minutes = Number(argv[i + 1]) || minutes; i += 1; }
  else ideaParts.push(argv[i]);
}
const idea = ideaParts.join(' ').trim();

if (!idea) {
  console.error('usage: node examples/interactive.mjs "<idea>" [--minutes N]');
  process.exit(1);
}
if (!(process.env.MODELARK_API_KEY || process.env.ARK_API_KEY) || !process.env.MODELARK_API_BASE_URL) {
  console.error('Set MODELARK_API_KEY and MODELARK_API_BASE_URL first (these are real, paid calls).');
  process.exit(1);
}

const production = createProduction({ idea, targetMinutes: minutes }, {
  mode: 'review',          // pause at every step (interactive)
  onEvent: (e) => {
    if (e.type === 'warning') console.warn(`⚠ ${e.message}`);
    if (e.type === 'film') console.log(`\n🎬 final cut: ${e.path || e.url}`);
  },
});

// A UI would render on the `state` event; we just await the autonomous tail (the
// auto-stitch that fires after the final approval) via the 'done' phase.
const finished = new Promise((resolve) => {
  const off = production.on((e) => { if (e.type === 'phase' && e.phase === 'done') { off(); resolve(); } });
});

console.log(`Producing (interactive): "${idea}"  (~${minutes} min)\n`);

await production.plan();
const plan = production.state.plan;
console.log(`Plan — ${plan.length} steps: ${plan.map((s) => s.agent).join(' → ')}\n`);

production.start();
for (let i = 0; i < plan.length; i += 1) {
  const step = production.state.plan[i];
  if (step.status === 'approved' || step.status === 'skipped') continue;

  const ran = await production.runStep(step.id);          // → outputs, paused at 'review'
  if (ran.status === 'failed') { console.warn(`  step ${i + 1} ${ran.agent}: FAILED — ${ran.error}`); continue; }
  if (ran.status === 'skipped') { console.log(`  step ${i + 1} ${ran.agent}: skipped`); continue; }

  // A human would choose here; we accept the QC-picked output.
  console.log(`  step ${i + 1} ${ran.agent}: ${ran.outputs.length} output(s) → picked ${ran.pickedId}`);
  // e.g. production.pick(ran.id, otherOutputId)  /  production.regenerate(ran.id)
  production.approve(ran.id);                              // advance (auto-stitches after the last)
}

await finished;
const result = production.result();
console.log(`\nshots: ${result.shots.length}   film: ${result.film?.path || result.film?.url || '(not stitched)'}`);
