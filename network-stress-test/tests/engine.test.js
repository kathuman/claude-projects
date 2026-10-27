// Network Stress Test engine checks — run with: node network-stress-test/tests/engine.test.js
// The min-cost-flow solver against optimality certificates that do not depend on how it was computed (no augmenting
// path left = maximum flow; no negative-cost cycle in the residual graph = minimum cost) and against an independent
// Edmonds–Karp maximum flow; the network layer (node capacities, sequential product priority, disable and derate);
// the N-1 scan against a brute-force scan of every element; the adversarial search against the N-1 scan; Monte
// Carlo at its limits and under a fixed seed; the Time-to-Survive arithmetic; and the generator's integrity.
const path = require("path");
const src = (m) => require(path.join(__dirname, "..", "web", "src", m));
const { MinCostFlow } = src("flowSolver.js");
const { solveNetwork } = src("network.js");
const { runContingencyScan } = src("graphAnalysis.js");
const { runAdversarialSearch } = src("adversarial.js");
const { runMonteCarlo } = src("monteCarlo.js");
const { runResilienceCheck } = src("resilienceSim.js");
const { generateNetwork } = src("generator.js");

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol);

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- solver: certificates and an independent max flow
// Independent maximum flow (Edmonds–Karp, BFS augmenting paths) on a plain capacity list.
function edmondsKarp(n, arcs, s, t) {
  const cap = Array.from({ length: n }, () => new Map());
  arcs.forEach(([u, v, c]) => { cap[u].set(v, (cap[u].get(v) || 0) + c); if (!cap[v].has(u)) cap[v].set(u, 0); });
  let flow = 0;
  for (;;) {
    const prev = new Array(n).fill(-1); prev[s] = s; const q = [s];
    while (q.length && prev[t] === -1) { const u = q.shift(); cap[u].forEach((c, v) => { if (c > 1e-9 && prev[v] === -1) { prev[v] = u; q.push(v); } }); }
    if (prev[t] === -1) return flow;
    let aug = Infinity; for (let v = t; v !== s; v = prev[v]) aug = Math.min(aug, cap[prev[v]].get(v));
    for (let v = t; v !== s; v = prev[v]) { cap[prev[v]].set(v, cap[prev[v]].get(v) - aug); cap[v].set(prev[v], cap[v].get(prev[v]) + aug); }
    flow += aug;
  }
}
// Residual-graph certificates computed from the solver's final edge flows alone.
function certify(g, s, t) {
  const n = g.n, res = [];
  let capOK = true, consOK = true;
  const net = new Array(n).fill(0);
  for (let i = 0; i < g.edges.length; i += 2) {
    const e = g.edges[i], from = g.edges[i + 1].to;
    if (e.flow < -1e-9 || e.flow > e.cap + 1e-9) capOK = false;
    net[from] -= e.flow; net[e.to] += e.flow;
    if (e.cap - e.flow > 1e-9) res.push([from, e.to, e.cost]);
    if (e.flow > 1e-9) res.push([e.to, from, -e.cost]);
  }
  for (let v = 0; v < n; v++) if (v !== s && v !== t && Math.abs(net[v]) > 1e-6) consOK = false;
  // reachability of t from s in the residual graph
  const adj = Array.from({ length: n }, () => []); res.forEach(([u, v]) => adj[u].push(v));
  const seen = new Array(n).fill(false); seen[s] = true; const q = [s];
  while (q.length) { const u = q.shift(); adj[u].forEach((v) => { if (!seen[v]) { seen[v] = true; q.push(v); } }); }
  // Bellman–Ford from a virtual source: any relaxation in round n means a negative cycle
  const d = new Array(n).fill(0); let negCycle = false;
  for (let it = 0; it <= n; it++) {
    let changed = false;
    for (const [u, v, c] of res) if (d[u] + c < d[v] - 1e-7) { d[v] = d[u] + c; changed = true; }
    if (!changed) break; if (it === n) negCycle = true;
  }
  return { capOK, consOK, maxFlow: !seen[t], minCost: !negCycle, outOfS: -net[s] };
}
function randomInstance(seed, n, density) {
  const r = rng(seed), arcs = [];
  for (let u = 0; u < n; u++) for (let v = 0; v < n; v++) if (u !== v && r() < density) arcs.push([u, v, 1 + Math.floor(r() * 40), Math.floor(r() * 20)]);
  return arcs;
}
{
  // a hand case: two paths, the cheap one is the bottleneck, overflow spills to the dear one
  const g = new MinCostFlow(4); g.addEdge(0, 1, 5, 1); g.addEdge(1, 3, 5, 1); g.addEdge(0, 2, 10, 5); g.addEdge(2, 3, 10, 5);
  const r = g.run(0, 3, 8);
  check("solver: cheap path filled first, the remainder spills to the dear one", r.flow === 8 && r.cost === 5 * 2 + 3 * 10, r.flow + " units at cost " + r.cost);
  const g2 = new MinCostFlow(3); g2.addEdge(0, 1, 4, 1);
  check("solver: a disconnected sink gets nothing and the solver stops", g2.run(0, 2, 10).flow === 0);
  const g3 = new MinCostFlow(3); g3.addEdge(0, 1, 4, 1); g3.addEdge(1, 2, 3, 1);
  check("solver: demand above the cut is capped at the cut", g3.run(0, 2, 10).flow === 3);
}
{
  let allCap = true, allCons = true, allMax = true, allMin = true, allEK = true, worst = "";
  for (let k = 0; k < 60; k++) {
    const n = 6 + (k % 10), arcs = randomInstance(1000 + k, n, 0.35);
    const g = new MinCostFlow(n); arcs.forEach(([u, v, c, w]) => g.addEdge(u, v, c, w));
    const r = g.run(0, n - 1, Infinity);
    const c = certify(g, 0, n - 1);
    const ek = edmondsKarp(n, arcs.map(([u, v, cc]) => [u, v, cc]), 0, n - 1);
    allCap = allCap && c.capOK; allCons = allCons && c.consOK; allMax = allMax && c.maxFlow; allMin = allMin && c.minCost;
    if (!near(r.flow, ek)) { allEK = false; worst = "instance " + k + ": " + r.flow + " vs " + ek; }
  }
  check("solver: 60 random graphs respect every arc capacity", allCap);
  check("solver: 60 random graphs conserve flow at every interior node", allCons);
  check("solver: no augmenting path remains (maximum-flow certificate)", allMax);
  check("solver: the flow equals an independent Edmonds–Karp maximum flow", allEK, worst || "60/60 equal");
  check("solver: no negative-cost cycle in the residual graph (minimum-cost certificate)", allMin);
  // capped runs: a min-cost flow of a given value has no negative residual cycle either
  let cappedMin = true;
  for (let k = 0; k < 40; k++) {
    const n = 8, arcs = randomInstance(5000 + k, n, 0.4);
    const g = new MinCostFlow(n); arcs.forEach(([u, v, c, w]) => g.addEdge(u, v, c, w));
    g.run(0, n - 1, 1 + (k % 15));
    cappedMin = cappedMin && certify(g, 0, n - 1).minCost;
  }
  check("solver: flows below the maximum are also minimum-cost for their value", cappedMin);
}

