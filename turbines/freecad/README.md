# Turbines in FreeCAD

FreeCAD 1.1 models of the three Turbine Lab machines (Pelton, Francis, Kaplan), rebuilt as proper solids from the
Blender scenes in `turbines/`. Each model sits at the same position as in Blender, in millimetres with Z up.

| File | What it is |
|---|---|
| `pelton.FCStd`, `francis.FCStd`, `kaplan.FCStd` | FreeCAD documents: one solid per part, grouped by part (runner, buckets, nozzle…), and a `PartsList` spreadsheet with item, quantity, how each part was built and its volume |
| `pelton.step`, `francis.step`, `kaplan.step` | the same solids as STEP, for other CAD programs |
| `measure_blender.py` | reads a Blender scene and writes `data/<machine>.json`: every part's position and an exact description of its shape |
| `build_freecad.py` | builds the FreeCAD documents and STEP files from that data, and checks every solid |
| `data/*.json` | the measurements |

Only the machines are modelled, not their sites (dam, powerhouse, river), and not the water or air. The wind twins
are left out too: they are scaled copies of the same machines.

## How each part is built

The measuring script tests every Blender mesh and picks the most exact way to rebuild it:

- **Revolved profile.** Shafts, discs, hubs, nozzle and needle, pipes, flanges, bearings, generators, the Francis crown,
  band and stay rings, and the Kaplan duct, bulb, hub and trunnions are all lathe shapes. Every vertex is checked to lie
  on the profile that gets revolved, so these are exact. The Kaplan duct is a 270° cutaway, so only that arc is revolved.
- **Ellipsoid cups.** Each Pelton bucket in Blender is two half-ellipsoids (semi-axes 130 × 120 × 170 mm, 14 mm wall).
  In FreeCAD it is the union of the two outer ellipsoids minus the two inner ones, cut at the rim. That gives two cups
  and the splitter ridge where they meet.
- **B-spline surface, thickened.** The 13 Francis runner blades, the 5 Kaplan blades and the 8 guide vanes are smooth
  surfaces interpolated through Blender's quad grid, then thickened by Blender's Solidify thickness. The Kaplan blades
  use the subdivided surface.
- **Planar faces.** Boxes, bolts, stay vanes and wicket gates are rebuilt face by face. Blender's Bevel becomes a
  chamfer (1 segment) or a fillet.
- **Solid from the mesh.** The Francis spiral casing and draft tube are irregular swept shapes. They are converted
  exactly from Blender's triangles into closed solids, so their surfaces are faceted, not smooth.

`build_freecad.py` checks that every part is a valid, closed solid with positive volume. Parts that come out as
several bodies are merged: an inner wall becomes a cavity, and overlapping pieces (a wicket gate's vane and pivot stem)
are fused.

## Rebuilding

From the repo root:

```
blender -b turbines/pelton_hydro_cutaway.blend       --python turbines/freecad/measure_blender.py -- pelton  turbines/freecad/data
blender -b turbines/francis_turbine_river_wind.blend --python turbines/freecad/measure_blender.py -- francis turbines/freecad/data
blender -b turbines/kaplan_turbine_river_wind.blend  --python turbines/freecad/measure_blender.py -- kaplan  turbines/freecad/data
"C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe" turbines/freecad/build_freecad.py
```

Set `TL_MACHINES=kaplan` (for example) to build just one machine. The scripts are rebuilds, not parametric FreeCAD
features: to change a turbine, edit the Blender scene (or the JSON) and run them again.

Checked by building all three (every solid valid and closed) and by rendering each FreeCAD model next to the Blender
original. The overall sizes match the technical drawings: Pelton 4 560 × 4 050 × 2 660 mm, Francis 11 630 × 5 230 ×
7 730 mm, Kaplan 4 400 × 3 600 × 3 720 mm.
