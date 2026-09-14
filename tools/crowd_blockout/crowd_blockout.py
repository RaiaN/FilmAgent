#!/usr/bin/env python3
"""Blender crowd blockout — cubes crossing a floor with goal-seeking + repulsion.

Background plate blockout for war scenes. Two opposing groups of cube "agents"
march across the floor toward the opposite side, weaving through each other.
Output: MP4 (Blender appends the frame range to the filepath stem).

Run headless:

    blender -b -P crowd_blockout.py -- --agents 100 --frames 250 --seed 7 --camera high45

Result: render/blockout_high450001-0250.mp4

Rules honoured:
  * No bpy.ops in loops — cubes are built via bpy.data (one shared mesh).
  * No scipy — plain O(N^2) distance checks (fine at 100 cubes).
  * Re-runnable — previous crowd_* objects are deleted before creating new ones.
  * --seed drives every random draw (sim + cosmetic size variation).
"""

import argparse
import colorsys
import math
import os
import random
import sys

import bpy

PREFIX = "crowd_"

# Battlefield layout (metres). Armies spawn at |x| in [SPAWN_NEAR, SPAWN_FAR]
# and cross toward the mirrored band on the far side.
SPAWN_NEAR = 8.0
SPAWN_FAR = 14.0
FIELD_Y = 9.5
FLOOR_SIZES = {"clash": (52.0, 30.0), "charge": (52.0, 30.0), "horde": (190.0, 140.0),
               "castle": (80.0, 60.0)}
FLOOR_COLORS = {"clash": (0.55, 0.53, 0.50, 1.0), "charge": (0.55, 0.53, 0.50, 1.0),
                "horde": (0.30, 0.40, 0.26, 1.0),  # lawn
                "castle": (0.40, 0.35, 0.28, 1.0)}  # packed dirt

# Sim constants (see CLAUDE.md — the goal term is what makes it move).
STEER_TAU = 0.5      # accel = (normalize(goal-pos)*speed - vel) / STEER_TAU
MAX_SPEED = 1.8
REPULSE_RANGE = 1.0  # push apart, ~1m range
REPULSE_K = 4.0
JITTER = 0.1         # small jitter only — breaks up straight lines

AGENT_DIMS = (0.45, 0.45, 1.7)  # cube footprint x/y, height (reads as a person)
TEAM_COLORS = ((0.16, 0.25, 0.65, 1.0), (0.70, 0.16, 0.10, 1.0))

# horde scenario — a zombie flood converges on a defended perimeter (aerial plate).
# +x is the approach axis: spawn band -> barricade GATE (funnel) -> building DOOR.
ZOMBIE_SPAWN_X = (-38.0, -12.0)
ZOMBIE_SPAWN_Y = 34.0
ZOMBIE_SPEED = (2.5, 4.5)       # sprint-heavy mix; heavy jitter = staggering run
ZOMBIE_JITTER = 0.5
# non-uniform wave structure (so the horde doesn't read as a homogeneous gas):
# clustered packs, staggered surge waves, pack cohesion, sprinter/shambler classes
CLUSTER_SCATTER = 3.2           # sigma of each spawn pack, metres
CLUSTER_SPEED_MULT = (0.75, 1.3)
CLUSTER_DELAY_PROB = 0.4        # chance a pack mills at spawn, then surges late
CLUSTER_DELAY_S = (1.5, 3.5)
CLUSTER_Y = 26.0                # lateral spread of pack centres (keep in frame)
COHESION_K = 0.35               # spring toward the pack's live centroid...
COHESION_MAX = 2.0              # ...capped, and dropped once inside the funnel
SPRINTER_PROB, SPRINTER_MULT = 0.05, 1.35
SHAMBLER_PROB, SHAMBLER_MULT = 0.08, 0.5
ZOMBIE_REPULSE_RANGE = 0.55     # pack tight — a flood, not a formation
ZOMBIE_REPULSE_K = 2.0
GATE = (14.0, 0.0)              # gap in the barricade; every zombie funnels here
DOOR = (26.5, 0.0)              # then piles up against the building face
DEFEND_SHOVE_RANGE = 0.9        # zombies shove defenders in the crush...
DEFEND_SHOVE_K = 6.0            # ...but the line NEVER routs — anchors pull back
BARRICADE_DIMS = (0.8, 2.2, 1.3)
BUILDING_DIMS = (10.0, 24.0, 9.0)
HORDE_PROPS = (
    # building at the far end (front face x=27), barricade row with the gate gap
    {"dims": BUILDING_DIMS, "loc": (32.0, 0.0), "color": (0.78, 0.77, 0.74, 1.0)},
    *[{"dims": BARRICADE_DIMS, "loc": (14.0, y), "color": (0.22, 0.22, 0.24, 1.0)}
      for y in tuple(range(-20, -3, 3)) + tuple(range(4, 21, 3))],
)

# charge scenario — one mounted warrior punches through a standing crowd
HORSE_DIMS = (2.4, 0.9, 1.5)    # length (x), width, shoulder height
RIDER_DIMS = (0.45, 0.45, 0.95)
HORSE_COLOR = (0.16, 0.10, 0.07, 1.0)
RIDER_COLOR = (0.85, 0.65, 0.18, 1.0)
HORSE_START = (-18.0, 0.0)
HORSE_GOAL = (30.0, 0.0)  # beyond the field so he never decelerates on screen
HORSE_SPEED = 6.0               # gallop; same steering law, bigger numbers
HORSE_MAX_SPEED = 7.0
HORSE_REPULSE_RANGE = 3.0       # the charge shoves people this far out
HORSE_REPULSE_K = 25.0
PANIC_RANGE = 4.0               # people this close to the horse dive for the sides
PANIC_SPEED = 3.0
CROWD_CENTER_X = 2.0
CROWD_RADIUS = 4.0

# castle scenario — market day in a castle bailey: a dense, NON-UNIFORM background
# crowd (milling packs, gate traffic, an audience) plus FIVE solid-colour foreground
# actors, each with its own behaviour, every one of them reacting to what is in
# front of it. +x runs gate -> keep. One colour = one named identity/outfit — the
# same blue/green/yellow/red/purple order the canvas's mask plates bind cast to.
CASTLE_GATE_X = -14.0
CASTLE_KEEP_X = 22.0
CASTLE_HALF_W = 22.0
WALL_H, WALL_T = 6.0, 1.5
STONE = (0.62, 0.60, 0.56, 1.0)
WOOD = (0.40, 0.28, 0.16, 1.0)
CASTLE_PROPS = (
    {"dims": (4.0, 4.0, 9.0), "loc": (CASTLE_GATE_X, 4.2), "color": STONE},      # gate towers
    {"dims": (4.0, 4.0, 9.0), "loc": (CASTLE_GATE_X, -4.2), "color": STONE},     # (gap y in ±2.2)
    {"dims": (WALL_T, 17.5, WALL_H), "loc": (CASTLE_GATE_X, 13.25), "color": STONE},
    {"dims": (WALL_T, 17.5, WALL_H), "loc": (CASTLE_GATE_X, -13.25), "color": STONE},
    {"dims": (36.0, WALL_T, WALL_H), "loc": (4.0, CASTLE_HALF_W), "color": STONE},   # side walls
    {"dims": (36.0, WALL_T, WALL_H), "loc": (4.0, -CASTLE_HALF_W), "color": STONE},
    {"dims": (WALL_T, 44.0, WALL_H), "loc": (CASTLE_KEEP_X, 0.0), "color": STONE},   # back wall
    {"dims": (12.0, 12.0, 16.0), "loc": (27.0, 0.0), "color": STONE},                 # the keep
    *[{"dims": (3.5, 3.5, 8.0), "loc": (x, y), "color": STONE}                        # corner towers
      for x in (CASTLE_GATE_X, CASTLE_KEEP_X) for y in (-CASTLE_HALF_W, CASTLE_HALF_W)],
    *[{"dims": (2.2, 1.4, 1.9), "loc": (x, 12.0), "color": WOOD} for x in (-5.0, -0.5, 4.0, 8.5)],
    *[{"dims": (2.2, 1.4, 1.9), "loc": (x, -13.0), "color": WOOD} for x in (-3.0, 2.0, 7.0)],
    {"dims": (3.0, 3.0, 0.6), "loc": (10.0, 4.0), "color": (0.45, 0.40, 0.34, 1.0)},  # herald's dais
    {"dims": (1.6, 1.6, 1.0), "loc": (6.0, -6.0), "color": STONE},                    # well
    {"dims": (2.4, 1.4, 1.2), "loc": (14.0, -3.0), "color": WOOD},                    # hay cart
)
DAIS = (10.0, 4.0, 0.6)
HERO_COLORS = (  # the canvas mask-plate order — bind each colour to one cast member
    ("sentry", (0.10, 0.30, 0.95, 1.0)),      # blue
    ("herald", (0.10, 0.75, 0.20, 1.0)),      # green
    ("porter", (0.98, 0.85, 0.10, 1.0)),      # yellow
    ("noble", (0.92, 0.12, 0.10, 1.0)),       # red
    ("petitioner", (0.60, 0.15, 0.85, 1.0)),  # purple
)
CROWD_PALETTE = (  # muted, varied earth tones — extras read as diverse, never as identities
    (0.36, 0.28, 0.20), (0.30, 0.30, 0.31), (0.44, 0.36, 0.22), (0.28, 0.32, 0.24),
    (0.42, 0.22, 0.18), (0.50, 0.46, 0.40), (0.24, 0.24, 0.30), (0.38, 0.40, 0.36),
)
# Staging per shot size. "wide": the whole bailey lives (packs, gate traffic,
# audience). "medium": eye-level group shot — the five heroes in a ~5m band 6-9m
# from the lens, a dozen extras 13-18m back by the stalls and keep (bokeh depth).
STAGES = {
    "wide": {
        "sentry_posts": ((-6.5, -3.0), (-6.5, 3.0)),       # patrol line inside the gate
        "porter_loop": ((-1.5, -4.0), (14.0, -5.0), (14.0, 6.0)),  # clear of the towers' occlusion wedge
        "noble_path": ((19.0, -15.0), (0.0, 8.0)),        # far corner -> the dais crowd
        "petitioner_spot": (3.0, 1.6),                    # 1.7m off the noble's line
        "packs": None,                                    # random: 50% mill / 25% audience / 25% traffic
        "bounds": (-11.0, 19.0, -19.0, 19.0),
        "agents": 260,
    },
    "medium": {
        "sentry_posts": ((9.6, -1.6), (8.6, -0.2)),        # short guard line, frame right
        "porter_loop": ((3.5, 5.5), (13.5, 4.5), (11.5, -2.5)),   # crosses the mid-ground behind the FG line
        "noble_path": ((16.0, -2.0), (6.6, 3.0)),         # enters frame right, stops between petitioner and dais
        "petitioner_spot": (6.1, 1.55),                   # frame left, by the noble's line
        "packs": (("audience", (8.5, 6.0)), ("audience", (12.5, 7.0)),   # loose, behind the dais
                  ("mill", (4.0, 9.8)), ("mill", (17.0, 9.0)), ("mill", (18.0, -1.0))),
        "bounds": (2.0, 19.5, -9.0, 10.5),
        "agents": 14,
    },
    # QUIET: static frontal camera looking +x; nobody moves — four heroes stand in a
    # row 9m out facing the lens, the herald stands on the dais 16m back, extras
    # stand in loose knots 20-25m back by the cart and the keep. The ONLY motion is
    # a small cat crossing in front of the row (walk, sit and look, walk on).
    "quiet": {
        "row_x": 3.0,
        "row": (("petitioner", 2.9), ("noble", 1.65), ("sentry", 0.35), ("porter", -0.9)),  # viewer L -> R
        "extras": ((13.2, -2.0), (14.8, -4.4), (15.6, -1.4), (13.9, -5.3),          # by the hay cart
                   (16.8, 3.2), (18.0, 4.1), (17.4, 2.0),                            # a knot, frame left
                   (19.2, -0.6), (20.5, 0.8), (19.8, -2.2)),                         # deep, by the keep
        "cat": {"x": 1.2, "y_from": 4.0, "y_to": -2.2, "speed": 0.7, "start_s": 2.5,
                "sit_y": 1.3, "sit_s": 1.8},
        "agents": 10,
    },
}
REACT_RANGE = 1.7        # sentry / porter: stop and face whoever is this close ahead
HALT_FRAMES = 36
PATIENCE_FRAMES = 30     # then the porter pushes on / the sentry ignores that loiterer for a while
AUDIENCE_RANGE = 7.0     # the herald plays to everyone this close; idle extras face him
DEFER_RANGE, DEFER_SPEED = 2.8, 1.2   # extras step aside for the noble
RISE_RANGE, SINK_RANGE = 4.0, 6.0     # petitioner rises for the noble, sinks once he's gone

