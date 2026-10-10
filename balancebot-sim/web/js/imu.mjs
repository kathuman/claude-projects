// IMU and tilt estimation (v1.3): what the balance firmware actually knows about its own pitch.
//
// The robot has no "true angle" sensor. It has
//   a gyro          -- measures pitch RATE, plus a zero-rate offset (bias) that differs from chip to
//                      chip, drifts as the chip warms up, and white noise;
//   an accelerometer -- measures specific force (acceleration minus gravity) along the body's axes.
//                      Standing still it sees gravity, so its tilt is atan2(-a_fwd, a_up). But any
//                      acceleration of the sensor -- the robot speeding up, or the body swinging
//                      about the axle -- is indistinguishable from a tilt. Plus offset and noise.
// The firmware fuses the two. Gyro-only drifts away; accelerometer-only is fooled by every push;
// a complementary filter trusts the gyro short-term and the accelerometer long-term; a Kalman
// filter does the same with gains from the noise model and also learns the gyro bias.
//
// Pure functions + small stateful objects; shared by the browser and the tests.

import { seededRandom } from './controller.mjs';

const DPS = Math.PI / 180; // rad/s per deg/s
const G0 = 9.80665;

/**
 * Datasheet values (typical) as published; see `source`. Anything not in the datasheet is in
 * DEFAULT_IMU_ENV and marked as an assumption.
 */
export const IMUS = {
  mpu6050: {
    label: 'InvenSense MPU-6050 (hobby boards: GY-521 etc.)',
    source: 'MPU-6000/6050 Product Specification rev 3.4, sections 6.1-6.2: gyro rate noise 0.005 °/s/√Hz, initial zero-rate ±20 °/s, ±20 °/s over -40…85 °C, 0.1 °/s/g acceleration sensitivity; accelerometer noise 400 µg/√Hz, zero-g ±50 mg (X/Y), ±35 mg over 0…70 °C.',
    gyroNoiseDensity: 0.005 * DPS, // rad/s/sqrt(Hz)
    gyroZeroRate: 20 * DPS, // rad/s, typical initial tolerance
    gyroTempCoeff: (20 / 125) * DPS, // rad/s per degC (±20 °/s over 125 °C)
    gyroGSensitivity: (0.1 * DPS) / G0, // rad/s per m/s^2
    accelNoiseDensity: 400e-6 * G0, // m/s^2/sqrt(Hz)
    accelZeroG: 0.05 * G0, // m/s^2
    accelTempCoeff: (0.035 * G0) / 70, // m/s^2 per degC
  },
  lsm6ds33: {
    label: 'ST LSM6DS33 (Pololu Balboa 32U4)',
    source: 'LSM6DS33 datasheet DocID027423 rev 4, Table 3: rate noise 7 mdps/√Hz, zero-rate ±10 dps, ±0.05 dps/°C; acceleration noise 90 µg/√Hz, zero-g ±40 mg, ±0.5 mg/°C.',
    gyroNoiseDensity: 0.007 * DPS,
    gyroZeroRate: 10 * DPS,
    gyroTempCoeff: 0.05 * DPS,
    gyroGSensitivity: 0, // not specified in the datasheet
    accelNoiseDensity: 90e-6 * G0,
    accelZeroG: 0.04 * G0,
    accelTempCoeff: 0.5e-3 * G0,
  },
};

/** Things a datasheet doesn't tell you: how this robot uses and mounts the chip. Estimates. */
export const DEFAULT_IMU_ENV = {
  mountHeight: 0.1, // m above the axle, along the body
  tempRise: 8, // degC the chip warms up after power-on (motors, regulator, its own power) -- estimate
  tempTau: 60, // s, time constant of that warm-up -- estimate
  calibrationSeconds: 1, // firmware averages the gyro this long at boot, robot held still
};

export function imuParams(key, overrides = {}) {
  return { chip: key, ...IMUS[key], ...DEFAULT_IMU_ENV, ...overrides };
}

/** Per-sample noise std for a sensor read at fs (the chip's low-pass set to the Nyquist band, fs/2). */
export const sampleStd = (density, fs) => density * Math.sqrt(fs / 2);

