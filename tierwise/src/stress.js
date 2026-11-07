// Tierwise — stress tests (window.TWStress / module.exports): what a disruption costs, and how long the network can ride
// one out. Everything shown is solved by the month-by-month plan (src/constrained.js), with its receipt.
//
// A disruption is one of three kinds:
//   site    a site loses `severity` (0–1) of its capacity
//   route   a lane loses `severity` of what it carried in the undisturbed plan
//   demand  a market's demand (or every market's, target "all") changes by `change` (+0.5 = half as much again; −0.3)
// It starts at month `start`, lasts `months` at full strength, then fades back over `ramp` months.
//
// A disruption is a surprise. The plan sees the whole horizon, so left alone it would build stock ahead of a strike it
// "knows" is coming. Every production and shipment decision before the start is therefore held at the undisturbed plan's
// values; from the start the plan re-plans, knowing how long the disruption will last (an optimistic planner: real ones
// learn the length as it unfolds).
//
// Measures, against the undisturbed plan:
//   lost      packs that go unmet because of the disruption: the change in unmet demand from the start on (a drop in
//             demand that leaves less unmet does not count as a gain)
//   costPV    the change in the plan's cost in present money: lost margin, extra stock, re-routing
//   tts       time to survive: the longest the disruption can last with no lost sales (packs within TOL of a month's demand)
//   ttr       time to recover: how long the site or route takes to come back (an input; defaults by tier, as assumptions)
//   headroom  for a demand surge: the largest surge, for these months, that loses no sales
// A scan of every site and route ranks them first with a fast flow screen (no stock, no lead times: a ranking, never an
// answer), then solves the worst few with the full plan. Only those solved figures are shown as numbers.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./plan.js"), require("./constrained.js"));
  else root.TWStress = factory(root.TWPlan, root.TWConstrained);
})(typeof self !== "undefined" ? self : this, function (P, K) {
  "use strict";
  // time to recover by tier, in months: assumptions, shown as such and editable for each disruption
  var TTR = { raw: 3, product: 6, dosing: 6, packaging: 4, warehouse: 2, route: 1 };
  var TOL = 0.001, MAX_MONTHS = 24, MAX_CHANGE = 2, PROVE = 8, SURVIVE = 3, LEAD_IN = 3, AFTER = 6;
  var KINDS = ["site", "route", "demand"];

  function siteOf(net, id) { for (var i = 0; i < net.sites.length; i++) if (net.sites[i].id === id) return net.sites[i]; return null; }
  function ttrOf(net, d) {
    if (d.kind === "route") return TTR.route;
    var s = siteOf(net, d.target); if (!s) return 0;
    return s.recovery > 0 ? s.recovery : TTR[s.tier] || 3;
  }
  // every site and route that can fail (routes: the lanes the plan may use)
  function elements(net, mode) {
    var out = [];
    net.sites.forEach(function (s) { if (s.tier !== "market") out.push({ kind: "site", target: s.id, tier: s.tier, name: s.name }); });
    K.lanesOf(net, mode || "qualified").forEach(function (l) {
      if (!l.qualified) return;
      var a = siteOf(net, l.from), b = siteOf(net, l.to);
      out.push({ kind: "route", target: l.from + ">" + l.to, tier: "route", name: (a ? a.name : l.from) + " → " + (b ? b.name : l.to) });
    });
    return out;
  }
  // how hard the disruption hits in each month: 1 at full strength, fading linearly over the ramp
  function profile(d) {
    var M = P.MONTHS, f = new Float64Array(M), s = Math.max(0, Math.round(d.start || 0)), n = Math.max(0, Math.round(d.months || 0)), r = Math.max(0, Math.round(d.ramp || 0));
    for (var m = s; m < Math.min(M, s + n); m++) f[m] = 1;
    for (var k = 0; k < r && s + n + k < M; k++) f[s + n + k] = 1 - (k + 1) / (r + 1);
    return f;
  }
  function clean(d) {
    var o = { kind: KINDS.indexOf(d.kind) >= 0 ? d.kind : "site", target: d.target, start: Math.max(0, Math.round(d.start || 0)), months: Math.max(0, Math.round(d.months || 0)), ramp: Math.max(0, Math.round(d.ramp || 0)) };
    if (o.kind === "demand") o.change = +d.change || 0; else o.severity = Math.max(0, Math.min(1, d.severity != null ? +d.severity : 1));
    return o;
  }
  // the solver options for a disruption, given the undisturbed plan (solved with keep: true)
  function optionsFor(net, base, d, o) {
    var f = profile(d), M = P.MONTHS, st = { mul: {}, laneMax: {}, fix: { vals: base.primal, before: d.start }, spec: d };
    if (d.kind === "site") {
      var m1 = new Float64Array(M); for (var m = 0; m < M; m++) m1[m] = 1 - d.severity * f[m]; st.mul[d.target] = m1;
    } else if (d.kind === "demand") {
      net.sites.forEach(function (s) {
        if (s.tier !== "market" || (d.target !== "all" && d.target !== s.id)) return;
        var m2 = new Float64Array(M); for (var m = 0; m < M; m++) m2[m] = Math.max(0, 1 + d.change * f[m]); st.mul[s.id] = m2;
      });
    } else {
      var li = base.laneIndex[d.target], cap = {};
      if (li == null) return null;
      for (var m3 = 0; m3 < M; m3++) if (f[m3] > 0) { var t = m3 + base.W, v = base.primal["x" + li + "_" + t] || 0; cap[t] = Math.max(0, v) * (1 - d.severity * f[m3]); }
      st.laneMax[d.target] = cap;
    }
    return { mode: o.mode, hold: o.hold, stress: st };
  }
  function sumA(a, from, to) { var s = 0; for (var i = Math.max(0, from); i < Math.min(a.length, to); i++) s += a[i]; return s; }
  // what the disruption did, against the undisturbed plan
  function measure(net, base, st, d) {
    var M = P.MONTHS, end = Math.min(M, d.start + d.months + d.ramp), from = Math.max(0, d.start - LEAD_IN), to = Math.min(M, end + AFTER);
    var lost = 0, byYear = new Float64Array(Math.ceil(M / 12)), markets = [], tB = new Float64Array(M), tS = new Float64Array(M), dB = new Float64Array(M), dS = new Float64Array(M);
    Object.keys(st.sites).forEach(function (id) {
      var x = st.sites[id], b = base.sites[id]; if (x.site.tier !== "market") return;
      var l = 0, wantS = 0, gotS = 0;
      for (var m = 0; m < M; m++) {
        // the plan may move a shortfall between months, so the change is summed, not counted month by month
        if (m >= d.start) { l += x.unmet[m] - b.unmet[m]; byYear[Math.floor(m / 12)] += x.unmet[m] - b.unmet[m]; }
        dB[m] += b.demand[m]; tB[m] += b.delivered[m]; dS[m] += x.demand[m]; tS[m] += x.delivered[m];
        if (m >= d.start && m < to) { wantS += x.demand[m]; gotS += x.delivered[m]; }
      }
      l = Math.max(0, l); lost += l;
      if (l > 1) markets.push({ id: id, name: x.site.name, lost: l, fill: wantS > 0 ? gotS / wantS : 1 });
    });
    markets.sort(function (a, b) { return b.lost - a.lost; });
    var trace = [];
    for (var m = from; m < to; m++) trace.push({ month: m, base: dB[m] > 0 ? tB[m] / dB[m] : 1, stressed: dS[m] > 0 ? tS[m] / dS[m] : 1 });
    var wB = sumA(dB, d.start, to), wS = sumA(dS, d.start, to);
    var stockB = 0, stockS = 0;
    Object.keys(st.sites).forEach(function (id) { var x = st.sites[id], b = base.sites[id]; if (x.stock) { stockB += sumA(b.stock, d.start, to); stockS += sumA(x.stock, d.start, to); } });
    return {
      // where the lost sales land: a disruption can eat stock built for a later peak, and lose its sales years later
      lostByYear: Array.prototype.map.call(byYear, function (v) { return Math.max(0, v); }), lateShare: lost > 0 ? Math.max(0, Math.min(1, (lost - Math.max(0, lostIn(st, base, d.start, to))) / lost)) : 0,
      lost: lost, costPV: st.planCostPV != null && base.planCostPV != null ? st.planCostPV - base.planCostPV : null,
      fill: { base: wB > 0 ? sumA(tB, d.start, to) / wB : 1, stressed: wS > 0 ? sumA(tS, d.start, to) / wS : 1 },
      extraStock: (stockS - stockB) / Math.max(1, to - d.start), markets: markets, trace: trace, window: { from: d.start, to: to },
      rerouted: st.rerouted, proved: !!(st.receipt && st.receipt.proved && base.receipt && base.receipt.proved), receipts: [base.receipt, st.receipt]
    };
  }
  function lostIn(st, base, from, to) { var l = 0; Object.keys(st.sites).forEach(function (id) { var x = st.sites[id]; if (x.site.tier === "market") for (var m = from; m < to; m++) l += x.unmet[m] - base.sites[id].unmet[m]; }); return l; }
  // a stress run: the undisturbed plan (once) and the disrupted one
  function session(highs, net, o, progress) {
    var solves = 0, say = progress || function () {}, memo = {}, base = null;
    function solve(opts) {
      var key = JSON.stringify(opts.stress ? opts.stress.spec : null);
      if (!memo[key]) { solves++; say(solves); memo[key] = K.solve(highs, net, opts); }
      return memo[key];
    }
    function baseline() { if (!base) base = solve({ mode: o.mode, hold: o.hold, keep: true }); return base; }
    function run(d) {
      var b = baseline(); if (!b.ok) return b;
      var opts = optionsFor(net, b, d, o); if (!opts) return { ok: false, errors: ["Unknown route: " + d.target] };
      if (d.months === 0 && d.ramp === 0) return { ok: true, plan: b, m: { lost: 0, costPV: 0, proved: b.receipt.proved, receipts: [b.receipt, b.receipt], markets: [], trace: [], fill: { base: 1, stressed: 1 } } };
      var st = solve(opts); if (!st.ok) return st;
      return { ok: true, plan: st, m: measure(net, b, st, d) };
    }
    // the tolerance: a thousandth of a month's demand at the start, across every market
    function tol(d) { var b = baseline(), t = 0; Object.keys(b.sites).forEach(function (id) { if (b.sites[id].site.tier === "market") t += b.sites[id].demand[Math.min(P.MONTHS - 1, d.start)]; }); return TOL * t; }
    // time to survive: the longest the disruption can last (no ramp) without losing sales. Halving the range assumes a
    // longer disruption never loses less, which holds because nothing before the start can change.
    function tts(d) {
      var lim = tol(d), at = function (n) { var r = run(Object.assign({}, d, { months: n, ramp: 0 })); return r.ok ? r.m.lost : Infinity; };
      var cap = Math.min(MAX_MONTHS, P.MONTHS - d.start), lo = 0, hi = cap + 1;   // lo survives, hi does not
      // start from the disruption's own length, which is usually solved already
      if (d.months >= 1 && d.months <= cap && d.ramp === 0) { if (at(d.months) <= lim) lo = d.months; else hi = d.months; }
      if (lo === 0 && hi > 1) { if (at(1) > lim) return { months: 0, capped: false }; lo = 1; }
      if (hi === cap + 1) { if (at(cap) <= lim) return { months: cap, capped: true }; hi = cap; }
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (at(mid) <= lim) lo = mid; else hi = mid; }
      return { months: lo, capped: false };
    }
    // for a surge: the largest one, over these months, that loses no sales (to within 2 percentage points)
    function headroom(d) {
      var lim = tol(d), at = function (c) { var r = run(Object.assign({}, d, { change: c })); return r.ok ? r.m.lost : Infinity; };
      if (at(0.02) > lim) return { change: 0, capped: false };
      if (at(MAX_CHANGE) <= lim) return { change: MAX_CHANGE, capped: true };
      var lo = 0.02, hi = MAX_CHANGE;
      while (hi - lo > 0.02) { var mid = Math.round((lo + hi) * 50) / 100; if (mid <= lo || mid >= hi) break; if (at(mid) <= lim) lo = mid; else hi = mid; }
      return { change: lo, capped: false };
    }
    return { run: run, tts: tts, headroom: headroom, baseline: baseline, solves: function () { return solves; } };
  }
  function brief(r) { var m = r.m; return { lostByYear: m.lostByYear, lateShare: m.lateShare, lost: m.lost, costPV: m.costPV, fill: m.fill, extraStock: m.extraStock, markets: m.markets, trace: m.trace, window: m.window, rerouted: m.rerouted, proved: m.proved, receipts: m.receipts }; }

  // one disruption, solved, with its time to survive (supply) or its headroom (a demand surge)
  function analyse(highs, net, opts, progress) {
    opts = opts || {}; var t0 = Date.now(), o = { mode: opts.mode, hold: opts.hold }, d = clean(opts.disruption || {});
    if (!K.costsOf(net.config).money) return { ok: false, needsMoney: true };
    if (d.kind !== "demand" && !(d.kind === "site" ? siteOf(net, d.target) : d.target)) return { ok: false, errors: ["Choose a site or route to disrupt."] };
    var S = session(highs, net, o, progress), r = S.run(d); if (!r.ok) return r;
    var out = { ok: true, disruption: d, result: brief(r) };
    if (d.kind === "demand") { if (d.change > 0) out.headroom = S.headroom(d); }
    else { out.ttr = ttrOf(net, d); out.tts = S.tts(Object.assign({}, d)); out.survives = out.tts.months >= d.months; }
    out.solves = S.solves(); out.seconds = (Date.now() - t0) / 1000;
    return out;
  }

  // ---- the screen: a max-flow through the network, month by month, with no stock and no lead times
  function screener(net, mode) {
    var base = P.plan(net); if (!base.ok) return null;
    var pe = K.packEq(net), lanes = K.lanesOf(net, mode), ids = net.sites.map(function (s) { return s.id; }), idx = {};
    ids.forEach(function (id, i) { idx[id] = i; });
    var n = 2 * ids.length + 2, S = n - 2, T = n - 1;
    // the most the network can deliver in month m, with site capacities multiplied by capMul and lanes in laneOff closed
    function deliver(m, capMul, demMul, laneOff) {
      var g = new MaxFlow(n);
      net.sites.forEach(function (s, i) {
        var r = base.sites[s.id];
        if (s.tier === "market") { g.add(2 * i, T, r.demand[m] * (demMul[s.id] != null ? demMul[s.id] : 1)); g.add(2 * i + 1, 2 * i, Infinity); return; }
        var c = r.capacity[m] * pe[s.tier] * (capMul[s.id] != null ? capMul[s.id] : 1);
        g.add(2 * i, 2 * i + 1, c);
        if (s.tier === "raw") g.add(S, 2 * i, Infinity);
      });
      lanes.forEach(function (l) { var off = laneOff[l.from + ">" + l.to]; g.add(2 * idx[l.from] + 1, 2 * idx[l.to], off != null ? off : Infinity); });
      return g.run(S, T);
    }
    // packs a disruption would cost, by the screen: lost delivery in each hit month, against the same month undisturbed
    function loss(d) {
      var f = profile(d), tot = 0;
      for (var m = 0; m < P.MONTHS; m++) {
        if (!(f[m] > 0)) continue;
        var cm = {}, dm = {}, lo = {};
        if (d.kind === "site") cm[d.target] = 1 - d.severity * f[m];
        else if (d.kind === "route") lo[d.target] = (1 - d.severity * f[m]) > 0 ? Infinity : 0;
        else net.sites.forEach(function (s) { if (s.tier === "market" && (d.target === "all" || d.target === s.id)) dm[s.id] = Math.max(0, 1 + d.change * f[m]); });
        var a = deliver(m, {}, {}, {}), b = deliver(m, cm, dm, lo), want = 0;
        if (d.kind === "demand") { net.sites.forEach(function (s) { if (s.tier === "market") want += base.sites[s.id].demand[m] * (dm[s.id] != null ? dm[s.id] : 1); }); tot += Math.max(0, want - b) - Math.max(0, wantOf(m) - a); }
        else tot += Math.max(0, a - b);
      }
      return tot;
    }
    function wantOf(m) { var w = 0; net.sites.forEach(function (s) { if (s.tier === "market") w += base.sites[s.id].demand[m]; }); return w; }
    return { loss: loss, deliver: deliver };
  }
  // a plain max-flow (Edmonds–Karp): the networks here have tens of nodes
  function MaxFlow(n) { this.n = n; this.adj = []; for (var i = 0; i < n; i++) this.adj.push([]); this.to = []; this.cap = []; }
  MaxFlow.prototype.add = function (a, b, c) { this.adj[a].push(this.to.length); this.to.push(b); this.cap.push(c); this.adj[b].push(this.to.length); this.to.push(a); this.cap.push(0); };
  MaxFlow.prototype.run = function (s, t) {
    var flow = 0;
    for (;;) {
      var prev = new Int32Array(this.n).fill(-1), q = [s]; prev[s] = -2;
      while (q.length && prev[t] === -1) { var u = q.shift(); for (var k = 0; k < this.adj[u].length; k++) { var e = this.adj[u][k], v = this.to[e]; if (prev[v] === -1 && this.cap[e] > 1e-9) { prev[v] = e; q.push(v); } } }
      if (prev[t] === -1) return flow;
      var aug = Infinity; for (var v2 = t; v2 !== s; v2 = this.to[prev[v2] ^ 1]) aug = Math.min(aug, this.cap[prev[v2]]);
      if (!isFinite(aug)) return Infinity;
      for (var v3 = t; v3 !== s; v3 = this.to[prev[v3] ^ 1]) { this.cap[prev[v3]] -= aug; this.cap[prev[v3] ^ 1] += aug; }
      flow += aug;
    }
  };

  // every site and route out, one at a time, for its time to recover: screened, then the worst few solved
  function scan(highs, net, opts, progress) {
    opts = opts || {}; var t0 = Date.now(), o = { mode: opts.mode, hold: opts.hold };
    if (!K.costsOf(net.config).money) return { ok: false, needsMoney: true };
    var start = Math.max(0, Math.round(opts.start || 0)), sc = screener(net, o.mode || "qualified"); if (!sc) return { ok: false, errors: ["The network is not valid."] };
    var list = elements(net, o.mode).map(function (e) {
      var d = clean({ kind: e.kind, target: e.target, start: start, months: ttrOf(net, e), severity: 1 });
      return { kind: e.kind, target: e.target, tier: e.tier, name: e.name, ttr: d.months, d: d, screened: sc.loss(d) };
    }).sort(function (a, b) { return b.screened - a.screened; });
    var S = session(highs, net, o, progress), b = S.baseline(); if (!b.ok) return b;
    var prove = Math.min(opts.prove > 0 ? opts.prove : PROVE, list.length);
    for (var i = 0; i < prove; i++) {
      var e = list[i], r = S.run(e.d); if (!r.ok) continue;
      e.proved = { lost: r.m.lost, costPV: r.m.costPV, fill: r.m.fill, lateShare: r.m.lateShare, markets: r.m.markets.slice(0, 3), proved: r.m.proved, receipts: r.m.receipts };
    }
    // the solved ones in order of what they really cost (the rest keep their screen order, unsolved); the costliest few
    // also get their time to survive
    var solved = list.filter(function (e) { return e.proved; }).sort(function (a, b) { return (b.proved.costPV || 0) - (a.proved.costPV || 0); }), rest = list.filter(function (e) { return !e.proved; });
    solved.slice(0, opts.survive != null ? opts.survive : SURVIVE).forEach(function (e) { e.tts = S.tts(e.d); e.survives = e.tts.months >= e.ttr; });
    var items = solved.concat(rest).map(function (e) { var x = Object.assign({}, e); delete x.d; return x; });
    return { ok: true, start: start, items: items, prove: prove, receipt: b.receipt, solves: S.solves(), seconds: (Date.now() - t0) / 1000 };
  }

  return { TTR: TTR, TOL: TOL, MAX_MONTHS: MAX_MONTHS, PROVE: PROVE, SURVIVE: SURVIVE, KINDS: KINDS, ttrOf: ttrOf, elements: elements, profile: profile, clean: clean, optionsFor: optionsFor, session: session, analyse: analyse, screener: screener, scan: scan, MaxFlow: MaxFlow };
});
