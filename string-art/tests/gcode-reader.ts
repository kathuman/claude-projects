// Reading G-code back the way a controller would, to check what the machine actually does: which nails the guide
// wraps (the guide goes out between two nails and comes back in one nail further on, below the nail tops), and
// whether every crossing of the ring happens in a gap. Follows G92 re-labelling of X.
import { pitchDeg, type MachineConfig } from "../src/machine/config";

export interface ReadBack { nails: number[]; offGap: number; badWidth: number; m0: number; maxX: number; order: string[] }

export function readBack(gcode: string, c: MachineConfig, start = { X: 0, Y: 0, Z: c.nailHeightMm }): ReadBack {
  const p = pitchDeg(c), pos = { ...start };
  const nails: number[] = [], order: string[] = [];
  let xOut = NaN, offGap = 0, badWidth = 0, m0 = 0, maxX = 0;
  for (const raw of gcode.split("\n")) {
    const line = raw.split(";")[0].trim();
    if (line.startsWith("M0")) m0++;
    const r = /^G92 X(-?[\d.]+)/.exec(line);
    if (r) {
      const nx = Number(r[1]), d = Math.abs(nx - pos.X) % 360;
      // a G92 must keep the angle: same position, a whole number of turns apart (or, at a resume, the caller's θ)
      if (d > 2e-3 && 360 - d > 2e-3 && !Number.isNaN(pos.X)) badWidth++;
      pos.X = nx;
      continue;
    }
    const m = /^G1 ([XYZ])(-?[\d.]+)/.exec(line);
    if (!m) continue;
    const ax = m[1] as "X" | "Y" | "Z", v = Number(m[2]);
    order.push(ax);
    if (ax === "Y" && pos.Z < c.nailHeightMm) {          // above the nails, crossing the ring wraps nothing
      const atGap = Math.abs(pos.X / p - 0.5 - Math.round(pos.X / p - 0.5)) < 1e-3;
      if (pos.Y < 0 && v > 0) { xOut = pos.X; if (!atGap) offGap++; }
      if (pos.Y > 0 && v < 0) {
        if (!atGap) offGap++;
        if (Math.abs(Math.abs(pos.X - xOut) - p) > 1e-3) badWidth++;
        nails.push(((Math.round((pos.X + xOut) / 2 / p) % c.nails) + c.nails) % c.nails);
      }
    }
    pos[ax] = v;
    if (ax === "X") maxX = Math.max(maxX, Math.abs(v));
  }
  return { nails, offGap, badWidth, m0, maxX, order };
}

/** A random valid sequence: each step jumps at least minSkip nails. */
export function randomSeq(n: number, nails: number, minSkip: number, seed = 1): Uint16Array {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
  const out = new Uint16Array(n + 1);
  out[0] = Math.floor(rnd() * nails);
  for (let k = 1; k <= n; k++) {
    const d = minSkip + Math.floor(rnd() * (nails - 2 * minSkip + 1));
    out[k] = (out[k - 1] + d) % nails;
  }
  return out;
}
