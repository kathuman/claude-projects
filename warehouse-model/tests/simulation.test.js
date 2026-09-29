// Tests for web/src/simulation.js — run with:  node warehouse-model/tests/simulation.test.js
const path = require("path");
const fs = require("fs");
const calc = require("../web/src/calculations.js");
const sim = require("../web/src/simulation.js");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/parameters.json"), "utf8"));
const RT = data.rack_types;
const base = {};
for (const k in data.parameters) base[k] = data.parameters[k].value;
const withP = (o) => Object.assign({}, base, o);
const run = (o, opts) => { const q = withP(o); return sim.simulateDay(q, calc.computeAll(q, RT), opts); };

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  → " + detail : "")); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- hourly profile
[1, 1.3, 1.5, 2, 2.5, 3].forEach((pf) => [8, 16, 24].forEach((H) => {
  const f = sim.hourlyProfile(H, pf), m = f.reduce((a, b) => a + b, 0) / f.length;
  check(`profile ${H} h × ${pf}: mean 1, peak ${pf}, floor ≥ 5%`, f.length === H && near(m, 1, 1e-9) && near(Math.max(...f), pf, 1e-9) && Math.min(...f) >= 0.05 - 1e-9,
    `mean ${m.toFixed(4)} max ${Math.max(...f).toFixed(3)} min ${Math.min(...f).toFixed(3)}`);
}));

// ---------------------------------------------------------------- determinism and conservation
{
  const a = run({}, { seed: 7 }), b = run({}, { seed: 7 }), c = run({}, { seed: 8 });
  check("same seed → identical day", JSON.stringify(a.hourly) === JSON.stringify(b.hourly) && a.meanWait === b.meanWait);
  check("different seed → different day", JSON.stringify(a.hourly) !== JSON.stringify(c.hourly));
  let ok = true, detail = "";
  for (let s = 1; s <= 40; s++) {
    const q = withP({ daily_throughput_pallets: 400 + 60 * s, dual_command_share: (s * 17) % 100, storage_policy: s % 2 ? "abc" : "random", flow_layout: s % 3 ? "i_flow" : "u_flow" });
    const d = sim.simulateDay(q, calc.computeAll(q, RT), { seed: s, log: true });
    const arrIn = d.hourly.reduce((x, h) => x + h.arrIn, 0), arrOut = d.hourly.reduce((x, h) => x + h.arrOut, 0);
    const docked = d.log.trucks.filter((t) => t.docked !== undefined).length, left = d.log.trucks.filter((t) => t.left !== undefined).length;
    // every pallet that arrived is stored, every ordered pallet fetched, every truck served and gone
    if (d.unfinished !== 0 || d.moves !== (arrIn + arrOut) * q.pallets_per_truck || docked !== d.trucks || left !== d.trucks) { ok = false; detail = `seed ${s}: moves ${d.moves} vs ${(arrIn + arrOut) * q.pallets_per_truck}, unfinished ${d.unfinished}, docked ${docked}/${d.trucks}, left ${left}`; break; }
    // no truck leaves before it docked; no lift truck does two tasks at once
    if (d.log.trucks.some((t) => t.left < t.docked || t.docked < t.arrived)) { ok = false; detail = "time order, seed " + s; break; }
    const byLift = {};
    d.log.tasks.forEach((k) => { (byLift[k.lift] = byLift[k.lift] || []).push(k); });
    for (const l in byLift) { const ts = byLift[l].sort((x, y) => x.t0 - y.t0); for (let i = 1; i < ts.length; i++) if (ts[i].t0 < ts[i - 1].t1 - 1e-6) { ok = false; detail = "lift overlap, seed " + s; } }
    if (!ok) break;
  }
  check("40 varied days: every pallet stored/fetched, every truck served, events in order, no lift double-booked", ok, detail);
}

// ---------------------------------------------------------------- light load: nobody waits
{
  const d = run({ daily_throughput_pallets: 100, num_receiving_docks: 10, num_shipping_docks: 10 }, { seed: 3, liftTrucks: 6 });
  check("light load: no truck waits, nothing left at close", d.maxWait === 0 && d.backlogAtClose === 0, `max wait ${d.maxWait}, backlog ${d.backlogAtClose}`);
}

