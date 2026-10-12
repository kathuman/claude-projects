// Real Options valuation checks — run with: node real-options/tests/model.test.js
// The lattice against Black–Scholes and its own growth; a deterministic case against a closed form; the strategies'
// dominance relations; option value against volatility, the decision window, lead times, penalties and
// escalation; the right to sell a site and lease break clauses; mothballing and partial contraction; Monte Carlo
// along the optimal policies against the lattice values; convergence as the step shrinks.
const M = require("../src/model.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const f = (x) => x.toFixed(2);

// ---- the lattice
{
  let worst = 0, bad = 0, n = 0, warned = 0;
  for (const basis of ["wacc", "rn"]) for (let s = 0.05; s <= 0.601; s += 0.05) for (let g = -0.10; g <= 0.121; g += 0.02) {
    const L = M.lattice(M.merge({ sigma: s, g, basis })); n++;
    if (!(L.p > 0 && L.p < 1)) bad++;
    worst = Math.max(worst, Math.abs(Math.log(L.p * L.u + (1 - L.p) * L.d) / L.dt - L.g));
    if (L.dt < 0.25) warned += L.warnings.length ? 1 : 0;
  }
  check("over every slider combination the up-probability is inside (0, 1) — no clamping (" + n + " cases)", bad === 0, bad + " invalid");
  check("…and the lattice's expected growth equals the growth set, exactly", worst < 1e-12, worst.toExponential(2));
  check("…and when a finer step is needed the page is told", warned > 0 && M.lattice(M.merge({ sigma: 0.05, g: 0.12 })).warnings.length === 1);
  check("risk-neutral basis: drift is reduced by the market price of risk and discounting uses the risk-free rate", near(M.lattice(M.merge({ basis: "rn", g: 0.04, sigma: 0.25, lambda: 0.3, rf: 0.03 })).g, 0.04 - 0.075, 1e-12) && M.lattice(M.merge({ basis: "rn", rf: 0.03 })).r === 0.03);
}
// Black–Scholes
{
  const N = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2); const q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - q : q; };
  const bs = (S, X, s, r, T) => { const d1 = (Math.log(S / X) + (r + s * s / 2) * T) / (s * Math.sqrt(T)), d2 = d1 - s * Math.sqrt(T); return S * N(d1) - X * Math.exp(-r * T) * N(d2); };
  const exact = bs(100, 110, 0.3, 0.04, 2), coarse = M.europeanCall(100, 110, 0.3, 0.04, 2, 0.25), fine = M.europeanCall(100, 110, 0.3, 0.04, 2, 1 / 500);
  check("the lattice prices a European call within 0.5% of Black–Scholes, and gets closer as the step shrinks", Math.abs(fine / exact - 1) < 0.005 && Math.abs(fine - exact) < Math.abs(coarse - exact), f(coarse) + " → " + f(fine) + " vs " + f(exact));
}
// deterministic demand: a fixed design's value is a plain discounted sum
{
  const p = M.merge({ sigma: 1e-4, g: 0 }), L = M.lattice(p), K = 600;
  let pv = -M.buildCost(p, K, 0);
  for (let t = 0; t < L.N; t++) pv += Math.pow(L.disc, t) * M.cfRate(p, p.D0, t < L.Lb ? 0 : K) * L.dt;
  check("deterministic demand: committing to K equals the discounted cash flows, with nothing while it is built", near(M.fixedNpv(p, K), pv, 1e-3), f(M.fixedNpv(p, K)) + " vs " + f(pv));
}

