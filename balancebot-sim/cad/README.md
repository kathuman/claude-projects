# CAD: `parametric_robot.py`

FreeCAD is the source of truth for this robot's physical parameters. The
macro in this folder builds a parametric model from a spreadsheet, computes
real mass/inertia from the actual solid geometry, and writes
[`web/cad/robot_params.json`](../web/cad/robot_params.json) — the file the
browser simulator loads.

## Running it

**GUI:** Open FreeCAD → Macro → Macros… → Execute → pick `parametric_robot.py`.

**Headless:**

```bash
freecadcmd parametric_robot.py
```

Run it once from a clean checkout to generate the baseline model. It creates:

- `parametric_robot.FCStd` — the FreeCAD document (not committed — see
  `.gitignore`; it's a binary file that's easiest to regenerate than to
  diff, and FreeCAD files don't merge well in git anyway)
- `exported/wheel.stl`, `exported/body.stl` — mesh exports of the two solids
- `../web/cad/robot_params.json` — the parameters the simulator reads,
  tagged `"source": "freecad"`

## Changing the robot

1. Open the document, switch to the **Spreadsheet** workbench, open the
   `Params` sheet.
2. Edit any cell (wheel radius, body density, motor torque limit, whatever).
   Every geometric dimension on the two wheels and the body is bound to
   this sheet via FreeCAD expressions, so the 3D model updates the moment
   you recompute (F5 / the refresh icon).
3. Re-run the macro (Execute it again — it finds the existing document and
   spreadsheet rather than recreating them, reads whatever is currently in
   the cells, rebuilds geometry from it, and re-exports). `robot_params.json`
   now reflects your edit; reload the simulator page (or click **Reload CAD
   Params** in its UI) to pick it up.

## Parameter reference

| Spreadsheet alias     | Meaning                                    | Default   |
|------------------------|---------------------------------------------|-----------|
| `wheelRadius`          | Wheel radius (m)                            | 0.04      |
| `wheelWidth`           | Wheel thickness (m)                         | 0.026     |
| `trackWidth`           | Distance between wheel inner faces (m)      | 0.16      |
| `bodyWidth`            | Body extent along the axle direction (m)    | 0.09      |
| `bodyDepth`            | Body extent fore-aft (m)                    | 0.05      |
| `bodyHeight`           | Body extent vertically (m)                  | 0.20      |
| `mountGap`             | Gap between axle top and body bottom (m)    | 0.0       |
| `wheelDensity`         | Lumped wheel material density (kg/m³)       | 1200      |
| `bodyDensity`          | Lumped body density incl. electronics (kg/m³) | 600     |
| `motorMaxTorque`       | Per-wheel torque saturation (N·m)           | 0.35      |
| `motorTimeConstant`    | First-order actuator lag (s)                | 0.02      |
| `gravity`              | m/s²                                        | 9.81      |
| `rollingResistance`    | Damping on forward speed                    | 0.02      |
| `pitchDamping`         | Damping at the pitch pivot                  | 0.0008    |
| `yawDamping`           | Damping on yaw rate                         | 0.01      |

`wheelMass`, `bodyMass`, `wheelInertia`, `bodyPitchInertia`, `yawInertia`
and `comHeight` are **not** spreadsheet inputs here — the macro computes
them from the real solids (`Shape.Volume`, `Shape.CenterOfMass`,
`Shape.MatrixOfInertia`) and the two densities above. That's the whole
point of routing this through FreeCAD instead of just editing
`robot_params.json` by hand: the inertia numbers come from actual geometry,
not a box-and-cylinder approximation. If you don't care about that and
just want to move sliders, the web app's built-in **Analytic** parameter
mode (see `web/js/params.mjs`) derives the same quantities with closed-form
formulas and needs no CAD tool at all — see the main [README](../README.md).

## A note on correctness

This script was written against FreeCAD's documented Python API but
developed somewhere without FreeCAD installed to actually run it against.
The geometry construction and expression bindings are standard, widely-used
API calls; the one part worth double-checking on your machine is the
`MatrixOfInertia` extraction in `centroidal_inertia()` — if the printed
inertia values look physically unreasonable (e.g. off by orders of
magnitude), that function is the first place to look. The units chain is
documented inline (`Shape.Volume`/`MatrixOfInertia` are in FreeCAD's
internal mm-based units; the script converts to SI before writing JSON).
