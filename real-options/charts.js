// Real Options for Network Design — small SVG chart helpers shared by the pages (window.ROCharts).
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, parent, ns) {
    var e = ns ? document.createElementNS(ns, tag) : (parent && parent.namespaceURI === NS ? document.createElementNS(NS, tag) : document.createElement(tag));
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e); return e;
  }
  function clear(svg) { while (svg.firstChild) svg.removeChild(svg.firstChild); }
  function scale(d0, d1, r0, r1) { var f = function (v) { return r0 + (v - d0) / (d1 - d0 || 1) * (r1 - r0); }; f.inv = function (px) { return d0 + (px - r0) / (r1 - r0) * (d1 - d0); }; f.lo = Math.min(d0, d1); f.hi = Math.max(d0, d1); f.d0 = d0; f.d1 = d1; return f; }
  function line(svg, x1, y1, x2, y2, a) { var o = { x1: x1, y1: y1, x2: x2, y2: y2 }; Object.keys(a || {}).forEach(function (k) { o[k] = a[k]; }); return el("line", o, svg, NS); }
  function rect(svg, x, y, w, h, a) { var o = { x: x, y: y, width: Math.max(0, w), height: Math.max(0, h) }; Object.keys(a || {}).forEach(function (k) { o[k] = a[k]; }); return el("rect", o, svg, NS); }
  function text(svg, x, y, s, a) { var o = { x: x, y: y }; Object.keys(a || {}).forEach(function (k) { o[k] = a[k]; }); var t = el("text", o, svg, NS); t.textContent = s; return t; }
  function path(svg, pts, a) { if (!pts.length) return; var o = { d: "M" + pts.map(function (q) { return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join("L") }; Object.keys(a || {}).forEach(function (k) { o[k] = a[k]; }); return el("path", o, svg, NS); }
  function area(svg, rows, x, y, a, b, fill) {
    var top = rows.map(function (r) { return x(r.y).toFixed(1) + "," + y(r[b]).toFixed(1); }), bot = rows.slice().reverse().map(function (r) { return x(r.y).toFixed(1) + "," + y(r[a]).toFixed(1); });
    el("path", { d: "M" + top.join("L") + "L" + bot.join("L") + "Z", fill: fill, stroke: "none" }, svg, NS);
  }
  function ticks(lo, hi, n) { var span = hi - lo, st = Math.pow(10, Math.floor(Math.log10(span / n))), err = span / n / st; st *= err >= 7.5 ? 10 : err >= 3 ? 5 : err >= 1.5 ? 2 : 1; var out = []; for (var v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) out.push(+v.toFixed(10)); return out; }
  function axes(svg, x, y, W, H, m, xmax, ymax, xl, yl, yfmt, xfmt) {
    ticks(y.lo, y.hi, 5).forEach(function (v) { line(svg, m.l, y(v), W - m.r, y(v), { class: "grid" }); text(svg, m.l - 6, y(v) + 4, yfmt ? yfmt(v) : fmtNum(v), { "text-anchor": "end" }); });
    ticks(x.lo, x.hi, 6).forEach(function (v) { text(svg, x(v), H - m.b + 15, xfmt ? xfmt(v) : fmtNum(v), { "text-anchor": "middle" }); });
    line(svg, m.l, H - m.b, W - m.r, H - m.b, { class: "axis" });
    text(svg, (m.l + W - m.r) / 2, H - 4, xl, { "text-anchor": "middle" });
    var t = text(svg, 12, (m.t + H - m.b) / 2, yl, { "text-anchor": "middle", transform: "rotate(-90 12 " + (m.t + H - m.b) / 2 + ")" });
    return t;
  }
  function fmtNum(v) { return Math.abs(v) >= 1000 ? (window.ROi18n ? window.ROi18n.T("{v}k", { v: (v / 1000).toFixed(1) }) : (v / 1000).toFixed(1) + "k") : Math.abs(v) < 1 && v !== 0 ? v.toFixed(2) : String(Math.round(v * 10) / 10); }
  function legend(host, items) {
    host.innerHTML = "";
    items.forEach(function (it) {
      var s = el("span", {}, host), i = el("i", { class: it[0] === "line" || it[0] === "dot2" ? "line" : it[0] === "dash" ? "dash" : "" }, s);
      if (it[0] === "dash") i.style.borderColor = it[1];
      else if (it[0] === "dot2") i.style.background = "repeating-linear-gradient(90deg, " + it[1] + " 0 2px, transparent 2px 5px)";
      else i.style.background = it[1];
      if (it[0] === "dot") i.style.borderRadius = "50%";
      s.appendChild(document.createTextNode(it[2]));
    });
  }
  // a hover layer: a crosshair at the returned x (if any) and a tooltip with the returned html
  function hover(svg, m, W, H, fn) {
    var tt = document.getElementById("tt");
    var cross = line(svg, 0, m.t, 0, H - m.b, { stroke: "var(--accent)", "stroke-width": 1, opacity: 0, "pointer-events": "none" });
    var hit = rect(svg, m.l, 0, W - m.l - m.r, H, { fill: "transparent" });
    function move(ev) {
      var pt = svg.createSVGPoint(), src = ev.touches ? ev.touches[0] : ev; pt.x = src.clientX; pt.y = src.clientY;
      var loc = pt.matrixTransform(svg.getScreenCTM().inverse()), r = fn(loc.x, loc.y);
      if (!r) { tt.style.display = "none"; cross.setAttribute("opacity", 0); return; }
      tt.innerHTML = r.html; tt.style.display = "block";
      var tx = src.clientX + 14, ty = src.clientY + 14, bw = tt.offsetWidth, bh = tt.offsetHeight;
      if (tx + bw > innerWidth - 8) tx = src.clientX - bw - 14; if (ty + bh > innerHeight - 8) ty = src.clientY - bh - 14;
      tt.style.left = tx + "px"; tt.style.top = ty + "px";
      if (r.x != null) { cross.setAttribute("x1", r.x); cross.setAttribute("x2", r.x); cross.setAttribute("opacity", 0.6); } else cross.setAttribute("opacity", 0);
    }
    hit.addEventListener("mousemove", move); hit.addEventListener("touchstart", move, { passive: true });
    hit.addEventListener("mouseleave", function () { tt.style.display = "none"; cross.setAttribute("opacity", 0); });
  }

  function segments(pts) { var out = [], cur = []; pts.forEach(function (q) { if (q.D === null) { if (cur.length) out.push(cur); cur = []; } else cur.push(q); }); if (cur.length) out.push(cur); return out.filter(function (s) { return s.length > 1; }); }
  function nearest(arr, v) { var b = null, bd = Infinity; arr.forEach(function (a) { var d = Math.abs(a.y - v); if (d < bd) { bd = d; b = a; } }); return b; }
  function quant(a, q) { var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; }
  window.ROCharts = { NS: NS, el: el, clear: clear, scale: scale, line: line, rect: rect, text: text, path: path, area: area, ticks: ticks, axes: axes,
    fmtNum: fmtNum, legend: legend, hover: hover, segments: segments, nearest: nearest, quant: quant };
})();
