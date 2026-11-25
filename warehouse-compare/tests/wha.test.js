// WH-A, moving racks: floor geometry, exact distances, the simulation against a
// hand-computed cycle, conservation, fleet sizing and put-away behaviour —
// run with:  node warehouse-compare/tests/wha.test.js
const path = require("path");
const fs = require("fs");
const wha = require("../src/layouts/wha.js");
const rmfs = require("../src/rmfs.js");
const demand = require("../src/demand.js");
const scenario = require("../src/scenario.js");
const { check, near, summary } = require("./harness.js");

const J = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/scenario.json"), "utf8"));
const inputs = scenario.resolve(J, JSON.parse(fs.readFileSync(path.join(__dirname, "../../warehouse-model/data/parameters.json"), "utf8")));
const A0 = scenario.values(J.layouts.A), sc0 = inputs.sc;

// ---------------------------------------------------------------- floor geometry and distances
function checkFloor(A, target, S, label) {
  const L = wha.build(A, target, S), pw = A.pod_width, a = A.robot_aisle_width, Z = A.station_zone;
  check(label + ": enough slots for the pods at the fill (" + L.slots.length + " ≥ " + L.pods + " / " + A.storage_fill + ")", L.slots.length >= L.pods / A.storage_fill - 1e-9);
  check(label + ": stations fit the west wall", S * A.station_spacing <= L.size.Y + 1e-9);
  check(label + ": locations ≥ target", L.locations.n >= target);
  let inside = true, clash = 0, off = 0;
  const seen = new Set();
  L.slots.forEach((s) => {
    inside = inside && s.x - pw / 2 >= Z - 1e-9 && s.x + pw / 2 <= L.size.X + 1e-9 && s.y - pw / 2 >= -1e-9 && s.y + pw / 2 <= L.size.Y + 1e-9;
    const k = Math.round(s.x * 1000) + "," + Math.round(s.y * 1000); if (seen.has(k)) clash++; seen.add(k);
    if (!near(s.offset, pw / 2 + a / 2, 1e-9)) off++;
  });
  check(label + ": every slot inside the storage area", inside);
  check(label + ": no two slots in one place", clash === 0, clash);
  check(label + ": every slot opens straight onto an aisle (offset = pod/2 + aisle/2)", off === 0, off);
  check(label + ": travel network connected", L.graph.connected());

  // closed form: station → gate on the west aisle → along it, or across a
  // horizontal aisle → up the slot's vertical aisle
  const g = L.graph, Xv0 = Z + a / 2, Yh = [];
  for (let k = 0; k <= L.grid.nR; k++) Yh.push(a / 2 + k * (A.block_length * pw + a));
  let worst = 0;
  L.depots.forEach((dk, si) => {
    const ys = L.stations[si][1], d = g.dijkstra(g.keys[dk]);
    L.slots.forEach((s) => {
      const n = g.keys[s.key], xa = g.x[n], y = g.y[n];
      const want = (Xv0 - Z / 2) + (Math.abs(xa - Xv0) < 1e-9 ? Math.abs(ys - y) : Math.abs(xa - Xv0) + Math.min(...Yh.map((h) => Math.abs(ys - h) + Math.abs(y - h))));
      worst = Math.max(worst, Math.abs(d[n] - want), Math.abs(L.toStation[L.slots.indexOf(s)][si] - (want + s.offset)));
    });
  });
  check(label + ": station → slot distances = closed form (worst " + worst.toExponential(1) + " m)", worst < 1e-6);
  return L;
}
checkFloor(A0, sc0.target_locations, 9, "default");
let rs = 99; const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x80000000; };
for (let i = 0; i < 15; i++) {
  const A = Object.assign({}, A0, { pod_width: +(0.8 + rnd()).toFixed(2), block_length: 1 + Math.floor(rnd() * 8), robot_aisle_width: +(1 + rnd() * 2).toFixed(2),
    storage_fill: +(0.6 + rnd() * 0.35).toFixed(2), station_spacing: +(3 + rnd() * 5).toFixed(1), aspect: +(0.7 + rnd() * 2).toFixed(2) });
  checkFloor(A, 500 + Math.floor(rnd() * 8000), 1 + Math.floor(rnd() * 10), "random floor " + i);
}

