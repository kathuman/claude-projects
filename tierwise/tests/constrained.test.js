// Tierwise — the constrained plan, solved with HiGHS (npm install highs@1.15.3 in tierwise/, or NODE_PATH to one):
// small chains whose answers are known (ample capacity, a bottleneck, pre-building for a season, re-routing, new
// lanes, priorities), the rules every solution keeps (capacity, conservation, stock age, yields), and the example
// network, including the claims the tutorial makes about it (claim ids c-…).
const P = require("../src/plan.js"), N = require("../src/network.js"), K = require("../src/constrained.js");
let loadHighs; try { loadHighs = require("highs"); } catch (e) { console.log("HiGHS is not installed: npm install highs@1.15.3 (in tierwise/)"); process.exit(1); }
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); } if (process.env.VERBOSE && cond) console.log("ok   " + name); }
const sum = (s, a, b) => { let t = 0; for (let i = a; i < b; i++) t += s[i]; return t; };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
// one site per tier; o.sites adds or replaces sites; capacities in each tier's unit
function chain(o) {
  o = o || {};
  const t = (id, tier, from, extra) => Object.assign({ id, tier, name: id, lat: 10, lon: 0, capacity: 1e9, lead: 0, release: 0, yield: 100, suppliers: from ? [{ from, share: 100, days: 0 }] : undefined }, extra || {});
  const net = {
    config: { startYear: 2027, startMonth: 0, cover: 0, demandPeak: 10, rawPeak: 4, rawSeasonMax: 0, demandScale: 1 },
    bom: { packPerUnit: 20, kgPerSachet: 0.025, rawPerProduct: 0.7 },
    sites: [
      { id: "m", tier: "market", name: "m", lat: 30, lon: 0, base: 1000, growth: 0, season: o.season || 0, suppliers: [{ from: "w", share: 100, days: 0 }] },
      t("w", "warehouse", "pk", { handling: 0, cover: 0 }), t("pk", "packaging", "d", o.pk), t("d", "dosing", "p", o.d), t("p", "product", "r", o.p), t("r", "raw", null, o.r)
    ]
  };
  (o.edit || (() => {}))(net);
  return net;
}
const allUnder = (r) => Object.values(r.sites).every((s) => !s.util || Array.from(s.util).every((u) => u <= 1 + 1e-5));
(async () => {
  const highs = await loadHighs({ print: () => {}, printErr: () => {} });
  const solve = (net, o) => K.solve(highs, net, o);

  // ---- ample capacity: everything is delivered and the loads are the requirement plan's
  {
    const net = chain({ pk: { lead: 20, release: 5 }, d: { lead: 10, release: 7, yield: 98 }, p: { lead: 7, release: 14, yield: 97 }, r: { lead: 10, release: 7 } });
    const r = solve(net, { mode: "fixed", hold: 0 }), u = P.plan(net);
    check("ample capacity: the plan solves", r.ok, r.errors);
    check("ample capacity: every pack is delivered", r.fill > 0.99999, r.fill);
    check("ample capacity: loads match the requirements plan (months 12–144)", ["w", "pk", "d", "p", "r"].every((id) => near(sum(r.sites[id].load, 12, 144), sum(u.sites[id].load, 12, 144), 0.003)));
    check("ample capacity: nothing is re-routed", r.rerouted < 1e-6, r.rerouted);
  }
  // ---- a bottleneck: packaging can make 800 of the 1,000 packs a month
  {
    const r = solve(chain({ pk: { capacity: 800 } }), { mode: "fixed", hold: 0 });
    check("bottleneck: fill rate is the bottleneck's share", near(r.fill, 0.8, 0.005), r.fill);
    check("bottleneck: the packer runs at capacity and is marked binding", Array.from(r.sites.pk.util).slice(6, 150).every((u) => u > 0.999) && r.sites.pk.firstBinding >= 0);
    check("bottleneck: upstream makes only what can be packed", near(sum(r.sites.d.load, 12, 144) / 20, sum(r.sites.pk.load, 12, 144), 0.01));
    check("bottleneck: unmet demand starts within months and is 200 a month", r.firstUnmet >= 0 && r.firstUnmet <= 2 && near(sum(r.sites.m.unmet, 12, 144) / 132, 200, 0.02), [r.firstUnmet, sum(r.sites.m.unmet, 12, 144) / 132]);
  }
  // ---- a season above capacity: building stock ahead covers it, if stock may be held long enough
  {
    const net = () => chain({ season: 60, pk: { capacity: 1150 } });
    check("season: the requirement plan is over capacity in the peak", P.plan(net()).sites.pk.firstOver >= 0);
    const r0 = solve(net(), { mode: "fixed", hold: 0 }), r6 = solve(net(), { mode: "fixed", hold: 6 });
    check("season: holding stock up to 6 months serves (almost) everything", r6.fill > 0.999, r6.fill);
    check("season: more pre-building time never serves less", r6.fill >= r0.fill - 1e-9, [r0.fill, r6.fill]);
    check("season: the stock is built before the peak and drawn in it", (() => { const s = r6.sites.w.stock, pk = r6.sites.pk.stock, st = Array.from(s).map((v, i) => v + pk[i]).slice(24, 36); return Math.max(...st) > 3 * Math.min(...st); })());
    // stock is never older than the limit: stock ≤ what came in over the last `hold` months
    const rel = r6.sites.pk.load, stk = r6.sites.pk.stock; let ok = true;
    for (let m = 6; m < 150; m++) if (stk[m] > sum(rel, m - 5, m + 1) * 1.0001 + 1e-6) ok = false;
    check("season: a packer holds no more than its last 6 months of output", ok);
  }
  // ---- re-routing: two packers 50/50, one can make only 300
  {
    const two = (n) => { n.sites.push({ id: "pk2", tier: "packaging", name: "pk2", lat: 10, lon: 1, capacity: 1e9, lead: 0, release: 0, yield: 100, suppliers: [{ from: "d", share: 100, days: 0 }] }); n.sites.find((s) => s.id === "pk").capacity = 300; n.sites.find((s) => s.id === "w").suppliers = [{ from: "pk", share: 50, days: 0 }, { from: "pk2", share: 50, days: 0 }]; };
    const f = solve(chain({ edit: two }), { mode: "fixed", hold: 0 }), q = solve(chain({ edit: two }), { mode: "qualified", hold: 0 });
    check("re-routing: with fixed shares the small packer holds the other back", near(f.fill, 0.6, 0.02), f.fill);
    check("re-routing: allowed, the large packer takes the rest and everything is delivered", q.fill > 0.999 && q.rerouted > 0.02 && f.rerouted < 1e-6, [q.fill, q.rerouted]);
    const lane = q.lanes.find((l) => l.from === "pk2" && l.to === "w");
    check("re-routing: the large packer's actual share is about 70%", near(lane.actual, 0.7, 0.03), lane.actual);
  }
  // ---- any supplier: a second warehouse that is not on the market's lanes
  {
    const ed = (n) => { n.sites.push({ id: "w2", tier: "warehouse", name: "w2", lat: 30, lon: 2, capacity: 1e9, handling: 0, cover: 0, suppliers: [{ from: "pk", share: 100, days: 0 }] }); n.sites.find((s) => s.id === "w").capacity = 400; };
    const q = solve(chain({ edit: ed }), { mode: "qualified", hold: 0 }), a = solve(chain({ edit: ed }), { mode: "any", hold: 0 });
    check("any supplier: within qualified lanes the small warehouse limits service", q.fill < 0.6, q.fill);
    check("any supplier: opening every lane of the tier above serves the market from the other warehouse", a.fill > 0.999 && a.lanes.some((l) => l.from === "w2" && l.to === "m" && !l.qualified && l.total > 0), a.fill);
  }
  // ---- priorities: one warehouse of 1,000 a month for two markets of 800
  {
    const ed = (n) => { n.sites.push({ id: "m2", tier: "market", name: "m2", lat: 30, lon: 0, base: 800, growth: 0, season: 0, suppliers: [{ from: "w", share: 100, days: 0 }] }); const m = n.sites.find((s) => s.id === "m"); m.base = 800; m.priority = 3; n.sites.find((s) => s.id === "w").capacity = 1000; };
    const r = solve(chain({ edit: ed }), { mode: "fixed", hold: 0 });
    check("priorities: the priority market is served in full, the other gets the rest", r.sites.m.fill > 0.999 && near(r.sites.m2.fill, 0.25, 0.03), [r.sites.m.fill, r.sites.m2.fill]);
  }
  // ---- yields: losses upstream are made good, not passed on as shortage
  {
    const r = solve(chain({ pk: { yield: 98, capacity: 900 }, d: { yield: 95 } }), { mode: "fixed", hold: 0 });
    check("yields: the packer's capacity limits what it makes, before its losses", near(sum(r.sites.m.delivered, 12, 144) / 132, 900 * 0.98, 0.02), sum(r.sites.m.delivered, 12, 144) / 132);
    check("yields: dosing makes enough for the packer's gross need", near(sum(r.sites.d.load, 12, 144) / 20, sum(r.sites.pk.load, 12, 144) / 0.95, 0.02));
  }

  // ---- the example network
  const B = {};
  for (const [k, sc, mode, hold] of [["fixed0", "base", "fixed", 0], ["fixed6", "base", "fixed", 6], ["qual6", "base", "qualified", 6], ["any6", "base", "any", 6], ["expand", "expand", "qualified", 6], ["drought", "drought", "qualified", 6]]) {
    B[k] = solve(N.build(sc), { mode, hold }); if (process.env.VERBOSE) console.log(k, B[k].ok && B[k].fill, B[k].firstUnmet, B[k].seconds, B[k].attempts);
    check("example " + k + ": solves within capacity", B[k].ok && allUnder(B[k]), B[k].errors);
    const net = N.build(sc), m = net.sites.filter((s) => s.tier === "market");
    check("example " + k + ": delivered + unmet = demand at every market", m.every((s) => { const o = B[k].sites[s.id]; return Array.from(o.demand).every((d, i) => Math.abs(o.delivered[i] + o.unmet[i] - d) < 1e-6 * Math.max(1, d)); }));
  }
  check("example: the base plan serves most but not all demand", B.qual6.fill > 0.85 && B.qual6.fill < 0.97, B.qual6.fill);
  check("c-prebuild: pre-building up to 6 months serves more than none", B.fixed6.fill > B.fixed0.fill + 0.005, [B.fixed0.fill, B.fixed6.fill]);
  check("c-prebuild: …and the first unmet month comes later", B.fixed6.firstUnmet > B.fixed0.firstUnmet, [B.fixed0.firstUnmet, B.fixed6.firstUnmet]);
  check("c-flex: more sourcing freedom never serves less (fixed ≤ qualified ≤ any)", B.fixed6.fill <= B.qual6.fill + 1e-6 && B.qual6.fill <= B.any6.fill + 1e-6, [B.fixed6.fill, B.qual6.fill, B.any6.fill]);
  check("c-flex: any supplier pushes the first unmet month back by more than a year", B.any6.firstUnmet > B.qual6.firstUnmet + 12, [B.qual6.firstUnmet, B.any6.firstUnmet]);
  check("c-expand: the expansion programme lifts the fill rate above 99%", B.expand.fill > 0.99, B.expand.fill);
  check("c-drought: within capacity, stock and re-routing absorb the dry year (no unmet demand in years 1–3)", B.drought.sites && Object.values(B.drought.sites).every((s) => !s.unmet || sum(s.unmet, 0, 36) < 1), (() => { let t = 0; Object.values(B.drought.sites).forEach((s) => { if (s.unmet) t += sum(s.unmet, 0, 36); }); return t; })());
  check("c-first: the first unmet demand comes years after the first shortfall of the requirement plan", B.qual6.firstUnmet > 24 + (() => { let b = 1e9; Object.values(P.plan(N.build("base")).sites).forEach((o) => { if (o.firstOver >= 0 && o.firstOver < b) b = o.firstOver; }); return b; })(), B.qual6.firstUnmet);
  console.log(pass + "/" + (pass + fail) + " checks passed");
  process.exit(fail ? 1 : 0);
})();
