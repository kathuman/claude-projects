# Turbine Lab — technical drawings of one turbine: three sections through the runner centre and an isometric view.
# Run from the repo root, once per machine:
#   blender -b turbines/pelton_hydro_cutaway.blend       --python turbine-lab/tools/render_drawings.py -- pelton  turbine-lab/drawings
#   blender -b turbines/francis_turbine_river_wind.blend --python turbine-lab/tools/render_drawings.py -- francis turbine-lab/drawings
#   blender -b turbines/kaplan_turbine_river_wind.blend  --python turbine-lab/tools/render_drawings.py -- kaplan  turbine-lab/drawings
# Writes <machine>-A.png (front section), -B.png (side section), -C.png (plan section), -iso.png and <machine>.json (how
# each image maps to metres, the machine's extents, the cutting planes, the runner diameter and balloon points per
# part). Only the machine is drawn, not its site; water and air volumes are left out.
#
# Method: the machine's meshes are evaluated (modifiers applied), moved to world space and joined. For each section the
# mesh is bisected through the runner centre, the near half is deleted and the cut is capped with a second material.
# Everything renders white (emission), the caps carry a 45° hatch in screen space, and Freestyle draws the visible
# edges: thick on the outline of the cut faces (material boundary), thin elsewhere. Orthographic cameras throughout;
# the three sections share one standard scale so they line up on the sheet.
import bpy, bmesh, sys, os, json, math, re
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index("--") + 1:]
MACHINE, OUT = args[0], os.path.abspath(args[1])
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

RES = 1500
SHEET_CELL_M = 0.125                     # each view is printed 125 mm square on the A3 sheet
SCALES = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80, 100, 125, 150, 200, 250]

# which objects make up the machine (Blender object names)
KEEP = {
    "pelton": r"^(Runner_Disc|Runner_Hub|Hub_Bolt_.*|Bucket_\d+|Bucket_Arm_\d+|Nozzle_.*|Spear_Needle|Penstock_Pipe|Pipe_Flange|Penstock_Reducer|Reducer_Support|Bearing_.*|Pedestal_Foot_.*|Shaft|Shaft_Coupling|Generator|Generator_EndCap|Generator_Plinth)$",
    "francis": r"^(River_Francis_(Spiral_Casing|Stay_Ring_Upper|Stay_Ring_Lower|Stay_Vane_\d+|Wicket_Gate_\d+|Runner_Crown|Runner_Band|Runner_Blades|Shaft|Generator|Draft_Tube)|Intake_Bellmouth)$",
    "kaplan": r"^(River_Kaplan_(Bulb_Nacelle|Duct|Guide_Vane_\d+|Runner_Hub|Blade_\d+|Trunnion_\d+)|Gravity_Base|Support_Pylon)$",
}[MACHINE]
RUNNER = {"pelton": "Runner", "francis": "River_Francis_Runner", "kaplan": "River_Kaplan_Runner"}[MACHINE]
RUNNER_PARTS = {"pelton": r"^Bucket_\d+$", "francis": r"^River_Francis_Runner_Band$", "kaplan": r"^River_Kaplan_Blade_\d+$"}[MACHINE]
# part key of each object, for the balloons: the same rules as src/machines.js
import importlib.util
def part_of(name):
    rules = [(r"^Bucket_Arm_|^Runner_Disc", "runner_p"), (r"^Bucket_\d", "bucket"), (r"^Runner_Hub|^Hub_Bolt", "hub"),
             (r"^Nozzle_", "nozzle"), (r"^Spear_Needle", "needle"), (r"^Penstock|^Pipe_Flange|^Reducer_Support", "penstock"),
             (r"^Bearing_|^Pedestal_Foot", "bearing"), (r"^Shaft", "shaft"), (r"Generator", "generator"),
             (r"^Intake_Bellmouth", "intake"), (r"Spiral_Casing", "spiral"), (r"Stay_(Vane|Ring)", "stayvanes"),
             (r"Wicket_Gate", "gates"), (r"Francis_Runner_|Francis_Shaft", "runner_f"), (r"Draft_Tube", "drafttube"),
             (r"Kaplan_Blade_\d", "blades"), (r"Kaplan_Trunnion", "trunnion"), (r"Kaplan_Runner_Hub", "hubk"),
             (r"Bulb_Nacelle", "bulb"), (r"Kaplan_Duct", "duct"), (r"Guide_Vane", "guidevanes"),
             (r"^Gravity_Base", "base"), (r"^Support_Pylon", "pylon")]
    for rx, k in rules:
        if re.search(rx, name): return k
    return None

