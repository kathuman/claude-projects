// Tierwise — stress tests (npm install highs@1.15.3 in tierwise/): small chains whose answers are known, then the example.
const N = require("../src/network.js"), K = require("../src/constrained.js"), ST = require("../src/stress.js");
let loadHighs; try { loadHighs = require("highs"); } catch (e) { console.log("HiGHS is not installed: npm install highs@1.15.3 (in tierwise/)"); process.exit(1); }
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
const money = { packValue: 2, unitCost: 1, holdingRate: 1, discountRate: 8, terminalYears: 5 };
// one site per tier, no lead times, no seasons: 1,000 packs a month; dosing has `dose` sachets a month (20 per pack)
function chain(dose, extra) {
  const t = (id, tier, from, x) => Object.assign({ id, tier, name: id, lat: 10, lon: 0, capacity: 1e9, lead: 0, release: 0, yield: 100, suppliers: from ? [{ from, share: 100, days: 0 }] : undefined }, x);
  return { config: Object.assign({ startYear: 2027, startMonth: 0, cover: 0, demandPeak: 10, rawPeak: 4, rawSeasonMax: 0, demandScale: 1 }, money, extra), bom: { packPerUnit: 20, kgPerSachet: 0.025, rawPerProduct: 0.7 },
    sites: [{ id: "m", tier: "market", name: "m", lat: 30, lon: 0, base: 1000, growth: 0, season: 0, suppliers: [{ from: "w", share: 100, days: 0 }] }, t("w", "warehouse", "pk", { handling: 0, cover: 0 }), t("pk", "packaging", "d"), t("d", "dosing", "p", { capacity: dose }), t("p", "product", "r"), t("r", "raw", null)] };
}
const o = { mode: "qualified", hold: 6 };
(async () => {
  const highs = await loadHighs({ print: () => {}, printErr: () => {} });
  const D = (x) => ST.clean(x);

  // ---- the shape of a disruption
  const f = ST.profile(D({ kind: "site", target: "d", start: 10, months: 3, ramp: 3 }));
  check("a disruption hits fully for its months, then fades over the ramp", f[9] === 0 && f[10] === 1 && f[12] === 1 && Math.abs(f[13] - 0.75) < 1e-12 && Math.abs(f[15] - 0.25) < 1e-12 && f[16] === 0, Array.from(f.slice(9, 17)));
  check("default times to recover come from the tier, and a site's own value wins", ST.ttrOf(chain(40000), { kind: "site", target: "d" }) === ST.TTR.dosing && ST.ttrOf((() => { const n = chain(40000); n.sites[3].recovery = 9; return n; })(), { kind: "site", target: "d" }) === 9 && ST.ttrOf(chain(40000), { kind: "route", target: "pk>w" }) === ST.TTR.route);

  // ---- a single path, with no stock held: an outage loses exactly what it stops
  const one = chain(40000), S1 = ST.session(highs, one, o), b1 = S1.baseline();
  const out2 = S1.run(D({ kind: "site", target: "d", start: 14, months: 2, severity: 1 }));
  check("a single path, dosing out for two months: two months of demand are lost", out2.ok && Math.abs(out2.m.lost - 2000) < 2, out2.m && out2.m.lost);
  check("…and it is priced: the plan's cost rises by about the margin lost", out2.m.costPV > 2000 * money.packValue * 0.8 && out2.m.costPV < 2000 * money.packValue * 1.05, out2.m.costPV);
  check("…with a receipt for both plans", out2.m.proved && out2.m.receipts.length === 2);
  const half = ST.session(highs, chain(20000), o).run(D({ kind: "site", target: "d", start: 14, months: 2, severity: 0.5 }));
  check("no spare capacity, half of it gone for two months: one month of demand is lost", Math.abs(half.m.lost - 1000) < 2, half.m.lost);
  check("twice the capacity needed, half of it gone: nothing is lost", S1.run(D({ kind: "site", target: "d", start: 14, months: 2, severity: 0.5 })).m.lost < 1);
  // the plan cannot see it coming: nothing before the start changes
  const same = Object.keys(b1.sites).every((id) => { const x = b1.sites[id], y = out2.plan.sites[id]; const a = x.stock || x.unmet, c = y.stock || y.unmet; for (let m = 0; m < 14; m++) if (Math.abs(a[m] - c[m]) > 1e-3 * Math.max(1, a[m])) return false; return true; });
  check("a disruption is a surprise: every stock and shortfall before it is as in the undisturbed plan", same);

  // ---- stock in the chain: time to survive, by halving, matches a month-by-month search
  const buf = chain(40000, { cover: 0 }); buf.sites[1].cover = 8;   // the warehouse keeps 8 weeks of safety stock
  const S2 = ST.session(highs, buf, o), d2 = D({ kind: "site", target: "d", start: 14, months: 4, severity: 1 });
  const lim = ST.TOL * 1000, brute = (() => { let n = 0; for (let k = 1; k <= 6; k++) { if (S2.run(Object.assign({}, d2, { months: k })).m.lost <= lim) n = k; else break; } return n; })();
  const tts2 = S2.tts(d2);
  check("time to survive: halving finds the same month as trying each month", tts2.months === brute && brute >= 1, { halving: tts2, brute });
  check("eight weeks of safety stock ride out a one-month outage, not a three-month one", brute >= 1 && brute < 3, brute);
  check("no stock and no other path: the network cannot survive a month", S1.tts(D({ kind: "site", target: "d", start: 14, months: 2, severity: 1 })).months === 0);

  // ---- a route closed: another qualified supplier with room takes it
  const two = chain(40000); two.sites[1].suppliers = [{ from: "pk", share: 50, days: 0 }, { from: "pk2", share: 50, days: 0 }];
  two.sites.push(Object.assign({}, two.sites[2], { id: "pk2", name: "pk2" }));
  const r2 = ST.session(highs, two, o).run(D({ kind: "route", target: "pk>w", start: 14, months: 3, severity: 1 }));
  check("a route closed where a second qualified supplier has room: nothing is lost, the volume is re-routed", r2.ok && r2.m.lost < 2 && r2.m.rerouted > 0, r2.m && { lost: r2.m.lost, rr: r2.m.rerouted });
  const r2f = ST.session(highs, two, { mode: "fixed", hold: 6 }).run(D({ kind: "route", target: "pk>w", start: 14, months: 3, severity: 1 }));
  check("…but with fixed shares the warehouse cannot re-route, and loses sales", r2f.ok && r2f.m.lost > 100, r2f.m && r2f.m.lost);

  // ---- demand: a surge the network has no room for, one it has room for, and a drop
  const tight = ST.session(highs, chain(20000), o);   // dosing makes exactly 1,000 packs a month
  const surge = tight.run(D({ kind: "demand", target: "all", start: 14, months: 3, change: 0.4 }));
  check("a 40% surge for three months with no spare capacity: the surge is lost (1,200 packs)", Math.abs(surge.m.lost - 1200) < 5, surge.m.lost);
  const roomy = ST.session(highs, chain(30000), o);   // 1,500 packs a month: half as much again
  check("the same surge with 50% spare capacity: nothing is lost", roomy.run(D({ kind: "demand", target: "all", start: 14, months: 3, change: 0.4 })).m.lost < 2);
  const hr = roomy.headroom(D({ kind: "demand", target: "all", start: 14, months: 3, change: 0.4 }));
  check("headroom: the largest surge it absorbs is about the 50% spare", hr.change >= 0.46 && hr.change <= 0.52, hr);
  const drop = tight.run(D({ kind: "demand", target: "all", start: 14, months: 6, change: -0.3 }));
  check("a 30% drop loses no sales", drop.ok && drop.m.lost === 0, drop.m.lost);
  check("one market's surge leaves the other markets alone", (() => { const n = chain(30000); const st = ST.optionsFor(n, b1, D({ kind: "demand", target: "zz", start: 1, months: 1, change: 1 }), o); return Object.keys(st.stress.mul).length === 0; })());

  // ---- the analysis and the scan, as the page calls them
  const an = ST.analyse(highs, one, Object.assign({ disruption: { kind: "site", target: "d", start: 14, months: 2, severity: 1 } }, o));
  check("analyse: a site outage reports time to survive against time to recover", an.ok && an.tts.months === 0 && an.ttr === ST.TTR.dosing && an.survives === false, an.ok && { tts: an.tts, ttr: an.ttr });
  check("analyse: a surge reports its headroom", (() => { const a = ST.analyse(highs, chain(30000), Object.assign({ disruption: { kind: "demand", target: "all", start: 14, months: 3, change: 0.4 } }, o)); return a.ok && a.headroom && a.headroom.change > 0.4; })());
  check("analyse: a network without a stock cost is refused, not guessed at", (() => { const n = chain(40000); delete n.config.unitCost; return ST.analyse(highs, n, Object.assign({ disruption: { kind: "site", target: "d", start: 1, months: 1 } }, o)).needsMoney === true; })());
  const mf = new ST.MaxFlow(4); mf.add(0, 1, 3); mf.add(0, 2, 2); mf.add(1, 3, 2); mf.add(2, 3, 3); mf.add(1, 2, 5);
  check("the screen's max-flow: a textbook network carries 5", mf.run(0, 3) === 5);

  // ---- the example
  const net = N.build("base"), sc = ST.scan(highs, net, Object.assign({ start: 16 }, o)), names = sc.items.map((i) => i.name);
  if (process.env.VERBOSE) sc.items.slice(0, 10).forEach((i) => console.log("   ", i.name.padEnd(30), JSON.stringify({ screened: Math.round(i.screened), lost: i.proved && Math.round(i.proved.lost), cost: i.proved && Math.round(i.proved.costPV), late: i.proved && i.proved.lateShare, tts: i.tts, ttr: i.ttr })));
  check("example scan: every site and route is screened, the worst " + ST.PROVE + " are solved, each with a receipt", sc.ok && sc.items.length === ST.elements(net, "qualified").length && sc.items.filter((i) => i.proved).length === ST.PROVE && sc.items.filter((i) => i.proved).every((i) => i.proved.proved), sc.ok && sc.solves);
  check("example scan: solved items come first, in order of what they cost", sc.items.slice(0, ST.PROVE).every((i, k, a) => i.proved && (k === 0 || a[k - 1].proved.costPV >= i.proved.costPV)));
  check("example scan: the screen finds the plan's three costliest outages (Johor Packaging, Penang Dosing, Cork Nutrition)", ["Johor Packaging", "Penang Dosing", "Cork Nutrition"].every((n) => names.indexOf(n) >= 0 && names.indexOf(n) < 3), names.slice(0, 5));
  const cork = sc.items.find((i) => i.name === "Cork Nutrition");
  check("example: Cork Nutrition out in 2028 loses most of its sales years later, when the stock it ate was meant for the peak", cork.proved.lateShare > 0.5, cork.proved.lateShare);
  check("example: the costliest three have a time to survive, and none outlasts its time to recover", sc.items.slice(0, ST.SURVIVE).every((i) => i.tts && i.survives === false && i.tts.months < i.ttr), sc.items.slice(0, 3).map((i) => [i.name, i.tts, i.ttr]));
  console.log(pass + "/" + (pass + fail) + " checks passed (" + sc.solves + " plans in the scan, " + sc.seconds.toFixed(0) + " s)");
  process.exit(fail ? 1 : 0);
})();
