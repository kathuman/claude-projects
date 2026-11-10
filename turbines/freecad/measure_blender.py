# Turbine Lab — measure one Blender turbine scene for the FreeCAD rebuild (turbines/freecad/build_freecad.py).
# Run from the repo root, once per scene:
#   blender -b turbines/pelton_hydro_cutaway.blend       --python turbines/freecad/measure_blender.py -- pelton  turbines/freecad/data
#   blender -b turbines/francis_turbine_river_wind.blend --python turbines/freecad/measure_blender.py -- francis turbines/freecad/data
#   blender -b turbines/kaplan_turbine_river_wind.blend  --python turbines/freecad/measure_blender.py -- kaplan  turbines/freecad/data
#
# Writes data/<machine>.json: for every part of the machine (not its site), where it is (position and rotation, in
# metres and quaternions) and what it is, as one of these builders, chosen by testing the mesh:
#   lathe  a profile (axial, radial) pairs that every vertex lies on, revolved about a local axis (cylinders, cones,
#          discs, hubs, flanges, generators, the crown and band, duct, bulb); open profiles carry a wall thickness
#   cups   the Pelton bucket: two half-ellipsoid shells (centres, semi-axes, wall thickness)
#   grid   an open quad-grid patch (the blades, the guide vanes) as a point grid, with the Solidify thickness
#   poly   a small closed mesh with its faces (boxes, bolts, vanes, gates), with any Bevel as chamfer or fillet
#   mesh   anything else, as triangles of the evaluated mesh (the Francis spiral casing and draft tube)
# Frame 1 pose; coordinates are in each object's own frame with its scale applied.
import bpy, bmesh, sys, os, json, math, re
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
MACHINE, OUT = args[0], os.path.abspath(args[1])
os.makedirs(OUT, exist_ok=True)
KEEP = {
    "pelton": r"^(Runner_Disc|Runner_Hub|Hub_Bolt_.*|Bucket_\d+|Bucket_Arm_\d+|Nozzle_.*|Spear_Needle|Penstock_Pipe|Pipe_Flange|Penstock_Reducer|Reducer_Support|Bearing_.*|Pedestal_Foot_.*|Shaft|Shaft_Coupling|Generator|Generator_EndCap|Generator_Plinth)$",
    "francis": r"^(River_Francis_(Spiral_Casing|Stay_Ring_Upper|Stay_Ring_Lower|Stay_Vane_\d+|Wicket_Gate_\d+|Runner_Crown|Runner_Band|Runner_Blades|Shaft|Generator|Draft_Tube)|Intake_Bellmouth)$",
    "kaplan": r"^(River_Kaplan_(Bulb_Nacelle|Duct|Guide_Vane_\d+|Runner_Hub|Blade_\d+|Trunnion_\d+)|Gravity_Base|Support_Pylon)$",
}[MACHINE]
RULES = [(r"^Bucket_Arm_|^Runner_Disc", "runner_p"), (r"^Bucket_\d", "bucket"), (r"^Runner_Hub|^Hub_Bolt", "hub"),
         (r"^Nozzle_", "nozzle"), (r"^Spear_Needle", "needle"), (r"^Penstock|^Pipe_Flange|^Reducer_Support", "penstock"),
         (r"^Bearing_|^Pedestal_Foot", "bearing"), (r"^Shaft", "shaft"), (r"Generator", "generator"),
         (r"^Intake_Bellmouth", "intake"), (r"Spiral_Casing", "spiral"), (r"Stay_(Vane|Ring)", "stayvanes"),
         (r"Wicket_Gate", "gates"), (r"Francis_Runner_|Francis_Shaft", "runner_f"), (r"Draft_Tube", "drafttube"),
         (r"Kaplan_Blade_\d", "blades"), (r"Kaplan_Trunnion", "trunnion"), (r"Kaplan_Runner_Hub", "hubk"),
         (r"Bulb_Nacelle", "bulb"), (r"Kaplan_Duct", "duct"), (r"Guide_Vane", "guidevanes"),
         (r"^Gravity_Base", "base"), (r"^Support_Pylon", "pylon")]
def part_of(n):
    for rx, k in RULES:
        if re.search(rx, n): return k
    return None

scene = bpy.context.scene
scene.frame_set(1)
TOL = 2e-4

def r4(x): return round(x, 6)
def placement(o):
    loc, rot, _ = o.matrix_world.decompose()
    return {"loc": [r4(v) for v in loc], "quat": [r4(v) for v in (rot.w, rot.x, rot.y, rot.z)]}
def scaled_local(o, co):
    s = o.matrix_world.to_scale(); return Vector((co.x * s.x, co.y * s.y, co.z * s.z))
def mod(o, t): return next((m for m in o.modifiers if m.type == t and m.show_render), None)
def solidify_info(o):
    m = mod(o, "SOLIDIFY")
    return {"thickness": m.thickness * o.matrix_world.to_scale().x, "offset": m.offset} if m else None

