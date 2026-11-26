// Cost of ownership, and share links — run with:  node warehouse-compare/tests/cost.test.js
const path = require("path");
const fs = require("fs");
const cost = require("../src/cost.js");
const calc = require("../../warehouse-model/web/src/calculations.js");
const scenario = require("../src/scenario.js");
const { check, near, summary } = require("./harness.js");

const J = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/scenario.json"), "utf8"));
const WM = JSON.parse(fs.readFileSync(path.join(__dirname, "../../warehouse-model/data/parameters.json"), "utf8"));
const inputs = scenario.resolve(J, WM), sc = inputs.sc;

// ---------------------------------------------------------------- by hand
{
  const s = Object.assign({}, sc, { building_cost_per_sqm: 500, shelving_cost_per_location: 20, pod_cost: 1000, robot_cost: 20000, robot_running_cost_per_year: 1000,
    gtp_station_cost: 30000, pack_station_cost: 5000, labour_cost_per_hour: 30, operating_days_per_year: 250, discount_rate: 0, lines_per_day: 10000, picker_efficiency: 0.8 });
  // at 0% the annual capital cost is cost / life
  const k = { footprint: 1000, locations: 7000, timePerLine: 36, robotsNeeded: 10 };
  const c = cost.compute("C", k, s, { stations: 4, pods: 0 });
  check("C build cost = 1000 m² × 500 + 7000 × 20 + 4 × 5000", c.capex === 500000 + 140000 + 20000, c.capex);
  check("C annual capital at 0% = Σ cost / life", near(c.parts.annualCapital, 500000 / 30 + 140000 / 20 + 20000 / 10, 1e-6));
  // 10,000 lines × 36 s / 3600 / 0.8 = 125 paid hours a day × 250 × $30
  check("C paid picker-hours = lines × time ÷ efficiency (125 h/day)", near(c.parts.pickerHours, 125, 1e-9));
  check("C pay = 125 × 250 × 30", near(c.parts.labour, 125 * 250 * 30, 1e-6));
  check("C has no robots", c.parts.robots === 0 && c.parts.running === 0);
  check("C cost per 1,000 lines = annual ÷ 2,500 thousand lines", near(c.costPer1000Lines, c.annualCost / 2500, 1e-9));
  const a = cost.compute("A", k, s, { stations: 6, pods: 440 });
  check("A build cost adds pods, goods-to-person stations and robots", a.capex === 500000 + 440 * 1000 + 6 * 30000 + 10 * 20000, a.capex);
  check("A running cost = robots × upkeep", a.parts.running === 10000);
  check("A annual capital at 0% includes robots over 8 years", near(a.parts.annualCapital, 500000 / 30 + 440000 / 20 + 180000 / 10 + 200000 / 8, 1e-6));
  check("the capital recovery factor is the Warehouse Model's", near(cost.compute("C", k, Object.assign({}, s, { discount_rate: 7 }), { stations: 4, pods: 0 }).parts.annualCapital,
    500000 * calc.crf(7, 30) + 140000 * calc.crf(7, 20) + 20000 * calc.crf(7, 10), 1e-6));
}

// ---------------------------------------------------------------- in the comparison
{
  const r = scenario.run(inputs);
  ["A", "B", "C"].forEach((id) => {
    check(id + ": cost KPIs reported", ["capex", "annualCost", "costPer1000Lines"].every((k) => isFinite(r[id].kpi[k]) && r[id].kpi[k] > 0));
    check(id + ": cost steps in the trace", r[id].trace.some((t) => t.label === "Total cost of ownership"));
  });
  check("only WH-A pays for robots", r.A.cost.parts.robots > 0 && r.B.cost.parts.robots === 0 && r.C.cost.parts.robots === 0);
  check("WH-A needs fewer paid picker-hours than WH-C", r.A.cost.parts.pickerHours < r.C.cost.parts.pickerHours);
  const dear = Object.assign({}, inputs, { sc: Object.assign({}, sc, { labour_cost_per_hour: sc.labour_cost_per_hour * 2 }) });
  const r2 = scenario.run(dear);
  check("doubling pay raises every layout's cost by exactly its pay", ["A", "B", "C"].every((id) => near(r2[id].kpi.annualCost - r[id].kpi.annualCost, r[id].cost.parts.labour, 1e-6)));
  console.log("  per 1,000 lines: A $" + r.A.kpi.costPer1000Lines.toFixed(0) + ", B $" + r.B.kpi.costPer1000Lines.toFixed(0) + ", C $" + r.C.kpi.costPer1000Lines.toFixed(0));
}

