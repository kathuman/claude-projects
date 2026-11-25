/*
 * layouts/whc.js — WH-C, the rectangular warehouse, as a travel network.
 *
 * No new geometry: rows, aisles, bays, levels and cross-aisles come straight
 * from the Warehouse Model's own computeLayout() (warehouse-model/web/src/
 * calculations.js), so WH-C here is the same building as there. This file
 * only turns that layout into a graph:
 *
 *   aisle a      nodes along y = aisle.y at the front wall (x = 0), at every
 *                cross-aisle centre, at every bay centre (the access points)
 *                and at the back wall (x = L), joined in order of x
 *   front line   the x = 0 nodes of every aisle plus the picking points,
 *                joined in order of y (the staging zone along the west wall)
 *   back line    the x = L nodes (plus I-flow shipping doors), joined in y
 *   cross-aisles the nodes at each cross-aisle centre, joined in y
 *
 * Distances through this graph reproduce the Warehouse Model's rectilinear
 * formulas exactly (tests/whc.test.js): door → slot is |y_door − y_aisle| + x
 * as in slotGrid(), slot → slot is dcPair()'s "between" term.
 *
 * Storage location = one pick face: (row, bay, level, position). Deep lanes
 * (double-deep, push-back, drive-in) still give one pick face per lane.
 *
 * Pure, no DOM: window.WC.layouts.C in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("../graph.js"), require("../../../warehouse-model/web/src/calculations.js"), require("../t.js"));
  else { root.WC = root.WC || {}; root.WC.layouts = root.WC.layouts || {}; root.WC.layouts.C = factory(root.WC.graph, root.WH.calc, root.WC.t); }
})(typeof self !== "undefined" ? self : this, function (G, calc, tr) {
  "use strict";
  const T = tr.T, fx = tr.fx, int = tr.int;

  // Hand-picking shelving, added beside the Warehouse Model's pallet-rack types
  // (a walking picker with a cart needs about a metre of aisle).
  const EXTRA_RACK_TYPES = {
    shelving: { label: "Shelving (hand picking)", deep: 1, selectivity: 1.0, min_aisle: 1.0, usable: 0.9, truck: "picking cart", truck_cost: 1500 }
  };
  function rackTypesWith(rt) { return Object.assign({}, rt || {}, EXTRA_RACK_TYPES); }

  // Picking points spaced along the west wall, centred on its middle.
  function stationYs(p) {
    const n = Math.max(1, Math.round(p.picking_points || 1)), s = p.station_spacing || 3, out = [];
    for (let i = 0; i < n; i++) out.push(p.warehouse_width / 2 + (i - (n - 1) / 2) * s);
    return out;
  }

  function locationsPerLayout(lay, p) {
    return lay.numRackRows * lay.baysPerRow * p.levels_per_rack * p.positions_per_level_per_bay;
  }

  // opts.depots: "stations" (default — picking points on the west wall),
  // "doors_in" or "doors_out" (the Warehouse Model's dock doors; used by the
  // tests to compare against its formulas).
  function build(p, rackTypes, opts) {
    opts = opts || {};
    const RT = rackTypesWith(rackTypes);
    const lay = calc.computeLayout(p, RT);
    const g = new G.Graph(), Lw = p.warehouse_length;
    const bayCx = lay.bayX.map(function (x) { return x + p.bay_width / 2; });
    const front = [], back = [], cross = lay.crossAisleX.map(function () { return []; });
    const access = [];                                   // access[aisle][bay] = node id

    lay.aisles.forEach(function (a, ai) {
      const y = a.y, ids = [];
      const f = g.addNode(0, y, "front"), b = g.addNode(Lw, y, "back");
      front.push(f); back.push(b); ids.push(f, b);
      lay.crossAisleX.forEach(function (cx, c) { const n = g.addNode(cx, y, "cross"); cross[c].push(n); ids.push(n); });
      access.push(bayCx.map(function (x) { const n = g.addNode(x, y, "access"); ids.push(n); return n; }));
      g.chain(ids, "x");
    });

    // picking points
    const mode = opts.depots || "stations", doors = calc.doorSets(p), depotNodes = [];
    if (mode === "stations") stationYs(p).forEach(function (y) { const n = g.addNode(0, y, "depot"); front.push(n); depotNodes.push(n); });
    else if (mode === "doors_in") doors.inY.forEach(function (y) { const n = g.addNode(0, y, "depot"); front.push(n); depotNodes.push(n); });
    else if (mode === "doors_out") doors.outY.forEach(function (y) { const n = g.addNode(doors.outX, y, "depot"); (doors.outX === 0 ? front : back).push(n); depotNodes.push(n); });
    else throw new Error("unknown depots mode " + mode);

    g.chain(front, "y"); g.chain(back, "y");
    cross.forEach(function (ids) { g.chain(ids, "y"); });

    const depots = depotNodes.map(function (n) { return g.markKey(n); });
    const accessKey = access.map(function (row) { return row.map(function (n) { return g.markKey(n); }); });

    // storage locations: one pick face per (row, bay, level, position)
    const n = locationsPerLayout(lay, p), ppl = p.positions_per_level_per_bay;
    const key = new Int32Array(n), z = new Float64Array(n), x = new Float64Array(n), y = new Float64Array(n);
    let i = 0;
    const bays = [];                                     // one rectangle per (row, bay); its locations are contiguous
    lay.rows.forEach(function (row) {
      for (let b = 0; b < lay.baysPerRow; b++) {
        bays.push({ cx: lay.bayX[b] + p.bay_width / 2, cy: row.y + row.depth / 2, ux: 1, uy: 0, w: p.bay_width, d: row.depth, loc0: i, nLoc: p.levels_per_rack * ppl, group: row.aisle });
        for (let l = 0; l < p.levels_per_rack; l++) for (let q = 0; q < ppl; q++) {
          key[i] = accessKey[row.aisle][b]; z[i] = lay.levelHeights[l];
          x[i] = lay.bayX[b] + (q + 0.5) * p.bay_width / ppl; y[i] = row.y + row.depth / 2;
          i++;
        }
      }
    });

    const footprint = p.warehouse_length * p.warehouse_width;
    const warnings = lay.warnings.slice();
    if (!g.connected()) warnings.push({ level: "critical", text: T("Some storage can't be reached from a picking point.") });
    return {
      id: "C", name: T("WH-C · rectangle"), graph: g, M: opts.matrix === false ? null : g.keyMatrix(), depots: depots,
      locations: { n: n, key: key, z: z, x: x, y: y }, bays: bays,
      footprint: footprint, outline: [[0, 0], [p.warehouse_length, 0], [p.warehouse_length, p.warehouse_width], [0, p.warehouse_width]],
      wh: lay, accessKey: accessKey, params: p,
      warnings: warnings,
      trace: [
        { label: T("Rectangular layout"), expr: T("Warehouse Model computeLayout()"), value: T("{r} rows × {b} bays × {l} levels", { r: lay.numRackRows, b: lay.baysPerRow, l: p.levels_per_rack }) },
        { label: T("Storage locations"), expr: T("rows × bays × levels × positions per level"), value: lay.numRackRows + " × " + lay.baysPerRow + " × " + p.levels_per_rack + " × " + ppl + " = " + int(n) },
        { label: T("Travel network"), expr: T("aisles + front line + back line + cross-aisles"), value: T("{n} nodes, {e} paths, {k} stops", { n: int(g.size()), e: int(g.edges.length), k: int(g.keys.length) }) },
        { label: T("Floor area"), expr: T("length × width (inside the walls)"), value: fx(p.warehouse_length, 1) + " × " + fx(p.warehouse_width, 1) + " = " + int(footprint) + " m²" }
      ]
    };
  }

  // Equal capacity: the smallest building with the same length:width ratio
  // whose layout holds at least `target` locations. Capacity never falls as
  // the building grows (bays and aisle units are floors of growing lengths),
  // so a bisection on the scale factor finds it.
  function sizeToCapacity(p, rackTypes, target) {
    const RT = rackTypesWith(rackTypes);
    const cap = function (s) {
      const q = Object.assign({}, p, { warehouse_length: p.warehouse_length * s, warehouse_width: p.warehouse_width * s });
      return locationsPerLayout(calc.computeLayout(q, RT), q);
    };
    let lo = 0.01, hi = 1;
    while (cap(hi) < target) { hi *= 2; if (hi > 1e3) throw new Error("can't reach " + target + " locations"); }
    for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (cap(m) >= target) hi = m; else lo = m; }
    // round up to the millimetre — rounding down could lose the last bay
    const up = function (v) { return Math.ceil(v * 1000) / 1000; };
    return Object.assign({}, p, { warehouse_length: up(p.warehouse_length * hi), warehouse_width: up(p.warehouse_width * hi) });
  }

  return { EXTRA_RACK_TYPES, rackTypesWith, stationYs, build, sizeToCapacity, locationsPerLayout };
});
