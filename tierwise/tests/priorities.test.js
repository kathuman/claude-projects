// Tierwise — the priorities (npm install highs@1.15.3 in tierwise/): small chains whose answers are known, then the example.
const N = require("../src/network.js"), K = require("../src/constrained.js"), IV = require("../src/invest.js"), PR = require("../src/priorities.js");
let loadHighs; try { loadHighs = require("highs"); } catch (e) { console.log("HiGHS is not installed: npm install highs@1.15.3 (in tierwise/)"); process.exit(1); }
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
const money = { packValue: 2, unitCost: 1, holdingRate: 1, discountRate: 8, terminalYears: 5 };
// one site per tier; dosing is the only bottleneck, at 80% of demand
function chain(cand, extra) {
  const t = (id, tier, from, x) => Object.assign({ id, tier, name: id, lat: 10, lon: 0, capacity: 1e9, lead: 0, release: 0, yield: 100, suppliers: from ? [{ from, share: 100, days: 0 }] : undefined }, x);
  return { config: Object.assign({ startYear: 2027, startMonth: 0, cover: 0, demandPeak: 10, rawPeak: 4, rawSeasonMax: 0, demandScale: 1 }, money, extra), bom: { packPerUnit: 20, kgPerSachet: 0.025, rawPerProduct: 0.7 },
    sites: [{ id: "m", tier: "market", name: "m", lat: 30, lon: 0, base: 1000, growth: 0, season: 0, suppliers: [{ from: "w", share: 100, days: 0 }] }, t("w", "warehouse", "pk", { handling: 0, cover: 0 }), t("pk", "packaging", "d"), t("d", "dosing", "p", { capacity: 16000, candidates: cand || [] }), t("p", "product", "r"), t("r", "raw", null)] };
}
const cand = (id, capex, add) => ({ id, label: id, add: add || 4000, capex, build: 3, qualify: 0 });
(async () => {
  const highs = await loadHighs({ print: () => {}, printErr: () => {} }), run = (net) => PR.analyse(highs, net, { mode: "qualified", hold: 6 });

  check("a network without a stock cost is refused, not guessed at", (() => { const n = chain([]); delete n.config.unitCost; return run(n).needsMoney === true; })());
  // a good cheap line: the shortfall exists from the start, so waiting only loses money
  const cheap = run(chain([cand("c1", 1000)])), it = cheap.items.find((i) => i.kind === "build");
  check("a cheap line against a shortfall that exists today: act now", it.group === "now" && it.npv > 0 && it.latestYear === 0 && it.proved, it && { g: it.group, npv: it.npv, y: it.year });
  check("…its price is verified by the plan with and without it", it.receipts.length === 2 && it.receipts.every((r) => r.proved));
  // the same line at a price that cannot pay
  const dear = run(chain([cand("c1", 1e8)])), d = dear.items.find((i) => i.kind === "build");
  check("the same line at a price that cannot pay: don't", d.group === "dont" && d.npv < 0, d && d.npv);
  check("nothing with a negative NPV is ever recommended", [cheap, dear].every((r) => r.items.filter((i) => i.group === "now" || i.group === "by").every((i) => i.kind !== "build" || i.npv > 0)));
  // a bottleneck with no option on the table
  const none = run(chain([]));
  check("the site limiting the plan has no option defined: say so, at once", none.items.some((i) => i.kind === "define" && i.site === "d" && i.group === "now" && i.valuePer1000 > 0), none.items.map((i) => i.key));
  check("a market going short is flagged to watch", none.items.some((i) => i.kind === "market" && i.site === "m" && i.group === "watch" && i.fill < 0.95));
  // two lines where the second is only useful with the first
  const two = chain([cand("c1", 1000)]); two.sites.find((s) => s.id === "pk").capacity = 850; two.sites.find((s) => s.id === "pk").candidates = [cand("c1", 1000, 200)];
  const tr = run(two), a = tr.items.find((i) => i.key === "pk:c1"), b = tr.items.find((i) => i.key === "d:c1");
  check("two bottlenecks in a row: packaging is useless until dosing is expanded, so it is priced on top of it, and pays", b && b.after.length === 0 && b.npv > 0 && a && a.after.join() === "d:c1" && a.npv > 0 && a.alone < 0, tr.items.map((i) => [i.key, i.group, i.after, i.npv, i.alone]));
  // discounting makes a late start cheaper, so a fixed gain with a later need has a best year above zero (checked on the example below)
  const nv = (n, ready, add) => { const x = JSON.parse(JSON.stringify(n)); x.sites.find((s) => s.id === "d-vlc").expansions = (x.sites.find((s) => s.id === "d-vlc").expansions || []).concat(ready == null ? [] : [{ from: ready, add }]); return x; };

  // ---- the example
  const net = N.build("base"), o = { mode: "qualified", hold: 6 }, m0 = K.solve(highs, net, o);
  let prev = Infinity, smooth = true; const gains = [];
  for (const ready of [11, 47, 71, 95]) { const g = IV.gainOf(net.config, m0, K.solve(highs, nv(net, ready, 5500000), o)); gains.push(g); if (g > prev + 1e3) smooth = false; prev = g; }
  check("verified value never rises when the same capacity arrives later", smooth, gains.map((g) => +(g / 1e6).toFixed(2)));
  const r = run(net), pick = (k) => r.items.find((i) => i.key === k), v = pick("d-vlc:c1"), c = pick("pk-cpt:c1");
  if (process.env.VERBOSE) r.items.forEach((i) => console.log("   ", i.group.padEnd(6), i.key.padEnd(14), JSON.stringify({ npv: i.npv, year: i.year, latest: i.latestYear, wait: i.waitNext, low: i.lowDemandNpv, alone: i.alone, value: i.valuePer1000, fill: i.fill, lost: i.lostPV, after: i.after })));
  check("example: every item is proved", r.items.every((i) => i.proved), r.solves);
  check("example: Valencia comes first: start by 2030, value about $8M, and a year later costs money", v && v.group === "by" && v.after.length === 0 && v.year === 3 && v.latestYear >= 3 && Math.abs(v.npv - 8.0e6) < 0.1e6 && v.waitNext > 0.3e6, v && { y: v.year, l: v.latestYear, n: v.npv, w: v.waitNext });
  check("example: Valencia still pays if demand comes in 10% lower", v && v.lowDemandNpv > 0, v && v.lowDemandNpv);
  check("example: Cape Town is priced on top of Valencia, and loses money alone", c && c.after.join() === "d-vlc:c1" && c.alone < 0 && c.npv > 0, c && { n: c.npv, a: c.alone, g: c.group });
  check("example: Rosario and Penang are as valuable as Valencia and have no option: define one", ["d-ros:define", "d-pen:define"].every((k) => pick(k) && pick(k).group === "now" && pick(k).valuePer1000 > 100000));
  check("example: Dhaka and Manila carry the shortfall", ["m-dac:short", "m-mnl:short"].every((k) => pick(k) && pick(k).group === "watch"));
  check("example: Jebel Ali's bay is not a decision for today: far off, paid mostly after the horizon, and left out of the plan", pick("w-ae:c1") && pick("w-ae:c1").group === "watch" && pick("w-ae:c1").reason === "late" && pick("w-ae:c1").tailShare > 0.5 && !(c && c.after.includes("w-ae:c1")), pick("w-ae:c1") && { n: pick("w-ae:c1").npv, t: pick("w-ae:c1").tailShare, y: pick("w-ae:c1").year });
  check("example: nothing with a negative NPV is recommended", r.items.filter((i) => i.group === "now" || i.group === "by").every((i) => i.kind !== "build" || i.npv > 0));
  console.log(pass + "/" + (pass + fail) + " checks passed");
  process.exit(fail ? 1 : 0);
})();
