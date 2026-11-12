"""Funded: backdrop scene builder.

Builds the whole trading-floor scene from Blender factory startup and renders
both backdrops (CAM_main -> desk.png, CAM_wide -> wide.png) with Cycles on CPU.

    blender -b --factory-startup -P art/build_scene.py -- [--out DIR] [--samples N] [--preview]
                                                           [--cams main,wide] [--variant tier1|tier2|tier3|fired]
                                                           [--tod am|mid|pm]

--variant picks the gameplay desk (CAM_main) for each career stage: tier1 (back
row, the default and the original look), tier2 (mid-floor with wing monitors),
tier3 (window seat over the city) or fired (tier1 desk with a packed box).

--tod picks the time of day for tier1..tier3 (the game crossfades the desk from
the opening bell to the close): am (cool, soft morning), mid (the default) or pm
(warm, low late-afternoon sun). It only changes lights, sky, glass, the city's
windows and haze; geometry, cameras and the hero screens stay as they are.

Everything is procedural (no downloaded assets). See art/README.md for the
camera/screen contract that must stay fixed.
"""

import bpy
import bmesh
import math
import os
import random
import sys
import time
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def _arg(name, default):
    if name in argv:
        return argv[argv.index(name) + 1]
    return default


PREVIEW = "--preview" in argv
OUT_DIR = os.path.abspath(_arg("--out", os.path.join(HERE, "out")))
SAMPLES = int(_arg("--samples", 16 if PREVIEW else 192))
VARIANT = _arg("--variant", "tier1")
VARIANTS = ("tier1", "tier2", "tier3", "fired")
if VARIANT not in VARIANTS:
    raise SystemExit(f"--variant must be one of {', '.join(VARIANTS)}")
TOD = _arg("--tod", "mid")
if TOD not in ("am", "mid", "pm"):
    raise SystemExit("--tod must be one of am, mid, pm")
if VARIANT == "fired" and TOD != "mid":
    raise SystemExit("--tod does not apply to the fired desk")
# Variants and times of day only change the gameplay view, so they render CAM_main unless asked otherwise.
CAMS = _arg("--cams", "main,wide" if VARIANT == "tier1" and TOD == "mid" else "main").split(",")
SUFFIX = "" if VARIANT == "tier1" else "-" + VARIANT     # desk.png / desk-tier2.png ...
SUFFIX += "" if TOD == "mid" else "-" + TOD               # desk-am.png / desk-tier2-pm.png ...

# ---------------------------------------------------------------------------
# Contract (do not change: the game overlays its UI on the hero screens)
# ---------------------------------------------------------------------------
RES_X, RES_Y = 1080, 1920
SCREEN_W, SCREEN_H = 0.54, 0.32
SCREEN_TOP_C = (0.0, 0.18, 1.36)
SCREEN_BOT_C = (0.0, 0.18, 0.98)
SCREEN_COLOR = "#0B1730"
EXPECTED = {
    "CAM_main": {"HERO_screen_top": (11.0, 89.0, 21.6, 47.6),
                 "HERO_screen_bottom": (11.0, 89.0, 52.4, 78.4), "tol": 0.3},
    "CAM_wide": {"HERO_screen_top": (33.0, 59.4, 46.2, 54.9),
                 "HERO_screen_bottom": (33.2, 59.3, 56.4, 65.0), "tol": 0.5},
}

DESK_H = 0.75
random.seed(20261112)

# ---------------------------------------------------------------------------
# Scene reset
# ---------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "Funded"


def hex_lin(h, a=1.0):
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, a)


COLLS = {}


def coll(name):
    if name not in COLLS:
        c = bpy.data.collections.new(name)
        scene.collection.children.link(c)
        COLLS[name] = c
    return COLLS[name]


# ---------------------------------------------------------------------------
# Node helper
# ---------------------------------------------------------------------------
class NB:
    """Tiny shader-node builder so procedural materials stay readable."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.out = self.node("ShaderNodeOutputMaterial")

    def node(self, t, **props):
        n = self.nt.nodes.new(t)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, sock, val):
        if val is None:
            return
        if isinstance(val, bpy.types.NodeSocket):
            self.nt.links.new(val, sock)
        elif isinstance(val, bpy.types.Node):
            self.nt.links.new(val.outputs[0], sock)
        else:
            if isinstance(val, str):
                val = hex_lin(val)
            sock.default_value = val

    def m(self, op, a, b=None, c=None, clamp=False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.link(n.inputs[0], a)
        if b is not None:
            self.link(n.inputs[1], b)
        if c is not None:
            self.link(n.inputs[2], c)
        return n.outputs[0]

    def mix(self, fac, a, b):
        n = self.node("ShaderNodeMix", data_type="RGBA")
        self.link(n.inputs[0], fac)
        self.link(n.inputs[6], a)
        self.link(n.inputs[7], b)
        return n.outputs[2]

    def add_col(self, a, b):
        n = self.node("ShaderNodeMix", data_type="RGBA", blend_type="ADD")
        n.inputs[0].default_value = 1.0
        self.link(n.inputs[6], a)
        self.link(n.inputs[7], b)
        return n.outputs[2]

    def mul_col(self, a, b):
        n = self.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        n.inputs[0].default_value = 1.0
        self.link(n.inputs[6], a)
        self.link(n.inputs[7], b)
        return n.outputs[2]

    def sep(self, vec):
        n = self.node("ShaderNodeSeparateXYZ")
        self.link(n.inputs[0], vec)
        return n.outputs

    def comb(self, x, y, z):
        n = self.node("ShaderNodeCombineXYZ")
        self.link(n.inputs[0], x)
        self.link(n.inputs[1], y)
        self.link(n.inputs[2], z)
        return n.outputs[0]

    def white(self, w=None, vec=None, dims="1D"):
        n = self.node("ShaderNodeTexWhiteNoise", noise_dimensions=dims)
        if dims == "1D":
            self.link(n.inputs["W"], w)
        else:
            self.link(n.inputs["Vector"], vec)
            if dims == "4D":
                self.link(n.inputs["W"], w)
        return n.outputs

    def noise(self, w=None, vec=None, dims="1D", scale=1.0, detail=2.0):
        n = self.node("ShaderNodeTexNoise", noise_dimensions=dims)
        if dims == "1D":
            self.link(n.inputs["W"], w)
        else:
            self.link(n.inputs["Vector"], vec)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        return n.outputs

    def between(self, x, lo, hi):
        return self.m("MULTIPLY", self.m("GREATER_THAN", x, lo), self.m("LESS_THAN", x, hi))

    def emission(self, color, strength=1.0):
        n = self.node("ShaderNodeEmission")
        self.link(n.inputs[0], color)
        self.link(n.inputs[1], strength)
        return n.outputs[0]

    def principled(self, color, rough=0.5, metal=0.0, spec=0.5, coat=0.0):
        n = self.node("ShaderNodeBsdfPrincipled")
        self.link(n.inputs["Base Color"], color)
        self.link(n.inputs["Roughness"], rough)
        n.inputs["Metallic"].default_value = metal
        n.inputs["Specular IOR Level"].default_value = spec
        n.inputs["Coat Weight"].default_value = coat
        return n.outputs[0]

    def output(self, shader):
        self.link(self.out.inputs[0], shader)


MATS = {}


def mat_basic(name, color, rough=0.5, metal=0.0, spec=0.5, coat=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    nb = NB(m)
    nb.output(nb.principled(color, rough, metal, spec, coat))
    m.diffuse_color = hex_lin(color)
    MATS[name] = m
    return m


def mat_emit(name, color, strength=1.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    nb = NB(m)
    nb.output(nb.emission(color, strength))
    MATS[name] = m
    return m


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------
MESH_CACHE = {}


def box_mesh(sx, sy, sz, bevel=0.0, seg=2):
    key = ("box", round(sx, 4), round(sy, 4), round(sz, 4), round(bevel, 4), seg)
    if key in MESH_CACHE:
        return MESH_CACHE[key]
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    if bevel > 0:
        b = min(bevel, 0.49 * min(sx, sy, sz))
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=b, segments=seg,
                        affect="EDGES", profile=0.5)
        smooth_bm(bm)
    me = bpy.data.meshes.new("box")
    bm.to_mesh(me)
    bm.free()
    MESH_CACHE[key] = me
    return me


def cyl_mesh(r, h, n=24, r2=None):
    key = ("cyl", round(r, 4), round(h, 4), n, r2)
    if key in MESH_CACHE:
        return MESH_CACHE[key]
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=n, radius1=r,
                          radius2=r if r2 is None else r2, depth=h)
    me = bpy.data.meshes.new("cyl")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = len(p.vertices) == 4
    MESH_CACHE[key] = me
    return me


def add_obj(name, mesh, loc, mat=None, rot=(0, 0, 0), collection="Office", parent=None):
    ob = bpy.data.objects.new(name, mesh)
    ob.location = loc
    ob.rotation_euler = rot
    if mat is not None:
        if len(mesh.materials) == 0:
            mesh.materials.append(None)
        ob.material_slots[0].link = "OBJECT"
        ob.material_slots[0].material = mat
    if isinstance(collection, str):
        coll(collection).objects.link(ob)
    else:
        collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def box(name, size, loc, mat, bevel=0.0, rot=(0, 0, 0), collection="Office", seg=2):
    return add_obj(name, box_mesh(*size, bevel=bevel, seg=seg), loc, mat, rot, collection)


def cyl(name, r, h, loc, mat, rot=(0, 0, 0), collection="Office", n=24, r2=None):
    return add_obj(name, cyl_mesh(r, h, n, r2), loc, mat, rot, collection)


def plane_xz(name, w, h, center, mat, collection="Office"):
    """Plane in the XZ plane whose normal faces -Y (toward the cameras)."""
    me = bpy.data.meshes.new(name)
    hw, hh = w / 2, h / 2
    verts = [(-hw, 0, -hh), (hw, 0, -hh), (hw, 0, hh), (-hw, 0, hh)]
    me.from_pydata(verts, [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for i, (u, v) in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[i].uv = (u, v)
    me.update()
    assert me.polygons[0].normal.y < 0
    return add_obj(name, me, center, mat, collection=collection)


def camera_only(ob):
    ob.visible_diffuse = False
    ob.visible_glossy = False
    ob.visible_transmission = False
    ob.visible_volume_scatter = False
    ob.visible_shadow = False


def smooth_bm(bm, angle=40.0):
    """Smooth shading with edges sharper than `angle` kept hard, so bevels catch soft highlights."""
    lim = math.radians(angle)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(0.0) < lim


def bm_mesh(bm, name, smooth=None):
    if smooth is not None:
        smooth_bm(bm, smooth)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def shell_mesh(sx, sy, sz, back_scale=(0.7, 0.65), bevel=0.0, seg=3):
    """Box along Y whose back face (+Y) is scaled down: the tapered back of a monitor."""
    key = ("shell", round(sx, 4), round(sy, 4), round(sz, 4), back_scale, round(bevel, 4))
    if key in MESH_CACHE:
        return MESH_CACHE[key]
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        if v.co.y > 0:
            v.co.x *= back_scale[0]
            v.co.z *= back_scale[1]
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, 0.45 * sy), segments=seg, affect="EDGES", profile=0.5)
    MESH_CACHE[key] = bm_mesh(bm, "shell", 40.0)
    return MESH_CACHE[key]


def wedge_mesh(sx, sy, hf, hb, bevel=0.0, seg=3):
    """Box standing on z = 0 whose height rises from hf at the front (-Y) to hb at the back."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        t = v.co.y + 0.5
        v.co.z = (v.co.z + 0.5) * (hf + (hb - hf) * t)
        v.co.x *= sx
        v.co.y *= sy
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, 0.45 * hf), segments=seg, affect="EDGES", profile=0.5)
    return bm_mesh(bm, "wedge", 40.0)


