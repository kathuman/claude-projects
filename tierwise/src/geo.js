// Tierwise — world-map geometry (window.TWGeo / module.exports): an equirectangular world 1000 × 500 units wide
// (longitude −180…180 left to right, latitude 90…−90 top to bottom), great-circle routes between two places, and the
// view that fits a set of places. Pure: no DOM.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TWGeo = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var W = 1000, H = 500, R = Math.PI / 180;
  function project(lon, lat) { return [(lon + 180) / 360 * W, (90 - lat) / 180 * H]; }
  function unproject(x, y) {
    var lon = x / W * 360 - 180, lat = 90 - y / H * 180;
    lon = ((lon + 180) % 360 + 360) % 360 - 180;   // a point on a copy of the world beside this one is the same place
    return [lon, Math.max(-90, Math.min(90, lat))];
  }
  function vec(lon, lat) { return [Math.cos(lat * R) * Math.cos(lon * R), Math.cos(lat * R) * Math.sin(lon * R), Math.sin(lat * R)]; }
  // n + 1 points along the great circle from a to b ({lat, lon}); longitudes are unwrapped, so a route over the
  // date line keeps going east or west past ±180 instead of jumping across the map
  function greatCircle(a, b, n) {
    n = n || 32;
    var p = vec(a.lon, a.lat), q = vec(b.lon, b.lat);
    var d = Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
    var out = [], prev = null;
    for (var i = 0; i <= n; i++) {
      var t = i / n, x, y, z;
      if (d < 1e-9) { x = p[0]; y = p[1]; z = p[2]; }
      else { var s0 = Math.sin((1 - t) * d) / Math.sin(d), s1 = Math.sin(t * d) / Math.sin(d); x = s0 * p[0] + s1 * q[0]; y = s0 * p[1] + s1 * q[1]; z = s0 * p[2] + s1 * q[2]; }
      var lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / R, lon = Math.atan2(y, x) / R;
      if (prev != null) { while (lon - prev > 180) lon -= 360; while (lon - prev < -180) lon += 360; }
      out.push([lon, lat]); prev = lon;
    }
    return out;
  }
  // the route as projected points (x may run past 0 or W where it crosses the date line)
  function routePoints(a, b, n) { return greatCircle(a, b, n).map(function (c) { return project(c[0], c[1]); }); }
  // the copies of a route to draw so a date-line crossing shows on both edges: offsets in x
  function copies(pts) {
    var lo = Infinity, hi = -Infinity; pts.forEach(function (p) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); });
    var out = [0]; if (lo < 0) out.push(W); if (hi > W) out.push(-W); return out;
  }
  // a view { x, y, w, h } of the given aspect (width ÷ height) that holds every place, with a margin
  function fit(places, aspect, pad) {
    aspect = aspect || 2.2; pad = pad == null ? 0.12 : pad;
    if (!places.length) return world(aspect);
    var xs = places.map(function (p) { return project(p.lon, p.lat)[0]; }), ys = places.map(function (p) { return project(p.lon, p.lat)[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var w = Math.max(60, (x1 - x0) * (1 + 2 * pad)), h = Math.max(60 / aspect, (y1 - y0) * (1 + 2 * pad));
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    w = Math.min(w, W); h = w / aspect;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return clamp({ x: cx - w / 2, y: cy - h / 2, w: w, h: h });
  }
  // the whole world (without most of Antarctica)
  function world(aspect) { aspect = aspect || 2.2; var w = W, h = w / aspect; return clamp({ x: 0, y: Math.max(0, 0.05 * H), w: w, h: h }); }
  // zoom by a factor about a point (in map units), keeping that point where it is on screen
  function zoom(v, k, px, py) {
    var w = Math.max(30, Math.min(W * 1.05, v.w / k)), h = w * v.h / v.w;
    if (px == null) { px = v.x + v.w / 2; py = v.y + v.h / 2; }
    return clamp({ x: px - (px - v.x) * w / v.w, y: py - (py - v.y) * h / v.h, w: w, h: h });
  }
  // keep the view over the map (it may run a little past the date line, where the world repeats)
  function clamp(v) {
    var x = Math.max(-0.3 * W, Math.min(1.3 * W - v.w, v.x)), y = Math.max(-0.02 * H, Math.min(H * 1.02 - v.h, v.y));
    if (v.h > H) y = (H - v.h) / 2;
    return { x: x, y: y, w: v.w, h: v.h };
  }
  return { W: W, H: H, project: project, unproject: unproject, greatCircle: greatCircle, routePoints: routePoints, copies: copies, fit: fit, world: world, zoom: zoom, clamp: clamp };
});
