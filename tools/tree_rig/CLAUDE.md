# CLAUDE.md — Tree Skeletal Rig

Seeded recursive tree skeleton (trunk + a few branches) swaying in layered-sine
wind, rendered to MP4. Motion/structure reference for tree shots — sibling of
`tools/crowd_blockout` and follows the same rules (no `bpy.ops` in loops,
`bpy.data` only, re-runnable via `tree_*` prefix cleanup, `--seed` on
everything, Workbench + H.264, Blender 5.x `media_type` guards both ways).

## Run

```bash
blender -b -P tree_rig.py -- --depth 3 --frames 240 --seed 7
```

Result: `render/treerig0001-0240.mp4` (Blender appends the frame range).
`blender` is not on PATH on this machine — use
`/Applications/Blender.app/Contents/MacOS/Blender`.

## How it works

- `grow()` builds the skeleton: each node forks into 2–3 children, tilted
  22–42° off the parent axis, azimuth-distributed with jitter; length decays
  0.62–0.78 per level, radius 0.62.
- Bones are box meshes with length baked into the mesh (object scaling would
  compound down the parent chain), each parented at its parent's tip — a true
  FK hierarchy. Joint-knob cubes sit at every pivot. Armature bones are not
  used because they don't appear in Workbench renders.
- Wind = gust envelope (0.07 Hz swell) × layered sines (0.4/1.1/2.7 Hz),
  amplitude growing with depth, all phases seeded. Keyframed per frame on
  rotation x/y of every bone.
- Camera auto-frames from the tree's computed reach.

## Flags

`--depth` (3), `--wind` strength (1.0), `--frames` (240), `--fps` (24),
`--seed` (7), `--res` (1280x720), `--out <stem>`, `--still <frame>` (PNG
preview), `--colorize rig|id` — `rig` = shaded bone-white on black (default),
`id` = one hue per primary limb's subtree (correspondence signal, unlit flat).

## Later, not now

Ground plane / environment, leaves-as-cards, trunk bend noise (currently only
joints rotate), camera presets, per-branch flow/tracer passes.
