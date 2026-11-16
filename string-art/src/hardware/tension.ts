// How hard the thread is pulled while the machine winds, what limits that pull, and how thin the thread may be.
// Every step is a plain formula on the parameters (params.json "tension"), so the build page can show the working and
// the machine page can check a piece. The friction coefficients, steel strength and thread strengths are typical
// values, not measurements: measure the real tension once the machine runs: at 0.25 N the thread just lifts 25 g.
//
//   1  thread leaving the guide tube:  T_exit = (T_brake + T_inertia) · K,   K = Π e^(μθ) over the bends (capstan)
//   2  payout:                          v = R·ω,  a = R·α
//   3  spool inertia (spool on a pin):  T_inertia = I·a / r²,  I = ½·m·(r_o² + r_i²); a standing cone: ≈ 0
//   4  felt brake on a turning spool:   T = M / r, so the tension grows r_full / r_core times as the spool empties
//   5  lower limit (sag):               δ = w·L² / (8T)  →  T ≥ w·L² / (8·δ_max)
//   6  upper limit (busiest nail):      F = 2·s·n·T with s = mean sin(Δ/2);  M = F·h;  M ≤ σ_y·π·d³/32 / SF
//   7  thread strength:                 F_break ≥ SF · T_peak / η_knot;  tex = F_break / tenacity;  d = √(4·tex·10⁻⁶ / (π·ρ·φ))

import { PARAMS, type Params } from "./drive";
import { DEFAULT_MACHINE, xSpeedLimit, type MachineConfig } from "../machine/config";

export type Fibre = "polyester" | "nylon" | "cotton";
export const FIBRES: Fibre[] = ["polyester", "nylon", "cotton"];

export interface TensionReport {
  target: number;
  speed: { v: number; a: number };
  path: { id: string; angle: number; mu: number; factor: number }[];
  K: number;
  brake: number;                       // tension the tensioner (or brake) must give, N
  inertia: { pinFull: number; pinEmpty: number; cone: number };
  emptying: number;                    // r_full / r_core: how much a felt brake's tension grows
  peak: { pin: number; cone: number }; // highest tension leaving the guide, N
  pinSteadyEmpty: number;              // steady tension near the end of a spool on a pin, N
  thread: { tex: number; lambda: number; breaking: number };   // the configured thread (as polyester)
  sag: { w: number; L: number; minT: number; at: number };      // at = sag at the target tension, mm
  nail: { s: number; h: number; forcePerT: number; momentPerT: number; n: number };
  nailLimits: { d: number; n: number; soft: number; hard: number }[];
  nailLimit: number;                   // for the configured nail and wraps, cautious steel
  required: { pin: number; cone: number };                      // breaking strength needed, N
  minimum: { fibre: Fibre; pin: { tex: number; d: number }; cone: { tex: number; d: number } }[];
  safetyOfThread: { pin: number; cone: number };               // the configured thread against the peaks
  turntable: { atTarget: number; atPeak: number };            // torque added at the turntable motor, N·m
}

const P = (p: Params) => p.tension;

/** Mean of sin(Δ/2) for a line to a nail Δ away, Δ spread evenly over the allowed range. */
export function meanInward(nails: number, minSkip: number): number {
  const lo = (Math.PI * minSkip) / nails, hi = Math.PI - lo;   // Δ/2 from skip·π/N to π − skip·π/N
  return (Math.cos(lo) - Math.cos(hi)) / (hi - lo);
}

/** Linear density in tex (g/km) and kg/m of a thread of diameter d mm. */
export function texOf(dMm: number, density: number, packing: number): number {
  return Math.PI * (dMm / 2) ** 2 * 1e-6 * density * packing * 1e6;       // kg/m × 1e6 = g/km
}

/** Diameter in mm of a thread of the given tex. */
export function diameterOf(tex: number, density: number, packing: number): number {
  return Math.sqrt((4 * tex * 1e-6) / (Math.PI * density * packing)) * 1000;
}

/** The nail's bending moment at yield, N·mm. */
export const yieldMoment = (dMm: number, sigma: number) => (sigma * Math.PI * dMm ** 3) / 32;