// ---------------------------------------------------------------- share links
{
  const share = require("../src/share.js");
  const fresh = () => scenario.resolve(J, WM), defaults = fresh();
  check("nothing changed, nothing in the link", share.encode(fresh(), defaults) === "");
  const a = fresh();
  a.sc.demand_skew = 90; a.sc.slotting = "abc"; a.layouts.A.put_away = "nearest"; a.layouts.B.arrangement = "concentric"; a.layouts.B.hub_radius = 8.5;
  const link = share.encode(a, defaults), b = fresh(), n = share.decode("#" + link, b, J);
  check("a link carries exactly the changed values (" + n + ")", n === 5);
  check("…and reopens the same inputs", JSON.stringify(a) === JSON.stringify(b));
  check("the link is URL-safe", /^s=[A-Za-z0-9_-]+$/.test(link));
  const enc = (o) => "#s=" + Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const c = fresh();
  const got = share.decode(enc({ sc: { demand_skew: 1e9, slotting: "nonsense", skus: "6000", __proto__x: 1, not_an_input: 3 }, A: { put_away: "teleport", pod_width: -5 }, C: { rack_type: "xyz" }, Z: { a: 1 } }), c, J);
  check("out-of-range numbers are clamped to the input's range", c.sc.demand_skew === J.shared.demand_skew.maximum && c.layouts.A.pod_width === J.layouts.A.pod_width.minimum);
  check("unknown choices, wrong types, unknown keys and WH-C are ignored", c.sc.slotting === defaults.sc.slotting && c.sc.skus === defaults.sc.skus && c.layouts.A.put_away === defaults.layouts.A.put_away && c.layouts.C.rack_type === defaults.layouts.C.rack_type && !("not_an_input" in c.sc) && got === 2);
  const e = fresh();
  share.decode(enc({ B: { bay_width: 500, rack_depth: 0.6 } }), e, J);
  check("WH-B's inherited rack sizes can't be set by a link", e.layouts.B.bay_width === defaults.layouts.B.bay_width);
  // the technology screen's site travels in the link too (group S), checked against data/archetypes.json
  const CAT = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/archetypes.json"), "utf8"));
  const withSite = () => { const i = fresh(); i.site = Object.assign({}, CAT.example_site); delete i.site.site_name; return i; };
  const sd = withSite(), sa = withSite(); sa.site.lease_horizon_years = 12; sa.site.flat_floor = false; sa.site.growth_uncertainty = "high";
  const sl = share.encode(sa, sd), sb = withSite(), sn = share.decode("#" + sl, sb, J, CAT.site_inputs);
  check("a link carries the technology screen's site, yes/no floor included (" + sn + ")", sn === 3 && JSON.stringify(sa.site) === JSON.stringify(sb.site));
  const sx = withSite();
  share.decode(enc({ S: { lease_horizon_years: 999, growth_uncertainty: "extreme", flat_floor: "no", rent_eur_per_m2_year: 1 } }), sx, J, CAT.site_inputs);
  check("site values from a link are clamped and checked like the rest", sx.site.lease_horizon_years === CAT.site_inputs.lease_horizon_years.maximum && sx.site.growth_uncertainty === "medium" && sx.site.flat_floor === true && sx.site.rent_eur_per_m2_year === CAT.site_inputs.rent_eur_per_m2_year.minimum);
  check("a broken link applies nothing", share.decode("#s=!!!", fresh(), J) === 0 && share.decode("#s=bm90IGpzb24", fresh(), J) === 0 && share.decode("", fresh(), J) === 0);
}

summary("cost");
