// Real Options for Network Design — the page. All valuation is done by src/model.js (window.RealOptions).
(function () {
  "use strict";
  var M = window.RealOptions;
  var $ = function (id) { return document.getElementById(id); };
  var NS = "http://www.w3.org/2000/svg", C = window.ROCharts;
  var el = C.el, clear = C.clear, scale = C.scale, line = C.line, rect = C.rect, text = C.text, path = C.path, area = C.area, axes = C.axes,
    legend = C.legend, hover = C.hover, segments = C.segments, nearest = C.nearest, quant = C.quant;
  $("ver").textContent = "v" + M.VERSION; $("ver-foot").textContent = "v" + M.VERSION;

  // ---- controls: shown in friendly units, stored in model units (model = shown × scale)
  var GROUPS = [
    { name: "Demand", items: [
      { id: "D0", label: "Demand today", min: 100, max: 2000, step: 50, def: 500, fmt: function (v) { return v + "k units/yr"; } },
      { id: "sigma", label: "Volatility", min: 5, max: 60, step: 1, def: 25, scale: 0.01, fmt: pct, hint: "Yearly standard deviation of demand growth." },
      { id: "g", label: "Expected growth", min: -10, max: 12, step: 0.5, def: 4, scale: 0.01, fmt: pctS },
      { id: "ceiling", label: "Market ceiling", min: 1.5, max: 6, step: 0.5, def: 3, fmt: function (v) { return v + "× today"; }, hint: "Demand saturates here." } ] },
    { name: "Time", items: [
      { id: "life", label: "Asset life", min: 10, max: 30, step: 1, def: 20, fmt: yrs },
      { id: "window", label: "Decision window", min: 1, max: 15, step: 1, def: 8, fmt: yrs, hint: "How long you can still build or expand. After it the network stays as it is." },
      { id: "buildLead", label: "Build lead time", min: 0, max: 3, step: 0.25, def: 1.5, fmt: yrs },
      { id: "expandLead", label: "Expansion lead time", min: 0, max: 2, step: 0.25, def: 1, fmt: yrs } ] },
    { name: "Economics", items: [
      { id: "margin", label: "Margin, own network", min: 5, max: 40, step: 1, def: 20, scale: 0.001, fmt: perUnit },
      { id: "opcost", label: "Holding cost of capacity", min: 1, max: 15, step: 0.5, def: 6, scale: 0.001, fmt: function (v) { return "$" + v + "/unit·yr"; } },
      { id: "outMargin", label: "Margin, outsourced (3PL)", min: 0, max: 20, step: 0.5, def: 6, scale: 0.001, fmt: perUnit },
      { id: "outCap", label: "Outsourcing limit", min: 0, max: 200, step: 10, def: 100, scale: 0.01, fmt: function (v) { return v + "% of today"; } },
      { id: "penalty", label: "Penalty, lost sale", min: 0, max: 40, step: 1, def: 10, scale: 0.001, fmt: perUnit } ] },
    { name: "Valuation", basis: true, items: [
      { id: "wacc", label: "WACC", min: 4, max: 16, step: 0.5, def: 10, scale: 0.01, fmt: pct, only: "wacc" },
      { id: "rf", label: "Risk-free rate", min: 0, max: 8, step: 0.25, def: 3, scale: 0.01, fmt: pct, only: "rn" },
      { id: "lambda", label: "Market price of demand risk λ", min: 0, max: 1, step: 0.05, def: 0.3, fmt: function (v) { return v.toFixed(2); }, only: "rn", hint: "Risk-neutral drift = growth − λ·volatility." } ] },
    { name: "Design & costs", items: [
      { id: "bigF", label: "Full footprint", min: 60, max: 300, step: 5, def: 140, scale: 0.01, fmt: ofToday },
      { id: "smallF", label: "Initial stage", min: 30, max: 150, step: 5, def: 80, scale: 0.01, fmt: ofToday },
      { id: "stepF", label: "Expansion step", min: 5, max: 60, step: 5, def: 15, scale: 0.01, fmt: ofToday },
      { id: "premium", label: "Staging premium", min: 0, max: 60, step: 5, def: 25, scale: 0.01, fmt: pct, hint: "Extra cost per unit added in a later step." },
      { id: "fFix", label: "Fixed cost of a site", min: 0, max: 30, step: 1, def: 8, fmt: function (v) { return "$" + v + "M"; } },
      { id: "fVar", label: "Capex per unit of capacity", min: 10, max: 60, step: 1, def: 30, scale: 0.001, fmt: perUnit },
      { id: "escal", label: "Cost escalation if delayed", min: 0, max: 15, step: 1, def: 6, scale: 0.01, fmt: function (v) { return v + "%/yr"; } } ] },
    { name: "Exit & leasing", items: [
      { id: "salvF", label: "Resale value of a site", min: 0, max: 80, step: 5, def: 30, scale: 0.01, fmt: function (v) { return v + "% of cost"; }, hint: "What an owned site sells for when new; it declines to zero over the asset life. Generic buildings resell well, specialised ones do not." },
      { id: "rent", label: "Lease rent", min: 2, max: 12, step: 0.25, def: 6.5, scale: 0.001, fmt: function (v) { return "$" + v + "/unit·yr"; } },
      { id: "leaseFit", label: "Fit-out cost of a lease", min: 0, max: 100, step: 5, def: 25, scale: 0.01, fmt: function (v) { return v + "% of site fixed cost"; } },
      { id: "leaseLead", label: "Fit-out time", min: 0, max: 2, step: 0.25, def: 0.5, fmt: yrs },
      { id: "minTerm", label: "First break date", min: 1, max: 15, step: 1, def: 5, fmt: function (v) { return "year " + v + " of the lease"; } },
      { id: "breakEvery", label: "Then a break every", min: 0, max: 10, step: 1, def: 5, fmt: function (v) { return v === 0 ? "no further breaks" : yrs(v); } },
      { id: "breakFee", label: "Break fee", min: 0, max: 3, step: 0.25, def: 1, fmt: function (v) { return v + (v === 1 ? " year" : " years") + " of rent"; } } ] },
    { name: "Switching", items: [
      { id: "moth", label: "Owned sites can be mothballed", check: true, def: 1, hint: "Idle the site and send demand to the 3PL, then restart it if demand returns." },
      { id: "mothF", needs: "moth", label: "Holding cost while idle", min: 0, max: 80, step: 5, def: 20, scale: 0.01, fmt: function (v) { return v + "% of active"; } },
      { id: "mothFix", needs: "moth", label: "Cost to mothball", min: 0, max: 5, step: 0.25, def: 0.5, fmt: function (v) { return "$" + v + "M"; } },
      { id: "reactFix", needs: "moth", label: "Cost to restart", min: 0, max: 5, step: 0.25, def: 1, fmt: function (v) { return "$" + v + "M"; } },
      { id: "contract", label: "Staged site can sell capacity back in steps", check: true, def: 1, hint: "Proceeds: the resale value of the capacity sold, without the site's fixed share." } ] }
  ];
  function pct(v) { return v + "%"; }
  function pctS(v) { return (v > 0 ? "+" : "") + v + "%/yr"; }
  function yrs(v) { return v + (v === 1 ? " year" : " years"); }
  function perUnit(v) { return "$" + v + "/unit"; }
  function ofToday(v) { return v + "% of today"; }

  var SPECS = {}; GROUPS.forEach(function (g) { g.items.forEach(function (s) { SPECS[s.id] = s; }); });
  var PRESETS = {
    "Mature & stable": { sigma: 12, g: 1, penalty: 8, premium: 25, bigF: 125 },
    "High-growth, uncertain": { sigma: 35, g: 9, smallF: 90, bigF: 260, stepF: 30, penalty: 12 },
    "Volatile & flat": { sigma: 45, g: 0, premium: 20, penalty: 12 },
    "Structural decline": { sigma: 20, g: -6, smallF: 60, bigF: 110, penalty: 6 },
    "Capacity-crunch risk": { sigma: 30, g: 6, penalty: 26, margin: 28, premium: 30, smallF: 75 },
    "Specialised site": { sigma: 35, g: 0, salvF: 0, opcost: 10, mothF: 10 }
  };
  var state = { basis: "wacc" }, preset = null;
  Object.keys(SPECS).forEach(function (k) { state[k] = SPECS[k].def; });

  var NAMES = { full: "Commit now", best: "Best fixed", defer: "Wait & see", stage: "Stage & expand", lease: "Lease & break" };
  var COL = { full: "var(--s4)", best: "var(--s1)", defer: "var(--s2)", stage: "var(--s3)", lease: "var(--s5)" };
  var FLEX = ["defer", "stage", "lease"];

  // ---- build the controls
  var host = $("ctlHost"), inputs = {}, outs = {}, rows = {};
  GROUPS.forEach(function (g) {
    var box = el("div", { class: "cgrp" }, host); el("h3", {}, box).textContent = g.name;
    if (g.basis) {
      var seg = el("div", { class: "seg", role: "group", "aria-label": "Valuation basis" }, box);
      [["wacc", "Expected cash flows @ WACC"], ["rn", "Risk-neutral"]].forEach(function (b) {
        var bt = el("button", { type: "button", "data-basis": b[0] }, seg); bt.textContent = b[1];
        bt.addEventListener("click", function () { state.basis = b[0]; preset = null; sync(); update(); });
      });
    }
    g.items.forEach(function (s) {
      var w = el("div", { class: "ctl" }, box); rows[s.id] = w;
      var r = el("div", { class: "row" }, w);
      var lab = el("label", { for: "c_" + s.id }, r); lab.textContent = s.label;
      outs[s.id] = el("output", { for: "c_" + s.id }, r);
      var inp = s.check ? el("input", { type: "checkbox", id: "c_" + s.id }, r) : el("input", { type: "range", id: "c_" + s.id, min: s.min, max: s.max, step: s.step }, w);
      if (s.check) { r.classList.add("check"); r.insertBefore(inp, lab); }
      inputs[s.id] = inp;
      if (s.hint) el("div", { class: "hint" }, w).textContent = s.hint;
      inp.addEventListener(s.check ? "change" : "input", function () { state[s.id] = s.check ? (inp.checked ? 1 : 0) : parseFloat(inp.value); preset = null; sync(); update(); });
    });
  });
  var ph = $("presets");
  Object.keys(PRESETS).forEach(function (name) {
    var b = el("button", { type: "button", "data-preset": name }, ph); b.textContent = name;
    b.addEventListener("click", function () { applyPreset(name); });
  });
  var rb = el("button", { type: "button" }, ph); rb.textContent = "Reset";
  rb.addEventListener("click", function () { applyPreset(null); });
  function applyPreset(name) {
    var o = name ? PRESETS[name] : {};
    Object.keys(SPECS).forEach(function (k) { state[k] = o[k] != null ? o[k] : SPECS[k].def; });
    state.basis = "wacc"; preset = name; sync(); update();
  }
  function sync() {
    if (state.window > state.life) state.window = state.life;
    Object.keys(SPECS).forEach(function (k) {
      var s = SPECS[k];
      if (s.check) { inputs[k].checked = !!state[k]; outs[k].textContent = ""; } else { inputs[k].value = state[k]; outs[k].textContent = s.fmt(state[k]); }
      rows[k].hidden = (!!s.only && s.only !== state.basis) || (!!s.needs && !state[s.needs]);
    });
    document.querySelectorAll("[data-basis]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-basis") === state.basis); });
    document.querySelectorAll("[data-preset]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-preset") === preset); });
    writeHash();
  }
  function params(over) {
    var p = { basis: state.basis };
    Object.keys(SPECS).forEach(function (k) { p[k] = state[k] * (SPECS[k].scale || 1); });
    if (over) Object.keys(over).forEach(function (k) { p[k] = over[k]; });
    return p;
  }

  // the scenario lives in the address, so a link reproduces it
  function writeHash() {
    var parts = [];
    Object.keys(SPECS).forEach(function (k) { if (state[k] !== SPECS[k].def) parts.push(k + "=" + state[k]); });
    if (state.basis !== "wacc") parts.push("basis=" + state.basis);
    if (preset) parts.push("preset=" + encodeURIComponent(preset));
    var h = parts.length ? "#" + parts.join("&") : "";
    if (location.hash !== h) history.replaceState(null, "", h || location.pathname + location.search);
  }
  function readHash() {
    location.hash.replace(/^#/, "").split("&").forEach(function (kv) {
      var a = kv.split("="), k = a[0], v = decodeURIComponent(a[1] || "");
      if (SPECS[k] && isFinite(parseFloat(v))) state[k] = SPECS[k].check ? (parseFloat(v) ? 1 : 0) : Math.min(SPECS[k].max, Math.max(SPECS[k].min, parseFloat(v)));
      else if (k === "basis" && (v === "rn" || v === "wacc")) state.basis = v;
      else if (k === "preset" && PRESETS[v]) preset = v;
    });
  }

  // ---- rendering
  var sol = null, sim = null, pending = 0, bgToken = 0;
  function update() { if (!pending) pending = requestAnimationFrame(function () { pending = 0; render(); }); }
  function render() {
    sol = M.solve(params());
    sim = M.simulate(sol, 1500, 11);
    var L = sol.lattice, p = sol.params;
    var w = $("warn"); w.hidden = !L.warnings.length; w.textContent = L.warnings.join(" ");
    headline(); scorecards(); decisionMap(); payoff(); distribution();
    $("derived").innerHTML = "Lattice step " + stepName(L.dt) + " · " + L.N + " steps<br>u " + L.u.toFixed(4) + " · d " + L.d.toFixed(4) + " · p " + L.p.toFixed(4) +
      "<br>drift " + (L.g * 100).toFixed(2) + "%/yr · discount " + (L.r * 100).toFixed(2) + "%/yr" +
      "<br>stages " + sol.levels.map(function (k) { return k.toFixed(0); }).join(" → ") + "k" +
      "<br>lease breaks in years " + (Object.keys(sol.lease.breaks).map(function (t) { return (t * L.dt).toFixed(1).replace(/\.0$/, ""); }).join(", ") || "none");
    // the sweeps need dozens of solves: done in the background, one solve per tick, abandoned if inputs change
    background(++bgToken);
  }
  function stepName(dt) { return dt === 0.25 ? "quarterly" : Math.abs(dt - 1 / 12) < 1e-9 ? "monthly" : Math.abs(dt - 1 / 52) < 1e-9 ? "weekly" : (dt * 52).toFixed(1) + " weeks"; }
  function money(v, sign) { return (sign && v > 0 ? "+" : v < 0 ? "−" : "") + "$" + Math.abs(v).toFixed(1) + "M"; }
  function bestFlexOf(s) { return FLEX.reduce(function (a, b) { return s[b].npv > s[a].npv ? b : a; }); }
  function flexOf(s) { return s[bestFlexOf(s)].npv - s.best.npv; }
  function share(k) { return Math.round(100 * sim.filter(function (r) { return r.sold[k] !== null; }).length / sim.length); }
  function idled(k) { return Math.round(100 * sim.filter(function (r) { return r.mothballs[k] > 0; }).length / sim.length); }
  function mean(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }

  function headline() {
    var f = flexOf(sol), bestFlex = bestFlexOf(sol), h = $("headline");
    var vsFull = sol[bestFlex].npv - sol.full.npv;
    h.innerHTML = "";
    var big = el("div", { class: "big" + (f < 0 ? " neg" : "") }, h); big.textContent = money(f, true);
    var what = el("div", { class: "what" }, h);
    if (f > 0.05) what.innerHTML = "<b>Value of flexibility.</b> " + NAMES[bestFlex] + " is worth " + money(f) + " more than the best fixed design (" +
      sol.best.K.toFixed(0) + "k units built now), and " + money(vsFull) + " more than committing to the full footprint (" + sol.Kbig.toFixed(0) +
      "k). Most studies quote the second number; the first is the honest one.";
    else what.innerHTML = "<b>Flexibility does not pay here.</b> The best fixed design (" + sol.best.K.toFixed(0) + "k units built now) is worth " +
      money(-f) + " more than the best flexible strategy. " + (sol.params.sigma < 0.15 ? "Demand is too predictable for the right to wait to be worth much." : "Waiting, building twice or renting costs more than the uncertainty it resolves.");
    var rights = [sol.params.salvF > 0 ? "sold" : null, sol.params.moth ? "mothballed" : null].filter(Boolean);
    if (rights.length) what.innerHTML += " Every owned design here can be " + rights.join(" or ") + " if demand collapses; " + (rights.length > 1 ? "those rights add " : "that right adds ") + money(sol.best.npv - sol.best.noExit) + " to the best fixed design" +
      (sol.params.moth ? " (mothballing alone: " + money(sol.best.npv - sol.best.noMoth) + (sol.params.salvF >= 0.15 && sol.best.npv - sol.best.noMoth < 0.05 ? ", because a site that resells is better sold than idled" : "") + ")." : ".");
  }

  function scorecards() {
    var host = $("scorecards"); host.innerHTML = "";
    var keys = ["full", "best", "defer", "stage", "lease"], top = keys.reduce(function (a, b) { return sol[b].npv > sol[a].npv ? b : a; });
    var built = sim.filter(function (r) { return r.deferYear !== null; }), years = built.map(function (r) { return r.deferYear; }).sort(function (a, b) { return a - b; });
    var exp = mean(sim.map(function (r) { return r.expansions; })), firsts = sim.filter(function (r) { return r.firstExpansion !== null; }).map(function (r) { return r.firstExpansion; }).sort(function (a, b) { return a - b; });
    var desc = {
      full: "Build the full " + sol.Kbig.toFixed(0) + "k units now; ready in " + yrs(sol.params.buildLead) + ".",
      best: "Build " + sol.best.K.toFixed(0) + "k units now: the capacity that maximises NPV without designed-in options." + (share("best") ? " Sold on " + share("best") + "% of paths." : "") + (idled("best") ? " Mothballed on " + idled("best") + "%." : ""),
      defer: built.length ? "Builds on " + Math.round(100 * built.length / sim.length) + "% of paths, typically in year " + years[Math.floor(years.length / 2)].toFixed(1) + "." : "Never builds inside the window: the 3PL is better.",
      stage: "Starts at " + sol.levels[0].toFixed(0) + "k; " + exp.toFixed(1) + " expansions on average" + (firsts.length ? ", the first typically in year " + firsts[Math.floor(firsts.length / 2)].toFixed(1) : "") + "." +
        (function () { var c = Math.round(100 * sim.filter(function (r) { return r.contractions > 0; }).length / sim.length); return c ? " Sells capacity back on " + c + "% of paths." : ""; })(),
      lease: "Lease " + sol.lease.K.toFixed(0) + "k units; the break clauses are worth " + money(sol.lease.npv - sol.lease.noBreak) + " and are used on " + share("lease") + "% of paths."
    };
    keys.forEach(function (k) {
      var c = el("div", { class: "score" + (k === top ? " win" : "") }, host); c.style.borderTopColor = COL[k];
      el("div", { class: "nm" }, c).innerHTML = NAMES[k] + (k === top ? '<span class="badge">best</span>' : "");
      el("div", { class: "v" }, c).textContent = money(sol[k].npv);
      el("div", { class: "d" }, c).textContent = desc[k];
    });
  }

  // demand distribution at step t: Binomial(t, p) over the up-moves i
  function pmfRows(L, every) {
    var out = [], pm = [1];
    for (var t = 0; t <= L.N; t++) {
      if (t % every === 0 || t === L.N) out.push({ t: t, pm: pm.slice() });
      var nx = new Array(t + 2).fill(0);
      for (var i = 0; i <= t; i++) { nx[i] += pm[i] * (1 - L.p); nx[i + 1] += pm[i] * L.p; }
      pm = nx;
    }
    return out;
  }
  // a continuous quantile of demand at step t: log-demand interpolated within the cumulative distribution
  function quantileD(p, L, pm, t, q) {
    var c = 0;
    for (var i = 0; i <= t; i++) {
      var c2 = c + pm[i];
      if (c2 >= q) { var f = pm[i] > 0 ? (q - c) / pm[i] : 0.5; return Math.min(p.D0 * Math.pow(L.u, 2 * i - t - 1 + 2 * f), p.ceiling * p.D0); }
      c = c2;
    }
    return M.demand(p, L, t, t);
  }
  // lattice nodes alternate between odd and even levels from one step to the next; averaging neighbouring steps in
  // log terms removes that saw-tooth without moving the curve
  function unzip(rows, keys) {
    return rows.map(function (r, j) {
      var o = { y: r.y }, nb = rows[j + 1] || rows[j - 1];
      keys.forEach(function (k) { o[k] = r[k] === null || !nb || nb[k] === null ? r[k] : Math.sqrt(r[k] * nb[k]); });
      return o;
    });
  }

  function decisionMap() {
    var L = sol.lattice, p = sol.params, svg = $("mapChart"), W = 720, H = 340, m = { l: 52, r: 16, t: 14, b: 34 };
    clear(svg);
    var every = Math.max(1, Math.round(0.25 / L.dt)), rowsP = pmfRows(L, 1);
    var fan = unzip(rowsP.map(function (r) {
      var D = function (q) { return quantileD(p, L, r.pm, r.t, q); };
      return { y: r.t * L.dt, q05: D(0.05), q25: D(0.25), q50: D(0.5), q75: D(0.75), q95: D(0.95) };
    }), ["q05", "q25", "q50", "q75", "q95"]).filter(function (r, j) { return j % every === 0 || j === rowsP.length - 1; });
    var trig = { defer: [], stage: [] };
    for (var t = 0; t <= L.W && t < L.N; t++) {
      var td = null, ts = null;
      for (var i = 0; i <= t; i++) if (sol.defer.build[t][i]) { td = edge(t, i); break; }
      if (t >= L.Lb) for (i = 0; i <= t; i++) { var c = sol.stage.pol[t][0][i]; if (c > 0 && c < 254) { ts = edge(t, i); break; } }
      trig.defer.push({ y: t * L.dt, D: td }); trig.stage.push({ y: t * L.dt, D: ts });
    }
    function edge(t, i) { return i === 0 ? M.demand(p, L, t, 0) : Math.min(p.D0 * Math.pow(L.u, 2 * i - t - 1), p.ceiling * p.D0); }
    // selling the best fixed design: below the line (once it is in place); breaking the lease at its break dates
    var sellT = [], breaksT = [];
    function top(ex, t, code) { for (var i = t; i >= 0; i--) if (ex[t][i] === code) return i === t ? M.demand(p, L, t, t) : Math.min(p.D0 * Math.pow(L.u, 2 * i - t + 1), p.ceiling * p.D0); return null; }
    function bottom(ex, t, code) { for (var i = 0; i <= t; i++) if (ex[t][i] === code) return edge(t, i); return null; }
    var idleT = [], restartT = [];
    if (sol.Rbest.ex) for (t = L.Lb; t < L.N; t++) {
      sellT.push({ y: t * L.dt, D: top(sol.Rbest.ex, t, 1) });
      idleT.push({ y: t * L.dt, D: top(sol.Rbest.ex, t, 2) });
      restartT.push({ y: t * L.dt, D: bottom(sol.Rbest.exB, t, 3) });
    }
    Object.keys(sol.lease.breaks).forEach(function (tb) { tb = +tb; var D = top(sol.lease.R.ex, tb, 1); breaksT.push({ y: tb * L.dt, D: D }); });
    // the restart line only matters where the site could be idle: show it where an idle line exists nearby
    if (!idleT.some(function (q) { return q.D !== null; })) restartT = [];
    var thin = function (a) { return unzip(a, ["D"]).filter(function (q, j) { return j % every === 0 || j === a.length - 1; }); };
    trig.defer = thin(trig.defer); trig.stage = thin(trig.stage); sellT = thin(sellT); idleT = thin(idleT); restartT = thin(restartT);
    var ymax = Math.max(p.ceiling * p.D0 * 1.04, sol.Kbig * 1.1), ymin = 0;
    var x = scale(0, p.life, m.l, W - m.r), y = scale(ymin, ymax, H - m.b, m.t);
    axes(svg, x, y, W, H, m, p.life, ymax, "year", "demand, k units/yr");
    // decision window
    rect(svg, x(0), m.t, x(Math.min(p.window, p.life)) - x(0), H - m.b - m.t, { fill: "rgba(125,211,252,.05)" });
    line(svg, x(p.window), m.t, x(p.window), H - m.b, { stroke: "var(--line)", "stroke-dasharray": "4 4" });
    text(svg, x(p.window) + 4, m.t + 12, "decision window ends", { class: "lbl" });
    area(svg, fan, x, y, "q05", "q95", "rgba(191,228,255,.10)");
    area(svg, fan, x, y, "q25", "q75", "rgba(191,228,255,.18)");
    path(svg, fan.map(function (f) { return [x(f.y), y(f.q50)]; }), { stroke: "var(--ink-dim)", "stroke-width": 1.5, fill: "none" });
    // capacities for reference
    [[sol.Kbig, "full footprint"], [sol.best.K, "best fixed"]].forEach(function (c) {
      line(svg, m.l, y(c[0]), W - m.r, y(c[0]), { stroke: "var(--ink-faint)", "stroke-dasharray": "2 4", "stroke-width": 1 });
      text(svg, W - m.r - 4, y(c[0]) - 4, c[1] + " " + c[0].toFixed(0) + "k", { "text-anchor": "end" });
    });
    ["defer", "stage"].forEach(function (k) {
      segments(trig[k]).forEach(function (sg) { path(svg, sg.map(function (q) { return [x(q.y), y(q.D)]; }), { stroke: COL[k], "stroke-width": 2.5, fill: "none", "stroke-linejoin": "round" }); });
    });
    segments(sellT).forEach(function (sg) { path(svg, sg.map(function (q) { return [x(q.y), y(q.D)]; }), { stroke: COL.best, "stroke-width": 2, "stroke-dasharray": "6 4", fill: "none" }); });
    segments(idleT).forEach(function (sg) { path(svg, sg.map(function (q) { return [x(q.y), y(q.D)]; }), { stroke: COL.best, "stroke-width": 2, "stroke-dasharray": "1.5 3.5", "stroke-linecap": "round", fill: "none" }); });
    segments(restartT).forEach(function (sg) { path(svg, sg.map(function (q) { return [x(q.y), y(q.D)]; }), { stroke: COL.best, "stroke-width": 1.5, opacity: 0.75, fill: "none" }); });
    breaksT.forEach(function (q) { if (q.D !== null) el("circle", { cx: x(q.y), cy: y(q.D), r: 5, fill: COL.lease, stroke: "var(--panel)", "stroke-width": 2 }, svg, NS); });
    var items = [["band", "rgba(191,228,255,.18)", "middle 50% of demand"], ["band", "rgba(191,228,255,.10)", "middle 90%"], ["line", "var(--ink-dim)", "median"],
      ["line", COL.defer, "wait & see: build above"], ["line", COL.stage, "stage & expand: first step above"]];
    if (sellT.some(function (q) { return q.D !== null; })) items.push(["dash", COL.best, "best fixed: sell below"]);
    if (idleT.some(function (q) { return q.D !== null; })) items.push(["dot2", COL.best, "best fixed: mothball below"], ["line", COL.best, "best fixed: restart above"]);
    if (breaksT.some(function (q) { return q.D !== null; })) items.push(["dot", COL.lease, "lease: break below, at break dates"]);
    legend($("mapLegend"), items);
    var d0 = trig.defer.find(function (q) { return q.D !== null; }), s0 = trig.stage.find(function (q) { return q.D !== null; });
    $("mapCaption").textContent = (d0 ? "Wait & see first becomes willing to build in year " + d0.y.toFixed(1) + ", if demand is above " + d0.D.toFixed(0) + "k. " : "Wait & see never builds inside the window. ") +
      (s0 ? "Stage & expand first adds a step in year " + s0.y.toFixed(1) + " if demand is above " + s0.D.toFixed(0) + "k. " : "Stage & expand never adds a step from its initial stage. ") +
      (function () { var b = breaksT.find(function (q) { return q.D !== null; }); return b ? "At its first break date (year " + b.y.toFixed(1) + ") the lease is handed back if demand is below " + b.D.toFixed(0) + "k." : "The lease is never broken."; })();
    hover(svg, m, W, H, function (mx) {
      var yr = x.inv(mx), f = nearest(fan, yr), td2 = nearest(trig.defer, yr), ts2 = nearest(trig.stage, yr);
      var s = "<b>Year " + f.y.toFixed(2) + "</b><br>median demand " + f.q50.toFixed(0) + "k<br>50%: " + f.q25.toFixed(0) + "–" + f.q75.toFixed(0) + "k · 90%: " + f.q05.toFixed(0) + "–" + f.q95.toFixed(0) + "k";
      if (yr <= p.window + 1e-9) s += "<br>wait & see builds above " + (td2 && td2.D !== null ? td2.D.toFixed(0) + "k" : "—") + "<br>first expansion above " + (ts2 && ts2.D !== null ? ts2.D.toFixed(0) + "k" : "—");
      else s += "<br>outside the decision window";
      var sl = sellT.length ? nearest(sellT, yr) : null;
      if (sl && Math.abs(sl.y - yr) < 0.3) s += "<br>best fixed is sold below " + (sl.D !== null ? sl.D.toFixed(0) + "k" : "— (never)");
      var il = idleT.length ? nearest(idleT, yr) : null, rl = restartT.length ? nearest(restartT, yr) : null;
      if (il && il.D !== null && Math.abs(il.y - yr) < 0.3) s += "<br>mothballed below " + il.D.toFixed(0) + "k" + (rl && rl.D !== null ? ", restarted above " + rl.D.toFixed(0) + "k" : "");
      return { html: s, x: x(f.y) };
    });
  }

  function payoff() {
    var svg = $("payChart"), W = 360, H = 300, m = { l: 46, r: 10, t: 10, b: 34 }, keys = ["best", "defer", "stage", "lease"];
    clear(svg);
    var pts = sim.slice(0, 400), xs = pts.map(function (r) { return r.meanDemand; });
    var all = []; pts.forEach(function (r) { keys.forEach(function (k) { all.push(r[k]); }); });
    var lo = quant(all, 0.01), hi = quant(all, 0.99), pad = (hi - lo) * 0.08;
    var x = scale(Math.min.apply(null, xs), Math.max.apply(null, xs), m.l, W - m.r), y = scale(lo - pad, hi + pad, H - m.b, m.t);
    axes(svg, x, y, W, H, m, null, null, "average demand over life, k/yr", "NPV $M");
    if (y.lo < 0 && y.hi > 0) line(svg, m.l, y(0), W - m.r, y(0), { stroke: "var(--ink-faint)", "stroke-width": 1 });
    var g = el("g", {}, svg, NS);
    keys.forEach(function (k) {
      pts.forEach(function (r) { var v = Math.max(y.lo, Math.min(y.hi, r[k])); el("circle", { cx: x(r.meanDemand).toFixed(1), cy: y(v).toFixed(1), r: 2.2, fill: COL[k], "fill-opacity": 0.7 }, g, NS); });
    });
    legend($("payLegend"), keys.map(function (k) { return ["dot", COL[k], NAMES[k]]; }));
    hover(svg, m, W, H, function (mx, my) {
      var b = null, bd = Infinity;
      pts.forEach(function (r) { keys.forEach(function (k) { var dx = x(r.meanDemand) - mx, dy = y(r[k]) - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; b = r; } }); });
      if (!b || bd > 400) return null;
      return { html: "<b>One demand path</b><br>average demand " + b.meanDemand.toFixed(0) + "k/yr<br>" + keys.map(function (k) { return NAMES[k] + ": " + money(b[k]); }).join("<br>") };
    });
  }

  function distribution() {
    var svg = $("distChart"), W = 360, H = 300, m = { l: 46, r: 10, t: 10, b: 34 };
    clear(svg);
    var fk = bestFlexOf(sol), keys = ["best", fk];
    var A = sim.map(function (r) { return r.best; }), B = sim.map(function (r) { return r[fk]; });
    var lo = Math.min(quant(A, 0.005), quant(B, 0.005)), hi = Math.max(quant(A, 0.995), quant(B, 0.995)), nb = 28, bw = (hi - lo) / nb;
    var hist = function (a) { var h = new Array(nb).fill(0); a.forEach(function (v) { var b = Math.floor((v - lo) / bw); if (b >= 0 && b < nb) h[b]++; }); return h.map(function (c) { return c / a.length; }); };
    var hA = hist(A), hB = hist(B), ymax = Math.max.apply(null, hA.concat(hB)) * 1.1;
    var x = scale(lo, hi, m.l, W - m.r), y = scale(0, ymax, H - m.b, m.t);
    axes(svg, x, y, W, H, m, null, null, "NPV $M", "share of paths", function (v) { return Math.round(v * 100) + "%"; });
    if (lo < 0 && hi > 0) line(svg, x(0), m.t, x(0), H - m.b, { stroke: "var(--ink-faint)" });
    [[hA, "best"], [hB, fk]].forEach(function (pair) {
      var d = "M" + x(lo) + "," + y(0);
      pair[0].forEach(function (v, i) { d += "L" + x(lo + i * bw) + "," + y(v) + "L" + x(lo + (i + 1) * bw) + "," + y(v); });
      d += "L" + x(hi) + "," + y(0);
      el("path", { d: d, fill: COL[pair[1]], "fill-opacity": 0.18, stroke: COL[pair[1]], "stroke-width": 2 }, svg, NS);
    });
    legend($("distLegend"), keys.map(function (k) { return ["band", COL[k], NAMES[k]]; }));
    var st = function (a) { return "mean " + money(mean(a)) + ", 5th percentile " + money(quant(a, 0.05)) + ", P(loss) " + Math.round(100 * a.filter(function (v) { return v < 0; }).length / a.length) + "%"; };
    $("distCaption").innerHTML = "<b>" + NAMES.best + "</b>: " + st(A) + ".<br><b>" + NAMES[fk] + "</b>: " + st(B) + ".";
    hover(svg, m, W, H, function (mx) {
      var b = Math.floor((x.inv(mx) - lo) / bw); if (b < 0 || b >= nb) return null;
      return { html: "<b>" + money(lo + b * bw) + " to " + money(lo + (b + 1) * bw) + "</b><br>" + NAMES.best + ": " + (hA[b] * 100).toFixed(1) + "%<br>" + NAMES[fk] + ": " + (hB[b] * 100).toFixed(1) + "%", x: x(lo + (b + 0.5) * bw) };
    });
  }

  // ---- background sweeps: volatility and the tornado
  var SIGMAS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6];
  var TORNADO = [
    ["Volatility", "sigma", function (v) { return [v * 0.6, v * 1.4]; }, function (v) { return Math.round(v * 100) + "%"; }],
    ["Expected growth", "g", function (v) { return [v - 0.02, v + 0.02]; }, function (v) { return (v * 100).toFixed(1) + "%"; }],
    ["Decision window", "window", function (v) { return [Math.max(1, v - 3), v + 3]; }, function (v) { return v + "y"; }],
    ["Build lead time", "buildLead", function (v) { return [Math.max(0, v - 0.75), v + 0.75]; }, function (v) { return v + "y"; }],
    ["Margin, own network", "margin", function (v) { return [v * 0.8, v * 1.2]; }, function (v) { return "$" + (v * 1000).toFixed(0); }],
    ["Penalty, lost sale", "penalty", function (v) { return [v * 0.5, v * 1.5]; }, function (v) { return "$" + (v * 1000).toFixed(0); }],
    ["Outsourcing limit", "outCap", function (v) { return [Math.max(0, v - 0.5), v + 0.5]; }, function (v) { return Math.round(v * 100) + "%"; }],
    ["Staging premium", "premium", function (v) { return [Math.max(0, v - 0.15), v + 0.15]; }, function (v) { return Math.round(v * 100) + "%"; }],
    ["Cost escalation", "escal", function (v) { return [Math.max(0, v - 0.03), v + 0.03]; }, function (v) { return (v * 100).toFixed(0) + "%"; }],
    ["Resale value", "salvF", function (v) { return [Math.max(0, v - 0.2), v + 0.2]; }, function (v) { return Math.round(v * 100) + "%"; }],
    ["Lease rent", "rent", function (v) { return [v * 0.85, v * 1.15]; }, function (v) { return "$" + (v * 1000).toFixed(2); }],
    ["Break fee", "breakFee", function (v) { return [Math.max(0, v - 0.75), v + 0.75]; }, function (v) { return v.toFixed(2) + "y"; }],
    ["Holding cost of capacity", "opcost", function (v) { return [v * 0.7, v * 1.3]; }, function (v) { return "$" + (v * 1000).toFixed(1); }]
  ];
  function background(token) {
    var base = params(), jobs = [], volRes = [], torRes = [];
    SIGMAS.forEach(function (s) { jobs.push(function () {
      var pp = params({ sigma: s });
      // very slow lattices (weekly steps) are skipped in the sweep
      if (M.lattice(M.merge(pp)).dt < 1 / 13) { volRes.push({ s: s, defer: null, stage: null, lease: null }); return; }
      var r = M.solve(pp); volRes.push({ s: s, defer: r.defer.npv - r.best.npv, stage: r.stage.npv - r.best.npv, lease: r.lease.npv - r.best.npv });
    }); });
    var f0 = flexOf(sol);
    TORNADO.forEach(function (t) { jobs.push(function () {
      var lohi = t[2](base[t[1]]), vals = lohi.map(function (v) { var o = {}; o[t[1]] = v; if (t[1] === "window") o.window = Math.min(v, base.life); return flexOf(M.solve(params(o))) - f0; });
      torRes.push({ name: t[0], lo: lohi[0], hi: lohi[1], dlo: vals[0], dhi: vals[1], fmt: t[3] });
    }); });
    (function step() {
      if (token !== bgToken) return;
      var job = jobs.shift(); if (job) job();
      if (jobs.length === TORNADO.length && volRes.length === SIGMAS.length) volChart(volRes);
      if (!jobs.length) { tornado(torRes, f0); return; }
      setTimeout(step, 0);
    })();
  }
  function volChart(res) {
    var svg = $("volChart"), W = 360, H = 280, m = { l: 46, r: 10, t: 10, b: 34 }; clear(svg);
    var vals = []; res.forEach(function (r) { FLEX.forEach(function (k) { if (r[k] !== null) vals.push(r[k]); }); });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0.5, Math.max.apply(null, vals)), pad = (hi - lo) * 0.08;
    var x = scale(0, 0.62, m.l, W - m.r), y = scale(lo - pad, hi + pad, H - m.b, m.t);
    axes(svg, x, y, W, H, m, null, null, "volatility", "vs best fixed, $M", null, function (v) { return Math.round(v * 100) + "%"; });
    line(svg, m.l, y(0), W - m.r, y(0), { stroke: "var(--ink-faint)" });
    var cur = sol.params.sigma; line(svg, x(cur), m.t, x(cur), H - m.b, { stroke: "var(--accent)", "stroke-dasharray": "4 4" });
    FLEX.forEach(function (k) {
      segments(res.map(function (r) { return { y: r.s, D: r[k] }; })).forEach(function (sg) { path(svg, sg.map(function (q) { return [x(q.y), y(q.D)]; }), { stroke: COL[k], "stroke-width": 2, fill: "none" }); });
      res.forEach(function (r) { if (r[k] !== null) el("circle", { cx: x(r.s), cy: y(r[k]), r: 4, fill: COL[k], stroke: "var(--panel)", "stroke-width": 2 }, svg, NS); });
    });
    legend($("volLegend"), FLEX.map(function (k) { return ["line", COL[k], NAMES[k]]; }).concat([["dash", "var(--accent)", "your setting"]]));
    var cell = function (v) { return "<td>" + (v === null ? "—" : money(v, true)) + "</td>"; };
    $("volTable").innerHTML = "<table class='data'><tr><th>Volatility</th>" + FLEX.map(function (k) { return "<th>" + NAMES[k].replace("&", "&amp;") + "</th>"; }).join("") + "</tr>" + res.map(function (r) {
      return "<tr><td>" + Math.round(r.s * 100) + "%</td>" + FLEX.map(function (k) { return cell(r[k]); }).join("") + "</tr>"; }).join("") + "</table>";
    hover(svg, m, W, H, function (mx) {
      var r = res.reduce(function (a, b) { return Math.abs(x(b.s) - mx) < Math.abs(x(a.s) - mx) ? b : a; });
      return { html: "<b>Volatility " + Math.round(r.s * 100) + "%</b><br>" + FLEX.map(function (k) { return NAMES[k] + ": " + (r[k] === null ? "—" : money(r[k], true)); }).join("<br>"), x: x(r.s) };
    });
  }
  function tornado(res, f0) {
    var svg = $("torChart"), W = 360, H = 360, m = { l: 128, r: 20, t: 8, b: 30 }; clear(svg);
    res.sort(function (a, b) { return Math.max(Math.abs(b.dlo), Math.abs(b.dhi)) - Math.max(Math.abs(a.dlo), Math.abs(a.dhi)); });
    var ext = Math.max(0.5, Math.max.apply(null, res.map(function (r) { return Math.max(Math.abs(r.dlo), Math.abs(r.dhi)); }))) * 1.1;
    var x = scale(-ext, ext, m.l, W - m.r), bh = (H - m.t - m.b) / res.length;
    line(svg, x(0), m.t, x(0), H - m.b, { stroke: "var(--ink-faint)" });
    [-ext * 0.75, 0, ext * 0.75].forEach(function (v) { text(svg, x(v), H - m.b + 14, money(v, true).replace(".0M", "M"), { "text-anchor": "middle" }); });
    text(svg, x(0), H - 4, "change in flexibility value (now " + money(f0, true) + ")", { "text-anchor": "middle" });
    res.forEach(function (r, i) {
      var yc = m.t + i * bh + bh / 2;
      text(svg, m.l - 6, yc + 4, r.name, { "text-anchor": "end", class: "lbl" });
      [[r.dlo, "var(--s1)"], [r.dhi, "var(--s2)"]].forEach(function (b) {
        var x0 = Math.min(x(0), x(b[0])), wd = Math.max(1, Math.abs(x(b[0]) - x(0)));
        el("rect", { x: x0, y: yc - bh * 0.32, width: wd, height: bh * 0.64, rx: 3, fill: b[1] }, svg, NS);
      });
    });
    legend($("torLegend"), [["band", "var(--s1)", "assumption lower"], ["band", "var(--s2)", "assumption higher"]]);
    hover(svg, { l: 0, r: m.r, t: m.t, b: m.b }, W, H, function (mx, my) {
      var i = Math.floor((my - m.t) / bh); if (i < 0 || i >= res.length) return null; var r = res[i];
      return { html: "<b>" + r.name + "</b><br>" + r.fmt(r.lo) + ": " + money(r.dlo, true) + "<br>" + r.fmt(r.hi) + ": " + money(r.dhi, true) };
    });
  }

  readHash(); sync(); render();
})();
