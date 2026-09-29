// Unit tests for web/src/calculations.js — run with:  node warehouse-model/tests/calculations.test.js
const path = require("path");
const fs = require("fs");
const calc = require("../web/src/calculations.js");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/parameters.json"), "utf8"));
const RT = data.rack_types;
const base = {};
for (const k in data.parameters) base[k] = data.parameters[k].value;
const withP = (o) => Object.assign({}, base, o);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  → " + detail : "")); }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);

// ---------------------------------------------------------------- schema
for (const k in data.parameters) {
  const d = data.parameters[k];
  check("schema: " + k + " has category + description", !!d.category && !!d.description);
  if (d.type === "choice") {
    check("schema: " + k + " default is an option", d.options.indexOf(d.value) >= 0);
    d.options.forEach((o) => check("schema: option " + o + " has a label", k === "rack_type" ? !!RT[o] : !!(d.labels && d.labels[o])));
  } else {
    check("schema: " + k + " default within range", d.value >= d.minimum && d.value <= d.maximum, d.value + " not in " + d.minimum + ".." + d.maximum);
  }
}

// ---------------------------------------------------------------- baseline by hand
{
  const r = calc.computeAll(base, RT);
  // 100 m − 2×5 m = 90 m → 33 bays of 2.7 m; unit = 2×1.1 + 3.2 = 5.4 m; (60 + 0.3)/(5.4 + 0.3) = 10.58 → 10 units
  check("baseline bays/row", r.layout.baysPerRow === 33, r.layout.baysPerRow);
  check("baseline aisle units", r.layout.numAisleUnits === 10, r.layout.numAisleUnits);
  check("baseline rows", r.layout.numRackRows === 20);
  check("baseline width used", near(r.layout.rackingWidthUsed, 10 * 5.4 + 9 * 0.3), r.layout.rackingWidthUsed);
  check("baseline capacity", r.capacity.storageCapacity === 20 * 33 * 4 * 2, r.capacity.storageCapacity);
  check("baseline practical", r.capacity.practicalCapacity === Math.floor(5280 * 0.9));
  check("baseline pitch", near(r.layout.levelPitch, 8 / 3));
  check("baseline clear height needed", near(r.layout.clearanceNeeded, 8 + 1.5 + 0.46));
  check("baseline has no critical warnings", r.warnings.every((w) => w.level !== "critical"), JSON.stringify(r.warnings));
  // docks: 400 pallets/26 = 15.38 trucks/day, /16 h × 1.5 = 1.442 peak trucks/h, 4 doors × 60/60 = 4 trucks/h → 36%
  check("baseline dock utilization", near(r.throughput.dockUtilizationPct, 400 / 26 / 16 * 1.5 / 4 * 100, 1e-6), r.throughput.dockUtilizationPct);
  check("baseline footprint includes walls", near(r.cost.footprint, 100.4 * 60.4, 1e-6));
  check("every trace step has label/expr/value", ["layout", "capacity", "utilization", "travel", "throughput", "cost"].every((k) => r[k].trace.every((t) => t.label && t.expr && t.value !== undefined && t.value !== "")));
}