# Per-scenario framing: clash spreads ~28m across the field, charge is a ~9m crowd
# plus a gallop lane, so its cameras sit much closer. "rot" = fixed orientation
# (controls frame roll, e.g. overhead); otherwise the camera tracks "target".
# arrival scenario — a rider walks his horse in through the town gate along the
# road (+x) while townsfolk stream both ways on both verges and cut across the
# road; everyone squeezes through the gate gap. One continuous tracking shot,
# rendered by default as an unlit solid-colour MASK plate (--colorize id).
ARRIVAL_ROAD_HALF = 2.4
ARRIVAL_VERGE = (2.7, 6.2)           # |y| band the walkers keep to
ARRIVAL_SPAN = (-36.0, 9.0)          # x extent kept populated (walkers wrap off-screen)
ARRIVAL_HORSE_X0 = -27.0
ARRIVAL_HORSE_SPEED = 1.75           # a walk: 17.5m in 10s, through the gate around t=6s
ARRIVAL_GATE_GAP = 1.7               # |y| the gate funnels everyone into
ARRIVAL_HORSE_COLOR = (0.10, 0.75, 0.20, 1.0)   # green  — mask-plate colour order, bound like heroes
ARRIVAL_RIDER_COLOR = (0.10, 0.30, 0.95, 1.0)   # blue
FLOOR_SIZES["arrival"] = (84.0, 60.0)
FLOOR_COLORS["arrival"] = FLOOR_COLORS["castle"]

CAMERA_PRESETS = {
    "clash": {
        "high45":   {"loc": (26.0, -26.0, 18.0), "lens": 40.0},  # elevated 3/4 crane
        "side":     {"loc": (2.0, -30.0, 2.0),   "lens": 55.0},  # long-lens side profile
        "overhead": {"loc": (0.0, 0.0, 40.0),    "lens": 35.0, "rot": (0.0, 0.0, 0.0)},
        "low":      {"loc": (-17.0, -9.5, 1.5),  "lens": 40.0},  # ground-level, in the ranks
    },
    "charge": {  # cinematic one-take coverage; every camera tracks the horse.
        # Planted just past the far edge of the mob, long lens straight down the
        # lane: telephoto compression, bodies stacked in the foreground, the horse
        # eats 25m of distance at the lens and skims past ~1m away (whip-pan).
        "headon":    {"loc": (10.0, 0.9, 1.65),    "lens": 60.0, "aim_z": 1.5,
                      "aim_tau": 0.18, "shake": 0.05},
        # riding with the charge: low, wide, over his flank, crowd scattering ahead
        "chase":     {"follow": (-4.5, 1.6, 1.5),  "lens": 30.0, "aim_z": 1.3,
                      "shake": 0.04},
        # eye height INSIDE the mob, 2.4m off the lane: he grows, people stream
        # past the lens, whip-pan as he blasts through
        "crowdpov":  {"loc": (4.2, -3.4, 1.6),     "lens": 32.0, "aim_z": 1.4,
                      "aim_tau": 0.15, "shake": 0.06},
        # opens high and wide, dives to eye level timed to the impact
        "cranedive": {"path": ((16.0, -14.0, 12.0), (10.0, -6.5, 1.6), 35, 100),
                      "lens": 40.0, "aim_z": 1.2, "aim_tau": 0.25, "shake": 0.03},
    },
    "castle": {  # each preset names its STAGE (see STAGES): medium = group shot, wide = whole bailey
        # eye-level 50mm group shot (default): five heroes 6-9m out across the frame,
        # herald raised on the dais behind them, a few extras and the keep far back —
        # the depth separation a bokeh pass needs. Slow dolly-in.
        "medium":  {"path": ((1.8, -6.6, 1.7), (2.4, -5.9, 1.68), 0, 240),
                    "lens": 50.0, "target": (8.2, 1.2, 1.2), "stage": "medium"},
        # locked-off frontal 50mm at chest height, dead level on the FG row; everyone
        # holds still and a cat crosses the foreground — the quiet plate
        "quiet":   {"loc": (-6.0, 1.0, 1.45), "lens": 50.0, "target": (4.0, 1.0, 1.15), "stage": "quiet"},
        # from the gatehouse roof looking down the yard to the keep: sentry at the
        # lens, herald's dais mid-frame, crowd packed around the stalls, slow push
        "wide":    {"path": ((-21.0, -0.5, 13.0), (-18.5, -0.3, 12.4), 0, 240),
                    "lens": 26.0, "target": (5.0, 0.5, 1.4), "stage": "wide"},
        # from the keep's roof back toward the gate: traffic streaming in, walls framing
        "reverse": {"path": ((23.5, 1.0, 17.0), (21.5, 0.5, 16.0), 0, 240),
                    "lens": 30.0, "target": (-3.0, 0.0, 1.4), "stage": "wide"},
        # eye level at the gate, 35mm: the crowd as a wall of bodies, heroes cutting through
        "gate":    {"loc": (-12.5, -1.5, 1.65), "lens": 35.0, "target": (6.0, 1.0, 1.3), "stage": "wide"},
    },
    "arrival": {  # one continuous take, every preset tracks the rider
        # LEAD: retreats 11m ahead of the rider at his walking pace, chest height, looking
        # back at him — opens inside the gate passage looking out at the approaching rider
        # framed by the towers, then backs into the town as he comes through; walkers
        # cross between lens and rider. Gentle handheld.
        "lead": {"follow": (11.0, 0.9, 1.65), "lens": 35.0, "aim_z": 1.4, "shake": 0.02},
        # SIDE: lateral dolly on the verge, profile of horse and rider against the gate
        "side": {"follow": (0.0, -7.5, 1.55), "lens": 45.0, "aim_z": 1.3, "shake": 0.02},
    },
    "horde": {  # aerial plates; no single subject — fixed aim, drifting paths.
        # helicopter wide from behind the flood, slow push-in: building top of
        # frame, horde pouring across the lawn below (the reference framing)
        "aerial": {"path": ((-56.0, -28.0, 40.0), (-38.0, -16.0, 34.0), 0, 245),
                   "lens": 40.0, "target": (18.0, 0.0, 3.0), "shake": 0.25},
        # opens at eye level behind the barricade facing the oncoming horde,
        # cranes up and back over the building to reveal the scale of it
        "reveal": {"path": ((19.0, 4.0, 1.7), (38.0, 14.0, 20.0), 30, 200),
                   "lens": 35.0, "target": (12.0, 0.0, 1.5), "shake": 0.1},
    },
}
ALL_CAMERAS = sorted({name for presets in CAMERA_PRESETS.values() for name in presets})
FOLLOW_TAU = 0.4   # camera position chase (lag gives the horse leading room)
AIM_TAU = 0.25     # aim-target chase (slightly snappier than the dolly)
# handheld shake: layered sines (Hz, relative amplitude); ramps up near the horse
SHAKE_FREQS = ((0.6, 1.0), (1.7, 0.55), (4.9, 0.28), (8.3, 0.12))
SHAKE_PROX_RANGE = 10.0


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    parser = argparse.ArgumentParser(
        prog="blender -b -P crowd_blockout.py --",
        description="Crowd blockout: cubes with goal-seeking + repulsion, rendered to MP4.",
    )
    parser.add_argument("--scenario", choices=["clash", "charge", "horde", "castle", "arrival"],
                        default="clash",
                        help="clash: two armies cross; charge: horse warrior through a "
                             "crowd; horde: zombie flood vs defended perimeter (aerial); "
                             "castle: bailey market crowd + 5 solid-colour hero actors; "
                             "arrival: rider walks in through the town gate, two-way foot "
                             "traffic, one tracking shot (mask plate by default)")
    parser.add_argument("--agents", type=int, default=None,
                        help="crowd size (default: 100 clash, 30 charge, 600 horde; castle: 14 medium / 260 wide)")
    parser.add_argument("--frames", type=int, default=None, help="default 250 (arrival: 240 = 10s)")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--camera", choices=ALL_CAMERAS, default=None,
                        help="per scenario; default: high45 (clash), headon (charge)")
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--res", default=None,
                        help="WxH; default 1280x720 (clash), 1280x536 scope (charge)")
    parser.add_argument("--colorize", choices=["film", "id", "cluster", "gray"],
                        default=None,
                        help="film: shaded look; id: unique hue per agent; cluster: "
                             "hue per horde pack; gray: grey ramp per pack (ID passes "
                             "render unlit on black)")
    parser.add_argument("--out", default=None,
                        help="filepath stem (no extension); default render/blockout_<camera>")
    parser.add_argument("--still", type=int, default=None, metavar="FRAME",
                        help="render a single PNG of this frame instead of the MP4")
    return parser.parse_args(argv)


