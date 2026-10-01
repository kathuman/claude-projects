# Dynamics and control

This document derives the equations of motion in
[`web/js/dynamics.mjs`](../web/js/dynamics.mjs) and explains the controller
in [`web/js/controller.mjs`](../web/js/controller.mjs). Both are verified
against this derivation in [`tests/dynamics.test.mjs`](../tests/dynamics.test.mjs)
— `npm test` from the repo root runs them.

## The plant

Two wheels share a common axle; a body pivots about that axle. Three
coordinates describe the robot's motion:

- **x** — translation of the wheel axle along the direction of travel
- **theta** — body pitch, measured from vertical, positive when the body
  tips toward +x
- **psi** — heading (yaw)

### Pitch / drive subsystem (the "single axis" in the name)

The two wheels are lumped together (`2*wheelMass`, `2*wheelInertia`) because
this subsystem only cares about their *common* rotation — the *difference*
between wheel speeds is handled separately, below, as yaw.

Positions:

```
wheel axle:    (x, R)
body CoM:      (x + L sin(theta), R + L cos(theta))
```

where `R` = wheel radius, `L` = `comHeight` (axle-to-body-CoM distance).

Kinetic energy:

```
T = 1/2 (2*Mw + 2*Iw/R^2 + Mb) xdot^2
    + Mb*L*cos(theta)*xdot*thetadot
    + 1/2 (Mb*L^2 + Ib) thetadot^2
```

Potential energy (dropping the constant wheel-height term):

```
V = Mb*g*L*cos(theta)
```

Applying the Euler-Lagrange equations to `(x, theta)`, with `tau = tauL +
tauR` (the combined wheel torque — equal and opposite reaction on wheel and
body) and linear damping terms `bx` (rolling resistance) and `bTheta` (pivot
friction), the `thetadot*xdot` cross terms cancel exactly — a good sign the
algebra is right — leaving:

```
A * xddot     + Bc * thetaddot = tau/R - bx*xdot + Mb*L*sin(theta)*thetadot^2
Bc * xddot    + Bb * thetaddot = Mb*g*L*sin(theta) - tau - bTheta*thetadot

A  = 2*Mw + 2*Iw/R^2 + Mb
Bc = Mb*L*cos(theta)
Bb = Mb*L^2 + Ib
```

