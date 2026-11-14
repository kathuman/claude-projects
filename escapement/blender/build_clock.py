"""Builds the skeleton bracket clock in Blender from spec.json, animates it with drivers, and saves the .blend and a .glb.

usage (headless):
  blender -b --factory-startup --python escapement/blender/build_clock.py -- <spec.json> <out.blend> <out.glb> [renders dir]

Every part is built in the clock's design coordinates (millimetres; x right, y up, z towards the viewer) under one root
empty, "Clock", which turns design z into Blender's -Y and scales millimetres to metres. A moving part has its origin on
its arbor, so its motion is one rotation about its local Z. Drivers (simple expressions of the frame, so they run without
enabling scripts) reproduce the kinematics of src/clock.js: the pendulum swings, the escape wheel advances half a tooth
per beat, and every wheel and hand follows through the gear ratios.
"""
import json
import math
import os
import sys

import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SPEC_PATH, BLEND_OUT, GLB_OUT = argv[0], argv[1], argv[2]
RENDERS = argv[3] if len(argv) > 3 else None
D = json.load(open(SPEC_PATH, encoding="utf-8"))
S, A = D["spec"], D["arbors"]
FPS = 30
TAU = math.pi * 2

# ---------------------------------------------------------------------------------------------- scene and materials
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, 10 * FPS
scene.unit_settings.system = "METRIC"


def material(name, color, metallic=0.0, roughness=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    m.diffuse_color = (*color, 1.0)
    return m


M = {
    "brass": material("Brass", (0.78, 0.50, 0.14), 1.0, 0.24),
    "brass_dark": material("Brass, plates", (0.70, 0.45, 0.13), 1.0, 0.30),
    "steel": material("Steel", (0.78, 0.79, 0.81), 1.0, 0.18),
    "blued": material("Blued steel", (0.06, 0.10, 0.32), 0.9, 0.22),
    "silver": material("Silvered dial", (0.66, 0.66, 0.64), 0.85, 0.38),
    "black": material("Numerals", (0.03, 0.03, 0.03), 0.0, 0.4),
    "wood": material("Base, walnut", (0.10, 0.045, 0.02), 0.0, 0.38),
    "bob": material("Pendulum bob", (0.80, 0.54, 0.16), 1.0, 0.14),
}

root = bpy.data.objects.new("Clock", None)
scene.collection.objects.link(root)
root.rotation_euler = (math.pi / 2, 0, 0)   # design z (towards the viewer) → Blender −Y; design y → Blender Z
root.scale = (0.001, 0.001, 0.001)          # millimetres → metres


# ---------------------------------------------------------------------------------------------- mesh builders
def circle(cx, cy, r, n=48, a0=0.0):
    return [(cx + r * math.cos(a0 + TAU * i / n), cy + r * math.sin(a0 + TAU * i / n)) for i in range(n)]


def prism(bm, pts, z0, z1, smooth=False):
    """A solid from a counter-clockwise outline, from z0 to z1."""
    n = len(pts)
    vb = [bm.verts.new((x, y, z0)) for x, y in pts]
    vt = [bm.verts.new((x, y, z1)) for x, y in pts]
    bm.faces.new(list(reversed(vb)))
    bm.faces.new(vt)
    for i in range(n):
        f = bm.faces.new((vb[i], vb[(i + 1) % n], vt[(i + 1) % n], vt[i]))
        f.smooth = smooth


def ring(bm, outer, inner, z0, z1, smooth=False):
    """A solid between two counter-clockwise outlines with the same number of points (a rim, a tube)."""
    n = len(outer)
    ob = [bm.verts.new((x, y, z0)) for x, y in outer]
    ot = [bm.verts.new((x, y, z1)) for x, y in outer]
    ib = [bm.verts.new((x, y, z0)) for x, y in inner]
    it = [bm.verts.new((x, y, z1)) for x, y in inner]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ot[i], ot[j], it[j], it[i]))
        bm.faces.new((ib[i], ib[j], ob[j], ob[i]))
        f = bm.faces.new((ob[i], ob[j], ot[j], ot[i])); f.smooth = smooth
        f = bm.faces.new((ib[j], ib[i], it[i], it[j])); f.smooth = smooth


