// The machine simulator: the board seen from the front, turning under a fixed thread guide at the top (or, with
// "upright", the picture held still and the guide carried round it), plus a magnified view that follows the guide so
// each wrap can be seen at true size. Lines already wound are drawn into an off-screen canvas in the board's own frame,
// one at a time as they finish; everything else is drawn in millimetres in the board's frame and turned by X.
// While a nail is being wrapped, the thread is drawn round the outside of the nail, as it really lies.

import { pitchDeg, type MachineConfig } from "../machine/config";
import { KINDS, positionAt, type Plan } from "../machine/toolpath";

const DEG = Math.PI / 180;

export interface SimState { line: number; pos: [number, number, number]; kind: string; done: number }

export class MachineSim {
  private wound = document.createElement("canvas");
  private drawn = 0;                 // lines drawn into `wound`
  private seq: ArrayLike<number> = [0];
  private c!: MachineConfig;
  private plan!: Plan;
  private lineDone = new Float64Array(1);   // time each line finishes
  private size = 0;
  private scale = 1;                 // px per mm on the main view
  upright = false;
  /** how many mm the magnified view spans */
  zoomSpan = 26;

  constructor(private canvas: HTMLCanvasElement, private inset: HTMLCanvasElement | null = null) {}

  load(seq: ArrayLike<number>, c: MachineConfig, plan: Plan): void {
    this.seq = seq; this.c = c; this.plan = plan;
    this.lineDone = new Float64Array(plan.lines + 1);
    for (let k = 0; k <= plan.lines; k++) { const i = plan.lineEnd[k]; this.lineDone[k] = i >= 0 ? plan.t0[i] + plan.dur[i] : 0; }
    this.size = 0;                   // force a resize and a full redraw
  }

  /** The time line k is finished (k = 0: set up). */
  timeOfLine(k: number): number { return this.lineDone[Math.max(0, Math.min(this.plan.lines, k))]; }

  /** Lines complete at time t. */
  linesDone(t: number): number {
    let lo = 0, hi = this.plan.lines;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.lineDone[mid] <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }

  private resize(): boolean {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = Math.round(this.canvas.getBoundingClientRect().width) || 600;
    const size = Math.round(css * dpr);
    if (this.inset) {
      const ic = Math.round((this.inset.getBoundingClientRect().width || 180) * dpr);
      if (this.inset.width !== ic) { this.inset.width = ic; this.inset.height = ic; }
    }
    if (size === this.size) return false;
    this.size = size;
    this.canvas.width = size; this.canvas.height = size;
    this.wound.width = size; this.wound.height = size;
    this.scale = (size / 2) / (this.c.boardMm / 2 + this.c.outsideMm + 16);
    return true;
  }

  /** a point of the board frame in mm: radius r, angle θ (° clockwise from the top) */
  private at(r: number, deg: number): [number, number] { return [r * Math.sin(deg * DEG), -r * Math.cos(deg * DEG)]; }
  private nail(i: number): [number, number] { return this.at(this.c.boardMm / 2, i * pitchDeg(this.c)); }

  private strokeLines(g: CanvasRenderingContext2D, from: number, to: number, k: number): void {
    g.beginPath();
    for (let j = Math.max(1, from); j <= to; j++) {
      const [ax, ay] = this.nail(this.seq[j - 1]), [bx, by] = this.nail(this.seq[j]);
      g.moveTo(ax * k, ay * k); g.lineTo(bx * k, by * k);
    }
    g.stroke();
  }

