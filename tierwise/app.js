// Tierwise — the page: controls, the latitude map, the capacity heatmap, the site, tier, forecast and lead-time views,
// and the network editor. All planning is in src/plan.js (TWPlan); the example network is src/network.js (TWNetwork).
(function () {
  "use strict";
  var VERSION = "1.0.0";
  var P = window.TWPlan, N = window.TWNetwork, TIERS = P.TIERS;
  var SVGNS = "http://www.w3.org/2000/svg";
  // tier colours (validated for the dark surface) and the same hues in fixed order for series inside one chart
  var TCOL = { market: "#3987e5", warehouse: "#d95926", packaging: "#199e70", dosing: "#c98500", product: "#d55181", raw: "#9085e9" };
  var CAT = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"];
  // utilisation bins: blue at or under capacity, red over it
  var BINS = [
    { max: 0.6, c: "#1d4a78", l: "< 60%" }, { max: 0.8, c: "#2f6aa8", l: "60–80%" }, { max: 0.9, c: "#5b93cc", l: "80–90%" },
    { max: 1 + 1e-9, c: "#a7c2de", l: "90–100%" }, { max: 1.1, c: "#f2a283", l: "100–110%" }, { max: 1.25, c: "#e2604a", l: "110–125%" },
    { max: Infinity, c: "#b8282c", l: "> 125%" }
  ];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var state = { scenario: "base", net: null, res: null, sel: "p-ham", market: "m-jkt", colorBy: "peak", tier: "product", land: null, pos: null };

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function txt(tag, attrs, s, parent) { var e = el(tag, attrs, parent); e.textContent = s; return e; }
  function svgRoot(W, H, cls, label) { var s = el("svg", { viewBox: "0 0 " + W + " " + H, "class": cls || "", role: "img", "aria-label": label || "" }); return s; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---- formatting
  function fq(v) {
    if (!isFinite(v)) return "∞";
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M";
    if (a >= 1e4) return Math.round(v / 1e3) + "k";
    if (a >= 100) return Math.round(v).toLocaleString("en-US");
    return v.toFixed(a >= 10 ? 0 : 1);
  }
  function fu(v, unit) { return fq(v) + " " + unit; }
  function pct(u) { return isFinite(u) ? Math.round(u * 100) + "%" : "∞"; }
  function cls(u) { return u > 1 + 1e-9 ? "bad" : u >= 0.9 ? "warn" : "ok"; }
  function bin(u) { for (var i = 0; i < BINS.length; i++) if (u <= BINS[i].max) return BINS[i]; return BINS[BINS.length - 1]; }
  function unitOf(s) { return TIERS[P.TIER_INDEX[s.tier]].unit; }
  function tierName(id) { return TIERS[P.TIER_INDEX[id]].name; }
  function monthLabel(m) { var c = state.net.config, mo = (c.startMonth + m) % 12; return MONTHS[mo] + " " + (c.startYear + Math.floor((c.startMonth + m) / 12)); }
  function latLabel(lat) { return Math.abs(lat).toFixed(1) + "°" + (lat < 0 ? "S" : "N"); }
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
  // band labels and the monthly | yearly divider on a time chart
  function timeFrame(svg, tl, top, bottom) {
    el("line", { x1: tl.div, x2: tl.div, y1: top - 12, y2: bottom, "class": "divider" }, svg);
    txt("text", { x: tl.div - 4, y: top - 3, "text-anchor": "end", "class": "band" }, "36 months", svg);
    txt("text", { x: tl.div + 4, y: top - 3, "class": "band" }, "10 years", svg);
  }
  function timeTicks(svg, tl, y) {
    var per = state.res.periods;
    per.forEach(function (p, i) {
      if (p.kind === "month" && p.month === 0) txt("text", { x: tl.x(i) + 1, y: y, "class": "tick" }, String(p.year), svg);
      if (p.kind === "year" && (i - P.MONTHLY) % 2 === 0) txt("text", { x: tl.x(i) + 1, y: y, "class": "tick" }, String(p.year), svg);
    });
  }

  // ---- plan and render
  function replan() {
    state.res = P.plan(state.net);
    var err = $("errors");
    if (!state.res.ok) { err.hidden = false; err.innerHTML = "<b>The network cannot be planned:</b><br>" + state.res.errors.map(esc).join("<br>"); return false; }
    err.hidden = true; return true;
  }
  function render() {
    if (!replan()) return;
    if (!byId(state.sel)) state.sel = sitesOf("product")[0].id;
    if (!byId(state.market)) state.market = sitesOf("market")[0].id;
    renderHeadline(); renderKpis(); renderOutlook(); renderMap(); renderSite(); renderHeat(); renderTier(); renderLadder(); renderMultiples();
  }
  function renderSelection() { renderMap(); renderSite(); renderHeat(); }

  // ---- headline and KPIs
  function firstOverall() {
    var best = null;
    state.net.sites.forEach(function (s) {
      if (s.tier === "market") return;
      var r = state.res.sites[s.id];
      if (r.firstOver >= 0 && (!best || r.firstOver < best.m)) best = { m: r.firstOver, site: s };
    });
    return best;
  }
  function demandTotal(fromM, toM) {
    var t = 0;
    sitesOf("market").forEach(function (s) { var d = state.res.sites[s.id].demand; for (var m = fromM; m < toM; m++) t += d[m]; });
    return t;
  }
  function renderHeadline() {
    var f = firstOverall(), y1 = demandTotal(0, 12), y13 = demandTotal(P.MONTHS - 12, P.MONTHS);
    var over3 = state.net.sites.filter(function (s) { var r = state.res.sites[s.id]; return s.tier !== "market" && r.firstOver >= 0 && r.firstOver < P.MONTHLY; });
    var h = "Consumption grows from <b>" + fq(y1) + " packs</b> in the first year to <b>" + fq(y13) + "</b> in the last. ";
    if (!f) h += "<b>Every site keeps up over all 13 years.</b>";
    else {
      h += "The first site to run short is <b>" + esc(f.site.name) + "</b> (" + tierName(f.site.tier).replace(/s$/, "") + ") in <b>" + monthLabel(f.m) + "</b>. ";
      h += over3.length ? "<b>" + over3.length + " site" + (over3.length > 1 ? "s" : "") + "</b> run short within the 3-year monthly window." : "Nothing runs short within the 3-year monthly window.";
    }
    $("headline").innerHTML = h;
  }
  function renderKpis() {
    var f = firstOverall(), y1 = demandTotal(0, 12), y13 = demandTotal(P.MONTHS - 12, P.MONTHS);
    var over = state.net.sites.filter(function (s) { return s.tier !== "market" && state.res.sites[s.id].firstOver >= 0; }).length;
    var tight = null;
    TIERS.slice(1).forEach(function (t) {
      var ts = P.tierSummary(state.res, state.net, t.id), u = ts[0].util;
      if (!tight || u > tight.u) tight = { t: t, u: u };
    });
    var longest = null;
    Object.keys(state.res.leadChain).forEach(function (id) { var c = state.res.leadChain[id]; if (!longest || c.total > longest.total) longest = { id: id, total: c.total }; });
    var tiles = [
      { l: "Consumption, year 1", v: fq(y1) + " packs", s: fq(y1 / 12) + " a month on average" },
      { l: "Consumption, year 13", v: fq(y13) + " packs", s: "×" + (y13 / y1).toFixed(2) + " on year 1" },
      { l: "First shortfall", v: f ? monthLabel(f.m) : "None", s: f ? f.site.name : "within 13 years", st: f ? (f.m < P.MONTHLY ? "critical" : "warning") : "good" },
      { l: "Sites short at some point", v: over + " of " + state.net.sites.filter(function (s) { return s.tier !== "market"; }).length, s: "across the 13 years", st: over ? "warning" : "good" },
      { l: "Tightest tier, year 1", v: pct(tight.u), s: tight.t.name, st: tight.u > 1 ? "critical" : tight.u >= 0.9 ? "warning" : "" },
      { l: "Longest chain", v: Math.round(longest.total) + " days", s: "raw ingredient to shelf, " + byId(longest.id).name }
    ];
    $("kpis").innerHTML = tiles.map(function (t) {
      return '<div class="kpi-tile' + (t.st ? " status-" + t.st : "") + '"><div class="kpi-label">' + t.l + '</div><div class="kpi-value">' + esc(t.v) + '</div><div class="kpi-sub">' + esc(t.s) + "</div></div>";
    }).join("");
  }
  function renderOutlook() {
    var h = "<thead><tr><th style='text-align:left'>Tier</th><th>Unit</th><th>Load, year 1<br>(a month)</th><th>Capacity, year 1<br>(a month)</th><th>Use, year 1</th><th>Busiest month,<br>months 1–36</th><th>Busiest month,<br>years 4–13</th><th>Load, year 13<br>(a month)</th><th style='text-align:left'>First short</th></tr></thead><tbody>";
    TIERS.forEach(function (t) {
      var sites = sitesOf(t.id);
      if (t.id === "market") {
        var y1 = 0, y13 = 0; sites.forEach(function (s) { var d = state.res.sites[s.id].demand; for (var m = 0; m < 12; m++) y1 += d[m] / 12; for (m = P.MONTHS - 12; m < P.MONTHS; m++) y13 += d[m] / 12; });
        h += "<tr><th><i class='swatch' style='background:" + TCOL[t.id] + "'></i>" + t.name + " (" + sites.length + ")</th><td>" + t.unit + "</td><td>" + fq(y1) + "</td><td>–</td><td>–</td><td>–</td><td>–</td><td>" + fq(y13) + "</td><td style='text-align:left'>–</td></tr>";
        return;
      }
      var L1 = 0, C1 = 0, L13 = 0, pk1 = { u: 0 }, pk2 = { u: 0 }, first = null;
      sites.forEach(function (s) {
        var r = state.res.sites[s.id];
        for (var m = 0; m < P.MONTHS; m++) {
          if (m < 12) { L1 += r.load[m] / 12; C1 += r.capacity[m] / 12; }
          if (m >= P.MONTHS - 12) L13 += r.load[m] / 12;
          var u = r.util[m], tgt = m < P.MONTHLY ? pk1 : pk2;
          if (u > tgt.u) { tgt.u = u; tgt.m = m; tgt.s = s; }
        }
        if (r.firstOver >= 0 && (!first || r.firstOver < first.m)) first = { m: r.firstOver, s: s };
      });
      var u1 = C1 > 0 ? L1 / C1 : 0;
      h += "<tr><th><i class='swatch' style='background:" + TCOL[t.id] + "'></i>" + t.name + " (" + sites.length + ")</th><td>" + t.unit + "</td><td>" + fq(L1) + "</td><td>" + fq(C1) + "</td><td class='" + cls(u1) + "'>" + pct(u1) + "</td>" +
        "<td class='" + cls(pk1.u) + "' title='" + esc(pk1.s ? pk1.s.name + ", " + monthLabel(pk1.m) : "") + "'>" + pct(pk1.u) + "</td>" +
        "<td class='" + cls(pk2.u) + "' title='" + esc(pk2.s ? pk2.s.name + ", " + monthLabel(pk2.m) : "") + "'>" + pct(pk2.u) + "</td><td>" + fq(L13) + "</td>" +
        "<td style='text-align:left' class='" + (first ? (first.m < P.MONTHLY ? "bad" : "warn") : "ok") + "'>" + (first ? esc(first.s.name) + ", " + monthLabel(first.m) : "Never") + "</td></tr>";
    });
    $("outlook").innerHTML = h + "</tbody>";
  }

  // ---- the latitude map
  var MAP = { W: 1000, H: 400, lon0: -125, lon1: 182, lat0: 63, lat1: -50 };
  function proj(lon, lat) { return [(lon - MAP.lon0) / (MAP.lon1 - MAP.lon0) * MAP.W, (MAP.lat0 - lat) / (MAP.lat0 - MAP.lat1) * MAP.H]; }
  // spread sites that sit on top of each other (a DC beside its city, a dosing plant beside a packer) so each stays clickable
  function layout() {
    var pts = state.net.sites.map(function (s) { var p = proj(s.lon, s.lat); return { id: s.id, x0: p[0], y0: p[1], x: p[0], y: p[1] }; });
    for (var it = 0; it < 120; it++) {
      for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++) {
        var a = pts[i], b = pts[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01, min = 17;
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
    var wrap = $("mapWrap"), tip = tipFor(wrap);
    if (!state.pos) state.pos = layout();
    var svg = svgRoot(MAP.W, MAP.H, "map", "Map of the supply network by latitude");
    el("rect", { x: 0, y: 0, width: MAP.W, height: MAP.H, fill: "#08223f" }, svg);
    for (var lat = 60; lat >= -45; lat -= 15) {
      var y = proj(0, lat)[1];
      el("line", { x1: 0, x2: MAP.W, y1: y, y2: y, "class": "grat" + (lat === 0 ? " eq" : "") }, svg);
    }
    for (var lon = -120; lon <= 180; lon += 30) { var x = proj(lon, 0)[0]; el("line", { x1: x, x2: x, y1: 0, y2: MAP.H, "class": "grat" }, svg); }
    el("path", { d: landPath(), "class": "land" }, svg);
    [23.44, -23.44].forEach(function (lt) { var yy = proj(0, lt)[1]; el("line", { x1: 0, x2: MAP.W, y1: yy, y2: yy, "class": "grat trop" }, svg); });
    for (lat = 60; lat >= -45; lat -= 15) txt("text", { x: 4, y: proj(0, lat)[1] - 3, "class": "lat-label" }, lat === 0 ? "Equator" : Math.abs(lat) + "°" + (lat < 0 ? "S" : "N"), svg);
    txt("text", { x: 4, y: proj(0, 23.44)[1] - 3, "class": "lat-label" }, "Tropic of Cancer", svg);
    txt("text", { x: 4, y: proj(0, -23.44)[1] - 3, "class": "lat-label" }, "Tropic of Capricorn", svg);

    var sel = state.sel, related = {}; related[sel] = 1;
    var selSite = byId(sel);
    (selSite.suppliers || []).forEach(function (l) { related[l.from] = 1; });
    customersOf(sel).forEach(function (c) { related[c.site.id] = 1; });
    // lanes, coloured by the supplying tier
    var lanes = el("g", {}, svg);
    state.net.sites.forEach(function (s) {
      (s.suppliers || []).forEach(function (l) {
        if (!(l.share > 0)) return;
        var u = byId(l.from); if (!u) return;
        var a = state.pos[u.id], b = state.pos[s.id], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
        var cx = mx - dy * 0.15, cy = my + dx * 0.15, hl = s.id === sel || u.id === sel;
        el("path", { d: "M" + a.x + "," + a.y + "Q" + cx + "," + cy + " " + b.x + "," + b.y, "class": "lane" + (hl ? " hl" : ""), stroke: TCOL[u.tier], "stroke-width": hl ? 2.2 : 0.6 + l.share / 100 * 1.4, style: hl ? null : "opacity:.32" }, lanes);
      });
    });
    // nodes
    var maxD = 0; sitesOf("market").forEach(function (s) { maxD = Math.max(maxD, state.res.sites[s.id].periods[0].value); });
    var order = state.net.sites.slice().sort(function (a, b) { return (a.id === sel) - (b.id === sel); });
    order.forEach(function (s) {
      var p = state.pos[s.id], r = state.res.sites[s.id], g = el("g", { "class": "node" + (s.id === sel ? " sel" : ""), tabindex: 0, role: "button", "aria-label": s.name }, svg);
      var rad = s.tier === "market" ? 5 + 5 * Math.sqrt(r.periods[0].value / maxD) : 6;
      if (s.tier !== "market" && r.peakUtil > 0.9) el("circle", { cx: p.x, cy: p.y, r: rad + 4, "class": "halo", stroke: r.peakUtil > 1 + 1e-9 ? "var(--bad)" : "var(--warn)" }, g);
      el("circle", { cx: p.x, cy: p.y, r: rad, "class": "core", fill: TCOL[s.tier] }, g);
      el("circle", { cx: p.x, cy: p.y, r: rad + 8, fill: "transparent" }, g);
      if (related[s.id]) {
        var lab = txt("text", { x: p.x + rad + 5, y: p.y + 4, "paint-order": "stroke", stroke: "#08223f", "stroke-width": 3 }, s.name, g);
        if (p.x > MAP.W - 150) { lab.setAttribute("x", p.x - rad - 5); lab.setAttribute("text-anchor", "end"); }
        if (s.id === sel) lab.style.fill = "var(--ink)";
      }
      g.addEventListener("mousemove", function (e) {
        var h = "<b>" + esc(s.name) + "</b>" + row(tierName(s.tier).replace(/s$/, ""), "") + row(esc(s.country), latLabel(s.lat));
        if (s.tier === "market") h += row("Demand, month 1", fu(r.periods[0].value, "packs"));
        else h += row("Busiest month", pct(r.peakUtil)) + row("First short", r.firstOver >= 0 ? monthLabel(r.firstOver) : "never");
        tip.show(e, h);
      });
      g.addEventListener("mouseleave", tip.hide);
      g.addEventListener("click", function () { select(s.id); });
      g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(s.id); } });
    });
    var old = wrap.querySelector("svg"); if (old) wrap.replaceChild(svg, old); else wrap.insertBefore(svg, wrap.firstChild);
    $("mapLegend").innerHTML = TIERS.map(function (t) { return "<span><i style='background:" + TCOL[t.id] + "'></i>" + t.name + "</span>"; }).join("") +
      "<span><i class='ring' style='border-color:var(--warn)'></i>Above 90% at peak</span><span><i class='ring' style='border-color:var(--bad)'></i>Short at some point</span>";
  }
  function select(id) {
    state.sel = id;
    var s = byId(id);
    if (s.tier === "market") { state.market = id; $("ladderMkt").value = id; renderLadder(); }
    else if (state.tier !== s.tier) { state.tier = s.tier; renderTier(); }
    renderSelection();
  }

  // ---- the selected site
  function renderSite() {
    var s = byId(state.sel), r = state.res.sites[s.id], unit = unitOf(s), hemi = s.lat < 0 ? "southern hemisphere" : "northern hemisphere";
    $("siteHead").innerHTML = "<span class='chip'><i style='background:" + TCOL[s.tier] + "'></i>" + tierName(s.tier) + "</span>" +
      "<p class='site-title'>" + esc(s.name) + "</p><p class='site-meta'>" + esc(s.country) + " · " + latLabel(s.lat) + " · " + hemi + "</p>";
    var facts;
    if (s.tier === "market") {
      var d = r.demand, y1 = 0, y13 = 0; for (var m = 0; m < 12; m++) y1 += d[m]; for (m = P.MONTHS - 12; m < P.MONTHS; m++) y13 += d[m];
      var pk = (state.net.config.demandPeak + (s.lat < 0 ? 6 : 0)) % 12;
      facts = [
        { l: "Year 1", v: fq(y1), s: "packs" + (s.launch ? " · launches " + monthLabel(s.launch) : "") },
        { l: "Year 13", v: fq(y13), s: "packs" },
        { l: "Growth", v: s.growth + "%", s: "a year, then " + (s.longGrowth != null ? s.longGrowth : s.growth) + "%" },
        { l: "Peak month", v: MONTHS[pk], s: "±" + s.season + "% swing" }
      ];
    } else {
      var cap0 = r.capacity[0], pkm = 0; for (m = 0; m < P.MONTHS; m++) if (r.util[m] > r.util[pkm]) pkm = m;
      facts = [
        { l: "Capacity", v: fq(cap0), s: unit + " a month" + (s.tier === "raw" ? ", month 1" : "") },
        { l: "Busiest month", v: pct(r.peakUtil), s: monthLabel(pkm), c: cls(r.peakUtil) },
        { l: "First short", v: r.firstOver >= 0 ? monthLabel(r.firstOver) : "Never", s: r.firstOver >= 0 ? "month " + (r.firstOver + 1) + " of 156" : "within 13 years", c: r.firstOver >= 0 ? (r.firstOver < P.MONTHLY ? "bad" : "warn") : "ok" },
        s.tier === "warehouse" ? { l: "Handling · cover", v: (s.handling || 0) + " d · " + (s.cover != null ? s.cover : state.net.config.cover) + " wk", s: "safety stock " + fq(r.ss[0]) + " packs" }
          : { l: "Lead · release", v: (s.lead || 0) + " d · " + (s.release || 0) + " d", s: "yield " + (s.yield != null ? s.yield : 100) + "%" }
      ];
    }
    $("siteFacts").innerHTML = facts.map(function (f) { return "<div class='fact" + (f.c ? " " + f.c : "") + "'><span>" + f.l + "</span><b>" + esc(f.v) + "</b><small>" + esc(f.s) + "</small></div>"; }).join("");
    siteChart(s, r, unit);
    // lanes in and out
    var h = "";
    var sup = (s.suppliers || []).filter(function (l) { return l.share > 0; }), tot = sup.reduce(function (a, l) { return a + l.share; }, 0);
    if (sup.length) h += "<p class='lanes'><b>Supplied by</b> " + sup.map(function (l) {
      var u = byId(l.from); return "<button class='linkish' data-sel='" + u.id + "'>" + esc(u.name) + "</button> " + Math.round(l.share / tot * 100) + "% · " + Math.round(state.res.transit[l.from + ">" + s.id]) + " d transit";
    }).join("; ") + "</p>";
    var cus = customersOf(s.id);
    if (cus.length) h += "<p class='lanes'><b>Supplies</b> " + cus.map(function (c) {
      return "<button class='linkish' data-sel='" + c.site.id + "'>" + esc(c.site.name) + "</button> (" + Math.round(c.share * 100) + "% of its need)";
    }).join("; ") + "</p>";
    if (s.tier === "raw") h += "<p class='lanes'>Capacity follows the milk season: ±" + Math.round(P.rawSeasonAmplitude(s.lat, state.net.config.rawSeasonMax / 100) * 100) + "% at " + latLabel(s.lat) + ", highest in " + MONTHS[(state.net.config.rawPeak + (s.lat < 0 ? 6 : 0)) % 12] + ".</p>";
    $("siteLanes").innerHTML = h;
    Array.prototype.forEach.call($("siteLanes").querySelectorAll("[data-sel]"), function (b) { b.addEventListener("click", function () { select(b.getAttribute("data-sel")); }); });
  }
  function siteChart(s, r, unit) {
    var wrap = $("siteChart"), tip = tipFor(wrap), W = 640, H = 230, L = 52, R = 8, T = 30, B = 22;
    var tl = timeline(L, W - R), per = state.res.periods, isM = s.tier === "market";
    var load = per.map(function (p, i) { return isM ? r.periods[i].value : r.periods[i].load; });
    var capA = isM ? null : per.map(function (p, i) { return r.periods[i].capacity; });
    var peakL = isM ? null : per.map(function (p, i) { return p.kind === "year" ? r.load[r.periods[i].peakMonth] : null; });
    var peakC = isM ? null : per.map(function (p, i) { return p.kind === "year" ? r.capacity[r.periods[i].peakMonth] : null; });
    var mx = 0; load.forEach(function (v, i) { mx = Math.max(mx, v, capA ? capA[i] : 0, peakL && peakL[i] ? peakL[i] : 0); });
    mx = niceMax(mx * 1.05);
    var y = function (v) { return T + (H - T - B) * (1 - v / mx); };
    var svg = svgRoot(W, H, "", (isM ? "Demand" : "Load and capacity") + " of " + s.name);
    for (var k = 0; k <= 4; k++) { var v = mx * k / 4; el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), "class": k ? "grid" : "axis" }, svg); txt("text", { x: L - 6, y: y(v) + 3, "text-anchor": "end", "class": "tick" }, fq(v), svg); }
    timeFrame(svg, tl, T, H - B); timeTicks(svg, tl, H - 6);
    load.forEach(function (v, i) {
      var x = tl.x(i) + 1, w = Math.max(1, tl.w(i) - 2), over = capA && v > capA[i] + 1e-9;
      el("rect", { x: x, y: y(v), width: w, height: Math.max(0, y(0) - y(v)), rx: Math.min(2, w / 3), fill: TCOL[s.tier] }, svg);
      if (over) el("rect", { x: x, y: y(v), width: w, height: Math.max(0, y(capA[i]) - y(v)), fill: "var(--bad)" }, svg);
      if (peakL && peakL[i] != null) el("line", { x1: x, x2: x + w, y1: y(peakL[i]), y2: y(peakL[i]), stroke: "var(--ink)", "stroke-width": 2 }, svg);
    });
    if (capA) {
      var d = ""; capA.forEach(function (c, i) { d += (i ? "L" : "M") + tl.x(i) + "," + y(c) + "H" + (tl.x(i) + tl.w(i)); });
      el("path", { d: d, fill: "none", stroke: "var(--tele)", "stroke-width": 2 }, svg);
    }
    per.forEach(function (p, i) {
      var hit = el("rect", { x: tl.x(i), y: T, width: tl.w(i), height: H - T - B, "class": "hit" }, svg);
      hit.addEventListener("mousemove", function (e) {
        var h = "<b>" + p.long + "</b>" + row(isM ? "Demand (a month)" : "Load (a month)", fu(load[i], unit));
        if (capA) {
          h += row("Capacity (a month)", fu(capA[i], unit)) + row("Utilisation", pct(r.periods[i].util));
          if (p.kind === "year") h += row("Busiest month", monthLabel(r.periods[i].peakMonth)) + row("  load / capacity", fq(peakL[i]) + " / " + fq(peakC[i])) + row("  utilisation", pct(r.periods[i].peak));
        }
        tip.show(e, h);
      });
      hit.addEventListener("mouseleave", tip.hide);
    });
    var old = wrap.querySelector("svg"); if (old) wrap.replaceChild(svg, old); else wrap.insertBefore(svg, wrap.firstChild);
    var leg = wrap.querySelector(".legend"); if (!leg) { leg = document.createElement("div"); leg.className = "legend"; wrap.appendChild(leg); }
    leg.innerHTML = isM ? "<span><i class='sq' style='background:" + TCOL.market + "'></i>Demand, packs a month (average in a yearly period)</span>"
      : "<span><i class='sq' style='background:" + TCOL[s.tier] + "'></i>Load, " + unit + " a month (average)</span><span><i class='sq' style='background:var(--bad)'></i>Load above capacity</span><span><i class='sq' style='background:var(--ink);height:2px'></i>Busiest month's load</span><span><i class='sq' style='background:var(--tele);height:2px'></i>Capacity</span>";
  }

  // ---- the capacity heatmap
  function heatValue(r, i) { var p = state.res.periods[i]; return p.kind === "year" && state.colorBy === "avg" ? r.periods[i].util : r.periods[i].peak; }
  function renderHeat() {
    var wrap = $("heatWrap"), tip = tipFor(wrap), per = state.res.periods;
    var LBL = 236, W = 1240, RH = 17, TH = 19, top = 50;
    var groups = TIERS.slice(1).map(function (t) { return { t: t, sites: sitesOf(t.id) }; });
    var H = top + groups.reduce(function (a, g) { return a + TH + g.sites.length * RH; }, 0) + 6;
    var tl = timeline(LBL, W - 4), svg = svgRoot(W, H, "heat", "Capacity utilisation of every site in every period");
    // headers
    txt("text", { x: LBL, y: 12, "class": "band" }, "Monthly · 36 months", svg);
    txt("text", { x: tl.div + 4, y: 12, "class": "band" }, "Yearly · 10 years", svg);
    per.forEach(function (p, i) {
      if (p.kind === "month") {
        if (p.month === 0 || i === 0) txt("text", { x: tl.x(i) + 1, y: 28, "class": "collab" }, String(p.year), svg);
        txt("text", { x: tl.x(i) + tl.w(i) / 2, y: 44, "text-anchor": "middle", "class": "collab" }, MONTHS[p.month].charAt(0), svg);
      } else txt("text", { x: tl.x(i) + tl.w(i) / 2, y: 44, "text-anchor": "middle", "class": "collab" }, "'" + String(p.year).slice(2), svg);
    });
    var y = top;
    groups.forEach(function (g) {
      el("circle", { cx: 6, cy: y + TH / 2 + 1, r: 4, fill: TCOL[g.t.id] }, svg);
      txt("text", { x: 15, y: y + TH / 2 + 5, "class": "tierlab" }, g.t.name + " · " + g.t.unit, svg);
      y += TH;
      g.sites.forEach(function (s) {
        var r = state.res.sites[s.id], yy = y;
        if (s.id === state.sel) el("rect", { x: 0, y: yy, width: W, height: RH, "class": "rowsel" }, svg);
        var lab = txt("text", { x: 15, y: yy + RH - 5, "class": "rowlab" + (s.id === state.sel ? " sel" : "") }, s.name, svg);
        lab.addEventListener("click", function () { select(s.id); });
        per.forEach(function (p, i) {
          var u = heatValue(r, i), c = el("rect", { x: tl.x(i), y: yy, width: tl.w(i), height: RH, fill: bin(u).c, "class": "cell" }, svg);
          c.addEventListener("mousemove", function (e) {
            var q = r.periods[i], unit = unitOf(s);
            var h = "<b>" + esc(s.name) + " · " + p.long + "</b>" + row("Load (a month)", fu(q.load, unit)) + row("Capacity (a month)", fu(q.capacity, unit)) + row(p.kind === "year" ? "Year average" : "Utilisation", pct(q.util));
            if (p.kind === "year") h += row("Busiest month", pct(q.peak) + ", " + MONTHS[(state.net.config.startMonth + q.peakMonth) % 12]);
            if (q.gap > 0) h += row("Short by", fu(q.gap, unit) + " in total");
            tip.show(e, h);
          });
          c.addEventListener("mouseleave", tip.hide);
          c.addEventListener("click", function () { select(s.id); });
        });
        y += RH;
      });
    });
    el("line", { x1: tl.div, x2: tl.div, y1: 2, y2: H, "class": "divider", "stroke-width": 1.5 }, svg);
    var old = wrap.querySelector("svg"); if (old) wrap.replaceChild(svg, old); else wrap.insertBefore(svg, wrap.firstChild);
    $("heatScale").innerHTML = "Utilisation" + BINS.map(function (b) { return "<span style='display:inline-flex;align-items:center;gap:4px'><i style='display:inline-block;width:14px;height:10px;border-radius:2px;background:" + b.c + "'></i>" + b.l + "</span>"; }).join("");
    if (!$("table-heat").hidden) tableHeat();
  }
  function tableHeat() {
    var per = state.res.periods, h = "<table><thead><tr><th>Site</th>" + per.map(function (p) { return "<th>" + p.label + "</th>"; }).join("") + "</tr></thead><tbody>";
    state.net.sites.forEach(function (s) {
      if (s.tier === "market") return;
      var r = state.res.sites[s.id];
      h += "<tr><th>" + esc(s.name) + "</th>" + per.map(function (p, i) { return "<td>" + pct(heatValue(r, i)) + "</td>"; }).join("") + "</tr>";
    });
    $("table-heat").innerHTML = h + "</tbody></table>";
  }

  // ---- load by tier
  function renderTier() {
    var seg = $("tierSeg");
    seg.innerHTML = TIERS.slice(1).map(function (t) { return "<button type='button' data-t='" + t.id + "'" + (t.id === state.tier ? " class='active'" : "") + ">" + t.short + "</button>"; }).join("");
    Array.prototype.forEach.call(seg.querySelectorAll("button"), function (b) { b.addEventListener("click", function () { state.tier = b.getAttribute("data-t"); renderTier(); }); });
    var wrap = $("tierChart"), tip = tipFor(wrap), W = 640, H = 240, L = 52, R = 8, T = 30, B = 22;
    var tl = timeline(L, W - R), per = state.res.periods, sites = sitesOf(state.tier), unit = TIERS[P.TIER_INDEX[state.tier]].unit;
    var ts = P.tierSummary(state.res, state.net, state.tier);
    var mx = 0; ts.forEach(function (q) { mx = Math.max(mx, q.load, q.capacity); }); mx = niceMax(mx * 1.05);
    var y = function (v) { return T + (H - T - B) * (1 - v / mx); };
    var svg = svgRoot(W, H, "", "Load by site against capacity, " + tierName(state.tier));
    for (var k = 0; k <= 4; k++) { var v = mx * k / 4; el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), "class": k ? "grid" : "axis" }, svg); txt("text", { x: L - 6, y: y(v) + 3, "text-anchor": "end", "class": "tick" }, fq(v), svg); }
    timeFrame(svg, tl, T, H - B); timeTicks(svg, tl, H - 6);
    per.forEach(function (p, i) {
      var base = 0, x = tl.x(i) + 1, w = Math.max(1, tl.w(i) - 2);
      sites.forEach(function (s, j) {
        var l = state.res.sites[s.id].periods[i].load;
        el("rect", { x: x, y: y(base + l), width: w, height: Math.max(0, y(base) - y(base + l) - (j < sites.length - 1 ? 1 : 0)), fill: CAT[j % CAT.length] }, svg);
        base += l;
      });
    });
    var d = ""; ts.forEach(function (q, i) { d += (i ? "L" : "M") + tl.x(i) + "," + y(q.capacity) + "H" + (tl.x(i) + tl.w(i)); });
    el("path", { d: d, fill: "none", stroke: "var(--tele)", "stroke-width": 2 }, svg);
    per.forEach(function (p, i) {
      var hit = el("rect", { x: tl.x(i), y: T, width: tl.w(i), height: H - T - B, "class": "hit" }, svg);
      hit.addEventListener("mousemove", function (e) {
        var h = "<b>" + p.long + "</b>";
        sites.forEach(function (s) { var q = state.res.sites[s.id].periods[i]; h += row(esc(s.name), fq(q.load) + " · " + pct(q.util)); });
        h += row("Tier load / capacity", fq(ts[i].load) + " / " + fq(ts[i].capacity)) + row("Tier utilisation", pct(ts[i].util));
        tip.show(e, h);
      });
      hit.addEventListener("mouseleave", tip.hide);
    });
    var old = wrap.querySelector("svg"); if (old) wrap.replaceChild(svg, old); else wrap.insertBefore(svg, wrap.firstChild);
    $("tierLegend").innerHTML = sites.map(function (s, j) { return "<span><i class='sq' style='background:" + CAT[j % CAT.length] + "'></i>" + esc(s.name) + "</span>"; }).join("") +
      "<span><i class='sq' style='background:var(--tele);height:2px'></i>Tier capacity</span><span style='color:var(--ink-faint)'>" + unit + " a month</span>";
    if (!$("table-tier").hidden) tableTier();
  }
  function tableTier() {
    var per = state.res.periods, sites = sitesOf(state.tier), ts = P.tierSummary(state.res, state.net, state.tier);
    var h = "<table><thead><tr><th>Period</th>" + sites.map(function (s) { return "<th>" + esc(s.name) + "</th>"; }).join("") + "<th>Tier capacity</th><th>Utilisation</th></tr></thead><tbody>";
    per.forEach(function (p, i) { h += "<tr><th>" + p.label + "</th>" + sites.map(function (s) { return "<td>" + fq(state.res.sites[s.id].periods[i].load) + "</td>"; }).join("") + "<td>" + fq(ts[i].capacity) + "</td><td>" + pct(ts[i].util) + "</td></tr>"; });
    $("table-tier").innerHTML = h + "</tbody></table>";
  }

  // ---- lead-time ladder
  function renderLadder() {
    var sel = $("ladderMkt");
    if (!sel.options.length) sitesOf("market").forEach(function (s) { var o = document.createElement("option"); o.value = s.id; o.textContent = s.name + " (" + latLabel(s.lat) + ")"; sel.appendChild(o); });
    sel.value = state.market;
    var ch = state.res.leadChain[state.market], mkt = byId(state.market), steps = ch.steps.slice().reverse();
    var wrap = $("ladder"), tip = tipFor(wrap), W = 640, RH = 22, T = 14, B = 24, LBL = 200, H = T + steps.length * RH + B;
    var max = Math.ceil(ch.total / 30) * 30, x = function (d) { return LBL + (W - 10 - LBL) * (1 - d / max); };
    var svg = svgRoot(W, H, "", "Lead-time ladder for " + mkt.name);
    for (var d = 0; d <= max; d += 30) { el("line", { x1: x(d), x2: x(d), y1: T - 4, y2: H - B, "class": "grid" }, svg); txt("text", { x: x(d), y: H - 8, "text-anchor": "middle", "class": "tick" }, d === 0 ? "on shelf" : "−" + d + " d", svg); }
    steps.forEach(function (st, i) {
      var yy = T + i * RH, site = byId(st.site || st.from), col = st.kind === "transit" ? "#4f7fae" : TCOL[site.tier];
      var name = st.kind === "transit" ? "→ " + byId(st.to).name : site.name;
      var what = { transit: "transit", handling: "handling", release: "release (QA)", production: "production" }[st.kind];
      txt("text", { x: LBL - 8, y: yy + RH / 2 + 4, "text-anchor": "end", "class": st.kind === "transit" ? "" : "site" }, name + " · " + what, svg);
      var x0 = x(st.start), x1 = Math.max(x0 + 2, x(st.end));
      var bar = el("rect", { x: x0, y: yy + 4, width: x1 - x0, height: RH - 8, rx: 2, fill: col, "fill-opacity": st.kind === "production" ? 1 : st.kind === "transit" ? 0.9 : 0.5, stroke: st.kind === "release" || st.kind === "handling" ? col : null }, svg);
      txt("text", { x: x0 - 4, y: yy + RH / 2 + 4, "text-anchor": "end" }, Math.round(st.days) + " d", svg).style.display = x0 - LBL > 34 ? "" : "none";
      bar.addEventListener("mousemove", function (e) {
        tip.show(e, "<b>" + esc(name) + "</b>" + row("Step", what) + row("Takes", st.days.toFixed(1) + " days") + row("Starts", Math.round(st.start) + " days before the shelf") + row("Ends", Math.round(st.end) + " days before"));
      });
      bar.addEventListener("mouseleave", tip.hide);
    });
    var old = wrap.querySelector("svg"); if (old) wrap.replaceChild(svg, old); else wrap.insertBefore(svg, wrap.firstChild);
    $("ladderNote").innerHTML = "Raw ingredient for a pack sold in " + esc(mkt.name) + " in " + monthLabel(24) + " must be in production around <b>" + monthLabel(Math.max(0, Math.round(24 - ch.total / P.DAYS_PER_MONTH))) + "</b>: " + Math.round(ch.total) + " days (" + (ch.total / P.DAYS_PER_MONTH).toFixed(1) + " months) ahead.";
    $("ladderLegend").innerHTML = "<span><i class='sq' style='background:var(--ink-dim)'></i>Production (site colour)</span><span><i class='sq' style='background:var(--ink-dim);opacity:.5'></i>Release or handling</span><span><i class='sq' style='background:#4f7fae'></i>Transit</span>";
  }

  // ---- forecast small multiples
  function renderMultiples() {
    var box = $("multiples"), per = state.res.periods, mk = sitesOf("market"), mx = 0;
    mk.forEach(function (s) { state.res.sites[s.id].periods.forEach(function (q) { mx = Math.max(mx, q.value); }); });
    mx = niceMax(mx * 1.05);
    box.innerHTML = "";
    mk.forEach(function (s) {
      var r = state.res.sites[s.id], pk = (state.net.config.demandPeak + (s.lat < 0 ? 6 : 0)) % 12;
      var div = document.createElement("div"); div.className = "mult chart";
      div.innerHTML = "<h3><i class='swatch' style='background:" + TCOL.market + "'></i>" + esc(s.name) + "</h3><p class='chart-sub'>" + latLabel(s.lat) + " · peaks in " + MONTHS[pk] + " · +" + s.growth + "%/yr" + (s.launch ? " · launch " + monthLabel(s.launch) : "") + "</p>";
      box.appendChild(div);
      var W = 300, H = 110, L = 34, R = 4, T = 6, B = 14, tl = timeline(L, W - R), tip = tipFor(div);
      var y = function (v) { return T + (H - T - B) * (1 - v / mx); };
      var svg = svgRoot(W, H, "", "Forecast for " + s.name);
      [0, 0.5, 1].forEach(function (k) { el("line", { x1: L, x2: W - R, y1: y(mx * k), y2: y(mx * k), "class": k ? "grid" : "axis" }, svg); txt("text", { x: L - 4, y: y(mx * k) + 3, "text-anchor": "end", "class": "tick" }, fq(mx * k), svg); });
      el("line", { x1: tl.div, x2: tl.div, y1: T, y2: H - B, "class": "divider" }, svg);
      txt("text", { x: L, y: H - 2, "class": "tick" }, String(per[0].year), svg);
      txt("text", { x: tl.div + 2, y: H - 2, "class": "tick" }, String(per[P.MONTHLY].year), svg);
      txt("text", { x: W - R, y: H - 2, "text-anchor": "end", "class": "tick" }, String(per[per.length - 1].year), svg);
      per.forEach(function (p, i) {
        var v = r.periods[i].value, x = tl.x(i) + 0.5, w = Math.max(0.8, tl.w(i) - 1);
        el("rect", { x: x, y: y(v), width: w, height: Math.max(0, y(0) - y(v)), fill: TCOL.market }, svg);
        var hit = el("rect", { x: tl.x(i), y: T, width: tl.w(i), height: H - T - B, "class": "hit" }, svg);
        hit.addEventListener("mousemove", function (e) { tip.show(e, "<b>" + esc(s.name) + " · " + p.long + "</b>" + row("Demand (a month)", fu(v, "packs"))); });
        hit.addEventListener("mouseleave", tip.hide);
        hit.addEventListener("click", function () { select(s.id); });
      });
      div.insertBefore(svg, div.querySelector(".tip"));
    });
    if (!$("table-fc").hidden) tableFc();
  }
  function tableFc() {
    var per = state.res.periods, mk = sitesOf("market");
    var h = "<table><thead><tr><th>Period</th>" + mk.map(function (s) { return "<th>" + esc(s.name) + "</th>"; }).join("") + "<th>Total</th></tr></thead><tbody>";
    per.forEach(function (p, i) { var t = 0; h += "<tr><th>" + p.label + "</th>" + mk.map(function (s) { var v = state.res.sites[s.id].periods[i].value; t += v; return "<td>" + fq(v) + "</td>"; }).join("") + "<td>" + fq(t) + "</td></tr>"; });
    $("table-fc").innerHTML = h + "</tbody></table>";
  }

  // ---- CSV of the whole plan
  function csv() {
    var per = state.res.periods, lines = ["site_id,site,tier,unit,period,kind,load_per_month,capacity_per_month,utilisation,busiest_month_utilisation,busiest_month"];
    state.net.sites.forEach(function (s) {
      var r = state.res.sites[s.id], unit = unitOf(s);
      per.forEach(function (p, i) {
        var q = r.periods[i];
        if (s.tier === "market") lines.push([s.id, '"' + s.name + '"', s.tier, unit, p.long, p.kind, q.value.toFixed(2), "", "", "", ""].join(","));
        else lines.push([s.id, '"' + s.name + '"', s.tier, unit, p.long, p.kind, q.load.toFixed(4), q.capacity.toFixed(4), q.util.toFixed(4), q.peak.toFixed(4), monthLabel(q.peakMonth)].join(","));
      });
    });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "tierwise-plan-" + state.scenario + ".csv"; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---- the editor
  var EDIT = {
    market: [["base", "Base, packs/mo"], ["growth", "Growth % (yrs 1–3)"], ["longGrowth", "Growth % (yrs 4–13)"], ["season", "Season swing %"], ["launch", "Launch month"], ["ramp", "Ramp months"]],
    warehouse: [["capacity", "Throughput, packs/mo"], ["handling", "Handling days"], ["cover", "Cover weeks"]],
    cmo: [["capacity", "Capacity / mo"], ["lead", "Lead time, days"], ["release", "Release time, days"], ["yield", "Yield %"]]
  };
  function supText(s) { return (s.suppliers || []).map(function (l) { return l.from + ":" + l.share; }).join(", "); }
  function expText(s) { return (s.expansions || []).map(function (e) { return e.from + ":+" + e.add; }).join(", "); }
  function renderEditor() {
    var h = "<table class='edit'><tbody><tr><td class='tier-h' colspan='8'>Bill of materials</td></tr><tr>" +
      "<td class='name'>Sachets per pack</td><td><input data-bom='packPerUnit' value='" + state.net.bom.packPerUnit + "'></td>" +
      "<td class='name'>kg of powder per sachet</td><td><input data-bom='kgPerSachet' value='" + state.net.bom.kgPerSachet + "'></td>" +
      "<td class='name'>t dairy base per t powder</td><td><input data-bom='rawPerProduct' value='" + state.net.bom.rawPerProduct + "'></td></tr></tbody></table>";
    TIERS.forEach(function (t) {
      var cols = t.id === "market" ? EDIT.market : t.id === "warehouse" ? EDIT.warehouse : EDIT.cmo;
      h += "<table class='edit'><thead><tr><td class='tier-h' colspan='" + (cols.length + 3) + "'><i class='swatch' style='background:" + TCOL[t.id] + "'></i>" + t.name + " · " + t.unit + "</td></tr><tr><th>Site (id)</th>" +
        cols.map(function (c) { return "<th>" + c[1] + "</th>"; }).join("") + (t.id !== "raw" ? "<th>Sourcing (id:share)</th>" : "") + (t.id !== "market" ? "<th>Expansions (month:+add)</th>" : "") + "</tr></thead><tbody>";
      sitesOf(t.id).forEach(function (s) {
        h += "<tr><td class='name'>" + esc(s.name) + " <span style='color:var(--ink-faint);font-family:var(--mono);font-size:10.5px'>" + s.id + "</span></td>" +
          cols.map(function (c) { return "<td><input data-id='" + s.id + "' data-k='" + c[0] + "' value='" + (s[c[0]] != null ? s[c[0]] : "") + "' inputmode='decimal'></td>"; }).join("") +
          (t.id !== "raw" ? "<td><input class='wide' data-id='" + s.id + "' data-k='suppliers' value='" + supText(s) + "'></td>" : "") +
          (t.id !== "market" ? "<td><input class='wide' data-id='" + s.id + "' data-k='expansions' value='" + expText(s) + "'></td>" : "") + "</tr>";
      });
      h += "</tbody></table>";
    });
    $("editTables").innerHTML = h;
  }
  function onEdit(e) {
    var inp = e.target; if (inp.tagName !== "INPUT") return;
    var bk = inp.getAttribute("data-bom");
    if (bk) { state.net.bom[bk] = parseFloat(inp.value); render(); return; }
    var s = byId(inp.getAttribute("data-id")), k = inp.getAttribute("data-k"); if (!s) return;
    var v = inp.value.trim();
    if (k === "suppliers") {
      s.suppliers = v ? v.split(/[,;]/).map(function (p) { var a = p.split(":"); return { from: a[0].trim(), share: a.length > 1 ? parseFloat(a[1]) : 100 }; }).filter(function (l) { return l.from; }) : [];
    } else if (k === "expansions") {
      s.expansions = v ? v.split(/[,;]/).map(function (p) { var a = p.split(":"); return { from: Math.max(0, Math.round(parseFloat(a[0]))), add: parseFloat((a[1] || "0").replace("+", "")) }; }).filter(function (x) { return isFinite(x.from) && isFinite(x.add); }) : [];
    } else if (v === "" && (k === "launch" || k === "ramp")) delete s[k];
    else s[k] = parseFloat(v);
    if (k === "cover") syncControls();
    render();
  }

  // ---- controls
  function syncControls() {
    var c = state.net.config, w = sitesOf("warehouse");
    $("scale").value = Math.round(c.demandScale * 100); $("scaleOut").textContent = Math.round(c.demandScale * 100) + "%";
    var covs = w.map(function (s) { return s.cover != null ? s.cover : c.cover; }), lo = Math.min.apply(null, covs), hi = Math.max.apply(null, covs);
    $("cover").value = c.cover; $("coverOut").textContent = lo === hi ? lo + " weeks" : lo + "–" + hi + " weeks by site";
    $("swing").value = c.rawSeasonMax; $("swingOut").textContent = "±" + c.rawSeasonMax + "%";
  }
  function load(id) {
    state.scenario = id; state.net = N.build(id); state.pos = null;
    syncControls(); renderEditor(); render();
  }
  function init() {
    $("ver").textContent = "v" + VERSION; $("ver2").textContent = VERSION;
    var sc = $("scenario");
    Object.keys(N.SCENARIOS).forEach(function (k) { var o = document.createElement("option"); o.value = k; o.textContent = N.SCENARIOS[k].label; sc.appendChild(o); });
    sc.addEventListener("change", function () { load(sc.value); });
    $("scale").addEventListener("input", function () { state.net.config.demandScale = +this.value / 100; $("scaleOut").textContent = this.value + "%"; render(); });
    $("cover").addEventListener("input", function () { var v = +this.value; state.net.config.cover = v; sitesOf("warehouse").forEach(function (s) { s.cover = v; }); $("coverOut").textContent = v + " weeks"; renderEditor(); render(); });
    $("swing").addEventListener("input", function () { state.net.config.rawSeasonMax = +this.value; $("swingOut").textContent = "±" + this.value + "%"; render(); });
    Array.prototype.forEach.call($("colorBy").querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () {
        state.colorBy = b.getAttribute("data-v");
        Array.prototype.forEach.call($("colorBy").querySelectorAll("button"), function (x) { x.classList.toggle("active", x === b); });
        renderHeat();
      });
    });
    $("csv").addEventListener("click", csv);
    $("reset").addEventListener("click", function () { load(state.scenario); });
    $("ladderMkt").addEventListener("change", function () { state.market = this.value; renderLadder(); });
    $("editTables").addEventListener("change", onEdit);
    Array.prototype.forEach.call(document.querySelectorAll("[data-table]"), function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-table"), t = $("table-" + k); t.hidden = !t.hidden;
        b.textContent = t.hidden ? "Show as table" : "Hide table";
        if (!t.hidden) ({ heat: tableHeat, tier: tableTier, fc: tableFc })[k]();
      });
    });
    load("base");
    fetch("assets/land.json").then(function (r) { return r.json(); }).then(function (j) { state.land = j; renderMap(); }).catch(function () {});
  }
  window.Tierwise = { state: state, load: load, select: select, render: render, VERSION: VERSION };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
