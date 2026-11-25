// The animation timelines, the sensitivity sweeps and the demand-shock
// experiment — run with:  node warehouse-compare/tests/experiments.test.js
const path = require("path");
const fs = require("fs");
const scenario = require("../src/scenario.js");
const replay = require("../src/replay.js");
const ex = require("../src/experiments.js");
const kpi = require("../src/kpi.js");
const { check, near, summary } = require("./harness.js");

const J = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/scenario.json"), "utf8"));
const inputs = scenario.resolve(J, JSON.parse(fs.readFileSync(path.join(__dirname, "../../warehouse-model/data/parameters.json"), "utf8")));
const sc = inputs.sc, res = scenario.run(inputs);
const last = (l) => l.pts[l.pts.length - 1];
const len = (l) => l.cum[l.cum.length - 1];
const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

// ---------------------------------------------------------------- WH-B / WH-C pickers
["B", "C"].forEach((id) => {
  const r = replay.pickers(res[id], sc), L = res[id].layout;
  check(id + ": one mover per picker (" + r.movers.length + ")", r.movers.length === res[id].kpi.pickersNeeded);
  let overlap = 0, jump = 0, speed = 0, outside = 0;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  L.outline.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
  r.movers.forEach((m) => m.legs.forEach((l, k) => {
    if (k > 0 && l.t0 < m.legs[k - 1].t1 - 1e-9) overlap++;
    if (k > 0 && !same(l.pts[0], last(m.legs[k - 1]))) jump++;
    // arcs are sampled, so a leg's polyline is a hair shorter than the true path
    if (Math.abs((l.t1 - l.t0) * sc.picker_speed - len(l)) > 0.01 * len(l) + 1e-6) speed++;
    l.pts.forEach((p) => { if (p[0] < x0 - 1e-6 || p[0] > x1 + 1e-6 || p[1] < y0 - 1e-6 || p[1] > y1 + 1e-6) outside++; });
  }));
  check(id + ": a picker never does two things at once", overlap === 0, overlap);
  check(id + ": a picker walks on from where it stopped", jump === 0, jump);
  check(id + ": legs take length ÷ picker speed", speed === 0, speed);
  check(id + ": every path inside the building", outside === 0, outside);
  const lines = replay.linesBy(r, r.window), expect = res[id].kpi.locations ? sc.lines_per_day / sc.operating_hours_per_day * sc.peak_hour_factor * r.window / 3600 : 0;
  check(id + ": lines picked in the window ≈ peak demand (" + lines + " vs " + expect.toFixed(0) + ")", Math.abs(lines / expect - 1) < 0.2);
  const m = r.movers.find((mm) => mm.legs.length > 2), l = m.legs[1], mid = replay.at(m, (l.t0 + l.t1) / 2);
  check(id + ": mid-leg position lies on the leg's path", mid.moving && l.pts.some((p, i) => i > 0 && segDist(l.pts[i - 1], p, [mid.x, mid.y]) < 1e-6));
  const before = replay.at(m, m.legs[0].t0 - 1e-3);
  check(id + ": before its first leg a picker stands where that leg starts", m.legs[0].t0 <= 0 || same([before.x, before.y], m.legs[0].pts[0]));
});
function segDist(a, b, p) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

// ---------------------------------------------------------------- WH-A robots
{
  const A = inputs.layouts.A, r = replay.robots(res.A, sc, A), L = res.A.layout;
  check("A: one mover per working robot (" + r.movers.length + ")", r.movers.length === res.A.sizing.robotsActive);
  let overlap = 0, jump = 0, speed = 0, ends = 0, starts = 0;
  r.movers.forEach((m) => m.legs.forEach((l, k) => {
    if (k > 0 && l.t0 < m.legs[k - 1].t1 - 1e-9) overlap++;
    if (k > 0 && !same(l.pts[0], last(m.legs[k - 1]))) jump++;
    if (k === 0 && l.t0 > 0 && !same(l.pts[0], m.start)) starts++;
    if (Math.abs((l.t1 - l.t0) * A.robot_speed - len(l)) > 1e-6) speed++;
    if (l.kind === "toStation" && !L.stations.some((s) => same(s, last(l)))) ends++;
    if (l.kind === "toSlot" && !L.slots.some((s) => same([s.x, s.y], last(l)))) ends++;
  }));
  check("A: a robot never does two things at once", overlap === 0, overlap);
  check("A: a robot moves on from where it stopped (empty → under the pod → station → slot → …)", jump === 0, jump);
  check("A: a robot's first move starts where it stood when the window opened", starts === 0, starts);
  check("A: loaded paths are exactly the simulation's distances (length = time × speed)", speed === 0, speed);
  check("A: loaded legs end at a station or a slot", ends === 0, ends);
  check("A: empty legs run along x, then y (under the parked pods)", r.movers.every((m) => m.legs.filter((l) => l.kind === "empty").every((l) => l.pts.length === 3 && near(l.pts[0][1], l.pts[1][1]) && near(l.pts[1][0], l.pts[2][0]))));
  const lines = replay.linesBy(r, r.window), expect = res.A.sizing.peakLines * r.window / 3600;
  check("A: lines picked in the window ≈ peak demand (" + lines + " vs " + expect.toFixed(0) + ")", Math.abs(lines / expect - 1) < 0.2);
}

