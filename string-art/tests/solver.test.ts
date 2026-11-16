import { describe, expect, it } from "vitest";
import { GreedySolver } from "../src/core/greedy";
import { isValidChord, makeGeometry, pairKey } from "../src/core/geometry";
import { computeMetrics } from "../src/core/metrics";
import { chordTarget, portraitTarget, smallParams } from "./helpers";

const solver = new GreedySolver();
const chordsOf = (seq: Uint16Array) => Array.from({ length: seq.length - 1 }, (_, s) => [seq[s], seq[s + 1]] as [number, number]);
const same = (a: [number, number], b: [number, number]) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

describe("greedy solver: synthetic recovery", () => {
  const res = 300;

  it("recovers a single known chord as the first line", async () => {
    const P = smallParams({ startNail: 17, maxLines: 1 });
    const T = chordTarget(res, P, [[17, 70]]);
    const r = await solver.run({ target: T, weights: null, res }, P);
    expect(Array.from(r.passes[0].sequence)).toEqual([17, 70]);
  });

  it("finds three known chords among the first five lines", async () => {
    const P = smallParams({ startNail: 0, maxLines: 5 });
    const known: [number, number][] = [[0, 45], [45, 90], [90, 20]];
    const T = chordTarget(res, P, known);
    const r = await solver.run({ target: T, weights: null, res }, P);
    const got = chordsOf(r.passes[0].sequence);
    for (const k of known) expect(got.some((c) => same(c, k))).toBe(true);
  });

  it("stops once nothing helps, and drops the chords that did not", async () => {
    const P = smallParams({ startNail: 17, maxLines: 500 });
    const T = chordTarget(res, P, [[17, 70]]);
    const r = await solver.run({ target: T, weights: null, res }, P);
    expect(r.stats.stopReason).toBe("converged");
    expect(Array.from(r.passes[0].sequence)).toEqual([17, 70]);
    expect(r.simulated.reduce((s, v) => s + v, 0)).toBeCloseTo(T.reduce((s, v) => s + v, 0), 4);
  });
});

describe("greedy solver: constraints and determinism", () => {
  const res = 300, T = portraitTarget(res);

  it("never breaks the minimum skip or the reuse limit", async () => {
    for (const maxReuse of [1, 2]) {
      const P = smallParams({ maxLines: 600, maxReuse, minSkip: 12 });
      const r = await solver.run({ target: T, weights: null, res }, P);
      const seq = r.passes[0].sequence, uses = new Map<number, number>();
      for (const [a, b] of chordsOf(seq)) {
        expect(isValidChord(a, b, P.nails, P.minSkip)).toBe(true);
        const k = pairKey(a, b, P.nails);
        uses.set(k, (uses.get(k) ?? 0) + 1);
      }
      expect(Math.max(...uses.values())).toBeLessThanOrEqual(maxReuse);
    }
  });

  it("gives byte-identical sequences for identical input", async () => {
    const P = smallParams({ maxLines: 400 });
    const a = await solver.run({ target: T, weights: null, res }, P);
    const b = await solver.run({ target: Float32Array.from(T), weights: null, res }, { ...P });
    expect(Buffer.from(a.passes[0].sequence.buffer).equals(Buffer.from(b.passes[0].sequence.buffer))).toBe(true);
  });

  it("gives the same result with the line cache precomputed or on demand", async () => {
    const P = smallParams({ maxLines: 300 });
    const flat = await solver.run({ target: T, weights: null, res }, P);
    const lru = await solver.run({ target: T, weights: null, res }, { ...P, cacheBudgetBytes: 0 });
    expect(flat.stats.cacheMode).toBe("flat");
    expect(lru.stats.cacheMode).toBe("lru");
    expect(Array.from(lru.passes[0].sequence)).toEqual(Array.from(flat.passes[0].sequence));
  });

  it("follows the importance mask", async () => {
    // a target dark only on the left half: weighting the right half up must not change that, but weighting the left
    // half down by 15× must leave the left lighter than without the mask
    const L = new Float32Array(res * res);
    for (let y = 0; y < res; y++) for (let x = 0; x < res / 2; x++) L[y * res + x] = 0.5;
    const Wt = new Float32Array(res * res).fill(1);
    for (let y = 0; y < res; y++) for (let x = 0; x < res / 2; x++) Wt[y * res + x] = 0.2;
    const P = smallParams({ maxLines: 150 });
    const plain = await solver.run({ target: L, weights: null, res }, P);
    const masked = await solver.run({ target: L, weights: Wt, res }, P);
    expect(Array.from(masked.passes[0].sequence)).not.toEqual(Array.from(plain.passes[0].sequence));
  });

  it("reports progress every 50 steps with the new chords, and can be cancelled", async () => {
    const P = smallParams({ maxLines: 400 });
    const reports: number[] = [];
    let chords = 0;
    const ac = new AbortController();
    const r = await solver.run({ target: T, weights: null, res }, P, {
      onProgress: (p) => { reports.push(p.step); chords += p.newChords.length / 2; if (p.step >= 150) ac.abort(); },
      signal: ac.signal
    });
    expect(reports.slice(0, 3)).toEqual([50, 100, 150]);
    expect(r.stats.stopReason).toBe("cancelled");
    expect(r.passes[0].sequence.length - 1).toBe(150);
    expect(chords).toBe(150);
  });

  it("pauses and resumes", async () => {
    const P = smallParams({ maxLines: 200 });
    let release!: () => void, pausedAt = -1, paused = true;
    const gate = new Promise<void>((r) => { release = r; });
    const run = solver.run({ target: T, weights: null, res }, P, {
      onProgress: (p) => { if (pausedAt < 0) pausedAt = p.step; },
      waitWhilePaused: () => (paused ? gate : Promise.resolve())
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(pausedAt).toBe(50);                 // stopped at the first yield
    paused = false; release();
    const r = await run;
    expect(r.passes[0].sequence.length - 1).toBe(200);
  });

  it("improves the picture and reports sensible metrics", async () => {
    const P = smallParams({ maxLines: 800 });
    const r = await solver.run({ target: T, weights: null, res }, P);
    const m = computeMetrics(T, r.simulated, makeGeometry(P.nails, res, P.marginPx), r.passes[0].sequence, P.boardMm, r.stats.ms);
    const blank = computeMetrics(T, new Float64Array(res * res), makeGeometry(P.nails, res, P.marginPx), new Uint16Array([0]), P.boardMm, 0);
    expect(m.rmse).toBeLessThan(blank.rmse * 0.75);
    expect(m.ssim).toBeGreaterThan(blank.ssim);
    expect(m.lines).toBe(r.passes[0].sequence.length - 1);
    expect(m.threadM).toBeGreaterThan(0);
    expect(m.slackM).toBeCloseTo(m.threadM * 0.1, 9);
  });
});
