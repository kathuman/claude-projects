// The messages between the page and the solver worker, as discriminated unions on `type`. Every message after `start`
// carries the jobId, so a late message from a cancelled run can never be mistaken for one from the current run.
// Large arrays are transferred, not copied.

import type { Progress, SolverParams, StopReason } from "../core/solver";
import type { Metrics } from "../core/metrics";

export type ToWorker =
  | { type: "start"; jobId: number; solver: string; target: Float32Array; weights: Float32Array | null; res: number; params: SolverParams }
  | { type: "pause"; jobId: number }
  | { type: "resume"; jobId: number }
  | { type: "cancel"; jobId: number };

export interface DoneResult {
  /** one sequence per thread colour (the greedy solver has one) */
  sequences: { colour: string; sequence: Uint16Array; connector?: Uint8Array }[];
  simulated: Float32Array;
  stopReason: StopReason;
  steps: number;
  ms: number;
  cacheMode: "flat" | "lru";
  cacheBytes: number;
  metrics: Metrics;
}

export type FromWorker =
  | { type: "log"; jobId: number; message: string }
  | { type: "progress"; jobId: number; progress: Progress }
  | { type: "paused"; jobId: number }
  | { type: "resumed"; jobId: number }
  | { type: "done"; jobId: number; result: DoneResult }
  | { type: "error"; jobId: number; message: string };
