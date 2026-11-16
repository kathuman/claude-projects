// The importance mask W ∈ [0.2, 3] (1 = neutral) and the brush that paints it.
//
// The solver multiplies each pixel's squared-error reduction by W, so a region painted up to W = 3 counts three times
// as much as an unpainted one and attracts more lines; a region painted down to 0.2 is nearly ignored. The brush is
// multiplicative with a Gaussian falloff: one dab multiplies W by (1 + s·f) to raise it or divides by it to lower it,
// where f = exp(−2(d/r)²) is 1 at the centre and about 0.14 at the edge. Multiplying (rather than adding) makes raising
// and lowering symmetric: a raise followed by a lower at the same spot returns W to where it was (until a bound is hit).

export const W_MIN = 0.2, W_MAX = 3;

export function newMask(res: number): Float32Array { return new Float32Array(res * res).fill(1); }

/** Paint one dab centred at (x, y) (working-resolution px) with radius r; dir +1 raises, −1 lowers. */
export function dab(W: Float32Array, res: number, x: number, y: number, r: number, dir: 1 | -1, strength = 0.25): void {
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(res - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(res - 1, Math.ceil(y + r));
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      const d2 = ((i + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2) / (r * r);
      if (d2 > 1) continue;
      const k = 1 + strength * Math.exp(-2 * d2), p = j * res + i;
      W[p] = Math.min(W_MAX, Math.max(W_MIN, dir > 0 ? W[p] * k : W[p] / k));
    }
  }
}

/** Dabs along a stroke from (x0, y0) to (x1, y1), spaced a quarter radius apart (excluding the start point). */
export function stroke(W: Float32Array, res: number, x0: number, y0: number, x1: number, y1: number, r: number, dir: 1 | -1): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (r / 4)));
  for (let s = 1; s <= n; s++) dab(W, res, x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n, r, dir);
}

/** Carry a mask over to another working resolution (nearest pixel: the mask is painted coarsely anyway). */
export function resizeMask(W: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return Float32Array.from(W);
  const out = new Float32Array(to * to);
  for (let j = 0; j < to; j++) {
    const sj = Math.min(from - 1, Math.floor(((j + 0.5) * from) / to));
    for (let i = 0; i < to; i++) out[j * to + i] = W[sj * from + Math.min(from - 1, Math.floor(((i + 0.5) * from) / to))];
  }
  return out;
}

/** True if any pixel is not neutral. */
export function isPainted(W: Float32Array): boolean {
  for (let p = 0; p < W.length; p++) if (W[p] !== 1) return true;
  return false;
}
