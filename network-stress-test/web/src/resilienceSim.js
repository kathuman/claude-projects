/*
 * resilienceSim.js — Phase 2, mode 2 of 3: Time-to-Survive vs.
 * Time-to-Recover, the core comparison from the MIT CTL / Sheffi
 * resilience framework this app's original strategy proposal was
 * anchored on.
 *
 *   Time-to-Recover (TTR): how long until a disrupted element is back.
 *   Time-to-Survive (TTS): how long a consumer's on-hand inventory
 *     buffer covers the gap between demand and what it's still
 *     receiving, before it stocks out.
 *
 * If TTS >= TTR at every affected consumer, the disruption is a
 * survivable dip -- buffers outlast the outage. If TTS < TTR somewhere,
 * that consumer stocks out before recovery; the gap (TTR - TTS) is
 * genuine downtime, not just a service-level percentage.
 *
 * WHAT THIS DELIBERATELY IS NOT: a full day-by-day dynamic simulation
 * where inventories deplete and replenish, recovery happens gradually
 * (not as one instantaneous restoration), and upstream nodes' own
 * buffers cascade into downstream ones. That is a substantially larger
 * model (a discrete-event or time-stepped simulation over the whole
 * network). What's here is the static, single-comparison version the
 * literature itself often starts with: solve the network once in its
 * disrupted state (reusing the exact same solver as every other mode in
 * this app), get each consumer's shortfall RATE, and compare a
 * buffer-runout time against a recovery time. It answers "does this
 * disruption outlast what we can absorb", which is most of what the
 * framework is for, without claiming to model the full dynamics.
 *
 * Units: every node.products[productId] and edge capacity value in this
 * app is treated as a per-day flow rate (the app doesn't otherwise
 * attach a time unit to these numbers) -- so a consumer's demand and
 * received flow are both "units per day", and a buffer given in days
 * multiplied by the daily demand rate gives a buffer in units.
 */
(function (global) {
  "use strict";

  const networkMod = (typeof module !== "undefined" && module.exports)
    ? require("./network.js")
    : global.NST.network;
  const solveNetwork = networkMod.solveNetwork;

  const DEFAULT_BUFFER_DAYS = 10; // consumer inventory buffer, in days of normal demand, if not set per-node
  const DEFAULT_NODE_RECOVERY_DAYS = 14; // fallback if a disabled node has no meanDisruptionDays of its own

  function recoveryDaysFor(network, scenario) {
    let maxDays = 0;
    const nodeById = new Map(network.nodes.map((n) => [n.id, n]));
    if (scenario.disabledNodes) scenario.disabledNodes.forEach((id) => {
      const n = nodeById.get(id);
      const days = (n && n.meanDisruptionDays) || DEFAULT_NODE_RECOVERY_DAYS;
      if (days > maxDays) maxDays = days;
    });
    if (scenario.disabledEdges) {
      const edgeById = new Map(network.edges.map((e) => [e.id, e]));
      scenario.disabledEdges.forEach((id) => {
        const e = edgeById.get(id);
        const days = (e && e.meanDisruptionDays) || DEFAULT_NODE_RECOVERY_DAYS;
        if (days > maxDays) maxDays = days;
      });
    }
    return maxDays;
  }

  /**
   * Runs the TTS/TTR comparison for a given scenario (the disruption
   * already applied) against the network's baseline (undisrupted) state.
   *
   * opts: { bufferDays (default 10, used for any consumer without its
   *        own n.bufferDays) }
   */
  function runResilienceCheck(network, scenario, opts) {
    opts = opts || {};
    const defaultBufferDays = opts.bufferDays !== undefined ? opts.bufferDays : DEFAULT_BUFFER_DAYS;

    const baseline = solveNetwork(network, null);
    const disrupted = solveNetwork(network, scenario);
    const ttr = recoveryDaysFor(network, scenario);

    const consumers = network.nodes.filter((n) => n.type === "consumer");
    const perConsumer = consumers.map((c) => {
      let demand = 0, receivedBefore = 0, receivedAfter = 0;
      network.products.forEach((p) => {
        const before = baseline.perProduct[p.id] && baseline.perProduct[p.id].consumerFulfillment[c.id];
        const after = disrupted.perProduct[p.id] && disrupted.perProduct[p.id].consumerFulfillment[c.id];
        if (before) { demand += before.demand; receivedBefore += before.received; }
        if (after) receivedAfter += after.received;
      });
      const shortfallRate = Math.max(0, receivedBefore - receivedAfter); // vs. this consumer's OWN pre-disruption baseline, not raw demand -- a consumer already under-served at baseline isn't "newly" losing that gap to this disruption
      const bufferDays = c.bufferDays !== undefined ? c.bufferDays : defaultBufferDays;
      const bufferUnits = bufferDays * receivedBefore;
      const tts = shortfallRate > 0 ? bufferUnits / shortfallRate : Infinity;
      const survives = tts >= ttr;
      return {
        id: c.id, name: c.name || c.id,
        demand, receivedBefore, receivedAfter, shortfallRate,
        bufferDays, ttsDays: tts,
        survives: shortfallRate === 0 ? true : survives,
        stockoutGapDays: shortfallRate === 0 ? 0 : Math.max(0, ttr - tts),
      };
    });

    const affected = perConsumer.filter((c) => c.shortfallRate > 0);
    const atRisk = affected.filter((c) => !c.survives);

    return {
      ttrDays: ttr,
      baselineServiceLevelPct: baseline.overall.serviceLevelPct,
      disruptedServiceLevelPct: disrupted.overall.serviceLevelPct,
      affectedConsumerCount: affected.length,
      atRiskConsumerCount: atRisk.length,
      worstStockoutGapDays: atRisk.length ? Math.max(...atRisk.map((c) => c.stockoutGapDays)) : 0,
      perConsumer: perConsumer,
    };
  }

  const mod = {
    runResilienceCheck: runResilienceCheck,
    DEFAULT_BUFFER_DAYS: DEFAULT_BUFFER_DAYS,
    DEFAULT_NODE_RECOVERY_DAYS: DEFAULT_NODE_RECOVERY_DAYS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  else { global.NST = global.NST || {}; global.NST.resilienceSim = mod; }
})(typeof window !== "undefined" ? window : globalThis);
