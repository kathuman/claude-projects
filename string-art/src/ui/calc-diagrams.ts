// Force and acceleration diagrams for the calculations page, drawn as SVG from the same numbers as the working
// (hardware/tension.ts, hardware/payout.ts), so they follow the visitor's inputs. Colours follow the site's blueprint
// theme; arrows are drawn as paths, not markers, so several diagrams on one page never share ids.

import type { MachineConfig } from "../machine/config";
import { PARAMS } from "../hardware/drive";
import { payoutRun } from "../hardware/payout";
import { texOf, type TensionReport } from "../hardware/tension";
import { T, fx } from "./i18n";

const C = { ink: "#bfe4ff", faint: "#6fa8c9", grid: "#1d4470", panel: "#0d3a63", bg: "#082444", accent: "#7dd3fc", warn: "#ffcf4a", bad: "#ff8a7a", good: "#7ee0a0", thread: "#ff6b70", wood: "#c9a46c", steel: "#9aa4ae" };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const F = "Barlow, Arial, sans-serif", M = "IBM Plex Mono, monospace";

function text(x: number, y: number, s: string, o: { c?: string; size?: number; anchor?: string; mono?: boolean; weight?: number; italic?: boolean } = {}): string {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${o.c ?? C.ink}" font-size="${o.size ?? 12}" font-family="${o.mono ? M : F}" text-anchor="${o.anchor ?? "start"}"${o.weight ? ` font-weight="${o.weight}"` : ""}${o.italic ? ` font-style="italic"` : ""}>${esc(s)}</text>`;
}
function line(x0: number, y0: number, x1: number, y1: number, c = C.faint, w = 1, dash = ""): string {
  return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${c}" stroke-width="${w}" fill="none"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
}
function arrow(x0: number, y0: number, x1: number, y1: number, c: string, w = 2, head = 8): string {
  const L = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / L, uy = (y1 - y0) / L;
  const bx = x1 - ux * head, by = y1 - uy * head;
  return line(x0, y0, bx, by, c, w) + `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}L${(bx - uy * head * 0.45).toFixed(1)} ${(by + ux * head * 0.45).toFixed(1)}L${(bx + uy * head * 0.45).toFixed(1)} ${(by - ux * head * 0.45).toFixed(1)}Z" fill="${c}"/>`;
}
/** a curved arrow (moment, rotation) round (cx, cy), from angle a0 to a1 in degrees, counter-clockwise on screen if a1 < a0 */
function curl(cx: number, cy: number, r: number, a0: number, a1: number, c: string): string {
  const p = (a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1), large = Math.abs(a1 - a0) > 180 ? 1 : 0, sweep = a1 > a0 ? 1 : 0;
  const [xb, yb] = p(a1 - Math.sign(a1 - a0) * 12);
  return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${c}" stroke-width="2" fill="none"/>` + arrow(xb, yb, x1, y1, c, 2, 8).replace(/^<path[^>]*\/>/, "");
}
function svg(w: number, h: number, body: string, label: string): string {
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(label)}"><rect width="${w}" height="${h}" rx="8" fill="${C.bg}"/>${body}</svg>`;
}
const fig = (s: string, cap: string) => `<figure class="cfig">${s}<figcaption>${cap}</figcaption></figure>`;

