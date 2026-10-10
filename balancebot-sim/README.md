# Plumb — a two-wheeled balancing robot simulator (v1.3.0)

A 3D simulator for a two-wheeled, single-axis balancing robot: real
Lagrangian dynamics (not a generic physics engine bolted on top), a
cascaded PID controller like the one real cheap hardware runs, and
physical parameters you can either tweak live in the browser or source
from an actual **FreeCAD** parametric model.

**[Live demo](https://kathuman.github.io/claude-projects/balancebot-sim/)**

## What's actually simulated

- **Dynamics**: a from-scratch Lagrangian derivation (not a physics engine),
  integrated with 4th-order Runge-Kutta at a step chosen from the
  parameters. Each wheel spins on its own, so it can **slip**: tyre grip is
  a friction law limited by `mu * N`. The body **lands on the floor** when
  it falls, and the motors are cut, as real firmware does. Verified by
  energy conservation, by reproducing the v1.0 no-slip model when grip is
  good, and more. See [`docs/dynamics.md`](docs/dynamics.md).
- **Real motors** (v1.2): brushed DC gearmotors built from datasheet numbers.
  - **Back-EMF** gives a real top speed: ask for more and the robot leans,
    saturates and falls.
  - **Battery voltage** matters: a sagging pack gives less torque than the
    firmware expects.
  - Also modelled: the rotor's inertia seen through the gearbox, **gear
    play**, and **quantized wheel encoders** feeding a filtered speed
    estimate.
  - Choose a generic hobby motor or Pololu micro metal gearmotors (30:1,
    50:1, 75:1 HPCB) with their published specs. The original ideal torque
    source is still there to compare against.
- **Real sensing** (v1.3): the firmware never sees the true angle.
  - **IMU from datasheets:** an MPU-6050 or LSM6DS33, modelled from its
    datasheet. Gyro noise, its zero-rate offset (calibrated away at power-on
    or not) and warm-up drift. An accelerometer that reads gravity but is
    fooled by every acceleration, more so the higher it's mounted.
  - **Tilt estimators:** gyro only, accelerometer only, a complementary
    filter, or a Kalman filter that learns the gyro offset.
  - **Display:** the estimate is plotted against the true pitch, with
    presets showing each failure and each fix.
- **Control**: a cascaded angle/velocity/yaw PID controller, with
  configurable control-loop rate, sensor noise and delay. The noise is
  seeded, so any run can be replayed exactly.
- **Configurations**: change geometry, mass, grip, gravity, motors, battery
  and gains live, or pick one of 12 presets. Each preset is shown with a
  scripted push, so the ones meant to fail visibly fail. They include:
  - a *Balboa-class* robot built from published Pololu parts
  - *Flat battery*, *Sloppy gears* and *On ice*
  - the classic *Slow control loop* and *Noisy sensor*

  A test checks each preset does what its description says.
- **CAD-sourced parameters**: run the FreeCAD macro in [`cad/`](cad/) and
  the mass and inertia come from real solid geometry instead of
  box-and-cylinder formulas.

## Running it

No build step. From the repo root:

```bash
cd balancebot-sim/web
python3 -m http.server 8000
# open http://localhost:8000
```

Drag to orbit the camera, scroll to zoom, arrow keys (or the on-screen pad)
to drive, space or **Push** to shove it off balance, `r` to reset.

## Running the tests

```bash
cd balancebot-sim
npm test
```

42 tests check the physics, hardware, sensing and controller against the derivation in
[`docs/dynamics.md`](docs/dynamics.md) and against published motor and IMU data:

- **Physics:** energy conservation, the upright equilibrium being a true
  fixed point, the uncontrolled robot falling over, and the new plant
  reproducing the v1.0 rolling model when grip is good.
- **Controller:** closed-loop recovery, speed and turn-rate tracking, and a
  slow control loop performing worse than the default rate.
- **Hardware:** datasheet stall torque and free-run speed for every motor,
  the published Pololu numbers, back-EMF capping the speed, gear lash
  passing no torque inside the gap, tyre force never exceeding `mu * N`, a
  fallen robot lying still on the floor, encoder quantization, and
  repeatable noise.
- **Sensing:** the accelerometer reading gravity at rest and `-atan(a/g)`
  when accelerating, noise matching the datasheet density, gyro-only drift
  `b*t`, the complementary filter's `b*tau` error, and the Kalman filter
  learning the bias.
- **Presets:** each one behaving as its description says.

## Structure

```
web/                  the simulator (static site, open web/index.html)
  js/dynamics.mjs      equations of motion, tyres, floor contact, DC motor + gear model, RK4
  js/motors.mjs        gearmotor library (datasheet numbers, sources, estimates marked)
  js/imu.mjs           IMU from datasheets (MPU-6050, LSM6DS33) + tilt estimators
  js/controller.mjs    cascaded PID balance controller, seeded sensor noise
  js/simloop.mjs       sensors (encoders), motor driver, control/physics timing
  js/params.mjs        parameter schema + closed-form mass/inertia derivation
  js/presets.mjs       named configurations with verified gains and scripted pushes
  js/scene.mjs         three.js robot model + rendering
  js/main.mjs          UI wiring, render loop, input
  cad/robot_params.json   FreeCAD's exported parameters (generated, not committed)
  cad/robot_params.default.json  a committed snapshot of the analytic defaults, for reference
cad/
  parametric_robot.py  FreeCAD macro: spreadsheet -> parametric model -> robot_params.json
  README.md            how to run it, parameter reference
tests/
  dynamics.test.mjs    plant and controller correctness
  hardware.test.mjs    motors, battery, gears, encoders, tyres, floor, noise
  imu.test.mjs         IMU readings, datasheet noise, estimators
  presets.test.mjs     every preset behaves as described
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
   `web/cad/robot_params.json` for the simulator to load (click **Load
   FreeCAD Params** in the UI; when served from localhost it also loads on
   start). Good for "does this
   specific mechanical design actually balance," where the box
   approximation stops being good enough — e.g. once the body isn't a
   uniform block, or you care about exact numbers for a real build.

See [`cad/README.md`](cad/README.md) for the full workflow and parameter
table.

## Known limitations

- No gyroscopic pitch/yaw coupling, and the wheels never leave the ground
  (see [`docs/dynamics.md`](docs/dynamics.md)).
- The IMU sees pitch only: no motor vibration, no cross-axis or scale-factor
  errors, and the chip's warm-up and its offsets drawn from datasheet
  tolerances are assumptions.
- Motor rotor inertia, gear play and external-gear efficiency are
  estimates where manufacturers don't publish them; the app labels them.
  The Balboa-class body's size and mass are estimates too.
- No position or heading hold; the controller takes velocity + turn-rate
  commands, like a real robot driven by a joystick.
- `cad/parametric_robot.py` was written against FreeCAD's documented
  Python API but developed without a FreeCAD install to run it against —
  the web simulator and its test suite are the verified parts of this
  repo; the CAD macro is believed correct but unverified. See the caveat
  at the top of that file.

## Versions

- **1.3.0**: real sensing.
  - Gyro and accelerometer from the MPU-6050 and LSM6DS33 datasheets: noise,
    zero-rate offset, warm-up drift, acceleration fooling the accelerometer.
  - Boot calibration.
  - Tilt estimators: gyro only, accelerometer only, complementary, and a
    Kalman filter with bias and acceleration gating.
  - Estimate-vs-truth chart.
  - Presets: gyro only uncalibrated, accelerometer only, complementary with an
    uncalibrated gyro, Kalman learns the bias.
- **1.2.0**: real hardware.
  - DC gearmotors from datasheets: back-EMF top speed, battery voltage,
    rotor inertia, gear play.
  - Quantized wheel encoders with a firmware speed filter.
  - Tyre grip and wheel slip, plus a yaw integral term.
  - New presets: Balboa-class (Pololu parts), flat battery, sloppy gears,
    on ice, and the old ideal motors.
- **1.1.0**: honest and usable.
  - Every preset is shown with a scripted push.
  - The body lands on the floor and the motors are cut.
  - A visible Push button; seeded, repeatable noise and pushes.
  - No 404 at load, a stage-first phone layout, the Cobot Lab theme, and
    version, credit and footer.
  - Fixes: slider edits stopped reaching the physics after the first
    geometry change; the body tilt and wheel spin were drawn mirrored; a
    control loop slower than the screen's frame rate never ran (the 25 Hz
    preset froze).
- **1.0.0**: Lagrangian pitch/drive dynamics, cascaded PID, presets,
  FreeCAD parameters.