// ---- strategy relations
const base = M.solve({});
{
  check("defaults: waiting is never worth less than committing to the same footprint now (building now is one of its choices)", base.defer.npv >= base.full.npv - 1e-9, f(base.defer.npv) + " ≥ " + f(base.full.npv));
  check("the best fixed design is at least as good as the full footprint, and as any other fixed capacity", base.best.npv >= base.full.npv - 1e-9 && [300, 400, 600, 800, 1000].every((K) => M.fixedNpv({}, K) <= base.best.npv + 1e-9), "best K " + base.best.K.toFixed(0));
  check("staging is never worth less than stopping at the initial footprint", base.stage.npv >= M.fixedNpv({}, base.levels[0]) - 1e-9, f(base.stage.npv) + " ≥ " + f(M.fixedNpv({}, base.levels[0])));
  check("flexibility is valued against the best fixed design, not a straw man: it is smaller than against the full footprint", Math.max(base.defer.npv, base.stage.npv) - base.best.npv < Math.max(base.defer.npv, base.stage.npv) - base.full.npv);
  for (const o of [{ sigma: 0.45, g: 0 }, { sigma: 0.2, g: -0.06 }, { penalty: 0.03 }, { buildLead: 0, expandLead: 0 }]) {
    const s = M.solve(o);
    check("relations hold too for " + JSON.stringify(o), s.defer.npv >= s.full.npv - 1e-9 && s.best.npv >= s.full.npv - 1e-9 && s.stage.npv >= M.fixedNpv(o, s.levels[0]) - 1e-9);
  }
}

// ---- option value against its drivers
{
  // with no resale and no switching, so that committing now holds no option of its own
  const sig = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6].map((s) => M.solve({ sigma: s, basis: "rn", salvF: 0, moth: 0, contract: 0 }));
  const dv = sig.map((s) => s.defer.npv - s.full.npv), sv = sig.map((s) => s.stage.npv - s.full.npv);
  check("risk-neutral: the value of waiting rises with volatility", dv.every((v, i) => i === 0 || v >= dv[i - 1] - 1e-6), dv.map(f).join(" ≤ "));
  check("risk-neutral: the value of staging rises with volatility", sv.every((v, i) => i === 0 || v >= sv[i - 1] - 1e-6), sv.map(f).join(" ≤ "));
  const win = [2, 4, 8, 12].map((w) => M.solve({ window: w }));
  check("a longer decision window never lowers the value of waiting or staging", win.every((s, i) => i === 0 || (s.defer.npv >= win[i - 1].defer.npv - 1e-9 && s.stage.npv >= win[i - 1].stage.npv - 1e-9)), win.map((s) => f(s.stage.npv)).join(" ≤ "));
  check("a longer build lead time lowers the value of committing now", M.solve({ buildLead: 0.5 }).full.npv > base.full.npv && base.full.npv > M.solve({ buildLead: 3 }).full.npv);
  check("expansions that arrive at once are worth more than expansions that take a year", M.solve({ expandLead: 0 }).stage.npv > base.stage.npv);
  check("waiting is not free: a bigger penalty for lost sales lowers its value", M.solve({ penalty: 0.03, outCap: 0.3 }).defer.npv < M.solve({ penalty: 0.005, outCap: 0.3 }).defer.npv);
  const nobridge = M.solve({ outCap: 0, penalty: 0.04 });
  check("with no interim supply and a heavy penalty, waiting builds at once (its value equals committing now)", near(nobridge.defer.npv, nobridge.full.npv, 1e-9) && nobridge.defer.build[0][0] === 1);
  check("costlier later builds (escalation) lower the value of waiting", M.solve({ escal: 0.12 }).defer.npv < M.solve({ escal: 0 }).defer.npv);
  const rn0 = M.solve({ basis: "rn", lambda: 0, rf: 0.10 });
  check("risk-neutral with no price of risk and rf = WACC gives exactly the WACC valuation", near(rn0.stage.npv, base.stage.npv, 1e-9) && near(rn0.defer.npv, base.defer.npv, 1e-9));
}

