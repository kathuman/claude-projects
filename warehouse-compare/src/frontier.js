/*
 * frontier.js — screening: which picking technology a site's context calls
 * for, on the flexibility (F) vs efficiency (E) frontier of
 * data/archetypes.json. A port of the integration spec of 2026-11-25
 * (section 5), checked against the spec's own Python on random sites
 * (tests/frontier.test.js, tools/frontier_reference.py).
 *
 *   1  normalise   lin(x, a, b) = clamp((x − a)/(b − a), 0, 1); a > b inverts
 *   2  score       F_required = 100 × Σ w·flexibility inputs;  P = Σ w·efficiency inputs
 *   3  target      F_target = clamp(F_required − shift × (P − 0.5), 0, 100)
 *   4  filter      lease horizon, SKUs outside a standard container, flat floor
 *   5  select      the feasible archetype nearest F_target (ties: higher E); runner-up next
 *   6  report      site point E on the frontier at F_target (straight lines between the
 *                  archetypes, ends held flat beyond the first and last); boundary case if
 *                  the pick changes at F_target ± boundary; drivers by weight × value
 *
 * Settings (weights, bounds, shift, boundary) come from the catalogue's
 * config, and any of them can be overridden. Costs are in EUR, as in the spec.
 *
 * A screening result, not an investment decision: the coordinates are expert
 * judgement and uncalibrated.
 *
 * Pure, no DOM: window.WC.frontier in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./t.js"));
  else { root.WC = root.WC || {}; root.WC.frontier = factory(root.WC.t); }
})(typeof self !== "undefined" ? self : this, function (tr) {
  "use strict";
  const T = tr.T;

  // Σ with Neumaier compensation, the way Python (3.12+) sums floats: the
  // reference and the port then agree to the last bit, even at rounding ties
  function fsum(xs) {
    let s = 0, c = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i], t = s + x;
      c += Math.abs(s) >= Math.abs(x) ? (s - t) + x : (x - t) + s;
      s = t;
    }
    return s + c;
  }
  function lin(x, a, b) { return Math.max(0, Math.min(1, (x - a) / (b - a))); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  // round the value as stored (53.05 is stored as 53.0499…, so 53.0), as Python's
  // round() does; Math.round(v × 10) would round the product, 530.5, up
  function round(v, d) { return Number(v.toFixed(d)); }

  // ---------------------------------------------------------------- inputs
  // Returns a list of problems ([] when the site is valid), each { input, text }.
  function validate(site) {
    const out = [], num = function (k) { return typeof site[k] === "number" && isFinite(site[k]); };
    const need = function (k, ok, text) { if (!num(k) || !ok(site[k])) out.push({ input: k, text: text }); };
    need("demand_cv_weekly", function (v) { return v >= 0; }, T("Weekly demand variability must be 0 or more."));
    need("annual_sku_churn", function (v) { return v >= 0 && v <= 1; }, T("Yearly SKU churn must be between 0 and 1."));
    need("lease_horizon_years", function (v) { return v > 0; }, T("The lease horizon must be more than 0 years."));
    need("peak_to_average_ratio", function (v) { return v >= 1; }, T("The peak-to-average ratio must be 1 or more."));
    need("share_skus_outside_container", function (v) { return v >= 0 && v <= 1; }, T("The share of SKUs outside a container must be between 0 and 1."));
    need("rent_eur_per_m2_year", function (v) { return v > 0; }, T("Rent must be more than 0."));
    need("labour_cost_eur_per_hour", function (v) { return v > 0; }, T("Labour cost must be more than 0."));
    need("order_lines_per_day", function (v) { return v > 0; }, T("Order lines per day must be more than 0."));
    if (["low", "medium", "high"].indexOf(site.growth_uncertainty) < 0) out.push({ input: "growth_uncertainty", text: T("Growth uncertainty must be low, medium or high.") });
    if (typeof site.flat_floor !== "boolean") out.push({ input: "flat_floor", text: T("Say whether the floor is flat enough for robots.") });
    return out;
  }

  // ---------------------------------------------------------------- the frontier
  // E on the frontier at F: straight lines between the archetypes ordered by F,
  // held flat beyond the first and last
  function frontierE(archetypes, F) {
    const p = archetypes.slice().sort(function (a, b) { return a.F - b.F; });
    if (F <= p[0].F) return p[0].E;
    if (F >= p[p.length - 1].F) return p[p.length - 1].E;
    for (let i = 1; i < p.length; i++) if (F <= p[i].F) {
      const t = (F - p[i - 1].F) / (p[i].F - p[i - 1].F);
      return p[i - 1].E + t * (p[i].E - p[i - 1].E);
    }
    return p[p.length - 1].E;
  }

  // why an archetype can't serve the site: [] when it can
  function exclusions(a, site) {
    const c = a.constraints, out = [];
    if (site.lease_horizon_years < c.min_lease_years)
      out.push({ code: "lease", input: "lease_horizon_years", value: site.lease_horizon_years, limit: c.min_lease_years,
        reason: "lease_horizon_years " + site.lease_horizon_years + " < min " + c.min_lease_years,
        text: T("A {v}-year lease is shorter than the {m} years this needs.", { v: tr.fx(site.lease_horizon_years, 0), m: c.min_lease_years }) });
    if (site.share_skus_outside_container > c.max_share_skus_outside_container)
      out.push({ code: "container", input: "share_skus_outside_container", value: site.share_skus_outside_container, limit: c.max_share_skus_outside_container,
        reason: "share_skus_outside_container " + site.share_skus_outside_container + " > max " + c.max_share_skus_outside_container,
        text: T("{v}% of SKUs don't fit a standard container; this takes at most {m}%.", { v: tr.fx(100 * site.share_skus_outside_container, 0), m: tr.fx(100 * c.max_share_skus_outside_container, 0) }) });
    if (c.requires_flat_floor && !site.flat_floor)
      out.push({ code: "floor", input: "flat_floor", value: false, limit: true, reason: "flat_floor false but required", text: T("Needs a flat floor.") });
    return out;
  }

  // ---------------------------------------------------------------- recommend
  // site: the spec's site input; catalogue: data/archetypes.json; override: any config keys to replace
  function recommend(site, catalogue, override) {
    const cfg = Object.assign({}, catalogue.config, override || {});
    const problems = validate(site);
    if (problems.length) return { ok: false, problems: problems };

    const flex = cfg.flexibility.map(function (f) {
      const v = f.levels ? f.levels[site[f.input]] : lin(site[f.input], f.a, f.b);
      return { input: f.input, normalized: v, weight: f.weight };
    });
    const P = fsum(cfg.efficiency.map(function (f) { return lin(site[f.input], f.a, f.b) * f.weight; }));
    const Freq = 100 * fsum(flex.map(function (f) { return f.normalized * f.weight; }));
    const Ft = clamp(Freq - cfg.shift * (P - 0.5), 0, 100);

    const feasible = [], excluded = [];
    catalogue.archetypes.forEach(function (a) {
      const why = exclusions(a, site);
      if (why.length) excluded.push({ id: a.id, reason: why.map(function (w) { return w.reason; }).join("; "), reasons: why });
      else feasible.push(a);
    });
    if (!feasible.length) return { ok: false, problems: [{ input: null, text: T("No technology in the catalogue fits these constraints.") }], excluded: excluded };

    const pick = function (ft) {
      return feasible.slice().sort(function (a, b) { return Math.abs(a.F - ft) - Math.abs(b.F - ft) || b.E - a.E; });
    };
    const ranked = pick(Ft);
    const boundary = [-cfg.boundary, cfg.boundary].some(function (d) { return pick(clamp(Ft + d, 0, 100))[0].id !== ranked[0].id; });
    const drivers = flex.slice().sort(function (a, b) { return b.normalized * b.weight - a.normalized * a.weight; });
    return {
      ok: true, version: catalogue.version,
      F_required: round(Freq, 1), efficiency_pressure: round(P, 2), F_target: round(Ft, 1),
      recommended: ranked[0].id, runner_up: ranked.length > 1 ? ranked[1].id : null,
      boundary_case: boundary, excluded: excluded,
      site_point: { F: round(Ft, 1), E: round(frontierE(catalogue.archetypes, Ft), 1) },
      drivers: drivers.map(function (d) { return { input: d.input, normalized: round(d.normalized, 2), weight: d.weight }; }),
      exact: { F_required: Freq, efficiency_pressure: P, F_target: Ft }
    };
  }

  return { fsum: fsum, lin: lin, validate: validate, frontierE: frontierE, exclusions: exclusions, recommend: recommend };
});
