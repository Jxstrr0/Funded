"""Edge props: desk overlays for each tier and close-up card art (procedural, Blender 4.2, Cycles CPU).

One file, three roles:

  python3 art/build_props.py [--tiers tier1,tier2,tier3] [--ids coffee,rewind] [--samples 160]
                             [--cards] [--no-desk] [--check]
      The driver. For each tier it runs build_scene.py with `--hook art/build_props.py` (desk
      overlays), with --cards it renders the card stills, and with --check it composites every
      prop over the tier desks into art/out/props/check-<tier>.png (needs Pillow).

  blender ... -P art/build_scene.py -- --variant tier2 --hook art/build_props.py
      The hook (run by the driver). The scene is already built; this adds every prop in its
      fixed slot, checks the slots against the hero screens, and renders each prop in a small
      crop of CAM_main: once with the prop (A), once without (B) and once as a matte (M, every
      other object a holdout). A, B and M give the prop's colour, coverage and contact shadow
      so that `prop.webp` over `desk-<tier>.jpg` reproduces A. Writes assets/props/<tier>/<id>.webp
      and art/out/props/layout-<tier>.json.

  blender -b --factory-startup -P art/build_props.py -- --cards [--ids ...] [--samples 128]
      Card stills: each prop alone on a transparent 480x480 frame with a shadow-catcher floor,
      a lilac and a cool rim light. Writes assets/cards/<id>.webp.
"""
import os, sys, json, math, subprocess, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]


def opt(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


IDS = ["rewind", "hotHand", "stopDiscipline", "tapeReader", "riskFriend",
       "shortWeek", "coffee", "whisper", "rainmaker", "thetaShield"]
SEL = opt("--ids", ",".join(IDS)).split(",")

# Desk slots, in metres in the scene (desk top at z = DESK_H). The desk, monitors, keyboard and
# camera are the same in every tier, so one layout serves all three. Front row: on the desk mat
# just behind the keyboard. Back row: under the bottom monitor. Tall things (the mug's steam,
# the hourglass) sit in the side strips outside the hero screens.
D = 0.75
SLOTS = {
    "coffee":         dict(loc=(-0.244, -0.035, D), rot_z=math.radians(-130), scale=0.86, steam_h=0.11, steam_sway=0.008),
    "tapeReader":     dict(loc=(-0.180, 0.018, D), rot_z=math.radians(-10)),
    "stopDiscipline": dict(loc=(-0.150, 0.1792, 0.7865), rot=(math.radians(-4), math.radians(7), 0), size=0.054),
    "shortWeek":      dict(loc=(-0.010, 0.150, D), rot_z=math.radians(4)),
    "riskFriend":     dict(loc=(-0.033, 0.016, D), rot_z=math.radians(-8), napkin=0.085),
    "rewind":         dict(loc=(0.115, 0.152, D), rot=(math.radians(-12), 0, math.radians(-6))),
    "whisper":        dict(loc=(0.063, 0.022, D), rot_z=math.radians(14)),
    "rainmaker":      dict(loc=(0.190, 0.020, D), scale=0.85),
    "hotHand":        dict(loc=(0.186, -0.118, D + 0.003), rot_z=math.radians(70)),
    "thetaShield":    dict(loc=(0.266, 0.030, D), rot_z=0.3, scale=0.9),
}

# Card stills: pose per prop (the builder kwargs) and the camera's elevation in degrees.
CARD = {
    "rewind":         (dict(loc=(0, 0, 0), rot=(math.radians(-14), 0, math.radians(-8))), 16),
    "hotHand":        (dict(loc=(0, 0, 0), rot_z=math.radians(-18)), 34),
    "stopDiscipline": (dict(loc=(0, 0, 0.03), rot=(math.radians(-12), 0, math.radians(-6)), size=0.06), 12),
    "tapeReader":     (dict(loc=(-0.02, 0, 0), rot_z=math.radians(-28)), 30),
    "riskFriend":     (dict(loc=(0, 0, 0), rot_z=math.radians(-8), napkin=0.1), 34),
    "shortWeek":      (dict(loc=(0, 0, 0), rot_z=math.radians(10)), 16),
    "coffee":         (dict(loc=(0, 0, 0), rot_z=math.radians(160), steam_h=0.09), 18),
    "whisper":        (dict(loc=(0, 0, 0), rot_z=math.radians(28)), 30),
    "rainmaker":      (dict(loc=(0, 0, 0)), 22),
    "thetaShield":    (dict(loc=(0, 0, 0), rot_z=0.3), 14),
}

SCREEN_BOTTOM_PCT = 78.4
STRIP_L, STRIP_R = 11.0, 89.0


def webp(src_png, dst, quality=85):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src_png, "-c:v", "libwebp", "-pix_fmt", "yuva420p",
                    "-quality", str(quality), "-compression_level", "6", dst], check=True)


