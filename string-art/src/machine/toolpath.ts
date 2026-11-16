// From a nail sequence to machine moves.
//
// The thread runs from the spool through the guide. The guide never crosses the board: it waits a few millimetres
// inside the nail circle while the board turns, so the thread from the last nail to the guide always lies across the
// open middle of the board and cannot catch on other nails. To wrap nail j:
//
//   travel  turn the board until the gap beside nail j (on the side away from the nail after j) is under the guide
//   lift    set the guide to the height for j's next wrap (each wrap on the same nail is laid a little higher)
//   out     move the guide outward through that gap, beyond the nail circle
//   wrap    turn the board one nail spacing, so the guide passes behind nail j to the gap on its other side
//   in      move the guide back inward through that gap: the thread now goes round the outside of nail j
//
// The wrap ends on the side facing the next nail, so the following travel carries on in the same direction instead of
// dragging the thread back round j. Every move is one axis at a time.

import { pitchDeg, xSpeedLimit, zTopMm, type MachineConfig } from "./config";
import { moveFraction, moveTime } from "./motion";

export type Axis = 0 | 1 | 2;                    // X (turn, °), Y (guide radius, mm), Z (height, mm)
export type MoveKind = "setup" | "travel" | "lift" | "out" | "wrap" | "in" | "finish";

export interface Plan {
  /** axis of each move */
  axis: Uint8Array;
  /** kind of each move (index into KINDS) */
  kind: Uint8Array;
  /** where each move starts and ends on its axis */
  from: Float64Array;
  to: Float64Array;
  /** the line each move belongs to: 0 for setting up, k for the moves that wind line k (ending at sequence[k]) */
  line: Uint32Array;
  /** start time and duration of each move, s */
  t0: Float64Array;
  dur: Float64Array;
  /** lineEnd[k] = index of the last move of line k (k = 0 is the setup) */
  lineEnd: Int32Array;
  /** where the machine starts (after zeroing) */
  home: [number, number, number];
  totalS: number;
  /** wraps laid on each nail */
  wraps: Uint16Array;
  maxWraps: number;
  /** the highest wrap, mm above the board */
  maxZ: number;
  /** wraps that would have gone above the top and were laid at the top instead */
  cappedWraps: number;
  /** the board's total turning, ° */
  turnDeg: number;
  lines: number;
  /** top speed and acceleration of each axis, as used for the timing */
  v: [number, number, number];
  a: [number, number, number];
}

export const KINDS: MoveKind[] = ["setup", "travel", "lift", "out", "wrap", "in", "finish"];

/** a - b reduced to (-180, 180] */
export function wrap180(d: number): number {
  let r = ((d + 180) % 360 + 360) % 360 - 180;
  if (r === -180) r = 180;
  return r;
}

/** The angle of nail i under the guide, ° */
export const nailX = (i: number, c: Pick<MachineConfig, "nails">) => i * pitchDeg(c);

/** Which way to wrap nail j: +1 if the next nail is reached by turning X up (the shorter way), else -1. */
export function wrapDir(j: number, next: number | undefined, c: Pick<MachineConfig, "nails">): 1 | -1 {
  if (next === undefined) return 1;
  return wrap180(nailX(next, c) - nailX(j, c)) < 0 ? -1 : 1;
}

/** The height of the w-th wrap (0-based) on a nail, capped 2 mm below the top. */
export function wrapZ(w: number, c: MachineConfig): number {
  return Math.min(c.zStartMm + w * c.layerMm, zTopMm(c));
}

