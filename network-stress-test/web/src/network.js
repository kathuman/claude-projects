/*
 * network.js — turns a {products, nodes, edges} network plus an optional
 * scenario (disabled/derated nodes and edges) into per-product flow graphs
 * and solves them with flowSolver.js.
 *
 * Node-capacity handling: production and warehouse nodes are "split" into
 * an in-node and out-node joined by an internal edge whose capacity is
 * that node's OWN capacity for the product being solved (the standard
 * technique for node-capacitated flow networks) -- verified in isolation
 * in flowSolver's test suite (test6). Consumer nodes are pure sinks.
 *
 * Multi-product sharing: only EDGES have capacity shared across products
 * (a lane's capacity is a truck/ship/plane's payload, competed for by
 * whatever's shipped on it); each node's capacity for a product is that
 * product's own dedicated slice, not shared with other products on the
 * same node. Products are solved SEQUENTIALLY in ascending `priority`
 * order, each consuming from whatever edge capacity the previous products
 * left behind -- a deliberate, documented approximation of the much
 * harder general multi-commodity flow problem, not a global optimum.
 * Verified directly: a higher-priority product claims a shared lane
 * first, a lower-priority one gets only the leftover.
 *
 * A "scenario" disables or derates specific nodes/edges to model a
 * disruption; disabling a node removes it (and any product-capacity it
 * had) entirely for this solve; disabling an edge removes its capacity.
 * `derate` (0..1) scales capacity down instead of zeroing it, for a
 * partial disruption rather than a full outage.
 */
(function (global) {
  "use strict";

  const flowSolverMod = (typeof module !== "undefined" && module.exports)
    ? require("./flowSolver.js")
    : global.NST.flowSolver;
  const MinCostFlow = flowSolverMod.MinCostFlow;

  function effectiveCapacity(baseCap, id, scenario) {
    if (!scenario) return baseCap;
    if (scenario.disabledNodes && scenario.disabledNodes.has(id)) return 0;
    if (scenario.disabledEdges && scenario.disabledEdges.has(id)) return 0;
    const derate = scenario.derate && scenario.derate[id];
    if (derate !== undefined) return baseCap * Math.max(0, Math.min(1, derate));
    return baseCap;
  }

  // Solve ONE product's flow given the current remaining capacity on each
  // edge (a Map from edge.id -> capacity still available to this product).
  function solveOneProduct(network, productId, edgeRemaining, scenario) {
    const idOf = new Map();
    let nextId = 0;
    function idIn(nodeId) {
      const key = nodeId + "#in";
      if (!idOf.has(key)) idOf.set(key, nextId++);
      return idOf.get(key);
    }
    function idOut(nodeId, split) {
      if (!split) return idIn(nodeId);
      const key = nodeId + "#out";
      if (!idOf.has(key)) idOf.set(key, nextId++);
      return idOf.get(key);
    }

    const nodeById = new Map(network.nodes.map((n) => [n.id, n]));
    const consumerIds = new Set(network.nodes.filter((n) => n.type === "consumer").map((n) => n.id));

    // pre-register ids in a stable order
    network.nodes.forEach((n) => {
      idIn(n.id);
      if (n.type !== "consumer") idOut(n.id, true);
    });
    const S = nextId++, T = nextId++;
    const g = new MinCostFlow(nextId);

    let totalDemand = 0;
    const demandByConsumer = {};

    network.nodes.forEach((n) => {
      const productValue = (n.products && n.products[productId]) || 0;
      if (n.type === "production") {
        const cap = effectiveCapacity(productValue, n.id, scenario);
        if (cap > 0) {
          g.addEdge(idIn(n.id), idOut(n.id, true), cap, 0);
          g.addEdge(S, idIn(n.id), cap, 0);
        }
      } else if (n.type === "warehouse") {
        const cap = effectiveCapacity(productValue, n.id, scenario);
        if (cap > 0) g.addEdge(idIn(n.id), idOut(n.id, true), cap, 0);
        // if cap is 0 (node handles this product at 0, or disabled), the
        // node simply can't pass this product through -- no internal edge
        // means no path continues through it for this product.
      } else if (n.type === "consumer") {
        const demand = effectiveCapacity(productValue, n.id, scenario);
        if (demand > 0) {
          g.addEdge(idIn(n.id), T, demand, 0);
          totalDemand += demand;
          demandByConsumer[n.id] = demand;
        }
      }
    });

    const edgeGraphIndex = {}; // edge.id -> index of forward edge in g.edges
    network.edges.forEach((e) => {
      const remaining = edgeRemaining.get(e.id);
      const cap = effectiveCapacity(remaining, e.id, scenario);
      if (cap <= 0) return;
      if (!nodeById.has(e.from) || !nodeById.has(e.to)) return;
      const fromOut = idOut(e.from, nodeById.get(e.from).type !== "consumer");
      const toIn = idIn(e.to);
      const gi = g.addEdge(fromOut, toIn, cap, e.costPerUnit || 0);
      edgeGraphIndex[e.id] = gi;
    });

    const result = g.run(S, T, totalDemand);

    const edgeFlows = {};
    for (const eid in edgeGraphIndex) edgeFlows[eid] = g.edges[edgeGraphIndex[eid]].flow;

    // per-consumer fulfillment: walk backwards isn't needed -- the T-edges'
    // flow directly tells us what each consumer received.
    const consumerFulfillment = {};
    network.nodes.forEach((n) => {
      if (n.type !== "consumer") return;
      const demand = demandByConsumer[n.id] || 0;
      if (demand === 0) { consumerFulfillment[n.id] = { demand: 0, received: 0, shortfall: 0 }; return; }
      // the edge idIn(n.id) -> T carries exactly what this consumer received
      const inId = idIn(n.id);
      let received = 0;
      g.graph[inId].forEach((ei) => {
        const e = g.edges[ei];
        if (e.to === T && e.flow > 0) received += e.flow;
      });
      consumerFulfillment[n.id] = { demand: demand, received: received, shortfall: Math.max(0, demand - received) };
    });

    return {
      totalDemand: totalDemand,
      totalFlow: result.flow,
      unmetDemand: totalDemand - result.flow,
      cost: result.cost,
      edgeFlows: edgeFlows,
      consumerFulfillment: consumerFulfillment,
    };
  }

  // Solve ALL products, sequentially in ascending priority, sharing edge
  // capacity as documented above.
  function solveNetwork(network, scenario) {
    const products = network.products.slice().sort((a, b) => a.priority - b.priority);
    const edgeRemaining = new Map(network.edges.map((e) => [e.id, e.capacity]));

    const perProduct = {};
    let totalDemand = 0, totalFlow = 0, totalCost = 0;

    products.forEach((p) => {
      const r = solveOneProduct(network, p.id, edgeRemaining, scenario);
      perProduct[p.id] = r;
      for (const eid in r.edgeFlows) {
        edgeRemaining.set(eid, Math.max(0, edgeRemaining.get(eid) - r.edgeFlows[eid]));
      }
      totalDemand += r.totalDemand;
      totalFlow += r.totalFlow;
      totalCost += r.cost;
    });

    return {
      perProduct: perProduct,
      overall: {
        totalDemand: totalDemand,
        totalFlow: totalFlow,
        totalUnmet: totalDemand - totalFlow,
        totalCost: totalCost,
        serviceLevelPct: totalDemand > 0 ? (totalFlow / totalDemand) * 100 : 100,
      },
    };
  }

  const mod = { solveNetwork: solveNetwork, solveOneProduct: solveOneProduct };
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  else { global.NST = global.NST || {}; global.NST.network = mod; }
})(typeof window !== "undefined" ? window : globalThis);