# =====================================================================================
# Driver (plain python3)
# =====================================================================================
def driver():
    blender = os.environ.get("BLENDER", "blender")
    tiers = opt("--tiers", "tier1,tier2,tier3").split(",")
    samples = opt("--samples", "160")
    t_all = time.time()
    if "--no-desk" not in ARGV:
        for tier in tiers:
            t = time.time()
            cmd = [blender, "-b", "--factory-startup", "-P", os.path.join(HERE, "build_scene.py"), "--",
                   "--variant", tier, "--samples", samples, "--hook", os.path.abspath(__file__), "--ids", ",".join(SEL)]
            print(" ".join(cmd), flush=True)
            subprocess.run(cmd, check=True)
            print(f"desk props {tier}: {time.time() - t:.0f}s", flush=True)
    if "--cards" in ARGV:
        t = time.time()
        subprocess.run([blender, "-b", "--factory-startup", "-P", os.path.abspath(__file__), "--", "--cards",
                        "--ids", ",".join(SEL), "--samples", opt("--card-samples", "128")], check=True)
        print(f"cards: {time.time() - t:.0f}s", flush=True)
    if "--check" in ARGV:
        check_composites(tiers)
    print(f"total {time.time() - t_all:.0f}s")


def check_composites(tiers):
    """Composite every prop over its tier desk with the screen rectangles drawn in, and report
    any two props whose visible pixels overlap."""
    from PIL import Image, ImageDraw
    import numpy as np
    out = os.path.join(HERE, "out", "props")
    for tier in tiers:
        lay = json.load(open(os.path.join(out, f"layout-{tier}.json")))
        desk = {"tier1": "desk.jpg"}.get(tier, f"desk-{tier}.jpg")
        im = Image.open(os.path.join(ROOT, "assets", desk)).convert("RGBA")
        W, H = im.size
        owner = np.full((H, W), -1, int)
        clash = {}
        for k, pid in enumerate(IDS):
            if pid not in lay:
                continue
            L = lay[pid]
            p = Image.open(os.path.join(ROOT, "assets", "props", tier, pid + ".webp")).convert("RGBA")
            x0, y0 = round(L["left"] / 100 * W), round(L["top"] / 100 * H)
            im.alpha_composite(p, (x0, y0))
            a = np.asarray(p)[:, :, 3] > 160          # solid prop pixels (not the soft shadow)
            sub = owner[y0:y0 + a.shape[0], x0:x0 + a.shape[1]]
            hit = sub[a[:sub.shape[0], :sub.shape[1]]]
            for o in set(hit[hit >= 0].tolist()):
                clash[(IDS[o], pid)] = int((hit == o).sum())
            sub[a[:sub.shape[0], :sub.shape[1]]] = k
        dr = ImageDraw.Draw(im)
        for (l, r, t, b) in ((11, 89, 21.6, 47.6), (11, 89, 52.4, 78.4)):
            dr.rectangle((l / 100 * W, t / 100 * H, r / 100 * W, b / 100 * H), outline=(255, 60, 60, 255), width=2)
        path = os.path.join(out, f"check-{tier}.png")
        im.convert("RGB").save(path)
        print(f"check {tier}: {path}; overlapping solid pixels: {clash or 'none'}")


# =====================================================================================
# Shared Blender helpers
# =====================================================================================
def prop_objects(root):
    import props
    return [root] + props.descendants(root)


def world_points(objs, dg):
    import bpy
    pts = []
    for ob in objs:
        if ob.type not in ("MESH", "CURVE", "FONT"):
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ob.matrix_world
        pts.extend(mw @ v.co for v in me.vertices)
        ev.to_mesh_clear()
    return pts


