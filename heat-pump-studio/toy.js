// Heat Pump Studio — the toy heat pump page: build the loop from parts (drag or tap), then run it between two buckets
// with the physics in src/toy.js. Every user-visible message goes through T(english, vars).
(function () {
  "use strict";
  var I18 = window.HPSi18n, T = I18.T, fx = I18.fx, Y = window.HPStoy;
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = "http://www.w3.org/2000/svg";
  var SLOTS = ["top", "bottom", "left", "right"];
  var slots = { top: null, bottom: null, left: null, right: null }, selected = null;
  var run = null, hist = [], playing = false, last = 0, build = null, logged = 0, lastHist = -1e9;
  var END = 12 * 3600;

  function name(p) {
    return { comp: T("Compressor"), valve: T("Expansion valve"), coilS: T("Small coil"), coilL: T("Large coil"), pump: T("Water pump"), heater: T("Electric heater") }[p];
  }
  // part drawings, centred on (0, 0), about 70 × 34
  function glyph(p) {
    switch (p) {
      case "comp": return "<circle r='16' class='g-comp'/><path d='M-9 -12 L12 -5 M-9 12 L12 5' class='g-line'/>";
      case "valve": return "<path d='M-18 -11 L18 11 L18 -11 L-18 11 Z' class='g-valve'/>";
      case "coilS": return "<path d='M-26 0 q6.5 -14 13 0 t13 0 t13 0 t13 0' class='g-coil'/>";
      case "coilL": return "<path d='M-30 0 q4.3 -14 8.6 0 t8.6 0 t8.6 0 t8.6 0 t8.6 0 t8.6 0 t8.6 0' class='g-coil'/>";
      case "pump": return "<circle r='16' class='g-pump'/><path d='M-8 -13 L16 0 L-8 13' class='g-line'/>";
      case "heater": return "<path d='M-28 0 H-18 L-14 -10 L-8 10 L-2 -10 L4 10 L10 -10 L14 0 H28' class='g-heat'/>";
    }
    return "";
  }
  function left(p) { return Y.INVENTORY[p] - SLOTS.filter(function (s) { return slots[s] === p; }).length; }

  // ---- the parts box
  function renderTray() {
    $("tray").innerHTML = Object.keys(Y.INVENTORY).map(function (p) {
      var n = left(p);
      return "<button type='button' class='chip" + (selected === p ? " sel" : "") + "' data-part='" + p + "'" + (n ? "" : " disabled") + " aria-pressed='" + (selected === p) + "'>" +
        "<svg viewBox='-38 -20 76 40' aria-hidden='true'><g>" + glyph(p) + "</g></svg><span>" + name(p) + "</span><em>×" + n + "</em></button>";
    }).join("");
  }
  function renderSlots() {
    SLOTS.forEach(function (s) {
      var g = $("slot-" + s), r = g.querySelector("rect"), inner = g.querySelector(".slot-in");
      var x = +r.getAttribute("x") + 50, y = +r.getAttribute("y") + +r.getAttribute("height") / 2, p = slots[s];
      g.classList.toggle("full", !!p);
      g.setAttribute("aria-label", p ? T("{part}: tap to take it out", { part: name(p) }) : T("Empty place: put a part here"));
      inner.innerHTML = p ? "<g transform='translate(" + x + " " + (y - 7) + ")'>" + glyph(p) + "</g><text x='" + x + "' y='" + (y + 21) + "' class='slot-t'>" + name(p) + "</text>"
        : "<text x='" + x + "' y='" + (y + 5) + "' class='slot-q'>?</text>";
    });
  }
  var MSG = {
    empty: function () { return T("Fill all four places."); },
    compInBucket: function () { return T("The compressor doesn't go in the water. The coils go in the buckets: that is where heat goes in and out."); },
    valveInBucket: function () { return T("The valve doesn't go in the water. The coils go in the buckets: that is where heat goes in and out."); },
    pumpInBucket: function () { return T("The water pump doesn't belong in the bucket. The coils go in the buckets."); },
    heaterInBucket: function () { return T("An electric heater in the bucket would warm it, but only with the heat of its own electricity (COP = 1), and it can't cool the other bucket. Use the coils."); },
    coilInPipe: function () { return T("A coil in the pipe between the buckets does nothing useful. The pipes need a compressor to squeeze the refrigerant and a valve to let it expand."); },
    pump: function () { return T("A water pump moves liquids. It can't squeeze a gas, so the refrigerant would never get hot enough. Use the compressor."); },
    heater: function () { return T("An electric heater only turns electricity into heat (COP = 1). A heat pump moves extra heat from the cold side. Use the compressor and the valve."); },
    noValve: function () { return T("Something has to let the pressure down again: put the expansion valve in the other pipe."); },
    noComp: function () { return T("Nothing pushes the refrigerant round. Put the compressor in one of the pipes."); }
  };
  function renderCheck() {
    build = Y.check(slots);
    var html;
    if (build.ok) {
      var side = build.hot === "right" ? T("right") : T("left"), other = build.hot === "right" ? T("left") : T("right");
      html = "<p class='ok'>✔ " + T("It works! The compressor squeezes the refrigerant vapour, so it gets hot and gives its heat to the {hot} bucket. The valve lets it expand, so it gets cold and takes heat from the {cold} bucket.", { hot: side, cold: other }) + "</p>";
      if (build.reversed) html += "<p>" + T("The compressor is in the bottom pipe, so it pushes the hot refrigerant into the left coil: the left bucket gets hot. That works too. Reversible heat pumps switch between heating and cooling this way.") + "</p>";
      html += "<p class='dim'>" + T("Hot side coil: {a}. Cold side coil: {b}.", { a: name(slots[build.hot]), b: name(slots[build.cold]) }) + "</p>";
    } else {
      html = "<ul>" + build.problems.map(function (c) { return "<li>" + MSG[c]() + "</li>"; }).join("") + "</ul>";
    }
    $("check").innerHTML = html;
    $("check").className = "toy-check " + (build.ok ? "good" : "todo");
    $("bRun").disabled = !build.ok;
  }
  function changed() {
    selected = selected && left(selected) > 0 ? selected : null;
    renderTray(); renderSlots(); renderCheck(); reset();
  }
  function place(p, s) {
    if (!p || left(p) <= 0 && slots[s] !== p) return;
    slots[s] = p; selected = null; changed();
  }

  // tap: select a part, then a place; tap a full place to empty it
  $("tray").addEventListener("click", function (e) {
    var b = e.target.closest(".chip"); if (!b || b.disabled || dragMoved) return;
    selected = selected === b.dataset.part ? null : b.dataset.part; renderTray();
  });
  function slotAct(s) {
    if (selected) place(selected, s);
    else if (slots[s]) { slots[s] = null; changed(); }
  }
  SLOTS.forEach(function (s) {
    var g = $("slot-" + s);
    g.addEventListener("click", function () { slotAct(s); });
    g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); slotAct(s); } });
  });
  // drag: a ghost follows the pointer; dropping on a place puts the part there
  var drag = null, dragMoved = false;
  $("tray").addEventListener("pointerdown", function (e) {
    var b = e.target.closest(".chip"); if (!b || b.disabled) return;
    drag = { p: b.dataset.part, x: e.clientX, y: e.clientY, ghost: null }; dragMoved = false;
  });
  window.addEventListener("pointermove", function (e) {
    if (!drag) return;
    if (!drag.ghost && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
      dragMoved = true;
      drag.ghost = document.createElement("div"); drag.ghost.className = "ghost";
      drag.ghost.innerHTML = "<svg viewBox='-38 -20 76 40'><g>" + glyph(drag.p) + "</g></svg>";
      document.body.appendChild(drag.ghost);
    }
    if (drag.ghost) {
      e.preventDefault();
      drag.ghost.style.left = e.clientX + "px"; drag.ghost.style.top = e.clientY + "px";
      var over = document.elementFromPoint(e.clientX, e.clientY), sl = over && over.closest && over.closest(".slot");
      SLOTS.forEach(function (s) { $("slot-" + s).classList.toggle("over", !!sl && sl.dataset.slot === s); });
    }
  }, { passive: false });
  window.addEventListener("pointerup", function (e) {
    if (!drag) return;
    var d = drag; drag = null;
    if (d.ghost) {
      d.ghost.remove();
      var over = document.elementFromPoint(e.clientX, e.clientY), sl = over && over.closest && over.closest(".slot");
      SLOTS.forEach(function (s) { $("slot-" + s).classList.remove("over"); });
      if (sl) place(d.p, sl.dataset.slot);
      setTimeout(function () { dragMoved = false; }, 0);
    }
  });
  $("bShow").addEventListener("click", function () { slots = { top: "comp", bottom: "valve", left: "coilL", right: "coilL" }; selected = null; changed(); });
  $("bClear").addEventListener("click", function () { slots = { top: null, bottom: null, left: null, right: null }; selected = null; changed(); });

  // ---- running it
  function cfg() {
    return { fluid: $("sF").value, W: +$("sW").value, uaHot: build.uaHot, uaCold: build.uaCold, litres: +$("sL").value,
      Tstart: +$("sT").value, Troom: 20, insulated: $("sI").value === "1", hot: build.hot };
  }
  function reset() {
    playing = false; run = null; hist = []; logged = 0; lastHist = -1e9;
    $("bRun").textContent = T("Switch on");
    $("rig").classList.remove("running");
    $("log").innerHTML = "";
    var T0 = +$("sT").value;
    paint({ Th: T0, Tc: T0, ice: 0 }, null);
    $("out").innerHTML = "<p class='dim'>" + (build && build.ok ? T("Ready. Press “Switch on”.") : T("Build the heat pump first.")) + "</p>";
    charts();
  }
  function water(T) {                                   // blue when cold, red when hot
    var u = Math.max(0, Math.min(1, T / 60)), a = [42, 111, 176], b = [196, 78, 52];
    return "rgb(" + a.map(function (v, i) { return Math.round(v + (b[i] - v) * u); }).join(",") + ")";
  }
  function paint(n, r) {
    var hot = build && build.ok ? build.hot : "right", L = hot === "left" ? n.Th : n.Tc, R = hot === "left" ? n.Tc : n.Th;
    var iceL = hot === "left" ? 0 : n.ice || 0, iceR = hot === "left" ? n.ice || 0 : 0;
    $("waterL").setAttribute("fill", water(L)); $("waterR").setAttribute("fill", water(R));
    $("iceL").setAttribute("height", 160 * iceL); $("iceR").setAttribute("height", 160 * iceR);
    $("tempL").textContent = fx(L, 1) + " °C"; $("tempR").textContent = fx(R, 1) + " °C";
    var rig = $("rig"); rig.classList.toggle("running", !!(r && r.on && playing));
    rig.classList.toggle("rev", !!(build && build.reversed));
  }
  function clock(t) { var h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60); return T("{h} h {m} min", { h: h, m: m < 10 ? "0" + m : m }); }
  function readouts() {
    var n = run.now, wh = function (j) { return fx(j / 3600, 0) + " Wh"; };
    var rows = [
      [T("Time"), clock(run.t)],
      [T("Hot bucket"), fx(n.Th, 1) + " °C"], [T("Cold bucket"), fx(n.Tc, 1) + " °C" + (n.ice > 0 ? " · " + T("{p} % ice", { p: fx(n.ice * 100, 0) }) : "")],
      [T("Heat into the hot bucket"), fx(n.Qhot, 0) + " W"], [T("Heat taken from the cold bucket"), fx(n.Qcold, 0) + " W"],
      [T("Electricity"), fx(n.W, 0) + " W"],
      [T("COP now"), run.on ? fx(n.cop, 2) : "—"], [T("Best possible (Carnot)"), run.on && n.carnot < 100 ? fx(n.carnot, 1) : "—"]
    ];
    if (run.on && n.Tcond != null) {
      rows.push([T("Refrigerant condensing"), fx(n.Tcond, 0) + " °C · " + fx(n.pc, 1) + " bar"]);
      rows.push([T("Refrigerant evaporating"), fx(n.Tevap, 0) + " °C · " + fx(n.pe, 1) + " bar"]);
    } else rows.push([T("Compressor"), run.trip ? T("stopped by the safety switch") : T("off")]);
    rows.push([T("Electricity used so far"), wh(run.Eel)], [T("Heat delivered so far"), wh(run.Ehot)],
      [T("Average COP"), run.Eel > 0 ? fx(run.Ehot / run.Eel, 2) : "—"]);
    $("out").innerHTML = "<dl class='t-dl'>" + rows.map(function (r) { return "<div><dt>" + r[0] + "</dt><dd>" + r[1] + "</dd></div>"; }).join("") + "</dl>";
  }
  var EV = {
    ice: function () { return T("The cold bucket reached 0 °C and ice is forming. It stays at 0 °C until it has frozen: freezing gives up 334 kJ for every kilogram."); },
    frozen: function () { return T("The cold bucket has frozen solid. Now it gets colder than 0 °C."); },
    tripHigh: function () { return T("The high-pressure switch stopped the compressor: the refrigerant had to condense above {t} °C to heat the hot bucket further. Larger coils or a smaller compressor keep the pressure down.", { t: Y.TRIP_COND }); },
    tripLow: function () { return T("The low-pressure switch stopped the compressor: the refrigerant had to evaporate below {t} °C.", { t: Y.TRIP_EVAP }); },
    end: function () { return T("12 hours have passed: the experiment is over."); }
  };
  function logEvents() {
    while (logged < run.events.length) {
      var e = run.events[logged++], li = document.createElement("li");
      li.innerHTML = "<b>" + clock(e.t) + "</b> " + EV[e.code]();
      $("log").appendChild(li);
      if (e.code === "tripHigh" || e.code === "tripLow") $("bRun").textContent = T("Reset the safety switch");
    }
  }
  function frame(ts) {
    if (!playing || !run) return;
    var dtReal = Math.min(0.1, (ts - last) / 1000); last = ts;
    var sim = dtReal * +$("sS").value, steps = Math.min(400, Math.ceil(sim / 5));
    for (var i = 0; i < steps && run.t < END; i++) {
      Y.step(run, sim / steps);
      if (run.t - lastHist >= 60) { lastHist = run.t; hist.push({ t: run.t, Th: run.now.Th, Tc: run.now.Tc, cop: run.on ? run.now.cop : null, car: run.on ? run.now.carnot : null }); }
    }
    if (run.t >= END) { run.events.push({ t: run.t, code: "end" }); playing = false; $("bRun").textContent = T("Switch on"); $("bRun").disabled = true; }
    paint(run.now, run); readouts(); logEvents(); charts();
    if (playing) requestAnimationFrame(frame);
  }
  $("bRun").addEventListener("click", function () {
    if (!build || !build.ok) return;
    if (!run) run = Y.create(cfg());
    if (run.trip) { run.on = true; run.trip = null; playing = true; } else playing = !playing;
    $("bRun").textContent = playing ? T("Pause") : T("Switch on");
    if (playing) { last = performance.now(); requestAnimationFrame(frame); }
    paint(run.now, run); readouts();
  });
  $("bReset").addEventListener("click", function () { reset(); if (build && build.ok) $("bRun").disabled = false; });
  ["sW", "sF", "sL", "sT", "sI"].forEach(function (id) { $(id).addEventListener("change", function () { reset(); if (build && build.ok) $("bRun").disabled = false; }); });

  // ---- charts: temperatures, and COP with the Carnot limit (each its own y axis; hover shows the values)
  var css = getComputedStyle(document.documentElement), C = function (v) { return css.getPropertyValue(v).trim(); };
  var hover = { chT: null, chC: null };
  function chart(id, series, yMin, yMax, fmt) {
    var cv = $(id), dpr = window.devicePixelRatio || 1;
    if (!cv.dataset.h) cv.dataset.h = cv.getAttribute("height");
    var w = cv.clientWidth || 300, h = +cv.dataset.h;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + "px";
    var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    var L = 40, R = 10, Tp = 10, B = 26, tMax = Math.max(3600, hist.length ? hist[hist.length - 1].t : 0);
    tMax = Math.ceil(tMax / 3600) * 3600;
    var X = function (t) { return L + (w - L - R) * t / tMax; }, Yp = function (v) { return Tp + (h - Tp - B) * (1 - (v - yMin) / (yMax - yMin)); };
    g.font = "11px 'IBM Plex Mono', monospace"; g.fillStyle = C("--ink-faint"); g.strokeStyle = C("--grid"); g.lineWidth = 1;
    var stepY = [1, 2, 5, 10, 20, 50].filter(function (q) { return (yMax - yMin) / q <= 6; })[0] || 50;
    for (var v = Math.ceil(yMin / stepY) * stepY; v <= yMax + 1e-9; v += stepY) { var y = Yp(v); g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke(); g.textAlign = "right"; g.fillText(fx(v, 0), L - 5, y + 4); }
    var hs = tMax / 3600, every = hs <= 6 ? 1 : 2;
    g.textAlign = "center";
    for (var hh = 0; hh <= hs; hh += every) g.fillText(hh + " h", X(hh * 3600), h - 8);
    g.save(); g.beginPath(); g.rect(L, Tp, w - L - R, h - Tp - B); g.clip();
    series.forEach(function (s) {
      g.strokeStyle = s.color; g.lineWidth = 2; g.setLineDash(s.dash ? [5, 4] : []); g.beginPath();
      var on = false;
      hist.forEach(function (p) { var v = p[s.key]; if (v == null) { on = false; return; } var x = X(p.t), y = Yp(v); if (on) g.lineTo(x, y); else g.moveTo(x, y); on = true; });
      g.stroke();
    });
    g.restore(); g.setLineDash([]);
    var hi = hover[id];
    if (hi != null && hist[hi]) {
      var p = hist[hi], x = X(p.t);
      g.strokeStyle = C("--ink-faint"); g.beginPath(); g.moveTo(x, Tp); g.lineTo(x, h - B); g.stroke();
      series.forEach(function (s) { var v = p[s.key]; if (v == null || v > yMax) return; g.fillStyle = s.color; g.strokeStyle = C("--panel-2"); g.lineWidth = 2; g.beginPath(); g.arc(x, Yp(v), 4.5, 0, 7); g.fill(); g.stroke(); });
      var tip = $(id + "tip");
      tip.innerHTML = "<b>" + clock(p.t) + "</b>" + series.map(function (s) { return p[s.key] == null ? "" : "<br><i style='background:" + s.color + "'></i>" + s.label + ": " + fmt(p[s.key]); }).join("");
      tip.hidden = false; tip.style.left = Math.min(x + 10, w - 170) + "px";
    } else if ($(id + "tip")) $(id + "tip").hidden = true;
    cv._X = X; cv._L = L;
  }
  function legend(id, series) {
    $(id).innerHTML = series.map(function (s) { return "<span><i class='" + (s.dash ? "dash" : "") + "' style='--c:" + s.color + "'></i>" + s.label + "</span>"; }).join("");
  }
  function charts() {
    var ts = [{ key: "Th", label: T("Hot bucket"), color: C("--s2") }, { key: "Tc", label: T("Cold bucket"), color: C("--s1") }];
    var cs = [{ key: "cop", label: T("COP of the toy"), color: C("--s3") }, { key: "car", label: T("Carnot limit"), color: C("--s4"), dash: true }];
    var lo = Math.min(0, Math.floor(Math.min.apply(null, hist.map(function (p) { return p.Tc; }).concat([+$("sT").value])) / 10) * 10);
    var hi = Math.max(40, Math.ceil(Math.max.apply(null, hist.map(function (p) { return p.Th; }).concat([0])) / 10) * 10);
    chart("chT", ts, lo, hi, function (v) { return fx(v, 1) + " °C"; });
    var top = Math.max.apply(null, hist.map(function (p) { return Math.max(p.cop || 0, Math.min(12, p.car || 0)); }).concat([4]));
    var copMax = Math.min(12, Math.ceil(top * 1.15));
    chart("chC", cs, 0, copMax, function (v) { return v > 99 ? "> 99" : fx(v, 2); });
    legend("legT", ts); legend("legC", cs);
  }
  ["chT", "chC"].forEach(function (id) {
    var cv = $(id), tip = document.createElement("div");
    tip.className = "t-tip"; tip.id = id + "tip"; tip.hidden = true; cv.parentNode.style.position = "relative"; cv.parentNode.appendChild(tip);
    cv.addEventListener("pointermove", function (e) {
      if (!hist.length || !cv._X) return;
      var rect = cv.getBoundingClientRect(), x = e.clientX - rect.left, best = 0, bd = 1e9;
      hist.forEach(function (p, i) { var d = Math.abs(cv._X(p.t) - x); if (d < bd) { bd = d; best = i; } });
      hover[id] = best; charts();
    });
    cv.addEventListener("pointerleave", function () { hover[id] = null; charts(); });
  });
  window.addEventListener("resize", charts);

  renderTray(); renderSlots(); renderCheck(); reset();
})();
