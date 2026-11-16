// Shared test helpers: synthetic targets made with the solver's own darkness model, and quick parameter sets.
import { makeGeometry } from "../src/core/geometry";
import { applyChord, threadAlpha } from "../src/core/darkness";
import { buildLru } from "../src/core/linecache";
import { DEFAULT_PARAMS, type SolverParams } from "../src/core/solver";

/** Parameters for a small, fast problem. */
export function smallParams(over: Partial<SolverParams> = {}): SolverParams {
  return { ...DEFAULT_PARAMS, nails: 120, minSkip: 10, maxLines: 200, boardMm: 300, ...over };
}

/** A target that is exactly what winding the given chords (once each) would produce. */
export function chordTarget(res: number, params: SolverParams, chords: [number, number][]): Float32Array {
  const geom = makeGeometry(params.nails, res, params.marginPx);
  const lines = buildLru(geom, params.minSkip, 64);
  const alpha = threadAlpha(params.threadMm, params.boardMm, res, params.darkness);
  const C = new Float64Array(res * res);
  for (const [a, b] of chords) applyChord(C, lines.get(a, b)!, alpha);
  return Float32Array.from(C);
}

/** A deterministic portrait-like test image: a dark head on a light ground, darker eyes and mouth, a shaded side. */
export function portraitTarget(res: number): Float32Array {
  const T = new Float32Array(res * res), c = res / 2, R = res / 2 - 2;
  const ell = (x: number, y: number, ex: number, ey: number, rx: number, ry: number) => ((x - ex) / rx) ** 2 + ((y - ey) / ry) ** 2;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      if ((x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 > R * R) continue;
      const u = x / res, v = y / res;
      let t = 0.08 + 0.1 * v;                                                      // background, slightly darker below
      if (ell(u, v, 0.5, 0.48, 0.24, 0.31) < 1) t = 0.3 + 0.25 * Math.max(0, u - 0.5) * 2;   // face, shaded right side
      if (ell(u, v, 0.5, 0.2, 0.27, 0.13) < 1) t = 0.85;                                     // hair
      if (ell(u, v, 0.41, 0.43, 0.045, 0.025) < 1 || ell(u, v, 0.59, 0.43, 0.045, 0.025) < 1) t = 0.95;   // eyes
      if (ell(u, v, 0.5, 0.64, 0.08, 0.02) < 1) t = 0.7;                                     // mouth
      if (ell(u, v, 0.5, 0.95, 0.4, 0.15) < 1) t = 0.6;                                      // shoulders
      T[y * res + x] = t;
    }
  }
  return T;
}
