// Epicycles picture preparation — makes a picture simple before it is traced, so texture and background do not turn
// into scribble:
//   smoothing       a bilateral filter: averages each pixel with neighbours of a similar colour only, so skin, fabric
//                   and foliage flatten while edges between different colours stay sharp
//   background      flood fill from the picture's border: colours connected to the edge, within a tolerance of the
//                   border colour they started from and changing gently from pixel to pixel, become pure white;
//                   clicked points are extra starting points; optionally only the largest subject is kept
//   posterize       a few tone levels
//   tone curve      darkness → density with a hard cutoff (lighter than it → nothing) and a gamma above 1, so light
//                   areas become pure white instead of a sparse sprinkle (the Shading trace in fourier.js then puts
//                   no points there)
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EpPrepare = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // RGBA bytes → three Float32Arrays 0..1 (transparent pixels count as white paper)
  function toRGB(rgba, w, h) {
    var n = w * h, r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var a = rgba[i * 4 + 3] / 255;
      r[i] = rgba[i * 4] / 255 * a + (1 - a); g[i] = rgba[i * 4 + 1] / 255 * a + (1 - a); b[i] = rgba[i * 4 + 2] / 255 * a + (1 - a);
    }
    return { r: r, g: g, b: b };
  }

  function luminance(c) {
    var n = c.r.length, y = new Float32Array(n);
    for (var i = 0; i < n; i++) y[i] = 0.2126 * c.r[i] + 0.7152 * c.g[i] + 0.0722 * c.b[i];
    return y;
  }

  // the slider's strength 0..10 as filter settings (0 = off)
  function smoothingParams(s) {
    return s <= 0 ? null : { radius: 2 + Math.floor(s / 3), sigmaR: 0.04 + 0.016 * s, passes: s > 6 ? 2 : 1 };
  }

  function box3(a, w, h) {
    var o = new Float32Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var s = 0, n = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += a[yy * w + xx]; n++; }
      }
      o[y * w + x] = s / n;
    }
    return o;
  }

  // one bilateral pass on RGB: spatial Gaussian (σ = radius / 2) times a Gaussian on colour distance (σ = sigmaR)
  function bilateral(c, w, h, radius, sigmaR, passes) {
    var R = radius, ss = 2 * Math.pow(Math.max(1, R / 2), 2), sr = 2 * sigmaR * sigmaR;
    var sw = [];
    for (var dy = -R; dy <= R; dy++) for (var dx = -R; dx <= R; dx++) sw.push(dx * dx + dy * dy <= R * R ? Math.exp(-(dx * dx + dy * dy) / ss) : 0);
    var LUT = 512, lut = new Float32Array(LUT), maxD2 = 3;
    for (var q = 0; q < LUT; q++) lut[q] = Math.exp(-(q / (LUT - 1)) * maxD2 / sr);
    var cur = { r: c.r, g: c.g, b: c.b };
    for (var pass = 0; pass < (passes || 1); pass++) {
      // colours are compared on a lightly blurred guide, so a grainy pixel is not matched only to neighbours that
      // share its grain (a joint bilateral filter); real edges still differ in the guide
      var gd = { r: box3(cur.r, w, h), g: box3(cur.g, w, h), b: box3(cur.b, w, h) };
      var out = { r: new Float32Array(w * h), g: new Float32Array(w * h), b: new Float32Array(w * h) };
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var i = y * w + x, r0 = gd.r[i], g0 = gd.g[i], b0 = gd.b[i], sR = 0, sG = 0, sB = 0, sW = 0, k = 0;
        for (dy = -R; dy <= R; dy++) {
          var yy = y + dy;
          if (yy < 0 || yy >= h) { k += 2 * R + 1; continue; }
          for (dx = -R; dx <= R; dx++, k++) {
            var xx = x + dx, s = sw[k];
            if (!s || xx < 0 || xx >= w) continue;
            var j = yy * w + xx, er = gd.r[j] - r0, eg = gd.g[j] - g0, eb = gd.b[j] - b0;
            var wgt = s * lut[Math.min(LUT - 1, Math.round((er * er + eg * eg + eb * eb) / maxD2 * (LUT - 1)))];
            sR += wgt * cur.r[j]; sG += wgt * cur.g[j]; sB += wgt * cur.b[j]; sW += wgt;
          }
        }
        out.r[i] = sR / sW; out.g[i] = sG / sW; out.b[i] = sB / sW;
      }
      cur = out;
    }
    return cur;
  }

  // background by flood fill: 1 = background. A pixel joins from a background neighbour when its colour is within
  // `step` of that neighbour and within `tol` of the border (or clicked) colour the fill started from.
  var DRIFT = 0.04;
  function backgroundMask(c, w, h, tol, seeds, fromBorder) {
    var n = w * h, mask = new Uint8Array(n), sR = new Float32Array(n), sG = new Float32Array(n), sB = new Float32Array(n);
    var queue = new Int32Array(n), head = 0, tail = 0, tol2 = tol * tol, step = Math.max(tol * 0.35, 3 / 255), step2 = step * step;
    function seed(i) { if (mask[i]) return; mask[i] = 1; sR[i] = c.r[i]; sG[i] = c.g[i]; sB[i] = c.b[i]; queue[tail++] = i; }
    if (fromBorder !== false) {
      for (var x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
      for (var y = 1; y < h - 1; y++) { seed(y * w); seed(y * w + w - 1); }
    }
    (seeds || []).forEach(function (p) {
      var sx = Math.round(p[0]), sy = Math.round(p[1]);
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) seed(sy * w + sx);
    });
    while (head < tail) {
      var i = queue[head++], px = i % w, py = (i - px) / w;
      for (var d = 0; d < 4; d++) {
        var nx = px + (d === 0) - (d === 1), ny = py + (d === 2) - (d === 3);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var j = ny * w + nx;
        if (mask[j]) continue;
        var ar = c.r[j] - c.r[i], ag = c.g[j] - c.g[i], ab = c.b[j] - c.b[i];
        if (ar * ar + ag * ag + ab * ab > step2) continue;
        var br = c.r[j] - sR[i], bg = c.g[j] - sG[i], bb = c.b[j] - sB[i];
        if (br * br + bg * bg + bb * bb > tol2) continue;
        // the reference colour drifts slowly toward the pixels the fill passes, so it follows a vignette or a
        // shaded wall; the step limit above still stops it at the sharp edge of the subject
        mask[j] = 1; sR[j] = sR[i] + DRIFT * (c.r[j] - sR[i]); sG[j] = sG[i] + DRIFT * (c.g[j] - sG[i]); sB[j] = sB[i] + DRIFT * (c.b[j] - sB[i]);
        queue[tail++] = j;
      }
    }
    return mask;
  }

  // keep only the largest connected subject: every smaller foreground island joins the background
  function keepLargest(mask, w, h) {
    var n = w * h, label = new Int32Array(n), best = 0, bestSize = 0, sizes = [0], stack = [];
    for (var i = 0; i < n; i++) {
      if (mask[i] || label[i]) continue;
      var id = sizes.length, size = 0;
      label[i] = id; stack.push(i);
      while (stack.length) {
        var p = stack.pop(), px = p % w, py = (p - px) / w; size++;
        if (px > 0 && !mask[p - 1] && !label[p - 1]) { label[p - 1] = id; stack.push(p - 1); }
        if (px < w - 1 && !mask[p + 1] && !label[p + 1]) { label[p + 1] = id; stack.push(p + 1); }
        if (py > 0 && !mask[p - w] && !label[p - w]) { label[p - w] = id; stack.push(p - w); }
        if (py < h - 1 && !mask[p + w] && !label[p + w]) { label[p + w] = id; stack.push(p + w); }
      }
      sizes.push(size);
      if (size > bestSize) { bestSize = size; best = id; }
    }
    var out = new Uint8Array(n);
    for (i = 0; i < n; i++) out[i] = mask[i] || label[i] !== best ? 1 : 0;
    return out;
  }

  function posterize(g, levels) {
    if (!levels || levels < 2) return g;
    var out = new Float32Array(g.length), L = levels - 1;
    for (var i = 0; i < g.length; i++) out[i] = Math.round(g[i] * L) / L;
    return out;
  }

  // darkness d = 1 − brightness → density: 0 at or below the cutoff, then ((d − cutoff) / (1 − cutoff))^gamma
  function toneDensity(d, cutoff, gamma) {
    if (d <= cutoff) return 0;
    return Math.pow(Math.min(1, (d - cutoff) / (1 - cutoff || 1)), gamma || 1);
  }

  // the whole preparation; returns the prepared brightness (white = nothing to draw) and the background mask
  function prepare(rgba, w, h, o) {
    o = o || {};
    var c0 = toRGB(rgba, w, h), c = c0, sp = smoothingParams(o.smooth || 0);
    if (sp) c = bilateral(c0, w, h, sp.radius, sp.sigmaR, sp.passes);
    var n = w * h, mask = null;
    if (o.removeBackground) {
      // the fill always looks at a smoothed copy (at least strength 3), or the grain of a photo stops it within a
      // few pixels of the border, whatever smoothing the picture itself gets
      var bp = smoothingParams(3), bc = sp && o.smooth >= 3 ? c : bilateral(c0, w, h, bp.radius, bp.sigmaR, bp.passes);
      mask = backgroundMask(bc, w, h, (o.tolerance == null ? 22 : o.tolerance) / 255, o.seeds, true);
      if (o.largest) mask = keepLargest(mask, w, h);
    }
    var g = luminance(c);
    if (o.invert) for (var i = 0; i < n; i++) g[i] = 1 - g[i];
    g = posterize(g, o.levels);
    var out = new Float32Array(n), cutoff = (o.cutoff || 0) / 100, gamma = o.gamma || 1;
    for (i = 0; i < n; i++) out[i] = mask && mask[i] ? 1 : 1 - toneDensity(1 - g[i], cutoff, gamma);
    return { gray: out, mask: mask };
  }

  // prepared brightness → RGBA bytes, for a canvas; removed background can be tinted so it shows in a preview
  function toRGBA(gray, mask, tint) {
    var n = gray.length, out = new Uint8ClampedArray(n * 4);
    for (var i = 0; i < n; i++) {
      var v = Math.round(gray[i] * 255);
      if (tint && mask && mask[i]) { out[i * 4] = tint[0]; out[i * 4 + 1] = tint[1]; out[i * 4 + 2] = tint[2]; }
      else { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; }
      out[i * 4 + 3] = 255;
    }
    return out;
  }

  return {
    toRGB: toRGB, luminance: luminance, smoothingParams: smoothingParams, bilateral: bilateral,
    backgroundMask: backgroundMask, keepLargest: keepLargest, posterize: posterize, toneDensity: toneDensity,
    prepare: prepare, toRGBA: toRGBA
  };
});
