#!/usr/bin/env python3
"""
Generate a COMPLEX 3D pose / skeleton video for use as a motion-control input to Seedance 2.0.

Unlike the simple jumping-jack clip, this drives a proper hierarchical forward-kinematics
rig (bending elbows and knees, torso lean/twist, head tracking, weight shifts) through a
keyframed multi-phase choreography:

    wind-up  ->  overhead reach with twist  ->  full 360 spin  ->  front kick
             ->  alternating punch combo     ->  settle

Output: 720p 9:16 portrait H.264 (matches the resolution the film suite drives Seedance
with; portrait suits a single full body). OpenPose-style colored limbs, depth-shaded
joints, perspective floor, and per-foot contact shadows.

No matplotlib: 3D joints are computed by FK, projected with a pinhole camera, and
rasterized straight into a numpy frame buffer, then piped to ffmpeg.

Usage:
    python3 generate_pose_dance.py            # render the full mp4
    python3 generate_pose_dance.py --montage  # 4x3 contact sheet across the timeline
    python3 generate_pose_dance.py --preview  # one frame -> preview_dance.png
"""

import math
import os
import subprocess
import sys

import numpy as np

# ---- output ----
W, H = 720, 1280
FPS = 30
DUR = 8.0
N = int(FPS * DUR)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "pose_3d_dance.mp4")

# ---- skeleton topology ----
(PELVIS, SPINE, CHEST, NECK, HEAD,
 LSH, LEL, LWR, RSH, REL, RWR,
 LHIP, LKNE, LANK, LTOE, RHIP, RKNE, RANK, RTOE) = range(19)
NJ = 19

# child -> parent
PARENT = {
    SPINE: PELVIS, CHEST: SPINE, NECK: CHEST, HEAD: NECK,
    LSH: CHEST, LEL: LSH, LWR: LEL,
    RSH: CHEST, REL: RSH, RWR: REL,
    LHIP: PELVIS, LKNE: LHIP, LANK: LKNE, LTOE: LANK,
    RHIP: PELVIS, RKNE: RHIP, RANK: RKNE, RTOE: RANK,
}
# offset of each joint from its parent, in the parent's rest frame (meters)
OFFSET = {
    SPINE: (0, 0.26, 0), CHEST: (0, 0.22, 0), NECK: (0, 0.12, 0), HEAD: (0, 0.20, 0),
    LSH: (-0.17, 0.06, 0), LEL: (0, -0.27, 0), LWR: (0, -0.25, 0),
    RSH: (0.17, 0.06, 0), REL: (0, -0.27, 0), RWR: (0, -0.25, 0),
    LHIP: (-0.11, -0.06, 0), LKNE: (0, -0.44, 0), LANK: (0, -0.44, 0), LTOE: (0, -0.07, 0.14),
    RHIP: (0.11, -0.06, 0), RKNE: (0, -0.44, 0), RANK: (0, -0.44, 0), RTOE: (0, -0.07, 0.14),
}
# walk order: every parent before its children
ORDER = [PELVIS, SPINE, CHEST, NECK, HEAD,
         LSH, LEL, LWR, RSH, REL, RWR,
         LHIP, LKNE, LANK, LTOE, RHIP, RKNE, RANK, RTOE]

BONES = [
    (PELVIS, SPINE), (SPINE, CHEST), (CHEST, NECK), (NECK, HEAD),
    (CHEST, LSH), (LSH, LEL), (LEL, LWR),
    (CHEST, RSH), (RSH, REL), (REL, RWR),
    (PELVIS, LHIP), (LHIP, LKNE), (LKNE, LANK), (LANK, LTOE),
    (PELVIS, RHIP), (RHIP, RKNE), (RKNE, RANK), (RANK, RTOE),
]
BONE_COLORS = [
    (255, 170, 0), (255, 140, 0), (255, 110, 30), (255, 92, 60),       # spine/head, warm
    (0, 200, 120), (0, 224, 170), (70, 244, 210),                       # left arm, green
    (0, 120, 255), (50, 165, 255), (100, 205, 255),                     # right arm, blue
    (228, 60, 150), (244, 84, 134), (255, 110, 120), (255, 150, 140),   # left leg, pink
    (150, 80, 255), (180, 110, 255), (205, 140, 255), (220, 170, 255),  # right leg, purple
]
JOINT_COLOR = (245, 246, 255)
BG = (12, 14, 20)
GROUND_COLOR = (40, 44, 58)

BASE_Y = 1.05  # pelvis height so feet rest near the floor

# ---- camera (pinhole, looking down -Z; figure faces +Z toward camera) ----
# Framed so even the widest pose (the side kick) stays inside with margin.
F = 1330.0
CAM = np.array([0.0, 0.95, 3.75])


