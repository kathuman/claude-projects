// The solver interface. The UI and the worker only see these types, so other solvers can be added later without
// changing either:
//   - a multi-colour subtractive greedy solver returns one Pass per thread colour, each with its own sequence;
//   - a global solver (a sparse least-squares or L1 fit over chord weights, then routed into one path) returns one Pass
//     whose `connector` flags mark the chords added only to join the selected ones into a single thread.
// run() is asynchronous and cooperative: it yields every `progressEvery` steps so that pause, resume and cancel
// messages reach the worker, which cannot be interrupted otherwise.

export interface SolverInput {
  /** target darkness T ∈ [0, 1], res × res, row-major; 0 outside the circle */
  target: Float32Array;
  /** importance W ∈ [0.2, 3], res × res, or null for all 1 */
  weights: Float32Array | null;
  res: number;
}

export interface SolverParams {
  nails: number;            // N, 100–400
  maxLines: number;         // K, 500–8000
  minSkip: number;          // no chord between nails closer than this
  maxReuse: number;         // times one chord may be used
  startNail: number;
  boardMm: number;          // nail-circle diameter
  threadMm: number;         // thread diameter
  darkness: number;         // darkness factor, 0.3–2
  beta: number;             // length normalisation exponent, 0–1
  epsilon: number;          // stop when the best score stays below this …
  patience: number;         // … for this many consecutive steps
  progressEvery: number;    // steps between progress reports (and yields)
  marginPx: number;         // nail circle margin inside the image
  cacheBudgetBytes: number; // memory allowed for precomputed chords
}

export const DEFAULT_PARAMS: SolverParams = {
  nails: 240, maxLines: 3000, minSkip: 20, maxReuse: 1, startNail: 0,
  boardMm: 600, threadMm: 0.25, darkness: 1, beta: 0, epsilon: 0, patience: 20, progressEvery: 50,
  marginPx: 2, cacheBudgetBytes: 200e6
};

export interface Progress {
  step: number;
  /** RMSE between T and the simulated darkness inside the circle */
  rmse: number;
  /** the chords added since the last report, as [from, to, from, to, …] */
  newChords: Uint16Array;
}

export interface Pass {
  /** thread colour, CSS colour string */
  colour: string;
  /** nails visited in order: sequence[0] is the start nail; chord s joins sequence[s] and sequence[s + 1] */
  sequence: Uint16Array;
  /** for routed solvers: 1 where chord s is only a connector; absent when every chord is part of the picture */
  connector?: Uint8Array;
}

export type StopReason = "maxLines" | "converged" | "noCandidate" | "cancelled";

export interface SolverResult {
  solver: string;
  passes: Pass[];
  /** the simulated darkness C after the last chord, res × res */
  simulated: Float64Array;
  stats: { steps: number; ms: number; stopReason: StopReason; cacheMode: "flat" | "lru"; cacheBytes: number; alpha: number };
}

export interface SolverControl {
  onProgress?: (p: Progress) => void;
  /** aborting stops the solve at the next yield; the result then holds the chords chosen so far */
  signal?: AbortSignal;
  /** called at every yield; resolves when the solve may continue (used for pause) */
  waitWhilePaused?: () => Promise<void>;
  /** how to yield to the event loop; defaults to a zero-delay timeout */
  yieldFn?: () => Promise<void>;
  log?: (msg: string) => void;
}

export interface Solver {
  readonly id: string;
  run(input: SolverInput, params: SolverParams, ctl?: SolverControl): Promise<SolverResult>;
}

/** Throws a RangeError naming the first out-of-range parameter. */
export function validateParams(p: SolverParams): void {
  const check = (ok: boolean, msg: string) => { if (!ok) throw new RangeError(msg); };
  check(Number.isInteger(p.nails) && p.nails >= 3 && p.nails <= 65535, "nails out of range");
  check(Number.isInteger(p.maxLines) && p.maxLines >= 1, "maxLines must be a positive integer");
  check(Number.isInteger(p.minSkip) && p.minSkip >= 1 && p.minSkip <= Math.floor(p.nails / 2), "minSkip must be 1 … N/2");
  check(Number.isInteger(p.maxReuse) && p.maxReuse >= 1, "maxReuse must be ≥ 1");
  check(Number.isInteger(p.startNail) && p.startNail >= 0 && p.startNail < p.nails, "startNail must be a nail");
  check(p.boardMm > 0 && p.threadMm > 0 && p.darkness > 0, "board, thread and darkness must be positive");
  check(p.beta >= 0 && p.beta <= 1, "beta must be 0 … 1");
  check(Number.isInteger(p.patience) && p.patience >= 1 && Number.isInteger(p.progressEvery) && p.progressEvery >= 1, "patience and progressEvery must be ≥ 1");
}
