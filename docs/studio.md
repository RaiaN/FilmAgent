# Studio: the harness makes a film with you, step by step

A film goes through four stages, always on top of the screen:

**1 Script → 2 Cast & World → 3 Scenes → 4 Cut**

The stage fills the screen; the crew panel sits beside it (Crew in the header hides it). Above the composer is **the next step**: one button, the one thing to do now. Press it and the job runs, or what waits for you opens.

| Stage | The steps | What you see |
|---|---|---|
| **Script** | your idea or screenplay → the Writers' screenplay → the AD's shot list | the screenplay as a page beside the shot list |
| **Cast & World** | Casting draws a plate for everyone and everywhere → you pick | big plates: Cast, Places, Props |
| **Scenes** | the Designer's views → the Camera's 480p drafts, or your performance footage and a VFX edit → you circle a take | every scene as a big picture; a scene is a monitor with its takes, its cast and its beats |
| **Cut** | the rough cut from the circled takes → each scene's Final at full resolution → the cut again | the film over its timeline |

**Generations** (in the header) shows every render.

Three rules hold everywhere:

1. **Agents do the work.** The next step, or `@Agent [words]` where you stand. That agent does its one job at once and delivers versions into one place.
2. **You review.** Every version an agent delivers waits for your verdict: **Pick** (Circle a take), **Note** (an edit of that version) or **Reject**.
3. **Everything an agent makes can be edited from your words.** A note in the viewer edits the version you look at; words without an `@` edit what you stand on. Either way the edit is a new version of that output, its parent the one edited, and only what the words touch changes (`editorFor` / `talkerFor` in `crew.js`). A change the checks refuse gets one corrective re-ask; what is still refused is said on the reply ("Not applied: …"), which never claims it.

Nothing runs by itself: every job starts when you press it or ask for it.

### The guide

`utils/film/studio/guide.js` reads the next step from the film as it stands; it stores nothing. A step is a crew job (`run`), versions waiting for you (`review`), a job that needs your words (`say`: the `@` goes in the composer), your own words on the page (`write`) or a scene's circled drafts at full resolution (`final`).

- **Where you stand comes first:** what is open on this shot, this scene, this stage; else the film's next step, and pressing it takes you there.
- **A render never holds up the rest:** while one scene renders, the next step is the next scene's; what comes back waits for you there.
- **The Script holds up what stands on it:** Cast & World and Scenes open once the shot list is picked. A film started from footage has no Script to wait for. A script changed after the film was laid out asks for a new list and holds nothing up.
- **A shot drafts once what rides on it is settled:** no plate of it rendering or waiting for you.
- **The rough cut comes first:** the cut opens when every shot has a circled take, in 480p. Finals follow once the cut holds, and a new circled take asks for the cut again.
- **Your performance:** a clip dropped on a shot's monitor is a circled take of that shot; the next step is its VFX edit, from your words.

| | |
|---|---|
| **Version life** | `running → review (new) → picked`, with siblings and the pick it replaces becoming `kept` · `rejected` · `failed` |
| **Who moves it** | Only the crew creates and finishes versions. Only you pick, note or reject them. Your own footage and images arrive already picked. |

---

## 1. The agents and their contracts

Each job is a contract, declared once in `crew.js`: where it works, what it delivers in one line (shown in the @ menu), and where that lands. The harness refuses a delivery anywhere else.

