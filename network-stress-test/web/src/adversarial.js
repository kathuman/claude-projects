/*
 * adversarial.js — Phase 2, mode 3 of 3: adversarial worst-case search.
 *
 * The N-1 contingency scan (Phase 1, graphAnalysis.js) answers "what's
 * the single worst thing that could fail". This module asks the next
 * question: "what's the worst COMBINATION of up to k things failing
 * together" -- the network-interdiction framing (an adversary with a
 * budget of k hits, trying to do maximum damage).
 *
 * Exhaustive search is combinatorially infeasible (choosing k=5 out of
 * even a few hundred active elements is billions of combinations, each
 * requiring a full network solve). Instead this uses the standard
 * greedy heuristic for this class of problem: at each step, find the
 * single element that does the most additional damage GIVEN everything
 * already removed (by reusing the contingency scanner against the
 * network as already-degraded by prior steps), remove it, and repeat
 * until the budget is spent. This is a well-known approximation, not a
 * global optimum -- a different k-combination could in principle be
 * worse than what greedy finds, but greedy is the tractable, honestly-
 * documented standard here, exactly as graphAnalysis.js's own N-1 scan
 * documents its own approximations.
 */
(function (global) {
  "use strict";

  const networkMod = (typeof module !== "undefined" && module.exports)
    ? require("./network.js")
    : global.NST.network;
  const graphAnalysisMod = (typeof module !== "undefined" && module.exports)
    ? require("./graphAnalysis.js")
    : global.NST.graphAnalysis;
  const solveNetwork = networkMod.solveNetwork;
  const runContingencyScan = graphAnalysisMod.runContingencyScan;

  /**
   * opts: {
   *   budget,          // max number of elements to remove (default 3)
   *   perStepLimit,    // how many active-element candidates the N-1
   *                        scan considers at each step (default 30)
   *   baseScenario,    // an existing scenario to start from
   * }
   */
  function runAdversarialSearch(network, opts) {
    opts = opts || {};
    const budget = opts.budget || 3;
    const perStepLimit = opts.perStepLimit || 30;

    const scenario = {
      disabledNodes: new Set(opts.baseScenario && opts.baseScenario.disabledNodes ? opts.baseScenario.disabledNodes : []),
      disabledEdges: new Set(opts.baseScenario && opts.baseScenario.disabledEdges ? opts.baseScenario.disabledEdges : []),
      derate: Object.assign({}, opts.baseScenario && opts.baseScenario.derate),
    };

    const initial = solveNetwork(network, scenario);
    const steps = [{
      step: 0, type: null, id: null, name: "(starting point)",
      serviceLevelPct: initial.overall.serviceLevelPct,
      cumulativeDropPct: 0,
    }];

    let prevServiceLevel = initial.overall.serviceLevelPct;
    for (let i = 0; i < budget; i++) {
      const scan = runContingencyScan(network, { scenario, limit: perStepLimit });
      if (scan.results.length === 0) break; // nothing left with any flow to remove
      const worst = scan.results[0];
      if (worst.type === "node") scenario.disabledNodes.add(worst.id); else scenario.disabledEdges.add(worst.id);
      steps.push({
        step: i + 1, type: worst.type, id: worst.id, name: worst.name,
        serviceLevelPct: worst.afterServiceLevelPct,
        cumulativeDropPct: initial.overall.serviceLevelPct - worst.afterServiceLevelPct,
        stepDropPct: prevServiceLevel - worst.afterServiceLevelPct,
      });
      prevServiceLevel = worst.afterServiceLevelPct;
      if (worst.afterServiceLevelPct <= 1e-9) break; // already at zero, no point spending more budget
    }

    return {
      initialServiceLevelPct: initial.overall.serviceLevelPct,
      finalServiceLevelPct: steps[steps.length - 1].serviceLevelPct,
      steps: steps,
      finalScenario: scenario,
    };
  }

  const mod = { runAdversarialSearch: runAdversarialSearch };
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  else { global.NST = global.NST || {}; global.NST.adversarial = mod; }
})(typeof window !== "undefined" ? window : globalThis);
