# The String Art winding machine, built parametrically in FreeCAD from src/hardware/params.json.
#
#   "C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe" hardware/cad/build_machine.py      (from string-art/)
#
# Writes
#   web/public/hardware/string-art-machine.FCStd   the assembly, every part a named object (to open and change)
#   web/public/hardware/stl/<part>.stl        each printed part, turned to its printing orientation, on the bed
#   web/public/hardware/machine.glb           the assembly for the web page (FreeCAD's glTF writer turns mm into m
#                                             and Z-up into Y-up itself)
#   web/public/hardware/parts.json            the printed parts: quantity, printed size, solid volume
#
# Object names start with a letter the page colours by: W wood, P printed, M motor, A aluminium/steel, E electronics,
# B the nail board, N nails, T thread and tube.
#
# Coordinates: origin at the board's centre on the top face of the base; +Y towards the tower (nail 0); Z up.
# The guide's moving parts are drawn at Z = 10 mm (tube tip 10 mm above the board), Y = -8 mm (waiting inside the ring).
#
# freecadcmd runs this file with __name__ set to the file's name, not "__main__", so main() is called unconditionally.

import json, math, os, sys
import FreeCAD as App
import Part, Mesh, MeshPart, Import

V = App.Vector
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.getcwd(), "hardware", "cad")
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
P = json.load(open(os.path.join(ROOT, "src", "hardware", "params.json"), encoding="utf-8"))

# ------------------------------------------------------------------ helpers
def box(x0, y0, z0, x1, y1, z1):
    return Part.makeBox(x1 - x0, y1 - y0, z1 - z0, V(x0, y0, z0))

def cyl(r, z0, z1, x=0.0, y=0.0):
    return Part.makeCylinder(r, z1 - z0, V(x, y, z0))

def cyl_y(r, y0, y1, x=0.0, z=0.0):
    return Part.makeCylinder(r, y1 - y0, V(x, y0, z), V(0, 1, 0))

def cyl_x(r, x0, x1, y=0.0, z=0.0):
    return Part.makeCylinder(r, x1 - x0, V(x0, y, z), V(1, 0, 0))

def cut(s, *tools):
    for t in tools:
        s = s.cut(t)
    return s

def fuse(*shapes):
    s = shapes[0]
    for t in shapes[1:]:
        s = s.fuse(t)
    return s.removeSplitter()

def slot_z(x0, y0, x1, y1, r, z0, z1):
    """a vertical slot (stadium) from (x0, y0) to (x1, y1), width 2r"""
    L = math.hypot(x1 - x0, y1 - y0)
    s = fuse(cyl(r, z0, z1, x0, y0), cyl(r, z0, z1, x1, y1))
    if L > 0:
        b = box(0, -r, z0, L, r, z1)
        b.rotate(V(0, 0, 0), V(0, 0, 1), math.degrees(math.atan2(y1 - y0, x1 - x0)))
        b.translate(V(x0, y0, 0))
        s = fuse(s, b)
    return s

def hull_z(circles, z0, z1, n=96):
    """a vertical prism over the convex hull of circles [(x, y, r), …]"""
    pts = []
    for cx, cy, r in circles:
        for i in range(n):
            a = 2 * math.pi * i / n
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    pts = sorted(set(pts))
    def half(ps):
        h = []
        for p in ps:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0]) <= 0:
                h.pop()
            h.append(p)
        return h
    lower, upper = half(pts), half(pts[::-1])
    ring = lower[:-1] + upper[:-1]
    wire = Part.makePolygon([V(x, y, z0) for x, y in ring] + [V(ring[0][0], ring[0][1], z0)])
    return Part.Face(wire).extrude(V(0, 0, z1 - z0))

def nema_holes(cx, cy, z0, z1, boss=11.5, screw=1.7):
    """the NEMA 17 pattern: a hole for the boss and four M3 holes 31 mm apart"""
    hs = [cyl(boss, z0, z1, cx, cy)]
    for dx in (-15.5, 15.5):
        for dy in (-15.5, 15.5):
            hs.append(cyl(screw, z0, z1, cx + dx, cy + dy))
    return hs

