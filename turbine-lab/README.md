# Turbine Lab

**Live:** https://kathuman.github.io/claude-projects/turbine-lab/

The three classic water turbines (Pelton, Francis and Kaplan) as 3D models you can turn, see through, take apart and
run. It is aimed at anyone learning how hydropower works. English, Spanish (Latin America) and Danish.

## What it does

- **3D viewer.** Each machine sits in its site: a high-head Pelton plant cut into a mountain, a Francis unit behind a
  low weir, and an in-stream Kaplan unit on a river bed. Point at a part to see what it does, or pick it from the list
  to fly to it. There are *See through the casing* and *Exploded view* toggles, and the runner spins at its real
  speed, slowed down as the note says.
- **Operate it.** For Pelton and Francis, head and flow give `P = ρ·g·Q·H·η`. The readout shows runner speed and the
  specific speed `Ns = n·√P / H^1.25`, checked against the runner's band. For the in-stream Kaplan and the wind twins,
  current speed gives `P = ½·ρ·A·v³·Cp`, capped at the rating. The Pelton needle and jet, the Francis wicket gates and
  the Kaplan blade pitch move with the controls.
- **Efficiency tab.** Typical efficiency against load for each kind, plus a locked-blade propeller for contrast. For
  Pelton it also shows Euler's bucket-speed curve, which peaks at half the jet speed.
- **Which turbine? tab.** A head–flow selection chart with power lines. Click to place a site; it recommends a
  turbine and can open it with that head and flow.
- **Water vs wind tab.** The Francis and Kaplan scenes each include a scaled-up "wind twin" fed by air. Air is 816×
  lighter than water and needs 9.3× the speed for the same power. Wind at 10 m/s presses with only 6 mm of water,
  against the Francis runner's 25 m design head. The twins are thought experiments, not designs.

- **Technical drawings** (`drawings.html`). For each turbine, an A3 general-arrangement sheet with:
  - sections A–A (front to back), B–B (side to side) and C–C (horizontal), all through the runner centre at one
    standard scale, plus an isometric view, in first-angle projection;
  - hatched cut faces, cutting-plane lines, overall dimensions and the runner diameter;
  - numbered balloons, a parts list with quantities, notes and a title block.

  The sheet can be printed (A3), downloaded as a standalone SVG, or shown in blueprint colours.

## Files

| Path | What it is |
|---|---|
| `index.html`, `style.css`, `app.js` | the page: viewer (three.js r186, vendored), controls, charts |
| `src/physics.js` | pure physics: power, Pelton/Euler, efficiency curves, speeds, specific speed, selection zones, water vs air |
| `src/machines.js` | the three machines' operating figures, every part's name and role, and the node-name → part rules |
| `drawings.html`, `drawings.js` | the drawings page: lays the rendered views out on an A3 sheet (SVG, mm) |
| `drawings/*.png`, `drawings/*.json` | the rendered views, and how each maps to metres (scale, cuts, extents, balloon points, quantities) |
| `models/*.glb` | the exported models (from `../turbines/*.blend`, via `tools/export_glb.py`) |
| `i18n.js`, `i18n-es.js`, `i18n-da.js` | languages (`?lang=en|es|da`); part names and roles are keyed by part |
| `tools/` | `export_glb.py` (models), `render_drawings.py` + `compress_drawings.py` (drawings), `build_i18n.py` (translations) |
| `tests/` | `physics`, `machines` (reads the .glb files), `drawings` (reads the drawing data), `i18n`, `release`. Run with `node turbine-lab/tests/<name>.test.js` |

CI: `.github/workflows/turbine-lab-ci.yml`.

## Re-rendering the drawings

```
blender -b turbines/pelton_hydro_cutaway.blend       --python turbine-lab/tools/render_drawings.py -- pelton  turbine-lab/drawings
blender -b turbines/francis_turbine_river_wind.blend --python turbine-lab/tools/render_drawings.py -- francis turbine-lab/drawings
blender -b turbines/kaplan_turbine_river_wind.blend  --python turbine-lab/tools/render_drawings.py -- kaplan  turbine-lab/drawings
python turbine-lab/tools/compress_drawings.py
```

How it works: each section bisects the machine through the runner centre and deletes the near half. Each object's
closed cut loops are capped and hatched. Freestyle then draws visible edges, thin in general and thick on the cut
outline. The three sections share one standard scale, at 125 mm per view on the A3 sheet. A test checks that the page
prints the views at that size, so the stated scale holds.

## Re-exporting the models

After editing a scene in Blender, re-run the export command at the top of `tools/export_glb.py`, then run
`node turbine-lab/tests/machines.test.js`. It fails if a new mesh has no part label, or if a node the page drives was
renamed. Bump the version (`app.js`, the `?v=` on every script, and the About page in all three languages), because
browsers cache the models too.
