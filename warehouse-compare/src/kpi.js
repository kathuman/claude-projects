/*
 * kpi.js — the one set of measures every layout is judged by.
 *
 * Person-to-goods order picking at order-line level: a picker takes one order,
 * walks the shortest tour (routing.js) from a picking point past every
 * location the order needs and back, and spends a fixed time per order and per
 * line, plus lift time for any line above reach height.
 *
 *   time per order = setup + tour / speed + Σ_lines (pick time + reach time)
 *
 * The tour is averaged over a seeded sample of orders (the same orders for
 * every layout). For single-line orders there is also an exact expectation —
 * Σ_sku share × round trip to its location — which the tests use to check
 * the sample.
 *
 * evaluate(layout, scenario) works for any layout object of the form
 *   { id, name, M (graph.keyMatrix()), depots: [key], footprint (m²),
 *     locations: { n, key: Int32Array, z: Float64Array }, warnings, trace }
 *
 * Pure, no DOM: window.WC.kpi in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./demand.js"), require("./routing.js"), require("./slotting.js"));
  else { root.WC = root.WC || {}; root.WC.kpi = factory(root.WC.demand, root.WC.routing, root.WC.slotting); }
})(typeof self !== "undefined" ? self : this, function (demand, routing, slotting) {
  "use strict";

  // The KPI contract: what is reported for every layout, with its unit and
  // which direction is better. `only` marks a measure that applies to some
  // layouts (the others show "—").
  const KPI_DEFS = [
    { key: "locations",          label: "Storage locations",          unit: "",        better: "higher", d: 0 },
    { key: "footprint",          label: "Floor area",                 unit: "m²",      better: "lower",  d: 0 },
    { key: "density",            label: "Locations per m²",           unit: "/m²",     better: "higher", d: 2 },
    { key: "travelPerOrder",     label: "Picker travel per order",    unit: "m",       better: "lower",  d: 1 },
    { key: "travelPerLine",      label: "Picker travel per line",     unit: "m",       better: "lower",  d: 1 },
    { key: "timePerLine",        label: "Picker time per line",       unit: "s",       better: "lower",  d: 1 },
    { key: "linesPerHour",       label: "Lines per picker-hour",      unit: "lines/h", better: "higher", d: 0 },
    { key: "pickersNeeded",      label: "Pickers needed at the peak", unit: "",        better: "lower",  d: 0 },
    { key: "travelShare",        label: "Share of time walking",      unit: "%",       better: "lower",  d: 0 },
    { key: "robotsNeeded",       label: "Robots needed at the peak",  unit: "",        better: "lower",  d: 0, only: "A" },
    { key: "robotTravelPerLine", label: "Robot travel per line",      unit: "m",       better: "lower",  d: 1, only: "A" },
    { key: "pileOn",             label: "Lines per pod visit",        unit: "",        better: "higher", d: 2, only: "A" }
  ];
  function applies(def, id) { return !def.only || def.only.indexOf(id) >= 0; }

  const fmt = function (v, d) { return Number(v).toFixed(d === undefined ? 1 : d); };

  // Random and ABC slotting place SKUs by chance. Judged on one draw, the few
  // top SKUs land near or far by luck and that luck dominates the result at
  // high skew (it moved WH-C's travel per line by ±15% between seeds). So those
  // policies are evaluated in expectation over every possible draw: each
  // order's SKUs get fresh distinct locations, uniform over all locations
  // (random) or over their class's locations (ABC) — exactly the distribution
  // an order sees under a random slotting. Ranked slotting has nothing random.
  function orderLocations(order, model, fixed, rnd) {
    const out = new Array(order.length);
    if (!model) { for (let i = 0; i < order.length; i++) out[i] = fixed[order[i]]; return out; }
    const used = new Set();
    for (let i = 0; i < order.length; i++) {
      const pool = model.locs[model.skuClass[order[i]]];
      let loc;
      do { loc = pool[Math.floor(rnd() * pool.length)]; } while (used.has(loc));
      used.add(loc); out[i] = loc;
    }
    return out;
  }

  // Exact expected round trip for a single-line order from the nearest picking
  // point: Σ_sku share × round trip to its location (fixed slotting), or to the
  // mean location of its class (random / ABC, in expectation).
  function exactSingleLine(layout, res) {
    const near = slotting.locationCost(layout, { picker_speed: 1, lift_speed: 1, reach_height: Infinity }).nearest;
    const key = layout.locations.key, w = res.weights, m = res.slotModel;
    let e = 0;
    if (!m) { for (let s = 0; s < w.length; s++) e += w[s] * 2 * near[key[res.skuLoc[s]]]; return e; }
    const clsMean = m.locs.map(function (pool) { let t = 0; for (let i = 0; i < pool.length; i++) t += near[key[pool[i]]]; return t / pool.length; });
    for (let s = 0; s < w.length; s++) e += w[s] * 2 * clsMean[m.skuClass[s]];
    return e;
  }

  function evaluate(layout, sc, opts) {
    opts = opts || {};
    const nOrders = opts.orders || sc.sample_orders || 2000;
    const seed = opts.seed === undefined ? sc.seed : opts.seed;
    const op = sc;                                         // picker_speed, lift_speed, reach_height, …
    const warnings = (layout.warnings || []).slice();
    if (sc.skus > layout.locations.n) {
      return { layout: layout, infeasible: true, warnings: warnings.concat([{ level: "critical", text: "Only " + layout.locations.n + " storage locations for " + sc.skus + " SKUs." }]) };
    }
    const stream = demand.orderStream(sc, seed);
    const slotRnd = demand.mulberry32((seed ^ 0x9e3779b9) >>> 0);
    const skuLoc = slotting.assign(layout, sc.skus, sc.slotting, op, slotRnd);     // one draw: what the plan shows
    const slotModel = slotting.classes(layout, sc.skus, sc.slotting, op);        // null for ranked
    const L = layout.locations;

    let sumTour = 0, sumLines = 0, sumStops = 0, sumReach = 0;
    const tours = new Float64Array(nOrders);
    for (let o = 0; o < nOrders; o++) {
      const order = stream.next(), locs = orderLocations(order, slotModel, skuLoc, slotRnd), keys = new Array(order.length);
      for (let i = 0; i < order.length; i++) { const loc = locs[i]; keys[i] = L.key[loc]; sumReach += slotting.reachTime(L.z[loc], op); }
      const r = routing.route(layout.M, layout.depots, keys);
      tours[o] = r.dist; sumTour += r.dist; sumLines += order.length; sumStops += r.stops;
    }
    const travelPerOrder = sumTour / nOrders, linesPerOrder = sumLines / nOrders;
    const walkTime = travelPerOrder / sc.picker_speed;
    const orderTime = sc.order_setup_time + walkTime + linesPerOrder * sc.pick_time_per_line + sumReach / nOrders;
    const timePerLine = orderTime / linesPerOrder;
    const linesPerHour = 3600 / timePerLine;
    const peakLinesPerHour = sc.lines_per_day / sc.operating_hours_per_day * sc.peak_hour_factor;
    const workload = peakLinesPerHour * timePerLine / 3600;               // picker-hours per hour
    const pickersNeeded = Math.max(1, Math.ceil(workload / sc.picker_efficiency - 1e-9));
    let v = 0; for (let o = 0; o < nOrders; o++) v += (tours[o] - travelPerOrder) * (tours[o] - travelPerOrder);
    const travelSE = Math.sqrt(v / Math.max(1, nOrders - 1) / nOrders);

    const k = {
      locations: L.n, footprint: layout.footprint, density: L.n / layout.footprint,
      travelPerOrder: travelPerOrder, travelPerLine: travelPerOrder / linesPerOrder,
      timePerLine: timePerLine, linesPerHour: linesPerHour, pickersNeeded: pickersNeeded,
      travelShare: 100 * walkTime / orderTime
    };
    const trace = [
      { label: "Orders sampled", expr: "seeded order stream, same for every layout", value: nOrders + " orders, " + fmt(linesPerOrder, 2) + " lines and " + fmt(sumStops / nOrders, 2) + " stops each" },
      { label: "Slotting", expr: sc.slotting === "ranked" ? "k-th most popular SKU → k-th closest location" : sc.slotting === "abc" ? "ABC classes 20/30/50% of SKUs and of locations" : "random", value: sc.skus + " SKUs in " + L.n + " locations (" + fmt(100 * sc.skus / L.n, 0) + "% full)" + (slotModel ? "; travel is the expectation over every possible " + (sc.slotting === "abc" ? "ABC" : "random") + " slotting" : "") },
      { label: "Travel per order", expr: "mean shortest tour (exact up to " + routing.EXACT_MAX + " stops, else nearest neighbour + 2-opt)", value: fmt(travelPerOrder, 1) + " m ± " + fmt(1.96 * travelSE, 1) },
      { label: "Time per order", expr: "setup + travel / speed + lines × pick time + reach time", value: fmt(sc.order_setup_time, 0) + " + " + fmt(walkTime, 0) + " + " + fmt(linesPerOrder * sc.pick_time_per_line, 0) + " + " + fmt(sumReach / nOrders, 0) + " = " + fmt(orderTime, 0) + " s" },
      { label: "Time per line", expr: "time per order / lines per order", value: fmt(timePerLine, 1) + " s → " + fmt(linesPerHour, 0) + " lines per picker-hour" },
      { label: "Pickers at the peak", expr: "ceil(lines/day ÷ hours × peak factor × time per line ÷ efficiency)", value: fmt(peakLinesPerHour, 0) + " lines/h × " + fmt(timePerLine, 1) + " s = " + fmt(workload, 2) + " → " + pickersNeeded }
    ];
    return {
      layout: layout, kpi: k, skuLoc: skuLoc, slotModel: slotModel, weights: stream.weights, travelSE: travelSE,
      warnings: warnings, trace: (layout.trace || []).concat(trace)
    };
  }

  return { KPI_DEFS, applies, evaluate, exactSingleLine };
});