# ------------------------------------------------------------------ derived numbers
B, BASE, BR, PL, D, TW, G, MO = P["board"], P["base"], P["bearing"], P["platter"], P["drive"], P["tower"], P["guide"], P["motor"]
R = B["nailCircle"] / 2
pd = lambda teeth: teeth * D["beltPitch"] / math.pi
BIG_PD, SMALL_PD = pd(D["turntableTeeth"]), pd(D["motorTeeth"])

def belt_len(C):
    return 2 * C + math.pi * (BIG_PD + SMALL_PD) / 2 + (BIG_PD - SMALL_PD) ** 2 / (4 * C)

lo, hi = (BIG_PD + SMALL_PD) / 2, D["beltLength"] / 2
for _ in range(80):
    mid = (lo + hi) / 2
    lo, hi = (mid, hi) if belt_len(mid) < D["beltLength"] else (lo, mid)
CENTRE = (lo + hi) / 2                      # motor axis to turntable axis
MOTOR_X = -CENTRE

Z_PLATTER = BR["height"]                    # platter bottom
Z_BOARD = Z_PLATTER + PL["thickness"]       # board bottom
Z_TOP = Z_BOARD + B["thickness"]            # board top: Z = 0 of the G-code
ZM, YM = 10.0, -8.0                         # where the guide is drawn
TUBE_TIP = Z_TOP + ZM
TUBE_Y = R + YM
ARM_Z0 = TUBE_TIP + G["tubeLength"] - 8     # the arm clamps the top 8 mm of the tube
ARM_Z1 = ARM_Z0 + 10
SHELF_Z0 = ARM_Z1 + 10                      # MGN9 rail (6.5) + carriage, hanging under the shelf
SHELF_Z1 = SHELF_Z0 + 8
CARR_Y = TUBE_Y + G["armReach"]             # centre of the MGN9 carriage
EX_Y0 = TW["y"] + 10                        # front face of the 2040 extrusion
EX_W, EX_D = TW["extrusion"][1], TW["extrusion"][0]
PLATE_Y1 = EX_Y0 - 13                       # MGN12 rail 8 + carriage: the carriage face
PLATE_Y0 = PLATE_Y1 - 8
LEAD_X, LEAD_Y = 38.0, EX_Y0 + 1
YMOTOR = (18.0, PLATE_Y0 - 26.0)
# the carriage travels from Y = -14 (deepest wait inside the ring) to Y = +30 (homed, towards the tower); the belt clamp
# (16 mm long) must stay between the idler and the motor pulley (radius 6.4) over all of it
CARR_MIN, CARR_MAX = R - 14 + G["armReach"], R + 30 + G["armReach"]
IDLER = (18.0, CARR_MIN - 8 - 6.4 - 2)
assert YMOTOR[1] > CARR_MAX + 8 + 6.4, "the Y motor pulley is in the carriage's way: shorten the arm"

parts = []          # (name, shape, print rotation [(axis, deg)], qty) for printed parts
assembly = []       # (name, shape)

def printed(name, shape, rot=(), qty=1, extra_positions=()):
    parts.append((name, shape, rot, qty))
    assembly.append(("P_" + name, shape))
    for i, pl in enumerate(extra_positions):
        s = shape.copy(); s.Placement = pl.multiply(s.Placement)
        assembly.append(("P_%s_%d" % (name, i + 2), s))

def bought(prefix, name, shape):
    assembly.append((prefix + "_" + name, shape))

# ------------------------------------------------------------------ wood: base, platter, nail board
def base():
    y0, y1, w = -BASE["front"], BASE["back"], BASE["width"] / 2
    s = box(-w, y0, -BASE["thickness"], w, y1, 0)
    return cut(s, hull_z([(0, 0, 62), (MOTOR_X, 0, 16)], -30, 5))   # pulleys and belt pass through

bought("W", "base", base())
for sx in (-1, 1):
    for y in (-BASE["front"] + 45, BASE["back"] - 45):
        bought("W", "foot_%s%d" % ("l" if sx < 0 else "r", int(y)), cyl(20, -BASE["thickness"] - BASE["footHeight"], -BASE["thickness"], sx * (BASE["width"] / 2 - 45), y))

def bearing():
    s = BR["size"] / 2
    plate = cut(box(-s, -s, 0, s, s, BR["height"]), cyl(BR["innerHole"] / 2, -1, BR["height"] + 1))
    return plate

