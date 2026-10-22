"""Procedurally build a Cycles scene of 13590 Beaumont Ave from reference photos.

Usage:  python build_scene.py out.blend      (needs the `bpy` module, Blender 5.1)

Coordinate system: X runs along the street (left -> right as seen from the
street), Y runs from the street into the lot, Z is up.  The front wall of the
main house sits on y = 0 and the yard grade is z = 0.  Units are metres.
"""
import math
import random
import sys

import bpy  # must be imported before bmesh/mathutils when using the bpy module
import bmesh
from mathutils import Matrix, Vector, noise

OUT = sys.argv[-1] if sys.argv[-1].endswith(".blend") else "house.blend"
random.seed(13590)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
COL = scene.collection

ROOF_SLOPE = 1 / 3          # 4:12 pitch
WALL_TOP = 2.62             # underside of soffit
EAVE = 2.85                 # roof edge height
STREET_Z = -0.62

# --------------------------------------------------------------------------
# Node helpers
# --------------------------------------------------------------------------


def inp(nt, sock, val):
    if isinstance(val, bpy.types.NodeSocket):
        nt.links.new(val, sock)
    else:
        sock.default_value = val


def node(nt, kind, inputs=None, **props):
    n = nt.nodes.new(kind)
    for k, v in props.items():
        setattr(n, k, v)
    for k, v in (inputs or {}).items():
        inp(nt, n.inputs[k], v)
    return n


def op(nt, operation, a, b=0.0, clamp=False):
    n = node(nt, "ShaderNodeMath", operation=operation, use_clamp=clamp)
    inp(nt, n.inputs[0], a)
    inp(nt, n.inputs[1], b)
    return n.outputs[0]


def xyz(nt):
    g = nt.nodes.new("ShaderNodeNewGeometry")
    s = node(nt, "ShaderNodeSeparateXYZ")
    nt.links.new(g.outputs["Position"], s.inputs[0])
    return s.outputs[0], s.outputs[1], s.outputs[2], g.outputs["Position"]


def combine(nt, x, y, z=0.0):
    n = node(nt, "ShaderNodeCombineXYZ")
    inp(nt, n.inputs[0], x)
    inp(nt, n.inputs[1], y)
    inp(nt, n.inputs[2], z)
    return n.outputs[0]


def ramp(nt, fac, stops, interp="LINEAR"):
    n = node(nt, "ShaderNodeValToRGB")
    n.color_ramp.interpolation = interp
    els = n.color_ramp.elements
    while len(els) < len(stops):
        els.new(0.5)
    for el, (pos, col) in zip(els, stops):
        el.position = pos
        el.color = (*col, 1.0) if len(col) == 3 else col
    inp(nt, n.inputs[0], fac)
    return n.outputs[0]


def mixc(nt, fac, a, b, blend="MIX"):
    n = node(nt, "ShaderNodeMix", data_type="RGBA", blend_type=blend)
    ins = {s.identifier: s for s in n.inputs}
    inp(nt, ins["Factor_Float"], fac)
    inp(nt, ins["A_Color"], (*a, 1.0) if isinstance(a, tuple) else a)
    inp(nt, ins["B_Color"], (*b, 1.0) if isinstance(b, tuple) else b)
    return {s.identifier: s for s in n.outputs}["Result_Color"]


def noise_tex(nt, vec, scale, detail=4.0, rough=0.55, out="Fac"):
    n = node(nt, "ShaderNodeTexNoise", inputs={"Scale": scale, "Detail": detail, "Roughness": rough})
    if vec is not None:
        inp(nt, n.inputs["Vector"], vec)
    return n.outputs[out]


def maprange(nt, val, a, b, c=0.0, d=1.0, smooth=False):
    n = node(nt, "ShaderNodeMapRange", interpolation_type="SMOOTHSTEP" if smooth else "LINEAR")
    inp(nt, n.inputs["Value"], val)
    n.inputs["From Min"].default_value = a
    n.inputs["From Max"].default_value = b
    n.inputs["To Min"].default_value = c
    n.inputs["To Max"].default_value = d
    return n.outputs["Result"]


def bump(nt, height, distance, strength=1.0, normal=None):
    n = node(nt, "ShaderNodeBump", inputs={"Strength": strength, "Distance": distance})
    inp(nt, n.inputs["Height"], height)
    if normal is not None:
        inp(nt, n.inputs["Normal"], normal)
    return n.outputs["Normal"]


def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes["Principled BSDF"]


def pbr(nt, b, color=None, rough=None, normal=None, metal=None, **extra):
    if color is not None:
        inp(nt, b.inputs["Base Color"], (*color, 1.0) if isinstance(color, tuple) else color)
    if rough is not None:
        inp(nt, b.inputs["Roughness"], rough)
    if metal is not None:
        inp(nt, b.inputs["Metallic"], metal)
    if normal is not None:
        inp(nt, b.inputs["Normal"], normal)
    for k, v in extra.items():
        inp(nt, b.inputs[k.replace("_", " ")], v)


def simple_mat(name, color, rough=0.5, metal=0.0, **extra):
    m, nt, b = new_mat(name)
    pbr(nt, b, color, rough, metal=metal, **extra)
    return m


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------
M = {}

CREAM = (0.74, 0.70, 0.53)
TRIM = (0.80, 0.79, 0.70)


def mat_lap_siding():
    m, nt, b = new_mat("siding_lap")
    X, Y, Z, P = xyz(nt)
    f = op(nt, "FRACT", op(nt, "DIVIDE", Z, 0.203))
    h = op(nt, "SUBTRACT", 1.0, op(nt, "POWER", f, 0.6))
    paint = noise_tex(nt, P, 3.0, 6)
    col = mixc(nt, maprange(nt, paint, 0.3, 0.7, 0.0, 0.25), CREAM, (0.62, 0.58, 0.44))
    n = bump(nt, op(nt, "ADD", h, op(nt, "MULTIPLY", noise_tex(nt, P, 220.0, 2), 0.03)), 0.012)
    pbr(nt, b, col, 0.55, n)
    return m


def mat_bb_siding():
    m, nt, b = new_mat("siding_board_batten")
    X, Y, Z, P = xyz(nt)
    u = op(nt, "ADD", X, Y)
    t = op(nt, "MULTIPLY", op(nt, "ABSOLUTE", op(nt, "SUBTRACT", op(nt, "FRACT", op(nt, "DIVIDE", u, 0.406)), 0.5)), 2.0)
    batten = maprange(nt, t, 0.80, 0.84, smooth=True)
    paint = noise_tex(nt, P, 3.0, 6)
    col = mixc(nt, maprange(nt, paint, 0.3, 0.7, 0.0, 0.25), CREAM, (0.62, 0.58, 0.44))
    n = bump(nt, op(nt, "ADD", batten, op(nt, "MULTIPLY", noise_tex(nt, P, 160.0, 2), 0.04)), 0.02)
    pbr(nt, b, col, 0.55, n)
    return m


def mat_stucco(name="stucco", color=(0.76, 0.73, 0.62)):
    m, nt, b = new_mat(name)
    X, Y, Z, P = xyz(nt)
    big = noise_tex(nt, P, 0.8, 4)
    col = mixc(nt, maprange(nt, big, 0.35, 0.65, 0.0, 0.3), color, (0.55, 0.52, 0.45))
    n = bump(nt, noise_tex(nt, P, 45.0, 8, 0.7), 0.004, 0.6)
    pbr(nt, b, col, 0.85, n)
    return m


def mat_brick():
    m, nt, b = new_mat("brick")
    X, Y, Z, P = xyz(nt)
    vec = combine(nt, op(nt, "ADD", X, Y), Z)
    br = node(nt, "ShaderNodeTexBrick", offset=0.5, offset_frequency=2,
              inputs={"Scale": 1.0, "Mortar Size": 0.011, "Mortar Smooth": 0.15, "Bias": 0.0,
                      "Brick Width": 0.205, "Row Height": 0.071,
                      "Color1": (0.32, 0.09, 0.055, 1), "Color2": (0.44, 0.30, 0.20, 1),
                      "Mortar": (0.40, 0.36, 0.30, 1)})
    inp(nt, br.inputs["Vector"], vec)
    # per-brick tint (a second, coarser brick pass picks a different random per brick)
    br2 = node(nt, "ShaderNodeTexBrick", offset=0.5, offset_frequency=2,
               inputs={"Scale": 1.0, "Mortar Size": 0.0, "Bias": 0.0, "Brick Width": 0.205, "Row Height": 0.071,
                       "Color1": (1.0, 1.0, 1.0, 1), "Color2": (0.40, 0.33, 0.30, 1)})
    inp(nt, br2.inputs["Vector"], combine(nt, op(nt, "ADD", op(nt, "ADD", X, Y), 3.7), op(nt, "ADD", Z, 0.0)))
    col = mixc(nt, 1.0, br.outputs["Color"], br2.outputs["Color"], "MULTIPLY")
    grime = noise_tex(nt, P, 6.0, 6)
    col = mixc(nt, maprange(nt, grime, 0.4, 0.7, 0.0, 0.35), col, (0.25, 0.20, 0.17))
    h = op(nt, "SUBTRACT", 1.0, br.outputs["Fac"])
    h = op(nt, "ADD", h, op(nt, "MULTIPLY", noise_tex(nt, P, 90.0, 4), 0.25))
    pbr(nt, b, col, 0.9, bump(nt, h, 0.006))
    return m