def rounded_slab_mesh(sx, sy, sz, r, seg=6):
    """Rounded-corner rectangle extruded from z = 0 to sz (desk mat, phone)."""
    bm = bmesh.new()
    pts = []
    for cx, cy, a0 in ((sx / 2 - r, sy / 2 - r, 0), (-sx / 2 + r, sy / 2 - r, 90),
                       (-sx / 2 + r, -sy / 2 + r, 180), (sx / 2 - r, -sy / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append(bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), 0)))
    f = bm.faces.new(pts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in ext["geom"]:
        if isinstance(v, bmesh.types.BMVert):
            v.co.z = sz
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return bm_mesh(bm, "slab", 50.0)


KEY_U = 0.019          # one keyboard unit (key pitch)


def tkl_layout():
    """Tenkeyless layout as (x in units from the left, row from the back, width in units, kind).
    kind: a = alpha, m = modifier, x = lilac accent (Esc, Enter)."""
    keys = []

    def run(row, x, spec):
        for w, kind in spec:
            if kind != "-":
                keys.append((x, row, w, kind))
            x += w

    a1, m1 = (1, "a"), (1, "m")
    run(0, 0, [(1, "x"), (1, "-")] + [a1] * 4 + [(0.5, "-")] + [m1] * 4 + [(0.5, "-")] + [a1] * 4)
    run(1, 0, [a1] * 13 + [(2, "m")])
    run(2, 0, [(1.5, "m")] + [a1] * 12 + [(1.5, "a")])
    run(3, 0, [(1.75, "m")] + [a1] * 11 + [(2.25, "x")])
    run(4, 0, [(2.25, "m")] + [a1] * 10 + [(2.75, "m")])
    run(5, 0, [(1.25, "m")] * 3 + [(6.25, "a")] + [(1.25, "m")] * 4)
    for row in (0, 1, 2, 5):                                # navigation cluster and arrows
        run(row, 15.25, [m1] * 3)
    run(4, 16.25, [m1])
    return keys


def keycaps_mesh():
    """All keycaps as one mesh: tapered, bevelled caps, slightly taller toward the back rows
    (sculpted profile). Material index 0 alpha, 1 modifier, 2 accent."""
    bm = bmesh.new()
    U, gap, inset = KEY_U, 0.0019, 0.0017
    width_u, depth_u = 18.25, 6.5
    kinds = {"a": 0, "m": 1, "x": 2}
    for (x, row, w, kind) in tkl_layout():
        cx = (x + w / 2 - width_u / 2) * U
        cy = (depth_u / 2 - (row + (0.5 if row > 0 else 0)) - 0.5) * U
        hw, hd = (w * U - gap) / 2, (U - gap) / 2
        kh = 0.0078 + 0.0006 * (5 - row) / 5
        res = bmesh.ops.create_cube(bm, size=1.0)
        for v in res["verts"]:
            top = v.co.z > 0
            sx_ = 1 if v.co.x > 0 else -1
            sy_ = 1 if v.co.y > 0 else -1
            v.co.x = cx + sx_ * (hw - (inset if top else 0))
            v.co.y = cy + sy_ * (hd - (inset if top else 0)) + (0.0006 if top else 0)
            v.co.z = kh if top else 0.0
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.material_index = kinds[kind]
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.0009, segments=2, affect="EDGES", profile=0.5)
    return bm_mesh(bm, "keycaps", 45.0)


MOUSE_L, MOUSE_W, MOUSE_HT = 0.116, 0.062, 0.034


def MOUSE_H(yn):
    """Height of the mouse shell at yn (-1 back .. 1 front), matching mouse_mesh()."""
    return (math.sqrt(max(0.0, 1 - yn * yn)) + 0.25) / 1.25 * MOUSE_HT * (0.9 - 0.2 * yn)


