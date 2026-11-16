// Will this machine wind this piece? Each check returns a code, a level and the numbers the page needs to explain it.
//
//   gap      the guide tube must pass between neighbouring nails with room to spare on both sides
//   inside   while the board turns, the guide waits inside the ring: it must clear the nails
//   outside  when it wraps, it goes outside the ring: it must clear the nails there too
//   height   the wraps on the busiest nail must fit below the nail tops
//   tight    a line that leaves a nail at a shallow angle rubs the neighbouring nail and is pulled out of line; the
//            sequence's minimum nail skip decides how many there are
//   speed    the board turns slower than its axis limit because the spool cannot pay thread out faster

import { gapMm, pitchMm, xSpeedLimit, zTopMm, type MachineConfig } from "./config";
import type { Plan } from "./toolpath";

export type Level = "ok" | "warn" | "error";
export interface Check { code: "gap" | "inside" | "outside" | "height" | "tight" | "speed"; level: Level; v: Record<string, number> }

/** Distance from point (px, py) to the segment (ax, ay)–(bx, by). */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * The smallest clearance, in mm, between the thread of line a→b and the nails next to its two ends. The line is taken
 * between nail centres; the real thread can sit up to a nail radius plus half a thread to one side of that, and the
 * neighbouring nail has its own radius, so clearance = distance − nail diameter − half the thread.
 */
export function lineClearance(a: number, b: number, c: MachineConfig): number {
  const R = c.boardMm / 2, N = c.nails;
  const at = (i: number) => { const t = (2 * Math.PI * i) / N; return [R * Math.sin(t), -R * Math.cos(t)] as const; };
  const [ax, ay] = at(a), [bx, by] = at(b);
  let best = Infinity;
  for (const end of [a, b]) {
    for (const d of [-2, -1, 1, 2]) {
      const m = (((end + d) % N) + N) % N;
      if (m === a || m === b) continue;
      const [mx, my] = at(m);
      best = Math.min(best, segDist(mx, my, ax, ay, bx, by));
    }
  }
  return best - c.nailMm - c.threadMm / 2;
}

export function machineChecks(sequence: ArrayLike<number>, c: MachineConfig, plan: Plan): Check[] {
  const out: Check[] = [];
  const gap = gapMm(c), side = (gap - c.guideMm) / 2;
  out.push({ code: "gap", level: side < 0.25 ? "error" : side < 0.75 ? "warn" : "ok", v: { gap, side, pitch: pitchMm(c) } });

  const need = c.nailMm / 2 + c.guideMm / 2 + 1;
  out.push({ code: "inside", level: c.insideMm < need ? "error" : "ok", v: { have: c.insideMm, need } });
  out.push({ code: "outside", level: c.outsideMm < need ? "error" : "ok", v: { have: c.outsideMm, need } });

  const top = zTopMm(c);
  out.push({
    code: "height", level: c.zStartMm >= top ? "error" : plan.cappedWraps > 0 ? "warn" : "ok",
    v: { maxWraps: plan.maxWraps, maxZ: plan.maxZ, top, capped: plan.cappedWraps }
  });

  let tight = 0, minSkip = Infinity, worst = Infinity;
  for (let k = 1; k < sequence.length; k++) {
    const a = sequence[k - 1], b = sequence[k], d = Math.abs(a - b) % c.nails;
    minSkip = Math.min(minSkip, Math.min(d, c.nails - d));
    const cl = lineClearance(a, b, c);
    worst = Math.min(worst, cl);
    if (cl < 0) tight++;
  }
  const lines = Math.max(0, sequence.length - 1);
  out.push({ code: "tight", level: tight === 0 ? "ok" : "warn", v: { tight, lines, minSkip: Number.isFinite(minSkip) ? minSkip : 0, worst: Number.isFinite(worst) ? worst : 0, safeSkip: safeSkip(c) } });

  const vx = xSpeedLimit(c);
  out.push({ code: "speed", level: "ok", v: { limit: vx, axis: c.xSpeed, capped: vx < c.xSpeed ? 1 : 0 } });
  return out;
}

/** The smallest nail skip (2 or more) whose lines clear the neighbouring nails. */
export function safeSkip(c: MachineConfig): number {
  // skip 1 joins neighbours with nothing between them; from 2 on, the nails in between sit close to a short line
  for (let d = 2; d <= c.nails / 2; d++) if (lineClearance(0, d, c) >= 0) return d;
  return Math.floor(c.nails / 2);
}

export const worstLevel = (cs: Check[]): Level => (cs.some((x) => x.level === "error") ? "error" : cs.some((x) => x.level === "warn") ? "warn" : "ok");