// ---------------------------------------------------------------- geometry invariants over many random designs
function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }
function randomP() {
  const q = {};
  for (const k in data.parameters) {
    const d = data.parameters[k];
    if (d.type === "choice") q[k] = d.options[Math.floor(Math.random() * d.options.length)];
    else if (d.unit === "count") q[k] = Math.round(rnd(d.minimum, d.maximum));
    else q[k] = +rnd(d.minimum, d.maximum).toFixed(2);
  }
  return q;
}
let geomOK = 0;
for (let n = 0; n < 3000; n++) {
  const q = randomP(), L = calc.computeLayout(q, RT), deep = RT[q.rack_type].deep;
  let ok = true;
  // rows lie inside the building, don't overlap, and the flue/aisle gaps are exactly as specified
  const rows = L.rows;
  if (rows.length !== L.numRackRows) ok = false;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.y < -1e-9 || r.y + r.depth > q.warehouse_width + 1e-9) ok = false;
    if (!near(r.depth, deep * q.rack_depth)) ok = false;
    if (i > 0) {
      const gap = r.y - (rows[i - 1].y + rows[i - 1].depth);
      if (!near(gap, i % 2 ? q.aisle_width : q.flue_space, 1e-9)) ok = false;
    }
  }
  // one more unit would not fit
  const more = (L.numAisleUnits + 1) * L.widthPerAisleUnit + L.numAisleUnits * q.flue_space;
  if (more <= q.warehouse_width - 1e-9) ok = false;
  // bays: each segment full (one more bay wouldn't fit), segments separated by the mid cross-aisles, all inside the usable length
  L.segments.forEach((sg, k) => {
    if (sg.length > Math.max(0, L.segmentLength) + 1e-9 || (L.segmentLength > 0 && sg.length + q.bay_width <= L.segmentLength - 1e-9)) ok = false;
    if (k > 0 && !near(sg.x0 - L.segments[k - 1].x0, L.segmentLength + q.mid_cross_aisle_width, 1e-9)) ok = false;
  });
  if (L.bayX.length && (L.bayX[0] < q.cross_aisle_width - 1e-9 || L.bayX[L.bayX.length - 1] + q.bay_width > q.warehouse_length - q.cross_aisle_width + 1e-9)) ok = false;
  if (L.crossAisleX.length !== Math.round(q.mid_cross_aisles) + 2) ok = false;
  // every row faces an aisle
  rows.forEach((r) => { const face = r.faces > 0 ? r.y + r.depth : r.y; if (!L.aisles.some((a) => near(Math.abs(a.y - face), q.aisle_width / 2, 1e-9))) ok = false; });
  if (ok) geomOK++; else if (geomOK + 5 > n) console.log("  geometry counter-example:", JSON.stringify(q));
}
check("geometry invariants hold for 3000 random designs", geomOK === 3000, geomOK);

// ---------------------------------------------------------------- travel: formula == brute force over every slot
function bruteTravel(q) {
  const L = calc.computeLayout(q, RT);
  const D = calc.doorSets(q), doorsIn = D.inY, doorsOut = D.outY;
  let sumIn = 0, sumOut = 0, sumZ = 0, n = 0;
  L.rows.forEach((row) => {
    // the aisle this row faces
    const face = row.faces > 0 ? row.y + row.depth : row.y;
    const aisle = L.aisles.find((a) => near(Math.abs(a.y - face), q.aisle_width / 2, 1e-9));
    for (let b = 0; b < L.baysPerRow; b++) {
      const x = L.bayX[b] + 0.5 * q.bay_width;
      L.levelHeights.forEach((z) => {
        doorsIn.forEach((d) => { sumIn += Math.abs(d - aisle.y) + x; });
        doorsOut.forEach((d) => { sumOut += Math.abs(d - aisle.y) + (D.u ? x : q.warehouse_length - x); });
        sumZ += z; n++;
      });
    }
  });
  const oneIn = sumIn / (n * doorsIn.length), oneOut = sumOut / (n * doorsOut.length), z = sumZ / n;
  const round = oneIn + oneOut;   // 2 × average of the two one-way means
  return { round, cycle: round / q.forklift_speed + 2 * z / q.lift_speed + q.forklift_cycle_overhead };
}
let travelOK = 0, worst = 0;
for (let n = 0; n < 300; n++) {
  const q = randomP(); q.warehouse_length = rnd(40, 120); q.warehouse_width = rnd(20, 70); q.storage_policy = "random";
  const r = calc.computeAll(q, RT);
  if (!r.layout.numRackRows || !r.layout.baysPerRow) { travelOK++; continue; }
  const b = bruteTravel(q), e = Math.abs(b.round - r.travel.avgRoundTrip) + Math.abs(b.cycle - r.travel.cycleTime);
  worst = Math.max(worst, e);
  if (e < 1e-6) travelOK++;
}
check("travel formula matches brute force over every door/slot/level (300 designs)", travelOK === 300, "worst error " + worst);

