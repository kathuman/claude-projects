// WH-C through the graph engine must reproduce the Warehouse Model's own
// travel formulas exactly — run with:  node warehouse-compare/tests/whc.test.js
const path = require("path");
const fs = require("fs");
const calc = require("../../warehouse-model/web/src/calculations.js");
const whc = require("../src/layouts/whc.js");
const { check, near, summary } = require("./harness.js");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../../warehouse-model/data/parameters.json"), "utf8"));
const RT = {}; for (const k in data.rack_types) if (k[0] !== "$") RT[k] = data.rack_types[k];
const base = {}; for (const k in data.parameters) base[k] = data.parameters[k].value;

// seeded so a failure can be reproduced
let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; };
function randomP() {
  const q = {};
  for (const k in data.parameters) {
    const d = data.parameters[k];
    if (d.type === "choice") q[k] = d.options[Math.floor(rnd() * d.options.length)];
    else if (d.unit === "count") q[k] = Math.round(d.minimum + rnd() * (d.maximum - d.minimum));
    else q[k] = +(d.minimum + rnd() * (d.maximum - d.minimum)).toFixed(2);
  }
  q.mid_cross_aisles = Math.min(q.mid_cross_aisles, 3);
  return q;
}

// Graph door→access distance vs the Warehouse Model's slotGrid travel, for every row and bay.
function checkDoors(p, label) {
  const lay = calc.computeLayout(p, whc.rackTypesWith(RT));
  if (lay.baysPerRow < 1 || lay.numAisleUnits < 1) return 0;
  const grid = calc.slotGrid(p, lay);
  let worst = 0;
  ["doors_in", "doors_out"].forEach((mode) => {
    const L = whc.build(p, RT, { depots: mode, matrix: false });
    const g = L.graph, dists = L.depots.map((k) => g.dijkstra(g.keys[k]));
    for (let r = 0; r < lay.rows.length; r++) {
      const ai = lay.rows[r].aisle;
      for (let b = 0; b < lay.baysPerRow; b++) {
        const node = g.keys[L.accessKey[ai][b]];
        const mean = dists.reduce((a, d) => a + d[node], 0) / dists.length;
        // slotGrid: tIn = 2(latIn + x)/v + common; tOut = 2(latOut + |outX − x|)/v + common
        const x = grid.bayCx[b];
        const want = mode === "doors_in" ? grid.latIn[r] + x : grid.latOut[r] + Math.abs(grid.doors.outX - x);
        worst = Math.max(worst, Math.abs(mean - want));
      }
    }
  });
  check(label + ": door → slot = slotGrid distance (worst error " + worst.toExponential(1) + " m)", worst < 1e-6);
  return 1;
}

// Graph access→access vs dcPair's aisle-to-aisle "between" term.
function checkBetween(p, label, samples) {
  const lay = calc.computeLayout(p, whc.rackTypesWith(RT));
  if (lay.baysPerRow < 1 || lay.numAisleUnits < 1) return;
  const grid = calc.slotGrid(p, lay), ctx = calc.dcContext(p, lay, grid);
  const L = whc.build(p, RT, { depots: "doors_in", matrix: false }), g = L.graph;
  let worst = 0;
  for (let t = 0; t < samples; t++) {
    const a = Math.floor(rnd() * grid.n), b = Math.floor(rnd() * grid.n);
    const ra = Math.floor(a / ctx.nbl), rb = Math.floor(b / ctx.nbl), ba = Math.floor(a / grid.nl) % grid.nb, bb = Math.floor(b / grid.nl) % grid.nb;
    const d = calc.dcPair(p, lay, grid, ctx, a, b).dist;
    const between = d - (grid.latIn[ra] + grid.bayCx[ba] + grid.latOut[rb] + Math.abs(grid.doors.outX - grid.bayCx[bb]) + ctx.ret);
    const na = g.keys[L.accessKey[lay.rows[ra].aisle][ba]], nb = g.keys[L.accessKey[lay.rows[rb].aisle][bb]];
    worst = Math.max(worst, Math.abs(g.dijkstra(na)[nb] - between));
  }
  check(label + ": slot → slot = dcPair between-term (worst error " + worst.toExponential(1) + " m)", worst < 1e-6);
}

// ---------------------------------------------------------------- the Warehouse Model's baseline
checkDoors(base, "baseline I-flow");
checkDoors(Object.assign({}, base, { flow_layout: "u_flow" }), "baseline U-flow");
checkDoors(Object.assign({}, base, { mid_cross_aisles: 2 }), "baseline 2 mid cross-aisles");
checkBetween(base, "baseline", 300);
checkBetween(Object.assign({}, base, { mid_cross_aisles: 2, flow_layout: "u_flow" }), "baseline U-flow + 2 mid aisles", 300);

// ---------------------------------------------------------------- random designs
let tested = 0;
for (let i = 0; i < 60 && tested < 40; i++) {
  const p = randomP();
  if (checkDoors(p, "random design " + i)) { checkBetween(p, "random design " + i, 40); tested++; }
}
check("enough random designs were tested (" + tested + ")", tested >= 30);

// ---------------------------------------------------------------- structure
{
  const p = Object.assign({}, base, { picking_points: 4, station_spacing: 3 });
  const L = whc.build(p, RT);
  const lay = calc.computeLayout(p, whc.rackTypesWith(RT));
  check("locations = rows × bays × levels × positions", L.locations.n === lay.numRackRows * lay.baysPerRow * p.levels_per_rack * p.positions_per_level_per_bay);
  check("graph is connected", L.graph.connected());
  check("four picking points", L.depots.length === 4);
  let sym = 0, tri = 0;
  const K = L.M.K;
  for (let t = 0; t < 2000; t++) {
    const i = Math.floor(rnd() * K), j = Math.floor(rnd() * K), k = Math.floor(rnd() * K);
    sym = Math.max(sym, Math.abs(L.M.at(i, j) - L.M.at(j, i)));
    tri = Math.max(tri, L.M.at(i, k) - L.M.at(i, j) - L.M.at(j, k));
  }
  check("distance matrix is symmetric", sym < 1e-9);
  check("distance matrix obeys the triangle inequality", tri < 1e-9);
  check("diagonal is zero", Array.from({ length: K }, (_, i) => L.M.at(i, i)).every((v) => v === 0));
}

// ---------------------------------------------------------------- equal capacity sizing
{
  const sc = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/scenario.json"), "utf8"));
  const p0 = Object.assign({}, base);
  for (const k in sc.layouts.C) if (k[0] !== "$") p0[k] = sc.layouts.C[k];
  [500, 3000, 7000, 20000].forEach((target) => {
    const p = whc.sizeToCapacity(p0, RT, target);
    const n = whc.build(p, RT, { matrix: false }).locations.n;
    const smaller = Object.assign({}, p, { warehouse_length: p.warehouse_length * 0.98, warehouse_width: p.warehouse_width * 0.98 });
    const n2 = whc.build(smaller, RT, { matrix: false }).locations.n;
    check("sized to " + target + ": holds ≥ target (" + n + ")", n >= target);
    check("sized to " + target + ": 2% smaller holds fewer (" + n2 + ")", n2 < target);
    check("sized to " + target + ": aspect ratio kept", near(p.warehouse_length / p.warehouse_width, p0.warehouse_length / p0.warehouse_width, 1e-3));
  });
}

summary("whc");