# ---------------------------------------------------------------- simulation

def simulate_clash(n_agents, n_frames, fps, seed):
    """Two armies cross the field through each other.

    Returns agent descriptors: [{'kind', 'color', 'track'}]; track[f] = (x, y, heading).
    """
    rng = random.Random(seed)
    dt = 1.0 / fps
    half = n_agents // 2

    pos, vel, goal, speed, team, heading = [], [], [], [], [], []
    for i in range(n_agents):
        t = 0 if i < half else 1
        side = -1.0 if t == 0 else 1.0  # team 0 marches +x, team 1 marches -x
        p = [side * rng.uniform(SPAWN_NEAR, SPAWN_FAR), rng.uniform(-FIELD_Y, FIELD_Y)]
        g = [-side * rng.uniform(SPAWN_NEAR + 2.0, SPAWN_FAR + 2.0),
             max(-FIELD_Y, min(FIELD_Y, p[1] + rng.uniform(-4.0, 4.0)))]
        pos.append(p)
        vel.append([0.0, 0.0])
        goal.append(g)
        speed.append(rng.uniform(1.0, 1.6))
        team.append(t)
        heading.append(math.atan2(g[1] - p[1], g[0] - p[0]))

    tracks = [[] for _ in range(n_agents)]
    r2 = REPULSE_RANGE * REPULSE_RANGE

    for _f in range(n_frames):
        for i in range(n_agents):
            tracks[i].append((pos[i][0], pos[i][1], heading[i]))

        new_vel = []
        for i in range(n_agents):
            px, py = pos[i]

            gx, gy = goal[i][0] - px, goal[i][1] - py
            gd = math.hypot(gx, gy)
            if gd < 2.0:  # reached the far side — keep marching, don't mill around
                goal[i][0] += 12.0 * (1.0 if team[i] == 0 else -1.0)
                gx, gy = goal[i][0] - px, goal[i][1] - py
                gd = math.hypot(gx, gy)

            # steer toward goal
            ax = (gx / gd * speed[i] - vel[i][0]) / STEER_TAU
            ay = (gy / gd * speed[i] - vel[i][1]) / STEER_TAU

            # repulsion from neighbours
            for j in range(n_agents):
                if j == i:
                    continue
                ox, oy = px - pos[j][0], py - pos[j][1]
                d2 = ox * ox + oy * oy
                if 1e-9 < d2 < r2:
                    d = math.sqrt(d2)
                    w = REPULSE_K * (1.0 - d / REPULSE_RANGE) / d
                    ax += ox * w
                    ay += oy * w

            ax += JITTER * rng.gauss(0.0, 1.0)
            ay += JITTER * rng.gauss(0.0, 1.0)

            vx = vel[i][0] + ax * dt
            vy = vel[i][1] + ay * dt
            v = math.hypot(vx, vy)
            if v > MAX_SPEED:
                vx, vy = vx / v * MAX_SPEED, vy / v * MAX_SPEED
            new_vel.append([vx, vy])

        for i in range(n_agents):
            vel[i] = new_vel[i]
            pos[i][0] += vel[i][0] * dt
            pos[i][1] += vel[i][1] * dt
            v = math.hypot(vel[i][0], vel[i][1])
            if v > 0.15:  # smoothly face travel direction; hold heading when idling
                target = math.atan2(vel[i][1], vel[i][0])
                delta = (target - heading[i] + math.pi) % (2.0 * math.pi) - math.pi
                heading[i] += 0.3 * delta

    return [{"kind": "person", "color": TEAM_COLORS[team[i]], "track": tracks[i]}
            for i in range(n_agents)]


def simulate_charge(n_crowd, n_frames, fps, seed):
    """A horse warrior gallops through a milling crowd; the crowd parts and reforms.

    Same descriptor format as simulate_clash; the last agent is the horse.
    """
    rng = random.Random(seed)
    dt = 1.0 / fps

    pos, vel, home, speed, side_pref, heading = [], [], [], [], [], []
    for _i in range(n_crowd):
        ang = rng.uniform(0.0, 2.0 * math.pi)
        r = CROWD_RADIUS * math.sqrt(rng.uniform(0.0, 1.0))  # even disc distribution
        p = [CROWD_CENTER_X + r * math.cos(ang), r * math.sin(ang)]
        pos.append(p)
        vel.append([0.0, 0.0])
        home.append(list(p))
        speed.append(rng.uniform(0.9, 1.3))
        side_pref.append(1.0 if rng.random() < 0.5 else -1.0)
        heading.append(math.atan2(HORSE_START[1] - p[1], HORSE_START[0] - p[0]))

    hpos = list(HORSE_START)
    hvel = [0.0, 0.0]
    hheading = math.atan2(HORSE_GOAL[1] - hpos[1], HORSE_GOAL[0] - hpos[0])

    tracks = [[] for _ in range(n_crowd)]
    htrack = []
    r2 = REPULSE_RANGE * REPULSE_RANGE
    hr2 = HORSE_REPULSE_RANGE * HORSE_REPULSE_RANGE

    for _f in range(n_frames):
        for i in range(n_crowd):
            tracks[i].append((pos[i][0], pos[i][1], heading[i]))
        htrack.append((hpos[0], hpos[1], hheading))

        hx, hy = hpos
        hs = math.hypot(hvel[0], hvel[1])
        new_vel = []
        for i in range(n_crowd):
            px, py = pos[i]
            dhx, dhy = px - hx, py - hy
            dh2 = dhx * dhx + dhy * dhy

            if dh2 < PANIC_RANGE * PANIC_RANGE and hs > 0.5:
                # dive out of the lane: flee perpendicular to the horse's path,
                # never straight ahead of it (that just gets you run down)
                ux, uy = hvel[0] / hs, hvel[1] / hs
                proj = dhx * ux + dhy * uy
                perx, pery = dhx - proj * ux, dhy - proj * uy
                pm = math.hypot(perx, pery)
                if pm > 0.15:
                    fx, fy = perx / pm, pery / pm
                else:
                    fx, fy = -uy * side_pref[i], ux * side_pref[i]
                dx_des, dy_des = fx * PANIC_SPEED, fy * PANIC_SPEED
                vmax = PANIC_SPEED
            else:
                # mill around the spawn point (arrive-damped so nobody orbits home)
                gx, gy = home[i][0] - px, home[i][1] - py
                gd = math.hypot(gx, gy)
                if gd > 0.05:
                    scale = speed[i] * min(1.0, gd)
                    dx_des, dy_des = gx / gd * scale, gy / gd * scale
                else:
                    dx_des = dy_des = 0.0
                vmax = MAX_SPEED

            ax = (dx_des - vel[i][0]) / STEER_TAU
            ay = (dy_des - vel[i][1]) / STEER_TAU

            for j in range(n_crowd):
                if j == i:
                    continue
                ox, oy = px - pos[j][0], py - pos[j][1]
                d2 = ox * ox + oy * oy
                if 1e-9 < d2 < r2:
                    d = math.sqrt(d2)
                    w = REPULSE_K * (1.0 - d / REPULSE_RANGE) / d
                    ax += ox * w
                    ay += oy * w

            if 1e-9 < dh2 < hr2:  # a warhorse is not something you argue with
                d = math.sqrt(dh2)
                w = HORSE_REPULSE_K * (1.0 - d / HORSE_REPULSE_RANGE) / d
                ax += dhx * w
                ay += dhy * w

            ax += JITTER * rng.gauss(0.0, 1.0)
            ay += JITTER * rng.gauss(0.0, 1.0)

            vx = vel[i][0] + ax * dt
            vy = vel[i][1] + ay * dt
            v = math.hypot(vx, vy)
            if v > vmax:
                vx, vy = vx / v * vmax, vy / v * vmax
            new_vel.append([vx, vy])

        # the horse: plain goal-seek at gallop speed, crowd does not slow it
        gx, gy = HORSE_GOAL[0] - hx, HORSE_GOAL[1] - hy
        gd = math.hypot(gx, gy)
        hax = (gx / gd * HORSE_SPEED - hvel[0]) / STEER_TAU if gd > 1e-6 else 0.0
        hay = (gy / gd * HORSE_SPEED - hvel[1]) / STEER_TAU if gd > 1e-6 else 0.0
        hax += JITTER * rng.gauss(0.0, 1.0)
        hay += JITTER * rng.gauss(0.0, 1.0)
        hvx = hvel[0] + hax * dt
        hvy = hvel[1] + hay * dt
        hv = math.hypot(hvx, hvy)
        if hv > HORSE_MAX_SPEED:
            hvx, hvy = hvx / hv * HORSE_MAX_SPEED, hvy / hv * HORSE_MAX_SPEED
        hvel = [hvx, hvy]

        for i in range(n_crowd):
            vel[i] = new_vel[i]
            pos[i][0] += vel[i][0] * dt
            pos[i][1] += vel[i][1] * dt
            v = math.hypot(vel[i][0], vel[i][1])
            if v > 0.15:
                target = math.atan2(vel[i][1], vel[i][0])
                delta = (target - heading[i] + math.pi) % (2.0 * math.pi) - math.pi
                heading[i] += 0.3 * delta
        hpos[0] += hvel[0] * dt
        hpos[1] += hvel[1] * dt
        if math.hypot(hvel[0], hvel[1]) > 0.15:
            target = math.atan2(hvel[1], hvel[0])
            delta = (target - hheading + math.pi) % (2.0 * math.pi) - math.pi
            hheading += 0.3 * delta

    agents = [{"kind": "person", "color": TEAM_COLORS[0], "track": tracks[i]}
              for i in range(n_crowd)]
    agents.append({"kind": "horse", "color": HORSE_COLOR, "track": htrack})
    return agents