// ---------------------------------------------------------------- per-slot times average to the headline cycle time
let slotOK = 0;
for (let n = 0; n < 200; n++) {
  const q = randomP(); q.warehouse_length = rnd(40, 150); q.warehouse_width = rnd(20, 80); q.storage_policy = "random";
  const r = calc.computeAll(q, RT);
  if (!r.layout.numRackRows || !r.layout.baysPerRow) { slotOK++; continue; }
  const g = calc.slotTimeGrid(q, r.layout);
  let sum = 0; for (let i = 0; i < g.times.length; i++) sum += g.times[i];
  const okMean = Math.abs(sum / g.times.length - r.travel.cycleTime) < 1e-3 * r.travel.cycleTime;
  const okLen = g.times.length === r.layout.numRackRows * r.layout.baysPerRow * q.levels_per_rack && g.min <= g.max;
  if (okMean && okLen) slotOK++; else if (slotOK + 3 > n) console.log("  slot mean", sum / g.times.length, "vs", r.travel.cycleTime);
}
check("per-slot cycle times average to the headline cycle time (200 designs)", slotOK === 200, slotOK);
{
  const r = calc.computeAll(base, RT), L = r.layout;
  const near0 = calc.slotTimes(base, L, 0, 0, 0), far = calc.slotTimes(base, L, 0, L.baysPerRow - 1, 0), high = calc.slotTimes(base, L, 0, 0, base.levels_per_rack - 1);
  check("slot near receiving: faster in than out", near0.tIn < near0.tOut);
  check("slot near shipping: faster out than in", far.tOut < far.tIn);
  check("top level slower than floor level", high.t > near0.t && near(high.t - near0.t, 2 * base.rack_height / base.lift_speed, 1e-9));
  check("aisle of a row lies inside the building", L.rows.every((row) => { const y = calc.aisleOf(row, base); return y > 0 && y < base.warehouse_width; }));
}

// ---------------------------------------------------------------- behaviour
{
  const a = calc.computeAll(base, RT), b = calc.computeAll(withP({ warehouse_length: 200 }), RT);
  check("doubling length gives more than double the bays (fixed cross-aisles)", b.layout.baysPerRow > 2 * a.layout.baysPerRow, a.layout.baysPerRow + " → " + b.layout.baysPerRow);
  check("longer building → longer trips", b.travel.avgRoundTrip > a.travel.avgRoundTrip);
  const tall = calc.computeAll(withP({ rack_height: 10, clear_height: 13, levels_per_rack: 5 }), RT);
  check("taller racks → more lift time", tall.travel.liftTime > a.travel.liftTime);
  const narrow = calc.computeAll(withP({ aisle_width: 2.8 }), RT);
  check("narrower aisle → at least as many rows", narrow.layout.numRackRows >= a.layout.numRackRows);
  const dd = calc.computeAll(withP({ rack_type: "double_deep" }), RT);
  check("double-deep packs more positions than selective", dd.capacity.storageCapacity > a.capacity.storageCapacity, dd.capacity.storageCapacity);
  check("double-deep selectivity 50%", dd.capacity.directAccess === Math.round(dd.capacity.storageCapacity * 0.5));
  const di = calc.computeAll(withP({ rack_type: "drive_in", aisle_width: 3.5 }), RT);
  check("drive-in: 5 deep rows", near(di.layout.rowDepth, 5.5));
  const vna = calc.computeAll(withP({ rack_type: "vna", aisle_width: 1.8 }), RT);
  check("VNA at 1.8 m aisle packs more than selective at 3.2 m", vna.capacity.storageCapacity > a.capacity.storageCapacity);
  check("VNA at 1.8 m: no aisle warning", !vna.warnings.some((w) => /aisle/.test(w.text)));
  const vnaWide = calc.computeAll(withP({ rack_type: "vna", aisle_width: 3.0 }), RT);
  check("VNA with a wide aisle: info note", vnaWide.warnings.some((w) => w.level === "info"));
  const tight = calc.computeAll(withP({ rack_type: "double_deep", aisle_width: 2.5 }), RT);
  check("aisle below the truck's minimum is critical", tight.warnings.some((w) => w.level === "critical" && /too narrow/.test(w.text)));
  const levels = calc.computeAll(withP({ levels_per_rack: 8, rack_height: 6 }), RT);
  check("8 levels in a 6 m rack flagged", levels.warnings.some((w) => /per level/.test(w.text)));
  const roof = calc.computeAll(withP({ rack_height: 9, clear_height: 10 }), RT);
  check("rack + load + sprinkler above clear height flagged", roof.warnings.some((w) => /clear height/.test(w.text)));
  const esfr = calc.computeAll(withP({ sprinkler_clearance: 0.91 }), RT);
  check("ESFR clearance on a 10 m building with 8 m racks flagged", esfr.warnings.some((w) => /clear height/.test(w.text)));
  const full = calc.computeAll(withP({ current_inventory_pallets: 5000 }), RT);
  check("above the planning ceiling → warning, not critical", full.utilization.status === "warning");
  const over = calc.computeAll(withP({ current_inventory_pallets: 6000 }), RT);
  check("over capacity → critical", over.utilization.status === "critical" && over.utilization.overflowPallets === 720);
  const busy = calc.computeAll(withP({ daily_throughput_pallets: 3000, num_shipping_docks: 2 }), RT);
  check("few shipping doors → shipping is the bottleneck", busy.throughput.bottleneck === "shipping" && busy.throughput.dockBound);
  const peak1 = calc.computeAll(withP({ peak_hour_factor: 1 }), RT), peak3 = calc.computeAll(withP({ peak_hour_factor: 3 }), RT);
  check("peak factor ×3 triples dock utilization", near(peak3.throughput.dockUtilizationPct, 3 * peak1.throughput.dockUtilizationPct, 1e-9));
  check("peak factor raises the fleet", peak3.travel.forkliftsNeeded > peak1.travel.forkliftsNeeded);
  const eff = calc.computeAll(withP({ truck_efficiency: 0.5 }), RT);
  check("lower truck efficiency needs more trucks", eff.travel.forkliftsNeeded >= a.travel.forkliftsNeeded && eff.travel.trucksAverage > a.travel.trucksAverage);
  const moreDocksIn = calc.computeAll(withP({ num_receiving_docks: 12 }), RT);
  check("spreading receiving doors wider changes the door-to-aisle distance", !near(moreDocksIn.travel.latIn, a.travel.latIn, 1e-6));
  const tiny = calc.computeAll(withP({ warehouse_length: 40, cross_aisle_width: 12, bay_width: 3.6 }), RT);
  check("impossible layout: zero capacity, finite numbers", tiny.capacity.storageCapacity === 0 ? isFinite(tiny.travel.cycleTime) : true);
  let threw = false; try { calc.computeAll(withP({ rack_type: "nope" }), RT); } catch (e) { threw = true; }
  check("unknown rack type throws", threw);
}

