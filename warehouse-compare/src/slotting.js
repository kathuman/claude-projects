/*
 * slotting.js — which SKU goes into which storage location.
 *
 * Every layout exposes its locations with an access key (where the picker
 * stops) and a height. A location's "cost" is the one-way travel time from
 * the closest picking point plus the time to reach its height. The policies:
 *
 *   random   SKUs placed in a random permutation of the locations
 *   abc      locations ranked by cost and split 20% / 30% / 50% into A, B, C;
 *            SKUs ranked by popularity and split the same way; random within
 *            each class (the Warehouse Model's ABC rule)
 *   ranked   full turnover-based slotting: the k-th most popular SKU gets the
 *            k-th cheapest location
 *
 * Pure, no DOM: window.WC.slotting in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.WC = root.WC || {}; root.WC.slotting = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ABC_BOUNDS = [0.2, 0.5];

  // Time to reach a location's height and back: nothing within the picker's
  // reach, lift time for the part above it.
  function reachTime(z, op) {
    return 2 * Math.max(0, z - (op.reach_height || 0)) / op.lift_speed;
  }

  // One-way time from the nearest picking point to each location (+ reach).
  function locationCost(layout, op) {
    const L = layout.locations, M = layout.M, cost = new Float64Array(L.n);
    const nearest = new Float64Array(M.K).fill(Infinity);
    for (let k = 0; k < M.K; k++) for (let d = 0; d < layout.depots.length; d++) nearest[k] = Math.min(nearest[k], M.at(layout.depots[d], k));
    for (let i = 0; i < L.n; i++) cost[i] = nearest[L.key[i]] / op.picker_speed + reachTime(L.z[i], op) / 2;
    return { cost: cost, nearest: nearest };
  }

  function shuffle(a, rnd) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // Returns Int32Array skuLoc (location of each SKU; SKUs are in popularity order).
  function assign(layout, nSku, policy, op, rnd) {
    const n = layout.locations.n;
    if (nSku > n) throw new Error("more SKUs (" + nSku + ") than storage locations (" + n + ")");
    const cost = locationCost(layout, op).cost;
    const byCost = Array.from({ length: n }, function (_, i) { return i; }).sort(function (a, b) { return cost[a] - cost[b] || a - b; });
    const out = new Int32Array(nSku);
    if (policy === "ranked") { for (let s = 0; s < nSku; s++) out[s] = byCost[s]; return out; }
    if (policy === "abc") {
      // Classes span all locations: class A is the cheapest 20% of locations,
      // and the A SKUs fill it at random.
      const locCls = [[], [], []];
      byCost.forEach(function (loc, r) { const u = (r + 0.5) / n; locCls[u < ABC_BOUNDS[0] ? 0 : u < ABC_BOUNDS[1] ? 1 : 2].push(loc); });
      const skuCls = [[], [], []];
      for (let s = 0; s < nSku; s++) { const u = (s + 0.5) / nSku; skuCls[u < ABC_BOUNDS[0] ? 0 : u < ABC_BOUNDS[1] ? 1 : 2].push(s); }
      // A SKU that doesn't fit its class's locations spills into the next class.
      let spill = [];
      for (let c = 0; c < 3; c++) {
        const locs = shuffle(locCls[c].slice(), rnd), skus = spill.concat(skuCls[c]);
        spill = [];
        skus.forEach(function (s, i) { if (i < locs.length) out[s] = locs[i]; else spill.push(s); });
      }
      if (spill.length) throw new Error("ABC slotting ran out of locations");
      return out;
    }
    const perm = shuffle(Array.from({ length: n }, function (_, i) { return i; }), rnd);
    for (let s = 0; s < nSku; s++) out[s] = perm[s];
    return out;
  }

  // The random part of a policy, for evaluating it in expectation. Under random
  // slotting every SKU is equally likely to be in any location; under ABC, in
  // any location of its class. Returns { skuClass, locs: [Int32Array per class] },
  // or null for ranked slotting (nothing random). Each class has at least as
  // many locations as SKUs (both are split by the same fractions, nSku ≤ n).
  function classes(layout, nSku, policy, op) {
    const n = layout.locations.n;
    if (policy === "ranked") return null;
    if (policy !== "abc") return { skuClass: new Uint8Array(nSku), locs: [Int32Array.from({ length: n }, function (_, i) { return i; })] };
    const cost = locationCost(layout, op).cost;
    const byCost = Array.from({ length: n }, function (_, i) { return i; }).sort(function (a, b) { return cost[a] - cost[b] || a - b; });
    const locCls = [[], [], []], skuClass = new Uint8Array(nSku), count = [0, 0, 0];
    byCost.forEach(function (loc, r) { const u = (r + 0.5) / n; locCls[u < ABC_BOUNDS[0] ? 0 : u < ABC_BOUNDS[1] ? 1 : 2].push(loc); });
    for (let s = 0; s < nSku; s++) { const u = (s + 0.5) / nSku; skuClass[s] = u < ABC_BOUNDS[0] ? 0 : u < ABC_BOUNDS[1] ? 1 : 2; count[skuClass[s]]++; }
    for (let c = 0; c < 3; c++) if (count[c] > locCls[c].length) throw new Error("ABC class " + "ABC"[c] + " has more SKUs than locations");
    return { skuClass: skuClass, locs: locCls.map(function (a) { return Int32Array.from(a); }) };
  }

  return { ABC_BOUNDS, reachTime, locationCost, assign, classes };
});
