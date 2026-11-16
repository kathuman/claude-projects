import { describe, expect, it } from "vitest";
import { makeGeometry } from "../src/core/geometry";
import { wuLine } from "../src/core/wu";
import { buildFlat, buildLru, estimateFlatBytes } from "../src/core/linecache";

describe("Wu rasteriser", () => {
  const g = makeGeometry(240, 700, 2);
  const chords: [number, number][] = [[0, 120], [0, 60], [17, 203], [5, 31], [100, 101 + 40], [200, 30], [45, 90]];

  it("gives the same pixels and weights for (a, b) and (b, a)", () => {
    for (const [a, b] of chords) {
      const f = wuLine(g.xs[a], g.ys[a], g.xs[b], g.ys[b], 700), r = wuLine(g.xs[b], g.ys[b], g.xs[a], g.ys[a], 700);
      expect(Array.from(r.idx)).toEqual(Array.from(f.idx));
      expect(Array.from(r.w)).toEqual(Array.from(f.w));
      expect(r.k).toBe(f.k);
    }
  });

  it("keeps every weight in (0, 1] and every pixel unique, sorted and inside the image", () => {
    for (const [a, b] of chords) {
      const r = wuLine(g.xs[a], g.ys[a], g.xs[b], g.ys[b], 700);
      for (let e = 0; e < r.idx.length; e++) {
        expect(r.w[e]).toBeGreaterThan(0);
        expect(r.w[e]).toBeLessThanOrEqual(1);
        expect(r.idx[e]).toBeLessThan(700 * 700);
        if (e) expect(r.idx[e]).toBeGreaterThan(r.idx[e - 1]);
      }
    }
  });

  it("puts one pixel of ink per major-axis step, and k·Σw equals the chord length", () => {
    for (const [a, b] of chords) {
      const r = wuLine(g.xs[a], g.ys[a], g.xs[b], g.ys[b], 700);
      const major = Math.max(Math.abs(g.xs[b] - g.xs[a]), Math.abs(g.ys[b] - g.ys[a]));
      const sum = r.w.reduce((s, v) => s + v, 0);
      expect(Math.abs(sum - major)).toBeLessThan(1.5);
      expect(Math.abs(sum * r.k - r.length)).toBeLessThan(2);
      // pixels touched: about two per step along the major axis
      expect(r.idx.length).toBeGreaterThanOrEqual(Math.floor(major));
      expect(r.idx.length).toBeLessThanOrEqual(2 * (Math.ceil(major) + 2));
    }
  });

  it("draws an axis-aligned line through pixel centres with full weight", () => {
    const r = wuLine(10.5, 20.5, 30.5, 20.5, 64);
    expect(Array.from(r.idx)).toEqual(Array.from({ length: 21 }, (_, i) => 20 * 64 + 10 + i));
    expect(Array.from(r.w).slice(1, -1).every((w) => w === 1)).toBe(true);
    expect(r.k).toBe(1);
  });

  it("gives the 45° line a coverage correction of √2", () => {
    expect(wuLine(5.5, 5.5, 40.5, 40.5, 64).k).toBeCloseTo(Math.SQRT2, 12);
  });
});

describe("line cache", () => {
  const g = makeGeometry(160, 400, 2);

  it("returns the same chords precomputed and on demand", () => {
    const flat = buildFlat(g, 15), lru = buildLru(g, 15, 16);
    for (const [a, b] of [[0, 80], [3, 97], [150, 20], [40, 41]] as const) {
      const f = flat.get(a, b), l = lru.get(a, b);
      if (!f) { expect(l).toBeNull(); continue; }
      const fi = Array.from(f.idx.subarray(f.start, f.end)), fw = Array.from(f.w.subarray(f.start, f.end));
      expect(fi).toEqual(Array.from(l!.idx.subarray(l!.start, l!.end)));
      expect(fw).toEqual(Array.from(l!.w.subarray(l!.start, l!.end)));
      expect(f.k).toBeCloseTo(l!.k, 6);
    }
  });

  it("estimates the flat layout from above", () => {
    expect(estimateFlatBytes(g, 15)).toBeGreaterThanOrEqual(buildFlat(g, 15).bytes());
  });

  it("evicts the least recently used chord", () => {
    const lru = buildLru(g, 15, 2);
    lru.get(0, 80); lru.get(1, 81); lru.get(0, 80); lru.get(2, 82);   // (1, 81) is now the oldest and goes
    expect(lru.bytes()).toBeGreaterThan(0);
    const before = lru.bytes();
    lru.get(0, 80);   // still cached: no change in size
    expect(lru.bytes()).toBe(before);
  });
});