def mat_roof():
    m, nt, b = new_mat("roof_shingles")
    X, Y, Z, P = xyz(nt)
    vec = combine(nt, op(nt, "ADD", X, Y), op(nt, "MULTIPLY", Z, 3.162))
    br = node(nt, "ShaderNodeTexBrick", offset=0.37, offset_frequency=1,
              inputs={"Scale": 1.0, "Mortar Size": 0.010, "Mortar Smooth": 0.3, "Bias": 0.0,
                      "Brick Width": 0.31, "Row Height": 0.143,
                      "Color1": (0.15, 0.115, 0.095, 1), "Color2": (0.095, 0.075, 0.062, 1),
                      "Mortar": (0.035, 0.03, 0.026, 1)})
    inp(nt, br.inputs["Vector"], vec)
    mott = noise_tex(nt, P, 0.35, 5)
    col = mixc(nt, maprange(nt, mott, 0.3, 0.7, 0.0, 0.6), br.outputs["Color"], (0.06, 0.05, 0.045))
    gran = noise_tex(nt, P, 400.0, 2)
    col = mixc(nt, maprange(nt, gran, 0.45, 0.75, 0.0, 0.35), col, (0.17, 0.15, 0.13))
    h = op(nt, "ADD", op(nt, "SUBTRACT", 1.0, br.outputs["Fac"]), op(nt, "MULTIPLY", gran, 0.3))
    pbr(nt, b, col, 0.88, bump(nt, h, 0.008), Specular_IOR_Level=0.3)
    return m


def mat_glass():
    m, nt, b = new_mat("glass")
    pbr(nt, b, (1.0, 1.0, 1.0), 0.0, Transmission_Weight=1.0, IOR=1.5)
    return m


def mat_blinds():
    m, nt, b = new_mat("blinds")
    X, Y, Z, P = xyz(nt)
    f = op(nt, "FRACT", op(nt, "DIVIDE", Z, 0.025))
    col = ramp(nt, f, [(0.0, (0.30, 0.30, 0.28)), (0.12, (0.62, 0.62, 0.58)), (0.85, (0.70, 0.70, 0.66)), (1.0, (0.45, 0.45, 0.42))])
    pbr(nt, b, col, 0.5, bump(nt, f, 0.004))
    return m


def mat_interior():
    m, nt, b = new_mat("interior")
    X, Y, Z, P = xyz(nt)
    col = ramp(nt, noise_tex(nt, P, 1.5, 3), [(0.3, (0.012, 0.012, 0.012)), (0.7, (0.06, 0.055, 0.05))])
    pbr(nt, b, col, 0.9)
    return m


def mat_asphalt(name, base, crack=True, speck=0.25):
    m, nt, b = new_mat(name)
    X, Y, Z, P = xyz(nt)
    s = noise_tex(nt, P, 180.0, 2)
    col = mixc(nt, maprange(nt, s, 0.3, 0.7), tuple(c * (1 - speck) for c in base), tuple(c * (1 + speck) for c in base))
    patch = noise_tex(nt, P, 0.25, 4)
    col = mixc(nt, maprange(nt, patch, 0.45, 0.65, 0.0, 0.5), col, tuple(c * 0.6 for c in base))
    h = s
    if crack:
        warp = noise_tex(nt, P, 1.5, 3, out="Color")
        wp = node(nt, "ShaderNodeVectorMath", operation="MULTIPLY_ADD")
        inp(nt, wp.inputs[0], warp)
        wp.inputs[1].default_value = (0.35, 0.35, 0.35)
        inp(nt, wp.inputs[2], P)
        vor = node(nt, "ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE", inputs={"Scale": 0.55})
        nt.links.new(wp.outputs[0], vor.inputs["Vector"])
        cmask = maprange(nt, vor.outputs["Distance"], 0.0, 0.009, 1.0, 0.0)
        cmask = op(nt, "MULTIPLY", cmask, maprange(nt, noise_tex(nt, P, 0.6, 2), 0.48, 0.6), clamp=True)
        col = mixc(nt, cmask, col, (0.03, 0.03, 0.03))
        h = op(nt, "SUBTRACT", s, op(nt, "MULTIPLY", cmask, 2.0))
    pbr(nt, b, col, 0.9, bump(nt, h, 0.004))
    return m


def mat_ground():
    """Front-yard beds: bark mulch, dry grass and bare soil patches."""
    m, nt, b = new_mat("yard")
    X, Y, Z, P = xyz(nt)
    n1 = noise_tex(nt, P, 0.35, 5)
    n2 = noise_tex(nt, P, 4.0, 6)
    grass = mixc(nt, maprange(nt, n2, 0.35, 0.65), (0.30, 0.25, 0.11), (0.42, 0.36, 0.17))
    grass = mixc(nt, maprange(nt, noise_tex(nt, P, 1.2, 3), 0.55, 0.7, 0.0, 0.7), grass, (0.10, 0.14, 0.05))
    mulch = mixc(nt, maprange(nt, noise_tex(nt, P, 40.0, 4), 0.3, 0.7), (0.16, 0.085, 0.045), (0.30, 0.19, 0.11))
    col = mixc(nt, maprange(nt, n1, 0.45, 0.55, smooth=True), grass, mulch)
    pbr(nt, b, col, 0.95, bump(nt, noise_tex(nt, P, 60.0, 6), 0.01))
    return m


def mat_wood_fence():
    m, nt, b = new_mat("fence_wood")
    X, Y, Z, P = xyz(nt)
    board = op(nt, "FLOOR", op(nt, "DIVIDE", op(nt, "ADD", X, Y), 0.14))
    wn = node(nt, "ShaderNodeTexWhiteNoise", noise_dimensions="1D")
    inp(nt, wn.inputs["W"], board)
    stretch = node(nt, "ShaderNodeVectorMath", operation="MULTIPLY")
    inp(nt, stretch.inputs[0], P)
    stretch.inputs[1].default_value = (25.0, 25.0, 1.2)
    grain = noise_tex(nt, stretch.outputs[0], 3.0, 6)
    col = ramp(nt, wn.outputs["Value"], [(0.0, (0.20, 0.10, 0.06)), (0.6, (0.26, 0.15, 0.09)), (1.0, (0.24, 0.20, 0.16))])
    col = mixc(nt, maprange(nt, grain, 0.3, 0.7, 0.0, 0.4), col, (0.10, 0.06, 0.04))
    pbr(nt, b, col, 0.8, bump(nt, grain, 0.003))
    return m


def mat_bark(name, color):
    m, nt, b = new_mat(name)
    X, Y, Z, P = xyz(nt)
    stretch = node(nt, "ShaderNodeVectorMath", operation="MULTIPLY")
    inp(nt, stretch.inputs[0], P)
    stretch.inputs[1].default_value = (9.0, 9.0, 1.5)
    n = noise_tex(nt, stretch.outputs[0], 2.5, 8, 0.65)
    col = mixc(nt, maprange(nt, n, 0.3, 0.7), tuple(c * 0.5 for c in color), color)
    pbr(nt, b, col, 0.9, bump(nt, n, 0.03))
    return m


