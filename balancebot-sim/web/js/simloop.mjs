// Wires dynamics.mjs + controller.mjs into a runnable loop: physics integrates at a fixed, fine
// timestep (as fine as the parameters need -- dynamics.stableStep); the controller runs at its own
// (configurable, coarser) rate and holds its output between updates -- a zero-order hold, exactly
// like a real microcontroller's control loop sitting on top of continuous physics.
//
// Between the two sit the robot's electronics:
//   sensors -- wheel encoders (quantized counts per control tick; speed and turn rate are
//              differenced from them, the way the firmware has to), and an IMU (gyro +
//              accelerometer, imu.mjs) whose readings a tilt estimator turns into pitch and pitch
//              rate -- or, with estimator 'truth', the true values (the controller then adds the
//              configured noise; it adds the delay in both cases);
//   driver  -- the controller asks for a torque; with the 'dc' motor model the driver turns that
//              into a PWM duty using the firmware's assumed torque-per-duty (stall torque at the
//              pack's *nominal* voltage), so a flat battery or back-EMF gives less than was asked.
//
// Shared by the browser (main.mjs, driven by requestAnimationFrame) and the Node test suite, so
// the tests exercise the exact code path the simulator runs.

import { rk4Step, restState, stableStep, accelerationsAt } from './dynamics.mjs';
import { createImu, createEstimator, sampleStd } from './imu.mjs';
import { torquePerDuty } from './motors.mjs';