bought("A", "lazy_susan_bearing", bearing())
platter = cut(cyl(PL["diameter"] / 2, Z_PLATTER, Z_BOARD), cyl(PL["dowel"] / 2 + 0.1, Z_PLATTER - 1, Z_BOARD + 1),
              cyl(PL["magnetDiameter"] / 2, Z_PLATTER - 1, Z_PLATTER + 3, 0, -PL["magnetRadius"]))
bought("W", "platter", platter)
bought("A", "centre_dowel", cyl(PL["dowel"] / 2, -9, Z_BOARD + PL["dowelProud"]))
bought("E", "magnet", cyl(PL["magnetDiameter"] / 2, Z_PLATTER, Z_PLATTER + 3, 0, -PL["magnetRadius"]))
bought("B", "nail_board", cyl(B["diameter"] / 2, Z_BOARD, Z_TOP))
nails = []
for i in range(B["nails"]):
    t = 2 * math.pi * i / B["nails"]
    x, y, r = R * math.sin(t), R * math.cos(t), B["nailDiameter"] / 2
    hexagon = Part.makePolygon([V(x + r * math.cos(k * math.pi / 3), y + r * math.sin(k * math.pi / 3), Z_TOP) for k in range(7)])
    nails.append(Part.Face(hexagon).extrude(V(0, 0, B["nailHeight"])))        # six-sided: light in the web view
assembly.append(("N_nails", Part.makeCompound(nails)))

# ------------------------------------------------------------------ printed: turntable pulley (160T GT2)
def gt2_pulley(teeth, z0, z1):
    """a GT2 tooth ring between z0 and z1: outside diameter = pitch diameter − 0.508; each gap a 0.555 mm radius
    groove 0.75 mm deep (the belt tooth). Good for printing at 0.4 mm nozzle with 0.1 mm layers."""
    od = pd(teeth) - 0.508
    ring = cyl(od / 2, z0, z1)
    cuts = []
    rc = od / 2 - 0.75 + 0.555
    for i in range(teeth):
        a = 2 * math.pi * i / teeth
        cuts.append(cyl(0.555, z0 - 1, z1 + 1, rc * math.cos(a), rc * math.sin(a)))
    return ring.cut(Part.makeCompound(cuts))

def turntable_pulley():
    # assembly position: hub against the platter's underside (z = Z_PLATTER), teeth below, inside the base's cut-out
    hub = cyl(70, 0, Z_PLATTER)
    fl_top = cyl(53, -1, 0)
    teeth = gt2_pulley(D["turntableTeeth"], -1 - D["beltWidth"] - 1, -1)
    od = pd(D["turntableTeeth"]) - 0.508
    z = -1 - D["beltWidth"] - 1
    fl_bot = Part.makeCone(od / 2, 53, 2.3, V(0, 0, z - 2.3), V(0, 0, 1))   # 45° flange: prints without support
    fl_bot.rotate(V(0, 0, z - 1.15), V(1, 0, 0), 180)
    s = fuse(hub, fl_top, teeth, fl_bot)
    holes = [cyl(PL["dowel"] / 2 + 0.15, -20, 20)]
    for k in range(6):                                  # lightening holes between the centre and the screws
        a = math.pi * k / 3 + math.pi / 6
        holes.append(cyl(11, -20, 20, 34 * math.cos(a), 34 * math.sin(a)))
    for k in range(6):
        a = math.pi * k / 3
        holes.append(cyl(2.25, -20, 20, 60 * math.cos(a), 60 * math.sin(a)))
    return cut(s, *holes)

printed("turntable_pulley", turntable_pulley(), rot=[((1, 0, 0), 180)])
# the web view shows the pulley without its 160 tooth grooves (they are 90 % of its triangles); the STL keeps them
DISPLAY = {"P_turntable_pulley": cut(fuse(cyl(70, 0, Z_PLATTER), cyl(53, -10.3, 0), cyl((pd(D["turntableTeeth"]) - 0.508) / 2, -9, -1)),
                                     cyl(PL["dowel"] / 2 + 0.15, -20, 20))}

