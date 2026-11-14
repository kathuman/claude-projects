// Escapement geometry checks — run with: node escapement/tests/escapement.test.js
// The Graham escapement works as drawn: over whole beats, sampled finely, no tooth passes into a pallet or the anchor
// and no part of the anchor passes into the wheel; while the wheel is locked a tooth tip rests on a locking face, and
// that face is an arc about the anchor's pivot (deadbeat: no recoil); the lift and the pallets' size are those of a
// real Graham escapement.
const C = require("../src/clock.js"), E = require("../src/escapement.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const DEG = Math.PI / 180;

const d = C.derive(), g = E.setup(d), G = E.geometry(d), an = E.anchor(g);

// ---- geometry helpers
function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function edgeDist(pt, poly) {
  let m = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j], [x2, y2] = poly[i], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((pt[0] - x1) * dx + (pt[1] - y1) * dy) / l2)) : 0;
    m = Math.min(m, Math.hypot(pt[0] - x1 - u * dx, pt[1] - y1 - u * dy));
  }
  return m;
}
const depth = (pt, poly) => (inside(pt, poly) ? edgeDist(pt, poly) : 0);   // how far a point has gone into a shape
const rot = (pts, a, cx, cy) => pts.map(([x, y]) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]);
// densify an outline so edges, not only corners, are tested
function dense(poly, step) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}

// ---- the shapes
check("the wheel has 30 teeth, leaning forward", G.wheel.length % 30 === 0 && G.lean > 5 * DEG && G.lean < 20 * DEG);
const rs = G.wheel.map((p) => Math.hypot(p[0], p[1]));
check("the teeth reach the tip circle and the root circle", Math.abs(Math.max(...rs) - d.spec.escapeTipRadius) < 1e-9 && Math.abs(Math.min(...rs) - d.spec.escapeRootRadius) < 1e-9);
check("lift (the swing over which the impulse acts) is about two degrees", 2 * G.lift > 1.5 * DEG && 2 * G.lift < 3 * DEG, (2 * G.lift / DEG).toFixed(2) + "°");
const w = (pl) => pl.rOut - pl.rIn;
check("each pallet is about half a tooth pitch wide", [an.entry, an.exit].every((pl) => Math.abs(w(pl) - g.R * g.pitch / 2) < 0.12 * g.R * g.pitch), [w(an.entry), w(an.exit)].map((v) => v.toFixed(2)).join(", ") + " mm");
check("the entry pallet locks on its outer face, the exit pallet on its inner face", an.entry.lockRadius > an.entry.otherRadius && an.exit.lockRadius < an.exit.otherRadius);
check("the pallets are mirror images about the line of centres", Math.abs(an.entry.lockRadius - an.exit.otherRadius) < 0.05 && Math.abs(an.entry.otherRadius - an.exit.lockRadius) < 0.05,
  [an.entry.lockRadius, an.entry.otherRadius, an.exit.lockRadius, an.exit.otherRadius].map((v) => v.toFixed(3)).join(" / "));

// ---- over two beats: nothing passes through anything
const wheelD = dense(G.wheel, 0.15), anchorShapes = [G.entry, G.exit].concat(G.arms), anchorD = anchorShapes.map((s) => dense(s, 0.15));
const TOL = 0.03;   // mm: the tracing is sampled, so contact may show as a few hundredths of overlap
let worstTooth = 0, worstAnchor = 0, whenT = 0, whenA = 0;
const T = d.spec.pendulum.period, STEPS = 1600;
for (let i = 0; i <= STEPS; i++) {
  const t = -T / 2 + (2 * T) * i / STEPS, p = C.pose(t, d);
  const wheel = rot(G.wheel, -p.escape, 0, 0), wheelPts = rot(wheelD, -p.escape, 0, 0);
  const shapes = anchorShapes.map((s) => rot(s, -p.anchor, 0, g.Dp)), shapePts = anchorD.map((s) => rot(s, -p.anchor, 0, g.Dp));
  for (const pt of wheelPts) for (const s of shapes) { const dd = depth(pt, s); if (dd > worstTooth) { worstTooth = dd; whenT = t; } }
  for (const sp of shapePts) for (const pt of sp) { const dd = depth(pt, wheel); if (dd > worstAnchor) { worstAnchor = dd; whenA = t; } }
}
check("no tooth passes into a pallet or the anchor", worstTooth <= TOL, worstTooth.toFixed(3) + " mm at t = " + whenT.toFixed(3));
check("no part of the anchor passes into the wheel", worstAnchor <= TOL, worstAnchor.toFixed(3) + " mm at t = " + whenA.toFixed(3));

// ---- while locked, a tooth rests on a locking face, and the face is an arc about the pallet arbor (no recoil)
function restingGap(t) {
  const p = C.pose(t, d), tips = [];
  for (let j = 0; j < g.N; j++) { const a = g.phase + j * g.pitch - p.escape; tips.push([g.R * Math.cos(a), g.R * Math.sin(a)]); }
  const shapes = [G.entry, G.exit].map((s) => rot(s, -p.anchor, 0, g.Dp));
  return Math.min(...tips.map((tp) => Math.min(...shapes.map((s) => edgeDist(tp, s)))));
}
const lockTimes = [0.15, 0.25, 0.35, 0.65, 0.75, 0.85].map((f) => f * T);   // well inside the locked part of each beat
const gaps = lockTimes.map(restingGap);
check("while the wheel is locked a tooth tip rests on a pallet", gaps.every((v) => v < 0.02), gaps.map((v) => v.toFixed(3)).join(", "));
const radii = [0.15, 0.25, 0.35].map((f) => { const q = E.tipInAnchor(g, g.phase, f * T - T / 2); return Math.hypot(q[0], q[1]); });
check("the locking face is an arc about the pallet arbor (deadbeat)", Math.max(...radii) - Math.min(...radii) < 1e-9, radii.map((v) => v.toFixed(4)).join(", "));

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