def mouse_mesh():
    """Ergonomic mouse: a flattened ellipsoid with its hump toward the palm and a narrower nose."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=18, radius=1.0)
    for v in bm.verts:
        x, yn, z = v.co
        z = max(z, -0.25) + 0.25
        v.co.x = x * MOUSE_W / 2 * (1 - 0.1 * yn)
        v.co.y = yn * MOUSE_L / 2
        v.co.z = z / 1.25 * MOUSE_HT * (0.9 - 0.2 * yn)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
    return bm_mesh(bm, "mouse", 80.0)


def leaf_mesh():
    """Unit ellipsoid used for leaves (scaled per instance)."""
    if "leaf" in MESH_CACHE:
        return MESH_CACHE["leaf"]
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
    MESH_CACHE["leaf"] = bm_mesh(bm, "leaf_blade", 180.0)
    return MESH_CACHE["leaf"]


def area_light(name, size, loc, target, energy, color):
    """Rectangular area light aimed at `target`, hidden from camera rays."""
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = size
    ld.energy = energy
    ld.color = hex_lin(color)[:3]
    lo = bpy.data.objects.new(name, ld)
    lo.location = loc
    lo.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    lo.visible_camera = False
    coll("Lights").objects.link(lo)
    return lo


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
def make_carpet():
    m = bpy.data.materials.new("carpet")
    nb = NB(m)
    tc = nb.node("ShaderNodeTexCoord")
    n = nb.noise(vec=tc.outputs["Object"], dims="3D", scale=40.0, detail=4.0)
    n2 = nb.noise(vec=tc.outputs["Object"], dims="3D", scale=1.2, detail=2.0)
    col = nb.mix(nb.m("MULTIPLY", n[0], 0.7), "#1b2a45", "#2a3d5e")
    col = nb.mix(nb.m("MULTIPLY", n2[0], 0.5), col, "#22345a")
    nb.output(nb.principled(col, 0.95, spec=0.2))
    return m


def make_screen_hero():
    # Flat, evenly lit dark navy: pure emission, no reflection, no gradient.
    m = bpy.data.materials.new("hero_screen")
    nb = NB(m)
    nb.output(nb.emission(SCREEN_COLOR, 1.0))
    return m


def make_trading_screen(name="bg_screen", strength=0.85):
    """Procedural trading screen: candles or a line chart, plus an order-book strip."""
    m = bpy.data.materials.new(name)
    nb = NB(m)
    tc = nb.node("ShaderNodeTexCoord")
    oi = nb.node("ShaderNodeObjectInfo")
    uvs = nb.sep(tc.outputs["UV"])
    u, v = uvs[0], uvs[1]
    seed = nb.m("MULTIPLY", oi.outputs["Random"], 97.0)

    green, red, lilac = "#2FBF71", "#E5484D", "#B48CE8"
    base = "#0c1a33"

    chart_u = nb.m("DIVIDE", u, 0.70)                       # chart occupies u<0.70
    in_chart = nb.m("LESS_THAN", u, 0.70)
    in_body = nb.m("MULTIPLY", in_chart, nb.between(v, 0.08, 0.86))

    # --- candles
    N = 22.0
    cu = nb.m("MULTIPLY", chart_u, N)
    col_i = nb.m("FLOOR", cu)
    fu = nb.m("FRACT", cu)
    trend = nb.noise(w=nb.m("ADD", nb.m("MULTIPLY", col_i, 0.09), seed), dims="1D", scale=1.0, detail=1.0)[0]
    center = nb.m("ADD", 0.12, nb.m("MULTIPLY", nb.m("SUBTRACT", trend, 0.25), 1.2))
    center = nb.m("MINIMUM", nb.m("MAXIMUM", center, 0.2), 0.75)
    rnd = nb.white(w=nb.m("ADD", col_i, seed))
    hh = nb.m("ADD", 0.015, nb.m("MULTIPLY", rnd[0], 0.06))
    up = nb.m("GREATER_THAN", nb.white(w=nb.m("ADD", nb.m("MULTIPLY", col_i, 1.37), nb.m("MULTIPLY", seed, 3.1)))[0], 0.42)
    dv = nb.m("ABSOLUTE", nb.m("SUBTRACT", v, center))
    body = nb.m("MULTIPLY", nb.m("LESS_THAN", dv, hh), nb.between(fu, 0.22, 0.78))
    wick = nb.m("MULTIPLY", nb.m("LESS_THAN", dv, nb.m("MULTIPLY", hh, 1.9)),
                nb.m("LESS_THAN", nb.m("ABSOLUTE", nb.m("SUBTRACT", fu, 0.5)), 0.07))
    candle = nb.m("MULTIPLY", nb.m("MAXIMUM", body, wick), in_body)
    candle_col = nb.mix(up, red, green)

    # --- line chart (alternative layout)
    ln = nb.noise(w=nb.m("ADD", nb.m("MULTIPLY", chart_u, 2.2), seed), dims="1D", scale=1.0, detail=3.0)[0]
    lc = nb.m("ADD", 0.45, nb.m("MULTIPLY", nb.m("SUBTRACT", ln, 0.5), 1.4))
    line = nb.m("MULTIPLY", nb.m("LESS_THAN", nb.m("ABSOLUTE", nb.m("SUBTRACT", v, lc)), 0.012), in_body)
    fill = nb.m("MULTIPLY", nb.m("LESS_THAN", v, lc), in_body)
    fill = nb.m("MULTIPLY", fill, nb.m("MULTIPLY", v, 0.16))
    line_up = nb.m("GREATER_THAN", nb.white(w=nb.m("ADD", seed, 5.0))[0], 0.4)
    line_col = nb.mix(line_up, red, green)

    use_line = nb.m("GREATER_THAN", oi.outputs["Random"], 0.62)

    # --- grid
    gx = nb.m("LESS_THAN", nb.m("FRACT", nb.m("MULTIPLY", chart_u, 6.0)), 0.025)
    gy = nb.m("LESS_THAN", nb.m("FRACT", nb.m("MULTIPLY", v, 5.0)), 0.035)
    grid = nb.m("MULTIPLY", nb.m("MAXIMUM", gx, gy), in_body)

    # --- order book strip on the right
    rows = nb.m("FLOOR", nb.m("MULTIPLY", v, 16.0))
    fr = nb.m("FRACT", nb.m("MULTIPLY", v, 16.0))
    blen = nb.m("ADD", 0.2, nb.m("MULTIPLY", nb.white(w=nb.m("ADD", rows, nb.m("MULTIPLY", seed, 2.0)))[0], 0.75))
    bu = nb.m("DIVIDE", nb.m("SUBTRACT", u, 0.74), 0.23)
    bar = nb.m("MULTIPLY", nb.m("LESS_THAN", bu, blen), nb.m("GREATER_THAN", bu, 0.0))
    bar = nb.m("MULTIPLY", bar, nb.between(fr, 0.2, 0.8))
    bar = nb.m("MULTIPLY", bar, nb.between(v, 0.08, 0.86))
    bar_col = nb.mix(nb.m("GREATER_THAN", v, 0.47), green, red)

    # header bar
    header = nb.m("GREATER_THAN", v, 0.91)

    col = nb.mix(nb.m("MULTIPLY", grid, 0.6), base, "#1a2a48")
    col = nb.mix(nb.m("MULTIPLY", header, 0.8), col, "#1e3054")
    col = nb.mix(nb.m("MULTIPLY", bar, 0.45), col, bar_col)
    chart_c = nb.mix(candle, col, candle_col)
    chart_l = nb.mix(fill, col, line_col)
    chart_l = nb.mix(line, chart_l, line_col)
    col = nb.mix(use_line, chart_c, chart_l)
    # small lilac accent tick on the header
    acc = nb.m("MULTIPLY", header, nb.between(u, 0.04, 0.12))
    col = nb.mix(nb.m("MULTIPLY", acc, 0.8), col, lilac)
    nb.output(nb.emission(col, strength))
    return m


def make_tower(name="tower", lit_base=0.80, haze_col="#b9c8dc", tones=("#24354f", "#3f5274"),
               glass_cols=("#1c2a42", "#3d5273"), haze_start=50.0, haze_len=240.0):
    """Unlit stylised tower facade with a procedural window grid and depth haze."""
    m = bpy.data.materials.new(name)
    nb = NB(m)
    geo = nb.node("ShaderNodeNewGeometry")
    oi = nb.node("ShaderNodeObjectInfo")
    cam = nb.node("ShaderNodeCameraData")
    P = nb.sep(geo.outputs["Position"])
    Nn = nb.sep(geo.outputs["Normal"])
    rnd = oi.outputs["Random"]
    seed = nb.m("MULTIPLY", rnd, 113.0)

    # facade coordinate (towers are axis aligned)
    hcoord = nb.m("ADD", P[0], P[1])
    floor_h = nb.m("ADD", 2.0, nb.m("MULTIPLY", rnd, 0.5))
    bay_w = nb.m("ADD", 1.0, nb.m("MULTIPLY", nb.white(w=nb.m("ADD", seed, 3.3))[0], 0.7))
    fz = nb.m("DIVIDE", P[2], floor_h)
    fh = nb.m("DIVIDE", hcoord, bay_w)
    cz, ch = nb.m("FLOOR", fz), nb.m("FLOOR", fh)
    rz, rh = nb.m("FRACT", fz), nb.m("FRACT", fh)
    ribbon = nb.m("GREATER_THAN", nb.white(w=nb.m("ADD", seed, 9.1))[0], 0.65)
    win_h = nb.m("MAXIMUM", nb.between(rh, 0.14, 0.86), ribbon)
    win = nb.m("MULTIPLY", win_h, nb.between(rz, 0.28, 0.86))
    vertical = nb.m("LESS_THAN", nb.m("ABSOLUTE", Nn[2]), 0.5)
    win = nb.m("MULTIPLY", win, vertical)

    cell = nb.white(vec=nb.comb(ch, cz, seed), dims="3D")
    lit_thr = nb.m("ADD", lit_base, nb.m("MULTIPLY", nb.white(w=nb.m("ADD", seed, 1.7))[0], 0.12))
    lit = nb.m("GREATER_THAN", cell[0], lit_thr)
    warm = nb.m("GREATER_THAN", nb.sep(cell[1])[0], 0.45)
    lit_col = nb.mix(warm, "#dfe9ff", "#ffc77a")

    # facade tone: per-tower slate, simple directional facet shading
    tone = nb.mix(rnd, tones[0], tones[1])
    shade = nb.m("ADD", 0.82, nb.m("MULTIPLY", Nn[0], 0.22))
    shade = nb.m("ADD", shade, nb.m("MULTIPLY", nb.m("MAXIMUM", Nn[2], 0.0), 0.15))
    facade = nb.mix(nb.m("SUBTRACT", 1.0, shade), tone, "#0d1524")
    # dark glass with a faint sky reflection rising with height
    glass = nb.mix(nb.m("MULTIPLY", rz, 0.7), glass_cols[0], glass_cols[1])
    col = nb.mix(win, facade, glass)
    col = nb.mix(nb.m("MULTIPLY", win, lit), col, nb.mul_col(lit_col, (1.8, 1.8, 1.8, 1)))

    # atmospheric haze by camera distance, stronger low down
    d = cam.outputs["View Distance"]
    haze = nb.m("SUBTRACT", 1.0, nb.m("EXPONENT", nb.m("DIVIDE", nb.m("MAXIMUM", nb.m("SUBTRACT", d, haze_start), 0.0), -haze_len)))
    low = nb.m("MULTIPLY", nb.m("MINIMUM", nb.m("MAXIMUM", nb.m("DIVIDE", P[2], -140.0), 0.0), 1.0), 0.35)
    haze = nb.m("MINIMUM", nb.m("ADD", haze, low), 0.97)
    col = nb.mix(haze, col, haze_col)
    nb.output(nb.emission(col, 1.0))
    return m


DAY_SKY = [(0.0, "#b4c3d8"), (0.35, "#5f7fae"), (0.04, "#d9d4d6"), (0.12, "#a9bcd7")]


def make_world(sky=DAY_SKY, amb_col="#6d84a8", amb_str=0.26):
    w = bpy.data.worlds.new("World")
    scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(sep.outputs[2], ramp.inputs[0])
    els = ramp.color_ramp.elements
    # (position, colour) stops; the day sky has a faint warm band at the horizon
    for k, (pos, col) in enumerate(sky):
        e = els[k] if k < 2 else els.new(pos)
        e.position = pos
        e.color = hex_lin(col)
    sky = nt.nodes.new("ShaderNodeBackground")
    nt.links.new(ramp.outputs[0], sky.inputs[0])
    sky.inputs[1].default_value = 1.0
    amb = nt.nodes.new("ShaderNodeBackground")
    amb.inputs[0].default_value = hex_lin(amb_col)
    amb.inputs[1].default_value = amb_str
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(amb.outputs[0], mix.inputs[1])
    nt.links.new(sky.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])


def make_glass():
    m = bpy.data.materials.new("window_glass")
    nb = NB(m)
    t = nb.node("ShaderNodeBsdfTransparent")
    t.inputs[0].default_value = hex_lin("#e4edf8")
    nb.output(t.outputs[0])
    return m


def make_partition_fabric(name, color, weave=True):
    """Woven panel fabric: a basket weave in bump and tone (hero panels) over a heathered colour."""
    m = bpy.data.materials.new(name)
    nb = NB(m)
    tc = nb.node("ShaderNodeTexCoord")
    o = nb.sep(tc.outputs["Object"])
    n = nb.noise(vec=tc.outputs["Object"], dims="3D", scale=120.0, detail=2.0)
    blot = nb.noise(vec=tc.outputs["Object"], dims="3D", scale=6.0, detail=2.0)
    col = nb.mix(nb.m("MULTIPLY", n[0], 0.35), color, "#5d78a0")
    col = nb.mix(nb.m("MULTIPLY", blot[0], 0.25), col, "#33486b")
    if not weave:
        nb.output(nb.principled(col, 0.95, spec=0.15))
        return m
    p = 0.0032                                              # thread pitch (m)
    h = nb.m("DIVIDE", nb.m("ADD", o[0], o[1]), p)          # panels are axis aligned
    v = nb.m("DIVIDE", o[2], p)
    over = nb.m("MODULO", nb.m("ADD", nb.m("FLOOR", h), nb.m("FLOOR", v)), 2.0)
    warp = nb.m("SINE", nb.m("MULTIPLY", nb.m("FRACT", h), math.pi))
    weft = nb.m("SINE", nb.m("MULTIPLY", nb.m("FRACT", v), math.pi))
    height = nb.mix(over, weft, warp)
    thread = nb.white(vec=nb.comb(nb.m("FLOOR", h), nb.m("FLOOR", v), 0.0), dims="3D")[0]
    col = nb.mix(nb.m("MULTIPLY", thread, 0.18), col, "#7d93b8")
    col = nb.mul_col(col, nb.mix(height, (0.78, 0.78, 0.82, 1), (1, 1, 1, 1)))
    bump = nb.node("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.0008
    nb.link(bump.inputs["Height"], height)
    bsdf = nb.node("ShaderNodeBsdfPrincipled")
    nb.link(bsdf.inputs["Base Color"], col)
    bsdf.inputs["Roughness"].default_value = 0.95
    bsdf.inputs["Specular IOR Level"].default_value = 0.15
    bsdf.inputs["Sheen Weight"].default_value = 0.4
    nb.link(bsdf.inputs["Normal"], bump.outputs[0])
    nb.output(bsdf.outputs[0])
    return m


def make_wood(name, light, dark, rough=0.38, coat=0.25, ring_scale=7.0):
    """Laminate / veneer: long grain running along X with figure, fine pores and a little
    roughness variation (the desk tops)."""
    m = bpy.data.materials.new(name)
    nb = NB(m)
    tc = nb.node("ShaderNodeTexCoord")
    o = nb.sep(tc.outputs["Object"])
    stretched = nb.comb(nb.m("MULTIPLY", o[0], 0.22), o[1], o[2])
    wave = nb.node("ShaderNodeTexWave", wave_type="BANDS", bands_direction="Y", wave_profile="SIN")
    nb.link(wave.inputs["Vector"], stretched)
    wave.inputs["Scale"].default_value = ring_scale
    wave.inputs["Distortion"].default_value = 7.0
    wave.inputs["Detail"].default_value = 3.0
    wave.inputs["Detail Scale"].default_value = 1.4
    figure = wave.outputs["Fac"]
    pores = nb.noise(vec=nb.comb(nb.m("MULTIPLY", o[0], 0.05), nb.m("MULTIPLY", o[1], 1.0), o[2]),
                     dims="3D", scale=420.0, detail=1.0)[0]
    planks = nb.noise(vec=nb.comb(nb.m("MULTIPLY", o[0], 0.3), o[1], o[2]), dims="3D", scale=4.0, detail=1.0)[0]
    g = nb.m("ADD", nb.m("MULTIPLY", figure, 0.75), nb.m("MULTIPLY", planks, 0.25))
    col = nb.mix(nb.m("POWER", g, 1.4), light, dark)
    col = nb.mix(nb.m("MULTIPLY", nb.m("GREATER_THAN", pores, 0.62), 0.35), col, dark)
    r = nb.m("ADD", rough, nb.m("MULTIPLY", nb.m("SUBTRACT", g, 0.5), 0.12))
    bump = nb.node("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    bump.inputs["Distance"].default_value = 0.0004
    nb.link(bump.inputs["Height"], nb.m("ADD", nb.m("MULTIPLY", figure, 0.4), nb.m("MULTIPLY", pores, 0.6)))
    bsdf = nb.node("ShaderNodeBsdfPrincipled")
    nb.link(bsdf.inputs["Base Color"], col)
    nb.link(bsdf.inputs["Roughness"], r)
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = 0.12
    nb.link(bsdf.inputs["Normal"], bump.outputs[0])
    nb.output(bsdf.outputs[0])
    m.diffuse_color = hex_lin(light)
    return m


def make_stone(name, base, fleck, rough=0.28, coat=0.5):
    """Dark engineered stone: fine light flecks and soft cloudy veins (tier3 desk)."""
    m = bpy.data.materials.new(name)
    nb = NB(m)
    tc = nb.node("ShaderNodeTexCoord")
    fine = nb.noise(vec=tc.outputs["Object"], dims="3D", scale=900.0, detail=0.0)[0]
    cloud = nb.noise(vec=tc.outputs["Object"], dims="3D", scale=5.0, detail=5.0)[0]
    col = nb.mix(nb.m("MULTIPLY", cloud, 0.5), base, "#353a46")
    col = nb.mix(nb.m("GREATER_THAN", fine, 0.72), col, fleck)
    r = nb.m("ADD", rough, nb.m("MULTIPLY", cloud, 0.08))
    nb.output(nb.principled(col, r, coat=coat))
    return m


def make_alu(name="alu", color="#c4cbd6", rough=0.26):
    """Satin aluminium with faint brushing along X (partition caps, posts, pulls)."""
    m = bpy.data.materials.new(name)
    nb = NB(m)
    tc = nb.node("ShaderNodeTexCoord")
    o = nb.sep(tc.outputs["Object"])
    brush = nb.noise(vec=nb.comb(nb.m("MULTIPLY", o[0], 0.02), o[1], o[2]), dims="3D", scale=600.0, detail=2.0)[0]
    r = nb.m("ADD", rough, nb.m("MULTIPLY", nb.m("SUBTRACT", brush, 0.5), 0.12))
    nb.output(nb.principled(color, r, metal=1.0))
    return m


def make_kb_plate():
    """Dark keyboard plate with a faint lilac backlight that shows between the keycaps."""
    m = bpy.data.materials.new("kb_glow")
    nb = NB(m)
    bsdf = nb.principled("#11151d", 0.4)
    em = nb.emission("#B48CE8", 0.16)
    add = nb.node("ShaderNodeAddShader")
    nb.link(add.inputs[0], bsdf)
    nb.link(add.inputs[1], em)
    nb.output(add.outputs[0])
    return m


DESK_MAT = (0.80, 0.31)


def make_desk_mat(sx, sy):
    """Navy felt desk mat with a rolled, stitched edge. Object space: centred, top at z = 0.003."""
    m = bpy.data.materials.new("desk_mat")
    nb = NB(m)
    tc = nb.node("ShaderNodeTexCoord")
    o = nb.sep(tc.outputs["Object"])
    dx = nb.m("SUBTRACT", sx / 2, nb.m("ABSOLUTE", o[0]))
    dy = nb.m("SUBTRACT", sy / 2, nb.m("ABSOLUTE", o[1]))
    d = nb.m("MINIMUM", dx, dy)
    along = nb.m("ADD", o[0], nb.m("MULTIPLY", nb.m("LESS_THAN", dx, dy), nb.m("SUBTRACT", o[1], o[0])))
    dash = nb.m("LESS_THAN", nb.m("FRACT", nb.m("DIVIDE", along, 0.0055)), 0.62)
    stitch = nb.m("MULTIPLY", nb.between(d, 0.0055, 0.0072), dash)
    rim = nb.m("LESS_THAN", d, 0.0035)
    felt = nb.noise(vec=tc.outputs["Object"], dims="3D", scale=700.0, detail=2.0)[0]
    col = nb.mix(nb.m("MULTIPLY", felt, 0.35), "#141b2a", "#1f283b")
    col = nb.mix(nb.m("MULTIPLY", rim, 0.8), col, "#121826")
    col = nb.mix(stitch, col, "#8d98ad")
    bump = nb.node("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    bump.inputs["Distance"].default_value = 0.0005
    nb.link(bump.inputs["Height"], nb.m("ADD", nb.m("MULTIPLY", felt, 0.6), nb.m("MULTIPLY", stitch, 0.8)))
    bsdf = nb.node("ShaderNodeBsdfPrincipled")
    nb.link(bsdf.inputs["Base Color"], col)
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Specular IOR Level"].default_value = 0.2
    bsdf.inputs["Sheen Weight"].default_value = 0.12
    nb.link(bsdf.inputs["Normal"], bump.outputs[0])
    nb.output(bsdf.outputs[0])
    return m


M = {}


def build_materials():
    M["carpet"] = make_carpet()
    M["hero_screen"] = make_screen_hero()
    M["bg_screen"] = make_trading_screen()
    M["tower"] = make_tower()
    M["glass"] = make_glass()
    M["fabric"] = make_partition_fabric("fabric_blue", "#3d5880", weave=False)
    M["fabric_hero"] = make_partition_fabric("fabric_hero", "#45628c")
    M["alu"] = make_alu()
    M["ceiling"] = mat_basic("ceiling", "#9cabc2", 0.85)
    M["wall"] = mat_basic("wall", "#7389ab", 0.8)
    M["pillar"] = mat_basic("pillar", "#7b8fb0", 0.7)
    M["skirting"] = mat_basic("skirting", "#2b3850", 0.6)
    M["desk_top"] = mat_basic("desk_top", "#b7c2d3", 0.4, coat=0.15)         # background desks
    M["hero_top"] = make_wood("hero_top", "#aaa297", "#968b7c", rough=0.5, coat=0.05, ring_scale=16.0)
    M["edge_band"] = mat_basic("edge_band", "#2b3240", 0.35, coat=0.3)
    M["desk_edge"] = mat_basic("desk_edge", "#9aa8bd", 0.5)
    M["metal"] = mat_basic("metal", "#a9b4c4", 0.35, metal=0.6)
    M["dark_metal"] = mat_basic("dark_metal", "#1c2333", 0.35, metal=0.4)
    M["trim"] = mat_basic("trim", "#b9c4d4", 0.5)
    M["housing"] = mat_basic("housing", "#0a0e16", 0.55, spec=0.3)
    M["bezel"] = mat_basic("bezel", "#0b0e14", 0.28, spec=0.5, coat=0.3)        # monitor front frame
    M["shell"] = mat_basic("shell", "#2a303b", 0.32, metal=0.55)               # anodised back shell
    M["stand"] = mat_basic("stand", "#a3abb8", 0.3, metal=0.85)                # satin silver arms
    M["cable"] = mat_basic("cable", "#0e1118", 0.5)
    M["led"] = mat_emit("led", "#2FBF71", 3.0)
    M["mullion"] = mat_basic("mullion", "#2a3447", 0.45, metal=0.3)
    M["kb"] = mat_basic("kb", "#161c28", 0.45)
    M["kb_case"] = mat_basic("kb_case", "#2a303c", 0.3, metal=0.6)
    M["key_alpha"] = mat_basic("key_alpha", "#1c222e", 0.42, spec=0.4)
    M["key_mod"] = mat_basic("key_mod", "#3a4357", 0.42, spec=0.4)
    M["key_accent"] = mat_basic("key_accent", "#B48CE8", 0.4)
    M["kb_glow"] = make_kb_plate()
    M["mouse"] = mat_basic("mouse", "#1d2432", 0.32, coat=0.4)
    M["desk_mat"] = make_desk_mat(*DESK_MAT)
    M["mug"] = mat_basic("mug", "#eef1f5", 0.25, coat=0.3)
    M["mug_band"] = mat_basic("mug_band", "#B48CE8", 0.35)
    M["coffee"] = mat_basic("coffee", "#3a2416", 0.15)
    M["paper"] = mat_basic("paper", "#f2f4f7", 0.75)
    M["paper2"] = mat_basic("paper2", "#e6ebf2", 0.75)
    M["sticky_y"] = mat_basic("sticky_y", "#f3d55b", 0.7)
    M["sticky_p"] = mat_basic("sticky_p", "#ef9cc4", 0.7)
    M["sticky_g"] = mat_basic("sticky_g", "#8fe0b0", 0.7)
    M["chair"] = mat_basic("chair", "#1d2535", 0.85, spec=0.3)
    M["chair_mesh"] = mat_basic("chair_mesh", "#283349", 0.9, spec=0.2)
    M["plant_pot"] = mat_basic("plant_pot", "#e8ecf2", 0.5)
    M["leaf"] = mat_basic("leaf", "#3f8f62", 0.6)
    M["lamp"] = mat_basic("lamp", "#2a3345", 0.4, metal=0.3)
    M["lamp_glow"] = mat_emit("lamp_glow", "#ffd29a", 4.0)
    M["panel"] = mat_emit("ceiling_panel", "#f4f8ff", 1.6)
    M["phone"] = mat_basic("phone", "#1a2130", 0.3)
    M["phone_scr"] = mat_emit("phone_scr", "#22365a", 0.8)
    M["phone_glass"] = mat_basic("phone_glass", "#07090d", 0.08, coat=1.0)
    M["soil"] = mat_basic("soil", "#2b2119", 0.95)
    M["binder"] = mat_basic("binder", "#5b7bb0", 0.6)
    M["binder2"] = mat_basic("binder2", "#2f4166", 0.6)


# ---------------------------------------------------------------------------
# Room
# ---------------------------------------------------------------------------
ROOM_X = 8.5
ROOM_Y0, ROOM_Y1 = -6.0, 9.5
CEIL = 3.0


def build_room(Y1=ROOM_Y1, pillar=True):
    """Office shell. Y1 is the window wall (tier3 brings it right up behind the hero desk)."""
    box("floor", (2 * ROOM_X, Y1 - ROOM_Y0, 0.1), (0, (ROOM_Y0 + Y1) / 2, -0.05), M["carpet"])
    box("ceiling", (2 * ROOM_X, Y1 - ROOM_Y0, 0.1), (0, (ROOM_Y0 + Y1) / 2, CEIL + 0.05), M["ceiling"])
    for sx in (-1, 1):
        box("wall_side", (0.2, Y1 - ROOM_Y0, CEIL), (sx * (ROOM_X + 0.1), (ROOM_Y0 + Y1) / 2, CEIL / 2), M["wall"])
    box("wall_back", (2 * ROOM_X, 0.2, CEIL), (0, ROOM_Y0 - 0.1, CEIL / 2), M["wall"])

    # ceiling grid lines (stylised tiles)
    for i in range(-7, 8):
        b = box("ceil_grid", (0.025, Y1 - ROOM_Y0, 0.01), (i * 1.2, (ROOM_Y0 + Y1) / 2, CEIL - 0.004), M["trim"])
    for j in range(int((Y1 - ROOM_Y0) / 1.2) + 1):
        box("ceil_grid", (2 * ROOM_X, 0.025, 0.01), (0, ROOM_Y0 + j * 1.2, CEIL - 0.004), M["trim"])

    # window wall: glass, mullions, sill, soffit beam
    wy = Y1
    g = plane_xz("window_glass", 2 * ROOM_X, CEIL, (0, wy + 0.02, CEIL / 2), M["glass"])
    g.visible_shadow = False
    box("sill", (2 * ROOM_X, 0.35, 0.22), (0, wy - 0.1, 0.11), M["skirting"])
    box("soffit", (2 * ROOM_X, 0.6, 0.28), (0, wy - 0.25, CEIL - 0.14), M["ceiling"])
    box("transom", (2 * ROOM_X, 0.08, 0.06), (0, wy, 2.35), M["mullion"])
    x = -ROOM_X
    while x <= ROOM_X + 0.01:
        box("mullion", (0.08, 0.14, CEIL), (x, wy, CEIL / 2), M["mullion"])
        x += 1.6

    # big square pillar
    px, py, ps = 0.95, 3.0, 0.9
    if pillar:
        box("pillar", (ps, ps, CEIL), (px, py, CEIL / 2), M["pillar"], bevel=0.02)
        box("pillar_base", (ps + 0.03, ps + 0.03, 0.1), (px, py, 0.05), M["skirting"])

    # ceiling light panels (camera-visible emitters) + area lights doing the lighting
    lc = coll("Lights")
    for ix in (-6.0, -3.6, -1.2, 1.2, 3.6, 6.0):
        for iy in (-3.2, -0.8, 1.6, 4.0, 6.4, 8.4):
            if iy > Y1 - 0.4:
                continue
            p = box("light_panel", (1.2, 0.6, 0.02), (ix, iy, CEIL - 0.012), M["panel"])
            camera_only(p)
            box("light_frame", (1.26, 0.66, 0.012), (ix, iy, CEIL - 0.004), M["trim"])
            ld = bpy.data.lights.new("panel", "AREA")
            ld.shape = "RECTANGLE"
            ld.size, ld.size_y = 1.2, 0.6
            ld.energy = 32.0
            ld.color = hex_lin("#eaf1ff")[:3]
            lo = bpy.data.objects.new("panel_light", ld)
            lo.location = (ix, iy, CEIL - 0.03)
            lc.objects.link(lo)

    # daylight coming through the window wall
    ld = bpy.data.lights.new("window_fill", "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = 2 * ROOM_X, CEIL * 0.9
    ld.energy = 900.0
    ld.color = hex_lin("#c7d6ee")[:3]
    lo = bpy.data.objects.new("window_fill", ld)
    lo.visible_camera = False
    lo.visible_glossy = False
    lo.location = (0, wy - 0.3, CEIL / 2)
    lo.rotation_euler = (math.radians(-90), 0, 0)
    lc.objects.link(lo)


# ---------------------------------------------------------------------------
# Furniture
# ---------------------------------------------------------------------------
def build_chair_source():
    """Office chair at origin, facing -Y (the sitter looks toward +Y)."""
    c = bpy.data.collections.new("chair_src")
    scene.collection.children.link(c)
    COLLS["chair_src"] = c
    ch, mm, mt = M["chair"], M["chair_mesh"], M["dark_metal"]
    box("seat", (0.5, 0.48, 0.08), (0, 0, 0.47), ch, bevel=0.03, collection=c)
    box("back", (0.46, 0.06, 0.44), (0, -0.27, 0.76), mm, bevel=0.03, rot=(math.radians(-8), 0, 0), collection=c)
    box("back_frame", (0.05, 0.04, 0.3), (0, -0.28, 0.48), mt, collection=c)
    for sx in (-1, 1):
        box("arm_post", (0.03, 0.04, 0.18), (sx * 0.26, -0.02, 0.6), mt, collection=c)
        box("arm_pad", (0.06, 0.24, 0.03), (sx * 0.26, 0.0, 0.69), ch, bevel=0.012, collection=c)
    cyl("gas", 0.025, 0.3, (0, 0, 0.29), M["metal"], collection=c)
    for k in range(5):
        a = k * 2 * math.pi / 5
        box("leg", (0.04, 0.3, 0.035), (math.sin(a) * 0.15, math.cos(a) * 0.15, 0.09), mt,
            rot=(0, 0, -a), collection=c)
        cyl("caster", 0.028, 0.03, (math.sin(a) * 0.3, math.cos(a) * 0.3, 0.035), mt,
            rot=(0, math.radians(90), -a), collection=c, n=12)
    vl = bpy.context.view_layer.layer_collection.children["chair_src"]
    vl.exclude = True
    return c


def chair_instance(name, loc, rot_z, src, collection="Office"):
    e = bpy.data.objects.new(name, None)
    e.instance_type = "COLLECTION"
    e.instance_collection = src
    e.location = loc
    e.rotation_euler = (0, 0, rot_z)
    coll(collection).objects.link(e)
    return e


def monitor(name, center, w, h, screen_mat, collection="Office", bezel=0.008, chin=0.016, parent=None):
    """Thin-bezel monitor whose front face sits just behind a screen plane at `center`
    (in the parent's space when `parent` is given): a chamfered front frame with a small,
    logo-free chin, a tapered back shell and a VESA boss. Meshes are cached, so the
    background monitors cost almost nothing."""
    x, y, z = center
    fw, fh, fd = w + 2 * bezel, h + bezel + chin, 0.011
    zc = z + (bezel - chin) / 2
    frame = add_obj(name + "_frame", box_mesh(fw, fd, fh, bevel=0.0035, seg=3),
                    (x, y + 0.0008 + fd / 2, zc), M["bezel"], collection=collection)
    sd = 0.034
    shell = add_obj(name + "_shell", shell_mesh(fw - 0.014, sd, fh - 0.014, (0.66, 0.62), bevel=0.009),
                    (x, y + fd - 0.002 + sd / 2, zc), M["shell"], collection=collection)
    boss = add_obj(name + "_vesa", box_mesh(0.105, 0.012, 0.105, bevel=0.003),
                   (x, y + fd + sd - 0.003, z), M["shell"], collection=collection)
    scr = plane_xz(name, w, h, (x, y, z), screen_mat, collection=collection)
    if parent is not None:
        for ob in (frame, shell, boss, scr):
            ob.parent = parent
    return scr


def bar_between(name, p0, p1, size, mat, collection):
    """Rounded bar from p0 to p1 (a monitor-arm segment); size is (width, height)."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    rot = d.to_track_quat("Y", "Z").to_euler()
    return box(name, (size[0], d.length + size[0] * 0.6, size[1]), (a + b) / 2, mat,
               bevel=min(size) * 0.45, seg=3, rot=rot, collection=collection)


def build_monitor_stand(C):
    """Dual-monitor pole stand: a clamp on the back edge of the desk, a round pole and two
    gas-spring arms. The top arm leaves its collar at eye level, so it shows in the gap
    between the screens; the rest hides behind the monitors."""
    st, sh = M["stand"], M["shell"]
    py, top_z = 0.355, 1.47
    cyl("stand_pole", 0.019, top_z - DESK_H, (0, py, (top_z + DESK_H) / 2), st, collection=C, n=32)
    cyl("stand_cap", 0.021, 0.012, (0, py, top_z + 0.006), sh, collection=C, n=32)
    cyl("stand_cable", 0.0045, 1.36 - DESK_H, (0.027, py + 0.012, (1.36 + DESK_H) / 2), M["cable"], collection=C, n=10)
    # clamp around the back edge of the desk (desk top 0.71 to 0.75, back edge at y = 0.40)
    box("clamp_top", (0.075, 0.09, 0.014), (0, 0.372, DESK_H + 0.007), st, bevel=0.004, collection=C)
    box("clamp_spine", (0.075, 0.016, 0.085), (0, 0.409, DESK_H - 0.028), st, bevel=0.004, collection=C)
    box("clamp_jaw", (0.075, 0.07, 0.012), (0, 0.38, DESK_H - 0.064), st, bevel=0.003, collection=C)
    cyl("clamp_knob", 0.018, 0.012, (0, 0.375, DESK_H - 0.08), sh, collection=C, n=20)

    head_y = SCREEN_TOP_C[1] + 0.011 + 0.034 + 0.012          # just behind the VESA boss
    for zc, z0, sx in ((SCREEN_TOP_C[2], 1.168, 1), (SCREEN_BOT_C[2], SCREEN_BOT_C[2], -1)):
        cyl("arm_collar", 0.027, 0.04, (0, py, z0), sh, collection=C, n=32)
        elbow = (sx * 0.12, 0.30, (z0 + zc) / 2 + (0.03 if z0 < zc else 0.0))
        bar_between("arm_upper", (sx * 0.012, py - 0.012, z0), elbow, (0.034, 0.03), st, C)
        cyl("arm_elbow", 0.018, 0.05, elbow, sh, collection=C, n=24)
        bar_between("arm_fore", elbow, (0, head_y + 0.01, zc), (0.03, 0.026), st, C)
        box("arm_head", (0.05, 0.03, 0.07), (0, head_y, zc), sh, bevel=0.008, collection=C)


def build_keyboard(C, loc, rot_z=0.0):
    """Tenkeyless keyboard: a wedge case, individually bevelled keycaps on a staggered layout
    (lilac Esc and Enter, lighter modifiers) and a faint lilac backlight between the keys."""
    W, D, hf, hb = 0.362, 0.136, 0.015, 0.026
    root = bpy.data.objects.new("kb_root", None)
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    coll(C).objects.link(root)
    add_obj("kb_case", wedge_mesh(W, D, hf, hb, bevel=0.005), (0, 0, 0), M["kb_case"], collection=C, parent=root)
    plate = bpy.data.objects.new("kb_plate", None)
    plate.parent = root
    plate.location = (0, 0, (hf + hb) / 2)
    plate.rotation_euler = (math.atan((hb - hf) / D), 0, 0)
    coll(C).objects.link(plate)
    glow = bpy.data.meshes.new("kb_glow")
    gw, gd = W - 0.016, D - 0.016
    glow.from_pydata([(-gw / 2, -gd / 2, 0), (gw / 2, -gd / 2, 0), (gw / 2, gd / 2, 0), (-gw / 2, gd / 2, 0)], [], [(0, 1, 2, 3)])
    add_obj("kb_glow", glow, (0, 0, 0.0004), M["kb_glow"], collection=C, parent=plate)
    keys = add_obj("kb_keys", keycaps_mesh(), (0, 0, 0.0018), None, collection=C, parent=plate)
    for k in ("key_alpha", "key_mod", "key_accent"):
        keys.data.materials.append(M[k])
    return root


def build_mouse(C, loc, rot_z=0.0):
    me = mouse_mesh()
    mo = add_obj("mouse", me, loc, M["mouse"], rot=(0, 0, rot_z), collection=C)
    # scroll wheel, sunk into the shell between the buttons
    add_obj("mouse_wheel", cyl_mesh(0.0062, 0.0055, 16), (0, 0.022, MOUSE_H(0.022 / 0.058) - 0.003), M["key_alpha"],
            rot=(0, math.radians(90), 0), collection=C, parent=mo)
    add_obj("mouse_seam", box_mesh(0.0009, 0.05, 0.003), (0, 0.032, MOUSE_H(0.032 / 0.058) - 0.0012), M["cable"],
            collection=C, parent=mo)
    return mo


def build_hero_desk():
    C = "Hero"
    top_th = 0.04
    dy0, dy1 = -0.42, 0.40
    dw = 1.62
    dyc = (dy0 + dy1) / 2
    box("hero_desk_top", (dw, dy1 - dy0, top_th), (0, dyc, DESK_H - top_th / 2), M["hero_top"], bevel=0.003, seg=3, collection=C)
    # 2 mm edge band, slightly proud of the top, along the front
    box("hero_desk_edge", (dw + 0.002, 0.003, top_th), (0, dy0 - 0.0005, DESK_H - top_th / 2), M["edge_band"],
        bevel=0.001, collection=C)
    for sx in (-1, 1):
        box("hero_desk_leg", (0.04, dy1 - dy0 - 0.08, DESK_H - top_th), (sx * (dw / 2 - 0.06), dyc, (DESK_H - top_th) / 2),
            M["desk_edge"], bevel=0.005, collection=C)
    box("hero_modesty", (dw - 0.16, 0.02, 0.4), (0, dy1 - 0.06, 0.48), M["desk_edge"], collection=C)
    # drawer pedestal
    box("hero_pedestal", (0.4, 0.55, 0.6), (0.52, dyc + 0.08, 0.31), M["desk_edge"], bevel=0.01, collection=C)
    for k in range(3):
        box("drawer_line", (0.36, 0.005, 0.004), (0.52, dyc + 0.08 - 0.278, 0.2 + k * 0.17), M["trim"], collection=C)
        box("drawer_pull", (0.12, 0.012, 0.01), (0.52, dyc + 0.08 - 0.282, 0.28 + k * 0.17 - 0.06 * (k == 2)), M["alu"],
            bevel=0.004, collection=C)

    # partitions: woven fabric panels with rounded aluminium caps and posts
    ph = 1.12
    py = 0.47
    box("hero_partition_back", (1.8, 0.05, ph), (0, py, ph / 2), M["fabric_hero"], bevel=0.008, collection=C)
    box("hero_partition_cap", (1.82, 0.064, 0.03), (0, py, ph + 0.012), M["alu"], bevel=0.012, seg=4, collection=C)
    box("hero_partition_kick", (1.8, 0.056, 0.08), (0, py, 0.04), M["alu"], bevel=0.004, collection=C)
    for sx in (-1, 1):
        x = sx * 0.9
        box("hero_partition_side", (0.05, 1.3, ph), (x, py - 0.65, ph / 2), M["fabric_hero"], bevel=0.008, collection=C)
        box("hero_partition_side_cap", (0.064, 1.32, 0.03), (x, py - 0.65, ph + 0.012), M["alu"], bevel=0.012, seg=4, collection=C)
        box("hero_partition_side_kick", (0.056, 1.3, 0.08), (x, py - 0.65, 0.04), M["alu"], bevel=0.004, collection=C)
        box("hero_partition_post", (0.07, 0.07, ph + 0.02), (x, py - 1.3, (ph + 0.02) / 2), M["alu"], bevel=0.014, seg=4, collection=C)
        box("hero_partition_post", (0.07, 0.07, ph + 0.02), (x, py, (ph + 0.02) / 2), M["alu"], bevel=0.014, seg=4, collection=C)

    # sticky notes on the back partition (visible at the edges of CAM_main) and the side walls
    notes = [((-0.40, 1.02), "sticky_p", 6), ((-0.30, 0.90), "sticky_y", -4), ((0.36, 0.96), "sticky_y", 3),
             ((0.46, 0.86), "sticky_g", -7), ((0.62, 1.00), "sticky_p", 5), ((-0.62, 0.88), "sticky_y", -2)]
    for (x, z), mname, deg in notes:
        box("sticky", (0.075, 0.003, 0.075), (x, py - 0.027, z), M[mname], bevel=0.0012, rot=(0, math.radians(deg), 0), collection=C)
    for (y, z), mname in [((0.05, 0.95), "sticky_y"), ((-0.1, 0.88), "sticky_g")]:
        box("sticky", (0.003, 0.075, 0.075), (-0.873, y, z), M[mname], bevel=0.0012, collection=C)

    # --- hero monitors (contract geometry) on a pole stand
    top = monitor("HERO_screen_top", SCREEN_TOP_C, SCREEN_W, SCREEN_H, M["hero_screen"], collection=C)
    bot = monitor("HERO_screen_bottom", SCREEN_BOT_C, SCREEN_W, SCREEN_H, M["hero_screen"], collection=C)
    # tiny power LED on the bottom monitor's chin
    box("monitor_led", (0.004, 0.002, 0.0016), (0.25, SCREEN_BOT_C[1] - 0.0002, SCREEN_BOT_C[2] - SCREEN_H / 2 - 0.009),
        M["led"], collection=C)
    build_monitor_stand(C)

    # desk mat, keyboard and mouse
    add_obj("desk_mat", rounded_slab_mesh(DESK_MAT[0], DESK_MAT[1], 0.003, 0.02), (0.05, -0.16, DESK_H), M["desk_mat"], collection=C)
    build_keyboard(C, (-0.045, -0.155, DESK_H + 0.003), math.radians(1.2))
    build_mouse(C, (0.255, -0.15, DESK_H + 0.003), math.radians(-7))

    # mug with coffee and a lilac band
    mx, my = -0.58, -0.05
    cyl("mug", 0.042, 0.1, (mx, my, DESK_H + 0.05), M["mug"], collection=C, n=32)
    cyl("mug_band", 0.0435, 0.018, (mx, my, DESK_H + 0.07), M["mug_band"], collection=C, n=32)
    cyl("coffee", 0.038, 0.004, (mx, my, DESK_H + 0.093), M["coffee"], collection=C, n=32)
    tor = bpy.data.meshes.new("mug_handle")
    bm = bmesh.new()
    seg, ring = 16, 8
    R, r = 0.028, 0.008
    verts = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for j in range(ring):
            b = 2 * math.pi * j / ring
            verts.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), r * math.sin(b), (R + r * math.cos(b)) * math.sin(a))))
    for i in range(seg):
        for j in range(ring):
            a = verts[i * ring + j]
            b = verts[((i + 1) % seg) * ring + j]
            c_ = verts[((i + 1) % seg) * ring + (j + 1) % ring]
            d = verts[i * ring + (j + 1) % ring]
            bm.faces.new((a, b, c_, d))
    bm.to_mesh(tor)
    bm.free()
    for p in tor.polygons:
        p.use_smooth = True
    add_obj("mug_handle", tor, (mx - 0.045, my, DESK_H + 0.05), M["mug"], collection=C)

    # papers + a binder
    box("paper_a", (0.21, 0.297, 0.002), (-0.42, -0.2, DESK_H + 0.001), M["paper"], rot=(0, 0, math.radians(8)), collection=C)
    box("paper_b", (0.21, 0.297, 0.002), (-0.40, -0.18, DESK_H + 0.003), M["paper2"], rot=(0, 0, math.radians(-5)), collection=C)
    box("paper_c", (0.21, 0.297, 0.002), (-0.44, -0.21, DESK_H + 0.005), M["paper"], rot=(0, 0, math.radians(15)), collection=C)
    box("binder", (0.06, 0.26, 0.31), (-0.73, 0.28, DESK_H + 0.155), M["binder"], bevel=0.004, collection=C)
    box("binder2", (0.05, 0.26, 0.31), (-0.67, 0.28, DESK_H + 0.155), M["binder2"], bevel=0.004, collection=C)
    box("sticky_desk", (0.075, 0.075, 0.003), (0.62, -0.02, DESK_H + 0.0015), M["sticky_y"], rot=(0, 0, math.radians(12)), collection=C)
    # phone: rounded slab with a dark glass face
    ph_ = add_obj("phone", rounded_slab_mesh(0.072, 0.15, 0.008, 0.009), (0.6, -0.22, DESK_H), M["phone"],
                  rot=(0, 0, math.radians(-14)), collection=C)
    add_obj("phone_glass", rounded_slab_mesh(0.068, 0.146, 0.0006, 0.008), (0, 0, 0.008), M["phone_glass"], collection=C, parent=ph_)

    # small plant (right back)
    px, py_ = 0.62, 0.25
    cyl("pot", 0.06, 0.1, (px, py_, DESK_H + 0.05), M["plant_pot"], collection=C, n=32, r2=0.07)
    cyl("soil", 0.064, 0.004, (px, py_, DESK_H + 0.094), M["soil"], collection=C, n=32)
    rng = random.Random(4)
    leaf_me = leaf_mesh()
    for k in range(16):
        a = k * 2 * math.pi / 16 + rng.uniform(-0.2, 0.2)
        tilt = rng.uniform(0.25, 0.95)
        L = rng.uniform(0.12, 0.2)
        off = 0.015 + math.sin(tilt) * L / 2
        lf = add_obj("leaf", leaf_me, (px + math.cos(a) * off, py_ + math.sin(a) * off, DESK_H + 0.09 + math.cos(tilt) * L / 2),
                     M["leaf"], rot=(tilt, 0, a + math.pi / 2), collection=C)
        lf.scale = (0.024, 0.004, L / 2)

    # warm desk lamp (left back): the warm accent
    lx, ly = -0.5, 0.3
    cyl("lamp_base", 0.07, 0.02, (lx, ly, DESK_H + 0.01), M["lamp"], collection=C, n=32)
    box("lamp_arm1", (0.018, 0.018, 0.36), (lx, ly, DESK_H + 0.18), M["lamp"], bevel=0.006, rot=(math.radians(-12), 0, 0), collection=C)
    box("lamp_arm2", (0.018, 0.018, 0.26), (lx, ly - 0.12, DESK_H + 0.38), M["lamp"], bevel=0.006, rot=(math.radians(-70), 0, 0), collection=C)
    cyl("lamp_shade", 0.06, 0.09, (lx, ly - 0.24, DESK_H + 0.4), M["lamp"], collection=C, n=32, r2=0.035)
    g = cyl("lamp_bulb", 0.05, 0.006, (lx, ly - 0.24, DESK_H + 0.354), M["lamp_glow"], collection=C, n=32)
    ld = bpy.data.lights.new("lamp", "SPOT")
    ld.energy = 16.0
    ld.color = hex_lin("#ffbf78")[:3]
    ld.spot_size = math.radians(110)
    ld.spot_blend = 0.6
    ld.shadow_soft_size = 0.04
    lo = bpy.data.objects.new("lamp_light", ld)
    lo.location = (lx, ly - 0.24, DESK_H + 0.345)
    coll("Lights").objects.link(lo)

    # soft key from above the sitter's left shoulder, and a cool rim from behind the partition
    # that picks out the monitor tops, the pole and the partition cap
    area_light("hero_key", (0.9, 0.7), (-0.55, -0.6, 2.3), (0.0, 0.1, 0.85), 28.0, "#f1f4ff")
    area_light("hero_rim", (1.4, 0.3), (0.25, 0.85, 2.15), (0.0, -0.2, 1.0), 26.0, "#cddcff")
    return top, bot


