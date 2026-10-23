// Engineering models behind the feasibility checks: a brushed DC gearmotor on its linear torque–speed line, the force
// a wheeled robot needs on a slope, the battery it drains, and the static torque on each joint of a servo arm.
// Everything is SI. Each function is small and pure so the tests can check it against hand calculations.

export const G = 9.81;
const RPM = (2 * Math.PI) / 60;

// Rolling resistance and tyre grip by surface (rubber wheels).
export const TERRAIN = {
  'indoor-smooth': { label: 'Smooth indoor floor', crr: 0.015, mu: 0.7, minWheel: 0, outdoor: false },
  'indoor-carpet': { label: 'Carpet', crr: 0.06, mu: 0.7, minWheel: 0.06, outdoor: false },
  'outdoor-paved': { label: 'Paved paths', crr: 0.03, mu: 0.7, minWheel: 0.06, outdoor: true },
  'outdoor-grass': { label: 'Grass and gravel', crr: 0.12, mu: 0.5, minWheel: 0.08, outdoor: true },
};

// Rubber tracks: more rolling loss than wheels on hard floors, a better grip on soft ground, and the whole weight on
// the driven tracks. Mecanum rollers roll worse than a tyre, so their rolling resistance is doubled.
export const TRACKS = {
  'indoor-smooth': { crr: 0.05, mu: 0.8 },
  'indoor-carpet': { crr: 0.08, mu: 0.8 },
  'outdoor-paved': { crr: 0.06, mu: 0.8 },
  'outdoor-grass': { crr: 0.09, mu: 0.7 },
};
export const mecanumCrr = (terrain) => 2 * terrain.crr;

// The surface under a drive: rolling resistance and grip for wheels, tracks or mecanum rollers.
export function ground(terrainId, kind) {
  const terr = TERRAIN[terrainId];
  if (kind === 'tracks') return { ...terr, ...TRACKS[terrainId] };
  if (kind === 'mecanum') return { ...terr, crr: mecanumCrr(terr) };
  return terr;
}

// Turning a tank on the spot: the tracks scrub sideways along their whole contact length. With the weight spread
// evenly along a contact length L, the ground resists the turn with a moment μt·m·g·L/4, which the two tracks
// (B apart, one pushing forward, one back) must overcome; each also rolls against crr·m·g/2. μt, the sideways
// friction of a track, is taken as 0.75 of its grip. Returns the force each track must push with (N).
export const pivotForce = (m, ground, contact, B) => 0.75 * ground.mu * m * G * contact / (4 * B) + ground.crr * m * G / 2;

// Driving sideways on mecanum wheels (rollers at 45°): each wheel's force acts along its rollers, so to push the body
// sideways with force F every one of the four wheels pushes F·√2/4 along its rim.
export const strafeWheelForce = (m, crr, a) => (Math.SQRT2 * m * (crr * G + a)) / 4;

// A balancing robot holds a lean θ by accelerating its wheels at g·tan θ under the centre of mass; the largest
// acceleration the motors give is therefore the steepest lean it can still catch (degrees).
export const recoverableLean = (aMax) => (Math.atan(Math.max(0, aMax) / G) * 180) / Math.PI;

// To catch a lean θ (rad) the wheels must also outrun the falling body: a pendulum with its centre of mass h above
// the axle falls at speeds of order θ·√(g·h), which the wheels need on top of the driving speed.
export const catchSpeed = (h, theta) => theta * Math.sqrt(G * h);

// Motor at applied voltage V (linear in V): the no-load speed and the stall torque scale with V; the current rises
// along the torque line from the no-load current to the stall current, independent of V.
export function motorAt(motor, V) {
  const k = V / motor.vNom;
  return {
    w0: motor.noLoadRpm * RPM * k,
    Ts: motor.stallTorque * k,
    Is: motor.stallCurrent * k,
  };
}

export const motorCurrent = (motor, torque) =>
  motor.noLoadCurrent + Math.max(0, torque) * (motor.stallCurrent - motor.noLoadCurrent) / motor.stallTorque;

// Output-shaft speed (rad/s) at voltage V and load torque.
export const motorSpeed = (motor, V, torque) => {
  const m = motorAt(motor, V);
  return Math.max(0, m.w0 * (1 - torque / m.Ts));
};

// Voltage needed to turn at speed w (rad/s) against torque.
export const motorVoltageFor = (motor, w, torque) =>
  motor.vNom * (w / (motor.noLoadRpm * RPM) + torque / motor.stallTorque);

// Driver voltage drop at current I.
export const driverDrop = (driver, I) => driver.drop0 + driver.rdrop * I;

// Tractive force (N) for mass m on slope theta (rad) with rolling resistance crr and acceleration a.
export const tractiveForce = (m, crr, theta, a = 0) => m * G * (crr * Math.cos(theta) + Math.sin(theta)) + m * a;

// Highest PWM duty the firmware allows so the motor never sees more than its rated voltage on a full battery.
export function pwmLimit(motor, driver, battery) {
  const vMax = battery.vMax - driver.drop0;
  return Math.min(1, motor.vNom / vMax);
}

// Voltage the motor gets at full allowed duty from a battery at Vb while drawing current I.
export function motorVoltage(motor, driver, battery, Vb, I) {
  const duty = pwmLimit(motor, driver, battery);
  return Math.max(0, duty * (Vb - driverDrop(driver, I)));
}

