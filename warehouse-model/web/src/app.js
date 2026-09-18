/*
 * app.js — wires model.js (parameters) + calculations.js (analytical
 * model) + visualization.js (3D) into the page. This file owns the DOM;
 * the other three files don't know the DOM exists.
 */
(function () {
  "use strict";

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
  const modeButtons = document.querySelectorAll("[data-viewmode]");

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
  // Rail: build one slider per parameter, grouped by category, straight
  // from the schema — no parameter is ever hand-coded into the UI twice.
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
        section.appendChild(buildSliderRow(name));
      });
      railEl.appendChild(section);
    });
  }

  function displayValue(name, value) {
    const def = model.schema[name];
    const decimals = def.unit === "m" || def.unit === "$" ? (value < 10 ? 2 : 1) : 0;
    let text = def.unit === "$" ? "$" + Math.round(value).toLocaleString("en-US") : value.toFixed(decimals);
    if (def.unit && def.unit !== "$" && def.unit !== "count") text += " " + def.unit;
    return text;
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
    const val = document.createElement("span");
    val.className = "val";
    val.id = "val-" + name;
    val.textContent = displayValue(name, model.get(name));
    head.appendChild(label); head.appendChild(val);
    row.appendChild(head);

    const track = document.createElement("div");
    track.className = "slider-track";
    const lo = document.createElement("span"); lo.className = "bound"; lo.textContent = def.minimum;
    const hi = document.createElement("span"); hi.className = "bound right"; hi.textContent = def.maximum;
    const input = document.createElement("input");
    input.type = "range";
    input.min = def.minimum; input.max = def.maximum;
    input.step = (def.maximum - def.minimum) > 50 ? 1 : (def.unit === "m" ? 0.1 : 1);
    input.value = model.get(name);
    input.addEventListener("input", function () {
      model.set(name, parseFloat(input.value));
    });
    track.appendChild(lo); track.appendChild(input); track.appendChild(hi);
    row.appendChild(track);

    model.onChange(function (changed) {
      if (changed === null || changed === name) {
        input.value = model.get(name);
        document.getElementById("val-" + name).textContent = displayValue(name, model.get(name));
      }
    });

    return row;
  }

  // -------------------------------------------------------------------
  // Recompute pipeline: parameter change -> analytical model -> KPIs,
  // charts, warnings, traceability, 3D view. All from one function so the
  // causal chain in the spec (§19) is literally one call stack.
  // -------------------------------------------------------------------
  model.onChange(function () { recompute(); });

  function recompute() {
    const p = model.getAll();
    results = calc.computeAll(p);
    renderKPIs(results);
    renderWarnings(results.warnings);
    renderTrace(results);
    renderCharts(results, p);
    if (viz && viz.mode === "live") viz.rebuildLive(p, results);
  }

  // -------------------------------------------------------------------
  // KPI dashboard
  // -------------------------------------------------------------------
  function kpiTile(label, value, sub, status) {
    const div = document.createElement("div");
    div.className = "kpi-tile" + (status ? " status-" + status : "");
    div.innerHTML =
      '<div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value">' + value + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : "");
    return div;
  }

  function renderKPIs(r) {
    kpiEl.innerHTML = "";
    kpiEl.appendChild(kpiTile("Storage Capacity", r.capacity.storageCapacity.toLocaleString("en-US"), "pallet positions"));
    kpiEl.appendChild(kpiTile(
      "Utilization", r.utilization.utilizationPct.toFixed(0) + "%",
      r.utilization.overflowPallets > 0 ? r.utilization.overflowPallets.toLocaleString("en-US") + " pallets over capacity" : "of physical capacity",
      r.utilization.status
    ));
    kpiEl.appendChild(kpiTile("Rack Rows", r.layout.numRackRows, r.layout.baysPerRow + " bays per row"));
    kpiEl.appendChild(kpiTile("Avg. Round Trip", Math.round(r.travel.avgRoundTrip).toLocaleString("en-US") + " m", "dock to storage and back"));
    kpiEl.appendChild(kpiTile(
      "Dock Utilization", r.throughput.dockUtilizationPct.toFixed(0) + "%",
      Math.round(r.throughput.dockCapacityPerDay).toLocaleString("en-US") + " pallets/day capacity",
      r.throughput.dockBound ? "critical" : (r.throughput.dockUtilizationPct > 85 ? "warning" : "good")
    ));
    kpiEl.appendChild(kpiTile("Forklifts Needed", r.travel.forkliftsNeeded, "to cover daily workload"));
    kpiEl.appendChild(kpiTile("Total Cost", "$" + Math.round(r.cost.totalCost / 1e6).toLocaleString("en-US") + "M", "$" + Math.round(r.cost.costPerPosition).toLocaleString("en-US") + " / position"));
    kpiEl.appendChild(kpiTile("Footprint", Math.round(r.cost.footprint).toLocaleString("en-US") + " m²", (r.cost.footprint / 10000).toFixed(1) + " hectares"));
  }

  function renderWarnings(warnings) {
    if (!warnings.length) { warningsEl.innerHTML = ""; warningsEl.hidden = true; return; }
    warningsEl.hidden = false;
    warningsEl.innerHTML = '<div class="warn-title">⚠ Engineering warnings</div>' +
      warnings.map(function (w) { return '<div class="warn-line">' + w + "</div>"; }).join("");
  }

  // -------------------------------------------------------------------
  // Traceability panel — literally renders the `trace` arrays so no
  // number in the KPI grid is a black box.
  // -------------------------------------------------------------------
  function renderTrace(r) {
    const sections = [
      ["Layout (geometry fit)", r.layout.trace],
      ["Storage capacity", r.capacity.trace],
      ["Utilization", r.utilization.trace],
      ["Travel distance", r.travel.trace],
      ["Dock throughput", r.throughput.trace],
      ["Cost", r.cost.trace]
    ];
    traceEl.innerHTML = sections.map(function (s) {
      const rows = s[1].map(function (t) {
        return '<div class="trace-row"><span class="trace-label">' + t.label + '</span>' +
          '<span class="trace-expr">' + t.expr + '</span>' +
          '<span class="trace-value">' + t.value + "</span></div>";
      }).join("");
      return '<details class="trace-section"><summary>' + s[0] + "</summary>" + rows + "</details>";
    }).join("");
  }

  // -------------------------------------------------------------------
  // Charts — plain inline SVG, single-hue sequential + categorical use
  // only, no external chart library.
  // -------------------------------------------------------------------
  function renderCharts(r, p) {
    chartsEl.innerHTML = "";
    chartsEl.appendChild(costBreakdownChart(r));
    chartsEl.appendChild(capacityBarChart(r));
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function costBreakdownChart(r) {
    const wrap = document.createElement("div");
    wrap.className = "chart-card";
    const title = document.createElement("div");
    title.className = "chart-title";
    title.textContent = "Cost Breakdown";
    wrap.appendChild(title);

    const parts = [
      { label: "Racking", value: r.cost.rackingCost, color: "#3987e5" },
      { label: "Building", value: r.cost.buildingCost, color: "#6da7ec" },
      { label: "Docks", value: r.cost.dockCost, color: "#9ec5f4" }
    ];
    const total = r.cost.totalCost || 1;
    const W = 320, H = 26;
    const svg = svgEl("svg", { width: "100%", height: 60, viewBox: "0 0 " + W + " " + H });
    let x = 0;
    parts.forEach(function (part) {
      const w = (part.value / total) * W;
      svg.appendChild(svgEl("rect", { x: x, y: 0, width: Math.max(0, w - 1), height: H, fill: part.color, rx: 2 }));
      x += w;
    });
    wrap.appendChild(svg);

    const legend = document.createElement("div");
    legend.className = "chart-legend";
    legend.innerHTML = parts.map(function (part) {
      return '<span class="legend-item"><span class="swatch" style="background:' + part.color + '"></span>' +
        part.label + " — $" + Math.round(part.value / 1000).toLocaleString("en-US") + "k (" + (part.value / total * 100).toFixed(0) + "%)</span>";
    }).join("");
    wrap.appendChild(legend);
    return wrap;
  }

  function capacityBarChart(r) {
    const wrap = document.createElement("div");
    wrap.className = "chart-card";
    const title = document.createElement("div");
    title.className = "chart-title";
    title.textContent = "Capacity vs. Inventory";
    wrap.appendChild(title);

    const cap = r.capacity.storageCapacity;
    const inv = cap + 0 === 0 ? 0 : Math.min(r.utilization.utilizationPct, 130) / 100 * cap;
    const maxVal = Math.max(cap, inv, 1) * 1.08;
    const W = 320, H = 70, barH = 22, gap = 12;

    const svg = svgEl("svg", { width: "100%", height: H, viewBox: "0 0 " + W + " " + H });
    const capW = (cap / maxVal) * W;
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: capW, height: barH, fill: "#3987e5", rx: 3 }));
    svg.appendChild(svgEl("text", { x: 4, y: barH / 2 + 4, fill: "#e7edf3", "font-size": 11 })).textContent = "Capacity " + cap.toLocaleString("en-US");

    const invColor = r.utilization.status === "critical" ? "#e34948" : r.utilization.status === "warning" ? "#eda100" : "#1baf7a";
    const invW = (inv / maxVal) * W;
    svg.appendChild(svgEl("rect", { x: 0, y: barH + gap, width: invW, height: barH, fill: invColor, rx: 3 }));
    svg.appendChild(svgEl("text", { x: 4, y: barH + gap + barH / 2 + 4, fill: "#e7edf3", "font-size": 11 })).textContent = "Inventory " + Math.round(inv).toLocaleString("en-US");

    wrap.appendChild(svg);
    return wrap;
  }

  // -------------------------------------------------------------------
  // Inspector (click a component in the 3D view)
  // -------------------------------------------------------------------
  function renderInspector(info) {
    if (!info) { inspectorEl.innerHTML = '<p class="hint">Click a rack row or dock door in the 3D view to inspect it.</p>'; return; }
    let rows = "";
    for (const k in info) {
      if (k === "name" || k === "type") continue;
      rows += '<div class="insp-row"><span>' + k + "</span><b>" + info[k] + "</b></div>";
    }
    inspectorEl.innerHTML =
      '<div class="insp-title">' + info.name + '</div>' +
      '<div class="insp-type">' + info.type + "</div>" + rows;
  }

  // -------------------------------------------------------------------
  // View mode toggle + reset
  // -------------------------------------------------------------------
  modeButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const mode = btn.getAttribute("data-viewmode");
      modeButtons.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      document.getElementById("reference-note").hidden = mode !== "reference";
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
    });
  });

  document.getElementById("btn-reset-params").addEventListener("click", function () {
    model.resetAll();
  });
  document.getElementById("btn-reset-view").addEventListener("click", function () {
    if (viz) viz.resetView();
  });
})();
