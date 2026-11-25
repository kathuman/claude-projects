// Graph, demand, routing, slotting and the KPI evaluator —
// run with:  node warehouse-compare/tests/core.test.js
const path = require("path");
const fs = require("fs");
const { Graph } = require("../src/graph.js");
const demand = require("../src/demand.js");
const routing = require("../src/routing.js");
const slotting = require("../src/slotting.js");
const kpi = require("../src/kpi.js");
const scenario = require("../src/scenario.js");
const whc = require("../src/layouts/whc.js");
const { check, near, summary } = require("./harness.js");

const scJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/scenario.json"), "utf8"));
const whJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../../warehouse-model/data/parameters.json"), "utf8"));
const inputs = scenario.resolve(scJson, whJson);
const rnd = demand.mulberry32(7);

// ---------------------------------------------------------------- graph
{
  // 4×4 grid with 1 m spacing: shortest path = Manhattan distance
  const g = new Graph(), id = [];
  for (let i = 0; i < 4; i++) { id.push([]); for (let j = 0; j < 4; j++) id[i].push(g.addNode(i, j)); }
  for (let i = 0; i < 4; i++) { g.chain(id[i], "y"); g.chain(id.map((r) => r[i]), "x"); }
  const d = g.dijkstra(id[0][0]);
  let ok = true;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) ok = ok && near(d[id[i][j]], i + j);
  check("grid: Dijkstra = Manhattan distance", ok);
  const pth = g.path(id[0][0], id[3][2]);
  let len = 0; for (let i = 1; i < pth.length; i++) len += Math.hypot(g.x[pth[i]] - g.x[pth[i - 1]], g.y[pth[i]] - g.y[pth[i - 1]]);
  check("grid: path() runs end to end with the shortest length", pth[0] === id[0][0] && pth[pth.length - 1] === id[3][2] && near(len, 5));
  // a diagonal shortcut is taken
  g.addEdge(id[0][0], id[3][3]);
  check("grid: diagonal shortcut used", near(g.dijkstra(id[0][0])[id[3][3]], Math.hypot(3, 3)));
  // explicit (arc) length
  const h = new Graph(), a = h.addNode(0, 0), b = h.addNode(2, 0);
  h.addEdge(a, b, Math.PI);
  check("explicit edge length (arc) kept", near(h.dijkstra(a)[b], Math.PI));
  const lone = h.addNode(5, 5); h.markKey(a); h.markKey(lone);
  check("disconnected graph detected", !h.connected());
}

// ---------------------------------------------------------------- demand
{
  [20, 50, 80, 95].forEach((sk) => {
    const w = demand.skuWeights(1000, sk);
    const tot = w.reduce((a, v) => a + v, 0), top = w.slice(0, 200).reduce((a, v) => a + v, 0);
    check("skew " + sk + ": weights sum to 1", near(tot, 1, 1e-12));
    check("skew " + sk + ": top 20% of SKUs = " + sk + "% of lines", near(top, sk / 100, 1e-9), top);
    check("skew " + sk + ": popularity never increases", w.every((v, i) => i === 0 || v <= w[i - 1] + 1e-15));
  });
  // the two curves agree at the 20% point but not at the very top
  ["bender", "power"].forEach((kind) => {
    const w = demand.skuWeights(6000, 80, kind), top = w.slice(0, 1200).reduce((a, v) => a + v, 0);
    check(kind + ": top 20% of SKUs = 80% of lines", near(top, 0.8, 1e-9), top);
  });
  const wb = demand.skuWeights(6000, 80, "bender"), wp = demand.skuWeights(6000, 80, "power");
  check("Bender: no single SKU dominates (top SKU " + (100 * wb[0]).toFixed(2) + "% of lines)", wb[0] < 0.005);
  check("power: the top SKU takes " + (100 * wp[0]).toFixed(0) + "% of lines (why it isn't the default)", wp[0] > 0.25);
  check("Bender's A = 1/15 at 80/20", near(demand.benderA(80), 1 / 15, 1e-12));
  const s = Object.assign({}, inputs.sc, { skus: 500, lines_per_order: 3, max_lines: 10 });
  const st = demand.orderStream(s, 99);
  let lines = 0, top = 0, distinct = true; const N = 20000;
  for (let o = 0; o < N; o++) {
    const ord = st.next(); lines += ord.length;
    distinct = distinct && new Set(ord).size === ord.length;
    ord.forEach((k) => { if (k < 100) top++; });
  }
  check("orders: lines distinct within an order", distinct);
  check("orders: mean lines matches the capped geometric (" + (lines / N).toFixed(3) + " vs " + demand.meanLines(s).toFixed(3) + ")", near(lines / N, demand.meanLines(s), 0.05));
  // distinct-SKU sampling within an order flattens popularity slightly; a single-line stream does not
  const s1 = Object.assign({}, s, { lines_per_order: 1, max_lines: 1 }), st1 = demand.orderStream(s1, 5);
  let t1 = 0; for (let o = 0; o < N; o++) if (st1.next()[0] < 100) t1++;
  check("single-line orders: top 20% share ≈ skew (" + (t1 / N).toFixed(3) + ")", near(t1 / N, s.demand_skew / 100, 0.015));
  const a = demand.orderStream(s, 42), b = demand.orderStream(s, 42);
  let same = true; for (let o = 0; o < 200; o++) same = same && a.next().join() === b.next().join();
  check("orders: same seed, same orders", same);
}

