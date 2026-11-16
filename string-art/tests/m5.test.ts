import { describe, expect, it } from "vitest";
import { clampPosition, threadingView } from "../src/core/threading";
import { KEYS, loadLast, loadParams, loadThreadPos, saveLast, saveParams, saveThreadPos, type StorageLike } from "../src/ui/store";
import { DEFAULT_UI, PRESETS } from "../src/ui/params";
import { validateParams } from "../src/core/solver";

const seq = Uint16Array.from([0, 57, 140, 22, 180, 61, 200, 99]);   // 7 lines

describe("threading mode", () => {
  it("starts at the start nail with the first line to wind", () => {
    const v = threadingView(seq, 0);
    expect(v).toMatchObject({ done: 0, total: 7, from: 0, to: 57, prev: [], next: [140, 22, 180], finished: false });
  });
  it("shows up to three nails before and after", () => {
    expect(threadingView(seq, 4)).toMatchObject({ from: 180, to: 61, prev: [57, 140, 22], next: [200, 99] });
  });
  it("finishes after the last line", () => {
    expect(threadingView(seq, 7)).toMatchObject({ done: 7, from: 99, to: null, next: [], finished: true });
  });
  it("clamps any position to the sequence", () => {
    expect(clampPosition(-3, 7)).toBe(0);
    expect(clampPosition(99, 7)).toBe(7);
    expect(clampPosition(Number.NaN, 7)).toBe(0);
    expect(threadingView(seq, 3.6).done).toBe(4);
  });
});

function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

describe("remembering settings and results", () => {
  it("round-trips the parameters, filling in parameters added later", () => {
    const s = fakeStorage();
    saveParams({ ...DEFAULT_UI, nails: 300 }, s);
    const stored = JSON.parse(s.data.get(KEYS.params)!); delete stored.beta; s.data.set(KEYS.params, JSON.stringify(stored));
    const p = loadParams(DEFAULT_UI, s);
    expect(p.nails).toBe(300);
    expect(p.beta).toBe(DEFAULT_UI.beta);
  });
  it("ignores damaged or blocked storage", () => {
    const s = fakeStorage();
    s.data.set(KEYS.params, "{not json");
    expect(loadParams(DEFAULT_UI, s)).toEqual(DEFAULT_UI);
    const blocked: StorageLike = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => {} };
    expect(saveParams(DEFAULT_UI, blocked)).toBe(false);
    expect(loadParams(DEFAULT_UI, blocked)).toEqual(DEFAULT_UI);
    expect(loadLast(blocked)).toBeNull();
    expect(loadThreadPos("x", blocked)).toBe(0);
  });
  it("round-trips the last result and rejects a sequence that does not fit the nails", () => {
    const s = fakeStorage();
    const r = { params: DEFAULT_UI, sequence: [0, 50, 100], metrics: { rmse: 0.1, ssim: 0.2, ssimSeen: 0.3, threadM: 1, slackM: 0.1, lines: 2, ms: 5 },
      stopReason: "converged" as const, cacheMode: "flat" as const, cacheBytes: 1, sourceName: "x.jpg" };
    saveLast(r, s);
    expect(loadLast(s)).toEqual(r);
    saveLast({ ...r, sequence: [0, 999] }, s);
    expect(loadLast(s)).toBeNull();
  });
  it("remembers the winding position per sequence", () => {
    const s = fakeStorage();
    saveThreadPos("abc", 42, s);
    expect(loadThreadPos("abc", s)).toBe(42);
    expect(loadThreadPos("other", s)).toBe(0);
  });
});

describe("presets", () => {
  it("are valid solver parameters within the app's ranges", () => {
    for (const pr of PRESETS) {
      const p = { ...DEFAULT_UI, ...pr.values };
      const { workingRes, ...sp } = p;
      expect(() => validateParams(sp)).not.toThrow();
      expect(p.nails).toBeGreaterThanOrEqual(100); expect(p.nails).toBeLessThanOrEqual(400);
      expect(p.maxLines).toBeGreaterThanOrEqual(500); expect(p.maxLines).toBeLessThanOrEqual(8000);
      expect(workingRes).toBeGreaterThanOrEqual(400); expect(workingRes).toBeLessThanOrEqual(1200);
      expect(p.darkness).toBeGreaterThanOrEqual(0.3); expect(p.darkness).toBeLessThanOrEqual(2);
    }
  });
});
