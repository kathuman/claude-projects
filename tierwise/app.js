// Tierwise — the page: controls, loading and sharing supply chains, the latitude map, the capacity heatmap (or its
// change against a comparison), the selected site with what drives its load and the capacity it must add, the tier,
// lead-time and forecast views, the plan within capacity (solved by HiGHS in a worker: src/constrained.js,
// src/solve-worker.js) and the network editor. Planning is in src/plan.js (TWPlan), files in src/io.js (TWIO),
// the example network in src/network.js (TWNetwork), words in i18n.js (TWi18n).
(function () {
  "use strict";
  var VERSION = "2.0.0";
  var P = window.TWPlan, N = window.TWNetwork, IO = window.TWIO, I = window.TWi18n, T = I.T, fx = I.fx;
  var SVGNS = "http://www.w3.org/2000/svg";
  var XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  // tier colours (validated for the dark surface) and the same hues in fixed order for series inside one chart
  var TCOL = { market: "#3987e5", warehouse: "#d95926", packaging: "#199e70", dosing: "#c98500", product: "#d55181", raw: "#9085e9" };
  var CAT = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"], OTHER = "#7f93a8";
  // utilisation bins: blue at or under capacity, red over it
  var BINS = [
    { max: 0.6, c: "#1d4a78", l: "< 60%" }, { max: 0.8, c: "#2f6aa8", l: "60–80%" }, { max: 0.9, c: "#5b93cc", l: "80–90%" },
    { max: 1 + 1e-9, c: "#a7c2de", l: "90–100%" }, { max: 1.1, c: "#f2a283", l: "100–110%" }, { max: 1.25, c: "#e2604a", l: "110–125%" },
    { max: Infinity, c: "#b8282c", l: "> 125%" }
  ];
  // change in utilisation against the comparison, in points: blue = less loaded, grey = about the same, red = more
  var DBINS = [
    { max: -0.2, c: "#2f6aa8", l: "≤ −20" }, { max: -0.05, c: "#6f9fd0", l: "−20 … −5" }, { max: 0.05, c: "#3c5068", l: "±5" },
    { max: 0.2, c: "#ec9a7c", l: "+5 … +20" }, { max: Infinity, c: "#d9483b", l: "≥ +20" }
  ];
  var NA = "#16324f";
  // within capacity no site exceeds 100%: the last bin marks a site running at capacity (a bottleneck)
  var CBINS = [
    { max: 0.6, c: "#1d4a78", l: "< 60%" }, { max: 0.8, c: "#2f6aa8", l: "60–80%" }, { max: 0.9, c: "#5b93cc", l: "80–90%" },
    { max: 0.995, c: "#a7c2de", l: "90–99%" }, { max: Infinity, c: "#d9a43a", l: "at capacity" }
  ];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(function (m) { return T(m); });
  var state = { scenario: "base", net: null, res: null, sel: "p-ham", market: "m-jkt", colorBy: "peak", tier: "product", land: null, pos: null, ext: null,
    period: null, target: 0.9, compare: null, compareKey: "", heatMode: "plan", pinned: null, custom: null,
    mode: "plan", csrc: "qualified", hold: 6, cres: null, ckey: "", solving: false, cache: [], solveErr: null };

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function txt(tag, attrs, s, parent) { var e = el(tag, attrs, parent); e.textContent = s; return e; }
  function svgRoot(W, H, cls, label) { return el("svg", { viewBox: "0 0 " + W + " " + H, "class": cls || "", role: "img", "aria-label": label || "" }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function each(list, f) { Array.prototype.forEach.call(list, f); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function put(wrap, svg) { var old = wrap.querySelector("svg"); if (old) wrap.replaceChild(svg, old); else wrap.insertBefore(svg, wrap.firstChild); }

  // ---- formatting
  function fq(v) {
    if (v == null || isNaN(v)) return "–";
    if (!isFinite(v)) return "∞";
    var a = Math.abs(v);
    if (a >= 1e6) return fx(v / 1e6, a >= 1e7 ? 1 : 2) + "M";
    if (a >= 1e4) return Math.round(v / 1e3) + "k";
    if (a >= 100) return Math.round(v).toLocaleString(I.locale);
    return fx(v, a >= 10 ? 0 : 1);
  }
  function fu(v, unit) { return fq(v) + " " + unit; }
  function pct(u) { return u == null || isNaN(u) ? "–" : isFinite(u) ? Math.round(u * 100) + "%" : "∞"; }
  function pts(d) { var r = Math.round(d * 100); return (r > 0 ? "+" : r < 0 ? "−" : "±") + Math.abs(r) + " " + T("pts"); }
  function cls(u) { return u > 1 + 1e-9 ? "bad" : u >= 0.9 ? "warn" : "ok"; }
  function bin(u) { for (var i = 0; i < BINS.length; i++) if (u <= BINS[i].max) return BINS[i]; return BINS[BINS.length - 1]; }
  function dbin(d) { for (var i = 0; i < DBINS.length; i++) if (d <= DBINS[i].max) return DBINS[i]; return DBINS[DBINS.length - 1]; }
  function tierOf(id) { return P.tiersFor(state.net)[P.TIER_INDEX[id]]; }
  function tierName(id) { var t = tierOf(id); return t.custom ? t.name : T(t.name); }
  function tierOne(id) { var t = tierOf(id); return t.custom ? t.one : T(t.one); }
  function tierShort(id) { var t = tierOf(id); return t.custom ? t.short : T(t.short); }
  function tierUnit(id) { var t = tierOf(id); return t.customUnit ? t.unit : T(t.unit); }
  function unitOf(s) { return tierUnit(s.tier); }
  function nm(s) { return T(s.name); }
  function country(s) { return s.country ? T(s.country) : ""; }
  function monthLabel(m) { var c = state.net.config, mo = (c.startMonth + m) % 12; return MONTHS[mo] + " " + (c.startYear + Math.floor((c.startMonth + m) / 12)); }
  function pLabel(p) { return p.kind === "month" ? MONTHS[p.month] + " " + String(p.year).slice(2) : String(p.year); }
  function pLong(p) { return p.kind === "month" ? MONTHS[p.month] + " " + p.year : T("Year {n} ({a}–{b})", { n: 4 + (p.from - P.MONTHLY) / 12, a: monthLabel(p.from), b: monthLabel(p.to - 1) }); }
  function latLabel(lat) { return fx(Math.abs(lat), 1) + "°" + (lat < 0 ? T("S") : T("N")); }
  function byId(id) { for (var i = 0; i < state.net.sites.length; i++) if (state.net.sites[i].id === id) return state.net.sites[i]; return null; }
  function sitesOf(tier) { return state.net.sites.filter(function (s) { return s.tier === tier; }); }
  function customersOf(id) {
    var out = [];
    state.net.sites.forEach(function (s) {
      var sup = (s.suppliers || []).filter(function (l) { return l.share > 0; }), tot = sup.reduce(function (a, l) { return a + l.share; }, 0);
      sup.forEach(function (l) { if (l.from === id) out.push({ site: s, share: l.share / tot }); });
    });
    return out;
  }
  function sumR(s, a, b) { var t = 0; for (var i = a; i < b; i++) t += s[i]; return t; }
  // what the views show: the requirement plan, or the plan within capacity once it is solved
  function CAP() { return state.mode === "cap" && !!state.cres; }
  function VR() { return CAP() ? state.cres : state.res; }
  function cbin(u) { for (var i = 0; i < CBINS.length; i++) if (u <= CBINS[i].max) return CBINS[i]; return CBINS[CBINS.length - 1]; }

  // ---- the shared time axis: 36 monthly columns of one unit, then 10 yearly columns of two units
  function timeline(x0, x1) {
    var unit = (x1 - x0) / (P.MONTHLY + 2 * P.YEARLY);
    return {
      unit: unit, div: x0 + P.MONTHLY * unit,
      x: function (i) { return x0 + (i < P.MONTHLY ? i : P.MONTHLY + (i - P.MONTHLY) * 2) * unit; },
      w: function (i) { return (i < P.MONTHLY ? 1 : 2) * unit; }
    };
  }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  // a tooltip shared by one chart container
  function tipFor(wrap) {
    var t = wrap.querySelector(".tip");
    if (!t) { t = document.createElement("div"); t.className = "tip"; t.hidden = true; wrap.appendChild(t); }
    return {
      show: function (evt, html) {
        t.innerHTML = html; t.hidden = false;
        var r = wrap.getBoundingClientRect(), x = evt.clientX - r.left + 14, y = evt.clientY - r.top + 12;
        var w = t.offsetWidth, h = t.offsetHeight;
        if (x + w > r.width) x = Math.max(4, evt.clientX - r.left - w - 14);
        if (y + h > r.height + 40) y = Math.max(4, evt.clientY - r.top - h - 10);
        t.style.left = x + "px"; t.style.top = y + "px";
      },
      hide: function () { t.hidden = true; }
    };
  }
  function row(k, v) { return "<span>" + k + "<em>" + v + "</em></span>"; }
  function timeFrame(svg, tl, top, bottom) {
    el("line", { x1: tl.div, x2: tl.div, y1: top - 12, y2: bottom, "class": "divider" }, svg);
    txt("text", { x: tl.div - 4, y: top - 3, "text-anchor": "end", "class": "band" }, T("36 months"), svg);
    txt("text", { x: tl.div + 4, y: top - 3, "class": "band" }, T("10 years"), svg);
  }
  function timeTicks(svg, tl, y) {
    state.res.periods.forEach(function (p, i) {
      if (p.kind === "month" && (p.month === 0 || i === 0)) txt("text", { x: tl.x(i) + 1, y: y, "class": "tick" }, String(p.year), svg);
      if (p.kind === "year" && (i - P.MONTHLY) % 2 === 0) txt("text", { x: tl.x(i) + 1, y: y, "class": "tick" }, String(p.year), svg);
    });
  }

  // ---- plan and render
  function replan() {
    state.res = P.plan(state.net);
    var err = $("errors");
    if (!state.res.ok) { err.hidden = false; err.innerHTML = "<b>" + T("The network cannot be planned:") + "</b><br>" + state.res.errors.map(function (e) { return esc(I.tw(e)); }).join("<br>"); return false; }
    err.hidden = true; return true;
  }
  function render() {
    if (!replan()) return;
    if (!byId(state.sel)) { var c = state.net.sites.filter(function (s) { return s.tier !== "market"; }); state.sel = (c.filter(function (s) { return s.tier === "product"; })[0] || c[0] || state.net.sites[0]).id; }
    if (!byId(state.market) || byId(state.market).tier !== "market") state.market = sitesOf("market")[0].id;
    if (!sitesOf(state.tier).length) state.tier = (state.res.tiers.slice(1).filter(function (t) { return sitesOf(t.id).length; })[0] || { id: "warehouse" }).id;
    if (state.period != null && state.period >= state.res.periods.length) state.period = null;
    if (!state.pos) { state.ext = extent(); state.pos = layout(); }
    if (state.mode === "cap") {
      var key = solveKey();
      if (key !== state.ckey) {
        var hit = cached(key);
        if (hit) { state.cres = hit; state.ckey = key; state.solving = false; }
        else {
          // while it solves, the last plan stays on screen if it is of the same sites; otherwise the requirement plan
          var same = state.cres && state.net.sites.every(function (x) { return !!state.cres.sites[x.id]; }) && Object.keys(state.cres.sites).length === state.net.sites.length;
          if (!same) state.cres = null;
          requestSolve(key);
        }
      }
    }
    renderViews();
  }
  function renderViews() {
    renderHeadline(); renderKpis(); renderOutlook(); renderMap(); renderSite(); renderHeat(); renderNeeds(); renderTier(); renderLadder(); renderMultiples(); renderService(); renderSolveStatus();
  }
  function renderSelection() { renderMap(); renderSite(); renderHeat(); }

  // ---- headline and KPIs
  function firstOverall(res, net) {
    res = res || state.res; net = net || state.net;
    var best = null;
    net.sites.forEach(function (s) { if (s.tier === "market") return; var r = res.sites[s.id]; if (r.firstOver >= 0 && (!best || r.firstOver < best.m)) best = { m: r.firstOver, site: s }; });
    return best;
  }
  function demandTotal(fromM, toM, res, net) {
    res = res || state.res; net = net || state.net;
    var t = 0;
    net.sites.forEach(function (s) { if (s.tier !== "market") return; var d = res.sites[s.id].demand; for (var m = fromM; m < toM; m++) t += d[m]; });
    return t;
  }
  function overCount(res, net) { return net.sites.filter(function (s) { return s.tier !== "market" && res.sites[s.id].firstOver >= 0; }).length; }
  function renderHeadline() {
    var f = firstOverall(), y1 = demandTotal(0, 12), y13 = demandTotal(P.MONTHS - 12, P.MONTHS), unit = tierUnit("market");
    var over3 = state.net.sites.filter(function (s) { var r = state.res.sites[s.id]; return s.tier !== "market" && r.firstOver >= 0 && r.firstOver < P.MONTHLY; }).length;
    var h = T("Consumption grows from <b>{a}</b> in the first year to <b>{b}</b> in the last.", { a: fq(y1) + " " + unit, b: fq(y13) }) + " ";
    if (!f) h += "<b>" + T("Every site keeps up over all 13 years.") + "</b>";
    else {
      h += T("The first site to run short is <b>{site}</b> ({tier}) in <b>{when}</b>.", { site: esc(nm(f.site)), tier: tierOne(f.site.tier), when: monthLabel(f.m) }) + " ";
      h += over3 === 0 ? T("Nothing runs short within the 3-year monthly window.") : over3 === 1 ? T("<b>1 site</b> runs short within the 3-year monthly window.") : T("<b>{n} sites</b> run short within the 3-year monthly window.", { n: over3 });
    }
    if (CAP()) {
      var c = state.cres, fm = firstUnmetMarket();
      h = T("Consumption grows from <b>{a}</b> in the first year to <b>{b}</b> in the last.", { a: fq(y1) + " " + unit, b: fq(y13) }) + " " +
        T("Within capacity, the chain serves <b>{fill}</b> of demand over the 13 years; <b>{u}</b> cannot be supplied.", { fill: pctFine(c.fill), u: fu(c.unmet, unit) }) + " " +
        (fm ? T("The first demand left unmet is in <b>{when}</b>, at {m}.", { when: monthLabel(fm.m), m: esc(nm(fm.site)) }) : "<b>" + T("Every pack is delivered.") + "</b>");
      var bn = firstBinding(); if (bn) h += " " + T("The first site to run at capacity is <b>{s}</b>, in {when}.", { s: esc(nm(bn.site)), when: monthLabel(bn.m) });
    } else if (state.compare) h += " " + compareLine();
    $("headline").innerHTML = h;
  }
  function pctFine(u) { return u >= 0.9995 && u < 1 ? fx(u * 100, 2) + "%" : fx(u * 100, 1) + "%"; }
  function firstUnmetMarket() {
    var best = null; state.net.sites.forEach(function (s) { if (s.tier !== "market") return; var o = state.cres.sites[s.id]; if (o && o.firstUnmet >= 0 && (!best || o.firstUnmet < best.m)) best = { m: o.firstUnmet, site: s }; }); return best;
  }
  function firstBinding() {
    var best = null; state.net.sites.forEach(function (s) { if (s.tier === "market") return; var o = state.cres.sites[s.id]; if (o && o.firstBinding >= 0 && (!best || o.firstBinding < best.m)) best = { m: o.firstBinding, site: s }; }); return best;
  }
  function compareLine() {
    var c = state.compare, fa = firstOverall(), fb = firstOverall(c.res, c.net);
    var a = fa ? fa.m : Infinity, b = fb ? fb.m : Infinity;
    var w = a === b ? T("the first shortfall is the same") : a > b ? T("the first shortfall comes later") : T("the first shortfall comes sooner");
    return "<span class='cmp-note'>" + T("Against <b>{name}</b>: {what} ({a} vs {b}); {n} sites short at some point vs {m}.", {
      name: esc(c.label), what: w, a: fa ? monthLabel(fa.m) : T("never"), b: fb ? monthLabel(fb.m) : T("never"), n: overCount(state.res, state.net), m: overCount(c.res, c.net) }) + "</span>";
  }
  function C_pe(tier) { return window.TWConstrained ? window.TWConstrained.packEq(state.net)[tier] : 1; }
  function renderKpis() {
    var f = firstOverall(), y1 = demandTotal(0, 12), y13 = demandTotal(P.MONTHS - 12, P.MONTHS), unit = tierUnit("market");
    var nonM = state.net.sites.filter(function (s) { return s.tier !== "market"; }).length, over = overCount(state.res, state.net);
    var tight = null;
    state.res.tiers.slice(1).forEach(function (t) {
      if (!sitesOf(t.id).length) return;
      var u = P.tierSummary(state.res, state.net, t.id)[0].util;
      if (!tight || u > tight.u) tight = { t: t, u: u };
    });
    var longest = null;
    Object.keys(state.res.leadChain).forEach(function (id) { var c = state.res.leadChain[id]; if (!longest || c.total > longest.total) longest = { id: id, total: c.total }; });
    var tiles; tiles = [
      { l: T("Consumption, year 1"), v: fq(y1) + " " + unit, s: T("{n} a month on average", { n: fq(y1 / 12) }) },
      { l: T("Consumption, year 13"), v: fq(y13) + " " + unit, s: T("×{x} on year 1", { x: y1 > 0 ? fx(y13 / y1, 2) : "–" }) },
      { l: T("First shortfall"), v: f ? monthLabel(f.m) : T("None"), s: f ? nm(f.site) : T("within 13 years"), st: f ? (f.m < P.MONTHLY ? "critical" : "warning") : "good" },
      { l: T("Sites short at some point"), v: T("{n} of {m}", { n: over, m: nonM }), s: T("across the 13 years"), st: over ? "warning" : "good" },
      { l: T("Tightest tier, year 1"), v: tight ? pct(tight.u) : "–", s: tight ? tierName(tight.t.id) : "", st: tight && tight.u > 1 ? "critical" : tight && tight.u >= 0.9 ? "warning" : "" },
      { l: T("Longest chain"), v: longest ? T("{n} days", { n: Math.round(longest.total) }) : "–", s: longest ? T("raw ingredient to shelf, {m}", { m: nm(byId(longest.id)) }) : "" }
    ];
    if (CAP()) {
      var cr = state.cres, fm = firstUnmetMarket(), bn = firstBinding(), mk = sitesOf("market"), shortM = mk.filter(function (s) { return cr.sites[s.id].fill < 0.999; }).length, peakStock = 0, unitM = tierUnit("market");
      state.net.sites.forEach(function (s) { if (s.tier === "market" || s.tier === "warehouse") return; var o = cr.sites[s.id]; for (var m = 0; m < P.MONTHS; m++) peakStock = Math.max(peakStock, o.stock[m] * C_pe(s.tier)); });
      tiles = [
        { l: T("Fill rate, 13 years"), v: pctFine(cr.fill), s: T("of demand delivered within capacity"), st: cr.fill >= 0.995 ? "good" : cr.fill >= 0.95 ? "warning" : "critical" },
        { l: T("Demand not supplied"), v: fq(cr.unmet) + " " + unitM, s: T("{p} of the 13 years' demand", { p: pctFine(1 - cr.fill) }), st: cr.unmet > 0.5 ? "warning" : "good" },
        { l: T("First unmet demand"), v: fm ? monthLabel(fm.m) : T("None"), s: fm ? nm(fm.site) : T("within 13 years"), st: fm ? (fm.m < P.MONTHLY ? "critical" : "warning") : "good" },
        { l: T("Markets short at some point"), v: T("{n} of {m}", { n: shortM, m: mk.length }), s: T("below 99.9% served"), st: shortM ? "warning" : "good" },
        { l: T("First bottleneck"), v: bn ? monthLabel(bn.m) : T("None"), s: bn ? nm(bn.site) : T("no site at capacity") },
        { l: T("Volume re-sourced"), v: pctFine(cr.rerouted), s: T("of lane volume off its planned share") + " · " + T("stock ahead up to {n}", { n: fq(peakStock) + " " + unitM }) }
      ];
    } else if (state.compare) {
      var c = state.compare, fb = firstOverall(c.res, c.net), cy13 = demandTotal(P.MONTHS - 12, P.MONTHS, c.res, c.net);
      tiles[1].c = T("comparison: {v}", { v: fq(cy13) });
      tiles[2].c = T("comparison: {v}", { v: fb ? monthLabel(fb.m) : T("None") });
      tiles[3].c = T("comparison: {v}", { v: overCount(c.res, c.net) });
    }
    $("kpis").innerHTML = tiles.map(function (t) {
      return '<div class="kpi-tile' + (t.st ? " status-" + t.st : "") + '"><div class="kpi-label">' + t.l + '</div><div class="kpi-value">' + esc(t.v) + '</div><div class="kpi-sub">' + esc(t.s) + "</div>" + (t.c ? '<div class="kpi-sub cmp">' + esc(t.c) + "</div>" : "") + "</div>";
    }).join("");
  }
  function renderOutlook() {
    var h = "<thead><tr><th style='text-align:left'>" + T("Tier") + "</th><th>" + T("Unit") + "</th><th>" + T("Load, year 1<br>(a month)") + "</th><th>" + T("Capacity, year 1<br>(a month)") + "</th><th>" + T("Use, year 1") +
      "</th><th>" + T("Busiest month,<br>months 1–36") + "</th><th>" + T("Busiest month,<br>years 4–13") + "</th><th>" + T("Load, year 13<br>(a month)") + "</th><th style='text-align:left'>" + (CAP() ? T("First at capacity") : T("First short")) + "</th></tr></thead><tbody>";
    state.res.tiers.forEach(function (t) {
      var sites = sitesOf(t.id), head = "<tr><th><i class='swatch' style='background:" + TCOL[t.id] + "'></i>" + esc(tierName(t.id)) + " (" + sites.length + ")</th><td>" + esc(tierUnit(t.id)) + "</td>";
      if (t.id === "market") {
        var y1 = 0, y13 = 0; sites.forEach(function (s) { var d = state.res.sites[s.id].demand; for (var m = 0; m < 12; m++) y1 += d[m] / 12; for (m = P.MONTHS - 12; m < P.MONTHS; m++) y13 += d[m] / 12; });
        h += head + "<td>" + fq(y1) + "</td><td>–</td><td>–</td><td>–</td><td>–</td><td>" + fq(y13) + "</td><td style='text-align:left'>–</td></tr>";
        return;
      }
      var L1 = 0, C1 = 0, L13 = 0, pk1 = { u: 0 }, pk2 = { u: 0 }, first = null;
      sites.forEach(function (s) {
        var r = VR().sites[s.id];
        for (var m = 0; m < P.MONTHS; m++) {
          if (m < 12) { L1 += r.load[m] / 12; C1 += r.capacity[m] / 12; }
          if (m >= P.MONTHS - 12) L13 += r.load[m] / 12;
          var u = r.util[m], tgt = m < P.MONTHLY ? pk1 : pk2;
          if (u > tgt.u) { tgt.u = u; tgt.m = m; tgt.s = s; }
        }
        var fo = CAP() ? r.firstBinding : r.firstOver;
        if (fo >= 0 && (!first || fo < first.m)) first = { m: fo, s: s };
      });
      var u1 = C1 > 0 ? L1 / C1 : 0;
      h += head + "<td>" + fq(L1) + "</td><td>" + fq(C1) + "</td><td class='" + cls(u1) + "'>" + pct(u1) + "</td>" +
        "<td class='" + cls(pk1.u) + "' title='" + esc(pk1.s ? nm(pk1.s) + ", " + monthLabel(pk1.m) : "") + "'>" + pct(pk1.u) + "</td>" +
        "<td class='" + cls(pk2.u) + "' title='" + esc(pk2.s ? nm(pk2.s) + ", " + monthLabel(pk2.m) : "") + "'>" + pct(pk2.u) + "</td><td>" + fq(L13) + "</td>" +
        "<td style='text-align:left' class='" + (first ? (first.m < P.MONTHLY ? "bad" : "warn") : "ok") + "'>" + (first ? esc(nm(first.s)) + ", " + monthLabel(first.m) : T("Never")) + "</td></tr>";
    });
    $("outlook").innerHTML = h + "</tbody>";
  }

  // ---- the latitude map: its frame fits the network, with a margin, at a fixed shape
  var MAP = { W: 1000, H: 400 };
  function extent() {
    var la = state.net.sites.map(function (s) { return s.lat; }), lo = state.net.sites.map(function (s) { return s.lon; });
    var lat0 = Math.max.apply(null, la) + 10, lat1 = Math.min.apply(null, la) - 10, lon0 = Math.min.apply(null, lo) - 18, lon1 = Math.max.apply(null, lo) + 18;
    var want = MAP.W / MAP.H, spanLon = lon1 - lon0, spanLat = lat0 - lat1;
    if (spanLon / spanLat < want) { var d = (spanLat * want - spanLon) / 2; lon0 -= d; lon1 += d; } else { var e = (spanLon / want - spanLat) / 2; lat0 += e; lat1 -= e; }
    if (lat0 > 85) { lat1 -= lat0 - 85; lat0 = 85; } if (lat1 < -85) { lat0 += -85 - lat1; lat1 = -85; }
    return { lat0: Math.min(85, lat0), lat1: Math.max(-85, lat1), lon0: lon0, lon1: lon1 };
  }
  function proj(lon, lat) { var e = state.ext; return [(lon - e.lon0) / (e.lon1 - e.lon0) * MAP.W, (e.lat0 - lat) / (e.lat0 - e.lat1) * MAP.H]; }
  // spread sites that sit on top of each other (a DC beside its city, a dosing plant beside a packer) so each stays clickable
  function layout() {
    var pts = state.net.sites.map(function (s) { var p = proj(s.lon, s.lat); return { id: s.id, x0: p[0], y0: p[1], x: p[0], y: p[1] }; });
    for (var it = 0; it < 120; it++) {
      for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++) {
        var a = pts[i], b = pts[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy), min = 17;
        if (d < 0.01) { dx = 0.7 * ((i + j) % 2 ? 1 : -1); dy = 0.7; d = 1; }
        if (d < min) { var f = (min - d) / 2 / d; dx *= f; dy *= f; a.x -= dx; a.y -= dy; b.x += dx; b.y += dy; }
      }
      pts.forEach(function (p) { p.x += (p.x0 - p.x) * 0.02; p.y += (p.y0 - p.y) * 0.02; });
    }
    var out = {}; pts.forEach(function (p) { out[p.id] = p; }); return out;
  }
  function landPath() {
    if (!state.land) return "";
    return state.land.rings.map(function (r) {
      return "M" + r.map(function (c) { var p = proj(c[0], c[1]); return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join("L") + "Z";
    }).join("");
  }
  function renderMap() {
    var wrap = $("mapWrap"), tip = tipFor(wrap), e = state.ext;
    var svg = svgRoot(MAP.W, MAP.H, "map", T("Map of the supply network by latitude"));
    el("rect", { x: 0, y: 0, width: MAP.W, height: MAP.H, fill: "#08223f" }, svg);
    var step = e.lat0 - e.lat1 > 60 ? 15 : 10, lat;
    for (lat = Math.ceil(e.lat1 / step) * step; lat <= e.lat0; lat += step) el("line", { x1: 0, x2: MAP.W, y1: proj(0, lat)[1], y2: proj(0, lat)[1], "class": "grat" + (lat === 0 ? " eq" : "") }, svg);
    var lstep = e.lon1 - e.lon0 > 150 ? 30 : 15;
    for (var lon = Math.ceil(e.lon0 / lstep) * lstep; lon <= e.lon1; lon += lstep) { var x = proj(lon, 0)[0]; el("line", { x1: x, x2: x, y1: 0, y2: MAP.H, "class": "grat" }, svg); }
    el("path", { d: landPath(), "class": "land" }, svg);
    [23.44, -23.44].forEach(function (lt) { if (lt < e.lat0 && lt > e.lat1) { var yy = proj(0, lt)[1]; el("line", { x1: 0, x2: MAP.W, y1: yy, y2: yy, "class": "grat trop" }, svg); } });
    for (lat = Math.ceil(e.lat1 / step) * step; lat <= e.lat0; lat += step) if (proj(0, lat)[1] > 12) txt("text", { x: 4, y: proj(0, lat)[1] - 3, "class": "lat-label" }, lat === 0 ? T("Equator") : Math.abs(lat) + "°" + (lat < 0 ? T("S") : T("N")), svg);
    if (23.44 < e.lat0 && 23.44 > e.lat1) txt("text", { x: 4, y: proj(0, 23.44)[1] - 3, "class": "lat-label" }, T("Tropic of Cancer"), svg);
    if (-23.44 < e.lat0 && -23.44 > e.lat1) txt("text", { x: 4, y: proj(0, -23.44)[1] - 3, "class": "lat-label" }, T("Tropic of Capricorn"), svg);

    var sel = state.sel, related = {}; related[sel] = 1;
    var selSite = byId(sel);
    (selSite.suppliers || []).forEach(function (l) { related[l.from] = 1; });
    customersOf(sel).forEach(function (c) { related[c.site.id] = 1; });
    var lanes = el("g", {}, svg);
    state.net.sites.forEach(function (s) {
      (s.suppliers || []).forEach(function (l) {
        if (!(l.share > 0)) return;
        var u = byId(l.from); if (!u) return;
        var a = state.pos[u.id], b = state.pos[s.id], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
        var cx = mx - dy * 0.15, cy = my + dx * 0.15, hl = s.id === sel || u.id === sel;
        el("path", { d: "M" + a.x + "," + a.y + "Q" + cx + "," + cy + " " + b.x + "," + b.y, "class": "lane" + (hl ? " hl" : ""), stroke: TCOL[u.tier], "stroke-width": hl ? 2.2 : 0.6 + Math.min(100, l.share) / 100 * 1.4, style: hl ? null : "opacity:.32" }, lanes);
      });
    });
    var maxD = 0; sitesOf("market").forEach(function (s) { maxD = Math.max(maxD, state.res.sites[s.id].periods[0].value); });
    var order = state.net.sites.slice().sort(function (a, b) { return (a.id === sel) - (b.id === sel); });
    order.forEach(function (s) {
      var p = state.pos[s.id], r = VR().sites[s.id], g = el("g", { "class": "node" + (s.id === sel ? " sel" : ""), tabindex: 0, role: "button", "aria-label": nm(s) }, svg);
      var rad = s.tier === "market" ? 5 + 5 * Math.sqrt(maxD > 0 ? r.periods[0].value / maxD : 0) : 6;
      if (CAP()) {
        if (s.tier === "market" ? r.fill < 0.999 : r.firstBinding >= 0) el("circle", { cx: p.x, cy: p.y, r: rad + 4, "class": "halo", stroke: s.tier === "market" ? "var(--bad)" : "var(--warn)" }, g);
      } else if (s.tier !== "market" && r.peakUtil > 0.9) el("circle", { cx: p.x, cy: p.y, r: rad + 4, "class": "halo", stroke: r.peakUtil > 1 + 1e-9 ? "var(--bad)" : "var(--warn)" }, g);
      el("circle", { cx: p.x, cy: p.y, r: rad, "class": "core", fill: TCOL[s.tier] }, g);
      el("circle", { cx: p.x, cy: p.y, r: rad + 8, fill: "transparent" }, g);
      if (related[s.id]) {
        var lab = txt("text", { x: p.x + rad + 5, y: p.y + 4, "paint-order": "stroke", stroke: "#08223f", "stroke-width": 3 }, nm(s), g);
        if (p.x > MAP.W - 150) { lab.setAttribute("x", p.x - rad - 5); lab.setAttribute("text-anchor", "end"); }
        if (s.id === sel) lab.style.fill = "var(--ink)";
      }
      g.addEventListener("mousemove", function (ev) {
        var h = "<b>" + esc(nm(s)) + "</b>" + row(esc(tierOne(s.tier)), "") + row(esc(country(s)), latLabel(s.lat));
        if (s.tier === "market") { h += row(T("Demand, month 1"), fu(r.periods[0].value, unitOf(s))); if (CAP()) h += row(T("Fill rate"), pctFine(r.fill)); }
        else if (CAP()) h += row(T("Busiest month"), pct(r.peakUtil)) + row(T("First at capacity"), r.firstBinding >= 0 ? monthLabel(r.firstBinding) : T("never"));
        else h += row(T("Busiest month"), pct(r.peakUtil)) + row(T("First short"), r.firstOver >= 0 ? monthLabel(r.firstOver) : T("never"));
        tip.show(ev, h);
      });
      g.addEventListener("mouseleave", tip.hide);
      g.addEventListener("click", function () { select(s.id); });
      g.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(s.id); } });
    });
    put(wrap, svg);
    $("mapLegend").innerHTML = state.res.tiers.map(function (t) { return "<span><i style='background:" + TCOL[t.id] + "'></i>" + esc(tierName(t.id)) + "</span>"; }).join("") +
      (CAP() ? "<span><i class='ring' style='border-color:var(--warn)'></i>" + T("At capacity at some point") + "</span><span><i class='ring' style='border-color:var(--bad)'></i>" + T("Demand not fully met") + "</span>"
        : "<span><i class='ring' style='border-color:var(--warn)'></i>" + T("Above 90% at peak") + "</span><span><i class='ring' style='border-color:var(--bad)'></i>" + T("Short at some point") + "</span>");
  }
  function select(id, period) {
    state.sel = id; state.period = period != null ? period : null;
    var s = byId(id);
    if (s.tier === "market") { state.market = id; $("ladderMkt").value = id; renderLadder(); }
    else if (state.tier !== s.tier) { state.tier = s.tier; renderTier(); }
    renderSelection();
  }

  // ---- the selected site
  function defaultPeriod(r) {
    if (r.firstOver >= 0) { for (var i = 0; i < state.res.periods.length; i++) { var p = state.res.periods[i]; if (r.firstOver >= p.from && r.firstOver < p.to) return i; } }
    var best = 0; r.periods.forEach(function (q, i) { if (q.peak > r.periods[best].peak) best = i; }); return best;
  }
  function renderSite() {
    var s = byId(state.sel), r = VR().sites[s.id], unit = unitOf(s), hemi = s.lat < 0 ? T("southern hemisphere") : T("northern hemisphere");
    $("siteHead").innerHTML = "<span class='chip'><i style='background:" + TCOL[s.tier] + "'></i>" + esc(tierName(s.tier)) + "</span>" +
      "<p class='site-title'>" + esc(nm(s)) + "</p><p class='site-meta'>" + esc([country(s), latLabel(s.lat), hemi].filter(Boolean).join(" · ")) + "</p>";
    var facts, m;
    if (s.tier === "market") {
      var d = r.demand, y1 = sumR(d, 0, 12), y13 = sumR(d, P.MONTHS - 12, P.MONTHS);
      var pk = (state.net.config.demandPeak + (s.lat < 0 ? 6 : 0)) % 12;
      facts = [
        { l: T("Year 1"), v: fq(y1), s: unit + (s.launch ? " · " + T("launches {m}", { m: monthLabel(s.launch) }) : "") },
        { l: T("Year 13"), v: fq(y13), s: unit },
        { l: T("Growth"), v: fx(s.growth || 0, 1).replace(/[.,]0$/, "") + "%", s: T("a year, then {g}%", { g: fx(s.longGrowth != null ? s.longGrowth : s.growth || 0, 1).replace(/[.,]0$/, "") }) },
        { l: T("Peak month"), v: MONTHS[pk], s: T("±{n}% swing", { n: s.season || 0 }) }
      ];
      if (CAP()) facts.splice(1, 2, { l: T("Fill rate"), v: pctFine(r.fill), s: T("{n} not supplied", { n: fu(sumR(r.unmet, 0, P.MONTHS), unit) }), c: r.fill >= 0.999 ? "ok" : r.fill >= 0.95 ? "warn" : "bad" },
        { l: T("First unmet"), v: r.firstUnmet >= 0 ? monthLabel(r.firstUnmet) : T("Never"), s: r.firstUnmet >= 0 ? T("month {n} of 156", { n: r.firstUnmet + 1 }) : T("within 13 years"), c: r.firstUnmet >= 0 ? "warn" : "ok" });
    } else if (CAP()) {
      var pkc = 0, ps = 0, psm = 0; for (m = 0; m < P.MONTHS; m++) { if (r.util[m] > r.util[pkc]) pkc = m; if (r.stock[m] > ps) { ps = r.stock[m]; psm = m; } }
      facts = [
        { l: T("Capacity"), v: fq(r.capacity[0]), s: T("{u} a month", { u: unit }) + (s.tier === "raw" ? T(", month 1") : "") },
        { l: T("Busiest month"), v: pct(r.peakUtil), s: monthLabel(pkc), c: r.peakUtil > 0.995 ? "warn" : "ok" },
        { l: T("First at capacity"), v: r.firstBinding >= 0 ? monthLabel(r.firstBinding) : T("Never"), s: r.firstBinding >= 0 ? T("a bottleneck from then on") : T("never a bottleneck"), c: r.firstBinding >= 0 ? "warn" : "ok" },
        { l: T("Stock, peak"), v: fq(ps), s: ps > 0 ? T("{u}, in {m}", { u: unit, m: monthLabel(psm) }) : unit }
      ];
    } else {
      var pkm = 0; for (m = 0; m < P.MONTHS; m++) if (r.util[m] > r.util[pkm]) pkm = m;
      facts = [
        { l: T("Capacity"), v: fq(r.capacity[0]), s: T("{u} a month", { u: unit }) + (s.tier === "raw" ? T(", month 1") : "") },
        { l: T("Busiest month"), v: pct(r.peakUtil), s: monthLabel(pkm), c: cls(r.peakUtil) },
        { l: T("First short"), v: r.firstOver >= 0 ? monthLabel(r.firstOver) : T("Never"), s: r.firstOver >= 0 ? T("month {n} of 156", { n: r.firstOver + 1 }) : T("within 13 years"), c: r.firstOver >= 0 ? (r.firstOver < P.MONTHLY ? "bad" : "warn") : "ok" },
        s.tier === "warehouse" ? { l: T("Handling · cover"), v: T("{h} d · {c} wk", { h: s.handling || 0, c: s.cover != null ? s.cover : state.net.config.cover }), s: T("safety stock {n}", { n: fu(r.ss[0], unit) }) }
          : { l: T("Lead · release"), v: T("{a} d · {b} d", { a: s.lead || 0, b: s.release || 0 }), s: T("yield {y}%", { y: fx(s.yield != null ? s.yield : 100, 1).replace(/[.,]0$/, "") }) }
      ];
    }
    $("siteFacts").innerHTML = facts.map(function (f) { return "<div class='fact" + (f.c ? " " + f.c : "") + "'><span>" + f.l + "</span><b>" + esc(f.v) + "</b><small>" + esc(f.s) + "</small></div>"; }).join("");
    siteChart(s, r, unit);
    renderDrivers(s, r, unit);
    renderRequired(s, r, unit);
    var h = "";
    var sup = (s.suppliers || []).filter(function (l) { return l.share > 0; }), tot = sup.reduce(function (a, l) { return a + l.share; }, 0);
    if (sup.length && s.tier !== "raw") h += "<p class='lanes'><b>" + T("Supplied by") + "</b> " + sup.map(function (l) {
      var u = byId(l.from); return "<button class='linkish' data-sel='" + esc(u.id) + "'>" + esc(nm(u)) + "</button> " + T("{p}% · {d} d transit", { p: Math.round(l.share / tot * 100), d: Math.round(state.res.transit[l.from + ">" + s.id]) });
    }).join("; ") + "</p>";
    if (CAP() && s.tier !== "raw") {
      var mine = state.cres.lanes.filter(function (l) { return l.to === s.id && l.total > 1e-6; });
      if (mine.length) h += "<p class='lanes'><b>" + T("Within capacity") + "</b> " + mine.map(function (l) {
        return "<button class='linkish' data-sel='" + esc(l.from) + "'>" + esc(nm(byId(l.from))) + "</button> " + T("{a}% (planned {p}%)", { a: Math.round(l.actual * 100), p: Math.round(l.share * 100) });
      }).join("; ") + "</p>";
    }
    var cus = customersOf(s.id);
    if (cus.length) h += "<p class='lanes'><b>" + T("Supplies") + "</b> " + cus.map(function (c) {
      return "<button class='linkish' data-sel='" + esc(c.site.id) + "'>" + esc(nm(c.site)) + "</button> " + T("({p}% of its need)", { p: Math.round(c.share * 100) });
    }).join("; ") + "</p>";
    if (s.tier === "raw") h += "<p class='lanes'>" + T("Capacity follows the milk season: ±{a}% at {lat}, highest in {m}.", { a: Math.round(P.rawSeasonAmplitude(s.lat, state.net.config.rawSeasonMax / 100) * 100), lat: latLabel(s.lat), m: MONTHS[(state.net.config.rawPeak + (s.lat < 0 ? 6 : 0)) % 12] }) + "</p>";
    $("siteLanes").innerHTML = h;
    each($("siteLanes").querySelectorAll("[data-sel]"), function (b) { b.addEventListener("click", function () { select(b.getAttribute("data-sel")); }); });
  }
  function siteChart(s, r, unit) {
    var wrap = $("siteChart"), tip = tipFor(wrap), W = 640, H = 230, L = 52, R = 8, T0 = 30, B = 22;
    var tl = timeline(L, W - R), per = state.res.periods, isM = s.tier === "market";
    var load = per.map(function (p, i) { return isM ? r.periods[i].value : r.periods[i].load; });
    var capA = isM ? null : per.map(function (p, i) { return r.periods[i].capacity; });
    var peakL = isM ? null : per.map(function (p, i) { return p.kind === "year" ? r.load[r.periods[i].peakMonth] : null; });
    var peakC = isM ? null : per.map(function (p, i) { return p.kind === "year" ? r.capacity[r.periods[i].peakMonth] : null; });
    var cr = !CAP() && state.compare && state.compare.res.sites[s.id], cmp = cr ? per.map(function (p, i) { return isM ? cr.periods[i].value : cr.periods[i].load; }) : null;
    // within capacity: what unlimited capacity would need (dashed), and the demand left unmet (red, on top)
    if (CAP() && !isM) cmp = per.map(function (p, i) { return r.periods[i].required; });
    var unmetA = CAP() && isM ? per.map(function (p, i) { return r.periods[i].unmet; }) : null;
    var mx = 0; load.forEach(function (v, i) { mx = Math.max(mx, v, capA ? capA[i] : 0, peakL && peakL[i] ? peakL[i] : 0, cmp ? cmp[i] : 0); });
    mx = niceMax(mx * 1.05);
    var y = function (v) { return T0 + (H - T0 - B) * (1 - v / mx); };
    var svg = svgRoot(W, H, "", isM ? T("Demand of {s}", { s: nm(s) }) : T("Load and capacity of {s}", { s: nm(s) }));
    for (var k = 0; k <= 4; k++) { var v = mx * k / 4; el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), "class": k ? "grid" : "axis" }, svg); txt("text", { x: L - 6, y: y(v) + 3, "text-anchor": "end", "class": "tick" }, fq(v), svg); }
    timeFrame(svg, tl, T0, H - B); timeTicks(svg, tl, H - 6);
    var selP = state.period != null ? state.period : (isM ? null : defaultPeriod(r));
    if (selP != null && !isM) el("rect", { x: tl.x(selP), y: T0 - 2, width: tl.w(selP), height: H - T0 - B + 2, fill: "rgba(125,211,252,.10)" }, svg);
    load.forEach(function (v, i) {
      var x = tl.x(i) + 1, w = Math.max(1, tl.w(i) - 2), over = capA && v > capA[i] * (1 + 1e-6) + 1e-9;
      el("rect", { x: x, y: y(v), width: w, height: Math.max(0, y(0) - y(v)), rx: Math.min(2, w / 3), fill: TCOL[s.tier] }, svg);
      if (over) el("rect", { x: x, y: y(v), width: w, height: Math.max(0, y(capA[i]) - y(v)), fill: "var(--bad)" }, svg);
      if (unmetA && unmetA[i] > 0) el("rect", { x: x, y: y(v), width: w, height: Math.max(0, y(v - unmetA[i]) - y(v)), fill: "var(--bad)" }, svg);
      if (peakL && peakL[i] != null) el("line", { x1: x, x2: x + w, y1: y(peakL[i]), y2: y(peakL[i]), stroke: "var(--ink)", "stroke-width": 2 }, svg);
    });
    if (capA) { var d = ""; capA.forEach(function (c, i) { d += (i ? "L" : "M") + tl.x(i) + "," + y(c) + "H" + (tl.x(i) + tl.w(i)); }); el("path", { d: d, fill: "none", stroke: "var(--tele)", "stroke-width": 2 }, svg); }
    if (cmp) { var d2 = ""; cmp.forEach(function (c, i) { d2 += (i ? "L" : "M") + tl.x(i) + "," + y(c) + "H" + (tl.x(i) + tl.w(i)); }); el("path", { d: d2, fill: "none", stroke: "var(--ink-dim)", "stroke-width": 1.5, "stroke-dasharray": "4 3" }, svg); }
    per.forEach(function (p, i) {
      var hit = el("rect", { x: tl.x(i), y: T0, width: tl.w(i), height: H - T0 - B, "class": "hit" }, svg);
      hit.addEventListener("mousemove", function (e) {
        var h = "<b>" + pLong(p) + "</b>" + row(isM ? T("Demand (a month)") : T("Load (a month)"), fu(load[i], unit));
        if (capA) {
          h += row(T("Capacity (a month)"), fu(capA[i], unit)) + row(T("Utilisation"), pct(r.periods[i].util));
          if (p.kind === "year") h += row(T("Busiest month"), monthLabel(r.periods[i].peakMonth)) + row("&nbsp;&nbsp;" + T("load / capacity"), fq(peakL[i]) + " / " + fq(peakC[i])) + row("&nbsp;&nbsp;" + T("utilisation"), pct(r.periods[i].peak));
        }
        if (cmp) h += CAP() ? row(T("Needed with unlimited capacity"), fu(cmp[i], unit)) + row(T("Stock (a month)"), fu(r.periods[i].stock, unit)) : row(T("Comparison"), fu(cmp[i], unit));
        if (unmetA) h += row(T("Delivered (a month)"), fu(load[i] - unmetA[i], unit)) + row(T("Not supplied (a month)"), fu(unmetA[i], unit));
        if (!isM) h += "<span class='tip-hint'>" + T("Click to see what drives it") + "</span>";
        tip.show(e, h);
      });
      hit.addEventListener("mouseleave", tip.hide);
      if (!isM) hit.addEventListener("click", function () { state.period = i; renderSite(); });
    });
    put(wrap, svg);
    var leg = wrap.querySelector(".legend"); if (!leg) { leg = document.createElement("div"); leg.className = "legend"; wrap.appendChild(leg); }
    leg.innerHTML = (isM ? "<span><i class='sq' style='background:" + TCOL.market + "'></i>" + T("Demand, {u} a month (average in a yearly period)", { u: unit }) + "</span>"
      : "<span><i class='sq' style='background:" + TCOL[s.tier] + "'></i>" + T("Load, {u} a month (average)", { u: unit }) + "</span><span><i class='sq' style='background:var(--bad)'></i>" + T("Load above capacity") +
        "</span><span><i class='sq' style='background:var(--ink);height:2px'></i>" + T("Busiest month's load") + "</span><span><i class='sq' style='background:var(--tele);height:2px'></i>" + T("Capacity") + "</span>") +
      (unmetA ? "<span><i class='sq' style='background:var(--bad)'></i>" + T("Not supplied") + "</span>" : "") +
      (cmp ? "<span><i class='sq dash'></i>" + (CAP() ? T("Needed with unlimited capacity") : T("Comparison: {name}", { name: esc(state.compare.label) })) + "</span>" : "");
  }
  // what drives the selected site's load in one period: the consumption points behind it, and its direct customers
  function renderDrivers(s, r, unit) {
    var box = $("drivers");
    if (s.tier === "market") { box.hidden = true; return; }
    box.hidden = false;
    var i = state.period != null ? state.period : defaultPeriod(r), p = state.res.periods[i], n = p.to - p.from, tot = sumR(r.load, p.from, p.to);
    var bars = function (list, col) {
      var mx = list.reduce(function (a, x) { return Math.max(a, x.v); }, 0);
      return list.filter(function (x) { return x.v > tot * 1e-6; }).map(function (x) {
        return "<div class='bar-row'><button class='linkish' data-sel='" + esc(x.id) + "'>" + esc(x.name) + "</button><span class='bar'><i style='width:" + (mx > 0 ? (x.v / mx * 100).toFixed(1) : 0) + "%;background:" + (x.col || col) + "'></i></span><em>" + pct(tot > 0 ? x.v / tot : 0) + " · " + fq(x.v / n) + "</em></div>";
      }).join("");
    };
    var mk = Object.keys(r.byMarket || {}).map(function (id) { return { id: id, name: nm(byId(id)), v: sumR(r.byMarket[id], p.from, p.to) }; }).sort(function (a, b) { return b.v - a.v; });
    var cu = Object.keys(r.byCustomer || {}).map(function (id) { var c = byId(id); return { id: id, name: nm(c), v: sumR(r.byCustomer[id], p.from, p.to), col: TCOL[c.tier] }; }).sort(function (a, b) { return b.v - a.v; });
    var q = r.periods[i];
    box.innerHTML = "<h3 class='sub-h'>" + T("What drives the load in {p}", { p: pLong(p) }) + "</h3>" + (CAP() ? "<p class='chart-sub'>" + T("From the requirement plan: what the markets would ask of this site with unlimited capacity.") + "</p>" : "") + "<p class='chart-sub'>" +
      T("Load {l} a month against capacity {c} ({u}). Click a bar of the chart above, or a cell of the heatmap, to look at another period.", { l: fu(q.load, unit), c: fq(q.capacity), u: pct(q.util) }) + "</p>" +
      "<div class='drivers'><div><p class='mini-h'>" + T("By consumption point") + "</p>" + bars(mk, TCOL.market) + "</div>" +
      (cu.length ? "<div><p class='mini-h'>" + T("By direct customer") + "</p>" + bars(cu) + "</div>" : "") + "</div>";
    each(box.querySelectorAll("[data-sel]"), function (b) { b.addEventListener("click", function () { select(b.getAttribute("data-sel")); }); });
  }
  function requiredFor(id) { return P.requiredCapacity(state.net, state.res, id, state.target); }
  // the additions, the first few in full and the rest counted
  function addsText(q, unit, max) {
    max = max || 3;
    var a = q.additions, s = a.slice(0, max).map(function (x) { return T("+{n} from {m}", { n: fu(x.add, unit), m: monthLabel(x.from) }); }).join("; ");
    if (a.length > max) { var rest = a.slice(max), sum = rest.reduce(function (t, x) { return t + x.add; }, 0); s += "; " + T("then {k} more, {n} in all, to {m}", { k: rest.length, n: fu(sum, unit), m: monthLabel(rest[rest.length - 1].from) }); }
    return s;
  }
  function renderRequired(s, r, unit) {
    var box = $("required");
    if (s.tier === "market") { box.hidden = true; return; }
    box.hidden = false;
    var q = requiredFor(s.id);
    if (!q.additions.length) { box.innerHTML = "<h3 class='sub-h'>" + T("Capacity to add") + "</h3><p class='lanes'>" + T("None: {s} stays at or under {t} in every month of the 13 years.", { s: esc(nm(s)), t: pct(state.target) }) + "</p>"; return; }
    box.innerHTML = "<h3 class='sub-h'>" + T("Capacity to add") + "</h3><p class='lanes'>" + T("To stay at or under <b>{t}</b> in every month, reviewed once a year: {list}. In total <b>{n}</b>, {x} of today's capacity.", {
      t: pct(state.target), list: addsText(q, unit), n: fu(q.total, unit), x: q.today > 0 ? pct(q.total / q.today) : "–" }) + "</p><button class='btn small' type='button' id='applyOne'>" + T("Add these as expansions") + "</button>";
    $("applyOne").addEventListener("click", function () { applyAdds([s.id]); });
  }
  function applyAdds(ids) {
    var qs = ids.map(function (id) { return { id: id, q: requiredFor(id) }; });
    qs.forEach(function (x) { var s = byId(x.id); if (!x.q || !x.q.additions.length) return; s.expansions = (s.expansions || []).concat(x.q.additions).sort(function (a, b) { return a.from - b.from; }); });
    renderEditor(); render();
  }

  // ---- the capacity heatmap, or its change against the comparison
  function heatValue(r, i) { var p = state.res.periods[i]; return p.kind === "year" && state.colorBy === "avg" ? r.periods[i].util : r.periods[i].peak; }
  function heatValueOf(r, i, periods) { var p = periods[i]; return p.kind === "year" && state.colorBy === "avg" ? r.periods[i].util : r.periods[i].peak; }
  function renderHeat() {
    var wrap = $("heatWrap"), tip = tipFor(wrap), per = state.res.periods, diff = state.heatMode === "diff" && state.compare && !CAP();
    var LBL = 236, W = 1240, RH = 17, TH = 19, top = 50;
    var groups = state.res.tiers.slice(1).map(function (t) { return { t: t, sites: sitesOf(t.id) }; }).filter(function (g) { return g.sites.length; });
    var H = top + groups.reduce(function (a, g) { return a + TH + g.sites.length * RH; }, 0) + 6;
    var tl = timeline(LBL, W - 4), svg = svgRoot(W, H, "heat", diff ? T("Change in capacity utilisation against the comparison") : T("Capacity utilisation of every site in every period"));
    txt("text", { x: LBL, y: 12, "class": "band" }, T("Monthly · 36 months"), svg);
    txt("text", { x: tl.div + 4, y: 12, "class": "band" }, T("Yearly · 10 years"), svg);
    per.forEach(function (p, i) {
      if (p.kind === "month") {
        if (p.month === 0 || i === 0) txt("text", { x: tl.x(i) + 1, y: 28, "class": "collab" }, String(p.year), svg);
        txt("text", { x: tl.x(i) + tl.w(i) / 2, y: 44, "text-anchor": "middle", "class": "collab" }, MONTHS[p.month].charAt(0).toUpperCase(), svg);
      } else txt("text", { x: tl.x(i) + tl.w(i) / 2, y: 44, "text-anchor": "middle", "class": "collab" }, "'" + String(p.year).slice(2), svg);
    });
    var y = top, cmpRes = diff ? state.compare.res : null;
    groups.forEach(function (g) {
      el("circle", { cx: 6, cy: y + TH / 2 + 1, r: 4, fill: TCOL[g.t.id] }, svg);
      txt("text", { x: 15, y: y + TH / 2 + 5, "class": "tierlab" }, tierName(g.t.id) + " · " + tierUnit(g.t.id), svg);
      y += TH;
      g.sites.forEach(function (s) {
        var r = VR().sites[s.id], yy = y, cr = cmpRes ? cmpRes.sites[s.id] : null;
        if (s.id === state.sel) el("rect", { x: 0, y: yy, width: W, height: RH, "class": "rowsel" }, svg);
        var lab = txt("text", { x: 15, y: yy + RH - 5, "class": "rowlab" + (s.id === state.sel ? " sel" : "") }, nm(s), svg);
        lab.addEventListener("click", function () { select(s.id); });
        per.forEach(function (p, i) {
          var u = heatValue(r, i), cu = cr && cr.periods ? heatValueOf(cr, i, cmpRes.periods) : null;
          var fill = diff ? (cu == null ? NA : dbin(u - cu).c) : CAP() ? cbin(u).c : bin(u).c;
          var c = el("rect", { x: tl.x(i), y: yy, width: tl.w(i), height: RH, fill: fill, "class": "cell" + (i === state.period && s.id === state.sel ? " cur" : "") }, svg);
          c.addEventListener("mousemove", function (e) {
            var q = r.periods[i], unit = unitOf(s);
            var h = "<b>" + esc(nm(s)) + " · " + pLong(p) + "</b>" + row(T("Load (a month)"), fu(q.load, unit)) + row(T("Capacity (a month)"), fu(q.capacity, unit)) + row(p.kind === "year" ? T("Year average") : T("Utilisation"), pct(q.util));
            if (p.kind === "year") h += row(T("Busiest month"), pct(q.peak) + ", " + MONTHS[(state.net.config.startMonth + q.peakMonth) % 12]);
            if (q.gap > 0) h += row(T("Short by"), T("{n} in total", { n: fu(q.gap, unit) }));
            if (CAP()) h += row(T("Needed with unlimited capacity"), fu(q.required, unit)) + row(T("Stock (a month)"), fu(q.stock, unit));
            if (diff) h += cu == null ? row(T("Comparison"), T("not in it")) : row(T("Comparison"), pct(cu)) + row(T("Change"), pts(u - cu));
            tip.show(e, h);
          });
          c.addEventListener("mouseleave", tip.hide);
          c.addEventListener("click", function () { select(s.id, i); });
        });
        y += RH;
      });
    });
    el("line", { x1: tl.div, x2: tl.div, y1: 2, y2: H, "class": "divider", "stroke-width": 1.5 }, svg);
    put(wrap, svg);
    var sw = function (c, l) { return "<span class='sw'><i style='background:" + c + "'></i>" + l + "</span>"; };
    $("heatScale").innerHTML = diff ? T("Change in utilisation, points") + DBINS.map(function (b) { return sw(b.c, b.l); }).join("") + sw(NA, T("not in the comparison")) + "<span class='cmp-note'>" + T("blue: less loaded than in <b>{name}</b>; red: more", { name: esc(state.compare.label) }) + "</span>"
      : CAP() ? T("Utilisation within capacity") + CBINS.map(function (b) { return sw(b.c, b.l === "at capacity" ? T("at capacity (bottleneck)") : b.l); }).join("")
      : T("Utilisation") + BINS.map(function (b) { return sw(b.c, b.l); }).join("");
    $("heatModeBox").hidden = !state.compare || CAP();
    each($("heatMode").querySelectorAll("button"), function (b) { b.classList.toggle("active", b.getAttribute("data-v") === (diff ? "diff" : "plan")); });
    if (!$("table-heat").hidden) tableHeat();
  }
  function tableHeat() {
    var per = state.res.periods, diff = state.heatMode === "diff" && state.compare && !CAP();
    var h = "<table><thead><tr><th>" + T("Site") + "</th>" + per.map(function (p) { return "<th>" + pLabel(p) + "</th>"; }).join("") + "</tr></thead><tbody>";
    state.net.sites.forEach(function (s) {
      if (s.tier === "market") return;
      var r = VR().sites[s.id], cr = diff ? state.compare.res.sites[s.id] : null;
      h += "<tr><th>" + esc(nm(s)) + "</th>" + per.map(function (p, i) { var u = heatValue(r, i); return "<td>" + (diff ? (cr && cr.periods ? pts(u - heatValueOf(cr, i, state.compare.res.periods)) : "–") : pct(u)) + "</td>"; }).join("") + "</tr>";
    });
    $("table-heat").innerHTML = h + "</tbody></table>";
  }

  // ---- capacity to add, every site
  function renderNeeds() {
    var list = state.net.sites.filter(function (s) { return s.tier !== "market"; }).map(function (s) { return { s: s, q: requiredFor(s.id) }; }).filter(function (x) { return x.q && x.q.additions.length; });
    list.sort(function (a, b) { return a.q.firstNeed - b.q.firstNeed; });
    $("needsNote").innerHTML = T("To keep every site at or under <b>{t}</b> in every month, reviewed once a year, {n} of {m} sites need more capacity. Additions are sized for the busiest month until the next review.", {
      t: pct(state.target), n: list.length, m: state.net.sites.filter(function (s) { return s.tier !== "market"; }).length });
    if (!list.length) { $("needs").innerHTML = "<p class='lanes'>" + T("No site needs more capacity at this target.") + "</p>"; $("applyAll").hidden = true; return; }
    $("applyAll").hidden = false;
    $("needs").innerHTML = "<table class='outlook needs'><thead><tr><th style='text-align:left'>" + T("Site") + "</th><th style='text-align:left'>" + T("Tier") + "</th><th>" + T("First addition") + "</th><th style='text-align:left'>" + T("Additions") +
      "</th><th>" + T("Total added") + "</th><th>" + T("vs today") + "</th></tr></thead><tbody>" + list.map(function (x) {
        var u = unitOf(x.s);
        return "<tr><th><button class='linkish' data-sel='" + esc(x.s.id) + "'>" + esc(nm(x.s)) + "</button></th><td style='text-align:left'><i class='swatch' style='background:" + TCOL[x.s.tier] + "'></i>" + esc(tierShort(x.s.tier)) +
          "</td><td>" + monthLabel(x.q.firstNeed) + "</td><td style='text-align:left;white-space:normal'>" + esc(addsText(x.q, u, 2)) + "</td><td>" + fu(x.q.total, u) + "</td><td>" + (x.q.today > 0 ? "+" + pct(x.q.total / x.q.today) : "–") + "</td></tr>";
      }).join("") + "</tbody></table>";
    each($("needs").querySelectorAll("[data-sel]"), function (b) { b.addEventListener("click", function () { select(b.getAttribute("data-sel")); $("sitePanel").scrollIntoView({ block: "start", behavior: "smooth" }); }); });
  }

  // ---- load by tier (more than six sites: the five largest and the rest together)
  function tierSeries() {
    var sites = sitesOf(state.tier).map(function (s) { return { s: s, tot: sumR(state.res.sites[s.id].load, 0, P.MONTHS) }; });
    if (sites.length <= 6) return sites.map(function (x, j) { return { name: nm(x.s), col: CAT[j], ids: [x.s.id] }; });
    sites.sort(function (a, b) { return b.tot - a.tot; });
    var out = sites.slice(0, 5).map(function (x, j) { return { name: nm(x.s), col: CAT[j], ids: [x.s.id] }; });
    out.push({ name: T("Other ({n} sites)", { n: sites.length - 5 }), col: OTHER, ids: sites.slice(5).map(function (x) { return x.s.id; }) });
    return out;
  }
  function seriesLoad(ser, i) { return ser.ids.reduce(function (a, id) { return a + VR().sites[id].periods[i].load; }, 0); }
  function renderTier() {
    var seg = $("tierSeg");
    seg.innerHTML = state.res.tiers.slice(1).filter(function (t) { return sitesOf(t.id).length; }).map(function (t) { return "<button type='button' data-t='" + t.id + "'" + (t.id === state.tier ? " class='active'" : "") + ">" + esc(tierShort(t.id)) + "</button>"; }).join("");
    each(seg.querySelectorAll("button"), function (b) { b.addEventListener("click", function () { state.tier = b.getAttribute("data-t"); renderTier(); }); });
    var wrap = $("tierChart"), tip = tipFor(wrap), W = 640, H = 240, L = 52, R = 8, T0 = 30, B = 22;
    var tl = timeline(L, W - R), per = state.res.periods, ser = tierSeries(), unit = tierUnit(state.tier);
    var ts = P.tierSummary(VR(), state.net, state.tier);
    var mx = 0; ts.forEach(function (q) { mx = Math.max(mx, q.load, q.capacity); }); mx = niceMax(mx * 1.05);
    var y = function (v) { return T0 + (H - T0 - B) * (1 - v / mx); };
    var svg = svgRoot(W, H, "", T("Load by site against capacity, {t}", { t: tierName(state.tier) }));
    for (var k = 0; k <= 4; k++) { var v = mx * k / 4; el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), "class": k ? "grid" : "axis" }, svg); txt("text", { x: L - 6, y: y(v) + 3, "text-anchor": "end", "class": "tick" }, fq(v), svg); }
    timeFrame(svg, tl, T0, H - B); timeTicks(svg, tl, H - 6);
    per.forEach(function (p, i) {
      var base = 0, x = tl.x(i) + 1, w = Math.max(1, tl.w(i) - 2);
      ser.forEach(function (sr, j) {
        var l = seriesLoad(sr, i);
        el("rect", { x: x, y: y(base + l), width: w, height: Math.max(0, y(base) - y(base + l) - (j < ser.length - 1 ? 1 : 0)), fill: sr.col }, svg);
        base += l;
      });
    });
    var d = ""; ts.forEach(function (q, i) { d += (i ? "L" : "M") + tl.x(i) + "," + y(q.capacity) + "H" + (tl.x(i) + tl.w(i)); });
    el("path", { d: d, fill: "none", stroke: "var(--tele)", "stroke-width": 2 }, svg);
    per.forEach(function (p, i) {
      var hit = el("rect", { x: tl.x(i), y: T0, width: tl.w(i), height: H - T0 - B, "class": "hit" }, svg);
      hit.addEventListener("mousemove", function (e) {
        var h = "<b>" + pLong(p) + "</b>";
        ser.forEach(function (sr) { h += row(esc(sr.name), fq(seriesLoad(sr, i))); });
        h += row(T("Tier load / capacity"), fq(ts[i].load) + " / " + fq(ts[i].capacity)) + row(T("Tier utilisation"), pct(ts[i].util));
        tip.show(e, h);
      });
      hit.addEventListener("mouseleave", tip.hide);
    });
    put(wrap, svg);
    $("tierLegend").innerHTML = ser.map(function (sr) { return "<span><i class='sq' style='background:" + sr.col + "'></i>" + esc(sr.name) + "</span>"; }).join("") +
      "<span><i class='sq' style='background:var(--tele);height:2px'></i>" + T("Tier capacity") + "</span><span style='color:var(--ink-faint)'>" + T("{u} a month", { u: unit }) + "</span>";
    if (!$("table-tier").hidden) tableTier();
  }
  function tableTier() {
    var per = state.res.periods, ser = tierSeries(), ts = P.tierSummary(VR(), state.net, state.tier);
    var h = "<table><thead><tr><th>" + T("Period") + "</th>" + ser.map(function (s) { return "<th>" + esc(s.name) + "</th>"; }).join("") + "<th>" + T("Tier capacity") + "</th><th>" + T("Utilisation") + "</th></tr></thead><tbody>";
    per.forEach(function (p, i) { h += "<tr><th>" + pLabel(p) + "</th>" + ser.map(function (s) { return "<td>" + fq(seriesLoad(s, i)) + "</td>"; }).join("") + "<td>" + fq(ts[i].capacity) + "</td><td>" + pct(ts[i].util) + "</td></tr>"; });
    $("table-tier").innerHTML = h + "</tbody></table>";
  }

  // ---- lead-time ladder
  function renderLadder() {
    var sel = $("ladderMkt");
    sel.innerHTML = sitesOf("market").map(function (s) { return "<option value='" + esc(s.id) + "'>" + esc(nm(s)) + " (" + latLabel(s.lat) + ")</option>"; }).join("");
    sel.value = state.market;
    var ch = state.res.leadChain[state.market], mkt = byId(state.market), steps = ch.steps.slice().reverse();
    var wrap = $("ladder"), tip = tipFor(wrap), W = 640, RH = 22, T0 = 14, B = 24, LBL = 220, H = T0 + Math.max(1, steps.length) * RH + B;
    var max = Math.max(30, Math.ceil(ch.total / 30) * 30), x = function (d) { return LBL + (W - 10 - LBL) * (1 - d / max); };
    var svg = svgRoot(W, H, "", T("Lead-time ladder for {m}", { m: nm(mkt) }));
    var every = max > 240 ? 60 : 30;
    for (var d = 0; d <= max; d += every) { el("line", { x1: x(d), x2: x(d), y1: T0 - 4, y2: H - B, "class": "grid" }, svg); txt("text", { x: x(d), y: H - 8, "text-anchor": "middle", "class": "tick" }, d === 0 ? T("on shelf") : "−" + d + " " + T("d"), svg); }
    var WHAT = { transit: T("transit"), handling: T("handling"), release: T("release (QA)"), production: T("production") };
    steps.forEach(function (st, i) {
      var yy = T0 + i * RH, site = byId(st.site || st.from), col = st.kind === "transit" ? "#4f7fae" : TCOL[site.tier];
      var name = st.kind === "transit" ? "→ " + nm(byId(st.to)) : nm(site), what = WHAT[st.kind];
      txt("text", { x: LBL - 8, y: yy + RH / 2 + 4, "text-anchor": "end", "class": st.kind === "transit" ? "" : "site" }, name + " · " + what, svg);
      var x0 = x(st.start), x1 = Math.max(x0 + 2, x(st.end));
      var bar = el("rect", { x: x0, y: yy + 4, width: x1 - x0, height: RH - 8, rx: 2, fill: col, "fill-opacity": st.kind === "production" ? 1 : st.kind === "transit" ? 0.9 : 0.5, stroke: st.kind === "release" || st.kind === "handling" ? col : null }, svg);
      var dl = txt("text", { x: x0 - 4, y: yy + RH / 2 + 4, "text-anchor": "end" }, Math.round(st.days) + " " + T("d"), svg); if (x0 - LBL < 34) dl.style.display = "none";
      bar.addEventListener("mousemove", function (e) {
        tip.show(e, "<b>" + esc(name) + "</b>" + row(T("Step"), what) + row(T("Takes"), T("{n} days", { n: fx(st.days, 1) })) + row(T("Starts"), T("{n} days before the shelf", { n: Math.round(st.start) })) + row(T("Ends"), T("{n} days before", { n: Math.round(st.end) })));
      });
      bar.addEventListener("mouseleave", tip.hide);
    });
    put(wrap, svg);
    $("ladderNote").innerHTML = T("Raw ingredient for a pack sold in {m} in {when} must be in production around <b>{start}</b>: {d} days ({mo} months) ahead.", {
      m: esc(nm(mkt)), when: monthLabel(24), start: monthLabel(Math.max(0, Math.round(24 - ch.total / P.DAYS_PER_MONTH))), d: Math.round(ch.total), mo: fx(ch.total / P.DAYS_PER_MONTH, 1) });
    $("ladderLegend").innerHTML = "<span><i class='sq' style='background:var(--ink-dim)'></i>" + T("Production (site colour)") + "</span><span><i class='sq' style='background:var(--ink-dim);opacity:.5'></i>" + T("Release or handling") + "</span><span><i class='sq' style='background:#4f7fae'></i>" + T("Transit") + "</span>";
  }

  // ---- forecast small multiples
  function renderMultiples() {
    var box = $("multiples"), per = state.res.periods, mk = sitesOf("market"), mx = 0, unit = tierUnit("market");
    mk.forEach(function (s) { state.res.sites[s.id].periods.forEach(function (q) { mx = Math.max(mx, q.value); }); });
    mx = niceMax(mx * 1.05);
    $("fcTitle").textContent = T("Consumption forecast · {u} a month", { u: unit });
    box.innerHTML = "";
    mk.forEach(function (s) {
      var r = state.res.sites[s.id], pk = (state.net.config.demandPeak + (s.lat < 0 ? 6 : 0)) % 12;
      var div = document.createElement("div"); div.className = "mult chart";
      div.innerHTML = "<h3><i class='swatch' style='background:" + TCOL.market + "'></i>" + esc(nm(s)) + "</h3><p class='chart-sub'>" + latLabel(s.lat) + " · " + T("peaks in {m}", { m: MONTHS[pk] }) + " · " + T("+{g}%/yr", { g: fx(s.growth || 0, 1).replace(/[.,]0$/, "") }) + (s.launch ? " · " + T("launch {m}", { m: monthLabel(s.launch) }) : "") + "</p>";
      box.appendChild(div);
      var W = 300, H = 110, L = 34, R = 4, T0 = 6, B = 14, tl = timeline(L, W - R), tip = tipFor(div);
      var y = function (v) { return T0 + (H - T0 - B) * (1 - v / mx); };
      var svg = svgRoot(W, H, "", T("Forecast for {m}", { m: nm(s) }));
      [0, 0.5, 1].forEach(function (k) { el("line", { x1: L, x2: W - R, y1: y(mx * k), y2: y(mx * k), "class": k ? "grid" : "axis" }, svg); txt("text", { x: L - 4, y: y(mx * k) + 3, "text-anchor": "end", "class": "tick" }, fq(mx * k), svg); });
      el("line", { x1: tl.div, x2: tl.div, y1: T0, y2: H - B, "class": "divider" }, svg);
      txt("text", { x: L, y: H - 2, "class": "tick" }, String(per[0].year), svg);
      txt("text", { x: tl.div + 2, y: H - 2, "class": "tick" }, String(per[P.MONTHLY].year), svg);
      txt("text", { x: W - R, y: H - 2, "text-anchor": "end", "class": "tick" }, String(per[per.length - 1].year), svg);
      per.forEach(function (p, i) {
        var v = r.periods[i].value, x = tl.x(i) + 0.5, w = Math.max(0.8, tl.w(i) - 1), un = CAP() ? state.cres.sites[s.id].periods[i].unmet : 0;
        el("rect", { x: x, y: y(v), width: w, height: Math.max(0, y(0) - y(v)), fill: TCOL.market }, svg);
        if (un > 0) el("rect", { x: x, y: y(v), width: w, height: Math.max(0, y(v - un) - y(v)), fill: "var(--bad)" }, svg);
        var hit = el("rect", { x: tl.x(i), y: T0, width: tl.w(i), height: H - T0 - B, "class": "hit" }, svg);
        hit.addEventListener("mousemove", function (e) { tip.show(e, "<b>" + esc(nm(s)) + " · " + pLong(p) + "</b>" + row(T("Demand (a month)"), fu(v, unit)) + (CAP() ? row(T("Not supplied (a month)"), fu(un, unit)) : "")); });
        hit.addEventListener("mouseleave", tip.hide);
        hit.addEventListener("click", function () { select(s.id); });
      });
      div.insertBefore(svg, div.querySelector(".tip"));
    });
    if (!$("table-fc").hidden) tableFc();
  }
  function tableFc() {
    var per = state.res.periods, mk = sitesOf("market");
    var h = "<table><thead><tr><th>" + T("Period") + "</th>" + mk.map(function (s) { return "<th>" + esc(nm(s)) + "</th>"; }).join("") + "<th>" + T("Total") + "</th></tr></thead><tbody>";
    per.forEach(function (p, i) { var t = 0; h += "<tr><th>" + pLabel(p) + "</th>" + mk.map(function (s) { var v = state.res.sites[s.id].periods[i].value; t += v; return "<td>" + fq(v) + "</td>"; }).join("") + "<td>" + fq(t) + "</td></tr>"; });
    $("table-fc").innerHTML = h + "</tbody></table>";
  }

  // ---- the plan within capacity: solved in a worker (HiGHS), cached by network and options
  var worker = null, wid = 0, wkey = "", waiters = [], solveTimer = null;
  function solveKey() { return JSON.stringify([IO.toJSON(state.net), state.csrc, state.hold]); }
  function cached(key) { for (var i = 0; i < state.cache.length; i++) if (state.cache[i].key === key) return state.cache[i].res; return null; }
  function remember(key, res) { state.cache = state.cache.filter(function (c) { return c.key !== key; }); state.cache.unshift({ key: key, res: res }); if (state.cache.length > 8) state.cache.length = 8; }
  function settle() { var w = waiters; waiters = []; w.forEach(function (f) { f(); }); }
  // ask for a solve of the current network; a newer request replaces one still running
  function requestSolve(key) {
    state.solving = true; state.solveErr = null; renderSolveStatus();
    clearTimeout(solveTimer);
    solveTimer = setTimeout(function () {
      if (worker && wkey && wkey !== key) { worker.terminate(); worker = null; }
      if (wkey === key && worker) return;
      if (!worker) { worker = new Worker("src/solve-worker.js"); worker.onmessage = onSolved; worker.onerror = function () { worker = null; wkey = ""; state.solving = false; state.solveErr = T("The solver could not be loaded."); renderSolveStatus(); settle(); }; }
      wkey = key; wid++;
      worker.postMessage({ id: wid, key: key, net: JSON.parse(IO.toJSON(state.net)), opts: { mode: state.csrc, hold: state.hold } });
      state.t0 = Date.now();
    }, 350);
  }
  function onSolved(e) {
    var key = wkey, r = e.data.result; wkey = "";
    if (!r || !r.ok) { state.solving = false; state.solveErr = (r && r.errors || []).map(function (x) { return I.tw(x); }).join(" "); renderSolveStatus(); settle(); return; }
    remember(key, r);
    if (state.mode === "cap" && key === solveKey()) { state.cres = r; state.ckey = key; state.solving = false; renderViews(); }
    settle();
  }
  // resolves once the plan within capacity for the current network is on screen
  function whenSolved() { return new Promise(function (ok) { if (state.mode !== "cap" || (state.cres && state.ckey === solveKey())) ok(); else waiters.push(ok); }); }
  function renderSolveStatus() {
    var st = $("solveStatus"); if (!st) return;
    $("capOpts").hidden = state.mode !== "cap";
    each($("capMode").querySelectorAll("button"), function (b) { b.classList.toggle("active", b.getAttribute("data-v") === state.mode); });
    document.body.classList.toggle("cap-mode", CAP());
    if (state.mode !== "cap") { st.textContent = ""; return; }
    if (state.solveErr) { st.innerHTML = "<span class='bad'>" + esc(state.solveErr) + "</span>"; return; }
    if (state.solving) { st.innerHTML = "<span class='spin'></span>" + T("Solving the plan within capacity…") + (state.cres ? " " + T("(showing the last plan)") : ""); return; }
    if (state.cres) st.textContent = T("Solved in {s} s · {r} constraints", { s: fx(state.cres.seconds || 0, 1), r: (state.cres.size ? state.cres.size.rows : 0).toLocaleString(I.locale) });
  }
  // what reaches the shelves: delivered and unmet demand per period, and per market
  function renderService() {
    var box = $("servicePanel"); box.hidden = !CAP(); if (!CAP()) return;
    var cr = state.cres, per = state.res.periods, mk = sitesOf("market"), unit = tierUnit("market");
    var del = per.map(function (p, i) { return mk.reduce(function (a, s) { return a + cr.sites[s.id].periods[i].delivered; }, 0); });
    var un = per.map(function (p, i) { return mk.reduce(function (a, s) { return a + cr.sites[s.id].periods[i].unmet; }, 0); });
    var wrap = $("serviceChart"), tip = tipFor(wrap), W = 1240, H = 220, L = 60, R = 8, T0 = 30, B = 22, tl = timeline(L, W - R);
    var mx = niceMax(Math.max.apply(null, del.map(function (d, i) { return d + un[i]; })) * 1.05), y = function (v) { return T0 + (H - T0 - B) * (1 - v / mx); };
    var svg = svgRoot(W, H, "", T("Demand delivered and not supplied, every period"));
    for (var k = 0; k <= 4; k++) { var v = mx * k / 4; el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), "class": k ? "grid" : "axis" }, svg); txt("text", { x: L - 6, y: y(v) + 3, "text-anchor": "end", "class": "tick" }, fq(v), svg); }
    timeFrame(svg, tl, T0, H - B); timeTicks(svg, tl, H - 6);
    per.forEach(function (p, i) {
      var x = tl.x(i) + 1, w = Math.max(1, tl.w(i) - 2);
      el("rect", { x: x, y: y(del[i]), width: w, height: Math.max(0, y(0) - y(del[i]) - (un[i] > 0 ? 1 : 0)), fill: TCOL.market }, svg);
      if (un[i] > 0) el("rect", { x: x, y: y(del[i] + un[i]), width: w, height: Math.max(0, y(del[i]) - y(del[i] + un[i])), fill: "var(--bad)" }, svg);
      var hit = el("rect", { x: tl.x(i), y: T0, width: tl.w(i), height: H - T0 - B, "class": "hit" }, svg);
      hit.addEventListener("mousemove", function (e) { var d = del[i] + un[i]; tip.show(e, "<b>" + pLong(p) + "</b>" + row(T("Demand (a month)"), fu(d, unit)) + row(T("Delivered (a month)"), fu(del[i], unit)) + row(T("Not supplied (a month)"), fu(un[i], unit)) + row(T("Fill rate"), pctFine(d > 0 ? del[i] / d : 1))); });
      hit.addEventListener("mouseleave", tip.hide);
    });
    put(wrap, svg);
    $("serviceLegend").innerHTML = "<span><i class='sq' style='background:" + TCOL.market + "'></i>" + T("Delivered") + "</span><span><i class='sq' style='background:var(--bad)'></i>" + T("Not supplied") + "</span><span style='color:var(--ink-faint)'>" + T("{u} a month", { u: unit }) + "</span>";
    var rows = mk.map(function (s) { var o = cr.sites[s.id], d = sumR(o.demand, 0, P.MONTHS), u = sumR(o.unmet, 0, P.MONTHS); return { s: s, d: d, u: u, f: o.fill, first: o.firstUnmet }; });
    $("serviceTable").innerHTML = "<table class='outlook'><thead><tr><th style='text-align:left'>" + T("Consumption point") + "</th><th>" + T("Demand, 13 years") + "</th><th>" + T("Delivered") + "</th><th>" + T("Not supplied") + "</th><th>" + T("Fill rate") + "</th><th style='text-align:left'>" + T("First unmet") + "</th></tr></thead><tbody>" +
      rows.map(function (x) { return "<tr><th><button class='linkish' data-sel='" + esc(x.s.id) + "'>" + esc(nm(x.s)) + "</button></th><td>" + fq(x.d) + "</td><td>" + fq(x.d - x.u) + "</td><td class='" + (x.u > 0.5 ? "bad" : "ok") + "'>" + fq(x.u) + "</td><td class='" + (x.f >= 0.999 ? "ok" : x.f >= 0.95 ? "warn" : "bad") + "'>" + pctFine(x.f) + "</td><td style='text-align:left'>" + (x.first >= 0 ? monthLabel(x.first) : T("Never")) + "</td></tr>"; }).join("") +
      "<tr><th>" + T("Total") + "</th><td>" + fq(cr.demand) + "</td><td>" + fq(cr.demand - cr.unmet) + "</td><td>" + fq(cr.unmet) + "</td><td>" + pctFine(cr.fill) + "</td><td style='text-align:left'>" + (cr.firstUnmet >= 0 ? monthLabel(cr.firstUnmet) : T("Never")) + "</td></tr></tbody></table>";
    each($("serviceTable").querySelectorAll("[data-sel]"), function (b) { b.addEventListener("click", function () { select(b.getAttribute("data-sel")); }); });
    // lanes carrying something other than their planned share
    var moved = cr.lanes.filter(function (l) { return Math.abs(l.actual - l.share) > 0.02 && (l.total > 1e-6 || l.share > 0); }).sort(function (a, b) { return Math.abs(b.actual - b.share) - Math.abs(a.actual - a.share); });
    $("serviceLanes").innerHTML = moved.length ? "<p class='mini-h'>" + T("Lanes off their planned share") + "</p><p class='lanes'>" + moved.slice(0, 12).map(function (l) {
      return esc(nm(byId(l.from))) + " → " + esc(nm(byId(l.to))) + ": " + T("{a}% (planned {p}%)", { a: Math.round(l.actual * 100), p: Math.round(l.share * 100) }) + (l.qualified ? "" : " · " + T("new lane"));
    }).join("<br>") + "</p>" : "<p class='lanes'>" + T("Every lane carries its planned share.") + "</p>";
    if (!$("table-svc").hidden) tableSvc();
  }
  function tableSvc() {
    var per = state.res.periods, mk = sitesOf("market"), cr = state.cres;
    var h = "<table><thead><tr><th>" + T("Period") + "</th>" + mk.map(function (s) { return "<th>" + esc(nm(s)) + "</th>"; }).join("") + "<th>" + T("Total") + "</th></tr></thead><tbody>";
    per.forEach(function (p, i) { var d = 0, u = 0; h += "<tr><th>" + pLabel(p) + "</th>" + mk.map(function (s) { var q = cr.sites[s.id].periods[i]; d += q.value; u += q.unmet; return "<td>" + pctFine(q.fill) + "</td>"; }).join("") + "<td>" + pctFine(d > 0 ? 1 - u / d : 1) + "</td></tr>"; });
    $("table-svc").innerHTML = h + "</tbody></table>";
  }
  function setMode(m) { state.mode = m === "cap" ? "cap" : "plan"; if (state.mode !== "cap") { state.cres = null; state.ckey = ""; state.solving = false; } render(); }

  // ---- files: the plan as CSV; the network as CSV, Excel or JSON; loading one
  function download(name, data, type) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function fileBase() { return "tierwise-" + (state.scenario === "custom" ? "network" : state.scenario); }
  function csvPlan() {
    var per = state.res.periods, cfg = state.net.config, cap = CAP(), lines = ["site_id,site,tier,unit,period,kind,load_per_month,capacity_per_month,utilisation,busiest_month_utilisation,busiest_month" + (cap ? ",needed_unlimited_per_month,stock_per_month,delivered_per_month,unmet_per_month" : "")];
    var q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
    state.net.sites.forEach(function (s) {
      var r = VR().sites[s.id], unit = state.res.tiers[P.TIER_INDEX[s.tier]].unit;
      per.forEach(function (p, i) {
        var o = r.periods[i], pid = p.kind === "month" ? IO.monthText(p.from, cfg) : String(p.year);
        if (s.tier === "market") lines.push([q(s.id), q(s.name), s.tier, q(unit), pid, p.kind, o.value.toFixed(2), "", "", "", ""].concat(cap ? ["", "", o.delivered.toFixed(2), o.unmet.toFixed(2)] : []).join(","));
        else lines.push([q(s.id), q(s.name), s.tier, q(unit), pid, p.kind, o.load.toFixed(4), o.capacity.toFixed(4), o.util.toFixed(4), o.peak.toFixed(4), IO.monthText(o.peakMonth, cfg)].concat(cap ? [o.required.toFixed(4), o.stock.toFixed(4), "", ""] : []).join(","));
      });
    });
    download(fileBase() + (cap ? "-within-capacity" : "") + "-plan.csv", lines.join("\r\n") + "\r\n", "text/csv");
  }
  var xlsxReady = null;
  function needXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxReady) xlsxReady = new Promise(function (ok, no) {
      var sc = document.createElement("script"); sc.src = XLSX_URL; sc.onload = function () { ok(window.XLSX); }; sc.onerror = function () { xlsxReady = null; no(new Error("xlsx")); }; document.head.appendChild(sc);
    });
    return xlsxReady;
  }
  function dataMsg(html, kind) { var m = $("dataMsg"); m.hidden = !html; m.className = "data-msg" + (kind ? " " + kind : ""); m.innerHTML = html || ""; }
  function saveExcel() {
    needXLSX().then(function (X) { X.writeFile(IO.toWorkbook(state.net, X), fileBase() + ".xlsx"); })
      .catch(function () { dataMsg(T("The spreadsheet library could not be loaded. Use CSV instead, which Excel opens too."), "bad"); });
  }
  function readFile(f) {
    var isX = /\.(xlsx|xlsm|xls|ods)$/i.test(f.name);
    var go = function (content, X) {
      var r = IO.load(f.name, content, X);
      if (!r.ok) { dataMsg("<b>" + T("{f} could not be loaded:", { f: esc(f.name) }) + "</b><br>" + r.errors.slice(0, 12).map(function (e) { return esc(I.tw(e)); }).join("<br>") + (r.errors.length > 12 ? "<br>" + T("…and {n} more.", { n: r.errors.length - 12 }) : ""), "bad"); return; }
      useCustom(r.net, f.name);
      var w = r.warnings.length ? "<br>" + r.warnings.map(function (e) { return esc(I.tw(e)); }).join("<br>") : "";
      dataMsg(T("Loaded <b>{f}</b>: {n} sites in {t} tiers.", { f: esc(f.name), n: r.net.sites.length, t: state.res.tiers.filter(function (t) { return sitesOf(t.id).length; }).length }) + w, "ok");
    };
    var rd = new FileReader();
    rd.onerror = function () { dataMsg(T("{f} could not be read.", { f: esc(f.name) }), "bad"); };
    if (isX) {
      rd.onload = function () { needXLSX().then(function (X) { go(rd.result, X); }).catch(function () { dataMsg(T("The spreadsheet library could not be loaded. Save the sheet as CSV and load that."), "bad"); }); };
      rd.readAsArrayBuffer(f);
    } else { rd.onload = function () { go(rd.result); }; rd.readAsText(f); }
  }
  function useCustom(net, name) {
    state.custom = { name: name, net: clone(net) };
    state.scenario = "custom"; state.net = clone(net); state.pos = null; state.period = null;
    if (state.net.config.demandScale == null) state.net.config.demandScale = 1;
    fillScenarios(); $("scenario").value = "custom";
    if (state.compareKey === "custom") setCompare("custom"); else fillCompare();
    syncControls(); renderEditor(); render();
  }
  // a link that carries the whole network: compressed JSON in the address after #net=
  function b64url(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64url(t) { var s = atob(t.replace(/-/g, "+").replace(/_/g, "/")), b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
  function streamThrough(bytes, stream) { return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer().then(function (ab) { return new Uint8Array(ab); }); }
  function shareLink() {
    var o = JSON.parse(IO.toJSON(state.net)); if (state.scenario !== "custom") o.scenario = state.scenario;
    var bytes = new TextEncoder().encode(JSON.stringify(o));
    var base = location.href.replace(/#.*$/, "");
    if (typeof CompressionStream === "undefined") return Promise.resolve(base + "#netj=" + b64url(bytes));
    return streamThrough(bytes, new CompressionStream("deflate-raw")).then(function (z) { return base + "#net=" + b64url(z); });
  }
  function readLink() {
    var h = location.hash, m = h.match(/^#net(j?)=([A-Za-z0-9_-]+)/);
    if (!m) return Promise.resolve(null);
    var bytes; try { bytes = unb64url(m[2]); } catch (e) { return Promise.resolve({ ok: false, errors: [T("The link is damaged.")] }); }
    var p = m[1] ? Promise.resolve(bytes) : typeof DecompressionStream === "undefined" ? Promise.reject(new Error("no")) : streamThrough(bytes, new DecompressionStream("deflate-raw"));
    return p.then(function (b) { return IO.fromJSON(new TextDecoder().decode(b)); }).catch(function () { return { ok: false, errors: [T("The link is damaged.")] }; });
  }
  function copyLink() {
    shareLink().then(function (url) {
      var box = $("shareBox"); box.hidden = false; $("shareUrl").value = url; $("shareUrl").select();
      var done = function () { dataMsg(T("Link copied. It carries the whole network, so anyone who opens it sees this plan."), "ok"); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { dataMsg(T("Copy the link from the box below."), ""); });
      else dataMsg(T("Copy the link from the box below."), "");
    });
  }

  // ---- comparison: a ready-made scenario, a pinned plan, or the loaded network
  function compareOptions() {
    var o = [["", T("Nothing")]];
    Object.keys(N.SCENARIOS).forEach(function (k) { o.push(["s:" + k, T(N.SCENARIOS[k].label)]); });
    if (state.pinned) o.push(["pin", T("Pinned plan ({t})", { t: state.pinned.time })]);
    if (state.custom) o.push(["custom", T("Your network: {name}", { name: state.custom.name })]);
    return o;
  }
  function fillCompare() {
    var sel = $("compareSel");
    sel.innerHTML = compareOptions().map(function (o) { return "<option value='" + esc(o[0]) + "'>" + esc(o[1]) + "</option>"; }).join("");
    sel.value = state.compareKey; if (sel.value !== state.compareKey) { state.compareKey = ""; state.compare = null; sel.value = ""; }
  }
  function setCompare(key) {
    state.compareKey = key || "";
    var net = null, label = "";
    if (/^s:/.test(key)) { net = N.build(key.slice(2)); label = T(N.SCENARIOS[key.slice(2)].label); }
    else if (key === "pin" && state.pinned) { net = clone(state.pinned.net); label = T("Pinned plan ({t})", { t: state.pinned.time }); }
    else if (key === "custom" && state.custom) { net = clone(state.custom.net); label = state.custom.name; }
    var res = net ? P.plan(net) : null;
    state.compare = res && res.ok ? { key: key, label: label, net: net, res: res } : null;
    if (!state.compare) { state.compareKey = ""; state.heatMode = "plan"; }
    else if (state.heatMode !== "diff") state.heatMode = "diff";
    fillCompare();
  }
  function pin() {
    var d = new Date(), t = d.toLocaleTimeString(I.locale, { hour: "2-digit", minute: "2-digit" });
    state.pinned = { net: clone(state.net), time: t };
    setCompare("pin"); render();
    dataMsg(T("Pinned. Change anything, and the heatmap shows the change against the pinned plan."), "ok");
  }

  // ---- the editor
  var EDIT = {
    market: [["base", "Base, a month"], ["growth", "Growth % (yrs 1–3)"], ["longGrowth", "Growth % (yrs 4–13)"], ["season", "Season swing %"], ["launch", "Launch (YYYY-MM)"], ["ramp", "Ramp months"], ["priority", "Priority (1–3)"]],
    warehouse: [["capacity", "Throughput a month"], ["handling", "Handling days"], ["cover", "Cover weeks"]],
    cmo: [["capacity", "Capacity a month"], ["lead", "Lead time, days"], ["release", "Release time, days"], ["yield", "Yield %"]]
  };
  function expText(s) { return (s.expansions || []).map(function (e) { return IO.monthText(e.from, state.net.config) + ":+" + e.add; }).join(" | "); }
  function monthOptions(v) { return MONTHS.map(function (m, i) { return "<option value='" + i + "'" + (i === v ? " selected" : "") + ">" + m + "</option>"; }).join(""); }
  function inp(attrs, v, cls2) { return "<input" + (cls2 ? " class='" + cls2 + "'" : "") + " " + attrs + " value='" + esc(v == null ? "" : v) + "'>"; }
  function renderEditor() {
    var n = state.net, c = n.config, tiers = P.tiersFor(n);
    var h = "<table class='edit'><tbody><tr><td class='tier-h' colspan='8'>" + T("Product, calendar and bill of materials") + "</td></tr>" +
      "<tr><td class='name'>" + T("Product") + "</td><td colspan='3'>" + inp("data-cfg='product'", T(n.product || ""), "wide") + "</td>" +
      "<td class='name'>" + T("First year") + "</td><td>" + inp("data-cfg='startYear' inputmode='numeric'", c.startYear) + "</td><td class='name'>" + T("First month") + "</td><td><select data-cfg='startMonth'>" + monthOptions(c.startMonth) + "</select></td></tr>" +
      "<tr><td class='name'>" + T("Demand peaks (north)") + "</td><td><select data-cfg='demandPeak'>" + monthOptions(c.demandPeak) + "</select></td><td class='name'>" + T("Milk peaks (north)") + "</td><td><select data-cfg='rawPeak'>" + monthOptions(c.rawPeak) + "</select></td>" +
      "<td class='name'>" + T("Dosing units per pack") + "</td><td>" + inp("data-bom='packPerUnit' inputmode='decimal'", n.bom.packPerUnit) + "</td><td class='name'>" + T("kg of product per dosing unit") + "</td><td>" + inp("data-bom='kgPerSachet' inputmode='decimal'", n.bom.kgPerSachet) + "</td></tr>" +
      "<tr><td class='name'>" + T("t raw ingredient per t product") + "</td><td>" + inp("data-bom='rawPerProduct' inputmode='decimal'", n.bom.rawPerProduct) + "</td><td colspan='6' class='hint'>" + T("Tier names and units can be changed below, for a chain whose tiers are called something else.") + "</td></tr></tbody></table>";
    h += "<table class='edit'><thead><tr><td class='tier-h' colspan='4'>" + T("Tier names and units") + "</td></tr><tr><th>" + T("Tier") + "</th><th>" + T("Name (plural)") + "</th><th>" + T("Name (one)") + "</th><th>" + T("Unit") + "</th></tr></thead><tbody>" +
      P.TIERS.map(function (t, i) { var o = (n.tiers || {})[t.id] || {}; return "<tr><td class='name'><i class='swatch' style='background:" + TCOL[t.id] + "'></i>" + esc(T(t.name)) + "</td><td>" + inp("data-tier='" + t.id + "' data-tk='name' placeholder='" + esc(T(t.name)) + "'", o.name, "wide") + "</td><td>" + inp("data-tier='" + t.id + "' data-tk='one' placeholder='" + esc(T(t.one)) + "'", o.one, "wide") + "</td><td>" + inp("data-tier='" + t.id + "' data-tk='unit' placeholder='" + esc(T(t.unit)) + "'", o.unit) + "</td></tr>"; }).join("") + "</tbody></table>";
    tiers.forEach(function (t, ti) {
      var cols = t.id === "market" ? EDIT.market : t.id === "warehouse" ? EDIT.warehouse : EDIT.cmo, up = ti < tiers.length - 1 ? sitesOf(tiers[ti + 1].id) : [];
      h += "<table class='edit'><thead><tr><td class='tier-h' colspan='" + (cols.length + 6) + "'><i class='swatch' style='background:" + TCOL[t.id] + "'></i>" + esc(tierName(t.id)) + " · " + esc(tierUnit(t.id)) + " <button type='button' class='btn small' data-add='" + t.id + "'>" + T("+ Add a site") + "</button></td></tr><tr><th>" + T("Site") + "</th><th>" + T("Country") + "</th><th>" + T("Lat") + "</th><th>" + T("Lon") + "</th>" +
        cols.map(function (c2) { return "<th>" + T(c2[1]) + "</th>"; }).join("") + (t.id !== "raw" ? "<th>" + T("Sourcing: supplier · share · transit days (blank = estimated)") + "</th>" : "") + (t.id !== "market" ? "<th>" + T("Expansions (YYYY-MM:+amount)") + "</th>" : "") + "<th></th></tr></thead><tbody>";
      sitesOf(t.id).forEach(function (s) {
        var a = "data-id='" + esc(s.id) + "'";
        h += "<tr><td class='name'>" + inp(a + " data-k='name'", nm(s), "mid") + "<span class='sid'>" + esc(s.id) + "</span></td><td>" + inp(a + " data-k='country'", country(s), "short") + "</td><td>" + inp(a + " data-k='lat' inputmode='decimal'", s.lat, "short") + "</td><td>" + inp(a + " data-k='lon' inputmode='decimal'", s.lon, "short") + "</td>" +
          cols.map(function (c2) { var v = c2[0] === "launch" ? (s.launch != null ? IO.monthText(s.launch, state.net.config) : "") : s[c2[0]]; return "<td>" + inp(a + " data-k='" + c2[0] + "' inputmode='decimal'", v) + "</td>"; }).join("");
        if (t.id !== "raw") {
          h += "<td class='src'>" + (s.suppliers || []).map(function (l, li) {
            return "<span class='lane-ed'><select " + a + " data-lane='" + li + "' data-lk='from'>" + up.map(function (u) { return "<option value='" + esc(u.id) + "'" + (u.id === l.from ? " selected" : "") + ">" + esc(nm(u)) + "</option>"; }).join("") + (up.some(function (u) { return u.id === l.from; }) ? "" : "<option value='" + esc(l.from) + "' selected>" + esc(l.from) + " ?</option>") + "</select>" +
              inp(a + " data-lane='" + li + "' data-lk='share' inputmode='decimal' aria-label='" + esc(T("Share")) + "'", l.share, "tiny") + inp(a + " data-lane='" + li + "' data-lk='days' inputmode='decimal' placeholder='" + Math.round(state.res && state.res.transit ? state.res.transit[l.from + ">" + s.id] || 0 : 0) + "' aria-label='" + esc(T("Transit days")) + "'", l.days, "tiny") +
              "<button type='button' class='x' " + a + " data-dellane='" + li + "' aria-label='" + esc(T("Remove this supplier")) + "'>×</button></span>";
          }).join("") + (up.length ? "<button type='button' class='btn small' " + a + " data-addlane='1'>" + T("+ supplier") + "</button>" : "") + "</td>";
        }
        if (t.id !== "market") h += "<td>" + inp(a + " data-k='expansions'", expText(s), "wide") + "</td>";
        h += "<td><button type='button' class='x' " + a + " data-del='1' aria-label='" + esc(T("Remove this site")) + "'>×</button></td></tr>";
      });
      h += "</tbody></table>";
    });
    $("editTables").innerHTML = h;
  }
  function changed(structural) { if (structural) state.pos = null; if (state.scenario !== "custom") markEdited(); render(); }
  function markEdited() { var o = $("scenario").querySelector("option[value='" + state.scenario + "']"); if (o && !/\*$/.test(o.textContent)) o.textContent += " *"; }
  // a number typed in the editor: a comma is a decimal mark when there is no point (2,5 = 2.5; 1,250.5 = 1250.5)
  function num(v) { var n = IO.number(v, /,/.test(v) && !/\./.test(v)); return n == null ? NaN : n; }
  function onEdit(e) {
    var t = e.target, v = t.value != null ? String(t.value).trim() : "";
    var ck = t.getAttribute("data-cfg"), bk = t.getAttribute("data-bom"), tk = t.getAttribute("data-tier");
    if (ck) {
      if (ck === "product") state.net.product = v;
      else if (ck === "startYear") { var y = parseInt(v, 10); if (y > 1900 && y < 2200) state.net.config.startYear = y; }
      else state.net.config[ck] = +v;
      renderEditor(); changed(); return;
    }
    if (bk) { var b = num(v); if (isFinite(b) && b != null) state.net.bom[bk] = b; else state.net.bom[bk] = NaN; changed(); return; }
    if (tk) { var o = (state.net.tiers = state.net.tiers || {})[tk] = state.net.tiers[tk] || {}; if (v) o[t.getAttribute("data-tk")] = v; else delete o[t.getAttribute("data-tk")]; renderEditor(); changed(); return; }
    var s = byId(t.getAttribute("data-id")); if (!s) return;
    var lane = t.getAttribute("data-lane");
    if (lane != null) {
      var l = s.suppliers[+lane], lk = t.getAttribute("data-lk");
      if (lk === "from") l.from = v; else if (lk === "share") l.share = num(v); else if (v === "") delete l.days; else l.days = num(v);
      changed(lk === "from"); return;
    }
    var k = t.getAttribute("data-k");
    if (k === "name") s.name = v || s.id;
    else if (k === "country") s.country = v;
    else if (k === "expansions") {
      s.expansions = v ? v.split(/[|;,]/).map(function (p) { var a2 = p.split(":"); return { from: Math.max(0, IO.monthIndex(a2[0].trim(), state.net.config)), add: IO.number((a2[1] || "").trim(), false) }; }).filter(function (x) { return isFinite(x.from) && isFinite(x.add); }) : [];
    } else if (k === "launch") { if (!v) delete s.launch; else { var li = IO.monthIndex(v, state.net.config); if (isFinite(li)) s.launch = li; } }
    else if (v === "" && (k === "ramp" || k === "longGrowth" || k === "cover" || k === "handling" || k === "priority")) delete s[k];
    else s[k] = num(v);
    if (k === "cover") syncControls();
    changed(k === "lat" || k === "lon");
  }
  function uid(tier) { var p = { market: "m", warehouse: "w", packaging: "pk", dosing: "d", product: "p", raw: "r" }[tier], i = 1; while (byId(p + "-new" + i)) i++; return p + "-new" + i; }
  function onEditClick(e) {
    var t = e.target.closest("button"); if (!t) return;
    var id = t.getAttribute("data-id"), s = id ? byId(id) : null;
    if (t.hasAttribute("data-add")) {
      var tier = t.getAttribute("data-add"), ti = P.TIER_INDEX[tier], like = sitesOf(tier)[0], up = ti < 5 ? sitesOf(P.TIERS[ti + 1].id) : [];
      var ns = like ? clone(like) : { tier: tier, lat: 0, lon: 0 };
      ns.id = uid(tier); ns.name = T("New site"); ns.tier = tier; delete ns.expansions; delete ns.outages;
      if (tier === "market") { ns.base = ns.base || 1000; ns.growth = ns.growth || 0; ns.season = ns.season || 0; delete ns.launch; }
      else if (ns.capacity == null) ns.capacity = 1000;
      if (tier !== "raw") ns.suppliers = up.length ? [{ from: up[0].id, share: 100 }] : []; else delete ns.suppliers;
      state.net.sites.push(ns); renderEditor(); changed(true); return;
    }
    if (!s) return;
    if (t.hasAttribute("data-del")) {
      state.net.sites = state.net.sites.filter(function (x) { return x.id !== s.id; });
      state.net.sites.forEach(function (x) { if (x.suppliers) x.suppliers = x.suppliers.filter(function (l) { return l.from !== s.id; }); });
      renderEditor(); changed(true); return;
    }
    if (t.hasAttribute("data-addlane")) {
      var upT = P.TIERS[P.TIER_INDEX[s.tier] + 1].id, used = (s.suppliers || []).map(function (l) { return l.from; }), cand = sitesOf(upT).filter(function (u) { return used.indexOf(u.id) < 0; })[0] || sitesOf(upT)[0];
      (s.suppliers = s.suppliers || []).push({ from: cand.id, share: 50 }); renderEditor(); changed(true); return;
    }
    if (t.hasAttribute("data-dellane")) { s.suppliers.splice(+t.getAttribute("data-dellane"), 1); renderEditor(); changed(true); }
  }

  // ---- controls and scenarios
  function fillScenarios() {
    var sc = $("scenario");
    sc.innerHTML = Object.keys(N.SCENARIOS).map(function (k) { return "<option value='" + k + "'>" + esc(T(N.SCENARIOS[k].label)) + "</option>"; }).join("") +
      (state.custom ? "<option value='custom'>" + esc(T("Your network: {name}", { name: state.custom.name })) + "</option>" : "");
    sc.value = state.scenario;
  }
  function syncControls() {
    var c = state.net.config, w = sitesOf("warehouse");
    $("scale").value = Math.round((c.demandScale != null ? c.demandScale : 1) * 100); $("scaleOut").textContent = Math.round((c.demandScale != null ? c.demandScale : 1) * 100) + "%";
    var covs = w.map(function (s) { return s.cover != null ? s.cover : c.cover; }), lo = Math.min.apply(null, covs), hi = Math.max.apply(null, covs);
    $("cover").value = c.cover; $("coverOut").textContent = !covs.length ? "–" : lo === hi ? T("{n} weeks", { n: lo }) : T("{a}–{b} weeks by site", { a: lo, b: hi });
    $("swing").value = c.rawSeasonMax; $("swingOut").textContent = "±" + c.rawSeasonMax + "%";
    $("target").value = String(Math.round(state.target * 100));
  }
  function load(id) {
    if (id === "custom" && state.custom) { state.scenario = "custom"; state.net = clone(state.custom.net); }
    else { state.scenario = N.SCENARIOS[id] ? id : "base"; state.net = N.build(state.scenario); }
    if (state.net.config.demandScale == null) state.net.config.demandScale = 1;
    state.pos = null; state.period = null;
    fillScenarios(); syncControls(); renderEditor(); render();
  }
  // the tutorial (and tests) set the page up through this: a scenario, then values, then what to look at
  function setup(o) {
    o = o || {};
    state.mode = o.cap ? "cap" : "plan"; state.csrc = o.cap && o.cap.mode || "qualified"; state.hold = o.cap && o.cap.hold != null ? o.cap.hold : 6;
    $("csrc").value = state.csrc; $("hold").value = String(state.hold);
    if (state.mode !== "cap") { state.cres = null; state.ckey = ""; }
    load(o.scenario || "base");
    var v = o.values || {};
    if (v.demandScale != null) state.net.config.demandScale = v.demandScale;
    if (v.rawSeasonMax != null) state.net.config.rawSeasonMax = v.rawSeasonMax;
    if (v.cover != null) { state.net.config.cover = v.cover; sitesOf("warehouse").forEach(function (s) { s.cover = v.cover; }); }
    (o.edits || []).forEach(function (e) { var s = byId(e.id); if (s) s[e.k] = e.v; });
    state.target = o.target != null ? o.target : 0.9;
    state.colorBy = o.colorBy || "peak";
    each($("colorBy").querySelectorAll("button"), function (x) { x.classList.toggle("active", x.getAttribute("data-v") === state.colorBy); });
    if (o.pin) state.pinned = { net: clone(state.net), time: T("tutorial") };
    if (o.applyAll) o.apply = state.net.sites.filter(function (s) { return s.tier !== "market"; }).map(function (s) { return s.id; });
    if (o.apply) { replan(); o.apply.forEach(function (id) { var q = requiredFor(id), s = byId(id); if (q && q.additions.length) s.expansions = (s.expansions || []).concat(q.additions); }); }
    setCompare(o.compare || "");
    if (o.heatMode) state.heatMode = o.heatMode;
    syncControls(); renderEditor();
    if (o.select) state.sel = o.select;
    if (o.market) state.market = o.market;
    if (o.tier) state.tier = o.tier;
    render();
    if (o.select) select(o.select, o.period);
    if (o.open) { var d = document.querySelector(o.open); if (d && d.tagName === "DETAILS") d.open = true; }
    return whenSolved().then(function () { if (o.select && CAP()) select(o.select, o.period); });
  }
  // the numbers the tutorial quotes, from the live plan
  function tokens() {
    var f = firstOverall(), s = byId(state.sel), r = state.res.sites[state.sel], unit = s ? unitOf(s) : "";
    var V = { first: f ? monthLabel(f.m) : T("never"), firstSite: f ? nm(f.site) : "–", y1: fq(demandTotal(0, 12)), y13: fq(demandTotal(P.MONTHS - 12, P.MONTHS)), nShort: String(overCount(state.res, state.net)),
      chain: String(Math.round(state.res.leadChain[state.market].total)), chainMonths: fx(state.res.leadChain[state.market].total / P.DAYS_PER_MONTH, 1), market: nm(byId(state.market)), site: s ? nm(s) : "" };
    if (s && s.tier !== "market") {
      V.selPeak = pct(r.peakUtil); V.selFirst = r.firstOver >= 0 ? monthLabel(r.firstOver) : T("never");
      var q = requiredFor(s.id); V.reqFirst = q.additions.length ? monthLabel(q.firstNeed) : T("never"); V.reqTotal = fu(q.total, unit); V.reqN = String(q.additions.length); V.target = pct(state.target);
      var i = state.period != null ? state.period : defaultPeriod(r), p = state.res.periods[i], tot = sumR(r.load, p.from, p.to), top = null;
      Object.keys(r.byMarket).forEach(function (k) { var v = sumR(r.byMarket[k], p.from, p.to); if (!top || v > top.v) top = { k: k, v: v }; });
      V.period = pLong(p); V.topMarket = top ? nm(byId(top.k)) : "–"; V.topShare = top && tot > 0 ? pct(top.v / tot) : "–";
    }
    if (state.compare) { var fb = firstOverall(state.compare.res, state.compare.net); V.cmpFirst = fb ? monthLabel(fb.m) : T("never"); V.cmpName = state.compare.label; V.cmpShort = String(overCount(state.compare.res, state.compare.net)); }
    if (CAP()) {
      var cr = state.cres, fm = firstUnmetMarket(), bn = firstBinding();
      V.fill = pctFine(cr.fill); V.unmetT = fu(cr.unmet, tierUnit("market")); V.firstUnmet = fm ? monthLabel(fm.m) : T("never"); V.firstUnmetMkt = fm ? nm(fm.site) : "–";
      V.bottleneck = bn ? nm(bn.site) : "–"; V.bottleneckWhen = bn ? monthLabel(bn.m) : T("never"); V.rerouted = pctFine(cr.rerouted);
      if (s && s.tier === "market") V.mktFill = pctFine(cr.sites[s.id].fill);
    }
    return V;
  }

  function init() {
    $("ver").textContent = "v" + VERSION; $("ver2").textContent = VERSION;
    fillScenarios(); fillCompare();
    $("scenario").addEventListener("change", function () { load(this.value); if (state.compareKey) setCompare(state.compareKey); render(); });
    $("scale").addEventListener("input", function () { state.net.config.demandScale = +this.value / 100; $("scaleOut").textContent = this.value + "%"; render(); });
    $("cover").addEventListener("input", function () { var v = +this.value; state.net.config.cover = v; sitesOf("warehouse").forEach(function (s) { s.cover = v; }); $("coverOut").textContent = T("{n} weeks", { n: v }); renderEditor(); render(); });
    $("swing").addEventListener("input", function () { state.net.config.rawSeasonMax = +this.value; $("swingOut").textContent = "±" + this.value + "%"; render(); });
    $("target").addEventListener("change", function () { state.target = +this.value / 100; renderSite(); renderNeeds(); });
    each($("colorBy").querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () { state.colorBy = b.getAttribute("data-v"); each($("colorBy").querySelectorAll("button"), function (x) { x.classList.toggle("active", x === b); }); renderHeat(); });
    });
    $("compareSel").addEventListener("change", function () { setCompare(this.value); render(); });
    each($("capMode").querySelectorAll("button"), function (b) { b.addEventListener("click", function () { setMode(b.getAttribute("data-v")); }); });
    $("csrc").addEventListener("change", function () { state.csrc = this.value; render(); });
    $("hold").addEventListener("change", function () { state.hold = +this.value; render(); });
    $("pin").addEventListener("click", pin);
    each($("heatMode").querySelectorAll("button"), function (b) { b.addEventListener("click", function () { state.heatMode = b.getAttribute("data-v"); renderHeat(); }); });
    $("csv").addEventListener("click", csvPlan);
    $("reset").addEventListener("click", function () { load(state.scenario); if (state.compareKey) setCompare(state.compareKey); render(); dataMsg(""); });
    $("loadBtn").addEventListener("click", function () { $("fileIn").click(); });
    $("fileIn").addEventListener("change", function () { if (this.files && this.files[0]) readFile(this.files[0]); this.value = ""; });
    $("tplCsv").addEventListener("click", function () { download(fileBase() + ".csv", IO.toCSV(state.net), "text/csv"); });
    $("tplXlsx").addEventListener("click", saveExcel);
    $("saveJson").addEventListener("click", function () { download(fileBase() + ".json", IO.toJSON(state.net), "application/json"); });
    $("shareBtn").addEventListener("click", copyLink);
    $("applyAll").addEventListener("click", function () { applyAdds(state.net.sites.filter(function (s) { return s.tier !== "market"; }).map(function (s) { return s.id; })); });
    var drop = $("dataBox");
    ["dragover", "dragenter"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("drag"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove("drag"); }); });
    drop.addEventListener("drop", function (e) { e.preventDefault(); var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) readFile(f); });
    $("ladderMkt").addEventListener("change", function () { state.market = this.value; renderLadder(); });
    $("editTables").addEventListener("change", onEdit);
    $("editTables").addEventListener("click", onEditClick);
    each(document.querySelectorAll("[data-table]"), function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-table"), t = $("table-" + k); t.hidden = !t.hidden;
        b.textContent = t.hidden ? T("Show as table") : T("Hide table");
        if (!t.hidden) ({ heat: tableHeat, tier: tableTier, fc: tableFc, svc: tableSvc })[k]();
      });
    });
    load("base");
    readLink().then(function (r) {
      if (!r) return;
      if (!r.ok) { dataMsg("<b>" + T("The shared link could not be opened:") + "</b><br>" + r.errors.map(function (e) { return esc(I.tw(e)); }).join("<br>"), "bad"); return; }
      if (r.net.scenario && N.SCENARIOS[r.net.scenario] && IO.toJSON(N.build(r.net.scenario)) === IO.toJSON(r.net)) { load(r.net.scenario); return; }
      useCustom(r.net, T("shared link"));
      dataMsg(T("This plan was opened from a shared link."), "ok");
    });
    fetch("assets/land.json").then(function (r) { return r.json(); }).then(function (j) { state.land = j; renderMap(); }).catch(function () {});
  }
  window.Tierwise = { state: state, setMode: setMode, whenSolved: whenSolved, load: load, setup: setup, select: select, render: render, tokens: tokens, requiredFor: requiredFor, VERSION: VERSION, useCustom: useCustom, shareLink: shareLink, readLink: readLink, setCompare: setCompare };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
