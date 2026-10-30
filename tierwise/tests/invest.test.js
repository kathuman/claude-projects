// Tierwise — the capacity investment optimiser (src/invest.js), solved with HiGHS: known-answer cases on small
// chains (build when it pays, skip when it does not, budget picks the cheaper option, timing with a lead time and
// prorated availability, discounting of capex and lost margin alike, the terminal value, opex, priority as a
// tie-breaker, the net present value, a CMO-tier candidate, a clean error with no pack value) and a sanity check on
// the example network.
const N = require("../src/network.js"), K = require("../src/invest.js"), C = require("../src/constrained.js");
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

  // ---- a build+qualify lead time of 14 months: ready in month 14 of the review, so the next year already gets 10
  // months of it (2.3.0 rounded up to whole years and made it wait for the year after)
  {
    const net = chain({ wCap: 700, packValue: 10, wCand: [{ id: "c1", add: 500, capex: 1000, build: 10, qualify: 4 }] });
    const r = solve(net, { mode: "fixed" }), x = r.investments[0];
    check("lead time: ready 14 months after the review", x && x.readyMonth === x.reviewYear * 12 + 14, r.investments);
    check("lead time: available within the next year (availYear = reviewYear + 1)", x && x.availYear === x.reviewYear + 1, r.investments);
    check("lead time: that year's capacity is prorated, 700 × 12 + 500 × 10", x && near(r.sites.w.years[x.availYear].capacity, 700 * 12 + 500 * 10, 1e-9), x && r.sites.w.years[x.availYear]);
    check("lead time: and the year after has all twelve months", x && near(r.sites.w.years[x.availYear + 1].capacity, 1200 * 12, 1e-9), x && r.sites.w.years[x.availYear + 1]);
  }

  // ---- discounting the lost margin: demand that only starts in year 11 (month 120), and a candidate that takes five
  // years to build, so its capex is paid five years before any benefit. Benefit 300 packs × 36 months × $10 = $108,000
  // against $50,000 of capex. At 0% it pays; at 50% the capex is worth 50,000 / 1.5^5 = $6,584 and the benefit
  // 36,000 × (1.5^-10 + 1.5^-11 + 1.5^-12) = $1,318, so it does not. (2.3.0 discounted only the capex, and built it.)
  {
    const late = (rate) => chain({ wCap: 700, packValue: 10, discountRate: rate, wCand: [{ id: "c1", add: 500, capex: 50000, build: 54, qualify: 6 }],
      edit: (n) => { n.config.terminalYears = 0; const m = n.sites.find((s) => s.id === "m"); m.launch = 120; m.ramp = 1; } });
    const r0 = solve(late(0), { mode: "fixed" }), r50 = solve(late(50), { mode: "fixed" });
    check("discounting: a late benefit pays at 0%", r0.investments.length === 1, r0.investments);
    check("discounting: and does not at 50%", r50.ok && r50.investments.length === 0, r50.investments);
    check("discounting: the lost margin is discounted (PV of the year-11..13 losses at 50%)", near(r50.lostPV, 36000 * (Math.pow(1.5, -10) + Math.pow(1.5, -11) + Math.pow(1.5, -12)), 1e-6), r50.lostPV);
  }

  // ---- the terminal value: demand from year 12 (month 132), capex $100,000, 0% discount. Within the horizon the
  // benefit is 300 × 24 × $10 = $72,000, so it is not worth it; with five more years like the last, the last year counts
  // six times: 36,000 + 36,000 × 6 = $252,000, so it is
  {
    const tail = (n) => chain({ wCap: 700, packValue: 10, discountRate: 0, wCand: [{ id: "c1", add: 500, capex: 100000, build: 0, qualify: 0 }],
      edit: (net) => { net.config.terminalYears = n; const m = net.sites.find((s) => s.id === "m"); m.launch = 132; m.ramp = 1; } });
    const r0 = solve(tail(0), { mode: "fixed" }), r5 = solve(tail(5), { mode: "fixed" });
    check("terminal value: without it, late capacity is not worth building", r0.ok && r0.investments.length === 0, r0.investments);
    check("terminal value: with five more years, it is", r5.investments.length === 1, r5.investments);
    check("terminal value: the margin recovered counts the last year six times", near(r5.recoveredPV, 36000 + 36000 * 6, 1e-6), r5.recoveredPV);
    check("terminal value: the default is " + K.TERMINAL_YEARS + " years", K.weights({ discountRate: 0 }).terminalYears === 5 && near(K.weights({ discountRate: 0 }).w[12], 6, 1e-12));
    check("terminal value: discounted further at 10% (1 + Σ 1.1^-k, k = 1..5)", near(K.weights({ discountRate: 10, terminalYears: 5 }).w[12], Math.pow(1.1, -12) * (1 + [1, 2, 3, 4, 5].reduce((a, k) => a + Math.pow(1.1, -k), 0)), 1e-12));
  }

  // ---- opex: a fixed cost a year from the month the capacity is ready. The gap is worth 300 × 12 × $10 = $36,000 a
  // year, so $1,000 a year is worth paying and $40,000 a year is not. Ready after 6 months, at 0% and no terminal
  // value, $1,000 a year costs 1,000 × (6/12 + 12) = $12,500 over the horizon. (The $40,000 case is built in no time:
  // ready mid-year, the screening model would let six months of added capacity cover the whole year's shortfall,
  // since it has no months within a year — the limit the monthly verification exists for.)
  {
    const op = (opex, build) => chain({ wCap: 700, packValue: 10, discountRate: 0, wCand: [{ id: "c1", add: 500, capex: 1000, build: build, qualify: 0, opex: opex }], edit: (n) => { n.config.terminalYears = 0; } });
    const r1 = solve(op(1000, 6), { mode: "fixed" }), r40 = solve(op(40000, 0), { mode: "fixed" });
    check("opex: a small running cost still pays", r1.investments.length === 1 && r1.investments[0].reviewYear === 0, r1.investments);
    check("opex: prorated from the month it is ready, 1,000 × 12.5", near(r1.opexPV, 12500, 1e-9), r1.opexPV);
    check("opex: a running cost above the margin it saves is not paid", r40.ok && r40.investments.length === 0, r40.investments);
  }

  // ---- the reported objective is currency: market priority is a tie-breaker, not a multiplier on the margin. Two
  // markets of 1,000 packs a month share a warehouse of 1,500; the priority-3 one is served first, and the lost
  // margin is $10 × 500 × 12 × 13 whatever the priorities
  {
    const net = chain({ wCap: 1500, packValue: 10, discountRate: 0, edit: (n) => {
      n.config.terminalYears = 0;
      n.sites.push({ id: "m2", tier: "market", name: "m2", lat: 30, lon: 1, base: 1000, growth: 0, season: 0, priority: 3, suppliers: [{ from: "w", share: 100, days: 0 }] });
    } });
    const r = solve(net, { mode: "fixed" });
    check("priority: the priority-3 market is served in full", r.ok && near(r.sites.m2.years[5].fill, 1, 1e-6), r.sites && r.sites.m2.years[5]);
    check("priority: the other goes short by the whole gap", r.ok && near(r.sites.m.years[5].fill, 0.5, 1e-6), r.sites && r.sites.m.years[5]);
    check("priority: the lost margin is in plain currency", near(r.lostPV, 10 * 500 * 12 * 13, 1e-9), r.lostPV);
    check("priority: the objective is capex + opex + lost margin", near(r.objective, r.capexPV + r.opexPV + r.lostPV, 1e-12), r.objective);
  }

  // ---- the net present value: the builds case at 0% and no terminal value recovers 300 × 12 × 13 × $10 for $1,000
  {
    const net = chain({ wCap: 700, packValue: 10, discountRate: 0, wCand: [{ id: "c1", add: 500, capex: 1000, build: 0, qualify: 0 }], edit: (n) => { n.config.terminalYears = 0; } });
    const r = solve(net, { mode: "fixed" });
    check("NPV: the baseline is the same model with nothing built", r.baseline && near(r.baseline.fill, 0.7, 1e-6), r.baseline);
    check("NPV: margin recovered = 300 × 12 × 13 × $10", near(r.recoveredPV, 468000, 1e-9), r.recoveredPV);
    check("NPV: = recovered − capex − opex", near(r.npv, 467000, 1e-9), r.npv);
  }

  // ---- a candidate that could only be ready after the horizon is never offered
  {
    const net = chain({ wCap: 700, packValue: 10, wCand: [{ id: "c1", add: 500, capex: 1, build: 200, qualify: 0 }] });
    const r = solve(net, { mode: "fixed" });
    check("beyond the horizon: not chosen, however cheap", r.ok && r.investments.length === 0, r.investments);
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
    check("example network: the baseline is the screening model's 86.3%", r.baseline && Math.abs(r.baseline.fill - 0.863) < 0.0005, r.baseline);
    check("example network: NPV = margin recovered − capex − opex, all present values", near(r.npv, r.recoveredPV - r.capexPV - r.opexPV, 1e-12) && r.npv > 0, [r.npv, r.recoveredPV, r.capexPV]);
    // the README's example result: with the lost margin discounted, the screening model picks Valencia's fourth
    // dosing line and Cape Town's second line (2.3.0 also took Jebel Ali's bay), $6.7M of capex, $4.6M present value
    const pick = r.investments.map((x) => x.site).sort().join(",");
    check("example network: picks Valencia and Cape Town", pick === "d-vlc,pk-cpt", pick);
    check("example network: $6.7M capex, $4.6M present value", r.capexTotal === 6700000 && Math.abs(r.capexPV - 4.6e6) < 0.05e6, [r.capexTotal, r.capexPV]);
    check("example network: ready December 2031 and December 2033", r.investments.map((x) => x.readyMonth).join() === "59,83", r.investments.map((x) => x.readyMonth));
    check("example network: screening fill 86.3% → 89.6%, NPV $16.1M", Math.abs(r.fill - 0.896) < 0.0005 && Math.abs(r.npv - 16.1e6) < 0.05e6, [r.fill, r.npv]);
    // ... and the month-by-month plan disagrees: priced there (qualified lanes, 6 months of stock ahead), the same
    // package recovers almost nothing, because the yearly model cannot see the monthly bottlenecks. Pinned here so the
    // README states it honestly; TWInvest.verify runs this check on every optimiser result; 3.0 is meant to close the gap itself.
    const v = K.verify(highs, net, r, { mode: "qualified", hold: 6 });
    check("example network, monthly plan: fill 86.8% → 89.9% with the package", v.ok && Math.abs(v.fillBefore - 0.868) < 0.0005 && Math.abs(v.fillAfter - 0.899) < 0.0005, v);
    check("example network, monthly plan: recovers $14.0M PV, saves $1.8M of stock, NPV +$11.2M", Math.abs(v.recoveredPV - 14.0e6) < 0.05e6 && Math.abs(v.holdingSavedPV - 1.83e6) < 0.05e6 && Math.abs(v.npv - 11.24e6) < 0.05e6, v);
    check("verification: the monthly plan and the screening model agree in sign once stock has a real cost", v.pays === true && v.agrees === true && v.screeningNpv === r.npv, v);
    check("verification: each monthly solve carries its proof; the yearly model records its own", v.proved === true && v.receipts.length === 2 && r.receipt.model === "yearly" && r.receipt.proved === true && /^[0-9a-f]{16}$/.test(r.receipt.input), r.receipt);
    // a site can look worthless at the margin and still belong in the package: expanding dosing moves the bottleneck to packaging
    const part = (site) => { const inv = r.investments.filter((x) => x.site === site); return { investments: inv, capexPV: inv.reduce((a, x) => a + x.capexPV, 0), opexPV: inv.reduce((a, x) => a + x.opexPV, 0), npv: 0 }; };
    const vv = K.verify(highs, net, part("d-vlc"), { mode: "qualified", hold: 6 }), vc = K.verify(highs, net, part("pk-cpt"), { mode: "qualified", hold: 6 });
    check("example network: Cape Town alone loses money, Valencia alone earns less than the two together", vc.npv < 0 && vv.npv > 0 && vv.npv < v.npv && Math.abs(vc.npv + 1.94e6) < 0.05e6 && Math.abs(vv.npv - 7.07e6) < 0.05e6, [vv.npv, vc.npv, v.npv]);
    const free = N.build("base"); delete free.config.unitCost; delete free.config.holdingRate;
    const vf = K.verify(highs, free, r, { mode: "qualified", hold: 6 });
    check("verification: with stock almost free the same package looks like a loss (−$4.0M), and is reported as a disagreement", vf.ok && Math.abs(vf.npv + 4.03e6) < 0.05e6 && vf.pays === false && vf.agrees === false, vf);
    check("verification: nothing chosen, nothing to check", K.verify(highs, net, { investments: [] }, {}).nothingToCheck === true);
    r.investments.forEach((inv) => {
      const site = net.sites.find((s) => s.id === inv.site), cand = site && (site.candidates || []).find((c) => c.id === inv.id);
      check("example network: " + inv.site + "/" + inv.id + " matches a defined candidate", !!cand && cand.add === inv.add && cand.capex === inv.capex, inv);
    });
  }

  console.log(pass + "/" + (pass + fail) + " checks passed");
  if (fail) process.exit(1);
})();
