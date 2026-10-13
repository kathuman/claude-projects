// Real Options for Network Design — the controls of both pages: labels, ranges, defaults (in the units shown) and the
// scale to model units (model value = shown value × scale), and the presets. Shared by the pages, the decision report,
// the tutorial and the tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ROSpecs = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function pct(v) { return v + "%"; }
  function pctS(v) { return (v > 0 ? "+" : "") + v + "%/yr"; }
  function yrs(v) { return v + (v === 1 ? " year" : " years"); }
  function perUnit(v) { return "$" + v + "/unit"; }
  function ofToday(v) { return v + "% of today"; }
  function kU(v) { return v + "k units/yr"; }
  function index(groups) { var s = {}; groups.forEach(function (g) { g.items.forEach(function (it) { s[it.id] = it; }); }); return s; }
  // model parameters from values in the units shown (defaults for anything not given)
  function toModel(specs, shown, basis) {
    var p = { basis: basis || "wacc" };
    Object.keys(specs).forEach(function (k) { var v = shown && shown[k] != null ? shown[k] : specs[k].def; p[k] = v * (specs[k].scale || 1); });
    return p;
  }

  var single = (function () {
    var GROUPS = [
      { name: "Demand", items: [
        { id: "D0", label: "Demand today", min: 100, max: 2000, step: 50, def: 500, fmt: function (v) { return v + "k units/yr"; } },
        { id: "sigma", label: "Volatility", min: 5, max: 60, step: 1, def: 25, scale: 0.01, fmt: pct, hint: "Yearly standard deviation of demand growth." },
        { id: "g", label: "Expected growth", min: -10, max: 12, step: 0.5, def: 4, scale: 0.01, fmt: pctS },
        { id: "ceiling", label: "Market ceiling", min: 1.5, max: 6, step: 0.5, def: 3, fmt: function (v) { return v + "× today"; }, hint: "Demand saturates here." } ] },
      { name: "Time", items: [
        { id: "life", label: "Asset life", min: 10, max: 30, step: 1, def: 20, fmt: yrs },
        { id: "window", label: "Decision window", min: 1, max: 15, step: 1, def: 8, fmt: yrs, hint: "How long you can still build or expand. After it the network stays as it is." },
        { id: "buildLead", label: "Build lead time", min: 0, max: 3, step: 0.25, def: 1.5, fmt: yrs },
        { id: "expandLead", label: "Expansion lead time", min: 0, max: 2, step: 0.25, def: 1, fmt: yrs } ] },
      { name: "Economics", items: [
        { id: "margin", label: "Margin, own network", min: 5, max: 40, step: 1, def: 20, scale: 0.001, fmt: perUnit },
        { id: "opcost", label: "Holding cost of capacity", min: 1, max: 15, step: 0.5, def: 6, scale: 0.001, fmt: function (v) { return "$" + v + "/unit·yr"; } },
        { id: "outMargin", label: "Margin, outsourced (3PL)", min: 0, max: 20, step: 0.5, def: 6, scale: 0.001, fmt: perUnit },
        { id: "outCap", label: "Outsourcing limit", min: 0, max: 200, step: 10, def: 100, scale: 0.01, fmt: function (v) { return v + "% of today"; } },
        { id: "penalty", label: "Penalty, lost sale", min: 0, max: 40, step: 1, def: 10, scale: 0.001, fmt: perUnit } ] },
      { name: "Valuation", basis: true, items: [
        { id: "wacc", label: "WACC", min: 4, max: 16, step: 0.5, def: 10, scale: 0.01, fmt: pct, only: "wacc" },
        { id: "rf", label: "Risk-free rate", min: 0, max: 8, step: 0.25, def: 3, scale: 0.01, fmt: pct, only: "rn" },
        { id: "lambda", label: "Market price of demand risk λ", min: 0, max: 1, step: 0.05, def: 0.3, fmt: function (v) { return v.toFixed(2); }, only: "rn", hint: "Risk-neutral drift = growth − λ·volatility." } ] },
      { name: "Design & costs", items: [
        { id: "bigF", label: "Full footprint", min: 60, max: 300, step: 5, def: 140, scale: 0.01, fmt: ofToday },
        { id: "smallF", label: "Initial stage", min: 30, max: 150, step: 5, def: 80, scale: 0.01, fmt: ofToday },
        { id: "stepF", label: "Expansion step", min: 5, max: 60, step: 5, def: 15, scale: 0.01, fmt: ofToday },
        { id: "premium", label: "Staging premium", min: 0, max: 60, step: 5, def: 25, scale: 0.01, fmt: pct, hint: "Extra cost per unit added in a later step." },
        { id: "fFix", label: "Fixed cost of a site", min: 0, max: 30, step: 1, def: 8, fmt: function (v) { return "$" + v + "M"; } },
        { id: "fVar", label: "Capex per unit of capacity", min: 10, max: 60, step: 1, def: 30, scale: 0.001, fmt: perUnit },
        { id: "escal", label: "Cost escalation if delayed", min: 0, max: 15, step: 1, def: 6, scale: 0.01, fmt: function (v) { return v + "%/yr"; } } ] },
      { name: "Exit & leasing", items: [
        { id: "salvF", label: "Resale value of a site", min: 0, max: 80, step: 5, def: 30, scale: 0.01, fmt: function (v) { return v + "% of cost"; }, hint: "What an owned site sells for when new; it declines to zero over the asset life. Generic buildings resell well, specialised ones do not." },
        { id: "rent", label: "Lease rent", min: 2, max: 12, step: 0.25, def: 6.5, scale: 0.001, fmt: function (v) { return "$" + v + "/unit·yr"; } },
        { id: "leaseFit", label: "Fit-out cost of a lease", min: 0, max: 100, step: 5, def: 25, scale: 0.01, fmt: function (v) { return v + "% of site fixed cost"; } },
        { id: "leaseLead", label: "Fit-out time", min: 0, max: 2, step: 0.25, def: 0.5, fmt: yrs },
        { id: "minTerm", label: "First break date", min: 1, max: 15, step: 1, def: 5, fmt: function (v) { return "year " + v + " of the lease"; } },
        { id: "breakEvery", label: "Then a break every", min: 0, max: 10, step: 1, def: 5, fmt: function (v) { return v === 0 ? "no further breaks" : yrs(v); } },
        { id: "breakFee", label: "Break fee", min: 0, max: 3, step: 0.25, def: 1, fmt: function (v) { return v + (v === 1 ? " year" : " years") + " of rent"; } } ] },
      { name: "Switching", items: [
        { id: "moth", label: "Owned sites can be mothballed", check: true, def: 1, hint: "Idle the site and send demand to the 3PL, then restart it if demand returns." },
        { id: "mothF", needs: "moth", label: "Holding cost while idle", min: 0, max: 80, step: 5, def: 20, scale: 0.01, fmt: function (v) { return v + "% of active"; } },
        { id: "mothFix", needs: "moth", label: "Cost to mothball", min: 0, max: 5, step: 0.25, def: 0.5, fmt: function (v) { return "$" + v + "M"; } },
        { id: "reactFix", needs: "moth", label: "Cost to restart", min: 0, max: 5, step: 0.25, def: 1, fmt: function (v) { return "$" + v + "M"; } },
        { id: "contract", label: "Staged site can sell capacity back in steps", check: true, def: 1, hint: "Proceeds: the resale value of the capacity sold, without the site's fixed share." } ] }
    ];

    var SPECS = index(GROUPS);
    var PRESETS = {
      "Mature & stable": { sigma: 12, g: 1, penalty: 8, premium: 25, bigF: 125 },
      "High-growth, uncertain": { sigma: 35, g: 9, smallF: 90, bigF: 260, stepF: 30, penalty: 12 },
      "Volatile & flat": { sigma: 45, g: 0, premium: 20, penalty: 12 },
      "Structural decline": { sigma: 20, g: -6, smallF: 60, bigF: 110, penalty: 6 },
      "Capacity-crunch risk": { sigma: 30, g: 6, penalty: 26, margin: 28, premium: 30, smallF: 75 },
      "Specialised site": { sigma: 35, g: 0, salvF: 0, opcost: 10, mothF: 10 }
    };
    return { GROUPS: GROUPS, SPECS: SPECS, PRESETS: PRESETS };
  })();

  var network = (function () {
    var GROUPS = [
      { name: "Region A", items: [
        { id: "DA", label: "Demand today", min: 50, max: 1500, step: 50, def: 500, fmt: kU },
        { id: "sigA", label: "Volatility", min: 5, max: 60, step: 1, def: 20, scale: 0.01, fmt: pct },
        { id: "gA", label: "Expected growth", min: -10, max: 12, step: 0.5, def: 2, scale: 0.01, fmt: pctS } ] },
      { name: "Region B", items: [
        { id: "DB", label: "Demand today", min: 50, max: 1500, step: 50, def: 250, fmt: kU },
        { id: "sigB", label: "Volatility", min: 5, max: 60, step: 1, def: 40, scale: 0.01, fmt: pct },
        { id: "gB", label: "Expected growth", min: -10, max: 12, step: 0.5, def: 8, scale: 0.01, fmt: pctS } ] },
      { name: "Between the regions", items: [
        { id: "rho", label: "Correlation of demand", min: -0.9, max: 0.9, step: 0.1, def: 0.2, fmt: function (v) { return v.toFixed(1); }, hint: "Low or negative: one region is busy when the other is quiet, so a shared hub pools them." },
        { id: "xcost", label: "Cross-region service cost", min: 0, max: 20, step: 1, def: 6, scale: 0.001, fmt: perUnit, hint: "Extra transport per unit served from the other region's hub." },
        { id: "learn", label: "Second-hub saving", min: 0, max: 80, step: 5, def: 40, scale: 0.01, fmt: function (v) { return v + "% of fixed cost"; }, hint: "How much cheaper the second hub's fixed cost is once the first exists." } ] },
      { name: "Planned hubs", items: [
        { id: "sizeA", label: "Hub A", min: 50, max: 250, step: 10, def: 120, scale: 0.01, fmt: function (v) { return v + "% of A today"; } },
        { id: "sizeB", label: "Hub B", min: 50, max: 250, step: 10, def: 140, scale: 0.01, fmt: function (v) { return v + "% of B today"; } } ] },
      { name: "Time", items: [
        { id: "life", label: "Asset life", min: 10, max: 30, step: 1, def: 20, fmt: yrs },
        { id: "window", label: "Decision window", min: 1, max: 15, step: 1, def: 8, fmt: yrs },
        { id: "buildLead", label: "Build lead time", min: 0, max: 3, step: 0.25, def: 1.5, fmt: yrs } ] },
      { name: "Economics", items: [
        { id: "margin", label: "Margin, own network", min: 5, max: 40, step: 1, def: 20, scale: 0.001, fmt: perUnit },
        { id: "opcost", label: "Holding cost of capacity", min: 1, max: 15, step: 0.5, def: 6, scale: 0.001, fmt: function (v) { return "$" + v + "/unit·yr"; } },
        { id: "outMargin", label: "Margin, outsourced (3PL)", min: 0, max: 20, step: 0.5, def: 6, scale: 0.001, fmt: perUnit },
        { id: "outCap", label: "Outsourcing limit", min: 0, max: 200, step: 10, def: 100, scale: 0.01, fmt: function (v) { return v + "% of today, each"; } },
        { id: "penalty", label: "Penalty, lost sale", min: 0, max: 40, step: 1, def: 10, scale: 0.001, fmt: perUnit },
        { id: "ceiling", label: "Market ceiling", min: 1.5, max: 6, step: 0.5, def: 3, fmt: function (v) { return v + "× today, each"; } } ] },
      { name: "Costs", items: [
        { id: "fFix", label: "Fixed cost of a hub", min: 0, max: 30, step: 1, def: 8, fmt: function (v) { return "$" + v + "M"; } },
        { id: "fVar", label: "Capex per unit of capacity", min: 10, max: 60, step: 1, def: 30, scale: 0.001, fmt: perUnit },
        { id: "escal", label: "Cost escalation if delayed", min: 0, max: 15, step: 1, def: 6, scale: 0.01, fmt: function (v) { return v + "%/yr"; } } ] },
      { name: "Valuation", basis: true, items: [
        { id: "wacc", label: "WACC", min: 4, max: 16, step: 0.5, def: 10, scale: 0.01, fmt: pct, only: "wacc" },
        { id: "rf", label: "Risk-free rate", min: 0, max: 8, step: 0.25, def: 3, scale: 0.01, fmt: pct, only: "rn" },
        { id: "lambda", label: "Market price of demand risk λ", min: 0, max: 1, step: 0.05, def: 0.3, fmt: function (v) { return v.toFixed(2); }, only: "rn" } ] }
    ];
    var SPECS = index(GROUPS);
    var PRESETS = {
      "Core + growth market": {},
      "Twin markets": { DB: 500, sigA: 25, sigB: 25, gA: 3, gB: 3, rho: 0.6 },
      "Pooling pays": { rho: -0.5, xcost: 2 },
      "Distant regions": { xcost: 14 },
      "Uncertain new region": { DB: 150, sigB: 55, gB: 6, learn: 60 },
      "Both markets uncertain": { sigA: 40, gA: 0, sigB: 50, gB: 0 }
    };
    return { GROUPS: GROUPS, SPECS: SPECS, PRESETS: PRESETS };
  })();

  return { single: single, network: network, toModel: toModel, fmt: { pct: pct, pctS: pctS, yrs: yrs, perUnit: perUnit, ofToday: ofToday, kU: kU } };
});