# ---- lathe: every vertex lies on a profile revolved about local axis ax; the profile follows one meridian
def try_lathe(o, bm):
    best = None
    for ax in range(3):
        oth = [i for i in range(3) if i != ax]
        pts = [scaled_local(o, v.co) for v in bm.verts]
        pr = [(p[ax], math.hypot(p[oth[0]], p[oth[1]])) for p in pts]
        # profile points = distinct (axial, radial) pairs
        keys = {}
        for a, r in pr: keys.setdefault((round(a / TOL), round(r / TOL)), (a, r))
        n_prof = len(keys)
        ring = [r for a, r in pr if r > 1e-4]
        if not ring or n_prof * 6 > len(pts): continue          # a lathe has many vertices per profile point
        angles = {round(math.atan2(p[oth[1]], p[oth[0]]), 3) for p in pts if math.hypot(p[oth[0]], p[oth[1]]) > 1e-4}
        if len(angles) < 16: continue                          # a hexagon or a box is not a circle
        if best is None or n_prof < best[1]: best = (ax, n_prof)
    if not best: return None
    ax, _ = best
    oth = [i for i in range(3) if i != ax]
    # pick a meridian: the vertices at the angle of an arbitrary ring vertex, plus poles on the axis
    vs = list(bm.verts)
    def ang(v): p = scaled_local(o, v.co); return math.atan2(p[oth[1]], p[oth[0]])
    def rad(v): p = scaled_local(o, v.co); return math.hypot(p[oth[0]], p[oth[1]])
    ref = next(v for v in vs if rad(v) > 1e-3); a0 = ang(ref)
    mer = {v for v in vs if rad(v) <= 1e-4 or abs(math.remainder(ang(v) - a0, 2 * math.pi)) < 1e-4}
    # walk the meridian along mesh edges; a closed profile (ring) loops back, an open one has two ends
    adj = {v: [e.other_vert(v) for e in v.link_edges if e.other_vert(v) in mer] for v in mer}
    ends = [v for v in mer if len(adj[v]) == 1]
    start = ends[0] if ends else next(iter(mer))
    order, prev, cur = [start], None, start
    while True:
        nxt = [w for w in adj[cur] if w is not prev and w not in order[-2:]]
        if not nxt or nxt[0] is start: break
        prev, cur = cur, nxt[0]; order.append(cur)
        if len(order) > len(mer) + 2: return None
    if len(order) != len(mer): return None
    prof = []
    for v in order:
        p = scaled_local(o, v.co); prof.append([r4(p[ax]), r4(math.hypot(p[oth[0]], p[oth[1]]))])
    # verify: every vertex sits on the profile
    pset = {(round(a / TOL), round(r / TOL)) for a, r in prof}
    for v in vs:
        p = scaled_local(o, v.co)
        k = (round(p[ax] / TOL), round(math.hypot(p[oth[0]], p[oth[1]]) / TOL))
        if not any((k[0] + i, k[1] + j) in pset for i in (-1, 0, 1) for j in (-1, 0, 1)): return None
    closed = not ends
    manifold = all(e.is_manifold for e in bm.edges)
    # angular extent: a cutaway (like the Kaplan duct) leaves a gap in the angles around the axis
    angs = sorted({round(math.degrees(math.atan2(scaled_local(o, v.co)[oth[1]], scaled_local(o, v.co)[oth[0]])) % 360, 3) for v in vs if rad(v) > 1e-3})
    gaps = [((angs[(i + 1) % len(angs)] - angs[i]) % 360, angs[i]) for i in range(len(angs))]
    step = sorted(g for g, _ in gaps)[len(gaps) // 2]
    big, at = max(gaps)
    arc = [r4((at + big) % 360), r4(360 - big)] if big > 3 * step else None
    return {"builder": "lathe", "arc": arc, "axis": "XYZ"[ax], "profile": prof, "closed": closed, "manifold": manifold, "solidify": solidify_info(o)}

# ---- grid: an open quad patch with four corners, read row by row
def try_grid(o, bm, verts=None):
    comps = components(bm)
    grids = []
    for comp in comps:
        cs = set(comp)
        corners = [v for v in comp if len([e for e in v.link_edges]) == 2]
        if len(corners) != 4: return None
        c = corners[0]
        n1, n2 = [e.other_vert(c) for e in c.link_edges]
        # first row: walk the boundary from c through n1 to the next corner
        row = [c, n1]
        while row[-1] not in corners:
            v = row[-1]
            nxt = [e.other_vert(v) for e in v.link_edges if e.is_boundary and e.other_vert(v) is not row[-2]]
            if not nxt: return None
            row.append(nxt[0])
        rows = [row]
        while True:
            prev = rows[-2] if len(rows) > 1 else None
            cur = rows[-1]; new = []
            for i in range(len(cur) - 1):
                e = bm.edges.get((cur[i], cur[i + 1]))
                f = next((f for f in e.link_faces if not (prev and any(v in prev for v in f.verts))), None) if e else None
                if f is None: break
                q = list(f.verts); k = q.index(cur[i])
                # the quad's other two vertices, in order: opposite of cur[i] and cur[i+1]
                a = q[(k + 3) % 4] if q[(k + 1) % 4] is cur[i + 1] else q[(k + 1) % 4]
                b = q[(k + 2) % 4]
                if i == 0: new.append(a)
                new.append(b)
            if len(new) != len(cur): break
            rows.append(new)
        if sum(len(r) for r in rows) != len(comp): return None
        grids.append([[[r4(x) for x in scaled_local(o, v.co)] for v in r] for r in rows])
    return grids
def components(bm):
    seen, comps = set(), []
    for v in bm.verts:
        if v in seen: continue
        st, c = [v], []; seen.add(v)
        while st:
            x = st.pop(); c.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y not in seen: seen.add(y); st.append(y)
        comps.append(c)
    return comps

def try_cups(o, bm):
    cups = []
    for comp in components(bm):
        pts = [scaled_local(o, v.co) for v in comp]
        bnd = [scaled_local(o, v.co) for v in comp if any(e.is_boundary for e in v.link_edges)]
        lo = [min(p[i] for p in bnd) for i in range(3)]; hi = [max(p[i] for p in bnd) for i in range(3)]
        flat = [i for i in range(3) if hi[i] - lo[i] < 1e-3]
        if len(flat) != 1: return None
        d = flat[0]; cen = [(lo[i] + hi[i]) / 2 for i in range(3)]
        semi = [(hi[i] - lo[i]) / 2 for i in range(3)]
        far = max(pts, key=lambda p: abs(p[d] - cen[d])); semi[d] = abs(far[d] - cen[d]); side = 1 if far[d] > cen[d] else -1
        res = max(abs(sum(((p[i] - cen[i]) / semi[i]) ** 2 for i in range(3)) - 1) for p in pts)
        if res > 1e-3: return None
        cups.append({"centre": [r4(x) for x in cen], "semi": [r4(x) for x in semi], "depthAxis": "XYZ"[d], "side": side})
    return {"builder": "cups", "cups": cups, "solidify": solidify_info(o)}

def poly_of(o, bm):
    vs = [[r4(x) for x in scaled_local(o, v.co)] for v in bm.verts]
    idx = {v: i for i, v in enumerate(bm.verts)}
    fs = [[idx[v] for v in f.verts] for f in bm.faces]
    b = mod(o, "BEVEL")
    return {"builder": "poly", "verts": vs, "faces": fs,
            "bevel": {"width": b.width * o.matrix_world.to_scale().x, "segments": b.segments} if b else None}

def mesh_of(o):
    deps = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(deps); me = ev.to_mesh(); me.calc_loop_triangles()
    vs = [[r4(x) for x in scaled_local(o, v.co)] for v in me.vertices]
    tris = [list(t.vertices) for t in me.loop_triangles]
    ev.to_mesh_clear()
    return {"builder": "mesh", "verts": vs, "tris": tris}

parts = []
for o in scene.objects:
    if o.type != "MESH" or not re.match(KEEP, o.name) or o.hide_render: continue
    key = part_of(o.name)
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table()
    manifold = all(e.is_manifold for e in bm.edges)
    spec = None
    if key == "bucket": spec = try_cups(o, bm)
    if spec is None and not re.search(r"Spiral_Casing|Draft_Tube", o.name): spec = try_lathe(o, bm)
    if spec is None and not manifold and mod(o, "SOLIDIFY"):
        sub = mod(o, "SUBSURF")
        if sub:
            # read the grid from the smoothed surface (subdivision on, solidify off), then thicken that
            sol = mod(o, "SOLIDIFY"); sol.show_render = sol.show_viewport = False
            deps = bpy.context.evaluated_depsgraph_get(); ev = o.evaluated_get(deps); me = ev.to_mesh()
            bm2 = bmesh.new(); bm2.from_mesh(me); bm2.verts.ensure_lookup_table(); bm2.edges.ensure_lookup_table()
            g = try_grid(o, bm2); bm2.free(); ev.to_mesh_clear(); sol.show_render = sol.show_viewport = True
        else:
            g = try_grid(o, bm)
        if g: spec = {"builder": "grid", "grids": g, "solidify": solidify_info(o)}
    if spec is None and manifold and len(bm.verts) <= 200: spec = poly_of(o, bm)
    if spec is None: spec = mesh_of(o)
    bm.free()
    spec.update({"name": o.name, "part": key}); spec.update(placement(o))
    parts.append(spec)
    print("%-32s %-6s %s" % (o.name, spec["builder"], ("profile %d pts %s" % (len(spec["profile"]), spec["axis"])) if spec["builder"] == "lathe" else
          ("%d grid(s) %s" % (len(spec["grids"]), "x".join(str(len(spec["grids"][0])) + "," + str(len(spec["grids"][0][0])) for _ in [0]))) if spec["builder"] == "grid" else
          ("%d tris" % len(spec["tris"])) if spec["builder"] == "mesh" else ""))
json.dump({"machine": MACHINE, "units": "m", "source": os.path.basename(bpy.data.filepath), "parts": parts},
          open(os.path.join(OUT, MACHINE + ".json"), "w"), separators=(",", ":"))
print("DONE", MACHINE, len(parts), "parts")
