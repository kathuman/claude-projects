/*
 * decisions.js — the "Decisions" panel: scenarios, sensitivity and the optimiser.
 *
 * Owns only its own panel's DOM. It sees the rest of the app through
 * window.WH.app (the parameter model, the latest results, a hook that runs
 * after every recompute) and does its sums with the same pure modules as
 * everything else: calculations.js (computeAll) and optimizer.js.
 */
window.WH = window.WH || {};
window.WH.initDecisions = function () {
  "use strict";
  const A = window.WH.app, calc = window.WH.calc, opt = window.WH.opt, model = A.model;
  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  const money = function (v) { return isFinite(v) ? "$" + (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.round(v / 1000) + "k") : "—"; };
  const n0 = function (v) { return isFinite(v) ? Math.round(v).toLocaleString("en-US") : "—"; };

  // KPIs shared by the scenario table, the sensitivity analysis and exports
  const KPIS = [
    { key: "capacity", label: "Storage capacity", unit: "positions", get: function (r) { return r.capacity.storageCapacity; }, fmt: n0, better: "high" },
    { key: "practical", label: "Practical capacity", unit: "pallets", get: function (r) { return r.capacity.practicalCapacity; }, fmt: n0, better: "high" },
    { key: "selectivity", label: "Selectivity", unit: "%", get: function (r) { return r.capacity.selectivity * 100; }, fmt: function (v) { return Math.round(v) + "%"; }, better: "high" },
    { key: "perMove", label: "Time per pallet move", unit: "s", get: function (r) { return r.travel.perMove; }, fmt: function (v) { return Math.round(v) + " s"; }, better: "low" },
    { key: "trucks", label: "Lift trucks", unit: "trucks", get: function (r) { return r.travel.forkliftsNeeded; }, fmt: n0, better: "low" },
    { key: "wait", label: "Truck wait, peak hour", unit: "min", get: function (r) { return r.throughput.maxWait; }, fmt: function (v) { return isFinite(v) ? v.toFixed(1) + " min" : "no limit"; }, better: "low" },
    { key: "footprint", label: "Footprint", unit: "m²", get: function (r) { return r.cost.footprint; }, fmt: function (v) { return n0(v) + " m²"; }, better: "low" },
    { key: "capital", label: "Capital cost (incl. trucks)", unit: "$", get: function (r) { return r.cost.capitalCost; }, fmt: money, better: "low" },
    { key: "tco", label: "Annual cost of ownership", unit: "$/y", get: function (r) { return r.cost.annualTCO; }, fmt: money, better: "low" },
    { key: "costPerMove", label: "Cost per pallet move", unit: "$", get: function (r) { return r.cost.costPerMove; }, fmt: function (v) { return isFinite(v) ? "$" + v.toFixed(2) : "—"; }, better: "low" }
  ];

  // ------------------------------------------------------------------ tabs
  const tabs = document.querySelectorAll("[data-dtab]");
  let active = "scenarios";
  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      active = t.getAttribute("data-dtab");
      tabs.forEach(function (x) { const on = x === t; x.classList.toggle("active", on); x.setAttribute("aria-selected", String(on)); });
      document.querySelectorAll(".dpane").forEach(function (p) { p.hidden = p.id !== "dpane-" + active; });
      refresh();
    });
  });

  // ------------------------------------------------------------------ scenarios
  const STORE = "warehouse-scenarios";
  let scenarios = [];
  try { scenarios = JSON.parse(localStorage.getItem(STORE) || "[]") || []; } catch (e) { scenarios = []; }
  function persist() { try { localStorage.setItem(STORE, JSON.stringify(scenarios)); } catch (e) {} }
  function resultsFor(params) { return calc.computeAll(Object.assign({}, model.defaults, params), model.rackTypes); }

  $("scn-save").addEventListener("click", function () {
    const nameEl = $("scn-name");
    const name = (nameEl.value || "").trim() || "Scenario " + (scenarios.length + 1);
    scenarios.push({ name: name, params: model.getAll(), saved: new Date().toISOString() });
    if (scenarios.length > 8) scenarios.shift();
    nameEl.value = "";
    persist(); renderScenarios();
  });
  function renderScenarios() {
    const cols = scenarios.map(function (s, i) { return { name: s.name, r: resultsFor(s.params), p: s.params, i: i }; });
    cols.push({ name: "Current design", r: A.results(), p: model.getAll(), current: true });
    const typeLabel = function (c) { const rt = model.rackTypes[c.p.rack_type]; return rt ? rt.label : c.p.rack_type; };
    let h = "<thead><tr><th></th>" + cols.map(function (c) {
      return '<th scope="col">' + esc(c.name) + (c.current ? "" : '<div class="scn-actions"><button type="button" data-load="' + c.i + '">Load</button><button type="button" data-del="' + c.i + '" aria-label="Delete ' + esc(c.name) + '">✕</button></div>') + "</th>";
    }).join("") + "</tr></thead><tbody>";
    h += "<tr><th scope=\"row\">Rack type</th>" + cols.map(function (c) { return "<td>" + esc(typeLabel(c)) + "</td>"; }).join("") + "</tr>";
    h += "<tr><th scope=\"row\">Building (inside)</th>" + cols.map(function (c) { return "<td>" + c.p.warehouse_length + " × " + c.p.warehouse_width + " m</td>"; }).join("") + "</tr>";
    KPIS.forEach(function (k) {
      const vals = cols.map(function (c) { return k.get(c.r); });
      const finite = vals.filter(isFinite), best = finite.length > 1 ? (k.better === "high" ? Math.max.apply(null, finite) : Math.min.apply(null, finite)) : null;
      h += '<tr><th scope="row">' + k.label + "</th>" + vals.map(function (v) {
        return '<td class="' + (best !== null && Math.abs(v - best) < 1e-9 ? "best" : "") + '">' + k.fmt(v) + "</td>";
      }).join("") + "</tr>";
    });
    $("scn-table").innerHTML = h + "</tbody>";
    $("scn-empty").hidden = scenarios.length > 0;
    $("scn-table").querySelectorAll("[data-load]").forEach(function (b) { b.addEventListener("click", function () { model.setMany(scenarios[+b.getAttribute("data-load")].params); }); });
    $("scn-table").querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { scenarios.splice(+b.getAttribute("data-del"), 1); persist(); renderScenarios(); }); });
  }

  // share link: only the parameters that differ from the defaults, in the URL hash
  function shareHash() {
    const diff = {}, all = model.getAll();
    for (const k in all) if (all[k] !== model.defaults[k]) diff[k] = all[k];
    return "#d=" + btoa(unescape(encodeURIComponent(JSON.stringify(diff)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  $("scn-link").addEventListener("click", function () {
    const url = location.href.split("#")[0] + shareHash();
    const done = function (ok) { $("scn-msg").textContent = ok ? "Link copied — it opens this exact design." : "Copy this link: " + url; };
    try { navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
    try { history.replaceState(null, "", url); } catch (e) {}
  });
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function exportRows() {
    const cols = scenarios.map(function (s) { return { name: s.name, p: s.params, r: resultsFor(s.params) }; }).concat([{ name: "Current design", p: model.getAll(), r: A.results() }]);
    return cols;
  }
  $("scn-json").addEventListener("click", function () {
    const out = exportRows().map(function (c) {
      const k = {}; KPIS.forEach(function (x) { k[x.key] = x.get(c.r); });
      return { name: c.name, parameters: c.p, results: k };
    });
    download("warehouse-scenarios.json", JSON.stringify({ app: "Warehouse Model " + A.version, exported: new Date().toISOString(), scenarios: out }, null, 2), "application/json");
  });
  $("scn-csv").addEventListener("click", function () {
    const cols = exportRows(), q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
    const lines = [["", ...cols.map(function (c) { return c.name; })].map(q).join(",")];
    KPIS.forEach(function (k) { lines.push([k.label + " (" + k.unit + ")", ...cols.map(function (c) { const v = k.get(c.r); return isFinite(v) ? +v.toFixed(4) : ""; })].map(q).join(",")); });
    Object.keys(model.schema).forEach(function (name) { lines.push([name, ...cols.map(function (c) { return c.p[name]; })].map(q).join(",")); });
    download("warehouse-scenarios.csv", lines.join("\n"), "text/csv");
  });

  // ------------------------------------------------------------------ sensitivity
  const kpiSel = $("sens-kpi"), sweepSel = $("sens-param");
  KPIS.forEach(function (k) { const o = document.createElement("option"); o.value = k.key; o.textContent = k.label; kpiSel.appendChild(o); });
  kpiSel.value = "tco";
  const numericParams = Object.keys(model.schema).filter(function (n) { const d = model.schema[n]; return d.type !== "choice" && n !== "sim_lift_trucks"; });
  numericParams.forEach(function (n) { const o = document.createElement("option"); o.value = n; o.textContent = n.replace(/_/g, " "); sweepSel.appendChild(o); });
  sweepSel.value = "daily_throughput_pallets";
  kpiSel.addEventListener("change", refresh);
  sweepSel.addEventListener("change", refresh);

  function kpiOf(key) { return KPIS.filter(function (k) { return k.key === key; })[0]; }
  function nudge(name, value, dir) {
    const d = model.schema[name];
    let v = value * (1 + 0.1 * dir);
    if (d.unit === "count" || d.unit === "min" || d.unit === "hr") { v = Math.round(v); if (v === value) v = value + dir; }
    return Math.max(d.minimum, Math.min(d.maximum, v));
  }
  function renderTornado() {
    const k = kpiOf(kpiSel.value), p = model.getAll(), base = k.get(A.results());
    const rows = [];
    numericParams.forEach(function (n) {
      const lo = nudge(n, p[n], -1), hi = nudge(n, p[n], +1);
      if (lo === p[n] && hi === p[n]) return;
      const vl = k.get(calc.computeAll(Object.assign({}, p, { [n]: lo }), model.rackTypes));
      const vh = k.get(calc.computeAll(Object.assign({}, p, { [n]: hi }), model.rackTypes));
      rows.push({ n: n, lo: lo, hi: hi, dl: vl - base, dh: vh - base });
    });
    rows.forEach(function (r) { r.span = Math.max(Math.abs(r.dl), Math.abs(r.dh)); if (!isFinite(r.span)) r.span = Infinity; });
    rows.sort(function (a, b) { return b.span - a.span; });
    const top = rows.filter(function (r) { return r.span > 0; }).slice(0, 12);
    const mx = Math.max(1e-9, ...top.map(function (r) { return isFinite(r.span) ? r.span : 0; }));
    const W = 560, rowH = 22, lw = 190, cx = lw + (W - lw) / 2, half = (W - lw) / 2 - 8;
    let s = '<svg viewBox="0 0 ' + W + " " + (top.length * rowH + 30) + '" width="100%" role="img" aria-label="Tornado chart: effect of a ±10% change in each input on ' + k.label + '">';
    s += '<line x1="' + cx + '" y1="4" x2="' + cx + '" y2="' + (top.length * rowH + 8) + '" stroke="#6fa8c9"/>';
    top.forEach(function (r, i) {
      const y = 8 + i * rowH;
      const bar = function (d, color) {
        if (!isFinite(d)) return '<text x="' + (cx + 4) + '" y="' + (y + 12) + '" fill="#e34948" font-size="10">no limit</text>';
        const w = Math.abs(d) / mx * half, x = d < 0 ? cx - w : cx;
        return '<rect x="' + x + '" y="' + y + '" width="' + Math.max(0.5, w) + '" height="' + (rowH - 8) + '" fill="' + color + '" rx="2"/>';
      };
      s += '<text x="' + (lw - 8) + '" y="' + (y + 11) + '" fill="#8fd0f2" font-size="11" text-anchor="end">' + esc(r.n.replace(/_/g, " ")) + "</text>";
      s += bar(r.dl, "#6da7ec") + bar(r.dh, "#f5b833");
    });
    s += '<text x="' + cx + '" y="' + (top.length * rowH + 24) + '" fill="#6fa8c9" font-size="10" text-anchor="middle">change in ' + esc(k.label.toLowerCase()) + " from " + k.fmt(base) + "</text></svg>";
    $("sens-tornado").innerHTML = top.length ? s + '<div class="chart-legend"><span class="legend-item"><span class="swatch" style="background:#6da7ec"></span>input −10%</span><span class="legend-item"><span class="swatch" style="background:#f5b833"></span>input +10%</span></div>' : '<p class="hint">Nothing in the inputs moves this result by ±10%.</p>';
  }
  function renderSweep() {
    const k = kpiOf(kpiSel.value), n = sweepSel.value, d = model.schema[n], p = model.getAll();
    const N = 25, xs = [], ys = [];
    for (let i = 0; i < N; i++) {
      let v = d.minimum + (d.maximum - d.minimum) * i / (N - 1);
      if (d.unit === "count" || d.unit === "min" || d.unit === "hr") v = Math.round(v);
      xs.push(v); ys.push(k.get(calc.computeAll(Object.assign({}, p, { [n]: v }), model.rackTypes)));
    }
    const fin = ys.filter(isFinite), lo = Math.min.apply(null, fin), hi = Math.max.apply(null, fin);
    const W = 560, H = 200, pl = 60, pr = 16, pt = 12, pb = 30, X = function (v) { return pl + (v - d.minimum) / (d.maximum - d.minimum) * (W - pl - pr); };
    const Y = function (v) { return pt + (H - pt - pb) * (1 - (v - lo) / Math.max(1e-9, hi - lo)); };
    let path = "", pen = false;
    xs.forEach(function (x, i) { if (!isFinite(ys[i])) { pen = false; return; } path += (pen ? " L " : " M ") + X(x).toFixed(1) + " " + Y(ys[i]).toFixed(1); pen = true; });
    let s = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + esc(k.label) + " as " + esc(n.replace(/_/g, " ")) + ' varies over its range">';
    s += '<line x1="' + pl + '" y1="' + (H - pb) + '" x2="' + (W - pr) + '" y2="' + (H - pb) + '" stroke="#2a5580"/>';
    s += '<path d="' + path + '" fill="none" stroke="#7be0c4" stroke-width="2"/>';
    s += '<line x1="' + X(p[n]) + '" y1="' + pt + '" x2="' + X(p[n]) + '" y2="' + (H - pb) + '" stroke="#f5b833" stroke-dasharray="4,3"/>';
    s += '<text x="' + (pl - 6) + '" y="' + (pt + 8) + '" fill="#6fa8c9" font-size="10" text-anchor="end">' + k.fmt(hi) + "</text>";
    s += '<text x="' + (pl - 6) + '" y="' + (H - pb) + '" fill="#6fa8c9" font-size="10" text-anchor="end">' + k.fmt(lo) + "</text>";
    s += '<text x="' + pl + '" y="' + (H - 10) + '" fill="#6fa8c9" font-size="10">' + d.minimum + "</text>";
    s += '<text x="' + (W - pr) + '" y="' + (H - 10) + '" fill="#6fa8c9" font-size="10" text-anchor="end">' + d.maximum + "</text>";
    s += '<text x="' + X(p[n]) + '" y="' + (H - 10) + '" fill="#f5b833" font-size="10" text-anchor="middle">now ' + p[n] + "</text></svg>";
    $("sens-sweep").innerHTML = s;
  }

  // ------------------------------------------------------------------ optimiser
  let optRun = null, optResult = null;
  $("opt-run").addEventListener("click", function () {
    if (optRun) return;
    const p = model.getAll(), target = +$("opt-wait").value || 15, minSel = +$("opt-sel").value;
    const c = opt.candidates(p, model.rackTypes, { targetWait: target, minSelectivity: minSel, widthStep: 2.5 });
    const designs = [], t0 = performance.now();
    let i = 0;
    $("opt-status").textContent = "Searching " + c.list.length + " candidate designs…";
    $("opt-bar").style.width = "0%";
    optRun = true;
    (function chunk() {
      const until = performance.now() + 40;
      while (i < c.list.length && performance.now() < until) { const d = opt.evaluate(c.list[i++], model.rackTypes, target); if (d) designs.push(d); }
      $("opt-bar").style.width = (i / Math.max(1, c.list.length) * 100).toFixed(0) + "%";
      if (i < c.list.length) { setTimeout(chunk, 0); return; }
      optRun = null;
      optResult = { designs: opt.finish(designs), evaluated: c.list.length, target: target, ms: performance.now() - t0, base: A.results() };
      renderOptimizer();
    })();
  });
  function renderOptimizer() {
    const R = optResult;
    if (!R) return;
    const D = R.designs, cur = A.results();
    if (!D.length) { $("opt-status").textContent = "No design in the search space meets these targets — relax the wait target or the selectivity, or reduce the inventory."; $("opt-table").innerHTML = ""; $("opt-plot").innerHTML = ""; return; }
    const saving = 1 - D[0].tco / cur.cost.annualTCO;
    $("opt-status").innerHTML = R.evaluated + " candidates, " + D.length + " feasible (" + Math.round(R.ms) + " ms). Cheapest: <b>" + esc(D[0].label) + ", " + D[0].levels + " levels, " +
      D[0].length + " × " + D[0].width + " m</b> at " + money(D[0].tco) + "/year — " + (saving >= 0 ? Math.round(saving * 100) + "% below" : Math.round(-saving * 100) + "% above") + " the current design.";
    const show = D.slice(0, 10);
    let h = "<thead><tr><th>Rack type</th><th>Levels · height</th><th>Building</th><th>Doors in/out</th><th>Positions</th><th>s / move</th><th>Trucks</th><th>Capital</th><th>Annual cost</th><th>$ / move</th><th></th></tr></thead><tbody>";
    show.forEach(function (d, i) {
      h += "<tr" + (d.pareto ? ' class="pareto"' : "") + "><td>" + (d.pareto ? '<span title="Pareto front: nothing else is both cheaper and quicker">★</span> ' : "") + esc(d.label) + "</td><td>" + d.levels + " · " + d.rackHeight.toFixed(1) + " m (clear " + d.clearHeight + ")</td><td>" + d.length + " × " + d.width + " m</td><td>" +
        d.doorsIn + " / " + d.doorsOut + "</td><td>" + n0(d.capacity) + "</td><td>" + Math.round(d.perMove) + "</td><td>" + d.trucks + "</td><td>" + money(d.capital) + "</td><td>" + money(d.tco) + "</td><td>$" + d.costPerMove.toFixed(2) + '</td><td><button type="button" class="btn small" data-apply="' + i + '">Apply</button></td></tr>';
    });
    $("opt-table").innerHTML = h + "</tbody>";
    $("opt-table").querySelectorAll("[data-apply]").forEach(function (b) {
      b.addEventListener("click", function () {
        const q = D[+b.getAttribute("data-apply")].q, set = {};
        Object.keys(model.schema).forEach(function (n) { if (q[n] !== undefined) set[n] = q[n]; });
        model.setMany(set);
      });
    });
    // scatter: annual cost vs time per move, Pareto front highlighted, current design marked
    const W = 560, H = 230, pl = 58, pr = 14, pt = 12, pb = 34;
    const xs = D.map(function (d) { return d.perMove; }).concat([cur.travel.perMove]), ys = D.map(function (d) { return d.tco; }).concat([cur.cost.annualTCO]);
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    const X = function (v) { return pl + (v - x0) / Math.max(1e-9, x1 - x0) * (W - pl - pr); }, Y = function (v) { return pt + (H - pt - pb) * (1 - (v - y0) / Math.max(1e-9, y1 - y0)); };
    const colorOf = { selective: "#6da7ec", double_deep: "#33bf9e", vna: "#b58cff", push_back: "#f5b833", drive_in: "#e37e48" };
    let s = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="Every feasible design: annual cost against time per pallet move">';
    s += '<line x1="' + pl + '" y1="' + (H - pb) + '" x2="' + (W - pr) + '" y2="' + (H - pb) + '" stroke="#2a5580"/><line x1="' + pl + '" y1="' + pt + '" x2="' + pl + '" y2="' + (H - pb) + '" stroke="#2a5580"/>';
    D.forEach(function (d) { s += '<circle cx="' + X(d.perMove).toFixed(1) + '" cy="' + Y(d.tco).toFixed(1) + '" r="' + (d.pareto ? 4 : 2.3) + '" fill="' + (colorOf[d.rackType] || "#ccc") + '" opacity="' + (d.pareto ? 1 : 0.45) + '"' + (d.pareto ? ' stroke="#fff" stroke-width="1"' : "") + "/>"; });
    s += '<path d="M ' + (X(cur.travel.perMove) - 6) + " " + Y(cur.cost.annualTCO) + " l 6 -6 l 6 6 l -6 6 z" + '" fill="none" stroke="#fff" stroke-width="1.5"/>';
    s += '<text x="' + (X(cur.travel.perMove) + 9) + '" y="' + (Y(cur.cost.annualTCO) + 4) + '" fill="#fff" font-size="10">current</text>';
    s += '<text x="' + (pl - 6) + '" y="' + (pt + 8) + '" fill="#6fa8c9" font-size="10" text-anchor="end">' + money(y1) + '</text><text x="' + (pl - 6) + '" y="' + (H - pb) + '" fill="#6fa8c9" font-size="10" text-anchor="end">' + money(y0) + "</text>";
    s += '<text x="' + pl + '" y="' + (H - 16) + '" fill="#6fa8c9" font-size="10">' + Math.round(x0) + ' s</text><text x="' + (W - pr) + '" y="' + (H - 16) + '" fill="#6fa8c9" font-size="10" text-anchor="end">' + Math.round(x1) + " s</text>";
    s += '<text x="' + ((pl + W - pr) / 2) + '" y="' + (H - 4) + '" fill="#6fa8c9" font-size="10" text-anchor="middle">time per pallet move → (annual cost ↑)</text></svg>';
    const types = {}; D.forEach(function (d) { types[d.rackType] = d.label; });
    $("opt-plot").innerHTML = s + '<div class="chart-legend">' + Object.keys(types).map(function (t) { return '<span class="legend-item"><span class="swatch" style="background:' + colorOf[t] + '"></span>' + esc(types[t]) + "</span>"; }).join("") +
      '<span class="legend-item">★ / outlined = Pareto front · ◇ = current design</span></div>';
  }

  // ------------------------------------------------------------------ refresh after every recompute (debounced)
  let timer = null;
  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (active === "scenarios") renderScenarios();
      else if (active === "sensitivity") { renderTornado(); renderSweep(); }
      else if (active === "optimizer" && optResult) renderOptimizer();
    }, 250);
  }
  A.onRecompute(refresh);
  window.WH.decisions = { shareHash: shareHash, scenarios: function () { return scenarios; }, optimizer: function () { return optResult; } };
  refresh();
};