def motor_plate():
    # under the base, the motor hangs from it; slotted holes along X tension the belt
    z0, z1 = -BASE["thickness"] - 6, -BASE["thickness"]
    s = box(MOTOR_X - 40, -35, z0, MOTOR_X + 40, 35, z1)
    hs = nema_holes(MOTOR_X, 0, z0 - 1, z1 + 1)
    for sx in (-1, 1):
        for sy in (-1, 1):
            hs.append(slot_z(MOTOR_X + sx * 33 - 4, sy * 28, MOTOR_X + sx * 33 + 4, sy * 28, 2.25, z0 - 1, z1 + 1))
    return cut(s, *hs)

printed("motor_plate", motor_plate())

def turn_button():
    # stands on the platter's rim beside the board; its tab turns over the board's edge and holds it down
    r0 = B["diameter"] / 2 + 3
    col = box(r0, -10, Z_BOARD, r0 + 20, 10, Z_TOP + 4)
    tab = box(r0 - 9, -10, Z_TOP, r0 + 20, 10, Z_TOP + 4)
    return cut(fuse(col, tab), cyl(2.25, Z_BOARD - 1, Z_TOP + 5, r0 + 10, 0))

tb = turn_button()
tb_pl = []
for k in (1, 2):
    pl = App.Placement(V(0, 0, 0), App.Rotation(V(0, 0, 1), 120 * k))
    tb_pl.append(pl)
# the first stands at +X; the other two at 120° and 240°
printed("turn_button", tb, rot=[((1, 0, 0), 180)], qty=3, extra_positions=tb_pl)   # tab on the bed: no overhang

def hall_holder():
    y = -PL["magnetRadius"]
    s = box(-10, y - 12, 0, 10, y + 12, 6)
    return cut(s, box(-2.6, y - 2, 3, 2.6, y + 2, 7), cyl(2.25, -1, 7, 0, y - 7), cyl(2.25, -1, 7, 0, y + 7.5))

printed("hall_holder", hall_holder())

# ------------------------------------------------------------------ the tower
EX = cut(box(-EX_W / 2, EX_Y0, 0, EX_W / 2, EX_Y0 + EX_D, TW["height"]))
bought("A", "extrusion_2040", EX)
bought("A", "mgn12_rail", box(-6, EX_Y0 - 8, 40, 6, EX_Y0, 40 + TW["zRail"]))

def tower_foot(side):
    x0 = side * EX_W / 2
    x1 = x0 + side * 45
    lo_, hi_ = min(x0, x1), max(x0, x1)
    flange = box(lo_, EX_Y0, 0, hi_, EX_Y0 + EX_D, 6)
    wall = box(x0 + (0 if side > 0 else -6), EX_Y0, 0, x0 + (6 if side > 0 else 0), EX_Y0 + EX_D, 50)
    gus_pts = [V(x0, EX_Y0 + 7, 6), V(x0 + side * 40, EX_Y0 + 7, 6), V(x0, EX_Y0 + 7, 46)]
    gus = Part.Face(Part.makePolygon(gus_pts + [gus_pts[0]])).extrude(V(0, 6, 0))
    s = fuse(flange, wall, gus)
    hs = [cyl(2.25, -1, 7, x0 + side * 32, EX_Y0 + EX_D / 2)]
    for z in (15, 37):
        hs.append(cyl_x(2.7, x0 - 8, x0 + 8, EX_Y0 + EX_D / 2, z))
    return cut(s, *hs)

printed("tower_foot_left", tower_foot(-1), rot=[((0, 1, 0), 0)])
printed("tower_foot_right", tower_foot(1), rot=[((0, 1, 0), 0)])

def z_motor_mount():
    z0, z1 = TW["height"], TW["height"] + 6
    s = box(-EX_W / 2, LEAD_Y - 21, z0, LEAD_X + 24, EX_Y0 + EX_D, z1)
    hs = nema_holes(LEAD_X, LEAD_Y, z0 - 1, z1 + 1)
    hs += [cyl(2.7, z0 - 1, z1 + 1, -10, EX_Y0 + EX_D / 2), cyl(2.7, z0 - 1, z1 + 1, 10, EX_Y0 + EX_D / 2)]
    return cut(s, *hs)

printed("z_motor_mount", z_motor_mount())
bought("M", "z_motor_leadscrew", fuse(box(LEAD_X - MO["size"] / 2, LEAD_Y - MO["size"] / 2, TW["height"] + 6, LEAD_X + MO["size"] / 2, LEAD_Y + MO["size"] / 2, TW["height"] + 6 + MO["length"]),
                                      cyl(4, TW["height"] + 6 - 200, TW["height"] + 6, LEAD_X, LEAD_Y)))

