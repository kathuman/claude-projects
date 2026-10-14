// Tierwise — the constrained plan (window.TWConstrained / module.exports): the same network, but no site may exceed its
// capacity. A linear program over the whole horizon decides, month by month, how much each site makes or ships, which
// lane carries it, how much stock is built ahead of a peak, and how much demand cannot be met.
//   build(net, opts)        → { lp: CPLEX LP text, meta }   (pure; solve the text with HiGHS)
//   read(net, meta, cols)   → a result shaped like TWPlan.plan's (periods, sites…), plus fill rates, unmet demand,
//                             stock and re-routed volume
// The warm-up has the first month's demand and the run-out the last month's, so the chain runs as it would without a
// horizon, and in the warm-up a site makes at most what the first month needs: the chain starts with its pipeline
// filled and its safety stock built, but little built in advance (10% headroom).
// Units: every quantity is in pack-equivalents of the site's output (the bill of materials makes one pack-equivalent of
// any tier need one pack-equivalent of the tier above), so only yields change quantities. Time runs over a warm-up
// before the first month (so the first months can be supplied), the 156 months, and a run-out after them in which
// demand holds (so the last months are not starved). Fractional times are split across two months, as in the
// requirements plan. Sourcing:
//   fixed      each lane carries its share of what the site receives (no re-sourcing)
//   qualified  the existing lanes may carry more or less than their share, at a cost per pack re-routed
//   any        every site of the tier above may supply, at the same cost
// Stock may be held at most `hold` months (pre-building ahead of a peak; 0 = no pre-building; warehouses always keep
// at least two months for safety stock). Warehouse safety stock is a soft target: it can be drawn in a crunch.
// Objective, in pack-equivalents: unmet demand 1000 (× the market's priority) ≫ safety stock below target 1 a month
// (so a long crunch draws it rather than lose sales) > re-routing 0.5 ≫ holding 0.02 a month > transport 0.0005 a transit day > making 0.001.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./plan.js"));
  else root.TWConstrained = factory(root.TWPlan);
})(typeof self !== "undefined" ? self : this, function (P) {
  "use strict";
  var COST = { unmet: 1000, safety: 1, reroute: 0.5, hold: 0.02, transport: 0.0005, make: 0.001 };
  var MODES = ["fixed", "qualified", "any"];
  // the interior-point method, without crossover: an exact basis is not needed for a plan, and it is several times faster
  var SOLVER = { output_flag: false, solver: "ipm", run_crossover: "off" };
  // a delay in months as whole-month offsets with weights (a + f → a with 1 − f, a + 1 with f)
  function split(d) { var a = Math.floor(d + 1e-9), f = d - a; var o = []; if (1 - f > 1e-9) o.push([a, 1 - f]); if (f > 1e-9) o.push([a + 1, f]); return o; }
  // pack-equivalents per unit of a tier's own unit
  function packEq(net) {
    var b = net.bom, per = { market: 1, warehouse: 1, packaging: 1, dosing: b.packPerUnit, product: b.kgPerSachet / 1000, raw: b.rawPerProduct };
    var out = {}, u = 1; P.TIERS.forEach(function (t, i) { if (i > 0) u *= per[t.id]; out[t.id] = 1 / u; });
    return out;
  }
  function lanesOf(net, mode) {
    var byId = {}, out = [], have = {};
    net.sites.forEach(function (s) { byId[s.id] = s; });
    net.sites.forEach(function (s) {
      if (s.tier === "raw") return;
      var sup = (s.suppliers || []).filter(function (l) { return l.share > 0 && byId[l.from]; }), tot = sup.reduce(function (a, l) { return a + l.share; }, 0);
      sup.forEach(function (l) { have[l.from + ">" + s.id] = 1; out.push({ from: l.from, to: s.id, share: l.share / tot, days: P.transitDays(byId[l.from], s, l.days), qualified: true }); });
      if (mode === "any") {
        var up = P.TIERS[P.TIER_INDEX[s.tier] + 1].id;
        net.sites.forEach(function (u) { if (u.tier === up && !have[u.id + ">" + s.id]) out.push({ from: u.id, to: s.id, share: 0, days: P.transitDays(u, s), qualified: false }); });
      }
    });
    return out;
  }
  function build(net, opts) {
    opts = opts || {};
    var mode = MODES.indexOf(opts.mode) >= 0 ? opts.mode : "qualified";
    var hold = opts.hold != null ? Math.max(0, Math.round(opts.hold)) : 6;
    var base = P.plan(net); if (!base.ok) return { ok: false, errors: base.errors };
    var M = P.MONTHS, DPM = P.DAYS_PER_MONTH, pe = packEq(net), cfg = net.config, lanes = lanesOf(net, mode);
    // the warm-up must fill the slowest pipeline: every step can spill into the next month, so add up, tier by tier, the
    // longest lead + release (or handling) and the longest lane, each rounded up to whole months
    var stepMax = {}, laneMax = {};
    net.sites.forEach(function (s) { var d = Math.ceil((s.lead || 0) / DPM) + Math.ceil((s.release || 0) / DPM) + Math.ceil((s.handling || 0) / DPM); stepMax[s.tier] = Math.max(stepMax[s.tier] || 0, d); });
    lanes.forEach(function (l) { var t = byTierOf(l.to); laneMax[t] = Math.max(laneMax[t] || 0, Math.ceil(l.days / DPM)); });
    function byTierOf(id) { for (var q = 0; q < net.sites.length; q++) if (net.sites[q].id === id) return net.sites[q].tier; return ""; }
    var fillMonths = 0; P.TIERS.forEach(function (t) { fillMonths += (stepMax[t.id] || 0) + (laneMax[t.id] || 0); });
    var W = fillMonths + 2, Tn = W + M + W;
    var byId = {}; net.sites.forEach(function (s) { byId[s.id] = s; });
    // quantities in units of SC pack-equivalents keep the LP's numbers near 1 (better conditioned)
    var SC = opts.scale > 0 ? opts.scale : 1e4;
    var cap = {}, dem = {}, ss = {};
    net.sites.forEach(function (s) {
      var r = base.sites[s.id], c = new Float64Array(Tn);
      for (var t = 0; t < Tn; t++) { var m = Math.min(M - 1, Math.max(0, t - W)); if (s.tier === "market") c[t] = r.demand[m] * pe.market / SC; else c[t] = (t < W ? Math.min(r.capacity[0], r.load[0] * API.WARMUP) : r.capacity[m]) * pe[s.tier] / SC; }
      if (s.tier === "market") dem[s.id] = c; else cap[s.id] = c;
      if (s.tier === "warehouse") { var q = new Float64Array(Tn); for (t = 0; t < Tn; t++) q[t] = r.ss[Math.min(M - 1, Math.max(0, t - W))] / SC; ss[s.id] = q; }
    });
    // ---- LP text, written row by row
    var obj = [], rows = [], bounds = [], nRows = 0;
    function term(c, v) { return (c >= 0 ? " + " : " - ") + fmt(Math.abs(c)) + " " + v; }
    function fmt(c) { return c === 1 ? "1" : +c.toPrecision(12) + ""; }
    function row(terms, op, rhs) { if (!terms.length) { return; } var parts = []; for (var q = 0; q < terms.length; q += 8) parts.push(terms.slice(q, q + 8).join("")); rows.push(" r" + (nRows++) + ":" + parts.join("\n  ") + " " + op + " " + fmt(rhs)); }
    var inL = {}, outL = {}; lanes.forEach(function (l, i) { l.i = i; (inL[l.to] = inL[l.to] || []).push(l); (outL[l.from] = outL[l.from] || []).push(l); });
    var Pv = function (s, t) { return "p" + s + "_" + t; }, Iv = function (s, t) { return "i" + s + "_" + t; }, Xv = function (l, t) { return "x" + l + "_" + t; };
    // (no name starts with e: LP readers take e followed by digits for an exponent)
    var Ev = function (l, t) { return "g" + l + "_" + t; }, Dv = function (l, t) { return "d" + l + "_" + t; }, Uv = function (k, t) { return "u" + k + "_" + t; }, Sv = function (w, t) { return "s" + w + "_" + t; };
    var sIdx = {}; net.sites.forEach(function (s, i) { sIdx[s.id] = i; });
    // arrivals of lane l at month k: shipments made at k − transit
    function arrivals(l, k) { var o = []; split(l.days / DPM).forEach(function (sp) { var t = k - sp[0]; if (t >= 0 && t < Tn) o.push([Xv(l.i, t), sp[1]]); }); return o; }
    // what a CMO releases at t (made at t − release, gross of yield) and the inputs it consumes at k (for making at k + lead)
    function released(s, t) { var y = (s.yield != null ? s.yield : 100) / 100, o = []; split((s.release || 0) / DPM).forEach(function (sp) { var u = t - sp[0]; if (u >= 0) o.push([Pv(sIdx[s.id], u), y * sp[1]]); }); return o; }
    function consumes(s, k) { var o = []; split((s.lead || 0) / DPM).forEach(function (sp) { var u = k + sp[0]; if (u < Tn) o.push([Pv(sIdx[s.id], u), sp[1]]); }); return o; }
    function avail(w, t) { var o = [], h = (w.handling || 0) / DPM; (inL[w.id] || []).forEach(function (l) { split(h).forEach(function (sp) { arrivals(l, t - sp[0]).forEach(function (a) { o.push([a[0], a[1] * sp[1]]); }); }); }); return o; }
    function merge(list) { var m = {}; list.forEach(function (x) { m[x[0]] = (m[x[0]] || 0) + x[1]; }); return Object.keys(m).filter(function (k) { return Math.abs(m[k]) > 1e-12; }).map(function (k) { return [k, m[k]]; }); }
    // Every balance has a stock in it, so fractional lead, release and transit times never force exact month-by-month
    // matches (which would make shipments oscillate): finished stock at every site, input stock at every CMO that buys,
    // and a small buffer at each consumption point. Stock is held at most L months: hold for CMOs (at least one month,
    // which only absorbs the fractions), at least two months at warehouses (for safety stock).
    function lim(name, t, list, L) { var o = [[name(t), 1]]; for (var k = Math.max(0, t - L + 1); k <= t; k++) list(k).forEach(function (a) { o.push([a[0], -a[1]]); }); row(merge(o).map(function (a) { return term(a[1], a[0]); }), "<=", 0); }
    function arrAll(s, k) { var o = []; (inL[s.id] || []).forEach(function (l) { arrivals(l, k).forEach(function (a) { o.push(a); }); }); return o; }
    var Bv = function (k, t) { return "b" + k + "_" + t; }, Jv = function (s, t) { return "j" + s + "_" + t; };
    net.sites.forEach(function (s) {
      var i = sIdx[s.id], t;
      if (s.tier === "market") {
        // buffer: B[t] = B[t−1] + arrivals − delivered, delivered = demand − unmet; held at most a month
        for (t = 0; t < Tn; t++) {
          var tm = [[Bv(i, t), 1]]; if (t > 0) tm.push([Bv(i, t - 1), -1]);
          arrAll(s, t).forEach(function (a) { tm.push([a[0], -a[1]]); });
          // the warm-up and the run-out have demand too (the first month's, the last month's), so the chain runs as it
          // would without a horizon; only the 156 months count in the results
          // (a warm-up month weighs a little more than a planned one, so stock is not built before the plan starts; a run-out
          // month much less, so the planned months come first)
          tm.push([Uv(i, t), -1]); obj.push(term(COST.unmet * (s.priority > 0 ? s.priority : 1) * (t < W ? 1.001 : t < W + M ? 1 : 0.2), Uv(i, t)));
          var rhs = -dem[s.id][t];
          row(merge(tm).map(function (a) { return term(a[1], a[0]); }), "=", rhs);
          obj.push(term(COST.hold, Bv(i, t)));
          lim(function (k) { return Bv(i, k); }, t, function (k) { return arrAll(s, k); }, 1);
        }
        return;
      }
      var isW = s.tier === "warehouse", L = isW ? Math.max(hold, 2) : Math.max(hold, 1);
      for (t = 0; t < Tn; t++) {
        // finished stock: I[t] = I[t−1] + what comes in − what is shipped
        var tm2 = [[Iv(i, t), 1]]; if (t > 0) tm2.push([Iv(i, t - 1), -1]);
        obj.push(term(COST.hold, Iv(i, t)));
        var incF = isW ? function (k) { return avail(s, k); } : function (k) { return released(s, k); };
        incF(t).forEach(function (a) { tm2.push([a[0], -a[1]]); });
        (outL[s.id] || []).forEach(function (l) { tm2.push([Xv(l.i, t), 1]); });
        row(merge(tm2).map(function (a) { return term(a[1], a[0]); }), "=", 0);
        lim(function (k) { return Iv(i, k); }, t, incF, L);
        if (isW) {
          var o = (outL[s.id] || []).map(function (l) { return term(1, Xv(l.i, t)); });
          if (o.length) row(o, "<=", cap[s.id][t]);
          if (ss[s.id][t] > 0) { row([term(1, Iv(i, t)), term(1, Sv(i, t))], ">=", ss[s.id][t] * pe.warehouse); obj.push(term(COST.safety, Sv(i, t))); }
        } else {
          bounds.push(" " + Pv(i, t) + " <= " + fmt(Math.max(0, cap[s.id][t])));
          obj.push(term(COST.make, Pv(i, t)));
          if (s.tier !== "raw") {
            // input stock: J[t] = J[t−1] + arrivals − what making consumes
            var a2 = [[Jv(i, t), 1]]; if (t > 0) a2.push([Jv(i, t - 1), -1]);
            arrAll(s, t).forEach(function (a) { a2.push([a[0], -a[1]]); });
            consumes(s, t).forEach(function (c) { a2.push([c[0], c[1]]); });
            row(merge(a2).map(function (a) { return term(a[1], a[0]); }), "=", 0);
            obj.push(term(COST.hold, Jv(i, t)));
            lim(function (k) { return Jv(i, k); }, t, function (k) { return arrAll(s, k); }, L);
          }
        }
      }
    });
    // lanes: transport cost, and each lane's share of what the site is sent each month
    lanes.forEach(function (l) {
      var sib = inL[l.to];
      for (var t = 0; t < Tn; t++) {
        obj.push(term(COST.transport * Math.max(1, l.days), Xv(l.i, t)));
        if (sib.length < 2 && l.share >= 1) continue;
        var all = [[Xv(l.i, t), 1]]; sib.forEach(function (o) { all.push([Xv(o.i, t), -l.share]); });
        var tm = merge(all).map(function (a) { return term(a[1], a[0]); });
        if (mode !== "fixed") { tm.push(term(-1, Ev(l.i, t))); tm.push(term(1, Dv(l.i, t))); obj.push(term(COST.reroute, Ev(l.i, t))); }
        if (tm.length) row(tm, "=", 0);
      }
    });
    var objLines = []; for (var q = 0; q < obj.length; q += 8) objLines.push(obj.slice(q, q + 8).join(""));
    var lp = "Minimize\n obj:" + objLines.join("\n") + "\nSubject To\n" + rows.join("\n") + "\nBounds\n" + bounds.join("\n") + "\nEnd\n";
    return { ok: true, lp: lp, meta: { mode: mode, hold: hold, scale: SC, W: W, Tn: Tn, lanes: lanes, sIdx: sIdx, pe: pe, rows: nRows, base: base } };
  }

  // the solution, read back into the shape of a requirements plan
  function read(net, meta, cols) {
    var M = P.MONTHS, W = meta.W, Tn = meta.Tn, pe = meta.pe, base = meta.base, sIdx = meta.sIdx;
    var SC = meta.scale || 1, v = function (name) { var c = cols[name]; return c ? Math.max(0, c.Primal != null ? c.Primal : c) * SC : 0; };
    var Pr = P.periods(net.config.startYear, net.config.startMonth), out = {}, laneFlow = {};
    meta.lanes.forEach(function (l) {
      var a = new Float64Array(M), sh = split(l.days / P.DAYS_PER_MONTH);
      for (var m = 0; m < M; m++) { var k = m + W, s = 0; sh.forEach(function (sp) { var t = k - sp[0]; if (t >= 0) s += v("x" + l.i + "_" + t) * sp[1]; }); a[m] = s / pe[net.sites[sIdx[l.to]].tier === "market" ? "market" : net.sites[sIdx[l.from]].tier]; }
      laneFlow[l.from + ">" + l.to] = a;
    });
    var totD = 0, totU = 0, firstU = -1, reroute = 0, flowAll = 0;
    net.sites.forEach(function (s) {
      var i = sIdx[s.id], m, k;
      if (s.tier === "market") {
        var d = base.sites[s.id].demand, u = new Float64Array(M), del = new Float64Array(M);
        for (m = 0; m < M; m++) { u[m] = Math.min(d[m], v("u" + i + "_" + (m + W)) / pe.market); del[m] = d[m] - u[m]; totD += d[m]; totU += u[m]; if (u[m] > d[m] * 1e-4 + 1e-6 && (firstU < 0 || m < firstU)) firstU = m; }
        var fu = -1; for (m = 0; m < M; m++) if (u[m] > d[m] * 1e-4 + 1e-6) { fu = m; break; }
        out[s.id] = { site: s, demand: d, delivered: del, unmet: u, firstUnmet: fu, fill: sumA(d, 0, M) > 0 ? sumA(del, 0, M) / sumA(d, 0, M) : 1,
          periods: Pr.map(function (p) { var n = p.to - p.from, dd = sumA(d, p.from, p.to), uu = sumA(u, p.from, p.to); return { value: dd / n, delivered: (dd - uu) / n, unmet: uu / n, fill: dd > 0 ? 1 - uu / dd : 1 }; }) };
        return;
      }
      var unit = pe[s.tier], L = new Float64Array(M), C = base.sites[s.id].capacity, I = new Float64Array(M), util = new Float64Array(M);
      for (m = 0; m < M; m++) {
        var t = m + W;
        if (s.tier === "warehouse") { var o = 0; meta.lanes.forEach(function (l) { if (l.from === s.id) o += v("x" + l.i + "_" + t); }); L[m] = o / unit; }
        else L[m] = v("p" + i + "_" + t) / unit;
        I[m] = v("i" + i + "_" + t) / unit;
        util[m] = C[m] > 0 ? L[m] / C[m] : 0;
      }
      var req = base.sites[s.id].load, binding = -1; for (m = 0; m < M; m++) if (util[m] > 0.999 && req[m] > C[m] * 0.999) { binding = m; break; }
      out[s.id] = { site: s, load: L, capacity: C, util: util, stock: I, required: req, firstOver: -1, firstBinding: binding, peakUtil: Math.max.apply(null, Array.prototype.slice.call(util)),
        byMarket: null, byCustomer: null, ss: base.sites[s.id].ss,
        periods: Pr.map(function (p) {
          var l = sumA(L, p.from, p.to), c = sumA(C, p.from, p.to), pk = 0, pkm = p.from;
          for (k = p.from; k < p.to; k++) if (util[k] > pk) { pk = util[k]; pkm = k; }
          return { load: l / (p.to - p.from), capacity: c / (p.to - p.from), util: c > 0 ? l / c : 0, peak: pk, peakMonth: pkm, gap: 0, stock: sumA(I, p.from, p.to) / (p.to - p.from), required: sumA(req, p.from, p.to) / (p.to - p.from) };
        }) };
    });
    // re-routed volume: what lanes carry beyond their planned share, over the horizon
    meta.lanes.forEach(function (l) {
      var f = laneFlow[l.from + ">" + l.to], tot = 0; for (var m = 0; m < M; m++) tot += f[m];
      var sum = 0; meta.lanes.forEach(function (o) { if (o.to === l.to) { var g = laneFlow[o.from + ">" + o.to]; for (var m2 = 0; m2 < M; m2++) sum += g[m2]; } });
      var want = l.share * sum; reroute += Math.max(0, tot - want) * pe[byTier(net, l.from)]; flowAll += tot * pe[byTier(net, l.from)];
    });
    var lanesOut = meta.lanes.map(function (l) { var f = laneFlow[l.from + ">" + l.to], tot = 0; for (var m = 0; m < M; m++) tot += f[m]; return { from: l.from, to: l.to, share: l.share, qualified: l.qualified, days: l.days, flow: f, total: tot }; });
    var shares = {}; lanesOut.forEach(function (l) { (shares[l.to] = shares[l.to] || { tot: 0, lanes: [] }).tot += l.total; shares[l.to].lanes.push(l); });
    Object.keys(shares).forEach(function (k) { shares[k].lanes.forEach(function (l) { l.actual = shares[k].tot > 0 ? l.total / shares[k].tot : 0; }); });
    return { ok: true, constrained: true, mode: meta.mode, hold: meta.hold, months: M, periods: Pr, sites: out, markets: base.markets, transit: base.transit, tiers: base.tiers, leadChain: base.leadChain, lanes: lanesOut,
      fill: totD > 0 ? 1 - totU / totD : 1, unmet: totU, demand: totD, firstUnmet: firstU, rerouted: flowAll > 0 ? reroute / flowAll : 0 };
  }
  function byTier(net, id) { for (var i = 0; i < net.sites.length; i++) if (net.sites[i].id === id) return net.sites[i].tier; return "market"; }
  function sumA(s, a, b) { var t = 0; for (var i = a; i < b; i++) t += s[i]; return t; }
  // solve with a loaded HiGHS instance (Node or a worker)
  function solve(highs, net, opts) {
    var b = build(net, opts); if (!b.ok) return b;
    // the interior-point method first; if it stumbles numerically, the same with crossover, then the dual simplex
    var tries = [Object.assign({}, SOLVER, (opts && opts.highs) || {}), { output_flag: false, solver: "ipm", run_crossover: "on", presolve: "off" }, { output_flag: false, solver: "simplex" }];
    var t0 = Date.now(), r = null, why = "";
    for (var k = 0; k < tries.length && !r; k++) {
      try { var x = highs.solve(b.lp, tries[k]); if (x.Status === "Optimal") r = x; else why = x.Status; } catch (e) { why = String(e && e.message || e); }
    }
    if (!r) return { ok: false, errors: ["The constrained plan could not be solved (" + why + ")."] };
    var out = read(net, b.meta, r.Columns); out.seconds = (Date.now() - t0) / 1000; out.size = { rows: b.meta.rows, cols: Object.keys(r.Columns).length }; out.attempts = k;
    return out;
  }
  var API = { WARMUP: 1.1, COST: COST, MODES: MODES, split: split, packEq: packEq, lanesOf: lanesOf, build: build, read: read, solve: solve };
  return API;
});
