// Real Options for Network Design — the controls of both pages: labels, ranges, defaults (in the units shown) and the
// scale to model units (model value = shown value × scale), and the presets. Shared by the pages, the decision report,
// the tutorial and the tests. Labels and units go through T() (i18n.js); preset keys stay in English (they appear in
// links and in the tutorial) and are translated only for display, with T(name).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ROSpecs = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function T(s, v) { var g = typeof self !== "undefined" ? self : globalThis, I = g.ROi18n; return I ? I.T(s, v) : String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? v[k] : m; }); }
  function pct(v) { return v + "%"; }
  function pctS(v) { return T("{v}%/yr", { v: (v > 0 ? "+" : "") + v }); }
  function yrs(v) { return v === 1 ? T("1 year") : T("{v} years", { v: v }); }
  function perUnit(v) { return T("${v}/unit", { v: v }); }
  function perUnitYr(v) { return T("${v}/unit·yr", { v: v }); }
  function ofToday(v) { return T("{v}% of today", { v: v }); }
  function kU(v) { return T("{v}k units/yr", { v: v }); }
  function musd(v) { return T("${v}M", { v: v }); }
  function index(groups) { var s = {}; groups.forEach(function (g) { g.items.forEach(function (it) { s[it.id] = it; }); }); return s; }
  // model parameters from values in the units shown (defaults for anything not given)
  function toModel(specs, shown, basis) {
    var p = { basis: basis || "wacc" };
    Object.keys(specs).forEach(function (k) { var v = shown && shown[k] != null ? shown[k] : specs[k].def; p[k] = v * (specs[k].scale || 1); });
    return p;
  }

  var single = (function () {
    var GROUPS = [
      { name: T("Demand"), items: [
        { id: "D0", label: T("Demand today"), min: 100, max: 2000, step: 50, def: 500, fmt: kU },
        { id: "sigma", label: T("Volatility"), min: 5, max: 60, step: 1, def: 25, scale: 0.01, fmt: pct, hint: T("Yearly standard deviation of demand growth.") },
        { id: "g", label: T("Expected growth"), min: -10, max: 12, step: 0.5, def: 4, scale: 0.01, fmt: pctS },
        { id: "ceiling", label: T("Market ceiling"), min: 1.5, max: 6, step: 0.5, def: 3, fmt: function (v) { return T("{v}× today", { v: v }); }, hint: T("Demand saturates here.") } ] },
      { name: T("Time"), items: [
        { id: "life", label: T("Asset life"), min: 10, max: 30, step: 1, def: 20, fmt: yrs },
        { id: "window", label: T("Decision window"), min: 1, max: 15, step: 1, def: 8, fmt: yrs, hint: T("How long you can still build or expand. After it the network stays as it is.") },
        { id: "buildLead", label: T("Build lead time"), min: 0, max: 3, step: 0.25, def: 1.5, fmt: yrs },
        { id: "expandLead", label: T("Expansion lead time"), min: 0, max: 2, step: 0.25, def: 1, fmt: yrs } ] },
      { name: T("Economics"), items: [
        { id: "margin", label: T("Margin, own network"), min: 5, max: 40, step: 1, def: 20, scale: 0.001, fmt: perUnit },
        { id: "opcost", label: T("Holding cost of capacity"), min: 1, max: 15, step: 0.5, def: 6, scale: 0.001, fmt: perUnitYr },
        { id: "outMargin", label: T("Margin, outsourced (3PL)"), min: 0, max: 20, step: 0.5, def: 6, scale: 0.001, fmt: perUnit },
        { id: "outCap", label: T("Outsourcing limit"), min: 0, max: 200, step: 10, def: 100, scale: 0.01, fmt: ofToday },
        { id: "penalty", label: T("Penalty, lost sale"), min: 0, max: 40, step: 1, def: 10, scale: 0.001, fmt: perUnit } ] },
      { name: T("Valuation"), basis: true, items: [
        { id: "wacc", label: T("WACC"), min: 4, max: 16, step: 0.5, def: 10, scale: 0.01, fmt: pct, only: "wacc" },
        { id: "rf", label: T("Risk-free rate"), min: 0, max: 8, step: 0.25, def: 3, scale: 0.01, fmt: pct, only: "rn" },
        { id: "lambda", label: T("Market price of demand risk λ"), min: 0, max: 1, step: 0.05, def: 0.3, fmt: function (v) { return v.toFixed(2); }, only: "rn", hint: T("Risk-neutral drift = growth − λ·volatility.") } ] },
      { name: T("Design & costs"), items: [
        { id: "bigF", label: T("Full footprint"), min: 60, max: 300, step: 5, def: 140, scale: 0.01, fmt: ofToday },
        { id: "smallF", label: T("Initial stage"), min: 30, max: 150, step: 5, def: 80, scale: 0.01, fmt: ofToday },
        { id: "stepF", label: T("Expansion step"), min: 5, max: 60, step: 5, def: 15, scale: 0.01, fmt: ofToday },
        { id: "premium", label: T("Staging premium"), min: 0, max: 60, step: 5, def: 25, scale: 0.01, fmt: pct, hint: T("Extra cost per unit added in a later step.") },
        { id: "fFix", label: T("Fixed cost of a site"), min: 0, max: 30, step: 1, def: 8, fmt: musd },
        { id: "fVar", label: T("Capex per unit of capacity"), min: 10, max: 60, step: 1, def: 30, scale: 0.001, fmt: perUnit },
        { id: "escal", label: T("Cost escalation if delayed"), min: 0, max: 15, step: 1, def: 6, scale: 0.01, fmt: function (v) { return T("{v}%/yr", { v: v }); } } ] },
      { name: T("Exit & leasing"), items: [
        { id: "salvF", label: T("Resale value of a site"), min: 0, max: 80, step: 5, def: 30, scale: 0.01, fmt: function (v) { return T("{v}% of cost", { v: v }); }, hint: T("What an owned site sells for when new; it declines to zero over the asset life. Generic buildings resell well, specialised ones do not.") },
        { id: "rent", label: T("Lease rent"), min: 2, max: 12, step: 0.25, def: 6.5, scale: 0.001, fmt: perUnitYr },
        { id: "leaseFit", label: T("Fit-out cost of a lease"), min: 0, max: 100, step: 5, def: 25, scale: 0.01, fmt: function (v) { return T("{v}% of site fixed cost", { v: v }); } },
        { id: "leaseLead", label: T("Fit-out time"), min: 0, max: 2, step: 0.25, def: 0.5, fmt: yrs },
        { id: "minTerm", label: T("First break date"), min: 1, max: 15, step: 1, def: 5, fmt: function (v) { return T("year {v} of the lease", { v: v }); } },
        { id: "breakEvery", label: T("Then a break every"), min: 0, max: 10, step: 1, def: 5, fmt: function (v) { return v === 0 ? T("no further breaks") : yrs(v); } },
        { id: "breakFee", label: T("Break fee"), min: 0, max: 3, step: 0.25, def: 1, fmt: function (v) { return v === 1 ? T("1 year of rent") : T("{v} years of rent", { v: v }); } } ] },
      { name: T("Switching"), items: [
        { id: "moth", label: T("Owned sites can be mothballed"), check: true, def: 1, hint: T("Idle the site and send demand to the 3PL, then restart it if demand returns.") },
        { id: "mothF", needs: "moth", label: T("Holding cost while idle"), min: 0, max: 80, step: 5, def: 20, scale: 0.01, fmt: function (v) { return T("{v}% of active", { v: v }); } },
        { id: "mothFix", needs: "moth", label: T("Cost to mothball"), min: 0, max: 5, step: 0.25, def: 0.5, fmt: musd },
        { id: "reactFix", needs: "moth", label: T("Cost to restart"), min: 0, max: 5, step: 0.25, def: 1, fmt: musd },
        { id: "contract", label: T("Staged site can sell capacity back in steps"), check: true, def: 1, hint: T("Proceeds: the resale value of the capacity sold, without the site's fixed share.") } ] }
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
      { name: T("Region A"), items: [
        { id: "DA", label: T("Demand today"), min: 50, max: 1500, step: 50, def: 500, fmt: kU },
        { id: "sigA", label: T("Volatility"), min: 5, max: 60, step: 1, def: 20, scale: 0.01, fmt: pct },
        { id: "gA", label: T("Expected growth"), min: -10, max: 12, step: 0.5, def: 2, scale: 0.01, fmt: pctS } ] },
      { name: T("Region B"), items: [
        { id: "DB", label: T("Demand today"), min: 50, max: 1500, step: 50, def: 250, fmt: kU },
        { id: "sigB", label: T("Volatility"), min: 5, max: 60, step: 1, def: 40, scale: 0.01, fmt: pct },
        { id: "gB", label: T("Expected growth"), min: -10, max: 12, step: 0.5, def: 8, scale: 0.01, fmt: pctS } ] },
      { name: T("Between the regions"), items: [
        { id: "rho", label: T("Correlation of demand"), min: -0.9, max: 0.9, step: 0.1, def: 0.2, fmt: function (v) { return v.toFixed(1); }, hint: T("Low or negative: one region is busy when the other is quiet, so a shared hub pools them.") },
        { id: "xcost", label: T("Cross-region service cost"), min: 0, max: 20, step: 1, def: 6, scale: 0.001, fmt: perUnit, hint: T("Extra transport per unit served from the other region's hub.") },
        { id: "learn", label: T("Second-hub saving"), min: 0, max: 80, step: 5, def: 40, scale: 0.01, fmt: function (v) { return T("{v}% of fixed cost", { v: v }); }, hint: T("How much cheaper the second hub's fixed cost is once the first exists.") } ] },
      { name: T("Planned hubs"), items: [
        { id: "sizeA", label: T("Hub A"), min: 50, max: 250, step: 10, def: 120, scale: 0.01, fmt: function (v) { return T("{v}% of A today", { v: v }); } },
        { id: "sizeB", label: T("Hub B"), min: 50, max: 250, step: 10, def: 140, scale: 0.01, fmt: function (v) { return T("{v}% of B today", { v: v }); } } ] },
      { name: T("Time"), items: [
        { id: "life", label: T("Asset life"), min: 10, max: 30, step: 1, def: 20, fmt: yrs },
        { id: "window", label: T("Decision window"), min: 1, max: 15, step: 1, def: 8, fmt: yrs },
        { id: "buildLead", label: T("Build lead time"), min: 0, max: 3, step: 0.25, def: 1.5, fmt: yrs } ] },
      { name: T("Economics"), items: [
        { id: "margin", label: T("Margin, own network"), min: 5, max: 40, step: 1, def: 20, scale: 0.001, fmt: perUnit },
        { id: "opcost", label: T("Holding cost of capacity"), min: 1, max: 15, step: 0.5, def: 6, scale: 0.001, fmt: perUnitYr },
        { id: "outMargin", label: T("Margin, outsourced (3PL)"), min: 0, max: 20, step: 0.5, def: 6, scale: 0.001, fmt: perUnit },
        { id: "outCap", label: T("Outsourcing limit"), min: 0, max: 200, step: 10, def: 100, scale: 0.01, fmt: function (v) { return T("{v}% of today, each", { v: v }); } },
        { id: "penalty", label: T("Penalty, lost sale"), min: 0, max: 40, step: 1, def: 10, scale: 0.001, fmt: perUnit },
        { id: "ceiling", label: T("Market ceiling"), min: 1.5, max: 6, step: 0.5, def: 3, fmt: function (v) { return T("{v}× today, each", { v: v }); } } ] },
      { name: T("Costs"), items: [
        { id: "fFix", label: T("Fixed cost of a hub"), min: 0, max: 30, step: 1, def: 8, fmt: musd },
        { id: "fVar", label: T("Capex per unit of capacity"), min: 10, max: 60, step: 1, def: 30, scale: 0.001, fmt: perUnit },
        { id: "escal", label: T("Cost escalation if delayed"), min: 0, max: 15, step: 1, def: 6, scale: 0.01, fmt: function (v) { return T("{v}%/yr", { v: v }); } } ] },
      { name: T("Valuation"), basis: true, items: [
        { id: "wacc", label: T("WACC"), min: 4, max: 16, step: 0.5, def: 10, scale: 0.01, fmt: pct, only: "wacc" },
        { id: "rf", label: T("Risk-free rate"), min: 0, max: 8, step: 0.25, def: 3, scale: 0.01, fmt: pct, only: "rn" },
        { id: "lambda", label: T("Market price of demand risk λ"), min: 0, max: 1, step: 0.05, def: 0.3, fmt: function (v) { return v.toFixed(2); }, only: "rn" } ] }
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

  return { single: single, network: network, toModel: toModel, T: T, fmt: { pct: pct, pctS: pctS, yrs: yrs, perUnit: perUnit, ofToday: ofToday, kU: kU } };
});
