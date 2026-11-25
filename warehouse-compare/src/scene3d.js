/*
 * scene3d.js — what the 3D view draws, as plain numbers: one box per bay (or
 * per pod in WH-A), the floor outline and the picking points. Plan (x, y)
 * becomes three.js (x, −z) with y up, so a bay's width direction u at angle θ
 * becomes a rotation of θ about the vertical axis.
 *
 *   spec(res, inputs) → { boxes: [{ x, z, w, d, h, rot, empty }], outline: [[x, z]],
 *                         depots: [[x, z]], height, size }
 *
 * Heights: WH-B/WH-C shelving to the top of the top load (rack height + load
 * height); WH-A pods 0.45 m a shelf level on a 0.3 m robot-clearance base, and
 * empty WH-A slots as a floor marking.
 *
 * Pure, no DOM: window.WC.scene3d in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.WC = root.WC || {}; root.WC.scene3d = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const POD_LEVEL = 0.45, POD_BASE = 0.3, MARK = 0.02;

  function spec(res, inputs) {
    const L = res.layout, id = L.id;
    const A = inputs.layouts.A, C = inputs.layouts.C;
    const shelfH = C.rack_height + C.load_height, podH = POD_BASE + A.pod_levels * POD_LEVEL;
    const g = L.graph;
    const boxes = L.bays.map(function (b, i) {
      const empty = id === "A" ? isNaN(res.bayColors.cost[i]) : false;
      return { x: b.cx, z: -b.cy, w: b.w, d: b.d, h: id === "A" ? (empty ? MARK : podH) : shelfH, rot: Math.atan2(b.uy, b.ux), empty: empty };
    });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    L.outline.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    return {
      boxes: boxes,
      outline: L.outline.map(function (p) { return [p[0], -p[1]]; }),
      depots: L.depots.map(function (k) { const n = g.keys[k]; return [g.x[n], -g.y[n]]; }),
      height: id === "A" ? podH : shelfH,
      size: { x0: x0, x1: x1, z0: -y1, z1: -y0 }
    };
  }

  return { POD_LEVEL: POD_LEVEL, POD_BASE: POD_BASE, spec: spec };
});