def simulate_horde(n_zombies, n_frames, fps, seed):
    """Zombie flood funnels at the barricade gate, then swarms the building face;
    defender line + door crowd hold until the horde is close, then rout."""
    rng = random.Random(seed)
    dt = 1.0 / fps

    def zombie_color():
        g = rng.uniform(0.25, 0.42)  # muddy grey-greens with the odd dried-red
        c = [g * 0.95, g, g * 0.75, 1.0]
        if rng.random() < 0.12:
            c = [g, g * 0.55, g * 0.45, 1.0]
        return tuple(c)

    # clustered packs with per-pack tempo and staggered release waves; centre-x is
    # biased toward the near edge so the first waves enter the aerial frame early
    n_clusters = max(8, n_zombies // 30)
    centers = [(-10.0 - 28.0 * rng.random() ** 1.7,
                rng.uniform(-CLUSTER_Y, CLUSTER_Y)) for _ in range(n_clusters)]
    weights = [rng.uniform(0.5, 2.2) for _ in range(n_clusters)]
    total_w = sum(weights)
    counts = [max(1, round(w / total_w * n_zombies)) for w in weights]
    while sum(counts) > n_zombies:
        counts[counts.index(max(counts))] -= 1
    while sum(counts) < n_zombies:
        counts[counts.index(min(counts))] += 1
    releases = [int(rng.uniform(*CLUSTER_DELAY_S) * fps)
                if rng.random() < CLUSTER_DELAY_PROB else 0 for _ in range(n_clusters)]
    tempo = [rng.uniform(*CLUSTER_SPEED_MULT) for _ in range(n_clusters)]

    zpos, zvel, zspeed, zgoal_y, zhead, zcol = [], [], [], [], [], []
    zcluster, zrelease = [], []
    cluster_members = [[] for _ in range(n_clusters)]
    for ci in range(n_clusters):
        for _ in range(counts[ci]):
            p = [max(-55.0, min(-9.0, centers[ci][0] + rng.gauss(0.0, CLUSTER_SCATTER))),
                 max(-38.0, min(38.0, centers[ci][1] + rng.gauss(0.0, CLUSTER_SCATTER)))]
            speed = rng.uniform(*ZOMBIE_SPEED) * tempo[ci]
            r = rng.random()
            if r < SPRINTER_PROB:
                speed *= SPRINTER_MULT      # a few loping leaders out front
            elif r < SPRINTER_PROB + SHAMBLER_PROB:
                speed *= SHAMBLER_MULT      # limping stragglers strung out behind
            cluster_members[ci].append(len(zpos))
            zcluster.append(ci)
            zrelease.append(releases[ci])
            zpos.append(p)
            zvel.append([0.0, 0.0])
            zspeed.append(speed)
            zgoal_y.append(rng.uniform(-2.0, 2.0))  # personal aim inside the gate gap
            zhead.append(rng.uniform(-math.pi, math.pi))
            zcol.append(zombie_color())

    # defenders: a line just behind the barricade + a crowd at the door.
    # They hold their posts no matter what — braced, facing the horde.
    dpos, dvel, dhome, dhead = [], [], [], []
    for k in range(26):
        p = [15.6 + rng.uniform(-0.3, 0.3), -12.5 + k * 1.0 + rng.uniform(-0.2, 0.2)]
        dpos.append(p); dhome.append(list(p))
    for _ in range(30):
        p = [rng.uniform(23.0, 26.0), rng.uniform(-5.0, 5.0)]
        dpos.append(p); dhome.append(list(p))
    for p in dpos:
        dvel.append([0.0, 0.0])
        dhead.append(math.pi)  # facing the horde
    n_def = len(dpos)

    ztracks = [[] for _ in range(n_zombies)]
    dtracks = [[] for _ in range(n_def)]
    zr2 = ZOMBIE_REPULSE_RANGE * ZOMBIE_REPULSE_RANGE
    r2 = REPULSE_RANGE * REPULSE_RANGE

    for _f in range(n_frames):
        for i in range(n_zombies):
            ztracks[i].append((zpos[i][0], zpos[i][1], zhead[i]))
        for i in range(n_def):
            dtracks[i].append((dpos[i][0], dpos[i][1], dhead[i]))

        cents = []
        for members in cluster_members:
            sx = sum(zpos[m][0] for m in members)
            sy = sum(zpos[m][1] for m in members)
            cents.append((sx / len(members), sy / len(members)))

        new_zvel = []
        for i in range(n_zombies):
            px, py = zpos[i]
            jit = ZOMBIE_JITTER
            if _f < zrelease[i]:
                # pack not yet surging: mill and shuffle in place
                ax = -zvel[i][0] / STEER_TAU
                ay = -zvel[i][1] / STEER_TAU
                jit = ZOMBIE_JITTER * 1.5
            else:
                # stage 1: funnel at the gate; stage 2 (through it): swarm the door
                if px < GATE[0] - 0.5:
                    gx, gy = GATE[0] - px, GATE[1] + zgoal_y[i] - py
                else:
                    gx, gy = DOOR[0] + 0.3 - px, DOOR[1] + zgoal_y[i] * 2.0 - py
                gd = math.hypot(gx, gy)
                if gd < 1.0:
                    gd = 1.0  # mosh at the wall instead of dividing by ~0
                ax = (gx / gd * zspeed[i] - zvel[i][0]) / STEER_TAU
                ay = (gy / gd * zspeed[i] - zvel[i][1]) / STEER_TAU
                if px < GATE[0] - 2.0:  # run with the pack until the funnel merges all
                    cx, cy = cents[zcluster[i]]
                    chx, chy = (cx - px) * COHESION_K, (cy - py) * COHESION_K
                    ch = math.hypot(chx, chy)
                    if ch > COHESION_MAX:
                        chx, chy = chx / ch * COHESION_MAX, chy / ch * COHESION_MAX
                    ax += chx
                    ay += chy
            for j in range(n_zombies):
                if j == i:
                    continue
                ox, oy = px - zpos[j][0], py - zpos[j][1]
                d2 = ox * ox + oy * oy
                if 1e-9 < d2 < zr2:
                    d = math.sqrt(d2)
                    w = ZOMBIE_REPULSE_K * (1.0 - d / ZOMBIE_REPULSE_RANGE) / d
                    ax += ox * w
                    ay += oy * w
            ax += jit * rng.gauss(0.0, 1.0)
            ay += jit * rng.gauss(0.0, 1.0)
            vx = zvel[i][0] + ax * dt
            vy = zvel[i][1] + ay * dt
            vmax = zspeed[i] * 1.15
            v = math.hypot(vx, vy)
            if v > vmax:
                vx, vy = vx / v * vmax, vy / v * vmax
            new_zvel.append([vx, vy])

        new_dvel = []
        shove2 = DEFEND_SHOVE_RANGE * DEFEND_SHOVE_RANGE
        for i in range(n_def):
            px, py = dpos[i]
            # hold the line: always steer back to the post
            gx, gy = dhome[i][0] - px, dhome[i][1] - py
            gd = math.hypot(gx, gy)
            if gd > 0.05:
                s = min(1.0, gd)
                dx_des, dy_des = gx / gd * s, gy / gd * s
            else:
                dx_des = dy_des = 0.0
            ax = (dx_des - dvel[i][0]) / STEER_TAU
            ay = (dy_des - dvel[i][1]) / STEER_TAU
            for j in range(n_def):
                if j == i:
                    continue
                ox, oy = px - dpos[j][0], py - dpos[j][1]
                d2 = ox * ox + oy * oy
                if 1e-9 < d2 < r2:
                    d = math.sqrt(d2)
                    w = REPULSE_K * (1.0 - d / REPULSE_RANGE) / d
                    ax += ox * w
                    ay += oy * w
            for zp in zpos:  # the crush: zombies shove, the anchor pulls back
                ox, oy = px - zp[0], py - zp[1]
                d2 = ox * ox + oy * oy
                if 1e-9 < d2 < shove2:
                    d = math.sqrt(d2)
                    w = DEFEND_SHOVE_K * (1.0 - d / DEFEND_SHOVE_RANGE) / d
                    ax += ox * w
                    ay += oy * w
            ax += JITTER * rng.gauss(0.0, 1.0)
            ay += JITTER * rng.gauss(0.0, 1.0)
            vx = dvel[i][0] + ax * dt
            vy = dvel[i][1] + ay * dt
            v = math.hypot(vx, vy)
            if v > MAX_SPEED:
                vx, vy = vx / v * MAX_SPEED, vy / v * MAX_SPEED
            new_dvel.append([vx, vy])

        for i in range(n_zombies):
            zvel[i] = new_zvel[i]
            zpos[i][0] += zvel[i][0] * dt
            zpos[i][1] += zvel[i][1] * dt
            v = math.hypot(zvel[i][0], zvel[i][1])
            if v > 0.15:
                target = math.atan2(zvel[i][1], zvel[i][0])
                delta = (target - zhead[i] + math.pi) % (2.0 * math.pi) - math.pi
                zhead[i] += 0.3 * delta
        for i in range(n_def):
            dvel[i] = new_dvel[i]
            dpos[i][0] += dvel[i][0] * dt
            dpos[i][1] += dvel[i][1] * dt
            # braced: defenders keep facing the horde even while being jostled

    agents = [dict(HORDE_PROPS[k], kind="prop") for k in range(len(HORDE_PROPS))]
    agents += [{"kind": "person", "color": TEAM_COLORS[0], "track": dtracks[i]}
               for i in range(n_def)]
    agents += [{"kind": "person", "color": zcol[i], "cluster": zcluster[i],
                "track": ztracks[i]} for i in range(n_zombies)]
    return agents


def _turn(heading, target, k=0.3):
    delta = (target - heading + math.pi) % (2.0 * math.pi) - math.pi
    return heading + k * delta


def simulate_castle(n_crowd, n_frames, fps, seed, stage="wide"):
    """Market day in the bailey: packs mill, traffic streams through the gate, an
    audience gathers at the dais — and five solid-colour heroes each do their own
    thing, reacting to whoever is in front of them. Extras defer to the noble."""
    rng = random.Random(seed)
    dt = 1.0 / fps
    ST = STAGES[stage]
    SENTRY_POSTS, PORTER_LOOP = ST["sentry_posts"], ST["porter_loop"]
    NOBLE_PATH, PETITIONER_SPOT = ST["noble_path"], ST["petitioner_spot"]
    xmin, xmax, ymin, ymax = ST["bounds"]
    stalls = [p["loc"] for p in CASTLE_PROPS if p["dims"] == (2.2, 1.4, 1.9)]
    solid = [(p["loc"], max(p["dims"][:2]) * 0.5 + 0.45) for p in CASTLE_PROPS
             if p["dims"][2] < 3.0 or p["dims"][0] < 5.0]  # things extras walk around

    def crowd_color():
        r, g, b = rng.choice(CROWD_PALETTE)
        j = rng.uniform(0.75, 1.2)
        return (min(1, r * j), min(1, g * j), min(1, b * j), 1.0)

    # packs: type decides where they live and how they behave
    if ST["packs"] is not None:
        packs = list(ST["packs"])
    else:
        n_packs = max(6, n_crowd // 25)
        packs = []
        for _ in range(n_packs):
            r = rng.random()
            if r < 0.5:
                packs.append(("mill", (rng.uniform(-7.0, 17.0), rng.uniform(-16.0, 16.0))))
            elif r < 0.75:
                packs.append(("audience", (rng.uniform(5.5, 9.0), rng.uniform(0.5, 7.5))))
            else:
                packs.append(("traffic", None))
    weights = [rng.uniform(0.6, 2.0) for _ in packs]
    tw = sum(weights)
    counts = [max(1, round(w / tw * n_crowd)) for w in weights]
    while sum(counts) > n_crowd:
        counts[counts.index(max(counts))] -= 1
    while sum(counts) < n_crowd:
        counts[counts.index(min(counts))] += 1

    pos, vel, home, goal, speed, state, release, heading, cluster, col, small, wander = ([] for _ in range(12))
    for ci, ((ptype, center), cnt) in enumerate(zip(packs, counts)):
        for _ in range(cnt):
            if ptype == "traffic":
                if rng.random() < 0.6:  # arriving: outside the gate, walks to a stall
                    p = [rng.uniform(-27.0, -17.0), rng.uniform(-1.6, 1.6)]
                    sx, sy = rng.choice(stalls)
                    g = [sx + rng.uniform(-1.2, 1.2), sy - 2.2 * (1 if sy > 0 else -1)]
                    st = "go"
                else:                    # leaving: from inside, out through the gate
                    sx, sy = rng.choice(stalls)
                    p = [sx + rng.uniform(-2.0, 2.0), sy - 2.5 * (1 if sy > 0 else -1)]
                    g = [CASTLE_GATE_X, rng.uniform(-1.2, 1.2)]
                    st = "exit"
                rel = int(rng.uniform(0.0, 6.0) * fps)
            else:
                p = [center[0] + rng.gauss(0.0, 1.5), center[1] + rng.gauss(0.0, 1.5)]
                p = [max(xmin, min(xmax, p[0])), max(ymin, min(ymax, p[1]))]
                g = list(p)
                st = "audience" if ptype == "audience" else "mill"
                rel = 0
            pos.append(p); vel.append([0.0, 0.0]); home.append(list(g)); goal.append(g)
            speed.append(rng.uniform(0.8, 1.3)); state.append(st); release.append(rel)
            heading.append(rng.uniform(-math.pi, math.pi)); cluster.append(ci); col.append(crowd_color())
            small.append(rng.random() < 0.08); wander.append(int(rng.uniform(2.0, 6.0) * fps))
    n = len(pos)

    # heroes
    hero = {}
    hero["sentry"] = {"p": list(SENTRY_POSTS[0]), "v": [0.0, 0.0], "wp": 1, "halt": 0, "face": None,
                      "h": math.pi / 2, "ignore": {}}
    hero["porter"] = {"p": list(PORTER_LOOP[0]), "v": [0.0, 0.0], "wp": 1, "h": 0.0, "wait": 0, "push": 0}
    ax_, ay_ = NOBLE_PATH[0]; bx_, by_ = NOBLE_PATH[1]
    nd = math.hypot(bx_ - ax_, by_ - ay_)
    noble_speed = nd / max(1.0, 0.95 * n_frames / fps)
    hero["noble"] = {"p": [ax_, ay_], "v": [0.0, 0.0], "h": math.atan2(by_ - ay_, bx_ - ax_), "done": False}
    hero["herald"] = {"p": [DAIS[0], DAIS[1]], "h": math.pi}
    hero["petitioner"] = {"p": list(PETITIONER_SPOT), "h": math.pi, "sz": 0.55}
    tracks = {k: [] for k in hero}
    herald_arm, herald_sz, pet_sz = [], [], []
    ctracks = [[] for _ in range(n)]
    r2 = 0.9 * 0.9

    def ahead_of(hp, hh, rng_, skip=()):
        """nearest extra inside rng_ and in front of the hero (dot > 0.3)."""
        best, bd = None, rng_ * rng_
        for j in range(n):
            if j in skip:
                continue
            ox, oy = pos[j][0] - hp[0], pos[j][1] - hp[1]
            d2 = ox * ox + oy * oy
            if d2 < bd and (ox * math.cos(hh) + oy * math.sin(hh)) > 0.3 * math.sqrt(d2):
                best, bd = j, d2
        return best

    for f in range(n_frames):
        for i in range(n):
            ctracks[i].append((pos[i][0], pos[i][1], heading[i]))
        for k, hd in hero.items():
            tracks[k].append((hd["p"][0], hd["p"][1], hd["h"]))
        # herald: gesture cycle (raise / hold / lower / rest) + a bob while raised
        c = f % 60
        if c < 12:
            a = c / 12.0
        elif c < 30:
            a = 1.0
        elif c < 42:
            a = 1.0 - (c - 30) / 12.0
        else:
            a = 0.0
        herald_arm.append(math.pi - a * (math.pi - 0.4))
        herald_sz.append(1.0 + 0.03 * a)
        pet_sz.append(hero["petitioner"]["sz"])

        nb = hero["noble"]
        nb_moving = math.hypot(nb["v"][0], nb["v"][1]) > 0.3
        hero_pts = [hd["p"] for hd in hero.values()]

        new_vel = []
        for i in range(n):
            px, py = pos[i]
            if f < release[i]:
                new_vel.append([vel[i][0] * 0.8, vel[i][1] * 0.8]); continue
            st = state[i]
            if st == "go":
                gx, gy = goal[i][0] - px, goal[i][1] - py
                gd = math.hypot(gx, gy)
                if gd < 1.2:
                    state[i] = "mill"; home[i] = [px, py]; gd = max(gd, 1e-6)
                if px < CASTLE_GATE_X + 1.0:  # still outside: aim for the gap first
                    gx, gy = CASTLE_GATE_X + 2.0 - px, 0.0 - py; gd = math.hypot(gx, gy)
                dx, dy = gx / gd * speed[i], gy / gd * speed[i]
                vmax = MAX_SPEED
            elif st == "exit":
                if px > CASTLE_GATE_X - 0.5:
                    gx, gy = goal[i][0] - 1.0 - px, goal[i][1] - py
                else:
                    gx, gy = -40.0 - px, goal[i][1] * 0.3 - py
                gd = max(1e-6, math.hypot(gx, gy))
                dx, dy = gx / gd * speed[i], gy / gd * speed[i]
                vmax = MAX_SPEED
            else:  # mill / audience: arrive-damped to home; millers drift their home
                if st == "mill":
                    wander[i] -= 1
                    if wander[i] <= 0:
                        wander[i] = int(rng.uniform(2.0, 6.0) * fps)
                        home[i] = [max(xmin, min(xmax, home[i][0] + rng.gauss(0.0, 1.3))),
                                   max(ymin, min(ymax, home[i][1] + rng.gauss(0.0, 1.3)))]
                gx, gy = home[i][0] - px, home[i][1] - py
                gd = math.hypot(gx, gy)
                if gd > 0.05:
                    sc = speed[i] * min(1.0, gd)
                    dx, dy = gx / gd * sc, gy / gd * sc
                else:
                    dx = dy = 0.0
                vmax = MAX_SPEED
            # the noble comes through: step aside, perpendicular to his line
            nx, ny = px - nb["p"][0], py - nb["p"][1]
            nd2 = nx * nx + ny * ny
            defer = nb_moving and nd2 < DEFER_RANGE * DEFER_RANGE
            if defer:
                ux, uy = math.cos(nb["h"]), math.sin(nb["h"])
                proj = nx * ux + ny * uy
                perx, pery = nx - proj * ux, ny - proj * uy
                pm = math.hypot(perx, pery)
                if pm > 0.1:
                    dx, dy = perx / pm * DEFER_SPEED, pery / pm * DEFER_SPEED
            ax = (dx - vel[i][0]) / STEER_TAU
            ay = (dy - vel[i][1]) / STEER_TAU
            for j in range(n):
                if j == i:
                    continue
                ox, oy = px - pos[j][0], py - pos[j][1]
                d2 = ox * ox + oy * oy
                if 1e-9 < d2 < r2:
                    d = math.sqrt(d2)
                    w = REPULSE_K * (1.0 - d / 0.9) / d
                    ax += ox * w; ay += oy * w
            for hp in hero_pts:  # never stand inside a hero
                ox, oy = px - hp[0], py - hp[1]
                d2 = ox * ox + oy * oy
                if 1e-9 < d2 < 1.2 * 1.2:
                    d = math.sqrt(d2)
                    w = REPULSE_K * 1.5 * (1.0 - d / 1.2) / d
                    ax += ox * w; ay += oy * w
            for (sx, sy), rad in solid:  # walk around stalls, the well, the dais
                ox, oy = px - sx, py - sy
                d2 = ox * ox + oy * oy
                if 1e-9 < d2 < rad * rad:
                    d = math.sqrt(d2)
                    w = REPULSE_K * 2.0 * (1.0 - d / rad) / d
                    ax += ox * w; ay += oy * w
            ax += JITTER * rng.gauss(0.0, 1.0); ay += JITTER * rng.gauss(0.0, 1.0)
            vx = vel[i][0] + ax * dt; vy = vel[i][1] + ay * dt
            v = math.hypot(vx, vy)
            if v > vmax:
                vx, vy = vx / v * vmax, vy / v * vmax
            new_vel.append([vx, vy])

        # ---- heroes react to what is in front of them ----
        se = hero["sentry"]
        se["ignore"] = {j: t - 1 for j, t in se["ignore"].items() if t > 1}
        if se["halt"] > 0:
            se["halt"] -= 1; se["v"] = [0.0, 0.0]
            if se["face"] is not None:
                tp = pos[se["face"]]
                se["h"] = _turn(se["h"], math.atan2(tp[1] - se["p"][1], tp[0] - se["p"][0]))
            if se["halt"] == 0 and se["face"] is not None:  # looked them over; move on
                se["ignore"][se["face"]] = 4 * PATIENCE_FRAMES
        elif math.hypot(nb["p"][0] - se["p"][0], nb["p"][1] - se["p"][1]) < 2.6:
            se["v"] = [0.0, 0.0]  # the noble passes: stand and face him
            se["h"] = _turn(se["h"], math.atan2(nb["p"][1] - se["p"][1], nb["p"][0] - se["p"][0]))
        else:
            j = ahead_of(se["p"], se["h"], REACT_RANGE, skip=se["ignore"])
            if j is not None:
                se["halt"], se["face"], se["v"] = HALT_FRAMES, j, [0.0, 0.0]
            else:
                wx, wy = SENTRY_POSTS[se["wp"]]
                gx, gy = wx - se["p"][0], wy - se["p"][1]
                gd = math.hypot(gx, gy)
                if gd < 0.35:
                    se["wp"] = 1 - se["wp"]
                else:
                    se["v"] = [gx / gd * 0.8, gy / gd * 0.8]
                    se["h"] = _turn(se["h"], math.atan2(gy, gx))
        po = hero["porter"]
        if po["push"] > 0:  # patience ran out: shoulders through (hero repulsion clears the way)
            po["push"] -= 1
            j = None
        else:
            j = ahead_of(po["p"], po["h"], 1.4)
        if j is not None:  # somebody in the way: stop, look at them
            po["wait"] += 1
            if po["wait"] >= PATIENCE_FRAMES:
                po["wait"], po["push"] = 0, 2 * PATIENCE_FRAMES
            po["v"] = [0.0, 0.0]
            tp = pos[j]
            po["h"] = _turn(po["h"], math.atan2(tp[1] - po["p"][1], tp[0] - po["p"][0]))
        else:
            po["wait"] = max(0, po["wait"] - 1)
            wx, wy = PORTER_LOOP[po["wp"]]
            gx, gy = wx - po["p"][0], wy - po["p"][1]
            gd = math.hypot(gx, gy)
            if gd < 0.5:
                po["wp"] = (po["wp"] + 1) % len(PORTER_LOOP)
            else:
                po["v"] = [gx / gd * 1.1, gy / gd * 1.1]
                po["h"] = _turn(po["h"], math.atan2(gy, gx))
        if not nb["done"]:
            gx, gy = bx_ - nb["p"][0], by_ - nb["p"][1]
            gd = math.hypot(gx, gy)
            if gd < 0.4:
                nb["done"], nb["v"] = True, [0.0, 0.0]
            else:
                nb["v"] = [gx / gd * noble_speed, gy / gd * noble_speed]
        else:  # arrived: turns to survey the yard
            nb["h"] = _turn(nb["h"], math.atan2(0.0 - nb["p"][1], 4.0 - nb["p"][0]), 0.08)
        he = hero["herald"]
        cx = cy = 0.0; cnt = 0
        for j in range(n):
            if math.hypot(pos[j][0] - he["p"][0], pos[j][1] - he["p"][1]) < AUDIENCE_RANGE:
                cx += pos[j][0]; cy += pos[j][1]; cnt += 1
        if cnt:
            he["h"] = _turn(he["h"], math.atan2(cy / cnt - he["p"][1], cx / cnt - he["p"][0]), 0.1)
        pe = hero["petitioner"]
        dn = math.hypot(nb["p"][0] - pe["p"][0], nb["p"][1] - pe["p"][1])
        if dn < RISE_RANGE:
            pe["sz"] = min(1.0, pe["sz"] + 1.0 / 12.0)
            pe["h"] = _turn(pe["h"], math.atan2(nb["p"][1] - pe["p"][1], nb["p"][0] - pe["p"][0]), 0.35)
        elif dn > SINK_RANGE:
            pe["sz"] = max(0.55, pe["sz"] - 1.0 / 24.0)

        # ---- integrate ----
        for i in range(n):
            vel[i] = new_vel[i]
            pos[i][0] += vel[i][0] * dt; pos[i][1] += vel[i][1] * dt
            v = math.hypot(vel[i][0], vel[i][1])
            if v > 0.15:
                heading[i] = _turn(heading[i], math.atan2(vel[i][1], vel[i][0]))
            else:  # idle: face whichever hero is closest and near — the audience effect
                best, bd = None, 6.0 * 6.0
                for hp in hero_pts:
                    d2 = (hp[0] - pos[i][0]) ** 2 + (hp[1] - pos[i][1]) ** 2
                    if d2 < bd:
                        best, bd = hp, d2
                if best is not None:
                    heading[i] = _turn(heading[i], math.atan2(best[1] - pos[i][1], best[0] - pos[i][0]), 0.12)
        for k in ("sentry", "porter", "noble"):
            hd = hero[k]
            hd["p"][0] += hd["v"][0] * dt; hd["p"][1] += hd["v"][1] * dt
            if k == "noble" and not hd["done"]:
                hd["h"] = _turn(hd["h"], math.atan2(hd["v"][1], hd["v"][0]))

    agents = [dict(p, kind="prop") for p in CASTLE_PROPS]
    agents += [{"kind": "person", "color": col[i], "cluster": cluster[i], "small": small[i],
                "track": ctracks[i]} for i in range(n)]
    colors = dict(HERO_COLORS)
    agents.append({"kind": "hero", "role": "sentry", "color": colors["sentry"], "track": tracks["sentry"]})
    agents.append({"kind": "hero", "role": "herald", "color": colors["herald"], "track": tracks["herald"],
                   "z": DAIS[2], "arm": herald_arm, "sz": herald_sz})
    agents.append({"kind": "hero", "role": "porter", "color": colors["porter"], "track": tracks["porter"],
                   "carry": True})
    agents.append({"kind": "hero", "role": "noble", "color": colors["noble"], "track": tracks["noble"]})
    agents.append({"kind": "hero", "role": "petitioner", "color": colors["petitioner"],
                   "track": tracks["petitioner"], "sz": pet_sz})
    return agents


def simulate_quiet(n_frames, fps, seed, stage="quiet"):
    """The held frame: heroes and extras stand; a cat walks through the foreground."""
    rng = random.Random(seed)
    ST = STAGES[stage]
    dt = 1.0 / fps
    colors = dict(HERO_COLORS)
    agents = [dict(p, kind="prop") for p in CASTLE_PROPS]
    palette = list(CROWD_PALETTE)
    for k, (ex, ey) in enumerate(ST["extras"][:max(0, min(len(ST["extras"]), n_frames and 10 ** 6))]):
        r, g, b = palette[k % len(palette)]
        j = rng.uniform(0.8, 1.15)
        h = math.pi + rng.uniform(-0.6, 0.6)  # roughly toward the lens, each a little off
        agents.append({"kind": "person", "color": (min(1, r * j), min(1, g * j), min(1, b * j), 1.0),
                       "small": rng.random() < 0.1, "track": [(ex, ey, h)] * n_frames})
    still = lambda x, y, h: [(x, y, h)] * n_frames
    for role, y in ST["row"]:
        a = {"kind": "hero", "role": role, "color": colors[role], "track": still(ST["row_x"], y, math.pi)}
        if role == "porter":
            a["carry"] = True
        if role == "petitioner":
            a["sz"] = [0.55] * n_frames  # crouched, held
        agents.append(a)
    agents.append({"kind": "hero", "role": "herald", "color": colors["herald"], "z": DAIS[2],
                   "track": still(DAIS[0], DAIS[1], math.pi), "arm": [math.pi] * n_frames})
    # the cat: enters frame left, sits mid-frame to look at the row, walks off right
    C = ST["cat"]
    y, seg = C["y_from"], "in"
    sit_left = C["sit_s"] * fps
    track = []
    for f in range(n_frames):
        moving = f >= C["start_s"] * fps and seg != "done"
        if seg == "sit":
            head = math.pi - 0.15  # facing the heroes, a flick of the head
            sit_left -= 1
            if sit_left <= 0:
                seg = "out"
        else:
            head = -math.pi / 2  # walking toward -y (viewer's right)
        track.append((C["x"], y, head))
        if moving and seg in ("in", "out"):
            y -= C["speed"] * dt
            if seg == "in" and y <= C["sit_y"]:
                seg = "sit"
            if y <= C["y_to"]:
                seg = "done"
    agents.append({"kind": "cat", "color": (0.38, 0.35, 0.31, 1.0), "track": track})
    return agents


GOLDEN = 0.6180339887  # hue stepping that keeps consecutive ids far apart


def simulate_arrival(n_walkers, n_frames, fps, seed):
    """The rider walks in through the gate; townsfolk stream both ways on both verges,
    some cut across the road, everyone funnels into the gate gap and steps off the
    road when the horse is on them. The horse is LAST (the camera's subject)."""
    rng = random.Random(seed)
    dt = 1.0 / fps
    agents = [dict(p, kind="prop") for p in CASTLE_PROPS]
    x0, x1 = ARRIVAL_SPAN
    walkers = []
    for _ in range(n_walkers):
        side = 1.0 if rng.random() < 0.5 else -1.0
        lane = rng.uniform(*ARRIVAL_VERGE)
        walkers.append({"p": [rng.uniform(x0, x1), side * lane], "side": side, "lane": lane,
                        "dir": 1.0 if rng.random() < 0.5 else -1.0, "speed": rng.uniform(0.8, 1.5),
                        "cross_at": rng.uniform(0.5, 7.0) * fps if rng.random() < 0.35 else None,
                        "crossing": False, "h": 0.0, "wph": rng.uniform(0.0, 2.0 * math.pi), "track": []})
    hx = ARRIVAL_HORSE_X0
    htrack = []
    for f in range(n_frames):
        for w in walkers:
            x, y = w["p"]
            near_gate = abs(x - CASTLE_GATE_X) < 6.0
            lane = min(w["lane"], ARRIVAL_GATE_GAP) if near_gate else w["lane"]  # the gate funnel
            if w["cross_at"] is not None and f >= w["cross_at"] and not near_gate:
                w["crossing"], w["side"], w["cross_at"] = True, -w["side"], None  # cut across the road
            ty = w["side"] * lane
            if w["crossing"] and abs(ty - y) < 0.25:
                w["crossing"] = False
            vx = w["dir"] * w["speed"] * (0.45 if w["crossing"] else 1.0)
            vy = max(-1.7, min(1.7, (ty - y) * 2.0)) + 0.25 * math.sin(0.9 * f * dt + w["wph"])
            if abs(x - hx) < 3.5 and abs(y) < ARRIVAL_ROAD_HALF + 0.3:  # off the road, the horse is here
                vy += (1.0 if y >= 0.0 else -1.0) * 1.8
                vx *= 0.3
            for o in walkers:  # light shoulder-to-shoulder repulsion
                if o is w:
                    continue
                dx, dy = x - o["p"][0], y - o["p"][1]
                d2 = dx * dx + dy * dy
                if 1e-6 < d2 < 0.81:
                    d = math.sqrt(d2)
                    k = (0.9 - d) * 2.5 / d
                    vx += dx * k
                    vy += dy * k
            w["_v"] = (vx, vy)
        for w in walkers:
            vx, vy = w["_v"]
            if abs(vx) + abs(vy) > 0.05:
                w["h"] = _turn(w["h"], math.atan2(vy, vx), 0.25)
            w["track"].append((w["p"][0], w["p"][1], w["h"]))
            w["p"][0] += vx * dt
            w["p"][1] += vy * dt
            if w["p"][0] > x1 + 1.0:   # leaving one end re-enters the other, off-screen
                w["p"][0] = x0 - 1.0
            elif w["p"][0] < x0 - 1.0:
                w["p"][0] = x1 + 1.0
        htrack.append((hx, 0.0, 0.0))
        hx += ARRIVAL_HORSE_SPEED * dt
    palette = list(CROWD_PALETTE)
    for k, w in enumerate(walkers):
        r, g, b = palette[k % len(palette)]
        j = rng.uniform(0.8, 1.15)
        agents.append({"kind": "person", "color": (min(1, r * j), min(1, g * j), min(1, b * j), 1.0),
                       "small": rng.random() < 0.08, "track": w["track"]})
    agents.append({"kind": "horse", "hero": True, "color": ARRIVAL_HORSE_COLOR,
                   "rider_color": ARRIVAL_RIDER_COLOR, "track": htrack})
    return agents


def apply_colorize(agents, mode):
    """Recolour agents into a control-signal palette (segmentation-style ID pass).

    id: unique hue per agent (survives 8-bit encoding far better than unique
    grays — 600 agents cannot occupy 256 distinguishable grey levels).
    cluster: one hue per horde pack. gray: evenly spaced grey per pack.
    Agents without a pack (defenders, the horse) render white.
    """
    if mode == "film":
        return
    # heroes are NEVER recoloured — their colour IS the identity binding across passes
    people = [a for a in agents if a["kind"] in ("person", "horse", "cat") and not a.get("hero")]
    if mode == "id":
        for k, agent in enumerate(people):
            r, g, b = colorsys.hsv_to_rgb((k * GOLDEN) % 1.0, 0.75, 0.95)
            agent["color"] = (r, g, b, 1.0)
        return
    clusters = sorted({a["cluster"] for a in people if "cluster" in a})
    for agent in people:
        if "cluster" not in agent:
            agent["color"] = (1.0, 1.0, 1.0, 1.0)
        elif mode == "cluster":
            r, g, b = colorsys.hsv_to_rgb((clusters.index(agent["cluster"]) * GOLDEN) % 1.0,
                                          0.8, 0.95)
            agent["color"] = (r, g, b, 1.0)
        else:  # gray
            t = clusters.index(agent["cluster"]) / max(1, len(clusters) - 1)
            g = 0.15 + 0.75 * t
            agent["color"] = (g, g, g, 1.0)


# ------------------------------------------------------------- scene building

def clear_previous():
    """Delete crowd_* objects from earlier runs; headless, wipe the startup scene too."""
    if bpy.app.background:
        stale = list(bpy.data.objects)
    else:
        stale = [o for o in bpy.data.objects if o.name.startswith(PREFIX)]
    for obj in stale:
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.cameras, bpy.data.actions):
        for block in [b for b in coll if b.users == 0]:
            coll.remove(block)


def make_box_mesh(name, sx, sy, sz):
    """Axis-aligned box, origin at the base centre (sits on the floor)."""
    hx, hy = sx / 2.0, sy / 2.0
    verts = [(-hx, -hy, 0.0), (hx, -hy, 0.0), (hx, hy, 0.0), (-hx, hy, 0.0),
             (-hx, -hy, sz), (hx, -hy, sz), (hx, hy, sz), (-hx, hy, sz)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7),
             (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    return mesh


def make_floor_mesh(name, sx, sy):
    hx, hy = sx / 2.0, sy / 2.0
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(-hx, -hy, 0.0), (hx, -hy, 0.0), (hx, hy, 0.0), (-hx, hy, 0.0)],
                     [], [(0, 1, 2, 3)])
    mesh.validate()
    mesh.update()
    return mesh


