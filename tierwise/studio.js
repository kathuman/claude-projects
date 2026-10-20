// Tierwise — the Network Studio (window.TWStudio): the network drawn by tiers, edited in place. Columns run from the raw
// ingredient on the left to the consumption points on the right; shapes tell production sites (squares), warehouses
// (hexagons) and consumption points (pills) apart, and arrows are the transport routes. Modes: select and move, add a
// site, connect two sites, delete. An inspector edits the selected site or route, including custom parameters; a
// parameters manager defines them. The same network can be shown on a world map instead (zoom, pan, great-circle
// routes), edited with the same modes: there a site is moved by dragging it to its new place. Every change goes through
// Tierwise.api.edit (undo, re-plan, redraw).
(function () {
  "use strict";
  var APP = window.Tierwise, G = window.TWGraph, P = window.TWPlan, GEO = window.TWGeo, I = window.TWi18n, T = I.T;
  if (!APP || !G) return;
  var A = APP.api, H = A.h, SVGNS = "http://www.w3.org/2000/svg";
  var ORDER = P.TIERS.slice().reverse().map(function (t) { return t.id; });   // raw … market, left to right
  var W = 1240, COLW = W / 6, NW = 160, NH = 40, ROW = 54, TOP = 52;
  var CAT = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"];
  var DASH = { road: null, sea: "7 4", rail: "12 3 2 3", air: "2 4" };
  var st = function () { return APP.state.studio; };
  var drag = null, tipEl = null, active = false;
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, parent) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function esc(s) { return H.esc(s); }
  function net() { return APP.state.net; }
  function colX(tier) { return COLW * (ORDER.indexOf(tier) + 0.5); }
  function roleOf(tier) { return G.role(tier); }

  // ---- layout: x by tier, y by the column's order
  function layout() {
    var cols = G.columns(net()), pos = {}, rows = 0;
    ORDER.forEach(function (t) { cols[t].forEach(function (id, i) { pos[id] = { x: colX(t), y: TOP + 24 + i * ROW, i: i }; }); rows = Math.max(rows, cols[t].length); });
    return { cols: cols, pos: pos, H: TOP + 24 + Math.max(1, rows) * ROW + 30 };
  }
  // ---- the colour a site gets: its tier, its status in the plan, or a custom parameter's value
  function colourMode() { return st().colorBy || "tier"; }
  function paramDef() { var k = colourMode(); if (k.indexOf("p:") !== 0) return null; return G.params(net(), "sites").filter(function (d) { return d.key === k.slice(2); })[0] || null; }
  function valueColour(def, v, all) {
    if (v == null) return null;
    if (def.type === "bool") return v ? "#1baf7a" : "#7f93a8";
    if (def.type === "number") { var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), f = hi > lo ? (v - lo) / (hi - lo) : 0.5; return ["#1d4a78", "#2f6aa8", "#5b93cc", "#8fb6dd", "#c6dbef"][Math.min(4, Math.floor(f * 5))]; }
    var opts = def.type === "choice" ? def.options : all.filter(function (x, i) { return all.indexOf(x) === i; });
    var i = opts.indexOf(v); return i >= 0 && i < 6 ? CAT[i] : "#7f93a8";
  }
  function siteFill(s, def, all) {
    var mode = colourMode(), vw = A.view(), r = vw && vw.sites ? vw.sites[s.id] : null;
    if (mode === "status" && r) {
      if (s.tier === "market") return A.cap() ? (r.fill < 0.999 ? "#8a2d2d" : "#14523c") : "#16324f";
      var u = r.peakUtil; return A.cap() ? (r.firstBinding >= 0 ? "#6b5214" : "#14523c") : u > 1 + 1e-9 ? "#8a2d2d" : u >= 0.9 ? "#6b5214" : "#14523c";
    }
    if (def) { var c = valueColour(def, s.custom ? s.custom[def.key] : null, all); return c ? shade(c) : "#0b2846"; }
    return "#0d3a63";
  }
  function shade(hex) { var n = parseInt(hex.slice(1), 16), r = n >> 16, g = n >> 8 & 255, b = n & 255, f = 0.45; return "rgb(" + Math.round(r * f + 8 * (1 - f)) + "," + Math.round(g * f + 36 * (1 - f)) + "," + Math.round(b * f + 68 * (1 - f)) + ")"; }
  function dims(kind) { var h = st().highlight || "all"; if (h === "all") return false; if (h === "routes") return kind !== "route"; return kind !== h; }

  // ---- drawing
  function shape(g, s, p, fill, stroke, sw) {
    var x = p.x - NW / 2, y = p.y - NH / 2, role = roleOf(s.tier);
    if (role === "warehouse") { var k = 12; el("path", { d: "M" + (x + k) + "," + y + "H" + (x + NW - k) + "L" + (x + NW) + "," + p.y + "L" + (x + NW - k) + "," + (y + NH) + "H" + (x + k) + "L" + x + "," + p.y + "Z", fill: fill, stroke: stroke, "stroke-width": sw, "class": "n-shape" }, g); }
    else if (role === "consumption") el("rect", { x: x, y: y, width: NW, height: NH, rx: NH / 2, fill: fill, stroke: stroke, "stroke-width": sw, "class": "n-shape" }, g);
    else { el("rect", { x: x, y: y, width: NW, height: NH, rx: 3, fill: fill, stroke: stroke, "stroke-width": sw, "class": "n-shape" }, g); el("rect", { x: x, y: y, width: 6, height: NH, fill: stroke, "class": "n-bar" }, g); }
  }
  function metric(s) {
    var vw = A.view(), r = vw && vw.sites ? vw.sites[s.id] : null;
    if (s.tier === "market") return H.fq(s.base * (APP.state.net.config.demandScale || 1)) + " " + H.unitOf(s) + T("/mo");
    var t = H.fq(s.capacity) + " " + H.unitOf(s) + T("/mo");
    if (r && r.peakUtil != null) t += " · " + H.pct(r.peakUtil);
    return t;
  }
  function render() {
    var wrap = $("studioCanvas"); if (!wrap || !APP.state.net) return;
    var S = st();
    $("studioView").querySelectorAll("button").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-v") === S.view); });
    $("studioMode").querySelectorAll("button").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-v") === S.mode); });
    wrap.hidden = S.view !== "diagram"; $("mapBox").hidden = S.view !== "map";
    $("studioPanel").classList.toggle("mode-" + S.mode, true);
    ["select", "add", "connect", "delete"].forEach(function (m) { $("studioPanel").classList.toggle("mode-" + m, S.mode === m); });
    fillSelects(); renderIssues(); renderInspector(); renderParams();
    $("undoBtn").disabled = !A.canUndo(); $("redoBtn").disabled = !A.canRedo();
    if (S.view === "map") { renderMap(); legend(); return; }
    if (S.view !== "diagram") return;
    var L = layout(), n = net(), def = paramDef(), all = def ? n.sites.map(function (s) { return s.custom ? s.custom[def.key] : null; }).filter(function (v) { return v != null; }) : [];
    var svg = el("svg", { viewBox: "0 0 " + W + " " + L.H, "class": "studio", role: "img", "aria-label": T("Network diagram by tier") });
    el("rect", { x: 0, y: 0, width: W, height: L.H, fill: "#08223f", "class": "bg" }, svg);
    // tier columns and headers
    ORDER.forEach(function (t, i) {
      var x = COLW * i;
      el("rect", { x: x + 4, y: 4, width: COLW - 8, height: L.H - 8, rx: 6, "class": "col" + (S.mode === "add" ? " add" : ""), "data-tier": t }, svg);
      el("circle", { cx: x + 16, cy: 22, r: 5, fill: H.TCOL[t] }, svg);
      var th = el("text", { x: x + 26, y: 26, "class": "col-h" }, svg); th.textContent = H.tierShort(t).toUpperCase();
      var tu = el("text", { x: x + COLW - 12, y: 26, "text-anchor": "end", "class": "col-u" }, svg); tu.textContent = (L.cols[t].length) + " · " + H.tierUnit(t);
      if (i < 5) { var ar = el("text", { x: x + COLW - 2, y: 44, "text-anchor": "middle", "class": "col-arrow" }, svg); ar.textContent = "▸"; }
    });
    // routes
    var lanesG = el("g", { "class": "routes" + (dims("route") ? " dim" : "") }, svg), selR = S.route;
    var actual = {}; if (A.cap()) A.view().lanes.forEach(function (l) { actual[l.from + ">" + l.to] = l.actual; });
    n.sites.forEach(function (s) {
      var sup = (s.suppliers || []).filter(function (l) { return L.pos[l.from]; }), tot = sup.reduce(function (a, l) { return a + (l.share > 0 ? l.share : 0); }, 0);
      sup.forEach(function (l) {
        var a = L.pos[l.from], b = L.pos[s.id], x1 = a.x + NW / 2, x2 = b.x - NW / 2, mx = (x1 + x2) / 2;
        var share = A.cap() && actual[l.from + ">" + s.id] != null ? actual[l.from + ">" + s.id] : tot > 0 ? l.share / tot : 0;
        var mode = G.modeOf(n, l.from, s.id), isSel = selR && selR.from === l.from && selR.to === s.id, near = APP.state.sel === s.id || APP.state.sel === l.from;
        var d = "M" + x1 + "," + a.y + " C" + mx + "," + a.y + " " + mx + "," + b.y + " " + (x2 - 6) + "," + b.y;
        var g = el("g", { "class": "route" + (isSel ? " sel" : near ? " near" : ""), "data-from": l.from, "data-to": s.id }, lanesG);
        el("path", { d: d, "class": "r-line", "stroke-width": (1 + 4 * Math.min(1, share)).toFixed(2), "stroke-dasharray": DASH[mode], "marker-end": "url(#arrow)" }, g);
        el("path", { d: d, "class": "r-hit" }, g);
        if (isSel || (S.showDays && near)) {
          var days = APP.state.res && APP.state.res.transit ? APP.state.res.transit[l.from + ">" + s.id] : null;
          var lab = el("text", { x: mx, y: (a.y + b.y) / 2 - 4, "text-anchor": "middle", "class": "r-lab", "paint-order": "stroke" }, g);
          lab.textContent = (days != null ? Math.round(days) + " " + T("d") : "") + " · " + Math.round(share * 100) + "%";
        }
        g.addEventListener("click", function (e) { e.stopPropagation(); routeClick(l.from, s.id); });
        g.addEventListener("mousemove", function (e) { tip(e, "<b>" + esc(H.nm(G.byId(n, l.from))) + " → " + esc(H.nm(s)) + "</b>" + H.row(T("Share"), Math.round(share * 100) + "%" + (A.cap() ? " " + T("(within capacity)") : "")) + H.row(T("Transit"), (APP.state.res && APP.state.res.transit && APP.state.res.transit[l.from + ">" + s.id] != null ? Math.round(APP.state.res.transit[l.from + ">" + s.id]) + " " + T("d") : "–") + (l.days != null ? " " + T("(set)") : " " + T("(estimated)"))) + H.row(T("Mode"), modeName(mode) + (l.mode ? "" : " " + T("(estimated)")))); });
        g.addEventListener("mouseleave", untip);
      });
    });
    var defs = el("defs", {}, svg), mk = el("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0,0 L10,5 L0,10 z", "class": "r-arrow" }, mk);
    // sites
    var iss = G.issues(n), byIssue = {}; iss.forEach(function (x) { if (x.id) (byIssue[x.id] = byIssue[x.id] || []).push(x); });
    n.sites.forEach(function (s) {
      var p = L.pos[s.id]; if (!p) return;
      var role = roleOf(s.tier), sel = APP.state.sel === s.id && !S.route;
      var g = el("g", { "class": "node r-" + role + (sel ? " sel" : "") + (dims(role) ? " dim" : ""), "data-id": s.id, tabindex: 0, role: "button", "aria-label": H.nm(s) + ", " + H.tierOne(s.tier), transform: "translate(0,0)" }, svg);
      shape(g, s, p, siteFill(s, def, all), sel ? "var(--ink)" : H.TCOL[s.tier], sel ? 2.5 : 1.6);
      var t1 = el("text", { x: p.x - NW / 2 + (role === "production" ? 13 : 14), y: p.y - 3, "class": "n-name" }, g); t1.textContent = trunc(H.nm(s), 21);
      var t2 = el("text", { x: p.x - NW / 2 + (role === "production" ? 13 : 14), y: p.y + 12, "class": "n-sub" }, g); t2.textContent = metric(s);
      var mine = byIssue[s.id];
      if (mine) { var bad = mine.some(function (x) { return x.level === "error"; }); el("circle", { cx: p.x + NW / 2 - 4, cy: p.y - NH / 2 + 3, r: 7, "class": "badge " + (bad ? "err" : "warn") }, g); var bt = el("text", { x: p.x + NW / 2 - 4, y: p.y - NH / 2 + 7, "text-anchor": "middle", "class": "badge-t" }, g); bt.textContent = "!"; }
      if (def) { var v = s.custom ? s.custom[def.key] : null; if (v != null) { var vt = el("text", { x: p.x + NW / 2 - 8, y: p.y + 12, "text-anchor": "end", "class": "n-val" }, g); vt.textContent = def.type === "bool" ? (v ? T("yes") : T("no")) : trunc(String(def.type === "number" ? H.fq(v) : v), 10); } }
      g.addEventListener("pointerdown", function (e) { nodeDown(e, s, p, g, L); });
      g.addEventListener("click", function (e) { e.stopPropagation(); });
      g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSite(s.id); } });
      g.addEventListener("mousemove", function (e) { if (drag) return; tip(e, "<b>" + esc(H.nm(s)) + "</b>" + H.row(esc(H.tierOne(s.tier)), "") + H.row(esc(H.country(s)), H.latLabel(s.lat)) + H.row(s.tier === "market" ? T("Demand") : T("Capacity"), metric(s)) + (mine ? mine.map(function (x) { return "<span class='tip-" + x.level + "'>" + esc(issueText(x)) + "</span>"; }).join("") : "")); });
      g.addEventListener("mouseleave", untip);
    });
    svg.addEventListener("click", function (e) { bgClick(e, L); });
    svg.addEventListener("pointermove", function (e) { bgMove(e, svg, L); });
    var old = wrap.querySelector("svg"); if (old) wrap.replaceChild(svg, old); else wrap.insertBefore(svg, wrap.firstChild);
    legend();
  }
  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function modeName(m) { return { road: T("road"), sea: T("sea"), rail: T("rail"), air: T("air") }[m] || m; }
  function legend() {
    var def = paramDef(), h = "<span><i class='lg-prod'></i>" + T("Production site") + "</span><span><i class='lg-wh'></i>" + T("Warehouse") + "</span><span><i class='lg-mkt'></i>" + T("Consumption point") + "</span>" +
      "<span><i class='lg-route'></i>" + T("Route by road") + "</span><span><i class='lg-route sea'></i>" + T("by sea") + "</span><span><i class='lg-route rail'></i>" + T("by rail") + "</span><span><i class='lg-route air'></i>" + T("by air") + "</span><span class='lg-note'>" + T("width: share of what the site buys") + "</span>";
    if (colourMode() === "status") h += A.cap() ? "<span><i class='sq' style='background:#6b5214'></i>" + T("At capacity at some point") + "</span><span><i class='sq' style='background:#8a2d2d'></i>" + T("Demand not fully met") + "</span>"
      : "<span><i class='sq' style='background:#14523c'></i>" + T("Under 90% at peak") + "</span><span><i class='sq' style='background:#6b5214'></i>" + T("Above 90% at peak") + "</span><span><i class='sq' style='background:#8a2d2d'></i>" + T("Short at some point") + "</span>";
    if (def) {
      var vals = def.type === "bool" ? [true, false] : def.type === "choice" ? def.options : net().sites.map(function (s) { return s.custom ? s.custom[def.key] : null; }).filter(function (v, i, a) { return v != null && a.indexOf(v) === i; }).slice(0, 7);
      if (def.type === "number") { var nums = vals.filter(function (v) { return typeof v === "number"; }); h += "<span>" + esc(pLabel(def)) + ": " + (nums.length ? H.fq(Math.min.apply(null, nums)) + " <i class='sq ramp'></i> " + H.fq(Math.max.apply(null, nums)) : "–") + "</span>"; }
      else vals.forEach(function (v) { var all = net().sites.map(function (s) { return s.custom ? s.custom[def.key] : null; }).filter(function (x) { return x != null; }); h += "<span><i class='sq' style='background:" + shade(valueColour(def, v, all)) + "'></i>" + esc(def.type === "bool" ? (v ? T("yes") : T("no")) : v) + "</span>"; });
      h += "<span><i class='sq' style='background:#0b2846;border:1px dashed var(--line)'></i>" + T("no value") + "</span>";
    }
    $("studioLegend").innerHTML = h;
  }
  function pLabel(d) { return I.T(d.label); }
  function tip(e, html) {
    if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "tip"; $("studioCanvas").appendChild(tipEl); }
    tipEl.innerHTML = html; tipEl.hidden = false;
    var r = $("studioCanvas").getBoundingClientRect(), x = e.clientX - r.left + 14, y = e.clientY - r.top + 12;
    if (x + tipEl.offsetWidth > r.width) x = e.clientX - r.left - tipEl.offsetWidth - 14;
    tipEl.style.left = x + "px"; tipEl.style.top = y + "px";
  }
  function untip() { if (tipEl) tipEl.hidden = true; }

  // ---- interaction
  function svgPoint(svg, e) { var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; var m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 }; }
  function tierAt(x) { var i = Math.max(0, Math.min(5, Math.floor(x / COLW))); return ORDER[i]; }
  function selectSite(id) { st().route = null; APP.select(id); }
  function routeClick(from, to) {
    var S = st();
    if (S.mode === "delete") { A.edit(function (n) { G.disconnect(n, from, to); }, true); S.route = null; return; }
    S.route = { from: from, to: to }; render();
  }
  function bgClick(e, L) {
    var S = st(); if (drag && drag.moved) return;
    var svg = e.currentTarget, p = svgPoint(svg, e), tier = tierAt(p.x);
    if (S.mode === "add") {
      var idx = Math.max(0, Math.round((p.y - TOP - 24) / ROW));
      var made = null;
      A.edit(function (n) { made = G.addSite(n, tier, { name: T("New site") + " " + (G.sitesOf(n, tier).length + 1), index: idx }); }, true);
      if (made) { S.route = null; APP.select(made.id); setTimeout(function () { var f = document.querySelector("#inspector input[data-f='name']"); if (f) { f.focus(); f.select(); } }, 30); }
      return;
    }
    if (S.route) { S.route = null; render(); }
  }
  function bgMove(e, svg, L) {
    if (st().mode !== "add") return;
    var p = svgPoint(svg, e), tier = tierAt(p.x), idx = Math.max(0, Math.round((p.y - TOP - 24) / ROW));
    var g = svg.querySelector(".ghost"); if (!g) { g = el("g", { "class": "ghost" }, svg); el("rect", { width: NW, height: NH, rx: 6 }, g); var t = el("text", { x: NW / 2, y: NH / 2 + 4, "text-anchor": "middle" }, g); t.textContent = "+ " + T("Add a site here"); }
    g.setAttribute("transform", "translate(" + (colX(tier) - NW / 2) + "," + (TOP + 24 + idx * ROW - NH / 2 - ROW / 2 + 2) + ")");
  }
  function nodeDown(e, s, p, g, L) {
    var S = st(); if (e.button !== 0) return;
    e.stopPropagation();
    if (S.mode === "delete") { A.edit(function (n) { G.removeSite(n, s.id); }, true); return; }
    if (S.mode === "add") { selectSite(s.id); return; }
    var svg = g.ownerSVGElement, start = svgPoint(svg, e);
    if (S.mode === "connect") {
      drag = { kind: "link", from: s, line: el("path", { "class": "link-temp", d: "M" + p.x + "," + p.y }, svg), p: p, svg: svg, valid: {} };
      net().sites.forEach(function (x) { if (G.canConnect(net(), s.id, x.id).ok || G.canConnect(net(), x.id, s.id).ok) drag.valid[x.id] = 1; });
      svg.querySelectorAll(".node").forEach(function (n) { n.classList.toggle("target", !!drag.valid[n.getAttribute("data-id")]); n.classList.toggle("source", n.getAttribute("data-id") === s.id); });
    } else drag = { kind: "move", s: s, g: g, y0: start.y, svg: svg, moved: false, L: L };
    try { svg.setPointerCapture(e.pointerId); } catch (x) { /* older browsers */ }
    svg.addEventListener("pointermove", onDrag); svg.addEventListener("pointerup", onUp); svg.addEventListener("pointercancel", onUp);
  }
  function onDrag(e) {
    if (!drag) return;
    var p = svgPoint(drag.svg, e);
    if (drag.kind === "link") {
      drag.line.setAttribute("d", "M" + drag.p.x + "," + drag.p.y + " L" + p.x + "," + p.y);
      var over = targetAt(e); drag.svg.querySelectorAll(".node").forEach(function (n) { n.classList.toggle("hover", n === over && !!drag.valid[n.getAttribute("data-id")]); });
    } else {
      var dy = p.y - drag.y0; if (Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) drag.g.setAttribute("transform", "translate(0," + dy + ")"), drag.g.classList.add("dragging"), untip();
    }
  }
  function targetAt(e) { var t = document.elementFromPoint(e.clientX, e.clientY); return t && t.closest ? t.closest(".node") : null; }
  function onUp(e) {
    var d = drag; if (!d) return;
    d.svg.removeEventListener("pointermove", onDrag); d.svg.removeEventListener("pointerup", onUp); d.svg.removeEventListener("pointercancel", onUp);
    if (d.kind === "link") {
      var over = targetAt(e), to = over && over.getAttribute("data-id");
      d.line.remove(); drag = null;
      if (to && d.valid[to]) {
        var from = d.from.id, a = G.canConnect(net(), from, to).ok ? [from, to] : [to, from];
        A.edit(function (n) { G.connect(n, a[0], a[1]); }, false); st().route = { from: a[0], to: a[1] }; render();
      } else if (to === d.from.id) selectSite(to);
      else render();
      return;
    }
    if (d.moved) {
      var p = svgPoint(d.svg, e), idx = Math.max(0, Math.round((p.y - TOP - 24) / ROW));
      drag = { moved: true }; setTimeout(function () { drag = null; }, 0);
      A.edit(function (n) { G.place(n, d.s.id, idx); }, false);
    } else { drag = null; selectSite(d.s.id); }
  }

  // ---- issues
  function issueText(x) {
    var s = x.id ? G.byId(net(), x.id) : null, name = s ? H.nm(s) : "", from = x.from ? (G.byId(net(), x.from) ? H.nm(G.byId(net(), x.from)) : x.from) : "";
    switch (x.code) {
      case "nosupplier": return T("{s} has no supplier.", { s: name });
      case "unknown": return T("{s} is supplied by {f}, which is not in the network.", { s: name, f: from });
      case "wrongtier": return T("{s} is supplied by {f}, which is not in the tier directly above.", { s: name, f: from });
      case "location": return T("{s} needs a latitude and longitude.", { s: name });
      case "capacity": return T("{s} needs a capacity of zero or more.", { s: name });
      case "demand": return T("{s} needs a base demand of zero or more.", { s: name });
      case "yield": return T("{s} needs a yield above 0 and up to 100%.", { s: name });
      case "lead": return T("{s} cannot have a negative lead time.", { s: name });
      case "release": return T("{s} cannot have a negative release time.", { s: name });
      case "unused": return T("No one buys from {s}: it carries no load.", { s: name });
      case "duplicate": return T("Two sites share the id {id}.", { id: x.id });
      case "nomarket": return T("The network needs at least one consumption point.");
      default: return T("{s} has a problem.", { s: name });
    }
  }
  function renderIssues() {
    var iss = G.issues(net()), box = $("studioIssues");
    if (!iss.length) { box.innerHTML = "<span class='ok'>✓ " + T("The network is complete: every site can be planned.") + "</span>"; return; }
    var err = iss.filter(function (x) { return x.level === "error"; }).length;
    box.innerHTML = "<b class='" + (err ? "bad" : "warn") + "'>" + (err === 1 ? T("1 problem stops the plan:") : err ? T("{n} problems stop the plan:", { n: err }) : T("Notes:")) + "</b> " + iss.slice(0, 14).map(function (x) {
      return x.id ? "<button class='linkish " + x.level + "' data-sel='" + esc(x.id) + "'>" + esc(issueText(x)) + "</button>" : "<span>" + esc(issueText(x)) + "</span>";
    }).join(" ") + (iss.length > 14 ? " " + T("…and {n} more.", { n: iss.length - 14 }) : "");
    box.querySelectorAll("[data-sel]").forEach(function (b) { b.addEventListener("click", function () { st().view = "diagram"; selectSite(b.getAttribute("data-sel")); }); });
  }

  // ---- inspector
  var FIELDS = {
    market: [["base", "Base demand, a month", "num"], ["growth", "Growth % (yrs 1–3)", "num"], ["longGrowth", "Growth % (yrs 4–13)", "num"], ["season", "Season swing %", "num"], ["launch", "Launch (YYYY-MM)", "month"], ["ramp", "Ramp months", "num"], ["priority", "Priority (1–3)", "num"]],
    warehouse: [["capacity", "Throughput a month", "num"], ["handling", "Handling days", "num"], ["cover", "Cover weeks", "num"], ["expansions", "Expansions (YYYY-MM:+amount)", "exp"], ["candidates", "Candidate expansions (label:add:capex:build:qualify[:opex])", "cand"]],
    cmo: [["capacity", "Capacity a month", "num"], ["lead", "Lead time, days", "num"], ["release", "Release time, days", "num"], ["yield", "Yield %", "num"], ["expansions", "Expansions (YYYY-MM:+amount)", "exp"], ["candidates", "Candidate expansions (label:add:capex:build:qualify[:opex])", "cand"]]
  };
  function input(f, label, v, type, extra) {
    return "<label class='fi'><span>" + label + "</span><input data-f='" + f + "' value='" + esc(v == null ? "" : v) + "'" + (type === "num" ? " inputmode='decimal'" : "") + (extra || "") + "></label>";
  }
  function customInput(def, target, scope) {
    var v = target.custom ? target.custom[def.key] : null, lab = esc(pLabel(def)) + (def.unit ? " (" + esc(def.unit) + ")" : ""), a = " data-c='" + esc(def.key) + "' data-scope='" + scope + "'";
    if (def.type === "bool") return "<label class='fi'><span>" + lab + "</span><select" + a + "><option value=''>–</option><option value='yes'" + (v === true ? " selected" : "") + ">" + T("yes") + "</option><option value='no'" + (v === false ? " selected" : "") + ">" + T("no") + "</option></select></label>";
    if (def.type === "choice") return "<label class='fi'><span>" + lab + "</span><select" + a + "><option value=''>–</option>" + def.options.map(function (o) { return "<option" + (o === v ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select></label>";
    return "<label class='fi'><span>" + lab + "</span><input" + a + " value='" + esc(v == null ? "" : v) + "'" + (def.type === "number" ? " inputmode='decimal'" : "") + "></label>";
  }
  function renderInspector() {
    var box = $("inspector"), S = st(), n = net();
    if (S.route) {
      var l = G.lane(n, S.route.from, S.route.to), a = G.byId(n, S.route.from), b = G.byId(n, S.route.to);
      if (!l || !a || !b) { S.route = null; return renderInspector(); }
      var tot = (b.suppliers || []).reduce(function (x, y) { return x + (y.share > 0 ? y.share : 0); }, 0), est = APP.state.res && APP.state.res.transit ? APP.state.res.transit[a.id + ">" + b.id] : null;
      box.innerHTML = "<p class='insp-kind'><i class='lg-route'></i>" + T("Transport route") + "</p><p class='insp-title'>" + esc(H.nm(a)) + " → " + esc(H.nm(b)) + "</p>" +
        "<p class='insp-meta'>" + T("{d} km", { d: Math.round(P.distanceKm(a, b)).toLocaleString(I.locale) }) + " · " + esc(H.tierShort(a.tier)) + " → " + esc(H.tierShort(b.tier)) + "</p>" +
        input("share", T("Share") + " · " + (tot > 0 ? Math.round(l.share / tot * 100) + "% " + T("of what it buys") : ""), l.share, "num") +
        input("days", T("Transit days (blank = estimated)"), l.days, "num", " placeholder='" + (est != null ? Math.round(est) : "") + "'") +
        "<label class='fi'><span>" + T("Mode") + "</span><select data-f='mode'><option value=''>" + T("Estimated ({m})", { m: modeName(l.days == null && !l.mode ? G.modeOf(n, a.id, b.id) : "road") }) + "</option>" + G.MODES.map(function (m) { return "<option value='" + m + "'" + (l.mode === m ? " selected" : "") + ">" + modeName(m) + "</option>"; }).join("") + "</select></label>" +
        G.params(n, "routes").map(function (d) { return customInput(d, l, "route"); }).join("") +
        "<div class='insp-actions'><button type='button' class='btn small danger' data-act='delroute'>" + T("Delete route") + "</button></div>";
      wire(box, function (f, v, el2) {
        A.edit(function (net2) {
          var ln = G.lane(net2, S.route.from, S.route.to); if (!ln) return;
          if (el2.hasAttribute("data-c")) { var def = G.params(net2, "routes").filter(function (d) { return d.key === el2.getAttribute("data-c"); })[0]; G.setCustom(ln, def, v); return; }
          if (f === "share") { var x = A.num(v); if (isFinite(x) && x >= 0) ln.share = x; }
          else if (f === "days") { if (v === "") delete ln.days; else { var dd = A.num(v); if (isFinite(dd) && dd >= 0) ln.days = dd; } }
          else if (f === "mode") { if (v) ln.mode = v; else delete ln.mode; }
        }, false);
      });
      box.querySelector("[data-act='delroute']").addEventListener("click", function () { var r = S.route; S.route = null; A.edit(function (n2) { G.disconnect(n2, r.from, r.to); }, true); });
      return;
    }
    var s = G.byId(n, APP.state.sel);
    if (!s) { box.innerHTML = "<p class='insp-empty'>" + T("Select a site or a route to edit it.") + "</p>"; return; }
    var role = roleOf(s.tier), fl = s.tier === "market" ? FIELDS.market : s.tier === "warehouse" ? FIELDS.warehouse : FIELDS.cmo;
    var roleName = { production: T("Production site"), warehouse: T("Warehouse"), consumption: T("Consumption point") }[role];
    var val = function (k) { if (k === "launch") return s.launch != null ? A.monthText(s.launch) : ""; if (k === "expansions") return (s.expansions || []).map(function (e) { return A.monthText(e.from) + ":+" + e.add; }).join(" | "); if (k === "candidates") return A.candidatesText(s); return s[k]; };
    var cps = G.params(n, "sites").filter(function (d) { return G.applies(d, s); });
    box.innerHTML = "<p class='insp-kind'><i class='swatch' style='background:" + H.TCOL[s.tier] + "'></i>" + esc(roleName) + " · " + esc(H.tierOne(s.tier)) + "</p>" +
      input("name", T("Name"), H.nm(s), "text") + input("id", T("Id"), s.id, "text") + input("country", T("Country"), H.country(s), "text") +
      "<div class='fi-row'>" + input("lat", T("Latitude"), s.lat, "num") + input("lon", T("Longitude"), s.lon, "num") + "</div>" +
      "<button type='button' class='linkish pick' data-act='pick'>" + (APP.state.pick === s.id ? T("Click the map to place it…") : T("Pick the place on the map")) + "</button>" +
      "<p class='insp-h'>" + (s.tier === "market" ? T("Demand") : T("Capacity and times")) + " · " + esc(H.unitOf(s)) + "</p>" +
      fl.map(function (x) { return input(x[0], T(x[1]), val(x[0]), x[2]); }).join("") +
      (cps.length ? "<p class='insp-h'>" + T("Custom parameters") + "</p>" + cps.map(function (d) { return customInput(d, s, "site"); }).join("") : "") +
      "<div class='insp-actions'><button type='button' class='btn small' data-act='plan'>" + T("Its plan ↓") + "</button><button type='button' class='btn small danger' data-act='delsite'>" + T("Delete site") + "</button></div>";
    wire(box, function (f, v, el2) {
      var structural = f === "lat" || f === "lon" || f === "id";
      A.edit(function (n2) {
        var t = G.byId(n2, s.id); if (!t) return;
        if (el2.hasAttribute("data-c")) { var def = G.params(n2, "sites").filter(function (d) { return d.key === el2.getAttribute("data-c"); })[0]; G.setCustom(t, def, def.type === "number" && v !== "" ? A.num(v) : v); return; }
        if (f === "name") t.name = v || t.id;
        else if (f === "id") { if (G.renameId(n2, s.id, v)) APP.state.sel = v; }
        else if (f === "country") t.country = v;
        else if (f === "launch") { if (!v) delete t.launch; else { var li = A.monthIndex(v); if (isFinite(li)) t.launch = li; } }
        else if (f === "expansions") t.expansions = A.parseExpansions(v);
        else if (f === "candidates") t.candidates = A.parseCandidates(v);
        else if (v === "" && ["ramp", "longGrowth", "cover", "handling", "priority"].indexOf(f) >= 0) delete t[f];
        else { var x = A.num(v); if (isFinite(x)) t[f] = x; }
      }, structural);
    });
    box.querySelector("[data-act='pick']").addEventListener("click", function () { APP.state.pick = s.id; st().view = "map"; A.renderAll(); });
    box.querySelector("[data-act='plan']").addEventListener("click", function () { APP.select(s.id); $("sitePanel").scrollIntoView({ block: "start", behavior: "smooth" }); });
    box.querySelector("[data-act='delsite']").addEventListener("click", function () { A.edit(function (n2) { G.removeSite(n2, s.id); }, true); });
  }
  function wire(box, apply) {
    box.querySelectorAll("input,select").forEach(function (x) {
      x.addEventListener("change", function () { apply(x.getAttribute("data-f"), String(x.value).trim(), x); });
      if (x.tagName === "INPUT") x.addEventListener("keydown", function (e) { if (e.key === "Enter") x.blur(); });
    });
  }

  // ---- custom parameters: definitions
  function renderParams() {
    var box = $("paramList"), n = net(), defs = n.params || [];
    box.innerHTML = defs.length ? "<table class='edit'><thead><tr><th>" + T("Parameter") + "</th><th>" + T("Key") + "</th><th>" + T("Type") + "</th><th>" + T("For") + "</th><th></th></tr></thead><tbody>" + defs.map(function (d) {
      var forWhat = d.applies === "routes" ? T("Routes") : d.tiers && d.tiers.length ? d.tiers.map(function (t) { return H.tierShort(t); }).join(", ") : T("All sites");
      return "<tr><td class='name'>" + esc(pLabel(d)) + (d.unit ? " (" + esc(d.unit) + ")" : "") + "</td><td class='sid'>" + esc(d.key) + "</td><td>" + typeName(d.type) + (d.options ? ": " + esc(d.options.join(", ")) : "") + "</td><td>" + esc(forWhat) + "</td><td><button type='button' class='x' data-del='" + esc(d.key) + "' aria-label='" + esc(T("Remove this parameter")) + "'>×</button></td></tr>";
    }).join("") + "</tbody></table>" : "<p class='insp-empty'>" + T("No custom parameters yet.") + "</p>";
    box.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { var k = b.getAttribute("data-del"); if (colourMode() === "p:" + k) st().colorBy = "tier"; A.edit(function (n2) { G.removeParam(n2, k); }, false); }); });
    var tierBox = $("pmTiers"); if (!tierBox.childNodes.length) tierBox.innerHTML = P.TIERS.map(function (t) { return "<label class='chk'><input type='checkbox' value='" + t.id + "'>" + esc(H.tierShort(t.id)) + "</label>"; }).join("");
  }
  function typeName(t) { return { number: T("number"), text: T("text"), bool: T("yes / no"), choice: T("choice") }[t]; }
  function addParamFromForm() {
    var label = $("pmLabel").value.trim(), type = $("pmType").value, applies = $("pmApplies").value, unit = $("pmUnit").value.trim(), opts = $("pmOptions").value, dflt = $("pmDefault").value.trim();
    var tiers = Array.prototype.filter.call($("pmTiers").querySelectorAll("input"), function (x) { return x.checked; }).map(function (x) { return x.value; });
    var probe = JSON.parse(JSON.stringify({ params: net().params || [], sites: [] })), r = G.addParam(probe, { label: label, type: type, applies: applies, unit: unit, options: opts, tiers: tiers, default: dflt });
    var msg = $("pmMsg");
    if (!r.ok) { msg.className = "pm-msg bad"; msg.textContent = { label: T("Give the parameter a name."), reserved: T("That name is taken by a built-in field."), exists: T("A parameter with that name exists."), options: T("A choice needs its options, separated by |.") }[r.reason] || ""; return; }
    A.edit(function (n2) { G.addParam(n2, { label: label, type: type, applies: applies, unit: unit, options: opts, tiers: tiers, default: dflt }); }, false);
    msg.className = "pm-msg ok"; msg.textContent = T("Added {p}. Set its values in the inspector, or colour the diagram by it.", { p: label });
    $("pmLabel").value = ""; $("pmUnit").value = ""; $("pmOptions").value = ""; $("pmDefault").value = "";
    if (applies === "sites") st().colorBy = "p:" + r.def.key;
    render();
  }
  function fillSelects() {
    var cb = $("studioColor"), keep = colourMode();
    cb.innerHTML = "<option value='tier'>" + T("Tier") + "</option><option value='status'>" + T("Status in the plan") + "</option>" + G.params(net(), "sites").map(function (d) { return "<option value='p:" + esc(d.key) + "'>" + esc(pLabel(d)) + "</option>"; }).join("");
    cb.value = keep; if (cb.value !== keep) { st().colorBy = "tier"; cb.value = "tier"; }
    $("studioHighlight").value = st().highlight || "all";
    $("studioDays").checked = !!st().showDays;
    $("pmOptionsRow").hidden = $("pmType").value !== "choice";
    $("pmTiersRow").hidden = $("pmApplies").value !== "sites";
  }

  // ---- the diagram as a picture
  function svgText() {
    var svg = st().view === "map" ? $("mapWrap").querySelector("svg") : $("studioCanvas").querySelector("svg"); if (!svg) return null;
    var c = svg.cloneNode(true), cs = getComputedStyle(document.documentElement), v = function (n) { return cs.getPropertyValue(n).trim(); };
    var vb = svg.viewBox.baseVal, ow = st().view === "map" ? 1600 : W, oh = ow * vb.height / vb.width;
    c.setAttribute("xmlns", SVGNS); c.setAttribute("width", ow); c.setAttribute("height", oh);
    var style = document.createElementNS(SVGNS, "style");
    style.textContent = ".col{fill:rgba(13,58,99,.35);stroke:" + v("--line-soft") + "}.col-h{font:700 12px Rajdhani,Arial,sans-serif;fill:" + v("--ink-dim") + ";letter-spacing:.08em}.col-u,.col-arrow{font:10px 'IBM Plex Mono',monospace;fill:" + v("--ink-faint") + "}" +
      ".land{fill:#123f6b;stroke:#2a5580}.grat{stroke:#1d4470;fill:none}.bg{fill:#08223f}.lat-label,.m-lab{font-family:'IBM Plex Mono',monospace;fill:" + v("--ink-dim") + "}.m-lab{fill:" + v("--ink") + ";stroke:#08223f}.halo{fill:none;stroke-width:2}.n-hit{fill:transparent}.r-line{fill:none;stroke:#6f9fd0;opacity:.8}.r-hit{fill:none;stroke:transparent}.r-arrow{fill:#6f9fd0}.r-lab{font:10px 'IBM Plex Mono',monospace;fill:" + v("--ink") + ";stroke:#08223f;stroke-width:3}" +
      ".n-name{font:600 12px Barlow,Arial,sans-serif;fill:" + v("--ink") + "}.n-sub,.n-val{font:9.5px 'IBM Plex Mono',monospace;fill:" + v("--ink-dim") + "}.badge.err{fill:#e34948}.badge.warn{fill:#eda100}.badge-t{font:700 10px Arial;fill:#04202b}.dim{opacity:.22}.ghost{display:none}";
    c.insertBefore(style, c.firstChild);
    return new XMLSerializer().serializeToString(c);
  }
  function exportSVG() { var t = svgText(); if (t) A.download(A.fileBase() + (st().view === "map" ? "-map" : "-diagram") + ".svg", t, "image/svg+xml"); }
  function exportPNG() {
    var t = svgText(); if (!t) return;
    var img = new Image(), m = t.match(/width="([\d.]+)" height="([\d.]+)"/), ow = m ? +m[1] : W, oh = m ? +m[2] : 600;
    img.onload = function () { var cv = document.createElement("canvas"); cv.width = ow * 2; cv.height = oh * 2; var cx = cv.getContext("2d"); cx.scale(2, 2); cx.drawImage(img, 0, 0, ow, oh); cv.toBlob(function (b) { A.download(A.fileBase() + (st().view === "map" ? "-map" : "-diagram") + ".png", b); }); };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(t);
  }

  // ---- the world map: an equirectangular world, zoomed and panned through the SVG's view box; symbols and lines keep
  // their size on screen at any zoom
  var MAP_AR = 2.2, landD = null;
  function mapView() { var S = st(); if (!S.mapView) S.mapView = GEO.fit(net().sites, MAP_AR); return S.mapView; }
  function landPath() {
    var land = APP.state.land; if (!land) return "";
    if (!landD) landD = land.rings.map(function (r) { return "M" + r.map(function (c) { var q = GEO.project(c[0], c[1]); return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join("L") + "Z"; }).join("");
    return landD;
  }
  function brightFill(s, def, all) {
    var mode = colourMode(), vw = A.view(), r = vw && vw.sites ? vw.sites[s.id] : null;
    if (mode === "status" && r) {
      if (s.tier === "market") return A.cap() ? (r.fill < 0.999 ? "#e34948" : "#1baf7a") : H.TCOL.market;
      return A.cap() ? (r.firstBinding >= 0 ? "#eda100" : "#1baf7a") : r.peakUtil > 1 + 1e-9 ? "#e34948" : r.peakUtil >= 0.9 ? "#eda100" : "#1baf7a";
    }
    if (def) return valueColour(def, s.custom ? s.custom[def.key] : null, all) || "#33475e";
    return H.TCOL[s.tier];
  }
  function renderMap() {
    var wrap = $("mapWrap"); if (!wrap || !APP.state.net) return;
    var S = st(), n = net(), v = mapView(), cw = wrap.clientWidth || 900, px = v.w / cw;
    var def = paramDef(), all = def ? n.sites.map(function (x) { return x.custom ? x.custom[def.key] : null; }).filter(function (x) { return x != null; }) : [];
    var svg = el("svg", { viewBox: [v.x, v.y, v.w, v.h].join(" "), "class": "map world" + (APP.state.pick ? " picking" : ""), role: "img", "aria-label": T("World map of the supply network") });
    el("rect", { x: -GEO.W, y: -GEO.H, width: 3 * GEO.W, height: 3 * GEO.H, "class": "bg" }, svg);
    var grat = el("g", { "class": "grat-g" }, svg), lat, lon;
    for (lat = -60; lat <= 80; lat += 20) { var gy = GEO.project(0, lat)[1]; el("line", { x1: -GEO.W, x2: 2 * GEO.W, y1: gy, y2: gy, "class": "grat" + (lat === 0 ? " eq" : ""), "vector-effect": "non-scaling-stroke" }, grat); }
    [23.44, -23.44].forEach(function (lt) { var ty = GEO.project(0, lt)[1]; el("line", { x1: -GEO.W, x2: 2 * GEO.W, y1: ty, y2: ty, "class": "grat trop", "vector-effect": "non-scaling-stroke" }, grat); });
    for (lon = -540; lon <= 540; lon += 30) { var gx = GEO.project(lon, 0)[0]; el("line", { x1: gx, x2: gx, y1: -GEO.H, y2: 2 * GEO.H, "class": "grat", "vector-effect": "non-scaling-stroke" }, grat); }
    var d = landPath();
    [-GEO.W, 0, GEO.W].forEach(function (off) { el("path", { d: d, "class": "land", transform: off ? "translate(" + off + ",0)" : null, "vector-effect": "non-scaling-stroke" }, svg); });
    // latitude labels along the left edge of the view
    var fs = 10 * px;
    for (lat = -60; lat <= 80; lat += 20) { var ly = GEO.project(0, lat)[1]; if (ly > v.y + 2 * fs && ly < v.y + v.h - 2) { var lt2 = el("text", { x: v.x + 4 * px, y: ly - 3 * px, "class": "lat-label", "font-size": fs }, svg); lt2.textContent = lat === 0 ? T("Equator") : Math.abs(lat) + "°" + (lat < 0 ? T("S") : T("N")); } }
    var defs = el("defs", {}, svg), mk = el("marker", { id: "marrow", viewBox: "0 0 10 10", refX: 10, refY: 5, markerWidth: 9 * px, markerHeight: 9 * px, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0,0 L10,5 L0,10 z", "class": "r-arrow" }, mk);
    // routes along their great circles
    var routesG = el("g", { "class": "routes" + (dims("route") ? " dim" : "") }, svg), selR = S.route;
    var actual = {}; if (A.cap()) A.view().lanes.forEach(function (l) { actual[l.from + ">" + l.to] = l.actual; });
    var trans = APP.state.res && APP.state.res.transit ? APP.state.res.transit : {};
    n.sites.forEach(function (s2) {
      var sup = (s2.suppliers || []).filter(function (l) { return G.byId(n, l.from); }), tot = sup.reduce(function (a, l) { return a + (l.share > 0 ? l.share : 0); }, 0);
      sup.forEach(function (l) {
        var u = G.byId(n, l.from), pts = GEO.routePoints(u, s2, 28), mode = G.modeOf(n, l.from, s2.id);
        var share = A.cap() && actual[l.from + ">" + s2.id] != null ? actual[l.from + ">" + s2.id] : tot > 0 ? l.share / tot : 0;
        var isSel = selR && selR.from === l.from && selR.to === s2.id, near = APP.state.sel === s2.id || APP.state.sel === l.from;
        var g = el("g", { "class": "route" + (isSel ? " sel" : near ? " near" : ""), "data-from": l.from, "data-to": s2.id }, routesG);
        var dash = DASH[mode] ? DASH[mode].split(" ").map(function (x) { return (+x * px).toFixed(3); }).join(" ") : null;
        GEO.copies(pts).forEach(function (off) {
          var dd = "M" + pts.map(function (q) { return (q[0] + off).toFixed(2) + "," + q[1].toFixed(2); }).join("L");
          el("path", { d: dd, "class": "r-line", "stroke-width": (1 + 3.5 * Math.min(1, share)).toFixed(2), "stroke-dasharray": dash, "marker-end": "url(#marrow)", "vector-effect": "non-scaling-stroke" }, g);
          el("path", { d: dd, "class": "r-hit", "vector-effect": "non-scaling-stroke" }, g);
        });
        g.addEventListener("click", function (e) { e.stopPropagation(); routeClick(l.from, s2.id); });
        g.addEventListener("mousemove", function (e) { mtip(e, "<b>" + esc(H.nm(u)) + " → " + esc(H.nm(s2)) + "</b>" + H.row(T("Distance"), T("{d} km", { d: Math.round(P.distanceKm(u, s2)).toLocaleString(I.locale) })) + H.row(T("Share"), Math.round(share * 100) + "%") + H.row(T("Transit"), (trans[l.from + ">" + s2.id] != null ? Math.round(trans[l.from + ">" + s2.id]) + " " + T("d") : "–")) + H.row(T("Mode"), modeName(mode) + (l.mode ? "" : " " + T("(estimated)")))); });
        g.addEventListener("mouseleave", munTip);
      });
    });
    // sites, sized on screen
    var iss = G.issues(n), byIssue = {}; iss.forEach(function (x) { if (x.id) (byIssue[x.id] = byIssue[x.id] || []).push(x); });
    var selS = G.byId(n, APP.state.sel), related = {};
    if (selS && !S.route) { related[selS.id] = 1; (selS.suppliers || []).forEach(function (l) { related[l.from] = 1; }); n.sites.forEach(function (x) { if ((x.suppliers || []).some(function (l) { return l.from === selS.id; })) related[x.id] = 1; }); }
    if (S.route) { related[S.route.from] = 1; related[S.route.to] = 1; }
    var maxD = 0; n.sites.forEach(function (x) { if (x.tier === "market") maxD = Math.max(maxD, x.base || 0); });
    var order = n.sites.slice().sort(function (a, b) { return (a.id === APP.state.sel) - (b.id === APP.state.sel); });
    var vw = A.view(), shown = spread(n.sites, 16 * px);
    order.forEach(function (s2) {
      var q = shown[s2.id], role = roleOf(s2.tier), sel = APP.state.sel === s2.id && !S.route;
      var g = el("g", { "class": "node r-" + role + (sel ? " sel" : "") + (dims(role) ? " dim" : ""), "data-id": s2.id, transform: "translate(" + q[0].toFixed(2) + "," + q[1].toFixed(2) + ")", tabindex: 0, role: "button", "aria-label": H.nm(s2) + ", " + H.tierOne(s2.tier) }, svg);
      var fill = brightFill(s2, def, all), stroke = sel ? "var(--ink)" : "#04192f", sw = sel ? 2.5 : 1.4, a = 6 * px;
      var r = vw && vw.sites ? vw.sites[s2.id] : null;
      if (colourMode() !== "status" && r) {
        var ring = A.cap() ? (s2.tier === "market" ? (r.fill < 0.999 ? "var(--bad)" : null) : (r.firstBinding >= 0 ? "var(--warn)" : null))
          : (s2.tier !== "market" && r.peakUtil > 0.9 ? (r.peakUtil > 1 + 1e-9 ? "var(--bad)" : "var(--warn)") : null);
        if (ring) el("circle", { r: 11 * px, "class": "halo", stroke: ring, "vector-effect": "non-scaling-stroke" }, g);
      }
      if (role === "warehouse") el("path", { d: "M" + (-a) + ",0 L" + (-a / 2) + "," + (-a * 0.87) + " L" + (a / 2) + "," + (-a * 0.87) + " L" + a + ",0 L" + (a / 2) + "," + (a * 0.87) + " L" + (-a / 2) + "," + (a * 0.87) + " Z", fill: fill, stroke: stroke, "stroke-width": sw, "vector-effect": "non-scaling-stroke", "class": "n-shape" }, g);
      else if (role === "consumption") { var rr = (5 + 4 * Math.sqrt(maxD > 0 ? (s2.base || 0) / maxD : 0)) * px; el("rect", { x: -rr * 1.4, y: -rr, width: rr * 2.8, height: rr * 2, rx: rr, fill: fill, stroke: stroke, "stroke-width": sw, "vector-effect": "non-scaling-stroke", "class": "n-shape" }, g); }
      else el("rect", { x: -a * 0.9, y: -a * 0.9, width: a * 1.8, height: a * 1.8, rx: 1.5 * px, fill: fill, stroke: stroke, "stroke-width": sw, "vector-effect": "non-scaling-stroke", "class": "n-shape" }, g);
      el("circle", { r: 13 * px, fill: "transparent", "class": "n-hit" }, g);
      var mine = byIssue[s2.id];
      if (mine) { var bad = mine.some(function (x) { return x.level === "error"; }); el("circle", { cx: 8 * px, cy: -8 * px, r: 4.5 * px, "class": "badge " + (bad ? "err" : "warn") }, g); }
      if (S.mapNames || related[s2.id] || sel) {
        var lb = el("text", { x: 11 * px, y: 4 * px, "font-size": 11 * px, "class": "m-lab" + (sel ? " sel" : ""), "paint-order": "stroke", "stroke-width": 3 * px }, g); lb.textContent = H.nm(s2);
      }
      g.addEventListener("pointerdown", function (e) { mapNodeDown(e, s2, g, svg); });
      g.addEventListener("click", function (e) { e.stopPropagation(); });
      g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSite(s2.id); } });
      g.addEventListener("mousemove", function (e) { if (drag) return; mtip(e, "<b>" + esc(H.nm(s2)) + "</b>" + H.row(esc(H.tierOne(s2.tier)), "") + H.row(esc(H.country(s2)), H.latLabel(s2.lat) + ", " + lonLabel(s2.lon)) + H.row(s2.tier === "market" ? T("Demand") : T("Capacity"), metric(s2)) + (mine ? mine.map(function (x) { return "<span class='tip-" + x.level + "'>" + esc(issueText(x)) + "</span>"; }).join("") : "")); });
      g.addEventListener("mouseleave", munTip);
    });
    svg.addEventListener("pointerdown", function (e) { mapBgDown(e, svg); });
    svg.addEventListener("wheel", function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      var q = svgPoint(svg, e); S.mapView = GEO.zoom(mapView(), e.deltaY < 0 ? 1.25 : 0.8, q.x, q.y); renderMap();
    }, { passive: false });
    var old = wrap.querySelector("svg"); if (old) wrap.replaceChild(svg, old); else wrap.insertBefore(svg, wrap.firstChild);
    var ph = $("pickHint"); if (ph) { var pk = APP.state.pick && G.byId(n, APP.state.pick); ph.hidden = !(pk || (S.mode === "add")); ph.textContent = pk ? T("Click the map to place {s}.", { s: H.nm(pk) }) : T("Click the map where the new site should go."); }
    $("mapTierBox").hidden = S.mode !== "add";
    $("mapNames").checked = !!S.mapNames;
    $("mapLegend").innerHTML = (A.cap() ? "<span><i class='ring' style='border-color:var(--warn)'></i>" + T("At capacity at some point") + "</span><span><i class='ring' style='border-color:var(--bad)'></i>" + T("Demand not fully met") + "</span>"
      : "<span><i class='ring' style='border-color:var(--warn)'></i>" + T("Above 90% at peak") + "</span><span><i class='ring' style='border-color:var(--bad)'></i>" + T("Short at some point") + "</span>") +
      "<span class='lg-note'>" + T("Routes follow the great circle, the shortest way over the globe.") + "</span>";
  }
  // sites at (almost) the same place are drawn a little apart, so each can be seen and clicked; only on screen
  function spread(sites, minD) {
    var pts = sites.map(function (x) { var q = GEO.project(x.lon, x.lat); return { id: x.id, x0: q[0], y0: q[1], x: q[0], y: q[1] }; });
    for (var it = 0; it < 60; it++) {
      for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++) {
        var a = pts[i], b = pts[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-9) { dx = (i % 2 ? 1 : -1) * 0.01 * minD; dy = 0.01 * minD; d = Math.sqrt(dx * dx + dy * dy); }
        if (d < minD) { var f = (minD - d) / 2 / d; a.x -= dx * f; a.y -= dy * f; b.x += dx * f; b.y += dy * f; }
      }
      pts.forEach(function (q) { q.x += (q.x0 - q.x) * 0.05; q.y += (q.y0 - q.y) * 0.05; });
    }
    var out = {}; pts.forEach(function (q) { out[q.id] = [q.x, q.y]; }); return out;
  }
  function lonLabel(lon) { return I.fx(Math.abs(lon), 1) + "°" + (lon < 0 ? T("W") : T("E")); }
  function mtip(e, html) {
    var box = $("mapWrap"), t = box.querySelector(".tip");
    if (!t) { t = document.createElement("div"); t.className = "tip"; box.appendChild(t); }
    t.innerHTML = html; t.hidden = false;
    var r = box.getBoundingClientRect(), x = e.clientX - r.left + 14, y = e.clientY - r.top + 12;
    if (x + t.offsetWidth > r.width) x = e.clientX - r.left - t.offsetWidth - 14;
    if (y + t.offsetHeight > r.height) y = e.clientY - r.top - t.offsetHeight - 10;
    t.style.left = x + "px"; t.style.top = y + "px";
  }
  function munTip() { var t = $("mapWrap").querySelector(".tip"); if (t) t.hidden = true; }
  // a press on the map itself: place a site (when placing), add one, or pan
  function mapBgDown(e, svg) {
    if (e.button !== 0 || e.target.closest(".node") || e.target.closest(".route")) return;
    var S = st(), q = svgPoint(svg, e), ll = GEO.unproject(q.x, q.y);
    if (APP.state.pick) {
      var id = APP.state.pick; APP.state.pick = null;
      A.edit(function (n) { var x = G.byId(n, id); if (x) { x.lat = Math.round(ll[1] * 100) / 100; x.lon = Math.round(ll[0] * 100) / 100; } }, true);
      return;
    }
    if (S.mode === "add") {
      var tier = $("mapTier").value || "warehouse", made = null;
      A.edit(function (n) { made = G.addSite(n, tier, { name: T("New site") + " " + (G.sitesOf(n, tier).length + 1), lat: Math.round(ll[1] * 100) / 100, lon: Math.round(ll[0] * 100) / 100 }); }, true);
      if (made) { S.route = null; APP.select(made.id); setTimeout(function () { var f = document.querySelector("#inspector input[data-f='name']"); if (f) { f.focus(); f.select(); } }, 30); }
      return;
    }
    // pan: drag the map; a click without moving clears a selected route
    var v0 = mapView(), sx = e.clientX, sy = e.clientY, moved = false, scale = v0.w / (svg.clientWidth || 900);
    try { svg.setPointerCapture(e.pointerId); } catch (x) { /* older browsers */ }
    function mv(ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (!moved) return;
      var v = GEO.clamp({ x: v0.x - dx * scale, y: v0.y - dy * scale, w: v0.w, h: v0.h }); S.mapView = v;
      svg.setAttribute("viewBox", [v.x, v.y, v.w, v.h].join(" ")); svg.classList.add("panning");
    }
    function up() { svg.removeEventListener("pointermove", mv); svg.removeEventListener("pointerup", up); svg.classList.remove("panning"); if (moved) renderMap(); else if (S.route) { S.route = null; render(); } }
    svg.addEventListener("pointermove", mv); svg.addEventListener("pointerup", up);
  }
  // a press on a site: delete it, start a route from it, or move it (a click without moving selects it)
  function mapNodeDown(e, s2, g, svg) {
    var S = st(); if (e.button !== 0) return;
    e.stopPropagation();
    if (APP.state.pick) return;
    if (S.mode === "delete") { A.edit(function (n) { G.removeSite(n, s2.id); }, true); return; }
    if (S.mode === "add") { selectSite(s2.id); return; }
    var q0 = GEO.project(s2.lon, s2.lat);
    if (S.mode === "connect") {
      drag = { kind: "link", from: s2, line: el("path", { "class": "link-temp", d: "M" + q0[0] + "," + q0[1], "vector-effect": "non-scaling-stroke" }, svg), p: { x: q0[0], y: q0[1] }, svg: svg, valid: {} };
      net().sites.forEach(function (x) { if (G.canConnect(net(), s2.id, x.id).ok || G.canConnect(net(), x.id, s2.id).ok) drag.valid[x.id] = 1; });
      svg.querySelectorAll(".node").forEach(function (nd) { nd.classList.toggle("target", !!drag.valid[nd.getAttribute("data-id")]); nd.classList.toggle("source", nd.getAttribute("data-id") === s2.id); });
    } else drag = { kind: "place", s: s2, g: g, svg: svg, moved: false, x0: e.clientX, y0: e.clientY, q0: q0 };
    try { svg.setPointerCapture(e.pointerId); } catch (x) { /* older browsers */ }
    svg.addEventListener("pointermove", mapDrag); svg.addEventListener("pointerup", mapUp); svg.addEventListener("pointercancel", mapUp);
  }
  function mapDrag(e) {
    if (!drag) return;
    var q = svgPoint(drag.svg, e);
    if (drag.kind === "link") {
      drag.line.setAttribute("d", "M" + drag.p.x + "," + drag.p.y + " L" + q.x + "," + q.y);
      var over = targetAt(e); drag.svg.querySelectorAll(".node").forEach(function (nd) { nd.classList.toggle("hover", nd === over && !!drag.valid[nd.getAttribute("data-id")]); });
      return;
    }
    if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 4) drag.moved = true;
    if (drag.moved) { drag.g.setAttribute("transform", "translate(" + q.x.toFixed(2) + "," + q.y.toFixed(2) + ")"); drag.g.classList.add("dragging"); munTip(); }
  }
  function mapUp(e) {
    var d = drag; if (!d) return;
    d.svg.removeEventListener("pointermove", mapDrag); d.svg.removeEventListener("pointerup", mapUp); d.svg.removeEventListener("pointercancel", mapUp);
    drag = null;
    if (d.kind === "link") {
      var over = targetAt(e), to = over && over.getAttribute("data-id"); d.line.remove();
      if (to && d.valid[to]) { var from = d.from.id, ab = G.canConnect(net(), from, to).ok ? [from, to] : [to, from]; A.edit(function (n) { G.connect(n, ab[0], ab[1]); }, false); st().route = { from: ab[0], to: ab[1] }; render(); }
      else if (to === d.from.id) selectSite(to); else render();
      return;
    }
    if (!d.moved) { selectSite(d.s.id); return; }
    var q = svgPoint(d.svg, e), ll = GEO.unproject(q.x, q.y), id = d.s.id;
    A.edit(function (n) { var x = G.byId(n, id); if (x) { x.lat = Math.round(ll[1] * 100) / 100; x.lon = Math.round(ll[0] * 100) / 100; } }, true);
    APP.select(id);
  }
  function mapZoom(k) { st().mapView = GEO.zoom(mapView(), k); renderMap(); }

  // ---- controls
  function init() {
    if (!$("studioPanel")) return;
    $("studioView").querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { st().view = b.getAttribute("data-v"); APP.state.pick = null; A.renderAll(); }); });
    $("studioMode").querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { st().mode = b.getAttribute("data-v"); render(); }); });
    $("studioColor").addEventListener("change", function () { st().colorBy = this.value; render(); });
    $("studioHighlight").addEventListener("change", function () { st().highlight = this.value; render(); });
    $("studioDays").addEventListener("change", function () { st().showDays = this.checked; render(); });
    $("undoBtn").addEventListener("click", A.undo); $("redoBtn").addEventListener("click", A.redo);
    $("svgBtn").addEventListener("click", exportSVG); $("pngBtn").addEventListener("click", exportPNG);
    $("pmAdd").addEventListener("click", addParamFromForm);
    $("mapZoomIn").addEventListener("click", function () { mapZoom(1.6); });
    $("mapZoomOut").addEventListener("click", function () { mapZoom(1 / 1.6); });
    $("mapFit").addEventListener("click", function () { st().mapView = GEO.fit(net().sites, MAP_AR); renderMap(); });
    $("mapWorld").addEventListener("click", function () { st().mapView = GEO.world(MAP_AR); renderMap(); });
    $("mapNames").addEventListener("change", function () { st().mapNames = this.checked; renderMap(); });
    $("mapTier").innerHTML = P.TIERS.slice().reverse().map(function (t) { return "<option value='" + t.id + "'" + (t.id === "warehouse" ? " selected" : "") + ">" + esc(H.tierOne(t.id)) + "</option>"; }).join("");
    var rz = null; window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { if (st().view === "map") renderMap(); }, 150); });
    $("pmType").addEventListener("change", fillSelects); $("pmApplies").addEventListener("change", fillSelects);
    // keys act on the Studio when it was the last thing pressed (redraws take the keyboard focus away from a site)
    document.addEventListener("pointerdown", function (e) { active = !!(e.target.closest && e.target.closest("#studioPanel")); }, true);
    document.addEventListener("keydown", function (e) {
      var typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "");
      if (typing) return;
      var inStudio = active || (document.activeElement && document.activeElement.closest && document.activeElement.closest("#studioPanel"));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) A.redo(); else A.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); A.redo(); return; }
      if (!inStudio) return;
      if (e.key === "Escape") { st().mode = "select"; st().route = null; render(); }
      else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        var r = st().route; if (r) { st().route = null; A.edit(function (n) { G.disconnect(n, r.from, r.to); }, true); }
        else if (APP.state.sel) { var id = APP.state.sel; A.edit(function (n) { G.removeSite(n, id); }, true); }
      }
    });
  }
  window.TWStudio = { render: render, renderMap: renderMap, init: init, issueText: issueText, exportSVG: exportSVG, layout: layout, mapView: mapView };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