def cylinder(bm, cx, cy, r, z0, z1, n=40):
    prism(bm, circle(cx, cy, r, n), z0, z1, smooth=True)


def tube(bm, cx, cy, r_out, r_in, z0, z1, n=40):
    ring(bm, circle(cx, cy, r_out, n), circle(cx, cy, r_in, n), z0, z1, smooth=True)


def bar(bm, p0, p1, width, z0, z1):
    """A flat bar from p0 to p1 with rounded-off ends hidden by overlapping parts."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / L * width / 2, dx / L * width / 2
    prism(bm, [(p0[0] - nx, p0[1] - ny), (p1[0] - nx, p1[1] - ny), (p1[0] + nx, p1[1] + ny), (p0[0] + nx, p0[1] + ny)], z0, z1)


def strip(bm, pts, width, z0, z1):
    """A ribbon of the given width along an open polyline (the mainspring)."""
    left, right = [], []
    for i, (x, y) in enumerate(pts):
        a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L * width / 2, dx / L * width / 2
        left.append((x + nx, y + ny)); right.append((x - nx, y - ny))
    lb = [bm.verts.new((x, y, z0)) for x, y in left]; lt = [bm.verts.new((x, y, z1)) for x, y in left]
    rb = [bm.verts.new((x, y, z0)) for x, y in right]; rt = [bm.verts.new((x, y, z1)) for x, y in right]
    for i in range(len(pts) - 1):
        j = i + 1
        bm.faces.new((rt[i], rt[j], lt[j], lt[i]))
        bm.faces.new((lb[i], lb[j], rb[j], rb[i]))
        f = bm.faces.new((lb[i], lt[i], lt[j], lb[j])); f.smooth = True
        f = bm.faces.new((rb[j], rt[j], rt[i], rb[i])); f.smooth = True
    bm.faces.new((lb[0], rb[0], rt[0], lt[0]))
    n = len(pts) - 1
    bm.faces.new((rb[n], lb[n], lt[n], rt[n]))


def ellipsoid(bm, cx, cy, cz, rx, ry, rz, seg=40, rings=16):
    verts = []
    for i in range(1, rings):
        phi = math.pi * i / rings
        row = [bm.verts.new((cx + rx * math.sin(phi) * math.cos(TAU * j / seg), cy + ry * math.sin(phi) * math.sin(TAU * j / seg), cz + rz * math.cos(phi))) for j in range(seg)]
        verts.append(row)
    top, bot = bm.verts.new((cx, cy, cz + rz)), bm.verts.new((cx, cy, cz - rz))
    for j in range(seg):
        k = (j + 1) % seg
        bm.faces.new((top, verts[0][j], verts[0][k])).smooth = True
        bm.faces.new((bot, verts[-1][k], verts[-1][j])).smooth = True
        for i in range(len(verts) - 1):
            bm.faces.new((verts[i][j], verts[i + 1][j], verts[i + 1][k], verts[i][k])).smooth = True


def gear_outline(teeth, module, wheel=True, tip_samples=7):
    """Clock-gear outline: radial flanks below the pitch circle, rounded (ogival) tips above it."""
    r = teeth * module / 2
    add, ded = (1.35, 1.6) if wheel else (0.95, 1.4)
    rf, half = r - ded * module, (0.70 if wheel else 0.55) * module / r   # half the tooth's angular thickness
    pts = []
    for k in range(teeth):
        a = TAU * k / teeth
        pts.append((rf * math.cos(a - half), rf * math.sin(a - half)))
        for j in range(tip_samples + 1):
            s = -1 + 2 * j / tip_samples
            rr = r + add * module * math.sqrt(max(0.0, 1 - s * s))
            pts.append((rr * math.cos(a + half * s), rr * math.sin(a + half * s)))
        pts.append((rf * math.cos(a + half), rf * math.sin(a + half)))
        gap = TAU / teeth - 2 * half
        for j in (1, 2):
            b = a + half + gap * j / 3
            pts.append((rf * math.cos(b), rf * math.sin(b)))
    return pts, rf


def wheel(bm, teeth, module, z, thick=1.6, spokes=5, hub=3.0):
    """A wheel: toothed rim, crossed-out spokes and a hub, centred on the origin."""
    outer, rf = gear_outline(teeth, module, True)
    rim_in = rf - max(2.2, 0.09 * rf)
    inner = [(rim_in * x / math.hypot(x, y), rim_in * y / math.hypot(x, y)) for x, y in outer]
    ring(bm, outer, inner, z - thick / 2, z + thick / 2)
    for k in range(spokes):
        a = TAU * k / spokes + math.pi / 2
        bar(bm, (0, 0), (rim_in * 1.02 * math.cos(a), rim_in * 1.02 * math.sin(a)), max(1.6, 0.07 * rim_in), z - thick / 2, z + thick / 2)
    tube(bm, 0, 0, hub, 0.9, z - thick / 2 - 0.4, z + thick / 2 + 0.4)


def pinion(bm, leaves, module, z, length=3.2):
    outline, _ = gear_outline(leaves, module, False, 5)
    prism(bm, outline, z - length / 2, z + length / 2)


ESC = D["escapement"]   # the escape wheel's teeth and the anchor, traced from the motion by src/escapement.js


def part(name, build, mat, origin=(0.0, 0.0), parent=None, depth_origin=0.0):
    """Make an object from a bmesh builder; geometry is given in design coordinates and moved so the object's origin
    sits at ``origin`` (its arbor)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    build(bm)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(-origin[0], -origin[1], -depth_origin))
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M[mat])
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.parent = parent or root
    ob.location = (origin[0], origin[1], depth_origin)
    return ob


