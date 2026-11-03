// Epicycles core — turns a picture into one closed line and that line into two chains of turning circles.
//   picture → points:  Sobel edges (photos) or the outline of an Otsu threshold (logos, text), thinned on a grid
//   points → cycle:    nearest-neighbour tour (spatial grid), then 2-opt until no swap shortens it
//   cycle → series:    resampled to M points evenly spaced along its length, then for each axis
//                      x(t) = a0 + Σ_k r_k cos(k t + φ_k),  t in [0, 2π)
// Term k is one circle of radius r_k that starts at angle φ_k and turns k times per cycle. With z = e^{it} the same
// sum is x(t) = Re Σ_k A_k z^k, A_0 = a0, A_k = r_k e^{iφ_k}: a power (Taylor) series in z, whose k-th power spins
// k times as fast.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Epicycles = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TAU = Math.PI * 2;

  // ---- picture → points ------------------------------------------------------------------------------------

  // luminance 0..1 from RGBA bytes; transparent pixels count as white paper
  function grayscale(rgba, w, h) {
    var g = new Float32Array(w * h);
    for (var i = 0; i < w * h; i++) {
      var a = rgba[i * 4 + 3] / 255;
      var l = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
      g[i] = l * a + (1 - a);
    }
    return g;
  }

  function blur3(g, w, h) {
    var o = new Float32Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var s = 0, n = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += g[yy * w + xx]; n++; }
      }
      o[y * w + x] = s / n;
    }
    return o;
  }

  // the threshold that best splits the histogram into two classes (Otsu 1979)
  function otsu(g) {
    var hist = new Float64Array(256), n = g.length;
    for (var i = 0; i < n; i++) hist[Math.min(255, Math.floor(g[i] * 256))]++;
    var sum = 0;
    for (var k = 0; k < 256; k++) sum += k * hist[k];
    var wB = 0, sB = 0, best = -1, t = 128;
    for (k = 0; k < 256; k++) {
      wB += hist[k];
      if (!wB) continue;
      var wF = n - wB;
      if (!wF) break;
      sB += k * hist[k];
      var between = wB * wF * Math.pow(sB / wB - (sum - sB) / wF, 2);
      if (between > best) { best = between; t = k; }
    }
    return (t + 1) / 256;
  }

  // pixels on the boundary of the dark (or, inverted, light) region
  function outlinePixels(g, w, h, invert) {
    var t = otsu(g), fg = new Uint8Array(w * h), pts = [];
    for (var i = 0; i < w * h; i++) fg[i] = invert ? g[i] >= t : g[i] < t;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (!fg[y * w + x]) continue;
      var edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
        !fg[y * w + x - 1] || !fg[y * w + x + 1] || !fg[(y - 1) * w + x] || !fg[(y + 1) * w + x];
      if (edge) pts.push([x, y]);
    }
    return pts;
  }

  // the strongest `keep` share of Sobel gradient magnitudes
  function edgePixels(g, w, h, keep) {
    var b = blur3(g, w, h), mag = new Float32Array(w * h), vals = [];
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var i = y * w + x;
      var gx = b[i - w + 1] + 2 * b[i + 1] + b[i + w + 1] - b[i - w - 1] - 2 * b[i - 1] - b[i + w - 1];
      var gy = b[i + w - 1] + 2 * b[i + w] + b[i + w + 1] - b[i - w - 1] - 2 * b[i - w] - b[i - w + 1];
      mag[i] = Math.hypot(gx, gy);
      if (mag[i] > 0.02) vals.push(mag[i]);
    }
    if (!vals.length) return [];
    vals.sort(function (a, c) { return c - a; });
    var t = vals[Math.min(vals.length - 1, Math.floor(w * h * (keep || 0.08)))], pts = [];
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) if (mag[y * w + x] >= t && mag[y * w + x] > 0.02) pts.push([x, y]);
    return pts;
  }

  // at most one point per grid cell, with the cell size chosen so that no more than maxN remain
  function thin(points, maxN) {
    if (points.length <= maxN) return points.slice();
    function keepAt(s) {
      var seen = new Set(), out = [];
      for (var i = 0; i < points.length; i++) {
        var key = Math.floor(points[i][0] / s) + "," + Math.floor(points[i][1] / s);
        if (!seen.has(key)) { seen.add(key); out.push(points[i]); }
      }
      return out;
    }
    var lo = 1, hi = 2, out = keepAt(hi);
    while (out.length > maxN) { lo = hi; hi *= 2; out = keepAt(hi); }
    for (var it = 0; it < 20; it++) {
      var mid = (lo + hi) / 2, m = keepAt(mid);
      if (m.length > maxN) lo = mid; else { hi = mid; out = m; }
    }
    return out;
  }

  // ---- points → one closed cycle ---------------------------------------------------------------------------

  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  function tourLength(pts) {
    var L = 0;
    for (var i = 0; i < pts.length; i++) L += dist(pts[i], pts[(i + 1) % pts.length]);
    return L;
  }

  // greedy nearest neighbour from the top-left point, searching a grid ring by ring
  function nearestNeighbourTour(points) {
    var n = points.length;
    if (n < 3) return points.slice();
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    points.forEach(function (p) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); });
    var cell = Math.max(1e-9, Math.sqrt(((maxX - minX) || 1) * ((maxY - minY) || 1) / n) * 1.5);
    var cols = Math.floor((maxX - minX) / cell) + 1, rows = Math.floor((maxY - minY) / cell) + 1;
    var grid = new Array(cols * rows), where = new Int32Array(n), cellOf = new Int32Array(n);
    for (var c = 0; c < grid.length; c++) grid[c] = [];
    for (var i = 0; i < n; i++) {
      var cx = Math.floor((points[i][0] - minX) / cell), cy = Math.floor((points[i][1] - minY) / cell);
      cellOf[i] = cy * cols + cx; where[i] = grid[cellOf[i]].length; grid[cellOf[i]].push(i);
    }
    function remove(i) {
      var list = grid[cellOf[i]], last = list.pop();
      if (last !== i) { list[where[i]] = last; where[last] = where[i]; }
    }
    var start = 0;
    for (i = 1; i < n; i++) if (points[i][0] + points[i][1] < points[start][0] + points[start][1]) start = i;
    var order = [start];
    remove(start);
    var cur = start;
    for (var step = 1; step < n; step++) {
      var p = points[cur], pcx = Math.floor((p[0] - minX) / cell), pcy = Math.floor((p[1] - minY) / cell);
      var best = -1, bd = Infinity, maxR = Math.max(cols, rows);
      for (var r = 0; r <= maxR; r++) {
        if (best >= 0 && (r - 1) * cell > bd) break;
        for (var yy = pcy - r; yy <= pcy + r; yy++) {
          if (yy < 0 || yy >= rows) continue;
          var ring = yy === pcy - r || yy === pcy + r;
          for (var xx = pcx - r; xx <= pcx + r; xx += ring ? 1 : 2 * r || 1) {
            if (xx < 0 || xx >= cols) continue;
            var list = grid[yy * cols + xx];
            for (var k = 0; k < list.length; k++) {
              var d = dist(p, points[list[k]]);
              if (d < bd) { bd = d; best = list[k]; }
            }
          }
        }
      }
      order.push(best); remove(best); cur = best;
    }
    return order.map(function (j) { return points[j]; });
  }

  // 2-opt: reverse any stretch whose reversal shortens the cycle, until none does or the budget runs out
  function twoOpt(tour, opts) {
    opts = opts || {};
    var pts = tour.slice(), n = pts.length, maxPasses = opts.maxPasses || 50;
    var now = typeof performance !== "undefined" ? function () { return performance.now(); } : Date.now;
    var deadline = opts.timeBudgetMs ? now() + opts.timeBudgetMs : Infinity;
    if (n < 5) return pts;
    for (var pass = 0; pass < maxPasses; pass++) {
      var improved = false;
      for (var i = 0; i < n - 2; i++) {
        var a = pts[i], b = pts[i + 1], dab = dist(a, b);
        for (var j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;
          var c = pts[j], d = pts[(j + 1) % n];
          if (dist(a, c) + dist(b, d) < dab + dist(c, d) - 1e-9) {
            for (var lo = i + 1, hi = j; lo < hi; lo++, hi--) { var t = pts[lo]; pts[lo] = pts[hi]; pts[hi] = t; }
            b = pts[i + 1]; dab = dist(a, b); improved = true;
          }
        }
        if ((i & 63) === 0 && now() > deadline) return pts;
      }
      if (!improved) break;
    }
    return pts;
  }

  // ---- cycle → evenly spaced samples ---------------------------------------------------------------------

  function resample(path, M) {
    var n = path.length, cum = [0];
    for (var i = 0; i < n; i++) cum.push(cum[i] + dist(path[i], path[(i + 1) % n]));
    var L = cum[n], out = [], seg = 0;
    if (!(L > 0)) { for (i = 0; i < M; i++) out.push(path[0].slice()); return out; }
    for (var j = 0; j < M; j++) {
      var s = (j / M) * L;
      while (cum[seg + 1] < s) seg++;
      var a = path[seg], b = path[(seg + 1) % n], f = (s - cum[seg]) / ((cum[seg + 1] - cum[seg]) || 1);
      out.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])]);
    }
    return out;
  }

  // centre on the bounding box and scale so the longer half-side is 1
  function normalise(path) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    path.forEach(function (p) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); });
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, s = Math.max(maxX - minX, maxY - minY) / 2 || 1;
    return { path: path.map(function (p) { return [(p[0] - cx) / s, (p[1] - cy) / s]; }), cx: cx, cy: cy, scale: s };
  }

  // ---- the two series ------------------------------------------------------------------------------------

  // one real axis: a0 and, for k = 1..K, radius r_k and phase φ_k with v(t) = a0 + Σ r_k cos(k t + φ_k)
  function axisSeries(v, K) {
    var M = v.length, a0 = 0, r = [0], phi = [0];
    for (var j = 0; j < M; j++) a0 += v[j];
    a0 /= M;
    for (var k = 1; k <= K; k++) {
      var a = 0, b = 0;
      for (j = 0; j < M; j++) { var th = TAU * k * j / M; a += v[j] * Math.cos(th); b += v[j] * Math.sin(th); }
      a *= 2 / M; b *= 2 / M;
      r.push(Math.hypot(a, b)); phi.push(-Math.atan2(b, a));
    }
    return { a0: a0, r: r, phi: phi, K: K };
  }

  function series(samples, K) {
    var M = samples.length;
    K = Math.min(K || Math.floor(M / 2) - 1, Math.floor(M / 2) - 1);
    return {
      M: M, K: K,
      x: axisSeries(samples.map(function (p) { return p[0]; }), K),
      y: axisSeries(samples.map(function (p) { return p[1]; }), K)
    };
  }

  // which harmonics come first: "frequency" = k = 1, 2, 3 … (the series order), "size" = largest radius first
  function circleOrder(ax, mode) {
    var ks = [];
    for (var k = 1; k <= ax.K; k++) ks.push(k);
    if (mode === "size") ks.sort(function (a, b) { return ax.r[b] - ax.r[a] || a - b; });
    return ks;
  }

  // the centres of a chain of N circles at time t; the last entry is the tip. dir "x" draws (cos, sin), so the
  // tip's horizontal position is the series; dir "y" draws (sin, cos), so its vertical position is.
  function chain(ax, order, N, t, base, dir) {
    var pts = [base.slice()], x = base[0], y = base[1];
    for (var i = 0; i < N && i < order.length; i++) {
      var k = order[i], th = k * t + ax.phi[k], r = ax.r[k];
      if (dir === "y") { x += r * Math.sin(th); y += r * Math.cos(th); } else { x += r * Math.cos(th); y += r * Math.sin(th); }
      pts.push([x, y]);
    }
    return pts;
  }

  function evalAxis(ax, order, N, t) {
    var v = ax.a0;
    for (var i = 0; i < N && i < order.length; i++) { var k = order[i]; v += ax.r[k] * Math.cos(k * t + ax.phi[k]); }
    return v;
  }

  function radiusSum(ax, order, N) {
    var s = 0;
    for (var i = 0; i < N && i < order.length; i++) s += ax.r[order[i]];
    return s;
  }

  // RMS distance between the N-circle curve and the full series, as a share of the curve's RMS spread (Parseval:
  // a circle of radius r contributes r²/2 to the mean square of its axis)
  function relativeError(sr, orderX, orderY, N) {
    var total = 0, kept = 0, k;
    for (k = 1; k <= sr.K; k++) total += (sr.x.r[k] * sr.x.r[k] + sr.y.r[k] * sr.y.r[k]) / 2;
    for (var i = 0; i < N && i < sr.K; i++) kept += (sr.x.r[orderX[i]] * sr.x.r[orderX[i]] + sr.y.r[orderY[i]] * sr.y.r[orderY[i]]) / 2;
    return total > 0 ? Math.sqrt(Math.max(0, total - kept) / total) : 0;
  }

  // the circles per side for each stage: 1, 2, 3 … 10, then bigger steps up to K
  function stages(K) {
    var out = [];
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 400, 500].forEach(function (n) { if (n <= K) out.push(n); });
    if (out[out.length - 1] !== K && K < 500) out.push(K);
    return out;
  }

  // the whole pipeline from picture pixels to a normalised closed path
  function traceImage(rgba, w, h, opts) {
    opts = opts || {};
    var g = grayscale(rgba, w, h);
    var raw = opts.mode === "outline" ? outlinePixels(g, w, h, opts.invert) : edgePixels(g, w, h, opts.keep);
    if (raw.length < 3) return null;
    var pts = thin(raw, opts.maxPoints || 1500);
    var tour = twoOpt(nearestNeighbourTour(pts), { timeBudgetMs: opts.timeBudgetMs || 600 });
    return { tour: tour, pixels: raw.length, points: pts.length };
  }

  return {
    grayscale: grayscale, otsu: otsu, outlinePixels: outlinePixels, edgePixels: edgePixels, thin: thin,
    nearestNeighbourTour: nearestNeighbourTour, twoOpt: twoOpt, tourLength: tourLength,
    resample: resample, normalise: normalise, axisSeries: axisSeries, series: series,
    circleOrder: circleOrder, chain: chain, evalAxis: evalAxis, radiusSum: radiusSum,
    relativeError: relativeError, stages: stages, traceImage: traceImage
  };
});
