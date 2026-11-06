// Turbine Lab — technical drawings page. Builds an A3 general-arrangement sheet (SVG, millimetres) for one machine from
// the views rendered by tools/render_drawings.py (drawings/<machine>-A|B|C|iso.png) and their mapping data
// (drawings/<machine>.json): cutting-plane lines, overall dimensions, the runner diameter, numbered balloons, the parts
// list, notes and the title block. Every user-visible message goes through T(english, vars).
(function () {
  "use strict";
  var VERSION = "1.1.0";
  var I18 = window.TLi18n, T = I18.T, MA = window.TLmach;
  var PDICT = I18.lang === "es" ? (window.TL_ES || {}).P : I18.lang === "da" ? (window.TL_DA || {}).P : null;
  function partName(k) { return PDICT && PDICT[k] ? PDICT[k][0] : MA.PARTS[k][0]; }
  var $ = function (id) { return document.getElementById(id); };
  $("ver").textContent = "v" + VERSION;

  var MACHINES = ["pelton", "francis", "kaplan"];
  var TITLE = {
    pelton: function () { return T("Pelton turbine"); },
    francis: function () { return T("Francis turbine"); },
    kaplan: function () { return T("Kaplan turbine (in-stream)"); }
  };
  var CODE = { pelton: "TL-PEL-001", francis: "TL-FRA-001", kaplan: "TL-KAP-001" };
  // the view in which the runner is seen end-on, for its diameter
  var RUNNER_VIEW = { pelton: "A", francis: "C", kaplan: "B" };
  var DATE = "2026-11-06";

  // sheet geometry (mm): A3 landscape, ISO 5457 frame (20 mm binding margin on the left)
  // CELL must equal the render's cellMm, or the printed scale would not be the one stated
  var W = 420, H = 297, CELL = 125;
  var CELLS = { A: [26, 13], B: [158, 13], C: [26, 151], iso: [158, 151] };
  var COL = 290, COLW = 120;
  var INK = "#141a22", FAINT = "#5a6675";

  var cache = {};
  var current = null;

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function mm(v) { var r = Math.round(v / 10) * 10; return String(r).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  function f(n) { return Math.round(n * 100) / 100; }

  function el(tag, attrs, inner) {
    var a = Object.keys(attrs || {}).map(function (k) { return k + '="' + attrs[k] + '"'; }).join(" ");
    return "<" + tag + (a ? " " + a : "") + (inner == null ? "/>" : ">" + inner + "</" + tag + ">");
  }
  function line(x1, y1, x2, y2, w, extra) { return el("line", Object.assign({ x1: f(x1), y1: f(y1), x2: f(x2), y2: f(y2), stroke: INK, "stroke-width": w || 0.25 }, extra || {})); }
  function text(x, y, s, size, extra) { return el("text", Object.assign({ x: f(x), y: f(y), "font-size": size || 3, fill: INK, "font-family": "'IBM Plex Mono', monospace" }, extra || {}), esc(s)); }
  function arrow(x, y, dx, dy, len, w) {
    // filled arrowhead with its tip at (x, y), pointing along (dx, dy)
    var L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; len = len || 2.4; w = w || 0.8;
    var bx = x - dx * len, by = y - dy * len;
    return el("path", { d: "M" + f(x) + " " + f(y) + " L" + f(bx - dy * w) + " " + f(by + dx * w) + " L" + f(bx + dy * w) + " " + f(by - dx * w) + " Z", fill: INK });
  }
  function wrap(s, n) {
    var out = [], lineS = "";
    String(s).split(" ").forEach(function (w) { if ((lineS + " " + w).trim().length > n) { out.push(lineS.trim()); lineS = w; } else lineS += " " + w; });
    if (lineS.trim()) out.push(lineS.trim());
    return out;
  }

  // ---- one section view: image, cutting-plane lines, overall dimensions, runner diameter, balloons
  function view(m, d, name, items) {
    var v = d.views[name], c = CELLS[name], k = CELL / d.res;
    var P = function (p) { return [c[0] + p[0] * k, c[1] + p[1] * k]; };
    var s = el("a", { href: "drawings/" + m + "-" + name + ".png?v=" + VERSION, target: "_blank" },
      el("image", { href: "drawings/" + m + "-" + name + ".png?v=" + VERSION, x: c[0], y: c[1], width: CELL, height: CELL, preserveAspectRatio: "none" }));
    // cutting planes of the other two sections
    Object.keys(v.cuts).forEach(function (o) {
      var a = P(v.cuts[o][0]), b = P(v.cuts[o][1]);
      var seg = clip(a, b, c[0] + 4, c[1] + 4, c[0] + CELL - 4, c[1] + CELL - 4); if (!seg) return;
      var p1 = seg[0], p2 = seg[1], ux = p2[0] - p1[0], uy = p2[1] - p1[1], L = Math.hypot(ux, uy); ux /= L; uy /= L;
      s += line(p1[0], p1[1], p2[0], p2[1], 0.25, { "stroke-dasharray": "8 1.5 1 1.5", stroke: FAINT });
      s += line(p1[0], p1[1], p1[0] + ux * 5, p1[1] + uy * 5, 0.7) + line(p2[0], p2[1], p2[0] - ux * 5, p2[1] - uy * 5, 0.7);
      // viewing direction of section o, as seen in this view
      var no = d.views[o].normal, dx = -(no[0] * v.u[0] + no[1] * v.u[1] + no[2] * v.u[2]), dy = (no[0] * v.v[0] + no[1] * v.v[1] + no[2] * v.v[2]);
      [p1, p2].forEach(function (p, i) {
        var q = [p[0] + (i ? -ux : ux) * 1.5, p[1] + (i ? -uy : uy) * 1.5];
        s += line(q[0], q[1], q[0] + dx * 5, q[1] + dy * 5, 0.35) + arrow(q[0] + dx * 6, q[1] + dy * 6, dx, dy);
        s += text(q[0] + dx * 9 + (i ? -ux : ux) * 1.5, q[1] + dy * 9 + (i ? -uy : uy) * 1.5 + 1.6, o, 4.6, { "font-weight": 600, "text-anchor": "middle" });
      });
    });
    // overall dimensions of the machine in this view
    var bx0 = c[0] + v.box[0] * k, by0 = c[1] + v.box[1] * k, bx1 = c[0] + v.box[2] * k, by1 = c[1] + v.box[3] * k;
    var yd = Math.min(by1 + 6, c[1] + CELL - 2), xd = Math.min(bx1 + 6, c[0] + CELL - 2);
    s += line(bx0, by1 + 1, bx0, yd + 1.5, 0.18) + line(bx1, by1 + 1, bx1, yd + 1.5, 0.18);
    s += line(bx0, yd, bx1, yd, 0.18) + arrow(bx0, yd, -1, 0) + arrow(bx1, yd, 1, 0);
    s += text((bx0 + bx1) / 2, yd - 1, mm(v.size[0] * 1000), 2.8, { "text-anchor": "middle", fill: INK });
    s += line(bx1 + 1, by0, xd + 1.5, by0, 0.18) + line(bx1 + 1, by1, xd + 1.5, by1, 0.18);
    s += line(xd, by0, xd, by1, 0.18) + arrow(xd, by0, 0, -1) + arrow(xd, by1, 0, 1);
    s += text(xd - 1, (by0 + by1) / 2, mm(v.size[1] * 1000), 2.8, { "text-anchor": "middle", transform: "rotate(-90 " + f(xd - 1) + " " + f((by0 + by1) / 2) + ")" });
    // runner diameter where the runner is seen end-on
    if (RUNNER_VIEW[m] === name) {
      var cc = P(v.center), r = d.runnerD / 2 / v.ortho * CELL, ex = Math.cos(Math.PI / 5), ey = -Math.sin(Math.PI / 5);
      var a1 = [cc[0] - ex * r, cc[1] - ey * r], a2 = [cc[0] + ex * r, cc[1] + ey * r], t = [cc[0] + ex * (r + 9), cc[1] + ey * (r + 9)];
      s += line(a1[0], a1[1], t[0], t[1], 0.18) + arrow(a1[0], a1[1], -ex, -ey) + arrow(a2[0], a2[1], ex, ey);
      s += line(t[0], t[1], t[0] + 16, t[1], 0.18) + text(t[0] + 1, t[1] - 1, "Ø" + mm(d.runnerD * 1000), 2.8);
    }
    // balloons (front section only)
    if (name === "A") s += balloons(d, v, c, k, items);
    // view label
    s += text(c[0] + CELL / 2, c[1] + CELL + 5.2, T("SECTION {a}–{a}", { a: name }), 4, { "text-anchor": "middle", "font-weight": 600 });
    s += text(c[0] + CELL / 2, c[1] + CELL + 8.8, T("scale 1:{s}", { s: d.scale }), 2.6, { "text-anchor": "middle", fill: FAINT });
    return s;
  }
  // Liang–Barsky: the part of segment a–b inside the rectangle
  function clip(a, b, x0, y0, x1, y1) {
    var t0 = 0, t1 = 1, dx = b[0] - a[0], dy = b[1] - a[1];
    var p = [-dx, dx, -dy, dy], q = [a[0] - x0, x1 - a[0], a[1] - y0, y1 - a[1]];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; continue; }
      var r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
  }
  function balloons(d, v, c, k, items) {
    var cx = c[0] + CELL / 2, cy = c[1] + CELL / 2, R = CELL / 2 - 4.5, s = "";
    var pts = items.filter(function (it) { return v.balloons[it.key]; }).map(function (it) {
      var p = v.balloons[it.key], x = c[0] + p[0] * k, y = c[1] + p[1] * k;
      return { n: it.n, x: x, y: y, a: Math.atan2(y - cy, x - cx) };
    }).sort(function (a, b) { return a.a - b.a; });
    // spread the balloons round the ring so they keep a minimum angle apart
    var min = Math.min(0.5, 2 * Math.PI / Math.max(1, pts.length) * 0.9);
    for (var it = 0; it < 60; it++) {
      var moved = false;
      for (var i = 0; i < pts.length; i++) {
        var j = (i + 1) % pts.length; if (pts.length < 2) break;
        var gap = pts[j].a - pts[i].a; if (j === 0) gap += 2 * Math.PI;
        if (gap < min) { var push = (min - gap) / 2 + 1e-3; pts[i].a -= push; pts[j].a += push; moved = true; }
      }
      if (!moved) break;
    }
    pts.forEach(function (p) {
      var bx = cx + Math.cos(p.a) * R, by = cy + Math.sin(p.a) * R, dx = p.x - bx, dy = p.y - by, L = Math.hypot(dx, dy) || 1;
      s += line(bx + dx / L * 3.2, by + dy / L * 3.2, p.x, p.y, 0.2) + el("circle", { cx: f(p.x), cy: f(p.y), r: 0.6, fill: INK });
      s += el("circle", { cx: f(bx), cy: f(by), r: 3.2, fill: "#fff", stroke: INK, "stroke-width": 0.3 });
      s += text(bx, by + 1.1, p.n, 3.1, { "text-anchor": "middle", "font-weight": 600 });
    });
    return s;
  }

  // ---- the sheet
  function sheet(m, d) {
    var items = d.parts.map(function (key, i) { return { n: i + 1, key: key, qty: d.counts[key] || 1 }; });
    var s = el("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" });
    s += el("rect", { x: 20, y: 10, width: W - 30, height: H - 20, fill: "none", stroke: INK, "stroke-width": 0.7 });
    // centring marks
    s += line(W / 2, 3, W / 2, 10, 0.5) + line(W / 2, H - 10, W / 2, H - 3, 0.5) + line(13, H / 2, 20, H / 2, 0.5) + line(W - 10, H / 2, W - 3, H / 2, 0.5);
    ["A", "B", "C"].forEach(function (n) { s += view(m, d, n, items); });
    var ci = CELLS.iso;
    s += el("a", { href: "drawings/" + m + "-iso.png?v=" + VERSION, target: "_blank" }, el("image", { href: "drawings/" + m + "-iso.png?v=" + VERSION, x: ci[0], y: ci[1], width: CELL, height: CELL }));
    s += text(ci[0] + CELL / 2, ci[1] + CELL + 5.2, T("ISOMETRIC VIEW"), 4, { "text-anchor": "middle", "font-weight": 600 });
    s += text(ci[0] + CELL / 2, ci[1] + CELL + 8.8, T("not to scale"), 2.6, { "text-anchor": "middle", fill: FAINT });

    // parts list
    var y = 13;
    s += text(COL, y + 3.5, T("PARTS LIST"), 3.6, { "font-weight": 600 }); y += 6;
    s += el("rect", { x: COL, y: y, width: COLW, height: 6 * (items.length + 1), fill: "none", stroke: INK, "stroke-width": 0.35 });
    s += text(COL + 2, y + 4.2, T("Item"), 2.6, { fill: FAINT }) + text(COL + 14, y + 4.2, T("Part"), 2.6, { fill: FAINT }) + text(COL + COLW - 2, y + 4.2, T("Qty"), 2.6, { fill: FAINT, "text-anchor": "end" });
    s += line(COL + 12, y, COL + 12, y + 6 * (items.length + 1), 0.2) + line(COL + COLW - 14, y, COL + COLW - 14, y + 6 * (items.length + 1), 0.2);
    items.forEach(function (it, i) {
      var yy = y + 6 * (i + 1);
      s += line(COL, yy, COL + COLW, yy, 0.2);
      s += text(COL + 6, yy + 4.2, it.n, 2.8, { "text-anchor": "middle" }) + text(COL + 14, yy + 4.2, partName(it.key), 2.8) + text(COL + COLW - 2, yy + 4.2, it.qty, 2.8, { "text-anchor": "end" });
    });
    y += 6 * (items.length + 1) + 9;

    // notes
    s += text(COL, y, T("NOTES"), 3.6, { "font-weight": 600 }); y += 5;
    [T("Sections pass through the centre of the runner."),
     T("Dimensions in millimetres: overall sizes of the model and the runner's outer diameter."),
     T("Hatching: solid material cut by the plane. Thin walls are shown by their thick cut outline."),
     T("Machine only: the site, the water and the air are not drawn."),
     T("Drawn from a teaching model; not for construction.")].forEach(function (n, i) {
      wrap((i + 1) + ". " + n, 52).forEach(function (l, j) { s += text(COL + (j ? 3.4 : 0), y, l, 2.6); y += 3.6; });
      y += 1;
    });

    // title block
    var tx = COL, ty = H - 10 - 58, tw = COLW, rows = [16, 10.5, 10.5, 10.5, 10.5];
    s += el("rect", { x: tx, y: ty, width: tw, height: 58, fill: "none", stroke: INK, "stroke-width": 0.7 });
    var yy = ty; rows.forEach(function (h, i) { yy += h; if (i < rows.length - 1) s += line(tx, yy, tx + tw, yy, 0.3); });
    s += text(tx + 3, ty + 7, TITLE[m]().toUpperCase(), 4.6, { "font-weight": 700, "font-family": "Rajdhani, 'Arial Narrow', sans-serif" });
    s += text(tx + 3, ty + 12.5, T("General arrangement — sections and isometric view"), 2.6, { fill: FAINT });
    var mid = tx + tw / 2;
    s += line(mid, ty + 16, mid, ty + 58 - 10.5, 0.3);
    var cell = function (x, y0, label, value, big) { return text(x + 2, y0 + 3.4, label, 2.1, { fill: FAINT }) + text(x + 2, y0 + 8.4, value, big || 3.2, { "font-weight": 600 }); };
    s += cell(tx, ty + 16, T("Drawing no."), CODE[m]) + cell(mid, ty + 16, T("Scale (A3)"), "1:" + d.scale + " · " + T("iso n.t.s."));
    s += cell(tx, ty + 26.5, T("Units"), "mm") + cell(mid, ty + 26.5, T("Sheet"), "A3 · 1/1");
    s += text(tx + 2, ty + 37 + 3.4, T("Projection"), 2.1, { fill: FAINT }) + projection(tx + 26, ty + 40.5) + text(tx + 44, ty + 37 + 8.4, "ISO E", 2.6, { fill: FAINT });
    s += cell(mid, ty + 37, T("Date"), DATE);
    s += text(tx + 2, ty + 47.5 + 6.4, T("Turbine Lab v{v} · drawn from the Blender model", { v: VERSION }), 2.4, { fill: FAINT });
    return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' + W + " " + H + '" width="' + W + 'mm" height="' + H + 'mm" role="img" aria-label="' + esc(TITLE[m]()) + '">' + s + "</svg>";
  }
  // first-angle projection symbol (ISO 5456-2): the cone's side view, and its view from the left drawn to the right
  function projection(x, y) {
    return el("path", { d: "M" + x + " " + (y + 1) + " L" + (x + 8) + " " + (y - 1.2) + " L" + (x + 8) + " " + (y + 5.2) + " L" + x + " " + (y + 3) + " Z", fill: "none", stroke: INK, "stroke-width": 0.3 }) +
      el("circle", { cx: x + 13, cy: y + 2, r: 3.2, fill: "none", stroke: INK, "stroke-width": 0.3 }) +
      el("circle", { cx: x + 13, cy: y + 2, r: 1, fill: "none", stroke: INK, "stroke-width": 0.3 });
  }

  function load(m) {
    if (cache[m]) return Promise.resolve(cache[m]);
    return fetch("drawings/" + m + ".json?v=" + VERSION).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) { return (cache[m] = d); });
  }
  function show(m) {
    current = m;
    document.querySelectorAll("#segDraw button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === m)); });
    try { history.replaceState(null, "", I18.withLang("drawings.html?m=" + m)); } catch (e) { /* file: */ }
    load(m).then(function (d) { $("sheet").innerHTML = sheet(m, d); })
      .catch(function () { $("sheet").innerHTML = "<p class='lede'>" + esc(T("The drawing could not be loaded.")) + "</p>"; });
  }
  $("segDraw").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) show(b.dataset.v); });
  $("btnPrint").addEventListener("click", function () { window.print(); });
  $("chkBlue").addEventListener("change", function (e) { $("sheet").classList.toggle("blue", e.target.checked); });
  // download: the sheet with its four views embedded, so the file stands on its own
  $("btnSvg").addEventListener("click", function () {
    var svg = $("sheet").querySelector("svg"); if (!svg) return;
    var clone = svg.cloneNode(true), imgs = Array.prototype.slice.call(clone.querySelectorAll("image"));
    Promise.all(imgs.map(function (im) {
      return fetch(im.getAttribute("href")).then(function (r) { return r.blob(); }).then(function (b) {
        return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { im.setAttribute("href", fr.result); res(); }; fr.readAsDataURL(b); });
      });
    })).then(function () {
      clone.querySelectorAll("a").forEach(function (a) { while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a); a.parentNode.removeChild(a); });
      var blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML], { type: "image/svg+xml" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "turbine-lab-" + current + "-" + CODE[current] + ".svg";
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
  });

  var q = null; try { q = new URLSearchParams(location.search).get("m"); } catch (e) { q = null; }
  show(MACHINES.indexOf(q) >= 0 ? q : "pelton");
})();