// ---------------------------------------------------------------- sensitivity sweeps
{
  const vol = ex.SWEEPS.find((s) => s.key === "lines_per_day").values.map((v) => ex.point(inputs, "lines_per_day", v));
  ["A", "B", "C"].forEach((id) => {
    const p = vol.map((x) => x[id].pickersNeeded);
    check(id + ": more lines a day never needs fewer pickers (" + p.join(" → ") + ")", p.every((v, i) => i === 0 || v >= p[i - 1]));
  });
  const rb = vol.map((x) => x.A.robotsNeeded);
  check("A: more lines a day never needs fewer robots (" + rb.join(" → ") + ")", rb.every((v, i) => i === 0 || v >= rb[i - 1]));
  const cap = ex.SWEEPS.find((s) => s.key === "target_locations").values.map((v) => ex.point(inputs, "target_locations", v));
  ["A", "B", "C"].forEach((id) => {
    const f = cap.map((x) => Math.round(x[id].footprint));
    check(id + ": more locations never need less floor (" + f.join(" → ") + ")", f.every((v, i) => i === 0 || v >= f[i - 1]));
  });
  const base = ex.point(inputs, "demand_skew", sc.demand_skew);
  check("a sweep point at the current value reproduces the main result", ["A", "B", "C"].every((id) => base[id].timePerLine === res[id].kpi.timePerLine));
  check("sweeping doesn't change the inputs it was given", JSON.stringify(inputs.sc) === JSON.stringify(scenario.resolve(J, JSON.parse(fs.readFileSync(path.join(__dirname, "../../warehouse-model/data/parameters.json"), "utf8"))).sc));
}

// ---------------------------------------------------------------- the demand shock
{
  check("a zero shift changes nothing", kpi.evaluate(res.C.layout, sc, { shift: 0 }).kpi.travelPerLine === res.C.kpi.travelPerLine);
  const s = ex.shock(inputs, res);
  ["B", "C"].forEach((id) => check(id + ": with slotting left as it was, the shock costs travel (" + s.static[id].before.toFixed(1) + " → " + s.static[id].after.toFixed(1) + " m/line)", s.static[id].after > 1.3 * s.static[id].before));
  const rnd = Object.assign({}, sc, { slotting: "random" }), rc = kpi.evaluate(res.C.layout, rnd), rs = kpi.evaluate(res.C.layout, rnd, { shift: 0.5 });
  check("C: random slotting doesn't care which SKUs are popular (" + rc.kpi.travelPerLine.toFixed(1) + " vs " + rs.kpi.travelPerLine.toFixed(1) + ")", Math.abs(rs.kpi.travelPerLine / rc.kpi.travelPerLine - 1) < 0.05);
  const m = (pa, a, b) => ex.mean(s.series[pa], "travel", a, b), at = s.at;
  check("A fixed: robots travel much further after the shock (" + m("fixed", at - 2, at).toFixed(1) + " → " + m("fixed", at + 2, at + 4).toFixed(1) + ")", m("fixed", at + 2, at + 4) > 1.2 * m("fixed", at - 2, at));
  check("A frequency: robots travel about as far after the shock (" + m("frequency", at - 2, at).toFixed(1) + " → " + m("frequency", at + 2, at + 4).toFixed(1) + ")", m("frequency", at + 2, at + 4) < 1.12 * m("frequency", at - 2, at));
  check("every policy ran on the same fleet", s.robots === res.A.sizing.robotsActive);
  check("series cover the whole run in equal steps", ex.POLICIES.every((pa) => s.series[pa].length === s.series.fixed.length && near(s.series[pa][s.series[pa].length - 1].t, at + s.after, 1e-9)));
}

summary("experiments");
