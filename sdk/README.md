# @modelark/film

Plug‑and‑play SDK for the ModelArk **agentic film suite**. Two layers:

- **Single agents** — `inspiration`, `characterVariations`, `locationVariations`,
  `mixMatch`, `animate`, `promptMuse`, `storyBeats`. Each submits an async run to
  the Service API and resolves with finished results (streaming events optional).
- **Full production** — `produce()` runs the *entire* Auto Director loop in‑process
  (`idea → understand → plan → generate shots → QC → stitch`) directly against
  ModelArk via an injected transport. **No Service API, no UI, no canvas** — the
  orchestration that used to live in the app is now in the SDK.

## Install

```bash
npm install @modelark/film
```

### Build from source

```bash
cd sdk && npm install && npm run build   # bundles the suite into dist/ (self-contained)
```

`build` also emits `.d.ts`. If declaration bundling ever trips over the bundled JS
core on your toolchain, `npm run build:js` produces the working JS bundle without
types.

## Quickstart

```ts
import { FilmSuite } from '@modelark/film';

const film = new FilmSuite({
  apiKey: process.env.MODELARK_API_KEY!,
  baseUrl: 'https://your-film-service-host', // where the Service API runs
});

// One-shot agents → arrays of assets
const refs   = await film.inspiration({ prompt: 'cold-war arctic outpost, 16mm, desaturated teal', count: 6 });
const vars   = await film.characterVariations({ imageUrl: refs[0].url, axis: 'wardrobe', count: 4 });
const combo  = await film.mixMatch({ imageUrls: [vars[0].url, refs[2].url], direction: 'she stands at the console, dawn light' });

// Long-running video — await the result, or watch progress events (poll-fed)
const [shot] = await film.animate(
  { imageUrl: combo[0].url, motion: 'slow push-in', camera: 'dolly in', focalLength: '35mm' },
  { onEvent: (e) => console.log(e.type) },   // queued → running → video.queued → asset → succeeded
);
console.log(shot.url); // mp4
// Prefer push? Pass { webhookUrl } and your endpoint gets the final run on completion.

// Reasoning agents
const muse  = await film.promptMuse({ images: [refs[0].url], question: 'how is the lighting done?' });
const beats = await film.storyBeats({ idea: 'a radio operator hears her own voice', steps: ['She keys the mic'] });
```

## Produce a whole film (headless)

`produce()` is the built‑in harness — hand it an idea, get a plan, shots, and a
stitched final cut. It talks to ModelArk **directly**, so you don't need the
Service API running.

```ts
import { produce } from '@modelark/film';

const result = await produce(
  { idea: 'a lonely lighthouse keeper befriends a stranded whale', targetMinutes: 1 },
  {
    // apiKey / baseUrl default to env MODELARK_API_KEY / MODELARK_API_BASE_URL
    onEvent: (e) => console.log(e.type, e),  // phase | plan | step | asset | film | warning
  },
);

console.log(result.brief.logline);
console.log(result.plan.length, 'steps');
console.log(result.shots.length, 'shots');
console.log(result.film?.path);            // the stitched .mp4 (when ffmpeg is available)
```

**Environment:** set `MODELARK_API_KEY` and `MODELARK_API_BASE_URL` (the ModelArk
endpoint), or pass `{ apiKey, baseUrl }` in options.

**Stitching** uses `ffmpeg`. The SDK looks for the optional `ffmpeg-static` binary,
then falls back to `ffmpeg` on `PATH`. If neither is present, `produce()` still
returns the ordered `shots`; it just won't produce `result.film`. Override with
`{ stitch }` (e.g. point at your own service) or disable with `{ stitch: false }`.

> Node ≥ 18 only — `produce()` shells out to ffmpeg. The single‑agent HTTP methods
> work in the browser too.

### Interactive / step-by-step (build your own UI)

`produce()` is the autonomous shortcut. For a human‑in‑the‑loop experience — review
each step, pick an output, regenerate or skip, then advance — open a **production
session**. It's the same engine our canvas runs on, exposed for your UI.

```ts
import { createProduction } from '@modelark/film';

const p = createProduction({ idea: 'a desert town wakes at dawn', targetMinutes: 1 });

await p.plan();            // understand + build the plan → p.state.plan
p.start();

for (const step of p.state.plan) {
  const ran = await p.runStep(step.id);   // generate this step's output(s); pauses at 'review'
  // your UI renders ran.outputs and lets the user decide:
  // p.pick(ran.id, outputId)  ·  p.regenerate(ran.id)  ·  p.skip(ran.id)
  p.approve(ran.id);                      // advance (auto-stitches after the last step)
}

p.on((e) => {/* 'state' carries a full snapshot for re-render; also phase|step|asset|film */});
const { shots, film } = p.result();
```

