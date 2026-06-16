# Hand-off — ModelArk Film Agent · current state

> For the next Claude session. This is a STATE snapshot (no action list). The project
> memory dir (auto-loaded `MEMORY.md`, esp. `film-pipeline-vertical-slice.md`) carries the
> blow-by-blow history. **Everything below is build/lint-verified; only items marked
> LIVE ✅ were run against real models — and the LIVE runs PREDATE this session's UI work
> (genre gate, SHOT cards, face→body cast, 4K, 5–15s, Seedance 2.0 prompt format), which
> is build-verified only.**

---

## 1. Environment & constraints

- **Node/npm** = Trae's bundled toolchain at `~/.trae/binaries/node/versions/24.13.1/bin`. Hidden from the sandbox — needs BOTH `export PATH="$HOME/.trae/binaries/node/versions/24.13.1/bin:$PATH"` AND `dangerouslyDisableSandbox: true` on the Bash call.
- **Best verification = `npx next build`** (compiles every route). Fast iteration: `cp file.js /tmp/x.jsx && /opt/homebrew/bin/deno lint /tmp/x.jsx`; pure modules via throwaway `node /tmp/x.mjs` proofs (core files with extensionless imports don't import cleanly — replicate their logic in the proof).
- **Ignore deno-only noise:** `no-window`, `require-await`, `no-node-globals`, and pre-existing destructure-to-drop unused-vars (e.g. `serializeNodes`).
- **NEVER claim runtime works without a live run.** The History panel `.txt` export is the verification instrument — ask the user to export it. A **stale browser bundle** has bitten repeatedly: after edits, the dev server recompiles but the open tab may run old code → hard-refresh (Cmd-Shift-R). Confirm code reached the server with `grep -rl "<new string>" .next`.
- **Can't drive the app here:** a 2nd `next dev` collides on `.next`; no Chrome extension connected. So UI changes are build-verified, not click-tested by Claude.
- **Do NOT `git commit` without asking.** Tree uncommitted since `131f3e6`.

## 2. Design rules (user-enforced — also in memory)

1. **Consistency obsession** — user input appears EXACTLY in the output; prompt and refs never disagree.
2. **Conversational, turn-by-turn** intake; **garbage gate** (invalid input is re-asked, never wrapped in a confirmation; nothing commits until it passes).
3. **Review gate before spend** — SHOT cards are the editable plan surface; 🎬 shoots exactly what the card says.
4. **Curate-first** — exploration/cast output is candidates with *suggested* role chips; the user's tag canonizes. Never auto-tag the bible.
5. **Quiet arrival / earned chrome**; **plain language** (no "hero"/"star" in copy; "beat" banned from user-visible copy).
6. **No auto-planner** — `createProduction` is blueprint-only; do not reintroduce LLM shot-invention.
7. **No hardcoded creative prompts** as defaults/fallbacks — default empty, rely on templates.
8. **Shots are 5–15s** @1080p (hard-clamped in `operations.animate`); a shot = a sequence of CUTs (≤5–6s each).
9. **Only pass size tiers that exist in `SEEDREAM_SIZES`** (2K/3K/4K). A bare `'1K'` falls through `resolveImageSize` to the literal `"1K"` → API rejects → silent failure.
10. **The storyboard frame is now a PHOTOREAL still** (the real cast plates + location plate condition a photographed film still that PLACES the cast in the location, at 4K) and is FED to Seedance as a composition reference — **alongside** the real cast/location plates (`shotReferences` puts the plates first, the frame last). This updates rule "no generated stills between assets and video": there IS a generated still now, but it's generated FROM the real plates AND the plates still ride to the video model, so identity is never sourced from a generated image alone. (Pencil sketches are gone.)

## 3. The Film pipeline (as built)

Explicit, ordered data in `utils/film/pipeline.js` (`FILM_PIPELINE` + `pipelineStatus()` which DERIVES each stage's status from artifacts, never a stored checklist):

**Launcher → Idea (+ genre gate) → Cast & World → Storyboard → Filming → Final cut.**

- **Launcher** ("What are we making?"): Cinematic Advertisement / Short Film. Picking Short Film sets `project.recipe`, opens the director chat + the pipeline strip.
- **Pipeline strip** (`PipelineStrip.js`, top-center, film mode): the FORWARD path — five stages with live status, the current stage carrying its one action button (Idea→Describe the idea/opens chat · Cast→Draft the production [+ optional "Explore the look"] · Storyboard→Storyboard it · Filming→Shoot the cards · Final cut→Stitch). The chat is NOT required to advance.
- **Director chat** (`FilmDock.js`): free-form only — corrections, questions, "film this: …". A premise auto-routes to genre detection. `✕` = **full reset** → wipes board/idea/genre/recipe → back to the launcher (no confirm; `resetFilm` in FilmCanvas).
- **Idea + genre gate**: a fresh premise → `detectGenre` (one cheap read, `storyboard.js`) → one-tap genre chips (primary + alternatives) in the dock → picking one locks `project.genre = {line}` and runs the cast draft IN that genre. Genre is threaded into the cast read AND the storyboard read.

## 4. Cast & World (`castFromIdea`, `utils/film/core/storyboard.js`)

- ONE reasoning read → `{ style, cast[] }`: a shared style sentence (appended to every plate) + characters and locations, in the chosen genre.
- **Characters = face→body two-step**: a cinematic **face plate** (4K **3:4** portrait, sectioned photoreal prompt — `[MEDIUM]/[SUBJECT]/[CAMERA]/[SKIN_REFLECTANCE]/[HAIR]/[EXPRESSION]/[FORBIDDEN]`, anti-AI-beauty) renders first, then a **full-body sheet** (4K **2:3**) generated with that face as a referenceImage (same identity for close-ups AND wides). Animals/antagonists are characters too.
- **Locations** = single plate (4K 16:9). The old "look" slot is dropped (the style sentence carries the look).
- **Placeholders stream**: `onPlan` drops a loading card per planned plate the instant the read returns; `onEntry(entry, i)` fills each slot (or removes it on failure). Per-plate resilient.
- Results land as candidates with suggested-role chips. The user tags keepers → the bible. Each character = **2 candidate cards** (`Name · face`, `Name · body`); tag both → both feed Seedance.

## 5. SHOT cards (`CutNode.js`; node type still `'cut'` internally)

A SHOT card = one shot's spec (5–15s), the director's slate, decomposed into Blueprint-style **input pins**:

- **REFERENCES** → `[Image1…N]` = the toggleable cast/location chips + the photoreal storyboard frame (resolved by `shotReferences(data, bible)` in recipes.js, frame last).
- **SHOT DESCRIPTION** → an editable **cut list** (each cut ≤6s + seconds picker, `+ cut`/`×`, total readout); cuts are joined by `CUT` markers.
- **CINEMATOGRAPHY** → the **50-shot template library** (`SHOT_TEMPLATES` in recipes.js) as a dropdown grouped by category (Scale·Angle·Movement·Composition·Specialty) OR hand-typed (lens·DOF·light·grain·grade·movement). Each template is a complete standalone line; the Shot agent selects one per shot (genre biases the pick). `CINEMATOGRAPHY_PRESETS`/`cinematographyForGenre` remain only as the fallback.
- **AUDIO** → optional (dialogue·ambient·foley·score).
- **STORYBOARD FRAME** → a PHOTOREAL still (cast placed in the location, **4K**) fed as a composition reference (NOT identity — the real plates carry that). Failed frames currently render nothing (known gap).
- **→ SEEDANCE 2.0 (composed)** preview = exactly what's sent.

`composeSeedancePrompt({references, cuts, cinematography, audio})` (recipes.js, proven) assembles `REFERENCES → SHOT DESCRIPTION (CUT-delimited) → CINEMATOGRAPHY → AUDIO`. `shotFromCard` (FilmCanvas) sends that as `motion`, with the SAME ordered images as explicit `refUrls` (cast plates + photoreal frame), `camera:'auto'`, duration = Σ cuts (5–15). Storyboard seeds ONE cut + the chosen template's cinematography per card; the user splits/edits (reasoner-authored multi-cut/audio is NOT built).

## 6. Engine & key files

- `core/production.js` — **blueprint-only** engine (no auto-planner). Direct (SHOT) shots carry explicit `params.refUrls`; the animate case prefers them (`p.refUrls || inputUrls`). Audio-policy retake fallback (`generateAudio:false`). `perShot` clamp 5–15.
- `core/operations.js` — `animate` (duration hard-clamped 5–15s/1080p; `refUrls` ≤9; `isAudioPolicyError`), `buildAnimatePrompt`.
- `core/storyboard.js` — `detectGenre`, `castFromIdea` (face→body, 4K, onPlan/onEntry), `readStoryboard` (idea+bible+genre → 5–15s shots, each picking a `shotTemplate` id from the 50-shot library, retried), `renderFrames` (PHOTOREAL storyboard frames — cast placed in location, 4K, location-guaranteed refs; was `sketchPanels`), `createStoryboard`, `panelToShot` (cinematography from the chosen template).
- `core/orchestrator.js` — headless pipeline (`castFromIdea → readStoryboard → panelToShot → stitch`). `panelToShot(panel, anchors, genre)` composes the SAME Seedance-2.0 prompt the UI cards send (via `composeSeedancePrompt`: REFERENCES from the real anchors + ONE cut + the chosen template's cinematography) — ONE shot-composition format across both callers. Headless still skips photoreal frames (no human review) — intentional.
- `utils/film/recipes.js` — `composeSeedancePrompt`, `shotReferences`, **`SHOT_TEMPLATES` (the 50-shot library)** + `SHOT_TEMPLATE_BY_ID`/`SHOT_TEMPLATES_BY_CATEGORY`/`shotTemplateCatalog`/`shotTemplateCinematography`, `CINEMATOGRAPHY_PRESETS`/`cinematographyForGenre` (fallback only), `adShotPlan`, registries. (`directShotText`/`composeShotPrompt` deleted.)
- `utils/film/imageSizes.js` — `SEEDREAM_SIZES` = **2K/3K/4K only**; `resolveImageSize(tier, ratio)`.
- `components/film/canvas/FilmCanvas.js` — the hub: `runAgent`, `dispatchFilmAction` (genre gate, castDraft, storyboard, action, stitch, nextStep…), `shotFromCard`, `storyboardPanelRef`, `resetFilm`, collision-aware placement (`findFreeOrigin`/`nodeRect`, `CUT_ROW_H=760`, `freeOrigin`), preserve/heal (`healNodeUrl`).
- `components/film/canvas/{PipelineStrip,FilmDock,CutNode,AssetNode,StoryTimeline,LayerPanel}.js`.
- `pages/api/film/preserve.js` (probes the public URL, falls back to presigned) + `resign.js` (fresh presign for owned objects). `utils/server/tosUpload.js` (7-day presign).

## 7. Verification status

- **LIVE ✅ (2026-06-12, headless API):** the headless pipeline ran end-to-end twice — snow leopard (5/5 shots, multi-ref direct-to-video confirmed) and turtle take 3 (5/5 shots, 60s film, audio-retake survived). These ran the old FLAT shot-text composer (`directShotText`, now deleted); `castFromIdea` is the same shared function (an earlier revision). The headless shot composer has since been unified onto `composeSeedancePrompt` (§6) — build-verified, not yet re-run live.
- **BUILD-VERIFIED ONLY (this session, the UI Short-Film path):** genre gate + chips, face→body 4K cast, SHOT-card pins, `composeSeedancePrompt` Seedance-2.0 format, sketch-as-reference, 5–15s durations, placeholder streaming, preserve/heal, collision placement. None of these has been clicked/run against real models. The composer + placement math have unit-style proofs; everything has `npx next build` + deno lint.

## 8. Current limitations / known gaps (state, not a to-do)

- The UI Short-Film path (§7) is not live-tested; a real run is the open validation.
- Storyboard reasoner authors one cut per shot + picks ONE of the 50 cinematography templates (no reasoner multi-cut/audio).
- Headless `panelToShot` composes the Seedance-2.0 format (unified with the UI), incl. the 50-template cinematography; it still skips photoreal frames by design (no human review). Headless path is BUILD-VERIFIED ONLY — the LIVE ✅ runs (§7) predate it.
- **NEW (build-verified only): photoreal storyboard frames (cast placed in location, 4K) + the 50-shot cinematography library + the Shot agent selecting a template per shot.** Not yet live-run — the open validation is eyeballing that frames are photoreal cast-in-location stills (not sketches) and that the agent varies templates sensibly.
- A failed storyboard FRAME renders nothing on the card (no "failed/retry" state).
- SHOT-card placement uses a fixed 760px row pitch; very tall cards (many cuts) could still overlap; re-running storyboard re-lays existing cards (pitch change only affects newly-laid cards).
- 4K frames × 6–18 shots is the slowest/priciest stage (placeholders stream so the board isn't dead; expect minutes).
- 9-ref Seedance cap: cast(face+body) + location + frame can exceed 9 on a crowded shot; `shotReferences` `.slice(0,9)` with the frame last (first to drop).
- Library copies of preserved assets can keep dead URLs (only board nodes self-heal).
- Whether Seedance accepts the multi-cut `CUT` prompt + the photoreal frame-as-ref is unconfirmed (needs a live shot).
- ~12 stale legacy workflow-node tests fail (pre-existing).
- Ad flow (ConciergeDock) still exists and shares the engine + (legacy two-prompt) cards.

## 9. Verification recipes

```bash
# lint JSX (filter known noise)
cp components/film/canvas/X.js /tmp/X.jsx
/opt/homebrew/bin/deno lint /tmp/X.jsx 2>&1 | grep -E "error\[no-unused|error\[no-undef" | grep -vE "no-window|require-await|no-node-globals"

# THE build check (needs PATH + sandbox off)
export PATH="$HOME/.trae/binaries/node/versions/24.13.1/bin:$PATH"
npx next build 2>&1 | grep -E "Compiled|Failed|error "

# confirm new code reached the running dev server (stale-bundle check)
grep -rl "<a string from your change>" .next

# headless generation (user's dev server on :3000, key from .env.local)
curl -s -X POST localhost:3000/api/v1/runs -H 'Content-Type: application/json' \
  -d '{"agent":"autoDirector","input":{"idea":"…","targetMinutes":0.5,"perStepCount":1}}'
curl -s localhost:3000/api/v1/runs/<id> | grep -o '"status":"[a-z]*"' | head -1
```
