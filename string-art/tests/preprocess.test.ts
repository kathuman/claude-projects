import { describe, expect, it } from "vitest";
import { adjust, linearLuminance, linearToSrgb, NO_ADJUSTMENT, resampleSquare, srgbToLinear, toTarget } from "../src/core/preprocess";
import { circleMask, makeGeometry } from "../src/core/geometry";
import { blur3, ssim, ssimSeen } from "../src/core/metrics";

const rgba = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number?]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a = 255] = f(x, y), q = (y * w + x) * 4;
    data[q] = r; data[q + 1] = g; data[q + 2] = b; data[q + 3] = a;
  }
  return { data, width: w, height: h };
};

describe("preprocessing", () => {
  it("decodes sRGB to linear light and back", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3);   // mid-grey on screen is about 21 % of white's light
    for (const v of [0, 0.01, 0.2, 0.5, 0.9, 1]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 9);
  });

  it("weights the channels by Rec. 709 luminance in linear light", () => {
    const Y = linearLuminance(rgba(3, 1, (x) => (x === 0 ? [255, 0, 0] : x === 1 ? [0, 255, 0] : [0, 0, 255])));
    expect(Y[0]).toBeCloseTo(0.2126, 4);
    expect(Y[1]).toBeCloseTo(0.7152, 4);
    expect(Y[2]).toBeCloseTo(0.0722, 4);
  });

  it("treats transparent pixels as white board", () => {
    expect(linearLuminance(rgba(1, 1, () => [0, 0, 0, 0]))[0]).toBe(1);
  });

  it("resamples by area: halving averages 2 × 2 blocks exactly", () => {
    const w = 8, Y = Float32Array.from({ length: w * w }, (_, p) => (p % w) / w);
    const out = resampleSquare(Y, w, w, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(out[y * 4 + x]).toBeCloseTo(((2 * x) / w + (2 * x + 1) / w) / 2, 6);
  });

  it("keeps the mean when resampling to a size that does not divide evenly", () => {
    const Y = Float32Array.from({ length: 30 * 30 }, (_, p) => ((p * 7919) % 101) / 100);
    const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(resampleSquare(Y, 30, 30, 7))).toBeCloseTo(mean(Y), 4);
  });

  it("crops the centred square of a wide picture", () => {
    // left and right thirds black, middle third white: the centred square is all white
    const w = 30, h = 10, Y = Float32Array.from({ length: w * h }, (_, p) => ((p % w) >= 10 && (p % w) < 20 ? 1 : 0));
    const out = resampleSquare(Y, w, h, 5);
    for (const v of out) expect(v).toBeCloseTo(1, 6);
  });

  it("leaves luminance alone with no adjustment and darkens mid-tones with gamma above 1", () => {
    const Y = Float32Array.from([0, 0.2, 0.5, 1]);
    expect(Array.from(adjust(Y, NO_ADJUSTMENT))).toEqual(Array.from(Y));
    const g = adjust(Y, { brightness: 0, contrast: 1, gamma: 2 });
    expect(g[2]).toBeLessThan(Y[2]);
    expect(g[0]).toBe(0);
    expect(g[3]).toBeCloseTo(1, 6);
  });

  it("makes the target 1 − Y inside the circle and 0 outside", () => {
    const geom = makeGeometry(100, 40, 2), mask = circleMask(geom);
    const T = toTarget(new Float32Array(40 * 40).fill(0.25), mask);
    expect(T[20 * 40 + 20]).toBeCloseTo(0.75, 6);
    expect(T[0]).toBe(0);
  });
});

describe("SSIM seen from a distance", () => {
  const geom = makeGeometry(100, 60, 2);
  it("is 1 for identical images and keeps the mean when blurring", () => {
    const A = Float32Array.from({ length: 3600 }, (_, p) => ((p * 31) % 17) / 16);
    expect(ssimSeen(A, A, geom)).toBeCloseTo(1, 9);
    const b = blur3(A, 60), mean = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v, 0) / a.length;
    expect(mean(b)).toBeCloseTo(mean(A), 9);
  });
  it("rates fine stripes of the right average as closer to a flat grey than pixel SSIM does", () => {
    const grey = new Float32Array(3600).fill(0.5);
    const stripes = Float32Array.from({ length: 3600 }, (_, p) => ((p % 60) % 2 ? 1 : 0));
    expect(ssimSeen(grey, stripes, geom)).toBeGreaterThan(ssim(grey, stripes, geom));
  });
});
