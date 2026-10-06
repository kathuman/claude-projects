// v1.2 hardware model: DC gearmotors from datasheets, battery, gear lash, encoders, tyre grip,
// floor contact, repeatable noise.
import test from 'node:test';
import assert from 'node:assert/strict';

import { restState, integrate, forcesAt, motorConstants, motorSteadyTorque } from '../web/js/dynamics.mjs';
import { defaultParams, mergeParams } from '../web/js/params.mjs';
import { MOTORS, BALBOA_EXTERNAL, motorParams, freeSpeedAt, torquePerDuty } from '../web/js/motors.mjs';
import { createController, defaultGains, defaultRealism } from '../web/js/controller.mjs';
import { createSimLoop } from '../web/js/simloop.mjs';
import { buildPreset } from '../web/js/presets.mjs';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('the motor model reproduces its datasheet: stall torque at standstill, zero net torque at free-run speed', () => {
  for (const key of Object.keys(MOTORS)) {
    const m = motorParams(MOTORS[key]);
    near(motorSteadyTorque(m, 1, m.vNom, 1e-9), m.stallTorque - motorConstants(m).tauFric, 1e-9, `${key} stall`);
    near(motorSteadyTorque(m, 1, m.vNom, m.freeSpeed), 0, 1e-9, `${key} free run`);
  }
});

test('the Pololu 50:1 HPCB numbers are the published ones (pololu.com/product/3073)', () => {
  const m = motorParams(MOTORS.pololu50);
  near(m.stallTorque, 0.74 * 0.0980665, 1e-9, 'stall torque N*m');
  near((m.freeSpeed * 60) / (2 * Math.PI), 650, 1e-9, 'free-run rpm');
  // the Balboa 32U4 guide's example: 50:1 motors through 2.88:1 gears give ~1778 counts per wheel turn
  assert.equal(motorParams(MOTORS.pololu50, { external: BALBOA_EXTERNAL }).encoderCpr, 1778);
});

test('back-EMF sets a top speed: the robot cannot outrun its motors (and a flat battery lowers it)', () => {
  const b = buildPreset('default');
  const controller = createController(b.gains, b.realism);
  const loop = createSimLoop(b.params, controller);
  loop.setCommand(5, 0); // far beyond what the motors can do
  let vMaxUpright = 0;
  for (let i = 0; i < b.realism.controlLoopHz * 6; i++) {
    loop.advance();
    const s = loop.getState();
    if (Math.abs(s.theta) < 0.5) vMaxUpright = Math.max(vMaxUpright, s.xDot);
    else break;
  }
  const top = freeSpeedAt(b.params.motor, b.params.motor.batteryVoltage) * b.params.geometry.wheelRadius;
  assert.ok(vMaxUpright <= top * 1.05, `upright speed ${vMaxUpright} exceeds the motors' free speed ${top}`);
  const flat = buildPreset('flatbattery').params.motor;
  near(freeSpeedAt(flat, flat.batteryVoltage) / freeSpeedAt(flat, flat.vNom), 6.2 / 7.4, 1e-12, 'top speed scales with voltage');
  // the firmware still assumes the nominal pack, so a sagging battery gives less torque than it asks for
  near(torquePerDuty(flat), b.params.motor.stallTorque, 1e-12, 'firmware torque-per-duty');
});

test('gear lash: no torque reaches the wheel until the play is taken up', () => {
  const p = buildPreset('sloppygears').params;
  const half = p.motor.backlash / 2;
  const inGap = forcesAt({ ...restState(), deltaL: half * 0.5 }, 1, 1, p);
  const engaged = forcesAt({ ...restState(), deltaL: half * 1.5 }, 1, 1, p);
  assert.equal(inGap.tauWL, 0);
  assert.ok(engaged.tauWL > 0, `engaged mesh should transmit torque, got ${engaged.tauWL}`);
  // the motor still pushes against the body either way (stator reaction)
  assert.ok(inGap.tauBL > 0);
});

