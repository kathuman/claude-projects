// Clockspeed Balancing model checks — run with: node clockspeed/tests/model.test.js
// Steady state, exact accounting, the three clock speeds, and the conflicts the simulator exists to show: the promise
// ratchet, the cost of an unsupported commercial push, the value of pacing, firefighting and the capability trap,
// complexity creep, sunk costs, resilience from dual sourcing, and what each scenario does to the fit of an unchanged
// strategy. Since 1.1 also: no free lunch (a search for strategies set once that beat steering), the mechanisms behind
// it, the seeded weather, and an aligned autopilot that steering is measured against.
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
  check("cash = ∫profit − ∫capex − ∫interest − severance", near(st.cash, T.profit - T.capex - T.interest - st.severance, 1e-6 * Math.abs(T.profit)), k(st.cash) + " vs " + k(T.profit - T.capex - T.interest - st.severance));
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
  // commercial: a price rise moves demand within months (competitors do not follow a rise, so the move holds)
  const pc = C.run({}, "calm", policy((d, q) => { if (q >= 4) d.commercial.price.F = 1.1; }));
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
  const drop = at(base, 36).capability - at(s, 36).capability, back = (at(s, 120).capability - at(s, 36).capability) / drop;
  check("…and it takes years to rebuild after the pressure ends (still below its old level a year later, half of the loss back within 7 years)", at(s, 48).capability < at(base, 48).capability - 0.02 && back > 0.5 && back < 1, at(s, 48).capability.toFixed(3) + " at month 48, " + (back * 100).toFixed(0) + "% of the loss back by month 120");
  const heavy = C.run({}, "calm", policy((d, q) => { if (q === 4) { d.product.coverage.I = 9; d.product.coverage.F = 7; d.product.flex.I = 0.4; d.product.dual.I = 0.9; d.product.dual.F = 0.9; } }));
  check("changing too much at once loads the organisation: capability dips while the change is implemented", Math.min(...heavy.history.months.slice(12, 30).map((m) => m.capability)) < at(base, 20).capability - 0.01);
}

// ---- the capability trap (Repenning and Sterman): past a point, firefighting takes the time that improving needed
{
  const over = (improveQ) => C.run({}, "calm", policy((d, q) => { const on = q >= 4 && q < 16; d.commercial.promise.I = on ? 1.5 : 1; d.commercial.promise.F = on ? 1.3 : 1; d.product.improve = improveQ && q >= 16 && q < 16 + improveQ ? 1 : 0; }));
  const trapped = over(0), rescued = over(12), c0 = at(base, 1).capability;
  check("a long overreach tips capability into a trap: eight years after the promise is withdrawn it is still below 0.5", at(trapped, 48).capability < 0.45 && at(trapped, 48 + 96).capability < 0.5, at(trapped, 48).capability.toFixed(3) + " when withdrawn, " + at(trapped, 144).capability.toFixed(3) + " eight years on, against " + c0.toFixed(3));
  check("…an improvement programme pulls it out within three years, and pays for itself", at(rescued, 84).capability > 0.7 && rescued.totals.npv > trapped.totals.npv, at(rescued, 84).capability.toFixed(3) + " three years on; NPV " + k(rescued.totals.npv) + " vs " + k(trapped.totals.npv));
  const prog = C.run({}, "calm", policy((d, q) => { d.product.improve = q >= 4 && q < 12 ? 1 : 0; }));
  check("…it gets worse before it gets better: the programme takes capacity and money first", at(prog, 15).profit < at(base, 15).profit);
  const always = C.run({}, "calm", policy((d) => { d.product.improve = 1; }));
  check("…and in a healthy company a permanent programme does not pay", always.totals.npv < base.totals.npv, k(always.totals.npv) + " vs " + k(base.totals.npv));
}

