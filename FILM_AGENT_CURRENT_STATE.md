# ModelArk StarterKit Film Agent: Current Implementation

This document describes how the Film agent in `ModelArk StarterKit` works today, based on the current code in this repository.

## What It Is

The Film agent is a guided, checkpoint-based workflow inside the main Next.js app. It turns a short film idea into a series of approved artifacts:

1. `logline`
2. `treatment`
3. `script`
4. `style`
5. `characters`
6. `locations`

The code also defines later stages:

1. `shotlist`
2. `shots`
3. `final`

Those later stages are modeled in state and shown in the UI, but they are not implemented yet.

## High-Level Architecture

The current Film agent is split across four layers:

1. `pages/index.js`
   Mounts the Film Agent tab inside the main application shell.
2. `components/film/*`
   Renders the Film agent UI, stage editors, and character/location bible screens.
3. `utils/film/*`
   Defines stage order, unlock rules, local project helpers, and prompt builders.
4. `pages/api/film/*` plus `pages/api/production-design.js`
   Persists projects and calls ModelArk APIs for text and image generation.

In practice, the Film agent is a local-project workflow with human approval between every major step.

## User Entry Point

The Film agent appears as the `film-agent` mode in the main app:

- `pages/index.js` adds a Film Agent tab to the sidebar and top button group.
- When that mode is active, it renders `components/film/FilmAgentPlayground.js`.

The top-level form for this mode comes from `utils/schemas.js` and currently asks for:

- `idea`
- `language`
- `targetMinutes`

Default runtimes are limited to `3`, `4`, or `5` minutes.

## Main Runtime Flow

### 1. Start or Open a Project

The Film agent does not work as a purely in-memory session. It is built around a project folder on disk.

From `FilmAgentPlayground.js`, the user can:

- create a new project folder
- open an existing project folder
- reopen a recent project

In browser mode, folder selection is done by asking the user to paste an absolute path. In Electron, there is a native folder picker exposed through:

- `electron/main.js`
- `electron/preload.js`

### 2. Create `project.json`

When a new project is created, `pages/api/film/project.js`:

- validates the absolute path
- creates the project folder if needed
- creates an `assets/` folder
- writes a `project.json` file
- stores a recent-project entry under:
  `~/.modelark-starter-kit/film-agent-recent.json`

The initial project shape includes:

- project metadata: `id`, `title`, `language`, `targetMinutes`, `idea`
- draft/approved state for story stages
- item-list state for character and location bibles
- placeholder state for later stages

### 3. Generate One Stage at a Time

For the story stages (`logline`, `treatment`, `script`, `style`), the UI uses the shared `StageEditor` component.

The flow is:

1. User opens an unlocked stage.
2. User optionally adds director notes.
3. UI posts to `/api/film/stage`.
4. Server selects the stage-specific prompt builder.
5. Server calls ModelArk `/responses`.
6. Returned JSON is parsed and saved as the stage draft.
7. User reviews, optionally edits raw JSON, and approves.

Only approved upstream stages are sent into the next stage request.

### 4. Unlock the Bible Stages

Once `style` is approved, the Film agent unlocks:

- `characters`
- `locations`

These are not single JSON documents. They are item lists derived from the approved script.

When the script becomes approved, `syncBibleItemsFromScript()` rebuilds the character and location lists from the script while trying to preserve any previously generated work.

### 5. Generate Character and Location Assets

Characters and locations each have their own UI and API pipeline:

- `CharacterBible.js` -> `/api/production-design`
- `LocationBible.js` -> `/api/film/location`

Each item is generated independently, reviewed independently, and approved independently.

## Stage System

The stage model lives in `utils/film/projectStore.js`.

### Story Stages

These are the linear single-document stages:

- `logline`
- `treatment`
- `script`
- `style`

Each one stores:

- `status`
- `draft`
- `approved`
- `history`

### Bible Stages

These are list-based stages:

- `characters`
- `locations`

Each stores:

- `status`
- `items`

