/*
 * plan.js — draws a layout in plan view on a canvas: the building outline,
 * the storage locations coloured by travel cost or by SKU popularity, the
 * travel network, the picking points and (optionally) one order's route.
 * Works for any layout object from src/layouts/ — no layout-specific code.
 */
(function (root) {
  "use strict";

  // sequential blue→amber scale for "near → far" (cheap → expensive)
  function heat(t) {
    t = Math.max(0, Math.min(1, t));
    const a = [125, 211, 252], b = [237, 161, 0];
    return "rgb(" + a.map(function (v, i) { return Math.round(v + (b[i] - v) * t); }).join(",") + ")";
  }

  function draw(canvas, res, opts) {
    opts = opts || {};
    const L = res.layout, g = L.graph, dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const c = canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    L.outline.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    const pad = 24, s = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0));
    const ox = (W - s * (x1 - x0)) / 2, oy = (H - s * (y1 - y0)) / 2;
    const X = function (x) { return ox + (x - x0) * s; }, Y = function (y) { return H - (oy + (y - y0) * s); };
    const view = { X: X, Y: Y, s: s };

    // building
    c.strokeStyle = "#8fd0f2"; c.lineWidth = 2; c.beginPath();
    L.outline.forEach(function (p, i) { if (i) c.lineTo(X(p[0]), Y(p[1])); else c.moveTo(X(p[0]), Y(p[1])); });
    c.closePath(); c.stroke();

    // storage locations
    const loc = L.locations, mode = opts.color || "cost";
    const val = new Float64Array(loc.n).fill(NaN);
    if (mode === "cost") {
      const near = WC.slotting.locationCost(L, opts.sc).cost;
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < loc.n; i++) { mn = Math.min(mn, near[i]); mx = Math.max(mx, near[i]); }
      for (let i = 0; i < loc.n; i++) val[i] = (near[i] - mn) / Math.max(1e-9, mx - mn);
    } else {
      // ABC class of the SKU stored there (A = most popular 20%, B = next 30%,
      // C = the rest) as 0 / 0.5 / 1; empty locations stay NaN
      const n = res.skuLoc.length, b = WC.slotting.ABC_BOUNDS;
      for (let s2 = 0; s2 < n; s2++) { const u = (s2 + 0.5) / n; val[res.skuLoc[s2]] = u < b[0] ? 0 : u < b[1] ? 0.5 : 1; }
    }
    // a location's dot shows the mean over the levels stacked on it
    const cell = new Map();
    for (let i = 0; i < loc.n; i++) {
      const k = Math.round(loc.x[i] * 100) + "," + Math.round(loc.y[i] * 100);
      const e = cell.get(k) || { x: loc.x[i], y: loc.y[i], v: 0, m: 0 };
      if (!isNaN(val[i])) { e.v += val[i]; e.m++; }
      cell.set(k, e);
    }
    const r = Math.max(1.2, Math.min(5, s * 0.35));
    cell.forEach(function (e) {
      c.fillStyle = !e.m ? "#1d4470" : mode === "cost" ? heat(e.v / e.m) : heat(Math.round(2 * e.v / e.m) / 2);
      c.fillRect(X(e.x) - r, Y(e.y) - r, 2 * r, 2 * r);
    });

    // travel network
    if (opts.network) {
      c.strokeStyle = "rgba(123,224,196,.45)"; c.lineWidth = 1; c.beginPath();
      g.edges.forEach(function (e) { c.moveTo(X(g.x[e[0]]), Y(g.y[e[0]])); c.lineTo(X(g.x[e[1]]), Y(g.y[e[1]])); });
      c.stroke();
    }

    // route of one order
    if (opts.route) {
      const rt = opts.route, seq = [rt.depot].concat(rt.order, [rt.depot]);
      c.strokeStyle = "#ffffff"; c.lineWidth = 2.5; c.lineJoin = "round"; c.beginPath();
      for (let i = 1; i < seq.length; i++) {
        const p = g.path(g.keys[seq[i - 1]], g.keys[seq[i]]);
        p.forEach(function (n, j) { if (i === 1 && j === 0) c.moveTo(X(g.x[n]), Y(g.y[n])); else c.lineTo(X(g.x[n]), Y(g.y[n])); });
      }
      c.stroke();
      rt.order.forEach(function (k, i) {
        const n = g.keys[k];
        c.fillStyle = "#ffffff"; c.beginPath(); c.arc(X(g.x[n]), Y(g.y[n]), 7, 0, 2 * Math.PI); c.fill();
        c.fillStyle = "#04202b"; c.font = "600 9px 'IBM Plex Mono', monospace"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(String(i + 1), X(g.x[n]), Y(g.y[n]) + 0.5);
      });
    }

    // picking points
    L.depots.forEach(function (k) {
      const n = g.keys[k];
      c.fillStyle = "#7be0c4"; c.strokeStyle = "#04202b"; c.lineWidth = 1.5;
      c.beginPath(); c.rect(X(g.x[n]) - 6, Y(g.y[n]) - 6, 12, 12); c.fill(); c.stroke();
    });

    // scale bar: 10 m
    const bar = 10 * s;
    c.strokeStyle = "#8fd0f2"; c.lineWidth = 2; c.beginPath(); c.moveTo(pad, H - 10); c.lineTo(pad + bar, H - 10); c.stroke();
    c.fillStyle = "#8fd0f2"; c.font = "11px 'IBM Plex Mono', monospace"; c.textAlign = "left"; c.textBaseline = "bottom";
    c.fillText("10 m", pad + bar + 6, H - 4);
    return view;
  }

  root.WC = root.WC || {}; root.WC.plan = { draw: draw, heat: heat };
})(typeof self !== "undefined" ? self : this);
