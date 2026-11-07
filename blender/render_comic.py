"""Render every panel of The Great Goo Caper in Blender (Cycles + Freestyle ink lines).

Usage (with Blender's Python module, `pip install bpy`):
    python blender/render_comic.py blender/story.json comic-art [panel-id ...] [--quick]

Each panel in story.json lists its 2D layout (x/y in panel pixels, feet at y). The camera is an
orthographic camera tilted 5 degrees down, set up so that a point at depth 0 lands on exactly the
same pixel as in the 2D layout. That keeps the HTML speech bubbles lined up with the renders.
"""
import bpy, bmesh, json, math, os, random, sys, time, zlib

TILT = math.radians(5.0)
CAM_DIST = 20.0
INK = '#1b1b1f'
QUICK = '--quick' in sys.argv
args = [a for a in sys.argv[1:] if not a.startswith('--')]
STORY, OUT = args[0], args[1]
ONLY = set(args[2:])

# ---------------------------------------------------------------- helpers
def lin(h):
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)

S = {}  # per-scene state


def mat(hexcol, rough=0.55, emit=0.0, metal=0.0):
    key = (hexcol, rough, emit, metal)
    if key in S['mats']:
        return S['mats'][key]
    m = bpy.data.materials.new(hexcol)
    try:
        m.use_nodes = True
    except Exception:
        pass
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = lin(hexcol)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emit:
        p.inputs['Emission Color'].default_value = lin(hexcol)
        p.inputs['Emission Strength'].default_value = emit
    S['mats'][key] = m
    return m


def link(o, m=None, parent=None, noline=False):
    if noline:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        S['noline'].objects.link(o)
    if m is not None:
        o.data.materials.clear()
        o.data.materials.append(m)
    if parent is not None:
        o.parent = parent
    return o


def smooth(o):
    n = len(o.data.polygons)
    o.data.polygons.foreach_set('use_smooth', [True] * n)


def place(o, loc, rot=(0, 0, 0), scale=(1, 1, 1)):
    o.location = loc
    o.rotation_euler = [math.radians(r) for r in rot]
    o.scale = scale
    return o


def sphere(loc, r, m, parent=None, scale=(1, 1, 1), rot=(0, 0, 0), seg=28, rings=16, noline=False):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r)
    o = bpy.context.active_object
    smooth(o)
    link(o, m, parent, noline)
    return place(o, loc, rot, scale)