// ---- contract & exit: the right to sell a site, and leases with break clauses
{
  const z = M.solve({ salvF: 0, moth: 0, contract: 0 });
  check("with no resale value and no switching the valuation is exactly version 2.0.0's", [["full", 19.937568656], ["best", 22.832554721], ["defer", 22.325083326], ["stage", 26.069265776]].every((a) => near(z[a[0]].npv, a[1], 1e-8)));
  for (const o of [{}, { sigma: 0.45, g: 0 }, { sigma: 0.2, g: -0.06 }]) {
    const a = M.solve(Object.assign({ salvF: 0, moth: 0, contract: 0 }, o)), b = M.solve(Object.assign({ salvF: 0.6, moth: 0, contract: 0 }, o));
    check("the right to sell never lowers any owned strategy's value " + JSON.stringify(o), ["full", "best", "defer", "stage"].every((k) => b[k].npv >= a[k].npv - 1e-9), ["full", "best", "defer", "stage"].map((k) => f(a[k].npv) + "→" + f(b[k].npv)).join(" "));
  }
  check("a higher resale value is worth more (best fixed design)", [0, 0.2, 0.4, 0.6].map((v) => M.solve({ salvF: v, moth: 0 }).best.npv).every((v, i, a) => i === 0 || v >= a[i - 1] - 1e-9));
  const sellV = [0.1, 0.2, 0.3, 0.45, 0.6].map((sg) => M.fixedNpv({ sigma: sg, basis: "rn", salvF: 0.5, moth: 0 }, 500) - M.fixedNpv({ sigma: sg, basis: "rn", salvF: 0, moth: 0 }, 500));
  check("risk-neutral: the right to sell a site is worth more the more uncertain demand is", sellV.every((v, i) => i === 0 || v >= sellV[i - 1] - 1e-9), sellV.map(f).join(" ≤ "));
  check("the stage strategy also uses it: it sells everything somewhere on the lattice when demand collapses", (() => { const s = M.solve({ sigma: 0.45, g: -0.04, salvF: 0.6, moth: 0, contract: 0 }); return s.stage.pol.some((row) => row && row[0] && Array.prototype.some.call(row[0], (c) => c === 255)); })());
  // leases
  const L0 = M.solve({});
  check("break clauses never lower a lease's value", L0.lease.npv >= L0.lease.noBreak - 1e-9, f(L0.lease.noBreak) + " → " + f(L0.lease.npv));
  const huge = M.solve({ breakFee: 1000 });
  check("with a prohibitive break fee the lease is worth exactly the same as one without breaks", near(huge.lease.npv, huge.lease.noBreak, 1e-9));
  check("a higher break fee lowers the lease's value", M.solve({ breakFee: 3 }).lease.npv < L0.lease.npv && L0.lease.npv < M.solve({ breakFee: 0 }).lease.npv);
  check("more frequent and earlier breaks raise its value", M.solve({ breakEvery: 1 }).lease.npv > L0.lease.npv && M.solve({ minTerm: 2 }).lease.npv > L0.lease.npv);
  check("a higher rent lowers it", M.solve({ rent: 0.008 }).lease.npv < L0.lease.npv);
  const brk = [0.1, 0.2, 0.3, 0.45, 0.6].map((sg) => M.leaseNpv({ sigma: sg, basis: "rn" }, 500, true) - M.leaseNpv({ sigma: sg, basis: "rn" }, 500, false));
  check("risk-neutral: break clauses are worth more the more uncertain demand is", brk.every((v, i) => i === 0 || v >= brk[i - 1] - 1e-6), brk.map(f).join(" ≤ "));
  // deterministic demand: the lease is a plain discounted sum (rent from arrival, fit-out paid now)
  // (capacity away from today's demand, where min(D, K) has a kink that even a tiny volatility feels)
  const p = M.merge({ sigma: 1e-4, g: 0 }), Ld = M.lattice(p), Ll = Math.round(p.leaseLead / Ld.dt), K = 450, lv = M.leaseNpv(p, K, false);
  let pv = -p.leaseFit * p.fFix;
  for (let t = 0; t < Ld.N; t++) pv += Math.pow(Ld.disc, t) * (t < Ll ? M.cfRate(p, p.D0, 0) : M.cfRate(p, p.D0, K) - p.rent * K) * Ld.dt;
  check("deterministic demand: the lease equals its discounted cash flows", near(lv, pv, 1e-3), f(lv) + " vs " + f(pv));
  check("the lease helper agrees with the solver at the chosen capacity", near(M.leaseNpv({}, L0.lease.K, true), L0.lease.npv, 1e-9) && near(M.leaseNpv({}, L0.lease.K, false), L0.lease.noBreak, 1e-9));
  check("break dates: the first after the minimum term, then every interval, all within the asset life", (() => { const L = M.lattice(M.merge({})), b = Object.keys(M.breakSteps(M.merge({}), L, 2)).map(Number); return b[0] === 22 && b[1] === 42 && b[2] === 62 && b.every((t) => t < L.N); })());
}

