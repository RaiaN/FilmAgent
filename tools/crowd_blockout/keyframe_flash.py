#!/usr/bin/env python3
"""Keyframe-flash pass over a rendered MP4: keep N evenly spaced frames
(first and last included), every other frame pure black. Duration, fps and
resolution are unchanged — useful as sparse-keyframe conditioning/reference.

Run (plain python3, ffmpeg required — no Blender involved):

    python3 keyframe_flash.py render/blockout_horde_aerial0001-0250.mp4 --keys 12

Output: <input>_keyflash<N>.mp4 next to the input.
"""

import argparse
import json
import os
import subprocess
import sys


def count_frames(path):
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
         "-show_entries", "stream=nb_read_frames", "-of", "json", path])
    return int(json.loads(out)["streams"][0]["nb_read_frames"])


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input")
    parser.add_argument("--keys", type=int, default=12,
                        help="number of visible keyframes (default 12)")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    total = count_frames(args.input)
    if args.keys < 2 or args.keys > total:
        sys.exit(f"--keys must be between 2 and {total} (source frame count)")
    keys = sorted({round(i * (total - 1) / (args.keys - 1)) for i in range(args.keys)})

    out = args.out
    if out is None:
        stem, _ = os.path.splitext(args.input)
        out = f"{stem}_keyflash{len(keys)}.mp4"

    # black out every frame whose index n is not in the key list
    is_key = "+".join(f"eq(n\\,{k})" for k in keys)
    vf = f"drawbox=color=black:thickness=fill:enable='not({is_key})'"
    subprocess.check_call(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", args.input, "-vf", vf,
         "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", out])
    print(f"wrote {out}  ({len(keys)} keyframes of {total}: {keys})")


if __name__ == "__main__":
    main()
