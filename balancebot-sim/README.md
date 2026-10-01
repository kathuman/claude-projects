# Plumb — a two-wheeled balancing robot simulator

A 3D simulator for a two-wheeled, single-axis balancing robot: real
Lagrangian dynamics (not a generic physics engine bolted on top), a
cascaded PID controller like the one real cheap hardware runs, and
physical parameters you can either tweak live in the browser or source
from an actual **FreeCAD** parametric model.

**[Live demo](https://kathuman.github.io/claude-projects/balancebot-sim/)**
(once published — see [Running it](#running-it) to try it locally first).

## What's actually simulated

- **Dynamics**: a from-scratch Lagrangian derivation of the pitch/drive
  subsystem (not a rigid-body physics engine), integrated with 4th-order
  Runge-Kutta. Verified by a mechanical-energy-conservation test, not just
  "it looks right" — see [`docs/dynamics.md`](docs/dynamics.md).
- **Control**: a cascaded angle/velocity/yaw PID controller, with
  configurable control-loop rate, sensor noise and sensor delay — turn
  those against yourself to feel why real balancing-robot firmware is
  hard.
- **Configuration**: change wheel radius, track width, body height/mass,
  motor torque, gravity, and controller gains live, or pick a preset
  (nimble, heavy, tall-and-tippy, tiny wheels, noisy sensor, too-slow
  control loop) — each with gains actually verified to match.
- **CAD-sourced parameters**: run the FreeCAD macro in [`cad/`](cad/) and
  the simulator's mass/inertia numbers come from real solid geometry and
  material density, not a box-and-cylinder approximation.

## Running it

No build step. From the repo root:

```bash
cd balancebot-sim/web
python3 -m http.server 8000
# open http://localhost:8000
```

Drag to orbit the camera, scroll to zoom, arrow keys to drive, space to
shove it off balance, `r` to reset.

## Running the tests

```bash
cd balancebot-sim
npm test
```

7 tests validate the physics and the controller against the derivation in
[`docs/dynamics.md`](docs/dynamics.md): energy conservation, the upright
equilibrium being a genuine fixed point, the uncontrolled system actually
falling over (inverted pendulums are supposed to be unstable), closed-loop
recovery from a disturbance, velocity and yaw command tracking, and —
concretely, not just asserted — a slow control loop performing worse than
the default rate.

## Structure

```
web/                  the simulator (static site, open web/index.html)
  js/dynamics.mjs      equations of motion + RK4 integrator
  js/controller.mjs    cascaded PID balance controller
  js/simloop.mjs       wires dynamics + controller into a runnable loop
  js/params.mjs        parameter schema + closed-form mass/inertia derivation
  js/presets.mjs       named configurations with verified gains
  js/scene.mjs         three.js robot model + rendering
  js/main.mjs          UI wiring, render loop, input
  cad/robot_params.json   FreeCAD's exported parameters (generated, not committed)
  cad/robot_params.default.json  a committed snapshot of the analytic defaults, for reference
cad/
  parametric_robot.py  FreeCAD macro: spreadsheet -> parametric model -> robot_params.json
  README.md            how to run it, parameter reference
tests/
  dynamics.test.mjs    the correctness tests described above
docs/
  dynamics.md          full derivation + controller design notes
```

## Why FreeCAD

Two ways to set the robot's physical parameters, and they're meant to be
used together at different stages:

1. **Analytic** (the default): move sliders for wheel radius, track width,
   body dimensions and density; `web/js/params.mjs` derives mass and
   inertia with closed-form box/cylinder formulas, instantly. Good for
   fast exploration.
2. **FreeCAD**: open [`cad/parametric_robot.py`](cad/parametric_robot.py)
   in FreeCAD, edit the `Params` spreadsheet, re-run the macro. It builds
   real parametric solids, computes mass/center-of-mass/inertia from the
   actual geometry and material density, and writes
   `web/cad/robot_params.json` for the simulator to load (click **Reload
   CAD Params** in the UI, or just reload the page). Good for "does this
   specific mechanical design actually balance," where the box
   approximation stops being good enough — e.g. once the body isn't a
   uniform block, or you care about exact numbers for a real build.

See [`cad/README.md`](cad/README.md) for the full workflow and parameter
table.

## Known limitations

- Yaw is a decoupled differential-drive approximation (see
  [`docs/dynamics.md`](docs/dynamics.md)) — no gyroscopic pitch/yaw
  coupling.
- No position or heading hold; the controller takes velocity + turn-rate
  commands, like a real robot driven by a joystick.
- `cad/parametric_robot.py` was written against FreeCAD's documented
  Python API but developed without a FreeCAD install to run it against —
  the web simulator and its test suite are the verified parts of this
  repo; the CAD macro is believed correct but unverified. See the caveat
  at the top of that file.
