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
    { id: "market", name: "Consumption points", short: "Markets", unit: "packs" },
    { id: "warehouse", name: "Warehouses", short: "Warehouses", unit: "packs" },
    { id: "packaging", name: "Packaging CMOs", short: "Packaging", unit: "packs" },
    { id: "dosing", name: "Final dosing CMOs", short: "Dosing", unit: "sachets" },
    { id: "product", name: "Product manufacturing CMOs", short: "Product", unit: "t" },
    { id: "raw", name: "Raw ingredient CMOs", short: "Raw ingredient", unit: "t" }
  ];
  var TIER_INDEX = {}; TIERS.forEach(function (t, i) { TIER_INDEX[t.id] = i; });

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
    net.sites.forEach(function (s) { if (byId[s.id]) e.push("Two sites share the id " + s.id + "."); byId[s.id] = s; if (TIER_INDEX[s.tier] == null) e.push("Unknown tier for " + s.name + "."); });
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
    });
    ["packPerUnit", "kgPerSachet", "rawPerProduct"].forEach(function (k) { if (!(net.bom[k] > 0)) e.push("The bill of materials needs a positive " + k + "."); });
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
    var req = {}, load = {}, need = {}, cap = {}, trans = {}, demand = {};
    sites.forEach(function (s) { req[s.id] = zeros(MONTHS); });
    // 1. consumption points: their forecast is what must arrive there each month
    sites.filter(function (s) { return s.tier === "market"; }).forEach(function (s) { demand[s.id] = forecast(s, cfg); req[s.id] = demand[s.id]; });
    // 2. tier by tier upstream
    for (var t = 0; t < TIERS.length; t++) {
      var tier = TIERS[t].id;
      sites.filter(function (s) { return s.tier === tier; }).forEach(function (s) {
        var r = req[s.id], y = (s.yield != null ? s.yield : 100) / 100;
        if (tier === "market") {
          need[s.id] = r;   // what has to arrive: the forecast itself
        } else if (tier === "warehouse") {
          // a warehouse ships what its markets need and builds or draws safety stock (cover in weeks of coming demand)
          var cover = (s.cover != null ? s.cover : cfg.cover) / (DAYS_PER_MONTH / 7);
          var ss = zeros(MONTHS); for (var m = 0; m < MONTHS; m++) ss[m] = at(r, m + cover / 2) * cover;
          var inbound = zeros(MONTHS); for (m = 0; m < MONTHS; m++) inbound[m] = r[m] + (m ? ss[m] - ss[m - 1] : 0);
          load[s.id] = r; cap[s.id] = capacity(s, cfg); s._ss = ss;
          var hd = (s.handling || 0) / DAYS_PER_MONTH; need[s.id] = lead(inbound, hd);
        } else {
          // a CMO: output released in month m was made release-time earlier, gross of yield; its inputs arrive lead-time earlier still
          var made = lead(r, (s.release || 0) / DAYS_PER_MONTH); for (m = 0; m < MONTHS; m++) made[m] /= y;
          load[s.id] = made; cap[s.id] = capacity(s, cfg);
          need[s.id] = lead(made, (s.lead || 0) / DAYS_PER_MONTH);
        }
        if (tier === "raw") return;
        // what this site needs from each supplier, shifted earlier by the lane's transit and converted to the supplier's unit
        var sup = (s.suppliers || []).filter(function (l) { return l.share > 0; }), tot = sup.reduce(function (a, l) { return a + l.share; }, 0);
        var up = TIERS[t + 1].id, factor = per[up];
        sup.forEach(function (l) {
          var u = byId[l.from], days = transitDays(u, s, l.days), share = l.share / tot;
          trans[l.from + ">" + s.id] = days;
          var need2 = lead(need[s.id], days / DAYS_PER_MONTH), add = req[l.from];
          for (var m2 = 0; m2 < MONTHS; m2++) add[m2] += need2[m2] * share * factor;
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
        site: s, load: L, capacity: C, util: util, firstOver: firstOver, ss: s._ss || null,
        peakUtil: Math.max.apply(null, Array.prototype.slice.call(util)),
        periods: P.map(function (p) {
          var l = sum(L, p.from, p.to), c = sum(C, p.from, p.to), pk = 0, pkm = p.from;
          for (var k = p.from; k < p.to; k++) if (util[k] > pk) { pk = util[k]; pkm = k; }
          return { load: l / (p.to - p.from), capacity: c / (p.to - p.from), util: c > 0 ? l / c : (l > 0 ? Infinity : 0), peak: pk, peakMonth: pkm, gap: Math.max(0, l - c) };
        })
      };
      delete s._ss;
    });
    return { ok: true, months: MONTHS, periods: P, sites: out, transit: trans, per: per, tiers: TIERS, leadChain: leadChain(net, trans) };
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

  return { MONTHLY: MONTHLY, YEARLY: YEARLY, MONTHS: MONTHS, DAYS_PER_MONTH: DAYS_PER_MONTH, TIERS: TIERS, TIER_INDEX: TIER_INDEX,
    distanceKm: distanceKm, transitDays: transitDays, hemisphere: hemisphere, seasonal: seasonal, rawSeasonAmplitude: rawSeasonAmplitude,
    at: at, lead: lead, periods: periods, forecast: forecast, capacity: capacity, validate: validate, plan: plan, tierSummary: tierSummary, leadChain: leadChain };
});
