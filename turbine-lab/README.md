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

## Files

| Path | What it is |
|---|---|
| `index.html`, `style.css`, `app.js` | the page: viewer (three.js r186, vendored), controls, charts |
| `src/physics.js` | pure physics: power, Pelton/Euler, efficiency curves, speeds, specific speed, selection zones, water vs air |
| `src/machines.js` | the three machines' operating figures, every part's name and role, and the node-name → part rules |
| `models/*.glb` | the exported models (from `../turbines/*.blend`, via `tools/export_glb.py`) |
| `i18n.js`, `i18n-es.js`, `i18n-da.js` | languages (`?lang=en|es|da`); part names and roles are keyed by part |
| `tests/` | `physics`, `machines` (reads the .glb files), `i18n`, `release`. Run with `node turbine-lab/tests/<name>.test.js` |

CI: `.github/workflows/turbine-lab-ci.yml`.

## Re-exporting the models

After editing a scene in Blender, re-run the export command at the top of `tools/export_glb.py`, then run
`node turbine-lab/tests/machines.test.js`. It fails if a new mesh has no part label, or if a node the page drives was
renamed. Bump the version (`app.js`, the `?v=` on every script, and the About page in all three languages), because
browsers cache the models too.
