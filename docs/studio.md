# Studio: the @ syntax and the harness

The Studio is built from two things:

1. **The @ syntax:** how you talk to the film crew, and how the crew answers.
2. **The harness:** what every crew member is made of.

They meet in one noun, the **version**. Every result is a version: a script, a plate, a frame, a take or a cut.
- The harness makes versions.
- Your sentences pick, note or reject them.

| | |
|---|---|
| **Version life** | `running → review → picked` (the one before it becomes `kept`) · `rejected` · `failed` |
| **Who moves it** | Only the crew creates and finishes versions. Only you pick, note or reject them. Your own footage arrives already picked. |

---

## 1. The @ syntax

### You → crew

```
@Agent [words]
```

- **One agent, one job.** No verb: the agent does its job on whatever you're looking at (the brief, Cast & World, an element, a scene, the selected shot, or the cut).
- **The words.** They are for this one job only, e.g. "slower push-in".
- **The shot's own text** (*What happens*) is the shot itself, and every future take is made from it. Only you and the Shot change it: by hand, or by talking to the shot.

**Resolution (no guessing):**

| You write | The crew does |
|---|---|
| `@Camera slower push-in` | its job here, with your words |
| `@Casting` where it has no job (e.g. on a place) | says it has nothing to do here |
| no `@`, a shot selected | the **Shot** answers, or changes its text and references at once (Undo on the reply) |
| no `@`, anywhere else | asks "Who's this for?" |

### You → a version

```
pick v · circle v · reject v · note v [@3.2s] : words · approve sheet · cancel sheet · answer option
```

- **A note is a request to whoever made the version.** The new version's parent is the noted one. A note on an edit is redone from the source with both notes.
- **An answer is a request:** each option the crew offers is itself one.

### Crew → you

```
deliver(versions) · ask(question, options) · sheet(jobs) · fail(what to fix)
```

- **Paid work** (images, video) always comes as a **call sheet** first. Nothing is spent until you approve it.
- **Free work** (planner calls, stitching) just runs.

### The crew

