/*
 * generator.js — a parametric synthetic network generator, so a user
 * facing "hundreds of nodes" has something to start editing/importing
 * over rather than an empty grid. Not meant to be geographically
 * authoritative: nodes cluster around a handful of real-world regions
 * (so the map looks like a plausible trade network, not uniform noise)
 * with random offsets within each region.
 */
(function (global) {
  "use strict";

  const modeDefaultsMod = (typeof module !== "undefined" && module.exports)
    ? require("./modeDefaults.js")
    : global.NST.modeDefaults;
  const haversineKm = modeDefaultsMod.haversineKm;
  const defaultsForLane = modeDefaultsMod.defaultsForLane;

  // A handful of real-world-ish trade regions: [lat, lon, spreadDeg, manufacturingWeight]
  const REGIONS = [
    { name: "East Asia", lat: 31, lon: 118, spread: 8, mfg: 1.0 },
    { name: "South Asia", lat: 20, lon: 78, spread: 9, mfg: 0.8 },
    { name: "Southeast Asia", lat: 8, lon: 106, spread: 7, mfg: 0.9 },
    { name: "Western Europe", lat: 49, lon: 8, spread: 7, mfg: 0.5 },
    { name: "Eastern N. America", lat: 39, lon: -83, spread: 8, mfg: 0.4 },
    { name: "Western N. America", lat: 40, lon: -110, spread: 8, mfg: 0.3 },
    { name: "South America", lat: -15, lon: -55, spread: 10, mfg: 0.25 },
    { name: "Middle East", lat: 25, lon: 48, spread: 8, mfg: 0.3 },
  ];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function weightedRegion(rnd, weightKey) {
    const weights = REGIONS.map((r) => (weightKey ? r[weightKey] : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let x = rnd() * total;
    for (let i = 0; i < REGIONS.length; i++) { x -= weights[i]; if (x <= 0) return REGIONS[i]; }
    return REGIONS[REGIONS.length - 1];
  }

  function jitterInRegion(rnd, region) {
    const lat = region.lat + (rnd() - 0.5) * 2 * region.spread;
    const lon = region.lon + (rnd() - 0.5) * 2 * region.spread;
    return { lat: Math.max(-85, Math.min(85, lat)), lon: ((lon + 540) % 360) - 180 };
  }

  function pickMode(distanceKm, rnd) {
    // short hops favor road, long hops favor sea (cheap) with some air for
    // speed-sensitive lanes -- a plausible default, not a logistics model.
    if (distanceKm < 800) return rnd() < 0.85 ? "road" : "air";
    if (distanceKm < 3000) return rnd() < 0.55 ? "sea" : rnd() < 0.8 ? "road" : "air";
    return rnd() < 0.75 ? "sea" : "air";
  }

  /**
   * opts: {
   *   numProduction, numWarehouse, numConsumer,
   *   numProducts,
   *   fanout,       // candidate downstream connections per node
   *   seed
   * }
   */
  function generateNetwork(opts) {
    const rnd = mulberry32(opts.seed || 1);
    const nP = opts.numProduction, nW = opts.numWarehouse, nC = opts.numConsumer;
    const nProducts = opts.numProducts || 1;
    const fanout = opts.fanout || 5;

    const products = [];
    for (let i = 0; i < nProducts; i++) products.push({ id: "PROD" + i, name: "Product " + String.fromCharCode(65 + i), priority: i + 1 });

    const nodes = [];
    function makeNode(idPrefix, i, type, regionWeightKey) {
      const region = weightedRegion(rnd, regionWeightKey);
      const pos = jitterInRegion(rnd, region);
      const node = { id: idPrefix + i, name: idPrefix + i + " (" + region.name + ")", type: type, lat: pos.lat, lon: pos.lon, products: {} };
      // each node handles a random subset of products (at least 1) --
      // this is where "different node capabilities" comes from.
      const handledCount = 1 + Math.floor(rnd() * nProducts);
      const handled = new Set();
      while (handled.size < handledCount) handled.add(Math.floor(rnd() * nProducts));
      handled.forEach((pi) => {
        const pid = products[pi].id;
        if (type === "production") node.products[pid] = Math.round(50 + rnd() * 400);
        else if (type === "warehouse") node.products[pid] = Math.round(100 + rnd() * 800);
        else node.products[pid] = Math.round(10 + rnd() * 150);
      });
      return node;
    }

    for (let i = 0; i < nP; i++) nodes.push(makeNode("P", i, "production", "mfg"));
    for (let i = 0; i < nW; i++) nodes.push(makeNode("W", i, "warehouse", null));
    for (let i = 0; i < nC; i++) nodes.push(makeNode("C", i, "consumer", null));

    const production = nodes.filter((n) => n.type === "production");
    const warehouse = nodes.filter((n) => n.type === "warehouse");
    const consumer = nodes.filter((n) => n.type === "consumer");

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const edges = [];
    let edgeSeq = 0;
    function nearestCandidates(from, pool, k) {
      return pool
        .map((n) => ({ n: n, d: haversineKm(from.lat, from.lon, n.lat, n.lon) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, k);
    }
    function addEdge(from, to, capacityHint) {
      const d = haversineKm(from.lat, from.lon, to.lat, to.lon);
      const mode = pickMode(d, rnd);
      const base = defaultsForLane(from.lat, from.lon, to.lat, to.lon, mode);
      edges.push({
        id: "E" + (edgeSeq++), from: from.id, to: to.id, mode: mode,
        capacity: capacityHint !== undefined ? Math.round(capacityHint) : Math.round(30 + rnd() * 250),
        costPerUnit: Math.round(base.costPerUnit * 100) / 100,
        leadTimeDays: Math.round(base.leadTimeDays * 10) / 10,
        baseFailureRate: base.baseFailureRate,
      });
    }
    function connect(from, pool, kBase) {
      if (pool.length === 0) return;
      const k = Math.min(pool.length, kBase + Math.floor(rnd() * 2));
      nearestCandidates(from, pool, k).forEach(({ n: to }) => addEdge(from, to));
    }

    production.forEach((p) => connect(p, warehouse.length ? warehouse : consumer, fanout));
    warehouse.forEach((w) => connect(w, consumer, fanout));
    // a modest number of warehouse-to-warehouse transfer lanes
    warehouse.forEach((w) => { if (rnd() < 0.3) connect(w, warehouse.filter((x) => x.id !== w.id), 1); });
    // a few direct production -> consumer lanes (bypassing warehousing), if any warehouses exist
    if (warehouse.length > 0) production.forEach((p) => { if (rnd() < 0.15) connect(p, consumer, 1); });

    // Coverage guarantee, done twice over:
    //
    // 1. Plain connectivity: "nearest-k FROM each source" does not
    //    guarantee every target gets picked by anyone -- a node far from
    //    its potential suppliers' nearest-neighbor lists can end up with
    //    zero inbound edges (measured: ~29% of consumers, at 330 nodes,
    //    before this pass existed).
    // 2. Product-matched connectivity: having *an* inbound edge doesn't
    //    mean it carries a product the target actually handles -- a
    //    warehouse can hold product X with zero connected upstream
    //    source of X. Measured after fix #1 alone: service level barely
    //    moved (37%->43%), because #1 doesn't address this. This pass
    //    checks, per product a node handles, whether any inbound edge
    //    connects it to an upstream node that ALSO handles that product;
    //    if not, it connects to the nearest one that does.
    function inboundFrom(targetId) {
      return edges.filter((e) => e.to === targetId).map((e) => e.from);
    }
    function ensureProductMatchedInbound(targets, sourcePool) {
      targets.forEach((t) => {
        const already = new Set(inboundFrom(t.id));
        Object.keys(t.products).forEach((pid) => {
          const hasMatch = Array.from(already).some((srcId) => {
            const src = nodeById.get(srcId);
            return src && src.products[pid] !== undefined;
          });
          if (hasMatch) return;
          const candidates = sourcePool.filter((s) => s.products[pid] !== undefined);
          if (candidates.length === 0) return; // no node anywhere makes/stocks this product -- leave as genuine unmet demand
          const nearest = nearestCandidates(t, candidates, 1)[0];
          // Sized so this guarantee edge alone isn't the bottleneck for t's
          // own need of this product -- any remaining shortfall then comes
          // from a genuine upstream constraint (production capacity, a
          // shared lane also serving other nodes), not from this pass
          // having under-provisioned the one path it guarantees exists.
          if (nearest) { addEdge(nearest.n, t, t.products[pid]); already.add(nearest.n.id); }
        });
      });
    }
    ensureProductMatchedInbound(warehouse, production);
    ensureProductMatchedInbound(consumer, warehouse.length ? warehouse.concat(production) : production);

    return { products: products, nodes: nodes, edges: edges };
  }

  const mod = { generateNetwork: generateNetwork, REGIONS: REGIONS };
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  else { global.NST = global.NST || {}; global.NST.generator = mod; }
})(typeof window !== "undefined" ? window : globalThis);
