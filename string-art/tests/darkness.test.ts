import { describe, expect, it } from "vitest";
import { applyChord, chordGain, passCoverage, threadAlpha } from "../src/core/darkness";
import type { ChordView } from "../src/core/linecache";

const view = (idx: number[], w: number[], k = 1): ChordView =>
  ({ idx: Uint32Array.from(idx), w: Uint8Array.from(w), start: 0, end: idx.length, k, lenPx: idx.length });

describe("darkness model", () => {
  it("computes the per-pass opacity from thread and pixel size", () => {
    // 600 mm over 700 px: 0.857 mm per pixel; a 0.25 mm thread hides 0.2917 of a pixel
    expect(threadAlpha(0.25, 600, 700, 1)).toBeCloseTo(0.25 / (600 / 700), 12);
    expect(threadAlpha(0.25, 600, 700, 2)).toBeCloseTo((2 * 0.25) / (600 / 700), 12);
    expect(threadAlpha(0.001, 600, 700, 1)).toBe(0.02);   // clamped below
    expect(threadAlpha(5, 600, 700, 1)).toBe(1);          // clamped above
  });

  it("is monotone and stays in [0, 1]", () => {
    const C = new Float64Array(4), ch = view([0, 1, 2, 3], [255, 128, 1, 255], 1.3);
    let prev = Array.from(C);
    for (let n = 0; n < 200; n++) {
      applyChord(C, ch, 0.9);
      for (let p = 0; p < 4; p++) {
        expect(C[p]).toBeGreaterThanOrEqual(prev[p]);
        expect(C[p]).toBeLessThanOrEqual(1);
        expect(C[p]).toBeGreaterThanOrEqual(0);
      }
      prev = Array.from(C);
    }
  });

  it("gives 1 − (1 − a)ⁿ after n passes", () => {
    const C = new Float64Array(1), ch = view([0], [255]), alpha = 0.3;
    for (let n = 1; n <= 12; n++) {
      applyChord(C, ch, alpha);
      expect(C[0]).toBeCloseTo(1 - (1 - alpha) ** n, 12);
    }
  });

  it("caps a single pass at full coverage", () => {
    expect(passCoverage(2, 1.4, 255)).toBe(1);
    const C = new Float64Array(1);
    applyChord(C, view([0], [255], 1.4), 2);
    expect(C[0]).toBe(1);
  });

  it("scores a pass by the exact reduction in squared error", () => {
    const T = Float32Array.from([0.8, 0.1, 0.5]), C = Float64Array.from([0.2, 0.05, 0.5]), W = Float32Array.from([1, 2, 0.5]);
    const ch = view([0, 1, 2], [255, 200, 100], 1.1), alpha = 0.4;
    const gain = chordGain(T, C, W, ch, alpha);
    const after = Float64Array.from(C);
    applyChord(after, ch, alpha);
    let expected = 0;
    for (let p = 0; p < 3; p++) expected += W[p] * ((T[p] - C[p]) ** 2 - (T[p] - after[p]) ** 2);
    expect(gain).toBeCloseTo(expected, 12);
  });
});