// ---------------------------------------------------------------- lift-truck workload matches the analytic model
{
  // busy lift-truck time per pallet move = analytic time per move ÷ efficiency
  const cases = [{}, { storage_policy: "abc", flow_layout: "u_flow" }, { dual_command_share: 60, flow_layout: "u_flow" }, { rack_type: "double_deep", aisle_width: 3, mid_cross_aisles: 1, dual_command_share: 40 }];
  cases.forEach((o, i) => {
    const q = withP(Object.assign({ peak_hour_factor: 1, operating_hours_per_day: 20 }, o)), r = calc.computeAll(q, RT);
    let busy = 0, moves = 0, dc = 0;
    for (let s = 1; s <= 30; s++) {
      const d = sim.simulateDay(q, r, { seed: s, log: true, liftTrucks: 12 });
      d.log.tasks.forEach((k) => { busy += k.t1 - k.t0; moves += k.kind === "D" ? 2 : 1; if (k.kind === "D") dc += 2; });
    }
    // compare at the dual-command share the simulation actually achieved (pairs need both tasks waiting at once)
    const sh = dc / moves, t = r.travel;
    const simPerMove = busy / moves, analytic = ((1 - sh) * t.cycleTime + sh * t.dcCycle / 2) / q.truck_efficiency;
    check(`lift-truck time per move ≈ analytic (case ${i + 1})`, Math.abs(simPerMove - analytic) / analytic < 0.04, simPerMove.toFixed(1) + " vs " + analytic.toFixed(1) + " s");
  });
}

// ---------------------------------------------------------------- receiving-door queue ≈ the analytic (Allen–Cunneen) wait
{
  // steady arrivals (peak factor 1) over a long day, plenty of lift trucks so only the doors matter
  [{ num_receiving_docks: 1, daily_throughput_pallets: 520 }, { num_receiving_docks: 2, daily_throughput_pallets: 1300 }, { num_receiving_docks: 3, daily_throughput_pallets: 2000 }].forEach((o, i) => {
    const q = withP(Object.assign({ peak_hour_factor: 1, operating_hours_per_day: 24 }, o)), r = calc.computeAll(q, RT);
    let w = 0, n = 0;
    for (let s = 1; s <= 120; s++) { const d = sim.simulateDay(q, r, { seed: s, liftTrucks: 30 }); w += d.meanWaitIn; n++; }
    const simW = w / n, an = r.throughput.inbound.waitMin;
    check(`door wait ≈ Allen–Cunneen, ${o.num_receiving_docks} door(s) at ${r.throughput.inbound.utilizationPct.toFixed(0)}% (simulated ${simW.toFixed(1)} vs ${an.toFixed(1)} min)`, Math.abs(simW - an) / an < 0.3);
  });
}

// ---------------------------------------------------------------- too few lift trucks: work spills past closing, outbound trucks held up
{
  const q = withP({ daily_throughput_pallets: 1600 }), r = calc.computeAll(q, RT);
  const ok = sim.runMonteCarlo(q, r, { replications: 12 }), few = sim.runMonteCarlo(q, r, { replications: 12, liftTrucks: 2 });
  // a truck arriving just before closing still has to be unloaded and put away, so some overtime is inherent
  check("fleet sized by the analytic model finishes within a truck turn (+30 min) of closing", ok.summary.overtime.mean < q.truck_turn_time + 30, ok.summary.overtime.mean.toFixed(0) + " min");
  check("two lift trucks: big backlog and overtime", few.summary.backlogAtClose.mean > 100 && few.summary.overtime.mean > 60, few.summary.backlogAtClose.mean.toFixed(0) + " tasks, " + few.summary.overtime.mean.toFixed(0) + " min");
  check("two lift trucks: outbound trucks wait longer (door blocked by slow loading)", few.summary.meanWait.mean > ok.summary.meanWait.mean);
  check("dual share achieved is reported and below the share asked for", (() => { const qq = withP({ dual_command_share: 60, flow_layout: "u_flow" }); const d = sim.simulateDay(qq, calc.computeAll(qq, RT), { seed: 2 }); return d.dualShareAchieved > 0 && d.dualShareAchieved <= 0.6 + 1e-9; })());
  check("Monte Carlo ranges are ordered", ["meanWait", "liftUtil", "maxYard"].every((m) => ok.summary[m].p10 <= ok.summary[m].mean + 1e-9 && ok.summary[m].mean <= ok.summary[m].p90 + 1e-9));
  check("hourly means cover the operating day", ok.hourly.length >= q.operating_hours_per_day);
}

// ---------------------------------------------------------------- degenerate designs don't hang
{
  const t0 = Date.now();
  const d = run({ warehouse_length: 40, cross_aisle_width: 12, bay_width: 3.6 }, { seed: 1 });
  check("no storage cells: simulation still finishes", d.unfinished === 0 && Date.now() - t0 < 5000);
  const big = run({ daily_throughput_pallets: 5000, num_receiving_docks: 1, num_shipping_docks: 1 }, { seed: 1 });
  check("hopeless doors: stops, reports the leftover queue", big.yardAtClose > 0 || big.unfinished > 0);
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
