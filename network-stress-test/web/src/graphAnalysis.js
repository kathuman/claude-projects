/*
 * graphAnalysis.js — N-1 contingency scanning: the power-grid-engineering
 * idea of "which single failures hurt the most", applied to a supply
 * network via the flow solver already built in network.js, rather than
 * pure graph-topology articulation points. The difference matters here:
 * a topological articulation point only says a node/edge is the sole
 * PATH between two parts of the graph, not whether that path is actually
 * carrying anything, or whether an alternate path exists with spare
 * capacity to absorb the loss. Re-solving the actual flow problem with
 * each candidate removed answers the question a stress-test tool
 * actually needs answered: how much service level is lost.
 *
 * Performance: a naive scan re-solves the whole network once per node
 * and once per edge -- infeasible at hundreds of nodes (~1500+ elements
 * x a few hundred ms each). We cut this down using a simple, provably
 * safe filter: an element that carries ZERO flow in the baseline
 * solution cannot reduce the achievable max flow if removed, because
 * the baseline solution itself is a feasible flow that already doesn't
 * use it -- removing it changes nothing about what's achievable. So we
 * only re-solve for elements that are actually carrying flow in the
 * baseline. (This can only under-count cost-side effects of losing an
 * unused cheaper detour, never miss a genuine service-level-critical
 * element.)
 */
(function (global) {
  "use strict";

  const networkMod = (typeof module !== "undefined" && module.exports)
    ? require("./network.js")
    : global.NST.network;
  const solveNetwork = networkMod.solveNetwork;

  function aggregateEdgeFlow(network, result) {
    const flow = new Map(network.edges.map((e) => [e.id, 0]));
    network.products.forEach((p) => {
      const r = result.perProduct[p.id];
      if (!r) return;
      for (const eid in r.edgeFlows) flow.set(eid, (flow.get(eid) || 0) + r.edgeFlows[eid]);
    });
    return flow;
  }

  // Which nodes/edges actually carry flow in the baseline solve -- see the
  // module comment for why this is the correct (and safe) filter.
  function findActiveElements(network, baseline) {
    const edgeFlow = aggregateEdgeFlow(network, baseline);
    const activeEdges = network.edges.filter((e) => (edgeFlow.get(e.id) || 0) > 1e-9);
    const touchedNodeIds = new Set();
    activeEdges.forEach((e) => { touchedNodeIds.add(e.from); touchedNodeIds.add(e.to); });
    const activeNodes = network.nodes.filter((n) => touchedNodeIds.has(n.id));
    return { activeNodes, activeEdges };
  }

  function consumerReceivedMap(network, result) {
    const received = new Map();
    network.nodes.filter((n) => n.type === "consumer").forEach((c) => {
      let total = 0;
      network.products.forEach((p) => {
        const cf = result.perProduct[p.id] && result.perProduct[p.id].consumerFulfillment[c.id];
        if (cf) total += cf.received;
      });
      received.set(c.id, total);
    });
    return received;
  }

  function mergeScenario(baseScenario, extra) {
    const s = {
      disabledNodes: new Set(baseScenario && baseScenario.disabledNodes ? baseScenario.disabledNodes : []),
      disabledEdges: new Set(baseScenario && baseScenario.disabledEdges ? baseScenario.disabledEdges : []),
      derate: Object.assign({}, baseScenario && baseScenario.derate),
    };
    if (extra.node) s.disabledNodes.add(extra.node);
    if (extra.edge) s.disabledEdges.add(extra.edge);
    return s;
  }

  /**
   * Runs an N-1 contingency scan: baseline solve, then one re-solve per
   * active node and active edge with just that one element disabled,
   * ranked by service-level drop (most critical first).
   *
   * opts: {
   *   scenario,   // an existing base scenario to layer contingencies on
   *                  top of (e.g. already-derated network); optional
   *   limit,      // cap the number of active elements tested, largest
   *                  baseline-flow elements first, for very large/dense
   *                  networks where even the filtered scan is too slow
   *                  for interactive use; omit for no cap
   * }
   */
  function runContingencyScan(network, opts) {
    opts = opts || {};
    const baseScenario = opts.scenario || null;
    const baseline = solveNetwork(network, baseScenario);
    const baselineReceived = consumerReceivedMap(network, baseline);
    const { activeNodes, activeEdges } = findActiveElements(network, baseline);
    const edgeFlow = aggregateEdgeFlow(network, baseline);

    const nodeFlowOf = (nodeId) => {
      let t = 0;
      network.edges.forEach((e) => { if (e.from === nodeId || e.to === nodeId) t += edgeFlow.get(e.id) || 0; });
      return t;
    };

    let candidates = [];
    activeNodes.forEach((n) => candidates.push({ type: "node", id: n.id, name: n.name || n.id, sortKey: nodeFlowOf(n.id) }));
    activeEdges.forEach((e) => candidates.push({ type: "edge", id: e.id, name: e.id, sortKey: edgeFlow.get(e.id) || 0 }));
    candidates.sort((a, b) => b.sortKey - a.sortKey);
    if (opts.limit && candidates.length > opts.limit) candidates = candidates.slice(0, opts.limit);

    const results = candidates.map((c) => {
      const scenario = mergeScenario(baseScenario, c.type === "node" ? { node: c.id } : { edge: c.id });
      const after = solveNetwork(network, scenario);
      const afterReceived = consumerReceivedMap(network, after);
      let newlyStranded = 0;
      baselineReceived.forEach((before, cid) => {
        if (before > 0 && (afterReceived.get(cid) || 0) <= 1e-9) newlyStranded++;
      });
      return {
        type: c.type,
        id: c.id,
        name: c.name,
        baselineServiceLevelPct: baseline.overall.serviceLevelPct,
        afterServiceLevelPct: after.overall.serviceLevelPct,
        serviceLevelDropPct: baseline.overall.serviceLevelPct - after.overall.serviceLevelPct,
        flowLost: baseline.overall.totalFlow - after.overall.totalFlow,
        newlyStrandedConsumers: newlyStranded,
        costIncrease: after.overall.totalCost - baseline.overall.totalCost,
      };
    });

    results.sort((a, b) => b.serviceLevelDropPct - a.serviceLevelDropPct);

    return {
      baseline: baseline.overall,
      elementsScanned: candidates.length,
      elementsSkipped: (network.nodes.length + network.edges.length) - (activeNodes.length + activeEdges.length),
      results: results,
    };
  }

  const mod = { runContingencyScan: runContingencyScan };
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  else { global.NST = global.NST || {}; global.NST.graphAnalysis = mod; }
})(typeof window !== "undefined" ? window : globalThis);
