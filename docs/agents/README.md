# Agent diagrams

One diagram per agent — the flow from input to board artifact, in a shared visual
language:

| Color | Meaning |
| --- | --- |
| Gray | input artifact (your words, an anchor image) |
| Blue | Seed 2.0 Pro reasoning call |
| Teal | generative render (Seedream / Seedance / Seed Audio) |
| Amber | board artifact |

- [pipeline.svg](pipeline.svg) — the whole film pipeline, Brief → Final cut
- [brief.svg](brief.svg) — the Brief node (verbatim container) and its six actions
- [cast-world.svg](cast-world.svg) — Cast & World: brief → tagged identity plates
- [storyboard.svg](storyboard.svg) — text-first shot division, opt-in stills, promote
- [previz.svg](previz.svg) — Previz (blocking): floor plan → projection → SHOT card
- [shot-card.svg](shot-card.svg) — the SHOT card lifecycle through 🎬 and the timeline
- [character-variations.svg](character-variations.svg) — edit-locked character variations
- [location-variations.svg](location-variations.svg) — location coverage variations
- [audio.svg](audio.svg) — Audio: prompt → clip → reference_audio on a shot
- [inspiration.svg](inspiration.svg) — Inspiration Board: prompt → reference imagery

Every generation in these flows is one explicit tap — no agent runs under the hood.
