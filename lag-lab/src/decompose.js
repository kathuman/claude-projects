// Lag Lab decomposition — splits the production overshoot after a demand change into its causes, by running the
// same change three times:
//   (a) the current policy with its realistic (smoothed) forecast
//   (b) the current policy with a perfect forecast
//   (c) a perfect forecast with full supply-line accounting: w_SL = 1, w_V = 1, hiring on the capacity gap
// Overshoot is the production above demand (below it, for a step down), counted only where it happens: over a whole
// run the net extra production always equals the refill, so a net measure would hide the oscillation.
//   necessary refill  R = |ΔI* + ΔSL* − ΔB*|   (bigger inventory target and pipeline, less of it waiting as backlog)
//   structural        E_c − R                    (what even a perfect forecast and full accounting cannot avoid)
//   policy            E_b − E_c                  (decision rules)
//   forecast          E_a − E_b                  (the lag in expected demand; can be negative: lag sometimes damps)
// The four add up to E_a, the overshoot of the current plan, exactly.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./model.js"));
  else root.LagDecompose = factory(root.LagLab);
})(typeof self !== "undefined" ? self : this, function (LagLab) {
  "use strict";

  var LAYERS = [
    { id: "necessary", name: "Necessary refill", remedy: "Arithmetic, not error: a bigger inventory target and a longer pipeline must be filled. Only shorter delays or lower targets reduce it." },
    { id: "structural", name: "Structure", remedy: "The dynamics left even with a perfect forecast and full accounting: delays in production and hiring. Shorter delays reduce it." },
    { id: "policy", name: "Policy", remedy: "Decision rules: under-weighting the supply line, aggressive adjustment times, hiring on the inventory gap. Fixed by changing the rules." },
    { id: "forecast", name: "Forecast", remedy: "The lag in expected demand. Only this part is a forecasting problem." }
  ];

  function fixedPolicy(p) {
    var q = {}; Object.keys(p).forEach(function (k) { q[k] = p[k]; });
    return q;
  }

  function decompose(params, opts) {
    var p = LagLab.merge(params);
    var b = fixedPolicy(p); b.forecast = "perfect";
    var c = fixedPolicy(p); c.forecast = "perfect"; c.wSL = 1; c.wV = 1; c.hiringDriver = "capacity";
    var runs = { a: LagLab.simulate(p, opts), b: LagLab.simulate(b, opts), c: LagLab.simulate(c, opts) };
    var d0 = LagLab.demandAt(p.demand, 0), d1 = LagLab.demandAt(p.demand, p.horizon), dD = d1 - d0;
    var dir = dD > 0 ? 1 : dD < 0 ? -1 : 0;
    var refillSigned = (p.inventoryCoverage + p.productionLeadTime - p.targetDeliveryDelay) * dD;
    var R = Math.abs(refillSigned);
    var ex = function (r) { return dir >= 0 ? r.totals.excessUp : r.totals.excessDown; };
    var E = { a: ex(runs.a), b: ex(runs.b), c: ex(runs.c) };
    var layers = { necessary: dir ? R : 0, structural: E.c - (dir ? R : 0), policy: E.b - E.c, forecast: E.a - E.b };
    var total = E.a;
    // has each run come to rest? Net extra production equals the refill once it has (conservation)
    var settled = {};
    ["a", "b", "c"].forEach(function (k) {
      var r = runs[k], net = dir * (r.totals.starts - r.totals.demand);
      settled[k] = R < 1e-9 ? Math.abs(net) < 1e-6 * Math.max(1, d0) : Math.abs(net - R) <= 0.05 * R;
    });
    var shares = {};
    LAYERS.forEach(function (l) { shares[l.id] = total > 1e-12 ? layers[l.id] / total : 0; });
    return {
      params: p, runs: runs, direction: dir, demandChange: dD, refill: R, excess: E, total: total, layers: layers, shares: shares,
      settled: settled, allSettled: settled.a && settled.b && settled.c,
      // what planning would call forecast error (all of it) against what is (the forecast layer)
      apparentForecastError: total, actualForecastShare: total > 1e-12 ? layers.forecast / total : 0
    };
  }

  return { LAYERS: LAYERS, decompose: decompose };
});