def z_carriage():
    # one printed L: a vertical plate on the MGN12H carriage, a shelf reaching over the board that carries the Y rail
    # underneath and the Y motor on top, and a tab with the lead-screw nut
    plate = box(-30, PLATE_Y0, SHELF_Z0, 62, PLATE_Y1, SHELF_Z0 + 60)
    shelf = box(-25, IDLER[1] - 15, SHELF_Z0, 47, PLATE_Y1, SHELF_Z1)
    tab = box(LEAD_X - 15, PLATE_Y1, SHELF_Z0, LEAD_X + 15, LEAD_Y + 15, SHELF_Z0 + 6)
    gussets = []
    for x in (-25, 41):
        pts = [V(x, PLATE_Y0, SHELF_Z1), V(x, PLATE_Y0 - 50, SHELF_Z1), V(x, PLATE_Y0, SHELF_Z1 + 45)]
        gussets.append(Part.Face(Part.makePolygon(pts + [pts[0]])).extrude(V(6, 0, 0)))
    s = fuse(plate, shelf, tab, *gussets)
    hs = nema_holes(YMOTOR[0], YMOTOR[1], SHELF_Z0 - 1, SHELF_Z1 + 1)
    hs.append(cyl(2.6, SHELF_Z0 - 1, SHELF_Z1 + 1, IDLER[0], IDLER[1]))                     # M5 idler bolt
    hs.append(cyl(5.25, SHELF_Z0 - 1, SHELF_Z0 + 7, LEAD_X, LEAD_Y))                        # lead screw
    for a in range(4):
        t = math.pi / 4 + a * math.pi / 2
        hs.append(cyl(1.7, SHELF_Z0 - 1, SHELF_Z0 + 7, LEAD_X + 8 * math.cos(t), LEAD_Y + 8 * math.sin(t)))
    for y in range(int(IDLER[1] + 5), int(PLATE_Y0 - 10), 20):                               # MGN9 rail screws, M3
        hs.append(cyl(1.7, SHELF_Z0 - 1, SHELF_Z1 + 1, 0, y))
    for dx in (-10, 10):                                                                      # MGN12H carriage, M3
        for dz in (10, 30):
            hs.append(cyl_y(1.7, PLATE_Y0 - 1, PLATE_Y1 + 1, dx, SHELF_Z0 + 15 + dz))
    return cut(s, *hs)

printed("z_carriage", z_carriage(), rot=[((1, 0, 0), 0)])
bought("A", "mgn12h_carriage", box(-13.5, PLATE_Y1, SHELF_Z0 + 10, 13.5, EX_Y0 - 8, SHELF_Z0 + 55))
bought("A", "mgn9_rail", box(-4.5, IDLER[1] - 10, SHELF_Z0 - 6.5, 4.5, IDLER[1] - 10 + TW["yRail"], SHELF_Z0))
bought("A", "mgn9h_carriage", box(-10, CARR_Y - 20, ARM_Z1, 10, CARR_Y + 20, SHELF_Z0 - 2))
bought("M", "y_motor", box(YMOTOR[0] - MO["size"] / 2, YMOTOR[1] - MO["size"] / 2, SHELF_Z1, YMOTOR[0] + MO["size"] / 2, YMOTOR[1] + MO["size"] / 2, SHELF_Z1 + MO["length"]))
bought("A", "y_pulley", cyl(6.4, SHELF_Z0 - 16, SHELF_Z0, YMOTOR[0], YMOTOR[1]))
bought("A", "y_idler", cyl(6.4, SHELF_Z0 - 16, SHELF_Z0 - 2, IDLER[0], IDLER[1]))
belt_z = SHELF_Z0 - 9
bought("A", "y_belt", fuse(box(YMOTOR[0] + 6.4, IDLER[1], belt_z - 3, YMOTOR[0] + 7.8, YMOTOR[1], belt_z + 3),
                           box(YMOTOR[0] - 7.8, IDLER[1], belt_z - 3, YMOTOR[0] - 6.4, YMOTOR[1], belt_z + 3)))

