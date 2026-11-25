/*
 * layouts/whb.js — WH-B, the semicircular warehouse, as a travel network.
 *
 * A D-shaped building: the picking points sit on the flat (south) wall around
 * its midpoint, inside an open hub of radius hub_radius; storage fills the
 * half-disc around them. Rack dimensions (depth, bay width, levels, aisle
 * width, flue) are inherited from WH-C, so only the arrangement differs.
 * Two arrangements:
 *
 *   radial      rack rows point straight out from the hub: aisle units
 *               (row | aisle | row) along rays, in `zones` rings separated by
 *               ring cross-aisles. Outer zones fit more units. In the first
 *               zone the walk from the hub centre to a location is exactly
 *               its straight-line distance.
 *   concentric  rack rows follow arcs: ring units (row | arc aisle | row)
 *               one outside another, cut by `radial_aisles` straight aisles
 *               that lead out from the hub.
 *
 * Bays are straight (racking isn't curved). On an arc they are placed as
 * chords whose edge nearest the centre touches the nominal radius, so they
 * fan apart outwards — the space a curved layout gives away, which the
 * density KPI shows.
 *
 * Every bay is returned as a rectangle (centre, width direction, width,
 * depth) so the tests can prove that none overlap, none block an aisle and
 * all lie inside the building.
 *
 * Geometry: origin at the midpoint of the flat wall, x along it, y into the
 * building. Pure, no DOM: window.WC.layouts.B in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("../graph.js"), require("../t.js"));
  else { root.WC = root.WC || {}; root.WC.layouts = root.WC.layouts || {}; root.WC.layouts.B = factory(root.WC.graph, root.WC.t); }
})(typeof self !== "undefined" ? self : this, function (G, tr) {
  "use strict";
  const T = tr.T, fx = tr.fx, int = tr.int;

  const BEAM_ALLOWANCE = 0.25;                 // as in the Warehouse Model
  // rack dimensions WH-B takes from WH-C, so the two differ only in arrangement
  const RACK_KEYS = ["rack_height", "levels_per_rack", "load_height", "rack_depth", "bay_width", "positions_per_level_per_bay", "aisle_width", "flue_space", "picking_points", "station_spacing"];

  function stationXs(p) {
    const n = Math.max(1, Math.round(p.picking_points || 1)), s = p.station_spacing || 3, out = [];
    for (let i = 0; i < n; i++) out.push((i - (n - 1) / 2) * s);
    return out;
  }

  function levelHeights(p) {
    const pitch = p.levels_per_rack > 1 ? p.rack_height / (p.levels_per_rack - 1) : p.rack_height, z = [];
    for (let k = 0; k < p.levels_per_rack; k++) z.push(k * pitch);
    return { z: z, pitch: pitch };
  }

  // ---------------------------------------------------------------- radial
  // Largest number of units whose inner ends (radius s) neither overlap
  // their neighbours (with a flue between) nor cross the flat wall.
  function radialUnits(s, U, f) {
    let n = 0;
    for (let m = 1; m < 5000; m++) {
      const d = Math.PI / m, h = Math.PI / (2 * m);
      const sep = m === 1 || s * Math.sin(d) >= U / 2 * (1 + Math.cos(d)) + f - 1e-12;
      const wall = s * Math.sin(h) - U / 2 * Math.cos(h) >= -1e-12;
      if (sep && wall) n = m; else break;
    }
    return n;
  }

  function planRadial(p, R) {
    const d = p.rack_depth, w = p.aisle_width, f = p.flue_space, bw = p.bay_width, U = 2 * d + w;
    const r0 = p.hub_radius, c = p.ring_aisle_width, Z = Math.max(1, Math.round(p.zones));
    const ell = (R - r0 - Z * c) / Z;
    const zones = [], bays = [];
    if (!(ell > 0)) return { kind: "radial", R: R, zones: zones, bays: bays, rings: [] };
    const rings = [r0];                               // ring 0 is the hub's edge
    for (let z = 0; z < Z; z++) rings.push(r0 + z * (ell + c) + ell + c / 2);
    for (let z = 0; z < Z; z++) {
      const s = r0 + z * (ell + c), e = s + ell;
      const n = radialUnits(s, U, f);
      const eIn = Math.sqrt(Math.max(0, e * e - U * U / 4));      // outer corners stay within radius e
      const nb = Math.max(0, Math.floor((eIn - s) / bw + 1e-9));
      const units = [];
      for (let k = 0; k < n; k++) {
        const th = Math.PI * (k + 0.5) / n, ux = Math.cos(th), uy = Math.sin(th), nx = -uy, ny = ux;
        const unit = { theta: th, bays: [] };
        for (let b = 0; b < nb; b++) {
          const t = s + (b + 0.5) * bw;
          [-1, 1].forEach(function (side) {
            const off = side * (w / 2 + d / 2);
            const bay = { cx: t * ux + off * nx, cy: t * uy + off * ny, ux: ux, uy: uy, w: bw, d: d, zone: z, unit: k, at: t };
            bays.push(bay); unit.bays.push(bay);
          });
        }
        units.push(unit);
      }
      zones.push({ s: s, e: e, n: n, nb: nb, units: units });
    }
    return { kind: "radial", R: R, zones: zones, bays: bays, rings: rings, ell: ell };
  }

  // ---------------------------------------------------------------- concentric
  function planConcentric(p, R) {
    const d = p.rack_depth, w = p.aisle_width, f = p.flue_space, bw = p.bay_width, U = 2 * d + w;
    const r0 = p.hub_radius, K = Math.max(1, Math.round(p.radial_aisles)), wr = p.radial_aisle_width;
    const thetas = []; for (let j = 0; j < K; j++) thetas.push(Math.PI * (j + 0.5) / K);
    const m = Math.max(0, Math.floor((R - r0 + f) / (U + f) + 1e-9));
    const units = [], bays = [];
    for (let i = 0; i < m; i++) {
      const a = r0 + i * (U + f), ra = a + d + w / 2;
      const unit = { a: a, ra: ra, rows: [] };
      [a, a + d + w].forEach(function (edge, side) {
        // chord endpoints sit on radius rin; the chord's midpoint is at `edge`
        const rin = Math.sqrt(edge * edge + bw * bw / 4), delta = 2 * Math.asin(Math.min(1, bw / (2 * rin)));
        const halfCut = Math.asin(Math.min(1, wr / (2 * rin)));
        const row = { edge: edge, side: side, bays: [] };
        for (let sct = 0; sct <= K; sct++) {
          const lo = sct === 0 ? 0 : thetas[sct - 1] + halfCut, hi = sct === K ? Math.PI : thetas[sct] - halfCut;
          const n = hi > lo ? Math.floor((hi - lo) / delta + 1e-9) : 0;
          for (let k = 0; k < n; k++) {
            const phi = (lo + hi) / 2 + (k - (n - 1) / 2) * delta, vx = Math.cos(phi), vy = Math.sin(phi);
            const rc = edge + d / 2;
            const bay = { cx: rc * vx, cy: rc * vy, ux: -vy, uy: vx, w: bw, d: d, unit: i, side: side, sector: sct, phi: phi };
            bays.push(bay); row.bays.push(bay);
          }
        }
        unit.rows.push(row);
      });
      units.push(unit);
    }
    return { kind: "concentric", R: R, units: units, bays: bays, thetas: thetas };
  }

  function plan(p, R) { return p.arrangement === "concentric" ? planConcentric(p, R) : planRadial(p, R); }
  function capacityOf(p, R) { return plan(p, R).bays.length * p.levels_per_rack * p.positions_per_level_per_bay; }

  function corners(b) {
    const hx = b.ux * b.w / 2, hy = b.uy * b.w / 2, vx = -b.uy * b.d / 2, vy = b.ux * b.d / 2;
    return [[b.cx - hx - vx, b.cy - hy - vy], [b.cx + hx - vx, b.cy + hy - vy], [b.cx + hx + vx, b.cy + hy + vy], [b.cx - hx + vx, b.cy - hy + vy]];
  }

  // ---------------------------------------------------------------- build
  function build(p, opts) {
    opts = opts || {};
    const pl = plan(p, p.outer_radius);
    const g = new G.Graph(), warnings = [];
    const lev = levelHeights(p);

    // hub: picking points and aisle mouths, all joined by straight lines across the open floor
    const hub = [], depotNodes = [];
    const xs = opts.depotsAt || stationXs(p);
    xs.forEach(function (x) { const n = g.addNode(x, 0, "depot"); hub.push(n); depotNodes.push(n); });
    if (xs.some(function (x) { return Math.abs(x) > p.hub_radius - 0.5; })) warnings.push({ level: "warning", text: T("The picking points ({n} at {s} m) don't fit inside a {r} m hub.", { n: xs.length, s: fx(p.station_spacing, 1), r: fx(p.hub_radius, 1) }) });

    const bayNode = new Map();                        // bay -> access node
    if (pl.kind === "radial") {
      const ringNodes = pl.rings.map(function () { return []; });
      pl.zones.forEach(function (zn, z) {
        zn.units.forEach(function (u) {
          const ux = Math.cos(u.theta), uy = Math.sin(u.theta);
          const start = g.addNode(pl.rings[z] * ux, pl.rings[z] * uy, z === 0 ? "mouth" : "ring");
          if (z === 0) hub.push(start); else ringNodes[z].push(start);
          let prev = start;
          const at = new Map();
          u.bays.forEach(function (b) {
            if (!at.has(b.at)) { const n = g.addNode(b.at * ux, b.at * uy, "access"); g.addEdge(prev, n); prev = n; at.set(b.at, n); }
            bayNode.set(b, at.get(b.at));
          });
          const end = g.addNode(pl.rings[z + 1] * ux, pl.rings[z + 1] * uy, "ring");
          g.addEdge(prev, end); ringNodes[z + 1].push(end);
        });
      });
      for (let z = 1; z < ringNodes.length; z++) g.arcChain(ringNodes[z], 0, 0);
    } else {
      const radial = pl.thetas.map(function (th) {
        const n = g.addNode(p.hub_radius * Math.cos(th), p.hub_radius * Math.sin(th), "mouth");
        hub.push(n); return [n];
      });
      pl.units.forEach(function (u) {
        const arc = [];
        pl.thetas.forEach(function (th, j) { const n = g.addNode(u.ra * Math.cos(th), u.ra * Math.sin(th), "cross"); radial[j].push(n); arc.push(n); });
        u.rows.forEach(function (row) {
          row.bays.forEach(function (b) {
            const n = g.addNode(u.ra * Math.cos(b.phi), u.ra * Math.sin(b.phi), "access");
            arc.push(n); bayNode.set(b, n);
          });
        });
        g.arcChain(arc, 0, 0);
      });
      radial.forEach(function (ids) { for (let i = 1; i < ids.length; i++) g.addEdge(ids[i - 1], ids[i]); });
    }
    for (let i = 0; i < hub.length; i++) for (let j = i + 1; j < hub.length; j++) g.addEdge(hub[i], hub[j]);

    const depots = depotNodes.map(function (n) { return g.markKey(n); });
    // storage locations: one pick face per (bay, level, position); a bay's locations are contiguous
    const ppl = p.positions_per_level_per_bay, per = p.levels_per_rack * ppl, nLoc = pl.bays.length * per;
    const key = new Int32Array(nLoc), z = new Float64Array(nLoc), x = new Float64Array(nLoc), y = new Float64Array(nLoc);
    const bays = [];
    let i = 0, Rb = pl.R;
    pl.bays.forEach(function (b) {
      const k = g.markKey(bayNode.get(b));
      // group: the aisle unit (row | aisle | row) the bay belongs to — units sit a flue apart
      const group = pl.kind === "radial" ? b.zone * 100000 + b.unit : b.unit;
      bays.push({ cx: b.cx, cy: b.cy, ux: b.ux, uy: b.uy, w: b.w, d: b.d, loc0: i, nLoc: per, group: group });
      corners(b).forEach(function (q) { Rb = Math.max(Rb, Math.hypot(q[0], q[1])); });
      for (let l = 0; l < p.levels_per_rack; l++) for (let q = 0; q < ppl; q++) { key[i] = k; z[i] = lev.z[l]; x[i] = b.cx; y[i] = b.cy; i++; }
    });

    if (lev.pitch + 1e-9 < p.load_height + BEAM_ALLOWANCE) warnings.push({ level: "critical", text: T("{n} levels in a {h} m rack leave {p} m per level — too little for the load.", { n: p.levels_per_rack, h: fx(p.rack_height, 2), p: fx(lev.pitch, 2) }) });
    if (!pl.bays.length) warnings.push({ level: "critical", text: T("No racking fits in a {r} m radius.", { r: fx(p.outer_radius, 1) }) });
    if (!g.connected()) warnings.push({ level: "critical", text: T("Some storage can't be reached from a picking point.") });

    const outline = [];
    for (let s = 0; s <= 64; s++) { const t = Math.PI * s / 64; outline.push([Rb * Math.cos(t), Rb * Math.sin(t)]); }
    const footprint = Math.PI * Rb * Rb / 2;
    const shape = pl.kind === "radial"
      ? { label: T("Radial arrangement"), expr: T("aisle units along rays, {z} zone(s) between ring cross-aisles", { z: pl.zones.length }), value: pl.zones.map(function (zn) { return T("{u} units × {b} bays", { u: zn.n, b: zn.nb }); }).join(" · ") }
      : { label: T("Concentric arrangement"), expr: T("ring units cut by {n} radial aisles", { n: pl.thetas.length }), value: T("{u} ring units, {b} bays", { u: pl.units.length, b: int(pl.bays.length) }) };
    return {
      id: "B", name: T("WH-B · semicircle"), graph: g, M: opts.matrix === false ? null : g.keyMatrix(), depots: depots,
      locations: { n: nLoc, key: key, z: z, x: x, y: y }, bays: bays,
      footprint: footprint, outline: outline, radius: Rb, plan: pl, params: p,
      warnings: warnings,
      trace: [
        shape,
        { label: T("Storage locations"), expr: T("bays × levels × positions per level"), value: int(pl.bays.length) + " × " + p.levels_per_rack + " × " + ppl + " = " + int(nLoc) },
        { label: T("Travel network"), expr: pl.kind === "radial" ? T("hub + radial aisles + ring cross-aisles (arcs)") : T("hub + radial aisles + arc aisles"), value: T("{n} nodes, {e} paths, {k} stops", { n: int(g.size()), e: int(g.edges.length), k: int(g.keys.length) }) },
        { label: T("Floor area"), expr: T("π R² / 2 (half-disc to the outermost rack corner)"), value: T("R = {r} m → {a} m² (bounding rectangle {b} m²)", { r: fx(Rb, 1), a: int(footprint), b: int(2 * Rb * Rb) }) }
      ]
    };
  }

  // Equal capacity: the smallest outer radius holding at least `target`
  // locations. Capacity never falls as the radius grows, so bisection finds it.
  function sizeToCapacity(p, target) {
    let lo = p.hub_radius, hi = Math.max(lo + 1, 10);
    while (capacityOf(p, hi) < target) { hi *= 1.5; if (hi > 5000) throw new Error("can't reach " + target + " locations"); }
    for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (capacityOf(p, m) >= target) hi = m; else lo = m; }
    return Object.assign({}, p, { outer_radius: Math.ceil(hi * 1000) / 1000 });
  }

  return { RACK_KEYS, stationXs, plan, planRadial, planConcentric, radialUnits, capacityOf, corners, build, sizeToCapacity };
});
