import test from 'node:test';
import assert from 'node:assert/strict';

import { rk4Step, restState, mechanicalEnergy, integrate } from '../web/js/dynamics.mjs';
import { defaultParams, mergeParams } from '../web/js/params.mjs';
import { createController, defaultGains, defaultRealism } from '../web/js/controller.mjs';
import { createSimLoop } from '../web/js/simloop.mjs';

const ideal = (extra = {}) => mergeParams(defaultParams(), { motor: { model: 'ideal' }, ...extra });

function frictionlessUndamped() {
  // contactHz 0 switches the body-floor contact off (the robot falls through the floor, as in v1.0)
  return ideal({ environment: { rollingResistance: 0, pitchDamping: 0, yawDamping: 0, groundFriction: 0, contactHz: 0 } });
}

test('mechanical energy is conserved with no damping, no friction and no torque', () => {
  const params = frictionlessUndamped();
  let state = { ...restState(), theta: 0.3, xDot: 0.2, omegaL: 4, omegaR: -3, psiDot: 0.5 };
  const e0 = mechanicalEnergy(state, params);
  for (let i = 0; i < 5000; i++) state = rk4Step(state, 0, 0, params, 1e-3);
  const relDrift = Math.abs(mechanicalEnergy(state, params) - e0) / Math.abs(e0);
  assert.ok(relDrift < 1e-4, `energy drifted by ${relDrift}`);
});

test('the upright equilibrium is a fixed point with zero input (both motor models)', () => {
  for (const model of ['ideal', 'dc']) {
    const params = mergeParams(defaultParams(), { motor: { model } });
    const state = integrate(restState(), 0, 0, params, 2);
    assert.ok(Math.abs(state.theta) < 1e-12, `${model}: theta drifted to ${state.theta}`);
    assert.ok(Math.abs(state.xDot) < 1e-12, `${model}: xDot drifted to ${state.xDot}`);
  }
});

test('a torque-free tilt falls over (upright is unstable, as a real inverted pendulum must be)', () => {
  const state = integrate({ ...restState(), theta: 0.05 }, 0, 0, ideal(), 2);
  assert.ok(Math.abs(state.theta) > 0.05, `expected the tilt to grow without control, got theta=${state.theta}`);
});

// The v1.0 plant: rolling without slip, wheel spin inertia folded into the translational mass.
function v1Step(s, tau, p, dt) {
  const R = p.geometry.wheelRadius, L = p.geometry.comHeight, Mw = p.mass.wheelMass, Mb = p.mass.bodyMass;
  const Iw = p.inertia.wheelInertia, Ib = p.inertia.bodyPitchInertia, g = p.environment.gravity;
  const f = (q) => {
    const A = 2 * Mw + (2 * Iw) / (R * R) + Mb, Bc = Mb * L * Math.cos(q.th), Bb = Mb * L * L + Ib;
    const r1 = tau / R - p.environment.rollingResistance * q.v + Mb * L * Math.sin(q.th) * q.w * q.w;
    const r2 = Mb * g * L * Math.sin(q.th) - tau - p.environment.pitchDamping * q.w;
    const det = A * Bb - Bc * Bc;
    return { th: q.w, w: (A * r2 - Bc * r1) / det, x: q.v, v: (r1 * Bb - Bc * r2) / det };
  };
  const add = (a, k, h) => ({ th: a.th + h * k.th, w: a.w + h * k.w, x: a.x + h * k.x, v: a.v + h * k.v });
  const k1 = f(s), k2 = f(add(s, k1, dt / 2)), k3 = f(add(s, k2, dt / 2)), k4 = f(add(s, k3, dt));
  return { th: s.th + dt / 6 * (k1.th + 2 * k2.th + 2 * k3.th + k4.th), w: s.w + dt / 6 * (k1.w + 2 * k2.w + 2 * k3.w + k4.w),
    x: s.x + dt / 6 * (k1.x + 2 * k2.x + 2 * k3.x + k4.x), v: s.v + dt / 6 * (k1.v + 2 * k2.v + 2 * k3.v + k4.v) };
}