// ---------------------------------------------------------------- network layer
const P = (id, priority) => ({ id, name: id, priority });
function chain() {
  // P1 → W1 → C1 and P2 → W1 → C2, W1 is the shared hub; a direct dear lane P2 → C1 backs it up
  return {
    products: [P("A", 1)],
    nodes: [
      { id: "P1", type: "production", products: { A: 100 } },
      { id: "P2", type: "production", products: { A: 60 } },
      { id: "W1", type: "warehouse", products: { A: 120 } },
      { id: "C1", type: "consumer", products: { A: 80 } },
      { id: "C2", type: "consumer", products: { A: 50 } },
    ],
    edges: [
      { id: "e1", from: "P1", to: "W1", capacity: 100, costPerUnit: 1, meanDisruptionDays: 20 },
      { id: "e2", from: "P2", to: "W1", capacity: 60, costPerUnit: 1 },
      { id: "e3", from: "W1", to: "C1", capacity: 80, costPerUnit: 1 },
      { id: "e4", from: "W1", to: "C2", capacity: 50, costPerUnit: 1 },
      { id: "e5", from: "P2", to: "C1", capacity: 30, costPerUnit: 9 },
    ],
  };
}
{
  const net = chain();
  const b = solveNetwork(net, null);
  check("network: the hub's own capacity (120) binds below total supply (160) and demand (130)",
    near(b.overall.totalFlow, 130) && near(b.perProduct.A.edgeFlows.e5, 10), "flow " + b.overall.totalFlow + ", dear lane carries " + b.perProduct.A.edgeFlows.e5);
  const offHub = solveNetwork(net, { disabledNodes: new Set(["W1"]) });
  check("network: disabling the hub leaves only the 30-unit bypass", near(offHub.overall.totalFlow, 30));
  const derated = solveNetwork(net, { derate: { W1: 0.5 } });
  check("network: derating the hub to 50% passes 60 through it plus 30 on the bypass", near(derated.overall.totalFlow, 90));
  const lane = solveNetwork(net, { disabledEdges: new Set(["e3"]) });
  check("network: cutting the hub→C1 lane leaves C1 only the bypass", near(lane.perProduct.A.consumerFulfillment.C1.received, 30) && near(lane.perProduct.A.consumerFulfillment.C2.received, 50));
  check("network: service level is flow over demand", near(b.overall.serviceLevelPct, 100) && near(offHub.overall.serviceLevelPct, 30 / 130 * 100));
}
{
  // two products competing for one lane: the higher priority (lower number) claims it first
  const net = {
    products: [P("LOW", 2), P("HIGH", 1)],
    nodes: [
      { id: "P", type: "production", products: { LOW: 100, HIGH: 100 } },
      { id: "C", type: "consumer", products: { LOW: 70, HIGH: 70 } },
    ],
    edges: [{ id: "L", from: "P", to: "C", capacity: 100, costPerUnit: 1 }],
  };
  const r = solveNetwork(net, null);
  check("network: the priority product takes its full 70 and the other gets the 30 left", near(r.perProduct.HIGH.totalFlow, 70) && near(r.perProduct.LOW.totalFlow, 30));
}

