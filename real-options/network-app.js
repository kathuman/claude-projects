// Real Options for Network Design — the two-region page. All valuation is done by src/network.js (window.RealNetwork).
(function () {
  "use strict";
  var NW = window.RealNetwork, C = window.ROCharts, NS = C.NS;
  var el = C.el, clear = C.clear, scale = C.scale, line = C.line, rect = C.rect, text = C.text, path = C.path, axes = C.axes, legend = C.legend, hover = C.hover, quant = C.quant;
  var $ = function (id) { return document.getElementById(id); };
  var I18 = window.ROi18n, T = I18.T, tw = I18.tw;
  $("ver").textContent = "v" + NW.VERSION; $("ver-foot").textContent = "v" + NW.VERSION;

  // control definitions and presets are shared (specs.js)
  var GROUPS = window.ROSpecs.network.GROUPS, SPECS = window.ROSpecs.network.SPECS, PRESETS = window.ROSpecs.network.PRESETS;
  var state = { basis: "wacc" }, preset = null, mapState = "none";
  Object.keys(SPECS).forEach(function (k) { state[k] = SPECS[k].def; });
  var NAMES = { central: T("Central hub"), two: T("Two hubs now"), both: T("Commit both"), pilot: T("Pilot hub"), wait: T("Wait & see network") };
  var COL = { central: "var(--s1)", two: "var(--s2)", both: "var(--s4)", pilot: "var(--s3)", wait: "var(--s5)" };

  // ---- controls
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
      el("label", { for: "n_" + s.id }, r).textContent = s.label;
      outs[s.id] = el("output", { for: "n_" + s.id }, r);
      var inp = el("input", { type: "range", id: "n_" + s.id, min: s.min, max: s.max, step: s.step }, w);
      inputs[s.id] = inp;
      if (s.hint) el("div", { class: "hint" }, w).textContent = s.hint;
      inp.addEventListener("input", function () { state[s.id] = parseFloat(inp.value); preset = null; sync(); update(); });
    });
  });
  var ph = $("presets");
  Object.keys(PRESETS).forEach(function (name) {
    var b = el("button", { type: "button", "data-preset": name }, ph); b.textContent = T(name);
    b.addEventListener("click", function () { var o = PRESETS[name]; Object.keys(SPECS).forEach(function (k) { state[k] = o[k] != null ? o[k] : SPECS[k].def; }); state.basis = "wacc"; preset = name; sync(); update(); });
  });
  document.querySelectorAll("[data-state]").forEach(function (b) { b.addEventListener("click", function () { mapState = b.getAttribute("data-state"); syncMap(); decisionMap(); }); });
  $("mapYear").addEventListener("input", function () { decisionMap(); });
  function syncMap() { document.querySelectorAll("[data-state]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-state") === mapState); }); }

  function sync() {
    if (state.window > state.life) state.window = state.life;
    Object.keys(SPECS).forEach(function (k) {
      var s = SPECS[k]; inputs[k].value = state[k]; outs[k].textContent = s.fmt(state[k]);
      rows[k].hidden = !!s.only && s.only !== state.basis;
    });
    document.querySelectorAll("[data-basis]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-basis") === state.basis); });
    document.querySelectorAll("[data-preset]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-preset") === preset); });
    var my = $("mapYear"); my.max = state.window; if (+my.value > state.window) my.value = state.window;
    writeHash();
  }
  function params(over) {
    var p = { basis: state.basis };
    Object.keys(SPECS).forEach(function (k) { p[k] = state[k] * (SPECS[k].scale || 1); });
    if (over) Object.keys(over).forEach(function (k) { p[k] = over[k]; });
    return p;
  }
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
      if (SPECS[k] && isFinite(parseFloat(v))) state[k] = Math.min(SPECS[k].max, Math.max(SPECS[k].min, parseFloat(v)));
      else if (k === "basis" && (v === "rn" || v === "wacc")) state.basis = v;
      else if (k === "preset" && PRESETS[v]) preset = v;
    });
  }

  // ---- rendering
  var sol = null, sim = null, pending = 0, bgToken = 0;
  function update() { if (!pending) pending = setTimeout(function () { pending = 0; render(); }, 30); }
  function money(v, sign) { return (sign && v > 0 ? "+" : v < 0 ? "−" : "") + "$" + Math.abs(v).toFixed(1) + "M"; }
  function bestFixedKey(s) { return s.central.npv >= s.two.npv ? "central" : "two"; }
  function bestFlexKey(s) { return s.wait.npv > s.pilot.npv + 1e-9 ? "wait" : "pilot"; }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.floor(s.length / 2)]; }
  function share(a) { return Math.round(100 * a / sim.length); }
  function render() {
    sol = NW.solve(params());
    sim = NW.simulate(sol, 1500, 13);
    var L = sol.lattice;
    var w = $("warn"); w.hidden = !L.warnings.length; w.textContent = L.warnings.map(tw).join(" ");
    headline(); scorecards(); decisionMap(); distribution();
    $("derived").innerHTML = T("Quarterly joint lattice · {n} steps", { n: L.N }) + "<br>" + T("p(A up) {a} · p(B up) {b}", { a: (L.q[0] + L.q[1]).toFixed(4), b: (L.q[0] + L.q[2]).toFixed(4) }) +
      "<br>" + T("branches uu {a} ud {b} du {c} dd {d}", { a: L.q[0].toFixed(3), b: L.q[1].toFixed(3), c: L.q[2].toFixed(3), d: L.q[3].toFixed(3) }) +
      "<br>" + T("correlation used {r} · discount {d}%/yr", { r: L.rho.toFixed(2), d: (L.r * 100).toFixed(2) });
    background(++bgToken);
  }
  function headline() {
    var bf = bestFixedKey(sol), bx = bestFlexKey(sol), f = sol[bx].npv - sol[bf].npv, h = $("headline");
    h.innerHTML = "";
    el("div", { class: "big" + (f < 0 ? " neg" : "") }, h).textContent = money(f, true);
    var what = el("div", { class: "what" }, h), fixedTxt = bf === "central" ? T("a central hub of {K}k units in region A", { K: sol.central.K.toFixed(0) }) : T("hubs of {A}k in A and {B}k in B", { A: sol.two.KA.toFixed(0), B: sol.two.KB.toFixed(0) });
    var flexTxt = bx === "pilot" ? T("Opening a hub in region {r} now and keeping the option on region {o}", { r: sol.pilot.region, o: sol.pilot.region === "A" ? "B" : "A" }) : T("Waiting and opening hubs as demand unfolds");
    if (f > 0.05) what.innerHTML = T("<b>Value of flexibility.</b> {flex} is worth {f} more than the best fixed network, {fixed}.", { flex: flexTxt, f: money(f), fixed: fixedTxt });
    else what.innerHTML = T("<b>Flexibility does not pay here.</b> The best fixed network, {fixed}, is worth {f} more than any flexible strategy.", { fixed: fixedTxt, f: money(-f) });
    what.innerHTML += ' <span id="learnNote"></span>';
  }
  function scorecards() {
    var host = $("scorecards"); host.innerHTML = "";
    var keys = ["central", "two", "both", "pilot", "wait"], top = keys.reduce(function (a, b) { return sol[b].npv > sol[a].npv + 1e-9 ? b : a; });
    var other = sol.pilot.region === "A" ? "B" : "A";
    var ps = sim.filter(function (r) { return r.pilotSecond !== null; }), ws = sim.filter(function (r) { return r.waitFirst !== null; });
    var firsts = { A: 0, B: 0, both: 0 }; ws.forEach(function (r) { firsts[r.waitFirst]++; });
    var nowFirst = ws.filter(function (r) { return r.waitFirstYear === 0; }).length;
    var desc = {
      central: T("One hub of {K}k units in A, serving B across regions.", { K: sol.central.K.toFixed(0) }),
      two: T("Hubs of {A}k in A and {B}k in B, sized together, built now.", { A: sol.two.KA.toFixed(0), B: sol.two.KB.toFixed(0) }),
      both: T("The planned hubs, {A}k in A and {B}k in B, built now.", { A: sol.KAo.toFixed(0), B: sol.KBo.toFixed(0) }),
      pilot: ps.length ? T("Hub in {r} now; hub in {o} opened on {p}% of paths, typically in year {y}.", { r: sol.pilot.region, o: other, p: share(ps.length), y: median(ps.map(function (r) { return r.pilotSecond; })).toFixed(1) }) :
        T("Hub in {r} now; hub in {o} opened on {p}% of paths.", { r: sol.pilot.region, o: other, p: share(ps.length) }),
      wait: ws.length ? T("Opens first {list}", { list: ["A", "B", "both"].filter(function (k) { return share(firsts[k]) > 0; }).map(function (k) { return k === "both" ? T("both hubs on {p}% of paths", { p: share(firsts[k]) }) : T("hub {r} on {p}% of paths", { r: k, p: share(firsts[k]) }); }).join(", ") }) +
        (nowFirst === sim.length ? T(", at once.") : (ws.length < sim.length ? T("; acts at once on {a}%, never opens on {n}%.", { a: share(nowFirst), n: share(sim.length - ws.length) }) : T("; acts at once on {a}%.", { a: share(nowFirst) }))) : T("Never opens a hub inside the window.")
    };
    keys.forEach(function (k) {
      var c = el("div", { class: "score" + (k === top ? " win" : "") }, host); c.style.borderTopColor = COL[k];
      el("div", { class: "nm" }, c).innerHTML = NAMES[k] + (k === top ? '<span class="badge">' + T("best") + '</span>' : "");
      el("div", { class: "v" }, c).textContent = money(sol[k].npv);
      el("div", { class: "d" }, c).textContent = desc[k];
    });
  }

  // the optimal move at every node of the chosen year, for the network in place
  var ACT = {
    none: [[T("wait"), "rgba(191,228,255,.10)"], [T("open hub A"), "var(--s1)"], [T("open hub B"), "var(--s2)"], [T("open both"), "var(--s3)"]],
    A: [[T("wait"), "rgba(191,228,255,.10)"], [T("open hub B"), "var(--s2)"]],
    B: [[T("wait"), "rgba(191,228,255,.10)"], [T("open hub A"), "var(--s1)"]]
  };
  function decisionMap() {
    if (!sol) return;
    var L = sol.lattice, p = sol.params, svg = $("netMap"), W = 720, H = 420, m = { l: 62, r: 14, t: 10, b: 40 };
    clear(svg);
    var yr = +$("mapYear").value; $("mapYearOut").textContent = yr;
    var t = Math.min(L.W, Math.round(yr / L.dt));
    var codes = mapState === "none" ? sol.wait.act[t] : mapState === "A" ? sol.VA.go[t] : sol.VB.go[t];
    var pr = probs(L, t), s = t + 1, Dm = sol.demand;
    // the nodes worth showing: inside the central 99.8% of each region's distribution
    var mA = new Float64Array(s), mB = new Float64Array(s);
    for (var i = 0; i <= t; i++) for (var j = 0; j <= t; j++) { mA[i] += pr[i * s + j]; mB[j] += pr[i * s + j]; }
    var rng = function (mg) { var c = 0, lo = 0, hi = t; for (var k = 0; k <= t; k++) { c += mg[k]; if (c < 0.001) lo = k + 1; } c = 0; for (k = t; k >= 0; k--) { c += mg[k]; if (c < 0.001) hi = k - 1; } return [Math.min(lo, hi), Math.max(lo, hi)]; };
    var ra = rng(mA), rb = rng(mB), nA = ra[1] - ra[0] + 1, nB = rb[1] - rb[0] + 1;
    var cw = (W - m.l - m.r) / nA, chh = (H - m.t - m.b) / nB, pmax = 0;
    for (i = ra[0]; i <= ra[1]; i++) for (j = rb[0]; j <= rb[1]; j++) pmax = Math.max(pmax, pr[i * s + j]);
    var g = el("g", {}, svg, NS), act = ACT[mapState], seen = {};
    for (i = ra[0]; i <= ra[1]; i++) for (j = rb[0]; j <= rb[1]; j++) {
      var c = codes[i * s + j], op = 0.25 + 0.75 * Math.sqrt(pr[i * s + j] / (pmax || 1)); seen[c] = true;
      el("rect", { x: (m.l + (i - ra[0]) * cw + 1).toFixed(1), y: (H - m.b - (j - rb[0] + 1) * chh + 1).toFixed(1), width: Math.max(0.5, cw - 2).toFixed(1), height: Math.max(0.5, chh - 2).toFixed(1), rx: 2, fill: act[c][1], "fill-opacity": op.toFixed(2) }, g, NS);
    }
    // axes: demand at a few node positions
    var tickN = function (lo, hi, n) { var out = []; for (var k = 0; k < n; k++) out.push(Math.round(lo + (hi - lo) * k / (n - 1))); return out.filter(function (v, k, a) { return a.indexOf(v) === k; }); };
    // (demand is capped at the market ceiling, so several rows can share a value: label each value once, at its first row)
    var once = function (ks, vals) { var seen2 = {}; return ks.filter(function (k) { var v = vals[k].toFixed(0); if (seen2[v]) return false; seen2[v] = true; return true; }); };
    once(tickN(ra[0], ra[1], 6), Dm.a[t]).forEach(function (i2) { text(svg, m.l + (i2 - ra[0] + 0.5) * cw, H - m.b + 15, Dm.a[t][i2].toFixed(0), { "text-anchor": "middle" }); });
    once(tickN(rb[0], rb[1], 6), Dm.b[t]).forEach(function (j2) { text(svg, m.l - 6, H - m.b - (j2 - rb[0] + 0.5) * chh + 4, Dm.b[t][j2].toFixed(0), { "text-anchor": "end" }); });
    text(svg, (m.l + W - m.r) / 2, H - 6, T("region A demand in year {y}, k units/yr", { y: (t * L.dt).toFixed(2).replace(/\.?0+$/, "") }), { "text-anchor": "middle" });
    var my = (m.t + H - m.b) / 2; text(svg, 14, my, T("region B demand, k units/yr"), { "text-anchor": "middle", transform: "rotate(-90 14 " + my + ")" });
    legend($("netMapLegend"), act.map(function (a, k) { return ["band", a[1], a[0]]; }));
    // where demand is today, for reference
    var cap = { none: T("With no hub yet"), A: T("With hub A open"), B: T("With hub B open") }[mapState];
    var counts = act.map(function () { return 0; }); var tot = 0;
    for (i = 0; i <= t; i++) for (j = 0; j <= t; j++) { counts[codes[i * s + j]] += pr[i * s + j]; tot += pr[i * s + j]; }
    $("netMapCaption").textContent = T("{state}, in year {y}: {list}.", { state: cap, y: (t * L.dt).toFixed(2).replace(/\.?0+$/, ""), list: act.map(function (a, k) { return T("{act} in {p}% of outcomes", { act: a[0], p: Math.round(100 * counts[k] / tot) }); }).join(", ") }) + " " +
      T("(Reached only if nothing was done before; moves are possible inside the decision window, until year {w}.)", { w: Math.min(p.window, p.life) });
    hover(svg, { l: m.l, r: m.r, t: m.t, b: m.b }, W, H, function (mx, my2) {
      var i2 = ra[0] + Math.floor((mx - m.l) / cw), j2 = rb[0] + Math.floor((H - m.b - my2) / chh);
      if (i2 < ra[0] || i2 > ra[1] || j2 < rb[0] || j2 > rb[1]) return null;
      return { html: "<b>" + act[codes[i2 * s + j2]][0] + "</b><br>" + T("region A {a}k · region B {b}k", { a: Dm.a[t][i2].toFixed(0), b: Dm.b[t][j2].toFixed(0) }) + "<br>" + T("probability {p}%", { p: (pr[i2 * s + j2] * 100).toFixed(2) }) };
    });
  }
  // node probabilities at step t (forward from today)
  function probs(L, t) {
    var cur = new Float64Array([1]), q = L.q;
    for (var k = 0; k < t; k++) {
      var s = k + 1, ns = k + 2, nx = new Float64Array(ns * ns);
      for (var i = 0; i <= k; i++) for (var j = 0; j <= k; j++) { var v = cur[i * s + j]; if (!v) continue; nx[(i + 1) * ns + j + 1] += v * q[0]; nx[(i + 1) * ns + j] += v * q[1]; nx[i * ns + j + 1] += v * q[2]; nx[i * ns + j] += v * q[3]; }
      cur = nx;
    }
    return cur;
  }

  function distribution() {
    var svg = $("netDist"), W = 360, H = 300, m = { l: 46, r: 10, t: 10, b: 34 }; clear(svg);
    var fk = bestFixedKey(sol), xk = bestFlexKey(sol), keys = [fk, xk];
    var A = sim.map(function (r) { return r[fk]; }), B = sim.map(function (r) { return r[xk]; });
    var lo = Math.min(quant(A, 0.005), quant(B, 0.005)), hi = Math.max(quant(A, 0.995), quant(B, 0.995)), nb = 28, bw = (hi - lo) / nb || 1;
    var hist = function (a) { var h = new Array(nb).fill(0); a.forEach(function (v) { var b = Math.floor((v - lo) / bw); if (b >= 0 && b < nb) h[b]++; }); return h.map(function (c) { return c / a.length; }); };
    var hA = hist(A), hB = hist(B), ymax = Math.max.apply(null, hA.concat(hB)) * 1.1 || 1;
    var x = scale(lo, hi, m.l, W - m.r), y = scale(0, ymax, H - m.b, m.t);
    axes(svg, x, y, W, H, m, null, null, T("NPV $M"), T("share of paths"), function (v) { return Math.round(v * 100) + "%"; });
    if (lo < 0 && hi > 0) line(svg, x(0), m.t, x(0), H - m.b, { stroke: "var(--ink-faint)" });
    [[hA, fk], [hB, xk]].forEach(function (pair) {
      var d = "M" + x(lo) + "," + y(0);
      pair[0].forEach(function (v, i) { d += "L" + x(lo + i * bw) + "," + y(v) + "L" + x(lo + (i + 1) * bw) + "," + y(v); });
      el("path", { d: d + "L" + x(hi) + "," + y(0), fill: COL[pair[1]], "fill-opacity": 0.18, stroke: COL[pair[1]], "stroke-width": 2 }, svg, NS);
    });
    legend($("netDistLegend"), keys.map(function (k) { return ["band", COL[k], NAMES[k]]; }));
    var mean = function (a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; };
    var st = function (a) { return T("mean {m}, 5th percentile {p5}, P(loss) {pl}%", { m: money(mean(a)), p5: money(quant(a, 0.05)), pl: Math.round(100 * a.filter(function (v) { return v < 0; }).length / a.length) }); };
    $("netDistCaption").innerHTML = "<b>" + NAMES[fk] + "</b>: " + st(A) + ".<br><b>" + NAMES[xk] + "</b>: " + st(B) + ".";
    hover(svg, m, W, H, function (mx) {
      var b = Math.floor((x.inv(mx) - lo) / bw); if (b < 0 || b >= nb) return null;
      return { html: "<b>" + T("{a} to {b}", { a: money(lo + b * bw), b: money(lo + (b + 1) * bw) }) + "</b><br>" + NAMES[fk] + ": " + (hA[b] * 100).toFixed(1) + "%<br>" + NAMES[xk] + ": " + (hB[b] * 100).toFixed(1) + "%", x: x(lo + (b + 0.5) * bw) };
    });
  }

  // ---- background: the correlation sweep, and the value of the second-hub saving
  var RHOS = [-0.6, -0.3, 0, 0.3, 0.6, 0.9];
  function background(token) {
    var jobs = [], res = [];
    jobs.push(function () {
      var s0 = NW.solve(params({ learn: 0 })), k = bestFlexKey(sol), note = $("learnNote");
      if (note && sol.params.learn > 0) note.textContent = T("The second-hub saving is worth {v} to the {name} strategy.", { v: money(sol[k].npv - s0[k].npv), name: NAMES[k].toLowerCase() });
    });
    RHOS.forEach(function (r) { jobs.push(function () { var s = NW.solve(params({ rho: r })); res.push({ rho: s.lattice.rho, set: r, central: s.central.npv, two: s.two.npv, pilot: s.pilot.npv, wait: s.wait.npv }); }); });
    (function step() {
      if (token !== bgToken) return;
      var job = jobs.shift(); if (job) job();
      if (!jobs.length) { rhoChart(res); return; }
      setTimeout(step, 0);
    })();
  }
  function rhoChart(res) {
    var svg = $("rhoChart"), W = 360, H = 300, m = { l: 46, r: 10, t: 10, b: 34 }, keys = ["central", "two", "pilot", "wait"]; clear(svg);
    var vals = []; res.forEach(function (r) { keys.forEach(function (k) { vals.push(r[k]); }); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.1 || 1;
    var x = scale(-0.7, 1, m.l, W - m.r), y = scale(lo - pad, hi + pad, H - m.b, m.t);
    axes(svg, x, y, W, H, m, null, null, T("correlation between regions"), T("NPV $M"), null, function (v) { return v.toFixed(1); });
    line(svg, x(sol.params.rho), m.t, x(sol.params.rho), H - m.b, { stroke: "var(--accent)", "stroke-dasharray": "4 4" });
    keys.forEach(function (k) {
      path(svg, res.map(function (r) { return [x(r.set), y(r[k])]; }), { stroke: COL[k], "stroke-width": 2, fill: "none", "stroke-dasharray": k === "wait" ? "5 4" : null });
      res.forEach(function (r) { el("circle", { cx: x(r.set), cy: y(r[k]), r: 4, fill: COL[k], stroke: "var(--panel)", "stroke-width": 2 }, svg, NS); });
    });
    legend($("rhoLegend"), keys.map(function (k) { return [k === "wait" ? "dash" : "line", COL[k], NAMES[k]]; }).concat([["dash", "var(--accent)", T("your setting")]]));
    var cross = null; for (var k2 = 1; k2 < res.length; k2++) if ((res[k2 - 1].central - res[k2 - 1].two) * (res[k2].central - res[k2].two) < 0) cross = res[k2];
    $("rhoCaption").textContent = cross ? T("A central hub beats two regional hubs while the correlation is low; above about {r} regional hubs are worth more.", { r: cross.set.toFixed(1) }) :
      (res[0].central > res[0].two ? T("A central hub beats two regional hubs at every correlation here.") : T("Two regional hubs beat a central hub at every correlation here: shipping between regions costs too much for pooling to pay."));
    $("rhoTable").innerHTML = "<table class='data'><tr><th>" + T("Correlation") + "</th>" + keys.map(function (k) { return "<th>" + NAMES[k].replace("&", "&amp;") + "</th>"; }).join("") + "</tr>" +
      res.map(function (r) { return "<tr><td>" + r.set.toFixed(1) + (Math.abs(r.rho - r.set) > 0.005 ? " (" + r.rho.toFixed(2) + ")" : "") + "</td>" + keys.map(function (k) { return "<td>" + money(r[k]) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table>";
    hover(svg, m, W, H, function (mx) {
      var r = res.reduce(function (a, b) { return Math.abs(x(b.set) - mx) < Math.abs(x(a.set) - mx) ? b : a; });
      return { html: "<b>" + T("Correlation {r}", { r: r.set.toFixed(1) }) + "</b><br>" + keys.map(function (k) { return NAMES[k] + ": " + money(r[k]); }).join("<br>"), x: x(r.set) };
    });
  }

  // ---- an interface for the tutorial and the calibration panel (values in the units shown)
  function set(shown, opts) {
    opts = opts || {};
    if (opts.reset !== false) Object.keys(SPECS).forEach(function (k) { state[k] = SPECS[k].def; });
    Object.keys(shown || {}).forEach(function (k) { if (SPECS[k]) state[k] = shown[k]; });
    state.basis = opts.basis || (opts.reset !== false ? "wacc" : state.basis);
    preset = opts.preset || null;
    if (opts.mapState) { mapState = opts.mapState; syncMap(); }
    if (opts.mapYear != null) $("mapYear").value = opts.mapYear;
    sync(); render();
  }
  window.RONet = { set: set, state: function () { return JSON.parse(JSON.stringify(state)); }, solution: function () { return sol; }, specs: SPECS, names: NAMES };
  window.ROCalibUI.mount($("calib"), ["A", "B"].map(function (r) {
    return { label: T("Apply to region {r}", { r: r }), name: T("region {r}", { r: r }), apply: function (est) {
      var a = window.ROCalibUI.snap(SPECS["D" + r], est.D0, T("Demand today")), b = window.ROCalibUI.snap(SPECS["sig" + r], est.sigma, T("Volatility")), c = window.ROCalibUI.snap(SPECS["g" + r], est.g, T("Growth"));
      var o = {}; o["D" + r] = a.value; o["sig" + r] = b.value; o["g" + r] = c.value; set(o, { reset: false });
      return [a.note, b.note, c.note].filter(Boolean);
    } };
  }));

  readHash(); syncMap(); sync(); render();
})();