export function tension(m: MachineConfig = DEFAULT_MACHINE, p: Params = PARAMS, n = P(p).busiestWraps, target = m.tensionN): TensionReport {
  const t = P(p), R = m.boardMm / 2000, rad = Math.PI / 180;
  const v = R * xSpeedLimit(m) * rad, a = R * m.xAccel * rad;
  const path = t.path.map((s) => ({ ...s, factor: Math.exp(s.mu * s.angle) }));
  const K = path.reduce((k, s) => k * s.factor, 1);
  const brake = target / K;
  const sp = t.pinSpool;
  const I = (mass: number, ro: number, ri: number) => 0.5 * mass * ((ro / 1000) ** 2 + (ri / 1000) ** 2);
  const pinFull = (I(sp.massFull, sp.rOuter, sp.rCore) * a) / (sp.rOuter / 1000) ** 2;
  const pinEmpty = (I(sp.massEmpty, sp.rOuterEmpty, sp.rCore) * a) / (sp.rOuterEmpty / 1000) ** 2;
  const emptying = sp.rOuter / sp.rCore;
  const pol = t.fibres.polyester;
  const tex = texOf(m.threadMm, pol.density, t.packing), lambda = tex * 1e-6;
  const cone = lambda * a * 1 + lambda * v * v;                 // thread mass and its balloon: negligible
  const peak = {
    pin: (brake * emptying * t.stickSlip + pinFull) * K,
    cone: (brake * (1 + t.coneVariation) * t.stickSlip + cone) * K
  };
  // sag of the longest line, board lying flat
  const w = lambda * 9.81, L = m.boardMm / 1000;
  const minT = (w * L * L) / (8 * t.sagLimitMm / 1000);
  const sagAt = ((w * L * L) / (8 * target)) * 1000;
  // the busiest nail
  const s = meanInward(m.nails, t.minSkip);
  const h = m.zStartMm + (m.layerMm * (n - 1)) / 2 + t.embed;
  const forcePerT = 2 * s * n, momentPerT = forcePerT * h;
  const limit = (d: number, wraps: number, sigma: number) => {
    const hh = m.zStartMm + (m.layerMm * (wraps - 1)) / 2 + t.embed;
    return yieldMoment(d, sigma) / (t.nailSafety * 2 * s * wraps * hh);
  };
  const nailLimits = [1.5, 2.0].flatMap((d) => [12, 25].map((wr) => ({ d, n: wr, soft: limit(d, wr, t.nailYield), hard: limit(d, wr, t.nailYieldHard) })));
  const required = { pin: (t.safety * peak.pin) / t.knotEfficiency, cone: (t.safety * peak.cone) / t.knotEfficiency };
  const minimum = FIBRES.map((f) => {
    const fb = t.fibres[f], one = (F: number) => { const tx = F / fb.tenacity; return { tex: tx, d: diameterOf(tx, fb.density, t.packing) }; };
    return { fibre: f, pin: one(required.pin), cone: one(required.cone) };
  });
  const breaking = tex * pol.tenacity;
  return {
    target, speed: { v, a }, path, K, brake, inertia: { pinFull, pinEmpty, cone }, emptying, peak,
    pinSteadyEmpty: target * emptying,
    thread: { tex, lambda, breaking },
    sag: { w, L, minT, at: sagAt },
    nail: { s, h, forcePerT, momentPerT, n },
    nailLimits, nailLimit: limit(m.nailMm, n, t.nailYield),
    required, minimum,
    safetyOfThread: { pin: (breaking * t.knotEfficiency) / peak.pin, cone: (breaking * t.knotEfficiency) / peak.cone },
    turntable: { atTarget: (target * R) / (p.drive.turntableTeeth / p.drive.motorTeeth), atPeak: (peak.cone * R) / (p.drive.turntableTeeth / p.drive.motorTeeth) }
  };
}

/** The thinnest thread the app allows: what the machine cannot break, rounded up to a practical size. */
export const MIN_THREAD_MM = PARAMS.tension.practicalMinMm;