export function planToolpath(sequence: ArrayLike<number>, c: MachineConfig): Plan {
  const L = Math.max(0, sequence.length - 1), p = pitchDeg(c), clearZ = c.nailHeightMm + 2;
  const axis: number[] = [], kind: number[] = [], from: number[] = [], to: number[] = [], line: number[] = [];
  const pos: [number, number, number] = [0, 0, c.nailHeightMm];
  const home: [number, number, number] = [0, 0, c.nailHeightMm];
  const lineEnd = new Int32Array(L + 1);
  const wraps = new Uint16Array(c.nails);
  let turn = 0, maxZ = 0, capped = 0;
  const move = (a: Axis, target: number, k: MoveKind, ln: number) => {
    if (Math.abs(target - pos[a]) < 1e-9) return;
    axis.push(a); kind.push(KINDS.indexOf(k)); from.push(pos[a]); to.push(target); line.push(ln);
    if (a === 0) turn += Math.abs(target - pos[a]);
    pos[a] = target;
  };

  // setup: rise clear of the nails, go inside the ring, turn to the first nail, drop to the first wrap height
  const s0 = sequence[0] ?? 0;
  move(2, clearZ, "setup", 0);
  move(1, -c.insideMm, "setup", 0);
  move(0, wrap180(nailX(s0, c)), "setup", 0);
  move(2, wrapZ(0, c), "setup", 0);
  lineEnd[0] = axis.length - 1;

  for (let k = 1; k <= L; k++) {
    const j = sequence[k], w = wrapDir(j, k < L ? sequence[k + 1] : undefined, c);
    const gap = nailX(j, c) - (w * p) / 2;
    const start = pos[0] + wrap180(gap - pos[0]);
    move(0, start, "travel", k);
    const n = wraps[j]++;
    if (c.zStartMm + n * c.layerMm > zTopMm(c)) capped++;
    const z = wrapZ(n, c);
    maxZ = Math.max(maxZ, z);
    move(2, z, "lift", k);
    move(1, c.outsideMm, "out", k);
    move(0, start + w * p, "wrap", k);
    move(1, -c.insideMm, "in", k);
    lineEnd[k] = axis.length - 1;
  }
  move(2, clearZ, "finish", L);

  const M = axis.length, t0 = new Float64Array(M), dur = new Float64Array(M);
  const vx = xSpeedLimit(c), V = [vx, c.ySpeed, c.zSpeed], A = [c.xAccel, c.yAccel, c.zAccel];
  let t = 0;
  for (let i = 0; i < M; i++) { t0[i] = t; dur[i] = moveTime(to[i] - from[i], V[axis[i]], A[axis[i]]); t += dur[i]; }
  let maxWraps = 0;
  for (let i = 0; i < wraps.length; i++) maxWraps = Math.max(maxWraps, wraps[i]);
  return {
    axis: Uint8Array.from(axis), kind: Uint8Array.from(kind), from: Float64Array.from(from), to: Float64Array.from(to),
    line: Uint32Array.from(line), t0, dur, lineEnd, home, totalS: t, wraps, maxWraps, maxZ, cappedWraps: capped,
    turnDeg: turn, lines: L, v: [V[0], V[1], V[2]], a: [A[0], A[1], A[2]]
  };
}

/** The machine's position at time t (s): [X, Y, Z], and the index of the move under way. */
export function positionAt(plan: Plan, t: number): { pos: [number, number, number]; move: number } {
  const pos: [number, number, number] = [...plan.home];
  const M = plan.axis.length;
  if (M === 0) return { pos, move: -1 };
  // binary search for the last move starting at or before t
  let lo = 0, hi = M - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (plan.t0[mid] <= t) lo = mid; else hi = mid - 1; }
  const i = lo;
  // each axis sits where its last finished move left it
  for (let a = 0 as Axis; a < 3; a = (a + 1) as Axis) {
    for (let m = i - 1; m >= 0; m--) if (plan.axis[m] === a) { pos[a] = plan.to[m]; break; }
  }
  const ax = plan.axis[i], f = moveFraction(t - plan.t0[i], plan.to[i] - plan.from[i], plan.v[ax], plan.a[ax]);
  pos[ax] = plan.from[i] + f * (plan.to[i] - plan.from[i]);
  return { pos, move: i };
}
