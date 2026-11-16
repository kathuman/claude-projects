// The solver worker: runs one solve at a time off the main thread, reporting progress and honouring pause, resume and
// cancel. The solver yields every `progressEvery` steps, which is when this worker's onmessage gets a chance to run.

/// <reference lib="webworker" />
import { GreedySolver } from "../core/greedy";
import { makeGeometry } from "../core/geometry";
import { computeMetrics } from "../core/metrics";
import type { Solver } from "../core/solver";
import type { FromWorker, ToWorker } from "./protocol";

const SOLVERS: Record<string, () => Solver> = { greedy: () => new GreedySolver() };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: FromWorker, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

let current: { jobId: number; abort: AbortController; paused: boolean; release: (() => void) | null } | null = null;

scope.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type !== "start") {
    if (!current || current.jobId !== msg.jobId) return;
    if (msg.type === "cancel") { current.abort.abort(); current.release?.(); current.release = null; current.paused = false; }
    else if (msg.type === "pause") { current.paused = true; }
    else if (msg.type === "resume") { current.paused = false; current.release?.(); current.release = null; post({ type: "resumed", jobId: msg.jobId }); }
    return;
  }

  // a new start replaces any running job
  if (current) { current.abort.abort(); current.release?.(); }
  const job = { jobId: msg.jobId, abort: new AbortController(), paused: false, release: null as (() => void) | null };
  current = job;
  try {
    const make = SOLVERS[msg.solver];
    if (!make) throw new Error(`unknown solver ${msg.solver}`);
    const solver = make();
    const result = await solver.run({ target: msg.target, weights: msg.weights, res: msg.res }, msg.params, {
      signal: job.abort.signal,
      log: (message) => post({ type: "log", jobId: job.jobId, message }),
      onProgress: (progress) => post({ type: "progress", jobId: job.jobId, progress }, [progress.newChords.buffer]),
      waitWhilePaused: () => {
        if (!job.paused || job.abort.signal.aborted) return Promise.resolve();
        post({ type: "paused", jobId: job.jobId });
        return new Promise<void>((r) => { job.release = r; });
      }
    });
    const pass = result.passes[0];
    const geom = makeGeometry(msg.params.nails, msg.res, msg.params.marginPx);
    const metrics = computeMetrics(msg.target, result.simulated, geom, pass.sequence, msg.params.boardMm, result.stats.ms);
    const simulated = Float32Array.from(result.simulated);
    const sequences = result.passes.map((p) => ({ colour: p.colour, sequence: p.sequence, connector: p.connector }));
    post({
      type: "done", jobId: job.jobId,
      result: { sequences, simulated, stopReason: result.stats.stopReason, steps: result.stats.steps, ms: result.stats.ms,
        cacheMode: result.stats.cacheMode, cacheBytes: result.stats.cacheBytes, metrics }
    }, [simulated.buffer, ...sequences.map((s) => s.sequence.buffer)]);
  } catch (e) {
    post({ type: "error", jobId: job.jobId, message: e instanceof Error ? e.message : String(e) });
  } finally {
    if (current === job) current = null;
  }
};
