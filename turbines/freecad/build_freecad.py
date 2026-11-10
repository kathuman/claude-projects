# Turbine Lab — build the FreeCAD models of the three turbines from the measurements in data/<machine>.json
# (made by measure_blender.py). Run from the repo root with FreeCAD's command-line interpreter:
#   "C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe" turbines/freecad/build_freecad.py
# Writes turbines/freecad/<machine>.FCStd and <machine>.step, and prints a check of every solid.
#
# Every part becomes a Part::Feature solid named after its Blender object, in a group named after the part, at the
# Blender position (millimetres, Z up, the same origin). How each is built:
#   lathe  revolve the exact profile (closed profiles directly; solids closed to the axis; thin surfaces thickened)
#   cups   Pelton bucket: (outer ellipsoid 1 ∪ outer 2) − (inner 1 ∪ inner 2), cut to the open side — two cups and the
#          splitter ridge where they meet
#   grid   interpolated B-spline surface through the point grid, thickened as Blender's Solidify does
#   poly   planar faces sewn into a solid, then Blender's Bevel as a chamfer (1 segment) or a fillet
#   mesh   the evaluated triangles sewn into a closed solid, coplanar faces merged (spiral casing, draft tube)
# Spreadsheet "PartsList": item, part, quantity, how it was built and the volume of each part.
import os, sys, json, re, math
import FreeCAD as App
import Part, Mesh
from FreeCAD import Vector, Placement, Rotation, Matrix

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.getcwd(), "turbines", "freecad")
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MACHINES = os.environ.get("TL_MACHINES", "pelton,francis,kaplan").split(",")
MM = 1000.0
TITLES = {"pelton": "Pelton turbine", "francis": "Francis turbine", "kaplan": "Kaplan turbine (in-stream)"}

# English part names, from the web app's machines.js
src = open(os.path.join(ROOT, "turbine-lab", "src", "machines.js"), encoding="utf-8").read()
NAMES = {m.group(1): m.group(2) for m in re.finditer(r'^\s+(\w+): \["([^"]+)"', src, re.M)}

def V(p): return Vector(p[0] * MM, p[1] * MM, p[2] * MM)
def place(spec):
    q = spec["quat"]  # w, x, y, z
    return Placement(Vector(*[c * MM for c in spec["loc"]]), Rotation(q[1], q[2], q[3], q[0]))

AX = {"X": (Vector(1, 0, 0), lambda a, r: Vector(a, r, 0)),
      "Y": (Vector(0, 1, 0), lambda a, r: Vector(r, a, 0)),
      "Z": (Vector(0, 0, 1), lambda a, r: Vector(r, 0, a))}

def repaired(solid):
    """last resort for solids that come out invalid: OpenCascade's shape healing"""
    if solid.isValid(): return solid
    try:
        r = solid.copy(); r.fix(1e-4, 1e-5, 1e-3)
        if r.isValid(): return r
    except Exception: pass
    return solid

