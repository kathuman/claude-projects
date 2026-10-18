// Tierwise — loading and saving a supply chain (window.TWIO / module.exports). A network travels as:
//   CSV    a table of sites (one row each, columns below), then optionally a table of routes (headed from,to,…) and a
//          "setting,value" table; comma, semicolon or tab separated; with a semicolon, decimal commas are read
//          (1.000,5 = one thousand and a half)
//   Excel  a workbook with a "Sites" sheet and optional "Routes" and "Settings" sheets, same columns (SheetJS)
//   JSON   the network as Tierwise holds it
// Months in files are calendar months: launch, expansions and outages are written YYYY-MM (or a month number from the
// start of the plan, 0 = the first month); startMonth, demandPeak and rawPeak are 1–12. Messages are in English and
// name the row they come from. Routes can also be written in the site table's suppliers column (id:share[:days] | …);
// a routes table, if there is one, replaces it. Columns the site or routes table does not know become custom
// parameters (number, yes/no or text, guessed from their values); their definitions travel in the settings as
// param.<key>.label / type / unit / applies / tiers / options / default. Pure: no DOM.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./plan.js"), require("./network.js"), require("./graph.js"));
  else root.TWIO = factory(root.TWPlan, root.TWNetwork, root.TWGraph);
})(typeof self !== "undefined" ? self : this, function (P, N, G) {
  "use strict";
  // the columns written for a site (the suppliers column is read, but routes are written as their own table)
  var COLS = ["id", "tier", "name", "country", "lat", "lon", "base", "growth", "longGrowth", "season", "launch", "ramp", "priority",
    "capacity", "handling", "cover", "lead", "release", "yield", "expansions", "outages", "candidates", "order"];
  var RCOLS = ["from", "to", "share", "days", "mode"];
  var NUM = { lat: 1, lon: 1, base: 1, growth: 1, longGrowth: 1, season: 1, ramp: 1, priority: 1, capacity: 1, handling: 1, cover: 1, lead: 1, release: 1, yield: 1 };
  var ALIAS = {
    id: "id", siteid: "id", code: "id", tier: "tier", type: "tier", level: "tier", name: "name", site: "name", sitename: "name", country: "country",
    lat: "lat", latitude: "lat", lon: "lon", lng: "lon", long: "lon", longitude: "lon",
    base: "base", demand: "base", basedemand: "base", growth: "growth", longgrowth: "longGrowth", longtermgrowth: "longGrowth", growthlong: "longGrowth",
    season: "season", seasonswing: "season", seasonality: "season", launch: "launch", ramp: "ramp", rampmonths: "ramp",
    capacity: "capacity", cap: "capacity", handling: "handling", handlingdays: "handling", cover: "cover", coverweeks: "cover", safetystock: "cover",
    lead: "lead", leadtime: "lead", leaddays: "lead", release: "release", releasetime: "release", releasedays: "release", yield: "yield",
    suppliers: "suppliers", sourcing: "suppliers", sources: "suppliers", supplier: "suppliers", expansions: "expansions", expansion: "expansions", outages: "outages", outage: "outages",
    candidates: "candidates", candidate: "candidates", candidateexpansions: "candidates",
    priority: "priority", order: "order", position: "order"
  };
  var RALIAS = { from: "from", supplier: "from", source: "from", origin: "from", to: "to", customer: "to", destination: "to", site: "to", share: "share", percent: "share",
    days: "days", transit: "days", transitdays: "days", leadtime: "days", mode: "mode", transport: "mode", transportmode: "mode" };
  var MODE_ALIAS = { road: "road", truck: "road", lorry: "road", carretera: "road", vej: "road", sea: "sea", ship: "sea", ocean: "sea", maritime: "sea", mar: "sea", "søvej": "sea", rail: "rail", train: "rail", tren: "rail", "tog": "rail", air: "air", plane: "air", "aéreo": "air", aereo: "air", fly: "air" };
  var TIER_ALIAS = {
    market: "market", markets: "market", consumption: "market", consumptionpoint: "market", consumptionpoints: "market", customer: "market", customers: "market", demand: "market",
    warehouse: "warehouse", warehouses: "warehouse", dc: "warehouse", distribution: "warehouse", distributioncentre: "warehouse", distributioncenter: "warehouse",
    packaging: "packaging", packer: "packaging", packing: "packaging", packagingcmo: "packaging",
    dosing: "dosing", finaldosing: "dosing", filling: "dosing", dosingcmo: "dosing",
    product: "product", manufacturing: "product", productmanufacturing: "product", productcmo: "product",
    raw: "raw", rawingredient: "raw", rawingredients: "raw", ingredient: "raw", ingredients: "raw", rawcmo: "raw"
  };
  var SETTINGS = ["product", "startYear", "startMonth", "cover", "demandPeak", "rawPeak", "rawSeasonMax", "demandScale", "packPerUnit", "kgPerSachet", "rawPerProduct", "packValue", "discountRate", "currency"];
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
  function blank(r) { return !r || !r.some(function (c) { return String(c == null ? "" : c).trim(); }); }
  // a column's values decide the type of a parameter created from it: numbers, yes/no, or text
  function guessType(vals, euro) {
    var v = vals.filter(function (x) { return String(x == null ? "" : x).trim() !== ""; });
    if (!v.length) return "text";
    if (v.every(function (x) { var n = number(x, euro); return n != null && isFinite(n); })) return "number";
    if (v.every(function (x) { return x === true || x === false || /^(yes|no|y|n|true|false|sí|si|ja|nej)$/i.test(String(x).trim()); })) return "bool";
    return "text";
  }
  function setValue(target, def, raw, euro, where, errors) {
    if (raw == null || String(raw).trim() === "") return;
    var v = def.type === "number" && typeof raw !== "number" ? number(raw, euro) : raw;
    if (def.type === "number" && !isFinite(v)) { errors.push(where + ": “" + raw + "” is not a valid value for " + def.label + "."); return; }
    if (!G.setCustom(target, def, v)) errors.push(where + ": “" + raw + "” is not a valid value for " + def.label + ".");
  }
  function fromRows(siteRows, settingRows, euro, routeRows, routeOffset) {
    var errors = [], warnings = [], ex = N.base();
    var net = { product: ex.product, config: Object.assign({}, ex.config, { demandScale: 1 }), bom: Object.assign({}, ex.bom), tiers: {}, sites: [] };
    var pdefs = {}, porder = [];
    // settings first: they set the calendar that dates in the site table refer to, and the custom parameters
    (settingRows || []).forEach(function (r, i) {
      var k = String(r[0] == null ? "" : r[0]).trim(), v = r[1];
      if (!k || /^(setting|key)$/i.test(k) || /^#/.test(k)) return;
      var pm = k.match(/^param\.([^.]+)\.(\w+)$/i);
      if (pm) {
        var pk = G.key(pm[1]); if (!pdefs[pk]) { pdefs[pk] = { key: pk }; porder.push(pk); }
        var f = pm[2].toLowerCase(), val = v == null ? "" : String(v).trim();
        if (f === "tiers") pdefs[pk].tiers = val ? val.split(/[|,;]/).map(function (t) { return TIER_ALIAS[key(t)]; }).filter(Boolean) : [];
        else if (f === "options") pdefs[pk].options = val;
        else if (["label", "type", "unit", "applies", "default"].indexOf(f) >= 0) pdefs[pk][f] = val;
        else warnings.push("Setting “" + k + "” is not used.");
        return;
      }
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
      if (sk === "currency") { net.config.currency = String(v == null ? "" : v).trim() || "$"; return; }
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
    porder.forEach(function (pk) {
      var d = pdefs[pk], r = G.addParam(net, { key: pk, label: d.label || pk, type: d.type, unit: d.unit, applies: d.applies, tiers: d.tiers, options: d.options, default: d.default });
      if (!r.ok) errors.push("The custom parameter “" + (d.label || pk) + "” cannot be used (" + r.reason + ").");
    });
    var cfg = net.config;
    // the header row of the site table
    var h = -1;
    for (var i = 0; i < siteRows.length; i++) { var ks = siteRows[i].map(function (c) { return ALIAS[key(c)]; }); if (ks.indexOf("id") >= 0 && ks.indexOf("tier") >= 0) { h = i; break; } }
    if (h < 0) return { ok: false, errors: ["No header row with the columns id and tier was found."], warnings: warnings };
    // known columns, custom parameters already defined, and new ones made from columns no one knows
    var cols = siteRows[h].map(function (c) {
      var t = String(c == null ? "" : c).trim(), k = ALIAS[key(c)];
      if (k) return { k: k };
      if (!t) return null;
      var d = G.params(net, "sites").filter(function (x) { return x.key === G.key(t) || x.label === t; })[0];
      return d ? { d: d } : { fresh: t };
    });
    var body = siteRows.slice(h + 1);
    cols.forEach(function (c, j) {
      if (!c || !c.fresh) return;
      var r = G.addParam(net, { label: c.fresh, type: guessType(body.map(function (row) { return row[j]; }), euro) });
      if (r.ok) { c.d = r.def; warnings.push("Column “" + c.fresh + "” is kept as a custom parameter."); } else warnings.push("Column “" + c.fresh + "” is not used.");
      delete c.fresh;
    });
    for (i = h + 1; i < siteRows.length; i++) {
      var r = siteRows[i], rowNo = i + 1;
      if (blank(r)) continue;
      if (/^(setting|key)$/i.test(String(r[0]).trim())) break;
      var o = {}, s = {}, cv = [];
      cols.forEach(function (c, j) { if (!c) return; if (c.k) o[c.k] = r[j]; else if (c.d) cv.push([c.d, r[j]]); });
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
      if (o.order != null && String(o.order).trim() !== "") { var od = number(o.order, euro); if (isFinite(od)) s.ui = { order: od }; }
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
      if (o.candidates != null && String(o.candidates).trim() !== "") {
        s.candidates = [];
        String(o.candidates).split("|").forEach(function (part, ci) {
          part = part.trim(); if (!part) return;
          var a = part.split(":").map(function (x) { return x.trim(); });
          var label = a[0], add = number(a[1] || "", euro), capex = number(a[2] || "", euro), build = a.length > 3 ? number(a[3], euro) : 0, qualify = a.length > 4 ? number(a[4], euro) : 0;
          if (!label || !isFinite(add) || !isFinite(capex)) { errors.push("Row " + rowNo + ": cannot read the candidate expansion “" + part + "” (write label:add:capex:build:qualify)."); return; }
          s.candidates.push({ id: "c" + (ci + 1), label: label, add: add, capex: capex, build: isFinite(build) ? build : 0, qualify: isFinite(qualify) ? qualify : 0 });
        });
      }
      if (tier === "market") { if (s.growth == null) s.growth = 0; if (s.season == null) s.season = 0; }
      else if (s.capacity == null) errors.push("Row " + rowNo + ": " + s.id + " needs a capacity.");
      G.defaults(net, s, "sites");
      cv.forEach(function (x) { if (G.applies(x[0], s) || (x[1] != null && String(x[1]).trim() !== "")) setValue(s, x[0], x[1], euro, "Row " + rowNo, errors); });
      net.sites.push(s);
    }
    if (!net.sites.length && !errors.length) errors.push("The file has no sites.");
    // the routes table, if there is one: it replaces the suppliers column
    if (routeRows && routeRows.length) readRoutes(net, routeRows, euro, errors, warnings, routeOffset || 0);
    if (!errors.length) P.validate(net).forEach(function (e) { errors.push(e); });
    return { ok: !errors.length, errors: errors, warnings: warnings, net: errors.length ? null : net };
  }
  function readRoutes(net, rows, euro, errors, warnings, offset) {
    var h = -1;
    for (var i = 0; i < rows.length; i++) { var ks = rows[i].map(function (c) { return RALIAS[key(c)]; }); if (ks.indexOf("from") >= 0 && ks.indexOf("to") >= 0) { h = i; break; } }
    if (h < 0) { errors.push("The routes table needs the columns from and to."); return; }
    var byId = {}; net.sites.forEach(function (s) { byId[s.id] = s; });
    var cols = rows[h].map(function (c) {
      var t = String(c == null ? "" : c).trim(), k = RALIAS[key(c)];
      if (k) return { k: k };
      if (!t) return null;
      var d = G.params(net, "routes").filter(function (x) { return x.key === G.key(t) || x.label === t; })[0];
      if (d) return { d: d };
      var r = G.addParam(net, { label: t, type: guessType(rows.slice(h + 1).map(function (row) { return row[rows[h].indexOf(c)]; }), euro), applies: "routes" });
      if (r.ok) { warnings.push("Column “" + t + "” is kept as a custom parameter."); return { d: r.def }; }
      warnings.push("Column “" + t + "” is not used."); return null;
    });
    var fresh = {}, replaced = false;
    for (i = h + 1; i < rows.length; i++) {
      var r = rows[i], no = offset + i + 1; if (blank(r)) continue;
      if (/^(setting|key)$/i.test(String(r[0]).trim())) break;
      var o = {}, cv = [];
      cols.forEach(function (c, j) { if (!c) return; if (c.k) o[c.k] = r[j]; else cv.push([c.d, r[j]]); });
      var from = String(o.from == null ? "" : o.from).trim(), to = String(o.to == null ? "" : o.to).trim();
      if (!byId[from] || !byId[to]) { errors.push("Route row " + no + ": the site “" + (!byId[from] ? from : to) + "” is not in the site table."); continue; }
      var share = o.share == null || String(o.share).trim() === "" ? 100 : number(o.share, euro), days = o.days == null || String(o.days).trim() === "" ? null : number(o.days, euro);
      if (!isFinite(share) || share < 0) { errors.push("Route row " + no + ": cannot read the share “" + o.share + "”."); continue; }
      if (days != null && !(isFinite(days) && days >= 0)) { errors.push("Route row " + no + ": cannot read the transit days “" + o.days + "”."); continue; }
      var l = { from: from, share: share }; if (days != null) l.days = days;
      if (o.mode != null && String(o.mode).trim() !== "") { var md = MODE_ALIAS[String(o.mode).trim().toLowerCase()]; if (!md) { errors.push("Route row " + no + ": unknown mode “" + o.mode + "” (road, sea, rail or air)."); continue; } l.mode = md; }
      G.defaults(net, l, "routes");
      cv.forEach(function (x) { setValue(l, x[0], x[1], euro, "Route row " + no, errors); });
      if (!fresh[to]) { fresh[to] = []; if ((byId[to].suppliers || []).length) replaced = true; }
      fresh[to].push(l);
    }
    Object.keys(fresh).forEach(function (id) { byId[id].suppliers = fresh[id]; });
    if (replaced) warnings.push("The routes table replaces the suppliers column.");
  }
  // a table's rows split into its sections: sites, then routes (a header with from and to), then settings
  function sections(rows) {
    var sh = -1, rh = -1, st = -1;
    for (var i = 0; i < rows.length; i++) {
      var ks = rows[i].map(function (c) { return key(c); });
      if (sh < 0 && rows[i].some(function (c) { return ALIAS[key(c)] === "id"; }) && rows[i].some(function (c) { return ALIAS[key(c)] === "tier"; })) { sh = i; continue; }
      if (st < 0 && /^(setting|key)$/i.test(String(rows[i][0] == null ? "" : rows[i][0]).trim())) { st = i; continue; }
      if (sh >= 0 && rh < 0 && st < 0 && ks.some(function (k) { return RALIAS[k] === "from"; }) && ks.some(function (k) { return RALIAS[k] === "to"; }) && !ks.some(function (k) { return ALIAS[k] === "tier"; })) rh = i;
    }
    var end = function (from) { var c = [rh, st].filter(function (x) { return x > from; }); return c.length ? Math.min.apply(null, c) : rows.length; };
    return { sites: rows.slice(0, sh >= 0 ? end(sh) : rows.length), routes: rh >= 0 ? rows.slice(rh, end(rh)) : [], routesAt: Math.max(0, rh), settings: st >= 0 ? rows.slice(st) : [] };
  }
  function fromCSV(text) {
    var sp = splitCSV(text), sec = sections(sp.rows);
    return fromRows(sec.sites, sec.settings, sp.delim === ";", sec.routes, sec.routesAt);
  }
  // a SheetJS workbook: the "Sites" sheet (or the first), and optional "Routes" and "Settings" sheets
  function fromWorkbook(wb, XLSX) {
    var names = wb.SheetNames || [], pick = function (re) { for (var i = 0; i < names.length; i++) if (re.test(names[i])) return names[i]; return null; };
    var sn = pick(/^(sites?|network|sitios|lokationer|steder)$/i) || names[0], rn = pick(/^(routes?|lanes?|rutas?|ruter)$/i), st = pick(/^(settings?|ajustes|configuraci[oó]n|indstillinger)$/i);
    if (!sn) return { ok: false, errors: ["The workbook has no sheets."], warnings: [] };
    var rows = function (n) { return XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" }); };
    var sec = sections(rows(sn));
    var routes = rn && rn !== sn ? rows(rn) : sec.routes, settings = st && st !== sn ? rows(st) : sec.settings;
    return fromRows(sec.sites, settings, false, routes, rn && rn !== sn ? 0 : sec.routesAt);
  }
  function fromJSON(text) {
    var o; try { o = typeof text === "string" ? JSON.parse(text) : text; } catch (e) { return { ok: false, errors: ["The file is not valid JSON."], warnings: [] }; }
    if (!o || !Array.isArray(o.sites)) return { ok: false, errors: ["The JSON file has no list of sites."], warnings: [] };
    var ex = N.base();
    var net = { product: o.product != null ? String(o.product) : ex.product, config: Object.assign({}, ex.config, { demandScale: 1 }, o.config || {}), bom: Object.assign({}, ex.bom, o.bom || {}), sites: JSON.parse(JSON.stringify(o.sites)) };
    if (o.tiers) net.tiers = JSON.parse(JSON.stringify(o.tiers));
    if (Array.isArray(o.params)) net.params = JSON.parse(JSON.stringify(o.params)).filter(function (d) { return d && d.key && G.TYPES.indexOf(d.type) >= 0; });
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
    var cfg = net.config, sp = G.params(net, "sites"), rp = G.params(net, "routes");
    var cv = function (t, d) { var v = t.custom ? t.custom[d.key] : null; return v == null ? "" : d.type === "bool" ? (v ? "yes" : "no") : clean(v); };
    var sites = [COLS.concat(sp.map(function (d) { return d.key; }))];
    var order = {}, cols = G.columns(net); Object.keys(cols).forEach(function (t) { cols[t].forEach(function (id, i) { order[id] = i; }); });
    net.sites.forEach(function (s) {
      sites.push(COLS.map(function (k) {
        if (k === "expansions") return (s.expansions || []).map(function (e) { return monthText(e.from, cfg) + ":+" + clean(e.add); }).join(" | ");
        if (k === "outages") return (s.outages || []).map(function (e) { return monthText(e.from, cfg) + ":" + clean(e.months) + ":" + clean(e.loss); }).join(" | ");
        if (k === "candidates") return (s.candidates || []).map(function (c) { return [c.label, clean(c.add), clean(c.capex), clean(c.build || 0), clean(c.qualify || 0)].join(":"); }).join(" | ");
        if (k === "launch") return s.launch != null ? monthText(s.launch, cfg) : "";
        if (k === "order") return s.ui && isFinite(s.ui.order) ? clean(s.ui.order) : "";
        var v = s[k]; return v == null ? "" : clean(v);
      }).concat(sp.map(function (d) { return cv(s, d); })));
    });
    var routes = [RCOLS.concat(rp.map(function (d) { return d.key; }))];
    net.sites.forEach(function (s) {
      (s.suppliers || []).forEach(function (l) { routes.push([l.from, s.id, clean(l.share), l.days != null ? clean(l.days) : "", l.mode || ""].concat(rp.map(function (d) { return cv(l, d); }))); });
    });
    var settings = [["setting", "value"], ["product", net.product || ""], ["startYear", cfg.startYear], ["startMonth", cfg.startMonth + 1], ["cover", clean(cfg.cover)],
      ["demandPeak", cfg.demandPeak + 1], ["rawPeak", cfg.rawPeak + 1], ["rawSeasonMax", clean(cfg.rawSeasonMax)], ["demandScale", clean(cfg.demandScale != null ? cfg.demandScale : 1)],
      ["packPerUnit", clean(net.bom.packPerUnit)], ["kgPerSachet", clean(net.bom.kgPerSachet)], ["rawPerProduct", clean(net.bom.rawPerProduct)],
      ["packValue", clean(cfg.packValue || 0)], ["discountRate", clean(cfg.discountRate || 0)], ["currency", cfg.currency || "$"]];
    P.TIERS.forEach(function (t) { var o = (net.tiers || {})[t.id] || {}; TIER_KEYS.forEach(function (k) { settings.push(["tier." + t.id + "." + k, o[k] || ""]); }); });
    (net.params || []).forEach(function (d) {
      settings.push(["param." + d.key + ".label", d.label], ["param." + d.key + ".type", d.type], ["param." + d.key + ".applies", d.applies]);
      if (d.unit) settings.push(["param." + d.key + ".unit", d.unit]);
      if (d.tiers && d.tiers.length) settings.push(["param." + d.key + ".tiers", d.tiers.join(" | ")]);
      if (d.options) settings.push(["param." + d.key + ".options", d.options.join(" | ")]);
      if (d.default != null) settings.push(["param." + d.key + ".default", d.type === "bool" ? (d.default ? "yes" : "no") : d.default]);
    });
    return { sites: sites, routes: routes, settings: settings };
  }
  function csvCell(v) { var s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function toCSV(net) {
    var r = toRows(net), out = r.sites.map(function (row) { return row.map(csvCell).join(","); });
    out.push(""); r.routes.forEach(function (row) { out.push(row.map(csvCell).join(",")); });
    out.push(""); r.settings.forEach(function (row) { out.push(row.map(csvCell).join(",")); });
    return out.join("\r\n") + "\r\n";
  }
  function toWorkbook(net, XLSX) {
    var r = toRows(net), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(r.sites), "Sites");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(r.routes), "Routes");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(r.settings), "Settings");
    return wb;
  }
  function toJSON(net) {
    var o = { format: "tierwise-network", version: 1, product: net.product, config: net.config, bom: net.bom };
    if (net.tiers) o.tiers = net.tiers;
    if (net.params && net.params.length) o.params = net.params;
    o.sites = net.sites;
    return JSON.stringify(o, null, 1);
  }
  return { COLS: COLS, RCOLS: RCOLS, sections: sections, SETTINGS: SETTINGS, splitCSV: splitCSV, number: number, monthIndex: monthIndex, monthText: monthText, fromRows: fromRows, fromCSV: fromCSV,
    fromWorkbook: fromWorkbook, fromJSON: fromJSON, load: load, toRows: toRows, toCSV: toCSV, toWorkbook: toWorkbook, toJSON: toJSON };
});
