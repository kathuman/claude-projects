// Heat Pump Studio — the toy heat pump (window.HPStoy in the browser, module.exports in Node): a small fridge-type
// compressor, an expansion valve and two copper coils, moving heat from one bucket of water to another.
//
//   check(slots)        slots = { top, bottom, left, right } with part ids (or null); says whether the loop works,
//                       which bucket gets hot, and if not, why (a reason code for each problem)
//   create(cfg)         a new run: cfg = { fluid, W (compressor electrical power, W), uaHot, uaCold (coil W/K),
//                       litres (each bucket), Tstart (°C), Troom (°C), insulated, hot: "left"|"right" }
//   step(run, dt)       advances the run by dt seconds; the buckets exchange heat with the coils and with the room
//   bucketT(H, m)       temperature and frozen fraction of a bucket of m kg of water with enthalpy H (J, 0 = water at 0 °C)
//
// The cycle at each moment comes from HPScycle.design: the condensing temperature sits above the hot bucket by
// Qhot/uaHot and the evaporating temperature below the cold bucket by Qcold/uaCold; the two are found by a few damped
// fixed-point iterations, warm-started from the previous step. The compressor's electrical power is held fixed.
(function (root) {
  "use strict";
  var CY = root.HPScycle || require("./cycle.js");

  var CP_W = 4186, CP_I = 2100, LAT = 334000;           // J/(kg·K) water and ice, J/kg to freeze
  var PARTS = {
    comp: { kind: "comp" }, valve: { kind: "valve" },
    coilS: { kind: "coil", ua: 8 }, coilL: { kind: "coil", ua: 20 },
    pump: { kind: "pump" }, heater: { kind: "heater" }
  };
  var INVENTORY = { comp: 1, valve: 1, coilS: 2, coilL: 2, pump: 1, heater: 1 };
  var TRIP_COND = 68, TRIP_EVAP = -28;                  // high- and low-pressure switches, as saturation temperatures

  function kind(id) { return id && PARTS[id] ? PARTS[id].kind : null; }

  // the compressor pushes clockwise: on the top pipe it pushes left → right, into the right coil; on the bottom pipe
  // right → left, into the left coil. The coil it pushes into is the condenser: that bucket gets hot.
  function check(s) {
    var problems = [], slots = ["top", "right", "bottom", "left"];
    if (slots.some(function (k) { return !s[k]; })) problems.push("empty");
    ["left", "right"].forEach(function (k) {
      var c = kind(s[k]);
      if (c && c !== "coil") problems.push(c === "comp" ? "compInBucket" : c === "valve" ? "valveInBucket" : c === "pump" ? "pumpInBucket" : "heaterInBucket");
    });
    ["top", "bottom"].forEach(function (k) {
      var c = kind(s[k]);
      if (c === "coil") problems.push("coilInPipe");
      if (c === "pump") problems.push("pump");
      if (c === "heater") problems.push("heater");
    });
    var pipes = [kind(s.top), kind(s.bottom)];
    if (pipes[0] && pipes[1] && pipes.indexOf("comp") >= 0 && pipes.indexOf("valve") < 0 && problems.indexOf("coilInPipe") < 0 && problems.indexOf("pump") < 0 && problems.indexOf("heater") < 0) problems.push("noValve");
    if (pipes[0] && pipes[1] && pipes.indexOf("comp") < 0 && problems.indexOf("pump") < 0 && problems.indexOf("heater") < 0 && problems.indexOf("coilInPipe") < 0) problems.push("noComp");
    if (problems.length) return { ok: false, problems: problems };
    var hot = kind(s.top) === "comp" ? "right" : "left", cold = hot === "right" ? "left" : "right";
    return { ok: true, problems: [], hot: hot, cold: cold, reversed: hot === "left", uaHot: PARTS[s[hot]].ua, uaCold: PARTS[s[cold]].ua };
  }

  function bucketT(H, m) {
    if (H >= 0) return { T: H / (m * CP_W), ice: 0 };
    if (H >= -m * LAT) return { T: 0, ice: -H / (m * LAT) };
    return { T: (H + m * LAT) / (m * CP_I), ice: 1 };
  }
  function enthalpy(T, m) { return T >= 0 ? m * CP_W * T : -m * LAT + m * CP_I * T; }

  function create(cfg) {
    var m = cfg.litres;                                 // 1 L of water ≈ 1 kg
    var r = {
      cfg: cfg, m: m, t: 0, on: true, trip: null,
      Hh: enthalpy(cfg.Tstart, m), Hc: enthalpy(cfg.Tstart, m),
      // heat lost to the room by each bucket: an open plastic bucket, or one in a foam box (scales with surface area)
      uaLoss: (cfg.insulated ? 0.35 : 2.2) * Math.pow(m / 5, 2 / 3),
      Tcond: cfg.Tstart + 15, Tevap: cfg.Tstart - 12,
      Eel: 0, Ehot: 0, Ecold: 0, events: [], now: null, iceSeen: false
    };
    r.now = solve(r);
    return r;
  }

  // the operating point for the present bucket temperatures
  function solve(r) {
    var c = r.cfg, Th = bucketT(r.Hh, r.m).T, Tc = bucketT(r.Hc, r.m).T;
    var res = null, Qh = 0, Qc = 0;
    for (var i = 0; i < 12; i++) {
      var Tcond = Math.max(r.Tcond, r.Tevap + 6);
      res = CY.design({ fluid: c.fluid, Te: r.Tevap, Tc: Tcond, SH: 4, SC: 2, etaIs: 0.55, etaEl: 0.80, Q: 0.2, comp: "rotary", rps: 50 });
      if (!res.ok) break;
      Qh = c.W * res.cop;                               // W into the hot bucket
      Qc = Qh * res.Qe / res.Q;                         // W out of the cold bucket (motor losses warm the room)
      var nc = Th + Qh / c.uaHot, ne = Tc - Qc / c.uaCold;
      r.Tcond += 0.6 * (nc - r.Tcond); r.Tevap += 0.6 * (ne - r.Tevap);
    }
    if (!res || !res.ok) return { ok: false, Th: Th, Tc: Tc, error: res ? res.error : "temps" };
    return { ok: true, Th: Th, Tc: Tc, Qhot: Qh, Qcold: Qc, W: c.W, cop: Qh / c.W, Tcond: r.Tcond, Tevap: r.Tevap,
      pc: res.pc, pe: res.pe, T2: res.T2, carnot: (Th + 273.15) / Math.max(0.5, Th - Tc), cycle: res };
  }

  function step(r, dt) {
    var c = r.cfg, n = r.on ? solve(r) : null;
    if (r.on && (!n.ok || n.Tcond > TRIP_COND || n.Tevap < TRIP_EVAP)) {
      r.on = false; r.trip = !n.ok || n.Tcond > TRIP_COND ? "high" : "low";
      r.events.push({ t: r.t, code: r.trip === "high" ? "tripHigh" : "tripLow" });
      n = null;
    }
    var Th = bucketT(r.Hh, r.m).T, Tc = bucketT(r.Hc, r.m).T;
    var Qh = n ? n.Qhot : 0, Qc = n ? n.Qcold : 0, W = n ? c.W : 0;
    r.Hh += (Qh - r.uaLoss * (Th - c.Troom)) * dt;
    r.Hc += (-Qc - r.uaLoss * (Tc - c.Troom)) * dt;
    r.Eel += W * dt; r.Ehot += Qh * dt; r.Ecold += Qc * dt; r.t += dt;
    var bc = bucketT(r.Hc, r.m);
    if (!r.iceSeen && bc.ice > 0) { r.iceSeen = true; r.events.push({ t: r.t, code: "ice" }); }
    if (bc.ice >= 1 && !r.frozen) { r.frozen = true; r.events.push({ t: r.t, code: "frozen" }); }
    r.now = n ? n : { ok: true, off: true, Th: bucketT(r.Hh, r.m).T, Tc: bc.T, Qhot: 0, Qcold: 0, W: 0, cop: 0, carnot: 0 };
    r.now.ice = bc.ice;
    return r;
  }

  root.HPStoy = { PARTS: PARTS, INVENTORY: INVENTORY, TRIP_COND: TRIP_COND, TRIP_EVAP: TRIP_EVAP, check: check, create: create, step: step, bucketT: bucketT, enthalpy: enthalpy };
  if (typeof module !== "undefined" && module.exports) module.exports = root.HPStoy;
})(typeof self !== "undefined" ? self : this);
