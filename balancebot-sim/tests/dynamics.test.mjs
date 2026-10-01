import test from 'node:test';
import assert from 'node:assert/strict';

import { rk4Step, restState, mechanicalEnergy } from '../web/js/dynamics.mjs';
import { defaultParams, mergeParams } from '../web/js/params.mjs';
import { createController, defaultGains, defaultRealism } from '../web/js/controller.mjs';
import { createSimLoop } from '../web/js/simloop.mjs';

function undampedParams() {
  return mergeParams(defaultParams(), {
    environment: { rollingResistance: 0, pitchDamping: 0, yawDamping: 0 },
  });
}

test('mechanical energy is conserved with zero damping and zero torque', () => {
  const params = undampedParams();
  let state = { ...restState(), theta: 0.3, xDot: 0.2 };
  const e0 = mechanicalEnergy(state, params);

  const dt = 1e-3;
  for (let i = 0; i < 5000; i++) {
    state = rk4Step(state, 0, 0, params, dt);
  }
  const e1 = mechanicalEnergy(state, params);

  const relDrift = Math.abs(e1 - e0) / Math.abs(e0);
  assert.ok(relDrift < 1e-4, `energy drifted by ${relDrift} (e0=${e0}, e1=${e1})`);
});

test('the upright equilibrium is a fixed point with zero torque', () => {
  const params = defaultParams();
  let state = restState();
  const dt = 1e-3;
  for (let i = 0; i < 2000; i++) {
    state = rk4Step(state, 0, 0, params, dt);
  }
  assert.ok(Math.abs(state.theta) < 1e-12, `theta drifted to ${state.theta}`);
  assert.ok(Math.abs(state.xDot) < 1e-12, `xDot drifted to ${state.xDot}`);
});

test('a torque-free tilt falls over (upright is unstable, as a real inverted pendulum must be)', () => {
  const params = defaultParams();
  let state = { ...restState(), theta: 0.05 };
  const dt = 1e-3;
  for (let i = 0; i < 2000; i++) {
    state = rk4Step(state, 0, 0, params, dt);
  }
  assert.ok(Math.abs(state.theta) > 0.05, `expected the tilt to grow without control, got theta=${state.theta}`);
});

test('the closed-loop controller recovers from a small initial tilt', () => {
  const params = defaultParams();
  const controller = createController(defaultGains(), defaultRealism());
  const loop = createSimLoop(params, controller, 2000);
  loop.setState({ ...restState(), theta: 0.1 });
  loop.setCommand(0, 0);

  let maxAbsTheta = 0;
  const controlHz = defaultRealism().controlLoopHz;
  const steps = controlHz * 6; // 6 simulated seconds
  for (let i = 0; i < steps; i++) {
    loop.advance();
    maxAbsTheta = Math.max(maxAbsTheta, Math.abs(loop.getState().theta));
  }

  const finalState = loop.getState();
  assert.ok(maxAbsTheta < 0.5, `robot fell over during recovery, max |theta| = ${maxAbsTheta}`);
  assert.ok(Math.abs(finalState.theta) < 0.01, `did not settle upright, theta=${finalState.theta}`);
  assert.ok(Math.abs(finalState.thetaDot) < 0.05, `did not settle still, thetaDot=${finalState.thetaDot}`);
});

test('the velocity loop tracks a commanded forward speed without falling', () => {
  const params = defaultParams();
  const controller = createController(defaultGains(), defaultRealism());
  const loop = createSimLoop(params, controller, 2000);
  loop.setCommand(0.3, 0);

  let maxAbsTheta = 0;
  const controlHz = defaultRealism().controlLoopHz;
  const steps = controlHz * 8;
  for (let i = 0; i < steps; i++) {
    loop.advance();
    maxAbsTheta = Math.max(maxAbsTheta, Math.abs(loop.getState().theta));
  }

  const finalState = loop.getState();
  assert.ok(maxAbsTheta < 0.4, `tilted too far while accelerating, max |theta| = ${maxAbsTheta}`);
  assert.ok(Math.abs(finalState.xDot - 0.3) < 0.05, `did not reach commanded speed, xDot=${finalState.xDot}`);
});

test('the yaw loop tracks a commanded turn rate independently of pitch', () => {
  const params = defaultParams();
  const controller = createController(defaultGains(), defaultRealism());
  const loop = createSimLoop(params, controller, 2000);
  loop.setCommand(0, 0.5);

  const controlHz = defaultRealism().controlLoopHz;
  for (let i = 0; i < controlHz * 4; i++) loop.advance();

  const finalState = loop.getState();
  assert.ok(Math.abs(finalState.psiDot - 0.5) < 0.05, `did not reach commanded yaw rate, psiDot=${finalState.psiDot}`);
  assert.ok(Math.abs(finalState.theta) < 0.1, `pure yaw command disturbed pitch too much, theta=${finalState.theta}`);
});

test('a slower control loop degrades (but a fast one preserves) balance quality', () => {
  function recoveryScore(controlHz) {
    const params = defaultParams();
    const controller = createController(defaultGains(), defaultRealism());
    const loop = createSimLoop(params, controller, 2000);
    loop.setState({ ...restState(), theta: 0.15 });
    let maxAbsTheta = 0;
    for (let i = 0; i < controlHz * 3; i++) {
      loop.advance(controlHz);
      maxAbsTheta = Math.max(maxAbsTheta, Math.abs(loop.getState().theta));
    }
    return maxAbsTheta;
  }

  const defaultLoopPeak = recoveryScore(defaultRealism().controlLoopHz);
  const slowLoopPeak = recoveryScore(60);
  assert.ok(
    slowLoopPeak > defaultLoopPeak,
    `expected a slow control loop to overshoot more than the default rate (slow=${slowLoopPeak}, default=${defaultLoopPeak})`
  );
});
