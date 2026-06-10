# Film Agent Suite — Architecture

> An agentic film-making suite for ModelArk: **from an idea to a cinematic 3–5 min film.**
> Built UX-first as a freeform canvas, but factored so the *engine* is a plug-and-play
> product an API customer can adopt without the UI.

---

## 1. The big picture

The suite is layered so that **orchestration/prompts/models live in one runtime-agnostic
core**, and every surface above it (the canvas, the HTTP service, the SDK) is a thin binding.

```
                          ┌─────────────────────────────────────────────┐
                          │  ROOT SETTINGS  (suiteConfig + promptTemplates)│
                          │  models · runtime · per-agent defaults · prompts│
                          └───────────────────────┬─────────────────────┘
                                                  │ resolved into every call
            ┌─────────────────────────────────────┼──────────────────────────────────┐
            │                                       │                                  │
   L4 CANVAS (showcase)              L3 SDK  @modelark/film            (your harness)
   components/film/**                sdk/**                            customer code
            │                                       │                                  │
            │ createBrowserClient                   │ HTTP (poll)                      │
            ▼                                       ▼                                  │
   ┌────────────────────┐               ┌─────────────────────────┐                   │
   │  L1 CORE OPERATIONS │◀──────────────│  L2 SERVICE API          │◀──────────────────┘
   │  core/operations.js │   run store   │  /api/v1/runs (async)    │
   │  (pure, ctx-driven) │   + executor  │  server/runStore.js      │
   └─────────┬──────────┘               └─────────────────────────┘
             │ ctx.client (transport)
             ▼
   ┌──────────────────────────────┐        ┌──────────────────────────────────┐
   │ createBrowserClient (→ /api/*)│   OR   │ createDirectClient (→ ModelArk)   │
   │ core/client.js                │        │ core/directClient.js  (headless) │
   └───────────────┬──────────────┘        └──────────────┬───────────────────┘
                   │                                        │
                   ▼                                        ▼
          Next.js API routes  ───────────────────►  ModelArk Platform
          /api/film/* · /api/seed · /api/seedance      Seedream · Seedance · Seed 2.0 · Assets/TOS
```

**Key idea:** L1 never knows *how* it talks to ModelArk — it receives a `ctx.client`
(a transport) and a resolved `config`. Swap the client and the same operation runs in a
browser (through our API routes) or headless (straight to ModelArk).

---

## 2. The layers

### L1 — Core (runtime-agnostic engine)
| File | Responsibility |
|---|---|
| `utils/film/core/operations.js` | **Pure agent operations.** `inspiration`, `characterVariations`, `locationVariations`, `mixMatch`, `animate`, `promptMuse`, `suggestNextBeats`, `suggestComposition`, `suggestMotion`, plus `buildAnimatePrompt` / `parseBeats` and the `VARIANT_POOLS` / `COVERAGE_POOLS`. Each takes `(input, ctx, onItem?)` where `ctx = { client, config }`. No DOM, no HTTP, no env. |
| `utils/film/core/client.js` | **Browser transport.** `createBrowserClient(apiKey)` → `{ generateImage, reason, startVideo, pollVideo }` calling our Next API routes. `errMsg()` normalizes error payloads to strings. |
| `utils/film/core/directClient.js` | **Headless transport.** `createDirectClient({ apiKey, baseUrl })` → same interface, calls ModelArk directly (ref-inlining, `/responses` or `/chat/completions`, video task+poll). Used by the SDK / any server. |

The two clients are interchangeable because they implement the **same 4-method interface**.

### L2 — Service API (async runs)
| File | Responsibility |
|---|---|
| `pages/api/v1/runs/index.js` | `POST` create a run (Bearer or body `apiKey`, validated agent id). Returns a run id immediately. |
| `pages/api/v1/runs/[id]/index.js` | `GET` run status — includes `results` (grows incrementally) and `events` (the trace). |
| `utils/film/server/runStore.js` | In-memory run store (`globalThis.__filmRunStore`), `createRun` / `getRun` / `publicRun`, `emit` (appends trace events), `execute` (drives a core operation, fills `run.results`, fires the optional webhook). |

Model: **submit → poll** (or **submit → webhook**). No SSE, no multi-tenancy, no safety/repeatability
layer — deliberately lean for v1.

