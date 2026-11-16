// The thread darkness model.
//
// Each pixel holds C ∈ [0, 1], the fraction of its area hidden by thread (0 = bare white board, 1 = fully black).
// A pass of thread covering a fraction a of the pixel hides a of whatever is still visible, independently of earlier
// passes (threads lie on top of one another at random offsets), so the visible fraction multiplies:
//
//     1 − C_new = (1 − C)(1 − a)   ⇔   C_new = C + a(1 − C) = 1 − (1 − C)(1 − a).
//
// Consequences used below and tested: C_new ≥ C (monotone), C stays in [0, 1] when a ∈ [0, 1], and n passes of the
// same a give C = 1 − (1 − a)ⁿ.
//
// Opacity of one pass. At working resolution a pixel is p = board_mm / res millimetres wide and the thread d mm wide,
// so a thread crossing a pixel hides about d/p of it: α = clamp(d/p, 0.02, 1) · darkness_factor. On a chord pixel with
// Wu weight w the pass hides a = min(1, α · k · w), where k ∈ [1, √2] is the chord's coverage correction (see wu.ts).
//
// Error reduction of one chord. With d = a(1 − C) the increase in darkness at a pixel, the change in squared error is
//
//     (T − C)² − (T − C − d)² = d · (2(T − C) − d),
//
// which is what chordGain sums (weighted by the importance W). It is positive where the pixel is still lighter than
// the target by more than d/2, and negative once a pass would overshoot.

import type { ChordView } from "./linecache";

/** Per-pass opacity α at working resolution. */
export function threadAlpha(threadMm: number, boardMm: number, res: number, darknessFactor: number): number {
  const pixelMm = boardMm / res;
  return Math.min(1, Math.max(0.02, threadMm / pixelMm)) * darknessFactor;
}

/** The fraction a pixel loses to one pass: a = min(1, α·k·w), with w the 8-bit Wu weight (w/255). */
export function passCoverage(alpha: number, k: number, wq: number): number {
  const a = (alpha * k * wq) / 255;
  return a < 1 ? a : 1;
}

/** Darken C along one chord: C ← 1 − (1 − C)(1 − a). */
export function applyChord(C: Float64Array, ch: ChordView, alpha: number): void {
  const { idx, w, start, end } = ch, ak = (alpha * ch.k) / 255;
  for (let e = start; e < end; e++) {
    const p = idx[e];
    let a = ak * w[e];
    if (a > 1) a = 1;
    C[p] += a * (1 - C[p]);
  }
}

/** Σ W(p)·[(T−C)² − (T−C_new)²] along the chord: how much one more pass reduces the weighted squared error. */
export function chordGain(T: Float32Array, C: Float64Array, W: Float32Array, ch: ChordView, alpha: number): number {
  const { idx, w, start, end } = ch, ak = (alpha * ch.k) / 255;
  let s = 0;
  for (let e = start; e < end; e++) {
    const p = idx[e], c = C[p];
    let a = ak * w[e];
    if (a > 1) a = 1;
    const d = a * (1 - c);
    s += W[p] * d * (2 * (T[p] - c) - d);
  }
  return s;
}
