// Rigid-body dynamics for a two-wheeled, single-axis balancing robot.
//
// v1.2 plant (see docs/dynamics.md for the full derivation):
//
// Generalized coordinates
//   x      axle travel along the heading          theta  body pitch from vertical (+ = tipped toward +x)
//   psi    heading (yaw)                          phiL/phiR  absolute wheel spin angles
// plus, per wheel, the drivetrain: rotor speed omegaM (output-side, relative to the body) and the
// gearbox lash coordinate delta (motor output angle minus wheel angle, both relative to the body).
//
// Pitch/drive (Lagrangian, wheels' spin now a separate degree of freedom):
//   T = 1/2 (2Mw + Mb) xdot^2 + Mb L cos(theta) xdot thetadot + 1/2 (Mb L^2 + Ib) thetadot^2
//       + 1/2 Iw (omegaL^2 + omegaR^2)
//   V = Mb g L cos(theta)
//   [A  Bc][xddot    ]   [F_L + F_R - bx xdot + Mb L sin(theta) thetadot^2 + Qc_x               ]
//   [Bc Bb][thetaddot] = [Mb g L sin(theta) - (tauBodyL + tauBodyR) - btheta thetadot + Qc_theta]
//   Iw omegadot_i = tauWheel_i - R F_i
//   A = 2Mw + Mb, Bc = Mb L cos(theta), Bb = Mb L^2 + Ib
//
// Tyre/ground: F_i = mu N_i tanh(slip_i / vSlip), slip_i = R omega_i - v_i, v_{L,R} = xdot -/+ (W/2) psidot.
// With good grip this is rolling without slipping (a few mm/s of creep); push the torque past mu N R
// and the wheel spins. N_i = half the weight (less what the body carries if it is lying on the floor,
// less the centripetal unloading Mb L cos(theta) thetadot^2); wheels never leave the ground.
//
// Yaw: Iyaw psiddot = (W/2)(F_R - F_L) - bpsi psidot. Iyaw is the frame's yaw inertia (body + wheels'
// transverse + parallel-axis); the wheels' spin inertia now enters through omega_i, which fixes the
// v1.0 approximation that left it out.
//
// Floor contact: the body's four outline corners (bottom at the axle, top at bodyHeight, front/back
// at +-bodyDepth/2) push back with a stiff, damped spring and slide with Coulomb friction when they
// reach the floor -- so a fallen robot lands and lies there instead of swinging through the ground.
//
// Actuators (params.motor.model):
//   'ideal' -- the v1.0 model: input = torque command, first-order lag, applied wheel/body equally.
//   'dc'    -- a brushed DC gearmotor from datasheet numbers (output side): input = PWM duty in
//              [-1, 1] at battery voltage Vb; i = (d Vb - ke omegaM) / Ra (clipped to the driver's
//              current limit), tauEm = kt i, internal friction from the free-run current, rotor
//              inertia reflected through the gearbox, and gear lash: torque passes to the wheel only
//              once the lash is taken up (stiff, damped mesh). The body feels the stator reaction,
//              -(tauEm - friction). Inductance is neglected (electrical time constant ~1 ms).

/** @typedef {Record<string, number>} State */

export const STATE_KEYS = [
  'theta', 'thetaDot', 'x', 'xDot', 'psi', 'psiDot', 'posX', 'posZ',
  'phiL', 'phiR', 'omegaL', 'omegaR',
  'omegaML', 'omegaMR', 'deltaL', 'deltaR',
  'tauLAct', 'tauRAct',
];

/** A robot at rest, upright, at the origin. */
export function restState() {
  const s = {};
  for (const k of STATE_KEYS) s[k] = 0;
  return s;
}

// ---------------------------------------------------------------- motor model (pure, tested)

/**
 * Output-side motor constants from datasheet numbers (all measured at the gearbox output, at vNom):
 * stall torque (N*m), stall current (A), free-run speed (rad/s), free-run current (A).
 */
