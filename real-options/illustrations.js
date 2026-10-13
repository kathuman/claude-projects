// Real Options for Network Design — explanatory diagrams (window.ROIllus), drawn as inline SVG in the page's palette.
// ROIllus.svg(key) returns the markup; elements with data-illus="key" are filled in when the page loads.
// Keys: strategy:full|best|defer|stage|lease, net:central|two|pilot|wait, and concept diagrams (see LIST).
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.ROIllus = api;
    var fill = function () { document.querySelectorAll("[data-illus]").forEach(function (el) { if (!el.firstChild) el.innerHTML = api.svg(el.getAttribute("data-illus")); }); };
    if (typeof document !== "undefined") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill); else fill(); }
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function T(s, v) { var g = typeof self !== "undefined" ? self : globalThis, I = g.ROi18n; return I ? I.T(s, v) : String(s); }
  var C = { s1: "var(--s1)", s2: "var(--s2)", s3: "var(--s3)", s4: "var(--s4)", s5: "var(--s5)", ink: "var(--ink)", dim: "var(--ink-dim)", faint: "var(--ink-faint)", line: "var(--line)", acc: "var(--accent)", bad: "var(--bad)", good: "var(--good)" };
  function wrap(w, h, label, body) {
    return "<svg class='il' viewBox='0 0 " + w + " " + h + "' role='img' aria-label='" + esc(T(label)) + "' xmlns='http://www.w3.org/2000/svg'>" + body + "</svg>";
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function t(x, y, s, o) { o = o || {}; return "<text x='" + x + "' y='" + y + "' class='il-t" + (o.cls ? " " + o.cls : "") + "'" + (o.anchor ? " text-anchor='" + o.anchor + "'" : "") + (o.fill ? " style='fill:" + o.fill + "'" : "") + ">" + esc(T(s)) + "</text>"; }
  function pl(pts, o) { o = o || {}; return "<polyline points='" + pts.map(function (p) { return p[0] + "," + p[1]; }).join(" ") + "' fill='none' stroke='" + (o.stroke || C.dim) + "' stroke-width='" + (o.w || 1.6) + "'" + (o.dash ? " stroke-dasharray='" + o.dash + "'" : "") + " stroke-linejoin='round' stroke-linecap='round'" + (o.op ? " opacity='" + o.op + "'" : "") + "/>"; }
  function rc(x, y, w, h, o) { o = o || {}; return "<rect x='" + x + "' y='" + y + "' width='" + w + "' height='" + h + "' rx='" + (o.rx == null ? 2 : o.rx) + "' fill='" + (o.fill || "none") + "'" + (o.fop != null ? " fill-opacity='" + o.fop + "'" : "") + " stroke='" + (o.stroke || "none") + "' stroke-width='" + (o.w || 1.5) + "'" + (o.dash ? " stroke-dasharray='" + o.dash + "'" : "") + "/>"; }
  function ln(x1, y1, x2, y2, o) { o = o || {}; return "<line x1='" + x1 + "' y1='" + y1 + "' x2='" + x2 + "' y2='" + y2 + "' stroke='" + (o.stroke || C.line) + "' stroke-width='" + (o.w || 1) + "'" + (o.dash ? " stroke-dasharray='" + o.dash + "'" : "") + (o.cap ? " stroke-linecap='round'" : "") + "/>"; }
  function ci(x, y, r, o) { o = o || {}; return "<circle cx='" + x + "' cy='" + y + "' r='" + r + "' fill='" + (o.fill || "none") + "' stroke='" + (o.stroke || "none") + "' stroke-width='" + (o.w || 1.5) + "'" + (o.dash ? " stroke-dasharray='" + o.dash + "'" : "") + "/>"; }
  function arrow(x1, y1, x2, y2, o) {
    o = o || {}; var a = Math.atan2(y2 - y1, x2 - x1), h = o.head || 6, col = o.stroke || C.dim;
    var p1 = [x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45)], p2 = [x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45)];
    return ln(x1, y1, x2, y2, { stroke: col, w: o.w || 1.5, dash: o.dash }) + "<polygon points='" + x2 + "," + y2 + " " + p1[0].toFixed(1) + "," + p1[1].toFixed(1) + " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1) + "' fill='" + col + "'/>";
  }
  function path(d, o) { o = o || {}; return "<path d='" + d + "' fill='" + (o.fill || "none") + "'" + (o.fop != null ? " fill-opacity='" + o.fop + "'" : "") + " stroke='" + (o.stroke || "none") + "' stroke-width='" + (o.w || 1.5) + "'" + (o.dash ? " stroke-dasharray='" + o.dash + "'" : "") + " stroke-linejoin='round'/>"; }

  // ---- strategies: capacity over time (shaded) against one demand path (dashed)
  var DEM = [[22, 80], [44, 74], [66, 77], [88, 64], [110, 68], [132, 55], [154, 58], [176, 46], [198, 50], [222, 40]];
  function axes(w, h) { return ln(20, h - 18, w - 8, h - 18, { stroke: C.line }) + ln(20, 10, 20, h - 18, { stroke: C.line }) + t(w - 8, h - 6, "time", { anchor: "end" }) + t(24, 14, "capacity"); }
  function demand() { return pl(DEM, { stroke: C.ink, dash: "4 3", w: 1.4, op: 0.8 }); }
  function capBlock(x0, x1, y, col) { return rc(x0, y, x1 - x0, 102 - y, { fill: col, fop: 0.22, stroke: col, rx: 1 }); }
  function lead(x0, x1) { return rc(x0, 92, x1 - x0, 10, { fill: "url(#ilh)", stroke: C.faint, w: 0.8, rx: 1 }) + t((x0 + x1) / 2, 89, "build", { anchor: "middle", cls: "sm" }); }
  var HATCH = "<defs><pattern id='ilh' width='5' height='5' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><line x1='0' y1='0' x2='0' y2='5' stroke='var(--ink-faint)' stroke-width='1.2'/></pattern></defs>";
  var STRAT = {
    full: function () { return HATCH + axes(240, 120) + capBlock(48, 230, 26, C.s4) + lead(22, 48) + demand() + t(138, 40, "the full site, built now", { anchor: "middle", fill: C.s4 }) + t(230, 112, "unused capacity carried for years", { anchor: "end", cls: "sm" }); },
    best: function () { return HATCH + axes(240, 120) + capBlock(48, 230, 56, C.s1) + lead(22, 48) + demand() + t(138, 52, "the best single size, now", { anchor: "middle", fill: C.s1 }) + t(230, 112, "too small if demand booms", { anchor: "end", cls: "sm" }); },
    defer: function () {
      return HATCH + axes(240, 120) + rc(22, 76, 120, 26, { fill: C.faint, fop: 0.12, stroke: C.faint, dash: "3 3", w: 0.8, rx: 1 }) + t(80, 72, "3PL serves demand", { anchor: "middle", cls: "sm" }) +
        lead(142, 166) + capBlock(166, 230, 26, C.s2) + demand() + ln(20, 66, 230, 66, { stroke: C.s2, dash: "2 3", w: 1.2 }) + ci(132, 55, 4, { fill: C.s2, stroke: "var(--panel)" }) +
        t(228, 18, "build once demand", { fill: C.s2, anchor: "end" }) + t(228, 28, "crosses the trigger", { fill: C.s2, anchor: "end" });
    },
    stage: function () {
      return HATCH + axes(240, 120) + lead(22, 48) + path("M48,102 L48,70 L110,70 L110,56 L170,56 L170,40 L230,40 L230,102 Z", { fill: C.s3, fop: 0.22, stroke: C.s3 }) + demand() +
        arrow(104, 84, 110, 72, { stroke: C.s3, head: 5 }) + arrow(164, 70, 170, 58, { stroke: C.s3, head: 5 }) + t(52, 64, "start small", { fill: C.s3 }) + t(228, 34, "add steps as it pays", { fill: C.s3, anchor: "end" });
    },
    lease: function () {
      return axes(240, 120) + rc(22, 96, 14, 6, { fill: C.faint, fop: 0.4, rx: 1 }) + capBlock(36, 160, 56, C.s5) + rc(160, 56, 70, 46, { fill: "none", stroke: C.s5, dash: "3 3", rx: 1 }) + demand() +
        ln(112, 18, 112, 102, { stroke: C.s5, dash: "1.5 3", w: 1.4 }) + ln(160, 18, 160, 102, { stroke: C.s5, dash: "1.5 3", w: 1.4 }) + t(112, 16, "break", { anchor: "middle", fill: C.s5 }) + t(160, 16, "break", { anchor: "middle", fill: C.s5 }) +
        t(66, 52, "rent, no capex", { anchor: "middle", fill: C.s5 }) + t(230, 112, "hand back if demand falls", { anchor: "end", cls: "sm" });
    }
  };

  // ---- network schematics: two regions, hubs (squares), customers (dots), flows (arrows)
  function region(cx, label) {
    var dots = [[-24, -10], [-12, 14], [6, -16], [20, 8], [-28, 12], [24, -12], [0, 20]].map(function (d) { return ci(cx + d[0], 70 + d[1] * 0.85, 2.6, { fill: C.dim }); }).join("");
    return "<ellipse cx='" + cx + "' cy='70' rx='46' ry='34' fill='var(--ink)' fill-opacity='0.05' stroke='var(--line)' stroke-dasharray='4 3'/>" + dots + t(cx, 118, label, { anchor: "middle" });
  }
  function hub(x, y, col, dashed, label) { return rc(x - 10, y - 10, 20, 20, { fill: dashed ? "none" : col, fop: dashed ? null : 0.35, stroke: col, dash: dashed ? "3 2" : null, rx: 3, w: 1.8 }) + (label ? t(x, 30, label, { anchor: "middle", fill: col }) : ""); }
  function spokes(x, y, cx, col, dash) { return [[-24, -10], [-12, 14], [6, -16], [20, 8]].map(function (d) { return ln(x, y, cx + d[0], 70 + d[1] * 0.85, { stroke: col, w: 0.9, dash: dash }); }).join(""); }
  var NET = {
    central: function () { return region(62, "region A") + region(178, "region B") + spokes(62, 70, 62, C.s1) + spokes(62, 70, 178, C.s1, "3 2") + hub(62, 70, C.s1, false, "one hub") + t(120, 12, "spare capacity serves the busier region", { anchor: "middle", cls: "sm" }); },
    two: function () { return region(62, "region A") + region(178, "region B") + spokes(62, 70, 62, C.s2) + spokes(178, 70, 178, C.s2) + hub(62, 70, C.s2, false, "hub A") + hub(178, 70, C.s2, false, "hub B") + t(120, 12, "each hub close to its customers", { anchor: "middle", cls: "sm" }); },
    pilot: function () {
      return region(62, "region A") + region(178, "region B") + spokes(62, 70, 62, C.s3) + spokes(62, 70, 178, C.s3, "3 2") + hub(62, 70, C.s3, false, "pilot now") + hub(178, 70, C.s3, true, "option on B") +
        arrow(76, 58, 162, 58, { stroke: C.s3, dash: "4 3", head: 6 }) + t(120, 12, "the second hub is cheaper once A exists", { anchor: "middle", cls: "sm" });
    },
    wait: function () {
      return region(62, "region A") + region(178, "region B") + hub(62, 70, C.s5, true, "option on A") + hub(178, 70, C.s5, true, "option on B") +
        rc(102, 84, 36, 16, { fill: "var(--panel-2)", stroke: C.faint, rx: 3, w: 1 }) + t(120, 95, "3PL", { anchor: "middle", cls: "sm" }) + t(120, 12, "open either hub, both, or neither", { anchor: "middle", cls: "sm" });
    }
  };

  // ---- concepts (300 × 150)
  var CON = {
    lattice: function () {
      var nodes = [], edges = "", x0 = 40, dx = 70, cy = 75, dy = 26;
      for (var s = 0; s <= 3; s++) for (var i = 0; i <= s; i++) nodes.push([x0 + s * dx, cy + (s - 2 * i) * dy, s, i]);
      nodes.forEach(function (n) { if (n[2] < 3) { edges += ln(n[0], n[1], n[0] + dx, n[1] - dy, { stroke: C.s1, w: 1.3 }) + ln(n[0], n[1], n[0] + dx, n[1] + dy, { stroke: C.s2, w: 1.3 }); } });
      return wrap(300, 150, "A recombining binomial lattice", edges + nodes.map(function (n) { return ci(n[0], n[1], 5, { fill: "var(--panel)", stroke: C.ink, w: 1.4 }); }).join("") +
        t(60, 46, "×u, probability p", { anchor: "middle", fill: C.s1 }) + t(60, 110, "×d = 1/u, 1 − p", { anchor: "middle", fill: C.s2 }) + t(296, 146, "up then down = down then up", { anchor: "end", cls: "sm" }) + t(40, 146, "today", { anchor: "middle", cls: "sm" }));
    },
    induction: function () {
      return wrap(300, 150, "Backward induction: compare acting with waiting at every node", rc(18, 38, 74, 74, { stroke: C.line, rx: 8 }) + t(55, 32, "a node", { anchor: "middle" }) +
        rc(28, 50, 54, 20, { fill: C.s3, fop: 0.2, stroke: C.s3, rx: 4 }) + t(55, 64, "act now", { anchor: "middle", fill: C.s3 }) + rc(28, 80, 54, 20, { fill: C.s1, fop: 0.2, stroke: C.s1, rx: 4 }) + t(55, 94, "wait", { anchor: "middle", fill: C.s1 }) +
        arrow(196, 44, 100, 60, { stroke: C.faint, head: 6 }) + arrow(196, 106, 100, 90, { stroke: C.faint, head: 6 }) + ci(210, 40, 6, { fill: "var(--panel)", stroke: C.ink }) + ci(210, 110, 6, { fill: "var(--panel)", stroke: C.ink }) +
        t(222, 36, "if demand rises") + t(222, 114, "if it falls") + t(150, 140, "solved backwards from the end of life", { anchor: "middle", cls: "sm" }));
    },
    payoff: function () {
      return wrap(300, 150, "Fixed designs lose heavily when demand disappoints; flexible ones bend", ln(30, 120, 285, 120, { stroke: C.line }) + ln(30, 14, 30, 120, { stroke: C.line }) + ln(30, 84, 285, 84, { stroke: C.faint, dash: "2 3" }) +
        pl([[40, 124], [160, 60], [280, 40]], { stroke: C.s1, w: 2 }) + pl([[40, 92], [110, 88], [160, 64], [280, 34]], { stroke: C.s3, w: 2.2 }) + t(286, 82, "NPV = 0", { anchor: "end", cls: "sm" }) +
        t(40, 26, "flexible: losses cut", { fill: C.s3 }) + t(40, 38, "fixed: full downside", { fill: C.s1 }) + t(282, 132, "how demand turns out →", { anchor: "end", cls: "sm" }) + t(34, 12, "value"));
    },
    fan: function () {
      function f(cx, s, lab) {
        var up = [], lo = []; for (var k = 0; k <= 10; k++) { var x = cx - 60 + k * 12, sp = s * Math.sqrt(k / 10) * 46; up.push([x, 80 - k * 2 - sp]); lo.push([x, 80 - k * 2 + sp]); }
        return path("M" + up.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" L") + " L" + lo.reverse().map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" L") + " Z", { fill: C.ink, fop: 0.12 }) +
          pl([[cx - 60, 80], [cx + 60, 60]], { stroke: C.dim, w: 1.4 }) + t(cx, 142, lab, { anchor: "middle" });
      }
      return wrap(300, 150, "Low and high volatility: how wide the future is", f(78, 0.35, "volatility 10%") + f(222, 1.15, "volatility 40%") + t(222, 16, "more futures where waiting pays", { anchor: "middle", cls: "sm" }));
    },
    baseline: function () {
      function bar(x, h, col, lab) { return rc(x, 120 - h, 40, h, { fill: col, fop: 0.3, stroke: col, rx: 2 }) + t(x + 20, 134, lab, { anchor: "middle", cls: "sm" }); }
      return wrap(300, 150, "Measure flexibility against the best fixed design, not a straw man", ln(20, 120, 285, 120, { stroke: C.line }) + bar(40, 50, C.s4, "commit now") + bar(130, 72, C.s1, "best fixed") + bar(220, 86, C.s3, "flexible") +
        ln(178, 48, 258, 34, { stroke: C.faint, dash: "2 2" }) + arrow(270, 48, 270, 36, { stroke: C.good, head: 5 }) + t(276, 46, "honest", { fill: C.good, cls: "sm" }) +
        arrow(26, 70, 26, 36, { stroke: C.bad, head: 5 }) + t(32, 30, "flattering: against an oversized plan", { fill: C.bad, cls: "sm" }));
    },
    trigger: function () {
      return wrap(300, 150, "A trigger: act once demand crosses the threshold", ln(24, 124, 286, 124, { stroke: C.line }) + ln(24, 58, 286, 58, { stroke: C.s2, dash: "5 3", w: 1.5 }) + t(284, 52, "trigger", { anchor: "end", fill: C.s2 }) +
        pl([[24, 100], [60, 92], [96, 98], [130, 78], [160, 84], [188, 58], [220, 50], [256, 44], [286, 36]], { stroke: C.ink, w: 1.6 }) + ci(188, 58, 6, { fill: C.s2, stroke: "var(--panel)" }) +
        t(188, 84, "act here", { anchor: "middle", fill: C.s2 }) + t(70, 118, "below: keep waiting", { cls: "sm" }));
    },
    bridge: function () {
      return wrap(300, 150, "Waiting needs a bridge: without a 3PL, every quarter of waiting loses sales", ln(24, 120, 286, 120, { stroke: C.line }) + pl([[24, 80], [286, 64]], { stroke: C.ink, dash: "4 3" }) +
        path("M24,80 L150,72 L150,120 L24,120 Z", { fill: C.faint, fop: 0.18 }) + t(86, 104, "3PL serves", { anchor: "middle", cls: "sm" }) +
        path("M150,72 L200,69 L200,120 L150,120 Z", { fill: C.bad, fop: 0.25 }) + t(175, 100, "lost", { anchor: "middle", fill: C.bad, cls: "sm" }) + rc(200, 40, 86, 80, { fill: C.s2, fop: 0.2, stroke: C.s2 }) + t(243, 36, "own site", { anchor: "middle", fill: C.s2 }) +
        t(150, 142, "with no 3PL and costly lost sales, waiting builds at once", { anchor: "middle", cls: "sm" }));
    },
    window: function () {
      return wrap(300, 150, "The decision window is shorter than the asset life", ln(20, 90, 286, 90, { stroke: C.line, w: 1.5 }) + rc(20, 62, 110, 28, { fill: C.acc, fop: 0.15, stroke: C.acc }) + t(75, 80, "decision window", { anchor: "middle", fill: C.acc }) +
        rc(20, 96, 266, 16, { fill: C.ink, fop: 0.07, stroke: C.line, rx: 2 }) + t(153, 108, "asset life: the network operates", { anchor: "middle", cls: "sm" }) + t(75, 54, "build, expand", { anchor: "middle", cls: "sm" }) + t(208, 80, "then fixed, except selling or idling", { anchor: "middle", cls: "sm" }));
    },
    hysteresis: function () {
      return wrap(300, 150, "Hysteresis: idle at low demand, restart only at higher demand", ln(40, 20, 40, 130, { stroke: C.line }) + t(44, 16, "demand") + rc(40, 62, 250, 32, { fill: C.acc, fop: 0.1 }) + t(170, 82, "band: keep doing what you do", { anchor: "middle", cls: "sm" }) +
        ln(40, 62, 290, 62, { stroke: C.s1, w: 1.6 }) + t(288, 56, "restart above", { anchor: "end", fill: C.s1 }) + ln(40, 94, 290, 94, { stroke: C.s1, dash: "1.5 3.5", w: 2 }) + t(288, 108, "mothball below", { anchor: "end", fill: C.s1 }) +
        t(60, 140, "switching costs keep the site from flipping back and forth", { cls: "sm" }));
    },
    sellidle: function () {
      return wrap(300, 150, "When demand collapses: sell for cash, or idle and keep paying", ci(40, 75, 8, { fill: C.bad, fop: 0.3, stroke: C.bad }) + t(40, 100, "demand", { anchor: "middle", cls: "sm" }) + t(40, 110, "collapses", { anchor: "middle", cls: "sm" }) +
        arrow(52, 68, 140, 38, { stroke: C.good }) + arrow(52, 82, 140, 112, { stroke: C.s1, dash: "4 3" }) + rc(146, 22, 136, 32, { fill: C.good, fop: 0.12, stroke: C.good, rx: 6 }) + t(214, 36, "sell: cash now,", { anchor: "middle", fill: C.good }) + t(214, 48, "costs end", { anchor: "middle", fill: C.good }) +
        rc(146, 96, 136, 32, { fill: C.s1, fop: 0.12, stroke: C.s1, rx: 6 }) + t(214, 110, "idle: part of the cost stays,", { anchor: "middle", fill: C.s1 }) + t(214, 122, "pays only if demand returns", { anchor: "middle", fill: C.s1 }));
    },
    pooling: function () {
      var a = [], b = [], s = [];
      for (var k = 0; k <= 24; k++) { var x = 24 + k * 10.5, ya = 60 - 16 * Math.sin(k / 3.2), yb = 60 + 16 * Math.sin(k / 3.2); a.push([x, ya]); b.push([x, yb]); s.push([x, 116]); }
      return wrap(300, 150, "Pooling: when regions move apart, their total is steady", pl(a, { stroke: C.s1, w: 1.8 }) + pl(b, { stroke: C.s2, w: 1.8 }) + pl(s, { stroke: C.ink, w: 2.2 }) + t(28, 30, "region A", { fill: C.s1 }) + t(28, 94, "region B", { fill: C.s2 }) +
        t(28, 110, "together", { fill: C.ink }) + t(280, 134, "one shared hub can be sized for the steady total", { anchor: "end", cls: "sm" }));
    },
    compound: function () {
      return wrap(300, 150, "A compound option: the first hub buys a cheaper option on the second", rc(24, 58, 70, 34, { fill: C.s3, fop: 0.3, stroke: C.s3, rx: 6 }) + t(59, 79, "hub A now", { anchor: "middle", fill: C.ink }) +
        arrow(96, 66, 176, 36, { stroke: C.s3, dash: "4 3" }) + arrow(96, 84, 176, 114, { stroke: C.faint, dash: "4 3" }) + rc(180, 18, 104, 34, { stroke: C.s3, dash: "3 2", rx: 6 }) + t(232, 33, "open hub B", { anchor: "middle", fill: C.s3 }) + t(232, 45, "fixed cost −40%", { anchor: "middle", cls: "sm" }) +
        rc(180, 98, 104, 34, { stroke: C.faint, dash: "3 2", rx: 6 }) + t(232, 119, "or never", { anchor: "middle", fill: C.faint }) + t(136, 146, "if demand in B confirms", { anchor: "middle", cls: "sm" }));
    },
    riskneutral: function () {
      return wrap(300, 150, "Two valuation bases", rc(14, 24, 128, 102, { stroke: C.line, rx: 8 }) + rc(158, 24, 128, 102, { stroke: C.acc, rx: 8 }) + t(78, 44, "expected cash flows", { anchor: "middle" }) + t(222, 44, "risk-neutral", { anchor: "middle", fill: C.acc }) +
        t(78, 72, "drift g", { anchor: "middle", fill: C.ink }) + t(78, 98, "discount at WACC", { anchor: "middle", fill: C.ink }) + t(222, 72, "drift g − λσ", { anchor: "middle", fill: C.ink }) + t(222, 98, "discount at r_f", { anchor: "middle", fill: C.ink }) +
        t(222, 140, "consistent with option pricing", { anchor: "middle", cls: "sm" }) + t(78, 140, "practitioner's convention", { anchor: "middle", cls: "sm" }));
    },
    map2d: function () {
      var cells = "", cols = [C.faint, C.s1, C.s2, C.s3];
      for (var i = 0; i < 8; i++) for (var j = 0; j < 6; j++) { var c = i + j > 8 ? 3 : i > 4 ? 1 : j > 3 ? 2 : 0; cells += rc(70 + i * 22, 112 - (j + 1) * 16, 20, 14, { fill: cols[c], fop: c ? 0.6 : 0.15, rx: 2 }); }
      return wrap(300, 150, "A decision map in two dimensions", cells + t(158, 128, "demand in region A →", { anchor: "middle", cls: "sm" }) + t(64, 22, "B ↑", { anchor: "end", cls: "sm" }) +
        t(14, 40, "both", { fill: C.s3, cls: "sm" }) + t(14, 56, "hub B", { fill: C.s2, cls: "sm" }) + t(14, 72, "hub A", { fill: C.s1, cls: "sm" }) + t(14, 88, "wait", { cls: "sm" }));
    },
    calibrate: function () {
      var h = [[20, 96], [36, 90], [52, 94], [68, 84], [84, 88], [100, 78], [116, 82], [132, 72], [148, 76]];
      return wrap(300, 150, "From a demand history to growth and volatility", ln(148, 16, 148, 126, { stroke: C.line, dash: "3 3" }) + pl(h, { stroke: C.s1, w: 1.8 }) +
        path("M148,76 L284,40 L284,108 Z", { fill: C.ink, fop: 0.12 }) + pl([[148, 76], [284, 58]], { stroke: C.dim, dash: "5 4" }) + t(80, 116, "your history", { anchor: "middle", fill: C.s1 }) + t(216, 126, "fitted fan: growth g, volatility σ", { anchor: "middle", cls: "sm" }) + t(148, 140, "today", { anchor: "middle", cls: "sm" }));
    },
    report: function () {
      return wrap(300, 150, "A printable decision report", rc(104, 14, 92, 122, { fill: "var(--panel)", stroke: C.ink, rx: 4 }) + ln(116, 34, 184, 34, { stroke: C.acc, w: 3 }) + [48, 60, 72].map(function (y) { return ln(116, y, 184, y, { stroke: C.faint, w: 2 }); }).join("") +
        rc(116, 84, 30, 36, { fill: C.s3, fop: 0.4, rx: 1 }) + rc(152, 96, 30, 24, { fill: C.s1, fop: 0.4, rx: 1 }) + t(210, 40, "recommendation") + t(210, 70, "triggers by year") + t(210, 100, "sensitivity, inputs"));
    },
    options: function () {
      return wrap(300, 150, "A real option: the right, not the obligation, to act later", ci(48, 75, 9, { fill: C.acc, fop: 0.3, stroke: C.acc }) + t(48, 102, "today", { anchor: "middle", cls: "sm" }) +
        arrow(60, 70, 166, 32, { stroke: C.good }) + arrow(60, 80, 166, 118, { stroke: C.bad }) + rc(170, 18, 116, 28, { fill: C.good, fop: 0.12, stroke: C.good, rx: 6 }) + t(228, 36, "good future: act", { anchor: "middle", fill: C.good }) +
        rc(170, 104, 116, 28, { fill: C.bad, fop: 0.12, stroke: C.bad, rx: 6 }) + t(228, 122, "bad future: don't", { anchor: "middle", fill: C.bad }) + t(150, 82, "pay a little now to keep the choice", { anchor: "middle", cls: "sm" }));
    }
  };

  var NAMES = { full: "Commit now", best: "Best fixed", defer: "Wait & see", stage: "Stage & expand", lease: "Lease & break", central: "Central hub", two: "Two hubs", pilot: "Pilot hub", wait: "Wait & see network" };
  var uid = 0;
  function svg(key) {
    var parts = String(key).split(":");
    if (parts[0] === "strategy" && STRAT[parts[1]]) { var id = "ilh" + (++uid); return wrap(240, 120, T("{name}: capacity over time against demand", { name: T(NAMES[parts[1]]) }), STRAT[parts[1]]().replace(/ilh/g, id)); }
    if (parts[0] === "net" && NET[parts[1]]) return wrap(240, 124, T("{name}: the network", { name: T(NAMES[parts[1]]) }), NET[parts[1]]());
    if (CON[key]) return CON[key]();
    return "";
  }
  var LIST = Object.keys(STRAT).map(function (k) { return "strategy:" + k; }).concat(Object.keys(NET).map(function (k) { return "net:" + k; }), Object.keys(CON));
  return { svg: svg, LIST: LIST };
});
