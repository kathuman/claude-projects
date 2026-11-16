// The thread preview: a white board with the nails, and the chords drawn as the solver chooses them.
//
// Physical scale: the canvas is board_mm / thread_mm pixels across (capped at 4000), so one pixel is one thread
// diameter and every chord is a 1-px line. Each chord is stroked separately with full opacity: the canvas's
// anti-aliased coverage and source-over compositing give C_new = C + a(1 − C), the same multiplicative darkening as
// the solver's model, so crossings get darker the way real thread does. The browser scales the canvas down to the
// screen by repeated halving (each halving averages 2 × 2 pixels), which averages those fine lines as an eye does
// from a distance; a single bilinear shrink of a 2400-px canvas to 400 px would instead pick some 1-px lines in full
// and skip others, exaggerating contrast and adding moiré.

import { makeGeometry } from "../core/geometry";
import { linearToSrgb } from "../core/preprocess";

export const RENDER_CAP = 4000;

export function renderSize(boardMm: number, threadMm: number): number {
  return Math.min(RENDER_CAP, Math.max(400, Math.round(boardMm / threadMm)));
}

export class ThreadPreview {
  /** the full-resolution board, off screen */
  readonly full: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private pending = false;
  private xs = new Float64Array(0);
  private ys = new Float64Array(0);
  private width = 1;
  private alpha = 1;

  constructor(private view: HTMLCanvasElement) {
    this.full = document.createElement("canvas");
    this.ctx = this.full.getContext("2d", { alpha: false })!;
    new ResizeObserver(() => this.refresh()).observe(view);
  }

  /** Redraw the visible canvas from the full-resolution one (at most once per animation frame). */
  refresh(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      const target = Math.max(64, Math.round(this.view.clientWidth * (window.devicePixelRatio || 1)));
      let src: HTMLCanvasElement = this.full;
      while (src.width / 2 >= target) {
        const half = document.createElement("canvas");
        half.width = Math.floor(src.width / 2); half.height = Math.floor(src.height / 2);
        const h = half.getContext("2d")!;
        h.imageSmoothingEnabled = true; h.imageSmoothingQuality = "high";
        h.drawImage(src, 0, 0, half.width, half.height);
        src = half;
      }
      const size = Math.min(src.width, target);
      if (this.view.width !== size) { this.view.width = size; this.view.height = size; }
      const v = this.view.getContext("2d")!;
      v.imageSmoothingEnabled = true; v.imageSmoothingQuality = "high";
      v.drawImage(src, 0, 0, size, size);
    });
  }

  /** Clear to a blank board for a solve with these settings. */
  reset(nails: number, res: number, marginPx: number, boardMm: number, threadMm: number, darkness: number): void {
    const size = renderSize(boardMm, threadMm), s = size / res, g = makeGeometry(nails, res, marginPx);
    this.full.width = size; this.full.height = size;
    this.xs = Float64Array.from(g.xs, (v) => v * s);
    this.ys = Float64Array.from(g.ys, (v) => v * s);
    // the darkness factor stands for a thread that covers more (or less) than its diameter: widen (or fade) the line
    this.width = Math.max(1, darkness);
    this.alpha = Math.min(1, darkness);
    const c = this.ctx;
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, size, size);
    c.fillStyle = "#8a96a3";
    const r = Math.max(1.5, size / 900);
    for (let i = 0; i < nails; i++) { c.beginPath(); c.arc(this.xs[i], this.ys[i], r, 0, Math.PI * 2); c.fill(); }
    c.lineCap = "butt";
    this.refresh();
  }

  /** Draw chords given as [from, to, from, to, …]. */
  addChords(pairs: Uint16Array): void {
    const c = this.ctx;
    c.strokeStyle = `rgba(0,0,0,${this.alpha})`;
    c.lineWidth = this.width;
    for (let k = 0; k + 1 < pairs.length; k += 2) {
      c.beginPath();
      c.moveTo(this.xs[pairs[k]], this.ys[pairs[k]]);
      c.lineTo(this.xs[pairs[k + 1]], this.ys[pairs[k + 1]]);
      c.stroke();
    }
    this.refresh();
  }

  /** Draw a whole sequence on top of what is there. */
  drawSequence(seq: Uint16Array): void {
    const pairs = new Uint16Array(Math.max(0, (seq.length - 1) * 2));
    for (let s = 1; s < seq.length; s++) { pairs[2 * s - 2] = seq[s - 1]; pairs[2 * s - 1] = seq[s]; }
    this.addChords(pairs);
  }
}

/** Show a darkness map (target T or simulated C) as the grey a viewer would see: reflectance 1 − D, sRGB-encoded. */
export function drawDarkness(canvas: HTMLCanvasElement, D: ArrayLike<number>, res: number): void {
  canvas.width = res; canvas.height = res;
  const ctx = canvas.getContext("2d")!, img = ctx.createImageData(res, res), lut = new Uint8ClampedArray(1025);
  for (let i = 0; i <= 1024; i++) lut[i] = Math.round(255 * linearToSrgb(1 - i / 1024));
  for (let p = 0, q = 0; p < res * res; p++, q += 4) {
    const v = lut[Math.max(0, Math.min(1024, Math.round(D[p] * 1024)))];
    img.data[q] = v; img.data[q + 1] = v; img.data[q + 2] = v; img.data[q + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * The target with the importance mask over it: areas raised above 1 tinted warm (up to W = 3), areas lowered below 1
 * tinted cool (down to 0.2). With no mask it is the plain target.
 */
export function drawTargetWithMask(canvas: HTMLCanvasElement, T: ArrayLike<number>, W: Float32Array | null, res: number): void {
  drawDarkness(canvas, T, res);
  if (!W) return;
  const ctx = canvas.getContext("2d")!, img = ctx.getImageData(0, 0, res, res), d = img.data;
  for (let p = 0, q = 0; p < res * res; p++, q += 4) {
    const w = W[p];
    if (w === 1) continue;
    let a: number, r: number, g: number, b: number;
    if (w > 1) { a = Math.min(1, (w - 1) / 2) * 0.6; r = 255; g = 150; b = 40; }
    else { a = Math.min(1, (1 - w) / 0.8) * 0.6; r = 40; g = 140; b = 255; }
    d[q] = d[q] * (1 - a) + r * a; d[q + 1] = d[q + 1] * (1 - a) + g * a; d[q + 2] = d[q + 2] * (1 - a) + b * a;
  }
  ctx.putImageData(img, 0, 0);
}
