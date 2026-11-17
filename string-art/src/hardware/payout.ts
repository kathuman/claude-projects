// The thread's payout during one turn of the board, simulated with the machine's own motion profile: how the board's
// speed and the thread's speed and acceleration actually run, for the calculations page's acceleration diagram.
//
// The line runs from the last nail to the guide, Δ apart round the circle, so its length is L = 2R·sin(Δ/2). As the board
// turns, Δ = Δ₀ + θ(t), and
//   dL/dt   = R·cos(Δ/2)·ω
//   d²L/dt² = R·cos(Δ/2)·α − ½·R·sin(Δ/2)·ω²
// For Δ between 0 and 180° both are at most R·ω and R·α: the bounds the tension working uses are safe.

import { moveTime } from "../machine/motion";
import { xSpeedLimit, type MachineConfig } from "../machine/config";

export interface PayoutSample { t: number; theta: number; omega: number; alpha: number; L: number; v: number; a: number }

/** A turn of `turnDeg` degrees starting with the guide `startDeg` from the last nail; `n` samples. */
export function payoutRun(m: MachineConfig, turnDeg = 120, startDeg = 1, n = 241): PayoutSample[] {
  const R = m.boardMm / 2000, vmax = xSpeedLimit(m), amax = m.xAccel, T = moveTime(turnDeg, vmax, amax);
  const rad = Math.PI / 180, out: PayoutSample[] = [];
  // the trapezoid exactly: accelerate at amax, cruise at vmax (if reached), brake at amax
  const tri = turnDeg < (vmax * vmax) / amax, tp = tri ? Math.sqrt(turnDeg / amax) : vmax / amax;
  const state = (t: number): [number, number, number] => {         // θ, ω, α
    if (t <= tp) return [0.5 * amax * t * t, amax * t, amax];
    if (!tri && t <= T - tp) return [0.5 * amax * tp * tp + vmax * (t - tp), vmax, 0];
    const r = T - t;
    return [turnDeg - 0.5 * amax * r * r, amax * r, -amax];
  };
  for (let i = 0; i < n; i++) {
    const t = (T * i) / (n - 1), [th, w, al] = state(t);
    const D = (startDeg + th) * rad, W = w * rad, A = al * rad;
    out.push({
      t, theta: th, omega: w, alpha: al,
      L: 2 * R * Math.sin(D / 2),
      v: R * Math.cos(D / 2) * W,
      a: R * Math.cos(D / 2) * A - 0.5 * R * Math.sin(D / 2) * W * W
    });
  }
  return out;
}
