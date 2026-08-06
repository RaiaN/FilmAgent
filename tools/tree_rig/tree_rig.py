"""Tree skeletal rig blockout: a seeded recursive bone hierarchy (trunk + a few
branches) swaying in layered-sine wind, rendered to MP4. Motion/structure
reference for tree shots — same family as tools/crowd_blockout.

Run:

    blender -b -P tree_rig.py -- --depth 3 --frames 240 --seed 7

Result: render/treerig0001-0240.mp4 (Blender appends the frame range).

Rules follow crowd_blockout: no bpy.ops in loops, bpy.data only, re-runnable
(deletes old tree_* objects), --seed on everything, Workbench + H.264.
"""

import argparse
import colorsys
import math
import os
import random
import sys

import bpy

PREFIX = "tree_"
BONE_COLOR = (0.92, 0.90, 0.86, 1.0)
JOINT_COLOR = (0.55, 0.55, 0.58, 1.0)
GOLDEN = 0.6180339887

TRUNK_LEN = 4.0
TRUNK_RADIUS = 0.22
LEN_DECAY = (0.62, 0.78)        # child length as a fraction of its parent
RADIUS_DECAY = 0.62
SPREAD_DEG = (22.0, 42.0)       # child tilt away from the parent axis
CHILDREN = (2, 3)               # a few branches, not a broccoli
# wind: slow gust swell times layered sines; tips sway more than the trunk
GUST_HZ = 0.07
SWAY_LAYERS = ((0.4, 0.6), (1.1, 0.3), (2.7, 0.1))  # Hz, relative amplitude


# ------------------------------------------------------------------ mesh/anim
def make_box_mesh(name, sx, sy, sz, z0=0.0):
    """Axis-aligned box; base sits at local z = z0 (bones grow along +z)."""
    hx, hy = sx / 2.0, sy / 2.0
    verts = [(x, y, z) for z in (z0, z0 + sz) for y in (-hy, hy) for x in (-hx, hx)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1),
             (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return mesh


def new_fcurves(obj, action, channels):
    """Create fcurves on Blender 5.x slotted actions, with a legacy fallback."""
    obj.animation_data_create()
    obj.animation_data.action = action
    try:
        slot = action.slots.new(id_type='OBJECT', name=obj.name)
        obj.animation_data.action_slot = slot
        layer = action.layers.new("layer")
        strip = layer.strips.new(type='KEYFRAME')
        channelbag = strip.channelbag(slot, ensure=True)
        return [channelbag.fcurves.new(path, index=i) for path, i in channels]
    except AttributeError:  # pre-slot API
        return [action.fcurves.new(data_path=path, index=i) for path, i in channels]


def keyframe_channels(obj, channels, samples):
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


# ------------------------------------------------------------------ skeleton
def grow(rng, depth_left, length, radius, limb):
    """Recursive skeleton: each node = dict(len, radius, tilt, azimuth, limb,
    depth, children). tilt/azimuth are the rest pose relative to the parent."""
    node = {"len": length, "radius": radius, "limb": limb, "children": []}
    if depth_left > 0:
        n_children = rng.randint(*CHILDREN)
        az0 = rng.uniform(0.0, 2.0 * math.pi)
        for c in range(n_children):
            child = grow(rng, depth_left - 1,
                         length * rng.uniform(*LEN_DECAY),
                         radius * RADIUS_DECAY,
                         c if limb is None else limb)
            child["tilt"] = math.radians(rng.uniform(*SPREAD_DEG))
            # spread children around the axis, jittered so it isn't a fan
            child["azimuth"] = az0 + c * 2.0 * math.pi / n_children \
                + rng.uniform(-0.5, 0.5)
            node["children"].append(child)
    return node


def build_and_animate(scene, root, n_frames, fps, seed, wind, colorize):
    rng = random.Random(seed + 3)  # wind phases; independent of the shape draws
    bone_meshes = {}
    joint_mesh = make_box_mesh(PREFIX + "joint_mesh", 1.0, 1.0, 1.0, z0=-0.5)
    gust_phase = rng.uniform(0.0, 2.0 * math.pi)

    def limb_color(limb):
        if colorize == "rig" or limb is None:
            return BONE_COLOR
        r, g, b = colorsys.hsv_to_rgb((limb * GOLDEN) % 1.0, 0.8, 0.95)
        return (r, g, b, 1.0)

    def build(node, parent_obj, parent_len, depth, index_path):
        # length baked into the mesh — scaling bones would compound down the chain
        mesh_key = (round(node["radius"], 4), round(node["len"], 4))
        if mesh_key not in bone_meshes:
            bone_meshes[mesh_key] = make_box_mesh(
                f"{PREFIX}bone_mesh_{len(bone_meshes)}",
                node["radius"], node["radius"], node["len"])
        name = PREFIX + "bone_" + index_path
        obj = bpy.data.objects.new(name, bone_meshes[mesh_key])
        obj.color = limb_color(node["limb"])
        base_x = node.get("tilt", 0.0)
        base_az = node.get("azimuth", 0.0)
        rest_x = base_x * math.cos(base_az)
        rest_y = base_x * math.sin(base_az)
        obj.rotation_euler = (rest_x, rest_y, 0.0)
        if parent_obj is not None:
            obj.parent = parent_obj
            obj.location = (0.0, 0.0, parent_len)  # pivot at the parent's tip
        scene.collection.objects.link(obj)

        joint = bpy.data.objects.new(name + "_joint", joint_mesh)
        joint.parent = obj
        joint.location = (0.0, 0.0, 0.0)
        s = node["radius"] * 2.2
        joint.scale = (s, s, s)
        joint.color = JOINT_COLOR if colorize == "rig" else limb_color(node["limb"])
        scene.collection.objects.link(joint)

        # wind sway: gust-modulated layered sines, stronger toward the tips
        amp = wind * (0.015 + 0.03 * depth)
        phases = [(rng.uniform(0.0, 2.0 * math.pi), rng.uniform(0.0, 2.0 * math.pi))
                  for _ in SWAY_LAYERS]
        samples = []
        for f in range(n_frames):
            t = f / fps
            gust = 0.55 + 0.45 * math.sin(2.0 * math.pi * GUST_HZ * t + gust_phase) ** 2
            dx = dy = 0.0
            for (hz, rel), (p1, p2) in zip(SWAY_LAYERS, phases):
                dx += rel * math.sin(2.0 * math.pi * hz * t + p1)
                dy += rel * math.sin(2.0 * math.pi * hz * t * 1.13 + p2)
            samples.append((rest_x + amp * gust * dx, rest_y + amp * gust * dy))
        keyframe_channels(obj, [("rotation_euler", 0), ("rotation_euler", 1)], samples)

        for k, child in enumerate(node["children"]):
            build(child, obj, node["len"], depth + 1, f"{index_path}{k}")
        return None

    build(root, None, 0.0, 0, "r")


# ------------------------------------------------------------------ scene/io
def clear_previous():
    for obj in [o for o in bpy.data.objects if o.name.startswith(PREFIX)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.cameras, bpy.data.actions):
        for block in [b for b in coll if b.name.startswith(PREFIX)]:
            coll.remove(block)
    # default startup objects would photobomb the render
    for name in ("Cube", "Light", "Camera"):
        obj = bpy.data.objects.get(name)
        if obj is not None:
            bpy.data.objects.remove(obj, do_unlink=True)


def build_camera(scene, height):
    cam_data = bpy.data.cameras.new(PREFIX + "cam")
    cam_data.lens = 45.0
    cam_data.clip_end = 500.0
    cam = bpy.data.objects.new(PREFIX + "cam", cam_data)
    cam.location = (height * 1.6, -height * 2.1, height * 0.55)
    scene.collection.objects.link(cam)
    target = bpy.data.objects.new(PREFIX + "cam_target", None)
    target.location = (0.0, 0.0, height * 0.52)
    scene.collection.objects.link(target)
    track = cam.constraints.new('TRACK_TO')
    track.target = target
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'
    scene.camera = cam


def configure_render(scene, args, stem):
    scene.frame_start = 1
    scene.frame_end = args.frames
    scene.render.fps = args.fps
    w, h = (int(v) for v in args.res.split("x"))
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.engine = 'BLENDER_WORKBENCH'
    shading = scene.display.shading
    shading.color_type = 'OBJECT'
    if args.colorize == "rig":
        shading.light = 'STUDIO'   # shading gives the bones depth on black
        shading.show_cavity = True
    else:
        shading.light = 'FLAT'
        shading.show_cavity = False
    try:
        shading.background_type = 'VIEWPORT'
        shading.background_color = (0.0, 0.0, 0.0)
    except (AttributeError, TypeError):
        pass
    if hasattr(scene.render.image_settings, "media_type"):
        scene.render.image_settings.media_type = 'VIDEO'  # before file_format!
    scene.render.image_settings.file_format = 'FFMPEG'
    scene.render.ffmpeg.format = 'MPEG4'
    scene.render.ffmpeg.codec = 'H264'
    scene.render.filepath = stem


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--depth", type=int, default=3,
                        help="branching depth below the trunk (default 3)")
    parser.add_argument("--wind", type=float, default=1.0,
                        help="sway strength multiplier (default 1.0)")
    parser.add_argument("--frames", type=int, default=240)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--res", default="1280x720")
    parser.add_argument("--colorize", choices=["rig", "id"], default="rig",
                        help="rig: bone-white on black; id: one hue per primary limb")
    parser.add_argument("--out", default=None)
    parser.add_argument("--still", type=int, default=None,
                        help="render a single PNG of this frame instead of the MP4")
    return parser.parse_args(argv)


