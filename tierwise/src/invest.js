// Tierwise — the capacity investment optimiser (window.TWInvest / module.exports): which candidate expansions are
// worth building, and roughly when. A separate, year-resolution model from the month-by-month "within capacity"
// plan: capacity investment is reviewed yearly anyway (the same cadence `requiredCapacity` already uses), and the
// monthly model's ~20,000-row LP is too large for a mixed-integer search to converge interactively — confirmed by
// hand: even a handful of binary build decisions ran for minutes without finding a better answer than "build
// nothing," because every branch needs to re-solve that whole relaxation. At year resolution the model is two
// orders of magnitude smaller and solves in a few seconds, with a genuine joint search across candidates.
//
// Each year is represented by its average monthly rate, for both demand and capacity. An earlier version used each
// site's own toughest month (peak demand, leanest capacity) independently, but a network's peaks do not line up —
// raw-milk troughs, dosing peaks and market peaks fall in different months at different sites by design (that is
// the whole point of spreading sites across latitudes). Taking each site's own worst month independently and then
// solving a joint flow network over them overlays every site's bad month onto the same simulated instant, which
// is not a real situation and made the whole network look saturated everywhere at once. The month-by-month "within
// capacity" plan and `requiredCapacity` already analyse seasonal peaks precisely at the site level; this model's
// job is coarser — which candidates are worth building, and about when — so it trades that seasonal detail for a
// temporally consistent annual view. Within a year, lead, release and transit times are not modelled (days to a
// few weeks against a one-year resolution); what a site ships in year y is matched by what it receives in year y,
// converted by yield exactly as the monthly model does. Cross-check a chosen investment's seasonal adequacy with
// the month-by-month plan before committing — this model answers "is it worth building," not "what ships in March."
//
// A binary per candidate per review year (0..12) decides whether and when to start it; its capacity becomes
// available ceil((build+qualify)/12) years later — no big-M needed, the addition is a bound increase, not a toggle.
// The objective is capex (discounted to its review year by net.config.discountRate) plus the lost margin on unmet
// demand (net.config.packValue per pack, so capex and lost margin are commensurable); opts.budget caps total
// nominal capex if set.
//   build(net, opts)        → { lp: CPLEX LP text, meta }
//   read(net, meta, cols)   → investments chosen, their capex, and an estimated post-investment annual fill rate
//   solve(highs, net, opts) → build + solve + read
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./plan.js"), require("./constrained.js"));
  else root.TWInvest = factory(root.TWPlan, root.TWConstrained);
})(typeof self !== "undefined" ? self : this, function (P, K) {
  "use strict";
  var YEARS = 13; // the plan's 13-year horizon (3 monthly years + 10 yearly periods), one decision point per year
  var COST = { reroute: 0.5, make: 0.001, transport: 0.0005 };

  // annual totals (not monthly rates): both demand and capacity are summed the same way, so every site's year-y
  // figure is the same kind of quantity (using each site's own worst month independently would overlay unrelated
  // peaks onto one impossible instant), and a pack of unmet demand costs packValue once, not once per year-slot
  function sumByYear(arr) { var out = []; for (var y = 0; y < YEARS; y++) { var s = 0; for (var m = y * 12; m < y * 12 + 12 && m < arr.length; m++) s += arr[m]; out.push(s); } return out; }
  function mergeTerms(list) { var m = {}; list.forEach(function (x) { m[x[0]] = (m[x[0]] || 0) + x[1]; }); return Object.keys(m).filter(function (k) { return Math.abs(m[k]) > 1e-12; }).map(function (k) { return [k, m[k]]; }); }

  function build(net, opts) {
    opts = opts || {};
    var mode = K.MODES.indexOf(opts.mode) >= 0 ? opts.mode : "qualified";
    var base = P.plan(net); if (!base.ok) return { ok: false, errors: base.errors };
    var cfg = net.config;
    if (!(cfg.packValue > 0)) return { ok: false, errors: ["The investment optimiser needs a pack value (currency per pack) greater than zero."] };
    var pe = K.packEq(net), lanes = K.lanesOf(net, mode);
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
    var unmetCoeff = cfg.packValue * SC, discR = cfg.discountRate != null ? cfg.discountRate : 0;
    var Yv = function (s, c, y) { return "y" + s + "_" + c + "_" + y; };
    var binaries = [], candBySite = {}, candTotal = {}, candList = [];
    net.sites.forEach(function (s) {
      if (!s.candidates || !s.candidates.length) return;
      // candidates add capacity "a month" (the same convention as site.capacity everywhere else); cap0/dem are now
      // annual totals, so a candidate's monthly addition is annualised (×12) to the same units before it is added
      var i = sIdx[s.id], scaleC = pe[s.tier] / SC * 12, list = [], tot = 0;
      s.candidates.forEach(function (c, ci) {
        var leadY = Math.ceil(((c.build || 0) + (c.qualify || 0)) / 12), ones = [];
        for (var y = 0; y < YEARS; y++) {
          var availY = y + leadY; if (availY >= YEARS) continue;
          var name = Yv(i, ci, y);
          ones.push(name); binaries.push(name);
          obj.push(term(c.capex / Math.pow(1 + discR / 100, y), name));
          list.push({ y: availY, name: name, add: c.add * scaleC });
          candList.push({ site: s.id, label: c.label, id: c.id, year: y, availYear: availY, add: c.add, capex: c.capex, capexPV: c.capex / Math.pow(1 + discR / 100, y), name: name });
        }
        if (ones.length) row(ones.map(function (n) { return term(1, n); }), "<=", 1);
        tot += c.add;
      });
      candBySite[s.id] = list; candTotal[s.id] = tot * scaleC;
    });
    if (opts.budget > 0 && candList.length) row(candList.map(function (c) { return term(c.capex, c.name); }), "<=", opts.budget);

    // ---- sites and lanes, year by year (no time-shift within a year)
    var inL = {}, outL = {}; lanes.forEach(function (l, i) { l.i = i; (inL[l.to] = inL[l.to] || []).push(l); (outL[l.from] = outL[l.from] || []).push(l); });
    var Xv = function (l, y) { return "x" + l + "_" + y; }, Uv = function (k, y) { return "u" + k + "_" + y; }, Ev = function (l, y) { return "g" + l + "_" + y; }, Dv = function (l, y) { return "d" + l + "_" + y; };
    net.sites.forEach(function (s) {
      var i = sIdx[s.id], y;
      if (s.tier === "market") {
        for (y = 0; y < YEARS; y++) {
          var tm = [[Uv(i, y), 1]]; (inL[s.id] || []).forEach(function (l) { tm.push([Xv(l.i, y), 1]); });
          row(mergeTerms(tm).map(function (a) { return term(a[1], a[0]); }), "=", dem[s.id][y]);
          obj.push(term(unmetCoeff * (s.priority > 0 ? s.priority : 1), Uv(i, y)));
        }
        return;
      }
      var cx = candBySite[s.id], yld = (s.yield != null ? s.yield : 100) / 100;
      for (y = 0; y < YEARS; y++) {
        var out = (outL[s.id] || []).map(function (l) { return [Xv(l.i, y), 1]; });
        var capTerms = out.slice(); if (cx) cx.forEach(function (c) { if (c.y <= y) capTerms.push([c.name, -c.add]); });
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
    return { ok: true, lp: lp, meta: { mode: mode, scale: SC, pe: pe, sIdx: sIdx, lanes: lanes, dem: dem, cap0: cap0, candList: candList, rows: nRows } };
  }

  function read(net, meta, cols) {
    var SC = meta.scale, pe = meta.pe, sIdx = meta.sIdx;
    var v = function (name) { var c = cols[name]; return c ? Math.max(0, c.Primal != null ? c.Primal : c) * SC : 0; };
    var raw = function (name) { var c = cols[name]; return c ? (c.Primal != null ? c.Primal : c) : 0; };
    var sites = {}, totD = 0, totU = 0;
    net.sites.forEach(function (s) {
      var i = sIdx[s.id], years = [];
      if (s.tier === "market") {
        for (var y = 0; y < YEARS; y++) {
          var d = meta.dem[s.id][y] * SC, u = Math.min(d, v("u" + i + "_" + y)), del = d - u;
          years.push({ demand: d, delivered: del, unmet: u, fill: d > 0 ? del / d : 1 });
          totD += d; totU += u;
        }
      } else {
        for (var y2 = 0; y2 < YEARS; y2++) {
          var made = 0; meta.lanes.forEach(function (l) { if (l.from === s.id) made += v("x" + l.i + "_" + y2); });
          var cap = meta.cap0[s.id][y2] * SC; meta.candList.forEach(function (c) { if (c.site === s.id && c.availYear <= y2 && raw(c.name) > 0.5) cap += c.add * 12; });
          years.push({ load: made / pe[s.tier], capacity: cap / pe[s.tier], util: cap > 0 ? made / cap : 0 });
        }
      }
      sites[s.id] = { site: s, years: years };
    });
    var investments = [], capexTotal = 0, capexPV = 0;
    meta.candList.forEach(function (c) {
      if (raw(c.name) > 0.5) { investments.push({ site: c.site, label: c.label, id: c.id, reviewYear: c.year, availYear: c.availYear, add: c.add, capex: c.capex, capexPV: c.capexPV }); capexTotal += c.capex; capexPV += c.capexPV; }
    });
    investments.sort(function (a, b) { return a.reviewYear - b.reviewYear; });
    return { ok: true, invest: true, years: YEARS, sites: sites, investments: investments, capexTotal: capexTotal, capexPV: capexPV, fill: totD > 0 ? 1 - totU / totD : 1, unmet: totU, demand: totD };
  }

  function solve(highs, net, opts) {
    var b = build(net, opts); if (!b.ok) return b;
    var t0 = Date.now();
    var o = Object.assign({ output_flag: false, solver: "simplex", time_limit: 30, mip_rel_gap: 0.002 }, (opts && opts.highs) || {});
    var r, why = "", timedOut = false;
    try {
      var x = highs.solve(b.lp, o);
      if (x.Status === "Optimal") r = x;
      else if (x.Status === "Time limit reached" && isFinite(x.ObjectiveValue)) { r = x; timedOut = true; }
      else why = x.Status;
    } catch (e) { why = String(e && e.message || e); }
    if (!r) return { ok: false, errors: ["The investment optimiser could not be solved (" + why + ")."] };
    var out = read(net, b.meta, r.Columns); out.seconds = (Date.now() - t0) / 1000; out.size = { rows: b.meta.rows, cols: Object.keys(r.Columns).length }; out.timedOut = timedOut;
    return out;
  }

  return { YEARS: YEARS, build: build, read: read, solve: solve };
});
