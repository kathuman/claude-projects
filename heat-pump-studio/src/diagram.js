// Heat Pump Studio — the installation diagram (window.HPSdiagram). A schematic SVG of the whole system, built from the
// design: source side, refrigerant circuit, heating circuit, backup heater and hot-water tank, with live values.
//   svg(d) where d = { source, sink, install, dhw, labels: {…}, values: {…}, colors: {…}, T: translate function }
(function (root) {
  "use strict";
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function svg(d) {
    var C = d.colors, V = d.values, T = d.T, out = [];
    var add = function (s) { out.push(s); };
    var line = function (pts, color, w, dash) {
      add('<polyline points="' + pts.map(function (p) { return p[0] + "," + p[1]; }).join(" ") + '" fill="none" stroke="' + color + '" stroke-width="' + (w || 4) + '" stroke-linejoin="round" stroke-linecap="round"' + (dash ? ' stroke-dasharray="' + dash + '"' : "") + "/>");
    };
    var text = function (x, y, s, o) {
      o = o || {};
      add('<text x="' + x + '" y="' + y + '" font-size="' + (o.size || 12) + '" text-anchor="' + (o.anchor || "start") + '" fill="' + (o.color || C.ink) + '" font-weight="' + (o.weight || 400) + '" font-family="' + (o.mono ? "'IBM Plex Mono', monospace" : "Barlow, sans-serif") + '">' + esc(s) + "</text>");
    };
    // a label with a dark backing so it reads over lines
    var tag = function (x, y, lines, o) {
      o = o || {};
      var w = Math.max.apply(null, lines.map(function (l) { return l.length; })) * 6.6 + 12, h = lines.length * 14 + 6;
      var x0 = o.anchor === "end" ? x - w : o.anchor === "middle" ? x - w / 2 : x;
      add('<rect x="' + x0 + '" y="' + (y - 12) + '" width="' + w + '" height="' + h + '" rx="4" fill="' + C.bg + '" fill-opacity="0.92" stroke="' + (o.border || C.line) + '"/>');
      lines.forEach(function (l, i) { text(x0 + 6, y + i * 14, l, { mono: true, size: 11.5, color: i === 0 && o.head ? o.head : C.ink, weight: i === 0 && o.head ? 600 : 400 }); });
    };
    var arrow = function (x, y, dx, dy, color) {
      var L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      add('<path d="M' + x + " " + y + " L" + (x - dx * 10 - dy * 5) + " " + (y - dy * 10 + dx * 5) + " L" + (x - dx * 10 + dy * 5) + " " + (y - dy * 10 - dx * 5) + ' Z" fill="' + color + '"/>');
    };
    var node = function (x, y, n, color) {
      add('<circle cx="' + x + '" cy="' + y + '" r="11" fill="' + C.bg + '" stroke="' + color + '" stroke-width="2.5"/>');
      text(x, y + 4.5, n, { anchor: "middle", weight: 700, size: 13 });
    };
    var plateHX = function (x, y, w, h, label) {
      add('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="' + C.panel + '" stroke="' + C.ink + '" stroke-width="2"/>');
      var zz = []; for (var k = 0; k <= 10; k++) zz.push([x + (k % 2 ? w - 8 : 8), y + 10 + k * (h - 20) / 10]);
      line(zz, C.dim, 1.5);
      text(x + w / 2, y - 8, label, { anchor: "middle", weight: 700, size: 12.5 });
    };
    var pump = function (x, y, color, label) {
      add('<circle cx="' + x + '" cy="' + y + '" r="14" fill="' + C.bg + '" stroke="' + C.ink + '" stroke-width="2"/>');
      add('<path d="M' + (x - 6) + " " + (y - 8) + " L" + (x + 9) + " " + y + " L" + (x - 6) + " " + (y + 8) + ' Z" fill="' + (color || C.ink) + '"/>');
      if (label) text(x, y + 30, label, { anchor: "middle", size: 11, color: C.dim });
    };

    // ---- the refrigerant circuit
    var ex = 300, cx = 640, top = 150, bot = 370, kx = 470, ky = 92, vy = 420;
    if (d.install !== "none") {
      add('<rect x="' + (d.source === "air" ? 60 : 250) + '" y="30" width="' + (d.source === "air" ? 660 : 470) + '" height="430" rx="12" fill="none" stroke="' + C.dim + '" stroke-width="1.5" stroke-dasharray="7 5"/>');
      text(d.source === "air" ? 72 : 262, 50, d.labels.boundary, { color: C.dim, weight: 600, size: 12.5 });
    }
    // lines: suction (1), discharge (2), liquid (3), two-phase (4)
    line([[ex + 20, top], [ex + 20, ky], [kx - 40, ky]], C.cold, 5);
    line([[kx + 40, ky], [cx + 20, ky], [cx + 20, top]], C.hot, 5);
    line([[cx + 20, bot], [cx + 20, vy], [kx + 22, vy]], C.liquid, 5);
    line([[kx - 22, vy], [ex + 20, vy], [ex + 20, bot]], C.mixed, 5);
    arrow(kx - 42, ky, 1, 0, C.cold); arrow(cx + 20, top - 2, 0, 1, C.hot); arrow(kx + 24, vy, -1, 0, C.liquid); arrow(ex + 20, bot + 2, 0, -1, C.mixed);
    // compressor
    add('<circle cx="' + kx + '" cy="' + ky + '" r="40" fill="' + C.panel + '" stroke="' + C.ink + '" stroke-width="2.5"/>');
    add('<path d="M' + (kx - 26) + " " + (ky - 22) + " L" + (kx + 26) + " " + (ky - 10) + " L" + (kx + 26) + " " + (ky + 10) + " L" + (kx - 26) + " " + (ky + 22) + ' Z" fill="none" stroke="' + C.ink + '" stroke-width="2"/>');
    text(kx, ky - 50, d.labels.compressor, { anchor: "middle", weight: 700, size: 12.5 });
    tag(kx, ky + 62, [V.comp1, V.comp2], { anchor: "middle" });
    // expansion valve (bow tie)
    add('<path d="M' + (kx - 22) + " " + (vy - 14) + " L" + (kx + 22) + " " + (vy + 14) + " L" + (kx + 22) + " " + (vy - 14) + " L" + (kx - 22) + " " + (vy + 14) + ' Z" fill="' + C.panel + '" stroke="' + C.ink + '" stroke-width="2"/>');
    text(kx, vy - 24, d.labels.valve, { anchor: "middle", weight: 700, size: 12.5 });
    // heat exchangers
    if (d.source === "air") {
      // the evaporator is the finned coil itself, with the fan blowing outdoor air through it
      add('<rect x="' + ex + '" y="' + top + '" width="40" height="' + (bot - top) + '" rx="3" fill="' + C.panel + '" stroke="' + C.ink + '" stroke-width="2"/>');
      for (var f = 0; f < 18; f++) { var yy = top + 8 + f * (bot - top - 16) / 17; line([[ex + 4, yy], [ex + 36, yy]], C.dim, 1); }
      text(ex + 20, top - 8, d.labels.evap, { anchor: "middle", weight: 700, size: 12.5 });
      var fx0 = 150, fy = (top + bot) / 2;
      add('<circle cx="' + fx0 + '" cy="' + fy + '" r="46" fill="' + C.bg + '" stroke="' + C.ink + '" stroke-width="2"/>');
      for (var bl = 0; bl < 3; bl++) { var a = bl * 2.094; add('<path d="M' + fx0 + " " + fy + " Q" + (fx0 + 40 * Math.cos(a + 0.5)) + " " + (fy + 40 * Math.sin(a + 0.5)) + " " + (fx0 + 38 * Math.cos(a)) + " " + (fy + 38 * Math.sin(a)) + ' Z" fill="' + C.dim + '"/>'); }
      text(fx0, fy + 66, d.labels.fan, { anchor: "middle", weight: 700, size: 12.5 });
      for (var r = 0; r < 3; r++) { var ay = top + 40 + r * 70; line([[80, ay], [ex - 8, ay]], C.source, 2.5, "8 6"); arrow(ex - 6, ay, 1, 0, C.source); }
      tag(70, 470, [V.srcHead, V.src1, V.src2], { head: C.source });
    } else {
      plateHX(ex, top, 40, bot - top, d.labels.evap);
      // secondary side: source in at the top (counterflow to the refrigerant), out at the bottom
      var sx = 150;
      line([[ex, top + 25], [sx, top + 25]], C.source, 4);
      line([[ex, bot - 25], [sx, bot - 25]], C.sourceOut, 4);
      arrow(ex - 2, top + 25, 1, 0, C.source); arrow(sx + 30, bot - 25, -1, 0, C.sourceOut);
      pump(225, bot - 25, C.sourceOut, d.labels.srcPump);
      if (d.source === "ground" || d.source === "water") {
        // boreholes or wells
        var gy = 420;
        line([[20, gy], [270, gy]], C.dim, 2);
        add('<rect x="20" y="' + gy + '" width="250" height="80" fill="' + C.ground + '" fill-opacity="0.35"/>');
        line([[sx, top + 25], [90, top + 25], [90, 500]], C.source, 4);
        line([[sx, bot - 25], [130, bot - 25], [130, 500]], C.sourceOut, 4);
        if (d.source === "ground") { line([[90, 500], [90, 510], [130, 510], [130, 500]], C.source, 4); }
        text(200, gy - 8, d.labels.groundLine, { anchor: "middle", color: C.dim, size: 11 });
      } else {
        line([[sx, top + 25], [40, top + 25]], C.source, 4);
        line([[sx, bot - 25], [40, bot - 25]], C.sourceOut, 4);
        arrow(sx - 30, top + 25, 1, 0, C.source); arrow(40, bot - 25, -1, 0, C.sourceOut);
      }
      tag(20, d.source === "waste" ? 470 : 452, [V.srcHead, V.src1, V.src2], { head: C.source });
    }
    plateHX(cx, top, 40, bot - top, d.labels.cond);
    // ---- the heating circuit: flow from the condenser top (counterflow), return into the bottom
    var hx = 990, fy2 = top + 25, ry = bot - 25;
    line([[cx + 40, fy2], [hx - 120, fy2]], C.hot, 4);
    line([[hx - 120, ry], [cx + 40, ry]], C.cold, 4);
    arrow(hx - 122, fy2, 1, 0, C.hot); arrow(cx + 42, ry, -1, 0, C.cold);
    pump(720, ry, C.cold, d.labels.circPump);
    // backup heater (an electric element in the flow pipe)
    add('<rect x="745" y="' + (fy2 - 16) + '" width="56" height="32" rx="4" fill="' + C.panel + '" stroke="' + C.ink + '" stroke-width="2"/>');
    line([[750, fy2], [756, fy2 - 9], [764, fy2 + 9], [772, fy2 - 9], [780, fy2 + 9], [788, fy2 - 9], [796, fy2]], C.hot, 2);
    text(773, fy2 + 34, d.labels.backup, { anchor: "middle", weight: 700, size: 12 });
    // emitters
    var mx = hx - 120;
    if (d.sink === "floor") {
      var ser = []; for (var s = 0; s <= 8; s++) { ser.push([mx + (s % 2 ? 100 : 0), fy2 + 10 + s * (ry - fy2 - 20) / 8]); }
      line([[mx, fy2]].concat(ser).concat([[mx, ry]]), C.hot, 3);
      add('<rect x="' + (mx - 8) + '" y="' + (ry + 6) + '" width="116" height="8" fill="' + C.dim + '" fill-opacity="0.5"/>');
    } else {
      add('<rect x="' + mx + '" y="' + (fy2 - 6) + '" width="100" height="' + (ry - fy2 + 12) + '" rx="6" fill="' + C.panel + '" stroke="' + C.ink + '" stroke-width="2"/>');
      for (var c2 = 1; c2 < 9; c2++) line([[mx + c2 * 11, fy2 + 4], [mx + c2 * 11, ry - 4]], C.dim, 2);
    }
    text(mx + 50, fy2 - 22, d.labels.emitter, { anchor: "middle", weight: 700, size: 12.5 });
    tag(990, 64, [V.sinkHead, V.sink1, V.sink2], { anchor: "end", head: C.hot });
    // hot-water tank on a diverting valve
    if (d.dhw) {
      var vx = 830, tx = 830, ty = 402;
      add('<path d="M' + (vx - 9) + " " + (fy2 - 9) + " L" + (vx + 9) + " " + (fy2 + 9) + " M" + (vx + 9) + " " + (fy2 - 9) + " L" + (vx - 9) + " " + (fy2 + 9) + '" stroke="' + C.ink + '" stroke-width="2.5"/>');
      line([[vx, fy2 + 10], [vx, ty - 20]], C.hot, 3, "6 4");
      add('<rect x="' + (tx - 35) + '" y="' + (ty - 20) + '" width="70" height="80" rx="16" fill="' + C.panel + '" stroke="' + C.ink + '" stroke-width="2"/>');
      text(tx, ty + 76, d.labels.tank, { anchor: "middle", weight: 700, size: 12 });
      text(tx, ty + 92, V.dhw1, { anchor: "middle", mono: true, size: 11 }); text(tx, ty + 106, V.dhw2, { anchor: "middle", mono: true, size: 11, color: C.dim });
    }
    // ---- state values
    node(ex + 20, ky, "1", C.cold); node(cx + 20, ky, "2", C.hot); node(cx + 20, vy, "3", C.liquid); node(ex + 20, vy, "4", C.mixed);
    tag(ex + 4, ky + 4, [V.s1], { anchor: "end" }); tag(cx + 6, ky - 22, [V.s2], { anchor: "end" });
    tag(cx + 4, vy + 30, [V.s3], { anchor: "end" }); tag(ex + 36, vy + 30, [V.s4]);
    tag(ex + 50, (top + bot) / 2 - 10, [V.evapQ]);
    tag(cx - 10, (top + bot) / 2 - 10, [V.condQ], { anchor: "end" });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 530" role="img" aria-label="' + esc(d.labels.title) + '" style="width:100%;height:auto;display:block">' +
      '<rect width="1000" height="530" fill="' + C.bg + '"/>' + out.join("") + "</svg>";
  }
  root.HPSdiagram = { svg: svg };
  if (typeof module !== "undefined" && module.exports) module.exports = root.HPSdiagram;
})(typeof self !== "undefined" ? self : this);