// ------------------------------------------------------------------ 1. tension along the thread path
export function pathDiagram(r: TensionReport): string {
  const W = 760, H = 250, x0 = 40, x1 = 720, base = 190, top = 50;
  const names = [T("tension discs"), T("dancer eye"), T("PTFE tube"), T("guide tube tip")];
  const vals = [r.brake];
  r.path.forEach((s) => vals.push(vals[vals.length - 1] * s.factor));
  const k = (base - top) / vals[vals.length - 1], seg = (x1 - x0) / vals.length;
  let b = "";
  b += line(x0, base, x1, base, C.faint);
  vals.forEach((v, i) => {
    const xa = x0 + i * seg, xb = xa + seg, y = base - v * k;
    b += `<rect x="${(xa + 4).toFixed(1)}" y="${y.toFixed(1)}" width="${(seg - 8).toFixed(1)}" height="${(base - y).toFixed(1)}" fill="${C.thread}" fill-opacity="${0.25 + 0.15 * i}" stroke="${C.thread}"/>`;
    b += text((xa + xb) / 2, y - 8, `${fx(v, 3)} N`, { anchor: "middle", mono: true, size: 12.5 });
    if (i > 0) {
      const s = r.path[i - 1];
      b += text(xa, base + 18, names[i], { anchor: "middle", size: 12 });
      b += text(xa, base + 34, `×${fx(s.factor, 2)}  (θ ${fx(s.angle, 2)}, μ ${fx(s.mu, 2)})`, { anchor: "middle", size: 11, c: C.faint, mono: true });
      b += line(xa, base, xa, base + 6, C.faint);
    }
  });
  b += text(x0 + 6, base + 18, names[0], { size: 12 });
  b += text(x1, top - 22, `${T("leaves the tip at")} ${fx(vals[vals.length - 1], 3)} N`, { anchor: "end", c: C.warn, weight: 600 });
  b += text(x0, top - 22, `${T("tension in the thread")}`, { c: C.faint });
  return fig(svg(W, H, b, T("Tension along the thread path")),
    T("The tension grows at each bend: the discs give {b} N, the bends multiply it by {k} in all.", { b: fx(r.brake, 3), k: fx(r.K, 2) }));
}

