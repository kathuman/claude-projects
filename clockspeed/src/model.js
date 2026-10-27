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
//
// 1.2 makes the tension real, so that no strategy set once in the first quarter beats steering: competitors match
// price cuts but not rises; customers punish unreliability more than they reward reliability beyond what they are
// used to; innovative stock goes obsolete and extra cover has diminishing returns; automation makes capacity rigid;
// money is discounted (NPV) and negative cash pays interest; firefighting can tip capability into a trap, and an
// improvement programme can pull it out. With a seed, the weather's timing and size are drawn from a range and demand
// is noisy; without one the central path is run, exactly and repeatably.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Clockspeed = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var VERSION = "1.2.0";
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
      priceElasticity: { F: 4.5, I: 3 },      // against the competitors' price
      compFollowTime: 6, compRecoverTime: 36, // competitors match a cut within months, and drift back up slowly
      reliabilityWeight: { F: 1.5, I: 3 },    // how much perceived reliability matters when it falls short
      reliabilityGain: 0.25,                  // …and the share of that weight it earns above what customers are used to
      promiseWeight: { F: 0.4, I: 1.0 },      // how much the offered promise (speed) matters, against what is expected
      rangeWeight: { F: 0.12, I: 0.35 },      // how much product range matters
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
      skuOverhead: { F: 2, I: 6 },            // overhead per SKU per month
      utilisation0: 0.85,
      fixedCostPerCapacity: 2, autoFixedPremium: 0.5, autoUnitSaving: 0.25,
      autoRigidity: { F: 0.05, I: 0.25 },      // responsiveness lost per unit of automation: dedicated lines suit stable products
      holdingRate: 0.03,                      // per month, on unit cost
      obsolescence: { F: 0.005, I: 0.04 },    // per month: innovative stock dates fast
      coverSat: { F: 6, I: 3 },               // weeks: beyond this, more cover buys little responsiveness
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
      capabilityMin: 0.25, capabilityGamma: 2,     // capability target = min + (max − min) × (1 − firefighting)^gamma
      stallGain: 3, stallAt: 0.3,             // firefighting crowds out improvement: building slows as it nears stallAt
      improveCost: 600, improveCapacity: 0.05, improveShield: 0.5, improveSpeed: 1,   // the improvement programme at full intensity
      // money
      discountRate: 0.08, borrowRate: 0.12,   // per year
      // uncertainty, used only when the simulator has a seed
      noiseSd: { F: 0.03, I: 0.1 }, noiseTime: 3,
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
      product: { coverage: { F: 3, I: 4 }, flex: { F: 0.05, I: 0.1 }, dual: { F: 0.2, I: 0.2 }, improve: 0 },
      network: { expand: { EU: 0, AM: 0, AS: 0 }, close: { EU: 0, AM: 0, AS: 0 }, automate: { EU: 0.2, AM: 0.2, AS: 0.1 } }
    };
  }
  var LIMITS = { price: [0.7, 1.4], promo: [0, 1], launches: [0, 60], rationalize: [0, 0.5], promise: [0.6, 1.6], presence: [0, 1], coverage: [0.5, 12], flex: [0, 0.5], dual: [0, 1], expand: [0, 400], close: [0, 400], automate: [0, 1], improve: [0, 1] };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clampDecisions(d) {
    var c = d.commercial, pr = d.product, n = d.network, lim = function (v, k) { return Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], +v || 0)); };
    SEG.forEach(function (s) { c.price[s] = lim(c.price[s], "price"); c.launches[s] = lim(c.launches[s], "launches"); c.rationalize[s] = lim(c.rationalize[s], "rationalize"); c.promise[s] = lim(c.promise[s], "promise");
      pr.coverage[s] = lim(pr.coverage[s], "coverage"); pr.flex[s] = lim(pr.flex[s], "flex"); pr.dual[s] = lim(pr.dual[s], "dual"); });
    c.promo = lim(c.promo, "promo"); pr.improve = lim(pr.improve, "improve");
    REG.forEach(function (r) { c.presence[r] = lim(c.presence[r], "presence"); n.expand[r] = lim(n.expand[r], "expand"); n.close[r] = lim(n.close[r], "close"); n.automate[r] = lim(n.automate[r], "automate"); });
    return d;
  }

  // ---- scenarios: exogenous "weather". Each has a central path and, for a seeded flight, a range it is drawn from.
  var smooth = function (t, t0, t1) { return t <= t0 ? 0 : t >= t1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * (t - t0) / (t1 - t0)); };
  var SCENARIOS = {
    calm: { name: "Calm skies", about: "No change in the market: a test of the company's own steering." },
    innovation: { name: "Innovation wave", about: "Demand shifts from functional to innovative products, starting in year 2 to 4 and taking 5 to 8 years, and innovative demand grows half as volatile again. The total stays about the same." },
    asia: { name: "Eastern growth", about: "Asian markets grow by 60% to 140%, starting in year 3 to 5 and taking 8 to 10 years." },
    promisewar: { name: "Promise war", about: "In year 4 to 6 competitors start promising 20% to 40% faster delivery, and customers come to expect it." },
    storm: { name: "Storm", about: "In year 4 to 7 Europe loses 30% to 50% of its supply for 6 to 14 months (dual sourcing softens it); in year 6 to 9 tariffs raise the cost of moving goods between regions by 60% to 140%." },
    perfect: { name: "Perfect storm", about: "All of the above." }
  };
  // a small seeded generator (mulberry32), so a flight is replayed exactly from its seed
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // the weather's parameters (months and sizes): the central path, or a draw from each range
  function weatherDraw(seed) {
    var c = { innoStart: 24, innoLen: 72, innoShift: 0.45, asiaStart: 36, asiaLen: 108, asiaGrowth: 1, warStart: 48, warNorm: 0.3,
      stormStart: 48, stormLen: 10, stormSize: 0.4, tariffStart: 72, tariff: 2 };
    if (seed == null) return c;
    var u = rng(seed * 7919 + 17), between = function (a, b) { return a + (b - a) * u(); }, months = function (a, b) { return Math.round(between(a, b)); };
    return { innoStart: months(12, 36), innoLen: months(60, 96), innoShift: between(0.3, 0.6), asiaStart: months(24, 48), asiaLen: months(96, 120), asiaGrowth: between(0.6, 1.4),
      warStart: months(36, 60), warNorm: between(0.2, 0.4), stormStart: months(36, 72), stormLen: months(6, 14), stormSize: between(0.3, 0.5),
      tariffStart: months(60, 96), tariff: between(1.6, 2.4) };
  }
  function weather(name, t, wp) {
    wp = wp || weatherDraw();
    var w = { pot: { F: { EU: 1, AM: 1, AS: 1 }, I: { EU: 1, AM: 1, AS: 1 } }, promiseNorm: 0, disruption: { EU: 0, AM: 0, AS: 0 }, tariff: 1, volatility: { F: 1, I: 1 } };
    var on = function (k) { return name === k || name === "perfect"; };
    // the shift keeps the total: functional loses what innovative gains (600 F against 400 I units at the start)
    if (on("innovation")) { var m = smooth(t, wp.innoStart, wp.innoStart + wp.innoLen); REG.forEach(function (r) { w.pot.I[r] *= 1 + wp.innoShift * m; w.pot.F[r] *= 1 - wp.innoShift * m * 400 / 600; }); w.volatility.I = 1 + 0.5 * m; }
    if (on("asia")) { var a = smooth(t, wp.asiaStart, wp.asiaStart + wp.asiaLen); w.pot.F.AS *= 1 + wp.asiaGrowth * a; w.pot.I.AS *= 1 + wp.asiaGrowth * a; }
    if (on("promisewar")) w.promiseNorm = wp.warNorm * smooth(t, wp.warStart, wp.warStart + 12);
    if (on("storm")) { if (t >= wp.stormStart && t < wp.stormStart + wp.stormLen) w.disruption.EU = wp.stormSize; if (t >= wp.tariffStart) w.tariff = wp.tariff; }
    return w;
  }
  // what happens when, in words: [month, kind, text]
  function events(name, wp) {
    wp = wp || weatherDraw();
    var on = function (k) { return name === k || name === "perfect"; }, ev = [], pc = function (x) { return Math.round(x * 100) + "%"; };
    if (on("innovation")) ev.push([wp.innoStart, "info", "The market begins to shift from functional toward innovative products."]);
    if (on("asia")) ev.push([wp.asiaStart, "info", "Asian demand starts to grow fast."]);
    if (on("promisewar")) ev.push([wp.warStart, "warn", "Competitors start promising faster delivery. Customers will come to expect it."]);
    if (on("storm")) ev.push([wp.stormStart, "bad", "A supply disruption hits Europe: " + pc(wp.stormSize) + " of its supply is lost."], [wp.stormStart + wp.stormLen, "good", "The European disruption is over."],
      [wp.tariffStart, "warn", "Import tariffs raise the cost of moving goods between regions by " + pc(wp.tariff - 1) + "."]);
    return ev.sort(function (a, b) { return a[0] - b[0]; });
  }

  // ---- the state
  function newState(p) {
    var d0 = decisions0(p), st = { t: 0, q: 0, share: {}, pot: {}, pantry: {}, perceived: {}, expPromise: {}, range: {}, cov: {}, flex: {}, dual: {},
      K: {}, pipe: {}, closing: {}, auto: {}, presence: {}, book: {}, capability: 0.8, trust: 0.9, supplier: 0.8, churn: 0, cash: 0, ref: {}, compPrice: { F: 1, I: 1 }, noise: {} };
    SEG.forEach(function (s) {
      st.share[s] = {}; st.pot[s] = {}; st.pantry[s] = {}; st.perceived[s] = {};
      st.noise[s] = { EU: 0, AM: 0, AS: 0 };
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
      o.sigma[s] = p.sigma0[s] * w.volatility[s] * Math.sqrt(st.range[s] / p.range0[s]) * (1 + p.promoVolatility * c.promo);
      REG.forEach(function (r) {
        var priceE = Math.pow(c.price[s] / st.compPrice[s], -p.priceElasticity[s]);
        var rel = Math.max(0.05, st.perceived[s][r]) / st.ref.perceived[s][r];
        var relyE = Math.pow(rel, p.reliabilityWeight[s] * (rel > 1 ? p.reliabilityGain : 1));
        var promE = Math.pow(c.promise[s] / Math.max(0.3, st.expPromise[s]), p.promiseWeight[s]);
        var rangeE = Math.pow(st.range[s] / p.range0[s], p.rangeWeight[s]);
        var A = priceE * relyE * promE * rangeE;
        o.attract[s][r] = A;
        o.target[s][r] = p.baseShare * A / (p.baseShare * A + (1 - p.baseShare));
        var lift = 1 + p.promoLift * c.promo;
        o.D[s][r] = Math.max(0, st.pot[s][r] * w.pot[s][r] * (1 + st.noise[s][r]) * st.presence[r] * st.share[s][r] * lift - st.pantry[s][r] / p.pantryTime);
      });
    });
    // supply: local capacity (after capability, complexity and disruption) plus reserved flexible capacity, then imports
    var spare = {}, short = {}, totSpare = 0, totShort = 0;
    REG.forEach(function (r) {
      var dis = w.disruption[r] * (1 - 0.7 * (st.dual.F + st.dual.I) / 2);
      o.Keff[r] = st.K[r] * (0.75 + 0.25 * st.capability) * complexity * (1 - dis) * (1 - p.improveCapacity * d.product.improve);
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
        var covEff = p.coverSat[s] * (1 - Math.exp(-st.cov[s] / p.coverSat[s]));
        o.AR[s][r] = Math.sqrt(st.capability) * (covEff / p.covRef + st.flex[s] * st.supplier / p.flexRef) * locality * congestion * (1 - p.autoRigidity[s] * st.auto[r]);
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
        hold += st.cov[s] / 4.33 * o.D[s][r] * cost * (p.holdingRate + p.obsolescence[s]);
        flex += st.flex[s] * o.D[s][r] * p.flexPremium;
        dual += st.dual[s] * q * cost * p.dualPremium;
        var impQ = q * o.impShare[r] / Math.max(1e-9, o.sr[r]);
        trans += (q - impQ) * p.transportLocal + impQ * p.transportImport * w.tariff;
        exped += o.miss[s][r] * q * p.expediteShare * p.expediteCost;
        served += q; missV += o.miss[s][r] * q; demand += o.D[s][r];
      });
    });
    cplx = st.range.F * p.skuOverhead.F + st.range.I * p.skuOverhead.I;
    var improve = p.improveCost * d.product.improve;
    o.money = { revenue: rev, promoDiscount: promo, production: prod, fixed: fixed, holding: hold, flex: flex, dual: dual, transport: trans, expediting: exped, complexity: cplx, improvement: improve };
    o.cost = prod + fixed + hold + flex + dual + trans + exped + cplx + improve;
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
    var shielded = ff * (1 - p.improveShield * d.product.improve);   // an improvement programme protects time for improving
    return { firefight: ff, shielded: shielded, capTarget: p.capabilityMin + (p.capabilityMax - p.capabilityMin) * Math.pow(1 - shielded, p.capabilityGamma),
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
      // competitors match a price cut, and drift back toward the old price level when we are no cheaper
      st.compPrice[s] += (c.price[s] < st.compPrice[s] ? (c.price[s] - st.compPrice[s]) / p.compFollowTime : (Math.min(1, c.price[s]) - st.compPrice[s]) / p.compRecoverTime) * dt;
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
    // firefighting crowds out the time to improve: building slows as it nears stallAt; a programme speeds it up
    var stall = Math.min(0.95, pr.shielded / p.stallAt), build = p.capabilityUp * (1 + p.stallGain * stall / (1 - stall)) / (1 + p.improveSpeed * d.product.improve);
    st.capability += asym(st.capability, pr.capTarget, build, p.capabilityDown) * dt;
    st.trust += asym(st.trust, pr.trustTarget, p.trustUp, p.trustDown) * dt;
    st.supplier += asym(st.supplier, pr.supplierTarget, p.supplierUp, p.supplierDown) * dt;
    st.churn += (-st.churn / p.churnTime) * dt;
    var interest = st.cash < 0 ? -st.cash * p.borrowRate / 12 : 0;
    st.cash += (o.profit - capex - interest) * dt;
    st.t += dt;
    o.capex = capex; o.interest = interest;
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

  // the settled starting state depends only on the parameters, so it is worked out once for each set of them
  var spun = {};
  function startState(p) { var key = JSON.stringify(p); if (!spun[key]) spun[key] = spinUp(p, newState(p)); return clone(spun[key]); }

  // the simulator: create it, then call quarter(decisions) up to p.quarters times. With a seed (an integer), the
  // weather is drawn from its ranges and demand is noisy; without one, the central path is flown without noise.
  function create(params, scenario, seed) {
    var p = Object.assign(defaults(), params || {});
    var st = startState(p), prev = null, hist = { months: [], quarters: [] }, sc = scenario || "calm";
    var wp = weatherDraw(seed), noisy = seed != null, u = noisy ? rng(seed) : null, spare = null;
    var gauss = function () { if (spare != null) { var g = spare; spare = null; return g; } var a = Math.max(1e-12, u()), b = u(), m = Math.sqrt(-2 * Math.log(a)); spare = m * Math.sin(2 * Math.PI * b); return m * Math.cos(2 * Math.PI * b); };
    var rho = Math.exp(-1 / p.noiseTime);
    var totals = { launches: { F: 0, I: 0 }, retirements: { F: 0, I: 0 }, completed: 0, closed: 0, ordered: 0, profit: 0, capex: 0, interest: 0, demand: 0, served: 0, npv: 0 };
    var disc = function (t) { return Math.exp(-p.discountRate * t / 12); };
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
      params: p, scenario: sc, seed: noisy ? seed : null, weatherParams: wp, events: events(sc, wp), state: st, history: hist, totals: totals,
      start: { range: rangeStart, capacity: Kstart, cash: 0 },
      done: function () { return st.q >= p.quarters; },
      // the standing decisions carry over from quarter to quarter; capacity orders and closures are one-off acts
      decisions: function () { var d = prev ? clone(prev) : decisions0(p); REG.forEach(function (r) { d.network.expand[r] = 0; d.network.close[r] = 0; }); return d; },
      quarter: function (dec) {
        if (st.q >= p.quarters) throw new Error("the simulation has ended");
        var d = clampDecisions(clone(dec || sim.decisions()));
        var sev0 = st.severance || 0;
        applyQuarter(p, st, d, prev);
        totals.npv -= ((st.severance || 0) - sev0) * disc(st.t);
        REG.forEach(function (r) { totals.ordered += d.network.expand[r]; });
        var steps = Math.round(3 / p.dt), qProfit = 0, qRev = 0, last = null;
        for (var i = 0; i < steps; i++) {
          // demand noise moves once a month: AR(1) with a correlation time of noiseTime months
          if (noisy && i % Math.round(1 / p.dt) === 0) SEG.forEach(function (s) { REG.forEach(function (r) { st.noise[s][r] = Math.max(-0.5, rho * st.noise[s][r] + Math.sqrt(1 - rho * rho) * p.noiseSd[s] * gauss()); }); });
          var t0 = st.t, w = weather(sc, st.t, wp), o = step(p, st, d, w);
          totals.interest += o.interest * p.dt; totals.npv += (o.profit - o.capex - o.interest) * p.dt * disc(t0 + p.dt / 2);
          SEG.forEach(function (s) { totals.launches[s] += o["launch_" + s] * p.dt; totals.retirements[s] += o["retire_" + s] * p.dt; });
          REG.forEach(function (r) { totals.completed += o.completed[r] * p.dt; totals.closed += o.closed[r] * p.dt; });
          totals.profit += o.profit * p.dt; totals.capex += o.capex * p.dt; totals.demand += o.demand * p.dt; totals.served += o.served_total * p.dt;
          qProfit += o.profit * p.dt; qRev += o.money.revenue * p.dt;
          if ((i + 1) % Math.round(1 / p.dt) === 0) { var oo = aux(p, st, d, weather(sc, st.t, wp)); oo.firefight = o.firefight; oo.changeLoad = o.changeLoad; oo.capex = o.capex; hist.months.push(record(oo)); }
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
  function run(params, scenario, policy, seed) {
    var sim = create(params, scenario, seed);
    while (!sim.done()) sim.quarter(policy ? policy(sim, sim.state.q) : undefined);
    return sim;
  }

  // ---- the debrief. Which clock made or cost the money? Every flight is replayed with only some of its three strategy
  // levels moving (the others held at the starting course), in the flight's own weather (its seed), and the gap in net
  // present value against holding the starting course is split between the three levels by their Shapley values: each
  // level's average marginal contribution over every order in which the levels could have been added. The three parts
  // add up exactly to the gap.
  var GROUPS = ["commercial", "product", "network"];
  var CLOCK_MONTHS = { commercial: 6, product: 11, network: 33 };   // time to 63% of the effect, as tested
  function mask(p, d, keep) {
    var d0 = decisions0(p), out = clone(d0);
    GROUPS.forEach(function (g) { if (keep[g]) out[g] = clone(d[g]); });
    if (!keep.network) REG.forEach(function (r) { out.network.expand[r] = 0; out.network.close[r] = 0; });
    return out;
  }
  function replay(params, scenario, decisions, keep, seed) {
    var sim = create(params, scenario, seed), n = Math.min(decisions.length, sim.params.quarters);
    for (var q = 0; q < n; q++) sim.quarter(mask(sim.params, decisions[q], keep));
    return sim;
  }
  function changed(a, b) { return JSON.stringify(a) !== JSON.stringify(b); }
  function debrief(params, scenario, decisions, seed) {
    var v = {}, sims = {};
    for (var m = 0; m < 8; m++) {
      var keep = { commercial: !!(m & 1), product: !!(m & 2), network: !!(m & 4) };
      sims[m] = replay(params, scenario, decisions, keep, seed);
      v[m] = sims[m].totals.npv;
    }
    var bit = { commercial: 1, product: 2, network: 4 }, wt = [1 / 3, 1 / 6, 1 / 3], shap = {};
    GROUPS.forEach(function (g) {
      var s = 0;
      for (var S = 0; S < 8; S++) {
        if (S & bit[g]) continue;
        var size = (S & 1 ? 1 : 0) + (S & 2 ? 1 : 0) + (S & 4 ? 1 : 0);
        s += wt[size] * (v[S | bit[g]] - v[S]);
      }
      shap[g] = s;
    });
    // each level alone, and the levels' interaction (what they add together beyond the sum of each alone)
    var alone = { commercial: v[1] - v[0], product: v[2] - v[0], network: v[4] - v[0] };
    // the decision timeline: every quarter a level's decisions changed, and when most of that change was in effect
    var p = sims[7].params, d0 = decisions0(p), timeline = [];
    decisions.slice(0, p.quarters).forEach(function (d, q) {
      var prev = q ? decisions[q - 1] : d0;
      GROUPS.forEach(function (g) {
        var a = clone(d[g]), b = clone(prev[g]);
        if (g === "network") {
          var acts = REG.some(function (r) { return d.network.expand[r] > 0 || d.network.close[r] > 0; });
          a.expand = b.expand = a.close = b.close = 0;
          if (!acts && !changed(a, b)) return;
        } else if (!changed(a, b)) return;
        timeline.push({ q: q, level: g, landsQ: Math.min(p.quarters, q + Math.ceil(CLOCK_MONTHS[g] / 3)) });
      });
    });
    return { gap: v[7] - v[0], npv: v[7], profit: sims[7].totals.profit, startingCourse: v[0], shapley: shap, alone: alone,
      interaction: (v[7] - v[0]) - (alone.commercial + alone.product + alone.network), values: v, timeline: timeline, clockMonths: CLOCK_MONTHS };
  }

  // an aligned autopilot: it steers each quarter from what the cockpit shows, smoothed so noise is not taken for a trend.
  // It adds responsive capacity while the product supply chain falls short, matches customers' expected promise once the
  // supply chain can carry it, and orders capacity ahead of growth that shows over both half a year and a year.
  // It is the reference that steering is measured against: no strategy set once should beat it in changing weather.
  function aligned(sim) {
    var d = sim.decisions(), m = sim.history.months, st = sim.state, p = sim.params, last = m.length - 1;
    if (last < 0) return d;
    var avg = function (from, n, f) { var a = 0, k = 0; for (var i = Math.max(0, from - n + 1); i <= from; i++) { a += f(m[i]); k++; } return a / Math.max(1, k); };
    var fitSmooth = avg(last, 6, function (x) { return x.fitProduct; });
    var o = aux(p, st, d, weather(sim.scenario, st.t, sim.weatherParams));
    var disrupted = REG.some(function (r) { return o.impShare[r] > 0.05; });   // a passing disruption is no reason to restructure
    SEG.forEach(function (s) {
      var num = 0, den = 0; REG.forEach(function (r) { num += o.AR[s][r] / o.RR[s] * o.D[s][r]; den += o.D[s][r]; });
      var fit = num / den;
      if (fit < 0.98 && fitSmooth < 0.99 && !disrupted) d.product.flex[s] = Math.min(0.5, d.product.flex[s] + (s === "I" ? 0.08 : 0.04));
      else if (fit > 1.1) d.product.flex[s] = Math.max(0.02, d.product.flex[s] - 0.01);
      if (st.expPromise[s] > d.commercial.promise[s] + 0.03 && fit >= 1) d.commercial.promise[s] = Math.min(1.6, st.expPromise[s]);
    });
    REG.forEach(function (r) {
      var dem = function (x) { return x.detail.D.F[r] + x.detail.D.I[r]; }, pipe = st.pipe[r][0] + st.pipe[r][1] + st.pipe[r][2];
      var local = avg(last, 12, dem), t12 = last >= 23 ? (local - avg(last - 12, 12, dem)) / 12 : 0, t6 = last >= 11 ? (avg(last, 6, dem) - avg(last - 6, 6, dem)) / 6 : 0;
      var trend = Math.min(t12, t6) * 12 > 0.08 * local ? Math.min(t12, t6) : 0;
      var need = (local + trend * p.buildTime) / p.utilisation0 - st.K[r] - pipe;
      if (trend > 0 && need > 0.05 * st.K[r]) d.network.expand[r] = Math.round(need);
    });
    return d;
  }

  return { VERSION: VERSION, aligned: aligned, debrief: debrief, CLOCK_MONTHS: CLOCK_MONTHS, GROUPS: GROUPS, SEG: SEG, REG: REG, SEG_NAME: SEG_NAME, REG_NAME: REG_NAME, defaults: defaults, decisions0: decisions0, LIMITS: LIMITS, clampDecisions: clampDecisions,
    SCENARIOS: SCENARIOS, weather: weather, weatherDraw: weatherDraw, events: events, create: create, run: run, SERIES: SERIES, clone: clone, _aux: aux };
});