# =====================================================================================
# Hook (inside build_scene.py)
# =====================================================================================
def hook(G):
    import bpy
    import numpy as np
    from bpy_extras.object_utils import world_to_camera_view
    sys.path.insert(0, HERE)
    import props
    scene = G["scene"]
    cam = G["cam_main"]
    tier = G["VARIANT"]
    G["SKIP_RENDER"] = True
    out = os.path.join(HERE, "out", "props", tier)
    os.makedirs(out, exist_ok=True)
    G["hero_chair"].hide_render = True
    scene.camera = cam

    col = bpy.data.collections.new("Props")
    scene.collection.children.link(col)
    roots = {}
    for pid in IDS:
        pc = bpy.data.collections.new("prop_" + pid)
        col.children.link(pc)
        roots[pid] = props.BUILDERS[pid](pc, **SLOTS[pid])
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    RX, RY = scene.render.resolution_x, scene.render.resolution_y

    # --- slot check: every vertex below the bottom screen or in a side strip; report bounding boxes
    boxes, ok = {}, True
    for pid in IDS:
        objs = prop_objects(roots[pid])
        pts = [world_to_camera_view(scene, cam, w) for w in world_points(objs, dg)]
        fx = [p.x * 100 for p in pts]
        fy = [(1 - p.y) * 100 for p in pts]
        bad = sum(1 for x, y in zip(fx, fy) if y <= SCREEN_BOTTOM_PCT and STRIP_L <= x <= STRIP_R)
        off = sum(1 for x, y in zip(fx, fy) if not (0 <= x <= 100 and 0 <= y <= 100))
        boxes[pid] = (min(fx), max(fx), min(fy), max(fy))
        ok &= bad == 0
        print(f"slot {pid:15s} x {min(fx):5.1f}-{max(fx):5.1f}%  y {min(fy):5.1f}-{max(fy):5.1f}%  "
              f"{'OK' if bad == 0 else f'{bad} vertices over a hero screen'}{f', {off} off frame' if off else ''}")
    print("slot check " + ("OK" if ok else "FAIL"))
    if "--slots-only" in ARGV:
        return

    # --- render settings shared by the three passes
    cy = scene.cycles
    cy.transmission_bounces = 8          # the hourglass glass
    cy.transparent_max_bounces = 16      # steam
    cy.max_bounces = 10
    scene.render.use_persistent_data = True
    scene.render.use_border = True
    scene.render.use_crop_to_border = True
    st = scene.render.image_settings
    st.file_format = "PNG"
    st.color_mode = "RGBA"
    st.color_depth = "16"
    samples = cy.samples
    others = [o for o in scene.objects if o.type in ("MESH", "CURVE", "FONT") and not o.users_collection[0].name.startswith("prop_")
              and o.users_collection[0] is not col]
    all_prop_objs = {pid: [o for o in prop_objects(roots[pid])] for pid in IDS}

    def show_only(pid):
        for k, objs in all_prop_objs.items():
            for o in objs:
                if o.name.startswith("steam_taper"):
                    continue
                o.hide_render = k != pid

    def render(path):
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)

    def load(path):
        im = bpy.data.images.load(path)
        im.colorspace_settings.name = "Non-Color"
        a = np.empty(im.size[0] * im.size[1] * 4, np.float32)
        im.pixels.foreach_get(a)
        w, h = im.size
        bpy.data.images.remove(im)
        return a.reshape(h, w, 4)[::-1]          # top row first

    def dilate(mask, n):
        m = mask.copy()
        for _ in range(n):
            g = m.copy()
            g[1:] |= m[:-1]; g[:-1] |= m[1:]; g[:, 1:] |= m[:, :-1]; g[:, :-1] |= m[:, 1:]
            m = g
        return m

    layout, times = {}, {}
    for pid in SEL:
        t0 = time.time()
        l, r, t, b = boxes[pid]
        w, h = r - l, b - t
        pad_x = max(1.5, 0.30 * w)
        pad_t, pad_b = max(1.0, 0.12 * h), max(1.2, 0.30 * h)
        bx0, bx1 = max(0.0, l - pad_x) / 100, min(100.0, r + pad_x) / 100
        by0, by1 = max(0.0, t - pad_t) / 100, min(100.0, b + pad_b) / 100     # from the top
        scene.render.border_min_x, scene.render.border_max_x = bx0, bx1
        scene.render.border_min_y, scene.render.border_max_y = 1 - by1, 1 - by0
        # B: the desk without any prop; A: with this prop
        scene.render.film_transparent = False
        cy.samples = samples
        cy.use_denoising = True
        show_only(None)
        render(os.path.join(out, f"{pid}-B.png"))
        show_only(pid)
        render(os.path.join(out, f"{pid}-A.png"))
        # M: the prop's coverage, with everything else a holdout (keeps occlusion by the keyboard etc.)
        for o in others:
            o.is_holdout = True
        scene.render.film_transparent = True
        cy.samples = 32
        cy.use_denoising = False
        render(os.path.join(out, f"{pid}-M.png"))
        for o in others:
            o.is_holdout = False
        A = load(os.path.join(out, f"{pid}-A.png"))[:, :, :3]
        B = load(os.path.join(out, f"{pid}-B.png"))[:, :, :3]
        m = load(os.path.join(out, f"{pid}-M.png"))[:, :, 3]
        # contact shadow: how much darker the desk got, near the prop only
        lw = np.array([0.2126, 0.7152, 0.0722], np.float32)
        la, lb = A @ lw, B @ lw
        shade = np.clip(1 - la / np.maximum(lb, 1e-4), 0, 1)
        shade[shade < 0.03] = 0
        solid = m > 0.02
        size_px = max(A.shape[0], A.shape[1])
        near = dilate(solid, max(4, int(size_px * 0.10)))
        far = dilate(near, max(4, int(size_px * 0.08)))
        shade = shade * np.where(near, 1.0, np.where(far, 0.4, 0.0))
        alpha = np.maximum(m, shade)
        alpha[m > 0.985] = 1.0
        safe = np.maximum(alpha, 1e-4)[:, :, None]
        C = np.clip((A - (1 - alpha[:, :, None]) * B) / safe, 0, 1)
        C[alpha < 1e-3] = 0
        rgba = np.dstack([C, alpha])
        # trim to what is visible, then save straight-alpha PNG and WebP
        ys, xs = np.nonzero(alpha > 2 / 255)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        rgba = rgba[y0:y1, x0:x1]
        hh, ww = rgba.shape[:2]
        img = bpy.data.images.new(f"{pid}_out", ww, hh, alpha=True)
        img.colorspace_settings.name = "Non-Color"
        img.pixels.foreach_set(rgba[::-1].astype(np.float32).ravel())
        png = os.path.join(out, f"{pid}.png")
        img.filepath_raw = png
        img.file_format = "PNG"
        img.save()
        bpy.data.images.remove(img)
        webp(png, os.path.join(ROOT, "assets", "props", tier, pid + ".webp"))
        px0 = round(bx0 * RX) + int(x0)
        py0 = round(by0 * RY) + int(y0)
        layout[pid] = {"left": round(px0 / RX * 100, 2), "top": round(py0 / RY * 100, 2),
                       "width": round(ww / RX * 100, 2), "height": round(hh / RY * 100, 2),
                       "px": [px0, py0, ww, hh]}
        times[pid] = round(time.time() - t0, 1)
        print(f"PROP {tier} {pid}: {ww}x{hh} at ({px0},{py0}) in {times[pid]}s", flush=True)
    scene.render.use_border = False
    lp = os.path.join(HERE, "out", "props", f"layout-{tier}.json")
    old = json.load(open(lp)) if os.path.exists(lp) else {}
    old.update(layout)
    json.dump(old, open(lp, "w"), indent=1)
    print("TIMES", json.dumps(times))


