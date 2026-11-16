// Performance benchmark: the spec's target problem, N = 240, K = 3000, working resolution 700, must finish in under
// 30 s. Measured and logged; the assertion leaves headroom for slow CI machines (Node is close to Chrome's V8).
import { describe, expect, it } from "vitest";
import { GreedySolver } from "../src/core/greedy";
import { makeGeometry } from "../src/core/geometry";
import { computeMetrics } from "../src/core/metrics";
import { DEFAULT_PARAMS } from "../src/core/solver";
import { portraitTarget } from "./helpers";

describe("benchmark", () => {
  it("solves N=240, K=3000 at 700 px", async () => {
    const res = 700, T = portraitTarget(res), P = { ...DEFAULT_PARAMS, epsilon: -Infinity };
    const heap0 = process.memoryUsage().heapUsed;
    let peak = 0;
    const r = await new GreedySolver().run({ target: T, weights: null, res }, P, {
      onProgress: () => { peak = Math.max(peak, process.memoryUsage().rss); },
      log: (m) => console.log(m)
    });
    const m = computeMetrics(T, r.simulated, makeGeometry(P.nails, res, P.marginPx), r.passes[0].sequence, P.boardMm, r.stats.ms);
    const blank = computeMetrics(T, new Float64Array(res * res), makeGeometry(P.nails, res, P.marginPx), new Uint16Array([0]), P.boardMm, 0);
    console.log(`benchmark: blank board RMSE ${blank.rmse.toFixed(4)} SSIM ${blank.ssim.toFixed(4)}; ` +
      `mean darkness target ${(T.reduce((a, b) => a + b, 0) / T.length).toFixed(3)}, thread ${(r.simulated.reduce((a, b) => a + b, 0) / T.length).toFixed(3)}`);
    console.log(`benchmark: ${r.stats.steps} lines in ${(r.stats.ms / 1000).toFixed(2)} s, cache ${r.stats.cacheMode} ` +
      `${(r.stats.cacheBytes / 1e6).toFixed(1)} MB, peak RSS ${(peak / 1e6).toFixed(0)} MB (heap at start ${(heap0 / 1e6).toFixed(0)} MB), ` +
      `RMSE ${m.rmse.toFixed(4)}, SSIM ${m.ssim.toFixed(4)}, thread ${m.threadM.toFixed(0)} m + ${m.slackM.toFixed(0)} m slack`);
    expect(r.stats.steps).toBe(3000);
    expect(r.stats.ms).toBeLessThan(30_000);
    expect(peak).toBeLessThan(500e6);
  });
});
