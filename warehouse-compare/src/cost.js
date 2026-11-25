/*
 * cost.js — what each warehouse costs to build and to run, per year and per
 * order line. Illustrative order-of-magnitude figures, not a quotation.
 *
 * Up-front costs become equivalent annual costs with the capital recovery
 * factor CRF(r, n) = r(1+r)^n / ((1+r)^n − 1) over each asset's life — the
 * Warehouse Model's own crf(), so the two apps cost a building the same way.
 *
 *   building         floor area × cost per m²                          30 years
 *   storage          WH-B/C: locations × shelving cost per location     20 years
 *                    WH-A:   pods × pod cost                            20 years
 *   stations         WH-B/C: pack stations at the picking points        10 years
 *                    WH-A:   goods-to-person stations (one per picker)  10 years
 *   robots           WH-A:   robots × price                              8 years
 *   labour           paid picker-hours: lines/day × time per line ÷ efficiency,
 *                    × days × wage — the same rule for every layout, so no
 *                    one is charged for a peak-hour crew all day
 *   robot running    WH-A:   robots × upkeep and energy per year
 *
 * Pure, no DOM: window.WC.cost in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("../../warehouse-model/web/src/calculations.js"), require("./t.js"));
  else { root.WC = root.WC || {}; root.WC.cost = factory(root.WH.calc, root.WC.t); }
})(typeof self !== "undefined" ? self : this, function (calc, tr) {
  "use strict";

  const LIFE = { building: 30, storage: 20, stations: 10, robots: 8 };
  const T = tr.T, int = tr.int;

  // id: "A" | "B" | "C"; k: the layout's KPIs; n: { stations, pods } (counts the KPIs don't carry)
  function compute(id, k, sc, n) {
    const r = sc.discount_rate, days = sc.operating_days_per_year;
    const building = k.footprint * sc.building_cost_per_sqm;
    const storage = id === "A" ? n.pods * sc.pod_cost : k.locations * sc.shelving_cost_per_location;
    const stations = n.stations * (id === "A" ? sc.gtp_station_cost : sc.pack_station_cost);
    const robots = id === "A" ? k.robotsNeeded * sc.robot_cost : 0;
    const capex = building + storage + stations + robots;
    const annualCapital = building * calc.crf(r, LIFE.building) + storage * calc.crf(r, LIFE.storage) + stations * calc.crf(r, LIFE.stations) + robots * calc.crf(r, LIFE.robots);
    const pickerHours = sc.lines_per_day * k.timePerLine / 3600 / sc.picker_efficiency;
    const labour = pickerHours * days * sc.labour_cost_per_hour;
    const running = id === "A" ? k.robotsNeeded * sc.robot_running_cost_per_year : 0;
    const annual = annualCapital + labour + running;
    const linesYear = sc.lines_per_day * days;
    const out = {
      capex: capex, annualCost: annual, costPer1000Lines: 1000 * annual / linesYear,
      parts: { building: building, storage: storage, stations: stations, robots: robots, annualCapital: annualCapital, labour: labour, running: running, pickerHours: pickerHours }
    };
    const ann = (1000 * annual / linesYear);
    out.trace = [
      { label: T("Build cost"), expr: id === "A" ? T("floor × $/m² + pods × pod cost + stations × goods-to-person station + robots × price") : T("floor × $/m² + locations × shelving + picking points × pack station"),
        value: "$" + int(building) + " + $" + int(storage) + " + $" + int(stations) + (id === "A" ? " + $" + int(robots) : "") + " = $" + int(capex) },
      { label: T("Annual capital cost"), expr: (id === "A" ? T("Σ cost × CRF({r}%, life): building {b} y, storage {s} y, stations {t} y, robots {o} y", { r: r, b: LIFE.building, s: LIFE.storage, t: LIFE.stations, o: LIFE.robots })
        : T("Σ cost × CRF({r}%, life): building {b} y, storage {s} y, stations {t} y", { r: r, b: LIFE.building, s: LIFE.storage, t: LIFE.stations })), value: T("${v} / year", { v: int(annualCapital) }) },
      { label: T("Pickers' pay"), expr: T("lines/day × time per line ÷ efficiency × days × $/h"), value: T("{h} picker-hours a day → ${v} / year", { h: int(pickerHours), v: int(labour) }) },
      { label: T("Total cost of ownership"), expr: id === "A" ? T("capital + pay + robot upkeep (${v})", { v: int(running) }) : T("capital + pay"), value: T("${v} / year = ${p} per 1,000 lines", { v: int(annual), p: int(ann) }) }
    ];
    return out;
  }

  return { LIFE: LIFE, compute: compute };
});