// ---------------------------------------------------------------- v4: flow, slotting, dual command, queueing
{
  // U-flow doors: all on the west wall, receiving first; they must fit
  const D = calc.doorSets(withP({ flow_layout: "u_flow" }));
  check("U-flow: shipping doors on the west wall", D.u && D.outX === 0 && D.outY.length === base.num_shipping_docks && D.outY[0] > D.inY[D.inY.length - 1]);
  const crowded = calc.computeAll(withP({ flow_layout: "u_flow", num_receiving_docks: 9, num_shipping_docks: 9 }), RT);
  check("U-flow: too many doors for one wall is critical", crowded.warnings.some((w) => w.level === "critical" && /U-flow/.test(w.text)));

  // ABC weights
  const g = calc.slotGrid(base, calc.computeLayout(base, RT));
  const wr = calc.moveWeights(withP({ storage_policy: "abc", demand_skew: 80 }), g);
  let sum = 0; for (let i = 0; i < wr.w.length; i++) sum += wr.w[i];
  check("ABC weights sum to 1", near(sum, 1, 1e-9), sum);
  check("ABC: class A gets 80% of moves at 80% skew", near(wr.shares[0], 0.8, 1e-9));
  let fastW = 0, slowW = 0; for (let i = 0; i < g.n; i++) { if (wr.cls[i] === 0) fastW = Math.max(fastW, g.t[i]); if (wr.cls[i] === 2) slowW = slowW || g.t[i], slowW = Math.min(slowW, g.t[i]); }
  check("ABC: every A cell is at least as quick as every C cell", fastW <= slowW + 1e-9, fastW + " vs " + slowW);
  const flat = calc.computeAll(withP({ storage_policy: "abc", demand_skew: 20 }), RT), rand = calc.computeAll(base, RT);
  check("ABC with no demand skew = random storage", near(flat.travel.cycleTime, rand.travel.cycleTime, 1e-6));
  const abcI = calc.computeAll(withP({ storage_policy: "abc" }), RT);
  const randU = calc.computeAll(withP({ flow_layout: "u_flow" }), RT), abcU = calc.computeAll(withP({ flow_layout: "u_flow", storage_policy: "abc" }), RT);
  check("ABC shortens the cycle (I-flow)", abcI.travel.cycleTime < rand.travel.cycleTime);
  const gainI = 1 - abcI.travel.cycleTime / rand.travel.cycleTime, gainU = 1 - abcU.travel.cycleTime / randU.travel.cycleTime;
  check("ABC gains more with U-flow than with I-flow", gainU > gainI, (gainI * 100).toFixed(1) + "% vs " + (gainU * 100).toFixed(1) + "%");
  check("I-flow + ABC shows the design note", abcI.warnings.some((w) => w.level === "info" && /I-flow/.test(w.text)));

  // dual command: sampled estimate vs exact expectation over all cell pairs (small layout)
  function exactDC(q) {
    const r = calc.computeAll(q, RT), L = r.layout, G = r.slots.grid, W = r.slots.weights.w, cx = L.crossAisleX, nbl = G.nb * G.nl;
    const Dd = G.doors; let ret = 0; Dd.outY.forEach((a) => Dd.inY.forEach((b) => { ret += Math.abs(a - b); }));
    ret = ret / (Dd.outY.length * Dd.inY.length) + (Dd.u ? 0 : q.warehouse_length);
    let e = 0;
    for (let a = 0; a < G.n; a++) for (let b = 0; b < G.n; b++) {
      const ra = Math.floor(a / nbl), rb = Math.floor(b / nbl), xa = G.bayCx[Math.floor(a / G.nl) % G.nb], xb = G.bayCx[Math.floor(b / G.nl) % G.nb];
      const btw = L.rows[ra].aisle === L.rows[rb].aisle ? Math.abs(xa - xb) : Math.abs(G.rowAisleY[ra] - G.rowAisleY[rb]) + Math.min(...cx.map((c) => Math.abs(xa - c) + Math.abs(xb - c)));
      const d = G.latIn[ra] + xa + btw + G.latOut[rb] + Math.abs(Dd.outX - xb) + ret;
      e += W[a] * W[b] * (d / q.forklift_speed + 2 * (L.levelHeights[a % G.nl] + L.levelHeights[b % G.nl]) / q.lift_speed + 2 * q.forklift_cycle_overhead);
    }
    return { exact: e, est: r.travel.dcCycle };
  }
  [withP({ warehouse_length: 60, warehouse_width: 30, dual_command_share: 50 }),
   withP({ warehouse_length: 70, warehouse_width: 30, flow_layout: "u_flow", storage_policy: "abc", mid_cross_aisles: 1, dual_command_share: 50 }),
   withP({ warehouse_length: 80, warehouse_width: 26, rack_type: "double_deep", aisle_width: 3, mid_cross_aisles: 2, dual_command_share: 100 })].forEach((q, i) => {
    const d = exactDC(q);
    check("dual-command estimate within 2% of the exact all-pairs value (case " + (i + 1) + ")", Math.abs(d.est - d.exact) / d.exact < 0.02, d.est.toFixed(1) + " vs " + d.exact.toFixed(1));
  });
  const sc = calc.computeAll(withP({ flow_layout: "u_flow" }), RT), dc = calc.computeAll(withP({ flow_layout: "u_flow", dual_command_share: 100 }), RT);
  check("U-flow: dual command cuts the time per move", dc.travel.perMove < sc.travel.perMove, sc.travel.perMove.toFixed(0) + " → " + dc.travel.perMove.toFixed(0));
  check("dual share 0: time per move = single-command cycle", near(sc.travel.perMove, sc.travel.cycleTime, 1e-9));

  // mid cross-aisles: fewer bays, shorter dual-command trips in a long building
  const long0 = calc.computeAll(withP({ warehouse_length: 220, dual_command_share: 100 }), RT), long2 = calc.computeAll(withP({ warehouse_length: 220, dual_command_share: 100, mid_cross_aisles: 2 }), RT);
  check("mid cross-aisles cost bays", long2.layout.baysPerRow < long0.layout.baysPerRow);
  check("mid cross-aisles shorten dual-command trips (220 m building)", long2.travel.dcCycle < long0.travel.dcCycle, long0.travel.dcCycle.toFixed(0) + " → " + long2.travel.dcCycle.toFixed(0));
  const narrowMid = calc.computeAll(withP({ mid_cross_aisles: 1, mid_cross_aisle_width: 2.6 }), RT);
  check("mid cross-aisle narrower than the aisles is flagged", narrowMid.warnings.some((w) => /Mid cross-aisles/.test(w.text)));

  // Erlang C and the door queue
  check("Erlang C: M/M/1 wait probability = utilization", near(calc.erlangC(1, 0.5), 0.5, 1e-12));
  check("Erlang C: c = 2, a = 1 → 1/3", near(calc.erlangC(2, 1), 1 / 3, 1e-12));
  check("Erlang C: saturated → 1", calc.erlangC(3, 3) === 1);
  const one = calc.computeThroughput(withP({ num_receiving_docks: 1, num_shipping_docks: 1, daily_throughput_pallets: 400, pallets_per_truck: 20, operating_hours_per_day: 10, peak_hour_factor: 1, truck_turn_time: 30 }));
  // 200 pallets / 20 = 10 trucks/day / 10 h = 1 truck/h; μ = 2/h; ρ = 0.5; M/M/1 Wq = ρ/(μ−λ) = 0.5 h → × (1 + 0.25)/2 = 18.75 min
  check("one door: wait = M/M/1 × Allen–Cunneen", near(one.inbound.waitMin, 18.75, 1e-9), one.inbound.waitMin);
  const more = calc.computeThroughput(withP({ num_receiving_docks: 2, num_shipping_docks: 2, daily_throughput_pallets: 400, pallets_per_truck: 20, operating_hours_per_day: 10, peak_hour_factor: 1, truck_turn_time: 30 }));
  check("a second door cuts the wait sharply", more.inbound.waitMin < one.inbound.waitMin / 4, more.inbound.waitMin);
  const sat = calc.computeThroughput(withP({ daily_throughput_pallets: 5000, num_receiving_docks: 2 }));
  check("saturated doors: infinite wait, critical", !isFinite(sat.inbound.waitMin) && sat.status === "critical");
}

