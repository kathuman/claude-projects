// Heat Pump Studio — seasonal performance by the bin method (after EN 14825), window.HPSseasonal / module.exports.
//
// For each 1 K bin of outdoor temperature Tj (hours per year from data/climate.js) below the heating limit:
//   load       Pj = P_design · (T_limit − Tj) / (T_limit − T_design)                    (linear, EN 14825)
//   heating    with weather compensation, flow and return follow the emitter curve: T = T_room + (T_d − T_room)·PLR^(1/1.3)
//   source     air at Tj; ground, water and waste heat at their design temperature
//   capacity   the compressor at full speed: the design swept volume (sized so the design point covers `coverage` of
//              the load), η_vol and suction density at the bin's conditions; approaches scale with the heat flux
//   defrost    air sources lose up to 10 % of capacity and COP around +1 °C (between −7 and +9 °C)
//   part load  the inverter follows the load down to minSpeed of full capacity; below it, on/off cycling with
//              COP_bin = COP · CR / (Cd·CR + 1 − Cd)   (EN 14825; CR = load / minimum capacity, Cd = 0.9)
//   backup     an electric heater (COP 1) covers what the heat pump cannot
// SCOP = annual heat / annual electricity (compressor + backup); the system figure adds the fan or source pump.
(function (root) {
  "use strict";
  var CY = root.HPScycle || require("./cycle.js");
  var SY = root.HPSsystem || require("./system.js");

  var T_ROOM = 20, EMITTER_N = 1.3;
  function defrost(T) { return T >= -7 && T <= 9 ? 1 - 0.10 * Math.max(0, 1 - Math.abs(T - 1) / 8) : 1; }
  function cycling(cop, CR, Cd) { return cop * CR / (Cd * CR + 1 - Cd); }
  function compensated(Td, plr) { return T_ROOM + (Td - T_ROOM) * Math.pow(Math.max(0, Math.min(1, plr)), 1 / EMITTER_N); }

  // the cycle at given conditions, per kW: COP and the heat per m³ of swept volume at full speed
  function point(o, Tsrc, flow, scale) {
    var t = SY.temps({ srcIn: Tsrc, srcDT: o.srcDT * scale, srcApproach: o.srcApp * scale, flow: flow, condApproach: o.condApp * scale });
    var c = CY.design({ fluid: o.fluid, Te: t.Te, Tc: t.Tc, SH: o.SH, SC: o.SC, etaIs: o.etaIs, etaEl: o.etaEl, Q: 1, comp: o.comp, rps: o.rps });
    if (!c.ok) return null;
    return { cop: c.cop, perSwept: c.qc * c.etaVol * c.states[0].rho, Te: t.Te, Tc: t.Tc, cyc: c };   // kW per (m³/s)
  }

  function run(o, climate) {
    // o: fluid, comp, etaIs, etaEl, SH, SC, rps, source, srcIn, srcDT, srcApp, flow, ret, condApp, compensation,
    //    Tdesign, load (kW, building), coverage, limit (heating limit °C), minSpeed, Cd, dhw (kWh/yr), dhwFlow, aux (kW at design)
    var Cd = o.Cd != null ? o.Cd : 0.9, minSpeed = o.minSpeed != null ? o.minSpeed : 0.3, limit = o.limit != null ? o.limit : 16;
    var design = point(o, o.srcIn, o.flow, 1);
    if (!design) return { ok: false };
    var Qd = o.load * o.coverage;                              // capacity at the design point, full speed
    var Vs = Qd / design.perSwept;                             // m³/s swept
    var bins = [], tot = { heat: 0, hp: 0, elHP: 0, elBackup: 0, aux: 0, hours: 0, backupHours: 0 };
    for (var k = 0; k < climate.hours.length; k++) {
      var Tj = climate.tMin + k, h = climate.hours[k];
      if (Tj >= limit || h <= 0) continue;
      var plr = (limit - Tj) / (limit - o.Tdesign), Pj = o.load * plr;
      var flow = o.compensation ? Math.max(compensated(o.flow, plr), o.flowMin || 0) : o.flow;
      var Tsrc = o.source === "air" ? Tj : o.srcIn;
      var f = o.source === "air" ? defrost(Tj) : 1;
      // full-speed capacity, then the delivered heat; the approaches scale with how hard the heat exchangers work
      var full = point(o, Tsrc, flow, 1);
      if (!full) { bins.push({ T: Tj, h: h, load: Pj, ok: false }); continue; }
      var Qmax = Vs * full.perSwept * f;
      var Qhp = Math.min(Pj, Qmax), frac = Qmax > 0 ? Qhp / Qmax : 0;
      var pt = point(o, Tsrc, flow, 0.5 + 0.5 * frac) || full;          // temperature gaps shrink with the heat flux, half of them fixed
      var cop = pt.cop * f, Qmin = Qmax * minSpeed;
      if (Qhp < Qmin && Qmin > 0) cop = cycling(cop, Qhp / Qmin, Cd);
      var Qbu = Pj - Qhp, aux = (o.aux || 0) * (Qmax > 0 ? Qhp / Qd : 0);
      var b = { T: Tj, h: h, load: Pj, Qmax: Qmax, Qhp: Qhp, Qbu: Qbu, cop: cop, flow: flow, Te: pt.Te, Tc: pt.Tc, ok: true,
                eHeat: Pj * h, eHP: Qhp * h, eElHP: cop > 0 ? Qhp / cop * h : 0, eBackup: Qbu * h, eAux: aux * h };
      bins.push(b);
      tot.heat += b.eHeat; tot.hp += b.eHP; tot.elHP += b.eElHP; tot.elBackup += b.eBackup; tot.aux += b.eAux; tot.hours += h;
      if (Qbu > 1e-9) tot.backupHours += h;
    }
    // balance point: where the full-speed capacity meets the load (interpolated between bins)
    var balance = null;
    for (var i = 1; i < bins.length; i++) {
      var a = bins[i - 1], c = bins[i];
      if (!a.ok || !c.ok) continue;
      var da = a.Qmax - a.load, dc = c.Qmax - c.load;
      if (da < 0 && dc >= 0) { balance = a.T + (c.T - a.T) * (-da) / (dc - da); break; }
    }
    if (balance == null && bins.length && bins[0].ok && bins[0].Qmax >= bins[0].load) balance = -Infinity;   // never short
    // hot water: all year, at the hot-water flow temperature and the annual mean source temperature
    var dhw = null;
    if (o.dhw > 0) {
      var Tsrc2 = o.source === "air" ? climate.mean : o.srcIn, p2 = point(o, Tsrc2, o.dhwFlow || 55, 1);
      if (p2) dhw = { heat: o.dhw, cop: p2.cop, el: o.dhw / p2.cop };
    }
    var el = tot.elHP + tot.elBackup;
    return { ok: true, bins: bins, total: tot, Vs: Vs, Qd: Qd, balance: balance, dhw: dhw,
             scop: el > 0 ? tot.heat / el : NaN, scopSys: el + tot.aux > 0 ? tot.heat / (el + tot.aux) : NaN,
             hpShare: tot.heat > 0 ? tot.hp / tot.heat : NaN,
             maxBackup: bins.reduce(function (m, b) { return Math.max(m, b.Qbu || 0); }, 0) };
  }

  // running costs and CO₂ against a gas boiler, per year
  function economics(r, e) {
    // e: elPrice, gasPrice (per kWh), boilerEff, co2El, co2Gas (kg per kWh of electricity / of gas), extra (investment difference)
    var heat = r.total.heat + (r.dhw ? r.dhw.heat : 0);
    var el = r.total.elHP + r.total.elBackup + r.total.aux + (r.dhw ? r.dhw.el : 0);
    var gas = heat / e.boilerEff;
    var hp = { el: el, cost: el * e.elPrice, co2: el * e.co2El };
    var boiler = { gas: gas, cost: gas * e.gasPrice, co2: gas * e.co2Gas };
    var saving = boiler.cost - hp.cost;
    return { heat: heat, hp: hp, boiler: boiler, saving: saving, co2Saving: boiler.co2 - hp.co2,
             payback: e.extra > 0 && saving > 0 ? e.extra / saving : (e.extra > 0 ? Infinity : 0) };
  }

  root.HPSseasonal = { run: run, economics: economics, defrost: defrost, cycling: cycling, compensated: compensated, T_ROOM: T_ROOM };
  if (typeof module !== "undefined" && module.exports) module.exports = root.HPSseasonal;
})(typeof self !== "undefined" ? self : this);