test('the tyre force never exceeds the grip mu*N, and a hard launch on ice makes the wheels slip', () => {
  const b = buildPreset('ice');
  const loop = createSimLoop(b.params, createController(b.gains, b.realism));
  loop.setState({ thetaDot: b.nudge });
  let maxRatio = 0, maxSlip = 0;
  for (let i = 0; i < b.realism.controlLoopHz * 2; i++) {
    loop.advance();
    const s = loop.getState(), c = loop.getLastCommand();
    const f = forcesAt(s, c.uL, c.uR, b.params);
    maxRatio = Math.max(maxRatio, Math.abs(f.FL) / (b.params.environment.groundFriction * f.N));
    maxSlip = Math.max(maxSlip, Math.abs(b.params.geometry.wheelRadius * s.omegaL - s.xDot));
  }
  assert.ok(maxRatio <= 1 + 1e-9, `tyre force exceeded grip: ${maxRatio}`);
  assert.ok(maxSlip > 0.1, `expected visible wheel slip on ice, got ${maxSlip} m/s`);
});

test('a fallen robot lands on the floor and lies still once the firmware cuts the motors', () => {
  const b = buildPreset('default');
  // tip it well past recovery, motors off (duty 0), and let it fall
  const s = integrate({ ...restState(), theta: 0.6, thetaDot: 1 }, 0, 0, b.params, 3);
  const deg = (Math.abs(s.theta) * 180) / Math.PI;
  assert.ok(deg > 75 && deg < 105, `should be lying on its side near 90 degrees, got ${deg}`);
  assert.ok(Math.abs(s.thetaDot) < 0.05 && Math.abs(s.xDot) < 0.02, `should be at rest, thetaDot ${s.thetaDot}, xDot ${s.xDot}`);
  // the body's corners stay (almost) out of the floor
  const { wheelRadius: R, bodyHeight: H, bodyDepth: D } = b.params.geometry;
  const lowest = Math.min(...[0, H].flatMap((h) => [-1, 1].map((sg) => R + h * Math.cos(s.theta) - sg * (D / 2) * Math.sin(s.theta))));
  assert.ok(lowest > -0.005, `body sank ${(-lowest * 1000).toFixed(1)} mm into the floor`);
});

test('encoders quantize the measured speed to whole counts per control tick', () => {
  const p = defaultParams();
  const loop = createSimLoop(p, createController(defaultGains(), defaultRealism()));
  const hz = defaultRealism().controlLoopHz, R = p.geometry.wheelRadius;
  const q = (R * 2 * Math.PI * hz) / p.motor.encoderCpr; // one count per tick, in m/s
  loop.setCommand(0.2, 0);
  let worst = 0, maxErr = 0;
  for (let i = 0; i < hz * 3; i++) {
    loop.advance();
    const sensed = loop.getLastSensed();
    // the firmware's speed = mean of whole counts per tick + the pitch-rate correction
    const halfCounts = (sensed.rawXDot - R * sensed.thetaDot) / (q / 2);
    worst = Math.max(worst, Math.abs(halfCounts - Math.round(halfCounts)));
    if (i > hz) maxErr = Math.max(maxErr, Math.abs(sensed.rawXDot - loop.getState().xDot));
  }
  assert.ok(worst < 1e-6, `measured speed is not a whole number of counts: off by ${worst}`);
  assert.ok(maxErr > 0, 'quantized speed should differ from the true speed');
  assert.ok(maxErr < 2 * q + 0.05, `quantization error ${maxErr} is larger than a couple of counts (${q} m/s each)`);
});

test('sensor noise is repeatable from its seed (and differs between seeds)', () => {
  function run(seed) {
    const r = { ...defaultRealism(), sensorNoiseStdTheta: 0.01, sensorNoiseStdRate: 0.05, noiseSeed: seed };
    const loop = createSimLoop(defaultParams(), createController(defaultGains(), r));
    for (let i = 0; i < 300; i++) loop.advance();
    return loop.getState().theta;
  }
  assert.equal(run(7), run(7));
  assert.notEqual(run(7), run(8));
});
