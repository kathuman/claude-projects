// Lag Lab decomposition checks — run with: node lag-lab/tests/decompose.test.js
// The layers add up exactly; a layer vanishes when its cause is removed; the refill matches conservation; the
// textbook fix leaves only the refill; steps down work the same way; and a negative forecast layer is reported as one.
const L = require("../src/model.js"), Dc = require("../src/decompose.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const fmt = (d) => Object.keys(d.layers).map((k) => k + " " + d.layers[k].toFixed(1)).join(", ");
const H = { horizon: 300 };

// ---- the layers add up to the overshoot of the current plan, exactly
for (const p of [{}, { hiringDriver: "capacity" }, { wSL: 0.1, TAI: 3 }, { demand: { size: 0.5 } }, { demand: { size: -0.3 } }, { forecastTime: 2 }]) {
  const d = Dc.decompose(Object.assign({}, H, p));
  const sum = d.layers.necessary + d.layers.structural + d.layers.policy + d.layers.forecast;
  check("layers add up to the plan's overshoot  " + JSON.stringify(p), near(sum, d.total, 1e-9 * Math.max(1, d.total)) && near(Object.values(d.shares).reduce((a, b) => a + b, 0), 1, 1e-12), fmt(d) + " = " + d.total.toFixed(1));
}

// ---- the refill: (coverage + lead time − delivery delay) × ΔD, and the net extra production of a settled run
{
  const d = Dc.decompose(H), P = d.params;
  check("necessary refill = (inventory coverage + lead time − delivery delay) × ΔD", near(d.refill, (P.inventoryCoverage + P.productionLeadTime - P.targetDeliveryDelay) * 20, 1e-9), d.refill.toFixed(2) + " units");
  const r = d.runs.c, net = r.totals.starts - r.totals.demand;
  check("…and it equals the net extra production once run (c) has settled (conservation)", near(net, d.refill, 0.01 * d.refill) && d.settled.c, net.toFixed(2));
  check("all three runs settle within 300 weeks at the defaults", d.allSettled);
}

// ---- a layer vanishes when its cause is removed
{
  const perfect = Dc.decompose(Object.assign({}, H, { forecast: "perfect" }));
  check("a plan that already forecasts perfectly has no forecast layer", perfect.layers.forecast === 0, perfect.layers.forecast);
  const fixed = Dc.decompose(Object.assign({}, H, { wSL: 1, wV: 1, hiringDriver: "capacity" }));
  check("a plan that already accounts fully for the supply line and hires on capacity has no policy layer", near(fixed.layers.policy, 0, 1e-12), fixed.layers.policy);
  const flat = Dc.decompose(Object.assign({}, H, { demand: { type: "constant" } }));
  check("no demand change: nothing to decompose", flat.total === 0 && flat.refill === 0 && Object.values(flat.layers).every((v) => v === 0) && flat.direction === 0);
}

// ---- the textbook fix leaves only the refill (unconstrained stock management, ch. 17)
{
  const d = Dc.decompose(Object.assign({}, H, { capacity: "unconstrained", TASL: 4, TAI: 4 }));
  check("with full supply-line accounting and no capacity limit, run (c) overshoots by exactly the refill (no structural layer)", Math.abs(d.layers.structural) < 0.01 * d.refill, fmt(d));
  check("…while under-weighting the supply line shows up as policy", d.layers.policy > 0.1 * d.refill, d.layers.policy.toFixed(1));
}

// ---- policy rather than forecasting dominates at the defaults: the app's point, held as a regression guard
{
  const d = Dc.decompose(H);
  check("defaults: the policy layer is bigger than the forecast layer", d.layers.policy > d.layers.forecast, fmt(d));
  check("defaults: well under half of the overshoot is a forecasting problem", d.actualForecastShare < 0.5, (d.actualForecastShare * 100).toFixed(0) + "%");
  const worse = Dc.decompose(Object.assign({}, H, { wSL: 0, TAI: 2 }));
  check("aggressive rules (wSL 0, TAI 2): the policy layer grows", worse.layers.policy > d.layers.policy, worse.layers.policy.toFixed(0) + " vs " + d.layers.policy.toFixed(0));
  const slow = Dc.decompose(Object.assign({}, H, { forecastTime: 16, wSL: 1, wV: 1, hiringDriver: "capacity" }));
  check("with good rules, a slow forecast is the remaining cause beyond structure", slow.layers.policy === 0 || near(slow.layers.policy, 0, 1e-9), fmt(slow));
}

// ---- steps down are handled symmetrically
{
  const up = Dc.decompose(Object.assign({}, H, { demand: { size: 0.2 } })), down = Dc.decompose(Object.assign({}, H, { demand: { size: -0.2 } }));
  check("a step down: the refill is positive (a smaller target to run down) and the layers still add up", down.direction === -1 && near(down.refill, up.refill, 1e-9) && down.total > 0, fmt(down));
}

// ---- a negative layer is possible and kept as such
{
  // look for a case where the smoothed forecast's lag damps the reaction
  let found = null;
  for (const wSL of [0, 0.1, 0.2, 0.3]) for (const TAI of [1.5, 2, 3]) {
    const d = Dc.decompose(Object.assign({}, H, { wSL, TAI }));
    if (d.layers.forecast < 0) { found = { wSL, TAI, f: d.layers.forecast, sum: d.layers.necessary + d.layers.structural + d.layers.policy + d.layers.forecast, total: d.total }; break; }
  }
  check("some policies have a negative forecast layer (the lag damped the overshoot), kept negative and still adding up", found !== null && near(found.sum, found.total, 1e-9 * found.total), found ? JSON.stringify(found) : "none found");
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
