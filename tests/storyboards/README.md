# Storyboard generation harness

Exercises the **Storyboard** end-to-end on real generations: makes N distinct film
ideas, and for each builds a bible (cast/places), storyboards it into shots — each a
frame sequence (open · mid · close) following the shot-grammar — renders every frame,
and saves the results for eyeballing.

It is **opt-in** (it calls the live ModelArk API — costs money and takes a while), so
`npm test` skips it by default.

## Run it

```bash
RUN_STORYBOARD_GEN=1 npm test -- tests/storyboards/generate.test.js
```

Needs `MODELARK_API_KEY` + `MODELARK_API_BASE_URL` in `.env.local` (next/jest loads it).

Tunables:

| env | default | what |
|-----|---------|------|
| `STB_IDEAS` | 10 | how many film ideas / storyboards |
| `STB_FRAMES` | 3 | frames per shot (2–4; open·mid·close) |
| `STB_SHOTS` | auto | max shots per storyboard |

Quick smoke (2 ideas, 2 frames): `RUN_STORYBOARD_GEN=1 STB_IDEAS=2 STB_FRAMES=2 npm test -- tests/storyboards/generate.test.js`

## Output

Each run lands in `tests/storyboards/run-<timestamp>/` (git-ignored):

```
run-2026-06-18.../
  ideas.json                 # the N premises
  summary.json               # per-idea shot/frame counts + any errors
  01-<slug>/
    idea.txt  bible.json  storyboard.json
    shot1-open.jpg  shot1-mid.jpg  shot1-close.jpg  shot2-open.jpg ...
    index.html               # open this — the storyboard laid out as panels (rows = shots)
  02-<slug>/ ...
```

Open any `index.html` to read that film's storyboard as a panel grid.