def add_material(ob, mat):
    ob.data.materials.append(M[mat])
    return len(ob.data.materials) - 1


# ---------------------------------------------------------------------------------------------- the frame
DEPTH, PT = S["plates"]["depth"], S["plates"]["thickness"]
T, MS = S["train"], S["mainspring"]
pivots = {k: (A[k]["x"], A[k]["y"]) for k in ("barrel", "centre", "third", "escape", "pallet")}
RAIL_L = [(-56, -84), (-56, -58), (-52, -24), (-43, 10), (-30, 42), (-15, 66), (0, 84)]
RAIL_R = [(-x, y) for x, y in RAIL_L]


def plate(bm, z0, z1):
    for k, (x, y) in pivots.items():
        tube(bm, x, y, 6.5 if k == "barrel" else 4.2, 1.3, z0, z1)
    links = [("barrel", "centre"), ("centre", "third"), ("third", "escape"), ("escape", "pallet")]
    for a, b in links:
        bar(bm, pivots[a], pivots[b], 2.8, z0, z1)
    for rail in (RAIL_L, RAIL_R):
        for p, q in zip(rail, rail[1:]):
            bar(bm, p, q, 3.4, z0, z1)
            cylinder(bm, q[0], q[1], 1.7, z0, z1, 20)
    bar(bm, RAIL_L[0], RAIL_R[0], 6.0, z0, z1)                      # the foot
    bar(bm, pivots["barrel"], (-56, -40), 4.0, z0, z1)               # stays from the arbors to the rails
    bar(bm, pivots["barrel"], (56, -40), 4.0, z0, z1)
    bar(bm, pivots["centre"], (-46, 0), 3.5, z0, z1)
    bar(bm, pivots["third"], (44, 10), 3.5, z0, z1)
    bar(bm, pivots["pallet"], (0, 84), 3.0, z0, z1)
    bar(bm, pivots["escape"], (-26, 52), 3.0, z0, z1)
    bar(bm, pivots["escape"], (26, 52), 3.0, z0, z1)


frame = part("Frame: back plate", lambda bm: plate(bm, -PT, 0), "brass_dark")
part("Frame: front plate", lambda bm: plate(bm, DEPTH, DEPTH + PT), "brass_dark")


def pillars(bm):
    for x, y in [RAIL_L[0], RAIL_R[0], RAIL_L[4], RAIL_R[4], (0, 84)]:
        cylinder(bm, x, y, 2.4, 0, DEPTH, 24)
        tube(bm, x, y, 3.4, 2.4, DEPTH * 0.45, DEPTH * 0.55, 24)   # a turned collar


part("Frame: pillars", pillars, "brass")

# the base and the columns the movement stands on
BASE_TOP = -215.0


