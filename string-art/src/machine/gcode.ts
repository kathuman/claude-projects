// The plan as G-code for GRBL (or Marlin): absolute millimetres, one axis per G1 line, each line of the piece marked
// with a comment so a sender can show which line is being wound. Comments are plain ASCII English: controllers and
// senders handle that everywhere. M0 stops for the tie-on, after every `pauseEvery` lines, and for the tie-off.

import { xSpeedLimit, type MachineConfig } from "./config";
import { KINDS, type Plan } from "./toolpath";

const AX = ["X", "Y", "Z"];
const DIG = [3, 2, 2];

export interface GcodeInfo { version: string; date: string }

function hms(s: number): string {
  const m = Math.round(s / 60), h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

export function toGcode(sequence: ArrayLike<number>, plan: Plan, c: MachineConfig, info: GcodeInfo): string {
  const L = plan.lines, out: string[] = [];
  const feed = [xSpeedLimit(c), c.ySpeed, c.zSpeed].map((v) => Math.round(v * 60));
  out.push(
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
    "",
    "G21 G90 G94",
    "G17"
  );
  const lineStart = new Int32Array(L + 1);
  for (let k = 1; k <= L; k++) lineStart[k] = plan.lineEnd[k - 1] + 1;
  // The board may keep turning one way for thousands of degrees. GRBL keeps positions as 32-bit floats, so once X
  // passes ±3600° the program, at the start of a line, re-labels the current position as the same angle within one turn (G92): nothing moves.
  let xOff = 0, x = 0;
  for (let i = 0; i < plan.axis.length; i++) {
    const ln = plan.line[i];
    if (KINDS[plan.kind[i]] === "travel" && Math.abs(x - xOff) > 3600) {
      const turns = Math.trunc((x - xOff) / 360);
      xOff += turns * 360;
      out.push(`G92 X${(x - xOff).toFixed(3)} ; same position, counted within one turn`);
    }
    if (KINDS[plan.kind[i]] === "finish") out.push("; finished: lift the guide clear");
    else if (ln > 0 && ln <= L && i === lineStart[ln]) {
      if (ln === 1 || (c.pauseEvery > 0 && (ln - 1) % c.pauseEvery === 0)) {
        out.push(ln === 1 ? `M0 ; tie the thread to nail ${sequence[0]}, then resume` : `M0 ; ${ln - 1} lines wound - check the thread, then resume`);
      }
      out.push(`; line ${ln} of ${L}: nail ${sequence[ln - 1]} to ${sequence[ln]}`);
    }
    const a = plan.axis[i];
    if (a === 0) x = plan.to[i];
    out.push(`G1 ${AX[a]}${(a === 0 ? plan.to[i] - xOff : plan.to[i]).toFixed(DIG[a])} F${feed[a]}`);
  }
  out.push(`M0 ; DONE - tie the thread off at nail ${sequence[L] ?? 0}`);
  out.push("M2", "");
  return out.join("\n");
}