// ---------------------------------------------------------------- N-1 scan vs brute force over every element
{
  const net = chain();
  const scan = runContingencyScan(net);
  const base = solveNetwork(net, null).overall.serviceLevelPct;
  const brute = [];
  net.nodes.forEach((n) => brute.push({ id: n.id, drop: base - solveNetwork(net, { disabledNodes: new Set([n.id]) }).overall.serviceLevelPct }));
  net.edges.forEach((e) => brute.push({ id: e.id, drop: base - solveNetwork(net, { disabledEdges: new Set([e.id]) }).overall.serviceLevelPct }));
  brute.sort((a, b) => b.drop - a.drop);
  check("N-1: the worst element matches a brute-force scan of every node and edge", scan.results[0].id === brute[0].id && near(scan.results[0].serviceLevelDropPct, brute[0].drop),
    scan.results[0].id + " drops " + scan.results[0].serviceLevelDropPct.toFixed(1) + " points");
  const scanned = new Map(scan.results.map((r) => [r.id, r.serviceLevelDropPct]));
  check("N-1: every element the scan skips really costs nothing when removed", brute.filter((x) => !scanned.has(x.id)).every((x) => x.drop <= 1e-9));
  check("N-1: every scanned drop equals the brute-force drop", brute.filter((x) => scanned.has(x.id)).every((x) => near(scanned.get(x.id), x.drop)));
  check("N-1: results are ranked worst first", scan.results.every((r, i) => i === 0 || scan.results[i - 1].serviceLevelDropPct >= r.serviceLevelDropPct - 1e-12));
}
{
  // the same equivalence on generated networks, where the active-element filter does real work
  let ok = true, detail = "";
  for (const seed of [3, 11, 29]) {
    const net = generateNetwork({ seed, numProduction: 4, numWarehouse: 5, numConsumer: 10, numProducts: 2 });
    const scan = runContingencyScan(net);
    const base = solveNetwork(net, null).overall.serviceLevelPct;
    let worst = 0;
    net.nodes.forEach((n) => { worst = Math.max(worst, base - solveNetwork(net, { disabledNodes: new Set([n.id]) }).overall.serviceLevelPct); });
    net.edges.forEach((e) => { worst = Math.max(worst, base - solveNetwork(net, { disabledEdges: new Set([e.id]) }).overall.serviceLevelPct); });
    if (!near(scan.results[0].serviceLevelDropPct, worst, 1e-6)) { ok = false; detail = "seed " + seed + ": " + scan.results[0].serviceLevelDropPct + " vs " + worst; }
  }
  check("N-1: on three generated networks the filtered scan finds the brute-force worst case", ok, detail || "3/3");
}

