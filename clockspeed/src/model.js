// Clockspeed Balancing — the model. A company steered by three strategies that move at different speeds:
//   commercial strategy (price, promotions, product range, service promise, market presence)  — months
//   product supply chain strategy (inventory cover, reserved flexible capacity, dual sourcing)   — a year or two
//   supply chain network strategy (capacity by region: build, close, automate)                   — years
// and the slow, inertial stocks they drag along: operational capability, cross-functional trust, supplier
// relationships, customer perception and expectations, product-range complexity, sunk assets and cash.
//
// Two product segments (F functional: stable, price-sensitive; I innovative: volatile, service- and range-sensitive)
// in three regions. Time in months, Euler integration (dt = 1/4 month); decisions are taken once a quarter.
// Pure functions: the same code runs in the page and in the Node tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Clockspeed = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var VERSION = "0.1.0";
  var SEG = ["F", "I"], REG = ["EU", "AM", "AS"];
  var SEG_NAME = { F: "Functional", I: "Innovative" }, REG_NAME = { EU: "Europe", AM: "Americas", AS: "Asia" };

  // ---- structural parameters (the "aircraft"); decisions are separate
  function defaults() {
    return {
      dt: 0.25, quarters: 80,
      // market
      demand0: { F: { EU: 300, AM: 200, AS: 100 }, I: { EU: 150, AM: 150, AS: 100 } },  // units/month at the start
      baseShare: 0.3,                 // our share of each market at neutral attractiveness
      shareTime: 6,                   // months for customers to move between suppliers
      priceElasticity: { F: 3, I: 1.2 },
      reliabilityWeight: { F: 1.5, I: 3 },    // how much perceived reliability matters
      promiseWeight: { F: 0.4, I: 1.0 },      // how much the offered promise (speed) matters, against what is expected
      rangeWeight: { F: 0.05, I: 0.25 },      // how much product range matters
      promoLift: 0.3, promoPullForward: 0.6, pantryTime: 3,
      perceptionDown: 3, perceptionUp: 12,      // customers notice failures fast, recoveries slowly
      expectationUp: 12, expectationDown: 36,   // expectations of the promise ratchet up fast and come down slowly
      presenceTime: 12,
      // products and operations
      price0: { F: 10, I: 25 },
      unitCost: { EU: 6.5, AM: 5.5, AS: 4 }, segmentCost: { F: 1, I: 1.6 },
      sigma0: { F: 0.1, I: 0.35 },            // demand volatility of each segment
      range0: { F: 100, I: 200 }, rangeLife: 36,   // SKUs, and how long one lives
      complexityDrag: 0.15,                   // capacity lost to set-ups as the range grows
      skuOverhead: 5,                         // overhead per SKU per month
      utilisation0: 0.85,
      fixedCostPerCapacity: 2, autoFixedPremium: 0.5, autoUnitSaving: 0.25,
      holdingRate: 0.03,                      // per month, on unit cost
      flexPremium: 1.5,                       // per unit of reserved flexible capacity per month
      dualPremium: 0.05,                      // share of unit cost
      transportLocal: 0.3, transportImport: 1.5,
      expediteShare: 0.5, expediteCost: 3,    // half of the misses are expedited, at this cost per unit
      missAtFit: 0.05, missSlope: 3,          // 5% of orders miss when responsiveness just meets the requirement
      fit0: 1.05,                             // the company starts a little better than fitted to its strategy
      covRef: 2, flexRef: 0.1,                // weeks of cover and flexible share that count as one unit of responsiveness
      // network
      buildTime: 30, buildCostPerUnit: 60, closeTime: 12, severancePerUnit: 20, depreciationTime: 240,
      autoTime: 18, autoCostPerUnit: 40,
      // product supply chain implementation
      pscTime: 9,
      // organisation
      capabilityUp: 18, capabilityDown: 9, capabilityMax: 0.95, firefightGain: 2.5, changeLoadGain: 0.25,
      promiseDifficulty: 1.5,                 // the requirement grows with promise^this: faster promises need disproportionately more
      promoVolatility: 0.4,                   // promotions make demand lumpier
      trustUp: 24, trustDown: 6,
      supplierUp: 24, supplierDown: 9,
      churnTime: 6
    };
  }

  function decisions0(p) {
    p = p || defaults();
    return {
      commercial: { price: { F: 1, I: 1 }, promo: 0, launches: { F: p.range0.F / p.rangeLife * 3, I: p.range0.I / p.rangeLife * 3 }, rationalize: { F: 0, I: 0 },
        promise: { F: 1, I: 1 }, presence: { EU: 1, AM: 1, AS: 1 } },
      product: { coverage: { F: 3, I: 4 }, flex: { F: 0.05, I: 0.1 }, dual: { F: 0.2, I: 0.2 } },
      network: { expand: { EU: 0, AM: 0, AS: 0 }, close: { EU: 0, AM: 0, AS: 0 }, automate: { EU: 0.2, AM: 0.2, AS: 0.1 } }
    };
  }
  var LIMITS = { price: [0.7, 1.4], promo: [0, 1], launches: [0, 60], rationalize: [0, 0.5], promise: [0.6, 1.6], presence: [0, 1], coverage: [0.5, 12], flex: [0, 0.5], dual: [0, 1], expand: [0, 400], close: [0, 400], automate: [0, 1] };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clampDecisions(d) {
    var c = d.commercial, pr = d.product, n = d.network, lim = function (v, k) { return Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], +v || 0)); };
    SEG.forEach(function (s) { c.price[s] = lim(c.price[s], "price"); c.launches[s] = lim(c.launches[s], "launches"); c.rationalize[s] = lim(c.rationalize[s], "rationalize"); c.promise[s] = lim(c.promise[s], "promise");
      pr.coverage[s] = lim(pr.coverage[s], "coverage"); pr.flex[s] = lim(pr.flex[s], "flex"); pr.dual[s] = lim(pr.dual[s], "dual"); });
    c.promo = lim(c.promo, "promo");
    REG.forEach(function (r) { c.presence[r] = lim(c.presence[r], "presence"); n.expand[r] = lim(n.expand[r], "expand"); n.close[r] = lim(n.close[r], "close"); n.automate[r] = lim(n.automate[r], "automate"); });
    return d;
  }

  // ---- scenarios: exogenous "weather". Each returns multipliers / shifts at month t.
  var smooth = function (t, t0, t1) { return t <= t0 ? 0 : t >= t1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * (t - t0) / (t1 - t0)); };
  var SCENARIOS = {
    calm: { name: "Calm skies", about: "No change in the market: a test of the company's own steering." },
    innovation: { name: "Innovation wave", about: "Demand shifts toward innovative products: +60% from year 2 to year 8, while functional demand falls 20%." },
    asia: { name: "Eastern growth", about: "Asian markets double between year 3 and year 12." },
    promisewar: { name: "Promise war", about: "From year 4 competitors promise faster delivery, and customers come to expect it." },
    storm: { name: "Storm", about: "Europe loses 40% of its supply for ten months in year 5 (dual sourcing softens it), and import tariffs double transport costs from year 6." },
    perfect: { name: "Perfect storm", about: "All of the above." }
  };
  function weather(name, t) {
    var w = { pot: { F: { EU: 1, AM: 1, AS: 1 }, I: { EU: 1, AM: 1, AS: 1 } }, promiseNorm: 0, disruption: { EU: 0, AM: 0, AS: 0 }, tariff: 1 };
    var on = function (k) { return name === k || name === "perfect"; };
    if (on("innovation")) { var m = smooth(t, 24, 96); REG.forEach(function (r) { w.pot.I[r] *= 1 + 0.6 * m; w.pot.F[r] *= 1 - 0.2 * m; }); }
    if (on("asia")) { var a = smooth(t, 36, 144); w.pot.F.AS *= 1 + a; w.pot.I.AS *= 1 + a; }
    if (on("promisewar")) w.promiseNorm = 0.3 * smooth(t, 48, 60);
    if (on("storm")) { if (t >= 48 && t < 58) w.disruption.EU = 0.4; if (t >= 72) w.tariff = 2; }
    return w;
  }

  // ---- the state
  function newState(p) {
    var d0 = decisions0(p), st = { t: 0, q: 0, share: {}, pot: {}, pantry: {}, perceived: {}, expPromise: {}, range: {}, cov: {}, flex: {}, dual: {},
      K: {}, pipe: {}, closing: {}, auto: {}, presence: {}, book: {}, capability: 0.8, trust: 0.9, supplier: 0.8, churn: 0, cash: 0, ref: {} };
    SEG.forEach(function (s) {
      st.share[s] = {}; st.pot[s] = {}; st.pantry[s] = {}; st.perceived[s] = {};
      REG.forEach(function (r) { st.share[s][r] = p.baseShare; st.pot[s][r] = p.demand0[s][r] / p.baseShare; st.pantry[s][r] = 0; st.perceived[s][r] = 1 - p.missAtFit; });
      st.expPromise[s] = d0.commercial.promise[s]; st.range[s] = p.range0[s];
      st.cov[s] = d0.product.coverage[s]; st.flex[s] = d0.product.flex[s]; st.dual[s] = d0.product.dual[s];
    });
    REG.forEach(function (r) {
      var local = SEG.reduce(function (a, s) { return a + p.demand0[s][r]; }, 0);
      st.K[r] = local / p.utilisation0; st.pipe[r] = [0, 0, 0]; st.closing[r] = 0; st.auto[r] = d0.network.automate[r]; st.presence[r] = 1;
      st.book[r] = st.K[r] * p.buildCostPerUnit * 0.5;
    });
    return st;
  }

  // ---- the algebra at one moment: everything that follows from the stocks, decisions and weather
  function aux(p, st, d, w) {
    var o = { D: {}, served: {}, lost: {}, miss: {}, SQ: {}, AR: {}, RR: {}, sigma: {}, attract: {}, target: {}, imports: {}, exportsOut: {}, util: {}, Keff: {}, local: {}, flexCap: {}, sr: {}, impShare: {} };
    var c = d.commercial;
    var Rtot = st.range.F + st.range.I, R0tot = p.range0.F + p.range0.I;
    var complexity = 1 / (1 + p.complexityDrag * (Rtot / R0tot - 1));
    // demand and its attractiveness
    SEG.forEach(function (s) {
      o.D[s] = {}; o.attract[s] = {}; o.target[s] = {};
      o.sigma[s] = p.sigma0[s] * Math.sqrt(st.range[s] / p.range0[s]) * (1 + p.promoVolatility * c.promo);
      REG.forEach(function (r) {
        var priceE = Math.pow(c.price[s], -p.priceElasticity[s]);
        var relyE = Math.pow(Math.max(0.05, st.perceived[s][r]) / st.ref.perceived[s][r], p.reliabilityWeight[s]);
        var promE = Math.pow(c.promise[s] / Math.max(0.3, st.expPromise[s]), p.promiseWeight[s]);
        var rangeE = Math.pow(st.range[s] / p.range0[s], p.rangeWeight[s]);
        var A = priceE * relyE * promE * rangeE;
        o.attract[s][r] = A;
        o.target[s][r] = p.baseShare * A / (p.baseShare * A + (1 - p.baseShare));
        var lift = 1 + p.promoLift * c.promo;
        o.D[s][r] = Math.max(0, st.pot[s][r] * w.pot[s][r] * st.presence[r] * st.share[s][r] * lift - st.pantry[s][r] / p.pantryTime);
      });
    });
    // supply: local capacity (after capability, complexity and disruption) plus reserved flexible capacity, then imports
    var spare = {}, short = {}, totSpare = 0, totShort = 0;
    REG.forEach(function (r) {
      var dis = w.disruption[r] * (1 - 0.7 * (st.dual.F + st.dual.I) / 2);
      o.Keff[r] = st.K[r] * (0.75 + 0.25 * st.capability) * complexity * (1 - dis);
      o.flexCap[r] = SEG.reduce(function (a, s) { return a + st.flex[s] * o.D[s][r] * st.supplier; }, 0);
      o.local[r] = SEG.reduce(function (a, s) { return a + o.D[s][r]; }, 0);
      var avail = o.Keff[r] + o.flexCap[r];
      spare[r] = Math.max(0, avail - o.local[r]); short[r] = Math.max(0, o.local[r] - avail);
      totSpare += spare[r]; totShort += short[r];
    });
    var cover = totShort > 0 ? Math.min(1, totSpare / totShort) : 0, give = totSpare > 0 ? Math.min(1, totShort / totSpare) : 0;
    REG.forEach(function (r) {
      o.imports[r] = short[r] * cover;
      o.exportsOut[r] = spare[r] * give;
      var produced = Math.min(o.local[r], o.Keff[r] + o.flexCap[r]) + o.exportsOut[r];
      o.util[r] = o.Keff[r] > 0 ? Math.min(produced, o.Keff[r]) / o.Keff[r] : 0;
      o.sr[r] = o.local[r] > 0 ? (o.local[r] - short[r] + o.imports[r]) / o.local[r] : 1;
      o.impShare[r] = o.local[r] > 0 ? o.imports[r] / o.local[r] : 0;
    });
    // responsiveness: what the commercial strategy requires against what operations can deliver
    SEG.forEach(function (s) {
      o.miss[s] = {}; o.SQ[s] = {}; o.AR[s] = {}; o.served[s] = {}; o.lost[s] = {};
      o.RR[s] = st.ref.rr[s] * (o.sigma[s] / p.sigma0[s]) * Math.pow(c.promise[s], p.promiseDifficulty);
      REG.forEach(function (r) {
        var locality = 1 - 0.5 * o.impShare[r], congestion = 1 / (1 + 2 * Math.max(0, o.util[r] - 0.85));
        o.AR[s][r] = Math.sqrt(st.capability) * (st.cov[s] / p.covRef + st.flex[s] * st.supplier / p.flexRef) * locality * congestion;
        o.miss[s][r] = Math.min(0.6, p.missAtFit * Math.exp(-p.missSlope * (o.AR[s][r] / o.RR[s] - 1)));
        o.served[s][r] = o.D[s][r] * o.sr[r];
        o.lost[s][r] = o.D[s][r] - o.served[s][r];
        o.SQ[s][r] = o.sr[r] * (1 - o.miss[s][r]);
      });
    });
    // money (per month)
    var rev = 0, prod = 0, fixed = 0, hold = 0, flex = 0, dual = 0, trans = 0, exped = 0, cplx = 0, promo = 0, served = 0, missV = 0, demand = 0;
    REG.forEach(function (r) {
      var uc = p.unitCost[r] * (1 - p.autoUnitSaving * st.auto[r]);
      fixed += st.K[r] * p.fixedCostPerCapacity * (1 + p.autoFixedPremium * st.auto[r]);
      SEG.forEach(function (s) {
        var q = o.served[s][r], cost = uc * p.segmentCost[s];
        rev += q * p.price0[s] * c.price[s] * (1 - 0.15 * c.promo);
        promo += q * p.price0[s] * c.price[s] * 0.15 * c.promo;
        prod += q * cost;
        hold += st.cov[s] / 4.33 * o.D[s][r] * cost * p.holdingRate;
        flex += st.flex[s] * o.D[s][r] * p.flexPremium;
        dual += st.dual[s] * q * cost * p.dualPremium;
        var impQ = q * o.impShare[r] / Math.max(1e-9, o.sr[r]);
        trans += (q - impQ) * p.transportLocal + impQ * p.transportImport * w.tariff;
        exped += o.miss[s][r] * q * p.expediteShare * p.expediteCost;
        served += q; missV += o.miss[s][r] * q; demand += o.D[s][r];
      });
    });
    cplx = Rtot * p.skuOverhead;
    o.money = { revenue: rev, promoDiscount: promo, production: prod, fixed: fixed, holding: hold, flex: flex, dual: dual, transport: trans, expediting: exped, complexity: cplx };
    o.cost = prod + fixed + hold + flex + dual + trans + exped + cplx;
    o.profit = rev - o.cost;
    o.demand = demand; o.served_total = served;
    o.missRate = served > 0 ? missV / served : 0;
    o.expediteLoad = served > 0 ? exped / (served * p.expediteCost) : 0;
    o.complexity = complexity;
    return o;
  }

  // organisational pressure: firefighting from misses and expediting, and the load of change in progress
  function pressures(p, st, d, o, changeLoad) {
    var ff = Math.min(0.9, p.firefightGain * (o.expediteLoad + 0.5 * o.missRate) + p.changeLoadGain * changeLoad);
    return { firefight: ff, capTarget: p.capabilityMax * Math.sqrt(1 - ff),
      trustTarget: Math.max(0.2, Math.min(1, 1 - 2.5 * o.missRate - 0.6 * st.churn)),
      supplierTarget: Math.max(0.2, Math.min(1, 0.95 - 3 * o.expediteLoad - 0.15 * d.commercial.promo + 0.1 * (st.dual.F + st.dual.I) / 2)) };
  }
  var asym = function (cur, target, up, down) { return (target - cur) / (target > cur ? up : down); };

  // one Euler step of length dt
  function step(p, st, d, w) {
    var dt = p.dt, o = aux(p, st, d, w), c = d.commercial;
    // change load: how much of the strategy is still being implemented
    var pscGap = SEG.reduce(function (a, s) { return a + Math.abs(d.product.coverage[s] - st.cov[s]) / 4 + Math.abs(d.product.flex[s] - st.flex[s]) * 5 + Math.abs(d.product.dual[s] - st.dual[s]); }, 0);
    var netLoad = REG.reduce(function (a, r) { return a + (st.pipe[r][0] + st.pipe[r][1] + st.pipe[r][2] + st.closing[r]) / Math.max(1, st.K[r]) + Math.abs(d.network.automate[r] - st.auto[r]); }, 0);
    var changeLoad = pscGap / 2 + netLoad / 3;
    var pr = pressures(p, st, d, o, changeLoad);
    o.firefight = pr.firefight; o.changeLoad = changeLoad;
    // market
    SEG.forEach(function (s) {
      REG.forEach(function (r) {
        st.share[s][r] += (o.target[s][r] - st.share[s][r]) / p.shareTime * dt;
        var extra = st.pot[s][r] * w.pot[s][r] * st.presence[r] * st.share[s][r] * p.promoLift * c.promo;
        st.pantry[s][r] += (p.promoPullForward * extra - st.pantry[s][r] / p.pantryTime) * dt;
        st.perceived[s][r] += asym(st.perceived[s][r], o.SQ[s][r], p.perceptionUp, p.perceptionDown) * dt;
      });
      // customers come to expect the best promise on offer: ours, or the competitors' when they promise more
      var norm = Math.max(c.promise[s], 1 + w.promiseNorm);
      st.expPromise[s] += asym(st.expPromise[s], norm, p.expectationUp, p.expectationDown) * dt;
      // product range: launches spread over the quarter; retirements by age and rationalisation
      var launch = c.launches[s] / 3, retire = st.range[s] / p.rangeLife + c.rationalize[s] * st.range[s] / 12;
      st.range[s] += (launch - retire) * dt;
      o["launch_" + s] = launch; o["retire_" + s] = retire;
      // product supply chain: actual configuration chases the decided one, faster with capability and trust
      var tau = p.pscTime / ((0.5 + 0.5 * st.capability) * (0.5 + 0.5 * st.trust));
      st.cov[s] += (d.product.coverage[s] - st.cov[s]) / tau * dt;
      st.flex[s] += (d.product.flex[s] - st.flex[s]) / tau * dt;
      st.dual[s] += (d.product.dual[s] - st.dual[s]) / tau * dt;
    });
    // network
    var capex = 0, writeoff = 0, k = 3 / p.buildTime;
    o.completed = {}; o.closed = {};
    REG.forEach(function (r) {
      var pp = st.pipe[r], o0 = pp[0] * k, o1 = pp[1] * k, o2 = pp[2] * k;
      pp[0] += -o0 * dt; pp[1] += (o0 - o1) * dt; pp[2] += (o1 - o2) * dt;
      var closeRate = Math.min(st.closing[r] / p.closeTime, st.K[r] / p.closeTime);
      st.K[r] += (o2 - closeRate) * dt;
      st.closing[r] -= closeRate * dt;
      st.book[r] += (o2 * p.buildCostPerUnit - st.book[r] / p.depreciationTime) * dt;
      capex += (o0 + o1 + o2) / 3 * p.buildCostPerUnit;   // paid as the work progresses
      var autoRate = (d.network.automate[r] - st.auto[r]) / p.autoTime;
      if (autoRate > 0) capex += autoRate * st.K[r] * p.autoCostPerUnit;
      st.auto[r] += autoRate * dt;
      st.presence[r] += (c.presence[r] - st.presence[r]) / p.presenceTime * dt;
      o.completed[r] = o2; o.closed[r] = closeRate;
    });
    // organisation
    st.capability += asym(st.capability, pr.capTarget, p.capabilityUp, p.capabilityDown) * dt;
    st.trust += asym(st.trust, pr.trustTarget, p.trustUp, p.trustDown) * dt;
    st.supplier += asym(st.supplier, pr.supplierTarget, p.supplierUp, p.supplierDown) * dt;
    st.churn += (-st.churn / p.churnTime) * dt;
    st.cash += (o.profit - capex) * dt;
    st.t += dt;
    o.capex = capex;
    return o;
  }

  // a quarter's decisions take effect at its start: orders, closures and the commercial churn they cause
  function applyQuarter(p, st, d, prev) {
    var c = d.commercial;
    REG.forEach(function (r) {
      if (d.network.expand[r] > 0) st.pipe[r][0] += d.network.expand[r];
      if (d.network.close[r] > 0) {
        var avail = Math.max(0, st.K[r] - st.closing[r]), cut = Math.min(d.network.close[r], avail);
        if (cut > 0) {
          var share = cut / st.K[r], wo = st.book[r] * share;
          st.book[r] -= wo; st.closing[r] += cut;
          st.cash -= wo * 0 + cut * p.severancePerUnit;     // severance is cash; the write-off is a book loss
          st.writeoffs = (st.writeoffs || 0) + wo; st.severance = (st.severance || 0) + cut * p.severancePerUnit;
        }
      }
    });
    if (prev) {
      var ch = 0;
      SEG.forEach(function (s) { ch += Math.abs(c.price[s] - prev.commercial.price[s]) * 2 + Math.abs(c.promise[s] - prev.commercial.promise[s]) * 2 + Math.abs(c.launches[s] - prev.commercial.launches[s]) / (p.range0[s] / p.rangeLife * 3) * 0.3; });
      ch += Math.abs(c.promo - prev.commercial.promo);
      st.churn += ch;
    }
  }

  // settle the organisation and customers into the steady state of the starting strategy (market held still)
  function spinUp(p, st) {
    var d = decisions0(p), w = weather("calm", 0);
    st.ref.perceived = {}; SEG.forEach(function (s) { st.ref.perceived[s] = {}; REG.forEach(function (r) { st.ref.perceived[s][r] = st.perceived[s][r]; }); });
    st.ref.rr = { F: 1, I: 1 };
    // calibrate the requirement so the starting configuration fits its strategy (AR/RR = fit0, demand-weighted)
    var o = aux(p, st, d, w);
    SEG.forEach(function (s) { var num = 0, den = 0; REG.forEach(function (r) { num += o.AR[s][r] * o.D[s][r]; den += o.D[s][r]; }); st.ref.rr[s] = (num / den) / p.fit0 / ((o.sigma[s] / p.sigma0[s]) * 1); });
    var share = clone(st.share), pot = clone(st.pot);
    for (var i = 0; i < 4000; i++) {
      step(p, st, d, w);
      st.share = clone(share); st.pot = clone(pot);
      // re-anchor the customers' reference to what they now perceive, so the market stays at the start
      SEG.forEach(function (s) { REG.forEach(function (r) { st.ref.perceived[s][r] = st.perceived[s][r]; }); });
      SEG.forEach(function (s) { var num = 0, den = 0, oo = aux(p, st, d, w); REG.forEach(function (r) { num += oo.AR[s][r] * oo.D[s][r]; den += oo.D[s][r]; }); st.ref.rr[s] = (num / den) / p.fit0; });
    }
    st.t = 0; st.cash = 0; st.churn = 0; st.writeoffs = 0; st.severance = 0;
    REG.forEach(function (r) { st.book[r] = st.K[r] * p.buildCostPerUnit * 0.5; });
    return st;
  }

  var SERIES = ["t", "demand", "served", "revenue", "cost", "profit", "cash", "missRate", "reliability", "capability", "trust", "supplier", "firefight", "changeLoad",
    "rangeF", "rangeI", "covF", "covI", "flexF", "flexI", "dualF", "dualI", "capacity", "pipeline", "utilisation", "expPromiseF", "expPromiseI", "perceivedF", "perceivedI",
    "fitProduct", "fitNetwork", "fitCommercial", "imports", "expediting", "capex", "lost", "complexity", "book"];

  // the simulator: create it, then call quarter(decisions) up to p.quarters times
  function create(params, scenario) {
    var p = Object.assign(defaults(), params || {});
    var st = spinUp(p, newState(p)), prev = null, hist = { months: [], quarters: [] }, sc = scenario || "calm";
    var totals = { launches: { F: 0, I: 0 }, retirements: { F: 0, I: 0 }, completed: 0, closed: 0, ordered: 0, profit: 0, capex: 0, demand: 0, served: 0 };
    var rangeStart = clone(st.range), Kstart = REG.reduce(function (a, r) { return a + st.K[r]; }, 0);
    function record(o, w) {
      var row = { t: st.t, q: st.q };
      var Ktot = 0, pipe = 0, util = 0, imp = 0, utilW = 0;
      REG.forEach(function (r) { Ktot += st.K[r]; pipe += st.pipe[r][0] + st.pipe[r][1] + st.pipe[r][2]; util += o.util[r] * o.Keff[r]; utilW += o.Keff[r]; imp += o.imports[r]; });
      var demandW = { F: 0, I: 0 }, perc = { F: 0, I: 0 }, fitP = 0, fitPw = 0;
      SEG.forEach(function (s) { REG.forEach(function (r) { demandW[s] += o.D[s][r]; perc[s] += st.perceived[s][r] * o.D[s][r]; fitP += Math.min(1, o.AR[s][r] / o.RR[s]) * o.D[s][r]; fitPw += o.D[s][r]; }); });
      var fitN = 0, fitNw = 0;
      REG.forEach(function (r) { var need = o.local[r] / p.utilisation0; fitN += Math.min(1, (o.Keff[r] + o.flexCap[r]) / Math.max(1e-9, need)) * (1 - 0.5 * o.impShare[r]) * o.local[r]; fitNw += o.local[r]; });
      var fitC = SEG.reduce(function (a, s) { return a + Math.min(1, (perc[s] / Math.max(1e-9, demandW[s])) / (1 - p.missAtFit)) * demandW[s]; }, 0) / Math.max(1e-9, demandW.F + demandW.I);
      Object.assign(row, { demand: o.demand, served: o.served_total, revenue: o.money.revenue, cost: o.cost, profit: o.profit, cash: st.cash, missRate: o.missRate,
        reliability: o.served_total > 0 ? SEG.reduce(function (a, s) { return a + REG.reduce(function (b, r) { return b + o.SQ[s][r] * o.D[s][r]; }, 0); }, 0) / Math.max(1e-9, o.demand) : 1,
        capability: st.capability, trust: st.trust, supplier: st.supplier, firefight: o.firefight || 0, changeLoad: o.changeLoad || 0,
        rangeF: st.range.F, rangeI: st.range.I, covF: st.cov.F, covI: st.cov.I, flexF: st.flex.F, flexI: st.flex.I, dualF: st.dual.F, dualI: st.dual.I,
        capacity: Ktot, pipeline: pipe, utilisation: utilW > 0 ? util / utilW : 0, expPromiseF: st.expPromise.F, expPromiseI: st.expPromise.I,
        perceivedF: perc.F / Math.max(1e-9, demandW.F), perceivedI: perc.I / Math.max(1e-9, demandW.I),
        fitProduct: fitP / Math.max(1e-9, fitPw), fitNetwork: fitN / Math.max(1e-9, fitNw), fitCommercial: fitC, imports: imp, expediting: o.money.expediting,
        capex: o.capex || 0, lost: o.demand - o.served_total, complexity: o.complexity, book: REG.reduce(function (a, r) { return a + st.book[r]; }, 0) });
      row.detail = { D: clone(o.D), K: clone(st.K), Keff: clone(o.Keff), imports: clone(o.imports), exportsOut: clone(o.exportsOut), util: clone(o.util), SQ: clone(o.SQ), share: clone(st.share), money: clone(o.money) };
      return row;
    }
    var sim = {
      params: p, scenario: sc, state: st, history: hist, totals: totals,
      start: { range: rangeStart, capacity: Kstart, cash: 0 },
      done: function () { return st.q >= p.quarters; },
      // the standing decisions carry over from quarter to quarter; capacity orders and closures are one-off acts
      decisions: function () { var d = prev ? clone(prev) : decisions0(p); REG.forEach(function (r) { d.network.expand[r] = 0; d.network.close[r] = 0; }); return d; },
      quarter: function (dec) {
        if (st.q >= p.quarters) throw new Error("the simulation has ended");
        var d = clampDecisions(clone(dec || sim.decisions()));
        applyQuarter(p, st, d, prev);
        REG.forEach(function (r) { totals.ordered += d.network.expand[r]; });
        var steps = Math.round(3 / p.dt), qProfit = 0, qRev = 0, last = null;
        for (var i = 0; i < steps; i++) {
          var w = weather(sc, st.t), o = step(p, st, d, w);
          SEG.forEach(function (s) { totals.launches[s] += o["launch_" + s] * p.dt; totals.retirements[s] += o["retire_" + s] * p.dt; });
          REG.forEach(function (r) { totals.completed += o.completed[r] * p.dt; totals.closed += o.closed[r] * p.dt; });
          totals.profit += o.profit * p.dt; totals.capex += o.capex * p.dt; totals.demand += o.demand * p.dt; totals.served += o.served_total * p.dt;
          qProfit += o.profit * p.dt; qRev += o.money.revenue * p.dt;
          if ((i + 1) % Math.round(1 / p.dt) === 0) { var oo = aux(p, st, d, weather(sc, st.t)); oo.firefight = o.firefight; oo.changeLoad = o.changeLoad; oo.capex = o.capex; hist.months.push(record(oo)); }
          last = o;
        }
        st.q++;
        var qrow = hist.months[hist.months.length - 1];
        hist.quarters.push({ q: st.q, decisions: d, profit: qProfit, revenue: qRev, end: qrow });
        prev = d;
        return qrow;
      }
    };
    return sim;
  }

  // run a whole game with a policy: policy(sim, q) returns the decisions for quarter q (0-based)
  function run(params, scenario, policy) {
    var sim = create(params, scenario);
    while (!sim.done()) sim.quarter(policy ? policy(sim, sim.state.q) : undefined);
    return sim;
  }

  return { VERSION: VERSION, SEG: SEG, REG: REG, SEG_NAME: SEG_NAME, REG_NAME: REG_NAME, defaults: defaults, decisions0: decisions0, LIMITS: LIMITS, clampDecisions: clampDecisions,
    SCENARIOS: SCENARIOS, weather: weather, create: create, run: run, SERIES: SERIES, clone: clone, _aux: aux };
});
