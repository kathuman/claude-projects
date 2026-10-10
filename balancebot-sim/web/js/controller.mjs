// Cascaded PID balance controller -- the same architecture real cheap
// self-balancing robots run (e.g. Balboa/nBot-class firmware):
//
//   outer loop (velocity):  speed error -> a small reference tilt angle
//   inner loop (angle):     tilt error  -> motor torque
//   yaw loop:                turn-rate error -> torque *difference*
//
// The inner loop must run fast and firm (it's stabilizing an inherently
// unstable equilibrium); the outer loop is deliberately gentle -- it only
// needs to bias the tilt a little to make the robot lean into the
// direction it should accelerate toward.
//
// Separately-configurable "realism" knobs live here rather than in the
// plant (dynamics.mjs) because they model the *control system*, not the
// robot: how fast the control loop runs, how old the sensor data it sees
// is, and how noisy that data is. Turning these against you is the
// fastest way to feel why real balancing-robot firmware is hard.

export function defaultGains() {
  return {
    angleKp: 10,
    angleKi: 20,
    angleKd: 1.6,
    velocityKp: 0.6,
    velocityKi: 0.3,
    yawKp: 0.08,
    yawKi: 0.4, // integral on turn-rate error: the motors' back-EMF and rotor inertia resist turning
    maxTiltRef: 0.26, // rad (~15 deg) -- cap how hard the velocity loop may lean the robot
    integralClamp: 4,
  };
}

export function defaultRealism() {
  return {
    // 300 Hz has a healthy margin above the ~225 Hz stability cliff for the
    // default gains above (push angleKd up, or the rate down, and you can
    // find that cliff yourself -- it shows up as chatter, not a gentle
    // slide into instability, which is itself a realistic lesson about
    // digital control). Real embedded balance loops commonly run 100 Hz-1 kHz.
    controlLoopHz: 300,
    sensorDelaySteps: 0, // number of control ticks of measurement latency
    sensorNoiseStdTheta: 0, // rad, gaussian
    sensorNoiseStdRate: 0, // rad/s, gaussian
    noiseSeed: 1, // the noise is pseudo-random from this seed, so every run can be repeated exactly
    useEncoders: true, // measure speed and turn rate from quantized wheel encoders (else: true values)
    speedFilterHz: 8, // firmware low-pass on encoder speed: raw counts per tick are too coarse to feed back directly
    // tilt estimation from the IMU (imu.mjs); 'truth' skips the IMU and uses the true angle plus the
    // sensorNoise* values above (the v1.2 model)
    estimator: 'complementary',
    complementaryTau: 1, // s: trust the gyro for faster changes than this, the accelerometer for slower
    kalmanAccelStdDeg: 3, // Kalman: how noisy the firmware assumes the accelerometer angle is (deg)
    calibrateGyro: true, // average the gyro for a second at power-on and subtract it
  };
}

/** mulberry32: a small, fast, seedable PRNG returning [0, 1). */
export function seededRandom(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianNoise(std, rand) {
  if (std <= 0) return 0;
  // Box-Muller
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function createController(initialGains = defaultGains(), initialRealism = defaultRealism()) {
  let gains = initialGains;
  let realism = initialRealism;
  let angleIntegral = 0;
  let velocityIntegral = 0;
  let yawIntegral = 0;
  const delayBuffer = [];
  let rand = seededRandom(realism.noiseSeed);

  function reset() {
    angleIntegral = 0;
    velocityIntegral = 0;
    yawIntegral = 0;
    delayBuffer.length = 0;
    rand = seededRandom(realism.noiseSeed);
  }

  /**
   * One control-loop tick.
   * @param {{theta:number, thetaDot:number, xDot:number, psiDot:number}} sensed pitch and pitch rate
   *   (true values; the noise is added here), speed and turn rate (from the wheel encoders, see simloop.mjs)
   * @param {number} desiredVelocity m/s
   * @param {number} desiredYawRate rad/s
   * @param {number} dt control-loop period (s)
   * @param {number} motorMaxTorque N*m, per wheel saturation limit (the most torque the firmware can ask for)
   */
  function update(sensed, desiredVelocity, desiredYawRate, dt, motorMaxTorque) {
    // with an IMU estimator the noise is already in the readings (imu.mjs); these knobs are the
    // v1.2 "true angle plus noise" sensor model
    const trueAngleMode = (realism.estimator || 'truth') === 'truth';
    const noisyTheta = sensed.theta + (trueAngleMode ? gaussianNoise(realism.sensorNoiseStdTheta, rand) : 0);
    const noisyRate = sensed.thetaDot + (trueAngleMode ? gaussianNoise(realism.sensorNoiseStdRate, rand) : 0);

    delayBuffer.push({ theta: noisyTheta, thetaDot: noisyRate, xDot: sensed.xDot, psiDot: sensed.psiDot });
    const delaySamples = Math.max(0, Math.round(realism.sensorDelaySteps));
    const measured = delayBuffer.length > delaySamples ? delayBuffer.shift() : delayBuffer[0];

    const velocityError = desiredVelocity - measured.xDot;
    velocityIntegral = clamp(velocityIntegral + velocityError * dt, -gains.integralClamp, gains.integralClamp);
    const angleRef = clamp(
      gains.velocityKp * velocityError + gains.velocityKi * velocityIntegral,
      -gains.maxTiltRef,
      gains.maxTiltRef
    );

    // Positive when the body is tipped (or tipping) beyond the target lean;
    // the restoring torque that drives the wheels out from under a forward
    // tip must itself be positive (verified empirically against
    // dynamics.mjs -- see docs/dynamics.md "sign convention" note), so this
    // is deliberately +Kp/+Kd, not the -error a naive PID template would use.
    const angleError = measured.theta - angleRef;
    angleIntegral = clamp(angleIntegral + angleError * dt, -gains.integralClamp, gains.integralClamp);
    const tauCommon =
      gains.angleKp * angleError + gains.angleKd * measured.thetaDot + gains.angleKi * angleIntegral;

    const yawRateError = desiredYawRate - measured.psiDot;
    yawIntegral = clamp(yawIntegral + yawRateError * dt, -gains.integralClamp, gains.integralClamp);
    const tauDiff = gains.yawKp * yawRateError + (gains.yawKi || 0) * yawIntegral;

    let tauL = (tauCommon - tauDiff) / 2;
    let tauR = (tauCommon + tauDiff) / 2;
    tauL = clamp(tauL, -motorMaxTorque, motorMaxTorque);
    tauR = clamp(tauR, -motorMaxTorque, motorMaxTorque);

    return { tauL, tauR, debug: { angleRef, angleError, tauCommon, tauDiff, measured } };
  }

  return {
    update,
    reset,
    getGains: () => gains,
    setGains: (g) => { gains = g; },
    getRealism: () => realism,
    setRealism: (r) => { const reseed = r.noiseSeed !== realism.noiseSeed; realism = r; if (reseed) rand = seededRandom(r.noiseSeed); },
  };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
