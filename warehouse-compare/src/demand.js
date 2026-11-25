/*
 * demand.js — one demand model shared by all three warehouses.
 *
 * SKU popularity: the most popular fraction u of SKUs generates F(u) of the
 * order lines, with F(0.2) = demand_skew. Default curve is Bender's
 * F(u) = (1 + A)u / (A + u); the Warehouse Model's class-level u^k is an
 * option (see curve()). SKU 0 is the most popular; weights sum to 1.
 *
 * Orders are sets of distinct SKUs (one order line per SKU). The number of
 * lines per order is geometric with the given mean (1 line is the most
 * common, as in e-commerce), capped at max_lines.
 *
 * Every random draw comes from a seeded generator, so two layouts given the
 * same seed see exactly the same orders — the comparison is paired.
 *
 * Pure, no DOM: window.WC.demand in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.WC = root.WC || {}; root.WC.demand = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function skewExponent(skewPct) {
    const s = Math.max(0.2, Math.min(0.99, skewPct / 100));
    return Math.log(s) / Math.log(0.2);
  }

  // Bender's curve F(u) = (1 + A)·u / (A + u), with A set so F(0.2) = skew.
  function benderA(skewPct) {
    const s = Math.max(0.2, Math.min(0.99, skewPct / 100));
    return s <= 0.2 + 1e-9 ? Infinity : 0.2 * (1 - s) / (s - 0.2);
  }

  // Cumulative share of lines from the most popular fraction u of SKUs.
  //   "bender" (default)  F(u) = (1 + A)·u / (A + u) — finite slope at u = 0, so
  //                       no single SKU dominates (top SKU of 6,000 at 80/20:
  //                       0.27% of lines)
  //   "power"             F(u) = u^k, the Warehouse Model's class-level curve —
  //                       infinitely steep at u = 0 (top SKU of 6,000: 30%)
  // Both pass through F(0.2) = demand_skew.
  function curve(skewPct, kind) {
    if (kind === "power") { const k = skewExponent(skewPct); return function (u) { return Math.pow(u, k); }; }
    const A = benderA(skewPct);
    return A === Infinity ? function (u) { return u; } : function (u) { return (1 + A) * u / (A + u); };
  }

  // Share of order lines for each SKU, most popular first.
  function skuWeights(nSku, skewPct, kind) {
    const F = curve(skewPct, kind), w = new Float64Array(nSku);
    let prev = 0;
    for (let i = 0; i < nSku; i++) { const v = F((i + 1) / nSku); w[i] = v - prev; prev = v; }
    return w;
  }

  // Inverse-CDF sampler over weights (binary search).
  function sampler(w) {
    const n = w.length, cum = new Float64Array(n); let acc = 0;
    for (let i = 0; i < n; i++) { acc += w[i]; cum[i] = acc; }
    return function (u) { let lo = 0, hi = n - 1; u *= acc; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < u) lo = m + 1; else hi = m; } return lo; };
  }

  // Geometric lines-per-order distribution with mean m on {1, 2, ...}, capped.
  function linesPmf(mean, maxLines) {
    const p = 1 / Math.max(1, mean), out = [];
    let tot = 0;
    for (let l = 1; l <= maxLines; l++) { const v = p * Math.pow(1 - p, l - 1); out.push(v); tot += v; }
    return out.map(function (v) { return v / tot; });
  }

  // A generator of orders: next() returns an array of distinct SKU indices.
  function orderStream(s, seed) {
    const rnd = mulberry32(seed >>> 0);
    let w = skuWeights(s.skus, s.demand_skew, s.demand_curve), pick = sampler(w);
    const maxL = Math.min(s.max_lines, s.skus), pmf = linesPmf(s.lines_per_order, maxL);
    const nextLines = sampler(Float64Array.from(pmf));
    const self = {
      weights: w,
      next: function () {
        const L = nextLines(rnd()) + 1, seen = new Set(), out = [];
        while (out.length < L) { const k = pick(rnd()); if (!seen.has(k)) { seen.add(k); out.push(k); } }
        return out;
      },
      // change which SKUs are popular from now on (the demand-shock experiment)
      reweight: function (nw) { w = nw; pick = sampler(w); self.weights = w; },
      rnd: rnd
    };
    return self;
  }

  // The demand shock: SKU k now sells like SKU k − shift·n did, so the SKUs
  // `shift` of the way down the ranking become the best-sellers. Shifting (not
  // shuffling) keeps similar SKUs together, so in WH-A hot pods stay hot as a
  // group; only which ones are hot changes.
  function shifted(w, shift) {
    const n = w.length, off = Math.round((shift === undefined ? 0.5 : shift) * n), out = new Float64Array(n);
    for (let k = 0; k < n; k++) out[k] = w[((k - off) % n + n) % n];
    return out;
  }

  // Mean lines per order after the cap (what the stream really produces).
  function meanLines(s) {
    const pmf = linesPmf(s.lines_per_order, Math.min(s.max_lines, s.skus));
    return pmf.reduce(function (a, v, i) { return a + v * (i + 1); }, 0);
  }

  return { mulberry32, skewExponent, benderA, curve, skuWeights, sampler, linesPmf, orderStream, meanLines, shifted };
});
