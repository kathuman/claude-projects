// CLAHE: contrast-limited adaptive histogram equalisation (Zuiderveld 1994), written from scratch.
//
// Plain histogram equalisation maps each grey level through the cumulative histogram, so the output levels are used
// evenly: contrast is stretched where many pixels share similar levels. Adaptive: the image is split into a grid of
// tiles (here 8 × 8) and each tile gets its own mapping, so a dark face on a light background is stretched within the
// face. Contrast-limited: before taking the cumulative sum, each tile's histogram is clipped at clip × (mean bin
// height) and the clipped excess is spread evenly over all bins. The slope of the mapping is proportional to the bin
// height, so this caps how much any level range is stretched — and so how much noise is amplified. With clip = 1 every
// bin is cut to the mean, the histogram becomes flat and the mapping is the identity; larger clips allow more
// stretching. To avoid seams, each pixel's output blends the mappings of the four nearest tile centres bilinearly.
//
// Values are processed on the perceptual (sRGB-encoded) scale with 256 bins, as in image editors. Only pixels inside
// the board circle (mask = 1) count towards the histograms, so the white border outside the circle does not skew
// them; pixels outside are passed through unchanged.

const BINS = 256;

/** Apply CLAHE to v ∈ [0, 1] (res × res). grid: tiles per side; clip: clip limit as a multiple of the mean bin. */
export function clahe(v: Float32Array, res: number, mask: Uint8Array, grid = 8, clip = 2): Float32Array {
  const tile = res / grid, maps = new Float32Array(grid * grid * BINS);
  const hist = new Float64Array(BINS);
  for (let ty = 0; ty < grid; ty++) {
    for (let tx = 0; tx < grid; tx++) {
      hist.fill(0);
      let n = 0;
      const y0 = Math.floor(ty * tile), y1 = Math.floor((ty + 1) * tile), x0 = Math.floor(tx * tile), x1 = Math.floor((tx + 1) * tile);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const p = y * res + x;
        if (!mask[p]) continue;
        hist[Math.min(BINS - 1, Math.max(0, Math.round(v[p] * (BINS - 1))))]++;
        n++;
      }
      const m = (ty * grid + tx) * BINS;
      if (n === 0) { for (let b = 0; b < BINS; b++) maps[m + b] = b / (BINS - 1); continue; }
      // clip and share the excess equally, repeating until no bin is above the limit (sharing can push a bin that was
      // just at the limit over it again). The total stays n; with clip = 1 this converges to a flat histogram.
      const limit = Math.max(1, clip) * (n / BINS);
      for (let it = 0; it < 64; it++) {
        let excess = 0;
        for (let b = 0; b < BINS; b++) if (hist[b] > limit) { excess += hist[b] - limit; hist[b] = limit; }
        if (excess <= 1e-9 * n) break;
        const share = excess / BINS;
        for (let b = 0; b < BINS; b++) hist[b] += share;
      }
      // mapping: the cumulative histogram at the middle of each bin, so a flat histogram maps b to b
      let cum = 0;
      for (let b = 0; b < BINS; b++) {
        maps[m + b] = (cum + hist[b] / 2) / n;
        cum += hist[b];
      }
    }
  }
  const out = new Float32Array(v.length);
  for (let y = 0; y < res; y++) {
    // position relative to the tile centres: between centre ty0 and ty0 + 1, weight wy towards the latter
    const gy = (y + 0.5) / tile - 0.5, ty0 = Math.max(0, Math.min(grid - 1, Math.floor(gy))), ty1 = Math.min(grid - 1, ty0 + 1);
    const wy = Math.max(0, Math.min(1, gy - ty0));
    for (let x = 0; x < res; x++) {
      const p = y * res + x;
      if (!mask[p]) { out[p] = v[p]; continue; }
      const gx = (x + 0.5) / tile - 0.5, tx0 = Math.max(0, Math.min(grid - 1, Math.floor(gx))), tx1 = Math.min(grid - 1, tx0 + 1);
      const wx = Math.max(0, Math.min(1, gx - tx0));
      const b = Math.min(BINS - 1, Math.max(0, Math.round(v[p] * (BINS - 1))));
      const f = (tx: number, ty: number) => maps[(ty * grid + tx) * BINS + b];
      out[p] = (1 - wy) * ((1 - wx) * f(tx0, ty0) + wx * f(tx1, ty0)) + wy * ((1 - wx) * f(tx0, ty1) + wx * f(tx1, ty1));
    }
  }
  return out;
}
