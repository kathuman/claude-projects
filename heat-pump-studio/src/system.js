// Heat Pump Studio — the system around the cycle (window.HPSsystem in the browser, module.exports in Node):
// the building's heat load, the heat source and the heating circuit, heat exchanger zones and areas, source-side
// flows, fan and pump power, borehole length, refrigerant pipe sizes, charge and the room charge limit.
// Units: kW, °C, K, m, kg; flows as noted.
(function (root) {
  "use strict";

  // ---- heat load: Φ = H · (T_indoor − T_design), H from floor area and the building's insulation level
  // (specific heat-loss coefficient per m² of floor, ventilation included; typical values)
  var LEVELS = {
    passive: { u: 0.5 }, new: { u: 1.0 }, renovated: { u: 1.5 }, older: { u: 2.2 }, poor: { u: 3.0 }
  };
  // approximate design outdoor temperatures (check the national annex of EN 12831 for a real design)
  var CITIES = [
    ["Copenhagen", -12], ["Aarhus", -12], ["Oslo", -20], ["Helsinki", -26], ["Berlin", -14], ["Munich", -16],
    ["Vienna", -13], ["Warsaw", -20], ["Paris", -7], ["London", -3], ["Milan", -5], ["Madrid", -4], ["Barcelona", 1],
    ["Santiago de Chile", -2], ["Buenos Aires", 0], ["Mexico City", 3], ["Bogotá", 5]
  ];
  function heatLoad(o) {
    var H = o.area * (o.u != null ? o.u : LEVELS[o.level].u);         // W/K
    var building = H * (o.Tin - o.Tout) / 1000;                       // kW
    var dhw = (o.persons || 0) * 0.25;                                // kW, rule of thumb per person for hot water
    return { H: H, building: building, dhw: dhw, total: building + dhw };
  }

  // ---- heat sources and the heating circuit
  var AIR = { cp: 1.006, rho: 1.25 }, WATER = { cp: 4.18, rho: 995 }, BRINE = { cp: 3.8, rho: 1040 };
  var SOURCES = {
    air:    { medium: AIR,   Tin: -7, dT: 5, approach: 6, U: { evap: 30, sh: 20 }, fan: { dp: 80, eta: 0.45 } },
    ground: { medium: BRINE, Tin: 0,  dT: 3, approach: 3, U: { evap: 1800, sh: 600 }, pump: { dp: 60, eta: 0.45 } },
    water:  { medium: WATER, Tin: 8,  dT: 4, approach: 3, U: { evap: 2000, sh: 600 }, pump: { dp: 80, eta: 0.45 } },
    waste:  { medium: WATER, Tin: 30, dT: 5, approach: 3, U: { evap: 2000, sh: 600 }, pump: { dp: 60, eta: 0.45 } }
  };
  // emitters: flow and return temperatures
  var SINKS = { floor: [35, 30], lowRad: [45, 38], radiator: [55, 45], hot: [65, 55], process: [80, 70] };
  var CONDENSER_U = { dsh: 800, cond: 2500, sc: 1500 };              // brazed-plate condenser, W/(m²·K)

  // evaporating and condensing temperatures from the source and the heating circuit
  function temps(o) {
    return { Te: o.srcIn - o.srcDT - o.srcApproach, Tc: o.flow + o.condApproach, srcOut: o.srcIn - o.srcDT };
  }

  function lmtd(a, b) {
    if (a <= 0 || b <= 0) return NaN;
    return Math.abs(a - b) < 1e-6 ? a : (a - b) / Math.log(a / b);
  }

  // condenser, counterflow, zone by zone. Water enters at the subcooling end and leaves at the desuperheating end.
  function condenser(cyc, Tret, Tflow, U) {
    U = U || CONDENSER_U;
    var st = cyc.byId, m = cyc.m;
    var Qsc = m * (st["3l"].h - st["3"].h), Qc = m * (st["2v"].h - st["3l"].h), Qd = m * (st["2"].h - st["2v"].h);
    var Cw = cyc.Q / (Tflow - Tret);                   // kW/K
    var w = [Tret, Tret + Qsc / Cw, Tret + (Qsc + Qc) / Cw, Tflow];
    var r = [st["3"].T, cyc.Tc, cyc.Tc, st["2"].T];
    var dts = r.map(function (x, i) { return x - w[i]; });
    var zones = [
      { key: "sc", Q: Qsc, U: U.sc, a: dts[0], b: dts[1] },
      { key: "cond", Q: Qc, U: U.cond, a: dts[1], b: dts[2] },
      { key: "dsh", Q: Qd, U: U.dsh, a: dts[2], b: dts[3] }
    ];
    var feasible = true, area = 0;
    zones.forEach(function (z) {
      z.lmtd = z.Q > 1e-9 ? lmtd(z.a, z.b) : 0;
      z.area = z.Q > 1e-9 ? z.Q * 1000 / (z.U * z.lmtd) : 0;
      if (z.Q > 1e-9 && !(z.lmtd > 0)) feasible = false; else area += z.area;
    });
    var Qs = [0, Qsc, Qsc + Qc, cyc.Q];
    return { zones: zones, area: feasible ? area : NaN, feasible: feasible, pinch: Math.min.apply(null, dts),
             water: { C: Cw, flow: Cw / WATER.cp / WATER.rho * 1000 },   // L/s
             profile: Qs.map(function (q, i) { return { Q: q, ref: r[i], sec: w[i] }; }) };
  }

  // evaporator, counterflow: the source enters at the superheating end and leaves at the two-phase inlet
  function evaporator(cyc, srcIn, srcOut, srcType) {
    var S = SOURCES[srcType], st = cyc.byId, m = cyc.m;
    var Qev = m * (st["1v"].h - st["4"].h), Qsh = m * (st["1"].h - st["1v"].h);
    var Cs = cyc.Qe / (srcIn - srcOut);
    var s = [srcOut, srcOut + Qev / Cs, srcIn];
    var r = [cyc.Te, cyc.Te, st["1"].T];
    var dts = s.map(function (x, i) { return x - r[i]; });
    var zones = [{ key: "evap", Q: Qev, U: S.U.evap, a: dts[0], b: dts[1] }, { key: "sh", Q: Qsh, U: S.U.sh, a: dts[1], b: dts[2] }];
    var feasible = true, area = 0;
    zones.forEach(function (z) {
      z.lmtd = z.Q > 1e-9 ? lmtd(z.a, z.b) : 0;
      z.area = z.Q > 1e-9 ? z.Q * 1000 / (z.U * z.lmtd) : 0;
      if (z.Q > 1e-9 && !(z.lmtd > 0)) feasible = false; else area += z.area;
    });
    var M = S.medium, mdot = Cs / M.cp, vdot = mdot / M.rho;           // kg/s, m³/s
    var aux = S.fan ? vdot * S.fan.dp / S.fan.eta / 1000 : vdot * S.pump.dp * 1000 / S.pump.eta / 1000;   // kW
    return { zones: zones, area: feasible ? area : NaN, feasible: feasible, pinch: Math.min.apply(null, dts),
             source: { C: Cs, mdot: mdot, vdot: vdot, aux: aux, kind: S.fan ? "fan" : "pump" },
             profile: [0, Qev, cyc.Qe].map(function (q, i) { return { Q: q, ref: r[i], sec: s[i] }; }) };
  }

  // borehole heat exchanger: specific heat extraction (W per metre of borehole), guide values after VDI 4640 for
  // about 1800 heating hours a year
  var GROUND = { poor: 25, normal: 60, rock: 84 };
  function borehole(Qe, ground, depth) {
    var L = Qe * 1000 / GROUND[ground], d = depth || 100;
    return { length: L, holes: Math.max(1, Math.ceil(L / d - 1e-9)), depth: d, specific: GROUND[ground] };
  }

  // ---- refrigerant pipes: the smallest standard tube that keeps the velocity below the limit for that line
  var COPPER = [[6, 1], [8, 1], [10, 1], [12, 1], [15, 1], [18, 1], [22, 1], [28, 1], [35, 1.5], [42, 1.5], [54, 2], [64, 2], [76.1, 2], [88.9, 2], [108, 2.5]];
  var STEEL = [[21.3, 2.6, "DN15"], [26.9, 2.6, "DN20"], [33.7, 3.2, "DN25"], [42.4, 3.2, "DN32"], [48.3, 3.2, "DN40"], [60.3, 3.6, "DN50"], [76.1, 3.6, "DN65"],
               [88.9, 4, "DN80"], [114.3, 4.5, "DN100"], [139.7, 4.5, "DN125"], [168.3, 5, "DN150"], [219.1, 6.3, "DN200"], [273, 6.3, "DN250"], [323.9, 7.1, "DN300"]];
  var LINES = { suction: { vmax: 15, ideal: 10 }, discharge: { vmax: 18, ideal: 12 }, liquid: { vmax: 1.5, ideal: 0.8 } };
  function pipes(cyc) {
    var st = cyc.byId, steel = cyc.fluid === "R717";      // ammonia attacks copper: steel pipe only
    var table = steel ? STEEL : COPPER;
    var rho = { suction: st["1"].rho, discharge: st["2"].rho, liquid: st["3"].rho };
    var out = {};
    Object.keys(LINES).forEach(function (k) {
      var L = LINES[k], pick = null;
      for (var i = 0; i < table.length; i++) {
        var id = (table[i][0] - 2 * table[i][1]) / 1000, v = cyc.m / rho[k] / (Math.PI * id * id / 4);
        if (v <= L.vmax) { pick = { od: table[i][0], wall: table[i][1], dn: table[i][2] || null, id: id * 1000, v: v }; break; }
      }
      if (!pick) { var t = table[table.length - 1], id2 = (t[0] - 2 * t[1]) / 1000; pick = { od: t[0], wall: t[1], dn: t[2] || null, id: id2 * 1000, v: cyc.m / rho[k] / (Math.PI * id2 * id2 / 4), tooSmall: true }; }
      pick.material = steel ? "steel" : "copper";
      pick.idIdeal = Math.sqrt(4 * cyc.m / rho[k] / (Math.PI * L.ideal)) * 1000;
      out[k] = pick;
    });
    return out;
  }

  // ---- charge: internal volume per kW from typical designs (finned air coils hold more than plate heat exchangers),
  // a fifth of it liquid; a rough estimate (±50 %)
  function charge(cyc, srcType) {
    var st = cyc.byId, vol = cyc.Q * (srcType === "air" ? 1.0 : 0.5) / 1000;   // m³
    var rl = st["3l"].rho, rv = st["1v"].rho;
    return { volume: vol * 1000, mass: vol * (0.2 * rl + 0.8 * rv) };
  }
  // maximum charge in a room for a flammable refrigerant, m_max = 2.5 · LFL^1.25 · h0 · √A (the formula of
  // IEC 60335-2-40 and EN 378 for an unventilated room); h0 by how the indoor unit is mounted
  var MOUNT = { floor: 0.6, wall: 1.8, ceiling: 2.2 };
  function chargeLimit(lfl, area, mounting) {
    if (!lfl) return Infinity;
    return 2.5 * Math.pow(lfl, 1.25) * MOUNT[mounting] * Math.sqrt(area);
  }

  root.HPSsystem = { LEVELS: LEVELS, CITIES: CITIES, SOURCES: SOURCES, SINKS: SINKS, CONDENSER_U: CONDENSER_U, GROUND: GROUND, MOUNT: MOUNT,
    COPPER: COPPER, STEEL: STEEL, LINES: LINES, AIR: AIR, WATER: WATER, BRINE: BRINE,
    heatLoad: heatLoad, temps: temps, lmtd: lmtd, condenser: condenser, evaporator: evaporator, borehole: borehole,
    pipes: pipes, charge: charge, chargeLimit: chargeLimit };
  if (typeof module !== "undefined" && module.exports) module.exports = root.HPSsystem;
})(typeof self !== "undefined" ? self : this);