export function motorConstants(m) {
  const Ra = m.vNom / m.stallCurrent;
  const kt = m.stallTorque / m.stallCurrent;
  const ke = (m.vNom - m.freeCurrent * Ra) / m.freeSpeed;
  const tauFric = kt * m.freeCurrent;
  return { Ra, kt, ke, tauFric };
}

/** Electromagnetic torque (output side, before internal friction) at duty d, battery Vb, rotor speed w. */
export function motorTorque(m, duty, Vb, w) {
  const c = motorConstants(m);
  let i = (duty * Vb - c.ke * w) / c.Ra;
  const lim = m.currentLimit > 0 ? m.currentLimit : Infinity;
  if (i > lim) i = lim; else if (i < -lim) i = -lim;
  return { tau: c.kt * i, current: i };
}

/** Steady-state torque-speed curve point (after friction): what a dynamometer would read. */
export function motorSteadyTorque(m, duty, Vb, w) {
  const c = motorConstants(m);
  return motorTorque(m, duty, Vb, w).tau - c.tauFric * Math.sign(w || duty);
}

// ---------------------------------------------------------------- helpers

function deadzone(v, half) {
  if (v > half) return v - half;
  if (v < -half) return v + half;
  return 0;
}

/** Normal force carried by both wheels together (N), given body-contact load fcy. */
function wheelLoad(params, theta, thetaDot, fcy) {
  const Mw = params.mass.wheelMass, Mb = params.mass.bodyMass, L = params.geometry.comHeight;
  const g = params.environment.gravity;
  return Math.max(0, (2 * Mw + Mb) * g - Mb * L * Math.cos(theta) * thetaDot * thetaDot - fcy);
}

/** Effective pitch inertia seen at the body's top corner -- sets the contact spring. */
function contactConstants(params) {
  const Mb = params.mass.bodyMass, L = params.geometry.comHeight, H = Math.max(params.geometry.bodyHeight, 0.02);
  const mEff = (Mb * L * L + params.inertia.bodyPitchInertia) / (H * H) + Mb * 0.1;
  const w = params.environment.contactHz * 2 * Math.PI;
  const k = mEff * w * w;
  const c = 2 * 0.8 * Math.sqrt(k * mEff);
  return { k, c, mEff };
}

/** Gear-mesh spring/damper for the 'dc' model. */
function gearConstants(params) {
  const Jr = params.motor.rotorInertia, Iw = params.inertia.wheelInertia;
  const Jmin = Math.min(Jr, Iw);
  const w = params.motor.meshHz * 2 * Math.PI;
  const k = Jmin * w * w;
  const c = 2 * 0.5 * Math.sqrt(k * Jmin);
  return { k, c };
}

/**
 * The largest stable explicit step for these parameters (RK4): the stiffest parts are the tyre's
 * grip (a friction "spring" of slope mu N / vSlip), the gear mesh and the floor contact.
 */
export function stableStep(params) {
  const R = params.geometry.wheelRadius, Iw = params.inertia.wheelInertia;
  const A = 2 * params.mass.wheelMass + params.mass.bodyMass;
  const N = wheelLoad(params, 0, 0, 0) / 2;
  const cSlip = (params.environment.groundFriction * N) / params.environment.slipVelocity;
  const lamSlip = cSlip * (R * R / Iw + 1 / A);
  const lamContact = params.environment.contactHz * 2 * Math.PI * 1.6;
  let lam = Math.max(lamSlip, lamContact);
  if (params.motor.model === 'dc') {
    const gc = gearConstants(params), c = motorConstants(params.motor);
    const Jr = params.motor.rotorInertia, Jmin = Math.min(Jr, Iw);
    lam = Math.max(lam, Math.sqrt(gc.k / Jmin) * 1.2, c.kt * c.ke / c.Ra / Jr);
  }
  return Math.min(1 / 2000, 2.0 / lam);
}

// ---------------------------------------------------------------- derivative

/**
 * @param {State} s state
 * @param {number} uL, uR inputs: torque commands ('ideal') or PWM duties ('dc')
 */