### L3 — SDK (`@modelark/film`)
| File | Responsibility |
|---|---|
| `sdk/src/index.ts` | `FilmSuite` class — typed per-agent methods (`inspiration`, `characterVariations`, … `storyBeats`, plus generic `run` / `getRun`). Submits to L2, polls to completion, surfaces `onEvent` from the polled trace. Supports `webhookUrl`, `signal`, per-call `config`. |
| `sdk/src/types.ts` | Public types: agent inputs, `ImageAsset`/`VideoAsset`/`TextAsset`/`Beat`, `Run`, `RunEvent`, `SuiteConfigOverride`, options. |
| `sdk/README.md` | Quickstart + "build your own Story Director loop" (agents are stateless; *your* harness composes the loop). |

### L4 — Canvas (the pre-sales showcase)
The freeform React Flow board. It binds the canvas to L1 via `createBrowserClient` and the
agent registry. This is **one example consumer**, not the product itself. See §6.

### L5 — Observability
The run's `events[]` trace (`queued → running → asset → video.queued → succeeded/failed`) is the
seam for tracing. Emitted by `runStore.emit`, exposed on the run, surfaced through the SDK's
`onEvent`. (Hook your tracer/metrics here.)

---

## 3. Root settings — the suite's control plane

Everything tunable lives in two registries, merged through a **3-layer resolver**.

```
ROOT_CONFIG (code default)  ◀── client localStorage override ◀── per-call override
   models / runtime / defaults              (canvas user)            (SDK opts, body)
                         └──────── resolveConfig() ────────┘
```

| File | Holds |
|---|---|
| `utils/film/suiteConfig.js` | `ROOT_CONFIG = { models:{ seedream, seedance, reasoner }, runtime:{ pollIntervalMs, timeoutMs, defaultImageSize }, defaults:{ per-agent } }`. `deepMerge`, `resolveConfig`, `getModel/getRuntime/getAgentDefaults`, client override get/set/reset (localStorage `film-agent-suite-config`). Re-exports the prompt template API. |
| `utils/film/promptTemplates.js` | `DEFAULT_TEMPLATES` registry (~13 named templates with `{placeholders}`), `renderTemplate`, get/set/reset/isOverridden, `templatesByAgent`. localStorage override store `film-agent-prompt-overrides`. |
| `components/film/PromptSettings.js` | Drawer UI to view/edit/reset every prompt template (the "root settings of the suite"). |

Prompt templates are **data, not code** — edit them in the drawer, override per-call in the SDK,
without touching operations.

---

## 4. The agents

Registry: `utils/film/agents.js` (the **L4 binding** — UI metadata + a thin `run()` that maps the
canvas selection onto a core operation). `AGENT_COLORS`, `AGENTS[]`, `AGENT_MAP`, `AXIS_OPTIONS`.

| Agent | id | icon | Consumes | Core op | Model |
|---|---|---|---|---|---|
| Inspiration Board | `inspiration` | bulb | — (prompt; optional ref images) | `inspiration` | Seedream |
| Character Variations | `characterVariations` | user | 1 image | `characterVariations` | Seedream |
| Location Variations & Coverage | `locationVariations` | location | 1 image | `locationVariations` | Seedream |
| Mix & Match | `mixMatch` | mix | ≥2 images | `mixMatch` | Seedream (multi-image blend) |
| Animate (Seedance) | `animate` | film | 1 image | `animate` (async task+poll) | Seedance |
| Prompt Muse | `promptMuse` | muse | image / video | `promptMuse` | Seed 2.0 Pro (VLM) |
| Story Director | `storyDirector` | story | — (interactive) | `suggestNextBeats` + `inspiration` per beat | Seed 2.0 Pro + Seedream |
| **Auto Director** | `autoDirector` | auto | assets + idea (interactive) | `understandAssets`+`buildPlan`+`qcStep` + **every agent above** | Seed 2.0 Pro + the agents |

- **Icons** are single-sourced in `components/film/canvas/agentIcons.js` (`agentIcon(key)`), used by
  the rail, the context menu, and the control panels.
- **Story Director** is `interactive: true` — it runs its own loop in `StoryDirectorPanel` /
  `StoryTimeline` (suggest → pick → generate keyframe → chain), instead of a generic Run button.
- **Auto Director** is `interactive: true` and an *orchestrator* — see §4a.

---

## 4a. Auto Director (orchestrator)

Turns *any* creative input (assets + idea) into a finished film by planning a production, running
the existing agents step by step, QC-ing each, and gating on the human. **Creative control is the
product**, so nothing runs unattended without consent: the plan is editable before it starts, and
every step is reviewable.

