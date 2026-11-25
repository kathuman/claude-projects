/*
 * scenario.js — turn data/scenario.json into inputs, and run the comparison.
 *
 * resolve(scenarioJson, whParamsJson) → { sc, layouts: { C: p }, rackTypes }
 *   sc         the shared values ({ name: value })
 *   layouts.C  a full Warehouse Model parameter set: that app's defaults
 *              (warehouse-model/data/parameters.json) overlaid with this
 *              scenario's WH-C values
 *
 * run(inputs) sizes every layout to the same capacity, builds it and
 * evaluates it with the same orders. Phase 1: WH-C only; WH-B and WH-A join
 * in later phases through the same contract.
 *
 * Pure, no DOM: window.WC.scenario in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./kpi.js"), require("./layouts/whc.js"));
  else { root.WC = root.WC || {}; root.WC.scenario = factory(root.WC.kpi, root.WC.layouts.C); }
})(typeof self !== "undefined" ? self : this, function (kpi, whc) {
  "use strict";

  function values(defs) {
    const out = {};
    for (const k in defs) if (k.charAt(0) !== "$") out[k] = defs[k].value;
    return out;
  }

  function resolve(scJson, whJson) {
    const rackTypes = {};
    for (const k in whJson.rack_types) if (k.charAt(0) !== "$") rackTypes[k] = whJson.rack_types[k];
    const C = values(whJson.parameters);
    for (const k in scJson.layouts.C) if (k.charAt(0) !== "$") C[k] = scJson.layouts.C[k];
    return { sc: values(scJson.shared), layouts: { C: C }, rackTypes: rackTypes };
  }

  function run(inputs, opts) {
    const sc = inputs.sc, out = {};
    const pC = whc.sizeToCapacity(inputs.layouts.C, inputs.rackTypes, sc.target_locations);
    out.C = kpi.evaluate(whc.build(pC, inputs.rackTypes), sc, opts);
    return out;
  }

  return { values, resolve, run };
});
