# @modelark/film

Plug‑and‑play SDK for the ModelArk **agentic film suite**. Two layers:

- **Single agents** — `inspiration`, `characterVariations`, `locationVariations`,
  `mixMatch`, `animate`, `promptMuse`, `storyBeats`. Each submits an async run to
  the Service API and resolves with finished results (streaming events optional).
- **Full production** — `produce()` runs the *entire* pipeline in‑process
  (`cast → storyboard → direct‑to‑video shots → QC → stitch`) directly against
  ModelArk via an injected transport. **No Service API, no UI, no canvas** — the
  orchestration that used to live in the app is now in the SDK. Nothing invents a
  shot list outside the storyboard; the engine is **blueprint‑only**.

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

`produce()` is the built‑in harness — hand it an idea, and it walks the pipeline:
casting (your real `bible`, or the minimum anchors generated once) → storyboard →
direct‑to‑video shots → stitched final cut. It talks to ModelArk **directly**, so
you don't need the Service API running.

```ts
import { produce } from '@modelark/film';

const result = await produce(
  { idea: 'a lonely lighthouse keeper befriends a stranded whale', targetMinutes: 1 },
  {
    // apiKey / baseUrl default to env MODELARK_API_KEY / MODELARK_API_BASE_URL
    onEvent: (e) => console.log(e.type, e),  // phase | plan | step | asset | film | warning
  },
);

console.log(result.bible.length, 'anchors'); // the cast/locations it generated (or yours)
console.log(result.panels.length, 'shots');  // the storyboard plan
console.log(result.shots.length, 'rendered'); // the animated clips
console.log(result.film?.path);              // the stitched .mp4 (when ffmpeg is available)
```

`produce()` resolves with a `PipelineResult`: `{ bible, panels, plan, shots, assets, film? }`.

**Environment:** set `MODELARK_API_KEY` and `MODELARK_API_BASE_URL` (the ModelArk
endpoint), or pass `{ apiKey, baseUrl }` in options.

**Stitching** uses `ffmpeg`. The SDK looks for the optional `ffmpeg-static` binary,
then falls back to `ffmpeg` on `PATH`. If neither is present, `produce()` still
returns the ordered `shots`; it just won't produce `result.film`. Override with
`{ stitch }` (e.g. point at your own service) or disable with `{ stitch: false }`.

> Node ≥ 18 only — `produce()` shells out to ffmpeg. The single‑agent HTTP methods
> work in the browser too.

### Interactive / step-by-step (drive a blueprint)

`produce()` is the autonomous shortcut. The **same engine** is exposed as a
production session you drive yourself — review each step, pick an output, regenerate
or skip, then advance. One caveat: the engine is **blueprint‑only**. It *executes* a
shot plan; it never *invents* one (the storyboard is the only thing that plans
shots). So first **plan a blueprint** from the idea with the exposed storyboard
builders (`castFromIdea → readStoryboard → panelToShot`), then step through it.

```ts
import {
  createProduction, createDirectClient,
  castFromIdea, readStoryboard, panelToShot,
} from '@modelark/film';

// The builders take a Ctx with a direct ModelArk client.
const ctx = { client: createDirectClient({ apiKey, baseUrl }) };
const idea = 'a desert town wakes at dawn';

const bible = await castFromIdea({ idea }, ctx);                                  // or pass your own anchors
const { anchors, panels } = await readStoryboard({ idea, targetSeconds: 60, bible }, ctx);
const blueprint = { shots: panels.map((p) => panelToShot(p, anchors)) };         // the only shot-planning artifact

const p = createProduction({ idea, bible, blueprint }, { apiKey, baseUrl, mode: 'review' });

await p.plan();            // build the step plan FROM the blueprint → p.state.plan
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

Don't want to plan at all? `produce()` (above) and `film.autoDirector()` (Service
API) do the casting + storyboard for you and run the whole thing. See
[`examples/interactive.mjs`](examples/interactive.mjs).

Plan editing (`editStep` / `addStep` / `removeStep` / `moveStep` / `toggleGate`),
`setMode('auto')` + `resume()` (auto-run, pausing only at gated steps), and `runAll()`
(fully autonomous — what `produce()` calls) are all on the session. There's also a
low-level `runStep({ agent, params, inputUrls }, ctx)` primitive if you want to
compose agents with no session at all.

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
// result: { bible, panels, plan, shots, assets, film? }  (PipelineResult; film.url is a hosted mp4)
```

`produce()` (in‑process, direct to ModelArk) and `film.autoDirector()` (Service API)
run the **same** pipeline — pick based on where you want the compute and the ffmpeg.

### Headless tests

The reference productions live in [`test/produce.e2e.mjs`](test/produce.e2e.mjs).
They make real, paid calls, so they skip unless the env vars are set:

```bash
MODELARK_API_KEY=…  MODELARK_API_BASE_URL=https://…  npm test
# or a single one-off:
MODELARK_API_KEY=…  MODELARK_API_BASE_URL=https://…  node examples/produce.mjs "your idea" --minutes 1
```

## Build your own loop (custom control)

Prefer to drive a loop yourself with the stateless single agents? They compose freely
— here, propose beats then realise each as a frame:

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
  config: { models: { seedream: 'ep-your-endpoint' }, prompts: { 'storyboard.read.system': '…house style…' } },
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
| `autoDirector(input, opts?)` | `PipelineResult` (full film, via Service API) |
| `run(agent, input, opts?)` | generic |
| `getRun(id)` | `Run` |

`opts`: `{ config?, webhookUrl?, onEvent?, signal?, pollIntervalMs? }`.
Pass `webhookUrl` to receive the final run via POST instead of waiting. `onEvent`
surfaces the run's lifecycle/trace events (delivered by polling — no streaming
connection to keep open).

### Full production

- `produce(input, opts?) → Promise<PipelineResult>` (also `FilmSuite#produce`) — autonomous pipeline.
- `createProduction(input, opts?) → Production` (also `FilmSuite#createProduction`) — interactive session over a **blueprint**.
- `runStep({ agent, params, inputUrls, count?, intent?, config? }, ctx) → outputs[]` — the low-level step primitive.
- `createDirectClient({ apiKey?, baseUrl? }) → Client` — a direct ModelArk client (the `ctx.client` the builders need).
- **Storyboard builders** — plan a blueprint from an idea; each takes `ctx = { client }`:
  - `detectGenre({ idea }, ctx) → GenreRead`
  - `castFromIdea({ idea, genre? }, ctx) → BibleEntry[]`
  - `readStoryboard({ idea, genre?, targetSeconds?, bible? }, ctx) → { anchors, panels }`
  - `panelToShot(panel, anchors?, genre?) → BlueprintShot`

Shared shapes: `input` = `{ idea, sources?, targetSeconds?, targetMinutes?, bible? }` (plus a `blueprint` for `createProduction`); `opts` = `{ apiKey?, baseUrl?, config?, qc?, perStepCount?, stitch?, outPath?, onEvent? }` (plus `mode?` for `createProduction`); `PipelineResult` = `{ bible, panels, plan, shots, assets, film? }`. The `Production` session exposes `plan/start/runStep/pick/approve/regenerate/skip/editStep/addStep/removeStep/moveStep/toggleGate/setMode/resume/stitch/runAll/result` + `on()` and `state`.

Single‑agent methods require Node ≥ 18 (global `fetch`) or a modern browser.
`produce()` / `createProduction()` are **Node‑oriented** (stitching shells out to ffmpeg; pass your own `stitch` to run elsewhere).