// The drive at one operating point: force per motor → torque, current, the speed the motor can reach at full allowed
// duty, with the driver drop solved by fixed-point iteration (it depends on the current, which depends on the torque).
export function driveAt({ motor, driver, battery, wheel, nMotors }, force, Vb) {
  const r = wheel.diameter / 2;
  const torque = (force * r) / nMotors;
  const I = motorCurrent(motor, torque);
  const V = motorVoltage(motor, driver, battery, Vb, I);
  const w = motorSpeed(motor, V, torque);
  return { torque, current: I, voltage: V, speed: w * r, stallTorque: motorAt(motor, V).Ts };
}

// Average battery power for a duty cycle: the robot moves `movingFraction` of the time at `cruise` m/s on the flat,
// and the electronics draw `logicCurrent` from a 5 V rail through a buck of efficiency `eff`. Straight rolling is
// the easy part of real driving; starts, stops and turns (scrubbing tyres sideways, worst on skid steer) multiply the
// drive power by `turnFactor`: 1.5 for differential drive with a caster, a balancing robot, or mecanum wheels (whose
// rollers turn without scrubbing), 2.5 for four-wheel skid steer, 3 for tracks (the whole contact length scrubs).
export const turnFactor = (nMotors, kind = 'wheels') =>
  (kind === 'tracks' ? 3 : kind === 'mecanum' || kind === 'balance' ? 1.5 : nMotors === 4 ? 2.5 : 1.5);

export function averagePower({ motor, driver, battery, wheel, nMotors, kind }, { mass, crr, cruise, movingFraction,
  logicCurrent, eff = 0.85 }) {
  const r = wheel.diameter / 2;
  const torque = (tractiveForce(mass, crr, 0) * r) / nMotors;
  const I = motorCurrent(motor, torque);
  const Vm = motorVoltageFor(motor, cruise / r, torque);
  // the bridge loses its drop at the motor current; the battery supplies the motor's power plus that loss
  const drivePower = nMotors * (Vm + driverDrop(driver, I)) * I;
  return movingFraction * turnFactor(nMotors, kind) * drivePower + (5 * logicCurrent) / eff;
}

// Runtime in hours from a battery (80 % of the rated capacity is usable) at an average power.
export const runtimeHours = (battery, power) => (battery.capacity * battery.vNom * 0.8) / power;

// Standard blade-fuse ratings; the fuse is the next size up from 1.25 × the design peak.
const FUSES = [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40];
export const fuseFor = (peak) => FUSES.find((f) => f >= 1.25 * peak) ?? FUSES[FUSES.length - 1];

// Servo stall torque at supply V, interpolated between its 4.8 V and 6 V ratings.
export function servoTorque(servo, V) {
  const v = Math.min(V, servo.vMax);
  return servo.t48 + ((servo.t60 - servo.t48) * (v - 4.8)) / 1.2;
}

// Static gravity torque on each pitch joint, as the masses and their horizontal distances from the shoulder axis with
// the arm stretched out horizontally. `servos` maps joint name → servo; `payload` hangs at the grip point.
export function armMasses(frame, servos, payload) {
  const { L1, L2, tool } = frame;
  const wristAt = L1 + L2;
  const m = [];
  m.push({ what: 'upper arm', mass: frame.linkMass[0], x: L1 / 2 });
  // On a parallel-linkage frame the elbow servo sits at the base and adds no lever arm.
  if (servos.elbow && !frame.parallel) m.push({ what: 'elbow servo', mass: servos.elbow.mass, x: L1 });
  m.push({ what: 'forearm', mass: frame.linkMass[1], x: L1 + L2 / 2 });
  if (servos.wrist) m.push({ what: 'wrist servo', mass: servos.wrist.mass, x: wristAt });
  if (servos.roll) m.push({ what: 'wrist-roll servo', mass: servos.roll.mass, x: wristAt + 0.03 });
  m.push({ what: 'gripper', mass: frame.gripperMass + (servos.gripper?.mass ?? 0), x: wristAt + tool / 2 });
  m.push({ what: 'payload', mass: payload, x: wristAt + tool });
  return m;
}

// Worst-case holding torques when the work only needs `reach` (≤ the full stretch): the shoulder sees the arm bent so
// the grip point is `reach` out, approximated by scaling every lever arm by reach / full stretch; the elbow and wrist
// still meet their own worst case (forearm or tool horizontal) anywhere in the workspace, so they keep full levers.
export function jointTorques(frame, servos, payload, reach = armReach(frame)) {
  const m = armMasses(frame, servos, payload);
  const about = (pivot, k = 1) => G * m.filter((p) => p.x > pivot).reduce((s, p) => s + p.mass * (p.x - pivot) * k, 0);
  const t = { shoulder: about(0, Math.min(1, reach / armReach(frame))), elbow: about(frame.L1) };
  if (frame.joints.includes('wrist')) t.wrist = about(frame.L1 + frame.L2);
  return t;
}

// Torque a parallel gripper needs to hold a payload by friction (mu 0.5, safety factor 2), at finger radius r.
export const gripTorque = (payload, finger, mu = 0.5, sf = 2) => ((payload * G * sf) / (2 * mu)) * finger;

export const armReach = (frame) => frame.L1 + frame.L2 + frame.tool;
