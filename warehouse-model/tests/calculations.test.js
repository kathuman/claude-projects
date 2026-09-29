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
    d.options.forEach((o) => check("schema: rack type " + o + " defined", !!RT[o]));
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
  if (L.rackRowLength > L.usableLength + 1e-9 || L.rackRowLength + q.bay_width <= L.usableLength - 1e-9) ok = false;
  // every row faces an aisle
  rows.forEach((r) => { const face = r.faces > 0 ? r.y + r.depth : r.y; if (!L.aisles.some((a) => near(Math.abs(a.y - face), q.aisle_width / 2, 1e-9))) ok = false; });
  if (ok) geomOK++; else if (geomOK + 5 > n) console.log("  geometry counter-example:", JSON.stringify(q));
}
check("geometry invariants hold for 3000 random designs", geomOK === 3000, geomOK);

// ---------------------------------------------------------------- travel: formula == brute force over every slot
function bruteTravel(q) {
  const L = calc.computeLayout(q, RT);
  const doorsIn = calc.doorCentres(q.num_receiving_docks, q), doorsOut = calc.doorCentres(q.num_shipping_docks, q);
  let sumIn = 0, sumOut = 0, sumZ = 0, n = 0;
  L.rows.forEach((row) => {
    // the aisle this row faces
    const face = row.faces > 0 ? row.y + row.depth : row.y;
    const aisle = L.aisles.find((a) => near(Math.abs(a.y - face), q.aisle_width / 2, 1e-9));
    for (let b = 0; b < L.baysPerRow; b++) {
      const x = q.cross_aisle_width + (b + 0.5) * q.bay_width;
      L.levelHeights.forEach((z) => {
        doorsIn.forEach((d) => { sumIn += Math.abs(d - aisle.y) + x; });
        doorsOut.forEach((d) => { sumOut += Math.abs(d - aisle.y) + (q.warehouse_length - x); });
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
  const q = randomP(); q.warehouse_length = rnd(40, 120); q.warehouse_width = rnd(20, 70);
  const r = calc.computeAll(q, RT);
  if (!r.layout.numRackRows || !r.layout.baysPerRow) { travelOK++; continue; }
  const b = bruteTravel(q), e = Math.abs(b.round - r.travel.avgRoundTrip) + Math.abs(b.cycle - r.travel.cycleTime);
  worst = Math.max(worst, e);
  if (e < 1e-6) travelOK++;
}
check("travel formula matches brute force over every door/slot/level (300 designs)", travelOK === 300, "worst error " + worst);

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

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
