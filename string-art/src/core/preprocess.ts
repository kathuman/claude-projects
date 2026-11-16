// From picture to target darkness map T.
//
// 1. sRGB → linear light. Pixel values are gamma-encoded; light adds up only in linear units, and thread coverage is a
//    linear quantity (a pixel 30 % covered by black thread reflects 70 % of the light). So we undo the sRGB transfer
//    curve, v ≤ 0.04045 ? v/12.92 : ((v + 0.055)/1.055)^2.4, before anything else.
// 2. Luminance Y = 0.2126 R + 0.7152 G + 0.0722 B (Rec. 709 weights, valid for linear sRGB primaries).
// 3. Area-average resampling to the working resolution: each output pixel is the exact mean of the source area it
//    covers (separable, with fractional overlaps), which neither aliases nor blurs more than necessary.
// 4. Adjustments (brightness, contrast, gamma) in a perceptual space, then back to linear: users judge "brighter" and
//    "more contrast" by eye, so the sliders act on sRGB-encoded values; the result is decoded to linear again.
// 5. T = 1 − Y: the darkness the thread must produce. Pixels outside the nail circle get T = 0.

import { clahe } from "./clahe";

export interface Rgba {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface Adjustments {
  /** added to the encoded value, −0.5 … 0.5 */
  brightness: number;
  /** multiplies the distance from mid-grey, 0.2 … 3 */
  contrast: number;
  /** v ← v^gamma on the encoded value, 0.3 … 3 (above 1 darkens mid-tones) */
  gamma: number;
}

export const NO_ADJUSTMENT: Adjustments = { brightness: 0, contrast: 1, gamma: 1 };

const SRGB_TO_LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    t[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return t;
})();

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** Linear-light luminance of every pixel, 0 (black) … 1 (white). Transparent pixels count as white board. */
export function linearLuminance(img: Rgba): Float32Array {
  const { data, width, height } = img, Y = new Float32Array(width * height);
  for (let p = 0, q = 0; p < Y.length; p++, q += 4) {
    const y = 0.2126 * SRGB_TO_LINEAR[data[q]] + 0.7152 * SRGB_TO_LINEAR[data[q + 1]] + 0.0722 * SRGB_TO_LINEAR[data[q + 2]];
    const a = data[q + 3] / 255;
    Y[p] = a * y + (1 - a);
  }
  return Y;
}

/** Weights for resampling n source samples onto m outputs by area: output i covers [i·n/m, (i+1)·n/m). */
function areaWeights(n: number, m: number, offset: number, span: number): { start: Int32Array; len: Int32Array; w: Float32Array; stride: number } {
  // source interval of output i: [offset + i·span/m, offset + (i+1)·span/m)
  const scale = span / m, stride = Math.ceil(scale) + 2;
  const start = new Int32Array(m), len = new Int32Array(m), w = new Float32Array(m * stride);
  for (let i = 0; i < m; i++) {
    const a = offset + i * scale, b = a + scale;
    const s0 = Math.max(0, Math.floor(a)), s1 = Math.min(n, Math.ceil(b));
    start[i] = s0; len[i] = Math.max(0, s1 - s0);
    let total = 0;
    for (let s = s0; s < s1; s++) {
      const o = Math.max(0, Math.min(b, s + 1) - Math.max(a, s));
      w[i * stride + (s - s0)] = o; total += o;
    }
    if (total > 0) for (let k = 0; k < len[i]; k++) w[i * stride + k] /= total;
  }
  return { start, len, w, stride };
}

/**
 * Resample a w × h single-channel image to res × res, taking the square of side `size` centred at (cx, cy) (source
 * pixels). Defaults: the largest centred square ("cover"). Areas outside the source count as white (1).
 */
export function resampleSquare(Y: Float32Array, w: number, h: number, res: number, crop?: { cx: number; cy: number; size: number }): Float32Array {
  const size = crop?.size ?? Math.min(w, h), cx = crop?.cx ?? w / 2, cy = crop?.cy ?? h / 2;
  const ox = cx - size / 2, oy = cy - size / 2;
  const X = areaWeights(w, res, ox, size), V = areaWeights(h, res, oy, size);
  // horizontal pass: rows of the source → h × res
  const tmp = new Float32Array(h * res);
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < res; i++) {
      let s = 0, cover = 0;
      for (let k = 0; k < X.len[i]; k++) { const wk = X.w[i * X.stride + k]; s += wk * Y[y * w + X.start[i] + k]; cover += wk; }
      tmp[y * res + i] = X.len[i] ? s + (1 - cover) : 1;
    }
  }
  // vertical pass
  const out = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      let s = 0, cover = 0;
      for (let k = 0; k < V.len[j]; k++) { const wk = V.w[j * V.stride + k]; s += wk * tmp[(V.start[j] + k) * res + i]; cover += wk; }
      out[j * res + i] = V.len[j] ? s + (1 - cover) : 1;
    }
  }
  return out;
}