// ---- switching: mothballing and reactivating an owned site; selling the staged site back in steps
{
  const v21 = M.solve({ moth: 0, contract: 0 });
  check("with switching off the valuation is exactly version 2.1.0's", [["full", 21.543915116], ["best", 23.444825721], ["defer", 22.904579583], ["stage", 26.433358371], ["lease", 23.399606525]].every((a) => near(v21[a[0]].npv, a[1], 1e-8)));
  // a specialised site (no resale value) with high fixed operating costs: idling is its fallback
  const HI = { salvF: 0, mothF: 0.1, opcost: 0.01, sigma: 0.4, g: 0 };
  for (const o of [{}, HI, { sigma: 0.2, g: -0.06, opcost: 0.01 }]) {
    const a = M.solve(Object.assign({ moth: 0, contract: 0 }, o)), b = M.solve(Object.assign({ moth: 1, contract: 0 }, o)), c = M.solve(Object.assign({ moth: 0, contract: 1 }, o));
    check("mothballing never lowers an owned strategy's value " + JSON.stringify(o), ["full", "best", "defer", "stage"].every((k) => b[k].npv >= a[k].npv - 1e-9), ["full", "best", "defer", "stage"].map((k) => f(a[k].npv) + "→" + f(b[k].npv)).join(" "));
    check("partial contraction never lowers the staged value " + JSON.stringify(o), c.stage.npv >= a.stage.npv - 1e-9, f(a.stage.npv) + "→" + f(c.stage.npv));
  }
  const hi = M.solve(Object.assign({ contract: 1 }, HI));
  check("with high fixed operating costs, mothballing adds real value to the best fixed design", hi.best.npv - hi.best.noMoth > 0.5, f(hi.best.npv - hi.best.noMoth));
  check("a site that resells well is sold rather than mothballed: with resale value the right to mothball adds nothing here", (() => { const r = M.solve(Object.assign({}, HI, { salvF: 0.3 })); return r.best.npv - r.best.noMoth < 0.05; })());
  check("cheaper switching and a lower idle holding cost are worth more", M.fixedNpv(Object.assign({}, HI, { mothFix: 0.2, reactFix: 0.2 }), 500) > M.fixedNpv(HI, 500) && M.fixedNpv(Object.assign({}, HI, { mothF: 0.02 }), 500) > M.fixedNpv(HI, 500));
  const mv = [0.1, 0.2, 0.3, 0.45, 0.6].map((sg) => { const o = Object.assign({}, HI, { sigma: sg, basis: "rn", salvF: 0 }); return M.fixedNpv(o, 500) - M.fixedNpv(Object.assign({ moth: 0 }, o), 500); });
  check("risk-neutral: the right to mothball is worth more the more uncertain demand is", mv.every((v, i) => i === 0 || v >= mv[i - 1] - 1e-9), mv.map(f).join(" ≤ "));
  // hysteresis: the site is idled at lower demand than it is restarted at (switching costs open a band)
  const R = hi.Rbest, Lh = hi.lattice; let band = 0, crossed = 0;
  for (let t = Lh.Lb; t < Lh.N; t++) {
    let idleTop = -1, restartBottom = Infinity;
    for (let i = 0; i <= t; i++) { if (R.ex[t][i] === 2) idleTop = Math.max(idleTop, i); if (R.exB[t][i] === 3) restartBottom = Math.min(restartBottom, i); }
    if (idleTop >= 0 && restartBottom < Infinity) { band++; if (!(idleTop < restartBottom)) crossed++; }
  }
  check("hysteresis: at every step the mothball trigger lies below the reactivation trigger", band > 10 && crossed === 0, band + " steps with both triggers");
  // closed form: with free switching and no resale, a site is worth the expected best of running and idling, step by step
  const pz = M.merge(Object.assign({}, HI, { salvF: 0, mothFix: 0, reactFix: 0 })), Lz = M.lattice(pz), K = 500;
  let pm = [1], pv = -M.buildCost(pz, K, 0);
  for (let t = 0; t < Lz.N; t++) {
    let e = 0;
    for (let i = 0; i <= t; i++) { const D = M.demand(pz, Lz, t, i); e += pm[i] * (t < Lz.Lb ? M.cfRate(pz, D, 0) : Math.max(M.cfRate(pz, D, K), M.cfIdle(pz, D, K))); }
    pv += Math.pow(Lz.disc, t) * e * Lz.dt;
    const nx = new Array(t + 2).fill(0); for (let i = 0; i <= t; i++) { nx[i] += pm[i] * (1 - Lz.p); nx[i + 1] += pm[i] * Lz.p; } pm = nx;
  }
  check("free switching: the site is worth the expected best of running and idling at every step (closed form)", near(M.fixedNpv(pz, K), pv, 1e-9), f(M.fixedNpv(pz, K)) + " vs " + f(pv));
  const cs = M.solve(Object.assign({ contract: 1, moth: 0 }, HI, { g: -0.04 }));
  check("the staged site sells capacity back in steps somewhere on the lattice when demand falls", cs.stage.pol.some((row) => row && row.some((lvl, k) => k > 0 && Array.prototype.some.call(lvl, (c) => c < k))));
}