// ---------------------------------------------------------------- the simulation against a hand-computed cycle
{
  // one pod of 4 SKUs, one station, one robot, one order at a time, one line per order:
  // each order takes  lift + d/v + (switch + pick + setup) + d/v + lift, and the robot
  // waits under the pod (empty travel 0) — the next order can't claim it until it is home
  const A = Object.assign({}, A0, { pod_faces: 1, pod_levels: 1, bins_per_face_level: 4, block_length: 1, storage_fill: 0.5, put_away: "fixed", order_slots: 1, pipeline: 1 });
  const sc = Object.assign({}, sc0, { skus: 4, target_locations: 4, lines_per_order: 1, max_lines: 1, slotting: "ranked" });
  const L = wha.build(A, 4, 1);
  check("hand case: one pod", L.pods === 1);
  const r = rmfs.simulate(L, sc, A, { robots: 1, mode: "saturated", warmup_h: 0.5, measure_h: 2 });
  const sr = rmfs.slotRank(L), d = sr.near[sr.byNear[0]];
  const work = A.pod_switch_time + sc.pick_time_per_line + sc.order_setup_time, cycle = 2 * A.lift_time + 2 * d / A.robot_speed + work;
  check("hand case: lines = measured time / cycle (" + r.lines + " vs " + (r.T / cycle).toFixed(2) + ")", Math.abs(r.lines - r.T / cycle) <= 1);
  check("hand case: picker time per line = switch + pick + setup", near(r.timePerLine, work, 1e-9), r.timePerLine);
  check("hand case: robot travel per line = there and back, no empty travel", Math.abs(r.robotTravelPerLine - 2 * d) < 2 * d / r.lines + 1e-9 && r.emptyPerLine === 0, r.robotTravelPerLine + " vs " + 2 * d);
  check("hand case: one line per pod visit", near(r.pileOn, 1));
  check("hand case: the robot is busy the whole time", r.robotUtil > 0.98, r.robotUtil);
}

// ---------------------------------------------------------------- conservation and sanity on the default scenario
const sized = rmfs.size(sc0, A0, sc0.target_locations);
{
  const z = sized, r = z.run, L = z.layout, s = r._state;
  let stored = 0, transit = 0, bad = 0;
  for (let p = 0; p < L.pods; p++) {
    if (s.claim[p] < 0) { stored++; if (s.slotOcc[r.podSlot[p]] !== p) bad++; } else transit++;
  }
  const occ = Array.from(s.slotOcc).filter((x) => x >= 0).length;
  check("conservation: every pod stored or in use (" + stored + " + " + transit + " = " + L.pods + ")", stored + transit === L.pods);
  check("conservation: a stored pod is where its slot says", bad === 0, bad);
  check("conservation: occupied slots ≥ stored pods", occ >= stored);
  check("every SKU in exactly one pod", r.skuPod.length === sc0.skus && Array.from(r.skuPod).every((p) => p >= 0 && p < L.pods));
  check("pod shares of demand sum to 1", near(r.podW.reduce((a, b) => a + b, 0), 1, 1e-9));
  check("pile-on ≥ 1 line per visit", r.pileOn >= 1, r.pileOn);
  check("stations keep up: busy ≤ picker efficiency + 5 points (" + Math.max(...r.workerUtil).toFixed(2) + ")", Math.max(...r.workerUtil) <= sc0.picker_efficiency + 0.05);
  check("throughput = peak demand within 5% (" + r.linesPerHour.toFixed(0) + " vs " + z.peakLines.toFixed(0) + ")", Math.abs(r.linesPerHour / z.peakLines - 1) < 0.05);
  check("fleet keeps up", z.keepsUp && rmfs.keepsUp(r, A0, z.stations));
  const fewer = rmfs.simulate(L, sc0, A0, { robots: z.robotsActive - 1 });
  check("one robot fewer doesn't keep up (" + (z.robotsActive - 1) + " robots: wait " + fewer.backlogWait.toFixed(0) + " s)", !rmfs.keepsUp(fewer, A0, z.stations));
  check("robots needed = active ÷ availability", z.robotsNeeded === Math.ceil(z.robotsActive / A0.robot_availability));
  check("stations needed agrees with the time per line", z.stations === Math.max(1, Math.ceil(z.peakLines * r.timePerLine / 3600 / sc0.picker_efficiency - 1e-9)));
  const again = rmfs.size(sc0, A0, sc0.target_locations);
  check("same seed, same result", again.run.lines === r.lines && again.robotsActive === z.robotsActive);
  console.log("  default: " + z.stations + " stations, " + z.robotsNeeded + " robots, " + Math.round(L.footprint) + " m², pile-on " + r.pileOn.toFixed(2) + ", " +
    r.timePerLine.toFixed(1) + " s/line, robot " + r.robotTravelPerLine.toFixed(1) + " m/line");
}

