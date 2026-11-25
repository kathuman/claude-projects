// WH-B, the semicircular warehouse: exact travel distances, physically valid
// geometry, equal-capacity sizing — run with:  node warehouse-compare/tests/whb.test.js
const path = require("path");
const fs = require("fs");
const whb = require("../src/layouts/whb.js");
const kpi = require("../src/kpi.js");
const scenario = require("../src/scenario.js");
const { check, near, summary } = require("./harness.js");

const scJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/scenario.json"), "utf8"));
const whJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../../warehouse-model/data/parameters.json"), "utf8"));
const inputs = scenario.resolve(scJson, whJson);
const B0 = inputs.layouts.B;

let s = 2024; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

// ---------------------------------------------------------------- geometry helpers
function rectDist(b, px, py) {             // distance from a point to a bay (negative inside)
  const rx = px - b.cx, ry = py - b.cy;
  const du = Math.abs(rx * b.ux + ry * b.uy) - b.w / 2, dv = Math.abs(-rx * b.uy + ry * b.ux) - b.d / 2;
  return du > 0 || dv > 0 ? Math.hypot(Math.max(du, 0), Math.max(dv, 0)) : Math.max(du, dv);
}
function overlap(a, b) {                   // separating-axis test on two rectangles (touching is fine)
  const A = whb.corners(a), Bc = whb.corners(b);
  const axes = [[a.ux, a.uy], [-a.uy, a.ux], [b.ux, b.uy], [-b.uy, b.ux]];
  for (const [ax, ay] of axes) {
    const pa = A.map((q) => q[0] * ax + q[1] * ay), pb = Bc.map((q) => q[0] * ax + q[1] * ay);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6) return false;
  }
  return true;
}
function gap(a, b) {                       // distance between two disjoint rectangles
  return Math.min(...whb.corners(a).map((q) => rectDist(b, q[0], q[1])), ...whb.corners(b).map((q) => rectDist(a, q[0], q[1])));
}
function grid(bays, cell) {
  const m = new Map();
  bays.forEach((b, i) => { const k = Math.floor(b.cx / cell) + "," + Math.floor(b.cy / cell); if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
  return function near(x, y) {
    const out = [], cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = m.get((cx + i) + "," + (cy + j)); if (l) out.push(...l); }
    return out;
  };
}

function checkGeometry(L, label) {
  const p = L.params, bays = L.bays, cell = Math.max(p.bay_width, 2 * p.rack_depth + p.aisle_width) + 1;
  const near = grid(bays, cell);
  let overlaps = 0, outside = 0, inHub = 0, flue = Infinity;
  bays.forEach((b, i) => {
    near(b.cx, b.cy).forEach((j) => {
      if (j <= i) return;
      if (overlap(b, bays[j])) overlaps++;
      else if (bays[j].group !== b.group) flue = Math.min(flue, gap(b, bays[j]));
    });
    whb.corners(b).forEach((q) => {
      if (q[1] < -1e-9 || Math.hypot(q[0], q[1]) > L.radius + 1e-9) outside++;
      if (Math.hypot(q[0], q[1]) < p.hub_radius - p.bay_width * p.bay_width / (8 * p.hub_radius) - 1e-9) inHub++;
    });
  });
  check(label + ": no two bays overlap", overlaps === 0, overlaps);
  // neighbouring units keep the flue gap (chord bays may bow into it by ≤ w²/8r on arcs)
  const flueTol = (p.arrangement === "concentric" ? p.bay_width * p.bay_width / (8 * p.hub_radius) : 0) + 1e-6;
  check(label + ": units at least a flue apart (closest " + (flue === Infinity ? "—" : flue.toFixed(3)) + " m, flue " + p.flue_space + ")", flue >= p.flue_space - flueTol);
  check(label + ": every bay inside the building", outside === 0, outside);
  check(label + ": no bay in the hub", inHub === 0, inHub);

  // walk every path in the travel network: aisles keep their clear width
  const g = L.graph, aisleHalf = Math.min(p.aisle_width, p.arrangement === "concentric" ? p.radial_aisle_width : p.ring_aisle_width) / 2;
  const tol = p.bay_width * p.bay_width / (8 * p.hub_radius) + 1e-6;       // a chord bay's face bows into an arc aisle by ≤ w²/8r
  let worst = Infinity, hubInside = 0;
  g.edges.forEach((e) => {
    const hubEdge = g.kind[e[0]] !== "access" && g.kind[e[1]] !== "access" && (g.kind[e[0]] === "depot" || g.kind[e[1]] === "depot" || (g.kind[e[0]] === "mouth" && g.kind[e[1]] === "mouth"));
    const steps = Math.max(2, Math.ceil(e[2] / 0.25));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps; let x, y;
      if (e[3]) { const a = e[3].t0 + (e[3].t1 - e[3].t0) * t; x = e[3].cx + e[3].r * Math.cos(a); y = e[3].cy + e[3].r * Math.sin(a); }
      else { x = g.x[e[0]] + (g.x[e[1]] - g.x[e[0]]) * t; y = g.y[e[0]] + (g.y[e[1]] - g.y[e[0]]) * t; }
      near(x, y).forEach((j) => {
        const d = rectDist(bays[j], x, y);
        if (hubEdge) { if (d < -1e-9) hubInside++; } else worst = Math.min(worst, d);
      });
    }
  });
  check(label + ": aisles keep half their width clear (closest bay " + (worst === Infinity ? "—" : worst.toFixed(3)) + " m, need " + (aisleHalf - tol).toFixed(3) + ")", worst >= aisleHalf - tol);
  check(label + ": hub paths cross open floor", hubInside === 0, hubInside);
  check(label + ": travel network connected", g.connected());
}