def leaf_mat(name, c1, c2, rough=0.5, trans=0.3, use_random=True):
    m, nt, b = new_mat(name)
    out = nt.nodes["Material Output"]
    if use_random:
        r = nt.nodes.new("ShaderNodeObjectInfo").outputs["Random"]
    else:
        X, Y, Z, P = xyz(nt)
        r = noise_tex(nt, P, 1.5, 3)
    col = ramp(nt, r, [(0.0, c1), (1.0, c2)])
    pbr(nt, b, col, rough)
    tr = node(nt, "ShaderNodeBsdfTranslucent")
    inp(nt, tr.inputs["Color"], mixc(nt, 1.0, col, (1.4, 1.6, 0.8), "MULTIPLY"))
    mix = node(nt, "ShaderNodeMixShader", inputs={0: trans})
    nt.links.new(b.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def core_mat(name, color):
    m, nt, b = new_mat(name)
    X, Y, Z, P = xyz(nt)
    n = noise_tex(nt, P, 12.0, 4)
    col = mixc(nt, maprange(nt, n, 0.3, 0.7), tuple(c * 0.35 for c in color), color)
    pbr(nt, b, col, 0.7, bump(nt, n, 0.05))
    return m


M["lap"] = mat_lap_siding()
M["bb"] = mat_bb_siding()
M["stucco"] = mat_stucco()
M["brick"] = mat_brick()
M["roof"] = mat_roof()
M["trim"] = simple_mat("trim", TRIM, 0.45)
M["soffit"] = simple_mat("soffit", (0.78, 0.77, 0.69), 0.6)
M["glass"] = mat_glass()
M["blinds"] = mat_blinds()
M["interior"] = mat_interior()
M["door"] = simple_mat("front_door", (0.045, 0.028, 0.02), 0.3)
M["brass"] = simple_mat("brass", (0.80, 0.58, 0.28), 0.25, 1.0)
M["garage_door"] = simple_mat("garage_door", (0.80, 0.76, 0.58), 0.4)
M["lamp_metal"] = simple_mat("lamp_metal", (0.02, 0.02, 0.02), 0.45, 0.6)
M["lamp_glass"] = simple_mat("lamp_glass", (0.95, 0.93, 0.85), 0.15, Transmission_Weight=1.0)
M["concrete"] = mat_stucco("concrete", (0.48, 0.46, 0.42))
M["drive"] = mat_asphalt("asphalt_drive", (0.20, 0.20, 0.19))
M["street"] = mat_asphalt("asphalt_street", (0.12, 0.12, 0.115), crack=False, speck=0.35)
M["yellow"] = simple_mat("yellow_paint", (0.70, 0.48, 0.05), 0.6)
M["marker"] = simple_mat("marker", (0.80, 0.55, 0.05), 0.2)
M["gravel"] = mat_asphalt("gravel_shoulder", (0.36, 0.31, 0.24), crack=False, speck=0.5)
M["yard"] = mat_ground()
M["fence"] = mat_wood_fence()
M["bark"] = mat_bark("bark", (0.085, 0.075, 0.065))
M["cedar_bark"] = mat_bark("cedar_bark", (0.22, 0.12, 0.07))
M["flashing"] = simple_mat("flashing", (0.20, 0.12, 0.08), 0.5, 0.6)
M["vent"] = simple_mat("vent_tan", (0.50, 0.38, 0.25), 0.6)
M["spark"] = simple_mat("spark_arrestor", (0.05, 0.045, 0.04), 0.6, 0.7)
M["post"] = simple_mat("lamp_post", (0.10, 0.11, 0.12), 0.5, 0.5)
M["sign"] = simple_mat("sign_plate", (0.03, 0.03, 0.035), 0.4)
M["sign_text"] = simple_mat("sign_text", (0.85, 0.85, 0.85), 0.4)
M["bin_green"] = simple_mat("bin_green", (0.03, 0.12, 0.04), 0.4)
M["bin_blue"] = simple_mat("bin_blue", (0.02, 0.07, 0.28), 0.4)
M["neighbor"] = mat_stucco("neighbor_wall", (0.62, 0.58, 0.50))
M["pole"] = mat_bark("pole_wood", (0.18, 0.14, 0.10))
M["wire"] = simple_mat("wire", (0.01, 0.01, 0.01), 0.4)
M["rock"] = mat_stucco("rock", (0.20, 0.18, 0.16))

LEAF = {
    "citrus": leaf_mat("leaf_citrus", (0.112, 0.240, 0.032), (0.480, 0.576, 0.080), 0.35, 0.35),
    "shrub": leaf_mat("leaf_shrub", (0.040, 0.096, 0.032), (0.112, 0.192, 0.056), 0.45, 0.2),
    "shrub_light": leaf_mat("leaf_shrub_light", (0.096, 0.192, 0.048), (0.256, 0.352, 0.096), 0.45, 0.3),
    "oak": leaf_mat("leaf_oak", (0.048, 0.096, 0.032), (0.128, 0.192, 0.064), 0.45, 0.2),
    "pistache": leaf_mat("leaf_pistache", (0.080, 0.160, 0.048), (0.256, 0.320, 0.096), 0.5, 0.35),
    "cedar": leaf_mat("leaf_cedar", (0.096, 0.192, 0.064), (0.256, 0.384, 0.128), 0.5, 0.3),
    "redwood": leaf_mat("leaf_redwood", (0.048, 0.112, 0.040), (0.112, 0.192, 0.064), 0.5, 0.2),
    "maple": leaf_mat("leaf_maple", (0.352, 0.048, 0.024), (0.672, 0.192, 0.048), 0.5, 0.35),
    "olive": leaf_mat("leaf_olive", (0.192, 0.240, 0.144), (0.400, 0.448, 0.288), 0.5, 0.25),
    "fruit": leaf_mat("citrus_fruit", (0.60, 0.66, 0.10), (0.92, 0.50, 0.05), 0.35, 0.0),
    "flower": leaf_mat("camellia_flower", (0.70, 0.12, 0.30), (0.90, 0.35, 0.50), 0.5, 0.3),
    "iris": leaf_mat("iris_blade", (0.16, 0.28, 0.07), (0.42, 0.46, 0.13), 0.45, 0.35, use_random=False),
}
CORE = {k: core_mat("core_" + k, c) for k, c in {
    "citrus": (0.096, 0.176, 0.032), "shrub": (0.040, 0.080, 0.029), "oak": (0.048, 0.080, 0.032),
    "pistache": (0.080, 0.128, 0.048), "cedar": (0.080, 0.144, 0.048), "redwood": (0.048, 0.080, 0.032),
    "maple": (0.192, 0.040, 0.016), "olive": (0.144, 0.176, 0.112), "shrub_light": (0.080, 0.144, 0.048),
}.items()}

# --------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------


def link(obj):
    COL.objects.link(obj)
    return obj


def mesh_obj(name, verts, faces, mat=None, smooth=False, recalc=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    if recalc:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    if mat:
        me.materials.append(mat)
    return link(bpy.data.objects.new(name, me))


BOX_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


class Frame:
    """Wall-local frame: u along the wall, v up, w out of the wall."""

    def __init__(self, origin, U):
        self.o = Vector(origin)
        self.U = Vector(U)
        self.V = Vector((0, 0, 1))
        self.W = self.U.cross(self.V)

    def p(self, u, v, w):
        return self.o + self.U * u + self.V * v + self.W * w


def fbox(name, fr, u0, u1, v0, v1, w0, w1, mat):
    vs = [fr.p(u, v, w) for (u, v, w) in [(u0, v0, w0), (u1, v0, w0), (u1, v1, w0), (u0, v1, w0),
                                          (u0, v0, w1), (u1, v0, w1), (u1, v1, w1), (u0, v1, w1)]]
    return mesh_obj(name, vs, BOX_FACES, mat)


def wbox(name, x0, x1, y0, y1, z0, z1, mat):
    vs = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
          (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    return mesh_obj(name, vs, BOX_FACES, mat)


def cylinder(name, x, y, z0, z1, r0, r1=None, mat=None, seg=16):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r0 if r1 is None else r1,
                          depth=z1 - z0, matrix=Matrix.Translation((x, y, (z0 + z1) / 2)))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = len(p.vertices) == 4
    if mat:
        me.materials.append(mat)
    return link(bpy.data.objects.new(name, me))


def plane(name, pts, mat):
    return mesh_obj(name, pts, [tuple(range(len(pts)))], mat, recalc=False)


def tube(name, pts, radii, mat, bevel_res=3):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 1.0
    cu.bevel_resolution = bevel_res
    cu.use_fill_caps = True
    cu.resolution_u = 8
    sp = cu.splines.new("NURBS")
    sp.points.add(len(pts) - 1)
    for p, co, r in zip(sp.points, pts, radii):
        p.co = (*co, 1.0)
        p.radius = r
    sp.use_endpoint_u = True
    sp.order_u = min(3, len(pts))
    cu.materials.append(mat)
    return link(bpy.data.objects.new(name, cu))


# --------------------------------------------------------------------------
# Roofs
# --------------------------------------------------------------------------


def hip_roof(name, x0, x1, y0, y1, base=EAVE, gutters="fblr"):
    w, d = x1 - x0, y1 - y0
    A, B, C, D = (x0, y0, base), (x1, y0, base), (x1, y1, base), (x0, y1, base)
    if w >= d:
        h = d / 2 * ROOF_SLOPE
        yc = (y0 + y1) / 2
        R1, R2 = (x0 + d / 2, yc, base + h), (x1 - d / 2, yc, base + h)
        faces = [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4)]
    else:
        h = w / 2 * ROOF_SLOPE
        xc = (x0 + x1) / 2
        R1, R2 = (xc, y0 + w / 2, base + h), (xc, y1 - w / 2, base + h)
        faces = [(0, 1, 4), (1, 2, 5, 4), (2, 3, 5), (3, 0, 4, 5)]
    obj = mesh_obj(name, [A, B, C, D, R1, R2], faces, M["roof"], recalc=False)
    sol = obj.modifiers.new("thickness", "SOLIDIFY")
    sol.thickness = 0.05
    sol.offset = -1
    # soffit, fascia and gutters
    wbox(name + "_soffit", x0 + 0.03, x1 - 0.03, y0 + 0.03, y1 - 0.03, WALL_TOP, WALL_TOP + 0.02, M["soffit"])
    fz0, fz1 = base - 0.23, base + 0.01
    sides = {
        "f": ((x0, x1, y0, y0 + 0.035), (x0 - 0.0, x1, y0 - 0.12, y0)),
        "b": ((x0, x1, y1 - 0.035, y1), (x0, x1, y1, y1 + 0.12)),
        "l": ((x0, x0 + 0.035, y0, y1), (x0 - 0.12, x0, y0 - 0.12, y1 + 0.12)),
        "r": ((x1 - 0.035, x1, y0, y1), (x1, x1 + 0.12, y0 - 0.12, y1 + 0.12)),
    }
    for k, (fa, gu) in sides.items():
        wbox(f"{name}_fascia_{k}", *fa, fz0, fz1, M["trim"])
        if k in gutters:
            wbox(f"{name}_gutter_{k}", *gu, base - 0.13, base - 0.005, M["trim"])
    return obj


# --------------------------------------------------------------------------
# Facade elements
# --------------------------------------------------------------------------


def window(name, fr, u0, u1, v0, v1, panes=2, blinds=True, w0=0.021):
    t = 0.075
    fbox(name + "_trim_l", fr, u0 - t, u0, v0, v1, w0, w0 + 0.045, M["trim"])
    fbox(name + "_trim_r", fr, u1, u1 + t, v0, v1, w0, w0 + 0.045, M["trim"])
    fbox(name + "_trim_t", fr, u0 - t, u1 + t, v1, v1 + t, w0, w0 + 0.045, M["trim"])
    fbox(name + "_sill", fr, u0 - t - 0.02, u1 + t + 0.02, v0 - 0.06, v0, w0, w0 + 0.07, M["trim"])
    fbox(name + "_back", fr, u0, u1, v0, v1, w0 - 0.01, w0 + 0.0, M["blinds"] if blinds else M["interior"])
    # sash frames
    for i in range(1, panes):
        uu = u0 + (u1 - u0) * i / panes
        fbox(f"{name}_mull{i}", fr, uu - 0.04, uu + 0.04, v0, v1, w0 + 0.005, w0 + 0.04, M["trim"])
    fbox(name + "_sash_b", fr, u0, u1, v0, v0 + 0.04, w0 + 0.005, w0 + 0.035, M["trim"])
    fbox(name + "_sash_t", fr, u0, u1, v1 - 0.04, v1, w0 + 0.005, w0 + 0.035, M["trim"])
    fbox(name + "_glass", fr, u0, u1, v0, v1, w0 + 0.018, w0 + 0.024, M["glass"])


def lantern(name, fr, u, v, w0=0.021):
    fbox(name + "_plate", fr, u - 0.05, u + 0.05, v - 0.1, v + 0.12, w0, w0 + 0.02, M["lamp_metal"])
    fbox(name + "_arm", fr, u - 0.015, u + 0.015, v + 0.02, v + 0.05, w0, w0 + 0.12, M["lamp_metal"])
    c = fr.p(u, v, w0 + 0.17)
    lamp_head(name, c, 0.16, 0.28)


def lamp_head(name, c, s, h):
    x, y, z = c
    wbox(name + "_glass", x - s / 2, x + s / 2, y - s / 2, y + s / 2, z - h / 2, z + h / 2, M["lamp_glass"])
    for dx in (-1, 1):
        for dy in (-1, 1):
            wbox(f"{name}_rib{dx}{dy}", x + dx * s / 2 - 0.012, x + dx * s / 2 + 0.012,
                 y + dy * s / 2 - 0.012, y + dy * s / 2 + 0.012, z - h / 2, z + h / 2, M["lamp_metal"])
    wbox(name + "_base", x - s / 2 - 0.02, x + s / 2 + 0.02, y - s / 2 - 0.02, y + s / 2 + 0.02,
         z - h / 2 - 0.04, z - h / 2, M["lamp_metal"])
    top = z + h / 2
    mesh_obj(name + "_roof", [(x - s / 2 - 0.04, y - s / 2 - 0.04, top), (x + s / 2 + 0.04, y - s / 2 - 0.04, top),
                              (x + s / 2 + 0.04, y + s / 2 + 0.04, top), (x - s / 2 - 0.04, y + s / 2 + 0.04, top),
                              (x, y, top + 0.12)],
             [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (0, 3, 2, 1)], M["lamp_metal"])


# --------------------------------------------------------------------------
# House body
# --------------------------------------------------------------------------
ST = M["stucco"]
wbox("main_left", -14.0, -6.6, 0.0, 10.5, 0.0, WALL_TOP, ST)
wbox("main_porch_back", -6.6, -4.6, 1.5, 10.5, 0.0, WALL_TOP, ST)
wbox("main_right", -4.6, 1.8, 0.0, 10.5, 0.0, WALL_TOP, ST)
wbox("connector", 1.8, 4.6, -1.0, 4.0, 0.0, WALL_TOP, ST)
wbox("garage", 4.6, 12.4, -1.8, 5.0, 0.0, WALL_TOP, ST)

hip_roof("roof_main", -14.6, 2.4, -0.6, 11.1, gutters="fbl")
hip_roof("roof_connector", 1.2, 5.2, -1.6, 4.6, gutters="f")
hip_roof("roof_garage", 4.0, 13.0, -2.4, 5.6, gutters="fbr")

F_MAIN = Frame((0, 0, 0), (1, 0, 0))
F_PORCH = Frame((0, 1.5, 0), (1, 0, 0))
F_CONN = Frame((0, -1.0, 0), (1, 0, 0))
F_GAR = Frame((0, -1.8, 0), (1, 0, 0))

BRICK_TOP = 0.78
# main front: board & batten left of the porch, lap siding right of it, brick wainscot
fbox("main_bb", F_MAIN, -14.0, -6.6, BRICK_TOP, WALL_TOP, 0, 0.02, M["bb"])
fbox("main_lap", F_MAIN, -4.6, 1.8, BRICK_TOP, WALL_TOP, 0, 0.02, M["lap"])
for nm, (a, b) in {"l": (-14.0, -6.6), "r": (-4.6, 1.8)}.items():
    fbox("wainscot_" + nm, F_MAIN, a, b, 0.0, BRICK_TOP, 0, 0.11, M["brick"])
    fbox("wainscot_cap_" + nm, F_MAIN, a, b, BRICK_TOP, BRICK_TOP + 0.06, 0, 0.13, M["brick"])
# porch recess
fbox("porch_back_lap", F_PORCH, -6.6, -4.6, 0.0, WALL_TOP, 0, 0.02, M["lap"])
fbox("porch_side_l", Frame((-6.6, 0, 0), (0, 1, 0)), 0.0, 1.5, 0.0, WALL_TOP, 0, 0.02, M["lap"])
fbox("porch_side_r", Frame((-4.6, 0, 0), (0, -1, 0)), -1.5, 0.0, 0.0, WALL_TOP, 0, 0.02, M["lap"])
wbox("porch_pier", -4.98, -4.6, -0.02, 0.36, 0.0, WALL_TOP, M["brick"])
wbox("porch_slab", -6.6, -4.6, 0.0, 1.5, 0.0, 0.24, M["concrete"])
wbox("porch_step", -6.75, -4.45, -0.42, 0.0, 0.0, 0.12, M["concrete"])
# connector (corner windows) and garage
fbox("conn_lap", F_CONN, 1.8, 4.6, BRICK_TOP, WALL_TOP, 0, 0.02, M["lap"])
fbox("conn_brick", F_CONN, 1.8, 4.6, 0.0, BRICK_TOP, 0, 0.11, M["brick"])
fbox("conn_brick_cap", F_CONN, 1.8, 4.6, BRICK_TOP, BRICK_TOP + 0.06, 0, 0.13, M["brick"])
F_CONN_SIDE = Frame((1.8, 0, 0), (0, -1, 0))
fbox("conn_side_lap", F_CONN_SIDE, 0.0, 1.0, BRICK_TOP, WALL_TOP, 0, 0.02, M["lap"])
fbox("conn_side_brick", F_CONN_SIDE, 0.0, 1.11, 0.0, BRICK_TOP, 0, 0.11, M["brick"])
fbox("gar_side_lap", Frame((4.6, 0, 0), (0, -1, 0)), 1.0, 1.8, 0.0, WALL_TOP, 0, 0.02, M["lap"])
fbox("gar_lap", F_GAR, 4.6, 12.4, 0.0, WALL_TOP, 0, 0.02, M["lap"])
for i, u in enumerate((4.6, 12.3)):
    fbox(f"gar_corner{i}", F_GAR, u, u + 0.1, 0.0, WALL_TOP, 0.02, 0.05, M["trim"])
fbox("main_corner", F_MAIN, -14.0, -13.9, BRICK_TOP, WALL_TOP, 0.02, 0.05, M["trim"])

# windows
window("win_left", F_MAIN, -11.45, -8.85, 0.93, 2.25, panes=3)
window("win_right", F_MAIN, -3.2, 0.75, 0.93, 2.25, panes=3)
window("win_conn_a", F_CONN, 2.0, 3.12, 0.93, 2.2, panes=2, blinds=False)
window("win_conn_b", F_CONN, 3.32, 4.42, 0.93, 2.2, panes=2, blinds=False)

# front door (dark brown) with brass hardware
W0 = 0.021
fbox("door_trim", F_PORCH, -6.35, -5.25, 0.24, 2.42, W0, W0 + 0.03, M["trim"])
fbox("door", F_PORCH, -6.27, -5.33, 0.26, 2.36, W0, W0 + 0.05, M["door"])
fbox("door_mailslot", F_PORCH, -6.0, -5.6, 1.0, 1.08, W0 + 0.05, W0 + 0.06, M["brass"])
fbox("door_kickplate", F_PORCH, -6.27, -5.33, 0.26, 0.32, W0 + 0.05, W0 + 0.055, M["brass"])
for i, v in enumerate((1.22, 1.45)):
    c = F_PORCH.p(-6.15, v, W0 + 0.08)
    cylinder(f"door_knob{i}", c.x, c.y - 0.02, c.z - 0.03, c.z + 0.03, 0.035, mat=M["brass"])
lantern("lamp_porch", F_PORCH, -6.48, 1.85)

# garage: side door, sectional door, lamps
fbox("sidedoor_trim", F_GAR, 5.07, 5.98, 0.0, 2.12, 0.02, 0.05, M["trim"])
fbox("sidedoor", F_GAR, 5.13, 5.92, 0.0, 2.05, 0.02, 0.06, M["trim"])
fbox("sidedoor_win", F_GAR, 5.3, 5.75, 1.35, 1.85, 0.06, 0.065, M["interior"])
c = F_GAR.p(5.25, 1.0, 0.09)
cylinder("sidedoor_knob", c.x, c.y, c.z - 0.03, c.z + 0.03, 0.03, mat=M["brass"])
GD0, GD1, GDH = 6.55, 11.45, 2.15
fbox("gd_trim_l", F_GAR, GD0 - 0.12, GD0, 0.0, GDH + 0.12, 0.02, 0.06, M["trim"])
fbox("gd_trim_r", F_GAR, GD1, GD1 + 0.12, 0.0, GDH + 0.12, 0.02, 0.06, M["trim"])
fbox("gd_trim_t", F_GAR, GD0 - 0.12, GD1 + 0.12, GDH, GDH + 0.12, 0.02, 0.06, M["trim"])
fbox("garage_door", F_GAR, GD0, GD1, 0.0, GDH, 0.0, 0.03, M["garage_door"])
rows, cols, m = 4, 8, 0.06
sec_h = GDH / rows
pw = (GD1 - GD0 - m * (cols + 1)) / cols
for r in range(rows):
    v0 = r * sec_h
    fbox(f"gd_joint{r}", F_GAR, GD0, GD1, v0, v0 + 0.008, 0.03, 0.034, M["interior"])
    for c_ in range(cols):
        u0 = GD0 + m + c_ * (pw + m)
        fbox(f"gd_panel{r}_{c_}", F_GAR, u0, u0 + pw, v0 + 0.08, v0 + sec_h - 0.07, 0.03, 0.045, M["garage_door"])
        fbox(f"gd_panel_in{r}_{c_}", F_GAR, u0 + 0.04, u0 + pw - 0.04, v0 + 0.12, v0 + sec_h - 0.11, 0.045, 0.052, M["garage_door"])
fbox("gd_sensor", F_GAR, 8.95, 9.05, 2.4, 2.48, 0.02, 0.07, M["lamp_metal"])
lantern("lamp_gar_l", F_GAR, 4.85, 2.05)
lantern("lamp_gar_r", F_GAR, 11.82, 2.05)
fbox("downspout_gar", F_GAR, 12.18, 12.28, 0.0, EAVE - 0.1, 0.06, 0.14, M["trim"])
fbox("downspout_main", F_MAIN, -14.1, -14.0, 0.0, EAVE - 0.1, 0.0, 0.08, M["trim"])

# chimney + roof vents
wbox("chimney", -4.85, -4.05, 1.2, 2.0, 2.6, 5.75, M["brick"])
wbox("chimney_crown", -4.95, -3.95, 1.1, 2.1, 5.75, 5.82, M["concrete"])
wbox("chimney_flashing", -4.9, -4.0, 1.15, 2.05, 3.30, 3.62, M["flashing"])
wbox("spark_arrestor", -4.78, -4.12, 1.27, 1.93, 5.82, 6.12, M["spark"])
wbox("spark_arrestor_top", -4.88, -4.02, 1.17, 2.03, 6.12, 6.16, M["spark"])
wbox("ridge_vent", -2.9, -2.3, 5.05, 5.45, 4.6, 4.86, M["vent"])
for i, (x, y) in enumerate(((6.3, 0.6), (9.4, 0.4), (-9.5, 7.5))):
    z = EAVE + (y + 2.4) * ROOF_SLOPE if x > 4 else EAVE + (11.1 - y) * ROOF_SLOPE
    cylinder(f"vent_pipe{i}", x, y, z - 0.3, z + 0.3, 0.11, mat=M["vent"])
    cylinder(f"vent_cap{i}", x, y, z + 0.3, z + 0.38, 0.17, 0.12, mat=M["vent"])

# --------------------------------------------------------------------------
# Site: yard, retaining walls, driveway, street
# --------------------------------------------------------------------------
DX0, DX1 = 5.2, 13.0        # driveway edges
WALL_Y = -11.0              # street-side retaining wall (scaled from the garage door in the street photos)
EDGE_Y = -16.5              # edge of the asphalt
CENTER_Y = -20.5            # double yellow line
DRIVE_FLAT_Y = -8.5         # driveway reaches yard grade here
plane("yard_a", [(-60, WALL_Y, 0), (DX0, WALL_Y, 0), (DX0, 60, 0), (-60, 60, 0)], M["yard"])
plane("yard_b", [(DX0, DRIVE_FLAT_Y, 0), (DX1, DRIVE_FLAT_Y, 0), (DX1, 60, 0), (DX0, 60, 0)], M["yard"])
plane("yard_c", [(DX1, WALL_Y, 0), (60, WALL_Y, 0), (60, 60, 0), (DX1, 60, 0)], M["yard"])
wbox("ret_wall", -24.0, DX0, WALL_Y - 0.3, WALL_Y, STREET_Z, 0.12, M["brick"])
wbox("ret_wall_cap", -24.0, DX0, WALL_Y - 0.33, WALL_Y + 0.02, 0.12, 0.2, M["brick"])
wbox("ret_wall_r", DX1 + 0.4, 26.0, WALL_Y - 0.3, WALL_Y, STREET_Z, 0.05, M["brick"])
wbox("ret_wall_r_cap", DX1 + 0.4, 26.0, WALL_Y - 0.33, WALL_Y + 0.02, 0.05, 0.13, M["brick"])
wbox("ret_wall_r_return", DX1 + 0.4, DX1 + 0.7, WALL_Y, -9.0, STREET_Z, 0.13, M["brick"])
# driveway rising from the street to the garage slab
dv = [(DX0 - 1.0, EDGE_Y, STREET_Z + 0.01), (DX1 + 1.4, EDGE_Y, STREET_Z + 0.01),
      (DX0, WALL_Y - 0.3, STREET_Z + 0.08), (DX1 + 0.4, WALL_Y - 0.3, STREET_Z + 0.08),
      (DX0, DRIVE_FLAT_Y, 0.01), (DX1 + 0.4, DRIVE_FLAT_Y, 0.01),
      (DX0, -1.8, 0.01), (DX1, -1.8, 0.01)]
mesh_obj("driveway", dv, [(0, 1, 3, 2), (2, 3, 5, 4), (4, 5, 7, 6)], M["drive"], recalc=False)
plane("shoulder", [(-60, EDGE_Y, STREET_Z), (60, EDGE_Y, STREET_Z), (60, WALL_Y - 0.3, STREET_Z), (-60, WALL_Y - 0.3, STREET_Z)], M["gravel"])
plane("street", [(-80, CENTER_Y - 4.0, STREET_Z - 0.01), (80, CENTER_Y - 4.0, STREET_Z - 0.01),
                 (80, EDGE_Y, STREET_Z - 0.01), (-80, EDGE_Y, STREET_Z - 0.01)], M["street"])
plane("far_shoulder", [(-80, -60, STREET_Z), (80, -60, STREET_Z), (80, CENTER_Y - 4.0, STREET_Z), (-80, CENTER_Y - 4.0, STREET_Z)], M["gravel"])
for i, yc in enumerate((CENTER_Y - 0.1, CENTER_Y + 0.1)):
    wbox(f"centerline{i}", -80, 80, yc - 0.05, yc + 0.05, STREET_Z - 0.01, STREET_Z + 0.002, M["yellow"])
for i, x in enumerate(range(-40, 41, 12)):
    wbox(f"marker{i}", x - 0.05, x + 0.05, CENTER_Y - 0.05, CENTER_Y + 0.05, STREET_Z, STREET_Z + 0.02, M["marker"])
# walkway from the porch out to the driveway
plane("walk_porch", [(-6.4, -3.6, 0.012), (-4.9, -3.6, 0.012), (-4.9, -0.42, 0.012), (-6.4, -0.42, 0.012)], M["concrete"])
plane("walk", [(-6.4, -4.5, 0.012), (DX0, -4.5, 0.012), (DX0, -3.6, 0.012), (-6.4, -3.6, 0.012)], M["concrete"])

# fence to the right of the garage, bins, rock
for i in range(int((19.5 - 12.4) / 0.14)):
    x = 12.4 + i * 0.14
    wbox(f"fence_board{i}", x, x + 0.135, 1.5, 1.52, 0.0, 1.85 + random.uniform(-0.01, 0.01), M["fence"])
wbox("fence_rail", 12.4, 19.5, 1.52, 1.57, 1.6, 1.68, M["fence"])
wbox("fence_cap", 12.4, 19.5, 1.47, 1.6, 1.85, 1.9, M["fence"])
for i, x in enumerate((12.45, 14.9, 17.3, 19.4)):
    wbox(f"fence_post{i}", x, x + 0.09, 1.52, 1.61, 0.0, 1.85, M["fence"])


def bin_(name, x, y, mat, rot):
    o = mesh_obj(name, [(-0.33, -0.36, 0), (0.33, -0.36, 0), (0.33, 0.36, 0), (-0.33, 0.36, 0),
                        (-0.37, -0.42, 1.0), (0.37, -0.42, 1.0), (0.37, 0.42, 1.0), (-0.37, 0.42, 1.0)], BOX_FACES, mat)
    lid = wbox(name + "_lid", -0.39, 0.39, -0.46, 0.44, 1.0, 1.06, mat)
    for ob in (o, lid):
        ob.location = (x, y, 0)
        ob.rotation_euler = (0, 0, rot)


bin_("bin_green", 13.1, 0.7, M["bin_green"], 0.15)
bin_("bin_blue", 15.0, 0.9, M["bin_blue"], -0.08)
bin_("bin_blue2", 15.9, 1.0, M["bin_blue"], 0.05)

bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
for v in bm.verts:
    v.co *= 1 + 0.15 * noise.noise(v.co * 1.7)
me = bpy.data.meshes.new("rock")
bm.to_mesh(me)
bm.free()
me.materials.append(M["rock"])
rock = link(bpy.data.objects.new("rock", me))
rock.location, rock.scale = (2.4, -6.3, 0.0), (0.45, 0.32, 0.25)

# lamp post with the house number
LP = (4.75, -4.95)
cylinder("post", LP[0], LP[1], 0.0, 2.05, 0.05, mat=M["post"])
cylinder("post_base", LP[0], LP[1], 0.0, 0.25, 0.08, 0.06, mat=M["post"])
lamp_head("post_lamp", (LP[0], LP[1], 2.25), 0.24, 0.36)
wbox("sign_plate", LP[0] - 0.24, LP[0] + 0.24, LP[1] - 0.09, LP[1] - 0.06, 1.38, 1.53, M["sign"])
txt = bpy.data.curves.new("house_number", "FONT")
txt.body = "13590"
txt.size = 0.11
txt.extrude = 0.004
txt.align_x = "CENTER"
txt.align_y = "CENTER"
txt.materials.append(M["sign_text"])
t = link(bpy.data.objects.new("house_number", txt))
t.location = (LP[0], LP[1] - 0.095, 1.455)
t.rotation_euler = (math.pi / 2, 0, 0)

# utility pole + wires (back right)
cylinder("utility_pole", 14.8, 9.0, 0.0, 10.5, 0.15, 0.12, mat=M["pole"])
wbox("pole_crossarm", 14.0, 15.6, 8.95, 9.05, 9.8, 9.9, M["pole"])
for i, (dx, dz) in enumerate(((-0.7, 9.92), (0.0, 9.92), (0.7, 9.92))):
    tube(f"wire{i}", [(14.8 + dx, 9.0, dz), (30 + dx, -6, dz - 1.4), (46 + dx, -21, dz)], [1, 1, 1], M["wire"]).data.bevel_depth = 0.008

# simple neighbours
for nm, (x0, x1, y0, y1) in {"nb_left": (-38, -23, 3, 14), "nb_right": (23.5, 37, 4, 14)}.items():
    wbox(nm, x0, x1, y0, y1, 0.0, WALL_TOP, M["neighbor"])
    hip_roof(nm + "_roof", x0 - 0.6, x1 + 0.6, y0 - 0.6, y1 + 0.6, gutters="")

# --------------------------------------------------------------------------
# Vegetation
# --------------------------------------------------------------------------
ASSET_Z = -60.0


def leaf_asset(name, width=0.42, mat=None):
    w = width / 2
    vs = [(0, 0, 0), (0.3, w, 0.04), (0.65, w * 0.85, 0.05), (1.0, 0, 0.02), (0.65, -w * 0.85, 0.05),
          (0.3, -w, 0.04), (0.3, 0, 0.0), (0.65, 0, 0.01)]
    fs = [(0, 1, 6), (1, 2, 7, 6), (2, 3, 7), (0, 6, 5), (6, 7, 4, 5), (7, 3, 4)]
    o = mesh_obj(name, vs, fs, mat, recalc=False)
    o.location = (0, 0, ASSET_Z)
    return o


def ball_asset(name, mat, squash=1.0):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0, matrix=Matrix.Diagonal((1, 1, squash, 1)))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    o = link(bpy.data.objects.new(name, me))
    o.location = (0, 0, ASSET_Z)
    return o