test('with good grip the new plant reproduces the v1.0 rolling-without-slip model', () => {
  // ideal motors with negligible lag, so both models see the same constant torque
  const params = ideal({ motor: { model: 'ideal', timeConstant: 1e-4 }, environment: { groundFriction: 2, slipVelocity: 0.002, contactHz: 0 } });
  const tau = 0.05; // per wheel
  let s = { ...restState(), theta: 0.05, tauLAct: tau, tauRAct: tau };
  let r = { th: 0.05, w: 0, x: 0, v: 0 };
  for (let i = 0; i < 300; i++) {
    s = integrate(s, tau, tau, params, 1e-3);
    r = v1Step(r, 2 * tau, params, 1e-3);
  }
  assert.ok(Math.abs(s.theta - r.th) < 2e-3, `theta: ${s.theta} vs v1.0 ${r.th}`);
  assert.ok(Math.abs(s.x - r.x) < 2e-3, `x: ${s.x} vs v1.0 ${r.x}`);
  const slip = params.geometry.wheelRadius * s.omegaL - s.xDot;
  assert.ok(Math.abs(slip) < 5e-3, `wheel should roll, not slip: slip ${slip} m/s`);
});

function closedLoop(model, setup) {
  const params = mergeParams(defaultParams(), { motor: { model } });
  const controller = createController(defaultGains(), defaultRealism());
  const loop = createSimLoop(params, controller);
  setup(loop);
  return { loop, hz: defaultRealism().controlLoopHz };
}

test('the closed-loop controller recovers from a small initial tilt (both motor models)', () => {
  for (const model of ['ideal', 'dc']) {
    const { loop, hz } = closedLoop(model, (l) => { l.setState({ theta: 0.1 }); l.setCommand(0, 0); });
    let maxAbsTheta = 0;
    for (let i = 0; i < hz * 6; i++) { loop.advance(); maxAbsTheta = Math.max(maxAbsTheta, Math.abs(loop.getState().theta)); }
    const s = loop.getState();
    assert.ok(maxAbsTheta < 0.5, `${model}: fell during recovery, max |theta| = ${maxAbsTheta}`);
    assert.ok(Math.abs(s.theta) < 0.01, `${model}: did not settle upright, theta=${s.theta}`);
    assert.ok(Math.abs(s.thetaDot) < 0.05, `${model}: did not settle still, thetaDot=${s.thetaDot}`);
  }
});

test('the velocity loop tracks a commanded forward speed without falling (DC motors, encoder speed)', () => {
  const { loop, hz } = closedLoop('dc', (l) => l.setCommand(0.3, 0));
  let maxAbsTheta = 0;
  for (let i = 0; i < hz * 8; i++) { loop.advance(); maxAbsTheta = Math.max(maxAbsTheta, Math.abs(loop.getState().theta)); }
  assert.ok(maxAbsTheta < 0.4, `tilted too far while accelerating, max |theta| = ${maxAbsTheta}`);
  assert.ok(Math.abs(loop.getState().xDot - 0.3) < 0.05, `did not reach commanded speed, xDot=${loop.getState().xDot}`);
});

test('the yaw loop tracks a commanded turn rate independently of pitch', () => {
  const { loop, hz } = closedLoop('dc', (l) => l.setCommand(0, 0.5));
  for (let i = 0; i < hz * 4; i++) loop.advance();
  const s = loop.getState();
  assert.ok(Math.abs(s.psiDot - 0.5) < 0.05, `did not reach commanded yaw rate, psiDot=${s.psiDot}`);
  assert.ok(Math.abs(s.theta) < 0.1, `pure yaw command disturbed pitch too much, theta=${s.theta}`);
});

test('a slower control loop degrades (but a fast one preserves) balance quality', () => {
  function recoveryScore(controlHz) {
    const { loop } = closedLoop('dc', (l) => l.setState({ theta: 0.15 }));
    let maxAbsTheta = 0;
    for (let i = 0; i < controlHz * 3; i++) {
      loop.advance(controlHz);
      maxAbsTheta = Math.max(maxAbsTheta, Math.abs(loop.getState().theta));
    }
    return maxAbsTheta;
  }
  const fast = recoveryScore(defaultRealism().controlLoopHz), slow = recoveryScore(60);
  assert.ok(slow > fast, `expected a slow control loop to overshoot more (slow=${slow}, default=${fast})`);
});

test('parameter changes reach the physics (v1.0 kept stale parameters after a slider edit)', () => {
  const controller = createController(defaultGains(), defaultRealism());
  const loop = createSimLoop(defaultParams(), controller);
  loop.setState({ theta: 0.05 });
  loop.setParams(mergeParams(defaultParams(), { environment: { gravity: 1.62 } })); // the Moon
  assert.equal(loop.getParams().environment.gravity, 1.62);
  // with zero input the Moon robot falls much more slowly than the Earth one
  const moon = integrate({ ...restState(), theta: 0.05 }, 0, 0, loop.getParams(), 0.5);
  const earth = integrate({ ...restState(), theta: 0.05 }, 0, 0, defaultParams(), 0.5);
  assert.ok(Math.abs(moon.theta) < Math.abs(earth.theta));
});
