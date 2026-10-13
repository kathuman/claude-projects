// Real Options for Network Design — the page. All valuation is done by src/model.js (window.RealOptions).
(function () {
  "use strict";
  var M = window.RealOptions;
  var $ = function (id) { return document.getElementById(id); };
  var I18 = window.ROi18n, T = I18.T, tw = I18.tw;
  var NS = "http://www.w3.org/2000/svg", C = window.ROCharts;
  var el = C.el, clear = C.clear, scale = C.scale, line = C.line, rect = C.rect, text = C.text, path = C.path, area = C.area, axes = C.axes,
    legend = C.legend, hover = C.hover, segments = C.segments, nearest = C.nearest, quant = C.quant;
  $("ver").textContent = "v" + M.VERSION; $("ver-foot").textContent = "v" + M.VERSION;

  // ---- controls (shared definitions in specs.js): shown in friendly units, stored in model units (model = shown × scale)
  var GROUPS = window.ROSpecs.single.GROUPS, SPECS = window.ROSpecs.single.SPECS, PRESETS = window.ROSpecs.single.PRESETS;
  var yrs = window.ROSpecs.fmt.yrs;
  var state = { basis: "wacc" }, preset = null;
  Object.keys(SPECS).forEach(function (k) { state[k] = SPECS[k].def; });

  var NAMES = { full: T("Commit now"), best: T("Best fixed"), defer: T("Wait & see"), stage: T("Stage & expand"), lease: T("Lease & break") };
  var COL = { full: "var(--s4)", best: "var(--s1)", defer: "var(--s2)", stage: "var(--s3)", lease: "var(--s5)" };
  var FLEX = ["defer", "stage", "lease"];

  // ---- build the controls
  var host = $("ctlHost"), inputs = {}, outs = {}, rows = {};
  GROUPS.forEach(function (g) {
    var box = el("div", { class: "cgrp" }, host); el("h3", {}, box).textContent = g.name;
    if (g.basis) {
      var seg = el("div", { class: "seg", role: "group", "aria-label": T("Valuation basis") }, box);
      [["wacc", T("Expected cash flows @ WACC")], ["rn", T("Risk-neutral")]].forEach(function (b) {
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
    var b = el("button", { type: "button", "data-preset": name }, ph); b.textContent = T(name);
    b.addEventListener("click", function () { applyPreset(name); });
  });
  var rb = el("button", { type: "button" }, ph); rb.textContent = T("Reset");
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
    var w = $("warn"); w.hidden = !L.warnings.length; w.textContent = L.warnings.map(tw).join(" ");
    headline(); scorecards(); decisionMap(); payoff(); distribution();
    $("derived").innerHTML = T("Lattice step {step} · {n} steps", { step: stepName(L.dt), n: L.N }) + "<br>u " + L.u.toFixed(4) + " · d " + L.d.toFixed(4) + " · p " + L.p.toFixed(4) +
      "<br>" + T("drift {g}%/yr · discount {r}%/yr", { g: (L.g * 100).toFixed(2), r: (L.r * 100).toFixed(2) }) +
      "<br>" + T("stages {list}k", { list: sol.levels.map(function (k) { return k.toFixed(0); }).join(" → ") }) +
      "<br>" + T("lease breaks in years {list}", { list: Object.keys(sol.lease.breaks).map(function (t) { return (t * L.dt).toFixed(1).replace(/\.0$/, ""); }).join(", ") || T("none") });
    // the sweeps need dozens of solves: done in the background, one solve per tick, abandoned if inputs change
    background(++bgToken);
  }
  function stepName(dt) { return dt === 0.25 ? T("quarterly") : Math.abs(dt - 1 / 12) < 1e-9 ? T("monthly") : Math.abs(dt - 1 / 52) < 1e-9 ? T("weekly") : T("{n} weeks", { n: (dt * 52).toFixed(1) }); }
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
    if (f > 0.05) what.innerHTML = T("<b>Value of flexibility.</b> {name} is worth {f} more than the best fixed design ({K}k units built now), and {vs} more than committing to the full footprint ({Kbig}k). Most studies quote the second number; the first is the honest one.",
      { name: NAMES[bestFlex], f: money(f), K: sol.best.K.toFixed(0), vs: money(vsFull), Kbig: sol.Kbig.toFixed(0) });
    else what.innerHTML = T("<b>Flexibility does not pay here.</b> The best fixed design ({K}k units built now) is worth {f} more than the best flexible strategy.", { K: sol.best.K.toFixed(0), f: money(-f) }) + " " +
      (sol.params.sigma < 0.15 ? T("Demand is too predictable for the right to wait to be worth much.") : T("Waiting, building twice or renting costs more than the uncertainty it resolves."));
    var sell = sol.params.salvF > 0, moth = !!sol.params.moth, add = money(sol.best.npv - sol.best.noExit);
    if (sell || moth) what.innerHTML += " " + (sell && moth ? T("Every owned design here can be sold or mothballed if demand collapses; those rights add {v} to the best fixed design", { v: add }) :
      sell ? T("Every owned design here can be sold if demand collapses; that right adds {v} to the best fixed design", { v: add }) : T("Every owned design here can be mothballed if demand collapses; that right adds {v} to the best fixed design", { v: add })) +
      (moth ? " " + (sol.params.salvF >= 0.15 && sol.best.npv - sol.best.noMoth < 0.05 ? T("(mothballing alone: {v}, because a site that resells is better sold than idled).", { v: money(sol.best.npv - sol.best.noMoth) }) : T("(mothballing alone: {v}).", { v: money(sol.best.npv - sol.best.noMoth) })) : ".");
  }

  function scorecards() {
    var host = $("scorecards"); host.innerHTML = "";
    var keys = ["full", "best", "defer", "stage", "lease"], top = keys.reduce(function (a, b) { return sol[b].npv > sol[a].npv ? b : a; });
    var built = sim.filter(function (r) { return r.deferYear !== null; }), years = built.map(function (r) { return r.deferYear; }).sort(function (a, b) { return a - b; });
    var exp = mean(sim.map(function (r) { return r.expansions; })), firsts = sim.filter(function (r) { return r.firstExpansion !== null; }).map(function (r) { return r.firstExpansion; }).sort(function (a, b) { return a - b; });
    var desc = {
      full: T("Build the full {K}k units now; ready in {lead}.", { K: sol.Kbig.toFixed(0), lead: yrs(sol.params.buildLead) }),
      best: T("Build {K}k units now: the capacity that maximises NPV without designed-in options.", { K: sol.best.K.toFixed(0) }) + (share("best") ? " " + T("Sold on {p}% of paths.", { p: share("best") }) : "") + (idled("best") ? " " + T("Mothballed on {p}%.", { p: idled("best") }) : ""),
      defer: built.length ? T("Builds on {p}% of paths, typically in year {y}.", { p: Math.round(100 * built.length / sim.length), y: years[Math.floor(years.length / 2)].toFixed(1) }) : T("Never builds inside the window: the 3PL is better."),
      stage: (firsts.length ? T("Starts at {K}k; {n} expansions on average, the first typically in year {y}.", { K: sol.levels[0].toFixed(0), n: exp.toFixed(1), y: firsts[Math.floor(firsts.length / 2)].toFixed(1) }) : T("Starts at {K}k; {n} expansions on average.", { K: sol.levels[0].toFixed(0), n: exp.toFixed(1) })) +
        (function () { var c = Math.round(100 * sim.filter(function (r) { return r.contractions > 0; }).length / sim.length); return c ? " " + T("Sells capacity back on {p}% of paths.", { p: c }) : ""; })(),
      lease: T("Lease {K}k units; the break clauses are worth {v} and are used on {p}% of paths.", { K: sol.lease.K.toFixed(0), v: money(sol.lease.npv - sol.lease.noBreak), p: share("lease") })
    };
    keys.forEach(function (k) {
      var c = el("div", { class: "score" + (k === top ? " win" : "") }, host); c.style.borderTopColor = COL[k];
      el("div", { class: "nm" }, c).innerHTML = NAMES[k] + (k === top ? '<span class="badge">' + T("best") + '</span>' : "");
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
    axes(svg, x, y, W, H, m, p.life, ymax, T("year"), T("demand, k units/yr"));
    // decision window
    rect(svg, x(0), m.t, x(Math.min(p.window, p.life)) - x(0), H - m.b - m.t, { fill: "rgba(125,211,252,.05)" });
    line(svg, x(p.window), m.t, x(p.window), H - m.b, { stroke: "var(--line)", "stroke-dasharray": "4 4" });
    text(svg, x(p.window) + 4, m.t + 12, T("decision window ends"), { class: "lbl" });
    area(svg, fan, x, y, "q05", "q95", "rgba(191,228,255,.10)");
    area(svg, fan, x, y, "q25", "q75", "rgba(191,228,255,.18)");
    path(svg, fan.map(function (f) { return [x(f.y), y(f.q50)]; }), { stroke: "var(--ink-dim)", "stroke-width": 1.5, fill: "none" });
    // capacities for reference
    [[sol.Kbig, T("full footprint")], [sol.best.K, T("best fixed")]].forEach(function (c) {
      line(svg, m.l, y(c[0]), W - m.r, y(c[0]), { stroke: "var(--ink-faint)", "stroke-dasharray": "2 4", "stroke-width": 1 });
      text(svg, W - m.r - 4, y(c[0]) - 4, c[1] + " " + T("{v}k", { v: c[0].toFixed(0) }), { "text-anchor": "end" });
    });
    ["defer", "stage"].forEach(function (k) {
      segments(trig[k]).forEach(function (sg) { path(svg, sg.map(function (q) { return [x(q.y), y(q.D)]; }), { stroke: COL[k], "stroke-width": 2.5, fill: "none", "stroke-linejoin": "round" }); });
    });
    segments(sellT).forEach(function (sg) { path(svg, sg.map(function (q) { return [x(q.y), y(q.D)]; }), { stroke: COL.best, "stroke-width": 2, "stroke-dasharray": "6 4", fill: "none" }); });
    segments(idleT).forEach(function (sg) { path(svg, sg.map(function (q) { return [x(q.y), y(q.D)]; }), { stroke: COL.best, "stroke-width": 2, "stroke-dasharray": "1.5 3.5", "stroke-linecap": "round", fill: "none" }); });
    segments(restartT).forEach(function (sg) { path(svg, sg.map(function (q) { return [x(q.y), y(q.D)]; }), { stroke: COL.best, "stroke-width": 1.5, opacity: 0.75, fill: "none" }); });
    breaksT.forEach(function (q) { if (q.D !== null) el("circle", { cx: x(q.y), cy: y(q.D), r: 5, fill: COL.lease, stroke: "var(--panel)", "stroke-width": 2 }, svg, NS); });
    var items = [["band", "rgba(191,228,255,.18)", T("middle 50% of demand")], ["band", "rgba(191,228,255,.10)", T("middle 90%")], ["line", "var(--ink-dim)", T("median")],
      ["line", COL.defer, T("wait & see: build above")], ["line", COL.stage, T("stage & expand: first step above")]];
    if (sellT.some(function (q) { return q.D !== null; })) items.push(["dash", COL.best, T("best fixed: sell below")]);
    if (idleT.some(function (q) { return q.D !== null; })) items.push(["dot2", COL.best, T("best fixed: mothball below")], ["line", COL.best, T("best fixed: restart above")]);
    if (breaksT.some(function (q) { return q.D !== null; })) items.push(["dot", COL.lease, T("lease: break below, at break dates")]);
    legend($("mapLegend"), items);
    var d0 = trig.defer.find(function (q) { return q.D !== null; }), s0 = trig.stage.find(function (q) { return q.D !== null; });
    $("mapCaption").textContent = (d0 ? T("Wait & see first becomes willing to build in year {y}, if demand is above {D}k.", { y: d0.y.toFixed(1), D: d0.D.toFixed(0) }) : T("Wait & see never builds inside the window.")) + " " +
      (s0 ? T("Stage & expand first adds a step in year {y} if demand is above {D}k.", { y: s0.y.toFixed(1), D: s0.D.toFixed(0) }) : T("Stage & expand never adds a step from its initial stage.")) + " " +
      (function () { var b = breaksT.find(function (q) { return q.D !== null; }); return b ? T("At its first break date (year {y}) the lease is handed back if demand is below {D}k.", { y: b.y.toFixed(1), D: b.D.toFixed(0) }) : T("The lease is never broken."); })();
    hover(svg, m, W, H, function (mx) {
      var yr = x.inv(mx), f = nearest(fan, yr), td2 = nearest(trig.defer, yr), ts2 = nearest(trig.stage, yr);
      var s = "<b>" + T("Year {y}", { y: f.y.toFixed(2) }) + "</b><br>" + T("median demand {D}k", { D: f.q50.toFixed(0) }) + "<br>50%: " + T("{v}k", { v: f.q25.toFixed(0) + "–" + f.q75.toFixed(0) }) + " · 90%: " + T("{v}k", { v: f.q05.toFixed(0) + "–" + f.q95.toFixed(0) });
      if (yr <= p.window + 1e-9) s += "<br>" + T("wait & see builds above {D}", { D: td2 && td2.D !== null ? T("{v}k", { v: td2.D.toFixed(0) }) : "—" }) + "<br>" + T("first expansion above {D}", { D: ts2 && ts2.D !== null ? T("{v}k", { v: ts2.D.toFixed(0) }) : "—" });
      else s += "<br>" + T("outside the decision window");
      var sl = sellT.length ? nearest(sellT, yr) : null;
      if (sl && Math.abs(sl.y - yr) < 0.3) s += "<br>" + T("best fixed is sold below {D}", { D: sl.D !== null ? T("{v}k", { v: sl.D.toFixed(0) }) : T("— (never)") });
      var il = idleT.length ? nearest(idleT, yr) : null, rl = restartT.length ? nearest(restartT, yr) : null;
      if (il && il.D !== null && Math.abs(il.y - yr) < 0.3) s += "<br>" + (rl && rl.D !== null ? T("mothballed below {D}k, restarted above {R}k", { D: il.D.toFixed(0), R: rl.D.toFixed(0) }) : T("mothballed below {D}k", { D: il.D.toFixed(0) }));
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
    axes(svg, x, y, W, H, m, null, null, T("average demand over life, k/yr"), T("NPV $M"));
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
      return { html: "<b>" + T("One demand path") + "</b><br>" + T("average demand {D}k/yr", { D: b.meanDemand.toFixed(0) }) + "<br>" + keys.map(function (k) { return NAMES[k] + ": " + money(b[k]); }).join("<br>") };
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
    axes(svg, x, y, W, H, m, null, null, T("NPV $M"), T("share of paths"), function (v) { return Math.round(v * 100) + "%"; });
    if (lo < 0 && hi > 0) line(svg, x(0), m.t, x(0), H - m.b, { stroke: "var(--ink-faint)" });
    [[hA, "best"], [hB, fk]].forEach(function (pair) {
      var d = "M" + x(lo) + "," + y(0);
      pair[0].forEach(function (v, i) { d += "L" + x(lo + i * bw) + "," + y(v) + "L" + x(lo + (i + 1) * bw) + "," + y(v); });
      d += "L" + x(hi) + "," + y(0);
      el("path", { d: d, fill: COL[pair[1]], "fill-opacity": 0.18, stroke: COL[pair[1]], "stroke-width": 2 }, svg, NS);
    });
    legend($("distLegend"), keys.map(function (k) { return ["band", COL[k], NAMES[k]]; }));
    var st = function (a) { return T("mean {m}, 5th percentile {p5}, P(loss) {pl}%", { m: money(mean(a)), p5: money(quant(a, 0.05)), pl: Math.round(100 * a.filter(function (v) { return v < 0; }).length / a.length) }); };
    $("distCaption").innerHTML = "<b>" + NAMES.best + "</b>: " + st(A) + ".<br><b>" + NAMES[fk] + "</b>: " + st(B) + ".";
    hover(svg, m, W, H, function (mx) {
      var b = Math.floor((x.inv(mx) - lo) / bw); if (b < 0 || b >= nb) return null;
      return { html: "<b>" + T("{a} to {b}", { a: money(lo + b * bw), b: money(lo + (b + 1) * bw) }) + "</b><br>" + NAMES.best + ": " + (hA[b] * 100).toFixed(1) + "%<br>" + NAMES[fk] + ": " + (hB[b] * 100).toFixed(1) + "%", x: x(lo + (b + 0.5) * bw) };
    });
  }

  // ---- background sweeps: volatility and the tornado
  var SIGMAS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6];
  var TORNADO = [
    [T("Volatility"), "sigma", function (v) { return [v * 0.6, v * 1.4]; }, function (v) { return Math.round(v * 100) + "%"; }],
    [T("Expected growth"), "g", function (v) { return [v - 0.02, v + 0.02]; }, function (v) { return (v * 100).toFixed(1) + "%"; }],
    [T("Decision window"), "window", function (v) { return [Math.max(1, v - 3), v + 3]; }, function (v) { return T("{v}y", { v: v }); }],
    [T("Build lead time"), "buildLead", function (v) { return [Math.max(0, v - 0.75), v + 0.75]; }, function (v) { return T("{v}y", { v: v }); }],
    [T("Margin, own network"), "margin", function (v) { return [v * 0.8, v * 1.2]; }, function (v) { return "$" + (v * 1000).toFixed(0); }],
    [T("Penalty, lost sale"), "penalty", function (v) { return [v * 0.5, v * 1.5]; }, function (v) { return "$" + (v * 1000).toFixed(0); }],
    [T("Outsourcing limit"), "outCap", function (v) { return [Math.max(0, v - 0.5), v + 0.5]; }, function (v) { return Math.round(v * 100) + "%"; }],
    [T("Staging premium"), "premium", function (v) { return [Math.max(0, v - 0.15), v + 0.15]; }, function (v) { return Math.round(v * 100) + "%"; }],
    [T("Cost escalation"), "escal", function (v) { return [Math.max(0, v - 0.03), v + 0.03]; }, function (v) { return (v * 100).toFixed(0) + "%"; }],
    [T("Resale value"), "salvF", function (v) { return [Math.max(0, v - 0.2), v + 0.2]; }, function (v) { return Math.round(v * 100) + "%"; }],
    [T("Lease rent"), "rent", function (v) { return [v * 0.85, v * 1.15]; }, function (v) { return "$" + (v * 1000).toFixed(2); }],
    [T("Break fee"), "breakFee", function (v) { return [Math.max(0, v - 0.75), v + 0.75]; }, function (v) { return T("{v}y", { v: v.toFixed(2) }); }],
    [T("Holding cost of capacity"), "opcost", function (v) { return [v * 0.7, v * 1.3]; }, function (v) { return "$" + (v * 1000).toFixed(1); }]
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
    axes(svg, x, y, W, H, m, null, null, T("volatility"), T("vs best fixed, $M"), null, function (v) { return Math.round(v * 100) + "%"; });
    line(svg, m.l, y(0), W - m.r, y(0), { stroke: "var(--ink-faint)" });
    var cur = sol.params.sigma; line(svg, x(cur), m.t, x(cur), H - m.b, { stroke: "var(--accent)", "stroke-dasharray": "4 4" });
    FLEX.forEach(function (k) {
      segments(res.map(function (r) { return { y: r.s, D: r[k] }; })).forEach(function (sg) { path(svg, sg.map(function (q) { return [x(q.y), y(q.D)]; }), { stroke: COL[k], "stroke-width": 2, fill: "none" }); });
      res.forEach(function (r) { if (r[k] !== null) el("circle", { cx: x(r.s), cy: y(r[k]), r: 4, fill: COL[k], stroke: "var(--panel)", "stroke-width": 2 }, svg, NS); });
    });
    legend($("volLegend"), FLEX.map(function (k) { return ["line", COL[k], NAMES[k]]; }).concat([["dash", "var(--accent)", T("your setting")]]));
    var cell = function (v) { return "<td>" + (v === null ? "—" : money(v, true)) + "</td>"; };
    $("volTable").innerHTML = "<table class='data'><tr><th>" + T("Volatility") + "</th>" + FLEX.map(function (k) { return "<th>" + NAMES[k].replace("&", "&amp;") + "</th>"; }).join("") + "</tr>" + res.map(function (r) {
      return "<tr><td>" + Math.round(r.s * 100) + "%</td>" + FLEX.map(function (k) { return cell(r[k]); }).join("") + "</tr>"; }).join("") + "</table>";
    hover(svg, m, W, H, function (mx) {
      var r = res.reduce(function (a, b) { return Math.abs(x(b.s) - mx) < Math.abs(x(a.s) - mx) ? b : a; });
      return { html: "<b>" + T("Volatility {v}%", { v: Math.round(r.s * 100) }) + "</b><br>" + FLEX.map(function (k) { return NAMES[k] + ": " + (r[k] === null ? "—" : money(r[k], true)); }).join("<br>"), x: x(r.s) };
    });
  }
  function tornado(res, f0) {
    var svg = $("torChart"), W = 360, H = 360, m = { l: 128, r: 20, t: 8, b: 30 }; clear(svg);
    res.sort(function (a, b) { return Math.max(Math.abs(b.dlo), Math.abs(b.dhi)) - Math.max(Math.abs(a.dlo), Math.abs(a.dhi)); });
    var ext = Math.max(0.5, Math.max.apply(null, res.map(function (r) { return Math.max(Math.abs(r.dlo), Math.abs(r.dhi)); }))) * 1.1;
    var x = scale(-ext, ext, m.l, W - m.r), bh = (H - m.t - m.b) / res.length;
    line(svg, x(0), m.t, x(0), H - m.b, { stroke: "var(--ink-faint)" });
    [-ext * 0.75, 0, ext * 0.75].forEach(function (v) { text(svg, x(v), H - m.b + 14, money(v, true).replace(".0M", "M"), { "text-anchor": "middle" }); });
    text(svg, x(0), H - 4, T("change in flexibility value (now {v})", { v: money(f0, true) }), { "text-anchor": "middle" });
    res.forEach(function (r, i) {
      var yc = m.t + i * bh + bh / 2;
      text(svg, m.l - 6, yc + 4, r.name, { "text-anchor": "end", class: "lbl" });
      [[r.dlo, "var(--s1)"], [r.dhi, "var(--s2)"]].forEach(function (b) {
        var x0 = Math.min(x(0), x(b[0])), wd = Math.max(1, Math.abs(x(b[0]) - x(0)));
        el("rect", { x: x0, y: yc - bh * 0.32, width: wd, height: bh * 0.64, rx: 3, fill: b[1] }, svg, NS);
      });
    });
    legend($("torLegend"), [["band", "var(--s1)", T("assumption lower")], ["band", "var(--s2)", T("assumption higher")]]);
    hover(svg, { l: 0, r: m.r, t: m.t, b: m.b }, W, H, function (mx, my) {
      var i = Math.floor((my - m.t) / bh); if (i < 0 || i >= res.length) return null; var r = res[i];
      return { html: "<b>" + r.name + "</b><br>" + r.fmt(r.lo) + ": " + money(r.dlo, true) + "<br>" + r.fmt(r.hi) + ": " + money(r.dhi, true) };
    });
  }

  // ---- an interface for the tutorial and the calibration panel: values are in the units shown on the sliders
  function set(shown, opts) {
    opts = opts || {};
    if (opts.reset !== false) Object.keys(SPECS).forEach(function (k) { state[k] = SPECS[k].def; });
    Object.keys(shown || {}).forEach(function (k) { if (SPECS[k]) state[k] = shown[k]; });
    state.basis = opts.basis || (opts.reset !== false ? "wacc" : state.basis);
    preset = opts.preset || null;
    sync(); render();
  }
  window.ROApp = { set: set, preset: applyPreset, state: function () { return JSON.parse(JSON.stringify(state)); }, solution: function () { return sol; }, simulation: function () { return sim; }, specs: SPECS, names: NAMES };

  // ---- calibration: estimates go to demand today, volatility and growth
  window.ROCalibUI.mount($("calib"), [{ label: T("Apply to the model"), name: T("the model"), apply: function (est) {
    var a = window.ROCalibUI.snap(SPECS.D0, est.D0, T("Demand today")), b = window.ROCalibUI.snap(SPECS.sigma, est.sigma, T("Volatility")), c = window.ROCalibUI.snap(SPECS.g, est.g, T("Growth"));
    set({ D0: a.value, sigma: b.value, g: c.value }, { reset: false });
    return [a.note, b.note, c.note].filter(Boolean);
  } }]);

  // ---- the report link follows the scenario
  function reportHref(hash, name) { return I18.withLang("report.html") + (hash || "") + (name ? (hash ? "&" : "#") + "name=" + encodeURIComponent(name) : ""); }
  var _wh = writeHash; writeHash = function () { _wh(); $("reportLink").href = reportHref(location.hash); };

  // ---- scenario comparison (saved in this browser only)
  var CMP_KEY = "ro-scenarios-v1", cmpCache = {};
  function loadSaved() { try { var v = JSON.parse(localStorage.getItem(CMP_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function storeSaved(list) { try { localStorage.setItem(CMP_KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }
  function stateFromHash(h) {
    var st = { basis: "wacc" }; Object.keys(SPECS).forEach(function (k) { st[k] = SPECS[k].def; });
    String(h || "").replace(/^#/, "").split("&").forEach(function (kv) { var a = kv.split("="), k = a[0], v = decodeURIComponent(a[1] || ""); if (SPECS[k] && isFinite(parseFloat(v))) st[k] = parseFloat(v); else if (k === "basis") st.basis = v; });
    return st;
  }
  function solveHash(h) {
    if (cmpCache[h]) return cmpCache[h];
    var st = stateFromHash(h), p = { basis: st.basis }; Object.keys(SPECS).forEach(function (k) { p[k] = st[k] * (SPECS[k].scale || 1); });
    var s = M.solve(p), r = { st: st, sol: s }; cmpCache[h] = r; return r;
  }
  var savedList = loadSaved();
  $("cmpSave").addEventListener("click", function () {
    var nm = $("cmpName").value.trim() || T("Scenario {n}", { n: savedList.length + 1 });
    savedList = savedList.filter(function (x) { return x.name !== nm; }).concat([{ name: nm, hash: location.hash || "" }]).slice(-8);
    var ok = storeSaved(savedList); $("cmpName").value = ""; compare(ok ? null : T("Saved for this visit only: this browser does not allow storage."));
  });
  function compare(msg) {
    var host = $("cmpTable"), list = [{ name: T("Current"), hash: location.hash || "", current: true }].concat(savedList);
    if (savedList.length === 0) { host.innerHTML = "<p class='hint'>" + T("No saved scenarios yet.") + (msg ? " " + msg : "") + "</p>"; return; }
    var rows = list.map(function (x) { var r = solveHash(x.hash); return { x: x, st: r.st, sol: r.sol }; });
    var changed = Object.keys(SPECS).filter(function (k) { return rows.some(function (r) { return r.st[k] !== SPECS[k].def; }); });
    var keys = ["full", "best", "defer", "stage", "lease"];
    var h = "<table class='data cmp'><thead><tr><th></th>" + rows.map(function (r) { return "<th>" + esc(r.x.name) + "</th>"; }).join("") + "</tr></thead><tbody>";
    changed.forEach(function (k) { h += "<tr><td>" + esc(SPECS[k].label) + "</td>" + rows.map(function (r) { var v = r.st[k], d = v === SPECS[k].def; return "<td class='" + (d ? "dflt" : "") + "'>" + esc(SPECS[k].check ? (v ? T("yes") : T("no")) : SPECS[k].fmt(v)) + "</td>"; }).join("") + "</tr>"; });
    if (rows.some(function (r) { return r.st.basis !== "wacc"; })) h += "<tr><td>" + T("Valuation basis") + "</td>" + rows.map(function (r) { return "<td>" + (r.st.basis === "rn" ? T("risk-neutral") : "WACC") + "</td>"; }).join("") + "</tr>";
    h += "<tr class='sep'><td colspan='" + (rows.length + 1) + "'></td></tr>";
    keys.forEach(function (k) { h += "<tr><td>" + NAMES[k] + "</td>" + rows.map(function (r) { var top = keys.reduce(function (a, b) { return r.sol[b].npv > r.sol[a].npv ? b : a; }); return "<td" + (k === top ? " class='top'" : "") + ">" + money(r.sol[k].npv) + "</td>"; }).join("") + "</tr>"; });
    h += "<tr><td><b>" + T("Value of flexibility") + "</b></td>" + rows.map(function (r) { return "<td><b>" + money(flexOf(r.sol), true) + "</b></td>"; }).join("") + "</tr>";
    h += "<tr><td></td>" + rows.map(function (r, k) { return "<td class='acts'>" + (r.x.current ? "" : "<a href='" + location.pathname + esc(r.x.hash || "#") + "' data-open='" + k + "'>" + T("Open") + "</a> · ") + "<a href='" + reportHref(r.x.hash, r.x.current ? null : r.x.name) + "' target='_blank' rel='noopener'>" + T("Report") + "</a>" + (r.x.current ? "" : " · <button type='button' class='linkish' data-del='" + k + "'>" + T("Remove") + "</button>") + "</td>"; }).join("") + "</tr>";
    host.innerHTML = h + "</tbody></table>" + (msg ? "<p class='hint'>" + msg + "</p>" : "");
    host.querySelectorAll("[data-open]").forEach(function (a) { a.addEventListener("click", function (ev) { ev.preventDefault(); var r = rows[+a.getAttribute("data-open")]; history.replaceState(null, "", r.x.hash || location.pathname); var st = stateFromHash(r.x.hash); Object.keys(st).forEach(function (k) { state[k] = st[k]; }); preset = null; sync(); render(); }); });
    host.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { var nm = rows[+b.getAttribute("data-del")].x.name; savedList = savedList.filter(function (x) { return x.name !== nm; }); storeSaved(savedList); compare(); }); });
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var _render = render; render = function () { _render(); compare(); };

  readHash(); sync(); render();
})();