scene = bpy.context.scene
scene.frame_set(1)
deps = bpy.context.evaluated_depsgraph_get()
center = scene.objects[RUNNER].matrix_world.translation.copy()

# ---- gather the machine as one world-space bmesh, remembering which part each face came from
bm_all = bmesh.new()
part_layer = bm_all.faces.layers.int.new("part")
obj_layer = bm_all.faces.layers.int.new("obj")
part_ids, part_names = {}, []
part_counts = {}
QTY_RX = r"^Bucket_\d+$|Wicket_Gate_\d+$|Stay_Vane_\d+$|Kaplan_Blade_\d+$|Kaplan_Guide_Vane_\d+$|Kaplan_Trunnion_\d+$|^Bearing_Housing_"
n_objs = 0
runner_pts = []
for ob in scene.objects:
    if ob.type not in ("MESH", "CURVE") or not re.match(KEEP, ob.name) or ob.hide_render: continue
    ev = ob.evaluated_get(deps)
    me = ev.to_mesh()
    me.transform(ob.matrix_world)
    key = part_of(ob.name)
    if key not in part_ids: part_ids[key] = len(part_names); part_names.append(key)
    # quantity for the parts list: the repeated item itself (vanes, not the rings that carry them); everything else is 1
    if re.search(QTY_RX, ob.name): part_counts[key] = part_counts.get(key, 0) + 1
    n0 = len(bm_all.faces)
    bm_all.from_mesh(me)
    bm_all.faces.ensure_lookup_table()
    for f in bm_all.faces[n0:]: f[part_layer] = part_ids[key]; f[obj_layer] = n_objs
    n_objs += 1
    if re.match(RUNNER_PARTS, ob.name): runner_pts += [v.co.copy() for v in me.vertices]
    ev.to_mesh_clear()
for f in bm_all.faces: f.material_index = 0
print("PARTS", part_names, "faces", len(bm_all.faces))

# runner diameter: twice the largest distance of a runner vertex from the runner axis
axis = {"pelton": Vector((0, 1, 0)), "francis": Vector((0, 0, 1)), "kaplan": Vector((1, 0, 0))}[MACHINE]
axis = (scene.objects[RUNNER].matrix_world.to_3x3() @ {"pelton": Vector((0, 1, 0)), "francis": Vector((0, 0, 1)), "kaplan": Vector((1, 0, 0))}[MACHINE]).normalized()
def radial(p): d = p - center; return (d - axis * d.dot(axis)).length
runner_d = 2 * max(radial(p) for p in runner_pts)

