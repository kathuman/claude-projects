// Tierwise — what to do, and in what order (window.TWPriorities / module.exports). Everything here is decided by the plan,
// not by a language model: each action is priced by solving the month-by-month plan with it and without it, so every
// figure has a receipt. The result is four groups, not a blended score, so that the reason for an order stays visible:
//   now    value starts falling if you wait (or something costs nothing to do today)
//   by     worth doing, with a latest safe start
//   watch  depends on an assumption, is too far off to decide today, or is a shortfall no priced action settles
//   dont   priced, and it does not pay
// Actions are picked one at a time and fixed in the plan before the next is priced, because they interact: a line can
// lose money alone and pay once another site stops being the bottleneck.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./constrained.js"), require("./invest.js"));
  else root.TWPriorities = factory(root.TWConstrained, root.TWInvest);
})(typeof self !== "undefined" ? self : this, function (K, IV) {
  "use strict";
  var ROUNDS = 4, GRID = [0, 3, 6, 9], NEAR = 0.05, LATE_YEAR = 8, TAIL_SHARE = 0.5, FILL_OK = 0.97, LOW_DEMAND = 0.9, DEFINE_SHARE = 0.1, MAX_MARKETS = 3, MONTHS = 156;

  function candidatesOf(net) {
    var out = [];
    net.sites.forEach(function (s) { (s.candidates || []).forEach(function (c) { out.push({ key: s.id + ":" + c.id, site: s.id, id: c.id, label: c.label, add: c.add, capex: c.capex, opex: c.opex || 0, lead: Math.ceil((c.build || 0) + (c.qualify || 0)) }); }); });
    return out;
  }
  function withBuilds(net, builds) {
    var n = JSON.parse(JSON.stringify(net));
    builds.forEach(function (b) { n.sites.forEach(function (s) { if (s.id === b.c.site) s.expansions = (s.expansions || []).concat([{ from: 12 * b.year + b.c.lead, add: b.c.add }]); }); });
    return n;
  }
  function analyse(highs, net, opts, progress) {
    opts = opts || {};
    var cfg = net.config, t0 = Date.now(), o = { mode: opts.mode, hold: opts.hold }, solves = 0, memo = {};
    var say = progress || function () {};
    if (!K.costsOf(cfg).money) return { ok: false, needsMoney: true };
    var plan = function (n) {
      var key = JSON.stringify([n.config.demandScale, n.sites.map(function (s) { return s.expansions || 0; })]);
      if (!memo[key]) { solves++; say(solves); memo[key] = K.solve(highs, n, o); }
      return memo[key];
    };
    var base = plan(net);
    if (!base.ok) return { ok: false, errors: base.errors };
    var lastYear = function (c) { return Math.floor((MONTHS - 1 - c.lead) / 12); };
    // the value of adding c, started in year y, to a plan that already has `builds`, in a network n
    var priced = function (n, ref, builds, c, y) {
      var m = plan(withBuilds(n, builds.concat([{ c: c, year: y }])));
      if (!m.ok) return null;
      var cost = IV.costOf(cfg, c, y);
      return { year: y, npv: IV.gainOf(cfg, ref, m) - cost.capexPV - cost.opexPV, gain: IV.gainOf(cfg, ref, m), tail: IV.tailPV(cfg, ref) - IV.tailPV(cfg, m), capexPV: cost.capexPV, opexPV: cost.opexPV, fill: m.fill, receipt: m.receipt };
    };
    // a candidate gets its verdict only at the end: one that fails now may pay once another site stops being the bottleneck
    var items = [], chosen = [], left = candidatesOf(net).filter(function (c) { return lastYear(c) >= 0 && c.add > 0; }), failed = {}, lastTry = {};
    for (var round = 0; round < ROUNDS && left.length; round++) {
      var ref = plan(withBuilds(net, chosen));
      if (!ref.ok) return { ok: false, errors: ref.errors };
      // the earliest start gives the most capacity, so what it gains is the most this candidate can gain: if that cannot
      // cover even its cheapest (latest) cost, no start can make it pay
      var firsts = left.map(function (c) {
        var p = priced(net, ref, chosen, c, 0), late = IV.costOf(cfg, c, lastYear(c));
        return { c: c, p: p, best: p ? p.gain - late.capexPV - late.opexPV : -Infinity };
      });
      firsts.forEach(function (f) { lastTry[f.c.key] = { npv: f.p ? f.p.npv : null, after: chosen.map(function (b) { return b.c.key; }), proved: !!(f.p && f.p.receipt.proved && ref.receipt.proved), receipts: f.p ? [ref.receipt, f.p.receipt] : [] }; });
      var live = firsts.filter(function (f) { return f.best > 0 && failed[f.c.key] !== chosen.length; }).sort(function (a, b) { return b.p.npv - a.p.npv; });
      if (!live.length) break;
      var top = live[0], curve = {}; curve[0] = top.p;
      var at = function (y) { if (curve[y] === undefined) curve[y] = priced(net, ref, chosen, top.c, y); return curve[y]; };
      GRID.forEach(function (y) { if (y <= lastYear(top.c)) at(y); });
      var bestY = function () { var b = 0; Object.keys(curve).forEach(function (y) { if (curve[y] && curve[y].npv > curve[b].npv) b = +y; }); return b; };
      // the curve rises and then falls, so a walk from the best point on the grid reaches the true best
      for (var w = 0, b0 = bestY(); w < 12; w++) { var moved = false; [b0 - 1, b0 + 1].forEach(function (y) { if (y >= 0 && y <= lastYear(top.c)) at(y); }); var b1 = bestY(); if (b1 !== b0) { b0 = b1; moved = true; } if (!moved) break; }
      var best = curve[b0];
      if (!(best.npv > 0)) { failed[top.c.key] = chosen.length; lastTry[top.c.key] = { npv: best.npv, after: chosen.map(function (b) { return b.c.key; }), proved: best.receipt.proved && ref.receipt.proved, receipts: [ref.receipt, best.receipt] }; round--; continue; }
      left = left.filter(function (c) { return c !== top.c; });
      // the latest start that still keeps nearly all the value, and what one more year would then cost
      var latest = b0;
      while (latest + 1 <= lastYear(top.c)) { var nx = at(latest + 1); if (nx && nx.npv >= best.npv * (1 - NEAR)) latest++; else break; }
      var waitNext = latest + 1 <= lastYear(top.c) && at(latest + 1) ? curve[latest].npv - curve[latest + 1].npv : null;
      var curveOut = function () { return Object.keys(curve).map(Number).sort(function (a, b) { return a - b; }).filter(function (y) { return curve[y]; }).map(function (y) { return { year: y, npv: curve[y].npv }; }); };
      // far off, or paid mostly by the years credited after the horizon: not a decision for today, and not fixed in the plan
      // while nearer decisions are priced, since it would take the value of anything it competes with
      if (b0 >= LATE_YEAR || best.tail > TAIL_SHARE * best.gain) {
        items.push({ group: "watch", reason: "late", kind: "build", key: top.c.key, site: top.c.site, label: top.c.label, capex: top.c.capex, year: b0, npv: best.npv, tailShare: best.gain > 0 ? best.tail / best.gain : 0, after: chosen.map(function (b) { return b.c.key; }), proved: best.receipt.proved && ref.receipt.proved, receipts: [ref.receipt, best.receipt] });
        continue;
      }
      // does it still pay if demand comes in lower?
      var low = JSON.parse(JSON.stringify(net)); low.config.demandScale = (low.config.demandScale || 1) * LOW_DEMAND;
      var lowRef = plan(withBuilds(low, chosen)), lowP = lowRef.ok ? priced(low, lowRef, chosen, top.c, b0) : null;
      // and what it would do on its own, if something else was picked before it
      var alone = chosen.length ? priced(net, base, [], top.c, b0) : null;
      var ok = best.receipt.proved && ref.receipt.proved;
      items.push({ group: !ok || !lowP || lowP.npv <= 0 ? "watch" : latest === 0 ? "now" : "by", kind: "build", key: top.c.key, site: top.c.site, label: top.c.label, capex: top.c.capex, year: b0, readyMonth: 12 * b0 + top.c.lead, latestYear: latest, npv: best.npv, waitNext: waitNext, lowDemandNpv: lowP ? lowP.npv : null, alone: alone ? alone.npv : null,
        after: chosen.map(function (b) { return b.c.key; }), fillAfter: best.fill, proved: ok, curve: curveOut(), receipts: [ref.receipt, best.receipt] });
      chosen.push({ c: top.c, year: b0 });
    }
    left.forEach(function (c) { var t = lastTry[c.key] || { npv: null, after: [], proved: false, receipts: [] }; items.push({ group: "dont", kind: "build", key: c.key, site: c.site, label: c.label, capex: c.capex, npv: t.npv, after: t.after, proved: t.proved, receipts: t.receipts }); });
    // sites worth expanding for which nobody has yet defined an option
    var cv = base.capacityValue.sites, maxV = 0; Object.keys(cv).forEach(function (id) { maxV = Math.max(maxV, cv[id].total); });
    net.sites.forEach(function (s) {
      var x = cv[s.id]; if (!x || x.total <= 0 || x.total < DEFINE_SHARE * maxV || (s.candidates || []).length) return;
      items.push({ group: "now", kind: "define", key: s.id + ":define", site: s.id, valuePer1000: x.total * 1000, proved: base.receipt.proved, receipts: [base.receipt] });
    });
    // shortfalls: which markets carry them, and what they lose
    var wt = IV.weights(cfg);
    Object.keys(base.sites).map(function (id) { return base.sites[id]; }).filter(function (x) { return x.site.tier === "market" && x.fill < FILL_OK; })
      .map(function (x) { var pv = 0; for (var m = 0; m < x.unmet.length; m++) pv += x.unmet[m] * cfg.packValue * wt.disc[Math.floor(m / 12)]; return { x: x, pv: pv }; })
      .sort(function (a, b) { return b.pv - a.pv; }).slice(0, MAX_MARKETS).forEach(function (r) {
        items.push({ group: "watch", kind: "market", key: r.x.site.id + ":short", site: r.x.site.id, fill: r.x.fill, lostPV: r.pv, firstUnmet: r.x.firstUnmet, proved: base.receipt.proved, receipts: [base.receipt] });
      });
    var order = { now: 0, by: 1, watch: 2, dont: 3 }, val = function (i) { return i.npv != null ? i.npv : i.valuePer1000 != null ? i.valuePer1000 : i.lostPV || 0; };
    items.sort(function (a, b) { return order[a.group] - order[b.group] || val(b) - val(a); });
    return { ok: true, items: items, fill: base.fill, receipt: base.receipt, solves: solves, seconds: (Date.now() - t0) / 1000 };
  }
  return { analyse: analyse, candidatesOf: candidatesOf, NEAR: NEAR, LOW_DEMAND: LOW_DEMAND };
});