function gauss(rand) {
  const u1 = Math.max(rand(), 1e-12), u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * One chip as built: its bias and temperature coefficients are drawn once, from the datasheet's
 * typical tolerances (treated as about 3 standard deviations -- an assumption), from the seed.
 */
export function createImu(imu, seed) {
  const rand = seededRandom(seed);
  const unit = {
    gyroBias0: (gauss(rand) * imu.gyroZeroRate) / 3,
    gyroTempCoeff: (gauss(rand) * imu.gyroTempCoeff) / 3,
    accelBias0: (gauss(rand) * imu.accelZeroG) / 3,
    accelTempCoeff: (gauss(rand) * imu.accelTempCoeff) / 3,
  };
  let t = 0;
  const temp = () => imu.tempRise * (1 - Math.exp(-t / imu.tempTau));
  return {
    unit,
    gyroBias: () => unit.gyroBias0 + unit.gyroTempCoeff * temp(),
    accelBias: () => unit.accelBias0 + unit.accelTempCoeff * temp(),
    /**
     * Sample the sensors. kin: pitch, pitch rate and accelerations of the axle (xddot) and body
     * (thetaddot), from the dynamics. Returns gyro (rad/s) and accelerometer (m/s^2, body frame).
     */
    read(kin, g, dt) {
      t += dt;
      const fs = 1 / dt, h = imu.mountHeight;
      const { theta, thetaDot, xDdot, thetaDdot } = kin;
      const s = Math.sin(theta), c = Math.cos(theta);
      // acceleration of the sensor point (x + h sin(theta), R + h cos(theta)), minus gravity
      const ax = xDdot + h * (c * thetaDdot - s * thetaDot * thetaDot);
      const ay = h * (-s * thetaDdot - c * thetaDot * thetaDot);
      const fx = ax, fy = ay + g;
      // body axes: forward (cos, -sin), up (sin, cos)
      const aFwd = fx * c - fy * s + this.accelBias() + gauss(rand) * sampleStd(imu.accelNoiseDensity, fs);
      const aUp = fx * s + fy * c + gauss(rand) * sampleStd(imu.accelNoiseDensity, fs);
      const gyro = thetaDot + this.gyroBias() + (imu.gyroGSensitivity || 0) * aFwd + gauss(rand) * sampleStd(imu.gyroNoiseDensity, fs);
      return { gyro, aFwd, aUp };
    },
    /** What a still-standing boot calibration measures: the bias plus the averaged-down noise. */
    calibrate(fs) {
      const n = Math.max(1, Math.round(imu.calibrationSeconds * fs));
      return this.gyroBias() + (gauss(rand) * sampleStd(imu.gyroNoiseDensity, fs)) / Math.sqrt(n);
    },
  };
}

/** The accelerometer's idea of the tilt. */
export const accelAngle = (aFwd, aUp) => Math.atan2(-aFwd, aUp);

export const ESTIMATORS = {
  truth: 'True angle (no IMU -- the v1.2 model)',
  gyro: 'Gyro only (integrate the rate)',
  accel: 'Accelerometer only',
  complementary: 'Complementary filter',
  kalman: 'Kalman filter (angle + gyro bias)',
};

/**
 * A tilt estimator as the firmware runs it, once per control tick.
 * opts: { type, tau (complementary, s), accelStdDeg (Kalman: assumed accelerometer-angle noise),
 *         gyroNoiseStd (rad/s per sample), biasWalk (rad/s/sqrt(s)), calibratedBias (rad/s) }
 */
export function createEstimator(opts) {
  const type = opts.type;
  let theta = null; // unset until the first reading (boot: taken from the accelerometer)
  let bias = opts.calibratedBias || 0;
  // Kalman covariance of [theta, bias]
  let P00 = 0.01, P01 = 0, P10 = 0, P11 = (opts.biasPrior || 0.05) ** 2;
  return {
    get bias() { return bias; },
    update({ gyro, aFwd, aUp }, dt) {
      const acc = accelAngle(aFwd, aUp);
      if (theta === null) theta = acc; // power-on: robot held upright, use gravity
      if (type === 'gyro') {
        theta += (gyro - bias) * dt;
      } else if (type === 'accel') {
        theta = acc;
      } else if (type === 'complementary') {
        const a = opts.tau / (opts.tau + dt);
        theta = a * (theta + (gyro - bias) * dt) + (1 - a) * acc;
      } else if (type === 'kalman') {
        // predict
        const rate = gyro - bias;
        theta += rate * dt;
        const qT = (opts.gyroNoiseStd || 1e-3) ** 2 * dt * dt + 1e-7 * dt;
        const qB = (opts.biasWalk || 1e-3) ** 2 * dt;
        P00 += dt * (dt * P11 - P01 - P10) + qT;
        P01 -= dt * P11;
        P10 -= dt * P11;
        P11 += qB;
        // correct with the accelerometer angle -- trusting it less the further the measured
        // acceleration is from 1 g (when the robot accelerates, the "gravity" it sees is a lie;
        // without this the bias estimate learns the robot's own motion and the filter runs away)
        const mag = Math.hypot(aFwd, aUp) / (opts.gravity || 9.81);
        const R = ((opts.accelStdDeg || 2) * Math.PI / 180) ** 2 * (1 + 400 * (mag - 1) ** 2);
        const S = P00 + R, K0 = P00 / S, K1 = P10 / S, y = acc - theta;
        theta += K0 * y;
        bias += K1 * y;
        const p00 = P00, p01 = P01;
        P00 -= K0 * p00; P01 -= K0 * p01; P10 -= K1 * p00; P11 -= K1 * p01;
      }
      return { theta, thetaDot: gyro - bias, accelTheta: acc, bias };
    },
  };
}
