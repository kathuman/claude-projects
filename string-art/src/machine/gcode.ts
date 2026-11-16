// The plan as G-code for GRBL (or Marlin): absolute millimetres, one axis per G1 line, each line of the piece marked
// with a comment so a sender can show which line is being wound. Comments are plain ASCII English: controllers and
// senders handle that everywhere. M0 stops for the tie-on, after every `pauseEvery` lines, and for the tie-off.
//
// The program is built as structured lines, so the browser sender knows for each line which machine move it is (to
// follow the machine in the simulator) and which line of the piece it belongs to (to save the place and resume).

import { xSpeedLimit, type MachineConfig } from "./config";
import { KINDS, wrap180, type Plan } from "./toolpath";

const AX = ["X", "Y", "Z"];
const DIG = [3, 2, 2];

export interface GcodeInfo { version: string; date: string }

export interface ProgramLine {
  text: string;
  /** the plan move this line performs, or -1 */
  move: number;
  /** the line of the piece it belongs to (0 = setting up) */
  line: number;
  /** for an M0: why the machine stops */
  pause?: "tieOn" | "check" | "done";
}

function hms(s: number): string {
  const m = Math.round(s / 60), h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

const feeds = (c: MachineConfig) => [xSpeedLimit(c), c.ySpeed, c.zSpeed].map((v) => Math.round(v * 60));

/**
 * The moves from plan move `first` to the end, with X counted from `xBase` (the program's X = plan X − xBase). The
 * board may keep turning one way for thousands of degrees, and GRBL keeps positions as 32-bit floats, so once X passes
 * ±3600° the program, at the start of a line, re-labels the current position as the same angle within one turn (G92):
 * nothing moves.
 */
function body(sequence: ArrayLike<number>, plan: Plan, c: MachineConfig, first: number, xBase: number, tieOnAt: number): ProgramLine[] {
  const L = plan.lines, out: ProgramLine[] = [], feed = feeds(c);
  const lineStart = new Int32Array(L + 1);
  for (let k = 1; k <= L; k++) lineStart[k] = plan.lineEnd[k - 1] + 1;
  let xOff = xBase, x = first < plan.axis.length ? plan.from[first] : 0;
  for (let i = first; i < plan.axis.length; i++) {
    const ln = plan.line[i], kind = KINDS[plan.kind[i]];
    if (kind === "travel" && Math.abs(x - xOff) > 3600) {
      xOff += Math.trunc((x - xOff) / 360) * 360;
      out.push({ text: `G92 X${(x - xOff).toFixed(3)} ; same position, counted within one turn`, move: -1, line: ln });
    }
    if (kind === "finish") out.push({ text: "; finished: lift the guide clear", move: -1, line: ln });
    else if (ln > 0 && ln <= L && i === lineStart[ln]) {
      if (ln === tieOnAt) out.push({ text: `M0 ; tie the thread to nail ${sequence[ln - 1]}, then resume`, move: -1, line: ln, pause: "tieOn" });
      else if (c.pauseEvery > 0 && (ln - 1) % c.pauseEvery === 0) out.push({ text: `M0 ; ${ln - 1} lines wound - check the thread, then resume`, move: -1, line: ln, pause: "check" });
      out.push({ text: `; line ${ln} of ${L}: nail ${sequence[ln - 1]} to ${sequence[ln]}`, move: -1, line: ln });
    }
    const a = plan.axis[i];
    if (a === 0) x = plan.to[i];
    out.push({ text: `G1 ${AX[a]}${(a === 0 ? plan.to[i] - xOff : plan.to[i]).toFixed(DIG[a])} F${feed[a]}`, move: i, line: ln });
  }
  out.push({ text: `M0 ; DONE - tie the thread off at nail ${sequence[L] ?? 0}`, move: -1, line: L, pause: "done" });
  out.push({ text: "M2", move: -1, line: L });
  return out;
}

/** The whole winding program as structured lines. */
export function program(sequence: ArrayLike<number>, plan: Plan, c: MachineConfig): ProgramLine[] {
  return [{ text: "G21 G90 G94", move: -1, line: 0 }, { text: "G17", move: -1, line: 0 }, ...body(sequence, plan, c, 0, 0, 1)];
}

/** The first plan move of line k (1 … L). */
export const firstMoveOf = (plan: Plan, k: number) => plan.lineEnd[k - 1] + 1;

/** The guide's height when line k starts. */
function zBefore(plan: Plan, i: number): number {
  for (let m = i - 1; m >= 0; m--) if (plan.axis[m] === 2) return plan.to[m];
  return plan.home[2];
}

/**
 * A program that carries on from the start of line k, wherever the machine is now. `theta` is the board's current work
 * X as GRBL reports it. Only its angle within a turn matters, because the work zero is nail 0 and the program only ever
 * shifts X by whole turns. The guide rises clear of the nails first (it may have stopped between two of them), goes
 * inside the ring, the board turns to where line k − 1 ended, the guide drops to its height, and the machine stops for
 * the thread to be tied (or wound back) to nail sequence[k − 1].
 */
export function resumeProgram(sequence: ArrayLike<number>, plan: Plan, c: MachineConfig, k: number, theta: number): ProgramLine[] {
  const L = plan.lines;
  if (!(k >= 1 && k <= L)) throw new RangeError("line out of range");
  const feed = feeds(c), i0 = firstMoveOf(plan, k), th = wrap180(theta);
  const startX = plan.from[i0];
  const xBase = startX - (th + wrap180(startX - th));      // program X = plan X − xBase lies within half a turn of θ
  const out: ProgramLine[] = [
    { text: "G21 G90 G94", move: -1, line: k - 1 },
    { text: `G92 X${th.toFixed(3)} ; the board's angle, counted within one turn`, move: -1, line: k - 1 },
    { text: `; resume at line ${k} of ${L}`, move: -1, line: k - 1 },
    { text: `G1 Z${(c.nailHeightMm + 2).toFixed(2)} F${feed[2]}`, move: -1, line: k - 1 },
    { text: `G1 Y${(-c.insideMm).toFixed(2)} F${feed[1]}`, move: -1, line: k - 1 },
    { text: `G1 X${(startX - xBase).toFixed(3)} F${feed[0]}`, move: -1, line: k - 1 },
    { text: `G1 Z${zBefore(plan, i0).toFixed(2)} F${feed[2]}`, move: -1, line: k - 1 }
  ];
  return out.concat(body(sequence, plan, c, i0, xBase, k));
}

/** The program as a G-code file, with a header that explains the axes, the settings and how to start. */
export function toGcode(sequence: ArrayLike<number>, plan: Plan, c: MachineConfig, info: GcodeInfo): string {
  const L = plan.lines, feed = feeds(c);
  const head = [
    `; String Art winding program, made by String Art ${info.version} on ${info.date}`,
    `; ${c.nails} nails on a ${c.boardMm} mm circle, ${L} lines, ${c.threadMm} mm thread. Estimated time ${hms(plan.totalS)} without pauses.`,
    ";",
    "; Axes",
    `;   X  board turn in degrees. X = i * ${(360 / c.nails).toFixed(4)} puts nail i under the guide; X+ turns the board anticlockwise seen from the front.`,
    ";   Y  guide position from the nail circle in mm, negative inside it, positive outside.",
    ";   Z  guide height above the board in mm.",
    ";",
    "; GRBL settings for this machine (send once):",
    `;   $100=${c.xSteps} $101=${c.ySteps} $102=${c.zSteps}   steps per degree / mm`,
    `;   $110=${feed[0]} $111=${feed[1]} $112=${feed[2]}   top speeds, degree or mm per minute`,
    `;   $120=${c.xAccel} $121=${c.yAccel} $122=${c.zAccel}   accelerations, degree or mm per second squared`,
    ";   $20=0 (no soft limits: the board may turn many times)",
    ";",
    "; Before starting:",
    `;   1. Jog the guide so its eye is exactly above the centre of nail 0, just clear of the nail top (${c.nailHeightMm} mm above the board).`,
    `;   2. Set that point as the work zero: G10 L20 P1 X0 Y0 Z${c.nailHeightMm}`,
    `;   3. Run. The machine moves to nail ${sequence[0]} and stops: tie the thread to nail ${sequence[0]}, check it runs freely from the spool through the guide, then resume.`,
    ""
  ];
  return head.concat(program(sequence, plan, c).map((l) => l.text), [""]).join("\n");
}