Each item has its own status such as:

- `empty`
- `generating`
- `draft`
- `approved`
- `failed`

### Unlock Rules

Unlock rules are hardcoded in `STAGE_PREREQS`:

- `treatment` requires `logline`
- `script` requires `logline` and `treatment`
- `style` requires `logline`, `treatment`, and `script`
- `characters` and `locations` require `logline`, `treatment`, `script`, and `style`
- `shotlist` is defined as requiring all prior stages
- `shots` requires `shotlist`
- `final` requires `shots`

The UI enforces those rules by showing locked stages until prerequisites are approved.

## Approval Model

Approval is the main control mechanism in the current implementation.

Important behaviors:

- downstream generation only receives `approved` upstream artifacts
- a generated stage is initially stored as `draft`
- the user can edit raw JSON before approval
- approving a stage copies `draft` into `approved`
- if an already approved stage is edited, the edit immediately replaces the approved content

This makes the workflow intentionally human-in-the-loop rather than fully autonomous.

## Persistence Model

Projects are saved to disk through `/api/film/project`.

### Saved Files

For each project folder, the Film agent currently creates:

- `project.json`
- `assets/`

At the moment, the implemented film flow mostly persists structured state in `project.json`. The code prepares an `assets/` directory, but the character and location generation responses currently store remote image URLs in project state rather than writing local asset files into that folder.

### Auto-Save

`FilmAgentPlayground.js` auto-saves whenever the in-memory project changes:

- waits 400 ms after a change
- POSTs the full project to `/api/film/project?action=save`
- updates `updatedAt`
- refreshes recent-project metadata

This means stage approvals, draft changes, and bible item updates all persist automatically.

## Prompting and Generation

### Story Stage Generation

Story-stage prompt construction lives in `utils/film/promptBuilders.js`.

There are currently four prompt builders:

- `buildLoglineSystem` / `buildLoglineUser`
- `buildTreatmentSystem` / `buildTreatmentUser`
- `buildScriptSystem` / `buildScriptUser`
- `buildStyleSystem` / `buildStyleUser`

Common prompt behavior:

- all prose should be written in the selected project language
- JSON keys remain in English
- the model must return a single JSON object only
- `null` is disallowed; empty strings or arrays are expected instead

`pages/api/film/stage.js` then:

- chooses the builder based on `stage`
- appends optional director notes
- calls ModelArk `/responses`
- extracts text from the response payload
- attempts flexible JSON parsing
- stores both parsed JSON and raw text

The current story-stage model is hardcoded to:

- `seed-2-0-pro-260328`

### Character Bible Generation

Character generation is implemented as a 3-step pipeline in `pages/api/production-design.js`.

### Inputs

`CharacterBible.js` builds an enriched character prompt from:

- script-derived character metadata
- approved style bible data such as lens, format, palette, lighting, and framing rules

### Pipeline

The API route runs:

1. Seed 2.0 Pro prompt synthesis for a portrait anchor
2. Seedream image generation for that portrait
3. Seed 2.0 Pro prompt synthesis for a close character sheet using the portrait as reference
4. Seed 2.0 Pro prompt synthesis for a full-body character sheet using the portrait as reference
5. Seedream image generation for the close sheet
6. Seedream image generation for the full-body sheet

Returned outputs include:

- portrait image URL
- close sheet image URL
- distant/full-body sheet image URL
- prompt trace data

The current image generation model is hardcoded to:

- `ep-20260501195034-hj78f`

### Location Bible Generation

Location generation is handled by `pages/api/film/location.js`.

### Inputs

`LocationBible.js` sends:

- selected project language
- the individual location item
- approved style bible

### Pipeline

The API route runs:

1. Seed 2.0 Pro to convert the location description plus style bible into a single bracketed Seedream prompt
2. Seedream to render one establishing plate

Location generation is explicitly constrained to:

- no people in frame
- no text
- no letters, numbers, logos, or watermarks

Each location item stores:

