// The chords' rasterisations, either all precomputed in one flat buffer or computed on demand with an LRU cache.
//
// Precomputed layout ("flat"): every valid chord's pixels are stored back to back:
//   idx: Uint32Array  — pixel index (a 700×700 image has 490 000 pixels, more than 16 bits can address)
//   w:   Uint8Array   — Wu weight quantised to 1/255 (round(w·255), at least 1 so it stays in (0, 1])
//   start: Int32Array(N·N) — offset of chord {i, j} (key min·N + max), −1 for invalid chords
//   count: Uint32Array(N·N), k: Float32Array(N·N), lenPx: Float32Array(N·N)
// 5 bytes per entry. Quantising the weight to 8 bits changes it by at most 1/510, well below the effect of the 1-px
// pixel grid itself, and saves 3 bytes per entry against Float32.
//
// Memory estimate. Wu writes two pixels per major-axis step, and a chord between nails at index distance d spans
// about 2R·sin(πd/N)·max(|cos φ|, |sin φ|) along its major axis; the estimate below rasterises nothing, it adds up
// 2·(⌈major⌉ + 2) per valid chord (an upper bound). At N = 240, minSkip 20, 700 px that is ≈ 19 M entries ≈ 97 MB.
// If the estimate exceeds the budget, chords are rasterised when first needed and kept in an LRU cache instead; each
// solver step needs at most N − 1 chords from the current nail, so a cache of a few thousand chords hits often.

import { type Geometry, isValidChord, pairKey } from "./geometry";
import { wuLine } from "./wu";

export interface ChordView {
  idx: Uint32Array;
  w: Uint8Array;
  start: number;
  end: number;
  /** coverage correction (wu.ts) */
  k: number;
  /** length in px */
  lenPx: number;
}

export interface LineSource {
  readonly mode: "flat" | "lru";
  /** bytes held by the chord data (flat: the whole buffer; lru: the cache's current contents) */
  bytes(): number;
  /** the chord between nails i and j, or null if it is not a valid chord */
  get(i: number, j: number): ChordView | null;
}

export const ENTRY_BYTES = 5;

/** Upper bound on the bytes the flat layout would need. */
export function estimateFlatBytes(geom: Geometry, minSkip: number): number {
  const n = geom.nails;
  let entries = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!isValidChord(i, j, n, minSkip)) continue;
      const major = Math.max(Math.abs(geom.xs[j] - geom.xs[i]), Math.abs(geom.ys[j] - geom.ys[i]));
      entries += 2 * (Math.ceil(major) + 2);
    }
  }
  return entries * ENTRY_BYTES + n * n * (4 + 4 + 4 + 4);
}

function quantizeWeights(w: Float32Array): Uint8Array {
  const q = new Uint8Array(w.length);
  for (let e = 0; e < w.length; e++) q[e] = Math.max(1, Math.min(255, Math.round(w[e] * 255)));
  return q;
}

function rasterChord(geom: Geometry, i: number, j: number) {
  return wuLine(geom.xs[i], geom.ys[i], geom.xs[j], geom.ys[j], geom.res);
}

/** Precompute every valid chord into one flat buffer (two passes: count, then fill, so memory is allocated once). */
export function buildFlat(geom: Geometry, minSkip: number): LineSource {
  const n = geom.nails, nn = n * n;
  const start = new Int32Array(nn).fill(-1), count = new Uint32Array(nn), k = new Float32Array(nn), lenPx = new Float32Array(nn);
  let total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!isValidChord(i, j, n, minSkip)) continue;
      const r = rasterChord(geom, i, j), key = i * n + j;
      start[key] = total; count[key] = r.idx.length; k[key] = r.k; lenPx[key] = r.length;
      total += r.idx.length;
    }
  }
  const idx = new Uint32Array(total), w = new Uint8Array(total);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const key = i * n + j;
      if (start[key] < 0) continue;
      const r = rasterChord(geom, i, j);
      idx.set(r.idx, start[key]);
      w.set(quantizeWeights(r.w), start[key]);
    }
  }
  const bytes = idx.byteLength + w.byteLength + start.byteLength + count.byteLength + k.byteLength + lenPx.byteLength;
  const view: ChordView = { idx, w, start: 0, end: 0, k: 1, lenPx: 0 };
  return {
    mode: "flat",
    bytes: () => bytes,
    get(i: number, j: number) {
      const key = pairKey(i, j, n), s = start[key];
      if (s < 0) return null;
      // one reused view object: the solver reads it before asking for the next chord
      view.start = s; view.end = s + count[key]; view.k = k[key]; view.lenPx = lenPx[key];
      return view;
    }
  };
}

/** Rasterise chords on demand, keeping the most recently used `capacity` of them. */
export function buildLru(geom: Geometry, minSkip: number, capacity: number): LineSource {
  const n = geom.nails, cache = new Map<number, ChordView>();
  let held = 0;
  return {
    mode: "lru",
    bytes: () => held,
    get(i: number, j: number) {
      if (!isValidChord(i, j, n, minSkip)) return null;
      const key = pairKey(i, j, n);
      let v = cache.get(key);
      if (v) { cache.delete(key); cache.set(key, v); return v; }   // move to most recent
      const a = Math.min(i, j), b = Math.max(i, j), r = rasterChord(geom, a, b);
      v = { idx: r.idx, w: quantizeWeights(r.w), start: 0, end: r.idx.length, k: r.k, lenPx: r.length };
      cache.set(key, v); held += r.idx.length * ENTRY_BYTES;
      if (cache.size > capacity) {
        const oldest = cache.keys().next().value as number, o = cache.get(oldest)!;
        held -= o.end * ENTRY_BYTES; cache.delete(oldest);
      }
      return v;
    }
  };
}

/** Pick the layout: flat if its estimated size fits the budget, otherwise LRU. Reports the decision through log. */
export function createLineSource(geom: Geometry, minSkip: number, budgetBytes: number, log?: (msg: string) => void, lruCapacity = 4096): LineSource {
  const est = estimateFlatBytes(geom, minSkip);
  if (est <= budgetBytes) {
    const src = buildFlat(geom, minSkip);
    log?.(`line cache: precomputed all chords, ${(src.bytes() / 1e6).toFixed(1)} MB (estimate ${(est / 1e6).toFixed(1)} MB, budget ${(budgetBytes / 1e6).toFixed(0)} MB)`);
    return src;
  }
  log?.(`line cache: on demand with LRU of ${lruCapacity} chords (flat layout would need ~${(est / 1e6).toFixed(0)} MB, budget ${(budgetBytes / 1e6).toFixed(0)} MB)`);
  return buildLru(geom, minSkip, lruCapacity);
}
