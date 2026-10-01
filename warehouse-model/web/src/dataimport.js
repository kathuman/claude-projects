/*
 * dataimport.js — turn real warehouse data into model inputs.
 *
 * Two CSV files, both optional except the first:
 *   movements   one row per pallet movement (or per order line with a pallet
 *               quantity): a date (with a time, or a separate time column, for the
 *               hourly profile), a SKU, a quantity in pallets (1 if absent) and,
 *               if known, a direction (in / out).
 *   inventory   one row per SKU with the pallets on hand.
 * Column names are matched loosely ("SKU", "Item", "Article"…; "Qty", "Pallets"…).
 *
 * analyse() derives: daily pallet moves, the in/out split, operating hours and
 * the peak-hour factor (busiest hour of the average day ÷ its average hour),
 * the pallets on hand, and the demand skew in the model's own terms — the share
 * of moves made by the fastest-moving 20% of pallets (SKUs ranked by moves per
 * pallet on hand; by SKU when there is no inventory file). It also reports how
 * many pallets belong to SKUs deep enough to fill deep lanes.
 *
 * Pure: window.WH.data in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.WH = root.WH || {}; root.WH.data = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ------------------------------------------------------------------ CSV
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, "");
    const first = text.split(/\r?\n/, 1)[0] || "";
    const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : (first.indexOf("\t") >= 0 && first.indexOf(",") < 0 ? "\t" : ",");
    const rows = [];
    let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0].trim() !== "") rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); if (row.length > 1 || row[0].trim() !== "") rows.push(row); }
    return rows;
  }
  const norm = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ""); };
  function findCol(header, names) {
    const h = header.map(norm);
    for (let k = 0; k < names.length; k++) { const i = h.indexOf(names[k]); if (i >= 0) return i; }
    for (let k = 0; k < names.length; k++) { const i = h.findIndex(function (x) { return x.indexOf(names[k]) >= 0; }); if (i >= 0) return i; }
    return -1;
  }
  const COLS = {
    sku: ["sku", "item", "itemcode", "itemnumber", "article", "product", "productcode", "material", "partnumber", "part"],
    qty: ["pallets", "palletqty", "qty", "quantity", "units", "count", "pal"],
    date: ["datetime", "timestamp", "date", "day", "transactiondate", "shipdate"],
    time: ["time", "hour", "clock"],
    dir: ["direction", "inout", "movementtype", "movement", "type", "flow", "transactiontype"],
    onhand: ["pallets", "palletsonhand", "onhand", "stock", "inventory", "qty", "quantity"]
  };
  // "2026-03-02 14:35", "2026-03-02T14:35:00", "02/03/2026 14:35", "2026-03-02" (+ separate time)
  function parseWhen(dateStr, timeStr) {
    const s = String(dateStr).trim();
    let y, mo, d, hh = null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{2}))?)?/);
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; if (m[4] !== undefined) hh = +m[4]; }
    else if ((m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})(?:[ T](\d{1,2})(?::(\d{2}))?)?/))) {
      d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; if (m[4] !== undefined) hh = +m[4];
    } else return null;
    if (timeStr !== undefined && timeStr !== null && String(timeStr).trim() !== "") {
      const t = String(timeStr).trim().match(/^(\d{1,2})(?::(\d{2}))?/);
      if (t) hh = +t[1];
    }
    return { day: y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0"), hour: hh };
  }
  function direction(v) {
    const s = norm(v);
    if (!s) return null;
    if (/^(in|inbound|i|r|rec|receipt|receiving|receive|putaway|gr|goodsreceipt|asn)$/.test(s) || /^in/.test(s) || /receiv|receipt|putaway/.test(s)) return "in";
    if (/^(out|outbound|o|s|ship|shipment|shipping|pick|picking|dispatch|gi|order)$/.test(s) || /^out/.test(s) || /ship|pick|dispatch|order/.test(s)) return "out";
    return null;
  }
  const numOf = function (v) { const x = parseFloat(String(v).replace(/\s/g, "").replace(/,(\d{1,2})$/, ".$1")); return isFinite(x) ? x : NaN; };

  // ------------------------------------------------------------------ analysis
  function analyse(movementsText, inventoryText) {
    const notes = [], errors = [];
    const mv = parseCSV(movementsText || "");
    if (mv.length < 2) return { ok: false, errors: ["The movements file has no data rows."] };
    const H = mv[0];
    const c = { sku: findCol(H, COLS.sku), qty: findCol(H, COLS.qty), date: findCol(H, COLS.date), time: findCol(H, COLS.time), dir: findCol(H, COLS.dir) };
    if (c.time === c.date) c.time = -1;
    if (c.sku < 0) errors.push("No SKU / item column found (looked for: " + COLS.sku.slice(0, 5).join(", ") + "…).");
    if (c.date < 0) errors.push("No date column found (looked for: date, datetime, timestamp…).");
    if (errors.length) return { ok: false, errors: errors, columns: H };
    if (c.qty < 0) notes.push("No quantity column — each row counted as one pallet.");

    const moves = {}, days = {}, hourly = {}, inOut = { in: 0, out: 0, unknown: 0 };
    let total = 0, bad = 0, withHour = 0;
    for (let i = 1; i < mv.length; i++) {
      const r = mv[i], sku = (r[c.sku] || "").trim();
      const w = parseWhen(r[c.date] || "", c.time >= 0 ? r[c.time] : undefined);
      const q = c.qty >= 0 ? numOf(r[c.qty]) : 1;
      if (!sku || !w || !isFinite(q) || q <= 0) { bad++; continue; }
      moves[sku] = (moves[sku] || 0) + q;
      days[w.day] = (days[w.day] || 0) + q;
      total += q;
      if (w.hour !== null && w.hour >= 0 && w.hour < 24) { hourly[w.hour] = (hourly[w.hour] || 0) + q; withHour++; }
      const d = c.dir >= 0 ? direction(r[c.dir]) : null;
      inOut[d || "unknown"] += q;
    }
    if (!total) return { ok: false, errors: ["No usable rows (check the date and quantity columns)."], columns: H };
    if (bad) notes.push(bad + " row" + (bad === 1 ? "" : "s") + " skipped (missing SKU, date or quantity).");
    const nDays = Object.keys(days).length;
    const daily = total / nDays;

    // hourly profile of the average day
    let peak = null, hours = null;
    if (withHour > 0.8 * (mv.length - 1 - bad)) {
      const avg = []; for (let h = 0; h < 24; h++) avg.push((hourly[h] || 0) / nDays);
      const mx = Math.max.apply(null, avg);
      const active = avg.filter(function (v) { return v >= 0.05 * mx; });
      hours = active.length;
      const mean = active.reduce(function (a, b) { return a + b; }, 0) / hours;
      peak = mx / mean;
      notes.push("Hourly profile from " + withHour.toLocaleString("en-US") + " time-stamped rows: " + hours + " active hours, busiest hour " + peak.toFixed(2) + "× the average.");
    } else notes.push("No time of day in the data — the peak-hour factor and operating hours are left as they are.");

    // inventory
    let onHand = null, inv = null;
    if (inventoryText && String(inventoryText).trim()) {
      const iv = parseCSV(inventoryText);
      if (iv.length >= 2) {
        const ci = { sku: findCol(iv[0], COLS.sku), q: findCol(iv[0], COLS.onhand) };
        if (ci.sku < 0 || ci.q < 0) notes.push("Inventory file: no SKU or pallets column found — ignored.");
        else {
          inv = {};
          for (let i = 1; i < iv.length; i++) { const s = (iv[i][ci.sku] || "").trim(), q = numOf(iv[i][ci.q]); if (s && isFinite(q) && q > 0) inv[s] = (inv[s] || 0) + q; }
          onHand = Object.keys(inv).reduce(function (a, k) { return a + inv[k]; }, 0);
        }
      }
    }

    // demand skew: share of moves from the fastest-moving 20% of pallets (or SKUs)
    const skus = Object.keys(moves);
    let curve, basis;
    if (inv) {
      basis = "pallets";
      const all = {}; skus.forEach(function (s) { all[s] = 1; }); Object.keys(inv).forEach(function (s) { all[s] = 1; });
      const items = Object.keys(all).map(function (s) { const pal = inv[s] || 0, mvs = moves[s] || 0; return { w: Math.max(pal, mvs > 0 ? 1 : 0), m: mvs }; }).filter(function (x) { return x.w > 0; });
      items.sort(function (a, b) { return b.m / b.w - a.m / a.w; });
      curve = lorenz(items);
      const noStock = skus.filter(function (s) { return !inv[s]; }).length;
      if (noStock) notes.push(noStock + " SKU" + (noStock === 1 ? "" : "s") + " moved but not in the inventory file — counted as one pallet each.");
    } else {
      basis = "SKUs";
      curve = lorenz(skus.map(function (s) { return { w: 1, m: moves[s] }; }).sort(function (a, b) { return b.m - a.m; }));
      notes.push("No inventory file — demand skew measured across SKUs rather than pallets.");
    }
    const skew = at(curve, 0.2);

    // how deep could lanes be? pallets belonging to SKUs with at least k pallets
    let deepShare = null;
    if (inv) {
      const pals = Object.keys(inv).map(function (s) { return inv[s]; });
      const tot = pals.reduce(function (a, b) { return a + b; }, 0);
      const share = function (k) { return pals.filter(function (x) { return x >= k; }).reduce(function (a, b) { return a + b; }, 0) / tot; };
      deepShare = { ge4: share(4), ge6: share(6), ge10: share(10), skus: pals.length, perSku: tot / pals.length };
    }

    const clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
    const suggestions = { daily_throughput_pallets: clamp(Math.round(daily), 50, 5000), demand_skew: clamp(Math.round(skew * 100), 20, 95) };
    if (peak !== null) { suggestions.peak_hour_factor = +clamp(peak, 1, 3).toFixed(2); suggestions.operating_hours_per_day = clamp(hours, 8, 24); }
    if (onHand !== null) suggestions.current_inventory_pallets = clamp(Math.round(onHand), 0, 30000);
    if (daily > 5000 || (onHand || 0) > 30000) notes.push("Some values are beyond the model's slider ranges and were capped.");

    return {
      ok: true, rows: mv.length - 1, used: mv.length - 1 - bad, days: nDays, totalPallets: total, dailyPallets: daily,
      inbound: inOut.in, outbound: inOut.out, unknownDirection: inOut.unknown, skus: skus.length,
      peakHourFactor: peak, activeHours: hours, onHand: onHand, skew: skew, skewBasis: basis, curve: thin(curve, 101),
      deep: deepShare, suggestions: suggestions, notes: notes, columns: { movements: c }
    };
  }
  // cumulative share of weight (x) vs cumulative share of moves (y), items already ranked
  function lorenz(items) {
    const W = items.reduce(function (a, x) { return a + x.w; }, 0), M = items.reduce(function (a, x) { return a + x.m; }, 0);
    const pts = [[0, 0]];
    let w = 0, m = 0;
    items.forEach(function (x) { w += x.w; m += x.m; pts.push([w / W, M ? m / M : 0]); });
    return pts;
  }
  function at(pts, u) {
    for (let i = 1; i < pts.length; i++) if (pts[i][0] >= u) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (u - a[0]) / Math.max(1e-12, b[0] - a[0]); }
    return 1;
  }
  function thin(pts, n) { if (pts.length <= n) return pts; const out = []; for (let i = 0; i < n; i++) out.push(pts[Math.round(i * (pts.length - 1) / (n - 1))]); return out; }

  // ------------------------------------------------------------------ sample data
  // 600 SKUs with lognormal demand, 20 working days 06:00–22:00 with a midday peak,
  // half inbound and half outbound; stock per SKU follows the square root of demand (as
  // economic order quantities do), so fast movers turn over faster.
  function sample(seed) {
    let a = seed || 7;
    const rnd = function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const gauss = function () { return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()); };
    const N = 600, rates = [];
    for (let i = 0; i < N; i++) rates.push(Math.exp(1.25 * gauss()));
    const sum = rates.reduce(function (x, y) { return x + y; }, 0);
    const perDay = 900, shape = []; let sh = 0;
    for (let h = 6; h < 22; h++) { const v = 1 + 0.9 * Math.exp(-Math.pow((h + 0.5 - 13) / 2.6, 2)); shape.push(v); sh += v; }
    const lines = ["Date,Time,SKU,Pallets,Direction"];
    for (let day = 0; day < 20; day++) {
      const date = new Date(Date.UTC(2026, 2, 2 + day + 2 * Math.floor(day / 5)));          // weekdays from Mon 2 March 2026
      const ds = date.toISOString().slice(0, 10);
      for (let k = 0; k < perDay; k++) {
        let u = rnd() * sum, i = 0; while (u > rates[i] && i < N - 1) { u -= rates[i]; i++; }
        let v = rnd() * sh, h = 0; while (v > shape[h] && h < shape.length - 1) { v -= shape[h]; h++; }
        const mm = Math.floor(rnd() * 60);
        lines.push(ds + "," + String(6 + h).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ",SKU-" + String(i + 1).padStart(4, "0") + ",1," + (rnd() < 0.5 ? "IN" : "OUT"));
      }
    }
    const inv = ["SKU,Pallets"];
    for (let i = 0; i < N; i++) inv.push("SKU-" + String(i + 1).padStart(4, "0") + "," + Math.max(1, Math.round(2.6 * Math.pow(rates[i] / sum * perDay * 5, 0.5) + rnd() * 2)));
    return { movements: lines.join("\n") + "\n", inventory: inv.join("\n") + "\n" };
  }

  return { parseCSV, analyse, sample, parseWhen, direction };
});
