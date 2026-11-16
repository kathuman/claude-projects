// The greedy solver: from the current nail, take the chord that most reduces the (importance-weighted) squared error
// between the target darkness T and the simulated darkness C, wind it, and repeat from its far end.
//
// Why greedy works here: with the multiplicative darkness model each pass changes C only along one chord, so the error
// reduction of every candidate can be computed exactly and cheaply (darkness.ts: Σ W·d·(2(T−C) − d)). Choosing the
// best next chord is a steepest-descent step restricted to the moves a single continuous thread can make. It is not
// globally optimal, but it is the standard method for this problem and gives recognisable portraits at a few thousand
// chords.
//
// Determinism: candidates are scanned in increasing nail order and a candidate replaces the best only if its score is
// strictly greater, so ties go to the lowest nail; sums are accumulated in Float64 in a fixed order; the chord
// rasterisations are identical in every engine (geometry.ts). Same target + same parameters ⇒ same sequence.

import { circleMask, isValidChord, makeGeometry, pairKey } from "./geometry";
import { applyChord, chordGain, threadAlpha } from "./darkness";
import { createLineSource } from "./linecache";
import type { Solver, SolverControl, SolverInput, SolverParams, SolverResult, StopReason } from "./solver";
import { validateParams } from "./solver";

const defaultYield = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export class GreedySolver implements Solver {
  readonly id = "greedy";

  async run(input: SolverInput, params: SolverParams, ctl: SolverControl = {}): Promise<SolverResult> {
    validateParams(params);
    const t0 = performance.now();
    const { res, target: T } = input, P = params, n = P.nails;
    if (T.length !== res * res) throw new RangeError("target must be res × res");
    if (input.weights && input.weights.length !== res * res) throw new RangeError("weights must be res × res");

    const geom = makeGeometry(n, res, P.marginPx);
    const mask = circleMask(geom);
    // importance, zero outside the circle so those pixels never score
    const W = new Float32Array(res * res);
    for (let p = 0; p < W.length; p++) W[p] = mask[p] ? (input.weights ? input.weights[p] : 1) : 0;

    const lines = createLineSource(geom, P.minSkip, P.cacheBudgetBytes, ctl.log);
    const alpha = threadAlpha(P.threadMm, P.boardMm, res, P.darkness);
    const C = new Float64Array(res * res);
    const used = new Uint16Array(n * n);              // passes per unordered chord {i, j}
    const seq = new Uint16Array(P.maxLines + 1);
    seq[0] = P.startNail;

    // running squared error inside the circle, kept up to date as chords are applied, for progress reports
    let inside = 0, sse = 0;
    for (let p = 0; p < T.length; p++) if (mask[p]) { inside++; sse += T[p] * T[p]; }
    const rmse = () => Math.sqrt(Math.max(0, sse) / inside);

    const yieldFn = ctl.yieldFn ?? defaultYield;
    let a = P.startNail, steps = 0, below = 0, runStart = 0, stopReason: StopReason = "maxLines";
    let pending: number[] = [];

    while (steps < P.maxLines) {
      let best = -Infinity, bestB = -1;
      for (let b = 0; b < n; b++) {
        if (!isValidChord(a, b, n, P.minSkip) || used[pairKey(a, b, n)] >= P.maxReuse) continue;
        const ch = lines.get(a, b)!;
        let s = chordGain(T, C, W, ch, alpha);
        if (P.beta > 0) s /= Math.pow(ch.lenPx, P.beta);
        if (s > best) { best = s; bestB = b; }
      }
      if (bestB < 0) { stopReason = "noCandidate"; break; }

      // apply the chosen chord, updating the running error on its pixels: Δsse = Σ (T−C_new)² − (T−C)²
      const ch = lines.get(a, bestB)!;
      for (let e = ch.start; e < ch.end; e++) { const p = ch.idx[e]; if (mask[p]) sse -= (T[p] - C[p]) * (T[p] - C[p]); }
      applyChord(C, ch, alpha);
      for (let e = ch.start; e < ch.end; e++) { const p = ch.idx[e]; if (mask[p]) sse += (T[p] - C[p]) * (T[p] - C[p]); }

      used[pairKey(a, bestB, n)]++;
      pending.push(a, bestB);
      steps++;
      seq[steps] = bestB;
      a = bestB;

      if (best < P.epsilon) { if (below++ === 0) runStart = steps; if (below >= P.patience) stopReason = "converged"; } else below = 0;
      const last = stopReason === "converged" || steps === P.maxLines;
      if (steps % P.progressEvery === 0 || last) {
        ctl.onProgress?.({ step: steps, rmse: rmse(), newChords: Uint16Array.from(pending) });
        pending = [];
        if (last) break;
        await yieldFn();
        if (ctl.waitWhilePaused) await ctl.waitWhilePaused();
        if (ctl.signal?.aborted) { stopReason = "cancelled"; break; }
      }
    }
    if (pending.length) ctl.onProgress?.({ step: steps, rmse: rmse(), newChords: Uint16Array.from(pending) });

    // On convergence the last `patience` chords all scored below ε: each made the picture no better (with ε = 0, worse).
    // Drop that trailing run and rebuild C by replaying the chords kept (cheap: one pass over their pixels).
    if (stopReason === "converged") {
      steps = runStart - 1;
      C.fill(0);
      for (let s = 1; s <= steps; s++) applyChord(C, lines.get(seq[s - 1], seq[s])!, alpha);
    }

    return {
      solver: this.id,
      passes: [{ colour: "#000000", sequence: seq.slice(0, steps + 1) }],
      simulated: C,
      stats: { steps, ms: performance.now() - t0, stopReason, cacheMode: lines.mode, cacheBytes: lines.bytes(), alpha }
    };
  }
}