| @ | Where | Delivers | Lands in |
|---|---|---|---|
| **Writers** | Script | a screenplay of your idea (one call; code checks sluglines) | the Script |
| **AD** | Script | the shot list: every scene (code, from the sluglines) and its shots — one line each, where the camera is and what we see — with the film's people listed once each; a scene that fails its checks is listed with its error and no shots (`@AD` there plans it again) | the Script |
| **AD** | Scene | that scene's shots again, from its own words (one take: its views are the shots; landmarks, start, end and what everyone looks at fold away under Details) | the scene |
| **Casting** | Cast & World | a plate for everyone in Cast & World without one, under their exact names; with nobody waiting, the film's cast from the script | each element |
| **Casting** | a character | 2 variations (an anchor first if it has no plate) | that element |
| **Designer** | a place or prop | 2 variations | that element |
| **Designer** | Scene | the views its blocking needs, each an edit of the place's picked plate | each view |
| **Camera** | Scene · shot | a 480p draft of each shot; at a scene, a shot whose draft still waits for you is skipped | each shot |
| **VFX** | Shot | an edit of the circled take — only what you name changes | the shot |
| **Editor** | Cut | the circled takes, in order, as one cut | the cut |
| **Cast & World** (no `@`) | Cast & World · an element | an answer; told to, it renames, re-describes, adds or removes people, places and props (nothing in a shot is removed), and edits pictures — an image edit of that element's plate, a new version waiting for you. A new look edits the description and the picture together. Undo on the reply for names and descriptions. | each element |
| **Editor** (no `@`) | Cut | an answer; told to, it reorders or drops shots and assembles the cut again — a new version, its parent the cut edited | the cut |
| **Script** (no `@`) | Script · scene | an answer; told to, it rewrites the screenplay or a scene's shots at once (Undo on the reply). At a scene it is that scene's shots. A scene's new shots are a new picked blocking; its shot is made from them. | — |
| **Shot** (no `@`) | Shot | an answer; told to, it rewrites its own text and references at once (Undo on the reply). Watches the latest take. | — |

