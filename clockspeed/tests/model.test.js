// Clockspeed Balancing model checks — run with: node clockspeed/tests/model.test.js
// Steady state, exact accounting, the three clock speeds, and the conflicts the simulator exists to show: the promise
// ratchet, the cost of an unsupported commercial push, the value of pacing, firefighting, complexity creep, sunk
// costs, resilience from dual sourcing, and what each scenario does to the fit of an unchanged strategy.
const C = require("../src/model.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const at = (sim, month) => sim.history.months[Math.min(sim.history.months.length - 1, month - 1)];
const policy = (fn) => (sim, q) => { const d = sim.decisions(); fn(d, q); return d; };
const k = (x) => (x / 1000).toFixed(0) + "k";

// ---- set-up and steady state
const base = C.run({}, "calm");
{
  const f = base.history.months[0];
  check("20 years in 80 quarterly turns, recorded monthly", base.history.quarters.length === 80 && base.history.months.length === 240);
  check("the company starts as designed: demand 1,000/month, all of it served, utilisation about 0.87", near(f.demand, 1000, 1e-6) && near(f.served, 1000, 1e-6) && near(f.utilisation, 0.87, 0.03), f.utilisation.toFixed(3));
  check("…and fitted to its starting strategy on every level", near(f.fitProduct, 1, 1e-9) && near(f.fitNetwork, 1, 1e-9) && near(f.fitCommercial, 1, 1e-9));
  check("…with an organisation settled in its own equilibrium (capability, trust, suppliers between 0.5 and 0.95)", [f.capability, f.trust, f.supplier].every((x) => x > 0.5 && x < 0.95), [f.capability, f.trust, f.supplier].map((x) => x.toFixed(3)).join(", "));
  const keys = ["demand", "served", "revenue", "profit", "reliability", "capability", "trust", "supplier", "utilisation", "fitProduct", "fitNetwork", "perceivedF", "perceivedI", "capacity", "rangeF", "rangeI", "covI", "flexI"];
  let worst = 0, which = "";
  base.history.months.forEach((m) => keys.forEach((key) => { const e = Math.abs(m[key] - f[key]) / Math.max(1, Math.abs(f[key])); if (e > worst) { worst = e; which = key; } }));
  check("steady strategy in calm skies: nothing moves for 20 years", worst < 1e-9, worst.toExponential(2) + " " + which);
  check("…and the cash grows by the same profit every month", near(base.state.cash, f.profit * 240, 1e-6 * Math.abs(base.state.cash)));
  const again = C.run({}, "calm");
  check("deterministic: the same decisions give the same 20 years", again.state.cash === base.state.cash);
}

// ---- accounting
{
  const sim = C.run({}, "perfect", policy((d, q) => {
    if (q === 2) { d.network.expand.AS = 120; d.network.close.EU = 60; d.commercial.launches.I *= 2; }
    if (q === 20) { d.commercial.rationalize.I = 0.2; d.network.expand.AM = 50; }
  }));
  const T = sim.totals, st = sim.state;
  ["F", "I"].forEach((s) => check("product range " + s + ": Δrange = ∫launches − ∫retirements", near(st.range[s] - sim.start.range[s], T.launches[s] - T.retirements[s], 1e-6 * T.launches[s])));
  const K = C.REG.reduce((a, r) => a + st.K[r], 0), pipe = C.REG.reduce((a, r) => a + st.pipe[r][0] + st.pipe[r][1] + st.pipe[r][2], 0), closing = C.REG.reduce((a, r) => a + st.closing[r], 0);
  check("capacity: ΔK = ∫completed − ∫closed, and what was ordered is either built or still in the pipeline", near(K - sim.start.capacity, T.completed - T.closed, 1e-6 * sim.start.capacity) && near(pipe, T.ordered - T.completed, 1e-6 * T.ordered), "pipeline " + pipe.toFixed(2) + ", closing " + closing.toFixed(2));
  check("cash = ∫profit − ∫capex − severance", near(st.cash, T.profit - T.capex - st.severance, 1e-6 * Math.abs(T.profit)), k(st.cash) + " vs " + k(T.profit - T.capex - st.severance));
  check("closing capacity writes off its share of the book value and pays severance", st.writeoffs > 0 && near(st.severance, 60 * sim.params.severancePerUnit, 1e-9));
  let ok = true, tradeOk = true;
  sim.history.months.forEach((m) => {
    if (m.served > m.demand + 1e-9 || !near(m.served + m.lost, m.demand, 1e-9)) ok = false;
    if (m.reliability < 0 || m.reliability > 1 || m.capability < 0 || m.capability > 1 || m.trust < 0 || m.trust > 1 || m.supplier < 0 || m.supplier > 1) ok = false;
  });
  check("every month: served + lost = demand, served ≤ demand, and every 0–1 measure stays in [0, 1]", ok);
}

// ---- the three clock speeds: how long each level takes to show 63% of the effect of its own decision
{
  const p = C.defaults();
  const t63 = (sim, key, from, to, start) => { const m = sim.history.months, target = from + 0.632 * (to - from); for (let i = start; i < m.length; i++) if ((m[i][key] - target) * Math.sign(to - from) >= 0) return m[i].t - start; return Infinity; };
  // commercial: a price cut moves demand within months
  const pc = C.run({}, "calm", policy((d, q) => { if (q >= 4) d.commercial.price.F = 0.9; }));
  const dem0 = at(pc, 12).demand, demEnd = at(pc, 120).demand;
  const tCom = t63(pc, "demand", dem0, demEnd, 12);
  // product supply chain: a cover target is reached over most of a year
  const pcv = C.run({}, "calm", policy((d, q) => { if (q >= 4) d.product.coverage.I = 6; }));
  const tPsc = t63(pcv, "covI", 4, 6, 12);
  // network: ordered capacity arrives after years
  const pn = C.run({}, "calm", policy((d, q) => { if (q === 4) d.network.expand.EU = 100; }));
  const K0 = at(pn, 12).capacity, tNet = t63(pn, "capacity", K0, K0 + 100, 12);
  check("clock speeds: commercial in months, product supply chain within a year, network in years", tCom < tPsc && tPsc < tNet && tCom <= 9 && tPsc >= 6 && tPsc <= 14 && tNet >= 24 && tNet <= 48, "commercial " + tCom + " mo, product " + tPsc + " mo, network " + tNet + " mo");
}

// ---- the promise ratchet: expectations rise fast and fall slowly
{
  const s = C.run({}, "calm", policy((d, q) => { const on = q >= 4 && q < 12; d.commercial.promise.I = on ? 1.3 : 1; d.commercial.promise.F = on ? 1.15 : 1; }));
  check("promise ratchet: three years after a faster promise is withdrawn, customers still expect more of it", at(s, 72).expPromiseI > 1.08, at(s, 72).expPromiseI.toFixed(3));
  check("…so demand stays below the old level for years after the promise is withdrawn", at(s, 72).demand < 0.97 * at(base, 72).demand && at(s, 120).demand < at(base, 120).demand, at(s, 72).demand.toFixed(0) + " vs " + at(base, 72).demand.toFixed(0));
  const sizes = [1.1, 1.3, 1.45].map((pi) => at(C.run({}, "calm", policy((d, q) => { const on = q >= 4 && q < 12; d.commercial.promise.I = on ? pi : 1; d.commercial.promise.F = on ? 1 + (pi - 1) / 2 : 1; })), 72).demand);
  check("…and the bigger the overreach, the longer its shadow", sizes[0] > sizes[1] && sizes[1] > sizes[2], sizes.map((x) => x.toFixed(0)).join(" > "));
}

// ---- a commercial push the supply chain is not ready for, and the value of supporting and pacing it
{
  const push = (d) => { d.commercial.promise.I = 1.2; d.commercial.promise.F = 1.1; d.commercial.launches.I *= 1.5; d.commercial.promo = 0.3; };
  const support = (d) => { d.product.coverage.I = 5.5; d.product.flex.I = 0.18; d.product.coverage.F = 3.6; d.network.expand.EU = 60; d.network.expand.AM = 50; d.network.expand.AS = 20; };
  const p = C.run({}, "calm", policy((d, q) => { if (q === 4) push(d); }));
  const ps = C.run({}, "calm", policy((d, q) => { if (q === 4) { push(d); support(d); } }));
  const paced = C.run({}, "calm", policy((d, q) => { if (q === 4) support(d); if (q === 12) push(d); }));
  check("an unsupported push lifts revenue in its first quarter…", p.history.quarters[4].revenue > base.history.quarters[4].revenue, k(p.history.quarters[4].revenue) + " vs " + k(base.history.quarters[4].revenue));
  check("…then reliability, capability and trust fall, and revenue ends below where it started", at(p, 36).reliability < at(base, 36).reliability - 0.05 && at(p, 36).capability < at(base, 36).capability - 0.05 && at(p, 36).trust < at(base, 36).trust - 0.2 && at(p, 120).revenue < at(base, 120).revenue,
    "reliability " + at(p, 36).reliability.toFixed(3) + ", capability " + at(p, 36).capability.toFixed(3) + ", trust " + at(p, 36).trust.toFixed(2));
  check("supporting the push with the product supply chain and the network beats pushing alone", ps.totals.profit > p.totals.profit, k(ps.totals.profit) + " vs " + k(p.totals.profit));
  check("pacing it (support first, push two years later) beats doing both at once", paced.totals.profit > ps.totals.profit, k(paced.totals.profit) + " vs " + k(ps.totals.profit));
}

// ---- firefighting: misses and expediting take the time capability needed
{
  const s = C.run({}, "calm", policy((d, q) => { const on = q >= 4 && q < 12; d.commercial.promise.I = on ? 1.3 : 1; d.commercial.promise.F = on ? 1.15 : 1; }));
  const lowest = Math.min(...s.history.months.slice(12, 40).map((m) => m.capability));
  check("firefighting erodes capability while the overreach lasts", lowest < at(base, 30).capability - 0.05, lowest.toFixed(3) + " vs " + at(base, 30).capability.toFixed(3));
  check("…and it takes years to rebuild after the pressure ends (still below its old level a year later)", at(s, 48).capability < at(base, 48).capability - 0.02 && at(s, 120).capability > at(base, 120).capability - 0.01, at(s, 48).capability.toFixed(3) + " at month 48, " + at(s, 120).capability.toFixed(3) + " at month 120");
  const heavy = C.run({}, "calm", policy((d, q) => { if (q === 4) { d.product.coverage.I = 9; d.product.coverage.F = 7; d.product.flex.I = 0.4; d.product.dual.I = 0.9; d.product.dual.F = 0.9; } }));
  check("changing too much at once loads the organisation: capability dips while the change is implemented", Math.min(...heavy.history.months.slice(12, 30).map((m) => m.capability)) < at(base, 20).capability - 0.01);
}

// ---- complexity creep
{
  const many = C.run({}, "calm", policy((d) => { d.commercial.launches.I = C.decisions0().commercial.launches.I * 2; d.commercial.launches.F = C.decisions0().commercial.launches.F * 2; }));
  check("doubling launches doubles the range over the years, cutting effective capacity and raising cost", at(many, 240).rangeI > 1.8 * at(base, 240).rangeI && at(many, 240).complexity < at(base, 240).complexity && at(many, 120).cost > at(base, 120).cost);
  const cut = C.run({}, "calm", policy((d, q) => { if (q === 4) d.commercial.launches.I = 0; }));
  const half = cut.history.months.findIndex((m, i) => i >= 12 && m.rangeI <= 100);
  check("a range takes years to shrink once launches stop (half-life over a year)", half - 12 >= 12, (half - 12) + " months to halve");
}

// ---- resilience: dual sourcing softens a disruption
{
  const low = C.run({}, "storm"), high = C.run({}, "storm", policy((d) => { d.product.dual.F = 0.9; d.product.dual.I = 0.9; }));
  // the other regions' spare capacity covers Europe's loss, so the disruption shows as imports and lower reliability
  const win = (s) => s.history.months.slice(48, 60), minRel = (s) => Math.min(...win(s).map((m) => m.reliability)), imp = (s) => win(s).reduce((a, m) => a + m.imports, 0) / 12;
  check("in the storm, more dual sourcing keeps Europe supplied: fewer imports and higher reliability during the disruption", imp(high) < imp(low) && minRel(high) > minRel(low) + 0.01,
    "imports " + imp(high).toFixed(1) + " vs " + imp(low).toFixed(1) + "/month, lowest reliability " + minRel(high).toFixed(3) + " vs " + minRel(low).toFixed(3));
}

// ---- the weather: what each scenario does to an unchanged strategy
{
  const inn = C.run({}, "innovation"), asia = C.run({}, "asia"), war = C.run({}, "promisewar");
  check("innovation wave, strategy unchanged: the product supply chain falls out of fit", at(inn, 120).fitProduct < 0.95, at(inn, 120).fitProduct.toFixed(3));
  check("Eastern growth, strategy unchanged: the network falls out of fit and imports grow", at(asia, 144).fitNetwork < 0.95 && at(asia, 144).imports > at(base, 144).imports + 10, at(asia, 144).fitNetwork.toFixed(3) + ", imports " + at(asia, 144).imports.toFixed(0));
  check("promise war, strategy unchanged: demand is lost to faster competitors", at(war, 120).demand < 0.95 * at(base, 120).demand, at(war, 120).demand.toFixed(0));
  const matched = C.run({}, "promisewar", policy((d, q) => { if (q === 12) { d.product.coverage.I = 5.5; d.product.flex.I = 0.18; d.product.coverage.F = 3.6; } if (q === 16) { d.commercial.promise.I = 1.25; d.commercial.promise.F = 1.25; } }));
  check("promise war: preparing the supply chain, then matching the competitors' promise, keeps clearly more demand than standing still", at(matched, 120).demand > 1.03 * at(war, 120).demand, at(matched, 120).demand.toFixed(0) + " vs " + at(war, 120).demand.toFixed(0));
}

// ---- numerics and limits
{
  const half = C.run({ dt: 0.125 }, "perfect", policy((d, q) => { if (q === 4) { d.commercial.promise.I = 1.2; d.network.expand.AS = 80; } }));
  const full = C.run({}, "perfect", policy((d, q) => { if (q === 4) { d.commercial.promise.I = 1.2; d.network.expand.AS = 80; } }));
  check("halving the time step changes 20-year profit by under 1%", Math.abs(half.totals.profit - full.totals.profit) < 0.01 * Math.abs(full.totals.profit), ((half.totals.profit / full.totals.profit - 1) * 100).toFixed(3) + "%");
  const d = C.clampDecisions(Object.assign(C.decisions0(), {}));
  d.commercial.price.F = 9; d.product.flex.I = -1; d.network.expand.EU = 1e6; C.clampDecisions(d);
  check("decisions are held within their limits", d.commercial.price.F === C.LIMITS.price[1] && d.product.flex.I === 0 && d.network.expand.EU === C.LIMITS.expand[1]);
  let bad = false;
  for (const fn of [(x) => { x.commercial.price.F = 0.7; x.commercial.price.I = 0.7; x.commercial.promise.I = 1.6; x.commercial.promo = 1; x.commercial.launches.I = 60; },
    (x, q) => { if (q % 4 === 0) { x.network.close.EU = 400; x.network.close.AM = 400; x.network.close.AS = 400; } },
    (x) => { x.commercial.presence.EU = 0; x.commercial.presence.AM = 0; x.commercial.presence.AS = 0; }]) {
    const s = C.run({}, "perfect", policy(fn));
    s.history.months.forEach((m) => { if (!isFinite(m.profit) || m.demand < -1e-9 || m.capacity < -1e-9 || m.rangeI < 0) bad = true; });
  }
  check("extreme strategies (price war with every promise, closing everything, leaving every market) stay finite and non-negative", !bad);
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
