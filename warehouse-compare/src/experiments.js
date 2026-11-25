/*
 * experiments.js — the comparison experiments behind the Sensitivity and
 * Demand shock views.
 *
 *   SWEEPS            the inputs a sensitivity sweep can vary, with their ranges
 *   point(inputs, key, value)
 *                     every layout re-sized and re-evaluated with one input
 *                     changed — one point of a sweep (the page calls it point by
 *                     point so it can draw as it goes)
 *   shock(inputs, results, opts)
 *                     WH-A: the four put-away policies on the same floor with the
 *                     same robot fleet, through a demand shock, as time series
 *                     (robot travel per line and wait for a station, per window)
 *                     WH-B / WH-C: travel per line before and after the same
 *                     shift, slotting left as it was
 *
 * Pure, no DOM: window.WC.experiments in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./scenario.js"), require("./rmfs.js"), require("./kpi.js"));
  else { root.WC = root.WC || {}; root.WC.experiments = factory(root.WC.scenario, root.WC.rmfs, root.WC.kpi); }
})(typeof self !== "undefined" ? self : this, function (scenario, rmfs, kpi) {
  "use strict";

  const SWEEPS = [
    { key: "demand_skew",      label: "Demand skew",       unit: "%",         values: [50, 60, 70, 80, 90, 95] },
    { key: "lines_per_order",  label: "Lines per order",   unit: "",          values: [1, 2, 3, 5, 8] },
    { key: "lines_per_day",    label: "Lines per day",     unit: "",          values: [4000, 8000, 12000, 20000, 30000] },
    { key: "target_locations", label: "Storage locations", unit: "",          values: [3000, 5000, 7000, 10000, 15000] },
    { key: "pick_time_per_line", label: "Pick time per line", unit: "s",      values: [4, 6, 8, 12, 16] }
  ];

  function clone(inputs) { return JSON.parse(JSON.stringify(inputs)); }

  function point(inputs, key, value) {
    const i = clone(inputs);
    i.sc[key] = value;
    // capacity follows the SKU count: keep SKUs at the same share of the locations
    if (key === "target_locations") i.sc.skus = Math.min(i.sc.skus, Math.floor(value * inputs.sc.skus / inputs.sc.target_locations));
    if (i.sc.skus > i.sc.target_locations) i.sc.target_locations = i.sc.skus;
    scenario.syncB(i);
    const r = scenario.run(i);
    const out = {};
    ["A", "B", "C"].forEach(function (id) { out[id] = r[id].infeasible ? null : r[id].kpi; });
    return out;
  }

  const POLICIES = ["fixed", "random", "nearest", "frequency"];

  // opts: { shift (default 0.5), at_h (default A.warmup_hours), after_h (4), step_s (900),
  //         robots (default: the fleet WH-A was sized to) }
  function shock(inputs, results, opts) {
    opts = opts || {};
    const sc = inputs.sc, A = inputs.layouts.A, z = results.A.sizing;
    const robots = opts.robots || z.robotsActive, at = opts.at_h === undefined ? A.warmup_hours : opts.at_h, after = opts.after_h || 4, step = opts.step_s || 900, shift = opts.shift === undefined ? 0.5 : opts.shift;
    const series = {};
    POLICIES.forEach(function (pa) {
      const r = rmfs.simulate(z.layout, sc, Object.assign({}, A, { put_away: pa }), { robots: robots, warmup_h: at, measure_h: after, history: step, shock: { at_h: at, shift: shift } });
      const h = r.history, pts = [];
      for (let k = 1; k < h.length; k++) {
        const dl = h[k].lines - h[k - 1].lines, ds = h[k].started - h[k - 1].started;
        pts.push({ t: h[k].t / 3600, travel: dl > 0 ? (h[k].dist - h[k - 1].dist) / dl : NaN, wait: ds > 0 ? (h[k].wait - h[k - 1].wait) / ds : NaN, podDist: h[k].podDist, backlog: h[k].backlog });
      }
      series[pa] = pts;
    });
    // WH-B, WH-C: the same shift, slotting unchanged
    const static_ = {};
    ["B", "C"].forEach(function (id) {
      const L = results[id].layout;
      static_[id] = { before: results[id].kpi.travelPerLine, after: kpi.evaluate(L, sc, { shift: shift }).kpi.travelPerLine };
    });
    return { series: series, static: static_, at: at, after: after, robots: robots, policy: A.put_away, shift: shift };
  }

  // mean of a series' field over [t0, t1] hours
  function mean(pts, field, t0, t1) {
    const xs = pts.filter(function (p) { return p.t > t0 && p.t <= t1 && isFinite(p[field]); }).map(function (p) { return p[field]; });
    return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : NaN;
  }

  return { SWEEPS, POLICIES, point, shock, mean };
});
