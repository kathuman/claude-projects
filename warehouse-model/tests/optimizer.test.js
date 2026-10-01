// Tests for web/src/optimizer.js — run with:  node warehouse-model/tests/optimizer.test.js
const path = require("path");
const fs = require("fs");
const calc = require("../web/src/calculations.js");
const opt = require("../web/src/optimizer.js");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/parameters.json"), "utf8"));
const RT = {};
for (const k in data.rack_types) if (k.charAt(0) !== "$") RT[k] = data.rack_types[k];
const base = {};
for (const k in data.parameters) base[k] = data.parameters[k].value;
const withP = (o) => Object.assign({}, base, o);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  → " + detail : "")); }
}

const t0 = Date.now();
const res = opt.search(base, RT, { widthStep: 5, targetWait: 15, minSelectivity: 0 });
const ms = Date.now() - t0;
const D = res.designs;
check("finds feasible designs", D.length > 20, D.length + " of " + res.evaluated);
check("sorted by annual TCO", D.every((d, i) => i === 0 || D[i - 1].tco <= d.tco + 1e-9));

// every design really is feasible when re-run through the model
let ok = 0;
D.forEach((d) => {
  const r = calc.computeAll(d.q, RT);
  const good = !r.warnings.some((w) => w.level === "critical") && r.capacity.practicalCapacity >= d.q.current_inventory_pallets &&
    r.throughput.maxWait <= 15 && Math.abs(r.cost.annualTCO - d.tco) < 1e-6 &&
    d.q.warehouse_length <= 300 && d.q.clear_height <= 18 && d.q.aisle_width + 1e-9 >= RT[d.rackType].min_aisle;
  if (good) ok++;
});
check("every design re-checks as feasible (capacity, wait, no critical warnings, limits)", ok === D.length, ok + "/" + D.length);

// no fatter than needed: one bay fewer per row would not hold the inventory
let tight = 0;
D.slice(0, 40).forEach((d) => {
  const shorter = Object.assign({}, d.q, { warehouse_length: d.q.warehouse_length - d.q.bay_width * (1 + Math.round(d.q.mid_cross_aisles || 0)) });
  if (shorter.warehouse_length < 40) { tight++; return; }
  const r = calc.computeAll(shorter, RT);
  if (r.capacity.practicalCapacity < d.q.current_inventory_pallets || r.layout.baysPerRow < 1) tight++;
});
check("each design's length is just long enough (one bay less fails)", tight === Math.min(40, D.length), tight);

// the best design is no more expensive than the baseline (which meets the same targets)
const b = calc.computeAll(base, RT);
check("baseline meets the targets", b.capacity.practicalCapacity >= base.current_inventory_pallets && b.throughput.maxWait <= 15);
check("optimum TCO ≤ baseline TCO", D[0].tco <= b.cost.annualTCO + 1e-6, "$" + Math.round(D[0].tco) + " vs $" + Math.round(b.cost.annualTCO));

// a finer width step can only find something as good or better
const fine = opt.search(base, RT, { widthStep: 2.5, targetWait: 15, minSelectivity: 0 });
check("finer search is at least as good", fine.designs[0].tco <= D[0].tco + 1e-6);

// Pareto front: first design is on it; no front design is dominated
const front = D.filter((d) => d.pareto);
check("cheapest design is on the Pareto front", D[0].pareto);
check("no Pareto design is beaten on both cost and time", front.every((f) => !D.some((d) => d.tco < f.tco - 1e-9 && d.perMove < f.perMove - 1e-9)));

// more inventory → at least as much capital
const more = opt.search(withP({ current_inventory_pallets: 12000 }), RT, { widthStep: 5, targetWait: 15, minSelectivity: 0 });
check("more inventory needs more capital", more.designs[0].capital >= D[0].capital, Math.round(more.designs[0].capital) + " vs " + Math.round(D[0].capital));
// a tighter wait target needs at least as many doors
const strict = opt.search(withP({ daily_throughput_pallets: 2000 }), RT, { widthStep: 10, targetWait: 2 }), loose = opt.search(withP({ daily_throughput_pallets: 2000 }), RT, { widthStep: 10, targetWait: 30 });
check("tighter wait target → more doors", strict.designs[0].doorsIn + strict.designs[0].doorsOut >= loose.designs[0].doorsIn + loose.designs[0].doorsOut);
// hopeless targets: empty result, no crash
const none = opt.search(withP({ current_inventory_pallets: 30000, daily_throughput_pallets: 5000, peak_hour_factor: 3 }), RT, { widthStep: 10, targetWait: 0.01 });
check("impossible targets → no designs, no crash", Array.isArray(none.designs) && none.designs.length === 0);
// selectivity target: by default only fully selective systems (selective, VNA)
const sel = opt.search(base, RT, { widthStep: 5, targetWait: 15 });
check("default: only 100%-selective rack types", sel.designs.length > 0 && sel.designs.every((d) => d.selectivity === 1));
check("allowing deep lanes can only lower the cost", D[0].tco <= sel.designs[0].tco + 1e-6);
const half = opt.search(base, RT, { widthStep: 5, targetWait: 15, minSelectivity: 0.5 });
check("50% selectivity allows double-deep but not push-back/drive-in", half.designs.some((d) => d.rackType === "double_deep") && half.designs.every((d) => d.selectivity >= 0.5));
console.log("fully selective best: " + sel.designs[0].label + ", " + sel.designs[0].levels + " levels, " + sel.designs[0].length + " × " + sel.designs[0].width + " m, TCO $" + Math.round(sel.designs[0].tco) + "/y");
console.log("search: " + res.evaluated + " candidates, " + D.length + " feasible, " + ms + " ms; best: " + D[0].label + ", " + D[0].levels + " levels, " + D[0].length + " × " + D[0].width + " m, TCO $" + Math.round(D[0].tco) + "/y");

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