LEAF_OBJ = {k: leaf_asset("asset_leaf_" + k, mat=LEAF[k]) for k in
            ("citrus", "shrub", "shrub_light", "oak", "pistache", "maple", "olive")}
LEAF_OBJ["cedar"] = leaf_asset("asset_leaf_cedar", 0.18, LEAF["cedar"])
LEAF_OBJ["redwood"] = leaf_asset("asset_leaf_redwood", 0.16, LEAF["redwood"])
FRUIT = ball_asset("asset_fruit", LEAF["fruit"], 0.95)
FLOWER = ball_asset("asset_flower", LEAF["flower"], 0.6)
LEAF_AREA = 0.29  # area of a unit leaf asset


def blob(name, blobs, mat, subdiv=3, disp=0.2, nscale=1.3):
    """Union of displaced ellipsoids. blobs: [((x,y,z), (rx,ry,rz)), ...]"""
    bm = bmesh.new()
    off = Vector((random.uniform(0, 100), random.uniform(0, 100), random.uniform(0, 100)))
    for c, r in blobs:
        if not isinstance(r, (tuple, list)):
            r = (r, r, r)
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0,
                                   matrix=Matrix.Translation(c) @ Matrix.Diagonal((*r, 1)))
    bm.normal_update()
    for v in bm.verts:
        p = v.co * nscale + off
        d = noise.noise(p) + 0.5 * noise.noise(p * 2.1) + 0.25 * noise.noise(p * 4.3)
        v.co += v.normal * d * disp
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    return link(bpy.data.objects.new(name, me))


