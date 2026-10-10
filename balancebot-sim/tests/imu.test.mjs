// v1.3 sensing: IMU readings from the dynamics, datasheet noise, and the tilt estimators.
import test from 'node:test';
import assert from 'node:assert/strict';

import { IMUS, imuParams, createImu, createEstimator, accelAngle, sampleStd } from '../web/js/imu.mjs';
import { buildPreset } from '../web/js/presets.mjs';
import { createController } from '../web/js/controller.mjs';
import { createSimLoop } from '../web/js/simloop.mjs';

const DEG = Math.PI / 180;
const G = 9.81;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

/** An IMU with every imperfection switched off, for checking the kinematics alone. */
function perfectImu(overrides = {}) {
  return imuParams('mpu6050', {
    gyroNoiseDensity: 0, gyroZeroRate: 0, gyroTempCoeff: 0, gyroGSensitivity: 0,
    accelNoiseDensity: 0, accelZeroG: 0, accelTempCoeff: 0, ...overrides,
  });
}

test('datasheet values are the published ones (MPU-6050 rev 3.4, LSM6DS33 rev 4)', () => {
  near(IMUS.mpu6050.gyroNoiseDensity / DEG, 0.005, 1e-12, 'MPU-6050 rate noise °/s/√Hz');
  near(IMUS.mpu6050.gyroZeroRate / DEG, 20, 1e-12, 'MPU-6050 zero-rate °/s');
  near(IMUS.mpu6050.accelNoiseDensity / 9.80665, 400e-6, 1e-12, 'MPU-6050 accel noise g/√Hz');
  near(IMUS.lsm6ds33.gyroNoiseDensity / DEG, 0.007, 1e-12, 'LSM6DS33 rate noise');
  near(IMUS.lsm6ds33.gyroZeroRate / DEG, 10, 1e-12, 'LSM6DS33 zero-rate');
  near(IMUS.lsm6ds33.accelZeroG / 9.80665, 0.04, 1e-12, 'LSM6DS33 zero-g');
});

test('standing still, the accelerometer reads gravity and its angle is the true tilt', () => {
  const imu = createImu(perfectImu(), 1);
  for (const th of [-0.4, 0, 0.1, 0.7]) {
    const r = imu.read({ theta: th, thetaDot: 0, xDdot: 0, thetaDdot: 0 }, G, 1 / 300);
    near(Math.hypot(r.aFwd, r.aUp), G, 1e-9, 'magnitude');
    near(accelAngle(r.aFwd, r.aUp), th, 1e-12, `angle at ${th}`);
  }
});

test('acceleration fools the accelerometer: speeding up at a reads as a tilt of -atan(a/g)', () => {
  const imu = createImu(perfectImu({ mountHeight: 0 }), 1);
  for (const a of [0.5, 2, -1.5]) {
    const r = imu.read({ theta: 0, thetaDot: 0, xDdot: a, thetaDdot: 0 }, G, 1 / 300);
    near(accelAngle(r.aFwd, r.aUp), -Math.atan(a / G), 1e-12, `a=${a}`);
  }
  // mounted higher, the body's angular acceleration fools it too (tangential acceleration h*thetaddot)
  const high = createImu(perfectImu({ mountHeight: 0.2 }), 1);
  const r = high.read({ theta: 0, thetaDot: 0, xDdot: 0, thetaDdot: 10 }, G, 1 / 300);
  near(accelAngle(r.aFwd, r.aUp), -Math.atan((0.2 * 10) / G), 1e-12, 'tangential');
});

test('per-sample noise matches the datasheet density over the sampled band', () => {
  const imu = createImu(imuParams('mpu6050', { gyroZeroRate: 0, gyroTempCoeff: 0, gyroGSensitivity: 0 }), 3);
  const fs = 300, n = 20000;
  let sum = 0, sum2 = 0;
  for (let i = 0; i < n; i++) {
    const g = imu.read({ theta: 0, thetaDot: 0, xDdot: 0, thetaDdot: 0 }, G, 1 / fs).gyro;
    sum += g; sum2 += g * g;
  }
  const std = Math.sqrt(sum2 / n - (sum / n) ** 2);
  const expected = sampleStd(IMUS.mpu6050.gyroNoiseDensity, fs);
  assert.ok(Math.abs(std / expected - 1) < 0.03, `gyro noise std ${std} vs ${expected}`);
});

/** Feed an estimator a still robot at angle th whose gyro has bias b, for T seconds. */
function stillRun(type, { th = 0, b = 0, T = 20, fs = 300, opts = {} } = {}) {
  const imu = createImu(perfectImu({ gyroZeroRate: 0 }), 1);
  const est = createEstimator({ type, tau: 1, accelStdDeg: 3, gyroNoiseStd: 1e-4, biasWalk: 1e-3, biasPrior: 0.5, ...opts });
  let e;
  for (let i = 0; i < T * fs; i++) {
    const r = imu.read({ theta: th, thetaDot: 0, xDdot: 0, thetaDdot: 0 }, G, 1 / fs);
    e = est.update({ ...r, gyro: r.gyro + b }, 1 / fs);
  }
  return e;
}

test('gyro only: an uncorrected bias integrates into an ever-growing angle error (b * t)', () => {
  const b = 2 * DEG;
  near(stillRun('gyro', { b, T: 10 }).theta, b * 10, 1e-6, 'error after 10 s');
});

test('complementary filter: a gyro bias leaves a steady error of bias x time constant', () => {
  const b = 5 * DEG, tau = 1;
  const e = stillRun('complementary', { b, T: 20, opts: { tau } });
  near(e.theta, b * tau, 0.01 * b * tau, 'steady-state error');
});

test('Kalman filter: learns the gyro bias and removes the angle error', () => {
  const b = 5 * DEG;
  const e = stillRun('kalman', { th: 0.05, b, T: 30 });
  near(e.bias, b, 0.05 * b, 'bias estimate');
  near(e.theta, 0.05, 0.2 * DEG, 'angle');
});

test('in true-angle mode the firmware sees the true pitch; with an IMU it sees an estimate', () => {
  for (const [estimator, same] of [['truth', true], ['complementary', false]]) {
    const b = buildPreset('default');
    b.realism.estimator = estimator;
    const loop = createSimLoop(b.params, createController(b.gains, b.realism));
    loop.setState({ theta: 0.05 });
    loop.advance();
    const s = loop.getLastSensed();
    assert.equal(s.theta === 0.05, same, `${estimator}: sensed ${s.theta}`);
    assert.equal(loop.getImu() === null, estimator === 'truth');
  }
});

test('the IMU unit is repeatable from the seed (same chip, same bias)', () => {
  const a = createImu(imuParams('mpu6050'), 42).unit, b = createImu(imuParams('mpu6050'), 42).unit;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, createImu(imuParams('mpu6050'), 43).unit);
});
