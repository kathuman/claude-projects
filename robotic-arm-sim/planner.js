/* Linkage — collision-free path planning in joint space.
 *
 * RRT-Connect (Kuffner & LaValle, 2000): grow one random tree from the start and one from the
 * goal, each step extending one tree toward a random sample and then greedily connecting the
 * other tree to the new node; done when they meet. The raw path is then shortened by random
 * shortcutting. Every edge is checked for collisions at a fine joint-space resolution.
 * Pure (no DOM); browser global window.LinkagePlanner or CommonJS.
 */
(function (root) {
  "use strict";

  function rng(seed) {   // small deterministic PRNG so plans are reproducible
    var s = (seed >>> 0) || 1;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  }
  function dist(a, b) { var m = 0; for (var i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; }
  function lerp(a, b, t) { return a.map(function (v, i) { return v + (b[i] - v) * t; }); }

  // is the straight joint-space segment a->b free? (checked every `res` rad on the largest joint)
  function edgeFree(a, b, isFree, res) {
    var n = Math.max(1, Math.ceil(dist(a, b) / res));
    for (var k = 1; k <= n; k++) if (!isFree(lerp(a, b, k / n))) return false;
    return true;
  }

  // opts: { lo, hi (joint sampling ranges), step (rad), res (rad), maxIter, seed, shortcut }
  function rrtConnect(qStart, qGoal, isFree, opts) {
    opts = opts || {};
    var step = opts.step || 0.25, res = opts.res || 0.03, maxIter = opts.maxIter || 6000;
    var lo = opts.lo, hi = opts.hi, rand = rng(opts.seed || 7), n = qStart.length;
    if (!isFree(qStart)) return { ok: false, reason: "start collides" };
    if (!isFree(qGoal)) return { ok: false, reason: "goal collides" };
    if (edgeFree(qStart, qGoal, isFree, res)) return { ok: true, path: [qStart.slice(), qGoal.slice()], iterations: 0, direct: true };

    var A = [{ q: qStart.slice(), parent: -1 }], B = [{ q: qGoal.slice(), parent: -1 }];
    function nearest(T, q) {
      var bi = 0, bd = Infinity;
      for (var i = 0; i < T.length; i++) { var d = dist(T[i].q, q); if (d < bd) { bd = d; bi = i; } }
      return bi;
    }
    // one step from the nearest node toward q; returns "reached" | "advanced" | "trapped"
    function extend(T, q) {
      var ni = nearest(T, q), qn = T[ni].q, d = dist(qn, q);
      var qNew = d <= step ? q.slice() : lerp(qn, q, step / d);
      if (!isFree(qNew) || !edgeFree(qn, qNew, isFree, res)) return { status: "trapped" };
      T.push({ q: qNew, parent: ni });
      return { status: d <= step ? "reached" : "advanced", idx: T.length - 1 };
    }
    function connect(T, q) {
      var r;
      do { r = extend(T, q); } while (r.status === "advanced");
      return r;
    }
    function trace(T, i) { var out = []; while (i >= 0) { out.push(T[i].q); i = T[i].parent; } return out; }

    for (var it = 0; it < maxIter; it++) {
      var qr = [];
      for (var j = 0; j < n; j++) qr.push(lo[j] + rand() * (hi[j] - lo[j]));
      var e = extend(A, qr);
      if (e.status !== "trapped") {
        var c = connect(B, A[e.idx].q);
        if (c.status === "reached") {
          var pa = trace(A, e.idx).reverse(), pb = trace(B, c.idx);
          // keep start -> goal orientation regardless of which tree is which
          var path = (A[0].q === qStart || dist(A[0].q, qStart) < 1e-12) ? pa.concat(pb.slice(1)) : pb.slice().reverse().concat(pa.slice().reverse().slice(1));
          if (dist(path[0], qStart) > 1e-9) path.reverse();
          if (opts.shortcut !== false) path = shortcut(path, isFree, res, rand, opts.shortcutIters || 200);
          return { ok: true, path: path, iterations: it + 1, nodes: A.length + B.length };
        }
      }
      var tmp = A; A = B; B = tmp;   // alternate which tree grows
    }
    return { ok: false, reason: "no path found", iterations: maxIter };
  }

  // Random shortcutting: pick two points on the path, and if the straight segment between them
  // is free, splice out everything in between.
  function shortcut(path, isFree, res, rand, iters) {
    path = path.map(function (q) { return q.slice(); });
    for (var k = 0; k < iters && path.length > 2; k++) {
      var i = Math.floor(rand() * (path.length - 1)), j = Math.floor(rand() * (path.length - 1));
      if (Math.abs(i - j) < 2) continue;
      if (i > j) { var t = i; i = j; j = t; }
      if (edgeFree(path[i], path[j], isFree, res)) path.splice(i + 1, j - i - 1);
    }
    return path;
  }

  function pathLength(path) { var L = 0; for (var i = 1; i < path.length; i++) L += dist(path[i - 1], path[i]); return L; }

  var api = { rrtConnect: rrtConnect, shortcut: shortcut, edgeFree: edgeFree, pathLength: pathLength, rng: rng };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LinkagePlanner = api;
})(typeof window !== "undefined" ? window : this);
