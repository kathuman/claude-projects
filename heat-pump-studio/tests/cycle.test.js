// Heat Pump Studio cycle and system checks — run with: node heat-pump-studio/tests/cycle.test.js
// The cycle against complete CoolProp reference cycles; the laws it must keep (energy balance, the Carnot limit,
// monotonic trends); and the system calculations on cases with known answers.
const C = require("../src/cycle.js"), S = require("../src/system.js"), P = require("../src/props.js");
const REF = require("./reference.json");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
function run(o) { return C.design(Object.assign({ SH: 5, SC: 3, etaIs: 0.7, etaEl: 1, Q: 10, comp: "scroll", rps: 50 }, o)); }

// ---- against CoolProp reference cycles
for (const r of REF.cycles) {
  const c = run({ fluid: r.fluid, Te: r.te, Tc: r.tc, SH: r.sh, SC: r.sc, etaIs: r.eta });
  const tag = `${r.fluid} ${r.te}/${r.tc} °C, SH ${r.sh}, SC ${r.sc}, η ${r.eta}`;
  check(tag + ": COP within 0.5 % of CoolProp", c.ok && Math.abs(c.copShaft / r.cop - 1) < 0.005, c.copShaft.toFixed(4) + " vs " + r.cop.toFixed(4));
  check(tag + ": discharge temperature within 0.5 K", near(c.T2, r.t2, 0.5), c.T2.toFixed(2) + " vs " + r.t2.toFixed(2));
  check(tag + ": pressures within 0.2 %", Math.abs(c.pe / r.pe - 1) < 0.002 && Math.abs(c.pc / r.pc - 1) < 0.002);
  check(tag + ": suction volume within 1 %", Math.abs(c.states[0].rho * r.v1 - 1) < 0.01);
}

// ---- laws
const base = run({ fluid: "R290", Te: -5, Tc: 45 });
check("energy balance: Q = Qe + W (shaft)", near(base.Q, base.Qe + base.Wshaft, 1e-9), (base.Qe + base.Wshaft).toFixed(6));
check("COP below the Carnot COP", base.copShaft < base.copCarnot, base.copShaft.toFixed(2) + " < " + base.copCarnot.toFixed(2));
check("Carnot COP of 45/-5 °C is 6.36", near(base.copCarnot, (45 + 273.15) / 50, 1e-9));
check("ideal cycle (η 1, no SH/SC) still below Carnot", (() => { const c = run({ fluid: "R290", Te: -5, Tc: 45, SH: 0, SC: 0, etaIs: 1 }); return c.copShaft < c.copCarnot; })());
check("mass flow delivers the heat: m · (h2 − h3) = Q", near(base.m * base.qc, base.Q, 1e-9));
check("electrical COP includes the drive efficiency", near(run({ fluid: "R290", Te: -5, Tc: 45, etaEl: 0.9 }).cop, base.copShaft * 0.9, 1e-9));
const trend = (key, vals, f) => vals.map((v) => run(f(v))[key]);
const copVsTc = trend("cop", [35, 45, 55], (t) => ({ fluid: "R32", Te: -5, Tc: t }));
check("COP falls as the flow temperature rises", copVsTc[0] > copVsTc[1] && copVsTc[1] > copVsTc[2], copVsTc.map((x) => x.toFixed(2)).join(" > "));
const copVsTe = trend("cop", [-15, -5, 5], (t) => ({ fluid: "R32", Te: t, Tc: 45 }));
check("COP rises with the source temperature", copVsTe[0] < copVsTe[1] && copVsTe[1] < copVsTe[2], copVsTe.map((x) => x.toFixed(2)).join(" < "));
const copVsEta = trend("cop", [0.6, 0.7, 0.8], (e) => ({ fluid: "R32", Te: -5, Tc: 45, etaIs: e }));
check("COP rises with compressor efficiency", copVsEta[0] < copVsEta[1] && copVsEta[1] < copVsEta[2]);
check("subcooling raises the COP", run({ fluid: "R290", Te: -5, Tc: 45, SC: 8 }).copShaft > run({ fluid: "R290", Te: -5, Tc: 45, SC: 0 }).copShaft);
check("R32 discharges hotter than R290 at the same conditions", run({ fluid: "R32", Te: -10, Tc: 55 }).T2 > run({ fluid: "R290", Te: -10, Tc: 55 }).T2 + 15);
check("R32 needs less displacement than R290 (higher volumetric capacity)", run({ fluid: "R32", Te: -5, Tc: 45 }).displacement < run({ fluid: "R290", Te: -5, Tc: 45 }).displacement);
check("refuses a condensing temperature near the critical point", !run({ fluid: "R410A", Te: 0, Tc: 70 }).ok && run({ fluid: "R410A", Te: 0, Tc: 70 }).error === "critical");
check("refuses Tc not above Te", !run({ fluid: "R290", Te: 20, Tc: 22 }).ok);
check("warns about a hot discharge", run({ fluid: "R32", Te: -20, Tc: 60 }).warnings.includes("discharge"));
check("warns about a high pressure ratio", run({ fluid: "R290", Te: -25, Tc: 60 }).warnings.includes("ratio"));
check("volumetric efficiency falls with pressure ratio", C.volumetricEfficiency("scroll", 3) > C.volumetricEfficiency("scroll", 6) && C.volumetricEfficiency("piston", 3) > C.volumetricEfficiency("piston", 6));
check("piston: 1 − c(PR^(1/n) − 1)", near(C.volumetricEfficiency("piston", 4), 1 - 0.04 * (Math.pow(4, 1 / 1.15) - 1), 1e-12));
check("displacement = suction volume / η_vol / speed", near(base.displacement, base.m / base.states[0].rho / base.etaVol / 50 * 1e6, 1e-6));