# ---- keyframe channels (time in seconds -> value). Angles in degrees. -----------------
# root translation is in meters; everything else is a joint angle.
# Phases: 0-1 wind-up | 1-2.4 overhead reach+twist | 2.4-4 full 360 spin (arms wide)
#         4-5.4 side/round kick out to screen-right | 5.4-7 alternating uppercut combo
#         7-8 settle. Forward actions are avoided — the figure faces camera, so motion is
#         choreographed in the screen plane (sideways/vertical) to stay readable.
CH = {
    "root_x":  [(0, 0), (4.3, 0), (4.85, -0.07), (5.4, 0), (8, 0)],   # shift left into the kick
    "root_y":  [(0, 0), (0.7, -0.10), (1.4, 0), (1.8, 0.05), (2.4, 0),
                (4.3, -0.06), (4.75, 0.10), (5.2, -0.05), (5.6, 0),
                (5.9, -0.05), (6.3, 0), (6.7, -0.05), (7.0, 0), (8, 0)],
    "root_z":  [(0, 0), (8, 0)],
    "root_yaw":  [(0, 0), (2.6, 0), (4.05, 360), (8, 360)],          # one smooth full spin
    "root_roll": [(0, 0), (3.1, -12), (4.05, 0), (4.75, 16), (5.4, 0), (8, 0)],  # spin & kick lean
    "root_pitch": [(0, 0), (8, 0)],

    "spine_pitch": [(0, 2), (0.7, 18), (1.4, -6), (2.2, 0), (4.3, 14), (4.75, 6),
                    (5.2, 4), (6.0, 10), (6.6, -2), (7.2, 2), (8, 2)],
    "spine_yaw":   [(0, 0), (1.0, 18), (1.8, -12), (2.4, 0), (4.75, -14), (5.2, -6),
                    (5.8, 18), (6.2, -16), (6.6, 16), (7.0, -10), (7.4, 0), (8, 0)],
    "chest_pitch": [(0, 0), (4.3, 8), (5.0, 0), (8, 0)],
    "chest_yaw":   [(0, 0), (1.0, -10), (1.8, 8), (2.4, 0), (5.8, -10), (6.2, 10),
                    (6.6, -10), (7.0, 8), (7.4, 0), (8, 0)],
    "head_yaw":    [(0, 0), (0.8, 14), (1.8, -16), (2.4, 0), (4.75, -16), (5.4, 0),
                    (5.8, 12), (6.2, -10), (6.6, 12), (7.0, -8), (7.4, 0), (8, 0)],
    "head_pitch":  [(0, 0), (1.4, -10), (2.2, 0), (4.3, -6), (5.0, 0), (8, 0)],

    # arms ---------------------------------------------------------------------------------
    "L_sh_flex":   [(0, 0), (0.7, -35), (1.4, 120), (2.2, 60), (2.6, 15), (3.9, 15),
                    (4.75, 12), (5.4, 20), (5.8, 80), (6.2, 25), (6.6, 80), (7.0, 25),
                    (7.4, 0), (8, 0)],
    "L_sh_abduct": [(0, 6), (0.7, 15), (1.4, 38), (2.2, 30), (2.6, 86), (3.9, 86),
                    (4.3, 56), (4.75, 60), (5.4, 30), (5.8, 12), (6.2, 14), (6.6, 12),
                    (7.0, 14), (7.4, 6), (8, 6)],          # left arm out to balance the kick
    "L_el_flex":   [(0, 10), (0.7, 30), (1.4, 16), (2.2, 40), (2.6, 30), (3.9, 30),
                    (4.3, 22), (4.75, 20), (5.4, 80), (5.8, 92), (6.2, 88), (6.6, 92),
                    (7.0, 88), (7.4, 14), (8, 10)],
    "R_sh_flex":   [(0, 0), (0.7, -35), (1.4, 110), (2.2, 55), (2.6, 15), (3.9, 15),
                    (4.3, 45), (4.75, 45), (5.4, 20), (6.0, 80), (6.4, 25), (6.8, 80),
                    (7.2, 20), (7.5, 0), (8, 0)],
    "R_sh_abduct": [(0, 6), (0.7, 15), (1.4, 33), (2.2, 28), (2.6, 86), (3.9, 86),
                    (4.3, 18), (4.75, 18), (5.4, 16), (6.0, 12), (6.4, 14), (6.8, 12),
                    (7.2, 14), (7.5, 6), (8, 6)],           # right arm guards across chest
    "R_el_flex":   [(0, 10), (0.7, 30), (1.4, 18), (2.2, 40), (2.6, 30), (3.9, 30),
                    (4.3, 90), (4.75, 92), (5.4, 85), (6.0, 92), (6.4, 88), (6.8, 92),
                    (7.2, 16), (7.5, 14), (8, 10)],

    # legs ---------------------------------------------------------------------------------
    "L_hip_flex":   [(0, 0), (0.7, 16), (1.4, -5), (2.2, 0), (4.3, 8), (5.0, 6), (8, 0)],
    "L_hip_abduct": [(0, 4), (2.6, 14), (3.9, 14), (4.5, 6), (8, 4)],
    "L_knee_flex":  [(0, 6), (0.7, 38), (1.4, 12), (2.2, 8), (2.6, 18), (3.9, 18),
                     (4.5, 30), (5.0, 34), (5.6, 18), (6.0, 24), (6.6, 22), (7.2, 10), (8, 6)],
    # right leg: chamber then snap a side/round kick out to screen-right (~4.85)
    "R_hip_flex":   [(0, 0), (0.7, 12), (1.4, -5), (2.2, 0), (3.9, 0), (4.2, 10),
                     (4.7, 28), (5.1, 22), (5.6, 0), (8, 0)],
    "R_hip_abduct": [(0, 4), (2.6, 14), (3.9, 14), (4.1, 20), (4.5, 42), (4.85, 50),
                     (5.2, 36), (5.6, 8), (8, 4)],
    "R_knee_flex":  [(0, 6), (0.7, 32), (1.4, 12), (2.2, 8), (2.6, 18), (3.9, 18),
                     (4.3, 80), (4.55, 82), (4.9, 14), (5.2, 55), (5.6, 18), (6.0, 24),
                     (6.6, 22), (7.2, 10), (8, 6)],
}


