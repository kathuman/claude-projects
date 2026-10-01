/*
 * optimizer.js — find the cheapest designs that meet the operating targets.
 *
 * Search space: every rack type selective enough for the target (deep lanes
 * suit few products with many pallets each) × number of levels × building
 * width (in steps). Everything else is sized to fit, not searched:
 *   - aisle width    = the narrowest the rack type's truck can work in;
 *   - rack height    = just tall enough for the levels (load + beam + lift-off);
 *   - clear height   = rack height + load + sprinkler clearance (rounded up to 0.5 m);
 *   - length         = just long enough for the bays that hold the current
 *                      inventory within the rack type's planning ceiling;
 *   - dock doors     = the fewest on each side that keep the peak-hour truck
 *                      wait (Erlang C, Allen–Cunneen) under the target.
 * Throughput, peak factor, flow layout, storage policy, costs and the rest are
 * taken from the current design. Each candidate is then run through the full
 * analytic model (computeAll) and kept only if it has no critical warning, holds
 * the inventory and meets the wait target; the survivors are ranked by annual
 * total cost of ownership, and the Pareto front (no other design both cheaper
 * and quicker per move) is marked.
 *
 * Pure: window.WH.opt in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./calculations.js"));
  else { root.WH = root.WH || {}; root.WH.opt = factory(root.WH.calc); }
})(typeof self !== "undefined" ? self : this, function (calc) {
  "use strict";

  const LIMITS = { minLength: 40, maxLength: 300, minWidth: 20, maxWidth: 150, maxRackHeight: 14, minRackHeight: 3, maxClear: 18, minClear: 6, maxDoors: 20 };
  const up = function (v, step) { return Math.ceil(v / step - 1e-9) * step; };

  // the fewest doors (≥ 1) that keep this side's peak wait under the target
  function doorsFor(q, side, target) {
    for (let n = 1; n <= LIMITS.maxDoors; n++) {
      const t = calc.computeThroughput(Object.assign({}, q, side === "in" ? { num_receiving_docks: n } : { num_shipping_docks: n }));
      const s = side === "in" ? t.inbound : t.outbound;
      if (s.utilizationPct < 100 && s.waitMin <= target) return n;
    }
    return null;
  }

  // Every candidate design (parameter sets) for the search; cheap to build.
  function candidates(p, rackTypes, opts) {
    opts = opts || {};
    const step = opts.widthStep || 2.5, target = opts.targetWait === undefined ? 15 : opts.targetWait;
    // deep lanes are only an option when that many pallets needn't be reachable directly (few products, many pallets each)
    const minSel = opts.minSelectivity === undefined ? 1 : opts.minSelectivity;
    const out = [];
    const inIn = doorsFor(p, "in", target), inOut = doorsFor(p, "out", target);
    Object.keys(rackTypes).forEach(function (type) {
      if (type.charAt(0) === "$") return;
      const rt = rackTypes[type];
      if (rt.selectivity + 1e-9 < minSel) return;
      const aisle = Math.max(1.6, up(rt.min_aisle, 0.05));
      for (let levels = 2; levels <= 8; levels++) {
        const rackH = Math.max(LIMITS.minRackHeight, up((levels - 1) * (p.load_height + calc.BEAM_ALLOWANCE + 0.05), 0.1));
        if (rackH > LIMITS.maxRackHeight + 1e-9) continue;
        const clear = Math.max(LIMITS.minClear, up(rackH + p.load_height + p.sprinkler_clearance, 0.5));
        if (clear > LIMITS.maxClear + 1e-9) continue;
        for (let W = LIMITS.minWidth; W <= LIMITS.maxWidth + 1e-9; W += step) {
          const q = Object.assign({}, p, { rack_type: type, aisle_width: aisle, levels_per_rack: levels, rack_height: +rackH.toFixed(2), clear_height: +clear.toFixed(2), warehouse_width: +W.toFixed(2) });
          out.push({ q: q, inDoors: inIn, outDoors: inOut });
        }
      }
    });
    return { list: out, target: target };
  }

  // Size the length and doors of one candidate, run the full model, keep it if feasible.
  function evaluate(c, rackTypes, target) {
    if (!c.inDoors || !c.outDoors) return null;
    const q = Object.assign({}, c.q, { num_receiving_docks: c.inDoors, num_shipping_docks: c.outDoors });
    const rt = rackTypes[q.rack_type];
    const probe = calc.computeLayout(Object.assign({}, q, { warehouse_length: LIMITS.maxLength }), rackTypes);
    if (!probe.numRackRows) return null;
    const perBay = q.levels_per_rack * q.positions_per_level_per_bay * rt.deep;
    const needed = Math.ceil(q.current_inventory_pallets / rt.usable + 1e-9) + 1;       // +1 absorbs the floor() in practical capacity
    const bays = Math.max(1, Math.ceil(needed / (probe.numRackRows * perBay)));
    const mids = Math.max(0, Math.round(q.mid_cross_aisles || 0));
    const perSeg = Math.ceil(bays / (mids + 1));
    const L = Math.max(LIMITS.minLength, up(2 * q.cross_aisle_width + mids * (q.mid_cross_aisle_width || 0) + (mids + 1) * perSeg * q.bay_width + 0.01, 0.5));
    if (L > LIMITS.maxLength + 1e-9) return null;
    q.warehouse_length = L;
    const doorWall = q.flow_layout === "u_flow" ? (q.num_receiving_docks + q.num_shipping_docks) * q.dock_bay_width : Math.max(q.num_receiving_docks, q.num_shipping_docks) * q.dock_bay_width;
    if (doorWall > q.warehouse_width) return null;
    const r = calc.computeAll(q, rackTypes);
    if (r.warnings.some(function (w) { return w.level === "critical"; })) return null;
    if (r.capacity.practicalCapacity < q.current_inventory_pallets) return null;
    if (!(r.throughput.maxWait <= target)) return null;
    return {
      q: q, rackType: q.rack_type, label: rt.label, levels: q.levels_per_rack, rackHeight: q.rack_height, clearHeight: q.clear_height,
      length: q.warehouse_length, width: q.warehouse_width, aisle: q.aisle_width, doorsIn: q.num_receiving_docks, doorsOut: q.num_shipping_docks,
      rows: r.layout.numRackRows, bays: r.layout.baysPerRow, capacity: r.capacity.storageCapacity, practical: r.capacity.practicalCapacity,
      selectivity: r.capacity.selectivity, perMove: r.travel.perMove, trucks: r.travel.forkliftsNeeded, wait: r.throughput.maxWait,
      footprint: r.cost.footprint, capital: r.cost.capitalCost, tco: r.cost.annualTCO, costPerMove: r.cost.costPerMove
    };
  }

  function finish(designs) {
    designs.sort(function (a, b) { return a.tco - b.tco; });
    // Pareto front on (annual TCO, time per move): sweep in cost order, keep each new best time
    let best = Infinity;
    designs.forEach(function (d) { d.pareto = d.perMove < best - 1e-9; if (d.pareto) best = d.perMove; });
    return designs;
  }

  // Synchronous search (tests; small steps). The page runs candidates() + evaluate() in chunks.
  function search(p, rackTypes, opts) {
    const c = candidates(p, rackTypes, opts), designs = [];
    c.list.forEach(function (x) { const d = evaluate(x, rackTypes, c.target); if (d) designs.push(d); });
    return { designs: finish(designs), evaluated: c.list.length, target: c.target };
  }

  return { candidates, evaluate, finish, search, doorsFor, LIMITS };
});
