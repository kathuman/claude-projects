/*
 * app.js — the page: controls built from data/scenario.json, the plan view
 * (one layout at a time, all at one scale), the results table (one column per
 * warehouse, each A/B value compared with WH-C) and the derivation trace of
 * the layout on screen. Every visible string goes through T() (src/t.js).
 */
(function () {
  "use strict";
  const APP_VERSION = "0.6.0";
  const IDS = ["A", "B", "C"];
  const SHARED = ["target_locations", "skus", "demand_skew", "demand_curve", "lines_per_order", "slotting", "lines_per_day", "picker_speed", "pick_time_per_line"];
  const COST = ["labour_cost_per_hour", "building_cost_per_sqm", "robot_cost", "gtp_station_cost", "discount_rate"];
  // layout controls, and (for WH-B) which arrangement each applies to
  const A_CTRL = { put_away: null, pod_fill: null, order_slots: null, pipeline: null, robot_speed: null, storage_fill: null };
  const B_CTRL = { arrangement: null, hub_radius: null, zones: "radial", ring_aisle_width: "radial", radial_aisles: "concentric", radial_aisle_width: "concentric" };
  const $ = function (id) { return document.getElementById(id); };
  const T = WC.t.T, I18 = window.WCi18n;
  let scJson, inputs, defaults, result = {}, tab = "A", mode = "plan", view = { color: "cost", network: false, three: false }, order = null, orderSeed = 1;

  function fmt(v, d) { return Number(v).toLocaleString(WC.t.locale(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function digits(d) { return d.unit === "×" ? 2 : (d.unit === "m/s" || d.unit === "m") ? 1 : 0; }
  // an input's label and description, translated when a language is loaded
  function words(k, d) { const p = I18 && I18.param(k); return p || { label: d.label, description: d.description }; }
  function optLabel(k, o, d) {
    if (k === "demand_curve" && o === "data") return T("From your order data");
    const c = I18 && I18.choice(k, o); return c != null ? c : d.labels[o];
  }
  function unitText(u) { return u === "lines/h" ? T("lines/h") : u; }

  function control(box, defs, k, get, set, onChange) {
    const d = defs[k], f = document.createElement("div"), w = words(k, d);
    f.className = "field"; f.id = "f_" + k;
    if (d.type === "choice") {
      const opts = k === "demand_curve" && inputs.sc.data_weights ? d.options.concat(["data"]) : d.options;
      f.innerHTML = "<label for='c_" + k + "'></label><select id='c_" + k + "'>" +
        opts.map(function (o) { return "<option value='" + o + "'" + (o === get() ? " selected" : "") + "></option>"; }).join("") + "</select>";
      f.querySelectorAll("option").forEach(function (op) { op.textContent = optLabel(k, op.value, d); });
    } else {
      const step = d.maximum - d.minimum > 1000 ? 100 : d.unit === "×" ? 0.01 : (d.unit === "m/s" || d.unit === "m") ? 0.1 : 1;
      const max = k === "target_locations" ? 30000 : k === "skus" ? 25000 : k === "lines_per_day" ? 60000 : d.maximum;
      f.innerHTML = "<label for='c_" + k + "'><span></span> <output id='o_" + k + "'></output></label>" +
        "<input type='range' id='c_" + k + "' min='" + d.minimum + "' max='" + max + "' step='" + step + "' value='" + get() + "'>";
    }
    const lab = f.querySelector("label span") || f.querySelector("label");
    lab.textContent = w.label;
    const help = document.createElement("div"); help.className = "help"; help.textContent = w.description; f.appendChild(help);
    box.appendChild(f);
    const el = f.querySelector("#c_" + k), out = f.querySelector("#o_" + k);
    const show = function () {
      if (!out) return;
      const pre = d.unit === "$" ? "$" : "", post = d.unit === "$" ? "" : d.unit ? (d.unit === "×" ? " ×" : " " + d.unit) : "";
      out.textContent = pre + fmt(get(), digits(d)) + post;
    };
    el.addEventListener("input", function () { set(d.type === "choice" ? el.value : Number(el.value)); show(); onChange(k); });
    show();
    return { el: el, show: show };
  }

  const ctl = {};
  function section(box, title) { const h = document.createElement("h2"); h.textContent = title; h.style.marginTop = "10px"; box.appendChild(h); }
  function buildControls() {
    const box = $("controls"), sc = inputs.sc, A = inputs.layouts.A, B = inputs.layouts.B;
    box.innerHTML = "";
    section(box, T("Shared — all warehouses"));
    SHARED.forEach(function (k) { ctl[k] = control(box, scJson.shared, k, function () { return sc[k]; }, function (v) { sc[k] = v; }, function () { schedule(IDS); }); });
    // with imported data the skew is the data's own, shown but not set
    ctl.demand_skew.el.disabled = sc.demand_curve === "data";
    dataBlock(box);
    section(box, T("WH-A — moving racks"));
    Object.keys(A_CTRL).forEach(function (k) { ctl[k] = control(box, scJson.layouts.A, k, function () { return A[k]; }, function (v) { A[k] = v; }, function () { schedule(["A"]); }); });
    section(box, T("WH-B — semicircle"));
    Object.keys(B_CTRL).forEach(function (k) { ctl[k] = control(box, scJson.layouts.B, k, function () { return B[k]; }, function (v) { B[k] = v; }, function () { showBFields(); schedule(["B"]); }); });
    section(box, T("Cost"));
    COST.forEach(function (k) { ctl[k] = control(box, scJson.shared, k, function () { return sc[k]; }, function (v) { sc[k] = v; }, function () { schedule(IDS); }); });
    showBFields();
  }
  // ---- order data: set the demand from a CSV of real order lines (src/dataimport.js)
  let dataMsg = "";
  function dataBlock(box) {
    const f = document.createElement("div"); f.className = "field data-block";
    const lab = document.createElement("label"); lab.textContent = T("Your order data"); f.appendChild(lab);
    const row = document.createElement("div"); row.className = "data-btns";
    const file = document.createElement("label"); file.className = "btn"; file.textContent = T("Import order lines (CSV)");
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".csv,.txt,text/csv"; inp.hidden = true; file.appendChild(inp);
    const sample = document.createElement("button"); sample.className = "btn"; sample.textContent = T("Try the sample data");
    row.appendChild(file); row.appendChild(sample);
    if (inputs.sc.data_weights) { const reset = document.createElement("button"); reset.className = "btn"; reset.textContent = T("Back to the scenario's demand"); reset.onclick = resetData; row.appendChild(reset); }
    f.appendChild(row);
    const help = document.createElement("div"); help.className = "help"; help.id = "dataMsg";
    help.textContent = dataMsg || T("One row per order line, with an order column and a SKU column (a date column is optional). Read in your browser; nothing is uploaded.");
    f.appendChild(help);
    box.appendChild(f);
    inp.onchange = function () {
      const fl = inp.files && inp.files[0]; if (!fl) return;
      const rd = new FileReader();
      rd.onload = function () { applyData(WC.dataimport.analyse(rd.result), fl.name); };
      rd.readAsText(fl);
    };
    sample.onclick = function () {
      fetch("data/sample-orders.csv").then(function (r) { return r.text(); }).then(function (t) { applyData(WC.dataimport.analyse(t), "sample-orders.csv"); });
    };
  }
  function applyData(r, name) {
    if (!r.ok) { dataMsg = r.messages.join(" "); $("dataMsg").textContent = dataMsg; return; }
    const sc = inputs.sc, clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
    sc.demand_curve = "data"; sc.data_weights = r.weights;
    sc.skus = r.skus; sc.demand_skew = clamp(Math.round(r.skew), 20, 99);
    sc.lines_per_order = clamp(Math.round(r.linesPerOrder * 10) / 10, 1, 20); sc.max_lines = clamp(r.maxLines, 1, 40);
    if (r.linesPerDay) sc.lines_per_day = Math.round(r.linesPerDay);
    // capacity follows the data at the scenario's fill: locations = SKUs ÷ 0.85, to the next hundred
    sc.target_locations = Math.ceil(sc.skus / 0.85 / 100) * 100;
    dataMsg = T("{f}: {o} orders, {l} lines, {s} SKUs, {p} lines per order; the top 20% of SKUs take {k}% of lines.", { f: name, o: WC.t.int(r.orders), l: WC.t.int(r.lines), s: WC.t.int(r.skus), p: WC.t.fx(r.linesPerOrder, 2), k: Math.round(r.skew) }) + (r.messages.length ? " " + r.messages.join(" ") : "");
    buildControls(); schedule(IDS);
  }
  function resetData() {
    const sc = inputs.sc, d = defaults.sc;
    delete sc.data_weights;
    ["demand_curve", "skus", "demand_skew", "lines_per_order", "max_lines", "lines_per_day", "target_locations"].forEach(function (k) { sc[k] = d[k]; });
    dataMsg = ""; buildControls(); schedule(IDS);
  }

  function showBFields() {
    Object.keys(B_CTRL).forEach(function (k) { $("f_" + k).hidden = B_CTRL[k] !== null && B_CTRL[k] !== inputs.layouts.B.arrangement; });
  }

  let timer = null, pending = new Set();
  function schedule(which) {
    which.forEach(function (w) { pending.add(w); });
    clearTimeout(timer);
    $("busy").hidden = false;
    timer = setTimeout(function () { recompute(Array.from(pending)); pending.clear(); $("busy").hidden = true; }, 150);
  }

  function recompute(which) {
    // SKUs can't exceed the locations every layout is sized to
    if (inputs.sc.skus > inputs.sc.target_locations) {
      inputs.sc.target_locations = inputs.sc.skus; $("c_target_locations").value = inputs.sc.skus; ctl.target_locations.show();
      which = IDS;
    }
    result = WC.scenario.run(inputs, null, which, result);
    saveLink();
    if (order) routeOrder();
    render();
    WC.views.invalidate();
    // the technology screen's evidence comes from these results: redo it (now, if it's on screen)
    WC.techview.invalidate();
    if (mode === "tech") WC.techview.show();
  }

  function span() {
    let sx = 0, sy = 0;
    IDS.forEach(function (id) {
      const r = result[id]; if (!r || r.infeasible) return;
      const xs = r.layout.outline.map(function (p) { return p[0]; }), ys = r.layout.outline.map(function (p) { return p[1]; });
      sx = Math.max(sx, Math.max.apply(null, xs) - Math.min.apply(null, xs)); sy = Math.max(sy, Math.max.apply(null, ys) - Math.min.apply(null, ys));
    });
    return [sx, sy];
  }

  // which panel is on screen: a plan (tab = A/B/C) or one of the comparison views
  function showPanel() {
    document.querySelectorAll(".tab[data-id]").forEach(function (t) { const on = mode === "plan" && t.dataset.id === tab; t.classList.toggle("on", on); t.setAttribute("aria-selected", on); });
    document.querySelectorAll(".tab[data-view]").forEach(function (t) { const on = t.dataset.view === mode; t.classList.toggle("on", on); t.setAttribute("aria-selected", on); });
    $("planView").hidden = mode !== "plan";
    $("viewSide").hidden = mode !== "side"; $("viewSens").hidden = mode !== "sens"; $("viewShock").hidden = mode !== "shock"; $("viewTech").hidden = mode !== "tech";
    if (mode === "plan") render(); else if (mode === "tech") WC.techview.show(); else WC.views.show(mode);
  }

  function render() {
    if (mode !== "plan") { renderSide(); return; }
    const r = result[tab];
    const three = view.three && !!(WC.view3d);
    $("plan").hidden = three; $("plan3d").hidden = !three;
    ["net", "order"].forEach(function (b) { $(b).disabled = three; });          // routes and the network are drawn in plan only
    if (r && !r.infeasible) {
      if (three) {
        const opts = { sc: inputs.sc, color: view.color };
        // reframe when the layout's size changes, not when only colours do
        WC.view3d.show($("plan3d"), WC.scene3d.spec(r, inputs), WC.plan.bayFills(r, opts), tab + ":" + Math.round(r.layout.footprint));
      } else WC.plan.draw($("plan"), r, { sc: inputs.sc, color: view.color, network: view.network, route: order && order.routes[tab], span: span() });
      $("route").textContent = !three && order && order.routes[tab] ? routeText() : three ? T("Drag to turn, scroll to zoom.") : "";
    }
    const cls = function (t) { return "<i style='background:" + WC.plan.heat(t) + "'></i>"; };
    const span_ = function (s) { const e = document.createElement("span"); e.textContent = s; return e.outerHTML; };
    $("legend").innerHTML = (view.color === "cost"
      ? "<span><i class='grad'></i>" + (tab === "A" ? T("slot's robot distance to the nearest station: near → far") : T("travel time from the nearest picking point: near → far")) + "</span>"
      : span_(tab === "A" ? T("popularity class of the pod in the slot:") : T("SKU class stored there (averaged over the shelf levels):")) +
        "<span>" + cls(0) + T("A — most popular 20%") + "</span><span>" + cls(0.5) + T("B — next 30%") + "</span><span>" + cls(1) + T("C — the rest") + "</span>") +
      "<span><i style='background:#1d4470'></i>" + T("empty") + "</span><span><i style='background:#7be0c4'></i>" + (tab === "A" ? T("station") : T("picking point")) + "</span>" + span_(T("all plans at one scale"));
    renderSide();
  }

  // the results table, warnings and trace (on screen in every mode)
  function renderSide() {
    const r = result[tab];
    const warns = $("warns"); warns.innerHTML = "";
    IDS.forEach(function (id) { (result[id] && result[id].warnings || []).forEach(function (w) { const d = document.createElement("div"); d.textContent = "⚠ " + id + ": " + w.text; warns.appendChild(d); }); });
    const ok = function (id) { return result[id] && !result[id].infeasible; };
    const cell = function (id, d) {
      if (!WC.kpi.applies(d, id) || !ok(id)) return "<td class='na'>—</td>";
      const v = result[id].kpi[d.key] * (d.scale || 1);
      let diff = "";
      if (id !== "C" && WC.kpi.applies(d, "C") && ok("C")) {
        const c = result.C.kpi[d.key] * (d.scale || 1);
        if (c !== 0 && isFinite(c)) {
          const pct = 100 * (v - c) / Math.abs(c), good = d.better === "lower" ? pct < 0 : pct > 0;
          diff = Math.abs(pct) < 0.5 ? "<small class='same'>≈ C</small>" : "<small class='" + (good ? "better" : "worse") + "'>" + (pct > 0 ? "+" : "") + fmt(pct, 0) + "%</small>";
        } else if (c === 0 && v > 0) diff = "<small class='worse'>C: 0</small>";
      }
      return "<td>" + fmt(v, d.d) + diff + "</td>";
    };
    const rows = WC.kpi.KPI_DEFS.map(function (d) {
      return "<tr><td>" + T(d.label) + (d.unit ? " <span class='unit'>" + unitText(d.unit) + "</span>" : "") + "</td>" + IDS.map(function (id) { return cell(id, d); }).join("") + "</tr>";
    }).join("");
    $("kpi").innerHTML = "<tr><th>" + T("Measure") + "</th><th>WH-A</th><th>WH-B</th><th>WH-C</th></tr>" + rows +
      "<tr><td colspan='4' class='na' style='text-align:left'>" + T("Small figures: WH-A and WH-B relative to WH-C (green is better).") + "</td></tr>";
    $("traceTitle").textContent = T("How {id}'s numbers are derived", { id: "WH-" + tab });
    const list = $("trace"); list.innerHTML = "";
    if (r && r.trace) r.trace.forEach(function (t) {
      const li = document.createElement("li");
      [["l", t.label], ["e", t.expr], ["v", t.value]].forEach(function (p) { const d = document.createElement("div"); d.className = p[0]; d.textContent = p[1]; li.appendChild(d); });
      list.appendChild(li);
    });
  }

  // one order, followed in every layout — the comparison is paired
  function newOrder() {
    const st = WC.demand.orderStream(inputs.sc, 777 + orderSeed++);
    let skus = st.next();
    for (let t = 0; t < 20 && skus.length < 3; t++) skus = st.next();
    order = { skus: skus, lines: skus.length, routes: {} };
    routeOrder(); render();
  }
  function routeOrder() {
    ["B", "C"].forEach(function (id) {
      const r = result[id]; if (!r || r.infeasible) return;
      order.routes[id] = WC.routing.route(r.layout.M, r.layout.depots, order.skus.map(function (s) { return r.layout.locations.key[r.skuLoc[s]]; }));
    });
    const a = result.A;
    if (a) {
      // WH-A: each distinct pod makes a loaded round trip to its nearest station
      const L = a.layout, pods = Array.from(new Set(order.skus.map(function (s) { return a.skuPod[s]; })));
      let dist = 0;
      const segments = pods.map(function (p) {
        const sl = a.podSlot[p], d = L.toStation[sl], si = d.indexOf(Math.min.apply(null, d));
        dist += 2 * d[si];
        return [L.slots[sl].key, L.depots[si], L.slots[sl].x, L.slots[sl].y];
      });
      order.routes.A = { segments: segments, stops: pods.length, dist: dist };
    }
  }
  function routeText() {
    const rt = order.routes[tab], others = IDS.filter(function (id) { return id !== tab && order.routes[id]; });
    const own = tab === "A" ? T("{l} lines · {p} pods · {d} m of loaded robot trips (picker stays)", { l: order.lines, p: rt.stops, d: fmt(rt.dist, 1) })
      : T("{l} lines · {s} stops · {d} m walk", { l: order.lines, s: rt.stops, d: fmt(rt.dist, 1) });
    return own + "  |  " + others.map(function (id) { return id + ": " + fmt(order.routes[id].dist, 1) + " m"; }).join(" · ");
  }

  function toggle(id, on) { $(id).classList.toggle("on", on); }
  $("colCost").onclick = function () { view.color = "cost"; toggle("colCost", true); toggle("colPop", false); render(); };
  $("colPop").onclick = function () { view.color = "pop"; toggle("colCost", false); toggle("colPop", true); render(); };
  $("net").onclick = function () { view.network = !view.network; toggle("net", view.network); render(); };
  $("order").onclick = newOrder;
  $("three").onclick = function () { view.three = !view.three; toggle("three", view.three); render(); };
  window.addEventListener("wc-view3d-ready", function () { if (view.three && result.C) render(); });
  $("copyLink").onclick = function () {
    const b = $("copyLink"), label = b.textContent;
    const done = function () { b.textContent = T("Link copied"); setTimeout(function () { b.textContent = label; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(done, function () { b.textContent = T("Copy the address bar"); });
    else b.textContent = T("Copy the address bar");
  };
  document.querySelectorAll(".tab[data-id]").forEach(function (t) { t.onclick = function () { tab = t.dataset.id; mode = "plan"; showPanel(); }; });
  document.querySelectorAll(".tab[data-view]").forEach(function (t) { t.onclick = function () { mode = t.dataset.view; showPanel(); }; });
  window.addEventListener("resize", function () { if (result.C && mode === "plan") render(); });

  $("ver").textContent = "v" + APP_VERSION;
  // the address bar carries the inputs that differ from the defaults (comparison and technology screen)
  function saveLink() {
    const link = WC.share.encode(inputs, defaults);
    history.replaceState(null, "", location.pathname + location.search + (link ? "#" + link : ""));
  }
  Promise.all(["data/scenario.json", "../warehouse-model/data/parameters.json", "data/archetypes.json"].map(function (u) { return fetch(u).then(function (r) { return r.json(); }); }))
    .then(function (j) {
      scJson = j[0]; inputs = WC.scenario.resolve(j[0], j[1]); defaults = WC.scenario.resolve(j[0], j[1]);
      // the technology screen's site, starting from the spec's worked example
      const site0 = Object.assign({}, j[2].example_site); delete site0.site_name;
      inputs.site = Object.assign({}, site0); defaults.site = Object.assign({}, site0);
      WC.share.decode(location.hash, inputs, scJson, j[2].site_inputs);
      WC.techview.init({ catalogue: j[2], inputs: function () { return inputs; }, results: function () { return result; }, changed: saveLink, goto: function (id) { tab = id; mode = "plan"; showPanel(); } });
      WC.scenario.syncB(inputs);
      WC.views.init({ inputs: function () { return inputs; }, results: function () { return result; }, span: span });
      buildControls(); recompute(IDS); $("busy").hidden = true;
      window.wcDebug = { inputs: inputs, result: function () { return result; }, recompute: recompute, setTab: function (t) { tab = t; mode = "plan"; showPanel(); }, setView: function (v) { mode = v; showPanel(); }, version: APP_VERSION };
    })
    .catch(function (e) { $("warns").textContent = T("Could not load the scenario: {m}", { m: e.message }); });
})();