Plan editing (`editStep` / `addStep` / `removeStep` / `moveStep` / `toggleGate`),
`setMode('auto')` + `resume()` (auto-run, pausing only at gated steps), and `runAll()`
(fully autonomous — what `produce()` calls) are all on the session. There's also a
low-level `runStep({ agent, params, inputUrls }, ctx)` primitive if you want to
compose agents with no session at all. See [`examples/interactive.mjs`](examples/interactive.mjs).

### Or run it on the Service API (thin clients)

Don't want to run the loop in your process? The same orchestration is exposed as an
`autoDirector` agent on the Service API — your client just submits a run and polls.
The server does the heavy lifting and stitches to hosted (TOS) video.

```ts
const film = new FilmSuite({ apiKey, baseUrl: 'https://your-film-service-host' });

const result = await film.autoDirector(
  { idea: 'a desert town wakes at dawn', targetMinutes: 1 },
  { onEvent: (e) => console.log(e.type) },     // queued → running → asset… → succeeded
);
// result: { brief, plan, shots, assets, film? }  (film.url is a hosted mp4)
```

`produce()` (in‑process, direct to ModelArk) and `film.autoDirector()` (Service API)
run the **same** loop — pick based on where you want the compute and the ffmpeg.

### Headless tests

The three reference productions live in [`test/produce.e2e.mjs`](test/produce.e2e.mjs)
(cartoon, a Saudi‑Arabia cinematic trailer, a Saudi‑Arabia advertisement). They make
real, paid calls, so they skip unless the env vars are set:

```bash
MODELARK_API_KEY=…  MODELARK_API_BASE_URL=https://…  npm test
# or a single one-off:
MODELARK_API_KEY=…  MODELARK_API_BASE_URL=https://…  node examples/produce.mjs "your idea" --minutes 1
```

## Build your own loop (custom control)

Prefer to drive the loop yourself (your UI / your gating)? The agents are stateless,
so *your* harness can compose them — this is exactly what `produce()` does internally:

```ts
let steps: string[] = [];
let lastImageUrl: string | undefined;

for (let i = 0; i < 8; i++) {
  const beats = await film.storyBeats({ idea, steps, lastImageUrl });
  const chosen = pickBeat(beats);                 // your logic / your UI / your agent
  const [frame] = await film.inspiration({ prompt: chosen.prompt, refs: lastImageUrl ? [lastImageUrl] : [] });
  steps.push(chosen.title);
  lastImageUrl = frame.url;
}
```

## Config overrides (root settings)

Override the suite's models / prompts / defaults globally or per call:

```ts
const film = new FilmSuite({
  apiKey, baseUrl,
  config: { models: { seedream: 'ep-your-endpoint' }, prompts: { 'storyDirector.system': '…house style…' } },
});

await film.inspiration({ prompt }, { config: { defaults: { inspiration: { count: 12 } } } });
```

## API

`new FilmSuite({ apiKey, baseUrl, config?, fetch? })`

| Method | Returns |
|---|---|
| `inspiration(input, opts?)` | `ImageAsset[]` |
| `characterVariations(input, opts?)` | `ImageAsset[]` |
| `locationVariations(input, opts?)` | `ImageAsset[]` |
| `mixMatch(input, opts?)` | `ImageAsset[]` |
| `animate(input, opts?)` | `VideoAsset[]` |
| `promptMuse(input, opts?)` | `TextAsset[]` |
| `storyBeats(input, opts?)` | `Beat[]` |
| `autoDirector(input, opts?)` | `ProduceResult` (full film, via Service API) |
| `run(agent, input, opts?)` | generic |
| `getRun(id)` | `Run` |

`opts`: `{ config?, webhookUrl?, onEvent?, signal?, pollIntervalMs? }`.
Pass `webhookUrl` to receive the final run via POST instead of waiting. `onEvent`
surfaces the run's lifecycle/trace events (delivered by polling — no streaming
connection to keep open).

### Full production

- `produce(input, opts?) → Promise<ProduceResult>` (also `FilmSuite#produce`) — autonomous.
- `createProduction(input, opts?) → Production` (also `FilmSuite#createProduction`) — interactive session.
- `runStep({ agent, params, inputUrls, count?, intent?, config? }, ctx) → outputs[]` — the low-level step primitive.

Shared shapes: `input` = `{ idea, sources?, targetMinutes? }`; `opts` = `{ apiKey?, baseUrl?, config?, explore?, qc?, perStepCount?, stitch?, outPath?, onEvent? }` (plus `mode?` for `createProduction`); `ProduceResult` = `{ brief, plan, shots, assets, film? }`. The `Production` session exposes `understand/plan/start/runStep/pick/approve/regenerate/skip/editStep/addStep/removeStep/moveStep/toggleGate/setMode/resume/stitch/runAll/result` + `on()` and `state`.

Single‑agent methods require Node ≥ 18 (global `fetch`) or a modern browser.
`produce()` / `createProduction()` are **Node‑oriented** (stitching shells out to ffmpeg; pass your own `stitch` to run elsewhere).
