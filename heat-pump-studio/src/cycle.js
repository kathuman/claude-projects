// Heat Pump Studio — the vapour-compression cycle (window.HPScycle in the browser, module.exports in Node).
// Single stage, subcritical: 1 compressor suction (superheated), 2 discharge, 3 condenser outlet (subcooled),
// 4 after the expansion valve. Pressure drops in pipes and heat exchangers are neglected.
//
//   design(o)  o = { fluid, Te, Tc (°C, evaporating and condensing), SH, SC (K, superheat and subcooling),
//                    etaIs (isentropic efficiency), etaEl (motor and drive), Q (kW heating), comp (compressor type),
//                    rps (compressor speed), etaVol (optional; otherwise from the compressor type and pressure ratio) }
//   returns the states, mass flow, powers, COP, Carnot COP, compressor displacement and warning codes.
(function (root) {
  "use strict";
  var PR = root.HPSprops || require("./props.js");

  // compressor types: typical isentropic efficiency, volumetric efficiency model, speed and size range (kW heating)
  var COMPRESSORS = {
    rotary: { etaIs: 0.65, vol: { a: 0.95, b: 0.015 }, rps: 50, range: [1, 10] },
    scroll: { etaIs: 0.70, vol: { a: 0.97, b: 0.012 }, rps: 50, range: [3, 100] },
    screw:  { etaIs: 0.72, vol: { a: 0.95, b: 0.008 }, rps: 50, range: [50, 5000] },
    piston: { etaIs: 0.75, vol: { clearance: 0.04, n: 1.15 }, rps: 24, range: [5, 2000] }
  };
  // volumetric efficiency: leakage falls off linearly with the pressure ratio (rotary, scroll, screw); re-expansion of
  // the clearance volume for a piston compressor, 1 − c·(PR^(1/n) − 1)
  function volumetricEfficiency(comp, ratio) {
    var c = COMPRESSORS[comp].vol;
    var e = c.clearance != null ? 1 - c.clearance * (Math.pow(ratio, 1 / c.n) - 1) : c.a - c.b * (ratio - 1);
    return Math.max(0.3, Math.min(1, e));
  }
  function carnot(Tc, Te) { return (Tc + 273.15) / (Tc - Te); }

  function design(o) {
    var F = PR.fluid(o.fluid), W = [];
    if (!(o.Tc > o.Te + 5)) return { ok: false, error: "temps" };
    if (o.Te < F.Tmin + 1) return { ok: false, error: "evapLow" };
    if (o.Tc > F.Tcrit - 4) return { ok: false, error: "critical" };
    // evaporating pressure at the dew point of Te, condensing pressure at the bubble point of Tc (same for pure fluids)
    var se = F.sat(o.Te), sc = F.sat(o.Tc), pe = se.pv, pc = sc.p;
    // 1 suction
    var s1 = o.SH > 0 ? F.vapour(pe, o.Te + o.SH) : { h: se.hv, s: se.sv, v: 1 / se.dv, T: o.Te };
    // 2 discharge: isentropic to pc, then the compressor's isentropic efficiency
    var s2s = F.vapourPS(pc, s1.s);
    var h2 = s1.h + (s2s.h - s1.h) / o.etaIs;
    var s2 = F.vapourPH(pc, h2);
    // 3 condenser outlet, subcooled liquid
    var s3 = o.SC > 0 ? F.liquid(o.Tc - o.SC, pc) : { h: sc.hl, s: sc.sl, d: sc.dl, T: o.Tc };
    // 4 after throttling at constant enthalpy
    var h4 = s3.h, x4 = (h4 - se.hl) / (se.hv - se.hl), sl4 = se.sl + x4 * (se.sv - se.sl);
    var qc = h2 - s3.h, qe = s1.h - h4, w = h2 - s1.h;
    var m = o.Q / qc;                                   // kg/s, with Q in kW and q in kJ/kg
    var Wshaft = m * w, Wel = Wshaft / o.etaEl, Qe = m * qe;
    var ratio = pc / pe;
    var etaVol = o.etaVol != null ? o.etaVol : volumetricEfficiency(o.comp, ratio);
    var Vsuc = m * s1.v;                                // m³/s actually drawn in
    var Vswept = Vsuc / etaVol;                         // m³/s swept by the compressor
    var cop = o.Q / Wel, copC = carnot(o.Tc, o.Te);
    var states = [
      { id: "1", p: pe, T: s1.T, h: s1.h, s: s1.s, rho: 1 / s1.v, x: null, phase: "vapour" },
      { id: "2s", p: pc, T: s2s.T, h: s2s.h, s: s1.s, rho: 1 / s2s.v, x: null, phase: "vapour" },
      { id: "2", p: pc, T: s2.T, h: h2, s: s2.s, rho: 1 / s2.v, x: null, phase: "vapour" },
      { id: "2v", p: pc, T: o.Tc, h: sc.hv, s: sc.sv, rho: sc.dv, x: 1, phase: "sat" },
      { id: "3l", p: pc, T: o.Tc, h: sc.hl, s: sc.sl, rho: sc.dl, x: 0, phase: "sat" },
      { id: "3", p: pc, T: s3.T, h: s3.h, s: s3.s, rho: s3.d, x: null, phase: "liquid" },
      { id: "4", p: pe, T: o.Te, h: h4, s: sl4, rho: 1 / ((1 - x4) / se.dl + x4 / se.dv), x: x4, phase: "two-phase" },
      { id: "1v", p: pe, T: o.Te, h: se.hv, s: se.sv, rho: se.dv, x: 1, phase: "sat" }
    ];
    if (s2.T > 120) W.push("discharge");
    if (ratio > 8) W.push("ratio");
    if (o.Tc > F.Tcrit - 12) W.push("nearCritical");
    if (pc > 42) W.push("pressure");
    if (x4 > 0.4) W.push("flash");
    if (o.Te < -30) W.push("evapCold");
    var range = COMPRESSORS[o.comp].range;
    if (o.Q < range[0] || o.Q > range[1]) W.push("compRange");
    return {
      ok: true, fluid: o.fluid, input: o, states: states, byId: states.reduce(function (a, s) { a[s.id] = s; return a; }, {}),
      pe: pe, pc: pc, ratio: ratio, Te: o.Te, Tc: o.Tc, T2: s2.T,
      qc: qc, qe: qe, w: w, m: m, Q: o.Q, Qe: Qe, Wshaft: Wshaft, Wel: Wel,
      cop: cop, copShaft: qc / w, copCarnot: copC, exergyEff: cop / copC,
      etaVol: etaVol, Vsuc: Vsuc, Vswept: Vswept, displacement: Vswept / o.rps * 1e6,   // cm³ per revolution
      vhc: qc / s1.v,                                   // volumetric heating capacity, kJ per m³ of suction gas
      flashGas: x4, warnings: W
    };
  }

  root.HPScycle = { design: design, COMPRESSORS: COMPRESSORS, volumetricEfficiency: volumetricEfficiency, carnot: carnot };
  if (typeof module !== "undefined" && module.exports) module.exports = root.HPScycle;
})(typeof self !== "undefined" ? self : this);