// From a single picking point at the hub centre, every access point's distance has a closed form.
function checkExact(p, label) {
  const L = whb.build(p, { depotsAt: [0], matrix: false }), g = L.graph, pl = L.plan;
  const d = g.dijkstra(g.keys[L.depots[0]]);
  let worst = 0, n = 0, euclid = 0;
  for (let v = 0; v < g.size(); v++) if (isFinite(d[v])) euclid = Math.min(euclid, d[v] - Math.hypot(g.x[v], g.y[v]));
  if (pl.kind === "radial") {
    const th0 = pl.zones[0] ? pl.zones[0].units.map((u) => u.theta) : [];
    pl.zones.forEach((zn, z) => {
      if (z > 1) return;
      zn.units.forEach((u) => {
        u.bays.forEach((b) => {
          const node = g.keys[L.locations.key[L.bays[pl.bays.indexOf(b)].loc0]];
          // zone 0: straight out, = radius. zone 1: out to ring 1, along it, then out.
          const want = z === 0 ? b.at : b.at + pl.rings[1] * Math.min(...th0.map((t) => Math.abs(t - u.theta)));
          worst = Math.max(worst, Math.abs(d[node] - want)); n++;
        });
      });
    });
    check(label + ": radial distances = closed form for zones 1–2 (" + n + " stops, worst " + worst.toExponential(1) + " m)", n === 0 || worst < 1e-6);
  } else {
    L.bays.forEach((b, i) => {
      const pb = pl.bays[i], u = pl.units[pb.unit], node = g.keys[L.locations.key[b.loc0]];
      // out along the nearest radial aisle, then round the arc aisle
      const want = u.ra + u.ra * Math.min(...pl.thetas.map((t) => Math.abs(t - pb.phi)));
      worst = Math.max(worst, Math.abs(d[node] - want)); n++;
    });
    check(label + ": concentric distances = closed form (" + n + " stops, worst " + worst.toExponential(1) + " m)", worst < 1e-6);
  }
  check(label + ": no walk shorter than the straight line", euclid > -1e-9, euclid);
}