def plinth(bm):
    # a two-step walnut plinth, in design coordinates: x across, y up, z depth
    def box(x0, x1, y0, y1, z0, z1):
        prism(bm, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1)
    box(-120, 120, BASE_TOP - 26, BASE_TOP - 8, -70, 100)
    box(-110, 110, BASE_TOP - 8, BASE_TOP, -60, 90)


part("Base", plinth, "wood")


# the columns run vertically (design y), so they are built as boxes of polygons in the x–y plane at two depths
def posts(bm):
    for x in (RAIL_L[0][0], RAIL_R[0][0]):
        for zc in (-PT / 2, DEPTH + PT / 2):
            # an upright square-turned post: a thin prism in x–y, extruded over a small depth around zc
            prism(bm, [(x - 3, BASE_TOP), (x + 3, BASE_TOP), (x + 3, RAIL_L[0][1]), (x - 3, RAIL_L[0][1])], zc - 3, zc + 3)
            prism(bm, [(x - 5, BASE_TOP), (x + 5, BASE_TOP), (x + 5, BASE_TOP + 6), (x - 5, BASE_TOP + 6)], zc - 5, zc + 5)


part("Frame: columns", posts, "brass")

# ---------------------------------------------------------------------------------------------- the going train
bx, by = pivots["barrel"]


def barrel(bm):
    wheel(bm, T[0]["wheel"], T[0]["module"], T[0]["z"], thick=2.0, spokes=6, hub=6.0)
    tube(bm, 0, 0, MS["barrelRadius"], MS["barrelRadius"] - 1.3, T[0]["z"] + 1.0, 24, 64)   # the drum, open at the front
    tube(bm, 0, 0, MS["barrelRadius"] + 0.8, MS["barrelRadius"] - 1.3, 23.0, 24, 64)          # its lip


barrel_ob = part("Barrel and great wheel", barrel, "brass")
barrel_ob.location = (bx, by, 0)


def mainspring(bm):
    r0, r1, coils, n = MS["arborRadius"] + 0.6, MS["barrelRadius"] - 1.6, MS["coils"], 900
    pts = []
    for i in range(n + 1):
        th = TAU * coils * i / n
        r = r0 + (r1 - r0) * i / n
        pts.append((r * math.cos(th), r * math.sin(th)))
    strip(bm, pts, MS["strip"] * 1.6, 11, 21.5)
    tube(bm, 0, 0, MS["arborRadius"], 1.0, 9, 22, 32)   # the barrel arbor's hook collar


spring_ob = part("Mainspring", mainspring, "blued")
spring_ob.location = (bx, by, 0)


def barrel_arbor(bm):
    cylinder(bm, 0, 0, 1.2, -PT, DEPTH + 9, 20)
    prism(bm, [(-1.6, -1.6), (1.6, -1.6), (1.6, 1.6), (-1.6, 1.6)], DEPTH + 6, DEPTH + 11)   # the winding square
    # the ratchet wheel: saw teeth, held by the click
    pts = []
    for k in range(24):
        a = TAU * k / 24
        pts.append((9.5 * math.cos(a), 9.5 * math.sin(a)))
        pts.append((12 * math.cos(a + 0.18), 12 * math.sin(a + 0.18)))
    prism(bm, pts, DEPTH + PT + 0.2, DEPTH + PT + 2.2)


arbor_ob = part("Barrel arbor and ratchet", barrel_arbor, "steel")
arbor_ob.location = (bx, by, 0)
part("Click", lambda bm: (bar(bm, (bx + 16, by + 10), (bx + 9, by + 11.5), 2.2, DEPTH + PT + 0.2, DEPTH + PT + 2.2),
                          cylinder(bm, bx + 16, by + 10, 1.6, DEPTH + PT, DEPTH + PT + 3, 16)), "steel")


def train_arbor(bm, z_wheel, teeth, module, pin_leaves, pin_module, pin_z, spokes=5):
    cylinder(bm, 0, 0, 1.0, -PT - 0.6, DEPTH + PT + 0.6, 16)
    wheel(bm, teeth, module, z_wheel, spokes=spokes)
    pinion(bm, pin_leaves, pin_module, pin_z)


