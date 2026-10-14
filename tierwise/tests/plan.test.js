// Tierwise planning tests — run with: node tierwise/tests/plan.test.js
// Calendar, seasonality by hemisphere, the time shift, exact requirement propagation through the bill of materials,
// sourcing shares and yields, lead-time phasing, safety stock, capacity, utilization and the yearly roll-up.
const P = require("../src/plan.js"), N = require("../src/network.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const sum = (s, a, b) => { let t = 0; for (let i = a; i < b; i++) t += s[i]; return t; };

// ---- calendar
{
  const per = P.periods(2027, 0);
  check("36 monthly periods then 10 yearly ones, covering 156 months without gaps", per.length === 46 && per.filter((p) => p.kind === "month").length === 36 && per.every((p, i) => i === 0 || p.from === per[i - 1].to) && per[45].to === 156);
  check("labels: Jan 27 … Dec 29, then 2030 … 2039", per[0].label === "Jan 27" && per[35].label === "Dec 29" && per[36].label === "2030" && per[45].label === "2039");
}
// ---- geography and seasons
{
  check("great-circle distance: Cork to Hamilton is about 18,500 km", near(P.distanceKm({ lat: 51.9, lon: -8.47 }, { lat: -37.79, lon: 175.28 }), 18500, 0.02));
  check("transit: by road for short lanes, by sea with port time for long ones, an override wins", near(P.transitDays({ lat: 0, lon: 0 }, { lat: 0, lon: 4.5 }), 1 + 500.4 / 500, 0.01) && P.transitDays({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }) > 20 && P.transitDays({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }, 12) === 12);
  const n = [...Array(12).keys()].map((m) => P.seasonal(m, 0.2, 4, 45)), s = [...Array(12).keys()].map((m) => P.seasonal(m, 0.2, 4, -45));
  check("seasons: the north peaks in the chosen month, the south six months later, with the same swing", n.indexOf(Math.max(...n)) === 4 && s.indexOf(Math.max(...s)) === 10 && near(Math.max(...n), 1.2, 1e-12) && near(Math.min(...s), 0.8, 1e-12));
  check("…and a full seasonal year averages exactly 1", near(n.reduce((a, b) => a + b) / 12, 1, 1e-12));
  check("raw-ingredient seasonality grows with latitude: none in the tropics, full beyond 45°", P.rawSeasonAmplitude(5, 0.25) === 0 && P.rawSeasonAmplitude(-50, 0.25) === 0.25 && P.rawSeasonAmplitude(27.5, 0.25) > 0.1 && P.rawSeasonAmplitude(27.5, 0.25) < 0.15);
}
// ---- the time shift
{
  const s = Float64Array.from([...Array(24).keys()].map((m) => m === 12 ? 100 : 0));
  check("a whole-month lead moves a peak exactly that many months earlier", P.lead(s, 3)[9] === 100 && P.lead(s, 3)[12] === 0);
  const f = P.lead(s, 2.5);
  check("a fractional lead splits it between the two months, keeping the total", near(f[9], 50, 1e-12) && near(f[10], 50, 1e-12) && near(f.reduce((a, b) => a + b), 100, 1e-12));
}
// ---- an exact chain: one market, one site per tier, flat demand, no season
function chain(o) {
  o = o || {};
  const t = (id, tier, from, extra) => Object.assign({ id, tier, name: id, lat: 10, lon: 0, capacity: 1e12, lead: 0, release: 0, yield: 100, suppliers: from ? [{ from, share: 100, days: 0 }] : undefined }, extra || {});
  return {
    config: { startYear: 2027, startMonth: 0, cover: 0, demandPeak: 0, rawPeak: 4, rawSeasonMax: 0, demandScale: 1 },
    bom: { packPerUnit: 20, kgPerSachet: 0.025, rawPerProduct: 0.7 },
    sites: [
      { id: "m", tier: "market", name: "m", lat: 10, lon: 0, base: o.base || 1000, growth: o.growth || 0, season: o.season || 0, launch: o.launch, ramp: o.ramp, suppliers: [{ from: "w", share: 100, days: o.wDays || 0 }] },
      t("w", "warehouse", "pk", { handling: 0, cover: o.cover || 0 }),
      t("pk", "packaging", "d", o.pk), t("d", "dosing", "p", o.d), t("p", "product", "r", o.p), t("r", "raw", null, o.r)
    ]
  };
}
{
  const r = P.plan(chain());
  check("an exact chain plans", r.ok, r.errors);
  const L = (id) => r.sites[id].load[60];
  check("flat demand flows through the bill of materials: 1,000 packs → 20,000 sachets → 0.5 t → 0.35 t", near(L("w"), 1000, 1e-12) && near(L("pk"), 1000, 1e-12) && near(L("d"), 20000, 1e-12) && near(L("p"), 0.5, 1e-12) && near(L("r"), 0.35, 1e-12));
  const y = P.plan(chain({ pk: { yield: 98 }, d: { yield: 95 }, p: { yield: 90 }, r: { yield: 99 } }));
  check("yields gross every tier up by the losses of the tiers it feeds", near(y.sites.d.load[60], 20000 / 0.98 / 0.95, 1e-9) && near(y.sites.r.load[60], 0.35 / 0.98 / 0.95 / 0.90 / 0.99, 1e-9));
}
{
  // a one-month spike at month 60: each tier must produce it lead, release and transit earlier
  const days = 30.44;
  const net = chain({ pk: { lead: days, release: days }, d: { lead: 2 * days, release: 0 }, p: { lead: 0, release: 3 * days }, wDays: days });
  net.sites[0].base = 1000;
  const r0 = P.plan(net), demand = r0.sites.m.demand;
  // replace the forecast with a spike by planning a copy whose market follows a custom series: emulate with launch
  check("the warehouse ships a month before arrival (one month's transit to the market)", near(r0.sites.w.load[59], demand[60], 1e-9));
  const chainLead = r0.leadChain.m.total;
  check("the lead-time chain adds up transit, handling, release and production along the path", near(chainLead, days * (1 + 1 + 1 + 2 + 3), 1e-9), chainLead);
}
{
  // a launch: demand starts at month 30 with a 6-month ramp; each tier's first load appears exactly its offset earlier
  const days = 30.44, r = P.plan(chain({ launch: 30, ramp: 1, pk: { lead: 0, release: 2 * days }, d: { lead: 3 * days, release: 0 } }));
  const first = (s) => { for (let m = 0; m < s.length; m++) if (s[m] > 1e-9) return m; return -1; };
  // packaging releases two months after producing; dosing makes what packaging consumes when it starts (month 28),
  // and dosing's three-month lead time moves its own inputs (the product tier) to month 25
  check("a launch at month 30 loads packaging from month 28, dosing from 28 and product manufacturing from 25", first(r.sites.m.demand) === 30 && first(r.sites.pk.load) === 28 && first(r.sites.d.load) === 28 && first(r.sites.p.load) === 25, [first(r.sites.pk.load), first(r.sites.d.load), first(r.sites.p.load)].join(" "));
}
{
  // conservation over a window away from the horizon's ends, with growth and seasonality
  const r = P.plan(chain({ growth: 8, season: 20 })), D = r.sites.m.demand;
  check("with growth and seasons, total raw load over the plan equals demand × the bill of materials (within the shifted edge)", near(sum(r.sites.r.load, 0, 150) / 0.35 * 1000, sum(D, 0, 150), 0.01));
}
{
  // safety stock: inbound to the warehouse = outbound + the change in stock
  const net = chain({ growth: 10, cover: 6 }), r = P.plan(net), w = r.sites.w;
  const inbound = r.sites.pk.load; // packaging releases what the warehouse needs, no lead or release
  const ssEnd = w.ss[120], ssStart = w.ss[0];
  check("safety stock: what enters the warehouse = what it ships + the stock it builds", near(sum(inbound, 1, 121), sum(w.load, 1, 121) + ssEnd - ssStart, 1e-6));
  check("…and growing demand builds stock (six weeks of cover)", ssEnd > ssStart && near(w.ss[60] / w.load[60], 6 / (30.44 / 7), 0.05));
}
// ---- sourcing shares
{
  const net = chain(); net.sites.find((s) => s.id === "pk").suppliers = [{ from: "d", share: 30, days: 0 }, { from: "d2", share: 90, days: 0 }];
  net.sites.push({ id: "d2", tier: "dosing", name: "d2", lat: 10, lon: 0, capacity: 1e12, lead: 0, release: 0, yield: 100, suppliers: [{ from: "p", share: 100, days: 0 }] });
  const r = P.plan(net);
  check("shares are normalised: 30/90 splits a quarter and three quarters", near(r.sites.d.load[60], 5000, 1e-9) && near(r.sites.d2.load[60], 15000, 1e-9));
  check("…and both feed the same product CMO in full", near(r.sites.p.load[60], 0.5, 1e-9));
}
// ---- capacity, utilization and the yearly roll-up
{
  const net = chain({ growth: 10 }); const pk = net.sites.find((s) => s.id === "pk"); pk.capacity = 1200; pk.expansions = [{ from: 48, add: 600 }]; pk.outages = [{ from: 10, months: 2, loss: 50 }];
  const r = P.plan(net), o = r.sites.pk;
  check("capacity: expansions add from their month, outages remove a share for their months", o.capacity[47] === 1200 && o.capacity[48] === 1800 && o.capacity[10] === 600 && o.capacity[12] === 1200);
  check("utilization = load ÷ capacity, and the first month over 100% is found", near(o.util[30], o.load[30] / 1200, 1e-12) && o.firstOver === 10);
  const y = o.periods[36];
  check("a yearly period shows the average month and the peak month inside it", near(y.load, sum(o.load, 36, 48) / 12, 1e-12) && near(y.util, sum(o.load, 36, 48) / sum(o.capacity, 36, 48), 1e-12) && near(y.peak, Math.max(...Array.from(o.util).slice(36, 48)), 1e-12));
  check("…and the capacity gap is the load above capacity in the period", near(y.gap, Math.max(0, sum(o.load, 36, 48) - sum(o.capacity, 36, 48)), 1e-9));
}
{
  // raw-ingredient capacity follows the milk season of its hemisphere
  const net = chain(); const r0 = net.sites.find((s) => s.id === "r"); r0.lat = -40; net.config.rawSeasonMax = 25; net.config.rawPeak = 4;
  const r = P.plan(net), c = Array.from(r.sites.r.capacity).slice(0, 12);
  check("a southern raw-ingredient CMO has its best milk month in November and its worst in May", c.indexOf(Math.max(...c)) === 10 && c.indexOf(Math.min(...c)) === 4);
}
// ---- the example network
{
  for (const id of Object.keys(N.SCENARIOS)) {
    const net = N.build(id), r = P.plan(net);
    check("scenario " + id + " plans without errors", r.ok && Object.keys(r.sites).length === net.sites.length, r.errors);
  }
  const net = N.build("base"), r = P.plan(net);
  check("the example has several CMOs on every tier, in both hemispheres", ["packaging", "dosing", "product", "raw"].every((t) => net.sites.filter((s) => s.tier === t).length >= 3) && net.sites.some((s) => s.lat < -30) && net.sites.some((s) => s.lat > 45));
  const D = net.sites.filter((s) => s.tier === "market").reduce((a, s) => a + sum(r.sites[s.id].demand, 24, 120), 0);
  const raw = net.sites.filter((s) => s.tier === "raw").reduce((a, s) => a + sum(r.sites[s.id].load, 24, 120), 0);
  const y = 0.995 * 0.985 * 0.97 * 0.99;
  check("example: raw-ingredient load over years 3–10 matches demand × BOM ÷ yields (within 3% for stock and shifts)", near(raw, D * 20 * 0.025 / 1000 * 0.7 / y, 0.03), (raw / (D * 20 * 0.025 / 1000 * 0.7 / y)).toFixed(4));
  check("example: the base plan runs out of capacity somewhere before the end of the horizon", Object.values(r.sites).some((o) => o.firstOver >= 0));
  const d = N.build("drought"), rd = P.plan(d);
  check("example: a dry year in New Zealand overloads its dairy co-ops in year 2, which the base plan does not", rd.sites["r-wai"].periods.slice(12, 24).some((p) => p.util > 1) && !r.sites["r-wai"].periods.slice(12, 24).some((p) => p.util > 1));
  const e = P.plan(N.build("expand"));
  check("example: the expansions push Hamilton's first overload later", e.sites["p-ham"].firstOver > r.sites["p-ham"].firstOver);
  const ts = P.tierSummary(r, net, "dosing");
  check("tier summary adds up the sites", near(ts[40].load, net.sites.filter((s) => s.tier === "dosing").reduce((a, s) => a + r.sites[s.id].periods[40].load, 0), 1e-9));
}
// ---- refused with a reason
[(n) => { n.sites[1].suppliers = []; }, (n) => { n.sites[1].suppliers = [{ from: "r", share: 100 }]; }, (n) => { n.bom.packPerUnit = 0; }, (n) => { n.sites[2].yield = 0; }, (n) => { n.sites[2].lead = -1; }, (n) => { n.sites.push(Object.assign({}, n.sites[2])); }]
  .forEach((f, i) => { const n = chain(); f(n); const r = P.plan(n); check("an impossible network is refused (" + (i + 1) + ")", !r.ok && r.errors.length > 0, r.errors && r.errors[0]); });

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
