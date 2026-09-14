# CLAUDE.md — Blender Crowd Blockout

Cubes crossing a floor with goal-seeking + repulsion. Output: MP4. Nothing else yet.

## Run

```bash
blender -b -P crowd_blockout.py -- --agents 100 --frames 250 --seed 7
```

Result: `render/blockout0001-0250.mp4` (Blender appends the frame range).

## The sim (per frame, per cube)

```python
accel  = (normalize(goal - pos) * speed - vel) / 0.5   # steer toward goal
accel += repulsion_from_neighbours(pos)                 # push apart, ~1m range
accel += 0.1 * randn(2)                                 # small jitter only
vel    = clamp(vel + accel * dt, max=1.8)
pos   += vel * dt
```

Keyframe positions every frame. Pure random walk doesn't work — cubes jitter in
place and overlap. The goal term is what makes it move; jitter just breaks up
straight lines.

## Render settings

```python
scene.render.engine = 'BLENDER_WORKBENCH'      # instant
scene.render.image_settings.file_format = 'FFMPEG'
scene.render.ffmpeg.format = 'MPEG4'
scene.render.ffmpeg.codec = 'H264'
scene.render.filepath = "//render/blockout"    # stem only, no .mp4
```

## Rules

* No `bpy.ops` in loops — use `bpy.data` to create cubes
* No scipy (Blender's Python doesn't have it) — plain distance checks are fine at 100 cubes
* Script must be re-runnable: delete old cubes before creating new ones
* `--seed` on everything

## Scenarios (addendum)

`--scenario <name>` picks the sim:

| scenario | what happens | typical run |
| --- | --- | --- |
| `clash` (default) | two armies cross the field through each other | `--agents 100 --frames 250` |
| `charge` | horse warrior gallops through a milling crowd; people dive out of the lane (perpendicular flee + heavy horse repulsion), then reform behind him | `--agents 30 --frames 170` |
| `horde` | zombie flood converges on a defended perimeter (aerial plate): sprint-heavy speeds + heavy jitter (staggering), tight packing (0.55m repulsion), every zombie funnels at a barricade GATE then swarms the building DOOR; defender line + door crowd HOLD — they NEVER rout (zombies shove them, home anchors pull back, so the line bends and recovers; braced heading stays facing the horde). The wave is deliberately NON-UNIFORM (a uniform flood reads as gas and Seedance copies that): ~20 clustered packs (near-edge-biased spawn), 40% of packs surge on a 1.5-3.5s delay (successive waves), pack-cohesion springs keep streams braided until the funnel, plus per-pack tempo and 5% sprinters / 8% shamblers | `--agents 600 --frames 250` |
| `arrival` | a rider WALKS his horse in through the town gate along the road (+x, gate at x=−14, ~1.75 m/s → through the gate around t≈6s) while townsfolk stream BOTH ways on BOTH verges, ~35% cut across the road, everyone funnels into the gate gap (`ARRIVAL_GATE_GAP`) and steps off the road when the horse is on them (light shoulder repulsion, walkers wrap off-screen so the span stays populated). Horse green + rider blue = bound hero colours (never recoloured); walkers get unique hues. ONE continuous tracking shot; renders as an unlit MASK plate by default (`--colorize id`: flat solids on black, dark architecture) | `--frames 240` (10s; defaults) · `--colorize film` for the shaded look |
| `castle` | a castle bailey, staged per camera preset (`STAGES`): **medium** (default) = eye-level 50mm group shot — the five heroes in a ~5m band 7-9m out, ~14 extras 13-18m back by the stalls and keep (depth for a bokeh pass); **wide** = the whole bailey: dense NON-UNIFORM background crowd — milling packs whose homes drift, gate traffic arriving/leaving on staggered releases, an audience fanned in front of the dais — plus FIVE solid-colour HERO actors, each with its own behaviour and each reacting to what is in front of it: blue **sentry** patrols inside the gate and halts to face anyone who steps within 1.7m ahead; green **herald** stands on the dais, turns to the centroid of his audience, arm-gesture cycle; yellow **porter** carries a crate on a loop and stops to look at whoever blocks his path; red **noble** strides the yard corner to corner — extras step aside perpendicular to his line; purple **petitioner** crouches by the noble's route, rises and faces him as he passes, sinks back once he's gone. Idle extras face the nearest hero (audience effect). Extras walk around stalls/well/dais/cart | `--frames 250` (medium, 14 extras) · `--camera wide --agents 260` |

`charge` builds a horse (long dark box) with a rider cube parented on top; the
horse uses the same steering law with gallop numbers and ignores crowd repulsion.
`horde` adds static props via `bpy.data` (building blockout + barricade row with
a gate gap), a lawn-green floor, and per-zombie muddy grey-green colours.

## Cameras (addendum)

`--camera <preset>` picks the shot; same seed = same take, so different presets
cut together as coverage. Presets are per scenario.

Clash — static coverage:

| preset | angle |
| --- | --- |
| `high45` | elevated 3/4 crane (default) |
| `side` | long-lens ground-level side profile |
| `overhead` | top-down tactical |
| `low` | ground-level wide, in the dirt |

