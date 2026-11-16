// The background check: two properties of a target that predict poor string art, measured so the page can warn.
//
// Low contrast. String art can only add darkness along straight lines that cross the whole board; it renders a picture
// through the differences between areas. If T hardly varies, every line darkens everything about equally and the
// result is a grey haze. Measured as the standard deviation of T inside the circle.
//
// Busy border. Every line starts and ends at the rim, so lines aimed at detail near the edge cross the rest of the
// board too, and the rim is where the fewest distinct lines meet a given spot at useful angles. Detail or texture in
// the outer ring turns into clutter. Measured on a fixed 128-px copy (so the result does not depend on the working
// resolution) as the mean gradient magnitude in the outer ring, 0.8 R … R, where the gradient is the central
// difference in darkness per pixel of that copy.

import { resampleSquare } from "./preprocess";

export const LOW_CONTRAST_STD = 0.12;
export const BUSY_BORDER = 0.05;

export interface BackgroundCheck { std: number; border: number; lowContrast: boolean; busyBorder: boolean }

export function checkTarget(T: Float32Array, res: number, mask: Uint8Array): BackgroundCheck {
  let n = 0, s = 0, s2 = 0;
  for (let p = 0; p < T.length; p++) if (mask[p]) { n++; s += T[p]; s2 += T[p] * T[p]; }
  const mean = n ? s / n : 0, std = n ? Math.sqrt(Math.max(0, s2 / n - mean * mean)) : 0;

  const R = 128, small = resampleSquare(T, res, res, R), c = R / 2, rad = R / 2 - 1;
  let g = 0, m = 0;
  for (let y = 1; y < R - 1; y++) {
    for (let x = 1; x < R - 1; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (d < 0.8 * rad || d > rad - 1.5) continue;   // the ring, keeping clear of the circle's own edge
      const p = y * R + x, gx = (small[p + 1] - small[p - 1]) / 2, gy = (small[p + R] - small[p - R]) / 2;
      g += Math.hypot(gx, gy); m++;
    }
  }
  const border = m ? g / m : 0;
  return { std, border, lowContrast: std < LOW_CONTRAST_STD, busyBorder: border > BUSY_BORDER };
}
