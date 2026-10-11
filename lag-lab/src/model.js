// Lag Lab model — a production and workforce chain in the style of Sterman, Business Dynamics, ch. 17–19.
// Pure functions, no browser: runs the same in the page and in the Node tests.
//
// Stocks: backlog B, finished inventory I, supply line SL (a third-order delay of production starts, three stages),
// workforce W (experienced), trainees T (recruits ramping up), vacancies V, expected demand Dexp.
// Time is in weeks, material in units, people in workers. Euler integration with a small step, as in Sterman.
//
// Decision rules (anchor and adjust):
//   desired starts      DS = max(0, Dexp + (I* − I)/TAI + wSL·(SL* − SL)/TASL)
//   desired hiring      Hd = attrition + (E* − E)/TAW            E = W + ρ·T (effective workforce)
//   vacancy creation    VC = max(0, Hd + wV·(V* − V)/TAV)          V* = max(0, Hd)·hiringDelay
// Physical constraints:
//   capacity            Cap = productivity · E
//   production starts   Starts = Cap · u, utilisation u = clamp(DS / Cap, uMin, uMax)  (a flexible workweek: output
//                       follows the workforce, within a band; 'unconstrained' capacity gives Starts = DS, ch. 17)
//   shipments           S = min(B / targetDeliveryDelay, I / minProcessingTime)  (unfilled orders stay in backlog)
// Hiring driver (the policy choice):
//   'capacity'   E* = DS / productivity           — hire for the capacity the production plan needs
//   'inventory'  E* = (Dexp + (I* − I)/TAI) / productivity — hire on the shelf gap, blind to the work already in
//                the production pipeline (the supply line) whatever the start rule does
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LagLab = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "0.2.0";

  // Defaults: a weekly-planned plant. Changing any of these is what the app's sliders do.
  function defaults() {
    return {
      // demand
      demand: { type: "step", base: 100, size: 0.2, at: 10 },   // +20% at week 10
      // physical delays and targets
      productionLeadTime: 6,        // weeks, mean of the third-order supply-line delay
      targetDeliveryDelay: 2,       // weeks of backlog at the normal shipment rate
      minProcessingTime: 1,         // weeks: inventory / this is the fastest the warehouse can ship
      inventoryCoverage: 3,         // weeks of expected demand held as the inventory target (≥ minProcessingTime)
      productivity: 1,              // units per experienced worker per week
      hiringDelay: 8,               // weeks to fill a vacancy
      trainingTime: 12,             // weeks before a recruit is fully productive
      rookieProductivity: 0.5,      // a recruit's productivity relative to an experienced worker
      averageTenure: 104,           // weeks; attrition = W / averageTenure
      uMin: 0.8, uMax: 1.2,         // utilisation band (short-time working … overtime)
      capacity: "workforce",        // 'workforce' (ch. 19) or 'unconstrained' (ch. 17 stock management)
      // policy
      TAI: 4,                       // inventory adjustment time, weeks
      TASL: 4,                      // supply-line adjustment time, weeks
      wSL: 0.3,                     // weight on the supply line (1 = fully accounted)
      TAW: 6,                       // workforce adjustment time, weeks
      TAV: 4,                       // vacancy adjustment time, weeks
      wV: 0.3,                      // weight on vacancies
      forecastTime: 8,              // exponential smoothing time for expected demand, weeks
      forecast: "smooth",           // 'smooth' or 'perfect' (expected demand = actual demand)
      hiringDriver: "inventory",    // 'inventory' or 'capacity'
      // run
      horizon: 104, dt: 0.0625
    };
  }

  function merge(p) {
    var d = defaults(), out = {};
    Object.keys(d).forEach(function (k) { out[k] = d[k]; });
    Object.keys(p || {}).forEach(function (k) {
      if (k === "demand") { out.demand = {}; Object.keys(d.demand).forEach(function (j) { out.demand[j] = d.demand[j]; }); Object.keys(p.demand || {}).forEach(function (j) { out.demand[j] = p.demand[j]; }); }
      else out[k] = p[k];
    });
    return out;
  }

  // demand at time t. Phase 1 has the step plus simple ramp and pulse; noise and repeated steps come with the stress test.
  function demandAt(d, t) {
    var b = d.base;
    if (d.type === "constant") return b;
    if (d.type === "step") return t >= d.at ? b * (1 + d.size) : b;
    if (d.type === "ramp") { var len = d.length || 10; return t < d.at ? b : t >= d.at + len ? b * (1 + d.size) : b * (1 + d.size * (t - d.at) / len); }
    if (d.type === "pulse") { var w = d.length || 1; return t >= d.at && t < d.at + w ? b * (1 + d.size) : b; }
    throw new Error("unknown demand type " + d.type);
  }

  // one Euler step of a third-order delay held in three stages: returns the outflow and updates the stages
  function delay3Step(stages, inflow, tau, dt) {
    var k = 3 / tau, o0 = stages[0] * k, o1 = stages[1] * k, o2 = stages[2] * k;
    stages[0] += (inflow - o0) * dt;
    stages[1] += (o0 - o1) * dt;
    stages[2] += (o1 - o2) * dt;
    return o2;
  }

  function validate(p) {
    var errs = [];
    ["productionLeadTime", "targetDeliveryDelay", "minProcessingTime", "productivity", "hiringDelay", "trainingTime", "averageTenure", "TAI", "TASL", "TAW", "TAV", "forecastTime", "horizon", "dt"].forEach(function (k) {
      if (!(typeof p[k] === "number" && p[k] > 0)) errs.push(k + " must be a positive number");
    });
    if (p.inventoryCoverage < p.minProcessingTime) errs.push("inventoryCoverage must be at least minProcessingTime, or the target inventory cannot ship the demand");
    if (!(p.uMin > 0 && p.uMin <= 1 && p.uMax >= 1)) errs.push("need 0 < uMin ≤ 1 ≤ uMax");
    if (!(p.rookieProductivity >= 0 && p.rookieProductivity <= 1)) errs.push("rookieProductivity must be in [0, 1]");
    // Euler needs the step well below the shortest time constant
    var shortest = Math.min(p.productionLeadTime / 3, p.targetDeliveryDelay, p.minProcessingTime, p.TAI, p.TASL, p.TAW, p.TAV, p.forecastTime, p.hiringDelay, p.trainingTime);
    if (p.dt > shortest / 4) errs.push("dt " + p.dt + " is too large for the shortest time constant " + shortest.toFixed(3) + " (use dt ≤ " + (shortest / 4).toFixed(4) + ")");
    ["wSL", "wV"].forEach(function (k) { if (!(p[k] >= 0 && p[k] <= 1)) errs.push(k + " must be in [0, 1]"); });
    if (["smooth", "perfect"].indexOf(p.forecast) < 0) errs.push("forecast must be 'smooth' or 'perfect'");
    if (["inventory", "capacity"].indexOf(p.hiringDriver) < 0) errs.push("hiringDriver must be 'inventory' or 'capacity'");
    if (["workforce", "unconstrained"].indexOf(p.capacity) < 0) errs.push("capacity must be 'workforce' or 'unconstrained'");
    return errs;
  }

  // the equilibrium the model starts in, for demand d0
  function equilibrium(p, d0) {
    var hires = 0, W, T, V;
    var Estar = d0 / p.productivity;
    // E = W + ρT with T = hires·trainingTime and hires = attrition = W/averageTenure
    W = Estar / (1 + p.rookieProductivity * p.trainingTime / p.averageTenure);
    hires = W / p.averageTenure;
    T = hires * p.trainingTime;
    V = hires * p.hiringDelay;
    var sl = d0 * p.productionLeadTime;
    return { B: d0 * p.targetDeliveryDelay, I: d0 * p.inventoryCoverage, S: [sl / 3, sl / 3, sl / 3], W: W, T: T, V: V, Dexp: d0 };
  }

  var SERIES = ["demand", "expectedDemand", "backlog", "inventory", "supplyLine", "workforce", "trainees", "vacancies", "effectiveWorkforce",
    "desiredInventory", "desiredSupplyLine", "desiredStarts", "starts", "completions", "shipments", "capacity", "utilisation",
    "desiredWorkforce", "desiredHiring", "vacancyCreation", "vacancyCancellation", "hires", "graduations", "attrition", "layoffs", "desiredVacancies"];

  // Run the model. Returns columns sampled every `every` steps (default: every week), plus the parameters used.
  function simulate(params, opts) {
    var p = merge(params), errs = validate(p);
    if (errs.length) throw new Error("Lag Lab: " + errs.join("; "));
    opts = opts || {};
    var dt = p.dt, n = Math.round(p.horizon / dt), every = opts.every || Math.max(1, Math.round(1 / dt));
    var d0 = demandAt(p.demand, 0), x = equilibrium(p, d0);
    var B = x.B, I = x.I, S = x.S.slice(), W = x.W, T = x.T, V = x.V, Dexp = x.Dexp;
    var out = { t: [], params: p }; SERIES.forEach(function (k) { out[k] = []; });
    // running totals for the conservation checks
    // excessUp / excessDown: production above / below demand, counted separately (they would net out)
    var tot = { starts: 0, demand: 0, hires: 0, attrition: 0, layoffs: 0, shipments: 0, excessUp: 0, excessDown: 0 };
    var unc = p.capacity === "unconstrained", perfect = p.forecast === "perfect", capDriver = p.hiringDriver === "capacity";
    for (var i = 0; i <= n; i++) {
      var t = i * dt, D = demandAt(p.demand, t);
      if (perfect) Dexp = D;
      var SL = S[0] + S[1] + S[2];
      var Istar = Dexp * p.inventoryCoverage, SLstar = Dexp * p.productionLeadTime;
      var DS = Math.max(0, Dexp + (Istar - I) / p.TAI + p.wSL * (SLstar - SL) / p.TASL);
      var E = W + p.rookieProductivity * T, cap = p.productivity * E;
      var starts, u;
      if (unc) { starts = DS; u = cap > 0 ? DS / cap : 1; }
      else { u = cap > 0 ? Math.min(p.uMax, Math.max(p.uMin, DS / cap)) : p.uMax; starts = cap * u; }
      var ship = Math.min(B / p.targetDeliveryDelay, I / p.minProcessingTime);
      // workforce
      var Estar = capDriver ? DS / p.productivity : Math.max(0, Dexp + (Istar - I) / p.TAI) / p.productivity;
      var attr = W / p.averageTenure;
      var Hd = attr + (Estar - E) / p.TAW;
      var Vstar = Math.max(0, Hd) * p.hiringDelay;
      var vc = 0, vx = 0, lay = 0;
      if (Hd >= 0) {
        var want = Hd + p.wV * (Vstar - V) / p.TAV;
        if (want >= 0) vc = want; else vx = Math.min(-want, V / p.TAV);
      } else {
        vx = V / p.TAV;                                   // stop hiring: cancel what is open
        lay = Math.min(-Hd, W / p.TAW);                    // and let people go beyond attrition
      }
      var hires = V / p.hiringDelay, grad = T / p.trainingTime;
      if (i % every === 0) {
        out.t.push(t);
        var row = [D, Dexp, B, I, SL, W, T, V, E, Istar, SLstar, DS, starts, 0, ship, cap, u, Estar, Hd, vc, vx, hires, grad, attr, lay, Vstar];
        row[13] = S[2] * 3 / p.productionLeadTime;
        for (var k = 0; k < SERIES.length; k++) out[SERIES[k]].push(row[k]);
      }
      if (i === n) break;
      // integrate
      var comp = delay3Step(S, starts, p.productionLeadTime, dt);
      B += (D - ship) * dt;
      I += (comp - ship) * dt;
      V += (vc - vx - hires) * dt;
      T += (hires - grad) * dt;
      W += (grad - attr - lay) * dt;
      if (!perfect) Dexp += (D - Dexp) / p.forecastTime * dt;
      tot.excessUp += Math.max(0, starts - D) * dt; tot.excessDown += Math.max(0, D - starts) * dt;
      tot.starts += starts * dt; tot.demand += D * dt; tot.hires += hires * dt; tot.attrition += attr * dt; tot.layoffs += lay * dt; tot.shipments += ship * dt;
    }
    out.totals = tot;
    out.final = { B: B, I: I, SL: S[0] + S[1] + S[2], W: W, T: T, V: V, Dexp: Dexp };
    out.initial = { B: x.B, I: x.I, SL: x.S[0] + x.S[1] + x.S[2], W: x.W, T: x.T, V: x.V, Dexp: x.Dexp };
    return out;
  }

  // Describe a response: the final value (mean of the last 10% of the run), the peak deviation beyond it in the
  // direction of the change, overshoot as a share of the change, settling time into a ±band of the change, and how
  // many times the series crosses its final value after the step (≥ 2 means it oscillates).
  function analyze(ys, ts, tStep, band) {
    band = band || 0.02;
    var n = ys.length, tail = Math.max(1, Math.round(n * 0.1)), fin = 0;
    for (var i = n - tail; i < n; i++) fin += ys[i];
    fin /= tail;
    var i0 = 0; while (i0 < n && ts[i0] < tStep) i0++;
    var start = ys[Math.max(0, i0 - 1)], change = fin - start, dir = change >= 0 ? 1 : -1;
    var tol = Math.max(Math.abs(change) * band, 1e-9 * Math.max(1, Math.abs(fin))), settle = null;
    // a crossing counts only when the series swings from beyond +band to beyond −band (or back), so the small
    // wiggles of a settled series are not mistaken for oscillation
    var peak = start, crossings = 0, side = 0;
    for (i = i0; i < n; i++) {
      if ((ys[i] - peak) * dir > 0) peak = ys[i];
      var s = ys[i] - fin, now = s > tol ? 1 : s < -tol ? -1 : 0;
      if (now !== 0) { if (side !== 0 && now !== side) crossings++; side = now; }
    }
    for (i = n - 1; i >= i0; i--) if (Math.abs(ys[i] - fin) > tol) { settle = (ts[i + 1] !== undefined ? ts[i + 1] : ts[i]) - tStep; break; }
    if (settle === null) settle = 0;
    return { start: start, final: fin, change: change, peak: peak, overshoot: Math.abs(change) > 1e-12 ? Math.max(0, (peak - fin) * dir) / Math.abs(change) : 0, settlingTime: settle, crossings: crossings };
  }

  return { VERSION: VERSION, defaults: defaults, merge: merge, validate: validate, demandAt: demandAt, delay3Step: delay3Step, equilibrium: equilibrium, simulate: simulate, analyze: analyze, SERIES: SERIES };
});