centre_ob = part("Centre wheel", lambda bm: (train_arbor(bm, T[1]["z"], T[1]["wheel"], T[1]["module"], T[1]["pinion"], T[0]["module"], T[0]["z"]),
                                             cylinder(bm, 0, 0, 1.0, DEPTH, DEPTH + 13, 16)), "brass")
centre_ob.location = (*pivots["centre"], 0)
third_ob = part("Third wheel", lambda bm: train_arbor(bm, T[2]["z"], T[2]["wheel"], T[2]["module"], T[2]["pinion"], T[1]["module"], T[1]["z"]), "brass")
third_ob.location = (*pivots["third"], 0)


def escape_wheel(bm):
    cylinder(bm, 0, 0, 1.0, -PT - 0.6, DEPTH + PT + 0.6, 16)
    outer = [tuple(p) for p in ESC["wheel"]]   # Graham teeth: leaning forward, undercut backs
    rim_in = S["escapeRootRadius"] - 2.0
    inner = [(rim_in * x / math.hypot(x, y), rim_in * y / math.hypot(x, y)) for x, y in outer]
    z = T[3]["z"]
    ring(bm, outer, inner, z - 0.6, z + 0.6)
    for k in range(4):
        a = TAU * k / 4 + math.pi / 4
        bar(bm, (0, 0), (rim_in * 1.02 * math.cos(a), rim_in * 1.02 * math.sin(a)), 1.3, z - 0.6, z + 0.6)
    tube(bm, 0, 0, 2.6, 0.9, z - 1.0, z + 1.0, 24)
    pinion(bm, T[3]["pinion"], T[2]["module"], T[2]["z"])


escape_ob = part("Escape wheel", escape_wheel, "steel")
escape_ob.location = (*pivots["escape"], 0)

# ---------------------------------------------------------------------------------------------- the escapement
P_DIST = D["palletDistance"]
R_ARM = D["pallets"]["radius"]
ZE = T[3]["z"]


def anchor(bm):
    """The Graham anchor: a hub on the pallet arbor, two arms curved about it, and the pallets at their ends. The
    pallets' locking faces are arcs about the arbor and their impulse faces are where the teeth slide (src/escapement.js)."""
    cylinder(bm, 0, 0, 1.0, -PT - 6, DEPTH + PT + 0.6, 16)    # the pallet arbor (reaches back for the crutch)
    tube(bm, 0, 0, ESC["hubRadius"], 0.9, ZE - 1.2, ZE + 1.2, 28)
    for arm in ESC["arms"]:
        prism(bm, [tuple(p) for p in arm], ZE - 0.9, ZE + 0.9)
    th = ESC["palletThickness"] / 2
    for pallet in (ESC["entry"], ESC["exit"]):
        prism(bm, [tuple(p) for p in pallet], ZE - th, ZE + th)


anchor_ob = part("Anchor (pallets)", anchor, "steel")
anchor_ob.location = (*pivots["pallet"], 0)

# crutch: from the pallet arbor's back end, down behind the back plate to a fork around the pendulum rod
Z_PEND = -PT - 9.0
CRUTCH_LEN = 70.0


def crutch(bm):
    bar(bm, (0, 0), (0, -CRUTCH_LEN), 2.2, Z_PEND + 2.0, Z_PEND + 3.2)
    tube(bm, 0, 0, 2.4, 0.9, Z_PEND + 1.5, Z_PEND + 4.0, 20)
    for sx in (-1, 1):   # the fork's two tines straddle the rod
        bar(bm, (sx * 1.6, -CRUTCH_LEN + 1), (sx * 1.6, -CRUTCH_LEN - 6), 1.0, Z_PEND - 1.6, Z_PEND + 3.2)


crutch_ob = part("Crutch", crutch, "steel", parent=anchor_ob)
crutch_ob.location = (0, 0, 0)

# the pendulum: suspended from a cock on the back plate, just above the pallet arbor
SUSP = (pivots["pallet"][0], pivots["pallet"][1] + 8.0)
L = D["pendulumLength"]
BOB = S["pendulum"]


