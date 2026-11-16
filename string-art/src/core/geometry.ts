// Nail geometry on the circular frame, in working-image pixels.
//
// Pixel (x, y) covers [x, x+1) × [y, y+1); its centre is (x + ½, y + ½). The image is res × res and the nail circle is
// centred on the image with radius R = res/2 − margin. Nail i sits at angle θᵢ = −π/2 + 2πi/N. In image coordinates
// (y pointing down) θ = −π/2 is straight up, and increasing θ turns clockwise on screen, so nail 0 is at 12 o'clock and
// the numbering runs clockwise, as on the physical board seen from the front.
//
// Determinism: Math.sin/Math.cos are not required by ECMAScript to be correctly rounded, so two browsers can differ in
// the last bit. Every coordinate is rounded to a multiple of 1/1024 px, which absorbs any such difference (the error
// of a last-bit discrepancy is ~1e-13 px, far below the 1/2048 rounding threshold except on a measure-zero set), so the
// rasterised chords — and therefore the whole solve — are identical in every engine.

export const COORD_QUANTUM = 1024;
export const quantize = (v: number): number => Math.round(v * COORD_QUANTUM) / COORD_QUANTUM;

export interface Geometry {
  readonly nails: number;
  readonly res: number;
  readonly radius: number;
  readonly cx: number;
  readonly cy: number;
  /** nail x coordinates, px (Float64 so they are exact multiples of 1/1024) */
  readonly xs: Float64Array;
  /** nail y coordinates, px */
  readonly ys: Float64Array;
}

/** The angle of nail i, radians, in image coordinates (y down): −π/2 is the top, increasing clockwise on screen. */
export function nailAngle(i: number, nails: number): number {
  return -Math.PI / 2 + (2 * Math.PI * i) / nails;
}

export function makeGeometry(nails: number, res: number, marginPx = 2): Geometry {
  if (!Number.isInteger(nails) || nails < 3) throw new RangeError("nails must be an integer ≥ 3");
  if (!Number.isInteger(res) || res < 16) throw new RangeError("res must be an integer ≥ 16");
  const cx = res / 2, cy = res / 2, radius = res / 2 - marginPx;
  const xs = new Float64Array(nails), ys = new Float64Array(nails);
  for (let i = 0; i < nails; i++) {
    const t = nailAngle(i, nails);
    xs[i] = quantize(cx + radius * Math.cos(t));
    ys[i] = quantize(cy + radius * Math.sin(t));
  }
  return { nails, res, radius, cx, cy, xs, ys };
}

/** Index distance between two nails around the circle (0 … N/2). */
export function nailDistance(i: number, j: number, nails: number): number {
  const d = Math.abs(i - j) % nails;
  return Math.min(d, nails - d);
}

/** A chord is allowed if its ends are different nails at least minSkip apart around the circle. */
export function isValidChord(i: number, j: number, nails: number, minSkip: number): boolean {
  return i !== j && nailDistance(i, j, nails) >= minSkip;
}

/** Physical chord length in mm on a board whose nail circle has diameter boardMm: a chord subtending Δθ has length
 *  D·sin(Δθ/2), and Δθ = 2π·d/N. */
export function chordLengthMm(i: number, j: number, nails: number, boardMm: number): number {
  return boardMm * Math.sin((Math.PI * nailDistance(i, j, nails)) / nails);
}

/** Canonical key of the unordered pair {i, j}: min·N + max. */
export function pairKey(i: number, j: number, nails: number): number {
  return i < j ? i * nails + j : j * nails + i;
}

/** Number of valid unordered chords: each nail has N − 1 − 2(minSkip − 1) valid partners (all but itself and the
 *  minSkip − 1 nearest on each side), counted once per pair. */
export function validChordCount(nails: number, minSkip: number): number {
  let n = 0;
  for (let j = 1; j < nails; j++) if (isValidChord(0, j, nails, minSkip)) n++;
  return (nails * n) / 2;
}

/** 1 for pixels whose centre lies on or inside the nail circle (plus half a pixel), 0 outside. Only these are scored. */
export function circleMask(geom: Geometry): Uint8Array {
  const { res, cx, cy, radius } = geom, m = new Uint8Array(res * res), r2 = (radius + 0.5) * (radius + 0.5);
  for (let y = 0; y < res; y++) {
    const dy = y + 0.5 - cy;
    for (let x = 0; x < res; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) m[y * res + x] = 1;
    }
  }
  return m;
}
