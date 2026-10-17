<p align="center"><img src="docs/media/hero.png" alt="FilmAgent — idea in, film out"></p>

<p align="center"><img src="docs/media/pipeline.png" alt="Idea → Story Room → Cast & World → Storyboard → Previz → Shot → Edit → Final cut"></p>

## Development

<img src="docs/media/story-room.png" alt="Story Room: one line becomes a story, a beat sheet and a shot list">
<img src="docs/media/mood-board.png" alt="Mood Board: find the look before you shoot">

## Pre-production

<img src="docs/media/cast-world.png" alt="Cast & World: identity plates for every character, place and prop">
<img src="docs/media/character-variations.png" alt="Character Variations: new looks, same face">
<img src="docs/media/location-variations.png" alt="Location Variations & Coverage: one place, every angle and hour">
<img src="docs/media/storyboard.png" alt="Storyboard: one row per shot, with its opening frame">
<img src="docs/media/tech-scout.png" alt="Tech Scout: clean background frames from an empty location">
<img src="docs/media/previz.png" alt="Previz: blocking, blockout animatic, motion reference">

## Production

<img src="docs/media/shot.png" alt="Shot: prompt and references in, takes out">
<img src="docs/media/video-edit.png" alt="Video Edit: keep the shot, change what you name">

## Post-production

<img src="docs/media/audio.png" alt="Audio: dialogue, ambience and effects from one prompt">
<img src="docs/media/final-cut.png" alt="Final Cut: circle takes, render a 10-bit movie">

## Tools

<img src="docs/media/tools.png" alt="Tech Test, Headroom, Video Enhance, Verify">

## Run it

```bash
git clone git@github.com:RaiaN/FilmAgent.git && cd FilmAgent
npm install
cp .env.example .env.local   # your ModelArk key, model endpoints, TOS bucket
NODE_USE_SYSTEM_CA=1 npm run dev
```

Open http://localhost:3000. Deploying for a team: [DEPLOYMENT.md](DEPLOYMENT.md).

<sub>Images are illustrations, drawn in code: `npx electron docs/art/render.js`</sub>
