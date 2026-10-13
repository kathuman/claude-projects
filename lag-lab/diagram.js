// Lag Lab — the stock-and-flow diagram of the model and its equations. Stocks are boxes, flows are valves on pipes,
// auxiliaries are circles, clouds are the model's boundary. Information links (curved arrows) are drawn from each
// equation's own references, so the diagram cannot show a link the equations do not have. Click any variable for its
// equation, its inputs and their values at a chosen week of your plan's run.
(function () {
  "use strict";
  var EQ = window.LagEquations, L = window.LagLab, $ = function (id) { return document.getElementById(id); };
  var I18 = window.ROi18n, T = I18.T;
  // in Spanish, the variables' names, units, equations and meanings come from the overlay in i18n-es.js (same ids,
  // same {references}: the tests check that the arrows drawn from the equations cannot change)
  var OV = I18.lang === "es" && window.LL_ES ? window.LL_ES.EQ : null;
  if (OV) {
    EQ.VARS.forEach(function (v) { var o = OV.vars[v.id]; if (!o) return; ["name", "units", "init", "about"].forEach(function (k) { if (o[k] != null) v[k] = o[k]; });
      if (o.eq != null) v.eq = typeof o.eq === "function" ? o.eq : o.eq; if (o.alt != null) v.alt = o.alt; });
    EQ.PARAMS.forEach(function (q) { var o = OV.params[q[0]]; if (o) { q[1] = o[0]; q[2] = o[1]; } });
    Object.keys(OV.labels).forEach(function (k) { EQ.PARAM_LABEL[k] = OV.labels[k]; });
  }
  var NS = "http://www.w3.org/2000/svg";
  var W = 1240, H = 800, BOX = { w: 132, h: 52 };

  // positions (centres) for every variable, and the clouds at the boundary
  var POS = {
    forecastChange: [170, 70], expectedDemand: [310, 70],
    demand: [590, 70], backlog: [790, 70], shipments: [1000, 155],
    starts: [165, 245], supplyLine: [360, 245], completions: [565, 245], inventory: [790, 245],
    utilisation: [80, 335], desiredStarts: [255, 375], desiredSupplyLine: [470, 335], desiredInventory: [905, 330],
    capacity: [95, 470], desiredWorkforce: [560, 440], desiredHiring: [410, 525], desiredVacancies: [225, 545], effectiveWorkforce: [790, 530],
    vacancyCreation: [150, 655], vacancies: [300, 655], hires: [460, 655], trainees: [620, 655], graduations: [780, 655], workforce: [950, 655],
    attrition: [1095, 605], layoffs: [1095, 710], vacancyCancellation: [300, 735]
  };
  // valves on vertical pipes carry their label beside them
  var SIDE_LABEL = { vacancyCancellation: true };
  var CLOUDS = { fc: [45, 70], ord: [470, 70], out: [1170, 155], st: [40, 245], vc: [40, 655], at: [1195, 605], lo: [1195, 710], vx: [300, 785] };
  // material pipes: [from, to]; stocks and clouds at the ends, valves in between
  var PIPES = [["c:fc", "forecastChange"], ["forecastChange", "expectedDemand"],
    ["c:ord", "demand"], ["demand", "backlog"], ["backlog", "shipments"], ["inventory", "shipments"], ["shipments", "c:out"],
    ["c:st", "starts"], ["starts", "supplyLine"], ["supplyLine", "completions"], ["completions", "inventory"],
    ["c:vc", "vacancyCreation"], ["vacancyCreation", "vacancies"], ["vacancies", "hires"], ["hires", "trainees"], ["trainees", "graduations"], ["graduations", "workforce"],
    ["workforce", "attrition"], ["attrition", "c:at"], ["workforce", "layoffs"], ["layoffs", "c:lo"], ["vacancies", "vacancyCancellation"], ["vacancyCancellation", "c:vx"]];

  var host = $("diagram"), svg, nodes = {}, links = [], selected = null, week = 16;

  function el(name, attrs, parent) { var e = document.createElementNS(NS, name); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (parent) parent.appendChild(e); return e; }
  function kindOf(id) { return id.indexOf("c:") === 0 ? "cloud" : EQ.BY_ID[id].kind; }
  function pt(id) { return id.indexOf("c:") === 0 ? CLOUDS[id.slice(2)] : POS[id]; }
  // where a line from (x0,y0) toward a node's centre meets the node's edge
  function edge(id, x0, y0) {
    var c = pt(id), k = kindOf(id), dx = x0 - c[0], dy = y0 - c[1], d = Math.hypot(dx, dy) || 1;
    if (k === "stock") { var sx = (BOX.w / 2) / Math.abs(dx || 1e-9), sy = (BOX.h / 2) / Math.abs(dy || 1e-9), s = Math.min(sx, sy); return [c[0] + dx * s, c[1] + dy * s]; }
    var r = k === "cloud" ? 16 : k === "aux" ? 9 : 12;
    return [c[0] + dx / d * r, c[1] + dy / d * r];
  }
  function wrap(name) {
    if (name.length <= 13) return [name];
    var w = name.split(" "), best = [name], diff = Infinity;
    for (var i = 1; i < w.length; i++) { var a = w.slice(0, i).join(" "), b = w.slice(i).join(" "), d = Math.abs(a.length - b.length); if (d < diff) { diff = d; best = [a, b]; } }
    return best;
  }

  function build() {
    var p = window.lagLab.params();
    host.innerHTML = "";
    svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": T("Stock-and-flow diagram of the Lag Lab model") }, host);
    var defs = el("defs", {}, svg);
    [["ar-info", "#6fa8c9"], ["ar-in", "#7dd3fc"], ["ar-out", "#e0558f"], ["ar-pipe", "#bfe4ff"]].forEach(function (m) {
      var mk = el("marker", { id: m[0], viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
      el("path", { d: "M0,0 L10,5 L0,10 z", fill: m[1] }, mk);
    });
    var gPipes = el("g", { "class": "pipes" }, svg), gLinks = el("g", { "class": "links" }, svg), gNodes = el("g", { "class": "nodes" }, svg);
    // pipes: a wide pale stroke with a dark core, so they read as pipes, with an arrow into the receiving end
    PIPES.forEach(function (pp) {
      var a = pt(pp[0]), b = pt(pp[1]), s = edge(pp[0], b[0], b[1]), e = edge(pp[1], a[0], a[1]);
      el("line", { x1: s[0], y1: s[1], x2: e[0], y2: e[1], stroke: "#bfe4ff", "stroke-width": 7, "stroke-linecap": "butt" }, gPipes);
      el("line", { x1: s[0], y1: s[1], x2: e[0], y2: e[1], stroke: "#0d3a63", "stroke-width": 3 }, gPipes);
      var into = kindOf(pp[1]);
      if (into === "stock" || into === "cloud") el("line", { x1: e[0] - (e[0] - s[0]) * 0.001, y1: e[1] - (e[1] - s[1]) * 0.001, x2: e[0], y2: e[1], stroke: "#bfe4ff", "stroke-width": 2, "marker-end": "url(#ar-pipe)" }, gPipes);
    });
    // information links, from the equations themselves
    links = [];
    EQ.VARS.forEach(function (v) {
      if (v.kind === "stock") return;
      EQ.inputs(v.id, p).forEach(function (u, k) {
        var a = POS[u], b = POS[v.id]; if (!a || !b) return;
        var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        var bend = (k % 2 ? -1 : 1) * Math.min(60, 0.16 * len), cx = mx - dy / len * bend, cy = my + dx / len * bend;
        var s = edge(u, cx, cy), e = edge(v.id, cx, cy);
        var path = el("path", { d: "M" + s[0].toFixed(1) + "," + s[1].toFixed(1) + " Q" + cx.toFixed(1) + "," + cy.toFixed(1) + " " + e[0].toFixed(1) + "," + e[1].toFixed(1), fill: "none", stroke: "#6fa8c9", "stroke-width": 1.2, "marker-end": "url(#ar-info)", "class": "link" }, gLinks);
        links.push({ from: u, to: v.id, el: path });
      });
    });
    // clouds
    Object.keys(CLOUDS).forEach(function (k) {
      var c = CLOUDS[k];
      el("path", { d: "M" + (c[0] - 14) + "," + (c[1] + 6) + " a7,7 0 0,1 4,-12 a8,8 0 0,1 14,-3 a7,7 0 0,1 12,6 a6,6 0 0,1 -2,9 z", fill: "#0b3459", stroke: "#6fa8c9", "stroke-width": 1.2 }, gNodes);
    });
    // nodes
    nodes = {};
    EQ.VARS.forEach(function (v) {
      var c = POS[v.id]; if (!c) return;
      var g = el("g", { "class": "node " + v.kind, tabindex: 0, role: "button", "aria-label": T("{name} ({kind}): show its equation", { name: v.name, kind: kindName(v.kind) }), "data-id": v.id }, gNodes);
      var lines = wrap(v.name);
      if (v.kind === "stock") {
        el("rect", { x: c[0] - BOX.w / 2, y: c[1] - BOX.h / 2, width: BOX.w, height: BOX.h, rx: 4, "class": "shape" }, g);
        lines.forEach(function (ln, i) { var t = el("text", { x: c[0], y: c[1] + 5 + (i - (lines.length - 1) / 2) * 15, "text-anchor": "middle", "class": "label stock-label" }, g); t.textContent = ln; });
      } else {
        var flowish = v.kind === "flow" || v.kind === "exo";
        if (flowish) {
          // a valve: an hourglass on the pipe with a circle (the rate) above it
          el("path", { d: "M" + (c[0] - 9) + "," + (c[1] - 7) + " L" + (c[0] + 9) + "," + (c[1] + 7) + " L" + (c[0] + 9) + "," + (c[1] - 7) + " L" + (c[0] - 9) + "," + (c[1] + 7) + " z", "class": "shape valve" }, g);
          el("circle", { cx: c[0], cy: c[1], r: 4.5, "class": "shape knob" }, g);
        } else el("circle", { cx: c[0], cy: c[1], r: 8, "class": "shape" }, g);
        var below = flowish ? 24 : 22, side = SIDE_LABEL[v.id];
        lines.forEach(function (ln, i) {
          var t = side ? el("text", { x: c[0] + 16, y: c[1] - 2 + i * 13, "text-anchor": "start", "class": "label" }, g)
            : el("text", { x: c[0], y: c[1] + below + i * 13, "text-anchor": "middle", "class": "label" }, g);
          t.textContent = ln;
        });
        el("circle", { cx: c[0], cy: c[1], r: 18, fill: "transparent" }, g);   // a bigger target to click
      }
      g.addEventListener("click", function () { select(v.id); });
      g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(v.id); } });
      g.addEventListener("mouseenter", function () { if (!selected) highlight(v.id); });
      g.addEventListener("mouseleave", function () { if (!selected) highlight(null); });
      nodes[v.id] = g;
    });
    highlight(selected);
  }
  function kindName(k) { return { stock: T("stock"), flow: T("flow"), aux: T("auxiliary"), exo: T("input") }[k]; }

  function highlight(id) {
    var ins = {}, outs = {};
    links.forEach(function (l) { if (l.to === id) ins[l.from] = 1; if (l.from === id) outs[l.to] = 1; });
    PIPES.forEach(function (pp) { if (pp[1] === id) ins[pp[0]] = 1; if (pp[0] === id) outs[pp[1]] = 1; });
    Object.keys(nodes).forEach(function (k) {
      var g = nodes[k]; g.classList.toggle("sel", k === id); g.classList.toggle("dim", !!id && k !== id && !ins[k] && !outs[k]);
      g.classList.toggle("in", !!ins[k]); g.classList.toggle("out", !!outs[k]);
    });
    links.forEach(function (l) {
      var isIn = l.to === id, isOut = l.from === id;
      l.el.setAttribute("stroke", isIn ? "#7dd3fc" : isOut ? "#e0558f" : "#6fa8c9");
      l.el.setAttribute("stroke-width", isIn || isOut ? 2.2 : 1.2);
      l.el.setAttribute("marker-end", "url(#" + (isIn ? "ar-in" : isOut ? "ar-out" : "ar-info") + ")");
      l.el.style.opacity = id && !isIn && !isOut ? 0.12 : 1;
      if (isIn || isOut) l.el.parentNode.appendChild(l.el);
    });
  }

  // ---- the equation panel
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  // the parameters that are choices show their value in the page's language
  var CHOICE = { capacity: T("capacity"), inventory: T("inventory"), smooth: T("smooth"), perfect: T("perfect") };
  function fmtParam(p, key) {
    var v = EQ.paramValue(p, key);
    if (typeof v === "string" && CHOICE[v]) return CHOICE[v];
    if (key === "demand.size") return (v > 0 ? "+" : "") + Math.round(v * 100) + "%";
    return typeof v === "number" ? String(+v.toFixed(4)) : String(v);
  }
  function render(text, p) {
    return esc(text).replace(/\{p:([a-zA-Z.]+)\}/g, function (_, k) {
      var meta = EQ.PARAMS.filter(function (q) { return q[0] === k; })[0];
      return '<span class="pref" title="' + esc((meta ? meta[1] : k) + " = " + fmtParam(p, k) + (meta ? " " + meta[2] : "")) + '">' + esc(EQ.PARAM_LABEL[k] || k) + "</span>";
    }).replace(/\{([a-zA-Z]+)\}/g, function (_, id) {
      var v = EQ.BY_ID[id]; return v ? '<button type="button" class="vref ' + v.kind + '" data-id="' + id + '">' + esc(v.name) + "</button>" : id;
    });
  }
  function valueAt(id, run, i, p) {
    var v = EQ.BY_ID[id];
    if (v.series) return run[v.series][i];
    if (id === "forecastChange") return p.forecast === "perfect" ? null : (run.demand[i] - run.expectedDemand[i]) / p.forecastTime;
    return null;
  }
  function num(x, u) { if (x == null || !isFinite(x)) return "–"; var a = Math.abs(x); return (a >= 100 ? x.toFixed(1) : a >= 1 ? x.toFixed(2) : x.toFixed(3)) + (u ? ' <span class="u">' + esc(u) + "</span>" : ""); }

  function panel() {
    var box = $("eq-panel"), d = window.lagLab.last(), p = window.lagLab.params();
    if (!selected || !d) { box.innerHTML = '<p class="muted">' + T("Click any stock, flow or auxiliary in the diagram, or any name in the equation list below, to see its equation, what it reads, what reads it, and the values at a chosen week of your plan.") + "</p>"; return; }
    var v = EQ.BY_ID[selected], run = d.runs.a, idx = Math.max(0, Math.min(run.t.length - 1, Math.round(week)));
    var ins = EQ.inputs(v.id, p), usedBy = EQ.VARS.filter(function (u) { return u.kind !== "stock" && EQ.inputs(u.id, p).indexOf(v.id) >= 0; }).map(function (u) { return u.id; });
    if (v.kind !== "stock") PIPES.forEach(function (pp) { if (pp[0] === v.id && EQ.BY_ID[pp[1]] && EQ.BY_ID[pp[1]].kind === "stock") usedBy.push(pp[1]); });
    var h = '<div class="eq-kind ' + v.kind + '">' + kindName(v.kind) + '</div><h3>' + esc(v.name) + ' <span class="u">' + esc(v.units) + "</span></h3>";
    h += '<div class="eq">' + render(EQ.equation(v, p), p) + "</div>";
    if (v.init) h += '<div class="eq-init">' + T("Initial value: {v} (the model starts in equilibrium)", { v: render(v.init, p) }) + "</div>";
    if (v.alt) h += '<div class="eq-init">' + render(v.alt(p), p) + "</div>";
    h += '<p class="about">' + render(v.about, p) + "</p>";
    h = '<div class="eq-cols"><div>' + h + '</div><div>';
    h += '<div class="wk"><label for="eq-week">' + T("Values in your plan at week <b>{n}</b>", { n: idx }) + '</label><input type="range" id="eq-week" min="0" max="' + (run.t.length - 1) + '" step="1" value="' + idx + '" /></div>';
    h += '<table class="eqvals"><tr><td>' + esc(v.name) + "</td><td>" + num(valueAt(v.id, run, idx, p), v.units) + "</td></tr>";
    if (v.kind === "stock" && idx + 1 < run.t.length) h += '<tr><td class="muted">' + T("change over the next week") + "</td><td>" + num(valueAt(v.id, run, idx + 1, p) - valueAt(v.id, run, idx, p), v.units) + "</td></tr>";
    h += "</table>";
    if (ins.length) h += '<h4>' + (v.kind === "stock" ? T("Flows in and out") : T("Reads")) + '</h4><table class="eqvals">' + ins.map(function (u) { var w = EQ.BY_ID[u]; return '<tr><td><button type="button" class="vref ' + w.kind + '" data-id="' + u + '">' + esc(w.name) + "</button></td><td>" + num(valueAt(u, run, idx, p), w.units) + "</td></tr>"; }).join("") + "</table>";
    var prm = EQ.params(v.id, p);
    if (prm.length) h += "<h4>" + T("Parameters") + "</h4><table class=\"eqvals\">" + prm.map(function (k) { var meta = EQ.PARAMS.filter(function (q) { return q[0] === k; })[0] || [k, k, ""]; return "<tr><td>" + esc(meta[1]) + ' <span class="muted">(' + esc(EQ.PARAM_LABEL[k] || k) + ")</span></td><td>" + esc(fmtParam(p, k)) + ' <span class="u">' + esc(meta[2]) + "</span></td></tr>"; }).join("") + "</table>";
    if (usedBy.length) h += "<h4>" + T("Read by") + "</h4><p>" + usedBy.map(function (u) { var w = EQ.BY_ID[u]; return '<button type="button" class="vref ' + w.kind + '" data-id="' + u + '">' + esc(w.name) + "</button>"; }).join(" ") + "</p>";
    box.innerHTML = h + "</div></div>";
    $("eq-week").addEventListener("input", function () { week = +this.value; panel(); var w2 = $("eq-week"); if (w2) w2.focus(); });
  }

  function select(id) {
    selected = selected === id ? null : id;
    highlight(selected); panel(); list();
    // the equation is shown just below the diagram: bring it into view if it is off screen
    if (selected) { var r = $("eq-panel").getBoundingClientRect(); if (r.top > innerHeight - 120 || r.bottom < 80) $("eq-panel").scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  }

  // ---- every equation, grouped, and the parameters with their current values
  function list() {
    var p = window.lagLab.params(), groups = [[T("Stocks"), "stock"], [T("Flows"), "flow"], [T("Auxiliaries"), "aux"], [T("Input"), "exo"]];
    var h = groups.map(function (g) {
      var vs = EQ.VARS.filter(function (v) { return v.kind === g[1]; });
      return "<h4>" + g[0] + '</h4><table class="eqlist">' + vs.map(function (v) {
        return '<tr class="' + (v.id === selected ? "sel" : "") + '"><td><button type="button" class="vref ' + v.kind + '" data-id="' + v.id + '">' + esc(v.name) + '</button><div class="u">' + esc(v.units) + "</div></td><td>" + render(EQ.equation(v, p), p) + (v.init ? '<div class="u">' + T("initial: {v}", { v: render(v.init, p) }) + "</div>" : "") + "</td></tr>";
      }).join("") + "</table>";
    }).join("");
    h += "<h4>" + T("Parameters (current values)") + '</h4><table class="eqlist params">' + EQ.PARAMS.map(function (q) {
      return "<tr><td>" + esc(q[1]) + ' <span class="muted">' + esc(EQ.PARAM_LABEL[q[0]] || "") + "</span></td><td>" + esc(fmtParam(p, q[0])) + ' <span class="u">' + esc(q[2]) + "</span></td></tr>";
    }).join("") + "</table>";
    $("eq-list").innerHTML = h;
  }

  // clicks on any variable name in the panel or the list select it in the diagram
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".vref"); if (!b || !$("view-model").contains(b)) return;
    selected = null; select(b.dataset.id);
    if (e.target.closest("#eq-list")) host.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  window.addEventListener("laglab:update", function () { if (!$("view-model").hidden) { build(); panel(); list(); } else dirty = true; });
  var dirty = true;
  window.lagDiagram = {
    show: function () { if (dirty || !svg) { build(); dirty = false; } panel(); list(); },
    select: function (id) { selected = null; select(id); }, selected: function () { return selected; }
  };
})();
