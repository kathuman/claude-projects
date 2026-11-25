/*
 * routing.js — the picker's tour for one order, the same for every layout.
 *
 * A picker leaves a picking point, stops at every access point the order's
 * lines need, and returns to a picking point (the same one, or — when allowed —
 * the closest one at the end). Layout-specific heuristics like S-shape or
 * largest-gap would favour the rectangular layout they were designed for, so
 * this uses a layout-agnostic method on the shortest-path matrix instead:
 *
 *   up to EXACT_MAX distinct stops  Held–Karp dynamic programme (optimal)
 *   more stops                      nearest neighbour, then 2-opt until no
 *                                   improving swap is left
 *
 * Distances come from graph.keyMatrix(): M.at(i, j) between key indices.
 * Pure, no DOM: window.WC.routing in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.WC = root.WC || {}; root.WC.routing = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const EXACT_MAX = 9;

  // Shortest closed tour depot → all stops → depot. stops: distinct key indices
  // (none equal to depot). Returns { dist, order }.
  function heldKarp(M, depot, stops) {
    const n = stops.length;
    if (n === 0) return { dist: 0, order: [] };
    if (n === 1) return { dist: M.at(depot, stops[0]) + M.at(stops[0], depot), order: stops.slice() };
    const S = 1 << n, dp = new Float64Array(S * n).fill(Infinity), par = new Int8Array(S * n).fill(-1);
    for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = M.at(depot, stops[j]);
    for (let mask = 1; mask < S; mask++) {
      for (let j = 0; j < n; j++) {
        const cur = dp[mask * n + j];
        if (!(mask & (1 << j)) || cur === Infinity) continue;
        for (let k = 0; k < n; k++) {
          if (mask & (1 << k)) continue;
          const m2 = mask | (1 << k), v = cur + M.at(stops[j], stops[k]);
          if (v < dp[m2 * n + k]) { dp[m2 * n + k] = v; par[m2 * n + k] = j; }
        }
      }
    }
    const full = S - 1;
    let best = Infinity, last = -1;
    for (let j = 0; j < n; j++) { const v = dp[full * n + j] + M.at(stops[j], depot); if (v < best) { best = v; last = j; } }
    const order = []; let mask = full, j = last;
    while (j >= 0) { order.push(stops[j]); const pj = par[mask * n + j]; mask &= ~(1 << j); j = pj; }
    order.reverse();
    return { dist: best, order: order };
  }

  function tourLength(M, depot, order) {
    if (!order.length) return 0;
    let d = M.at(depot, order[0]);
    for (let i = 1; i < order.length; i++) d += M.at(order[i - 1], order[i]);
    return d + M.at(order[order.length - 1], depot);
  }

  function nn2opt(M, depot, stops) {
    const left = stops.slice(), order = [];
    let cur = depot;
    while (left.length) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < left.length; i++) { const d = M.at(cur, left[i]); if (d < bd) { bd = d; bi = i; } }
      cur = left[bi]; order.push(cur); left.splice(bi, 1);
    }
    // 2-opt on the closed tour [depot, ...order, depot]
    const t = [depot].concat(order, [depot]);
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 1; i < t.length - 2; i++) {
        for (let k = i + 1; k < t.length - 1; k++) {
          const delta = M.at(t[i - 1], t[k]) + M.at(t[i], t[k + 1]) - M.at(t[i - 1], t[i]) - M.at(t[k], t[k + 1]);
          if (delta < -1e-9) { for (let a = i, b = k; a < b; a++, b--) { const s = t[a]; t[a] = t[b]; t[b] = s; } improved = true; }
        }
      }
    }
    const o = t.slice(1, -1);
    return { dist: tourLength(M, depot, o), order: o };
  }

  // One order's tour from the best picking point. depots: key indices of the
  // picking points; stopKeys: key indices of the order's access points (may
  // repeat — two lines at one access point are one stop).
  function route(M, depots, stopKeys) {
    const uniq = [], seen = new Set();
    for (let i = 0; i < stopKeys.length; i++) if (!seen.has(stopKeys[i])) { seen.add(stopKeys[i]); uniq.push(stopKeys[i]); }
    let best = null;
    for (let d = 0; d < depots.length; d++) {
      const dep = depots[d], s = uniq.filter(function (k) { return k !== dep; });
      const r = s.length <= EXACT_MAX ? heldKarp(M, dep, s) : nn2opt(M, dep, s);
      if (!best || r.dist < best.dist) best = { dist: r.dist, order: r.order, depot: dep, stops: uniq.length };
    }
    return best;
  }

  return { EXACT_MAX, heldKarp, nn2opt, tourLength, route };
});
