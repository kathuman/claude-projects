/*
 * app.js — wires model.js (parameters) + calculations.js (analytical
 * model) + visualization.js (3D) + blueprint.js (floor plan) into the page.
 * This file owns the DOM; the others don't know the DOM exists.
 */
(function () {
  "use strict";

  // Version history
  //   1.0.0  Phase 1: FreeCAD model, analytical model with traceability, live 3D, KPIs, charts
  //   2.0.0  trustworthy core: rack types (selective, double-deep, VNA, push-back, drive-in),
  //          flue space, level pitch and sprinkler clearance checks, practical capacity and
  //          selectivity, exact travel + lift cycle time over the real layout, truck-based
  //          inbound/outbound docks with a peak-hour factor, fleet efficiency; unit tests and a
  //          FreeCAD/web parity test; live floor plan; typed values; metric/imperial
  //   3.0.0  3D view you can read: three.js r186 (image-based lighting, shadows, orbit/pan),
  //          instanced uprights, beams and pallets filled to the inventory, a travel-time heat
  //          map of every position, click a slot for its route and cycle times, trailers at busy doors
  //   4.0.0  operations: I-flow vs U-flow docks, mid cross-aisles, class-based (ABC) slotting with a
  //          demand-skew curve, dual-command trips, Erlang C truck queueing at the doors; ABC-class view
  //   5.0.0  discrete-event simulation of the day (random truck arrivals over an hourly profile, yard
  //          queues, doors held by slow loading, lift-truck tasks from the per-slot times), 30 days of
  //          Monte Carlo with ranges beside the analytic results, hourly chart, 3D playback of a day
  //   6.0.0  decision support: annual total cost of ownership (capital recovery, drivers, running
  //          cost), saved scenarios compared side by side, share links, JSON/CSV export, a ±10%
  //          tornado and parameter sweeps, and an optimiser for the cheapest design meeting targets
  const APP_VERSION = "6.0.0";

  const model = new window.WH.ParameterModel();
  const calc = window.WH.calc;
  let viz = null;
  let results = null;

  const railEl = document.getElementById("rail-params");
  const stageEl = document.getElementById("stage");
  const kpiEl = document.getElementById("kpi-grid");
  const warningsEl = document.getElementById("warnings");
  const traceEl = document.getElementById("trace-panel");
  const chartsEl = document.getElementById("charts");
  const inspectorEl = document.getElementById("inspector");
  const blueprintEl = document.getElementById("blueprint");
  const modeButtons = document.querySelectorAll("[data-viewmode]");

  document.getElementById("ver").textContent = "v" + APP_VERSION;
  document.getElementById("ver-foot").textContent = "v" + APP_VERSION;

  // -------------------------------------------------------------------
  // Units — the model is metric throughout; imperial is display (and typed
  // input) only, so nothing downstream ever sees a converted number.
  // -------------------------------------------------------------------
  const FT = 3.28084, SQFT = 10.7639;
  let imperial = false;
  try { imperial = localStorage.getItem("warehouse-units") === "imperial"; } catch (e) {}
  const UNIT = {
    m:   { metric: ["m", 1], imperial: ["ft", FT] },
    mm:  { metric: ["mm", 1], imperial: ["in", 1 / 25.4] },
    "m/s": { metric: ["m/s", 1], imperial: ["ft/s", FT] }
  };
  function unitOf(u) { const d = UNIT[u]; return d ? d[imperial ? "imperial" : "metric"] : [u, 1]; }
  function lenText(m, dec) { return imperial ? (m * FT).toFixed(dec === undefined ? 0 : dec) + " ft" : m.toFixed(dec === undefined ? 1 : dec) + " m"; }
  function areaText(m2) { return imperial ? Math.round(m2 * SQFT).toLocaleString("en-US") + " ft²" : Math.round(m2).toLocaleString("en-US") + " m²"; }

  // -------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------
  model.load("../data/parameters.json", function (err) {
    if (err) {
      railEl.innerHTML = '<p class="load-error">Could not load parameters.json: ' + err.message + "</p>";
      return;
    }
    buildRail();
    viz = new window.WH.Visualization(stageEl);
    viz.onSelect(renderInspector);
    // a share link (#d=…) carries the parameters that differ from the defaults
    const m = location.hash.match(/^#d=([A-Za-z0-9_-]+)/);
    if (m) {
      try {
        const txt = decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/"))));
        const o = JSON.parse(txt), vals = {};
        for (const k in model.defaults) vals[k] = model.defaults[k];
        for (const k in o) vals[k] = o[k];
        model.setMany(vals);
      } catch (e) { console.warn("Ignoring a malformed share link"); }
    }
    viz._onQuality = function (q) {
      if (q === "low") document.querySelector(".caption").textContent = "Shadows switched off to keep the view smooth on this device · drag to orbit · right-drag to pan · scroll to zoom";
    };
    recompute();
    if (window.WH.initDecisions) window.WH.initDecisions();
    window.addEventListener("resize", function () { viz.resize(); });
    viz.resize();
    requestAnimationFrame(tick);
  });

  function tick() {
    requestAnimationFrame(tick);
    if (viz) viz.render();
  }

  // -------------------------------------------------------------------
  // Rail: one control per parameter, grouped by category, straight from
  // the schema — no parameter is ever hand-coded into the UI twice.
  // -------------------------------------------------------------------
  function buildRail() {
    const byCategory = {};
    for (const name in model.schema) {
      const def = model.schema[name];
      (byCategory[def.category] = byCategory[def.category] || []).push(name);
    }
    window.WH.ParameterModel.CATEGORY_ORDER.forEach(function (cat) {
      const names = byCategory[cat];
      if (!names) return;
      const section = document.createElement("div");
      section.className = "rail-section";
      const h2 = document.createElement("h2");
      h2.textContent = cat;
      section.appendChild(h2);
      names.forEach(function (name) {
        section.appendChild(model.schema[name].type === "choice" ? buildChoiceRow(name) : buildSliderRow(name));
      });
      railEl.appendChild(section);
    });
  }

  function decimalsFor(def, value) {
    if (def.unit === "count" || def.unit === "$" || def.unit === "min" || def.unit === "s" || def.unit === "hr" || def.unit === "mm") return 0;
    return Math.abs(value) < 10 ? 2 : 1;
  }
  function displayValue(name, value) {
    const def = model.schema[name];
    if (def.unit === "$") return "$" + Math.round(value).toLocaleString("en-US");
    const u = unitOf(def.unit), v = value * u[1];
    let text = v.toFixed(decimalsFor(def, v));
    if (def.unit === "×") return text + "×";
    if (u[0] && u[0] !== "count") text += " " + u[0];
    return text;
  }
  function boundText(def, v) {
    const u = unitOf(def.unit);
    const x = v * u[1];
    return def.unit === "$" ? (v >= 1000 ? Math.round(v / 1000) + "k" : String(v)) : String(+x.toFixed(x < 10 ? 2 : 0));
  }

  function buildSliderRow(name) {
    const def = model.schema[name];
    const row = document.createElement("div");
    row.className = "ctrl-row";
    row.title = def.description;

    const head = document.createElement("div");
    head.className = "row-head";
    const label = document.createElement("span");
    label.className = "name";
    label.textContent = name.replace(/_/g, " ");
    const val = document.createElement("button");
    val.type = "button";
    val.className = "val";
    val.title = "Click to type a value";
    val.setAttribute("aria-label", label.textContent + ": click to type a value");
    head.appendChild(label); head.appendChild(val);
    row.appendChild(head);

    const track = document.createElement("div");
    track.className = "slider-track";
    const lo = document.createElement("span"); lo.className = "bound";
    const hi = document.createElement("span"); hi.className = "bound right";
    const input = document.createElement("input");
    input.type = "range";
    input.min = def.minimum; input.max = def.maximum;
    input.step = def.unit === "count" || def.unit === "$" || def.unit === "min" || def.unit === "s" || def.unit === "hr" || def.unit === "mm" ? 1 : (def.maximum - def.minimum > 5 ? 0.1 : 0.01);
    input.setAttribute("aria-label", label.textContent);
    input.addEventListener("input", function () { model.set(name, parseFloat(input.value)); });
    track.appendChild(lo); track.appendChild(input); track.appendChild(hi);
    row.appendChild(track);

    // typed entry, in the displayed unit
    val.addEventListener("click", function () {
      const u = unitOf(def.unit);
      const box = document.createElement("input");
      box.type = "number"; box.className = "val-edit";
      box.step = "any";
      box.value = +(model.get(name) * u[1]).toFixed(4);
      box.setAttribute("aria-label", label.textContent + " (" + (u[0] || "") + ")");
      head.replaceChild(box, val);
      box.focus(); box.select();
      let done = false;
      function commit(apply) {
        if (done) return; done = true;
        if (apply && box.value !== "") model.set(name, parseFloat(box.value) / u[1]);
        head.replaceChild(val, box);
        sync();
      }
      box.addEventListener("keydown", function (e) { if (e.key === "Enter") commit(true); else if (e.key === "Escape") commit(false); });
      box.addEventListener("blur", function () { commit(true); });
    });

    function sync() {
      input.value = model.get(name);
      val.textContent = displayValue(name, model.get(name));
      lo.textContent = boundText(def, def.minimum);
      hi.textContent = boundText(def, def.maximum);
    }
    sync();
    model.onChange(function (changed) { if (changed === null || changed === name || changed === "__units") sync(); });
    return row;
  }

  function buildChoiceRow(name) {
    const def = model.schema[name];
    const row = document.createElement("div");
    row.className = "ctrl-row";
    row.title = def.description;
    const head = document.createElement("div");
    head.className = "row-head";
    const label = document.createElement("span");
    label.className = "name";
    label.textContent = name.replace(/_/g, " ");
    head.appendChild(label);
    row.appendChild(head);
    const sel = document.createElement("select");
    sel.className = "choice";
    sel.setAttribute("aria-label", label.textContent);
    def.options.forEach(function (o) {
      const opt = document.createElement("option");
      opt.value = o;
      opt.textContent = def.labels && def.labels[o] ? def.labels[o] : model.rackTypes[o] ? model.rackTypes[o].label : o;
      sel.appendChild(opt);
    });
    const note = document.createElement("div");
    note.className = "choice-note";
    sel.addEventListener("change", function () { model.set(name, sel.value); });
    row.appendChild(sel);
    row.appendChild(note);
    function sync() {
      sel.value = model.get(name);
      const rt = name === "rack_type" ? model.rackTypes[model.get(name)] : null;
      note.textContent = rt ? rt.deep + " deep · " + Math.round(rt.selectivity * 100) + "% selective · " + rt.truck + ", aisle ≥ " + lenText(rt.min_aisle, 1) : "";
      note.hidden = !rt;
    }
    sync();
    model.onChange(function (changed) { if (changed === null || changed === name || changed === "__units") sync(); });
    return row;
  }

  // -------------------------------------------------------------------
  // Recompute pipeline: parameter change -> analytical model -> KPIs,
  // charts, warnings, traceability, floor plan, 3D view. One call stack.
  // -------------------------------------------------------------------
  model.onChange(function () { recompute(); });

  function recompute() {
    const p = model.getAll();
    results = calc.computeAll(p, model.rackTypes);
    renderKPIs(results, p);
    renderWarnings(results.warnings);
    renderTrace(results);
    renderCharts(results, p);
    renderBlueprint(results, p);
    if (viz) viz.stopDay();
    if (viz && viz.mode === "live") viz.rebuildLive(p, results);
    scheduleSimulation();
    recomputeHooks.forEach(function (f) { f(results); });
  }
  const recomputeHooks = [];

  // -------------------------------------------------------------------
  // Simulated day — Monte Carlo over many random days, re-run shortly
  // after the last change (30 days take a few tens of milliseconds)
  // -------------------------------------------------------------------
  const sim = window.WH.sim;
  let simTimer = null, simResult = null;
  function scheduleSimulation() {
    clearTimeout(simTimer);
    simTimer = setTimeout(runSimulation, 180);
  }
  function simLifts() { return model.get("sim_lift_trucks") || results.travel.forkliftsNeeded; }
  function runSimulation() {
    const p = model.getAll(), t0 = performance.now();
    simResult = sim.runMonteCarlo(p, results, { liftTrucks: simLifts() });
    renderSimulation(simResult, p, results, performance.now() - t0);
  }
  function renderSimulation(mc, p, r, ms) {
    const S = mc.summary, t = r.throughput, tr = r.travel;
    const f0 = function (v) { return isFinite(v) ? Math.round(v).toLocaleString("en-US") : "—"; };
    const f1 = function (v) { return isFinite(v) ? v.toFixed(1) : "—"; };
    const pc = function (v) { return isFinite(v) ? Math.round(v * 100) + "%" : "—"; };
    const range = function (m, f) { return f(S[m].p10) === f(S[m].p90) ? "" : f(S[m].p10) + " – " + f(S[m].p90); };
    const lifts = mc.lifts, hours = p.operating_hours_per_day;
    const rows = [
      ["Truck wait in the peak hour (min)", isFinite(t.maxWait) ? f1(t.maxWait) : "no limit", f1(S.peakHourWait.mean), range("peakHourWait", f1)],
      ["Truck wait, whole day (min)", "—", f1(S.meanWait.mean), range("meanWait", f1)],
      ["Trucks waiting over 30 min", "—", pc(S.shareWaitingOver30.mean), range("shareWaitingOver30", pc)],
      ["Longest yard queue (trucks)", "—", f1(S.maxYard.mean), range("maxYard", f0)],
      ["Door utilization, day (in / out)", pc(t.inbound.utilizationPct / 100 / p.peak_hour_factor) + " / " + pc(t.outbound.utilizationPct / 100 / p.peak_hour_factor), pc(S.doorUtilIn.mean) + " / " + pc(S.doorUtilOut.mean), ""],
      ["Lift-truck utilization (" + lifts + " trucks)", pc(tr.dailyWorkHours / p.truck_efficiency / (lifts * hours)), pc(S.liftUtil.mean), range("liftUtil", pc)],
      ["Dual-command share", pc(tr.dualShare), pc(S.dualShareAchieved.mean), ""],
      ["Most pallets waiting in staging", "—", f0(S.maxStaging.mean), range("maxStaging", f0)],
      ["Tasks left at closing", "—", f0(S.backlogAtClose.mean), range("backlogAtClose", f0)],
      ["Work finishes after closing (min)", "—", f0(S.overtime.mean), range("overtime", f0)]
    ];
    document.getElementById("sim-table").innerHTML = "<thead><tr><th></th><th>Analytic</th><th>Simulated (mean)</th><th>10–90% of days</th></tr></thead><tbody>" +
      rows.map(function (rw) { return "<tr><th>" + rw[0] + "</th><td>" + rw[1] + "</td><td>" + rw[2] + "</td><td>" + rw[3] + "</td></tr>"; }).join("") + "</tbody>";
    document.getElementById("sim-meta").textContent = mc.replications + " simulated days · " + Math.round(ms) + " ms";
    document.getElementById("sim-reps").textContent = mc.replications;
    renderSimChart(mc, p, r);
  }
  function renderSimChart(mc, p, r) {
    const el = document.getElementById("sim-chart"), H = mc.hourly.length, close = Math.round(p.operating_hours_per_day);
    const Wd = 460, Ht = 190, pad = { l: 34, r: 34, t: 14, b: 26 }, iw = Wd - pad.l - pad.r, ih = Ht - pad.t - pad.b;
    const arr = mc.hourly.map(function (h) { return h.arrIn + h.arrOut; });
    const cap = (r.throughput.inbound.capacityTrucksPerHour + r.throughput.outbound.capacityTrucksPerHour);
    const yMax = Math.max(1, Math.max.apply(null, arr) * 1.15, cap * 0.6);
    const yard = mc.hourly.map(function (h) { return h.yard; }), lifts = mc.hourly.map(function (h) { return h.lifts / mc.lifts; });
    const y2Max = Math.max(1, Math.max.apply(null, yard) * 1.2);
    const bw = iw / H, X = function (h) { return pad.l + h * bw; }, Y = function (v) { return pad.t + ih - v / yMax * ih; };
    const Y2 = function (v) { return pad.t + ih - v / y2Max * ih; }, Y3 = function (v) { return pad.t + ih - v * ih; };
    const start = close >= 24 ? 0 : 6;
    let s = '<svg viewBox="0 0 ' + Wd + " " + Ht + '" width="100%" role="img" aria-label="Average truck arrivals, yard queue and lift-truck use per hour over the simulated days">';
    s += '<rect x="' + X(close) + '" y="' + pad.t + '" width="' + Math.max(0, X(H) - X(close)) + '" height="' + ih + '" fill="rgba(227,73,72,.08)"/>';
    arr.forEach(function (v, h) { s += '<rect x="' + (X(h) + bw * 0.15) + '" y="' + Y(v) + '" width="' + bw * 0.7 + '" height="' + (pad.t + ih - Y(v)) + '" fill="#3987e5" opacity="0.85"><title>' + v.toFixed(1) + " trucks</title></rect>"; });
    const line = function (vals, Yf, color, dash) { return '<polyline fill="none" stroke="' + color + '" stroke-width="2"' + (dash ? ' stroke-dasharray="4,3"' : "") + ' points="' + vals.map(function (v, h) { return (X(h) + bw / 2) + "," + Yf(v); }).join(" ") + '"/>'; };
    s += line(yard, Y2, "#eda100") + line(lifts, Y3, "#7be0c4", true);
    for (let h = 0; h <= H; h += Math.max(1, Math.round(H / 8))) s += '<text x="' + X(h) + '" y="' + (Ht - 8) + '" fill="#6fa8c9" font-size="9" text-anchor="middle">' + String((start + h) % 24).padStart(2, "0") + ":00</text>";
    s += '<text x="' + (pad.l - 4) + '" y="' + (pad.t + 8) + '" fill="#3987e5" font-size="9" text-anchor="end">' + Math.round(yMax) + "</text>";
    s += '<text x="' + (Wd - pad.r + 4) + '" y="' + (pad.t + 8) + '" fill="#eda100" font-size="9">' + y2Max.toFixed(1) + "</text>";
    s += '<line x1="' + pad.l + '" y1="' + (pad.t + ih) + '" x2="' + (Wd - pad.r) + '" y2="' + (pad.t + ih) + '" stroke="#2a5580"/>';
    if (H > close) s += '<text x="' + (X(close) + 4) + '" y="' + (pad.t + 10) + '" fill="#e34948" font-size="9">after closing</text>';
    s += "</svg>";
    s += '<div class="chart-legend"><span class="legend-item"><span class="swatch" style="background:#3987e5"></span>trucks arriving / h (left axis)</span>' +
      '<span class="legend-item"><span class="swatch" style="background:#eda100"></span>trucks waiting in the yard (right axis)</span>' +
      '<span class="legend-item"><span class="swatch" style="background:#7be0c4"></span>lift trucks busy (0–100%)</span></div>';
    el.innerHTML = s;
  }

  // -------------------------------------------------------------------
  // Day playback in the 3D view
  // -------------------------------------------------------------------
  const clockEl = document.getElementById("sim-clock");
  let daySpeed = 60;
  document.getElementById("btn-play").addEventListener("click", function () {
    if (viz.mode !== "live") return;
    const p = model.getAll();
    const day = sim.simulateDay(p, results, { seed: 1000, liftTrucks: simLifts(), log: true });
    viz._onTick = function (info) {
      clockEl.hidden = !info;
      if (!info) return;
      const start = p.operating_hours_per_day >= 24 ? 0 : 6, mins = Math.floor(info.t / 60) + start * 60;
      document.getElementById("clock-time").textContent = String(Math.floor(mins / 60) % 24).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0") + (info.t > info.close ? " (after closing)" : "");
      document.getElementById("clock-info").textContent = info.yard + " truck" + (info.yard === 1 ? "" : "s") + " waiting · " + info.busy + " of " + info.lifts + " lift trucks busy" + (info.done ? " · day complete" : "");
    };
    viz.playDay(day, p, results, daySpeed);
  });
  document.getElementById("btn-stop").addEventListener("click", function () { viz.stopDay(); });
  clockEl.querySelectorAll("[data-speed]").forEach(function (b) {
    b.addEventListener("click", function () {
      daySpeed = +b.getAttribute("data-speed");
      clockEl.querySelectorAll("[data-speed]").forEach(function (x) { x.classList.toggle("active", x === b); });
      viz.setDaySpeed(daySpeed);
    });
  });

  // -------------------------------------------------------------------
  // KPI dashboard
  // -------------------------------------------------------------------
  function kpiTile(label, value, sub, status, key) {
    const div = document.createElement("div");
    div.className = "kpi-tile" + (status ? " status-" + status : "");
    if (key) div.setAttribute("data-kpi", key);
    div.innerHTML =
      '<div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value">' + value + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : "");
    return div;
  }
  const pct = function (v) { return isFinite(v) ? v.toFixed(0) + "%" : "—"; };

  function renderKPIs(r, p) {
    const n = function (v) { return Math.round(v).toLocaleString("en-US"); };
    const t = r.throughput, tr = r.travel;
    kpiEl.innerHTML = "";
    kpiEl.appendChild(kpiTile("Storage Capacity", n(r.capacity.storageCapacity), "positions · " + n(r.capacity.practicalCapacity) + " usable", null, "capacity"));
    kpiEl.appendChild(kpiTile("Utilization", pct(r.utilization.utilizationPct),
      r.utilization.overflowPallets > 0 ? n(r.utilization.overflowPallets) + " pallets over capacity" : "ceiling " + Math.round(r.utilization.ceilingPct) + "% for this rack",
      r.utilization.status, "utilization"));
    kpiEl.appendChild(kpiTile("Rack Rows", r.layout.numRackRows, r.layout.baysPerRow + " bays × " + p.levels_per_rack + " levels", null, "rows"));
    kpiEl.appendChild(kpiTile("Selectivity", Math.round(r.capacity.selectivity * 100) + "%", "pallets reachable directly", r.capacity.selectivity < 0.5 ? "warning" : null, "selectivity"));
    kpiEl.appendChild(kpiTile("Time per Move", Math.round(tr.perMove) + " s",
      tr.dualShare > 0 ? "single " + Math.round(tr.cycleTime) + " s · dual " + Math.round(tr.dcCycle / 2) + " s/pallet" : lenText(tr.avgRoundTrip, 0) + " round trip + lift", null, "cycle"));
    kpiEl.appendChild(kpiTile("Lift Trucks", tr.forkliftsNeeded, "for the peak hour (avg " + tr.trucksAverage.toFixed(1) + ")", null, "trucks"));
    kpiEl.appendChild(kpiTile("Dock Utilization", pct(t.dockUtilizationPct), "peak hour · in " + pct(t.inbound.utilizationPct) + " / out " + pct(t.outbound.utilizationPct), t.status, "docks"));
    const wait = t.maxWait;
    kpiEl.appendChild(kpiTile("Truck Wait (Peak)", isFinite(wait) ? (wait < 1 ? "<1" : Math.round(wait)) + " min" : "no limit",
      (t.inbound.trucksPerDay + t.outbound.trucksPerDay).toFixed(0) + " trucks/day · " + Math.round(Math.max(t.inbound.pWait, t.outbound.pWait) * 100) + "% wait",
      !isFinite(wait) || wait > 60 ? "critical" : wait > 30 ? "warning" : null, "wait"));
    kpiEl.appendChild(kpiTile("Capital Cost", "$" + (r.cost.capitalCost / 1e6).toFixed(1) + "M", "build $" + (r.cost.totalCost / 1e6).toFixed(1) + "M + trucks $" + (r.cost.fleetCost / 1e6).toFixed(2) + "M", null, "cost"));
    kpiEl.appendChild(kpiTile("Annual Cost", "$" + (r.cost.annualTCO / 1e6).toFixed(2) + "M", "total cost of ownership / year", null, "tco"));
    kpiEl.appendChild(kpiTile("Cost per Move", isFinite(r.cost.costPerMove) ? "$" + r.cost.costPerMove.toFixed(2) : "—", "per pallet in or out", null, "permove"));
    kpiEl.appendChild(kpiTile("Footprint", areaText(r.cost.footprint), (r.cost.footprint / 10000).toFixed(2) + " hectares", null, "footprint"));
  }

  function renderWarnings(warnings) {
    if (!warnings.length) { warningsEl.innerHTML = ""; warningsEl.hidden = true; return; }
    warningsEl.hidden = false;
    const worst = warnings.some(function (w) { return w.level === "critical"; }) ? "critical" : warnings.some(function (w) { return w.level === "warning"; }) ? "warning" : "info";
    warningsEl.className = "warnings level-" + worst;
    warningsEl.innerHTML = '<div class="warn-title">' + (worst === "info" ? "ⓘ Design notes" : "⚠ Engineering warnings") + "</div>" +
      warnings.map(function (w) { return '<div class="warn-line ' + w.level + '">' + w.text + "</div>"; }).join("");
  }

  // -------------------------------------------------------------------
  // Traceability panel — renders the `trace` arrays so no number in the
  // KPI grid is a black box. Open sections stay open across recomputes.
  // -------------------------------------------------------------------
  function renderTrace(r) {
    const open = {};
    traceEl.querySelectorAll("details[open]").forEach(function (d) { open[d.getAttribute("data-k")] = true; });
    const sections = [
      ["layout", "Layout (geometry fit)", r.layout.trace],
      ["capacity", "Storage capacity", r.capacity.trace],
      ["utilization", "Utilization", r.utilization.trace],
      ["travel", "Lift-truck cycle and fleet", r.travel.trace],
      ["throughput", "Docks and trucks", r.throughput.trace],
      ["cost", "Cost", r.cost.trace]
    ];
    traceEl.innerHTML = sections.map(function (s) {
      const rows = s[2].map(function (t) {
        return '<div class="trace-row"><span class="trace-label">' + t.label + '</span>' +
          '<span class="trace-expr">' + t.expr + '</span>' +
          '<span class="trace-value">' + t.value + "</span></div>";
      }).join("");
      return '<details class="trace-section" data-k="' + s[0] + '"' + (open[s[0]] ? " open" : "") + "><summary>" + s[1] + "</summary>" + rows + "</details>";
    }).join("");
  }

  // -------------------------------------------------------------------
  // Floor plan — redrawn from the same results on every change
  // -------------------------------------------------------------------
  let lastSvg = "";
  function renderBlueprint(r, p) {
    lastSvg = window.WH.renderBlueprint(p, r, { len: function (m) { return lenText(m, 1); }, area: areaText, title: "WAREHOUSE MODEL — FLOOR PLAN (LIVE)" });
    blueprintEl.innerHTML = lastSvg;
    const svg = blueprintEl.querySelector("svg");
    if (svg) { svg.removeAttribute("width"); svg.removeAttribute("height"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Dimensioned floor plan of the current design: " + r.layout.numRackRows + " rack rows, " + r.capacity.storageCapacity + " positions."); }
  }
  document.getElementById("btn-svg").addEventListener("click", function () {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lastSvg], { type: "image/svg+xml" }));
    a.download = "warehouse-floor-plan.svg";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  // -------------------------------------------------------------------
  // Charts — plain inline SVG, no external chart library.
  // -------------------------------------------------------------------
  function renderCharts(r) {
    chartsEl.innerHTML = "";
    chartsEl.appendChild(costBreakdownChart(r));
    chartsEl.appendChild(annualCostChart(r));
    chartsEl.appendChild(capacityBarChart(r));
    chartsEl.appendChild(cycleChart(r));
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function card(titleText) {
    const wrap = document.createElement("div");
    wrap.className = "chart-card";
    const title = document.createElement("div");
    title.className = "chart-title";
    title.textContent = titleText;
    wrap.appendChild(title);
    return wrap;
  }
  function stackedBar(parts, total, unitFmt) {
    const W = 320, H = 26;
    const svg = svgEl("svg", { width: "100%", height: 60, viewBox: "0 0 " + W + " " + H });
    let x = 0;
    parts.forEach(function (part) {
      const w = (part.value / (total || 1)) * W;
      svg.appendChild(svgEl("rect", { x: x, y: 0, width: Math.max(0, w - 1), height: H, fill: part.color, rx: 2 }));
      x += w;
    });
    const legend = document.createElement("div");
    legend.className = "chart-legend";
    legend.innerHTML = parts.map(function (part) {
      return '<span class="legend-item"><span class="swatch" style="background:' + part.color + '"></span>' +
        part.label + " — " + unitFmt(part.value) + " (" + (part.value / (total || 1) * 100).toFixed(0) + "%)</span>";
    }).join("");
    return [svg, legend];
  }

  function costBreakdownChart(r) {
    const wrap = card("Cost Breakdown");
    const els = stackedBar([
      { label: "Racking", value: r.cost.rackingCost, color: "#3987e5" },
      { label: "Building", value: r.cost.buildingCost, color: "#6da7ec" },
      { label: "Docks", value: r.cost.dockCost, color: "#9ec5f4" }
    ], r.cost.totalCost, function (v) { return "$" + Math.round(v / 1000).toLocaleString("en-US") + "k"; });
    els.forEach(function (e) { wrap.appendChild(e); });
    return wrap;
  }

  function annualCostChart(r) {
    const c = r.cost, wrap = card("Annual Cost of Ownership ($" + (c.annualTCO / 1e6).toFixed(2) + "M / year)");
    const els = stackedBar([
      { label: "Capital", value: c.annualCapital, color: "#3987e5" },
      { label: "Drivers", value: c.labour, color: "#6da7ec" },
      { label: "Truck running", value: c.running, color: "#9ec5f4" }
    ], c.annualTCO, function (v) { return "$" + Math.round(v / 1000).toLocaleString("en-US") + "k"; });
    els.forEach(function (e) { wrap.appendChild(e); });
    return wrap;
  }

  function cycleChart(r) {
    const tr = r.travel, wrap = card("Where a Lift-Truck Cycle Goes (" + Math.round(tr.cycleTime) + " s)");
    const els = stackedBar([
      { label: "Driving", value: tr.travelTime, color: "#3987e5" },
      { label: "Lifting", value: tr.liftTime, color: "#6da7ec" },
      { label: "Handling", value: tr.cycleTime - tr.travelTime - tr.liftTime, color: "#9ec5f4" }
    ], tr.cycleTime, function (v) { return Math.round(v) + " s"; });
    els.forEach(function (e) { wrap.appendChild(e); });
    return wrap;
  }

  function capacityBarChart(r) {
    const wrap = card("Capacity vs. Inventory");
    const cap = r.capacity.storageCapacity, prac = r.capacity.practicalCapacity;
    const inv = model.get("current_inventory_pallets");
    const maxVal = Math.max(cap, inv, 1) * 1.08;
    const W = 320, H = 70, barH = 22, gap = 12;
    const svg = svgEl("svg", { width: "100%", height: H, viewBox: "0 0 " + W + " " + H });
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: (cap / maxVal) * W, height: barH, fill: "#3987e5", rx: 3 }));
    svg.appendChild(svgEl("text", { x: 4, y: barH / 2 + 4, fill: "#e7edf3", "font-size": 11 })).textContent = "Capacity " + cap.toLocaleString("en-US");
    const invColor = r.utilization.status === "critical" ? "#e34948" : r.utilization.status === "warning" ? "#eda100" : "#1baf7a";
    svg.appendChild(svgEl("rect", { x: 0, y: barH + gap, width: (inv / maxVal) * W, height: barH, fill: invColor, rx: 3 }));
    svg.appendChild(svgEl("text", { x: 4, y: barH + gap + barH / 2 + 4, fill: "#e7edf3", "font-size": 11 })).textContent = "Inventory " + Math.round(inv).toLocaleString("en-US");
    const px = (prac / maxVal) * W;
    svg.appendChild(svgEl("line", { x1: px, y1: -2, x2: px, y2: H, stroke: "#eda100", "stroke-width": 1.5, "stroke-dasharray": "4,3" }));
    wrap.appendChild(svg);
    const legend = document.createElement("div");
    legend.className = "chart-legend";
    legend.innerHTML = '<span class="legend-item"><span class="swatch" style="background:#eda100"></span>planning ceiling — ' + prac.toLocaleString("en-US") + " pallets</span>";
    wrap.appendChild(legend);
    return wrap;
  }

  // -------------------------------------------------------------------
  // Inspector (click a component in the 3D view)
  // -------------------------------------------------------------------
  function renderInspector(info) {
    if (!info) { inspectorEl.innerHTML = '<p class="hint">Click a rack in the 3D view to see that slot\'s route and cycle time, or a dock door to inspect it.</p>'; return; }
    let rows = "";
    for (const k in info) {
      if (k === "name" || k === "type") continue;
      rows += '<div class="insp-row"><span>' + k + "</span><b>" + info[k] + "</b></div>";
    }
    inspectorEl.innerHTML = '<div class="insp-title">' + info.name + '</div><div class="insp-type">' + info.type + "</div>" + rows;
  }

  // -------------------------------------------------------------------
  // View mode, reset, units
  // -------------------------------------------------------------------
  modeButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const mode = btn.getAttribute("data-viewmode");
      modeButtons.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      document.getElementById("reference-note").hidden = mode !== "reference";
      document.getElementById("color-group").hidden = mode !== "live";
      wallsBtn.hidden = mode !== "live";
      document.getElementById("btn-play").hidden = mode !== "live";
      viz.stopDay();
      if (mode === "reference") {
        viz.setMode("reference");
        viz.loadReferenceModel("models/warehouse_baseline.glb", function (ok) {
          document.getElementById("reference-note").textContent = ok
            ? "Showing the real FreeCAD export (freecad/warehouse_model.FCStd) at its baseline parameter values. It does not move when you drag a slider — that's the honest limit of a static mesh."
            : "Could not load the FreeCAD GLB export — run freecad/create_model.py to generate web/models/warehouse_baseline.glb, then reload.";
        });
      } else {
        viz.setMode("live");
        viz.rebuildLive(model.getAll(), results);
      }
      updateLegend();
    });
  });

  document.getElementById("btn-reset-params").addEventListener("click", function () { model.resetAll(); });

  // pallet colouring and walls
  const colorBtns = document.querySelectorAll("[data-color]");
  const legend = document.getElementById("heat-legend");
  colorBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      colorBtns.forEach(function (b) { b.classList.toggle("active", b === btn); });
      viz.setColorMode(btn.getAttribute("data-color"));
      updateLegend();
    });
  });
  const classBtn = document.querySelector('[data-color="class"]');
  function updateLegend() {
    const abc = model.get("storage_policy") === "abc";
    classBtn.hidden = !abc;
    if (!abc && viz && viz.colorMode === "class") { colorBtns.forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-color") === "stock"); }); viz.setColorMode("stock"); }
    const mode = viz && viz.mode === "live" ? viz.colorMode : "stock";
    legend.hidden = mode === "stock";
    legend.classList.toggle("classes", mode === "class");
    if (mode === "heat") {
      // the range comes from the same per-slot grid the 3D view colours by
      const g = results.slots.grid;
      document.getElementById("heat-min").textContent = isFinite(g.min) ? Math.round(g.min) + " s" : "—";
      document.getElementById("heat-max").textContent = isFinite(g.max) ? Math.round(g.max) + " s" : "—";
      legend.querySelector("small").textContent = "average cycle time per position";
    } else if (mode === "class") {
      const sh = results.slots.weights.shares || [0, 0, 0];
      document.getElementById("heat-min").textContent = "";
      document.getElementById("heat-max").textContent = "";
      legend.querySelector("small").innerHTML = '<span class="cls a"></span>A ' + Math.round(sh[0] * 100) + '% of moves · <span class="cls b"></span>B ' + Math.round(sh[1] * 100) + '% · <span class="cls c"></span>C ' + Math.round(sh[2] * 100) + "% — A = the quickest 20% of positions";
    }
  }
  model.onChange(function () { updateLegend(); });
  const wallsBtn = document.getElementById("btn-walls");
  wallsBtn.addEventListener("click", function () {
    const on = !viz.showWalls;
    viz.setWalls(on);
    wallsBtn.classList.toggle("active", on); wallsBtn.setAttribute("aria-pressed", String(on));
  });
  document.getElementById("btn-reset-view").addEventListener("click", function () { if (viz) viz.resetView(); });

  const unitsBtn = document.getElementById("btn-units");
  function showUnits() { unitsBtn.innerHTML = '<span class="long">Units: </span>' + (imperial ? "imperial" : "metric"); unitsBtn.setAttribute("aria-pressed", String(imperial)); }
  showUnits();
  unitsBtn.addEventListener("click", function () {
    imperial = !imperial;
    try { localStorage.setItem("warehouse-units", imperial ? "imperial" : "metric"); } catch (e) {}
    showUnits();
    model._notify("__units");
  });

  // test hook (headless browser tests)
  // the interface decisions.js works through
  window.WH.app = { model: model, results: function () { return results; }, onRecompute: function (f) { recomputeHooks.push(f); }, version: APP_VERSION };

  window.warehouseDebug = { model: model, results: function () { return results; }, version: APP_VERSION, viz: function () { return viz; }, sim: function () { return simResult; } };
})();
