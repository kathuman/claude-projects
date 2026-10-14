// Tierwise — loading and saving a supply chain (window.TWIO / module.exports). A network travels as:
//   CSV    a table of sites (one row each, columns below), then optionally a "setting,value" table; comma, semicolon
//          or tab separated; with a semicolon, decimal commas are read (1.000,5 = one thousand and a half)
//   Excel  a workbook with a "Sites" sheet and an optional "Settings" sheet, same columns (read through SheetJS)
//   JSON   the network as Tierwise holds it
// Months in files are calendar months: launch, expansions and outages are written YYYY-MM (or a month number from the
// start of the plan, 0 = the first month); startMonth, demandPeak and rawPeak are 1–12. Messages are in English and
// name the row they come from. Pure: no DOM.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./plan.js"), require("./network.js"));
  else root.TWIO = factory(root.TWPlan, root.TWNetwork);
})(typeof self !== "undefined" ? self : this, function (P, N) {
  "use strict";
  var COLS = ["id", "tier", "name", "country", "lat", "lon", "base", "growth", "longGrowth", "season", "launch", "ramp",
    "capacity", "handling", "cover", "lead", "release", "yield", "suppliers", "expansions", "outages"];
  var NUM = { lat: 1, lon: 1, base: 1, growth: 1, longGrowth: 1, season: 1, ramp: 1, capacity: 1, handling: 1, cover: 1, lead: 1, release: 1, yield: 1 };
  var ALIAS = {
    id: "id", siteid: "id", code: "id", tier: "tier", type: "tier", level: "tier", name: "name", site: "name", sitename: "name", country: "country",
    lat: "lat", latitude: "lat", lon: "lon", lng: "lon", long: "lon", longitude: "lon",
    base: "base", demand: "base", basedemand: "base", growth: "growth", longgrowth: "longGrowth", longtermgrowth: "longGrowth", growthlong: "longGrowth",
    season: "season", seasonswing: "season", seasonality: "season", launch: "launch", ramp: "ramp", rampmonths: "ramp",
    capacity: "capacity", cap: "capacity", handling: "handling", handlingdays: "handling", cover: "cover", coverweeks: "cover", safetystock: "cover",
    lead: "lead", leadtime: "lead", leaddays: "lead", release: "release", releasetime: "release", releasedays: "release", yield: "yield",
    suppliers: "suppliers", sourcing: "suppliers", sources: "suppliers", supplier: "suppliers", expansions: "expansions", expansion: "expansions", outages: "outages", outage: "outages"
  };
  var TIER_ALIAS = {
    market: "market", markets: "market", consumption: "market", consumptionpoint: "market", consumptionpoints: "market", customer: "market", customers: "market", demand: "market",
    warehouse: "warehouse", warehouses: "warehouse", dc: "warehouse", distribution: "warehouse", distributioncentre: "warehouse", distributioncenter: "warehouse",
    packaging: "packaging", packer: "packaging", packing: "packaging", packagingcmo: "packaging",
    dosing: "dosing", finaldosing: "dosing", filling: "dosing", dosingcmo: "dosing",
    product: "product", manufacturing: "product", productmanufacturing: "product", productcmo: "product",
    raw: "raw", rawingredient: "raw", rawingredients: "raw", ingredient: "raw", ingredients: "raw", rawcmo: "raw"
  };
  var SETTINGS = ["product", "startYear", "startMonth", "cover", "demandPeak", "rawPeak", "rawSeasonMax", "demandScale", "packPerUnit", "kgPerSachet", "rawPerProduct"];
  var TIER_KEYS = ["name", "one", "unit"];
  function key(s) { return String(s == null ? "" : s).toLowerCase().replace(/[\s_\-.()%]/g, ""); }

  // ---- CSV text to rows of cells
  function splitCSV(text) {
    text = String(text || "").replace(/^﻿/, "");
    var first = text.split(/\r?\n/).filter(function (l) { return l.trim(); })[0] || "";
    var count = function (ch) { var n = 0, q = false; for (var i = 0; i < first.length; i++) { var c = first[i]; if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
    var cands = [",", ";", "\t"], delim = ",", best = -1;
    cands.forEach(function (c) { var n = count(c); if (n > best) { best = n; delim = c; } });
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return { rows: rows, delim: delim };
  }
  // a number as written in the file; with semicolons, a comma is the decimal mark and a point groups thousands
  function number(v, euro) {
    if (typeof v === "number") return v;
    var s = String(v == null ? "" : v).replace(/[\s %]/g, "").replace(/^\+/, "").replace(/−/g, "-");
    if (s === "") return null;
    if (euro) { if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", "."); else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); }
    else s = s.replace(/,(?=\d{3}(\D|$))/g, "");
    return /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(s) ? parseFloat(s) : NaN;
  }
  // YYYY-MM (or YYYY/MM, MM/YYYY is not accepted) to a month index from the start; a bare number is already an index
  function monthIndex(v, cfg) {
    if (typeof v === "number") return Math.round(v);
    var s = String(v).trim(), m = s.match(/^(\d{4})[-\/.](\d{1,2})$/);
    if (m) return (+m[1] - cfg.startYear) * 12 + (+m[2] - 1 - cfg.startMonth);
    var n = number(s, false); return isFinite(n) ? Math.round(n) : NaN;
  }
  function monthText(i, cfg) { var t = cfg.startMonth + i, y = cfg.startYear + Math.floor(t / 12), mo = ((t % 12) + 12) % 12 + 1; return y + "-" + (mo < 10 ? "0" : "") + mo; }

  // ---- rows (from CSV or a spreadsheet) to a network
  function fromRows(siteRows, settingRows, euro) {
    var errors = [], warnings = [], ex = N.base();
    var net = { product: ex.product, config: Object.assign({}, ex.config, { demandScale: 1 }), bom: Object.assign({}, ex.bom), tiers: {}, sites: [] };
    // settings first: they set the calendar that dates in the site table refer to
    (settingRows || []).forEach(function (r, i) {
      var k = String(r[0] == null ? "" : r[0]).trim(), v = r[1];
      if (!k || /^(setting|key)$/i.test(k) || /^#/.test(k)) return;
      var tm = k.match(/^tier\.(\w+)\.(\w+)$/i);
      if (tm) {
        var tid = TIER_ALIAS[key(tm[1])], tk = tm[2].toLowerCase();
        if (!tid || TIER_KEYS.indexOf(tk) < 0) { warnings.push("Setting “" + k + "” is not used."); return; }
        if (String(v || "").trim()) (net.tiers[tid] = net.tiers[tid] || {})[tk] = String(v).trim();
        return;
      }
      var sk = null; SETTINGS.forEach(function (x) { if (key(x) === key(k)) sk = x; });
      if (!sk) { warnings.push("Setting “" + k + "” is not used."); return; }
      if (sk === "product") { net.product = String(v == null ? "" : v).trim(); return; }
      var n = number(v, euro);
      if (n == null) return;
      if (!isFinite(n)) { errors.push("Setting “" + k + "”: “" + v + "” is not a number."); return; }
      if (sk === "startMonth" || sk === "demandPeak" || sk === "rawPeak") {
        if (!(n >= 1 && n <= 12)) { errors.push("Setting “" + k + "” must be a month from 1 to 12."); return; }
        net.config[sk] = Math.round(n) - 1;
      } else if (sk === "packPerUnit" || sk === "kgPerSachet" || sk === "rawPerProduct") net.bom[sk] = n;
      else if (sk === "startYear") net.config.startYear = Math.round(n);
      else net.config[sk] = n;
    });
    if (!Object.keys(net.tiers).length) delete net.tiers;
    var cfg = net.config;
    // the header row of the site table
    var h = -1;
    for (var i = 0; i < siteRows.length; i++) { var ks = siteRows[i].map(function (c) { return ALIAS[key(c)]; }); if (ks.indexOf("id") >= 0 && ks.indexOf("tier") >= 0) { h = i; break; } }
    if (h < 0) return { ok: false, errors: ["No header row with the columns id and tier was found."], warnings: warnings };
    var cols = siteRows[h].map(function (c) { var k = ALIAS[key(c)]; if (!k && String(c).trim()) warnings.push("Column “" + String(c).trim() + "” is not used."); return k || null; });
    for (i = h + 1; i < siteRows.length; i++) {
      var r = siteRows[i], rowNo = i + 1;
      if (!r.some(function (c) { return String(c == null ? "" : c).trim(); })) continue;
      if (/^(setting|key)$/i.test(String(r[0]).trim())) break;
      var o = {}, s = {};
      cols.forEach(function (k, j) { if (k) o[k] = r[j]; });
      s.id = String(o.id == null ? "" : o.id).trim();
      if (!s.id) { errors.push("Row " + rowNo + ": the site has no id."); continue; }
      var tier = TIER_ALIAS[key(o.tier)];
      if (!tier) { errors.push("Row " + rowNo + ": unknown tier “" + (o.tier == null ? "" : o.tier) + "” for " + s.id + "."); continue; }
      s.tier = tier; s.name = String(o.name == null || o.name === "" ? s.id : o.name).trim(); s.country = String(o.country == null ? "" : o.country).trim();
      Object.keys(NUM).forEach(function (k) {
        if (o[k] == null || String(o[k]).trim() === "") return;
        var n = number(o[k], euro);
        if (!isFinite(n)) errors.push("Row " + rowNo + ": “" + o[k] + "” is not a number (" + k + ")."); else s[k] = n;
      });
      if (o.launch != null && String(o.launch).trim() !== "") { var li = monthIndex(o.launch, cfg); if (isFinite(li)) s.launch = li; else errors.push("Row " + rowNo + ": cannot read the launch month “" + o.launch + "”."); }
      // the supplying lanes: id:share[:transit days], separated by | ; or ,
      if (o.suppliers != null && String(o.suppliers).trim() !== "") {
        s.suppliers = [];
        String(o.suppliers).split(/[|;,]/).forEach(function (part) {
          part = part.trim(); if (!part) return;
          var a = part.split(":").map(function (x) { return x.trim(); }), share = a.length > 1 ? number(a[1], false) : 100, days = a.length > 2 && a[2] !== "" ? number(a[2], false) : null;
          if (!a[0] || !isFinite(share) || (days != null && !isFinite(days))) { errors.push("Row " + rowNo + ": cannot read the supplier “" + part + "”."); return; }
          var l = { from: a[0], share: share }; if (days != null) l.days = days; s.suppliers.push(l);
        });
      } else if (tier !== "raw") s.suppliers = [];
      if (o.expansions != null && String(o.expansions).trim() !== "") {
        s.expansions = [];
        String(o.expansions).split(/[|;,]/).forEach(function (part) {
          part = part.trim(); if (!part) return;
          var a = part.split(":"), from = monthIndex(a[0].trim(), cfg), add = a.length > 1 ? number(a[1].trim(), false) : NaN;
          if (!isFinite(from) || !isFinite(add)) { errors.push("Row " + rowNo + ": cannot read the expansion “" + part + "” (write YYYY-MM:+amount)."); return; }
          s.expansions.push({ from: Math.max(0, from), add: add });
        });
      }
      if (o.outages != null && String(o.outages).trim() !== "") {
        s.outages = [];
        String(o.outages).split(/[|;,]/).forEach(function (part) {
          part = part.trim(); if (!part) return;
          var a = part.split(":"), from = monthIndex(a[0].trim(), cfg), months = number((a[1] || "").trim(), false), loss = number((a[2] || "").trim(), false);
          if (!isFinite(from) || !isFinite(months) || !isFinite(loss)) { errors.push("Row " + rowNo + ": cannot read the outage “" + part + "” (write YYYY-MM:months:loss %)."); return; }
          s.outages.push({ from: Math.max(0, from), months: months, loss: loss });
        });
      }
      if (tier === "market") { if (s.growth == null) s.growth = 0; if (s.season == null) s.season = 0; }
      else if (s.capacity == null) errors.push("Row " + rowNo + ": " + s.id + " needs a capacity.");
      net.sites.push(s);
    }
    if (!net.sites.length && !errors.length) errors.push("The file has no sites.");
    if (!errors.length) P.validate(net).forEach(function (e) { errors.push(e); });
    return { ok: !errors.length, errors: errors, warnings: warnings, net: errors.length ? null : net };
  }
  function fromCSV(text) {
    var sp = splitCSV(text), rows = sp.rows, cut = -1;
    for (var i = 0; i < rows.length; i++) if (/^(setting|key)$/i.test(String(rows[i][0] || "").trim())) { cut = i; break; }
    return fromRows(cut >= 0 ? rows.slice(0, cut) : rows, cut >= 0 ? rows.slice(cut) : [], sp.delim === ";");
  }
  // a SheetJS workbook: the "Sites" sheet (or the first) and an optional "Settings" sheet
  function fromWorkbook(wb, XLSX) {
    var names = wb.SheetNames || [], pick = function (re) { for (var i = 0; i < names.length; i++) if (re.test(names[i])) return names[i]; return null; };
    var sn = pick(/^(sites?|network|sitios|lokationer|steder)$/i) || names[0], st = pick(/^(settings?|ajustes|configuraci[oó]n|indstillinger)$/i);
    if (!sn) return { ok: false, errors: ["The workbook has no sheets."], warnings: [] };
    var rows = function (n) { return XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" }); };
    var sites = rows(sn), settings = st && st !== sn ? rows(st) : [];
    if (!st) { var cut = -1; for (var i = 0; i < sites.length; i++) if (/^(setting|key)$/i.test(String(sites[i][0] || "").trim())) { cut = i; break; } if (cut >= 0) { settings = sites.slice(cut); sites = sites.slice(0, cut); } }
    return fromRows(sites, settings, false);
  }
  function fromJSON(text) {
    var o; try { o = typeof text === "string" ? JSON.parse(text) : text; } catch (e) { return { ok: false, errors: ["The file is not valid JSON."], warnings: [] }; }
    if (!o || !Array.isArray(o.sites)) return { ok: false, errors: ["The JSON file has no list of sites."], warnings: [] };
    var ex = N.base();
    var net = { product: o.product != null ? String(o.product) : ex.product, config: Object.assign({}, ex.config, { demandScale: 1 }, o.config || {}), bom: Object.assign({}, ex.bom, o.bom || {}), sites: JSON.parse(JSON.stringify(o.sites)) };
    if (o.tiers) net.tiers = JSON.parse(JSON.stringify(o.tiers));
    if (o.scenario) net.scenario = String(o.scenario);
    var errors = P.validate(net);
    return { ok: !errors.length, errors: errors, warnings: [], net: errors.length ? null : net };
  }
  function load(name, content, XLSX) {
    var n = String(name || "").toLowerCase();
    if (/\.json$/.test(n)) return fromJSON(content);
    if (/\.(xlsx|xlsm|xls|ods)$/.test(n)) {
      if (!XLSX) return { ok: false, errors: ["The spreadsheet reader is not available."], warnings: [] };
      try { return fromWorkbook(XLSX.read(content, { type: "array" }), XLSX); } catch (e) { return { ok: false, errors: ["The spreadsheet could not be read."], warnings: [] }; }
    }
    if (typeof content !== "string") content = new TextDecoder("utf-8").decode(content);
    if (/^\s*[{[]/.test(content)) return fromJSON(content);
    return fromCSV(content);
  }

  // ---- a network to rows, CSV, a workbook and JSON
  function clean(v) { return typeof v === "number" ? +v.toFixed(6) : v; }
  function toRows(net) {
    var cfg = net.config, sites = [COLS.slice()];
    net.sites.forEach(function (s) {
      sites.push(COLS.map(function (k) {
        if (k === "suppliers") return (s.suppliers || []).map(function (l) { return l.from + ":" + clean(l.share) + (l.days != null ? ":" + clean(l.days) : ""); }).join(" | ");
        if (k === "expansions") return (s.expansions || []).map(function (e) { return monthText(e.from, cfg) + ":+" + clean(e.add); }).join(" | ");
        if (k === "outages") return (s.outages || []).map(function (e) { return monthText(e.from, cfg) + ":" + clean(e.months) + ":" + clean(e.loss); }).join(" | ");
        if (k === "launch") return s.launch != null ? monthText(s.launch, cfg) : "";
        var v = s[k]; return v == null ? "" : clean(v);
      }));
    });
    var settings = [["setting", "value"], ["product", net.product || ""], ["startYear", cfg.startYear], ["startMonth", cfg.startMonth + 1], ["cover", clean(cfg.cover)],
      ["demandPeak", cfg.demandPeak + 1], ["rawPeak", cfg.rawPeak + 1], ["rawSeasonMax", clean(cfg.rawSeasonMax)], ["demandScale", clean(cfg.demandScale != null ? cfg.demandScale : 1)],
      ["packPerUnit", clean(net.bom.packPerUnit)], ["kgPerSachet", clean(net.bom.kgPerSachet)], ["rawPerProduct", clean(net.bom.rawPerProduct)]];
    P.TIERS.forEach(function (t) { var o = (net.tiers || {})[t.id] || {}; TIER_KEYS.forEach(function (k) { settings.push(["tier." + t.id + "." + k, o[k] || ""]); }); });
    return { sites: sites, settings: settings };
  }
  function csvCell(v) { var s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function toCSV(net) {
    var r = toRows(net), out = r.sites.map(function (row) { return row.map(csvCell).join(","); });
    out.push(""); r.settings.forEach(function (row) { out.push(row.map(csvCell).join(",")); });
    return out.join("\r\n") + "\r\n";
  }
  function toWorkbook(net, XLSX) {
    var r = toRows(net), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(r.sites), "Sites");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(r.settings), "Settings");
    return wb;
  }
  function toJSON(net) {
    var o = { format: "tierwise-network", version: 1, product: net.product, config: net.config, bom: net.bom };
    if (net.tiers) o.tiers = net.tiers;
    o.sites = net.sites;
    return JSON.stringify(o, null, 1);
  }
  return { COLS: COLS, SETTINGS: SETTINGS, splitCSV: splitCSV, number: number, monthIndex: monthIndex, monthText: monthText, fromRows: fromRows, fromCSV: fromCSV,
    fromWorkbook: fromWorkbook, fromJSON: fromJSON, load: load, toRows: toRows, toCSV: toCSV, toWorkbook: toWorkbook, toJSON: toJSON };
});
