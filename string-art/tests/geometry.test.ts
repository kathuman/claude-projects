import { describe, expect, it } from "vitest";
import { chordLengthMm, circleMask, isValidChord, makeGeometry, nailAngle, nailDistance, pairKey, validChordCount } from "../src/core/geometry";

describe("nail geometry", () => {
  const g = makeGeometry(240, 700, 2);

  it("has N nails on a circle of radius res/2 − margin", () => {
    expect(g.xs.length).toBe(240);
    expect(g.radius).toBe(348);
    for (let i = 0; i < 240; i++) expect(Math.hypot(g.xs[i] - g.cx, g.ys[i] - g.cy)).toBeCloseTo(348, 2);
  });

  it("puts nail 0 at the top (12 o'clock)", () => {
    expect(g.xs[0]).toBeCloseTo(g.cx, 6);
    expect(g.ys[0]).toBeCloseTo(g.cy - g.radius, 6);
  });

  it("numbers the nails clockwise as seen on screen (y down)", () => {
    // a quarter of the way round is 3 o'clock, half is 6 o'clock, three quarters 9 o'clock
    expect([g.xs[60], g.ys[60]]).toEqual([expect.closeTo(g.cx + 348, 3), expect.closeTo(g.cy, 3)]);
    expect([g.xs[120], g.ys[120]]).toEqual([expect.closeTo(g.cx, 3), expect.closeTo(g.cy + 348, 3)]);
    expect([g.xs[180], g.ys[180]]).toEqual([expect.closeTo(g.cx - 348, 3), expect.closeTo(g.cy, 3)]);
    // the screen-space cross product of consecutive radius vectors is positive everywhere: clockwise with y down
    for (let i = 0; i < 240; i++) {
      const j = (i + 1) % 240;
      const cross = (g.xs[i] - g.cx) * (g.ys[j] - g.cy) - (g.ys[i] - g.cy) * (g.xs[j] - g.cx);
      expect(cross).toBeGreaterThan(0);
    }
  });

  it("spaces the angles evenly from −π/2", () => {
    expect(nailAngle(0, 240)).toBeCloseTo(-Math.PI / 2, 12);
    for (let i = 1; i < 240; i++) expect(nailAngle(i, 240) - nailAngle(i - 1, 240)).toBeCloseTo((2 * Math.PI) / 240, 12);
  });

  it("rounds coordinates to 1/1024 px so every engine gets the same chords", () => {
    for (let i = 0; i < 240; i++) {
      expect(Number.isInteger(g.xs[i] * 1024)).toBe(true);
      expect(Number.isInteger(g.ys[i] * 1024)).toBe(true);
    }
  });

  it("measures index distance around the circle and enforces the minimum skip", () => {
    expect(nailDistance(0, 239, 240)).toBe(1);
    expect(nailDistance(10, 130, 240)).toBe(120);
    expect(isValidChord(0, 19, 240, 20)).toBe(false);
    expect(isValidChord(0, 20, 240, 20)).toBe(true);
    expect(isValidChord(0, 221, 240, 20)).toBe(false);
    expect(isValidChord(0, 220, 240, 20)).toBe(true);
    expect(isValidChord(5, 5, 240, 1)).toBe(false);
    expect(validChordCount(240, 20)).toBe((240 * 201) / 2);
  });

  it("gives chord lengths D·sin(πd/N): a diameter is the board diameter", () => {
    expect(chordLengthMm(0, 120, 240, 600)).toBeCloseTo(600, 9);
    expect(chordLengthMm(0, 60, 240, 600)).toBeCloseTo(600 * Math.SQRT1_2, 9);
    expect(chordLengthMm(3, 70, 240, 600)).toBeCloseTo(chordLengthMm(70, 3, 240, 600), 12);
  });

  it("keys unordered pairs canonically", () => {
    expect(pairKey(3, 70, 240)).toBe(pairKey(70, 3, 240));
    expect(pairKey(3, 70, 240)).toBe(3 * 240 + 70);
  });

  it("masks the pixels inside the circle", () => {
    const m = circleMask(g);
    expect(m[350 * 700 + 350]).toBe(1);
    expect(m[0]).toBe(0);
    const inside = m.reduce((s, v) => s + v, 0);
    expect(inside / (Math.PI * 348.5 * 348.5)).toBeCloseTo(1, 2);
  });
});