def one_solid(shape):
    """a part that comes out as several closed bodies: a body wholly inside another is a cavity (the casing's inner
    wall), any other is fused on (the wicket gate's vane and pivot stem overlap)"""
    sols = sorted(shape.Solids, key=lambda x: -abs(x.Volume))
    if len(sols) < 2: return shape
    out = sols[0]
    for b in sols[1:]:
        pts = [v.Point for v in b.Vertexes[:: max(1, len(b.Vertexes) // 60)]]
        try:
            cavity = all(out.isInside(p, 1e-3, True) for p in pts)
            r = out.cut(b) if cavity else out.fuse(b)
            r = r.Solids[0] if len(r.Solids) == 1 else r
            if r.isValid(): out = r
            else: print("   could not merge a body of", len(b.Faces), "faces; kept separate"); return shape
        except Exception as e:
            print("   merge failed:", e); return shape
    return out

def tidy(solid):
    """merge coplanar faces only when the result is still a valid solid (on some sewn meshes it is not)"""
    try:
        r = solid.removeSplitter()
        if r.isValid() and len(r.Solids) == 1: return r
    except Exception: pass
    return solid

def dedupe(pts):
    out = []
    for p in pts:
        if not out or (p - out[-1]).Length > 1e-6: out.append(p)
    if len(out) > 1 and (out[0] - out[-1]).Length < 1e-6: out.pop()
    return out

def thicken(face_or_shell, sol):
    t = sol["thickness"] * MM; o = sol["offset"]
    if o <= -0.999: return face_or_shell.makeOffsetShape(-t, 0.01, fill=True)
    if o >= 0.999: return face_or_shell.makeOffsetShape(t, 0.01, fill=True)
    base = face_or_shell.makeOffsetShape(-t * (1 - o) / 2, 0.01)
    return base.makeOffsetShape(t, 0.01, fill=True)

def build_lathe(s):
    axis, to3 = AX[s["axis"]]
    prof = [(a * MM, r * MM) for a, r in s["profile"]]
    if s.get("arc"):
        # a partial revolution (a cutaway): start the profile at the arc's first angle and sweep only the arc.
        # Angles were measured as atan2(second, first) of the two other axes, in order; turning from the first towards
        # the second is a positive rotation about X and Z but a negative one about Y.
        start, sweep = s["arc"]; th = math.radians(start)
        oth = [i for i in range(3) if i != "XYZ".index(s["axis"])]
        def at(a, r):
            p = [0.0, 0.0, 0.0]; p["XYZ".index(s["axis"])] = a; p[oth[0]] = r * math.cos(th); p[oth[1]] = r * math.sin(th)
            return Vector(*p)
        sgn = -1 if s["axis"] == "Y" else 1
        if s["closed"] or s["manifold"]:
            ring = list(prof)
            if not s["closed"]:
                if ring[-1][1] > 1e-6: ring.append((ring[-1][0], 0))
                if ring[0][1] > 1e-6: ring.insert(0, (ring[0][0], 0))
            pts = dedupe([at(a, r) for a, r in ring])
            return Part.Face(Part.makePolygon(pts + [pts[0]])).revolve(Vector(), axis, sgn * sweep)
        surf = Part.makePolygon(dedupe([at(a, r) for a, r in prof])).revolve(Vector(), axis, sgn * sweep)
        return thicken(surf, s["solidify"]) if s.get("solidify") else surf
    if s["closed"]:
        pts = dedupe([to3(a, r) for a, r in prof])
        return Part.Face(Part.makePolygon(pts + [pts[0]])).revolve(Vector(), axis, 360)
    if s["manifold"]:
        # a solid of revolution: close the open profile along the axis
        ring = list(prof)
        if ring[-1][1] > 1e-6: ring.append((ring[-1][0], 0))
        if ring[0][1] > 1e-6: ring.insert(0, (ring[0][0], 0))
        pts = dedupe([to3(a, r) for a, r in ring])
        return Part.Face(Part.makePolygon(pts + [pts[0]])).revolve(Vector(), axis, 360)
    surf = Part.makePolygon(dedupe([to3(a, r) for a, r in prof])).revolve(Vector(), axis, 360)
    return thicken(surf, s["solidify"]) if s.get("solidify") else surf

def build_cups(s):
    t = s["solidify"]["thickness"] * MM
    def ellipsoid(c, semi):
        sph = Part.makeSphere(1.0)
        m = Matrix(); m.scale(semi[0], semi[1], semi[2]); m.move(Vector(*c))
        return sph.transformGeometry(m)
    outer = inner = None
    for cup in s["cups"]:
        c = [x * MM for x in cup["centre"]]; semi = [x * MM for x in cup["semi"]]
        o = ellipsoid(c, semi); i = ellipsoid(c, [x - t for x in semi])
        outer = o if outer is None else outer.fuse(o)
        inner = i if inner is None else inner.fuse(i)
    body = outer.cut(inner)
    # keep the side the cups open away from: the half-space beyond the rim plane, on the cups' depth side
    cup = s["cups"][0]; d = "XYZ".index(cup["depthAxis"]); plane = cup["centre"][d] * MM
    big = 2000.0
    lo = [-big, -big, -big]; size = [2 * big] * 3
    if cup["side"] < 0: lo[d] = plane - big; size[d] = big
    else: lo[d] = plane; size[d] = big
    return body.common(Part.makeBox(size[0], size[1], size[2], Vector(*lo))).removeSplitter()

def build_grid(s):
    solids = []
    for g in s["grids"]:
        pts = [[V(p) for p in row] for row in g]
        bs = Part.BSplineSurface()
        try: bs.interpolate(pts)
        except Exception: bs.approximate(Points=pts, DegMin=2, DegMax=3, Tolerance=0.2)
        face = bs.toShape()
        solids.append(thicken(face, s["solidify"]) if s.get("solidify") else face)
    return solids[0] if len(solids) == 1 else Part.makeCompound(solids)

def build_poly(s):
    vs = [V(p) for p in s["verts"]]; faces = []
    def planar(pts):
        if len(pts) == 3: return True
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if n.Length < 1e-9: return False
        n.normalize(); return all(abs((p - pts[0]).dot(n)) < 1e-4 for p in pts[3:])
    for f in s["faces"]:
        pts = [vs[i] for i in f]
        if planar(pts):
            try: faces.append(Part.Face(Part.makePolygon(pts + [pts[0]]))); continue
            except Exception: pass
        for k in range(1, len(pts) - 1): faces.append(Part.Face(Part.makePolygon([pts[0], pts[k], pts[k + 1], pts[0]])))
    shell = Part.Shell(faces); solid = one_solid(repaired(tidy(Part.Solid(shell))))
    b = s.get("bevel")
    if b and b["width"] > 0:
        try:
            w = b["width"] * MM
            solid = solid.makeChamfer(w, solid.Edges) if b["segments"] <= 1 else solid.makeFillet(w, solid.Edges)
        except Exception as e: print("   bevel skipped on", s["name"], e)
    return solid

def build_mesh(s):
    m = Mesh.Mesh([[tuple(c * MM for c in s["verts"][i]) for i in t] for t in s["tris"]])
    # clean the triangles first: zero-area and duplicate facets make self-intersecting face boundaries
    m.removeDuplicatedPoints(); m.removeDuplicatedFacets(); m.fixDegenerations(1e-4)
    m.removeDuplicatedPoints(); m.harmonizeNormals()
    sh = Part.Shape(); sh.makeShapeFromMesh(m.Topology, 0.05)
    sh = sh.copy(); sh.sewShape()
    solid = one_solid(repaired(tidy(Part.Solid(Part.Shell(sh.Faces)))))
    if solid.Volume < 0: solid.reverse()
    return solid

BUILD = {"lathe": build_lathe, "cups": build_cups, "grid": build_grid, "poly": build_poly, "mesh": build_mesh}
HOW = {"lathe": "revolved profile", "cups": "two ellipsoid cups", "grid": "B-spline surface, thickened",
       "poly": "planar faces + bevel", "mesh": "solid from the mesh"}

def run(machine):
    data = json.load(open(os.path.join(HERE, "data", machine + ".json")))
    name = machine.capitalize() + "Turbine"
    doc = App.newDocument(name)
    doc.Comment = "Turbine Lab — %s, rebuilt from %s (Blender). Millimetres, Z up." % (TITLES[machine], data["source"])
    groups, stats, objs = {}, {}, []
    ok = True
    for s in data["parts"]:
        try:
            shape = BUILD[s["builder"]](s)
        except Exception as e:
            print("FAIL", s["name"], s["builder"], e); ok = False; continue
        shape.Placement = place(s).multiply(shape.Placement)
        key = s["part"]
        if key not in groups:
            g = doc.addObject("App::DocumentObjectGroup", "G_" + key); g.Label = NAMES.get(key, key); groups[key] = g
        f = doc.addObject("Part::Feature", re.sub(r"\W", "_", s["name"])); f.Label = s["name"]; f.Shape = shape
        groups[key].addObject(f); objs.append(f)
        solids = shape.Solids
        valid = shape.isValid() and len(solids) >= 1 and all(x.isClosed() and x.Volume > 0 for x in solids)
        if not valid: ok = False; print("INVALID", s["name"], s["builder"], "solids", len(solids), "valid", shape.isValid())
        st = stats.setdefault(key, {"n": 0, "vol": 0.0, "how": set()})
        st["n"] += 1; st["vol"] += sum(x.Volume for x in solids); st["how"].add(HOW[s["builder"]])
    # parts list spreadsheet
    sh = doc.addObject("Spreadsheet::Sheet", "PartsList")
    for col, h in zip("ABCDE", ["Item", "Part", "Objects", "Built as", "Volume (L)"]): sh.set(col + "1", h)
    for i, (key, st) in enumerate(stats.items(), start=2):
        sh.set("A%d" % i, str(i - 1)); sh.set("B%d" % i, NAMES.get(key, key)); sh.set("C%d" % i, str(st["n"]))
        sh.set("D%d" % i, ", ".join(sorted(st["how"]))); sh.set("E%d" % i, "%.1f" % (st["vol"] / 1e6))
    doc.recompute()
    fc = os.path.join(HERE, machine + ".FCStd"); doc.saveAs(fc)
    import Import
    Import.export(objs, os.path.join(HERE, machine + ".step"))
    # a mesh for the visual check against Blender (not kept in the repo)
    if os.environ.get("TL_CHECK_STL"):
        import MeshPart
        whole = Part.makeCompound([o.Shape for o in objs])
        MeshPart.meshFromShape(Shape=whole, LinearDeflection=2.0, AngularDeflection=0.3).write(os.environ["TL_CHECK_STL"] % machine)
    bb = Part.makeCompound([o.Shape for o in objs]).BoundBox
    print("%s: %d parts, %d groups, all valid closed solids: %s, size %.0f × %.0f × %.0f mm, %.1f MB FCStd" %
          (machine, len(objs), len(groups), ok, bb.XLength, bb.YLength, bb.ZLength, os.path.getsize(fc) / 1e6))
    App.closeDocument(doc.Name)
    return ok

results = [run(m) for m in MACHINES]
print("ALL OK" if all(results) else "SOME FAILED")
