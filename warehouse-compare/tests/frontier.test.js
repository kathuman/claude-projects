// Technology screening on the flexibility vs efficiency frontier —
// run with:  node warehouse-compare/tests/frontier.test.js
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const fr = require("../src/frontier.js");
const { check, near, summary } = require("./harness.js");

const CAT_PATH = path.join(__dirname, "../data/archetypes.json");
const cat = JSON.parse(fs.readFileSync(CAT_PATH, "utf8"));
const site0 = cat.example_site;
const byId = (id) => cat.archetypes.find((a) => a.id === id);

// ---------------------------------------------------------------- the spec's worked example (section 5)
{
  const r = fr.recommend(site0, cat);
  check("worked example: valid", r.ok, JSON.stringify(r.problems));
  check("worked example: F_required 55.6", r.F_required === 55.6, r.F_required);
  check("worked example: efficiency pressure 0.51", r.efficiency_pressure === 0.51, r.efficiency_pressure);
  check("worked example: F_target 55.2", r.F_target === 55.2, r.F_target);
  check("worked example: shelf-to-person recommended", r.recommended === "shelf_to_person");
  check("worked example: climbing robots runner-up", r.runner_up === "climbing_robots");
  check("worked example: boundary case", r.boundary_case === true);
  check("worked example: fixed AS/RS and cube storage excluded on lease, with the spec's reasons",
    JSON.stringify(r.excluded.map((e) => [e.id, e.reason])) === JSON.stringify([["fixed_asrs", "lease_horizon_years 5 < min 10"], ["cube_storage", "lease_horizon_years 5 < min 7"]]));
  check("worked example: site point (55.2, 59.5)", r.site_point.F === 55.2 && r.site_point.E === 59.5, JSON.stringify(r.site_point));
  check("worked example: drivers lead with lease 0.83, demand CV 0.50, SKU churn 0.43",
    JSON.stringify(r.drivers.slice(0, 3)) === JSON.stringify([{ input: "lease_horizon_years", normalized: 0.83, weight: 0.25 }, { input: "demand_cv_weekly", normalized: 0.5, weight: 0.25 }, { input: "annual_sku_churn", normalized: 0.43, weight: 0.2 }]));
  check("worked example: at F_target − 10 the pick becomes climbing robots", fr.recommend(site0, cat, { shift: cat.config.shift }) && Math.abs(byId("climbing_robots").F - (r.F_target - 10)) < Math.abs(byId("shelf_to_person").F - (r.F_target - 10)));
  check("the result is dated with the catalogue version", r.version === "2026-11-25");
}

// ---------------------------------------------------------------- random sites
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
function randomSite() {
  return {
    demand_cv_weekly: +(rnd() * 0.8).toFixed(3), annual_sku_churn: +(rnd() * 0.6).toFixed(3),
    lease_horizon_years: 1 + Math.floor(rnd() * 20), peak_to_average_ratio: +(1 + rnd() * 3).toFixed(2),
    growth_uncertainty: pick(["low", "medium", "high"]), share_skus_outside_container: +(rnd() * 0.3).toFixed(3),
    flat_floor: rnd() < 0.8, rent_eur_per_m2_year: Math.round(30 + rnd() * 220), labour_cost_eur_per_hour: Math.round(5 + rnd() * 45),
    order_lines_per_day: Math.round(1000 + rnd() * 140000)
  };
}
const sites = []; for (let i = 0; i < 400; i++) sites.push(randomSite());
sites.push(site0);

// ---------------------------------------------------------------- parity with the spec's Python
{
  const tries = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  let out = null, used = null;
  for (const exe of tries) {
    const p = spawnSync(exe, [path.join(__dirname, "../tools/frontier_reference.py"), CAT_PATH], { input: JSON.stringify(sites), encoding: "utf8" });
    if (p.status === 0 && p.stdout) { out = JSON.parse(p.stdout); used = exe; break; }
  }
  check("the spec's Python reference ran (" + used + ")", !!out);
  if (out) {
    let bad = [];
    sites.forEach((s, i) => {
      const j = fr.recommend(s, cat), py = out[i];
      const same = near(j.exact.F_required, py.exact.F_required, 1e-9) && near(j.exact.efficiency_pressure, py.exact.efficiency_pressure, 1e-12) && near(j.exact.F_target, py.exact.F_target, 1e-9)
        && j.recommended === py.recommended && j.runner_up === py.runner_up && j.boundary_case === py.boundary_case
        && j.site_point.E === py.site_point.E && j.site_point.F === py.site_point.F
        && JSON.stringify(j.excluded.map((e) => e.id)) === JSON.stringify(py.excluded.map((e) => e.id))
        && JSON.stringify(j.drivers) === JSON.stringify(py.drivers);
      if (!same) bad.push(i);
    });
    check("JavaScript port = the spec's Python on " + sites.length + " sites (scores, pick, runner-up, boundary, exclusions, site point, drivers)", bad.length === 0, bad.slice(0, 5).join(", "));
    const recs = new Set(out.map((o) => o.recommended));
    check("the random sites reach most of the archetypes (" + [...recs].join(", ") + ")", recs.size >= 5);
  }
}