| @ | Job | Where | Paid |
|---|---|---|---|
| **Writers** | develop | brief | — |
| **AD** | break the script down when you press Go on that plan step — numbered scenes (from the sluglines) with length in eighths of a page, one breakdown sheet per scene (cast, extras, props, wardrobe, dressing, special, sound — copied from the scene's words), the film's elements — and keep the plan (Writers → Casting → Block → Drafts → Cut, Go on the next step; the cast step moves through Go → approve the call sheet → rendering → pick the plates in Review, and closes when every breakdown name has a picked plate). Block the film: one scene sheet per scene — place and landmarks, camera views, start, beats (view · action · what everyone looks at), what works against them, sound, end | brief | — |
| **Casting** | faces: cast the film (Cast & World) · recast a character (its element) | Cast & World · character | images |
| **Designer** | places and props: redesign (place · prop) · the views a scene sheet asks for, drawn from the place's plate (scene · shot) | place · prop · scene · shot | images |
| **Camera** | draft takes (480p); a shot marked *Starts where the previous shot ends* starts on that shot's last frame | scene · shot | video |
| **VFX** | edit any take, yours or the crew's: only what you name changes | shot | video |
| **Editor** | assemble the circled takes | cut | — |
| **Shot** (no `@` needed) | talk to the shot: answers questions; when told, rewrites its text and adds or removes references from Cast & World — applied at once, Undo on the reply. Watches the latest take. | shot | — |

At a scene, a shot job runs over every shot that still needs it.

**A scene is one take.** The order: script → Casting → AD blocks → Designer draws the views → Camera drafts from the text and the plates (cast, place, views). A scene the AD marks as continuing opens on the last frame of the scene before. In every beat each person's eyes are on something in the scene — never the lens.

**Video model.** The film drafts on Seedance 2.5 or Seedance 2.5 Premium (header select); a shot can pick its own (*Drafts on* on the selected shot). Camera drafts each shot on its model at 480p.

**Final** is a button, not a crew job: on a draft in Review, or *Final N circled drafts* on a scene. It renders the same picture in MOV on the model that drafted it, at a resolution that model offers — 2.5: 1080p · Premium: 1080p or 4K (one button each) — within the draft's 7 days. A note on a final reworks its draft.

---

## 2. The harness

**Every crew member is two functions over one shared harness `h`:**

```
plan(h, request)          → ask | sheet | go
run(h, request, payload)  → versions
```

### The parts

| Part | Does | Phase |
|---|---|---|
| **read** | the context: the shots in reach, their text for the model, the plates in `[Image N]` order, the look, the previous take and its last frame | both |
| **guard** | stops with an error that names the fix | both |
| **think** | one planner or vision call through a prompt template (free) | both |
| **each** | a scene-wide job over its shots, a few at a time | both |
| **ask / sheet / go** | what a plan returns | plan |
| **make** | the engines: Seedream images, Seedance takes (start → poll), finish a draft, stitch; registers sources and references as assets | run |
| **check** | flags a result against what was promised (plates sent, dialogue kept, clip watched…); retries once, never patches silently | run |
| **open** | starts a version and announces it in the thread; it ends `done` (to review) or `failed` | run |
| **reply · reviseShot** | the Shot's answer in its thread; its own text and references changed, what they were kept on the reply for Undo | run |

**The rules hold by construction:**
- A plan gets no `make` or `open`.
- A run gets no `ask`.
- Every `make` happens inside an opened version.

### Each crew member, in harness parts

| Job | think | make | check |
|---|---|---|---|
| Writers · develop | idea → script | — | — |
| AD · block | one scene sheet per scene | — | verbatim quotes, 4–15 s, places, 1–3 views, every beat on a listed view with a gaze target that is never the lens, start and end; places with no plate |
| Designer · views | — | image edits of the place plate | — |
| Casting · cast | cast plan (in `plan`) | images | a plate that didn't render; every name the plan step asked for comes back under that name (one corrective re-ask, then an error naming the missing ones) |
| Casting · recast / Designer · redesign | — | image edits (an anchor first if there's no plate) | per image |
| Camera · draft | prompt composed from the shot's text against its plates (and, for a continuing shot, the previous shot's last frame); a scene sheet is the authority on what happens | 480p take | references sent; no unasked toward-the-lens wording |
| Final (button) | — | the draft at a resolution its model offers, MOV | a resolution its model doesn't offer is an error naming the ones it does |
| VFX · edit | watch the clip, then write the change | 1080p MOV edit | written without watching; scope closed |
| Editor · assemble | — | stitch | take count |
| Shot · talk | one low-effort call: message + text + references + Cast & World + conversation + latest take (video) → reply, new text, adds, removes | — | adds only from Cast & World, removes only its own; every element the new text names rides as a reference; the sheet's Landmarks / At the start / At the end follow the text |

**Adding a crew member** (Sound, say) takes three things:
- a `{ plan, run }` entry in `runners.js`;
- its jobs in `crew.js`;
- a template.

---

## Around the two

- **Canvas work is mirrored in automatically.** Plates become elements, and SHOT cards become shots of the scene "Board" with their takes. It's a merge, so what you change in the Studio stays.
- **Stale.** A circled take made with an earlier cast or place is flagged stale. You either keep it or shoot it again.

**Open:**
- no note route for the cut;
- staleness tracks cast and places only;
- no Sound crew;
- shots can't be reordered.

## Code

| What | Where |
|---|---|
| Versions, scenes, elements, the Canvas mirror | `utils/film/studio/model.js` |
| The crew and the @ parser | `utils/film/studio/crew.js` |
| The harness | `utils/film/studio/harness.js` |
| Each crew member's plan and run | `utils/film/studio/runners.js` |
| Direct · Review · Generations | `components/studio/` |
