/*
 * calculations.js — the analytical model.
 *
 * Pure functions only: parameters in, numbers (+ traceable derivations) out.
 * No DOM access, no Three.js. This file is the one place every formula in
 * the app is defined, so the 3D view, the KPI dashboard and the charts can
 * never show numbers that disagree with each other.
 *
 * Every exported "compute*" function returns a plain object whose fields
 * are the results, plus a `trace` field: an ordered list of
 * { label, expr, value } steps a human can read top to bottom to see
 * exactly how the headline number was derived (spec: engineering
 * traceability — never a black-box number).
 */
(function (global) {
  "use strict";

  // ---------------------------------------------------------------------
  // 1. Layout — how many bays/rows of racking physically fit
  // ---------------------------------------------------------------------
  // This is the one derivation FreeCAD's create_model.py mirrors exactly
  // (same variable names, same order) so the CAD model and the live web
  // view are always describing the same building.
  function computeLayout(p) {
    const warnings = [];

    const usableLength = p.warehouse_length - 2 * p.cross_aisle_width;
    const baysPerRow = Math.max(0, Math.floor(usableLength / p.bay_width));
    const rackRowLength = baysPerRow * p.bay_width;
    if (usableLength <= 0 || baysPerRow < 1) {
      warnings.push("Warehouse is too short for even one rack bay once both cross-aisles are reserved.");
    }

    const widthPerAisleUnit = 2 * p.rack_depth + p.aisle_width;
    const numAisleUnits = Math.max(0, Math.floor(p.warehouse_width / widthPerAisleUnit));
    const numRackRows = numAisleUnits * 2;
    const rackingWidthUsed = numAisleUnits * widthPerAisleUnit;
    if (numAisleUnits < 1) {
      warnings.push("Warehouse is too narrow to fit a single pair of rack rows plus an aisle.");
    }

    const clearanceNeeded = p.rack_height + 1.5;
    if (clearanceNeeded > p.clear_height) {
      warnings.push(
        "Rack height (" + p.rack_height.toFixed(1) + " m) plus 1.5 m clearance exceeds the building's " +
        p.clear_height.toFixed(1) + " m clear height — racks don't fit under the roof."
      );
    }

    const receivingWallNeeded = p.num_receiving_docks * p.dock_bay_width;
    const shippingWallNeeded = p.num_shipping_docks * p.dock_bay_width;
    if (receivingWallNeeded > p.warehouse_width) {
      warnings.push("Receiving docks (" + receivingWallNeeded.toFixed(1) + " m of wall) don't fit along a " + p.warehouse_width.toFixed(1) + " m end wall.");
    }
    if (shippingWallNeeded > p.warehouse_width) {
      warnings.push("Shipping docks (" + shippingWallNeeded.toFixed(1) + " m of wall) don't fit along a " + p.warehouse_width.toFixed(1) + " m end wall.");
    }

    return {
      usableLength, baysPerRow, rackRowLength,
      widthPerAisleUnit, numAisleUnits, numRackRows, rackingWidthUsed,
      clearanceNeeded, receivingWallNeeded, shippingWallNeeded,
      warnings,
      trace: [
        { label: "Usable length (racking zone)", expr: "warehouse_length − 2 × cross_aisle_width", value: usableLength.toFixed(1) + " m" },
        { label: "Bays per row", expr: "floor(usable_length / bay_width)", value: baysPerRow },
        { label: "Width per aisle unit", expr: "2 × rack_depth + aisle_width", value: widthPerAisleUnit.toFixed(2) + " m" },
        { label: "Aisle units that fit", expr: "floor(warehouse_width / width_per_aisle_unit)", value: numAisleUnits },
        { label: "Rack rows", expr: "aisle_units × 2", value: numRackRows }
      ]
    };
  }

  // ---------------------------------------------------------------------
  // 2. Capacity
  // ---------------------------------------------------------------------
  function computeCapacity(layout, p) {
    const positionsPerBay = p.levels_per_rack * p.positions_per_level_per_bay;
    const totalBays = layout.numRackRows * layout.baysPerRow;
    const storageCapacity = totalBays * positionsPerBay;

    return {
      positionsPerBay, totalBays, storageCapacity,
      trace: [
        { label: "Positions per bay", expr: "levels_per_rack × positions_per_level_per_bay", value: positionsPerBay },
        { label: "Total bays", expr: "rack_rows × bays_per_row", value: layout.numRackRows + " × " + layout.baysPerRow + " = " + totalBays },
        { label: "Storage capacity", expr: "total_bays × positions_per_bay", value: totalBays + " × " + positionsPerBay + " = " + storageCapacity + " positions" }
      ]
    };
  }

  // ---------------------------------------------------------------------
  // 3. Utilization — deliberately allowed to exceed 100%
  // ---------------------------------------------------------------------
  function computeUtilization(capacity, p) {
    const utilizationPct = capacity.storageCapacity > 0
      ? (p.current_inventory_pallets / capacity.storageCapacity) * 100
      : Infinity;
    const overflowPallets = Math.max(0, p.current_inventory_pallets - capacity.storageCapacity);

    return {
      utilizationPct, overflowPallets,
      status: utilizationPct > 100 ? "critical" : utilizationPct > 90 ? "warning" : "good",
      trace: [
        { label: "Utilization", expr: "current_inventory_pallets / storage_capacity", value: p.current_inventory_pallets + " / " + capacity.storageCapacity + " = " + utilizationPct.toFixed(1) + "%" }
      ]
    };
  }

  // ---------------------------------------------------------------------
  // 4. Travel distance — simplified rectilinear (Manhattan) model
  // ---------------------------------------------------------------------
  // Deliberately simple and clearly labeled as such: half the rack block's
  // width (average lateral distance from the dock-facing end) plus half a
  // row's length (average position down the aisle) plus the cross-aisle
  // clearance. This is the standard textbook approximation for average
  // travel distance in a rectangular storage block, not a routed shortest
  // path — good enough to show how geometry trades off against distance,
  // not precise enough to schedule a fleet against.
  function computeTravel(layout, p) {
    const avgLateral = layout.rackingWidthUsed / 2;
    const avgAlongAisle = layout.rackRowLength / 2;
    const avgOneWay = p.cross_aisle_width + avgLateral + avgAlongAisle;
    const avgRoundTrip = 2 * avgOneWay;

    const dailyTravelDistance = p.daily_throughput_pallets * avgRoundTrip;
    const dailyTravelHours = dailyTravelDistance / p.forklift_speed / 3600;
    const dailyOverheadHours = (p.daily_throughput_pallets * p.forklift_cycle_overhead) / 3600;
    const dailyWorkHours = dailyTravelHours + dailyOverheadHours;
    const forkliftsNeeded = Math.ceil(dailyWorkHours / p.operating_hours_per_day);

    return {
      avgLateral, avgAlongAisle, avgOneWay, avgRoundTrip,
      dailyTravelDistance, dailyTravelHours, dailyOverheadHours, dailyWorkHours, forkliftsNeeded,
      trace: [
        { label: "Avg. lateral distance", expr: "racking_width_used / 2", value: avgLateral.toFixed(1) + " m" },
        { label: "Avg. distance along aisle", expr: "rack_row_length / 2", value: avgAlongAisle.toFixed(1) + " m" },
        { label: "Avg. one-way travel", expr: "cross_aisle_width + lateral + along-aisle", value: avgOneWay.toFixed(1) + " m" },
        { label: "Avg. round trip / movement", expr: "2 × one-way", value: avgRoundTrip.toFixed(1) + " m" },
        { label: "Daily travel distance", expr: "daily_throughput × round_trip", value: p.daily_throughput_pallets + " × " + avgRoundTrip.toFixed(1) + " m = " + Math.round(dailyTravelDistance).toLocaleString('en-US') + " m" },
        { label: "Forklifts needed", expr: "ceil(daily work hours / operating hours)", value: forkliftsNeeded }
      ]
    };
  }

  // ---------------------------------------------------------------------
  // 5. Dock throughput
  // ---------------------------------------------------------------------
  function computeThroughput(p) {
    const totalDocks = p.num_receiving_docks + p.num_shipping_docks;
    const dockCapacityPerDay = totalDocks * p.dock_handling_rate * p.operating_hours_per_day;
    const dockUtilizationPct = dockCapacityPerDay > 0
      ? (p.daily_throughput_pallets / dockCapacityPerDay) * 100
      : Infinity;

    return {
      totalDocks, dockCapacityPerDay, dockUtilizationPct,
      dockBound: dockUtilizationPct > 100,
      trace: [
        { label: "Dock capacity / day", expr: "total_docks × handling_rate × operating_hours", value: totalDocks + " × " + p.dock_handling_rate + " × " + p.operating_hours_per_day + " = " + Math.round(dockCapacityPerDay).toLocaleString('en-US') + " pallets/day" },
        { label: "Dock utilization", expr: "daily_throughput / dock_capacity", value: dockUtilizationPct.toFixed(1) + "%" }
      ]
    };
  }

  // ---------------------------------------------------------------------
  // 6. Cost — illustrative order-of-magnitude, not a quotation
  // ---------------------------------------------------------------------
  function computeCost(layout, capacity, p) {
    const footprint = p.warehouse_length * p.warehouse_width;
    const rackingCost = capacity.storageCapacity * p.cost_per_rack_position;
    const buildingCost = footprint * p.cost_per_sqm_building;
    const dockCost = (p.num_receiving_docks + p.num_shipping_docks) * p.cost_per_dock;
    const totalCost = rackingCost + buildingCost + dockCost;
    const costPerPosition = capacity.storageCapacity > 0 ? totalCost / capacity.storageCapacity : NaN;

    return {
      footprint, rackingCost, buildingCost, dockCost, totalCost, costPerPosition,
      trace: [
        { label: "Building footprint", expr: "warehouse_length × warehouse_width", value: Math.round(footprint).toLocaleString('en-US') + " m²" },
        { label: "Racking cost", expr: "storage_capacity × cost_per_position", value: "$" + Math.round(rackingCost).toLocaleString('en-US') },
        { label: "Building shell cost", expr: "footprint × cost_per_sqm", value: "$" + Math.round(buildingCost).toLocaleString('en-US') },
        { label: "Dock cost", expr: "total_docks × cost_per_dock", value: "$" + Math.round(dockCost).toLocaleString('en-US') },
        { label: "Total cost", expr: "racking + building + docks", value: "$" + Math.round(totalCost).toLocaleString('en-US') }
      ]
    };
  }

  // ---------------------------------------------------------------------
  // Orchestration
  // ---------------------------------------------------------------------
  function computeAll(p) {
    const layout = computeLayout(p);
    const capacity = computeCapacity(layout, p);
    const utilization = computeUtilization(capacity, p);
    const travel = computeTravel(layout, p);
    const throughput = computeThroughput(p);
    const cost = computeCost(layout, capacity, p);

    const warnings = layout.warnings.slice();
    if (utilization.status === "critical") {
      warnings.push("Inventory (" + p.current_inventory_pallets.toLocaleString('en-US') + ") exceeds storage capacity (" + capacity.storageCapacity.toLocaleString('en-US') + ") by " + utilization.overflowPallets.toLocaleString('en-US') + " pallets.");
    }
    if (throughput.dockBound) {
      warnings.push("Daily throughput exceeds dock capacity — docks, not storage, are the bottleneck.");
    }

    return { layout, capacity, utilization, travel, throughput, cost, warnings };
  }

  global.WH = global.WH || {};
  global.WH.calc = { computeLayout, computeCapacity, computeUtilization, computeTravel, computeThroughput, computeCost, computeAll };
})(window);
