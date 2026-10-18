// Tierwise — the capacity investment optimiser (src/invest.js), solved with HiGHS: known-answer cases on small
// chains (build when it pays, skip when it does not, budget picks the cheaper option, timing with a lead time,
// discounting, a CMO-tier candidate, a clean error with no pack value) and a sanity check on the example network.
const N = require("../src/network.js"), K = require("../src/invest.js");
let loadHighs; try { loadHighs = require("highs"); } catch (e) { console.log("HiGHS is not installed: npm install highs@1.15.3 (in tierwise/)"); process.exit(1); }
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); } if (process.env.VERBOSE && cond) console.log("ok   " + name); }
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// one site per tier, m -> w -> pk -> d -> p -> r (mirrors tests/constrained.test.js's chain())
function chain(o) {
  o = o || {};
  const t = (id, tier, from, extra) => Object.assign({ id, tier, name: id, lat: 10, lon: 0, capacity: 1e9, lead: 0, release: 0, yield: 100, suppliers: from ? [{ from, share: 100, days: 0 }] : undefined }, extra || {});
  const net = {
    config: { startYear: 2027, startMonth: 0, cover: 0, demandPeak: 10, rawPeak: 4, rawSeasonMax: 0, demandScale: 1, packValue: o.packValue != null ? o.packValue : 1, discountRate: o.discountRate != null ? o.discountRate : 0 },
    bom: { packPerUnit: 20, kgPerSachet: 0.025, rawPerProduct: 0.7 },
    sites: [
      { id: "m", tier: "market", name: "m", lat: 30, lon: 0, base: 1000, growth: 0, season: 0, suppliers: [{ from: "w", share: 100, days: 0 }] },
      t("w", "warehouse", "pk", { handling: 0, cover: 0, capacity: o.wCap != null ? o.wCap : 1e9, candidates: o.wCand }),
      t("pk", "packaging", "d", {}), t("d", "dosing", "p", {}), t("p", "product", "r", {}), t("r", "raw", null, {})
    ]
  };
  (o.edit || (() => {}))(net);
  return net;
}

(async () => {
  const highs = await loadHighs({ print: () => {}, printErr: () => {} });
  const solve = (net, opt) => K.solve(highs, net, opt);

  // ---- builds when the margin saved clearly beats the capex
  {
    const net = chain({ wCap: 700, packValue: 10, wCand: [{ id: "c1", add: 500, capex: 1000, build: 0, qualify: 0 }] });
    const r = solve(net, { mode: "fixed" });
    check("builds: solves", r.ok, r.errors);
    check("builds: chooses the candidate", r.investments.length === 1 && r.investments[0].id === "c1", r.investments);
    check("builds: at review year 0", r.investments[0] && r.investments[0].reviewYear === 0, r.investments);
    check("builds: fill reaches 1 (700+500 >= 1000)", near(r.fill, 1, 1e-6), r.fill);
  }

  // ---- skips when the capex is absurd
  {
    const net = chain({ wCap: 700, packValue: 10, wCand: [{ id: "c1", add: 500, capex: 1e9, build: 0, qualify: 0 }] });
    const r = solve(net, { mode: "fixed" });
    check("skips: no investment", r.investments.length === 0, r.investments);
    check("skips: fill matches the uninvested baseline (700/1000)", near(r.fill, 0.7, 1e-6), r.fill);
  }

  // ---- a budget picks the affordable option over the pricier one
  {
    const net = chain({ wCap: 700, packValue: 10, wCand: [
      { id: "c1", add: 200, capex: 500, build: 0, qualify: 0 },
      { id: "c2", add: 500, capex: 1200, build: 0, qualify: 0 }
    ] });
    const r = solve(net, { mode: "fixed", budget: 900 });
    check("budget: picks the cheaper candidate", r.investments.length === 1 && r.investments[0].id === "c1", r.investments);
    check("budget: respects the cap", r.capexTotal <= 900, r.capexTotal);
    check("budget: fill improves to 0.9 (700+200 of 1000)", near(r.fill, 0.9, 1e-6), r.fill);
  }

  // ---- a build+qualify lead time of 14 months becomes available 2 years after the review point
  {
    const net = chain({ wCap: 700, packValue: 10, wCand: [{ id: "c1", add: 500, capex: 1000, build: 10, qualify: 4 }] });
    const r = solve(net, { mode: "fixed" });
    check("lead time: availYear = reviewYear + ceil(14/12) = 2", r.investments[0] && r.investments[0].availYear === r.investments[0].reviewYear + 2, r.investments);
  }

  // ---- no pack value: a clean error, not a silent wrong answer
  {
    const net = chain({ wCap: 700, packValue: 0, wCand: [{ id: "c1", add: 500, capex: 1000, build: 0, qualify: 0 }] });
    const r = solve(net, { mode: "fixed" });
    check("no pack value: a clean error", r.ok === false && /pack value/.test(r.errors[0]), r.errors);
  }

  // ---- a candidate at a CMO tier (the Pv-style capacity row, not the warehouse's outbound-lane row)
  {
    const net = chain({ wCap: 1e9, packValue: 10, edit: (n) => { n.sites.find((s) => s.id === "pk").capacity = 700; n.sites.find((s) => s.id === "pk").candidates = [{ id: "c1", add: 500, capex: 1000, build: 0, qualify: 0 }]; } });
    const r = solve(net, { mode: "fixed" });
    check("CMO candidate: builds and reaches full fill", r.investments.length === 1 && near(r.fill, 1, 1e-6), [r.investments, r.fill]);
  }

  // ---- discounting: a higher rate lowers a later review year's present-value cost
  {
    const net = chain({ wCap: 700, packValue: 10, discountRate: 50, wCand: [{ id: "c1", add: 500, capex: 1000, build: 0, qualify: 0 }] });
    const r = solve(net, { mode: "fixed" });
    check("discounting: builds immediately when there is no reason to wait", r.investments.length === 1 && r.investments[0].reviewYear === 0, r.investments);
    check("discounting: capexPV equals nominal capex at year 0", near(r.investments[0].capexPV, 1000, 1e-9), r.investments[0]);
  }

  // ---- backward compatibility: a network with no candidates anywhere still solves (nothing to invest in)
  {
    const net = chain({ wCap: 700, packValue: 10 });
    const r = solve(net, { mode: "fixed" });
    check("no candidates: solves with an empty investment list", r.ok && r.investments.length === 0, r);
  }

  // ---- the example network: a real, non-trivial, provably optimal portfolio decision
  {
    const net = N.build("base");
    const r = solve(net, { mode: "qualified" });
    check("example network: solves", r.ok, r.errors);
    check("example network: proven optimal, not timed out", r.timedOut === false, r.timedOut);
    check("example network: solves in well under a minute", r.seconds < 30, r.seconds);
    check("example network: investing improves fill over the uninvested baseline", r.investments.length > 0 && r.fill > 0.863, [r.investments.length, r.fill]);
    check("example network: capexTotal matches the sum of the chosen investments", near(r.capexTotal, r.investments.reduce((a, i) => a + i.capex, 0), 1e-9), r.capexTotal);
    r.investments.forEach((inv) => {
      const site = net.sites.find((s) => s.id === inv.site), cand = site && (site.candidates || []).find((c) => c.id === inv.id);
      check("example network: " + inv.site + "/" + inv.id + " matches a defined candidate", !!cand && cand.add === inv.add && cand.capex === inv.capex, inv);
    });
  }

  console.log(pass + "/" + (pass + fail) + " checks passed");
  if (fail) process.exit(1);
})();