def pendulum(bm):
    bar(bm, (0, 0), (0, -7), 2.0, -0.15, 0.15)                     # suspension spring
    prism(bm, [(-2.5, -7), (2.5, -7), (2.5, -10), (-2.5, -10)], -1.2, 1.2)   # its lower chops
    bar(bm, (0, -10), (0, -L - BOB["bobRadius"] - 10), 1.6, -0.8, 0.8)     # the rod
    ellipsoid(bm, 0, -L, 0, BOB["bobRadius"], BOB["bobRadius"], BOB["bobThickness"] / 2)   # lenticular bob
    tube(bm, 0, -L - BOB["bobRadius"] - 7, 3.2, 0.8, -2.2, 2.2, 24)  # rating nut (sets the length)


pend_ob = part("Pendulum", pendulum, "bob", origin=(0, 0))
pend_ob.location = (SUSP[0], SUSP[1], Z_PEND)


def cock(bm):
    prism(bm, [(-9, -3), (9, -3), (9, 14), (-9, 14)], -PT - 4.0, -PT)
    prism(bm, [(-4, -2), (4, -2), (4, 3), (-4, 3)], Z_PEND - 1.5, -PT - 4.0)


cock_ob = part("Suspension cock", cock, "brass")
cock_ob.location = (SUSP[0], SUSP[1], 0)

# ---------------------------------------------------------------------------------------------- the motion work, dial and hands
MO = S["motion"]
ZM = DEPTH + PT


def cannon(bm):
    pinion(bm, MO["cannon"], MO["module1"], ZM + 1.4, 1.6)
    tube(bm, 0, 0, 1.9, 1.0, ZM + 0.2, ZM + 13.5, 24)


cannon_ob = part("Cannon pinion", cannon, "steel")
cannon_ob.location = (*pivots["centre"], 0)
mw = (A["minuteWheel"]["x"], A["minuteWheel"]["y"])


def minute_wheel(bm):
    wheel(bm, MO["minuteWheel"], MO["module1"], ZM + 1.4, thick=1.0, spokes=4, hub=2.2)
    pinion(bm, MO["minutePinion"], MO["module2"], ZM + 3.6, 2.0)
    cylinder(bm, 0, 0, 0.9, ZM - 0.2, ZM + 4.8, 16)


minute_wheel_ob = part("Minute wheel", minute_wheel, "brass")
minute_wheel_ob.location = (*mw, 0)


def hour_wheel(bm):
    wheel(bm, MO["hourWheel"], MO["module2"], ZM + 3.6, thick=1.0, spokes=4, hub=3.0)
    tube(bm, 0, 0, 3.0, 2.0, ZM + 3.0, ZM + 10.5, 24)


hour_wheel_ob = part("Hour wheel", hour_wheel, "brass")
hour_wheel_ob.location = (*pivots["centre"], 0)
ZD = ZM + 6.5   # the dial's plane
RING_OUT, RING_IN = 47.0, 37.0


def dial(bm):
    ring(bm, circle(0, 0, RING_OUT, 120), circle(0, 0, RING_IN, 120), ZD - 0.6, ZD)
    for k in range(60):   # minute track
        a = math.pi / 2 - TAU * k / 60
        w, l = (0.9, 2.8) if k % 5 == 0 else (0.35, 1.5)
        p0 = ((RING_OUT - 0.9) * math.cos(a), (RING_OUT - 0.9) * math.sin(a))
        p1 = ((RING_OUT - 0.9 - l) * math.cos(a), (RING_OUT - 0.9 - l) * math.sin(a))
        bar(bm, p0, p1, w, ZD, ZD + 0.15)
    ring(bm, circle(0, 0, RING_OUT - 0.5, 120), circle(0, 0, RING_OUT - 0.95, 120), ZD, ZD + 0.15)
    ring(bm, circle(0, 0, RING_OUT - 4.1, 120), circle(0, 0, RING_OUT - 4.5, 120), ZD, ZD + 0.15)
    # three feet carry the ring on the front plate's bars
    for x, y in ((0, RING_IN + 4.5), (-17.9, -38.4), (17.9, -38.4)):
        cylinder(bm, x, y, 1.2, DEPTH + PT, ZD - 0.6, 12)