def new_fcurves(obj, action, channels):
    """Create fcurves for obj on action; slotted actions (4.4+) with legacy fallback."""
    adt = obj.animation_data_create()
    adt.action = action
    try:
        slot = action.slots.new(id_type='OBJECT', name=obj.name)
        adt.action_slot = slot
        layer = action.layers[0] if len(action.layers) else action.layers.new("base")
        strip = layer.strips[0] if len(layer.strips) else layer.strips.new(type='KEYFRAME')
        try:
            bag = strip.channelbag(slot, ensure=True)
        except TypeError:
            bag = strip.channelbags.new(slot)
        return [bag.fcurves.new(path, index=idx) for path, idx in channels]
    except AttributeError:
        return [action.fcurves.new(path, index=idx) for path, idx in channels]


def keyframe_channels(obj, channels, samples):
    """Keyframe obj every frame (linear); samples[k] holds one value per channel."""
    action = bpy.data.actions.new(PREFIX + "act_" + obj.name)
    fcurves = new_fcurves(obj, action, channels)
    n = len(samples)
    for channel, fc in enumerate(fcurves):
        fc.keyframe_points.add(n)
        co = [0.0] * (2 * n)
        for k in range(n):
            co[2 * k] = float(k + 1)
            co[2 * k + 1] = samples[k][channel]
        fc.keyframe_points.foreach_set("co", co)
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
        fc.update()


