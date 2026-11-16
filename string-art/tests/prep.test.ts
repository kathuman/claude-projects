import { describe, expect, it } from "vitest";
import { buildTarget, cropResample, defaultCrop, NO_ADJUSTMENT, resampleSquare } from "../src/core/preprocess";
import { clahe } from "../src/core/clahe";
import { checkTarget } from "../src/core/checks";
import { circleMask, makeGeometry } from "../src/core/geometry";

const std = (a: Float32Array, m: Uint8Array) => {
  let n = 0, s = 0, s2 = 0;
  for (let p = 0; p < a.length; p++) if (m[p]) { n++; s += a[p]; s2 += a[p] * a[p]; }
  return Math.sqrt(s2 / n - (s / n) ** 2);
};

describe("crop with rotation", () => {
  // an asymmetric test picture: a dark square in the top-left quarter of a light 60 × 40 image
  const w = 60, h = 40, Y = new Float32Array(w * h).fill(0.9);
  for (let y = 5; y < 15; y++) for (let x = 15; x < 25; x++) Y[y * w + x] = 0.1;

  it("without rotation is the exact area average", () => {
    const c = defaultCrop(w, h);
    expect(Array.from(cropResample(Y, w, h, 20, c))).toEqual(Array.from(resampleSquare(Y, w, h, 20, c)));
  });

  it("turns the picture clockwise for a positive angle", () => {
    const res = 40, c = defaultCrop(w, h);
    const flat = cropResample(Y, w, h, res, c), rot = cropResample(Y, w, h, res, { ...c, angle: Math.PI / 2 });
    // a quarter turn clockwise on screen (y down) takes the output point (x, y) to (res − 1 − y, x)
    let diff = 0;
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) diff += Math.abs(rot[x * res + (res - 1 - y)] - flat[y * res + x]);
    expect(diff / (res * res)).toBeLessThan(0.02);
  });

  it("comes back to the start after a full turn", () => {
    const c = defaultCrop(w, h), a = cropResample(Y, w, h, 20, { ...c, angle: 1e-9 }), b = cropResample(Y, w, h, 20, { ...c, angle: 2 * Math.PI });
    for (let p = 0; p < a.length; p++) expect(b[p]).toBeCloseTo(a[p], 4);
  });

  it("zooms in on the crop's centre and fills outside the picture with white", () => {
    const z = cropResample(Y, w, h, 10, { cx: 20, cy: 10, size: 8, angle: 0.3 });
    expect(Math.max(...z)).toBeLessThan(0.3);   // all inside the dark square
    const out = cropResample(Y, w, h, 10, { cx: -100, cy: -100, size: 8, angle: 0.3 });
    for (const v of out) expect(v).toBe(1);
  });
});

describe("CLAHE", () => {
  const res = 64, mask = circleMask(makeGeometry(100, res, 2));

  it("is the identity with clip limit 1 (a flat histogram)", () => {
    const v = Float32Array.from({ length: res * res }, (_, p) => ((p * 37) % 256) / 255);
    const e = clahe(v, res, mask, 8, 1);
    let worst = 0;
    for (let p = 0; p < v.length; p++) if (mask[p]) worst = Math.max(worst, Math.abs(e[p] - v[p]));
    expect(worst).toBeLessThan(0.02);
  });

  it("raises the contrast of a low-contrast picture, more with a higher clip limit", () => {
    const v = Float32Array.from({ length: res * res }, (_, p) => 0.45 + 0.1 * (((p % res) + Math.floor(p / res)) % 7) / 6);
    const s0 = std(v, mask), s2 = std(clahe(v, res, mask, 8, 2), mask), s4 = std(clahe(v, res, mask, 8, 4), mask);
    expect(s2).toBeGreaterThan(s0);
    expect(s4).toBeGreaterThan(s2);
  });

  it("keeps values in [0, 1], keeps their order within a tile, and leaves pixels outside the circle alone", () => {
    const v = Float32Array.from({ length: res * res }, (_, p) => (p % res) / (res - 1));
    const e = clahe(v, res, mask, 8, 3);
    for (let p = 0; p < v.length; p++) {
      expect(e[p]).toBeGreaterThanOrEqual(0); expect(e[p]).toBeLessThanOrEqual(1);
      if (!mask[p]) expect(e[p]).toBe(v[p]);
    }
    const row = 32 * res;
    for (let x = 1; x < res; x++) if (mask[row + x] && mask[row + x - 1]) expect(e[row + x]).toBeGreaterThanOrEqual(e[row + x - 1] - 1e-6);
  });
});

describe("background check", () => {
  const res = 200, mask = circleMask(makeGeometry(100, res, 2));
  const face = () => {
    const T = new Float32Array(res * res);
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
      const d = Math.hypot(x + 0.5 - 100, y + 0.5 - 100);
      if (mask[y * res + x]) T[y * res + x] = d < 50 ? 0.85 : 0.05;
    }
    return T;
  };

  it("passes a strong subject on a plain background", () => {
    const c = checkTarget(face(), res, mask);
    expect(c.lowContrast).toBe(false);
    expect(c.busyBorder).toBe(false);
  });

  it("flags a low-contrast picture", () => {
    const T = face().map((v) => 0.4 + 0.1 * v);
    expect(checkTarget(Float32Array.from(T), res, mask).lowContrast).toBe(true);
  });

  it("flags a busy border", () => {
    const T = face();
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
      const p = y * res + x, d = Math.hypot(x + 0.5 - 100, y + 0.5 - 100);
      if (mask[p] && d > 75) T[p] = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 0.9 : 0.1;   // a checked texture near the rim
    }
    expect(checkTarget(T, res, mask).busyBorder).toBe(true);
  });

  it("does not depend much on the working resolution", () => {
    const a = checkTarget(face(), res, mask).border;
    const big = 600, m2 = circleMask(makeGeometry(100, big, 2)), T2 = new Float32Array(big * big);
    for (let y = 0; y < big; y++) for (let x = 0; x < big; x++) if (m2[y * big + x]) T2[y * big + x] = Math.hypot(x + 0.5 - 300, y + 0.5 - 300) < 150 ? 0.85 : 0.05;
    expect(Math.abs(checkTarget(T2, big, m2).border - a)).toBeLessThan(0.01);
  });
});

describe("the whole preparation", () => {
  it("applies the crop, CLAHE and adjustments and zeroes the outside", () => {
    // low-contrast local detail (what CLAHE is for; on a smooth global ramp it would flatten the ramp instead)
    const w = 40, h = 40, lum = Float32Array.from({ length: w * h }, (_, p) => 0.45 + 0.1 * ((((p % w) + Math.floor(p / w)) % 5) / 4));
    const res = 32, mask = circleMask(makeGeometry(100, res, 2));
    const plain = buildTarget(lum, w, h, res, { crop: defaultCrop(w, h), adj: NO_ADJUSTMENT, clahe: false, claheClip: 2 }, mask);
    const boosted = buildTarget(lum, w, h, res, { crop: defaultCrop(w, h), adj: NO_ADJUSTMENT, clahe: true, claheClip: 4 }, mask);
    expect(plain[0]).toBe(0);
    expect(std(boosted, mask)).toBeGreaterThan(std(plain, mask));
  });
});
