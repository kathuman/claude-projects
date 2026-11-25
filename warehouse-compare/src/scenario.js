/*
 * scenario.js — turn data/scenario.json into inputs, and run the comparison.
 *
 * resolve(scenarioJson, whParamsJson) → { sc, layouts: { B: p, C: p }, rackTypes }
 *   sc         the shared values ({ name: value })
 *   layouts.C  a full Warehouse Model parameter set: that app's defaults
 *              (warehouse-model/data/parameters.json) overlaid with this
 *              scenario's WH-C values
 *   layouts.B  WH-B's own values, plus the rack dimensions and picking points
 *              copied from layouts.C (whb.RACK_KEYS) — call syncB() after
 *              changing one of those on C
 *
 * run(inputs) sizes every layout to the same capacity, builds it and
 * evaluates it with the same orders. WH-A joins in phase 3 through the same
 * contract.
 *
 * Pure, no DOM: window.WC.scenario in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./kpi.js"), require("./layouts/whb.js"), require("./layouts/whc.js"));
  else { root.WC = root.WC || {}; root.WC.scenario = factory(root.WC.kpi, root.WC.layouts.B, root.WC.layouts.C); }
})(typeof self !== "undefined" ? self : this, function (kpi, whb, whc) {
  "use strict";

  function values(defs) {
    const out = {};
    for (const k in defs) if (k.charAt(0) !== "$") out[k] = defs[k] !== null && typeof defs[k] === "object" ? defs[k].value : defs[k];
    return out;
  }

  function syncB(inputs) {
    whb.RACK_KEYS.forEach(function (k) { inputs.layouts.B[k] = inputs.layouts.C[k]; });
    return inputs;
  }

  function resolve(scJson, whJson) {
    const rackTypes = {};
    for (const k in whJson.rack_types) if (k.charAt(0) !== "$") rackTypes[k] = whJson.rack_types[k];
    const C = values(whJson.parameters);
    for (const k in scJson.layouts.C) if (k.charAt(0) !== "$") C[k] = scJson.layouts.C[k];
    return syncB({ sc: values(scJson.shared), layouts: { B: values(scJson.layouts.B), C: C }, rackTypes: rackTypes });
  }

  function buildB(inputs) { return whb.build(whb.sizeToCapacity(inputs.layouts.B, inputs.sc.target_locations)); }
  function buildC(inputs) { return whc.build(whc.sizeToCapacity(inputs.layouts.C, inputs.rackTypes, inputs.sc.target_locations), inputs.rackTypes); }

  // which: optional list of layout ids to (re)build, e.g. ["B"]; prev: earlier results to keep
  function run(inputs, opts, which, prev) {
    const sc = inputs.sc, out = Object.assign({}, prev || {});
    const want = which || ["B", "C"];
    if (want.indexOf("B") >= 0) out.B = kpi.evaluate(buildB(inputs), sc, opts);
    if (want.indexOf("C") >= 0) out.C = kpi.evaluate(buildC(inputs), sc, opts);
    return out;
  }

  return { values, syncB, resolve, buildB, buildC, run };
});