def scatter(obj, inst, count, size, seed, rand_rot=0.85, size_rand=0.45, name="scatter"):
    obj.modifiers.new(name, "PARTICLE_SYSTEM")
    ps = obj.particle_systems[-1]
    ps.seed = seed
    st = ps.settings
    st.name = obj.name + "_" + name
    st.type = "HAIR"
    st.use_advanced_hair = True
    st.count = int(count)
    st.hair_length = 1.0  # hair instances are scaled by particle_size * hair_length
    st.emit_from = "FACE"
    st.distribution = "RAND"
    st.use_even_distribution = True
    st.render_type = "OBJECT"
    st.instance_object = inst
    st.particle_size = size
    st.size_random = size_rand
    st.use_rotations = True
    st.rotation_mode = "NOR"
    st.rotation_factor_random = rand_rot
    st.phase_factor_random = 2.0
    return ps


SEED = [0]


def foliage(name, blobs, kind, leaf_size, density=1.6, disp=0.2, nscale=1.3, subdiv=3, core=True,
            max_count=250000, leaf_kind=None, inset=None):
    """Leaf-covered crown. The emitter itself is hidden; leaves sit on its surface and
    an inset copy (the shadowed inside of the plant) stops light leaking through."""
    obj = blob(name, blobs, CORE[kind], subdiv, disp, nscale)
    area = sum(p.area for p in obj.data.polygons)
    count = min(max_count, density * area / (LEAF_AREA * leaf_size ** 2))
    SEED[0] += 1
    scatter(obj, LEAF_OBJ[leaf_kind or kind], count, leaf_size, SEED[0], name="leaves")
    obj.show_instancer_for_render = False
    if core:
        me = obj.data.copy()
        d = leaf_size * 1.3 if inset is None else inset
        normals = [v.normal.copy() for v in me.vertices]
        for v, n in zip(me.vertices, normals):
            v.co -= n * d
        link(bpy.data.objects.new(name + "_core", me))
    return obj