This is a 2x2 linear system in `(xddot, thetaddot)` for any given state and
torque — solved directly (Cramer's rule) each RK4 stage, no iterative solver
needed.

**Why upright is unstable:** at `theta = 0`, `tau = 0`, a small positive
`theta` makes the `Mb*g*L*sin(theta)` term push `thetaddot` further positive
— positive feedback. That's the inverted pendulum; `tests/dynamics.test.mjs`
checks exactly this ("a torque-free tilt falls over").

### Yaw (decoupled)

Modeled as a differential-drive approximation, standard in the
balancing-robot literature when pitch and yaw rates stay modest:

```
Iyaw * psiddot = (trackWidth / (2R)) * (tauR - tauL) - yawDamping * psidot
```

**Known limitation:** this ignores gyroscopic coupling between pitch and
yaw (a fast yaw while tilted really does perturb pitch on a real robot).
Fine for this simulator's purposes; a natural extension is a full 3D
rigid-body model if you want that cross-coupling.

### Integration

`rk4Step` in `dynamics.mjs` advances the full state — `theta, thetaDot, x,
xDot, psi, psiDot` plus world-frame pose (`posX, posZ`, integrated
alongside the dynamics so the renderer doesn't redo the heading integral)
and two actuator-lag states (`tauLAct, tauRAct`, a first-order filter from
commanded to actual per-wheel torque) — with classic 4th-order Runge-Kutta,
holding the commanded torque constant across each step (zero-order hold,
same as a real digital controller driving an analog plant).

`mechanicalEnergy()` computes kinetic + potential energy of the pitch/drive
subsystem; with zero damping and zero torque this must be conserved. It is,
to better than 1e-4 relative drift over 5 simulated seconds at dt=1ms — the
strongest available check that the derivation and implementation agree,
since a sign error or missing term in the Lagrangian would show up as
energy drift, not just numerical noise.

## The controller

`controller.mjs` implements a cascaded PID, the same architecture real
cheap self-balancing robots run:

```
outer loop (velocity):  speed error        -> a small reference tilt angle
inner loop (angle):     tilt error         -> motor torque
yaw loop:               turn-rate error    -> torque difference
```

### Sign convention (the part that's easy to get backwards)

The inner loop looks like a PID with the "wrong" sign at first glance:

```js
const angleError = measured.theta - angleRef;   // not angleRef - theta
const tauCommon = gains.angleKp * angleError + gains.angleKd * measured.thetaDot + ...
```

This was verified empirically against `dynamics.mjs`, not just reasoned
about: starting from a small forward tilt (`theta = 0.05`) with a *fixed*
torque, positive `tau` reduces `theta` and negative `tau` increases it (see
the commit history / the experiment behind this file if you want to
reproduce it). Catching a forward tip means accelerating the wheels
*forward* under the body — the same reason a cart-pole is balanced by
accelerating the cart *toward* the direction the pole is falling, not away
from it. A naive `Kp * (setpoint - measurement)` PID template gets this
backwards for this particular plant.

### Realism knobs, and where the default control rate comes from

`defaultRealism()` sets `controlLoopHz: 300`. That number isn't arbitrary:
with the default gains, this plant is stable above roughly **225 Hz** and
visibly chatters below it (the derivative term amplifies the discretization
error at low sample rates — a textbook digital-control failure mode, not a
bug). 300 Hz gives a comfortable margin. Push `controlLoopHz` down in the
UI (or load the **Slow control loop** preset, 25 Hz) to see it for
yourself — it fails by oscillating and tumbling, not by gently drifting,
which is itself the lesson: a digital control loop that's "a bit too slow"
usually isn't a little worse, it's unstable.

`sensorDelaySteps`, `sensorNoiseStdTheta` and `sensorNoiseStdRate` model a
laggy/noisy IMU, independent of the control rate.

### Gain scheduling across configurations

The default gains do **not** stabilize every configuration in
[`web/js/presets.mjs`](../web/js/presets.mjs) — a much lighter or taller
robot genuinely needs different gains, the same way a real one would.
Each preset ships gains that were actually grid-searched and verified
against that preset's physical parameters (see `tests/dynamics.test.mjs`
for the verification pattern: converge from a small initial tilt, check
`|theta|` stays bounded and settles). If you add your own configuration
and it falls over immediately, that's very likely why — retune
`angleKp`/`angleKd` before suspecting the physics.

## Parameter reference

See [`web/js/params.mjs`](../web/js/params.mjs) for the schema and
closed-form (box/cylinder) derivation, and [`cad/README.md`](../cad/README.md)
for the FreeCAD-driven, geometry-accurate alternative.

| Symbol  | Schema path                  | Meaning                                |
|---------|-------------------------------|-----------------------------------------|
| `R`     | `geometry.wheelRadius`        | Wheel radius                            |
| --      | `geometry.trackWidth`         | Distance between wheel centers          |
| `L`     | `geometry.comHeight`          | Axle-to-body-CoM distance               |
| `Mw`    | `mass.wheelMass`              | Mass of **one** wheel                   |
| `Mb`    | `mass.bodyMass`               | Body mass                               |
| `Iw`    | `inertia.wheelInertia`        | One wheel's inertia about its own axle  |
| `Ib`    | `inertia.bodyPitchInertia`    | Body inertia about its own CoM, pitch axis |
| `Iyaw`  | `inertia.yawInertia`          | Whole-assembly inertia about the vertical axis through the combined CoM |
| --      | `motor.maxTorque`             | Per-wheel torque saturation             |
| --      | `motor.timeConstant`          | First-order actuator lag                |
| `g`     | `environment.gravity`         |                                          |
| `bx`    | `environment.rollingResistance` | Damping on forward speed              |
| `bTheta`| `environment.pitchDamping`    | Damping at the pitch pivot              |
| --      | `environment.yawDamping`      | Damping on yaw rate                     |

## Extending this

- **Inverse kinematics / position hold**: the controller currently takes
  velocity + turn-rate commands, not a target pose. Adding an outer
  position/heading loop on top of the existing velocity loop is a natural
  next cascade layer.
- **Full 3D rigid-body coupling**: replace the decoupled yaw approximation
  with a proper 3D Euler/quaternion rigid-body model if you need
  pitch-yaw gyroscopic coupling.
- **LQR / full-state feedback**: the cascaded PID here is what real cheap
  hardware runs, but a linearized model (see the `A`/`Bc`/`Bb` matrix
  above, evaluated at `theta=0`) is a clean starting point for an LQR
  controller if you'd rather compute gains than hand-tune them.