// ---------------------------------------------------------------- put-away behaviour (same floor, same fleet, random start)
{
  const L = sized.layout, R = sized.robotsActive + 6, sc = Object.assign({}, sc0, { slotting: "random" });
  const res = {};
  ["fixed", "random", "nearest", "frequency"].forEach((pa) => { res[pa] = rmfs.simulate(L, sc, Object.assign({}, A0, { put_away: pa }), { robots: R }); });
  const f = (k) => ["fixed", "random", "nearest", "frequency"].map((pa) => pa + " " + res[pa][k].toFixed(1)).join(", ");
  check("from a random start, nearest gathers popular pods closer (" + f("podDistance") + ")", res.nearest.podDistance < 0.95 * res.random.podDistance && res.nearest.podDistance < 0.95 * res.fixed.podDistance);
  check("from a random start, frequency gathers popular pods closer", res.frequency.podDistance < 0.95 * res.random.podDistance && res.frequency.podDistance < 0.95 * res.fixed.podDistance);
  check("…and robots travel less per line (" + f("robotTravelPerLine") + ")", res.nearest.robotTravelPerLine < res.random.robotTravelPerLine && res.frequency.robotTravelPerLine < res.random.robotTravelPerLine);
  const ranked = rmfs.simulate(L, Object.assign({}, sc0, { slotting: "ranked" }), Object.assign({}, A0, { put_away: "fixed" }), { robots: R });
  check("a ranked fixed layout keeps popular pods closest (" + ranked.podDistance.toFixed(1) + ")", ranked.podDistance < res.nearest.podDistance && ranked.podDistance < res.fixed.podDistance);
}