def build_bg_desks(chair_src, open_floor=False, rows=(1.75, 3.55, 5.35, 7.15)):
    """Rows of desks facing the camera. open_floor drops the gaps for the hero desk and the pillar."""
    rng = random.Random(11)
    C = "Floor"
    desk_w = 1.5
    for ri, ry in enumerate(rows):
        x = -ROOM_X + 0.6
        # back partition for the whole row
        while x + desk_w <= ROOM_X - 0.3:
            cx = x + desk_w / 2
            x += desk_w + 0.06
            if not open_floor:
                if ri == 0 and abs(cx) < 1.1:
                    continue
                if ri in (0, 1) and 0.25 < cx + desk_w / 2 and cx - desk_w / 2 < 1.65:
                    continue   # pillar
            top_y0, top_y1 = ry - 0.4, ry + 0.4
            box("bg_desk", (desk_w, 0.8, 0.035), (cx, ry, DESK_H - 0.0175), M["desk_top"], bevel=0.006, collection=C)
            for sx in (-1, 1):
                box("bg_leg", (0.035, 0.72, DESK_H - 0.035), (cx + sx * (desk_w / 2 - 0.05), ry, (DESK_H - 0.035) / 2),
                    M["desk_edge"], collection=C)
            box("bg_partition", (desk_w + 0.06, 0.04, 1.1), (cx, ry + 0.45, 0.55), M["fabric"], bevel=0.006, collection=C)
            box("bg_partition_cap", (desk_w + 0.06, 0.05, 0.025), (cx, ry + 0.45, 1.11), M["trim"], collection=C)
            # monitors facing the camera
            layout = rng.choice(["pair", "pair", "stack", "triple", "pair_stack"])
            mw, mh = 0.5, 0.29
            my = ry + 0.22
            if layout == "pair":
                spots = [(cx - 0.27, 1.02), (cx + 0.27, 1.02)]
            elif layout == "triple":
                spots = [(cx - 0.53, 1.02), (cx, 1.02), (cx + 0.53, 1.02)]
            elif layout == "stack":
                spots = [(cx, 0.98), (cx, 1.32)]
            else:
                spots = [(cx - 0.27, 0.98), (cx + 0.27, 0.98), (cx - 0.27, 1.32), (cx + 0.27, 1.32)]
            for (mx, mz) in spots:
                monitor("bg_screen", (mx, my, mz), mw, mh, M["bg_screen"], collection=C, bezel=0.013)
            xs = sorted(set(s[0] for s in spots))
            for mx in xs:
                ztop = max(s[1] for s in spots if s[0] == mx)
                box("bg_pole", (0.04, 0.03, ztop - DESK_H), (mx, my + 0.07, (ztop + DESK_H) / 2), M["dark_metal"], collection=C)
                box("bg_base", (0.22, 0.16, 0.014), (mx, my + 0.04, DESK_H + 0.007), M["dark_metal"], collection=C)
            # keyboard
            box("bg_kb", (0.42, 0.14, 0.02), (cx + rng.uniform(-0.1, 0.1), ry - 0.18, DESK_H + 0.01), M["kb"], collection=C)
            if rng.random() < 0.4:
                cyl("bg_mug", 0.04, 0.1, (cx + rng.choice([-0.5, 0.5]), ry - 0.1, DESK_H + 0.05), M["mug"], collection=C, n=16)
            if rng.random() < 0.35:
                box("bg_paper", (0.21, 0.297, 0.002), (cx + rng.choice([-0.45, 0.45]), ry - 0.15, DESK_H + 0.001),
                    M["paper"], rot=(0, 0, rng.uniform(-0.3, 0.3)), collection=C)
            # chair (most desks)
            if rng.random() < 0.85:
                chair_instance("bg_chair", (cx + rng.uniform(-0.15, 0.15), ry - 0.72, 0), rng.uniform(-0.5, 0.5) + math.pi,
                               chair_src, collection=C)


