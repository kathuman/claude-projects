/*
 * csv.js — bulk import/export for nodes and edges, the practical way to
 * get "hundreds of nodes" in or out of this app (typing them one at a
 * time in the table editor doesn't scale). A node's `products` map
 * (product id -> capacity/demand) is encoded as a single pipe-separated
 * field ("PROD0:120|PROD1:80") so the whole table stays flat, ordinary
 * CSV rather than needing a wide, product-count-dependent column set.
 */
(function (global) {
  "use strict";

  function csvEscape(v) {
    const s = v === undefined || v === null ? "" : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function parseCSVLine(line) {
    const out = [];
    let cur = "", inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
        } else cur += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  function parseCSV(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) return { header: [], rows: [] };
    const header = parseCSVLine(lines[0]).map((h) => h.trim());
    const rows = lines.slice(1).map((l) => {
      const cells = parseCSVLine(l);
      const row = {};
      header.forEach((h, i) => { row[h] = cells[i] !== undefined ? cells[i] : ""; });
      return row;
    });
    return { header, rows };
  }

  function encodeProducts(products) {
    return Object.keys(products || {}).map((pid) => pid + ":" + products[pid]).join("|");
  }
  function decodeProducts(str) {
    const products = {};
    (str || "").split("|").forEach((pair) => {
      if (!pair) return;
      const idx = pair.lastIndexOf(":");
      if (idx === -1) return;
      const pid = pair.slice(0, idx), val = Number(pair.slice(idx + 1));
      if (pid && !isNaN(val)) products[pid] = val;
    });
    return products;
  }

  const NODE_COLUMNS = ["id", "name", "type", "lat", "lon", "products"];
  const EDGE_COLUMNS = ["id", "from", "to", "mode", "capacity", "costPerUnit", "leadTimeDays", "baseFailureRate"];

  function nodesToCSV(nodes) {
    const lines = [NODE_COLUMNS.join(",")];
    nodes.forEach((n) => {
      lines.push([n.id, n.name || n.id, n.type, n.lat, n.lon, encodeProducts(n.products)].map(csvEscape).join(","));
    });
    return lines.join("\n") + "\n";
  }

  function edgesToCSV(edges) {
    const lines = [EDGE_COLUMNS.join(",")];
    edges.forEach((e) => {
      lines.push([e.id, e.from, e.to, e.mode, e.capacity, e.costPerUnit, e.leadTimeDays, e.baseFailureRate].map(csvEscape).join(","));
    });
    return lines.join("\n") + "\n";
  }

  function csvToNodes(text) {
    const { rows } = parseCSV(text);
    return rows.map((r) => ({
      id: r.id,
      name: r.name || r.id,
      type: r.type,
      lat: Number(r.lat),
      lon: Number(r.lon),
      products: decodeProducts(r.products),
    })).filter((n) => n.id && ["production", "warehouse", "consumer"].includes(n.type) && !isNaN(n.lat) && !isNaN(n.lon));
  }

  function csvToEdges(text) {
    const { rows } = parseCSV(text);
    return rows.map((r) => ({
      id: r.id,
      from: r.from,
      to: r.to,
      mode: r.mode,
      capacity: Number(r.capacity),
      costPerUnit: Number(r.costPerUnit) || 0,
      leadTimeDays: Number(r.leadTimeDays) || 0,
      baseFailureRate: Number(r.baseFailureRate) || 0,
    })).filter((e) => e.id && e.from && e.to && !isNaN(e.capacity));
  }

  const mod = { parseCSV, nodesToCSV, edgesToCSV, csvToNodes, csvToEdges, encodeProducts, decodeProducts };
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  else { global.NST = global.NST || {}; global.NST.csv = mod; }
})(typeof window !== "undefined" ? window : globalThis);
