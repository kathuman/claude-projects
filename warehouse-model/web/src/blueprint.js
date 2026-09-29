/*
 * blueprint.js — the dimensioned floor plan, as an SVG string.
 *
 * Drawn from the same computeAll() results as everything else (row and
 * aisle positions included), so the plan can't disagree with the 3D view,
 * the KPIs or the FreeCAD model. The page redraws it on every change;
 * tools/render_blueprint.js writes the baseline to web/assets/blueprint.svg.
 *
 * renderBlueprint(p, results, opts) — opts.len(metres) → label text (for
 * metric/imperial), opts.title.  Browser: window.WH.renderBlueprint; Node:
 * module.exports.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.WH = root.WH || {}; root.WH.renderBlueprint = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const INK = "#bfe4ff", INK_DIM = "#6fa8c9", BG = "#0a2f52", BG2 = "#0d3a63";
  const RACK = "#ffb27a", RACK_FILL = "rgba(217,89,38,0.35)", DOCK = "#7be0c4", ZONE = "#eda100", ACCENT = "#7dd3fc";

  return function renderBlueprint(p, results, opts) {
    opts = opts || {};
    const len = opts.len || function (m) { return m.toFixed(1) + " m"; };
    const layout = results.layout, capacity = results.capacity;
    const WT = p.wall_thickness / 1000;
    const buildingW = p.warehouse_length + 2 * WT;   // x extent
    const buildingH = p.warehouse_width + 2 * WT;    // y extent

    const PX = 9;                                    // px per metre
    const MARGIN_X = 13, MARGIN_TOP = 7, MARGIN_BOTTOM = 8, TITLE_H = 7.5;
    const minW = 1060 / PX;                          // room for the title block
    const canvasWm = Math.max(buildingW + 2 * MARGIN_X, minW);
    const canvasHm = MARGIN_TOP + buildingH + MARGIN_BOTTOM + TITLE_H;
    const W = Math.round(canvasWm * PX), H = Math.round(canvasHm * PX);
    const ox = ((canvasWm - buildingW) / 2) * PX, oy = MARGIN_TOP * PX;
    const X = function (xm) { return +(ox + xm * PX).toFixed(2); };
    const Y = function (ym) { return +(oy + ym * PX).toFixed(2); };

    const s = [];
    const el = function (str) { s.push(str); };
    el(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'IBM Plex Mono', ui-monospace, monospace">`);
    el(`<rect x="0" y="0" width="${W}" height="${H}" fill="${BG}"/>`);
    el(`<g stroke="${BG2}" stroke-width="1">`);
    for (let gx = 0; gx <= canvasWm; gx += 5) el(`<line x1="${gx * PX}" y1="0" x2="${gx * PX}" y2="${H}"/>`);
    for (let gy = 0; gy <= canvasHm; gy += 5) el(`<line x1="0" y1="${gy * PX}" x2="${W}" y2="${gy * PX}"/>`);
    el(`</g>`);
    el(`<rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="${INK}" stroke-width="2"/>`);
    el(`<rect x="12" y="12" width="${W - 24}" height="${H - 24}" fill="none" stroke="${INK_DIM}" stroke-width="1"/>`);

    // envelope: outer and inner wall faces, hatched wall band
    el(`<rect x="${X(0)}" y="${Y(0)}" width="${buildingW * PX}" height="${buildingH * PX}" fill="none" stroke="${INK}" stroke-width="2.5"/>`);
    el(`<rect x="${X(WT)}" y="${Y(WT)}" width="${p.warehouse_length * PX}" height="${p.warehouse_width * PX}" fill="none" stroke="${INK}" stroke-width="1"/>`);
    el(`<g stroke="${INK_DIM}" stroke-width="0.8">`);
    for (let x = 0.3; x < buildingW - 0.3; x += 1.2) {
      el(`<line x1="${X(x)}" y1="${Y(0)}" x2="${X(x + WT)}" y2="${Y(WT)}"/>`);
      el(`<line x1="${X(x)}" y1="${Y(buildingH - WT)}" x2="${X(x + WT)}" y2="${Y(buildingH)}"/>`);
    }
    el(`</g>`);

    // staging zones
    function zone(x, w, label) {
      el(`<rect x="${X(x)}" y="${Y(WT)}" width="${w * PX}" height="${p.warehouse_width * PX}" fill="${ZONE}" fill-opacity="0.10" stroke="${ZONE}" stroke-width="1" stroke-dasharray="5,4"/>`);
      const cx = X(x + w / 2), cy = Y(WT + p.warehouse_width / 2);
      el(`<text x="${cx}" y="${cy}" fill="${ZONE}" font-size="10" text-anchor="middle" transform="rotate(-90 ${cx} ${cy})">${label}</text>`);
    }
    zone(WT, p.cross_aisle_width, "RECEIVING STAGING");
    zone(WT + p.warehouse_length - p.cross_aisle_width, p.cross_aisle_width, "SHIPPING STAGING");

    // rack rows (with their lanes drawn for deep rack types) and aisle centre lines
    const x0 = WT + p.cross_aisle_width, deep = layout.rackType.deep;
    layout.rows.forEach(function (r) {
      const ry = WT + r.y;
      el(`<rect x="${X(x0)}" y="${Y(ry)}" width="${layout.rackRowLength * PX}" height="${r.depth * PX}" fill="${RACK_FILL}" stroke="${RACK}" stroke-width="0.9"/>`);
      for (let k = 1; k < deep; k++) el(`<line x1="${X(x0)}" y1="${Y(ry + k * p.rack_depth)}" x2="${X(x0 + layout.rackRowLength)}" y2="${Y(ry + k * p.rack_depth)}" stroke="${RACK}" stroke-width="0.4" stroke-dasharray="2,3"/>`);
      if (r.index === 1 || r.index === layout.numRackRows) {
        el(`<text x="${X(x0 + 2)}" y="${Y(ry + r.depth / 2 + 0.3)}" fill="${RACK}" font-size="6.5">R${String(r.index).padStart(2, "0")}</text>`);
      }
    });
    el(`<g stroke="${ACCENT}" stroke-width="0.5" stroke-dasharray="1,4" opacity="0.6">`);
    layout.aisles.forEach(function (a) { el(`<line x1="${X(x0)}" y1="${Y(WT + a.y)}" x2="${X(x0 + layout.rackRowLength)}" y2="${Y(WT + a.y)}"/>`); });
    el(`</g>`);
    if (layout.rows.length) {
      el(`<text x="${X(x0 + layout.rackRowLength / 2)}" y="${Y(WT + layout.yOffset - 1.2)}" fill="${INK}" font-size="8" text-anchor="middle">${layout.numRackRows} ROWS &#183; ${layout.baysPerRow} BAYS/ROW &#183; ${layout.rackType.label.toUpperCase()} &#183; ${capacity.storageCapacity.toLocaleString("en-US")} POSITIONS</text>`);
    }

    // dock doors (west = receiving, east = shipping)
    function doors(xEdge, count, label, anchor, dx) {
      const y0 = WT + (p.warehouse_width - count * p.dock_bay_width) / 2;
      for (let i = 0; i < count; i++) el(`<rect x="${X(xEdge) - 3}" y="${Y(y0 + i * p.dock_bay_width) + 1}" width="6" height="${p.dock_bay_width * PX - 2}" fill="${DOCK}"/>`);
      el(`<text x="${X(xEdge) + dx}" y="${Y(y0 - 0.8)}" fill="${DOCK}" font-size="7" text-anchor="${anchor}">${label}</text>`);
    }
    doors(0, p.num_receiving_docks, p.num_receiving_docks + "× RECEIVING", "end", -6);
    doors(buildingW, p.num_shipping_docks, p.num_shipping_docks + "× SHIPPING", "start", 6);

    // dimension lines
    function dimH(y, x1, x2, label) {
      el(`<g stroke="${ACCENT}" stroke-width="0.8"><line x1="${X(x1)}" y1="${Y(y)}" x2="${X(x2)}" y2="${Y(y)}"/><line x1="${X(x1)}" y1="${Y(y) - 4}" x2="${X(x1)}" y2="${Y(y) + 4}"/><line x1="${X(x2)}" y1="${Y(y) - 4}" x2="${X(x2)}" y2="${Y(y) + 4}"/></g>`);
      el(`<text x="${(X(x1) + X(x2)) / 2}" y="${Y(y) - 6}" fill="${ACCENT}" font-size="9" text-anchor="middle">${label}</text>`);
    }
    function dimV(x, y1, y2, label, right) {
      el(`<g stroke="${ACCENT}" stroke-width="0.8"><line x1="${X(x)}" y1="${Y(y1)}" x2="${X(x)}" y2="${Y(y2)}"/><line x1="${X(x) - 4}" y1="${Y(y1)}" x2="${X(x) + 4}" y2="${Y(y1)}"/><line x1="${X(x) - 4}" y1="${Y(y2)}" x2="${X(x) + 4}" y2="${Y(y2)}"/></g>`);
      const cy = (Y(y1) + Y(y2)) / 2;
      if (right) { el(`<text x="${X(x) + 6}" y="${cy + 3}" fill="${ACCENT}" font-size="9">${label}</text>`); return; }
      el(`<text x="${X(x) - 8}" y="${cy}" fill="${ACCENT}" font-size="9" text-anchor="middle" transform="rotate(-90 ${X(x) - 8} ${cy})">${label}</text>`);
    }
    dimH(-3.5, WT, WT + p.warehouse_length, len(p.warehouse_length) + " inside (+ 2 × " + (p.wall_thickness).toFixed(0) + " mm wall)");
    dimV(-4.5, WT, WT + p.warehouse_width, len(p.warehouse_width) + " inside");
    if (layout.rows.length >= 2 && layout.baysPerRow > 0) {
      // detail dimensions on an aisle in the middle of the block, clear of the row labels
      const a = layout.aisles[Math.floor(layout.aisles.length / 2)];
      const bx = x0 + Math.floor(layout.baysPerRow / 2) * p.bay_width;
      dimH(WT + a.y, bx, bx + p.bay_width, "bay " + len(p.bay_width));
      dimV(bx + p.bay_width + 2.5, WT + a.y - p.aisle_width / 2, WT + a.y + p.aisle_width / 2, "aisle " + len(p.aisle_width), true);
    }

    // north arrow
    const naX = X(buildingW) + (MARGIN_X - 5) * PX, naY = Y(2);
    el(`<g stroke="${INK}" stroke-width="1" fill="${INK}"><line x1="${naX}" y1="${naY + 27}" x2="${naX}" y2="${naY}"/><path d="M ${naX - 4} ${naY + 7} L ${naX} ${naY} L ${naX + 4} ${naY + 7} Z"/></g>`);
    el(`<text x="${naX}" y="${naY + 40}" fill="${INK}" font-size="9" text-anchor="middle">N</text>`);

    // scale bar — true to the drawing's own coordinates at any display size
    const sbY = Y(buildingH + 3), sbX = X(0);
    for (let i = 0; i < 4; i++) el(`<rect x="${sbX + i * 5 * PX}" y="${sbY}" width="${5 * PX}" height="4" fill="${i % 2 === 0 ? INK : "none"}" stroke="${INK}" stroke-width="1.2"/>`);
    el(`<text x="${sbX}" y="${sbY - 2}" fill="${INK}" font-size="7">0</text>`);
    el(`<text x="${sbX + 20 * PX}" y="${sbY - 2}" fill="${INK}" font-size="7">${len(20).replace(/\.0 /, " ")}</text>`);

    // title block
    const tbY = (MARGIN_TOP + buildingH + MARGIN_BOTTOM) * PX;
    el(`<rect x="12" y="${tbY}" width="${W - 24}" height="${TITLE_H * PX - 6}" fill="none" stroke="${INK}" stroke-width="1.5"/>`);
    const ty = tbY + 22;
    el(`<text x="26" y="${ty}" fill="${INK}" font-size="15" font-weight="700">${opts.title || "WAREHOUSE MODEL — FLOOR PLAN"}</text>`);
    el(`<text x="26" y="${ty + 18}" fill="${INK_DIM}" font-size="9.5">calculations.js layout &#183; same rows as the 3D view and the FreeCAD model &#183; scale bar above</text>`);
    const stats = [
      ["CAPACITY", capacity.storageCapacity.toLocaleString("en-US") + " pos"],
      ["RACK ROWS", String(layout.numRackRows)],
      ["FOOTPRINT", opts.area ? opts.area(results.cost.footprint) : Math.round(results.cost.footprint).toLocaleString("en-US") + " m²"],
      ["DOCKS", p.num_receiving_docks + " in / " + p.num_shipping_docks + " out"]
    ];
    let sx = W - 470;
    stats.forEach(function (st) {
      el(`<text x="${sx}" y="${ty - 4}" fill="${INK_DIM}" font-size="8.5">${st[0]}</text>`);
      el(`<text x="${sx}" y="${ty + 13}" fill="${ACCENT}" font-size="13" font-weight="700">${st[1]}</text>`);
      sx += 118;
    });
    el(`</svg>`);
    return s.join("\n");
  };
});