function derivative(s, uL, uR, params, cache) {
  const { wheelRadius: R, comHeight: L, trackWidth: W, bodyHeight: H, bodyDepth: D } = params.geometry;
  const Mw = params.mass.wheelMass, Mb = params.mass.bodyMass;
  const Iw = params.inertia.wheelInertia, Ib = params.inertia.bodyPitchInertia, Iyaw = params.inertia.yawInertia;
  const env = params.environment, g = env.gravity;
  const { theta, thetaDot, xDot, psiDot } = s;
  const sinT = Math.sin(theta), cosT = Math.cos(theta);

  // --- floor contact on the body's outline corners
  let Qcx = 0, Qct = 0, Fcy = 0;
  const cc = cache.contact;
  for (const h of [0, H]) {
    for (const sg of [-1, 1]) {
      const y = R + h * cosT - sg * (D / 2) * sinT;
      if (y >= 0) continue;
      const dxdT = h * cosT - sg * (D / 2) * sinT;      // d(corner x)/d theta
      const dydT = -h * sinT - sg * (D / 2) * cosT;     // d(corner y)/d theta
      const vy = dydT * thetaDot, vx = xDot + dxdT * thetaDot;
      const fy = Math.max(0, cc.k * -y - cc.c * vy);
      const fx = -env.bodyFriction * fy * Math.tanh(vx / env.slipVelocity);
      Fcy += fy;
      Qcx += fx;
      Qct += fx * dxdT + fy * dydT;
    }
  }

  // --- actuators: torque on each wheel, reaction on the body
  const m = params.motor;
  let tauWL, tauWR, tauBL, tauBR, dOmML = 0, dOmMR = 0, dDelL = 0, dDelR = 0, dTauL = 0, dTauR = 0;
  const wRelL = s.omegaL - thetaDot, wRelR = s.omegaR - thetaDot;
  if (m.model === 'dc') {
    const mc = cache.motor, gc = cache.gear, Jr = m.rotorInertia, half = m.backlash / 2;
    const Vb = m.batteryVoltage;
    const side = (duty, wM, delta, wRel) => {
      const em = motorTorque(m, Math.max(-1, Math.min(1, duty)), Vb, wM).tau;
      const fr = mc.tauFric * Math.tanh(wM / 0.5);
      const engaged = Math.abs(delta) > half;
      const tg = gc.k * deadzone(delta, half) + (engaged ? gc.c * (wM - wRel) : 0);
      return { tg, tb: em - fr, dw: (em - fr - tg) / Jr, dd: wM - wRel };
    };
    const a = side(uL, s.omegaML, s.deltaL, wRelL), b = side(uR, s.omegaMR, s.deltaR, wRelR);
    tauWL = a.tg; tauWR = b.tg; tauBL = a.tb; tauBR = b.tb;
    dOmML = a.dw; dOmMR = b.dw; dDelL = a.dd; dDelR = b.dd;
  } else {
    const tc = Math.max(m.timeConstant, 1e-4);
    tauWL = tauBL = s.tauLAct; tauWR = tauBR = s.tauRAct;
    dTauL = (uL - s.tauLAct) / tc; dTauR = (uR - s.tauRAct) / tc;
  }

  // --- tyres
  const N = wheelLoad(params, theta, thetaDot, Fcy) / 2;
  const vL = xDot - (W / 2) * psiDot, vR = xDot + (W / 2) * psiDot;
  const FL = env.groundFriction * N * Math.tanh((R * s.omegaL - vL) / env.slipVelocity);
  const FR = env.groundFriction * N * Math.tanh((R * s.omegaR - vR) / env.slipVelocity);

  // --- pitch / drive
  const A = 2 * Mw + Mb, Bc = Mb * L * cosT, Bb = Mb * L * L + Ib;
  const rhs1 = FL + FR - env.rollingResistance * xDot + Mb * L * sinT * thetaDot * thetaDot + Qcx;
  const rhs2 = Mb * g * L * sinT - (tauBL + tauBR) - env.pitchDamping * thetaDot + Qct;
  const det = A * Bb - Bc * Bc;
  const xDdot = (rhs1 * Bb - Bc * rhs2) / det;
  const thetaDdot = (A * rhs2 - Bc * rhs1) / det;

  const psiDdot = ((W / 2) * (FR - FL) - env.yawDamping * psiDot) / Iyaw;

  if (cache.out) Object.assign(cache.out, { FL, FR, N, Fcy, tauWL, tauWR, tauBL, tauBR });
  return {
    theta: thetaDot, thetaDot: thetaDdot,
    x: xDot, xDot: xDdot,
    psi: psiDot, psiDot: psiDdot,
    posX: xDot * Math.cos(s.psi), posZ: xDot * Math.sin(s.psi),
    phiL: s.omegaL, phiR: s.omegaR,
    omegaL: (tauWL - R * FL) / Iw, omegaR: (tauWR - R * FR) / Iw,
    omegaML: dOmML, omegaMR: dOmMR, deltaL: dDelL, deltaR: dDelR,
    tauLAct: dTauL, tauRAct: dTauR,
  };
}