// ---------------------------------------------------------------- routing
{
  function perms(a) { if (a.length <= 1) return [a]; const out = []; a.forEach((x, i) => perms(a.slice(0, i).concat(a.slice(i + 1))).forEach((p) => out.push([x].concat(p)))); return out; }
  let worstHK = 0, worstNN = 0, nnNeverBetter = true;
  for (let t = 0; t < 60; t++) {
    const K = 12, xs = [], ys = [];
    for (let i = 0; i < K; i++) { xs.push(rnd() * 50); ys.push(rnd() * 30); }
    const M = { K, at: (i, j) => Math.abs(xs[i] - xs[j]) + Math.abs(ys[i] - ys[j]) };
    const n = 1 + Math.floor(rnd() * 7), stops = [];
    while (stops.length < n) { const k = 1 + Math.floor(rnd() * (K - 1)); if (stops.indexOf(k) < 0) stops.push(k); }
    let brute = Infinity; perms(stops).forEach((p) => { brute = Math.min(brute, routing.tourLength(M, 0, p)); });
    const hk = routing.heldKarp(M, 0, stops), nn = routing.nn2opt(M, 0, stops);
    worstHK = Math.max(worstHK, Math.abs(hk.dist - brute));
    worstHK = Math.max(worstHK, Math.abs(routing.tourLength(M, 0, hk.order) - hk.dist));
    worstNN = Math.max(worstNN, nn.dist / brute - 1);
    if (nn.dist < brute - 1e-9) nnNeverBetter = false;
  }
  check("Held–Karp = brute force over every permutation", worstHK < 1e-9, worstHK);
  check("nearest neighbour + 2-opt is never better than optimal", nnNeverBetter);
  check("nearest neighbour + 2-opt within 15% of optimal (worst " + (100 * worstNN).toFixed(1) + "%)", worstNN < 0.15);
  const M = { K: 3, at: (i, j) => Math.abs(i - j) * 10 };
  const r = routing.route(M, [0, 2], [2, 2]);
  check("route: duplicate stops merged, stop at a picking point costs nothing", r.stops === 1 && r.dist === 0);
}

