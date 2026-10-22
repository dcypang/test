"""Render the house scene with Cycles.

  python render.py house.blend out.exr --samples 250 --offset 0      # one chunk of a progressive render
  python render.py house.blend preview.png --samples 64 --pct 50 --denoise

Chunks rendered with consecutive --offset values use disjoint sample ranges,
so averaging N chunks of S samples is identical to one render of N*S samples.
"""
import argparse
import sys
import time

import bpy

ap = argparse.ArgumentParser()
ap.add_argument("blend")
ap.add_argument("out")
ap.add_argument("--samples", type=int, default=64)
ap.add_argument("--offset", type=int, default=0)
ap.add_argument("--pct", type=int, default=100)
ap.add_argument("--denoise", action="store_true")
ap.add_argument("--threads", type=int, default=0)
args = ap.parse_args(sys.argv[1:])

bpy.ops.wm.open_mainfile(filepath=args.blend)
scene = bpy.context.scene
c = scene.cycles
c.samples = args.samples
c.sample_offset = args.offset
c.use_denoising = args.denoise
if args.denoise:
    c.denoiser = "OPENIMAGEDENOISE"
r = scene.render
r.resolution_percentage = args.pct
if args.threads:
    r.threads_mode = "FIXED"
    r.threads = args.threads
if args.out.endswith(".exr"):
    r.image_settings.file_format = "OPEN_EXR"
    r.image_settings.color_depth = "32"
    r.image_settings.exr_codec = "ZIP"
else:
    r.image_settings.file_format = "PNG"
    r.image_settings.color_depth = "16"
r.filepath = args.out
t = time.time()
bpy.ops.render.render(write_still=True)
print(f"RENDER_DONE {args.out} samples={args.samples} offset={args.offset} {time.time() - t:.1f}s", flush=True)
