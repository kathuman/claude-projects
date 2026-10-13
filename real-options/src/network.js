// Real Options for Network Design — the two-region network engine. Pure functions: the same code runs in the page
// and in the Node tests.
//
// Two regions, A and B, each with demand on its own recombining binomial lattice; the two are correlated, so every
// step has four branches (both up, A up and B down, A down and B up, both down). A hub serves its own region first;
// its spare capacity serves the other region at a cross-region transport cost; a 3PL covers what is left up to a
// limit in each region; the rest is lost with a penalty. A second hub costs less once the first exists (shared
// systems, people, supplier terms): the compound option, where opening one hub creates a cheaper option on the next.
// Strategies:
//   central  one hub in region A, built now, sized to maximise NPV (it serves B across regions)
//   two      a hub in each region, built now, sizes chosen together to maximise NPV
//   both     a hub in each region, built now, at the planned sizes
//   pilot    a hub at the planned size in one region now (whichever is worth more), and the option to open the other
//            region's hub at any time inside the decision window
//   wait     open either hub, or both, at the best moments inside the window
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RealNetwork = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var VERSION = "4.0.0";

  // money in $M, demand and capacity in thousand units per year, margins in $M per thousand units
  function defaults() {
    return {
      DA: 500, DB: 250, sigA: 0.2, sigB: 0.4, gA: 0.02, gB: 0.08, rho: 0.2, ceiling: 3,
      life: 20, window: 8, buildLead: 1.5,
      margin: 0.020, opcost: 0.006, outMargin: 0.006, outCap: 1.0, penalty: 0.010, xcost: 0.006,
      basis: "wacc", wacc: 0.10, rf: 0.03, lambda: 0.3,
      fFix: 8, fVar: 0.030, escal: 0.06, learn: 0.4,
      sizeA: 1.2, sizeB: 1.4          // planned hub sizes, × each region's demand today
    };
  }
  function merge(p) { var d = defaults(); Object.keys(p || {}).forEach(function (k) { d[k] = p[k]; }); return d; }

  // ---- the joint lattice. Quarterly steps (a two-dimensional lattice grows with the square of the steps). A growth
  // too strong for its volatility, or a correlation the four branches cannot carry, is limited and reported.
  function lattice(p) {
    var dt = 0.25, warnings = [], rn = p.basis === "rn";
    function region(name, g, s) {
      var g0 = rn ? g - p.lambda * s : g, lim = 0.85 * s / Math.sqrt(dt), ge = Math.max(-lim, Math.min(lim, g0));
      if (Math.abs(ge - g0) > 1e-12) warnings.push("Region " + name + ": growth of " + (g0 * 100).toFixed(1) + "%/yr is too strong for a volatility of " + (s * 100).toFixed(0) + "% on this lattice; " + (ge * 100).toFixed(1) + "%/yr is used. Raise the volatility to use your growth.");
      var u = Math.exp(s * Math.sqrt(dt)), d = 1 / u;
      return { g: ge, u: u, d: d, p: (Math.exp(ge * dt) - d) / (u - d) };
    }
    var A = region("A", p.gA, p.sigA), B = region("B", p.gB, p.sigB);
    var sd = Math.sqrt(A.p * (1 - A.p) * B.p * (1 - B.p)), c = p.rho * sd;
    var lo = Math.max(-A.p * B.p, -(1 - A.p) * (1 - B.p)), hi = Math.min(A.p * (1 - B.p), (1 - A.p) * B.p), ce = Math.max(lo, Math.min(hi, c));
    if (Math.abs(ce - c) > 1e-12) warnings.push("A correlation of " + p.rho.toFixed(2) + " cannot be represented with these growth rates; " + (ce / sd).toFixed(2) + " is used.");
    var q = [A.p * B.p + ce, A.p * (1 - B.p) - ce, (1 - A.p) * B.p - ce, (1 - A.p) * (1 - B.p) + ce];
    var N = Math.round(p.life / dt), r = rn ? p.rf : p.wacc;
    return { dt: dt, N: N, W: Math.min(N, Math.round(p.window / dt)), Lb: Math.round(p.buildLead / dt), r: r, disc: Math.exp(-r * dt),
      A: A, B: B, q: q, rho: ce / sd, warnings: warnings };
  }
  // demand in each region at step t after i (or j) up-moves, capped at the market ceiling
  function demands(p, L) {
    var a = [], b = [];
    for (var t = 0; t <= L.N; t++) {
      var ra = new Float64Array(t + 1), rb = new Float64Array(t + 1);
      for (var i = 0; i <= t; i++) { ra[i] = Math.min(p.DA * Math.pow(L.A.u, 2 * i - t), p.ceiling * p.DA); rb[i] = Math.min(p.DB * Math.pow(L.B.u, 2 * i - t), p.ceiling * p.DB); }
      a.push(ra); b.push(rb);
    }
    return { a: a, b: b };
  }

  // cash flow per year: own sales, cross-region service from spare capacity, the 3PL, lost sales, holding cost.
  // Cross-region service is used before the 3PL when it earns more; after it otherwise.
  function cf(p, DA, DB, KA, KB) {
    var ownA = Math.min(DA, KA), ownB = Math.min(DB, KB), spA = KA - ownA, spB = KB - ownB, shA = DA - ownA, shB = DB - ownB;
    var xm = p.margin - p.xcost, capA = p.outCap * p.DA, capB = p.outCap * p.DB, x1 = 0, x2 = 0, oA, oB;
    if (xm >= p.outMargin) {
      x1 = Math.min(spA, shB); x2 = Math.min(spB, shA); shB -= x1; shA -= x2;
      oA = Math.min(shA, capA); oB = Math.min(shB, capB); shA -= oA; shB -= oB;
    } else {
      oA = Math.min(shA, capA); oB = Math.min(shB, capB); shA -= oA; shB -= oB;
      if (xm > -p.penalty) { x1 = Math.min(spA, shB); x2 = Math.min(spB, shA); shB -= x1; shA -= x2; }
    }
    return p.margin * (ownA + ownB) + xm * (x1 + x2) + p.outMargin * (oA + oB) - p.penalty * (shA + shB) - p.opcost * (KA + KB);
  }
  // what a hub costs, built `years` from now; a second hub's fixed cost is reduced by the learning share
  function hubCost(p, K, years, second) { return K <= 0 ? 0 : (p.fFix * (second ? 1 - p.learn : 1) + p.fVar * K) * Math.pow(1 + p.escal, years); }
  function pairCost(p, KA, KB) { return KA > 0 && KB > 0 ? hubCost(p, KA, 0, false) + hubCost(p, KB, 0, true) : hubCost(p, KA, 0, false) + hubCost(p, KB, 0, false); }

  // node (t, i, j): i up-moves in A, j in B; stored row-major in an array of (t+1)² per step
  // R[t] = value of operating capacities KA, KB from step t to the end of life, no decisions
  function operate(p, L, Dm, KA, KB) {
    var N = L.N, q = L.q, R = new Array(N + 1); R[N] = new Float64Array((N + 1) * (N + 1));
    for (var t = N - 1; t >= 0; t--) {
      var s = t + 1, ns = t + 2, row = new Float64Array(s * s), nx = R[t + 1], da = Dm.a[t], db = Dm.b[t];
      for (var i = 0; i <= t; i++) for (var j = 0; j <= t; j++) {
        var u = (i + 1) * ns + j, d = i * ns + j;
        row[i * s + j] = cf(p, da[i], db[j], KA, KB) * L.dt + L.disc * (q[0] * nx[u + 1] + q[1] * nx[u] + q[2] * nx[d + 1] + q[3] * nx[d]);
      }
      R[t] = row;
    }
    return R;
  }
  // n-step joint weights (a (n+1)×(n+1) matrix, flat) and the discounted n-step expectation at node (t, i, j)
  function weights2(L, n) {
    var w = new Float64Array(1); w[0] = 1;
    for (var k = 0; k < n; k++) {
      var m = k + 1, nw = new Float64Array((m + 1) * (m + 1));
      for (var a = 0; a <= k; a++) for (var b = 0; b <= k; b++) {
        var v = w[a * (k + 1) + b]; if (!v) continue;
        nw[(a + 1) * (m + 1) + b + 1] += v * L.q[0]; nw[(a + 1) * (m + 1) + b] += v * L.q[1]; nw[a * (m + 1) + b + 1] += v * L.q[2]; nw[a * (m + 1) + b] += v * L.q[3];
      }
      w = nw;
    }
    return w;
  }
  function ahead2(X, t, i, j, n, w, discN) {
    if (n === 0) return X[t][i * (t + 1) + j];
    var row = X[t + n], s = t + n + 1, sum = 0;
    for (var a = 0; a <= n; a++) for (var b = 0; b <= n; b++) sum += w[a * (n + 1) + b] * row[(i + a) * s + j + b];
    return discN * sum;
  }
  // probability of every node (forward), for valuing fixed designs as plain expected discounted sums
  function pmf(L) {
    var pm = [new Float64Array([1])], q = L.q;
    for (var t = 0; t < L.N; t++) {
      var s = t + 1, ns = t + 2, cur = pm[t], nx = new Float64Array(ns * ns);
      for (var i = 0; i <= t; i++) for (var j = 0; j <= t; j++) {
        var v = cur[i * s + j]; if (!v) continue;
        nx[(i + 1) * ns + j + 1] += v * q[0]; nx[(i + 1) * ns + j] += v * q[1]; nx[i * ns + j + 1] += v * q[2]; nx[i * ns + j] += v * q[3];
      }
      pm.push(nx);
    }
    return pm;
  }
  // NPV of building KA and KB now and keeping them: the 3PL serves until they arrive
  function fixedValueWith(p, L, Dm, pm, before, KA, KB) {
    var v = before - pairCost(p, KA, KB), df = Math.pow(L.disc, L.Lb);
    for (var t = L.Lb; t < L.N; t++, df *= L.disc) {
      var s = t + 1, row = pm[t], da = Dm.a[t], db = Dm.b[t], e = 0;
      for (var i = 0; i <= t; i++) for (var j = 0; j <= t; j++) e += row[i * s + j] * cf(p, da[i], db[j], KA, KB);
      v += df * e * L.dt;
    }
    return v;
  }
  function beforeArrival(p, L, Dm, pm) {
    var v = 0, df = 1;
    for (var t = 0; t < Math.min(L.Lb, L.N); t++, df *= L.disc) {
      var s = t + 1, row = pm[t], da = Dm.a[t], db = Dm.b[t], e = 0;
      for (var i = 0; i <= t; i++) for (var j = 0; j <= t; j++) e += row[i * s + j] * cf(p, da[i], db[j], 0, 0);
      v += df * e * L.dt;
    }
    return v;
  }
  // maximise f over [lo, hi]: a coarse scan, then golden-section search around the best point
  function maximise(f, lo, hi) {
    var n = 9, bx = lo, bv = -Infinity;
    for (var k = 0; k <= n; k++) { var x = lo + (hi - lo) * k / n, v = f(x); if (v > bv) { bv = v; bx = x; } }
    var h = (hi - lo) / n, a = Math.max(lo, bx - h), b = Math.min(hi, bx + h), gr = (Math.sqrt(5) - 1) / 2;
    var c = b - gr * (b - a), d = a + gr * (b - a), fc = f(c), fd = f(d);
    for (var it = 0; it < 14; it++) {
      if (fc > fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = f(d); }
    }
    var xm = fc > fd ? c : d, vm = Math.max(fc, fd);
    return vm >= bv ? { x: xm, v: vm } : { x: bx, v: bv };
  }

  function solve(params) {
    var p = merge(params), L = lattice(p), N = L.N, W = L.W, Lb = L.Lb, Dm = demands(p, L), pm = pmf(L), before = beforeArrival(p, L, Dm, pm);
    var fixed = function (KA, KB) { return fixedValueWith(p, L, Dm, pm, before, KA, KB); };
    // ---- fixed designs
    var Dt = p.DA + p.DB, c = maximise(function (K) { return fixed(K, 0); }, 0.2 * Dt, 2.4 * Dt);
    var central = { npv: c.v, K: c.x };
    var KA = p.DA, KB = p.DB, two = null;
    for (var round = 0; round < 2; round++) {
      var ra = maximise(function (K) { return fixed(K, KB); }, 0.1 * p.DA, 2.6 * p.DA); KA = ra.x;
      var rb = maximise(function (K) { return fixed(KA, K); }, 0.1 * p.DB, 2.6 * p.DB); KB = rb.x;
      two = { npv: rb.v, KA: KA, KB: KB };
    }
    var KAo = p.sizeA * p.DA, KBo = p.sizeB * p.DB;
    var both = { npv: fixed(KAo, KBo), KA: KAo, KB: KBo };
    // ---- options: operating values of each state, then backward induction
    var R0 = operate(p, L, Dm, 0, 0), RA = operate(p, L, Dm, KAo, 0), RB = operate(p, L, Dm, 0, KBo), RAB = operate(p, L, Dm, KAo, KBo);
    var w = weights2(L, Lb), dN = Math.pow(L.disc, Lb), q = L.q;
    // with one hub open, the option to open the other (second hub: learning applies)
    function second(Rhave, Rnext, Kadd) {
      var V = new Array(N + 1), go = new Array(N + 1); V[N] = new Float64Array((N + 1) * (N + 1)); go[N] = new Uint8Array((N + 1) * (N + 1));
      for (var t = N - 1; t >= 0; t--) {
        var s = t + 1, ns = t + 2, row = new Float64Array(s * s), g = new Uint8Array(s * s), nx = V[t + 1], can = t <= W && t + Lb <= N;
        for (var i = 0; i <= t; i++) for (var j = 0; j <= t; j++) {
          var u = (i + 1) * ns + j, d = i * ns + j, k = i * s + j;
          var hold = Rhave[t][k] - L.disc * (q[0] * Rhave[t + 1][u + 1] + q[1] * Rhave[t + 1][u] + q[2] * Rhave[t + 1][d + 1] + q[3] * Rhave[t + 1][d]) +
            L.disc * (q[0] * nx[u + 1] + q[1] * nx[u] + q[2] * nx[d + 1] + q[3] * nx[d]);
          if (can) {
            var now = Rhave[t][k] - ahead2(Rhave, t, i, j, Lb, w, dN) + ahead2(Rnext, t, i, j, Lb, w, dN) - hubCost(p, Kadd, t * L.dt, true);
            if (now > hold) { row[k] = now; g[k] = 1; continue; }
          }
          row[k] = hold;
        }
        V[t] = row; go[t] = g;
      }
      return { V: V, go: go };
    }
    var VA = second(RA, RAB, KBo), VB = second(RB, RAB, KAo);
    // with no hub: wait, open A, open B, or both (codes 0, 1, 2, 3)
    var V0 = new Array(N + 1), act = new Array(N + 1); V0[N] = new Float64Array((N + 1) * (N + 1)); act[N] = new Uint8Array((N + 1) * (N + 1));
    for (var t = N - 1; t >= 0; t--) {
      var s = t + 1, ns = t + 2, row = new Float64Array(s * s), g = new Uint8Array(s * s), nx = V0[t + 1], can = t <= W && t + Lb <= N, yrs = t * L.dt;
      for (var i = 0; i <= t; i++) for (var j = 0; j <= t; j++) {
        var u = (i + 1) * ns + j, d = i * ns + j, k = i * s + j;
        var best = cf(p, Dm.a[t][i], Dm.b[t][j], 0, 0) * L.dt + L.disc * (q[0] * nx[u + 1] + q[1] * nx[u] + q[2] * nx[d + 1] + q[3] * nx[d]), code = 0;
        if (can) {
          var base = R0[t][k] - ahead2(R0, t, i, j, Lb, w, dN);
          var oa = base + ahead2(VA.V, t, i, j, Lb, w, dN) - hubCost(p, KAo, yrs, false);
          var ob = base + ahead2(VB.V, t, i, j, Lb, w, dN) - hubCost(p, KBo, yrs, false);
          var oab = base + ahead2(RAB, t, i, j, Lb, w, dN) - hubCost(p, KAo, yrs, false) - hubCost(p, KBo, yrs, true);
          if (oa > best) { best = oa; code = 1; }
          if (ob > best) { best = ob; code = 2; }
          if (oab > best) { best = oab; code = 3; }
        }
        row[k] = best; g[k] = code;
      }
      V0[t] = row; act[t] = g;
    }
    var base0 = R0[0][0] - ahead2(R0, 0, 0, 0, Lb, w, dN);
    var pilotA = base0 + ahead2(VA.V, 0, 0, 0, Lb, w, dN) - hubCost(p, KAo, 0, false);
    var pilotB = base0 + ahead2(VB.V, 0, 0, 0, Lb, w, dN) - hubCost(p, KBo, 0, false);
    var pilot = pilotA >= pilotB ? { npv: pilotA, region: "A", other: pilotB } : { npv: pilotB, region: "B", other: pilotA };
    return {
      version: VERSION, params: p, lattice: L, demand: Dm,
      central: central, two: two, both: both, pilot: pilot, wait: { npv: V0[0][0], act: act, V: V0 },
      VA: VA, VB: VB, R: { none: R0, A: RA, B: RB, AB: RAB }, KAo: KAo, KBo: KBo
    };
  }

  // ---- simulate paths through the joint lattice under each strategy's optimal policy (seeded, so repeatable)
  function rng(seed) { var s = seed >>> 0 || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function simulate(sol, n, seed) {
    var p = sol.params, L = sol.lattice, Dm = sol.demand, N = L.N, Lb = L.Lb, q = L.q, next = rng(seed || 7), out = [];
    for (var m = 0; m < n; m++) {
      var i = 0, j = 0, df = 1, sumA = 0, sumB = 0;
      var fx = function (KA, KB) { return { KA: 0, KB: 0, tA: KA, tB: KB, npv: -pairCost(p, KA, KB) }; };
      var S = { central: fx(sol.central.K, 0), two: fx(sol.two.KA, sol.two.KB), both: fx(sol.KAo, sol.KBo) };
      // options: capacities in place, projects under way ([K, arrival]), the state's value function to consult
      var pa = sol.pilot.region === "A";
      var P = { KA: 0, KB: 0, pend: [[pa ? sol.KAo : 0, pa ? 0 : sol.KBo, Lb]], npv: -(pa ? hubCost(p, sol.KAo, 0, false) : hubCost(p, sol.KBo, 0, false)), second: null, done: false };
      var Wt = { KA: 0, KB: 0, pend: [], npv: 0, first: null, firstYear: null, second: null, state: 0 };
      for (var t = 0; t < N; t++) {
        var s = t + 1, k = i * s + j, DA = Dm.a[t][i], DB = Dm.b[t][j], yrs = t * L.dt;
        sumA += DA; sumB += DB;
        ["central", "two", "both"].forEach(function (key) { var x = S[key]; if (t === Lb) { x.KA = x.tA; x.KB = x.tB; } x.npv += df * cf(p, DA, DB, x.KA, x.KB) * L.dt; });
        // pilot: the first hub arrives; then the other region's hub may be opened
        [P, Wt].forEach(function (x) { x.pend = x.pend.filter(function (pr) { if (t >= pr[2]) { x.KA += pr[0]; x.KB += pr[1]; return false; } return true; }); });
        if (!P.done && P.pend.length === 0 && (pa ? P.KA > 0 : P.KB > 0)) {
          var VS = pa ? sol.VA : sol.VB;
          if (VS.go[t][k]) { P.pend.push([pa ? 0 : sol.KAo, pa ? sol.KBo : 0, t + Lb]); P.npv -= df * hubCost(p, pa ? sol.KBo : sol.KAo, yrs, true); P.second = yrs; P.done = true; }
        }
        P.npv += df * cf(p, DA, DB, P.KA, P.KB) * L.dt;
        // wait & see: from no hub, open one or both; from one hub (once it is in place), the other
        if (Wt.pend.length === 0) {
          if (Wt.state === 0) {
            var c = sol.wait.act[t][k];
            if (c === 1) { Wt.pend.push([sol.KAo, 0, t + Lb]); Wt.npv -= df * hubCost(p, sol.KAo, yrs, false); Wt.state = 1; Wt.first = "A"; Wt.firstYear = yrs; }
            else if (c === 2) { Wt.pend.push([0, sol.KBo, t + Lb]); Wt.npv -= df * hubCost(p, sol.KBo, yrs, false); Wt.state = 2; Wt.first = "B"; Wt.firstYear = yrs; }
            else if (c === 3) { Wt.pend.push([sol.KAo, sol.KBo, t + Lb]); Wt.npv -= df * (hubCost(p, sol.KAo, yrs, false) + hubCost(p, sol.KBo, yrs, true)); Wt.state = 3; Wt.first = "both"; Wt.firstYear = yrs; Wt.second = yrs; }
          } else if (Wt.state === 1 || Wt.state === 2) {
            var V2 = Wt.state === 1 ? sol.VA : sol.VB;
            if (V2.go[t][k]) { var addA = Wt.state === 2; Wt.pend.push([addA ? sol.KAo : 0, addA ? 0 : sol.KBo, t + Lb]); Wt.npv -= df * hubCost(p, addA ? sol.KAo : sol.KBo, yrs, true); Wt.state = 3; Wt.second = yrs; }
          }
        }
        Wt.npv += df * cf(p, DA, DB, Wt.KA, Wt.KB) * L.dt;
        var r = next();
        if (r < q[0]) { i++; j++; } else if (r < q[0] + q[1]) i++; else if (r < q[0] + q[1] + q[2]) j++;
        df *= L.disc;
      }
      out.push({ central: S.central.npv, two: S.two.npv, both: S.both.npv, pilot: P.npv, wait: Wt.npv, pilotSecond: P.second,
        waitFirst: Wt.first, waitFirstYear: Wt.firstYear, waitSecond: Wt.second, meanA: sumA / N, meanB: sumB / N });
    }
    return out;
  }

  // helpers for the tests: a fixed design valued as an expected sum, and the same by backward induction
  function fixedNpv(params, KA, KB) { var p = merge(params), L = lattice(p), Dm = demands(p, L), pm = pmf(L); return fixedValueWith(p, L, Dm, pm, beforeArrival(p, L, Dm, pm), KA, KB); }
  function fixedNpvBackward(params, KA, KB) {
    var p = merge(params), L = lattice(p), Dm = demands(p, L), R0 = operate(p, L, Dm, 0, 0), RK = operate(p, L, Dm, KA, KB), w = weights2(L, L.Lb), dN = Math.pow(L.disc, L.Lb);
    return R0[0][0] - ahead2(R0, 0, 0, 0, L.Lb, w, dN) + ahead2(RK, 0, 0, 0, L.Lb, w, dN) - pairCost(p, KA, KB);
  }

  return { VERSION: VERSION, defaults: defaults, merge: merge, lattice: lattice, demands: demands, cf: cf, hubCost: hubCost, pairCost: pairCost,
    operate: operate, weights2: weights2, ahead2: ahead2, pmf: pmf, solve: solve, simulate: simulate, fixedNpv: fixedNpv, fixedNpvBackward: fixedNpvBackward };
});