def guide_arm():
    # bolts under the MGN9H carriage and reaches over the nails; at its tip a clamp for the brass guide tube with a
    # push-fit socket for the PTFE tube on top; a clamp on its side grips the Y belt
    # one flat underside (prints without supports); the beam is 14 mm deep for stiffness instead of a rib
    pad = box(-10, CARR_Y - 20, ARM_Z0 - 4, 10, CARR_Y + 20, ARM_Z1)
    beam = box(-7, TUBE_Y - 7, ARM_Z0 - 4, 7, CARR_Y, ARM_Z1)
    socket = cyl(6, ARM_Z1, ARM_Z1 + 8, 0, TUBE_Y)
    strand = YMOTOR[0] - 6.4 - 0.7                       # the belt's inner run
    clamp = box(10, CARR_Y - 8, ARM_Z0 - 4, strand + 4, CARR_Y + 8, belt_z + 4)
    s = fuse(pad, beam, socket, clamp)
    hs = [cyl(G["tubeOD"] / 2 + 0.1, ARM_Z0 - 5, ARM_Z1 + 1, 0, TUBE_Y),                     # tube, a press fit
          cyl(G["ptfeOD"] / 2 + 0.1, ARM_Z1 - 1, ARM_Z1 + 9, 0, TUBE_Y),                     # PTFE socket
          box(strand - 0.8, CARR_Y - 9, belt_z - 3.2, strand + 0.8, CARR_Y + 9, belt_z + 3.2)]
    for dx in (-7.5, 7.5):
        for dy in (-8, 8):
            hs.append(cyl(1.7, ARM_Z0 - 5, ARM_Z1 + 1, dx, CARR_Y + dy))
    return cut(s, *hs)

printed("guide_arm", guide_arm())
bought("T", "brass_guide_tube", cut(cyl(G["tubeOD"] / 2, TUBE_TIP, TUBE_TIP + G["tubeLength"], 0, TUBE_Y), cyl(G["tubeID"] / 2, TUBE_TIP - 1, TUBE_TIP + G["tubeLength"] + 1, 0, TUBE_Y)))

# thread supply. The thread cone stands still on a shelf behind the tower and the thread comes off over its top, up
# through an eyelet and between two tension discs (as on a sewing machine): the tension then hardly changes as the cone
# empties, unlike a felt brake on a turning spool, which pulls 2.5 times harder near the core (see the build page's
# tension working). A dancer arm riding on the thread is the thread-break switch.
SP = P["spool"]
BACK_Y = EX_Y0 + EX_D
SHELF_TOP = 120.0
CONE_Y = BACK_Y + 6 + SP["coneBase"] / 2 + 2
CONE_TOP = SHELF_TOP + SP["coneHeight"]
EYE_Z = CONE_TOP + SP["eyeletAbove"]
POST = (-14.0, EYE_Z - 22)                         # x, z of the tension-disc post

def cone_stand():
    plate = box(-EX_W / 2, BACK_Y, SHELF_TOP - 36, EX_W / 2, BACK_Y + 6, SHELF_TOP + 4)
    shelf = box(-SP["coneBase"] / 2 - 2, BACK_Y, SHELF_TOP - 6, SP["coneBase"] / 2 + 2, CONE_Y + SP["coneBase"] / 2 + 2, SHELF_TOP)
    pts = [V(-3, BACK_Y + 6, SHELF_TOP - 6), V(-3, CONE_Y + 18, SHELF_TOP - 6), V(-3, BACK_Y + 6, SHELF_TOP - 34)]
    gus = Part.Face(Part.makePolygon(pts + [pts[0]])).extrude(V(6, 0, 0))
    s = fuse(plate, shelf, gus)
    return cut(s, cyl_y(2.7, BACK_Y - 1, BACK_Y + 7, -10, SHELF_TOP - 26), cyl_y(2.7, BACK_Y - 1, BACK_Y + 7, 10, SHELF_TOP - 26),
               cyl(4.2, SHELF_TOP - 7, SHELF_TOP + 1, 0, CONE_Y))                      # the cone's pin is an M8 bolt: prints flat, no supports