def animate(obj, track):
    keyframe_channels(obj, [("location", 0), ("location", 1), ("rotation_euler", 2)],
                      track)


def smooth_follow(track, fps, tau):
    """Exponentially chase the subject's x/y — eased, slightly lagged camera path."""
    alpha = min(1.0, (1.0 / fps) / tau)
    sx, sy = track[0][0], track[0][1]
    out = []
    for x, y, _heading in track:
        sx += (x - sx) * alpha
        sy += (y - sy) * alpha
        out.append((sx, sy))
    return out


def camera_positions(preset, subject, n_frames, fps):
    """Per-frame camera location: crane path, follow dolly, or planted position."""
    if "path" in preset:
        (ax, ay, az), (bx, by, bz), f0, f1 = preset["path"]
        out = []
        for f in range(n_frames):
            u = min(1.0, max(0.0, (f - f0) / float(f1 - f0)))
            s = u * u * (3.0 - 2.0 * u)  # smoothstep — eased crane move
            out.append((ax + (bx - ax) * s, ay + (by - ay) * s, az + (bz - az) * s))
        return out
    if "follow" in preset and subject:
        ox, oy, oz = preset["follow"]
        return [(x + ox, y + oy, oz) for x, y in smooth_follow(subject, fps, FOLLOW_TAU)]
    n = n_frames if preset.get("shake") else 1
    return [tuple(preset["loc"])] * n


