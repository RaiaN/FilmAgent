# @modelark/film

Plug‑and‑play SDK for the ModelArk **agentic film suite**. Drive the agents from
your own platform — no UI, no orchestration code. Each call submits an async run
to the Service API and resolves with the finished results (streaming events
optional).

## Install

```bash
npm install @modelark/film
```

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

## Build your own Story Director loop

Agents are stateless, so *your* harness composes the loop:

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
| `run(agent, input, opts?)` | generic |
| `getRun(id)` | `Run` |

`opts`: `{ config?, webhookUrl?, onEvent?, signal?, pollIntervalMs? }`.
Pass `webhookUrl` to receive the final run via POST instead of waiting. `onEvent`
surfaces the run's lifecycle/trace events (delivered by polling — no streaming
connection to keep open).

Requires Node ≥ 18 (global `fetch`) or any modern browser.