def tensioner_bracket():
    plate = box(-EX_W / 2, BACK_Y, EYE_Z - 36, EX_W / 2, BACK_Y + 6, EYE_Z + 4)
    arm = box(-8, BACK_Y + 6, EYE_Z - 3, 8, CONE_Y + 8, EYE_Z + 3)
    eye = cyl(6, EYE_Z - 3, EYE_Z + 3, 0, CONE_Y)
    boss = cyl_y(5, BACK_Y + 6, BACK_Y + 12, POST[0], POST[1])
    s = fuse(plate, arm, eye, boss)
    return cut(s, cyl(2.1, EYE_Z - 4, EYE_Z + 4, 0, CONE_Y),                        # eyelet: smooth, Ø 4.2
               cyl_y(1.6, BACK_Y - 1, BACK_Y + 13, POST[0], POST[1]),                # M4 post, tapped
               cyl_y(2.7, BACK_Y - 1, BACK_Y + 7, 10, EYE_Z - 26))

printed("cone_stand", cone_stand(), rot=[((1, 0, 0), 90)])          # plate on the bed
printed("tensioner_bracket", tensioner_bracket(), rot=[((1, 0, 0), 90)])   # plate on the bed, post upright
bought("A", "cone_pin", cyl(4, SHELF_TOP - 6, SHELF_TOP + 54, 0, CONE_Y))
bought("T", "thread_cone", cut(Part.makeCone(SP["coneBase"] / 2, SP["coneTop"] / 2, SP["coneHeight"], V(0, CONE_Y, SHELF_TOP)), cyl(9, SHELF_TOP - 1, CONE_TOP + 1, 0, CONE_Y)))
bought("A", "tension_discs", fuse(cyl_y(8, BACK_Y + 14, BACK_Y + 15, POST[0], POST[1]), cyl_y(8, BACK_Y + 16, BACK_Y + 17, POST[0], POST[1]),
                                  cyl_y(4, BACK_Y + 17, BACK_Y + 27, POST[0], POST[1]), cyl_y(2, BACK_Y + 6, BACK_Y + 32, POST[0], POST[1])))

DANCER_Z = 150.0
def dancer_bracket():
    x0 = -EX_W / 2
    plate = box(x0 - 6, EX_Y0, DANCER_Z - 20, x0, EX_Y0 + EX_D, DANCER_Z + 30)
    boss = cyl_x(5, x0 - 16, x0 - 6, EX_Y0 + EX_D / 2, DANCER_Z + 20)
    sw = box(x0 - 26, EX_Y0, DANCER_Z - 20, x0 - 6, EX_Y0 + 4, DANCER_Z)                         # microswitch seat
    s = fuse(plate, boss, sw)
    return cut(s, cyl_x(1.6, x0 - 17, x0 + 1, EX_Y0 + EX_D / 2, DANCER_Z + 20),
               cyl_x(2.7, x0 - 7, x0 + 1, EX_Y0 + EX_D / 2, DANCER_Z - 10),
               cyl_y(1.2, EX_Y0 - 1, EX_Y0 + 5, x0 - 12, DANCER_Z - 6), cyl_y(1.2, EX_Y0 - 1, EX_Y0 + 5, x0 - 21.5, DANCER_Z - 6))

printed("dancer_bracket", dancer_bracket(), rot=[((0, 1, 0), 90)])

def dancer_arm():
    x0 = -EX_W / 2 - 16
    yc, zc = EX_Y0 + EX_D / 2, DANCER_Z + 20
    hub = cyl_x(5, x0 - 6, x0, yc, zc)
    lever = box(x0 - 6, yc - 3, zc - 70, x0, yc + 3, zc)
    eye = cyl_x(5, x0 - 6, x0, yc, zc - 70)
    s = fuse(hub, lever, eye)
    return cut(s, cyl_x(1.75, x0 - 7, x0 + 1, yc, zc), cyl_x(2.5, x0 - 7, x0 + 1, yc, zc - 70))

printed("dancer_arm", dancer_arm(), rot=[((0, 1, 0), 90)])
bought("E", "break_switch", box(-EX_W / 2 - 26, EX_Y0 - 6, DANCER_Z - 18, -EX_W / 2 - 6, EX_Y0, DANCER_Z - 8))

# PTFE tube from the dancer to the guide, drawn as three straight runs
def tube_run(a, b, r):
    d = V(*b) - V(*a)
    return Part.makeCylinder(r, d.Length, V(*a), d)