export function createSimLoop(params, controller, physicsHz = 2000) {
  let state = restState();
  let desiredVelocity = 0;
  let desiredYawRate = 0;
  let lastCommand = { tauL: 0, tauR: 0, uL: 0, uR: 0 };
  let lastSensed = null;
  let enc = null; // previous encoder counts, for differencing
  let filt = null; // firmware's filtered speed estimates
  let imuUnit = null, est = null, estKey = '', imuRef = null; // the IMU chip and the firmware's tilt estimator
  let lastImu = null;

  /** Power-on: (re)create the chip and the estimator, calibrate the gyro if the firmware does. */
  function bootImu(r, fs) {
    imuUnit = createImu(params.imu, r.noiseSeed * 7919 + 17);
    imuRef = params.imu;
    const cal = r.calibrateGyro ? imuUnit.calibrate(fs) : 0;
    est = createEstimator({
      type: r.estimator,
      tau: r.complementaryTau,
      accelStdDeg: r.kalmanAccelStdDeg,
      gyroNoiseStd: sampleStd(params.imu.gyroNoiseDensity, fs),
      biasWalk: Math.max(1e-4, (params.imu.gyroTempCoeff * params.imu.tempRise) / params.imu.tempTau * 3),
      biasPrior: r.calibrateGyro ? sampleStd(params.imu.gyroNoiseDensity, fs) * 3 : params.imu.gyroZeroRate / 3,
      calibratedBias: cal,
      gravity: params.environment.gravity,
    });
  }

  function senseTilt(s, dt) {
    const r = controller.getRealism();
    if ((r.estimator || 'truth') === 'truth' || !params.imu) {
      lastImu = null;
      return { theta: s.theta, thetaDot: s.thetaDot };
    }
    const key = [r.estimator, r.complementaryTau, r.kalmanAccelStdDeg, r.calibrateGyro, r.noiseSeed, Math.round(1 / dt)].join('|');
    if (!est || key !== estKey || imuRef !== params.imu) { bootImu(r, 1 / dt); estKey = key; }
    const acc = accelerationsAt(s, lastCommand.uL, lastCommand.uR, params);
    const reading = imuUnit.read({ theta: s.theta, thetaDot: s.thetaDot, xDdot: acc.xDdot, thetaDdot: acc.thetaDdot }, params.environment.gravity, dt);
    const e = est.update(reading, dt);
    lastImu = { ...reading, accelTheta: e.accelTheta, biasEstimate: e.bias, biasTrue: imuUnit.gyroBias(), estimate: e.theta, truth: s.theta };
    return { theta: e.theta, thetaDot: e.thetaDot };
  }

  function counts(s) {
    const cpr = params.motor.encoderCpr;
    // the encoders sit on the motors, so they count the wheel's rotation relative to the body
    return {
      L: Math.floor(((s.phiL - s.theta) * cpr) / (2 * Math.PI)),
      R: Math.floor(((s.phiR - s.theta) * cpr) / (2 * Math.PI)),
    };
  }

  function sense(s, dt) {
    const R = params.geometry.wheelRadius, W = params.geometry.trackWidth;
    const useEnc = controller.getRealism().useEncoders !== false && params.motor.encoderCpr > 0;
    const tilt = senseTilt(s, dt);
    if (!useEnc) { enc = null; filt = null; return { ...tilt, xDot: s.xDot, psiDot: s.psiDot }; }
    const c = counts(s);
    if (!enc) enc = c;
    const k = (2 * Math.PI) / params.motor.encoderCpr / dt;
    // wheel speed over the ground = encoder (relative to body) + the body's own pitch rate
    // the firmware adds its own (estimated) pitch rate to the encoder speed
    const rawL = R * ((c.L - enc.L) * k + tilt.thetaDot);
    const rawR = R * ((c.R - enc.R) * k + tilt.thetaDot);
    enc = c;
    const hz = controller.getRealism().speedFilterHz || 0;
    const a = hz > 0 ? 1 - Math.exp(-2 * Math.PI * hz * dt) : 1;
    if (!filt) filt = { L: rawL, R: rawR };
    filt = { L: filt.L + a * (rawL - filt.L), R: filt.R + a * (rawR - filt.R) };
    return {
      theta: tilt.theta, thetaDot: tilt.thetaDot,
      xDot: (filt.L + filt.R) / 2, psiDot: (filt.R - filt.L) / W,
      rawXDot: (rawL + rawR) / 2, // unfiltered: whole counts per tick (plus the pitch-rate term)
    };
  }

  function drive(tauL, tauR) {
    if (params.motor.model !== 'dc') return { uL: tauL, uR: tauR };
    const k = torquePerDuty(params.motor);
    return { uL: tauL / k, uR: tauR / k };
  }

  /** The most torque the firmware may request per wheel (its duty saturates at +-1). */
  function commandLimit() {
    return params.motor.model === 'dc' ? torquePerDuty(params.motor) : params.motor.maxTorque;
  }

  function physics(uL, uR, duration) {
    const h = Math.min(1 / physicsHz, stableStep(params));
    const n = Math.max(1, Math.ceil(duration / h - 1e-9));
    for (let i = 0; i < n; i++) state = rk4Step(state, uL, uR, params, duration / n);
  }

  return {
    setCommand(velocity, yawRate) {
      desiredVelocity = velocity;
      desiredYawRate = yawRate;
    },
    setState(s) {
      state = { ...restState(), ...s };
      enc = null;
      filt = null;
    },
    getState() {
      return state;
    },
    getLastCommand() {
      return lastCommand;
    },
    getLastSensed() {
      return lastSensed;
    },
    /** The last IMU sample and estimate (null in true-angle mode). */
    getImu() {
      return lastImu;
    },
    /** The IMU chip as built (its drawn bias etc.), once booted. */
    getImuUnit() {
      return imuUnit;
    },
    /** Power cycle: robot back at rest, sensors and estimator re-booted (and re-calibrated). */
    reset() {
      state = restState();
      enc = null;
      filt = null;
      est = null;
      imuUnit = null;
      lastImu = null;
      lastCommand = { tauL: 0, tauR: 0, uL: 0, uR: 0 };
    },
    /** Swap in new parameters (live slider edits); the state carries over. */
    setParams(p) {
      params = p;
      enc = null;
      filt = null;
    },
    getParams() {
      return params;
    },
    /** Advance by exactly one control period: sense, one controller update, then fine physics substeps over that period. Defaults to the controller's own configured rate (realism.controlLoopHz); pass an explicit controlHz to override it (e.g. to demonstrate what a slower loop does). */
    advance(controlHz = controller.getRealism().controlLoopHz) {
      const controlDt = 1 / controlHz;
      lastSensed = sense(state, controlDt);
      const cmd = controller.update(lastSensed, desiredVelocity, desiredYawRate, controlDt, commandLimit());
      const u = drive(cmd.tauL, cmd.tauR);
      lastCommand = { ...cmd, ...u };
      physics(u.uL, u.uR, controlDt);
    },
    /** Advance physics only, with constant actuator inputs (torques for 'ideal', duties for 'dc') -- used for open-loop tests and once the firmware has cut the motors after a fall. */
    advanceOpenLoop(uL, uR, dt) {
      lastCommand = { tauL: 0, tauR: 0, uL, uR };
      physics(uL, uR, dt);
    },
  };
}

