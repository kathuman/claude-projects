// SVG drawings for the build page, made from the layout (hardware/layout.ts): the base's drilling plan, the platter's,
// and the wiring diagram. Drawings come in two styles: "screen" (light lines on the page's blue) and "paper" (black on
// white, in true millimetres, for printing at 100 %).

import { baseLayout, platterLayout, type Circle, type Rect } from "../hardware/layout";
import { T, fx, int } from "./i18n";

type Style = "screen" | "paper";
const ink = (s: Style) => (s === "screen" ? { line: "#bfe4ff", faint: "#6fa8c9", cut: "#ffcf4a", dim: "#7dd3fc", bg: "#082444", text: "#bfe4ff" }
  : { line: "#000", faint: "#777", cut: "#c00", dim: "#0050a0", bg: "#fff", text: "#000" });

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function hull(circles: Circle[], n = 72): [number, number][] {
  const pts: [number, number][] = [];
  for (const c of circles) for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; pts.push([c.x + c.r * Math.cos(a), c.y + c.r * Math.sin(a)]); }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (ps: [number, number][]) => { const h: [number, number][] = []; for (const p of ps) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } return h; };
  const lo = half(pts), up = half([...pts].reverse());
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** an SVG in model millimetres with y flipped (model +Y = up on the page) */
class Sheet {
  out: string[] = [];
  constructor(private s: Style, private fs: number) {}
  get c() { return ink(this.s); }
  rect(r: Rect, stroke: string, dash = "", fill = "none", w = 1) {
    this.out.push(`<rect x="${r.x0}" y="${-r.y1}" width="${r.x1 - r.x0}" height="${r.y1 - r.y0}" fill="${fill}" stroke="${stroke}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ""} vector-effect="non-scaling-stroke"/>`);
  }
  circle(c: Circle, stroke: string, dash = "", fill = "none") {
    this.out.push(`<circle cx="${c.x}" cy="${-c.y}" r="${c.r}" fill="${fill}" stroke="${stroke}" stroke-width="1" ${dash ? `stroke-dasharray="${dash}"` : ""} vector-effect="non-scaling-stroke"/>`);
    this.out.push(`<path d="M${c.x - 2} ${-c.y}h4M${c.x} ${-c.y - 2}v4" stroke="${stroke}" stroke-width="0.6" vector-effect="non-scaling-stroke"/>`);
  }
  poly(pts: [number, number][], stroke: string, w = 1.6) {
    this.out.push(`<path d="M${pts.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join("L")}Z" fill="none" stroke="${stroke}" stroke-width="${w}" vector-effect="non-scaling-stroke"/>`);
  }
  line(x0: number, y0: number, x1: number, y1: number, stroke: string, dash = "") {
    this.out.push(`<path d="M${x0} ${-y0}L${x1} ${-y1}" stroke="${stroke}" stroke-width="0.8" ${dash ? `stroke-dasharray="${dash}"` : ""} vector-effect="non-scaling-stroke"/>`);
  }
  text(x: number, y: number, t: string, color: string, anchor = "start", size = 1) {
    this.out.push(`<text x="${x}" y="${-y}" fill="${color}" font-size="${this.fs * size}" font-family="Barlow, Arial, sans-serif" text-anchor="${anchor}">${esc(t)}</text>`);
  }
  /** a dimension line with arrows and its value in mm */
  dim(x0: number, y0: number, x1: number, y1: number, off: number, label?: string) {
    const c = this.c.dim, L = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
    const ax = x0 + nx * off, ay = y0 + ny * off, bx = x1 + nx * off, by = y1 + ny * off;
    this.line(x0, y0, ax + nx * 3, ay + ny * 3, c); this.line(x1, y1, bx + nx * 3, by + ny * 3, c);
    this.line(ax, ay, bx, by, c);
    const a = this.fs * 0.5, ux = (bx - ax) / L, uy = (by - ay) / L;
    for (const [px, py, sg] of [[ax, ay, 1], [bx, by, -1]] as const) {
      this.out.push(`<path d="M${px} ${-py}L${px + sg * (ux * a + nx * a * 0.35)} ${-(py + sg * (uy * a + ny * a * 0.35))}L${px + sg * (ux * a - nx * a * 0.35)} ${-(py + sg * (uy * a - ny * a * 0.35))}Z" fill="${c}"/>`);
    }
    const mx = (ax + bx) / 2 + nx * this.fs * 0.6, my = (ay + by) / 2 + ny * this.fs * 0.6;
    const ang = (-Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
    const up = ang > 90 || ang < -90 ? ang + 180 : ang;
    this.out.push(`<text x="${mx}" y="${-my}" fill="${c}" font-size="${this.fs * 0.85}" font-family="IBM Plex Mono, monospace" text-anchor="middle" transform="rotate(${up} ${mx} ${-my})">${esc(label ?? fx(L, 0))}</text>`);
  }
}

function wrap(body: string[], vb: [number, number, number, number], s: Style, title: string, trueSize: boolean): string {
  const [x, y, w, h] = vb, c = ink(s);
  const size = trueSize ? `width="${w}mm" height="${h}mm"` : `width="100%"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" ${size} role="img" aria-label="${esc(title)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c.bg}"/>${body.join("")}</svg>`;
}

/** The base, seen from above, with everything to cut, drill and place. */
export function baseDrawing(s: Style, trueSize = false): string {
  const L = baseLayout(), c = ink(s), g = new Sheet(s, 17);
  const o = L.outline;
  g.rect(o, c.line, "", "none", 1.6);
  g.poly(hull(L.cutout), c.cut, 1.8);
  g.text(L.motor.x - 20, 58, T("cut right through"), c.cut, "end", 0.85);
  g.rect(L.bearing, c.faint, "8 5");
  g.text(L.bearing.x0 + 8, L.bearing.y1 - 28, T("bearing, 305 mm"), c.faint, "start", 0.85);
  L.bearingScrews.forEach((h) => g.circle(h, c.line));
  g.circle(L.accessHole, c.line, "4 3");
  g.text(L.accessHole.x, L.accessHole.y - 62, T("Ø 20 access hole: mark through the bearing"), c.text, "middle", 0.85);
  g.rect(L.motorPlate, c.faint, "3 3");
  g.text(L.motorPlate.x0 - 8, -4, T("motor plate, underneath"), c.faint, "end", 0.85);
  for (const [a, b] of L.motorSlots) { g.circle(a, c.line); g.circle(b, c.line); g.line(a.x, a.y + a.r, b.x, b.y + b.r, c.line); g.line(a.x, a.y - a.r, b.x, b.y - b.r, c.line); }
  g.circle({ x: L.motor.x, y: 0, r: 4 }, c.cut);
  g.rect(L.hall, c.faint, "3 3"); L.hallScrews.forEach((h) => g.circle(h, c.line));
  g.text(L.hall.x1 + 8, L.hall.y0 + 6, T("hall sensor holder"), c.text, "start", 0.85);
  g.rect(L.extrusion, c.line, "", "none", 1.2); L.towerScrews.forEach((h) => g.circle(h, c.line));
  g.text(0, L.extrusion.y0 - 20, T("tower"), c.text, "middle", 0.85);
  L.feet.forEach((f) => g.circle(f, c.faint, "3 3"));
  g.rect(L.controller, c.faint, "6 4"); g.text((L.controller.x0 + L.controller.x1) / 2, (L.controller.y0 + L.controller.y1) / 2, T("controller"), c.faint, "middle", 0.85);
  g.rect(L.supply, c.faint, "6 4"); g.text((L.supply.x0 + L.supply.x1) / 2, (L.supply.y0 + L.supply.y1) / 2, T("power supply"), c.faint, "middle", 0.85);
  g.line(-25, 0, 25, 0, c.dim); g.line(0, -25, 0, 25, c.dim);
  g.text(8, -36, T("turntable axis"), c.dim, "start", 0.85);
  // dimensions
  g.dim(o.x0, o.y0, o.x1, o.y0, -40);
  g.dim(o.x0, o.y0, o.x0, o.y1, 40);
  g.dim(o.x0, o.y0, o.x0, 0, -40, int(-o.y0));
  g.dim(L.motor.x, 0, 0, 0, -95, fx(-L.motor.x, 1));
  g.dim(0, L.accessHole.y, 0, 0, 175, fx(-L.accessHole.y, 0));
  g.dim(L.bearingScrews[0].x, L.bearingScrews[0].y, L.bearingScrews[1].x, L.bearingScrews[1].y, -30);
  g.dim(0, 0, 0, L.extrusion.y0, -110);
  g.dim(0, 0, 0, L.hallScrews[1].y, 210, fx(-L.hallScrews[1].y, 1));
  g.dim(L.towerScrews[0].x, L.towerScrews[0].y, L.towerScrews[1].x, L.towerScrews[1].y, 45);
  g.text(o.x0, o.y0 - 70, T("Base, 18 mm plywood, seen from above. All sizes in mm; holes Ø 4.5 unless marked."), c.text, "start", 0.95);
  return wrap(g.out, [o.x0 - 70, -o.y1 - 30, o.x1 - o.x0 + 140, o.y1 - o.y0 + 120], s, T("Drilling plan for the base"), trueSize);
}

/** The platter: top face (turn buttons) and, dashed, what goes underneath (pulley screws, magnet). */
export function platterDrawing(s: Style, trueSize = false): string {
  const L = platterLayout(), c = ink(s), g = new Sheet(s, 17), R = L.radius;
  g.circle({ x: 0, y: 0, r: R }, c.line);
  g.circle({ x: 0, y: 0, r: L.boardRadius }, c.faint, "8 5");
  g.text(0, L.boardRadius - 26, T("nail board, Ø 640"), c.faint, "middle", 0.85);
  g.circle(L.dowel, c.cut);
  g.text(14, -18, T("Ø 10 through, for the dowel"), c.text, "start", 0.85);
  L.buttonScrews.forEach((h) => g.circle(h, c.line));
  g.text(L.buttonScrews[0].x - 6, L.buttonScrews[0].y + 18, T("turn buttons"), c.text, "end", 0.85);
  L.pulleyScrews.forEach((h) => g.circle(h, c.line, "2 2"));
  g.circle({ x: 0, y: 0, r: 70 }, c.faint, "3 3");
  g.text(0, 80, T("pulley, underneath"), c.faint, "middle", 0.85);
  g.circle(L.magnet, c.cut, "2 2");
  g.text(L.magnet.x + 12, L.magnet.y - 4, T("magnet underneath: Ø 6, 3 deep"), c.text, "start", 0.85);
  g.dim(-R, 0, R, 0, -R - 40);
  g.dim(0, 0, L.magnet.x, L.magnet.y, 30, int(-L.magnet.y));
  g.dim(0, 0, L.buttonScrews[0].x, 0, 40, fx(L.buttonScrews[0].x, 0));
  g.dim(0, 0, L.pulleyScrews[0].x, L.pulleyScrews[0].y, 26);
  g.text(-R, -R - 70, T("Platter, 12 mm plywood, seen from above; dashed holes are drilled from underneath. Turn buttons every 120°, pulley screws every 60°."), c.text, "start", 0.95);
  return wrap(g.out, [-R - 60, -R - 30, 2 * R + 120, 2 * R + 130], s, T("Drilling plan for the platter"), trueSize);
}

/** The wiring: Uno + CNC Shield V3 in the middle, motors, switches, sensor and supply round it. */
export function wiringDrawing(): string {
  const c = ink("screen"), o: string[] = [];
  const box = (x: number, y: number, w: number, h: number, title: string, sub: string, color = c.line) => {
    o.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#0d3a63" stroke="${color}" stroke-width="1.4"/>`);
    o.push(`<text x="${x + w / 2}" y="${y + 20}" fill="${c.text}" font-size="13" font-weight="600" text-anchor="middle" font-family="Barlow, Arial, sans-serif">${esc(title)}</text>`);
    if (sub) o.push(`<text x="${x + w / 2}" y="${y + 37}" fill="${c.faint}" font-size="10.5" text-anchor="middle" font-family="IBM Plex Mono, monospace" textLength="${Math.min(w - 12, sub.length * 6.4)}" lengthAdjust="spacingAndGlyphs">${esc(sub)}</text>`);
  };
  const wire = (pts: [number, number][], color: string, label: string, lx: number, ly: number) => {
    o.push(`<path d="M${pts.map((p) => p.join(" ")).join("L")}" fill="none" stroke="${color}" stroke-width="2"/>`);
    o.push(`<text x="${lx}" y="${ly}" fill="${color}" font-size="11" font-family="IBM Plex Mono, monospace">${esc(label)}</text>`);
  };
  const sh = { x: 300, y: 150, w: 220, h: 230 };
  box(sh.x, sh.y, sh.w, sh.h, T("Arduino Uno + CNC Shield V3"), "GRBL 1.1", c.dim);
  const pins = [[T("X driver"), 0], [T("Y driver"), 1], [T("Z driver"), 2]] as const;
  pins.forEach(([n, i]) => o.push(`<text x="${sh.x + 12}" y="${sh.y + 64 + i * 18}" fill="${c.text}" font-size="11" font-family="IBM Plex Mono, monospace">${esc(n)}: TMC2209</text>`));
  o.push(`<text x="${sh.x + 12}" y="${sh.y + 196}" fill="${c.faint}" font-size="10.5" font-family="IBM Plex Mono, monospace">${esc(T("jumpers M0 + M1: 1/16 step"))}</text>`);
  o.push(`<text x="${sh.x + 12}" y="${sh.y + 214}" fill="${c.faint}" font-size="10.5" font-family="IBM Plex Mono, monospace">${esc(T("driver current about 0.8 A"))}</text>`);
  // motors on the left: each wire has its own vertical run
  const mot = (y: number, t: string, s: string, color: string, pin: string, i: number) => {
    box(20, y, 190, 52, t, s, color);
    const vx = 232 + i * 14, py = sh.y + 60 + i * 18;
    wire([[210, y + 26], [vx, y + 26], [vx, py], [sh.x, py]], color, pin, 214, y + 20);
  };
  mot(40, T("Turntable motor"), "NEMA 17", "#ffcf4a", "X", 0);
  mot(150, T("Guide motor"), "NEMA 17", "#7ee0a0", "Y", 1);
  mot(260, T("Height motor"), T("NEMA 17 + T8"), "#ff8a7a", "Z", 2);
  // inputs on the right: each wire has its own vertical run; the pin is named inside the shield, where the wire lands
  const inp = (y: number, t: string, s: string, pin: string, i: number) => {
    box(590, y, 232, 52, t, s);
    const vx = 536 + i * 11, py = sh.y + 48 + i * 26;
    wire([[590, y + 26], [vx, y + 26], [vx, py], [sh.x + sh.w, py]], "#bfe4ff", "", 0, 0);
    o.push(`<text x="${sh.x + sh.w - 8}" y="${py + 4}" fill="${c.dim}" font-size="11" text-anchor="end" font-family="IBM Plex Mono, monospace">${esc(pin)}</text>`);
  };
  inp(20, T("Hall sensor A3144"), T("5 V, GND, signal"), "X− D9", 0);
  inp(90, T("Y home switch"), T("normally open, to GND"), "Y− D10", 1);
  inp(160, T("Z home switch"), T("normally open, to GND"), "SpnEn D12", 2);
  inp(230, T("Thread-break switch"), T("closes when the dancer drops"), "Hold A1", 3);
  inp(300, T("Resume button (optional)"), T("normally open, to GND"), "Resume A2", 4);
  // supply
  box(300, 410, 220, 52, T("Power supply 12 V 5 A"), T("to the shield's screw terminal"), "#ff8a7a");
  wire([[410, 410], [410, sh.y + sh.h]], "#ff8a7a", "12 V", 416, 392);
  box(20, 410, 190, 52, T("Computer"), T("USB: G-code sender"));
  wire([[210, 436], [274, 436], [274, 340], [sh.x, 340]], "#bfe4ff", "USB", 214, 430);
  o.push(`<text x="20" y="497" fill="${c.faint}" font-size="11.5" font-family="Barlow, Arial, sans-serif">${esc(T("GRBL 1.1 moves the Z limit to D12, the pin marked SpnEn on the CNC Shield V3; the Z+/Z− header does not work for it."))}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 512" width="100%" role="img" aria-label="${esc(T("Wiring diagram"))}"><rect width="840" height="512" fill="${c.bg}"/>${o.join("")}</svg>`;
}

