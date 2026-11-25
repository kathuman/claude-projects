/*
 * layouts/wha.js — WH-A, moving racks: the floor of a robotic mobile
 * fulfilment system (Kiva-style), as a travel network.
 *
 * Racks ("pods") stand in slots on a grid. Robots drive under a pod, lift it
 * and carry it to a fixed picking station, where a picker takes every line
 * the station's open orders need from it; then a robot puts the pod back in
 * a slot chosen by the put-away policy (src/rmfs.js).
 *
 *   station zone   along the west wall, `station_zone` deep: the stations,
 *                  `station_spacing` apart, centred on the wall
 *   storage grid   blocks of 2 × block_length slots, so every slot touches a
 *                  vertical aisle; vertical aisles between block columns,
 *                  horizontal aisles between block rows, a perimeter all round
 *
 * Distances:
 *   loaded (robot under a pod) — through the aisles: slot → its aisle (half a
 *     pod plus half an aisle sideways) → shortest path → station; graph.js
 *   empty robot — straight under the parked pods: Manhattan distance between
 *     slot centres (the usual RMFS assumption)
 *
 * Capacity: one location per (pod face, level, bin). Slots outnumber pods by
 * 1 / storage_fill, because a put-away policy needs free slots to choose from.
 *
 * Pure, no DOM: window.WC.layouts.A in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("../graph.js"), require("../t.js"));
  else { root.WC = root.WC || {}; root.WC.layouts = root.WC.layouts || {}; root.WC.layouts.A = factory(root.WC.graph, root.WC.t); }
})(typeof self !== "undefined" ? self : this, function (G, tr) {
  "use strict";
  const T = tr.T, fx = tr.fx, int = tr.int;

  function locsPerPod(p) { return p.pod_faces * p.pod_levels * p.bins_per_face_level; }
  function podsFor(p, target) { return Math.ceil(target / locsPerPod(p)); }

  // Size of a grid of nC block columns × nR block rows.
  function dims(p, nC, nR) {
    const pw = p.pod_width, a = p.robot_aisle_width, L = p.block_length;
    return { X: p.station_zone + a + nC * (2 * pw + a), Y: a + nR * (L * pw + a), slots: nC * nR * 2 * L };
  }

  // Smallest grid with enough slots for `pods` at storage_fill, whose west
  // wall fits the stations, with length:width within ±50% of `aspect`.
  function chooseGrid(p, pods, stations) {
    const need = Math.ceil(pods / p.storage_fill), wall = stations * p.station_spacing;
    let best = null;
    for (let nR = 1; nR <= 200; nR++) {
      const perCol = nR * 2 * p.block_length, nC = Math.max(1, Math.ceil(need / perCol));
      const d = dims(p, nC, nR);
      if (d.Y < wall) continue;
      const asp = d.X / d.Y, ok = asp >= p.aspect / 1.5 && asp <= p.aspect * 1.5;
      const score = d.X * d.Y * (ok ? 1 : 1.25);
      if (!best || score < best.score - 1e-9) best = { nC: nC, nR: nR, score: score, d: d };
    }
    return best;
  }

  function build(p, target, stations) {
    const pw = p.pod_width, a = p.robot_aisle_width, L = p.block_length, Z = p.station_zone;
    const pods = podsFor(p, target), grid = chooseGrid(p, pods, stations), nC = grid.nC, nR = grid.nR, D = grid.d;
    const g = new G.Graph(), warnings = [];
    const Xv = [], Yh = [];
    for (let i = 0; i <= nC; i++) Xv.push(Z + a / 2 + i * (2 * pw + a));
    for (let k = 0; k <= nR; k++) Yh.push(a / 2 + k * (L * pw + a));

    // vertical aisles: intersections + one access node per pod row
    const vnodes = Xv.map(function () { return []; }), inter = Xv.map(function () { return []; }), acc = Xv.map(function () { return new Map(); });
    const rowYs = [];
    for (let r = 0; r < nR; r++) for (let j = 0; j < L; j++) rowYs.push(a + r * (L * pw + a) + (j + 0.5) * pw);
    Xv.forEach(function (x, i) {
      Yh.forEach(function (y) { const n = g.addNode(x, y, "cross"); vnodes[i].push(n); inter[i].push(n); });
      rowYs.forEach(function (y) { const n = g.addNode(x, y, "access"); vnodes[i].push(n); acc[i].set(y, n); });
    });
    // stations on the west wall, each joined to the west perimeter aisle
    const sy = [];
    for (let s = 0; s < stations; s++) sy.push(D.Y / 2 + (s - (stations - 1) / 2) * p.station_spacing);
    const stNodes = sy.map(function (y) {
      const st = g.addNode(Z / 2, y, "depot"), gate = g.addNode(Xv[0], y, "gate");
      vnodes[0].push(gate); g.addEdge(st, gate); return st;
    });
    vnodes.forEach(function (ids) { g.chain(ids, "y"); });
    Yh.forEach(function (y, k) { g.chain(Xv.map(function (_, i) { return inter[i][k]; }), "x"); });
    const depots = stNodes.map(function (n) { return g.markKey(n); });

    // slots
    const slots = [];
    for (let c = 0; c < nC; c++) for (let r = 0; r < nR; r++) for (let j = 0; j < 2; j++) for (let k = 0; k < L; k++) {
      const x = Z + a + c * (2 * pw + a) + (j + 0.5) * pw, y = a + r * (L * pw + a) + (k + 0.5) * pw;
      const aisle = c + j, node = acc[aisle].get(y);
      slots.push({ x: x, y: y, key: g.markKey(node), offset: Math.abs(x - Xv[aisle]) });
    }
    if (slots.length < pods) warnings.push({ level: "critical", text: T("Grid has fewer slots than pods.") });
    if (!g.connected()) warnings.push({ level: "critical", text: T("Some slots can't be reached from a station.") });
    if (p.robot_aisle_width < p.pod_width) warnings.push({ level: "warning", text: T("Robot aisles ({a} m) are narrower than a pod ({p} m).", { a: fx(p.robot_aisle_width, 1), p: fx(p.pod_width, 1) }) });

    const M = g.keyMatrix();
    // loaded distance slot ↔ station, and empty (Manhattan) distance between points
    const toStation = slots.map(function (s) { return depots.map(function (d) { return s.offset + M.at(s.key, d); }); });
    const stXY = stNodes.map(function (n) { return [g.x[n], g.y[n]]; });
    const footprint = D.X * D.Y, perPod = locsPerPod(p);
    const bays = slots.map(function (s, i) { return { cx: s.x, cy: s.y, ux: 1, uy: 0, w: pw * 0.9, d: pw * 0.9, slot: i }; });
    return {
      id: "A", name: T("WH-A · moving racks"), graph: g, M: M, depots: depots, stations: stXY,
      slots: slots, toStation: toStation, pods: pods, perPod: perPod, bays: bays,
      locations: { n: pods * perPod },
      footprint: footprint, outline: [[0, 0], [D.X, 0], [D.X, D.Y], [0, D.Y]], size: D, grid: { nC: nC, nR: nR },
      params: p, warnings: warnings,
      trace: [
        { label: T("Pods"), expr: T("ceil(target locations / (faces × levels × bins))"), value: T("ceil({t} / {p}) = {n} pods, {l} locations", { t: int(target), p: perPod, n: int(pods), l: int(pods * perPod) }) },
        { label: T("Slot grid"), expr: T("blocks of 2 × {L} slots; slots ≥ pods / storage fill ({f}%)", { L: L, f: Math.round(p.storage_fill * 100) }), value: T("{c} × {r} blocks = {s} slots ({f} free)", { c: nC, r: nR, s: int(slots.length), f: int(slots.length - pods) }) },
        { label: T("Travel network"), expr: T("robot aisles round every block + station gates"), value: T("{n} nodes, {e} paths", { n: int(g.size()), e: int(g.edges.length) }) },
        { label: T("Floor area"), expr: T("(station zone + grid) × grid width"), value: fx(D.X, 1) + " × " + fx(D.Y, 1) + " = " + int(footprint) + " m²" }
      ]
    };
  }

  function manhattan(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }

  return { locsPerPod, podsFor, dims, chooseGrid, build, manhattan };
});
