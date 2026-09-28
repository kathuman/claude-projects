(function () {
  "use strict";
  const NST = window.NST;
  const MODE_DEFAULTS = NST.modeDefaults.MODE_DEFAULTS;

  const state = {
    network: { products: [], nodes: [], edges: [] },
    scenario: { disabledNodes: new Set(), disabledEdges: new Set(), derate: {} },
    solveResult: null,
    selection: null, // {type:'node'|'edge', id}
    basemode: "normal",
  };

  const nodeById = () => new Map(state.network.nodes.map((n) => [n.id, n]));

  // ---------- small formatting helpers ----------
  function fmt(n, digits) {
    if (n === undefined || n === null || isNaN(n)) return "—";
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits === undefined ? 1 : digits });
  }
  function productsToStr(products) {
    return Object.keys(products || {}).map((k) => k + ":" + products[k]).join(", ");
  }
  function parseProductsStr(str) {
    const out = {};
    (str || "").split(",").forEach((pair) => {
      const p = pair.trim();
      if (!p) return;
      const idx = p.lastIndexOf(":");
      if (idx === -1) return;
      const pid = p.slice(0, idx).trim(), val = Number(p.slice(idx + 1).trim());
      if (pid && !isNaN(val)) out[pid] = val;
    });
    return out;
  }
  function uid(prefix) { return prefix + "_" + (Date.now() % 1000000) + Math.floor(Math.random() * 100); }

  // ---------- map ----------
  const svgEl = document.getElementById("map-svg");
  const map = NST.mapView.createMapView(svgEl, {
    onSelectNode: (id) => selectElement("node", id),
    onSelectEdge: (id) => selectElement("edge", id),
    onSelectBackground: () => selectElement(null, null),
  });

  function selectElement(type, id) {
    state.selection = type ? { type, id } : null;
    map.setSelection(state.selection);
    renderInspector();
    highlightTableSelection();
  }

  function highlightTableSelection() {
    document.querySelectorAll("#nodes-table tbody tr, #edges-table tbody tr").forEach((tr) => tr.classList.remove("selected"));
    if (!state.selection) return;
    const tableId = state.selection.type === "node" ? "nodes-table" : "edges-table";
    const row = document.querySelector('#' + tableId + ' tbody tr[data-id="' + cssEscape(state.selection.id) + '"]');
    if (row) row.classList.add("selected");
  }
  function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  // ---------- products rail ----------
  function renderProducts() {
    const el = document.getElementById("products-list");
    el.innerHTML = "";
    state.network.products.forEach((p) => {
      const row = document.createElement("div");
      row.className = "product-row";
      row.innerHTML =
        '<input type="text" value="' + escapeHtml(p.name) + '" data-field="name" />' +
        '<input type="number" value="' + p.priority + '" data-field="priority" title="priority (lower solves first)" />' +
        '<span class="rail-note" style="padding:0;align-self:center;">' + escapeHtml(p.id) + "</span>" +
        '<button class="rm" title="remove product">×</button>';
      row.querySelector('[data-field="name"]').addEventListener("change", (e) => { p.name = e.target.value; });
      row.querySelector('[data-field="priority"]').addEventListener("change", (e) => { p.priority = Number(e.target.value) || 1; });
      row.querySelector(".rm").addEventListener("click", () => {
        state.network.products = state.network.products.filter((x) => x !== p);
        renderProducts();
      });
      el.appendChild(row);
    });
  }
  document.getElementById("btn-add-product").addEventListener("click", () => {
    const n = state.network.products.length;
    state.network.products.push({ id: "PROD" + n, name: "Product " + String.fromCharCode(65 + n), priority: n + 1 });
    renderProducts();
  });

  // ---------- mode defaults rail ----------
  function renderModeDefaults() {
    const el = document.getElementById("mode-defaults");
    el.innerHTML = "";
    const fields = [
      ["speedKmPerDay", "Speed (km/day)"], ["fixedDays", "Fixed days"],
      ["costPerUnitKm", "Cost/unit/km"], ["fixedCostPerUnit", "Fixed cost/unit"],
      ["baseFailureRate", "Base fail rate"], ["meanDisruptionDays", "Mean disrupt. days"],
    ];
    ["air", "sea", "road"].forEach((mode) => {
      const card = document.createElement("div");
      card.className = "mode-card " + mode;
      let html = '<div class="mode-title">' + mode + '</div><div class="mode-fields">';
      fields.forEach(([key, label]) => {
        html += '<label>' + label + '<input type="number" step="any" data-mode="' + mode + '" data-key="' + key + '" value="' + MODE_DEFAULTS[mode][key] + '" /></label>';
      });
      html += "</div>";
      card.innerHTML = html;
      el.appendChild(card);
    });
    el.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("change", (e) => {
        const v = Number(e.target.value);
        if (!isNaN(v)) MODE_DEFAULTS[e.target.dataset.mode][e.target.dataset.key] = v;
      });
    });
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ---------- nodes table ----------
  function renderNodesTable() {
    const table = document.getElementById("nodes-table");
    table.querySelector("thead").innerHTML =
      "<tr><th></th><th>ID</th><th>Name</th><th>Type</th><th>Lat</th><th>Lon</th><th>Products (id:qty, ...)</th><th></th></tr>";
    const tbody = table.querySelector("tbody");
    tbody.innerHTML = "";
    state.network.nodes.forEach((n) => {
      const tr = document.createElement("tr");
      tr.dataset.id = n.id;
      if (state.scenario.disabledNodes.has(n.id)) tr.classList.add("row-disabled");
      const disabled = state.scenario.disabledNodes.has(n.id);
      tr.innerHTML =
        '<td><button class="cell-disable' + (disabled ? " is-disabled" : "") + '" title="toggle disabled">' + (disabled ? "OFF" : "on") + '</button></td>' +
        '<td>' + escapeHtml(n.id) + '</td>' +
        '<td><input type="text" data-f="name" value="' + escapeHtml(n.name || n.id) + '" /></td>' +
        '<td><select data-f="type"><option value="production"' + (n.type === "production" ? " selected" : "") + '>production</option><option value="warehouse"' + (n.type === "warehouse" ? " selected" : "") + '>warehouse</option><option value="consumer"' + (n.type === "consumer" ? " selected" : "") + '>consumer</option></select></td>' +
        '<td><input type="number" step="any" data-f="lat" value="' + n.lat + '" style="width:64px" /></td>' +
        '<td><input type="number" step="any" data-f="lon" value="' + n.lon + '" style="width:64px" /></td>' +
        '<td><input type="text" data-f="products" value="' + escapeHtml(productsToStr(n.products)) + '" style="min-width:160px" /></td>' +
        '<td><button class="cell-del" title="delete node">🗑</button></td>';
      tr.querySelector('[data-f="name"]').addEventListener("change", (e) => { n.name = e.target.value; });
      tr.querySelector('[data-f="type"]').addEventListener("change", (e) => { n.type = e.target.value; });
      tr.querySelector('[data-f="lat"]').addEventListener("change", (e) => { n.lat = Number(e.target.value) || 0; map.setNetwork(state.network); });
      tr.querySelector('[data-f="lon"]').addEventListener("change", (e) => { n.lon = Number(e.target.value) || 0; map.setNetwork(state.network); });
      tr.querySelector('[data-f="products"]').addEventListener("change", (e) => { n.products = parseProductsStr(e.target.value); });
      tr.querySelector(".cell-disable").addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (state.scenario.disabledNodes.has(n.id)) state.scenario.disabledNodes.delete(n.id);
        else state.scenario.disabledNodes.add(n.id);
        renderNodesTable(); renderScenarioList(); map.setScenario(state.scenario);
      });
      tr.querySelector(".cell-del").addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.network.nodes = state.network.nodes.filter((x) => x !== n);
        state.network.edges = state.network.edges.filter((e) => e.from !== n.id && e.to !== n.id);
        if (state.selection && state.selection.type === "node" && state.selection.id === n.id) selectElement(null, null);
        refreshAllTables(); map.setNetwork(state.network);
      });
      tr.addEventListener("click", (ev) => { if (ev.target.tagName !== "INPUT" && ev.target.tagName !== "SELECT" && ev.target.tagName !== "BUTTON") selectElement("node", n.id); });
      tbody.appendChild(tr);
    });
    document.getElementById("node-count").textContent = "(" + state.network.nodes.length + ")";
  }
  document.getElementById("btn-add-node").addEventListener("click", () => {
    const id = uid("N");
    state.network.nodes.push({ id, name: id, type: "warehouse", lat: 0, lon: 0, products: {} });
    refreshAllTables(); map.setNetwork(state.network);
  });

  // ---------- edges table ----------
  function renderEdgesTable() {
    const table = document.getElementById("edges-table");
    table.querySelector("thead").innerHTML =
      "<tr><th></th><th>ID</th><th>From</th><th>To</th><th>Mode</th><th>Cap</th><th>Cost/u</th><th>Lead days</th><th>Fail rate</th><th></th></tr>";
    const tbody = table.querySelector("tbody");
    tbody.innerHTML = "";
    state.network.edges.forEach((e) => {
      const tr = document.createElement("tr");
      tr.dataset.id = e.id;
      const disabled = state.scenario.disabledEdges.has(e.id);
      if (disabled) tr.classList.add("row-disabled");
      tr.innerHTML =
        '<td><button class="cell-disable' + (disabled ? " is-disabled" : "") + '" title="toggle disabled">' + (disabled ? "OFF" : "on") + '</button></td>' +
        '<td>' + escapeHtml(e.id) + '</td>' +
        '<td><input type="text" data-f="from" value="' + escapeHtml(e.from) + '" style="width:70px" /></td>' +
        '<td><input type="text" data-f="to" value="' + escapeHtml(e.to) + '" style="width:70px" /></td>' +
        '<td><select data-f="mode"><option value="air"' + (e.mode === "air" ? " selected" : "") + '>air</option><option value="sea"' + (e.mode === "sea" ? " selected" : "") + '>sea</option><option value="road"' + (e.mode === "road" ? " selected" : "") + '>road</option></select></td>' +
        '<td><input type="number" step="any" data-f="capacity" value="' + e.capacity + '" style="width:60px" /></td>' +
        '<td><input type="number" step="any" data-f="costPerUnit" value="' + (e.costPerUnit || 0) + '" style="width:60px" /></td>' +
        '<td><input type="number" step="any" data-f="leadTimeDays" value="' + (e.leadTimeDays || 0) + '" style="width:60px" /></td>' +
        '<td><input type="number" step="any" data-f="baseFailureRate" value="' + (e.baseFailureRate || 0) + '" style="width:60px" /></td>' +
        '<td><button class="cell-del" title="delete edge">🗑</button></td>';
      ["from", "to"].forEach((f) => tr.querySelector('[data-f="' + f + '"]').addEventListener("change", (ev) => { e[f] = ev.target.value; map.setNetwork(state.network); }));
      tr.querySelector('[data-f="mode"]').addEventListener("change", (ev) => { e.mode = ev.target.value; map.setNetwork(state.network); });
      ["capacity", "costPerUnit", "leadTimeDays", "baseFailureRate"].forEach((f) => tr.querySelector('[data-f="' + f + '"]').addEventListener("change", (ev) => { e[f] = Number(ev.target.value) || 0; }));
      tr.querySelector(".cell-disable").addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (state.scenario.disabledEdges.has(e.id)) state.scenario.disabledEdges.delete(e.id);
        else state.scenario.disabledEdges.add(e.id);
        renderEdgesTable(); renderScenarioList(); map.setScenario(state.scenario);
      });
      tr.querySelector(".cell-del").addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.network.edges = state.network.edges.filter((x) => x !== e);
        if (state.selection && state.selection.type === "edge" && state.selection.id === e.id) selectElement(null, null);
        refreshAllTables(); map.setNetwork(state.network);
      });
      tr.addEventListener("click", (ev) => { if (ev.target.tagName !== "INPUT" && ev.target.tagName !== "SELECT" && ev.target.tagName !== "BUTTON") selectElement("edge", e.id); });
      tbody.appendChild(tr);
    });
    document.getElementById("edge-count").textContent = "(" + state.network.edges.length + ")";
  }
  document.getElementById("btn-add-edge").addEventListener("click", () => {
    const id = uid("E");
    const a = state.network.nodes[0], b = state.network.nodes[1];
    state.network.edges.push({ id, from: a ? a.id : "", to: b ? b.id : "", mode: "road", capacity: 100, costPerUnit: 1, leadTimeDays: 1, baseFailureRate: 0.05 });
    refreshAllTables(); map.setNetwork(state.network);
  });

  function refreshAllTables() { renderNodesTable(); renderEdgesTable(); renderScenarioList(); }

  // ---------- scenario list ----------
  function renderScenarioList() {
    const el = document.getElementById("scenario-list");
    el.innerHTML = "";
    const items = [];
    state.scenario.disabledNodes.forEach((id) => items.push({ kind: "node", id }));
    state.scenario.disabledEdges.forEach((id) => items.push({ kind: "edge", id }));
    if (items.length === 0) { el.innerHTML = '<div class="scenario-empty">No disruptions applied — this is the baseline network.</div>'; return; }
    items.forEach((it) => {
      const chip = document.createElement("div");
      chip.className = "scenario-chip";
      chip.innerHTML = '<span class="lbl">' + (it.kind === "node" ? "NODE " : "EDGE ") + escapeHtml(it.id) + '</span><button title="remove">×</button>';
      chip.querySelector("button").addEventListener("click", () => {
        if (it.kind === "node") state.scenario.disabledNodes.delete(it.id); else state.scenario.disabledEdges.delete(it.id);
        refreshAllTables(); map.setScenario(state.scenario);
      });
      el.appendChild(chip);
    });
  }
  document.getElementById("btn-clear-scenario").addEventListener("click", () => {
    state.scenario.disabledNodes.clear(); state.scenario.disabledEdges.clear(); state.scenario.derate = {};
    refreshAllTables(); map.setScenario(state.scenario);
  });

  // ---------- inspector ----------
  function renderInspector() {
    const el = document.getElementById("inspector");
    if (!state.selection) { el.innerHTML = '<p class="hint">Click a node or lane in the map, or a table row below, to inspect it.</p>'; return; }
    if (state.selection.type === "node") {
      const n = nodeById().get(state.selection.id);
      if (!n) { el.innerHTML = '<p class="hint">(deleted)</p>'; return; }
      let rows = '<div class="insp-row"><span>type</span><b>' + n.type + '</b></div>' +
        '<div class="insp-row"><span>lat, lon</span><b>' + fmt(n.lat, 2) + ", " + fmt(n.lon, 2) + '</b></div>';
      Object.keys(n.products).forEach((pid) => {
        let extra = "";
        if (state.solveResult && n.type === "consumer") {
          const cf = state.solveResult.perProduct[pid] && state.solveResult.perProduct[pid].consumerFulfillment[n.id];
          if (cf) extra = " (recv " + fmt(cf.received, 0) + "/" + fmt(cf.demand, 0) + ")";
        }
        rows += '<div class="insp-row"><span>' + escapeHtml(pid) + '</span><b>' + n.products[pid] + extra + '</b></div>';
      });
      el.innerHTML = '<div class="insp-title">' + escapeHtml(n.name || n.id) + '</div><div class="insp-type">' + n.id + '</div>' + rows +
        '<div class="insp-actions"><button class="btn small" id="insp-toggle">' + (state.scenario.disabledNodes.has(n.id) ? "Re-enable" : "Disable") + '</button></div>';
      document.getElementById("insp-toggle").addEventListener("click", () => {
        if (state.scenario.disabledNodes.has(n.id)) state.scenario.disabledNodes.delete(n.id); else state.scenario.disabledNodes.add(n.id);
        refreshAllTables(); map.setScenario(state.scenario); renderInspector();
      });
    } else {
      const e = state.network.edges.find((x) => x.id === state.selection.id);
      if (!e) { el.innerHTML = '<p class="hint">(deleted)</p>'; return; }
      let flowRows = "";
      if (state.solveResult) {
        state.network.products.forEach((p) => {
          const r = state.solveResult.perProduct[p.id];
          if (r && r.edgeFlows[e.id] > 0) flowRows += '<div class="insp-row"><span>flow (' + escapeHtml(p.name) + ')</span><b>' + fmt(r.edgeFlows[e.id], 0) + '</b></div>';
        });
      }
      el.innerHTML = '<div class="insp-title">' + e.from + ' → ' + e.to + '</div><div class="insp-type">' + e.mode + ' · ' + e.id + '</div>' +
        '<div class="insp-row"><span>capacity</span><b>' + e.capacity + '</b></div>' +
        '<div class="insp-row"><span>cost/unit</span><b>' + e.costPerUnit + '</b></div>' +
        '<div class="insp-row"><span>lead days</span><b>' + e.leadTimeDays + '</b></div>' + flowRows +
        '<div class="insp-actions"><button class="btn small" id="insp-toggle">' + (state.scenario.disabledEdges.has(e.id) ? "Re-enable" : "Disable") + '</button></div>';
      document.getElementById("insp-toggle").addEventListener("click", () => {
        if (state.scenario.disabledEdges.has(e.id)) state.scenario.disabledEdges.delete(e.id); else state.scenario.disabledEdges.add(e.id);
        refreshAllTables(); map.setScenario(state.scenario); renderInspector();
      });
    }
  }

  // ---------- solve + KPIs ----------
  function statusClass(pct) { return pct >= 90 ? "status-good" : pct >= 60 ? "status-warning" : "status-critical"; }

  function doSolve() {
    if (state.network.products.length === 0 || state.network.nodes.length === 0) { state.solveResult = null; return; }
    state.solveResult = NST.network.solveNetwork(state.network, state.scenario);
    renderKPIs();
    renderInspector();
    updateMapFlow();
  }

  function renderKPIs() {
    const grid = document.getElementById("kpi-grid");
    const pp = document.getElementById("kpi-perproduct");
    if (!state.solveResult) { grid.innerHTML = ""; pp.innerHTML = ""; return; }
    const o = state.solveResult.overall;
    grid.innerHTML =
      '<div class="kpi-tile ' + statusClass(o.serviceLevelPct) + '"><div class="kpi-label">Service level</div><div class="kpi-value">' + fmt(o.serviceLevelPct, 1) + '%</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Total flow</div><div class="kpi-value">' + fmt(o.totalFlow, 0) + '</div><div class="kpi-sub">of ' + fmt(o.totalDemand, 0) + ' demand</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Unmet demand</div><div class="kpi-value">' + fmt(o.totalUnmet, 0) + '</div></div>' +
      '<div class="kpi-tile"><div class="kpi-label">Total cost</div><div class="kpi-value">' + fmt(o.totalCost, 0) + '</div></div>';
    pp.innerHTML = "";
    state.network.products.forEach((p) => {
      const r = state.solveResult.perProduct[p.id];
      if (!r) return;
      const pct = r.totalDemand > 0 ? (r.totalFlow / r.totalDemand) * 100 : 100;
      const row = document.createElement("div");
      row.className = "kpi-pp-row";
      row.innerHTML = "<span>" + escapeHtml(p.name) + "</span><b>" + fmt(r.totalFlow, 0) + "/" + fmt(r.totalDemand, 0) + " (" + fmt(pct, 0) + "%)</b>";
      pp.appendChild(row);
    });
  }

  function updateMapFlow() {
    if (state.basemode !== "flow" || !state.solveResult) { map.setFlow(null); return; }
    const flow = new Map(state.network.edges.map((e) => [e.id, 0]));
    state.network.products.forEach((p) => {
      const r = state.solveResult.perProduct[p.id];
      if (!r) return;
      for (const eid in r.edgeFlows) flow.set(eid, (flow.get(eid) || 0) + r.edgeFlows[eid]);
    });
    map.setFlow(flow);
  }

  document.getElementById("btn-solve").addEventListener("click", doSolve);
  document.querySelectorAll(".viewmode-group [data-basemode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".viewmode-group [data-basemode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.basemode = btn.dataset.basemode;
      updateMapFlow();
    });
  });
  document.querySelectorAll(".viewmode-group [data-layoutmode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".viewmode-group [data-layoutmode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      map.setLayoutMode(btn.dataset.layoutmode);
      map.resetView();
      map.setSelection(state.selection);
      updateMapFlow();
    });
  });

  // ---------- generate ----------
  document.getElementById("btn-generate").addEventListener("click", () => {
    const opts = {
      numProduction: Number(document.getElementById("gen-production").value) || 0,
      numWarehouse: Number(document.getElementById("gen-warehouse").value) || 0,
      numConsumer: Number(document.getElementById("gen-consumer").value) || 0,
      numProducts: Number(document.getElementById("gen-products").value) || 1,
      fanout: Number(document.getElementById("gen-fanout").value) || 5,
      seed: Number(document.getElementById("gen-seed").value) || 1,
    };
    state.network = NST.generator.generateNetwork(opts);
    state.scenario = { disabledNodes: new Set(), disabledEdges: new Set(), derate: {} };
    state.selection = null;
    state.solveResult = null;
    renderProducts();
    refreshAllTables();
    map.setNetwork(state.network);
    map.setScenario(state.scenario);
    map.setSelection(null);
    map.resetView();
    doSolve();
  });

  // ---------- CSV import/export ----------
  function download(filename, text) {
    const blob = new Blob([text], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }
  document.getElementById("btn-export-nodes").addEventListener("click", () => download("nodes.csv", NST.csv.nodesToCSV(state.network.nodes)));
  document.getElementById("btn-export-edges").addEventListener("click", () => download("edges.csv", NST.csv.edgesToCSV(state.network.edges)));
  document.getElementById("file-import-nodes").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then((text) => {
      state.network.nodes = NST.csv.csvToNodes(text);
      refreshAllTables(); map.setNetwork(state.network);
      document.getElementById("import-status").textContent = "Imported " + state.network.nodes.length + " nodes.";
    });
    e.target.value = "";
  });
  document.getElementById("file-import-edges").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then((text) => {
      state.network.edges = NST.csv.csvToEdges(text);
      refreshAllTables(); map.setNetwork(state.network);
      document.getElementById("import-status").textContent = "Imported " + state.network.edges.length + " edges.";
    });
    e.target.value = "";
  });

  // ---------- contingency scan ----------
  document.getElementById("btn-scan").addEventListener("click", () => {
    const limit = Number(document.getElementById("scan-limit").value) || 40;
    const btn = document.getElementById("btn-scan");
    const status = document.getElementById("scan-status");
    btn.disabled = true;
    status.textContent = "Scanning up to " + limit + " elements — this re-solves the whole network once per element and may take a few seconds...";
    document.getElementById("scan-results").innerHTML = "";
    setTimeout(() => {
      const t0 = performance.now();
      const scan = NST.graphAnalysis.runContingencyScan(state.network, { scenario: state.scenario, limit });
      const ms = Math.round(performance.now() - t0);
      status.textContent = "Scanned " + scan.elementsScanned + " active element(s) (" + scan.elementsSkipped + " zero-flow elements skipped) in " + ms + "ms.";
      renderScanResults(scan);
      btn.disabled = false;
    }, 30);
  });

  function renderScanResults(scan) {
    const el = document.getElementById("scan-results");
    el.innerHTML = "";
    scan.results.slice(0, 30).forEach((r) => {
      const row = document.createElement("div");
      row.className = "scan-row";
      row.innerHTML =
        '<div class="sr-top"><span class="sr-id">' + r.type.toUpperCase() + " " + escapeHtml(r.id) + '</span><span class="sr-drop">-' + fmt(r.serviceLevelDropPct, 1) + 'pp</span></div>' +
        '<div class="sr-sub">' + fmt(r.afterServiceLevelPct, 1) + '% after loss · ' + r.newlyStrandedConsumers + ' consumer(s) newly stranded · ' + fmt(r.flowLost, 0) + ' units lost</div>';
      row.addEventListener("click", () => {
        if (r.type === "node") state.scenario.disabledNodes.add(r.id); else state.scenario.disabledEdges.add(r.id);
        refreshAllTables(); map.setScenario(state.scenario);
        selectElement(r.type, r.id);
        doSolve();
      });
      el.appendChild(row);
    });
  }

  // ---------- Phase 2: Monte Carlo ----------
  document.getElementById("btn-run-mc").addEventListener("click", () => {
    const trials = Number(document.getElementById("mc-trials").value) || 50;
    const nodeFailureRate = Number(document.getElementById("mc-node-rate").value);
    const seed = Number(document.getElementById("mc-seed").value) || 1;
    const btn = document.getElementById("btn-run-mc");
    const status = document.getElementById("mc-status");
    btn.disabled = true;
    status.textContent = "Running " + trials + " trials (layered on top of the currently applied scenario, if any)...";
    document.getElementById("mc-results").innerHTML = "";
    setTimeout(() => {
      const t0 = performance.now();
      const r = NST.monteCarlo.runMonteCarlo(state.network, { trials, nodeFailureRate, seed, baseScenario: state.scenario });
      const ms = Math.round(performance.now() - t0);
      status.textContent = trials + " trials in " + ms + "ms.";
      renderMonteCarloResults(r);
      btn.disabled = false;
    }, 30);
  });

  function renderMonteCarloResults(r) {
    const el = document.getElementById("mc-results");
    const maxBin = Math.max(1, ...r.histogram);
    let html = '<div class="mc-kpi-row">' +
      kpiChip("Mean", fmt(r.meanServiceLevelPct, 1) + "%") +
      kpiChip("P10", fmt(r.p10ServiceLevelPct, 1) + "%") +
      kpiChip("P50", fmt(r.p50ServiceLevelPct, 1) + "%") +
      kpiChip("P90", fmt(r.p90ServiceLevelPct, 1) + "%") +
      kpiChip("Worst", fmt(r.minServiceLevelPct, 1) + "%") +
      '</div>';
    html += '<div class="histogram">' + r.histogram.map((c) => '<div class="bar" style="height:' + Math.max(2, (c / maxBin) * 70) + 'px" title="' + c + ' trial(s)"></div>').join("") + '</div>';
    html += '<div class="histogram-labels"><span>0%</span><span>service level distribution (' + r.trials + ' trials)</span><span>100%</span></div>';
    if (r.worstTrial) {
      html += '<div class="worst-trial-box">Worst trial: <b>' + fmt(r.worstTrial.serviceLevelPct, 1) + '%</b> service level, ' +
        r.worstTrial.disabledNodes.length + ' node(s) + ' + r.worstTrial.disabledEdges.length + ' lane(s) down.' +
        (r.worstTrial.disabledNodes.length + r.worstTrial.disabledEdges.length > 0 ? ' <button class="btn small" id="mc-apply-worst" style="margin-top:6px;">Apply as scenario</button>' : "") + '</div>';
    }
    el.innerHTML = html;
    const applyBtn = document.getElementById("mc-apply-worst");
    if (applyBtn) applyBtn.addEventListener("click", () => {
      r.worstTrial.disabledNodes.forEach((id) => state.scenario.disabledNodes.add(id));
      r.worstTrial.disabledEdges.forEach((id) => state.scenario.disabledEdges.add(id));
      refreshAllTables(); map.setScenario(state.scenario); doSolve();
    });
  }
  function kpiChip(label, value) {
    return '<div class="mc-kpi"><div class="l">' + label + '</div><div class="v">' + value + '</div></div>';
  }

  // ---------- Phase 2: Time-to-Survive vs Time-to-Recover ----------
  document.getElementById("btn-run-resilience").addEventListener("click", () => {
    const bufferDays = Number(document.getElementById("res-buffer-days").value);
    const hasScenario = state.scenario.disabledNodes.size > 0 || state.scenario.disabledEdges.size > 0;
    const status = document.getElementById("res-status");
    if (!hasScenario) {
      status.textContent = "No disruption is currently applied — nothing to check. Disable a node/lane first (Scenario panel, a table row, or a Contingency/Adversarial result), then check again.";
      document.getElementById("res-results").innerHTML = "";
      return;
    }
    const r = NST.resilienceSim.runResilienceCheck(state.network, state.scenario, { bufferDays });
    status.textContent = "Checked against the current scenario (" + state.scenario.disabledNodes.size + " node(s), " + state.scenario.disabledEdges.size + " lane(s) disabled).";
    renderResilienceResults(r);
  });

  function renderResilienceResults(r) {
    const el = document.getElementById("res-results");
    let html = '<div class="mc-kpi-row">' +
      kpiChip("TTR", fmt(r.ttrDays, 1) + "d") +
      kpiChip("Affected", r.affectedConsumerCount) +
      kpiChip("At risk", r.atRiskConsumerCount) +
      kpiChip("Worst gap", fmt(r.worstStockoutGapDays, 1) + "d") +
      '</div>';
    const affected = r.perConsumer.filter((c) => c.shortfallRate > 0).sort((a, b) => b.stockoutGapDays - a.stockoutGapDays).slice(0, 25);
    if (affected.length === 0) {
      html += '<p class="rail-note">No consumer loses any flow under this scenario relative to baseline.</p>';
    } else {
      html += '<table class="risk-table"><thead><tr><th>Consumer</th><th>Shortfall/d</th><th>TTS (d)</th><th>Status</th></tr></thead><tbody>';
      affected.forEach((c) => {
        html += '<tr class="' + (c.survives ? "survives" : "at-risk") + '"><td>' + escapeHtml(c.id) + '</td><td>' + fmt(c.shortfallRate, 0) + '</td><td>' + (c.ttsDays === Infinity ? "∞" : fmt(c.ttsDays, 1)) + '</td><td>' + (c.survives ? "survives" : "stockout in " + fmt(c.stockoutGapDays, 1) + "d") + '</td></tr>';
      });
      html += "</tbody></table>";
    }
    el.innerHTML = html;
  }

  // ---------- Phase 2: adversarial worst-case search ----------
  document.getElementById("btn-run-adversarial").addEventListener("click", () => {
    const budget = Number(document.getElementById("adv-budget").value) || 3;
    const perStepLimit = Number(document.getElementById("adv-per-step").value) || 20;
    const btn = document.getElementById("btn-run-adversarial");
    const status = document.getElementById("adv-status");
    btn.disabled = true;
    status.textContent = "Searching (budget " + budget + ", " + perStepLimit + " candidates/step) — this re-solves the network many times and may take a while at large scale...";
    document.getElementById("adv-results").innerHTML = "";
    setTimeout(() => {
      const t0 = performance.now();
      const r = NST.adversarial.runAdversarialSearch(state.network, { budget, perStepLimit, baseScenario: state.scenario });
      const ms = Math.round(performance.now() - t0);
      status.textContent = r.initialServiceLevelPct.toFixed(1) + "% → " + r.finalServiceLevelPct.toFixed(1) + "% in " + ms + "ms.";
      renderAdversarialResults(r);
      btn.disabled = false;
    }, 30);
  });

  function renderAdversarialResults(r) {
    const el = document.getElementById("adv-results");
    let html = "";
    r.steps.slice(1).forEach((s) => {
      html += '<div class="adv-step"><span class="step-n">#' + s.step + '</span><span class="step-id">' + s.type.toUpperCase() + " " + escapeHtml(s.id) + '</span><span class="step-sl">' + fmt(s.serviceLevelPct, 1) + '%</span></div>';
    });
    if (r.steps.length <= 1) html = '<p class="rail-note">No active elements left to remove.</p>';
    html += '<button class="btn small" id="adv-apply" style="margin-top:8px;">Apply this combination as scenario</button>';
    el.innerHTML = html;
    document.getElementById("adv-apply").addEventListener("click", () => {
      state.scenario = r.finalScenario;
      refreshAllTables(); map.setScenario(state.scenario); doSolve();
    });
  }

  // ---------- Tutorial: a worked example ----------
  // Every step's action button dispatches a real click on the actual
  // control (or sets its inputs first) rather than re-implementing that
  // control's behavior here, so the tutorial can never drift out of sync
  // with what the button really does.
  const TUTORIAL_STEPS = [
    {
      title: "A worked example",
      body: "We'll find your network's single biggest weak point, apply it as a disruption, check whether consumers can actually survive it, then compare against natural random risk and a compounded worst case. Each step has a button that performs it for you — watch what happens, then try it yourself anytime.",
      highlight: null, actionLabel: null, action: null,
    },
    {
      title: "1. Generate a small network",
      body: "We'll use a smaller network (15 production / 25 warehouse / 30 consumer sites, 3 products) so every step below runs in a second or two. The same tools work identically at full hundreds-of-nodes scale.",
      highlight: "#btn-generate", actionLabel: "Generate it",
      action: () => {
        document.getElementById("gen-production").value = 15;
        document.getElementById("gen-warehouse").value = 25;
        document.getElementById("gen-consumer").value = 30;
        document.getElementById("gen-products").value = 3;
        document.getElementById("btn-generate").click();
      },
    },
    {
      title: "2. Solve the baseline",
      body: "Before breaking anything, see what “normal” looks like — watch the Service Level tile in Key Results.",
      highlight: "#kpi-grid", actionLabel: "Solve the network",
      action: () => document.getElementById("btn-solve").click(),
    },
    {
      title: "3. Find the single biggest weak point",
      body: "The N-1 Contingency Scan disables every currently-active node and lane, one at a time, and ranks them by how much service level each single loss costs.",
      highlight: "#btn-scan", actionLabel: "Run the scan",
      action: () => { document.getElementById("scan-limit").value = 30; document.getElementById("btn-scan").click(); },
    },
    {
      title: "4. Apply the worst one",
      body: "Click that top-ranked result to disable it and re-solve automatically — exactly what happens if you click any scan row yourself.",
      highlight: "#scan-results", actionLabel: "Apply the top result",
      action: () => { const row = document.querySelector("#scan-results .scan-row"); if (row) row.click(); },
    },
    {
      title: "5. See the impact",
      body: "Compare Service Level to the baseline from step 2. Switching to Flow shows which lanes are actually carrying traffic now that one element is down.",
      highlight: "#kpi-grid", actionLabel: "Show flow on the map",
      action: () => { const btn = document.querySelector('[data-basemode="flow"]'); if (btn) btn.click(); },
    },
    {
      title: "6. Is it actually survivable?",
      body: "Time-to-Survive compares consumer inventory buffers against Time-to-Recover for whatever's disabled. If TTS is shorter, that consumer stocks out before recovery — real downtime, not just a percentage.",
      highlight: "#btn-run-resilience", actionLabel: "Run the check",
      action: () => document.getElementById("btn-run-resilience").click(),
    },
    {
      title: "7. What does normal risk look like?",
      body: "One hand-picked failure is a start. Monte Carlo asks a different question: given how often things actually fail, what's the realistic spread of outcomes? We'll clear the scenario first so it samples fresh.",
      highlight: "#btn-run-mc", actionLabel: "Clear scenario & run Monte Carlo",
      action: () => {
        document.getElementById("btn-clear-scenario").click();
        document.getElementById("mc-trials").value = 40;
        document.getElementById("btn-run-mc").click();
      },
    },
    {
      title: "8. How bad can it get on purpose?",
      body: "Adversarial Search greedily hunts for the worst combination of a few simultaneous failures — an adversary, or just bad luck, hitting more than one thing at once.",
      highlight: "#btn-run-adversarial", actionLabel: "Run adversarial search",
      action: () => { document.getElementById("adv-budget").value = 2; document.getElementById("btn-run-adversarial").click(); },
    },
    {
      title: "Done",
      body: "The full toolkit: Scenario + N-1 Scan for “what's the single biggest risk”, Time-to-Survive/Recover for “is it actually survivable”, Monte Carlo for “what does normal risk look like”, and Adversarial Search for “how bad can it get on purpose”. Now try it on your own data — edit nodes, import a CSV, or regenerate at full scale.",
      highlight: null, actionLabel: null, action: null,
    },
  ];

  let tutorialStep = 0;
  function showTutorialStep() {
    const s = TUTORIAL_STEPS[tutorialStep];
    document.getElementById("tutorial-step-count").textContent = "Step " + (tutorialStep + 1) + " of " + TUTORIAL_STEPS.length;
    document.getElementById("tutorial-title").textContent = s.title;
    document.getElementById("tutorial-body").textContent = s.body;
    const doBtn = document.getElementById("btn-tutorial-do");
    if (s.action) { doBtn.style.display = ""; doBtn.textContent = s.actionLabel; }
    else { doBtn.style.display = "none"; }
    document.getElementById("btn-tutorial-back").disabled = tutorialStep === 0;
    document.getElementById("btn-tutorial-next").textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? "Finish" : "Next →";
    document.querySelectorAll(".tutorial-highlight").forEach((el) => el.classList.remove("tutorial-highlight"));
    if (s.highlight) {
      const el = document.querySelector(s.highlight);
      if (el) { el.classList.add("tutorial-highlight"); el.scrollIntoView({ behavior: "smooth", block: "center" }); }
    }
  }
  function closeTutorial() {
    document.getElementById("tutorial-panel").hidden = true;
    document.querySelectorAll(".tutorial-highlight").forEach((el) => el.classList.remove("tutorial-highlight"));
  }
  document.getElementById("btn-tutorial").addEventListener("click", () => {
    tutorialStep = 0;
    document.getElementById("tutorial-panel").hidden = false;
    showTutorialStep();
  });
  document.getElementById("btn-tutorial-close").addEventListener("click", closeTutorial);
  document.getElementById("btn-tutorial-do").addEventListener("click", () => {
    const s = TUTORIAL_STEPS[tutorialStep];
    if (s.action) s.action();
  });
  document.getElementById("btn-tutorial-back").addEventListener("click", () => {
    if (tutorialStep > 0) { tutorialStep--; showTutorialStep(); }
  });
  document.getElementById("btn-tutorial-next").addEventListener("click", () => {
    if (tutorialStep < TUTORIAL_STEPS.length - 1) { tutorialStep++; showTutorialStep(); }
    else closeTutorial();
  });

  // ---------- init ----------
  renderModeDefaults();
  document.getElementById("btn-generate").click();
})();