Charge — CINEMATIC one-take shots, all tracking the horse, all with handheld
shake that ramps as the horse closes on the lens (proximity-driven), rendered
2.39:1 scope by default. Climax timing: impact ~3s, blast-through ~4-5s.

| preset | shot |
| --- | --- |
| `headon` | planted past the far edge of the mob, 60mm down the lane, just over head height (default). Telephoto compression: the rider grows over a sea of heads, the crowd parts, he skims the lens with a whip-pan |
| `chase` | riding with the charge — low, 30mm, over his flank, crowd scattering ahead |
| `crowdpov` | eye height inside the mob, 2.4m off the lane; bodies whip past the lens, whip-pan as he blasts through |
| `cranedive` | opens high and wide, smoothstep-dives to eye level timed to the impact |

Horde — aerial plates (no single subject: fixed aim + drifting smoothstep paths,
constant gentle shake):

| preset | shot |
| --- | --- |
| `aerial` | helicopter wide from behind the flood, slow push-in — building top of frame, horde pouring across the lawn (default) |
| `reveal` | opens at eye level behind the barricade facing the horde, cranes up and back over the building to reveal the scale |

Arrival — one continuous take, every preset follows the rider (`follow` offset +
smooth aim, gentle handheld):

| preset | shot |
| --- | --- |
| `lead` | retreats 11m ahead of the rider at his walking pace, 35mm at chest height, looking back at him (default): opens inside the gate passage looking out at the approaching rider framed by the towers, backs into the town as he comes through; walkers cross between lens and rider |
| `side` | lateral dolly on the verge, 45mm — horse and rider in profile against the gate |

Castle — each preset names its STAGE (paths = slow eased push, no shake):

| preset | shot |
| --- | --- |
| `medium` | eye-level 50mm group shot (default), slow dolly-in: petitioner frame left, herald raised on the dais behind, noble crossing from the right, sentry + porter frame right; extras small and far for bokeh |
| `quiet` | locked-off frontal 50mm at chest height: four heroes stand in a row 9m out facing the lens (petitioner crouched, noble, sentry, porter with crate — viewer L→R), herald stands on the dais 16m back, ten extras stand 20-25m back by the cart and keep. NOBODY moves; a small cat (box body + head + tail) enters frame left, sits mid-frame looking at the row, walks off right. Built by `simulate_quiet` (no sim). Run with `--frames 360` for a 15s plate |
| `wide` | from above the gatehouse looking down the yard to the keep: gate towers frame the lower corners, sentry at the lens, herald's dais mid-frame |
| `reverse` | from the keep roof back toward the gate — traffic streaming in |
| `gate` | eye level in the gate gap, 35mm — the crowd as a wall of bodies |

## Colour binding (castle) — one colour = one identity

The five heroes wear the canvas mask-plate order **blue / green / yellow / red /
purple**, every part of a hero (body, head, arm, crate) in that one colour, and
`--colorize` never recolours them — so the same colour means the same person in
the film plate AND the ID pass. Bind each colour to a cast member in the prompt
("the figure in blue is the sentry, wearing …") and each colour becomes one
outfit. Extras are deliberately MUTED earth tones (varied, a few child-sized) so
only the five colours read as identities.

## Crowd density & diversity — what to feed Seedance

* Density is spatial, not a number: the plate carries it (packs shoulder to
  shoulder at the stalls, loose knots by the walls, a stream at the gate). In the
  prompt describe the DISTRIBUTION, never a count.
* Diversity against identity collapse: the `id` pass gives every extra a unique
  hue — a per-figure distinctness signal the model can follow — and the prompt
  names CLASSES (ages, builds, trades, cloth colours), not individuals.
* Named foreground actors ride the colour binding above; everything else is
  "the crowd". Don't choreograph extras — specify the world and let the model
  simulate it (world-model doctrine).

Output stem defaults to `render/blockout_<scenario>_<camera>` (plus
`_<colorize>` for ID passes). Extra flags: `--fps 24`, `--res WxH` (default
1280x720 clash+castle / 1280x536 charge+horde), `--out <stem>`, `--still <frame>`
(single PNG preview instead of the MP4).

## Colorize / ID passes (addendum)

`--colorize` renders control-signal variants (unlit FLAT shading, black floor
and background, dark props, packless agents white): `id` = unique hue per agent
(golden-ratio hue stepping — unique GRAYS don't survive 8-bit H.264 at 600
agents, hues do), `cluster` = one hue per horde pack, `gray` = evenly spaced
grey ramp per pack. `film` (default) = the shaded look.

On this machine `blender` is not on PATH — use
`/Applications/Blender.app/Contents/MacOS/Blender`.

## Keyframe-flash pass (addendum)

`keyframe_flash.py` post-processes any rendered MP4 into a sparse-keyframe
version: N evenly spaced real frames (first + last included), all frames
between them pure black; duration/fps/res unchanged. Plain python3 + ffmpeg,
no Blender:

```bash
python3 keyframe_flash.py render/blockout_horde_aerial0001-0250.mp4 --keys 12
```

Output: `<input>_keyflash<N>.mp4`.

## Later, not now

Real characters, animation cycles, Geometry Nodes, EXR passes, plate matching.
