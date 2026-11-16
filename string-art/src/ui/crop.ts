// The crop editor: the picture under a circular window the size of the board. Drag to move it, scroll or pinch to
// zoom, and use the sliders to zoom and turn it. The crop is kept in source pixels (core/preprocess.ts: Crop), and the
// editor draws with exactly the mapping cropResample uses — output offset d shows source point c + R(−angle)·d·scale —
// so what is inside the circle here is what the solver gets.

import type { Crop } from "../core/preprocess";

export const ZOOM_MIN = 0.5, ZOOM_MAX = 8;

export class CropEditor {
  private src: HTMLCanvasElement | null = null;
  private w = 1;
  private h = 1;
  private c: Crop = { cx: 0.5, cy: 0.5, size: 1, angle: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch0 = 0;
  private size0 = 1;

  constructor(private canvas: HTMLCanvasElement, private onChange: (c: Crop) => void) {
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointercancel", (e) => this.up(e));
    canvas.addEventListener("wheel", (e) => { if (!this.src) return; e.preventDefault(); this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  /** the side of the crop at zoom 1: the largest centred square ("cover") */
  private get base(): number { return Math.min(this.w, this.h); }
  get zoom(): number { return this.base / this.c.size; }
  get crop(): Crop { return { ...this.c }; }
  get hasSource(): boolean { return !!this.src; }

  setSource(src: HTMLCanvasElement): void {
    this.src = src; this.w = src.width; this.h = src.height;
    this.reset();
  }
  reset(): void {
    this.c = { cx: this.w / 2, cy: this.h / 2, size: this.base, angle: 0 };
    this.changed();
  }
  setZoom(z: number): void {
    this.c.size = this.base / Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    this.changed();
  }
  /** turn, in degrees clockwise */
  setAngle(deg: number): void {
    this.c.angle = (deg * Math.PI) / 180;
    this.changed();
  }

  private changed(): void { this.draw(); this.onChange(this.crop); }

  /** move the picture with the pointer: a drag of (dx, dy) screen px moves the crop centre by −R(−angle)·d·scale */
  private pan(dx: number, dy: number): void {
    const k = this.c.size / this.canvas.clientWidth, a = -this.c.angle, cos = Math.cos(a), sin = Math.sin(a);
    this.c.cx -= (dx * cos - dy * sin) * k;
    this.c.cy -= (dx * sin + dy * cos) * k;
  }

  private down(e: PointerEvent): void {
    if (!this.src) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch0 = Math.hypot(a.x - b.x, a.y - b.y); this.size0 = this.c.size; }
  }
  private move(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (this.pointers.size === 1) { this.pan(e.clientX - p.x, e.clientY - p.y); }
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size === 2 && this.pinch0 > 0) {
      const [a, b] = [...this.pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      this.c.size = Math.min(this.base / ZOOM_MIN, Math.max(this.base / ZOOM_MAX, (this.size0 * this.pinch0) / d));
    }
    this.changed();
  }
  private up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch0 = 0;
  }

  draw(): void {
    const cv = this.canvas, E = Math.max(1, Math.round(cv.clientWidth * (window.devicePixelRatio || 1)));
    if (cv.width !== E) { cv.width = E; cv.height = E; }
    const g = cv.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, E, E);
    if (!this.src) return;
    g.save();
    g.translate(E / 2, E / 2);
    g.rotate(this.c.angle);
    g.scale(E / this.c.size, E / this.c.size);
    g.translate(-this.c.cx, -this.c.cy);
    g.imageSmoothingQuality = "high";
    g.drawImage(this.src, 0, 0);
    g.restore();
    // shade what falls outside the board circle
    g.fillStyle = "rgba(8, 36, 68, 0.72)";
    g.beginPath(); g.rect(0, 0, E, E); g.arc(E / 2, E / 2, E / 2 - 1, 0, Math.PI * 2, true); g.fill("evenodd");
    g.strokeStyle = "#7dd3fc"; g.lineWidth = Math.max(1, E / 260);
    g.beginPath(); g.arc(E / 2, E / 2, E / 2 - g.lineWidth, 0, Math.PI * 2); g.stroke();
  }
}

/** Put RGBA pixels on a canvas, so the editor can draw them transformed. */
export function rgbaCanvas(data: Uint8ClampedArray | Uint8Array, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const img = new ImageData(new Uint8ClampedArray(data), w, h);
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}