def crown_clusters(center, spread, n, rmin, rmax, zsquash=0.8):
    cx, cy, cz = center
    sx, sy, sz = spread
    out = []
    for _ in range(n):
        r = random.uniform(rmin, rmax)
        out.append(((cx + random.gauss(0, sx), cy + random.gauss(0, sy), cz + random.gauss(0, sz)),
                    (r, r, r * zsquash)))
    return out


def ring_clusters(base, heights, radius_at, per_level, size_frac, squash, jitter=0.25):
    """Clusters arranged around a vertical trunk (conifers)."""
    out = []
    for h in heights:
        R = radius_at(h)
        for _ in range(per_level):
            a = random.uniform(0, 2 * math.pi)
            d = R * random.uniform(0.2, 0.75)
            r = R * size_frac * random.uniform(0.7, 1.15)
            out.append(((base.x + math.cos(a) * d, base.y + math.sin(a) * d, h + random.gauss(0, jitter)),
                        (r, r * 0.9, r * squash)))
    return out


# --- clipped shrubs along the front of the house
SHRUBS = [
    ("shrub_corner", [((-13.0, -1.1, 0.75), (0.95, 0.85, 0.8))], "shrub"),
    ("shrub_leftwin", [((-10.9, -1.0, 0.7), (1.0, 0.8, 0.75)), ((-9.5, -1.1, 0.75), (1.0, 0.85, 0.8))], "shrub_light"),
    ("shrub_tall_l", [((-7.75, -0.95, 1.25), (0.85, 0.8, 1.3))], "shrub"),
    ("shrub_tall_r", [((-3.95, -1.0, 1.2), (0.9, 0.8, 1.25))], "shrub"),
    ("shrub_rightwin", [((-1.8, -1.1, 0.65), (1.1, 0.8, 0.7))], "shrub_light"),
    ("camellia", [((0.9, -1.4, 1.0), (1.4, 1.1, 1.05)), ((2.1, -1.9, 0.8), (1.0, 0.9, 0.8))], "shrub"),
]
for nm, blobs, kind in SHRUBS:
    o = foliage(nm, blobs, kind, 0.085, density=2.2, disp=0.14, nscale=1.4)
    if nm == "camellia":
        SEED[0] += 1
        scatter(o, FLOWER, 160, 0.045, SEED[0], name="flowers")

