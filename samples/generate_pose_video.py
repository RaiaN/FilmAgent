#!/usr/bin/env python3
"""
Generate a 3D pose / skeleton video for use as a motion-control input to Seedance 2.0.

Renders a humanoid stick figure (OpenPose-style colored limbs, depth-shaded joints)
performing a full-body jumping-jack-ish motion while gently turning, so the depth of
the pose is visible. Output is 720p 9:16 portrait H.264 — matching the resolution the
film suite drives Seedance with, and the aspect ratio best suited to a single full body.

No matplotlib needed: 3D points are projected with a pinhole camera and rasterized
straight into a numpy frame buffer, then piped to ffmpeg.

Usage:
    python3 generate_pose_video.py            # render the full mp4
    python3 generate_pose_video.py --preview  # render one frame to preview.png
"""

import math
import os
import subprocess
import sys

import numpy as np

# ---- output ----
W, H = 720, 1280          # 9:16 portrait, 720p (matches Seedance "720p" tier)
FPS = 30
DUR = 5.0                 # seconds
N = int(FPS * DUR)        # 150 frames; motion is periodic so the clip loops seamlessly
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "pose_3d_seedance.mp4")

# ---- skeleton topology ----
PELVIS, SPINE, NECK, HEAD = 0, 1, 2, 3
LSH, LEL, LWR = 4, 5, 6
RSH, REL, RWR = 7, 8, 9
LHIP, LKNE, LANK = 10, 11, 12
RHIP, RKNE, RANK = 13, 14, 15
NJ = 16

BONES = [
    (PELVIS, SPINE), (SPINE, NECK), (NECK, HEAD),
    (NECK, LSH), (LSH, LEL), (LEL, LWR),
    (NECK, RSH), (RSH, REL), (REL, RWR),
    (PELVIS, LHIP), (LHIP, LKNE), (LKNE, LANK),
    (PELVIS, RHIP), (RHIP, RKNE), (RKNE, RANK),
]

# OpenPose-ish palette: warm spine, green left arm, blue right arm, pink left leg,
# purple right leg — makes left/right and limb identity unmistakable to a model.
BONE_COLORS = [
    (255, 196, 0), (255, 150, 0), (255, 96, 48),
    (0, 210, 130), (0, 226, 184), (70, 244, 224),
    (0, 130, 255), (52, 168, 255), (104, 206, 255),
    (228, 70, 168), (244, 92, 148), (255, 120, 128),
    (158, 92, 255), (188, 122, 255), (216, 158, 255),
]
JOINT_COLOR = (245, 246, 255)
BG = (12, 14, 20)
GROUND_COLOR = (40, 44, 58)

# ---- camera (pinhole, looking down -Z) ----
F = 1750.0
CAM = np.array([0.0, 0.95, 3.6])


def lerp(a, b, t):
    return a + (b - a) * t


def pose(t):
    """Joint world positions (16,3) at phase t in [0,1). Y up, X right, Z toward camera."""
    P = np.zeros((NJ, 3), dtype=np.float64)

    # Two jumping-jack cycles across the clip; `a` eases 0->1->0 (closed->open->closed).
    cyc = 2.0
    a = (1.0 - math.cos(2 * math.pi * cyc * t)) / 2.0

    # Torso, with a small hop as the figure "opens".
    pelvis_y = 0.98 + 0.05 * a
    P[PELVIS] = (0.0, pelvis_y, 0.0)
    P[SPINE] = P[PELVIS] + (0.0, 0.30, 0.0)
    P[NECK] = P[SPINE] + (0.0, 0.22, 0.0)
    P[HEAD] = P[NECK] + (0.0, 0.20, 0.0)
    sh_y = P[NECK][1] - 0.02
    P[LSH] = (-0.20, sh_y, 0.0)
    P[RSH] = (0.20, sh_y, 0.0)
    hip_y = pelvis_y - 0.02
    P[LHIP] = (-0.12, hip_y, 0.0)
    P[RHIP] = (0.12, hip_y, 0.0)

    # Arms swing from near the sides up overhead (angle measured from straight down).
    arm = math.radians(lerp(14.0, 166.0, a))
    for side, sh, el, wr in ((-1, LSH, LEL, LWR), (1, RSH, REL, RWR)):
        d = np.array([side * math.sin(arm), -math.cos(arm), 0.0])
        P[el] = P[sh] + 0.30 * d
        # Slight forward bend at the elbow so the arm reads in 3D, not flat.
        d2 = np.array([side * math.sin(arm), -math.cos(arm), 0.10])
        d2 /= np.linalg.norm(d2)
        P[wr] = P[el] + 0.27 * d2

    # Legs spread out a little on the open.
    leg = math.radians(lerp(6.0, 26.0, a))
    for side, hip, kne, ank in ((-1, LHIP, LKNE, LANK), (1, RHIP, RKNE, RANK)):
        d = np.array([side * math.sin(leg), -math.cos(leg), 0.0])
        P[kne] = P[hip] + 0.45 * d
        P[ank] = P[kne] + 0.45 * d

    # Gentle full-body turn about the vertical axis — one sweep over the clip — so the
    # depth of the limbs (toward/away from camera) is clearly visible.
    yaw = math.radians(34.0 * math.sin(2 * math.pi * t))
    c, s = math.cos(yaw), math.sin(yaw)
    x, z = P[:, 0].copy(), P[:, 2].copy()
    P[:, 0] = x * c + z * s
    P[:, 2] = -x * s + z * c
    return P


