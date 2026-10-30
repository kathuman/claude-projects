// Tierwise — the capacity investment optimiser (window.TWInvest / module.exports): which candidate expansions are
// worth building, and roughly when. A separate, year-resolution model from the month-by-month "within capacity"
// plan: capacity investment is reviewed yearly anyway (the same cadence `requiredCapacity` already uses), and the
// monthly model's ~20,000-row LP is too large for a mixed-integer search to converge interactively — confirmed by
// hand: even a handful of binary build decisions ran for minutes without finding a better answer than "build
// nothing," because every branch needs to re-solve that whole relaxation. At year resolution the model is two
// orders of magnitude smaller and solves in a few seconds, with a genuine joint search across candidates.
//
// Each year is represented by its annual totals (the sum of its 12 months), for both demand and capacity. An earlier
// version used each site's own toughest month (peak demand, leanest capacity) independently, but a network's peaks do
// not line up — raw-milk troughs, dosing peaks and market peaks fall in different months at different sites by design
// (that is the whole point of spreading sites across latitudes). Taking each site's own worst month independently and
// then solving a joint flow network over them overlays every site's bad month onto the same simulated instant, which
// is not a real situation and made the whole network look saturated everywhere at once. Within a year, lead, release
// and transit times are not modelled (days to a few weeks against a one-year resolution); what a site ships in year y
// is matched by what it receives in year y, converted by yield exactly as the monthly model does. There is no stock
// carried between years and no within-year peak, so this is a screening model: it misses shortfalls that are real
// within a year but average out over it, and its fill rate reads a few points lower than the monthly plan's.
//
// The decision. A binary per candidate per review year (0..12) decides whether and when to start it, at most one
// review year per candidate. A candidate started at the beginning of year y is ready in month 12·y + ceil(build +
// qualify): from then on it adds its monthly capacity to every month, so the year it becomes ready gets the months
// that are left of it (prorated), not nothing, and the years after get all twelve. That addition is a bound
// increase, not a toggle — no big-M needed. A candidate that would only be ready after the horizon cannot be chosen.
//
// The objective, all in currency and all discounted the same way — year y weighs 1/(1 + r)^y, r = discountRate:
//   capex           paid at the start of the review year;
//   opex            a fixed cost a year (candidate.opex, default 0), from the month the capacity is ready, prorated;
//   lost margin     packValue per pack of unmet demand. (Before 2.3.1 only capex was discounted, so a pack lost in
//                   year 12 cost as much as one lost today, which made late capacity look better than it is.)
//   terminal value  capacity keeps paying after the horizon: the last year's lost margin and opex weigh as if that year
//                   repeated for `terminalYears` more years (net.config.terminalYears, default 5; 0 turns it off),
//                   each discounted further. Five years is a deliberately cautious tail for equipment that lives 15–20
//                   years: it credits late builds for some of their life without assuming demand stays at year 13's
//                   level for ever.
// Market priority is not a currency, so it does not multiply the margin: it is a tie-breaker only (0.1% more per level
// above 1), which decides which market goes short when the same capacity could serve either, and the objective the
// result reports is recomputed in plain currency. Re-sourcing, making and transport carry small regularising costs
// (COST below, per thousand pack-equivalents) that keep the flows tidy; they are left out of the reported objective.
// opts.budget caps total nominal capex if set.
//   build(net, opts)        → { lp: CPLEX LP text, meta }   (opts.noCandidates: the same model with nothing to build)
//   read(net, meta, cols)   → investments chosen, their capex and opex, the lost margin, and an estimated fill rate
//   solve(highs, net, opts) → build + solve + read, plus a no-investment baseline solve, so the result can state the
//                             margin recovered and the net present value of the package
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./plan.js"), require("./constrained.js"));
  else root.TWInvest = factory(root.TWPlan, root.TWConstrained);
})(typeof self !== "undefined" ? self : this, function (P, K) {
  "use strict";
  var YEARS = 13; // the plan's 13-year horizon (3 monthly years + 10 yearly periods), one decision point per year
  var MONTHS = YEARS * 12;
  var COST = { reroute: 0.5, make: 0.001, transport: 0.0005 };
  // the tie-breaker weight of a market's priority on its lost margin, per level above 1
  var PRIORITY_TIE = 1e-3;
  var TERMINAL_YEARS = 5;
  // the solver's time budget in seconds: generous because this is a considered, infrequent decision, not a plan
  // re-solved on every slider change; the example proves optimal in a few seconds
  var TIME_LIMIT = 60;

  function sumByYear(arr) { var out = []; for (var y = 0; y < YEARS; y++) { var s = 0; for (var m = y * 12; m < y * 12 + 12 && m < arr.length; m++) s += arr[m]; out.push(s); } return out; }
  function mergeTerms(list) { var m = {}; list.forEach(function (x) { m[x[0]] = (m[x[0]] || 0) + x[1]; }); return Object.keys(m).filter(function (k) { return Math.abs(m[k]) > 1e-12; }).map(function (k) { return [k, m[k]]; }); }
  // the discount weights: year y weighs 1/(1+r)^y, and the last year also stands for the `terminalYears` after it
  function weights(cfg) {
    var r = (cfg.discountRate != null ? cfg.discountRate : 0) / 100, n = cfg.terminalYears != null ? Math.max(0, Math.round(cfg.terminalYears)) : TERMINAL_YEARS;
    var disc = [], tail = 0;
    for (var y = 0; y < YEARS; y++) disc.push(1 / Math.pow(1 + r, y));
    for (var k = 1; k <= n; k++) tail += 1 / Math.pow(1 + r, k);
    var w = disc.slice(); w[YEARS - 1] *= 1 + tail;
    return { disc: disc, w: w, tail: tail, terminalYears: n, rate: r * 100 };
  }
  // the months of year a in which a candidate ready in month `ready` is available (0–12)
  function monthsIn(a, ready) { return Math.max(0, Math.min(12, 12 * (a + 1) - ready)); }

  function build(net, opts) {
    opts = opts || {};
    var mode = K.MODES.indexOf(opts.mode) >= 0 ? opts.mode : "qualified";
    var base = P.plan(net); if (!base.ok) return { ok: false, errors: base.errors };
    var cfg = net.config;
    if (!(cfg.packValue > 0)) return { ok: false, errors: ["The investment optimiser needs a pack value (currency per pack) greater than zero."] };
    var pe = K.packEq(net), lanes = K.lanesOf(net, mode), wt = weights(cfg);
    var SC = opts.scale > 0 ? opts.scale : 1e3;
    var sIdx = {}; net.sites.forEach(function (s, i) { sIdx[s.id] = i; });
    var dem = {}, cap0 = {};
    net.sites.forEach(function (s) {
      var r = base.sites[s.id];
      if (s.tier === "market") dem[s.id] = sumByYear(r.demand).map(function (v) { return v * pe.market / SC; });
      else cap0[s.id] = sumByYear(r.capacity).map(function (v) { return v * pe[s.tier] / SC; });
    });

    var obj = [], rows = [], bounds = [], nRows = 0;
    function term(c, v) { return (c >= 0 ? " + " : " - ") + fmt(Math.abs(c)) + " " + v; }
    function fmt(c) { return c === 1 ? "1" : +c.toPrecision(12) + ""; }
    function row(terms, op, rhs) { if (!terms.length) return; var parts = []; for (var q = 0; q < terms.length; q += 8) parts.push(terms.slice(q, q + 8).join("")); rows.push(" r" + (nRows++) + ":" + parts.join("\n  ") + " " + op + " " + fmt(rhs)); }

    // ---- candidate expansions: one binary per candidate per review year, at most one
    var unmetCoeff = cfg.packValue * SC;
    var Yv = function (s, c, y) { return "y" + s + "_" + c + "_" + y; };
    var binaries = [], candBySite = {}, candList = [];
    if (!opts.noCandidates) net.sites.forEach(function (s) {
      if (!s.candidates || !s.candidates.length) return;
      // candidates add capacity "a month" (the same convention as site.capacity everywhere else); cap0 holds annual
      // totals, so a candidate adds its monthly capacity once for every month of the year it is available
      var i = sIdx[s.id], perMonth = pe[s.tier] / SC, list = [];
      s.candidates.forEach(function (c, ci) {
        var lead = Math.ceil((c.build || 0) + (c.qualify || 0) - 1e-9), opex = c.opex > 0 ? c.opex : 0, ones = [];
        for (var y = 0; y < YEARS; y++) {
          var ready = 12 * y + lead; if (ready >= MONTHS) continue;
          var name = Yv(i, ci, y), adds = [], opexPV = 0;
          for (var a = Math.floor(ready / 12); a < YEARS; a++) { var mo = monthsIn(a, ready); if (mo > 0) { adds.push([a, c.add * perMonth * mo]); opexPV += opex * mo / 12 * wt.w[a]; } }
          ones.push(name); binaries.push(name);
          var capexPV = c.capex * wt.disc[y];
          obj.push(term(capexPV + opexPV, name));
          list.push({ name: name, adds: adds });
          candList.push({ site: s.id, label: c.label, id: c.id, year: y, readyMonth: ready, availYear: Math.floor(ready / 12), add: c.add, capex: c.capex, opex: opex, capexPV: capexPV, opexPV: opexPV, name: name });
        }
        if (ones.length) row(ones.map(function (n) { return term(1, n); }), "<=", 1);
      });
      candBySite[s.id] = list;
    });
    if (opts.budget > 0 && candList.length) row(candList.map(function (c) { return term(c.capex, c.name); }), "<=", opts.budget);

    // ---- sites and lanes, year by year (no time-shift within a year)
    var inL = {}, outL = {}; lanes.forEach(function (l, i) { l.i = i; (inL[l.to] = inL[l.to] || []).push(l); (outL[l.from] = outL[l.from] || []).push(l); });
    var Xv = function (l, y) { return "x" + l + "_" + y; }, Uv = function (k, y) { return "u" + k + "_" + y; }, Ev = function (l, y) { return "g" + l + "_" + y; }, Dv = function (l, y) { return "d" + l + "_" + y; };
    net.sites.forEach(function (s) {
      var i = sIdx[s.id], y;
      if (s.tier === "market") {
        var tie = 1 + PRIORITY_TIE * Math.max(0, (s.priority > 0 ? s.priority : 1) - 1);
        for (y = 0; y < YEARS; y++) {
          var tm = [[Uv(i, y), 1]]; (inL[s.id] || []).forEach(function (l) { tm.push([Xv(l.i, y), 1]); });
          row(mergeTerms(tm).map(function (a) { return term(a[1], a[0]); }), "=", dem[s.id][y]);
          obj.push(term(unmetCoeff * wt.w[y] * tie, Uv(i, y)));
        }
        return;
      }
      var cx = candBySite[s.id], yld = (s.yield != null ? s.yield : 100) / 100;
      for (y = 0; y < YEARS; y++) {
        var out = (outL[s.id] || []).map(function (l) { return [Xv(l.i, y), 1]; });
        var capTerms = out.slice(); if (cx) cx.forEach(function (c) { c.adds.forEach(function (a) { if (a[0] === y) capTerms.push([c.name, -a[1]]); }); });
        row(mergeTerms(capTerms).map(function (a) { return term(a[1], a[0]); }), "<=", cap0[s.id][y]);
        (outL[s.id] || []).forEach(function (l) { obj.push(term(COST.make, Xv(l.i, y))); });
        if (s.tier !== "raw") {
          var inTm = (inL[s.id] || []).map(function (l) { return [Xv(l.i, y), yld]; });
          row(mergeTerms(out.map(function (t) { return [t[0], -1]; }).concat(inTm)).map(function (a) { return term(a[1], a[0]); }), "=", 0);
        }
      }
    });
    // lane shares: fixed sourcing keeps the planned share exactly; qualified/any may re-route at a cost
    lanes.forEach(function (l) {
      var sib = inL[l.to];
      for (var y = 0; y < YEARS; y++) {
        obj.push(term(COST.transport * Math.max(1, l.days), Xv(l.i, y)));
        if (sib.length < 2 && l.share >= 1) continue;
        var all = [[Xv(l.i, y), 1]]; sib.forEach(function (o) { all.push([Xv(o.i, y), -l.share]); });
        var tm = mergeTerms(all).map(function (a) { return term(a[1], a[0]); });
        if (mode !== "fixed") { tm.push(term(-1, Ev(l.i, y))); tm.push(term(1, Dv(l.i, y))); obj.push(term(COST.reroute, Ev(l.i, y))); }
        if (tm.length) row(tm, "=", 0);
      }
    });

    var objLines = []; for (var q = 0; q < obj.length; q += 8) objLines.push(obj.slice(q, q + 8).join(""));
    var lp = "Minimize\n obj:" + objLines.join("\n") + "\nSubject To\n" + rows.join("\n") +
      (bounds.length ? "\nBounds\n" + bounds.join("\n") : "") +
      (binaries.length ? "\nBinaries\n" + binaries.map(function (n) { return " " + n; }).join("\n") : "") + "\nEnd\n";
    return { ok: true, lp: lp, meta: { mode: mode, scale: SC, pe: pe, sIdx: sIdx, lanes: lanes, dem: dem, cap0: cap0, candList: candList, candBySite: candBySite, weights: wt, packValue: cfg.packValue, rows: nRows } };
  }

  function read(net, meta, cols) {
    var SC = meta.scale, pe = meta.pe, sIdx = meta.sIdx, wt = meta.weights;
    var v = function (name) { var c = cols[name]; return c ? Math.max(0, c.Primal != null ? c.Primal : c) * SC : 0; };
    var raw = function (name) { var c = cols[name]; return c ? (c.Primal != null ? c.Primal : c) : 0; };
    var chosen = {}; meta.candList.forEach(function (c) { if (raw(c.name) > 0.5) chosen[c.name] = 1; });
    var sites = {}, totD = 0, totU = 0, lostPV = 0, lostLast = 0;
    net.sites.forEach(function (s) {
      var i = sIdx[s.id], years = [];
      if (s.tier === "market") {
        for (var y = 0; y < YEARS; y++) {
          var d = meta.dem[s.id][y] * SC, u = Math.min(d, v("u" + i + "_" + y)), del = d - u;
          years.push({ demand: d, delivered: del, unmet: u, fill: d > 0 ? del / d : 1 });
          totD += d; totU += u; lostPV += u / pe.market * meta.packValue * wt.w[y];
          if (y === YEARS - 1) lostLast += u / pe.market * meta.packValue;
        }
      } else {
        for (var y2 = 0; y2 < YEARS; y2++) {
          var made = 0; meta.lanes.forEach(function (l) { if (l.from === s.id) made += v("x" + l.i + "_" + y2); });
          var cap = meta.cap0[s.id][y2] * SC; (meta.candBySite[s.id] || []).forEach(function (c) { if (chosen[c.name]) c.adds.forEach(function (a) { if (a[0] === y2) cap += a[1] * SC; }); });
          years.push({ load: made / pe[s.tier], capacity: cap / pe[s.tier], util: cap > 0 ? made / cap : 0 });
        }
      }
      sites[s.id] = { site: s, years: years };
    });
    var investments = [], capexTotal = 0, capexPV = 0, opexPV = 0;
    meta.candList.forEach(function (c) {
      if (!chosen[c.name]) return;
      investments.push({ site: c.site, label: c.label, id: c.id, reviewYear: c.year, readyMonth: c.readyMonth, availYear: c.availYear, add: c.add, capex: c.capex, opex: c.opex, capexPV: c.capexPV, opexPV: c.opexPV });
      capexTotal += c.capex; capexPV += c.capexPV; opexPV += c.opexPV;
    });
    investments.sort(function (a, b) { return a.reviewYear - b.reviewYear || a.readyMonth - b.readyMonth; });
    // totD and totU are in pack-equivalents of a market, which is a pack
    return { ok: true, invest: true, years: YEARS, sites: sites, investments: investments, capexTotal: capexTotal, capexPV: capexPV, opexPV: opexPV,
      lostPV: lostPV, lostLast: lostLast, objective: capexPV + opexPV + lostPV, terminalYears: wt.terminalYears, discountRate: wt.rate,
      fill: totD > 0 ? 1 - totU / totD : 1, unmet: totU, demand: totD };
  }

  function solveLP(highs, b, opts) {
    var o = Object.assign({ output_flag: false, solver: "simplex", time_limit: TIME_LIMIT, mip_rel_gap: 0.002 }, (opts && opts.highs) || {});
    var x, why = "";
    try { x = highs.solve(b.lp, o); } catch (e) { return { why: String(e && e.message || e) }; }
    if (x.Status === "Optimal") return { r: x, timedOut: false };
    if (x.Status === "Time limit reached" && isFinite(x.ObjectiveValue)) return { r: x, timedOut: true };
    why = x.Status; return { why: why };
  }
  function solve(highs, net, opts) {
    opts = opts || {};
    var b = build(net, opts); if (!b.ok) return b;
    var t0 = Date.now(), s = solveLP(highs, b, opts);
    if (!s.r) return { ok: false, errors: ["The investment optimiser could not be solved (" + s.why + ")."] };
    var out = read(net, b.meta, s.r.Columns); out.size = { rows: b.meta.rows, cols: Object.keys(s.r.Columns).length }; out.timedOut = s.timedOut;
    // the same model with nothing to build: the margin the chosen package recovers, and so its net present value
    var b0 = build(net, Object.assign({}, opts, { noCandidates: true, budget: 0 })), s0 = b0.ok ? solveLP(highs, b0, opts) : {};
    if (s0.r) {
      var base = read(net, b0.meta, s0.r.Columns);
      out.baseline = { fill: base.fill, unmet: base.unmet, lostPV: base.lostPV };
      out.recoveredPV = base.lostPV - out.lostPV;
      out.npv = out.recoveredPV - out.capexPV - out.opexPV;
    }
    out.seconds = (Date.now() - t0) / 1000;
    return out;
  }

  // every chosen package is priced again by the month-by-month plan, because the screening model above cannot see stock,
  // cover or peak months, and the two can disagree in sign. Both use the same discounting, so the verified NPV differs
  // from the screening NPV only in what the package really recovers.
  function verify(highs, net, r, opts) {
    opts = opts || {};
    if (!r.investments.length) return { ok: true, nothingToCheck: true };
    var t0 = Date.now(), o = { mode: opts.mode, hold: opts.hold }, cfg = net.config, wt = weights(cfg), n1 = JSON.parse(JSON.stringify(net));
    r.investments.forEach(function (x) { n1.sites.forEach(function (s) { if (s.id === x.site) s.expansions = (s.expansions || []).concat([{ from: x.readyMonth, add: x.add }]); }); });
    var m0 = K.solve(highs, net, o), m1 = K.solve(highs, n1, o);
    if (!m0.ok || !m1.ok) return { ok: false, errors: (m0.errors || []).concat(m1.errors || []) };
    var lost = function (res) { var pv = 0; Object.keys(res.sites).forEach(function (id) { var x = res.sites[id]; if (x.site.tier === "market") for (var m = 0; m < x.unmet.length; m++) pv += x.unmet[m] * cfg.packValue * wt.w[Math.floor(m / 12)]; }); return pv; };
    var recovered = lost(m0) - lost(m1), npv = recovered - r.capexPV - r.opexPV;
    return { ok: true, fillBefore: m0.fill, fillAfter: m1.fill, recoveredPV: recovered, npv: npv, screeningNpv: r.npv, pays: npv >= 0, agrees: (npv >= 0) === (r.npv >= 0), seconds: (Date.now() - t0) / 1000 };
  }

  return { YEARS: YEARS, TERMINAL_YEARS: TERMINAL_YEARS, TIME_LIMIT: TIME_LIMIT, PRIORITY_TIE: PRIORITY_TIE, weights: weights, build: build, read: read, solve: solve, verify: verify };
});