// ---------------------------------------------------------------- WH-C scenario: slotting and KPIs
{
  const pC = whc.sizeToCapacity(inputs.layouts.C, inputs.rackTypes, inputs.sc.target_locations);
  const L = whc.build(pC, inputs.rackTypes);
  check("scenario WH-C has no critical warnings", L.warnings.every((w) => w.level !== "critical"), JSON.stringify(L.warnings));
  check("scenario WH-C holds the target", L.locations.n >= inputs.sc.target_locations);

  // ranked slotting: cost never decreases with popularity rank
  const skuLoc = slotting.assign(L, inputs.sc.skus, "ranked", inputs.sc, rnd);
  const cost = slotting.locationCost(L, inputs.sc).cost;
  check("ranked: more popular SKUs never further away", Array.from(skuLoc).every((loc, s) => s === 0 || cost[loc] >= cost[skuLoc[s - 1]] - 1e-12));
  ["random", "abc", "ranked"].forEach((pol) => {
    const a = slotting.assign(L, inputs.sc.skus, pol, inputs.sc, demand.mulberry32(3));
    check(pol + ": every SKU has its own location", new Set(a).size === inputs.sc.skus && Array.from(a).every((v) => v >= 0 && v < L.locations.n));
  });

  // single-line orders: sample vs exact expectation
  const s1 = Object.assign({}, inputs.sc, { lines_per_order: 1, max_lines: 1, sample_orders: 20000 });
  ["random", "abc", "ranked"].forEach((pol) => {
    const sc = Object.assign({}, s1, { slotting: pol });
    const r = kpi.evaluate(L, sc);
    const exact = kpi.exactSingleLine(L, r);
    check(pol + ": single-line travel sample " + r.kpi.travelPerOrder.toFixed(2) + " m vs exact " + exact.toFixed(2) + " m (within 4 SE)", Math.abs(r.kpi.travelPerOrder - exact) < 4 * r.travelSE);
  });

  // policies order as theory says; determinism; every KPI is a finite number
  const res = {};
  ["random", "abc", "ranked"].forEach((pol) => { res[pol] = kpi.evaluate(L, Object.assign({}, inputs.sc, { slotting: pol })); });
  check("travel: ranked < ABC < random (" + ["ranked", "abc", "random"].map((p) => res[p].kpi.travelPerLine.toFixed(1)).join(" < ") + " m/line)",
    res.ranked.kpi.travelPerLine < res.abc.kpi.travelPerLine && res.abc.kpi.travelPerLine < res.random.kpi.travelPerLine);
  // random slotting is judged in expectation, not on one lucky or unlucky draw:
  // high skew and single-line orders are where a single draw swung by ±15%
  ["random", "abc"].forEach((pol) => {
    const v = [1, 2, 3, 4, 5].map((sd) => kpi.evaluate(L, Object.assign({}, inputs.sc, { slotting: pol, demand_skew: 95, lines_per_order: 1, max_lines: 1, seed: sd, sample_orders: 4000 })).kpi.travelPerLine);
    const spread = (Math.max(...v) - Math.min(...v)) / (v.reduce((a, b) => a + b, 0) / v.length);
    check(pol + ": result stable across seeds at 95% skew (spread " + (100 * spread).toFixed(1) + "%)", spread < 0.05, v.map((x) => x.toFixed(1)).join(" "));
  });
  const again = kpi.evaluate(L, Object.assign({}, inputs.sc, { slotting: "ranked" }));
  check("same seed, same result", again.kpi.travelPerOrder === res.ranked.kpi.travelPerOrder);
  check("every KPI in the contract that applies to C is reported and finite", kpi.KPI_DEFS.every((d) => !kpi.applies(d, "C") || d.stage === "cost" || isFinite(res.ranked.kpi[d.key])));
  check("every trace step has label/expr/value", res.ranked.trace.every((t) => t.label && t.expr && t.value !== undefined && t.value !== ""));
  const k = res.ranked.kpi;
  check("time per line = 3600 / lines per hour", near(k.timePerLine * k.linesPerHour, 3600, 1e-6));
  check("too few locations is reported, not thrown", kpi.evaluate(L, Object.assign({}, inputs.sc, { skus: L.locations.n + 1 })).infeasible === true);

  // scenario.run is what the page calls
  const run = scenario.run(inputs);
  check("scenario.run evaluates WH-C", run.C && run.C.kpi.travelPerOrder === res.ranked.kpi.travelPerOrder);
  console.log("  WH-C scenario: " + pC.warehouse_length.toFixed(1) + " × " + pC.warehouse_width.toFixed(1) + " m, " + L.locations.n + " locations; " +
    "ranked " + k.travelPerLine.toFixed(1) + " m/line, " + k.linesPerHour.toFixed(0) + " lines/picker-h, " + k.pickersNeeded + " pickers at the peak");
}

summary("core");