  private redrawWound(upTo: number): void {
    const g = this.wound.getContext("2d")!, s = this.size, R = this.c.boardMm / 2;
    if (upTo < this.drawn || this.drawn === 0) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, s, s);
      g.translate(s / 2, s / 2);
      g.fillStyle = "#fbf8f2";
      g.beginPath(); g.arc(0, 0, (R + 12) * this.scale, 0, 2 * Math.PI); g.fill();
      this.drawn = 0;
    }
    // thread at true width, but at least a faint hairline so a small view still shows the picture forming
    g.strokeStyle = "rgba(10,10,14,0.55)";
    g.lineWidth = Math.max(0.35, this.c.threadMm * this.scale);
    this.strokeLines(g, this.drawn + 1, upTo, this.scale);
    this.drawn = Math.max(this.drawn, upTo);
  }

  /**
   * The live thread, in mm of the board frame: from the nail it was last wound round to the guide; while nail
   * `target` is being wrapped (direction w), round the outside of that nail first.
   */
  private threadPath(anchor: number, target: number, w: number, kind: string, gp: [number, number]): [number, number][] {
    const pts: [number, number][] = [this.nail(anchor)];
    if (target >= 0 && (kind === "wrap" || kind === "in")) {
      const c = this.c, th = target * pitchDeg(c) * DEG, [nx, ny] = this.nail(target), r = c.nailMm / 2 + c.threadMm / 2;
      const u = [Math.sin(th), -Math.cos(th)], v = [Math.cos(th), Math.sin(th)];   // outward, and towards higher X
      // enter on the −w side; during the wrap the thread lies against that side, then round the back to the +w side
      const steps = kind === "wrap" ? 0 : 12;
      for (let i = 0; i <= steps; i++) {
        const a = Math.PI * (i / Math.max(1, steps));                 // 0 at the −w side, π/2 behind, π at the +w side
        const dx = -w * v[0] * Math.cos(a) + u[0] * Math.sin(a), dy = -w * v[1] * Math.cos(a) + u[1] * Math.sin(a);
        pts.push([nx + r * dx, ny + r * dy]);
      }
    }
    pts.push(gp);
    return pts;
  }

  /** nails, the live thread, the rail and the guide, in mm (the caller sets the transform) */
  private drawMachine(g: CanvasRenderingContext2D, px: number, X: number, Y: number, anchor: number, target: number, w: number, kind: string, near: [number, number] | null): void {
    const c = this.c, R = c.boardMm / 2;
    const nr = Math.max(c.nailMm / 2, 1 / px);
    g.fillStyle = "#5b6470";
    g.beginPath();
    for (let i = 0; i < c.nails; i++) {
      const [x, y] = this.nail(i);
      if (near && Math.abs(x - near[0]) + Math.abs(y - near[1]) > this.zoomSpan * 2) continue;
      g.moveTo(x + nr, y); g.arc(x, y, nr, 0, 2 * Math.PI);
    }
    g.fill();
    if (target >= 0) {
      const [tx, ty] = this.nail(target);
      g.strokeStyle = "#ffb020"; g.lineWidth = Math.max(1.5 / px, nr * 0.5);
      g.beginPath(); g.arc(tx, ty, nr * 2.6, 0, 2 * Math.PI); g.stroke();
    }
    const gp = this.at(R + Y, X);
    g.strokeStyle = "#e5484d"; g.lineWidth = Math.max(1.2 / px, c.threadMm * (near ? 1 : 2)); g.lineJoin = "round";
    g.beginPath();
    this.threadPath(anchor, target, w, kind, gp).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    const r0 = this.at(R - c.insideMm - 6, X), r1 = this.at(R + c.outsideMm + 10, X);
    g.strokeStyle = "rgba(125,211,252,0.45)"; g.lineWidth = Math.max(2 / px, near ? 0.6 : 2.5);
    g.beginPath(); g.moveTo(r0[0], r0[1]); g.lineTo(r1[0], r1[1]); g.stroke();
    const gr = Math.max(3 / px, c.guideMm / 2);
    g.fillStyle = "rgba(125,211,252,0.9)"; g.strokeStyle = "#04202b"; g.lineWidth = 1.2 / px;
    g.beginPath(); g.arc(gp[0], gp[1], gr, 0, 2 * Math.PI); g.fill(); g.stroke();
    // the thread leaves the guide through its bore
    g.fillStyle = "#e5484d";
    g.beginPath(); g.arc(gp[0], gp[1], Math.max(c.threadMm, 1 / px), 0, 2 * Math.PI); g.fill();
  }

  draw(t: number): SimState {
    const resized = this.resize();
    if (resized) this.drawn = 0;
    const done = this.linesDone(t);
    if (resized || done !== this.drawn) this.redrawWound(done);
    const { pos, move } = positionAt(this.plan, t);
    const [X, Y, Z] = pos, s = this.size, sc = this.scale, P = this.plan;
    const line = move >= 0 ? P.line[move] : 0, kind = move >= 0 ? KINDS[P.kind[move]] : "setup";
    const anchor = this.seq[done];
    const target = kind === "setup" || kind === "finish" || line <= done ? -1 : this.seq[line];
    const wi = target >= 0 ? P.lineEnd[line] - 1 : -1;
    const w = wi >= 0 ? Math.sign(P.to[wi] - P.from[wi]) || 1 : 1;

    const g = this.canvas.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, s, s);
    g.translate(s / 2, s / 2);
    if (!this.upright) g.rotate(-X * DEG);
    g.drawImage(this.wound, -s / 2, -s / 2);
    g.scale(sc, sc);
    this.drawMachine(g, sc, X, Y, anchor, target, w, kind, null);

    if (this.inset) {
      // the magnified view: always guide-up, centred on the guide, in true millimetres
      const h = this.inset.getContext("2d")!, n = this.inset.width, k = n / this.zoomSpan, R = this.c.boardMm / 2;
      h.setTransform(1, 0, 0, 1, 0, 0);
      h.fillStyle = "#0b2742"; h.fillRect(0, 0, n, n);
      h.translate(n / 2, n / 2);
      h.scale(k, k);
      h.translate(0, R + Y);
      h.rotate(-X * DEG);
      h.fillStyle = "#fbf8f2";
      h.beginPath(); h.arc(0, 0, R + 12, 0, 2 * Math.PI); h.fill();
      h.strokeStyle = "rgba(10,10,14,0.55)"; h.lineWidth = this.c.threadMm;
      h.beginPath();
      for (let j = 1; j <= done; j++) {
        const [ax, ay] = this.nail(this.seq[j - 1]), [bx, by] = this.nail(this.seq[j]);
        h.moveTo(ax, ay); h.lineTo(bx, by);
      }
      h.stroke();
      this.drawMachine(h, k, X, Y, anchor, target, w, kind, this.at(R + Y, X));
    }
    return { line, pos: [X, Y, Z], kind, done };
  }
}