function makeCache(params) {
  return {
    contact: contactConstants(params),
    motor: params.motor.model === 'dc' ? motorConstants(params.motor) : null,
    gear: params.motor.model === 'dc' ? gearConstants(params) : null,
  };
}

function addScaled(state, k, h) {
  const out = {};
  for (const key of STATE_KEYS) out[key] = state[key] + h * k[key];
  return out;
}

/**
 * Advance by dt with classic 4th-order Runge-Kutta. uL/uR (torque commands or PWM duties, see
 * above) are held constant over the step (zero-order hold).
 */
export function rk4Step(state, uL, uR, params, dt, cache = makeCache(params)) {
  const k1 = derivative(state, uL, uR, params, cache);
  const k2 = derivative(addScaled(state, k1, dt / 2), uL, uR, params, cache);
  const k3 = derivative(addScaled(state, k2, dt / 2), uL, uR, params, cache);
  const k4 = derivative(addScaled(state, k3, dt), uL, uR, params, cache);
  const out = {};
  for (const key of STATE_KEYS) {
    out[key] = state[key] + (dt / 6) * (k1[key] + 2 * k2[key] + 2 * k3[key] + k4[key]);
  }
  return out;
}

/** Integrate over `duration` in as many stable substeps as the parameters need. */
export function integrate(state, uL, uR, params, duration) {
  const cache = makeCache(params);
  const n = Math.max(1, Math.ceil(duration / stableStep(params) - 1e-9));
  const h = duration / n;
  let s = state;
  for (let i = 0; i < n; i++) s = rk4Step(s, uL, uR, params, h, cache);
  return s;
}

/** Forces and torques at a state (for telemetry): tyre forces, wheel load, motor torques, body contact. */
export function forcesAt(state, uL, uR, params) {
  const cache = makeCache(params);
  cache.out = {};
  derivative(state, uL, uR, params, cache);
  return cache.out;
}

/** Total mechanical energy: pitch/drive + wheel spin + yaw + rotors. With no damping, friction or input it is conserved. */
export function mechanicalEnergy(state, params) {
  const { comHeight: L } = params.geometry;
  const Mw = params.mass.wheelMass, Mb = params.mass.bodyMass;
  const Iw = params.inertia.wheelInertia, Ib = params.inertia.bodyPitchInertia;
  const g = params.environment.gravity;
  const { theta, thetaDot, xDot } = state;
  const T =
    0.5 * (2 * Mw + Mb) * xDot * xDot +
    Mb * L * Math.cos(theta) * xDot * thetaDot +
    0.5 * (Mb * L * L + Ib) * thetaDot * thetaDot +
    0.5 * Iw * (state.omegaL * state.omegaL + state.omegaR * state.omegaR) +
    0.5 * params.inertia.yawInertia * state.psiDot * state.psiDot;
  return T + Mb * g * L * Math.cos(theta);
}

/** A state rolling without slip: wheel spins and rotors consistent with xDot / psiDot. */
export function consistentState(partial) {
  return { ...restState(), ...partial };
}