// ---- the policies, simulated, reproduce the lattice values; demand respects the market ceiling
for (const o of [{}, { sigma: 0.45, g: 0, salvF: 0.6 }, { sigma: 0.4, g: -0.02, opcost: 0.01, salvF: 0, mothF: 0.1 }]) {
  const s = M.solve(o), sim = M.simulate(s, 6000, 3);
  if (o.salvF) check("in a volatile market sites are sold and leases broken on some paths", sim.some((r) => r.sold.best !== null) && sim.some((r) => r.sold.stage !== null) && sim.some((r) => r.sold.lease !== null));
  if (o.opcost) check("with high fixed operating costs sites are mothballed and the staged site contracts on some paths", sim.some((r) => r.mothballs.best > 0) && sim.some((r) => r.mothballs.stage > 0 || r.contractions > 0) && sim.some((r) => r.contractions > 0));
  ["full", "best", "defer", "stage", "lease"].forEach((k) => {
    const xs = sim.map((r) => r[k]), m = xs.reduce((a, b) => a + b, 0) / xs.length, se = Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length / xs.length);
    check("simulated " + k + " policy matches the lattice value within 3 standard errors " + JSON.stringify(o), Math.abs(m - s[k].npv) <= 3 * se + 1e-9, f(m) + " vs " + f(s[k].npv) + " (se " + f(se) + ")");
  });
  check("no simulated path's demand exceeds the market ceiling " + JSON.stringify(o), sim.every((r) => r.endDemand <= s.params.ceiling * s.params.D0 + 1e-9));
}

// ---- convergence: quarterly steps are close to the converged values
{
  const q = M.solve({ stepYears: 0.25 }), w = M.solve({ stepYears: 1 / 26 });
  const rel = ["full", "best", "defer", "stage", "lease"].map((k) => Math.abs(q[k].npv / w[k].npv - 1));
  check("quarterly steps are within 4% of fortnightly ones for every strategy", rel.every((x) => x < 0.04), rel.map((x) => (x * 100).toFixed(1) + "%").join(", "));
  check("solving at the defaults takes well under a second", (() => { const t = Date.now(); M.solve({}); return Date.now() - t < 500; })());
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
