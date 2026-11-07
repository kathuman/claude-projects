// Heat Pump Studio — the Learn page: worked examples computed live with the studio's own physics (src/), and the
// "keep the hill small" widget. Every user-visible message goes through T(english, vars).
(function () {
  "use strict";
  var I18 = window.HPSi18n, T = I18.T, fx = I18.fx, CY = window.HPScycle, SY = window.HPSsystem, SE = window.HPSseasonal, CL = window.HPS_CLIMATE;
  var $ = function (id) { return document.getElementById(id); };
  var n = function (v, d) { return fx(v, d); };
  var n0 = function (v) { return Math.round(v).toLocaleString(I18.locale); };
  var ex = function (id, html) { $(id).innerHTML = "<span class='ex-tag'>" + T("Worked example") + "</span>" + html; };

  // the example house: renovated, 150 m², Copenhagen design day −12 °C, indoor 20 °C; air source; radiators 45/38 °C
  var area = 150, u = 1.5, Tin = 20, Tout = -12, flow = 45, ret = 38;
  var H = area * u, load = H * (Tin - Tout) / 1000;
  var t = SY.temps({ srcIn: Tout, srcDT: 5, srcApproach: 6, flow: flow, condApproach: 3 });
  var c = CY.design({ fluid: "R290", Te: t.Te, Tc: t.Tc, SH: 5, SC: 3, etaIs: 0.70, etaEl: 0.90, Q: load, comp: "scroll", rps: 50 });
  var st = c.byId;

  ex("exFree", T("The heat pump we design below delivers {q} kW of heat on the coldest day, using {w} kW of electricity. The other {s} kW come from the outdoor air, for free.", { q: n(c.Q, 1), w: n(c.Wel, 2), s: n(c.Q - c.Wel, 2) }) +
    "<div class='calc'>COP = " + n(c.Q, 1) + " ÷ " + n(c.Wel, 2) + " = <b>" + n(c.cop, 2) + "</b></div>" +
    T("So every kWh of electricity gives {c} kWh of heat. An electric heater would give exactly 1.", { c: n(c.cop, 1) }));

  ex("exCarnot", T("Heating water at 45 °C, outdoor air at −5 °C:", {}) +
    "<div class='calc'>T<sub>hot</sub> = 45 + 273 = 318 K &nbsp; T<sub>cold</sub> = −5 + 273 = 268 K<br>COP<sub>max</sub> = 318 ÷ (318 − 268) = 318 ÷ 50 = <b>" + n(318 / 50, 1) + "</b></div>" +
    T("No heat pump, however perfect, can do better than that at these temperatures."));

  // ---- the widget: Carnot limit, a real heat pump, an electric heater
  function widget() {
    var to = +$("wOut").value, tf = +$("wFlow").value;
    $("wOutO").textContent = to + " °C"; $("wFlowO").textContent = tf + " °C";
    var carnot = (tf + 273.15) / (tf - to);
    var tt = SY.temps({ srcIn: to, srcDT: 5, srcApproach: 6, flow: tf, condApproach: 3 });
    var real = CY.design({ fluid: "R290", Te: tt.Te, Tc: tt.Tc, SH: 5, SC: 3, etaIs: 0.70, etaEl: 0.90, Q: 8, comp: "scroll", rps: 50 });
    var max = 12, bar = function (label, v, cls) {
      return "<div class='wbar'><span class='wl'>" + label + "</span><span class='wt'><i class='" + cls + "' style='width:" + Math.min(100, v / max * 100) + "%'></i></span><b>" + (isFinite(v) ? n(v, 1) : "—") + "</b></div>";
    };
    $("wBars").innerHTML = bar(T("Carnot limit"), carnot, "w-c") + bar(T("Real heat pump"), real.ok ? real.cop : NaN, "w-r") + bar(T("Electric heater"), 1, "w-e") +
      "<p class='wsum'>" + T("Hill: {d} degrees. A real heat pump reaches {p} % of the limit.", { d: n0(tf - to), p: real.ok ? n0(real.cop / carnot * 100) : "—" }) + "</p>";
  }
  ["wOut", "wFlow"].forEach(function (id) { $(id).addEventListener("input", widget); });
  widget();

  // ---- the design, step by step
  ex("ex1", T("Our house is renovated, so it loses about 1.5 W per m² of floor for every degree: H = 150 × 1.5 = {H} W/K. On the design day it is 20 °C inside and −12 °C outside:", { H: n0(H) }) +
    "<div class='calc'>Φ = " + n0(H) + " × (20 − (−12)) = " + n0(H) + " × 32 = " + n0(load * 1000) + " W = <b>" + n(load, 1) + " kW</b></div>" +
    T("That is the heat the heat pump must deliver on the coldest day (we leave hot water out to keep it simple)."));

  ex("ex2", T("The fan cools the outdoor air by 5 degrees as it passes the coil, and we leave a 6-degree gap; the radiator water leaves at 45 °C and we leave a 3-degree gap:") +
    "<div class='calc'>T<sub>evap</sub> = −12 − 5 − 6 = <b>" + n0(t.Te) + " °C</b> &nbsp;&nbsp; T<sub>cond</sub> = 45 + 3 = <b>" + n0(t.Tc) + " °C</b></div>" +
    T("So the refrigerant boils at {e} °C and condenses at {c} °C. Its pressure must change from {pe} bar to {pc} bar to make that happen.", { e: n0(t.Te), c: n0(t.Tc), pe: n(c.pe, 1), pc: n(c.pc, 1) }));

  var row = function (id, name) { var s = st[id]; return "<tr><td>" + id + "</td><td class='l'>" + name + "</td><td>" + n(s.T, 1) + " °C</td><td>" + n(s.p, 1) + " bar</td><td><b>" + n(s.h, 1) + "</b></td></tr>"; };
  ex("ex3", T("For propane (R290) in our heat pump:") +
    "<table class='mini'><thead><tr><th>" + T("Point") + "</th><th class='l'>" + T("Where") + "</th><th>T</th><th>p</th><th>h (kJ/kg)</th></tr></thead><tbody>" +
    row("1", T("into the compressor")) + row("2", T("out of the compressor")) + row("3", T("out of the condenser")) + row("4", T("out of the expansion valve")) + "</tbody></table>" +
    T("Point 4 has the same h as point 3: the valve changes the pressure but adds or removes no energy."));

  ex("ex4", "<div class='calc'>ṁ = " + n(c.Q, 1) + " ÷ (" + n(st["2"].h, 1) + " − " + n(st["3"].h, 1) + ") = " + n(c.Q, 1) + " ÷ " + n(c.qc, 1) + " = <b>" + n(c.m, 4) + " kg/s</b></div>" +
    T("About {g} grams of refrigerant every second.", { g: n0(c.m * 1000) }));

  ex("ex5", T("A perfect compressor would bring the gas to h₂ₛ = {hs} kJ/kg. Ours has η = 0.70:", { hs: n(st["2s"].h, 1) }) +
    "<div class='calc'>h<sub>2</sub> = " + n(st["1"].h, 1) + " + (" + n(st["2s"].h, 1) + " − " + n(st["1"].h, 1) + ") ÷ 0.70 = <b>" + n(st["2"].h, 1) + " kJ/kg</b><br>" +
    "W = " + n(c.m, 4) + " × (" + n(st["2"].h, 1) + " − " + n(st["1"].h, 1) + ") = <b>" + n(c.Wshaft, 2) + " kW</b></div>" +
    T("The motor and its electronics are about 90 % efficient, so the electricity is {w} ÷ 0.9 = {e} kW, and COP = {q} ÷ {e} = {cop}.", { w: n(c.Wshaft, 2), e: n(c.Wel, 2), q: n(c.Q, 1), cop: n(c.cop, 2) }));

  var cd = SY.condenser(c, ret, flow), cond = cd.zones.find(function (z) { return z.key === "cond"; });
  ex("ex6", T("In the condenser most of the heat, {q} kW, is given off while the refrigerant condenses. For a plate heat exchanger U is about 2,500 W/m²·K, and the mean gap there is {d} K:", { q: n(cond.Q, 2), d: n(cond.lmtd, 1) }) +
    "<div class='calc'>A = " + n0(cond.Q * 1000) + " ÷ (2,500 × " + n(cond.lmtd, 1) + ") = <b>" + n(cond.area, 2) + " m²</b></div>" +
    T("With the parts where the gas cools and the liquid cools further, the whole condenser needs {a} m² — about {p} small steel plates. The pinch is {k} K, so the design works.", { a: n(cd.area, 2), p: SY.plateHX(cd.area, cd.water.flow).plates, k: n(cd.pinch, 1) }));

  var v1 = 1 / st["1"].rho;
  ex("ex7", T("At the compressor inlet one kilogram of gas takes up {v} m³ — about {l} litres. With η_vol = {e} and 50 turns a second:", { v: n(v1, 3), l: n0(v1 * 1000), e: n(c.etaVol, 2) }) +
    "<div class='calc'>" + n(c.m, 4) + " × " + n(v1, 3) + " ÷ (" + n(c.etaVol, 2) + " × 50) = <b>" + n0(c.displacement) + " cm³</b> " + T("per turn") + "</div>" +
    T("Half a cup of gas per turn (a cup holds about 200 cm³) — that is the size of compressor to look for."));

  var yr = SE.run({ fluid: "R290", comp: "scroll", etaIs: 0.7, etaEl: 0.9, SH: 5, SC: 3, rps: 50, source: "air", srcIn: Tout, srcDT: 5, srcApp: 6,
    flow: flow, ret: ret, condApp: 3, compensation: true, Tdesign: Tout, load: load, coverage: 1, limit: 16, dhw: 0, aux: 0 }, CL.cities.Copenhagen);
  var el = yr.total.elHP + yr.total.elBackup;
  ex("ex8", T("Over a typical year in Copenhagen the house needs {h} kWh of heat, and the heat pump uses {e} kWh of electricity:", { h: n0(yr.total.heat), e: n0(el) }) +
    "<div class='calc'>SCOP = " + n0(yr.total.heat) + " ÷ " + n0(el) + " = <b>" + n(yr.scop, 2) + "</b></div>" +
    T("Much better than the {c} of the coldest day: most of the year is mild, and the radiators can run cooler then.", { c: n(c.cop, 2) }));

  var gas = yr.total.heat / 0.92;
  ex("ex9", "<div class='calc'>" + T("Heat pump") + ": " + n0(el) + " kWh × €0.30 = <b>€" + n0(el * 0.3) + "</b> · " + n(el * 0.2 / 1000, 2) + " t CO₂<br>" +
    T("Gas boiler") + ": " + n0(gas) + " kWh × €0.10 = <b>€" + n0(gas * 0.1) + "</b> · " + n(gas * 0.202 / 1000, 2) + " t CO₂</div>" +
    T("With electricity at €0.30 and gas at €0.10 per kWh, the heat pump saves about €{s} and {t} tonnes of CO₂ a year (grid 0.20 kg CO₂ per kWh, gas 0.202).", { s: n0(gas * 0.1 - el * 0.3), t: n((gas * 0.202 - el * 0.2) / 1000, 1) }));
})();