def proximity_ramp(positions, subject):
    """Shake multiplier per frame — builds as the horse closes on the camera."""
    out = []
    for k, (cx, cy, _cz) in enumerate(positions):
        hx, hy, _h = subject[min(k, len(subject) - 1)]
        t = max(0.0, 1.0 - math.hypot(hx - cx, hy - cy) / SHAKE_PROX_RANGE)
        out.append(1.0 + 3.0 * t * t)
    return out


def handheld_offsets(n, fps, rng, amp, prox):
    """Deterministic handheld noise: layered sines, damped vertically."""
    phases = [[rng.uniform(0.0, 2.0 * math.pi) for _ in SHAKE_FREQS] for _ in range(3)]
    out = []
    for f in range(n):
        t = f / fps
        scale = amp * prox[f]
        vec = []
        for axis in range(3):
            v = 0.0
            for k, (freq, rel) in enumerate(SHAKE_FREQS):
                v += rel * math.sin(2.0 * math.pi * freq * (1.0 + 0.17 * axis) * t
                                    + phases[axis][k])
            vec.append(v * scale * (0.6 if axis == 2 else 1.0))
        out.append(vec)
    return out


def build_scene(scene, agents, seed, scenario, colorize="film"):
    look_rng = random.Random(seed + 1)  # cosmetic variation, still seed-driven

    floor = bpy.data.objects.new(PREFIX + "floor",
                                 make_floor_mesh(PREFIX + "floor_mesh",
                                                 *FLOOR_SIZES[scenario]))
    floor.color = FLOOR_COLORS[scenario] if colorize == "film" else (0.0, 0.0, 0.0, 1.0)
    scene.collection.objects.link(floor)

    person_mesh = make_box_mesh(PREFIX + "agent_mesh", *AGENT_DIMS)
    horse_mesh = rider_mesh = None
    prop_meshes = {}
    for i, agent in enumerate(agents):
        if agent["kind"] == "prop":  # static set dressing (building, barricades)
            dims = agent["dims"]
            if dims not in prop_meshes:
                prop_meshes[dims] = make_box_mesh(f"{PREFIX}prop_mesh_{len(prop_meshes)}",
                                                  *dims)
            obj = bpy.data.objects.new(f"{PREFIX}prop_{i:03d}", prop_meshes[dims])
            obj.color = agent["color"] if colorize == "film" else (0.04, 0.04, 0.045, 1.0)
            obj.location = (agent["loc"][0], agent["loc"][1], 0.0)
            scene.collection.objects.link(obj)
            continue
        track = agent["track"]
        if agent["kind"] == "cat":
            if "cat" not in prop_meshes:
                prop_meshes["cat"] = make_box_mesh(PREFIX + "cat_mesh", 0.42, 0.16, 0.22)
                prop_meshes["cathead"] = make_box_mesh(PREFIX + "cathead_mesh", 0.15, 0.15, 0.15)
                prop_meshes["cattail"] = make_box_mesh(PREFIX + "cattail_mesh", 0.05, 0.05, 0.3)
            obj = bpy.data.objects.new(f"{PREFIX}cat_{i:03d}", prop_meshes["cat"])
            obj.color = agent["color"]
            obj.location = (track[0][0], track[0][1], 0.1)  # legs implied by the gap
            obj.rotation_euler = (0.0, 0.0, track[0][2])
            scene.collection.objects.link(obj)
            for part, loc, rot in (("cathead", (0.24, 0.0, 0.14), (0.0, 0.0, 0.0)),
                                   ("cattail", (-0.2, 0.0, 0.18), (0.0, math.radians(-40.0), 0.0))):
                child = bpy.data.objects.new(f"{PREFIX}cat_{i:03d}_{part}", prop_meshes[part])
                child.color = agent["color"]
                child.parent = obj
                child.location = loc
                child.rotation_euler = rot
                scene.collection.objects.link(child)
            animate(obj, track)
            continue
        if agent["kind"] == "hero":
            if "hero" not in prop_meshes:
                prop_meshes["hero"] = make_box_mesh(PREFIX + "hero_mesh", 0.5, 0.5, 1.55)
                prop_meshes["head"] = make_box_mesh(PREFIX + "head_mesh", 0.34, 0.34, 0.34)
                prop_meshes["arm"] = make_box_mesh(PREFIX + "arm_mesh", 0.14, 0.14, 0.75)
                prop_meshes["crate"] = make_box_mesh(PREFIX + "crate_mesh", 0.6, 0.5, 0.45)
            obj = bpy.data.objects.new(f"{PREFIX}hero_{agent['role']}", prop_meshes["hero"])
            obj.color = agent["color"]
            obj.location = (track[0][0], track[0][1], agent.get("z", 0.0))
            obj.rotation_euler = (0.0, 0.0, track[0][2])
            scene.collection.objects.link(obj)
            # every part wears the hero's colour: ONE colour = ONE silhouette = ONE identity
            for part, mesh_key, loc in (("head", "head", (0.0, 0.0, 1.6)),
                                        ("arm", "arm", (0.0, 0.36, 1.45)),
                                        ("crate", "crate", (0.45, 0.0, 1.0))):
                if part == "arm" and not agent.get("arm"):
                    continue
                if part == "crate" and not agent.get("carry"):
                    continue
                child = bpy.data.objects.new(f"{PREFIX}hero_{agent['role']}_{part}", prop_meshes[mesh_key])
                child.color = agent["color"]
                child.parent = obj
                child.location = loc
                scene.collection.objects.link(child)
                if part == "arm":  # hangs at rest (pi about Y), swings up to address the crowd
                    child.rotation_euler = (0.0, agent["arm"][0], 0.0)
                    keyframe_channels(child, [("rotation_euler", 1)], [(a,) for a in agent["arm"]])
            channels = [("location", 0), ("location", 1), ("rotation_euler", 2)]
            samples = [list(t) for t in track]
            if agent.get("sz"):  # crouch/rise or a speaking bob — z-scale keyed with the motion
                channels.append(("scale", 2))
                for k, v in enumerate(agent["sz"]):
                    samples[k].append(v)
            keyframe_channels(obj, channels, samples)
            continue
        if agent["kind"] == "horse":
            if horse_mesh is None:
                horse_mesh = make_box_mesh(PREFIX + "horse_mesh", *HORSE_DIMS)
                rider_mesh = make_box_mesh(PREFIX + "rider_mesh", *RIDER_DIMS)
            obj = bpy.data.objects.new(f"{PREFIX}horse_{i:03d}", horse_mesh)
            rider = bpy.data.objects.new(f"{PREFIX}rider_{i:03d}", rider_mesh)
            rider.color = agent.get("rider_color", RIDER_COLOR)
            rider.parent = obj  # rides along; slightly forward of the horse's middle
            rider.location = (0.15, 0.0, HORSE_DIMS[2])
            scene.collection.objects.link(rider)
        else:
            obj = bpy.data.objects.new(f"{PREFIX}agent_{i:03d}", person_mesh)
            s = look_rng.uniform(0.85, 1.1)
            zs = 0.6 if agent.get("small") else look_rng.uniform(0.88, 1.06)  # a few children in the mix
            obj.scale = (s, s, zs)
        obj.color = agent["color"]
        obj.location = (track[0][0], track[0][1], 0.0)
        obj.rotation_euler = (0.0, 0.0, track[0][2])
        scene.collection.objects.link(obj)
        animate(obj, track)


