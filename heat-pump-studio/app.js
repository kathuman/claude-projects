// Heat Pump Studio — the page. Physics in src/ (HPSprops, HPScycle, HPSsystem), languages in i18n.js (HPSi18n).
// Every user-visible message goes through T(english, vars).
(function () {
  "use strict";
  var VERSION = "1.3.1";
  var I18 = window.HPSi18n, T = I18.T, fx = I18.fx, PR = window.HPSprops, CY = window.HPScycle, SY = window.HPSsystem, SE = window.HPSseasonal, CL = window.HPS_CLIMATE;
  var $ = function (id) { return document.getElementById(id); };
  $("ver").textContent = "v" + VERSION;

  // ------------------------------------------------------------------ numbers
  function dig(v, sig) { if (!isFinite(v) || v === 0) return 0; return Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(v)))); }
  function num(v, sig) { if (!isFinite(v)) return "—"; sig = sig || 3; return fx(v, Math.min(3, dig(v, sig))); }
  function n1(v) { return isFinite(v) ? fx(v, 1) : "—"; }
  function n0(v) { return isFinite(v) ? Math.round(v).toLocaleString(I18.locale) : "—"; }
  function kw(v) { return Math.abs(v) >= 1000 ? num(v / 1000, 3) + " MW" : num(v, 3) + " kW"; }
  function pct(v) { return fx(v * 100, 0) + " %"; }

  // ------------------------------------------------------------------ state
  var DEFAULTS = {
    loadMode: "calc", city: "Copenhagen", Tout: -12, Tin: 20, area: 150, persons: 4, level: "renovated", load: 10,
    source: "air", srcIn: -12, linkAir: true, srcDT: 5, srcApp: 6, ground: "normal", depth: 100,
    sink: "lowRad", flow: 45, ret: 38, condApp: 3,
    fluid: "R290", comp: "scroll", etaIs: 0.70, etaEl: 0.90, SH: 5, SC: 3, rps: 50,
    install: "outdoor", room: 20, mount: "floor", tab: "plant",
    climate: "auto", coverage: 100, limit: 16, compensation: true, dhw: 3600, dhwFlow: 55,
    elPrice: 0.30, gasPrice: 0.10, boiler: 0.92, co2El: 0.20, extra: 6000, currency: "€"
  };
  var S = Object.assign({}, DEFAULTS);
  try {
    var m = /[#&]s=([^&]+)/.exec(location.hash);
    if (m) Object.assign(S, JSON.parse(decodeURIComponent(atob(m[1]))));
  } catch (e) { /* a broken link: keep the defaults */ }

  // ------------------------------------------------------------------ inputs
  var CITY = {}; SY.CITIES.forEach(function (c) { CITY[c[0]] = c[1]; });
  $("inCity").innerHTML = SY.CITIES.map(function (c) { return "<option value='" + c[0] + "'>" + c[0] + " (" + c[1] + " °C)</option>"; }).join("") +
    "<option value='custom'>" + T("Other (enter the temperature)") + "</option>";
  $("inFluid").innerHTML = PR.names().map(function (n) {
    var d = PR.fluid(n).info; return "<option value='" + n + "'>" + n + " — " + d.safety + ", GWP " + d.gwp + "</option>";
  }).join("");

  var NUMS = { inTout: "Tout", inTout2: "Tout", inTin: "Tin", inArea: "area", inPersons: "persons", inLoad: "load", inSrcIn: "srcIn", inSrcDT: "srcDT",
    inSrcApp: "srcApp", inDepth: "depth", inFlow: "flow", inRet: "ret", inCondApp: "condApp", inEtaIs: "etaIs", inEtaEl: "etaEl", inSH: "SH", inSC: "SC",
    inRps: "rps", inRoom: "room", inCoverage: "coverage", inLimit: "limit", inDhw: "dhw", inDhwFlow: "dhwFlow",
    inElPrice: "elPrice", inGasPrice: "gasPrice", inBoiler: "boiler", inCo2El: "co2El", inExtra: "extra" };
  var SELS = { inCity: "city", inLevel: "level", inGround: "ground", inSink: "sink", inFluid: "fluid", inComp: "comp", inMount: "mount", inClimate: "climate" };
  $("inClimate").innerHTML = "<option value='auto'>" + T("Follow the location") + "</option>" +
    Object.keys(CL.cities).map(function (c) { return "<option value='" + c + "'>" + c + " (" + T("mean {t} °C", { t: fx(CL.cities[c].mean, 1) }) + ")</option>"; }).join("");
  Object.keys(NUMS).forEach(function (id) {
    $(id).addEventListener("input", function () {
      var v = parseFloat($(id).value); if (!isFinite(v)) return;
      S[NUMS[id]] = v;
      if (id === "inTout" || id === "inTout2") S.city = CITY[S.city] === v ? S.city : "custom";
      if ((id === "inFlow" || id === "inRet") && S.sink !== "custom") S.sink = "custom";
      if (id === "inSrcIn" && S.source === "air") S.linkAir = false;
      sync(); update();
    });
  });
  Object.keys(SELS).forEach(function (id) {
    $(id).addEventListener("change", function () {
      var k = SELS[id], v = $(id).value; S[k] = v;
      if (k === "city" && v !== "custom") S.Tout = CITY[v];
      if (k === "sink" && SY.SINKS[v]) { S.flow = SY.SINKS[v][0]; S.ret = SY.SINKS[v][1]; }
      if (k === "comp") { S.etaIs = CY.COMPRESSORS[v].etaIs; S.rps = CY.COMPRESSORS[v].rps; }
      sync(); update();
    });
  });
  function seg(id, key, after) {
    $(id).addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      S[key] = b.dataset.v; if (after) after(b.dataset.v); sync(); update();
    });
  }
  seg("segLoad", "loadMode");
  seg("segSource", "source", function (v) {
    var d = SY.SOURCES[v]; S.srcDT = d.dT; S.srcApp = d.approach;
    if (v === "air") S.linkAir = true; else S.srcIn = d.Tin;
  });
  seg("segInstall", "install", function (v) { if (S.fluid === "R717" && v !== "plant") { /* the alert explains */ } });
  $("inLinkAir").addEventListener("change", function () { S.linkAir = $("inLinkAir").checked; sync(); update(); });
  $("inComp2").addEventListener("change", function () { S.compensation = $("inComp2").checked; sync(); update(); });
  $("inCurrency").addEventListener("input", function () { S.currency = $("inCurrency").value; sync(); update(); });
  $("btnReset").addEventListener("click", function () { S = Object.assign({}, DEFAULTS); sync(); update(); });
  $("btnLink").addEventListener("click", function () {
    var done = function () { $("btnLink").textContent = T("Link copied"); setTimeout(function () { $("btnLink").textContent = T("Copy link"); }, 1600); };
    try { navigator.clipboard.writeText(location.href).then(done, done); } catch (e) { done(); }
  });
  function press(id, v) { $(id).querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === v)); }); }
  function sync() {
    press("segLoad", S.loadMode); press("segSource", S.source); press("segInstall", S.install);
    $("loadCalc").hidden = S.loadMode !== "calc"; $("loadDirect").hidden = S.loadMode !== "direct";
    var set = function (id, v) { if (document.activeElement !== $(id)) $(id).value = v; };
    Object.keys(NUMS).forEach(function (id) { set(id, S[NUMS[id]]); });
    Object.keys(SELS).forEach(function (id) { set(id, S[SELS[id]]); });
    if (S.source === "air" && S.linkAir) set("inSrcIn", S.Tout);
    $("inLinkAir").checked = !!S.linkAir;
    $("inComp2").checked = !!S.compensation;
    set("inCurrency", S.currency);
    $("rowLinkAir").hidden = S.source !== "air";
    $("groundRow").hidden = S.source !== "ground";
    $("roomRow").hidden = S.install !== "indoor";
    $("lblSrcIn").textContent = S.source === "air" ? T("Outdoor air") : S.source === "ground" ? T("Brine from the ground") : S.source === "water" ? T("Ground or lake water") : T("Waste heat water");
    $("sourceHint").textContent = {
      air: T("An air-source heat pump takes heat from outdoor air with a finned coil and a fan. Cheapest to install; its output and COP fall as the outdoor air gets colder."),
      ground: T("A brine circuit in boreholes collects heat from the ground, which stays at 5–10 °C all year. Higher, steadier COP; drilling costs more."),
      water: T("Groundwater or lake water through a plate heat exchanger. Very good COP where water is available and permitted."),
      waste: T("Heat recovered from cooling water, sewage, data centres or industrial processes. High source temperatures give excellent COP.")
    }[S.source];
    var d = PR.fluid(S.fluid).info;
    $("fluidHint").innerHTML = "<span class='tag " + d.safety + "'>" + d.safety + "</span> GWP " + d.gwp + " · " + T("critical point {T} °C", { T: n1(d.Tcrit) }) + "<br>" + esc(fluidNote(S.fluid));
    try { history.replaceState(null, "", location.pathname + location.search + "#s=" + btoa(encodeURIComponent(JSON.stringify(S)))); } catch (e) { /* file: */ }
  }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  function fluidNote(f) {
    return {
      "R290": T("Propane. Natural refrigerant, excellent efficiency; highly flammable, so the charge is limited."),
      "R32": T("Common in new split units; mildly flammable; high discharge temperatures."),
      "R410A": T("Former standard for air-to-water units; high GWP, being phased down."),
      "R134a": T("Medium pressure; used for higher flow temperatures; high GWP."),
      "R1234yf": T("Low-GWP HFO, similar pressures to R134a; mildly flammable."),
      "R1234ze(E)": T("Low-GWP HFO for chillers and large heat pumps; low pressures."),
      "R717": T("Ammonia. Industrial heat pumps; excellent thermodynamics; toxic, so plant-room only.")
    }[f] || "";
  }

  // ------------------------------------------------------------------ the design
  var R = null;
  function compute() {
    var load = S.loadMode === "calc" ? SY.heatLoad({ area: S.area, level: S.level, Tin: S.Tin, Tout: S.Tout, persons: S.persons })
      : { total: S.load, building: S.load, dhw: 0 };
    var srcIn = S.source === "air" && S.linkAir ? S.Tout : S.srcIn;
    var t = SY.temps({ srcIn: srcIn, srcDT: S.srcDT, srcApproach: S.srcApp, flow: S.flow, condApproach: S.condApp });
    var o = { fluid: S.fluid, Te: t.Te, Tc: t.Tc, SH: S.SH, SC: S.SC, etaIs: S.etaIs, etaEl: S.etaEl, Q: load.total, comp: S.comp, rps: S.rps };
    var cyc = CY.design(o);
    var r = { load: load, srcIn: srcIn, srcOut: t.srcOut, Te: t.Te, Tc: t.Tc, cyc: cyc, o: o };
    if (cyc.ok) {
      r.cond = SY.condenser(cyc, S.ret, S.flow);
      r.evap = SY.evaporator(cyc, srcIn, t.srcOut, S.source);
      r.pipes = SY.pipes(cyc);
      r.charge = SY.charge(cyc, S.source);
      var info = PR.fluid(S.fluid).info;
      r.limit = S.install === "indoor" ? SY.chargeLimit(info.lfl, S.room, S.mount) : Infinity;
      r.bore = S.source === "ground" ? SY.borehole(cyc.Qe, S.ground, S.depth) : null;
      r.copSys = cyc.Q / (cyc.Wel + r.evap.source.aux);
      r.climateName = S.climate !== "auto" ? S.climate : (CL.cities[S.city] ? S.city : "Copenhagen");
      r.year = SE.run({ fluid: S.fluid, comp: S.comp, etaIs: S.etaIs, etaEl: S.etaEl, SH: S.SH, SC: S.SC, rps: S.rps, source: S.source,
        srcIn: srcIn, srcDT: S.srcDT, srcApp: S.srcApp, flow: S.flow, ret: S.ret, condApp: S.condApp, compensation: S.compensation,
        Tdesign: S.Tout, load: load.building, coverage: S.coverage / 100, limit: S.limit, dhw: S.dhw, dhwFlow: S.dhwFlow,
        aux: r.evap.source.aux }, CL.cities[r.climateName]);
      if (r.year.ok) r.econ = SE.economics(r.year, { elPrice: S.elPrice, gasPrice: S.gasPrice, boilerEff: S.boiler, co2El: S.co2El, co2Gas: 0.202, extra: S.extra });
    }
    return r;
  }

  // ------------------------------------------------------------------ results
  function kpi(label, value, unit, sub, hero) {
    return "<div class='kpi" + (hero ? " hero" : "") + "'><div class='k'>" + label + "</div><div class='v'>" + value + (unit ? "<small>" + unit + "</small>" : "") + "</div>" + (sub ? "<div class='s'>" + sub + "</div>" : "") + "</div>";
  }
  function renderKpis() {
    var c = R.cyc, h = "";
    h += kpi(T("Heat load"), num(R.load.total, 3), "kW", S.loadMode === "calc" ? T("building {b} + hot water {d}", { b: num(R.load.building, 3), d: num(R.load.dhw, 2) }) : T("as entered"));
    if (!c.ok) { $("kpis").innerHTML = h; return; }
    h += kpi("COP", fx(c.cop, 2), "", T("Carnot {c} · {p} of it", { c: fx(c.copCarnot, 2), p: pct(c.exergyEff) }), true);
    if (R.year && R.year.ok) h += kpi("SCOP", fx(R.year.scop, 2), "", T("seasonal, {c}", { c: R.climateName }), true);
    h += kpi(T("Electrical input"), num(c.Wel, 3), "kW", T("compressor, incl. drive"));
    h += kpi(T("System COP"), fx(R.copSys, 2), "", T("with {what} {p} kW", { what: R.evap.source.kind === "fan" ? T("fan") : T("source pump"), p: num(R.evap.source.aux, 2) }));
    h += kpi(T("Heat from the source"), num(c.Qe, 3), "kW", T("{t} → {u} °C", { t: n1(R.srcIn), u: n1(R.srcOut) }));
    h += kpi(T("Evaporating / condensing"), fx(c.Te, 0) + " / " + fx(c.Tc, 0), "°C", T("{a} / {b} bar", { a: num(c.pe, 3), b: num(c.pc, 3) }));
    h += kpi(T("Discharge temperature"), n1(c.T2), "°C", T("pressure ratio {r}", { r: fx(c.ratio, 2) }));
    h += kpi(T("Refrigerant flow"), c.m < 1 ? num(c.m * 1000, 3) : num(c.m, 3), c.m < 1 ? "g/s" : "kg/s", T("displacement {d} cm³/rev", { d: num(c.displacement, 3) }));
    $("kpis").innerHTML = h;
  }
  function alerts() {
    var c = R.cyc, info = PR.fluid(S.fluid).info, list = [];
    var add = function (kind, msg) { list.push([kind, msg]); };
    if (!c.ok) {
      add("bad", c.error === "critical" ? T("Condensing at {T} °C is beyond what {f} can do: its critical point is {Tc} °C. Choose a refrigerant with a higher critical temperature, or lower the flow temperature.", { T: n1(R.Tc), f: S.fluid, Tc: n1(info.Tcrit) })
        : c.error === "evapLow" ? T("Evaporating at {T} °C is below the property tables (−49 °C).", { T: n1(R.Te) })
        : T("The condensing temperature must be at least 5 K above the evaporating temperature."));
    } else {
      var K = CY.COMPRESSORS[S.comp];
      c.warnings.forEach(function (w) {
        if (w === "discharge") add("warn", T("Discharge temperature {T} °C: above about 120 °C most compressors and their oil are at their limit. Lower the flow temperature, add vapour injection, or choose a refrigerant with a cooler discharge.", { T: n1(c.T2) }));
        if (w === "ratio") add("warn", T("Pressure ratio {r}: high for one stage. Efficiency and capacity fall; consider two-stage compression or vapour injection.", { r: fx(c.ratio, 1) }));
        if (w === "nearCritical") add("warn", T("Condensing at {T} °C is close to the critical point of {f} ({Tc} °C): little latent heat is left and the COP suffers. A refrigerant with a higher critical temperature suits this flow temperature better.", { T: n1(c.Tc), f: S.fluid, Tc: n1(info.Tcrit) }));
        if (w === "pressure") add("warn", T("Condensing pressure {p} bar: above the 42 bar design pressure common for small units.", { p: n1(c.pc) }));
        if (w === "flash") add("warn", T("{x} of the refrigerant flashes to vapour in the expansion valve: an economiser or more subcooling would gain capacity.", { x: pct(c.flashGas) }));
        if (w === "evapCold") add("warn", T("Evaporating at {T} °C: very cold; check the compressor's operating envelope.", { T: n1(c.Te) }));
        if (w === "compRange") add("warn", T("{Q} kW is outside the usual range of this compressor type ({a}–{b} kW).", { Q: num(c.Q, 3), a: n0(K.range[0]), b: n0(K.range[1]) }));
      });
      if (!R.cond.feasible) add("bad", T("Condenser pinch: at one end the refrigerant would be colder than the water ({d} K). Raise the condensing approach, lower the subcooling, or widen the flow–return difference.", { d: n1(R.cond.pinch) }));
      if (!R.evap.feasible) add("bad", T("Evaporator pinch: the source cannot warm the refrigerant to {T} °C ({d} K). Lower the superheat or raise the approach.", { T: n1(c.byId["1"].T), d: n1(R.evap.pinch) }));
      if (R.charge.mass > R.limit) add("bad", T("A charge of about {m} kg exceeds the {l} kg allowed for {f} in a {A} m² room with this mounting. Put the unit outdoors or in a ventilated enclosure, or reduce the charge.", { m: num(R.charge.mass, 2), l: num(R.limit, 2), f: S.fluid, A: n0(S.room) }));
      if (S.fluid === "R717" && S.install !== "plant") add("bad", T("Ammonia is toxic (safety class B2L): only in a dedicated machinery room with gas detection and ventilation."));
      if (info.gwp > 750) add("warn", T("{f} has a GWP of {g}: high-GWP refrigerants are being phased out of new heat pumps under the EU F-gas Regulation.", { f: S.fluid, g: n0(info.gwp) }));
      if (R.pipes.suction.tooSmall) add("warn", T("Even the largest standard pipe is too small for the suction line: use parallel lines or a larger custom pipe."));
    }
    if (!list.length) add("ok", T("No problems found at the design point."));
    var label = { bad: T("Problem"), warn: T("Check"), ok: T("OK") };
    $("alerts").innerHTML = list.map(function (a) { return "<div class='alert " + a[0] + "'><span class='ic'>" + label[a[0]] + "</span><span>" + a[1] + "</span></div>"; }).join("");
  }
  var STATE_NAMES = {
    "1": function () { return T("Compressor inlet"); }, "2s": function () { return T("Discharge if isentropic"); }, "2": function () { return T("Compressor outlet"); },
    "2v": function () { return T("Condensation starts"); }, "3l": function () { return T("Condensation ends"); }, "3": function () { return T("Condenser outlet"); },
    "4": function () { return T("Evaporator inlet"); }, "1v": function () { return T("Evaporation ends") }
  };
  function states() {
    var c = R.cyc;
    if (!c.ok) { $("statesTable").innerHTML = ""; return; }
    var order = ["1", "2s", "2", "2v", "3l", "3", "4", "1v"];
    $("statesTable").innerHTML = "<thead><tr><th>" + T("Point") + "</th><th class='l'>" + T("State") + "</th><th>p bar</th><th>T °C</th><th>h kJ/kg</th><th>s kJ/kg·K</th><th>ρ kg/m³</th><th>" + T("Vapour fraction") + "</th></tr></thead><tbody>" +
      order.map(function (id) {
        var s = c.byId[id];
        return "<tr><td>" + id.replace("2v", "2′").replace("3l", "3′").replace("1v", "1′") + "</td><td class='l'>" + STATE_NAMES[id]() + "</td><td>" + num(s.p, 4) + "</td><td>" + n1(s.T) + "</td><td>" + fx(s.h, 1) + "</td><td>" + fx(s.s, 4) + "</td><td>" + num(s.rho, 4) + "</td><td>" + (s.x == null ? "—" : fx(s.x, 3)) + "</td></tr>";
      }).join("") + "</tbody>";
  }
  function card(title, rows, note) {
    return "<div class='card'><h4>" + title + "</h4><dl>" + rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join("") + "</dl>" + (note ? "<p>" + note + "</p>" : "") + "</div>";
  }
  function plateRows(p) {
    if (!p) return [];
    return [[T("Plates"), (p.units > 1 ? p.units + " × " : "") + p.plates + " × " + T("size {s}", { s: p.size }) + " (" + n0(p.width * 1000) + " × " + n0(p.length * 1000) + " mm)"],
            [T("Channel velocity"), fx(p.velocity, 2) + " m/s" + (p.ok ? "" : p.low ? " ⚠ " + T("low") : " ⚠ " + T("high"))]];
  }
  function components() {
    var c = R.cyc;
    if (!c.ok) { $("components").innerHTML = ""; return; }
    var info = PR.fluid(S.fluid).info, h = "", cd = R.cond, ev = R.evap, pp = R.pipes;
    var compName = { rotary: T("Rotary"), scroll: T("Scroll"), screw: T("Screw"), piston: T("Piston") }[S.comp];
    h += card(T("Compressor") + " — " + compName, [
      [T("Swept volume"), num(c.Vswept * 3600, 3) + " m³/h"], [T("Displacement"), num(c.displacement, 3) + " cm³/rev " + T("at {n} rev/s", { n: n0(S.rps) })],
      [T("Volumetric efficiency"), fx(c.etaVol, 2)], [T("Shaft power"), kw(c.Wshaft)], [T("Electrical power"), kw(c.Wel)],
      [T("Volumetric heating capacity"), n0(c.vhc) + " kJ/m³"]], T("Choose a compressor whose displacement and operating envelope cover this point."));
    var zone = function (z) { return pct(z.Q / c.Q); };
    h += card(T("Condenser") + " — " + T("brazed plate"), [
      [T("Heat delivered"), kw(c.Q)], [T("Area"), (cd.feasible ? num(cd.area, 3) : "—") + " m²"],
      [T("Desuperheating / condensing / subcooling"), cd.zones.map(function (z) { return zone(z); }).reverse().join(" / ")],
      [T("Smallest temperature gap"), n1(cd.pinch) + " K"], [T("Water flow"), num(cd.water.flow, 3) + " L/s · " + num(cd.water.flow * 3.6, 3) + " m³/h"]].concat(plateRows(cd.feasible ? SY.plateHX(cd.area, cd.water.flow) : null)));
    var evName = S.source === "air" ? T("finned air coil") : T("brazed plate");
    var srcRows = [[T("Heat from the source"), kw(c.Qe)], [S.source === "air" ? T("Air-side area") : T("Area"), (ev.feasible ? num(ev.area, 3) : "—") + " m²"],
      [T("Smallest temperature gap"), n1(ev.pinch) + " K"]];
    if (S.source === "air") {
      srcRows.push([T("Air flow"), n0(ev.source.vdot * 3600) + " m³/h"], [T("Fan power"), kw(ev.source.aux)]);
      if (ev.feasible) { var coil = SY.airCoil(ev.area, ev.source.vdot);
        srcRows.push([T("Face area"), num(coil.face, 3) + " m² (" + fx(coil.side, 2) + " × " + fx(coil.side, 2) + " m)"], [T("Rows"), coil.rows + (coil.ok ? "" : " ⚠")]); }
    } else {
      srcRows.push([S.source === "ground" ? T("Brine flow") : T("Water flow"), num(ev.source.vdot * 1000, 3) + " L/s"], [T("Pump power"), kw(ev.source.aux)]);
      srcRows = srcRows.concat(plateRows(ev.feasible ? SY.plateHX(ev.area, ev.source.vdot * 1000) : null));
    }
    h += card(T("Evaporator") + " — " + evName, srcRows);
    if (R.bore) h += card(T("Boreholes"), [[T("Total length"), n0(R.bore.length) + " m"], [T("Boreholes"), R.bore.holes + " × " + n0(R.bore.depth) + " m"], [T("Specific extraction"), R.bore.specific + " W/m"]],
      T("Guide values after VDI 4640 for about 1800 heating hours a year; a geologist or a thermal response test sets the real value."));
    var line = function (k) { var p = pp[k]; return (p.dn ? p.dn + " (" + fx(p.od, 1) + " mm)" : fx(p.od, 0) + " × " + fx(p.wall, 1) + " mm") + " · " + fx(p.v, 1) + " m/s"; };
    h += card(T("Refrigerant lines") + " — " + (pp.suction.material === "steel" ? T("steel") : T("copper")), [
      [T("Suction"), line("suction")], [T("Discharge"), line("discharge")], [T("Liquid"), line("liquid")]],
      T("Smallest standard pipe below 15 m/s (suction), 18 m/s (discharge) and 1.5 m/s (liquid). Check oil return in vertical suction risers."));
    h += card(T("Expansion valve"), [[T("Capacity"), kw(c.Qe)], [T("Pressure drop"), num(c.pc - c.pe, 3) + " bar"], [T("Flash gas"), pct(c.flashGas)]]);
    var safety = [[T("Refrigerant"), S.fluid + " <span class='tag " + info.safety + "'>" + info.safety + "</span>"], ["GWP", n0(info.gwp)],
      [T("Estimated charge"), num(R.charge.mass, 2) + " kg (±50 %)"], [T("CO₂ equivalent"), num(R.charge.mass * info.gwp / 1000, 2) + " t"]];
    if (S.install === "indoor") safety.push([T("Allowed in this room"), isFinite(R.limit) ? num(R.limit, 2) + " kg" : T("no limit (not flammable)")]);
    h += card(T("Charge and safety"), safety, T("Charge from a typical internal volume per kW; the room limit follows m = 2.5 · LFL^1.25 · h0 · √A (IEC 60335-2-40, EN 378)."));
    $("components").innerHTML = h;
  }

  // ------------------------------------------------------------------ charts
  var css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
  function setup(cv) {
    var dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth;
    if (!cv.dataset.h) cv.dataset.h = cv.getAttribute("height");
    var h = Number(cv.dataset.h);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + "px";
    var ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }
  function box(w, h, x0, x1, y0, y1, logY, pad) {
    var p = Object.assign({ l: 58, r: 18, t: 14, b: 42 }, pad || {});
    var b = { l: p.l, r: w - p.r, t: p.t, b: h - p.b, w: w, h: h, x0: x0, x1: x1, y0: y0, y1: y1, logY: logY };
    var Y = function (v) { return logY ? Math.log(v) : v; };
    b.x = function (v) { return b.l + (v - x0) / (x1 - x0) * (b.r - b.l); };
    b.y = function (v) { return b.b - (Y(v) - Y(y0)) / (Y(y1) - Y(y0)) * (b.b - b.t); };
    b.ix = function (px) { return x0 + (px - b.l) / (b.r - b.l) * (x1 - x0); };
    b.iy = function (py) { var f = (b.b - py) / (b.b - b.t); return logY ? Math.exp(Y(y0) + f * (Y(y1) - Y(y0))) : y0 + f * (y1 - y0); };
    return b;
  }
  function niceTicks(a, b, n) {
    var span = b - a, step = Math.pow(10, Math.floor(Math.log10(span / n))), err = span / n / step;
    step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var out = []; for (var v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function logTicks(a, b) {
    var out = [];
    for (var e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) [1, 2, 5].forEach(function (m) { var v = m * Math.pow(10, e); if (v >= a && v <= b) out.push(v); });
    return out;
  }
  function axes(ctx, b, xt, yt, xl, yl) {
    ctx.strokeStyle = css("--grid"); ctx.lineWidth = 1; ctx.fillStyle = css("--ink-faint"); ctx.font = "11px 'IBM Plex Mono', monospace";
    yt.forEach(function (v) { var y = Math.round(b.y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(b.l, y); ctx.lineTo(b.r, y); ctx.stroke(); ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(num(v, 3), b.l - 6, y); });
    xt.forEach(function (v) { var x = Math.round(b.x(v)) + 0.5; ctx.beginPath(); ctx.moveTo(x, b.t); ctx.lineTo(x, b.b); ctx.stroke(); ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(num(v, 3), x, b.b + 6); });
    ctx.strokeStyle = css("--axis"); ctx.strokeRect(b.l + 0.5, b.t + 0.5, b.r - b.l, b.b - b.t);
    ctx.fillStyle = css("--ink-dim"); ctx.font = "12px Barlow, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(xl, (b.l + b.r) / 2, b.h - 4);
    ctx.save(); ctx.translate(14, (b.t + b.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = "middle"; ctx.fillText(yl, 0, 0); ctx.restore();
  }
  function path(ctx, pts, color, width, dash, fill) {
    if (pts.length < 2) return;
    ctx.beginPath(); pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.setLineDash(dash || []); ctx.lineJoin = "round"; ctx.stroke(); ctx.setLineDash([]);
  }
  function marker(ctx, x, y, color, label, dx, dy) {
    ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fillStyle = css("--panel-2"); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fillStyle = color; ctx.fill();
    if (label) { ctx.font = "700 13px Rajdhani, sans-serif"; ctx.fillStyle = css("--ink"); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x + (dx || 0), y + (dy || 0)); }
  }
  function clipTo(ctx, b) { ctx.save(); ctx.beginPath(); ctx.rect(b.l, b.t, b.r - b.l, b.b - b.t); ctx.clip(); }
  function tipAt(tip, cv, x, y, html) {
    if (html == null) { tip.hidden = true; return; }
    tip.innerHTML = html; tip.hidden = false;
    var w = tip.offsetWidth, W = cv.clientWidth;
    tip.style.left = Math.min(W - w - 4, Math.max(4, x + 14)) + "px"; tip.style.top = Math.max(4, y - tip.offsetHeight - 10) + "px";
  }
  var hover = {};
  function hook(id, tipId) {
    var cv = $(id);
    cv.addEventListener("pointermove", function (e) { var r = cv.getBoundingClientRect(); hover[id] = [e.clientX - r.left, e.clientY - r.top]; draw(); });
    cv.addEventListener("pointerleave", function () { hover[id] = null; $(tipId).hidden = true; draw(); });
  }
  function stateTip(s) {
    return "<b>" + s.id.replace("2v", "2′").replace("3l", "3′").replace("1v", "1′") + " · " + STATE_NAMES[s.id]() + "</b><br>p " + num(s.p, 4) + " bar · T " + n1(s.T) + " °C<br>h " + fx(s.h, 1) + " kJ/kg · s " + fx(s.s, 4) + " kJ/kg·K" + (s.x != null ? "<br>" + T("vapour fraction") + " " + fx(s.x, 3) : "");
  }
  function nearest(points, mx, my, r) {
    var best = null, bd = r * r;
    points.forEach(function (p) { var d = (p[0] - mx) * (p[0] - mx) + (p[1] - my) * (p[1] - my); if (d < bd) { bd = d; best = p; } });
    return best;
  }

  // --- pressure–enthalpy
  function drawPH() {
    var cv = $("chartPH"); if (!cv.clientWidth) return;
    var F = PR.fluid(S.fluid), c = R.cyc, g = setup(cv), ctx = g.ctx;
    var Tlo = Math.max(F.Tmin, (c.ok ? c.Te : R.Te) - 20), pmin = F.sat(Tlo).p, pmax = Math.min(F.pcrit * 1.08, (c.ok ? c.pc : F.sat(Math.min(R.Tc, F.Tmax)).p) * 2.6);
    var hmin = F.sat(Tlo).hl - 10, hmax = Math.max(F.sat(Math.min(F.Tmax, Tlo + 80)).hv, c.ok ? c.byId["2"].h : 0) + 40;
    var b = box(g.w, g.h, hmin, hmax, pmin, pmax, true, { l: 62 });
    axes(ctx, b, niceTicks(hmin, hmax, 8), logTicks(pmin, pmax), T("Specific enthalpy h (kJ/kg)"), T("Pressure p (bar, log scale)"));
    clipTo(ctx, b);
    // the saturation dome
    var dome = [], Ts = [];
    for (var T0 = F.Tmin; T0 <= F.Tmax; T0 += 1) Ts.push(T0);
    Ts.push(F.Tmax);
    Ts.forEach(function (t) { var s = F.sat(t); dome.push([b.x(s.hl), b.y(s.p)]); });
    Ts.slice().reverse().forEach(function (t) { var s = F.sat(t); dome.push([b.x(s.hv), b.y(s.pv)]); });
    path(ctx, dome, css("--dome"), 1.6, null, "rgba(125,211,252,0.06)");
    // isotherms
    ctx.font = "10.5px 'IBM Plex Mono', monospace";
    niceTicks(Tlo, Math.min(F.Tcrit + 60, (c.ok ? c.T2 : R.Tc) + 30), 7).forEach(function (t) {
      var pts = [];
      if (t <= F.Tmax) {
        var s = F.sat(t), lnps = [];
        for (var k = 0; k <= 30; k++) lnps.push(Math.log(s.p) + (Math.log(pmax) - Math.log(s.p)) * (30 - k) / 30);
        lnps.forEach(function (lp) { pts.push([b.x(F.liquid(t, Math.exp(lp)).h), b.y(Math.exp(lp))]); });
        pts.push([b.x(s.hl), b.y(s.p)], [b.x(s.hv), b.y(s.pv)]);
        for (var k2 = 1; k2 <= 30; k2++) { var p = s.pv * Math.pow(pmin / s.pv, k2 / 30); pts.push([b.x(F.vapour(p, t).h), b.y(p)]); }
      } else {
        for (var k3 = 0; k3 <= 40; k3++) { var p3 = Math.min(F.pmax, pmax) * Math.pow(pmin / Math.min(F.pmax, pmax), k3 / 40); if (F.Tdew(p3) < t) pts.push([b.x(F.vapour(p3, t).h), b.y(p3)]); }
      }
      path(ctx, pts, css("--line"), 1, [3, 3]);
      var lab = pts[pts.length - 1]; if (lab) { ctx.fillStyle = css("--ink-faint"); ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText(n0(t) + " °C", Math.min(lab[0] + 3, b.r - 40), Math.min(lab[1] - 2, b.b - 2)); }
    });
    var pts = [];
    if (c.ok) {
      var st = c.byId, P = function (id) { return [b.x(st[id].h), b.y(st[id].p)]; };
      path(ctx, [P("1"), P("2s")], css("--ink-faint"), 1.2, [4, 3]);
      var loop = [P("1"), P("2"), P("2v"), P("3l"), P("3"), P("4"), P("1v"), P("1")];
      path(ctx, loop, css("--warn"), 2.6);
      [["1", 0, 14], ["2", 0, -14], ["3", -12, -10], ["4", 0, 14]].forEach(function (m) { var q = P(m[0]); marker(ctx, q[0], q[1], css("--warn"), m[0], m[1], m[2]); });
      marker(ctx, P("2s")[0], P("2s")[1], css("--ink-faint"));
      pts = ["1", "2s", "2", "2v", "3l", "3", "4", "1v"].map(function (id) { var q = P(id); return [q[0], q[1], st[id]]; });
    }
    ctx.restore();
    var hv = hover.chartPH;
    if (hv) {
      var near = nearest(pts, hv[0], hv[1], 14);
      tipAt($("tipPH"), cv, hv[0], hv[1], near ? stateTip(near[2]) : (hv[0] > b.l && hv[0] < b.r && hv[1] > b.t && hv[1] < b.b ? "h " + fx(b.ix(hv[0]), 1) + " kJ/kg<br>p " + num(b.iy(hv[1]), 3) + " bar" : null));
    }
    $("legPH").innerHTML = "<span><i style='background:" + css("--warn") + "'></i>" + T("cycle {f}", { f: S.fluid }) + "</span><span><i style='background:" + css("--dome") + "'></i>" + T("saturation dome") + "</span><span style='color:" + css("--line") + "'><i class='dash'></i><span style='color:" + css("--ink")+ "'>" + T("isotherms") + "</span></span><span style='color:" + css("--ink-faint") + "'><i class='dash'></i><span style='color:" + css("--ink") + "'>" + T("isentropic compression") + "</span></span>";
  }

  // --- temperature–entropy
  function drawTS() {
    var cv = $("chartTS"); if (!cv.clientWidth) return;
    var F = PR.fluid(S.fluid), c = R.cyc, g = setup(cv), ctx = g.ctx;
    var Tlo = Math.max(F.Tmin, Math.min(R.Te, R.srcOut) - 15), Thi = Math.max(F.Tcrit + 5, (c.ok ? c.T2 : R.Tc) + 15);
    var s0 = F.sat(Tlo).sl - 0.05, s1v = F.sat(Tlo).sv + 0.12;
    if (c.ok) s1v = Math.max(s1v, c.byId["2"].s + 0.08);
    var b = box(g.w, g.h, s0, s1v, Tlo, Thi, false);
    axes(ctx, b, niceTicks(s0, s1v, 8), niceTicks(Tlo, Thi, 8), T("Specific entropy s (kJ/kg·K)"), T("Temperature T (°C)"));
    clipTo(ctx, b);
    var dome = [];
    for (var t = F.Tmin; t <= F.Tmax; t += 1) { var s = F.sat(t); dome.push([b.x(s.sl), b.y(t)]); }
    for (var t2 = F.Tmax; t2 >= F.Tmin; t2 -= 1) { var s2 = F.sat(t2); dome.push([b.x(s2.sv), b.y(t2)]); }
    path(ctx, dome, css("--dome"), 1.6, null, "rgba(125,211,252,0.06)");
    var pts = [];
    if (c.ok) {
      var st = c.byId, P = function (id) { return [b.x(st[id].s), b.y(st[id].T)]; };
      // source and heating circuit, drawn under the cycle
      path(ctx, [[b.x(st["3"].s), b.y(S.ret)], [b.x(st["2"].s), b.y(S.flow)]], css("--s2"), 2.2);
      path(ctx, [[b.x(st["4"].s), b.y(R.srcOut)], [b.x(st["1"].s), b.y(R.srcIn)]], css("--s1"), 2.2);
      var loop = [P("1")], k;
      loop.push(P("2"));
      for (k = 1; k <= 12; k++) { var tt = st["2"].T + (c.Tc - st["2"].T) * k / 12; loop.push([b.x(PR.fluid(S.fluid).vapour(c.pc, tt).s), b.y(tt)]); }
      loop.push(P("3l"));
      for (k = 1; k <= 6; k++) { var tl = c.Tc - S.SC * k / 6; loop.push([b.x(F.liquid(tl, c.pc).s), b.y(tl)]); }
      loop.push(P("4"), P("1v"));
      for (k = 1; k <= 6; k++) { var ts = c.Te + S.SH * k / 6; loop.push([b.x(F.vapour(c.pe, ts).s), b.y(ts)]); }
      path(ctx, loop, css("--warn"), 2.6);
      path(ctx, [P("1"), P("2s")], css("--ink-faint"), 1.2, [4, 3]);
      [["1", 12, 10], ["2", 12, -8], ["3", -12, 0], ["4", -12, 6]].forEach(function (m) { var q = P(m[0]); marker(ctx, q[0], q[1], css("--warn"), m[0], m[1], m[2]); });
      pts = ["1", "2s", "2", "2v", "3l", "3", "4", "1v"].map(function (id) { var q = P(id); return [q[0], q[1], st[id]]; });
    }
    ctx.restore();
    var hv = hover.chartTS;
    if (hv) {
      var near = nearest(pts, hv[0], hv[1], 14);
      tipAt($("tipTS"), cv, hv[0], hv[1], near ? stateTip(near[2]) : (hv[0] > b.l && hv[0] < b.r && hv[1] > b.t && hv[1] < b.b ? "s " + fx(b.ix(hv[0]), 3) + " kJ/kg·K<br>T " + n1(b.iy(hv[1])) + " °C" : null));
    }
    $("legTS").innerHTML = "<span><i style='background:" + css("--warn") + "'></i>" + T("cycle {f}", { f: S.fluid }) + "</span><span><i style='background:" + css("--s2") + "'></i>" + T("heating water {r} → {f} °C", { r: n0(S.ret), f: n0(S.flow) }) + "</span><span><i style='background:" + css("--s1") + "'></i>" + T("source {a} → {b} °C", { a: n1(R.srcIn), b: n1(R.srcOut) }) + "</span><span><i style='background:" + css("--dome") + "'></i>" + T("saturation dome") + "</span>";
  }

  // --- heat exchanger temperature profiles
  function drawHX(id, tipId, hx, refColor, secColor, secName) {
    var cv = $(id); if (!cv.clientWidth) return;
    var g = setup(cv), ctx = g.ctx, pr = hx.profile;
    var all = pr.map(function (p) { return p.ref; }).concat(pr.map(function (p) { return p.sec; }));
    var lo = Math.min.apply(null, all) - 3, hi = Math.max.apply(null, all) + 3, Qmax = pr[pr.length - 1].Q;
    var b = box(g.w, g.h, 0, Qmax, lo, hi, false, { l: 60 });
    axes(ctx, b, niceTicks(0, Qmax, 6), niceTicks(lo, hi, 6), T("Heat transferred (kW)"), T("Temperature (°C)"));
    pr.forEach(function (p, i) { if (i && i < pr.length - 1) { var x = Math.round(b.x(p.Q)) + 0.5; ctx.strokeStyle = css("--line"); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, b.t); ctx.lineTo(x, b.b); ctx.stroke(); ctx.setLineDash([]); } });
    path(ctx, pr.map(function (p) { return [b.x(p.Q), b.y(p.sec)]; }), secColor, 2.4);
    path(ctx, pr.map(function (p) { return [b.x(p.Q), b.y(p.ref)]; }), refColor, 2.6);
    // pinch: the smallest gap at a zone boundary
    var pi = 0, pd = Infinity; pr.forEach(function (p, i) { var d = Math.abs(p.ref - p.sec); if (d < pd) { pd = d; pi = i; } });
    var pp = pr[pi], x = b.x(pp.Q);
    ctx.strokeStyle = hx.feasible ? css("--ink") : css("--bad"); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, b.y(pp.ref)); ctx.lineTo(x, b.y(pp.sec)); ctx.stroke();
    ctx.font = "600 12px Barlow, sans-serif"; ctx.fillStyle = hx.feasible ? css("--ink") : css("--bad"); ctx.textAlign = x > (b.l + b.r) / 2 ? "right" : "left"; ctx.textBaseline = "middle";
    ctx.fillText(T("pinch {d} K", { d: n1(hx.pinch) }), x + (x > (b.l + b.r) / 2 ? -8 : 10), (b.y(pp.ref) + b.y(pp.sec)) / 2);
    var hv = hover[id];
    if (hv && hv[0] > b.l && hv[0] < b.r) {
      var q = Math.max(0, Math.min(Qmax, b.ix(hv[0]))), j = 0; while (j < pr.length - 2 && pr[j + 1].Q < q) j++;
      var f = (q - pr[j].Q) / ((pr[j + 1].Q - pr[j].Q) || 1), tr = pr[j].ref + f * (pr[j + 1].ref - pr[j].ref), tsec = pr[j].sec + f * (pr[j + 1].sec - pr[j].sec);
      tipAt($(tipId), cv, hv[0], hv[1], "Q " + num(q, 3) + " kW<br>" + T("refrigerant") + " " + n1(tr) + " °C<br>" + secName + " " + n1(tsec) + " °C<br>" + T("gap") + " " + n1(Math.abs(tr - tsec)) + " K");
    }
  }

  // --- energy flow
  function drawEnergy() {
    var cv = $("chartEnergy"); if (!cv.clientWidth) return;
    var c = R.cyc, g = setup(cv), ctx = g.ctx; if (!c.ok) return;
    var aux = R.evap.source.aux, loss = c.Wel - c.Wshaft;
    var rows = [
      [T("Energy in"), [[T("from the source"), c.Qe, css("--s3")], [T("compressor electricity"), c.Wel, css("--s2")], [S.source === "air" ? T("fan") : T("source pump"), aux, css("--s4")]]],
      [T("Energy out"), [[T("heat delivered"), c.Q, css("--s1")], [T("motor and drive losses"), loss, css("--line")], [S.source === "air" ? T("fan") : T("source pump"), aux, css("--s4")]]]
    ];
    var total = Math.max(c.Qe + c.Wel + aux, c.Q + loss + aux), L = 150, R0 = g.w - 30, bh = 46;
    ctx.font = "600 13px Barlow, sans-serif";
    var hits = [];
    rows.forEach(function (row, i) {
      var y = 40 + i * 110, x = L;
      ctx.fillStyle = css("--ink-dim"); ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(row[0], L - 12, y + bh / 2);
      row[1].forEach(function (seg) {
        var w = seg[1] / total * (R0 - L); if (w < 0.5) return;
        ctx.fillStyle = seg[2]; ctx.fillRect(x, y, Math.max(1, w - 2), bh);
        hits.push([x, y, w, bh, seg[0], seg[1]]);
        if (w > 70) { ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.font = "600 12px Barlow, sans-serif"; ctx.fillText(seg[0], x + 8, y + 15); ctx.font = "12px 'IBM Plex Mono', monospace"; ctx.fillText(kw(seg[1]) + " · " + pct(seg[1] / c.Q), x + 8, y + 32); }
        x += w;
      });
    });
    ctx.fillStyle = css("--ink-faint"); ctx.font = "12px Barlow, sans-serif"; ctx.textAlign = "left";
    ctx.fillText(T("{p} of the delivered heat is taken from the source for free.", { p: pct(c.Qe / c.Q) }), L, 270);
    var hv = hover.chartEnergy, hit = hv && hits.find(function (h) { return hv[0] >= h[0] && hv[0] <= h[0] + h[2] && hv[1] >= h[1] && hv[1] <= h[1] + h[3]; });
    tipAt($("tipEnergy"), cv, hv ? hv[0] : 0, hv ? hv[1] : 0, hit ? "<b>" + hit[4] + "</b><br>" + kw(hit[5]) + " · " + pct(hit[5] / c.Q) + " " + T("of the heat delivered") : null);
  }

  // --- refrigerant comparison
  function compare() {
    var rows = PR.names().map(function (f) {
      var o = Object.assign({}, R.o, { fluid: f }), c = CY.design(o), d = PR.fluid(f).info;
      return { f: f, c: c, d: d };
    });
    var best = Math.max.apply(null, rows.filter(function (r) { return r.c.ok; }).map(function (r) { return r.c.cop; }));
    $("cmpTable").innerHTML = "<thead><tr><th>" + T("Refrigerant") + "</th><th>" + T("Safety") + "</th><th>GWP</th><th>COP</th><th>" + T("Evap. bar") + "</th><th>" + T("Cond. bar") + "</th><th>" + T("Ratio") + "</th><th>" + T("Discharge °C") + "</th><th>" + T("kJ/m³ suction") + "</th><th>" + T("cm³/rev") + "</th><th>" + T("Flags") + "</th></tr></thead><tbody>" +
      rows.map(function (r) {
        var c = r.c, cur = r.f === S.fluid ? " cur" : "";
        if (!c.ok) return "<tr class='pick" + cur + "' data-f='" + r.f + "'><td>" + r.f + "</td><td><span class='tag " + r.d.safety + "'>" + r.d.safety + "</span></td><td>" + n0(r.d.gwp) + "</td><td colspan='8' class='l'>" + (c.error === "critical" ? T("cannot condense at {T} °C (critical point {Tc} °C)", { T: n1(R.Tc), Tc: n1(r.d.Tcrit) }) : T("outside its range")) + "</td></tr>";
        var flags = c.warnings.filter(function (w) { return w !== "compRange"; }).map(function (w) { return { discharge: T("hot discharge"), ratio: T("high ratio"), nearCritical: T("near critical"), pressure: T("high pressure"), flash: T("much flash gas"), evapCold: T("very cold") }[w]; }).join(", ");
        return "<tr class='pick" + cur + "' data-f='" + r.f + "'><td>" + r.f + "</td><td><span class='tag " + r.d.safety + "'>" + r.d.safety + "</span></td><td>" + n0(r.d.gwp) + "</td><td><span class='bar' style='width:" + Math.round(c.cop / best * 60) + "px'></span>" + fx(c.cop, 2) + "</td><td>" + num(c.pe, 3) + "</td><td>" + num(c.pc, 3) + "</td><td>" + fx(c.ratio, 2) + "</td><td>" + n1(c.T2) + "</td><td>" + n0(c.vhc) + "</td><td>" + num(c.displacement, 3) + "</td><td class='l'>" + (flags || "—") + "</td></tr>";
      }).join("") + "</tbody>";
  }
  $("cmpTable").addEventListener("click", function (e) { var tr = e.target.closest("tr[data-f]"); if (!tr) return; S.fluid = tr.dataset.f; sync(); update(); });

  // --- year round: load and capacity, heat by bin, costs and CO₂
  function money(v) { return (S.currency || "") + " " + n0(v); }
  function drawYear() {
    var Y = R.year, E = R.econ;
    if (!R.cyc.ok || !Y || !Y.ok) { $("yearKpis").innerHTML = ""; $("econTable").innerHTML = ""; return; }
    var bal = Y.balance === -Infinity ? T("none: always enough") : Y.balance == null ? T("never reached") : n1(Y.balance) + " °C";
    $("yearKpis").innerHTML =
      kpi("SCOP", fx(Y.scop, 2), "", T("system {s} incl. {what}", { s: fx(Y.scopSys, 2), what: S.source === "air" ? T("fan") : T("source pump") }), true) +
      kpi(T("Heat pump share"), pct(Y.hpShare), "", T("backup {b} kWh", { b: n0(Y.total.elBackup) })) +
      kpi(T("Balance point"), bal, "", T("max backup {p} kW", { p: num(Y.maxBackup, 2) })) +
      kpi(T("Space heating"), n0(Y.total.heat), "kWh", T("{h} heating hours", { h: n0(Y.total.hours) })) +
      kpi(T("Electricity"), n0(E.hp.el), "kWh", T("all uses, per year")) +
      (Y.dhw ? kpi(T("Hot water"), n0(Y.dhw.heat), "kWh", T("COP {c} at {t} °C", { c: fx(Y.dhw.cop, 2), t: n0(S.dhwFlow) })) : "");
    // load and capacity against outdoor temperature
    var cv = $("chartYear");
    if (cv.clientWidth) {
      var g = setup(cv), ctx = g.ctx, B = Y.bins.filter(function (b) { return b.ok; });
      var x0 = B[0].T - 1, x1 = S.limit, ymax = Math.max.apply(null, B.map(function (b) { return Math.max(b.load, b.Qmax); })) * 1.08;
      var b = box(g.w, g.h, x0, x1, 0, ymax, false);
      axes(ctx, b, niceTicks(x0, x1, 10), niceTicks(0, ymax, 6), T("Outdoor temperature (°C)"), T("Heat (kW)"));
      // backup region: where the load is above the capacity
      ctx.fillStyle = "rgba(201,133,0,0.22)";
      B.forEach(function (q) { if (q.Qbu > 1e-9) { ctx.fillRect(b.x(q.T - 0.5), b.y(q.load), b.x(q.T + 0.5) - b.x(q.T - 0.5), b.y(q.Qmax) - b.y(q.load)); } });
      path(ctx, B.map(function (q) { return [b.x(q.T), b.y(q.Qmax)]; }), css("--s1"), 2.4);
      path(ctx, B.map(function (q) { return [b.x(q.T), b.y(q.load)]; }), css("--s2"), 2.4);
      if (isFinite(Y.balance)) {
        var xb = b.x(Y.balance); ctx.strokeStyle = css("--ink"); ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(xb, b.t); ctx.lineTo(xb, b.b); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = css("--ink"); ctx.font = "600 12px Barlow, sans-serif"; ctx.textAlign = "left"; ctx.fillText(T("balance point {t} °C", { t: n1(Y.balance) }), xb + 6, b.t + 14);
      }
      var hv = hover.chartYear;
      if (hv && hv[0] > b.l && hv[0] < b.r) {
        var tj = Math.round(b.ix(hv[0])), q = B.find(function (z) { return z.T === tj; });
        tipAt($("tipYear"), cv, hv[0], hv[1], q ? "<b>" + n0(q.T) + " °C · " + n0(q.h) + " h/" + T("year") + "</b><br>" + T("load") + " " + num(q.load, 3) + " kW<br>" + T("full capacity") + " " + num(q.Qmax, 3) + " kW<br>" + T("backup") + " " + num(q.Qbu, 2) + " kW<br>COP " + fx(q.cop, 2) + " · " + T("flow") + " " + n1(q.flow) + " °C" : null);
      } else $("tipYear").hidden = true;
      $("legYear").innerHTML = "<span><i style='background:" + css("--s2") + "'></i>" + T("building heat load") + "</span><span><i style='background:" + css("--s1") + "'></i>" + T("heat pump at full speed") + "</span><span><i style='background:rgba(201,133,0,0.6);height:9px'></i>" + T("covered by the electric heater") + "</span>";
    }
    // heat per bin over the year
    var cb = $("chartBins");
    if (cb.clientWidth) {
      var g2 = setup(cb), c2 = g2.ctx, B2 = Y.bins.filter(function (q) { return q.ok; });
      var xa = B2[0].T - 1, xz = S.limit, emax = Math.max.apply(null, B2.map(function (q) { return q.eHeat; })) * 1.1;
      var b2 = box(g2.w, g2.h, xa, xz, 0, emax, false, { l: 64 });
      axes(c2, b2, niceTicks(xa, xz, 10), niceTicks(0, emax, 5), T("Outdoor temperature (°C)"), T("Heat per year (kWh)"));
      var bw = Math.max(2, (b2.x(1) - b2.x(0)) - 2);
      B2.forEach(function (q) {
        var x = b2.x(q.T) - bw / 2, yHP = b2.y(q.eHP), yAll = b2.y(q.eHeat);
        c2.fillStyle = css("--s1"); c2.fillRect(x, yHP, bw, b2.b - yHP);
        if (q.eBackup > 0.5) { c2.fillStyle = css("--s4"); c2.fillRect(x, yAll, bw, yHP - yAll - 1); }
      });
      var hv2 = hover.chartBins;
      if (hv2 && hv2[0] > b2.l && hv2[0] < b2.r) {
        var tk = Math.round(b2.ix(hv2[0])), z = B2.find(function (w) { return w.T === tk; });
        tipAt($("tipBins"), cb, hv2[0], hv2[1], z ? "<b>" + n0(z.T) + " °C · " + n0(z.h) + " h/" + T("year") + "</b><br>" + T("heat pump") + " " + n0(z.eHP) + " kWh<br>" + T("backup") + " " + n0(z.eBackup) + " kWh<br>" + T("electricity") + " " + n0(z.eElHP + z.eBackup) + " kWh" : null);
      } else $("tipBins").hidden = true;
      $("legBins").innerHTML = "<span><i style='background:" + css("--s1") + ";height:9px'></i>" + T("heat pump") + "</span><span><i style='background:" + css("--s4") + ";height:9px'></i>" + T("electric heater") + "</span><span>" + T("climate: {c}, 2015–2024", { c: R.climateName }) + "</span>";
    }
    // costs and CO₂
    var row = function (a, b, c, d) { return "<tr><td class='l'>" + a + "</td><td>" + b + "</td><td>" + c + "</td><td>" + d + "</td></tr>"; };
    $("econTable").innerHTML = "<thead><tr><th></th><th>" + T("Energy bought") + "</th><th>" + T("Cost per year") + "</th><th>" + T("CO₂ per year") + "</th></tr></thead><tbody>" +
      row(T("Heat pump (electricity)"), n0(E.hp.el) + " kWh", money(E.hp.cost), num(E.hp.co2 / 1000, 3) + " t") +
      row(T("Gas boiler (gas)"), n0(E.boiler.gas) + " kWh", money(E.boiler.cost), num(E.boiler.co2 / 1000, 3) + " t") +
      row("<b>" + T("Saving with the heat pump") + "</b>", "", "<b>" + money(E.saving) + "</b>", "<b>" + num(E.co2Saving / 1000, 3) + " t</b>") +
      row(T("Simple payback of the extra cost"), "", !isFinite(E.payback) ? T("never at these prices") : E.payback > 0 ? T("{y} years", { y: n1(E.payback) }) : "—", "") + "</tbody>";
  }

  var lastDiagram = null;
  // --- installation diagram
  function drawPlant() {
    var c = R.cyc, el = $("diagram");
    if (!c.ok) { el.innerHTML = ""; return; }
    var st = c.byId, ev = R.evap, cd = R.cond;
    var srcName = { air: T("Outdoor air"), ground: T("Brine from the ground"), water: T("Ground or lake water"), waste: T("Waste heat water") }[S.source];
    var flowSrc = S.source === "air" ? n0(ev.source.vdot * 3600) + " m³/h" : num(ev.source.vdot * 1000, 3) + " L/s";
    var emitter = $("inSink").selectedOptions[0] ? $("inSink").selectedOptions[0].textContent.replace(/\s*\(.*\)\s*$/, "") : "";
    var Y = R.year && R.year.ok ? R.year : null;
    var d = {
      source: S.source, sink: S.sink, install: S.install, dhw: S.dhw > 0,
      T: T,
      labels: {
        title: T("Installation diagram"), compressor: T("Compressor"), valve: T("Expansion valve"), evap: T("Evaporator"), cond: T("Condenser"),
        fan: T("Fan"), srcPump: S.source === "ground" ? T("Brine pump") : T("Source pump"), circPump: T("Circulation pump"),
        backup: Y && Y.maxBackup > 0.01 ? T("Electric heater {p} kW", { p: num(Y.maxBackup, 2) }) : T("Electric heater (standby)"),
        emitter: emitter, tank: T("Hot-water tank"),
        boundary: { outdoor: T("Outdoor unit (monobloc)"), indoor: T("Indoor unit"), plant: T("Machinery room") }[S.install],
        groundLine: S.source === "ground" && R.bore ? T("{n} boreholes × {d} m", { n: R.bore.holes, d: n0(R.bore.depth) }) : T("supply and return wells")
      },
      values: {
        comp1: T("{p} kW electric", { p: num(c.Wel, 3) }), comp2: num(c.displacement, 3) + " cm³/rev · " + n0(S.rps) + " rev/s",
        srcHead: srcName, src1: T("in {a} °C → out {b} °C", { a: n1(R.srcIn), b: n1(R.srcOut) }), src2: flowSrc + " · " + num(ev.source.aux, 2) + " kW",
        sinkHead: T("flow {f} °C · return {r} °C", { f: n0(S.flow), r: n0(S.ret) }), sink1: num(cd.water.flow, 3) + " L/s · " + num(cd.water.flow * 3.6, 3) + " m³/h",
        sink2: T("heat {q} kW", { q: num(c.Q, 3) }),
        dhw1: T("hot water {e} kWh/yr", { e: n0(S.dhw) }), dhw2: T("charged at {t} °C", { t: n0(S.dhwFlow) }),
        s1: n1(st["1"].T) + " °C · " + num(st["1"].p, 3) + " bar", s2: n1(st["2"].T) + " °C · " + num(st["2"].p, 3) + " bar",
        s3: n1(st["3"].T) + " °C · " + num(st["3"].p, 3) + " bar", s4: n1(st["4"].T) + " °C · x " + fx(st["4"].x, 2),
        evapQ: "← " + num(c.Qe, 3) + " kW", condQ: num(c.Q, 3) + " kW →"
      },
      colors: { bg: css("--panel-2"), panel: css("--panel"), ink: css("--ink"), dim: css("--ink-faint"), line: css("--line"),
        hot: css("--s2"), cold: css("--s1"), liquid: css("--s4"), mixed: css("--accent"), source: css("--s3"), sourceOut: css("--ink-dim"), ground: "#6b4f2a" }
    };
    lastDiagram = d;
    el.innerHTML = window.HPSdiagram.svg(d);
    var sw = function (col, lab) { return "<span><i style='background:" + col + "'></i>" + lab + "</span>"; };
    $("legPlant").innerHTML = sw(css("--s2"), T("hot gas and heating flow")) + sw(css("--s4"), T("liquid refrigerant")) + sw(css("--accent"), T("refrigerant after the valve (liquid and vapour)")) +
      sw(css("--s1"), T("cold vapour and heating return")) + sw(css("--s3"), T("heat source"));
  }

  // --- datasheet and tour
  function openDatasheet() {
    if (!R.cyc.ok) return;
    var c = R.cyc, info = PR.fluid(S.fluid).info, Y = R.year && R.year.ok ? R.year : null, E = R.econ;
    var printColors = { bg: "#ffffff", panel: "#f2f5f9", ink: "#111111", dim: "#555555", line: "#999999", hot: "#d95926", cold: "#2a78d6",
      liquid: "#c98500", mixed: "#4f9fd8", source: "#199e70", sourceOut: "#555555", ground: "#b08a5a" };
    drawPlant();                                         // fills lastDiagram with this design's labels and values
    var d = Object.assign({}, lastDiagram, { colors: printColors });
    var opt = function (id) { var o = $(id).selectedOptions[0]; return o ? o.textContent : ""; };
    var srcName = { air: T("Outdoor air"), ground: T("Brine from the ground"), water: T("Ground or lake water"), waste: T("Waste heat water") }[S.source];
    var cards = [].map.call(document.querySelectorAll("#components .card"), function (k) {
      var dts = k.querySelectorAll("dt"), dds = k.querySelectorAll("dd");
      return [k.querySelector("h4").textContent, [].map.call(dts, function (t, i) { return [t.textContent, dds[i].innerHTML]; })];
    });
    window.HPSextras.datasheet({
      T: T, version: VERSION, date: new Date().toISOString().slice(0, 10),
      title: T("Heat pump design: {q} kW, {f}, {src}", { q: num(c.Q, 3), f: S.fluid, src: srcName.toLowerCase() }),
      diagram: window.HPSdiagram.svg(d),
      basis: [[T("Heat load"), num(R.load.total, 3) + " kW"], [T("Design outdoor"), n0(S.Tout) + " °C" + (S.loadMode === "calc" ? " · " + opt("inCity") : "")],
        [T("Heat source"), srcName + " · " + n1(R.srcIn) + " → " + n1(R.srcOut) + " °C"], [T("Emitters"), opt("inSink")],
        [T("Flow / return"), n0(S.flow) + " / " + n0(S.ret) + " °C"], [T("Refrigerant"), S.fluid + " (" + info.safety + ", GWP " + info.gwp + ")"],
        [T("Compressor"), opt("inComp")], [T("Installation"), { outdoor: T("Outdoor unit (monobloc)"), indoor: T("Indoor unit"), plant: T("Machinery room") }[S.install]]],
      results: [[T("Heating capacity"), kw(c.Q)], ["COP", fx(c.cop, 2) + " (Carnot " + fx(c.copCarnot, 2) + ")"], [T("Electrical input"), kw(c.Wel)],
        [T("System COP"), fx(R.copSys, 2)], [T("Heat from the source"), kw(c.Qe)], [T("Evaporating / condensing"), n1(c.Te) + " / " + n1(c.Tc) + " °C"],
        [T("Pressures"), num(c.pe, 3) + " / " + num(c.pc, 3) + " bar"], [T("Discharge temperature"), n1(c.T2) + " °C"],
        [T("Refrigerant flow"), num(c.m * 1000, 3) + " g/s"], [T("Displacement"), num(c.displacement, 3) + " cm³/rev"]],
      states: $("statesTable").outerHTML,
      components: cards,
      year: Y ? [["SCOP", fx(Y.scop, 2) + " (" + T("system") + " " + fx(Y.scopSys, 2) + ")"], [T("Climate data"), R.climateName + ", 2015–2024"],
        [T("Heat pump share"), pct(Y.hpShare)], [T("Balance point"), isFinite(Y.balance) ? n1(Y.balance) + " °C" : "—"],
        [T("Space heating"), n0(Y.total.heat) + " kWh"], [T("Electricity"), n0(E.hp.el) + " kWh"],
        [T("Cost per year"), money(E.hp.cost) + " (" + T("gas boiler") + " " + money(E.boiler.cost) + ")"],
        [T("CO₂ per year"), num(E.hp.co2 / 1000, 3) + " t (" + T("gas boiler") + " " + num(E.boiler.co2 / 1000, 3) + " t)"]] : null,
      warnings: [].map.call(document.querySelectorAll("#alerts .alert.bad span:last-child, #alerts .alert.warn span:last-child"), function (x) { return x.innerHTML; }),
      footer: T("Heat Pump Studio · refrigerant properties CoolProp · climate Open-Meteo (ERA5, CC BY 4.0) · typical figures for a first design; check against manufacturers’ data and local standards.")
    });
  }
  function startTour() {
    var steps = [
      { el: "#rail .step:nth-of-type(1)", title: T("1 · The building"), text: T("Start with how much heat the building needs on the coldest day: estimate it from floor area and insulation, or type it in.") },
      { el: "#rail .step:nth-of-type(2)", title: T("2 · The heat source"), text: T("Choose where the heat comes from. The source temperature sets the evaporating temperature — the warmer the source, the better the COP.") },
      { el: "#rail .step:nth-of-type(3)", title: T("3 · The heating circuit"), text: T("Floor heating needs about 35 °C, old radiators 55 °C or more. Every degree of flow temperature costs efficiency.") },
      { el: "#rail .step:nth-of-type(4)", title: T("4 · Refrigerant and compressor"), text: T("Pick the refrigerant and compressor. Each refrigerant suits a range of temperatures; its safety class and GWP matter too.") },
      { el: "#rail .step:nth-of-type(5)", title: T("5 · Installation"), text: T("Where the unit stands decides how much flammable refrigerant it may hold.") },
      { el: "#rail .step:nth-of-type(6)", title: T("6 · Year round"), text: T("The coldest day is rare. Choose the climate, how much of the peak the heat pump covers, and weather compensation.") },
      { el: "#rail .step:nth-of-type(7)", title: T("7 · Costs and CO₂"), text: T("Prices and the grid’s CO₂ turn the energy into running costs and emissions, compared with a gas boiler.") },
      { el: "#kpis", title: T("The results"), text: T("Heating capacity, COP against the Carnot limit, power, pressures and temperatures at the design point, and the seasonal SCOP.") },
      { el: "#alerts", title: T("Engineering checks"), text: T("Problems and things to check appear here: hot discharge, high pressure ratio, pinch in a heat exchanger, charge limits, high GWP.") },
      { el: "[data-tab=plant]", tab: "plant", title: T("The installation"), text: T("The whole system as designed, with the temperatures, pressures, flows and powers at every point.") },
      { el: "[data-tab=ph]", tab: "ph", title: T("The cycle"), text: T("The refrigerant’s pressure–enthalpy chart: the horizontal lengths are the heat from the source, the compressor work and the heat delivered.") },
      { el: "[data-tab=year]", tab: "year", title: T("The year"), text: T("How the heat pump does over a real year at this location: SCOP, the balance point, backup heat, costs and CO₂.") },
      { el: "#btnSheet", title: T("The datasheet"), text: T("A printable summary of the design, with the installation diagram, for a client or an installer.") }
    ];
    window.HPSextras.tour(steps, T, function (st) { if (st.tab && S.tab !== st.tab) { S.tab = st.tab; showTab(); draw(); } });
  }
  $("btnSheet").addEventListener("click", openDatasheet);
  $("btnTour").addEventListener("click", startTour);

  // ------------------------------------------------------------------ update and draw
  function draw() {
    if (!R) return;
    if (S.tab === "plant") drawPlant(); else if (S.tab === "ph") drawPH(); else if (S.tab === "ts") drawTS();
    else if (S.tab === "hx" && R.cyc.ok) {
      drawHX("chartCond", "tipCond", R.cond, css("--warn"), css("--s2"), T("water"));
      drawHX("chartEvap", "tipEvap", R.evap, css("--warn"), css("--s1"), S.source === "air" ? T("air") : T("source"));
      $("legHX").innerHTML = "<span><i style='background:" + css("--warn") + "'></i>" + T("refrigerant") + "</span><span><i style='background:" + css("--s2") + "'></i>" + T("heating water") + "</span><span><i style='background:" + css("--s1") + "'></i>" + (S.source === "air" ? T("air") : T("source")) + "</span><span>" + T("dashed lines: desuperheating · condensing · subcooling, and evaporating · superheating") + "</span>";
    } else if (S.tab === "energy") drawEnergy();
    else if (S.tab === "cmp") compare();
    else if (S.tab === "year") drawYear();
  }
  function update() {
    R = compute();
    var L = R.load;
    $("loadResult").textContent = S.loadMode === "calc" ? T("Heat load {t} kW: building {b} kW (H = {H} W/K) + hot water {d} kW", { t: num(L.total, 3), b: num(L.building, 3), H: n0(L.H), d: num(L.dhw, 2) }) : T("Heat load {t} kW", { t: num(L.total, 3) });
    renderKpis(); alerts(); states(); components(); draw();
  }
  document.querySelector(".tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return; S.tab = b.dataset.tab; showTab(); draw(); sync();
  });
  function showTab() {
    document.querySelectorAll(".tabs button").forEach(function (x) { x.setAttribute("aria-selected", String(x.dataset.tab === S.tab)); });
    document.querySelectorAll(".tabpane").forEach(function (p) { p.hidden = p.dataset.pane !== S.tab; });
  }
  [["chartPH", "tipPH"], ["chartTS", "tipTS"], ["chartCond", "tipCond"], ["chartEvap", "tipEvap"], ["chartEnergy", "tipEnergy"], ["chartYear", "tipYear"], ["chartBins", "tipBins"]].forEach(function (a) { hook(a[0], a[1]); });
  window.addEventListener("resize", draw);
  showTab(); sync(); update();
  // ?sheet=1 opens the datasheet straight away (a link to it, or printing it to PDF)
  try { if (new URLSearchParams(location.search).get("sheet")) openDatasheet(); } catch (e) { /* no datasheet */ }
  window.__hps = { S: S, get R() { return R; }, update: update, sync: sync };
})();