def build_city():
    rng = random.Random(7)
    C = "City"
    me = box_mesh(1, 1, 1)

    def tower(x, y, w, d, top, base=-220.0):
        h = top - base
        ob = bpy.data.objects.new("tower", me)
        ob.location = (x, y, base + h / 2)
        ob.scale = (w, d, h)
        if len(me.materials) == 0:
            me.materials.append(M["tower"])
        camera_only(ob)
        coll(C).objects.link(ob)
        # setback crown on some towers
        if rng.random() < 0.35:
            ob2 = bpy.data.objects.new("tower_crown", me)
            ch = rng.uniform(4, 14)
            ob2.location = (x, y, top + ch / 2)
            ob2.scale = (w * 0.65, d * 0.65, ch)
            camera_only(ob2)
            coll(C).objects.link(ob2)

    # bands of depth: near / mid / far / horizon. (y0, y1, count, top range as a slope of distance)
    bands = [(65, 130, 24, (0.0, 0.11)), (120, 220, 36, (-0.04, 0.06)),
             (220, 420, 60, (-0.05, 0.035)), (420, 900, 80, (-0.04, 0.018))]
    for (y0, y1, n, (t0, t1)) in bands:
        for _ in range(n):
            y = rng.uniform(y0, y1)
            x = rng.uniform(-0.75, 0.75) * y + rng.uniform(-10, 10)
            w = rng.uniform(10, 22) * (1 + y / 500)
            d = rng.uniform(10, 22) * (1 + y / 500)
            top = rng.uniform(t0, t1) * y + rng.uniform(-2, 2)
            if rng.random() < 0.1:
                top += rng.uniform(0.04, 0.1) * y     # occasional skyscraper above the window line
            tower(x, y, w, d, top)


