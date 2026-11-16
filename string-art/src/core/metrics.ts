// Quality metrics: RMSE and SSIM between the target T and the simulated darkness C, and the thread length.

import { chordLengthMm, circleMask, type Geometry } from "./geometry";

/** Root-mean-square difference between T and C over the pixels inside the circle. */
export function rmse(T: ArrayLike<number>, C: ArrayLike<number>, mask: Uint8Array): number {
  let s = 0, n = 0;
  for (let p = 0; p < mask.length; p++) if (mask[p]) { const d = T[p] - C[p]; s += d * d; n++; }
  return n ? Math.sqrt(s / n) : 0;
}

/**
 * Mean structural similarity (Wang et al. 2004) with a 7 × 7 uniform window, data range 1, K1 = 0.01, K2 = 0.03, and
 * sample (N − 1) covariances — the scikit-image defaults. For each window
 *
 *     SSIM = (2μₓμᵧ + C₁)(2σₓᵧ + C₂) / ((μₓ² + μᵧ² + C₁)(σₓ² + σᵧ² + C₂)),  C₁ = (K1·L)², C₂ = (K2·L)²,
 *
 * comparing local means (luminance), standard deviations (contrast) and correlation (structure). The window statistics
 * come from summed-area tables, so the cost is O(pixels). The mean is taken over windows lying wholly inside the circle.
 */
export function ssim(T: ArrayLike<number>, C: ArrayLike<number>, geom: Geometry): number {
  const res = geom.res, r = 3, win = 7, N = win * win, c1 = 0.01 ** 2, c2 = 0.03 ** 2;
  const W1 = res + 1;
  const sx = new Float64Array(W1 * W1), sy = new Float64Array(W1 * W1), sxx = new Float64Array(W1 * W1),
    syy = new Float64Array(W1 * W1), sxy = new Float64Array(W1 * W1);
  for (let y = 0; y < res; y++) {
    let ax = 0, ay = 0, axx = 0, ayy = 0, axy = 0;
    for (let x = 0; x < res; x++) {
      const p = y * res + x, a = T[p], b = C[p];
      ax += a; ay += b; axx += a * a; ayy += b * b; axy += a * b;
      const q = (y + 1) * W1 + (x + 1), u = y * W1 + (x + 1);
      sx[q] = sx[u] + ax; sy[q] = sy[u] + ay; sxx[q] = sxx[u] + axx; syy[q] = syy[u] + ayy; sxy[q] = sxy[u] + axy;
    }
  }
  const box = (s: Float64Array, x0: number, y0: number) => {
    const x1 = x0 + win, y1 = y0 + win;
    return s[y1 * W1 + x1] - s[y0 * W1 + x1] - s[y1 * W1 + x0] + s[y0 * W1 + x0];
  };
  const lim = geom.radius - r * Math.SQRT2 - 1;
  let total = 0, count = 0;
  for (let y = r; y < res - r; y++) {
    const dy = y + 0.5 - geom.cy;
    for (let x = r; x < res - r; x++) {
      const dx = x + 0.5 - geom.cx;
      if (dx * dx + dy * dy > lim * lim) continue;
      const x0 = x - r, y0 = y - r;
      const mx = box(sx, x0, y0) / N, my = box(sy, x0, y0) / N;
      const vx = (box(sxx, x0, y0) - N * mx * mx) / (N - 1), vy = (box(syy, x0, y0) - N * my * my) / (N - 1);
      const cxy = (box(sxy, x0, y0) - N * mx * my) / (N - 1);
      total += ((2 * mx * my + c1) * (2 * cxy + c2)) / ((mx * mx + my * my + c1) * (vx + vy + c2));
      count++;
    }
  }
  return count ? total / count : 1;
}

/**
 * Blur with three passes of a 3 × 3 box filter (≈ a Gaussian of σ ≈ 1.4 px: each pass adds variance 2/3 per axis).
 * String art is a fine texture of thin lines; seen from a normal distance the eye averages it. Comparing blurred
 * target and blurred thread measures what a viewer recognises, where pixel-level SSIM mostly measures texture.
 */
export function blur3(src: ArrayLike<number>, res: number): Float64Array {
  let a = Float64Array.from(src as ArrayLike<number>), b = new Float64Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {   // horizontal
      const p = y * res + x, l = x > 0 ? a[p - 1] : a[p], r = x < res - 1 ? a[p + 1] : a[p];
      b[p] = (l + a[p] + r) / 3;
    }
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {   // vertical
      const p = y * res + x, u = y > 0 ? b[p - res] : b[p], d = y < res - 1 ? b[p + res] : b[p];
      a[p] = (u + b[p] + d) / 3;
    }
  }
  return a;
}

/** SSIM of the blurred images: how alike target and thread look from a viewing distance. */
export function ssimSeen(T: ArrayLike<number>, C: ArrayLike<number>, geom: Geometry): number {
  return ssim(blur3(T, geom.res), blur3(C, geom.res), geom);
}

/** Thread needed: the sum of the chord lengths, in mm. The UI adds a separate 10 % allowance for wrapping and slack. */
export function threadLengthMm(sequence: Uint16Array, nails: number, boardMm: number): number {
  let s = 0;
  for (let i = 1; i < sequence.length; i++) s += chordLengthMm(sequence[i - 1], sequence[i], nails, boardMm);
  return s;
}

export const SLACK_ALLOWANCE = 0.1;

export interface Metrics { rmse: number; ssim: number; ssimSeen: number; threadM: number; slackM: number; lines: number; ms: number }

export function computeMetrics(T: Float32Array, C: Float64Array, geom: Geometry, sequence: Uint16Array, boardMm: number, ms: number): Metrics {
  const threadM = threadLengthMm(sequence, geom.nails, boardMm) / 1000;
  return { rmse: rmse(T, C, circleMask(geom)), ssim: ssim(T, C, geom), ssimSeen: ssimSeen(T, C, geom), threadM, slackM: threadM * SLACK_ALLOWANCE, lines: sequence.length - 1, ms };
}
