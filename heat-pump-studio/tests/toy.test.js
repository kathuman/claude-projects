// Heat Pump Studio toy heat pump checks — run with: node heat-pump-studio/tests/toy.test.js
// The build rules, energy conservation, the freezing plateau, the safety switches, and the trends the page teaches.
const Y = require("../src/toy.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }

// ---- building
const good = { top: "comp", bottom: "valve", left: "coilS", right: "coilL" };
let c = Y.check(good);
check("compressor on top, valve below: the right bucket gets hot", c.ok && c.hot === "right" && !c.reversed && c.uaHot === 20 && c.uaCold === 8);
c = Y.check({ top: "valve", bottom: "comp", left: "coilL", right: "coilS" });
check("swapped: the left bucket gets hot (reversible)", c.ok && c.hot === "left" && c.reversed && c.uaHot === 20 && c.uaCold === 8);
check("an empty place is reported", Y.check({ top: "comp", bottom: null, left: "coilS", right: "coilS" }).problems.includes("empty"));
check("a compressor in a bucket is reported", Y.check({ top: "valve", bottom: "coilS", left: "comp", right: "coilS" }).problems.includes("compInBucket"));
check("a coil in a pipe is reported", Y.check({ top: "comp", bottom: "coilS", left: "coilS", right: "coilL" }).problems.includes("coilInPipe"));
check("a water pump is reported", Y.check({ top: "pump", bottom: "valve", left: "coilS", right: "coilS" }).problems.includes("pump"));
check("a heater is reported", Y.check({ top: "comp", bottom: "heater", left: "coilS", right: "coilS" }).problems.includes("heater"));
check("a heater in a bucket is reported", Y.check({ top: "comp", bottom: "valve", left: "heater", right: "coilS" }).problems.includes("heaterInBucket"));
check("no compressor is reported", Y.check({ top: "valve", bottom: "valve", left: "coilS", right: "coilS" }).problems.includes("noComp"));

// ---- water and ice
const m = 5;
check("enthalpy and temperature round-trip", [-10, -1, 0.5, 20, 55].every((T) => Math.abs(Y.bucketT(Y.enthalpy(T, m), m).T - T) < 1e-9));
check("half frozen water is at 0 °C", (() => { const b = Y.bucketT(-m * 334000 / 2, m); return b.T === 0 && Math.abs(b.ice - 0.5) < 1e-9; })());

// ---- running
function sim(o, hours) {
  const r = Y.create(Object.assign({ fluid: "R134a", W: 80, uaHot: 20, uaCold: 20, litres: 5, Tstart: 20, Troom: 20, insulated: true, hot: "right" }, o));
  const H0 = r.Hh + r.Hc; let loss = 0, cop1 = null;
  for (let t = 0; t < hours * 3600; t += 5) {
    const Th = Y.bucketT(r.Hh, r.m).T, Tc = Y.bucketT(r.Hc, r.m).T;
    loss += r.uaLoss * ((Th - 20) + (Tc - 20)) * 5;
    Y.step(r, 5); if (cop1 === null) cop1 = r.now.cop;
  }
  return { r, H0, loss, cop1 };
}
let s = sim({}, 0.5);
const bal = s.r.Hh + s.r.Hc - s.H0 - (s.r.Ehot - s.r.Ecold) + s.loss;
check("energy is conserved: buckets gain what the coils give minus room losses", Math.abs(bal) < 1e-6 * s.r.Ehot, bal);
check("heat delivered = heat taken + compressor work (≤ electricity)", s.r.Ehot > s.r.Ecold && s.r.Ehot - s.r.Ecold <= s.r.Eel + 1e-6);
check("the hot bucket warms and the cold one cools", s.r.now.Th > 30 && s.r.now.Tc < 10, s.r.now.Th.toFixed(1) + " / " + s.r.now.Tc.toFixed(1));
check("COP starts between 2.5 and 6 and is below Carnot", s.cop1 > 2.5 && s.cop1 < 6 && s.r.now.cop < s.r.now.carnot, s.cop1.toFixed(2));
s = sim({ W: 40 }, 3);
const iceRun = s.r;
check("the cold bucket freezes and holds at 0 °C while it does", iceRun.events.some((e) => e.code === "ice") && iceRun.now.Tc === 0 && iceRun.now.ice > 0 && iceRun.now.ice < 1);
const cops = (o) => sim(o, 0.25).r.Ehot / sim(o, 0.25).r.Eel;
check("larger coils give a higher COP", cops({ uaHot: 20, uaCold: 20 }) > cops({ uaHot: 8, uaCold: 8 }));
check("a bigger compressor gives a lower COP", cops({ W: 120 }) < cops({ W: 40 }));
s = sim({ W: 120, uaHot: 8, uaCold: 8, insulated: false, fluid: "R290" }, 2);
check("a big compressor on small coils trips the high-pressure switch", s.r.trip === "high" && !s.r.on && s.r.events.some((e) => e.code === "tripHigh"));
const before = s.r.now.Th; for (let i = 0; i < 360; i++) Y.step(s.r, 5);
check("after a trip the open buckets drift back towards the room", s.r.now.Th < before && s.r.Eel === sim({ W: 120, uaHot: 8, uaCold: 8, insulated: false, fluid: "R290" }, 2).r.Eel);
check("every step stays finite", [iceRun.now.Th, iceRun.now.Tc, iceRun.now.cop, iceRun.Eel].every(Number.isFinite));

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
