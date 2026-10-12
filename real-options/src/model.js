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
//   lease      lease capacity now (no capex, rent instead); break clauses let you hand it back at set dates for a fee
// Every owned site can also be sold at any time for its resale value, which declines to zero over the asset life
// (a generic, resellable building has a high resale value; a specialised one a low value). Selling is irreversible:
// demand is then served through the 3PL. An owned site can also be mothballed (idled at a fraction of its holding
// cost, demand going to the 3PL) and reactivated later, each switch at a one-off cost; and the staged site can sell
// capacity back in steps (partial contraction).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RealOptions = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var VERSION = "2.2.0";

  // money in $M, demand and capacity in thousand units per year, margins in $M per thousand units (= $/unit / 1000)
  function defaults() {
    return {
      D0: 500, sigma: 0.25, g: 0.04, ceiling: 3,      // the market saturates at ceiling × today's demand
      life: 20, window: 8,
      margin: 0.020, opcost: 0.006, penalty: 0.010, outMargin: 0.006, outCap: 1.0,
      basis: "wacc", wacc: 0.10, rf: 0.03, lambda: 0.3,
      smallF: 0.8, bigF: 1.4, stepF: 0.15, premium: 0.25, escal: 0.06, fFix: 8, fVar: 0.030,
      buildLead: 1.5, expandLead: 1.0,
      salvF: 0.3,                                      // resale value of a new site, as a share of its cost
      rent: 0.0065, leaseLead: 0.5, leaseFit: 0.25,    // rent per unit of capacity per year; fit-out time; fit-out cost (x fixed cost)
      minTerm: 5, breakEvery: 5, breakFee: 1.0,        // first break date, then every breakEvery years; fee in years of rent
      moth: 1, mothF: 0.2, mothFix: 0.5, reactFix: 1.0,  // mothballing allowed; holding cost while idle (share); one-off costs $M
      contract: 1                                      // the staged site may sell capacity back in steps
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
  // what selling a site of capacity K at step t brings: a share of its cost, declining linearly to zero at end of life
  function salvage(p, L, K, t) { return K <= 0 || !(p.salvF > 0) ? 0 : p.salvF * (p.fFix + p.fVar * K) * Math.max(0, 1 - t / L.N); }
  // selling part of a site (dK of capacity, no share of the fixed cost)
  function contractProceeds(p, L, dK, t) { return dK <= 0 || !(p.salvF > 0) ? 0 : p.salvF * p.fVar * dK * Math.max(0, 1 - t / L.N); }
  // cash flow per year of a mothballed site of capacity K: demand goes to the 3PL, a fraction of the holding cost remains
  function cfIdle(p, D, K) { return cfRate(p, D, 0) - p.mothF * p.opcost * K; }
  // the steps at which a lease that starts at step `start` may be broken
  function breakSteps(p, L, start) {
    var out = {}, first = start + Math.round(p.minTerm / L.dt), every = p.breakEvery > 0 ? Math.max(1, Math.round(p.breakEvery / L.dt)) : Infinity;
    for (var t = first; t < L.N; t += every) out[t] = true;
    return out;
  }

  // R[t][i] = value of operating capacity K from step t to the end of life. With R0 given (an owned site) it may also
  // be sold at any step (then R0, the value of serving through the 3PL, takes over), and mothballed and reactivated.
  // R is the value while active; R.B while mothballed. Policies: R.ex (active: 1 sell, 2 mothball) and R.exB
  // (mothballed: 1 sell, 3 reactivate). Comparing continuation values first means no switch-and-back in one step.
  function operate(p, L, K, R0, noMoth) {
    var sell = !!R0 && K > 0 && p.salvF > 0, moth = !!R0 && K > 0 && !!p.moth && !noMoth, opt = sell || moth;
    var R = new Array(L.N + 1), B = new Array(L.N + 1); R[L.N] = new Float64Array(L.N + 1); B[L.N] = R[L.N];
    if (opt) { R.ex = new Array(L.N + 1); R.exB = new Array(L.N + 1); R.ex[L.N] = new Uint8Array(L.N + 1); R.exB[L.N] = R.ex[L.N]; }
    for (var t = L.N - 1; t >= 0; t--) {
      var row = new Float64Array(t + 1), rowB = moth ? new Float64Array(t + 1) : null, nx = R[t + 1], nb = B[t + 1];
      var ex = opt ? new Uint8Array(t + 1) : null, exB = opt ? new Uint8Array(t + 1) : null, sv = sell ? salvage(p, L, K, t) : 0;
      for (var i = 0; i <= t; i++) {
        var D = demand(p, L, t, i);
        var hold = cfRate(p, D, K) * L.dt + L.disc * (L.p * nx[i + 1] + (1 - L.p) * nx[i]), a = hold, c = 0;
        if (moth) {
          var idle = cfIdle(p, D, K) * L.dt + L.disc * (L.p * nb[i + 1] + (1 - L.p) * nb[i]), b = idle, cb = 0;
          if (idle - p.mothFix > a) { a = idle - p.mothFix; c = 2; }
          if (hold - p.reactFix > b) { b = hold - p.reactFix; cb = 3; }
          if (sell && sv + R0[t][i] > b) { b = sv + R0[t][i]; cb = 1; }
          rowB[i] = b; exB[i] = cb;
        }
        if (sell && sv + R0[t][i] > a) { a = sv + R0[t][i]; c = 1; }
        row[i] = a; if (opt) ex[i] = c;
      }
      R[t] = row; B[t] = moth ? rowB : row; if (opt) { R.ex[t] = ex; R.exB[t] = exB; }
    }
    R.B = B;
    return R;
  }
  // a lease of capacity K: rent on top of operating costs; at break dates it may be handed back for a fee
  function leaseValue(p, L, K, R0, breaks) {
    var R = new Array(L.N + 1), fee = p.breakFee * p.rent * K; R[L.N] = new Float64Array(L.N + 1); R.ex = new Array(L.N + 1);
    for (var t = L.N - 1; t >= 0; t--) {
      var row = new Float64Array(t + 1), nx = R[t + 1], ex = new Uint8Array(t + 1);
      for (var i = 0; i <= t; i++) {
        var hold = (cfRate(p, demand(p, L, t, i), K) - p.rent * K) * L.dt + L.disc * (L.p * nx[i + 1] + (1 - L.p) * nx[i]);
        if (breaks && breaks[t] && R0[t][i] - fee > hold) { row[i] = R0[t][i] - fee; ex[i] = 1; } else row[i] = hold;
      }
      R[t] = row; R.ex[t] = ex;
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
    var R0 = operate(p, L, 0), Rbig = operate(p, L, Kbig, R0);
    // value of committing to K at step t: the old operation (here: none) until it arrives, then K for the rest of life
    function committed(RK, Rold, t, i, years) { return Rold[t][i] - ahead(Rold, t, i, L.Lb, wb, db) + ahead(RK, t, i, L.Lb, wb, db); }
    // ---- fixed capacity
    function fixedValue(K) { var RK = operate(p, L, K, R0); return { npv: committed(RK, R0, 0, 0) - buildCost(p, K, 0), R: RK }; }
    var full = fixedValue(Kbig);
    var best = { npv: -Infinity, K: 0 };
    for (var K = 0.3 * p.D0; K <= 2.2 * p.D0 + 1e-9; K += 0.02 * p.D0) { var v = fixedValue(K).npv; if (v > best.npv) best = { npv: v, K: K }; }
    // refine around the best grid point
    for (var K2 = best.K - 0.02 * p.D0; K2 <= best.K + 0.02 * p.D0; K2 += 0.002 * p.D0) { var v2 = fixedValue(K2).npv; if (v2 > best.npv) best = { npv: v2, K: K2 }; }
    var Rbest = operate(p, L, best.K, R0);
    // the same design with no resale value: what the right to sell is worth to it
    best.noExit = committed(operate(p, L, best.K), R0, 0, 0) - buildCost(p, best.K, 0);
    best.noMoth = committed(operate(p, L, best.K, R0, true), R0, 0, 0) - buildCost(p, best.K, 0);
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
    // V: active at level k; Mb: mothballed at level k. Policy codes, active: a level (expand or contract to it),
    // 254 mothball, 255 sell everything; mothballed (polM): 0 stay idle, 1 reactivate, 255 sell everything.
    var V = new Array(N + 1), Mb = new Array(N + 1), pol = new Array(N + 1), polM = new Array(N + 1), mothOn = !!p.moth;
    var hA = new Float64Array(nL), hB = new Float64Array(nL);
    for (t = N; t >= 0; t--) {
      V[t] = []; Mb[t] = []; pol[t] = []; polM[t] = [];
      var canAct = t <= W && t + L.Le <= N;
      for (var k = 0; k < nL; k++) { V[t][k] = new Float64Array(t + 1); Mb[t][k] = new Float64Array(t + 1); pol[t][k] = new Uint8Array(t + 1); polM[t][k] = new Uint8Array(t + 1); }
      for (i = 0; i <= t; i++) {
        var D = demand(p, L, t, i);
        // what arrives later, for every target level (independent of the current level)
        var arrive = null;
        if (canAct && L.Le > 0) { arrive = new Float64Array(nL); for (var a = 0; a < nL; a++) arrive[a] = aheadLevel(V, t, i, L.Le, we, de, a); }
        for (k = 0; k < nL; k++) {
          hA[k] = t === N ? 0 : cfRate(p, D, lv[k]) * L.dt + L.disc * (L.p * V[t + 1][k][i + 1] + (1 - L.p) * V[t + 1][k][i]);
          hB[k] = t === N ? 0 : cfIdle(p, D, lv[k]) * L.dt + L.disc * (L.p * Mb[t + 1][k][i + 1] + (1 - L.p) * Mb[t + 1][k][i]);
        }
        // choices that do not refer to this step's own values
        for (k = 0; k < nL; k++) {
          var bestV = hA[k], bk = k;
          var sv = salvage(p, L, lv[k], t);
          if (sv > 0 && sv + R0[t][i] > bestV) { bestV = sv + R0[t][i]; bk = 255; }
          if (mothOn && t < N && hB[k] - p.mothFix > bestV) { bestV = hB[k] - p.mothFix; bk = 254; }
          if (canAct && L.Le > 0) {
            var meanwhile = Rk[k][t][i] - ahead(Rk[k], t, i, L.Le, we, de);
            for (var k2 = k + 1; k2 < nL; k2++) {
              var val = meanwhile + arrive[k2] - expandCost(p, lv[k2] - lv[k]);
              if (val > bestV) { bestV = val; bk = k2; }
            }
          }
          V[t][k][i] = bestV; pol[t][k][i] = bk;
        }
        // moves to another level within this step (contraction; expansion with no lead time). Every round trip
        // loses money, so repeated relaxation settles in at most nL rounds.
        var contract = !!p.contract && t < N, instant = canAct && L.Le === 0;
        for (var round = 0; (contract || instant) && round <= nL; round++) {
          var changed = false;
          for (k = 0; k < nL; k++) {
            for (k2 = 0; k2 < nL; k2++) {
              if (k2 === k) continue;
              var cand = k2 < k ? (contract ? V[t][k2][i] + contractProceeds(p, L, lv[k] - lv[k2], t) : -Infinity) : (instant ? V[t][k2][i] - expandCost(p, lv[k2] - lv[k]) : -Infinity);
              if (cand > V[t][k][i] + 1e-12) { V[t][k][i] = cand; pol[t][k][i] = k2; changed = true; }
            }
          }
          if (!changed) break;
        }
        for (k = 0; k < nL; k++) {
          var mb = hB[k], mk = 0;
          if (mothOn) {
            if (V[t][k][i] - p.reactFix > mb && t < N) { mb = V[t][k][i] - p.reactFix; mk = 1; }
            sv = salvage(p, L, lv[k], t);
            if (sv > 0 && sv + R0[t][i] > mb) { mb = sv + R0[t][i]; mk = 255; }
          }
          Mb[t][k][i] = mb; polM[t][k][i] = mk;
        }
      }
    }
    // the initial build of the stage strategy, then whatever expansions pay
    var stageNpv = R0[0][0] - ahead(R0, 0, 0, L.Lb, wb, db) + aheadLevel(V, 0, 0, L.Lb, wb, db, 0) - buildCost(p, lv[0], 0);
    // ---- lease: capacity chosen to maximise NPV; fit-out takes leaseLead, and its cost is paid now
    var Ll = Math.min(N, Math.round(p.leaseLead / L.dt)), wl = weights(L, Ll), dl = Math.pow(L.disc, Ll), brk = breakSteps(p, L, Ll);
    function leaseNpv(K, b) { var RL = leaseValue(p, L, K, R0, b); return { npv: R0[0][0] - ahead(R0, 0, 0, Ll, wl, dl) + ahead(RL, 0, 0, Ll, wl, dl) - p.leaseFit * p.fFix, R: RL }; }
    var lease = { npv: -Infinity, K: 0 };
    for (K = 0.3 * p.D0; K <= 2.2 * p.D0 + 1e-9; K += 0.02 * p.D0) { v = leaseNpv(K, brk).npv; if (v > lease.npv) lease = { npv: v, K: K }; }
    for (K2 = lease.K - 0.02 * p.D0; K2 <= lease.K + 0.02 * p.D0; K2 += 0.002 * p.D0) { v2 = leaseNpv(K2, brk).npv; if (v2 > lease.npv) lease = { npv: v2, K: K2 }; }
    lease.R = leaseNpv(lease.K, brk).R; lease.lead = Ll; lease.breaks = brk; lease.noBreak = leaseNpv(lease.K, null).npv;
    return {
      version: VERSION, params: p, lattice: L, levels: lv, Kbig: Kbig,
      full: { npv: full.npv, K: Kbig }, best: best,
      defer: { npv: Wd[0][0], build: build }, stage: { npv: stageNpv, pol: pol, polM: polM, V: V, M: Mb }, lease: lease,
      R0: R0, Rbig: Rbig, Rbest: Rbest, Rk: Rk
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
        full: { K: 0, pend: sol.Kbig, at: L.Lb, npv: -buildCost(p, sol.Kbig, 0), R: sol.Rbig, sold: null, idle: false, mothballs: 0 },
        best: { K: 0, pend: sol.best.K, at: L.Lb, npv: -buildCost(p, sol.best.K, 0), R: sol.Rbest, sold: null, idle: false, mothballs: 0 },
        defer: { K: 0, pend: null, at: -1, npv: 0, built: false, buildYear: null, R: sol.Rbig, sold: null, idle: false, mothballs: 0 },
        stage: { k: -1, pend: 0, at: L.Lb, npv: -buildCost(p, lv[0], 0), expansions: 0, firstExpansion: null, sold: null, idle: false, mothballs: 0, contractions: 0 },
        lease: { K: 0, pend: sol.lease.K, at: sol.lease.lead, npv: -p.leaseFit * p.fFix, sold: null }
      };
      var events = [];
      // an owned site's policy, once it is in place and no project is under way: sell, mothball or reactivate
      var act = function (x, t, i, df) {
        if (!x.R.ex || x.K <= 0 || x.pend !== null) return;
        var c = x.idle ? x.R.exB[t][i] : x.R.ex[t][i];
        if (c === 1) { x.npv += df * salvage(p, L, x.K, t); x.K = 0; x.sold = t * L.dt; x.idle = false; }
        else if (c === 2) { x.npv -= df * p.mothFix; x.idle = true; x.mothballs++; }
        else if (c === 3) { x.npv -= df * p.reactFix; x.idle = false; }
      };
      var cash = function (x, D) { return x.idle ? cfIdle(p, D, x.K) : cfRate(p, D, x.K); };
      for (var t = 0; t < N; t++) {
        var D = demand(p, L, t, i);
        if (t === L.W) iW = i;
        sumD += D;
        ["full", "best"].forEach(function (s) { var x = S[s]; if (x.pend !== null && t >= x.at) { x.K = x.pend; x.pend = null; } act(x, t, i, df); x.npv += df * cash(x, D) * L.dt; });
        var f = S.defer;
        if (f.pend !== null && t >= f.at) { f.K = f.pend; f.pend = null; }
        if (!f.built && sol.defer.build[t][i]) { f.built = true; f.pend = sol.Kbig; f.at = t + L.Lb; f.npv -= df * buildCost(p, sol.Kbig, t * L.dt); f.buildYear = t * L.dt; events.push(["defer", t, i]); }
        act(f, t, i, df);
        f.npv += df * cash(f, D) * L.dt;
        var g = S.stage;
        if (g.pend !== null && t >= g.at) { g.k = g.pend; g.pend = null; }
        if (g.k >= 0 && g.pend === null) {
          var go = true;
          if (g.idle) {
            var cm = sol.stage.polM[t][g.k][i];
            if (cm === 255) { g.npv += df * salvage(p, L, lv[g.k], t); g.k = -2; g.sold = t * L.dt; g.idle = false; go = false; }
            else if (cm === 1) { g.npv -= df * p.reactFix; g.idle = false; }
            else go = false;
          }
          // follow the active policy until it settles (a contraction or an instant expansion can lead to another move)
          for (var guard = 0; go && guard <= lv.length + 1; guard++) {
            var k2 = sol.stage.pol[t][g.k][i];
            if (k2 === g.k) break;
            if (k2 === 255) { g.npv += df * salvage(p, L, lv[g.k], t); g.k = -2; g.sold = t * L.dt; break; }
            if (k2 === 254) { g.npv -= df * p.mothFix; g.idle = true; g.mothballs++; break; }
            if (k2 < g.k) { g.npv += df * contractProceeds(p, L, lv[g.k] - lv[k2], t); g.k = k2; g.contractions++; continue; }
            g.npv -= df * expandCost(p, lv[k2] - lv[g.k]); g.expansions++; if (g.firstExpansion === null) g.firstExpansion = t * L.dt; events.push(["stage", t, i]);
            if (L.Le === 0) { g.k = k2; continue; }
            g.pend = k2; g.at = t + L.Le; break;
          }
        }
        g.npv += df * (g.k >= 0 ? (g.idle ? cfIdle(p, D, lv[g.k]) : cfRate(p, D, lv[g.k])) : cfRate(p, D, 0)) * L.dt;
        var e = S.lease;
        if (e.pend !== null && t >= e.at) { e.K = e.pend; e.pend = null; }
        if (e.K > 0 && sol.lease.breaks[t] && sol.lease.R.ex[t][i]) { e.npv -= df * p.breakFee * p.rent * e.K; e.K = 0; e.sold = t * L.dt; }
        e.npv += df * (cfRate(p, D, e.K) - p.rent * e.K) * L.dt;
        if (next() < L.p) i++;
        df *= L.disc;
      }
      if (L.W >= N) iW = i;
      out.push({ windowDemand: demand(p, L, L.W, iW), meanDemand: sumD / N, full: S.full.npv, best: S.best.npv, defer: S.defer.npv, stage: S.stage.npv, lease: S.lease.npv, deferYear: S.defer.buildYear,
        sold: { full: S.full.sold, best: S.best.sold, defer: S.defer.sold, stage: S.stage.sold, lease: S.lease.sold },
        mothballs: { full: S.full.mothballs, best: S.best.mothballs, defer: S.defer.mothballs, stage: S.stage.mothballs }, contractions: S.stage.contractions, expansions: S.stage.expansions, firstExpansion: S.stage.firstExpansion,
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
    var p = merge(params), L = lattice(p), R0 = operate(p, L, 0), RK = operate(p, L, K, R0), w = weights(L, L.Lb), dN = Math.pow(L.disc, L.Lb);
    return R0[0][0] - ahead(R0, 0, 0, L.Lb, w, dN) + ahead(RK, 0, 0, L.Lb, w, dN) - buildCost(p, K, 0);
  }

  // NPV of leasing capacity K now, with or without its break clauses (used in the tests)
  function leaseNpv(params, K, withBreaks) {
    var p = merge(params), L = lattice(p), R0 = operate(p, L, 0), Ll = Math.min(L.N, Math.round(p.leaseLead / L.dt)), w = weights(L, Ll), dN = Math.pow(L.disc, Ll);
    var RL = leaseValue(p, L, K, R0, withBreaks ? breakSteps(p, L, Ll) : null);
    return R0[0][0] - ahead(R0, 0, 0, Ll, w, dN) + ahead(RL, 0, 0, Ll, w, dN) - p.leaseFit * p.fFix;
  }

  return { VERSION: VERSION, defaults: defaults, merge: merge, lattice: lattice, fixedNpv: fixedNpv, leaseNpv: leaseNpv, demand: demand, cfRate: cfRate, buildCost: buildCost, expandCost: expandCost, salvage: salvage, contractProceeds: contractProceeds, cfIdle: cfIdle, breakSteps: breakSteps,
    operate: operate, levelsOf: levelsOf, solve: solve, simulate: simulate, europeanCall: europeanCall };
});