// ---- complexity creep
{
  const many = C.run({}, "calm", policy((d) => { d.commercial.launches.I = C.decisions0().commercial.launches.I * 2; d.commercial.launches.F = C.decisions0().commercial.launches.F * 2; }));
  check("doubling launches doubles the range over the years, cutting effective capacity and raising the cost per unit", at(many, 240).rangeI > 1.8 * at(base, 240).rangeI && at(many, 240).complexity < at(base, 240).complexity && at(many, 120).cost / at(many, 120).served > at(base, 120).cost / at(base, 120).served);
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

// ---- the debrief: which clock made or cost the money
{
  const flown = (scenario, fn) => { const sim = C.create({}, scenario), ds = []; while (!sim.done()) { const d = sim.decisions(); fn(d, sim.state.q); ds.push(C.clone(d)); sim.quarter(d); } return { ds, profit: sim.totals.profit, npv: sim.totals.npv }; };
  const prep = (d) => { d.product.coverage.I = 5.5; d.product.flex.I = 0.18; d.product.coverage.F = 3.6; };
  const match = (d) => { d.commercial.promise.I = 1.25; d.commercial.promise.F = 1.25; };
  const still = flown("promisewar", () => {});
  const b0 = C.debrief({}, "promisewar", still.ds);
  check("debrief: holding the starting course has no gap, no contributions and an empty timeline", b0.gap === 0 && C.GROUPS.every((g) => b0.shapley[g] === 0) && b0.timeline.length === 0);
  const paced = flown("promisewar", (d, q) => { if (q === 12) prep(d); if (q === 16) match(d); });
  const t0 = Date.now(), b = C.debrief({}, "promisewar", paced.ds), ms = Date.now() - t0;
  check("debrief: replaying every level reproduces the flight's own profit and NPV exactly", b.profit === paced.profit && b.npv === paced.npv, k(b.npv));
  check("debrief: the three Shapley parts add up exactly to the gap against the starting course", near(b.shapley.commercial + b.shapley.product + b.shapley.network, b.gap, 1e-6 * Math.abs(b.gap)), k(b.gap));
  check("debrief: each level alone plus the interaction adds up exactly to the gap", near(b.alone.commercial + b.alone.product + b.alone.network + b.interaction, b.gap, 1e-6));
  check("promise war debrief: matching the promise alone loses money, preparing alone hardly pays, together they gain: the gain is all alignment",
    b.alone.commercial < 0 && b.alone.product < 0.25 * b.gap && b.interaction > b.gap && b.gap > 0,
    "match alone " + k(b.alone.commercial) + ", prepare alone " + k(b.alone.product) + ", together " + k(b.gap) + " (interaction " + k(b.interaction) + ")");
  const rushed = flown("promisewar", (d, q) => { if (q === 16) match(d); });
  const br = C.debrief({}, "promisewar", rushed.ds);
  check("debrief: a flight that moves only the commercial clock is charged entirely to it", br.shapley.product === 0 && br.shapley.network === 0 && near(br.shapley.commercial, br.gap, 1e-9) && br.gap < 0, k(br.gap));
  const one = flown("calm", (d, q) => { if (q === 8) { d.commercial.price.F = 0.95; d.product.coverage.F = 4; d.network.expand.AS = 40; } });
  const tl = C.debrief({}, "calm", one.ds).timeline;
  const lands = (lv) => (tl.find((e) => e.level === lv) || {}).landsQ;
  check("debrief timeline: decisions taken in the same quarter land commercial first, then product supply chain, then network",
    tl.length === 3 && tl.every((e) => e.q === 8) && lands("commercial") < lands("product") && lands("product") < lands("network"), tl.map((e) => e.level + " Q" + e.landsQ).join(", "));
  check("debrief: a full 20-year debrief takes under 5 seconds", ms < 5000, ms + " ms");
}

// ---- 1.2: no free lunch. In calm skies the starting strategy is locally optimal, so steering is about the weather
{
  const L = C.LIMITS, d0 = C.decisions0();
  const LEVERS = [["commercial", "price", "F"], ["commercial", "price", "I"], ["commercial", "promise", "F"], ["commercial", "promise", "I"], ["commercial", "promo"],
    ["commercial", "launches", "F"], ["commercial", "launches", "I"], ["commercial", "rationalize", "F"], ["commercial", "rationalize", "I"],
    ["product", "coverage", "F"], ["product", "coverage", "I"], ["product", "flex", "F"], ["product", "flex", "I"], ["product", "dual", "F"], ["product", "dual", "I"], ["product", "improve"],
    ["network", "automate", "EU"], ["network", "automate", "AM"], ["network", "automate", "AS"]];
  const get = (d, l) => l.length === 3 ? d[l[0]][l[1]][l[2]] : d[l[0]][l[1]];
  const set = (d, l, v) => { if (l.length === 3) d[l[0]][l[1]][l[2]] = v; else d[l[0]][l[1]] = v; };
  const once = (pick) => (sim, q) => { const d = sim.decisions(); if (q === 0) pick.forEach(([l, v]) => set(d, l, v)); return d; };
  const hold = base.totals.npv;
  let worst = -Infinity, which = "";
  LEVERS.forEach((l) => [-1, 1].forEach((sg) => {
    const lim = L[l[1]], v = get(d0, l), nv = Math.min(lim[1], Math.max(lim[0], v + sg * 0.15 * (lim[1] - lim[0])));
    if (nv === v) return;
    const g = C.run({}, "calm", once([[l, nv]])).totals.npv / hold - 1;
    if (g > worst) { worst = g; which = l.slice(1).join(" ") + " " + v.toFixed(2) + "→" + nv.toFixed(2); }
  }));
  check("calm skies: no single lever, moved once and held, gains more than 2% of NPV", worst < 0.02, (worst * 100).toFixed(1) + "% (" + which + ")");
  let seed = 4242; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let best = -Infinity;
  for (let i = 0; i < 150; i++) {
    const pick = LEVERS.filter(() => rnd() < 0.5).map((l) => [l, L[l[1]][0] + (L[l[1]][1] - L[l[1]][0]) * rnd()]);
    best = Math.max(best, C.run({}, "calm", once(pick)).totals.npv / hold - 1);
  }
  check("…and none of 150 random strategies set once in the first quarter gains more than 2%", best < 0.02, "best " + (best * 100).toFixed(1) + "%");
  const lazy = once([[["commercial", "price", "I"], 1.4], [["commercial", "rationalize", "F"], 0.3], [["commercial", "rationalize", "I"], 0.3], [["product", "coverage", "F"], 12], [["product", "coverage", "I"], 12],
    [["network", "automate", "EU"], 1], [["network", "automate", "AM"], 1], [["network", "automate", "AS"], 1]]);
  const losses = Object.keys(C.SCENARIOS).map((sc) => [sc, C.run({}, sc, lazy).totals.npv / C.run({}, sc).totals.npv - 1]);
  check("the set-and-forget strategy that won 1.0 by 45–59% now loses to holding course in every weather", losses.every((x) => x[1] < 0), losses.map((x) => x[0] + " " + (x[1] * 100).toFixed(0) + "%").join(", "));
}

// ---- 1.2: the mechanisms behind it
{
  const cut = C.run({}, "calm", policy((d, q) => { if (q >= 4) d.commercial.price.F = 0.9; }));
  check("competitors match a price cut: the extra demand fades within two years, and the margin is gone for good", at(cut, 18).demand > 1040 && at(cut, 48).demand < 1010 && cut.totals.npv < base.totals.npv, "demand " + at(cut, 18).demand.toFixed(0) + " → " + at(cut, 48).demand.toFixed(0) + ", NPV " + k(cut.totals.npv) + " vs " + k(base.totals.npv));
  const rise = C.run({}, "calm", policy((d, q) => { if (q >= 4) d.commercial.price.I = 1.15; }));
  check("…but not a rise: customers leave, and the higher price earns less", at(rise, 60).demand < 950 && rise.totals.npv < base.totals.npv, "demand " + at(rise, 60).demand.toFixed(0) + ", NPV " + k(rise.totals.npv));
  const inn = C.run({}, "innovation"), covI = C.run({}, "innovation", policy((d) => { d.product.coverage.I = 12; })), flexI = C.run({}, "innovation", policy((d) => { d.product.flex.I = 0.25; }));
  check("Fisher: for innovative products in the innovation wave, flexible capacity pays where stock does not", flexI.totals.npv > inn.totals.npv * 1.1 && covI.totals.npv < inn.totals.npv * 1.02, "flex " + k(flexI.totals.npv) + ", 12 weeks of cover " + k(covI.totals.npv) + ", unchanged " + k(inn.totals.npv));
  const covCalm = C.run({}, "calm", policy((d) => { d.product.coverage.I = 12; }));
  check("…innovative stock goes obsolete: 12 weeks of cover costs more than the reliability it buys", covCalm.totals.npv < base.totals.npv, k(covCalm.totals.npv) + " vs " + k(base.totals.npv));
  const auto = (sc) => C.run({}, sc, policy((d) => { d.network.automate = { EU: 1, AM: 1, AS: 1 }; })).totals.npv / C.run({}, sc).totals.npv - 1;
  const aCalm = auto("calm"), aInn = auto("innovation");
  check("automation makes capacity rigid: full automation costs more as the mix turns innovative", aCalm < 0 && aInn < aCalm, "calm " + (aCalm * 100).toFixed(0) + "%, innovation wave " + (aInn * 100).toFixed(0) + "%");
  const debt = C.run({}, "calm", policy((d, q) => { if (q < 8) d.network.expand = { EU: 400, AM: 400, AS: 400 }; }));
  check("negative cash pays interest, and cash = ∫profit − ∫capex − ∫interest − severance", debt.totals.interest > 0 && near(debt.state.cash, debt.totals.profit - debt.totals.capex - debt.totals.interest - debt.state.severance, 1e-6 * Math.abs(debt.state.cash)), "interest " + k(debt.totals.interest));
  const f = base.history.months[0], r = base.params.discountRate / 12;
  check("NPV discounts every month's cash flow at 8% a year", near(base.totals.npv, f.profit * (1 - Math.exp(-r * 240)) / r, 1e-4 * base.totals.npv), k(base.totals.npv) + " against " + k(base.totals.profit) + " undiscounted");
}

// ---- 1.2: seeded weather. The briefing gives a range; the flight draws one path from it
{
  const a = C.run({}, "perfect", null, 7), b = C.run({}, "perfect", null, 7), c = C.run({}, "perfect", null, 8);
  check("a seed replays exactly; another seed flies other weather", a.totals.npv === b.totals.npv && a.totals.npv !== c.totals.npv);
  let inRange = true;
  for (let s = 1; s <= 200; s++) {
    const w = C.weatherDraw(s);
    if (w.innoStart < 12 || w.innoStart > 36 || w.asiaStart < 24 || w.asiaStart > 48 || w.warStart < 36 || w.warStart > 60 || w.stormStart < 36 || w.stormStart > 72 || w.stormLen < 6 || w.stormLen > 14 ||
      w.stormSize < 0.3 || w.stormSize > 0.5 || w.tariffStart < 60 || w.tariffStart > 96 || w.tariff < 1.6 || w.tariff > 2.4 || w.asiaGrowth < 0.6 || w.asiaGrowth > 1.4 || w.innoShift < 0.3 || w.innoShift > 0.6) inRange = false;
  }
  check("…and every draw stays inside the ranges the briefing gives", inRange);
  const storm = C.create({}, "storm", 3), ev = storm.events.find((e) => e[2].indexOf("disruption hits") >= 0);
  check("the advisories' events follow the drawn weather", ev && ev[0] === storm.weatherParams.stormStart && C.weather("storm", ev[0] + 1, storm.weatherParams).disruption.EU > 0 && C.weather("storm", ev[0] - 1, storm.weatherParams).disruption.EU === 0);
  const noisy = C.run({}, "calm", null, 5), sd = Math.sqrt(noisy.history.months.reduce((x, m) => x + (m.demand - 1000) ** 2, 0) / 240);
  check("a seeded flight has noisy demand; the central path has none", sd > 10 && sd < 80, "monthly demand varies by ±" + sd.toFixed(0));
}

// ---- 1.2: steering pays. Averaged over eight seeded weathers, the aligned autopilot against holding course and against
// the best strategy set once in the first quarter (found by a random search on the central path)
{
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8], mean = (sc, pol) => SEEDS.reduce((a, s) => a + C.run({}, sc, pol, s).totals.npv, 0) / SEEDS.length;
  const L = C.LIMITS, keys = [["commercial", "price"], ["commercial", "promise"], ["commercial", "launches"], ["commercial", "rationalize"], ["product", "coverage"], ["product", "flex"], ["product", "dual"]];
  let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rows = [];
  ["innovation", "asia", "promisewar", "storm", "perfect"].forEach((sc) => {
    let best = -Infinity, bestPick = null;
    for (let i = 0; i < 120; i++) {
      const pick = [];
      keys.forEach(([g, l]) => ["F", "I"].forEach((s) => { if (rnd() < 0.5) pick.push([g, l, s, L[l][0] + (L[l][1] - L[l][0]) * rnd()]); }));
      C.REG.forEach((r) => { if (rnd() < 0.5) pick.push(["network", "expand", r, 150 * rnd()]); if (rnd() < 0.3) pick.push(["network", "automate", r, rnd()]); });
      const pol = (sim, q) => { const d = sim.decisions(); if (q === 0) pick.forEach(([g, l, x, v]) => { d[g][l][x] = v; }); return d; };
      const v = C.run({}, sc, pol).totals.npv; if (v > best) { best = v; bestPick = pol; }
    }
    rows.push([sc, mean(sc, null), mean(sc, C.aligned), mean(sc, bestPick)]);
  });
  const txt = rows.map((r) => r[0] + " " + k(r[2]) + "/" + k(r[1]) + "/" + k(r[3])).join(", ");
  const row = (sc) => rows.find((r) => r[0] === sc);
  check("steering pays: the aligned autopilot beats holding course by at least 3% wherever the weather changes the business, and holds even in the storm", rows.every((r) => r[0] === "storm" ? r[2] > 0.99 * r[1] : r[2] > 1.03 * r[1]), "aligned/hold/set-once: " + txt);
  check("…it beats the best strategy set once by at least 3% in the promise war and the perfect storm, and comes within 2% of it elsewhere (preparing early for a trend the briefing announced is fair anticipation)",
    ["promisewar", "perfect"].every((sc) => row(sc)[2] > 1.03 * row(sc)[3]) && rows.every((r) => r[2] > 0.98 * r[3]));
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
