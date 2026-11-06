// Heat Pump Studio property checks — run with: node heat-pump-studio/tests/props.test.js
// The interpolated tables against CoolProp itself (tests/reference.json, written by tools/build_props.py): saturation,
// superheated vapour, subcooled liquid, and the inverse lookups used by the cycle (Tsat(p), isentropic compression).
const P = require("../src/props.js");
const REF = require("./reference.json");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
function worst(list, f) { let w = 0, at = null; list.forEach((x) => { const e = f(x); if (e > w) { w = e; at = x; } }); return [w, at]; }

check("seven refrigerants", P.names().length === 7, P.names().join(", "));
for (const name of P.names()) {
  const F = P.fluid(name);
  const sat = REF.sat.filter((r) => r.fluid === name), vap = REF.vapour.filter((r) => r.fluid === name), liq = REF.liquid.filter((r) => r.fluid === name);
  let [e] = worst(sat, (r) => Math.abs(F.sat(r.T).p / r.p - 1));
  check(name + ": saturation pressure within 0.2 %", e < 0.002, (e * 100).toFixed(3) + " %");
  [e] = worst(sat, (r) => Math.max(Math.abs(F.sat(r.T).hl - r.hl), Math.abs(F.sat(r.T).hv - r.hv)));
  check(name + ": saturated enthalpies within 0.2 kJ/kg", e < 0.2, e.toFixed(3));
  [e] = worst(sat, (r) => Math.abs(F.sat(r.T).dv / r.dv - 1));
  check(name + ": saturated vapour density within 0.5 %", e < 0.005, (e * 100).toFixed(3) + " %");
  [e] = worst(sat, (r) => Math.abs(F.Tsat(r.p) - r.T));
  check(name + ": Tsat(p) inverts within 0.02 K", e < 0.02, e.toFixed(4));
  [e] = worst(vap, (r) => Math.abs(F.vapour(r.p, r.T).h - r.h));
  check(name + ": vapour enthalpy within 0.6 kJ/kg", e < 0.6, e.toFixed(3));
  [e] = worst(vap, (r) => Math.abs(F.vapour(r.p, r.T).s - r.s));
  check(name + ": vapour entropy within 0.002 kJ/kgK", e < 0.002, e.toFixed(5));
  [e] = worst(vap, (r) => Math.abs(F.vapour(r.p, r.T).v / r.v - 1));
  check(name + ": vapour specific volume within 1 %", e < 0.01, (e * 100).toFixed(3) + " %");
  [e] = worst(vap, (r) => Math.abs(F.vapourPS(r.p, r.s).T - r.T));
  check(name + ": isentropic lookup T(p, s) within 0.4 K", e < 0.4, e.toFixed(3));
  [e] = worst(vap, (r) => Math.abs(F.vapourPH(r.p, r.h).T - r.T));
  check(name + ": T(p, h) within 0.4 K", e < 0.4, e.toFixed(3));
  [e] = worst(liq, (r) => Math.abs(F.liquid(r.T, r.p).h - r.h));
  check(name + ": subcooled liquid enthalpy within 0.4 kJ/kg", e < 0.4, e.toFixed(3));
  check(name + ": Tmax is below the critical point", F.Tmax < F.Tcrit && F.Tcrit - F.Tmax < 1.6, F.Tmax + " / " + F.Tcrit);
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
