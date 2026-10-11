// Lag Lab model checks — run with: node lag-lab/tests/model.test.js
// The building blocks against their analytic responses (third-order delay, exponential smoothing); equilibrium,
// exact conservation of material and people; the new equilibrium after a step; the textbook stock-management
// results (Sterman ch. 17: ignoring the supply line oscillates, full accounting does not); the workforce results;
// scale invariance, non-negativity, the physical limits and numerical convergence.
const L = require("../src/model.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const STOCKS = ["backlog", "inventory", "supplyLine", "workforce", "trainees", "vacancies", "expectedDemand"];
const run = (p) => L.simulate(p);
const maxRelDev = (ys) => { const y0 = ys[0]; return Math.max(...ys.map((y) => Math.abs(y - y0) / Math.max(1, Math.abs(y0)))); };

// ---- parameters
check("defaults are valid", L.validate(L.merge({})).length === 0, L.validate(L.merge({})).join("; "));
check("validation catches a step too large for the fastest time constant", L.validate(L.merge({ dt: 1 })).some((e) => /dt/.test(e)));
check("validation catches an inventory target that cannot ship the demand", L.validate(L.merge({ inventoryCoverage: 0.5 })).some((e) => /inventoryCoverage/.test(e)));
check("validation catches weights outside [0, 1] and unknown policies", L.validate(L.merge({ wSL: 1.5, hiringDriver: "vibes" })).length === 2);
let threw = false; try { run({ TAI: -1 }); } catch (e) { threw = /TAI/.test(e.message); }
check("simulate refuses invalid parameters, saying which", threw);

// ---- demand
const dm = { base: 100, size: 0.2, at: 10, length: 4 };
check("demand: step, ramp, pulse and constant", L.demandAt(Object.assign({ type: "step" }, dm), 9.9) === 100 && L.demandAt(Object.assign({ type: "step" }, dm), 10) === 120 &&
  near(L.demandAt(Object.assign({ type: "ramp" }, dm), 12), 110, 1e-12) && L.demandAt(Object.assign({ type: "ramp" }, dm), 20) === 120 &&
  L.demandAt(Object.assign({ type: "pulse" }, dm), 13) === 120 && L.demandAt(Object.assign({ type: "pulse" }, dm), 14) === 100 && L.demandAt({ type: "constant", base: 7 }, 50) === 7);

// ---- third-order delay against its analytic step and impulse responses
{
  const tau = 6, dt = 0.001, st = [0, 0, 0]; let worst = 0, t = 0;
  for (let i = 0; i < 30 / dt; i++) {
    const out = L.delay3Step(st, 1, tau, dt); t += dt;
    const x = 3 * t / tau, exact = 1 - Math.exp(-x) * (1 + x + x * x / 2);
    worst = Math.max(worst, Math.abs(out - exact));
  }
  check("third-order delay: step response matches 1 − e^(−x)(1 + x + x²/2), x = 3t/τ", worst < 2e-3, worst.toExponential(2));
  const s2 = [1 / 0.001, 0, 0]; let m0 = 0, m1 = 0; t = 0;
  // an impulse of 1 unit (all in the first stage) — first moment of the outflow is the mean delay
  for (let i = 0; i < 80 / 0.001; i++) { const o = L.delay3Step(s2, 0, tau, 0.001); t += 0.001; m0 += o * 0.001; m1 += o * t * 0.001; }
  check("third-order delay: an impulse comes out whole, after a mean delay of τ", near(m0 * 0.001, 1, 1e-3) && near(m1 / m0, tau, 0.01), (m0 * 0.001).toFixed(4) + " units, mean " + (m1 / m0).toFixed(3));
}

// ---- exponential smoothing of demand
{
  const r = run({ dt: 0.01, forecastTime: 8, horizon: 40 });
  let worst = 0;
  r.t.forEach((t, i) => { if (t >= 10) worst = Math.max(worst, Math.abs(r.expectedDemand[i] - (120 - 20 * Math.exp(-(t - 10) / 8)))); });
  check("expected demand follows exponential smoothing: 120 − 20·e^(−(t−10)/8)", worst < 0.02, worst.toFixed(4));
  const rp = run({ forecast: "perfect" });
  check("perfect forecast: expected demand equals demand at every sample", rp.t.every((_, i) => rp.expectedDemand[i] === rp.demand[i]));
}

// ---- equilibrium: with constant demand nothing moves, for every policy combination
{
  let worst = 0, combos = 0;
  for (const hiringDriver of ["inventory", "capacity"]) for (const forecast of ["smooth", "perfect"]) for (const capacity of ["workforce", "unconstrained"]) for (const w of [0, 0.5, 1]) {
    const r = run({ demand: { type: "constant" }, hiringDriver, forecast, capacity, wSL: w, wV: w, horizon: 200 });
    STOCKS.forEach((k) => { worst = Math.max(worst, maxRelDev(r[k])); }); combos++;
  }
  check("equilibrium: constant demand leaves every stock unchanged (" + combos + " policy combinations)", worst < 1e-9, worst.toExponential(2));
  const r = run({ demand: { type: "constant" } });
  check("equilibrium: no layoffs, utilisation 1, hires replace attrition", r.layoffs.every((x) => x === 0) && r.utilisation.every((u) => near(u, 1, 1e-12)) && near(r.hires[0], r.attrition[0], 1e-12));
}

// ---- exact conservation
for (const p of [{}, { hiringDriver: "capacity", wSL: 1, wV: 1 }, { demand: { size: -0.4 } }, { wSL: 0, TAI: 2, demand: { size: 1 } }]) {
  const r = run(p), T = r.totals, i0 = r.initial, f = r.final, tag = JSON.stringify(p);
  check("material balance: ∫(starts − demand) = ΔSL + ΔI − ΔB  " + tag, near(T.starts - T.demand, (f.SL - i0.SL) + (f.I - i0.I) - (f.B - i0.B), 1e-7 * Math.max(1, T.demand)));
  check("backlog balance: ΔB = ∫demand − ∫shipments  " + tag, near(f.B - i0.B, T.demand - T.shipments, 1e-7 * T.demand));
  check("people balance: Δ(W + T) = ∫hires − ∫attrition − ∫layoffs  " + tag, near((f.W + f.T) - (i0.W + i0.T), T.hires - T.attrition - T.layoffs, 1e-9 * Math.max(1, T.hires)));
}

// ---- the new equilibrium after a +20% step
for (const p of [{}, { hiringDriver: "capacity", wSL: 1, wV: 1 }, { hiringDriver: "capacity", wSL: 1, wV: 1, forecast: "perfect" }]) {
  const r = run(Object.assign({ horizon: 400 }, p)), P = r.params, D1 = 120, f = r.final, E = f.W + P.rookieProductivity * f.T;
  check("after the step everything settles at the new equilibrium  " + JSON.stringify(p),
    near(f.I, P.inventoryCoverage * D1, 0.005 * f.I) && near(f.SL, P.productionLeadTime * D1, 0.005 * f.SL) && near(f.B, P.targetDeliveryDelay * D1, 0.005 * f.B) && near(E, D1 / P.productivity, 0.005 * E),
    "I " + f.I.toFixed(2) + " SL " + f.SL.toFixed(2) + " B " + f.B.toFixed(2) + " E " + E.toFixed(3));
}

// ---- textbook stock management (Sterman ch. 17): unconstrained capacity, perfect forecast
{
  const base = { capacity: "unconstrained", forecast: "perfect", TAI: 4, TASL: 4, horizon: 260 };
  const inv = (w) => { const r = run(Object.assign({}, base, { wSL: w })); return L.analyze(r.inventory, r.t, 10); };
  const full = inv(1), none = inv(0);
  check("supply line fully accounted (wSL = 1, TASL = TAI): inventory approaches its target without overshoot", full.overshoot < 0.01 && full.crossings === 0, (full.overshoot * 100).toFixed(2) + "%, " + full.crossings + " crossings");
  check("supply line ignored (wSL = 0): inventory overshoots and oscillates", none.overshoot > 0.3 && none.crossings >= 2, (none.overshoot * 100).toFixed(0) + "%, " + none.crossings + " crossings");
  const os = [0, 0.25, 0.5, 0.75, 1].map((w) => inv(w).overshoot);
  check("the more weight on the supply line, the less overshoot", os.every((v, i) => i === 0 || v <= os[i - 1] + 1e-9), os.map((v) => (v * 100).toFixed(1) + "%").join(" > "));
  const fast = (() => { const r = run(Object.assign({}, base, { wSL: 0, TAI: 2 })); return L.analyze(r.inventory, r.t, 10); })();
  check("supply line ignored: a more aggressive inventory adjustment (TAI 2) overshoots more", fast.overshoot > none.overshoot, (fast.overshoot * 100).toFixed(0) + "% vs " + (none.overshoot * 100).toFixed(0) + "%");
}

// ---- the workforce chain (ch. 19)
{
  const wf = (p) => { const r = run(Object.assign({ horizon: 260 }, p)); return L.analyze(r.effectiveWorkforce, r.t, 10); };
  const inv = wf({ hiringDriver: "inventory" }), cap = wf({ hiringDriver: "capacity" });
  check("hiring on the inventory gap overshoots the workforce more than hiring on the capacity gap", inv.overshoot > cap.overshoot, (inv.overshoot * 100).toFixed(0) + "% vs " + (cap.overshoot * 100).toFixed(0) + "%");
  const a = run({ wSL: 0, hiringDriver: "inventory" }), b = run({ wSL: 0, hiringDriver: "capacity" });
  check("with no weight on the supply line the two hiring drivers coincide (they differ only by the supply line)", a.t.every((_, i) => near(a.workforce[i], b.workforce[i], 1e-9)));
  // the size of the overshoot levels off beyond a moderate hiring delay; what keeps growing is how long it lasts
  for (const hiringDriver of ["inventory", "capacity"]) {
    const st = [2, 8, 16].map((h) => wf({ hiringDelay: h, hiringDriver }).settlingTime);
    check("longer hiring delays take longer to settle (" + hiringDriver + " driver)", st[0] < st[1] && st[1] < st[2], st.map((v) => v.toFixed(0) + " wk").join(" < "));
  }
  const short = wf({ hiringDelay: 2 }).overshoot, moderate = wf({ hiringDelay: 8 }).overshoot;
  check("a moderate hiring delay overshoots more than a short one", moderate > short, (moderate * 100).toFixed(0) + "% vs " + (short * 100).toFixed(0) + "%");
  const down = run({ demand: { size: -0.3 }, hiringDriver: "capacity", horizon: 120 });
  check("a step down brings layoffs and cancelled vacancies", Math.max(...down.layoffs) > 0 && Math.max(...down.vacancyCancellation) > 0);
}

// ---- physical limits
{
  const r = run({ demand: { size: 2 }, wSL: 0.2, horizon: 150 });
  const P = r.params;
  check("shipments never exceed what inventory allows", r.t.every((_, i) => r.shipments[i] <= r.inventory[i] / P.minProcessingTime + 1e-9));
  check("a large step outruns the inventory: shipments fall short and the backlog grows beyond its normal level", r.t.some((_, i) => r.shipments[i] < r.demand[i] - 1 && r.backlog[i] > P.targetDeliveryDelay * r.demand[i] + 1));
  check("utilisation stays within its band and starts never exceed capacity × uMax", r.t.every((_, i) => r.utilisation[i] >= P.uMin - 1e-12 && r.utilisation[i] <= P.uMax + 1e-12 && r.starts[i] <= r.capacity[i] * P.uMax + 1e-9));
  let neg = Infinity;
  for (const p of [{ demand: { size: -0.5 } }, { demand: { size: 1 }, wSL: 0, TAI: 1.5 }, { demand: { type: "pulse", size: 3, length: 2 } }]) {
    const rr = run(Object.assign({ horizon: 200 }, p));
    STOCKS.forEach((k) => { neg = Math.min(neg, Math.min(...rr[k])); });
  }
  check("no stock goes negative under large steps up and down and a demand spike", neg >= -1e-9, neg.toExponential(2));
}

// ---- scale invariance and numerical convergence
{
  const a = run({}), b = run({ demand: { base: 300 } });
  let worst = 0; STOCKS.forEach((k) => a[k].forEach((v, i) => { worst = Math.max(worst, Math.abs(b[k][i] - 3 * v) / Math.max(1, Math.abs(3 * v))); }));
  check("tripling demand triples every stock (the model has no hidden scale)", worst < 1e-9, worst.toExponential(2));
  const c1 = run({ dt: 0.0625 }), c2 = run({ dt: 0.03125 });
  let d = 0; c1.t.forEach((t, i) => { const j = c2.t.indexOf(t); if (j >= 0) d = Math.max(d, Math.abs(c1.inventory[i] - c2.inventory[j])); });
  check("halving the time step changes inventory by under 1% of the step's refill", d < 0.01 * 0.2 * 100 * 3 * 10, d.toFixed(3) + " units");
}

// ---- the response descriptor on a known signal
{
  const ts = [], ys = [];
  for (let t = 0; t <= 200; t += 0.1) { ts.push(t); ys.push(t < 10 ? 0 : 1 - Math.exp(-(t - 10) / 10) * Math.cos((t - 10) / 3)); }
  const a = L.analyze(ys, ts, 10);
  check("analyze: final value, overshoot of a damped oscillation, crossings and settling", near(a.final, 1, 1e-6) && a.overshoot > 0.4 && a.overshoot < 0.8 && a.crossings >= 2 && a.settlingTime > 30 && a.settlingTime < 50,
    "final " + a.final.toFixed(4) + ", overshoot " + (a.overshoot * 100).toFixed(1) + "%, " + a.crossings + " crossings, settles in " + a.settlingTime.toFixed(1));
  const m = L.analyze(ts.map((t) => (t < 10 ? 0 : 1 - Math.exp(-(t - 10) / 5))), ts, 10);
  check("analyze: a first-order rise has no overshoot and no crossings, settling ≈ 5·ln 50 ≈ 19.6", m.overshoot < 1e-9 && m.crossings === 0 && near(m.settlingTime, 19.6, 0.2), m.settlingTime.toFixed(2));
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