// ---------------------------------------------------------------- v6: total cost of ownership
{
  check("CRF: zero rate = straight line", near(calc.crf(0, 20), 1 / 20, 1e-12));
  check("CRF: 7% over 30 years = 0.08059", near(calc.crf(7, 30), 0.0805864, 1e-6), calc.crf(7, 30));
  const r = calc.computeAll(base, RT), c = r.cost, L = calc.ASSET_LIFE;
  const expectCap = c.buildingCost * calc.crf(7, L.building) + (c.rackingCost + c.dockCost) * calc.crf(7, L.racking) + c.fleetCost * calc.crf(7, L.trucks);
  check("annual capital cost adds up", near(c.annualCapital, expectCap, 1e-6));
  check("fleet cost = trucks × reach-truck price", c.fleetCost === r.travel.forkliftsNeeded * 45000);
  check("drivers = trucks × hours × days × wage", near(c.labour, r.travel.forkliftsNeeded * 16 * 250 * 32, 1e-6));
  check("TCO = capital + drivers + running", near(c.annualTCO, c.annualCapital + c.labour + c.running, 1e-6));
  check("cost per move = TCO / annual moves", near(c.costPerMove, c.annualTCO / (800 * 250), 1e-9));
  const wage2 = calc.computeAll(withP({ labour_cost_per_hour: 64 }), RT);
  check("doubling the wage doubles the driver cost only", near(wage2.cost.labour, 2 * c.labour, 1e-6) && near(wage2.cost.annualCapital, c.annualCapital, 1e-6));
  const vna = calc.computeAll(withP({ rack_type: "vna", aisle_width: 1.8 }), RT);
  check("VNA trucks cost more per truck", vna.cost.fleetCost / vna.travel.forkliftsNeeded > c.fleetCost / r.travel.forkliftsNeeded);
  check("TCO trace ends with cost per move", /per pallet move/.test(c.trace[c.trace.length - 1].label));
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
