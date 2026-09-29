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

  const fmt = function (v, d) { return Number(v).toFixed(d === undefined ? 1 : d); };
  const int = function (v) { return Math.round(v).toLocaleString("en-US"); };
  const mean = function (a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : 0; };

  function warn(list, level, text) { list.push({ level: level, text: text }); }

  // ---------------------------------------------------------------------
  // 1. Layout — how many rows, bays and levels physically fit, and where
  // ---------------------------------------------------------------------
  // This is the derivation freecad/create_model.py mirrors (derive_layout,
  // same names and order); tests/parity.test.js checks the two agree.
  //
  // Across the width the pattern is  row | aisle | row  (one "aisle unit",
  // each row facing its aisle), with a flue gap between the backs of
  // neighbouring units:  N·unit + (N−1)·flue ≤ width.
  function computeLayout(p, rackTypes) {
    const warnings = [];
    const rt = rackTypes[p.rack_type];
    if (!rt) throw new Error("Unknown rack_type: " + p.rack_type);

    const usableLength = p.warehouse_length - 2 * p.cross_aisle_width;
    const baysPerRow = Math.max(0, Math.floor(usableLength / p.bay_width + 1e-9));
    const rackRowLength = baysPerRow * p.bay_width;
    if (baysPerRow < 1) warn(warnings, "critical", "Warehouse is too short for even one rack bay once both cross-aisles are reserved.");

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
      rows.push({ index: rows.length + 1, y: y0, depth: rowDepth, faces: +1 });
      aisles.push({ index: i + 1, y: y0 + rowDepth + p.aisle_width / 2, width: p.aisle_width });
      rows.push({ index: rows.length + 1, y: y0 + rowDepth + p.aisle_width, depth: rowDepth, faces: -1 });
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

    const receivingWallNeeded = p.num_receiving_docks * p.dock_bay_width;
    const shippingWallNeeded = p.num_shipping_docks * p.dock_bay_width;
    if (receivingWallNeeded > p.warehouse_width) warn(warnings, "critical", "Receiving docks (" + fmt(receivingWallNeeded) + " m of wall) don't fit along a " + fmt(p.warehouse_width) + " m end wall.");
    if (shippingWallNeeded > p.warehouse_width) warn(warnings, "critical", "Shipping docks (" + fmt(shippingWallNeeded) + " m of wall) don't fit along a " + fmt(p.warehouse_width) + " m end wall.");

    return {
      rackType: rt, usableLength, baysPerRow, rackRowLength, rowDepth,
      widthPerAisleUnit, numAisleUnits, numRackRows, rackingWidthUsed, yOffset, rows, aisles,
      levelPitch, levelHeights, pitchNeeded, clearanceNeeded,
      receivingWallNeeded, shippingWallNeeded,
      warnings,
      trace: [
        { label: "Usable length (racking zone)", expr: "warehouse_length − 2 × cross_aisle_width", value: fmt(usableLength) + " m" },
        { label: "Bays per row", expr: "floor(usable_length / bay_width)", value: baysPerRow },
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
  // 4. Lift-truck travel and fleet — exact expectation over the real layout
  // ---------------------------------------------------------------------
  // Single-command trips under random storage: a truck takes a pallet from a
  // receiving door to a random slot and returns (putaway), or fetches one
  // from a random slot to a shipping door (retrieval). Route (rectilinear):
  // door → across the staging zone to the aisle → down the aisle to the bay.
  // Averaged EXACTLY over every door, aisle, bay and level of this layout
  // (not a textbook approximation), since the mean of a sum is the sum of
  // the means: E[one-way] = E|y_door − y_aisle| + E[x distance to the bay].
  // The racking starts at the receiving end's cross-aisle, so any length
  // left over after the last whole bay makes shipping trips a little longer.
  // Lifting happens after stopping at the bay, so lift time adds:
  //   cycle = 2·E[h]/v + 2·E[z]/v_lift + overhead.
  function doorCentres(count, p) {
    const y0 = (p.warehouse_width - count * p.dock_bay_width) / 2;
    const out = [];
    for (let i = 0; i < count; i++) out.push(y0 + (i + 0.5) * p.dock_bay_width);
    return out;
  }
  function meanLateral(doors, aisles) {
    if (!aisles.length || !doors.length) return 0;
    let s = 0;
    aisles.forEach(function (a) { doors.forEach(function (d) { s += Math.abs(d - a.y); }); });
    return s / (aisles.length * doors.length);
  }

  function computeTravel(layout, p) {
    const recvDoors = doorCentres(p.num_receiving_docks, p), shipDoors = doorCentres(p.num_shipping_docks, p);
    const latIn = meanLateral(recvDoors, layout.aisles), latOut = meanLateral(shipDoors, layout.aisles);
    const alongIn = p.cross_aisle_width + layout.rackRowLength / 2;
    const alongOut = p.warehouse_length - alongIn;
    const oneWayIn = latIn + alongIn, oneWayOut = latOut + alongOut;
    const avgOneWay = (oneWayIn + oneWayOut) / 2;          // half the pallets go in, half out
    const avgRoundTrip = 2 * avgOneWay;
    const avgLiftHeight = mean(layout.levelHeights);

    const travelTime = avgRoundTrip / p.forklift_speed;
    const liftTime = 2 * avgLiftHeight / p.lift_speed;
    const cycleTime = travelTime + liftTime + p.forklift_cycle_overhead;

    const trips = p.daily_throughput_pallets;
    const dailyTravelDistance = trips * avgRoundTrip;
    const dailyWorkHours = trips * cycleTime / 3600;
    const avgTripsPerHour = trips / p.operating_hours_per_day;
    const peakTripsPerHour = avgTripsPerHour * p.peak_hour_factor;
    const peakWorkHoursPerHour = peakTripsPerHour * cycleTime / 3600;
    const trucksAverage = dailyWorkHours / p.operating_hours_per_day / p.truck_efficiency;
    const forkliftsNeeded = Math.max(trips > 0 ? 1 : 0, Math.ceil(peakWorkHoursPerHour / p.truck_efficiency - 1e-9));

    return {
      latIn, latOut, alongIn, alongOut, avgOneWay, avgRoundTrip, avgLiftHeight,
      travelTime, liftTime, cycleTime,
      dailyTravelDistance, dailyWorkHours, avgTripsPerHour, peakTripsPerHour, trucksAverage, forkliftsNeeded,
      trace: [
        { label: "Avg. door-to-aisle distance", expr: "mean |y_door − y_aisle| over every door and aisle", value: "in " + fmt(latIn) + " m · out " + fmt(latOut) + " m" },
        { label: "Avg. distance along to the bay", expr: "in: cross_aisle + row_length / 2 · out: length − that", value: "in " + fmt(alongIn) + " m · out " + fmt(alongOut) + " m" },
        { label: "Avg. round trip", expr: "2 × (door-to-aisle + to the bay), in/out averaged", value: fmt(avgRoundTrip) + " m" },
        { label: "Avg. lift height", expr: "mean of the level heights", value: fmt(avgLiftHeight, 2) + " m" },
        { label: "Cycle time", expr: "round_trip / speed + 2 × lift / lift_speed + overhead", value: fmt(travelTime, 0) + " + " + fmt(liftTime, 0) + " + " + fmt(p.forklift_cycle_overhead, 0) + " = " + fmt(cycleTime, 0) + " s" },
        { label: "Peak-hour work", expr: "throughput / hours × peak_factor × cycle", value: fmt(peakTripsPerHour, 0) + " trips/h × " + fmt(cycleTime, 0) + " s = " + fmt(peakWorkHoursPerHour, 2) + " truck-h/h" },
        { label: "Lift trucks needed", expr: "ceil(peak truck-hours per hour / efficiency)", value: forkliftsNeeded + " (average " + fmt(trucksAverage, 1) + ")" }
      ]
    };
  }

  // ---------------------------------------------------------------------
  // 5. Docks — trucks, not pallets; inbound and outbound doors separately
  // ---------------------------------------------------------------------
  function computeThroughput(p) {
    const perSide = function (doors) {
      const pallets = p.daily_throughput_pallets / 2;
      const trucksPerDay = pallets / p.pallets_per_truck;
      const doorTurnsPerHour = 60 / p.truck_turn_time;                     // trucks one door can serve per hour
      const capacityTrucksPerHour = doors * doorTurnsPerHour;
      const peakTrucksPerHour = trucksPerDay / p.operating_hours_per_day * p.peak_hour_factor;
      const utilizationPct = capacityTrucksPerHour > 0 ? peakTrucksPerHour / capacityTrucksPerHour * 100 : Infinity;
      const capacityPalletsPerDay = capacityTrucksPerHour * p.operating_hours_per_day * p.pallets_per_truck;
      return { doors, pallets, trucksPerDay, capacityTrucksPerHour, peakTrucksPerHour, utilizationPct, capacityPalletsPerDay };
    };
    const inbound = perSide(p.num_receiving_docks), outbound = perSide(p.num_shipping_docks);
    const dockUtilizationPct = Math.max(inbound.utilizationPct, outbound.utilizationPct);
    const dockCapacityPerDay = 2 * Math.min(inbound.capacityPalletsPerDay, outbound.capacityPalletsPerDay);
    const bottleneck = inbound.utilizationPct >= outbound.utilizationPct ? "receiving" : "shipping";

    return {
      inbound, outbound, dockUtilizationPct, dockCapacityPerDay, bottleneck,
      totalDocks: p.num_receiving_docks + p.num_shipping_docks,
      dockBound: dockUtilizationPct > 100,
      status: dockUtilizationPct > 100 ? "critical" : dockUtilizationPct > 85 ? "warning" : "good",
      trace: [
        { label: "Trucks per day (each way)", expr: "throughput / 2 / pallets_per_truck", value: fmt(inbound.pallets, 0) + " / " + p.pallets_per_truck + " = " + fmt(inbound.trucksPerDay, 1) },
        { label: "Peak trucks per hour", expr: "trucks_per_day / hours × peak_factor", value: fmt(inbound.peakTrucksPerHour, 2) },
        { label: "Door capacity (in / out)", expr: "doors × 60 / truck_turn_time", value: fmt(inbound.capacityTrucksPerHour, 2) + " / " + fmt(outbound.capacityTrucksPerHour, 2) + " trucks/h" },
        { label: "Peak door utilization (in / out)", expr: "peak trucks/h ÷ door capacity", value: fmt(inbound.utilizationPct, 0) + "% / " + fmt(outbound.utilizationPct, 0) + "%" }
      ]
    };
  }

  // ---------------------------------------------------------------------
  // 6. Cost — illustrative order-of-magnitude, not a quotation
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
    const travel = computeTravel(layout, p);
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
      warn(warnings, "critical", "At the peak hour, trucks arrive faster than the " + throughput.bottleneck + " doors can turn them — docks, not storage, are the bottleneck.");
    } else if (throughput.status === "warning") {
      warn(warnings, "warning", "The " + throughput.bottleneck + " doors run above 85% at the peak hour — expect trucks queueing in the yard.");
    }

    return { layout, capacity, utilization, travel, throughput, cost, warnings };
  }

  return { computeLayout, computeCapacity, computeUtilization, computeTravel, computeThroughput, computeCost, computeAll, doorCentres, BEAM_ALLOWANCE };
});
