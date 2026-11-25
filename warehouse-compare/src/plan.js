/*
 * plan.js — draws a layout in plan view on a canvas: the building outline,
 * every bay as a (possibly rotated) rectangle coloured by travel cost or by
 * the popularity class of what it stores, the travel network (straight and
 * arc paths), the picking points and optionally one order's route.
 * Works for any layout object from src/layouts/ — no layout-specific code.
 */
(function (root) {
  "use strict";

  // blue → amber for near → far, or A → C
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
    // opts.span = [width, height] in metres to fit — pass the largest of the
    // layouts being compared so they are all drawn at one scale
    const sx = opts.span ? Math.max(opts.span[0], x1 - x0) : x1 - x0, sy = opts.span ? Math.max(opts.span[1], y1 - y0) : y1 - y0;
    const pad = 24, s = Math.min((W - 2 * pad) / sx, (H - 2 * pad - 14) / sy);
    const ox = (W - s * (x1 - x0)) / 2, oy = (H - 14 - s * (y1 - y0)) / 2 + 14;
    const X = function (x) { return ox + (x - x0) * s; }, Y = function (y) { return H - (oy + (y - y0) * s); };
    // canvas y runs down, plan y runs up: angles flip sign
    function arcTo(sh, first) {
      const n = Math.max(2, Math.ceil(Math.abs(sh.t1 - sh.t0) * sh.r * s / 4));
      for (let k = first ? 0 : 1; k <= n; k++) {
        const a = sh.t0 + (sh.t1 - sh.t0) * k / n, px = X(sh.cx + sh.r * Math.cos(a)), py = Y(sh.cy + sh.r * Math.sin(a));
        if (first && k === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
    }

    // building
    c.strokeStyle = "#8fd0f2"; c.lineWidth = 2; c.beginPath();
    L.outline.forEach(function (p, i) { if (i) c.lineTo(X(p[0]), Y(p[1])); else c.moveTo(X(p[0]), Y(p[1])); });
    c.closePath(); c.stroke();

    // bays, coloured by the mean over their locations
    const loc = L.locations, mode = opts.color || "cost";
    const val = new Float64Array(res.bayColors ? 0 : loc.n).fill(NaN);
    if (res.bayColors) { /* colours come with the result */ }
    else if (mode === "cost") {
      const cost = WC.slotting.locationCost(L, opts.sc).cost;
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < loc.n; i++) { mn = Math.min(mn, cost[i]); mx = Math.max(mx, cost[i]); }
      for (let i = 0; i < loc.n; i++) val[i] = (cost[i] - mn) / Math.max(1e-9, mx - mn);
    } else {
      const n = res.skuLoc.length, b = WC.slotting.ABC_BOUNDS;
      for (let k = 0; k < n; k++) { const u = (k + 0.5) / n; val[res.skuLoc[k]] = u < b[0] ? 0 : u < b[1] ? 0.5 : 1; }
    }
    L.bays.forEach(function (b, bi) {
      let v = 0, m = 0;
      if (res.bayColors) { const x = res.bayColors[mode][bi]; if (!isNaN(x)) { v = x; m = 1; } }   // WH-A: one value per slot, from the simulation's end state
      else for (let i = b.loc0; i < b.loc0 + b.nLoc; i++) if (!isNaN(val[i])) { v += val[i]; m++; }
      c.fillStyle = !m ? "#1d4470" : mode === "cost" ? heat(v / m) : heat(Math.round(2 * v / m) / 2);
      const hx = b.ux * b.w / 2, hy = b.uy * b.w / 2, vx = -b.uy * b.d / 2, vy = b.ux * b.d / 2;
      c.beginPath();
      c.moveTo(X(b.cx - hx - vx), Y(b.cy - hy - vy)); c.lineTo(X(b.cx + hx - vx), Y(b.cy + hy - vy));
      c.lineTo(X(b.cx + hx + vx), Y(b.cy + hy + vy)); c.lineTo(X(b.cx - hx + vx), Y(b.cy - hy + vy));
      c.closePath(); c.fill();
    });

    // travel network
    if (opts.network) {
      c.strokeStyle = "rgba(123,224,196,.5)"; c.lineWidth = 1; c.beginPath();
      g.edges.forEach(function (e) {
        if (e[3]) arcTo(e[3], true);
        else { c.moveTo(X(g.x[e[0]]), Y(g.y[e[0]])); c.lineTo(X(g.x[e[1]]), Y(g.y[e[1]])); }
      });
      c.stroke();
    }

    // WH-A: each pod an order needs makes a robot trip to a station and back
    if (opts.route && opts.route.segments) {
      c.strokeStyle = "#ffffff"; c.lineWidth = 2.5; c.lineJoin = "round";
      opts.route.segments.forEach(function (sg) {
        const p = g.path(g.keys[sg[0]], g.keys[sg[1]]);
        c.beginPath(); c.moveTo(X(sg[2]), Y(sg[3])); p.forEach(function (n) { c.lineTo(X(g.x[n]), Y(g.y[n])); }); c.stroke();
      });
      opts.route.segments.forEach(function (sg, i) {
        c.fillStyle = "#ffffff"; c.beginPath(); c.arc(X(sg[2]), Y(sg[3]), 7, 0, 2 * Math.PI); c.fill();
        c.fillStyle = "#04202b"; c.font = "600 9px 'IBM Plex Mono', monospace"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(String(i + 1), X(sg[2]), Y(sg[3]) + 0.5);
      });
    }
    // one order's route
    else if (opts.route) {
      const rt = opts.route, seq = [rt.depot].concat(rt.order, [rt.depot]);
      c.strokeStyle = "#ffffff"; c.lineWidth = 2.5; c.lineJoin = "round"; c.beginPath();
      let started = false;
      for (let i = 1; i < seq.length; i++) {
        const p = g.path(g.keys[seq[i - 1]], g.keys[seq[i]]);
        if (!started) { c.moveTo(X(g.x[p[0]]), Y(g.y[p[0]])); started = true; }
        for (let j = 1; j < p.length; j++) {
          const sh = g.shapeOf(p[j - 1], p[j]);
          if (sh) arcTo(sh, false); else c.lineTo(X(g.x[p[j]]), Y(g.y[p[j]]));
        }
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

    // scale bar: 10 m, top left
    const bar = 10 * s;
    c.strokeStyle = "#8fd0f2"; c.lineWidth = 2; c.beginPath(); c.moveTo(pad, 14); c.lineTo(pad + bar, 14); c.stroke();
    c.fillStyle = "#8fd0f2"; c.font = "11px 'IBM Plex Mono', monospace"; c.textAlign = "left"; c.textBaseline = "middle";
    c.fillText("10 m", pad + bar + 6, 14);
    return { X: X, Y: Y, s: s };
  }

  root.WC = root.WC || {}; root.WC.plan = { draw: draw, heat: heat };
})(typeof self !== "undefined" ? self : this);
