/*
 * calculations.js — the analytical model.
 *
 * Pure functions only: parameters in, numbers (+ traceable derivations) out.
 * No DOM access, no Three.js. This file is the one place every formula in
 * the app is defined, so the 3D view, the floor plan, the KPI dashboard and
 * the charts can never show numbers that disagree with each other.
 *
 * Every "compute*" function returns a plain object whose fields are the
 * results, plus a `trace` field: an ordered list of { label, expr, value }
 * steps a human can read top to bottom to see exactly how the headline
 * number was derived (engineering traceability — never a black-box number).
 *
 * computeAll(p, rackTypes): p is { parameterName: value } and rackTypes is
 * the "rack_types" table from data/parameters.json. Works in the browser
 * (window.WH.calc) and in Node (module.exports) — the unit tests and the
 * floor-plan tool load this very file.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.WH = root.WH || {}; root.WH.calc = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Beam depth plus the lift-off gap a truck needs to raise a pallet off its
  // beam — added to the load height to get the minimum level pitch.
  const BEAM_ALLOWANCE = 0.25;
  // ABC classes: the fastest 20% of positions are A, the next 30% B, the rest C.
  const ABC_BOUNDS = [0.2, 0.5];
  // Dual-command travel is estimated from this many sampled (putaway, retrieval) pairs.
  const DC_SAMPLES = 4000;
  // Squared coefficient of variation of truck turn times (CV 0.5): used in the
  // Allen–Cunneen correction of the M/M/c queue at the doors.
  const TURN_CS2 = 0.25;

  const fmt = function (v, d) { return Number(v).toFixed(d === undefined ? 1 : d); };
  const int = function (v) { return Math.round(v).toLocaleString("en-US"); };
  const mean = function (a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : 0; };
  function warn(list, level, text) { list.push({ level: level, text: text }); }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Dock doors: I-flow receives on the west wall and ships from the east wall;
  // U-flow puts both on the west wall, receiving doors first.
  function doorSets(p) {
    const u = p.flow_layout === "u_flow", w = p.dock_bay_width;
    const place = function (count, y0) { const out = []; for (let i = 0; i < count; i++) out.push(y0 + (i + 0.5) * w); return out; };
    if (u) {
      const y0 = (p.warehouse_width - (p.num_receiving_docks + p.num_shipping_docks) * w) / 2;
      return { u: true, inY: place(p.num_receiving_docks, y0), outY: place(p.num_shipping_docks, y0 + p.num_receiving_docks * w), outX: 0 };
    }
    return {
      u: false,
      inY: place(p.num_receiving_docks, (p.warehouse_width - p.num_receiving_docks * w) / 2),
      outY: place(p.num_shipping_docks, (p.warehouse_width - p.num_shipping_docks * w) / 2),
      outX: p.warehouse_length
    };
  }

  // ---------------------------------------------------------------------
  // 1. Layout — how many rows, bays and levels physically fit, and where
  // ---------------------------------------------------------------------
  // This is the derivation freecad/create_model.py mirrors (derive_layout,
  // same names and order); tests/parity.test.js checks the two agree.
  //
  // Along the length: a cross-aisle (staging) at each end, and optionally
  // mid cross-aisles splitting the racking into equal segments.
  // Across the width the pattern is  row | aisle | row  (one "aisle unit",
  // each row facing its aisle), with a flue gap between the backs of
  // neighbouring units:  N·unit + (N−1)·flue ≤ width.
  function computeLayout(p, rackTypes) {
    const warnings = [];
    const rt = rackTypes[p.rack_type];
    if (!rt) throw new Error("Unknown rack_type: " + p.rack_type);

    const usableLength = p.warehouse_length - 2 * p.cross_aisle_width;
    const mids = Math.max(0, Math.round(p.mid_cross_aisles || 0)), midW = p.mid_cross_aisle_width || 0;
    const segmentLength = (usableLength - mids * midW) / (mids + 1);
    const baysPerSegment = segmentLength > 0 ? Math.max(0, Math.floor(segmentLength / p.bay_width + 1e-9)) : 0;
    const segments = [], bayX = [], crossAisleX = [p.cross_aisle_width / 2];
    for (let k = 0; k <= mids; k++) {
      const x0 = p.cross_aisle_width + k * (segmentLength + midW);
      segments.push({ index: k, x0: x0, bays: baysPerSegment, length: baysPerSegment * p.bay_width });
      for (let b = 0; b < baysPerSegment; b++) bayX.push(x0 + b * p.bay_width);
      if (k < mids) crossAisleX.push(x0 + segmentLength + midW / 2);
    }
    crossAisleX.push(p.warehouse_length - p.cross_aisle_width / 2);
    const baysPerRow = bayX.length;
    const rackRowLength = baysPerRow * p.bay_width;
    if (baysPerRow < 1) warn(warnings, "critical", "Warehouse is too short for even one rack bay once the cross-aisles are reserved.");

    const rowDepth = rt.deep * p.rack_depth;
    const widthPerAisleUnit = 2 * rowDepth + p.aisle_width;
    const numAisleUnits = Math.max(0, Math.floor((p.warehouse_width + p.flue_space) / (widthPerAisleUnit + p.flue_space) + 1e-9));
    const numRackRows = numAisleUnits * 2;
    const rackingWidthUsed = numAisleUnits > 0 ? numAisleUnits * widthPerAisleUnit + (numAisleUnits - 1) * p.flue_space : 0;
    if (numAisleUnits < 1) warn(warnings, "critical", "Warehouse is too narrow to fit a single pair of rack rows plus an aisle.");

    // Row and aisle positions (y measured from the inside face of the south wall)
    const yOffset = (p.warehouse_width - rackingWidthUsed) / 2;
    const rows = [], aisles = [];
    for (let i = 0; i < numAisleUnits; i++) {
      const y0 = yOffset + i * (widthPerAisleUnit + p.flue_space);
      aisles.push({ index: i + 1, y: y0 + rowDepth + p.aisle_width / 2, width: p.aisle_width });
      rows.push({ index: rows.length + 1, y: y0, depth: rowDepth, faces: +1, aisle: i });
      rows.push({ index: rows.length + 1, y: y0 + rowDepth + p.aisle_width, depth: rowDepth, faces: -1, aisle: i });
    }

    // Vertical: floor level plus (levels − 1) beam levels spaced evenly to the top beam
    const levelPitch = p.levels_per_rack > 1 ? p.rack_height / (p.levels_per_rack - 1) : p.rack_height;
    const levelHeights = [];
    for (let k = 0; k < p.levels_per_rack; k++) levelHeights.push(k * levelPitch);
    const pitchNeeded = p.load_height + BEAM_ALLOWANCE;
    if (levelPitch + 1e-9 < pitchNeeded) {
      warn(warnings, "critical", p.levels_per_rack + " levels in a " + fmt(p.rack_height) + " m rack leaves " + fmt(levelPitch, 2) +
        " m per level — a " + fmt(p.load_height, 2) + " m load plus beam and lift-off gap needs " + fmt(pitchNeeded, 2) + " m.");
    }
    const clearanceNeeded = p.rack_height + p.load_height + p.sprinkler_clearance;
    if (clearanceNeeded > p.clear_height + 1e-9) {
      warn(warnings, "critical", "Top beam (" + fmt(p.rack_height) + " m) + load (" + fmt(p.load_height, 2) + " m) + sprinkler clearance (" +
        fmt(p.sprinkler_clearance, 2) + " m) = " + fmt(clearanceNeeded, 2) + " m, above the " + fmt(p.clear_height) + " m clear height.");
    }

    if (p.aisle_width + 1e-9 < rt.min_aisle) {
      warn(warnings, "critical", "A " + fmt(p.aisle_width, 2) + " m aisle is too narrow for the " + rt.truck + " that serves " +
        rt.label.toLowerCase() + " racking (needs about " + fmt(rt.min_aisle, 1) + " m).");
    } else if (p.rack_type === "vna" && p.aisle_width > 2.2) {
      warn(warnings, "info", "VNA turret trucks work in aisles of about " + fmt(rt.min_aisle, 1) + "–1.9 m; at " + fmt(p.aisle_width, 2) +
        " m the layout gives away most of VNA's space advantage.");
    }
    if (mids > 0 && midW + 1e-9 < p.aisle_width) {
      warn(warnings, "warning", "Mid cross-aisles (" + fmt(midW, 1) + " m) are narrower than the aisles (" + fmt(p.aisle_width, 1) + " m) — trucks need room to turn out of an aisle.");
    }

    const u = p.flow_layout === "u_flow";
    const receivingWallNeeded = p.num_receiving_docks * p.dock_bay_width;
    const shippingWallNeeded = p.num_shipping_docks * p.dock_bay_width;
    if (u) {
      if (receivingWallNeeded + shippingWallNeeded > p.warehouse_width) warn(warnings, "critical", "U-flow puts all " + (p.num_receiving_docks + p.num_shipping_docks) + " doors (" + fmt(receivingWallNeeded + shippingWallNeeded) + " m) on the " + fmt(p.warehouse_width) + " m west wall — they don't fit.");
    } else {
      if (receivingWallNeeded > p.warehouse_width) warn(warnings, "critical", "Receiving docks (" + fmt(receivingWallNeeded) + " m of wall) don't fit along a " + fmt(p.warehouse_width) + " m end wall.");
      if (shippingWallNeeded > p.warehouse_width) warn(warnings, "critical", "Shipping docks (" + fmt(shippingWallNeeded) + " m of wall) don't fit along a " + fmt(p.warehouse_width) + " m end wall.");
    }

    return {
      rackType: rt, usableLength, segmentLength, segments, bayX, crossAisleX, baysPerRow, rackRowLength, rowDepth,
      widthPerAisleUnit, numAisleUnits, numRackRows, rackingWidthUsed, yOffset, rows, aisles,
      levelPitch, levelHeights, pitchNeeded, clearanceNeeded,
      receivingWallNeeded, shippingWallNeeded,
      warnings,
      trace: [
        { label: "Usable length (racking zone)", expr: "warehouse_length − 2 × cross_aisle_width", value: fmt(usableLength) + " m" },
        { label: "Segments", expr: "(usable − mid_aisles × mid_width) / (mid_aisles + 1)", value: (mids + 1) + " × " + fmt(segmentLength) + " m" },
        { label: "Bays per row", expr: "segments × floor(segment / bay_width)", value: (mids + 1) + " × " + baysPerSegment + " = " + baysPerRow },
        { label: "Row depth", expr: "pallets_deep (" + rt.label + ") × rack_depth", value: rt.deep + " × " + fmt(p.rack_depth, 2) + " = " + fmt(rowDepth, 2) + " m" },
        { label: "Width per aisle unit", expr: "2 × row_depth + aisle_width", value: fmt(widthPerAisleUnit, 2) + " m" },
        { label: "Aisle units that fit", expr: "floor((warehouse_width + flue) / (unit + flue))", value: numAisleUnits },
        { label: "Rack rows", expr: "aisle_units × 2", value: numRackRows },
        { label: "Level pitch", expr: "rack_height / (levels − 1)  ≥  load_height + " + BEAM_ALLOWANCE + " m", value: fmt(levelPitch, 2) + " m (needs " + fmt(pitchNeeded, 2) + ")" },
        { label: "Clear height needed", expr: "rack_height + load_height + sprinkler_clearance", value: fmt(clearanceNeeded, 2) + " m of " + fmt(p.clear_height) + " m" }
      ]
    };
  }

  // ---------------------------------------------------------------------
  // 2. Capacity — physical positions, and what can really be used
  // ---------------------------------------------------------------------
  function computeCapacity(layout, p) {
    const rt = layout.rackType;
    const positionsPerBay = p.levels_per_rack * p.positions_per_level_per_bay * rt.deep;
    const totalBays = layout.numRackRows * layout.baysPerRow;
    const storageCapacity = totalBays * positionsPerBay;
    const practicalCapacity = Math.floor(storageCapacity * rt.usable);
    const directAccess = Math.round(storageCapacity * rt.selectivity);

    return {
      positionsPerBay, totalBays, storageCapacity, practicalCapacity, directAccess,
      selectivity: rt.selectivity, usable: rt.usable,
      trace: [
        { label: "Positions per bay", expr: "levels × pallets_side_by_side × pallets_deep", value: p.levels_per_rack + " × " + p.positions_per_level_per_bay + " × " + rt.deep + " = " + positionsPerBay },
        { label: "Total bays", expr: "rack_rows × bays_per_row", value: layout.numRackRows + " × " + layout.baysPerRow + " = " + totalBays },
        { label: "Storage capacity", expr: "total_bays × positions_per_bay", value: int(storageCapacity) + " positions" },
        { label: "Practical capacity", expr: "capacity × planning ceiling (" + Math.round(rt.usable * 100) + "% for " + rt.label.toLowerCase() + ")", value: int(practicalCapacity) + " pallets" },
        { label: "Directly reachable", expr: "capacity × selectivity (" + Math.round(rt.selectivity * 100) + "%)", value: int(directAccess) + " positions" }
      ]
    };
  }

  // ---------------------------------------------------------------------
  // 3. Utilization — deliberately allowed to exceed 100%
  // ---------------------------------------------------------------------
  function computeUtilization(capacity, p) {
    const utilizationPct = capacity.storageCapacity > 0 ? (p.current_inventory_pallets / capacity.storageCapacity) * 100 : Infinity;
    const overflowPallets = Math.max(0, p.current_inventory_pallets - capacity.storageCapacity);
    const ceilingPct = capacity.usable * 100;
    return {
      utilizationPct, overflowPallets, ceilingPct,
      status: utilizationPct > 100 ? "critical" : utilizationPct > ceilingPct ? "warning" : "good",
      trace: [
        { label: "Utilization", expr: "current_inventory_pallets / storage_capacity", value: int(p.current_inventory_pallets) + " / " + int(capacity.storageCapacity) + " = " + fmt(utilizationPct) + "%" },
        { label: "Planning ceiling", expr: "practical / physical capacity", value: Math.round(ceilingPct) + "%" }
      ]
    };
  }

  // ---------------------------------------------------------------------
  // 4. Storage slots — each (row, bay, level) cell's own cycle times
  // ---------------------------------------------------------------------
  // Route (rectilinear): door → across the staging zone to the aisle → down
  // the aisle to the bay; lift trucks raise the load after stopping, so lift
  // time adds. Each cell's times are averaged over every door of its side:
  //   t_in  = 2·(E|y_door − y_aisle| + x) / v + 2·z / v_lift + overhead
  //   t_out = the same from the shipping doors (x measured from their wall).
  // Every cell holds the same number of positions, so averages over cells
  // are averages over positions.
  function aisleOf(row, p) {
    return row.faces > 0 ? row.y + row.depth + p.aisle_width / 2 : row.y - p.aisle_width / 2;
  }
  function slotGrid(p, layout) {
    const doors = doorSets(p);
    const nr = layout.rows.length, nb = layout.baysPerRow, nl = layout.levelHeights.length, n = nr * nb * nl;
    const latTo = function (ds, y) { return ds.length ? mean(ds.map(function (d) { return Math.abs(d - y); })) : 0; };
    const rowAisleY = layout.rows.map(function (r) { return aisleOf(r, p); });
    const latIn = rowAisleY.map(function (y) { return latTo(doors.inY, y); });
    const latOut = rowAisleY.map(function (y) { return latTo(doors.outY, y); });
    const bayCx = layout.bayX.map(function (x) { return x + p.bay_width / 2; });
    const tIn = new Float64Array(n), tOut = new Float64Array(n), t = new Float64Array(n);
    let min = Infinity, max = -Infinity;
    for (let r = 0; r < nr; r++) for (let b = 0; b < nb; b++) for (let l = 0; l < nl; l++) {
      const i = (r * nb + b) * nl + l, x = bayCx[b], z = layout.levelHeights[l];
      const common = 2 * z / p.lift_speed + p.forklift_cycle_overhead;
      tIn[i] = 2 * (latIn[r] + x) / p.forklift_speed + common;
      tOut[i] = 2 * (latOut[r] + Math.abs(doors.outX - x)) / p.forklift_speed + common;
      t[i] = (tIn[i] + tOut[i]) / 2;
      if (t[i] < min) min = t[i]; if (t[i] > max) max = t[i];
    }
    return { n, nr, nb, nl, tIn, tOut, t, min, max, rowAisleY, latIn, latOut, bayCx, doors };
  }
  function slotTimes(p, layout, rowIndex, bay, level) {
    const row = layout.rows[rowIndex], doors = doorSets(p);
    const aisleY = aisleOf(row, p);
    const x = layout.bayX[bay] + p.bay_width / 2;
    const z = layout.levelHeights[level];
    const lat = function (ds) { return ds.length ? mean(ds.map(function (d) { return Math.abs(d - aisleY); })) : 0; };
    const hIn = lat(doors.inY) + x;
    const hOut = lat(doors.outY) + Math.abs(doors.outX - x);
    const lift = 2 * z / p.lift_speed;
    const tIn = 2 * hIn / p.forklift_speed + lift + p.forklift_cycle_overhead;
    const tOut = 2 * hOut / p.forklift_speed + lift + p.forklift_cycle_overhead;
    return { aisleY: aisleY, x: x, z: z, hIn: hIn, hOut: hOut, tIn: tIn, tOut: tOut, t: (tIn + tOut) / 2 };
  }
  // for the 3D heat map: every cell's average cycle time
  function slotTimeGrid(p, layout) {
    const g = slotGrid(p, layout);
    return { times: g.t, min: g.min, max: g.max, rows: g.nr, bays: g.nb, levels: g.nl };
  }

  // ---------------------------------------------------------------------
  // 5. Storage policy — where each pallet's moves land
  // ---------------------------------------------------------------------
  // Random storage: every cell equally likely. Class-based (ABC): cells are
  // ranked by cycle time; the fastest 20% hold class A, the next 30% B, the
  // rest C, and each class gets the share of moves its pallets generate.
  // Demand skew follows the curve F(u) = u^k (share of moves from the fastest-
  // moving fraction u of pallets), with k set so F(0.2) = demand_skew.
  function moveWeights(p, grid) {
    const n = grid.n, w = new Float64Array(n), cls = new Uint8Array(n);
    const skew = Math.max(0.2, Math.min(0.99, (p.demand_skew || 20) / 100));
    const abc = p.storage_policy === "abc" && n > 0;
    if (!abc) { for (let i = 0; i < n; i++) w[i] = 1 / n; return { w, cls, abc: false, shares: null, k: 1 }; }
    const k = Math.log(skew) / Math.log(0.2), F = function (u) { return Math.pow(u, k); };
    const shares = [F(ABC_BOUNDS[0]), F(ABC_BOUNDS[1]) - F(ABC_BOUNDS[0]), 1 - F(ABC_BOUNDS[1])];
    const order = Array.from({ length: n }, function (_, i) { return i; }).sort(function (a, b) { return grid.t[a] - grid.t[b]; });
    const counts = [0, 0, 0];
    order.forEach(function (idx, rank) { const u = (rank + 0.5) / n; const c = u < ABC_BOUNDS[0] ? 0 : u < ABC_BOUNDS[1] ? 1 : 2; cls[idx] = c; counts[c]++; });
    for (let i = 0; i < n; i++) w[i] = counts[cls[i]] ? shares[cls[i]] / counts[cls[i]] : 0;
    return { w, cls, abc: true, shares, k, counts };
  }

  // Draw cell indices in proportion to their move weights (inverse CDF).
  function sampler(w) {
    const n = w.length, cum = new Float64Array(n); let acc = 0;
    for (let i = 0; i < n; i++) { acc += w[i]; cum[i] = acc; }
    return function (u) { let lo = 0, hi = n - 1; u *= acc; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < u) lo = m + 1; else hi = m; } return lo; };
  }
  // One dual-command trip: receiving side → putaway cell a → retrieval cell b →
  // shipping door → back to the receiving side. Used by the analytic estimate
  // and by the simulation, so the two can't drift apart.
  function dcContext(p, layout, grid) {
    const doors = grid.doors;
    let ret = 0;
    doors.outY.forEach(function (yo) { doors.inY.forEach(function (yi) { ret += Math.abs(yo - yi); }); });
    ret = ret / Math.max(1, doors.outY.length * doors.inY.length) + (doors.u ? 0 : p.warehouse_length);
    return { ret: ret, cx: layout.crossAisleX, nbl: grid.nb * grid.nl };
  }
  function dcPair(p, layout, grid, ctx, a, b) {
    const ra = Math.floor(a / ctx.nbl), rb = Math.floor(b / ctx.nbl), ba = Math.floor(a / grid.nl) % grid.nb, bb = Math.floor(b / grid.nl) % grid.nb;
    const xa = grid.bayCx[ba], xb = grid.bayCx[bb], cx = ctx.cx;
    let between;
    if (layout.rows[ra].aisle === layout.rows[rb].aisle) between = Math.abs(xa - xb);
    else {
      let best = Infinity;
      for (let c = 0; c < cx.length; c++) best = Math.min(best, Math.abs(xa - cx[c]) + Math.abs(xb - cx[c]));
      between = Math.abs(grid.rowAisleY[ra] - grid.rowAisleY[rb]) + best;
    }
    const dist = grid.latIn[ra] + xa + between + grid.latOut[rb] + Math.abs(grid.doors.outX - xb) + ctx.ret;
    const z = layout.levelHeights[a % grid.nl] + layout.levelHeights[b % grid.nl];
    return { dist: dist, time: dist / p.forklift_speed + 2 * z / p.lift_speed + 2 * p.forklift_cycle_overhead };
  }

  // ---------------------------------------------------------------------
  // 6. Lift-truck travel and fleet
  // ---------------------------------------------------------------------
  // Single-command (one pallet per trip): exact expectation over every cell,
  // weighted by the storage policy. Dual-command (store one pallet and fetch
  // another in the same trip): receiving door → putaway cell A → retrieval
  // cell B → shipping door → back to the receiving side, where A → B goes
  // down the aisle, or — for different aisles — along the shorter way through
  // a cross-aisle (end or mid). Estimated from a fixed sample of pairs.
  function computeTravel(layout, p, grid, weights) {
    const n = grid.n, w = weights.w;
    let eIn = 0, eOut = 0, eZ = 0;
    for (let i = 0; i < n; i++) { eIn += w[i] * grid.tIn[i]; eOut += w[i] * grid.tOut[i]; eZ += w[i] * layout.levelHeights[i % grid.nl]; }
    const scCycle = (eIn + eOut) / 2;
    const liftTime = 2 * eZ / p.lift_speed;
    const travelTime = Math.max(0, scCycle - liftTime - p.forklift_cycle_overhead);
    const avgRoundTrip = travelTime * p.forklift_speed;

    // dual command
    const share = Math.max(0, Math.min(1, (p.dual_command_share || 0) / 100));
    let dcCycle = 0, dcTravel = 0;
    if (n > 0) {
      const pick = sampler(w), rnd = mulberry32(20260929), ctx = dcContext(p, layout, grid);
      let sumD = 0, sumT = 0;
      for (let s = 0; s < DC_SAMPLES; s++) {
        const d = dcPair(p, layout, grid, ctx, pick(rnd()), pick(rnd()));
        sumD += d.dist; sumT += d.time;
      }
      dcTravel = sumD / DC_SAMPLES;
      dcCycle = sumT / DC_SAMPLES;
    }

    const moves = p.daily_throughput_pallets;
    const scTrips = moves * (1 - share), dcTrips = moves * share / 2;
    const perMove = moves > 0 ? (scTrips * scCycle + dcTrips * dcCycle) / moves : scCycle;
    const dailyWorkHours = moves * perMove / 3600;
    const dailyTravelDistance = scTrips * avgRoundTrip + dcTrips * dcTravel;
    const avgMovesPerHour = moves / p.operating_hours_per_day;
    const peakMovesPerHour = avgMovesPerHour * p.peak_hour_factor;
    const peakWorkHoursPerHour = peakMovesPerHour * perMove / 3600;
    const trucksAverage = dailyWorkHours / p.operating_hours_per_day / p.truck_efficiency;
    const forkliftsNeeded = Math.max(moves > 0 ? 1 : 0, Math.ceil(peakWorkHoursPerHour / p.truck_efficiency - 1e-9));

    const trace = [
      { label: "Storage policy", expr: weights.abc ? "ABC: A = fastest 20% of cells, B = next 30%, C = rest; F(u) = u^" + fmt(weights.k, 2) : "random: every cell equally likely",
        value: weights.abc ? "A " + Math.round(weights.shares[0] * 100) + "% · B " + Math.round(weights.shares[1] * 100) + "% · C " + Math.round(weights.shares[2] * 100) + "% of moves" : "uniform" },
      { label: "Putaway cycle (single command)", expr: "Σ weight × [2 × (door-to-aisle + to bay) / v + 2 × lift / v_lift + overhead]", value: fmt(eIn, 0) + " s" },
      { label: "Retrieval cycle (single command)", expr: "same, from the shipping doors", value: fmt(eOut, 0) + " s" },
      { label: "Single-command cycle", expr: "(putaway + retrieval) / 2", value: fmt(travelTime, 0) + " driving + " + fmt(liftTime, 0) + " lifting + " + fmt(p.forklift_cycle_overhead, 0) + " = " + fmt(scCycle, 0) + " s" },
      { label: "Dual-command cycle", expr: "in door → A → B → out door → back; A→B via the shorter cross-aisle (" + DC_SAMPLES + " sampled pairs)", value: fmt(dcCycle, 0) + " s for 2 moves" },
      { label: "Time per pallet move", expr: "(1 − dual_share) × single + dual_share × dual / 2", value: fmt(perMove, 0) + " s" },
      { label: "Peak-hour work", expr: "moves / hours × peak_factor × time per move", value: fmt(peakMovesPerHour, 0) + " moves/h × " + fmt(perMove, 0) + " s = " + fmt(peakWorkHoursPerHour, 2) + " truck-h/h" },
      { label: "Lift trucks needed", expr: "ceil(peak truck-hours per hour / efficiency)", value: forkliftsNeeded + " (average " + fmt(trucksAverage, 1) + ")" }
    ];
    return {
      cycleTime: scCycle, putawayCycle: eIn, retrievalCycle: eOut, travelTime, liftTime, avgRoundTrip, avgLiftHeight: eZ,
      dcCycle, dcTravel, dualShare: share, perMove,
      dailyTravelDistance, dailyWorkHours, avgMovesPerHour, peakMovesPerHour, trucksAverage, forkliftsNeeded,
      avgTripsPerHour: avgMovesPerHour, peakTripsPerHour: peakMovesPerHour,
      trace
    };
  }

  // ---------------------------------------------------------------------
  // 7. Docks — trucks, not pallets; queueing at the doors
  // ---------------------------------------------------------------------
  // Erlang C: probability an arriving truck has to wait when c doors each
  // serve μ trucks/h and trucks arrive at random (Poisson) at λ/h.
  function erlangC(c, a) {
    if (c <= 0) return 1;
    if (a >= c) return 1;
    let term = 1, sum = 1;                     // Σ_{k<c} a^k/k!, built iteratively
    for (let k = 1; k < c; k++) { term *= a / k; sum += term; }
    const last = term * a / c;                 // a^c / c!
    const top = last / (1 - a / c);
    return top / (sum + top);
  }
  function computeThroughput(p) {
    const perSide = function (doors) {
      const pallets = p.daily_throughput_pallets / 2;
      const trucksPerDay = pallets / p.pallets_per_truck;
      const mu = 60 / p.truck_turn_time;                                   // trucks one door can serve per hour
      const capacityTrucksPerHour = doors * mu;
      const peakTrucksPerHour = trucksPerDay / p.operating_hours_per_day * p.peak_hour_factor;
      const utilizationPct = capacityTrucksPerHour > 0 ? peakTrucksPerHour / capacityTrucksPerHour * 100 : Infinity;
      const capacityPalletsPerDay = capacityTrucksPerHour * p.operating_hours_per_day * p.pallets_per_truck;
      const a = peakTrucksPerHour / mu;
      const pWait = erlangC(doors, a);
      // M/M/c mean wait, corrected for less variable turn times (Allen–Cunneen)
      const waitMin = a >= doors ? Infinity : pWait / (doors * mu - peakTrucksPerHour) * 60 * (1 + TURN_CS2) / 2;
      return { doors, pallets, trucksPerDay, capacityTrucksPerHour, peakTrucksPerHour, utilizationPct, capacityPalletsPerDay, pWait, waitMin };
    };
    const inbound = perSide(p.num_receiving_docks), outbound = perSide(p.num_shipping_docks);
    const dockUtilizationPct = Math.max(inbound.utilizationPct, outbound.utilizationPct);
    const dockCapacityPerDay = 2 * Math.min(inbound.capacityPalletsPerDay, outbound.capacityPalletsPerDay);
    const bottleneck = inbound.utilizationPct >= outbound.utilizationPct ? "receiving" : "shipping";
    const maxWait = Math.max(inbound.waitMin, outbound.waitMin);

    return {
      inbound, outbound, dockUtilizationPct, dockCapacityPerDay, bottleneck, maxWait,
      totalDocks: p.num_receiving_docks + p.num_shipping_docks,
      dockBound: dockUtilizationPct >= 100,
      status: dockUtilizationPct >= 100 ? "critical" : (dockUtilizationPct > 85 || maxWait > 30) ? "warning" : "good",
      trace: [
        { label: "Trucks per day (each way)", expr: "throughput / 2 / pallets_per_truck", value: fmt(inbound.pallets, 0) + " / " + p.pallets_per_truck + " = " + fmt(inbound.trucksPerDay, 1) },
        { label: "Peak trucks per hour", expr: "trucks_per_day / hours × peak_factor", value: fmt(inbound.peakTrucksPerHour, 2) },
        { label: "Door capacity (in / out)", expr: "doors × 60 / truck_turn_time", value: fmt(inbound.capacityTrucksPerHour, 2) + " / " + fmt(outbound.capacityTrucksPerHour, 2) + " trucks/h" },
        { label: "Peak door utilization (in / out)", expr: "peak trucks/h ÷ door capacity", value: fmt(inbound.utilizationPct, 0) + "% / " + fmt(outbound.utilizationPct, 0) + "%" },
        { label: "Chance a truck waits (in / out)", expr: "Erlang C(doors, peak trucks/h × turn time)", value: fmt(inbound.pWait * 100, 0) + "% / " + fmt(outbound.pWait * 100, 0) + "%" },
        { label: "Mean wait at the peak (in / out)", expr: "Erlang C / (c·μ − λ) × (1 + " + TURN_CS2 + ") / 2  (Allen–Cunneen)", value: (isFinite(inbound.waitMin) ? fmt(inbound.waitMin, 1) : "∞") + " / " + (isFinite(outbound.waitMin) ? fmt(outbound.waitMin, 1) : "∞") + " min" }
      ]
    };
  }

  // ---------------------------------------------------------------------
  // 8. Cost — illustrative order-of-magnitude, not a quotation
  // ---------------------------------------------------------------------
  function computeCost(layout, capacity, p) {
    const t = p.wall_thickness / 1000;
    const footprint = (p.warehouse_length + 2 * t) * (p.warehouse_width + 2 * t);
    const rackingCost = capacity.storageCapacity * p.cost_per_rack_position;
    const buildingCost = footprint * p.cost_per_sqm_building;
    const dockCost = (p.num_receiving_docks + p.num_shipping_docks) * p.cost_per_dock;
    const totalCost = rackingCost + buildingCost + dockCost;
    const costPerPosition = capacity.storageCapacity > 0 ? totalCost / capacity.storageCapacity : NaN;
    return {
      footprint, rackingCost, buildingCost, dockCost, totalCost, costPerPosition,
      trace: [
        { label: "Building footprint", expr: "(length + 2 × wall) × (width + 2 × wall)", value: int(footprint) + " m²" },
        { label: "Racking cost", expr: "storage_capacity × cost_per_position", value: "$" + int(rackingCost) },
        { label: "Building shell cost", expr: "footprint × cost_per_sqm", value: "$" + int(buildingCost) },
        { label: "Dock cost", expr: "total_docks × cost_per_dock", value: "$" + int(dockCost) },
        { label: "Total cost", expr: "racking + building + docks", value: "$" + int(totalCost) }
      ]
    };
  }

  // ---------------------------------------------------------------------
  // Orchestration
  // ---------------------------------------------------------------------
  function computeAll(p, rackTypes) {
    const layout = computeLayout(p, rackTypes);
    const capacity = computeCapacity(layout, p);
    const utilization = computeUtilization(capacity, p);
    const grid = slotGrid(p, layout);
    const weights = moveWeights(p, grid);
    const travel = computeTravel(layout, p, grid, weights);
    const throughput = computeThroughput(p);
    const cost = computeCost(layout, capacity, p);

    const warnings = layout.warnings.slice();
    if (utilization.status === "critical") {
      warn(warnings, "critical", "Inventory (" + int(p.current_inventory_pallets) + ") exceeds storage capacity (" + int(capacity.storageCapacity) + ") by " + int(utilization.overflowPallets) + " pallets.");
    } else if (utilization.status === "warning") {
      warn(warnings, "warning", "Inventory is above the " + Math.round(utilization.ceilingPct) + "% planning ceiling for " + layout.rackType.label.toLowerCase() +
        " racking — expect part-empty lanes you can't use and slow putaway.");
    }
    if (throughput.status === "critical") {
      warn(warnings, "critical", "At the peak hour, trucks arrive faster than the " + throughput.bottleneck + " doors can turn them — the yard queue grows without limit; docks, not storage, are the bottleneck.");
    } else if (throughput.status === "warning") {
      warn(warnings, "warning", "At the peak hour the " + throughput.bottleneck + " doors run at " + Math.round(throughput.dockUtilizationPct) + "% and trucks wait about " + Math.round(throughput.maxWait) + " min on average — expect a yard queue.");
    }
    if (travel.dualShare > 0 && travel.dcCycle / 2 > travel.cycleTime) {
      warn(warnings, "info", "Here a dual-command trip takes longer per pallet (" + Math.round(travel.dcCycle / 2) + " s) than a single-command one (" + Math.round(travel.cycleTime) + " s)" +
        (p.flow_layout === "u_flow" ? "." : ": with I-flow the truck finishes at the shipping end and drives back empty."));
    }
    if (weights.abc && p.flow_layout !== "u_flow") {
      warn(warnings, "info", "With I-flow, a bay near one end is far from the other end's doors, so ABC slotting only gains across the width and in height; U-flow lets it gain along the aisles too.");
    }

    return { layout, capacity, utilization, travel, throughput, cost, warnings, doors: grid.doors, slots: { grid: grid, weights: weights } };
  }

  return {
    computeLayout, computeCapacity, computeUtilization, computeTravel, computeThroughput, computeCost, computeAll,
    doorSets, aisleOf, slotGrid, slotTimes, slotTimeGrid, moveWeights, sampler, dcContext, dcPair, erlangC, mulberry32,
    BEAM_ALLOWANCE, ABC_BOUNDS, DC_SAMPLES, TURN_CS2
  };
});