# ---- clear the scene and set up the look
for ob in list(scene.objects): bpy.data.objects.remove(ob, do_unlink=True)
def emission_mat(name, hatch):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Strength"].default_value = 1.0
    nt.links.new(em.outputs[0], out.inputs[0])
    if not hatch:
        em.inputs["Color"].default_value = (1, 1, 1, 1)
    else:
        # 45° lines in screen space, every 14 px, about 2 px wide, on a very light grey
        tc = nt.nodes.new("ShaderNodeTexCoord"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Window"], sep.inputs[0])
        mx = nt.nodes.new("ShaderNodeMath"); mx.operation = "MULTIPLY"; mx.inputs[1].default_value = RES / 14.0
        my = nt.nodes.new("ShaderNodeMath"); my.operation = "MULTIPLY"; my.inputs[1].default_value = RES / 14.0
        nt.links.new(sep.outputs[0], mx.inputs[0]); nt.links.new(sep.outputs[1], my.inputs[0])
        add = nt.nodes.new("ShaderNodeMath"); add.operation = "ADD"; nt.links.new(mx.outputs[0], add.inputs[0]); nt.links.new(my.outputs[0], add.inputs[1])
        fr = nt.nodes.new("ShaderNodeMath"); fr.operation = "FRACT"; nt.links.new(add.outputs[0], fr.inputs[0])
        lt = nt.nodes.new("ShaderNodeMath"); lt.operation = "LESS_THAN"; lt.inputs[1].default_value = 0.16; nt.links.new(fr.outputs[0], lt.inputs[0])
        mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
        mix.inputs[6].default_value = (0.93, 0.95, 0.97, 1); mix.inputs[7].default_value = (0.18, 0.2, 0.24, 1)
        nt.links.new(lt.outputs[0], mix.inputs[0]); nt.links.new(mix.outputs[2], em.inputs["Color"])
    return m
MAT_W, MAT_H = emission_mat("Paper", False), emission_mat("Hatch", True)

world = bpy.data.worlds.new("White"); world.use_nodes = True
bg = world.node_tree.nodes.get("Background"); bg.inputs[0].default_value = (1, 1, 1, 1); bg.inputs[1].default_value = 1
scene.world = world
r = scene.render
try: r.engine = "BLENDER_EEVEE"
except TypeError as e: print(e)
r.resolution_x = r.resolution_y = RES; r.resolution_percentage = 100
r.film_transparent = False
if hasattr(r.image_settings, "media_type"): r.image_settings.media_type = "IMAGE"
r.image_settings.file_format = "PNG"; r.image_settings.color_mode = "BW"; r.image_settings.compression = 100
scene.view_settings.view_transform = "Standard"; scene.view_settings.look = "None"
r.use_freestyle = True; r.line_thickness_mode = "ABSOLUTE"; r.line_thickness = 1.0
vl = scene.view_layers[0]; fs = vl.freestyle_settings
fs.crease_angle = math.radians(140)
for ls in list(fs.linesets): fs.linesets.remove(ls)
def lineset(name, thick, mat_boundary_only):
    ls = fs.linesets.new(name); ls.select_by_visibility = True; ls.visibility = "VISIBLE"; ls.select_by_edge_types = True
    for t in ("silhouette", "border", "crease", "contour", "external_contour", "material_boundary", "edge_mark", "suggestive_contour", "ridge_valley"):
        setattr(ls, "select_" + t, False)
    if mat_boundary_only: ls.select_material_boundary = True
    else:
        ls.select_silhouette = ls.select_border = ls.select_crease = True
    st = ls.linestyle; st.color = (0.05, 0.07, 0.1); st.thickness = thick; st.caps = "ROUND"
    return ls
lineset("Thin", 2.0, False); lineset("Section", 4.6, True)

cam_data = bpy.data.cameras.new("Cam"); cam_data.type = "ORTHO"; cam_data.clip_start = 0.01; cam_data.clip_end = 1000
cam = bpy.data.objects.new("Cam", cam_data); scene.collection.objects.link(cam); scene.camera = cam

def look(cam, pos, target, up):
    d = (target - pos).normalized()
    rot = d.to_track_quat("-Z", "Y")
    # roll so that the camera's up follows 'up'
    m = Matrix.Identity(3)
    z = -d; x = up.cross(z).normalized(); y = z.cross(x)
    m = Matrix((x, y, z)).transposed()
    cam.matrix_world = Matrix.Translation(pos) @ m.to_4x4()
    return x, y

all_pts = [v.co.copy() for v in bm_all.verts]
lo = Vector((min(p.x for p in all_pts), min(p.y for p in all_pts), min(p.z for p in all_pts)))
hi = Vector((max(p.x for p in all_pts), max(p.y for p in all_pts), max(p.z for p in all_pts)))
print("BBOX", tuple(round(v, 2) for v in lo), tuple(round(v, 2) for v in hi), "runner D", round(runner_d, 3))

# views (first-angle: B is the view from the left, drawn to the right of A; C from above, drawn below A):
# name, cut normal (the half on the + side of the normal is removed and the camera looks from there), up
VIEWS = [("A", Vector((0, -1, 0)), Vector((0, 0, 1))),
         ("B", Vector((-1, 0, 0)), Vector((0, 0, 1))),
         ("C", Vector((0, 0, 1)), Vector((0, 1, 0)))]
# one standard scale for the three sections: the view must hold the machine around the runner centre, with a margin
mid = (lo + hi) / 2
def eye_for(n, up):
    x = up.cross(n).normalized(); y = up
    return center + x * (mid - center).dot(x) + y * (mid - center).dot(y), x, y
need = 0
for _, n, up in VIEWS:
    eye, x, y = eye_for(n, up)
    for p in all_pts:
        d = p - eye; need = max(need, abs(d.dot(x)) * 2, abs(d.dot(y)) * 2)
need *= 1.12
scale = next(s for s in SCALES if SHEET_CELL_M * s >= need)
ortho = SHEET_CELL_M * scale
cam_data.ortho_scale = ortho
print("SCALE 1:%d  ortho %.2f m (need %.2f)" % (scale, ortho, need))

def to_px(p, eye, x, y, ortho_):
    d = p - eye
    return [round(RES / 2 + d.dot(x) / ortho_ * RES, 1), round(RES / 2 - d.dot(y) / ortho_ * RES, 1)]

meta = {"machine": MACHINE, "res": RES, "scale": scale, "cellMm": SHEET_CELL_M * 1000, "runnerD": round(runner_d, 4),
        "center": list(center), "parts": part_names, "counts": {k: part_counts.get(k, 1) for k in part_names}, "views": {}}

def make_object(bm, name):
    me = bpy.data.meshes.new(name); bm.to_mesh(me)
    me.materials.append(MAT_W); me.materials.append(MAT_H)
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    return ob

for name, n, up in VIEWS:
    bm = bm_all.copy()
    layer = bm.faces.layers.int.get("part")
    res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=center, plane_no=n, clear_outer=True)
    cut_edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    # cap each object's cut separately, and only its closed loops (an open chain would be bridged to something else);
    # all closed loops of one object go in together, so a loop inside another becomes a hole
    olayer = bm.faces.layers.int.get("obj")
    by_obj = {}
    for e in cut_edges:
        if not e.link_faces: continue
        by_obj.setdefault(e.link_faces[0][olayer], set()).add(e)
    for oid, edges in by_obj.items():
        deg = {}
        for e in edges:
            for v in e.verts: deg[v] = deg.get(v, 0) + 1
        # drop chains that are not closed: peel away vertices of degree 1 until none are left
        edges = set(edges)
        while True:
            loose = {v for v, d in deg.items() if d == 1}
            if not loose: break
            for e in [e for e in edges if e.verts[0] in loose or e.verts[1] in loose]:
                edges.discard(e)
                for v in e.verts: deg[v] -= 1
            for v in loose: deg.pop(v, None)
        if len(edges) < 3: continue
        caps = bmesh.ops.triangle_fill(bm, use_beauty=False, use_dissolve=False, edges=list(edges), normal=n)
        for f in caps["geom"]:
            if isinstance(f, bmesh.types.BMFace): f.material_index = 1; f[olayer] = oid
    ob = make_object(bm, "Section_" + name)
    eye, _, _ = eye_for(n, up)
    x, y = look(cam, eye + n * 60, eye, up)
    scene.render.filepath = os.path.join(OUT, "%s-%s.png" % (MACHINE, name))
    bpy.ops.render.render(write_still=True)
    # balloon points: for each part, the cut-face point nearest the part's own middle (else its nearest vertex to the
    # plane), so the leader lands on something the viewer can see
    balloons = {}
    for key, pid in part_ids.items():
        faces = [f for f in bm.faces if f.material_index == 0 and f[layer] == pid]
        if not faces: continue
        verts = {v for f in faces for v in f.verts}
        pmid = sum((v.co for v in verts), Vector()) / len(verts)
        best = min(verts, key=lambda v: abs((v.co - center).dot(n)) * 4 + (v.co - pmid).length * 0.3)
        balloons[key] = to_px(best.co, eye, x, y, ortho)
    cuts = {}
    for other, n2, _ in VIEWS:
        if other == name: continue
        # the other cutting plane seen edge-on in this view: a line through the centre along the in-view direction
        dvec = n.cross(n2).normalized()
        cuts[other] = [to_px(center - dvec * ortho, eye, x, y, ortho), to_px(center + dvec * ortho, eye, x, y, ortho)]
    corners = [Vector((a, b, c)) for a in (lo.x, hi.x) for b in (lo.y, hi.y) for c in (lo.z, hi.z)]
    px = [to_px(p, eye, x, y, ortho) for p in corners]
    meta["views"][name] = {"normal": list(n), "u": list(x), "v": list(y), "ortho": ortho,
        "box": [min(p[0] for p in px), min(p[1] for p in px), max(p[0] for p in px), max(p[1] for p in px)],
        "size": [round((hi - lo).dot(Vector([abs(c) for c in x])), 4), round((hi - lo).dot(Vector([abs(c) for c in y])), 4)],
        "center": to_px(center, eye, x, y, ortho), "cuts": cuts, "balloons": balloons}
    bpy.data.objects.remove(ob, do_unlink=True); bm.free()

# isometric: the whole machine, seen from front-right-above along (1, -1, 1)
bm = bm_all.copy(); ob = make_object(bm, "Iso"); bm.free()
dirv = Vector((1, -1, 1)).normalized()
x, y = look(cam, mid + dirv * 80, mid, Vector((0, 0, 1)))
iso_need = 0
for p in all_pts:
    d = p - mid; iso_need = max(iso_need, abs(d.dot(x)) * 2, abs(d.dot(y)) * 2)
iso_ortho = iso_need * 1.12
cam_data.ortho_scale = iso_ortho
scene.render.filepath = os.path.join(OUT, "%s-iso.png" % MACHINE)
bpy.ops.render.render(write_still=True)
meta["views"]["iso"] = {"ortho": iso_ortho}
json.dump(meta, open(os.path.join(OUT, MACHINE + ".json"), "w"), indent=1)
print("DONE", MACHINE)