def build_camera(scene, scenario, preset_name, subject=None, fps=24, n_frames=1, seed=7):
    """subject = a track [(x, y, heading), ...] the camera follows (e.g. the horse)."""
    preset = CAMERA_PRESETS[scenario][preset_name]
    cam_data = bpy.data.cameras.new(PREFIX + "cam")
    cam_data.lens = preset["lens"]
    cam_data.clip_end = 500.0
    cam = bpy.data.objects.new(PREFIX + "cam", cam_data)
    scene.collection.objects.link(cam)

    positions = camera_positions(preset, subject, n_frames, fps)
    aim_shake = None
    if preset.get("shake"):
        rng = random.Random(seed + 2)
        prox = proximity_ramp(positions, subject) if subject else [1.0] * len(positions)
        cam_shake = handheld_offsets(len(positions), fps, rng, preset["shake"], prox)
        positions = [(p[0] + s[0], p[1] + s[1], p[2] + s[2])
                     for p, s in zip(positions, cam_shake)]
        aim_shake = handheld_offsets(len(positions), fps, rng, 0.6 * preset["shake"], prox)

    cam.location = positions[0]
    if len(positions) > 1:
        keyframe_channels(cam, [("location", 0), ("location", 1), ("location", 2)],
                          positions)

    if "rot" in preset:  # fixed orientation (controls frame roll, e.g. overhead)
        cam.rotation_euler = preset["rot"]
    else:  # aim at the subject if tracking, else at the middle of the action
        target = bpy.data.objects.new(PREFIX + "cam_target", None)
        scene.collection.objects.link(target)
        if subject:
            aim = smooth_follow(subject, fps, preset.get("aim_tau", AIM_TAU))
            aim_z = preset.get("aim_z", 1.2)
            samples = [(x + (aim_shake[k][0] if aim_shake else 0.0),
                        y + (aim_shake[k][1] if aim_shake else 0.0),
                        aim_z + (aim_shake[k][2] if aim_shake else 0.0))
                       for k, (x, y) in enumerate(aim)]
            target.location = samples[0]
            keyframe_channels(target, [("location", 0), ("location", 1), ("location", 2)],
                              samples)
        else:
            target.location = preset.get("target", (0.0, 0.0, 1.0))
        track = cam.constraints.new('TRACK_TO')
        track.target = target
        track.track_axis = 'TRACK_NEGATIVE_Z'
        track.up_axis = 'UP_Y'
    scene.camera = cam


def configure_render(scene, args, stem):
    scene.frame_start = 1
    scene.frame_end = args.frames
    scene.render.fps = args.fps
    width, height = (int(v) for v in args.res.lower().split("x"))
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100

    scene.render.engine = 'BLENDER_WORKBENCH'  # instant
    shading = scene.display.shading
    shading.color_type = 'OBJECT'
    if args.colorize == "film":
        shading.light = 'STUDIO'
        shading.show_cavity = True
        background = (0.12, 0.13, 0.15)
    else:  # ID pass: unlit flat colours, black void — signal purity over looks
        shading.light = 'FLAT'
        shading.show_cavity = False
        background = (0.0, 0.0, 0.0)
    try:
        shading.background_type = 'VIEWPORT'
        shading.background_color = background
    except (AttributeError, TypeError):
        pass  # fall back to theme background on older builds
    scene.display.render_aa = '8'

    if hasattr(scene.render.image_settings, "media_type"):
        scene.render.image_settings.media_type = 'VIDEO'  # Blender 5.x gates FFMPEG behind this
    scene.render.image_settings.file_format = 'FFMPEG'
    scene.render.ffmpeg.format = 'MPEG4'
    scene.render.ffmpeg.codec = 'H264'
    scene.render.ffmpeg.constant_rate_factor = 'HIGH'
    scene.render.filepath = stem  # stem only, no .mp4 — Blender appends frame range


def main():
    args = parse_args()

    if args.frames is None:
        args.frames = 240 if args.scenario == "arrival" else 250
    if args.colorize is None:  # the arrival plate IS a mask: unlit solid colours on black
        args.colorize = "id" if args.scenario == "arrival" else "film"
    if args.camera is None:
        args.camera = {"clash": "high45", "charge": "headon", "horde": "aerial",
                       "castle": "medium", "arrival": "lead"}[args.scenario]
    elif args.camera not in CAMERA_PRESETS[args.scenario]:
        raise SystemExit(f"--camera {args.camera} is not a {args.scenario} preset; "
                         f"pick from {sorted(CAMERA_PRESETS[args.scenario])}")
    stage = CAMERA_PRESETS[args.scenario][args.camera].get("stage", "wide")
    if args.agents is None:
        args.agents = {"clash": 100, "charge": 30, "horde": 600, "arrival": 44,
                       "castle": STAGES[stage]["agents"]}[args.scenario]
    if args.res is None:
        args.res = "1280x720" if args.scenario in ("clash", "castle", "arrival") else "1280x536"  # 2.39:1 scope

    if args.out:
        stem = os.path.abspath(args.out)
    else:
        base = os.path.dirname(os.path.abspath(__file__))
        suffix = "" if args.colorize == "film" else f"_{args.colorize}"
        stem = os.path.join(base, "render",
                            f"blockout_{args.scenario}_{args.camera}{suffix}")
    os.makedirs(os.path.dirname(stem), exist_ok=True)

    print(f"[crowd_blockout] scenario={args.scenario} agents={args.agents} "
          f"frames={args.frames} seed={args.seed} camera={args.camera} -> {stem}")

    simulate = {"clash": simulate_clash, "charge": simulate_charge, "arrival": simulate_arrival,
                "horde": simulate_horde, "castle": simulate_castle}[args.scenario]
    if args.scenario == "castle" and stage == "quiet":
        agents = simulate_quiet(args.frames, args.fps, args.seed, stage=stage)
    elif args.scenario == "castle":
        agents = simulate_castle(args.agents, args.frames, args.fps, args.seed, stage=stage)
    else:
        agents = simulate(args.agents, args.frames, args.fps, args.seed)
    apply_colorize(agents, args.colorize)

    scene = bpy.context.scene
    clear_previous()
    build_scene(scene, agents, args.seed, args.scenario, args.colorize)
    subject = agents[-1]["track"] if agents[-1]["kind"] == "horse" else None
    build_camera(scene, args.scenario, args.camera, subject=subject, fps=args.fps,
                 n_frames=args.frames, seed=args.seed)
    configure_render(scene, args, stem)

    if args.still is not None:
        if hasattr(scene.render.image_settings, "media_type"):
            scene.render.image_settings.media_type = 'IMAGE'
        scene.render.image_settings.file_format = 'PNG'
        scene.render.filepath = f"{stem}_still{args.still:04d}"
        scene.frame_set(args.still)
        bpy.ops.render.render(write_still=True)
        print(f"[crowd_blockout] wrote {scene.render.filepath}.png")
    else:
        bpy.ops.render.render(animation=True)
        print(f"[crowd_blockout] wrote {stem}{scene.frame_start:04d}-{scene.frame_end:04d}.mp4")


if __name__ == "__main__":
    main()