# ---------------------------------------------------------------------------
# Career variants of the gameplay desk (--variant). tier1 builds none of this.
# ---------------------------------------------------------------------------
def remove_objects(names):
    """Delete objects whose base name (before any .001 suffix) is in `names`."""
    for ob in list(bpy.data.objects):
        if ob.name.split(".")[0] in names:
            bpy.data.objects.remove(ob, do_unlink=True)


def set_mat(name, mat):
    for ob in bpy.data.objects:
        if ob.name.split(".")[0] == name:
            ob.material_slots[0].material = mat


def make_ticker():
    """LED ticker board: one line of blocky glyphs in the monitor palette, lilac rules top and bottom."""
    m = bpy.data.materials.new("ticker")
    nb = NB(m)
    tc = nb.node("ShaderNodeTexCoord")
    uvs = nb.sep(tc.outputs["UV"])
    u, v = uvs[0], uvs[1]
    cu = nb.m("MULTIPLY", u, 150.0)                 # character cells along the board
    ci = nb.m("FLOOR", cu)
    px = nb.m("FLOOR", nb.m("MULTIPLY", nb.m("FRACT", cu), 4.0))      # 3 lit columns + 1 gap
    tv = nb.m("DIVIDE", nb.m("SUBTRACT", v, 0.24), 0.52)
    py = nb.m("FLOOR", nb.m("MULTIPLY", tv, 5.0))
    in_row = nb.between(tv, 0.0, 1.0)
    dot = nb.m("GREATER_THAN", nb.white(vec=nb.comb(ci, px, py), dims="3D")[0], 0.45)
    word = nb.m("FLOOR", nb.m("DIVIDE", ci, 7.0))
    space = nb.m("LESS_THAN", nb.m("FRACT", nb.m("DIVIDE", ci, 7.0)), 0.13)
    glyph = nb.m("MULTIPLY", nb.m("MULTIPLY", dot, nb.m("LESS_THAN", px, 2.5)), in_row)
    glyph = nb.m("MULTIPLY", glyph, nb.m("SUBTRACT", 1.0, space))
    pick = nb.white(w=word)[0]
    col = nb.mix(nb.m("GREATER_THAN", pick, 0.38), "#E5484D", "#2FBF71")
    col = nb.mix(nb.m("LESS_THAN", pick, 0.16), col, "#efe9dc")      # ivory symbols
    rule = nb.m("MAXIMUM", nb.m("LESS_THAN", v, 0.07), nb.m("GREATER_THAN", v, 0.93))
    out = nb.mix(glyph, "#081226", col)
    out = nb.mix(nb.m("MULTIPLY", rule, 0.7), out, "#B48CE8")
    nb.output(nb.emission(out, 1.1))
    return m


def make_kraft():
    m = bpy.data.materials.new("kraft")
    nb = NB(m)
    tc = nb.node("ShaderNodeTexCoord")
    o = nb.sep(tc.outputs["Object"])
    fib = nb.noise(vec=nb.comb(nb.m("MULTIPLY", o[0], 3.0), nb.m("MULTIPLY", o[1], 3.0), nb.m("MULTIPLY", o[2], 60.0)),
                   dims="3D", scale=30.0, detail=3.0)
    blot = nb.noise(vec=tc.outputs["Object"], dims="3D", scale=8.0, detail=2.0)
    col = nb.mix(nb.m("MULTIPLY", fib[0], 0.6), "#a27547", "#b98d5c")
    col = nb.mix(nb.m("MULTIPLY", blot[0], 0.35), col, "#8f6339")
    nb.output(nb.principled(col, 0.9, spec=0.25))
    return m


def make_photo():
    """Desk photo: an abstract sunset over hills (no people)."""
    m = bpy.data.materials.new("photo")
    nb = NB(m)
    tc = nb.node("ShaderNodeTexCoord")
    uvs = nb.sep(tc.outputs["UV"])
    u, v = uvs[0], uvs[1]
    sky = nb.mix(v, "#f1b37e", "#6f86c4")
    d = nb.node("ShaderNodeVectorMath", operation="DISTANCE")
    nb.link(d.inputs[0], tc.outputs["UV"])
    d.inputs[1].default_value = (0.68, 0.55, 0.0)
    sun = nb.m("LESS_THAN", d.outputs[1], 0.11)
    col = nb.mix(sun, sky, "#fff1cf")
    hill = nb.m("ADD", 0.38, nb.m("MULTIPLY", nb.m("SINE", nb.m("MULTIPLY", u, 5.5)), 0.08))
    col = nb.mix(nb.m("LESS_THAN", v, hill), col, "#3f6f5a")
    hill2 = nb.m("ADD", 0.22, nb.m("MULTIPLY", nb.m("SINE", nb.m("ADD", nb.m("MULTIPLY", u, 3.7), 1.3)), 0.07))
    col = nb.mix(nb.m("LESS_THAN", v, hill2), col, "#2c4d45")
    nb.output(nb.principled(col, 0.35, coat=0.4))
    return m


