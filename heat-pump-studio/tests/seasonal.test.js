// Heat Pump Studio seasonal checks — run with: node heat-pump-studio/tests/seasonal.test.js
const SE = require("../src/seasonal.js"), CL = require("../data/climate.js");
let pass = 0, fail = 0;
function check(n, c, d) { if (c) pass++; else fail++; if (!c || process.env.VERBOSE) console.log((c ? "ok   " : "FAIL ") + n + (d !== undefined ? "  → " + d : "")); }
const near = (a, b, t) => Math.abs(a - b) <= t;
for (const [name, c] of Object.entries(CL.cities)) check(name + ": about 8766 hours a year", near(c.hours.reduce((a, b) => a + b, 0), 8766, 30));
check("Copenhagen mean 9–11 °C", CL.cities.Copenhagen.mean > 9 && CL.cities.Copenhagen.mean < 11);
const base = { fluid: "R290", comp: "scroll", etaIs: 0.7, etaEl: 0.9, SH: 5, SC: 3, rps: 50, source: "air", srcIn: -12, srcDT: 5, srcApp: 6,
  flow: 45, ret: 38, condApp: 3, compensation: true, Tdesign: -12, load: 8, coverage: 1, limit: 16, dhw: 0, aux: 0.15 };
const r = SE.run(base, CL.cities.Copenhagen);
check("runs", r.ok);
check("each bin: heat = heat pump + backup", r.bins.every((b) => !b.ok || near(b.load, b.Qhp + b.Qbu, 1e-9)));
check("SCOP between 2 and 6", r.scop > 2 && r.scop < 6, r.scop.toFixed(2));
check("full coverage: heat pump covers > 98 %", r.hpShare > 0.98, (r.hpShare * 100).toFixed(1));
const half = SE.run(Object.assign({}, base, { coverage: 0.6 }), CL.cities.Copenhagen);
check("60 % coverage needs backup and has a balance point", half.total.elBackup > 0 && isFinite(half.balance), half.balance && half.balance.toFixed(1));
check("backup lowers the SCOP", half.scop < r.scop);
const nocomp = SE.run(Object.assign({}, base, { compensation: false }), CL.cities.Copenhagen);
check("weather compensation raises the SCOP", r.scop > nocomp.scop);
const sc = [[35, 30], [45, 38], [55, 45]].map(([f, rt]) => SE.run(Object.assign({}, base, { flow: f, ret: rt }), CL.cities.Copenhagen).scop);
check("SCOP falls as the flow temperature rises", sc[0] > sc[1] && sc[1] > sc[2], sc.map((x) => x.toFixed(2)).join(" > "));
const gr = SE.run(Object.assign({}, base, { source: "ground", srcIn: 0, srcDT: 3, srcApp: 3, flow: 35, ret: 30 }), CL.cities.Copenhagen);
check("ground source beats air at the same flow temperature", gr.scop > sc[0], gr.scop.toFixed(2));
check("SCOP in a realistic range for an R290 air unit at 35 °C (3.5–5.5)", sc[0] > 3.5 && sc[0] < 5.5);
check("cycling formula (EN 14825)", near(SE.cycling(4, 0.5, 0.9), 4 * 0.5 / (0.45 + 0.1), 1e-12));
check("defrost: 10 % at +1 °C, none at −10 or +10", near(SE.defrost(1), 0.9, 1e-12) && SE.defrost(-10) === 1 && SE.defrost(10) === 1);
check("compensation: design flow at full load", near(SE.compensated(45, 1), 45, 1e-12) && SE.compensated(45, 0.2) < 35);
const e = SE.economics(r, { elPrice: 0.3, gasPrice: 0.1, boilerEff: 0.9, co2El: 0.2, co2Gas: 0.202, extra: 5000 });
check("economics: boiler gas = heat / efficiency", near(e.boiler.gas, r.total.heat / 0.9, 1e-6));
check("payback = extra / saving", e.saving > 0 && near(e.payback, 5000 / e.saving, 1e-9), e.payback.toFixed(1) + " years");
console.log(pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
