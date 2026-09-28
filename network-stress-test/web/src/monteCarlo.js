/*
 * monteCarlo.js — Phase 2, mode 1 of 3: randomized stress testing.
 *
 * Deterministic scenarios (Phase 1) and the N-1 contingency scan answer
 * "what happens if THIS specific thing fails". Monte Carlo answers a
 * different question: "given how often things actually fail, what does
 * the DISTRIBUTION of outcomes look like" -- because in a real network,
 * disruptions are rarely single and isolated; several minor ones often
 * overlap by chance.
 *
 * Each trial samples an independent scenario: every edge is disabled
 * with probability edge.baseFailureRate (already part of the Phase 1
 * schema -- generated or user-set per lane), and every node is disabled
 * with probability n.baseFailureRate if the node carries one, else
 * DEFAULT_NODE_FAILURE_RATE. Nodes don't carry a failure rate in the
 * Phase 1 schema (only edges do, via modeDefaults), so this introduces
 * one governable constant rather than silently treating nodes as
 * unfailable -- a production site or warehouse can absolutely be the
 * thing that goes down.
 *
 * This is an independent-failure model: no correlation between lanes
 * sharing a region or a node's own failures raising a connected lane's
 * failure odds. Real disruptions cluster (a regional event knocks out
 * several things at once); this is a documented simplification, not a
 * claim of full realism.
 */
(function (global) {
  "use strict";

  const networkMod = (typeof module !== "undefined" && module.exports)
    ? require("./network.js")
    : global.NST.network;
  const solveNetwork = networkMod.solveNetwork;

  const DEFAULT_NODE_FAILURE_RATE = 0.01;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sampleScenario(network, rnd, opts) {
    const disabledNodes = new Set(), disabledEdges = new Set();
    network.nodes.forEach((n) => {
      const rate = n.baseFailureRate !== undefined ? n.baseFailureRate : (opts.nodeFailureRate !== undefined ? opts.nodeFailureRate : DEFAULT_NODE_FAILURE_RATE);
      if (rnd() < rate) disabledNodes.add(n.id);
    });
    network.edges.forEach((e) => {
      const rate = e.baseFailureRate || 0;
      if (rnd() < rate) disabledEdges.add(e.id);
    });
    return { disabledNodes, disabledEdges, derate: {} };
  }

  function percentile(sortedArr, p) {
    if (sortedArr.length === 0) return NaN;
    const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.round((p / 100) * (sortedArr.length - 1))));
    return sortedArr[idx];
  }

  /**
   * opts: { trials (default 100), seed (default 1), nodeFailureRate
   *        (fallback for nodes without their own baseFailureRate),
   *        baseScenario (layered under each sampled trial, e.g. an
   *        already-applied deterministic disruption) }
   */
  function runMonteCarlo(network, opts) {
    opts = opts || {};
    const trials = opts.trials || 100;
    const rnd = mulberry32(opts.seed || 1);
    const baseScenario = opts.baseScenario || null;

    const serviceLevels = [];
    const costs = [];
    let worst = null;

    for (let i = 0; i < trials; i++) {
      const sampled = sampleScenario(network, rnd, opts);
      const scenario = {
        disabledNodes: new Set([...(baseScenario && baseScenario.disabledNodes ? baseScenario.disabledNodes : []), ...sampled.disabledNodes]),
        disabledEdges: new Set([...(baseScenario && baseScenario.disabledEdges ? baseScenario.disabledEdges : []), ...sampled.disabledEdges]),
        derate: Object.assign({}, baseScenario && baseScenario.derate),
      };
      const result = solveNetwork(network, scenario);
      serviceLevels.push(result.overall.serviceLevelPct);
      costs.push(result.overall.totalCost);
      if (!worst || result.overall.serviceLevelPct < worst.serviceLevelPct) {
        worst = {
          serviceLevelPct: result.overall.serviceLevelPct,
          disabledNodes: Array.from(scenario.disabledNodes),
          disabledEdges: Array.from(scenario.disabledEdges),
          totalUnmet: result.overall.totalUnmet,
        };
      }
    }

    serviceLevels.sort((a, b) => a - b);
    const mean = serviceLevels.reduce((a, b) => a + b, 0) / trials;

    // simple 10-bucket histogram over [0,100]
    const histogram = new Array(10).fill(0);
    serviceLevels.forEach((v) => { const b = Math.min(9, Math.floor(v / 10)); histogram[b]++; });

    return {
      trials: trials,
      meanServiceLevelPct: mean,
      p10ServiceLevelPct: percentile(serviceLevels, 10),
      p50ServiceLevelPct: percentile(serviceLevels, 50),
      p90ServiceLevelPct: percentile(serviceLevels, 90),
      minServiceLevelPct: serviceLevels[0],
      maxServiceLevelPct: serviceLevels[serviceLevels.length - 1],
      meanCost: costs.reduce((a, b) => a + b, 0) / trials,
      histogram: histogram, // histogram[i] = count of trials with serviceLevelPct in [i*10, (i+1)*10)
      worstTrial: worst,
    };
  }

  const mod = { runMonteCarlo: runMonteCarlo, DEFAULT_NODE_FAILURE_RATE: DEFAULT_NODE_FAILURE_RATE };
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  else { global.NST = global.NST || {}; global.NST.monteCarlo = mod; }
})(typeof window !== "undefined" ? window : globalThis);