def kf(name, t):
    keys = CH[name]
    if t <= keys[0][0]:
        return keys[0][1]
    if t >= keys[-1][0]:
        return keys[-1][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            u = (t - t0) / (t1 - t0)
            e = u * u * (3 - 2 * u)  # smoothstep ease in/out -> snappy "hit the pose" feel
            return v0 + (v1 - v0) * e
    return keys[-1][1]


def Rx(d):
    a = math.radians(d); c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def Ry(d):
    a = math.radians(d); c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def Rz(d):
    a = math.radians(d); c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def local_R(j, t):
    """Local rotation of joint j relative to its parent, from the keyframed channels."""
    if j == PELVIS:
        return Ry(kf("root_yaw", t)) @ Rx(kf("root_pitch", t)) @ Rz(kf("root_roll", t))
    if j == SPINE:
        return Rx(kf("spine_pitch", t)) @ Ry(kf("spine_yaw", t))
    if j == CHEST:
        return Rx(kf("chest_pitch", t)) @ Ry(kf("chest_yaw", t))
    if j == HEAD:
        return Rx(kf("head_pitch", t)) @ Ry(kf("head_yaw", t))
    if j in (LSH, RSH):
        side, p = (-1, "L") if j == LSH else (1, "R")
        return Rz(side * kf(f"{p}_sh_abduct", t)) @ Rx(-kf(f"{p}_sh_flex", t))
    if j in (LEL, REL):
        p = "L" if j == LEL else "R"
        return Rx(-kf(f"{p}_el_flex", t))
    if j in (LHIP, RHIP):
        side, p = (-1, "L") if j == LHIP else (1, "R")
        return Rz(side * kf(f"{p}_hip_abduct", t)) @ Rx(-kf(f"{p}_hip_flex", t))
    if j in (LKNE, RKNE):
        p = "L" if j == LKNE else "R"
        return Rx(kf(f"{p}_knee_flex", t))   # knee bends backward (heel toward seat)
    return np.eye(3)


def fk(t):
    """Forward kinematics -> world joint positions (19,3)."""
    pos = np.zeros((NJ, 3))
    rot = [None] * NJ
    pos[PELVIS] = (kf("root_x", t), BASE_Y + kf("root_y", t), kf("root_z", t))
    rot[PELVIS] = local_R(PELVIS, t)
    for j in ORDER[1:]:
        p = PARENT[j]
        pos[j] = pos[p] + rot[p] @ np.array(OFFSET[j])
        rot[j] = rot[p] @ local_R(j, t)
    return pos


# ---- projection + rasterization -------------------------------------------------------
def project(P):
    x = P[:, 0] - CAM[0]; y = P[:, 1] - CAM[1]; depth = CAM[2] - P[:, 2]
    return np.stack([W / 2 + F * x / depth, H / 2 - F * y / depth], axis=1), depth


def project_pt(p):
    depth = CAM[2] - p[2]
    return (W / 2 + F * (p[0] - CAM[0]) / depth, H / 2 - F * (p[1] - CAM[1]) / depth)


def stamp(img, cx, cy, rx, ry, color, alpha=1.0):
    x0 = max(0, int(math.floor(cx - rx - 1))); x1 = min(W - 1, int(math.ceil(cx + rx + 1)))
    y0 = max(0, int(math.floor(cy - ry - 1))); y1 = min(H - 1, int(math.ceil(cy + ry + 1)))
    if x1 < x0 or y1 < y0:
        return
    ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
    d = np.sqrt(((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2)
    a = np.clip((1.0 - d) * max(rx, ry), 0.0, 1.0) * alpha
    if a.max() <= 0:
        return
    reg = img[y0:y1 + 1, x0:x1 + 1, :].astype(np.float32)
    img[y0:y1 + 1, x0:x1 + 1, :] = (reg * (1 - a[..., None]) + np.array(color, np.float32) * a[..., None]).astype(np.uint8)


def line(img, p0, p1, color, thick):
    length = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    n = max(2, int(length / 2) + 1)
    r = thick / 2.0
    for i in range(n):
        s = i / (n - 1)
        stamp(img, p0[0] + (p1[0] - p0[0]) * s, p0[1] + (p1[1] - p0[1]) * s, r, r, color)


def draw_ground(img):
    for z in np.linspace(-1.0, 1.4, 7):
        line(img, project_pt((-1.1, 0.0, z)), project_pt((1.1, 0.0, z)), GROUND_COLOR, 2)
    for x in np.linspace(-1.1, 1.1, 9):
        line(img, project_pt((x, 0.0, -1.0)), project_pt((x, 0.0, 1.4)), GROUND_COLOR, 2)


def shade(color, depth):
    dmin, dmax = CAM[2] - 0.7, CAM[2] + 0.7
    f = 1.18 - 0.6 * float(np.clip((depth - dmin) / (dmax - dmin), 0.0, 1.0))
    return tuple(int(np.clip(c * f, 0, 255)) for c in color)


def render_frame(t):
    img = np.empty((H, W, 3), np.uint8)
    img[:] = BG
    draw_ground(img)

    P = fk(t)
    pts, depth = project(P)

    # Per-foot contact shadows that shrink/fade as a foot lifts.
    for ank in (LANK, RANK):
        lift = float(np.clip(P[ank][1] / 0.5, 0.0, 1.0))
        c = project_pt((P[ank][0], 0.0, P[ank][2]))
        stamp(img, c[0], c[1], 70 * (1 - 0.6 * lift), 20 * (1 - 0.6 * lift), (0, 0, 0), alpha=0.4 * (1 - lift))

    # Bones back-to-front for correct occlusion.
    order = sorted(range(len(BONES)), key=lambda b: -(depth[BONES[b][0]] + depth[BONES[b][1]]))
    for b in order:
        i, j = BONES[b]
        line(img, pts[i], pts[j], shade(BONE_COLORS[b], (depth[i] + depth[j]) / 2), 13)

    for ji in range(NJ):
        r = 18.0 if ji == HEAD else 7.5
        stamp(img, pts[ji][0], pts[ji][1], r, r, shade(JOINT_COLOR, depth[ji]))
    return img


def write_png(img, path):
    p = subprocess.Popen(
        ["ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{img.shape[1]}x{img.shape[0]}",
         "-i", "-", path], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    p.communicate(img.tobytes())


def main():
    if "--montage" in sys.argv:
        cols, rows = 4, 3
        ds = 4  # downsample factor
        th, tw = H // ds, W // ds
        canvas = np.zeros((rows * th, cols * tw, 3), np.uint8)
        for k in range(cols * rows):
            t = DUR * k / (cols * rows)
            small = render_frame(t)[::ds, ::ds, :]
            r, c = divmod(k, cols)
            canvas[r * th:(r + 1) * th, c * tw:(c + 1) * tw, :] = small[:th, :tw, :]
        write_png(canvas, os.path.join(HERE, "montage.png"))
        print("wrote montage.png")
        return

    if "--preview" in sys.argv:
        write_png(render_frame(1.4), os.path.join(HERE, "preview_dance.png"))
        print("wrote preview_dance.png")
        return

    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
         "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-crf", "18", "-movflags", "+faststart", OUT],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    for fi in range(N):
        proc.stdin.write(render_frame(fi / FPS).tobytes())
    proc.stdin.close()
    err = proc.stderr.read().decode(errors="ignore")
    if proc.wait() != 0:
        sys.stderr.write(err)
        sys.exit(1)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
