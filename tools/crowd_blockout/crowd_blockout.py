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
FLOOR_SIZES = {"clash": (52.0, 30.0), "charge": (52.0, 30.0), "horde": (190.0, 140.0)}
FLOOR_COLORS = {"clash": (0.55, 0.53, 0.50, 1.0), "charge": (0.55, 0.53, 0.50, 1.0),
                "horde": (0.30, 0.40, 0.26, 1.0)}  # lawn

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

# Per-scenario framing: clash spreads ~28m across the field, charge is a ~9m crowd
# plus a gallop lane, so its cameras sit much closer. "rot" = fixed orientation
# (controls frame roll, e.g. overhead); otherwise the camera tracks "target".
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
    parser.add_argument("--scenario", choices=["clash", "charge", "horde"], default="clash",
                        help="clash: two armies cross; charge: horse warrior through a "
                             "crowd; horde: zombie flood vs defended perimeter (aerial)")
    parser.add_argument("--agents", type=int, default=None,
                        help="crowd size (default: 100 clash, 30 charge, 400 horde)")
    parser.add_argument("--frames", type=int, default=250)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--camera", choices=ALL_CAMERAS, default=None,
                        help="per scenario; default: high45 (clash), headon (charge)")
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--res", default=None,
                        help="WxH; default 1280x720 (clash), 1280x536 scope (charge)")
    parser.add_argument("--colorize", choices=["film", "id", "cluster", "gray"],
                        default="film",
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


GOLDEN = 0.6180339887  # hue stepping that keeps consecutive ids far apart


def apply_colorize(agents, mode):
    """Recolour agents into a control-signal palette (segmentation-style ID pass).

    id: unique hue per agent (survives 8-bit encoding far better than unique
    grays — 600 agents cannot occupy 256 distinguishable grey levels).
    cluster: one hue per horde pack. gray: evenly spaced grey per pack.
    Agents without a pack (defenders, the horse) render white.
    """
    if mode == "film":
        return
    people = [a for a in agents if a["kind"] in ("person", "horse")]
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
        if agent["kind"] == "horse":
            if horse_mesh is None:
                horse_mesh = make_box_mesh(PREFIX + "horse_mesh", *HORSE_DIMS)
                rider_mesh = make_box_mesh(PREFIX + "rider_mesh", *RIDER_DIMS)
            obj = bpy.data.objects.new(f"{PREFIX}horse_{i:03d}", horse_mesh)
            rider = bpy.data.objects.new(f"{PREFIX}rider_{i:03d}", rider_mesh)
            rider.color = RIDER_COLOR
            rider.parent = obj  # rides along; slightly forward of the horse's middle
            rider.location = (0.15, 0.0, HORSE_DIMS[2])
            scene.collection.objects.link(rider)
        else:
            obj = bpy.data.objects.new(f"{PREFIX}agent_{i:03d}", person_mesh)
            s = look_rng.uniform(0.85, 1.1)
            obj.scale = (s, s, look_rng.uniform(0.9, 1.05))
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

    if args.agents is None:
        args.agents = {"clash": 100, "charge": 30, "horde": 600}[args.scenario]
    if args.camera is None:
        args.camera = {"clash": "high45", "charge": "headon", "horde": "aerial"}[args.scenario]
    elif args.camera not in CAMERA_PRESETS[args.scenario]:
        raise SystemExit(f"--camera {args.camera} is not a {args.scenario} preset; "
                         f"pick from {sorted(CAMERA_PRESETS[args.scenario])}")
    if args.res is None:
        args.res = "1280x720" if args.scenario == "clash" else "1280x536"  # 2.39:1 scope

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

    simulate = {"clash": simulate_clash, "charge": simulate_charge,
                "horde": simulate_horde}[args.scenario]
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
