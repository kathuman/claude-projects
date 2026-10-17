// Tierwise — the example network: a fortified milk powder, sold in packs of 20 sachets of 25 g, made from a dairy
// powder base. Sites spread across latitudes, from Ireland (52°N) to New Zealand (38°S), so milk seasons at the
// raw-ingredient tier run six months apart and markets peak in opposite months. All figures are illustrative.
// window.TWNetwork in the browser, module.exports in Node.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TWNetwork = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function base() {
    return {
      product: "Fortified milk powder · 20 × 25 g sachets per pack",
      config: { startYear: 2027, startMonth: 0, cover: 6, demandPeak: 10, rawPeak: 4, rawSeasonMax: 25, demandScale: 1 },
      bom: { packPerUnit: 20, kgPerSachet: 0.025, rawPerProduct: 0.7 },
      // a custom (descriptive) parameter: which CMOs hold a halal certificate
      params: [{ key: "halal", label: "Halal certified", type: "bool", applies: "sites", tiers: ["packaging", "dosing", "product"] }],
      sites: [
        // ---- consumption points (packs a month; growth % a year for years 1–3, then long-term growth; seasonal swing %)
        { id: "m-mex", tier: "market", name: "Mexico City", country: "Mexico", lat: 19.43, lon: -99.13, base: 220000, growth: 6, longGrowth: 4, season: 12, suppliers: [{ from: "w-mx", share: 100 }] },
        { id: "m-sao", tier: "market", name: "São Paulo", country: "Brazil", lat: -23.55, lon: -46.63, base: 260000, growth: 5, longGrowth: 3.5, season: 12, suppliers: [{ from: "w-br", share: 100 }] },
        { id: "m-los", tier: "market", name: "Lagos", country: "Nigeria", lat: 6.52, lon: 3.38, base: 180000, growth: 9, longGrowth: 6, season: 6, suppliers: [{ from: "w-ng", share: 100 }] },
        { id: "m-jnb", tier: "market", name: "Johannesburg", country: "South Africa", lat: -26.2, lon: 28.05, base: 120000, growth: 4, longGrowth: 3, season: 15, suppliers: [{ from: "w-za", share: 100 }] },
        { id: "m-cai", tier: "market", name: "Cairo", country: "Egypt", lat: 30.04, lon: 31.24, base: 160000, growth: 6, longGrowth: 4, season: 10, suppliers: [{ from: "w-ae", share: 100 }] },
        { id: "m-dac", tier: "market", name: "Dhaka", country: "Bangladesh", lat: 23.81, lon: 90.41, base: 150000, growth: 10, longGrowth: 7, season: 8, launch: 18, ramp: 12, suppliers: [{ from: "w-ae", share: 100 }] },
        { id: "m-jkt", tier: "market", name: "Jakarta", country: "Indonesia", lat: -6.21, lon: 106.85, base: 240000, growth: 7, longGrowth: 5, season: 6, suppliers: [{ from: "w-sg", share: 100 }] },
        { id: "m-mnl", tier: "market", name: "Manila", country: "Philippines", lat: 14.6, lon: 120.98, base: 150000, growth: 7, longGrowth: 5, season: 8, suppliers: [{ from: "w-sg", share: 100 }] },
        // ---- warehouses (throughput in packs a month; handling days; safety-stock cover in weeks)
        { id: "w-mx", tier: "warehouse", name: "Guadalajara DC", country: "Mexico", lat: 20.67, lon: -103.35, capacity: 330000, handling: 2, cover: 6, suppliers: [{ from: "pk-qro", share: 100 }] },
        { id: "w-br", tier: "warehouse", name: "Campinas DC", country: "Brazil", lat: -22.91, lon: -47.06, capacity: 360000, handling: 2, cover: 6, suppliers: [{ from: "pk-qro", share: 60 }, { from: "pk-cpt", share: 40 }] },
        { id: "w-ng", tier: "warehouse", name: "Apapa DC", country: "Nigeria", lat: 6.45, lon: 3.36, capacity: 260000, handling: 3, cover: 8, suppliers: [{ from: "pk-cpt", share: 100 }] },
        { id: "w-za", tier: "warehouse", name: "Durban DC", country: "South Africa", lat: -29.86, lon: 31.02, capacity: 170000, handling: 2, cover: 6, suppliers: [{ from: "pk-cpt", share: 100 }] },
        { id: "w-ae", tier: "warehouse", name: "Jebel Ali DC", country: "United Arab Emirates", lat: 25.01, lon: 55.06, capacity: 420000, handling: 2, cover: 6, suppliers: [{ from: "pk-jhb", share: 100 }] },
        { id: "w-sg", tier: "warehouse", name: "Singapore DC", country: "Singapore", lat: 1.35, lon: 103.82, capacity: 520000, handling: 2, cover: 5, suppliers: [{ from: "pk-jhb", share: 100 }] },
        // ---- packaging CMOs (packs a month)
        { id: "pk-qro", tier: "packaging", name: "Querétaro Packaging", country: "Mexico", lat: 20.59, lon: -100.39, capacity: 520000, lead: 2, release: 3, yield: 99.5, suppliers: [{ from: "d-ros", share: 70 }, { from: "d-vlc", share: 30 }], custom: { halal: false } },
        { id: "pk-cpt", tier: "packaging", name: "Cape Town Packaging", country: "South Africa", lat: -33.92, lon: 18.42, capacity: 520000, lead: 2, release: 3, yield: 99.5, suppliers: [{ from: "d-vlc", share: 60 }, { from: "d-ros", share: 40 }], custom: { halal: true } },
        { id: "pk-jhb", tier: "packaging", name: "Johor Packaging", country: "Malaysia", lat: 1.49, lon: 103.74, capacity: 950000, lead: 2, release: 3, yield: 99.5, suppliers: [{ from: "d-pen", share: 80 }, { from: "d-vlc", share: 20 }], custom: { halal: true } },
        // ---- final dosing CMOs (sachets a month)
        { id: "d-vlc", tier: "dosing", name: "Valencia Dosing", country: "Spain", lat: 39.47, lon: -0.38, capacity: 12500000, lead: 3, release: 7, yield: 98.5, suppliers: [{ from: "p-cork", share: 80 }, { from: "p-wis", share: 20 }], custom: { halal: true } },
        { id: "d-pen", tier: "dosing", name: "Penang Dosing", country: "Malaysia", lat: 5.41, lon: 100.33, capacity: 15000000, lead: 3, release: 7, yield: 98.5, suppliers: [{ from: "p-ham", share: 70 }, { from: "p-cork", share: 30 }], custom: { halal: true } },
        { id: "d-ros", tier: "dosing", name: "Rosario Dosing", country: "Argentina", lat: -32.95, lon: -60.65, capacity: 11000000, lead: 3, release: 7, yield: 98.5, suppliers: [{ from: "p-wis", share: 50 }, { from: "p-ham", share: 50 }], custom: { halal: false } },
        // ---- product manufacturing CMOs (tonnes of powder a month)
        { id: "p-cork", tier: "product", name: "Cork Nutrition", country: "Ireland", lat: 51.9, lon: -8.47, capacity: 390, lead: 7, release: 14, yield: 97, suppliers: [{ from: "r-nor", share: 70 }, { from: "r-wis", share: 30 }], custom: { halal: true } },
        { id: "p-ham", tier: "product", name: "Hamilton Nutrition", country: "New Zealand", lat: -37.79, lon: 175.28, capacity: 400, lead: 7, release: 14, yield: 97, suppliers: [{ from: "r-wai", share: 70 }, { from: "r-gip", share: 30 }], custom: { halal: true } },
        { id: "p-wis", tier: "product", name: "Madison Nutrition", country: "United States", lat: 43.07, lon: -89.4, capacity: 260, lead: 7, release: 14, yield: 97, suppliers: [{ from: "r-wis", share: 80 }, { from: "r-nor", share: 20 }], custom: { halal: false } },
        // ---- raw ingredient CMOs (tonnes of dairy powder base a month, before the milk season)
        { id: "r-nor", tier: "raw", name: "Normandy Dairy Co-op", country: "France", lat: 49.18, lon: -0.37, capacity: 330, lead: 10, release: 7, yield: 99 },
        { id: "r-wai", tier: "raw", name: "Waikato Dairy Co-op", country: "New Zealand", lat: -37.68, lon: 175.2, capacity: 250, lead: 10, release: 7, yield: 99 },
        { id: "r-gip", tier: "raw", name: "Gippsland Dairy Co-op", country: "Australia", lat: -38.2, lon: 146.4, capacity: 115, lead: 10, release: 7, yield: 99 },
        { id: "r-wis", tier: "raw", name: "Wisconsin Dairy Co-op", country: "United States", lat: 44.5, lon: -89.5, capacity: 290, lead: 10, release: 7, yield: 99 }
      ]
    };
  }
  // ready-made scenarios: changes on top of the example network
  var SCENARIOS = {
    base: { label: "Base plan", apply: function () {} },
    growth: { label: "Fast growth in Africa and Asia", apply: function (n) { n.sites.forEach(function (s) { if (["m-los", "m-dac", "m-jkt", "m-mnl"].indexOf(s.id) >= 0) { s.growth += 5; s.longGrowth += 3; } }); } },
    drought: { label: "Dry season in New Zealand (−35% milk in year 2)", apply: function (n) { n.sites.forEach(function (s) { if (s.id === "r-wai" || s.id === "r-gip") s.outages = [{ from: 12, months: 12, loss: 35 }]; }); } },
    expand: { label: "Base plan with a programme of capacity expansions", apply: function (n) {
      var add = {
        "pk-cpt": [{ from: 30, add: 260000 }], "d-vlc": [{ from: 30, add: 5000000 }], "d-pen": [{ from: 36, add: 6000000 }], "w-ae": [{ from: 36, add: 250000 }],
        "pk-jhb": [{ from: 48, add: 450000 }], "w-ng": [{ from: 48, add: 160000 }], "w-br": [{ from: 60, add: 120000 }], "r-gip": [{ from: 60, add: 50 }],
        "p-ham": [{ from: 30, add: 90 }, { from: 72, add: 120 }], "d-ros": [{ from: 30, add: 3500000 }], "r-wai": [{ from: 24, add: 60 }, { from: 72, add: 80 }], "w-sg": [{ from: 36, add: 160000 }],
        "p-cork": [{ from: 48, add: 80 }], "r-nor": [{ from: 48, add: 60 }]
      };
      n.sites.forEach(function (s) { if (add[s.id]) s.expansions = add[s.id]; });
    } },
    resource: { label: "Dual-source every dosing CMO equally", apply: function (n) { n.sites.forEach(function (s) { if (s.tier === "packaging") s.suppliers = [{ from: "d-vlc", share: 34 }, { from: "d-pen", share: 33 }, { from: "d-ros", share: 33 }]; }); } }
  };
  function build(id) { var n = base(), sc = SCENARIOS[id] || SCENARIOS.base; sc.apply(n); n.scenario = SCENARIOS[id] ? id : "base"; return n; }
  return { base: base, build: build, SCENARIOS: SCENARIOS };
});
