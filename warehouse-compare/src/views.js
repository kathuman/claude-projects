/*
 * views.js — the three comparison views: Side by side (the animation),
 * Sensitivity (a sweep of one input) and Demand shock (the put-away policies
 * through a change in demand). app.js owns the inputs and results; this file
 * draws into #viewSide, #viewSens and #viewShock when they are shown.
 */
(function (root) {
  "use strict";
  const $ = function (id) { return document.getElementById(id); };
  const COLORS = { A: "#3987e5", B: "#d95926", C: "#199e70" };                       // validated on the navy surface, all pairs
  const POLICY = { fixed: "#c98500", random: "#d55181", nearest: "#0ca30c", frequency: "#9085e9" };   // adjacent pairs
  const T = function (s, v) { return WC.t.T(s, v); };
  function policyName(pa) { return { fixed: T("Fixed home slot"), random: T("Random free slot"), nearest: T("Nearest free slot"), frequency: T("By popularity rank") }[pa]; }
  const NAMES = { A: "WH-A", B: "WH-B", C: "WH-C" };
  let ctx = null;                       // { inputs(), results(), span() }
  const fmt = function (v, d) { return Number(v).toLocaleString(WC.t.locale(), { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const unitText = function (u) { return u === "lines/h" ? T("lines/h") : u; };

  // ================================================================ side by side
  const side = { reps: null, cells: {}, t: 0, playing: false, speed: 30, last: 0, stale: true };
  function sideBuild() {
    const res = ctx.results(), sc = ctx.inputs().sc;
    $("sideNote").textContent = T("preparing…");
    setTimeout(function () {
      side.reps = { A: WC.replay.robots(res.A, sc, ctx.inputs().layouts.A), B: WC.replay.pickers(res.B, sc), C: WC.replay.pickers(res.C, sc) };
      side.t = 0; side.stale = false;
      sideLayout();
      $("sideNote").textContent = T("20 minutes of the peak hour, the same orders in all three (WH-A after its {h} h settling run).", { h: ctx.inputs().layouts.A.warmup_hours });
      sideDraw();
    }, 20);
  }
  function sideLayout() {
    const res = ctx.results(), span = ctx.span();
    ["A", "B", "C"].forEach(function (id) {
      const cv = $("side" + id), r = res[id];
      // one scale for all three: each canvas is as tall as the widest building's proportions need
      cv.style.height = Math.round((cv.clientWidth - 48) * span[1] / span[0] + 62) + "px";
      const view = WC.plan.draw(cv, r, { sc: ctx.inputs().sc, color: "pop", span: span });
      const off = document.createElement("canvas"); off.width = cv.width; off.height = cv.height;
      off.getContext("2d").drawImage(cv, 0, 0);
      side.cells[id] = { cv: cv, view: view, off: off };
    });
  }
  function sideDraw() {
    if (!side.reps) return;
    const dpr = window.devicePixelRatio || 1;
    ["A", "B", "C"].forEach(function (id) {
      const cell = side.cells[id], rep = side.reps[id], c = cell.cv.getContext("2d"), v = cell.view;
      c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(cell.off, 0, 0); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      let moving = 0;
      rep.movers.forEach(function (m) {
        const p = WC.replay.at(m, side.t), x = v.X(p.x), y = v.Y(p.y);
        if (p.moving) moving++;
        if (rep.kind === "robot") {
          const loaded = p.kind === "toStation" || p.kind === "toSlot" || p.kind === "atStation";
          c.fillStyle = loaded ? "#ffd166" : "#ffffff"; c.strokeStyle = "#04202b"; c.lineWidth = 1;
          const h = loaded ? 4 : 2.5; c.fillRect(x - h, y - h, 2 * h, 2 * h); c.strokeRect(x - h, y - h, 2 * h, 2 * h);
        } else {
          c.fillStyle = "#ffffff"; c.strokeStyle = "#04202b"; c.lineWidth = 1.5;
          c.beginPath(); c.arc(x, y, 4, 0, 2 * Math.PI); c.fill(); c.stroke();
        }
      });
      const lines = WC.replay.linesBy(rep, side.t);
      $("sideCount" + id).textContent = rep.kind === "robot" ? T("{l} lines picked · {m} of {n} robots moving", { l: fmt(lines, 0), m: moving, n: rep.movers.length })
        : T("{l} lines picked · {m} of {n} pickers walking", { l: fmt(lines, 0), m: moving, n: rep.movers.length });
    });
    const mm = Math.floor(side.t / 60), ss = Math.floor(side.t % 60);
    $("sideClock").textContent = mm + ":" + (ss < 10 ? "0" : "") + ss + " / 20:00";
  }
  function sideTick(ts) {
    if (!side.playing) return;
    const dt = side.last ? Math.min(0.1, (ts - side.last) / 1000) : 0; side.last = ts;
    side.t = Math.min(side.reps.A.window, side.t + dt * side.speed);
    sideDraw();
    if (side.t >= side.reps.A.window) { sidePlay(false); return; }
    requestAnimationFrame(sideTick);
  }
  function sidePlay(on) {
    side.playing = on; side.last = 0; $("sidePlay").textContent = on ? T("Pause") : T("Play");
    if (on) { if (side.t >= side.reps.A.window) side.t = 0; requestAnimationFrame(sideTick); }
  }

  // ================================================================ sensitivity
  const sens = { token: 0 };
  function sensRun() {
    const key = $("sensInput").value, mkey = $("sensMeasure").value, sw = WC.experiments.SWEEPS.find(function (s) { return s.key === key; });
    const def = WC.kpi.KPI_DEFS.find(function (d) { return d.key === mkey; }), inputs = ctx.inputs(), tok = ++sens.token, pts = [];
    const ids = ["A", "B", "C"].filter(function (id) { return WC.kpi.applies(def, id); });
    let i = 0;
    function draw() {
      WC.charts.lineChart($("sensChart"), {
        title: T("{m} as {i} changes", { m: T(def.label), i: T(sw.label).toLowerCase() }),
        xLabel: T(sw.label) + (sw.unit ? " (" + sw.unit + ")" : ""), xName: T(sw.label), yLabel: T(def.label) + (def.unit ? " (" + unitText(def.unit) + ")" : ""),
        xTicks: sw.values, xFmt: function (v) { return fmt(v, 0); }, yFmt: function (v) { return fmt(v, def.d); },
        series: ids.map(function (id) { return { name: NAMES[id], color: COLORS[id], points: pts.map(function (p) { return { x: p.x, y: p.r[id] ? p.r[id][mkey] : NaN }; }) }; }),
        marks: [{ x: inputs.sc[key], label: T("now") }]
      });
    }
    function next() {
      if (tok !== sens.token) return;
      if (i >= sw.values.length) { $("sensNote").textContent = ids.indexOf("A") >= 0 ? T("Each point re-sizes all three warehouses to the same capacity and re-simulates WH-A.") : T("Each point re-sizes all three warehouses to the same capacity."); return; }
      $("sensNote").textContent = T("computing {i} of {n}…", { i: i + 1, n: sw.values.length });
      pts.push({ x: sw.values[i], r: WC.experiments.point(inputs, key, sw.values[i]) }); i++;
      draw(); setTimeout(next, 0);
    }
    setTimeout(next, 0);
  }

  // ================================================================ demand shock
  const shock = { token: 0 };
  function shockRun() {
    const tok = ++shock.token, inputs = ctx.inputs(), res = ctx.results();
    const shift = Number($("shockShift").value), head = Number($("shockHead").value), robots = Math.round(res.A.sizing.robotsActive * (1 + head));
    $("shockNote").textContent = T("simulating the four policies…");
    setTimeout(function () {
      if (tok !== shock.token) return;
      const s = WC.experiments.shock(inputs, res, { shift: shift, robots: robots, step_s: 1800 });
      const pol = WC.experiments.POLICIES, at = s.at, mean = WC.experiments.mean;
      const series = function (field, scale) { return pol.map(function (pa) { return { name: policyName(pa), color: POLICY[pa], points: s.series[pa].filter(function (p) { return p.t > 1; }).map(function (p) { return { x: p.t, y: p[field] * (scale || 1) }; }) }; }); };
      const hours = function (v) { return T("{v} h", { v: fmt(v, v % 1 ? 1 : 0) }); };
      WC.charts.lineChart($("shockTravel"), { title: T("WH-A: robot travel per line"), xLabel: T("Simulated time (h)"), xName: T("Time"), yLabel: T("m per line"), xFmt: hours, yFmt: function (v) { return fmt(v, 0); }, series: series("travel"), marks: [{ x: at, label: T("demand shifts") }] });
      WC.charts.lineChart($("shockWait"), { title: T("WH-A: wait for a station ({n} robots working)", { n: robots }), xLabel: T("Simulated time (h)"), xName: T("Time"), yLabel: T("minutes"), xFmt: hours, yFmt: function (v) { return fmt(v, 1); }, series: series("wait", 1 / 60), marks: [{ x: at, label: T("demand shifts") }] });
      // before → after table
      const rows = pol.map(function (pa) { const b = mean(s.series[pa], "travel", at - 2, at), a = mean(s.series[pa], "travel", at + 2, at + s.after); return ["WH-A · " + policyName(pa), b, a, T("robot")]; })
        .concat(["B", "C"].map(function (id) { return [NAMES[id] + " · " + T("slotting unchanged"), s.static[id].before, s.static[id].after, T("picker")]; }));
      const tb = $("shockTable"); tb.innerHTML = "";
      const hr = document.createElement("tr"); ["", T("Travel per line before"), T("2–4 h after"), T("Change")].forEach(function (h) { const th = document.createElement("th"); th.textContent = h; hr.appendChild(th); }); tb.appendChild(hr);
      rows.forEach(function (r) {
        const tr = document.createElement("tr"), pct = 100 * (r[2] / r[1] - 1);
        [r[0], fmt(r[1], 1) + " m (" + r[3] + ")", fmt(r[2], 1) + " m", (pct > 0 ? "+" : "") + fmt(pct, 0) + "%"].forEach(function (v, k) {
          const td = document.createElement("td"); td.textContent = v; if (k === 3) td.className = pct > 10 ? "worse" : pct < -10 ? "better" : "same"; tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      $("shockNote").textContent = T("At {h} h the best-sellers become the SKUs {p}% of the way down the ranking. WH-A: all four policies on the same floor with the same {n} robots; WH-B and WH-C keep their slotting.", { h: at, p: Math.round(shift * 100), n: robots });
    }, 20);
  }

  // ================================================================ wiring
  function init(c) {
    ctx = c;
    $("sidePlay").onclick = function () { if (side.reps) sidePlay(!side.playing); };
    $("sideRestart").onclick = function () { side.t = 0; sideDraw(); };
    $("sideSpeed").onchange = function () { side.speed = Number($("sideSpeed").value); };
    const si = $("sensInput"), sm = $("sensMeasure");
    WC.experiments.SWEEPS.forEach(function (s) { const o = document.createElement("option"); o.value = s.key; o.textContent = T(s.label); si.appendChild(o); });
    WC.kpi.KPI_DEFS.forEach(function (d) { const o = document.createElement("option"); o.value = d.key; o.textContent = T(d.label); sm.appendChild(o); });
    si.value = "demand_skew"; sm.value = "pickersNeeded";
    si.onchange = sm.onchange = sensRun;
    $("shockShift").onchange = $("shockHead").onchange = shockRun;
    window.addEventListener("resize", function () { if (current === "side" && side.reps) { sideLayout(); sideDraw(); } });
  }
  let current = null, dirty = { side: true, sens: true, shock: true };
  function show(view) {
    current = view;
    if (!dirty.hasOwnProperty(view)) return;
    if (view !== "side" && side.playing) sidePlay(false);
    if (!dirty[view]) return;
    dirty[view] = false;
    if (view === "side") sideBuild(); else if (view === "sens") sensRun(); else if (view === "shock") shockRun();
  }
  // results changed: every view is out of date; redo the one on screen
  function invalidate() {
    dirty = { side: true, sens: true, shock: true };
    if (side.playing) sidePlay(false);
    side.reps = null;
    if (current) show(current);
  }

  root.WC = root.WC || {}; root.WC.views = { init: init, show: show, invalidate: invalidate, COLORS: COLORS, POLICY: POLICY };
})(typeof self !== "undefined" ? self : this);
