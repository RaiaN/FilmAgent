# Wizard archive (not wired into the app)

These files are the **linear checkpoint-gated wizard** that the Film Agent tab used
before the canvas + layers redesign. Nothing in the active app graph imports them —
they are kept here as a reference implementation to be reconstituted as **canvas
agent layers**, not deleted.

## What's here

| File | Was | Becomes (future layer) |
|---|---|---|
| `StageEditor.js` | Generic per-stage Generate / Edit / Approve UI | Screenwriting layer panel |
| `StageDraftView.js` | Structured renderers for logline / treatment / script / style | Screenwriting layer node renderers |
| `CharacterBible.js` | Per-character 3-step pipeline (portrait → close → full body) via `/api/production-design`, style-enriched prompt | Reference-Sheets layer |
| `LocationBible.js` | Per-location establishing plate via `/api/film/location` | (folds into Location Variations / Coverage layer) |
| `stageStore.js` | Pure stage/bible state helpers extracted from `utils/film/projectStore.js` | Screenwriting + Reference-Sheets layer state |

## Still-live dependencies (intentionally NOT archived)

The wizard's API routes are kept under `pages/api/film/` because the future layers
will reuse them:

- `pages/api/film/stage.js` — Seed 2.0 Pro logline/treatment/script/style generation
- `pages/api/film/location.js` — Seed 2.0 Pro → Seedream establishing plate
- `utils/film/promptBuilders.js` — system/user prompt builders for the story stages

## Reconstitution plan

When building the **Screenwriting** layer: lift `StageEditor` + `StageDraftView` +
the story-stage helpers from `stageStore.js`, and emit each approved stage as canvas
asset/text nodes instead of wizard cards.

When building the **Reference-Sheets** layer: lift `CharacterBible`'s
`buildEnrichedPrompt` + the `/api/production-design` call, triggered on a selected
character asset, dropping the portrait + sheets as locked canvas nodes.

The current project data model is canvas-native (`utils/film/projectShape.js`, v2);
`migrateProject()` already converts any old v1 wizard `project.json` into the canvas
shape, so these archived components cannot be re-mounted as-is against current data.
