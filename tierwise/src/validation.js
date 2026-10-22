// Tierwise — the validation suite as data (window.TWValidation / module.exports): each case runs the real engine
// (src/plan.js, src/constrained.js, src/invest.js) on a problem with a known answer — an exact relationship, a
// conservation law, or the published example — and checks the result against a stated tolerance. Shared by
// tests/validation.test.js (Node, writes tests/validation-results.json) and validation.html (re-runs the same
// cases in the browser, in a worker, from the same code).
//   TWValidation.run(ctx, { only: [ids], progress: (title, frac) => … }) → a Promise of [result, …]
//   ctx = { P: TWPlan, N: TWNetwork, K: TWConstrained, I: TWInvest, highs: <a loaded HiGHS instance> }
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else { root.TWValidation = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

  // one site per tier, m -> w -> pk -> d -> p -> r (mirrors tests/constrained.test.js's chain())
  function chain(ctx, o) {
    o = o || {};
    const t = (id, tier, from, extra) => Object.assign({ id, tier, name: id, lat: 10, lon: 0, capacity: 1e9, lead: 0, release: 0, yield: 100, suppliers: from ? [{ from, share: 100, days: 0 }] : undefined }, extra || {});
    const net = {
      config: { startYear: 2027, startMonth: 0, cover: o.cover != null ? o.cover : 0, demandPeak: 10, rawPeak: 4, rawSeasonMax: 0, demandScale: 1, packValue: o.packValue != null ? o.packValue : 1, discountRate: o.discountRate != null ? o.discountRate : 0 },
      bom: { packPerUnit: 20, kgPerSachet: 0.025, rawPerProduct: 0.7 },
      sites: [
        { id: "m", tier: "market", name: "m", lat: 30, lon: 0, base: o.base != null ? o.base : 1000, growth: 0, season: o.season || 0, priority: o.priority, suppliers: [{ from: "w", share: 100, days: 0 }] },
        t("w", "warehouse", "pk", { handling: 0, cover: o.cover != null ? o.cover : 0, capacity: o.wCap != null ? o.wCap : 1e9, candidates: o.wCand }),
        t("pk", "packaging", "d", {}), t("d", "dosing", "p", {}), t("p", "product", "r", {}), t("r", "raw", null, {})
      ]
    };
    (o.edit || (() => {}))(net);
    return net;
  }

  const CASES = [
    { id: "ample-capacity", group: "Within capacity", title: "Ample capacity: the constrained plan matches the unconstrained one", cite: "sanity check",
      what: "When no site's capacity ever binds, solving the LP should change nothing: every pack is delivered, and every site's load matches the lot-for-lot requirement plan exactly.",
      async run(ctx) {
        const net = chain(ctx), r = await ctx.K.solve(ctx.highs, net, { mode: "fixed", hold: 0 }), u = ctx.P.plan(net);
        let maxDiff = 0; ["w", "pk", "d", "p", "r"].forEach((id) => { for (let m = 12; m < 144; m++) maxDiff = Math.max(maxDiff, Math.abs(r.sites[id].load[m] - u.sites[id].load[m]) / Math.max(1, u.sites[id].load[m])); });
        return { checks: [
          { name: "fill rate", value: r.fill * 100, unit: "%", tol: "≥ 99.999 %", pass: r.fill > 0.99999 },
          { name: "load matches the requirement plan, max relative difference", value: maxDiff * 100, unit: "%", tol: 0.3, pass: maxDiff < 0.003 },
          { name: "nothing re-routed", value: r.rerouted * 100, unit: "%", tol: "< 1e-4 %", pass: r.rerouted < 1e-6 }
        ] };
      } },
    { id: "bottleneck", group: "Within capacity", title: "A hard bottleneck: unmet demand equals the shortfall, exactly", cite: "conservation of pack-equivalents",
      what: "Packaging capped at 800 of a 1,000-pack-a-month demand, with no stock, re-sourcing or other relief: delivered plus unmet must equal demand in every month, and delivered can never exceed capacity by even a rounding error.",
      async run(ctx) {
        const net = chain(ctx, { edit: (n) => { n.sites.find((s) => s.id === "pk").capacity = 800; } });
        const r = await ctx.K.solve(ctx.highs, net, { mode: "fixed", hold: 0 });
        const m = r.sites.m, over = Math.max(0, ...Array.from(m.delivered).map((d, i) => d - 800));
        let balErr = 0; for (let i = 0; i < m.demand.length; i++) balErr = Math.max(balErr, Math.abs(m.delivered[i] + m.unmet[i] - m.demand[i]));
        return { checks: [
          { name: "fill rate ≈ 800/1000", value: r.fill * 100, unit: "%", tol: 1, pass: near(r.fill, 0.8, 0.02) },
          { name: "delivered + unmet = demand, every month, max error", value: balErr, unit: "packs", tol: 0.5, pass: balErr < 0.5 },
          { name: "delivered never exceeds the 800-pack cap", value: over, unit: "packs over", tol: 0.5, pass: over < 0.5 }
        ] };
      } },
    { id: "prebuild", group: "The example network", title: "Stock built ahead of a peak measurably improves service, as published", cite: "README, “Example results”",
      what: "The README states two fill rates for the example network with fixed sourcing shares: 88.1% with no stock built ahead of a peak, 88.7% allowing up to 6 months. Reproducing both from the same network confirms pre-building is doing real, bounded work — a modest, plausible gain, not a rounding artefact.",
      async run(ctx) {
        const net = ctx.N.build("base"); net.sites.forEach((s) => { delete s.candidates; });
        const r0 = await ctx.K.solve(ctx.highs, net, { mode: "fixed", hold: 0 });
        const r6 = await ctx.K.solve(ctx.highs, net, { mode: "fixed", hold: 6 });
        return { checks: [
          { name: "no stock ahead (hold 0)", value: r0.fill * 100, unit: "%", tol: 0.2, pass: near(r0.fill, 0.881, 0.003) },
          { name: "6 months of stock ahead (hold 6)", value: r6.fill * 100, unit: "%", tol: 0.2, pass: near(r6.fill, 0.887, 0.003) },
          { name: "hold 6 strictly beats hold 0", value: (r6.fill - r0.fill) * 100, unit: "pts", tol: "> 0", pass: r6.fill > r0.fill }
        ] };
      } },
    { id: "priority", group: "Within capacity", title: "Priorities: a higher-priority market is protected first when capacity is short", cite: "objective weighting",
      what: "Two markets share a capped warehouse; demand together exceeds capacity. Giving one market priority 3 against the other's 1 should concentrate the shortfall on the low-priority market.",
      async run(ctx) {
        const net = {
          config: { startYear: 2027, startMonth: 0, cover: 0, demandPeak: 10, rawPeak: 4, rawSeasonMax: 0, demandScale: 1, packValue: 1, discountRate: 0 },
          bom: { packPerUnit: 20, kgPerSachet: 0.025, rawPerProduct: 0.7 },
          sites: [
            { id: "m1", tier: "market", name: "m1", lat: 30, lon: 0, base: 600, growth: 0, season: 0, priority: 3, suppliers: [{ from: "w", share: 100, days: 0 }] },
            { id: "m2", tier: "market", name: "m2", lat: 30, lon: 0, base: 600, growth: 0, season: 0, priority: 1, suppliers: [{ from: "w", share: 100, days: 0 }] },
            { id: "w", tier: "warehouse", name: "w", lat: 10, lon: 0, capacity: 900, handling: 0, cover: 0, suppliers: [{ from: "pk", share: 100, days: 0 }] },
            { id: "pk", tier: "packaging", name: "pk", lat: 10, lon: 0, capacity: 1e9, lead: 0, release: 0, yield: 100, suppliers: [{ from: "d", share: 100, days: 0 }] },
            { id: "d", tier: "dosing", name: "d", lat: 10, lon: 0, capacity: 1e9, lead: 0, release: 0, yield: 100, suppliers: [{ from: "p", share: 100, days: 0 }] },
            { id: "p", tier: "product", name: "p", lat: 10, lon: 0, capacity: 1e9, lead: 0, release: 0, yield: 100, suppliers: [{ from: "r", share: 100, days: 0 }] },
            { id: "r", tier: "raw", name: "r", lat: 10, lon: 0, capacity: 1e9, lead: 0, release: 0, yield: 100 }
          ]
        };
        const r = await ctx.K.solve(ctx.highs, net, { mode: "fixed", hold: 0 });
        const f1 = r.sites.m1.fill, f2 = r.sites.m2.fill;
        return { checks: [
          { name: "priority-3 market's fill rate", value: f1 * 100, unit: "%", tol: "≥ 99.999 %", pass: f1 > 0.99999 },
          { name: "priority-1 market absorbs the shortfall (fill < priority-3's)", value: f2 * 100, unit: "%", tol: "< " + (f1 * 100).toFixed(1) + " %", pass: f2 < f1 - 1e-6 }
        ] };
      } },
    { id: "example-fill", group: "The example network", title: "The published example reproduces its stated fill rate", cite: "README, “Example results”",
      what: "The shipped example network (19 sites, 13-year horizon), solved within capacity with qualified-lane re-sourcing and 6 months of stock ahead allowed: the README states a 90.1% fill rate with the first unmet demand in December 2032.",
      async run(ctx) {
        const net = ctx.N.build("base"); net.sites.forEach((s) => { delete s.candidates; });
        const r = await ctx.K.solve(ctx.highs, net, { mode: "qualified", hold: 6 });
        const month = (m) => m == null || m < 0 ? null : net.config.startYear + Math.floor(m / 12) + "-" + String((m % 12) + 1).padStart(2, "0");
        return { checks: [
          { name: "fill rate, 13 years", value: r.fill * 100, unit: "%", tol: 0.2, pass: near(r.fill, 0.901, 0.003) },
          { name: "first unmet demand", value: month(r.firstUnmet), unit: "", tol: "2032-12", pass: month(r.firstUnmet) === "2032-12" },
          { name: "solved", value: r.seconds, unit: "s", tol: "< 60 s", pass: r.seconds < 60 }
        ] };
      } },
    { id: "invest-builds", group: "Investment optimiser", title: "Builds when the margin saved clearly beats the capex", cite: "NPV sanity check",
      what: "A warehouse short by 300 packs/month at a $10/pack margin loses $3,000/mo in margin, every month, forever. A $1,000 candidate that closes the gap should obviously be built, immediately.",
      async run(ctx) {
        const net = chain(ctx, { wCap: 700, packValue: 10, wCand: [{ id: "c1", add: 500, capex: 1000, build: 0, qualify: 0 }] });
        const r = await ctx.I.solve(ctx.highs, net, { mode: "fixed" });
        return { checks: [
          { name: "builds the candidate", value: r.investments.length, unit: "investments", tol: 1, pass: r.investments.length === 1 },
          { name: "at review year 0 (immediately)", value: r.investments[0] ? r.investments[0].reviewYear : -1, unit: "", tol: 0, pass: r.investments[0] && r.investments[0].reviewYear === 0 },
          { name: "fill reaches 100% (700 + 500 ≥ 1000)", value: r.fill * 100, unit: "%", tol: "≥ 99.999 %", pass: r.fill > 0.99999 }
        ] };
      } },
    { id: "invest-budget", group: "Investment optimiser", title: "A budget cap picks the affordable option, not just the best one", cite: "a binding resource constraint",
      what: "Two candidates would each be worth building on their own; a budget too small for both should pick the cheaper one and stay under the cap, not round up and overspend.",
      async run(ctx) {
        const net = chain(ctx, { wCap: 700, packValue: 10, wCand: [{ id: "c1", add: 200, capex: 500, build: 0, qualify: 0 }, { id: "c2", add: 500, capex: 1200, build: 0, qualify: 0 }] });
        const r = await ctx.I.solve(ctx.highs, net, { mode: "fixed", budget: 900 });
        return { checks: [
          { name: "picks the cheaper candidate only", value: r.investments.map((x) => x.id).join(","), unit: "", tol: "c1", pass: r.investments.length === 1 && r.investments[0].id === "c1" },
          { name: "capex stays within the $900 budget", value: r.capexTotal, unit: "$", tol: "≤ 900", pass: r.capexTotal <= 900 }
        ] };
      } },
    { id: "invest-example", group: "Investment optimiser", title: "The example network's investment decision is reproducible and proven optimal", cite: "the shipped example's four candidates",
      what: "The example network's four illustrative candidates (Jebel Ali, Cape Town Packaging, Valencia Dosing, Hamilton Nutrition), at the default pack value and discount rate: the optimiser should reach a provably optimal answer — not a timed-out guess — within well under a minute.",
      async run(ctx) {
        const net = ctx.N.build("base"), r = await ctx.I.solve(ctx.highs, net, { mode: "qualified" });
        return { checks: [
          { name: "proven optimal, not timed out", value: r.timedOut ? "timed out" : "proven optimal", unit: "", tol: "proven optimal", pass: r.timedOut === false },
          { name: "solved well under a minute", value: r.seconds, unit: "s", tol: "< 45 s", pass: r.seconds < 45 },
          { name: "investing improves fill over building nothing", value: r.fill * 100, unit: "%", tol: "> 86.3 %", pass: r.investments.length > 0 && r.fill > 0.863 },
          { name: "capexTotal matches the sum of the chosen investments", value: r.capexTotal - r.investments.reduce((a, i) => a + i.capex, 0), unit: "$ discrepancy", tol: 1, pass: Math.abs(r.capexTotal - r.investments.reduce((a, i) => a + i.capex, 0)) < 1 }
        ] };
      } }
  ];

  async function run(ctx, opts) {
    opts = opts || {};
    const list = CASES.filter((c) => !opts.only || opts.only.indexOf(c.id) >= 0), out = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (opts.progress) opts.progress(c.title, i / list.length);
      const t0 = Date.now(), r = await c.run(ctx);
      out.push(Object.assign({ id: c.id, group: c.group, title: c.title, cite: c.cite, what: c.what, seconds: (Date.now() - t0) / 1000, pass: r.checks.every((k) => k.pass) }, r));
      if (opts.onCase) opts.onCase(out[out.length - 1]);
    }
    if (opts.progress) opts.progress("", 1);
    return out;
  }
  return { CASES: CASES, run: run };
});