dial_ob = part("Dial (chapter ring)", dial, "silver")
# the track's lines are black: a second material on the faces in front of the ring
bm = bmesh.new(); bm.from_mesh(dial_ob.data)
mi = add_material(dial_ob, "black")
for f in bm.faces:
    if f.calc_center_median().z > ZD + 0.05:
        f.material_index = mi
bm.to_mesh(dial_ob.data); bm.free()

# Roman numerals, radial, on the chapter ring
ROMAN = ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"]
numerals = []
for h, txt in enumerate(ROMAN):
    cu = bpy.data.curves.new(f"numeral {txt}", "FONT")
    cu.body = txt
    cu.size = 4.6
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    cu.extrude = 0.1
    ob = bpy.data.objects.new(f"Numeral {txt}", cu)
    scene.collection.objects.link(ob)
    a = TAU * h / 12
    ob.parent = root
    ob.location = ((RING_IN + 3.6) * math.sin(a), (RING_IN + 3.6) * math.cos(a), ZD + 0.2)
    ob.rotation_euler = (0, 0, -a)
    numerals.append(ob)
bpy.ops.object.select_all(action="DESELECT")
for ob in numerals:
    ob.select_set(True)
bpy.context.view_layer.objects.active = numerals[0]
bpy.ops.object.convert(target="MESH")
bpy.ops.object.join()
num_ob = bpy.context.view_layer.objects.active
num_ob.name = "Dial numerals"
num_ob.data.materials.clear()
num_ob.data.materials.append(M["black"])


def hand(length, width, tail, ring_r, z, hole):
    def build(bm):
        pts = [(0, length), (width * 0.25, length * 0.88), (width * 0.5, length * 0.55), (width * 0.75, length * 0.32),
               (ring_r * 0.55, ring_r * 0.9), (ring_r, 0), (width * 0.6, -tail), (-width * 0.6, -tail), (-ring_r, 0),
               (-ring_r * 0.55, ring_r * 0.9), (-width * 0.75, length * 0.32), (-width * 0.5, length * 0.55), (-width * 0.25, length * 0.88)]
        prism(bm, list(reversed(pts)), z, z + 0.5)
        tube(bm, 0, 0, hole + 0.9, hole, z - 0.4, z + 0.9, 24)
    return build


hour_ob = part("Hour hand", hand(29, 5.0, 7, 3.8, ZD + 1.2, 3.0), "blued")
hour_ob.location = (*pivots["centre"], 0)
minute_ob = part("Minute hand", hand(45, 3.6, 10, 3.0, ZD + 3.0, 1.9), "blued")
minute_ob.location = (*pivots["centre"], 0)

# ---------------------------------------------------------------------------------------------- the motion (drivers)
T_P = S["pendulum"]["period"]
W = D["impulse"]
HALF = math.pi / T[3]["wheel"]
st = S["start"]
START_MIN = (st["h"] % 12) * 60 + st["m"] + st["s"] / 60
PE = D["perEscape"]
t_expr = f"(frame - 1) / {FPS}"
x_expr = f"(2 * {t_expr} / {T_P})"
steps = f"(floor({x_expr} + {W}) - 1 + min(1, max(0, ({x_expr} - floor({x_expr} + {W}) + {W}) / {2 * W})) + 0.5)"
ESC = f"({HALF} * {steps})"   # clockwise angle of the escape wheel since frame 1


def drive(ob, clockwise_expr, about_origin=True):
    """Rotate ``ob`` about its local Z; ``clockwise_expr`` is its clockwise angle seen from the front."""
    fc = ob.driver_add("rotation_euler", 2)
    fc.driver.type = "SCRIPTED"
    fc.driver.expression = f"-({clockwise_expr})"
    return fc.driver


