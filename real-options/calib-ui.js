// Real Options for Network Design — the calibration panel (window.ROCalibUI), shared by both pages. It reads a demand
// history (pasted, from a file, or a sample), estimates volatility and growth with src/calibrate.js, draws the history
// and the fitted fan, and hands the estimates to the page through the targets given to mount().
(function () {
  "use strict";
  var K = window.ROCalibrate, C = window.ROCharts, NS = C.NS;
  function mount(host, targets) {
    var el = C.el;
    host.innerHTML = "";
    var sum = el("summary", {}, host); sum.innerHTML = "<span>Calibrate from your demand history</span><span class='calib-sub'>estimate volatility and growth from data</span>";
    var body = el("div", { class: "calib-body" }, host);
    var left = el("div", { class: "calib-in" }, body), right = el("div", { class: "calib-out" }, body);
    el("p", { class: "blurb" }, left).textContent = "Paste one observation per line (date and value, or just values), load a CSV file, or try a sample. Everything stays in your browser.";
    var samples = el("div", { class: "presets" }, left);
    Object.keys(K.SAMPLES).forEach(function (name) {
      var b = el("button", { type: "button", "data-sample": name }, samples); b.textContent = name;
      b.addEventListener("click", function () { ta.value = K.sampleText(K.SAMPLES[name]); deseason.checked = !!K.SAMPLES[name].season; units.value = "units-period"; freq.value = "auto"; run(); });
    });
    var ta = el("textarea", { class: "calib-text", rows: 9, spellcheck: "false", "aria-label": "Demand history", placeholder: "date,demand\n2023-01,41200\n2023-02,39850\n…" }, left);
    var file = el("input", { type: "file", accept: ".csv,.txt,.tsv,text/csv,text/plain", "aria-label": "Load a CSV file" }, left);
    var opts = el("div", { class: "calib-opts" }, left);
    function sel(label, id, options) {
      var w = el("label", { class: "calib-opt" }, opts); w.appendChild(document.createTextNode(label));
      var s = el("select", { id: id }, w); options.forEach(function (o) { var op = el("option", { value: o[0] }, s); op.textContent = o[1]; }); return s;
    }
    var freq = sel("Observations", "calFreq", [["auto", "detect from dates"], ["52", "weekly"], ["12", "monthly"], ["4", "quarterly"], ["1", "yearly"]]);
    var units = sel("Each value is", "calUnits", [["units-period", "units in its period"], ["k-period", "thousand units in its period"], ["units-year", "an annual rate, in units"], ["k-year", "an annual rate, in thousand units"]]);
    var dw = el("label", { class: "calib-opt check" }, opts), deseason = el("input", { type: "checkbox", id: "calSeason" }, dw); dw.appendChild(document.createTextNode(" Remove the season"));
    var res = el("div", { class: "calib-res", "aria-live": "polite" }, right);
    var svg = el("svg", { class: "chart", viewBox: "0 0 420 220", role: "img", "aria-label": "Demand history and the fitted fan" }, right, NS);
    var lg = el("div", { class: "legend" }, right);
    var acts = el("div", { class: "calib-acts" }, right), note = el("p", { class: "caption" }, right);
    var last = null;
    targets.forEach(function (t) {
      var b = el("button", { type: "button", class: "btn-apply", disabled: "" }, acts); b.textContent = t.label;
      b.addEventListener("click", function () { if (!last) return; var notes = t.apply(last) || []; note.textContent = "Applied to " + t.name + "." + (notes.length ? " " + notes.join(" ") : ""); });
      t.button = b;
    });
    var timer = 0;
    ta.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(run, 250); });
    [freq, units, deseason].forEach(function (x) { x.addEventListener("change", run); });
    file.addEventListener("change", function () {
      var fl = file.files && file.files[0]; if (!fl) return;
      var rd = new FileReader(); rd.onload = function () { ta.value = String(rd.result || ""); run(); }; rd.readAsText(fl);
    });
    function run() {
      note.textContent = ""; last = null; C.clear(svg); lg.innerHTML = "";
      targets.forEach(function (t) { t.button.disabled = true; });
      var txt = ta.value.trim(); if (!txt) { res.innerHTML = "<p class='hint'>No data yet.</p>"; return; }
      var p = K.parse(txt), f = freq.value === "auto" ? K.detectFrequency(p.dates) : +freq.value;
      if (p.values.some(function (v) { return !(v > 0); })) { res.innerHTML = "<p class='warn'>Every value must be positive: demand on a lattice cannot be zero or negative.</p>"; return; }
      if (!f) { res.innerHTML = "<p class='warn'>The frequency cannot be detected without dates: choose it under Observations.</p>"; return; }
      var u = units.value, est;
      try { est = K.estimate(p.values, f, { deseason: deseason.checked, units: /year/.test(u) ? "year" : "period", scale: /^units/.test(u) ? 1000 : 1 }); }
      catch (e) { res.innerHTML = "<p class='warn'>" + e.message + "</p>"; return; }
      last = est;
      var pc = function (v) { return (v * 100).toFixed(1) + "%"; };
      var fname = { 52: "weekly", 12: "monthly", 4: "quarterly", 1: "yearly" }[f] || f + " a year";
      res.innerHTML = "<table class='data'><tr><th>Estimate</th><th>Value</th><th>90% interval</th></tr>" +
        "<tr><td>Demand today</td><td>" + est.D0.toFixed(0) + "k/yr</td><td>average of the last year</td></tr>" +
        "<tr><td>Expected growth</td><td>" + pc(est.g) + "/yr</td><td>" + pc(est.ciG[0]) + " to " + pc(est.ciG[1]) + "</td></tr>" +
        "<tr><td>Volatility</td><td>" + pc(est.sigma) + "</td><td>" + pc(est.ciSigma[0]) + " to " + pc(est.ciSigma[1]) + "</td></tr></table>" +
        "<p class='hint'>" + est.n + " " + fname + " observations, " + est.years.toFixed(1) + " years" + (est.seasonal ? ", season removed" : "") + ". Growth is the least certain estimate: it depends only on how many years the history spans.</p>" +
        (p.warnings.concat(est.warnings).length ? "<ul class='calib-warn'>" + p.warnings.concat(est.warnings).map(function (w) { return "<li>" + w + "</li>"; }).join("") + "</ul>" : "");
      targets.forEach(function (t) { t.button.disabled = false; });
      chart(p.values, est, f);
    }
    // history (per period, season removed if chosen) and the fitted median and 90% fan for five years
    function chart(vals, est, f) {
      var W = 420, H = 220, m = { l: 52, r: 10, t: 10, b: 30 }, n = vals.length, T = est.years, ahead = 5;
      var hist = est.logs.map(function (lv, k) { return [(k - (n - 1)) / f, Math.exp(lv)]; });
      var x0 = Math.exp(est.logs[n - 1]), fan = [];
      for (var k = 0; k <= 20; k++) { var t = ahead * k / 20, c = est.mu * t, s = est.sigma * Math.sqrt(t); fan.push([t, x0 * Math.exp(c), x0 * Math.exp(c - K.Z90 * s), x0 * Math.exp(c + K.Z90 * s)]); }
      var ys = hist.map(function (h) { return h[1]; }).concat(fan.map(function (q) { return q[3]; }), fan.map(function (q) { return q[2]; }));
      var x = C.scale(-T, ahead, m.l, W - m.r), y = C.scale(0, Math.max.apply(null, ys) * 1.05, H - m.b, m.t);
      C.axes(svg, x, y, W, H, m, null, null, "years (0 = today)", "demand per period");
      C.line(svg, x(0), m.t, x(0), H - m.b, { stroke: "var(--line)", "stroke-dasharray": "3 3" });
      C.el("path", { d: "M" + fan.map(function (q) { return x(q[0]).toFixed(1) + "," + y(q[3]).toFixed(1); }).join("L") + "L" + fan.slice().reverse().map(function (q) { return x(q[0]).toFixed(1) + "," + y(q[2]).toFixed(1); }).join("L") + "Z", fill: "rgba(191,228,255,.14)" }, svg, NS);
      C.path(svg, fan.map(function (q) { return [x(q[0]), y(q[1])]; }), { stroke: "var(--ink-dim)", "stroke-width": 1.5, fill: "none", "stroke-dasharray": "5 4" });
      C.path(svg, hist.map(function (h) { return [x(h[0]), y(h[1])]; }), { stroke: "var(--s1)", "stroke-width": 1.5, fill: "none" });
      C.legend(lg, [["line", "var(--s1)", est.seasonal ? "history, season removed" : "history"], ["dash", "var(--ink-dim)", "fitted median"], ["band", "rgba(191,228,255,.14)", "90% of outcomes"]]);
    }
    res.innerHTML = "<p class='hint'>No data yet.</p>";
    return { run: run, textarea: ta };
  }
  // snap an estimate to a slider: round to its step, keep inside its range, and say if it had to be limited
  function snap(spec, modelValue, label) {
    var shown = modelValue / (spec.scale || 1), r = Math.round(shown / spec.step) * spec.step, v = Math.min(spec.max, Math.max(spec.min, r));
    v = +v.toFixed(6);
    return { value: v, note: v !== +r.toFixed(6) ? label + " limited to " + spec.fmt(v) + " (estimate " + spec.fmt(+shown.toFixed(2)) + ")." : null };
  }
  window.ROCalibUI = { mount: mount, snap: snap };
})();
