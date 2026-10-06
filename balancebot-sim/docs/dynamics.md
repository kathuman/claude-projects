# Dynamics and control

This document derives the equations of motion in
[`web/js/dynamics.mjs`](../web/js/dynamics.mjs), describes the hardware model
(motors, battery, gears, encoders, tyres, floor) and explains the controller in
[`web/js/controller.mjs`](../web/js/controller.mjs). The tests in
[`tests/`](../tests/) check the implementation against this derivation and
against published motor data. Run them with `npm test` from `balancebot-sim/`.

## The plant

Two wheels share a common axle, and a body pivots about that axle. The motion
is described by:

- **x**: travel of the wheel axle along the heading
- **theta**: body pitch from vertical, positive when the body tips toward +x
- **psi**: heading (yaw)
- **phiL, phiR**: each wheel's absolute spin angle, with speeds **omegaL, omegaR**

Since v1.2 the wheels' spin is a degree of freedom of its own, not tied to
`x`. That is what lets a wheel slip on the floor. With good grip the result
reduces to the v1.0 rolling-without-slipping model, and a test checks this.

### Pitch / drive

Positions:

```
wheel axle:    (x, R)
body CoM:      (x + L sin(theta), R + L cos(theta))
```

where `R` = wheel radius and `L` = `comHeight` (the distance from axle to body CoM).

Kinetic and potential energy:

```
T = 1/2 (2*Mw + Mb) xdot^2 + Mb*L*cos(theta)*xdot*thetadot + 1/2 (Mb*L^2 + Ib) thetadot^2
    + 1/2 Iw (omegaL^2 + omegaR^2)
V = Mb*g*L*cos(theta)
```

The Euler-Lagrange equations, with generalized forces from the tyres
(`F_L`, `F_R`), the motors and the floor, give:

```
A * xddot  + Bc * thetaddot = F_L + F_R - bx*xdot + Mb*L*sin(theta)*thetadot^2 + Qc_x
Bc * xddot + Bb * thetaddot = Mb*g*L*sin(theta) - (tauBodyL + tauBodyR) - bTheta*thetadot + Qc_theta
Iw * omegadot_i             = tauWheel_i - R * F_i

A  = 2*Mw + Mb,   Bc = Mb*L*cos(theta),   Bb = Mb*L^2 + Ib
```

This is a 2×2 linear system in `(xddot, thetaddot)`, solved directly each
Runge-Kutta stage. The motor torque enters twice: it drives the wheel
(`tauWheel`), and the body feels the stator's reaction (`-tauBody`). For the
ideal motor these are the same torque. For the DC motor they differ while the
rotor accelerates or the gear play is open (see below).

**Why upright is unstable:** at `theta = 0` with no torque, a small positive
`theta` makes `Mb*g*L*sin(theta)` push `thetaddot` further positive. That is
the inverted pendulum, and a test checks that a torque-free tilt falls over.

### Tyres and wheel slip

```
F_i  = mu * N_i * tanh(slip_i / vSlip)
slip_i = R*omega_i - v_i,   v_L = xdot - (W/2)*psidot,   v_R = xdot + (W/2)*psidot
N_L = N_R = ((2*Mw + Mb)*g - Mb*L*cos(theta)*thetadot^2 - (load the body puts on the floor)) / 2
```

This is a regularized Coulomb friction law. Below a few mm/s of slip it acts
like a very stiff viscous coupling, so the wheel effectively rolls. Above
that, the force saturates at `mu*N` and the wheel spins.

`vSlip` (0.02 m/s) is a numerical width, not a physical claim. It makes the
equations stiff, which is why the integrator picks its step from the
parameters (see Integration).

The wheels never leave the ground, and the vertical load ignores the
`thetaddot` term. Both are documented simplifications.

**On ice the robot can still stay up.** With almost no traction, the motors
can still push against the body by spinning their own rotors and wheels.
Geared down, a small motor's rotor inertia looks large at the wheel: the
default motor's is about 4× the wheel's own inertia. So the drivetrain acts
as a small reaction wheel. It can absorb a push, but it can't hold position
or carry the robot anywhere. The *On ice* preset shows this.

### Yaw

```
Iyaw * psiddot = (W/2) * (F_R - F_L) - yawDamping * psidot
```

`Iyaw` is the frame's inertia about the vertical axis: the body, plus the
wheels' transverse inertia and parallel-axis terms. The wheels' spin inertia
now enters through `omega_i`. That corrects v1.0, which left it out of the
turning dynamics.

Gyroscopic coupling between pitch and yaw is still neglected. This is fine
while pitch and turn rates are modest.

### Floor contact

The body is a box. Its outline corners sit at the axle and at `bodyHeight`
above it, ±`bodyDepth/2` fore and aft. A corner below the floor is pushed
back by a stiff, damped spring (natural frequency `contactHz`, 40 Hz, damping
ratio 0.8). It slides with Coulomb friction (`bodyFriction`).