- rendered image URL
- synthesized prompt
- generation status
- last error, if any

## Current Data Dependencies

The current implementation depends on approved artifacts in this order:

- `idea` seeds the `logline`
- approved `logline` seeds the `treatment`
- approved `logline` and `treatment` seed the `script`
- approved `logline`, `treatment`, and `script` seed the `style`
- approved `script` seeds character and location item lists
- approved `style` is injected into character and location rendering

This means the Film agent is not a free-form planner. It is a checkpointed expansion pipeline.

## UI Components and Responsibilities

### `FilmAgentPlayground.js`

Owns:

- project lifecycle
- active stage selection
- auto-save
- stage generation requests
- approval transitions
- syncing character/location items from script

### `StageEditor.js`

Owns:

- story-stage generate/regenerate button
- optional director notes input
- approve button
- raw JSON editing modal

### `StageDraftView.js`

Owns read-only presentation of structured drafts for:

- logline
- treatment
- script
- style

### `CharacterBible.js`

Owns:

- per-character edits for description and voice timbre
- one-item-at-a-time generation
- one-item-at-a-time approval
- previewing portrait and sheet images

### `LocationBible.js`

Owns:

- per-location edits for description and time of day
- one-item-at-a-time generation
- one-item-at-a-time approval
- previewing the location plate

## API Requirements

Generation routes require an API key.

The code resolves it in this order:

1. API key sent from the UI
2. `MODELARK_API_KEY`
3. `ARK_API_KEY`

The base URL comes from:

- request `baseUrl`, if provided
- otherwise `CONFIG.API_BASE_URL`

`CONFIG.API_BASE_URL` is read from:

- `process.env.MODELARK_API_BASE_URL`

If no API key is available, generation fails.

## Runtime Environment

The application runs primarily as a Next.js app, with optional Electron desktop packaging.

From `package.json`:

- `npm run dev` starts Next.js
- `npm run dev:desktop` runs Next.js plus Electron
- `npm run build:desktop` packages the desktop app

Electron currently matters to the Film agent mainly because it provides a native folder picker for project creation and opening.

## Current Limitations

As of the current codebase, the Film agent is incomplete in several important ways:

1. `shotlist`, `shots`, and `final` are modeled but not implemented.
2. There is no end-to-end film generation after characters and locations.
3. Character and location assets are not written into the local `assets/` folder by the current code.
4. Model IDs are hardcoded in the API routes instead of being user-configurable.
5. Error handling is mostly request-level and per-item UI messaging, not a resumable job system.
6. Recent projects are local to the machine because they are stored under the user's home directory.
7. There is no dedicated standalone Film agent README in the repository before this document.

## What "Working Currently" Means

Today, the Film agent is best understood as:

- a structured story-development tool
- a local project manager for short-film preproduction artifacts
- a prompt-and-approval workflow for script, style, characters, and locations
- a partial implementation of a larger idea-to-film pipeline

It does not yet produce shot lists, rendered shots, audio, edit decisions, or a final exported film.

## Key Files

These are the most important files to read if you want to modify the current Film agent:

- `pages/index.js`
- `utils/schemas.js`
- `components/film/FilmAgentPlayground.js`
- `components/film/StageEditor.js`
- `components/film/StageDraftView.js`
- `components/film/CharacterBible.js`
- `components/film/LocationBible.js`
- `utils/film/projectStore.js`
- `utils/film/promptBuilders.js`
- `pages/api/film/project.js`
- `pages/api/film/stage.js`
- `pages/api/film/location.js`
- `pages/api/production-design.js`
- `electron/main.js`
- `electron/preload.js`

## Summary

The current Film agent in ModelArk StarterKit is a human-gated, local-project workflow that:

- starts from a short idea
- generates approved story artifacts in sequence
- derives structured character and location lists from the approved script
- generates visual reference assets for those items
- persists all progress to `project.json`

The code clearly anticipates a fuller film pipeline, but the implemented scope today ends at story development, style locking, and previsual character/location bible generation.