/** Apply brightness, contrast and gamma to linear luminance, on the sRGB-encoded scale (see 4. above). */
export function adjust(Y: Float32Array, adj: Adjustments): Float32Array {
  if (adj.brightness === 0 && adj.contrast === 1 && adj.gamma === 1) return Float32Array.from(Y);
  const out = new Float32Array(Y.length);
  for (let p = 0; p < Y.length; p++) {
    let v = linearToSrgb(Math.min(1, Math.max(0, Y[p])));
    v = (v - 0.5) * adj.contrast + 0.5 + adj.brightness;
    v = Math.min(1, Math.max(0, v));
    v = Math.pow(v, adj.gamma);
    out[p] = srgbToLinear(v);
  }
  return out;
}

/** Target darkness T = 1 − Y inside the nail circle (mask = 1), 0 outside. */
export function toTarget(Y: Float32Array, mask: Uint8Array): Float32Array {
  const T = new Float32Array(Y.length);
  for (let p = 0; p < Y.length; p++) T[p] = mask[p] ? Math.min(1, Math.max(0, 1 - Y[p])) : 0;
  return T;
}

/** Where the board circle sits on the picture: the centre and side of the square it fills (source pixels), and how
 *  far the picture is turned clockwise on the board (radians). */
export interface Crop { cx: number; cy: number; size: number; angle: number }

export function defaultCrop(w: number, h: number): Crop { return { cx: w / 2, cy: h / 2, size: Math.min(w, h), angle: 0 }; }

/** Bilinear sample of a w × h image at (x, y) in pixel coordinates (pixel centres at +½); outside counts as white. */
function bilinear(Y: Float32Array, w: number, h: number, x: number, y: number): number {
  const u = x - 0.5, v = y - 0.5, x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 1 : Y[j * w + i]);
  return (1 - fy) * ((1 - fx) * at(x0, y0) + fx * at(x0 + 1, y0)) + fy * ((1 - fx) * at(x0, y0 + 1) + fx * at(x0 + 1, y0 + 1));
}

/**
 * Resample the crop to res × res. Without rotation this is the exact area average (resampleSquare). With rotation each
 * output pixel averages k × k bilinear samples spread evenly over its footprint in the source, k = ⌈size/res⌉ (at
 * most 6): the footprint is about size/res source pixels wide, so k samples per side touch every source pixel it
 * covers, which approximates the area average and avoids aliasing when the picture is shrunk.
 *
 * Geometry (screen coordinates, y down; a positive angle turns the picture clockwise on the board): output offset d
 * from the board centre, in output pixels, shows the source point c + R(−angle)·d·(size/res).
 */
export function cropResample(Y: Float32Array, w: number, h: number, res: number, crop: Crop): Float32Array {
  if (crop.angle === 0) return resampleSquare(Y, w, h, res, crop);
  const out = new Float32Array(res * res), s = crop.size / res, k = Math.min(6, Math.max(1, Math.ceil(s)));
  const cos = Math.cos(-crop.angle), sin = Math.sin(-crop.angle);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      let acc = 0;
      for (let b = 0; b < k; b++) {
        const dy = (j + (b + 0.5) / k - res / 2) * s;
        for (let a = 0; a < k; a++) {
          const dx = (i + (a + 0.5) / k - res / 2) * s;
          acc += bilinear(Y, w, h, crop.cx + dx * cos - dy * sin, crop.cy + dx * sin + dy * cos);
        }
      }
      out[j * res + i] = acc / (k * k);
    }
  }
  return out;
}

/** Everything that turns the picture into the target, in order. */
export interface Prep { crop: Crop; adj: Adjustments; clahe: boolean; claheClip: number }

/**
 * The whole preparation: crop and resample, optional CLAHE (on the sRGB-encoded scale, see clahe.ts), brightness /
 * contrast / gamma, then T = 1 − Y inside the circle.
 */
export function buildTarget(lum: Float32Array, w: number, h: number, res: number, prep: Prep, mask: Uint8Array): Float32Array {
  let Y = cropResample(lum, w, h, res, prep.crop);
  if (prep.clahe) {
    const v = new Float32Array(Y.length);
    for (let p = 0; p < Y.length; p++) v[p] = linearToSrgb(Math.min(1, Math.max(0, Y[p])));
    const e = clahe(v, res, mask, 8, prep.claheClip);
    for (let p = 0; p < Y.length; p++) Y[p] = srgbToLinear(Math.min(1, Math.max(0, e[p])));
  }
  Y = adjust(Y, prep.adj);
  return toTarget(Y, mask);
}
