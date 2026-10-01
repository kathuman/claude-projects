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
  };
}

function gaussianNoise(std) {
  if (std <= 0) return 0;
  // Box-Muller
  const u1 = Math.max(Math.random(), 1e-12);
  const u2 = Math.random();
  return std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function createController(initialGains = defaultGains(), initialRealism = defaultRealism()) {
  let gains = initialGains;
  let realism = initialRealism;
  let angleIntegral = 0;
  let velocityIntegral = 0;
  const delayBuffer = [];

  function reset() {
    angleIntegral = 0;
    velocityIntegral = 0;
    delayBuffer.length = 0;
  }

  /**
   * One control-loop tick.
   * @param {{theta:number, thetaDot:number, xDot:number, psiDot:number}} trueState
   * @param {number} desiredVelocity m/s
   * @param {number} desiredYawRate rad/s
   * @param {number} dt control-loop period (s)
   * @param {number} motorMaxTorque N*m, per wheel saturation limit
   */
  function update(trueState, desiredVelocity, desiredYawRate, dt, motorMaxTorque) {
    const noisyTheta = trueState.theta + gaussianNoise(realism.sensorNoiseStdTheta);
    const noisyRate = trueState.thetaDot + gaussianNoise(realism.sensorNoiseStdRate);

    delayBuffer.push({ theta: noisyTheta, thetaDot: noisyRate, xDot: trueState.xDot, psiDot: trueState.psiDot });
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
    const tauDiff = gains.yawKp * yawRateError;

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
    setRealism: (r) => { realism = r; },
  };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
