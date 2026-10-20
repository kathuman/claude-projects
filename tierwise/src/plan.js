// Tierwise — the planning engine. Turns a final-consumption forecast into time-phased capacity requirements for every
// site of a multi-tier food supply chain: raw ingredient CMOs → product manufacturing CMOs → final dosing CMOs →
// packaging CMOs → warehouses → consumption points. Each requirement is passed upstream, shifted earlier by the
// release time (QA), the production lead time and the transit time between sites, split across a node's suppliers by
// their sourcing shares, converted by the bill of materials and grossed up for yield. Planning runs month by month
// over the whole horizon (3 years monthly + 10 years yearly = 156 months); the yearly view is built from those months,
// so a seasonal peak inside a year is never averaged away. Pure: no DOM. window.TWPlan in the browser,
// module.exports in Node.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TWPlan = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MONTHLY = 36, YEARLY = 10, MONTHS = MONTHLY + 12 * YEARLY, DAYS_PER_MONTH = 30.44;
  // tiers from the consumer upstream; each tier's unit and what one unit of it needs from the tier above
  var TIERS = [
    { id: "market", name: "Consumption points", one: "Consumption point", short: "Markets", unit: "packs" },
    { id: "warehouse", name: "Warehouses", one: "Warehouse", short: "Warehouses", unit: "packs" },
    { id: "packaging", name: "Packaging CMOs", one: "Packaging CMO", short: "Packaging", unit: "packs" },
    { id: "dosing", name: "Final dosing CMOs", one: "Final dosing CMO", short: "Dosing", unit: "sachets" },
    { id: "product", name: "Product manufacturing CMOs", one: "Product manufacturing CMO", short: "Product", unit: "t" },
    { id: "raw", name: "Raw ingredient CMOs", one: "Raw ingredient CMO", short: "Raw ingredient", unit: "t" }
  ];
  var TIER_INDEX = {}; TIERS.forEach(function (t, i) { TIER_INDEX[t.id] = i; });
  // a network can rename its tiers and their units (net.tiers = { dosing: { name, one, short, unit } }); custom marks a
  // tier whose words came from the network, so the page shows them as written instead of translating them
  function tiersFor(net) {
    var o = (net && net.tiers) || {};
    return TIERS.map(function (t) {
      var x = o[t.id]; if (!x || !(x.name || x.unit || x.one || x.short)) return t;
      var name = x.name || t.name;
      return { id: t.id, name: name, one: x.one || (x.name ? name : t.one), short: x.short || (x.name ? name : t.short), unit: x.unit || t.unit,
        custom: !!x.name, customUnit: !!x.unit };
    });
  }

  // ---- geography
  function distanceKm(a, b) {
    var R = 6371, toR = Math.PI / 180, dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // transit days for a lane: by road within 1,500 km, otherwise by sea with port handling (an override wins)
  function transitDays(a, b, override) {
    if (override != null && isFinite(override)) return +override;
    var km = distanceKm(a, b);
    return km <= 1500 ? 1 + km / 500 : 10 + km / 650;
  }
  function hemisphere(lat) { return lat < 0 ? "south" : "north"; }
  // seasonal factor: a cosine around 1 with the given amplitude, peaking in peakMonth (0 = January);
  // the southern hemisphere's seasons are six months apart
  function seasonal(monthOfYear, amplitude, peakMonthNorth, lat) {
    var peak = (peakMonthNorth + (lat < 0 ? 6 : 0)) % 12;
    return 1 + amplitude * Math.cos(2 * Math.PI * (monthOfYear - peak) / 12);
  }
  // milk (and many crops) are more seasonal away from the equator: amplitude grows with latitude
  function rawSeasonAmplitude(lat, maxAmp) { return maxAmp * Math.min(1, Math.max(0, (Math.abs(lat) - 10) / 35)); }

  // ---- series helpers
  function zeros(n) { var a = new Float64Array(n); return a; }
  // value at a fractional month index; beyond the horizon the last value continues (the plan assumes it holds)
  function at(s, x) {
    var n = s.length; if (x <= 0) return s[0]; if (x >= n - 1) return s[n - 1];
    var k = Math.floor(x), f = x - k; return s[k] * (1 - f) + s[k + 1] * f;
  }
  // what is needed `months` earlier: out[m] = s[m + months] (linear between months)
  function lead(s, months) { var out = zeros(s.length); for (var m = 0; m < s.length; m++) out[m] = at(s, m + months); return out; }

  // ---- the calendar
  function periods(startYear, startMonth) {
    var out = [], names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (var m = 0; m < MONTHLY; m++) {
      var mo = (startMonth + m) % 12, yr = startYear + Math.floor((startMonth + m) / 12);
      out.push({ kind: "month", label: names[mo] + " " + String(yr).slice(2), long: names[mo] + " " + yr, from: m, to: m + 1, year: yr, month: mo });
    }
    for (var y = 0; y < YEARLY; y++) {
      var from = MONTHLY + 12 * y;
      out.push({ kind: "year", label: String(startYear + 3 + y + (startMonth > 0 ? 0 : 0)), long: "Year " + (4 + y) + " (" + labelRange(startYear, startMonth, from) + ")", from: from, to: from + 12, year: startYear + 3 + y });
    }
    return out;
    function labelRange(sy, sm, f) { var a = (sm + f) % 12, ya = sy + Math.floor((sm + f) / 12), b = (sm + f + 11) % 12, yb = sy + Math.floor((sm + f + 11) / 12); return names[a] + " " + ya + "–" + names[b] + " " + yb; }
  }

  // ---- the forecast at one consumption point, month by month over the whole horizon
  function forecast(market, cfg) {
    var s = zeros(MONTHS), g1 = market.growth / 100, g2 = (market.longGrowth != null ? market.longGrowth : market.growth) / 100;
    for (var m = 0; m < MONTHS; m++) {
      var years = m / 12, level = m < MONTHLY ? Math.pow(1 + g1, years) : Math.pow(1 + g1, MONTHLY / 12) * Math.pow(1 + g2, (m - MONTHLY) / 12);
      var mo = (cfg.startMonth + m) % 12;
      var launch = market.launch != null && market.launch > 0 ? Math.max(0, Math.min(1, (m - market.launch + 1) / Math.max(1, market.ramp || 6))) : 1;
      s[m] = market.base * level * seasonal(mo, market.season / 100, cfg.demandPeak, market.lat) * launch * (cfg.demandScale != null ? cfg.demandScale : 1);
    }
    return s;
  }
  // monthly capacity of a site over the horizon: base × seasonality (raw ingredients) + expansions from their start
  function capacity(site, cfg) {
    var s = zeros(MONTHS), amp = site.tier === "raw" ? rawSeasonAmplitude(site.lat, cfg.rawSeasonMax / 100) : 0;
    for (var m = 0; m < MONTHS; m++) {
      var c = site.capacity;
      (site.expansions || []).forEach(function (e) { if (m >= e.from) c += e.add; });
      var mo = (cfg.startMonth + m) % 12;
      s[m] = Math.max(0, c * (amp ? seasonal(mo, amp, cfg.rawPeak, site.lat) : 1));
    }
    (site.outages || []).forEach(function (o) { for (var m = o.from; m < Math.min(MONTHS, o.from + o.months); m++) s[m] *= 1 - o.loss / 100; });
    return s;
  }

  // ---- checks on a network before planning
  function validate(net) {
    var e = [], byId = {};
    if (!net || !net.sites || !net.sites.length) return ["The network has no sites."];
    net.sites.forEach(function (s) { if (!s.id) e.push((s.name || "A site") + " has no id."); if (byId[s.id]) e.push("Two sites share the id " + s.id + "."); byId[s.id] = s; if (TIER_INDEX[s.tier] == null) e.push("Unknown tier for " + s.name + "."); });
    net.sites.forEach(function (s) {
      var t = TIER_INDEX[s.tier];
      if (s.tier !== "raw") {
        var sup = (s.suppliers || []).filter(function (l) { return l.share > 0; });
        if (!sup.length) e.push(s.name + " has no supplier.");
        sup.forEach(function (l) { var u = byId[l.from]; if (!u) e.push(s.name + " is supplied by an unknown site."); else if (TIER_INDEX[u.tier] !== t + 1) e.push(s.name + " must be supplied from the tier directly above it."); });
      }
      if (s.tier !== "market" && !(s.capacity >= 0)) e.push(s.name + " needs a capacity of zero or more.");
      if (s.yield != null && !(s.yield > 0 && s.yield <= 100)) e.push(s.name + " needs a yield between 0 and 100%.");
      ["lead", "release"].forEach(function (k) { if (s[k] != null && !(s[k] >= 0)) e.push(s.name + " cannot have a negative " + (k === "lead" ? "lead time" : "release time") + "."); });
      if (s.candidates && s.candidates.length) {
        var cids = {};
        s.candidates.forEach(function (c) {
          if (!c.id) e.push(s.name + " has a candidate expansion with no id.");
          if (cids[c.id]) e.push(s.name + " has two candidate expansions with the id " + c.id + ".");
          cids[c.id] = 1;
          if (!(c.add > 0)) e.push(s.name + "'s candidate " + (c.label || c.id) + " needs capacity added greater than zero.");
          if (!(c.capex >= 0)) e.push(s.name + "'s candidate " + (c.label || c.id) + " needs a capex of zero or more.");
          if (!(c.build >= 0)) e.push(s.name + "'s candidate " + (c.label || c.id) + " needs a build time of zero or more.");
          if (!(c.qualify >= 0)) e.push(s.name + "'s candidate " + (c.label || c.id) + " needs a qualification time of zero or more.");
          if (c.opex != null && !(c.opex >= 0)) e.push(s.name + "'s candidate " + (c.label || c.id) + " needs an opex of zero or more.");
        });
      }
    });
    net.sites.forEach(function (s) { if (!(isFinite(s.lat) && isFinite(s.lon) && s.lat !== null && s.lon !== null && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180)) e.push(s.name + " needs a latitude and longitude."); });
    if (!net.sites.some(function (s) { return s.tier === "market"; })) e.push("The network needs at least one consumption point.");
    net.sites.forEach(function (s) { if (s.tier === "market" && !(s.base >= 0)) e.push(s.name + " needs a base demand of zero or more."); });
    ["packPerUnit", "kgPerSachet", "rawPerProduct"].forEach(function (k) { if (!net.bom || !(net.bom[k] > 0)) e.push("The bill of materials needs a positive " + k + "."); });
    return e;
  }

  // ---- the plan
  function plan(net) {
    var errs = validate(net); if (errs.length) return { ok: false, errors: errs };
    var cfg = net.config, byId = {}, sites = net.sites;
    sites.forEach(function (s) { byId[s.id] = s; });
    // output units of a tier per unit of the tier below (bill of materials, upstream per downstream unit)
    var bom = net.bom, per = {
      warehouse: 1, packaging: 1,
      dosing: bom.packPerUnit,                          // sachets per pack
      product: bom.kgPerSachet / 1000,                  // tonnes of product per sachet
      raw: bom.rawPerProduct                            // tonnes of raw ingredient per tonne of product
    };
    // every requirement is carried as a total and split by the consumption point it serves (the plan is linear, so the
    // parts add up exactly to the total); a supplier also keeps what each direct customer asks of it
    var mkts = sites.filter(function (s) { return s.tier === "market"; }).map(function (s) { return s.id; });
    var req = {}, part = {}, byCust = {}, load = {}, loadPart = {}, loadCust = {}, need = {}, needPart = {}, cap = {}, trans = {}, demand = {}, ssOf = {};
    sites.forEach(function (s) { req[s.id] = zeros(MONTHS); part[s.id] = {}; byCust[s.id] = {}; mkts.forEach(function (k) { part[s.id][k] = zeros(MONTHS); }); });
    // 1. consumption points: their forecast is what must arrive there each month
    sites.filter(function (s) { return s.tier === "market"; }).forEach(function (s) { demand[s.id] = forecast(s, cfg); req[s.id] = demand[s.id]; part[s.id][s.id] = demand[s.id]; });
    // one site's transformation of a requirement r: what it must handle (load) and what it must receive (need)
    function step(s, r) {
      var y = (s.yield != null ? s.yield : 100) / 100, m;
      if (s.tier === "market") return { load: null, need: r };
      if (s.tier === "warehouse") {
        // a warehouse ships what its markets need and builds or draws safety stock (cover in weeks of coming demand)
        var cover = (s.cover != null ? s.cover : cfg.cover) / (DAYS_PER_MONTH / 7);
        var ss = zeros(MONTHS); for (m = 0; m < MONTHS; m++) ss[m] = at(r, m + cover / 2) * cover;
        var inbound = zeros(MONTHS); for (m = 0; m < MONTHS; m++) inbound[m] = r[m] + (m ? ss[m] - ss[m - 1] : 0);
        return { load: r, need: lead(inbound, (s.handling || 0) / DAYS_PER_MONTH), ss: ss };
      }
      // a CMO: output released in month m was made release-time earlier, gross of yield; its inputs arrive lead-time earlier still
      var made = lead(r, (s.release || 0) / DAYS_PER_MONTH); for (m = 0; m < MONTHS; m++) made[m] /= y;
      return { load: made, need: lead(made, (s.lead || 0) / DAYS_PER_MONTH) };
    }
    // 2. tier by tier upstream
    for (var t = 0; t < TIERS.length; t++) {
      var tier = TIERS[t].id;
      sites.filter(function (s) { return s.tier === tier; }).forEach(function (s) {
        var st = step(s, req[s.id]);
        need[s.id] = st.need; needPart[s.id] = {};
        if (tier !== "market") {
          load[s.id] = st.load; cap[s.id] = capacity(s, cfg); if (st.ss) ssOf[s.id] = st.ss;
          loadPart[s.id] = {}; loadCust[s.id] = {};
          mkts.forEach(function (k) { var sp = step(s, part[s.id][k]); loadPart[s.id][k] = sp.load; needPart[s.id][k] = sp.need; });
          Object.keys(byCust[s.id]).forEach(function (c) { loadCust[s.id][c] = step(s, byCust[s.id][c]).load; });
        } else mkts.forEach(function (k) { needPart[s.id][k] = part[s.id][k]; });
        if (tier === "raw") return;
        // what this site needs from each supplier, shifted earlier by the lane's transit and converted to the supplier's unit
        var sup = (s.suppliers || []).filter(function (l) { return l.share > 0; }), tot = sup.reduce(function (a, l) { return a + l.share; }, 0);
        var up = TIERS[t + 1].id, factor = per[up];
        sup.forEach(function (l) {
          var u = byId[l.from], days = transitDays(u, s, l.days), f = l.share / tot * factor, sh = days / DAYS_PER_MONTH, m2;
          trans[l.from + ">" + s.id] = days;
          var need2 = lead(need[s.id], sh), add = req[l.from], mine = byCust[l.from][s.id] = zeros(MONTHS);
          for (m2 = 0; m2 < MONTHS; m2++) { add[m2] += need2[m2] * f; mine[m2] = need2[m2] * f; }
          mkts.forEach(function (k) { var n2 = lead(needPart[s.id][k], sh), dst = part[l.from][k]; for (var m3 = 0; m3 < MONTHS; m3++) dst[m3] += n2[m3] * f; });
        });
      });
    }
    // 3. per site: load against capacity, monthly and in the displayed periods
    var P = periods(cfg.startYear, cfg.startMonth), out = {};
    sites.forEach(function (s) {
      if (s.tier === "market") { out[s.id] = { site: s, demand: demand[s.id], periods: P.map(function (p) { return { value: sum(demand[s.id], p.from, p.to) / (p.to - p.from) }; }) }; return; }
      var L = load[s.id], C = cap[s.id], util = zeros(MONTHS);
      for (var m = 0; m < MONTHS; m++) util[m] = C[m] > 0 ? L[m] / C[m] : (L[m] > 0 ? Infinity : 0);
      var firstOver = -1; for (m = 0; m < MONTHS; m++) if (util[m] > 1 + 1e-9) { firstOver = m; break; }
      out[s.id] = {
        site: s, load: L, capacity: C, util: util, firstOver: firstOver, ss: ssOf[s.id] || null, byMarket: loadPart[s.id], byCustomer: loadCust[s.id],
        peakUtil: Math.max.apply(null, Array.prototype.slice.call(util)),
        periods: P.map(function (p) {
          var l = sum(L, p.from, p.to), c = sum(C, p.from, p.to), pk = 0, pkm = p.from;
          for (var k = p.from; k < p.to; k++) if (util[k] > pk) { pk = util[k]; pkm = k; }
          return { load: l / (p.to - p.from), capacity: c / (p.to - p.from), util: c > 0 ? l / c : (l > 0 ? Infinity : 0), peak: pk, peakMonth: pkm, gap: Math.max(0, l - c) };
        })
      };
    });
    return { ok: true, months: MONTHS, periods: P, sites: out, markets: mkts, transit: trans, per: per, tiers: tiersFor(net), leadChain: leadChain(net, trans) };
  }
  function sum(s, a, b) { var t = 0; for (var i = a; i < b; i++) t += s[i]; return t; }

  // the time-phasing of one consumption point: for each path upstream, when each tier must produce (days before arrival)
  function leadChain(net, trans) {
    var byId = {}; net.sites.forEach(function (s) { byId[s.id] = s; });
    var chains = {};
    net.sites.filter(function (s) { return s.tier === "market"; }).forEach(function (mkt) {
      // follow the largest share at each tier (the main path), adding transit, handling, release and lead time
      var steps = [], node = mkt, offset = 0;
      while (node && node.tier !== "raw") {
        var sup = (node.suppliers || []).filter(function (l) { return l.share > 0; }).sort(function (a, b) { return b.share - a.share; })[0];
        if (!sup) break;
        var u = byId[sup.from], days = transitDays(u, node, sup.days);
        steps.push({ kind: "transit", from: u.id, to: node.id, start: offset + days, end: offset, days: days });
        offset += days;
        if (u.tier === "warehouse") { var h = u.handling || 0; steps.push({ kind: "handling", site: u.id, start: offset + h, end: offset, days: h }); offset += h; }
        else {
          steps.push({ kind: "release", site: u.id, start: offset + (u.release || 0), end: offset, days: u.release || 0 }); offset += u.release || 0;
          steps.push({ kind: "production", site: u.id, start: offset + (u.lead || 0), end: offset, days: u.lead || 0 }); offset += u.lead || 0;
        }
        node = u;
      }
      chains[mkt.id] = { steps: steps, total: offset };
    });
    return chains;
  }

  // a summary per tier: total load and capacity per period, and the busiest site
  function tierSummary(result, net, tier) {
    var ids = net.sites.filter(function (s) { return s.tier === tier; }).map(function (s) { return s.id; });
    return result.periods.map(function (p, i) {
      var l = 0, c = 0, pk = 0;
      ids.forEach(function (id) { var q = result.sites[id].periods[i]; l += q.load; c += q.capacity; pk = Math.max(pk, q.peak); });
      return { load: l, capacity: c, util: c > 0 ? l / c : 0, peak: pk };
    });
  }

  // the capacity a site must add to stay at or under a utilisation target: reviewed once a year (or every `review`
  // months), each addition sized for the busiest month until the next review and rounded up to two significant digits.
  // Months in which an outage removes all capacity cannot be fixed by adding capacity and are left out.
  function roundUp2(v) { if (!(v > 0)) return 0; var p = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.ceil(v / p - 1e-9) * p; }
  function requiredCapacity(net, result, id, target, review) {
    target = target > 0 ? target : 1; review = review > 0 ? Math.round(review) : 12;
    var s = null; net.sites.forEach(function (x) { if (x.id === id) s = x; });
    var r = result.sites[id]; if (!s || !r || s.tier === "market") return null;
    var f = capacity(Object.assign({}, s, { capacity: 1, expansions: [] }), net.config), base = zeros(MONTHS), m, k;
    for (m = 0; m < MONTHS; m++) { var b = s.capacity; (s.expansions || []).forEach(function (e) { if (m >= e.from) b += e.add; }); base[m] = b; }
    function gap(k2, added) { return f[k2] > 0 ? r.load[k2] / (target * f[k2]) - base[k2] - added : 0; }
    var adds = [], added = 0;
    for (m = 0; m < MONTHS;) {
      if (gap(m, added) > 1e-9 * Math.max(1, base[m])) {
        var mx = 0; for (k = m; k < Math.min(MONTHS, m + review); k++) mx = Math.max(mx, gap(k, added));
        var add = roundUp2(mx); adds.push({ from: m, add: add }); added += add; m += review;
      } else m++;
    }
    return { target: target, review: review, additions: adds, total: added, firstNeed: adds.length ? adds[0].from : -1, today: s.capacity };
  }

  return { MONTHLY: MONTHLY, YEARLY: YEARLY, MONTHS: MONTHS, DAYS_PER_MONTH: DAYS_PER_MONTH, TIERS: TIERS, TIER_INDEX: TIER_INDEX,
    distanceKm: distanceKm, transitDays: transitDays, hemisphere: hemisphere, seasonal: seasonal, rawSeasonAmplitude: rawSeasonAmplitude,
    at: at, lead: lead, periods: periods, forecast: forecast, capacity: capacity, validate: validate, plan: plan, tierSummary: tierSummary, leadChain: leadChain,
    tiersFor: tiersFor, requiredCapacity: requiredCapacity, roundUp2: roundUp2 };
});