def cap(loc, r, m, parent=None, axis=(0, 0, 1), cut=0.0, rot=(0, 0, 0), scale=(1, 1, 1)):
    """Sphere with everything below `cut` (along axis) removed: hair, hoods."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=18, radius=r)
    o = bpy.context.active_object
    bm = bmesh.new()
    bm.from_mesh(o.data)
    kill = [v for v in bm.verts if (v.co.x * axis[0] + v.co.y * axis[1] + v.co.z * axis[2]) < cut * r - 1e-6]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
    smooth(o)
    mod = o.modifiers.new('solid', 'SOLIDIFY')
    mod.thickness = 0.01
    link(o, m, parent)
    return place(o, loc, rot, scale)


def box(loc, size, m, parent=None, rot=(0, 0, 0), bevel=0.0, noline=False):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    for v in o.data.vertices:
        v.co = (v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL')
        b.width = bevel
        b.segments = 3
        b.limit_method = 'NONE'
    link(o, m, parent, noline)
    return place(o, loc, rot)


def cyl(loc, r, depth, m, parent=None, rot=(0, 0, 0), verts=32, r2=None, noline=False, scale=(1, 1, 1)):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth)
    o = bpy.context.active_object
    smooth(o)
    link(o, m, parent, noline)
    return place(o, loc, rot, scale)


def cone(loc, r, depth, m, parent=None, rot=(0, 0, 0), verts=24, noline=False):
    return cyl(loc, r, depth, m, parent, rot, verts, r2=0.0, noline=noline)


def torus(loc, R, r, m, parent=None, rot=(90, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=32, minor_segments=8)
    o = bpy.context.active_object
    smooth(o)
    link(o, m, parent)
    return place(o, loc, rot)


def curve(points, bevel, m, parent=None, noline=False, cyclic=False):
    cu = bpy.data.curves.new('c', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = bevel
    cu.bevel_resolution = 2
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for i, p in enumerate(points):
        sp.points[i].co = (p[0], p[1], p[2], 1)
    sp.use_cyclic_u = cyclic
    o = bpy.data.objects.new('c', cu)
    (S['noline'] if noline else bpy.context.scene.collection).objects.link(o)
    o.data.materials.append(m)
    if parent is not None:
        o.parent = parent
    return o


def text(loc, body, size, m, parent=None, rot=(90, 0, 0), extrude=0.01, noline=True):
    cu = bpy.data.curves.new('t', 'FONT')
    cu.body = body
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.extrude = extrude
    o = bpy.data.objects.new('t', cu)
    (S['noline'] if noline else bpy.context.scene.collection).objects.link(o)
    o.data.materials.append(m)
    if parent is not None:
        o.parent = parent
    return place(o, loc, rot)


def empty(parent=None):
    o = bpy.data.objects.new('root', None)
    bpy.context.scene.collection.objects.link(o)
    if parent is not None:
        o.parent = parent
    return o

# ---------------------------------------------------------------- camera mapping
def world(x2d, y2d, depth=0.0):
    """Panel pixel -> world point at the given depth (Y) that projects onto that pixel."""
    W, H = S['W'], S['H']
    v = (H / 2 - y2d) / 100.0
    z = S['Zc'] + (v - (CAM_DIST + depth) * math.sin(TILT)) / math.cos(TILT)
    return ((x2d - W / 2) / 100.0, depth, z)

# ---------------------------------------------------------------- characters
C = {
    'winston': dict(skin='#f3cba5', hair='spiky', shirt='#2fb36b', sleeve='#2fb36b', hand='#f3cba5', pants='#2d4a8a', shoes='#e04a2f', stripe='#ffffff'),
    'derek': dict(skin='#ecc29b', hair='neat', glasses=1, shirt='#1f8a9e', sleeve='#1f8a9e', hand='#ecc29b', pants='#c9a46a', shoes='#5a3a22'),
    'spidey': dict(mask='#d7263d', web=INK, shirt='#d7263d', sleeve='#1e5bd8', hand='#d7263d', pants='#1e5bd8', shoes='#d7263d', emblem=INK, bodyWeb=INK),
    'spin': dict(mask='#2a2a30', web='#e63946', shirt='#2a2a30', sleeve='#2a2a30', hand='#e63946', pants='#2a2a30', shoes='#e63946', emblem='#e63946', bodyWeb='#e63946'),
    'ghost': dict(mask='#f4f4f6', web='#8a9aa6', hood='#f4f4f6', hoodIn='#2ec4b6', shirt='#f4f4f6', sleeve='#f4f4f6', hand='#ff5ca8', pants='#f4f4f6', shoes='#ff5ca8', emblem=INK, side='#ff5ca8'),
    'goblin': dict(skin='#7cc242', face='goblin', shirt='#6b2fa3', sleeve='#5aa832', hand='#5aa832', pants='#5aa832', shoes='#6b2fa3', belt='#3f1a66'),
    'rhino': dict(mask='#8d939b', face='rhino', shirt='#8d939b', sleeve='#8d939b', hand='#7d838b', pants='#7d838b', shoes='#666b73', wide=1.45, headR=25),
}
POSES = {'down': (12, -12), 'up': (160, -160), 'wave': (12, -150), 'point': (12, -90), 'cheer': (135, -135),
         'swing': (22, -170), 'hips': (42, -42), 'hug': (70, -70), 'flail': (120, -60)}


def arm_end(sx, sz, a, length=0.5):
    r = math.radians(a)
    return (sx - math.sin(r) * length, 0.0, sz - math.cos(r) * length)


def front(hr, x, dz, push=0.0):
    return -math.sqrt(max(hr * hr - x * x - dz * dz, 0.0)) - push


def face_curve(root, hz, hr, pts2, m, bevel=0.011):
    pts = [(x, front(hr, x, z) + 0.004, hz + z) for x, z in pts2]
    return curve(pts, bevel, m, root, noline=True)


def person(root, c, pose, o):
    Wd = c.get('wide', 1.0)
    L, R = POSES.get(pose or 'down', POSES['down'])
    ink = mat(INK, 0.5)
    hz, hr = 1.50, c.get('headR', 22) / 100.0
    sx, sz = 0.28 * Wd, 1.16
    # legs + shoes
    for side in (-1, 1):
        x = side * 0.12 * Wd
        curve([(x, 0, 0.80), (x, 0, 0.10)], 0.085, mat(c['pants']), root)
        sphere((x, -0.04, 0.06), 1, mat(c['shoes'], 0.4), root, scale=(0.13 * Wd, 0.16, 0.065))
    # arms
    hands = {}
    for side, a in ((-1, L), (1, R)):
        end = arm_end(side * sx, sz, a)
        curve([(side * sx, 0, sz + 0.02), end], 0.066, mat(c['sleeve']), root)
        sphere(end, 0.078, mat(c['hand']), root)
        hands[side] = end
    # torso
    box((0, 0, 1.0), (0.5 * Wd, 0.32, 0.56), mat(c['shirt']), root, bevel=0.1)
    fy = -0.162
    if c.get('stripe'):
        for x in (-0.11, 0.11):
            box((x, fy - 0.004, 1.0), (0.035, 0.01, 0.5), mat(c['stripe']), root, noline=True)
    if c.get('side'):
        for x in (-1, 1):
            box((x * (0.25 * Wd - 0.04), fy - 0.004, 1.0), (0.05, 0.01, 0.34), mat(c['side']), root, noline=True)
    if c.get('belt'):
        box((0, 0, 0.77), (0.51 * Wd, 0.33, 0.08), mat(c['belt']), root)
    if c.get('bodyWeb'):
        wm = mat(c['bodyWeb'], 0.5)
        for ex, ez in ((-0.24, 1.26), (0.24, 1.26), (-0.25, 0.96), (0.25, 0.96), (-0.14, 0.74), (0.14, 0.74)):
            curve([(0, fy - 0.006, 1.04), (ex, fy - 0.006, ez)], 0.0045, wm, root, noline=True)
    if c.get('emblem'):
        em = mat(c['emblem'], 0.4)
        sphere((0, fy - 0.01, 1.02), 1, em, root, scale=(0.04, 0.015, 0.065), noline=True)
        sphere((0, fy - 0.01, 1.11), 0.03, em, root, noline=True)
        for side in (-1, 1):
            for dz, ez in ((0.04, 0.12), (0.0, 0.06), (-0.02, -0.04), (-0.04, -0.1)):
                curve([(side * 0.02, fy - 0.012, 1.04 + dz), (side * 0.1, fy - 0.012, 1.04 + ez * 0.7 + 0.02)], 0.006, em, root, noline=True)
    # held item
    if o.get('hold'):
        hold(root, o['hold'], hands[1])
    if o.get('web') is not None:
        hx, _, hzz = hands[1]
        wcol = mat('#ffffff', 0.4)
        curve([(hx, 0, hzz), (hx + o['web'] / 100.0, 0, 14)], 0.018, wcol, root)
    # head
    mood = o.get('mood')
    face = c.get('face')
    if face == 'goblin':
        skin = mat(c['skin'])
        for side in (-1, 1):
            cone((side * 0.26, 0.0, hz + 0.05), 0.06, 0.2, skin, root, rot=(0, side * 70, 0))
        sphere((0, 0, hz), hr, skin, root)
        for side in (-1, 1):
            sphere((side * 0.085, front(hr, 0.085, 0.02), hz + 0.02), 1, mat('#ffe14d', 0.3, 0.4), root, scale=(0.06, 0.03, 0.04))
            sphere((side * 0.085, front(hr, 0.085, 0.02, 0.022), hz + 0.02), 1, ink, root, scale=(0.014, 0.01, 0.034), noline=True)
            curve([(side * 0.16, front(hr, 0.15, 0.1) - 0.01, hz + 0.11), (side * 0.03, front(hr, 0.03, 0.06) - 0.01, hz + 0.07)], 0.014, ink, root, noline=True)
        if mood in ('shock', 'sad'):
            sphere((0, front(hr, 0, -0.11), hz - 0.11), 1, ink, root, scale=(0.05, 0.02, 0.06))
        else:
            sphere((0, front(hr, 0, -0.09), hz - 0.09), 1, mat('#ffffff', 0.3), root, scale=(0.13, 0.03, 0.055))
            for x in (-0.06, 0, 0.06):
                curve([(x, front(hr, 0, -0.09) - 0.032, hz - 0.06), (x, front(hr, 0, -0.09) - 0.032, hz - 0.13)], 0.004, ink, root, noline=True)
        hat = mat('#6b2fa3')
        cap((0, 0.0, hz), hr * 1.07, hat, root, rot=(-20, 0, 0))
        cone((0.08, 0.02, hz + 0.3), 0.2, 0.42, hat, root, rot=(0, 28, 0))
        cone((0.27, 0.02, hz + 0.47), 0.07, 0.22, hat, root, rot=(0, 70, 0))
    elif face == 'rhino':
        g = mat(c['mask'])
        for side in (-1, 1):
            cone((side * 0.2, 0.02, hz + 0.18), 0.06, 0.14, g, root, rot=(0, side * 25, 0))
        sphere((0, 0, hz), hr, g, root)
        sphere((0, -0.14, hz - 0.08), 1, mat('#a9aeb5'), root, scale=(0.14, 0.12, 0.1))
        cone((0.02, -0.22, hz + 0.02), 0.075, 0.36, mat('#efe8d4', 0.35), root, rot=(28, 0, 0))
        for side in (-1, 1):
            sphere((side * 0.11, front(hr, 0.11, 0.02), hz + 0.02), 0.028, ink, root, noline=True)
            curve([(side * 0.19, front(hr, 0.18, 0.1) - 0.01, hz + 0.11), (side * 0.05, front(hr, 0.05, 0.08) - 0.01, hz + 0.07)], 0.018, ink, root, noline=True)
        if mood == 'sad':
            curve([(-0.06, -0.255, hz - 0.15), (0, -0.262, hz - 0.11), (0.06, -0.255, hz - 0.15)], 0.009, ink, root, noline=True)
        else:
            curve([(-0.07, -0.258, hz - 0.13), (0.07, -0.258, hz - 0.13)], 0.009, ink, root, noline=True)
    elif c.get('mask'):
        if c.get('hood'):
            cap((0, 0.03, hz + 0.01), hr + 0.06, mat(c['hood']), root, axis=(0, 1, 0), cut=-0.35)
            torus((0, -0.06, hz + 0.01), hr + 0.035, 0.018, mat(c['hoodIn']), root, rot=(90, 0, 0))
        sphere((0, 0, hz), hr, mat(c['mask'], 0.45), root)
        # web pattern: wireframe of a low-res sphere
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=hr + 0.002)
        w = bpy.context.active_object
        wf = w.modifiers.new('wire', 'WIREFRAME')
        wf.thickness = 0.006
        link(w, mat(c['web'], 0.5), root, noline=True)
        place(w, (0, 0, hz), (90, 0, 0))
        big = 1.25 if mood in ('shock', 'wow') else 1.0
        for side in (-1, 1):
            ex, ez = side * 0.1, hz + 0.03
            ey = front(hr, 0.1, 0.03)
            sphere((ex, ey + 0.004, ez), 1, ink, root, scale=(0.095 * big, 0.04, 0.065 * big), rot=(0, side * -28, side * 24))
            sphere((ex, ey - 0.006, ez), 1, mat('#ffffff', 0.25), root, scale=(0.078 * big, 0.04, 0.05 * big), rot=(0, side * -28, side * 24), noline=True)
    else:
        sphere((0, 0, hz), hr, mat(c['skin'], 0.6), root)
        for side in (-1, 1):
            sphere((side * 0.13, front(hr, 0.13, -0.06) + 0.012, hz - 0.06), 1, mat('#f29a9a', 0.6), root, scale=(0.04, 0.012, 0.03), noline=True)
        if mood in ('shock', 'wow'):
            for side in (-1, 1):
                ey = front(hr, 0.08, 0.02)
                sphere((side * 0.08, ey + 0.012, hz + 0.02), 0.04, mat('#ffffff', 0.3), root)
                sphere((side * 0.08, ey - 0.022, hz + 0.02), 0.018, ink, root, noline=True)
            sphere((0, front(hr, 0, -0.11), hz - 0.11), 1, ink, root, scale=(0.045, 0.02, 0.055))
        else:
            for side in (-1, 1):
                sphere((side * 0.08, front(hr, 0.08, 0.02) + 0.008, hz + 0.02), 0.028, ink, root, noline=True)
            if mood == 'sad':
                face_curve(root, hz, hr, [(-0.07, -0.13), (0, -0.09), (0.07, -0.13)], ink)
                for side in (-1, 1):
                    face_curve(root, hz, hr, [(side * 0.13, 0.09), (side * 0.04, 0.07)], ink, 0.008)
            elif mood == 'laugh':
                sphere((0, front(hr, 0, -0.1) + 0.01, hz - 0.1), 1, mat('#8a2a2a', 0.5), root, scale=(0.085, 0.02, 0.055))
            elif mood == 'think':
                face_curve(root, hz, hr, [(-0.05, -0.11), (0.06, -0.09)], ink)
            else:
                face_curve(root, hz, hr, [(-0.08, -0.08), (-0.04, -0.12), (0, -0.13), (0.04, -0.12), (0.08, -0.08)], ink)
        if c.get('glasses'):
            for side in (-1, 1):
                torus((side * 0.08, front(hr, 0.08, 0.02) - 0.03, hz + 0.02), 0.068, 0.009, ink, root)
            curve([(-0.012, front(hr, 0, 0.02) - 0.03, hz + 0.02), (0.012, front(hr, 0, 0.02) - 0.03, hz + 0.02)], 0.008, ink, root, noline=True)
        hair = mat('#202024', 0.5)
        if c.get('hair') == 'spiky':
            cap((0, 0, hz), hr * 1.07, hair, root, rot=(-28, 0, 0))
            for a in (-70, -45, -22, 0, 22, 45, 70):
                r = math.radians(a)
                cone((math.sin(r) * hr * 1.05, 0.03, hz + math.cos(r) * hr * 1.05 + 0.02), 0.06, 0.16, hair, root, rot=(0, a, 0))
        elif c.get('hair') == 'neat':
            cap((0, 0.02, hz + 0.01), hr * 1.06, hair, root, cut=0.2, rot=(-40, 0, 0), scale=(1.0, 1.0, 1.0))
            cap((0, 0.01, hz + 0.02), hr * 1.07, hair, root, cut=0.45, rot=(-10, 0, 0))
    if o.get('glider'):
        gm = mat('#3c6e1f')
        sphere((0, 0, 0.0), 1, gm, root, scale=(0.8, 0.32, 0.07), rot=(25, 0, 0))
        for side in (-1, 1):
            cone((side * 0.82, 0.0, 0.0), 0.09, 0.26, gm, root, rot=(0, side * 90, 0))
        cone((0, 0.05, -0.2), 0.07, 0.24, mat('#ffb703', 0.4, 4.0), root, rot=(180, 0, 0), noline=True)


def hold(root, kind, at):
    x, y, z = at
    if kind == 'remote':
        box((x, y - 0.08, z + 0.02), (0.13, 0.06, 0.2), mat('#333a44'), root, bevel=0.02)
        box((x, y - 0.115, z + 0.06), (0.08, 0.01, 0.05), mat('#3ad0ff', 0.3, 2.0), root, noline=True)
        curve([(x + 0.04, y - 0.08, z + 0.12), (x + 0.08, y - 0.08, z + 0.26)], 0.01, mat(INK), root)
        sphere((x + 0.08, y - 0.08, z + 0.27), 0.03, mat('#ff3b3b', 0.3, 3.0), root)
    elif kind == 'mop':
        curve([(x, y - 0.06, z + 0.5), (x, y - 0.06, z - 0.95)], 0.025, mat('#a0703a'), root)
        cyl((x, y - 0.06, z - 1.05), 0.2, 0.22, mat('#e9e3cf', 0.9), root, r2=0.1, verts=12)
    elif kind == 'band':
        torus((x, y, z - 0.04), 0.085, 0.03, mat('#d7263d', 0.4), root, rot=(0, 0, 0))


def bolt(root, pose):
    L, R = {'cheer': (140, -140), 'wave': (12, -150), 'up': (160, -160)}.get(pose, (15, -15))
    metal = mat('#c9d3dd', 0.3, metal=0.4)
    dark = mat('#4a5563', 0.5)
    joint = mat('#9fb0c0', 0.4, metal=0.3)
    for side in (-1, 1):
        box((side * 0.11, 0, 0.14), (0.1, 0.12, 0.2), joint, root)
        box((side * 0.12, -0.02, 0.035), (0.16, 0.2, 0.07), dark, root, bevel=0.02)
        e = arm_end(side * 0.24, 0.55, L if side < 0 else R, 0.28)
        curve([(side * 0.24, 0, 0.55), e], 0.04, joint, root)
        sphere(e, 0.05, mat('#ffb703', 0.4), root)
    box((0, 0, 0.43), (0.48, 0.3, 0.42), metal, root, bevel=0.05)
    box((0, -0.15, 0.48), (0.24, 0.02, 0.14), mat('#2b3a4a', 0.3), root)
    curve([(-0.08, -0.165, 0.46), (-0.03, -0.165, 0.51), (0.02, -0.165, 0.43), (0.07, -0.165, 0.49)], 0.008, mat('#7CFC00', 0.3, 4.0), root, noline=True)
    text((0, -0.155, 0.29), 'BOLT', 0.09, mat(INK), root, extrude=0.004)
    box((0, 0, 0.67), (0.12, 0.12, 0.08), joint, root)
    box((0, 0, 0.82), (0.4, 0.3, 0.28), metal, root, bevel=0.05)
    for side in (-1, 1):
        box((side * 0.09, -0.15, 0.86), (0.1, 0.02, 0.09), mat('#3ad0ff', 0.2, 3.0), root, bevel=0.01)
    curve([(-0.06, -0.152, 0.75), (0, -0.152, 0.73), (0.06, -0.152, 0.75)], 0.008, mat(INK), root, noline=True)
    curve([(0, 0, 0.96), (0, 0, 1.08)], 0.012, mat(INK), root)
    sphere((0, 0, 1.11), 0.04, mat('#ff3b3b', 0.3, 3.0), root)


def tracee(root):
    sphere((0, 0, 0), 0.2, mat('#e9eef3', 0.25), root)
    box((0, -0.16, 0.02), (0.3, 0.1, 0.12), mat('#1e5bd8', 0.3), root, bevel=0.05)
    for side in (-1, 1):
        sphere((side * 0.06, -0.215, 0.02), 0.025, mat('#99ffff', 0.2, 4.0), root, noline=True)
        curve([(side * 0.19, 0, -0.02), (side * 0.28, 0, -0.08)], 0.015, mat(INK), root)
    curve([(0, 0, 0.2), (0, 0, 0.3)], 0.01, mat(INK), root)
    sphere((0, 0, 0.32), 0.035, mat('#d7263d', 0.3, 2.0), root)


def machine(root):
    purple, dark = mat('#5d2b8f'), mat('#2b1645')
    box((0, 0, 0.42), (1.64, 0.9, 0.84), purple, root, bevel=0.06)
    box((-0.44, -0.46, 0.6), (0.56, 0.04, 0.28), dark, root, bevel=0.02)
    for gx in (-0.58, -0.32):
        cyl((gx, -0.49, 0.6), 0.08, 0.02, mat('#ffffff', 0.3), root, rot=(90, 0, 0))
        curve([(gx, -0.505, 0.6), (gx + 0.05, -0.505, 0.65)], 0.008, mat(INK), root, noline=True)
    text((0, -0.46, 0.18), 'GOO-BLASTER 3000', 0.15, mat('#b6ff5c', 0.3, 3.0), root, extrude=0.005)
    cyl((0, 0, 1.22), 0.42, 0.84, mat('#b8f08f', 0.1, 0.5), root)
    cyl((0, 0, 1.06), 0.425, 0.5, mat('#5fb52c', 0.3, 0.4), root)
    for bx, bz, br in ((-0.14, 1.4, 0.05), (0.12, 1.0, 0.04), (0.2, 1.3, 0.03)):
        sphere((bx, -0.42, bz), br, mat('#e6ffcf', 0.2, 1.0), root, noline=True)
    cyl((0, 0, 1.66), 0.46, 0.1, mat('#7a7f88', 0.35, metal=0.6), root)
    a = math.degrees(math.atan2(1.61 - 1.18, 1.08 - 0.43))
    cyl((0.76, 0.1, 1.40), 0.12, 0.8, mat('#7a7f88', 0.35, metal=0.6), root, rot=(0, 90 - a, 0))
    cyl((1.1, 0.1, 1.62), 0.1, 0.06, mat('#3c6e1f'), root, rot=(0, 90 - a, 0))
    curve([(0.6, -0.3, 0.84), (0.76, -0.3, 1.2)], 0.025, mat(INK), root)
    sphere((0.77, -0.3, 1.23), 0.07, mat('#ff3b3b', 0.3), root)


def goo(root):
    g = mat('#79d13a', 0.15)
    sphere((0, 0, 0), 1, g, root, scale=(0.15, 0.12, 0.14))
    sphere((0.06, 0, -0.08), 1, g, root, scale=(0.08, 0.08, 0.06))
    sphere((-0.05, -0.1, 0.06), 0.035, mat('#e6ffcf', 0.2, 1.0), root, noline=True)


def net(center, r, flat):
    wm = mat('#ffffff', 0.4)
    cx, cy, cz = center

    def P(a, rr):
        if flat:
            return (cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.9, cz)
        return (cx + math.cos(a) * rr, cy, cz + math.sin(a) * rr)
    for i in range(8):
        a = i * math.pi / 4
        curve([P(a, 0), P(a, r)], 0.016, wm)
    for k in (0.35, 0.68, 1.0):
        pts = [P(i * math.pi / 4, r * k * (0.93 if i % 2 else 1)) for i in range(8)]
        curve(pts, 0.014, wm, cyclic=True)


def spark(root):
    y = mat('#ffe14d', 0.3, 3.0)
    for a in range(0, 360, 45):
        cone((math.sin(math.radians(a)) * 0.12, 0, math.cos(math.radians(a)) * 0.12), 0.07, 0.24 if a % 90 == 0 else 0.15, y, root, rot=(0, a, 0), verts=8)
    sphere((0, 0, 0), 0.1, y, root)


def trophy(root):
    gold = mat('#f4c430', 0.25, metal=0.8)
    box((0, 0, 0.05), (0.44, 0.3, 0.1), mat('#8b5a2b'), root)
    cyl((0, 0, 0.2), 0.05, 0.2, gold, root)
    cyl((0, 0, 0.52), 0.1, 0.44, gold, root, r2=0.27)
    for side in (-1, 1):
        torus((side * 0.27, 0, 0.58), 0.09, 0.02, gold, root, rot=(90, 0, 0))
    text((0, -0.2, 0.55), '1', 0.18, mat(INK), root, extrude=0.01)


def ribbon(root):
    blue = mat('#1e5bd8', 0.4)
    for side in (-1, 1):
        box((side * 0.07, 0.01, -0.22), (0.08, 0.01, 0.3), blue, root, rot=(0, side * -15, 0))
    cyl((0, 0, 0), 0.16, 0.03, blue, root, rot=(90, 0, 0))
    cyl((0, -0.02, 0), 0.1, 0.03, mat('#ffd23f', 0.4), root, rot=(90, 0, 0))
    text((0, -0.04, 0), '1st', 0.1, mat(INK), root, extrude=0.004)


def wagon(root):
    red = mat('#d93a2b', 0.4)
    box((0, 0, 0.29), (1.16, 0.6, 0.3), red, root, bevel=0.03)
    for wx in (-0.36, 0.36):
        for wy in (-0.32, 0.32):
            cyl((wx, wy, 0.1), 0.11, 0.06, mat('#333333'), root, rot=(90, 0, 0))
    curve([(-0.58, -0.1, 0.3), (-1.0, -0.2, 0.6)], 0.02, mat(INK), root)


def table(root):
    wood = mat('#8b5a2b')
    for lx in (-0.62, 0.62):
        box((lx, 0, 0.33), (0.08, 0.08, 0.66), wood, root)
    box((0, 0, 0.6), (1.5, 0.7, 0.36), mat('#3a7bd5', 0.7), root, bevel=0.02)
    box((0, -0.355, 0.66), (1.5, 0.01, 0.03), mat('#ffffff'), root, noline=True)


def crowd(x0, x1, y2d):
    cols = ['#e07a5f', '#3d405b', '#81b29a', '#f2cc8f', '#6d597a', '#e56b6f']
    i = 0
    x = x0
    while x < x1:
        p = world(x, y2d + 8, 2.5)
        root = empty()
        root.location = p
        sphere((0, 0, 0.62), 0.14, mat('#e8c4a0'), root)
        box((0, 0, 0.25), (0.32, 0.3, 0.5), mat(cols[i % 6]), root, bevel=0.08)
        x += 34
        i += 1

# ---------------------------------------------------------------- items
def add_item(it, idx, rng):
    k = it[0]
    depth = -idx * 0.12
    if k in C:
        _, x, y, s, pose = it[:5]
        o = dict(it[5]) if len(it) > 5 and it[5] else {}
        if k == 'goblin' and 'glider' not in o:
            o['glider'] = 1
        root = empty()
        root.location = world(x, y, depth)
        root.rotation_euler = (0, math.radians(o.get('rot', 0)), 0)
        root.scale = (-s if o.get('flip') else s, s, s)
        person(root, C[k], pose, o)
        return
    simple = {'bolt': lambda r: bolt(r, it[4] if len(it) > 4 else 'down'), 'tracee': tracee, 'machine': machine,
              'wagon': wagon, 'table': table, 'ribbon': ribbon, 'trophy': trophy, 'spark': spark, 'goo': goo}
    if k in simple:
        root = empty()
        root.location = world(it[1], it[2], depth)
        if k == 'goo' and len(it) > 4:
            root.rotation_euler = (0, math.radians(it[4]), 0)
        if k == 'tracee':
            root.location = world(it[1], it[2], depth)
        root.scale = (it[3],) * 3
        simple[k](root)
    elif k == 'net':
        _, x, y, r, sy = (it + [1])[:5]
        flat = sy < 0.5
        net(world(x, y, depth - 0.5), r / 100.0, flat)
    elif k == 'web':
        _, x1, y1, x2, y2 = it
        curve([world(x1, y1, depth - 0.3), world(x2, y2, depth - 0.3)], 0.016, mat('#ffffff', 0.4))
    elif k == 'confetti':
        _, x0, y0, x1, y1, n = it
        cols = ['#ff3b3b', '#ffd23f', '#3ad0ff', '#7CFC00', '#ff5ca8', '#ffffff', '#1e5bd8']
        for i in range(n):
            d = rng.uniform(-2.0, 1.0)
            p = world(rng.uniform(x0, x1), rng.uniform(y0, y1), d)
            box(p, (0.07, 0.005, 0.045), mat(cols[i % 7], 0.4, 0.6), None,
                rot=(rng.uniform(0, 360), rng.uniform(0, 360), rng.uniform(0, 360)), noline=True)
    elif k == 'speed':
        _, x0, y0, x1, y1, n = it
        for i in range(n):
            yy = rng.uniform(y0, y1)
            xa = x0 + rng.random() * (x1 - x0) * 0.4
            ln = 40 + rng.random() * (x1 - x0) * 0.5
            curve([world(xa, yy, 6.0), world(xa + ln, yy, 6.0)], 0.008, mat('#ffffff', 0.5, 1.5), noline=True)
    elif k == 'banner':
        _, x, y, t, w = it
        p = world(x, y + 26, 1.0)
        box(p, (w / 100.0, 0.05, 0.52), mat('#d7263d', 0.5), None, bevel=0.02)
        text((p[0], p[1] - 0.04, p[2] - 0.11), t, 0.3, mat('#ffffff', 0.3, 0.5))
    elif k == 'crowd':
        crowd(it[1], it[2], it[3])
    # 'notes' are drawn by the HTML overlay

# ---------------------------------------------------------------- backgrounds
def node_mat(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    return m, nt, out


def sky_plane(kind, colors, center=(0.5, 0.5)):
    """A plane glued to the camera, filling the frame: gradient sky or comic burst."""
    cam = S['cam']
    sw = S['W'] / 100.0
    sh = sw * S['H'] / S['W']
    bpy.ops.mesh.primitive_plane_add(size=1)
    p = bpy.context.active_object
    S['noline'].objects.link(p)
    bpy.context.scene.collection.objects.unlink(p)
    p.parent = cam
    p.location = (0, 0, -90)
    p.scale = (sw * 1.02, sh * 1.02, 1)
    m, nt, out = node_mat('sky')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.0
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    if kind == 'gradient':
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = lin(colors[1])
        ramp.color_ramp.elements[1].color = lin(colors[0])
        nt.links.new(sep.outputs['Y'], ramp.inputs[0])
        col = ramp.outputs[0]
        if len(colors) > 2 and colors[2] == 'stars':
            vor = nt.nodes.new('ShaderNodeTexVoronoi')
            vor.inputs['Scale'].default_value = 60.0
            mp = nt.nodes.new('ShaderNodeMapping')
            mp.inputs['Scale'].default_value = (S['W'] / S['H'], 1, 1)
            nt.links.new(tc.outputs['Generated'], mp.inputs[0])
            nt.links.new(mp.outputs[0], vor.inputs['Vector'])
            lt = nt.nodes.new('ShaderNodeMath')
            lt.operation = 'LESS_THAN'
            lt.inputs[1].default_value = 0.035
            nt.links.new(vor.outputs['Distance'], lt.inputs[0])
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            nt.links.new(lt.outputs[0], mix.inputs['Factor'])
            nt.links.new(col, mix.inputs['A'])
            mix.inputs['B'].default_value = (1, 1, 1, 1)
            col = mix.outputs['Result']
        nt.links.new(col, em.inputs['Color'])
    else:  # burst
        aspect = S['W'] / S['H']
        sub_x = nt.nodes.new('ShaderNodeMath'); sub_x.operation = 'SUBTRACT'; sub_x.inputs[1].default_value = center[0]
        mul_x = nt.nodes.new('ShaderNodeMath'); mul_x.operation = 'MULTIPLY'; mul_x.inputs[1].default_value = aspect
        sub_y = nt.nodes.new('ShaderNodeMath'); sub_y.operation = 'SUBTRACT'; sub_y.inputs[1].default_value = center[1]
        nt.links.new(sep.outputs['X'], sub_x.inputs[0]); nt.links.new(sub_x.outputs[0], mul_x.inputs[0])
        nt.links.new(sep.outputs['Y'], sub_y.inputs[0])
        at = nt.nodes.new('ShaderNodeMath'); at.operation = 'ARCTAN2'
        nt.links.new(sub_y.outputs[0], at.inputs[0]); nt.links.new(mul_x.outputs[0], at.inputs[1])
        sc = nt.nodes.new('ShaderNodeMath'); sc.operation = 'MULTIPLY'; sc.inputs[1].default_value = 14 / (2 * math.pi)
        nt.links.new(at.outputs[0], sc.inputs[0])
        fr = nt.nodes.new('ShaderNodeMath'); fr.operation = 'FRACT'
        nt.links.new(sc.outputs[0], fr.inputs[0])
        gt = nt.nodes.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'; gt.inputs[1].default_value = 0.5
        nt.links.new(fr.outputs[0], gt.inputs[0])
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
        nt.links.new(gt.outputs[0], mix.inputs['Factor'])
        mix.inputs['A'].default_value = lin(colors[0]); mix.inputs['B'].default_value = lin(colors[1])
        nt.links.new(mix.outputs['Result'], em.inputs['Color'])
    p.data.materials.append(m)


def building_mat(wall, window, dark_window):
    key = ('bld', wall, window)
    if key in S['mats']:
        return S['mats'][key]
    m, nt, out = node_mat('building')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(sep.outputs['X'], comb.inputs['X'])
    nt.links.new(sep.outputs['Z'], comb.inputs['Y'])
    br = nt.nodes.new('ShaderNodeTexBrick')
    br.offset = 0.0
    br.inputs['Scale'].default_value = 1.0
    br.inputs['Mortar Size'].default_value = 0.055
    br.inputs['Brick Width'].default_value = 0.14
    br.inputs['Row Height'].default_value = 0.17
    br.inputs['Bias'].default_value = 0.15
    br.inputs['Color1'].default_value = lin(window)
    br.inputs['Color2'].default_value = lin(dark_window)
    nt.links.new(comb.outputs[0], br.inputs['Vector'])
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = lin(wall)
    bsdf.inputs['Roughness'].default_value = 0.8
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.3
    nt.links.new(br.outputs['Color'], em.inputs['Color'])
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(br.outputs['Fac'], mix.inputs['Fac'])
    nt.links.new(em.outputs[0], mix.inputs[1])
    nt.links.new(bsdf.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    S['mats'][key] = m
    return m


def skyline(rng, depth, wall, window, dark_window, top_lo, top_hi, windows=True, base_y=None):
    """Row of buildings at `depth`; tops land between panel rows top_hi..top_lo (2D px)."""
    W = S['W']
    m = building_mat(wall, window, dark_window) if windows else mat(wall, 0.85)
    x = -30
    while x < W + 30:
        bw = 40 + rng.random() * 60
        top_y = top_hi + rng.random() * (top_lo - top_hi)
        top = world(x + bw / 2, top_y, depth)
        bottom_z = world(0, base_y, depth)[2] if base_y is not None else -6
        h = top[2] - bottom_z
        if h > 0.05:
            box((top[0], depth + rng.random() * 0.8, bottom_z + h / 2), (bw / 100.0, 0.8, h), m)
        x += bw + 3 + rng.random() * 8


def clouds(rng, n, depth=22):
    white = mat('#ffffff', 0.9, 0.6)
    for _ in range(n):
        x = rng.random() * S['W']
        y = 20 + rng.random() * 60
        c = world(x, y, depth)
        k = 0.5 + rng.random() * 0.5
        for dx, dz, r in ((-0.3, 0, 0.18), (-0.1, 0.1, 0.24), (0.15, 0.08, 0.22), (0.35, -0.01, 0.16), (0.05, -0.04, 0.2)):
            sphere((c[0] + dx * k * 1.4, c[1], c[2] + dz * k), r * k, white, None, scale=(1.3, 0.6, 1))


def floor(colhex, depth_to=10.0, rough=0.9):
    box((0, depth_to / 2 - 6, -0.05), (S['W'] / 100.0 + 8, depth_to + 12, 0.1), mat(colhex, rough))


def lights(kind='day'):
    sc = bpy.context.scene
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = {'day': 3.6, 'night': 2.2, 'dusk': 2.8, 'indoor': 2.6, 'burst': 3.4}[kind]
    sun.color = {'day': (1, 0.97, 0.9), 'night': (0.75, 0.8, 1.0), 'dusk': (1, 0.82, 0.68), 'indoor': (0.85, 0.9, 1.0), 'burst': (1, 1, 1)}[kind][:3]
    sun.angle = math.radians(8)
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(48), 0, math.radians(-28))
    fill = bpy.data.lights.new('fill', 'SUN')
    fill.energy = 0.9
    fill.use_shadow = False
    fo = bpy.data.objects.new('fill', fill)
    sc.collection.objects.link(fo)
    fo.rotation_euler = (math.radians(70), 0, math.radians(35))
    world_bg = {'day': '#cfe3f5', 'night': '#5a5f8f', 'dusk': '#c9a0a8', 'indoor': '#6f7fb0', 'burst': '#f0e6d0'}[kind]
    w = bpy.data.worlds.new('w')
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = lin(world_bg)
    bg.inputs['Strength'].default_value = 0.9


def background(kind, rng):
    W, H = S['W'], S['H']
    if kind == 'park':
        lights('day'); sky_plane('gradient', ['#6cc3f0', '#dff3ff']); clouds(rng, max(2, W // 200))
        skyline(rng, 16, '#a9c4dc', '#c7dbea', '#b5cde0', 210, 120, windows=False)
        floor('#6cc04a', 14)
        for hx in (-3.0, 1.5, 5.0):
            sphere((hx, 11, -1.6), 3.2, mat('#7dcc56', 0.9), scale=(1.6, 1, 0.75))
        box((0, 1.6, 0.01), (W / 100.0 + 8, 0.7, 0.02), mat('#d9c79a', 0.9))
        for k in (0.08, 0.86, 0.55) if W > 400 else (0.06, 0.9):
            p = world(W * k, 250, 4.5)
            cyl((p[0], 4.5, 0.4), 0.09, 0.8, mat('#7a4a24'))
            sphere((p[0], 4.5, 1.1), 0.5, mat('#3f9e3a', 0.8))
    elif kind in ('city', 'dusk', 'cover'):
        if kind == 'city':
            lights('day'); sky_plane('gradient', ['#5fb4ea', '#d2ecff']); clouds(rng, max(2, W // 200))
            skyline(rng, 14, '#a7b8d4', '#e9f2ff', '#c3d0e4', 140, 40)
            skyline(rng, 8, '#5b6b8c', '#ffe08a', '#3e4a66', 210, 90)
            floor('#6b6f7a', 7)
            box((0, -1.0, 0.03), (W / 100.0 + 8, 1.6, 0.06), mat('#9a9eaa', 0.9))
        elif kind == 'dusk':
            lights('dusk'); sky_plane('gradient', ['#6a4c93', '#ff9a5a'])
            c = world(W * 0.8, 225, 30)
            sphere(c, 0.65, mat('#ffd166', 0.5, 3.0), noline=True)
            skyline(rng, 16, '#3d3366', '#ffd166', '#2a2346', 160, 60)
            skyline(rng, 9, '#2a2346', '#ffb347', '#1c1733', 240, 120)
            floor('#2a2346', 7)
        else:
            lights('burst'); sky_plane('burst', ['#2b6fe0', '#1e4fb0'], center=(0.5, 0.58))
            skyline(rng, 9, '#16306e', '#ffe08a', '#0f2152', 700, 520)
            floor('#0f1c45', 7)
    elif kind == 'fair':
        lights('day'); sky_plane('gradient', ['#77c6f2', '#e6f6ff']); clouds(rng, max(2, W // 300))
        skyline(rng, 18, '#b9cce0', '#d5e2ee', '#c4d6e6', 200, 140, windows=False)
        floor('#86c95e', 12)
        tent_cols = ['#d7263d', '#1e5bd8', '#ffb703']
        spots = (0.15, 0.5, 0.85) if W > 400 else (0.12, 0.88)
        for i, k in enumerate(spots):
            p = world(W * k, 245, 5.0)
            tent(p[0], 5.0, tent_cols[i % 3])
        # bunting
        y0 = 4.0
        pts = []
        for i in range(0, 41):
            t = i / 40
            x2 = t * W
            sag = math.sin((t * 2 % 1) * math.pi) * 22
            pts.append(world(x2, 26 + sag, y0))
        curve(pts, 0.008, mat(INK))
        cols = ['#d7263d', '#ffd23f', '#1e5bd8', '#2fb36b']
        for i, p in enumerate(pts[1:-1:2]):
            cone((p[0], p[1], p[2] - 0.12), 0.09, 0.22, mat(cols[i % 4], 0.6), rot=(180, 0, 0), verts=3)
    elif kind == 'hq':
        lights('indoor')
        box((0, 4.2, 1.5), (W / 100.0 + 8, 0.2, 8), mat('#1d2a52', 0.8))
        for i in range(-12, 13):
            box((i * 0.42, 4.08, 1.5), (0.03, 0.02, 8), mat('#25356a', 0.8), noline=True)
        sw = min(2.6, W / 100.0 * 0.5)
        c = world(W * 0.08 + sw * 50, 82, 4.0)
        box(c, (sw, 0.1, 1.25), mat('#0e1630', 0.3), bevel=0.03)
        for i in range(6):
            box((c[0], c[1] - 0.06, c[2] + 0.45 - i * 0.18), (sw - 0.15, 0.01, 0.015), mat('#2ec4b6', 0.3, 2.0), noline=True)
        sphere((c[0] + sw * 0.25, c[1] - 0.08, c[2] + 0.3), 0.07, mat('#ff3b3b', 0.3, 4.0), noline=True)
        n = world(W - 90, 70, 4.0)
        net((n[0], 4.0, n[2]), 0.6, False)
        floor('#2b3a6e', 4.2, 0.4)
    elif kind == 'screen':
        lights('indoor')
        box((0, 2.2, 1.5), (W / 100.0 + 8, 0.1, 8), mat('#0e1630', 0.4))
        for i in range(-14, 15):
            box((i * 0.34, 2.12, 1.5), (0.025, 0.01, 8), mat('#1f6f78', 0.4, 1.5), noline=True, rot=(0, 8, 0))
        for j in range(-6, 12):
            box((0, 2.12, j * 0.3), (W / 100.0 + 8, 0.01, 0.025), mat('#1f6f78', 0.4, 1.5), noline=True, rot=(0, -1.5, 0))
        p = world(W * 0.55 + 20, 55, 2.0)
        sphere((p[0], 2.05, p[2]), 0.07, mat('#ff3b3b', 0.3, 5.0), noline=True)
        torus((p[0], 2.05, p[2]), 0.18, 0.012, mat('#ff3b3b', 0.3, 5.0))
        text((p[0] + 0.75, 2.04, p[2]), 'BOLT  TOWER ONE', 0.12, mat('#ff8a8a', 0.3, 3.0))
        floor('#2b3a6e', 2.2, 0.4)
    elif kind == 'roof':
        lights('night'); sky_plane('gradient', ['#141a42', '#3b2f6b', 'stars'])
        c = world(W * 0.12 if W > 400 else W * 0.13, 50, 35)
        sphere(c, 0.3 * (1 + 35 * 0.0), mat('#fff6c9', 0.5, 2.5))
        skyline(rng, 14, '#2a2350', '#ffd166', '#1d1838', 250, 175)
        floor('#6d6a7c', 3.2, 0.8)
        box((0, 3.1, 0.08), (W / 100.0 + 8, 0.25, 0.16), mat('#8b88a0', 0.8))
        for xx in range(-6, 7):
            box((xx * 0.7, -0.6, 0.002), (0.3, 0.02, 0.004), mat('#5a5768', 0.8), noline=True)
    elif kind in ('burstR', 'burstB', 'burstP'):
        lights('burst')
        cols = {'burstR': ['#ffd23f', '#ff8c42'], 'burstB': ['#3ad0ff', '#1e5bd8'], 'burstP': ['#ff5ca8', '#ffd23f']}[kind]
        sky_plane('burst', cols, center=(0.5, 0.45 if kind == 'burstP' else 0.5))
    else:
        lights('day'); sky_plane('gradient', ['#ffffff', '#eeeeee'])


def tent(x, y, col):
    stripes = mat(col, 0.7)
    white = mat('#ffffff', 0.7)
    cyl((x, y, 0.25), 0.7, 0.5, white, verts=24)
    cone((x, y, 0.85), 0.78, 0.7, stripes, verts=12)
    for i in range(6):
        a = math.radians(i * 60 + 15)
        curve([(x, y, 1.2), (x + math.cos(a) * 0.78, y - abs(math.sin(a)) * 0.78 * 0 - math.sin(a) * 0.78, 0.5)], 0.025, white, noline=True)
    cone((x, y, 1.27), 0.03, 0.15, mat('#ffd23f'))

# ---------------------------------------------------------------- scene + render
def setup(panel):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    W, H = panel['w'], panel['h']
    S.clear()
    S.update(W=W, H=H, mats={})
    v_ground = (15 - H / 2) / 100.0
    S['Zc'] = -(v_ground - CAM_DIST * math.sin(TILT)) / math.cos(TILT)
    noline = bpy.data.collections.new('noline')
    sc.collection.children.link(noline)
    S['noline'] = noline
    cam_d = bpy.data.cameras.new('cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = W / 100.0
    cam_d.sensor_fit = 'HORIZONTAL'
    cam_d.clip_end = 200
    cam = bpy.data.objects.new('cam', cam_d)
    sc.collection.objects.link(cam)
    cam.location = (0, -CAM_DIST, S['Zc'])
    cam.rotation_euler = (math.radians(90) - TILT, 0, 0)
    sc.camera = cam
    S['cam'] = cam
    scale = 1.4 if QUICK else 2.4
    sc.render.resolution_x = int(W * scale)
    sc.render.resolution_y = int(H * scale)
    sc.render.resolution_percentage = 100
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 8 if QUICK else 24
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    try:
        sc.view_settings.view_transform = 'Standard'
    except Exception:
        pass
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 88
    # Freestyle ink
    sc.render.use_freestyle = True
    sc.render.line_thickness_mode = 'ABSOLUTE'
    sc.render.line_thickness = 1.0
    vl = sc.view_layers[0]
    vl.use_freestyle = True
    fs = vl.freestyle_settings
    fs.crease_angle = math.radians(120)
    ls = fs.linesets[0] if len(fs.linesets) else fs.linesets.new('ink')
    ls.select_by_visibility = True
    ls.select_by_edge_types = True
    ls.select_silhouette = True
    ls.select_border = True
    ls.select_crease = True
    ls.select_by_collection = True
    ls.collection = noline
    ls.collection_negation = 'EXCLUSIVE'
    if ls.linestyle is None:
        ls.linestyle = bpy.data.linestyles.new('ink')
    ls.linestyle.color = lin(INK)[:3]
    ls.linestyle.thickness = 3.4 * scale / 2.4


def render(panel):
    setup(panel)
    rng = random.Random(zlib.crc32(panel['id'].encode()))
    background(panel['bg'], rng)
    for i, it in enumerate(panel['items']):
        add_item(it, i, rng)
    sc = bpy.context.scene
    sc.render.filepath = os.path.abspath(os.path.join(OUT, panel['id'] + '.jpg'))
    bpy.ops.render.render(write_still=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    panels = json.load(open(STORY))
    for p in panels:
        if ONLY and p['id'] not in ONLY:
            continue
        t = time.time()
        render(p)
        print(f"rendered {p['id']} in {time.time() - t:.1f}s", flush=True)


main()
