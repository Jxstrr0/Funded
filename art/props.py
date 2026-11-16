"""Procedural props for the edge cards (one per edge id in EDGES, js/config.js).

Each builder makes one prop standing on z = 0 at `loc`, parents every part to a root empty and
returns that root. Sizes are in metres, roughly real size. Used by art/build_props.py, both for
the desk overlays (built into the scene from build_scene.py) and for the card stills.
"""
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, noise

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def lin(h):
    h = h.lstrip("#")
    o = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        o.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*o, 1.0)


_M = {}


def pmat(name, col, rough=0.5, metal=0.0, coat=0.0, trans=0.0, ior=1.45, emit=None, es=0.0, sss=0.0):
    key = "p_" + name
    if key in _M:
        return _M[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(col)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.08
    b.inputs["Transmission Weight"].default_value = trans
    b.inputs["IOR"].default_value = ior
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
        b.inputs["Subsurface Radius"].default_value = (0.004, 0.002, 0.001)
        b.inputs["Subsurface Scale"].default_value = 1.0
    if emit:
        b.inputs["Emission Color"].default_value = lin(emit)
        b.inputs["Emission Strength"].default_value = es
    _M[key] = m
    return m


def _bsdf(m):
    return m.node_tree.nodes["Principled BSDF"]


def link(ob, col):
    (col or bpy.context.scene.collection).objects.link(ob)


def mesh_ob(name, me, mat, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, col=None, smooth=True, scale=None):
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    if mat is not None:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.rotation_euler = rot
    if scale is not None:
        ob.scale = scale
    if parent:
        ob.parent = parent
    link(ob, col)
    return ob


def empty(name, loc, rot=(0, 0, 0), col=None, scale=1.0):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    e.rotation_euler = rot
    e.scale = (scale, scale, scale)
    link(e, col)
    return e


def lathe(name, prof, n=48, cap_top=True, cap_bot=True, wobble=None):
    """Surface of revolution about +Z. prof: (r, z) pairs from bottom to top.
    wobble(i, a) -> radius factor, for lobed or hand-made shapes."""
    bm = bmesh.new()
    rings = []
    for r, z in prof:
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n
            f = wobble(a, z) if wobble else 1.0
            ring.append(bm.verts.new((r * f * math.cos(a), r * f * math.sin(a), z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_bot and prof[0][0] > 1e-6:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and prof[-1][0] > 1e-6:
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def rbox(name, sx, sy, sz, bevel=0.0, seg=3):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=seg, affect="EDGES", profile=0.5)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def torus(name, R, r, seg=32, ring=12):
    bm = bmesh.new()
    vs = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for j in range(ring):
            b = 2 * math.pi * j / ring
            vs.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
    for i in range(seg):
        for j in range(ring):
            i2 = (i + 1) % seg
            j2 = (j + 1) % ring
            bm.faces.new((vs[i * ring + j], vs[i2 * ring + j], vs[i2 * ring + j2], vs[i * ring + j2]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def tube(name, pts, radii, n=16, cap0=True, cap1=True, up=Vector((0, 0, 1))):
    """Tube along a polyline with a radius per point (parallel-transport frames)."""
    pts = [Vector(p) for p in pts]
    bm = bmesh.new()
    rings = []
    prev_n = None
    for k, p in enumerate(pts):
        t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        if prev_n is None:
            nrm = up.cross(t)
            if nrm.length < 1e-4:
                nrm = Vector((1, 0, 0)).cross(t)
            nrm.normalize()
        else:
            nrm = (prev_n - t * prev_n.dot(t)).normalized()
        prev_n = nrm
        bi = t.cross(nrm)
        r = radii[k]
        rings.append([bm.verts.new(p + (nrm * math.cos(2 * math.pi * i / n) + bi * math.sin(2 * math.pi * i / n)) * r)
                      for i in range(n)])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap0:
        c = bm.verts.new(pts[0] - (pts[1] - pts[0]).normalized() * radii[0] * 0.3)
        for i in range(n):
            bm.faces.new((rings[0][(i + 1) % n], rings[0][i], c))
    if cap1:
        c = bm.verts.new(pts[-1] + (pts[-1] - pts[-2]).normalized() * radii[-1] * 0.3)
        for i in range(n):
            bm.faces.new((rings[-1][i], rings[-1][(i + 1) % n], c))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def _font(path):
    try:
        return bpy.data.fonts.load(path, check_existing=True)
    except Exception:
        return None


def text_ob(name, body, size, mat, loc, rot=(math.radians(90), 0, 0), extrude=0.0, parent=None, col=None,
            bold=True, shear=0.0, spacing=1.05):
    """Flat text; with the default rotation it reads on the -Y side (toward the camera)."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.extrude = extrude
    cu.shear = shear
    cu.space_character = spacing
    f = _font(FONT_BOLD if bold else FONT_REG)
    if f:
        cu.font = f
    ob = bpy.data.objects.new(name, cu)
    ob.data.materials.append(mat)
    ob.location = loc
    ob.rotation_euler = rot
    if parent:
        ob.parent = parent
    link(ob, col)
    return ob


def no_shadow(ob):
    ob.visible_shadow = False


# =====================================================================================
# coffee: a mug with a wisp of steam
# =====================================================================================
def steam_mat():
    key = "p_steam"
    if key in _M:
        return _M[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    tl = nt.nodes.new("ShaderNodeBsdfTranslucent")
    tl.inputs[0].default_value = (1, 1, 1, 1)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (0.9, 0.92, 1.0, 1)
    em.inputs[1].default_value = 0.25
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(tl.outputs[0], add.inputs[0])
    nt.links.new(em.outputs[0], add.inputs[1])
    mix = nt.nodes.new("ShaderNodeMixShader")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["UV"], sep.inputs[0])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 40.0
    nt.links.new(tc.outputs["Object"], nz.inputs[0])
    # fade in at the cup, out at the top: sin(pi * u) ^ 1.5
    s1 = nt.nodes.new("ShaderNodeMath"); s1.operation = "MULTIPLY"; s1.inputs[1].default_value = math.pi
    f1 = nt.nodes.new("ShaderNodeMath"); f1.operation = "SINE"
    p1 = nt.nodes.new("ShaderNodeMath"); p1.operation = "POWER"; p1.inputs[1].default_value = 1.5
    nt.links.new(sep.outputs[0], s1.inputs[0]); nt.links.new(s1.outputs[0], f1.inputs[0]); nt.links.new(f1.outputs[0], p1.inputs[0])
    f2 = nt.nodes.new("ShaderNodeMath"); f2.operation = "MULTIPLY"
    nt.links.new(p1.outputs[0], f2.inputs[0]); nt.links.new(nz.outputs[0], f2.inputs[1])
    f3 = nt.nodes.new("ShaderNodeMath"); f3.operation = "MULTIPLY"; f3.inputs[1].default_value = 0.5
    f3.use_clamp = True
    nt.links.new(f2.outputs[0], f3.inputs[0])
    nt.links.new(f3.outputs[0], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(add.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    _M[key] = m
    return m


def steam(parent, h=0.1, col=None, seed=3, n=3, sway=0.010):
    rng = random.Random(seed)
    for k in range(n):
        cu = bpy.data.curves.new("steam", "CURVE")
        cu.dimensions = "3D"
        sp = cu.splines.new("BEZIER")
        N = 7
        sp.bezier_points.add(N - 1)
        ph = rng.uniform(0, 6.28)
        ox = rng.uniform(-0.009, 0.009)
        hh = h * rng.uniform(0.75, 1.0)
        for i, bp in enumerate(sp.bezier_points):
            t = i / (N - 1)
            x = ox * (1 - t * 0.5) + math.sin(ph + t * 5.5) * sway * (0.25 + t)
            y = math.cos(ph * 1.3 + t * 4.0) * 0.005 * t
            bp.co = (x, y, t * hh)
            bp.handle_left_type = bp.handle_right_type = "AUTO"
        cu.bevel_depth = 0.0035 + 0.0012 * k
        cu.bevel_resolution = 4
        tp = bpy.data.curves.new("steam_taper", "CURVE")
        tsp = tp.splines.new("BEZIER")
        tsp.bezier_points.add(2)
        for bp, co in zip(tsp.bezier_points, [(0, 0.3, 0), (0.5, 1.2, 0), (1, 0.5, 0)]):
            bp.co = co
            bp.handle_left_type = bp.handle_right_type = "AUTO"
        tob = bpy.data.objects.new("steam_taper", tp)
        link(tob, col)
        tob.hide_render = True
        tob.hide_viewport = True
        cu.taper_object = tob
        ob = bpy.data.objects.new("steam", cu)
        ob.data.materials.append(steam_mat())
        ob.parent = parent
        link(ob, col)
        no_shadow(ob)


def build_coffee(col=None, loc=(0, 0, 0), rot_z=0.0, scale=1.0, steam_h=0.1, steam_sway=0.010):
    p = empty("prop_coffee", loc, (0, 0, rot_z), col, scale)
    r, h = 0.036, 0.092
    prof = [(0.0, 0.0), (r - 0.005, 0.0), (r - 0.001, 0.0015), (r, 0.005), (r + 0.001, h * 0.5), (r + 0.0018, h - 0.002),
            (r + 0.0005, h), (r - 0.0035, h), (r - 0.0045, h - 0.003), (r - 0.005, h * 0.5), (r - 0.006, 0.012), (0.0, 0.011)]
    cer = pmat("mug_body", "#f1ece2", 0.16, coat=0.5)
    mesh_ob("mug", lathe("mug", prof, n=64, cap_top=False, cap_bot=False), cer, parent=p, col=col)
    mesh_ob("mug_band", lathe("band", [(r + 0.0009, h * 0.60), (r + 0.0016, h * 0.605), (r + 0.0017, h * 0.745),
                                       (r + 0.0010, h * 0.75)], n=64, cap_top=False, cap_bot=False),
            pmat("mug_band", "#2FBF71", 0.22, coat=0.5), parent=p, col=col)
    mesh_ob("coffee", lathe("coffee", [(0, h - 0.013), (r - 0.0052, h - 0.013)], n=64, cap_top=False, cap_bot=False),
            pmat("coffee", "#2a160c", 0.06, coat=0.8), parent=p, col=col)
    # handle: a D-shaped loop on the -X side
    pts, rad = [], []
    for i in range(25):
        t = i / 24
        a = math.radians(-100 + 200 * t)
        pts.append((-r + 0.002 - 0.022 * math.cos(a) * 0.9, 0, h * 0.5 + 0.026 * math.sin(a)))
        rad.append(0.0055)
    mesh_ob("mug_handle", tube("handle", pts, rad, n=14, cap0=False, cap1=False), cer, parent=p, col=col)
    if steam_h > 0:
        s = empty("steam_root", (0.004, 0, h - 0.01), col=col)
        s.parent = p
        steam(s, steam_h, col, sway=steam_sway)
    return p


# =====================================================================================
# stopDiscipline: a red STOP octagon sticky note
# =====================================================================================
def build_stopDiscipline(col=None, loc=(0, 0, 0), rot=(0, 0, 0), size=0.06):
    """Faces -Y; `loc` is the note's centre (it is meant to be stuck to something)."""
    p = empty("prop_stopDiscipline", loc, rot, col)
    R = size / 2 / math.cos(math.pi / 8)
    bm = bmesh.new()
    vs = [bm.verts.new((R * math.cos(math.pi / 8 + i * math.pi / 4), 0, R * math.sin(math.pi / 8 + i * math.pi / 4)))
          for i in range(8)]
    bm.faces.new(vs)
    res = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces))
    for v in [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]:
        v.co.y += 0.0004
    me = bpy.data.meshes.new("stop")
    bm.to_mesh(me)
    bm.free()
    white = pmat("stop_white", "#fbf6ee", 0.7)
    mesh_ob("stop_note", me, pmat("stop_red", "#E5484D", 0.72), parent=p, col=col, smooth=False)
    t = text_ob("stop_txt", "STOP", size * 0.33, white, (0, -0.0012, -size * 0.005), parent=p, col=col)
    t.data.space_character = 0.95
    ring = bpy.data.meshes.new("stop_border")
    bm = bmesh.new()
    o, i_ = [], []
    for k in range(8):
        a = math.pi / 8 + k * math.pi / 4
        o.append(bm.verts.new(((R * 0.9) * math.cos(a), -0.0007, (R * 0.9) * math.sin(a))))
        i_.append(bm.verts.new(((R * 0.835) * math.cos(a), -0.0007, (R * 0.835) * math.sin(a))))
    for k in range(8):
        k2 = (k + 1) % 8
        bm.faces.new((o[k], o[k2], i_[k2], i_[k]))
    bm.to_mesh(ring)
    bm.free()
    mesh_ob("stop_border", ring, white, parent=p, col=col, smooth=False)
    return p


# =====================================================================================
# thetaShield: an hourglass
# =====================================================================================
def build_thetaShield(col=None, loc=(0, 0, 0), rot_z=0.0, scale=1.0, flow=0.4):
    p = empty("prop_thetaShield", loc, (0, 0, rot_z), col, scale)
    H, cap = 0.11, 0.009
    wood = pmat("hg_wood", "#6b3f22", 0.32, coat=0.6)
    brass = pmat("brass", "#d1a64a", 0.2, metal=1.0)
    for z in (cap / 2, H - cap / 2):
        mesh_ob("hg_cap", lathe("cap", [(0, z - cap / 2), (0.031, z - cap / 2), (0.034, z - cap / 2 + 0.002),
                                        (0.0345, z), (0.034, z + cap / 2 - 0.002), (0.031, z + cap / 2), (0, z + cap / 2)], n=56),
                wood, parent=p, col=col)
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.5
        mesh_ob("hg_post", lathe("post", [(0.0028, cap), (0.0036, cap + 0.004), (0.0028, cap + 0.008), (0.0032, H * 0.3),
                                          (0.0024, H * 0.5), (0.0032, H * 0.7), (0.0028, H - cap - 0.008),
                                          (0.0036, H - cap - 0.004), (0.0028, H - cap)], n=16),
                brass, loc=(0.0265 * math.cos(a), 0.0265 * math.sin(a), 0), parent=p, col=col)
    g0, g1 = cap, H - cap
    mid = (g0 + g1) / 2
    prof = []
    N = 28
    for i in range(N + 1):
        t = i / N
        z = g0 + (g1 - g0) * t
        u = abs(t - 0.5) * 2
        r = 0.0024 + 0.0185 * math.sin(min(u, 0.999) * math.pi * 0.62) ** 1.2
        if u > 0.92:
            r *= 0.72 + 0.28 * (1 - (u - 0.92) / 0.08)
        prof.append((r, z))
    glass = pmat("hg_glass", "#ffffff", 0.02, trans=1.0, ior=1.45)
    g = mesh_ob("hg_glass", lathe("glass", prof, n=48, cap_top=False, cap_bot=False), glass, parent=p, col=col)
    no_shadow(g)      # let light reach the sand (refractive caustics are off in the desk render)
    sand = pmat("sand", "#e7bd74", 0.85)
    top_lvl = mid + (g1 - mid) * (0.72 - flow * 0.55)
    inner = [(r * 0.9, z) for (r, z) in prof if mid + 0.003 < z < top_lvl]
    if len(inner) > 1:
        mesh_ob("sand_top", lathe("sand_top", [(0.0008, mid + 0.003)] + inner + [(inner[-1][0] * 0.8, top_lvl), (0, top_lvl - 0.002)]),
                sand, parent=p, col=col)
    pile_h = 0.007 + flow * 0.022
    pile = [(r * 0.92, z) for (r, z) in prof if z < g0 + pile_h * 0.5]
    pile = pile + [(pile[-1][0] * 0.6, g0 + pile_h * 0.8), (0.004, g0 + pile_h), (0, g0 + pile_h + 0.001)]
    mesh_ob("sand_bot", lathe("sand_bot", [(0, g0 + 0.0005)] + pile[1:]), sand, parent=p, col=col)
    mesh_ob("sand_stream", lathe("stream", [(0.0006, g0 + pile_h), (0.0006, mid + 0.004)], n=8), sand, parent=p, col=col)
    return p


# =====================================================================================
# rainmaker: a brass desk bell
# =====================================================================================
def build_rainmaker(col=None, loc=(0, 0, 0), rot_z=0.0, scale=1.0):
    p = empty("prop_rainmaker", loc, (0, 0, rot_z), col, scale)
    base = pmat("bell_base", "#1d2230", 0.3, coat=0.7)
    brass = pmat("brass", "#d1a64a", 0.2, metal=1.0)
    mesh_ob("bell_base", lathe("bbase", [(0, 0), (0.041, 0), (0.0435, 0.0015), (0.0445, 0.006), (0.043, 0.010),
                                         (0.040, 0.012), (0, 0.012)], n=64), base, parent=p, col=col)
    dome = []
    for i in range(21):
        a = i / 20 * math.pi / 2
        dome.append((0.0365 * math.cos(a) ** 0.9 + 0.0005, 0.012 + 0.031 * math.sin(a)))
    mesh_ob("bell_dome", lathe("dome", [(0.0372, 0.0118), (0.0378, 0.0128)] + dome[1:-1] + [(0, 0.0435)], n=64, cap_bot=False),
            brass, parent=p, col=col)
    mesh_ob("bell_lip", lathe("lip", [(0.0362, 0.0118), (0.0382, 0.0122), (0.0384, 0.0145), (0.0368, 0.0150)], n=64,
                              cap_top=False, cap_bot=False), brass, parent=p, col=col)
    mesh_ob("bell_stem", lathe("stem", [(0.0032, 0.042), (0.0028, 0.050), (0.0032, 0.054)], n=16), brass, parent=p, col=col)
    mesh_ob("bell_button", lathe("btn", [(0, 0.0525), (0.0075, 0.0525), (0.0092, 0.0545), (0.0088, 0.0575),
                                         (0.006, 0.0595), (0, 0.060)], n=32), brass, parent=p, col=col)
    return p


# =====================================================================================
# rewind: a cassette tape
# =====================================================================================
def build_rewind(col=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    """Stands on its long bottom edge at `loc`, label toward -Y; tilt it with rot[0]."""
    p = empty("prop_rewind", loc, rot, col, scale)
    W, Hh, T = 0.100, 0.064, 0.012
    zc = Hh / 2
    shell = pmat("cas_shell", "#262b37", 0.38, coat=0.4)
    mesh_ob("cas_shell", rbox("cas", W, T, Hh, 0.0022), shell, loc=(0, 0, zc), parent=p, col=col)
    front = -T / 2
    lab = pmat("cas_label", "#efe6d2", 0.65)
    mesh_ob("cas_label", rbox("lab", W * 0.84, 0.0006, Hh * 0.64, 0.0), lab, loc=(0, front - 0.0002, zc + Hh * 0.07),
            parent=p, col=col, smooth=False)
    lil = pmat("lilac", "#B48CE8", 0.55)
    mesh_ob("cas_stripe", rbox("str", W * 0.84, 0.0006, Hh * 0.10, 0.0), lil, loc=(0, front - 0.0005, zc + Hh * 0.31),
            parent=p, col=col, smooth=False)
    mesh_ob("cas_stripe2", rbox("str2", W * 0.84, 0.0006, Hh * 0.025, 0.0), lil, loc=(0, front - 0.0005, zc - Hh * 0.20),
            parent=p, col=col, smooth=False)
    # the window, with the tape packs and white hubs showing through
    mesh_ob("cas_window", rbox("win", W * 0.52, 0.0006, Hh * 0.24, 0.0012), pmat("cas_win", "#0b0d12", 0.08, coat=1.0),
            loc=(0, front - 0.0008, zc + Hh * 0.02), parent=p, col=col)
    tape = pmat("cas_tape", "#4a2c1c", 0.35, coat=0.3)
    hub = pmat("cas_hub", "#f4f1ea", 0.45)
    for sx, rr in ((-1, 0.0125), (1, 0.0085)):
        x = sx * W * 0.17
        mesh_ob("cas_pack", lathe("pack", [(0, 0), (rr, 0), (rr, 0.0006), (0, 0.0006)], n=40), tape,
                loc=(x, front - 0.0012, zc + Hh * 0.02), rot=(math.radians(90), 0, 0), parent=p, col=col)
        teeth = lambda a, z: 1.0 if math.cos(6 * a) < 0.5 else 1.25
        mesh_ob("cas_hub", lathe("hub", [(0.0035, 0), (0.0062, 0), (0.0062, 0.0008), (0.0035, 0.0008)], n=48,
                                 wobble=teeth), hub, loc=(x, front - 0.0016, zc + Hh * 0.02),
                rot=(math.radians(90), 0, 0), parent=p, col=col)
    ink = pmat("ink", "#1b2340", 0.6)
    text_ob("cas_txt", "REWIND", Hh * 0.12, ink, (W * 0.08, front - 0.0012, zc + Hh * 0.205), parent=p, col=col)
    text_ob("cas_arrows", "◀◀", Hh * 0.13, pmat("red_ink", "#E5484D", 0.5), (-W * 0.29, front - 0.0012, zc + Hh * 0.205),
            parent=p, col=col)
    mesh_ob("cas_bottom", rbox("bt", W * 0.6, 0.002, Hh * 0.2, 0.0015), shell, loc=(0, front - 0.0008, zc - Hh * 0.39),
            parent=p, col=col)
    screw = pmat("screw", "#9aa3b3", 0.3, metal=1.0)
    for sx, sz in ((-0.45, 0.42), (0.45, 0.42), (-0.45, -0.42), (0.45, -0.42), (0, -0.40)):
        mesh_ob("cas_screw", lathe("screw", [(0, 0), (0.0017, 0), (0.0017, 0.0004), (0, 0.0006)], n=12), screw,
                loc=(sx * W, front - 0.0010 - (0.001 if sx == 0 else 0), zc + sz * Hh), rot=(math.radians(90), 0, 0), parent=p, col=col)
    return p


# =====================================================================================
# hotHand: a small red chili pepper
# =====================================================================================
def build_hotHand(col=None, loc=(0, 0, 0), rot_z=0.0, scale=1.0):
    p = empty("prop_hotHand", loc, (0, 0, rot_z), col, scale)
    L, R = 0.075, 0.0095
    pts, rad = [], []
    N = 30
    for i in range(N + 1):
        t = i / N
        r = R * (0.12 + 0.88 * math.sin(min(1.0, t * 1.12) * math.pi / 2) ** 0.8)
        if t > 0.93:
            r *= 1 - (t - 0.93) / 0.07 * 0.25
        x = -L / 2 + L * t
        y = 0.016 * math.sin(t * math.pi * 0.9) - 0.004 * t
        z = r + 0.0035 * (1 - t) ** 3     # rests on its belly, the tip lifts a little
        pts.append((x, y, z))
        rad.append(r)
    red = pmat("chili", "#c8141c", 0.22, coat=0.8, sss=0.15)
    mesh_ob("chili", tube("chili", pts, rad, n=24, cap0=True, cap1=True), red, parent=p, col=col)
    # calyx: a lobed green cap over the shoulder, then a curved stem
    green = pmat("chili_green", "#3f7a2a", 0.4, coat=0.3)
    end = Vector(pts[-1])
    lob = lambda a, z: 1.0 + 0.18 * max(0.0, math.cos(5 * a))
    cal = lathe("calyx", [(R * 0.98, -0.0035), (R * 1.04, -0.0015), (R * 0.85, 0.0012), (0.0032, 0.0028), (0, 0.003)],
                n=40, cap_bot=False, wobble=lob)
    mesh_ob("chili_calyx", cal, green, loc=end + Vector((-0.0015, 0, 0)), rot=(0, math.radians(90), 0), parent=p, col=col)
    sp = [end + Vector((0.002, 0, 0)), end + Vector((0.008, 0.001, 0.002)), end + Vector((0.014, 0.002, 0.006)),
          end + Vector((0.018, 0.003, 0.012))]
    mesh_ob("chili_stem", tube("stem", sp, [0.0024, 0.0021, 0.0019, 0.0019], n=10, cap0=False), green, parent=p, col=col)
    return p


# =====================================================================================
# tapeReader: a coil of paper ticker tape with printed marks
# =====================================================================================
def tape_mat():
    key = "p_tape"
    if key in _M:
        return _M[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.6
    paper, ink, green, red = lin("#f3ecd9"), lin("#1b2340"), lin("#2FBF71"), lin("#E5484D")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["UV"], sep.inputs[0])

    def math_(op, a, bval=None, clamp=False):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        for k, v in enumerate((a, bval)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[k].default_value = v
            else:
                nt.links.new(v, n.inputs[k])
        return n.outputs[0]
    u, v = sep.outputs[0], sep.outputs[1]           # u: metres along the tape, v: 0..1 across
    # characters: 2.6 mm pitch, 62% ink, in "words" broken up by a 1D noise
    ch = math_("LESS_THAN", math_("FRACT", math_("DIVIDE", u, 0.0026)), 0.62)
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.noise_dimensions = "1D"
    nz.inputs["Scale"].default_value = 160.0
    nt.links.new(u, nz.inputs["W"])
    word = math_("GREATER_THAN", nz.outputs[0], 0.47)
    row1 = math_("MULTIPLY", math_("GREATER_THAN", v, 0.56), math_("LESS_THAN", v, 0.80))
    row2 = math_("MULTIPLY", math_("GREATER_THAN", v, 0.22), math_("LESS_THAN", v, 0.44))
    rows = math_("MAXIMUM", row1, row2)
    inkmask = math_("MULTIPLY", math_("MULTIPLY", ch, word), rows)
    # some words print green or red (prices up / down)
    nz2 = nt.nodes.new("ShaderNodeTexNoise")
    nz2.noise_dimensions = "1D"
    nz2.inputs["Scale"].default_value = 60.0
    nt.links.new(u, nz2.inputs["W"])
    mixc = nt.nodes.new("ShaderNodeMix"); mixc.data_type = "RGBA"
    mixc.inputs["A"].default_value = ink
    mixc.inputs["B"].default_value = green
    nt.links.new(math_("GREATER_THAN", nz2.outputs[0], 0.58), mixc.inputs["Factor"])
    mixr = nt.nodes.new("ShaderNodeMix"); mixr.data_type = "RGBA"
    nt.links.new(mixc.outputs["Result"], mixr.inputs["A"])
    mixr.inputs["B"].default_value = red
    nt.links.new(math_("LESS_THAN", nz2.outputs[0], 0.40), mixr.inputs["Factor"])
    mixp = nt.nodes.new("ShaderNodeMix"); mixp.data_type = "RGBA"
    mixp.inputs["A"].default_value = paper
    nt.links.new(mixr.outputs["Result"], mixp.inputs["B"])
    nt.links.new(inkmask, mixp.inputs["Factor"])
    nt.links.new(mixp.outputs["Result"], b.inputs["Base Color"])
    _M[key] = m
    return m


def coil_side_mat():
    key = "p_coil_side"
    if key in _M:
        return _M[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.75
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    vm = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(sep.outputs[0], vm.inputs[0]); nt.links.new(sep.outputs[1], vm.inputs[1])
    ln = nt.nodes.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"
    nt.links.new(vm.outputs[0], ln.inputs[0])
    mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = 2 * math.pi / 0.0011
    nt.links.new(ln.outputs["Value"], mul.inputs[0])
    sn = nt.nodes.new("ShaderNodeMath"); sn.operation = "SINE"
    nt.links.new(mul.outputs[0], sn.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = lin("#cfc6b0")
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = lin("#f6f0e0")
    rm = nt.nodes.new("ShaderNodeMapRange")
    rm.inputs["From Min"].default_value = -1.0
    nt.links.new(sn.outputs[0], rm.inputs["Value"])
    nt.links.new(rm.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], b.inputs["Base Color"])
    _M[key] = m
    return m


def ribbon(name, path, width, length_uv=True):
    """Strip along a 2D path in the local XZ plane, `width` along Y. UV u = metres along, v = 0..1."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rows = []
    acc = [0.0]
    for a, b in zip(path, path[1:]):
        acc.append(acc[-1] + math.dist(a, b))
    for (x, z) in path:
        rows.append((bm.verts.new((x, -width / 2, z)), bm.verts.new((x, width / 2, z))))
    for k in range(len(path) - 1):
        f = bm.faces.new((rows[k][0], rows[k + 1][0], rows[k + 1][1], rows[k][1]))
        for loop, (uu, vv) in zip(f.loops, ((acc[k], 0), (acc[k + 1], 0), (acc[k + 1], 1), (acc[k], 1))):
            loop[uvl].uv = (uu, vv)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def build_tapeReader(col=None, loc=(0, 0, 0), rot_z=0.0, scale=1.0, tail=0.075):
    """A roll of ticker tape standing on its edge (axis along local Y), its end unrolling along +X."""
    p = empty("prop_tapeReader", loc, (0, 0, rot_z), col, scale)
    w = 0.019
    r0, r1 = 0.0075, 0.021
    paper = pmat("tape_plain", "#f3ecd9", 0.6)
    # the roll: a thick annulus whose sides show the wound layers
    roll = lathe("roll", [(r0, -w / 2), (r1 - 0.0008, -w / 2), (r1, -w / 2 + 0.0008), (r1, w / 2 - 0.0008),
                          (r1 - 0.0008, w / 2), (r0, w / 2), (r0, -w / 2)], n=64, cap_top=False, cap_bot=False)
    rl = mesh_ob("tape_roll", roll, coil_side_mat(), loc=(0, 0, r1), rot=(math.radians(90), 0, 0), parent=p, col=col)
    rl.data.materials.append(paper)
    for poly in rl.data.polygons:      # the outer wrap is plain paper, the two sides show the layers
        c = poly.center
        if abs(c.z) < w / 2 - 0.0004 and math.hypot(c.x, c.y) > r1 - 0.0005:
            poly.material_index = 1
    core = pmat("tape_core", "#8a6a48", 0.7)
    mesh_ob("tape_core", lathe("core", [(r0 - 0.0018, -w / 2 - 0.0003), (r0 + 0.0002, -w / 2 - 0.0003),
                                        (r0 + 0.0002, w / 2 + 0.0003), (r0 - 0.0018, w / 2 + 0.0003),
                                        (r0 - 0.0018, -w / 2 - 0.0003)], n=48, cap_top=False, cap_bot=False),
            core, loc=(0, 0, r1), rot=(math.radians(90), 0, 0), parent=p, col=col)
    # the free end: leaves the bottom of the roll, runs along the desk with a soft wave, curls up at the end
    path = []
    steps = 60
    for i in range(steps + 1):
        t = i / steps
        x = 0.002 + tail * t
        z = 0.0004 + 0.0025 * max(0.0, math.sin(t * math.pi * 2.2)) * (1 - t)
        if t > 0.82:
            z += ((t - 0.82) / 0.18) ** 2 * 0.007
        path.append((x, z))
    # first bit wraps over the bottom of the roll
    head = []
    for i in range(8):
        a = -math.pi / 2 - (7 - i) * 0.07
        head.append((r1 * math.cos(a) + 0.002, r1 + (r1 + 0.0004) * math.sin(a)))
    me = ribbon("tape", head + path, w * 0.98)
    rb = mesh_ob("tape_tail", me, tape_mat(), parent=p, col=col)
    return p


# =====================================================================================
# riskFriend: a donut with lilac icing on a napkin
# =====================================================================================
def build_riskFriend(col=None, loc=(0, 0, 0), rot_z=0.0, scale=1.0, napkin=0.105, seed=7):
    p = empty("prop_riskFriend", loc, (0, 0, rot_z), col, scale)
    rng = random.Random(seed)
    # napkin: a soft paper square with a few creases
    n = 24
    bm = bmesh.new()
    grid = []
    for i in range(n + 1):
        row = []
        for j in range(n + 1):
            x = (i / n - 0.5) * napkin
            y = (j / n - 0.5) * napkin
            z = 0.0006 + 0.0012 * max(0.0, noise.noise(Vector((x * 40, y * 40, 0.3)))) + 0.0007 * (abs(x) < 0.002 or abs(y) < 0.002)
            corner = max(abs(x), abs(y)) / (napkin / 2)
            z += 0.003 * max(0.0, corner - 0.85) / 0.15 * (1 if (x > 0) == (y > 0) else 0.2)
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for i in range(n):
        for j in range(n):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    me = bpy.data.meshes.new("napkin")
    bm.to_mesh(me)
    bm.free()
    mesh_ob("napkin", me, pmat("napkin", "#f2efe8", 0.85, sss=0.05), rot=(0, 0, math.radians(22)), parent=p, col=col)
    # dough
    R, r = 0.0255, 0.0135
    zc = 0.0012 + r * 0.82
    dough = pmat("dough", "#c98a4c", 0.55, sss=0.08)
    me = torus("dough", R, r, 64, 24)
    for v in me.vertices:           # flatten the bottom a little so it sits on the napkin
        if v.co.z < -r * 0.6:
            v.co.z = -r * 0.6 + (v.co.z + r * 0.6) * 0.3
        v.co.z *= 0.9
    mesh_ob("donut", me, dough, loc=(0, 0, zc), parent=p, col=col)
    # icing: the upper part of the torus, slightly proud, with a wavy dripping edge
    seg, ring = 96, 28
    bm = bmesh.new()
    rows = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        drip = 0.28 + 0.12 * math.sin(7 * a + 0.4) + 0.08 * math.sin(13 * a + 1.3) + 0.06 * max(0.0, math.sin(5 * a)) ** 6 * 4
        b0, b1 = -drip, math.pi + drip * 0.8
        row = []
        for j in range(ring + 1):
            b = b0 + (b1 - b0) * j / ring
            rr = r * 1.07
            row.append(bm.verts.new(((R + rr * math.cos(b)) * math.cos(a), (R + rr * math.cos(b)) * math.sin(a),
                                     rr * math.sin(b) * 0.9)))
        rows.append(row)
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(ring):
            bm.faces.new((rows[i][j], rows[i2][j], rows[i2][j + 1], rows[i][j + 1]))
    me = bpy.data.meshes.new("icing")
    bm.to_mesh(me)
    bm.free()
    icing = pmat("icing", "#B48CE8", 0.28, coat=0.6, sss=0.1)
    ic = mesh_ob("icing", me, icing, loc=(0, 0, zc), parent=p, col=col)
    sol = ic.modifiers.new("solid", "SOLIDIFY")
    sol.thickness = 0.0012
    sol.offset = -1
    # sprinkles
    cols = [pmat("spr_white", "#f7f3ea", 0.4), pmat("spr_green", "#2FBF71", 0.4), pmat("spr_navy", "#25305a", 0.4),
            pmat("spr_ivory", "#f2d9a6", 0.4)]
    spr = rbox("sprinkle", 0.0045, 0.0014, 0.0014, 0.0006, seg=2)
    for k in range(46):
        a = rng.uniform(0, 2 * math.pi)
        b = rng.uniform(0.35, math.pi - 0.35)
        rr = r * 1.07 + 0.0011
        pos = Vector(((R + rr * math.cos(b)) * math.cos(a), (R + rr * math.cos(b)) * math.sin(a), zc + rr * math.sin(b) * 0.9))
        nrm = Vector((math.cos(b) * math.cos(a), math.cos(b) * math.sin(a), math.sin(b))).normalized()
        q = nrm.to_track_quat("Z", "X")
        e = (q @ Matrix.Rotation(rng.uniform(0, math.pi), 4, "Z").to_quaternion()).to_euler()
        ob = mesh_ob("sprinkle", spr.copy(), None, loc=pos, rot=e, parent=p, col=col)
        ob.data.materials.append(cols[k % len(cols)])
    return p


# =====================================================================================
# shortWeek: a small flip calendar with a date circled
# =====================================================================================
def build_shortWeek(col=None, loc=(0, 0, 0), rot_z=0.0, scale=1.0, day="FRI", date="13"):
    p = empty("prop_shortWeek", loc, (0, 0, rot_z), col, scale)
    W, H = 0.078, 0.07
    lean = math.radians(16)
    board = pmat("cal_board", "#252c3c", 0.5, coat=0.2)
    # A-frame: front and back boards meeting at the top
    fr = empty("cal_front", (0, -H * math.sin(lean) - 0.0012, 0), (-lean, 0, 0), col)
    fr.parent = p
    bk = empty("cal_back", (0, H * math.sin(lean) + 0.0012, 0), (lean, 0, 0), col)
    bk.parent = p
    for e in (fr, bk):
        mesh_ob("cal_board", rbox("board", W, 0.002, H, 0.0008), board, loc=(0, 0, H / 2), parent=e, col=col)
    # pages hanging on the front board
    pg = pmat("cal_page", "#f7f3ea", 0.7)
    for k in range(4):
        mesh_ob("cal_page", rbox("page", W * 0.94, 0.0006, H * 0.86, 0.0002), pg,
                loc=(0, -0.0016 - k * 0.0006, H * 0.47 - k * 0.0004), parent=fr, col=col, smooth=False)
    face_y = -0.0016 - 3 * 0.0006 - 0.0005
    head = pmat("cal_head", "#B48CE8", 0.5)
    mesh_ob("cal_head", rbox("head", W * 0.94, 0.0006, H * 0.2, 0.0), head, loc=(0, face_y, H * 0.80), parent=fr, col=col, smooth=False)
    white = pmat("cal_white", "#fbf8f2", 0.6)
    text_ob("cal_day", day, H * 0.13, white, (0, face_y - 0.0005, H * 0.80), parent=fr, col=col)
    ink = pmat("ink", "#1b2340", 0.6)
    text_ob("cal_date", date, H * 0.42, ink, (0, face_y - 0.0004, H * 0.42), parent=fr, col=col, spacing=0.95)
    # the hand-drawn red ring around the date: a little more than one loop, uneven
    pts, rad = [], []
    for i in range(80):
        t = i / 79
        a = math.radians(70) + t * math.radians(395)
        rx = 0.0262 * (1 + 0.05 * math.sin(t * 9.0))
        rz = 0.0190 * (1 + 0.05 * math.cos(t * 7.0))
        pts.append((rx * math.cos(a) + 0.0007 * t, face_y - 0.0009 - 0.0002 * t, H * 0.415 + rz * math.sin(a) + 0.001 * t))
        rad.append(0.0011 * (0.6 + 0.4 * math.sin(math.pi * min(1, t * 1.15))))
    mesh_ob("cal_ring", tube("ring", pts, rad, n=8, up=Vector((0, -1, 0))), pmat("marker_red", "#E5484D", 0.45), parent=fr, col=col)
    # binding rings at the top
    metal = pmat("cal_metal", "#c4cbd6", 0.25, metal=1.0)
    for k in range(5):
        x = (k - 2) * W * 0.2
        mesh_ob("cal_bind", torus("bind", 0.0032, 0.0006, 20, 6), metal, loc=(x, 0.0, H * math.cos(lean) + 0.001),
                rot=(0, math.radians(90), 0), parent=p, col=col)
    return p


# =====================================================================================
# whisper: a folded paper note
# =====================================================================================
def note_mat():
    key = "p_note"
    if key in _M:
        return _M[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.75
    b.inputs["Subsurface Weight"].default_value = 0.05
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    # ruled lines along local Z every 5 mm (the panel meshes are built upright)
    d = nt.nodes.new("ShaderNodeMath"); d.operation = "DIVIDE"; d.inputs[1].default_value = 0.005
    nt.links.new(sep.outputs[2], d.inputs[0])
    fr = nt.nodes.new("ShaderNodeMath"); fr.operation = "FRACT"
    nt.links.new(d.outputs[0], fr.inputs[0])
    lt = nt.nodes.new("ShaderNodeMath"); lt.operation = "LESS_THAN"; lt.inputs[1].default_value = 0.09
    nt.links.new(fr.outputs[0], lt.inputs[0])
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
    mix.inputs["A"].default_value = lin("#f8f5ee")
    mix.inputs["B"].default_value = lin("#a9bfe6")
    nt.links.new(lt.outputs[0], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    _M[key] = m
    return m


def build_whisper(col=None, loc=(0, 0, 0), rot_z=0.0, scale=1.0):
    """A notebook page folded in half and stood up like a little tent, 'psst' on the front."""
    p = empty("prop_whisper", loc, (0, 0, rot_z), col, scale)
    W, P = 0.068, 0.040           # width, panel height
    open_ = math.radians(30)      # each panel's angle from vertical
    paper = note_mat()
    for side in (-1, 1):
        # each panel's origin is its bottom edge; tilted so the two top edges meet at the fold (y = 0)
        e = empty("note_panel", (0, side * P * math.sin(open_), 0), (side * open_, 0, 0), col)
        e.parent = p
        bm = bmesh.new()
        nx, nz = 12, 8
        vs = [[bm.verts.new(((i / nx - 0.5) * W, 0.0, j / nz * P)) for j in range(nz + 1)] for i in range(nx + 1)]
        for i in range(nx):
            for j in range(nz):
                bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
        for v in bm.verts:            # a slight bow, as folded paper never lies quite flat
            v.co.y += side * 0.0012 * math.sin(math.pi * (v.co.x / W + 0.5)) * math.sin(math.pi * v.co.z / P)
        me = bpy.data.meshes.new("note")
        bm.to_mesh(me)
        bm.free()
        mesh_ob("note_panel", me, paper, parent=e, col=col)
    ink = pmat("pencil", "#2b3150", 0.7)
    text_ob("note_txt", "psst\u2026", P * 0.30, ink, (0.002, -P * math.sin(open_) / 2 - 0.0018, P * 0.5 * math.cos(open_)),
                rot=(math.radians(90) - open_, 0, math.radians(-2)), parent=p, col=col, bold=False, shear=0.25)
    return p


# =====================================================================================
# insurance: a cream policy envelope, flap up, closed with a dark red wax seal
# =====================================================================================
def build_insurance(col=None, loc=(0, 0, 0), rot_z=0.0, scale=1.0, W=0.105, D=0.062):
    """Lies flat, back up: the pointed flap toward -Y (the camera) with the seal on its tip."""
    p = empty("prop_insurance", loc, (0, 0, rot_z), col, scale)
    T = 0.0032
    # body: a thin pillow (thicker in the middle where the folded policy is)
    nx, ny = 24, 14
    bm = bmesh.new()
    top, bot = [], []
    for i in range(nx + 1):
        rt, rb = [], []
        for j in range(ny + 1):
            u, v = i / nx - 0.5, j / ny - 0.5
            x, y = u * W, v * D
            puff = (1 - (2 * u) ** 6) * (1 - (2 * v) ** 6)
            rt.append(bm.verts.new((x, y, 0.0006 + (T - 0.0006) * puff)))
            rb.append(bm.verts.new((x, y, 0.0)))
        top.append(rt)
        bot.append(rb)
    for i in range(nx):
        for j in range(ny):
            bm.faces.new((top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1]))
            bm.faces.new((bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j], bot[i][j]))
    for i in range(nx):       # the four thin edges
        bm.faces.new((bot[i][0], bot[i + 1][0], top[i + 1][0], top[i][0]))
        bm.faces.new((top[i][ny], top[i + 1][ny], bot[i + 1][ny], bot[i][ny]))
    for j in range(ny):
        bm.faces.new((top[0][j], top[0][j + 1], bot[0][j + 1], bot[0][j]))
        bm.faces.new((bot[nx][j], bot[nx][j + 1], top[nx][j + 1], top[nx][j]))
    me = bpy.data.meshes.new("envelope")
    bm.to_mesh(me)
    bm.free()
    paper = pmat("env_paper", "#efe4c8", 0.78, sss=0.04)
    mesh_ob("env_body", me, paper, parent=p, col=col)

    def h(x, y):
        u, v = x / W, y / D
        return 0.0006 + (T - 0.0006) * (1 - (2 * u) ** 6) * (1 - (2 * v) ** 6)
    # the flap: a slightly darker triangle from the back edge to a point near the front, on the puff
    tip = (0.0, -D * 0.18)
    shade = pmat("env_flap", "#e6d8b6", 0.72, sss=0.04)
    bm = bmesh.new()
    N = 14
    rows = []
    for k in range(N + 1):
        t = k / N
        yy = D / 2 - 0.0012 + (tip[1] - D / 2 + 0.0012) * t
        half = (W / 2 - 0.0012) * (1 - t) + 0.004 * t
        row = []
        for m in range(9):
            xx = -half + 2 * half * m / 8
            row.append(bm.verts.new((xx, yy, h(xx, yy) + 0.00035)))
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        for m in range(8):
            bm.faces.new((a[m], a[m + 1], b[m + 1], b[m]))
    me = bpy.data.meshes.new("flap")
    bm.to_mesh(me)
    bm.free()
    mesh_ob("env_flap", me, shade, parent=p, col=col)
    # a printed line on the body near the front edge, under the flap: "POLICY ENCLOSED"
    ink = pmat("env_ink", "#2a3350", 0.6)
    text_ob("env_txt", "POLICY  ENCLOSED", D * 0.085, ink, (0.0, -D * 0.40, h(0, -D * 0.4) + 0.0004),
            rot=(0, 0, 0), parent=p, col=col, spacing=1.15)
    # wax seal on the flap tip: a squashed, slightly irregular blob with a pressed ring and crest
    wax = pmat("wax", "#5a0a10", 0.32, coat=0.5, sss=0.05)
    zs = h(tip[0], tip[1]) + 0.0003
    rng = random.Random(11)
    blob = lambda a, z: 1.0 + 0.07 * math.sin(3 * a + 0.4) + 0.05 * math.sin(7 * a + 1.1)
    mesh_ob("wax_seal", lathe("seal", [(0.0, zs), (0.0098, zs), (0.0104, zs + 0.0007), (0.0098, zs + 0.0017),
                                     (0.0082, zs + 0.0024), (0.0, zs + 0.0025)], n=48, wobble=blob),
            wax, loc=(tip[0], tip[1], 0), parent=p, col=col)
    mesh_ob("wax_ring", torus("ring", 0.0062, 0.00055, 40, 8), wax, loc=(tip[0], tip[1], zs + 0.0025), parent=p, col=col)
    mesh_ob("wax_crest", lathe("crest", [(0.0, zs + 0.0024), (0.0034, zs + 0.0024), (0.0030, zs + 0.0032), (0.0, zs + 0.0034)],
                               n=6), wax, loc=(tip[0], tip[1], 0), rot=(0, 0, rng.uniform(0, 1)), parent=p, col=col)
    return p


# =====================================================================================
# bellClerk: a chrome stopwatch lying on its back
# =====================================================================================
def build_bellClerk(col=None, loc=(0, 0, 0), rot_z=0.0, scale=1.0):
    """Crown and bow point toward +Y (away from the camera) at rot_z = 0."""
    p = empty("prop_bellClerk", loc, (0, 0, rot_z), col, scale)
    R, Tk = 0.0215, 0.012
    chrome = pmat("chrome", "#dfe3ea", 0.08, metal=1.0)
    # case: a rounded pebble profile
    prof = [(0.0, 0.0), (R * 0.70, 0.0), (R * 0.92, 0.0015), (R, Tk * 0.45), (R * 0.985, Tk * 0.75), (R * 0.93, Tk * 0.9),
            (R * 0.90, Tk * 0.9)]
    mesh_ob("sw_case", lathe("case", prof, n=72, cap_top=False), chrome, parent=p, col=col)
    zf = Tk * 0.86
    # dial, crystal
    dial = pmat("sw_dial", "#f6f3ec", 0.45)
    mesh_ob("sw_dial", lathe("dial", [(0.0, zf), (R * 0.88, zf)], n=72, cap_top=False, cap_bot=False), dial, parent=p, col=col)
    glass = pmat("sw_glass", "#ffffff", 0.02, trans=1.0, ior=1.5)
    g = mesh_ob("sw_glass", lathe("crystal", [(R * 0.90, Tk * 0.9), (R * 0.80, Tk * 0.98), (R * 0.5, Tk * 1.03), (0.0, Tk * 1.04)],
                                  n=72, cap_bot=False), glass, parent=p, col=col)
    no_shadow(g)
    ink = pmat("ink", "#1b2340", 0.6)
    red = pmat("red_ink", "#E5484D", 0.5)
    tick = rbox("tick", 0.0007, 0.0028, 0.0002)
    tick_s = rbox("tick_s", 0.0004, 0.0013, 0.0002)
    for k in range(60):
        a = math.pi / 2 - k * 2 * math.pi / 60
        big = k % 5 == 0
        rr = R * (0.76 if big else 0.80)
        mesh_ob("sw_tick", (tick if big else tick_s).copy(), None, loc=(rr * math.cos(a), rr * math.sin(a), zf + 0.0002),
                rot=(0, 0, a - math.pi / 2), parent=p, col=col, smooth=False).data.materials.append(ink)
    # a small sub-dial and the two hands
    mesh_ob("sw_sub", torus("sub", R * 0.2, 0.00025, 32, 6), ink, loc=(0, -R * 0.36, zf + 0.0002), parent=p, col=col)
    mesh_ob("sw_hand", rbox("hand", 0.0007, R * 0.86, 0.0004), red, loc=(R * 0.86 / 2 * math.sin(0.9), R * 0.86 / 2 * math.cos(0.9) - 0.0,
            zf + 0.0009), rot=(0, 0, -0.9), parent=p, col=col, smooth=False)
    mesh_ob("sw_hand_tail", rbox("tail", 0.0009, R * 0.22, 0.0004), red, loc=(-R * 0.11 * math.sin(0.9), -R * 0.11 * math.cos(0.9),
            zf + 0.0009), rot=(0, 0, -0.9), parent=p, col=col, smooth=False)
    mesh_ob("sw_hand2", rbox("hand2", 0.0006, R * 0.14, 0.0003), ink, loc=(R * 0.07 * math.sin(-2.2), -R * 0.36 + R * 0.07 * math.cos(-2.2),
            zf + 0.0006), rot=(0, 0, 2.2), parent=p, col=col, smooth=False)
    mesh_ob("sw_pin", lathe("pin", [(0, zf), (0.0011, zf), (0.0011, zf + 0.0013), (0, zf + 0.0014)], n=16), red, parent=p, col=col)
    # crown stem, crown and the bow (ring) at +Y; two side pushers
    zc = Tk * 0.48
    mesh_ob("sw_stem", lathe("stem", [(0.0018, 0), (0.0018, 0.004)], n=16), chrome, loc=(0, R - 0.0005, zc),
            rot=(math.radians(-90), 0, 0), parent=p, col=col)
    knurl = lambda a, z: 1.0 + 0.06 * (math.cos(24 * a) > 0)
    mesh_ob("sw_crown", lathe("crown", [(0, 0), (0.0036, 0), (0.0040, 0.0012), (0.0040, 0.0040), (0.0034, 0.0050), (0, 0.0052)],
                              n=48, wobble=knurl), chrome, loc=(0, R + 0.0030, zc), rot=(math.radians(-90), 0, 0), parent=p, col=col)
    mesh_ob("sw_bow", torus("bow", 0.0075, 0.0011, 40, 10), chrome, loc=(0, R + 0.0120, 0.0011), parent=p, col=col)
    for s in (-1, 1):
        a = math.pi / 2 + s * math.radians(42)
        mesh_ob("sw_push", lathe("push", [(0, 0), (0.0016, 0), (0.0016, 0.0028), (0.0022, 0.0030), (0.0022, 0.0042), (0, 0.0044)], n=20),
                chrome, loc=(R * 0.97 * math.cos(a), R * 0.97 * math.sin(a), zc), rot=(math.radians(-90), 0, a - math.pi / 2),
                parent=p, col=col)
    return p


# =====================================================================================
# ironStomach: a paper-wrapped roll of antacid tablets, opened, with a few loose tablets
# =====================================================================================
def wrapper_mat():
    key = "p_antacid_wrap"
    if key in _M:
        return _M[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.55
    b.inputs["Coat Weight"].default_value = 0.25
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    # bands along the roll's axis (object Z): white, a mint band with a navy pinstripe, white
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, lin("#f5f6f2")
    els[1].position, els[1].color = 0.17, lin("#1f3a6b")
    for pos, c in ((0.195, "#7fd1b9"), (0.805, "#1f3a6b"), (0.83, "#f5f6f2")):
        e = els.new(pos)
        e.color = lin(c)
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.0
    mr.inputs["From Max"].default_value = 0.052
    nt.links.new(sep.outputs[2], mr.inputs["Value"])
    nt.links.new(mr.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], b.inputs["Base Color"])
    _M[key] = m
    return m


def build_ironStomach(col=None, loc=(0, 0, 0), rot_z=0.0, scale=1.0):
    """The roll lies along local X, its open (foil) end at +X, with three tablets beside it."""
    p = empty("prop_ironStomach", loc, (0, 0, rot_z), col, scale)
    r, L = 0.0095, 0.052
    roll = empty("ant_roll", (-L / 2, 0, r), (0, math.radians(90), 0), col)
    roll.parent = p
    crimp = lambda a, z: 1.0 - (0.06 * (0.5 + 0.5 * math.cos(18 * a)) if z < 0.0025 else 0.0)
    mesh_ob("ant_wrap", lathe("wrap", [(r * 0.55, 0.0), (r * 0.92, 0.0007), (r, 0.0025), (r, L - 0.0045), (r * 1.01, L - 0.004)],
                              n=48, cap_top=False, wobble=crimp), wrapper_mat(), parent=roll, col=col)
    # the torn-open end: crinkled foil collar and the top tablet showing
    foil = pmat("foil", "#cfd5dd", 0.28, metal=1.0)
    tear = lambda a, z: 1.0 + 0.05 * math.sin(7 * a) * (z > L - 0.0042)
    mesh_ob("ant_foil", lathe("foil", [(r * 1.012, L - 0.0045), (r * 1.02, L - 0.0010), (r * 0.98, L + 0.0012)], n=48,
                              cap_top=False, cap_bot=False, wobble=tear), foil, parent=roll, col=col)
    chalk = [pmat("tab_white", "#f2efe6", 0.85), pmat("tab_pink", "#f1c9d2", 0.85), pmat("tab_mint", "#cdeedd", 0.85)]
    tab = lambda nm, tr, th: lathe(nm, [(0, 0), (tr * 0.93, 0), (tr, th * 0.3), (tr, th * 0.7), (tr * 0.93, th), (0, th)], n=40)
    tr, th = r * 0.92, 0.0042
    mesh_ob("ant_top_tab", tab("tt", tr * 0.98, 0.001), chalk[1], loc=(0, 0, L - 0.0018), parent=roll, col=col)
    # loose tablets: one flat, one leaning on another, one on its edge
    poses = [((L / 2 + 0.014, -0.007, 0.0), (0, 0, 0), chalk[0]),
             ((L / 2 + 0.010, 0.011, 0.0), (0, 0, 0), chalk[2]),
             ((L / 2 + 0.0145, 0.0105, 0.0026), (math.radians(-28), math.radians(10), 0), chalk[1])]
    for (x, y, z), rot, m in poses:
        mesh_ob("ant_tab", tab("tab", tr, th), m, loc=(x, y, z), rot=rot, parent=p, col=col)
        # a pressed groove across the top (score line)
        mesh_ob("ant_score", rbox("score", tr * 1.6, 0.0007, 0.0004), pmat("tab_shadow", "#d9d4c6", 0.9),
                loc=(x, y, z + th * math.cos(rot[0]) * 0.98), rot=rot, parent=p, col=col, smooth=False)
    # a little printed name on the wrapper, facing the camera side (-Y)
    ink = pmat("ant_ink", "#1f3a6b", 0.5)
    a = math.radians(33)            # on the wrapper, turned up toward the camera
    text_ob("ant_txt", "ANTACID", r * 0.56, ink, (-L / 2 + L * 0.50, -(r + 0.0002) * math.cos(a), r + (r + 0.0002) * math.sin(a)),
            rot=(math.radians(90) - a, 0, 0), parent=p, col=col)
    return p


# =====================================================================================
# biggerBook: a thick, closed leather order ledger
# =====================================================================================
def build_biggerBook(col=None, loc=(0, 0, 0), rot_z=0.0, scale=1.0, W=0.100, D=0.074, T=0.030):
    """Lies flat with its rounded spine toward -Y (the camera); the cover title reads along +X."""
    p = empty("prop_biggerBook", loc, (0, 0, rot_z), col, scale)
    leather = pmat("ledger_leather", "#183224", 0.5, coat=0.15)
    gold = pmat("gilt", "#d1a64a", 0.25, metal=1.0)
    page = pmat("ledger_pages", "#efe6cf", 0.8)
    c = 0.0035                      # cover board thickness
    ov = 0.0028                     # cover overhang past the page block
    sr = T / 2                      # spine radius (x-section a half-ellipse)
    for z in (c / 2, T - c / 2):
        mesh_ob("ledger_cover", rbox("cover", W, D - sr * 0.4, c, 0.0012), leather, loc=(0, sr * 0.2, z), parent=p, col=col)
    # page block, inset on the three open sides
    mesh_ob("ledger_pages", rbox("pages", W - 2 * ov, D - ov - sr * 0.4, T - 2 * c + 0.0004, 0.0), page,
            loc=(0, sr * 0.2 - ov / 2, T / 2), parent=p, col=col, smooth=False)
    lines = pmat("ledger_line", "#cbbf9f", 0.9)
    for k in range(8):              # page-edge lines on the fore-edge (+Y) and the ends
        z = c + (T - 2 * c) * (k + 0.5) / 8
        mesh_ob("ledger_line", rbox("pl", W - 2 * ov - 0.001, 0.0002, 0.00016), lines,
                loc=(0, D / 2 - ov - 0.0001 + 0.0002, z), parent=p, col=col, smooth=False)
        for sx in (-1, 1):
            mesh_ob("ledger_line", rbox("pl", 0.0002, D - ov - sr * 0.4 - 0.001, 0.00016), lines,
                    loc=(sx * (W / 2 - ov + 0.0001), sr * 0.2 - ov / 2, z), parent=p, col=col, smooth=False)
    # rounded spine along X at -Y: a half-cylinder squashed in depth
    y0 = -D / 2 + sr * 0.4
    sp = mesh_ob("ledger_spine", lathe("spine", [(sr, -W / 2), (sr + 0.0006, -W / 2 + 0.0015), (sr + 0.0006, W / 2 - 0.0015),
                                                (sr, W / 2)], n=48), leather,
                 loc=(0, y0, T / 2), rot=(0, math.radians(90), 0), scale=(1.0, 0.42, 1.0), parent=p, col=col)
    for xx in (-W * 0.30, -W * 0.10, W * 0.10, W * 0.30):        # raised bands, gilt lines between them
        mesh_ob("ledger_band", lathe("band", [(sr + 0.0006, -0.0016), (sr + 0.0016, -0.0008), (sr + 0.0016, 0.0008),
                                              (sr + 0.0006, 0.0016)], n=48, cap_top=False, cap_bot=False), leather,
                loc=(xx, y0, T / 2), rot=(0, math.radians(90), 0), scale=(1.0, 0.42, 1.0), parent=p, col=col)
    for xx in (-W * 0.20, W * 0.20):
        mesh_ob("ledger_gild", lathe("gild", [(sr + 0.0008, -0.0004), (sr + 0.0009, 0.0), (sr + 0.0008, 0.0004)], n=48,
                                     cap_top=False, cap_bot=False), gold,
                loc=(xx, y0, T / 2), rot=(0, math.radians(90), 0), scale=(1.0, 0.42, 1.0), parent=p, col=col)
    # brass corner guards on the fore-edge corners, top and bottom cover
    for sx in (-1, 1):
        for z in (c / 2, T - c / 2):
            mesh_ob("ledger_corner", rbox("corner", 0.011, 0.011, c + 0.0009, 0.0008), gold,
                    loc=(sx * (W / 2 - 0.0045), D / 2 - 0.0045, z), rot=(0, 0, math.radians(45)), parent=p, col=col)
    # gilt title panel on the cover: a thin frame and "ORDERS"
    zt = T + 0.0001
    fw, fd = W * 0.50, D * 0.30
    cy_ = D * 0.04
    for (sx_, sy_, lx, ly) in ((fw, 0.0007, 0, fd / 2), (fw, 0.0007, 0, -fd / 2), (0.0007, fd, fw / 2, 0), (0.0007, fd, -fw / 2, 0)):
        mesh_ob("ledger_frame", rbox("fr", sx_, sy_, 0.0003), gold, loc=(lx, ly + cy_, zt), parent=p, col=col, smooth=False)
    text_ob("ledger_title", "ORDERS", D * 0.10, gold, (0, cy_, zt + 0.0001), rot=(0, 0, 0), parent=p, col=col, spacing=1.2)
    # a lilac ribbon marker escaping from the +X end and lying on the desk
    yr = -D * 0.12
    pts = [(W / 2 - 0.006, yr, T * 0.55), (W / 2 + 0.0015, yr, T * 0.5), (W / 2 + 0.006, yr - 0.001, T * 0.25),
           (W / 2 + 0.0095, yr - 0.003, 0.0006), (W / 2 + 0.017, yr - 0.007, 0.0004)]
    mesh_ob("ledger_ribbon", ribbon_strip("ribbon", pts, 0.0045), pmat("lilac", "#B48CE8", 0.55), parent=p, col=col)
    return p


def ribbon_strip(name, pts, width):
    """A flat strip through 3D points, its width horizontal (along the side perpendicular to travel)."""
    pts = [Vector(q) for q in pts]
    bm = bmesh.new()
    rows = []
    for k, q in enumerate(pts):
        t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        side = t.cross(Vector((0, 0, 1)))
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side.normalize()
        rows.append((bm.verts.new(q - side * width / 2), bm.verts.new(q + side * width / 2)))
    for a, b in zip(rows, rows[1:]):
        bm.faces.new((a[0], b[0], b[1], a[1]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


# =====================================================================================
# deepPockets: a silver money clip holding folded banknotes
# =====================================================================================
def bill_mat():
    key = "p_bill"
    if key in _M:
        return _M[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.8
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    # engraved look: a border band and fine guilloche-like waves in the middle
    ax = nt.nodes.new("ShaderNodeMath"); ax.operation = "ABSOLUTE"
    ay = nt.nodes.new("ShaderNodeMath"); ay.operation = "ABSOLUTE"
    nt.links.new(sep.outputs[0], ax.inputs[0]); nt.links.new(sep.outputs[1], ay.inputs[0])
    bx = nt.nodes.new("ShaderNodeMath"); bx.operation = "GREATER_THAN"; bx.inputs[1].default_value = 0.0290
    by = nt.nodes.new("ShaderNodeMath"); by.operation = "GREATER_THAN"; by.inputs[1].default_value = 0.0125
    nt.links.new(ax.outputs[0], bx.inputs[0]); nt.links.new(ay.outputs[0], by.inputs[0])
    border = nt.nodes.new("ShaderNodeMath"); border.operation = "MAXIMUM"
    nt.links.new(bx.outputs[0], border.inputs[0]); nt.links.new(by.outputs[0], border.inputs[1])
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = 260.0
    wave.inputs["Distortion"].default_value = 6.0
    nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
    wv = nt.nodes.new("ShaderNodeMath"); wv.operation = "MULTIPLY"; wv.inputs[1].default_value = 0.35
    nt.links.new(wave.outputs["Fac"], wv.inputs[0])
    mx = nt.nodes.new("ShaderNodeMath"); mx.operation = "MAXIMUM"
    nt.links.new(border.outputs[0], mx.inputs[0]); nt.links.new(wv.outputs[0], mx.inputs[1])
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
    mix.inputs["A"].default_value = lin("#dfe5d2")
    mix.inputs["B"].default_value = lin("#5d8a68")
    nt.links.new(mx.outputs[0], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    _M[key] = m
    return m


def build_deepPockets(col=None, loc=(0, 0, 0), rot_z=0.0, scale=1.0, n_bills=5):
    """Banknotes folded in half (fold at -X), held by a flat silver clip; lies flat."""
    p = empty("prop_deepPockets", loc, (0, 0, rot_z), col, scale)
    L, Wd = 0.066, 0.030                   # folded size
    rng = random.Random(5)
    bill = bill_mat()
    th = 0.00055
    stack_h = n_bills * 2 * th
    for k in range(n_bills * 2):
        z = th / 2 + k * th
        jitter = (rng.uniform(-0.003, 0.003), rng.uniform(-0.0015, 0.0015), rng.uniform(-0.06, 0.06))
        mesh_ob("bill", rbox("bill", L - 0.001 * (k % 3), Wd, th * 0.9, 0.0002, seg=1), bill,
                loc=(jitter[0], jitter[1], z + 0.0002 * math.sin(k)), rot=(0, 0, jitter[2]), parent=p, col=col)
    # the folded edge: a rounded bundle at -X
    mesh_ob("bill_fold", lathe("fold", [(stack_h / 2, -Wd / 2), (stack_h / 2 + 0.0002, Wd / 2)], n=24, cap_top=True, cap_bot=True),
            bill, loc=(-L / 2, 0, stack_h / 2), rot=(math.radians(90), 0, 0), scale=(0.6, 1, 1), parent=p, col=col)
    # the top note's portrait oval and value, on the part the clip leaves showing
    ink = pmat("bill_ink", "#2f5a3c", 0.7)
    zt = stack_h + 0.0003
    mesh_ob("bill_oval", torus("oval", 0.0075, 0.00045, 40, 6), ink, loc=(0.015, 0, zt), scale=(1.0, 1.3, 0.4), parent=p, col=col)
    mesh_ob("bill_portrait", lathe("por", [(0, 0), (0.0062, 0)], n=32, cap_top=False, cap_bot=False), pmat("bill_tint", "#9fb89a", 0.8),
            loc=(0.015, 0, zt - 0.0001), scale=(1.0, 1.3, 1.0), parent=p, col=col)
    for sy in (-1, 1):
        text_ob("bill_val", "100", 0.0042, ink, (0.0265, sy * 0.0105, zt), rot=(0, 0, 0), parent=p, col=col)
    # the clip: a 2 mm-thick strip over the top, around the fold, under the bottom
    silver = pmat("clip_silver", "#c9ced6", 0.14, metal=1.0)
    cw = 0.016
    lt, lb = 0.040, 0.034
    pts = []
    for i in range(14):
        t = i / 13
        pts.append((-L / 2 + 0.002 + lt * (1 - t), 0, stack_h + 0.0009 - 0.0004 * math.sin(t * math.pi)))
    for i in range(1, 12):
        a = math.pi / 2 + math.pi * i / 12
        rr = stack_h / 2 + 0.0009
        pts.append((-L / 2 + 0.002 + rr * 0.9 * math.cos(a), 0, stack_h / 2 + rr * math.sin(a)))
    for i in range(14):
        t = i / 13
        pts.append((-L / 2 + 0.002 + lb * t, 0, -0.0001 + 0.0002 * t))
    # a strip through the XZ path, width along Y
    bm = bmesh.new()
    rows = []
    for k, (x, y, z) in enumerate(pts):
        a = Vector(pts[max(k - 1, 0)]); b_ = Vector(pts[min(k + 1, len(pts) - 1)])
        tt = (b_ - a).normalized()
        nrm = Vector((-tt.z, 0, tt.x))
        q = Vector((x, y, z))
        rows.append([bm.verts.new(q + Vector((0, s * cw / 2, 0)) + nrm * d) for (s, d) in
                     ((-1, -0.0006), (1, -0.0006), (1, 0.0006), (-1, 0.0006))])
    for a, b_ in zip(rows, rows[1:]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((a[i], a[j], b_[j], b_[i]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    me = bpy.data.meshes.new("clip")
    bm.to_mesh(me)
    bm.free()
    ob = mesh_ob("clip", me, silver, parent=p, col=col)
    bv = ob.modifiers.new("bevel", "BEVEL")
    bv.width = 0.00035
    bv.segments = 2
    return p


# =====================================================================================
# leverageLoan: a slip stamped LOAN in red, locked with a tiny brass padlock
# =====================================================================================
def slip_mat():
    key = "p_slip"
    if key in _M:
        return _M[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.8
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    # aged paper: a grimy noise, darker toward the edges, and fine print lines
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 90.0
    nz.inputs["Detail"].default_value = 6.0
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = lin("#9c8f72")
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = lin("#d8ccae")
    nt.links.new(nz.outputs["Fac"], ramp.inputs[0])
    _M[key] = m
    nt.links.new(ramp.outputs[0], b.inputs["Base Color"])
    return m


def build_leverageLoan(col=None, loc=(0, 0, 0), rot_z=0.0, scale=1.0, W=0.072, D=0.044):
    p = empty("prop_leverageLoan", loc, (0, 0, rot_z), col, scale)
    # the slip: thin, a little curled at the corners
    nx, ny = 20, 12
    bm = bmesh.new()
    grid = []
    for i in range(nx + 1):
        row = []
        for j in range(ny + 1):
            x, y = (i / nx - 0.5) * W, (j / ny - 0.5) * D
            cx, cy = abs(x) / (W / 2), abs(y) / (D / 2)
            z = 0.0003 + 0.0022 * max(0.0, cx - 0.7) ** 2 / 0.09 * (0.6 + 0.4 * cy) + 0.0006 * max(0.0, cy - 0.6) ** 2 / 0.16
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for i in range(nx):
        for j in range(ny):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    me = bpy.data.meshes.new("slip")
    bm.to_mesh(me)
    bm.free()
    sl = mesh_ob("loan_slip", me, slip_mat(), parent=p, col=col)
    so = sl.modifiers.new("solid", "SOLIDIFY")
    so.thickness = 0.0004
    so.offset = -1
    ink = pmat("loan_ink", "#1a1c24", 0.6)
    zt = 0.00045
    # black rule border and fine print
    for (sx_, sy_, lx, ly) in ((W * 0.9, 0.0008, 0, D * 0.42), (W * 0.9, 0.0008, 0, -D * 0.42),
                               (0.0008, D * 0.84, W * 0.45, 0), (0.0008, D * 0.84, -W * 0.45, 0)):
        mesh_ob("loan_rule", rbox("rule", sx_, sy_, 0.0001), ink, loc=(lx, ly, zt), parent=p, col=col, smooth=False)
    for k in range(4):
        mesh_ob("loan_print", rbox("print", W * (0.55 if k % 2 else 0.7), 0.0006, 0.0001), pmat("loan_grey", "#5b5a58", 0.7),
                loc=(-W * 0.06, -D * 0.30 + k * 0.0026, zt), parent=p, col=col, smooth=False)
    text_ob("loan_hdr", "PROMISSORY NOTE", D * 0.075, ink, (0, D * 0.32, zt), rot=(0, 0, 0), parent=p, col=col, spacing=1.1)
    # the red stamp: LOAN in a box, at an angle, slightly uneven
    stamp = pmat("stamp_red", "#8c0d14", 0.55)
    st = empty("loan_stamp", (-W * 0.05, D * 0.02, zt + 0.0001), (0, 0, math.radians(-9)), col)
    st.parent = p
    text_ob("loan_txt", "LOAN", D * 0.34, stamp, (0, 0, 0), rot=(0, 0, 0), parent=st, col=col, spacing=1.1)
    bw, bh = W * 0.60, D * 0.42
    for (sx_, sy_, lx, ly) in ((bw, 0.0012, 0, bh / 2), (bw, 0.0012, 0, -bh / 2), (0.0012, bh, bw / 2, 0), (0.0012, bh, -bw / 2, 0)):
        mesh_ob("loan_box", rbox("sb", sx_, sy_, 0.0001), stamp, loc=(lx, ly, 0), parent=st, col=col, smooth=False)
    # grommet hole at the right end, with the padlock's shackle through it, the lock lying on the slip
    brass = pmat("brass", "#d1a64a", 0.2, metal=1.0)
    steel = pmat("lock_steel", "#9aa3b3", 0.22, metal=1.0)
    gx, gy = W * 0.36, -D * 0.05
    mesh_ob("loan_grommet", torus("grom", 0.0028, 0.0007, 24, 8), brass, loc=(gx, gy, zt + 0.0003), parent=p, col=col)
    mesh_ob("loan_hole", lathe("hole", [(0, 0), (0.0021, 0)], n=24, cap_top=False, cap_bot=False), pmat("hole_dark", "#0b0c10", 0.9),
            loc=(gx, gy, zt + 0.0002), parent=p, col=col)
    lk = empty("loan_lock", (gx + 0.0105, gy - 0.004, 0.0), (0, 0, math.radians(-20)), col)
    lk.parent = p
    bwid, bdep, bth = 0.0135, 0.0105, 0.0055
    mesh_ob("lock_body", rbox("lb", bdep, bwid, bth, 0.0012), brass, loc=(0, 0, 0.0006 + bth / 2), parent=lk, col=col)
    mesh_ob("lock_key", lathe("kh", [(0, 0), (0.0011, 0), (0.0011, 0.0003), (0, 0.0003)], n=16), pmat("hole_dark", "#0b0c10", 0.9),
            loc=(0.0015, 0, 0.0006 + bth + 0.00005), parent=lk, col=col)
    mesh_ob("lock_slot", rbox("ks", 0.0026, 0.0007, 0.0003), pmat("hole_dark", "#0b0c10", 0.9),
            loc=(0.0028, 0, 0.0006 + bth + 0.00005), parent=lk, col=col, smooth=False)
    # shackle: a U lying flat, from the body's -X face through the grommet and back
    pts = []
    zc = 0.0006 + bth / 2
    for i in range(21):
        a = math.pi * i / 20
        pts.append((-bdep / 2 - 0.0058 * math.sin(a) - (0.0 if 0 < i < 20 else 0), 0.0042 * math.cos(a), zc + 0.0006 * math.sin(a)))
    pts = [(-bdep / 2 + 0.002, 0.0042, zc)] + pts + [(-bdep / 2 + 0.002, -0.0042, zc)]
    mesh_ob("lock_shackle", tube("shackle", pts, [0.00105] * len(pts), n=12), steel, parent=lk, col=col)
    return p


BUILDERS = {
    "insurance": build_insurance,
    "bellClerk": build_bellClerk,
    "ironStomach": build_ironStomach,
    "biggerBook": build_biggerBook,
    "deepPockets": build_deepPockets,
    "leverageLoan": build_leverageLoan,
    "rewind": build_rewind,
    "hotHand": build_hotHand,
    "stopDiscipline": build_stopDiscipline,
    "tapeReader": build_tapeReader,
    "riskFriend": build_riskFriend,
    "shortWeek": build_shortWeek,
    "coffee": build_coffee,
    "whisper": build_whisper,
    "rainmaker": build_rainmaker,
    "thetaShield": build_thetaShield,
}


def descendants(root):
    out = []
    stack = list(root.children)
    while stack:
        o = stack.pop()
        out.append(o)
        stack.extend(o.children)
    return out