drivers = {
    "Pendulum": drive(pend_ob, f"{S['pendulum']['amplitude']} * sin(2 * pi * {t_expr} / {T_P})"),
    "Anchor (pallets)": drive(anchor_ob, f"{S['pendulum']['amplitude']} * sin(2 * pi * {t_expr} / {T_P})"),
    "Escape wheel": drive(escape_ob, ESC),
    "Third wheel": drive(third_ob, f"-{ESC} * {PE['third']}"),
    "Centre wheel": drive(centre_ob, f"{ESC} * {PE['centre']}"),
    "Barrel and great wheel": drive(barrel_ob, f"-{ESC} * {PE['barrel']}"),
    "Mainspring": drive(spring_ob, f"-{ESC} * {PE['barrel']} / 2"),
    "Cannon pinion": drive(cannon_ob, f"{ESC} * {PE['centre']}"),
    "Minute wheel": drive(minute_wheel_ob, f"-{ESC} * {PE['centre']} * {MO['cannon']} / {MO['minuteWheel']}"),
    "Hour wheel": drive(hour_wheel_ob, f"{2 * math.pi * START_MIN / 720} + {ESC} * {PE['centre']} / {D['hourRatio']}"),
    "Hour hand": drive(hour_ob, f"{2 * math.pi * START_MIN / 720} + {ESC} * {PE['centre']} / {D['hourRatio']}"),
    "Minute hand": drive(minute_ob, f"{2 * math.pi * START_MIN / 60} + {ESC} * {PE['centre']}"),
}
not_simple = [k for k, d in drivers.items() if not d.is_simple_expression]
print("drivers:", len(drivers), "not simple (would need scripts enabled):", not_simple)

# ---------------------------------------------------------------------------------------------- camera, lights, save
cam_data = bpy.data.cameras.new("Camera")
cam_data.lens = 70
cam = bpy.data.objects.new("Camera", cam_data)
scene.collection.objects.link(cam)
import mathutils  # noqa: E402


def aim(loc, target):
    cam.location = loc
    cam.rotation_euler = (mathutils.Vector(target) - mathutils.Vector(loc)).to_track_quat("-Z", "Y").to_euler()


CENTRE = (0, 0, -0.078)   # the middle of the clock, base to finial, in metres
aim((0.42, -0.95, 0.05), CENTRE)
scene.camera = cam
for name, loc, energy, size in (("Key", (0.5, -0.6, 0.6), 45, 0.6), ("Fill", (-0.7, -0.4, 0.2), 14, 0.8), ("Rim", (0.0, 0.6, 0.5), 35, 0.5)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy, ld.size = energy, size
    lo = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(lo)
    lo.location = loc
    lo.rotation_euler = mathutils.Vector((-loc[0], -loc[1], -loc[2])).to_track_quat("-Z", "Y").to_euler()
world = bpy.data.worlds.new("World")
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = (0.42, 0.45, 0.50, 1)
bg.inputs["Strength"].default_value = 0.45
scene.world = world
scene.render.film_transparent = True
try:
    scene.view_settings.view_transform = "Standard"   # true colours, no highlight desaturation (the list is dynamic)
except TypeError as e:
    print("view transform left as is:", e)

os.makedirs(os.path.dirname(os.path.abspath(BLEND_OUT)), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND_OUT))

# the web model: geometry only (the page computes the motion), every part named
scene.frame_set(1)
os.makedirs(os.path.dirname(os.path.abspath(GLB_OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(GLB_OUT), export_format="GLB", export_animations=False, export_lights=False,
                          export_cameras=False, use_selection=False, export_apply=True, export_yup=True)

if RENDERS:
    os.makedirs(RENDERS, exist_ok=True)
    engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
        if eng in engines:
            try:
                scene.render.engine = eng
                break
            except TypeError:
                continue
    scene.render.resolution_x, scene.render.resolution_y = 1100, 1300
    scene.render.image_settings.file_format = "PNG"
    for f, name in ((1, "front_t0"), (16, "front_t0_5")):
        scene.frame_set(f)
        scene.render.filepath = os.path.join(RENDERS, name + ".png")
        bpy.ops.render.render(write_still=True)
    # a straight front view and a close-up of the escapement
    aim((0, -1.05, -0.078), CENTRE)
    scene.frame_set(1)
    scene.render.filepath = os.path.join(RENDERS, "front_straight.png")
    bpy.ops.render.render(write_still=True)
    cam_data.lens = 120
    aim((0.07, -0.30, 0.075), (0, 0, 0.045))
    scene.render.filepath = os.path.join(RENDERS, "escapement_closeup.png")
    bpy.ops.render.render(write_still=True)
print("built", BLEND_OUT, GLB_OUT, "engine", scene.render.engine)