// ---------------------------------------------------------------- adversarial search
{
  const net = generateNetwork({ seed: 7, numProduction: 4, numWarehouse: 5, numConsumer: 10, numProducts: 2 });
  const scan = runContingencyScan(net, { limit: 30 });
  const adv1 = runAdversarialSearch(net, { budget: 1 });
  check("adversarial: budget 1 equals the N-1 scan's worst element", adv1.steps[1].id === scan.results[0].id && near(adv1.finalServiceLevelPct, scan.results[0].afterServiceLevelPct));
  const adv3 = runAdversarialSearch(net, { budget: 3 });
  check("adversarial: each extra element removed never raises service", adv3.steps.every((s, i) => i === 0 || s.serviceLevelPct <= adv3.steps[i - 1].serviceLevelPct + 1e-9));
  check("adversarial: cumulative drop is the sum of step drops", near(adv3.steps[adv3.steps.length - 1].cumulativeDropPct, adv3.steps.slice(1).reduce((a, s) => a + s.stepDropPct, 0), 1e-9));
  const big = runAdversarialSearch(chain(), { budget: 50 });
  check("adversarial: a large budget stops once service reaches zero", big.finalServiceLevelPct <= 1e-9 && big.steps.length < 50, (big.steps.length - 1) + " elements");
}

// ---------------------------------------------------------------- Monte Carlo
{
  const net = chain();
  const zero = runMonteCarlo(net, { trials: 50, seed: 4, nodeFailureRate: 0 });
  check("Monte Carlo: no failures reproduces the baseline in every trial", near(zero.minServiceLevelPct, 100) && near(zero.maxServiceLevelPct, 100));
  // certain failure of every production site; consumers stay up (a failed consumer removes its own demand)
  const supplyDown = chain(); supplyDown.nodes.forEach((n) => { n.baseFailureRate = n.type === "production" ? 1 : 0; });
  const all = runMonteCarlo(supplyDown, { trials: 20, seed: 4 });
  check("Monte Carlo: certain failure of every production site gives zero service", near(all.maxServiceLevelPct, 0));
  const a = runMonteCarlo(net, { trials: 200, seed: 9, nodeFailureRate: 0.2 }), b = runMonteCarlo(net, { trials: 200, seed: 9, nodeFailureRate: 0.2 });
  check("Monte Carlo: the same seed gives the same distribution", a.meanServiceLevelPct === b.meanServiceLevelPct && a.p10ServiceLevelPct === b.p10ServiceLevelPct);
  check("Monte Carlo: percentiles are ordered and inside [min, max]", a.minServiceLevelPct <= a.p10ServiceLevelPct && a.p10ServiceLevelPct <= a.p50ServiceLevelPct && a.p50ServiceLevelPct <= a.p90ServiceLevelPct && a.p90ServiceLevelPct <= a.maxServiceLevelPct);
  check("Monte Carlo: the histogram counts every trial", a.histogram.reduce((x, y) => x + y, 0) === 200);
  const lo = runMonteCarlo(net, { trials: 400, seed: 2, nodeFailureRate: 0.05 }), hi = runMonteCarlo(net, { trials: 400, seed: 2, nodeFailureRate: 0.3 });
  check("Monte Carlo: a higher failure rate lowers mean service", hi.meanServiceLevelPct < lo.meanServiceLevelPct, lo.meanServiceLevelPct.toFixed(1) + "% → " + hi.meanServiceLevelPct.toFixed(1) + "%");
}

