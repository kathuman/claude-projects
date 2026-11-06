// Turbine Lab physics checks — run with: node turbine-lab/tests/physics.test.js
// Known answers for the power formulas, Euler's Pelton optimum, the efficiency curves, specific speeds of the three
// models, the selection chart on textbook sites, and the water-against-air ratios.
const P = require("../src/physics.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol) * Math.max(1, Math.abs(b));

// ---- power
check("hydro power: 1 m³/s through 100 m at 100 % is 981 kW", near(P.hydroPower(1, 100, 1), 981000));
check("hydro power scales with η", near(P.hydroPower(2, 50, 0.9), 0.9 * 1000 * 9.81 * 100));
check("kinetic power: ½ρAv³", near(P.kineticPower(2, 3, 1), 0.5 * 1000 * 3 * 8));
check("kinetic power in air uses air density", near(P.kineticPower(10, 1, 1, P.RHO_AIR), 0.5 * 1.225 * 1000));
check("disc area", near(P.discArea(2), Math.PI));
check("Betz limit is 16/27", near(P.BETZ, 0.5925925925925926));

// ---- Pelton
check("jet speed √(2gH) with Cv = 1", near(P.jetVelocity(100, 1), Math.sqrt(2 * 9.81 * 100)));
check("ideal bucket (k = 1, 180°) peaks at 100 % at u/c = ½", near(P.peltonEfficiency(0.5, 1, 180), 1));
check("ideal bucket: still or as fast as the jet gives nothing", P.peltonEfficiency(0, 1, 180) === 0 && P.peltonEfficiency(1, 1, 180) === 0);
let best = 0, bestX = 0; for (let i = 0; i <= 100; i++) { const e = P.peltonEfficiency(i / 100); if (e > best) { best = e; bestX = i / 100; } }
check("real bucket still peaks at u/c = ½", bestX === 0.5, bestX);
check("real bucket (k 0.9, 165°) is below 100 %", best < 1 && best > 0.9, best);
check("jet diameter carries the flow", near(Math.PI * Math.pow(P.jetDiameter(2, 100), 2) / 4 * 100, 2));

// ---- efficiency curves
for (const k of Object.keys(P.CURVES)) {
  check(k + ": efficiency is 0 at no load", P.efficiency(k, 0) === 0);
  check(k + ": table points are hit exactly", P.LOADS.every((q, i) => near(P.efficiency(k, q), P.CURVES[k][i])));
  check(k + ": never above 100 %", P.CURVES[k].every((v) => v > 0 && v < 1));
}
check("interpolation halfway between table points", near(P.efficiency("francis", 0.45), (0.75 + 0.83) / 2));
check("load above 1 is clamped", P.efficiency("kaplan", 1.4) === P.efficiency("kaplan", 1));
check("at 30 % load Pelton and Kaplan beat Francis, and Francis beats the propeller",
  P.efficiency("pelton", 0.3) > P.efficiency("francis", 0.3) && P.efficiency("kaplan", 0.3) > P.efficiency("francis", 0.3) && P.efficiency("francis", 0.3) > P.efficiency("propeller", 0.3));
check("unknown kind is an error", (() => { try { P.efficiency("banki", 0.5); return false; } catch (e) { return true; } })());

// ---- speeds and specific speed of the three models at their default settings
const M = require("../src/machines.js").MACHINES;
{ const p = M.pelton.water, c = P.jetVelocity(p.H), n = P.rpmFromTipSpeed(p.ux * c, p.D), Pw = P.hydroPower(p.Qrated, p.H, 0.9);
  const ns = P.specificSpeed(n, Pw / 1e3, p.H);
  check("Pelton model runs near 500 rpm (a synchronous speed)", Math.abs(n - 500) < 15, n.toFixed(0));
  check("Pelton model's Ns is in the Pelton band", P.nsKinds(ns).indexOf("pelton") >= 0, ns.toFixed(1)); }
{ const p = M.francis.water, n = P.francisRpm(p.H, p.D, p.ku), Pw = P.hydroPower(p.Qrated, p.H, 0.92);
  const ns = P.specificSpeed(n, Pw / 1e3, p.H);
  check("Francis model's Ns is in the Francis band", P.nsKinds(ns).indexOf("francis") >= 0, ns.toFixed(0)); }
check("rotor rpm from tip-speed ratio", near(P.rotorRpm(2, 2, 4), 4 * 2 / 1 * 60 / (2 * Math.PI)));
check("synchronous speeds on 50 Hz", P.synchronousRpm(520) === 500 && P.synchronousRpm(3000) === 3000 && near(P.synchronousRpm(160), 3000 / 19));

// ---- selection chart on textbook sites
const best1 = (Q, H) => (P.selectTurbine(Q, H)[0] || {}).kind;
check("1000 m head, 2 m³/s → Pelton", best1(2, 1000) === "pelton");
check("100 m head, 50 m³/s → Francis", best1(50, 100) === "francis");
check("5 m head, 100 m³/s → Kaplan", best1(100, 5) === "kaplan");
check("0.5 m head → no conventional turbine", P.selectTurbine(10, 0.5).length === 0);
check("200 m head, 5 m³/s: Pelton and Francis both fit", (() => { const k = P.selectTurbine(5, 200).map((r) => r.kind); return k.includes("pelton") && k.includes("francis"); })());
check("the three models' own sites are in their zones",
  P.selectTurbine(M.pelton.water.Qrated, M.pelton.water.H).some((r) => r.kind === "pelton") &&
  P.selectTurbine(M.francis.water.Qrated, M.francis.water.H).some((r) => r.kind === "francis"));

// ---- water against air
check("air is about 816× lighter than water", Math.round(P.RHO_WATER / P.RHO_AIR) === 816);
check("matching air speed is the cube-root ratio (≈ 9.3×)", near(P.matchingAirSpeed(1), Math.cbrt(1000 / 1.225)) && Math.abs(P.matchingAirSpeed(1) - 9.34) < 0.01);
check("same power at the matching speed", near(P.kineticPower(P.matchingAirSpeed(2), 1, 1, P.RHO_AIR), P.kineticPower(2, 1, 1), 1e-9));
check("10 m/s wind is about 6.2 mm of water", Math.abs(P.equivalentHead(10, P.RHO_AIR) * 1000 - 6.24) < 0.01);
check("water's own equivalent head is v²/2g", near(P.equivalentHead(3), 9 / (2 * 9.81)));

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