// ---------------------------------------------------------------- behaviour
{
  let ok = true, feasibleOK = true, bounded = true, onFrontier = true;
  sites.forEach((s) => {
    const r = fr.recommend(s, cat);
    feasibleOK = feasibleOK && !r.excluded.some((e) => e.id === r.recommended || e.id === r.runner_up);
    bounded = bounded && r.F_target >= 0 && r.F_target <= 100;
    onFrontier = onFrontier && near(r.site_point.E, Math.round(fr.frontierE(cat.archetypes, r.exact.F_target) * 10) / 10, 1e-9);
    // more volatility, churn, peak or a shorter lease never asks for less flexibility; more rent, pay or volume never moves the target right
    [["demand_cv_weekly", 0.05], ["annual_sku_churn", 0.05], ["peak_to_average_ratio", 0.2], ["lease_horizon_years", -1]].forEach(([k, d]) => {
      const s2 = Object.assign({}, s); s2[k] = Math.max(k === "lease_horizon_years" ? 1 : 0, s[k] + d);
      if (k === "annual_sku_churn") s2[k] = Math.min(1, s2[k]);
      const r2 = fr.recommend(s2, cat); if (r2.exact.F_required < r.exact.F_required - 1e-12) ok = false;
    });
    [["rent_eur_per_m2_year", 10], ["labour_cost_eur_per_hour", 2], ["order_lines_per_day", 5000]].forEach(([k, d]) => {
      const s2 = Object.assign({}, s); s2[k] = s[k] + d;
      const r2 = fr.recommend(s2, cat); if (r2.exact.F_target > r.exact.F_target + 1e-12) ok = false;
    });
  });
  check("never recommends an excluded technology", feasibleOK);
  check("F_target stays within 0–100", bounded);
  check("the site point sits on the frontier", onFrontier);
  check("more volatility asks for more flexibility; more cost pressure moves the target towards efficiency", ok);
  const noShift = fr.recommend(site0, cat, { shift: 0 });
  check("settings can be overridden (shift 0 → target = required)", noShift.F_target === noShift.F_required);
  const bumpy = fr.recommend(Object.assign({}, site0, { flat_floor: false }), cat);
  check("no flat floor: shelf-to-person excluded, with the reason", bumpy.excluded.some((e) => e.id === "shelf_to_person" && e.reasons[0].code === "floor") && bumpy.recommended !== "shelf_to_person");
  const two = fr.exclusions(byId("fixed_asrs"), Object.assign({}, site0, { share_skus_outside_container: 0.3 }));
  check("every failing constraint is recorded", two.length === 2 && two[0].code === "lease" && two[1].code === "container");
  const only = Object.assign({}, cat, { archetypes: [byId("fixed_asrs")] });
  check("nothing feasible is reported, not thrown", fr.recommend(site0, only).ok === false);
}

// ---------------------------------------------------------------- inputs
{
  check("the worked example is valid", fr.validate(site0).length === 0);
  const bad = Object.assign({}, site0, { annual_sku_churn: 1.5, lease_horizon_years: 0, growth_uncertainty: "huge", flat_floor: "yes", rent_eur_per_m2_year: -3, peak_to_average_ratio: 0.5, order_lines_per_day: NaN });
  const p = fr.validate(bad).map((x) => x.input).sort().join(",");
  check("bad inputs are named", p === "annual_sku_churn,flat_floor,growth_uncertainty,lease_horizon_years,order_lines_per_day,peak_to_average_ratio,rent_eur_per_m2_year", p);
  check("an invalid site gets problems, not a recommendation", fr.recommend(bad, cat).ok === false);
}

// ---------------------------------------------------------------- compensated summation (as Python 3.12+ sum())
{
  check("fsum: ten 0.1s make exactly 1 (plain adding gives 0.9999999999999999)", fr.fsum(Array(10).fill(0.1)) === 1 && Array(10).fill(0.1).reduce((a, b) => a + b, 0) !== 1);
  check("fsum: 1e16 + 1 − 1e16 = 1", fr.fsum([1e16, 1, -1e16]) === 1);
}

// ---------------------------------------------------------------- the catalogue
{
  check("six archetypes", cat.archetypes.length === 6);
  const byF = cat.archetypes.slice().sort((a, b) => a.F - b.F);
  check("the frontier slopes down: more flexibility, less efficiency", byF.every((a, i) => i === 0 || a.E < byF[i - 1].E));
  const top3 = (k) => cat.archetypes.slice().sort((a, b) => b.sub_scores[k] - a.sub_scores[k]).slice(0, 3).map((a) => a.id).sort().join(",");
  check("mix flexibility favours shelf-to-person, collaborative AMRs and manual (spec)", top3("mix_flex") === "collaborative_amr,manual,shelf_to_person", top3("mix_flex"));
  check("exit flexibility favours collaborative AMRs, manual and shelf-to-person (spec)", top3("exit_flex") === "collaborative_amr,manual,shelf_to_person", top3("exit_flex"));
  check("volume flexibility favours the robot-based systems and manual (spec)", ["climbing_robots", "shelf_to_person", "collaborative_amr", "manual"].every((id) => byId(id).sub_scores.volume_flex >= 60) && byId("fixed_asrs").sub_scores.volume_flex < byId("cube_storage").sub_scores.volume_flex);
  check("each archetype's sub-scores average within 10 of its F", cat.archetypes.every((a) => Math.abs((a.sub_scores.volume_flex + a.sub_scores.mix_flex + a.sub_scores.exit_flex) / 3 - a.F) <= 10));
  check("constraints as in the spec", JSON.stringify(cat.archetypes.map((a) => [a.id, a.constraints.max_share_skus_outside_container, a.constraints.min_lease_years, a.constraints.requires_flat_floor])) ===
    JSON.stringify([["fixed_asrs", 0.1, 10, false], ["cube_storage", 0.15, 7, false], ["climbing_robots", 0.2, 5, false], ["shelf_to_person", 1, 3, true], ["collaborative_amr", 1, 0, false], ["manual", 1, 0, false]]));
  check("the two archetypes this app simulates are linked to their layouts", byId("shelf_to_person").simulated_as === "A" && byId("manual").simulated_as === "C");
}

summary("frontier");
