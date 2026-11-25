/*
 * app.js — the page: controls built from data/scenario.json, the plan view
 * (one layout at a time, all at one scale), the results table (one column per
 * warehouse) and the derivation trace of the layout on screen.
 */
(function () {
  "use strict";
  const APP_VERSION = "0.2.0";
  const SHARED = ["target_locations", "skus", "demand_skew", "lines_per_order", "slotting", "lines_per_day", "picker_speed", "pick_time_per_line"];
  // WH-B controls, and which arrangement each one applies to
  const B_CTRL = { arrangement: null, hub_radius: null, zones: "radial", ring_aisle_width: "radial", radial_aisles: "concentric", radial_aisle_width: "concentric" };
  const NAMES = { A: "WH-A · moving racks", B: "WH-B · semicircle", C: "WH-C · rectangle" };
  const $ = function (id) { return document.getElementById(id); };
  let scJson, inputs, result = {}, tab = "B", view = { color: "cost", network: false }, order = null, orderSeed = 1;

  function fmt(v, d) { return Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function label(k) { return k.replace(/_/g, " ").replace(/^./, function (c) { return c.toUpperCase(); }); }

  function control(box, defs, k, get, set, onChange) {
    const d = defs[k], f = document.createElement("div");
    f.className = "field"; f.id = "f_" + k;
    if (d.type === "choice") {
      f.innerHTML = "<label for='c_" + k + "'>" + label(k) + "</label><select id='c_" + k + "'>" +
        d.options.map(function (o) { return "<option value='" + o + "'" + (o === get() ? " selected" : "") + ">" + d.labels[o] + "</option>"; }).join("") + "</select>";
    } else {
      const step = d.maximum - d.minimum > 1000 ? 100 : (d.unit === "m/s" || d.unit === "m") ? 0.1 : 1;
      const max = k === "target_locations" ? 30000 : k === "skus" ? 25000 : k === "lines_per_day" ? 60000 : d.maximum;
      f.innerHTML = "<label for='c_" + k + "'>" + label(k) + " <output id='o_" + k + "'></output></label>" +
        "<input type='range' id='c_" + k + "' min='" + d.minimum + "' max='" + max + "' step='" + step + "' value='" + get() + "'>";
    }
    f.innerHTML += "<div class='help'>" + d.description + "</div>";
    box.appendChild(f);
    const el = f.querySelector("#c_" + k), out = f.querySelector("#o_" + k);
    const show = function () { if (out) out.textContent = fmt(get(), step(d)) + (d.unit ? " " + d.unit : ""); };
    el.addEventListener("input", function () { set(d.type === "choice" ? el.value : Number(el.value)); show(); onChange(k); });
    show();
    return { el: el, show: show };
  }
  function step(d) { return d.unit === "m/s" || d.unit === "m" ? 1 : 0; }

  const ctl = {};
  function buildControls() {
    const box = $("controls"), sc = inputs.sc, B = inputs.layouts.B;
    box.innerHTML = "<h2>Shared — all warehouses</h2>";
    SHARED.forEach(function (k) { ctl[k] = control(box, scJson.shared, k, function () { return sc[k]; }, function (v) { sc[k] = v; }, function () { schedule(["B", "C"]); }); });
    const hb = document.createElement("h2"); hb.textContent = "WH-B — semicircle"; hb.style.marginTop = "10px"; box.appendChild(hb);
    Object.keys(B_CTRL).forEach(function (k) { ctl[k] = control(box, scJson.layouts.B, k, function () { return B[k]; }, function (v) { B[k] = v; }, function () { showBFields(); schedule(["B"]); }); });
    showBFields();
  }
  function showBFields() {
    Object.keys(B_CTRL).forEach(function (k) { $("f_" + k).hidden = B_CTRL[k] !== null && B_CTRL[k] !== inputs.layouts.B.arrangement; });
  }

  let timer = null, pending = new Set();
  function schedule(which) { which.forEach(function (w) { pending.add(w); }); clearTimeout(timer); timer = setTimeout(function () { recompute(Array.from(pending)); pending.clear(); }, 150); }

  function recompute(which) {
    // SKUs can't exceed the locations every layout is sized to
    if (inputs.sc.skus > inputs.sc.target_locations) {
      inputs.sc.target_locations = inputs.sc.skus; $("c_target_locations").value = inputs.sc.skus; ctl.target_locations.show();
      which = ["B", "C"];
    }
    result = WC.scenario.run(inputs, null, which, result);
    if (order) routeOrder();
    render();
  }

  function span() {
    let sx = 0, sy = 0;
    ["B", "C"].forEach(function (id) {
      const r = result[id]; if (!r || r.infeasible) return;
      const xs = r.layout.outline.map(function (p) { return p[0]; }), ys = r.layout.outline.map(function (p) { return p[1]; });
      sx = Math.max(sx, Math.max.apply(null, xs) - Math.min.apply(null, xs)); sy = Math.max(sy, Math.max.apply(null, ys) - Math.min.apply(null, ys));
    });
    return [sx, sy];
  }

  function render() {
    document.querySelectorAll(".tab[data-id]").forEach(function (t) { const on = t.dataset.id === tab; t.classList.toggle("on", on); t.setAttribute("aria-selected", on); });
    const r = result[tab];
    $("warns").innerHTML = ["B", "C"].map(function (id) {
      return (result[id] && result[id].warnings || []).map(function (w) { return "<div>⚠ " + id + ": " + w.text + "</div>"; }).join("");
    }).join("");
    if (r && !r.infeasible) {
      WC.plan.draw($("plan"), r, { sc: inputs.sc, color: view.color, network: view.network, route: order && order.routes[tab], span: span() });
      $("route").textContent = order ? order.lines + " lines · " + order.routes[tab].stops + " stops · " + fmt(order.routes[tab].dist, 1) + " m walk in " + tab + " (" + otherText() + ")" : "";
    }
    $("legend").innerHTML = (view.color === "cost"
      ? "<span><i class='grad'></i>travel time from the nearest picking point: near → far</span>"
      : "<span>SKU class stored there (averaged over the shelf levels): </span><span><i style='background:" + WC.plan.heat(0) + "'></i>A — most popular 20%</span>" +
        "<span><i style='background:" + WC.plan.heat(0.5) + "'></i>B — next 30%</span><span><i style='background:" + WC.plan.heat(1) + "'></i>C — the rest</span><span><i style='background:#1d4470'></i>empty</span>") +
      "<span><i style='background:#7be0c4'></i>picking point</span><span>both plans drawn at one scale</span>";

    const ok = function (id) { return result[id] && !result[id].infeasible; };
    const rows = WC.kpi.KPI_DEFS.map(function (d) {
      const b = ok("B") ? result.B.kpi[d.key] : NaN, c = ok("C") ? result.C.kpi[d.key] : NaN;
      let diff = "";
      if (isFinite(b) && isFinite(c) && c !== 0) {
        const pct = 100 * (b - c) / Math.abs(c), good = d.better === "lower" ? pct < 0 : pct > 0;
        diff = Math.abs(pct) < 0.5 ? "<td class='same'>≈</td>" : "<td class='" + (good ? "better" : "worse") + "'>" + (pct > 0 ? "+" : "") + fmt(pct, 0) + "%</td>";
      } else diff = "<td class='na'>—</td>";
      return "<tr><td>" + d.label + (d.unit ? " <span class='unit'>" + d.unit + "</span>" : "") + "</td><td class='na'>—</td><td>" + (isFinite(b) ? fmt(b, d.d) : "—") + "</td><td>" + (isFinite(c) ? fmt(c, d.d) : "—") + "</td>" + diff + "</tr>";
    }).join("");
    $("kpi").innerHTML = "<tr><th>Measure</th><th>WH-A</th><th>WH-B</th><th>WH-C</th><th title='WH-B relative to WH-C; green is better'>B vs C</th></tr>" + rows +
      "<tr><td colspan='5' class='na' style='text-align:left'>WH-A (moving racks) arrives in phase 3, measured through the same table.</td></tr>";
    $("traceTitle").textContent = "How " + tab + "'s numbers are derived";
    $("trace").innerHTML = r ? r.trace.map(function (t) {
      return "<li><div class='l'>" + t.label + "</div><div class='e'>" + t.expr + "</div><div class='v'>" + t.value + "</div></li>";
    }).join("") : "";
  }

  // one order, routed in every layout — the comparison is paired
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
  }
  function otherText() {
    const o = tab === "B" ? "C" : "B", r = order.routes[o];
    return r ? fmt(r.dist, 1) + " m in " + o : "";
  }

  function toggle(id, on) { $(id).classList.toggle("on", on); }
  $("colCost").onclick = function () { view.color = "cost"; toggle("colCost", true); toggle("colPop", false); render(); };
  $("colPop").onclick = function () { view.color = "pop"; toggle("colCost", false); toggle("colPop", true); render(); };
  $("net").onclick = function () { view.network = !view.network; toggle("net", view.network); render(); };
  $("order").onclick = newOrder;
  document.querySelectorAll(".tab[data-id]").forEach(function (t) { t.onclick = function () { tab = t.dataset.id; render(); }; });
  window.addEventListener("resize", function () { if (result.C) render(); });

  $("ver").textContent = "v" + APP_VERSION;
  Promise.all([fetch("data/scenario.json").then(function (r) { return r.json(); }), fetch("../warehouse-model/data/parameters.json").then(function (r) { return r.json(); })])
    .then(function (j) {
      scJson = j[0]; inputs = WC.scenario.resolve(j[0], j[1]);
      buildControls(); recompute(["B", "C"]);
      window.wcDebug = { inputs: inputs, result: function () { return result; }, recompute: recompute, setTab: function (t) { tab = t; render(); }, version: APP_VERSION };
    })
    .catch(function (e) { $("warns").textContent = "Could not load the scenario: " + e.message; });
})();
