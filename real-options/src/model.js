// Real Options for Network Design — the valuation engine. Pure functions: the same code runs in the page and in the
// Node tests.
//
// Demand follows a recombining binomial lattice over the whole life of the asset. Decisions (build, wait, expand)
// can be taken only inside a decision window; after it, capacity stays as it is and keeps operating to the end of
// the asset's life. Building and expanding take time (lead times). Demand the network cannot serve is outsourced up
// to a limit at a lower margin, and the rest is lost with a penalty — the same rule for every strategy, including
// while waiting. Two valuation bases: expected cash flows at the WACC, or risk-neutral (drift reduced by the market
// price of risk, discounted at the risk-free rate). Strategies:
//   fixed(K)   build capacity K now (arrives after the build lead time) and keep it
//   full       fixed at the full footprint;   best: fixed at the capacity that maximises NPV
//   defer      build the full footprint once, at the best moment inside the window (cost escalates with time)
//   stage      build the initial footprint now, then add steps where they pay (each at a premium, one at a time)
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RealOptions = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var VERSION = "2.0.0";

  // money in $M, demand and capacity in thousand units per year, margins in $M per thousand units (= $/unit / 1000)
  function defaults() {
    return {
      D0: 500, sigma: 0.25, g: 0.04, ceiling: 3,      // the market saturates at ceiling × today's demand
      life: 20, window: 8,
      margin: 0.020, opcost: 0.006, penalty: 0.010, outMargin: 0.006, outCap: 1.0,
      basis: "wacc", wacc: 0.10, rf: 0.03, lambda: 0.3,
      smallF: 0.8, bigF: 1.4, stepF: 0.15, premium: 0.25, escal: 0.06, fFix: 8, fVar: 0.030,
      buildLead: 1.5, expandLead: 1.0
    };
  }
  function merge(p) { var d = defaults(); Object.keys(p || {}).forEach(function (k) { d[k] = p[k]; }); return d; }

  // ---- the lattice. The step is chosen so the up-probability stays inside (0, 1) with a margin: |g|·√dt ≤ 0.85·σ.
  var STEPS = [0.25, 1 / 12, 1 / 52];
  function lattice(p) {
    var g = p.basis === "rn" ? p.g - p.lambda * p.sigma : p.g, r = p.basis === "rn" ? p.rf : p.wacc, warnings = [];
    var dt = null;
    // a forced step (for convergence checks) is used if it is valid; otherwise the largest valid step
    if (p.stepYears && Math.abs(g) * Math.sqrt(p.stepYears) <= 0.85 * p.sigma) dt = p.stepYears;
    for (var s = 0; dt === null && s < STEPS.length; s++) if (Math.abs(g) * Math.sqrt(STEPS[s]) <= 0.85 * p.sigma) { dt = STEPS[s]; break; }
    if (dt === null) { dt = STEPS[STEPS.length - 1]; warnings.push("Growth is too strong for this little volatility: even weekly steps cannot represent it exactly. Raise the volatility or lower the growth."); }
    else if (dt < 0.25) warnings.push("The lattice uses " + (dt === 1 / 12 ? "monthly" : "weekly") + " steps here, so the growth you set can be represented exactly.");
    var u = Math.exp(p.sigma * Math.sqrt(dt)), d = 1 / u, pu = (Math.exp(g * dt) - d) / (u - d);
    var N = Math.round(p.life / dt), W = Math.min(N, Math.round(p.window / dt));
    return { dt: dt, u: u, d: d, p: pu, g: g, r: r, disc: Math.exp(-r * dt), N: N, W: W,
      Lb: Math.round(p.buildLead / dt), Le: Math.round(p.expandLead / dt), warnings: warnings, valid: pu > 0 && pu < 1 };
  }
  function demand(p, L, t, i) { return Math.min(p.D0 * Math.pow(L.u, 2 * i - t), p.ceiling * p.D0); }
  // cash flow per year with capacity K at demand D: own sales, outsourced sales (up to a limit), lost sales, holding cost
  function cfRate(p, D, K) {
    var own = Math.min(D, K), short = Math.max(D - K, 0), cap = p.outCap * p.D0, out = Math.min(short, cap), lost = short - out;
    return p.margin * own + p.outMargin * out - p.penalty * lost - p.opcost * K;
  }
  function buildCost(p, K, years) { return K <= 0 ? 0 : (p.fFix + p.fVar * K) * Math.pow(1 + p.escal, years); }
  function expandCost(p, dK) { return dK <= 0 ? 0 : 0.25 * p.fFix + p.fVar * dK * (1 + p.premium); }

  // R[t][i] = value of operating capacity K from step t to the end of life, no decisions
  function operate(p, L, K) {
    var R = new Array(L.N + 1); R[L.N] = new Float64Array(L.N + 1);
    for (var t = L.N - 1; t >= 0; t--) {
      var row = new Float64Array(t + 1), nx = R[t + 1];
      for (var i = 0; i <= t; i++) row[i] = cfRate(p, demand(p, L, t, i), K) * L.dt + L.disc * (L.p * nx[i + 1] + (1 - L.p) * nx[i]);
      R[t] = row;
    }
    return R;
  }
  // binomial weights for an n-step look-ahead, and the discounted n-step expectation of X at node (t, i)
  function weights(L, n) { var w = [], c = 1; for (var j = 0; j <= n; j++) { w.push(c * Math.pow(L.p, j) * Math.pow(1 - L.p, n - j)); c = c * (n - j) / (j + 1); } return w; }
  function ahead(X, t, i, n, w, discN) { if (n === 0) return X[t][i]; var row = X[t + n], s = 0; for (var j = 0; j <= n; j++) s += w[j] * row[i + j]; return discN * s; }

  function levelsOf(p) {
    var K0 = p.D0 * p.smallF, Kbig = Math.max(K0, p.D0 * p.bigF), step = Math.max(p.D0 * p.stepF, 1e-6), L = [K0];
    while (L[L.length - 1] + step < Kbig - 1e-6 && L.length < 12) L.push(L[L.length - 1] + step);
    if (Kbig - L[L.length - 1] > 1e-6) L.push(Kbig);
    return L;
  }

  function solve(params) {
    var p = merge(params), L = lattice(p), N = L.N, W = L.W, lv = levelsOf(p), Kbig = lv[lv.length - 1];
    var wb = weights(L, L.Lb), we = weights(L, L.Le), db = Math.pow(L.disc, L.Lb), de = Math.pow(L.disc, L.Le);
    var R0 = operate(p, L, 0), Rbig = operate(p, L, Kbig);
    // value of committing to K at step t: the old operation (here: none) until it arrives, then K for the rest of life
    function committed(RK, Rold, t, i, years) { return Rold[t][i] - ahead(Rold, t, i, L.Lb, wb, db) + ahead(RK, t, i, L.Lb, wb, db); }
    // ---- fixed capacity
    function fixedValue(K) { var RK = operate(p, L, K); return { npv: committed(RK, R0, 0, 0) - buildCost(p, K, 0), R: RK }; }
    var full = fixedValue(Kbig);
    var best = { npv: -Infinity, K: 0 };
    for (var K = 0.3 * p.D0; K <= 2.2 * p.D0 + 1e-9; K += 0.02 * p.D0) { var v = fixedValue(K).npv; if (v > best.npv) best = { npv: v, K: K }; }
    // refine around the best grid point
    for (var K2 = best.K - 0.02 * p.D0; K2 <= best.K + 0.02 * p.D0; K2 += 0.002 * p.D0) { var v2 = fixedValue(K2).npv; if (v2 > best.npv) best = { npv: v2, K: K2 }; }
    // ---- defer: build the full footprint once, inside the window, arriving after the build lead time
    var Wd = new Array(N + 1), build = new Array(N + 1);
    for (var t = N; t >= 0; t--) {
      Wd[t] = new Float64Array(t + 1); build[t] = new Uint8Array(t + 1);
      for (var i = 0; i <= t; i++) {
        var wait = t === N ? 0 : cfRate(p, demand(p, L, t, i), 0) * L.dt + L.disc * (L.p * Wd[t + 1][i + 1] + (1 - L.p) * Wd[t + 1][i]);
        if (t <= W && t + L.Lb <= N) {
          var now = committed(Rbig, R0, t, i) - buildCost(p, Kbig, t * L.dt);
          if (now >= wait) { Wd[t][i] = now; build[t][i] = 1; continue; }
        }
        Wd[t][i] = wait;
      }
    }
    // ---- stage: initial footprint now; then expansions by steps, each arriving after the expansion lead time
    var nL = lv.length, Rk = lv.map(function (k) { return operate(p, L, k); });
    var V = new Array(N + 1), pol = new Array(N + 1);
    for (t = N; t >= 0; t--) {
      V[t] = []; pol[t] = [];
      var canAct = t <= W && t + L.Le <= N;
      for (var k = 0; k < nL; k++) { V[t][k] = new Float64Array(t + 1); pol[t][k] = new Uint8Array(t + 1); }
      for (i = 0; i <= t; i++) {
        var D = demand(p, L, t, i);
        // what arrives later, for every target level (independent of the current level). With no lead time the
        // target's value is this step's own, so levels are filled from the top down.
        var arrive = null;
        if (canAct && L.Le > 0) { arrive = new Float64Array(nL); for (var a = 0; a < nL; a++) arrive[a] = aheadLevel(V, t, i, L.Le, we, de, a); }
        for (k = nL - 1; k >= 0; k--) {
          var hold = t === N ? 0 : cfRate(p, D, lv[k]) * L.dt + L.disc * (L.p * V[t + 1][k][i + 1] + (1 - L.p) * V[t + 1][k][i]);
          var bestV = hold, bk = k;
          if (canAct) {
            var meanwhile = Rk[k][t][i] - ahead(Rk[k], t, i, L.Le, we, de);
            for (var k2 = k + 1; k2 < nL; k2++) {
              var later = L.Le > 0 ? arrive[k2] : V[t][k2][i];
              var val = meanwhile + later - expandCost(p, lv[k2] - lv[k]);
              if (val > bestV) { bestV = val; bk = k2; }
            }
          }
          V[t][k][i] = bestV; pol[t][k][i] = bk;
        }
      }
    }
    // the initial build of the stage strategy, then whatever expansions pay
    var stageNpv = R0[0][0] - ahead(R0, 0, 0, L.Lb, wb, db) + aheadLevel(V, 0, 0, L.Lb, wb, db, 0) - buildCost(p, lv[0], 0);
    return {
      version: VERSION, params: p, lattice: L, levels: lv, Kbig: Kbig,
      full: { npv: full.npv, K: Kbig }, best: best,
      defer: { npv: Wd[0][0], build: build }, stage: { npv: stageNpv, pol: pol, V: V },
      R0: R0, Rbig: Rbig, Rk: Rk
    };
  }
  // the n-step expectation for the staged value array, which is indexed [t][level][i]
  function aheadLevel(V, t, i, n, w, discN, k) { if (n === 0) return V[t][k][i]; var row = V[t + n][k], s = 0; for (var j = 0; j <= n; j++) s += w[j] * row[i + j]; return discN * s; }

  // ---- simulate paths through the lattice under each strategy's optimal policy (seeded, so repeatable)
  function rng(seed) { var s = seed >>> 0 || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function simulate(sol, n, seed) {
    var p = sol.params, L = sol.lattice, lv = sol.levels, N = L.N, next = rng(seed || 7), out = [];
    for (var m = 0; m < n; m++) {
      var i = 0, df = 1, iW = 0, sumD = 0;
      // each strategy's state: capacity in place, and a pending project (target, arrival step)
      var S = {
        full: { K: 0, pend: sol.Kbig, at: L.Lb, npv: -buildCost(p, sol.Kbig, 0) },
        best: { K: 0, pend: sol.best.K, at: L.Lb, npv: -buildCost(p, sol.best.K, 0) },
        defer: { K: 0, pend: null, at: -1, npv: 0, built: false, buildYear: null },
        stage: { k: -1, pend: 0, at: L.Lb, npv: -buildCost(p, lv[0], 0), expansions: 0, firstExpansion: null }
      };
      var events = [];
      for (var t = 0; t < N; t++) {
        var D = demand(p, L, t, i);
        if (t === L.W) iW = i;
        sumD += D;
        ["full", "best"].forEach(function (s) { var x = S[s]; if (x.pend !== null && t >= x.at) { x.K = x.pend; x.pend = null; } x.npv += df * cfRate(p, D, x.K) * L.dt; });
        var f = S.defer;
        if (f.pend !== null && t >= f.at) { f.K = f.pend; f.pend = null; }
        if (!f.built && sol.defer.build[t][i]) { f.built = true; f.pend = sol.Kbig; f.at = t + L.Lb; f.npv -= df * buildCost(p, sol.Kbig, t * L.dt); f.buildYear = t * L.dt; events.push(["defer", t, i]); }
        f.npv += df * cfRate(p, D, f.K) * L.dt;
        var g = S.stage;
        if (g.pend !== null && t >= g.at) { g.k = g.pend; g.pend = null; }
        if (g.k >= 0 && g.pend === null) {
          var k2 = sol.stage.pol[t][g.k][i];
          if (k2 > g.k) { g.npv -= df * expandCost(p, lv[k2] - lv[g.k]); g.pend = k2; g.at = t + L.Le; g.expansions++; if (g.firstExpansion === null) g.firstExpansion = t * L.dt; events.push(["stage", t, i]); }
        }
        g.npv += df * cfRate(p, D, g.k >= 0 ? lv[g.k] : 0) * L.dt;
        if (next() < L.p) i++;
        df *= L.disc;
      }
      if (L.W >= N) iW = i;
      out.push({ windowDemand: demand(p, L, L.W, iW), meanDemand: sumD / N, full: S.full.npv, best: S.best.npv, defer: S.defer.npv, stage: S.stage.npv, deferYear: S.defer.buildYear, expansions: S.stage.expansions, firstExpansion: S.stage.firstExpansion,
        endDemand: demand(p, L, N, i), growth: Math.pow(demand(p, L, N, i) / p.D0, 1 / p.life) - 1, events: events });
    }
    return out;
  }

  // a European call on demand, priced on the same lattice machinery (used to check the lattice against Black–Scholes)
  function europeanCall(S0, X, sigma, r, T, dt) {
    var u = Math.exp(sigma * Math.sqrt(dt)), d = 1 / u, pu = (Math.exp(r * dt) - d) / (u - d), N = Math.round(T / dt), disc = Math.exp(-r * dt);
    var v = new Float64Array(N + 1);
    for (var i = 0; i <= N; i++) v[i] = Math.max(0, S0 * Math.pow(u, 2 * i - N) - X);
    for (var t = N - 1; t >= 0; t--) for (i = 0; i <= t; i++) v[i] = disc * (pu * v[i + 1] + (1 - pu) * v[i]);
    return v[0];
  }

  // NPV of building capacity K now and keeping it (used for fair comparisons and in the tests)
  function fixedNpv(params, K) {
    var p = merge(params), L = lattice(p), R0 = operate(p, L, 0), RK = operate(p, L, K), w = weights(L, L.Lb), dN = Math.pow(L.disc, L.Lb);
    return R0[0][0] - ahead(R0, 0, 0, L.Lb, w, dN) + ahead(RK, 0, 0, L.Lb, w, dN) - buildCost(p, K, 0);
  }

  return { VERSION: VERSION, defaults: defaults, merge: merge, lattice: lattice, fixedNpv: fixedNpv, demand: demand, cfRate: cfRate, buildCost: buildCost, expandCost: expandCost,
    operate: operate, levelsOf: levelsOf, solve: solve, simulate: simulate, europeanCall: europeanCall };
});