# =====================================================================================
# Card stills (own scene)
# =====================================================================================
def cards():
    import bpy
    from mathutils import Vector
    sys.path.insert(0, HERE)
    import props
    lin = props.lin
    samples = int(opt("--samples", "128"))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = lin("#1a2442")
    bg.inputs[1].default_value = 0.35
    floor = bpy.data.meshes.new("floor")
    s = 3.0
    floor.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    fo = bpy.data.objects.new("floor", floor)
    sc.collection.objects.link(fo)
    fm = bpy.data.materials.new("floor")
    fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = lin("#3a4466")
    fm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.7
    floor.materials.append(fm)
    fo.is_shadow_catcher = True

    cd = bpy.data.cameras.new("cam")
    cd.lens = 70
    cd.clip_start = 0.005
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam

    def light(name, loc, target, energy, colr, size):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.color = lin(colr)[:3]
        ld.size = size
        lo = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(lo)
        return lo, Vector(loc), Vector(target), energy
    rig = [light("key", (-0.30, -0.42, 0.42), (0, 0, 0.03), 7.0, "#fff3e2", 0.35),
           light("rim_lilac", (-0.32, 0.30, 0.20), (0, 0, 0.04), 9.0, "#B48CE8", 0.18),
           light("rim_cool", (0.34, 0.26, 0.26), (0, 0, 0.04), 8.0, "#a9c6ff", 0.18),
           light("fill", (0.42, -0.36, 0.14), (0, 0, 0.03), 1.2, "#b4c2e6", 0.5),
           light("top", (0.0, 0.05, 0.6), (0, 0, 0), 2.0, "#e8ecff", 0.6)]

    r = sc.render
    r.engine = "CYCLES"
    r.resolution_x = r.resolution_y = 480
    r.resolution_percentage = 100
    r.film_transparent = True
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    cy = sc.cycles
    cy.device = "CPU"
    cy.samples = samples
    cy.use_denoising = True
    cy.denoiser = "OPENIMAGEDENOISE"
    cy.transmission_bounces = 8
    cy.transparent_max_bounces = 16
    cy.max_bounces = 10
    cy.blur_glossy = 0.5
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.view_settings.exposure = 0.35
    out = os.path.join(HERE, "out", "cards")
    os.makedirs(out, exist_ok=True)
    times = {}
    from bpy_extras.object_utils import world_to_camera_view
    for pid in SEL:
        t0 = time.time()
        pc = bpy.data.collections.new("prop_" + pid)
        sc.collection.children.link(pc)
        kw, elev = CARD[pid]
        root = props.BUILDERS[pid](pc, **kw)
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        pts = world_points(prop_objects(root), dg)
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        c = (lo + hi) / 2
        e = math.radians(elev)
        direction = Vector((0, -math.cos(e), math.sin(e)))
        cd.shift_x = cd.shift_y = 0
        # fit: back the camera off until the prop fills ~78% of the frame, then centre it with shift
        dist = 0.2
        for _ in range(40):
            cam.location = c + direction * dist
            cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
            bpy.context.view_layer.update()
            ps = [world_to_camera_view(sc, cam, p) for p in pts]
            xs, ys = [p.x for p in ps], [p.y for p in ps]
            span = max(max(xs) - min(xs), max(ys) - min(ys))
            dist *= span / 0.76
        cd.shift_x = ((max(xs) + min(xs)) / 2 - 0.5)
        cd.shift_y = ((max(ys) + min(ys)) / 2 - 0.5) - 0.02
        size = (hi - lo).length
        k = size / 0.12
        for lo_, loc, tgt, energy in rig:     # the rig scales with the prop, at the same brightness
            lo_.location = c + loc * k
            lo_.rotation_euler = (c + tgt * k - lo_.location).to_track_quat("-Z", "Y").to_euler()
            lo_.data.energy = energy * k * k
        sc.render.filepath = os.path.join(out, pid + ".png")
        bpy.ops.render.render(write_still=True)
        webp(sc.render.filepath, os.path.join(ROOT, "assets", "cards", pid + ".webp"))
        for o in list(pc.objects):
            bpy.data.objects.remove(o)
        bpy.data.collections.remove(pc)
        times[pid] = round(time.time() - t0, 1)
        print(f"CARD {pid} in {times[pid]}s", flush=True)
    print("TIMES", json.dumps(times))


# =====================================================================================
if "cam_main" in globals() and "VARIANT" in globals():
    hook(globals())
elif "bpy" in sys.modules and "--cards" in ARGV:
    cards()
elif __name__ == "__main__" and "bpy" not in sys.modules:
    driver()
