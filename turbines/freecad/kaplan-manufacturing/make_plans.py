# Turbine Lab — manufacturing plans for the Kaplan turbine, generated from the FreeCAD model (../kaplan.FCStd).
# Run from the repo root:
#   "C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe" turbines/freecad/kaplan-manufacturing/make_plans.py
# then build the PDF:  node turbines/freecad/kaplan-manufacturing/make_pdf.js
#
# Writes sheets/NN-*.svg (A3 landscape, mm), step/*.step (one per unique part, for CAM) and plans.json (the numbers
# behind the sheets). Every view is projected by FreeCAD's hidden-line removal (TechDraw.projectEx); sections are the
# model cut by a plane, with the cut faces hatched; every dimension and table value is measured from the model.
#
# The model is a teaching model. Materials, processes, tolerances and the wall thicknesses of parts the model shows as
# solid blocks (hub, bulb, duct, pylon) are engineering assumptions, stated on every sheet; not for construction.
import os, math, json, re, datetime
import FreeCAD as App, Part, TechDraw
from FreeCAD import Vector, Matrix, Placement, Rotation

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.getcwd(), "turbines", "freecad", "kaplan-manufacturing")
FC = os.path.abspath(os.path.join(HERE, "..", "kaplan.FCStd"))
DATA = json.load(open(os.path.join(HERE, "..", "data", "kaplan.json")))
OUT = os.path.join(HERE, "sheets"); os.makedirs(OUT, exist_ok=True)
STEP = os.path.join(HERE, "step"); os.makedirs(STEP, exist_ok=True)
DATE = "2026-11-06"; REV = "A"
AXIS_Y, AXIS_Z = 0.0, -1800.0           # the runner axis: parallel to X through (y, z) = (0, -1800) mm
INK, FAINT, HAT = "#111", "#666", "#333"

doc = App.openDocument(FC)
OBJ = {o.Label: o for o in doc.Objects if o.TypeId == "Part::Feature"}
def shp(label): return OBJ[label].Shape.copy()
def spec(label): return next(p for p in DATA["parts"] if p["name"] == label)

# ------------------------------------------------------------------ drawing primitives (sheet units: mm on A3)
W, H = 420.0, 297.0
def f(x): return "%.2f" % x
def esc(s): return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
class Sheet:
    def __init__(self, number, title, subtitle, scale="—", material="—", mass="—"):
        self.n, self.title, self.subtitle, self.scale, self.material, self.mass = number, title, subtitle, scale, material, mass
        self.body = []
    def add(self, s): self.body.append(s)
    def line(self, x1, y1, x2, y2, w=0.25, dash=None, color=INK):
        self.add('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s" stroke-width="%s"%s/>' % (f(x1), f(y1), f(x2), f(y2), color, w, ' stroke-dasharray="%s"' % dash if dash else ""))
    def text(self, x, y, s, size=2.6, anchor="start", weight=400, color=INK, rot=None, family="'IBM Plex Mono', 'Consolas', monospace"):
        t = ' transform="rotate(%s %s %s)"' % (rot, f(x), f(y)) if rot else ""
        self.add('<text x="%s" y="%s" font-size="%s" text-anchor="%s" font-weight="%s" fill="%s" font-family="%s"%s>%s</text>' % (f(x), f(y), size, anchor, weight, color, family, t, esc(s)))
    def rect(self, x, y, w, h, sw=0.3, fill="none"):
        self.add('<rect x="%s" y="%s" width="%s" height="%s" fill="%s" stroke="%s" stroke-width="%s"/>' % (f(x), f(y), f(w), f(h), fill, INK, sw))
    def arrow(self, x, y, dx, dy, ln=2.5, wd=0.8):
        L = math.hypot(dx, dy) or 1; dx /= L; dy /= L; bx, by = x - dx * ln, y - dy * ln
        self.add('<path d="M%s %s L%s %s L%s %s Z" fill="%s"/>' % (f(x), f(y), f(bx - dy * wd), f(by + dx * wd), f(bx + dy * wd), f(by - dx * wd), INK))
    def dim_h(self, x1, x2, y_feat1, y_feat2, y, label):
        """horizontal dimension between x1 and x2, drawn at height y, extension lines from the feature heights"""
        for x, yf in ((x1, y_feat1), (x2, y_feat2)):
            self.line(x, yf + (1 if y > yf else -1), x, y + (1.5 if y > yf else -1.5), 0.18)
        self.line(x1, y, x2, y, 0.18); self.arrow(x1, y, -1, 0); self.arrow(x2, y, 1, 0)
        self.text((x1 + x2) / 2, y - 1, label, 2.6, "middle")
    def dim_v(self, y1, y2, x_feat1, x_feat2, x, label):
        for yy, xf in ((y1, x_feat1), (y2, x_feat2)):
            self.line(xf + (1 if x > xf else -1), yy, x + (1.5 if x > xf else -1.5), yy, 0.18)
        self.line(x, y1, x, y2, 0.18); self.arrow(x, y1, 0, -1); self.arrow(x, y2, 0, 1)
        self.text(x - 1, (y1 + y2) / 2, label, 2.6, "middle", rot=-90)
    def table(self, x, y, cols, rows, size=2.3, rh=4.6, header=True):
        """cols: [(title, width, align)]; rows: lists of strings. Returns the y below the table."""
        tw = sum(c[1] for c in cols); n = len(rows) + (1 if header else 0)
        self.rect(x, y, tw, rh * n, 0.35)
        cx = x
        for i, (t, w, a) in enumerate(cols):
            if i: self.line(cx, y, cx, y + rh * n, 0.18)
            if header: self.text(cx + (1.2 if a == "start" else w / 2 if a == "middle" else w - 1.2), y + rh * 0.68, t, size * 0.92, a, 600, FAINT)
            cx += w
        for r, row in enumerate(rows):
            yy = y + rh * (r + (1 if header else 0))
            self.line(x, yy, x + tw, yy, 0.18 if r or not header else 0.3)
            cx = x
            for (t, w, a), cell in zip(cols, row):
                self.text(cx + (1.2 if a == "start" else w / 2 if a == "middle" else w - 1.2), yy + rh * 0.68, cell, size, a)
                cx += w
        return y + rh * n
    def paragraph(self, x, y, s, width_chars, size=2.4, lead=3.4, weight=400):
        words, line_ = s.split(" "), ""
        for wd in words:
            if len(line_ + " " + wd) > width_chars: self.text(x, y, line_.strip(), size, weight=weight); y += lead; line_ = wd
            else: line_ += " " + wd
        if line_.strip(): self.text(x, y, line_.strip(), size, weight=weight); y += lead
        return y
    def svg(self, total):
        s = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 297" width="420mm" height="297mm">',
             '<defs><pattern id="hatch" patternUnits="userSpaceOnUse" width="1.6" height="1.6" patternTransform="rotate(45)">'
             '<line x1="0" y1="0" x2="0" y2="1.6" stroke="%s" stroke-width="0.18"/></pattern>'
             '<pattern id="hatch2" patternUnits="userSpaceOnUse" width="1.6" height="1.6" patternTransform="rotate(-45)">'
             '<line x1="0" y1="0" x2="0" y2="1.6" stroke="%s" stroke-width="0.18"/></pattern>'
             '<pattern id="concrete" patternUnits="userSpaceOnUse" width="4" height="4"><circle cx="1" cy="1" r="0.25" fill="%s"/>'
             '<circle cx="3" cy="2.6" r="0.18" fill="%s"/><path d="M2 3.4 l0.5 -0.4 l0.3 0.5 z" fill="%s"/></pattern></defs>' % (HAT, HAT, HAT, HAT, HAT),
             '<rect x="0" y="0" width="420" height="297" fill="#fff"/>']
        s += self.body
        s.append(frame(self, total))
        s.append("</svg>")
        return "\n".join(s)