The corner's force maps to the generalized coordinates through the corner's
Jacobian:

```
Qc_x = Fx,   Qc_theta = Fx * d(corner x)/d(theta) + Fy * d(corner y)/d(theta)
```

So a fallen robot lands and lies there, instead of swinging through the floor
as it did in v1.0. Like real firmware, the app cuts the motors once the
robot passes 69°.

### Motors (`motor.model`)

**`'ideal'`** is the v1.0 model, kept for comparison. Its input is a torque
command, which acts on the wheel and body equally after a first-order lag.
There is no speed limit.

**`'dc'`** (the default) is a brushed DC gearmotor described at its output
shaft. It is built from the four datasheet numbers every gearmotor publishes
at its rated voltage `vNom`: stall torque and current, free-run speed and
current.

```
Ra = vNom / I_stall,   kt = tau_stall / I_stall,   ke = (vNom - I_free*Ra) / omega_free
i  = (duty * Vbattery - ke * omegaM) / Ra          (clipped to the driver's current limit)
tauEm = kt * i,        tauFric = kt * I_free * tanh(omegaM / 0.5 rad/s)
Jr * omegaM_dot = tauEm - tauFric - tauGear
```

- `omegaM` is the rotor speed relative to the body, expressed at the output
  shaft.
- `Jr` is the rotor's inertia reflected through the gearbox, `G² × J_motor`.
- The body feels `-(tauEm - tauFric)`.
- Inductance is neglected: the electrical time constant is about a
  millisecond, well inside the control period.

Consequences you can see in the app:

- **Back-EMF sets a top speed.** The robot can't drive faster than the
  motors' free-run speed times the wheel radius. Command more and it leans,
  saturates and falls. The speed chart's dashed line marks this limit.
- **Battery voltage scales everything.** The firmware converts its torque
  request to a PWM duty using the stall torque at the pack's *nominal*
  voltage. A sagging pack (the *Flat battery* preset) gives less torque than
  the firmware asked for, and a lower top speed.
- **Gear play.** The lash coordinate `delta` is the motor output angle minus
  the wheel angle (both relative to the body), with
  `deltadot = omegaM - (omega_wheel - thetadot)`. Inside the lash band
  (±backlash/2) no torque passes to the wheel. Outside it, the mesh is a
  stiff, damped spring (natural frequency `meshHz`, 150 Hz). Every torque
  reversal crosses the gap, which is the chatter in *Sloppy gears*.

The test suite checks that each motor reproduces its datasheet stall torque
and free-run speed, and that the Pololu numbers are the published ones. Where
the manufacturer publishes nothing (rotor inertia, gear lash, external-gear
efficiency), [`motors.mjs`](../web/js/motors.mjs) marks the value as an
estimate, and the app says so.

### Sensors and firmware (`simloop.mjs`)

- **Encoders** count each wheel's rotation *relative to the body*
  (they sit on the motors), quantized to `encoderCpr` counts per wheel turn.
- **Speed estimate.** Each control tick, the firmware differences the
  counts, adds the body's pitch rate to get speed over the ground, and
  low-pass filters it (`speedFilterHz`). Raw counts per tick are too coarse
  to feed back directly: at 300 Hz the default robot's encoder resolves only
  about 0.046 m/s. Untick *Measure speed with the wheel encoders* to give the
  controller the true speed instead.
- **Pitch and pitch rate** come from the true state, plus Gaussian noise and
  a delay of whole control ticks. A real IMU's drift, and the filter that
  fuses gyro and accelerometer, are the roadmap's next step (v1.3).
- **Repeatable noise.** Noise and the Push button use a seeded
  pseudo-random generator (mulberry32), so the same seed replays the same run.

### Integration

`rk4Step` advances the whole state with classic 4th-order Runge-Kutta,
holding the inputs constant over the step (zero-order hold). The state is:

- pitch, travel and yaw, with their rates
- world-frame pose
- the wheel angles and speeds
- per motor: rotor speed and lash
- the ideal model's two lag states

The step size comes from the parameters. `stableStep()` estimates the
stiffest rate in the system (tyre grip, gear mesh, floor contact, motor
electrical damping) and keeps the RK4 step inside its stability region.
`simloop` then integrates each control period in as many equal sub-steps as
that requires, never coarser than 2 kHz.

`mechanicalEnergy()` adds up the kinetic and potential energy, including
wheel spin and yaw. With no damping, no friction and no input it must be
conserved, and it is, to better than 1e-4 relative drift over 5 simulated
seconds. A sign error or missing term would show up as drift.

## The controller

`controller.mjs` is a cascaded PID, the same architecture real cheap
self-balancing robots run:

```
outer loop (velocity):  speed error        -> a small reference tilt angle
inner loop (angle):     tilt error         -> motor torque
yaw loop:               turn-rate error    -> torque difference (PI since v1.2)
```

The yaw loop gained an integral term in v1.2. With real motors, back-EMF and
the geared rotor inertia resist turning, so a P-only loop settles well short
of the commanded turn rate.

### Sign convention (the part that's easy to get backwards)

The inner loop looks like a PID with the "wrong" sign at first glance:

```js
const angleError = measured.theta - angleRef;   // not angleRef - theta
const tauCommon = gains.angleKp * angleError + gains.angleKd * measured.thetaDot + ...
```

Catching a forward tip means accelerating the wheels *forward* under the
body. It's the same reason a cart-pole is balanced by accelerating the cart
*toward* the side the pole is falling to. A naive `Kp * (setpoint -
measurement)` PID template gets this backwards for this plant.

### Realism knobs

- **Control rate.** `controlLoopHz` defaults to 300 Hz. Real embedded
  balance loops run from about 100 Hz (the Balboa 32U4 example code calls
  its balance update every 10 ms) up to 1 kHz. The *Slow control loop*
  preset, at 25 Hz, shows what happens when the loop can't keep up. It
  doesn't get gently worse: it oscillates, saturates its motors and falls.
- **IMU.** `sensorDelaySteps`, `sensorNoiseStdTheta` and `sensorNoiseStdRate`
  model a laggy, noisy IMU.

### Gains per configuration

A much lighter, taller or smaller robot needs different gains, as a real one
would. Each preset ships gains found by a grid search and verified by
[`tests/presets.test.mjs`](../tests/presets.test.mjs): every preset must do
what its description says under its scripted push (the falling presets
fall, the rest settle) and must drive at 0.35 m/s.

If your own configuration falls over at once, retune `angleKp` and `angleKd`
before suspecting the physics.

## Parameter reference

See [`web/js/params.mjs`](../web/js/params.mjs) for the schema and the
closed-form (box and cylinder) derivation, and [`cad/README.md`](../cad/README.md)
for the FreeCAD-driven, geometry-accurate alternative.

| Symbol  | Schema path                    | Meaning                                  |
|---------|--------------------------------|------------------------------------------|
| `R`     | `geometry.wheelRadius`         | Wheel radius                             |
| `W`     | `geometry.trackWidth`          | Distance between wheel centres           |
| `L`     | `geometry.comHeight`           | Axle-to-body-CoM distance                |
| `Mw`    | `mass.wheelMass`               | Mass of **one** wheel                    |
| `Mb`    | `mass.bodyMass`                | Body mass                                |
| `Iw`    | `inertia.wheelInertia`         | One wheel's inertia about its axle       |
| `Ib`    | `inertia.bodyPitchInertia`     | Body inertia about its CoM, pitch axis   |
| `Iyaw`  | `inertia.yawInertia`           | Frame inertia about the vertical axis    |
| --      | `motor.model`                  | `'dc'` (default) or `'ideal'`            |
| --      | `motor.stallTorque`, `stallCurrent`, `freeSpeed`, `freeCurrent`, `vNom` | Gearmotor datasheet values at the wheel |
| `Jr`    | `motor.rotorInertia`           | Rotor inertia seen at the wheel          |
| --      | `motor.backlash`               | Gear play at the wheel (rad)             |
| --      | `motor.batteryNominal`, `batteryVoltage` | Pack the firmware assumes, and its present voltage |
| --      | `motor.encoderCpr`             | Encoder counts per wheel turn            |
| --      | `motor.maxTorque`, `timeConstant` | Torque limit and lag (`'ideal'` model) |
| `g`     | `environment.gravity`          |                                          |
| `mu`    | `environment.groundFriction`   | Tyre-floor friction coefficient          |
| --      | `environment.bodyFriction`     | Body-floor friction once fallen          |
| `bx`    | `environment.rollingResistance`| Damping on forward speed                 |
| `bTheta`| `environment.pitchDamping`     | Damping at the pitch pivot               |
| --      | `environment.yawDamping`       | Damping on yaw rate                      |

Files written by the v1.0 FreeCAD macro (`schemaVersion` 1) still load. They
carry no motor model, so the robot keeps the DC motor it already has and takes
the file's mass, inertia and geometry.

## Next on the roadmap

- **v1.3, real sensing:** a gyro with drift and noise, an accelerometer that
  acceleration fools, and a complementary or Kalman filter, plotted against
  the true tilt.
- **v2.0, control design studio:** automatic linearization (`A`, `Bc`, `Bb`
  at `theta = 0` are the starting point), poles and margins, LQR and pole
  placement beside the PID, auto-tuning, and side-by-side scorecards.