def project(P):
    x = P[:, 0] - CAM[0]
    y = P[:, 1] - CAM[1]
    depth = CAM[2] - P[:, 2]
    sx = W / 2 + F * x / depth
    sy = H / 2 - F * y / depth
    return np.stack([sx, sy], axis=1), depth


def project_pt(p):
    x = p[0] - CAM[0]
    y = p[1] - CAM[1]
    depth = CAM[2] - p[2]
    return (W / 2 + F * x / depth, H / 2 - F * y / depth)


def stamp(img, cx, cy, rx, ry, color, alpha=1.0):
    """Anti-aliased filled ellipse (rx==ry -> disk) composited onto img."""
    x0 = max(0, int(math.floor(cx - rx - 1)))
    x1 = min(W - 1, int(math.ceil(cx + rx + 1)))
    y0 = max(0, int(math.floor(cy - ry - 1)))
    y1 = min(H - 1, int(math.ceil(cy + ry + 1)))
    if x1 < x0 or y1 < y0:
        return
    ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
    d = np.sqrt(((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2)
    a = np.clip((1.0 - d) * max(rx, ry), 0.0, 1.0) * alpha
    if a.max() <= 0:
        return
    region = img[y0:y1 + 1, x0:x1 + 1, :].astype(np.float32)
    col = np.array(color, dtype=np.float32)
    a3 = a[..., None]
    img[y0:y1 + 1, x0:x1 + 1, :] = (region * (1 - a3) + col * a3).astype(np.uint8)


def line(img, p0, p1, color, thick):
    x0, y0 = p0
    x1, y1 = p1
    length = math.hypot(x1 - x0, y1 - y0)
    n = max(2, int(length / 2) + 1)
    r = thick / 2.0
    for i in range(n):
        s = i / (n - 1)
        stamp(img, x0 + (x1 - x0) * s, y0 + (y1 - y0) * s, r, r, color)


def draw_ground(img):
    for z in np.linspace(-1.0, 1.4, 7):
        line(img, project_pt((-1.1, 0.0, z)), project_pt((1.1, 0.0, z)), GROUND_COLOR, 2)
    for x in np.linspace(-1.1, 1.1, 9):
        line(img, project_pt((x, 0.0, -1.0)), project_pt((x, 0.0, 1.4)), GROUND_COLOR, 2)


def shade(color, depth):
    # Closer limbs brighter, farther dimmer — a simple depth cue.
    dmin, dmax = CAM[2] - 0.55, CAM[2] + 0.55
    f = 1.15 - 0.55 * np.clip((depth - dmin) / (dmax - dmin), 0.0, 1.0)
    return tuple(int(np.clip(c * f, 0, 255)) for c in color)


def render_frame(t):
    img = np.empty((H, W, 3), dtype=np.uint8)
    img[:] = BG
    draw_ground(img)

    P = pose(t)
    pts, depth = project(P)

    # Soft contact shadow under the pelvis, on the floor.
    foot = project_pt((P[PELVIS][0], 0.0, P[PELVIS][2]))
    stamp(img, foot[0], foot[1], 95, 26, (0, 0, 0), alpha=0.45)

    # Bones back-to-front so nearer limbs occlude farther ones.
    order = sorted(range(len(BONES)),
                   key=lambda b: -(depth[BONES[b][0]] + depth[BONES[b][1]]))
    for b in order:
        i, j = BONES[b]
        dd = (depth[i] + depth[j]) / 2.0
        line(img, pts[i], pts[j], shade(BONE_COLORS[b], dd), 13)

    # Joints on top; head a touch larger.
    for ji in range(NJ):
        r = 18.0 if ji == HEAD else 8.0
        stamp(img, pts[ji][0], pts[ji][1], r, r, shade(JOINT_COLOR, depth[ji]))
    return img


def main():
    if "--preview" in sys.argv:
        img = render_frame(0.18)
        try:
            from PIL import Image
            Image.fromarray(img).save(os.path.join(HERE, "preview.png"))
        except ImportError:
            # No Pillow — write a PNG via ffmpeg from a single raw frame.
            p = subprocess.Popen(
                ["ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                 "-s", f"{W}x{H}", "-i", "-", os.path.join(HERE, "preview.png")],
                stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            p.communicate(img.tobytes())
        print("wrote preview.png")
        return

    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
         "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-crf", "18", "-movflags", "+faststart", OUT],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    for fi in range(N):
        proc.stdin.write(render_frame(fi / N).tobytes())
    proc.stdin.close()
    err = proc.stderr.read().decode(errors="ignore")
    if proc.wait() != 0:
        sys.stderr.write(err)
        sys.exit(1)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
