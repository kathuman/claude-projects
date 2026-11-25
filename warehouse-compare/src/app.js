/*
 * app.js — the page: controls built from data/scenario.json, the plan view,
 * the results table (one column per warehouse) and the derivation trace.
 */
(function () {
  "use strict";
  const APP_VERSION = "0.1.0";
  const CONTROLS = ["target_locations", "skus", "demand_skew", "lines_per_order", "slotting", "lines_per_day", "picker_speed", "pick_time_per_line"];
  const $ = function (id) { return document.getElementById(id); };
  let scJson, inputs, result, view = { color: "cost", network: false, route: null }, orderSeed = 1;

  function fmt(v, d) { return Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }

  function buildControls() {
    const box = $("controls"), defs = scJson.shared;
    CONTROLS.forEach(function (k) {
      const d = defs[k], f = document.createElement("div");
      f.className = "field";
      if (d.type === "choice") {
        f.innerHTML = "<label for='c_" + k + "'>" + label(k) + "</label><select id='c_" + k + "'>" +
          d.options.map(function (o) { return "<option value='" + o + "'" + (o === inputs.sc[k] ? " selected" : "") + ">" + d.labels[o] + "</option>"; }).join("") + "</select>";
      } else {
        const step = d.maximum - d.minimum > 1000 ? 100 : d.unit === "m/s" ? 0.1 : 1;
        const max = k === "target_locations" ? 30000 : k === "skus" ? 25000 : k === "lines_per_day" ? 60000 : d.maximum;
        f.innerHTML = "<label for='c_" + k + "'>" + label(k) + " <output id='o_" + k + "'></output></label>" +
          "<input type='range' id='c_" + k + "' min='" + d.minimum + "' max='" + max + "' step='" + step + "' value='" + inputs.sc[k] + "'>";
      }
      f.innerHTML += "<div class='help'>" + d.description + "</div>";
      box.appendChild(f);
      const el = f.querySelector("#c_" + k);
      el.addEventListener("input", function () {
        inputs.sc[k] = d.type === "choice" ? el.value : Number(el.value);
        showValue(k); schedule();
      });
      showValue(k);
    });
  }
  function label(k) { return k.replace(/_/g, " ").replace(/^./, function (c) { return c.toUpperCase(); }); }
  function showValue(k) {
    const o = $("o_" + k); if (!o) return;
    const d = scJson.shared[k];
    o.textContent = fmt(inputs.sc[k], d.unit === "m/s" ? 1 : 0) + (d.unit ? " " + d.unit : "");
  }

  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(recompute, 120); }

  function recompute() {
    // SKUs can't exceed the locations every layout is sized to
    if (inputs.sc.skus > inputs.sc.target_locations) {
      inputs.sc.target_locations = inputs.sc.skus;
      const el = $("c_target_locations"); if (el) el.value = inputs.sc.skus; showValue("target_locations");
    }
    result = WC.scenario.run(inputs);
    view.route = null; $("route").textContent = "";
    render();
  }

  function render() {
    const r = result.C;
    $("warns").innerHTML = (r.warnings || []).map(function (w) { return "<div>⚠ " + w.text + "</div>"; }).join("");
    if (r.infeasible) return;
    WC.plan.draw($("plan"), r, { sc: inputs.sc, color: view.color, network: view.network, route: view.route });
    $("legend").innerHTML = (view.color === "cost"
      ? "<span><i class='grad'></i>travel time from the nearest picking point: near → far</span>"
      : "<span>SKU class stored there (averaged over the shelf levels): </span><span><i style='background:" + WC.plan.heat(0) + "'></i>A — most popular 20%</span>" +
        "<span><i style='background:" + WC.plan.heat(0.5) + "'></i>B — next 30%</span><span><i style='background:" + WC.plan.heat(1) + "'></i>C — the rest</span><span><i style='background:#1d4470'></i>empty</span>") +
      "<span><i style='background:#7be0c4'></i>picking point</span>";

    const rows = WC.kpi.KPI_DEFS.map(function (d) {
      return "<tr><td>" + d.label + "</td><td class='unit'>" + d.unit + "</td><td class='na'>—</td><td class='na'>—</td><td>" + fmt(r.kpi[d.key], d.d) + "</td></tr>";
    }).join("");
    $("kpi").innerHTML = "<tr><th>Measure</th><th></th><th>WH-A</th><th>WH-B</th><th>WH-C</th></tr>" + rows +
      "<tr><td colspan='5' class='na' style='text-align:left'>WH-B arrives in phase 2 and WH-A in phase 3, measured through the same table.</td></tr>";
    $("trace").innerHTML = r.trace.map(function (t) {
      return "<li><div class='l'>" + t.label + "</div><div class='e'>" + t.expr + "</div><div class='v'>" + t.value + "</div></li>";
    }).join("");
  }

  function showOrder() {
    const r = result.C, sc = Object.assign({}, inputs.sc);
    const st = WC.demand.orderStream(sc, 777 + orderSeed++);
    let ord = st.next();
    for (let t = 0; t < 20 && ord.length < 3; t++) ord = st.next();       // show a multi-line one
    const keys = ord.map(function (s) { return r.layout.locations.key[r.skuLoc[s]]; });
    view.route = WC.routing.route(r.layout.M, r.layout.depots, keys);
    $("route").textContent = ord.length + " lines · " + view.route.stops + " stops · " + fmt(view.route.dist, 1) + " m walk";
    render();
  }

  function toggle(id, on) { $(id).classList.toggle("on", on); }
  $("colCost").onclick = function () { view.color = "cost"; toggle("colCost", true); toggle("colPop", false); render(); };
  $("colPop").onclick = function () { view.color = "pop"; toggle("colCost", false); toggle("colPop", true); render(); };
  $("net").onclick = function () { view.network = !view.network; toggle("net", view.network); render(); };
  $("order").onclick = showOrder;
  window.addEventListener("resize", function () { if (result) render(); });

  $("ver").textContent = "v" + APP_VERSION;
  Promise.all([fetch("data/scenario.json").then(function (r) { return r.json(); }), fetch("../warehouse-model/data/parameters.json").then(function (r) { return r.json(); })])
    .then(function (j) {
      scJson = j[0]; inputs = WC.scenario.resolve(j[0], j[1]);
      buildControls(); recompute();
      window.wcDebug = { inputs: inputs, result: function () { return result; }, recompute: recompute, version: APP_VERSION };
    })
    .catch(function (e) { $("warns").textContent = "Could not load the scenario: " + e.message; });
})();