def build_wing_monitors(strength=0.3):
    """Two angled wing monitors flanking the hero pair, tucked behind its housing.
    Only their inner edges reach into frame, at the left and right edges of CAM_main."""
    mat = make_trading_screen("wing_screen", strength)
    w, h, bezel = 0.58, 0.34, 0.015
    for sx in (-1, 1):
        piv = bpy.data.objects.new("wing_pivot", None)
        piv.location = (sx * 0.262, 0.236, 1.17)
        piv.rotation_euler = (0, 0, sx * math.radians(-32))
        coll("Variant").objects.link(piv)
        monitor("wing_screen", (sx * (w / 2 + bezel), 0, 0), w, h, mat, collection="Variant", parent=piv)
        add_obj("wing_arm", box_mesh(0.05, 0.12, 0.04, bevel=0.005), (sx * 0.02, 0.09, 0), M["dark_metal"],
                collection="Variant", parent=piv)


def build_hanging_ticker():
    C = "Variant"
    L, H, y, z = 6.0, 0.2, 3.4, 2.7
    box("ticker_housing", (L + 0.06, 0.08, H + 0.06), (0, y + 0.045, z), M["housing"], bevel=0.01, collection=C)
    plane_xz("ticker", L, H, (0, y, z), make_ticker(), collection=C)
    for x in (-2.2, 2.2):
        box("ticker_rod", (0.012, 0.012, CEIL - z - H / 2), (x, y + 0.045, (CEIL + z + H / 2) / 2), M["dark_metal"], collection=C)


def variant_tier2(chair_src):
    """Mid-floor: open bench seating with more desks behind, wing monitors, a ticker over the floor."""
    remove_objects({"hero_partition_back", "hero_partition_cap", "sticky"})
    C = "Variant"
    # low glass-topped divider instead of the tall fabric partition (hidden behind the bottom monitor)
    box("hero_divider", (1.8, 0.04, 0.22), (0, 0.47, DESK_H + 0.11), M["fabric_hero"], bevel=0.006, collection=C)
    box("hero_divider_cap", (1.82, 0.05, 0.02), (0, 0.47, DESK_H + 0.23), M["trim"], bevel=0.006, collection=C)
    build_wing_monitors()
    build_bg_desks(chair_src, open_floor=True)
    build_hanging_ticker()
    set_mat("hero_desk_top", make_wood("walnut_top", "#6e4b33", "#3b271a", rough=0.34, coat=0.4, ring_scale=9.0))
    set_mat("hero_desk_edge", mat_basic("walnut_edge", "#3e2a1e", 0.4))


WIN3_Y = 1.25


def build_skyline_near():
    """A few tall towers close enough to rise above the hero monitors in CAM_main."""
    me = box_mesh(1, 1, 1)
    for (x0, x1, y, d, top) in [(-34.0, -13.0, 78.0, 20.0, 52.0), (15.0, 31.0, 96.0, 18.0, 36.0),
                                (-4.0, 9.0, 210.0, 16.0, 74.0), (-60.0, -40.0, 150.0, 22.0, 64.0),
                                (36.0, 54.0, 170.0, 20.0, 50.0)]:
        base = -220.0
        ob = bpy.data.objects.new("tower_near", me)
        ob.location = ((x0 + x1) / 2, y, (top + base) / 2)
        ob.scale = (x1 - x0, d, top - base)
        camera_only(ob)
        coll("City").objects.link(ob)


def variant_tier3():
    """Window seat: floor-to-ceiling glass right behind the desk, dusk skyline beyond."""
    remove_objects({"hero_partition_back", "hero_partition_cap", "sticky", "mullion", "transom", "soffit"})
    C = "Variant"
    for x in (-0.66, 0.66):
        box("mullion3", (0.06, 0.12, CEIL), (x, WIN3_Y, CEIL / 2), M["mullion"], collection=C)
    box("transom3", (2 * ROOM_X, 0.1, 0.05), (0, WIN3_Y, 0.42), M["mullion"], collection=C)
    build_wing_monitors(0.32)
    set_mat("hero_desk_top", make_stone("stone_top", "#23272f", "#5d6472"))
    set_mat("hero_desk_edge", mat_basic("stone_edge", "#1b1e25", 0.35))
    build_skyline_near()
    # The glass tint, the sun and the window fill depend on the time of day: see apply_tod().


DUSK_SKY = [(0.0, "#f3a46c"), (0.6, "#1d2a5c"), (0.07, "#eaa38e"), (0.17, "#b98fae"), (0.32, "#6a63a3")]


# ---------------------------------------------------------------------------
# Time of day (--tod). Only lights, sky, glass and the city's materials change.
# tier1/tier2 mid is the original look; tier3 pm is its original dusk.
# ---------------------------------------------------------------------------
AM_SKY = [(0.0, "#c9d6e6"), (0.45, "#7f9cc6"), (0.04, "#e3e8ee"), (0.14, "#bccbe0")]
PM_SKY = [(0.0, "#f2b27e"), (0.5, "#4d64a0"), (0.05, "#f0b896"), (0.13, "#dba7a2"), (0.26, "#9c97bf")]
DAY3_SKY = [(0.0, "#c3d0e2"), (0.6, "#4a73b0"), (0.06, "#dfe1e6"), (0.2, "#a2bbdb")]


def tod_env():
    """(sky stops, ambient colour, ambient strength, make_tower kwargs) for VARIANT and TOD."""
    if VARIANT == "tier3":
        if TOD == "pm":
            return DUSK_SKY, "#8c7fa6", 0.35, dict(lit_base=0.6, haze_col="#c99aa6", tones=("#1b2340", "#2f3a5e"),
                                                   glass_cols=("#1a2340", "#56507e"), haze_start=40.0, haze_len=300.0)
        if TOD == "am":
            return AM_SKY, "#7d93b6", 0.3, dict(lit_base=0.9, haze_col="#cfd9e6", tones=("#2b3c58", "#4a5d80"),
                                                glass_cols=("#25344f", "#55698c"), haze_start=25.0, haze_len=170.0)
        return DAY3_SKY, "#6f88ad", 0.3, dict(lit_base=0.84, haze_col="#bccbdf", tones=("#26385a", "#435a80"),
                                              glass_cols=("#1e2e4a", "#4a6590"), haze_start=45.0, haze_len=260.0)
    if TOD == "am":
        return AM_SKY, "#8aa0c0", 0.32, dict(lit_base=0.9, haze_col="#cdd8e6", haze_start=30.0, haze_len=170.0)
    if TOD == "pm":
        return PM_SKY, "#b39070", 0.3, dict(lit_base=0.66, haze_col="#e2b9a4", tones=("#2b2f4c", "#4a4f70"),
                                             glass_cols=("#2a2c48", "#6c5f80"))
    return DAY_SKY, "#6d84a8", 0.26, None


def set_glass(color):
    """Window glass tint (transparent only: glossy mirrored the ceiling lights as bright bands)."""
    g = bpy.data.materials.new("window_glass_" + TOD)
    nb = NB(g)
    t = nb.node("ShaderNodeBsdfTransparent")
    t.inputs[0].default_value = hex_lin(color)
    nb.output(t.outputs[0])
    set_mat("window_glass", g)


def add_sun(name, energy, color, elev, az, angle=2.0):
    """Sun shining in through the window wall (+Y) toward the camera, `elev` degrees above the
    horizon and turned `az` degrees about Z."""
    ld = bpy.data.lights.new(name, "SUN")
    ld.energy = energy
    ld.color = hex_lin(color)[:3]
    ld.angle = math.radians(angle)
    lo = bpy.data.objects.new(name, ld)
    lo.rotation_euler = (math.radians(elev - 90), 0, math.radians(az))
    coll("Lights").objects.link(lo)
    return lo


def tune_lights(spec):
    """spec: light base name -> (energy multiplier or None, colour or None, absolute energy or None)."""
    for ob in coll("Lights").objects:
        n = ob.name.split(".")[0]
        if n in spec:
            mul, col, absolute = spec[n]
            if absolute is not None:
                ob.data.energy = absolute
            elif mul is not None:
                ob.data.energy *= mul
            if col is not None:
                ob.data.color = hex_lin(col)[:3]


def apply_tod():
    """Lights and glass for the time of day. A no-op for tier1/tier2 mid and for fired."""
    if VARIANT == "fired":
        return
    if VARIANT == "tier3":
        if TOD == "pm":                                    # the original dusk
            set_glass("#f4eeec")
            add_sun("dusk_sun", 2.2, "#ffb98a", 10, 24)
            tune_lights({"window_fill": (None, "#f0c7b0", 260.0)})
        elif TOD == "am":
            set_glass("#eaf0f8")
            tune_lights({"window_fill": (None, "#d6e3f6", 520.0),
                         "panel_light": (0.85, "#eef3ff", None),
                         "hero_key": (0.9, "#eef3ff", None),
                         "lamp_light": (0.6, None, None)})
        else:
            set_glass("#eef2f6")
            add_sun("day_sun", 1.2, "#fff4e4", 48, 32, angle=1.0)
            tune_lights({"window_fill": (None, "#d0dcf0", 600.0)})
        return
    if TOD == "am":
        set_glass("#e8f0fa")
        tune_lights({"window_fill": (1.5, "#dce8fa", None),
                     "panel_light": (0.68, "#e4eeff", None),
                     "hero_key": (0.7, "#e2ecff", None),
                     "hero_rim": (0.85, "#d6e3ff", None),
                     "lamp_light": (0.35, None, None)})
        set_mat("light_panel", mat_emit("ceiling_panel_am", "#eaf2ff", 1.15))
    elif TOD == "pm":
        set_glass("#f6ece2")
        add_sun("late_sun", 3.0, "#ffac66", 18, 32)
        tune_lights({"window_fill": (1.4, "#ffc48a", None),
                     "panel_light": (0.85, "#ffcf98", None),
                     "hero_key": (1.1, "#ffc58a", None),
                     "hero_rim": (1.3, "#ffb070", None),
                     "lamp_light": (2.2, None, None)})
        set_mat("lamp_bulb", mat_emit("lamp_glow_pm", "#ffd29a", 6.0))
        set_mat("light_panel", mat_emit("ceiling_panel_pm", "#ffeacc", 1.5))