def main():
    args = parse_args()
    if args.out:
        stem = os.path.abspath(args.out)
    else:
        base = os.path.dirname(os.path.abspath(__file__))
        suffix = "" if args.colorize == "rig" else f"_{args.colorize}"
        stem = os.path.join(base, "render", f"treerig{suffix}")
    os.makedirs(os.path.dirname(stem), exist_ok=True)

    print(f"[tree_rig] depth={args.depth} wind={args.wind} frames={args.frames} "
          f"seed={args.seed} -> {stem}")

    rng = random.Random(args.seed)
    root = grow(rng, args.depth, TRUNK_LEN, TRUNK_RADIUS, None)
    root["tilt"] = 0.0
    root["azimuth"] = 0.0

    # reach of the deepest chain ~ trunk * sum of decays; frame to that height
    height = TRUNK_LEN * sum(max(LEN_DECAY) ** d for d in range(args.depth + 1))

    scene = bpy.context.scene
    clear_previous()
    build_and_animate(scene, root, args.frames, args.fps, args.seed,
                      args.wind, args.colorize)
    build_camera(scene, height * 0.85)
    configure_render(scene, args, stem)

    if args.still is not None:
        scene.frame_set(args.still)
        if hasattr(scene.render.image_settings, "media_type"):
            scene.render.image_settings.media_type = 'IMAGE'  # before PNG!
        scene.render.image_settings.file_format = 'PNG'
        scene.render.filepath = f"{stem}_still{args.still:04d}.png"
        bpy.ops.render.render(write_still=True)
    else:
        bpy.ops.render.render(animation=True)
    print(f"[tree_rig] wrote {scene.render.filepath}"
          + ("" if args.still is not None else f"{args.frames:04d}.mp4 (range-stamped)"))


if __name__ == "__main__":
    main()
