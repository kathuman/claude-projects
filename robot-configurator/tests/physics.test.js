// The engineering models against hand calculations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/physics.js';
import { part } from '../src/catalog.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test('motor line: speed, current and voltage are consistent', () => {
  const m = part('jga25-34-enc'); // 12 V, 170 rpm, 0.65 N·m stall, 2.0 A stall, 0.1 A free
  const w0 = (170 * 2 * Math.PI) / 60;
  near(P.motorSpeed(m, 12, 0), w0);
  near(P.motorSpeed(m, 12, 0.65), 0);
  near(P.motorSpeed(m, 6, 0.1), (w0 / 2) * (1 - 0.1 / 0.325)); // half voltage halves both no-load speed and stall torque
  near(P.motorCurrent(m, 0.325), 0.1 + 0.5 * 1.9);
  // the voltage needed for a speed and torque gives back that speed
  const V = P.motorVoltageFor(m, 10, 0.2);
  near(P.motorSpeed(m, V, 0.2), 10);
});

test('tractive force on a slope', () => {
  const th = (10 * Math.PI) / 180;
  near(P.tractiveForce(2, 0.03, th, 0.5), 2 * 9.81 * (0.03 * Math.cos(th) + Math.sin(th)) + 1.0);
  near(P.tractiveForce(1, 0.015, 0), 0.14715);
});

test('PWM cap keeps the motor at its rating on a full battery', () => {
  const tt = part('tt-dc');
  near(P.pwmLimit(tt, part('drv8833'), part('batt-2s-18650')), 6 / 8.4);
  near(P.pwmLimit(tt, part('l298n'), part('batt-2s-18650')), 6 / (8.4 - 1.4));
  near(P.pwmLimit(part('jgb37-30-enc'), part('mdd10a'), part('batt-3s-18650')), 12 / 12.6);
  assert.equal(P.pwmLimit(part('jgb37-30-enc'), part('l298n'), part('batt-2s-18650')), 1);
});

test('runtime from battery energy and power', () => {
  // 3 Ah × 7.4 V × 80 % = 17.76 Wh; at 8.88 W that is 2 h
  near(P.runtimeHours(part('batt-2s-18650'), 8.88), 2);
});

test('fuse is the next standard size above 1.25 × peak', () => {
  assert.equal(P.fuseFor(0.5), 1);
  assert.equal(P.fuseFor(1.6), 2);
  assert.equal(P.fuseFor(3.9), 5);
  assert.equal(P.fuseFor(6.1), 10);
});

test('servo torque interpolates between its 4.8 V and 6 V ratings and caps at vMax', () => {
  const s = part('mg996r');
  near(P.servoTorque(s, 4.8), 0.92);
  near(P.servoTorque(s, 6.0), 1.08);
  near(P.servoTorque(s, 5.4), 1.0);
  const sg = part('sg90');
  near(P.servoTorque(sg, 7.0), P.servoTorque(sg, 6.0));
});

test('arm joint torques by hand for the 4-axis aluminium arm', () => {
  const f = part('arm-alu-4axis');
  const mg = part('mg996r');
  const servos = { base: mg, shoulder: mg, elbow: mg, wrist: mg, gripper: mg };
  const pay = 0.1;
  const L1 = 0.105;
  const L2 = 0.098;
  const T = 0.15;
  // masses and their distances from the shoulder axis, arm horizontal
  const ms = [[0.05, L1 / 2], [0.055, L1], [0.05, L1 + L2 / 2], [0.055, L1 + L2], [0.08 + 0.055, L1 + L2 + T / 2],
    [pay, L1 + L2 + T]];
  const about = (x0) => 9.81 * ms.filter(([, x]) => x > x0).reduce((s, [m, x]) => s + m * (x - x0), 0);
  const t = P.jointTorques(f, servos, pay);
  near(t.shoulder, about(0));
  near(t.elbow, about(L1));
  near(t.wrist, about(L1 + L2));
  // at half the reach the shoulder lever arms halve; elbow and wrist keep their own worst case
  const h = P.jointTorques(f, servos, pay, P.armReach(f) / 2);
  near(h.shoulder, about(0) / 2);
  near(h.elbow, about(L1));
});

test('a parallel-linkage arm carries its elbow servo at the base', () => {
  const f = part('arm-micro-acrylic');
  const sg = part('sg90');
  const withServo = P.armMasses(f, { base: sg, shoulder: sg, elbow: sg, gripper: sg }, 0);
  assert.ok(!withServo.some((m) => m.what === 'elbow servo'));
});

test('grip torque: friction hold with safety factor', () => {
  // 0.1 kg, μ 0.5, ×2, two fingers → each finger presses 0.981 N... total normal force m g × 2 / (2 × 0.5) = 1.962 N
  near(P.gripTorque(0.1, 0.03), 1.962 * 0.03);
});