// ---------------------------------------------------------------- pile-on grows with open orders; the shock re-deals demand
{
  const L = sized.layout, R = sized.robotsActive + 6;
  const small = rmfs.simulate(L, sc0, Object.assign({}, A0, { order_slots: 2 }), { robots: R, mode: "saturated", measure_h: 1 });
  const big = rmfs.simulate(L, sc0, Object.assign({}, A0, { order_slots: 24 }), { robots: R * 2, mode: "saturated", measure_h: 1 });
  check("pile-on grows with open orders per station (" + small.pileOn.toFixed(2) + " → " + big.pileOn.toFixed(2) + ")", big.pileOn > small.pileOn);
  // a demand shock at 3 h (popularity moves half-way down the SKU order). From a
  // ranked start: fixed is best while demand holds, then left far away for good;
  // nearest never sorts pods by popularity, so it barely notices; frequency
  // jumps, then re-learns and recovers.
  const run = (pa, shock) => rmfs.simulate(L, Object.assign({}, sc0, { slotting: "ranked" }), Object.assign({}, A0, { put_away: pa }), { robots: R, history: 600, shock: shock ? { at_h: 3 } : undefined }).history;
  const avg = (h, t0, t1) => { const xs = h.filter((x) => x.t >= t0 * 3600 && x.t <= t1 * 3600).map((x) => x.podDist); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  const H = {};
  ["fixed", "nearest", "frequency"].forEach((pa) => { H[pa] = [run(pa, false), run(pa, true)]; });
  check("before the shock, runs with and without it are identical", ["fixed", "nearest", "frequency"].every((pa) => H[pa][0].filter((x) => x.t < 3 * 3600).every((x, k) => x.podDist === H[pa][1][k].podDist)));
  const r2 = (v) => v.toFixed(1);
  check("fixed: best while demand holds (" + r2(avg(H.fixed[0], 2, 3)) + " m vs nearest " + r2(avg(H.nearest[0], 2, 3)) + ", frequency " + r2(avg(H.frequency[0], 2, 3)) + ")",
    avg(H.fixed[0], 2, 3) < avg(H.frequency[0], 2, 3) && avg(H.frequency[0], 2, 3) < avg(H.nearest[0], 2, 3));
  check("fixed: after the shock, popular pods stay far away (" + r2(avg(H.fixed[0], 4.5, 6)) + " → " + r2(avg(H.fixed[1], 4.5, 6)) + " m)", avg(H.fixed[1], 4.5, 6) > 1.5 * avg(H.fixed[0], 4.5, 6));
  check("nearest: barely notices the shock (" + r2(avg(H.nearest[0], 3, 6)) + " vs " + r2(avg(H.nearest[1], 3, 6)) + " m)", Math.abs(avg(H.nearest[1], 3, 6) / avg(H.nearest[0], 3, 6) - 1) < 0.15);
  check("frequency: the shock pushes popular pods away (" + r2(avg(H.frequency[0], 3, 3.5)) + " → " + r2(avg(H.frequency[1], 3, 3.5)) + " m)", avg(H.frequency[1], 3, 3.5) > 1.2 * avg(H.frequency[0], 3, 3.5));
  check("frequency: …and re-learns within 1.5 h (" + r2(avg(H.frequency[1], 4.5, 6)) + " m vs " + r2(avg(H.frequency[0], 4.5, 6)) + " m without a shock)", avg(H.frequency[1], 4.5, 6) < 1.2 * avg(H.frequency[0], 4.5, 6));
}

// ---------------------------------------------------------------- paired with WH-B and WH-C
{
  const a = demand.orderStream(sc0, sc0.seed), b = demand.orderStream(sc0, sc0.seed);
  let same = true; for (let o = 0; o < 100; o++) same = same && a.next().join() === b.next().join();
  check("WH-A sees the same orders as WH-B and WH-C", same);
}

// ---------------------------------------------------------------- the KPI contract
{
  const kpi = require("../src/kpi.js");
  const all = scenario.run(inputs);
  check("scenario.run evaluates A, B and C", !!(all.A && all.B && all.C));
  check("A reports every KPI in the contract", kpi.KPI_DEFS.every((d) => isFinite(all.A.kpi[d.key])));
  check("A: pickers don't walk", all.A.kpi.travelPerLine === 0 && all.A.kpi.travelShare === 0);
  check("A: pickers needed = stations", all.A.kpi.pickersNeeded === all.A.sizing.stations);
  check("A, B and C all reach the capacity target", ["A", "B", "C"].every((id) => all[id].kpi.locations >= sc0.target_locations));
  check("A has no critical warnings", all.A.warnings.every((w) => w.level !== "critical"), JSON.stringify(all.A.warnings));
  check("A's plan colours one value per slot", all.A.bayColors.cost.length === all.A.layout.slots.length && all.A.bayColors.pop.length === all.A.layout.bays.length);
  check("every trace step has label/expr/value", all.A.trace.every((t) => t.label && t.expr && t.value !== undefined && t.value !== ""));
}

summary("wha");
