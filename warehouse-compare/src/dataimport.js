/*
 * dataimport.js — set the demand from real order lines.
 *
 * Input: a CSV (comma, semicolon or tab) with one row per order line and a
 * header naming at least an order column and a SKU column; a date column is
 * optional. Column names are recognised in English, Spanish and Danish:
 *   order   order, order_id, order no, pedido, orden, ordre, ordrenr
 *   SKU     sku, item, article, product, artículo, producto, código, vare, varenr
 *   date    date, day, fecha, día, dato, dag
 *
 * analyse(text) → { ok, rows, orders, skus, linesPerOrder, maxLines, days,
 *   linesPerDay, skew, weights (SKU shares, most popular first), messages }
 *
 * The comparison then uses the data's own popularity curve (demand_curve
 * "data"): every SKU keeps its real share of lines, so no fitted curve stands
 * between the data and the result.
 *
 * Pure, no DOM: window.WC.dataimport in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./t.js"));
  else { root.WC = root.WC || {}; root.WC.dataimport = factory(root.WC.t); }
})(typeof self !== "undefined" ? self : this, function (tr) {
  "use strict";
  const T = tr.T;
  const NAMES = {
    order: ["order", "order_id", "orderid", "order id", "order no", "order_no", "order number", "pedido", "orden", "n° pedido", "ordre", "ordrenr", "ordrenummer"],
    sku: ["sku", "item", "item_id", "article", "product", "product_id", "artículo", "articulo", "producto", "código", "codigo", "vare", "varenr", "varenummer"],
    date: ["date", "day", "fecha", "día", "dia", "dato", "dag"]
  };
  const norm = function (s) { return String(s).trim().toLowerCase().replace(/^﻿/, "").replace(/^"|"$/g, ""); };

  function splitLine(line, sep) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map(function (x) { return x.trim(); });
  }

  function analyse(text) {
    const messages = [];
    const lines = String(text || "").split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
    if (lines.length < 2) return { ok: false, messages: [T("The file has no data rows.")] };
    const head = lines[0];
    const sep = [";", "\t", ","].reduce(function (b, s) { return head.split(s).length > head.split(b).length ? s : b; }, ",");
    const cols = splitLine(head, sep).map(norm);
    const find = function (names) { return cols.findIndex(function (c) { return names.indexOf(c) >= 0; }); };
    const io = find(NAMES.order), is = find(NAMES.sku), id = find(NAMES.date);
    if (io < 0 || is < 0) return { ok: false, messages: [T("Couldn't find an order column and a SKU column in the header ({h}).", { h: cols.join(", ") })] };

    const orderLines = new Map(), skuCount = new Map(), days = new Set();
    let rows = 0, skipped = 0;
    for (let r = 1; r < lines.length; r++) {
      const f = splitLine(lines[r], sep), o = f[io], s = f[is];
      if (!o || !s) { skipped++; continue; }
      rows++;
      if (!orderLines.has(o)) orderLines.set(o, new Set());
      const set = orderLines.get(o);
      if (set.has(s)) continue;                              // one line per SKU per order
      set.add(s);
      skuCount.set(s, (skuCount.get(s) || 0) + 1);
      if (id >= 0 && f[id]) days.add(f[id].slice(0, 10));
    }
    if (!skuCount.size) return { ok: false, messages: [T("The file has no data rows.")] };
    if (skipped) messages.push(T("{n} rows without an order or a SKU were skipped.", { n: skipped }));

    const counts = Array.from(skuCount.values()).sort(function (a, b) { return b - a; });
    const total = counts.reduce(function (a, b) { return a + b; }, 0);
    const weights = counts.map(function (c) { return c / total; });
    let top = 0; const n20 = Math.max(1, Math.round(0.2 * counts.length));
    for (let i = 0; i < n20; i++) top += weights[i];
    let maxLines = 0; orderLines.forEach(function (s) { maxLines = Math.max(maxLines, s.size); });
    const out = {
      ok: true, rows: rows, orders: orderLines.size, skus: counts.length, lines: total,
      linesPerOrder: total / orderLines.size, maxLines: maxLines,
      days: days.size, linesPerDay: days.size ? total / days.size : null,
      skew: 100 * top, weights: weights, messages: messages
    };
    if (!days.size) messages.push(T("No date column: lines per day is left as it was."));
    if (counts.length < 50) messages.push(T("Only {n} SKUs: the comparison needs enough SKUs to fill the storage.", { n: counts.length }));
    return out;
  }

  // the data's shares, as many as the scenario has SKUs (most popular first)
  function weightsFor(nSku, w) {
    const out = new Float64Array(nSku);
    for (let i = 0; i < nSku && i < w.length; i++) out[i] = w[i];
    let s = 0; for (let i = 0; i < nSku; i++) s += out[i];
    for (let i = 0; i < nSku; i++) out[i] = s > 0 ? out[i] / s : 1 / nSku;
    return out;
  }

  return { NAMES: NAMES, analyse: analyse, weightsFor: weightsFor };
});
