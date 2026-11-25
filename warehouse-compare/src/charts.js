/*
 * charts.js — a small SVG line chart for the Sensitivity and Demand shock views.
 *
 *   lineChart(el, spec)   spec = { title, xLabel, yLabel, xFmt, yFmt,
 *                                 series: [{ name, color, points: [{ x, y }] }],
 *                                 marks: [{ x, label }] (vertical reference lines) }
 *
 * One y-axis; 2 px lines; recessive grid; a legend for two or more series and
 * direct labels at the line ends (nudged apart); a crosshair that snaps to the
 * nearest x with one tooltip listing every series (value first); and a table
 * view of the same numbers. Names are inserted as text, never as HTML.
 */
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceTicks(lo, hi, n) {
    if (!(hi > lo)) { hi = lo + 1; }
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  function lineChart(host, spec) {
    host.innerHTML = "";
    host.classList.add("chart");
    const title = document.createElement("div"); title.className = "chart-title"; title.textContent = spec.title; host.appendChild(title);
    const series = spec.series.filter(function (s) { return s.points.some(function (p) { return isFinite(p.y); }); });
    if (series.length >= 2) {
      const lg = document.createElement("div"); lg.className = "chart-legend";
      series.forEach(function (s) {
        const it = document.createElement("span"), key = document.createElement("i");
        key.style.background = s.color; it.appendChild(key); it.appendChild(document.createTextNode(s.name)); lg.appendChild(it);
      });
      host.appendChild(lg);
    }
    const wrap = document.createElement("div"); wrap.className = "chart-wrap"; host.appendChild(wrap);
    const W = Math.max(280, host.clientWidth || 600), H = spec.height || 230;
    // right margin wide enough for the longest direct label (≈ 6.3 px a character at 11.5 px)
    const longest = series.reduce(function (a, s) { return Math.max(a, s.name.length); }, 0);
    const m = { l: 52, r: series.length <= 4 ? Math.max(60, Math.round(longest * 6.3) + 16) : 16, t: 20, b: 38 };
    const svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", height: H, role: "img", "aria-label": spec.title }, wrap);
    const xs = [], ys = [];
    series.forEach(function (s) { s.points.forEach(function (p) { if (isFinite(p.y)) { xs.push(p.x); ys.push(p.y); } }); });
    (spec.marks || []).forEach(function (mk) { xs.push(mk.x); });
    let x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min(0, Math.min.apply(null, ys)), y1 = Math.max.apply(null, ys);
    if (x1 === x0) x1 = x0 + 1;
    const yt = niceTicks(y0, y1 * 1.05, 4); y1 = Math.max(y1, yt[yt.length - 1]); y0 = Math.min(y0, yt[0]);
    const X = function (v) { return m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r); }, Y = function (v) { return H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b); };
    const fx = spec.xFmt || function (v) { return String(v); }, fy = spec.yFmt || function (v) { return v.toFixed(1); };

    // grid + axes (recessive)
    yt.forEach(function (v) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "grid" }, svg);
      const t = el("text", { x: m.l - 6, y: Y(v) + 4, "text-anchor": "end", class: "tick" }, svg); t.textContent = fy(v);
    });
    const xticks = spec.xTicks || niceTicks(x0, x1, 6);
    xticks.forEach(function (v) {
      if (v < x0 - 1e-9 || v > x1 + 1e-9) return;
      const t = el("text", { x: X(v), y: H - m.b + 16, "text-anchor": "middle", class: "tick" }, svg); t.textContent = fx(v);
    });
    el("line", { x1: m.l, x2: W - m.r, y1: Y(y0), y2: Y(y0), class: "axis" }, svg);
    const xl = el("text", { x: (m.l + W - m.r) / 2, y: H - 4, "text-anchor": "middle", class: "axis-label" }, svg); xl.textContent = spec.xLabel;
    const yl = el("text", { x: 12, y: (m.t + H - m.b) / 2, "text-anchor": "middle", class: "axis-label", transform: "rotate(-90 12 " + (m.t + H - m.b) / 2 + ")" }, svg); yl.textContent = spec.yLabel;

    // reference marks
    (spec.marks || []).forEach(function (mk) {
      el("line", { x1: X(mk.x), x2: X(mk.x), y1: m.t, y2: H - m.b, class: "refline" }, svg);
      const t = el("text", { x: X(mk.x) + 4, y: m.t - 6, class: "reflabel" }, svg); t.textContent = mk.label;     // in the top margin, clear of the lines
    });

    // lines + markers on sparse series
    series.forEach(function (s) {
      let d = "", pen = false;
      s.points.forEach(function (p) { if (!isFinite(p.y)) { pen = false; return; } d += (pen ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1); pen = true; });
      el("path", { d: d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      if (s.points.length <= 12) s.points.forEach(function (p) { if (isFinite(p.y)) el("circle", { cx: X(p.x), cy: Y(p.y), r: 4, fill: s.color, stroke: "var(--chart-surface)", "stroke-width": 2 }, svg); });
    });
    // direct labels at line ends, nudged so they don't collide
    if (series.length <= 4) {
      const ends = series.map(function (s) {
        const pts = s.points.filter(function (p) { return isFinite(p.y); }), p = pts[pts.length - 1];
        return { s: s, y: Y(p.y), x: X(p.x) };
      }).sort(function (a, b) { return a.y - b.y; });
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
      // keep them inside the plot: if the bottom one ran past the axis, push the stack back up
      const maxY = H - m.b - 4;
      if (ends.length && ends[ends.length - 1].y > maxY) {
        ends[ends.length - 1].y = maxY;
        for (let i = ends.length - 2; i >= 0; i--) if (ends[i + 1].y - ends[i].y < 13) ends[i].y = ends[i + 1].y - 13;
      }
      ends.forEach(function (e) { const t = el("text", { x: e.x + 8, y: e.y + 4, class: "endlabel" }, svg); t.textContent = e.s.name; });
    }

    // crosshair + tooltip: snaps to the nearest x present in the data
    const allX = Array.from(new Set(series.reduce(function (a, s) { return a.concat(s.points.map(function (p) { return p.x; })); }, []))).sort(function (a, b) { return a - b; });
    const hair = el("line", { y1: m.t, y2: H - m.b, class: "hair", visibility: "hidden" }, svg);
    const tip = document.createElement("div"); tip.className = "chart-tip"; tip.hidden = true; wrap.appendChild(tip);
    const hit = el("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent", tabindex: 0 }, svg);
    function show(xv) {
      hair.setAttribute("x1", X(xv)); hair.setAttribute("x2", X(xv)); hair.setAttribute("visibility", "visible");
      tip.innerHTML = "";
      const h = document.createElement("div"); h.className = "tip-x"; h.textContent = (spec.xName || spec.xLabel) + ": " + fx(xv); tip.appendChild(h);
      series.forEach(function (s) {
        const p = s.points.find(function (q) { return q.x === xv; });
        const row = document.createElement("div"), key = document.createElement("i"), val = document.createElement("b"), nm = document.createElement("span");
        key.style.background = s.color; val.textContent = p && isFinite(p.y) ? fy(p.y) : "—"; nm.textContent = s.name;
        row.appendChild(key); row.appendChild(val); row.appendChild(nm); tip.appendChild(row);
      });
      tip.hidden = false;
      const px = X(xv) / W * wrap.clientWidth;
      tip.style.left = Math.min(wrap.clientWidth - tip.offsetWidth - 4, Math.max(4, px + 12)) + "px";
    }
    function nearest(clientX) {
      const r = svg.getBoundingClientRect(), vx = (clientX - r.left) / r.width * W;
      let b = allX[0]; allX.forEach(function (v) { if (Math.abs(X(v) - vx) < Math.abs(X(b) - vx)) b = v; });
      return b;
    }
    hit.addEventListener("pointermove", function (e) { show(nearest(e.clientX)); });
    hit.addEventListener("pointerleave", function () { tip.hidden = true; hair.setAttribute("visibility", "hidden"); });
    let fi = 0;
    hit.addEventListener("focus", function () { fi = 0; show(allX[fi]); });
    hit.addEventListener("blur", function () { tip.hidden = true; hair.setAttribute("visibility", "hidden"); });
    hit.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") fi = Math.min(allX.length - 1, fi + 1); else if (e.key === "ArrowLeft") fi = Math.max(0, fi - 1); else return;
      e.preventDefault(); show(allX[fi]);
    });

    // table view
    const det = document.createElement("details"); det.className = "chart-table";
    const sum = document.createElement("summary"); const T = WC.t.T; sum.textContent = T("Table"); det.appendChild(sum);
    const tb = document.createElement("table"), hr = document.createElement("tr");
    [spec.xName || spec.xLabel].concat(series.map(function (s) { return s.name; })).forEach(function (h) { const th = document.createElement("th"); th.textContent = h; hr.appendChild(th); });
    tb.appendChild(hr);
    allX.forEach(function (xv) {
      const tr = document.createElement("tr"), td0 = document.createElement("td"); td0.textContent = fx(xv); tr.appendChild(td0);
      series.forEach(function (s) { const p = s.points.find(function (q) { return q.x === xv; }), td = document.createElement("td"); td.textContent = p && isFinite(p.y) ? fy(p.y) : "—"; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    det.appendChild(tb); host.appendChild(det);
  }

  root.WC = root.WC || {}; root.WC.charts = { lineChart: lineChart };
})(typeof self !== "undefined" ? self : this);
