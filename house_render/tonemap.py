"""Average one or more linear EXR chunks and write a display-referred PNG.

  python tonemap.py out.png chunk_000.exr chunk_001.exr ... [--look "AgX - Punchy"] [--exposure 0.3]

Every chunk must have the same number of samples, so a plain mean is exact.
The colour-managed conversion uses the view settings stored in house.blend
unless overridden.
"""
import argparse
import os
import sys

import bpy
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("chunks", nargs="+")
ap.add_argument("--blend", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "house.blend"))
ap.add_argument("--look", default=None)
ap.add_argument("--exposure", type=float, default=None)
ap.add_argument("--save-exr", default=None, help="also write the averaged linear EXR here")
args = ap.parse_args(sys.argv[1:])

bpy.ops.wm.open_mainfile(filepath=args.blend)
scene = bpy.context.scene
if args.look:
    scene.view_settings.look = args.look
if args.exposure is not None:
    scene.view_settings.exposure = args.exposure

acc = None
for path in args.chunks:
    img = bpy.data.images.load(os.path.abspath(path))
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    acc = px.astype(np.float64) if acc is None else acc + px
    w, h = img.size
    bpy.data.images.remove(img)
acc /= len(args.chunks)

out = bpy.data.images.new("merged", w, h, alpha=True, float_buffer=True)
out.colorspace_settings.name = "Linear Rec.709"
out.pixels.foreach_set(acc.astype(np.float32))
if args.save_exr:
    out.filepath_raw = os.path.abspath(args.save_exr)
    out.file_format = "OPEN_EXR"
    out.save()
s = scene.render.image_settings
s.file_format = "PNG"
s.color_mode = "RGB"
s.color_depth = "16"
out.save_render(os.path.abspath(args.out), scene=scene)
print("wrote", args.out, "from", len(args.chunks), "chunk(s)")