// ------------------------------------------------------------------ 2. payout geometry
export function geometryDiagram(m: MachineConfig, r: TensionReport): string {
  const W = 760, H = 300, cx = 170, cy = 160, R = 120, D = 110;           // Δ drawn as 110°
  const P = (deg: number, rr = R) => [cx + rr * Math.sin((deg * Math.PI) / 180), cy - rr * Math.cos((deg * Math.PI) / 180)];
  const [gx, gy] = P(0, R - 6), [ax, ay] = P(-D);
  let b = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${C.panel}" stroke="${C.faint}"/>`;
  for (let i = 0; i < 48; i++) { const [x, y] = P(i * 7.5); b += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="${C.steel}"/>`; }
  b += line(cx, cy, ax, ay, C.faint, 1, "4 3") + line(cx, cy, gx, gy, C.faint, 1, "4 3");
  b += text(cx - 46, cy - 40, "R", { italic: true, c: C.faint });
  // the angle Δ between them
  const arcR = 34, [p0x, p0y] = P(0, arcR), [p1x, p1y] = P(-D, arcR);
  b += `<path d="M${p1x.toFixed(1)} ${p1y.toFixed(1)}A${arcR} ${arcR} 0 0 1 ${p0x.toFixed(1)} ${p0y.toFixed(1)}" stroke="${C.accent}" fill="none"/>`;
  b += text(cx - 30, cy - 22, "Δ", { c: C.accent, size: 14 });
  // the line being paid out
  b += line(ax, ay, gx, gy, C.thread, 2.5);
  b += `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="5" fill="${C.warn}"/>` + text(ax - 10, ay - 8, T("last nail"), { anchor: "end", c: C.warn });
  b += `<circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="6" fill="${C.accent}" stroke="${C.bg}" stroke-width="2"/>` + text(gx + 10, gy - 12, T("guide"), { c: C.accent });
  b += text((ax + gx) / 2 - 8, (ay + gy) / 2 + 22, "L", { italic: true, c: C.thread, size: 14 });
  // the board turns; seen from the board, the guide runs along the rim at R·ω
  b += arrow(gx, gy, gx + 70, gy, C.good, 2.5);
  b += text(gx + 74, gy + 4, "v = Rω", { c: C.good, mono: true });
  b += arrow(gx, gy + 18, gx + 44, gy + 18, C.bad, 2);
  b += text(gx + 48, gy + 22, "a = Rα", { c: C.bad, mono: true });
  b += curl(cx, cy, R + 18, 200, 150, C.faint) + text(cx - R - 30, cy + 70, "ω, α", { c: C.faint, italic: true });
  // the formulas, with numbers
  const tx = 360;
  b += text(tx, 60, "L = 2R·sin(Δ/2)", { mono: true, size: 14 });
  b += text(tx, 88, "dL/dt = R·cos(Δ/2)·ω  ≤  R·ω", { mono: true, size: 14 });
  b += text(tx, 116, "d²L/dt² = R·cos(Δ/2)·α − ½R·sin(Δ/2)·ω²  ≤  R·α", { mono: true, size: 13 });
  b += text(tx, 160, `R·ω = ${fx(m.boardMm / 2000, 2)} × ${fx((r.speed.v / (m.boardMm / 2000)), 3)} = ${fx(r.speed.v, 2)} m/s`, { mono: true, c: C.good });
  b += text(tx, 186, `R·α = ${fx(m.boardMm / 2000, 2)} × ${fx((r.speed.a / (m.boardMm / 2000)), 3)} = ${fx(r.speed.a, 2)} m/s²`, { mono: true, c: C.bad });
  b += text(tx, 226, T("Δ only grows during a turn (0 to 180°), so L only grows:"), { c: C.faint });
  b += text(tx, 244, T("the thread is always being pulled, never pushed back."), { c: C.faint });
  return fig(svg(W, H, b, T("Payout geometry")), T("Seen from the board, the guide runs round the rim; the line from the last nail to the guide is what pulls thread off the cone."));
}

// ------------------------------------------------------------------ 3. acceleration diagram
export function accelDiagram(m: MachineConfig, r: TensionReport): string {
  const run = payoutRun(m, 120, 1), Tt = run[run.length - 1].t;
  const W = 760, H = 420, x0 = 70, x1 = 730, ph = 92, gap = 34, y0 = 26;
  const X = (t: number) => x0 + ((x1 - x0) * t) / Tt;
  const panels: { key: "omega" | "v" | "a"; label: string; unit: string; color: string; bound: number; boundLabel: string }[] = [
    { key: "omega", label: T("board speed ω"), unit: "°/s", color: C.accent, bound: Math.max(...run.map((s) => s.omega)), boundLabel: "" },
    { key: "v", label: T("thread payout speed dL/dt"), unit: "m/s", color: C.good, bound: r.speed.v, boundLabel: "R·ω" },
    { key: "a", label: T("thread payout acceleration d²L/dt²"), unit: "m/s²", color: C.bad, bound: r.speed.a, boundLabel: "±R·α" }
  ];
  let b = "";
  panels.forEach((p, i) => {
    const top = y0 + i * (ph + gap), vals = run.map((s) => s[p.key]);
    const lo = p.key === "a" ? -p.bound * 1.15 : 0, hi = p.bound * 1.15;
    const Y = (v: number) => top + ph - ((v - lo) / (hi - lo)) * ph;
    b += `<rect x="${x0}" y="${top}" width="${x1 - x0}" height="${ph}" fill="${C.panel}" fill-opacity="0.5"/>`;
    b += line(x0, Y(0), x1, Y(0), C.faint);
    if (p.boundLabel) {
      b += line(x0, Y(p.bound), x1, Y(p.bound), p.color, 1, "5 4") + text(x1 - 4, Y(p.bound) - 4, `${p.boundLabel} = ${fx(p.bound, 2)} ${p.unit}`, { anchor: "end", c: p.color, size: 11, mono: true });
      if (p.key === "a") b += line(x0, Y(-p.bound), x1, Y(-p.bound), p.color, 1, "5 4");
    }
    b += `<path d="${vals.map((v, j) => `${j ? "L" : "M"}${X(run[j].t).toFixed(1)} ${Y(v).toFixed(1)}`).join("")}" stroke="${p.color}" stroke-width="2.2" fill="none"/>`;
    b += text(x0, top - 7, `${p.label} (${p.unit})`, { c: p.color, size: 12.5, weight: 600 });
    b += text(x0 - 6, Y(hi / 1.15) + 4, fx(hi / 1.15, p.key === "omega" ? 0 : 2), { anchor: "end", size: 10.5, mono: true, c: C.faint });
    b += text(x0 - 6, Y(0) + 4, "0", { anchor: "end", size: 10.5, mono: true, c: C.faint });
  });
  const bottom = y0 + 3 * ph + 2 * gap;
  for (let s = 0; s <= Tt + 1e-9; s += Tt > 4 ? 1 : 0.5) { b += line(X(s), bottom, X(s), bottom + 5, C.faint) + text(X(s), bottom + 18, fx(s, Tt > 4 ? 0 : 1), { anchor: "middle", size: 10.5, mono: true, c: C.faint }); }
  b += text((x0 + x1) / 2, bottom + 34, T("time, s"), { anchor: "middle", c: C.faint, size: 11.5 });
  const vmax = Math.max(...run.map((s) => s.v)), amax = Math.max(...run.map((s) => s.a)), amin = Math.min(...run.map((s) => s.a));
  return fig(svg(W, H, b, T("Acceleration diagram")),
    T("One 120° turn of the board, from the last nail, with the machine's own speed and acceleration. The thread's speed peaks at {v} m/s and its acceleration at {a} m/s², both inside the bounds R·ω and R·α the working uses. When the board brakes, the thread slows down ({d} m/s²): a spool turning on a pin would overrun and throw slack, a standing cone cannot.", { v: fx(vmax, 2), a: fx(amax, 2), d: fx(amin, 2) }));
}

// ------------------------------------------------------------------ 4. the spool: on a pin, and the standing cone
export function spoolDiagram(r: TensionReport): string {
  const W = 760, H = 290, sp = PARAMS.tension.pinSpool;
  let b = text(30, 30, T("Spool turning on a pin, felt brake"), { weight: 600 });
  const cx = 150, cy = 150, ro = 80, ri = 32;
  b += `<circle cx="${cx}" cy="${cy}" r="${ro}" fill="${C.panel}" stroke="${C.faint}"/><circle cx="${cx}" cy="${cy}" r="${ri}" fill="${C.bg}" stroke="${C.faint}"/><circle cx="${cx}" cy="${cy}" r="5" fill="${C.steel}"/>`;
  b += line(cx, cy, cx + ro, cy, C.faint, 1, "3 3") + text(cx + ro / 2, cy - 6, "r", { italic: true, c: C.faint, anchor: "middle" });
  b += arrow(cx + ro, cy, cx + ro, cy - 105, C.thread, 2.5);
  b += text(cx + ro + 8, cy - 92, "T", { c: C.thread, italic: true, size: 15 });
  b += curl(cx, cy, ri + 18, 130, 210, C.warn) + text(cx - 72, cy + 58, T("brake M"), { c: C.warn, size: 12 });
  b += curl(cx, cy, ri + 30, -20, -100, C.bad) + text(cx + 26, cy - 72, "I·α", { c: C.bad, italic: true });
  b += text(30, 258, "T = M/r + I·a/r²", { mono: true, size: 13.5 });
  b += text(30, 278, `r ${sp.rOuter} → ${sp.rCore} mm:  T × ${fx(r.emptying, 1)}`, { mono: true, size: 12.5, c: C.bad });
  // the standing cone
  const ox = 420;
  b += text(ox, 30, T("Standing cone, tension discs"), { weight: 600 });
  const bx = ox + 90, by = 240;
  b += `<path d="M${bx - 45} ${by}L${bx - 30} ${by - 120}L${bx + 30} ${by - 120}L${bx + 45} ${by}Z" fill="${C.panel}" stroke="${C.faint}"/>`;
  b += line(ox + 30, by, ox + 160, by, C.faint, 2);
  const ey = 60;
  b += `<circle cx="${bx}" cy="${ey}" r="6" fill="none" stroke="${C.accent}" stroke-width="2"/>` + text(bx + 12, ey - 6, T("eyelet"), { c: C.accent, size: 12 });
  b += `<path d="M${bx + 22} ${by - 118}C${bx + 50} ${by - 170},${bx + 10} ${ey + 40},${bx} ${ey + 6}" stroke="${C.thread}" stroke-width="2" fill="none" stroke-dasharray="1 0"/>`;
  b += text(bx + 40, by - 150, T("balloon"), { c: C.faint, size: 11.5 });
  const dx = bx + 120, dy = 110;
  b += `<rect x="${dx - 3}" y="${dy - 24}" width="6" height="48" fill="${C.steel}"/><rect x="${dx + 5}" y="${dy - 24}" width="6" height="48" fill="${C.steel}"/>`;
  b += arrow(dx + 34, dy, dx + 13, dy, C.warn, 2) + text(dx + 38, dy + 4, T("spring"), { c: C.warn, size: 12 });
  b += `<path d="M${bx} ${ey}L${dx + 4} ${dy - 30}L${dx + 4} ${dy + 30}" stroke="${C.thread}" stroke-width="2" fill="none"/>`;
  b += arrow(dx + 4, dy + 30, dx + 4, dy + 80, C.thread, 2.5) + text(dx + 12, dy + 72, "T", { c: C.thread, italic: true, size: 15 });
  b += text(ox, 258, `T ≈ ${T("disc friction")} ± ${fx(PARAMS.tension.coneVariation * 100, 0)} %`, { mono: true, size: 13.5 });
  b += text(ox, 278, `I·a ≈ ${fx(r.inertia.cone * 1e6, 0)}·10⁻⁶ N`, { mono: true, size: 12.5, c: C.good });
  return fig(svg(W, H, b, T("The spool's forces")), T("On a pin, the brake's torque divides by a radius that shrinks as the spool empties, and the spool's inertia adds {i} N. On a standing cone nothing turns: the tension comes from the discs alone.", { i: fx(r.inertia.pinFull, 3) }));
}

// ------------------------------------------------------------------ 5. sag
export function sagDiagram(r: TensionReport): string {
  const W = 760, H = 220, x0 = 80, x1 = 680, y = 70, sag = 70;   // the sag drawn greatly enlarged
  let b = `<rect x="${x0 - 4}" y="${y - 30}" width="8" height="34" fill="${C.steel}"/><rect x="${x1 - 4}" y="${y - 30}" width="8" height="34" fill="${C.steel}"/>`;
  b += `<path d="M${x0} ${y}Q${(x0 + x1) / 2} ${y + 2 * sag} ${x1} ${y}" stroke="${C.thread}" stroke-width="2.5" fill="none"/>`;
  for (let i = 1; i < 10; i++) {
    const t = i / 10, x = x0 + (x1 - x0) * t, yy = y + 4 * sag * t * (1 - t);
    b += arrow(x, yy + 4, x, yy + 26, C.faint, 1.2, 6);
  }
  b += text(x1 - 120, y + 46, "w = λ·g", { mono: true, c: C.faint });
  b += arrow(x0, y, x0 - 50, y - 12, C.thread, 2.2) + text(x0 - 56, y - 18, "T", { italic: true, c: C.thread, anchor: "end", size: 15 });
  b += arrow(x1, y, x1 + 50, y - 12, C.thread, 2.2) + text(x1 + 56, y - 18, "T", { italic: true, c: C.thread, size: 15 });
  b += line(x0, y, x1, y, C.faint, 1, "4 4");
  b += arrow((x0 + x1) / 2, y + 2, (x0 + x1) / 2, y + sag - 2, C.warn, 1.6, 6) + text((x0 + x1) / 2 + 8, y + sag / 2 + 4, "δ", { c: C.warn, italic: true, size: 15 });
  b += line(x0, 176, x1, 176, C.faint) + text((x0 + x1) / 2, 192, `L = ${fx(r.sag.L, 2)} m`, { anchor: "middle", mono: true });
  b += text(x0, 30, `δ = w·L² / (8T) = ${fx(r.sag.w * 1e4, 2)}·10⁻⁴ × ${fx(r.sag.L, 2)}² / (8 × ${fx(r.target, 2)}) = ${fx(r.sag.at, 3)} mm`, { mono: true, size: 12.5 });
  return fig(svg(W, H, b, T("Sag of the longest line")), T("A line sags until the tension's slight downward tilt at each end carries its weight. The sag is drawn hundreds of times larger: at {t} N it is {s} mm.", { t: fx(r.target, 2), s: fx(r.sag.at, 3) }));
}

// ------------------------------------------------------------------ 6. the busiest nail
export function nailDiagram(m: MachineConfig, r: TensionReport): string {
  const W = 760, H = 330;
  // top view: the nail at the top of the ring, two legs into the board, their resultant
  const cx = 190, cy = 220, R = 170, nx = cx, ny = cy - R;
  let b = text(30, 28, T("Seen from above"), { weight: 600 });
  b += `<path d="M${cx - R * Math.sin(0.9)} ${cy - R * Math.cos(0.9)}A${R} ${R} 0 0 1 ${cx + R * Math.sin(0.9)} ${cy - R * Math.cos(0.9)}" stroke="${C.faint}" fill="none" stroke-dasharray="4 4"/>`;
  const legs = [70, 140];          // Δ of the two lines, degrees
  const s = r.nail.s;
  let fx_ = 0, fy_ = 0;
  legs.forEach((D, i) => {
    const sign = i ? -1 : 1, ang = ((90 - D / 2) * Math.PI) / 180;   // from straight inward (down on screen)
    const ux = sign * Math.sin(ang), uy = Math.cos(ang), L = 95;
    b += arrow(nx, ny, nx + ux * L, ny + uy * L, C.thread, 2.4);
    b += text(nx + ux * (L + 14), ny + uy * (L + 14) + 4, "T", { c: C.thread, italic: true, anchor: "middle", size: 15 });
    b += text(nx + ux * 52 + sign * 12, ny + uy * 52 - 8, `${90 - D / 2}°`, { c: C.faint, size: 11, anchor: sign > 0 ? "start" : "end", mono: true });
    fx_ += ux; fy_ += uy;
  });
  b += line(nx, ny, nx, ny + 150, C.faint, 1, "3 3");
  b += arrow(nx, ny, nx + fx_ * 60, ny + fy_ * 60, C.warn, 3);
  b += text(nx + fx_ * 60 + 10, ny + fy_ * 60 + 16, T("resultant"), { c: C.warn, size: 12 });
  b += `<circle cx="${nx}" cy="${ny}" r="6" fill="${C.steel}" stroke="${C.bg}" stroke-width="2"/>`;
  b += text(30, 312, `F = 2·s·n·T,  s = ${fx(s, 3)},  n = ${r.nail.n}  →  F = ${fx(r.nail.forcePerT, 1)}·T`, { mono: true, size: 12.5 });
  // side view: a cantilever
  const ox = 440, gy = 250, nh = 170, hpx = (r.nail.h / m.nailHeightMm) * nh * 0.9;
  b += text(ox, 28, T("Seen from the side"), { weight: 600 });
  b += `<rect x="${ox}" y="${gy}" width="280" height="40" fill="${C.wood}" fill-opacity="0.55"/>`;
  b += text(ox + 8, gy + 26, T("board"), { c: C.bg, size: 12, weight: 600 });
  const nxs = ox + 120;
  b += `<rect x="${nxs - 5}" y="${gy - nh}" width="10" height="${nh + 30}" fill="${C.steel}"/>`;
  const z0 = (m.zStartMm / m.nailHeightMm) * nh, z1 = ((m.zStartMm + m.layerMm * (r.nail.n - 1)) / m.nailHeightMm) * nh;
  for (let i = 0; i < Math.min(r.nail.n, 12); i++) {
    const z = z0 + ((z1 - z0) * i) / Math.max(1, Math.min(r.nail.n, 12) - 1);
    b += `<ellipse cx="${nxs}" cy="${(gy - z).toFixed(1)}" rx="11" ry="2.4" fill="none" stroke="${C.thread}" stroke-width="1.4"/>`;
  }
  const fy = gy - hpx + 10;
  b += arrow(nxs + 12, fy, nxs + 110, fy, C.warn, 3) + text(nxs + 116, fy + 5, "F", { c: C.warn, italic: true, size: 15 });
  b += line(nxs - 40, gy + 10, nxs - 40, fy, C.accent) + line(nxs - 46, gy + 10, nxs - 34, gy + 10, C.accent) + line(nxs - 46, fy, nxs - 34, fy, C.accent);
  b += text(nxs - 48, (gy + fy) / 2 + 4, `h = ${fx(r.nail.h, 1)} mm`, { anchor: "end", c: C.accent, mono: true, size: 12 });
  b += curl(nxs, gy + 10, 26, 200, 330, C.bad) + text(nxs + 34, gy + 2, "M", { c: C.bad, italic: true, size: 15 });
  b += text(ox, 312, `M = F·h ≤ σ·π·d³/32  →  T ≤ ${fx(r.nailLimit, 2)} N`, { mono: true, size: 12.5 });
  return fig(svg(W, H, b, T("Forces on the busiest nail")),
    T("Each wrap's two legs pull into the board; their sideways parts mostly cancel and the inward parts add up to F. F acts {h} mm above where the nail is held, bending it: the steel must not yield.", { h: fx(r.nail.h, 1) }));
}

// ------------------------------------------------------------------ 7. the tension window
export function windowDiagram(r: TensionReport): string {
  const W = 760, H = 250, x0 = 40, x1 = 720, y = 140;
  const max = Math.max(r.pinSteadyEmpty, r.peak.pin, r.nailLimit, r.target) * 1.12;
  const X = (v: number) => x0 + ((x1 - x0) * v) / max;
  const open = r.sag.minT < r.nailLimit;
  let b = `<rect x="${X(0)}" y="${y - 20}" width="${X(max) - X(0)}" height="40" fill="${C.panel}"/>`;
  if (open) b += `<rect x="${X(r.sag.minT)}" y="${y - 20}" width="${X(r.nailLimit) - X(r.sag.minT)}" height="40" fill="${C.good}" fill-opacity="0.28" stroke="${C.good}"/>`;
  b += text(X(open ? (r.sag.minT + r.nailLimit) / 2 : r.sag.minT), y - 28, open ? T("window") : T("no window"), { anchor: "middle", c: open ? C.good : C.bad, weight: 600 });
  const placed: { x: number; row: number; up: boolean }[] = [];
  const mark = (v: number, label: string, c: string, up: boolean, dash = "") => {
    const x = X(v);
    let row = 0;
    while (placed.some((q) => q.up === up && q.row === row && Math.abs(q.x - x) < 90)) row++;
    placed.push({ x, row, up });
    const o = row * 28, ly = up ? y - 46 - o : y + 42 + o, vy = up ? y - 60 - o : y + 56 + o;
    return line(x, y - 24, x, y + 24, c, 2.4, dash) + text(x, ly, label, { anchor: "middle", c, size: 11.5 }) + text(x, vy, `${fx(v, 2)} N`, { anchor: "middle", c, size: 11, mono: true });
  };
  b += mark(r.sag.minT, T("straight lines"), C.good, false, "4 3");
  b += mark(r.nailLimit, T("nail bends"), C.bad, false, "4 3");
  b += mark(r.target, T("set"), C.accent, true);
  b += mark(r.peak.cone, T("peak, cone"), C.warn, true);
  b += mark(r.peak.pin, T("peak, spool on pin"), C.bad, true);
  for (let v = 0; v <= max; v += max > 2 ? 0.5 : 0.25) b += line(X(v), y + 20, X(v), y + 26, C.faint) + text(X(v), y + 104, fx(v, 2), { anchor: "middle", size: 10, mono: true, c: C.faint });
  return fig(svg(W, H, b, T("The tension window")), T("The tension must sit between what keeps lines straight and what bends the busiest nail. The peaks show why the thread stands on a cone."));
}

// ------------------------------------------------------------------ 8. thread strength against diameter
export function strengthDiagram(m: MachineConfig, r: TensionReport): string {
  const t = PARAMS.tension, W = 760, H = 300, x0 = 70, x1 = 720, y0 = 30, y1 = 250, dmax = 0.4;
  const ymax = Math.max(r.required.pin * 2.2, 8);
  const X = (d: number) => x0 + ((x1 - x0) * d) / dmax, Y = (f: number) => y1 - ((y1 - y0) * f) / ymax;
  const colors: Record<string, string> = { polyester: C.accent, nylon: C.good, cotton: C.warn };
  const name: Record<string, string> = { polyester: T("polyester"), nylon: T("nylon"), cotton: T("cotton") };
  // the curves run off the top of the plot rather than flattening, which would read as a strength limit
  let b = `<defs><clipPath id="sa-strength-plot"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/></clipPath></defs>`
    + `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${C.panel}" fill-opacity="0.5"/>`;
  for (let d = 0; d <= dmax + 1e-9; d += 0.05) b += line(X(d), y1, X(d), y1 + 5, C.faint) + text(X(d), y1 + 18, fx(d, 2), { anchor: "middle", size: 10.5, mono: true, c: C.faint });
  const fstep = ymax > 20 ? 5 : 2;
  for (let f = 0; f <= ymax; f += fstep) b += line(x0, Y(f), x1, Y(f), C.grid) + text(x0 - 6, Y(f) + 4, String(f), { anchor: "end", size: 10.5, mono: true, c: C.faint });
  (["polyester", "nylon", "cotton"] as const).forEach((f, i) => {
    const fb = t.fibres[f], pts: string[] = [];
    for (let k = 0; k <= 80; k++) { const d = (dmax * k) / 80, F = texOf(d, fb.density, t.packing) * fb.tenacity; pts.push(`${k ? "L" : "M"}${X(d).toFixed(1)} ${Y(F).toFixed(1)}`); }
    b += `<path d="${pts.join("")}" stroke="${colors[f]}" stroke-width="2.2" fill="none" clip-path="url(#sa-strength-plot)"/>`;
    b += text(x0 + 12, y0 + 18 + i * 16, name[f], { c: colors[f], size: 12 });
  });
  const req = (v: number, label: string, c: string) => line(x0, Y(v), x1, Y(v), c, 1.4, "6 4") + text(x1 - 4, Y(v) - 5, `${label}: ${fx(v, 2)} N`, { anchor: "end", c, size: 11.5 });
  b += req(r.required.cone, T("needed, standing cone"), C.ink) + req(r.required.pin, T("needed, spool on a pin"), C.bad);
  b += line(X(t.practicalMinMm), y0, X(t.practicalMinMm), y1, C.faint, 1.4, "3 3") + text(X(t.practicalMinMm) + 4, y1 - 8, T("app minimum"), { size: 11, c: C.faint });
  if (m.threadMm <= dmax) b += line(X(m.threadMm), y0, X(m.threadMm), y1, C.thread, 2) + text(X(m.threadMm) + 4, y1 - 22, T("your thread"), { size: 11.5, c: C.thread });
  b += text((x0 + x1) / 2, y1 + 36, T("thread diameter, mm"), { anchor: "middle", c: C.faint, size: 11.5 });
  b += text(x0 - 46, y0 - 10, T("breaking strength, N"), { c: C.faint, size: 11.5 });
  return fig(svg(W, H, b, T("Thread strength against diameter")), T("Strength grows with the square of the diameter. Where a fibre's curve crosses a dashed line is the thinnest thread of that fibre that is safe."));
}