**Form: a canvas-native multi-step element** — a custom React Flow node type `autoPlan`
(`components/film/canvas/AutoPlanNode.js`) that lives on the board and pans/zooms with it. Armed from
the rail like Story Director. One active plan per project (V1).

**Lifecycle** (`status` on the node): `understanding` → `planning` → `review-plan` → `running` →
`assembling` → `done`.
1. **Understand** — VLM reads the source images (selected, else all) + idea → a **brief**.
2. **Plan** — emits ordered **steps**, each `{agent, title, intent, params, dependsOn}` using only the
   *plannable* agents (`PLANNABLE_AGENTS` = inspiration / character / location / mixMatch / animate;
   storyDirector + promptMuse are excluded). `dependsOn` is a strict DAG (earlier steps only).
3. **Review plan** — user reorders / edits params (reusing the real `SettingsControls`) / removes /
   adds steps, toggles a **per-step gate** ("require my review"), and picks **Review-each** or
   **Auto-run** mode.
4. **Run** — per step: resolve inputs (approved deps' keepers, else source assets) → `runAgent` →
   outputs land on the canvas (cascaded, in a labeled group) → `qcStep` (VLM) → **pause** if
   gated / Review-each / QC-fail, else auto-approve and advance. The human picks the keeper,
   regenerates, edits, skips, or approves.
5. **Assemble** — approved animate shots → `/api/film/stitch` (server ffmpeg) → a **"Film — final
   cut"** video node.

**Architecture.**

| Piece | File | Role |
|---|---|---|
| L1 ops | `utils/film/core/director.js` | `understandAssets`, `buildPlan`, `qcStep` + tolerant JSON parse. Pure; reasons via `ctx.client.reason`. |
| Templates | `promptTemplates.js` | `autoDirector.{understand,plan,qc}.{system,user}` — root settings, editable in the Prompts drawer. |
| Browser adapters | `agents.js` | `understandAssets` / `buildPlan` / `qcStep` (image inputs via `refUrl` → uploads work). |
| Reuse seam | `FilmCanvas.runAgent` | The shared "run any agent, collect outputs, await async video" helper — used by the **manual Run button and Auto Director alike**. |
| State + executor | `FilmCanvas` | Owns the `autoPlan` state machine + all actions; persisted to `project.auto`. |
| Element ↔ state | `AutoDirectorContext.js` | The `autoPlan` node reads live `{plan, actions}` from context (no callbacks serialized on the node). |
| Slim panel | `AutoDirectorPanel.js` | Right-side arm/disarm surface ("Create plan", "Take over manually"). |
| Final cut | `pages/api/film/stitch.js` | Downloads shots → ffmpeg concat → TOS → presigned playable URL. Needs `ffmpeg-static` (`npm install`). |

**Principles.** Two gates (plan-level + step-level); **QC advises, the human decides** (issues never
block); regenerate adds rather than replaces; **Take over manually** disarms and leaves every asset on
the board. Reload rehydrates the plan (in-flight steps reset to re-runnable).

---

## 5. Asset lifecycle (the part that bites)

Three URL forms exist for an asset, and **which one you use depends on who reads it back**:

| Form | Who can read it | Used for |
|---|---|---|
| `data:` base64 (`localUrl`) | anyone (it *is* the bytes) | thumbnails; **Seedream image references** |
| TOS object URL (`tosUrl`) | ModelArk backend (internal) — **not** the browser or our server `fetch` | Seedance source; persistence handle |
| `asset://<id>` (`assetId`) | ModelArk backend (trusted) | **Seedance / Animate** source |

> ⚠️ **The TOS object URL is not publicly fetchable in this deployment** (returns 403 to a browser
> `<img>` and to a plain server-side `fetch`). That single fact dictates the rules below.

### Upload flow

```
local file ──readFileAsDataUrl──▶ AssetNode { url=base64, localUrl=base64 }   (renders instantly)
                                        │
                              stageNode (background)
                                        ▼
            POST /api/film/upload  ──▶  TOS (authenticated PUT)  ──▶  Assets API CreateAsset
                                        │                                   │
                                        ▼                                   ▼
                              returns { url: tosUrl, assetId }      registerAsset (shared util)
                                        │
        node.data = { url:base64ref, localUrl:base64, tosUrl, assetId, staged:true }
                                        │
                   makeThumbnail(base64) ──▶ addToLibrary({ url:tosUrl, thumb, assetId })
```

**Rules enforced in code:**
- **Seedream references** (`inspiration` refs, `characterVariations`, `locationVariations`,
  `mixMatch`, `promptMuse`) use `refUrl(node) = node.data.localUrl || node.data.url` →
  uploads reference by **base64** (passes straight through `imagine.js`; never fetched). Generated
  assets have no `localUrl` and use their fetchable URL.
- **Animate** uses `url` (tos) **+ `assetId`** → Seedance's trusted source. Never base64.
- **Library** stores a small embedded `thumb` (downscaled JPEG `data:` URL, ~15 KB) so the grid
  previews even though `tosUrl` would 403. `LibraryPanel` renders `item.thumb || item.url`.
- **Dragging a library upload back** reattaches `thumb` as `localUrl` so it still previews.

| File | Role in lifecycle |
|---|---|
| `utils/film/canvasModel.js` | `createAssetNode`, `stageLocalAsset` (→ `{url, assetId}`), `makeThumbnail`, `preserveAsset`, `serializeNodes` (strips `localUrl`/transient flags). |
| `pages/api/film/upload.js` | Stage local bytes → TOS, then **Assets API register** → returns `{ url, assetId }`. |
| `pages/api/film/preserve.js` | "Check in": fetch the still-valid signed URL, re-host to TOS, register via Assets API → stable `{ url, assetId }`. |
| `utils/film/server/registerAsset.js` | **Shared** `CreateAsset` (+ auto-create group) helper, used by both upload & preserve. |
| `utils/film/libraryStore.js` + `pages/api/film/library.js` | Cross-project library index (`~/.modelark-starter-kit/film-agent-library.json`), now persists `thumb`. |
| `components/film/canvas/AssetNode.js` | `displaySrc = localUrl || url`; "Expired" only when `imgError && !preserved && !localUrl`. |

### Generated-asset reference (no upload)
Seedream returns **24h signed TOS URLs**. `imagine.js` re-inlines every `http(s)` reference to
base64 before re-feeding Seedream (avoids a second fetch that would 403 once aged). "Check in"
(`preserve`) re-hosts the bytes and registers an `assetId` so the asset survives past 24h.

### ⚠️ Known boundary
`serializeNodes` strips `localUrl` (base64 is huge). After **save + reload**, an uploaded node
keeps its `assetId` (Animate still works) but loses its base64 — and `tosUrl` 403s — so reusing a
*reloaded* upload as a **Seedream** reference fails. Proper fix needs a browser-loadable persistent
URL (public bucket, or the Assets-API-served URL from `GetAsset`). In-session is full quality.

---

## 6. Canvas (L4) internals

| File | Responsibility |
|---|---|
| `components/film/FilmAgentPlayground.js` | Project lifecycle (New/Open/Save), canvas mount, header (Prompts/Project), `PromptSettings` drawer. |
| `components/film/canvas/FilmCanvas.js` | The React Flow board: nodes/edges state, selection, drop/ingest/stage, library, context menu, Story Director state + timeline. Renders `StoryDirectorPanel` for the story agent, else `LayerPanel`. |
| `AssetNode.js` / `GroupNode.js` | Asset card (no pins); titled frame that groups one run's outputs (React Flow `parentId`+`extent`). |
| `LayerRail.js` | Left agent rail (icons via `agentIcon`), visibility cycle show→dim→hide. |
| `CanvasContextMenu.js` | Selection/right-click → agent menu, enabled per the agent's `consumes`/`minSelection`. |
| `LayerPanel.js` / `StoryDirectorPanel.js` | Right-side control panels (now header icon via `agentIcon`). |
| `StoryTimeline.js` | Bottom strip of chained keyframes (the only place edges are drawn). |
| `agentIcons.js` | Single source for agent `icon` → Arco icon. |
| `LibraryPanel.js` | In-canvas drawer of checked-in assets; draggable onto the board. |

Interaction model: **freeform board + selection-driven agents** (Google-Maps-style toggleable
layers), not a wizard. Marquee select → context menu → pick agent → run.

---

## 7. ModelArk endpoints & models

| Capability | API route (browser) | Direct (headless) | Default model (ROOT_CONFIG) |
|---|---|---|---|
| Image gen / edit | `/api/film/imagine` → `/images/generations` | `directClient` | Seedream `ep-20260501195034-hj78f` |
| Video (i2v) | `/api/seedance` + `/api/seedance-status` (task+poll) | `directClient` | Seedance `ep-20260415171928-pdvvr` |
| Reasoning / VLM | `/api/seed` (`/responses`, multimodal) | `directClient` | Seed 2.0 Pro `seed-2-0-pro-260328` |
| Asset register | `/api/film/upload`, `/api/film/preserve` (Assets API + TOS) | — | — |

Server env (`.env.local`): `MODELARK_API_BASE_URL`, `MODELARK_ASSET_ACCESS_KEY/SECRET_KEY`,
`MODELARK_TOS_BUCKET/REGION/ENDPOINT/PUBLIC_BASE_URL/OBJECT_PREFIX`, `MODELARK_ASSET_GROUP_ID`,
plus Assets API REGION/SERVICE/VERSION/BASE_URL/TERMINAL/POLL_*.

---

## 8. Request flows

**Canvas image generation (sync-ish, streamed per item):**
```
LayerPanel "Run" → agent.run() → ops.characterVariations(input, {client,config}, onItem)
   → ctx.client.generateImage() → POST /api/film/imagine → Seedream
   → each result → onItem → onAsset → new AssetNode placed in a GroupNode
```

**Animate (async video):**
```
agent.run() → onPendingAsset (loading video node) → ops.animate() → /api/seedance → { taskId }
   → ctx.client.pollVideo({taskId}) (background) → /api/seedance-status … →
   → onResolveAsset(pendingId, { url: mp4 })   (or onFailAsset)
```

**Service API run (SDK / customer):**
```
film.animate(input,{onEvent,webhookUrl})
   → POST /api/v1/runs            → createRun + execute() (server)
   → poll GET /api/v1/runs/:id    → events[] + results[] grow
   → resolves when status=succeeded   (or webhook POST fires with the final run)
```

---

## 9. Persistence

| What | Where |
|---|---|
| Project (canvas v2 shape) | `utils/film/projectShape.js` (+ `migrateProject`), `pages/api/film/project.js`, `projectStore`/`browserProjectStore`. `serializeNodes` keeps grouping fields, drops transient/base64. |
| Library index | `~/.modelark-starter-kit/film-agent-library.json` (max 400, deduped by `assetId`/`url`, stores `thumb`). |
| Client overrides | localStorage: `film-agent-suite-config`, `film-agent-prompt-overrides`. |

---

## 10. Roadmap / deliberate non-goals (v1)

- **Not built (by request):** SSE streaming, multi-tenancy, safety/repeatability layer, DSL,
  recipe library, model deployment. Kept lean.
- **Open:** browser-loadable persistent URL for uploads (public bucket or `GetAsset` served URL) to
  remove the §5 cross-session boundary; richer L5 tracing export.

---

### File index (quick map)

```
utils/film/
  agents.js                 L4 binding: agent registry + run() adapters (refUrl)
  suiteConfig.js            ROOT_CONFIG + 3-layer resolver + prompt re-exports
  promptTemplates.js        DEFAULT_TEMPLATES + override store
  canvasModel.js            node helpers, stageLocalAsset, makeThumbnail, serializeNodes
  libraryStore.js           library client
  projectShape.js           project schema + migration
  imageSizes.js             Seedream (tier × ratio) → WxH resolver
  core/
    operations.js           L1 pure agent operations
    director.js             L1 Auto Director ops (understand/plan/qc)
    client.js               browser transport (→ /api/*)
    directClient.js         headless transport (→ ModelArk)
  server/
    runStore.js             L2 in-memory runs + executor
    registerAsset.js        shared Assets API CreateAsset (presigned ingest)

components/film/
  FilmAgentPlayground.js    project lifecycle + canvas mount
  PromptSettings.js         root-settings drawer
  canvas/                   FilmCanvas + nodes/panels/rail/menu/timeline/icons/library
    AutoPlanNode.js         Auto Director canvas element (plan stepper + review)
    AutoDirectorPanel.js    Auto Director arm/disarm side panel
    AutoDirectorContext.js  plan + actions provider for the node

pages/api/
  film/imagine|location|upload|preserve|library|project|stage|stitch
  seed | seedance | seedance-status
  v1/runs/index | v1/runs/[id]/index      L2 Service API

sdk/                        L3 @modelark/film (index.ts, types.ts, README)
```
