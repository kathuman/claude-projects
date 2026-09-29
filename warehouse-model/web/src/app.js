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
  const APP_VERSION = "3.0.0";

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
    viz._onQuality = function (q) {
      if (q === "low") document.querySelector(".caption").textContent = "Shadows switched off to keep the view smooth on this device · drag to orbit · right-drag to pan · scroll to zoom";
    };
    recompute();
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
      opt.textContent = model.rackTypes[o] ? model.rackTypes[o].label : o;
      sel.appendChild(opt);
    });
    const note = document.createElement("div");
    note.className = "choice-note";
    sel.addEventListener("change", function () { model.set(name, sel.value); });
    row.appendChild(sel);
    row.appendChild(note);
    function sync() {
      sel.value = model.get(name);
      const rt = model.rackTypes[model.get(name)];
      note.textContent = rt ? rt.deep + " deep · " + Math.round(rt.selectivity * 100) + "% selective · " + rt.truck + ", aisle ≥ " + lenText(rt.min_aisle, 1) : "";
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
    if (viz && viz.mode === "live") viz.rebuildLive(p, results);
  }

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
    kpiEl.appendChild(kpiTile("Avg. Cycle Time", Math.round(tr.cycleTime) + " s", lenText(tr.avgRoundTrip, 0) + " round trip + lift", null, "cycle"));
    kpiEl.appendChild(kpiTile("Lift Trucks", tr.forkliftsNeeded, "for the peak hour (avg " + tr.trucksAverage.toFixed(1) + ")", null, "trucks"));
    kpiEl.appendChild(kpiTile("Dock Utilization", pct(t.dockUtilizationPct), "peak hour · in " + pct(t.inbound.utilizationPct) + " / out " + pct(t.outbound.utilizationPct), t.status, "docks"));
    kpiEl.appendChild(kpiTile("Truck Arrivals", (t.inbound.trucksPerDay + t.outbound.trucksPerDay).toFixed(0) + "/day", "peak " + t.inbound.peakTrucksPerHour.toFixed(1) + "/h each way", null, "arrivals"));
    kpiEl.appendChild(kpiTile("Total Cost", "$" + (r.cost.totalCost / 1e6).toFixed(1) + "M", "$" + n(r.cost.costPerPosition) + " / position", null, "cost"));
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
  function updateLegend() {
    const heat = viz && viz.colorMode === "heat" && viz.mode === "live";
    legend.hidden = !heat;
    if (!heat) return;
    // the heat range comes from the same per-slot grid the 3D view colours by
    const g = calc.slotTimeGrid(model.getAll(), results.layout);
    document.getElementById("heat-min").textContent = isFinite(g.min) ? Math.round(g.min) + " s" : "—";
    document.getElementById("heat-max").textContent = isFinite(g.max) ? Math.round(g.max) + " s" : "—";
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
  window.warehouseDebug = { model: model, results: function () { return results; }, version: APP_VERSION, viz: function () { return viz; } };
})();
