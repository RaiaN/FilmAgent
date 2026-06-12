# Hand-off — ModelArk Film Agent · Calivision PoC

> For the next Claude session. Read §1, §2 and §8 first. The project memory dir (auto-loaded `MEMORY.md`) carries the durable design rules — this file is the deep context. Everything is **parse/build-verified; only items marked LIVE ✅ were run against real models.**

---

## 1. Environment & constraints (READ FIRST — changed since the last hand-off)

- **Node/npm EXISTS** (the old "no Node" constraint is dead): Trae's bundled toolchain at `~/.trae/binaries/node/versions/24.13.1/bin` (node 24.13.1, npm 11.8.0). It is hidden from the sandboxed shell — you need BOTH `export PATH="$HOME/.trae/binaries/node/versions/24.13.1/bin:$PATH"` AND `dangerouslyDisableSandbox: true` on the Bash call.
- **Best verification = `npx next build`** (compiles every page/route, prerenders `/` → the whole React tree renders). Use deno (`/opt/homebrew/bin/deno`) for fast iteration: `cp file.js /tmp/x.jsx && deno lint /tmp/x.jsx` for JSX, `deno run` throwaway proof scripts for pure modules (recipes, timelineModel, trace, retry, parallel; core files with extensionless imports don't `deno run` — replicate their logic in the proof instead).
- **Ignore deno-only noise:** `no-window`, `require-await`, `no-node-globals` (on API routes), and the pre-existing `setFormValues`/`err` unused-vars in FilmAgentPlayground.
- **Bash harness ~`set -e` + pipefail**: a failing grep/ls or a `| head` SIGPIPE kills the whole compound command and hides output. Guard every potentially-failing stage with `|| true` / avoid piping `find` to `head`.
- **Stack:** Next 16.2.9 (Pages Router) · React 18.3.1 (19 = deliberate hold) · eslint 9.39.4 (10 drops `.eslintrc.json`) · ffmpeg-static installed. `npm audit`: 5 vulns left, all `@volcengine/tos-sdk`→axios, **no fix published**. `npm run lint` (`next lint`) may be broken under Next 16 — not blocking, migrate to ESLint CLI if needed.
- **The user usually has `npm run dev` running on :3000** with `MODELARK_API_KEY` + TOS creds in `.env.local` (server-side fallback — headless API calls need no key in the body). Check `curl localhost:3000` before booting your own.
- **NEVER claim something works at runtime without a live run.** Separate "parse/build-verified" from "needs browser + key". The **History panel / run trace is the verification instrument** — ask the user to export the `.txt` and analyze it (this loop caught every major bug).
- **Do NOT `git commit` without asking.** The working tree has been uncommitted all along (last commit `131f3e6`).

## 2. Design rules (the user enforces these hard — also in memory files)

1. **Consistency obsession**: what the user provided must appear EXACTLY in the output. Production prompt-writing uses the **preservation persona** (`creativePlanner.adShot.*`, via `planTask:'adShot'`); exploration personas are for the freeform board ONLY. Hero bible refs anchor every ad shot. Prompt and refs must never disagree.
2. **Conversational, turn-by-turn UX** for intake/control (ask one thing at a time); free text is first-class; **garbage gate** — an invalid input is never wrapped in a confirmation (`valid:false` + `clarify` in the intent schema; nothing commits to the project until the brief passes).
3. **Review gate between intent and spend**: "Make the ad" lays out **CUT cards** (editable prompt/duration/motion/asset-toggles + dashed prerequisite edges); **🎬 Action** shoots exactly what the cards say. Never launch multi-shot generation without an editable plan surface.
4. **Curate-first**: exploration output (Topic Explorer, variations) is candidates with *suggested* role chips — the user's click canonizes; never auto-tag into the bible.
5. **Quiet arrival / earned chrome**: no auto-opened panels; timeline controls appear only when actionable; launcher cards hide once a recipe is chosen or a dock is open.
6. **Plain language** in agent speech (no "star"/"hero" in copy; name actual things). **Suggestion chips in the gap interview were built and REVERTED** — don't reintroduce without asking.
7. **Quality bar**: shots 10–15s @1080p (hard-clamped in `operations.animate`), shot count = targetSeconds/10.

## 3. Product surfaces (as built)

- **Front door**: empty board → "What are we making?" recipe cards (registry-driven from `RECIPES`): 📣 Cinematic Advertisement, 🎞️ Short Film. Assets-first path → floating "✨ What are we making?" dropdown. Closed docks → floating ⚡ Concierge / 🎬 Director reopen buttons. Header has NO workflow buttons anymore.
- **Ad flow (ConciergeDock chat)**: idea (garbage-gated) → intent read+confirm (kind/hero/subjects/brandRelevant; `readAdIntent`) → aspect/length/look chips → inventory ("Sort what I have" = classify board images into role-tagged nodes) → per-role gap interview (Upload / Generate-with-description / Skip; subject-steered; brand skipped when `brandRelevant:false`) → ready (+pre-shoot note) → **cuts-review (CUT cards on board) → 🎬 Action** → blueprint-driven production → timeline.
- **Film flow (FilmDock chat = router)**: free text → `routeFilmAction` (LLM interprets → one plain-sentence proposal → `[Do it]` → deterministic dispatch): filmChunk / correctChunk / approveChunk / proposeBeats / inspiration / characterVariations / locationVariations / mixMatch / exploreTopic. Engine = `createFilmingSession` (generate 10–15s → QC-advisory + human Approve → correct = re-animate only → continue via last-frame + cast-first bible refs). Timeline in film mode = minimal view (no rail/ruler/budget); FilmingInspector = structured alternative.
- **Bible = role-tagged board nodes** (`data.bibleRole`+locked; `project.bible` DERIVED via `reconcileBibleFromNodes`, keyed by nodeId, seed-gated for old projects). AssetNode shows role badge/dropdown + dashed `+ Role?` suggested chip.
- **Topic Explorer** (rail agent, lime/compass): LLM-discovered taxonomy shallow→deep (3 concepts × ~4 images, breadth-first, budget≤24, depth-2 deepen), craft-brief card + one tight 2×2 frame per concept, candidates carry suggested roles.
- **Mix&Match = story moments**: ref[0] = character (tagged talent wins), rest = locations (bible location anchors fill in via `settings.locationUrls`); outputs = "what might be HAPPENING to them there".
- **History panel** (toolbar): full decision tree workflow→step→action, role-annotated refs (orange = identity anchors), Copy/.txt export. Trace wraps the transport; producer/concierge/filming flows traced; **rail-agent runs are NOT traced (known gap)**.

## 4. Engine (shared core, SDK-owned)

- `core/production.js` — `createProduction`: blueprint-driven planning (`input.blueprint.shots[]`: beat/promptSeed/motion/durationSec/roles or **explicit `refEntryIds` from CUT cards which win verbatim**; `heroRole` anchoring), generic LLM path for non-recipe runs, wave-parallel `runAll` (deps-ready waves, concurrency 3), full animate retry (start+poll, fresh task), per-step QC skipped when count=1.
- `core/filming.js` — `createFilmingSession`: append-only chunk chain, live `getIdea`/`getBible` getters, `transport.lastFrame` (browser → `/api/film/last-frame`, ffmpeg `-sseof`, base64; falls back to keyframe), persisted at `project.filming`, chunk ids = timeline event ids.
- `core/operations.js` — ops + `planTask` persona switch + `withRetry` on Seedream/startVideo + animate clamp 10–15s/1080p. `core/retry.js` (transient matcher built from REAL observed errors), `core/parallel.js` (pool + readySteps), `core/explore.js`, `core/trace.js`, `core/director.js` (classifyAssets, `readAdIntent` w/ valid+clarify, `routeFilmAction`, qcStep, exported `parseJson`).
- **Headless Service API works** LIVE ✅: `POST /api/v1/runs {agent:'autoDirector', input:{idea,targetMinutes,perStepCount}}` → poll `GET /api/v1/runs/:id` (status: queued/running/succeeded/failed — read the FIRST `"status"` in the body; step statuses appear later in it). Note: its serverStitch discards `assetId` → headless films don't land in the in-app Library (gap).

## 5. Live-validated (real runs, 2026-06-11/12)

- 3 example films generated headlessly end-to-end (Sheikh&boy drama, cartoon sand-fox pilot, desert nature ad) — final cuts in TOS `film_asset_/*-final-cut.mp4`; presigned links expire (final-cut 1h, Seedream/Seedance 24h); fresh links: presign via `@volcengine/tos-sdk` `getPreSignedUrl` with `.env.local` creds.
- Parallel waves + retries work; runs ≈12–25 min; **Seedance accepts duration 10 @1080p (~4.5 min/shot) — 15 untested**.
- **Content filters are the dominant failure mode now**: i2v "input image may contain real person" (photoreal humans — cartoon passes) and "output audio may contain sensitive information". Pending task chip: retry such shots with `generateAudio:false`.

## 6. Known issues / gaps

- Audio-policy shot loss (chip pending) · 12 stale legacy workflow-node tests failing (chip pending) · rail-agent runs untraced · film chat can't classify assets ("tag these" not a routed action) · serverStitch drops assetId · BibleRail shows generic role labels for ad roles (cosmetic) · CUT-card on-canvas editing ergonomics untested live (fallback idea: click-card→edit-in-dock focus mode) · untagged generated candidates die with their 24h URLs (tagging preserves).

## 7. Prompts UI (all editable, localStorage overrides; server uses defaults)

Groups: Mix & Match (story-moments persona) · Animate · Prompt Muse · Creative Planner (exploration personas + **adShot preservation**) · Concierge (intent w/ valid+clarify · route · classify) · Producer (generic planner, 10–15s rule) · Topic Explorer (read/deepen). Story Director templates are service-only (`surface:'service'`, hidden from UI — do NOT delete; Service API uses them).

## 8. ⭐ Where to pick up

1. **Live-test the CUT-cards flow** (Make the ad → edit cards → Action) — newest surface, zero live runs. Then the FilmDock router phrasing quality (tune `concierge.route.*` against real History exports).
2. **Apply the audio-retry chip** before batch testing.
3. **The PoV goal: validate the ONE ad blueprint × 10 different ads** — use History exports per run; check beats/refs/no-leaks/coherence. Intent read quality across product/service/brand-story ideas.
4. Candidates from §6 as the user directs. The user drives priorities turn-by-turn — propose, confirm scope, build, verify (deno lint → proof → `npx next build`), and always state verified-vs-untested honestly.

## 9. Verification recipes

```bash
# lint JSX (filter the known noise)
export PATH="/opt/homebrew/bin:$PATH"
cp components/film/canvas/X.js /tmp/X.jsx
deno lint /tmp/X.jsx 2>&1 | grep -iE "error\[" | grep -ivE "no-window|require-await" | cat

# pure-module proof: write _proof.mjs importing utils/film/{recipes,timelineModel}.js
# or core/{trace,retry,parallel}.js, assert, `deno run --allow-read _proof.mjs`, delete.

# THE build check (needs sandbox off)
export PATH="$HOME/.trae/binaries/node/versions/24.13.1/bin:$PATH"
npx next build 2>&1 | grep -E "✓|Error|Failed"

# headless generation (user's dev server on :3000, key from .env.local)
curl -s -X POST localhost:3000/api/v1/runs -H 'Content-Type: application/json' \
  -d '{"agent":"autoDirector","input":{"idea":"…","targetMinutes":0.5,"perStepCount":1}}'
curl -s localhost:3000/api/v1/runs/<id> | grep -o '"status":"[a-z]*"' | head -1

# icons exist before importing
grep "export declare const IconX:" node_modules/@arco-design/web-react/icon/index.d.ts
```
