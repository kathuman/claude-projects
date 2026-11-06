# Turbine Lab — export one Blender scene to the web model the page loads.
# Run from the repo root, once per scene:
#   blender -b turbines/pelton_hydro_cutaway.blend       --python turbine-lab/tools/export_glb.py -- turbine-lab/models/pelton.glb
#   blender -b turbines/francis_turbine_river_wind.blend --python turbine-lab/tools/export_glb.py -- turbine-lab/models/francis.glb
#   blender -b turbines/kaplan_turbine_river_wind.blend  --python turbine-lab/tools/export_glb.py -- turbine-lab/models/kaplan.glb
# The pose at frame 1 is kept, animation is dropped (the page drives every moving part), the runners start at zero
# spin, and hidden boolean cutters, lights and the default cube are left out. Modifiers are applied.
import bpy, sys, json
out=sys.argv[sys.argv.index('--')+1]
s=bpy.context.scene
s.frame_set(1)
# freeze the frame-1 pose, then drop animation: the app drives every moving part itself
for o in s.objects:
    if o.animation_data: o.animation_data_clear()
for n in ('Runner','River_Kaplan_Runner','Wind_Kaplan_Runner','River_Francis_Runner','Wind_Francis_Runner'):
    o=s.objects.get(n)
    if o:
        r=list(o.rotation_euler); print("ZERO",n,[round(v,3) for v in r])
        # take the spin angle out so the runner starts at zero (other axes kept)
        if n=='Runner': o.rotation_euler[1]=0
        elif 'Kaplan' in n: o.rotation_euler[0]=0
        else: o.rotation_euler[2]=0
for o in list(s.objects):
    if o.hide_render or o.hide_get() or o.type in ('LIGHT',) or o.name in ('Cube',):
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_cameras=True,
    export_lights=False, export_animations=False, export_yup=True, export_extras=False,
    export_draco_mesh_compression_enable=False)
print("DONE",out)