pts = [(-EX_W / 2 - 19, EX_Y0 + EX_D / 2, DANCER_Z - 50), (-60, TUBE_Y + 60, ARM_Z1 + 80), (0, TUBE_Y + 10, ARM_Z1 + 40), (0, TUBE_Y, ARM_Z1 + 8)]
bought("T", "ptfe_tube", Part.makeCompound([tube_run(pts[i], pts[i + 1], G["ptfeOD"] / 2) for i in range(len(pts) - 1)]))

# turntable drive and electronics
bought("M", "x_motor", box(MOTOR_X - MO["size"] / 2, -MO["size"] / 2, -BASE["thickness"] - 6 - MO["length"], MOTOR_X + MO["size"] / 2, MO["size"] / 2, -BASE["thickness"] - 6))
bought("A", "x_pulley_20t", cyl(SMALL_PD / 2 + 1, -16, 0, MOTOR_X, 0))
belt_c = -1 - D["beltWidth"] / 2 - 1
bought("A", "x_belt", Part.makeCompound([
    tube_run((MOTOR_X, SMALL_PD / 2, belt_c), (0, BIG_PD / 2, belt_c), 0.8),
    tube_run((MOTOR_X, -SMALL_PD / 2, belt_c), (0, -BIG_PD / 2, belt_c), 0.8)]))
bought("E", "controller_box", box(-BASE["width"] / 2 + 30, BASE["back"] - 170, 0, -BASE["width"] / 2 + 150, BASE["back"] - 80, 45))
bought("E", "power_supply", box(BASE["width"] / 2 - 150, BASE["back"] - 150, 0, BASE["width"] / 2 - 30, BASE["back"] - 90, 36))

# ------------------------------------------------------------------ outputs
def main():
    stl_dir = os.path.join(ROOT, "web", "public", "hardware", "stl")
    os.makedirs(stl_dir, exist_ok=True)
    doc = App.newDocument("StringArtMachine")
    objs = []
    for name, shape in assembly:
        o = doc.addObject("Part::Feature", name)
        o.Shape = shape
        o.Label = name
        objs.append(o)
    doc.recompute()
    pub = os.path.join(ROOT, "web", "public", "hardware")
    doc.saveAs(os.path.join(pub, "string-art-machine.FCStd"))
    for f in os.listdir(pub):
        if f.endswith(".FCBak"):
            os.remove(os.path.join(pub, f))

    info = []
    for name, shape, rot, qty in parts:
        s = shape.copy()
        for axis, deg in rot:
            if deg:
                s.rotate(V(0, 0, 0), V(*axis), deg)
        bb = s.BoundBox
        s.translate(V(-bb.XMin - bb.XLength / 2, -bb.YMin - bb.YLength / 2, -bb.ZMin))
        mesh = MeshPart.meshFromShape(Shape=s, LinearDeflection=0.02, AngularDeflection=0.25, Relative=False)
        mesh.write(os.path.join(stl_dir, name + ".stl"))
        bb = s.BoundBox
        info.append({"id": name, "qty": qty, "file": "stl/" + name + ".stl",
                     "size": [round(bb.XLength, 1), round(bb.YLength, 1), round(bb.ZLength, 1)],
                     "volume": round(shape.Volume / 1000, 1), "triangles": mesh.CountFacets})
        print("part %-20s %6.1f cm3  %s" % (name, shape.Volume / 1000, info[-1]["size"]))

    web = App.newDocument("StringArtMachineWeb")
    wobjs = []
    for o in objs:
        w = web.addObject("Part::Feature", o.Label)
        w.Shape = DISPLAY.get(o.Label, o.Shape)
        w.Label = o.Label
        w.Shape.tessellate(1.0 if o.Label.startswith(("N_", "W_", "B_")) else 0.5)
        wobjs.append(w)
    web.recompute()
    Import.export(wobjs, os.path.join(ROOT, "web", "public", "hardware", "machine.glb"))
    with open(os.path.join(ROOT, "web", "public", "hardware", "parts.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"centreDistance": round(CENTRE, 2), "boardTop": Z_TOP, "parts": info}, f, indent=1)
        f.write("\n")
    print("centre distance %.2f mm, board top z = %.1f mm, %d assembly objects" % (CENTRE, Z_TOP, len(objs)))

main()