# --- low ground-cover mounds in the front yard (two loose bands, gaps of dry lawn between)
for band, (ya, yb, hmax) in enumerate(((-10.4, -8.6, 0.7), (-7.4, -4.8, 0.85))):
    x = -18.0
    while x < 4.2:
        r = random.uniform(0.9, 1.7)
        y = random.uniform(ya, yb)
        if random.random() < 0.8:
            kind = random.choice(("shrub", "shrub_light", "olive", "shrub"))
            parts = [((x + random.gauss(0, r * 0.4), y + random.gauss(0, 0.3), 0.0),
                      (r * random.uniform(0.6, 1.0), r * random.uniform(0.5, 0.8), random.uniform(0.35, hmax)))
                     for _ in range(random.randint(1, 3))]
            foliage(f"groundcover{band}_{x:.1f}", parts, kind, 0.07, density=1.8, disp=0.18, nscale=1.2)
        x += r * random.uniform(1.0, 1.8)
# right of the driveway: low hedges and an olive
for i, (x, y, r, h) in enumerate(((14.6, -4.6, 1.2, 0.7), (16.8, -5.4, 1.4, 0.75), (14.0, -0.7, 0.9, 0.6),
                                  (15.6, -9.8, 1.3, 0.6), (18.6, -9.6, 1.5, 0.7))):
    foliage(f"hedge_r{i}", [((x, y, 0.0), (r, r * 0.8, h))], "shrub_light", 0.07, density=1.8, disp=0.14)
tube("olive_trunk", [(20.0, -6.5, 0), (19.7, -6.4, 1.5), (19.3, -6.2, 3.0)], [0.12, 0.09, 0.06], M["bark"])
foliage("olive", crown_clusters((19.4, -6.3, 3.7), (1.0, 0.8, 0.5), 9, 0.7, 1.2), "olive", 0.12, density=1.6, core=False)

# --- spiky iris / agapanthus clumps by the driveway
for ci, (cx, cy) in enumerate(((3.2, -4.9), (4.2, -5.5), (2.3, -4.2), (4.4, -3.9))):
    vs, fs = [], []
    for k in range(70):
        a = random.uniform(0, 2 * math.pi)
        lean = random.uniform(0.15, 0.75)
        L = random.uniform(0.6, 1.1)
        w = 0.025
        base = Vector((cx + random.gauss(0, 0.08), cy + random.gauss(0, 0.08), 0))
        d = Vector((math.cos(a) * lean, math.sin(a) * lean, 1.0)).normalized()
        side = Vector((-math.sin(a), math.cos(a), 0)) * w
        i0 = len(vs)
        for s in range(4):
            t_ = s / 3
            p = base + d * L * t_ + Vector((math.cos(a), math.sin(a), 0)) * (t_ ** 2) * 0.25 * L
            ww = (1 - t_ * 0.85)
            vs += [p - side * ww, p + side * ww]
        for s in range(3):
            fs.append((i0 + 2 * s, i0 + 2 * s + 1, i0 + 2 * s + 3, i0 + 2 * s + 2))
    mesh_obj(f"iris{ci}", vs, fs, LEAF["iris"], smooth=True, recalc=False)

# --- citrus tree in front of the garage (multi-stem, loaded with fruit)
CIT = Vector((3.3, -2.6, 0))
for i in range(4):
    a = i * math.pi / 2 + 0.4
    tip = CIT + Vector((math.cos(a) * 0.7, math.sin(a) * 0.6, 2.0))
    tube(f"citrus_stem{i}", [CIT + Vector((math.cos(a) * 0.1, math.sin(a) * 0.1, 0)),
                              CIT + Vector((math.cos(a) * 0.3, math.sin(a) * 0.25, 1.0)), tip],
         [0.07, 0.055, 0.03], M["bark"])
cit = foliage("citrus", [((3.3, -2.6, 3.0), (2.1, 1.9, 1.8))] + crown_clusters((3.3, -2.6, 3.2), (0.9, 0.8, 0.7), 9, 0.7, 1.2),
              "citrus", 0.11, density=2.0, disp=0.35, nscale=1.0)
SEED[0] += 1
scatter(cit, FRUIT, 340, 0.055, SEED[0], size_rand=0.25, name="fruit")