**Buttons, not @:** *Final* on a draft (the same picture in MOV on the model that drafted it — 2.5: 1080p · Premium: 1080p or 4K — within the draft's 7 days) and *Draw again* on a Casting plate (the plate from its edited prompt).

**Resolution (no guessing):**

| You write | The crew does |
|---|---|
| `@Camera slower push-in` | its job here, with your words |
| `@Casting` where it has no job (e.g. on a place) | says it has nothing to do here |
| no `@`, a shot selected | the **Shot** answers, or changes its text and references |
| no `@`, at the Script or a scene | the **Script** answers, or changes the screenplay or the scene's shots |
| no `@`, at Cast & World or on one of it | **Cast & World** answers, or changes itself |
| no `@`, at the Cut | the **Editor** answers, or re-cuts |
| no `@`, anywhere else | asks "Who's this for?" |

**What landing does when you pick:**
- a screenplay becomes the script (your text stays as a version of the brief);
- the shot list lays the film out: every scene (slugline, place, the scene's words, who is in it) with its shot, and every person and place it names becomes an element without a plate;
- a scene's blocking becomes the scene's shot (a shot blocked before keeps its takes), gives the place its landmarks, and makes each view an element of the place; people and props without a plate become elements;
- anything else becomes its container's choice.

**A scene is one take.** The AD blocks a scene from its own words with the plates of who is in it; a place blocked before keeps its landmarks, and the scene before in the same place hands over its end frame. In every beat each person's eyes are on something in the scene — never the lens.

**Video model.** The film drafts on Seedance 2.5 or Seedance 2.5 Premium (header select); a shot can pick its own (*Drafts on* on the selected shot).

## 2. Review

- **The crew panel** shows each delivery as it works — the stage it is on and how long, with **Stop** — and then its versions with ★ (pick) and ✕ (reject) right on them.
- **The viewer** opens any version full screen: compare with the current pick, every version of it, what the checks found wrong, its inputs and prompt, the shot's references, a Casting plate's prompt (*Draw again*), and the verdicts — Pick, a note to whoever made it, Final, Reject. After a verdict it moves on to the next new version.
- **"N new"** in the header opens the viewer on the oldest version waiting for you; each stage shows how many wait in it.
- **The stages** show the film as it stands: picked plates, circled takes, the shot list beside the screenplay, a scene's monitor. A new version shows where it landed with a NEW badge.
- **Generations** shows every render, running and finished; any card opens the viewer.

---

## 3. The harness

**Every job is two functions over one shared harness `h`:**

```
plan(h, request)          → ask | go(payload, summary)
run(h, request, payload)  → versions
```

| Part | Does | Phase |
|---|---|---|
| **read** | the context: the shots in reach, their text for the model, the plates in `[Image N]` order, the previous take and its last frame | both |
| **guard** | stops with an error that names the fix | both |
| **think** | one planner or vision call through a crew skill step (free) | both |
| **each** | a scene-wide job over its shots, a few at a time; nothing more starts after Stop | both |
| **step** | the stage the job is on, shown live in the feed | both |
| **ask / go** | a question whose options are requests · go with what the run will make ("3 drafts · 24 s") | plan |
| **make** | the engines: Seedream images, Seedance takes (start → poll), finish a draft, stitch; registers sources and references as assets | run |
| **check** | flags a result against what was promised (plates sent, dialogue kept, clip watched…); retries once, never patches silently | run |
| **open** | starts a version in a container the contract names and announces it in the thread; it ends `done` (new) or `failed`; a stopped version stays stopped | run |
| **reply · reviseShot** | the Shot's answer in its thread; its own text and references changed, what they were kept on the reply for Undo | run |

**The rules hold by construction:**
- A plan gets no `make` or `open`; a run gets no `ask`.
- Every `make` happens inside an opened version, in a container the contract names.

### Each job, in harness parts

| Job | think | make | check |
|---|---|---|---|
| Writers | idea → screenplay | — | sluglines |
| AD · shot list | the people once each (low effort), then every scene blocked — scenes in one place one after another (shared landmarks, the end frame before), places side by side | — | every name is the script's and nobody is listed twice; per scene as AD · block |
| AD · block | one call: the scene's words + landmarks + the end frame before + plates | — | 4–15 s, landmarks, 1–3 views, every beat on a listed view with a gaze target that is never the lens, start and end |
| Casting · cast | cast plan (in `plan`) | images | every element waiting comes back under its exact name (one corrective re-ask, then an error naming the missing ones); a plate that didn't render |
| Casting · draw again | — | images from the edited prompt | — |
| Casting · recast / Designer · redesign | — | image edits (an anchor first if there's no plate) | per image |
| Designer · views | — | image edits of the place plate | — |
| Camera · draft | prompt composed from the shot's text against its plates (and, for a continuing shot, the previous shot's last frame) | 480p take | references sent; no unasked toward-the-lens wording |
| Final (button) | — | the draft at a resolution its model offers, MOV | a resolution its model doesn't offer is an error naming the ones it does |
| VFX · edit | watch the clip, then write the change | 1080p MOV edit | written without watching; scope closed |
| Editor · assemble | — | stitch | take count |
| Cast & World · talk | one low-effort call: message + every element (kind, description, picture or not, shots it is in) + conversation → reply, changes, additions, removals, pictures | images (one edit per picture) | names are the film's or new and free; kinds; nothing in a shot is removed; a new look for something with a picture edits the picture too (one re-ask) |
| Editor · talk | one low-effort call: message + the cut's order + every circled shot → reply, new order | stitch | only circled shots, none twice |
| Script · talk | one low-effort call: message + screenplay + the shot list (or the scene's shots) + conversation → reply, new screenplay, changed scenes | — | a new screenplay keeps sluglines; a changed scene is the film's, 1–6 shots (the AD plans with 1–4), each on a known camera position or one that says where it stands, eyes never on the lens unless asked — what fails is reported on the reply, not applied |
| Shot · talk | one low-effort call: message + text + references + Cast & World + conversation + latest take (video) → reply, new text, adds, removes | — | adds only from Cast & World, removes only its own; every element the new text names rides as a reference |

**Adding an agent** (Sound, say) takes three things: its contract in `crew.js`, a `{ plan, run }` entry in `runners.js`, and its crew skill.

---

## Around the two

- **Canvas work is mirrored in automatically.** Plates become elements and SHOT cards become shots with their takes. It's a merge, so what you change in the Studio stays.
- **Stale.** A circled take made with an earlier cast or place says so on its shot: *Shoot again* or *Keep*.

**Open:** no note route for the cut; staleness tracks cast and places only; no Sound agent; shots can't be reordered; work other than takes in flight does not survive a reload.

## Code

| What | Where |
|---|---|
| Versions, scenes, elements, the Canvas mirror | `utils/film/studio/model.js` |
| The contracts and the @ parser | `utils/film/studio/crew.js` |
| The harness | `utils/film/studio/harness.js` |
| Each job's plan and run; what picking lands | `utils/film/studio/runners.js` |
| The next step and the stages | `utils/film/studio/guide.js` |
| The stages (pages + crew panel) · the viewer · Generations | `components/studio/` |
