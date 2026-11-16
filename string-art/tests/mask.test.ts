import { describe, expect, it } from "vitest";
import { dab, isPainted, newMask, resizeMask, stroke, W_MAX, W_MIN } from "../src/core/mask";

describe("importance mask", () => {
  it("starts neutral", () => {
    const W = newMask(20);
    expect(isPainted(W)).toBe(false);
    expect(W.every((v) => v === 1)).toBe(true);
  });

  it("raises at the centre more than at the edge, and not outside the radius", () => {
    const W = newMask(40);
    dab(W, 40, 20, 20, 6, 1);
    expect(W[20 * 40 + 20]).toBeGreaterThan(W[20 * 40 + 24]);
    expect(W[20 * 40 + 24]).toBeGreaterThan(1);
    expect(W[20 * 40 + 30]).toBe(1);
  });

  it("is symmetric: raising then lowering the same spot gives back 1", () => {
    const W = newMask(40);
    dab(W, 40, 20, 20, 6, 1);
    dab(W, 40, 20, 20, 6, -1);
    for (const v of W) expect(v).toBeCloseTo(1, 6);   // Float32 storage: about 7 significant digits
  });

  it("stays within its bounds however much it is painted", () => {
    const W = newMask(30);
    for (let k = 0; k < 50; k++) dab(W, 30, 10, 10, 5, 1);
    for (let k = 0; k < 50; k++) dab(W, 30, 20, 20, 5, -1);
    expect(Math.max(...W)).toBeCloseTo(W_MAX, 6);
    expect(Math.min(...W)).toBeCloseTo(W_MIN, 6);
  });

  it("paints a continuous stroke", () => {
    const W = newMask(60);
    stroke(W, 60, 10, 30, 50, 30, 4, 1);
    for (let x = 12; x <= 48; x += 4) expect(W[30 * 60 + x]).toBeGreaterThan(1.1);
  });

  it("carries over to another resolution", () => {
    const W = newMask(40);
    dab(W, 40, 10, 10, 5, 1);
    const big = resizeMask(W, 40, 80);
    expect(big[20 * 80 + 20]).toBeCloseTo(W[10 * 40 + 10], 6);
    expect(big[70 * 80 + 70]).toBe(1);
  });
});
