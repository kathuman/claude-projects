// Lag Lab — the page: step and policy controls, the decomposition (the decision screen) and the plan in detail.
// Version history:
//   1.0.0  launch: the production/workforce model (phase 1), step and policy controls with presets and share
//          links, the decomposition of the overshoot into necessary refill, structure, policy and forecast from
//          runs (a), (b) and (c), charts with hover read-outs, the plan's metrics and CSV export
(function () {
  "use strict";
  var VERSION = "1.0.0";
  var L = window.LagLab, Dc = window.LagDecompose, $ = function (id) { return document.getElementById(id); };
  $("ver").textContent = "v" + VERSION; $("ver-foot").textContent = "v" + VERSION;

  var COLORS = { necessary: "#4f9f15", structural: "#1f9fd8", policy: "#c7820c", forecast: "#e0558f", run: "#e6f3ff", faint: "#6fa8c9", line: "#2a5580", s: ["#1f9fd8", "#c7820c", "#e0558f", "#4f9f15"] };

  // ---- controls: [path, label, min, max, step, unit, hint]
  var GROUPS = [
    ["Demand change", [
      ["demand.size", "Step size", -50, 100, 5, "%", "Change in customer orders, as a share of the old rate"],
      ["demand.at", "Step at week", 2, 40, 1, "wk"]]],
    ["Delays", [
      ["productionLeadTime", "Production lead time", 1, 20, 0.5, "wk", "From production start to finished goods"],
      ["hiringDelay", "Hiring delay", 1, 26, 0.5, "wk", "From opening a vacancy to filling it"],
      ["trainingTime", "Training ramp", 1, 52, 1, "wk", "Recruits work at half productivity until trained"]]],
    ["Replenishment policy", [
      ["TAI", "Inventory adjustment time (TAI)", 1, 20, 0.5, "wk", "How fast production closes the inventory gap"],
      ["TASL", "Supply-line adjustment time (TASL)", 1, 20, 0.5, "wk"],
      ["wSL", "Supply-line weight (w_SL)", 0, 1, 0.05, "", "1 = the work already in the pipeline counts fully"],
      ["forecastTime", "Forecast smoothing time", 1, 26, 0.5, "wk", "How fast expected demand follows actual demand"]]],
    ["Hiring policy", [
      ["TAW", "Workforce adjustment time (TAW)", 1, 26, 0.5, "wk"],
      ["wV", "Vacancy weight (w_V)", 0, 1, 0.05, "", "1 = open vacancies count fully"],
      ["hiringDriver", "Hire on the…", null, null, null, "", "Inventory gap: blind to the work already in the pipeline"]]]
  ];
  var PRESETS = {
    typical: { name: "Typical plant", p: {} },
    textbook: { name: "Textbook rules (w = 1, hire on capacity)", p: { wSL: 1, wV: 1, hiringDriver: "capacity" } },
    firefight: { name: "Fire-fighting (fast, pipeline ignored)", p: { TAI: 2, TASL: 2, wSL: 0, wV: 0, TAW: 3 } },
    slowfc: { name: "Good rules, slow forecast", p: { wSL: 1, wV: 1, hiringDriver: "capacity", forecastTime: 16 } },
    longhire: { name: "Long hiring pipeline", p: { hiringDelay: 16, trainingTime: 26 } }
  };

  var params = L.defaults();
  function getP(path) { var k = path.split("."); return k.length === 2 ? params[k[0]][k[1]] : params[k[0]]; }
  function setP(path, v) { var k = path.split("."); if (k.length === 2) params[k[0]][k[1]] = v; else params[k[0]] = v; }
  function shown(path, v) { return path === "demand.size" ? Math.round(v * 100) : v; }
  function stored(path, v) { return path === "demand.size" ? v / 100 : v; }
  function fmtVal(c, v) { return (c[5] === "%" && v > 0 ? "+" : "") + (Math.abs(v) < 10 && c[4] < 1 && c[5] !== "%" ? (+v).toFixed(2) : String(v)) + (c[5] ? " " + c[5] : ""); }

  // ---- build the rail
  var rail = $("rail"), inputs = {};
  rail.insertAdjacentHTML("beforeend", '<h2>Preset</h2><select class="sel" id="preset" aria-label="Preset">' +
    Object.keys(PRESETS).map(function (k) { return '<option value="' + k + '">' + PRESETS[k].name + "</option>"; }).join("") + '<option value="custom" hidden>Custom</option></select>');
  GROUPS.forEach(function (g) {
    rail.insertAdjacentHTML("beforeend", "<h2>" + g[0] + "</h2>");
    g[1].forEach(function (c) {
      var id = "in-" + c[0].replace(".", "-"), box = document.createElement("div"); box.className = "ctl";
      if (c[0] === "hiringDriver") {
        box.innerHTML = '<div class="row"><label>' + c[1] + '</label></div><div class="seg" role="group" aria-label="Hiring driver"><button type="button" data-v="capacity">Capacity gap</button><button type="button" data-v="inventory">Inventory gap</button></div><div class="hint">' + c[6] + "</div>";
        box.querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { setP("hiringDriver", b.dataset.v); custom(); paintRail(); schedule(); }); });
      } else {
        box.innerHTML = '<div class="row"><label for="' + id + '">' + c[1] + '</label><output id="' + id + '-out"></output></div><input type="range" id="' + id + '" min="' + c[2] + '" max="' + c[3] + '" step="' + c[4] + '" />' + (c[6] ? '<div class="hint">' + c[6] + "</div>" : "");
        var inp = box.querySelector("input");
        inp.addEventListener("input", function () { setP(c[0], stored(c[0], +inp.value)); custom(); paintRail(); schedule(); });
        inputs[c[0]] = { el: inp, c: c };
      }
      rail.appendChild(box);
    });
  });
  rail.insertAdjacentHTML("beforeend", '<h2>Run</h2><div class="ctl"><div class="row"><label for="in-horizon">Run length</label></div><select class="sel" id="in-horizon"><option value="104">2 years</option><option value="156">3 years</option><option value="260">5 years</option></select></div>' +
    '<div class="rail-actions"><button class="btn" id="btn-reset" type="button">Reset</button></div>');
  $("in-horizon").addEventListener("change", function () { params.horizon = +$("in-horizon").value; schedule(); });
  $("preset").addEventListener("change", function () { if ($("preset").value !== "custom") applyPreset($("preset").value); });
  $("btn-reset").addEventListener("click", function () { applyPreset("typical"); });
  function custom() { $("preset").value = "custom"; }
  function applyPreset(k) {
    var h = params.horizon; params = L.defaults(); params.horizon = h;
    var pr = PRESETS[k].p; Object.keys(pr).forEach(function (key) { params[key] = pr[key]; });
    $("preset").value = k; paintRail(); schedule();
  }
  function paintRail() {
    Object.keys(inputs).forEach(function (k) { var it = inputs[k], v = shown(k, getP(k)); it.el.value = v; $(it.el.id + "-out").textContent = fmtVal(it.c, v); });
    rail.querySelectorAll(".seg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === params.hiringDriver)); });
    $("in-horizon").value = String(params.horizon);
  }

  // ---- charts: lines with dash patterns for identity, shaded bands between two series, a step marker,
  // a recessive grid and a hover read-out
  function niceTicks(lo, hi, n) {
    var span = hi - lo || 1, step = Math.pow(10, Math.floor(Math.log10(span / n))), err = span / n / step;
    step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var out = []; for (var v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function Chart(host) {
    var self = this;
    this.host = host; this.cv = document.createElement("canvas"); this.tip = document.createElement("div"); this.tip.className = "tip"; this.tip.hidden = true;
    host.appendChild(this.cv); host.appendChild(this.tip); this.hx = null;
    this.cv.addEventListener("pointermove", function (e) { var r = self.cv.getBoundingClientRect(); self.hx = e.clientX - r.left; self.draw(); });
    this.cv.addEventListener("pointerleave", function () { self.hx = null; self.tip.hidden = true; self.draw(); });
  }
  Chart.prototype.set = function (d) { this.d = d; this.draw(); };
  Chart.prototype.draw = function () {
    var d = this.d; if (!d) return;
    var cv = this.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var cx = cv.getContext("2d"); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, W, H);
    var Lm = 46, Rm = 8, Tm = 8, Bm = 22, pw = W - Lm - Rm, ph = H - Tm - Bm, t = d.t, n = t.length;
    var lo = Infinity, hi = -Infinity;
    d.series.forEach(function (s) { s.ys.forEach(function (y) { if (isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y; } }); });
    (d.hlines || []).forEach(function (h) { lo = Math.min(lo, h.y); hi = Math.max(hi, h.y); });
    if (d.zero) { lo = Math.min(lo, 0); }
    var pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1; lo -= pad; hi += pad;
    var X = function (tt) { return Lm + pw * (tt - t[0]) / (t[n - 1] - t[0]); }, Y = function (v) { return Tm + ph * (hi - v) / (hi - lo); };
    cx.font = "10.5px IBM Plex Mono, monospace"; cx.fillStyle = COLORS.faint; cx.strokeStyle = COLORS.line; cx.lineWidth = 1;
    niceTicks(lo, hi, 4).forEach(function (v) { var y = Math.round(Y(v)) + 0.5; cx.globalAlpha = 0.6; cx.beginPath(); cx.moveTo(Lm, y); cx.lineTo(W - Rm, y); cx.stroke(); cx.globalAlpha = 1; cx.fillText(Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : String(+v.toFixed(2)), 2, y + 3); });
    var xs = niceTicks(t[0], t[n - 1], 6);
    xs.forEach(function (v, i) { var s = String(v) + (i === xs.length - 1 ? " wk" : ""), w = cx.measureText(s).width; cx.fillText(s, Math.min(W - Rm - w, X(v) - 6), H - 6); });
    if (d.marker != null) { var mx = Math.round(X(d.marker)) + 0.5; cx.setLineDash([3, 3]); cx.beginPath(); cx.moveTo(mx, Tm); cx.lineTo(mx, Tm + ph); cx.stroke(); cx.setLineDash([]); cx.fillText("step", mx + 4, Tm + 10); }
    (d.hlines || []).forEach(function (h) { var y = Math.round(Y(h.y)) + 0.5; cx.strokeStyle = h.color || COLORS.faint; cx.setLineDash(h.dash || [4, 4]); cx.beginPath(); cx.moveTo(Lm, y); cx.lineTo(W - Rm, y); cx.stroke(); cx.setLineDash([]); });
    cx.save(); cx.beginPath(); cx.rect(Lm, Tm, pw, ph); cx.clip();
    (d.bands || []).forEach(function (b) {
      var A = d.series[b.a].ys, B = d.series[b.b].ys;
      cx.fillStyle = b.color; cx.globalAlpha = 0.32; cx.beginPath();
      for (var i = 0; i < n; i++) { var x = X(t[i]); if (i) cx.lineTo(x, Y(A[i])); else cx.moveTo(x, Y(A[i])); }
      for (i = n - 1; i >= 0; i--) cx.lineTo(X(t[i]), Y(B[i]));
      cx.closePath(); cx.fill(); cx.globalAlpha = 1;
    });
    d.series.forEach(function (s) {
      cx.strokeStyle = s.color; cx.lineWidth = s.width || 2; cx.setLineDash(s.dash || []); cx.lineJoin = "round"; cx.beginPath();
      for (var i = 0; i < n; i++) { var x = X(t[i]), y = Y(s.ys[i]); if (i) cx.lineTo(x, y); else cx.moveTo(x, y); }
      cx.stroke(); cx.setLineDash([]);
    });
    cx.restore();
    if (this.hx != null && this.hx >= Lm && this.hx <= W - Rm) {
      var tt = t[0] + (this.hx - Lm) / pw * (t[n - 1] - t[0]), idx = 0, best = Infinity;
      for (var i = 0; i < n; i++) { var dd = Math.abs(t[i] - tt); if (dd < best) { best = dd; idx = i; } }
      var bx = Math.round(X(t[idx])) + 0.5; cx.strokeStyle = COLORS.faint; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(bx, Tm); cx.lineTo(bx, Tm + ph); cx.stroke();
      d.series.forEach(function (s) { cx.fillStyle = s.color; cx.beginPath(); cx.arc(bx, Y(s.ys[idx]), 3.5, 0, 7); cx.fill(); });
      var dig = d.digits != null ? d.digits : 1;
      this.tip.innerHTML = '<span class="k">week ' + t[idx] + "</span><br>" + d.series.map(function (s) { return lineSample(s) + " " + esc(s.name) + " " + s.ys[idx].toFixed(dig); }).join("<br>");
      this.tip.hidden = false;
      var tw = this.tip.offsetWidth; this.tip.style.left = Math.max(0, Math.min(W - tw - 2, bx + 12)) + "px"; this.tip.style.top = "4px";
    }
  };
  function lineSample(s) {
    var dash = s.dash && s.dash.length ? ' stroke-dasharray="' + s.dash.join(",") + '"' : "";
    return '<svg width="22" height="8" style="vertical-align:middle"><line x1="1" y1="4" x2="21" y2="4" stroke="' + s.color + '" stroke-width="' + (s.width || 2) + '"' + dash + "/></svg>";
  }
  function bandSample(color) { return '<svg width="14" height="10" style="vertical-align:middle"><rect width="14" height="10" rx="2" fill="' + color + '" opacity=".55"/></svg>'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function makeChart(hostId, key, title, what) {
    var box = document.createElement("div"); box.className = "chart"; box.id = "chart-" + key;
    box.innerHTML = "<h3>" + title + '</h3><p class="what">' + what + '</p><div class="legend"></div><div class="plot"></div>';
    $(hostId).appendChild(box);
    var ch = new Chart(box.querySelector(".plot")); ch.legend = box.querySelector(".legend"); return ch;
  }
  var RUN_STYLE = { a: { name: "(a) your plan", dash: [] }, b: { name: "(b) perfect forecast", dash: [7, 4] }, c: { name: "(c) full accounting", dash: [2, 3] } };
  var decCharts = {
    starts: makeChart("dec-charts", "starts", "Production starts", "Above the demand line is overproduction. Shading shows where it comes from: refill and structure (green), policy (amber), forecast (magenta)."),
    inventory: makeChart("dec-charts", "inventory", "Finished inventory", "The gap between the runs: policy (b → c) and forecast (a → b)."),
    backlog: makeChart("dec-charts", "backlog", "Backlog", "Orders waiting to ship."),
    workforce: makeChart("dec-charts", "workforce", "Effective workforce", "Experienced workers plus trainees at half productivity.")
  };
  var runCharts = {
    demand: makeChart("run-charts", "r-demand", "Demand and expected demand", "The forecast's lag behind the step."),
    flows: makeChart("run-charts", "r-flows", "Starts, completions, shipments", "Production starts lead; completions follow after the production lead time."),
    inventory: makeChart("run-charts", "r-inv", "Inventory and its target", "The target moves with expected demand."),
    supply: makeChart("run-charts", "r-sl", "Supply line and its target", "Work in the production pipeline."),
    backlog: makeChart("run-charts", "r-backlog", "Backlog", "Orders waiting to ship."),
    people: makeChart("run-charts", "r-people", "Workforce, trainees, vacancies", "People arrive through vacancies and training."),
    util: makeChart("run-charts", "r-util", "Utilisation", "Working time against normal: the band is 0.8 to 1.2.")
  };

  // ---- results
  var last = null, pending = false;
  function schedule() { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; recompute(); }); }
  function pct(x) { return (Math.abs(x) < 0.005 ? 0 : Math.round(x * 100)) + "%"; }
  function units(x) { return Math.round(x).toLocaleString(); }

  function recompute() {
    var errs = L.validate(L.merge(params));
    if (errs.length) { $("headline").textContent = "These settings can't be simulated"; $("subline").textContent = errs.join("; "); return; }
    var d = Dc.decompose(params); last = d;
    renderAnswer(d); renderDecCharts(d); renderRun(d);
    writeHash();
  }

  function renderAnswer(d) {
    var ly = d.layers, total = d.total, notes = [];
    if (d.direction === 0 || total < 1e-9) {
      $("headline").textContent = "No demand change: nothing to decompose.";
      $("subline").textContent = "Set a step size to see how the overshoot splits."; $("sharebar").innerHTML = ""; $("layers").innerHTML = ""; $("notes").innerHTML = ""; return;
    }
    var word = d.direction > 0 ? "above" : "below", stepWord = d.direction > 0 ? "rise" : "fall";
    var needStruct = ly.necessary + ly.structural;
    if (ly.forecast >= 0) {
      $("headline").innerHTML = 'Only <span class="big">' + pct(d.shares.forecast) + "</span> of the overshoot is a forecasting problem.";
    } else {
      $("headline").innerHTML = 'None of the overshoot is a forecasting problem: the forecast\'s lag <span class="big">reduced it by ' + units(-ly.forecast) + " units</span>.";
    }
    $("subline").textContent = "After the demand " + stepWord + ", your plan produced " + units(total) + " units " + word + " demand. Planning would book all of it as forecast error. " +
      pct(needStruct / total) + " was the necessary refill and structure, and " + pct(ly.policy / total) + " came from the decision rules.";
    var pos = Dc.LAYERS.filter(function (l) { return ly[l.id] > Math.max(1e-6, 1e-3 * total); }), spos = pos.reduce(function (a, l) { return a + ly[l.id]; }, 0);
    $("sharebar").innerHTML = pos.map(function (l) {
      var w = ly[l.id] / spos, label = w > 0.09 ? l.name + " " + pct(ly[l.id] / total) : w > 0.04 ? pct(ly[l.id] / total) : "";
      return '<div style="width:' + (w * 100).toFixed(3) + "%;background:" + COLORS[l.id] + '" title="' + esc(l.name + ": " + units(ly[l.id]) + " units, " + pct(ly[l.id] / total)) + '">' + esc(label) + "</div>";
    }).join("");
    $("sharebar").setAttribute("aria-label", Dc.LAYERS.map(function (l) { return l.name + " " + pct(ly[l.id] / total); }).join(", "));
    $("layers").innerHTML = Dc.LAYERS.map(function (l) {
      // rounding-level residues are zero, not "negative"
      var v = Math.abs(ly[l.id]) < Math.max(1e-6, 1e-3 * total) ? 0 : ly[l.id], neg = v < 0;
      return '<div class="layer" style="border-color:' + COLORS[l.id] + '"><b>' + l.name + '</b><div class="num">' + (neg ? "−" : "") + units(Math.abs(v)) + " units · " + (neg ? "−" : "") + pct(Math.abs(v) / total) + (neg ? " (reduced the overshoot)" : "") + "</div><p>" + l.remedy + "</p></div>";
    }).join("");
    if (!d.allSettled) {
      var still = ["a", "b", "c"].filter(function (k) { return !d.settled[k]; }).map(function (k) { return "(" + k + ")"; }).join(", ");
      notes.push('<div class="note">Run ' + still + " is still moving at the end of the run, so these numbers cover only what happened in it. Lengthen the run, or calm the policy.</div>");
    }
    if (Math.abs(ly.policy) < 1e-9 && params.wSL === 1 && params.wV === 1 && params.hiringDriver === "capacity") notes.push('<div class="note info">Your policy already is full accounting, so there is no policy layer: run (b) and run (c) are the same.</div>');
    if (params.forecast === "perfect") notes.push('<div class="note info">Your plan forecasts perfectly, so there is no forecast layer.</div>');
    $("notes").innerHTML = notes.join("");
  }

  function runSeries(d, key, extra) {
    return ["c", "b", "a"].map(function (k) { return { name: RUN_STYLE[k].name, ys: d.runs[k][key], color: COLORS.run, dash: RUN_STYLE[k].dash, width: k === "a" ? 2.2 : 1.6 }; }).concat(extra || []);
  }
  function legend(ch, items) { ch.legend.innerHTML = items.join(""); }
  var BAND_NAME = { necessary: "refill and structure", policy: "policy", forecast: "forecast" };
  function runLegend(bands) {
    return ["a", "b", "c"].map(function (k) { return "<span>" + lineSample({ color: COLORS.run, dash: RUN_STYLE[k].dash, width: k === "a" ? 2.2 : 1.6 }) + RUN_STYLE[k].name + "</span>"; })
      .concat(bands.map(function (b) { return "<span>" + bandSample(COLORS[b]) + BAND_NAME[b] + "</span>"; }));
  }
  function renderDecCharts(d) {
    var t = d.runs.a.t, step = d.params.demand.at;
    var dem = { name: "demand", ys: d.runs.a.demand, color: COLORS.faint, dash: [1, 0], width: 1.2 };
    var s = runSeries(d, "starts"); s.unshift(dem);  // 0 demand, 1 c, 2 b, 3 a
    decCharts.starts.set({ t: t, series: s, bands: [{ a: 0, b: 1, color: COLORS.necessary }, { a: 1, b: 2, color: COLORS.policy }, { a: 2, b: 3, color: COLORS.forecast }], marker: step, digits: 1 });
    legend(decCharts.starts, runLegend(["necessary", "policy", "forecast"]).concat(["<span>" + lineSample(dem) + "demand</span>"]));
    ["inventory", "backlog"].forEach(function (k) {
      decCharts[k].set({ t: t, series: runSeries(d, k), bands: [{ a: 0, b: 1, color: COLORS.policy }, { a: 1, b: 2, color: COLORS.forecast }], marker: step, digits: 1 });
      legend(decCharts[k], runLegend(["policy", "forecast"]));
    });
    decCharts.workforce.set({ t: t, series: runSeries(d, "effectiveWorkforce"), bands: [{ a: 0, b: 1, color: COLORS.policy }, { a: 1, b: 2, color: COLORS.forecast }], marker: step, digits: 1 });
    legend(decCharts.workforce, runLegend(["policy", "forecast"]));
  }

  function renderRun(d) {
    var r = d.runs.a, t = r.t, step = d.params.demand.at, S = COLORS.s;
    var line = function (name, ys, i, dash) { return { name: name, ys: ys, color: i == null ? COLORS.faint : S[i], dash: dash || [], width: dash ? 1.4 : 2 }; };
    var simple = function (ch, series, extra) { ch.set(Object.assign({ t: t, series: series, marker: step, digits: 1 }, extra || {})); legend(ch, series.map(function (s) { return "<span>" + lineSample(s) + esc(s.name) + "</span>"; })); };
    simple(runCharts.demand, [line("demand", r.demand, 0), line("expected demand", r.expectedDemand, 1)]);
    simple(runCharts.flows, [line("demand", r.demand, null, [4, 3]), line("starts", r.starts, 0), line("completions", r.completions, 1), line("shipments", r.shipments, 2)]);
    simple(runCharts.inventory, [line("inventory", r.inventory, 0), line("target", r.desiredInventory, null, [5, 4])]);
    simple(runCharts.supply, [line("supply line", r.supplyLine, 0), line("target", r.desiredSupplyLine, null, [5, 4])]);
    simple(runCharts.backlog, [line("backlog", r.backlog, 0)]);
    simple(runCharts.people, [line("effective", r.effectiveWorkforce, 0), line("experienced", r.workforce, 1), line("trainees", r.trainees, 2), line("vacancies", r.vacancies, 3)], { zero: true });
    simple(runCharts.util, [line("utilisation", r.utilisation, 0)], { digits: 3, hlines: [{ y: d.params.uMin }, { y: d.params.uMax }, { y: 1, dash: [1, 3] }] });
    // the plan's response, stock by stock
    var rows = [["Production starts", "starts"], ["Inventory", "inventory"], ["Backlog", "backlog"], ["Effective workforce", "effectiveWorkforce"], ["Expected demand", "expectedDemand"]];
    $("metrics").innerHTML = "<thead><tr><th>Your plan (a)</th><th>Before</th><th>After</th><th>Peak</th><th>Overshoot</th><th>Settles in</th><th>Oscillates</th></tr></thead><tbody>" +
      rows.map(function (rw) {
        var a = L.analyze(r[rw[1]], t, step);
        return "<tr><td>" + rw[0] + "</td><td>" + a.start.toFixed(1) + "</td><td>" + a.final.toFixed(1) + "</td><td>" + a.peak.toFixed(1) + "</td><td>" + pct(a.overshoot) + "</td><td>" + a.settlingTime.toFixed(0) + " wk</td><td>" + (a.crossings >= 2 ? "yes" : "no") + "</td></tr>";
      }).join("") + "</tbody>";
  }

  // ---- tabs, CSV, share links
  function tab(which) {
    $("tab-dec").setAttribute("aria-selected", String(which === "dec")); $("tab-run").setAttribute("aria-selected", String(which === "run"));
    $("view-dec").hidden = which !== "dec"; $("view-run").hidden = which !== "run";
    requestAnimationFrame(function () { Object.keys(decCharts).forEach(function (k) { decCharts[k].draw(); }); Object.keys(runCharts).forEach(function (k) { runCharts[k].draw(); }); });
  }
  $("tab-dec").addEventListener("click", function () { tab("dec"); });
  $("tab-run").addEventListener("click", function () { tab("run"); });
  $("btn-csv").addEventListener("click", function () {
    if (!last) return;
    var cols = ["demand", "expectedDemand", "starts", "completions", "shipments", "inventory", "backlog", "supplyLine", "effectiveWorkforce", "trainees", "vacancies"];
    var head = ["week"]; ["a", "b", "c"].forEach(function (k) { cols.forEach(function (c) { head.push(k + "_" + c); }); });
    var lines = [head.join(",")];
    last.runs.a.t.forEach(function (tt, i) { var row = [tt]; ["a", "b", "c"].forEach(function (k) { cols.forEach(function (c) { row.push(+last.runs[k][c][i].toFixed(6)); }); }); lines.push(row.join(",")); });
    var a = document.createElement("a"), url = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
    a.href = url; a.download = "lag-lab-runs.csv"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  });
  // the settings that differ from the defaults go in the address, so a link reproduces the run
  var KEYS = ["productionLeadTime", "hiringDelay", "trainingTime", "TAI", "TASL", "wSL", "forecastTime", "TAW", "wV", "hiringDriver", "horizon"];
  function writeHash() {
    var def = L.defaults(), o = {};
    KEYS.forEach(function (k) { if (params[k] !== def[k]) o[k] = params[k]; });
    if (params.demand.size !== def.demand.size) o.size = params.demand.size;
    if (params.demand.at !== def.demand.at) o.at = params.demand.at;
    var h = Object.keys(o).map(function (k) { return k + "=" + encodeURIComponent(o[k]); }).join("&");
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }
  function readHash() {
    var h = location.hash.replace(/^#/, ""); if (!h) return;
    var all = {}; GROUPS.forEach(function (g) { g[1].forEach(function (c) { all[c[0]] = c; }); });
    h.split("&").forEach(function (kv) {
      var p = kv.split("="), k = p[0], v = decodeURIComponent(p[1] || "");
      if (k === "hiringDriver" && (v === "capacity" || v === "inventory")) params.hiringDriver = v;
      else if (k === "horizon" && ["104", "156", "260"].indexOf(v) >= 0) params.horizon = +v;
      else {
        var path = k === "size" ? "demand.size" : k === "at" ? "demand.at" : k, c = all[path], num = +v;
        if (c && isFinite(num)) { var sv = shown(path, num); if (sv >= c[2] && sv <= c[3]) setP(path, num); }
      }
    });
    custom();
  }
  $("btn-share").addEventListener("click", function () {
    var done = function () { $("btn-share").textContent = "Link copied"; setTimeout(function () { $("btn-share").textContent = "Share"; }, 1600); };
    var manual = function () { $("btn-share").textContent = "Copy the address bar"; setTimeout(function () { $("btn-share").textContent = "Share"; }, 2400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(done, manual);
    else manual();
  });
  window.addEventListener("resize", function () { Object.keys(decCharts).forEach(function (k) { decCharts[k].draw(); }); Object.keys(runCharts).forEach(function (k) { runCharts[k].draw(); }); });

  readHash(); paintRail(); recompute();
  window.lagLab = { version: VERSION, params: function () { return params; }, last: function () { return last; }, applyPreset: applyPreset };
})();
