// Xiaolin Wu anti-aliased line rasterisation.
//
// Wu's algorithm walks the line along its major axis one pixel column (or row) at a time. At each step the exact line
// position y(x) falls between two pixel centres ⌊y⌋ and ⌊y⌋+1; it gives them weights 1 − frac(y) and frac(y). This is
// linear interpolation of a 1-px-wide box filter: the two weights in a column always sum to 1, i.e. the column receives
// exactly one pixel of "ink" spread over the two pixels the line passes between.
//
// Coverage correction. A thread of width 1 px crossing a column at angle φ to the major axis covers 1/cos φ pixels of
// that column, not 1: the line's area is L·1, while Σw = Δmajor = L·cos φ. We keep the Wu weights themselves in (0, 1]
// (as the spec asks) and return k = L / Δmajor ∈ [1, √2] alongside, so the darkness model can scale its per-pass
// opacity by k and put the physically right amount of thread on diagonal chords.
//
// Symmetry. Before walking, the endpoints are put in a canonical order (swap axes if steep, then order by x). The walk
// is then identical for (a, b) and (b, a), so the two give bit-identical results. Output is sorted by pixel index, which
// also helps cache locality in the solver's inner loop.

export interface Raster {
  /** linear pixel indices y·res + x, ascending, unique */
  idx: Uint32Array;
  /** Wu weights, each in (0, 1] */
  w: Float32Array;
  /** Euclidean length of the segment, px */
  length: number;
  /** coverage correction k = length / major-axis extent (1 … √2) */
  k: number;
}

const fpart = (v: number): number => v - Math.floor(v);
const rfpart = (v: number): number => 1 - fpart(v);
const MIN_WEIGHT = 1e-6;

/**
 * Rasterise the segment from (x0, y0) to (x1, y1), given in pixel coordinates where pixel (x, y) covers
 * [x, x+1) × [y, y+1). Pixels outside [0, res)² are dropped.
 */
export function wuLine(x0: number, y0: number, x1: number, y1: number, res: number): Raster {
  const length = Math.hypot(x1 - x0, y1 - y0);
  // Wu works with pixel centres on integer coordinates: shift by −½.
  let ax = x0 - 0.5, ay = y0 - 0.5, bx = x1 - 0.5, by = y1 - 0.5;
  const steep = Math.abs(by - ay) > Math.abs(bx - ax);
  if (steep) { [ax, ay] = [ay, ax]; [bx, by] = [by, bx]; }
  if (ax > bx || (ax === bx && ay > by)) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay]; }
  const dx = bx - ax, dy = by - ay, g = dx === 0 ? 0 : dy / dx;
  const major = dx;   // extent along the major axis, px

  const px: number[] = [], wt: number[] = [];
  const plot = (u: number, v: number, w: number): void => {
    if (w <= MIN_WEIGHT) return;
    const x = steep ? v : u, y = steep ? u : v;
    if (x < 0 || y < 0 || x >= res || y >= res) return;
    px.push(y * res + x); wt.push(w);
  };

  // first endpoint: the column nearest ax gets the share of the line that lies in it (xgap)
  let xend = Math.round(ax), yend = ay + g * (xend - ax), xgap = rfpart(ax + 0.5);
  const xs = xend;
  plot(xs, Math.floor(yend), rfpart(yend) * xgap);
  plot(xs, Math.floor(yend) + 1, fpart(yend) * xgap);
  let inter = yend + g;
  // second endpoint
  xend = Math.round(bx); yend = by + g * (xend - bx); xgap = fpart(bx + 0.5);
  const xe = xend;
  if (xe !== xs) {
    plot(xe, Math.floor(yend), rfpart(yend) * xgap);
    plot(xe, Math.floor(yend) + 1, fpart(yend) * xgap);
  }
  // the columns in between
  for (let x = xs + 1; x < xe; x++) {
    const fy = Math.floor(inter);
    plot(x, fy, rfpart(inter));
    plot(x, fy + 1, fpart(inter));
    inter += g;
  }

  // sort by pixel index and merge duplicates (possible only for very short segments), clamping to 1
  const order = px.map((_, i) => i).sort((a, b) => px[a] - px[b]);
  const idx: number[] = [], w: number[] = [];
  for (const o of order) {
    if (idx.length && idx[idx.length - 1] === px[o]) w[w.length - 1] = Math.min(1, w[w.length - 1] + wt[o]);
    else { idx.push(px[o]); w.push(Math.min(1, wt[o])); }
  }
  const k = major > 0 ? Math.min(Math.SQRT2, Math.max(1, length / major)) : 1;
  return { idx: Uint32Array.from(idx), w: Float32Array.from(w), length, k };
}
