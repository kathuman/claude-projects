// Rigid-body dynamics for a two-wheeled, single-axis balancing robot.
//
// Derivation (Lagrangian mechanics, planar pitch/drive subsystem):
//
// Generalized coordinates: x (wheel-axle translation along heading),
// theta (body pitch from vertical, positive = tipped toward +x).
// The two wheels are lumped (2*wheelMass, 2*wheelInertia) since the
// pitch/drive subsystem only sees their *common* rotation; the speed
// *difference* between wheels drives yaw separately (decoupled below).
//
// Wheel-axle position:   (x, R)
// Body CoM position:     (x + L sin(theta), R + L cos(theta))
//   where R = wheelRadius, L = comHeight (axle-to-body-CoM distance)
//
// Kinetic energy:
//   T = 1/2 (2*Mw + 2*Iw/R^2 + Mb) xdot^2
//       + Mb*L*cos(theta)*xdot*thetadot
//       + 1/2 (Mb*L^2 + Ib) thetadot^2
// Potential energy (dropping constant terms):
//   V = Mb*g*L*cos(theta)
//
// Euler-Lagrange on (x, theta) gives the coupled system solved in
// computeCoreDerivatives() below. tau = tauL + tauR is the combined
// wheel torque (reacts equally and oppositely on the body); the
// cross terms in xdot*thetadot cancel exactly, which is itself a
// useful correctness check on the derivation.
//
// Yaw is modeled as a decoupled rotation driven by the torque
// *difference*, via the standard differential-drive approximation:
//   Iyaw * psiddot = (trackWidth / (2R)) * (tauR - tauL) - yawDamping * psidot
//
// This two-wheeled model is standard in the balancing-robot literature
// (e.g. Segway-style robots, nBot, Balboa-class hobby platforms) and is
// accurate as long as pitch and yaw rates stay modest -- full 3D coupling
// (gyroscopic cross-terms between tilt and turn) is a known simplification,
// documented in docs/dynamics.md.

/** @typedef {{theta:number, thetaDot:number, x:number, xDot:number, psi:number, psiDot:number, posX:number, posZ:number, tauLAct:number, tauRAct:number}} State */

export const STATE_KEYS = [
  'theta', 'thetaDot', 'x', 'xDot', 'psi', 'psiDot', 'posX', 'posZ', 'tauLAct', 'tauRAct'
];

/** A robot at rest, upright, at the origin. */
export function restState() {
  return { theta: 0, thetaDot: 0, x: 0, xDot: 0, psi: 0, psiDot: 0, posX: 0, posZ: 0, tauLAct: 0, tauRAct: 0 };
}

function computeCoreDerivatives(state, tauLCmd, tauRCmd, params) {
  const { wheelRadius: R, comHeight: L, trackWidth } = params.geometry;
  const Mw = params.mass.wheelMass;
  const Mb = params.mass.bodyMass;
  const Iw = params.inertia.wheelInertia;
  const Ib = params.inertia.bodyPitchInertia;
  const Iyaw = params.inertia.yawInertia;
  const g = params.environment.gravity;
  const bx = params.environment.rollingResistance;
  const bTheta = params.environment.pitchDamping;
  const bPsi = params.environment.yawDamping;

  const { theta, thetaDot, xDot, psiDot, tauLAct, tauRAct } = state;
  const tau = tauLAct + tauRAct;
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);

  // [A   Bc] [xDdot    ]   [rhs1]
  // [Bc  Bb] [thetaDdot] = [rhs2]
  const A = 2 * Mw + (2 * Iw) / (R * R) + Mb;
  const Bc = Mb * L * cosT;
  const Bb = Mb * L * L + Ib;

  const rhs1 = tau / R - bx * xDot + Mb * L * sinT * thetaDot * thetaDot;
  const rhs2 = Mb * g * L * sinT - tau - bTheta * thetaDot;

  const det = A * Bb - Bc * Bc;
  const xDdot = (rhs1 * Bb - Bc * rhs2) / det;
  const thetaDdot = (A * rhs2 - Bc * rhs1) / det;

  const tauDiff = tauRAct - tauLAct;
  const psiDdot = ((trackWidth / (2 * R)) * tauDiff - bPsi * psiDot) / Iyaw;

  return { xDdot, thetaDdot, psiDdot };
}

/**
 * Full-state derivative, including kinematic pose integration (posX/posZ
 * track world-frame position so the renderer doesn't need to redo the
 * heading integral) and first-order motor-lag states.
 */
function derivative(state, tauLCmd, tauRCmd, params) {
  const core = computeCoreDerivatives(state, tauLCmd, tauRCmd, params);
  const tc = Math.max(params.motor.timeConstant, 1e-4);
  return {
    theta: state.thetaDot,
    thetaDot: core.thetaDdot,
    x: state.xDot,
    xDot: core.xDdot,
    psi: state.psiDot,
    psiDot: core.psiDdot,
    posX: state.xDot * Math.cos(state.psi),
    posZ: state.xDot * Math.sin(state.psi),
    tauLAct: (tauLCmd - state.tauLAct) / tc,
    tauRAct: (tauRCmd - state.tauRAct) / tc,
  };
}

function addScaled(state, k, h) {
  const out = {};
  for (const key of STATE_KEYS) out[key] = state[key] + h * k[key];
  return out;
}

/**
 * Advance the simulation by dt using classic 4th-order Runge-Kutta.
 * tauLCmd/tauRCmd (the controller's commanded, already-saturated
 * per-wheel torques) are held constant for the duration of this step
 * (zero-order hold) -- motor lag toward that command is itself part
 * of the integrated state.
 */
export function rk4Step(state, tauLCmd, tauRCmd, params, dt) {
  const k1 = derivative(state, tauLCmd, tauRCmd, params);
  const s2 = addScaled(state, k1, dt / 2);
  const k2 = derivative(s2, tauLCmd, tauRCmd, params);
  const s3 = addScaled(state, k2, dt / 2);
  const k3 = derivative(s3, tauLCmd, tauRCmd, params);
  const s4 = addScaled(state, k3, dt);
  const k4 = derivative(s4, tauLCmd, tauRCmd, params);

  const out = {};
  for (const key of STATE_KEYS) {
    out[key] = state[key] + (dt / 6) * (k1[key] + 2 * k2[key] + 2 * k3[key] + k4[key]);
  }
  return out;
}

/** Total mechanical energy (kinetic + potential) of the pitch/drive subsystem. Used to validate the derivation: with zero damping and zero torque this must be conserved. */
export function mechanicalEnergy(state, params) {
  const { wheelRadius: R, comHeight: L } = params.geometry;
  const Mw = params.mass.wheelMass;
  const Mb = params.mass.bodyMass;
  const Iw = params.inertia.wheelInertia;
  const Ib = params.inertia.bodyPitchInertia;
  const g = params.environment.gravity;
  const { theta, thetaDot, xDot } = state;

  const T =
    0.5 * (2 * Mw + (2 * Iw) / (R * R) + Mb) * xDot * xDot +
    Mb * L * Math.cos(theta) * xDot * thetaDot +
    0.5 * (Mb * L * L + Ib) * thetaDot * thetaDot;
  const V = Mb * g * L * Math.cos(theta);
  return T + V;
}