def frame(sh, total):
    out = []
    def L(x1, y1, x2, y2, w): out.append('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s" stroke-width="%s"/>' % (f(x1), f(y1), f(x2), f(y2), INK, w))
    def T(x, y, s, size, weight=400, anchor="start", color=INK):
        out.append('<text x="%s" y="%s" font-size="%s" font-weight="%s" text-anchor="%s" fill="%s" font-family="\'IBM Plex Mono\', \'Consolas\', monospace">%s</text>' % (f(x), f(y), size, weight, anchor, color, esc(s)))
    out.append('<rect x="20" y="10" width="390" height="277" fill="none" stroke="%s" stroke-width="0.7"/>' % INK)
    for x1, y1, x2, y2 in ((210, 3, 210, 10), (210, 287, 210, 294), (13, 148.5, 20, 148.5), (410, 148.5, 417, 148.5)): L(x1, y1, x2, y2, 0.5)
    # title block, bottom right: 180 × 38 mm
    x0, y0, w = 230.0, 249.0, 180.0
    out.append('<rect x="%s" y="%s" width="%s" height="38" fill="#fff" stroke="%s" stroke-width="0.7"/>' % (x0, y0, w, INK))
    L(x0, y0 + 13, x0 + w, y0 + 13, 0.3); L(x0, y0 + 21.5, x0 + w, y0 + 21.5, 0.3); L(x0, y0 + 30, x0 + w, y0 + 30, 0.3)
    for x in (x0 + 45, x0 + 90, x0 + 135): L(x, y0 + 13, x, y0 + 38, 0.3)
    T(x0 + 3, y0 + 6.5, sh.title, 4.4, 700); T(x0 + 3, y0 + 11, sh.subtitle, 2.4, 400, color=FAINT)
    cells = [("Drawing no.", "TL-KAP-%03d" % sh.n), ("Sheet", "%d / %d" % (sh.n + 1, total)), ("Scale (A3)", sh.scale), ("Rev.", REV),
             ("Material", sh.material), ("Mass", sh.mass), ("Units", "mm"), ("Date", DATE),
             ("General tol.", "ISO 2768-mK"), ("Welds", "ISO 13920-BF"), ("Projection", ""), ("Drawn", "Turbine Lab")]
    for i, (k, v) in enumerate(cells):
        cx, cy = x0 + (i % 4) * 45, y0 + 13 + (i // 4) * 8.5
        T(cx + 1.5, cy + 3, k, 1.9, 400, color=FAINT); T(cx + 1.5, cy + 7.2, v, 2.6 if len(v) < 22 else 2.1, 600)
    # first-angle symbol in the "Projection" cell
    px, py = x0 + 90 + 17, y0 + 30 + 4.3
    out.append('<path d="M%s %s L%s %s L%s %s L%s %s Z" fill="none" stroke="%s" stroke-width="0.3"/>' % (f(px), f(py - 1.2), f(px + 7), f(py - 2.6), f(px + 7), f(py + 2.6), f(px), f(py + 1.2), INK))
    out.append('<circle cx="%s" cy="%s" r="2.6" fill="none" stroke="%s" stroke-width="0.3"/><circle cx="%s" cy="%s" r="0.9" fill="none" stroke="%s" stroke-width="0.3"/>' % (f(px + 12), f(py), INK, f(px + 12), f(py), INK))
    # the warning strip above the title block
    out.append('<rect x="%s" y="%s" width="%s" height="6" fill="#fff4d6" stroke="%s" stroke-width="0.3"/>' % (x0, y0 - 6, w, INK))
    T(x0 + 2, y0 - 1.9, "TEACHING MODEL — materials, tolerances and wall thicknesses are assumptions. Not for construction.", 2.0, 600)
    return "\n".join(out)

# ------------------------------------------------------------------ views
def basis(R, U):
    R = Vector(R).normalize(); U = Vector(U).normalize(); N = R.cross(U)
    m = Matrix(R.x, R.y, R.z, 0, U.x, U.y, U.z, 0, N.x, N.y, N.z, 0, 0, 0, 0, 1)
    return m, N
def to_view(shape, R, U):
    m, _ = basis(R, U); s = shape.copy(); s.transformShape(m); return s
def project(shape_v, hidden=True):
    """hidden-line projection of a shape already in view coordinates (looking down -Z): visible and hidden edges"""
    r = TechDraw.projectEx(shape_v, Vector(0, 0, 1))
    vis = [e for i in (0, 1, 3) if r[i] for e in r[i].Edges]
    hid = [e for i in (5, 8) if r[i] for e in r[i].Edges] if hidden else []
    return vis, hid
def section_faces(shape_v):
    """the cut faces where the plane z = 0 passes through a shape in view coordinates"""
    faces = []
    try:
        wires = shape_v.slice(Vector(0, 0, 1), 0.0)
        if wires:
            fs = Part.makeFace(wires, "Part::FaceMakerBullseye")
            faces = fs.Faces if fs else []
    except Exception as e:
        print("   section faces failed:", e)
    return faces
def keep_far_half(shape_v):
    big = 1e5; box = Part.makeBox(2 * big, 2 * big, big, Vector(-big, -big, -big))
    parts = []
    for so in (shape_v.Solids or [shape_v]):
        try:
            c = so.common(box)
            if c.Volume > 1e-6: parts.append(c)
        except Exception: pass
    return Part.makeCompound(parts)

class View:
    """a projected view placed on a sheet: model mm (x right, y up) → sheet mm"""
    def __init__(self, edges_vis, edges_hid, faces, cx, cy, scale, bbox=None, hatch="hatch"):
        self.vis, self.hid, self.faces, self.k, self.hatch = edges_vis, edges_hid, faces, 1.0 / scale, hatch
        if bbox is None:
            pts = [p for e in edges_vis for p in e.discretize(Deflection=1.0)] + \
                  [p for fc in faces for e in fc.Edges for p in e.discretize(Deflection=2.0)]
            pts = pts or [Vector()]
            bbox = (min(p.x for p in pts), min(p.y for p in pts), max(p.x for p in pts), max(p.y for p in pts))
        self.bb = bbox; self.cx, self.cy = cx, cy
        self.mx, self.my = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    def P(self, x, y): return (self.cx + (x - self.mx) * self.k, self.cy - (y - self.my) * self.k)
    def path(self, edges):
        d = []
        for e in edges:
            pts = e.discretize(Deflection=max(0.2, 0.15 / self.k * 0.02)) if e.Length > 1e-6 else []
            if len(pts) < 2: continue
            d.append("M" + " L".join("%s %s" % tuple(f(c) for c in self.P(p.x, p.y)) for p in pts))
        return " ".join(d)
    def draw(self, sh, w_vis=0.35, w_hid=0.2, w_cut=0.55):
        for fc in self.faces:
            d = []
            for wire in fc.Wires:
                pts = wire.discretize(Deflection=0.5)          # in the wire's own order (edges may be reversed)
                if len(pts) > 2: d.append("M" + " L".join("%s %s" % tuple(f(c) for c in self.P(p.x, p.y)) for p in pts) + " Z")
            if d: sh.add('<path d="%s" fill="url(#%s)" fill-rule="evenodd" stroke="%s" stroke-width="%s"/>' % (" ".join(d), self.hatch, INK, w_cut))
        if self.hid: sh.add('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-dasharray="1.6 0.9"/>' % (self.path(self.hid), FAINT, w_hid))
        sh.add('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="round" stroke-linecap="round"/>' % (self.path(self.vis), INK, w_vis))
    def box(self):
        x0, y0 = self.P(self.bb[0], self.bb[3]); x1, y1 = self.P(self.bb[2], self.bb[1]); return x0, y0, x1, y1
    def label(self, sh, title, sub=None, dy=7):
        x0, y0, x1, y1 = self.box()
        sh.text((x0 + x1) / 2, y1 + dy, title, 3.4, "middle", 700)
        if sub: sh.text((x0 + x1) / 2, y1 + dy + 4, sub, 2.3, "middle", 400, FAINT)
    def centreline(self, sh, a, b):
        (x1, y1), (x2, y2) = self.P(*a), self.P(*b)
        sh.line(x1, y1, x2, y2, 0.18, "7 1.2 1 1.2", FAINT)

def make_view(shape, R, U, cx, cy, scale, section=False, hidden=True, hatch="hatch"):
    sv = to_view(shape, R, U)
    faces = []
    if section:
        faces = section_faces(sv); sv = keep_far_half(sv); hidden = False
    vis, hid = project(sv, hidden)
    return View(vis, hid, faces, cx, cy, scale, hatch=hatch)

# ------------------------------------------------------------------ the parts, their materials and masses
STEEL, CA6NM, CONCRETE = 7850.0, 7700.0, 2400.0
def area_mass(shape, t_mm, rho, full=1.0): return shape.Area / 2 * 1e-6 * t_mm * 1e-3 * rho * full   # one skin of a closed solid
blade, trunnion, hub = shp("River_Kaplan_Blade_0"), shp("River_Kaplan_Trunnion_0"), shp("River_Kaplan_Runner_Hub")
bulb, duct, vane = shp("River_Kaplan_Bulb_Nacelle"), shp("River_Kaplan_Duct"), shp("River_Kaplan_Guide_Vane_0")
pylon, base = shp("Support_Pylon"), shp("Gravity_Base")
def com(shape):
    return shape.Solids[0].CenterOfMass if shape.Solids else shape.BoundBox.Center
def lathe_inner(label, t):
    """the cavity of a revolved part with wall t: its exact profile section shrunk by t (2D offset) and revolved.
    A profile that reaches the axis is mirrored into the full section first, so the cavity is one closed void."""
    sp = spec(label); ax = "XYZ".index(sp["axis"]); oth = [i for i in range(3) if i != ax]
    start, sweep = (sp["arc"] or [0.0, 360.0])
    th = math.radians(start)
    def pt(a, r):
        p = [0.0, 0.0, 0.0]; p[ax] = a * 1000; p[oth[0]] = r * 1000 * math.cos(th); p[oth[1]] = r * 1000 * math.sin(th)
        return Vector(*p)
    prof = sp["profile"]
    on_axis = any(r < 1e-6 for a, r in prof)                    # a solid of revolution, not a ring like the duct
    if not on_axis: ring = [pt(a, r) for a, r in prof]; revolve = sweep
    else:
        half = list(prof)
        # a solid's profile may run along the axis between two poles; open it there, so the mirrored section has no slit
        n = len(half)
        for i in range(n):
            if half[i][1] < 1e-6 and half[(i + 1) % n][1] < 1e-6:
                half = half[i + 1:] + half[:i + 1]; break
        ring = [pt(a, r) for a, r in half] + [pt(a, -r) for a, r in reversed(half)]; revolve = 180.0
    clean = []
    for q in ring:
        if not clean or (q - clean[-1]).Length > 1e-6: clean.append(q)
    if (clean[0] - clean[-1]).Length < 1e-6: clean.pop()
    face = Part.Face(Part.makePolygon(clean + [clean[0]]))
    inner_face = face.makeOffset2D(-t, 0, False, False, False)
    if on_axis:
        big = 1e5   # keep the half of the shrunk section on the r >= 0 side, so a 360° turn makes one clean void
        half = Part.Face(Part.makePolygon([pt(-big / 1000, 0), pt(big / 1000, 0), pt(big / 1000, big / 1000), pt(-big / 1000, big / 1000), pt(-big / 1000, 0)]))
        inner_face = inner_face.common(half).Faces[0]
        revolve = 360.0
    axis = Vector(0, 0, 0); axis[ax] = 1
    sgn = -1 if sp["axis"] == "Y" else 1
    inner = inner_face.revolve(Vector(), axis, sgn * revolve)
    q = sp["quat"]; inner.Placement = Placement(Vector(*[c * 1000 for c in sp["loc"]]), Rotation(q[1], q[2], q[3], q[0]))
    return inner
def hollow(shape, t, label=None):
    """the part as a shell of wall t (falls back to the model solid)"""
    try:
        inner = lathe_inner(label, t) if label and spec(label)["builder"] == "lathe" else shape.makeOffsetShape(-t, 0.1)
        h = shape.cut(inner)
        if h.isValid() and 0 < h.Volume < shape.Volume: return h, True
        print("   hollow gave an unusable shape for", label)
    except Exception as e: print("   hollow failed:", label, e)
    return shape, False
WALL = {"hub": 60, "bulb": 12, "duct": 16, "pylon": 20}
hub_h, ok_hub = hollow(hub, WALL["hub"], "River_Kaplan_Runner_Hub"); bulb_h, ok_bulb = hollow(bulb, WALL["bulb"], "River_Kaplan_Bulb_Nacelle")
duct_h, ok_duct = hollow(duct, WALL["duct"], "River_Kaplan_Duct"); pylon_h, ok_pylon = hollow(pylon, WALL["pylon"])
print("HOLLOW hub %s bulb %s duct %s pylon %s" % (ok_hub, ok_bulb, ok_duct, ok_pylon))
DUCT_FULL = 360.0 / spec("River_Kaplan_Duct")["arc"][1]          # the model duct is a 270° cutaway
PARTS = [
    # item, label, name, qty, material, process, unit mass (kg), how the mass was found
    (1, "duct", "Duct (shroud)", 1, "S355J2+N plate, EN 10025-2", "Rolled plate segments, welded, stiffened", duct_h.Volume * 1e-9 * STEEL * DUCT_FULL * 1.15, "16 mm skin + 15 % stiffeners, full 360°"),
    (2, "bulb", "Bulb nacelle", 1, "S355J2+N plate, EN 10025-2", "Formed plates, welded, watertight", bulb_h.Volume * 1e-9 * STEEL * 1.2, "12 mm shell + 20 % frames"),
    (3, "guidevanes", "Guide vane", 8, "S355J2+N plate, EN 10025-2", "Plate, cut and formed", vane.Volume * 1e-9 * STEEL, "model volume"),
    (4, "hubk", "Runner hub", 1, "G20Mn5+QT cast steel, EN 10293", "Cast, machined", hub_h.Volume * 1e-9 * STEEL, "60 mm cast wall"),
    (5, "blades", "Runner blade", 5, "CA6NM (13Cr-4Ni), ASTM A743", "Cast, 5-axis machined", blade.Volume * 1e-9 * CA6NM, "model volume"),
    (6, "trunnion", "Blade trunnion", 5, "42CrMo4+QT, EN 10083-3", "Forged, turned", trunnion.Volume * 1e-9 * STEEL, "model volume"),
    (7, "base", "Gravity base", 1, "Concrete C35/45, B500B rebar", "Precast, reinforced", base.Volume * 1e-9 * CONCRETE, "model volume"),
    (8, "pylon", "Support pylon", 1, "S355J2+N plate, EN 10025-2", "Welded box section", pylon_h.Volume * 1e-9 * STEEL, "20 mm plate box"),
]
def kg(m): return ("%.0f kg" % m) if m < 1000 else ("%.2f t" % (m / 1000))

# runner axis frame helpers
def radial(p): return math.hypot(p.y - AXIS_Y, p.z - AXIS_Z)
def theta(p): return math.atan2(p.z - AXIS_Z, p.y - AXIS_Y)

# ------------------------------------------------------------------ blade geometry: developed cylindrical sections
bpts = [v.Point for v in blade.Vertexes] + [p for e in blade.Edges for p in e.discretize(40)]
r_min, r_max = min(radial(p) for p in bpts), max(radial(p) for p in bpts)
hub_r = max(r for a, r in spec("River_Kaplan_Runner_Hub")["profile"])
tip_r = r_max
# the blade's pivot axis: from the runner axis out through the trunnion centre
tc = com(trunnion)
pivot = Vector(0, tc.y - AXIS_Y, tc.z - AXIS_Z).normalize()
th0 = theta(tc)
def developed_section(r):
    cyl = Part.makeCylinder(r, 6000, Vector(-3000, AXIS_Y, AXIS_Z), Vector(1, 0, 0))
    lat = max(cyl.Faces, key=lambda fc: fc.Area)
    sec = blade.section(lat)
    pts = [p for e in sec.Edges for p in e.discretize(Deflection=0.3)]
    if len(pts) < 8: return None
    uv = []
    for p in pts:
        d = math.remainder(theta(p) - th0, 2 * math.pi)
        uv.append((r * d, p.x))
    # chord: the two farthest points
    best = (0, None, None)
    step = max(1, len(uv) // 300)
    sub = uv[::step]
    for i in range(len(sub)):
        for j in range(i + 1, len(sub)):
            d = math.hypot(sub[i][0] - sub[j][0], sub[i][1] - sub[j][1])
            if d > best[0]: best = (d, sub[i], sub[j])
    c, a, b = best
    if a[1] > b[1]: a, b = b, a                       # a: upstream (smaller x) edge = leading edge
    ux, uy = (b[0] - a[0]) / c, (b[1] - a[1]) / c
    # thickness: across the chord, in 40 strips
    strips = {}
    for u, v in uv:
        s_ = (u - a[0]) * ux + (v - a[1]) * uy; n_ = -(u - a[0]) * uy + (v - a[1]) * ux
        k = min(39, max(0, int(s_ / c * 40)))
        lo, hi = strips.get(k, (1e9, -1e9)); strips[k] = (min(lo, n_), max(hi, n_))
    tmax, tpos = max(((hi - lo), k) for k, (lo, hi) in strips.items())
    mids = sorted(hi - lo for k, (lo, hi) in strips.items() if 8 <= k <= 31)
    tmid = mids[len(mids) // 2] if mids else tmax
    beta = math.degrees(math.atan2(abs(uy), abs(ux)))  # angle of the chord to the circumferential direction
    return {"r": r, "uv": uv, "edges": [[(r * math.remainder(theta(p) - th0, 2 * math.pi), p.x) for p in e.discretize(Deflection=0.3)] for e in sec.Edges],
            "chord": c, "beta": beta, "tmax": tmax, "tmid": tmid, "tpos": (tpos + 0.5) / 40, "le": a, "te": b}
stations = []
for frac in (0.08, 0.35, 0.62, 0.9):
    r = r_min + (r_max - r_min) * frac
    s = developed_section(r)
    if s: stations.append(s)
print("BLADE r %.0f..%.0f mm, hub r %.0f, stations %s" % (r_min, r_max, hub_r * 1000, [(round(s["r"]), round(s["chord"]), round(s["beta"], 1), round(s["tmax"], 1)) for s in stations]))

# ------------------------------------------------------------------ sheets
sheets = []
def new(*a, **k): s = Sheet(len(sheets), *a, **k); sheets.append(s); return s
def scale_for(span_mm, room_mm, options=(5, 10, 15, 20, 25, 30, 40, 50)):
    return next((s for s in options if span_mm / s <= room_mm), options[-1])

X, Y, Z = Vector(1, 0, 0), Vector(0, 1, 0), Vector(0, 0, 1)
SWAP = {"River_Kaplan_Runner_Hub": hub_h, "River_Kaplan_Bulb_Nacelle": bulb_h, "River_Kaplan_Duct": duct_h, "Support_Pylon": pylon_h}
ALL = [SWAP.get(lbl, o.Shape) for lbl, o in OBJ.items()]
assembly = Part.makeCompound(ALL)

# ---- 00 cover
cover = new("KAPLAN TURBINE — MANUFACTURING PLANS", "In-stream Kaplan unit, Turbine Lab FreeCAD model · drawing set and process plan")
cover.text(30, 26, "Kaplan turbine (in-stream) — manufacturing drawing set", 6.5, weight=700, family="Rajdhani, 'Arial Narrow', sans-serif")
cover.text(30, 33, "Generated from turbines/freecad/kaplan.FCStd · every view, section and dimension measured from the model", 2.8, color=FAINT)
iso = make_view(assembly, Vector(1, 1, 0), Vector(-0.4, 0.4, 1), 0, 0, 1, hidden=False)
k = scale_for(max(iso.bb[2] - iso.bb[0], iso.bb[3] - iso.bb[1]), 150)
iso = make_view(assembly, Vector(1, 1, 0), Vector(-0.4, 0.4, 1), 320, 120, k, hidden=False); iso.draw(cover, 0.3)
cover.text(320, 205, "Isometric view of the unit (not to scale)", 2.4, "middle", color=FAINT)
y = 44
cover.text(30, y, "DRAWING LIST", 3.4, weight=700); y += 3
DRAWINGS = [("000", "Cover, drawing list, general notes"), ("001", "General assembly and bill of materials"), ("002", "Runner assembly"),
            ("003", "Runner blade"), ("004", "Blade trunnion"), ("005", "Runner hub"), ("006", "Bulb nacelle"), ("007", "Duct (shroud)"),
            ("008", "Guide vane"), ("009", "Support pylon and gravity base"), ("010", "Manufacturing process plan — runner"),
            ("011", "Manufacturing process plan — structure"), ("012", "Assembly sequence, inspection and test plan")]
y = cover.table(30, y, [("No.", 26, "start"), ("Title", 110, "start"), ("Rev.", 12, "middle")], [["TL-KAP-" + n, t, REV] for n, t in DRAWINGS], 2.4, 5)
y += 8; cover.text(30, y, "GENERAL NOTES", 3.4, weight=700); y += 5
for i, n in enumerate([
    "Dimensions in millimetres. Model coordinates: X along the runner axis (flow +X), Z up; the runner axis is at Y = 0, Z = -1800.",
    "General tolerances ISO 2768-mK for machined parts; ISO 13920-BF for weldments; ISO 8062-3 DCTG 10 for cast surfaces not machined.",
    "Welding to EN ISO 3834-2; procedures to EN ISO 15614-1; welders to EN ISO 9606-1; quality level B to EN ISO 5817 for load-bearing welds.",
    "Corrosion protection for permanent immersion in fresh water: blast Sa 2½ (ISO 8501-1), epoxy system for ISO 12944 class Im1, plus sacrificial anodes.",
    "Masses are calculated from the model volumes, or for parts the model shows solid (hub, bulb, duct, pylon) from its area and the wall thickness stated in the bill of materials.",
    "The model's duct is a 270° cutaway for display; it is manufactured as a full 360° ring.",
    "This is a teaching model: materials, processes and tolerances are typical choices for a small hydrokinetic Kaplan unit, for learning, and are not a design. Not for construction.",
]):
    y = cover.paragraph(34, y, "%d. %s" % (i + 1, n), 92, 2.35, 3.3) + 1.2
cover.text(30, 238, "Revision A · %s · first issue" % DATE, 2.4, color=FAINT)

# ---- 01 general assembly
ga = new("GENERAL ASSEMBLY", "Section through the runner axis, end view, plan; bill of materials", material="see BOM", mass=kg(sum(p[3] * p[6] for p in PARTS)))
sc = 50
front = make_view(assembly, X, Z, 82, 66, sc, section=True)          # looking along +Y at the cut through Y = 0
front.draw(ga); front.label(ga, "SECTION A–A", "through the runner axis · scale 1:%d" % sc, dy=14)
end_ = make_view(assembly, -Y, Z, 178, 66, sc)                     # seen from upstream (looking along +X)
end_.draw(ga); end_.label(ga, "VIEW B", "from upstream · scale 1:%d" % sc, dy=14)
plan = make_view(assembly, X, Y, 82, 178, sc, hidden=False)
plan.draw(ga); plan.label(ga, "PLAN", "scale 1:%d" % sc)
bb = assembly.BoundBox
x0, y0, x1, y1 = front.box()
ga.dim_h(x0, x1, y1, y1, y1 + 5, "%.0f" % bb.XLength)
ga.dim_v(y0, y1, x1, x1, x1 + 6, "%.0f" % bb.ZLength)
ax_y = front.P(0, AXIS_Z)[1]
front.centreline(ga, (bb.XMin - 150, AXIS_Z), (bb.XMax + 150, AXIS_Z))
# balloons on the section, spread so they keep 8 mm apart on each side
anchors = {"duct": duct, "bulb": bulb, "guidevanes": shp("River_Kaplan_Guide_Vane_0"), "hubk": hub,
           "blades": blade, "trunnion": trunnion, "base": base, "pylon": pylon}
placed = []
for item, key, name, *_ in PARTS:
    c = com(anchors[key]); px, py = front.P(c.x, c.z)
    placed.append([item, px, py, (x0 - 9 if px < (x0 + x1) / 2 else x1 + 17), min(max(py, y0 + 3), y1 - 3)])
for side in set(p[3] for p in placed):
    grp = sorted((p for p in placed if p[3] == side), key=lambda p: p[4])
    for a_, b_ in zip(grp, grp[1:]):
        if b_[4] - a_[4] < 8: b_[4] = a_[4] + 8
for item, px, py, bx, by in placed:
    ga.line(bx + (3.2 if bx < px else -3.2), by, px, py, 0.2); ga.add('<circle cx="%s" cy="%s" r="0.6" fill="%s"/>' % (f(px), f(py), INK))
    ga.add('<circle cx="%s" cy="%s" r="3.2" fill="#fff" stroke="%s" stroke-width="0.3"/>' % (f(bx), f(by), INK)); ga.text(bx, by + 1.1, item, 3, "middle", 700)
ga.text(222, 18, "BILL OF MATERIALS", 3.4, weight=700)
rows = [[str(i), n, str(q), m, p, kg(um), kg(um * q)] for i, key, n, q, m, p, um, how in PARTS]
yb = ga.table(222, 21, [("Item", 9, "middle"), ("Part", 27, "start"), ("Qty", 8, "middle"), ("Material", 50, "start"), ("Process", 52, "start"), ("Unit", 21, "end"), ("Total", 18, "end")], rows, 1.9, 5.2)
ga.text(222 + 185, yb + 4.5, "Total mass  " + kg(sum(p[3] * p[6] for p in PARTS)), 2.6, "end", 700)
yb += 10
for i, n in enumerate(["Unit masses from the model volume, except: " + "; ".join("%s — %s" % (p[2].lower(), p[7]) for p in PARTS if p[7] != "model volume") + ".",
                       "Section A–A cuts the unit on the vertical plane through the runner axis; the far half is shown, cut faces hatched.",
                       "Flow from left to right (+X). Blades shown at the model's blade angle."]):
    yb = ga.paragraph(222, yb, "%d. %s" % (i + 1, n), 84, 2.2, 3.1) + 1

# ---- 02 runner assembly
ra = new("RUNNER ASSEMBLY", "Hub, five blades and trunnions", material="see items 4–6", mass=kg(PARTS[3][6] + 5 * PARTS[4][6] + 5 * PARTS[5][6]))
runner = Part.makeCompound([hub_h] + [shp("River_Kaplan_Blade_%d" % i) for i in range(5)] + [shp("River_Kaplan_Trunnion_%d" % i) for i in range(5)])
sc = 15
rv1 = make_view(runner, X, Z, 100, 105, sc, section=True); rv1.draw(ra); rv1.label(ra, "SECTION C–C", "through the runner axis · scale 1:%d" % sc, dy=14)
rv2 = make_view(runner, -Y, Z, 245, 105, sc); rv2.draw(ra); rv2.label(ra, "VIEW D", "from upstream · scale 1:%d" % sc, dy=13)
x0, y0, x1, y1 = rv2.box(); cx, cy = rv2.P(0, AXIS_Z)    # view coords: x = -y, y = z, so the axis is at (0, -1800)
rpx = tip_r / sc
ra.line(cx - rpx, y1 + 6, cx + rpx, y1 + 6, 0.18); ra.arrow(cx - rpx, y1 + 6, -1, 0); ra.arrow(cx + rpx, y1 + 6, 1, 0)
for xx in (cx - rpx, cx + rpx): ra.line(xx, cy, xx, y1 + 7.5, 0.18)
ra.text(cx, y1 + 5, "Ø%.0f blade tips" % (2 * tip_r), 2.6, "middle")
angs = sorted((math.degrees(theta(com(shp("River_Kaplan_Trunnion_%d" % i)))) % 360) for i in range(5))
x0b, y0b, x1b, y1b = rv1.box()
ra.dim_h(x0b, x1b, y1b, y1b, y1b + 5, "%.0f" % runner.BoundBox.XLength)
yy = 190
ra.text(40, yy, "RUNNER DATA", 3.4, weight=700); yy += 3
yy = ra.table(40, yy, [("Quantity", 70, "start"), ("Value", 50, "end")], [
    ["Number of blades", "5"], ["Blade spacing", "72° (trunnions at %s)" % ", ".join("%.0f°" % a for a in angs)],
    ["Runner diameter (blade tips)", "Ø%.0f" % (2 * tip_r)], ["Hub diameter", "Ø%.0f" % (2000 * hub_r)], ["Hub ratio", "%.2f" % (hub_r * 1000 / tip_r)],
    ["Blade mass (each)", kg(PARTS[4][6])], ["Runner mass (hub, blades, trunnions)", kg(PARTS[3][6] + 5 * PARTS[4][6] + 5 * PARTS[5][6])]], 2.3, 5)
ra.text(180, 190, "REQUIREMENTS", 3.4, weight=700)
y2 = 195
for i, n in enumerate([
    "Blades fitted to the hub on their trunnions; all five set to the same angle within ±0.1°, checked with the blade-angle gauge at the tip section.",
    "Tip clearance to the duct 3 ± 1 mm all round, measured at 8 positions after installation.",
    "Balance the assembled runner to ISO 21940-11, grade G6.3, at the maximum service speed; correction by grinding the hub, not the blades.",
    "Blade-to-hub and trunnion bolting torques and the pitch mechanism inside the hub to be designed; not shown in this model.",
    "Mark each blade and its hub seat with the same number 1–5 before balancing; do not interchange after balancing."]):
    y2 = ra.paragraph(180, y2, "%d. %s" % (i + 1, n), 60, 2.3, 3.2) + 1

# ---- 03 runner blade
bl = new("RUNNER BLADE", "Developed cylindrical sections, plan and front view", scale="1:10", material=PARTS[4][4], mass=kg(PARTS[4][6]))
# plan: looking down the pivot axis (from outside, towards the hub)
tang = X.cross(pivot)  # circumferential direction at the blade
bv = make_view(blade.fuse(trunnion), X, tang, 80, 75, 10); bv.draw(bl); bv.label(bl, "VIEW E", "down the pivot axis, from the tip · scale 1:10")
fv = make_view(blade.fuse(trunnion), tang * -1, pivot, 80, 185, 10); fv.draw(bl); fv.label(bl, "VIEW F", "along the blade chord direction · scale 1:10")
x0, y0, x1, y1 = fv.box()
bl.dim_v(y0, y1, x1, x1, x1 + 6, "%.0f" % ((y1 - y0) * 10))
# developed sections, each at 1:5
cols = [(190, 45), (290, 45), (190, 118), (290, 118)]
for (cxs, cys), st, lab in zip(cols, stations, "GHJK"):
    k = 1 / 10.0
    us = [u for e in st["edges"] for u, v in e]; vs = [v for e in st["edges"] for u, v in e]
    mu, mv = (min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2
    def P(u, v): return (cxs + (u - mu) * k, cys - (v - mv) * k)
    d = " ".join("M" + " L".join("%s %s" % tuple(f(c) for c in P(u, v)) for u, v in e) for e in st["edges"] if len(e) > 1)
    bl.add('<path d="%s" fill="url(#hatch)" stroke="%s" stroke-width="0.5" fill-rule="evenodd"/>' % (d, INK))
    (ax_, ay_), (bx_, by_) = P(*st["le"]), P(*st["te"])
    bl.line(ax_, ay_, bx_, by_, 0.18, "4 1 1 1", FAINT)
    # a circumferential reference line through the leading edge, and the blade angle
    bl.line(ax_ - 6, ay_, ax_ + 22, ay_, 0.18, "2 1", FAINT)
    bl.text(ax_ - 7, ay_ + 0.7, "u", 1.8, "end", color=FAINT)
    bl.text(cxs, cys + 26, "SECTION %s — r = %.0f · 1:10" % (lab, st["r"]), 2.8, "middle", 700)
    bl.text(cxs, cys + 30, "chord %.0f · β %.1f° · t %.0f" % (st["chord"], st["beta"], st["tmid"]), 2.1, "middle", color=FAINT)
y3 = 166
bl.text(150, y3, "SECTION DATA (developed on cylinders about the runner axis)", 3.0, weight=700)
y3 = bl.table(150, y3 + 3, [("Section", 16, "middle"), ("Radius r", 22, "end"), ("r / tip", 18, "end"), ("Chord", 20, "end"), ("Blade angle β", 26, "end"), ("Thickness", 22, "end")],
              [[lab, "%.0f" % s["r"], "%.2f" % (s["r"] / tip_r), "%.0f" % s["chord"], "%.1f°" % s["beta"], "%.0f" % s["tmid"]] for s, lab in zip(stations, "GHJK")], 2.2, 4.8)
y3 += 4
for i, n in enumerate(["Sections are developed (unrolled) cylindrical cuts at radius r about the runner axis (u: circumferential direction, flow upward); β is the chord angle to the circumferential direction. The blade is a plate of uniform thickness, edges rounded.",
                       "Profile tolerance of blade surfaces ±1.0 mm from the CAD model (step/blade.step); leading and trailing edges checked with templates at G–K.",
                       "Surface finish Ra ≤ 3.2 µm on both faces; edges radiused as modelled. Cast CA6NM, normalised and tempered; 100 % PT (ISO 3452) after machining; UT of the root (ISO 17640 / ASTM A609)."]):
    y3 = bl.paragraph(150, y3, "%d. %s" % (i + 1, n), 52, 2.2, 3.1) + 1

# ---- lathe parts: half-section view, profile table
def lathe_sheet(label, title, sub, item, scale, prof_note):
    sp = spec(label); it = next(p for p in PARTS if p[0] == item)
    s = SWAP.get(label, shp(label)).copy()
    shv = new(title, sub, scale="1:%d" % scale, material=it[4], mass=kg(it[6]))
    ax = {"X": X, "Y": Y, "Z": Z}[sp["axis"]]
    # put the part's axis horizontal on the sheet: R = its axis (world), U = a perpendicular
    q = sp["quat"]; rot = Rotation(q[1], q[2], q[3], q[0]); axw = rot.multVec(ax)
    up = Z if abs(axw.dot(Z)) < 0.9 else Y
    upw = (up - axw * up.dot(axw)).normalize()
    origin = Vector(*[v * 1000 for v in sp["loc"]])
    s.translate(-origin)                                   # the part's own axis now passes through the origin
    sec = make_view(s, axw, upw, 110, 100, scale, section=True); sec.draw(shv)
    sec.label(shv, "SECTION", "on the axis · scale 1:%d" % scale, dy=15)
    x0, y0, x1, y1 = sec.box()
    o_v = Vector(0, 0, 0)
    sec.centreline(shv, (sec.bb[0] - 40 * scale, o_v.y), (sec.bb[2] + 40 * scale, o_v.y))
    prof = sp["profile"]; amin = min(a for a, r in prof); amax = max(a for a, r in prof); rmax = max(r for a, r in prof)
    shv.dim_h(x0, x1, y1, y1, y1 + 6, "%.0f" % ((amax - amin) * 1000))
    yt, yb = sec.P(0, o_v.y + rmax * 1000)[1], sec.P(0, o_v.y - rmax * 1000)[1]
    shv.dim_v(yt, yb, x1, x1, x1 + 8, "Ø%.0f" % (2000 * rmax))
    # profile table: exact points of the revolved profile, from the model
    shv.text(250, 18, "PROFILE COORDINATES", 3.4, weight=700)
    shv.text(250, 22.5, prof_note, 2.1, color=FAINT)
    rows = [[str(i + 1), "%.1f" % ((a - amin) * 1000), "%.1f" % (2000 * r)] for i, (a, r) in enumerate(prof)]
    half = (len(rows) + 1) // 2 if len(rows) > 10 else len(rows)
    yt_ = shv.table(250, 25, [("Pt", 10, "middle"), ("Axial a", 24, "end"), ("Ø = 2r", 24, "end")], rows[:half], 2.2, 4.4)
    if rows[half:]: shv.table(330, 25, [("Pt", 10, "middle"), ("Axial a", 24, "end"), ("Ø = 2r", 24, "end")], rows[half:], 2.2, 4.4)
    return shv, sec, (x0, y0, x1, y1), sp

tr_sh, tr_sec, tb, _ = lathe_sheet("River_Kaplan_Trunnion_0", "BLADE TRUNNION", "Turned flange carrying the blade on the hub", 6, 5, "Axial position a from the first face; diameters on the trunnion axis.")
tsp = spec("River_Kaplan_Trunnion_0"); tq = tsp["quat"]; t_ax = Rotation(tq[1], tq[2], tq[3], tq[0]).multVec(Z)
t_s = trunnion.copy(); t_s.translate(-Vector(*[v * 1000 for v in tsp["loc"]]))
t_up = (Z - t_ax * Z.dot(t_ax)).normalize() if abs(t_ax.dot(Z)) < 0.9 else (Y - t_ax * Y.dot(t_ax)).normalize()
t_end = make_view(t_s, t_up, t_up.cross(t_ax) * -1, 175, 100, 5); t_end.draw(tr_sh); t_end.label(tr_sh, "END VIEW", "scale 1:5", dy=8)
y4 = 150
for i, n in enumerate(["Forged 42CrMo4+QT (EN 10083-3), 900–1100 MPa; UT of the forging to EN 10228-3 class 3.",
                       "Turn all over; faces flat within 0.05 mm and parallel within 0.05 mm; seat diameter to h7 against the hub bore (H7), fit to be confirmed in design.",
                       "Bolting pattern to the blade and the pitch-link pin are not in the model; to be designed. Ra 1.6 µm on seat faces, 3.2 µm elsewhere."]):
    y4 = tr_sh.paragraph(250, y4, "%d. %s" % (i + 1, n), 68, 2.3, 3.2) + 1

hb_sh, hb_sec, hbb, hsp = lathe_sheet("River_Kaplan_Runner_Hub", "RUNNER HUB", "Cast hub with five trunnion seats", 4, 15, "Axial position a from the upstream end; outer surface of the model (cast wall 60 mm assumed).")
# seat pattern on the hub, from the trunnion positions
y5 = 140
hb_sh.text(250, y5, "TRUNNION SEATS", 3.4, weight=700)
seats = []
for i in range(5):
    t_ = shp("River_Kaplan_Trunnion_%d" % i); cm = com(t_)
    seats.append([str(i + 1), "%.1f°" % (math.degrees(theta(cm)) % 360), "%.1f" % cm.x, "%.1f" % radial(cm)])
y5 = hb_sh.table(250, y5 + 3, [("Seat", 12, "middle"), ("Angle θ", 22, "end"), ("Axial x", 22, "end"), ("Radius", 22, "end")], seats, 2.2, 4.6) + 5
for i, n in enumerate(["Cast G20Mn5+QT (EN 10293); casting tolerance ISO 8062-3 DCTG 10; MT of machined surfaces (ISO 17638), UT of seat zones.",
                       "Seat bores H7 on radial axes at the angles above, true position Ø0.1 mm to the hub axis; seat faces square to their axis within 0.05 mm.",
                       "Hub interior (pitch mechanism) and the shaft flange are not in the model; to be designed."]):
    y5 = hb_sh.paragraph(250, y5, "%d. %s" % (i + 1, n), 68, 2.3, 3.2) + 1

bu_sh, bu_sec, bub, _ = lathe_sheet("River_Kaplan_Bulb_Nacelle", "BULB NACELLE", "Watertight shell housing the generator", 2, 15, "Axial position a from the upstream nose; outer surface (12 mm plate shell assumed).")
y6 = 150
for i, n in enumerate(["Shell of S355J2+N plate 12 mm, formed in gores and rings, full-penetration butt welds (EN ISO 5817 level B), internal ring frames at 400 mm.",
                       "Watertight: air test at 0.5 bar with soap solution on all seams, then 0.2 bar hold for 1 h without loss.",
                       "Outer surface fair within ±3 mm of the profile over any 1 m chord; coating per general note 4."]):
    y6 = bu_sh.paragraph(250, y6, "%d. %s" % (i + 1, n), 68, 2.3, 3.2) + 1

du_sh, du_sec, dub, _ = lathe_sheet("River_Kaplan_Duct", "DUCT (SHROUD)", "Full 360° ring — the model shows a 270° cutaway", 1, 30, "Closed profile of the duct wall: points around the section (a from the inlet).")
y7 = 160
for i, n in enumerate(["Fabricate as a full 360° ring in 4 rolled segments of S355J2+N plate 16 mm skin with internal ring and longitudinal stiffeners, welded to EN ISO 3834-2.",
                       "Inner surface at the runner (throat) machined after welding to Ø%.0f +2/0 mm, roundness 2 mm, for the 3 mm tip clearance." % (2 * tip_r + 6),
                       "Leading and trailing edges rounded as the profile; coating per general note 4; anodes on the outer skin."]):
    y7 = du_sh.paragraph(250, y7, "%d. %s" % (i + 1, n), 68, 2.3, 3.2) + 1

# ---- 08 guide vane
gv = new("GUIDE VANE", "Flat plate vane between bulb and duct, 8 off", scale="1:5", material=PARTS[2][4], mass=kg(PARTS[2][6]))
big = max(vane.Faces, key=lambda fc: fc.Area); u0, u1, v0, v1 = big.ParameterRange; nrm = big.normalAt((u0 + u1) / 2, (v0 + v1) / 2)
nrm = Vector(nrm).normalize(); r_dir = (X - nrm * X.dot(nrm)).normalize(); u_dir = nrm.cross(r_dir)
gv1 = make_view(vane, r_dir, u_dir, 100, 105, 5); gv1.draw(gv); gv1.label(gv, "VIEW ON THE PLATE", "scale 1:5", dy=14)
x0, y0, x1, y1 = gv1.box()
gv.dim_h(x0, x1, y1, y1, y1 + 6, "%.0f" % ((x1 - x0) * 5)); gv.dim_v(y0, y1, x1, x1, x1 + 6, "%.0f" % ((y1 - y0) * 5))
thick = vane.Volume / big.Area
gv2 = make_view(vane, r_dir, nrm * -1, 100, 205, 5); gv2.draw(gv); gv2.label(gv, "EDGE VIEW", "plate t = %.0f · scale 1:5" % thick)
y8 = 30
gv.text(250, y8, "NOTES", 3.4, weight=700); y8 += 5
for i, n in enumerate(["Plate S355J2+N, t = %.0f mm (from the model), profile cut by plasma or waterjet; edges ground to R 3." % thick,
                       "8 off, at 45° spacing about the runner axis; welded both sides to the bulb and the duct with fillet welds a = 8, EN ISO 5817 level B.",
                       "Flatness 2 mm over the plate; position of each vane ±3 mm, angle ±0.5°, checked against the bulb axis before welding."]):
    y8 = gv.paragraph(250, y8, "%d. %s" % (i + 1, n), 68, 2.3, 3.2) + 1

# ---- 09 pylon and base
pb = new("SUPPORT PYLON AND GRAVITY BASE", "Structure carrying the unit on the river bed", scale="1:20 / 1:40", material="items 7 and 8", mass=kg(PARTS[6][6] + PARTS[7][6]))
pv = make_view(pylon_h, X, Z, 90, 60, 20, section=True); pv.draw(pb); pv.label(pb, "PYLON — SECTION", "scale 1:20", dy=14)
x0, y0, x1, y1 = pv.box(); pb.dim_h(x0, x1, y1, y1, y1 + 6, "%.0f" % pylon.BoundBox.XLength); pb.dim_v(y0, y1, x1, x1, x1 + 6, "%.0f" % pylon.BoundBox.ZLength)
pv2 = make_view(pylon, -Y, Z, 175, 60, 20); pv2.draw(pb); pv2.label(pb, "PYLON — END", "scale 1:20", dy=14)
x0, y0, x1, y1 = pv2.box(); pb.dim_h(x0, x1, y1, y1, y1 + 6, "%.0f" % pylon.BoundBox.YLength)
bv1 = make_view(base, X, Z, 90, 128, 40, section=True, hatch="concrete"); bv1.draw(pb); bv1.label(pb, "BASE — SECTION", "scale 1:40", dy=14)
x0, y0, x1, y1 = bv1.box(); pb.dim_h(x0, x1, y1, y1, y1 + 6, "%.0f" % base.BoundBox.XLength); pb.dim_v(y0, y1, x1, x1, x1 + 6, "%.0f" % base.BoundBox.ZLength)
bv2 = make_view(base, X, Y, 90, 205, 40, hidden=False); bv2.draw(pb); bv2.label(pb, "BASE — PLAN", "scale 1:40", dy=7)
x0, y0, x1, y1 = bv2.box(); pb.dim_v(y0, y1, x1, x1, x1 + 6, "%.0f" % base.BoundBox.YLength)
bev = spec("Gravity_Base").get("bevel") or {}; pbev = spec("Support_Pylon").get("bevel") or {}
y9 = 30
pb.text(250, y9, "NOTES", 3.4, weight=700); y9 += 5
for i, n in enumerate(["Pylon: welded box of S355J2+N plate 20 mm, internal diaphragm at mid-height; edges chamfered %.0f mm as modelled; top flange bolted to the bulb/duct frame." % (pbev.get("width", 0) * 1000),
                       "Base: precast concrete C35/45 (EN 206), exposure class XC4/XF3, reinforcement B500B with 60 mm cover; edges chamfered %.0f mm as modelled." % (bev.get("width", 0) * 1000),
                       "Base mass %s from the model volume (%.2f m³ at 2400 kg/m³). Check against sliding and overturning for the design flow; add ballast or scour protection as required." % (kg(PARTS[6][6]), base.Volume * 1e-9),
                       "Cast-in anchor plate for the pylon, position from the model: pylon centre at x = %.0f, y = %.0f." % (pylon.BoundBox.Center.x, pylon.BoundBox.Center.y),
                       "Lifting: 4 cast-in lifting anchors, rated for 1.5 × the base mass."]):
    y9 = pb.paragraph(250, y9, "%d. %s" % (i + 1, n), 68, 2.3, 3.2) + 1

# ---- 10–12 process plans
def ops_sheet(title, sub, blocks):
    sh = new(title, sub, material="—", mass="—")
    x, y = 26, 18
    for name, ops in blocks:
        rows = [[op, wc, desc, chk] for op, wc, desc, chk in ops]
        need = 6 + 4.6 * (len(rows) + 1)
        if y + need > 240 and x < 200: x, y = 220, 18
        sh.text(x, y + 3, name, 3.2, weight=700)
        y = sh.table(x, y + 5, [("Op", 9, "middle"), ("Work centre", 30, "start"), ("Operation", 110, "start"), ("Check", 36, "start")], rows, 1.95, 4.6) + 5
    return sh
ops_sheet("MANUFACTURING PROCESS PLAN — RUNNER", "Operation sequence for items 4, 5 and 6", [
    ("Item 5 — Runner blade (5 off)", [
        ("10", "Pattern shop", "3D-printed sand mould from step/blade.step with 4 mm machining allowance on both faces", "Mould dims"),
        ("20", "Foundry", "Cast CA6NM; one test bar per heat", "Chem. analysis"),
        ("30", "Heat treatment", "Normalise 1000–1050 °C, temper 590–620 °C", "Hardness, tensile"),
        ("40", "NDT", "Visual, PT (ISO 3452), UT of root (ASTM A609); weld-repair to procedure and re-heat-treat", "NDT report"),
        ("50", "5-axis milling", "Rough then finish both faces and edges to the CAD model; leave root datum", "CMM vs CAD ±1.0"),
        ("60", "Bench", "Blend edges, polish to Ra ≤ 3.2 µm; mark blade number", "Templates G–K"),
        ("70", "Machine shop", "Machine the root face and bolt holes to the trunnion", "Datum check"),
        ("80", "Inspection", "Final PT; weigh each blade; blades within 1 % of each other", "Mass record")]),
    ("Item 6 — Blade trunnion (5 off)", [
        ("10", "Forge", "Open-die forge 42CrMo4 disc", "Forging cert."),
        ("20", "Heat treatment", "Quench and temper to 900–1100 MPa", "Hardness"),
        ("30", "NDT", "UT to EN 10228-3 class 3", "UT report"),
        ("40", "CNC lathe", "Turn all over to drawing TL-KAP-004; seat to h7", "Seat Ø, flatness"),
        ("50", "Machining centre", "Drill and tap bolt pattern, pin bore", "Positions")]),
    ("Item 4 — Runner hub (1 off)", [
        ("10", "Pattern shop", "Pattern and cores from the hub profile (TL-KAP-005), 60 mm wall", "Pattern dims"),
        ("20", "Foundry", "Cast G20Mn5; heat treat (QT)", "Cert., hardness"),
        ("30", "NDT", "UT of seat zones, MT after machining", "NDT report"),
        ("40", "Vertical lathe", "Turn outer profile and the shaft flange face", "Profile ±0.5"),
        ("50", "Horizontal boring", "Bore 5 trunnion seats H7 at 72°, faces square", "True position Ø0.1"),
        ("60", "Assembly", "Fit trunnions and blades; set blade angle ±0.1°; balance G6.3 (ISO 21940-11)", "Balance report")])])
ops_sheet("MANUFACTURING PROCESS PLAN — STRUCTURE", "Operation sequence for items 1, 2, 3, 7 and 8", [
    ("Item 1 — Duct (1 off)", [
        ("10", "Cutting", "Nest and cut plate S355 16 mm, 4 segments plus stiffeners", "Plate certs 3.1"),
        ("20", "Rolling", "Roll each segment to the duct profile (TL-KAP-007)", "Templates ±3"),
        ("30", "Welding", "Assemble segments on a jig, weld seams and stiffeners (WPS)", "VT, UT 10 %"),
        ("40", "Machining", "Machine the throat Ø to +2/0, roundness 2 mm", "Ø at 8 positions"),
        ("50", "Coating", "Blast Sa 2½, epoxy system Im1, fit anodes", "DFT readings")]),
    ("Item 2 — Bulb nacelle (1 off)", [
        ("10", "Forming", "Press-form 12 mm gores for the nose and tail; roll the cylindrical ring", "Templates"),
        ("20", "Welding", "Weld gores and rings with internal frames, full penetration", "VT, RT/UT 100 % seams"),
        ("30", "Testing", "Air test 0.5 bar, hold 0.2 bar for 1 h", "Leak test record"),
        ("40", "Coating", "As item 1", "DFT readings")]),
    ("Item 3 — Guide vane (8 off)", [
        ("10", "Cutting", "Waterjet or plasma from plate, t as drawing TL-KAP-008", "Outline ±1"),
        ("20", "Bench", "Grind edges to R 3", "VT")]),
    ("Item 8 — Support pylon (1 off)", [
        ("10", "Cutting", "Cut 20 mm plates and diaphragm", "Plate certs"),
        ("20", "Welding", "Weld box, chamfer edges, weld top flange", "VT, MT of corners")]),
    ("Item 7 — Gravity base (1 off)", [
        ("10", "Precast yard", "Formwork with chamfer strips; place rebar cage, anchor plate and lifting anchors", "Cover 60 mm"),
        ("20", "Casting", "Pour C35/45, vibrate, cure 7 days wet", "Cubes 7/28 d"),
        ("30", "Inspection", "Dimensions, anchor plate position, surface", "Survey ±10")])])

# ---- 12 assembly, ITP
it = new("ASSEMBLY SEQUENCE, INSPECTION AND TEST PLAN", "From parts to an installed unit", material="—", mass="—")
it.text(26, 21, "ASSEMBLY SEQUENCE", 3.4, weight=700)
ya = 26
for i, n in enumerate([
    "Runner: fit the five trunnions to the hub seats, mount the blades in numbered order, set all blade angles, torque the bolting; balance the runner (G6.3).",
    "Bulb: install the generator and the shaft seal inside the bulb (by the generator supplier); couple the runner to the shaft; check run-out at the hub ≤ 0.2 mm.",
    "Guide vanes: set the bulb in the duct on a jig with the axes aligned within 2 mm; position the 8 vanes at 45° and weld them to bulb and duct.",
    "Check the tip clearance of 3 ± 1 mm at 8 positions by turning the runner by hand; record.",
    "Pylon: weld or bolt the pylon to the duct frame; coat damaged areas.",
    "Base: place the gravity base on the prepared river bed, level within 1:200; lower the unit and bolt the pylon to the anchor plate.",
    "Connect the export cable; commission: rotation by hand, insulation test, first run at low flow, vibration and temperature monitoring."]):
    ya = it.paragraph(30, ya, "%d. %s" % (i + 1, n), 100, 2.35, 3.3) + 1.3
it.text(26, ya + 5, "INSPECTION AND TEST PLAN", 3.4, weight=700)
it.table(26, ya + 8, [("Activity", 70, "start"), ("Standard / criterion", 70, "start"), ("Record", 30, "start"), ("H/W/R", 14, "middle")], [
    ["Material certificates (all steel, castings)", "EN 10204 type 3.1", "Certificates", "R"],
    ["Blade and hub castings: chemistry, mechanical", "ASTM A743 CA6NM; EN 10293", "Test reports", "R"],
    ["Blade NDT (PT, UT root)", "ISO 3452; ASTM A609", "NDT reports", "W"],
    ["Blade geometry vs CAD", "±1.0 mm profile, templates G–K", "CMM report", "H"],
    ["Hub seat bores", "H7, true position Ø0.1", "Inspection report", "W"],
    ["Welding procedures and welders", "EN ISO 15614-1; EN ISO 9606-1", "WPQR, certificates", "R"],
    ["Weld inspection (bulb seams 100 %, duct 10 %)", "EN ISO 5817 level B", "NDT reports", "W"],
    ["Bulb leak test", "0.5 bar soap test; 0.2 bar 1 h hold", "Test record", "H"],
    ["Runner balancing", "ISO 21940-11 grade G6.3", "Balance report", "H"],
    ["Tip clearance after assembly", "3 ± 1 mm at 8 positions", "Measurement sheet", "H"],
    ["Coating", "ISO 12944 Im1; dry film thickness", "DFT readings", "W"],
    ["Base concrete", "EN 206 C35/45; cubes 7/28 days", "Lab reports", "R"]], 2.1, 5)
it.text(26, 238, "H = hold point (work stops until accepted) · W = witness point · R = document review", 2.2, color=FAINT)

# ------------------------------------------------------------------ write
for sh in sheets:
    slug = re.sub(r"[^a-z0-9]+", "-", sh.title.lower()).strip("-")[:40]
    open(os.path.join(OUT, "%02d-%s.svg" % (sh.n, slug)), "w", encoding="utf-8").write(sh.svg(len(sheets)))
import Import
for name, obj in (("blade", "River_Kaplan_Blade_0"), ("trunnion", "River_Kaplan_Trunnion_0"), ("hub", "River_Kaplan_Runner_Hub"),
                  ("bulb", "River_Kaplan_Bulb_Nacelle"), ("duct-270-cutaway", "River_Kaplan_Duct"), ("guide-vane", "River_Kaplan_Guide_Vane_0"),
                  ("pylon", "Support_Pylon"), ("base", "Gravity_Base")):
    Import.export([OBJ[obj]], os.path.join(STEP, name + ".step"))
json.dump({"date": DATE, "rev": REV, "bom": [{"item": p[0], "part": p[2], "qty": p[3], "material": p[4], "process": p[5], "unit_kg": round(p[6], 1), "mass_basis": p[7]} for p in PARTS],
           "blade": {"r_min": r_min, "r_max": r_max, "hub_r": hub_r * 1000, "sections": [{k: v for k, v in s.items() if k not in ("uv", "edges", "le", "te")} for s in stations]},
           "sheets": [{"no": "TL-KAP-%03d" % s.n, "title": s.title} for s in sheets]}, open(os.path.join(HERE, "plans.json"), "w"), indent=1)
# an HTML page with every sheet, one per A3 page: open it to view, or print it to PDF
names = sorted(os.listdir(OUT))
open(os.path.join(HERE, "index.html"), "w", encoding="utf-8").write("""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Kaplan turbine — manufacturing plans</title>
<style>@page{size:420mm 297mm;margin:0} html,body{margin:0;background:#555}
img{display:block;width:420mm;height:297mm;margin:0 auto 8mm;background:#fff;box-shadow:0 2px 12px #0006}
@media print{body{background:#fff} img{margin:0;box-shadow:none;break-after:page}}</style></head><body>
""" + "\n".join('<img src="sheets/%s" alt="%s">' % (n, n[3:-4].replace("-", " ")) for n in names) + "\n</body></html>\n")
print("SHEETS", len(sheets), "->", OUT)