// ---------------------------------------------------------------- the scenario's WH-B, both arrangements
["radial", "concentric"].forEach((arr) => {
  const p = whb.sizeToCapacity(Object.assign({}, B0, { arrangement: arr }), inputs.sc.target_locations);
  const L = whb.build(p);
  check(arr + ": holds the target (" + L.locations.n + " ≥ " + inputs.sc.target_locations + ")", L.locations.n >= inputs.sc.target_locations);
  check(arr + ": 2% smaller radius holds fewer", whb.capacityOf(p, p.outer_radius * 0.98) < inputs.sc.target_locations);
  check(arr + ": no critical warnings", L.warnings.every((w) => w.level !== "critical"), JSON.stringify(L.warnings));
  check(arr + ": locations = bays × levels × positions", L.locations.n === L.bays.length * p.levels_per_rack * p.positions_per_level_per_bay);
  checkGeometry(L, arr);
  checkExact(p, arr);
  if (arr === "radial") {
    const n = L.plan.zones.map((z) => z.n);
    check("radial: outer zones fit at least as many rows (" + n.join(" → ") + ")", n.every((v, i) => i === 0 || v >= n[i - 1]));
  }
  // KPIs: single-line sample vs exact, and every KPI finite
  const s1 = Object.assign({}, inputs.sc, { lines_per_order: 1, max_lines: 1, sample_orders: 20000 });
  const r1 = kpi.evaluate(L, s1), ex = kpi.exactSingleLine(L, r1);
  check(arr + ": single-line travel sample " + r1.kpi.travelPerOrder.toFixed(2) + " vs exact " + ex.toFixed(2) + " m (within 4 SE)", Math.abs(r1.kpi.travelPerOrder - ex) < 4 * r1.travelSE);
  const r = kpi.evaluate(L, inputs.sc);
  check(arr + ": every KPI finite", kpi.KPI_DEFS.every((dd) => !kpi.applies(dd, "B") || isFinite(r.kpi[dd.key])));
  console.log("  " + arr + ": R " + L.radius.toFixed(1) + " m, " + L.locations.n + " locations, " + Math.round(L.footprint) + " m², " +
    r.kpi.travelPerLine.toFixed(1) + " m/line, " + r.kpi.linesPerHour.toFixed(0) + " lines/picker-h");
});

// ---------------------------------------------------------------- random designs
let tested = 0;
for (let i = 0; i < 40; i++) {
  const p = Object.assign({}, B0, {
    arrangement: pick(["radial", "concentric"]),
    hub_radius: +(4 + rnd() * 10).toFixed(2), zones: 1 + Math.floor(rnd() * 4), ring_aisle_width: +(1.2 + rnd() * 3).toFixed(2),
    radial_aisles: 1 + Math.floor(rnd() * 9), radial_aisle_width: +(1.2 + rnd() * 3).toFixed(2),
    rack_depth: +(0.4 + rnd() * 1).toFixed(2), bay_width: +(0.8 + rnd() * 2).toFixed(2), aisle_width: +(1 + rnd() * 2.5).toFixed(2),
    flue_space: +(rnd() * 0.3).toFixed(2), levels_per_rack: 1 + Math.floor(rnd() * 5), rack_height: 2, load_height: 0.2,
    picking_points: 1 + Math.floor(rnd() * 3)
  });
  const target = 500 + Math.floor(rnd() * 5000);
  const q = whb.sizeToCapacity(p, target), L = whb.build(q, { matrix: false });
  const label = "random " + i + " (" + q.arrangement + ")";
  check(label + ": holds the target", L.locations.n >= target);
  checkGeometry(L, label);
  checkExact(q, label);
  tested++;
}
check("random designs tested (" + tested + ")", tested === 40);

// ---------------------------------------------------------------- paired with WH-C
{
  const run = scenario.run(inputs);
  check("B and C hold the same SKUs", run.B.skuLoc.length === run.C.skuLoc.length);
  const L = run.B.layout, Lc = run.C.layout;
  check("B and C both reach the capacity target", L.locations.n >= inputs.sc.target_locations && Lc.locations.n >= inputs.sc.target_locations);
  check("B inherits C's rack dimensions", whb.RACK_KEYS.every((k) => inputs.layouts.B[k] === inputs.layouts.C[k]));
}

summary("whb");