def variant_fired():
    """Tier1 desk, cleared out: belongings packed in a cardboard box, colder and dimmer light."""
    remove_objects({"kb_root", "kb_case", "kb_plate", "kb_glow", "kb_keys", "desk_mat", "mouse", "mouse_wheel",
                    "mouse_seam", "mug", "mug_band", "coffee", "mug_handle",
                    "paper_a", "paper_b", "paper_c", "binder", "binder2", "sticky_desk", "phone", "phone_glass", "pot", "soil", "leaf"})
    # leave a single sticky on the partition
    for ob in list(bpy.data.objects):
        if ob.name.split(".")[0] == "sticky" and not (abs(ob.location.x - 0.36) < 0.01):
            bpy.data.objects.remove(ob, do_unlink=True)
    C = "Fired"
    kraft = make_kraft()
    W, D, H, t = 0.42, 0.31, 0.135, 0.006
    root = bpy.data.objects.new("box_root", None)
    root.location = (0.0, -0.265, DESK_H)
    root.rotation_euler = (0, 0, math.radians(5))
    coll(C).objects.link(root)

    def part(name, size, loc, mat, rot=(0, 0, 0), bevel=0.0, parent=root):
        return add_obj(name, box_mesh(*size, bevel=bevel), loc, mat, rot, collection=C, parent=parent)

    part("box_floor", (W, D, t), (0, 0, t / 2), kraft)
    for sy in (-1, 1):
        part("box_wall", (W, t, H), (0, sy * (D - t) / 2, H / 2), kraft)
    for sx in (-1, 1):
        part("box_wall", (t, D - 2 * t, H), (sx * (W - t) / 2, 0, H / 2), kraft)
    # flaps folded outward and drooping (kept low so nothing rises toward the screens)
    for sy, fl, ang in ((-1, 0.15, 128), (1, 0.13, 140)):
        hinge = bpy.data.objects.new("flap_hinge", None)
        hinge.parent = root
        hinge.location = (0, sy * D / 2, H)
        hinge.rotation_euler = (math.radians(-sy * ang), 0, 0)
        coll(C).objects.link(hinge)
        part("box_flap", (W - 0.01, t * 0.8, fl), (0, 0, fl / 2), kraft, parent=hinge)
    for sx, ang in ((-1, 118), (1, 124)):
        hinge = bpy.data.objects.new("flap_hinge", None)
        hinge.parent = root
        hinge.location = (sx * W / 2, 0, H)
        hinge.rotation_euler = (0, math.radians(sx * ang), 0)
        coll(C).objects.link(hinge)
        part("box_flap", (t * 0.8, D - 0.02, 0.11), (0, 0, 0.055), kraft, parent=hinge)
    part("box_tape", (0.05, D + 0.002, 0.001), (0, 0, t + 0.0005), mat_basic("tape", "#c9a874", 0.3, coat=0.5))

    # contents (box space: +y is the back of the box, z = 0 is the desk)
    # folders and a binder standing along the back wall
    for k, (mname, th, lean, x) in enumerate([("binder", 0.03, -8, -0.13), ("binder2", 0.022, -12, -0.09),
                                               ("paper2", 0.012, -16, 0.02), ("binder", 0.02, -18, 0.11)]):
        part("box_folder", (0.17 if mname.startswith("paper") else 0.07, th, 0.13),
             (x, D / 2 - 0.03 - k * 0.006, 0.07), M[mname], rot=(math.radians(lean), 0, math.radians(90) if not mname.startswith("paper") else 0),
             bevel=0.002)
    # papers fanned on a stack, with the mug on top
    part("box_stack", (0.2, 0.15, 0.05), (0.08, -0.02, t + 0.025), M["paper2"], bevel=0.003)
    part("box_sheet", (0.21, 0.16, 0.002), (0.07, -0.03, t + 0.051), M["paper"], rot=(0, 0, math.radians(9)))
    mx, my, mz = 0.12, -0.05, t + 0.052
    add_obj("box_mug", cyl_mesh(0.04, 0.095, 28), (mx, my, mz + 0.0475), M["mug"], collection=C, parent=root)
    add_obj("box_mug_band", cyl_mesh(0.0415, 0.017, 28), (mx, my, mz + 0.066), M["mug_band"], collection=C, parent=root)
    add_obj("box_mug_handle", cyl_mesh(0.009, 0.05, 10), (mx + 0.046, my, mz + 0.05), M["mug"], collection=C, parent=root)
    # photo frame leaning in the middle
    fr = bpy.data.objects.new("photo_root", None)
    fr.parent = root
    part("box_book", (0.17, 0.12, 0.03), (-0.02, 0.06, t + 0.015), M["binder2"], bevel=0.003)
    fr.location = (-0.02, 0.05, t + 0.03)
    fr.rotation_euler = (math.radians(24), 0, math.radians(-6))
    coll(C).objects.link(fr)
    fw, fh = 0.15, 0.115
    part("photo_frame", (fw, 0.012, fh), (0, 0.006, fh / 2), mat_basic("photo_frame", "#2a2420", 0.4), bevel=0.003, parent=fr)
    ph = plane_xz("photo", fw - 0.024, fh - 0.024, (0, -0.0005, fh / 2), make_photo(), collection=C)
    ph.parent = fr
    # small plant in the front left corner
    px, py = -0.135, -0.075
    add_obj("box_pot", cyl_mesh(0.045, 0.085, 20, r2=0.052), (px, py, t + 0.0425), M["plant_pot"], collection=C, parent=root)
    leaf_me = leaf_mesh()
    rng = random.Random(9)
    for k in range(18):
        a = k * 2 * math.pi / 18 + rng.uniform(-0.2, 0.2)
        tilt = rng.uniform(0.45, 1.15)
        Ll = rng.uniform(0.07, 0.1)
        off = 0.012 + math.sin(tilt) * Ll / 2
        lf = add_obj("box_leaf", leaf_me, (px + math.cos(a) * off, py + math.sin(a) * off, t + 0.082 + math.cos(tilt) * Ll / 2),
                     M["leaf"], rot=(tilt, 0, a + math.pi / 2), collection=C, parent=root)
        lf.scale = (0.019, 0.004, Ll / 2)

    # colder, dimmer light
    for ob in coll("Lights").objects:
        n = ob.name.split(".")[0]
        if n == "panel_light":
            ob.data.energy *= 0.72
            ob.data.color = hex_lin("#d8e4ff")[:3]
        elif n in ("hero_key", "hero_rim"):
            ob.data.energy *= 0.65
            ob.data.color = hex_lin("#d6e2ff")[:3]
        elif n == "lamp_light":
            ob.data.energy = 0.0
        elif n == "window_fill":
            ob.data.energy *= 0.7
            ob.data.color = hex_lin("#b3c4e4")[:3]
    MATS.pop("lamp_glow", None)
    for ob in bpy.data.objects:
        if ob.name.split(".")[0] == "lamp_bulb":
            ob.material_slots[0].material = mat_basic("lamp_off", "#d8d2c4", 0.3)


def check_clear(cam_ob, rects, objs, below=None):
    """Project every vertex in front of the hero screen plane; report any that land inside a hero
    screen rectangle. With `below`, also require every vertex to sit lower in frame than that %."""
    bad, top_most, top_ob = 0, 100.0, ""
    for ob in objs:
        if ob.type != "MESH":
            continue
        mw = ob.matrix_world
        for vtx in ob.data.vertices:
            w = mw @ vtx.co
            p = world_to_camera_view(scene, cam_ob, w)
            fx, fy = p.x * 100, (1 - p.y) * 100
            if 0 <= fx <= 100 and fy < top_most:
                top_most, top_ob = fy, ob.name
            if w.y >= SCREEN_TOP_C[1] and below is None:
                continue
            for (l, r, t_, b) in rects.values():
                if l < fx < r and t_ < fy < b:
                    bad += 1
                    break
    msg = f"clearance {cam_ob.name}: {bad} vertices of {len(objs)} variant objects inside the hero screen rectangles"
    if below is not None:
        msg += f"; highest point at {top_most:.2f}% on {top_ob} (must be below {below}%)"
        bad += top_most <= below
    print(msg + ("  OK" if bad == 0 else "  FAIL"))
    return bad == 0


# ---------------------------------------------------------------------------
# Cameras
# ---------------------------------------------------------------------------
def build_cameras():
    def cam(name, lens, loc, rot):
        cd = bpy.data.cameras.new(name)
        cd.lens = lens
        cd.sensor_width = 36.0
        cd.sensor_fit = "AUTO"
        cd.shift_x = cd.shift_y = 0.0
        cd.clip_start = 0.05
        cd.clip_end = 3000.0
        ob = bpy.data.objects.new(name, cd)
        ob.location = loc
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = rot
        scene.collection.objects.link(ob)
        return ob
    return (cam("CAM_main", 35.0, (0, -1.02, 1.17), (math.radians(90), 0, 0)),
            cam("CAM_wide", 30.0, (0, -2.85, 1.70), (1.466, 0, -0.025)))


# ---------------------------------------------------------------------------
# Render setup + verification
# ---------------------------------------------------------------------------
def setup_render():
    r = scene.render
    r.engine = "CYCLES"
    r.resolution_x, r.resolution_y = RES_X, RES_Y
    r.resolution_percentage = 50 if PREVIEW else 100
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGB"
    r.image_settings.color_depth = "8"
    r.film_transparent = False
    cy = scene.cycles
    cy.device = "CPU"
    cy.samples = SAMPLES
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.02
    cy.use_denoising = True
    cy.denoiser = "OPENIMAGEDENOISE"
    cy.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    cy.denoising_prefilter = "ACCURATE"
    cy.use_light_tree = True
    cy.max_bounces = 6
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 2
    cy.transmission_bounces = 2
    cy.transparent_max_bounces = 8
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.blur_glossy = 1.0
    cy.sample_clamp_indirect = 5.0
    r.threads_mode = "AUTO"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0


def measure(cam_ob, screens):
    res = {}
    for s in screens:
        pts = [world_to_camera_view(scene, cam_ob, s.matrix_world @ v.co) for v in s.data.vertices]
        xs = [p.x for p in pts]
        ys = [p.y for p in pts]
        res[s.name] = (min(xs) * 100, max(xs) * 100, (1 - max(ys)) * 100, (1 - min(ys)) * 100)
    return res


def occlusion(cam_ob, screen, n=15):
    """Fraction of sample points on the screen that are hidden from the camera."""
    dg = bpy.context.evaluated_depsgraph_get()
    origin = cam_ob.matrix_world.translation
    hidden = 0
    blockers = set()
    for i in range(n):
        for j in range(n):
            u = (i + 0.5) / n - 0.5
            v = (j + 0.5) / n - 0.5
            p = screen.matrix_world @ Vector((u * SCREEN_W, 0, v * SCREEN_H))
            d = p - origin
            dist = d.length
            hit, loc, nrm, idx, ob, mat = scene.ray_cast(dg, origin, d.normalized(), distance=dist - 0.002)
            if hit:
                hidden += 1
                blockers.add(ob.name)
    return hidden / (n * n), sorted(blockers)


def verify(cams, screens):
    ok = True
    print("\n=== Screen rectangles (% of frame: left / right / top / bottom) ===")
    for cam_ob in cams:
        exp = EXPECTED[cam_ob.name]
        tol = exp["tol"]
        m = measure(cam_ob, screens)
        for name, vals in m.items():
            e = exp[name]
            dev = max(abs(a - b) for a, b in zip(vals, e))
            flag = "OK" if dev <= tol else "OUT OF TOLERANCE"
            ok &= dev <= tol
            print(f"{cam_ob.name:9s} {name:19s} " + " / ".join(f"{v:5.2f}" for v in vals)
                  + f"   expected " + " / ".join(f"{v:5.1f}" for v in e) + f"   max dev {dev:.2f}  {flag}")
    return ok


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    t0 = time.time()
    build_materials()
    sky, amb_col, amb_str, tower_kw = tod_env()
    make_world(sky, amb_col, amb_str)
    if tower_kw is not None:
        M["tower"] = make_tower("tower_" + TOD, **tower_kw)
    if VARIANT == "tier3":
        build_room(Y1=WIN3_Y, pillar=False)
    else:
        build_room(pillar=VARIANT != "tier2")
    chair_src = build_chair_source()
    top, bot = build_hero_desk()
    hero_chair = chair_instance("hero_chair", (0.16, -0.78, 0), math.radians(-14), chair_src, collection="Hero")
    if VARIANT == "tier2":
        variant_tier2(chair_src)
    elif VARIANT == "tier3":
        variant_tier3()
    else:
        build_bg_desks(chair_src)
        if VARIANT == "fired":
            variant_fired()
    apply_tod()
    build_city()
    cam_main, cam_wide = build_cameras()
    setup_render()
    print(f"Scene built in {time.time() - t0:.1f}s; variant {VARIANT}; tod {TOD}; objects: {len(bpy.data.objects)}")

    bpy.context.view_layer.update()
    ok = verify([cam_main, cam_wide], [top, bot])
    if VARIANT != "tier1":
        rects = measure(cam_main, [top, bot])
        extra = list(COLLS["Fired" if VARIANT == "fired" else "Variant"].all_objects)
        ok &= check_clear(cam_main, rects, extra, below=78.4 if VARIANT == "fired" else None)

    jobs = {"main": (cam_main, f"desk{SUFFIX}.png", False), "wide": (cam_wide, f"wide{SUFFIX}.png", True)}
    os.makedirs(OUT_DIR, exist_ok=True)
    for key in CAMS:
        cam_ob, fname, chair_on = jobs[key]
        # The player sits in the chair for the gameplay view, so it is only shown in the wide intro shot.
        hero_chair.hide_render = not chair_on
        hero_chair.hide_viewport = not chair_on
        scene.camera = cam_ob
        bpy.context.view_layer.update()
        for s in (top, bot):
            frac, blk = occlusion(cam_ob, s)
            print(f"occlusion {cam_ob.name} {s.name}: {frac * 100:.0f}% hidden {blk}")
            ok &= frac == 0
        scene.render.filepath = os.path.join(OUT_DIR, fname)
        t = time.time()
        bpy.ops.render.render(write_still=True)
        print(f"Rendered {cam_ob.name} -> {scene.render.filepath} in {time.time() - t:.1f}s "
              f"({scene.render.resolution_x * scene.render.resolution_percentage // 100}x"
              f"{scene.render.resolution_y * scene.render.resolution_percentage // 100}, {SAMPLES} samples)")
    if not ok:
        print("WARNING: a screen check failed (rectangles, occlusion or variant clearance)")


main()