# --- big pistache / ash on the left with an airy crown
T0 = Vector((-11.6, -6.8, 0))
trunk_top = T0 + Vector((-0.3, 0.2, 4.2))
tube("bigtree_trunk", [T0, T0 + Vector((-0.1, 0.1, 2.0)), trunk_top], [0.30, 0.24, 0.19], M["bark"])
branches = [[trunk_top + Vector(p) for p in br] for br in (
    [(0, 0, 0), (-1.8, -0.6, 2.3), (-4.8, -1.1, 4.8), (-7.3, -0.6, 6.3)],
    [(0, 0, 0), (0.1, 0.1, 3.3), (0.7, 0.4, 6.3), (1.5, 0.8, 7.8)],
    [(0, 0, 0), (1.7, -0.4, 1.8), (3.7, -0.8, 3.4), (5.0, -1.0, 4.2)],
    [(0.1, -0.1, -1.2), (-2.3, 0.4, -0.4), (-4.8, 0.8, 0.8)],
    [(0.1, 0.1, 3.3), (-1.3, 0.8, 5.3), (-2.3, 1.4, 7.3)],
    [(0.1, 0.1, 2.0), (2.0, 1.5, 3.8), (3.2, 2.5, 5.6)],
)]
clusters = []
for i, br in enumerate(branches):
    tube(f"bigtree_branch{i}", br, [0.2, 0.14, 0.09, 0.05][:len(br)], M["bark"])
    for k in range(16):
        t_ = random.uniform(0.35, 1.0)
        seg = t_ * (len(br) - 1)
        j = min(int(seg), len(br) - 2)
        p = br[j].lerp(br[j + 1], seg - j)
        r = random.uniform(0.8, 1.6)
        clusters.append(((p.x + random.gauss(0, 1.0), p.y + random.gauss(0, 1.0), p.z + random.gauss(0, 0.6) + 0.3),
                         (r, r, r * 0.65)))
foliage("bigtree_crown", clusters, "pistache", 0.17, density=1.7, disp=0.45, nscale=0.9, inset=0.7, max_count=450000)

# --- tall, limbed-up cedar behind the house (the landmark tree)
CB = Vector((1.5, 12.5, 0))
tube("cedar_trunk", [CB, CB + Vector((0.1, 0, 7)), CB + Vector((-0.1, 0.1, 13)), CB + Vector((0.0, 0.0, 18.8))],
     [0.42, 0.34, 0.22, 0.06], M["cedar_bark"])
tube("cedar_limb", [CB + Vector((0.1, 0, 9.4)), CB + Vector((1.5, -0.2, 9.8)), CB + Vector((2.4, -0.3, 9.3)),
                    CB + Vector((2.6, -0.3, 8.0))], [0.15, 0.11, 0.08, 0.05], M["cedar_bark"])
tube("cedar_limb2", [CB + Vector((0.0, 0, 10.5)), CB + Vector((-1.7, 0.2, 11.3)), CB + Vector((-2.6, 0.3, 11.0))],
     [0.12, 0.08, 0.05], M["cedar_bark"])
cl = ring_clusters(CB, [10.0 + 0.55 * i for i in range(16)], lambda h: 2.6 * (1 - (h - 10.0) / 10.5) + 0.5,
                   2, 0.55, 0.55, 0.2)
cl += [((CB.x + 2.7, CB.y - 0.3, 7.9), (0.7, 0.6, 0.8)), ((CB.x + 2.0, CB.y - 0.2, 9.6), (0.8, 0.7, 0.45)),
       ((CB.x - 2.6, CB.y + 0.3, 11.1), (0.9, 0.7, 0.5)), ((CB.x - 0.4, CB.y, 18.9), (0.6, 0.6, 0.6)),
       ((CB.x + 0.8, CB.y + 0.3, 8.7), (0.7, 0.6, 0.4))]
foliage("cedar_crown", cl, "cedar", 0.36, density=1.8, disp=0.3, nscale=1.1)

# --- redwood (left-center, far behind) and background oaks
RB = Vector((-7.5, 26.0, 0))
tube("redwood_trunk", [RB, RB + Vector((0, 0, 20))], [0.6, 0.1], M["cedar_bark"])
rc = ring_clusters(RB, [3.0 + 0.6 * i for i in range(29)], lambda h: 4.6 * (1 - h / 21.5) + 0.4, 4, 0.7, 0.5, 0.2)
foliage("redwood_crown", rc, "redwood", 0.45, density=1.5, disp=0.35, nscale=0.9)

OAKS = [((-1.0, 22.0), 7.5, 6.5), ((10.5, 17.0), 9.0, 7.0), ((-17.5, 16.0), 7.0, 6.0), ((22.0, 11.0), 6.0, 5.5),
        ((-27.0, 21.0), 8.0, 7.0), ((16.0, 30.0), 10.0, 7.0), ((-12.0, 34.0), 9.0, 8.0), ((30.0, 22.0), 9.0, 7.0),
        ((5.0, 32.0), 10.0, 7.0)]
for i, ((x, y), h, r) in enumerate(OAKS):
    tube(f"oak_trunk{i}", [(x, y, 0), (x + 0.3, y, h * 0.4), (x, y, h * 0.7)], [0.5, 0.4, 0.25], M["bark"])
    foliage(f"oak{i}", crown_clusters((x, y, h), (r * 0.45, r * 0.4, h * 0.13), 16, r * 0.3, r * 0.55, 0.65),
            "oak", 0.42, density=1.4, disp=0.7, nscale=0.55, inset=0.45)

# red maple by the fence (right)
tube("maple_trunk", [(19.2, 6.0, 0), (19.1, 6.0, 2.8)], [0.10, 0.07], M["bark"])
foliage("maple", crown_clusters((19.1, 6.0, 4.3), (0.5, 0.5, 0.8), 8, 0.5, 0.85), "maple", 0.12, density=1.4, disp=0.3, nscale=1.3, core=False)

# street trees behind the camera: never in frame, but their dappled shade falls across the road
for i, (x, y, z, r) in enumerate(((-7.0, -38.0, 3.6, 2.6), (8.0, -39.0, 4.2, 3.0), (17.0, -38.5, 3.2, 2.4))):
    tube(f"street_tree_trunk{i}", [(x, y, STREET_Z), (x, y, z)], [0.25, 0.18], M["bark"])
    foliage(f"street_tree{i}", crown_clusters((x, y, z + 0.5), (1.4, 0.9, 0.7), 8, r * 0.35, r * 0.6), "oak", 0.5,
            density=0.9, disp=0.6, nscale=0.6, core=False)

# --------------------------------------------------------------------------
# Lighting, camera, render settings
# --------------------------------------------------------------------------
SUN_ELEV = math.radians(14.0)
SUN_AZ = math.radians(32.0)         # light travels toward +Y and -X: sun behind the camera, to its right

world = bpy.data.worlds.new("sky")
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
bg = wn["Background"]
sky = wn.new("ShaderNodeTexSky")
sky.sky_type = "MULTIPLE_SCATTERING"
sky.sun_disc = False
sky.sun_elevation = SUN_ELEV
sky.sun_rotation = SUN_AZ          # sky sun position is (sin r, -cos r); matches the lamp
sky.altitude = 100.0
sky.aerosol_density = 0.25
sky.ozone_density = 1.5
# Camera rays see a deeper, clearer blue (like the phone photos); everything else is lit by the physical sky.
lp = wn.new("ShaderNodeLightPath")
tint = wn.new("ShaderNodeMix")
tint.data_type = "RGBA"
tint.blend_type = "MULTIPLY"
ins = {x.identifier: x for x in tint.inputs}
world.node_tree.links.new(lp.outputs["Is Camera Ray"], ins["Factor_Float"])
world.node_tree.links.new(sky.outputs[0], ins["A_Color"])
ins["B_Color"].default_value = (0.42, 0.62, 0.95, 1.0)
world.node_tree.links.new({x.identifier: x for x in tint.outputs}["Result_Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 0.16

sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 7.0
sun_data.angle = math.radians(0.55)
sun_data.color = (1.0, 0.76, 0.52)
sun = link(bpy.data.objects.new("sun", sun_data))
sun.rotation_euler = (math.pi / 2 - SUN_ELEV, 0.0, SUN_AZ)

cam_data = bpy.data.cameras.new("street_cam")
cam_data.lens = 26.0            # phone main-camera equivalent
cam_data.sensor_width = 36.0
cam = link(bpy.data.objects.new("street_cam", cam_data))
cam.location = (-1.2, CENTER_Y - 7.2, STREET_Z + 1.6)   # standing on the far side of the street
target = Vector((-0.6, 0.0, 3.2))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam

r = scene.render
r.engine = "CYCLES"
r.resolution_x, r.resolution_y = 1920, 1080
r.resolution_percentage = 100
r.film_transparent = False
c = scene.cycles
c.device = "CPU"
c.samples = 6000
c.use_adaptive_sampling = False
c.use_denoising = False
c.max_bounces = 6
c.diffuse_bounces = 3
c.glossy_bounces = 2
c.transmission_bounces = 6
c.transparent_max_bounces = 8
c.volume_bounces = 0
c.caustics_reflective = False
c.caustics_refractive = False
c.sample_clamp_indirect = 8.0
c.seed = 13590
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = -0.45

bpy.ops.wm.save_as_mainfile(filepath=OUT)
print("saved", OUT, "objects:", len(bpy.data.objects))