// ---------------------------------------------------------------- Time-to-Survive vs Time-to-Recover
{
  const net = chain();
  // losing e1 (P1 → hub, recovers in 20 days) cuts hub inflow to 60; C1 and C2 share the shortfall
  const scen = { disabledEdges: new Set(["e1"]) };
  const r = runResilienceCheck(net, scen, { bufferDays: 10 });
  check("TTS/TTR: recovery time is the lane's own 20 days", r.ttrDays === 20);
  const allOK = r.perConsumer.every((c) => c.shortfallRate === 0 || near(c.ttsDays, c.bufferDays * c.receivedBefore / c.shortfallRate));
  check("TTS/TTR: every consumer's TTS = buffer days × daily receipts ÷ daily shortfall", allOK);
  check("TTS/TTR: a consumer survives exactly when TTS ≥ TTR, and the gap is TTR − TTS", r.perConsumer.every((c) => c.shortfallRate === 0 || (c.survives === (c.ttsDays >= 20) && near(c.stockoutGapDays, Math.max(0, 20 - c.ttsDays)))));
  const long = runResilienceCheck(net, scen, { bufferDays: 100 });
  check("TTS/TTR: a large enough buffer makes the same disruption survivable", long.atRiskConsumerCount === 0 && r.atRiskConsumerCount > 0, r.atRiskConsumerCount + " at risk at 10 days, " + long.atRiskConsumerCount + " at 100");
  const none = runResilienceCheck(net, { disabledEdges: new Set(["e5"]) }, {});
  check("TTS/TTR: losing an element that carries no needed flow affects nobody", none.affectedConsumerCount === 0 || none.perConsumer.every((c) => c.survives));
}

// ---------------------------------------------------------------- generator
{
  const g1 = generateNetwork({ seed: 42, numProduction: 6, numWarehouse: 8, numConsumer: 20, numProducts: 3 });
  const g2 = generateNetwork({ seed: 42, numProduction: 6, numWarehouse: 8, numConsumer: 20, numProducts: 3 });
  check("generator: the same seed gives the same network", JSON.stringify(g1) === JSON.stringify(g2));
  const ids = new Set(g1.nodes.map((n) => n.id));
  check("generator: unique node ids and every edge points at real nodes", ids.size === g1.nodes.length && g1.edges.every((e) => ids.has(e.from) && ids.has(e.to)));
  check("generator: coordinates are valid latitude and longitude", g1.nodes.every((n) => Math.abs(n.lat) <= 90 && Math.abs(n.lon) <= 180));
  const sol = solveNetwork(g1, null);
  const fed = g1.nodes.filter((n) => n.type === "consumer").filter((c) => g1.products.some((p) => sol.perProduct[p.id].consumerFulfillment[c.id].received > 0)).length;
  check("generator: every consumer receives something at baseline (coverage pass)", fed === 20, fed + "/20");
  const t0 = Date.now(); solveNetwork(generateNetwork({ seed: 5, numProduction: 30, numWarehouse: 60, numConsumer: 240, numProducts: 3 }), null);
  check("generator: a 330-node network solves in under 10 s", Date.now() - t0 < 10000, (Date.now() - t0) + " ms");
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
