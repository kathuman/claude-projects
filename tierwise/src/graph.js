// Tierwise — editing a network as a graph (window.TWGraph / module.exports). Pure functions on the network object the
// planner uses: sites are nodes in six tiers, each supplier lane (site.suppliers[]) is a transport route from a site of
// the tier directly above. Also: the order of sites in each tier's column of the diagram (fewer crossing routes), the
// problems the diagram flags on each site, custom parameters (their definitions in net.params, their values in
// site.custom and lane.custom; descriptive: the plan does not use them) and an undo history.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./plan.js"));
  else root.TWGraph = factory(root.TWPlan);
})(typeof self !== "undefined" ? self : this, function (P) {
  "use strict";
  var TIERS = P.TIERS, TI = P.TIER_INDEX;
  var PREFIX = { market: "m", warehouse: "w", packaging: "pk", dosing: "d", product: "p", raw: "r" };
  var ROLE = { market: "consumption", warehouse: "warehouse", packaging: "production", dosing: "production", product: "production", raw: "production" };
  var MODES = ["road", "sea", "rail", "air"];
  // built-in fields a custom parameter may not take the name of (they are columns of the site table)
  var RESERVED = ["id", "tier", "name", "country", "lat", "lon", "base", "growth", "longGrowth", "season", "launch", "ramp", "capacity", "handling", "cover", "lead", "release", "yield",
    "suppliers", "expansions", "outages", "priority", "order", "from", "to", "share", "days", "mode"];
  var TYPES = ["number", "text", "bool", "choice"];

  function byId(net, id) { for (var i = 0; i < net.sites.length; i++) if (net.sites[i].id === id) return net.sites[i]; return null; }
  function sitesOf(net, tier) { return net.sites.filter(function (s) { return s.tier === tier; }); }
  function above(tier) { var i = TI[tier]; return i < TIERS.length - 1 ? TIERS[i + 1].id : null; }
  function below(tier) { var i = TI[tier]; return i > 0 ? TIERS[i - 1].id : null; }
  function role(tier) { return ROLE[tier]; }
  function uid(net, tier) { var p = PREFIX[tier] || "s", i = 1; while (byId(net, p + "-" + i)) i++; return p + "-" + i; }

  // ---- sites
  // a new site in a tier: its parameters copied from a neighbour in the tier (or sensible defaults), supplied by the
  // first site of the tier above, at the position given (an index in the column)
  function addSite(net, tier, o) {
    o = o || {};
    if (TI[tier] == null) throw new Error("Unknown tier " + tier);
    var like = sitesOf(net, tier)[0], s = like ? JSON.parse(JSON.stringify(like)) : {};
    ["expansions", "outages", "launch", "custom", "ui", "suppliers"].forEach(function (k) { delete s[k]; });
    s.id = o.id && !byId(net, o.id) ? o.id : uid(net, tier); s.tier = tier; s.name = o.name || s.id; s.country = o.country != null ? o.country : s.country || "";
    if (o.lat != null) s.lat = o.lat; else if (s.lat == null) s.lat = 0;
    if (o.lon != null) s.lon = o.lon; else if (s.lon == null) s.lon = 0;
    if (tier === "market") { if (s.base == null) s.base = 1000; if (s.growth == null) s.growth = 0; if (s.season == null) s.season = 0; }
    else if (s.capacity == null) s.capacity = 1000;
    if (tier === "warehouse") { if (s.handling == null) s.handling = 1; }
    else if (tier !== "market") { if (s.lead == null) s.lead = 0; if (s.release == null) s.release = 0; if (s.yield == null) s.yield = 100; }
    var up = above(tier);
    if (up) { var u = sitesOf(net, up)[0]; s.suppliers = u && o.supplier !== false ? [{ from: u.id, share: 100 }] : []; }
    defaults(net, s, "sites");
    net.sites.push(s);
    if (o.index != null) place(net, s.id, o.index);
    return s;
  }
  function removeSite(net, id) {
    var had = !!byId(net, id);
    net.sites = net.sites.filter(function (s) { return s.id !== id; });
    net.sites.forEach(function (s) { if (s.suppliers) s.suppliers = s.suppliers.filter(function (l) { return l.from !== id; }); });
    return had;
  }
  // a new id for a site, carried through every route that names it
  function renameId(net, id, to) {
    to = String(to || "").trim();
    if (!to || to === id || byId(net, to) || !byId(net, id)) return false;
    byId(net, id).id = to;
    net.sites.forEach(function (s) { (s.suppliers || []).forEach(function (l) { if (l.from === id) l.from = to; }); });
    return true;
  }

  // ---- routes
  function lane(net, from, to) { var s = byId(net, to); if (!s) return null; var l = (s.suppliers || []).filter(function (x) { return x.from === from; }); return l[0] || null; }
  function canConnect(net, from, to) {
    var a = byId(net, from), b = byId(net, to);
    if (!a || !b) return { ok: false, reason: "missing" };
    if (from === to) return { ok: false, reason: "self" };
    if (above(b.tier) !== a.tier) return { ok: false, reason: "tier" };
    if (lane(net, from, to)) return { ok: false, reason: "exists" };
    return { ok: true };
  }
  // a new route takes an equal share of what the site buys (shares are normalised, so the others keep their proportions)
  function connect(net, from, to, o) {
    var c = canConnect(net, from, to); if (!c.ok) return c;
    var s = byId(net, to), sup = s.suppliers = s.suppliers || [], live = sup.filter(function (l) { return l.share > 0; });
    var share = o && o.share > 0 ? o.share : live.length ? live.reduce(function (a, l) { return a + l.share; }, 0) / live.length : 100;
    var l = { from: from, share: +share.toFixed(6) };
    if (o && o.days != null) l.days = o.days;
    if (o && o.mode) l.mode = o.mode;
    defaults(net, l, "routes");
    sup.push(l);
    return { ok: true, lane: l };
  }
  function disconnect(net, from, to) { var s = byId(net, to); if (!s || !s.suppliers) return false; var n = s.suppliers.length; s.suppliers = s.suppliers.filter(function (l) { return l.from !== from; }); return s.suppliers.length < n; }
  function routes(net) { var out = []; net.sites.forEach(function (s) { (s.suppliers || []).forEach(function (l) { out.push({ from: l.from, to: s.id, lane: l }); }); }); return out; }
  // the mode a route shows: its own, or the planner's estimate (road within 1,500 km, sea beyond)
  function modeOf(net, from, to) {
    var l = lane(net, from, to); if (l && l.mode) return l.mode;
    var a = byId(net, from), b = byId(net, to); return a && b && P.distanceKm(a, b) > 1500 ? "sea" : "road";
  }

  // ---- the columns of the diagram: each tier's sites, in the order saved with the network (site.ui.order) or, where
  // none is saved, ordered to cross fewer routes (barycentres against the neighbouring columns, a few sweeps)
  function columns(net) {
    var cols = {}; TIERS.forEach(function (t) { cols[t.id] = sitesOf(net, t.id).map(function (s) { return s.id; }); });
    var pos = {}; function index() { TIERS.forEach(function (t) { cols[t.id].forEach(function (id, i) { pos[id] = i; }); }); }
    index();
    var fixed = {}; TIERS.forEach(function (t) { var ss = sitesOf(net, t.id); fixed[t.id] = ss.length > 0 && ss.every(function (s) { return s.ui && isFinite(s.ui.order); }); });
    var nb = {}; net.sites.forEach(function (s) { nb[s.id] = []; });
    routes(net).forEach(function (r) { if (nb[r.from] && nb[r.to]) { nb[r.from].push(r.to); nb[r.to].push(r.from); } });
    function sweep(order) {
      order.forEach(function (tid) {
        if (fixed[tid]) return;
        var list = cols[tid].slice(), bc = {};
        list.forEach(function (id) { var n = nb[id]; bc[id] = n.length ? n.reduce(function (a, x) { return a + pos[x]; }, 0) / n.length : pos[id]; });
        list.sort(function (a, b) { return bc[a] - bc[b] || pos[a] - pos[b]; });
        cols[tid] = list; index();
      });
    }
    var ids = TIERS.map(function (t) { return t.id; });
    for (var k = 0; k < 4; k++) { sweep(ids.slice().reverse()); sweep(ids); }
    TIERS.forEach(function (t) { if (fixed[t.id]) cols[t.id] = sitesOf(net, t.id).slice().sort(function (a, b) { return a.ui.order - b.ui.order; }).map(function (s) { return s.id; }); });
    return cols;
  }
  // moves a site to a position in its column, and saves the order of the whole column
  function place(net, id, index) {
    var s = byId(net, id); if (!s) return false;
    var col = columns(net)[s.tier].filter(function (x) { return x !== id; });
    index = Math.max(0, Math.min(col.length, Math.round(index)));
    col.splice(index, 0, id);
    col.forEach(function (x, i) { var t = byId(net, x); t.ui = t.ui || {}; t.ui.order = i; });
    return true;
  }
  function crossings(net, cols) {
    cols = cols || columns(net);
    var pos = {}; TIERS.forEach(function (t) { cols[t.id].forEach(function (id, i) { pos[id] = i; }); });
    var n = 0, rs = routes(net);
    for (var i = 0; i < rs.length; i++) for (var j = i + 1; j < rs.length; j++) {
      var a = rs[i], b = rs[j]; if (byId(net, a.to).tier !== byId(net, b.to).tier) continue;
      if ((pos[a.from] - pos[b.from]) * (pos[a.to] - pos[b.to]) < 0) n++;
    }
    return n;
  }

  // ---- what is wrong, site by site: { id, level: "error" | "warning", code, … }
  function issues(net) {
    var out = [], seen = {};
    net.sites.forEach(function (s) {
      if (seen[s.id]) out.push({ id: s.id, level: "error", code: "duplicate" }); seen[s.id] = 1;
      if (TI[s.tier] == null) { out.push({ id: s.id, level: "error", code: "tier" }); return; }
      if (!(isFinite(s.lat) && isFinite(s.lon) && s.lat !== null && s.lon !== null && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180)) out.push({ id: s.id, level: "error", code: "location" });
      if (s.tier !== "raw") {
        var live = (s.suppliers || []).filter(function (l) { return l.share > 0; });
        if (!live.length) out.push({ id: s.id, level: "error", code: "nosupplier" });
        live.forEach(function (l) { var u = byId(net, l.from); if (!u) out.push({ id: s.id, level: "error", code: "unknown", from: l.from }); else if (u.tier !== above(s.tier)) out.push({ id: s.id, level: "error", code: "wrongtier", from: l.from }); });
      }
      if (s.tier === "market") { if (!(s.base >= 0)) out.push({ id: s.id, level: "error", code: "demand" }); }
      else {
        if (!(s.capacity >= 0)) out.push({ id: s.id, level: "error", code: "capacity" });
        if (s.yield != null && !(s.yield > 0 && s.yield <= 100)) out.push({ id: s.id, level: "error", code: "yield" });
        ["lead", "release"].forEach(function (k) { if (s[k] != null && !(s[k] >= 0)) out.push({ id: s.id, level: "error", code: k }); });
        // a site no one buys from carries no load: allowed, but worth knowing
        var buys = net.sites.some(function (x) { return (x.suppliers || []).some(function (l) { return l.from === s.id && l.share > 0; }); });
        if (!buys) out.push({ id: s.id, level: "warning", code: "unused" });
      }
    });
    if (!net.sites.some(function (s) { return s.tier === "market"; })) out.push({ id: null, level: "error", code: "nomarket" });
    return out;
  }

  // ---- custom parameters (descriptive)
  // a plain key for a label, safe as a column header: accents and subscripts folded (CO₂ → co2, Ålborg → alborg)
  function key(label) {
    var k = String(label || "").trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/æ/gi, "ae").replace(/ø/gi, "oe").replace(/ß/g, "ss")
      .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return k || "param";
  }
  function params(net, applies) { return (net.params || []).filter(function (d) { return !applies || d.applies === applies; }); }
  function applies(def, site) { return def.applies === "sites" && (!def.tiers || !def.tiers.length || def.tiers.indexOf(site.tier) >= 0); }
  // checks a definition and adds it; returns { ok, def } or { ok: false, reason }
  function addParam(net, d) {
    d = d || {};
    var def = { key: d.key ? key(d.key) : key(d.label), label: String(d.label || d.key || "").trim(), type: TYPES.indexOf(d.type) >= 0 ? d.type : "text", applies: d.applies === "routes" ? "routes" : "sites" };
    if (!def.label) return { ok: false, reason: "label" };
    if (RESERVED.indexOf(def.key) >= 0 || RESERVED.map(function (x) { return x.toLowerCase(); }).indexOf(def.key) >= 0) return { ok: false, reason: "reserved" };
    if ((net.params || []).some(function (x) { return x.key === def.key; })) return { ok: false, reason: "exists" };
    if (d.unit) def.unit = String(d.unit).trim();
    if (def.type === "choice") { def.options = (Array.isArray(d.options) ? d.options : String(d.options || "").split(/[|,;]/)).map(function (x) { return String(x).trim(); }).filter(Boolean); if (!def.options.length) return { ok: false, reason: "options" }; }
    if (def.applies === "sites" && d.tiers && d.tiers.length) def.tiers = d.tiers.filter(function (t) { return TI[t] != null; });
    if (d.default != null && d.default !== "") { var c = coerce(def, d.default); if (c.ok) def.default = c.value; }
    (net.params = net.params || []).push(def);
    net.sites.forEach(function (s) { defaults(net, s, "sites"); if (def.applies === "routes") (s.suppliers || []).forEach(function (l) { defaults(net, l, "routes"); }); });
    return { ok: true, def: def };
  }
  function removeParam(net, k) {
    var n = (net.params || []).length;
    net.params = (net.params || []).filter(function (d) { return d.key !== k; });
    if (!net.params.length) delete net.params;
    net.sites.forEach(function (s) { if (s.custom) { delete s.custom[k]; if (!Object.keys(s.custom).length) delete s.custom; } (s.suppliers || []).forEach(function (l) { if (l.custom) { delete l.custom[k]; if (!Object.keys(l.custom).length) delete l.custom; } }); });
    return (net.params || []).length < n;
  }
  // a value as its parameter's type: number, text, yes/no (accepting yes/no, true/false, 1/0, sí, ja…), or one of the choices
  function coerce(def, raw) {
    if (raw == null || raw === "") return { ok: true, value: null };
    var s = String(raw).trim();
    if (def.type === "number") { var n = typeof raw === "number" ? raw : parseFloat(s.replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, "")); return isFinite(n) ? { ok: true, value: n } : { ok: false }; }
    if (def.type === "bool") { if (raw === true || /^(yes|y|true|1|sí|si|ja|x)$/i.test(s)) return { ok: true, value: true }; if (raw === false || /^(no|n|false|0|nej)$/i.test(s)) return { ok: true, value: false }; return { ok: false }; }
    if (def.type === "choice") { var m = (def.options || []).filter(function (o) { return o.toLowerCase() === s.toLowerCase(); }); return m.length ? { ok: true, value: m[0] } : { ok: false }; }
    return { ok: true, value: s };
  }
  function setCustom(target, def, raw) {
    var c = coerce(def, raw); if (!c.ok) return false;
    if (c.value == null) { if (target.custom) { delete target.custom[def.key]; if (!Object.keys(target.custom).length) delete target.custom; } }
    else (target.custom = target.custom || {})[def.key] = c.value;
    return true;
  }
  // a new site or route gets the default of every parameter that applies to it
  function defaults(net, target, kind) {
    params(net, kind).forEach(function (d) {
      if (d.default == null) return;
      if (kind === "sites" && !applies(d, target)) return;
      if (!target.custom || target.custom[d.key] == null) (target.custom = target.custom || {})[d.key] = d.default;
    });
  }

  // ---- undo history: snapshots of the network, taken before each change
  function history(limit) {
    limit = limit || 60;
    var back = [], fwd = [];
    return {
      record: function (net) { back.push(JSON.stringify(net)); if (back.length > limit) back.shift(); fwd = []; },
      undo: function (net) { if (!back.length) return null; fwd.push(JSON.stringify(net)); return JSON.parse(back.pop()); },
      redo: function (net) { if (!fwd.length) return null; back.push(JSON.stringify(net)); return JSON.parse(fwd.pop()); },
      canUndo: function () { return back.length > 0; }, canRedo: function () { return fwd.length > 0; },
      clear: function () { back = []; fwd = []; }
    };
  }
  return { MODES: MODES, TYPES: TYPES, RESERVED: RESERVED, ROLE: ROLE, role: role, above: above, below: below, byId: byId, sitesOf: sitesOf, uid: uid,
    addSite: addSite, removeSite: removeSite, renameId: renameId, lane: lane, canConnect: canConnect, connect: connect, disconnect: disconnect, routes: routes, modeOf: modeOf,
    columns: columns, place: place, crossings: crossings, issues: issues, key: key, params: params, applies: applies, addParam: addParam, removeParam: removeParam,
    coerce: coerce, setCustom: setCustom, defaults: defaults, history: history };
});