// ---- system
const L = S.heatLoad({ area: 150, level: "older", Tin: 20, Tout: -12, persons: 4 });
check("heat load: 150 m² × 2.2 W/m²K × 32 K = 10.56 kW", near(L.building, 10.56, 1e-9), L.building);
check("hot-water allowance 0.25 kW per person", near(L.dhw, 1.0, 1e-9));
const t = S.temps({ srcIn: -7, srcDT: 5, srcApproach: 6, flow: 35, condApproach: 3 });
check("temperatures: Te = source in − ΔT − approach, Tc = flow + approach", t.Te === -18 && t.Tc === 38 && t.srcOut === -12);
check("LMTD of equal differences is that difference", near(S.lmtd(5, 5), 5, 1e-12) && near(S.lmtd(10, 5), 5 / Math.log(2), 1e-12));
check("LMTD refuses a crossing (pinch below zero)", isNaN(S.lmtd(5, -1)));
const cyc = run({ fluid: "R290", Te: -12, Tc: 38, Q: 10 });
const cd = S.condenser(cyc, 30, 35);
check("condenser zones add up to the heat output", near(cd.zones.reduce((a, z) => a + z.Q, 0), 10, 1e-9));
check("condenser water heats from return to flow", near(cd.profile[3].sec, 35, 1e-9) && near(cd.profile[0].sec, 30, 1e-9));
check("condenser feasible with a positive pinch and area", cd.feasible && cd.pinch > 0 && cd.area > 0, cd.pinch.toFixed(2) + " K, " + cd.area.toFixed(2) + " m²");
check("condenser area = Σ Q/(U·LMTD)", near(cd.area, cd.zones.reduce((a, z) => a + z.Q * 1000 / (z.U * z.lmtd), 0), 1e-9));
const bad = S.condenser(run({ fluid: "R290", Te: -12, Tc: 38, Q: 10, SC: 8 }), 32, 35);   // liquid leaves at 30 °C, but the water comes back at 32 °C
check("condenser finds an internal pinch violation", !bad.feasible && bad.pinch < 0, bad.pinch.toFixed(2));
const ev = S.evaporator(cyc, -7, -12, "air");
check("evaporator zones add up to the heat from the source", near(ev.zones.reduce((a, z) => a + z.Q, 0), cyc.Qe, 1e-9));
check("air flow: Qe / (ρ · cp · ΔT)", near(ev.source.vdot, cyc.Qe / 5 / 1.006 / 1.25, 1e-9), (ev.source.vdot * 3600).toFixed(0) + " m³/h");
check("fan power: V·Δp/η", near(ev.source.aux, ev.source.vdot * 80 / 0.45 / 1000, 1e-12));
const bh = S.borehole(8, "normal", 100);
check("borehole: 8 kW at 60 W/m = 133 m in 2 holes of 100 m", near(bh.length, 133.33, 0.01) && bh.holes === 2);
const pp = S.pipes(cyc);
check("pipes: velocities below their limits", pp.suction.v <= 15 && pp.discharge.v <= 18 && pp.liquid.v <= 1.5, [pp.suction.od, pp.discharge.od, pp.liquid.od].join("/") + " mm");
check("pipes: the suction line is the largest", pp.suction.od >= pp.discharge.od && pp.discharge.od >= pp.liquid.od);
check("ammonia gets steel pipe", S.pipes(run({ fluid: "R717", Te: -5, Tc: 60, Q: 200, comp: "piston" })).suction.material === "steel");
check("charge limit R290, floor unit, 20 m²: 2.5·0.038^1.25·0.6·√20", near(S.chargeLimit(0.038, 20, "floor"), 2.5 * Math.pow(0.038, 1.25) * 0.6 * Math.sqrt(20), 1e-12), S.chargeLimit(0.038, 20, "floor").toFixed(3) + " kg");
check("non-flammable refrigerants have no room limit", S.chargeLimit(null, 20, "floor") === Infinity);
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
