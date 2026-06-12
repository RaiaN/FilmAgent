// One-off headless film from the command line.
//
//   MODELARK_API_KEY=…  MODELARK_API_BASE_URL=https://…  \
//     node examples/produce.mjs "a lonely lighthouse keeper and a stranded whale" --minutes 1
//
// Build the SDK first: `npm run build`.

import { produce } from '../dist/index.js';

const argv = process.argv.slice(2);
let minutes = 1;
const ideaParts = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--minutes' || argv[i] === '-m') { minutes = Number(argv[i + 1]) || minutes; i += 1; }
  else ideaParts.push(argv[i]);
}
const idea = ideaParts.join(' ').trim();

if (!idea) {
  console.error('usage: node examples/produce.mjs "<idea>" [--minutes N]');
  process.exit(1);
}
if (!(process.env.MODELARK_API_KEY || process.env.ARK_API_KEY) || !process.env.MODELARK_API_BASE_URL) {
  console.error('Set MODELARK_API_KEY and MODELARK_API_BASE_URL first (these are real, paid calls).');
  process.exit(1);
}

console.log(`Producing: "${idea}"  (~${minutes} min)\n`);

const result = await produce({ idea, targetMinutes: minutes }, {
  perStepCount: 1,
  onEvent: (e) => {
    if (e.type === 'phase') console.log(`• phase: ${e.phase}`);
    else if (e.type === 'plan') console.log(`• plan: ${e.plan.length} steps — ${e.plan.map((s) => s.agent).join(' → ')}`);
    else if (e.type === 'step' && e.status !== 'running') console.log(`  - step ${e.index + 1}/${e.total} ${e.agent}: ${e.status}${e.message ? ` (${e.message})` : ''}`);
    else if (e.type === 'asset') console.log(`    ↳ ${e.kind}: ${e.url}`);
    else if (e.type === 'film') console.log(`• FILM: ${e.path || e.url}`);
    else if (e.type === 'warning') console.warn(`⚠ ${e.message}`);
  },
});

console.log('\n=== Result ===');
console.log('logline:', result.brief.logline);
console.log('plan:   ', result.plan.map((s) => `${s.agent}:${s.title}`).join(' | '));
console.log('shots:  ', result.shots.length);
if (result.film) console.log('film:   ', result.film.path || result.film.url);
else console.log('film:    (not stitched — install ffmpeg or ffmpeg-static)');
